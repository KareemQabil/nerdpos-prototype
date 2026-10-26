import { ApiError } from '../errors';
import type { Ctx } from '../kernel';
import { policy } from '../policies';
import { computeTotals, activeLines } from '../pricing';
import { D, m4, sub, add, ZERO, gt } from '../money';
import type { Order, DB, Session, Loc } from '../types';

export const need = (cond: unknown, code: string, details?: Record<string, unknown>) => {
  if (!cond) throw new ApiError(code, details);
};

export function requireFields(ctx: Ctx, ...fields: string[]) {
  for (const f of fields) {
    const v = ctx.body?.[f];
    if (v === undefined || v === null || v === '') throw new ApiError('VALIDATION_FAILED', { field: f, rule: 'required' });
  }
}

export function checkVersion(entity: { version: number }, expected: unknown, field = 'expectedVersion') {
  if (expected === undefined || expected === null) throw new ApiError('VALIDATION_FAILED', { field, rule: 'required' });
  if (Number(expected) !== entity.version) throw new ApiError('CONCURRENCY_CONFLICT', { expectedVersion: Number(expected), currentVersion: entity.version });
}

export function requireBranch(ctx: Ctx): string {
  if (!ctx.branchId) throw new ApiError('CONTEXT_REQUIRED', { reason: 'this device has no branch (terminal) context' });
  return ctx.branchId;
}

/** Branch-scoped lookup: another branch's order is "not found" (no existence leak). */
export function getOrder(ctx: Ctx, id: string, code = 'ORDERS_ORDER_NOT_FOUND'): Order {
  const o = ctx.db.orders.find((x) => x.id === id);
  if (!o || (ctx.branchId && o.branchId !== ctx.branchId)) throw new ApiError(code, { orderId: id });
  return o;
}

export function openSessionOn(db: DB, terminalId: string | null | undefined): Session | null {
  if (!terminalId) return null;
  return db.sessions.find((s) => s.terminalId === terminalId && s.state === 'OPEN') ?? null;
}

export function reasonCheck(ctx: Ctx, kind: string, code: string | undefined, note?: string) {
  const mode = (policy<Record<string, string>>('ReasonCodePolicy') ?? {})[kind] ?? 'FREE_TEXT';
  if (!code) throw new ApiError('VALIDATION_FAILED', { field: 'reasonCode', rule: 'required' });
  if (mode !== 'MANAGED') return null;
  const rc = ctx.db.reasonCodes.find((r) => r.kind === kind && r.code === code && r.active);
  if (!rc) throw new ApiError('REASON_CODE_INVALID', { kind, code });
  if (rc.requiresNote && !(note && note.trim())) throw new ApiError('REASON_REQUIRED', { kind, code });
  if (note && note.length > 200) throw new ApiError('VALIDATION_FAILED', { field: 'reason', rule: 'max 200 characters' });
  return rc;
}

export const userName = (db: DB, id: string | null | undefined) => db.users.find((u) => u.id === id)?.displayName ?? id ?? '';

export function settlementOf(db: DB, order: Order) {
  const totals = computeTotals(order);
  const caps = db.captures.filter((c) => c.orderId === order.id);
  const paid = caps.reduce((a, c) => a.plus(D(c.amount)).plus(D(c.rounding ?? 0)), D(0));
  const refunded = db.refunds.filter((r) => r.orderId === order.id && r.state === 'PAID').reduce((a, r) => a.plus(D(r.amount)), D(0));
  const remaining = D(totals.payable).minus(paid);
  return {
    orderId: order.id, payable: totals.payable, paid: m4(paid), refunded: m4(refunded), effectivePaid: m4(paid.minus(refunded)),
    remaining: m4(remaining.greaterThan(0) ? remaining : 0), settled: !remaining.greaterThan(0), captures: caps,
  };
}

export function orderView(db: DB, o: Order) {
  const totals = computeTotals(o);
  const table = o.tableId ? db.tables.find((t) => t.id === o.tableId) : null;
  const visit = o.visitId ? db.visits.find((v) => v.id === o.visitId) : null;
  const deliveries = db.kitchenDeliveries.filter((d) => d.orderId === o.id);
  const unfired = activeLines(o).filter((l) => l.fireRound === null).length;
  const fireMode = o.fireMode;
  return {
    ...o,
    tableName: table?.name ?? null,
    visitState: visit?.state ?? null,
    serverName: userName(db, o.serverUserId),
    totals,
    cartPreview: { state: 'AVAILABLE', ...totals },
    settlement: o.status === 'CONFIRMED' || o.status === 'COMPLETED' ? settlementOf(db, o) : null,
    rounds: o.rounds.map((r) => {
      const d = deliveries.find((x) => x.round === r.round);
      return { ...r, delivery: d ? { state: d.state, attempts: d.attempts, lastError: d.lastError, ticketIds: d.ticketIds } : null };
    }),
    unfiredCount: unfired,
    fireModeBound: fireMode,
  };
}

export const loc = (ar: string, en: string): Loc => ({ ar, en });
export { D, m4, sub, add, ZERO, gt };

export function page<T>(items: T[], query: Record<string, string>) {
  const limit = Math.min(Number(query.limit ?? 200) || 200, 500);
  const offset = Number(query.cursor ?? 0) || 0;
  const slice = items.slice(offset, offset + limit);
  return { items: slice, nextCursor: offset + limit < items.length ? String(offset + limit) : null, total: items.length };
}
