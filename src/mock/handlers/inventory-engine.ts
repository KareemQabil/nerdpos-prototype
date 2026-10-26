// Inventory engine: the one place that changes stock. Every change is an immutable movement with cost and running
// balance; moving-average cost per item (all warehouses); lots consumed first-expiry-first-out.
// Used by the inventory handlers, the sales consumer and the demo seed. Decimal only, never floats.
import { ApiError } from '../errors';
import { policy } from '../policies';
import { businessDate as bizDate, zonedParts } from '../clock';
import { priceRuleAt } from '../pricing';
import { D, m4, q6, Decimal } from '../money';
import type { DB, Channel, Loc } from '../types';
import type {
  InventoryState, InvItem, InvBalance, InvLot, StockMovement, MovementKind, MovementSource, Recipe, RecipeVersion, Warehouse,
} from '../types-inventory';

export function emptyInventory(): InventoryState {
  return {
    warehouses: [], items: [], balances: [], lots: [], movements: [], counts: [], transfers: [], waste: [], recipes: [], production: [],
    suppliers: [], purchaseOrders: [], receipts: [], supplierReturns: [], customerReturns: [], orderEffects: {}, seq: 0, numbers: {},
  };
}
export function invOf(db: DB): InventoryState { return ((db as any).inv ??= emptyInventory()); }

/** Quantity string: up to 6 decimals, no trailing zeros. */
export function qn(v: Decimal.Value): string {
  const s = q6(v);
  return s === '-0' ? '0' : s;
}

export function newId(inv: InventoryState, prefix: string) { inv.seq++; return `${prefix}_${inv.seq}`; }
export function nextNumber(inv: InventoryState, prefix: string) {
  inv.numbers[prefix] = (inv.numbers[prefix] ?? 0) + 1;
  return `${prefix}-${String(inv.numbers[prefix]).padStart(4, '0')}`;
}

function cairoDate(ms: number) { const p = zonedParts(ms, 'Africa/Cairo'); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }

// ───────── units
/** Standard unit codes and how they convert (same dimension only). */
export const UNIT_DIM: Record<string, { dim: 'MASS' | 'VOL' | 'COUNT'; f: string }> = {
  KG: { dim: 'MASS', f: '1' }, G: { dim: 'MASS', f: '0.001' }, L: { dim: 'VOL', f: '1' }, ML: { dim: 'VOL', f: '0.001' }, PCS: { dim: 'COUNT', f: '1' }, DEMO_EA: { dim: 'COUNT', f: '1' }, EA: { dim: 'COUNT', f: '1' },
};
export const unitCode = (db: DB, unitId: string) => db.units.find((u) => u.id === unitId)?.code ?? unitId;
export const unitPrecision = (db: DB, unitId: string) => db.units.find((u) => u.id === unitId)?.precision ?? 3;

/** Convert a quantity entered in `unit` (a catalog unit id, a pack id of the item, or '' = stock unit) to stock units. */
export function toStockQty(db: DB, item: InvItem, qty: Decimal.Value, unit?: string | null): string {
  if (!unit || unit === item.stockUnitId) return qn(qty);
  const pack = item.packs.find((p) => p.id === unit);
  if (pack) return qn(D(qty).times(pack.factor));
  const from = UNIT_DIM[unitCode(db, unit)];
  const to = UNIT_DIM[unitCode(db, item.stockUnitId)];
  if (!from || !to || from.dim !== to.dim) throw new ApiError('STOCK_UNIT_MISMATCH', { itemId: item.id, unitId: unit, stockUnitId: item.stockUnitId });
  return qn(D(qty).times(from.f).dividedBy(to.f));
}

export function checkPrecision(db: DB, item: InvItem, qty: string, field = 'quantity') {
  const p = unitPrecision(db, item.stockUnitId);
  const dec = (qty.split('.')[1] ?? '').replace(/0+$/, '').length;
  if (dec > Math.max(p, 0)) throw new ApiError('QUANTITY_PRECISION_UNSUPPORTED', { field, quantity: qty, precision: p, unit: unitCode(db, item.stockUnitId) });
}

export const isQty = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^-?\d+(\.\d{1,6})?$/.test(String(v));

// ───────── lookups
export function getItem(db: DB, id: string, opts: { active?: boolean } = {}): InvItem {
  const it = invOf(db).items.find((x) => x.id === id);
  if (!it) throw new ApiError('INVENTORY_ITEM_NOT_FOUND', { inventoryItemId: id });
  if (opts.active && !it.active) throw new ApiError('INVENTORY_ITEM_INACTIVE', { inventoryItemId: id });
  return it;
}
export function getWarehouse(db: DB, id: string, opts: { active?: boolean } = {}): Warehouse {
  const w = invOf(db).warehouses.find((x) => x.id === id);
  if (!w) throw new ApiError('WAREHOUSE_NOT_FOUND', { warehouseId: id });
  if (opts.active && !w.active) throw new ApiError('WAREHOUSE_INACTIVE', { warehouseId: id });
  return w;
}
export function balanceOf(inv: InventoryState, itemId: string, warehouseId: string): InvBalance {
  let b = inv.balances.find((x) => x.itemId === itemId && x.warehouseId === warehouseId);
  if (!b) { b = { itemId, warehouseId, quantity: '0', version: 0, updatedAt: new Date(0).toISOString() }; inv.balances.push(b); }
  return b;
}
export function onHand(inv: InventoryState, itemId: string, warehouseId: string): string {
  return inv.balances.find((x) => x.itemId === itemId && x.warehouseId === warehouseId)?.quantity ?? '0';
}
export function totalOnHand(inv: InventoryState, itemId: string) {
  return inv.balances.filter((b) => b.itemId === itemId).reduce((a, b) => a.plus(b.quantity), D(0));
}

export function salesWarehouse(db: DB, branchId: string): Warehouse | null {
  return invOf(db).warehouses.find((w) => w.branchId === branchId && w.salesDefault && w.active) ?? null;
}

export function negativeAllowed(db: DB, item: InvItem, branchId: string | null): boolean {
  if (item.allowNegative === true) return true;
  if (item.allowNegative === false) return false;
  return (policy<string>('NegativeStockPolicy', { branchId }) ?? 'BLOCK') === 'ALLOW';
}

// ───────── posting
export interface Actor { userId: string | null; nowMs: number; commandId?: string | null; grantId?: string | null }
export interface PostInput {
  itemId: string; warehouseId: string; kind: MovementKind; quantity: Decimal.Value; unitCost?: Decimal.Value | null;
  /** inflow at a purchase/production cost, or an outflow that removes value at a known cost (receipt reversal, supplier return) */
  updateAvg?: boolean; reason?: string | null; note?: string | null; source: MovementSource;
  lot?: { lotCode?: string | null; expiryDate?: string | null } | null;
  lotsIn?: { lotCode: string; expiryDate: string | null; quantity: string }[];
  preferLotRef?: string | null;
  negative?: 'POLICY' | 'ALLOW';
}


export function post(db: DB, actor: Actor, m: PostInput): StockMovement {
  const inv = invOf(db);
  const item = getItem(db, m.itemId);
  const wh = getWarehouse(db, m.warehouseId);
  const q = D(m.quantity);
  if (q.isZero()) throw new ApiError('STOCK_MOVEMENT_REJECTED', { reason: 'zero quantity', itemId: item.id, kind: m.kind, source: m.source.number ?? m.source.id });
  const bal = balanceOf(inv, item.id, wh.id);
  const before = D(bal.quantity);
  const after = before.plus(q);
  let negative = false;
  if (q.lt(0) && after.lt(0)) {
    if (m.negative === 'ALLOW' || negativeAllowed(db, item, wh.branchId)) negative = true;
    else throw new ApiError('NEGATIVE_STOCK_BLOCKED', { itemId: item.id, item: item.name.ar, warehouseId: wh.id, warehouse: wh.name, onHand: qn(before), requested: qn(q.negated()) });
  }
  const avg = D(item.avgCost);
  const cost = m.unitCost !== undefined && m.unitCost !== null ? D(m.unitCost) : avg;
  // moving-average cost across all warehouses
  if (m.updateAvg) {
    const Q = totalOnHand(inv, item.id);
    let next = avg;
    if (q.gt(0)) next = Q.lte(0) ? cost : Q.times(avg).plus(q.times(cost)).dividedBy(Q.plus(q));
    else if (Q.plus(q).gt(0)) next = Q.times(avg).plus(q.times(cost)).dividedBy(Q.plus(q));
    if (next.lt(0)) next = D(0);
    const nextS = m4(next);
    if (nextS !== item.avgCost || m.kind === 'RECEIPT') {
      item.costHistory.unshift({ at: new Date(actor.nowMs).toISOString(), avgCost: nextS, unitCost: m4(cost), source: m.kind, ref: m.source.number ?? m.source.id });
      if (item.costHistory.length > 40) item.costHistory.length = 40;
    }
    item.avgCost = nextS;
    if (m.kind === 'RECEIPT' || m.kind === 'OPENING') item.lastCost = m4(cost);
  }
  // lots
  const at = new Date(actor.nowMs).toISOString();
  const allocations: StockMovement['lots'] = [];
  if (q.gt(0)) {
    if (m.lotsIn?.length) {
      for (const l of m.lotsIn) allocations.push(addLot(inv, item, wh.id, l.lotCode, l.expiryDate, l.quantity, m4(cost), at, m.source.id));
      const rest = q.minus(m.lotsIn.reduce((a, l) => a.plus(l.quantity), D(0)));
      if (rest.gt(0)) topUpLot(inv, item, wh.id, rest, at, allocations, m4(cost), m.source.id);
    } else if (m.lot || (item.trackLots && (m.kind === 'RECEIPT' || m.kind === 'OPENING' || m.kind === 'PRODUCTION_IN'))) {
      const expiry = m.lot?.expiryDate ?? (item.shelfLifeDays ? cairoDate(actor.nowMs + item.shelfLifeDays * 86_400_000) : null);
      const code = m.lot?.lotCode || `L${at.slice(2, 10).replace(/-/g, '')}-${inv.lots.length + 1}`;
      allocations.push(addLot(inv, item, wh.id, code, expiry, qn(q), m4(cost), at, m.source.id));
    } else if (item.trackLots) {
      topUpLot(inv, item, wh.id, q, at, allocations, m4(cost), m.source.id);
    }
  } else {
    let need = q.negated();
    const lots = inv.lots
      .filter((l) => l.itemId === item.id && l.warehouseId === wh.id && D(l.remaining).gt(0))
      .sort((a, b) => (m.preferLotRef ? Number(b.sourceRef === m.preferLotRef) - Number(a.sourceRef === m.preferLotRef) : 0)
        || (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999') || a.receivedAt.localeCompare(b.receivedAt));
    for (const l of lots) {
      if (!need.gt(0)) break;
      const take = Decimal.min(need, D(l.remaining));
      l.remaining = qn(D(l.remaining).minus(take));
      need = need.minus(take);
      allocations.push({ lotId: l.id, lotCode: l.lotCode, expiryDate: l.expiryDate, quantity: qn(take) });
    }
  }
  bal.quantity = qn(after);
  bal.version++;
  bal.updatedAt = at;
  inv.numbers.mv = (inv.numbers.mv ?? 0) + 1;
  const br = db.branches.find((b) => b.id === wh.branchId);
  const mv: StockMovement = {
    id: `mv_${inv.numbers.mv}`, seq: inv.numbers.mv, at, atMs: actor.nowMs, businessDate: bizDate(actor.nowMs, br?.timezone ?? 'Africa/Cairo', br?.businessDayCutoff ?? '04:00'),
    itemId: item.id, warehouseId: wh.id, kind: m.kind, quantity: qn(q), unitCost: m4(cost), value: m4(q.times(cost)), balanceAfter: qn(after), avgCostAfter: item.avgCost,
    reason: m.reason ?? null, note: m.note ?? null, userId: actor.userId, source: m.source, lots: allocations, commandId: actor.commandId ?? null, approvalGrantId: actor.grantId ?? null,
    ...(negative ? { negative: true } : {}),
  };
  inv.movements.push(mv);
  return mv;
}

function addLot(inv: InventoryState, item: InvItem, warehouseId: string, lotCode: string, expiryDate: string | null, qty: string, unitCost: string, at: string, ref: string) {
  const same = inv.lots.find((l) => l.itemId === item.id && l.warehouseId === warehouseId && l.lotCode === lotCode && l.expiryDate === expiryDate);
  if (same) { same.remaining = qn(D(same.remaining).plus(qty)); same.initialQty = qn(D(same.initialQty).plus(qty)); return { lotId: same.id, lotCode, expiryDate, quantity: qty }; }
  const lot: InvLot = { id: newId(inv, 'lot'), itemId: item.id, warehouseId, lotCode, expiryDate, receivedAt: at, initialQty: qty, remaining: qty, unitCost, sourceRef: ref };
  inv.lots.push(lot);
  return { lotId: lot.id, lotCode, expiryDate, quantity: qty };
}
function topUpLot(inv: InventoryState, item: InvItem, warehouseId: string, q: Decimal, at: string, out: StockMovement['lots'], unitCost: string, ref: string) {
  const newest = inv.lots.filter((l) => l.itemId === item.id && l.warehouseId === warehouseId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (newest) { newest.remaining = qn(D(newest.remaining).plus(q)); out.push({ lotId: newest.id, lotCode: newest.lotCode, expiryDate: newest.expiryDate, quantity: qn(q) }); return; }
  out.push(addLot(inv, item, warehouseId, `ADJ-${at.slice(2, 10).replace(/-/g, '')}`, null, qn(q), unitCost, at, ref));
}

// ───────── recipes and costing
export function activeVersion(r: Recipe, atMs?: number): RecipeVersion {
  if (atMs !== undefined) {
    const eligible = r.versions.filter((v) => Date.parse(v.effectiveFrom) <= atMs).sort((a, b) => b.version - a.version);
    if (eligible[0]) return eligible[0];
  }
  return r.versions.find((v) => v.id === r.activeVersionId) ?? r.versions[r.versions.length - 1];
}
export function menuRecipeOf(inv: InventoryState, productId: string) { return inv.recipes.find((r) => r.outputKind === 'MENU' && r.outputProductId === productId) ?? null; }
export function prepRecipeOf(inv: InventoryState, itemId: string) { return inv.recipes.find((r) => r.outputKind === 'PREP' && r.outputProductId === itemId) ?? null; }
export function modifierRecipes(inv: InventoryState, optionId: string, productId: string) {
  return inv.recipes.filter((r) => r.outputKind === 'MODIFIER' && r.modifierOptionId === optionId && (!r.appliesToProductId || r.appliesToProductId === productId));
}

/** Ingredient need of a recipe version for `batches` batches (waste % included). */
export function versionNeeds(v: RecipeVersion, batches: Decimal.Value): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const i of v.inputsPerBatch) {
    const q = D(i.quantity).times(D(1).plus(D(i.wastePercent || 0).dividedBy(100))).times(batches);
    out.set(i.itemId, (out.get(i.itemId) ?? D(0)).plus(q));
  }
  return out;
}

/**
 * What selling `qty` of a product takes out of stock: its menu recipe, the modifier recipes, combo/half children;
 * a product with no recipe but a linked resale item takes that item one-for-one.
 */
export function explodeProduct(db: DB, productId: string, qty: Decimal.Value, modifierOptionIds: string[] = [], atMs?: number, depth = 0): { needs: Map<string, Decimal>; recipeFound: boolean } {
  const inv = invOf(db);
  const needs = new Map<string, Decimal>();
  const add = (m: Map<string, Decimal>) => m.forEach((v, k) => needs.set(k, (needs.get(k) ?? D(0)).plus(v)));
  let found = false;
  const r = menuRecipeOf(inv, productId);
  if (r) {
    const v = activeVersion(r, atMs);
    add(versionNeeds(v, D(qty).dividedBy(v.outputQuantityPerBatch || '1')));
    found = true;
  } else {
    const resale = inv.items.find((i) => i.productId === productId && i.id !== productId && i.active);
    if (resale) { needs.set(resale.id, D(qty)); found = true; }
  }
  for (const opt of modifierOptionIds) {
    for (const mr of modifierRecipes(inv, opt, productId)) {
      const v = activeVersion(mr, atMs);
      add(versionNeeds(v, D(qty).dividedBy(v.outputQuantityPerBatch || '1')));
      found = true;
    }
  }
  void depth;
  return { needs, recipeFound: found };
}

export function itemUnitCost(db: DB, item: InvItem, seen = new Set<string>()): Decimal {
  if (D(item.avgCost).gt(0)) return D(item.avgCost);
  const pr = prepRecipeOf(invOf(db), item.id);
  if (!pr || seen.has(item.id)) return D(item.lastCost || 0);
  seen.add(item.id);
  const v = activeVersion(pr);
  return versionCost(db, v, seen).perUnit;
}

export function versionCost(db: DB, v: RecipeVersion, seen = new Set<string>()) {
  const inv = invOf(db);
  const lines = v.inputsPerBatch.map((i) => {
    const item = inv.items.find((x) => x.id === i.itemId);
    const unit = item ? itemUnitCost(db, item, new Set(seen)) : D(0);
    const gross = D(i.quantity).times(D(1).plus(D(i.wastePercent || 0).dividedBy(100)));
    return { itemId: i.itemId, name: item?.name ?? { ar: i.itemId, en: i.itemId }, quantity: i.quantity, grossQuantity: qn(gross), enteredQuantity: i.enteredQuantity, enteredUnit: i.enteredUnit, wastePercent: i.wastePercent, stockUnitId: item?.stockUnitId ?? '', unitCost: m4(unit), cost: m4(gross.times(unit)) };
  });
  const total = lines.reduce((a, l) => a.plus(l.cost), D(0));
  const out = D(v.outputQuantityPerBatch || '1');
  return { lines, total: m4(total), perUnit: out.isZero() ? D(0) : total.dividedBy(out), outputQuantity: v.outputQuantityPerBatch };
}

/** Net selling price (before VAT) of a product in a branch/channel now, or null. */
export function netPrice(db: DB, productId: string, branchId: string, channel: Channel, atMs: number): string | null {
  const rule = priceRuleAt(db, productId, branchId, channel, atMs);
  if (!rule) return null;
  const p = db.products.find((x) => x.id === productId);
  const tax = p?.taxPolicyId ? db.taxPolicies.find((t) => t.id === p.taxPolicyId) : null;
  if (tax && tax.calculationMode === 'INCLUSIVE') return m4(D(rule.amount).dividedBy(D(1).plus(D(tax.rate).dividedBy(100))));
  return rule.amount;
}

export function foodCostBand(pct: Decimal | null): 'GOOD' | 'WATCH' | 'HIGH' | 'UNKNOWN' {
  if (!pct) return 'UNKNOWN';
  if (pct.lte(30)) return 'GOOD';
  if (pct.lte(40)) return 'WATCH';
  return 'HIGH';
}

export const nameOf = (db: DB, id: string): Loc => {
  const inv = invOf(db);
  return inv.items.find((i) => i.id === id)?.name ?? db.products.find((p) => p.id === id)?.name ?? { ar: id, en: id };
};
