// Round 3 (proposed): journeys follow the THING, not the module.
//  • Item.Lifecycle — one page per dish or ingredient: requested → ordered → received → in stock → sold / consumed /
//    wasted, prices per channel and cost history, recipe and where-used, suppliers and pack cards, movements.
//  • Search.Global — one search over dishes, ingredients, suppliers, purchase orders, receipts, supplier invoices, store
//    requests, checks, customers and people; every kind only for users who may read it.
//  • Search.Status — the live status of the things a user follows (PO waiting for receipt, item below minimum, …).
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { D, m4, Decimal } from '../money';
import { userName, settlementOf } from './util';
import { computeTotals } from '../pricing';
import { priceRuleAt } from '../pricing';
import type { DB, Loc, Channel, Order } from '../types';
import type { InvItem } from '../types-inventory';
import { invOf, qn, onHand, activeVersion, menuRecipeOf, versionCost, itemUnitCost, netPrice, foodCostBand, unitCode, prepRecipeOf } from './inventory-engine';
import { itemBrief, whBrief, poView, receiptView, levelState, movementView, warehousesIn, poReceived } from './inventory';
import { packAdvice, srs, invoices, srView, invoiceView, weeklyUse } from './inventory-procure';

const DAY = 86_400_000;
const CHANNELS: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
const L2 = (ar: string, en: string): Loc => ({ ar, en });
const norm = (s: string) => s.toLowerCase().replace(/[ً-ْٰ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[—\-–·،,()]/g, ' ').replace(/\s+/g, ' ').trim();
const money2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2).toString();
const fmt = (v: Decimal.Value) => D(v).toDecimalPlaces(3).toString();

export type RefType = 'product' | 'item' | 'supplier' | 'po' | 'receipt' | 'invoice' | 'storeRequest' | 'order' | 'customer' | 'person';
const TYPE_PERM: Record<RefType, string[]> = {
  product: ['catalog:read', 'catalog:manage', 'catalog:upsertitem', 'product:setavailability'], item: ['inventory:read'], supplier: ['purchasing:read'], po: ['purchasing:read'],
  receipt: ['purchasing:read'], invoice: ['purchasing:read'], storeRequest: ['inventory:read', 'purchasing:read'], order: ['order:read'], customer: ['customer:pii:read'], person: ['user:read'],
};
const canType = (ctx: Ctx, t: RefType) => TYPE_PERM[t].some((p) => ctx.can(p));

const branchOf = (ctx: Ctx) => ctx.branchId ?? ctx.db.branches[0]?.id ?? null;
const liveOrder = (o: Order) => o.status === 'CONFIRMED' || o.status === 'COMPLETED';

/** Dish quantities sold (order lines) in a branch since a time, by channel. */
function soldOf(db: DB, productId: string, sinceMs: number, branchId: string | null) {
  let qty = D(0), revenue = D(0);
  const byChannel: Record<string, string> = {};
  const byDay = new Map<string, Decimal>();
  for (const o of db.orders) {
    if (!liveOrder(o) || o.createdAtMs < sinceMs || (branchId && o.branchId !== branchId) || o.kind === 'STAFF_MEAL') continue;
    for (const l of o.lines) {
      if (l.productId !== productId || l.status !== 'ACTIVE') continue;
      qty = qty.plus(l.quantity); revenue = revenue.plus(l.lineTotal);
      byChannel[o.channel] = qn(D(byChannel[o.channel] ?? 0).plus(l.quantity));
      byDay.set(o.businessDate, (byDay.get(o.businessDate) ?? D(0)).plus(l.quantity));
    }
  }
  // seeded days before the prototype's checks existed (sales history keeps the top dishes per day)
  let history = D(0);
  const product = db.products.find((p) => p.id === productId);
  const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);
  for (const h of db.salesHistory ?? []) {
    if (h.businessDate < sinceDate || (branchId && h.branchId !== branchId)) continue;
    const top = h.topItems.find((x) => x.name.ar === product?.name.ar);
    if (!top) continue;
    history = history.plus(top.qty); qty = qty.plus(top.qty); revenue = revenue.plus(top.amount);
    byDay.set(h.businessDate, (byDay.get(h.businessDate) ?? D(0)).plus(top.qty));
  }
  return { qty: qn(qty), fromHistory: qn(history), revenue: m4(revenue), byChannel, byDay: [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, q]) => ({ date, qty: qn(q) })) };
}

function stockItemFor(db: DB, productId: string): InvItem | null {
  return invOf(db).items.find((i) => i.productId === productId && i.id !== productId) ?? null;
}

/** Ingredient-side lifecycle numbers (all warehouses of the user's branch scope). */
function itemStages(ctx: Ctx, it: InvItem) {
  const db = ctx.db;
  const inv = invOf(db);
  const whs = warehousesIn(db, ctx.query.branchId === 'ALL' ? null : branchOf(ctx));
  const whIds = new Set(whs.map((w) => w.id));
  const since = ctx.now - 30 * DAY;
  const reqDocs = srs(inv).filter((s) => whIds.has(s.warehouseId) && ['DRAFT', 'SUBMITTED'].includes(s.state) && s.lines.some((l) => l.itemId === it.id));
  const requested = reqDocs.reduce((a, s) => a.plus(s.lines.filter((l) => l.itemId === it.id).reduce((b, l) => b.plus(l.requestedQuantity), D(0))), D(0));
  const openPos = inv.purchaseOrders.filter((p) => whIds.has(p.warehouseId) && ['DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) && p.lines.some((l) => l.itemId === it.id));
  const ordered = openPos.reduce((a, p) => { const rec = poReceived(db, p); return a.plus(p.lines.filter((l) => l.itemId === it.id).reduce((b, l) => b.plus(Decimal.max(D(l.orderedQuantity).times(l.factor).minus(rec.get(l.id) ?? 0), 0)), D(0))); }, D(0));
  const recs = inv.receipts.filter((r) => whIds.has(r.warehouseId) && r.state === 'POSTED' && Date.parse(r.at) >= since && r.lines.some((l) => l.itemId === it.id));
  const received = recs.reduce((a, r) => a.plus(r.lines.filter((l) => l.itemId === it.id).reduce((b, l) => b.plus(l.quantity), D(0))), D(0));
  const receivedValue = recs.reduce((a, r) => a.plus(r.lines.filter((l) => l.itemId === it.id).reduce((b, l) => b.plus(l.value), D(0))), D(0));
  const pendingInvoice = inv.receipts.filter((r) => whIds.has(r.warehouseId) && r.state === 'POSTED' && !r.invoiceId && r.lines.some((l) => l.itemId === it.id));
  let sold = D(0), soldValue = D(0), used = D(0), wasted = D(0), wastedValue = D(0), adjusted = D(0), transferredIn = D(0);
  for (let i = inv.movements.length - 1; i >= 0; i--) {
    const m = inv.movements[i];
    if (m.atMs < since) break;
    if (m.itemId !== it.id || !whIds.has(m.warehouseId)) continue;
    if (m.kind === 'SALE' || m.kind === 'SALE_REVERSAL') { sold = sold.minus(m.quantity); soldValue = soldValue.minus(m.value); }
    else if (m.kind === 'PRODUCTION_OUT') used = used.minus(m.quantity);
    else if (m.kind === 'WASTE' || m.kind === 'VOID_WASTE') { wasted = wasted.minus(m.quantity); wastedValue = wastedValue.minus(m.value); }
    else if (m.kind === 'ADJUSTMENT' || m.kind === 'COUNT_VARIANCE') adjusted = adjusted.plus(m.quantity);
    else if (m.kind === 'TRANSFER_IN') transferredIn = transferredIn.plus(m.quantity);
  }
  const byWarehouse = whs.map((w) => ({ warehouse: whBrief(db, w.id), salesDefault: w.salesDefault, quantity: onHand(inv, it.id, w.id), level: it.levels[w.id] ?? null, state: levelState(inv, it, w.id), value: m4(D(onHand(inv, it.id, w.id)).times(it.avgCost)) })).filter((b) => b.level || !D(b.quantity).isZero());
  const total = byWarehouse.reduce((a, b) => a.plus(b.quantity), D(0));
  const lots = inv.lots.filter((l) => l.itemId === it.id && whIds.has(l.warehouseId) && D(l.remaining).gt(0)).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999')).map((l) => ({ ...l, warehouse: whBrief(db, l.warehouseId) }));
  const worst = byWarehouse.map((b) => b.state);
  return {
    requested: { quantity: qn(requested), docs: reqDocs.map((s) => ({ id: s.id, number: s.number, state: s.state, at: s.createdAt })) },
    ordered: { quantity: qn(ordered), docs: openPos.map((p) => ({ id: p.id, number: p.number, state: p.state, at: p.createdAt, supplierName: inv.suppliers.find((s) => s.id === p.supplierId)?.name ?? '' })) },
    received: { quantity: qn(received), value: m4(receivedValue), docs: recs.slice(0, 8).map((r) => ({ id: r.id, number: r.number, at: r.at, supplierName: inv.suppliers.find((s) => s.id === r.supplierId)?.name ?? '', invoiced: !!r.invoiceId })), pendingInvoice: pendingInvoice.map((r) => ({ id: r.id, number: r.number })) },
    inStock: { quantity: qn(total), value: m4(total.times(it.avgCost)), byWarehouse, lots, state: worst.includes('NEGATIVE') ? 'NEGATIVE' : worst.includes('OUT') ? 'OUT' : worst.includes('LOW') ? 'LOW' : worst.includes('OK') ? 'OK' : 'NO_LEVEL' },
    sold: { quantity: qn(sold), value: m4(soldValue) }, usedInPrep: { quantity: qn(used) }, wasted: { quantity: qn(wasted), value: m4(wastedValue) }, adjusted: { quantity: qn(adjusted) }, transferredIn: { quantity: qn(transferredIn) },
    weeklyUse: qn(weeklyUse(inv, it.id, ctx.now, whIds).toDecimalPlaces(3)),
  };
}

function supplierRows(db: DB, it: InvItem) {
  const inv = invOf(db);
  const by = new Map<string, { last: string; at: string; count: number; qty: Decimal }>();
  for (const r of inv.receipts) {
    if (r.state !== 'POSTED') continue;
    for (const l of r.lines.filter((x) => x.itemId === it.id)) {
      const cur = by.get(r.supplierId);
      if (!cur) by.set(r.supplierId, { last: l.unitCost, at: r.at, count: 1, qty: D(l.quantity) });
      else { cur.count++; cur.qty = cur.qty.plus(l.quantity); if (r.at > cur.at) { cur.last = l.unitCost; cur.at = r.at; } }
    }
  }
  if (it.defaultSupplierId && !by.has(it.defaultSupplierId)) by.set(it.defaultSupplierId, { last: it.lastCost, at: it.createdAt, count: 0, qty: D(0) });
  for (const p of it.packs) for (const o of p.offers ?? []) if (!by.has(o.supplierId)) by.set(o.supplierId, { last: m4(D(o.packPrice).dividedBy(p.factor)), at: o.at, count: 0, qty: D(0) });
  return [...by].map(([id, v]) => ({ supplierId: id, name: inv.suppliers.find((s) => s.id === id)?.name ?? id, phone: inv.suppliers.find((s) => s.id === id)?.phone ?? null, isDefault: it.defaultSupplierId === id, lastUnitCost: v.last, lastAt: v.at, receipts: v.count, quantity: qn(v.qty) }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || D(a.lastUnitCost).comparedTo(b.lastUnitCost));
}

function pricesOf(db: DB, productId: string, nowMs: number) {
  const rows: { branchId: string; branchName: string; channel: Channel; amount: string | null; net: string | null }[] = [];
  for (const b of db.branches.filter((x) => x.active)) for (const ch of CHANNELS) {
    const r = priceRuleAt(db, productId, b.id, ch, nowMs);
    rows.push({ branchId: b.id, branchName: b.name, channel: ch, amount: r?.amount ?? null, net: netPrice(db, productId, b.id, ch, nowMs) });
  }
  const history = db.priceRules.filter((r) => r.productId === productId && !r.variantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12)
    .map((r) => ({ id: r.id, branchName: db.branches.find((b) => b.id === r.branchId)?.name ?? r.branchId, channel: r.channel, amount: r.amount, from: new Date(r.effectiveFrom).toISOString(), to: r.effectiveTo ? new Date(r.effectiveTo).toISOString() : null, byName: userName(db, r.createdBy) }));
  return { rows, history };
}

function lifecycle(ctx: Ctx) {
  const db = ctx.db;
  const inv = invOf(db);
  const kind = ctx.params.kind;
  if (kind !== 'product' && kind !== 'item') throw new ApiError('VALIDATION_FAILED', { field: 'kind', allowed: ['product', 'item'] });
  const branchId = branchOf(ctx);
  const product = kind === 'product' ? db.products.find((p) => p.id === ctx.params.itemId) : (() => { const it = inv.items.find((i) => i.id === ctx.params.itemId); return it && it.productId !== it.id ? db.products.find((p) => p.id === it.productId) : undefined; })();
  if (kind === 'product' && !product) throw new ApiError('CATALOG_PRODUCT_NOT_FOUND', { productId: ctx.params.itemId });
  const item = kind === 'item' ? inv.items.find((i) => i.id === ctx.params.itemId) ?? null : product ? stockItemFor(db, product.id) : null;
  if (kind === 'item' && !item) throw new ApiError('INVENTORY_ITEM_NOT_FOUND', { inventoryItemId: ctx.params.itemId });
  const canInv = ctx.can('inventory:read');
  const canBuy = ctx.can('purchasing:read');
  const canCat = TYPE_PERM.product.some((p) => ctx.can(p));
  const recipe = product ? menuRecipeOf(inv, product.id) : null;
  const stocking = !product ? (item?.kind === 'PREP' ? 'PREP' : 'INGREDIENT') : item ? 'STOCK_ITEM' : recipe ? 'RECIPE' : 'NOT_TRACKED';
  // cost
  let unitCost: Decimal | null = null;
  let recipeView: any = null;
  if (recipe) {
    const v = activeVersion(recipe, ctx.now);
    const c = versionCost(db, v);
    unitCost = c.perUnit;
    recipeView = { id: recipe.id, versions: recipe.versions.length, activeVersion: v.version, effectiveFrom: v.effectiveFrom, note: v.note, outputQuantity: c.outputQuantity, total: c.total, perUnit: m4(c.perUnit),
      lines: c.lines.map((l) => { const it = inv.items.find((x) => x.id === l.itemId); return { ...l, unit: it ? unitCode(db, it.stockUnitId) : '', kind: it?.kind ?? 'RAW', state: it ? itemStages(ctx, it).inStock.state : 'NO_LEVEL' }; }) };
  } else if (item) unitCost = itemUnitCost(db, item);
  const prepRecipe = item && item.kind === 'PREP' ? prepRecipeOf(inv, item.id) : null;
  if (prepRecipe && !recipeView) {
    const v = activeVersion(prepRecipe, ctx.now);
    const c = versionCost(db, v);
    recipeView = { id: prepRecipe.id, prep: true, versions: prepRecipe.versions.length, activeVersion: v.version, effectiveFrom: v.effectiveFrom, note: v.note, outputQuantity: c.outputQuantity, total: c.total, perUnit: m4(c.perUnit), lines: c.lines.map((l) => { const it = inv.items.find((x) => x.id === l.itemId); return { ...l, unit: it ? unitCode(db, it.stockUnitId) : '', kind: it?.kind ?? 'RAW' }; }) };
  }
  // where used (ingredient → dishes and preparations)
  const whereUsed = item ? inv.recipes.filter((r) => activeVersion(r, ctx.now).inputsPerBatch.some((i) => i.itemId === item.id)).map((r) => {
    const v = activeVersion(r, ctx.now);
    const line = v.inputsPerBatch.find((i) => i.itemId === item.id)!;
    const target = r.outputKind === 'MENU' ? { type: 'product' as const, id: r.outputProductId } : r.outputKind === 'PREP' ? { type: 'item' as const, id: r.outputProductId } : null;
    const name = r.outputKind === 'MODIFIER' ? (db.modifierGroups.flatMap((g) => g.options).find((o) => o.id === r.modifierOptionId)?.name ?? r.name) : (db.products.find((p) => p.id === r.outputProductId)?.name ?? inv.items.find((i) => i.id === r.outputProductId)?.name ?? r.name);
    const sold = r.outputKind === 'MENU' ? soldOf(db, r.outputProductId, ctx.now - 7 * DAY, branchId).qty : null;
    return { recipeId: r.id, kind: r.outputKind, name, target, quantity: line.quantity, enteredQuantity: line.enteredQuantity, enteredUnit: line.enteredUnit, perBatch: v.outputQuantityPerBatch, sold7: sold };
  }) : [];
  // dish → combos that offer it
  const inCombos = product ? db.products.filter((p) => (p.combo ?? []).some((s) => s.options.some((o) => o.productId === product.id))).map((p) => ({ id: p.id, name: p.name })) : [];
  const prices = product && canCat ? pricesOf(db, product.id, ctx.now) : null;
  const foodCost = product && unitCost && prices ? CHANNELS.map((ch) => {
    const net = prices.rows.find((r) => r.branchId === branchId && r.channel === ch)?.net;
    const pct = net && D(net).gt(0) ? unitCost!.dividedBy(net).times(100) : null;
    return { channel: ch, net: net ?? null, percent: pct ? pct.toDecimalPlaces(1).toString() : null, band: foodCostBand(pct), margin: net ? m4(D(net).minus(unitCost!)) : null };
  }) : [];
  const avail = product ? db.availability.find((a) => a.productId === product.id && a.branchId === branchId) : null;
  const stages = item && canInv ? itemStages(ctx, item) : null;
  const sold7 = product ? soldOf(db, product.id, ctx.now - 7 * DAY, branchId) : null;
  const sold30 = product ? soldOf(db, product.id, ctx.now - 30 * DAY, branchId) : null;
  const dishWaste = product ? inv.waste.filter((w) => w.itemKind === 'PRODUCT' && w.itemId === product.id && Date.parse(w.at) >= ctx.now - 30 * DAY) : [];
  // documents & timeline
  const docs = item && canBuy ? {
    storeRequests: srs(inv).filter((s) => s.lines.some((l) => l.itemId === item.id)).slice(0, 8).map((s) => { const v = srView(db, s); const l = v.lines.find((x) => x.itemId === item.id)!; return { id: s.id, number: s.number, state: s.state, at: s.createdAt, requested: l.requestedQuantity, ordered: l.orderedQuantity, received: l.receivedQuantity, warehouseName: v.warehouse.name }; }),
    purchaseOrders: inv.purchaseOrders.filter((p) => p.lines.some((l) => l.itemId === item.id)).slice(0, 8).map((p) => { const v = poView(db, p); const l = v.lines.find((x) => x.itemId === item.id)!; return { id: p.id, number: p.number, state: p.state, at: p.createdAt, supplierName: v.supplierName, ordered: l.orderedStockQuantity, received: l.receivedQuantity, outstanding: l.outstandingQuantity }; }),
    receipts: inv.receipts.filter((r) => r.lines.some((l) => l.itemId === item.id)).slice(0, 8).map((r) => ({ id: r.id, number: r.number, state: r.state, at: r.at, supplierName: inv.suppliers.find((s) => s.id === r.supplierId)?.name ?? '', quantity: qn(r.lines.filter((l) => l.itemId === item.id).reduce((a, l) => a.plus(l.quantity), D(0))), unitCost: r.lines.find((l) => l.itemId === item.id)!.unitCost, invoiceId: r.invoiceId ?? null, purchaseOrderId: r.purchaseOrderId })),
    invoices: invoices(inv).filter((x) => x.lines.some((l) => l.itemId === item.id)).slice(0, 8).map((x) => ({ id: x.id, number: x.number, kind: x.kind, at: x.at, supplierName: inv.suppliers.find((s) => s.id === x.supplierId)?.name ?? '', quantity: qn(x.lines.filter((l) => l.itemId === item.id).reduce((a, l) => a.plus(l.quantity), D(0))), total: x.total })),
  } : null;
  const movements = item && canInv ? inv.movements.filter((m) => m.itemId === item.id).slice(-30).reverse().map((m) => movementView(db, m)) : [];
  return {
    kind, id: ctx.params.itemId, stocking,
    name: product?.name ?? item!.name, sku: product?.sku ?? item!.sku,
    category: product ? (db.categories.find((c) => c.id === product.categoryId)?.name ?? null) : L2(item!.category, item!.category),
    product: product ? { id: product.id, sku: product.sku, active: product.active, colorCode: product.colorCode ?? null, imageUrl: product.imageUrl ?? null, taxName: db.taxPolicies.find((x) => x.id === product.taxPolicyId)?.name ?? null, taxRate: db.taxPolicies.find((x) => x.id === product.taxPolicyId)?.rate ?? null, availability: avail ? { state: avail.state, reason: avail.reason } : { state: 'AVAILABLE', reason: null }, allergens: product.allergens ?? [], categoryId: product.categoryId } : null,
    item: item ? { ...itemBrief(db, item), active: item.active, version: item.version, lastCost: item.lastCost, shelfLifeDays: item.shelfLifeDays, defaultSupplierId: item.defaultSupplierId, levels: item.levels, costHistory: canInv ? item.costHistory.slice(-12).reverse() : [] } : null,
    unitCost: unitCost ? m4(unitCost) : null,
    prices, foodCost, recipe: recipeView, whereUsed, inCombos,
    stages, sold7, sold30, dishWaste: dishWaste.map((w) => ({ id: w.id, number: w.number, at: w.at, quantity: w.quantity, reason: w.reason, value: w.value })),
    suppliers: item && canBuy ? supplierRows(db, item) : [],
    packs: item && item.packs.length ? packAdvice(db, item, ctx.now) : null,
    docs, movements,
    can: { inventory: canInv, purchasing: canBuy, catalog: canCat, adjust: ctx.can('inventory:adjust'), receive: ctx.can('goodsreceipt:post'), count: ctx.can('stockcount:start'), order: ctx.can('purchaseorder:create'), request: ctx.can('storerequest:create'), price: ctx.can('catalog:setprice'), availability: ctx.can('product:setavailability'), recipe: ctx.can('recipe:define') },
  };
}

// ───────── status of one thing (search results and the follow list)
export interface StatusView { type: RefType; id: string; title: Loc; sub: Loc | null; status: { text: Loc; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' }; missing?: boolean }

function statusOf(ctx: Ctx, type: RefType, id: string): StatusView {
  const db = ctx.db;
  const inv = invOf(db);
  const branchId = branchOf(ctx);
  const gone = (title: Loc): StatusView => ({ type, id, title, sub: null, status: { text: L2('غير موجود حاليًا', 'No longer available'), tone: 'neutral' }, missing: true });
  switch (type) {
    case 'product': {
      const p = db.products.find((x) => x.id === id);
      if (!p) return gone(L2(id, id));
      const a = db.availability.find((x) => x.productId === p.id && x.branchId === branchId);
      const today = soldOf(db, p.id, ctx.now - 18 * 3600_000, branchId).qty;
      const price = branchId ? priceRuleAt(db, p.id, branchId, 'DINE_IN', ctx.now) ?? priceRuleAt(db, p.id, branchId, 'TAKEAWAY', ctx.now) : null;
      const cat = db.categories.find((c) => c.id === p.categoryId)?.name;
      const sub = L2(`${cat?.ar ?? ''}${price ? ` · ${money2(price.amount)} ج.م` : ''}`, `${cat?.en ?? ''}${price ? ` · ${money2(price.amount)} ج.م` : ''}`);
      if (!p.active) return { type, id, title: p.name, sub, status: { text: L2('مؤرشف', 'Archived'), tone: 'neutral' } };
      if (a?.state === 'SOLD_OUT') return { type, id, title: p.name, sub, status: { text: L2('نفد اليوم', 'Sold out today'), tone: 'warning' } };
      if (a?.state === 'BLOCKED') return { type, id, title: p.name, sub, status: { text: L2('موقوف', 'Blocked'), tone: 'error' } };
      if (!price) return { type, id, title: p.name, sub, status: { text: L2('مالوش سعر في الفرع ده', 'No price in this branch'), tone: 'warning' } };
      return { type, id, title: p.name, sub, status: { text: L2(`متاح · بيع ${fmt(today)} اليوم`, `Available · ${fmt(today)} sold today`), tone: 'success' } };
    }
    case 'item': {
      const it = inv.items.find((x) => x.id === id);
      if (!it) return gone(L2(id, id));
      const whs = warehousesIn(db, branchId);
      const states = whs.map((w) => ({ w, s: levelState(inv, it, w.id), q: onHand(inv, it.id, w.id) }));
      const total = states.reduce((a, x) => a.plus(x.q), D(0));
      const u = unitCode(db, it.stockUnitId);
      const uAr = ({ KG: 'كجم', L: 'لتر', PCS: 'قطعة', G: 'جم', ML: 'مل' } as Record<string, string>)[u] ?? u;
      const sub = L2(`${it.category} · ${fmt(total)} ${uAr}`, `${it.category} · ${fmt(total)} ${u.toLowerCase()}`);
      const bad = states.find((x) => x.s === 'NEGATIVE' || x.s === 'OUT') ?? states.find((x) => x.s === 'LOW');
      const onOrder = inv.purchaseOrders.some((p) => ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) && p.lines.some((l) => l.itemId === it.id) && whs.some((w) => w.id === p.warehouseId));
      if (bad) {
        const lv = it.levels[bad.w.id];
        const txt = bad.s === 'LOW' ? L2(`تحت الحد الأدنى في ${bad.w.name} (${fmt(bad.q)} من ${fmt(lv.min)} ${uAr})`, `Below minimum in ${bad.w.name} (${fmt(bad.q)} of ${fmt(lv.min)})`) : L2(`نفد في ${bad.w.name}`, `Out in ${bad.w.name}`);
        if (onOrder) { txt.ar += ' · عليه أمر شراء'; txt.en += ' · on order'; }
        return { type, id, title: it.name, sub, status: { text: txt, tone: bad.s === 'LOW' ? 'warning' : 'error' } };
      }
      return { type, id, title: it.name, sub, status: { text: L2('الرصيد كويس', 'Stock OK'), tone: 'success' } };
    }
    case 'supplier': {
      const s = inv.suppliers.find((x) => x.id === id);
      if (!s) return gone(L2(id, id));
      const open = inv.purchaseOrders.filter((p) => p.supplierId === s.id && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state)).length;
      const pend = inv.receipts.filter((r) => r.supplierId === s.id && r.state === 'POSTED' && !r.invoiceId).length;
      const sub = L2(`${s.phone ?? ''}${s.contactName ? ' · ' + s.contactName : ''}`, `${s.phone ?? ''}${s.contactName ? ' · ' + s.contactName : ''}`);
      if (!s.active) return { type, id, title: L2(s.name, s.name), sub, status: { text: L2('موقوف', 'Inactive'), tone: 'neutral' } };
      if (open || pend) return { type, id, title: L2(s.name, s.name), sub, status: { text: L2(`${open} أمر بانتظار الاستلام · ${pend} استلام بلا فاتورة`, `${open} PO awaiting receipt · ${pend} receipt(s) not invoiced`), tone: 'info' } };
      return { type, id, title: L2(s.name, s.name), sub, status: { text: L2('لا يوجد شيء مفتوح', 'Nothing open'), tone: 'success' } };
    }
    case 'po': {
      const p = inv.purchaseOrders.find((x) => x.id === id);
      if (!p) return gone(L2(id, id));
      const v = poView(db, p);
      const title = L2(`أمر شراء ${p.number}`, `Purchase order ${p.number}`);
      const sub = L2(`${v.supplierName} · ${money2(v.total)} ج.م`, `${v.supplierName} · ${money2(v.total)} ج.م`);
      const left = v.lines.filter((l) => D(l.outstandingQuantity).gt(0)).length;
      const notInvoiced = inv.receipts.some((r) => r.purchaseOrderId === p.id && r.state === 'POSTED' && !r.invoiceId);
      const map: Record<string, StatusView['status']> = {
        DRAFT: { text: L2('مسودة — لم تُرسل للمورد بعد', 'Draft — not sent'), tone: 'neutral' },
        ISSUED: { text: L2('مستني الاستلام', 'Waiting for receipt'), tone: 'info' },
        PARTIALLY_RECEIVED: { text: L2(`استُلم جزء — المتبقي ${left} صنف`, `Partly received — ${left} line(s) left`), tone: 'warning' },
        RECEIVED: { text: notInvoiced ? L2('استُلم — بانتظار فاتورة المورد', 'Received — invoice pending') : L2('استُلم بالكامل', 'Fully received'), tone: notInvoiced ? 'warning' : 'success' },
        CLOSED: { text: notInvoiced ? L2('مغلق — بانتظار فاتورة المورد', 'Closed — invoice pending') : L2('مقفول', 'Closed'), tone: notInvoiced ? 'warning' : 'neutral' },
        CANCELLED: { text: L2('ملغي', 'Cancelled'), tone: 'error' },
      };
      return { type, id, title, sub, status: map[p.state] };
    }
    case 'receipt': {
      const r = inv.receipts.find((x) => x.id === id);
      if (!r) return gone(L2(id, id));
      const sname = inv.suppliers.find((s) => s.id === r.supplierId)?.name ?? '';
      const title = L2(`إذن استلام ${r.number}`, `Goods receipt ${r.number}`);
      const sub = L2(`${sname} · ${money2(r.total)} ج.م`, `${sname} · ${money2(r.total)} ج.م`);
      if (r.state === 'REVERSED') return { type, id, title, sub, status: { text: L2('مُلغى', 'Reversed'), tone: 'error' } };
      const x = r.invoiceId ? invoices(inv).find((i) => i.id === r.invoiceId) : null;
      return { type, id, title, sub, status: x ? { text: L2(`عليه فاتورة ${x.number}`, `Invoiced ${x.number}`), tone: 'success' } : { text: L2('بانتظار فاتورة المورد', 'Invoice pending'), tone: 'warning' } };
    }
    case 'invoice': {
      const x = invoices(inv).find((i) => i.id === id);
      if (!x) return gone(L2(id, id));
      const sname = inv.suppliers.find((s) => s.id === x.supplierId)?.name ?? '';
      const late = x.dueDate && x.dueDate < new Date(ctx.now).toISOString().slice(0, 10) && x.state !== 'PAID';
      return { type, id, title: L2(`فاتورة مورد ${x.number}`, `Supplier invoice ${x.number}`), sub: L2(`${sname} · ${money2(x.total)} ج.م`, `${sname} · ${money2(x.total)} ج.م`),
        status: x.state === 'PAID' ? { text: L2('مدفوعة', 'Paid'), tone: 'success' } : late ? { text: L2(`ميعاد دفعها عدّى (${x.dueDate})`, `Overdue (${x.dueDate})`), tone: 'error' } : { text: L2(x.dueDate ? `اتسجلت · تتدفع ${x.dueDate}` : 'اتسجلت', x.dueDate ? `Posted · due ${x.dueDate}` : 'Posted'), tone: 'info' } };
    }
    case 'storeRequest': {
      const s = srs(inv).find((x) => x.id === id);
      if (!s) return gone(L2(id, id));
      const wn = inv.warehouses.find((w) => w.id === s.warehouseId)?.name ?? '';
      const map: Record<string, StatusView['status']> = { DRAFT: { text: L2('مسودة', 'Draft'), tone: 'neutral' }, SUBMITTED: { text: L2('بانتظار مسؤول المشتريات', 'Waiting for purchasing'), tone: 'warning' }, ORDERED: { text: L2('أُنشئ منها أمر شراء', 'Ordered'), tone: 'success' }, CANCELLED: { text: L2('ملغية', 'Cancelled'), tone: 'error' } };
      return { type, id, title: L2(`طلبية مخزن ${s.number}`, `Store request ${s.number}`), sub: L2(`${wn} · ${s.lines.length} صنف`, `${wn} · ${s.lines.length} item(s)`), status: map[s.state] };
    }
    case 'order': {
      const o = db.orders.find((x) => x.id === id);
      if (!o) return gone(L2(id, id));
      const tbl = o.tableId ? db.tables.find((t) => t.id === o.tableId)?.name : null;
      const ch: Record<string, Loc> = { DINE_IN: L2('صالة', 'Dine-in'), TAKEAWAY: L2('تيك أواي', 'Takeaway'), DELIVERY: L2('دليفري', 'Delivery') };
      const totals = computeTotals(o);
      const title = L2(`شيك #${o.number}`, `Check #${o.number}`);
      const sub = L2(`${ch[o.channel].ar}${tbl ? ' · ترابيزة ' + tbl : ''}${o.customerName ? ' · ' + o.customerName : ''} · ${money2(totals.payable)} ج.م`, `${ch[o.channel].en}${tbl ? ' · table ' + tbl : ''}${o.customerName ? ' · ' + o.customerName : ''} · ${money2(totals.payable)} ج.م`);
      if (o.status === 'DRAFT') return { type, id, title, sub, status: { text: L2('قيد التحرير', 'Being written'), tone: 'info' } };
      if (o.status === 'VOIDED' || o.status === 'CANCELLED') return { type, id, title, sub, status: { text: L2('مُلغى', 'Voided'), tone: 'error' } };
      if (o.status === 'MERGED') return { type, id, title, sub, status: { text: L2('دُمج في شيك آخر', 'Merged'), tone: 'neutral' } };
      const st = settlementOf(db, o);
      if (!st.settled) return { type, id, title, sub, status: { text: L2(`غير مدفوع — المتبقي ${money2(st.remaining)} ج.م`, `Unpaid — ${money2(st.remaining)} ج.م left`), tone: 'warning' } };
      return { type, id, title, sub, status: { text: o.status === 'COMPLETED' ? L2('مغلق ومدفوع', 'Closed and paid') : L2('مدفوع', 'Paid'), tone: 'success' } };
    }
    case 'customer': {
      const c = (db.customers ?? []).find((x) => x.id === id);
      if (!c) return gone(L2(id, id));
      const open = db.orders.filter((o) => o.customerId === c.id && (o.status === 'DRAFT' || o.status === 'CONFIRMED')).length;
      const last = db.orders.filter((o) => o.customerId === c.id).sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
      const sub = L2(`${c.phone}${c.addresses[0]?.area ? ' · ' + c.addresses[0].area : ''}`, `${c.phone}${c.addresses[0]?.area ? ' · ' + c.addresses[0].area : ''}`);
      if (open) return { type, id, title: L2(c.name, c.name), sub, status: { text: L2(`عنده ${open} طلب مفتوح`, `${open} open order(s)`), tone: 'info' } };
      return { type, id, title: L2(c.name, c.name), sub, status: { text: last ? L2(`آخر طلب #${last.number}`, `Last order #${last.number}`) : (c.allergies.length ? L2('عنده حساسية — راجع ملفه', 'Has allergies') : L2('لا توجد طلبات مفتوحة', 'No open orders')), tone: c.allergies.length ? 'warning' : 'neutral' } };
    }
    case 'person': {
      const u = db.users.find((x) => x.id === id);
      if (!u) return gone(L2(id, id));
      const name = userName(db, u.id);
      const shift = db.sessions.find((s) => s.userId === u.id && s.state === 'OPEN');
      const term = shift ? db.terminals.find((x) => x.id === shift.terminalId) : null;
      const status: StatusView['status'] = !u.active ? { text: L2('موقوف', 'Inactive'), tone: 'neutral' } : shift ? { text: L2(`لديه وردية مفتوحة على ${term?.name ?? 'جهاز'}`, `Shift open on ${term?.name ?? 'a terminal'}`), tone: 'info' } : { text: L2('لا توجد وردية مفتوحة', 'No open shift'), tone: 'neutral' };
      return { type, id, title: L2(name, name), sub: null, status };
    }
  }
}

function search(ctx: Ctx) {
  const db = ctx.db;
  const inv = invOf(db);
  const raw = String(ctx.query.q ?? '').trim();
  const q = norm(raw);
  if (q.length < 2) return { items: [], q: raw, counts: {} };
  const words = q.split(' ');
  const digits = raw.replace(/\D/g, '');
  const only = ctx.query.types ? new Set(String(ctx.query.types).split(',')) : null;
  const want = (t: RefType) => (!only || only.has(t)) && canType(ctx, t);
  const hit = (...parts: (string | null | undefined)[]) => { const h = norm(parts.filter(Boolean).join(' ')); return words.every((w) => h.includes(w)); };
  const out: { type: RefType; id: string; score: number }[] = [];
  const add = (type: RefType, id: string, score: number) => out.push({ type, id, score });
  const startsBonus = (name: string) => (norm(name).startsWith(q) ? 2 : 0);
  if (want('product')) for (const p of db.products) if (hit(p.name.ar, p.name.en, p.sku)) add('product', p.id, 10 + startsBonus(p.name.ar) + (p.active ? 1 : 0));
  if (want('item')) for (const i of inv.items) if (i.productId === i.id && hit(i.name.ar, i.name.en, i.sku, i.category)) add('item', i.id, 9 + startsBonus(i.name.ar));
  if (want('supplier')) for (const s of inv.suppliers) if (hit(s.name, s.contactName, s.phone, s.notes)) add('supplier', s.id, 8 + startsBonus(s.name));
  if (want('po')) for (const p of inv.purchaseOrders) { const sn = inv.suppliers.find((s) => s.id === p.supplierId)?.name; if (hit(p.number, sn, 'امر شراء', 'po') || (digits.length >= 2 && p.number.replace(/\D/g, '').endsWith(digits))) add('po', p.id, 7); }
  if (want('receipt')) for (const r of inv.receipts) { const sn = inv.suppliers.find((s) => s.id === r.supplierId)?.name; if (hit(r.number, sn, r.supplierInvoiceNo, 'استلام', 'grn') || (digits.length >= 3 && r.number.replace(/\D/g, '').endsWith(digits))) add('receipt', r.id, 6); }
  if (want('invoice')) for (const x of invoices(inv)) { const sn = inv.suppliers.find((s) => s.id === x.supplierId)?.name; if (hit(x.number, sn, x.supplierInvoiceNo, 'فاتوره')) add('invoice', x.id, 6); }
  if (want('storeRequest')) for (const s of srs(inv)) if (hit(s.number, 'طلبيه مخزن', inv.warehouses.find((w) => w.id === s.warehouseId)?.name)) add('storeRequest', s.id, 6);
  if (want('order')) for (const o of db.orders) { if (branchOf(ctx) && o.branchId !== branchOf(ctx) && ctx.query.branchId !== 'ALL') continue; if ((digits.length >= 1 && (o.number === digits || o.number.replace(/^0+/, '') === digits.replace(/^0+/, ''))) || hit(`#${o.number}`, o.customerName, o.customerPhone)) add('order', o.id, 5 + (o.number.replace(/^0+/, '') === digits.replace(/^0+/, '') ? 4 : 0)); }
  if (want('customer')) for (const c of db.customers ?? []) { if (c.mergedInto) continue; if (hit(c.name, c.code) || (digits.length >= 4 && (c.phone.replace(/\D/g, '').includes(digits) || (c.altPhone ?? '').replace(/\D/g, '').includes(digits)))) add('customer', c.id, 7); }
  if (want('person')) for (const u of db.users) if (u.active && hit(userName(db, u.id), u.displayName)) add('person', u.id, 4);
  const counts: Record<string, number> = {};
  for (const r of out) counts[r.type] = (counts[r.type] ?? 0) + 1;
  out.sort((a, b) => b.score - a.score);
  const per: Record<string, number> = {};
  const limited = out.filter((r) => { per[r.type] = (per[r.type] ?? 0) + 1; return per[r.type] <= (only ? 30 : 6); }).slice(0, 40);
  return { q: raw, counts, items: limited.map((r) => statusOf(ctx, r.type, r.id)) };
}

export const item360Handlers: Record<string, Handler> = {
  'Item.Lifecycle': (ctx) => lifecycle(ctx),
  'Search.Global': (ctx) => search(ctx),
  'Search.Status': (ctx) => {
    const refs = String(ctx.query.refs ?? '').split(',').filter(Boolean).slice(0, 40);
    return { items: refs.map((r) => { const [type, ...rest] = r.split(':'); const id = rest.join(':'); return canType(ctx, type as RefType) ? statusOf(ctx, type as RefType, id) : { type, id, title: L2('—', '—'), sub: null, status: { text: L2('غير مسموح لهذا الحساب بعرضها', 'Not allowed for this account'), tone: 'neutral' }, missing: true }; }) };
  },
};

export { statusOf, soldOf, invoiceView, receiptView };
