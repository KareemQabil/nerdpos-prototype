import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, hist, event } from '../store';
import { computeTotals } from '../pricing';
import { checkVersion, need, page, requireBranch, requireFields, userName } from './util';
import { m4 } from '../money';
import type { TableVisit } from '../types';
import type { FloorPlan, TableLayout, TableTurn } from '../types-ops';
import { policy } from '../policies';
import '../ops-registry';
import { reservationRules, tableConflict, depositBalances, depositView, depVersion, resVersion, pushResEvent, forfeitDeposit, cancelOutcome, blockMs } from '../reservation-rules';
import type { Reservation } from '../types';

export const openVisitOn = (ctx: Ctx, tableId: string) => ctx.db.visits.find((v) => v.state === 'OPEN' && (v.tableId === tableId || v.joinedTableIds.includes(tableId)));
const openChecks = (ctx: Ctx, visitId: string) => ctx.db.orders.filter((o) => o.visitId === visitId && (o.status === 'DRAFT' || o.status === 'CONFIRMED'));

function getTable(ctx: Ctx, id: string, code = 'TABLE_NOT_FOUND') {
  const t = ctx.db.tables.find((x) => x.id === id);
  if (!t || t.branchId !== ctx.branchId) throw new ApiError(code, { tableId: id });
  return t;
}
function getVisit(ctx: Ctx, id: string) {
  const v = ctx.db.visits.find((x) => x.id === id);
  if (!v || v.branchId !== ctx.branchId) throw new ApiError('TABLE_VISIT_NOT_FOUND', { visitId: id });
  return v;
}

function visitView(ctx: Ctx, v: TableVisit) {
  const checks = ctx.db.orders.filter((o) => o.visitId === v.id && o.status !== 'MERGED');
  return {
    ...v,
    tableName: ctx.db.tables.find((t) => t.id === v.tableId)?.name,
    joinedTableNames: v.joinedTableIds.map((id) => ctx.db.tables.find((t) => t.id === id)?.name),
    serverName: userName(ctx.db, v.serverUserId),
    minutesSeated: Math.floor((ctx.now - v.openedAtMs) / 60000),
    checks: checks.map((o) => ({ id: o.id, number: o.number, checkNo: o.checkNo, status: o.status, version: o.version, payable: computeTotals(o).payable, lines: o.lines.filter((l) => l.status === 'ACTIVE').length, unfired: o.lines.filter((l) => l.status === 'ACTIVE' && l.fireRound === null).length })),
  };
}

export const floorHandlers: Record<string, Handler> = {
  'Table.List': (ctx) => {
    const branchId = ctx.query.branchId ?? requireBranch(ctx);
    if (branchId !== ctx.branchId) throw new ApiError('PERMISSION_DENIED', { reason: 'other branch' });
    const tables = ctx.db.tables.filter((t) => t.branchId === branchId && (ctx.query.active === undefined || String(t.active) === ctx.query.active));
    return page(tables.map((t) => {
      const v = openVisitOn(ctx, t.id);
      const res = upcomingOn(ctx, t.id);
      return { ...t, ...placeOf(ctx, t), occupancy: v ? { visitId: v.id, primary: v.tableId === t.id, guestCount: v.guestCount, serverUserId: v.serverUserId, serverName: userName(ctx.db, v.serverUserId), openedAt: v.openedAt, minutesSeated: Math.floor((ctx.now - v.openedAtMs) / 60000), checks: openChecks(ctx, v.id).length, payable: m4(openChecks(ctx, v.id).reduce((a, o) => a + Number(computeTotals(o).payable), 0)) } : null, reservation: res ? upcomingView(ctx, res) : null };
    }), ctx.query);
  },
  'Table.Create': (ctx) => {
    requireFields(ctx, 'name', 'capacity');
    const branchId = requireBranch(ctx);
    if (ctx.db.tables.some((t) => t.branchId === branchId && t.name === String(ctx.body.name))) throw new ApiError('TABLE_NAME_TAKEN', { name: ctx.body.name });
    need(Number(ctx.body.capacity) >= 1, 'VALIDATION_FAILED', { field: 'capacity' });
    const t = { id: nextId('tbl'), branchId, name: String(ctx.body.name), area: ctx.body.area ?? '', capacity: Number(ctx.body.capacity), active: true, version: 1 };
    ctx.db.tables.push(t);
    ctx.audit(`table ${t.name}`, t.id);
    return t;
  },
  'Table.Configure': (ctx) => {
    const t = getTable(ctx, ctx.params.tableId);
    checkVersion(t, ctx.body.expectedVersion);
    if (ctx.body.name && ctx.body.name !== t.name && ctx.db.tables.some((x) => x.branchId === t.branchId && x.name === ctx.body.name)) throw new ApiError('TABLE_NAME_TAKEN');
    Object.assign(t, { name: ctx.body.name ?? t.name, area: ctx.body.area ?? t.area, capacity: Number(ctx.body.capacity ?? t.capacity) });
    t.version++;
    return t;
  },
  'Table.SetActive': (ctx) => {
    const t = getTable(ctx, ctx.params.tableId);
    checkVersion(t, ctx.body.expectedVersion);
    if (!ctx.body.active && openVisitOn(ctx, t.id)) throw new ApiError('TABLE_OCCUPIED', { tableId: t.id });
    t.active = !!ctx.body.active;
    t.version++;
    return t;
  },
  'TableVisit.List': (ctx) => page(ctx.db.visits.filter((v) => v.branchId === ctx.branchId && (!ctx.query.state || v.state === ctx.query.state) && (!ctx.query.tableId || v.tableId === ctx.query.tableId)).map((v) => visitView(ctx, v)), ctx.query),
  'TableVisit.Open': (ctx) => {
    const t = getTable(ctx, ctx.params.tableId);
    // ux-12: opening a table for a reservation IS seating it — the one path (Reservation.Seat) with the same result
    if (ctx.body.reservationId) {
      const r = getReservation(ctx, ctx.body.reservationId);
      if (ctx.body.reservationVersion !== undefined) casRes(r, ctx.body.reservationVersion, 'reservationVersion');
      const { visit } = seatReservation(ctx, r, t.id, ctx.body.guestCount);
      return { status: 201, body: visit };
    }
    const v = openVisit(ctx, t, ctx.body.guestCount);
    return { status: 201, body: visitView(ctx, v) };
  },
  'TableVisit.Close': (ctx) => {
    const v = getVisit(ctx, ctx.params.visitId);
    checkVersion(v, ctx.body.expectedVersion);
    if (v.state !== 'OPEN') throw new ApiError('TABLE_NOT_OCCUPIED', { visitId: v.id });
    const open = openChecks(ctx, v.id);
    if (open.length) throw new ApiError('TABLE_HAS_OPEN_CHECKS', { checks: open.map((o) => ({ id: o.id, number: o.number, status: o.status })) });
    closeVisit(ctx, v, 'MANUAL');
    return visitView(ctx, v);
  },
  'TableVisit.Transfer': (ctx) => {
    const v = getVisit(ctx, ctx.params.visitId);
    const to = getTable(ctx, ctx.body.toTableId);
    checkVersion(v, ctx.body.expectedVersion);
    if (v.state !== 'OPEN') throw new ApiError('TABLE_NOT_OCCUPIED');
    if (!to.active) throw new ApiError('TABLE_INACTIVE', { tableId: to.id });
    if (openVisitOn(ctx, to.id)) throw new ApiError('TABLE_OCCUPIED', { tableId: to.id });
    const from = ctx.db.tables.find((t) => t.id === v.tableId)!;
    v.tableId = to.id;
    v.version++;
    v.history.push(hist(ctx.user!.id, 'TRANSFERRED', { ar: `نُقلت من ${from.name} إلى ${to.name}`, en: `moved ${from.name} → ${to.name}` }, null, ctx.terminal?.code));
    for (const o of ctx.db.orders.filter((x) => x.visitId === v.id)) { o.tableId = to.id; }
    ctx.audit(`visit moved ${from.name} → ${to.name}`, v.id);
    return visitView(ctx, v);
  },
  // Direction D5 (PD-held in canonical): one party across several tables = one visit.
  'Table.Merge': (ctx) => {
    const v = getVisit(ctx, ctx.body.visitId);
    const t = getTable(ctx, ctx.body.tableId);
    if (v.state !== 'OPEN') throw new ApiError('TABLE_NOT_OCCUPIED');
    if (!t.active) throw new ApiError('TABLE_INACTIVE');
    if (openVisitOn(ctx, t.id)) throw new ApiError('TABLE_OCCUPIED', { tableId: t.id });
    v.joinedTableIds.push(t.id);
    v.version++;
    v.history.push(hist(ctx.user!.id, 'JOINED', { ar: `انضمت ترابيزة ${t.name}`, en: `joined table ${t.name}` }));
    return visitView(ctx, v);
  },
  'Table.Release': (ctx) => {
    const v = getVisit(ctx, ctx.params.visitId);
    const t = getTable(ctx, ctx.body.tableId);
    need(v.joinedTableIds.includes(t.id), 'VALIDATION_FAILED', { rule: 'only a joined (non-primary) table can be released' });
    v.joinedTableIds = v.joinedTableIds.filter((x) => x !== t.id);
    v.version++;
    v.history.push(hist(ctx.user!.id, 'RELEASED', { ar: `فُصلت ترابيزة ${t.name}`, en: `released table ${t.name}` }));
    return visitView(ctx, v);
  },
  'Table.AssignWaiter': (ctx) => {
    const v = openVisitOn(ctx, ctx.params.tableId);
    need(v, 'TABLE_NOT_OCCUPIED');
    need(ctx.db.users.some((u) => u.id === ctx.body.userId), 'USER_NOT_FOUND');
    const before = v!.serverUserId;
    v!.serverUserId = ctx.body.userId;
    v!.version++;
    v!.history.push(hist(ctx.user!.id, 'SERVER', { ar: `تغيّر الويتر من ${userName(ctx.db, before)} إلى ${userName(ctx.db, ctx.body.userId)}`, en: 'server changed' }));
    return visitView(ctx, v!);
  },
  // Direction D14 (PD-held): reservations with deposit and no-show fee. ux-12: linked to a customer, updated (time,
  // table, party size, notes) with CAS and the table-conflict rule, cancelled with a reason (deposit outcome by
  // ReservationPolicy), seated through one path, every change in the append-only history and the audit.
  'Reservation.Find': (ctx) => {
    const q = ctx.query;
    let list = ctx.db.reservations.filter((r) => r.branchId === ctx.branchId);
    if (q.customerId) list = list.filter((r) => r.customerId === q.customerId);
    if (q.state) list = list.filter((r) => String(q.state).split(',').includes(r.state));
    if (q.from) list = list.filter((r) => r.at >= String(q.from));
    if (q.to) list = list.filter((r) => r.at < String(q.to));
    const rules = reservationRules(ctx.branchId);
    return { ...page([...list].sort((a, b) => a.at.localeCompare(b.at)).map((r) => reservationView(ctx, r)), q), rules };
  },
  'Reservation.Create': (ctx) => {
    const branchId = requireBranch(ctx);
    const b = ctx.body ?? {};
    const who = guestOf(ctx, b);
    const partySize = Number(b.partySize);
    need(Number.isInteger(partySize) && partySize >= 1 && partySize <= 200, 'VALIDATION_FAILED', { field: 'partySize', rule: 'whole number 1..200' });
    const atMs = Date.parse(String(b.at ?? ''));
    need(b.at && Number.isFinite(atMs), 'VALIDATION_FAILED', { field: 'at', rule: 'required ISO time' });
    if (atMs < ctx.now) throw new ApiError('RESERVATION_TIME_PAST', { at: b.at }, 409);
    const rules = reservationRules(branchId);
    if (b.tableId) {
      const t = getTable(ctx, b.tableId);
      if (!t.active) throw new ApiError('TABLE_INACTIVE', { tableId: t.id });
      const c = tableConflict(ctx.db, rules, branchId, t.id, atMs, null);
      if (c) throw new ApiError('RESERVATION_TABLE_CONFLICT', conflictDetails(ctx, c, rules), 409);
    }
    let dep: any = null;
    if (b.depositId) {
      dep = ctx.db.deposits.find((x) => x.id === b.depositId && x.branchId === branchId);
      need(dep && dep.state === 'HELD', 'VALIDATION_FAILED', { field: 'depositId', rule: 'a held deposit of this branch' });
      need(!dep.reservationId || !ctx.db.reservations.some((x) => x.id === dep.reservationId), 'VALIDATION_FAILED', { field: 'depositId', rule: 'already linked to another reservation' });
    }
    const notes = String(b.notes ?? '').trim().slice(0, 200) || null;
    need(b.noShowFee === undefined || b.noShowFee === '' || isAmount(b.noShowFee), 'VALIDATION_FAILED', { field: 'noShowFee' });
    const r: Reservation = { id: nextId('resv'), branchId, customer: who.name, phone: who.phone, customerId: who.customerId, partySize, at: new Date(atMs).toISOString(), tableId: b.tableId ?? null, depositId: dep?.id ?? null, noShowFee: m4(b.noShowFee || '0'), state: 'BOOKED', createdAt: ctx.nowIso, createdBy: ctx.user!.id, visitId: null, notes, version: 1, history: [] };
    pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'CREATED', ref: dep?.id ?? null, amount: dep?.amount });
    ctx.db.reservations.push(r);
    if (dep) { dep.reservationId = r.id; if (!dep.customerId && who.customerId) dep.customerId = who.customerId; dep.version = depVersion(dep) + 1; }
    ctx.audit(`reservation ${r.customer} × ${r.partySize} at ${r.at}${r.tableId ? ` table ${tableName(ctx, r.tableId)}` : ''}${dep ? ` deposit ${dep.amount}` : ''}`, r.id);
    event('ReservationCreated', r.id, `${r.customer} ${r.at}`);
    return { status: 201, body: reservationView(ctx, r) };
  },
  // ux-12: change the time, the table, the party size, the notes (or link a legacy reservation to a customer). CAS.
  'Reservation.Update': (ctx) => {
    const r = getReservation(ctx, ctx.params.reservationId);
    if (r.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: r.state }, 409);
    casRes(r, ctx.body.expectedVersion);
    const b = ctx.body ?? {};
    const rules = reservationRules(r.branchId);
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    let atMs = Date.parse(r.at);
    if (b.at !== undefined) {
      const n = Date.parse(String(b.at));
      need(Number.isFinite(n), 'VALIDATION_FAILED', { field: 'at', rule: 'ISO time' });
      if (n !== atMs) {
        if (n < ctx.now) throw new ApiError('RESERVATION_TIME_PAST', { at: b.at }, 409);
        changes.push({ field: 'at', from: r.at, to: new Date(n).toISOString() }); atMs = n;
      }
    }
    let tableId = r.tableId;
    if (b.tableId !== undefined && (b.tableId || null) !== r.tableId) {
      if (b.tableId) { const t = getTable(ctx, b.tableId); if (!t.active) throw new ApiError('TABLE_INACTIVE', { tableId: t.id }); }
      changes.push({ field: 'tableId', from: r.tableId, to: b.tableId || null }); tableId = b.tableId || null;
    }
    let partySize = r.partySize;
    if (b.partySize !== undefined && Number(b.partySize) !== r.partySize) {
      const n = Number(b.partySize);
      need(Number.isInteger(n) && n >= 1 && n <= 200, 'VALIDATION_FAILED', { field: 'partySize', rule: 'whole number 1..200' });
      changes.push({ field: 'partySize', from: r.partySize, to: n }); partySize = n;
    }
    let notes = r.notes ?? null;
    if (b.notes !== undefined) { const n = String(b.notes ?? '').trim().slice(0, 200) || null; if (n !== notes) { changes.push({ field: 'notes', from: notes, to: n }); notes = n; } }
    let who: { name: string; phone: string; customerId: string | null } | null = null;
    if (b.customerId !== undefined && (b.customerId || null) !== (r.customerId ?? null)) {
      need(b.customerId, 'VALIDATION_FAILED', { field: 'customerId', rule: 'a reservation linked to a customer stays linked (pick another customer)' });
      who = guestOf(ctx, { customerId: b.customerId });
      changes.push({ field: 'customerId', from: r.customerId ?? null, to: who.customerId });
    }
    if (!changes.length) return reservationView(ctx, r);
    if (tableId && (changes.some((c) => c.field === 'at' || c.field === 'tableId'))) {
      const c = tableConflict(ctx.db, rules, r.branchId, tableId, atMs, r.id);
      if (c) throw new ApiError('RESERVATION_TABLE_CONFLICT', conflictDetails(ctx, c, rules), 409);
    }
    Object.assign(r, { at: new Date(atMs).toISOString(), tableId, partySize, notes });
    if (who) Object.assign(r, { customerId: who.customerId, customer: who.name, phone: who.phone });
    r.version = resVersion(r) + 1;
    pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'UPDATED', changes });
    const txt = (c: { field: string; from: unknown; to: unknown }) => c.field === 'tableId' ? `table ${c.from ? tableName(ctx, String(c.from)) : '—'} → ${c.to ? tableName(ctx, String(c.to)) : '—'}` : `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`;
    ctx.audit(`reservation ${r.customer} updated: ${changes.map(txt).join('; ')}`, r.id);
    event('ReservationUpdated', r.id, changes.map((c) => c.field).join(','));
    return reservationView(ctx, r);
  },
  // ux-12: cancel with a required reason. The deposit is never refunded here: ReservationPolicy decides whether the held
  // remainder is forfeited now (ALWAYS_FORFEIT, or FORFEIT_IF_LATE within lateCancelHours) or stays to be refunded
  // through Deposit.Refund (drawer PAY_OUT with a manager's approval).
  'Reservation.Cancel': (ctx) => {
    const r = getReservation(ctx, ctx.params.reservationId);
    if (r.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: r.state }, 409);
    const reason = String(ctx.body.reason ?? '').trim();
    if (reason.length < 3) throw new ApiError('REASON_REQUIRED', { field: 'reason', rule: 'at least 3 characters' });
    need(reason.length <= 200, 'VALIDATION_FAILED', { field: 'reason', rule: 'at most 200 characters' });
    casRes(r, ctx.body.expectedVersion);
    const rules = reservationRules(r.branchId);
    const d = r.depositId ? ctx.db.deposits.find((x) => x.id === r.depositId) : null;
    const co = cancelOutcome(rules, r, d, ctx.now);
    r.state = 'CANCELLED';
    r.cancel = { at: ctx.nowIso, by: ctx.user!.id, reason, late: co.late, mode: rules.cancelDepositMode, depositOutcome: co.outcome };
    r.version = resVersion(r) + 1;
    pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'CANCELLED', reason });
    if (d && co.outcome === 'FORFEITED') {
      const amount = forfeitDeposit(d, ctx.user!.id, ctx.nowIso, co.late && rules.cancelDepositMode === 'FORFEIT_IF_LATE' ? 'LATE_CANCEL' : 'CANCEL_POLICY', r.id, reason);
      pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_FORFEITED', amount, ref: d.id, reason: co.late ? 'LATE_CANCEL' : 'CANCEL_POLICY' });
    }
    ctx.audit(`reservation ${r.customer} at ${r.at} cancelled (${co.late ? 'late' : 'early'}, ${rules.cancelDepositMode}; deposit ${co.outcome}${co.outcome !== 'NONE' ? ` ${co.amount}` : ''}): ${reason}`, r.id, true);
    event('ReservationCancelled', r.id, `${co.outcome}`);
    return reservationView(ctx, r);
  },
  'Reservation.MarkNoShow': (ctx) => {
    const r = getReservation(ctx, ctx.params.reservationId);
    if (r.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: r.state }, 409);
    if (ctx.body?.expectedVersion !== undefined) casRes(r, ctx.body.expectedVersion);
    r.state = 'NO_SHOW';
    r.noShowAt = ctx.nowIso;
    r.version = resVersion(r) + 1;
    pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'NO_SHOW' });
    const d = ctx.db.deposits.find((x) => x.id === r.depositId);
    // the no-show fee keeps the deposit (liability → income) — unchanged; ux-12 records the outcome
    if (d && d.state === 'HELD') {
      const amount = forfeitDeposit(d, ctx.user!.id, ctx.nowIso, 'NO_SHOW', r.id, null);
      pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_FORFEITED', amount, ref: d.id, reason: 'NO_SHOW' });
    }
    ctx.audit(`reservation ${r.customer} at ${r.at} no-show${d ? ` (deposit ${d.state})` : ''}`, r.id, true);
    event('ReservationNoShow', r.id, r.customer);
    return reservationView(ctx, r);
  },
  // ux-12: the one seating path — opens the table visit for the reservation (TableVisit.Open with reservationId runs it too)
  'Reservation.Seat': (ctx) => {
    const r = getReservation(ctx, ctx.params.reservationId);
    if (r.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: r.state }, 409);
    casRes(r, ctx.body.expectedVersion);
    const tableId = ctx.body.tableId ?? r.tableId;
    need(tableId, 'VALIDATION_FAILED', { field: 'tableId', rule: 'choose a table' });
    const out = seatReservation(ctx, r, tableId, ctx.body.guestCount);
    return { status: 201, body: out };
  },
  ...floorPlanHandlers(),
};

// ───────── ux-12: reservations — helpers shared by the reservation commands, TableVisit.Open and Table.List
function casRes(r: Reservation, expected: unknown, field = 'expectedVersion') {
  resVersion(r);
  checkVersion(r as { version: number }, expected, field);
}
function getReservation(ctx: Ctx, id: string) {
  const r = ctx.db.reservations.find((x) => x.id === id && x.branchId === ctx.branchId);
  if (!r) throw new ApiError('RESERVATION_NOT_FOUND', { reservationId: id }, 404);
  return r;
}
const tableName = (ctx: Ctx, id: string) => ctx.db.tables.find((t) => t.id === id)?.name ?? id;
const isAmount = (v: unknown) => /^\d{1,9}(\.\d{1,4})?$/.test(String(v));
/** The guest: a customer record (name and phone come from it), or the legacy free-text name and phone. */
function guestOf(ctx: Ctx, b: any): { name: string; phone: string; customerId: string | null } {
  if (b.customerId) {
    const c = (ctx.db.customers ?? []).find((x) => x.id === b.customerId);
    if (!c) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: b.customerId }, 404);
    if (c.active === false) throw new ApiError('VALIDATION_FAILED', { field: 'customerId', rule: 'customer merged into another (use the main record)', mergedInto: (c as any).mergedInto ?? null });
    return { name: c.name, phone: c.phone, customerId: c.id };
  }
  const name = String(b.customer ?? '').trim();
  const phone = String(b.phone ?? '').trim();
  if (!name || !phone) throw new ApiError('VALIDATION_FAILED', { field: !name ? 'customer' : 'phone', rule: 'customerId, or the guest name and phone' });
  return { name: name.slice(0, 80), phone: phone.slice(0, 20), customerId: null };
}
function conflictDetails(ctx: Ctx, c: Reservation, rules: ReturnType<typeof reservationRules>) {
  return { conflictWith: c.id, customer: c.customer, at: c.at, tableId: c.tableId, tableName: c.tableId ? tableName(ctx, c.tableId) : null, windowMinutes: rules.seatMinutes + rules.bufferMinutes };
}
function reservationView(ctx: Ctx, r: Reservation) {
  const d = r.depositId ? ctx.db.deposits.find((x) => x.id === r.depositId) ?? null : null;
  const cust = r.customerId ? (ctx.db.customers ?? []).find((c) => c.id === r.customerId) ?? null : null;
  const rules = reservationRules(r.branchId);
  const co = r.state === 'BOOKED' ? cancelOutcome(rules, r, d, ctx.now) : null;
  const atMs = Date.parse(r.at);
  return {
    ...r, version: resVersion(r), history: (r.history ?? []).map((e) => ({ ...e, byName: userName(ctx.db, e.by) })),
    customerName: cust?.name ?? r.customer, phone: cust?.phone ?? r.phone, legacy: !r.customerId,
    customerRef: cust ? { id: cust.id, code: (cust as any).code ?? null, tags: (cust as any).tags ?? [], allergies: (cust as any).allergies ?? [] } : null,
    deposit: d ? depositView(ctx.db, d) : null, tableName: r.tableId ? ctx.db.tables.find((t) => t.id === r.tableId)?.name ?? null : null,
    endsAt: new Date(atMs + rules.seatMinutes * 60_000).toISOString(), cancelPreview: co,
    visitOpen: !!(r.visitId && ctx.db.visits.some((v) => v.id === r.visitId && v.state === 'OPEN')),
    cancelledByName: r.cancel ? userName(ctx.db, r.cancel.by) : null,
  };
}
/** The reservation a table shows on the floor plan: booked, from upcomingMinutes before its time until its seat ends. */
function upcomingOn(ctx: Ctx, tableId: string) {
  const rules = reservationRules(ctx.branchId);
  return ctx.db.reservations.filter((r) => r.tableId === tableId && r.state === 'BOOKED' && r.branchId === ctx.branchId)
    .filter((r) => { const at = Date.parse(r.at); return ctx.now >= at - rules.upcomingMinutes * 60_000 && ctx.now <= at + rules.seatMinutes * 60_000; })
    .sort((a, b) => a.at.localeCompare(b.at))[0] ?? null;
}
function upcomingView(ctx: Ctx, r: Reservation) {
  const d = r.depositId ? ctx.db.deposits.find((x) => x.id === r.depositId) : null;
  const cust = r.customerId ? (ctx.db.customers ?? []).find((c) => c.id === r.customerId) : null;
  const atMs = Date.parse(r.at);
  return { id: r.id, version: resVersion(r), at: r.at, customer: cust?.name ?? r.customer, phone: cust?.phone ?? r.phone, customerId: r.customerId ?? null, partySize: r.partySize, notes: r.notes ?? null,
    minutesTo: Math.round((atMs - ctx.now) / 60_000), late: ctx.now > atMs, deposit: d ? depositBalances(d).remaining : null, depositState: d?.state ?? null };
}

/** Open a visit on a free table (shared by TableVisit.Open and the reservation seating path). */
function openVisit(ctx: Ctx, t: { id: string; name: string; branchId: string; active: boolean }, guestCount: unknown, reservationId: string | null = null): TableVisit {
  if (!t.active) throw new ApiError('TABLE_INACTIVE', { tableId: t.id });
  const existing = openVisitOn(ctx, t.id);
  if (existing) throw new ApiError('TABLE_OCCUPIED', { tableId: t.id, visitId: existing.id });
  const guests = Number(guestCount ?? 0);
  need(Number.isInteger(guests) && guests >= 1, 'VALIDATION_FAILED', { field: 'guestCount', rule: '>= 1' });
  seatOnTurn(ctx, t.id);
  const v: TableVisit = { id: nextId('visit'), tableId: t.id, branchId: t.branchId, state: 'OPEN', guestCount: guests, serverUserId: ctx.user!.id, openedAt: ctx.nowIso, openedAtMs: ctx.now, closedAt: null, version: 1, joinedTableIds: [], history: [hist(ctx.user!.id, 'OPENED', { ar: `فُتحت لـ ${guests} أفراد`, en: `opened for ${guests}` }, null, ctx.terminal?.code)], reservationId };
  ctx.db.visits.push(v);
  ctx.audit(`visit opened on table ${t.name}${reservationId ? ` (reservation ${reservationId})` : ''}`, v.id);
  event('TableVisitOpened', v.id, `table ${t.name}`);
  return v;
}

/** ux-12: seat a booked reservation — open its table visit and mark it SEATED, in the same transaction. */
function seatReservation(ctx: Ctx, r: Reservation, tableId: string, guestCount: unknown) {
  if (r.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: r.state }, 409);
  const t = getTable(ctx, tableId);
  const guests = guestCount === undefined || guestCount === null || guestCount === '' ? r.partySize : guestCount;
  if (t.id !== r.tableId) {
    // seating on another table than booked: it must not take a table another reservation holds now
    const rules = reservationRules(r.branchId);
    const c = tableConflict(ctx.db, rules, r.branchId, t.id, ctx.now, r.id);
    if (c && Math.abs(Date.parse(c.at) - ctx.now) < blockMs(rules) && c.state === 'BOOKED') throw new ApiError('RESERVATION_TABLE_CONFLICT', conflictDetails(ctx, c, rules), 409);
  }
  const v = openVisit(ctx, t, guests, r.id);
  const changes = t.id !== r.tableId ? [{ field: 'tableId', from: r.tableId, to: t.id }] : undefined;
  r.state = 'SEATED'; r.visitId = v.id; r.tableId = t.id; r.seatedAt = ctx.nowIso; r.seatedBy = ctx.user!.id;
  r.version = resVersion(r) + 1;
  pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'SEATED', changes, ref: v.id });
  ctx.audit(`reservation ${r.customer} seated on table ${t.name} (${v.guestCount} guests)`, r.id);
  event('ReservationSeated', r.id, `table ${t.name}`);
  return { reservation: reservationView(ctx, r), visit: visitView(ctx, v) };
}

export function closeVisit(ctx: Ctx, v: TableVisit, how: 'MANUAL' | 'AUTO') {
  v.state = 'CLOSED';
  v.closedAt = ctx.nowIso;
  v.version++;
  v.history.push(hist(ctx.user?.id ?? 'system', how === 'AUTO' ? 'AUTO_CLOSED' : 'CLOSED', how === 'AUTO' ? { ar: 'الترابيزة فضيت لوحدها بعد آخر شيك (VisitAutoClosePolicy)', en: 'auto-closed after last check' } : { ar: 'الويتر قفل الترابيزة', en: 'closed by waiter' }));
  event('TableVisitClosed', v.id, how);
  markDirtyAfterVisit(ctx, v);
}

// ───────── floor plans, table positions and the table turn (clean / needs cleaning) — direction (PD-held)
type TurnPolicy = { markDirty: boolean; blockSeating: boolean; alertMinutes: number };
const turnPolicy = (ctx: Ctx): TurnPolicy => ({ markDirty: true, blockSeating: false, alertMinutes: 10, ...(policy<Partial<TurnPolicy>>('TableTurnPolicy', { branchId: ctx.branchId }) ?? {}) } as TurnPolicy);
const floorsOf = (ctx: Ctx, branchId: string) => (ctx.db.floors ??= []).filter((f) => f.branchId === branchId).sort((a, b) => a.sortOrder - b.sortOrder);
const AREA_ALIASES: Record<string, string[]> = { Hall: ['Main hall', 'Hall'], Terrace: ['Terrace'] };

/** Position of a table: the stored layout, or an automatic spot on the floor whose name matches its area. */
function placeOf(ctx: Ctx, t: { id: string; branchId: string; area: string; capacity: number }) {
  const layouts = (ctx.db.tableLayouts ??= []);
  const turn = (ctx.db.tableTurns ??= []).find((x) => x.tableId === t.id && x.state === 'DIRTY');
  const turnView = turn ? { state: 'DIRTY' as const, since: turn.since, minutes: Math.floor((ctx.now - turn.sinceMs) / 60000) } : null;
  const floors = floorsOf(ctx, t.branchId);
  const stored = layouts.find((l) => l.tableId === t.id && floors.some((f) => f.id === l.floorId));
  if (stored) return { layout: { ...stored, auto: false }, floorId: stored.floorId, floorName: floors.find((f) => f.id === stored.floorId)?.name ?? null, turn: turnView };
  const area = (t.area ?? '').trim();
  const floor = floors.find((f) => f.name.ar === area || f.name.en === area || (AREA_ALIASES[area] ?? []).includes(f.name.en)) ?? floors[0];
  if (!floor) return { layout: null, floorId: null, floorName: null, turn: turnView };
  const unplaced = ctx.db.tables.filter((x) => x.branchId === t.branchId && !layouts.some((l) => l.tableId === x.id));
  const i = Math.max(0, unplaced.findIndex((x) => x.id === t.id));
  const size = t.capacity > 4 ? { w: 160, h: 100 } : { w: 100, h: 100 };
  return { layout: { tableId: t.id, floorId: floor.id, x: 40 + (i % 6) * 160, y: floor.height - 140 - Math.floor(i / 6) * 130, ...size, shape: t.capacity > 4 ? 'RECT' : 'SQUARE', rotation: 0, seats: t.capacity, auto: true }, floorId: floor.id, floorName: floor.name, turn: turnView };
}

function turnRec(ctx: Ctx, tableId: string): TableTurn {
  const list = (ctx.db.tableTurns ??= []);
  let r = list.find((x) => x.tableId === tableId);
  if (!r) { r = { tableId, state: 'CLEAN', since: ctx.nowIso, sinceMs: ctx.now, by: null, visitId: null, history: [] }; list.push(r); }
  return r;
}

/** After a visit closes, its tables need cleaning (TableTurnPolicy.markDirty). */
function markDirtyAfterVisit(ctx: Ctx, v: TableVisit) {
  if (!turnPolicy(ctx).markDirty) return;
  for (const id of [v.tableId, ...v.joinedTableIds]) {
    const r = turnRec(ctx, id);
    r.state = 'DIRTY'; r.since = ctx.nowIso; r.sinceMs = ctx.now; r.by = ctx.user?.id ?? 'system'; r.visitId = v.id;
    r.history.unshift({ at: ctx.nowIso, by: r.by, state: 'DIRTY' });
    r.history.length = Math.min(r.history.length, 20);
  }
}

/** Seating on a table that still needs cleaning: refused when the policy blocks it, else it counts as cleaned. */
function seatOnTurn(ctx: Ctx, tableId: string) {
  const r = (ctx.db.tableTurns ??= []).find((x) => x.tableId === tableId && x.state === 'DIRTY');
  if (!r) return;
  if (turnPolicy(ctx).blockSeating) throw new ApiError('TABLE_NEEDS_CLEANING', { tableId, since: r.since }, 409);
  r.state = 'CLEAN'; r.since = ctx.nowIso; r.sinceMs = ctx.now; r.by = ctx.user!.id;
  r.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, state: 'CLEAN' });
}

function floorView(ctx: Ctx, f: FloorPlan) {
  const tables = ctx.db.tables.filter((t) => t.branchId === f.branchId).map((t) => ({ t, p: placeOf(ctx, t) })).filter((x) => x.p.floorId === f.id);
  return { ...f, updatedByName: userName(ctx.db, f.updatedBy), tableCount: tables.length, seats: tables.reduce((a, x) => a + (x.p.layout?.seats ?? x.t.capacity), 0), tables: tables.map((x) => ({ id: x.t.id, name: x.t.name, capacity: x.t.capacity, active: x.t.active, version: x.t.version, ...x.p.layout })) };
}

const SHAPES = ['SQUARE', 'ROUND', 'RECT', 'BOOTH'];
function floorPlanHandlers(): Record<string, Handler> {
  return {
  'Floor.List': (ctx) => {
    const branchId = requireBranch(ctx);
    const all = ctx.db.tables.filter((t) => t.branchId === branchId);
    const placed = new Set(floorsOf(ctx, branchId).flatMap((f) => floorView(ctx, f).tables.map((t) => t.id)));
    return { items: floorsOf(ctx, branchId).map((f) => floorView(ctx, f)), unplaced: all.filter((t) => !placed.has(t.id)).map((t) => ({ id: t.id, name: t.name, capacity: t.capacity, active: t.active })) };
  },
  'Floor.Upsert': (ctx) => {
    const branchId = requireBranch(ctx);
    const id = ctx.params.floorId;
    need(/^[a-z0-9_-]{2,40}$/.test(id), 'VALIDATION_FAILED', { field: 'floorId' });
    const b = ctx.body ?? {};
    need(b.name?.ar && String(b.name.ar).trim().length <= 40, 'VALIDATION_FAILED', { field: 'name', rule: 'Arabic name required, at most 40 characters' });
    const floors = (ctx.db.floors ??= []);
    let f = floors.find((x) => x.id === id);
    if (f) { need(f.branchId === branchId, 'VALIDATION_FAILED', { field: 'floorId', rule: 'another branch' }); checkVersion(f, b.expectedVersion); }
    const nameAr = String(b.name.ar).trim();
    need(!floors.some((x) => x.branchId === branchId && x.id !== id && x.name.ar === nameAr), 'VALIDATION_FAILED', { field: 'name', rule: 'floor name taken in this branch' });
    const width = Math.min(2000, Math.max(400, Number(b.width ?? f?.width ?? 1000)));
    const height = Math.min(1400, Math.max(300, Number(b.height ?? f?.height ?? 620)));
    if (!f) { f = { id, branchId, name: { ar: nameAr, en: String(b.name.en ?? nameAr) }, sortOrder: Number(b.sortOrder ?? (floors.length + 1) * 10), width, height, active: true, decor: [], version: 0, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id }; floors.push(f); }
    Object.assign(f, { name: { ar: nameAr, en: String(b.name.en || nameAr) }, sortOrder: Number(b.sortOrder ?? f.sortOrder), width, height, active: b.active ?? f.active, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
    if (Array.isArray(b.decor)) f.decor = b.decor.slice(0, 60).map((d: any, i: number) => ({ id: String(d.id ?? `d${i}`), kind: d.kind, x: Math.round(Number(d.x)), y: Math.round(Number(d.y)), w: Math.round(Number(d.w)), h: Math.round(Number(d.h)), label: d.label ? String(d.label).slice(0, 40) : undefined }));
    // tables placed on this floor (create new ones, rename / resize existing ones, move them here)
    const layouts = (ctx.db.tableLayouts ??= []);
    const entries: any[] = Array.isArray(b.tables) ? b.tables : [];
    const names = new Set<string>();
    for (const e of entries) {
      const nm = String(e.name ?? '').trim();
      need(nm && nm.length <= 12, 'VALIDATION_FAILED', { field: 'tables.name', rule: 'name required, at most 12 characters' });
      need(!names.has(nm), 'TABLE_NAME_TAKEN', { name: nm });
      names.add(nm);
      need(Number(e.capacity) >= 1 && Number(e.capacity) <= 30, 'VALIDATION_FAILED', { field: 'tables.capacity', rule: '1..30' });
      need(SHAPES.includes(e.shape ?? 'SQUARE'), 'VALIDATION_FAILED', { field: 'tables.shape' });
      need(Number(e.x) >= 0 && Number(e.y) >= 0 && Number(e.x) + Number(e.w ?? 100) <= width + 1 && Number(e.y) + Number(e.h ?? 100) <= height + 1, 'VALIDATION_FAILED', { field: 'tables.position', rule: 'inside the floor', table: nm });
      const clash = ctx.db.tables.find((t) => t.branchId === branchId && t.name === nm && t.id !== e.tableId);
      if (clash) throw new ApiError('TABLE_NAME_TAKEN', { name: nm, tableId: clash.id });
    }
    const keep = new Set<string>();
    for (const e of entries) {
      let t = e.tableId ? ctx.db.tables.find((x) => x.id === e.tableId && x.branchId === branchId) : undefined;
      if (e.tableId && !t) throw new ApiError('TABLE_NOT_FOUND', { tableId: e.tableId });
      if (!t) { t = { id: nextId('tbl'), branchId, name: String(e.name).trim(), area: nameAr, capacity: Number(e.capacity), active: true, version: 1 }; ctx.db.tables.push(t); }
      else if (t.name !== String(e.name).trim() || t.capacity !== Number(e.capacity) || t.area !== nameAr) { Object.assign(t, { name: String(e.name).trim(), capacity: Number(e.capacity), area: nameAr }); t.version++; }
      keep.add(t.id);
      const lay: TableLayout = { tableId: t.id, floorId: f.id, x: Math.round(Number(e.x)), y: Math.round(Number(e.y)), w: Math.round(Number(e.w ?? 100)), h: Math.round(Number(e.h ?? 100)), shape: e.shape ?? 'SQUARE', rotation: Number(e.rotation ?? 0), seats: Number(e.seats ?? e.capacity) };
      const i = layouts.findIndex((l) => l.tableId === t!.id);
      if (i >= 0) layouts[i] = lay; else layouts.push(lay);
    }
    // tables that were on this floor and are no longer listed: off the map (or deactivated when asked)
    for (const l of layouts.filter((x) => x.floorId === f!.id && !keep.has(x.tableId))) layouts.splice(layouts.indexOf(l), 1);
    for (const tid of (b.removeTableIds ?? []) as string[]) {
      const t = ctx.db.tables.find((x) => x.id === tid && x.branchId === branchId);
      if (!t || keep.has(tid)) continue;
      if (openVisitOn(ctx, tid)) throw new ApiError('TABLE_OCCUPIED', { tableId: tid, name: t.name });
      t.active = false; t.version++;
    }
    f.version++;
    ctx.audit(`floor plan ${nameAr}: ${entries.length} tables`, f.id);
    event('FloorPlanSaved', f.id, `${nameAr} v${f.version}`);
    return floorView(ctx, f);
  },
  'Table.MarkClean': (ctx) => {
    const t = getTable(ctx, ctx.params.tableId);
    const to = (ctx.body?.state ?? 'CLEAN') as 'CLEAN' | 'DIRTY';
    need(to === 'CLEAN' || to === 'DIRTY', 'VALIDATION_FAILED', { field: 'state' });
    if (to === 'DIRTY' && openVisitOn(ctx, t.id)) throw new ApiError('TABLE_OCCUPIED', { tableId: t.id });
    const r = turnRec(ctx, t.id);
    const was = r.state;
    if (was !== to) { r.state = to; r.since = ctx.nowIso; r.sinceMs = ctx.now; r.by = ctx.user!.id; r.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, state: to }); r.history.length = Math.min(r.history.length, 20); }
    return { tableId: t.id, name: t.name, state: r.state, changed: was !== to, since: r.since, byName: userName(ctx.db, r.by) };
  },
  };
}
export { placeOf };
