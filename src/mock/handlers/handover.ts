// ux-10b (PROPOSED): shift handover on one terminal (ShiftHandoverPolicy) and the approved blind recount
// (BlindRecountPolicy). The canonical Session.Handover stays PD-held (PD-V4-04); these three commands are the proposal:
//   Session.HandoverStart  — the outgoing cashier confirms a blind count; the drawer waits (HANDOVER_PENDING, nothing moves)
//   Session.HandoverAccept — the incoming cashier, signed in on the same terminal, counts blind too (DUAL_COUNT) or takes
//                            the outgoing count (DIRECT_SWAP); the outgoing session closes on the accepted amount (its
//                            shortage / overage) and a new session opens with that amount, linked to the handover
//   Session.HandoverCancel — the outgoing cashier or a manager, with a reason; the drawer goes back to the outgoing shift
// A manager approves (SHIFT_HANDOVER_VARIANCE) only when the difference passes SESSION_VARIANCE's own rule or the two counts
// still disagree after the allowed recounts. Every count is append-only; the handover record is immutable once decided.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event } from '../store';
import { D, m4, sub, isMoney } from '../money';
import { approvalRule, ruleRequires } from '../policies';
import { checkVersion, need, userName } from './util';
import { cashEntry, expectedCash, sessionReport } from './money';
import { assertCountLock, handoverRules, handoversOf, handoverView, keepWrites, liveCount, pushCount, reasonText, recountMode } from '../drawer-count';
import type { Handover, Session, ZReport } from '../types';

function sessionOf(ctx: Ctx, id: string): Session {
  const s = ctx.db.sessions.find((x) => x.id === id && x.branchId === ctx.branchId);
  need(s, 'SESSION_NOT_FOUND');
  return s!;
}
function pendingOf(ctx: Ctx, s: Session): Handover {
  const h = s.handoverId ? handoversOf(ctx.db).find((x) => x.id === s.handoverId) : null;
  if (!h || h.state !== 'PENDING' || s.state !== 'HANDOVER_PENDING') throw new ApiError('HANDOVER_NOT_PENDING', { sessionId: s.id, state: h?.state ?? s.state }, 409);
  return h;
}
const termCode = (ctx: Ctx, id: string) => ctx.db.terminals.find((t) => t.id === id)?.code ?? id;

export const handoverHandlers: Record<string, Handler> = {
  'Session.HandoverStart': (ctx) => {
    const db = ctx.db;
    const s = sessionOf(ctx, ctx.params.sessionId);
    // authorization first: only the cashier whose shift it is hands it over (it is their blind count)
    if (s.userId !== ctx.user!.id) throw new ApiError('HANDOVER_NOT_SESSION_OWNER', { sessionId: s.id }, 403);
    const rules = handoverRules(s.branchId);
    if (rules.mode === 'FULL_CLOSE') throw new ApiError('HANDOVER_DISABLED', { mode: rules.mode, policy: 'ShiftHandoverPolicy', rule: 'close the shift (blind count, Z) and the next cashier opens a new one' }, 409);
    if (s.state === 'HANDOVER_PENDING') throw new ApiError('HANDOVER_ALREADY_PENDING', { sessionId: s.id, handoverId: s.handoverId ?? null }, 409);
    need(s.state === 'OPEN', 'SESSION_NOT_OPEN');
    if (ctx.terminal?.id !== s.terminalId) throw new ApiError('HANDOVER_TERMINAL_MISMATCH', { terminal: termCode(ctx, s.terminalId) }, 409);
    checkVersion(s, ctx.body.expectedVersion);
    // the same rule as the close: counter / takeaway checks of this drawer end (or move) first
    const open = db.orders.filter((o) => o.sessionId === s.id && (o.status === 'DRAFT' || o.status === 'CONFIRMED'));
    if (open.length) throw new ApiError('SESSION_HAS_OPEN_ORDERS', { orders: open.map((o) => o.number), rule: 'the checks of this drawer end or move to another drawer before a handover, as before a close' });
    need(isMoney(ctx.body.countedCash) && D(ctx.body.countedCash).gte(0), 'VALIDATION_FAILED', { field: 'countedCash' });
    const counted = m4(ctx.body.countedCash);
    const live = assertCountLock(db, s, counted);
    const note = typeof ctx.body.note === 'string' && ctx.body.note.trim() ? ctx.body.note.trim() : null;
    need(!note || note.length <= 200, 'VALIDATION_FAILED', { field: 'note', rule: 'at most 200 characters' });
    db.seq['handover_no'] = (db.seq['handover_no'] ?? 0) + 1;
    const h: Handover = {
      id: nextId('hov'), number: `HO-${String(db.seq['handover_no']).padStart(4, '0')}`, branchId: s.branchId, terminalId: s.terminalId, outgoingSessionId: s.id, outgoingUserId: s.userId,
      mode: rules.mode as Handover['mode'], tolerance: rules.countMismatchTolerance, recountsAllowed: rules.mismatchRecounts, state: 'PENDING', startedAt: ctx.nowIso, startedAtMs: ctx.now,
      outgoingCount: counted, outgoingNote: note, expectedCash: expectedCash(ctx, s.id), incomingCounts: [], incomingUserId: null, incomingCount: null, acceptedAt: null, incomingSessionId: null,
      variance: null, outgoingVariance: null, countDifference: null, approvalGrantId: null, approverUserId: null, reason: null, cancelledAt: null, cancelledBy: null, cancelReason: null, version: 1,
    };
    (db.handovers ??= []).push(h);
    if (!live) pushCount(ctx, s, 'HANDOVER', counted);
    s.state = 'HANDOVER_PENDING';
    s.handoverId = h.id;
    s.version++;
    ctx.audit(`handover ${h.number} started on ${termCode(ctx, s.terminalId)}: outgoing blind count ${counted} (${h.mode})`, s.id, true);
    event('SessionHandoverStarted', s.id, `${h.number} ${termCode(ctx, s.terminalId)} by ${ctx.user!.username}`);
    return { status: 201, body: { handover: handoverView(db, h), session: { id: s.id, state: s.state, version: s.version, handoverId: h.id } } };
  },

  'Session.HandoverAccept': (ctx) => {
    const db = ctx.db;
    const s = sessionOf(ctx, ctx.params.sessionId);
    const h = pendingOf(ctx, s);
    if (ctx.user!.id === h.outgoingUserId) throw new ApiError('HANDOVER_SAME_USER', { handoverId: h.id, rule: 'the next cashier signs in on this terminal and accepts the drawer' }, 409);
    if (ctx.terminal?.id !== h.terminalId) throw new ApiError('HANDOVER_TERMINAL_MISMATCH', { terminal: termCode(ctx, h.terminalId) }, 409);
    checkVersion(h, ctx.body.expectedVersion);
    let incoming: string | null = null;
    let mismatch = false;
    let appended = false;
    try {
      let reason: string | null = null;
      if (h.mode === 'DUAL_COUNT') {
        need(isMoney(ctx.body.countedCash) && D(ctx.body.countedCash).gte(0), 'VALIDATION_FAILED', { field: 'countedCash', rule: 'the incoming cashier counts the drawer blind (DUAL_COUNT)' });
        incoming = m4(ctx.body.countedCash);
        const last = h.incomingCounts.at(-1);
        const resend = !!last && last.by === ctx.user!.id && D(last.counted).eq(D(incoming));
        if (resend) mismatch = last!.mismatch;
        else {
          // a confirmed incoming count is locked: a new count is allowed only after a mismatch, within the allowed recounts
          const left = h.recountsAllowed + 1 - h.incomingCounts.length;
          if (last && (!last.mismatch || left <= 0)) throw new ApiError('BLIND_COUNT_LOCKED', { handoverId: h.id, confirmedAt: last.at, recount: 'AFTER_MISMATCH_ONLY', recountsLeft: Math.max(0, left) }, 409);
          mismatch = D(incoming).minus(D(h.outgoingCount)).abs().gt(D(h.tolerance));
          h.incomingCounts.push({ counted: incoming, at: ctx.nowIso, by: ctx.user!.id, mismatch });
          appended = true;
        }
        if (mismatch) {
          // never the amounts: both counts stay blind while a recount is possible
          const recountsLeft = Math.max(0, h.recountsAllowed + 1 - h.incomingCounts.length);
          if (recountsLeft > 0) throw new ApiError('HANDOVER_COUNT_MISMATCH', { handoverId: h.id, recountsLeft, needsApproval: false }, 409);
          if (!(typeof ctx.body.reason === 'string' && ctx.body.reason.trim())) throw new ApiError('HANDOVER_COUNT_MISMATCH', { handoverId: h.id, recountsLeft: 0, needsApproval: true }, 409);
          reason = reasonText(ctx, ctx.body.reason);
        }
      }
      if (!reason && typeof ctx.body.reason === 'string' && ctx.body.reason.trim()) reason = ctx.body.reason.trim().slice(0, 200);
      const accepted = incoming ?? h.outgoingCount;
      const exp = expectedCash(ctx, s.id); // nothing moved while pending: the same as at the start
      const variance = sub(accepted, exp);
      const outVar = sub(h.outgoingCount, exp);
      const vr = approvalRule('SESSION_VARIANCE', { branchId: s.branchId });
      const over = ruleRequires(vr, { countedCash: accepted, expectedCash: exp, absVariance: m4(D(variance).abs()) }) || ruleRequires(vr, { countedCash: h.outgoingCount, expectedCash: exp, absVariance: m4(D(outVar).abs()) });
      const diff = incoming === null ? null : sub(incoming, h.outgoingCount);
      const context = { handoverId: h.id, expectedCash: exp, outgoingCount: h.outgoingCount, incomingCount: incoming, absVariance: m4(D(variance).abs()), absDifference: diff === null ? '0.0000' : m4(D(diff).abs()), varianceOverThreshold: over, countMismatch: mismatch, needsApproval: over || mismatch };
      const g = ctx.requireApproval({ action: 'SHIFT_HANDOVER_VARIANCE', targetType: 'sessions.Session', targetId: s.id, context, grantId: ctx.body.approvalGrantId });

      // ── accepted: everything below is one transaction
      const inc = ctx.user!;
      const ns: Session = { id: nextId('sess'), terminalId: s.terminalId, branchId: s.branchId, userId: inc.id, state: 'OPEN', openingFloat: accepted, openedAt: ctx.nowIso, openedAtMs: ctx.now, businessDate: ctx.businessDate(s.branchId), closedAt: null, closedBy: null, version: 1, close: null, handoverFromId: h.id };
      db.sessions.push(ns);
      cashEntry(ctx, ns.id, 'OPENING_FLOAT', accepted, { ref: h.number, approvalGrantId: g?.id });
      ns.version = 1;
      Object.assign(h, { state: 'ACCEPTED', incomingUserId: inc.id, incomingCount: incoming, acceptedAt: ctx.nowIso, incomingSessionId: ns.id, variance, outgoingVariance: outVar, countDifference: diff, approvalGrantId: g?.id ?? null, approverUserId: g?.approverUserId ?? null, reason });
      h.version++;
      // the outgoing session closes on the accepted amount: the shortage / overage is the outgoing cashier's
      s.state = 'CLOSED';
      s.closedAt = ctx.nowIso;
      s.closedBy = inc.id;
      s.version++;
      const z = { ...sessionReport(ctx, s, ctx.nowIso), countedCash: accepted, variance } as ZReport;
      s.close = { countedCash: accepted, expectedCash: exp, variance, approvalGrantId: g?.id, reason: reason ?? undefined, z, handoverId: h.id, outgoingCount: h.outgoingCount, incomingCount: incoming, recounts: (s.counts ?? []).filter((c) => c.kind === 'RECOUNT').length };
      ctx.audit(`handover ${h.number} accepted by ${inc.username}: outgoing ${h.outgoingCount}${incoming !== null ? `, incoming ${incoming}` : ' (direct swap)'}, expected ${exp}, variance ${variance} on ${userName(db, h.outgoingUserId)}${reason ? ` — ${reason}` : ''}`, s.id, true, g?.id);
      ctx.audit(`session opened by handover ${h.number} on ${termCode(ctx, s.terminalId)} float ${accepted}`, ns.id);
      event('SessionHandedOver', s.id, `${h.number} → ${ns.id} variance ${variance}`);
      return { handover: handoverView(db, h), session: ns, closedSessionId: s.id, variance, countDifference: diff, openingFloat: accepted };
    } catch (e) {
      if (appended) keepWrites(e as Error); // the incoming count stays recorded (and locked)
      throw e;
    }
  },

  'Session.HandoverCancel': (ctx) => {
    const db = ctx.db;
    const s = sessionOf(ctx, ctx.params.sessionId);
    // the outgoing cashier, or a manager who decides drawer count differences
    if (ctx.user!.id !== s.userId && !ctx.can('approve:session_variance')) throw new ApiError('HANDOVER_CANCEL_NOT_ALLOWED', { sessionId: s.id }, 403);
    const h = pendingOf(ctx, s);
    checkVersion(h, ctx.body.expectedVersion);
    const reason = reasonText(ctx, ctx.body.reason);
    Object.assign(h, { state: 'CANCELLED', cancelledAt: ctx.nowIso, cancelledBy: ctx.user!.id, cancelReason: reason });
    h.version++;
    s.state = 'OPEN';
    s.handoverId = null;
    s.version++;
    ctx.audit(`handover ${h.number} cancelled: ${reason}`, s.id, true);
    event('SessionHandoverCancelled', s.id, `${h.number} by ${ctx.user!.username}`);
    return { handover: handoverView(db, h), session: { id: s.id, state: s.state, version: s.version } };
  },

  // BlindRecountPolicy WITH_APPROVAL: a second blind count replaces the confirmed one for the close; both are kept
  'Session.Recount': (ctx) => {
    const db = ctx.db;
    const s = sessionOf(ctx, ctx.params.sessionId);
    if (s.state === 'HANDOVER_PENDING') throw new ApiError('SESSION_HANDOVER_PENDING', { sessionId: s.id, handoverId: s.handoverId ?? null }, 409);
    need(s.state === 'OPEN', 'SESSION_NOT_OPEN');
    if (recountMode(s.branchId) !== 'WITH_APPROVAL') throw new ApiError('BLIND_RECOUNT_NOT_ALLOWED', { policy: 'BlindRecountPolicy', mode: 'NOT_ALLOWED' }, 409);
    checkVersion(s, ctx.body.expectedVersion);
    const live = liveCount(db, s);
    if (!live) throw new ApiError('VALIDATION_FAILED', { rule: 'there is no confirmed count to recount: count and close normally' });
    need(isMoney(ctx.body.countedCash) && D(ctx.body.countedCash).gte(0), 'VALIDATION_FAILED', { field: 'countedCash' });
    const counted = m4(ctx.body.countedCash);
    if (D(counted).eq(D(live.counted))) throw new ApiError('VALIDATION_FAILED', { field: 'countedCash', rule: 'the recount equals the confirmed count' });
    const reason = reasonText(ctx, ctx.body.reason);
    const g = ctx.requireApproval({ action: 'SESSION_RECOUNT', targetType: 'sessions.Session', targetId: s.id, context: { sessionId: s.id, firstCount: live.counted, recount: counted }, grantId: ctx.body.approvalGrantId });
    const c = pushCount(ctx, s, 'RECOUNT', counted, { reason, approvalGrantId: g?.id ?? null, replaces: live.id });
    s.version++;
    ctx.audit(`blind recount ${live.counted} → ${counted}: ${reason}`, s.id, true, g?.id);
    return { status: 201, body: { count: c, session: { id: s.id, version: s.version, counts: s.counts } } };
  },
};
