// ux-10b: what the drawer's blind counts share — the confirmed counts of a session (append-only), the recount rule
// (BlindRecountPolicy), the handover records and the written-reason rule (ReasonTextPolicy). All money is Decimal.
import { ApiError } from './errors';
import { nextId } from './store';
import { D, m4 } from './money';
import { policyFields, reasonMinLength } from './policies';
import type { DB, Session, DrawerCount, Handover } from './types';
import type { Ctx } from './kernel';

export const handoversOf = (db: DB): Handover[] => db.handovers ?? [];
export const entriesOf = (db: DB, sessionId: string) => db.cashEntries.filter((e) => e.sessionId === sessionId).length;

/** The terminal's live drawer session: open, or waiting for a handover to be accepted. */
export function liveSessionOn(db: DB, terminalId: string | null | undefined): Session | null {
  if (!terminalId) return null;
  return db.sessions.find((s) => s.terminalId === terminalId && (s.state === 'OPEN' || s.state === 'HANDOVER_PENDING')) ?? null;
}

/** The confirmed count that still locks the drawer: the last one, while no cash entry was added after it. */
export function liveCount(db: DB, s: Session): DrawerCount | null {
  const c = s.counts?.at(-1);
  return c && c.entries === entriesOf(db, s.id) ? c : null;
}

export type RecountMode = 'NOT_ALLOWED' | 'WITH_APPROVAL';
export const recountMode = (branchId: string | null): RecountMode => (policyFields<{ mode: string }>('BlindRecountPolicy', { branchId }).mode === 'WITH_APPROVAL' ? 'WITH_APPROVAL' : 'NOT_ALLOWED');

/** A new count of a drawer whose confirmed count still stands must be the same amount: a different amount is a recount,
 *  which only Session.Recount records (BlindRecountPolicy). */
export function assertCountLock(db: DB, s: Session, counted: string): DrawerCount | null {
  const live = liveCount(db, s);
  if (live && !D(live.counted).eq(D(counted))) throw new ApiError('BLIND_COUNT_LOCKED', { sessionId: s.id, confirmedAt: live.at, recount: recountMode(s.branchId) }, 409);
  return live;
}

export function pushCount(ctx: Ctx, s: Session, kind: DrawerCount['kind'], counted: string, extra: Partial<DrawerCount> = {}): DrawerCount {
  const c: DrawerCount = { id: nextId('cnt'), kind, counted: m4(counted), at: ctx.nowIso, by: ctx.user!.id, entries: entriesOf(ctx.db, s.id), ...extra };
  (s.counts ??= []).push(c);
  return c;
}

/** A refusal that keeps what the command wrote before it (a confirmed count stays recorded, so it stays locked). */
export function keepWrites<T extends Error>(e: T): T {
  (e as any).keepWrites = true;
  return e;
}

/** A written reason: trimmed, at least ReasonTextPolicy.minLength characters (default 3), at most 200. */
export function reasonText(ctx: Ctx, raw: unknown, code: 'REASON_REQUIRED' | 'VALIDATION_FAILED' = 'REASON_REQUIRED'): string {
  const r = typeof raw === 'string' ? raw.trim() : '';
  const min = reasonMinLength({ branchId: ctx.branchId });
  if (r.length < min) throw new ApiError(code, { field: 'reason', rule: `at least ${min} characters (ReasonTextPolicy)`, minLength: min });
  if (r.length > 200) throw new ApiError('VALIDATION_FAILED', { field: 'reason', rule: 'at most 200 characters' });
  return r;
}

export interface HandoverRules { mode: 'FULL_CLOSE' | 'DUAL_COUNT' | 'DIRECT_SWAP'; countMismatchTolerance: string; mismatchRecounts: number }
export function handoverRules(branchId: string | null): HandoverRules {
  const p = policyFields<HandoverRules>('ShiftHandoverPolicy', { branchId });
  const mode = (['FULL_CLOSE', 'DUAL_COUNT', 'DIRECT_SWAP'] as const).includes(p.mode as any) ? p.mode : 'DUAL_COUNT';
  const tol = (() => { try { const d = D(String(p.countMismatchTolerance ?? '0')); return d.gte(0) ? m4(d) : '0.0000'; } catch { return '0.0000'; } })();
  const n = Number(p.mismatchRecounts);
  return { mode, countMismatchTolerance: tol, mismatchRecounts: Number.isInteger(n) && n >= 0 && n <= 3 ? n : 1 };
}

/** What a screen may know about a handover. While it is pending nobody reads the counts or the expected cash (both
 *  counts are blind); once accepted or cancelled the record is history and is shown whole. */
export function handoverView(db: DB, h: Handover) {
  const name = (id: string | null) => (id ? db.users.find((u) => u.id === id)?.displayName ?? id : null);
  const base = { id: h.id, number: h.number, state: h.state, mode: h.mode, terminalId: h.terminalId, outgoingSessionId: h.outgoingSessionId, outgoingUserId: h.outgoingUserId, outgoingName: name(h.outgoingUserId), startedAt: h.startedAt, version: h.version, recountsAllowed: h.recountsAllowed, attempts: h.incomingCounts.length };
  if (h.state === 'PENDING') return { ...base, recountsLeft: Math.max(0, h.recountsAllowed + 1 - h.incomingCounts.length) };
  return {
    ...base, outgoingCount: h.outgoingCount, outgoingNote: h.outgoingNote, expectedCash: h.expectedCash, incomingCounts: h.incomingCounts, incomingUserId: h.incomingUserId, incomingName: name(h.incomingUserId),
    incomingCount: h.incomingCount, acceptedAt: h.acceptedAt, incomingSessionId: h.incomingSessionId, variance: h.variance, outgoingVariance: h.outgoingVariance, countDifference: h.countDifference,
    approvalGrantId: h.approvalGrantId, approverUserId: h.approverUserId, approverName: name(h.approverUserId), reason: h.reason, tolerance: h.tolerance,
    cancelledAt: h.cancelledAt, cancelledBy: h.cancelledBy, cancelledByName: name(h.cancelledBy), cancelReason: h.cancelReason,
  };
}
