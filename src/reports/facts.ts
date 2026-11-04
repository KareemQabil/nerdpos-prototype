// L0 — facts at an explicit grain, read from the mock database events (orders, lines, captures, refunds, drawer
// entries, removals, kitchen tickets, e-receipts, approvals, inventory, purchasing, visits, deliveries).
// Every fact carries its server business date, its recording instant (for asOf), the dimension values it supports and
// an EvidenceRef pointing at the immutable source record. Nothing here writes to the database.
import type { DB, Order, OrderLine } from '../mock/types';
import { computeTotals } from '../mock/pricing';
import { D, m4, allocate } from '../mock/money';
import { zonedParts, businessDate as bdOf } from '../mock/clock';
import { invOf, explodeProduct, itemUnitCost } from '../mock/handlers/inventory-engine';
import { userLabel } from '../demo/people';
import type { Fact, FactKind } from './types';

export interface FactScope { branchIds: string[]; from: string; to: string; asOfMs: number }

const DAY = 86_400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
export const inRange = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to;
export const cairoHour = (ms: number) => zonedParts(ms, 'Africa/Cairo').hour;
export function daypartOf(ms: number): string {
  const h = cairoHour(ms);
  return h >= 4 && h < 11 ? 'BREAKFAST' : h >= 11 && h < 16 ? 'LUNCH' : h >= 16 && h < 22 ? 'DINNER' : 'LATE';
}
export const DAYPART_LABEL: Record<string, { ar: string; en: string }> = { BREAKFAST: { ar: 'فطار (4–11)', en: 'Breakfast' }, LUNCH: { ar: 'غدا (11–4)', en: 'Lunch' }, DINNER: { ar: 'عشا (4–10)', en: 'Dinner' }, LATE: { ar: 'آخر الليل (10–4)', en: 'Late night' } };
/** Week start: Saturday (OD11 — the business calendar setting; the assistant asks when a question is vague). */
export function weekOf(date: string, start: 'SATURDAY' | 'SUNDAY' | 'MONDAY' = 'SATURDAY'): string {
  const wd = new Date(date + 'T12:00:00Z').getUTCDay(); // 0 Sun … 6 Sat
  const s = start === 'SATURDAY' ? 6 : start === 'SUNDAY' ? 0 : 1;
  return addDays(date, -((wd - s + 7) % 7));
}
const uname = (db: DB, id: string | null | undefined) => { const u = db.users.find((x) => x.id === id); return u ? userLabel(u.username, u.displayName) : id ?? ''; };
const isoMs = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
const bdAt = (db: DB, branchId: string, ms: number) => { const b = db.branches.find((x) => x.id === branchId); return bdOf(ms, b?.timezone ?? 'Africa/Cairo', b?.businessDayCutoff ?? '04:00'); };

/** The order identity: a table visit is one order however many checks it is split into. */
export const orderKey = (o: Order) => o.visitId ? `visit:${o.visitId}` : `order:${o.id}`;
/** Tender taxonomy (DESIGN P3): how the money arrived. */
export const TENDER: Record<string, string> = { CASH: 'CASH', CARD: 'CARD', DIGITAL_WALLET: 'WALLET', ONLINE: 'PREPAID', DEPOSIT: 'PREPAID', LOYALTY: 'POINTS' };

/** Totals split into the bridge components (exact: net + service + fees + table tax + VAT = payable). */
export function checkParts(o: Order) {
  const t = computeTotals(o);
  const gross = D(t.itemsSubtotal);
  const discount = D(t.itemDiscount).plus(t.discountAfterTax);
  const service = D(t.serviceCharge).minus(t.serviceDiscount);
  const fees = t.charges.reduce((a, c) => a.plus(c.amount), D(0));
  const tableTax = D(t.tableTax);
  const tax = D(t.tax);
  const payable = D(t.payable);
  // VAT inside tax-inclusive prices = total VAT − VAT added on top
  const taxAdded = payable.plus(t.discountAfterTax).minus(gross.minus(t.itemDiscount)).minus(service).minus(fees).minus(tableTax);
  const insideTax = tax.minus(taxAdded);
  const net = gross.minus(discount).minus(insideTax);
  return { t, gross, discount, service, fees, tableTax, tax, insideTax, net, payable, comp: t.comp };
}

/** Recipe cost of a line at the recipe version and ingredient cost effective when it was sold. null = cost unavailable. */
export function lineCostAt(db: DB, l: OrderLine, atMs: number): { cost: string | null; basis: 'AT_SALE' | 'CURRENT_FALLBACK' | 'NO_RECIPE' } {
  if (!(db as any).inv) return { cost: null, basis: 'NO_RECIPE' };
  const inv = invOf(db);
  const { needs, recipeFound } = explodeProduct(db, l.productId, l.quantity, l.modifiers.map((x) => x.optionId), atMs);
  if (!recipeFound) return { cost: null, basis: 'NO_RECIPE' };
  let total = D(0); let basis: 'AT_SALE' | 'CURRENT_FALLBACK' = 'AT_SALE';
  for (const [itemId, q] of needs) {
    const it = inv.items.find((i) => i.id === itemId);
    if (!it) return { cost: null, basis: 'NO_RECIPE' };
    const hist = (it.costHistory ?? []).filter((h) => Date.parse(h.at) <= atMs).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    let unit = hist[0] ? D(hist[0].avgCost) : null;
    if (!unit || unit.lte(0)) { unit = itemUnitCost(db, it); basis = 'CURRENT_FALLBACK'; }
    total = total.plus(q.times(unit));
  }
  return { cost: m4(total), basis };
}

type Builder = (db: DB, s: FactScope) => Fact[];
const dayDims = (db: DB, date: string) => ({ business_date: date, business_week: weekOf(date), weekday: String(new Date(date + 'T12:00:00Z').getUTCDay()) });
const branchOk = (s: FactScope, b: string) => s.branchIds.includes(b);

const completedSales = (db: DB, s: FactScope) => db.orders.filter((o) => o.kind === 'SALE' && o.status === 'COMPLETED' && branchOk(s, o.branchId) && inRange(o.completedBusinessDate, s.from, s.to) && (o.completedAtMs ?? 0) <= s.asOfMs);
const tableOf = (db: DB, o: Order) => (o.tableId ? db.tables.find((t) => t.id === o.tableId) : undefined);

function checkDims(db: DB, o: Order) {
  const ms = o.completedAtMs ?? o.createdAtMs;
  const tb = tableOf(db, o);
  return { ...dayDims(db, o.completedBusinessDate!), branch: o.branchId, daypart: daypartOf(ms), hour: String(cairoHour(ms)).padStart(2, '0'), channel: o.channel, staff: o.serverUserId, device: o.terminalId || null, revenue_center: tb?.area ?? null, table: o.tableId, table_visit: o.visitId, check: o.id, order: orderKey(o) };
}
const checkLabel = (db: DB, o: Order) => `#${o.number}${o.tableId ? ` · ترابيزة ${tableOf(db, o)?.name ?? ''}${o.visitId ? ` · شيك ${o.checkNo}` : ''}` : ''}`;

const buildCheck: Builder = (db, s) => completedSales(db, s).filter((o) => !o.comp).map((o) => {
  const p = checkParts(o);
  const visit = o.visitId ? db.visits.find((v) => v.id === o.visitId) : null;
  return {
    kind: 'check', id: o.id, branchId: o.branchId, businessDate: o.completedBusinessDate, recordedMs: o.completedAtMs ?? 0, dims: checkDims(db, o),
    n: { gross: m4(p.gross), discount: m4(p.discount), net: m4(p.net), service: m4(p.service), fees: m4(p.fees), table_tax: m4(p.tableTax), tax: m4(p.tax), inside_tax: m4(p.insideTax), payable: m4(p.payable), guests: visit ? String(visit.guestCount) : '' },
    key: { order: orderKey(o), check: o.id, visit: o.visitId ? `visit:${o.visitId}` : '' },
    ref: { kind: 'CHECK', id: o.id, orderId: o.id, label: checkLabel(db, o), businessDate: o.completedBusinessDate, at: o.completedAt, amount: m4(p.payable) },
  } satisfies Fact;
});

const buildLine: Builder = (db, s) => {
  const out: Fact[] = [];
  for (const o of completedSales(db, s)) {
    if (o.comp) continue;
    const lines = o.lines.filter((l) => l.status === 'ACTIVE');
    if (!lines.length) continue;
    const p = checkParts(o);
    const w = lines.map((l) => D(l.lineTotal).abs().plus('0.0001'));
    const gross = allocate(p.gross, w, 2); const disc = allocate(p.discount, w, 2); const inside = allocate(p.insideTax, w, 2); // whole piasters, largest remainder
    const base = checkDims(db, o);
    const ms = o.completedAtMs ?? o.createdAtMs;
    lines.forEach((l, i) => {
      const net = D(gross[i]).minus(disc[i]).minus(inside[i]);
      const c = lineCostAt(db, l, ms);
      out.push({
        kind: 'line', id: `${o.id}:${l.id}`, branchId: o.branchId, businessDate: o.completedBusinessDate, recordedMs: o.completedAtMs ?? 0,
        dims: { ...base, product: l.productId, category: l.categoryId, size: l.variant?.id ?? null, modifier: l.modifiers.map((x) => x.optionId).sort().join('+') || null, tax_group: l.taxPolicy?.id ?? null },
        n: { gross: gross[i], discount: disc[i], inside_tax: inside[i], net: m4(net), qty: l.quantity, ...(c.cost !== null ? { cost: c.cost } : {}), dine_in_net: o.channel === 'DINE_IN' ? m4(net) : '0' },
        key: { cost_basis: c.basis, product: l.productId },
        ref: { kind: 'LINE', id: l.id, orderId: o.id, label: `${checkLabel(db, o)} — ${l.name.ar} ×${Number(l.quantity)}`, businessDate: o.completedBusinessDate, at: o.completedAt, amount: m4(net), note: null },
      });
    });
  }
  return out;
};

const buildPayment: Builder = (db, s) => db.captures.filter((c) => branchOk(s, c.branchId) && inRange(c.businessDate, s.from, s.to) && c.atMs <= s.asOfMs).map((c) => {
  const o = db.orders.find((x) => x.id === c.orderId);
  return {
    kind: 'payment', id: c.id, branchId: c.branchId, businessDate: c.businessDate, recordedMs: c.atMs,
    dims: { ...dayDims(db, c.businessDate), branch: c.branchId, hour: String(cairoHour(c.atMs)).padStart(2, '0'), payment_method: TENDER[c.method] ?? c.method, drawer: c.sessionId, staff: c.by, device: c.terminalId, check: c.orderId },
    n: { amount: c.amount, rounding: c.rounding ?? '0.0000', positive: D(c.amount).gt(0) && !c.correctionOf ? '1' : '0', correction: c.correctionOf && D(c.amount).gt(0) ? '1' : '0', rounded: D(c.rounding ?? 0).isZero() ? '0' : '1' },
    key: { orderBd: o?.completedBusinessDate ?? '' },
    ref: { kind: 'PAYMENT', id: c.id, orderId: c.orderId, label: `${o ? '#' + o.number : c.orderId} — ${c.method === 'CASH' ? 'نقدي' : c.method === 'CARD' ? 'بطاقة' : c.method === 'DIGITAL_WALLET' ? 'محفظة' : c.method}${c.correctionOf ? ' (تصحيح)' : ''}${c.reference ? ' · ' + c.reference : ''}`, businessDate: c.businessDate, at: c.at, amount: c.amount, note: !D(c.rounding ?? 0).isZero() ? `rounding ${c.rounding}` : null },
  } satisfies Fact;
});

/** Refund stage: recorded by the reversal policy (r3A) when present, else derived (same business day = S2, later = S3). */
export function refundStage(db: DB, r: DB['refunds'][number]): { stage: string; derived: boolean; originalBd: string | null } {
  const o = db.orders.find((x) => x.id === r.orderId);
  const orig = r.originalBusinessDate ?? o?.completedBusinessDate ?? null;
  if (r.stage) return { stage: r.stage, derived: false, originalBd: orig };
  return { stage: orig && r.businessDate && orig < r.businessDate ? 'S3' : 'S2', derived: true, originalBd: orig };
}
const buildRefund: Builder = (db, s) => db.refunds.filter((r) => r.state === 'PAID' && inRange(r.businessDate, s.from, s.to) && isoMs(r.paidAt) <= s.asOfMs).flatMap((r) => {
  const o = db.orders.find((x) => x.id === r.orderId);
  if (!o || !branchOk(s, o.branchId)) return [];
  const p = checkParts(o);
  const ratio = (x: any) => (p.payable.isZero() ? D(0) : D(r.amount).times(x).dividedBy(p.payable));
  const st = refundStage(db, r);
  const session = db.sessions.find((x) => x.id === r.paidSessionId);
  return [{
    kind: 'refund', id: r.id, branchId: o.branchId, businessDate: r.businessDate!, recordedMs: isoMs(r.paidAt),
    dims: { ...dayDims(db, r.businessDate!), branch: o.branchId, payment_method: TENDER[r.method] ?? r.method, drawer: r.paidSessionId ?? null, staff: r.paidBy ?? session?.userId ?? r.decidedBy ?? null, approval_actor: r.approverId ?? db.grants.find((g) => g.id === r.approvalGrantId)?.approverUserId ?? r.decidedBy ?? null, void_reason: r.reasonCode, stage: st.stage, check: o.id, channel: o.channel },
    n: { amount: r.amount, net: m4(ratio(p.net)), tax: m4(ratio(p.tax)), service: m4(ratio(p.service)), one: '1' },
    key: { originalBd: st.originalBd ?? '', stageDerived: st.derived ? '1' : '0' },
    ref: { kind: 'REFUND', id: r.id, orderId: o.id, label: `مرتجع على #${o.number} (يوم ${st.originalBd}) — ${({ CASH: 'نقدي', CARD: 'بطاقة', DIGITAL_WALLET: 'محفظة' } as Record<string, string>)[r.method] ?? r.method}`, businessDate: r.businessDate, at: r.paidAt, amount: r.amount, note: st.derived ? 'stage-derived' : null },
  } satisfies Fact];
});

const SIGN: Record<string, number> = { OPENING_FLOAT: 1, TENDER_IN: 1, REFUND_OUT: -1, PAY_IN: 1, PAY_OUT: -1, SAFE_DROP: -1, NO_SALE: 0, TIP_IN: 1, TIP_OUT: -1, DEPOSIT_IN: 1, TENDER_CORRECTION_IN: 1, TENDER_CORRECTION_OUT: -1 };
export function drawerParts(db: DB, sessionId: string, asOfMs = Infinity) {
  const entries = db.cashEntries.filter((e) => e.sessionId === sessionId && isoMs(e.at) <= asOfMs);
  const by: Record<string, any> = {};
  let expected = D(0);
  for (const e of entries) { by[e.kind] = (by[e.kind] ?? D(0)).plus(e.amount); expected = expected.plus(D(e.amount).times(SIGN[e.kind] ?? 0)); }
  return { entries, by, expected };
}
const buildDrawer: Builder = (db, s) => db.sessions.filter((x) => branchOk(s, x.branchId) && inRange(x.businessDate, s.from, s.to) && x.openedAtMs <= s.asOfMs).map((x) => {
  const { expected } = drawerParts(db, x.id, s.asOfMs);
  const closed = x.state === 'CLOSED' && x.close && isoMs(x.closedAt) <= s.asOfMs;
  const term = db.terminals.find((t) => t.id === x.terminalId);
  return {
    kind: 'drawer', id: x.id, branchId: x.branchId, businessDate: x.businessDate, recordedMs: closed ? isoMs(x.closedAt) : x.openedAtMs,
    dims: { ...dayDims(db, x.businessDate), branch: x.branchId, drawer: x.id, staff: x.userId, device: x.terminalId },
    n: { expected: closed ? x.close!.expectedCash : m4(expected), ...(closed ? { counted: x.close!.countedCash, variance: x.close!.variance } : {}) },
    key: { state: closed ? 'CLOSED' : 'OPEN' },
    ref: { kind: 'SESSION', id: x.id, label: `وردية ${uname(db, x.userId)} — ${term?.name ?? x.terminalId}${closed ? '' : ' (مفتوحة)'}`, businessDate: x.businessDate, at: x.openedAt, amount: closed ? x.close!.variance : m4(expected) },
  } satisfies Fact;
});
const buildCashEntry: Builder = (db, s) => db.cashEntries.flatMap((e) => {
  const x = db.sessions.find((y) => y.id === e.sessionId);
  if (!x || !branchOk(s, x.branchId) || !inRange(x.businessDate, s.from, s.to) || isoMs(e.at) > s.asOfMs) return [];
  return [{
    kind: 'cash_entry', id: e.id, branchId: x.branchId, businessDate: x.businessDate, recordedMs: isoMs(e.at),
    dims: { ...dayDims(db, x.businessDate), branch: x.branchId, drawer: x.id, staff: e.by, device: x.terminalId },
    n: { amount: e.amount, signed: m4(D(e.amount).times(SIGN[e.kind] ?? 0)), no_sale: e.kind === 'NO_SALE' ? '1' : '0', withdrawal: e.kind === 'PAY_OUT' || e.kind === 'SAFE_DROP' ? e.amount : '0' },
    key: { entryKind: e.kind },
    ref: { kind: 'CASH_ENTRY', id: e.id, label: `${CASH_KIND_AR[e.kind] ?? e.kind}${e.ref ? ' · ' + e.ref : ''}${e.reason ? ' · ' + e.reason : ''}`, businessDate: x.businessDate, at: e.at, amount: m4(D(e.amount).times(SIGN[e.kind] ?? 0)) },
  } satisfies Fact];
});
export const CASH_KIND_AR: Record<string, string> = { OPENING_FLOAT: 'الرصيد الافتتاحي', TENDER_IN: 'نقد من شيك', REFUND_OUT: 'مرتجع نقدي', PAY_IN: 'إيداع في الدرج', PAY_OUT: 'صرف من الدرج', SAFE_DROP: 'توريد للخزنة', NO_SALE: 'فتح الدرج بلا بيع', TIP_IN: 'بقشيش نقدي', TIP_OUT: 'صرف بقشيش', DEPOSIT_IN: 'عربون', TENDER_CORRECTION_IN: 'تصحيح طريقة دفع (داخل)', TENDER_CORRECTION_OUT: 'تصحيح طريقة دفع (خارج)' };

/**
 * Removals at every stage. Source of truth: db.reversals (r3A trace: stage, disposition, approver, review). Lines
 * voided/removed before that trace existed are derived from the order (labelled "derived") so nothing is silent.
 */
const buildRemoval: Builder = (db, s) => {
  const out: Fact[] = [];
  const recs = ((db as any).reversals ?? []) as NonNullable<DB['reversals']>;
  const seen = new Set<string>();
  for (const r of recs) {
    if (r.kind === 'REFUND' || r.kind === 'RETURN_AFTER_CLOSE') { if (r.lineId) seen.add(`${r.orderId}:${r.lineId}`); continue; }
    if (r.lineId) seen.add(`${r.orderId}:${r.lineId}`); else seen.add(`${r.orderId}:ORDER`);
    if (!branchOk(s, r.branchId) || !inRange(r.businessDate, s.from, s.to) || r.atMs > s.asOfMs) continue;
    const o = db.orders.find((x) => x.id === r.orderId);
    const l = o?.lines.find((x) => x.id === r.lineId);
    out.push({
      kind: 'removal', id: r.id, branchId: r.branchId, businessDate: r.businessDate, recordedMs: r.atMs,
      dims: { ...dayDims(db, r.businessDate), branch: r.branchId, hour: String(cairoHour(r.atMs)).padStart(2, '0'), channel: o?.channel ?? null, staff: r.actorId, approval_actor: r.approverId, void_reason: r.reasonCode, stage: r.stage, disposition: r.disposition, product: r.productId, category: l?.categoryId ?? null, check: r.orderId },
      n: { one: '1', value: r.value, line: r.lineId ? '1' : '0', order: r.lineId ? '0' : '1', pending: r.disposition === 'WASTE_HELD' && r.review?.state === 'PENDING' ? '1' : '0', missing: r.review?.state === 'MISSING' ? '1' : '0', verified: r.review?.state === 'VERIFIED' ? '1' : '0' },
      key: { recorded: '1', kindCode: r.kind, review: r.review?.state ?? '' },
      ref: { kind: 'REMOVAL', id: r.id, orderId: r.orderId, label: `#${r.orderNumber} — ${r.name.ar} ×${Number(r.quantity)} (${r.stage})`, businessDate: r.businessDate, at: r.at, amount: r.value, note: r.kind },
    });
  }
  for (const o of db.orders) {
    if (!branchOk(s, o.branchId)) continue;
    for (const l of o.lines) {
      const k = `${o.id}:${l.id}`;
      if (seen.has(k) || seen.has(`${o.id}:ORDER`)) continue;
      const v = l.voided; const rm = l.removed;
      if (l.status === 'VOIDED' && v) {
        const ms = isoMs(v.at); const bd = bdAt(db, o.branchId, ms);
        if (!inRange(bd, s.from, s.to) || ms > s.asOfMs) continue;
        const scope = v.disposition === 'ORDER_VOID' ? 'order' : 'line';
        const disposition = v.dispositionKind ?? (v.disposition === 'WASTE' ? 'WASTE_HELD' : v.disposition === 'ORDER_VOID' ? null : 'NOT_PREPARED');
        out.push({
          kind: 'removal', id: `drv:${k}`, branchId: o.branchId, businessDate: bd, recordedMs: ms,
          dims: { ...dayDims(db, bd), branch: o.branchId, hour: String(cairoHour(ms)).padStart(2, '0'), channel: o.channel, staff: v.by, approval_actor: v.approverId ?? null, void_reason: v.reasonCode, stage: v.stage ?? 'S1', disposition, product: l.productId, category: l.categoryId, check: o.id },
          n: { one: '1', value: l.lineTotal, line: scope === 'line' ? '1' : '0', order: '0', pending: '0', missing: '0', verified: '0' },
          key: { recorded: '0', kindCode: scope === 'order' ? 'ORDER_VOID' : 'LINE_VOID', review: '' },
          ref: { kind: 'REMOVAL', id: `drv:${k}`, orderId: o.id, label: `#${o.number} — ${l.name.ar} ×${Number(l.quantity)} (${v.stage ?? 'S1'})`, businessDate: bd, at: v.at, amount: l.lineTotal, note: v.stage ? null : 'stage-derived' },
        });
      } else if (l.status === 'REMOVED') {
        const ms = rm ? isoMs(rm.at) : o.createdAtMs; const bd = bdAt(db, o.branchId, ms);
        if (!inRange(bd, s.from, s.to) || ms > s.asOfMs) continue;
        const preBill = o.history.some((h) => h.kind === 'PRE_BILL' && isoMs(h.at) < ms);
        const stage = rm?.stage ?? (preBill ? 'S1' : 'S0');
        out.push({
          kind: 'removal', id: `drv:${k}`, branchId: o.branchId, businessDate: bd, recordedMs: ms,
          dims: { ...dayDims(db, bd), branch: o.branchId, hour: String(cairoHour(ms)).padStart(2, '0'), channel: o.channel, staff: rm?.by ?? o.serverUserId, approval_actor: rm?.approverId ?? null, void_reason: rm?.reasonCode ?? null, stage, disposition: 'NOT_PREPARED', product: l.productId, category: l.categoryId, check: o.id },
          n: { one: '1', value: l.lineTotal, line: '1', order: '0', pending: '0', missing: '0', verified: '0' },
          key: { recorded: '0', kindCode: 'LINE_REMOVE', review: '' },
          ref: { kind: 'REMOVAL', id: `drv:${k}`, orderId: o.id, label: `#${o.number} — ${l.name.ar} ×${Number(l.quantity)} (${stage})`, businessDate: bd, at: rm?.at ?? o.createdAt, amount: l.lineTotal, note: rm?.stage ? null : 'stage-derived' },
        });
      }
    }
    if ((o.status === 'CANCELLED') && !seen.has(`${o.id}:ORDER`)) {
      const ms = isoMs(o.cancelledAt) || o.createdAtMs; const bd = bdAt(db, o.branchId, ms);
      if (!inRange(bd, s.from, s.to) || ms > s.asOfMs) continue;
      out.push({ kind: 'removal', id: `drv:${o.id}:ORDER`, branchId: o.branchId, businessDate: bd, recordedMs: ms, dims: { ...dayDims(db, bd), branch: o.branchId, hour: String(cairoHour(ms)).padStart(2, '0'), channel: o.channel, staff: o.createdBy, approval_actor: null, void_reason: o.endReason?.code ?? null, stage: 'S0', disposition: 'NOT_PREPARED', product: null, category: null, check: o.id }, n: { one: '1', value: '0.0000', line: '0', order: '1', pending: '0', missing: '0', verified: '0' }, key: { recorded: '0', kindCode: 'ORDER_CANCEL', review: '' }, ref: { kind: 'REMOVAL', id: `drv:${o.id}:ORDER`, orderId: o.id, label: `#${o.number} — أُلغي الشيك قبل الإرسال`, businessDate: bd, at: o.cancelledAt ?? o.createdAt, amount: '0', note: 'stage-derived' } });
    }
    if (o.status === 'VOIDED' && !seen.has(`${o.id}:ORDER`)) {
      const ms = isoMs(o.voidedAt) || o.createdAtMs; const bd = bdAt(db, o.branchId, ms);
      if (!inRange(bd, s.from, s.to) || ms > s.asOfMs) continue;
      const g = db.grants.find((x) => x.id === o.endReason?.approvalGrantId);
      out.push({ kind: 'removal', id: `drv:${o.id}:ORDER`, branchId: o.branchId, businessDate: bd, recordedMs: ms, dims: { ...dayDims(db, bd), branch: o.branchId, hour: String(cairoHour(ms)).padStart(2, '0'), channel: o.channel, staff: o.serverUserId, approval_actor: g?.approverUserId ?? null, void_reason: o.endReason?.code ?? null, stage: 'S1', disposition: null, product: null, category: null, check: o.id }, n: { one: '1', value: '0.0000', line: '0', order: '1', pending: '0', missing: '0', verified: '0' }, key: { recorded: '0', kindCode: 'ORDER_VOID', review: '' }, ref: { kind: 'REMOVAL', id: `drv:${o.id}:ORDER`, orderId: o.id, label: `#${o.number} — أُلغي الشيك كله بعد الإرسال`, businessDate: bd, at: o.voidedAt ?? null, amount: '0', note: 'stage-derived' } });
    }
  }
  return out;
};

const buildDiscount: Builder = (db, s) => completedSales(db, s).filter((o) => !o.comp).flatMap((o) => {
  const ds = o.discounts.filter((d) => d.active);
  const p = checkParts(o);
  if (!ds.length || p.discount.isZero()) return [];
  const shares = allocate(p.discount, ds.map(() => 1), 4);
  const base = checkDims(db, o);
  return ds.map((d, i) => ({
    kind: 'discount' as FactKind, id: `${o.id}:${d.id}`, branchId: o.branchId, businessDate: o.completedBusinessDate, recordedMs: o.completedAtMs ?? 0,
    dims: { ...base, staff: d.appliedBy, approval_actor: db.grants.find((g) => g.id === d.approvalGrantId)?.approverUserId ?? null, void_reason: d.reasonCode },
    n: { amount: shares[i], one: '1' },
    ref: { kind: 'DISCOUNT' as const, id: d.id, orderId: o.id, label: `${checkLabel(db, o)} — خصم ${d.type === 'PERCENTAGE' ? d.value + '%' : d.value + ' ج.م'}${d.label ? ' · ' + d.label.ar : ''}`, businessDate: o.completedBusinessDate, at: d.appliedAt, amount: shares[i] },
  }));
});
const buildComp: Builder = (db, s) => completedSales(db, s).filter((o) => o.comp).map((o) => {
  const p = checkParts(o);
  return { kind: 'comp', id: o.id, branchId: o.branchId, businessDate: o.completedBusinessDate, recordedMs: o.completedAtMs ?? 0, dims: { ...checkDims(db, o), staff: o.comp!.by, approval_actor: null, void_reason: o.comp!.reasonCode }, n: { amount: m4(p.gross), one: '1' }, ref: { kind: 'CHECK', id: o.id, orderId: o.id, label: `${checkLabel(db, o)} — ضيافة`, businessDate: o.completedBusinessDate, at: o.comp!.at, amount: m4(p.gross) } } satisfies Fact;
});

const buildStaffMeal: Builder = (db, s) => db.orders.filter((o) => o.kind === 'STAFF_MEAL' && branchOk(s, o.branchId) && (o.status === 'COMPLETED' || o.status === 'CONFIRMED') && inRange(o.completedBusinessDate ?? o.businessDate, s.from, s.to) && (o.completedAtMs ?? o.createdAtMs) <= s.asOfMs).flatMap((o) => {
  const bd = o.completedBusinessDate ?? o.businessDate;
  const ms = o.completedAtMs ?? o.createdAtMs;
  const sm = o.staffMeal;
  const employee = sm?.employeeUserId ?? db.users.find((u) => u.displayName === o.customerName)?.id ?? o.customerName ?? null;
  return o.lines.filter((l) => l.status === 'ACTIVE').map((l, i) => {
    const c = lineCostAt(db, l, ms);
    const value = m4(D(l.unitTotal).times(l.quantity));
    return {
      kind: 'staff_meal' as FactKind, id: `${o.id}:${l.id}`, branchId: o.branchId, businessDate: bd, recordedMs: ms,
      dims: { ...dayDims(db, bd), branch: o.branchId, staff: employee, approval_actor: sm?.approverId ?? null, product: l.productId, category: l.categoryId, check: o.id },
      n: { value, qty: l.quantity, first: i === 0 ? '1' : '0', ...(c.cost !== null ? { cost: c.cost } : {}) },
      key: { meal: o.id },
      ref: { kind: 'STAFF_MEAL' as const, id: l.id, orderId: o.id, label: `وجبة ${sm?.employeeName ?? o.customerName ?? uname(db, employee)} — ${l.name.ar} ×${Number(l.quantity)}`, businessDate: bd, at: o.completedAt ?? o.createdAt, amount: value, note: c.basis === 'NO_RECIPE' ? 'no-recipe' : null },
    };
  });
});

/** ux-07: the kitchen target of a branch — KitchenTimingPolicy (branch value, else the restaurant's), 15 minutes by default. */
const kitchenTarget = (db: DB, branchId: string): number => {
  const vals = ((db as any).policyValues ?? []).filter((v: any) => v.policyId === 'KitchenTimingPolicy');
  const hit = vals.find((v: any) => v.scopeType === 'BRANCH' && v.scopeId === branchId) ?? vals.find((v: any) => v.scopeType === 'TENANT');
  return Number(hit?.value?.targetMinutes ?? 15) || 15;
};
const buildKitchen: Builder = (db, s) => db.tickets.flatMap((t) => {
  const o = db.orders.find((x) => x.id === t.orderId);
  if (!o || !branchOk(s, o.branchId) || t.createdAtMs > s.asOfMs) return [];
  const bd = bdAt(db, o.branchId, t.createdAtMs);
  if (!inRange(bd, s.from, s.to)) return [];
  const st = db.stations.find((x) => x.id === t.stationId);
  const readyMs = t.readyAt && isoMs(t.readyAt) <= s.asOfMs ? isoMs(t.readyAt) : null;
  const mins = ((readyMs ?? s.asOfMs) - t.createdAtMs) / 60000;
  const target = kitchenTarget(db, o.branchId); // ux-07: the venue default (KitchenTimingPolicy), as on the kitchen screens
  return [{
    kind: 'kitchen' as FactKind, id: t.id, branchId: o.branchId, businessDate: bd, recordedMs: t.createdAtMs,
    dims: { ...dayDims(db, bd), branch: o.branchId, daypart: daypartOf(t.createdAtMs), hour: String(cairoHour(t.createdAtMs)).padStart(2, '0'), station: t.stationId, channel: t.channel, check: o.id },
    n: { minutes: readyMs ? m4(mins) : '0', done: readyMs ? '1' : '0', late: mins > target ? '1' : '0' },
    ref: { kind: 'TICKET' as const, id: t.id, orderId: o.id, label: `#${t.orderNumber} — ${st?.name ?? t.stationId} (جولة ${t.round})`, businessDate: bd, at: t.createdAt, amount: readyMs ? m4(mins) : null, note: readyMs ? null : 'in-flight' },
  }];
});

const buildFiscal: Builder = (db, s) => db.fiscalDocuments.flatMap((f) => {
  if (!branchOk(s, f.branchId) || f.createdAtMs > s.asOfMs) return [];
  const bd = bdAt(db, f.branchId, f.createdAtMs);
  if (!inRange(bd, s.from, s.to)) return [];
  return [{ kind: 'fiscal' as FactKind, id: f.id, branchId: f.branchId, businessDate: bd, recordedMs: f.createdAtMs, dims: { ...dayDims(db, bd), branch: f.branchId, fiscal_status: f.state, device: f.terminalId, check: f.orderId }, n: { accepted: f.state === 'ACCEPTED' ? '1' : '0', rejected: f.state === 'REJECTED' ? '1' : '0', pending: ['PENDING_DATA', 'BUILT', 'SUBMITTED'].includes(f.state) ? '1' : '0' }, key: { mode: f.mode }, ref: { kind: 'FISCAL' as const, id: f.id, orderId: f.orderId, label: `إيصال #${f.orderNumber} — ${f.state} (${f.mode === 'SANDBOX' ? 'تجريبي' : 'حقيقي'})`, businessDate: bd, at: f.createdAt, amount: f.total } }];
});

const buildApproval: Builder = (db, s) => {
  const out: Fact[] = [];
  for (const g of db.grants) {
    if (!g.consumedAt) continue;
    const ms = isoMs(g.issuedAt); const br = g.branchId ?? s.branchIds[0];
    if (!branchOk(s, br) || ms > s.asOfMs) continue;
    const bd = bdAt(db, br, ms);
    if (!inRange(bd, s.from, s.to)) continue;
    out.push({ kind: 'approval', id: g.id, branchId: br, businessDate: bd, recordedMs: ms, dims: { ...dayDims(db, bd), branch: br, approval_actor: g.approverUserId, staff: g.requesterUserId, void_reason: g.action }, n: { granted: '1', denied: '0', self: g.approverUserId === g.requesterUserId ? '1' : '0' }, ref: { kind: 'APPROVAL', id: g.id, label: `${g.action} — ${uname(db, g.requesterUserId)} ← ${uname(db, g.approverUserId)}`, businessDate: bd, at: g.issuedAt, amount: '1' } });
  }
  for (const r of db.approvalRequests ?? []) {
    if (r.state !== 'REJECTED') continue;
    const br = r.branchId ?? s.branchIds[0];
    if (!branchOk(s, br) || r.createdAtMs > s.asOfMs) continue;
    const bd = bdAt(db, br, r.createdAtMs);
    if (!inRange(bd, s.from, s.to)) continue;
    out.push({ kind: 'approval', id: r.id, branchId: br, businessDate: bd, recordedMs: r.createdAtMs, dims: { ...dayDims(db, bd), branch: br, approval_actor: r.decidedBy, staff: r.requesterUserId, void_reason: r.action }, n: { granted: '0', denied: '1', self: '0' }, ref: { kind: 'APPROVAL', id: r.id, label: `اترفض: ${r.actionTitle} — ${uname(db, r.requesterUserId)}`, businessDate: bd, at: r.createdAt, amount: '1' } });
  }
  return out;
};

/** Stock snapshot at asOf (semi-additive): last movement ≤ asOf per item × warehouse. */
const buildStock: Builder = (db, s) => {
  if (!(db as any).inv) return [];
  const inv = invOf(db);
  const out: Fact[] = [];
  for (const w of inv.warehouses.filter((x) => branchOk(s, x.branchId))) {
    for (const it of inv.items) {
      const mv = inv.movements.filter((m) => m.itemId === it.id && m.warehouseId === w.id && m.atMs <= s.asOfMs).sort((a, b) => a.seq - b.seq).at(-1);
      const bal = inv.balances.find((b) => b.itemId === it.id && b.warehouseId === w.id);
      if (!mv && !bal) continue;
      const qty = mv ? mv.balanceAfter : bal!.quantity;
      const avg = mv ? mv.avgCostAfter : it.avgCost;
      const level = it.levels?.[w.id];
      out.push({ kind: 'stock', id: `${it.id}@${w.id}`, branchId: w.branchId, businessDate: null, recordedMs: mv?.atMs ?? 0, dims: { branch: w.branchId, location: w.id, inventory_item: it.id }, n: { qty, value: m4(D(qty).times(avg)), min: level?.min ?? '', par: level?.par ?? '' }, key: { unit: it.stockUnitId }, ref: { kind: 'STOCK', id: mv?.id ?? `${it.id}@${w.id}`, label: `${it.name.ar} — ${w.name}`, at: mv?.at ?? null, amount: qty, note: `unit ${it.stockUnitId}` } });
    }
  }
  return out;
};
const buildWaste: Builder = (db, s) => {
  if (!(db as any).inv) return [];
  const inv = invOf(db);
  return inv.waste.flatMap((w) => {
    const wh = inv.warehouses.find((x) => x.id === w.warehouseId);
    if (!wh || !branchOk(s, wh.branchId) || !inRange(w.businessDate, s.from, s.to) || isoMs(w.at) > s.asOfMs) return [];
    return [{ kind: 'waste' as FactKind, id: w.id, branchId: wh.branchId, businessDate: w.businessDate, recordedMs: isoMs(w.at), dims: { ...dayDims(db, w.businessDate), branch: wh.branchId, location: wh.id, inventory_item: w.itemId, void_reason: w.reason }, n: { qty: w.quantity, value: w.value }, key: { unit: inv.items.find((i) => i.id === w.itemId)?.stockUnitId ?? '' }, ref: { kind: 'WASTE' as const, id: w.id, label: `${w.number} — ${w.name.ar} ${Number(w.quantity)}`, businessDate: w.businessDate, at: w.at, amount: w.value } }];
  });
};
const buildCount: Builder = (db, s) => {
  if (!(db as any).inv) return [];
  const inv = invOf(db);
  return inv.counts.filter((c) => c.state === 'POSTED' && c.postedAt && isoMs(c.postedAt) <= s.asOfMs).flatMap((c) => {
    const wh = inv.warehouses.find((x) => x.id === c.warehouseId);
    if (!wh || !branchOk(s, wh.branchId)) return [];
    const bd = bdAt(db, wh.branchId, isoMs(c.postedAt));
    if (!inRange(bd, s.from, s.to)) return [];
    return c.lines.filter((l) => l.varianceQty).map((l) => ({ kind: 'count' as FactKind, id: `${c.id}:${l.itemId}`, branchId: wh.branchId, businessDate: bd, recordedMs: isoMs(c.postedAt), dims: { ...dayDims(db, bd), branch: wh.branchId, location: wh.id, inventory_item: l.itemId }, n: { qty: l.varianceQty!, value: l.varianceValue ?? '0' }, key: { unit: inv.items.find((i) => i.id === l.itemId)?.stockUnitId ?? '' }, ref: { kind: 'STOCK' as const, id: c.id, label: `جرد ${c.number} — ${inv.items.find((i) => i.id === l.itemId)?.name.ar ?? l.itemId}`, businessDate: bd, at: c.postedAt, amount: l.varianceQty! } }));
  });
};
const buildPO: Builder = (db, s) => {
  if (!(db as any).inv) return [];
  const inv = invOf(db);
  return inv.purchaseOrders.filter((p) => p.state !== 'DRAFT' && p.state !== 'CANCELLED' && branchOk(s, p.branchId)).flatMap((p) => {
    const ms = isoMs(p.issuedAt ?? p.createdAt); const bd = bdAt(db, p.branchId, ms);
    if (!inRange(bd, s.from, s.to) || ms > s.asOfMs) return [];
    return p.lines.map((l) => ({ kind: 'po' as FactKind, id: `${p.id}:${l.id}`, branchId: p.branchId, businessDate: bd, recordedMs: ms, dims: { ...dayDims(db, bd), branch: p.branchId, supplier: p.supplierId, inventory_item: l.itemId }, n: { value: m4(D(l.orderedQuantity).times(l.orderedUnitCost)), qty: l.orderedQuantity }, key: { state: p.state }, ref: { kind: 'PO' as const, id: p.id, label: `أمر شراء ${p.number} — ${inv.items.find((i) => i.id === l.itemId)?.name.ar ?? l.itemId}`, businessDate: bd, at: p.issuedAt, amount: m4(D(l.orderedQuantity).times(l.orderedUnitCost)) } }));
  });
};
const buildGRN: Builder = (db, s) => {
  if (!(db as any).inv) return [];
  const inv = invOf(db);
  return inv.receipts.filter((r) => r.state === 'POSTED' && isoMs(r.at) <= s.asOfMs).flatMap((r) => {
    const wh = inv.warehouses.find((x) => x.id === r.warehouseId);
    if (!wh || !branchOk(s, wh.branchId) || !inRange(r.businessDate, s.from, s.to)) return [];
    return r.lines.map((l) => ({ kind: 'grn' as FactKind, id: `${r.id}:${l.id}`, branchId: wh.branchId, businessDate: r.businessDate, recordedMs: isoMs(r.at), dims: { ...dayDims(db, r.businessDate), branch: wh.branchId, supplier: r.supplierId, inventory_item: l.itemId }, n: { value: l.value, qty: l.quantity, unit_cost: l.unitCost }, key: { po: r.purchaseOrderId ?? '' }, ref: { kind: 'GRN' as const, id: r.id, label: `استلام ${r.number} — ${inv.items.find((i) => i.id === l.itemId)?.name.ar ?? l.itemId}`, businessDate: r.businessDate, at: r.at, amount: l.value } }));
  });
};
const buildVisit: Builder = (db, s) => db.visits.filter((v) => v.state === 'CLOSED' && v.closedAt && branchOk(s, v.branchId) && isoMs(v.closedAt) <= s.asOfMs).flatMap((v) => {
  const ms = isoMs(v.closedAt); const bd = bdAt(db, v.branchId, ms);
  if (!inRange(bd, s.from, s.to)) return [];
  const tb = db.tables.find((t) => t.id === v.tableId);
  return [{ kind: 'visit' as FactKind, id: v.id, branchId: v.branchId, businessDate: bd, recordedMs: ms, dims: { ...dayDims(db, bd), branch: v.branchId, daypart: daypartOf(v.openedAtMs), table: v.tableId, revenue_center: tb?.area ?? null, staff: v.serverUserId, table_visit: v.id }, n: { one: '1', minutes: m4((ms - v.openedAtMs) / 60000), guests: String(v.guestCount) }, ref: { kind: 'VISIT' as const, id: v.id, label: `قعدة ترابيزة ${tb?.name ?? v.tableId} — ${v.guestCount} ضيوف`, businessDate: bd, at: v.openedAt, amount: m4((ms - v.openedAtMs) / 60000) } }];
});
/** ux-17: the rider pay rule in force for a branch (DriverPayPolicy: BRANCH value, else TENANT, else the default) — read
 *  from the db passed in (no global store), the same precedence as the delivery handlers. */
function riderPayRule(db: DB, branchId: string): { mode: string; perTripAmount: string; feePercent: string } {
  const vals = (db.policyValues ?? []).filter((v: any) => v.policyId === 'DriverPayPolicy');
  const v: any = (vals.find((x: any) => x.scopeType === 'BRANCH' && x.scopeId === branchId) ?? vals.find((x: any) => x.scopeType === 'TENANT'))?.value ?? {};
  const mode = ['PER_TRIP', 'FIXED_SHIFT', 'PERCENT_OF_FEE'].includes(v.mode) ? v.mode : 'PER_TRIP';
  const ok = (x: unknown) => typeof x === 'string' || typeof x === 'number' ? /^\d+(\.\d+)?$/.test(String(x)) : false;
  return { mode, perTripAmount: ok(v.perTripAmount) ? String(v.perTripAmount) : '15', feePercent: ok(v.feePercent) && D(v.feePercent).lte(100) ? String(v.feePercent) : '30' };
}
/** ux-17: what a delivered trip cost in rider pay, or why it is not known. A trip already paid uses the payout's own
 *  immutable rule and rate; an unpaid trip the rule in force. A shift-paid rider has no per-trip cost, and an order from
 *  a delivery app has a partner commission that is not recorded — both stay unknown (never 0). */
export type TripCost = { cost: string } | { unknown: 'FIXED_SHIFT' | 'PARTNER' };
export function tripRiderCost(db: DB, d: any): TripCost {
  const ext = d.externalOrderId ? ((db as any).externalOrders ?? []).find((x: any) => x.id === d.externalOrderId) : null;
  if (ext && /^APP_/.test(ext.source)) return { unknown: 'PARTNER' };
  const paid = ((db as any).driverPayouts ?? []).find((p: any) => (p.tripIds ?? []).includes(d.id));
  const rule = paid ? { mode: paid.mode, rate: String(paid.rate) } : (() => { const r = riderPayRule(db, d.branchId); return { mode: r.mode, rate: r.mode === 'PERCENT_OF_FEE' ? r.feePercent : r.perTripAmount }; })();
  if (rule.mode === 'FIXED_SHIFT') return { unknown: 'FIXED_SHIFT' };
  if (rule.mode === 'PERCENT_OF_FEE') return { cost: m4(D(d.fee || 0).times(rule.rate).dividedBy(100)) };
  return { cost: m4(rule.rate) };
}
const buildDelivery: Builder = (db, s) => ((db as any).deliveries ?? []).flatMap((d: any) => {
  if (!branchOk(s, d.branchId) || d.createdAtMs > s.asOfMs) return [];
  const bd = bdAt(db, d.branchId, d.createdAtMs);
  if (!inRange(bd, s.from, s.to)) return [];
  const done = d.deliveredAt && d.pickedUpAt;
  // ux-17: delivery_fee_net — only a delivered trip (recorded by asOf) earns its fee and costs its rider pay
  const delivered = !!d.deliveredAt && isoMs(d.deliveredAt) <= s.asOfMs;
  const tc = delivered ? tripRiderCost(db, d) : { cost: '0' };
  const n: Record<string, string> = { minutes: done ? m4((isoMs(d.deliveredAt) - isoMs(d.pickedUpAt)) / 60000) : '0', delivered: d.deliveredAt ? '1' : '0', failed: String(d.attempts?.length ?? 0), fee: delivered ? m4(d.fee || 0) : '0' };
  if ('cost' in tc) n.rider_cost = tc.cost;
  return [{ kind: 'delivery' as FactKind, id: d.id, branchId: d.branchId, businessDate: bd, recordedMs: d.createdAtMs, dims: { ...dayDims(db, bd), branch: d.branchId, zone: d.zoneId, driver: d.driverId, channel: 'DELIVERY' }, n, key: 'unknown' in tc ? { cost_basis: tc.unknown } : undefined, ref: { kind: 'DELIVERY' as const, id: d.id, orderId: d.orderId, label: `دليفري ${d.number} — ${d.zoneName}`, businessDate: bd, at: d.createdAt, amount: d.amount } }];
});
const buildReservation: Builder = (db, s) => db.reservations.flatMap((r) => {
  if (!branchOk(s, r.branchId)) return [];
  const ms = isoMs(r.at); const bd = bdAt(db, r.branchId, ms);
  if (!inRange(bd, s.from, s.to) || isoMs(r.createdAt) > s.asOfMs) return [];
  return [{ kind: 'reservation' as FactKind, id: r.id, branchId: r.branchId, businessDate: bd, recordedMs: isoMs(r.createdAt), dims: { ...dayDims(db, bd), branch: r.branchId, table: r.tableId }, n: { one: '1', no_show: r.state === 'NO_SHOW' ? '1' : '0' }, ref: { kind: 'RESERVATION' as const, id: r.id, label: `حجز ${r.customer} — ${r.partySize} أفراد`, businessDate: bd, at: r.at, amount: '1' } }];
});
const buildOpenCheck: Builder = (db, s) => db.orders.filter((o) => o.kind === 'SALE' && (o.status === 'DRAFT' || o.status === 'CONFIRMED') && branchOk(s, o.branchId) && o.createdAtMs <= s.asOfMs).map((o) => {
  const t = computeTotals(o);
  const paid = db.captures.filter((c) => c.orderId === o.id).reduce((a, c) => a.plus(c.amount).plus(c.rounding ?? 0), D(0));
  const rem = D(t.payable).minus(paid);
  return { kind: 'open_check', id: o.id, branchId: o.branchId, businessDate: o.businessDate, recordedMs: o.createdAtMs, dims: { branch: o.branchId, channel: o.channel, staff: o.serverUserId, check: o.id, table: o.tableId }, n: { one: '1', remaining: m4(rem.gt(0) ? rem : 0) }, key: { status: o.status }, ref: { kind: 'CHECK', id: o.id, orderId: o.id, label: `${checkLabel(db, o)} — ${o.status === 'DRAFT' ? 'قيد الإدخال' : 'مؤكد وغير مدفوع'}`, businessDate: o.businessDate, at: o.createdAt, amount: m4(rem.gt(0) ? rem : 0) } } satisfies Fact;
});
/** Pre-launch days: aggregates only (no check-level evidence). Used only for days without event facts. */
const buildHistory: Builder = (db, s) => (db.salesHistory ?? []).filter((h) => branchOk(s, h.branchId) && inRange(h.businessDate, s.from, s.to)).map((h) => ({ kind: 'history', id: `${h.branchId}:${h.businessDate}`, branchId: h.branchId, businessDate: h.businessDate, recordedMs: 0, dims: { ...dayDims(db, h.businessDate), branch: h.branchId }, n: { net: h.netSales, orders: String(h.orders), guests: String(h.guests), cash: h.byMethod.CASH ?? '0', card: h.byMethod.CARD ?? '0', wallet: h.byMethod.DIGITAL_WALLET ?? '0' }, ref: { kind: 'HISTORY', id: `${h.branchId}:${h.businessDate}`, label: `إجمالي مستورد ليوم ${h.businessDate} (قبل تشغيل النظام — بلا شيكات)`, businessDate: h.businessDate, amount: h.netSales, note: 'aggregate-only' } }));

export const BUILDERS: Partial<Record<FactKind, Builder>> = {
  check: buildCheck, line: buildLine, payment: buildPayment, refund: buildRefund, drawer: buildDrawer, cash_entry: buildCashEntry, removal: buildRemoval,
  discount: buildDiscount, comp: buildComp, staff_meal: buildStaffMeal, kitchen: buildKitchen, fiscal: buildFiscal, approval: buildApproval, stock: buildStock,
  waste: buildWaste, count: buildCount, po: buildPO, grn: buildGRN, visit: buildVisit, delivery: buildDelivery, reservation: buildReservation, open_check: buildOpenCheck, history: buildHistory,
};

/** Cached per query: a fact kind is built once per (scope) even when several metrics read it. */
export function factsOf(db: DB, kind: FactKind, s: FactScope, cache: Map<string, Fact[]>): Fact[] {
  const k = `${kind}|${s.branchIds.join(',')}|${s.from}|${s.to}|${s.asOfMs}`;
  let v = cache.get(k);
  if (!v) { v = BUILDERS[kind]?.(db, s) ?? []; cache.set(k, v); }
  return v;
}
