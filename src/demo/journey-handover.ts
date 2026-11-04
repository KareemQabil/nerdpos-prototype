// ux-10b journey J-H1 — shift handover and the remaining defaults as settings, against the mock, on «جهاز الكاشير 2»:
// the standard opening float (another amount needs a manager), the handover in the default mode (dual blind count,
// same amount, no approval), a shortage over the SESSION_VARIANCE threshold (manager approval, on the outgoing cashier),
// a count mismatch (recount, then a manager with a reason), the refusals (same cashier, not the owner, FULL_CLOSE, a
// pending drawer, the locked count), a cancelled handover, DIRECT_SWAP, the approved blind recount, the opening float
// LOCKED / FREE, who withdraws a refund request, the reason length and who pays a rider out of which drawer. Every policy
// change goes through Settings.UpdatePolicy with the SENSITIVE_POLICY_CHANGE approval (the audited path).
import { api, as, expectRefusal, withApproval, order, type Logger } from './runner';
import { store } from '../mock/store';
import { devices } from '../app/devices';
import { t } from '../i18n';
import { D, m4 } from '../mock/money';
import type { StepDef } from './scripts';

const T = 't_cash2';
const SIGN: Record<string, number> = { OPENING_FLOAT: 1, TENDER_IN: 1, REFUND_OUT: -1, PAY_IN: 1, PAY_OUT: -1, SAFE_DROP: -1, NO_SALE: 0, TIP_IN: 1, TIP_OUT: -1, DEPOSIT_IN: 1, TENDER_CORRECTION_IN: 1, TENDER_CORRECTION_OUT: -1 };
const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });
const live = () => store.db.sessions.find((s) => s.terminalId === T && (s.state === 'OPEN' || s.state === 'HANDOVER_PENDING')) ?? null;
const sess = (id: string) => store.db.sessions.find((s) => s.id === id)!;
const hov = (id: string) => (store.db.handovers ?? []).find((h) => h.id === id)!;
/** The cash the drawer should hold, from its entries (Decimal) — what the server compares a count with. */
const expected = (sid: string) => m4(store.db.cashEntries.filter((e) => e.sessionId === sid).reduce((a, e) => a.plus(D(e.amount).times(SIGN[e.kind] ?? 0)), D(0)));
const plus = (a: string, b: string) => m4(D(a).plus(D(b)));
const S: { s1?: string; refundOrder?: string; cap?: string } = {};

/** Sign the terminal in as `user` (signing the previous person out, as the sale screen's «تبديل المستخدم» does). */
async function on(user: string, log: Logger) {
  const d = devices.get(T);
  const cur = d.token ? store.db.authSessions.find((a) => a.id === d.token) : null;
  if (cur && store.db.users.find((u) => u.id === cur.userId)?.username !== user) { try { await api(devices.auth(T), 'Auth.Logout', { body: {} }); } catch { /* ignore */ } devices.logout(T); }
  return as(T, user, log);
}
async function policyChange(log: Logger, policyId: string, patch: Record<string, unknown>) {
  const o = await as('t_admin', 'demo-owner', log);
  const cur = store.db.policyValues.find((v) => v.policyId === policyId && v.scopeType === 'TENANT');
  await withApproval(o, 'Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...((cur?.value as object) ?? {}), ...patch }, changeNote: 'J-H1' } }, 'demo-manager-1', log, `${policyId} ${JSON.stringify(patch)}`);
}
/** A takeaway paid in cash on this terminal (moves the drawer). */
async function sale(user: string, log: Logger, product = 'p_espresso') {
  const c = await on(user, log);
  const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
  await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: product, quantity: '1' }] } }, log, product);
  await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
  const cap = await api<any>(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '200.00' }] } }, log, 'cash');
  await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
  return { orderId: o.id as string, captureId: cap.captureIds[0] as string };
}
const start = (c: any, log: Logger | undefined, counted: string, label: string) => api<any>(c, 'Session.HandoverStart', { params: { sessionId: live()!.id }, body: { countedCash: counted, expectedVersion: live()!.version } }, log, label);
const accept = (c: any, body: Record<string, unknown>) => api<any>(c, 'Session.HandoverAccept', { params: { sessionId: live()!.id }, body: { expectedVersion: hov(live()!.handoverId!).version, ...body } });

const H1: StepDef[] = [
  { id: 'J-H1-1', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const p = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
    const h = p('ShiftHandoverPolicy'), f = p('OpeningFloatPolicy'), r = p('BlindRecountPolicy'), rc = p('RefundCancelPolicy'), rt = p('ReasonTextPolicy');
    check(log, h?.mode === 'DUAL_COUNT' && h?.countMismatchTolerance === '0.0000' && h?.mismatchRecounts === 1 && f?.standardFloat === '500.0000' && f?.change === 'APPROVAL' && r?.mode === 'NOT_ALLOWED' && rc?.cancelBy === 'REQUESTER_OR_DECIDER' && rt?.minLength === 3 && p('DriverPayPolicy')?.payoutDrawer === 'OWN_DRAWER',
      `defaults ${JSON.stringify({ h, f, r, rc, rt, payoutDrawer: p('DriverPayPolicy')?.payoutDrawer })}`, t('الإعدادات الافتراضية: عدّ مزدوج أعمى، رصيد افتتاحي 500.00 بموافقة لأي مبلغ آخر، ولا إعادة عد بعد التأكيد'));
    if (live()) { const s = live()!; const c = await on(store.db.users.find((u) => u.id === s.userId)!.username, log); await withApproval(c, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: s.version, countedCash: expected(s.id) } }, 'demo-manager-1', log, 'close the drawer left open'); }
    const c = await on('demo-cashier-a', log);
    await expectRefusal(api(c, 'Session.Open', { body: { terminalId: T, openingFloat: '300.00' } }), 'APPROVAL_REQUIRED', log, 'open with 300.00 (standard 500.00)', t('فتح الوردية بمبلغ غير المعتاد يحتاج موافقة المدير'));
    const s = await api<any>(c, 'Session.Open', { body: { terminalId: T, openingFloat: '500.00' } }, log, 'open with the standard 500.00');
    S.s1 = s.id;
    check(log, s.openingFloat === '500.0000', `float ${s.openingFloat}`, t('فُتحت الوردية بالرصيد المعتاد بلا موافقة'));
  } },
  { id: 'J-H1-2', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    await sale('demo-cashier-a', log);
    const exp = expected(live()!.id);
    await policyChange(log, 'ShiftHandoverPolicy', { mode: 'FULL_CLOSE' });
    const a = await on('demo-cashier-a', log);
    await expectRefusal(start(a, undefined, exp, 'start under FULL_CLOSE'), 'HANDOVER_DISABLED', log, 'handover under FULL_CLOSE', t('التسليم معطل عند «إغلاق كامل ثم فتح جديد»'));
    await policyChange(log, 'ShiftHandoverPolicy', { mode: 'DUAL_COUNT' });
    const b = await on('demo-cashier-b', log);
    await expectRefusal(start(b, undefined, exp, 'start by cashier B'), 'HANDOVER_NOT_SESSION_OWNER', log, 'another cashier starts the handover', t('يسلّم الوردية صاحبها فقط'));
  } },
  { id: 'J-H1-3', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    // the default flow: the outgoing count, the drawer waits, the incoming cashier counts the same amount
    const a = await on('demo-cashier-a', log);
    const s = live()!;
    const exp = expected(s.id);
    const st = await start(a, log, exp, `outgoing blind count ${exp}`);
    check(log, sess(s.id).state === 'HANDOVER_PENDING' && st.handover.state === 'PENDING' && st.handover.outgoingCount === undefined && st.handover.expectedCash === undefined, `session ${sess(s.id).state}; handover ${st.handover.number} (no amounts in the answer)`, t('الدرج بانتظار استلام الكاشير التالي، ولا يظهر أي مبلغ'));
    const cur = await api<any>(a, 'Session.Current', { query: { terminalId: T } }, log, 'the sale screen reads the drawer');
    check(log, cur.state === 'HANDOVER_PENDING' && cur.handover?.mode === 'DUAL_COUNT' && !('outgoingCount' in cur.handover) && !('expectedCash' in cur.handover), `Session.Current ${cur.state} ${JSON.stringify(cur.handover)}`, t('شاشة البيع تعرض حالة الانتظار بلا مبالغ'));
    await expectRefusal(api(a, 'Order.Create', { body: { channel: 'TAKEAWAY' } }), 'SESSION_NOT_OPEN', log, 'a sale while waiting', t('البيع متوقف أثناء انتظار الاستلام'));
    await expectRefusal(api(a, 'Cash.Move', { params: { sessionId: s.id }, body: { kind: 'PAY_OUT', amount: '10.00', reasonCode: 'SUPPLIES', reason: 'مشتريات' } }), 'SESSION_NOT_OPEN', log, 'a cash move while waiting', t('لا حركة نقدية أثناء انتظار الاستلام'));
    await expectRefusal(api(a, 'Session.Open', { body: { terminalId: T, openingFloat: '500.00' } }), 'SESSION_HANDOVER_PENDING', log, 'open another shift while waiting', t('لا تُفتح وردية أخرى قبل الاستلام'));
    await expectRefusal(api(a, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: sess(s.id).version, countedCash: exp } }), 'SESSION_HANDOVER_PENDING', log, 'close while waiting', t('لا تُغلق الوردية أثناء انتظار الاستلام'));
    await expectRefusal(accept(a, { countedCash: exp }), 'HANDOVER_SAME_USER', log, 'the outgoing cashier accepts his own drawer', t('لا يستلم الكاشير درجه بنفسه'));
    const b = await on('demo-cashier-b', log);
    const r = await api<any>(b, 'Session.HandoverAccept', { params: { sessionId: s.id }, body: { countedCash: exp, expectedVersion: hov(sess(s.id).handoverId!).version } }, log, `incoming blind count ${exp}`);
    const h = hov(r.handover.id);
    const ns = sess(r.session.id);
    check(log, h.state === 'ACCEPTED' && h.outgoingCount === exp && h.incomingCount === exp && h.variance === '0.0000' && !h.approvalGrantId && sess(s.id).state === 'CLOSED' && sess(s.id).close?.handoverId === h.id && ns.userId === store.db.users.find((u) => u.username === 'demo-cashier-b')!.id && ns.openingFloat === exp && ns.handoverFromId === h.id,
      `${h.number} ACCEPTED: out ${h.outgoingCount} = in ${h.incomingCount}, variance ${h.variance}; ${s.id} CLOSED → ${ns.id} opened with ${ns.openingFloat}`, t('استُلم الدرج بلا موافقة: العدّان متطابقان والفرق صفر، وفُتحت وردية للكاشير التالي برصيد عدّه'));
    const z = await api<any>(await as('t_admin', 'demo-manager-1', log), 'Session.ZReport', { params: { sessionId: s.id } }, log, 'Z of the outgoing shift');
    check(log, z.handoverOut?.number === h.number && z.handoverOut.outgoingCount === exp && z.handoverOut.incomingCount === exp, `Z handoverOut ${JSON.stringify(z.handoverOut)}`, t('تقرير Z للوردية المسلَّمة يعرض التسليم والعدّين'));
    const au = store.db.audit.filter((x) => x.target === s.id && (x.op === 'Session.HandoverStart' || x.op === 'Session.HandoverAccept'));
    check(log, au.length === 2 && au.every((x) => x.sensitive), `audit ${au.map((x) => x.op).join(', ')}`, t('بدء التسليم والاستلام في سجل المراجعة'));
  } },
  { id: 'J-H1-4', device: T, user: 'demo-cashier-b', screen: 'counter', run: async (log) => {
    // a shortage of 30.00 (over the SESSION_VARIANCE threshold) — the counts agree, a manager approves, it is the outgoing cashier's
    await sale('demo-cashier-b', log, 'p_hummus');
    const b = await on('demo-cashier-b', log);
    const s = live()!;
    const exp = expected(s.id);
    const short = m4(D(exp).minus(30));
    await start(b, log, short, `outgoing count ${short} (expected ${exp})`);
    const a = await on('demo-cashier-a', log);
    const f = await expectRefusal(accept(a, { countedCash: short }), 'APPROVAL_REQUIRED', log, 'the incoming count agrees, the drawer is 30.00 short', t('العدّان متطابقان والعجز 30.00 فوق الحد: يلزم المدير'));
    check(log, f?.details?.action === 'SHIFT_HANDOVER_VARIANCE' && f?.details?.context?.varianceOverThreshold === true && f?.details?.context?.countMismatch === false, `approval ${f?.details?.action} ${JSON.stringify(f?.details?.context)}`, t('الموافقة مربوطة بالتسليم والعدّين والفرق'));
    const r = await withApproval<any>(a, 'Session.HandoverAccept', { params: { sessionId: s.id }, body: { countedCash: short, expectedVersion: hov(sess(s.id).handoverId!).version } }, 'demo-manager-1', log, 'accept with the manager');
    const out = sess(s.id);
    check(log, out.close?.variance === '-30.0000' && out.userId === store.db.users.find((u) => u.username === 'demo-cashier-b')!.id && !!hov(r.handover.id).approverUserId && sess(r.session.id).openingFloat === short,
      `variance ${out.close?.variance} on the outgoing session (${out.userId}); approver ${hov(r.handover.id).approverUserId}; new float ${sess(r.session.id).openingFloat}`, t('العجز 30.00 مسجل على الكاشير المُسلِّم، بموافقة المدير'));
  } },
  { id: 'J-H1-5', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    // a mismatch fixed by a recount: no approval
    const a = await on('demo-cashier-a', log);
    const exp = expected(live()!.id);
    await start(a, log, exp, `outgoing count ${exp}`);
    const b = await on('demo-cashier-b', log);
    const f = await expectRefusal(accept(b, { countedCash: plus(exp, '20') }), 'HANDOVER_COUNT_MISMATCH', log, 'the incoming count is 20.00 more', t('عدّ المستلم لا يطابق: يعيد العد'));
    check(log, f?.details?.recountsLeft === 1 && f?.details?.needsApproval === false && JSON.stringify(f?.details).indexOf(exp) < 0, `mismatch ${JSON.stringify(f?.details)} (no amounts)`, t('رسالة عدم التطابق لا تكشف عدّ الكاشير السابق'));
    const r = await api<any>(b, 'Session.HandoverAccept', { params: { sessionId: live()!.id }, body: { countedCash: exp, expectedVersion: hov(live()!.handoverId!).version } }, log, 'recount: the same amount');
    const h = hov(r.handover.id);
    check(log, h.state === 'ACCEPTED' && h.incomingCounts.length === 2 && h.incomingCounts[0].mismatch && !h.incomingCounts[1].mismatch && !h.approvalGrantId, `counts ${h.incomingCounts.map((x) => `${x.counted}${x.mismatch ? ' ≠' : ' ='}`).join(', ')}`, t('بعد إعادة العد تطابق العدّان واستُلم الدرج؛ العدّان محفوظان'));
  } },
  { id: 'J-H1-6', device: T, user: 'demo-cashier-b', screen: 'counter', run: async (log) => {
    // a mismatch that stays after the allowed recount: the same count with a reason goes to a manager
    const b = await on('demo-cashier-b', log);
    const exp = expected(live()!.id);
    await start(b, log, exp, `outgoing count ${exp}`);
    const a = await on('demo-cashier-a', log);
    await expectRefusal(accept(a, { countedCash: plus(exp, '20') }), 'HANDOVER_COUNT_MISMATCH', log, 'first incoming count +20.00', t('عدّ المستلم الأول لا يطابق'));
    const f = await expectRefusal(accept(a, { countedCash: plus(exp, '10') }), 'HANDOVER_COUNT_MISMATCH', log, 'recount +10.00', t('إعادة العد لا تطابق أيضًا'));
    check(log, f?.details?.recountsLeft === 0 && f?.details?.needsApproval === true, `after the recount ${JSON.stringify(f?.details)}`, t('لم يبقَ إعادة عد: يلزم المدير مع السبب'));
    await expectRefusal(accept(a, { countedCash: plus(exp, '5') }), 'BLIND_COUNT_LOCKED', log, 'a third, different count', t('لا عدّ ثالث: العد مقفل'));
    await expectRefusal(accept(a, { countedCash: plus(exp, '10'), reason: 'اب' }), 'REASON_REQUIRED', log, 'a 2-character reason', t('السبب أقصر من الحد'));
    const r = await withApproval<any>(a, 'Session.HandoverAccept', { params: { sessionId: live()!.id }, body: { countedCash: plus(exp, '10'), reason: 'فئة 10 جنيه بين الأوراق', expectedVersion: hov(live()!.handoverId!).version } }, 'demo-manager-1', log, 'the same count with a reason, the manager approves');
    const h = hov(r.handover.id);
    const out = sess(h.outgoingSessionId);
    check(log, h.countDifference === '10.0000' && h.reason === 'فئة 10 جنيه بين الأوراق' && !!h.approverUserId && out.close?.variance === '10.0000' && sess(r.session.id).openingFloat === plus(exp, '10') && h.incomingCounts.length === 2,
      `difference ${h.countDifference}; outgoing variance ${out.close?.variance}; reason «${h.reason}»; new float ${sess(r.session.id).openingFloat}`, t('بموافقة المدير والسبب: الفرق 10.00 على الكاشير المُسلِّم، والرصيد الجديد بعدّ المستلم'));
  } },
  { id: 'J-H1-7', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    // cancel, and the count stays locked; then DIRECT_SWAP
    const a = await on('demo-cashier-a', log);
    const exp = expected(live()!.id);
    const st = await start(a, log, exp, `outgoing count ${exp}`);
    const b = await on('demo-cashier-b', log);
    await expectRefusal(api(b, 'Session.HandoverCancel', { params: { sessionId: live()!.id }, body: { reason: 'لا أريد الاستلام', expectedVersion: st.handover.version } }), 'HANDOVER_CANCEL_NOT_ALLOWED', log, 'the incoming cashier cancels', t('المستلم لا يلغي التسليم'));
    const a2 = await on('demo-cashier-a', log);
    await expectRefusal(api(a2, 'Session.HandoverCancel', { params: { sessionId: live()!.id }, body: { reason: 'لا', expectedVersion: st.handover.version } }), 'REASON_REQUIRED', log, 'cancel without a real reason', t('الإلغاء يحتاج سببًا'));
    await api(a2, 'Session.HandoverCancel', { params: { sessionId: live()!.id }, body: { reason: 'الكاشير التالي تأخر', expectedVersion: st.handover.version } }, log, 'the outgoing cashier cancels');
    check(log, live()!.state === 'OPEN' && hov(st.handover.id).state === 'CANCELLED' && hov(st.handover.id).cancelReason === 'الكاشير التالي تأخر', `session ${live()!.state}; ${hov(st.handover.id).number} ${hov(st.handover.id).state}`, t('أُلغي التسليم وعادت الوردية مفتوحة، والسجل محفوظ'));
    await expectRefusal(api(a2, 'Session.Close', { params: { sessionId: live()!.id }, body: { expectedVersion: live()!.version, countedCash: plus(exp, '1') } }), 'BLIND_COUNT_LOCKED', log, 'close with another amount after the cancel', t('العد المؤكد يبقى مقفلًا بعد الإلغاء'));
    await policyChange(log, 'ShiftHandoverPolicy', { mode: 'DIRECT_SWAP' });
    const a3 = await on('demo-cashier-a', log);
    await start(a3, log, exp, `outgoing count ${exp} (DIRECT_SWAP)`);
    const b2 = await on('demo-cashier-b', log);
    const r = await api<any>(b2, 'Session.HandoverAccept', { params: { sessionId: live()!.id }, body: { expectedVersion: hov(live()!.handoverId!).version } }, log, 'accept without counting');
    const h = hov(r.handover.id);
    check(log, h.mode === 'DIRECT_SWAP' && h.incomingCount === null && sess(r.session.id).openingFloat === exp && h.variance === '0.0000', `${h.number} ${h.mode}: float ${sess(r.session.id).openingFloat}, variance ${h.variance}`, t('استلام مباشر بعدّ الكاشير السابق، والفرق محسوب على المتوقع'));
    await policyChange(log, 'ShiftHandoverPolicy', { mode: 'DUAL_COUNT' });
  } },
  { id: 'J-H1-8', device: T, user: 'demo-cashier-b', screen: 'counter', run: async (log) => {
    // the blind recount: locked by default; with BlindRecountPolicy WITH_APPROVAL a manager approves it and both counts are kept
    const b = await on('demo-cashier-b', log);
    const s = live()!;
    const exp = expected(s.id);
    const short = m4(D(exp).minus(50));
    await expectRefusal(api(b, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: s.version, countedCash: short } }), 'APPROVAL_REQUIRED', log, `close with ${short} (50.00 short), the manager is asked`, t('العد المؤكد بعجز 50.00 يطلب المدير'));
    await expectRefusal(api(b, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: sess(s.id).version, countedCash: exp } }), 'BLIND_COUNT_LOCKED', log, 'close again with another amount', t('لا يتغير العد بعد التأكيد'));
    await expectRefusal(api(b, 'Session.Recount', { params: { sessionId: s.id }, body: { countedCash: exp, reason: 'أخطأت في عد فئة 50', expectedVersion: sess(s.id).version } }), 'BLIND_RECOUNT_NOT_ALLOWED', log, 'recount (default NOT_ALLOWED)', t('إعادة العد غير مسموحة افتراضيًا'));
    await policyChange(log, 'BlindRecountPolicy', { mode: 'WITH_APPROVAL' });
    const b2 = await on('demo-cashier-b', log);
    const rc = await withApproval<any>(b2, 'Session.Recount', { params: { sessionId: s.id }, body: { countedCash: exp, reason: 'أخطأت في عد فئة 50', expectedVersion: sess(s.id).version } }, 'demo-manager-1', log, 'recount with the manager');
    const z = await api<any>(b2, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: sess(s.id).version, countedCash: exp } }, log, `close with the recount ${exp}`);
    const counts = sess(s.id).counts ?? [];
    check(log, rc.count.kind === 'RECOUNT' && counts.length === 2 && counts[0].counted === short && counts[1].counted === exp && z.variance === '0.0000' && sess(s.id).close?.recounts === 1, `counts ${counts.map((c) => `${c.kind} ${c.counted}`).join(', ')}; variance ${z.variance}`, t('إعادة العد بموافقة المدير: العدّان محفوظان والإغلاق بالعد الجديد'));
    await policyChange(log, 'BlindRecountPolicy', { mode: 'NOT_ALLOWED' });
  } },
  { id: 'J-H1-9', device: T, user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    // the opening float: LOCKED refuses another amount, FREE takes it
    await policyChange(log, 'OpeningFloatPolicy', { change: 'LOCKED' });
    const a = await on('demo-cashier-a', log);
    await expectRefusal(api(a, 'Session.Open', { body: { terminalId: T, openingFloat: '300.00' } }), 'OPENING_FLOAT_LOCKED', log, 'open with 300.00 under LOCKED', t('الرصيد الافتتاحي ثابت: مبلغ آخر مرفوض'));
    await policyChange(log, 'OpeningFloatPolicy', { change: 'FREE' });
    const a2 = await on('demo-cashier-a', log);
    const s = await api<any>(a2, 'Session.Open', { body: { terminalId: T, openingFloat: '300.00' } }, log, 'open with 300.00 under FREE');
    check(log, s.openingFloat === '300.0000', `float ${s.openingFloat}`, t('عند السماح بالتغيير فُتحت الوردية بـ 300.00 بلا موافقة'));
    await policyChange(log, 'OpeningFloatPolicy', { change: 'APPROVAL' });
  } },
  { id: 'J-H1-10', device: T, user: 'demo-cashier-a', screen: 'refunds', run: async (log) => {
    // who withdraws a refund request, and the reason length
    const sl = await sale('demo-cashier-a', log, 'p_hummus');
    S.refundOrder = sl.orderId; S.cap = sl.captureId;
    const req = async () => { const c = await on('demo-cashier-a', log); return api<any>(c, 'Refund.Request', { params: { orderId: S.refundOrder! }, body: { amount: '1.00', method: 'CASH', allocations: [{ captureId: S.cap!, amount: '1.00' }], lines: [], reasonCode: 'QUALITY_ISSUE', reason: 'تجربة سحب الطلب' } }, log, 'refund request 1.00'); };
    const r1 = await req();
    const b = await on('demo-cashier-b', log);
    const x = await expectRefusal(api(b, 'Refund.Cancel', { params: { refundCaseId: r1.id }, body: { expectedVersion: 1, reason: 'ليس طلبي' } }), 'REFUND_CANCEL_NOT_REQUESTER', log, 'another cashier withdraws it (default)', t('لا يسحب الطلب إلا صاحبه أو صاحب صلاحية الرفض'));
    check(log, x?.details?.cancelBy === 'REQUESTER_OR_DECIDER', `cancelBy ${x?.details?.cancelBy}`, t('القاعدة الافتراضية: صاحب الطلب أو صاحب صلاحية الرفض'));
    const a = await on('demo-cashier-a', log);
    await expectRefusal(api(a, 'Refund.Cancel', { params: { refundCaseId: r1.id }, body: { expectedVersion: 1, reason: 'لا' } }), 'VALIDATION_FAILED', log, 'withdraw with a 2-character reason', t('السبب أقصر من 3 أحرف'));
    await policyChange(log, 'ReasonTextPolicy', { minLength: 10 });
    const a2 = await on('demo-cashier-a', log);
    await expectRefusal(api(a2, 'Refund.Cancel', { params: { refundCaseId: r1.id }, body: { expectedVersion: 1, reason: 'تجربة' } }), 'VALIDATION_FAILED', log, 'a 5-character reason when the minimum is 10', t('عند رفع الحد إلى 10 أحرف يُرفض السبب القصير'));
    await api(a2, 'Refund.Cancel', { params: { refundCaseId: r1.id }, body: { expectedVersion: 1, reason: 'طلبته بالخطأ على الشيك' } }, log, 'withdraw with a reason of 10+ characters');
    await policyChange(log, 'ReasonTextPolicy', { minLength: 3 });
    await policyChange(log, 'RefundCancelPolicy', { cancelBy: 'DECIDER_ONLY' });
    const r2 = await req();
    await expectRefusal(api(await on('demo-cashier-a', log), 'Refund.Cancel', { params: { refundCaseId: r2.id }, body: { expectedVersion: 1, reason: 'طلبته بالخطأ' } }), 'REFUND_CANCEL_NOT_REQUESTER', log, 'the requester withdraws it under DECIDER_ONLY', t('عند «صاحب صلاحية الرفض فقط» لا يسحبه صاحبه'));
    const m = await as('t_admin', 'demo-manager-1', log);
    await api(m, 'Refund.Cancel', { params: { refundCaseId: r2.id }, body: { expectedVersion: 1, reason: 'الضيف تراجع' } }, log, 'the manager withdraws it');
    check(log, store.db.refunds.find((r) => r.id === r2.id)?.state === 'CANCELLED', `refund ${r2.id} ${store.db.refunds.find((r) => r.id === r2.id)?.state}`, t('سحبه المدير'));
    await policyChange(log, 'RefundCancelPolicy', { cancelBy: 'REQUESTER_OR_DECIDER' });
  } },
  { id: 'J-H1-11', device: T, user: 'demo-manager-1', screen: 'drivers', run: async (log) => {
    // who pays a rider out of which drawer: the drawer holder only (default); with TERMINAL_DRAWER a manager on the terminal may
    const m = await on('demo-manager-1', log);
    let target: string | null = null;
    for (const d of store.db.drivers ?? []) {
      if (!d.active || d.branchId !== 'branch_main') continue;
      const f = await api<any>(m, 'Driver.Get', { params: { driverId: d.id } });
      if (D(f.account?.preview?.net ?? '0').gt(0)) { target = d.id; break; }
    }
    if (!target) return check(log, false, 'no rider with unpaid pay in the demo data', t('لا يوجد طيار له مستحقات'));
    const f = await api<any>(m, 'Driver.Get', { params: { driverId: target } }, log, 'rider file');
    const drv = () => (store.db.drivers ?? []).find((d) => d.id === target)!;
    await expectRefusal(api(m, 'Driver.Payout', { params: { driverId: target }, body: { periodTo: f.account.preview.periodTo, expectedVersion: drv().version } }), 'DRIVER_PAYOUT_NOT_DRAWER_HOLDER', log, 'the manager pays out of the cashier\'s drawer (default OWN_DRAWER)', t('يصرف الطيار صاحب الوردية المفتوحة على الدرج فقط'));
    await policyChange(log, 'DriverPayPolicy', { payoutDrawer: 'TERMINAL_DRAWER' });
    const m2 = await on('demo-manager-1', log);
    await expectRefusal(api(m2, 'Driver.Payout', { params: { driverId: target }, body: { periodTo: f.account.preview.periodTo, expectedVersion: drv().version } }), 'APPROVAL_REQUIRED', log, 'the same under TERMINAL_DRAWER: only the payout approval is left', t('عند «أي صاحب صلاحية من درج الجهاز» يبقى طلب موافقة الصرف فقط'));
    await policyChange(log, 'DriverPayPolicy', { payoutDrawer: 'OWN_DRAWER' });
  } },
  { id: 'J-H1-12', device: 't_admin', user: 'demo-owner', screen: 'shift', run: async (log) => {
    const o = await as('t_admin', 'demo-owner', log);
    const all = await api<any>(o, 'Session.Find', { query: { limit: 50 } }, log, 'shift history');
    const linked = all.items.filter((s: any) => s.handover?.state === 'ACCEPTED');
    check(log, linked.length >= 5 && linked.every((s: any) => !!s.handover.outgoingCount && all.items.some((x: any) => x.id === s.handover.incomingSessionId && x.handoverFrom?.id === s.handover.id)), `${linked.length} handovers linked out → in`, t('سجل الورديات يربط كل وردية مسلَّمة بالوردية التي استلمتها'));
    const ph = store.db.policyHistory.filter((h) => ['ShiftHandoverPolicy', 'OpeningFloatPolicy', 'BlindRecountPolicy', 'RefundCancelPolicy', 'ReasonTextPolicy', 'DriverPayPolicy'].includes(h.policyId) && h.via === 'SETTINGS');
    const au = store.db.audit.filter((x) => x.op === 'Settings.UpdatePolicy' && !!x.approvalGrantId).length;
    check(log, ph.length >= 14 && au >= 0, `${ph.length} audited policy changes through the settings`, t('كل تغيير إعداد مسجل في سجل الإعدادات بموافقة'));
    const ops = ['Session.HandoverStart', 'Session.HandoverAccept', 'Session.HandoverCancel', 'Session.Recount'];
    check(log, ops.every((op) => store.db.audit.some((x) => x.op === op)), `audit ops: ${ops.filter((op) => store.db.audit.some((x) => x.op === op)).join(', ')}`, t('كل حركات التسليم وإعادة العد في سجل المراجعة'));
  } },
];

export const HANDOVER_JOURNEY = {
  id: 'J-H1', title: 'تسليم الوردية والإعدادات الناقصة', titleEn: 'Shift handover and the remaining settings', reset: null,
  intro: 'الرصيد الافتتاحي المعتاد، تسليم الوردية بعدّ مزدوج أعمى، عجز فوق الحد بموافقة المدير، عدم تطابق العدّين ثم إعادة العد أو المدير مع السبب، إلغاء التسليم، الاستلام المباشر، إعادة العد بموافقة، ومن يسحب طلب المرتجع، وطول السبب، ومن يصرف للطيار.',
  steps: H1,
};
