import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, hist, event } from '../store';
import { computeTotals } from '../pricing';
import { checkVersion, need, page, requireBranch, requireFields, userName } from './util';
import { m4 } from '../money';
import type { TableVisit } from '../types';

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
      const res = ctx.db.reservations.find((r) => r.tableId === t.id && r.state === 'BOOKED');
      return { ...t, occupancy: v ? { visitId: v.id, primary: v.tableId === t.id, guestCount: v.guestCount, serverName: userName(ctx.db, v.serverUserId), openedAt: v.openedAt, minutesSeated: Math.floor((ctx.now - v.openedAtMs) / 60000), checks: openChecks(ctx, v.id).length, payable: m4(openChecks(ctx, v.id).reduce((a, o) => a + Number(computeTotals(o).payable), 0)) } : null, reservation: res ? { id: res.id, at: res.at, customer: res.customer, partySize: res.partySize } : null };
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
    if (!t.active) throw new ApiError('TABLE_INACTIVE', { tableId: t.id });
    const existing = openVisitOn(ctx, t.id);
    if (existing) throw new ApiError('TABLE_OCCUPIED', { tableId: t.id, visitId: existing.id });
    const guests = Number(ctx.body.guestCount ?? 0);
    need(guests >= 1, 'VALIDATION_FAILED', { field: 'guestCount', rule: '>= 1' });
    const v: TableVisit = { id: nextId('visit'), tableId: t.id, branchId: t.branchId, state: 'OPEN', guestCount: guests, serverUserId: ctx.user!.id, openedAt: ctx.nowIso, openedAtMs: ctx.now, closedAt: null, version: 1, joinedTableIds: [], history: [hist(ctx.user!.id, 'OPENED', { ar: `اتفتحت لـ ${guests} أفراد`, en: `opened for ${guests}` }, null, ctx.terminal?.code)] };
    if (ctx.body.reservationId) {
      const r = ctx.db.reservations.find((x) => x.id === ctx.body.reservationId);
      if (r) { r.state = 'SEATED'; r.visitId = v.id; }
    }
    ctx.db.visits.push(v);
    ctx.audit(`visit opened on table ${t.name}`, v.id);
    event('TableVisitOpened', v.id, `table ${t.name}`);
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
    v.history.push(hist(ctx.user!.id, 'TRANSFERRED', { ar: `اتنقلت من ${from.name} لـ ${to.name}`, en: `moved ${from.name} → ${to.name}` }, null, ctx.terminal?.code));
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
    v.history.push(hist(ctx.user!.id, 'RELEASED', { ar: `اتفكت ترابيزة ${t.name}`, en: `released table ${t.name}` }));
    return visitView(ctx, v);
  },
  'Table.AssignWaiter': (ctx) => {
    const v = openVisitOn(ctx, ctx.params.tableId);
    need(v, 'TABLE_NOT_OCCUPIED');
    need(ctx.db.users.some((u) => u.id === ctx.body.userId), 'USER_NOT_FOUND');
    const before = v!.serverUserId;
    v!.serverUserId = ctx.body.userId;
    v!.version++;
    v!.history.push(hist(ctx.user!.id, 'SERVER', { ar: `الويتر اتغير من ${userName(ctx.db, before)} لـ ${userName(ctx.db, ctx.body.userId)}`, en: 'server changed' }));
    return visitView(ctx, v!);
  },
  // Direction D14 (PD-held): reservations with deposit and no-show fee.
  'Reservation.Find': (ctx) => page(ctx.db.reservations.filter((r) => r.branchId === ctx.branchId).sort((a, b) => a.at.localeCompare(b.at)).map((r) => ({ ...r, deposit: ctx.db.deposits.find((d) => d.id === r.depositId) ?? null, tableName: ctx.db.tables.find((t) => t.id === r.tableId)?.name ?? null })), ctx.query),
  'Reservation.Create': (ctx) => {
    requireFields(ctx, 'customer', 'phone', 'partySize', 'at');
    const branchId = requireBranch(ctx);
    if (ctx.body.tableId) getTable(ctx, ctx.body.tableId);
    const r = { id: nextId('resv'), branchId, customer: ctx.body.customer, phone: ctx.body.phone, partySize: Number(ctx.body.partySize), at: ctx.body.at, tableId: ctx.body.tableId ?? null, depositId: ctx.body.depositId ?? null, noShowFee: m4(ctx.body.noShowFee ?? '0'), state: 'BOOKED' as const, createdAt: ctx.nowIso, visitId: null };
    ctx.db.reservations.push(r);
    return r;
  },
  'Reservation.MarkNoShow': (ctx) => {
    const r = ctx.db.reservations.find((x) => x.id === ctx.params.reservationId && x.branchId === ctx.branchId);
    need(r, 'VALIDATION_FAILED', { reason: 'reservation not found' });
    need(r!.state === 'BOOKED', 'VALIDATION_FAILED', { reason: 'not booked' });
    r!.state = 'NO_SHOW';
    const d = ctx.db.deposits.find((x) => x.id === r!.depositId);
    if (d && d.state === 'HELD') d.state = 'FORFEITED'; // the no-show fee keeps the deposit (liability → income) — expert question
    return r;
  },
  'Reservation.Seat': (ctx) => {
    const r = ctx.db.reservations.find((x) => x.id === ctx.params.reservationId && x.branchId === ctx.branchId);
    need(r && r.state === 'BOOKED', 'VALIDATION_FAILED', { reason: 'not booked' });
    return r;
  },
};

export function closeVisit(ctx: Ctx, v: TableVisit, how: 'MANUAL' | 'AUTO') {
  v.state = 'CLOSED';
  v.closedAt = ctx.nowIso;
  v.version++;
  v.history.push(hist(ctx.user?.id ?? 'system', how === 'AUTO' ? 'AUTO_CLOSED' : 'CLOSED', how === 'AUTO' ? { ar: 'الترابيزة فضيت لوحدها بعد آخر شيك (VisitAutoClosePolicy)', en: 'auto-closed after last check' } : { ar: 'الويتر قفل الترابيزة', en: 'closed by waiter' }));
  event('TableVisitClosed', v.id, how);
}
