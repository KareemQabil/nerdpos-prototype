// Round 3 (proposed): purchasing as four linked documents — store request (طلبية مخزن, by the store keeper, suggested
// quantity = target − on hand, editable) → purchase order (the purchasing officer may change quantities) → goods receipt
// (what actually arrived) → supplier invoice generated from the receipt. Also the "direct supplier invoice" (one
// document that receives the stock and costs it), the document chain with its variances (100 → 80 → 60), and pack
// advice: every pack is its own card with the suppliers' prices, compared per stock unit against the consumption.
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { D, m4, Decimal } from '../money';
import { checkVersion, page, userName } from './util';
import type { DB } from '../types';
import type { GoodsReceipt, InvItem, PurchaseOrder, StoreRequest, SupplierInvoice, InventoryState } from '../types-inventory';
import { invOf, qn, newId, nextNumber, toStockQty, checkPrecision, isQty, getItem, getWarehouse, onHand, totalOnHand, unitCode } from './inventory-engine';
import { inventoryHandlers, itemBrief, whBrief, poView, receiptView, branchScope, warehousesIn, poReceived } from './inventory';

const DAY = 86_400_000;
const srs = (inv: InventoryState) => (inv.storeRequests ??= []);
const invoices = (inv: InventoryState) => (inv.invoices ??= []);
const reqText = (ctx: Ctx, f: string) => { const v = ctx.body?.[f]; if (typeof v !== 'string' || !v.trim()) throw new ApiError('VALIDATION_FAILED', { field: f, rule: 'required' }); return v.trim(); };
const posQty = (v: unknown, field: string) => { if (!isQty(v) || !D(v as string).gt(0)) throw new ApiError('VALIDATION_FAILED', { field, rule: 'positive quantity', value: v as any }); return qn(v as string); };
const moneyOf = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === '') return null;
  if (!/^\d+(\.\d{1,4})?$/.test(String(v))) throw new ApiError('VALIDATION_FAILED', { field, rule: 'money ≥ 0 with up to 4 decimals' });
  return m4(String(v));
};

// ───────── pack offers (each pack card remembers each supplier's latest price)
export function recordReceiptOffers(db: DB, gr: GoodsReceipt) {
  const inv = invOf(db);
  for (const l of gr.lines) {
    const it = inv.items.find((i) => i.id === l.itemId);
    const pack = it?.packs.find((p) => p.id === l.packId);
    if (!it || !pack) continue;
    pack.offers = [{ supplierId: gr.supplierId, packPrice: l.packCost, at: gr.at, source: 'RECEIPT', ref: gr.number }, ...(pack.offers ?? []).filter((o) => o.supplierId !== gr.supplierId)];
  }
}

/** Weekly use of an item (sales consumption + kitchen preparation + waste) over the last 4 weeks, in stock units. */
export function weeklyUse(inv: InventoryState, itemId: string, nowMs: number, warehouseIds?: Set<string>) {
  const since = nowMs - 28 * DAY;
  let used = D(0);
  for (let i = inv.movements.length - 1; i >= 0; i--) {
    const m = inv.movements[i];
    if (m.atMs < since) break;
    if (m.itemId !== itemId || (warehouseIds && !warehouseIds.has(m.warehouseId))) continue;
    if (['SALE', 'SALE_REVERSAL', 'PRODUCTION_OUT', 'WASTE', 'VOID_WASTE'].includes(m.kind)) used = used.minus(m.quantity);
  }
  return Decimal.max(used.dividedBy(4), 0);
}

/** Best pack / best supplier for an item, from its pack cards and its consumption. */
export function packAdvice(db: DB, it: InvItem, nowMs: number) {
  const inv = invOf(db);
  const weekly = weeklyUse(inv, it.id, nowMs);
  const supName = (id: string) => inv.suppliers.find((s) => s.id === id)?.name ?? id;
  const cards = it.packs.map((p) => {
    const offers = (p.offers ?? []).map((o) => ({ ...o, supplierName: supName(o.supplierId), unitCost: m4(D(o.packPrice).dividedBy(p.factor)) })).sort((a, b) => D(a.unitCost).comparedTo(b.unitCost));
    const weeksToUse = weekly.gt(0) ? D(p.factor).dividedBy(weekly) : null;
    const daysToUse = weeksToUse ? weeksToUse.times(7) : null;
    let fit: 'OK' | 'TOO_BIG_SHELF' | 'TOO_BIG_CASH' | 'NO_USE' = 'OK';
    if (!weekly.gt(0)) fit = 'NO_USE';
    else if (it.shelfLifeDays && daysToUse!.gt(it.shelfLifeDays)) fit = 'TOO_BIG_SHELF';
    else if (weeksToUse!.gt(8)) fit = 'TOO_BIG_CASH';
    return { id: p.id, name: p.name, factor: p.factor, barcode: p.barcode ?? null, isPurchasePack: it.purchasePackId === p.id, offers, best: offers[0] ?? null, weeksToUse: weeksToUse ? weeksToUse.toDecimalPlaces(1).toString() : null, fit };
  });
  const priced = cards.filter((c) => c.best);
  const usable = priced.filter((c) => c.fit === 'OK' || c.fit === 'NO_USE');
  const pool = usable.length ? usable : priced;
  const bestPack = pool.slice().sort((a, b) => D(a.best!.unitCost).comparedTo(b.best!.unitCost))[0] ?? null;
  const cheapestAny = priced.slice().sort((a, b) => D(a.best!.unitCost).comparedTo(b.best!.unitCost))[0] ?? null;
  // best supplier: lowest unit price across every pack card
  const bySupplier = new Map<string, Decimal>();
  for (const c of priced) for (const o of c.offers) { const cur = bySupplier.get(o.supplierId); if (!cur || D(o.unitCost).lt(cur)) bySupplier.set(o.supplierId, D(o.unitCost)); }
  const bestSup = [...bySupplier].sort((a, b) => a[1].comparedTo(b[1]))[0] ?? null;
  const current = cards.find((c) => c.isPurchasePack)?.best ?? null;
  const monthly = weekly.times(4.33);
  const saving = bestPack && current ? Decimal.max(D(current.unitCost).minus(bestPack.best!.unitCost), 0).times(monthly) : D(0);
  return {
    itemId: it.id, unit: unitCode(db, it.stockUnitId), weeklyUse: qn(weekly.toDecimalPlaces(3)), monthlyUse: qn(monthly.toDecimalPlaces(3)), shelfLifeDays: it.shelfLifeDays,
    cards, bestPackId: bestPack?.id ?? null, bestPackSupplierId: bestPack?.best?.supplierId ?? null, bestPackSupplierName: bestPack?.best?.supplierName ?? null, bestUnitCost: bestPack?.best?.unitCost ?? null,
    bestSupplierId: bestSup?.[0] ?? null, bestSupplierName: bestSup ? supName(bestSup[0]) : null, bestSupplierUnitCost: bestSup ? m4(bestSup[1]) : null,
    cheapestIgnored: cheapestAny && bestPack && cheapestAny.id !== bestPack.id ? { packId: cheapestAny.id, name: cheapestAny.name, fit: cheapestAny.fit, unitCost: cheapestAny.best!.unitCost } : null,
    currentUnitCost: current?.unitCost ?? null, monthlySaving: m4(saving),
  };
}

// ───────── views
function srOrdered(db: DB, sr: StoreRequest) {
  const inv = invOf(db);
  const out = new Map<string, { ordered: Decimal; received: Decimal; invoiced: Decimal }>();
  const pos = inv.purchaseOrders.filter((p) => p.storeRequestId === sr.id && p.state !== 'CANCELLED');
  for (const po of pos) {
    const rec = poReceived(db, po);
    for (const l of po.lines) {
      const key = l.requestLineId ?? sr.lines.find((x) => x.itemId === l.itemId)?.id;
      if (!key) continue;
      const cur = out.get(key) ?? { ordered: D(0), received: D(0), invoiced: D(0) };
      cur.ordered = cur.ordered.plus(D(l.orderedQuantity).times(l.factor));
      cur.received = cur.received.plus(rec.get(l.id) ?? 0);
      out.set(key, cur);
    }
  }
  for (const invc of invoices(inv).filter((x) => x.storeRequestId === sr.id)) for (const l of invc.lines) {
    const key = sr.lines.find((x) => x.itemId === l.itemId)?.id;
    if (!key) continue;
    const cur = out.get(key) ?? { ordered: D(0), received: D(0), invoiced: D(0) };
    cur.invoiced = cur.invoiced.plus(l.quantity);
    out.set(key, cur);
  }
  return out;
}
function srView(db: DB, sr: StoreRequest) {
  const inv = invOf(db);
  const agg = srOrdered(db, sr);
  return {
    ...sr, warehouse: whBrief(db, sr.warehouseId), createdByName: userName(db, sr.createdBy), submittedByName: sr.submittedBy ? userName(db, sr.submittedBy) : null,
    lines: sr.lines.map((l) => {
      const it = inv.items.find((i) => i.id === l.itemId);
      const a = agg.get(l.id);
      return { ...l, item: it ? itemBrief(db, it) : null, orderedQuantity: qn(a?.ordered ?? 0), receivedQuantity: qn(a?.received ?? 0), invoicedQuantity: qn(a?.invoiced ?? 0), onHandNow: onHand(inv, l.itemId, sr.warehouseId), defaultSupplierId: it?.defaultSupplierId ?? null };
    }),
    purchaseOrders: inv.purchaseOrders.filter((p) => sr.purchaseOrderIds.includes(p.id)).map((p) => ({ id: p.id, number: p.number, state: p.state, supplierName: inv.suppliers.find((s) => s.id === p.supplierId)?.name ?? p.supplierId })),
  };
}
function invoiceView(db: DB, x: SupplierInvoice) {
  const inv = invOf(db);
  return {
    ...x, supplierName: inv.suppliers.find((s) => s.id === x.supplierId)?.name ?? x.supplierId, warehouse: whBrief(db, x.warehouseId), userName: x.userId ? userName(db, x.userId) : null,
    receiptNumbers: x.receiptIds.map((id) => inv.receipts.find((r) => r.id === id)?.number ?? id),
    purchaseOrderNumber: x.purchaseOrderId ? inv.purchaseOrders.find((p) => p.id === x.purchaseOrderId)?.number ?? null : null,
    storeRequestNumber: x.storeRequestId ? srs(inv).find((s) => s.id === x.storeRequestId)?.number ?? null : null,
    lines: x.lines.map((l) => { const it = inv.items.find((i) => i.id === l.itemId); return { ...l, item: it ? itemBrief(db, it) : null }; }),
  };
}

/** Suggested lines for a warehouse: every active item that has a level there; short ones flagged. */
function suggestRows(db: DB, warehouseId: string, nowMs: number) {
  const inv = invOf(db);
  const rows = [];
  for (const it of inv.items.filter((i) => i.active && i.levels[warehouseId])) {
    const lv = it.levels[warehouseId];
    const q = D(onHand(inv, it.id, warehouseId));
    const suggested = Decimal.max(D(lv.par).minus(q), 0);
    const onOrder = inv.purchaseOrders.filter((p) => p.warehouseId === warehouseId && ['DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state)).reduce((a, p) => {
      const rec = poReceived(db, p);
      return a.plus(p.lines.filter((l) => l.itemId === it.id).reduce((b, l) => b.plus(Decimal.max(D(l.orderedQuantity).times(l.factor).minus(rec.get(l.id) ?? 0), 0)), D(0)));
    }, D(0));
    rows.push({ item: itemBrief(db, it), onHand: qn(q), min: lv.min, target: lv.par, suggestedQuantity: qn(suggested), short: q.lte(lv.min), onOrder: qn(onOrder), weeklyUse: qn(weeklyUse(inv, it.id, nowMs, new Set([warehouseId])).toDecimalPlaces(3)), defaultSupplierId: it.defaultSupplierId, defaultSupplierName: inv.suppliers.find((s) => s.id === it.defaultSupplierId)?.name ?? null });
  }
  rows.sort((a, b) => Number(b.short) - Number(a.short) || a.item.category.localeCompare(b.item.category) || a.item.name.ar.localeCompare(b.item.name.ar));
  return rows;
}

function getSr(ctx: Ctx): StoreRequest {
  const sr = srs(invOf(ctx.db)).find((x) => x.id === ctx.params.storeRequestId);
  if (!sr) throw new ApiError('STORE_REQUEST_NOT_FOUND', { storeRequestId: ctx.params.storeRequestId });
  return sr;
}

/** The chain of documents around any one of them, with per-item quantities at every stage. */
function chainOf(db: DB, q: Record<string, string>) {
  const inv = invOf(db);
  let sr: StoreRequest | null = null;
  let pos: PurchaseOrder[] = [];
  let recs: GoodsReceipt[] = [];
  let invs: SupplierInvoice[] = [];
  if (q.invoiceId) { const x = invoices(inv).find((i) => i.id === q.invoiceId); if (!x) throw new ApiError('SUPPLIER_INVOICE_NOT_FOUND', { invoiceId: q.invoiceId }); invs = [x]; if (x.storeRequestId) q = { storeRequestId: x.storeRequestId }; else if (x.purchaseOrderId) q = { purchaseOrderId: x.purchaseOrderId }; else recs = inv.receipts.filter((r) => x.receiptIds.includes(r.id)); }
  if (q.receiptId) { const r = inv.receipts.find((x) => x.id === q.receiptId); if (!r) throw new ApiError('GOODS_RECEIPT_NOT_FOUND', { receiptId: q.receiptId }); if (r.purchaseOrderId) q = { purchaseOrderId: r.purchaseOrderId }; else { recs = [r]; invs = invoices(inv).filter((i) => i.receiptIds.includes(r.id)); } }
  if (q.purchaseOrderId) { const p = inv.purchaseOrders.find((x) => x.id === q.purchaseOrderId); if (!p) throw new ApiError('PURCHASE_ORDER_NOT_FOUND', { purchaseOrderId: q.purchaseOrderId }); if (p.storeRequestId) q = { storeRequestId: p.storeRequestId }; else pos = [p]; }
  if (q.storeRequestId) { sr = srs(inv).find((x) => x.id === q.storeRequestId) ?? null; if (!sr) throw new ApiError('STORE_REQUEST_NOT_FOUND', { storeRequestId: q.storeRequestId }); pos = inv.purchaseOrders.filter((p) => p.storeRequestId === sr!.id); }
  if (pos.length) recs = inv.receipts.filter((r) => r.purchaseOrderId && pos.some((p) => p.id === r.purchaseOrderId));
  if (recs.length || sr) invs = invoices(inv).filter((i) => i.receiptIds.some((id) => recs.some((r) => r.id === id)) || (sr && i.storeRequestId === sr.id));
  const items = new Map<string, { requested: Decimal | null; ordered: Decimal | null; received: Decimal; invoiced: Decimal }>();
  const row = (id: string) => { let r = items.get(id); if (!r) { r = { requested: null, ordered: null, received: D(0), invoiced: D(0) }; items.set(id, r); } return r; };
  for (const l of sr?.lines ?? []) { const r = row(l.itemId); r.requested = (r.requested ?? D(0)).plus(l.requestedQuantity); }
  for (const p of pos.filter((x) => x.state !== 'CANCELLED')) for (const l of p.lines) { const r = row(l.itemId); r.ordered = (r.ordered ?? D(0)).plus(D(l.orderedQuantity).times(l.factor)); }
  for (const g of recs.filter((x) => x.state === 'POSTED')) for (const l of g.lines) row(l.itemId).received = row(l.itemId).received.plus(l.quantity);
  for (const i of invs) for (const l of i.lines) row(l.itemId).invoiced = row(l.itemId).invoiced.plus(l.quantity);
  const wh = sr?.warehouseId ?? pos[0]?.warehouseId ?? recs[0]?.warehouseId ?? invs[0]?.warehouseId ?? null;
  return {
    storeRequest: sr ? { id: sr.id, number: sr.number, state: sr.state, at: sr.createdAt, byName: userName(db, sr.createdBy) } : null,
    purchaseOrders: pos.map((p) => ({ id: p.id, number: p.number, state: p.state, at: p.createdAt, supplierName: inv.suppliers.find((s) => s.id === p.supplierId)?.name ?? '', byName: userName(db, p.createdBy), total: poView(db, p).total })),
    receipts: recs.map((r) => ({ id: r.id, number: r.number, state: r.state, at: r.at, total: r.total, byName: r.userId ? userName(db, r.userId) : null, invoiceId: r.invoiceId ?? null })),
    invoices: invs.map((i) => ({ id: i.id, number: i.number, kind: i.kind, at: i.at, total: i.total, supplierInvoiceNo: i.supplierInvoiceNo })),
    items: [...items].map(([itemId, r]) => {
      const it = inv.items.find((i) => i.id === itemId);
      return { item: it ? itemBrief(db, it) : null, requested: r.requested ? qn(r.requested) : null, ordered: r.ordered ? qn(r.ordered) : null, received: qn(r.received), invoiced: qn(r.invoiced), onHandNow: wh ? onHand(inv, itemId, wh) : null };
    }),
    warehouse: wh ? whBrief(db, wh) : null,
  };
}

function invoiceTotals(lines: SupplierInvoice['lines'], tax: string | null) {
  const subtotal = lines.reduce((a, l) => a.plus(l.value), D(0));
  const taxAmount = D(tax ?? 0);
  return { subtotal: m4(subtotal), taxAmount: m4(taxAmount), total: m4(subtotal.plus(taxAmount)), priceVariance: m4(lines.reduce((a, l) => a.plus(l.priceVariance), D(0))) };
}

export const procureHandlers: Record<string, Handler> = {
  // ───── store requests (طلبية مخزن)
  'StoreRequest.Suggest': (ctx) => {
    const w = getWarehouse(ctx.db, ctx.query.warehouseId, { active: true });
    const rows = suggestRows(ctx.db, w.id, ctx.now);
    return { warehouse: whBrief(ctx.db, w.id), items: rows, shortCount: rows.filter((r) => r.short).length };
  },
  'StoreRequest.Create': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const w = getWarehouse(db, ctx.body.warehouseId, { active: true });
    const raw: any[] = ctx.body.lines;
    if (!Array.isArray(raw) || !raw.length) throw new ApiError('VALIDATION_FAILED', { field: 'lines', rule: 'at least one line' });
    const seen = new Set<string>();
    const lines = raw.map((r, i) => {
      const it = getItem(db, r.itemId, { active: true });
      if (seen.has(it.id)) throw new ApiError('VALIDATION_FAILED', { field: `lines[${i}].itemId`, rule: 'item listed twice' });
      seen.add(it.id);
      const qty = toStockQty(db, it, posQty(r.requestedQuantity, `lines[${i}].requestedQuantity`), r.unit);
      checkPrecision(db, it, qty, `lines[${i}].requestedQuantity`);
      const lv = it.levels[w.id] ?? null;
      const have = onHand(inv, it.id, w.id);
      return { id: `srl_${i + 1}_${it.id}`, itemId: it.id, onHand: have, min: lv?.min ?? null, target: lv?.par ?? null, suggestedQuantity: lv ? qn(Decimal.max(D(lv.par).minus(have), 0)) : '0', requestedQuantity: qty, note: (r.note ?? '').trim() || null };
    });
    const submit = ctx.body.submit !== false;
    const sr: StoreRequest = {
      id: newId(inv, 'sr'), number: nextNumber(inv, 'SR'), warehouseId: w.id, branchId: w.branchId, state: submit ? 'SUBMITTED' : 'DRAFT', lines, note: (ctx.body.note ?? '').trim() || null, neededBy: ctx.body.neededBy || null,
      createdAt: ctx.nowIso, createdBy: ctx.user!.id, submittedAt: submit ? ctx.nowIso : null, submittedBy: submit ? ctx.user!.id : null, cancelledAt: null, cancelReason: null, purchaseOrderIds: [], version: 1,
      history: [{ at: ctx.nowIso, by: ctx.user!.id, text: submit ? 'SUBMITTED' : 'DRAFT' }],
    };
    srs(inv).unshift(sr);
    ctx.audit(`store request ${sr.number} (${lines.length} items) for ${w.name}`, sr.id);
    return { status: 201, body: srView(db, sr) };
  },
  'StoreRequest.Submit': (ctx) => {
    const sr = getSr(ctx);
    if (sr.state !== 'DRAFT') throw new ApiError('STORE_REQUEST_NOT_OPEN', { state: sr.state });
    checkVersion(sr, ctx.body.expectedVersion);
    sr.state = 'SUBMITTED'; sr.submittedAt = ctx.nowIso; sr.submittedBy = ctx.user!.id; sr.version++;
    sr.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: 'SUBMITTED' });
    return srView(ctx.db, sr);
  },
  'StoreRequest.Cancel': (ctx) => {
    const sr = getSr(ctx);
    if (!['DRAFT', 'SUBMITTED'].includes(sr.state)) throw new ApiError('STORE_REQUEST_NOT_OPEN', { state: sr.state });
    checkVersion(sr, ctx.body.expectedVersion);
    sr.cancelReason = reqText(ctx, 'reason');
    sr.state = 'CANCELLED'; sr.cancelledAt = ctx.nowIso; sr.version++;
    sr.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `CANCELLED — ${sr.cancelReason}` });
    ctx.audit(`store request ${sr.number} cancelled`, sr.id);
    return srView(ctx.db, sr);
  },
  'StoreRequest.Find': (ctx) => {
    let list = srs(invOf(ctx.db));
    const scope = branchScope(ctx);
    if (scope) list = list.filter((x) => x.branchId === scope);
    if (ctx.query.state) list = list.filter((x) => ctx.query.state.split(',').includes(x.state));
    if (ctx.query.itemId) list = list.filter((x) => x.lines.some((l) => l.itemId === ctx.query.itemId));
    return page(list.map((x) => srView(ctx.db, x)), ctx.query);
  },
  'StoreRequest.Get': (ctx) => srView(ctx.db, getSr(ctx)),
  /** The purchasing officer turns the request into purchase orders (one per supplier); quantities may differ from the request. */
  'StoreRequest.CreatePurchaseOrders': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const sr = getSr(ctx);
    if (sr.state !== 'SUBMITTED') throw new ApiError('STORE_REQUEST_NOT_OPEN', { state: sr.state, rule: sr.state === 'DRAFT' ? 'submit the request first' : undefined });
    checkVersion(sr, ctx.body.expectedVersion);
    const orders: any[] = ctx.body.orders;
    if (!Array.isArray(orders) || !orders.length) throw new ApiError('VALIDATION_FAILED', { field: 'orders', rule: 'at least one purchase order' });
    const created: PurchaseOrder[] = [];
    for (const [oi, o] of orders.entries()) {
      const s = inv.suppliers.find((x) => x.id === o.supplierId);
      if (!s) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: o.supplierId });
      if (!s.active) throw new ApiError('VALIDATION_FAILED', { field: `orders[${oi}].supplierId`, rule: 'supplier is inactive' });
      const w = getWarehouse(db, o.warehouseId || sr.warehouseId, { active: true });
      if (!Array.isArray(o.lines) || !o.lines.length) throw new ApiError('VALIDATION_FAILED', { field: `orders[${oi}].lines`, rule: 'at least one line' });
      const lines = o.lines.map((r: any, i: number) => {
        const rl = sr.lines.find((x) => x.id === r.requestLineId);
        if (!rl) throw new ApiError('VALIDATION_FAILED', { field: `orders[${oi}].lines[${i}].requestLineId`, rule: 'line is not on the store request' });
        const it = getItem(db, rl.itemId, { active: true });
        const pack = r.packId ? it.packs.find((p) => p.id === r.packId) : null;
        if (r.packId && !pack) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, packId: r.packId });
        const cost = moneyOf(r.orderedUnitCost, `orders[${oi}].lines[${i}].orderedUnitCost`);
        if (cost === null) throw new ApiError('VALIDATION_FAILED', { field: `orders[${oi}].lines[${i}].orderedUnitCost`, rule: 'required' });
        return { id: `pol_${i + 1}_${it.id}`, itemId: it.id, packId: pack?.id ?? null, factor: pack?.factor ?? '1', orderedQuantity: posQty(r.orderedQuantity, `orders[${oi}].lines[${i}].orderedQuantity`), orderedUnitCost: cost, requestLineId: rl.id, requestedQuantity: rl.requestedQuantity };
      });
      const po: PurchaseOrder = {
        id: newId(inv, 'po'), number: nextNumber(inv, 'PO'), supplierId: s.id, warehouseId: w.id, branchId: w.branchId, state: 'DRAFT', lines,
        expectedDate: o.expectedDate || null, note: (o.note ?? '').trim() || `من طلبية المخزن ${sr.number}`, createdAt: ctx.nowIso, createdBy: ctx.user!.id, issuedAt: null, issuedBy: null,
        closedAt: null, closedBy: null, closeReason: null, cancelledAt: null, cancelReason: null, version: 1, history: [{ at: ctx.nowIso, by: ctx.user!.id, text: `DRAFT — ${sr.number}` }], storeRequestId: sr.id,
      };
      if (o.issue) { po.state = 'ISSUED'; po.issuedAt = ctx.nowIso; po.issuedBy = ctx.user!.id; po.version++; po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: 'ISSUED' }); }
      inv.purchaseOrders.unshift(po);
      created.push(po);
      sr.purchaseOrderIds.push(po.id);
    }
    sr.state = 'ORDERED'; sr.version++;
    sr.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `ORDERED → ${created.map((p) => p.number).join(', ')}` });
    ctx.audit(`store request ${sr.number} → purchase orders ${created.map((p) => p.number).join(', ')}`, sr.id);
    return { status: 201, body: { storeRequest: srView(db, sr), purchaseOrders: created.map((p) => poView(db, p)) } };
  },

  // ───── supplier invoices
  /** Invoice generated from receipts: quantities are what was received (never what was requested or ordered). */
  'SupplierInvoice.FromReceipt': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const ids: string[] = Array.isArray(ctx.body.receiptIds) ? ctx.body.receiptIds : ctx.body.receiptId ? [ctx.body.receiptId] : [];
    if (!ids.length) throw new ApiError('VALIDATION_FAILED', { field: 'receiptIds', rule: 'at least one receipt' });
    const recs = ids.map((id) => {
      const r = inv.receipts.find((x) => x.id === id);
      if (!r) throw new ApiError('GOODS_RECEIPT_NOT_FOUND', { receiptId: id });
      if (r.state !== 'POSTED') throw new ApiError('RECEIPT_ALREADY_REVERSED', { receiptId: id });
      if (r.invoiceId) throw new ApiError('RECEIPT_ALREADY_INVOICED', { receipt: r.number, invoice: invoices(inv).find((x) => x.id === r.invoiceId)?.number ?? r.invoiceId });
      return r;
    });
    if (new Set(recs.map((r) => r.supplierId)).size > 1) throw new ApiError('VALIDATION_FAILED', { field: 'receiptIds', rule: 'receipts of one supplier only' });
    const prices: Record<string, string> = {};
    for (const p of Array.isArray(ctx.body.lines) ? ctx.body.lines : []) if (p?.receiptLineId) prices[p.receiptLineId] = moneyOf(p.packCost, 'lines.packCost') ?? '';
    const lines: SupplierInvoice['lines'] = [];
    for (const r of recs) for (const l of r.lines) {
      const key = `${r.id}:${l.id}`;
      const packCost = prices[key] || l.packCost;
      const value = m4(D(l.packQuantity).times(packCost));
      lines.push({ id: `sil_${lines.length + 1}`, itemId: l.itemId, receiptLineId: key, packId: l.packId, factor: l.factor, packQuantity: l.packQuantity, quantity: l.quantity, receivedPackCost: l.packCost, packCost: m4(packCost), value, priceVariance: m4(D(value).minus(D(l.packQuantity).times(l.packCost))) });
    }
    const po = recs[0].purchaseOrderId ? inv.purchaseOrders.find((p) => p.id === recs[0].purchaseOrderId) ?? null : null;
    const w = getWarehouse(db, recs[0].warehouseId);
    const tax = moneyOf(ctx.body.taxAmount, 'taxAmount');
    const x: SupplierInvoice = {
      id: newId(inv, 'sinv'), number: nextNumber(inv, 'INV'), kind: 'FROM_RECEIPT', supplierId: recs[0].supplierId, supplierInvoiceNo: (ctx.body.supplierInvoiceNo ?? '').trim() || recs.find((r) => r.supplierInvoiceNo)?.supplierInvoiceNo || null,
      warehouseId: w.id, branchId: w.branchId, receiptIds: recs.map((r) => r.id), purchaseOrderId: po?.id ?? null, storeRequestId: po?.storeRequestId ?? null, lines,
      ...invoiceTotals(lines, tax), dueDate: ctx.body.dueDate || null, state: 'POSTED', at: ctx.nowIso, businessDate: ctx.businessDate(w.branchId), userId: ctx.user!.id, note: (ctx.body.note ?? '').trim() || null,
    };
    invoices(inv).unshift(x);
    for (const r of recs) r.invoiceId = x.id;
    if (po) { po.version++; po.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: `invoiced ${x.number}` }); }
    // supplier price on each pack card follows the invoice (the price that is actually paid)
    for (const l of lines) {
      const pack = inv.items.find((i) => i.id === l.itemId)?.packs.find((p) => p.id === l.packId);
      if (pack) pack.offers = [{ supplierId: x.supplierId, packPrice: l.packCost, at: x.at, source: 'INVOICE', ref: x.number }, ...(pack.offers ?? []).filter((o) => o.supplierId !== x.supplierId)];
    }
    ctx.audit(`supplier invoice ${x.number} from ${x.receiptIds.length} receipt(s) total ${x.total}`, x.id);
    return { status: 201, body: invoiceView(db, x) };
  },
  /** One document that receives the goods (stock + cost) and records the supplier's invoice — no purchase order. */
  'SupplierInvoice.PostDirect': (ctx) => {
    const db = ctx.db;
    const inv = invOf(db);
    const tax = moneyOf(ctx.body.taxAmount, 'taxAmount');
    const res: any = inventoryHandlers['GoodsReceipt.Post']({ ...ctx, body: { supplierId: ctx.body.supplierId, warehouseId: ctx.body.warehouseId, supplierInvoiceNo: ctx.body.supplierInvoiceNo, note: ctx.body.note, lines: ctx.body.lines, approvalGrantId: ctx.body.approvalGrantId } });
    const gr = inv.receipts.find((r) => r.id === res.body.id)!;
    const w = getWarehouse(db, gr.warehouseId);
    const lines: SupplierInvoice['lines'] = gr.lines.map((l, i) => ({ id: `sil_${i + 1}`, itemId: l.itemId, receiptLineId: `${gr.id}:${l.id}`, packId: l.packId, factor: l.factor, packQuantity: l.packQuantity, quantity: l.quantity, receivedPackCost: l.packCost, packCost: l.packCost, value: m4(D(l.packQuantity).times(l.packCost)), priceVariance: m4(0) }));
    const x: SupplierInvoice = {
      id: newId(inv, 'sinv'), number: nextNumber(inv, 'INV'), kind: 'DIRECT', supplierId: gr.supplierId, supplierInvoiceNo: gr.supplierInvoiceNo, warehouseId: w.id, branchId: w.branchId,
      receiptIds: [gr.id], purchaseOrderId: null, storeRequestId: null, lines, ...invoiceTotals(lines, tax), dueDate: ctx.body.dueDate || null, state: 'POSTED',
      at: ctx.nowIso, businessDate: gr.businessDate, userId: ctx.user!.id, note: gr.note,
    };
    invoices(inv).unshift(x);
    gr.invoiceId = x.id;
    ctx.audit(`direct supplier invoice ${x.number} (receipt ${gr.number}) total ${x.total}`, x.id);
    return { status: 201, body: { ...invoiceView(db, x), receipt: receiptView(db, gr) } };
  },
  'SupplierInvoice.Find': (ctx) => {
    let list = invoices(invOf(ctx.db));
    const whs = new Set(warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id));
    list = list.filter((x) => whs.has(x.warehouseId));
    if (ctx.query.supplierId) list = list.filter((x) => x.supplierId === ctx.query.supplierId);
    if (ctx.query.kind) list = list.filter((x) => x.kind === ctx.query.kind);
    if (ctx.query.itemId) list = list.filter((x) => x.lines.some((l) => l.itemId === ctx.query.itemId));
    return page(list.map((x) => invoiceView(ctx.db, x)), ctx.query);
  },
  'SupplierInvoice.Get': (ctx) => {
    const x = invoices(invOf(ctx.db)).find((i) => i.id === ctx.params.invoiceId);
    if (!x) throw new ApiError('SUPPLIER_INVOICE_NOT_FOUND', { invoiceId: ctx.params.invoiceId });
    return invoiceView(ctx.db, x);
  },
  /** Receipts still waiting for their supplier invoice. */
  'SupplierInvoice.Pending': (ctx) => {
    const whs = new Set(warehousesIn(ctx.db, branchScope(ctx)).map((w) => w.id));
    const list = invOf(ctx.db).receipts.filter((r) => r.state === 'POSTED' && !r.invoiceId && whs.has(r.warehouseId) && (!ctx.query.supplierId || r.supplierId === ctx.query.supplierId));
    return page(list.map((r) => receiptView(ctx.db, r)), ctx.query);
  },

  // ───── the chain and its variances
  'Procurement.Chain': (ctx) => chainOf(ctx.db, { ...ctx.query }),

  // ───── pack cards
  'InventoryItem.PackAdvice': (ctx) => packAdvice(ctx.db, getItem(ctx.db, ctx.params.inventoryItemId), ctx.now),
  'InventoryItem.SetPackOffer': (ctx) => {
    const db = ctx.db;
    const it = getItem(db, ctx.params.inventoryItemId);
    const pack = it.packs.find((p) => p.id === ctx.params.packId);
    if (!pack) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: it.id, packId: ctx.params.packId });
    const s = invOf(db).suppliers.find((x) => x.id === ctx.body.supplierId);
    if (!s) throw new ApiError('SUPPLIER_NOT_FOUND', { supplierId: ctx.body.supplierId });
    const price = moneyOf(ctx.body.packPrice, 'packPrice');
    if (!price || !D(price).gt(0)) throw new ApiError('VALIDATION_FAILED', { field: 'packPrice', rule: 'positive amount' });
    pack.offers = [{ supplierId: s.id, packPrice: price, at: ctx.nowIso, source: 'PRICE_LIST', ref: null }, ...(pack.offers ?? []).filter((o) => o.supplierId !== s.id)];
    it.version++;
    ctx.audit(`pack price ${it.name.ar} / ${pack.name.ar} from ${s.name}: ${price}`, it.id);
    return packAdvice(db, it, ctx.now);
  },
};

export { srView, invoiceView, chainOf, srs, invoices, totalOnHand };
