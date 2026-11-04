import { ApiError } from '../errors';
import type { Handler } from '../kernel';
import { nextId, event, hist } from '../store';
import { policy } from '../policies';
import { runOutbox, routeLines } from '../outbox';
import { checkVersion, getOrder, need, page, requireBranch, requireFields } from './util';
import type { KitchenState, KitchenTicket } from '../types';
import type { TicketMeta } from '../types-ops';
import { userName } from './util';
import { clock } from '../clock';
import type { Ctx } from '../kernel';
import { r3bOf, kdsScreenOf, branchHasDispatch, secondLangOf, secondName } from '../r3b'; // round 3: kitchen screens subscribe to stations
import { displayFor } from './devices'; // ux-14: the call board's own settings from the registry

const NEXT: Record<KitchenState, KitchenState[]> = { NEW: ['IN_PROGRESS', 'READY'], IN_PROGRESS: ['READY'], READY: ['DONE', 'IN_PROGRESS'], DONE: [] };

export const kitchenHandlers: Record<string, Handler> = {
  'KitchenStation.List': (ctx) => page(ctx.db.stations.filter((s) => s.branchId === ctx.branchId), ctx.query),
  'KitchenStation.Create': (ctx) => {
    requireFields(ctx, 'name');
    const branchId = requireBranch(ctx);
    if (ctx.db.stations.some((s) => s.branchId === branchId && s.name.toLowerCase() === String(ctx.body.name).toLowerCase())) throw new ApiError('KITCHEN_STATION_NAME_TAKEN');
    const s = { id: nextId('st'), branchId, name: String(ctx.body.name), active: true, version: 1 };
    ctx.db.stations.push(s);
    return s;
  },
  'KitchenStation.Configure': (ctx) => {
    const s = ctx.db.stations.find((x) => x.id === ctx.params.stationId && x.branchId === ctx.branchId);
    need(s, 'KITCHEN_STATION_NOT_FOUND');
    checkVersion(s!, ctx.body.expectedVersion);
    if (ctx.body.name && ctx.body.name !== s!.name && ctx.db.stations.some((x) => x.branchId === s!.branchId && x.name === ctx.body.name)) throw new ApiError('KITCHEN_STATION_NAME_TAKEN');
    Object.assign(s!, { name: ctx.body.name ?? s!.name, active: ctx.body.active ?? s!.active });
    s!.version++;
    return s;
  },
  'RoutingRule.List': (ctx) => page(ctx.db.routingRules.filter((r) => r.branchId === ctx.branchId).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)), ctx.query),
  'RoutingRule.Create': (ctx) => {
    requireFields(ctx, 'priority', 'match');
    const branchId = requireBranch(ctx);
    const dest = ctx.body.destination ?? 'STATION';
    if (dest === 'STATION') {
      const st = ctx.db.stations.find((s) => s.id === ctx.body.stationId && s.branchId === branchId);
      need(st, 'KITCHEN_STATION_NOT_FOUND');
      need(st!.active, 'KITCHEN_STATION_INACTIVE');
    }
    const r = { id: nextId('rr'), branchId, priority: Number(ctx.body.priority), match: ctx.body.match ?? {}, stationId: ctx.body.stationId ?? '', destination: dest, active: true, version: 1 };
    ctx.db.routingRules.push(r);
    return r;
  },
  'RoutingRule.Configure': (ctx) => {
    const r = ctx.db.routingRules.find((x) => x.id === ctx.params.ruleId && x.branchId === ctx.branchId);
    need(r, 'ROUTING_RULE_NOT_FOUND');
    checkVersion(r!, ctx.body.expectedVersion);
    if (ctx.body.stationId) {
      const st = ctx.db.stations.find((s) => s.id === ctx.body.stationId);
      need(st, 'KITCHEN_STATION_NOT_FOUND');
      need(st!.active, 'KITCHEN_STATION_INACTIVE');
    }
    Object.assign(r!, { priority: ctx.body.priority ?? r!.priority, match: ctx.body.match ?? r!.match, stationId: ctx.body.stationId ?? r!.stationId, active: ctx.body.active ?? r!.active, destination: ctx.body.destination ?? r!.destination });
    r!.version++;
    return r;
  },
  'Kitchen.Board': (ctx) => {
    const kt = policy<{ targetMinutes: number; alertMinutes: number }>('KitchenTimingPolicy') ?? { targetMinutes: 15, alertMinutes: 20 };
    const states = ctx.query.lifecycle ? ctx.query.lifecycle.split(',') : null;
    // round 3 (F3-02): a kitchen screen shows only the stations it subscribes to; the office PC / back office see all
    const screen = screenView(ctx);
    const mine = screen.stationIds.length ? new Set(screen.stationIds) : null;
    const doneWithin = Number(ctx.query.doneWithinMinutes ?? 0);
    const merged = new Set((ctx.db.ticketMeta ?? []).filter((m) => m.transferredFrom === 'MERGED').map((m) => m.ticketId));
    const items = ctx.db.tickets
      .filter((t) => !merged.has(t.id) && (!ctx.query.stationId || t.stationId === ctx.query.stationId) && (!mine || ctx.query.allStations === 'true' || mine.has(t.stationId) || (screen.dispatch && screen.isKds)) && (!states || states.includes(t.state)))
      .filter((t) => !doneWithin || t.state !== 'DONE' || (t.doneAt && ctx.now - Date.parse(t.doneAt) <= doneWithin * 60000))
      .filter((t) => ctx.db.stations.find((s) => s.id === t.stationId)?.branchId === ctx.branchId)
      .map((t) => withScreenTiming({ ...ticketView(ctx, t, kt), onMyScreen: !mine || mine.has(t.stationId) }, screen)) // a dispatch screen also sees the other stations' tickets (consolidated hand-off)
      .sort((a, b) => (a.priority === 'RUSH' ? 0 : 1) - (b.priority === 'RUSH' ? 0 : 1) || a.createdAtMs - b.createdAtMs);
    return { ...page(items, ctx.query), timing: screen.warnMinutes && screen.lateMinutes ? { targetMinutes: screen.warnMinutes, alertMinutes: screen.lateMinutes, fromScreen: true } : kt, refireReasons: REFIRE_REASONS, screen };
  },
  // ───────── round 3: kitchen screens (F3-02, F2-06, E04–E06)
  'KdsScreen.List': (ctx) => ({ items: ctx.db.terminals.filter((t) => t.kind === 'KDS' && t.branchId === ctx.branchId && t.lifecycle === 'ACTIVE').map((t) => ({ ...screenView(ctx, t.id), terminalName: t.name, terminalCode: t.code })), hasDispatch: branchHasDispatch(ctx.db, ctx.branchId) }),
  'KdsScreen.Configure': (ctx) => {
    const term = ctx.db.terminals.find((t) => t.id === ctx.params.terminalId && t.branchId === ctx.branchId);
    need(term, 'ORGANIZATION_TERMINAL_NOT_FOUND');
    need(term!.kind === 'KDS', 'VALIDATION_FAILED', { field: 'terminalId', rule: 'a kitchen screen (KDS terminal)' });
    const ids: string[] = Array.isArray(ctx.body.stationIds) ? [...new Set<string>(ctx.body.stationIds.map(String))] : [];
    for (const id of ids) { const st = ctx.db.stations.find((x) => x.id === id && x.branchId === ctx.branchId); need(st, 'KITCHEN_STATION_NOT_FOUND', { stationId: id }); }
    const start = String(ctx.body.start ?? 'HIDDEN');
    need(['HIDDEN', 'OPTIONAL', 'REQUIRED'].includes(start), 'VALIDATION_FAILED', { field: 'start', rule: 'HIDDEN | OPTIONAL | REQUIRED' });
    // ux-04 extension: the screen's own timer colours and per-item bump
    const mins = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v));
    const warn = mins(ctx.body.warnMinutes), late = mins(ctx.body.lateMinutes);
    need((warn === null) === (late === null), 'VALIDATION_FAILED', { field: 'warnMinutes', rule: 'warnMinutes and lateMinutes are set together' });
    if (warn !== null && late !== null) {
      need(Number.isInteger(warn) && warn >= 1 && warn <= 120, 'VALIDATION_FAILED', { field: 'warnMinutes', rule: '1–120 whole minutes' });
      need(Number.isInteger(late) && late > warn && late <= 180, 'VALIDATION_FAILED', { field: 'lateMinutes', rule: 'whole minutes, more than warnMinutes, at most 180' });
    }
    const list = r3bOf(ctx.db).kdsScreens;
    let c = list.find((x) => x.terminalId === term!.id);
    if (c && ctx.body.expectedVersion !== undefined) checkVersion(c, ctx.body.expectedVersion);
    const before = c ? { ...c } : null;
    if (!c) { c = { terminalId: term!.id, stationIds: [], dispatch: true, start: 'HIDDEN', version: 0, updatedAt: '', updatedBy: '' }; list.push(c); }
    Object.assign(c, { stationIds: ids, dispatch: ctx.body.dispatch !== false, start, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
    if (ctx.body.warnMinutes !== undefined || ctx.body.lateMinutes !== undefined) Object.assign(c, { warnMinutes: warn, lateMinutes: late });
    if (ctx.body.itemBump !== undefined) c.itemBump = ctx.body.itemBump !== false;
    c.version++;
    const names = ids.map((id) => ctx.db.stations.find((x) => x.id === id)?.name).join(', ') || 'ALL';
    ctx.audit(`kitchen screen ${term!.code}: stations ${names}; dispatch ${c.dispatch}; start ${c.start}; timer ${c.warnMinutes ?? '-'}/${c.lateMinutes ?? '-'}; item bump ${c.itemBump !== false}${before ? ` (was ${before.stationIds.length || 'ALL'} / ${before.dispatch} / ${before.start})` : ''}`, term!.id);
    event('KdsScreenConfigured', term!.id, `${term!.code} → ${names}`);
    return screenView(ctx, term!.id);
  },
  'KitchenTicket.Get': (ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    return t;
  },
  'Kitchen.AdvanceTicket': (ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    checkVersion(t!, ctx.body.expectedVersion);
    const to = ctx.body.toState as KitchenState;
    if (!NEXT[t!.state].includes(to)) throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t!.state, to });
    // round 3: hand-off only from a dispatch screen (when the branch has one); "Start" first only where the screen requires it
    const scr = screenView(ctx);
    if (to === 'DONE' && !scr.canHandOff) throw new ApiError('KDS_DISPATCH_ONLY', { terminal: ctx.terminal?.code ?? null });
    if (to === 'READY' && t!.state === 'NEW' && scr.start === 'REQUIRED') throw new ApiError('KDS_START_REQUIRED', { terminal: ctx.terminal?.code ?? null });
    if (t!.state === 'READY' && to === 'IN_PROGRESS') { t!.readyAt = null; uncall(ctx, t!); }
    t!.state = to;
    if (to === 'IN_PROGRESS' && !t!.startedAt) t!.startedAt = ctx.nowIso;
    if (to === 'READY') t!.readyAt = ctx.nowIso;
    if (to === 'DONE') t!.doneAt = ctx.nowIso;
    t!.version++;
    event('KitchenTicketAdvanced', t!.orderId, `${t!.orderNumber} r${t!.round} → ${to}`);
    return { ticket: t, state: to };
  },
  'TicketItem.Bump': (ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    const it = t!.items.find((i) => i.lineId === ctx.params.itemId);
    need(it, 'KITCHEN_ITEM_PROGRESS_NOT_FOUND');
    const scr = screenView(ctx);
    if (!scr.itemBump) throw new ApiError('VALIDATION_FAILED', { field: 'itemId', rule: 'this kitchen screen bumps whole tickets only' });
    if (t!.state === 'DONE') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t!.state, rule: 'a handed-off ticket is recalled first' });
    if (it!.status === 'CANCELLED') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: 'CANCELLED', rule: 'a voided item is not cooked' });
    (it as any).bumped = !(it as any).bumped;
    if (t!.state === 'NEW' && scr.start === 'REQUIRED') { t!.state = 'IN_PROGRESS'; t!.startedAt = t!.startedAt ?? ctx.nowIso; } // working an item counts as starting
    t!.version++;
    if (t!.items.every((i) => i.status === 'CANCELLED' || (i as any).bumped)) { t!.state = 'READY'; t!.readyAt = ctx.nowIso; }
    else if (t!.state === 'READY' && !(it as any).bumped) { t!.state = 'IN_PROGRESS'; t!.readyAt = null; uncall(ctx, t!); } // undoing an item puts the ticket back to cooking (and off «جاهز»)
    return t;
  },
  'Ticket.Recall': (ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    if (ctx.body?.expectedVersion !== undefined) checkVersion(t!, ctx.body.expectedVersion);
    if (t!.state !== 'DONE' && t!.state !== 'READY') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t!.state, to: 'IN_PROGRESS' });
    // ux-04 extension: undo of a hand-off a moment ago — the ticket goes back to «ready for hand-off», not to cooking
    if (ctx.body?.undo === true) {
      if (t!.state !== 'DONE' || !t!.doneAt || ctx.now - Date.parse(t!.doneAt) > UNDO_WINDOW_MS) throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t!.state, to: 'READY', rule: `undo only within ${UNDO_WINDOW_MS / 1000} s of the hand-off` });
      if (!screenView(ctx).canHandOff) throw new ApiError('KDS_DISPATCH_ONLY', { terminal: ctx.terminal?.code ?? null });
      t!.state = 'READY'; t!.doneAt = null; t!.version++;
      metaOf(ctx, t!.id).history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: 'تراجع عن التسليم', en: 'hand-off undone' } });
      event('KitchenTicketHandOffUndone', t!.orderId, `${t!.orderNumber} r${t!.round}`);
      return ticketView(ctx, t!);
    }
    const from = t!.state;
    t!.state = 'IN_PROGRESS'; t!.readyAt = null; t!.doneAt = null;
    t!.version++;
    uncall(ctx, t!);
    const m = metaOf(ctx, t!.id);
    m.recalledAt = ctx.nowIso;
    m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `اترجعت للشغل (كانت ${from === 'DONE' ? 'اتسلمت' : 'جاهزة'})`, en: `recalled from ${from}` } });
    event('KitchenTicketRecalled', t!.orderId, `${t!.orderNumber} r${t!.round}`);
    return ticketView(ctx, t!);
  },
  ...kdsHandlers(),
  ...callBoardHandlers(),
  'Kitchen.OrderFulfillment': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    return {
      orderId: o.id,
      rounds: o.rounds.map((r) => {
        const d = ctx.db.kitchenDeliveries.find((x) => x.orderId === o.id && x.round === r.round);
        const tickets = ctx.db.tickets.filter((t) => t.orderId === o.id && t.round === r.round);
        const { byStation, suppressed } = routeLines(ctx.db, o, r.lineIds);
        return { round: r.round, firedAt: r.firedAt, via: r.via, status: d?.state === 'DELIVERED' ? 'SENT' : d?.state ?? 'PENDING', routedAt: d?.deliveredAt ?? null, attempts: d?.attempts ?? 0, lastError: d?.lastError ?? null, expectedStations: [...byStation.keys()].map((id) => ctx.db.stations.find((s) => s.id === id)?.name), suppressed, tickets: tickets.map((t) => ({ id: t.id, station: ctx.db.stations.find((s) => s.id === t.stationId)?.name, state: t.state })) };
      }),
    };
  },
  // E-38: re-send only FAILED/PENDING rounds; never duplicates a ticket (dedupe by order+round+station).
  'Kitchen.Resend': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    const failed = ctx.db.kitchenDeliveries.filter((d) => d.orderId === o.id && d.state !== 'DELIVERED');
    if (!failed.length) throw new ApiError('VALIDATION_FAILED', { rule: 'nothing to re-send: every round reached the kitchen' });
    for (const d of failed) { d.state = 'PENDING'; d.nextAt = 0; }
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'KITCHEN_RESEND', text: { ar: `إعادة إرسال للمطبخ: جولات ${failed.map((d) => d.round).join('، ')}`, en: `kitchen re-send rounds ${failed.map((d) => d.round).join(', ')}` } });
    queueMicrotask(() => runOutbox());
    return { orderId: o.id, resent: failed.map((d) => d.round) };
  },
};

// ───────── KDS actions (direction, PD-held in canonical): rush, refire with a reason, move to another station
export const REFIRE_REASONS: Record<string, { ar: string; en: string }> = {
  BURNT: { ar: 'محترق / غير مطهو جيدًا', en: 'Burnt / wrongly cooked' },
  WRONG_ITEM: { ar: 'حُضّر خطأً', en: 'Made wrong' },
  DROPPED: { ar: 'وقع', en: 'Dropped' },
  CUSTOMER_RETURNED: { ar: 'أعاده العميل', en: 'Customer sent it back' },
  COLD: { ar: 'وصل بارد', en: 'Arrived cold' },
  OTHER: { ar: 'سبب آخر', en: 'Other' },
};

function metaOf(ctx: Ctx, ticketId: string): TicketMeta {
  const list = (ctx.db.ticketMeta ??= []);
  let m = list.find((x) => x.ticketId === ticketId);
  if (!m) { m = { ticketId, priority: 'NORMAL', history: [] }; list.push(m); }
  return m;
}

function ticketView(ctx: Ctx, t: KitchenTicket, kt?: { targetMinutes: number; alertMinutes: number }) {
  const timing = kt ?? policy<{ targetMinutes: number; alertMinutes: number }>('KitchenTimingPolicy') ?? { targetMinutes: 15, alertMinutes: 20 };
  const st = ctx.db.stations.find((s) => s.id === t.stationId);
  // ux-07: one timing source — the venue default (KitchenTimingPolicy); a kitchen screen's own colours override it on
  // that screen (withScreenTiming). Per-station targets are gone (they had no editor and contradicted both).
  const target = timing.targetMinutes;
  const alert = Math.max(target, timing.alertMinutes);
  const end = t.readyAt ? Date.parse(t.readyAt) : clock.now();
  const age = Math.max(0, Math.floor((end - t.createdAtMs) / 60000));
  const m = (ctx.db.ticketMeta ?? []).find((x) => x.ticketId === t.id);
  const order = ctx.db.orders.find((o) => o.id === t.orderId);
  const visit = order?.visitId ? ctx.db.visits.find((v) => v.id === order.visitId) : null;
  const siblings = ctx.db.tickets.filter((x) => x.orderId === t.orderId && x.round === t.round && x.id !== t.id && !(ctx.db.ticketMeta ?? []).some((mm) => mm.ticketId === x.id && mm.transferredFrom === 'MERGED'));
  const lang2 = secondLangOf(order?.branchId).kitchen;
  return {
    ...t, ageMinutes: age, targetMinutes: target, alertMinutes: alert, warn: age >= target, late: age >= alert,
    // round 3: short call-out number (the transaction number stays), time waited before "start" (start never resets the timer), second-language names
    shortNo: order?.shortNo ?? null, waitBeforeStartMinutes: t.startedAt ? Math.max(0, Math.floor((Date.parse(t.startedAt) - t.createdAtMs) / 60000)) : null,
    items: lang2 ? t.items.map((i) => ({ ...i, name2: secondName(i.name) })) : t.items,
    readyMinutes: t.readyAt && t.state === 'READY' ? Math.floor((clock.now() - Date.parse(t.readyAt)) / 60000) : null,
    stationName: st?.name, priority: m?.priority ?? 'NORMAL', refireOf: m?.refireOf ?? null, refireReason: m?.refireReason ?? null, refireReasonText: m?.refireReason ? REFIRE_REASONS[m.refireReason] ?? { ar: m.refireReason, en: m.refireReason } : null, refireNote: m?.refireNote ?? null,
    transferredFromName: m?.transferredFrom && m.transferredFrom !== 'MERGED' ? ctx.db.stations.find((s) => s.id === m.transferredFrom)?.name ?? null : null, recalledAt: m?.recalledAt ?? null,
    history: m?.history ?? [], guestCount: visit?.guestCount ?? order?.guestCount ?? null, customerName: order?.customerName ?? null,
    calledAt: m?.calledAt ?? null, orderLabel: order?.label ?? null, orderKind: order?.kind ?? null, callable: callableOrder(order),
    siblings: siblings.map((x) => ({ id: x.id, stationId: x.stationId, stationName: ctx.db.stations.find((s) => s.id === x.stationId)?.name, state: x.state })),
  };
}

function kdsHandlers(): Record<string, Handler> {
  const getT = (ctx: Ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId && ctx.db.stations.find((s) => s.id === x.stationId)?.branchId === ctx.branchId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    return t!;
  };
  return {
    'Ticket.SetPriority': (ctx) => {
      const t = getT(ctx);
      checkVersion(t, ctx.body.expectedVersion);
      const p = ctx.body.priority;
      need(p === 'RUSH' || p === 'NORMAL', 'VALIDATION_FAILED', { field: 'priority', rule: 'RUSH | NORMAL' });
      if (t.state === 'DONE') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t.state, rule: 'a delivered ticket has no priority' });
      const m = metaOf(ctx, t.id);
      m.priority = p; m.priorityAt = ctx.nowIso; m.priorityBy = ctx.user!.id;
      m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: p === 'RUSH' ? { ar: `${userName(ctx.db, ctx.user!.id)} خلاها مستعجلة`, en: 'marked rush' } : { ar: 'رجعت عادية', en: 'back to normal' } });
      t.version++;
      return ticketView(ctx, t);
    },
    'Ticket.Refire': (ctx) => {
      const t = getT(ctx);
      if (ctx.body.expectedVersion !== undefined) checkVersion(t, ctx.body.expectedVersion);
      if (t.state !== 'READY' && t.state !== 'DONE') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t.state, rule: 'only a ready or delivered ticket is made again' });
      const reason = String(ctx.body.reason ?? '');
      need(REFIRE_REASONS[reason], 'VALIDATION_FAILED', { field: 'reason', rule: Object.keys(REFIRE_REASONS).join('|') });
      if (reason === 'OTHER') need(String(ctx.body.note ?? '').trim(), 'REASON_REQUIRED', { field: 'note' });
      const ids: string[] = Array.isArray(ctx.body.itemLineIds) && ctx.body.itemLineIds.length ? ctx.body.itemLineIds : t.items.filter((i) => i.status === 'ACTIVE').map((i) => i.lineId);
      const items = t.items.filter((i) => ids.includes(i.lineId) && i.status === 'ACTIVE');
      need(items.length, 'VALIDATION_FAILED', { field: 'itemLineIds', rule: 'at least one active item of the ticket' });
      const stationId = ctx.body.stationId ?? t.stationId;
      const st = ctx.db.stations.find((s) => s.id === stationId && s.branchId === ctx.branchId);
      need(st, 'KITCHEN_STATION_NOT_FOUND');
      need(st!.active, 'KITCHEN_STATION_INACTIVE');
      const copy: KitchenTicket = { ...structuredClone(t), id: nextId('kt'), stationId, state: 'NEW', items: structuredClone(items).map((i) => ({ ...i, bumped: false } as any)), createdAt: ctx.nowIso, createdAtMs: ctx.now, startedAt: null, readyAt: null, doneAt: null, version: 1 };
      ctx.db.tickets.push(copy);
      const m = metaOf(ctx, copy.id);
      Object.assign(m, { priority: 'RUSH', refireOf: t.id, refireReason: reason, refireNote: ctx.body.note ? String(ctx.body.note).slice(0, 120) : null });
      m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `إعادة عمل: ${REFIRE_REASONS[reason].ar}`, en: `refire: ${REFIRE_REASONS[reason].en}` } });
      metaOf(ctx, t.id).history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `أُعيد تحضيره (${items.length} صنف)`, en: `refired (${items.length} items)` } });
      const o = ctx.db.orders.find((x) => x.id === t.orderId);
      o?.history.push(hist(ctx.user!.id, 'KITCHEN_REFIRE', { ar: `أعاد المطبخ تحضير: ${items.map((i) => i.name.ar).join('، ')} — ${REFIRE_REASONS[reason].ar}`, en: `kitchen refire: ${REFIRE_REASONS[reason].en}` }, { ticketId: copy.id }, ctx.terminal?.code));
      event('KitchenRefire', t.orderId, `${t.orderNumber} r${t.round} ${reason}`);
      ctx.audit(`refire ${t.orderNumber} r${t.round}: ${reason}`, copy.id, true);
      return { status: 201, body: ticketView(ctx, copy) };
    },
    'Ticket.TransferStation': (ctx) => {
      const t = getT(ctx);
      checkVersion(t, ctx.body.expectedVersion);
      if (t.state === 'DONE') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t.state, rule: 'a delivered ticket stays where it was' });
      const st = ctx.db.stations.find((s) => s.id === ctx.body.toStationId && s.branchId === ctx.branchId);
      need(st, 'KITCHEN_STATION_NOT_FOUND');
      need(st!.active, 'KITCHEN_STATION_INACTIVE');
      need(st!.id !== t.stationId, 'VALIDATION_FAILED', { field: 'toStationId', rule: 'already on this station' });
      const fromName = ctx.db.stations.find((s) => s.id === t.stationId)?.name ?? '';
      const same = ctx.db.tickets.find((x) => x.orderId === t.orderId && x.round === t.round && x.stationId === st!.id && x.state !== 'DONE' && !(ctx.db.ticketMeta ?? []).some((m) => m.ticketId === x.id && m.refireOf));
      if (same) {
        // one ticket per (order, round, station): the items join the ticket already there
        same.items.push(...structuredClone(t.items));
        same.version++;
        metaOf(ctx, same.id).history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `انضم لها ${t.items.length} صنف من ${fromName}`, en: `merged ${t.items.length} items from ${fromName}` } });
        const m = metaOf(ctx, t.id);
        m.transferredFrom = 'MERGED';
        m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `نُقلت إلى ${st!.name} وضُمّت إلى تذكرتها`, en: `moved to ${st!.name} (merged)` } });
        t.state = 'DONE'; t.doneAt = ctx.nowIso; t.version++;
        return { ...ticketView(ctx, same), merged: true };
      }
      const m = metaOf(ctx, t.id);
      m.transferredFrom = t.stationId; m.transferReason = ctx.body.reason ? String(ctx.body.reason).slice(0, 120) : null;
      m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `نُقلت من ${fromName} إلى ${st!.name}${m.transferReason ? ' — ' + m.transferReason : ''}`, en: `moved ${fromName} → ${st!.name}` } });
      t.stationId = st!.id;
      t.version++;
      event('KitchenTicketMoved', t.orderId, `${t.orderNumber} r${t.round} → ${st!.name}`);
      return ticketView(ctx, t);
    },
  };
}

/** The kitchen screen of the calling device, with plain station names and whether it may hand off (round 3). */
function screenView(ctx: Ctx, terminalId?: string) {
  const tid = terminalId ?? ctx.terminal?.id ?? null;
  const term = tid ? ctx.db.terminals.find((t) => t.id === tid) : null;
  const isKds = term?.kind === 'KDS';
  const c = isKds ? kdsScreenOf(ctx.db, tid) : { ...kdsScreenOf(ctx.db, null), configured: false };
  const stationIds = c.stationIds.filter((id) => ctx.db.stations.some((s) => s.id === id && s.active));
  const hasDispatch = branchHasDispatch(ctx.db, term?.branchId ?? ctx.branchId);
  return {
    terminalId: tid, isKds, configured: c.configured, stationIds, stationNames: stationIds.map((id) => ctx.db.stations.find((s) => s.id === id)?.name ?? id),
    dispatch: c.dispatch, start: c.start, version: c.version, updatedAt: c.updatedAt || null,
    warnMinutes: c.warnMinutes ?? null, lateMinutes: c.lateMinutes ?? null, itemBump: c.itemBump !== false,
    canHandOff: !isKds || c.dispatch || !hasDispatch, hasDispatch,
  };
}

const UNDO_WINDOW_MS = 120_000;

/** ux-04: a screen with its own timer colours re-tones every ticket (green < warn ≤ amber < late ≤ red). */
function withScreenTiming<T extends { ageMinutes: number; warn: boolean; late: boolean; targetMinutes: number; alertMinutes: number }>(x: T, screen: { warnMinutes: number | null; lateMinutes: number | null }): T {
  if (!screen.warnMinutes || !screen.lateMinutes) return x;
  return { ...x, targetMinutes: screen.warnMinutes, alertMinutes: screen.lateMinutes, warn: x.ageMinutes >= screen.warnMinutes, late: x.ageMinutes >= screen.lateMinutes };
}

// ───────── ux-04: calling an order's number to the call board, and the call board itself
// ux-12c: one rule for which orders are called by number (CallBoardPolicy), a call that belongs to the food it
// announced (a ticket that goes back to the kitchen — recall, item undo — loses its call; a refire or a new round
// starts uncalled), and voided food that nobody waits for.
interface CallBoardSettings { readyMinutes: number; call: 'MANUAL' | 'AUTO'; delivery: boolean }
export const CALL_BOARD_DEFAULT: CallBoardSettings = { readyMinutes: 10, call: 'MANUAL', delivery: false };
function callBoardPolicy(branchId?: string | null): CallBoardSettings {
  const v = policy<Partial<CallBoardSettings>>('CallBoardPolicy', branchId ? { branchId } : {}) ?? {};
  const mins = Math.max(1, Math.min(120, Number(v.readyMinutes ?? CALL_BOARD_DEFAULT.readyMinutes) || CALL_BOARD_DEFAULT.readyMinutes));
  return { readyMinutes: mins, call: v.call === 'AUTO' ? 'AUTO' : 'MANUAL', delivery: v.delivery === true };
}
/** Orders collected by number (no table): takeaway, counter dine-in and — when CallBoardPolicy.delivery — delivery.
 *  Never a table check, a staff meal or a voided / cancelled check. */
function callableOrder(o: { tableId?: string | null; visitId?: string | null; kind?: string; status?: string; channel?: string; branchId?: string } | undefined): boolean {
  if (!o || o.tableId || o.visitId || o.kind === 'STAFF_MEAL' || o.status === 'VOIDED' || o.status === 'CANCELLED') return false;
  return o.channel !== 'DELIVERY' || callBoardPolicy(o.branchId).delivery;
}
/** A ticket the guest still waits for: not handed off, not merged into another, with at least one item not voided. */
function waitingTickets(ctx: Ctx, orderId: string): KitchenTicket[] {
  const merged = new Set((ctx.db.ticketMeta ?? []).filter((m) => m.transferredFrom === 'MERGED').map((m) => m.ticketId));
  return ctx.db.tickets.filter((t) => t.orderId === orderId && !merged.has(t.id) && t.state !== 'DONE' && t.items.some((i) => i.status !== 'CANCELLED'));
}
const calledAtOf = (ctx: Ctx, t: KitchenTicket) => (ctx.db.ticketMeta ?? []).find((m) => m.ticketId === t.id)?.calledAt ?? null;
/** The food went back to the kitchen: its number is no longer «جاهز» until it is called again. */
function uncall(ctx: Ctx, t: KitchenTicket) {
  const m = (ctx.db.ticketMeta ?? []).find((x) => x.ticketId === t.id);
  if (!m?.calledAt) return;
  m.calledAt = null;
  m.history.unshift({ at: ctx.nowIso, by: ctx.user?.id ?? 'system', text: { ar: 'رُفع الرقم من «جاهز» في شاشة النداء', en: 'number taken off «ready» on the call board' } });
}

function callBoardHandlers(): Record<string, Handler> {
  return {
    /** The dispatch screen calls the order's number: it moves to «جاهز» on the call board (again = call it once more). */
    'Kitchen.CallOrder': (ctx) => {
      const o = ctx.db.orders.find((x) => x.id === ctx.params.orderId && x.branchId === ctx.branchId);
      need(o, 'ORDER_NOT_FOUND');
      if (!screenView(ctx).canHandOff) throw new ApiError('KDS_DISPATCH_ONLY', { terminal: ctx.terminal?.code ?? null });
      if (!callableOrder(o)) throw new ApiError('KITCHEN_ORDER_NOT_CALLABLE', { orderId: o!.id, channel: o!.channel, status: o!.status, table: !!(o!.tableId || o!.visitId) }, 409);
      const open = waitingTickets(ctx, o!.id);
      need(open.length, 'VALIDATION_FAILED', { field: 'orderId', rule: 'the order has no ticket waiting for hand-off' });
      if (open.some((t) => t.state !== 'READY') && ctx.body?.force !== true) throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: 'IN_PROGRESS', to: 'CALLED', rule: 'every station of the order is ready first', waiting: open.filter((t) => t.state !== 'READY').map((t) => ({ round: t.round, station: ctx.db.stations.find((s) => s.id === t.stationId)?.name ?? t.stationId })) });
      const again = open.every((t) => calledAtOf(ctx, t));
      for (const t of open) {
        const m = metaOf(ctx, t.id);
        m.calledAt = ctx.nowIso; m.calledBy = ctx.user!.id;
        m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: again ? { ar: 'أعيد النداء على الرقم', en: 'number called again' } : { ar: 'نودي على الرقم في شاشة النداء', en: 'number called on the call board' } });
        t.version++;
      }
      event('OrderCalled', o!.id, `${o!.number}${o!.shortNo ? ' #' + o!.shortNo : ''}${again ? ' (again)' : ''}`);
      return { orderId: o!.id, number: o!.number, shortNo: o!.shortNo ?? null, calledAt: ctx.nowIso, again };
    },
    /** What the call board shows: numbers being prepared and numbers called (ready). A number is «جاهز» only while every
     *  ticket the guest waits for carries the call (or, in AUTO, is ready); it leaves «جاهز» when the order is handed
     *  off or CallBoardPolicy.readyMinutes after the call. Only orders collected by number are shown. */
    'CallBoard.View': (ctx) => {
      const pol = callBoardPolicy(ctx.branchId);
      // ux-14: a registered call board reads its own settings (look, branding) from the server; a disabled one shows nothing
      const display = ctx.query.displayId ? displayFor(ctx, ctx.query.displayId, 'CALL_BOARD') : null;
      if (display && !display.enabled) return { preparing: [], ready: [], readyMinutes: pol.readyMinutes, auto: pol.call === 'AUTO', delivery: pol.delivery, display: { ...display, playlist: undefined }, at: ctx.nowIso };
      const auto = pol.call === 'AUTO';
      const orderIds = new Set(ctx.db.tickets.filter((t) => t.state !== 'DONE' && ctx.db.stations.find((s) => s.id === t.stationId)?.branchId === ctx.branchId).map((t) => t.orderId));
      const preparing: any[] = [], ready: any[] = [];
      for (const orderId of orderIds) {
        const o = ctx.db.orders.find((x) => x.id === orderId);
        if (!callableOrder(o)) continue;
        const open = waitingTickets(ctx, orderId);
        if (!open.length) continue; // handed off (or only voided food left): gone from the board
        const calls = open.map((t) => calledAtOf(ctx, t));
        const calledAt = calls.every(Boolean) ? (calls as string[]).sort().pop()! : null;
        const allReady = open.every((t) => t.state === 'READY');
        const readyAt = allReady ? open.map((t) => t.readyAt).filter(Boolean).sort().pop() ?? null : null;
        const since = calledAt ?? (auto && allReady ? readyAt : null);
        const no = o!.shortNo ?? o!.number;
        if (since) {
          const mins = Math.floor((ctx.now - Date.parse(since)) / 60000);
          if (mins < pol.readyMinutes) ready.push({ orderId, no, short: !!o!.shortNo, calledAt: since, minutes: mins });
          continue; // called longer ago than readyMinutes: off the board
        }
        preparing.push({ orderId, no, short: !!o!.shortNo, since: open.map((t) => t.createdAt).sort()[0] });
      }
      preparing.sort((a, b) => a.since.localeCompare(b.since));
      ready.sort((a, b) => b.calledAt.localeCompare(a.calledAt));
      return { preparing, ready, readyMinutes: pol.readyMinutes, auto, delivery: pol.delivery, display: display ? { ...display, playlist: undefined } : null, at: ctx.nowIso };
    },
  };
}
