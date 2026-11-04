import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event } from '../store';
import { policy, channelPolicy } from '../policies';
import { computeTotals } from '../pricing';
import { enqueuePrint } from '../outbox';
import { D, m4, add, sub, allocate, isMoney, round } from '../money';
import { checkVersion, getOrder, need, openSessionOn, page, reasonCheck, requireFields, settlementOf, userName } from './util';
import type { Capture, CashEntry, Session, ZReport, Order, TenderMethod } from '../types';
import { authorizationForCapture } from './extpay'; // crm area: external authorizations
import { paidStage, paidDateOf, recordReversal, stockForReturn, checkDisposition, approvedText, DISP_AR } from './reversals'; // r3A: refund stages S2/S3
import { checkTenderReference, prepaidAllowed, referenceRule } from '../r3b'; // round 3: tender taxonomy + reference policy
import { depositBalances, depositView, depVersion, pushResEvent, refundBlock } from '../reservation-rules'; // ux-12: deposits applied in parts and refunded
import { policyFields } from '../policies';
import { assertCountLock, handoversOf, handoverView, keepWrites, liveCount, liveSessionOn, pushCount, reasonText } from '../drawer-count'; // ux-10b: count lock, handover, reason length
import { kickDrawer } from '../devices'; // ux-14: the registered cash drawer

export function cashEntry(ctx: Ctx, sessionId: string, kind: CashEntry['kind'], amount: string, extra: Partial<CashEntry> = {}) {
  const e: CashEntry = { id: nextId('ce'), sessionId, kind, amount: m4(amount), at: ctx.nowIso, by: ctx.user!.id, ...extra };
  ctx.db.cashEntries.push(e);
  const s = ctx.db.sessions.find((x) => x.id === sessionId);
  if (s) s.version++;
  return e;
}

const SIGN: Record<CashEntry['kind'], number> = { OPENING_FLOAT: 1, TENDER_IN: 1, REFUND_OUT: -1, PAY_IN: 1, PAY_OUT: -1, SAFE_DROP: -1, NO_SALE: 0, TIP_IN: 1, TIP_OUT: -1, DEPOSIT_IN: 1, TENDER_CORRECTION_IN: 1, TENDER_CORRECTION_OUT: -1 };
export function expectedCash(ctx: Ctx, sessionId: string) {
  return m4(ctx.db.cashEntries.filter((e) => e.sessionId === sessionId).reduce((a, e) => a.plus(D(e.amount).times(SIGN[e.kind])), D(0)));
}

function cashDue(remaining: string) {
  const cr = policy<{ mode: string; increment: string }>('CashRoundingPolicy') ?? { mode: 'OFF', increment: '0.25' };
  if (cr.mode === 'OFF') return { due: remaining, rounding: '0.0000', increment: null };
  const inc = D(cr.increment);
  const due = D(remaining).dividedBy(inc).toDecimalPlaces(0, 4 /* HALF_UP */).times(inc);
  return { due: m4(due), rounding: m4(D(remaining).minus(due)), increment: cr.increment };
}

export { report as sessionReport };
function report(ctx: Ctx, s: Session, frozenAt?: string): Omit<ZReport, 'countedCash' | 'variance'> & { countedCash?: string; variance?: string } {
  const db = ctx.db;
  const caps = db.captures.filter((c) => c.sessionId === s.id);
  const tender: Record<string, string> = {};
  for (const c of caps) {
    const key = c.method === 'DIGITAL_WALLET' && c.walletProvider ? `DIGITAL_WALLET:${c.walletProvider}` : c.method;
    tender[key] = add(tender[key] ?? '0', c.amount);
  }
  const refunds: Record<string, string> = {};
  for (const r of db.refunds.filter((x) => x.paidSessionId === s.id && x.state === 'PAID')) refunds[r.method] = add(refunds[r.method] ?? '0', r.amount);
  const byKind: Record<string, string> = {};
  for (const e of db.cashEntries.filter((x) => x.sessionId === s.id)) byKind[e.kind] = add(byKind[e.kind] ?? '0', e.amount);
  const orderIds = new Set(caps.map((c) => c.orderId));
  const orders = db.orders.filter((o) => orderIds.has(o.id) || o.sessionId === s.id);
  const counts: Record<string, number> = {};
  for (const o of orders) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const outstanding = db.orders.filter((o) => o.branchId === s.branchId && o.status === 'CONFIRMED' && !settlementOf(db, o).settled).map((o) => ({ orderId: o.id, number: o.number, payable: settlementOf(db, o).remaining, table: o.tableId ? db.tables.find((t) => t.id === o.tableId)?.name ?? null : null }));
  const tips = m4(db.tips.filter((t) => t.sessionId === s.id).reduce((a, t) => a.plus(D(t.amount)), D(0)));
  // ux-10b: the handover that opened this session and the one that ended it
  const hin = s.handoverFromId ? handoversOf(db).find((h) => h.id === s.handoverFromId) : null;
  const hout = s.handoverId ? handoversOf(db).find((h) => h.id === s.handoverId && h.state === 'ACCEPTED') : null;
  const handoverIn = hin ? { handoverId: hin.id, number: hin.number, fromCashier: userName(db, hin.outgoingUserId), at: hin.acceptedAt ?? hin.startedAt, mode: hin.mode, openingFromCount: s.openingFloat } : null;
  const handoverOut = hout ? { handoverId: hout.id, number: hout.number, toCashier: userName(db, hout.incomingUserId), at: hout.acceptedAt ?? '', mode: hout.mode, outgoingCount: hout.outgoingCount, incomingCount: hout.incomingCount, expectedCash: hout.expectedCash, variance: hout.variance ?? '0.0000', countDifference: hout.countDifference, approver: hout.approverUserId ? userName(db, hout.approverUserId) : null, reason: hout.reason } : null;
  return {
    sessionId: s.id, terminalCode: db.terminals.find((t) => t.id === s.terminalId)?.code ?? s.terminalId, cashierName: userName(db, s.userId), openedAt: s.openedAt, closedAt: s.closedAt ?? '', businessDate: s.businessDate,
    openingFloat: s.openingFloat, tenderBreakdown: tender, refundBreakdown: refunds, cashByKind: byKind, expectedCash: expectedCash(ctx, s.id), orderCounts: counts, outstandingChecks: outstanding, tips, snapshotAt: frozenAt ?? ctx.nowIso,
    handoverIn, handoverOut,
  };
}

function collectingSession(ctx: Ctx, o: Order): Session {
  const db = ctx.db;
  if (o.sessionId) {
    const origin = db.sessions.find((s) => s.id === o.sessionId);
    const scope = o.channel === 'DINE_IN' ? channelPolicy('CollectionScopePolicy', { branchId: o.branchId, channel: o.channel }, 'ORIGIN_SESSION') : 'ORIGIN_SESSION';
    if (scope === 'ORIGIN_SESSION') {
      if (!origin || origin.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN', { reason: 'origin drawer session is closed', sessionId: o.sessionId });
      if (ctx.terminal?.id !== origin.terminalId) throw new ApiError('SESSION_NOT_OPEN', { reason: 'collect on the drawer that opened this check', terminal: db.terminals.find((t) => t.id === origin.terminalId)?.code });
      return origin;
    }
  }
  const s = openSessionOn(db, ctx.terminal?.id);
  if (!s) throw new ApiError('SESSION_NOT_OPEN', { terminal: ctx.terminal?.code ?? null, reason: 'a floor check is collected at a terminal with an open drawer (CollectionScopePolicy)' });
  const scope = channelPolicy('CollectionScopePolicy', { branchId: o.branchId, channel: o.channel }, 'ORIGIN_SESSION');
  if (!o.sessionId && scope === 'ORIGIN_SESSION') throw new ApiError('SESSION_NOT_OPEN', { reason: 'CollectionScopePolicy ORIGIN_SESSION: a floor check without a drawer has no collecting session' });
  return s;
}

export const moneyHandlers: Record<string, Handler> = {
  'Payment.GetSettlement': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status === 'DRAFT') throw new ApiError('ORDER_NOT_CONFIRMED');
    const st = settlementOf(ctx.db, o);
    return { ...st, cash: cashDue(st.remaining), totals: computeTotals(o) };
  },
  'Payment.Capture': (ctx) => {
    const db = ctx.db;
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status === 'DRAFT') throw new ApiError('ORDER_NOT_CONFIRMED');
    if (o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    const tenders: any[] = ctx.body.tenders ?? [];
    need(tenders.length, 'VALIDATION_FAILED', { field: 'tenders' });
    const session = collectingSession(ctx, o);
    const enabled = policy<{ enabled: string[] }>('TenderMethodPolicy', { branchId: o.branchId })?.enabled ?? ['CASH', 'CARD'];
    const split = policy<boolean>('SplitTenderPolicy') !== false;
    const tipOn = policy<string>('TipPolicy') === 'ON';
    let remaining = D(settlementOf(db, o).remaining);
    if (remaining.lte(0)) throw new ApiError('OVERPAYMENT', { remaining: '0.0000' });
    if (!split && tenders.length > 1) throw new ApiError('SPLIT_TENDER_DISABLED');
    const created: Capture[] = [];
    let changeTotal = D(0);
    for (const t of tenders) {
      const method = t.method as TenderMethod;
      // round 3 tender taxonomy: PREPAID (ONLINE) is not a counter method — only orders from a delivery app or a payment link
      if (method === 'ONLINE') { if (!prepaidAllowed(o, !!t.authorizationId)) throw new ApiError('TENDER_PREPAID_NOT_ALLOWED', { orderId: o.id }); }
      else if (method !== 'DEPOSIT' && !enabled.includes(method)) throw new ApiError('TENDER_METHOD_DISABLED', { method, enabled });
      const auth = t.authorizationId ? authorizationForCapture(ctx, o, t) : null; // crm area: approved card/wallet authorization
      // reference capture per method is a venue policy (off / optional / required); a number is never recorded twice
      const reference = method === 'CASH' ? null : checkTenderReference(db, o, { method, walletProvider: t.walletProvider ?? null }, t.reference ?? auth?.reference ?? ctx.body.tenderReference ?? null, ctx.businessDate(o.branchId), !!auth);
      if (!isMoney(t.amount ?? t.tendered)) throw new ApiError('VALIDATION_FAILED', { field: 'amount' });
      let applied: any, change = D(0), tendered: string | null = null, roundingAdj = D(0);
      if (method === 'CASH') {
        const given = D(t.tendered ?? t.amount);
        const cd = cashDue(m4(remaining));
        const dueCash = D(cd.due);
        if (given.gte(dueCash)) { applied = dueCash; change = given.minus(dueCash); roundingAdj = D(cd.rounding); }
        else applied = given;
        tendered = m4(given);
      } else {
        applied = D(t.amount);
        if (applied.gt(remaining)) throw new ApiError(method === 'CARD' && t.tendered ? 'CHANGE_NOT_ALLOWED' : 'OVERPAYMENT', { remaining: m4(remaining), amount: m4(applied) });
      }
      if (applied.lte(0)) throw new ApiError('VALIDATION_FAILED', { field: 'amount', rule: '> 0' });
      if (!split && applied.plus(roundingAdj).lt(remaining)) throw new ApiError('SPLIT_TENDER_DISABLED', { remaining: m4(remaining) });
      const tip = tipOn && t.tip && D(t.tip).gt(0) ? m4(t.tip) : '0.0000';
      const c: Capture = { id: nextId('cap'), orderId: o.id, method, amount: m4(applied), tendered, change: m4(change), reference, walletProvider: t.walletProvider ?? null, sessionId: session.id, terminalId: ctx.terminal!.id, branchId: o.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(o.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip, rounding: m4(roundingAdj) };
      db.captures.push(c);
      if (auth) { auth.state = 'CAPTURED'; auth.captureId = c.id; }
      created.push(c);
      if (method === 'CASH') cashEntry(ctx, session.id, 'TENDER_IN', c.amount, { ref: o.number });
      if (D(tip).gt(0)) {
        db.tips.push({ id: nextId('tip'), captureId: c.id, orderId: o.id, amount: tip, method, serverUserId: o.serverUserId, sessionId: session.id, at: ctx.nowIso, businessDate: c.businessDate, distributed: false });
        if (method === 'CASH') cashEntry(ctx, session.id, 'TIP_IN', tip, { ref: o.number });
      }
      remaining = remaining.minus(applied).minus(roundingAdj);
      changeTotal = changeTotal.plus(change);
      if (remaining.lte(0)) break;
    }
    // ux-14: cash went into the drawer of the collecting session's terminal — its drawer is kicked (a job: a failure is
    // visible and retryable, the capture stays committed)
    if (created.some((c) => c.method === 'CASH')) kickDrawer(db, enqueuePrint, session.terminalId, o.id, `فتح الدرج ${o.number}`, ctx.user!.id);
    o.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, terminal: ctx.terminal?.code, kind: 'CAPTURED', text: { ar: `دُفع ${created.map((c) => `${c.method === 'CASH' ? 'نقدًا' : c.method === 'CARD' ? 'ببطاقة' : c.method} ${c.amount} ج.م${c.reference ? ' (' + c.reference + ')' : ''}`).join(' + ')}${changeTotal.gt(0) ? ` — الباقي للعميل ${m4(changeTotal)} ج.م` : ''}`, en: `captured ${created.map((c) => `${c.method} ${c.amount}`).join(' + ')}` } });
    event('PaymentCaptured', o.id, `${o.number} ${created.map((c) => `${c.method} ${c.amount}`).join(' + ')}`);
    ctx.audit(`capture ${o.number}`, o.id);
    return { status: 201, body: { captureIds: created.map((c) => c.id), captures: created, change: m4(changeTotal), settlement: settlementOf(db, o), sessionId: session.id } };
  },
  'Payment.Find': (ctx) => page(ctx.db.captures.filter((c) => c.branchId === ctx.branchId && (!ctx.query.orderId || c.orderId === ctx.query.orderId) && (!ctx.query.sessionId || c.sessionId === ctx.query.sessionId)), ctx.query),
  'Payment.Get': (ctx) => {
    const c = ctx.db.captures.find((x) => x.id === ctx.params.paymentId);
    need(c, 'PAYMENT_CAPTURE_NOT_FOUND');
    return c;
  },
  'Payment.CorrectTender': (ctx) => {
    const db = ctx.db;
    const c = db.captures.find((x) => x.id === ctx.params.paymentId && x.branchId === ctx.branchId);
    need(c, 'PAYMENT_CAPTURE_NOT_FOUND');
    const to = ctx.body.toMethod as TenderMethod;
    if (to === c!.method) throw new ApiError('TENDER_CORRECTION_SAME_METHOD');
    reasonCheck(ctx, 'TENDER_CORRECTION', ctx.body.reasonCode, ctx.body.reason);
    if (referenceRule(to, c!.branchId) === 'REQUIRED' && !(ctx.body.reference ?? '').trim()) throw new ApiError('TENDER_REFERENCE_REQUIRED', { method: to }); // round 3: per-method reference policy
    const session = db.sessions.find((s) => s.id === c!.sessionId);
    if (!session || session.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN', { reason: 'a tender is corrected inside its open drawer session' });
    const g = ctx.requireApproval({ action: 'TENDER_CORRECTION', targetType: 'payments.PaymentCapture', targetId: c!.id, context: { fromMethod: c!.method, toMethod: to, amount: c!.amount, reasonCode: ctx.body.reasonCode }, grantId: ctx.body.approvalGrantId });
    const rev: Capture = { ...c!, id: nextId('cap'), amount: m4(D(c!.amount).negated()), tendered: null, change: '0.0000', at: ctx.nowIso, atMs: ctx.now, by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', rounding: '0.0000', correctionOf: c!.id };
    const neu: Capture = { ...c!, id: nextId('cap'), method: to, reference: ctx.body.reference ?? null, tendered: null, change: '0.0000', at: ctx.nowIso, atMs: ctx.now, by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', rounding: '0.0000', correctionOf: c!.id };
    c!.corrected = true;
    db.captures.push(rev, neu);
    if (c!.method === 'CASH') cashEntry(ctx, session.id, 'TENDER_CORRECTION_OUT', c!.amount, { approvalGrantId: g?.id });
    if (to === 'CASH') cashEntry(ctx, session.id, 'TENDER_CORRECTION_IN', c!.amount, { approvalGrantId: g?.id });
    ctx.audit(`tender correction ${c!.method} → ${to} ${c!.amount}`, c!.id, true, g?.id);
    return { original: c, reversal: rev, replacement: neu };
  },

  // ───────── sessions (drawer shifts)
  'Session.Open': (ctx) => {
    const db = ctx.db;
    const tid = ctx.body.terminalId ?? ctx.terminal?.id;
    const t = db.terminals.find((x) => x.id === tid && x.branchId === ctx.branchId);
    need(t, 'TERMINAL_NOT_FOUND');
    need(t!.lifecycle === 'ACTIVE', 'TERMINAL_NOT_ACTIVE');
    if (!t!.drawer) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { reason: 'this terminal has no cash drawer' });
    const pend = liveSessionOn(db, t!.id);
    if (pend?.state === 'HANDOVER_PENDING') throw new ApiError('SESSION_HANDOVER_PENDING', { terminal: t!.code, sessionId: pend.id, handoverId: pend.handoverId ?? null }, 409); // ux-10b
    if (openSessionOn(db, t!.id)) throw new ApiError('SESSION_ALREADY_OPEN', { terminal: t!.code });
    need(isMoney(ctx.body.openingFloat) && D(ctx.body.openingFloat).gte(0), 'VALIDATION_FAILED', { field: 'openingFloat' });
    // ux-10b OpeningFloatPolicy: the standard float; another amount is refused (LOCKED) or needs a manager (APPROVAL, default)
    const fp = policyFields<{ standardFloat: string; change: string }>('OpeningFloatPolicy', { branchId: t!.branchId });
    const std = isMoney(fp.standardFloat) ? m4(fp.standardFloat) : '0.0000';
    const float = m4(ctx.body.openingFloat);
    let fg: ReturnType<Ctx['requireApproval']> = null;
    if (!D(float).eq(D(std))) {
      if (fp.change === 'LOCKED') throw new ApiError('OPENING_FLOAT_LOCKED', { standardFloat: std, openingFloat: float, policy: 'OpeningFloatPolicy' }, 409);
      if (fp.change !== 'FREE') fg = ctx.requireApproval({ action: 'OPENING_FLOAT_OVERRIDE', targetType: 'organization.Terminal', targetId: t!.id, context: { terminalId: t!.id, standardFloat: std, openingFloat: float, absDifference: m4(D(float).minus(D(std)).abs()) }, grantId: ctx.body.approvalGrantId });
    }
    const s: Session = { id: nextId('sess'), terminalId: t!.id, branchId: t!.branchId, userId: ctx.user!.id, state: 'OPEN', openingFloat: float, openedAt: ctx.nowIso, openedAtMs: ctx.now, businessDate: ctx.businessDate(t!.branchId), closedAt: null, closedBy: null, version: 1, close: null };
    db.sessions.push(s);
    cashEntry(ctx, s.id, 'OPENING_FLOAT', s.openingFloat, fg ? { approvalGrantId: fg.id } : {});
    s.version = 1;
    ctx.audit(`session opened on ${t!.code} float ${s.openingFloat}${fg ? ` (standard ${std}, approved)` : ''}`, s.id, !!fg, fg?.id);
    event('SessionOpened', s.id, `${t!.code} by ${ctx.user!.username}`);
    return { status: 201, body: s };
  },
  'Session.Find': (ctx) => page(ctx.db.sessions.filter((s) => s.branchId === ctx.branchId && (!ctx.query.state || s.state === ctx.query.state)).sort((a, b) => b.openedAtMs - a.openedAtMs).map((s) => ({ ...s, cashierName: userName(ctx.db, s.userId), terminalCode: ctx.db.terminals.find((t) => t.id === s.terminalId)?.code, ...handoverLinks(ctx, s) })), ctx.query),
  'Session.Get': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    const sp = policy<{ maxHours: number; warningHours: number }>('SessionDurationPolicy') ?? { maxHours: 24, warningHours: 12 };
    const hours = (ctx.now - s!.openedAtMs) / 3_600_000;
    const live = liveCount(ctx.db, s!); // ux-10b: the confirmed count that still locks the drawer (the expected cash is never here)
    return { ...s, cashierName: userName(ctx.db, s!.userId), terminalCode: ctx.db.terminals.find((t) => t.id === s!.terminalId)?.code, hoursOpen: Number(hours.toFixed(1)), durationWarning: s!.state === 'OPEN' && hours >= sp.warningHours, durationExceeded: s!.state === 'OPEN' && hours >= sp.maxHours, cashEntries: ctx.db.cashEntries.filter((e) => e.sessionId === s!.id), confirmedCount: live ? { id: live.id, kind: live.kind, counted: live.counted, at: live.at } : null, ...handoverLinks(ctx, s!) };
  },
  'Session.XReport': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    need(s!.state === 'OPEN', 'SESSION_NOT_OPEN');
    const r = report(ctx, s!);
    const blind = policy<boolean>('BlindClosePolicy') !== false;
    const { expectedCash: exp, ...rest } = r;
    return { ...rest, expectedCash: blind ? undefined : exp, blind, kind: 'X', provisional: true };
  },
  'Session.Close': (ctx) => {
    const db = ctx.db;
    const s = db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    if (s!.state === 'HANDOVER_PENDING') throw new ApiError('SESSION_HANDOVER_PENDING', { sessionId: s!.id, handoverId: s!.handoverId ?? null }, 409); // ux-10b
    need(s!.state === 'OPEN', 'SESSION_NOT_OPEN');
    checkVersion(s!, ctx.body.expectedVersion);
    const open = db.orders.filter((o) => o.sessionId === s!.id && (o.status === 'DRAFT' || o.status === 'CONFIRMED'));
    if (open.length) throw new ApiError('SESSION_HAS_OPEN_ORDERS', { orders: open.map((o) => o.number), rule: 'counter/takeaway checks of this drawer must end first; floor checks never block' });
    need(isMoney(ctx.body.countedCash), 'VALIDATION_FAILED', { field: 'countedCash' });
    const counted = m4(ctx.body.countedCash);
    // ux-10b: a confirmed blind count stays locked (BlindRecountPolicy): another amount is refused until Session.Recount
    const live = assertCountLock(db, s!, counted);
    const exp = expectedCash(ctx, s!.id);
    const variance = sub(counted, exp);
    let g: ReturnType<Ctx['requireApproval']>;
    try {
      g = ctx.requireApproval({ action: 'SESSION_VARIANCE', targetType: 'sessions.Session', targetId: s!.id, context: { countedCash: counted, expectedCash: exp, absVariance: m4(D(variance).abs()) }, grantId: ctx.body.approvalGrantId });
    } catch (e) {
      // the count is confirmed once the approval is asked for: it is recorded (and kept) so a different amount is a recount
      if (e instanceof ApiError && e.code === 'APPROVAL_REQUIRED' && !live) { pushCount(ctx, s!, 'CLOSE', counted); throw keepWrites(e); }
      throw e;
    }
    if (!live) pushCount(ctx, s!, 'CLOSE', counted);
    s!.state = 'CLOSED';
    s!.closedAt = ctx.nowIso;
    s!.closedBy = ctx.user!.id;
    s!.version++;
    const z = { ...report(ctx, s!, ctx.nowIso), countedCash: counted, variance } as ZReport;
    s!.close = { countedCash: counted, expectedCash: exp, variance, approvalGrantId: g?.id, reason: ctx.body.reason, z, recounts: (s!.counts ?? []).filter((c) => c.kind === 'RECOUNT').length };
    ctx.audit(`session closed counted ${counted} expected ${exp} variance ${variance}`, s!.id, true, g?.id);
    event('SessionClosed', s!.id, `variance ${variance}`);
    return { session: s, variance, expectedCash: exp, countedCash: counted, z };
  },
  'Session.ZReport': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    if (!s!.close) throw new ApiError('SESSION_CLOSE_SNAPSHOT_NOT_FOUND');
    return { ...s!.close.z, kind: 'Z', frozen: true };
  },
  'Cash.Find': (ctx) => page(ctx.db.cashEntries.filter((e) => e.sessionId === ctx.params.sessionId), ctx.query),
  'Cash.Move': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    need(s!.state === 'OPEN', 'SESSION_NOT_OPEN');
    const kind = ctx.body.kind;
    if (!['PAY_IN', 'PAY_OUT', 'SAFE_DROP'].includes(kind)) throw new ApiError('CASH_MOVE_KIND_NOT_ALLOWED', { kind, allowed: ['PAY_IN', 'PAY_OUT', 'SAFE_DROP'] });
    need(isMoney(ctx.body.amount) && D(ctx.body.amount).gt(0), 'VALIDATION_FAILED', { field: 'amount' });
    reasonCheck(ctx, 'CASH_MOVE', ctx.body.reasonCode, ctx.body.reason);
    const g = ctx.requireApproval({ action: 'CASH_MOVE', targetType: 'sessions.Session', targetId: s!.id, context: { kind, amount: m4(ctx.body.amount), reasonCode: ctx.body.reasonCode }, grantId: ctx.body.approvalGrantId });
    const e = cashEntry(ctx, s!.id, kind, ctx.body.amount, { reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, ref: ctx.body.reference, approvalGrantId: g?.id });
    ctx.audit(`cash ${kind} ${e.amount}`, s!.id, true, g?.id);
    return { status: 201, body: e };
  },
  'Drawer.OpenNoSale': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    need(s!.state === 'OPEN', 'SESSION_NOT_OPEN');
    reasonCheck(ctx, 'NO_SALE', ctx.body.reasonCode, ctx.body.reason);
    const g = ctx.requireApproval({ action: 'DRAWER_NO_SALE', targetType: 'sessions.Session', targetId: s!.id, context: { reasonCode: ctx.body.reasonCode }, grantId: ctx.body.approvalGrantId });
    const e = cashEntry(ctx, s!.id, 'NO_SALE', '0', { reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id });
    ctx.audit('drawer no-sale open', s!.id, true, g?.id);
    const kick = kickDrawer(ctx.db, enqueuePrint, s!.terminalId, e.id, `فتح الدرج بلا بيع ${e.id}`, ctx.user!.id); // ux-14: the registered drawer, as a visible job
    return { status: 201, body: { ...e, drawerKick: kick ? 'queued' : 'NO_DRAWER', drawerJobId: kick?.id ?? null } };
  },
  'Session.Handover': () => { throw new ApiError('CAPABILITY_NOT_AVAILABLE', { reason: 'PD-held single command; ux-10b proposes Session.HandoverStart / HandoverAccept / HandoverCancel (ShiftHandoverPolicy)' }); },

  // ───────── refunds
  'Refund.Refundable': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status === 'DRAFT' || o.status === 'CANCELLED' || o.status === 'VOIDED') throw new ApiError('ORDER_NOT_CONFIRMED');
    return refundable(ctx, o);
  },
  'Refund.Request': (ctx) => {
    const db = ctx.db;
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'COMPLETED' && o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_CONFIRMED');
    requireFields(ctx, 'amount', 'method', 'allocations', 'reasonCode', 'reason');
    reasonCheck(ctx, 'REFUND', ctx.body.reasonCode, ctx.body.reason);
    const rf = refundable(ctx, o);
    const amount = m4(ctx.body.amount);
    need(D(amount).gt(0), 'VALIDATION_FAILED', { field: 'amount' });
    const allocs: { captureId: string; amount: string }[] = ctx.body.allocations;
    const sum = allocs.reduce((a, x) => a.plus(D(x.amount)), D(0));
    if (!sum.equals(D(amount))) throw new ApiError('VALIDATION_FAILED', { rule: 'allocations must add up to the amount' });
    if (D(amount).gt(rf.effectivePaid)) throw new ApiError('REFUND_EXCEEDS_PAID', { effectivePaid: rf.effectivePaid });
    const cross = policy<{ crossTender: string }>('RefundMethodPolicy')?.crossTender ?? 'DENY';
    for (const a of allocs) {
      const cap = rf.captures.find((c: any) => c.captureId === a.captureId);
      if (!cap) throw new ApiError('PAYMENTS_PAYMENTCAPTURE_NOT_FOUND', { captureId: a.captureId });
      if (D(a.amount).gt(cap.remaining)) throw new ApiError('REFUND_EXCEEDS_CAPTURE', { captureId: a.captureId, remaining: cap.remaining });
      const ok = cross === 'ALLOW_ANY' || cap.method === ctx.body.method || (cross === 'ALLOW_TO_CASH' && ctx.body.method === 'CASH');
      if (!ok) throw new ApiError('CROSS_TENDER_REFUND_DENIED', { captureMethod: cap.method, refundMethod: ctx.body.method, policy: `RefundMethodPolicy ${cross}` });
    }
    // r3A: the stage decides the authority — same day (S2) or after the business day closed (S3, a linked return today)
    const stage = paidStage(db, o);
    const lines = (ctx.body.lines ?? []).map((l: any) => ({ lineId: l.lineId, quantity: String(l.quantity), ...(checkDisposition(l.disposition, 'lines.disposition') ? { disposition: l.disposition } : {}) }));
    const r = { id: nextId('ref'), orderId: o.id, amount, method: ctx.body.method, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, state: 'REQUESTED' as const, allocations: allocs.map((a) => ({ captureId: a.captureId, amount: m4(a.amount) })), lines, requestedBy: ctx.user!.id, requestedAt: ctx.nowIso, version: 1, stage, afterClose: stage === 'S3', originalBusinessDate: paidDateOf(db, o) };
    db.refunds.push(r);
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, kind: 'REFUND_REQUESTED', text: { ar: `طلب ${stage === 'S3' ? 'مرتجع بعد إغلاق اليوم' : 'مرتجع'} ${amount} ج.م (${ctx.body.reasonCode})`, en: `refund requested ${amount}` }, terminal: ctx.terminal?.code });
    ctx.audit(`refund requested ${amount} on ${o.number} (${stage})`, r.id, true, undefined, { stage });
    return { status: 201, body: r };
  },
  'Refund.Approve': (ctx) => {
    const db = ctx.db;
    const r = db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    const o = getOrder(ctx, r!.orderId);
    if (r!.state !== 'REQUESTED') throw new ApiError('REFUND_CASE_NOT_PENDING', { state: r!.state });
    checkVersion(r!, ctx.body.expectedVersion);
    const payout = (ctx.body.payoutMethod ?? r!.method) as TenderMethod;
    // r3A (F2-01): the cashier runs the payout on their own device; a manager authorises there (PIN / card / finger /
    // remote); cash leaves THAT drawer. After the day closed (S3) the third-level permission authorises it.
    const stage = paidStage(db, o);
    if (payout === 'CASH' && !openSessionOn(db, ctx.terminal?.id)) throw new ApiError('REFUND_NEEDS_CASHIER_DRAWER', { reason: 'a cash refund is paid out of the open drawer of the cashier device that runs it', terminal: ctx.terminal?.code ?? null });
    const g = stage === 'S3'
      ? ctx.requireApproval({ action: 'RETURN_AFTER_CLOSE', targetType: 'refunds.RefundCase', targetId: r!.id, context: { orderId: o.id, amount: r!.amount, originalBusinessDate: paidDateOf(db, o), reasonCode: r!.reasonCode, method: payout, stage }, grantId: ctx.body.approvalGrantId })
      : ctx.requireApproval({ action: 'REFUND_APPROVE', targetType: 'refunds.RefundCase', targetId: r!.id, context: { amount: r!.amount, reasonCode: r!.reasonCode, method: payout }, grantId: ctx.body.approvalGrantId });
    if (g && g.approverUserId === r!.requestedBy && !ctx.body.allowSelf) throw new ApiError('SELF_APPROVAL_DENIED', { reason: 'the refund requester cannot approve it' });
    let session: Session | null = null;
    if (payout === 'CASH') {
      session = openSessionOn(db, ctx.terminal?.id);
      if (!session) throw new ApiError('SESSION_NOT_OPEN', { reason: 'a cash refund is paid out of an open drawer on this terminal' });
      cashEntry(ctx, session.id, 'REFUND_OUT', r!.amount, { ref: o.number, approvalGrantId: g?.id, reasonCode: r!.reasonCode });
    }
    r!.state = 'PAID';
    r!.decidedBy = ctx.user!.id;
    r!.decidedAt = ctx.nowIso;
    r!.paidAt = ctx.nowIso;
    r!.paidSessionId = session?.id ?? openSessionOn(db, ctx.terminal?.id)?.id;
    r!.businessDate = ctx.businessDate(o.branchId);
    r!.approvalGrantId = g?.id;
    r!.version++;
    const drawerOwner = session ? session.userId : null;
    Object.assign(r!, { stage, afterClose: stage === 'S3', originalBusinessDate: paidDateOf(db, o), approverId: g?.approverUserId ?? null, paidBy: ctx.user!.id, drawerOwnerId: drawerOwner, paidTerminalId: ctx.terminal?.id ?? null });
    // trace per returned line (or the amount alone) with the item disposition and its stock effect
    const lineRows = r!.lines.length ? r!.lines : [null];
    const allocated = allocate(r!.amount, lineRows.map((x) => { const l = x && o.lines.find((y) => y.id === x.lineId); return l ? D(l.unitTotal).times(x!.quantity) : D(1); }), 2);
    lineRows.forEach((x, i) => {
      const l = x ? o.lines.find((y) => y.id === x.lineId) ?? null : null;
      const disp = x?.disposition ?? (l ? 'WASTE_HELD' : null);
      if (l && x) stockForReturn(ctx, o, l, x.quantity, disp);
      recordReversal(ctx, { o, line: l, name: l ? undefined : { ar: 'مبلغ من الشيك', en: 'Amount of the check' }, quantity: x?.quantity ?? '1', value: allocated[i], stage, kind: stage === 'S3' ? 'RETURN_AFTER_CLOSE' : 'REFUND', grant: g, reasonCode: r!.reasonCode, reason: r!.reason, disposition: disp, sessionId: session?.id ?? null, refundId: r!.id, afterClose: stage === 'S3' });
    });
    const dispText = r!.lines.map((x) => x.disposition ? DISP_AR[x.disposition] : '').filter(Boolean)[0];
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, terminal: ctx.terminal?.code, kind: 'REFUND_PAID', text: { ar: `${stage === 'S3' ? `مرتجع بعد قفل يوم ${paidDateOf(db, o)} — اتسجل على يوم ${ctx.businessDate(o.branchId)} — ` : ''}المرتجع اتصرف ${Number(r!.amount).toFixed(2)} ج.م ${payout === 'CASH' ? `كاش من درج ${userName(db, drawerOwner)}` : payout}${dispText ? ` (${dispText})` : ''} — ${approvedText(db, g)}`, en: `refund paid ${r!.amount} ${payout}` }, data: { stage, grantId: g?.id, approverId: g?.approverUserId, sessionId: session?.id } });
    ctx.audit(`refund paid ${r!.amount} ${payout} (${stage})`, r!.id, true, g?.id, { stage });
    if (ctx.terminal) enqueuePrint(db, { documentType: 'RECEIPT', documentId: r!.id, copyKind: 'ORIGINAL', terminalId: ctx.terminal.id, createdBy: ctx.user!.id, label: `إيصال مرتجع ${o.number}` });
    return r;
  },
  'Refund.Reject': (ctx) => {
    const r = ctx.db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    if (r!.state !== 'REQUESTED') throw new ApiError('REFUND_CASE_NOT_PENDING');
    r!.state = 'REJECTED'; r!.decidedBy = ctx.user!.id; r!.decidedAt = ctx.nowIso; r!.version++;
    return r;
  },
  // ux-10 (PROPOSED rule on the existing command): the person who requested a pending refund withdraws it before it is
  // approved or paid, with a required reason; a holder of refund:reject (the decider) may also withdraw it. CAS on the
  // case version; the cancellation is a new fact (who, when, why) on the case, the check's history and the audit — the
  // request itself is never rewritten.
  'Refund.Cancel': (ctx) => {
    const r = ctx.db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    const o = getOrder(ctx, r!.orderId, 'REFUNDS_REFUNDCASE_NOT_FOUND'); // another branch's case is "not found"
    // ux-10b RefundCancelPolicy: requester or refund:reject holder (default) / requester only / refund:reject holder only
    const cancelBy = policyFields<{ cancelBy: string }>('RefundCancelPolicy', { branchId: o.branchId }).cancelBy;
    const isReq = r!.requestedBy === ctx.user!.id, isDec = ctx.can('refund:reject');
    const allowed = cancelBy === 'REQUESTER_ONLY' ? isReq : cancelBy === 'DECIDER_ONLY' ? isDec : isReq || isDec;
    if (!allowed) throw new ApiError('REFUND_CANCEL_NOT_REQUESTER', { reason: 'RefundCancelPolicy decides who withdraws a refund request', cancelBy }, 403);
    const reason = reasonText(ctx, ctx.body.reason, 'VALIDATION_FAILED'); // ReasonTextPolicy.minLength, ≤ 200
    if (r!.state !== 'REQUESTED') throw new ApiError('REFUND_CASE_NOT_PENDING', { state: r!.state });
    checkVersion(r!, ctx.body.expectedVersion);
    r!.state = 'CANCELLED';
    Object.assign(r!, { cancelledBy: ctx.user!.id, cancelledAt: ctx.nowIso, cancelReason: reason });
    r!.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, terminal: ctx.terminal?.code, kind: 'REFUND_CANCELLED', text: { ar: `أُلغي طلب المرتجع ${D(r!.amount).toFixed(2)} ج.م — ${reason}`, en: `refund request ${r!.amount} cancelled — ${reason}` }, data: { refundId: r!.id, requestedBy: r!.requestedBy } });
    ctx.audit(`refund request ${r!.amount} on ${o.number} cancelled: ${reason}`, r!.id, true);
    return r;
  },
  'Refund.Find': (ctx) => page(ctx.db.refunds.filter((r) => ctx.db.orders.find((o) => o.id === r.orderId)?.branchId === ctx.branchId).map((r) => ({ ...r, orderNumber: ctx.db.orders.find((o) => o.id === r.orderId)?.number, requestedByName: userName(ctx.db, r.requestedBy), cancelledByName: r.cancelledBy ? userName(ctx.db, r.cancelledBy) : null, approverName: r.approverId ? userName(ctx.db, r.approverId) : null, drawerOwnerName: r.drawerOwnerId ? userName(ctx.db, r.drawerOwnerId) : null, paidByName: r.paidBy ? userName(ctx.db, r.paidBy) : null })), ctx.query),
  'Refund.Get': (ctx) => {
    const r = ctx.db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    return r;
  },

  // ───────── direction: deposits (D10) and tips (D6)
  'Deposit.Find': (ctx) => {
    let list = ctx.db.deposits.filter((d) => d.branchId === ctx.branchId);
    if (ctx.query.customerId) list = list.filter((d) => d.customerId === ctx.query.customerId);
    if (ctx.query.state) list = list.filter((d) => String(ctx.query.state).split(',').includes(d.state));
    return page(list.map((d) => depositView(ctx.db, d)), ctx.query);
  },
  'Deposit.Create': (ctx) => {
    requireFields(ctx, 'customer', 'amount', 'method', 'purpose');
    const s = openSessionOn(ctx.db, ctx.terminal?.id);
    if (!s) throw new ApiError('SESSION_NOT_OPEN');
    need(isMoney(ctx.body.amount) && D(ctx.body.amount).gt(0), 'VALIDATION_FAILED', { field: 'amount', rule: 'positive amount' });
    if ((ctx.body.method === 'CARD' || ctx.body.method === 'DIGITAL_WALLET') && !ctx.body.reference) throw new ApiError('TENDER_REFERENCE_REQUIRED');
    // ux-12: the customer record when the screen picked one (the name stays as written for legacy readers)
    const cust = ctx.body.customerId ? (ctx.db.customers ?? []).find((c) => c.id === ctx.body.customerId) : null;
    if (ctx.body.customerId && !cust) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: ctx.body.customerId }, 404);
    // ux-12: a deposit taken for a reservation that already exists (the screen books first, then takes the deposit)
    const resv = ctx.body.reservationId ? ctx.db.reservations.find((x) => x.id === ctx.body.reservationId && x.branchId === ctx.branchId) : null;
    if (ctx.body.reservationId && !resv) throw new ApiError('RESERVATION_NOT_FOUND', { reservationId: ctx.body.reservationId }, 404);
    if (resv && resv.state !== 'BOOKED') throw new ApiError('RESERVATION_NOT_BOOKED', { state: resv.state }, 409);
    if (resv && resv.depositId && ctx.db.deposits.some((x) => x.id === resv.depositId && x.state === 'HELD')) throw new ApiError('VALIDATION_FAILED', { field: 'reservationId', rule: 'the reservation already holds a deposit' });
    const d = { id: nextId('dep'), branchId: ctx.branchId!, customer: cust?.name ?? ctx.body.customer, phone: cust?.phone ?? ctx.body.phone, customerId: cust?.id ?? null, amount: m4(ctx.body.amount), method: ctx.body.method, reference: ctx.body.reference, purpose: ctx.body.purpose, state: 'HELD' as const, reservationId: resv?.id, createdAt: ctx.nowIso, sessionId: s.id, by: ctx.user!.id, version: 1, applications: [], refunds: [], forfeit: null };
    ctx.db.deposits.push(d);
    if (d.method === 'CASH') cashEntry(ctx, s.id, 'DEPOSIT_IN', d.amount, { ref: d.id });
    if (resv) {
      pushResEvent(resv, { at: ctx.nowIso, by: ctx.user!.id, kind: 'UPDATED', changes: [{ field: 'depositId', from: resv.depositId, to: d.id }], amount: d.amount, ref: d.id });
      resv.depositId = d.id; resv.version = (resv.version ?? 1) + 1;
      if (!d.customerId && resv.customerId) d.customerId = resv.customerId;
    }
    ctx.audit(`deposit ${d.amount} ${d.method} from ${d.customer}${resv ? ` for reservation ${resv.id}` : ''}`, d.id);
    return { status: 201, body: depositView(ctx.db, d) };
  },
  // ux-12: a deposit is applied up to what remains of it and of the check (amount optional: the smaller of the two).
  // Each application is an append-only record with its DEPOSIT capture; the deposit is APPLIED when nothing remains.
  'Deposit.Apply': (ctx) => {
    const d = ctx.db.deposits.find((x) => x.id === ctx.params.depositId && x.branchId === ctx.branchId);
    need(d && d.state === 'HELD', 'VALIDATION_FAILED', { reason: 'deposit not held' });
    if (ctx.body.expectedVersion !== undefined) checkVersion({ version: depVersion(d!) }, ctx.body.expectedVersion);
    const o = getOrder(ctx, ctx.body.orderId);
    if (o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_CONFIRMED');
    const st = settlementOf(ctx.db, o);
    const left = depositBalances(d!).remaining;
    const amount = ctx.body.amount !== undefined && ctx.body.amount !== null && ctx.body.amount !== '' ? m4(ctx.body.amount) : m4(D(left).lt(D(st.remaining)) ? left : st.remaining);
    need(isMoney(ctx.body.amount ?? amount) && D(amount).gt(0), 'VALIDATION_FAILED', { field: 'amount', rule: 'positive amount' });
    if (D(amount).gt(D(st.remaining))) throw new ApiError('OVERPAYMENT', { remaining: st.remaining, deposit: d!.amount, amount });
    if (D(amount).gt(D(left))) throw new ApiError('DEPOSIT_OVER_REMAINING', { remaining: left, amount }, 409);
    const s = openSessionOn(ctx.db, ctx.terminal?.id) ?? ctx.db.sessions.find((x) => x.id === d!.sessionId)!;
    const cap = { id: nextId('cap'), orderId: o.id, method: 'DEPOSIT' as TenderMethod, amount, tendered: null, change: '0.0000', reference: d!.id, sessionId: s.id, terminalId: ctx.terminal?.id ?? '', branchId: o.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(o.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', depositId: d!.id };
    ctx.db.captures.push(cap as Capture);
    // a deposit applied before ux-12 records keeps its whole amount as one application
    (d!.applications ??= []).push({ id: nextId('dap'), orderId: o.id, orderNumber: o.number, amount, captureId: cap.id, at: ctx.nowIso, by: ctx.user!.id });
    const after = depositBalances(d!).remaining;
    if (D(after).lte(0)) d!.state = 'APPLIED';
    d!.appliedOrderId = o.id;
    d!.version = depVersion(d!) + 1;
    const r = d!.reservationId ? ctx.db.reservations.find((x) => x.id === d!.reservationId) : null;
    if (r) pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_APPLIED', amount, ref: o.id });
    o.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_APPLIED', text: { ar: `خُصم عربون ${D(amount).toFixed(2)} ج.م (كان التزامًا، وأصبح مبيعات الآن)`, en: `deposit ${D(amount).toFixed(2)} applied` } });
    ctx.audit(`deposit ${d!.id} applied ${amount} to ${o.number}${D(after).gt(0) ? ` (${after} remains)` : ''}`, d!.id);
    return { deposit: depositView(ctx.db, d!), settlement: settlementOf(ctx.db, o) };
  },
  // ux-12: refund what remains of a deposit out of THIS terminal's drawer (PAY_OUT, reason code DEPOSIT_REFUND) in an
  // open shift, with a required reason and a manager's approval (DEPOSIT_REFUND). Never more than the unapplied,
  // unrefunded remainder; refused while its reservation is still booked (cancel first) or after it was forfeited. The
  // refund is an immutable record; the deposit becomes REFUNDED when nothing remains. CAS on the deposit version.
  'Deposit.Refund': (ctx) => {
    const d = ctx.db.deposits.find((x) => x.id === ctx.params.depositId && x.branchId === ctx.branchId);
    if (!d) throw new ApiError('DEPOSIT_NOT_FOUND', { depositId: ctx.params.depositId }, 404);
    const reason = reasonText(ctx, ctx.body.reason); // ux-10b: ReasonTextPolicy.minLength (default 3), ≤ 200
    checkVersion({ version: depVersion(d) }, ctx.body.expectedVersion);
    const block = refundBlock(ctx.db, d);
    const b = depositBalances(d);
    if (block === 'RESERVATION_ACTIVE') throw new ApiError('DEPOSIT_RESERVATION_ACTIVE', { reservationId: d.reservationId }, 409);
    if (block) throw new ApiError('DEPOSIT_NOT_REFUNDABLE', { state: d.state, remaining: b.remaining, why: block }, 409);
    const raw = ctx.body.amount === undefined || ctx.body.amount === null || ctx.body.amount === '' ? b.remaining : ctx.body.amount;
    need(isMoney(raw) && D(raw).gt(0), 'VALIDATION_FAILED', { field: 'amount', rule: 'positive amount' });
    const amount = m4(raw);
    if (D(amount).gt(D(b.remaining))) throw new ApiError('DEPOSIT_REFUND_OVER_REMAINING', { remaining: b.remaining, amount, applied: b.applied, refunded: b.refunded }, 409);
    const s = openSessionOn(ctx.db, ctx.terminal?.id);
    if (!s) throw new ApiError('SESSION_NOT_OPEN', { reason: 'a deposit is refunded out of a terminal with an open drawer' });
    const g = ctx.requireApproval({ action: 'DEPOSIT_REFUND', targetType: 'payments.Deposit', targetId: d.id, context: { depositId: d.id, reservationId: d.reservationId ?? null, amount, remaining: b.remaining }, grantId: ctx.body.approvalGrantId });
    ctx.db.seq['deposit_refund_no'] = (ctx.db.seq['deposit_refund_no'] ?? 0) + 1;
    const rf = { id: nextId('drf'), number: `DR-${String(ctx.db.seq['deposit_refund_no']).padStart(4, '0')}`, amount, remainingBefore: b.remaining, reason, at: ctx.nowIso, by: ctx.user!.id, sessionId: s.id, terminalId: ctx.terminal!.id, approvalGrantId: g?.id ?? null, approverUserId: g?.approverUserId ?? null };
    (d.refunds ??= []).push(rf);
    cashEntry(ctx, s.id, 'PAY_OUT', amount, { reasonCode: 'DEPOSIT_REFUND', reason: `رد عربون ${d.customer} (${rf.number}) — ${reason}`, ref: rf.number, approvalGrantId: g?.id });
    const after = depositBalances(d).remaining;
    if (D(after).lte(0)) d.state = 'REFUNDED';
    d.version = depVersion(d) + 1;
    const r = d.reservationId ? ctx.db.reservations.find((x) => x.id === d.reservationId) : null;
    if (r) { pushResEvent(r, { at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_REFUNDED', amount, reason, ref: rf.number }); r.version = (r.version ?? 1) + 1; }
    ctx.audit(`deposit ${d.id} (${d.customer}) refunded ${amount} of ${b.remaining} from the drawer (${rf.number}): ${reason}`, d.id, true, g?.id);
    event('DepositRefunded', d.id, `${rf.number} ${amount}`);
    return { status: 201, body: { refund: rf, deposit: depositView(ctx.db, d) } };
  },
  'Tip.Distribute': (ctx) => {
    const db = ctx.db;
    const s = db.sessions.find((x) => x.id === ctx.params.sessionId);
    need(s, 'SESSION_NOT_FOUND');
    const tips = db.tips.filter((t) => t.sessionId === s!.id && !t.distributed);
    const mode = policy<string>('TipDistributionPolicy') ?? 'PER_SERVER';
    const total = tips.reduce((a, t) => a.plus(D(t.amount)), D(0));
    const lines: { userId: string; name: string; amount: string }[] = [];
    if (mode === 'PER_SERVER') {
      const by = new Map<string, any>();
      for (const t of tips) by.set(t.serverUserId, (by.get(t.serverUserId) ?? D(0)).plus(D(t.amount)));
      for (const [u, a] of by) lines.push({ userId: u, name: userName(db, u), amount: m4(a) });
    } else {
      const staff = [...new Set(db.orders.filter((o) => o.businessDate === s!.businessDate).map((o) => o.serverUserId))];
      const parts = allocate(total, staff.map(() => 1), 2);
      staff.forEach((u, i) => lines.push({ userId: u, name: userName(db, u), amount: parts[i] }));
    }
    tips.forEach((t) => (t.distributed = true));
    const cashTips = tips.filter((t) => t.method === 'CASH').reduce((a, t) => a.plus(D(t.amount)), D(0));
    if (cashTips.gt(0) && s!.state === 'OPEN') cashEntry(ctx, s!.id, 'TIP_OUT', m4(cashTips));
    return { mode, total: m4(total), lines };
  },
};

export function refundable(ctx: Ctx, o: Order) {
  const db = ctx.db;
  const caps = db.captures.filter((c) => c.orderId === o.id && !c.correctionOf && !c.corrected);
  const allocated = new Map<string, any>();
  for (const r of db.refunds.filter((x) => x.orderId === o.id && (x.state === 'PAID' || x.state === 'REQUESTED' || x.state === 'APPROVED'))) for (const a of r.allocations) allocated.set(a.captureId, (allocated.get(a.captureId) ?? D(0)).plus(D(a.amount)));
  const captures = [...caps, ...db.captures.filter((c) => c.orderId === o.id && c.correctionOf && D(c.amount).gt(0))].map((c) => ({ captureId: c.id, method: c.method, reference: c.reference, amount: c.amount, remaining: m4(D(c.amount).minus(allocated.get(c.id) ?? 0)) }));
  const t = computeTotals(o);
  const active = o.lines.filter((l) => l.status === 'ACTIVE');
  // each line's refundable amount carries its share of discount, service and VAT (largest remainder)
  const shares = allocate(t.payable, active.map((l) => l.lineTotal), 2);
  const refundedQty = new Map<string, any>();
  for (const r of db.refunds.filter((x) => x.orderId === o.id && x.state !== 'REJECTED' && x.state !== 'CANCELLED')) for (const l of r.lines) refundedQty.set(l.lineId, (refundedQty.get(l.lineId) ?? D(0)).plus(D(l.quantity)));
  const lines = active.map((l, i) => {
    const unit = D(shares[i]).dividedBy(D(l.quantity));
    return { lineId: l.id, name: l.name, quantity: l.quantity, refundedQuantity: (refundedQty.get(l.id) ?? D(0)).toString(), unitRefundable: round(unit, 2), lineRefundable: shares[i] };
  });
  const st = settlementOf(db, o);
  // r3A: the stage tells the screen who must authorise (same day vs after the day closed) and where it is booked
  return { captures, lines, effectivePaid: st.effectivePaid, payable: t.payable, stage: paidStage(db, o), paidBusinessDate: paidDateOf(db, o), bookedOn: ctx.businessDate(o.branchId), kind: o.kind };
}

/** ux-10b: the handover links of a session for the history and the reports (the counts only once it is accepted). */
function handoverLinks(ctx: Ctx, s: Session) {
  const hs = handoversOf(ctx.db);
  const out = s.handoverId ? hs.find((h) => h.id === s.handoverId) : null;
  const inn = s.handoverFromId ? hs.find((h) => h.id === s.handoverFromId) : null;
  const cancelled = hs.filter((h) => h.outgoingSessionId === s.id && h.state === 'CANCELLED').length;
  return { handover: out ? handoverView(ctx.db, out) : null, handoverFrom: inn ? handoverView(ctx.db, inn) : null, cancelledHandovers: cancelled };
}
