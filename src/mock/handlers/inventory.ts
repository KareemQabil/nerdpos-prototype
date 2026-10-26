// Inventory & purchasing: warehouses, items, on-hand, adjustments, low stock, expiry, movements, counts, transfers,
// waste, customer returns, recipes & costing, production, suppliers, purchase orders, goods receipts, supplier returns,
// and the sales consumer (recipes consumed from the branch sales warehouse when an order is confirmed).
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { policy } from '../policies';
import { clock, zonedParts } from '../clock';
import { D, m4, Decimal } from '../money';
import { checkVersion, need, page, userName } from './util';
import type { DB, Order, OrderLine, Channel } from '../types';
import type {
  InvItem, Warehouse, StockMovement, StockCount, Transfer, Recipe, RecipeVersion, PurchaseOrder, GoodsReceipt, WasteReason, AdjustmentReason,
  MovementKind, OrderEffect, InventoryState,
} from '../types-inventory';
import {
  invOf, qn, newId, nextNumber, toStockQty, checkPrecision, isQty, getItem, getWarehouse, balanceOf, onHand, totalOnHand, salesWarehouse, post,
  activeVersion, menuRecipeOf, versionNeeds, explodeProduct, itemUnitCost, versionCost, netPrice, foodCostBand, nameOf, unitCode, type Actor,
} from './inventory-engine';

export const WASTE_REASONS: WasteReason[] = ['BURNT', 'EXPIRED', 'DROPPED', 'SPOILED', 'PREP_ERROR', 'OVER_PRODUCTION', 'OTHER'];
export const ADJUST_REASONS: AdjustmentReason[] = ['FOUND', 'LOST', 'DAMAGED', 'CORRECTION', 'OPENING', 'STAFF_USE', 'TASTING', 'OTHER'];
const INFLOW: MovementKind[] = ['OPENING', 'RECEIPT', 'SALE_REVERSAL', 'TRANSFER_IN', 'PRODUCTION_IN', 'CUSTOMER_RETURN'];

const actor = (ctx: Ctx, grantId?: string | null): Actor => ({ userId: ctx.user?.id ?? null, nowMs: ctx.now, commandId: ctx.commandId, grantId: grantId ?? null });
const src = (ctx: Ctx, module: string, id: string, number?: string, extra: Record<string, string> = {}) => ({ module, command: ctx.op.id, id, number, ...extra });
const bool = (v: unknown) => v === true || v === 'true';
const reqBool = (ctx: Ctx, f: string) => { if (typeof ctx.body?.[f] !== 'boolean') throw new ApiError('VALIDATION_FAILED', { field: f, rule: 'required boolean' }); return ctx.body[f] as boolean; };
const reqText = (ctx: Ctx, f: string, max = 200) => {
  const v = ctx.body?.[f];
  if (typeof v !== 'string' || !v.trim()) throw new ApiError('VALIDATION_FAILED', { field: f, rule: 'required' });
  if (v.length > max) throw new ApiError('VALIDATION_FAILED', { field: f, rule: `max ${max} characters` });
  return v.trim();
};
const posQty = (v: unknown, field: string) => {
  if (!isQty(v) || !D(v as string).gt(0)) throw new ApiError('VALIDATION_FAILED', { field, rule: 'positive quantity', value: v as any });
  return qn(v as string);
};
const money = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d+(\.\d{1,4})?$/.test(String(v))) throw new ApiError('VALIDATION_FAILED', { field, rule: 'money ≥ 0 with up to 4 decimals' });
  return m4(String(v));
};
/** Cairo calendar date YYYY-MM-DD (expiry dates and day buckets). */
export const ymd = (ms: number) => { const p = zonedParts(ms, 'Africa/Cairo'); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };

// ───────── views
function warehouseOf(db: DB, id: string) { return invOf(db).warehouses.find((w) => w.id === id); }
function whBrief(db: DB, id: string) {
  const w = warehouseOf(db, id);
  return w ? { id: w.id, name: w.name, branchId: w.branchId, branchName: db.branches.find((b) => b.id === w.branchId)?.name ?? w.branchId, kind: w.kind } : { id, name: id, branchId: '', branchName: '', kind: 'STORE' };
}
function itemBrief(db: DB, it: InvItem) {
  return { id: it.id, name: it.name, sku: it.sku, category: it.category, kind: it.kind, stockUnitId: it.stockUnitId, unit: unitCode(db, it.stockUnitId), avgCost: it.avgCost, packs: it.packs, purchasePackId: it.purchasePackId, trackLots: it.trackLots };
}
function warehouseView(db: DB, w: Warehouse) {
  const inv = invOf(db);
  const bals = inv.balances.filter((b) => b.warehouseId === w.id && !D(b.quantity).isZero());
  const value = bals.reduce((a, b) => a.plus(D(b.quantity).times(inv.items.find((i) => i.id === b.itemId)?.avgCost ?? 0)), D(0));
  const low = inv.items.filter((i) => i.active && i.levels[w.id] && D(onHand(inv, i.id, w.id)).lte(i.levels[w.id].min)).length;
  return { ...w, branchName: db.branches.find((b) => b.id === w.branchId)?.name ?? w.branchId, itemCount: bals.length, stockValue: m4(value), lowCount: low, negativeCount: bals.filter((b) => D(b.quantity).lt(0)).length };
}
function levelState(inv: InventoryState, it: InvItem, whId: string) {
  const lv = it.levels[whId];
  const q = D(onHand(inv, it.id, whId));
  if (q.lt(0)) return 'NEGATIVE';
  if (!lv) return 'NO_LEVEL';
  if (q.lte(lv.min)) return q.isZero() ? 'OUT' : 'LOW';
  return 'OK';
}
function movementView(db: DB, m: StockMovement) {
  const it = invOf(db).items.find((i) => i.id === m.itemId);
  return { ...m, item: it ? itemBrief(db, it) : { id: m.itemId, name: { ar: m.itemId, en: m.itemId } }, warehouse: whBrief(db, m.warehouseId), userName: m.userId ? userName(db, m.userId) : null };
}
function branchScope(ctx: Ctx): string | null {
  const b = ctx.query.branchId;
  if (b === 'ALL') return null;
  return b || ctx.branchId || null;
}
function warehousesIn(db: DB, branchId: string | null) { return invOf(db).warehouses.filter((w) => !branchId || w.branchId === branchId); }

// ───────── purchase order derived quantities
function poReceived(db: DB, po: PurchaseOrder) {
  const out = new Map<string, Decimal>();
  for (const r of invOf(db).receipts) {
    if (r.purchaseOrderId !== po.id || r.state !== 'POSTED') continue;
    for (const l of r.lines) if (l.poLineId) out.set(l.poLineId, (out.get(l.poLineId) ?? D(0)).plus(l.quantity));
  }
  return out;
}
function poView(db: DB, po: PurchaseOrder) {
  const inv = invOf(db);
  const rec = poReceived(db, po);
  const lines = po.lines.map((l) => {
    const it = inv.items.find((i) => i.id === l.itemId);
    const orderedStock = D(l.orderedQuantity).times(l.factor);
    const received = rec.get(l.id) ?? D(0);
    const outstanding = ['CLOSED', 'CANCELLED'].includes(po.state) ? D(0) : Decimal.max(orderedStock.minus(received), 0);
    return { ...l, item: it ? itemBrief(db, it) : null, orderedStockQuantity: qn(orderedStock), receivedQuantity: qn(received), outstandingQuantity: qn(outstanding), lineTotal: m4(D(l.orderedQuantity).times(l.orderedUnitCost)) };
  });
  const supplier = inv.suppliers.find((s) => s.id === po.supplierId);
  return {
    ...po, lines, supplierName: supplier?.name ?? po.supplierId, warehouse: whBrief(db, po.warehouseId),
    total: m4(lines.reduce((a, l) => a.plus(l.lineTotal), D(0))),
    receivedValue: m4(inv.receipts.filter((r) => r.purchaseOrderId === po.id && r.state === 'POSTED').reduce((a, r) => a.plus(r.total), D(0))),
    receiptIds: inv.receipts.filter((r) => r.purchaseOrderId === po.id).map((r) => r.id),
    createdByName: userName(db, po.createdBy),
  };
}
function refreshPoState(db: DB, po: PurchaseOrder) {
  if (['DRAFT', 'CLOSED', 'CANCELLED'].includes(po.state)) return;
  const rec = poReceived(db, po);
  const any = [...rec.values()].some((v) => v.gt(0));
  const all = po.lines.every((l) => (rec.get(l.id) ?? D(0)).gte(D(l.orderedQuantity).times(l.factor)));
  po.state = all ? 'RECEIVED' : any ? 'PARTIALLY_RECEIVED' : 'ISSUED';
}

function receiptView(db: DB, r: GoodsReceipt) {
  const inv = invOf(db);
  return {
    ...r, supplierName: inv.suppliers.find((s) => s.id === r.supplierId)?.name ?? r.supplierId, warehouse: whBrief(db, r.warehouseId),
    purchaseOrderNumber: r.purchaseOrderId ? inv.purchaseOrders.find((p) => p.id === r.purchaseOrderId)?.number ?? null : null,
    lines: r.lines.map((l) => ({ ...l, item: (() => { const it = inv.items.find((i) => i.id === l.itemId); return it ? itemBrief(db, it) : null; })() })),
    userName: r.userId ? userName(db, r.userId) : null,
    returnedValue: m4(inv.supplierReturns.filter((s) => s.receiptId === r.id).reduce((a, s) => a.plus(s.total), D(0))),
  };
}

function countView(db: DB, c: StockCount, withLines = true) {
  const inv = invOf(db);
  const lines = withLines ? c.lines.map((l) => {
    const it = inv.items.find((i) => i.id === l.itemId);
    const since = inv.movements.filter((m) => m.itemId === l.itemId && m.warehouseId === c.warehouseId && m.seq > l.baselineSeq && m.kind !== 'COUNT_VARIANCE').reduce((a, m) => a.plus(m.quantity), D(0));
    const expected = c.state === 'POSTED' && l.expectedQty !== undefined ? D(l.expectedQty) : D(l.baselineQty).plus(since);
    const cost = c.state === 'POSTED' && l.unitCost ? D(l.unitCost) : D(it?.avgCost ?? 0);
    const variance = l.countedQty === null ? null : D(l.countedQty).minus(expected);
    return { ...l, item: it ? itemBrief(db, it) : null, movementsSinceStart: qn(since), expectedQty: qn(expected), varianceQty: variance ? qn(variance) : null, varianceValue: variance ? m4(variance.times(cost)) : null, unitCost: m4(cost), countedByName: l.countedBy ? userName(db, l.countedBy) : null };
  }) : [];
  const counted = c.lines.filter((l) => l.countedQty !== null).length;
  return {
    ...c, lines, warehouse: whBrief(db, c.warehouseId), lineCount: c.lines.length, countedCount: counted, startedByName: userName(db, c.startedBy),
    previewVarianceValue: withLines ? m4(lines.reduce((a, l) => a.plus(l.varianceValue ?? 0), D(0))) : null,
    previewAbsVarianceValue: withLines ? m4(lines.reduce((a, l) => a.plus(D(l.varianceValue ?? 0).abs()), D(0))) : null,
  };
}

function transferView(db: DB, t: Transfer) {
  const inv = invOf(db);
  return {
    ...t, from: whBrief(db, t.fromWarehouseId), to: whBrief(db, t.toWarehouseId),
    lines: t.lines.map((l) => ({ ...l, item: (() => { const it = inv.items.find((i) => i.id === l.itemId); return it ? itemBrief(db, it) : null; })(), value: l.unitCost ? m4(D(l.quantity).times(l.unitCost)) : null })),
    value: m4(t.lines.reduce((a, l) => a.plus(D(l.quantity).times(l.unitCost ?? inv.items.find((i) => i.id === l.itemId)?.avgCost ?? 0)), D(0))),
    createdByName: userName(db, t.createdBy), dispatchedByName: t.dispatchedBy ? userName(db, t.dispatchedBy) : null, receivedByName: t.receivedBy ? userName(db, t.receivedBy) : null,
  };
}

function recipeOutputName(db: DB, r: Recipe) {
  if (r.outputKind === 'MODIFIER') {
    const opt = db.modifierGroups.flatMap((g) => g.options).find((o) => o.id === r.modifierOptionId);
    const p = r.appliesToProductId ? db.products.find((x) => x.id === r.appliesToProductId) : null;
    return { ar: `${opt?.name.ar ?? r.modifierOptionId}${p ? ' — ' + p.name.ar : ''}`, en: `${opt?.name.en ?? r.modifierOptionId}${p ? ' — ' + p.name.en : ''}` };
  }
  return nameOf(db, r.outputProductId);
}
function recipeCost(db: DB, r: Recipe, v: RecipeVersion, branchId: string | null, atMs: number) {
  const c = versionCost(db, v);
  const prices: { channel: Channel; net: string | null; foodCostPercent: string | null; band: string }[] = [];
  if (r.outputKind === 'MENU' && branchId) {
    for (const ch of ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as Channel[]) {
      const net = netPrice(db, r.outputProductId, branchId, ch, atMs);
      if (!net) continue;
      const pct = D(net).isZero() ? null : c.perUnit.times(100).dividedBy(net);
      prices.push({ channel: ch, net, foodCostPercent: pct ? pct.toDecimalPlaces(1).toFixed(1) : null, band: foodCostBand(pct) });
    }
  }
  const main = prices.find((p) => p.channel === 'DINE_IN') ?? prices[0] ?? null;
  return { ...c, perUnit: m4(c.perUnit), prices, foodCostPercent: main?.foodCostPercent ?? null, band: main?.band ?? 'UNKNOWN' };
}
function recipeView(db: DB, r: Recipe, branchId: string | null, atMs: number, full = false) {
  const v = activeVersion(r, atMs);
  const outItem = invOf(db).items.find((i) => i.id === r.outputProductId);
  return {
    id: r.id, outputProductId: r.outputProductId, outputKind: r.outputKind, modifierOptionId: r.modifierOptionId, appliesToProductId: r.appliesToProductId,
    name: recipeOutputName(db, r), outputUnit: outItem ? unitCode(db, outItem.stockUnitId) : null, activeVersionId: v.id, activeVersion: { ...v, inputsPerBatch: v.inputsPerBatch.map((i) => ({ ...i, name: nameOf(db, i.itemId) })) },
    versionCount: r.versions.length, version: r.version, createdAt: r.createdAt,
    cost: recipeCost(db, r, v, branchId, atMs),
    versions: full ? r.versions.map((x) => ({ ...x, createdByName: userName(db, x.createdBy), cost: versionCost(db, x).total })) : undefined,
  };
}

// ───────── sales consumer
function kitchenStarted(db: DB, lineId: string) {
  return db.tickets.some((t) => t.items.some((i) => i.lineId === lineId) && (t.state !== 'NEW' || !!t.startedAt));
}
function lineNeeds(db: DB, l: OrderLine, atMs: number) {
  // a size scales the recipe like it scales the modifiers (the recipe is written for the standard size)
  const size = l.variant ? db.products.find((p) => p.id === l.productId)?.variants?.find((v) => v.id === l.variant!.id)?.modifierMultiplier ?? '1' : '1';
  const { needs, recipeFound } = explodeProduct(db, l.productId, D(l.quantity).times(size), l.modifiers.map((m) => m.optionId), atMs);
  let found = recipeFound;
  for (const c of l.children ?? []) {
    if (!c.productId) continue;
    const share = c.kind === 'HALF' ? D(l.quantity).times('0.5') : D(l.quantity);
    const sub = explodeProduct(db, c.productId, share, [], atMs);
    sub.needs.forEach((v, k) => needs.set(k, (needs.get(k) ?? D(0)).plus(v)));
    found = found || sub.recipeFound;
  }
  return { needs, found };
}

/**
 * The inventory.order-changed consumer, called after every order mutation. Idempotent reconciliation per line:
 * ACTIVE line on a consumed order → SALE; line voided after the kitchen started → WASTE (LineVoidDispositionPolicy);
 * anything else → NONE. Consumption timing follows InventoryEffectTimingPolicy (ON_CONFIRM by default).
 * A sale is never refused for stock: it may take a balance below zero and the movement is flagged.
 */
export function inventoryOnOrderChange(ctx: Ctx, order: Order) {
  const db = ctx.db;
  const inv = (db as any).inv as InventoryState | undefined;
  if (!inv || !inv.warehouses.length) return;
  try {
    const timing = policy<string>('InventoryEffectTimingPolicy', { branchId: order.branchId }) ?? 'ON_CONFIRM';
    const consumed = timing === 'ON_COMPLETE' ? order.status === 'COMPLETED' : order.status === 'CONFIRMED' || order.status === 'COMPLETED';
    const disp = policy<{ beforeKitchenStart: string; afterKitchenStart: string }>('LineVoidDispositionPolicy') ?? { beforeKitchenStart: 'NOT_PREPARED', afterKitchenStart: 'WASTE' };
    const a = actor(ctx);
    for (const l of order.lines) {
      const key = `${order.id}:${l.id}`;
      const prev: OrderEffect | undefined = inv.orderEffects[key];
      if (prev && (prev.state === 'WASTE' || (l.status === 'VOIDED' && prev.note === 'FINAL'))) continue;
      let want: OrderEffect['state'] = 'NONE';
      if (order.status === 'CANCELLED') want = 'NONE';
      else if (l.status === 'ACTIVE') want = consumed ? 'SALE' : 'NONE';
      else if (l.status === 'VOIDED' && l.fireRound !== null) {
        const d = l.voided?.disposition;
        const started = d === 'WASTE' ? true : d === 'NOT_PREPARED' ? false : kitchenStarted(db, l.id);
        const outcome = d === 'WASTE' || d === 'NOT_PREPARED' ? d : started ? disp.afterKitchenStart : disp.beforeKitchenStart;
        want = outcome === 'WASTE' ? 'WASTE' : 'NONE';
      }
      const have = prev?.state === 'SKIPPED' ? 'NONE' : prev?.state ?? 'NONE';
      if (want === have) {
        if (l.status === 'VOIDED' && prev) prev.note = 'FINAL';
        continue;
      }
      const wh = prev?.warehouseId ? warehouseOf(db, prev.warehouseId) ?? null : salesWarehouse(db, order.branchId);
      const effect: OrderEffect = prev ?? { orderId: order.id, lineId: l.id, state: 'NONE', warehouseId: null, movementIds: [], at: ctx.nowIso };
      const label = `${order.number} · ${l.name.ar}`;
      const source = { module: 'orders', command: ctx.op.id, id: order.id, number: order.number, orderId: order.id, lineId: l.id, label };
      if (have === 'SALE') {
        // undo the consumption exactly (same quantities and costs)
        for (const id of effect.movementIds) {
          const m = inv.movements.find((x) => x.id === id && x.kind === 'SALE');
          if (!m) continue;
          const back = post(db, a, { itemId: m.itemId, warehouseId: m.warehouseId, kind: 'SALE_REVERSAL', quantity: D(m.quantity).negated(), unitCost: m.unitCost, source, reason: want === 'WASTE' ? 'VOID_AFTER_KITCHEN_START' : 'VOID_BEFORE_KITCHEN_START', negative: 'ALLOW' });
          effect.movementIds.push(back.id);
          if (want === 'WASTE') effect.movementIds.push(post(db, a, { itemId: m.itemId, warehouseId: m.warehouseId, kind: 'VOID_WASTE', quantity: m.quantity, unitCost: m.unitCost, source, reason: 'VOID_AFTER_KITCHEN_START', negative: 'ALLOW' }).id);
        }
        effect.state = want;
      } else {
        if (!wh) { effect.state = 'SKIPPED'; effect.note = 'SALES_WAREHOUSE_NOT_CONFIGURED'; inv.orderEffects[key] = effect; continue; }
        const { needs, found } = lineNeeds(db, l, ctx.now);
        effect.warehouseId = wh.id;
        for (const [itemId, q] of needs) {
          if (!inv.items.find((i) => i.id === itemId)) continue;
          const mv = post(db, a, { itemId, warehouseId: wh.id, kind: want === 'WASTE' ? 'VOID_WASTE' : 'SALE', quantity: q.negated(), source, reason: want === 'WASTE' ? 'VOID_AFTER_KITCHEN_START' : null, negative: 'ALLOW' });
          effect.movementIds.push(mv.id);
        }
        effect.state = want;
        if (!found) effect.note = 'NO_RECIPE';
      }
      if (l.status === 'VOIDED') effect.note = 'FINAL';
      effect.at = ctx.nowIso;
      inv.orderEffects[key] = effect;
    }
  } catch (e) {
    // the sale is already decided; a stock problem never refuses it
    console.error('inventory consumer', e);
  }
}

// ───────── handlers
export const inventoryHandlers: Record<string, Handler> = {
  // Warehouses
  'Warehouse.List': (ctx) => {
    const inv = invOf(ctx.db);
    let list = inv.warehouses;
    if (ctx.query.branchId && ctx.query.branchId !== 'ALL') list = list.filter((w) => w.branchId === ctx.query.branchId);
    if (ctx.query.active !== undefined) list = list.filter((w) => w.active === bool(ctx.query.active));
    return page(list.map((w) => warehouseView(ctx.db, w)), ctx.query);
  },
  'Warehouse.Get': (ctx) => {
    const w = getWarehouse(ctx.db, ctx.params.warehouseId);
    const inv = invOf(ctx.db);
    const balances = inv.balances.filter((b) => b.warehouseId === w.id && !D(b.quantity).isZero()).map((b) => {
      const it = inv.items.find((i) => i.id === b.itemId)!;
      return { ...b, item: itemBrief(ctx.db, it), value: m4(D(b.quantity).times(it.avgCost)), level: it.levels[w.id] ?? null, levelState: levelState(inv, it, w.id) };
    });
    return { ...warehouseView(ctx.db, w), balances };
  },
  'Warehouse.Configure': (ctx) => {
    const inv = invOf(ctx.db);
    const name = reqText(ctx, 'name', 80);
    const active = reqBool(ctx, 'active');
    const branch = ctx.db.branches.find((b) => b.id === ctx.body.branchId);
    if (!branch) throw new ApiError('BRANCH_NOT_FOUND', { branchId: ctx.body.branchId });
    const kind = ['STORE', 'KITCHEN', 'BAR'].includes(ctx.body.kind) ? ctx.body.kind : undefined;
    let w = inv.warehouses.find((x) => x.id === ctx.params.warehouseId);
    if (inv.warehouses.some((x) => x.id !== ctx.params.warehouseId && x.branchId === branch.id && x.name.trim() === name)) throw new ApiError('VALIDATION_FAILED', { field: 'name', rule: 'another warehouse in this branch has this name' });
    if (!w) {
      if (!/^[A-Za-z0-9_-]{2,64}$/.test(ctx.params.warehouseId)) throw new ApiError('VALIDATION_FAILED', { field: 'warehouseId', rule: 'id: letters, digits, - and _' });
      const first = !inv.warehouses.some((x) => x.branchId === branch.id && x.active && x.salesDefault);
      w = { id: ctx.params.warehouseId, branchId: branch.id, name, kind: kind ?? 'STORE', active, salesDefault: first && active, version: 1, createdAt: ctx.nowIso, history: [{ at: ctx.nowIso, by: ctx.user!.id, text: first && active ? 'created — sales warehouse of the branch (first one)' : 'created' }] };
      inv.warehouses.push(w);
      ctx.audit(`warehouse ${name} created`, w.id);
      return { status: 201, body: warehouseView(ctx.db, w) };
    }
    if (ctx.body.expectedVersion !== undefined && ctx.body.expectedVersion !== null) checkVersion(w, ctx.body.expectedVersion);
    if (w.branchId !== branch.id && inv.balances.some((b) => b.warehouseId === w!.id && !D(b.quantity).isZero())) throw new ApiError('VALIDATION_FAILED', { field: 'branchId', rule: 'a warehouse holding stock cannot move to another branch' });
    if (!active && w.active) {
      if (w.salesDefault) throw new ApiError('VALIDATION_FAILED', { field: 'active', rule: 'make another warehouse the sales warehouse first' });
      if (inv.balances.some((b) => b.warehouseId === w!.id && !D(b.quantity).isZero())) throw new ApiError('VALIDATION_FAILED', { field: 'active', rule: 'warehouse still holds stock — transfer it or count it to zero first' });
    }
    const changes: string[] = [];
    if (w.name !== name) changes.push(`name ${w.name} → ${name}`);
    if (w.active !== active) changes.push(active ? 'reactivated' : 'deactivated');
    if (kind && w.kind !== kind) changes.push(`kind ${w.kind} → ${kind}`);
    if (w.branchId !== branch.id) changes.push(`branch ${w.branchId} → ${branch.id}`);
    Object.assign(w, { name, active, branchId: branch.id, kind: kind ?? w.kind });
    w.version++;
    w.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: changes.join('; ') || 'saved' });
    ctx.audit(`warehouse ${name} configured`, w.id);
    return warehouseView(ctx.db, w);
  },
  'Warehouse.SetSalesDefault': (ctx) => {
    const w = getWarehouse(ctx.db, ctx.params.warehouseId);
    checkVersion(w, ctx.body.expectedVersion);
    if (!w.active) throw new ApiError('WAREHOUSE_INACTIVE', { warehouseId: w.id });
    for (const other of invOf(ctx.db).warehouses.filter((x) => x.branchId === w.branchId && x.salesDefault && x.id !== w.id)) {
      other.salesDefault = false; other.version++; other.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `no longer the sales warehouse (→ ${w.name})` });
    }
    if (!w.salesDefault) { w.salesDefault = true; w.version++; w.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: 'set as the sales warehouse of the branch' }); }
    ctx.audit(`sales warehouse ${w.name}`, w.id);
    return warehouseView(ctx.db, w);
  },

  // Items
  'InventoryItem.Find': (ctx) => {
    const inv = invOf(ctx.db);
    const scope = branchScope(ctx);
    const whs = ctx.query.warehouseId ? [getWarehouse(ctx.db, ctx.query.warehouseId)] : warehousesIn(ctx.db, scope);
    const text = (ctx.query.text ?? '').trim().toLowerCase();
    let items = inv.items;
    if (ctx.query.active !== undefined) items = items.filter((i) => i.active === bool(ctx.query.active));
    if (ctx.query.category) items = items.filter((i) => i.category === ctx.query.category);
    if (ctx.query.kind) items = items.filter((i) => i.kind === ctx.query.kind);
    if (text) items = items.filter((i) => `${i.name.ar} ${i.name.en} ${i.sku}`.toLowerCase().includes(text));
    const usedIn = new Map<string, number>();
    for (const r of inv.recipes) for (const i of activeVersion(r).inputsPerBatch) usedIn.set(i.itemId, (usedIn.get(i.itemId) ?? 0) + 1);
    let rows = items.map((it) => {
      const stock = whs.map((w) => ({ warehouseId: w.id, warehouseName: w.name, quantity: onHand(inv, it.id, w.id), level: it.levels[w.id] ?? null, state: levelState(inv, it, w.id) }));
      const total = stock.reduce((a, s) => a.plus(s.quantity), D(0));
      const states = stock.map((s) => s.state);
      const worst = states.includes('NEGATIVE') ? 'NEGATIVE' : states.includes('OUT') ? 'OUT' : states.includes('LOW') ? 'LOW' : states.includes('OK') ? 'OK' : 'NO_LEVEL';
      const lots = inv.lots.filter((l) => l.itemId === it.id && D(l.remaining).gt(0) && whs.some((w) => w.id === l.warehouseId) && l.expiryDate);
      const nextExpiry = lots.map((l) => l.expiryDate!).sort()[0] ?? null;
      return { ...itemBrief(ctx.db, it), productId: it.productId, active: it.active, version: it.version, lastCost: it.lastCost, allowNegative: it.allowNegative, defaultSupplierId: it.defaultSupplierId, shelfLifeDays: it.shelfLifeDays, stock, totalQuantity: qn(total), value: m4(total.times(it.avgCost)), state: worst, usedInRecipes: usedIn.get(it.id) ?? 0, nextExpiry };
    });
    if (ctx.query.state) rows = rows.filter((r) => ctx.query.state.split(',').includes(r.state));
    rows.sort((a, b) => a.category.localeCompare(b.category) || a.name.ar.localeCompare(b.name.ar));
    const categories = [...new Set(inv.items.map((i) => i.category))];
    return { ...page(rows, ctx.query), categories, warehouses: whs.map((w) => ({ id: w.id, name: w.name, branchId: w.branchId, salesDefault: w.salesDefault })) };
  },
  'InventoryItem.Get': (ctx) => {
    const it = getItem(ctx.db, ctx.params.inventoryItemId);
    const inv = invOf(ctx.db);
    const balances = inv.warehouses.map((w) => ({ warehouse: whBrief(ctx.db, w.id), active: w.active, salesDefault: w.salesDefault, quantity: onHand(inv, it.id, w.id), version: inv.balances.find((x) => x.itemId === it.id && x.warehouseId === w.id)?.version ?? 0, level: it.levels[w.id] ?? null, state: levelState(inv, it, w.id), value: m4(D(onHand(inv, it.id, w.id)).times(it.avgCost)) }));
    const lots = inv.lots.filter((l) => l.itemId === it.id && D(l.remaining).gt(0)).sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999')).map((l) => ({ ...l, warehouse: whBrief(ctx.db, l.warehouseId) }));
    const whereUsed = inv.recipes.filter((r) => activeVersion(r).inputsPerBatch.some((i) => i.itemId === it.id)).map((r) => {
      const v = activeVersion(r);
      const line = v.inputsPerBatch.find((i) => i.itemId === it.id)!;
      return { recipeId: r.id, kind: r.outputKind, name: recipeOutputName(ctx.db, r), quantity: line.quantity, enteredQuantity: line.enteredQuantity, enteredUnit: line.enteredUnit, perBatch: v.outputQuantityPerBatch };
    });
    const producedBy = inv.recipes.find((r) => r.outputKind === 'PREP' && r.outputProductId === it.id)?.id ?? null;
    const movements = inv.movements.filter((m) => m.itemId === it.id).slice(-40).reverse().map((m) => movementView(ctx.db, m));
    const supplier = it.defaultSupplierId ? inv.suppliers.find((s) => s.id === it.defaultSupplierId) : null;
    return { ...it, unit: unitCode(ctx.db, it.stockUnitId), balances, lots, whereUsed, producedBy, movements, totalQuantity: qn(totalOnHand(inv, it.id)), defaultSupplierName: supplier?.name ?? null, theoreticalCost: m4(itemUnitCost(ctx.db, it)) };
  },
  'InventoryItem.Configure': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const id = ctx.params.inventoryItemId;
    const active = reqBool(ctx, 'active');
    const b = ctx.body;
    if (!b.productId) throw new ApiError('VALIDATION_FAILED', { field: 'productId', rule: 'required' });
    if (b.productId !== id && !db.products.some((p) => p.id === b.productId)) throw new ApiError('PRODUCT_NOT_FOUND', { productId: b.productId });
    if (!db.units.some((u) => u.id === b.stockUnitId)) throw new ApiError('UNIT_NOT_FOUND', { unitId: b.stockUnitId });
    if (b.allowNegative !== undefined && b.allowNegative !== null && typeof b.allowNegative !== 'boolean') throw new ApiError('VALIDATION_FAILED', { field: 'allowNegative' });
    const packs = Array.isArray(b.packs) ? b.packs.map((p: any, i: number) => {
      if (!p?.name?.ar?.trim?.()) throw new ApiError('VALIDATION_FAILED', { field: `packs[${i}].name`, rule: 'required' });
      return { id: p.id || `pk_${id}_${i + 1}`, name: { ar: p.name.ar.trim(), en: (p.name.en ?? '').trim() || p.name.ar.trim() }, factor: posQty(p.factor, `packs[${i}].factor`) };
    }) : undefined;
    let it = inv.items.find((x) => x.id === id);
    if (b.productId !== id && inv.items.some((x) => x.id !== id && x.productId === b.productId)) throw new ApiError('VALIDATION_FAILED', { field: 'productId', rule: 'this product already has a stock item' });
    if (b.defaultSupplierId && !inv.suppliers.some((s) => s.id === b.defaultSupplierId)) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: b.defaultSupplierId });
    const kind = ['RAW', 'PREP', 'RESALE'].includes(b.kind) ? b.kind : undefined;
    if (!it) {
      if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new ApiError('VALIDATION_FAILED', { field: 'inventoryItemId', rule: 'id: letters, digits, - and _' });
      const product = db.products.find((p) => p.id === b.productId);
      const nameAr = (b.name?.ar ?? product?.name.ar ?? '').trim();
      if (!nameAr) throw new ApiError('VALIDATION_FAILED', { field: 'name', rule: 'required for a new stock item' });
      it = {
        id, productId: b.productId, sku: (b.sku ?? '').trim() || id.toUpperCase(), name: { ar: nameAr, en: (b.name?.en ?? product?.name.en ?? '').trim() || nameAr },
        category: (b.category ?? '').trim() || 'أخرى', kind: kind ?? (product ? 'RESALE' : 'RAW'), stockUnitId: b.stockUnitId, packs: packs ?? [], purchasePackId: b.purchasePackId ?? null,
        allowNegative: b.allowNegative ?? null, active, trackLots: !!b.trackLots, shelfLifeDays: b.shelfLifeDays ? Number(b.shelfLifeDays) : null, defaultSupplierId: b.defaultSupplierId ?? null,
        avgCost: money(b.standardCost, 'standardCost') ?? m4(0), lastCost: money(b.standardCost, 'standardCost') ?? m4(0), costHistory: [], levels: {}, version: 1, createdAt: ctx.nowIso,
      };
      if (it.purchasePackId && !it.packs.some((p) => p.id === it!.purchasePackId)) it.purchasePackId = null;
      if (!it.purchasePackId && it.packs.length) it.purchasePackId = it.packs[0].id;
      inv.items.push(it);
      ctx.audit(`stock item ${nameAr} created`, id);
      return { status: 201, body: { ...it, unit: unitCode(db, it.stockUnitId) } };
    }
    if (b.expectedVersion !== undefined && b.expectedVersion !== null) checkVersion(it, b.expectedVersion);
    if (b.stockUnitId !== it.stockUnitId && inv.movements.some((m) => m.itemId === it!.id)) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, stockUnitId: it.stockUnitId, requested: b.stockUnitId, rule: 'the stock unit is fixed once the item has movements' });
    if (b.productId !== it.productId && inv.movements.some((m) => m.itemId === it!.id)) throw new ApiError('VALIDATION_FAILED', { field: 'productId', rule: 'the product link is fixed once the item has movements' });
    Object.assign(it, {
      productId: b.productId, stockUnitId: b.stockUnitId, active, allowNegative: b.allowNegative === undefined ? it.allowNegative : b.allowNegative,
      ...(b.name?.ar?.trim() ? { name: { ar: b.name.ar.trim(), en: (b.name.en ?? '').trim() || b.name.ar.trim() } } : {}),
      ...(b.sku !== undefined && String(b.sku).trim() ? { sku: String(b.sku).trim() } : {}),
      ...(b.category !== undefined && String(b.category).trim() ? { category: String(b.category).trim() } : {}),
      ...(kind ? { kind } : {}),
      ...(packs ? { packs } : {}),
      ...(b.purchasePackId !== undefined ? { purchasePackId: b.purchasePackId || null } : {}),
      ...(b.trackLots !== undefined ? { trackLots: !!b.trackLots } : {}),
      ...(b.shelfLifeDays !== undefined ? { shelfLifeDays: b.shelfLifeDays ? Number(b.shelfLifeDays) : null } : {}),
      ...(b.defaultSupplierId !== undefined ? { defaultSupplierId: b.defaultSupplierId || null } : {}),
    });
    if (it.purchasePackId && !it.packs.some((p) => p.id === it!.purchasePackId)) it.purchasePackId = null;
    if (b.standardCost !== undefined && !inv.movements.some((m) => m.itemId === it!.id)) { const c = money(b.standardCost, 'standardCost'); if (c) { it.avgCost = c; it.lastCost = c; } }
    it.version++;
    ctx.audit(`stock item ${it.name.ar} configured`, it.id);
    return { ...it, unit: unitCode(db, it.stockUnitId) };
  },
  'InventoryItem.SetLevels': (ctx) => {
    const it = getItem(ctx.db, ctx.params.inventoryItemId);
    if (ctx.body.expectedVersion !== undefined && ctx.body.expectedVersion !== null) checkVersion(it, ctx.body.expectedVersion);
    const rows: any[] = Array.isArray(ctx.body.levels) ? ctx.body.levels : [{ warehouseId: ctx.body.warehouseId, minQuantity: ctx.body.minQuantity, parQuantity: ctx.body.parQuantity }];
    need(rows.length, 'VALIDATION_FAILED', { field: 'levels', rule: 'at least one warehouse' });
    for (const [i, r] of rows.entries()) {
      getWarehouse(ctx.db, r.warehouseId);
      if (r.minQuantity === null || r.minQuantity === '' || r.minQuantity === undefined) { delete it.levels[r.warehouseId]; continue; }
      if (!isQty(r.minQuantity) || D(r.minQuantity).lt(0)) throw new ApiError('VALIDATION_FAILED', { field: `levels[${i}].minQuantity`, rule: 'quantity ≥ 0' });
      const par = r.parQuantity === undefined || r.parQuantity === '' || r.parQuantity === null ? D(r.minQuantity).times(2) : D(r.parQuantity);
      if (!isQty(String(par)) || par.lt(r.minQuantity)) throw new ApiError('VALIDATION_FAILED', { field: `levels[${i}].parQuantity`, rule: 'target quantity must be ≥ the minimum' });
      it.levels[r.warehouseId] = { min: qn(r.minQuantity), par: qn(par) };
    }
    it.version++;
    ctx.audit(`levels of ${it.name.ar}`, it.id);
    return { ...it, unit: unitCode(ctx.db, it.stockUnitId) };
  },
  'Inventory.OnHand': (ctx) => {
    if (!ctx.query.inventoryItemId) throw new ApiError('VALIDATION_FAILED', { field: 'inventoryItemId', rule: 'required' });
    if (!ctx.query.warehouseId) throw new ApiError('VALIDATION_FAILED', { field: 'warehouseId', rule: 'required' });
    const it = getItem(ctx.db, ctx.query.inventoryItemId);
    const w = getWarehouse(ctx.db, ctx.query.warehouseId);
    const inv = invOf(ctx.db);
    const b = inv.balances.find((x) => x.itemId === it.id && x.warehouseId === w.id) ?? { quantity: '0', version: 0 };
    return { inventoryItemId: it.id, warehouseId: w.id, quantity: b.quantity, version: b.version, itemVersion: it.version, stockUnitId: it.stockUnitId, unit: unitCode(ctx.db, it.stockUnitId), avgCost: it.avgCost, value: m4(D(b.quantity).times(it.avgCost)), level: it.levels[w.id] ?? null, state: levelState(inv, it, w.id), lots: inv.lots.filter((l) => l.itemId === it.id && l.warehouseId === w.id && D(l.remaining).gt(0)) };
  },
  'Inventory.Adjust': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const it = getItem(db, ctx.body.inventoryItemId, { active: true });
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    if (!db.units.some((u) => u.id === ctx.body.stockUnitId)) throw new ApiError('UNIT_NOT_FOUND', { unitId: ctx.body.stockUnitId });
    if (ctx.body.stockUnitId !== it.stockUnitId) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, stockUnitId: it.stockUnitId, requested: ctx.body.stockUnitId });
    const reason = ctx.body.reason as AdjustmentReason;
    if (!ADJUST_REASONS.includes(reason)) throw new ApiError('VALIDATION_FAILED', { field: 'reason', allowed: ADJUST_REASONS });
    if (reason === 'OTHER' && !(ctx.body.note ?? '').trim()) throw new ApiError('VALIDATION_FAILED', { field: 'note', rule: 'required when the reason is OTHER' });
    if (!isQty(ctx.body.quantityDelta) || D(ctx.body.quantityDelta).isZero()) throw new ApiError('VALIDATION_FAILED', { field: 'quantityDelta', rule: 'non-zero quantity' });
    const delta = qn(ctx.body.quantityDelta);
    checkPrecision(db, it, delta.replace('-', ''), 'quantityDelta');
    if (Number(ctx.body.expectedItemVersion) !== it.version) throw new ApiError('CONCURRENCY_CONFLICT', { field: 'expectedItemVersion', expectedVersion: Number(ctx.body.expectedItemVersion), currentVersion: it.version });
    const bal = balanceOf(inv, it.id, w.id);
    if (ctx.body.expectedVersion === undefined || Number(ctx.body.expectedVersion) !== bal.version) throw new ApiError('CONCURRENCY_CONFLICT', { field: 'expectedVersion', expectedVersion: ctx.body.expectedVersion ?? null, currentVersion: bal.version });
    const unitCost = money(ctx.body.unitCost, 'unitCost');
    const g = ctx.requireApproval({ action: 'INVENTORY_ADJUST', targetType: 'inventory.InventoryItem', targetId: it.id, context: { warehouseId: w.id, quantityDelta: delta, reasonCode: reason }, grantId: ctx.body.approvalGrantId });
    const mv = post(db, actor(ctx, g?.id), { itemId: it.id, warehouseId: w.id, kind: 'ADJUSTMENT', quantity: delta, unitCost: D(delta).gt(0) ? unitCost : null, updateAvg: D(delta).gt(0) && !!unitCost, reason, note: (ctx.body.note ?? '').trim() || null, source: src(ctx, 'inventory', it.id) });
    ctx.audit(`adjust ${it.name.ar} ${delta} @ ${w.name} (${reason})`, it.id, true, g?.id);
    return { movement: movementView(db, mv), onHand: { quantity: mv.balanceAfter, version: balanceOf(inv, it.id, w.id).version } };
  },
  'Inventory.LowStock': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const whs = ctx.query.warehouseId ? [getWarehouse(db, ctx.query.warehouseId)] : warehousesIn(db, branchScope(ctx)).filter((w) => w.active);
    const rows: any[] = [];
    for (const it of inv.items.filter((i) => i.active)) {
      for (const w of whs) {
        const lv = it.levels[w.id];
        if (!lv) continue;
        const q = D(onHand(inv, it.id, w.id));
        if (q.gt(lv.min)) continue;
        const gap = Decimal.max(D(lv.par).minus(q), 0);
        const pack = it.packs.find((p) => p.id === it.purchasePackId) ?? null;
        const packs = pack ? gap.dividedBy(pack.factor).toDecimalPlaces(0, Decimal.ROUND_UP) : null;
        const suggested = pack ? packs!.times(pack.factor) : gap;
        const openPo = inv.purchaseOrders.filter((p) => ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) && p.warehouseId === w.id && p.lines.some((l) => l.itemId === it.id)).map((p) => ({ id: p.id, number: p.number, state: p.state }));
        rows.push({
          item: itemBrief(db, it), warehouse: whBrief(db, w.id), onHand: qn(q), min: lv.min, par: lv.par, state: levelState(inv, it, w.id),
          suggestedQuantity: qn(suggested), suggestedPacks: packs ? qn(packs) : null, pack, unitCost: it.lastCost !== '0.0000' ? it.lastCost : it.avgCost,
          suggestedValue: m4(suggested.times(it.lastCost !== '0.0000' ? it.lastCost : it.avgCost)), defaultSupplierId: it.defaultSupplierId,
          defaultSupplierName: inv.suppliers.find((s) => s.id === it.defaultSupplierId)?.name ?? null, openPurchaseOrders: openPo,
        });
      }
    }
    rows.sort((a, b) => D(a.onHand).dividedBy(D(a.min).isZero() ? 1 : a.min).comparedTo(D(b.onHand).dividedBy(D(b.min).isZero() ? 1 : b.min)));
    return page(rows, ctx.query);
  },
  'Inventory.Expiring': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const days = Math.min(Math.max(Number(ctx.query.days ?? 7) || 7, 0), 365);
    const today = ymd(ctx.now);
    const limit = ymd(ctx.now + days * 86_400_000);
    const whs = ctx.query.warehouseId ? [ctx.query.warehouseId] : warehousesIn(db, branchScope(ctx)).map((w) => w.id);
    const rows = inv.lots
      .filter((l) => l.expiryDate && D(l.remaining).gt(0) && whs.includes(l.warehouseId) && l.expiryDate <= limit && (ctx.query.itemId ? l.itemId === ctx.query.itemId : true))
      .sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!))
      .map((l) => {
        const it = inv.items.find((i) => i.id === l.itemId)!;
        const daysLeft = Math.round((Date.parse(l.expiryDate!) - Date.parse(today)) / 86_400_000);
        return { ...l, item: itemBrief(db, it), warehouse: whBrief(db, l.warehouseId), daysLeft, status: daysLeft < 0 ? 'EXPIRED' : daysLeft === 0 ? 'TODAY' : 'SOON', value: m4(D(l.remaining).times(it.avgCost)) };
      });
    return { ...page(rows, ctx.query), days, today };
  },
  'StockMovement.Get': (ctx) => movementGet(ctx),
  'Movement.Get': (ctx) => movementGet(ctx),
  'Movement.Find': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const q = ctx.query;
    const whs = q.warehouseId ? new Set([q.warehouseId]) : new Set(warehousesIn(db, branchScope(ctx)).map((w) => w.id));
    const kinds = q.kind ? new Set(q.kind.split(',')) : null;
    const from = q.from ? Date.parse(q.from) : null;
    const to = q.to ? Date.parse(q.to) : null;
    const list: StockMovement[] = [];
    for (let i = inv.movements.length - 1; i >= 0; i--) {
      const m = inv.movements[i];
      if (!whs.has(m.warehouseId)) continue;
      if (q.itemId && m.itemId !== q.itemId) continue;
      if (kinds && !kinds.has(m.kind)) continue;
      if (q.orderId && m.source.orderId !== q.orderId) continue;
      if (q.sourceId && m.source.id !== q.sourceId) continue;
      if (from !== null && m.atMs < from) continue;
      if (to !== null && m.atMs > to) continue;
      list.push(m);
    }
    const res = page(list, { ...q, limit: q.limit ?? '100' });
    return { ...res, items: res.items.map((m) => movementView(db, m)) };
  },

  // Stock counts
  'StockCount.Start': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    let ids: string[] = Array.isArray(ctx.body.itemIds) && ctx.body.itemIds.length ? [...new Set<string>(ctx.body.itemIds)] : inv.items.filter((i) => i.active && (inv.balances.some((b) => b.itemId === i.id && b.warehouseId === w.id && (!D(b.quantity).isZero() || b.version > 0)) || i.levels[w.id])).map((i) => i.id);
    ids = ids.filter((id) => { getItem(db, id); return true; });
    need(ids.length, 'VALIDATION_FAILED', { field: 'itemIds', rule: 'nothing to count in this warehouse' });
    const open = inv.counts.filter((c) => c.warehouseId === w.id && (c.state === 'DRAFT' || c.state === 'SUBMITTED'));
    const overlap = open.find((c) => c.lines.some((l) => ids.includes(l.itemId)));
    if (overlap) throw new ApiError('VALIDATION_FAILED', { rule: 'another open count already covers some of these items', countId: overlap.id, number: overlap.number });
    const seq = inv.numbers.mv ?? 0;
    const c: StockCount = {
      id: newId(inv, 'cnt'), number: nextNumber(inv, 'CNT'), warehouseId: w.id, state: 'DRAFT',
      lines: ids.map((id) => ({ itemId: id, baselineQty: onHand(inv, id, w.id), baselineSeq: seq, countedQty: null, countedBy: null, countedAt: null })),
      startedAt: ctx.nowIso, startedBy: ctx.user!.id, submittedAt: null, submittedBy: null, postedAt: null, postedBy: null, cancelledAt: null, cancelReason: null,
      varianceValue: null, approvalGrantId: null, version: 1, note: (ctx.body.note ?? '').trim() || null, counters: [],
    };
    inv.counts.unshift(c);
    ctx.audit(`stock count ${c.number} started @ ${w.name}`, c.id);
    return { status: 201, body: countView(db, c) };
  },
  'StockCount.RecordObservations': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const c = getCount(ctx);
    if (c.state !== 'DRAFT') throw new ApiError('STOCK_COUNT_NOT_DRAFT', { state: c.state });
    const obs: any[] = ctx.body.observations;
    if (!Array.isArray(obs) || !obs.length) throw new ApiError('VALIDATION_FAILED', { field: 'observations', rule: 'at least one' });
    for (const [i, o] of obs.entries()) {
      const it = getItem(db, o.itemId);
      let line = c.lines.find((l) => l.itemId === o.itemId);
      if (!line) {
        if (!o.addLine) throw new ApiError('STOCK_COUNT_LINE_NOT_FOUND', { itemId: o.itemId });
        line = { itemId: it.id, baselineQty: onHand(inv, it.id, c.warehouseId), baselineSeq: inv.numbers.mv ?? 0, countedQty: null, countedBy: null, countedAt: null };
        c.lines.push(line);
      }
      if (o.countedQuantity === null || o.countedQuantity === '') { line.countedQty = null; line.countedBy = null; line.countedAt = null; continue; }
      if (!isQty(o.countedQuantity) || D(o.countedQuantity).lt(0)) throw new ApiError('VALIDATION_FAILED', { field: `observations[${i}].countedQuantity`, rule: 'quantity ≥ 0' });
      const q = toStockQty(db, it, o.countedQuantity, o.unit);
      checkPrecision(db, it, q, `observations[${i}].countedQuantity`);
      line.countedQty = q; line.countedBy = ctx.user!.id; line.countedAt = ctx.nowIso;
    }
    if (!c.counters.includes(ctx.user!.id)) c.counters.push(ctx.user!.id);
    c.version++;
    return countView(db, c);
  },
  'StockCount.Submit': (ctx) => {
    const c = getCount(ctx);
    if (c.state !== 'DRAFT') throw new ApiError('STOCK_COUNT_NOT_DRAFT', { state: c.state });
    checkVersion(c, ctx.body.expectedVersion);
    const zero = reqBool(ctx, 'zeroUncounted');
    const missing = c.lines.filter((l) => l.countedQty === null);
    if (missing.length && !zero) throw new ApiError('STOCK_COUNT_INCOMPLETE', { missing: missing.map((l) => nameOf(ctx.db, l.itemId).ar), count: missing.length });
    for (const l of missing) { l.countedQty = '0'; l.countedBy = ctx.user!.id; l.countedAt = ctx.nowIso; }
    c.state = 'SUBMITTED'; c.submittedAt = ctx.nowIso; c.submittedBy = ctx.user!.id; c.version++;
    ctx.audit(`stock count ${c.number} submitted`, c.id);
    return countView(ctx.db, c);
  },
  'Stock.Count': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const c = getCount(ctx);
    if (c.state !== 'SUBMITTED') throw new ApiError('STOCK_COUNT_NOT_SUBMITTED', { state: c.state });
    checkVersion(c, ctx.body.expectedVersion);
    const view = countView(db, c);
    const absValue = m4(view.lines.reduce((a, l) => a.plus(D(l.varianceValue ?? 0).abs()), D(0)));
    const g = ctx.requireApproval({ action: 'STOCK_COUNT_POST', targetType: 'counts_adjustments.StockCount', targetId: c.id, context: { warehouseId: c.warehouseId, absVarianceValue: absValue, lineCount: c.lines.length }, grantId: ctx.body.approvalGrantId });
    let total = D(0);
    for (const l of c.lines) {
      const v = view.lines.find((x) => x.itemId === l.itemId)!;
      l.expectedQty = v.expectedQty; l.varianceQty = v.varianceQty ?? '0'; l.unitCost = v.unitCost; l.varianceValue = v.varianceValue ?? m4(0);
      total = total.plus(l.varianceValue);
      if (!D(l.varianceQty).isZero()) post(db, actor(ctx, g?.id), { itemId: l.itemId, warehouseId: c.warehouseId, kind: 'COUNT_VARIANCE', quantity: l.varianceQty, unitCost: v.unitCost, reason: 'COUNT', source: src(ctx, 'counts', c.id, c.number), negative: 'ALLOW' });
    }
    c.state = 'POSTED'; c.postedAt = ctx.nowIso; c.postedBy = ctx.user!.id; c.varianceValue = m4(total); c.approvalGrantId = g?.id ?? null; c.version++;
    ctx.audit(`stock count ${c.number} posted, variance ${m4(total)}`, c.id, true, g?.id);
    void inv;
    return countView(db, c);
  },
  'StockCount.Cancel': (ctx) => {
    const c = getCount(ctx);
    if (c.state !== 'DRAFT' && c.state !== 'SUBMITTED') throw new ApiError('STOCK_COUNT_NOT_DRAFT', { state: c.state });
    checkVersion(c, ctx.body.expectedVersion);
    c.cancelReason = reqText(ctx, 'reason');
    c.state = 'CANCELLED'; c.cancelledAt = ctx.nowIso; c.version++;
    ctx.audit(`stock count ${c.number} cancelled`, c.id);
    return countView(ctx.db, c);
  },
  'StockCount.Find': (ctx) => {
    let list = invOf(ctx.db).counts;
    const whs = ctx.query.warehouseId ? [ctx.query.warehouseId] : warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    list = list.filter((c) => whs.includes(c.warehouseId));
    if (ctx.query.lifecycle) list = list.filter((c) => ctx.query.lifecycle.split(',').includes(c.state));
    return page(list.map((c) => countView(ctx.db, c, c.state !== 'POSTED' && c.state !== 'CANCELLED')).map((v) => ({ ...v, lines: undefined })), ctx.query);
  },
  'StockCount.Get': (ctx) => countView(ctx.db, getCount(ctx)),

  // Transfers
  'Transfer.Create': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const from = getWarehouse(db, ctx.body.fromWarehouseId, { active: true });
    const to = getWarehouse(db, ctx.body.toWarehouseId, { active: true });
    if (from.id === to.id) throw new ApiError('TRANSFER_SAME_WAREHOUSE');
    const lines = parseLines(ctx, ctx.body.lines, 'quantity');
    const t: Transfer = {
      id: newId(inv, 'trf'), number: nextNumber(inv, 'TRF'), fromWarehouseId: from.id, toWarehouseId: to.id, state: 'DRAFT',
      lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: null, receivedQuantity: null, shortQuantity: null, lots: [] })),
      note: (ctx.body.note ?? '').trim() || null, createdAt: ctx.nowIso, createdBy: ctx.user!.id, dispatchedAt: null, dispatchedBy: null, receivedAt: null, receivedBy: null,
      cancelledAt: null, cancelReason: null, version: 1, shortValue: null,
    };
    inv.transfers.unshift(t);
    ctx.audit(`transfer ${t.number} ${from.name} → ${to.name}`, t.id);
    return { status: 201, body: transferView(db, t) };
  },
  'Stock.Transfer': (ctx) => {
    const db = ctx.db;
    const t = getTransfer(ctx);
    if (t.state !== 'DRAFT') throw new ApiError('TRANSFER_NOT_DRAFT', { state: t.state });
    checkVersion(t, ctx.body.expectedVersion);
    getWarehouse(db, t.fromWarehouseId, { active: true });
    for (const l of t.lines) {
      getItem(db, l.itemId, { active: true });
      const mv = post(db, actor(ctx), { itemId: l.itemId, warehouseId: t.fromWarehouseId, kind: 'TRANSFER_OUT', quantity: D(l.quantity).negated(), source: src(ctx, 'transfers', t.id, t.number) });
      l.unitCost = mv.unitCost;
      l.lots = mv.lots.map((x) => ({ lotCode: x.lotCode, expiryDate: x.expiryDate, quantity: x.quantity }));
    }
    t.state = 'DISPATCHED'; t.dispatchedAt = ctx.nowIso; t.dispatchedBy = ctx.user!.id; t.version++;
    ctx.audit(`transfer ${t.number} dispatched`, t.id);
    return transferView(db, t);
  },
  'Transfer.Receive': (ctx) => {
    const db = ctx.db;
    const t = getTransfer(ctx);
    if (t.state !== 'DISPATCHED') throw new ApiError('TRANSFER_NOT_DISPATCHED', { state: t.state });
    checkVersion(t, ctx.body.expectedVersion);
    getWarehouse(db, t.toWarehouseId, { active: true });
    const input: any[] = Array.isArray(ctx.body.lines) ? ctx.body.lines : [];
    let short = D(0);
    for (const l of t.lines) {
      const r = input.find((x) => x.itemId === l.itemId);
      let rec = D(l.quantity);
      if (r && r.receivedQuantity !== undefined && r.receivedQuantity !== null && r.receivedQuantity !== '') {
        if (!isQty(r.receivedQuantity) || D(r.receivedQuantity).lt(0)) throw new ApiError('VALIDATION_FAILED', { field: 'receivedQuantity', itemId: l.itemId, rule: 'quantity ≥ 0' });
        rec = D(r.receivedQuantity);
        if (rec.gt(l.quantity)) throw new ApiError('VALIDATION_FAILED', { field: 'receivedQuantity', itemId: l.itemId, rule: 'cannot receive more than was sent', sent: l.quantity });
      }
      for (const x of input) if (!t.lines.some((tl) => tl.itemId === x.itemId)) throw new ApiError('TRANSFER_LINE_NOT_FOUND', { itemId: x.itemId });
      l.receivedQuantity = qn(rec);
      l.shortQuantity = qn(D(l.quantity).minus(rec));
      short = short.plus(D(l.shortQuantity).times(l.unitCost ?? 0));
      if (rec.gt(0)) {
        // lots follow the goods, first lots first, up to the received quantity
        let left = rec;
        const lotsIn = [];
        for (const lot of l.lots) { if (!left.gt(0)) break; const take = Decimal.min(left, D(lot.quantity)); lotsIn.push({ ...lot, quantity: qn(take) }); left = left.minus(take); }
        post(db, actor(ctx), { itemId: l.itemId, warehouseId: t.toWarehouseId, kind: 'TRANSFER_IN', quantity: rec, unitCost: l.unitCost, lotsIn, source: src(ctx, 'transfers', t.id, t.number), reason: D(l.shortQuantity).gt(0) ? 'SHORT_RECEIVED' : null });
      }
    }
    t.shortValue = m4(short);
    t.state = 'RECEIVED'; t.receivedAt = ctx.nowIso; t.receivedBy = ctx.user!.id; t.version++;
    if ((ctx.body.note ?? '').trim()) t.note = [t.note, ctx.body.note.trim()].filter(Boolean).join(' — ');
    ctx.audit(`transfer ${t.number} received${short.gt(0) ? `, short ${m4(short)}` : ''}`, t.id, short.gt(0));
    return transferView(db, t);
  },
  'Transfer.Cancel': (ctx) => {
    const t = getTransfer(ctx);
    if (t.state !== 'DRAFT') throw new ApiError('TRANSFER_NOT_DRAFT', { state: t.state });
    checkVersion(t, ctx.body.expectedVersion);
    t.cancelReason = reqText(ctx, 'reason');
    t.state = 'CANCELLED'; t.cancelledAt = ctx.nowIso; t.version++;
    ctx.audit(`transfer ${t.number} cancelled`, t.id);
    return transferView(ctx.db, t);
  },
  'Transfer.Find': (ctx) => {
    const whs = ctx.query.warehouseId ? [ctx.query.warehouseId] : warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    let list = invOf(ctx.db).transfers.filter((t) => whs.includes(t.fromWarehouseId) || whs.includes(t.toWarehouseId));
    if (ctx.query.lifecycle) list = list.filter((t) => ctx.query.lifecycle.split(',').includes(t.state));
    return page(list.map((t) => transferView(ctx.db, t)), ctx.query);
  },
  'Transfer.Get': (ctx) => transferView(ctx.db, getTransfer(ctx)),

  // Waste and customer returns
  'Stock.RecordWaste': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    const reason = ctx.body.reason as WasteReason;
    if (!WASTE_REASONS.includes(reason)) throw new ApiError('VALIDATION_FAILED', { field: 'reason', allowed: WASTE_REASONS });
    if (reason === 'OTHER' && !(ctx.body.note ?? '').trim()) throw new ApiError('VALIDATION_FAILED', { field: 'note', rule: 'required when the reason is OTHER' });
    const qty = posQty(ctx.body.quantity, 'quantity');
    const item = inv.items.find((i) => i.id === ctx.body.itemId);
    const product = item ? null : db.products.find((p) => p.id === ctx.body.itemId);
    if (!item && !product) throw new ApiError('INVENTORY_ITEM_NOT_FOUND', { itemId: ctx.body.itemId });
    let needs = new Map<string, Decimal>();
    if (item) {
      if (!item.active) throw new ApiError('INVENTORY_ITEM_INACTIVE', { itemId: item.id });
      const q = toStockQty(db, item, qty, ctx.body.unit);
      checkPrecision(db, item, q);
      needs.set(item.id, D(q));
    } else {
      const ex = explodeProduct(db, product!.id, qty, ctx.body.modifierOptionIds ?? [], ctx.now);
      if (!ex.recipeFound) throw new ApiError('RECIPE_NOT_FOUND', { productId: product!.id, rule: 'a dish without a recipe cannot be recorded as waste — record its ingredients' });
      needs = ex.needs;
    }
    const value = m4([...needs].reduce((a, [id, q]) => a.plus(q.times(inv.items.find((i) => i.id === id)?.avgCost ?? 0)), D(0)));
    const quantity = item ? qn([...needs.values()][0]) : qty;
    const g = ctx.requireApproval({ action: 'STOCK_WASTE', targetType: 'inventory.InventoryItem', targetId: ctx.body.itemId, context: { warehouseId: w.id, quantity, value, reasonCode: reason }, grantId: ctx.body.approvalGrantId });
    const rec = { id: newId(inv, 'wst'), number: nextNumber(inv, 'WST') };
    const ids: string[] = [];
    for (const [id, q] of needs) ids.push(post(db, actor(ctx, g?.id), { itemId: id, warehouseId: w.id, kind: 'WASTE', quantity: q.negated(), reason, note: (ctx.body.note ?? '').trim() || null, source: src(ctx, 'waste', rec.id, rec.number, product ? { label: product.name.ar } : {}) }).id);
    const wr = {
      ...rec, at: ctx.nowIso, businessDate: ctx.businessDate(w.branchId), warehouseId: w.id, itemId: ctx.body.itemId, itemKind: (item ? 'ITEM' : 'PRODUCT') as 'ITEM' | 'PRODUCT', name: item?.name ?? product!.name,
      quantity, reason, note: (ctx.body.note ?? '').trim() || null, sourceType: ctx.body.sourceType || 'MANUAL', sourceId: ctx.body.sourceId || null, value, movementIds: ids, userId: ctx.user!.id, approvalGrantId: g?.id ?? null,
    };
    inv.waste.unshift(wr);
    ctx.audit(`waste ${wr.name.ar} ${quantity} (${reason}) value ${value}`, wr.id, true, g?.id);
    return { status: 201, body: wasteView(db, wr) };
  },
  'Waste.Find': (ctx) => {
    const whs = ctx.query.warehouseId ? [ctx.query.warehouseId] : warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    let list = invOf(ctx.db).waste.filter((w) => whs.includes(w.warehouseId));
    if (ctx.query.reason) list = list.filter((w) => w.reason === ctx.query.reason);
    if (ctx.query.from) list = list.filter((w) => w.at >= ctx.query.from);
    if (ctx.query.to) list = list.filter((w) => w.at <= ctx.query.to);
    const total = m4(list.reduce((a, w) => a.plus(w.value), D(0)));
    return { ...page(list.map((w) => wasteView(ctx.db, w)), ctx.query), totalValue: total, customerReturns: invOf(ctx.db).customerReturns.filter((r) => !r.warehouseId || whs.includes(r.warehouseId)).map((r) => ({ ...r, userName: r.userId ? userName(ctx.db, r.userId) : null })) };
  },
  'Stock.RecordReturn': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const o = db.orders.find((x) => x.id === ctx.body.orderId);
    if (!o) throw new ApiError('ORDER_NOT_FOUND', { orderId: ctx.body.orderId });
    const line = o.lines.find((l) => l.id === ctx.body.orderLineId);
    if (!line) throw new ApiError('ORDER_LINE_NOT_FOUND', { orderLineId: ctx.body.orderLineId });
    if (!['CONFIRMED', 'COMPLETED'].includes(o.status) || line.status !== 'ACTIVE') throw new ApiError('VALIDATION_FAILED', { rule: 'only a sold line of a confirmed or completed check can come back', status: o.status });
    const disposition = ctx.body.disposition;
    if (!['RESTOCK', 'DISCARD'].includes(disposition)) throw new ApiError('VALIDATION_FAILED', { field: 'disposition', allowed: ['RESTOCK', 'DISCARD'] });
    const qty = posQty(ctx.body.quantity, 'quantity');
    const already = inv.customerReturns.filter((r) => r.orderId === o.id && r.orderLineId === line.id).reduce((a, r) => a.plus(r.quantity), D(0));
    if (already.plus(qty).gt(line.quantity)) throw new ApiError('VALIDATION_FAILED', { field: 'quantity', rule: 'more than was sold on this line', sold: line.quantity, alreadyReturned: qn(already) });
    const w = ctx.body.warehouseId ? getWarehouse(db, ctx.body.warehouseId, { active: true }) : salesWarehouse(db, o.branchId);
    if (!w && disposition === 'RESTOCK') throw new ApiError('SALES_WAREHOUSE_NOT_CONFIGURED', { branchId: o.branchId });
    const { needs } = lineNeeds(db, { ...line, quantity: qty }, ctx.now);
    const value = m4([...needs].reduce((a, [id, q]) => a.plus(q.times(inv.items.find((i) => i.id === id)?.avgCost ?? 0)), D(0)));
    const rec = { id: newId(inv, 'crt'), number: nextNumber(inv, 'RET') };
    const ids: string[] = [];
    if (disposition === 'RESTOCK') for (const [id, q] of needs) ids.push(post(db, actor(ctx), { itemId: id, warehouseId: w!.id, kind: 'CUSTOMER_RETURN', quantity: q, source: src(ctx, 'returns', rec.id, rec.number, { orderId: o.id, lineId: line.id, label: `${o.number} · ${line.name.ar}` }) }).id);
    const r = { ...rec, orderId: o.id, orderNumber: o.number, orderLineId: line.id, productId: line.productId, name: line.name, quantity: qty, disposition, warehouseId: w?.id ?? null, value, at: ctx.nowIso, userId: ctx.user!.id, refundEntryId: ctx.body.refundEntryId ?? null, movementIds: ids } as const;
    inv.customerReturns.unshift({ ...r });
    ctx.audit(`customer return ${o.number} ${line.name.ar} ×${qty} ${disposition}`, rec.id);
    return { status: 201, body: r };
  },

  // Recipes
  'Recipe.Define': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const id = ctx.params.recipeId;
    const b = ctx.body;
    const optId: string | null = b.modifierOptionId || null;
    if (!b.outputProductId && !optId) throw new ApiError('VALIDATION_FAILED', { field: 'outputProductId', rule: 'required' });
    let kind: Recipe['outputKind'];
    if (optId) {
      if (!db.modifierGroups.some((g) => g.options.some((o) => o.id === optId))) throw new ApiError('VALIDATION_FAILED', { field: 'modifierOptionId', rule: 'unknown modifier option' });
      if (b.appliesToProductId && !db.products.some((p) => p.id === b.appliesToProductId)) throw new ApiError('PRODUCT_NOT_FOUND', { productId: b.appliesToProductId });
      kind = 'MODIFIER';
    } else if (inv.items.some((i) => i.id === b.outputProductId)) kind = 'PREP';
    else if (db.products.some((p) => p.id === b.outputProductId)) kind = 'MENU';
    else throw new ApiError('PRODUCT_NOT_FOUND', { productId: b.outputProductId });
    const output = kind === 'MODIFIER' ? (b.appliesToProductId || optId) : b.outputProductId;
    const outQty = posQty(b.outputQuantityPerBatch ?? '1', 'outputQuantityPerBatch');
    const raw: any[] = b.inputsPerBatch;
    if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'inputsPerBatch', rule: 'at least one ingredient' });
    const seen = new Set<string>();
    const inputs = raw.map((r, i) => {
      const it = getItem(db, r.itemId);
      if (kind === 'PREP' && it.id === output) throw new ApiError('VALIDATION_FAILED', { field: `inputsPerBatch[${i}]`, rule: 'a recipe cannot use its own output' });
      if (seen.has(it.id)) throw new ApiError('VALIDATION_FAILED', { field: `inputsPerBatch[${i}]`, rule: 'ingredient listed twice' });
      seen.add(it.id);
      const entered = posQty(r.quantity, `inputsPerBatch[${i}].quantity`);
      const waste = r.wastePercent === undefined || r.wastePercent === '' || r.wastePercent === null ? '0' : String(r.wastePercent);
      if (!isQty(waste) || D(waste).lt(0) || D(waste).gte(100)) throw new ApiError('VALIDATION_FAILED', { field: `inputsPerBatch[${i}].wastePercent`, rule: '0 ≤ waste % < 100' });
      const unit = r.unit || it.stockUnitId;
      return { itemId: it.id, quantity: toStockQty(db, it, entered, unit), enteredQuantity: entered, enteredUnit: unit, wastePercent: qn(waste) };
    });
    let r = inv.recipes.find((x) => x.id === id);
    const clash = inv.recipes.find((x) => x.id !== id && x.outputKind === kind && x.outputProductId === output && (kind !== 'MODIFIER' || x.modifierOptionId === optId));
    if (clash) throw new ApiError('VALIDATION_FAILED', { rule: 'this already has a recipe — add a new version to it', existingRecipeId: clash.id });
    const eff = b.effectiveFrom ? Date.parse(b.effectiveFrom) : ctx.now;
    if (Number.isNaN(eff)) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveFrom' });
    if (!r) {
      if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new ApiError('VALIDATION_FAILED', { field: 'recipeId', rule: 'id: letters, digits, - and _' });
      r = { id, outputProductId: output, outputKind: kind, modifierOptionId: optId, appliesToProductId: kind === 'MODIFIER' ? b.appliesToProductId || null : null, name: nameOf(db, output), activeVersionId: '', versions: [], createdAt: ctx.nowIso, version: 0 };
      inv.recipes.push(r);
    } else if (r.outputProductId !== output || r.outputKind !== kind) throw new ApiError('VALIDATION_FAILED', { field: 'outputProductId', rule: 'a recipe keeps its output; make a new recipe instead' });
    const v: RecipeVersion = { id: `${r.id}_v${r.versions.length + 1}`, version: r.versions.length + 1, effectiveFrom: new Date(eff).toISOString(), inputsPerBatch: inputs, outputQuantityPerBatch: outQty, createdAt: ctx.nowIso, createdBy: ctx.user!.id, note: (b.note ?? '').trim() || null };
    r.versions.push(v);
    if (eff <= ctx.now) r.activeVersionId = v.id;
    else if (!r.activeVersionId) r.activeVersionId = v.id;
    r.version++;
    ctx.audit(`recipe ${recipeOutputName(db, r).ar} v${v.version}`, r.id);
    return { status: 201, body: recipeView(db, r, ctx.branchId, ctx.now, true) };
  },
  'Recipe.Find': (ctx) => {
    let list = invOf(ctx.db).recipes;
    if (ctx.query.outputProductId) list = list.filter((r) => r.outputProductId === ctx.query.outputProductId);
    if (ctx.query.kind) list = list.filter((r) => r.outputKind === ctx.query.kind);
    const branch = branchScope(ctx) ?? ctx.db.branches[0]?.id ?? null;
    const rows = list.map((r) => recipeView(ctx.db, r, branch, ctx.now));
    const withRecipe = new Set(list.filter((r) => r.outputKind === 'MENU').map((r) => r.outputProductId));
    const inv = invOf(ctx.db);
    const missing = ctx.db.products.filter((p) => p.active && !withRecipe.has(p.id) && !inv.recipes.some((r) => r.outputKind === 'MENU' && r.outputProductId === p.id) && !inv.items.some((i) => i.productId === p.id && i.id !== p.id)).map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId }));
    return { ...page(rows, ctx.query), productsWithoutRecipe: missing };
  },
  'Recipe.Get': (ctx) => recipeView(ctx.db, getRecipe(ctx), branchScope(ctx), ctx.now, true),
  'Recipe.Cost': (ctx) => {
    const r = getRecipe(ctx);
    const v = ctx.query.versionId ? r.versions.find((x) => x.id === ctx.query.versionId) : activeVersion(r, ctx.now);
    if (!v) throw new ApiError('RECIPE_VERSION_NOT_FOUND', { versionId: ctx.query.versionId });
    const branch = branchScope(ctx) ?? ctx.db.branches[0]?.id ?? null;
    return { recipeId: r.id, versionId: v.id, version: v.version, name: recipeOutputName(ctx.db, r), kind: r.outputKind, method: 'MOVING_AVERAGE', branchId: branch, ...recipeCost(ctx.db, r, v, branch, ctx.now) };
  },

  // Production
  'Production.Preview': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const { r, v } = recipeAndVersion(ctx, ctx.query.recipeVersionId, ctx.query.recipeId);
    if (r.outputKind !== 'PREP') throw new ApiError('VALIDATION_FAILED', { rule: 'only a preparation recipe (sauce, dough…) can be produced' });
    const out = ctx.query.outputQuantity ? posQty(ctx.query.outputQuantity, 'outputQuantity') : qn(D(posQty(ctx.query.batches ?? '1', 'batches')).times(v.outputQuantityPerBatch));
    const batches = D(out).dividedBy(v.outputQuantityPerBatch);
    const w = ctx.query.warehouseId ? getWarehouse(db, ctx.query.warehouseId) : null;
    const needs = versionNeeds(v, batches);
    const inputs = [...needs].map(([id, q]) => {
      const it = inv.items.find((i) => i.id === id)!;
      const have = w ? D(onHand(inv, id, w.id)) : null;
      const cost = itemUnitCost(db, it);
      return { item: itemBrief(db, it), required: qn(q), onHand: have ? qn(have) : null, shortage: have && have.lt(q) ? qn(q.minus(have)) : null, unitCost: m4(cost), value: m4(q.times(cost)) };
    });
    const total = inputs.reduce((a, i) => a.plus(i.value), D(0));
    const outItem = inv.items.find((i) => i.id === r.outputProductId)!;
    return { recipeId: r.id, recipeVersionId: v.id, version: v.version, output: itemBrief(db, outItem), outputQuantity: out, batches: qn(batches), inputs, totalCost: m4(total), unitCost: m4(D(out).isZero() ? 0 : total.dividedBy(out)), canProduce: inputs.every((i) => !i.shortage), warehouseId: w?.id ?? null, currentAvgCost: outItem.avgCost, shelfLifeDays: outItem.shelfLifeDays };
  },
  'Production.Post': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const { r, v } = recipeAndVersion(ctx, ctx.body.recipeVersionId, null);
    if (r.outputKind !== 'PREP') throw new ApiError('VALIDATION_FAILED', { rule: 'only a preparation recipe (sauce, dough…) can be produced' });
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    const outItem = getItem(db, r.outputProductId, { active: true });
    const actualOut = posQty(ctx.body.actualOutput, 'actualOutput');
    checkPrecision(db, outItem, actualOut, 'actualOutput');
    const planned = versionNeeds(v, D(actualOut).dividedBy(v.outputQuantityPerBatch));
    const given: any[] = Array.isArray(ctx.body.actualInputs) ? ctx.body.actualInputs : [];
    const actual = new Map<string, Decimal>();
    for (const [id, q] of planned) actual.set(id, q);
    for (const [i, g] of given.entries()) {
      getItem(db, g.itemId);
      if (g.quantity === '' || g.quantity === null || g.quantity === undefined) continue;
      if (!isQty(g.quantity) || D(g.quantity).lt(0)) throw new ApiError('VALIDATION_FAILED', { field: `actualInputs[${i}].quantity`, rule: 'quantity ≥ 0' });
      actual.set(g.itemId, D(g.quantity));
    }
    const run = { id: newId(inv, 'prd'), number: nextNumber(inv, 'PRD') };
    const s = src(ctx, 'production', run.id, run.number, { label: outItem.name.ar });
    const ids: string[] = [];
    const inputs: { itemId: string; planned: string; actual: string; unitCost: string; value: string }[] = [];
    let total = D(0);
    for (const [id, q] of actual) {
      if (q.isZero()) { inputs.push({ itemId: id, planned: qn(planned.get(id) ?? 0), actual: '0', unitCost: m4(0), value: m4(0) }); continue; }
      const mv = post(db, actor(ctx), { itemId: id, warehouseId: w.id, kind: 'PRODUCTION_OUT', quantity: q.negated(), source: s });
      ids.push(mv.id);
      total = total.plus(D(mv.value).negated());
      inputs.push({ itemId: id, planned: qn(planned.get(id) ?? 0), actual: qn(q), unitCost: mv.unitCost, value: m4(D(mv.value).negated()) });
    }
    const unit = total.dividedBy(actualOut);
    const expiry = ctx.body.expiryDate || (outItem.shelfLifeDays ? ymd(ctx.now + outItem.shelfLifeDays * 86_400_000) : null);
    const lotCode = (ctx.body.lotCode ?? '').trim() || run.number;
    const inMv = post(db, actor(ctx), { itemId: outItem.id, warehouseId: w.id, kind: 'PRODUCTION_IN', quantity: actualOut, unitCost: unit, updateAvg: true, source: s, lot: outItem.trackLots || expiry ? { lotCode, expiryDate: expiry } : null });
    ids.push(inMv.id);
    const pr = {
      ...run, at: ctx.nowIso, businessDate: ctx.businessDate(w.branchId), recipeId: r.id, recipeVersionId: v.id, warehouseId: w.id, outputItemId: outItem.id,
      plannedOutput: actualOut, actualOutput: actualOut, inputs, totalCost: m4(total), unitCost: m4(unit), userId: ctx.user!.id, movementIds: ids, note: (ctx.body.note ?? '').trim() || null, lotCode, expiryDate: expiry,
    };
    inv.production.unshift(pr);
    ctx.audit(`production ${pr.number} ${outItem.name.ar} ${actualOut}`, pr.id);
    return { status: 201, body: productionView(db, pr) };
  },
  'Production.Find': (ctx) => {
    const whs = ctx.query.warehouseId ? [ctx.query.warehouseId] : warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    let list = invOf(ctx.db).production.filter((p) => whs.includes(p.warehouseId));
    if (ctx.query.from) list = list.filter((p) => p.at >= ctx.query.from);
    if (ctx.query.to) list = list.filter((p) => p.at <= ctx.query.to);
    return page(list.map((p) => productionView(ctx.db, p)), ctx.query);
  },

  // Suppliers
  'Supplier.Upsert': (ctx) => {
    const inv = invOf(ctx.db);
    const name = reqText(ctx, 'name', 120);
    const active = reqBool(ctx, 'active');
    const id = ctx.params.supplierId;
    if (inv.suppliers.some((s) => s.id !== id && s.name.trim() === name)) throw new ApiError('VALIDATION_FAILED', { field: 'name', rule: 'another supplier has this name' });
    const opt = (k: string) => { const v = ctx.body[k]; return typeof v === 'string' && v.trim() ? v.trim() : null; };
    let s = inv.suppliers.find((x) => x.id === id);
    if (!s) {
      if (!/^[A-Za-z0-9_-]{2,64}$/.test(id)) throw new ApiError('VALIDATION_FAILED', { field: 'supplierId', rule: 'id: letters, digits, - and _' });
      s = { id, name, taxId: opt('taxId'), phone: opt('phone'), contactName: opt('contactName'), paymentTerms: opt('paymentTerms'), address: opt('address'), notes: opt('notes'), active, version: 1, createdAt: ctx.nowIso };
      inv.suppliers.push(s);
      ctx.audit(`supplier ${name} created`, id);
      return { status: 201, body: supplierView(ctx.db, s) };
    }
    if (ctx.body.expectedVersion !== undefined && ctx.body.expectedVersion !== null) checkVersion(s, ctx.body.expectedVersion);
    if (!active && s.active && inv.purchaseOrders.some((p) => p.supplierId === s!.id && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state))) throw new ApiError('VALIDATION_FAILED', { field: 'active', rule: 'the supplier has open purchase orders — close them first' });
    Object.assign(s, { name, active, taxId: opt('taxId'), phone: opt('phone'), contactName: opt('contactName'), paymentTerms: opt('paymentTerms'), address: opt('address'), notes: opt('notes') });
    s.version++;
    ctx.audit(`supplier ${name} saved`, id);
    return supplierView(ctx.db, s);
  },
  'Supplier.List': (ctx) => {
    let list = invOf(ctx.db).suppliers;
    if (ctx.query.active !== undefined) list = list.filter((s) => s.active === bool(ctx.query.active));
    const text = (ctx.query.text ?? '').trim();
    if (text) list = list.filter((s) => `${s.name} ${s.phone ?? ''} ${s.contactName ?? ''}`.includes(text));
    return page([...list].sort((a, b) => a.name.localeCompare(b.name)).map((s) => supplierView(ctx.db, s)), ctx.query);
  },
  'Supplier.Get': (ctx) => {
    const s = invOf(ctx.db).suppliers.find((x) => x.id === ctx.params.supplierId);
    if (!s) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: ctx.params.supplierId });
    const inv = invOf(ctx.db);
    return {
      ...supplierView(ctx.db, s),
      purchaseOrders: inv.purchaseOrders.filter((p) => p.supplierId === s.id).slice(0, 20).map((p) => poView(ctx.db, p)),
      receipts: inv.receipts.filter((r) => r.supplierId === s.id).slice(0, 20).map((r) => receiptView(ctx.db, r)),
      returns: inv.supplierReturns.filter((r) => r.supplierId === s.id).slice(0, 20),
      items: inv.items.filter((i) => i.defaultSupplierId === s.id).map((i) => itemBrief(ctx.db, i)),
    };
  },

  // Purchase orders
  'PurchaseOrder.Create': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const s = activeSupplier(ctx, ctx.body.supplierId);
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    const lines = poLines(ctx, ctx.body.lines);
    const po: PurchaseOrder = {
      id: newId(inv, 'po'), number: nextNumber(inv, 'PO'), supplierId: s.id, warehouseId: w.id, branchId: w.branchId, state: 'DRAFT', lines,
      expectedDate: ctx.body.expectedDate || null, note: (ctx.body.note ?? '').trim() || null, createdAt: ctx.nowIso, createdBy: ctx.user!.id, issuedAt: null, issuedBy: null,
      closedAt: null, closedBy: null, closeReason: null, cancelledAt: null, cancelReason: null, version: 1, history: [{ at: ctx.nowIso, by: ctx.user!.id, text: 'DRAFT' }],
    };
    inv.purchaseOrders.unshift(po);
    ctx.audit(`purchase order ${po.number} drafted for ${s.name}`, po.id);
    return { status: 201, body: poView(db, po) };
  },
  'PurchaseOrder.Update': (ctx) => {
    const po = getPo(ctx);
    if (po.state !== 'DRAFT') throw new ApiError('PURCHASE_ORDER_NOT_DRAFT', { state: po.state });
    checkVersion(po, ctx.body.expectedVersion);
    po.lines = poLines(ctx, ctx.body.lines, po.lines);
    if (ctx.body.expectedDate !== undefined) po.expectedDate = ctx.body.expectedDate || null;
    if (ctx.body.note !== undefined) po.note = (ctx.body.note ?? '').trim() || null;
    if (ctx.body.warehouseId && ctx.body.warehouseId !== po.warehouseId) { const w = getWarehouse(ctx.db, ctx.body.warehouseId, { active: true }); po.warehouseId = w.id; po.branchId = w.branchId; }
    po.version++;
    po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: 'lines updated' });
    return poView(ctx.db, po);
  },
  'PurchaseOrder.Issue': (ctx) => {
    const po = getPo(ctx);
    if (po.state !== 'DRAFT') throw new ApiError('PURCHASE_ORDER_NOT_DRAFT', { state: po.state });
    checkVersion(po, ctx.body.expectedVersion);
    activeSupplier(ctx, po.supplierId);
    po.state = 'ISSUED'; po.issuedAt = ctx.nowIso; po.issuedBy = ctx.user!.id; po.version++;
    po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: 'ISSUED' });
    ctx.audit(`purchase order ${po.number} issued`, po.id);
    return poView(ctx.db, po);
  },
  'PurchaseOrder.Find': (ctx) => {
    let list = invOf(ctx.db).purchaseOrders;
    const scope = branchScope(ctx);
    if (scope) list = list.filter((p) => p.branchId === scope);
    if (ctx.query.lifecycle) list = list.filter((p) => ctx.query.lifecycle.split(',').includes(p.state));
    if (ctx.query.supplierId) list = list.filter((p) => p.supplierId === ctx.query.supplierId);
    return page(list.map((p) => poView(ctx.db, p)), ctx.query);
  },
  'PurchaseOrder.Get': (ctx) => {
    const po = getPo(ctx);
    return { ...poView(ctx.db, po), receipts: invOf(ctx.db).receipts.filter((r) => r.purchaseOrderId === po.id).map((r) => receiptView(ctx.db, r)) };
  },
  'PurchaseOrder.Close': (ctx) => {
    const po = getPo(ctx);
    if (!['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.state)) throw new ApiError('PURCHASE_ORDER_NOT_OPEN', { state: po.state, hint: po.state === 'DRAFT' ? 'a draft is cancelled, not closed' : undefined });
    checkVersion(po, ctx.body.expectedVersion);
    po.closeReason = (ctx.body.reason ?? '').trim() || null;
    po.state = 'CLOSED'; po.closedAt = ctx.nowIso; po.closedBy = ctx.user!.id; po.version++;
    po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `CLOSED${po.closeReason ? ' — ' + po.closeReason : ''}` });
    ctx.audit(`purchase order ${po.number} closed`, po.id);
    return poView(ctx.db, po);
  },
  'PurchaseOrder.Cancel': (ctx) => {
    const po = getPo(ctx);
    if (!['DRAFT', 'ISSUED'].includes(po.state)) throw new ApiError(po.state === 'PARTIALLY_RECEIVED' ? 'PURCHASE_ORDER_HAS_RECEIPTS' : 'PURCHASE_ORDER_NOT_OPEN', { state: po.state });
    checkVersion(po, ctx.body.expectedVersion);
    if (invOf(ctx.db).receipts.some((r) => r.purchaseOrderId === po.id)) throw new ApiError('PURCHASE_ORDER_HAS_RECEIPTS', { purchaseOrderId: po.id });
    po.cancelReason = reqText(ctx, 'reason');
    po.state = 'CANCELLED'; po.cancelledAt = ctx.nowIso; po.version++;
    po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `CANCELLED — ${po.cancelReason}` });
    ctx.audit(`purchase order ${po.number} cancelled`, po.id);
    return poView(ctx.db, po);
  },

  // Goods receipts
  'GoodsReceipt.Post': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const s = activeSupplier(ctx, ctx.body.supplierId);
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    let po: PurchaseOrder | null = null;
    if (ctx.body.purchaseOrderId) {
      po = inv.purchaseOrders.find((p) => p.id === ctx.body.purchaseOrderId) ?? null;
      if (!po) throw new ApiError('PURCHASE_ORDER_NOT_FOUND', { purchaseOrderId: ctx.body.purchaseOrderId });
      if (!['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.state)) throw new ApiError('PURCHASE_ORDER_NOT_OPEN', { state: po.state });
      if (po.supplierId !== s.id) throw new ApiError('VALIDATION_FAILED', { field: 'supplierId', rule: 'the purchase order belongs to another supplier' });
    }
    const raw: any[] = ctx.body.lines;
    if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'lines', rule: 'at least one line' });
    const received = po ? poReceived(db, po) : new Map<string, Decimal>();
    const over = policy<{ aboveTolerance: string; tolerancePercent: string }>('OverReceiptPolicy', { branchId: w.branchId }) ?? { aboveTolerance: 'BLOCK', tolerancePercent: '0' };
    let overQty = D(0);
    const lines = raw.map((r, i) => {
      const it = getItem(db, r.itemId, { active: true });
      let poLineId: string | null = null;
      if (po) {
        const pl = r.poLineId ? po.lines.find((l) => l.id === r.poLineId) : po.lines.find((l) => l.itemId === it.id);
        if (r.poLineId && !pl) throw new ApiError('PURCHASE_ORDER_LINE_NOT_FOUND', { poLineId: r.poLineId });
        if (pl && pl.itemId !== it.id) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].itemId`, rule: 'item differs from the purchase order line' });
        poLineId = pl?.id ?? null;
      }
      const pack = r.packId ? it.packs.find((p) => p.id === r.packId) : null;
      if (r.packId && !pack) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, packId: r.packId });
      const packQty = posQty(r.quantity, `lines[${i}].quantity`);
      const qty = pack ? qn(D(packQty).times(pack.factor)) : toStockQty(db, it, packQty, r.unit);
      checkPrecision(db, it, qty, `lines[${i}].quantity`);
      const packCost = money(r.unitCost, `lines[${i}].unitCost`);
      if (packCost === null) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].unitCost`, rule: 'required' });
      const unitCost = pack ? m4(D(packCost).dividedBy(pack.factor)) : m4(D(packCost).times(packQty).dividedBy(qty));
      let expiry: string | null = r.expiryDate || null;
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].expiryDate`, rule: 'YYYY-MM-DD' });
      if (!expiry && it.trackLots) {
        if (!it.shelfLifeDays) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].expiryDate`, rule: 'this item is tracked by expiry date', item: it.name.ar });
        expiry = ymd(ctx.now + it.shelfLifeDays * 86_400_000);
      }
      if (poLineId) {
        const pl = po!.lines.find((l) => l.id === poLineId)!;
        const ordered = D(pl.orderedQuantity).times(pl.factor);
        const already = received.get(poLineId) ?? D(0);
        const allowed = ordered.times(D(1).plus(D(over.tolerancePercent || 0).dividedBy(100)));
        const after = already.plus(qty);
        if (after.gt(allowed)) {
          if (over.aboveTolerance !== 'REQUIRE_APPROVAL') throw new ApiError('OVER_RECEIPT_BLOCKED', { item: it.name.ar, ordered: qn(ordered), alreadyReceived: qn(already), receiving: qty, tolerancePercent: over.tolerancePercent });
          overQty = overQty.plus(after.minus(allowed));
        }
        received.set(poLineId, after);
      }
      return { id: `grl_${i + 1}`, poLineId, itemId: it.id, packId: pack?.id ?? null, factor: pack?.factor ?? '1', packQuantity: packQty, quantity: qty, packCost, unitCost, value: m4(D(qty).times(unitCost)), lotCode: (r.lotCode ?? '').trim() || null, expiryDate: expiry };
    });
    let grantId: string | null = null;
    if (overQty.gt(0)) grantId = ctx.requireApproval({ action: 'INVENTORY_ADJUST', targetType: 'receiving.GoodsReceipt', targetId: po!.id, context: { warehouseId: w.id, quantityDelta: qn(overQty), reasonCode: 'OVER_RECEIPT' }, grantId: ctx.body.approvalGrantId })?.id ?? null;
    const gr: GoodsReceipt = {
      id: newId(inv, 'grn'), number: nextNumber(inv, 'GRN'), supplierId: s.id, purchaseOrderId: po?.id ?? null, warehouseId: w.id, state: 'POSTED',
      supplierInvoiceNo: (ctx.body.supplierInvoiceNo ?? '').trim() || null, lines, total: m4(lines.reduce((a, l) => a.plus(l.value), D(0))), at: ctx.nowIso, businessDate: ctx.businessDate(w.branchId),
      userId: ctx.user!.id, note: (ctx.body.note ?? '').trim() || null, reversal: null, movementIds: [],
    };
    for (const l of lines) {
      const it = getItem(db, l.itemId);
      const lotCode = l.lotCode || (it.trackLots || l.expiryDate ? `${gr.number}` : null);
      gr.movementIds.push(post(db, actor(ctx, grantId), { itemId: l.itemId, warehouseId: w.id, kind: 'RECEIPT', quantity: l.quantity, unitCost: l.unitCost, updateAvg: true, source: src(ctx, 'receiving', gr.id, gr.number, { label: s.name }), lot: lotCode ? { lotCode, expiryDate: l.expiryDate } : null }).id);
    }
    inv.receipts.unshift(gr);
    if (po) { refreshPoState(db, po); po.version++; po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `received ${gr.number} → ${po.state}` }); }
    ctx.audit(`goods receipt ${gr.number} from ${s.name} total ${gr.total}`, gr.id, false, grantId ?? undefined);
    return { status: 201, body: receiptView(db, gr) };
  },
  'GoodsReceipt.Find': (ctx) => {
    let list = invOf(ctx.db).receipts;
    const whs = warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    list = list.filter((r) => whs.includes(r.warehouseId));
    const q = ctx.query;
    if (q.supplierId) list = list.filter((r) => r.supplierId === q.supplierId);
    if (q.purchaseOrderId) list = list.filter((r) => r.purchaseOrderId === q.purchaseOrderId);
    if (q.itemId) list = list.filter((r) => r.lines.some((l) => l.itemId === q.itemId));
    if (q.businessDateFrom) list = list.filter((r) => r.businessDate >= q.businessDateFrom);
    if (q.businessDateTo) list = list.filter((r) => r.businessDate <= q.businessDateTo);
    return page(list.map((r) => receiptView(ctx.db, r)), q);
  },
  'GoodsReceipt.Get': (ctx) => receiptView(ctx.db, getReceipt(ctx)),
  'GoodsReceipt.Reverse': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const gr = getReceipt(ctx);
    if (gr.state === 'REVERSED') throw new ApiError('RECEIPT_ALREADY_REVERSED', { receiptId: gr.id });
    const reason = reqText(ctx, 'reason');
    if (inv.supplierReturns.some((s) => s.receiptId === gr.id)) throw new ApiError('VALIDATION_FAILED', { rule: 'part of this receipt was already returned to the supplier — return the rest instead of reversing' });
    const totalQty = gr.lines.reduce((a, l) => a.plus(l.quantity), D(0));
    const g = ctx.requireApproval({ action: 'INVENTORY_ADJUST', targetType: 'receiving.GoodsReceipt', targetId: gr.id, context: { warehouseId: gr.warehouseId, quantityDelta: qn(totalQty.negated()), reasonCode: 'RECEIPT_REVERSAL' }, grantId: ctx.body.approvalGrantId });
    const ids: string[] = [];
    for (const l of gr.lines) ids.push(post(db, actor(ctx, g?.id), { itemId: l.itemId, warehouseId: gr.warehouseId, kind: 'RECEIPT_REVERSAL', quantity: D(l.quantity).negated(), unitCost: l.unitCost, updateAvg: true, reason: 'RECEIPT_REVERSAL', note: reason, preferLotRef: gr.id, source: src(ctx, 'receiving', gr.id, gr.number) }).id);
    gr.state = 'REVERSED';
    gr.reversal = { at: ctx.nowIso, by: ctx.user!.id, reason, approvalGrantId: g?.id ?? null, movementIds: ids };
    if (gr.purchaseOrderId) {
      const po = inv.purchaseOrders.find((p) => p.id === gr.purchaseOrderId);
      if (po) { refreshPoState(db, po); po.version++; po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `receipt ${gr.number} reversed → ${po.state}` }); }
    }
    ctx.audit(`goods receipt ${gr.number} reversed: ${reason}`, gr.id, true, g?.id);
    return receiptView(db, gr);
  },

  // Supplier returns
  'SupplierReturn.Post': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const sup = inv.suppliers.find((x) => x.id === ctx.body.supplierId);
    if (!sup) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: ctx.body.supplierId });
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    const reason = reqText(ctx, 'reason');
    let gr: GoodsReceipt | null = null;
    if (ctx.body.receiptId) {
      gr = inv.receipts.find((r) => r.id === ctx.body.receiptId) ?? null;
      if (!gr) throw new ApiError('GOODS_RECEIPT_NOT_FOUND', { receiptId: ctx.body.receiptId });
      if (gr.state !== 'POSTED') throw new ApiError('RECEIPT_ALREADY_REVERSED', { receiptId: gr.id });
      if (gr.supplierId !== sup.id) throw new ApiError('VALIDATION_FAILED', { field: 'receiptId', rule: 'receipt of another supplier' });
    }
    const raw: any[] = ctx.body.lines;
    if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'lines', rule: 'at least one line' });
    const lines = raw.map((r, i) => {
      const it = getItem(db, r.itemId);
      const qty = toStockQty(db, it, posQty(r.quantity, `lines[${i}].quantity`), r.unit);
      checkPrecision(db, it, qty, `lines[${i}].quantity`);
      let cost = money(r.unitCost, `lines[${i}].unitCost`);
      if (gr) {
        const gl = gr.lines.filter((l) => l.itemId === it.id);
        if (!gl.length) throw new ApiError('GOODS_RECEIPT_LINE_NOT_FOUND', { itemId: it.id });
        const got = gl.reduce((a, l) => a.plus(l.quantity), D(0));
        const back = inv.supplierReturns.filter((s) => s.receiptId === gr!.id).flatMap((s) => s.lines).filter((l) => l.itemId === it.id).reduce((a, l) => a.plus(l.quantity), D(0));
        if (back.plus(qty).gt(got)) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].quantity`, rule: 'more than was received on this receipt', received: qn(got), alreadyReturned: qn(back) });
        cost = cost ?? gl[0].unitCost;
      }
      cost = cost ?? it.avgCost;
      return { itemId: it.id, quantity: qty, unitCost: cost, value: m4(D(qty).times(cost)) };
    });
    const totalQty = lines.reduce((a, l) => a.plus(l.quantity), D(0));
    const rec = { id: newId(inv, 'srt'), number: nextNumber(inv, 'SRT') };
    const g = ctx.requireApproval({ action: 'INVENTORY_ADJUST', targetType: 'suppliers.SupplierReturn', targetId: gr?.id ?? sup.id, context: { warehouseId: w.id, quantityDelta: qn(totalQty.negated()), reasonCode: 'SUPPLIER_RETURN' }, grantId: ctx.body.approvalGrantId });
    const ids = lines.map((l) => post(db, actor(ctx, g?.id), { itemId: l.itemId, warehouseId: w.id, kind: 'SUPPLIER_RETURN', quantity: D(l.quantity).negated(), unitCost: l.unitCost, updateAvg: true, reason: 'SUPPLIER_RETURN', note: reason, preferLotRef: gr?.id ?? null, source: src(ctx, 'suppliers', rec.id, rec.number, { label: sup.name }) }).id);
    const sr = { ...rec, supplierId: sup.id, warehouseId: w.id, receiptId: gr?.id ?? null, lines, total: m4(lines.reduce((a, l) => a.plus(l.value), D(0))), reason, at: ctx.nowIso, businessDate: ctx.businessDate(w.branchId), userId: ctx.user!.id, approvalGrantId: g?.id ?? null, movementIds: ids };
    inv.supplierReturns.unshift(sr);
    ctx.audit(`supplier return ${sr.number} to ${sup.name} total ${sr.total}`, sr.id, true, g?.id);
    return { status: 201, body: supplierReturnView(db, sr) };
  },
  'SupplierReturn.Find': (ctx) => {
    const whs = warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id);
    let list = invOf(ctx.db).supplierReturns.filter((r) => whs.includes(r.warehouseId));
    if (ctx.query.supplierId) list = list.filter((r) => r.supplierId === ctx.query.supplierId);
    if (ctx.query.from) list = list.filter((r) => r.at >= ctx.query.from);
    if (ctx.query.to) list = list.filter((r) => r.at <= ctx.query.to);
    return page(list.map((r) => supplierReturnView(ctx.db, r)), ctx.query);
  },

  // Dashboard (proposed: one read for the overview screen)
  'Inventory.Dashboard': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const scope = branchScope(ctx);
    const whs = warehousesIn(db, scope);
    const whIds = new Set(whs.map((w) => w.id));
    const byWarehouse = whs.map((w) => warehouseView(db, w));
    const stockValue = m4(byWarehouse.reduce((a, w) => a.plus(w.stockValue), D(0)));
    const days: { date: string; sales: string; waste: string; receipts: string; variance: string }[] = [];
    const DAY = 86_400_000;
    const today = ymd(ctx.now);
    for (let i = 6; i >= 0; i--) days.push({ date: ymd(ctx.now - i * DAY), sales: '0', waste: '0', receipts: '0', variance: '0' });
    const since30 = ctx.now - 30 * DAY;
    let variance30 = D(0), waste7 = D(0), sales7 = D(0), receipts7 = D(0);
    const wasteByItem = new Map<string, Decimal>();
    for (let i = inv.movements.length - 1; i >= 0; i--) {
      const m = inv.movements[i];
      if (m.atMs < since30) break;
      if (!whIds.has(m.warehouseId)) continue;
      const v = D(m.value);
      if (m.kind === 'COUNT_VARIANCE') variance30 = variance30.plus(v);
      const day = days.find((d) => d.date === ymd(m.atMs));
      if (!day) continue;
      if (m.kind === 'SALE' || m.kind === 'SALE_REVERSAL') { day.sales = m4(D(day.sales).minus(v)); sales7 = sales7.minus(v); }
      if (m.kind === 'WASTE' || m.kind === 'VOID_WASTE') { day.waste = m4(D(day.waste).minus(v)); waste7 = waste7.minus(v); wasteByItem.set(m.itemId, (wasteByItem.get(m.itemId) ?? D(0)).minus(v)); }
      if (m.kind === 'RECEIPT' || m.kind === 'RECEIPT_REVERSAL') { day.receipts = m4(D(day.receipts).plus(v)); receipts7 = receipts7.plus(v); }
      if (m.kind === 'COUNT_VARIANCE') day.variance = m4(D(day.variance).plus(v));
    }
    let low = 0, out = 0, negative = 0;
    for (const it of inv.items.filter((x) => x.active)) for (const w of whs) {
      const s = levelState(inv, it, w.id);
      if (s === 'LOW') low++; if (s === 'OUT') out++; if (s === 'NEGATIVE') negative++;
    }
    const soon = ymd(ctx.now + 3 * DAY);
    const lots = inv.lots.filter((l) => whIds.has(l.warehouseId) && l.expiryDate && D(l.remaining).gt(0));
    const expired = lots.filter((l) => l.expiryDate! < today);
    const expiring = lots.filter((l) => l.expiryDate! >= today && l.expiryDate! <= soon);
    const branch = scope ?? db.branches[0]?.id ?? null;
    const dishes = inv.recipes.filter((r) => r.outputKind === 'MENU').map((r) => { const v = recipeView(db, r, branch, ctx.now); return { recipeId: r.id, productId: r.outputProductId, name: v.name, cost: v.cost.perUnit, price: v.cost.prices.find((p) => p.channel === 'DINE_IN')?.net ?? v.cost.prices[0]?.net ?? null, foodCostPercent: v.cost.foodCostPercent, band: v.cost.band }; })
      .sort((a, b) => Number(b.foodCostPercent ?? -1) - Number(a.foodCostPercent ?? -1));
    const avgFood = dishes.filter((d) => d.foodCostPercent).reduce((a, d, _i, arr) => a.plus(D(d.foodCostPercent!).dividedBy(arr.length)), D(0));
    const recent = [];
    for (let i = inv.movements.length - 1; i >= 0 && recent.length < 12; i--) if (whIds.has(inv.movements[i].warehouseId)) recent.push(movementView(db, inv.movements[i]));
    const topWaste = [...wasteByItem].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 5).map(([id, v]) => ({ itemId: id, name: nameOf(db, id), value: m4(v) }));
    return {
      branchId: scope, stockValue, byWarehouse, lowCount: low, outCount: out, negativeCount: negative, expiredCount: expired.length, expiringCount: expiring.length,
      expiredValue: m4(expired.reduce((a, l) => a.plus(D(l.remaining).times(inv.items.find((i) => i.id === l.itemId)?.avgCost ?? 0)), D(0))),
      sales7: m4(sales7), waste7: m4(waste7), receipts7: m4(receipts7), variance30: m4(variance30), days, dishes, avgFoodCostPercent: dishes.length ? avgFood.toDecimalPlaces(1).toFixed(1) : null, recent, topWaste,
      openPurchaseOrders: inv.purchaseOrders.filter((p) => (!scope || p.branchId === scope) && ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state)).length,
      inTransit: inv.transfers.filter((t) => t.state === 'DISPATCHED' && (whIds.has(t.toWarehouseId) || whIds.has(t.fromWarehouseId))).length,
      openCounts: inv.counts.filter((c) => whIds.has(c.warehouseId) && (c.state === 'DRAFT' || c.state === 'SUBMITTED')).length,
      salesWarehouseMissing: db.branches.filter((b) => (!scope || b.id === scope) && b.active && !salesWarehouse(db, b.id)).map((b) => ({ id: b.id, name: b.name })),
      unconsumedOrders: Object.values(inv.orderEffects).filter((e) => e.state === 'SKIPPED').length,
      noRecipeSales: Object.values(inv.orderEffects).filter((e) => e.note === 'NO_RECIPE').length,
    };
  },
};

// ───────── helpers
function movementGet(ctx: Ctx) {
  const m = invOf(ctx.db).movements.find((x) => x.id === ctx.params.movementId);
  if (!m) throw new ApiError('STOCK_MOVEMENT_NOT_FOUND', { movementId: ctx.params.movementId });
  const order = m.source.orderId ? ctx.db.orders.find((o) => o.id === m.source.orderId) : null;
  return { ...movementView(ctx.db, m), sourceTrace: { ...m.source, orderStatus: order?.status ?? null, approverName: m.approvalGrantId ? userName(ctx.db, ctx.db.grants.find((g) => g.id === m.approvalGrantId)?.approverUserId) : null } };
}
function getCount(ctx: Ctx): StockCount {
  const c = invOf(ctx.db).counts.find((x) => x.id === ctx.params.countId);
  if (!c) throw new ApiError('STOCK_COUNT_NOT_FOUND', { countId: ctx.params.countId });
  return c;
}
function getTransfer(ctx: Ctx): Transfer {
  const t = invOf(ctx.db).transfers.find((x) => x.id === ctx.params.transferId);
  if (!t) throw new ApiError('TRANSFER_NOT_FOUND', { transferId: ctx.params.transferId });
  return t;
}
function getRecipe(ctx: Ctx): Recipe {
  const r = invOf(ctx.db).recipes.find((x) => x.id === ctx.params.recipeId);
  if (!r) throw new ApiError('RECIPE_NOT_FOUND', { recipeId: ctx.params.recipeId });
  return r;
}
function recipeAndVersion(ctx: Ctx, versionId: string | null | undefined, recipeId: string | null | undefined) {
  const inv = invOf(ctx.db);
  if (versionId) {
    const r = inv.recipes.find((x) => x.versions.some((v) => v.id === versionId));
    if (!r) throw new ApiError('RECIPES_RECIPEVERSION_NOT_FOUND', { recipeVersionId: versionId });
    return { r, v: r.versions.find((v) => v.id === versionId)! };
  }
  if (!recipeId) throw new ApiError('VALIDATION_FAILED', { field: 'recipeVersionId', rule: 'required' });
  const r = inv.recipes.find((x) => x.id === recipeId);
  if (!r) throw new ApiError('RECIPE_NOT_FOUND', { recipeId });
  return { r, v: activeVersion(r, ctx.now) };
}
function getPo(ctx: Ctx): PurchaseOrder {
  const p = invOf(ctx.db).purchaseOrders.find((x) => x.id === ctx.params.purchaseOrderId);
  if (!p) throw new ApiError('PURCHASE_ORDER_NOT_FOUND', { purchaseOrderId: ctx.params.purchaseOrderId });
  return p;
}
function getReceipt(ctx: Ctx): GoodsReceipt {
  const r = invOf(ctx.db).receipts.find((x) => x.id === ctx.params.receiptId);
  if (!r) throw new ApiError('GOODS_RECEIPT_NOT_FOUND', { receiptId: ctx.params.receiptId });
  return r;
}
function activeSupplier(ctx: Ctx, id: string) {
  const s = invOf(ctx.db).suppliers.find((x) => x.id === id);
  if (!s) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: id });
  if (!s.active) throw new ApiError('VALIDATION_FAILED', { field: 'supplierId', rule: 'supplier is inactive' });
  return s;
}
function parseLines(ctx: Ctx, raw: any, qtyField: string) {
  if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'lines', rule: 'at least one line' });
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const it = getItem(ctx.db, r.itemId, { active: true });
    if (seen.has(it.id)) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].itemId`, rule: 'item listed twice' });
    seen.add(it.id);
    const q = toStockQty(ctx.db, it, posQty(r[qtyField], `lines[${i}].${qtyField}`), r.unit);
    checkPrecision(ctx.db, it, q, `lines[${i}].${qtyField}`);
    return { itemId: it.id, quantity: q };
  });
}
function poLines(ctx: Ctx, raw: any, prev: PurchaseOrder['lines'] = []) {
  if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'lines', rule: 'at least one line' });
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const it = getItem(ctx.db, r.itemId, { active: true });
    if (seen.has(it.id)) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].itemId`, rule: 'item listed twice' });
    seen.add(it.id);
    const pack = r.packId ? it.packs.find((p) => p.id === r.packId) : null;
    if (r.packId && !pack) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, packId: r.packId });
    const q = posQty(r.orderedQuantity, `lines[${i}].orderedQuantity`);
    const cost = money(r.orderedUnitCost, `lines[${i}].orderedUnitCost`);
    if (cost === null) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].orderedUnitCost`, rule: 'required' });
    const keep = prev.find((p) => p.itemId === it.id);
    return { id: keep?.id ?? `pol_${i + 1}_${it.id}`, itemId: it.id, packId: pack?.id ?? null, factor: pack?.factor ?? '1', orderedQuantity: q, orderedUnitCost: cost };
  });
}
function supplierView(db: DB, s: { id: string; name: string } & Record<string, any>) {
  const inv = invOf(db);
  const since = clock.now() - 30 * 86_400_000;
  const recs = inv.receipts.filter((r) => r.supplierId === s.id && r.state === 'POSTED');
  return {
    ...s, openPurchaseOrders: inv.purchaseOrders.filter((p) => p.supplierId === s.id && ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state)).length,
    lastReceiptAt: recs[0]?.at ?? null, purchased30: m4(recs.filter((r) => Date.parse(r.at) >= since).reduce((a, r) => a.plus(r.total), D(0))),
    itemCount: inv.items.filter((i) => i.defaultSupplierId === s.id).length,
  };
}
function supplierReturnView(db: DB, r: any) {
  const inv = invOf(db);
  return { ...r, supplierName: inv.suppliers.find((s) => s.id === r.supplierId)?.name ?? r.supplierId, warehouse: whBrief(db, r.warehouseId), receiptNumber: r.receiptId ? inv.receipts.find((x) => x.id === r.receiptId)?.number ?? null : null, lines: r.lines.map((l: any) => ({ ...l, name: nameOf(db, l.itemId), unit: (() => { const it = inv.items.find((i) => i.id === l.itemId); return it ? unitCode(db, it.stockUnitId) : ''; })() })), userName: r.userId ? userName(db, r.userId) : null };
}
function wasteView(db: DB, w: any) {
  const inv = invOf(db);
  const it = inv.items.find((i) => i.id === w.itemId);
  return { ...w, warehouse: whBrief(db, w.warehouseId), unit: it ? unitCode(db, it.stockUnitId) : null, userName: w.userId ? userName(db, w.userId) : null, approverName: w.approvalGrantId ? userName(db, db.grants.find((g) => g.id === w.approvalGrantId)?.approverUserId) : null, lines: w.itemKind === 'PRODUCT' ? inv.movements.filter((m) => w.movementIds.includes(m.id)).map((m) => ({ name: nameOf(db, m.itemId), quantity: qn(D(m.quantity).negated()), value: m4(D(m.value).negated()) })) : [] };
}
function productionView(db: DB, p: any) {
  return { ...p, output: (() => { const it = invOf(db).items.find((i) => i.id === p.outputItemId); return it ? itemBrief(db, it) : null; })(), warehouse: whBrief(db, p.warehouseId), inputs: p.inputs.map((i: any) => ({ ...i, name: nameOf(db, i.itemId), unit: (() => { const it = invOf(db).items.find((x) => x.id === i.itemId); return it ? unitCode(db, it.stockUnitId) : ''; })() })), userName: p.userId ? userName(db, p.userId) : null };
}
export { INFLOW, menuRecipeOf };
