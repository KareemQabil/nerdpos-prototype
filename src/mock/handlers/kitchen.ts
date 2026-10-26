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
    const doneWithin = Number(ctx.query.doneWithinMinutes ?? 0);
    const merged = new Set((ctx.db.ticketMeta ?? []).filter((m) => m.transferredFrom === 'MERGED').map((m) => m.ticketId));
    const items = ctx.db.tickets
      .filter((t) => !merged.has(t.id) && (!ctx.query.stationId || t.stationId === ctx.query.stationId) && (!states || states.includes(t.state)))
      .filter((t) => !doneWithin || t.state !== 'DONE' || (t.doneAt && ctx.now - Date.parse(t.doneAt) <= doneWithin * 60000))
      .filter((t) => ctx.db.stations.find((s) => s.id === t.stationId)?.branchId === ctx.branchId)
      .map((t) => ticketView(ctx, t, kt))
      .sort((a, b) => (a.priority === 'RUSH' ? 0 : 1) - (b.priority === 'RUSH' ? 0 : 1) || a.createdAtMs - b.createdAtMs);
    return { ...page(items, ctx.query), timing: kt, refireReasons: REFIRE_REASONS };
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
    (it as any).bumped = !(it as any).bumped;
    t!.version++;
    if (t!.items.every((i) => i.status === 'CANCELLED' || (i as any).bumped)) { t!.state = 'READY'; t!.readyAt = ctx.nowIso; }
    return t;
  },
  'Ticket.Recall': (ctx) => {
    const t = ctx.db.tickets.find((x) => x.id === ctx.params.ticketId);
    need(t, 'KITCHEN_TICKET_NOT_FOUND');
    if (ctx.body?.expectedVersion !== undefined) checkVersion(t!, ctx.body.expectedVersion);
    if (t!.state !== 'DONE' && t!.state !== 'READY') throw new ApiError('KITCHEN_TRANSITION_INVALID', { from: t!.state, to: 'IN_PROGRESS' });
    const from = t!.state;
    t!.state = 'IN_PROGRESS'; t!.readyAt = null; t!.doneAt = null;
    t!.version++;
    const m = metaOf(ctx, t!.id);
    m.recalledAt = ctx.nowIso;
    m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `اترجعت للشغل (كانت ${from === 'DONE' ? 'اتسلمت' : 'جاهزة'})`, en: `recalled from ${from}` } });
    event('KitchenTicketRecalled', t!.orderId, `${t!.orderNumber} r${t!.round}`);
    return ticketView(ctx, t!);
  },
  ...kdsHandlers(),
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
  BURNT: { ar: 'اتحرق / مش مستوي صح', en: 'Burnt / wrongly cooked' },
  WRONG_ITEM: { ar: 'اتعمل غلط', en: 'Made wrong' },
  DROPPED: { ar: 'وقع', en: 'Dropped' },
  CUSTOMER_RETURNED: { ar: 'الزبون رجّعه', en: 'Customer sent it back' },
  COLD: { ar: 'وصل بارد', en: 'Arrived cold' },
  OTHER: { ar: 'سبب تاني', en: 'Other' },
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
  const target = st?.targetMinutes ?? timing.targetMinutes;
  const alert = Math.max(target, timing.alertMinutes);
  const end = t.readyAt ? Date.parse(t.readyAt) : clock.now();
  const age = Math.max(0, Math.floor((end - t.createdAtMs) / 60000));
  const m = (ctx.db.ticketMeta ?? []).find((x) => x.ticketId === t.id);
  const order = ctx.db.orders.find((o) => o.id === t.orderId);
  const visit = order?.visitId ? ctx.db.visits.find((v) => v.id === order.visitId) : null;
  const siblings = ctx.db.tickets.filter((x) => x.orderId === t.orderId && x.round === t.round && x.id !== t.id && !(ctx.db.ticketMeta ?? []).some((mm) => mm.ticketId === x.id && mm.transferredFrom === 'MERGED'));
  return {
    ...t, ageMinutes: age, targetMinutes: target, alertMinutes: alert, warn: age >= target, late: age >= alert,
    readyMinutes: t.readyAt && t.state === 'READY' ? Math.floor((clock.now() - Date.parse(t.readyAt)) / 60000) : null,
    stationName: st?.name, priority: m?.priority ?? 'NORMAL', refireOf: m?.refireOf ?? null, refireReason: m?.refireReason ?? null, refireReasonText: m?.refireReason ? REFIRE_REASONS[m.refireReason] ?? { ar: m.refireReason, en: m.refireReason } : null, refireNote: m?.refireNote ?? null,
    transferredFromName: m?.transferredFrom && m.transferredFrom !== 'MERGED' ? ctx.db.stations.find((s) => s.id === m.transferredFrom)?.name ?? null : null, recalledAt: m?.recalledAt ?? null,
    history: m?.history ?? [], guestCount: visit?.guestCount ?? order?.guestCount ?? null, customerName: order?.customerName ?? null,
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
      metaOf(ctx, t.id).history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `اتعمل تاني (${items.length} صنف)`, en: `refired (${items.length} items)` } });
      const o = ctx.db.orders.find((x) => x.id === t.orderId);
      o?.history.push(hist(ctx.user!.id, 'KITCHEN_REFIRE', { ar: `المطبخ عمل تاني: ${items.map((i) => i.name.ar).join('، ')} — ${REFIRE_REASONS[reason].ar}`, en: `kitchen refire: ${REFIRE_REASONS[reason].en}` }, { ticketId: copy.id }, ctx.terminal?.code));
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
        m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `اتنقلت لـ ${st!.name} واتضمت لتذكرتها`, en: `moved to ${st!.name} (merged)` } });
        t.state = 'DONE'; t.doneAt = ctx.nowIso; t.version++;
        return { ...ticketView(ctx, same), merged: true };
      }
      const m = metaOf(ctx, t.id);
      m.transferredFrom = t.stationId; m.transferReason = ctx.body.reason ? String(ctx.body.reason).slice(0, 120) : null;
      m.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, text: { ar: `اتنقلت من ${fromName} لـ ${st!.name}${m.transferReason ? ' — ' + m.transferReason : ''}`, en: `moved ${fromName} → ${st!.name}` } });
      t.stationId = st!.id;
      t.version++;
      event('KitchenTicketMoved', t.orderId, `${t.orderNumber} r${t.round} → ${st!.name}`);
      return ticketView(ctx, t);
    },
  };
}
