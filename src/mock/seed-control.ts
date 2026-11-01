// r3A seed — who did it vs who allowed it: an accountant (third-level authority + void review), simulated manager
// cards and fingerprints, the staff-meal approval on managers, and a paid check + a staff meal from YESTERDAY
// (a closed business day) so a return after close can be tried without moving any clock.
// Runs inside buildSeed: no store / policy() reads here (the store is not ready yet) — values come from `db`.
import { businessDate } from './clock';
import { D, m4 } from './money';
import { policyMeta } from './policyRegistry';
import type { DB, Order, OrderLine, PolicySnapshot } from './types';
import { invOf, post, explodeProduct, salesWarehouse } from './handlers/inventory-engine';
import { computeLiveTotals } from './pricing';
import './control-registry';

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

export const CONTROL_ROLE_ADDITIONS: Record<string, string[]> = {
  role_manager: ['approve:staff_meal'],
};
export const ACCOUNTANT_PERMISSIONS = [
  'audit:read', 'approval:read', 'approval:grant', 'voidreview:decide', 'approve:return_after_close', 'refund:read', 'refund:approve', 'refund:request',
  'report:run', 'business:read', 'branch:read', 'terminal:read', 'user:read', 'session:read', 'session:zreport', 'session:xreport', 'cash:read', 'payment:read',
  'order:read', 'settings:read', 'inventory:read', 'compliance:read', 'catalog:read', 'product:read',
];
/** Simulated credentials: card codes (what a swipe reads) and fingerprint templates (what the reader matches). */
export const DEMO_CARDS: Record<string, { card: string; finger: string }> = {
  u_manager_1: { card: 'CARD-MGR-7731', finger: 'FP-MGR1-RIGHT-INDEX' },
  u_manager_2: { card: 'CARD-MGR-4420', finger: 'FP-MGR2-RIGHT-INDEX' },
  u_owner: { card: 'CARD-OWN-0001', finger: 'FP-OWN-RIGHT-THUMB' },
  u_accountant: { card: 'CARD-ACC-5512', finger: 'FP-ACC-RIGHT-INDEX' },
  u_cashier_a: { card: 'CARD-CSH-1101', finger: 'FP-CSHA-RIGHT-INDEX' },
};

const tenantValue = (db: DB, id: string) => db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value ?? policyMeta.get(id)?.canonicalDefault ?? null;

function snapshot(db: DB, nowIso: string): PolicySnapshot {
  const conf = tenantValue(db, 'OrderConfirmationPricingPolicy') as { mode: string; channels: any[] } | null;
  return {
    pricingOrder: (tenantValue(db, 'PricingOrderPolicy') as any) ?? 'DISCOUNT_BEFORE_TAX', rounding: { mode: 'HALF_UP', scale: 2 },
    confirmationMode: conf?.mode ?? null, confirmationChannels: conf?.channels ?? [], charges: [], tableTax: { enabled: false, rate: '0', order: 'BEFORE_VAT' }, halfAndHalf: 'HIGHER_HALF', capturedAt: nowIso,
  };
}

function line(db: DB, id: string, productId: string, qty: string, atIso: string, by: string): OrderLine | null {
  const p = db.products.find((x) => x.id === productId);
  const rule = db.priceRules.find((r) => r.productId === productId && r.branchId === 'branch_main' && r.channel === 'TAKEAWAY' && !r.salesChannelId && !r.variantId);
  const tax = p && db.taxPolicies.find((t) => t.id === p.taxPolicyId);
  if (!p || !rule || !tax) return null;
  return {
    id, productId, sku: p.sku, name: p.name, categoryId: p.categoryId, quantity: qty, unitPrice: rule.amount, modifiers: [], unitTotal: rule.amount, lineTotal: m4(D(rule.amount).times(qty)),
    taxPolicy: { id: tax.id, rate: tax.rate, mode: tax.calculationMode, version: tax.version, name: tax.name, roundingMode: tax.roundingMode, roundingScale: tax.roundingScale, exemption: tax.exemption },
    priceRuleId: rule.id, status: 'ACTIVE', version: 1, fireRound: 1, firedAt: atIso, addedAt: atIso, addedBy: by, seat: null, variant: null, children: [], allergens: p.allergens, chargeTags: p.chargeTags, kitchenMods: [],
  } as OrderLine;
}

/** Consumption of a seeded historical line, like the sales consumer would have posted (so a return can reverse it). */
function consume(db: DB, o: Order, l: OrderLine, atMs: number) {
  try {
    if (!(db as any).inv) return;
    const inv = invOf(db);
    const wh = salesWarehouse(db, o.branchId);
    if (!wh) return;
    const { needs } = explodeProduct(db, l.productId, l.quantity, [], atMs);
    const ids: string[] = [];
    needs.forEach((q, itemId) => {
      if (!inv.items.find((i) => i.id === itemId)) return;
      ids.push(post(db, { userId: o.createdBy, nowMs: atMs }, { itemId, warehouseId: wh.id, kind: 'SALE', quantity: q.negated(), source: { module: 'orders', command: 'Order.Complete', id: o.id, number: o.number, orderId: o.id, lineId: l.id, label: l.name.ar }, negative: 'ALLOW' }).id);
    });
    inv.orderEffects[`${o.id}:${l.id}`] = { orderId: o.id, lineId: l.id, state: 'SALE', warehouseId: wh.id, movementIds: ids, at: new Date(atMs).toISOString() };
  } catch { /* stock history is a nice-to-have for the demo */ }
}

export function seedControl(db: DB, nowMs: number, pin: string, password: string, displayName: (u: string) => string) {
  // roles: the staff-meal approval on managers; a new accountant role (third-level authority, void review)
  for (const r of db.roles) {
    const add = (CONTROL_ROLE_ADDITIONS[r.id] ?? []).filter((p) => !r.permissionIds.includes(p));
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...add];
    r.permissionIds = [...r.permissionIds, ...add];
  }
  if (!db.roles.some((r) => r.id === 'role_accountant')) db.roles.push({ id: 'role_accountant', name: 'Demo Accountant', permissionIds: [...ACCOUNTANT_PERMISSIONS], active: true, version: 1, demoAdded: [...ACCOUNTANT_PERMISSIONS] } as any);
  if (!db.users.some((u) => u.id === 'u_accountant')) db.users.push({ id: 'u_accountant', username: 'demo-accountant', displayName: displayName('demo-accountant'), active: true, version: 1, pin, password, roleAssignments: [{ roleId: 'role_accountant', branchIds: ['branch_main', 'branch_second'] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false });
  for (const u of db.users) { const c = DEMO_CARDS[u.id]; if (c) { u.cardCode = c.card; u.fingerprintId = c.finger; } }

  // yesterday (a closed business day in the seeded history): a paid takeaway and a staff meal
  const today = businessDate(nowMs);
  const y = addDays(today, -1);
  if (!(db.businessDays ?? []).some((d) => d.branchId === 'branch_main' && d.date === y)) return;
  const atMs = Date.parse(y + 'T17:40:00Z'); // 19:40 Cairo
  const atIso = new Date(atMs).toISOString();
  const snap = snapshot(db, atIso);
  const mk = (id: string, number: string, kind: 'SALE' | 'STAFF_MEAL', by: string, lines: OrderLine[]): Order => ({
    id, number, branchId: 'branch_main', channel: 'TAKEAWAY', status: 'COMPLETED', kind, visitId: null, tableId: null, sessionId: kind === 'SALE' ? 'ses_hist_y1' : null, terminalId: 't_cash', serverUserId: by,
    createdAt: atIso, createdAtMs: atMs, businessDate: y, createdBy: by, confirmedAt: atIso, confirmedBy: by, completedAt: atIso, completedAtMs: atMs + 120_000, completedBusinessDate: y, completedSessionId: kind === 'SALE' ? 'ses_hist_y1' : null,
    version: 4, checkNo: 1, fireMode: 'AT_CONFIRM', rounds: [{ round: 1, firedAt: atIso, firedBy: by, lineIds: lines.map((l) => l.id), via: 'CONFIRM', commandId: 'seed' }], lines, discounts: [], comp: kind === 'STAFF_MEAL' ? { reasonCode: 'STAFF_MEAL', at: atIso, by } : null, policy: snap,
    service: { rate: '0', taxable: true, origin: 'CHANNEL_ABSENT', capturedAt: atIso, channel: 'TAKEAWAY' }, confirmation: null,
    history: [{ at: atIso, by, byName: db.users.find((u) => u.id === by)?.displayName, terminal: 'DEMO-CASH-1', kind: 'CREATED', text: { ar: kind === 'SALE' ? 'اتفتح طلب تيك أواي (امبارح)' : 'وجبة موظف (امبارح)', en: kind === 'SALE' ? 'takeaway (yesterday)' : 'staff meal (yesterday)' } }],
  });
  const l1 = line(db, 'line_hist_y1', 'p_chicken_shawarma', '2', atIso, 'u_cashier_b');
  const l2 = line(db, 'line_hist_y2', 'p_pepsi', '2', atIso, 'u_cashier_b');
  if (!l1 || !l2) return;
  const sale = mk('ord_hist_y1', '0388', 'SALE', 'u_cashier_b', [l1, l2]);
  sale.confirmation = computeLiveTotals(sale); // pure: captured prices + frozen snapshot
  const payable = sale.confirmation.payable;
  sale.history.push({ at: new Date(atMs + 120_000).toISOString(), by: 'u_cashier_b', byName: db.users.find((u) => u.id === 'u_cashier_b')?.displayName, terminal: 'DEMO-CASH-1', kind: 'COMPLETED', text: { ar: `اتدفع كاش ${Number(payable).toFixed(2)} ج.م واتقفل — يوم ${y} اتقفل بعدها`, en: 'paid cash and completed' } });
  db.orders.push(sale);
  db.captures.push({ id: 'cap_hist_y1', orderId: sale.id, method: 'CASH', amount: payable, tendered: m4(Math.ceil(Number(payable) / 50) * 50), change: m4(D(Math.ceil(Number(payable) / 50) * 50).minus(payable)), reference: null, sessionId: 'ses_hist_y1', terminalId: 't_cash', branchId: 'branch_main', at: atIso, atMs, businessDate: y, by: 'u_cashier_b', commandId: 'seed', tip: '0.0000' });
  consume(db, sale, l1, atMs); consume(db, sale, l2, atMs);

  const ml = line(db, 'line_hist_y3', 'p_chicken_shawarma', '1', atIso, 'u_cashier_b');
  if (ml) {
    const meal = mk('ord_hist_y2', 'SM-0387', 'STAFF_MEAL', 'u_cashier_b', [ml]);
    const emp = db.users.find((u) => u.id === 'u_waiter_2');
    meal.customerName = emp?.displayName;
    meal.staffMeal = { employeeUserId: 'u_waiter_2', employeeName: emp?.displayName ?? '', basis: 'SALE_PRICE', value: ml.lineTotal, saleValue: ml.lineTotal, approverId: 'u_manager_1', grantId: null, sentToKitchen: true };
    meal.history.push({ at: atIso, by: 'u_cashier_b', kind: 'STAFF_MEAL', text: { ar: `وجبة موظف لـ ${emp?.displayName ?? ''} — بموافقة أحمد بالرقم السري — مش بيع`, en: 'staff meal' } });
    meal.confirmation = computeLiveTotals(meal);
    db.orders.push(meal);
    consume(db, meal, ml, atMs);
  }
}
