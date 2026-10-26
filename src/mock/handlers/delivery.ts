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
import type { DB, Order, Capture, CashEntry } from '../types';
import type { Delivery, DeliveryState, DeliveryZone, Driver, DriverSettlement } from '../types-crm';

export const zonesOf = (db: DB) => (db.deliveryZones ??= []);
export const driversOf = (db: DB) => (db.drivers ??= []);
export const deliveriesOf = (db: DB) => (db.deliveries ??= []);
const settlementsOf = (db: DB) => (db.driverSettlements ??= []);
const ACTIVE: DeliveryState[] = ['PENDING', 'ASSIGNED', 'PICKED_UP', 'FAILED'];
const ON_ROAD: DeliveryState[] = ['ASSIGNED', 'PICKED_UP'];

export interface DeliveryRules { feeTaxable: boolean; graceMinutes: number; readyWaitMinutes: number; maxActivePerDriver: number; driverCashLimit: string; packagingOnDelivery: boolean }
export function rules(branchId?: string | null): DeliveryRules {
  const v = policy<Partial<DeliveryRules>>('DeliveryPolicy', { branchId }) ?? {};
  return { feeTaxable: v.feeTaxable !== false, graceMinutes: Number(v.graceMinutes ?? 10), readyWaitMinutes: Number(v.readyWaitMinutes ?? 10), maxActivePerDriver: Number(v.maxActivePerDriver ?? 3), driverCashLimit: String(v.driverCashLimit ?? '2000'), packagingOnDelivery: v.packagingOnDelivery !== false };
}

/** Run another handler inside the same transaction (same db snapshot, user, terminal). */
export function subCall(ctx: Ctx, opId: string, params: Record<string, string>, body: any): any {
  const r = (orderHandlers[opId] as any)({ ...ctx, params, body, query: {} });
  return r && typeof r === 'object' && typeof r.status === 'number' && 'body' in r ? r.body : r;
}

export const REASONS: Record<string, { ar: string; en: string }> = {
  NO_ANSWER: { ar: 'العميل مش بيرد', en: 'Customer not answering' },
  WRONG_ADDRESS: { ar: 'العنوان غلط أو ناقص', en: 'Wrong or incomplete address' },
  CUSTOMER_NOT_HOME: { ar: 'العميل مش موجود', en: 'Customer not at home' },
  CUSTOMER_REFUSED: { ar: 'العميل رفض الاستلام', en: 'Customer refused' },
  VEHICLE_ISSUE: { ar: 'عطل في الموتوسيكل', en: 'Vehicle problem' },
  OTHER: { ar: 'سبب تاني', en: 'Other' },
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

export function driverView(db: DB, drv: Driver, now: number) {
  const mine = deliveriesOf(db).filter((d) => d.driverId === drv.id);
  const active = mine.filter((d) => ON_ROAD.includes(d.state));
  const status = !drv.onShift ? 'OFF' : active.some((d) => d.state === 'PICKED_UP') ? 'ON_TRIP' : active.length ? 'ASSIGNED' : 'AVAILABLE';
  const cash = driverCash(db, drv.id);
  const limit = rules(drv.branchId).driverCashLimit;
  const today = new Date(now - 4 * 3600_000).toISOString().slice(0, 10);
  const deliveredToday = mine.filter((d) => d.state === 'DELIVERED' && (d.deliveredAt ?? '').slice(0, 10) >= today).length;
  const last = settlementsOf(db).filter((s) => s.driverId === drv.id).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  return {
    ...drv, status, activeCount: active.length,
    active: active.map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, state: d.state, zoneName: d.zoneName, customerName: d.customerName, promisedAt: d.promisedAt, late: now > d.promisedAtMs + rules(d.branchId).graceMinutes * 60_000, amount: d.amount, paymentMode: d.paymentMode, zoneId: d.zoneId })),
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
    order: o ? { id: o.id, number: o.number, status: o.status, version: o.version, payable: computeTotals(o).payable, paid: st?.paid ?? '0.0000', remaining: st ? st.remaining : computeTotals(o).payable, settled: st?.settled ?? false, items: activeLines(o).map((l) => `${l.name.ar} ×${l.quantity}`).join('، '), itemCount: activeLines(o).length } : null,
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
  if (!d || (ctx.branchId && d.branchId !== ctx.branchId)) throw new ApiError('DELIVERY_NOT_FOUND', { deliveryId: id });
  return d;
}
function getDriver(ctx: Ctx, id: string): Driver {
  const drv = driversOf(ctx.db).find((x) => x.id === id && x.active);
  if (!drv) throw new ApiError('DRIVER_NOT_FOUND', { driverId: id });
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
  const before = d.driverId ? driversOf(ctx.db).find((x) => x.id === d.driverId)?.name : null;
  d.driverId = drv.id;
  d.state = 'ASSIGNED';
  d.assignedAt = ctx.nowIso;
  step(ctx, d, 'ASSIGNED', before && before !== drv.name ? { ar: `اتغيّر الطيار من ${before} لـ ${drv.name}`, en: `reassigned ${before} → ${drv.name}` } : { ar: `اتسلّم للطيار ${drv.name}`, en: `assigned to ${drv.name}` });
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
    const list = driversOf(ctx.db).filter((d) => d.active && (!ctx.branchId || d.branchId === ctx.branchId)).map((d) => driverView(ctx.db, d, ctx.now));
    const totalCash = list.reduce((a, d) => a.plus(D(d.cashInHand)), D(0));
    const recentSettlements = settlementsOf(ctx.db).slice(0, 20).map((x) => ({ ...x, driverName: driversOf(ctx.db).find((d) => d.id === x.driverId)?.name ?? x.driverId, byName: userName(ctx.db, x.by) }));
    return { ...page(list, ctx.query), recentSettlements, summary: { onShift: list.filter((d) => d.onShift).length, available: list.filter((d) => d.status === 'AVAILABLE').length, onTrip: list.filter((d) => d.status === 'ON_TRIP').length, cashInHand: m4(totalCash) }, rules: rules(ctx.branchId), restaurant: RESTAURANT_XY };
  },
  'Driver.Upsert': (ctx) => {
    const db = ctx.db;
    const b = ctx.body;
    let drv = driversOf(db).find((x) => x.id === ctx.params.driverId);
    if (drv) {
      checkVersion(drv, b.expectedVersion);
      if (b.onShift === false && drv.onShift) {
        const carrying = deliveriesOf(db).filter((x) => x.driverId === drv!.id && ON_ROAD.includes(x.state)).length;
        if (carrying) throw new ApiError('DRIVER_HAS_ACTIVE_DELIVERIES', { carrying });
        if (D(driverCash(db, drv.id).amount).gt(0)) throw new ApiError('DRIVER_CASH_NOT_SETTLED', { cashInHand: driverCash(db, drv.id).amount });
      }
      if (b.name !== undefined) { need(String(b.name).trim(), 'VALIDATION_FAILED', { field: 'name' }); drv.name = String(b.name).trim(); }
      if (b.phone !== undefined) { const p = normPhone(b.phone); if (!PHONE_RE.test(p)) throw new ApiError('CUSTOMER_PHONE_INVALID', { field: 'phone' }); drv.phone = p; }
      if (b.vehicle) drv.vehicle = b.vehicle;
      if (b.plate !== undefined) drv.plate = b.plate || null;
      if (b.onShift !== undefined) {
        drv.onShift = !!b.onShift;
        drv.location = drv.onShift ? { ...RESTAURANT_XY, at: ctx.nowIso } : null;
      }
      if (b.active === false) {
        if (deliveriesOf(db).some((x) => x.driverId === drv!.id && ON_ROAD.includes(x.state))) throw new ApiError('DRIVER_HAS_ACTIVE_DELIVERIES');
        drv.active = false; drv.onShift = false;
      }
      drv.version++;
    } else {
      requireFields(ctx, 'name', 'phone');
      const p = normPhone(b.phone);
      if (!PHONE_RE.test(p)) throw new ApiError('CUSTOMER_PHONE_INVALID', { field: 'phone' });
      drv = { id: ctx.params.driverId === 'new' ? nextId('drv') : ctx.params.driverId, branchId: ctx.branchId ?? 'branch_main', name: String(b.name).trim(), phone: p, vehicle: b.vehicle ?? 'MOTORCYCLE', plate: b.plate ?? null, onShift: !!b.onShift, active: true, location: b.onShift ? { ...RESTAURANT_XY, at: ctx.nowIso } : null, version: 1, createdAt: ctx.nowIso, owed: '0.0000', userId: null };
      driversOf(db).push(drv);
    }
    ctx.audit(`driver ${drv.name} saved (onShift ${drv.onShift})`, drv.id);
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
          o.history.push(hist(ctx.user!.id, 'CAPTURED', { ar: `الطيار ${drv.name} سلّم ${m4(amt)} كاش في الدرج (تسوية ${settlement.id})`, en: `driver cash ${amt} settled` }, null, ctx.terminal?.code));
        }
        if (tryComplete(ctx, o)) completed.push(o.number);
      }
      d.cod!.settled = true;
      d.cod!.settlementId = settlement.id;
      step(ctx, d, 'CASH_SETTLED', { ar: `فلوس الطلب اتسلمت للكاشير (${m4(d.cod!.amount)})`, en: `cash settled ${d.cod!.amount}` });
    }
    if (D(variance).lt(0)) {
      drawerEntry(ctx, session.id, 'PAY_OUT', D(variance).abs().toString(), { reasonCode: 'DRIVER_SHORTAGE', reason: `عجز الطيار ${drv.name}`, ref: settlement.id, approvalGrantId: g?.id });
      drv.owed = m4(D(drv.owed).plus(D(variance).abs()));
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
    let list = deliveriesOf(db).filter((d) => !ctx.branchId || d.branchId === ctx.branchId);
    const scope = q.scope ?? 'active';
    if (scope === 'active') list = list.filter((d) => ACTIVE.includes(d.state) || (!d.historical && ctx.businessDate() === today && (d.deliveredAt ?? d.cancelledAt ?? d.createdAt) >= new Date(ctx.now - 12 * 3600_000).toISOString()));
    if (q.state) list = list.filter((d) => q.state.split(',').includes(d.state));
    if (q.driverId) list = list.filter((d) => d.driverId === q.driverId);
    if (q.customerId) list = list.filter((d) => d.customerId === q.customerId);
    const views = [...list].sort((a, b) => b.createdAtMs - a.createdAtMs).map((d) => deliveryView(db, d, ctx.now));
    const summary = {
      pending: views.filter((v) => v.state === 'PENDING').length, onRoad: views.filter((v) => ON_ROAD.includes(v.state)).length, failed: views.filter((v) => v.state === 'FAILED').length,
      late: views.filter((v) => v.late).length, delivered: views.filter((v) => v.state === 'DELIVERED').length, readyWaiting: views.filter((v) => v.readyWaiting).length,
    };
    return { ...page(views, q), summary, rules: rules(ctx.branchId), reasons: REASONS };
  },
  'Delivery.Assign': (ctx) => {
    const d = getDelivery(ctx, ctx.params.deliveryId);
    requireFields(ctx, 'driverId');
    checkVersion(d, ctx.body.expectedVersion);
    if (!['PENDING', 'FAILED', 'ASSIGNED'].includes(d.state)) invalid(d, 'ASSIGNED');
    const drv = getDriver(ctx, ctx.body.driverId);
    if (d.state === 'ASSIGNED' && d.driverId === drv.id) invalid(d, 'ASSIGNED', { reason: 'same driver' });
    assignDriver(ctx, d, drv);
    return deliveryView(ctx.db, d, ctx.now, true);
  },
  'Delivery.Dispatch': (ctx) => {
    const db = ctx.db;
    const d = getDelivery(ctx, ctx.params.deliveryId);
    checkVersion(d, ctx.body.expectedVersion);
    const to = ctx.body.toState ?? 'PICKED_UP';
    if (to !== 'PICKED_UP') invalid(d, to);
    if (ctx.body.driverId && (d.state === 'PENDING' || d.state === 'FAILED' || (d.state === 'ASSIGNED' && d.driverId !== ctx.body.driverId))) assignDriver(ctx, d, getDriver(ctx, ctx.body.driverId));
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
          o.history.push(hist(ctx.user!.id, 'CAPTURED', { ar: `اتدفع كارت مع الطيار ${m4(remaining)} (${ref})`, en: `card on delivery ${remaining}` }, null, ctx.terminal?.code));
          d.collected = { method: 'CARD', amount: c.amount, reference: ref, captureId: c.id };
          collectedText = ` — اتدفع كارت ${m4(remaining)}`;
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
    step(ctx, d, 'DELIVERED', { ar: `اتسلّم للعميل${late ? ` (متأخر ${Math.floor((ctx.now - d.promisedAtMs) / 60000)} دقيقة)` : ''}${collectedText}`, en: `delivered${late ? ' (late)' : ''}` });
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
        o.version++; o.history.push(hist(ctx.user!.id, 'CANCELLED', { ar: `الطلب اتلغى مع إلغاء التوصيل: ${reason}`, en: `cancelled with delivery: ${reason}` }, null, ctx.terminal?.code));
        outcome = 'ORDER_CANCELLED';
      } else if (o.status === 'CONFIRMED' && !caps.length) {
        const started = db.tickets.some((t) => t.orderId === o.id && t.state !== 'NEW');
        for (const l of activeLines(o)) { l.status = 'VOIDED'; l.version++; l.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: 'DELIVERY_CANCELLED', reason, approvalGrantId: g?.id, disposition: started ? 'WASTE' : 'NOT_PREPARED', approverId: g?.approverUserId }; }
        for (const t of db.tickets.filter((t) => t.orderId === o.id)) { for (const it of t.items) it.status = 'CANCELLED'; t.version++; }
        o.status = 'VOIDED'; o.voidedAt = ctx.nowIso; o.endReason = { code: 'DELIVERY_CANCELLED', note: reason, approvalGrantId: g?.id };
        o.version++; o.history.push(hist(ctx.user!.id, 'VOIDED', { ar: `الطلب اتلغى مع إلغاء التوصيل (${started ? 'الأكل اتعمل — هالك' : 'ما اتعملش'}): ${reason}${g ? ` — بموافقة ${userName(db, g.approverUserId)}` : ''}`, en: `voided with delivery: ${reason}` }, null, ctx.terminal?.code));
        outcome = 'ORDER_VOIDED';
      } else if (caps.length && o.status === 'CONFIRMED') {
        outcome = 'REFUND_NEEDED';
        o.history.push(hist(ctx.user!.id, 'DELIVERY_CANCELLED', { ar: `التوصيل اتلغى والطلب مدفوع — محتاج مرتجع: ${reason}`, en: 'delivery cancelled on a paid order — refund needed' }, null, ctx.terminal?.code));
      } else outcome = 'ORDER_KEPT';
    }
    const drv = d.driverId ? driversOf(db).find((x) => x.id === d.driverId) : null;
    if (drv && d.state === 'PICKED_UP') drv.location = { ...RESTAURANT_XY, at: ctx.nowIso };
    d.state = 'CANCELLED';
    d.cancelledAt = ctx.nowIso;
    d.cancel = { at: ctx.nowIso, by: ctx.user!.id, reason, approvalGrantId: g?.id ?? null, orderOutcome: outcome };
    d.driverId = d.driverId ?? null;
    step(ctx, d, 'CANCELLED', { ar: `التوصيل اتلغى: ${reason}${outcome === 'REFUND_NEEDED' ? ' — الطلب مدفوع، اعمل مرتجع' : outcome === 'ORDER_VOIDED' ? ' — الطلب اتلغى' : ''}`, en: `cancelled: ${reason} (${outcome})` });
    ctx.audit(`delivery ${d.number} cancelled (${outcome}): ${reason}`, d.id, true, g?.id);
    return deliveryView(db, d, ctx.now, true);
  },
};
