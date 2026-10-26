import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event } from '../store';
import { policy, channelPolicy } from '../policies';
import { computeTotals } from '../pricing';
import { enqueuePrint } from '../outbox';
import { D, m4, add, sub, allocate, isMoney, round } from '../money';
import { checkVersion, getOrder, need, openSessionOn, page, reasonCheck, requireFields, settlementOf, userName } from './util';
import type { Capture, CashEntry, Session, ZReport, Order, TenderMethod } from '../types';

function cashEntry(ctx: Ctx, sessionId: string, kind: CashEntry['kind'], amount: string, extra: Partial<CashEntry> = {}) {
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
  return {
    sessionId: s.id, terminalCode: db.terminals.find((t) => t.id === s.terminalId)?.code ?? s.terminalId, cashierName: userName(db, s.userId), openedAt: s.openedAt, closedAt: s.closedAt ?? '', businessDate: s.businessDate,
    openingFloat: s.openingFloat, tenderBreakdown: tender, refundBreakdown: refunds, cashByKind: byKind, expectedCash: expectedCash(ctx, s.id), orderCounts: counts, outstandingChecks: outstanding, tips, snapshotAt: frozenAt ?? ctx.nowIso,
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
      if (method !== 'DEPOSIT' && !enabled.includes(method)) throw new ApiError('TENDER_METHOD_DISABLED', { method, enabled });
      const reference = (t.reference ?? ctx.body.tenderReference ?? '').trim() || null;
      if ((method === 'CARD' || method === 'DIGITAL_WALLET') && !reference) throw new ApiError('TENDER_REFERENCE_REQUIRED', { method });
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
    o.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, terminal: ctx.terminal?.code, kind: 'CAPTURED', text: { ar: `اتدفع ${created.map((c) => `${c.method === 'CASH' ? 'كاش' : c.method === 'CARD' ? 'كارت' : c.method} ${c.amount}${c.reference ? ' (' + c.reference + ')' : ''}`).join(' + ')}${changeTotal.gt(0) ? ` — الباقي للعميل ${m4(changeTotal)}` : ''}`, en: `captured ${created.map((c) => `${c.method} ${c.amount}`).join(' + ')}` } });
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
    if ((to === 'CARD' || to === 'DIGITAL_WALLET') && !(ctx.body.reference ?? '').trim()) throw new ApiError('TENDER_REFERENCE_REQUIRED');
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
    if (openSessionOn(db, t!.id)) throw new ApiError('SESSION_ALREADY_OPEN', { terminal: t!.code });
    need(isMoney(ctx.body.openingFloat) && D(ctx.body.openingFloat).gte(0), 'VALIDATION_FAILED', { field: 'openingFloat' });
    const s: Session = { id: nextId('sess'), terminalId: t!.id, branchId: t!.branchId, userId: ctx.user!.id, state: 'OPEN', openingFloat: m4(ctx.body.openingFloat), openedAt: ctx.nowIso, openedAtMs: ctx.now, businessDate: ctx.businessDate(t!.branchId), closedAt: null, closedBy: null, version: 1, close: null };
    db.sessions.push(s);
    cashEntry(ctx, s.id, 'OPENING_FLOAT', s.openingFloat);
    s.version = 1;
    ctx.audit(`session opened on ${t!.code} float ${s.openingFloat}`, s.id);
    event('SessionOpened', s.id, `${t!.code} by ${ctx.user!.username}`);
    return { status: 201, body: s };
  },
  'Session.Find': (ctx) => page(ctx.db.sessions.filter((s) => s.branchId === ctx.branchId && (!ctx.query.state || s.state === ctx.query.state)).sort((a, b) => b.openedAtMs - a.openedAtMs).map((s) => ({ ...s, cashierName: userName(ctx.db, s.userId), terminalCode: ctx.db.terminals.find((t) => t.id === s.terminalId)?.code })), ctx.query),
  'Session.Get': (ctx) => {
    const s = ctx.db.sessions.find((x) => x.id === ctx.params.sessionId && x.branchId === ctx.branchId);
    need(s, 'SESSION_NOT_FOUND');
    const sp = policy<{ maxHours: number; warningHours: number }>('SessionDurationPolicy') ?? { maxHours: 24, warningHours: 12 };
    const hours = (ctx.now - s!.openedAtMs) / 3_600_000;
    return { ...s, cashierName: userName(ctx.db, s!.userId), terminalCode: ctx.db.terminals.find((t) => t.id === s!.terminalId)?.code, hoursOpen: Number(hours.toFixed(1)), durationWarning: s!.state === 'OPEN' && hours >= sp.warningHours, durationExceeded: s!.state === 'OPEN' && hours >= sp.maxHours, cashEntries: ctx.db.cashEntries.filter((e) => e.sessionId === s!.id) };
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
    need(s!.state === 'OPEN', 'SESSION_NOT_OPEN');
    checkVersion(s!, ctx.body.expectedVersion);
    const open = db.orders.filter((o) => o.sessionId === s!.id && (o.status === 'DRAFT' || o.status === 'CONFIRMED'));
    if (open.length) throw new ApiError('SESSION_HAS_OPEN_ORDERS', { orders: open.map((o) => o.number), rule: 'counter/takeaway checks of this drawer must end first; floor checks never block' });
    need(isMoney(ctx.body.countedCash), 'VALIDATION_FAILED', { field: 'countedCash' });
    const counted = m4(ctx.body.countedCash);
    const exp = expectedCash(ctx, s!.id);
    const variance = sub(counted, exp);
    const g = ctx.requireApproval({ action: 'SESSION_VARIANCE', targetType: 'sessions.Session', targetId: s!.id, context: { countedCash: counted, expectedCash: exp, absVariance: m4(D(variance).abs()) }, grantId: ctx.body.approvalGrantId });
    s!.state = 'CLOSED';
    s!.closedAt = ctx.nowIso;
    s!.closedBy = ctx.user!.id;
    s!.version++;
    const z = { ...report(ctx, s!, ctx.nowIso), countedCash: counted, variance } as ZReport;
    s!.close = { countedCash: counted, expectedCash: exp, variance, approvalGrantId: g?.id, reason: ctx.body.reason, z };
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
    return { status: 201, body: { ...e, drawerKick: 'queued' } };
  },
  'Session.Handover': () => { throw new ApiError('CAPABILITY_NOT_AVAILABLE', { reason: 'PD-held: a shift handover is a counted close then a new open (J-R1 steps 17–18)' }); },

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
    const r = { id: nextId('ref'), orderId: o.id, amount, method: ctx.body.method, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, state: 'REQUESTED' as const, allocations: allocs.map((a) => ({ captureId: a.captureId, amount: m4(a.amount) })), lines: ctx.body.lines ?? [], requestedBy: ctx.user!.id, requestedAt: ctx.nowIso, version: 1 };
    db.refunds.push(r);
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, kind: 'REFUND_REQUESTED', text: { ar: `طلب مرتجع ${amount} (${ctx.body.reasonCode})`, en: `refund requested ${amount}` } });
    ctx.audit(`refund requested ${amount} on ${o.number}`, r.id, true);
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
    const g = ctx.requireApproval({ action: 'REFUND_APPROVE', targetType: 'refunds.RefundCase', targetId: r!.id, context: { amount: r!.amount, reasonCode: r!.reasonCode, method: payout }, grantId: ctx.body.approvalGrantId });
    if (g && g.approverUserId === r!.requestedBy && !ctx.body.allowSelf) throw new ApiError('SELF_APPROVAL_DENIED', { reason: 'the refund requester cannot approve it' });
    let session: Session | null = null;
    if (payout === 'CASH') {
      session = openSessionOn(db, ctx.terminal?.id);
      if (!session) throw new ApiError('SESSION_NOT_OPEN', { reason: 'a cash refund is paid out of an open drawer on this terminal' });
      cashEntry(ctx, session.id, 'REFUND_OUT', r!.amount, { ref: o.number, approvalGrantId: g?.id });
    }
    r!.state = 'PAID';
    r!.decidedBy = ctx.user!.id;
    r!.decidedAt = ctx.nowIso;
    r!.paidAt = ctx.nowIso;
    r!.paidSessionId = session?.id ?? openSessionOn(db, ctx.terminal?.id)?.id;
    r!.businessDate = ctx.businessDate(o.branchId);
    r!.approvalGrantId = g?.id;
    r!.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, byName: ctx.user!.displayName, kind: 'REFUND_PAID', text: { ar: `المرتجع اتصرف ${r!.amount} ${payout === 'CASH' ? 'كاش من الدرج' : payout}${g ? ' بموافقة ' + userName(db, g.approverUserId) : ''}`, en: `refund paid ${r!.amount} ${payout}` } });
    ctx.audit(`refund paid ${r!.amount} ${payout}`, r!.id, true, g?.id);
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
  'Refund.Cancel': (ctx) => {
    const r = ctx.db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    if (r!.state !== 'REQUESTED') throw new ApiError('REFUND_CASE_NOT_PENDING');
    r!.state = 'CANCELLED'; r!.version++;
    return r;
  },
  'Refund.Find': (ctx) => page(ctx.db.refunds.filter((r) => ctx.db.orders.find((o) => o.id === r.orderId)?.branchId === ctx.branchId).map((r) => ({ ...r, orderNumber: ctx.db.orders.find((o) => o.id === r.orderId)?.number })), ctx.query),
  'Refund.Get': (ctx) => {
    const r = ctx.db.refunds.find((x) => x.id === ctx.params.refundCaseId);
    need(r, 'REFUNDS_REFUNDCASE_NOT_FOUND');
    return r;
  },

  // ───────── direction: deposits (D10) and tips (D6)
  'Deposit.Find': (ctx) => page(ctx.db.deposits.filter((d) => d.branchId === ctx.branchId), ctx.query),
  'Deposit.Create': (ctx) => {
    requireFields(ctx, 'customer', 'amount', 'method', 'purpose');
    const s = openSessionOn(ctx.db, ctx.terminal?.id);
    if (!s) throw new ApiError('SESSION_NOT_OPEN');
    if ((ctx.body.method === 'CARD' || ctx.body.method === 'DIGITAL_WALLET') && !ctx.body.reference) throw new ApiError('TENDER_REFERENCE_REQUIRED');
    const d = { id: nextId('dep'), branchId: ctx.branchId!, customer: ctx.body.customer, phone: ctx.body.phone, amount: m4(ctx.body.amount), method: ctx.body.method, reference: ctx.body.reference, purpose: ctx.body.purpose, state: 'HELD' as const, reservationId: ctx.body.reservationId, createdAt: ctx.nowIso, sessionId: s.id, by: ctx.user!.id };
    ctx.db.deposits.push(d);
    if (d.method === 'CASH') cashEntry(ctx, s.id, 'DEPOSIT_IN', d.amount, { ref: d.id });
    if (ctx.body.reservationId) { const r = ctx.db.reservations.find((x) => x.id === ctx.body.reservationId); if (r) r.depositId = d.id; }
    return { status: 201, body: d };
  },
  'Deposit.Apply': (ctx) => {
    const d = ctx.db.deposits.find((x) => x.id === ctx.params.depositId && x.branchId === ctx.branchId);
    need(d && d.state === 'HELD', 'VALIDATION_FAILED', { reason: 'deposit not held' });
    const o = getOrder(ctx, ctx.body.orderId);
    if (o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_CONFIRMED');
    const st = settlementOf(ctx.db, o);
    if (D(d!.amount).gt(st.remaining)) throw new ApiError('OVERPAYMENT', { remaining: st.remaining, deposit: d!.amount });
    const s = openSessionOn(ctx.db, ctx.terminal?.id) ?? ctx.db.sessions.find((x) => x.id === d!.sessionId)!;
    ctx.db.captures.push({ id: nextId('cap'), orderId: o.id, method: 'DEPOSIT', amount: d!.amount, tendered: null, change: '0.0000', reference: d!.id, sessionId: s.id, terminalId: ctx.terminal?.id ?? '', branchId: o.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(o.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', depositId: d!.id });
    d!.state = 'APPLIED';
    d!.appliedOrderId = o.id;
    o.version++;
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'DEPOSIT_APPLIED', text: { ar: `اتخصم عربون ${d!.amount} (كان التزام، بقى مبيعات دلوقتي)`, en: `deposit ${d!.amount} applied` } });
    return { deposit: d, settlement: settlementOf(ctx.db, o) };
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
  return { captures, lines, effectivePaid: st.effectivePaid, payable: t.payable };
}
