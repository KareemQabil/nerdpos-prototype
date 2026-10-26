import { ApiError } from '../errors';
import type { Handler } from '../kernel';
import { nextId, event } from '../store';
import { policy } from '../policies';
import { runOutbox, routeLines } from '../outbox';
import { checkVersion, getOrder, need, page, requireBranch, requireFields } from './util';
import type { KitchenState } from '../types';

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
    const items = ctx.db.tickets
      .filter((t) => (!ctx.query.stationId || t.stationId === ctx.query.stationId) && (!ctx.query.lifecycle || ctx.query.lifecycle.split(',').includes(t.state)))
      .filter((t) => ctx.db.stations.find((s) => s.id === t.stationId)?.branchId === ctx.branchId)
      .sort((a, b) => a.createdAtMs - b.createdAtMs)
      .map((t) => { const age = Math.floor((ctx.now - t.createdAtMs) / 60000); return { ...t, ageMinutes: age, late: age >= kt.alertMinutes, warn: age >= kt.targetMinutes, stationName: ctx.db.stations.find((s) => s.id === t.stationId)?.name }; });
    return { ...page(items, ctx.query), timing: kt };
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
    if (t!.state !== 'DONE' && t!.state !== 'READY') throw new ApiError('KITCHEN_TRANSITION_INVALID');
    t!.state = 'IN_PROGRESS';
    t!.version++;
    return t;
  },
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
