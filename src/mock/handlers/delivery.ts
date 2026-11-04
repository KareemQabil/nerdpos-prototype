// Delivery: zones (fee, minimum, ETA), drivers (status, location, cash in hand), the delivery lifecycle
// PENDING → ASSIGNED → PICKED_UP → DELIVERED, FAILED (retry or return) and CANCELLED, plus the driver's cash
// settlement into the cashier drawer at the end of a trip.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event, hist } from '../store';
import { policy } from '../policies';
import { computeLiveTotals, computeTotals, activeLines } from '../pricing';
import { D, m4, isMoney, sub } from '../money';
import { checkVersion, getOrder, need, openSessionOn, page, requireFields, settlementOf, userName } from './util';
import { orderHandlers } from './orders';
import { setOrderCustomer, zoneForArea, arNorm, normPhone, PHONE_RE, custs } from './customers';
import { RESTAURANT_XY } from '../seed-crm';
import { businessDate } from '../clock';
import type { DB, Order, Capture, CashEntry } from '../types';
import type { Delivery, DeliveryState, DeliveryZone, Driver, DriverSettlement, DriverShift, DriverOwedEntry, DriverOwedKind, DriverPayout, DriverPayMode } from '../types-crm';

export const zonesOf = (db: DB) => (db.deliveryZones ??= []);
export const driversOf = (db: DB) => (db.drivers ??= []);
export const deliveriesOf = (db: DB) => (db.deliveries ??= []);
const settlementsOf = (db: DB) => (db.driverSettlements ??= []);
export const shiftsOf = (db: DB) => (db.driverShifts ??= []);
export const owedEntriesOf = (db: DB) => (db.driverOwedEntries ??= []);
export const payoutsOf = (db: DB) => (db.driverPayouts ??= []);
// ux-11: RETURNED (the food came back after a failed attempt) is still an open delivery
const ACTIVE: DeliveryState[] = ['PENDING', 'ASSIGNED', 'PICKED_UP', 'FAILED', 'RETURNED'];
const ON_ROAD: DeliveryState[] = ['ASSIGNED', 'PICKED_UP'];
/** States a rider can be (re)assigned from. */
const ASSIGNABLE: DeliveryState[] = ['PENDING', 'FAILED', 'RETURNED', 'ASSIGNED'];

export type CashLimitMode = 'APPROVAL' | 'BLOCK' | 'WARN';
export interface DeliveryRules { feeTaxable: boolean; graceMinutes: number; readyWaitMinutes: number; maxActivePerDriver: number; driverCashLimit: string; cashLimitMode: CashLimitMode; packagingOnDelivery: boolean }
export function rules(branchId?: string | null): DeliveryRules {
  const v = policy<Partial<DeliveryRules>>('DeliveryPolicy', { branchId }) ?? {};
  // ux-11 owner decision 3 (default): a rider who would carry more than the cash limit is assigned only with a manager's approval
  const mode = (['APPROVAL', 'BLOCK', 'WARN'] as const).find((x) => x === v.cashLimitMode) ?? 'APPROVAL';
  return { feeTaxable: v.feeTaxable !== false, graceMinutes: Number(v.graceMinutes ?? 10), readyWaitMinutes: Number(v.readyWaitMinutes ?? 10), maxActivePerDriver: Number(v.maxActivePerDriver ?? 3), driverCashLimit: isMoney(v.driverCashLimit) ? String(v.driverCashLimit) : '2000', cashLimitMode: mode, packagingOnDelivery: v.packagingOnDelivery !== false };
}

/** ux-11 owner decision 1 (default): DriverPayPolicy — a fixed amount per DELIVERED trip. */
export interface PayRules { mode: DriverPayMode; perTripAmount: string; shiftAmount: string; feePercent: string }
export function payRules(branchId?: string | null): PayRules {
  const v = policy<Partial<PayRules>>('DriverPayPolicy', { branchId }) ?? {};
  const mode = (['PER_TRIP', 'FIXED_SHIFT', 'PERCENT_OF_FEE'] as const).find((x) => x === v.mode) ?? 'PER_TRIP';
  const money = (x: unknown, d: string) => (isMoney(x) && D(x as string).gte(0) ? m4(x as string) : m4(d));
  const pctV = isMoney(v.feePercent) && D(v.feePercent as string).gte(0) && D(v.feePercent as string).lte(100) ? String(v.feePercent) : '30';
  return { mode, perTripAmount: money(v.perTripAmount, '15'), shiftAmount: money(v.shiftAmount, '150'), feePercent: pctV };
}

/**
 * ux-11: the rider a signed-in user IS. A user linked to a rider record (Driver.userId) who cannot assign riders works
 * as that rider: every delivery read and command is limited to the rider's own deliveries (server side, not only in
 * the UI). A user who can neither assign nor create deliveries and is linked to no rider (the rider role without a
 * link) sees no rider at all — fail closed. Dispatchers, cashiers, managers and the call center are not limited.
 */
export function riderScope(ctx: Ctx): { driver: Driver | null } | null {
  if (!ctx.user || ctx.can('delivery:assign')) return null;
  const drv = driversOf(ctx.db).find((d) => d.userId === ctx.user!.id) ?? null;
  if (drv) return { driver: drv };
  if (ctx.can('delivery:create')) return null;
  return { driver: null };
}
const ownDelivery = (ctx: Ctx, d: Delivery) => { const s = riderScope(ctx); return !s || (!!s.driver && d.driverId === s.driver.id); };

/** Run another handler inside the same transaction (same db snapshot, user, terminal). */
export function subCall(ctx: Ctx, opId: string, params: Record<string, string>, body: any): any {
  const r = (orderHandlers[opId] as any)({ ...ctx, params, body, query: {} });
  return r && typeof r === 'object' && typeof r.status === 'number' && 'body' in r ? r.body : r;
}

export const REASONS: Record<string, { ar: string; en: string }> = {
  NO_ANSWER: { ar: 'العميل لا يرد', en: 'Customer not answering' },
  WRONG_ADDRESS: { ar: 'العنوان غلط أو ناقص', en: 'Wrong or incomplete address' },
  CUSTOMER_NOT_HOME: { ar: 'العميل غير موجود', en: 'Customer not at home' },
  CUSTOMER_REFUSED: { ar: 'العميل رفض الاستلام', en: 'Customer refused' },
  VEHICLE_ISSUE: { ar: 'عطل في الموتوسيكل', en: 'Vehicle problem' },
  OTHER: { ar: 'سبب آخر', en: 'Other' },
};

function kitchenStatus(db: DB, d: Delivery) {
  if (!d.orderId) return { state: 'HANDED' as const, readyAt: d.pickedUpAt ?? null };
  const o = db.orders.find((x) => x.id === d.orderId);
  if (!o || !o.rounds.length) return { state: 'NOT_SENT' as const, readyAt: null };
  const tickets = db.tickets.filter((t) => t.orderId === o.id);
  const pendingRouting = db.kitchenDeliveries.some((k) => k.orderId === o.id && k.state !== 'DELIVERED');
  if (!tickets.length) return pendingRouting ? { state: 'WAITING' as const, readyAt: null } : { state: 'READY' as const, readyAt: o.confirmedAt };
  if (tickets.every((t) => t.state === 'DONE')) return { state: 'HANDED' as const, readyAt: tickets.map((t) => t.readyAt ?? t.doneAt ?? '').sort().at(-1) ?? null };
  if (tickets.every((t) => t.state === 'READY' || t.state === 'DONE') && !pendingRouting) return { state: 'READY' as const, readyAt: tickets.map((t) => t.readyAt ?? '').sort().at(-1) ?? null };
  if (tickets.some((t) => t.state === 'IN_PROGRESS' || t.state === 'READY')) return { state: 'COOKING' as const, readyAt: null };
  return { state: 'WAITING' as const, readyAt: null };
}

export function driverCash(db: DB, driverId: string) {
  const list = deliveriesOf(db).filter((d) => d.driverId === driverId && d.cod && !d.cod.settled && d.state === 'DELIVERED');
  return { amount: m4(list.reduce((a, d) => a.plus(D(d.cod!.amount)), D(0))), deliveries: list };
}

/** ux-11: cash the rider will carry once the deliveries already in his hands are paid: cash on hand (delivered, not
 *  settled) + the cash still to collect on the deliveries assigned to him / on the road. */
export function codDue(db: DB, d: Delivery): string {
  if (d.paymentMode !== 'CASH_ON_DELIVERY') return '0.0000';
  const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) ?? null : null;
  if (!o) return m4(d.amount);
  if (o.status === 'CANCELLED' || o.status === 'VOIDED') return '0.0000';
  if (o.status === 'CONFIRMED' || o.status === 'COMPLETED') return settlementOf(db, o).remaining;
  return computeLiveTotals(o).payable;
}
export function cashExposure(db: DB, driverId: string, exceptId?: string) {
  const onRoad = deliveriesOf(db).filter((d) => d.driverId === driverId && d.id !== exceptId && ON_ROAD.includes(d.state));
  return m4(onRoad.reduce((a, d) => a.plus(D(codDue(db, d))), D(driverCash(db, driverId).amount)));
}
/** When the rider became free: the later of the shift start and his last hand-over / failed attempt / return. */
export function availableSince(db: DB, drv: Driver, now: number): string | null {
  if (!drv.onShift) return null;
  const shift = shiftsOf(db).find((s) => s.driverId === drv.id && !s.endedAt);
  let at = shift?.startedAt ?? drv.location?.at ?? new Date(now).toISOString();
  for (const d of deliveriesOf(db)) {
    if (d.driverId === drv.id && d.deliveredAt && d.deliveredAt > at) at = d.deliveredAt;
    for (const a of d.attempts) if (a.driverId === drv.id && a.at > at) at = a.at;
  }
  return at;
}

// ───────── ux-11: rider shifts, owed ledger, pay
function startShift(ctx: Ctx, drv: Driver) {
  if (!drv.active) throw new ApiError('DRIVER_NOT_FOUND', { driverId: drv.id });
  if (drv.onShift) throw new ApiError('DRIVER_SHIFT_ALREADY_OPEN', { driverId: drv.id }, 409);
  const sh: DriverShift = { id: nextId('dsh'), driverId: drv.id, branchId: drv.branchId, startedAt: ctx.nowIso, startedAtMs: ctx.now, startedBy: ctx.user!.id, endedAt: null, endedAtMs: null, endedBy: null, minutes: null, terminalId: ctx.terminal?.id ?? null, version: 1 };
  shiftsOf(ctx.db).unshift(sh);
  drv.onShift = true; drv.shiftId = sh.id;
  drv.location = { ...RESTAURANT_XY, at: ctx.nowIso };
  return sh;
}
/** Ending a shift keeps the rule: no orders on the road and no cash left with the rider. The minutes are recorded. */
function endShift(ctx: Ctx, drv: Driver) {
  if (!drv.onShift) throw new ApiError('DRIVER_SHIFT_NOT_OPEN', { driverId: drv.id }, 409);
  const carrying = deliveriesOf(ctx.db).filter((x) => x.driverId === drv.id && ON_ROAD.includes(x.state)).length;
  if (carrying) throw new ApiError('DRIVER_HAS_ACTIVE_DELIVERIES', { carrying });
  const cash = driverCash(ctx.db, drv.id).amount;
  if (D(cash).gt(0)) throw new ApiError('DRIVER_CASH_NOT_SETTLED', { cashInHand: cash });
  const sh = shiftsOf(ctx.db).find((s) => s.driverId === drv.id && !s.endedAt) ?? null;
  if (sh) { sh.endedAt = ctx.nowIso; sh.endedAtMs = ctx.now; sh.endedBy = ctx.user!.id; sh.minutes = Math.max(0, Math.floor((ctx.now - sh.startedAtMs) / 60000)); sh.version++; }
  drv.onShift = false; drv.shiftId = null; drv.location = null;
  return sh;
}
export function shiftView(db: DB, sh: DriverShift, now: number) {
  const minutes = sh.minutes ?? Math.max(0, Math.floor((now - sh.startedAtMs) / 60000));
  const trips = deliveriesOf(db).filter((d) => d.driverId === sh.driverId && d.state === 'DELIVERED' && d.deliveredAt && Date.parse(d.deliveredAt) >= sh.startedAtMs && Date.parse(d.deliveredAt) <= (sh.endedAtMs ?? now)).length;
  return { ...sh, open: !sh.endedAt, minutes, trips, driverName: driversOf(db).find((d) => d.id === sh.driverId)?.name ?? sh.driverId, startedByName: userName(db, sh.startedBy), endedByName: sh.endedBy ? userName(db, sh.endedBy) : null };
}
function pushOwed(ctx: Ctx, drv: Driver, kind: DriverOwedKind, amount: string, extra: Partial<DriverOwedEntry> = {}): DriverOwedEntry {
  const before = m4(drv.owed);
  const after = kind === 'SHORTAGE' ? m4(D(before).plus(D(amount))) : m4(D(before).minus(D(amount)));
  const e: DriverOwedEntry = { id: nextId('dow'), driverId: drv.id, branchId: drv.branchId, kind, amount: m4(amount), owedBefore: before, owedAfter: after, at: ctx.nowIso, by: ctx.user!.id, reason: null, approvalGrantId: null, sessionId: null, settlementId: null, terminalId: ctx.terminal?.id ?? null, ...extra };
  owedEntriesOf(ctx.db).unshift(e);
  drv.owed = after;
  return e;
}
/** What a payout up to `periodTo` would pay: unpaid DELIVERED trips (or ended shifts) by the pay rule, less the owed
 *  amounts moved to the payout (DEDUCT_PAYOUT) and not yet netted by an earlier payout. */
export function payoutPreview(db: DB, drv: Driver, periodToMs: number) {
  const mine = payoutsOf(db).filter((p) => p.driverId === drv.id);
  const paidTrips = new Set(mine.flatMap((p) => p.tripIds));
  const paidShifts = new Set(mine.flatMap((p) => p.shiftIds));
  const netted = new Set(mine.flatMap((p) => p.deductionIds));
  const r = payRules(drv.branchId);
  const trips = deliveriesOf(db).filter((d) => d.driverId === drv.id && d.state === 'DELIVERED' && !!d.deliveredAt && Date.parse(d.deliveredAt) <= periodToMs && !paidTrips.has(d.id))
    .sort((a, b) => (a.deliveredAt ?? '').localeCompare(b.deliveredAt ?? ''));
  const shifts = shiftsOf(db).filter((s) => s.driverId === drv.id && s.endedAtMs !== null && s.endedAtMs <= periodToMs && !paidShifts.has(s.id));
  const gross = r.mode === 'PER_TRIP' ? m4(D(r.perTripAmount).times(trips.length))
    : r.mode === 'FIXED_SHIFT' ? m4(D(r.shiftAmount).times(shifts.length))
    : m4(trips.reduce((a, d) => a.plus(D(d.fee).times(D(r.feePercent)).dividedBy(100)), D(0)));
  const pending = owedEntriesOf(db).filter((e) => e.driverId === drv.id && e.kind === 'DEDUCT_PAYOUT' && !netted.has(e.id));
  const deductions = m4(pending.reduce((a, e) => a.plus(D(e.amount)), D(0)));
  const last = [...mine].sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0] ?? null;
  return {
    driverId: drv.id, mode: r.mode, rate: r.mode === 'PER_TRIP' ? r.perTripAmount : r.mode === 'FIXED_SHIFT' ? r.shiftAmount : r.feePercent,
    periodFrom: last?.periodTo ?? drv.createdAt, periodTo: new Date(periodToMs).toISOString(),
    trips: trips.map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, zoneName: d.zoneName, fee: d.fee, deliveredAt: d.deliveredAt })),
    shifts: (r.mode === 'FIXED_SHIFT' ? shifts : []).map((s) => ({ id: s.id, startedAt: s.startedAt, endedAt: s.endedAt, minutes: s.minutes })),
    allShiftIds: shifts.map((s) => s.id),
    gross, deductions, deductionIds: pending.map((e) => e.id), net: m4(D(gross).minus(D(deductions))),
  };
}

export function driverView(db: DB, drv: Driver, now: number) {
  const mine = deliveriesOf(db).filter((d) => d.driverId === drv.id);
  const active = mine.filter((d) => ON_ROAD.includes(d.state));
  const status = !drv.onShift ? 'OFF' : active.some((d) => d.state === 'PICKED_UP') ? 'ON_TRIP' : active.length ? 'ASSIGNED' : 'AVAILABLE';
  const cash = driverCash(db, drv.id);
  const limit = rules(drv.branchId).driverCashLimit;
  const today = new Date(now - 4 * 3600_000).toISOString().slice(0, 10);
  const deliveredToday = mine.filter((d) => d.state === 'DELIVERED' && (d.deliveredAt ?? '').slice(0, 10) >= today).length;
  const last = settlementsOf(db).filter((s) => s.driverId === drv.id).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const shift = drv.onShift ? shiftsOf(db).find((s) => s.driverId === drv.id && !s.endedAt) ?? null : null;
  return {
    ...drv, status, activeCount: active.length,
    shift: shift ? { id: shift.id, startedAt: shift.startedAt, minutes: Math.max(0, Math.floor((now - shift.startedAtMs) / 60000)) } : null,
    availableSince: availableSince(db, drv, now),
    active: active.map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, state: d.state, zoneName: d.zoneName, customerName: d.customerName, promisedAt: d.promisedAt, late: now > d.promisedAtMs + rules(d.branchId).graceMinutes * 60_000, amount: d.amount, paymentMode: d.paymentMode, zoneId: d.zoneId })),
    exposure: cashExposure(db, drv.id),
    cashInHand: cash.amount, cashDeliveries: cash.deliveries.map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, customerName: d.customerName, amount: d.cod!.amount, deliveredAt: d.deliveredAt })),
    overCashLimit: D(cash.amount).gt(D(limit)), cashLimit: m4(limit), deliveredToday, lastSettlement: last,
    locationAgeMinutes: drv.location ? Math.max(0, Math.floor((now - Date.parse(drv.location.at)) / 60000)) : null,
  };
}

export function deliveryView(db: DB, d: Delivery, now: number, full = false) {
  const r = rules(d.branchId);
  const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) ?? null : null;
  const terminal = d.state === 'DELIVERED' || d.state === 'CANCELLED';
  const k = kitchenStatus(db, d);
  const lateBy = Math.floor((now - d.promisedAtMs) / 60000);
  const late = !terminal && now > d.promisedAtMs + r.graceMinutes * 60_000;
  const readyWaiting = d.state === 'PENDING' && k.state === 'READY' && !!k.readyAt && now - Date.parse(k.readyAt) > r.readyWaitMinutes * 60_000;
  const deliveredLate = d.state === 'DELIVERED' && !!d.deliveredAt && Date.parse(d.deliveredAt) > d.promisedAtMs + r.graceMinutes * 60_000;
  const drv = d.driverId ? driversOf(db).find((x) => x.id === d.driverId) ?? null : null;
  const st = o && (o.status === 'CONFIRMED' || o.status === 'COMPLETED') ? settlementOf(db, o) : null;
  const base: any = {
    ...d, kitchen: k, late, lateMinutes: late ? lateBy : 0, minutesLeft: terminal ? null : -lateBy, readyWaiting, deliveredLate,
    ageMinutes: Math.max(0, Math.floor((now - d.createdAtMs) / 60000)),
    driver: drv ? { id: drv.id, name: drv.name, phone: drv.phone, vehicle: drv.vehicle } : null,
    order: o ? { id: o.id, number: o.number, status: o.status, version: o.version, payable: computeTotals(o).payable, paid: st?.paid ?? '0.0000', remaining: st ? st.remaining : computeTotals(o).payable, settled: st?.settled ?? false, items: activeLines(o).map((l) => `${l.name.ar} ×${l.quantity}`).join('، '), itemsEn: activeLines(o).map((l) => `${l.name.en || l.name.ar} ×${l.quantity}`).join(', '), itemCount: activeLines(o).length } : null,
    reasonLabels: d.attempts.map((a) => REASONS[a.reasonCode] ?? { ar: a.reasonCode, en: a.reasonCode }),
  };
  if (full && o) {
    base.lines = activeLines(o).map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, lineTotal: l.lineTotal, modifiers: l.modifiers.map((m) => m.name), note: l.note ?? null }));
    base.totals = computeTotals(o);
    base.customer = d.customerId ? custs(db).find((c) => c.id === d.customerId) ?? null : null;
  }
  return base;
}

function getDelivery(ctx: Ctx, id: string): Delivery {
  const d = deliveriesOf(ctx.db).find((x) => x.id === id);
  // ux-11: a rider reaches only his own deliveries (another rider's delivery does not exist for him)
  if (!d || (ctx.branchId && d.branchId !== ctx.branchId) || !ownDelivery(ctx, d)) throw new ApiError('DELIVERY_NOT_FOUND', { deliveryId: id });
  return d;
}
function getDriver(ctx: Ctx, id: string, opts: { inactive?: boolean } = {}): Driver {
  const drv = driversOf(ctx.db).find((x) => x.id === id && (x.active || opts.inactive) && (!ctx.branchId || x.branchId === ctx.branchId));
  const s = riderScope(ctx);
  if (!drv || (s && s.driver?.id !== drv.id)) throw new ApiError('DRIVER_NOT_FOUND', { driverId: id });
  return drv;
}
function step(ctx: Ctx, d: Delivery, kind: string, text: { ar: string; en: string }) {
  d.version++;
  d.timeline.push(hist(ctx.user?.id ?? 'system', kind, text, null, ctx.terminal?.code));
}
function invalid(d: Delivery, to: string, extra: Record<string, unknown> = {}): never {
  throw new ApiError('DELIVERY_TRANSITION_INVALID', { from: d.state, to, ...extra });
}
const zoneCenter = (z: DeliveryZone | undefined) => (z ? { x: Math.round(z.map.x + z.map.w / 2), y: Math.round(z.map.y + z.map.h / 2) } : RESTAURANT_XY);

function assignDriver(ctx: Ctx, d: Delivery, drv: Driver) {
  if (!drv.onShift) throw new ApiError('DRIVER_OFF_SHIFT', { driverId: drv.id, name: drv.name });
  const max = rules(d.branchId).maxActivePerDriver;
  const carrying = deliveriesOf(ctx.db).filter((x) => x.driverId === drv.id && x.id !== d.id && ON_ROAD.includes(x.state)).length;
  if (carrying >= max) throw new ApiError('DRIVER_AT_CAPACITY', { driverId: drv.id, name: drv.name, carrying, max });
  // ux-11 owner decision 3: the cash the rider would carry (cash on hand + cash to collect on his deliveries + this one)
  const r = rules(d.branchId);
  const exposure = m4(D(cashExposure(ctx.db, drv.id, d.id)).plus(D(codDue(ctx.db, d))));
  let overLimit: { exposure: string; limit: string; grantId: string | null } | null = null;
  if (D(exposure).gt(D(r.driverCashLimit))) {
    const limit = m4(r.driverCashLimit);
    if (r.cashLimitMode === 'BLOCK') throw new ApiError('DRIVER_CASH_LIMIT_EXCEEDED', { driverId: drv.id, name: drv.name, exposure, limit }, 409);
    const g = r.cashLimitMode === 'APPROVAL' ? ctx.requireApproval({ action: 'DRIVER_CASH_LIMIT_OVERRIDE', targetType: 'delivery.Driver', targetId: drv.id, context: { driverId: drv.id, deliveryId: d.id, exposure, limit }, grantId: ctx.body.approvalGrantId }) : null;
    overLimit = { exposure, limit, grantId: g?.id ?? null };
  }
  const before = d.driverId ? driversOf(ctx.db).find((x) => x.id === d.driverId)?.name : null;
  d.driverId = drv.id;
  d.state = 'ASSIGNED';
  d.assignedAt = ctx.nowIso;
  step(ctx, d, 'ASSIGNED', before && before !== drv.name ? { ar: `تغيّر الطيار من ${before} إلى ${drv.name}`, en: `reassigned ${before} → ${drv.name}` } : { ar: `سُلّم للطيار ${drv.name}`, en: `assigned to ${drv.name}` });
  if (overLimit) {
    step(ctx, d, 'CASH_LIMIT', { ar: `الطيار ${drv.name} سيحمل ${overLimit.exposure} ج.م والحد ${overLimit.limit} ج.م${overLimit.grantId ? ' — بموافقة المدير' : ' — تنبيه فقط'}`, en: `over the cash limit: ${overLimit.exposure} > ${overLimit.limit}${overLimit.grantId ? ' (approved)' : ' (warning)'}` });
    ctx.audit(`delivery ${d.number} assigned to ${drv.name} over the cash limit (${overLimit.exposure} > ${overLimit.limit}, ${r.cashLimitMode})`, d.id, true, overLimit.grantId ?? undefined);
  }
  return overLimit;
}

/** Capture on the drawer that settles or collects (the terminal's open session, else the order's own session). */
function collectingSessionFor(ctx: Ctx, o: Order) {
  const s = openSessionOn(ctx.db, ctx.terminal?.id) ?? (o.sessionId ? ctx.db.sessions.find((x) => x.id === o.sessionId && x.state === 'OPEN') ?? null : null);
  if (!s) throw new ApiError('SESSION_NOT_OPEN', { reason: 'delivery money is received on a terminal with an open drawer' });
  return s;
}
function pushCapture(ctx: Ctx, o: Order, sessionId: string, method: Capture['method'], amount: string, reference: string | null, provider: string | null = null): Capture {
  const c: Capture = { id: nextId('cap'), orderId: o.id, method, amount: m4(amount), tendered: method === 'CASH' ? m4(amount) : null, change: '0.0000', reference, walletProvider: provider, sessionId, terminalId: ctx.terminal?.id ?? '', branchId: o.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(o.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', rounding: '0.0000' };
  ctx.db.captures.push(c);
  return c;
}
function drawerEntry(ctx: Ctx, sessionId: string, kind: CashEntry['kind'], amount: string, extra: Partial<CashEntry> = {}) {
  ctx.db.cashEntries.push({ id: nextId('ce'), sessionId, kind, amount: m4(amount), at: ctx.nowIso, by: ctx.user!.id, ...extra });
  const s = ctx.db.sessions.find((x) => x.id === sessionId);
  if (s) s.version++;
}
function tryComplete(ctx: Ctx, o: Order): boolean {
  if (o.status !== 'CONFIRMED' || !settlementOf(ctx.db, o).settled) return false;
  try { subCall(ctx, 'Order.Complete', { orderId: o.id }, { expectedVersion: o.version }); return true; } catch (e) { if (e instanceof ApiError) return false; throw e; }
}

export const deliveryHandlers: Record<string, Handler> = {
  // ───────── zones
  'DeliveryZone.List': (ctx) => {
    const db = ctx.db;
    const list = zonesOf(db).filter((z) => !ctx.branchId || z.branchId === ctx.branchId).map((z) => {
      const ds = deliveriesOf(db).filter((d) => d.zoneId === z.id);
      return { ...z, activeDeliveries: ds.filter((d) => ACTIVE.includes(d.state)).length, deliveredTotal: ds.filter((d) => d.state === 'DELIVERED').length, customers: custs(db).filter((c) => c.active && c.addresses.some((a) => a.active && a.zoneId === z.id)).length };
    });
    return { ...page(list, ctx.query), rules: rules(ctx.branchId), restaurant: RESTAURANT_XY };
  },
  'DeliveryZone.Upsert': (ctx) => {
    const db = ctx.db;
    const b = ctx.body;
    need(b.name?.ar && String(b.name.ar).trim(), 'VALIDATION_FAILED', { field: 'name.ar', rule: 'required' });
    const areas: string[] = [...new Set(((b.areas ?? []) as string[]).map((a) => String(a).trim()).filter(Boolean))];
    need(areas.length, 'VALIDATION_FAILED', { field: 'areas', rule: 'at least one area' });
    need(isMoney(b.fee) && D(b.fee).gte(0), 'VALIDATION_FAILED', { field: 'fee' });
    need(isMoney(b.minOrder) && D(b.minOrder).gte(0), 'VALIDATION_FAILED', { field: 'minOrder' });
    const eta = Number(b.etaMinutes);
    need(Number.isInteger(eta) && eta >= 5 && eta <= 240, 'VALIDATION_FAILED', { field: 'etaMinutes', rule: '5..240' });
    let z = zonesOf(db).find((x) => x.id === ctx.params.zoneId);
    const active = b.active !== false;
    if (active) for (const other of zonesOf(db).filter((x) => x.active && x.id !== z?.id)) {
      const clash = areas.find((a) => other.areas.some((x) => arNorm(x) === arNorm(a)));
      if (clash) throw new ApiError('VALIDATION_FAILED', { field: 'areas', rule: 'an area belongs to one active zone', area: clash, zone: other.name.ar });
    }
    if (z) {
      checkVersion(z, b.expectedVersion);
      Object.assign(z, { name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, areas, fee: m4(b.fee), minOrder: m4(b.minOrder), etaMinutes: eta, active, color: b.color ?? z.color, map: b.map ?? z.map });
      z.version++;
    } else {
      const n = zonesOf(db).length;
      z = { id: ctx.params.zoneId === 'new' ? nextId('zone') : ctx.params.zoneId, branchId: ctx.branchId ?? 'branch_main', name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, areas, fee: m4(b.fee), minOrder: m4(b.minOrder), etaMinutes: eta, active, color: b.color ?? ['#f472b6', '#60a5fa', '#facc15', '#4ade80'][n % 4], map: b.map ?? { x: 40 + (n % 3) * 4, y: 62 - (n % 3) * 3, w: 14, h: 8 }, version: 1 };
      zonesOf(db).push(z);
    }
    // addresses re-resolve to zones (an area moved between zones follows it)
    for (const c of custs(db)) for (const a of c.addresses) { const zz = zoneForArea(db, a.area); a.zoneId = zz && zz.active ? zz.id : zz?.id ?? null; }
    ctx.audit(`delivery zone ${z.name.en} saved (fee ${z.fee}, min ${z.minOrder})`, z.id);
    return z;
  },

  // ───────── drivers
  'Driver.List': (ctx) => {
    // ux-11: ?status=INACTIVE lists the deactivated riders (they no longer vanish); a rider sees only himself
    const scope = riderScope(ctx);
    const inactive = ctx.query.status === 'INACTIVE';
    const inBranch = driversOf(ctx.db).filter((d) => (!ctx.branchId || d.branchId === ctx.branchId) && (!scope || d.id === scope.driver?.id));
    const list = inBranch.filter((d) => (inactive ? !d.active : d.active)).map((d) => driverView(ctx.db, d, ctx.now));
    const totalCash = list.reduce((a, d) => a.plus(D(d.cashInHand)), D(0));
    const recentSettlements = scope ? [] : settlementsOf(ctx.db).slice(0, 20).map((x) => ({ ...x, driverName: driversOf(ctx.db).find((d) => d.id === x.driverId)?.name ?? x.driverId, byName: userName(ctx.db, x.by) }));
    return { ...page(list, ctx.query), recentSettlements, inactiveCount: inBranch.filter((d) => !d.active).length, summary: { onShift: list.filter((d) => d.onShift).length, available: list.filter((d) => d.status === 'AVAILABLE').length, onTrip: list.filter((d) => d.status === 'ON_TRIP').length, cashInHand: m4(totalCash), owed: m4(list.reduce((a, d) => a.plus(D(d.owed)), D(0))) }, rules: rules(ctx.branchId), payRules: payRules(ctx.branchId), restaurant: RESTAURANT_XY };
  },
  // ux-11: the rider file — today, shifts, trips, settlements and the account (owed ledger, payouts, pay earned)
  'Driver.Get': (ctx) => {
    const db = ctx.db;
    const drv = getDriver(ctx, ctx.params.driverId, { inactive: true });
    const view = driverView(db, drv, ctx.now);
    const today = ctx.businessDate(drv.branchId);
    const mine = deliveriesOf(db).filter((d) => d.driverId === drv.id || d.attempts.some((a) => a.driverId === drv.id));
    const br = db.branches.find((b) => b.id === drv.branchId);
    const dayOf = (iso?: string | null) => (iso ? businessDate(Date.parse(iso), br?.timezone ?? 'Africa/Cairo', br?.businessDayCutoff ?? '04:00') === today : false);
    const todays = mine.filter((d) => (d.driverId === drv.id && ON_ROAD.includes(d.state)) || dayOf(d.deliveredAt) || dayOf(d.assignedAt) || d.attempts.some((a) => a.driverId === drv.id && dayOf(a.at)))
      .sort((a, b) => b.createdAtMs - a.createdAtMs).map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, state: d.driverId === drv.id ? d.state : 'FAILED', customerName: d.customerName, zoneName: d.zoneName, amount: d.amount, toCollect: d.driverId === drv.id && ON_ROAD.includes(d.state) ? codDue(db, d) : '0.0000', cod: d.driverId === drv.id ? d.cod : null, deliveredAt: d.deliveredAt ?? null, failedHere: d.attempts.some((a) => a.driverId === drv.id) }));
    const delivered = mine.filter((d) => d.driverId === drv.id && d.state === 'DELIVERED');
    const failedAttempts = mine.reduce((n, d) => n + d.attempts.filter((a) => a.driverId === drv.id).length, 0);
    const durations = delivered.filter((d) => d.pickedUpAt && d.deliveredAt).map((d) => Math.max(0, Math.round((Date.parse(d.deliveredAt!) - Date.parse(d.pickedUpAt!)) / 60000)));
    const lateCount = delivered.filter((d) => d.deliveredAt && Date.parse(d.deliveredAt) > d.promisedAtMs + rules(d.branchId).graceMinutes * 60_000).length;
    const paidTrips = new Set(payoutsOf(db).filter((p) => p.driverId === drv.id).flatMap((p) => p.tripIds));
    const shifts = shiftsOf(db).filter((s) => s.driverId === drv.id).sort((a, b) => b.startedAtMs - a.startedAtMs);
    return {
      ...view, active: drv.active,
      today: todays,
      shifts: shifts.slice(0, 40).map((s) => shiftView(db, s, ctx.now)),
      shiftTotals: { count: shifts.length, minutes: shifts.reduce((a, s) => a + (s.minutes ?? Math.max(0, Math.floor((ctx.now - s.startedAtMs) / 60000))), 0) },
      trips: {
        delivered: delivered.length, failed: failedAttempts, late: lateCount, avgMinutes: durations.length ? Math.round(durations.reduce((a, x) => a + x, 0) / durations.length) : null,
        list: delivered.sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? '')).slice(0, 60).map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, zoneName: d.zoneName, customerName: d.customerName, amount: d.amount, fee: d.fee, pickedUpAt: d.pickedUpAt ?? null, deliveredAt: d.deliveredAt, minutes: d.pickedUpAt && d.deliveredAt ? Math.max(0, Math.round((Date.parse(d.deliveredAt) - Date.parse(d.pickedUpAt)) / 60000)) : null, late: !!d.deliveredAt && Date.parse(d.deliveredAt) > d.promisedAtMs + rules(d.branchId).graceMinutes * 60_000, attempts: d.attempts.length, paid: paidTrips.has(d.id) })),
      },
      settlements: settlementsOf(db).filter((x) => x.driverId === drv.id).map((x) => ({ ...x, byName: userName(db, x.by) })),
      account: {
        owed: m4(drv.owed),
        ledger: owedEntriesOf(db).filter((e) => e.driverId === drv.id).map((e) => ({ ...e, byName: userName(db, e.by), approverName: e.approvalGrantId ? userName(db, db.grants.find((g) => g.id === e.approvalGrantId)?.approverUserId) : null })),
        payouts: payoutsOf(db).filter((p) => p.driverId === drv.id).map((p) => ({ ...p, byName: userName(db, p.by), trips: p.tripIds.length })),
        preview: payoutPreview(db, drv, ctx.now),
        payRules: payRules(drv.branchId),
      },
    };
  },
  'DriverShift.Start': (ctx) => {
    const drv = getDriver(ctx, ctx.params.driverId);
    checkVersion(drv, ctx.body.expectedVersion);
    const sh = startShift(ctx, drv);
    drv.version++;
    ctx.audit(`driver ${drv.name} started a shift`, drv.id);
    event('DriverShiftStarted', drv.id, drv.name);
    return { status: 201, body: { shift: shiftView(ctx.db, sh, ctx.now), driver: driverView(ctx.db, drv, ctx.now) } };
  },
  'DriverShift.End': (ctx) => {
    const drv = getDriver(ctx, ctx.params.driverId);
    checkVersion(drv, ctx.body.expectedVersion);
    const sh = endShift(ctx, drv);
    drv.version++;
    ctx.audit(`driver ${drv.name} ended a shift (${sh?.minutes ?? 0} min)`, drv.id);
    event('DriverShiftEnded', drv.id, `${drv.name} ${sh?.minutes ?? 0} min`);
    return { shift: sh ? shiftView(ctx.db, sh, ctx.now) : null, driver: driverView(ctx.db, drv, ctx.now) };
  },
  'DriverShift.Find': (ctx) => {
    const scope = riderScope(ctx);
    const q = ctx.query;
    let list = shiftsOf(ctx.db).filter((s) => (!ctx.branchId || s.branchId === ctx.branchId) && (!scope || s.driverId === scope.driver?.id));
    if (q.driverId) list = list.filter((s) => s.driverId === q.driverId);
    if (q.open === 'true') list = list.filter((s) => !s.endedAt);
    if (q.from) list = list.filter((s) => s.startedAt >= q.from);
    if (q.to) list = list.filter((s) => s.startedAt <= q.to);
    return page([...list].sort((a, b) => b.startedAtMs - a.startedAtMs).map((s) => shiftView(ctx.db, s, ctx.now)), q);
  },
  // ux-11 owner decision 2: an old shortage is collected in cash (drawer PAY_IN), moved to the next payout, or waived —
  // always with a manager's approval (DRIVER_OWED_SETTLE); DEDUCT_PAYOUT and WAIVE need a reason. CAS on the rider.
  'Driver.SettleOwed': (ctx) => {
    const db = ctx.db;
    const drv = getDriver(ctx, ctx.params.driverId, { inactive: true });
    checkVersion(drv, ctx.body.expectedVersion);
    const mode = String(ctx.body.mode ?? '') as DriverOwedKind;
    if (!['COLLECT_CASH', 'DEDUCT_PAYOUT', 'WAIVE'].includes(mode)) throw new ApiError('VALIDATION_FAILED', { field: 'mode', allowed: ['COLLECT_CASH', 'DEDUCT_PAYOUT', 'WAIVE'] });
    need(isMoney(ctx.body.amount) && D(ctx.body.amount).gt(0), 'VALIDATION_FAILED', { field: 'amount', rule: 'positive amount' });
    const amount = m4(ctx.body.amount);
    const owed = m4(drv.owed);
    if (D(amount).gt(D(owed))) throw new ApiError('DRIVER_OWED_OVER_SETTLE', { owed, amount }, 409);
    const reason = String(ctx.body.reason ?? '').trim();
    if (mode !== 'COLLECT_CASH' && reason.length < 3) throw new ApiError('REASON_REQUIRED', { mode });
    need(reason.length <= 200, 'VALIDATION_FAILED', { field: 'reason', rule: 'at most 200 characters' });
    let sessionId: string | null = null;
    if (mode === 'COLLECT_CASH') {
      const s = openSessionOn(db, ctx.terminal?.id);
      if (!s) throw new ApiError('SESSION_NOT_OPEN', { reason: 'the rider pays into a terminal with an open drawer' });
      sessionId = s.id;
    }
    if (mode === 'DEDUCT_PAYOUT') {
      const pv = payoutPreview(db, drv, ctx.now);
      const available = m4(D(pv.gross).minus(D(pv.deductions)));
      if (D(amount).gt(D(available))) throw new ApiError('DRIVER_PAYOUT_INSUFFICIENT', { amount, available, earned: pv.gross, alreadyDeducted: pv.deductions }, 409);
    }
    const g = ctx.requireApproval({ action: 'DRIVER_OWED_SETTLE', targetType: 'delivery.Driver', targetId: drv.id, context: { driverId: drv.id, mode, amount, owedBefore: owed }, grantId: ctx.body.approvalGrantId });
    const e = pushOwed(ctx, drv, mode, amount, { reason: reason || null, approvalGrantId: g?.id ?? null, sessionId });
    if (mode === 'COLLECT_CASH') drawerEntry(ctx, sessionId!, 'PAY_IN', amount, { reasonCode: 'DRIVER_OWED_COLLECT', reason: `تحصيل عجز الطيار ${drv.name}`, ref: e.id, approvalGrantId: g?.id });
    drv.version++;
    ctx.audit(`driver ${drv.name} owed ${mode} ${amount} (owed ${owed} → ${e.owedAfter})${reason ? `: ${reason}` : ''}`, drv.id, true, g?.id);
    event('DriverOwedSettled', drv.id, `${drv.name} ${mode} ${amount}`);
    return { status: 201, body: { entry: e, driver: driverView(db, drv, ctx.now) } };
  },
  // ux-11: pay a rider out of this drawer (PAY_OUT) for a defined period; the payout is immutable
  'Driver.Payout': (ctx) => {
    const db = ctx.db;
    const drv = getDriver(ctx, ctx.params.driverId, { inactive: true });
    checkVersion(drv, ctx.body.expectedVersion);
    const periodTo = String(ctx.body.periodTo ?? '');
    const toMs = Date.parse(periodTo);
    need(periodTo && Number.isFinite(toMs), 'VALIDATION_FAILED', { field: 'periodTo', rule: 'required ISO time (the end of the period shown on the screen)' });
    if (toMs > ctx.now) throw new ApiError('VALIDATION_FAILED', { field: 'periodTo', rule: 'not in the future' });
    const last = payoutsOf(db).filter((p) => p.driverId === drv.id).sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
    if (last && toMs <= Date.parse(last.periodTo)) throw new ApiError('VALIDATION_FAILED', { field: 'periodTo', rule: 'after the last payout', lastPeriodTo: last.periodTo });
    const pv = payoutPreview(db, drv, toMs);
    if (!pv.trips.length && !pv.allShiftIds.length && !pv.deductionIds.length) throw new ApiError('DRIVER_NOTHING_TO_PAY', { driverId: drv.id }, 409);
    if (D(pv.net).lt(0)) throw new ApiError('DRIVER_PAYOUT_INSUFFICIENT', { gross: pv.gross, deductions: pv.deductions }, 409);
    const session = D(pv.net).gt(0) ? openSessionOn(db, ctx.terminal?.id) : null;
    if (D(pv.net).gt(0) && !session) throw new ApiError('SESSION_NOT_OPEN', { reason: 'the rider is paid out of a terminal with an open drawer' });
    const g = ctx.requireApproval({ action: 'DRIVER_PAYOUT', targetType: 'delivery.Driver', targetId: drv.id, context: { driverId: drv.id, periodTo: pv.periodTo, gross: pv.gross, deductions: pv.deductions, net: pv.net }, grantId: ctx.body.approvalGrantId });
    db.seq['driver_payout_no'] = (db.seq['driver_payout_no'] ?? 0) + 1;
    const note = String(ctx.body.note ?? '').trim().slice(0, 200) || null;
    const po: DriverPayout = {
      id: nextId('dpo'), number: `DP-${String(db.seq['driver_payout_no']).padStart(4, '0')}`, driverId: drv.id, branchId: drv.branchId, periodFrom: pv.periodFrom, periodTo: pv.periodTo,
      mode: pv.mode, rate: pv.rate, tripIds: pv.mode === 'FIXED_SHIFT' ? [] : pv.trips.map((t) => t.id), shiftIds: pv.mode === 'FIXED_SHIFT' ? pv.allShiftIds : [],
      gross: pv.gross, deductions: pv.deductions, deductionIds: pv.deductionIds, net: pv.net, sessionId: session?.id ?? null, terminalId: ctx.terminal?.id ?? null, at: ctx.nowIso, by: ctx.user!.id, approvalGrantId: g?.id ?? null, note,
    };
    payoutsOf(db).unshift(po);
    if (session) drawerEntry(ctx, session.id, 'PAY_OUT', po.net, { reasonCode: 'DRIVER_PAYOUT', reason: `مستحقات الطيار ${drv.name} (${po.number})`, ref: po.number, approvalGrantId: g?.id });
    drv.version++;
    ctx.audit(`driver ${drv.name} paid ${po.net} (${po.number}: ${pv.trips.length} trips, gross ${po.gross}, deductions ${po.deductions})`, drv.id, true, g?.id);
    event('DriverPaidOut', drv.id, `${drv.name} ${po.number} ${po.net}`);
    return { status: 201, body: { payout: po, driver: driverView(db, drv, ctx.now) } };
  },
  'DriverPayout.Find': (ctx) => {
    const scope = riderScope(ctx);
    let list = payoutsOf(ctx.db).filter((p) => (!ctx.branchId || p.branchId === ctx.branchId) && (!scope || p.driverId === scope.driver?.id));
    if (ctx.query.driverId) list = list.filter((p) => p.driverId === ctx.query.driverId);
    return page(list.map((p) => ({ ...p, driverName: driversOf(ctx.db).find((d) => d.id === p.driverId)?.name ?? p.driverId, byName: userName(ctx.db, p.by), trips: p.tripIds.length })), ctx.query);
  },
  'Driver.Upsert': (ctx) => {
    const db = ctx.db;
    const b = ctx.body;
    let drv = driversOf(db).find((x) => x.id === ctx.params.driverId);
    let what = 'saved';
    if (drv) {
      if (ctx.branchId && drv.branchId !== ctx.branchId) throw new ApiError('DRIVER_NOT_FOUND', { driverId: drv.id });
      checkVersion(drv, b.expectedVersion);
      // ux-11: reactivating a deactivated rider (the record and its history were kept)
      if (b.active === true && !drv.active) {
        drv.active = true; drv.deactivatedAt = null; drv.deactivatedBy = null; drv.deactivationReason = null;
        drv.version++;
        ctx.audit(`driver ${drv.name} reactivated`, drv.id);
        return driverView(db, drv, ctx.now);
      }
      if (!drv.active) throw new ApiError('DRIVER_NOT_FOUND', { driverId: drv.id, reason: 'deactivated — reactivate first' });
      if (b.name !== undefined) { need(String(b.name).trim(), 'VALIDATION_FAILED', { field: 'name' }); drv.name = String(b.name).trim(); }
      if (b.phone !== undefined) { const p = normPhone(b.phone); if (!PHONE_RE.test(p)) throw new ApiError('CUSTOMER_PHONE_INVALID', { field: 'phone' }); drv.phone = p; }
      if (b.vehicle) drv.vehicle = b.vehicle;
      if (b.plate !== undefined) drv.plate = b.plate || null;
      if (b.userId !== undefined) {
        const uid = b.userId ? String(b.userId) : null;
        if (uid && !db.users.some((u) => u.id === uid)) throw new ApiError('VALIDATION_FAILED', { field: 'userId', rule: 'unknown user' });
        if (uid && driversOf(db).some((x) => x.userId === uid && x.id !== drv!.id)) throw new ApiError('VALIDATION_FAILED', { field: 'userId', rule: 'the user is linked to another rider' });
        drv.userId = uid;
      }
      // ux-11: shift changes go through the shift log (hours recorded; ending keeps the orders / cash rule)
      if (b.onShift === true && !drv.onShift) { startShift(ctx, drv); what = 'shift started'; }
      if (b.onShift === false && drv.onShift) { const sh = endShift(ctx, drv); what = `shift ended (${sh?.minutes ?? 0} min)`; }
      if (b.active === false) {
        // ux-11: deactivation keeps the record (it is listed under «المتوقفون» and can be reactivated); a reason is required
        if (deliveriesOf(db).some((x) => x.driverId === drv!.id && ON_ROAD.includes(x.state))) throw new ApiError('DRIVER_HAS_ACTIVE_DELIVERIES');
        if (D(driverCash(db, drv.id).amount).gt(0)) throw new ApiError('DRIVER_CASH_NOT_SETTLED', { cashInHand: driverCash(db, drv.id).amount });
        const reason = String(b.reason ?? '').trim();
        if (reason.length < 3) throw new ApiError('REASON_REQUIRED', { field: 'reason' });
        if (drv.onShift) endShift(ctx, drv);
        drv.active = false; drv.deactivatedAt = ctx.nowIso; drv.deactivatedBy = ctx.user!.id; drv.deactivationReason = reason.slice(0, 200);
        what = `deactivated: ${drv.deactivationReason}`;
      }
      drv.version++;
    } else {
      requireFields(ctx, 'name', 'phone');
      const p = normPhone(b.phone);
      if (!PHONE_RE.test(p)) throw new ApiError('CUSTOMER_PHONE_INVALID', { field: 'phone' });
      drv = { id: ctx.params.driverId === 'new' ? nextId('drv') : ctx.params.driverId, branchId: ctx.branchId ?? 'branch_main', name: String(b.name).trim(), phone: p, vehicle: b.vehicle ?? 'MOTORCYCLE', plate: b.plate ?? null, onShift: false, active: true, location: null, version: 1, createdAt: ctx.nowIso, owed: '0.0000', userId: null };
      driversOf(db).push(drv);
      if (b.onShift) startShift(ctx, drv);
    }
    ctx.audit(`driver ${drv.name} ${what} (onShift ${drv.onShift})`, drv.id);
    return driverView(db, drv, ctx.now);
  },
  'Driver.UpdateLocation': (ctx) => {
    const drv = getDriver(ctx, ctx.params.driverId);
    const x = Number(ctx.body.x), y = Number(ctx.body.y);
    need(Number.isFinite(x) && Number.isFinite(y), 'VALIDATION_FAILED', { field: 'x,y' });
    drv.location = { x: Math.max(0, Math.min(100, Math.round(x * 10) / 10)), y: Math.max(0, Math.min(70, Math.round(y * 10) / 10)), at: ctx.nowIso };
    return driverView(ctx.db, drv, ctx.now);
  },
  // POST /drivers/{driverId}/settlements {countedCash, deliveryIds?}: the cash the driver collected goes into this drawer.
  'Driver.SettleCash': (ctx) => {
    const db = ctx.db;
    const drv = getDriver(ctx, ctx.params.driverId);
    const ids: string[] | null = Array.isArray(ctx.body.deliveryIds) && ctx.body.deliveryIds.length ? ctx.body.deliveryIds : null;
    const pending = driverCash(db, drv.id).deliveries.filter((d) => !ids || ids.includes(d.id));
    if (!pending.length) throw new ApiError('DRIVER_NOTHING_TO_SETTLE', { driverId: drv.id });
    need(isMoney(ctx.body.countedCash) && D(ctx.body.countedCash).gte(0), 'VALIDATION_FAILED', { field: 'countedCash' });
    const session = openSessionOn(db, ctx.terminal?.id);
    if (!session) throw new ApiError('SESSION_NOT_OPEN', { reason: 'driver cash is settled into a terminal with an open drawer' });
    const expected = m4(pending.reduce((a, d) => a.plus(D(d.cod!.amount)), D(0)));
    const counted = m4(ctx.body.countedCash);
    const variance = sub(counted, expected);
    const g = ctx.requireApproval({ action: 'DRIVER_CASH_VARIANCE', targetType: 'delivery.Driver', targetId: drv.id, context: { driverId: drv.id, expected, counted, absVariance: m4(D(variance).abs()) }, grantId: ctx.body.approvalGrantId });
    const settlement: DriverSettlement = { id: nextId('dset'), driverId: drv.id, branchId: drv.branchId, sessionId: session.id, terminalId: ctx.terminal!.id, at: ctx.nowIso, by: ctx.user!.id, deliveryIds: pending.map((d) => d.id), expected, counted, variance, approvalGrantId: g?.id ?? null, reason: ctx.body.reason ?? null };
    const completed: string[] = [];
    for (const d of pending) {
      const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) : null;
      if (o && o.status === 'CONFIRMED') {
        const remaining = settlementOf(db, o).remaining;
        const amt = D(d.cod!.amount).lt(D(remaining)) ? d.cod!.amount : remaining;
        if (D(amt).gt(0)) {
          const c = pushCapture(ctx, o, session.id, 'CASH', amt, `${settlement.id}`, null);
          drawerEntry(ctx, session.id, 'TENDER_IN', c.amount, { ref: `${o.number} · ${drv.name}` });
          o.version++;
          o.history.push(hist(ctx.user!.id, 'CAPTURED', { ar: `سلّم الطيار ${drv.name} ${m4(amt)} ج.م نقدًا في الدرج (تسوية ${settlement.id})`, en: `driver cash ${amt} settled` }, null, ctx.terminal?.code));
        }
        if (tryComplete(ctx, o)) completed.push(o.number);
      }
      d.cod!.settled = true;
      d.cod!.settlementId = settlement.id;
      step(ctx, d, 'CASH_SETTLED', { ar: `سُلّمت نقدية الطلب للكاشير (${m4(d.cod!.amount)} ج.م)`, en: `cash settled ${d.cod!.amount}` });
    }
    if (D(variance).lt(0)) {
      drawerEntry(ctx, session.id, 'PAY_OUT', D(variance).abs().toString(), { reasonCode: 'DRIVER_SHORTAGE', reason: `عجز الطيار ${drv.name}`, ref: settlement.id, approvalGrantId: g?.id });
      pushOwed(ctx, drv, 'SHORTAGE', m4(D(variance).abs()), { reason: ctx.body.reason ? String(ctx.body.reason) : null, approvalGrantId: g?.id ?? null, sessionId: session.id, settlementId: settlement.id }); // ux-11: the owed ledger
    } else if (D(variance).gt(0)) {
      drawerEntry(ctx, session.id, 'PAY_IN', variance, { reasonCode: 'DRIVER_OVERAGE', reason: `زيادة مع الطيار ${drv.name}`, ref: settlement.id, approvalGrantId: g?.id });
    }
    drv.version++;
    settlementsOf(db).unshift(settlement);
    ctx.audit(`driver ${drv.name} settled: expected ${expected} counted ${counted} variance ${variance}`, drv.id, true, g?.id);
    event('DriverCashSettled', drv.id, `${drv.name} ${counted} (${variance})`);
    return { status: 201, body: { settlement, completedOrders: completed, driver: driverView(db, drv, ctx.now) } };
  },

  // ───────── deliveries
  'Delivery.Create': (ctx) => {
    const db = ctx.db;
    requireFields(ctx, 'orderId', 'address');
    const o = getOrder(ctx, ctx.body.orderId);
    if (o.channel !== 'DELIVERY') throw new ApiError('DELIVERY_ORDER_NOT_DELIVERY_CHANNEL', { channel: o.channel });
    if (o.status !== 'DRAFT') throw new ApiError('DELIVERY_ORDER_NOT_EDITABLE', { status: o.status });
    if (deliveriesOf(db).some((d) => d.orderId === o.id && d.state !== 'CANCELLED')) throw new ApiError('DELIVERY_ALREADY_EXISTS', { orderId: o.id });
    const a = ctx.body.address;
    if (!a?.area || !String(a.area).trim()) throw new ApiError('VALIDATION_FAILED', { field: 'address.area', rule: 'required' });
    if (!a?.street || !String(a.street).trim()) throw new ApiError('VALIDATION_FAILED', { field: 'address.street', rule: 'required' });
    const zone = ctx.body.zoneId ? zonesOf(db).find((z) => z.id === ctx.body.zoneId) : zoneForArea(db, a.area);
    if (!zone) throw new ApiError('DELIVERY_AREA_NOT_COVERED', { area: a.area });
    if (!zone.active) throw new ApiError('DELIVERY_ZONE_INACTIVE', { zone: zone.name.ar });
    if (!activeLines(o).length) throw new ApiError('ORDER_EMPTY');
    const live = computeLiveTotals(o);
    const netItems = D(live.itemsSubtotal).minus(D(live.itemDiscount));
    if (!ctx.body.skipMinimum && netItems.lt(D(zone.minOrder))) throw new ApiError('DELIVERY_MINIMUM_NOT_MET', { minOrder: zone.minOrder, current: m4(netItems), zone: zone.name.ar, missing: m4(D(zone.minOrder).minus(netItems)) });
    const r = rules(o.branchId);
    // delivery fee as a charge on the check (captured with the order); packaging follows when the rule says so
    o.policy.charges = o.policy.charges.filter((c) => c.id !== 'DELIVERY_FEE');
    if (D(zone.fee).gt(0)) o.policy.charges.push({ id: 'DELIVERY_FEE', label: { ar: `رسوم التوصيل (${zone.name.ar})`, en: `Delivery fee (${zone.name.en})` }, basis: 'PER_CHECK', amount: zone.fee, channels: ['DELIVERY'], taxable: r.feeTaxable, fiscalCode: null });
    if (r.packagingOnDelivery) for (const c of o.policy.charges) if (c.id === 'PACKAGING' && !c.channels.includes('DELIVERY')) c.channels = [...c.channels, 'DELIVERY'];
    // customer snapshot
    if (ctx.body.customerId && ctx.body.customerId !== o.customerId) setOrderCustomer(ctx, o, ctx.body.customerId);
    const cust = o.customerId ? custs(db).find((c) => c.id === o.customerId) : null;
    const prep = ctx.body.prepMinutes ? Number(ctx.body.prepMinutes) : null;
    const promiseMin = prep ? prep + Math.max(10, zone.etaMinutes - 20) : zone.etaMinutes;
    db.seq['delivery_no'] = (db.seq['delivery_no'] ?? 0) + 1;
    const mode = (['CASH_ON_DELIVERY', 'PAID_ONLINE', 'CARD_ON_DELIVERY'].includes(ctx.body.paymentMode) ? ctx.body.paymentMode : 'CASH_ON_DELIVERY') as Delivery['paymentMode'];
    const d: Delivery = {
      id: nextId('dlv'), branchId: o.branchId, number: `D-${String(db.seq['delivery_no']).padStart(4, '0')}`, orderId: o.id, orderNumber: o.number,
      customerId: cust?.id ?? null, customerName: cust?.name ?? String(ctx.body.customerName ?? o.customerName ?? ''), phone: cust?.phone ?? normPhone(ctx.body.phone ?? o.customerPhone ?? ''),
      address: { area: String(a.area).trim(), street: String(a.street).trim(), building: a.building || undefined, floor: a.floor || undefined, apartment: a.apartment || undefined, landmark: a.landmark || undefined, notes: a.notes || undefined, zoneId: zone.id },
      zoneId: zone.id, zoneName: zone.name.ar, fee: zone.fee, amount: computeLiveTotals(o).payable, state: 'PENDING', driverId: null, paymentMode: mode,
      source: ctx.body.source === 'ONLINE' ? 'ONLINE' : 'CALL_CENTER', sourceLabel: ctx.body.sourceLabel ?? null, externalOrderId: ctx.body.externalOrderId ?? null, note: ctx.body.note ?? null,
      createdAt: ctx.nowIso, createdAtMs: ctx.now, promisedAt: new Date(ctx.now + promiseMin * 60_000).toISOString(), promisedAtMs: ctx.now + promiseMin * 60_000,
      attempts: [], cancel: null, cod: null, collected: null, timeline: [], version: 1,
    };
    d.timeline.push(hist(ctx.user!.id, 'CREATED', { ar: `طلب توصيل لـ ${zone.name.ar} — الوصول المتوقع خلال ${promiseMin} دقيقة`, en: `delivery to ${zone.name.en}, promised in ${promiseMin} min` }, null, ctx.terminal?.code));
    deliveriesOf(db).push(d);
    o.deliveryId = d.id;
    o.version++;
    o.history.push(hist(ctx.user!.id, 'DELIVERY', { ar: `توصيل ${d.number} لـ ${d.address.area} — رسوم ${m4(zone.fee)}`, en: `delivery ${d.number} fee ${zone.fee}` }, null, ctx.terminal?.code));
    ctx.audit(`delivery ${d.number} for ${o.number}`, d.id);
    event('DeliveryCreated', d.id, `${d.number} ${o.number} → ${zone.name.en}`);
    return { status: 201, body: deliveryView(db, d, ctx.now, true) };
  },
  'Delivery.Get': (ctx) => deliveryView(ctx.db, getDelivery(ctx, ctx.params.deliveryId), ctx.now, true),
  'Delivery.Board': (ctx) => {
    const db = ctx.db;
    const q = ctx.query;
    const today = ctx.businessDate();
    // ux-11: a rider's board holds his own deliveries only (enforced here, not in the UI)
    let list = deliveriesOf(db).filter((d) => (!ctx.branchId || d.branchId === ctx.branchId) && ownDelivery(ctx, d));
    const scope = q.scope ?? 'active';
    if (scope === 'active') list = list.filter((d) => ACTIVE.includes(d.state) || (!d.historical && ctx.businessDate() === today && (d.deliveredAt ?? d.cancelledAt ?? d.createdAt) >= new Date(ctx.now - 12 * 3600_000).toISOString()));
    if (q.state) list = list.filter((d) => q.state.split(',').includes(d.state));
    if (q.driverId) list = list.filter((d) => d.driverId === q.driverId);
    if (q.customerId) list = list.filter((d) => d.customerId === q.customerId);
    const views = [...list].sort((a, b) => b.createdAtMs - a.createdAtMs).map((d) => deliveryView(db, d, ctx.now));
    const summary = {
      pending: views.filter((v) => v.state === 'PENDING').length, onRoad: views.filter((v) => ON_ROAD.includes(v.state)).length, failed: views.filter((v) => v.state === 'FAILED').length, returned: views.filter((v) => v.state === 'RETURNED').length,
      late: views.filter((v) => v.late).length, delivered: views.filter((v) => v.state === 'DELIVERED').length, readyWaiting: views.filter((v) => v.readyWaiting).length,
    };
    return { ...page(views, q), summary, rules: rules(ctx.branchId), reasons: REASONS };
  },
  'Delivery.Assign': (ctx) => {
    const d = getDelivery(ctx, ctx.params.deliveryId);
    requireFields(ctx, 'driverId');
    checkVersion(d, ctx.body.expectedVersion);
    if (!ASSIGNABLE.includes(d.state)) invalid(d, 'ASSIGNED');
    const drv = getDriver(ctx, ctx.body.driverId);
    if (d.state === 'ASSIGNED' && d.driverId === drv.id) invalid(d, 'ASSIGNED', { reason: 'same driver' });
    const over = assignDriver(ctx, d, drv);
    return { ...deliveryView(ctx.db, d, ctx.now, true), cashLimit: over };
  },
  // ux-11: who to send — riders on shift with room, ranked: heading to the same zone, then the least load, then free the
  // longest; a rider who would go over the cash limit comes after the others (the server still decides on assign).
  'Delivery.SuggestRider': (ctx) => {
    const db = ctx.db;
    const d = getDelivery(ctx, ctx.params.deliveryId);
    const r = rules(d.branchId);
    const due = codDue(db, d);
    const ranked = driversOf(db).filter((x) => x.active && x.onShift && x.branchId === d.branchId && x.id !== d.driverId).map((x) => {
      const onRoad = deliveriesOf(db).filter((y) => y.driverId === x.id && y.id !== d.id && ON_ROAD.includes(y.state));
      const exposure = m4(D(cashExposure(db, x.id, d.id)).plus(D(due)));
      return { driverId: x.id, name: x.name, vehicle: x.vehicle, load: onRoad.length, sameZone: !!d.zoneId && onRoad.some((y) => y.zoneId === d.zoneId), availableSince: availableSince(db, x, ctx.now), exposure, overLimit: D(exposure).gt(D(r.driverCashLimit)), full: onRoad.length >= r.maxActivePerDriver };
    }).filter((x) => !x.full).sort((a, b) => Number(a.overLimit) - Number(b.overLimit) || Number(b.sameZone) - Number(a.sameZone) || a.load - b.load || (a.availableSince ?? '').localeCompare(b.availableSince ?? ''));
    return { deliveryId: d.id, suggested: ranked[0]?.driverId ?? null, ranked, limit: m4(r.driverCashLimit), cashLimitMode: r.cashLimitMode, maxActivePerDriver: r.maxActivePerDriver };
  },
  // ux-11 owner decision 4: after a failed attempt the food came back — staff receive it (FAILED → RETURNED); it can be
  // dispatched again (Assign / Dispatch) or cancelled through Delivery.Cancel (approval, void / waste as before).
  'Delivery.Return': (ctx) => {
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    if (d.state !== 'FAILED') invalid(d, 'RETURNED');
    const note = String(ctx.body.note ?? '').trim().slice(0, 200) || null;
    d.state = 'RETURNED';
    d.returnedAt = ctx.nowIso;
    (d.returned ??= []).push({ at: ctx.nowIso, by: ctx.user!.id, note });
    step(ctx, d, 'RETURNED', { ar: `رجع الطلب إلى المطعم واستُلم${note ? ` — ${note}` : ''}`, en: `back at the restaurant${note ? `: ${note}` : ''}` });
    ctx.audit(`delivery ${d.number} returned to the restaurant${note ? `: ${note}` : ''}`, d.id);
    event('DeliveryReturned', d.id, d.number);
    return deliveryView(ctx.db, d, ctx.now, true);
  },
  'Delivery.Dispatch': (ctx) => {
    const db = ctx.db;
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    const to = ctx.body.toState ?? 'PICKED_UP';
    if (to !== 'PICKED_UP') invalid(d, to);
    // ux-11: a rider dispatches only what is already assigned to him (getDelivery) and never picks another rider
    if (ctx.body.driverId && riderScope(ctx) && ctx.body.driverId !== d.driverId) throw new ApiError('DELIVERY_NOT_FOUND', { deliveryId: d.id });
    if (ctx.body.driverId && (d.state === 'PENDING' || d.state === 'FAILED' || d.state === 'RETURNED' || (d.state === 'ASSIGNED' && d.driverId !== ctx.body.driverId))) assignDriver(ctx, d, getDriver(ctx, ctx.body.driverId));
    if (d.state !== 'ASSIGNED') invalid(d, 'PICKED_UP');
    const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) : null;
    if (o && o.status === 'DRAFT') invalid(d, 'PICKED_UP', { reason: 'the order was not sent to the kitchen yet' });
    if (o && (o.status === 'CANCELLED' || o.status === 'VOIDED')) invalid(d, 'PICKED_UP', { reason: 'order cancelled' });
    // food handed to the driver: ready tickets become handed over
    if (o) for (const t of db.tickets.filter((t) => t.orderId === o.id && t.state === 'READY')) { t.state = 'DONE'; t.doneAt = ctx.nowIso; t.version++; }
    const drv = driversOf(db).find((x) => x.id === d.driverId)!;
    d.state = 'PICKED_UP';
    d.pickedUpAt = ctx.nowIso;
    drv.location = { ...RESTAURANT_XY, at: ctx.nowIso };
    step(ctx, d, 'PICKED_UP', { ar: `خرج مع ${drv.name} — في الطريق`, en: `out for delivery with ${drv.name}` });
    event('DeliveryDispatched', d.id, `${d.number} with ${drv.name}`);
    return deliveryView(db, d, ctx.now, true);
  },
  'Delivery.Complete': (ctx) => {
    const db = ctx.db;
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    if (d.state !== 'PICKED_UP') invalid(d, 'DELIVERED');
    const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) ?? null : null;
    const drv = driversOf(db).find((x) => x.id === d.driverId);
    let collectedText = '';
    if (o && o.status === 'CONFIRMED') {
      const remaining = settlementOf(db, o).remaining;
      const method = ctx.body.collectedMethod ?? (d.paymentMode === 'CARD_ON_DELIVERY' ? 'CARD' : 'CASH');
      if (D(remaining).gt(0)) {
        if (method === 'CARD') {
          const ref = String(ctx.body.reference ?? '').trim();
          if (!ref) throw new ApiError('TENDER_REFERENCE_REQUIRED', { method: 'CARD', reason: 'reference from the driver\'s card machine' });
          const s = collectingSessionFor(ctx, o);
          const c = pushCapture(ctx, o, s.id, 'CARD', remaining, ref, null);
          o.version++;
          o.history.push(hist(ctx.user!.id, 'CAPTURED', { ar: `دُفع ببطاقة مع الطيار ${m4(remaining)} ج.م (${ref})`, en: `card on delivery ${remaining}` }, null, ctx.terminal?.code));
          d.collected = { method: 'CARD', amount: c.amount, reference: ref, captureId: c.id };
          collectedText = ` — دُفع ببطاقة ${m4(remaining)} ج.م`;
        } else {
          d.cod = { amount: m4(remaining), settled: false, settlementId: null };
          d.collected = { method: 'CASH', amount: m4(remaining), reference: null, captureId: null };
          collectedText = ` — الطيار استلم ${m4(remaining)} كاش (لسه هيسلّمها للكاشير)`;
        }
      }
      tryComplete(ctx, o);
    }
    d.state = 'DELIVERED';
    d.deliveredAt = ctx.nowIso;
    if (drv) drv.location = { ...zoneCenter(zonesOf(db).find((z) => z.id === d.zoneId)), at: ctx.nowIso };
    const late = ctx.now > d.promisedAtMs + rules(d.branchId).graceMinutes * 60_000;
    step(ctx, d, 'DELIVERED', { ar: `سُلّم للعميل${late ? ` (متأخر ${Math.floor((ctx.now - d.promisedAtMs) / 60000)} دقيقة)` : ''}${collectedText}`, en: `delivered${late ? ' (late)' : ''}` });
    event('DeliveryCompleted', d.id, `${d.number}`);
    return deliveryView(db, d, ctx.now, true);
  },
  'Delivery.FailAttempt': (ctx) => {
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    requireFields(ctx, 'reasonCode');
    if (!ON_ROAD.includes(d.state)) invalid(d, 'FAILED');
    const code = String(ctx.body.reasonCode);
    need(REASONS[code], 'VALIDATION_FAILED', { field: 'reasonCode', allowed: Object.keys(REASONS) });
    if (code === 'OTHER' && !String(ctx.body.reason ?? '').trim()) throw new ApiError('REASON_REQUIRED', { reasonCode: code });
    const drv = driversOf(ctx.db).find((x) => x.id === d.driverId);
    d.attempts.push({ at: ctx.nowIso, by: ctx.user!.id, reasonCode: code, reason: ctx.body.reason ?? null, driverId: d.driverId });
    d.state = 'FAILED';
    d.failedAt = ctx.nowIso;
    d.driverId = null;
    if (drv) drv.location = { ...RESTAURANT_XY, at: ctx.nowIso };
    step(ctx, d, 'FAILED', { ar: `محاولة ${d.attempts.length} فشلت: ${REASONS[code].ar}${ctx.body.reason ? ` — ${ctx.body.reason}` : ''}${drv ? ` (الطيار ${drv.name} رجع)` : ''}`, en: `attempt ${d.attempts.length} failed: ${REASONS[code].en}` });
    event('DeliveryFailed', d.id, `${d.number} ${code}`);
    return deliveryView(ctx.db, d, ctx.now, true);
  },
  'Delivery.Cancel': (ctx) => {
    const db = ctx.db;
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    requireFields(ctx, 'reason');
    if (!ACTIVE.includes(d.state)) invalid(d, 'CANCELLED');
    const reason = String(ctx.body.reason).trim();
    need(reason.length >= 3, 'VALIDATION_FAILED', { field: 'reason', rule: 'at least 3 characters' });
    const o = d.orderId ? db.orders.find((x) => x.id === d.orderId) ?? null : null;
    const foodFired = !!o && o.rounds.length > 0;
    const g = ctx.requireApproval({ action: 'DELIVERY_CANCEL', targetType: 'delivery.Delivery', targetId: d.id, context: { deliveryId: d.id, state: d.state, foodFired, amount: o ? computeTotals(o).payable : d.amount, reason }, grantId: ctx.body.approvalGrantId });
    let outcome = 'NO_ORDER';
    if (o) {
      const caps = db.captures.filter((c) => c.orderId === o.id);
      if (o.status === 'DRAFT') {
        o.status = 'CANCELLED'; o.cancelledAt = ctx.nowIso; o.endReason = { code: 'DELIVERY_CANCELLED', note: reason };
        o.version++; o.history.push(hist(ctx.user!.id, 'CANCELLED', { ar: `أُلغي الطلب مع إلغاء التوصيل: ${reason}`, en: `cancelled with delivery: ${reason}` }, null, ctx.terminal?.code));
        outcome = 'ORDER_CANCELLED';
      } else if (o.status === 'CONFIRMED' && !caps.length) {
        const started = db.tickets.some((t) => t.orderId === o.id && t.state !== 'NEW');
        for (const l of activeLines(o)) { l.status = 'VOIDED'; l.version++; l.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: 'DELIVERY_CANCELLED', reason, approvalGrantId: g?.id, disposition: started ? 'WASTE' : 'NOT_PREPARED', approverId: g?.approverUserId }; }
        for (const t of db.tickets.filter((t) => t.orderId === o.id)) { for (const it of t.items) it.status = 'CANCELLED'; t.version++; }
        o.status = 'VOIDED'; o.voidedAt = ctx.nowIso; o.endReason = { code: 'DELIVERY_CANCELLED', note: reason, approvalGrantId: g?.id };
        o.version++; o.history.push(hist(ctx.user!.id, 'VOIDED', { ar: `أُلغي الطلب مع إلغاء التوصيل (${started ? 'حُضّر الطعام — هالك' : 'لم يُحضَّر'}): ${reason}${g ? ` — بموافقة ${userName(db, g.approverUserId)}` : ''}`, en: `voided with delivery: ${reason}` }, null, ctx.terminal?.code));
        outcome = 'ORDER_VOIDED';
      } else if (caps.length && o.status === 'CONFIRMED') {
        outcome = 'REFUND_NEEDED';
        o.history.push(hist(ctx.user!.id, 'DELIVERY_CANCELLED', { ar: `أُلغي التوصيل والطلب مدفوع — يلزم مرتجع: ${reason}`, en: 'delivery cancelled on a paid order — refund needed' }, null, ctx.terminal?.code));
      } else outcome = 'ORDER_KEPT';
    }
    const drv = d.driverId ? driversOf(db).find((x) => x.id === d.driverId) : null;
    if (drv && d.state === 'PICKED_UP') drv.location = { ...RESTAURANT_XY, at: ctx.nowIso };
    d.state = 'CANCELLED';
    d.cancelledAt = ctx.nowIso;
    d.cancel = { at: ctx.nowIso, by: ctx.user!.id, reason, approvalGrantId: g?.id ?? null, orderOutcome: outcome };
    d.driverId = d.driverId ?? null;
    step(ctx, d, 'CANCELLED', { ar: `أُلغي التوصيل: ${reason}${outcome === 'REFUND_NEEDED' ? ' — الطلب مدفوع، أنشئ مرتجعًا' : outcome === 'ORDER_VOIDED' ? ' — أُلغي الطلب' : ''}`, en: `cancelled: ${reason} (${outcome})` });
    ctx.audit(`delivery ${d.number} cancelled (${outcome}): ${reason}`, d.id, true, g?.id);
    return deliveryView(db, d, ctx.now, true);
  },
};
