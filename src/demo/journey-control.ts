// r3A journey J-P1 — "who did it vs who allowed it": the person at the terminal acts, a supervisor authorises in
// place (PIN, manager card, fingerprint, or a request to the manager's device), and the record keeps both.
// Covers A06 (pre-bill then removal), A07 (same-day refund from the cashier drawer), A08 (return after close),
// A09 (staff meal: allowance, approval, stock, cancellation by stage), A18 (self approval, replay, refusal) and E03.
import { api, as, expectRefusal, order, openSession, userIdOf, type Logger } from './runner';
import { call, ApiFailure, newCommandId, type DeviceAuth } from '../api/client';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { clock } from '../mock/clock';
import { t } from '../i18n';
import { egp, actionTitle } from './humanLog';
import { personName } from './people';
import { DEMO_CARDS } from '../mock/seed-control';
import type { StepDef } from './scripts';

type Cred = { approver: string; kind?: 'PIN' | 'CARD' | 'FINGERPRINT' };
const userName = (id?: string | null) => { const u = store.db.users.find((x) => x.id === id); return u ? personName(u.username, u.displayName) : '—'; };
const CRED_AR: Record<string, string> = { PIN: 'بالرقم السري', CARD: 'بتمرير الكارت', FINGERPRINT: 'بالبصمة', REMOTE: 'من جهازه' };

/** Run a command; on APPROVAL_REQUIRED the approver proves who they are on the SAME device and the same command id retries. */
async function approveInPlace<T = any>(dev: DeviceAuth, opId: string, opts: { params?: any; body?: any; query?: any }, cred: Cred, log: Logger, label: string): Promise<T> {
  const commandId = newCommandId();
  try {
    const r = await call<T>(dev, opId, { ...opts, commandId });
    log({ ok: false, text: `${opId} — ${label}: ran without approval`, plain: t('{x}: اتعملت من غير موافقة — كان المفروض تطلب مدير', { x: label }) });
    return r.data;
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.code !== 'APPROVAL_REQUIRED') throw e;
    const d = e.details as any;
    log({ ok: true, text: `${opId} — ${label} → 403 APPROVAL_REQUIRED (${d.action}${d.override ? ', override ' + d.override : ''}${d.stage ? ', ' + d.stage : ''})`, code: e.code, plain: t('«{a}» محتاجة موافقة مدير — الشاشة ظهرت على نفس الجهاز', { a: actionTitle(d.action) }) + (d.override ? t(' (الحركة مش من صلاحية الموظف، المدير بيوافق في مكانه)') : '') });
    const uid = userIdOf(cred.approver);
    const kind = cred.kind ?? 'PIN';
    const secret = kind === 'PIN' ? demo.pin : kind === 'CARD' ? DEMO_CARDS[uid]?.card : DEMO_CARDS[uid]?.finger;
    const g = await api<any>(dev, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: uid, approverCredentialKind: kind, approverSecret: secret, overridePermission: d.override ?? undefined } }, log, `${cred.approver} ${kind}`);
    return api<T>(dev, opId, { ...opts, body: { ...(opts.body ?? {}), approvalGrantId: g.grantId }, commandId }, log, `${label} + grant (same X-Command-Id)`);
  }
}
async function cashier(log: Logger) {
  const c = await as('t_cash', 'demo-cashier-a', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
  return c;
}
const lastRev = () => (store.db.reversals ?? [])[0];
function traceLine(log: Logger, label: string) {
  const r = lastRev();
  if (!r) return log({ ok: false, text: 'no trace row', plain: t('مفيش سطر في سجل الإلغاءات — غلط') });
  log({ ok: !!r.approverId, text: `trace ${r.kind} ${r.stage}: actor ${r.actorId}, approver ${r.approverId} (${r.credentialKind}), terminal ${r.terminalId}, qty ${r.quantity}, value ${r.value}, disposition ${r.disposition}`, plain: t('{l}: السجل بيقول {a} عمل الحركة و{b} وافق {c} من {d} — {q} × بقيمة {v}', { l: label, a: userName(r.actorId), b: userName(r.approverId), c: CRED_AR[r.credentialKind ?? 'PIN'] ?? '', d: r.terminalId === 't_cash' ? t('جهاز الكاشير') : r.terminalId ?? '', q: Number(r.quantity), v: egp(r.value) }) });
}
const state: { takeaway?: string; paid?: string; refund?: string; meal?: string; held?: string } = {};

const P1: StepDef[] = [
  { id: 'J-P1-1', device: 't_cash', user: 'demo-cashier-a', screen: () => ['counter', { orderId: state.takeaway }], text: { who: 'سارة (الكاشير) على جهاز الكاشير، وأحمد المدير جنبها', do_ar: 'طلب تيك أواي: شاورما ×2 وبيبسي كانز ×2 ومية. سارة تطبع شيك مبدئي للزبون، وبعدين تحاول تشيل البيبسي. أحمد يكتب رقمه السري على نفس الجهاز.', do_en: 'Takeaway: shawarma ×2 and Pepsi ×2. Sara prints a pre-bill, then removes the Pepsi. Ahmed types his PIN on the same device.', expect_ar: 'الشيل بعد الشيك المبدئي محتاج موافقة مدير (مرحلة «ظهر للزبون»). سارة مش ممكن توافق لنفسها. بعد الموافقة الصنف يظهر في سجل الشيك ومين شاله ومين وافق.', expect_en: 'Removing after the pre-bill needs a manager (stage "visible"). Sara cannot approve herself. After approval the line stays in the check history with who removed it and who allowed it.', operations: [{ op: 'Print.PreBill', http: 'POST /orders/{id}/pre-bill', actor: 'cashier', expected: '201' }, { op: 'Order.RemoveLine', http: 'DELETE /orders/{id}/lines/{lineId}', actor: 'cashier', expected: '403 APPROVAL_REQUIRED → 200 with grant' }] }, run: async (log) => {
    const c = await cashier(log);
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    state.takeaway = o.id;
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_chicken_shawarma', quantity: '2', modifierOptionIds: [] }, { productId: 'p_pepsi', quantity: '2', modifierOptionIds: [] }, { productId: 'p_water', quantity: '1', modifierOptionIds: [] }] } }, log, 'shawarma ×2 + Pepsi ×2 + water');
    await api(c, 'Print.PreBill', { params: { orderId: o.id }, body: { terminalId: 't_cash' } }, log, 'pre-bill to the guest');
    const pepsi = order(o.id).lines.find((l) => l.productId === 'p_pepsi')!;
    const body = { expectedVersion: order(o.id).version, expectedLineVersion: pepsi.version, reasonCode: 'CUSTOMER_CHANGED_MIND', reason: 'الزبون غيّر رأيه' };
    // A18: the cashier cannot approve her own removal (she lacks the approval permission)
    try { await call(c, 'Order.RemoveLine', { params: { orderId: o.id, lineId: pepsi.id }, body }); } catch (e) {
      const d = (e as ApiFailure).details as any;
      log({ ok: (e as ApiFailure).code === 'APPROVAL_REQUIRED' && d?.stage === 'S1', text: `RemoveLine after pre-bill → ${(e as ApiFailure).code} ${d?.action} ${d?.stage}`, plain: t('الشيل بعد الشيك المبدئي طلب موافقة مدير (الصنف ظهر للزبون)') });
      await expectRefusal(api(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-cashier-a'), approverCredentialKind: 'PIN', approverSecret: demo.pin } }), 'APPROVER_NOT_AUTHORIZED', log, 'cashier approves her own removal', t('سارة حاولت توافق على الشيل برقمها'));
    }
    await approveInPlace(c, 'Order.RemoveLine', { params: { orderId: o.id, lineId: pepsi.id }, body }, { approver: 'demo-manager-1' }, log, 'remove Pepsi after pre-bill');
    const l = order(o.id).lines.find((x) => x.id === pepsi.id)!;
    const h = order(o.id).history.at(-1);
    log({ ok: l.status === 'REMOVED' && !!l.removed?.approverId, text: `line ${l.status}, removed.by ${l.removed?.by}, approver ${l.removed?.approverId}, stage ${l.removed?.stage}; history: ${typeof h?.text === 'string' ? h?.text : h?.text.ar}`, plain: t('البيبسي ما اختفاش: باين في سجل الشيك «اتشال بعد الشيك المبدئي — بموافقة أحمد»') });
    traceLine(log, t('سجل الإلغاءات'));
  } },
  { id: 'J-P1-2', device: 't_cash', user: 'demo-cashier-a', screen: () => ['counter', { orderId: state.takeaway }], text: { who: 'سارة، وهبة المديرة بتمرّر الكارت', do_ar: 'سارة تقلل الشاورما من 2 لـ 1. المرة الأولى كارت مش متسجل، والتانية كارت سارة نفسها، والتالتة هبة تمرّر كارت المدير.', do_en: 'Sara reduces the shawarma from 2 to 1. First an unknown card, then Sara\'s own card, then Heba swipes her manager card.', expect_ar: 'الكارت الغريب يترفض، وكارت الكاشير يترفض (مالوش صلاحية)، وكارت هبة يوافق. تقليل الكمية بيتسجل زي الشيل.', expect_en: 'The unknown card is refused, the cashier card is refused (no authority), Heba\'s card approves. A quantity cut is traced like a removal.', operations: [{ op: 'Approval.Grant', http: 'POST /approvals', actor: 'manager (card)', expected: 'CARD credential' }] }, run: async (log) => {
    const c = await cashier(log);
    const id = state.takeaway ?? [...store.db.orders].reverse().find((o) => o.channel === 'TAKEAWAY' && o.status === 'DRAFT')!.id;
    const sh = order(id).lines.find((l) => l.productId === 'p_chicken_shawarma' && l.status === 'ACTIVE')!;
    const body = { expectedVersion: order(id).version, expectedLineVersion: sh.version, quantity: '1', reasonCode: 'CUSTOMER_CHANGED_MIND' };
    let d: any;
    try { await call(c, 'Order.UpdateLine', { params: { orderId: id, lineId: sh.id }, body }); } catch (e) { d = (e as ApiFailure).details; log({ ok: (e as ApiFailure).code === 'APPROVAL_REQUIRED', text: `qty 2 → 1 → ${(e as ApiFailure).code}`, plain: t('تقليل الكمية طلب موافقة مدير') }); }
    if (d) {
      const g0 = { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context };
      await expectRefusal(api(c, 'Approval.Grant', { body: { ...g0, approverUserId: userIdOf('demo-manager-2'), approverCredentialKind: 'CARD', approverSecret: 'CARD-UNKNOWN-0000' } }), 'APPROVER_CREDENTIAL_UNKNOWN', log, 'unknown card', t('تمرير كارت مش متسجل'));
      await expectRefusal(api(c, 'Approval.Grant', { body: { ...g0, approverUserId: userIdOf('demo-cashier-a'), approverCredentialKind: 'CARD', approverSecret: DEMO_CARDS.u_cashier_a.card } }), 'APPROVER_NOT_AUTHORIZED', log, 'cashier card', t('سارة مرّرت الكارت بتاعها'));
    }
    await approveInPlace(c, 'Order.UpdateLine', { params: { orderId: id, lineId: sh.id }, body }, { approver: 'demo-manager-2', kind: 'CARD' }, log, 'shawarma 2 → 1');
    traceLine(log, t('تقليل الكمية'));
  } },
  { id: 'J-P1-3', device: 't_cash', user: 'demo-cashier-a', screen: 'refunds', text: { who: 'سارة على جهاز الكاشير، وهبة بالبصمة؛ أحمد من كمبيوتر المدير', do_ar: 'الزبون يدفع الشيك كاش ويمشي. بعدها يرجع بالشاورما (باظت). سارة تطلب المرتجع وتضغط «اصرف» من جهازها؛ سارة مالهاش صلاحية الصرف، فهبة توافق بالبصمة على جهاز الكاشير. أحمد يحاول يصرف مرتجع من كمبيوتر المدير.', do_en: 'The guest pays cash and leaves, then returns the (spoiled) shawarma. Sara requests the refund and taps "Pay out" on her device; she lacks the payout permission, so Heba approves with her fingerprint on the cashier device. Ahmed tries to pay a refund from the manager PC.', expect_ar: 'الفلوس بتطلع من درج سارة (مش من المدير)، والسجل فيه سارة اللي صرفت وهبة اللي وافقت بالبصمة. من كمبيوتر المدير الصرف الكاش يترفض: لازم من جهاز الكاشير. الموافقة متتستخدمش مرتين.', expect_en: 'The cash leaves Sara\'s drawer (not the manager\'s); the record has Sara who paid and Heba who approved by fingerprint. From the manager PC the cash payout is refused. A grant is never used twice.', operations: [{ op: 'Refund.Approve', http: 'POST /refund-requests/{id}/approve', actor: 'cashier + manager fingerprint', expected: 'REFUND_OUT on the cashier session' }] }, run: async (log) => {
    const c = await cashier(log);
    const id = state.takeaway!;
    if (order(id).status === 'DRAFT') await api(c, 'Order.Confirm', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'confirm');
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: id } });
    await api(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: String(Math.ceil(Number(st.remaining) / 50) * 50) }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'complete');
    const rf = await api<any>(c, 'Refund.Refundable', { params: { orderId: id } }, log);
    const ln = rf.lines.find((l: any) => order(id).lines.find((x) => x.id === l.lineId)?.productId === 'p_chicken_shawarma');
    const cash = rf.captures.find((x: any) => x.method === 'CASH');
    const r = await api<any>(c, 'Refund.Request', { params: { orderId: id }, body: { amount: ln.unitRefundable, method: 'CASH', allocations: [{ captureId: cash.captureId, amount: ln.unitRefundable }], lines: [{ lineId: ln.lineId, quantity: '1', disposition: 'WASTE_HELD' }], reasonCode: 'QUALITY_ISSUE', reason: 'الشاورما باظت' } }, log, `request ${ln.unitRefundable}`);
    state.refund = r.id;
    const sess = openSession('t_cash')!;
    const before = store.db.cashEntries.filter((e) => e.sessionId === sess.id && e.kind === 'REFUND_OUT').length;
    const cmd = newCommandId();
    let d: any;
    try { await call(c, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 1, payoutMethod: 'CASH' }, commandId: cmd }); } catch (e) { d = (e as ApiFailure).details; log({ ok: (e as ApiFailure).code === 'APPROVAL_REQUIRED' && !!d?.override, text: `cashier Refund.Approve → ${(e as ApiFailure).code} override ${d?.override}`, plain: t('سارة مالهاش صلاحية صرف المرتجع — الشاشة طلبت مدير يوافق في مكانه') }); }
    const g = await api<any>(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-manager-2'), approverCredentialKind: 'FINGERPRINT', approverSecret: DEMO_CARDS.u_manager_2.finger, overridePermission: d.override } }, log, 'Heba fingerprint');
    const paid = await api<any>(c, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 1, payoutMethod: 'CASH', approvalGrantId: g.grantId }, commandId: cmd }, log, 'pay out (same command, with grant)');
    const after = store.db.cashEntries.filter((e) => e.sessionId === sess.id && e.kind === 'REFUND_OUT').length;
    log({ ok: after === before + 1 && paid.drawerOwnerId === sess.userId && paid.paidBy === userIdOf('demo-cashier-a') && paid.approverId === userIdOf('demo-manager-2'), text: `REFUND_OUT on ${sess.id} (+${after - before}); paidBy ${paid.paidBy}; drawer ${paid.drawerOwnerId}; approver ${paid.approverId}; stage ${paid.stage}`, plain: t('{a} طلعت من درج {d} — صرفتها {p} بموافقة {m} بالبصمة (نفس اليوم)', { a: egp(paid.amount), d: userName(paid.drawerOwnerId), p: userName(paid.paidBy), m: userName(paid.approverId) }) });
    traceLine(log, t('المرتجع'));
    // the same grant cannot be used again (a new command with the old grant)
    await expectRefusal(api(c, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 2, payoutMethod: 'CASH', approvalGrantId: g.grantId } }), 'REFUND_CASE_NOT_PENDING', log, 'pay the same refund again', t('محاولة صرف نفس المرتجع تاني'));
    // F2-01: the manager can no longer "approve & pay" from his own screen — cash leaves a cashier drawer
    const r2 = await api<any>(c, 'Refund.Request', { params: { orderId: id }, body: { amount: '1.00', method: 'CASH', allocations: [{ captureId: cash.captureId, amount: '1.00' }], lines: [], reasonCode: 'QUALITY_ISSUE', reason: 'تجربة: صرف من كمبيوتر المدير' } }, log, 'second request 1.00');
    const m = await as('t_admin', 'demo-manager-1', log);
    await expectRefusal(api(m, 'Refund.Approve', { params: { refundCaseId: r2.id }, body: { expectedVersion: 1, payoutMethod: 'CASH' } }), 'REFUND_NEEDS_CASHIER_DRAWER', log, 'manager pays out from the ADMIN PC', t('أحمد حاول يوافق ويصرف من كمبيوتر المدير'));
    await api(c, 'Refund.Cancel', { params: { refundCaseId: r2.id }, body: { expectedVersion: 1, reason: 'تجربة' } }, log, 'withdraw the test request');
  } },
  { id: 'J-P1-4', device: 't_cash', user: 'demo-cashier-a', screen: 'refunds', text: { who: 'سارة، أحمد المدير، ونادر المحاسب', do_ar: 'زبون من امبارح (اليوم اتقفل) راجع بكانزين بيبسي مقفولين على شيك 0388. سارة تطلب المرتجع وتضغط «اصرف». أحمد يحاول يوافق، وبعدين نادر المحاسب يوافق برقمه.', do_en: 'A guest from yesterday (day closed) returns two sealed Pepsi cans on check 0388. Sara requests and taps "Pay out". Ahmed tries to approve, then Nader the accountant approves.', expect_ar: 'دي «مرتجع بعد قفل اليوم»: محتاجة الصلاحية التالتة (المحاسب أو صاحب المطعم) — المدير يترفض. أرقام يوم امبارح ما تتغيرش؛ المرتجع بيتسجل على النهارده ومربوط بالشيك الأصلي، والكانزات رجعت المخزن.', expect_en: 'This is a "return after day close": it needs the third-level permission (accountant or owner) — the manager is refused. Yesterday\'s numbers do not change; the return posts today, linked to the original check; the cans go back to stock.', operations: [{ op: 'Refund.Approve', http: 'POST /refund-requests/{id}/approve', actor: 'cashier + accountant', expected: 'RETURN_AFTER_CLOSE' }] }, run: async (log) => {
    const c = await cashier(log);
    const o = store.db.orders.find((x) => x.id === 'ord_hist_y1');
    if (!o) return log({ ok: false, text: 'seeded check 0388 missing (reset demo data)', plain: t('شيك امبارح 0388 مش موجود — رجّع بيانات العرض للأول') });
    const day = (store.db.businessDays ?? []).find((d) => d.branchId === o.branchId && d.date === o.businessDate)!;
    const frozen = JSON.stringify(day.summary);
    const rf = await api<any>(c, 'Refund.Refundable', { params: { orderId: o.id } }, log, `check #${o.number} (${o.businessDate})`);
    const pep = rf.lines.find((l: any) => order(o.id).lines.find((x) => x.id === l.lineId)?.productId === 'p_pepsi');
    const amount = (Number(pep.unitRefundable) * 2).toFixed(2);
    const r = await api<any>(c, 'Refund.Request', { params: { orderId: o.id }, body: { amount, method: 'CASH', allocations: [{ captureId: rf.captures[0].captureId, amount }], lines: [{ lineId: pep.lineId, quantity: '2', disposition: 'RETURN_TO_STOCK' }], reasonCode: 'QUALITY_ISSUE', reason: 'كانزات مقفولة رجعت' } }, log, `request ${amount}`);
    log({ ok: r.stage === 'S3' && r.afterClose, text: `refund stage ${r.stage}, afterClose ${r.afterClose}, original ${r.originalBusinessDate}`, plain: t('السيستم عرف إنه مرتجع بعد قفل يوم {d}', { d: r.originalBusinessDate }) });
    const cmd = newCommandId();
    let d: any;
    try { await call(c, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 1, payoutMethod: 'CASH' }, commandId: cmd }); } catch (e) { d = (e as ApiFailure).details; log({ ok: d?.action === 'RETURN_AFTER_CLOSE', text: `→ ${(e as ApiFailure).code} ${d?.action}`, plain: t('«مرتجع بعد قفل اليوم» طلب الصلاحية التالتة') }); }
    await expectRefusal(api(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-manager-1'), approverCredentialKind: 'PIN', approverSecret: demo.pin, overridePermission: d.override } }), 'APPROVER_NOT_AUTHORIZED', log, 'branch manager approves a return after close', t('أحمد (مدير الصالة) حاول يوافق'));
    const g = await api<any>(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-accountant'), approverCredentialKind: 'PIN', approverSecret: demo.pin, overridePermission: d.override } }, log, 'accountant PIN');
    const paid = await api<any>(c, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 1, payoutMethod: 'CASH', approvalGrantId: g.grantId }, commandId: cmd }, log, 'pay out with the accountant grant');
    const today = store.db.businessDays && paid.businessDate;
    log({ ok: paid.businessDate !== o.businessDate && JSON.stringify(day.summary) === frozen, text: `booked on ${today}; original day ${o.businessDate} summary unchanged: ${JSON.stringify(day.summary) === frozen}`, plain: t('المرتجع اتسجل على يوم {t} ومربوط بشيك {n} — أرقام يوم {d} زي ما هي', { t: paid.businessDate, n: o.number, d: o.businessDate }) });
    const back = ((store.db as any).inv?.movements ?? []).filter((m: any) => m.kind === 'CUSTOMER_RETURN' && m.source?.orderId === o.id).length;
    log({ ok: back > 0, text: `stock CUSTOMER_RETURN movements: ${back}`, plain: back ? t('الكانزات رجعت رصيد المخزن') : t('مفيش حركة رجوع للمخزن') });
    traceLine(log, t('مرتجع بعد قفل اليوم'));
  } },
  { id: 'J-P1-5', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', text: { who: 'سارة تسجل وجبة موظف ليوسف، وأحمد يوافق', do_ar: 'حد يوسف في اليوم 200 جنيه بسعر البيع. سارة تحاول مشويات مشكلة (أكتر من الحد)، وبعدين شاورما. وجبة لأحمد نفسه يوافق عليها أحمد. وبعدين وجبة تكمّل الحد بالظبط ووجبة تعدّيه بجنيه.', do_en: 'Youssef\'s daily allowance is 200 EGP at sale price. Sara tries a mixed grill (over), then a shawarma. A meal for Ahmed approved by Ahmed. Then a meal exactly at the cap and one just over.', expect_ar: 'المشويات تترفض قبل ما تتسجل مع الباقي من الحد. الشاورما محتاجة موافقة مدير، بتتبعت للمطبخ وبتسحب من المخزن، ومش بيع ولا خصم. أحمد ما يوافقش على وجبته. اللي على الحد بالظبط تتقبل واللي فوقه تترفض.', expect_en: 'The mixed grill is refused before it is recorded, with the remaining allowance. The shawarma needs a manager, goes to the kitchen and uses stock; it is neither a sale nor a discount. Ahmed cannot approve his own meal. Exactly at the cap is accepted; above is refused.', operations: [{ op: 'Order.CreateStaffMeal', http: 'POST /staff-meals', actor: 'cashier + manager', expected: 'STAFF_MEAL approval, allowance' }] }, run: async (log) => {
    const c = await cashier(log);
    demo.setPolicy('StaffMealAllowancePolicy', { enabled: true, basis: 'SALE_PRICE', dailyLimit: '200.00' });
    const yousef = userIdOf('demo-waiter-2');
    await expectRefusal(api(c, 'Order.CreateStaffMeal', { body: { employeeUserId: yousef, lines: [{ productId: 'p_mixed_grill', quantity: '1', modifierOptionIds: ['opt_well'] }] } }), 'STAFF_MEAL_ALLOWANCE_EXCEEDED', log, 'mixed grill 320 > 200', t('وجبة مشويات مشكلة ليوسف (أكتر من الحد)'));
    await expectRefusal(api(c, 'Order.CreateStaffMeal', { body: { staffName: 'حسام خالد', lines: [{ productId: 'p_chicken_shawarma', quantity: '1' }] } }), 'STAFF_MEAL_EMPLOYEE_REQUIRED', log, 'free-text name (not a user)', t('وجبة لاسم مكتوب بإيد (مش موظف متسجل)'));
    const ticketsBefore = store.db.tickets.length;
    const meal = await approveInPlace<any>(c, 'Order.CreateStaffMeal', { body: { employeeUserId: yousef, lines: [{ productId: 'p_chicken_shawarma', quantity: '1' }] } }, { approver: 'demo-manager-1' }, log, 'shawarma for Youssef');
    state.meal = meal.id;
    await new Promise((r) => setTimeout(r, 50));
    const al = await api<any>(c, 'StaffMeal.Allowance', {}, log);
    const me = al.people.find((p: any) => p.userId === yousef);
    const effects = Object.values(((store.db as any).inv?.orderEffects ?? {}) as Record<string, any>).filter((e) => e.orderId === meal.id && e.state === 'SALE').length;
    log({ ok: meal.staffMeal?.approverId === userIdOf('demo-manager-1') && Number(me.remaining) === 200 - Number(meal.staffMeal.value), text: `meal ${meal.number} value ${meal.staffMeal?.value}; Youssef used ${me.used} remaining ${me.remaining}; tickets +${store.db.tickets.length - ticketsBefore}; stock effects ${effects}; payable ${meal.totals.payable}`, plain: t('وجبة يوسف اتسجلت بموافقة أحمد — باقي له {r} النهارده، راحت المطبخ وسحبت من المخزن، والمطلوب صفر (مش بيع)', { r: egp(me.remaining) }) });
    // the employee cannot approve their own meal
    let d: any;
    try { await call(c, 'Order.CreateStaffMeal', { body: { employeeUserId: userIdOf('demo-manager-1'), lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }); } catch (e) { d = (e as ApiFailure).details; }
    if (d) {
      const g = await api<any>(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-manager-1'), approverCredentialKind: 'PIN', approverSecret: demo.pin } }, log, 'Ahmed approves a meal for Ahmed');
      await expectRefusal(api(c, 'Order.CreateStaffMeal', { body: { employeeUserId: userIdOf('demo-manager-1'), lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }], approvalGrantId: g.grantId } }), 'SELF_APPROVAL_DENIED', log, 'meal for the approver himself', t('أحمد وافق على وجبته هو'));
    }
    // exactly at the cap vs above it: the limit is set to what is used + two teas
    const tea = store.db.priceRules.find((r) => r.productId === 'p_tea' && r.channel === 'TAKEAWAY' && r.branchId === 'branch_main' && !r.salesChannelId && !r.variantId)!;
    const cap = (Number(me.used) + Number(tea.amount) * 2).toFixed(2);
    demo.setPolicy('StaffMealAllowancePolicy', { enabled: true, basis: 'SALE_PRICE', dailyLimit: cap });
    log({ ok: null, text: `allowance set to ${cap} for the cap test`, plain: t('جهّزنا الحد على {c} عشان نجرب «على الحد بالظبط»', { c: egp(cap) }) });
    await approveInPlace(c, 'Order.CreateStaffMeal', { body: { employeeUserId: yousef, lines: [{ productId: 'p_tea', quantity: '2', modifierOptionIds: ['opt_size_regular'] }], sendToKitchen: false } }, { approver: 'demo-manager-2' }, log, 'two teas = exactly the cap (send later)');
    state.held = [...store.db.orders].reverse().find((o) => o.kind === 'STAFF_MEAL' && o.staffMeal?.employeeUserId === yousef && o.status === 'COMPLETED' && o.rounds.length === 0)?.id;
    await expectRefusal(api(c, 'Order.CreateStaffMeal', { body: { employeeUserId: yousef, lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }), 'STAFF_MEAL_ALLOWANCE_EXCEEDED', log, 'one more tea > cap', t('شاي زيادة بعد ما الحد خلص'));
    demo.setPolicy('StaffMealAllowancePolicy', { enabled: true, basis: 'SALE_PRICE', dailyLimit: '200.00' });
  } },
  { id: 'J-P1-6', device: 't_cash', user: 'demo-cashier-a', screen: 'refunds', text: { who: 'سارة، أحمد، هبة والحاج سامي', do_ar: 'إلغاء وجبات الموظفين في كل مرحلة: الشاي اللي لسه ما اتبعتش، الشاورما اللي راحت المطبخ، ووجبة امبارح (اليوم اتقفل) كمرتجع.', do_en: 'Cancelling staff meals at each stage: the tea not sent yet, the shawarma already in the kitchen, and yesterday\'s meal (day closed) as a return.', expect_ar: 'كل مرحلة بموافقتها: قبل المطبخ = مدير «شيل قبل ما يظهر»، بعد المطبخ = مدير «إلغاء بعد ما اتبعت» مع مصير الصنف، بعد القفل = الصلاحية التالتة ومن غير ما يوم امبارح يتغير. الحد يرجع ليوسف.', expect_en: 'Each stage with its own approval: before kitchen = manager "remove before visible", after kitchen = manager "void after sent" with the item disposition, after close = third-level permission without touching yesterday. Youssef\'s allowance comes back.', operations: [{ op: 'Order.CancelStaffMeal', http: 'POST /staff-meals/{id}/cancel', actor: 'cashier + manager / accountant', expected: 'S0 / S1 / S3' }] }, run: async (log) => {
    const c = await cashier(log);
    if (state.held) {
      await approveInPlace(c, 'Order.CancelStaffMeal', { params: { orderId: state.held }, body: { expectedVersion: order(state.held).version, reasonCode: 'CUSTOMER_CHANGED_MIND', reason: 'يوسف مش عايز شاي' } }, { approver: 'demo-manager-1' }, log, 'cancel the held teas (before kitchen)');
      log({ ok: lastRev()?.stage === 'S0', text: `stage ${lastRev()?.stage}`, plain: t('اتلغت قبل ما تتبعت للمطبخ (مرحلة «قبل ما يظهر») — ما اتعملتش') });
    }
    if (state.meal) {
      await approveInPlace(c, 'Order.CancelStaffMeal', { params: { orderId: state.meal }, body: { expectedVersion: order(state.meal).version, reasonCode: 'WRONG_ITEM', reason: 'اتسجلت بالغلط', disposition: 'WASTE_HELD' } }, { approver: 'demo-manager-2', kind: 'FINGERPRINT' }, log, 'cancel the shawarma (after kitchen)');
      const r = lastRev();
      log({ ok: r?.stage === 'S1' && r?.disposition === 'WASTE_HELD' && r.review?.state === 'PENDING', text: `stage ${r?.stage}, disposition ${r?.disposition}, review ${r?.review?.state}`, plain: t('اتلغت بعد المطبخ: هالك محفوظ — راحت طابور مراجعة المحاسب') });
      const al = await api<any>(c, 'StaffMeal.Allowance', {});
      log({ ok: true, text: `Youssef remaining ${al.people.find((p: any) => p.userId === userIdOf('demo-waiter-2'))?.remaining}`, plain: t('حد يوسف رجع: باقي له {r}', { r: egp(al.people.find((p: any) => p.userId === userIdOf('demo-waiter-2'))?.remaining) }) });
    }
    const y = store.db.orders.find((o) => o.id === 'ord_hist_y2');
    if (y) {
      const day = (store.db.businessDays ?? []).find((d) => d.branchId === y.branchId && d.date === y.businessDate)!;
      const frozen = JSON.stringify(day.summary);
      await approveInPlace(c, 'Order.CancelStaffMeal', { params: { orderId: y.id }, body: { expectedVersion: y.version, reasonCode: 'QUALITY', reason: 'يوسف رجّعها باظت امبارح بالليل', disposition: 'WASTE_HELD' } }, { approver: 'demo-owner', kind: 'CARD' }, log, `return yesterday's meal ${y.number} (after close)`);
      const r = lastRev();
      log({ ok: r?.stage === 'S3' && r.afterClose && order(y.id).status === 'COMPLETED' && JSON.stringify(day.summary) === frozen, text: `stage ${r?.stage}, booked ${r?.businessDate}, original ${r?.originalBusinessDate}, meal still ${order(y.id).status}`, plain: t('مرتجع وجبة امبارح اتسجل على النهارده بموافقة الحاج سامي (كارت) — وجبة امبارح ويومها ما اتغيروش') });
    }
  } },
  { id: 'J-P1-7', device: 't_admin', user: 'demo-manager-1', screen: 'void-review', text: { who: 'نادر المحاسب من الإدارة', do_ar: 'نادر يفتح «مراجعة الهالك»: شاورما الوجبة الملغية لقاها ملفوفة ومكتوب عليها — «اتشاف». وجبة امبارح ما لقاهاش — «مش موجود» مع ملاحظة.', do_en: 'Nader opens the void review: the cancelled meal\'s shawarma is there, wrapped and labelled — "verified". Yesterday\'s meal is not there — "missing" with a note.', expect_ar: 'المراجع مش ممكن يبقى هو اللي وافق. «مش موجود» بيعمل تنبيه وعلامة على المدير اللي وافق.', expect_en: 'The reviewer cannot be the approver. "Missing" raises an alert and flags the approving manager.', operations: [{ op: 'VoidReview.Decide', http: 'POST /void-reviews/{id}/decision', actor: 'accountant', expected: 'VERIFIED / MISSING' }] }, run: async (log) => {
    const a = await as('t_admin', 'demo-accountant', log);
    const q = await api<any>(a, 'VoidReview.Find', { query: { state: 'PENDING' } }, log, 'pending queue');
    const items: any[] = q.items;
    log({ ok: items.length >= 2, text: `pending ${items.length}`, plain: t('في {n} صنف هالك مستني المراجعة', { n: items.length }) });
    const meal = items.find((r) => r.orderId === state.meal);
    const y = items.find((r) => r.orderId === 'ord_hist_y2');
    if (meal) await api(a, 'VoidReview.Decide', { params: { reversalId: meal.id }, body: { decision: 'VERIFIED', note: 'ملفوفة ومكتوب عليها' } }, log, 'verified');
    if (y) {
      await expectRefusal(api(a, 'VoidReview.Decide', { params: { reversalId: y.id }, body: { decision: 'MISSING' } }), 'VALIDATION_FAILED', log, 'missing without a note', t('«مش موجود» من غير ملاحظة'));
      await api(a, 'VoidReview.Decide', { params: { reversalId: y.id }, body: { decision: 'MISSING', note: 'مفيش حاجة في التلاجة بالاسم ده' } }, log, 'missing');
    }
    const flags = (await api<any>(a, 'VoidReview.Find', {})).flags as any[];
    const alert = store.db.alerts.find((x) => x.kind === 'VOID_ITEM_MISSING');
    log({ ok: !!alert && flags.some((f) => f.missing > 0), text: `alert ${alert?.id}; flags ${flags.map((f) => `${f.name}:${f.missing}`).join(', ')}`, plain: t('اتعمل تنبيه، و«{n}» عليه علامة صنف ناقص', { n: personName(null, flags.find((f) => f.missing > 0)?.name) }) });
  } },
  { id: 'J-P1-8', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', text: { who: 'سارة على جهاز الكاشير، وهبة من كمبيوتر المدير', do_ar: 'سارة تلغي طلب تيك أواي لسه ما اتبعتش وتبعت الطلب لهبة على جهازها (مش جنبها). هبة ترفض مرة، وبعدين توافق. وموافقة قديمة خلص وقتها.', do_en: 'Sara cancels an unsent takeaway and sends the request to Heba\'s device. Heba rejects once, then approves. An old grant expired.', expect_ar: 'الرفض ما يكتبش حاجة. الموافقة من بعيد بتكمّل نفس العملية على جهاز الكاشير. الموافقة اللي عدّى عليها دقيقتين تترفض.', expect_en: 'A rejection writes nothing. A remote approval completes the same command on the cashier device. A grant older than two minutes is refused.', operations: [{ op: 'ApprovalRequest.Create', http: 'POST /approval-requests', actor: 'cashier', expected: 'manager decides remotely' }] }, run: async (log) => {
    const c = await cashier(log);
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }] } }, log, 'kofta');
    const body = { expectedVersion: order(o.id).version, reasonCode: 'OPENED_BY_MISTAKE', reason: 'اتفتح بالغلط' };
    const cmd = newCommandId();
    let d: any;
    try { await call(c, 'Order.Cancel', { params: { orderId: o.id }, body, commandId: cmd }); } catch (e) { d = (e as ApiFailure).details; log({ ok: d?.action === 'LINE_REMOVE_UNSENT', text: `Order.Cancel → ${(e as ApiFailure).code} ${d?.action}`, plain: t('إلغاء شيك فيه أصناف (لسه ما اتبعتش) طلب موافقة مدير') }); }
    const send = () => api<any>(c, 'ApprovalRequest.Create', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, opId: 'Order.Cancel', commandId: cmd } }, log, 'request to Heba');
    const m = await as('t_admin', 'demo-manager-2', log);
    let req = await send();
    await api(m, 'ApprovalRequest.Decide', { params: { requestId: req.id }, body: { decision: 'REJECT', note: 'استنى أكلمه', expectedVersion: req.version } }, log, 'Heba rejects');
    log({ ok: order(o.id).status === 'DRAFT', text: `after reject: ${order(o.id).status}`, plain: t('هبة رفضت — الشيك زي ما هو ومفيش حاجة اتكتبت') });
    req = await send();
    const dec = await api<any>(m, 'ApprovalRequest.Decide', { params: { requestId: req.id }, body: { decision: 'APPROVE', expectedVersion: req.version } }, log, 'Heba approves from her PC');
    await api(c, 'Order.Cancel', { params: { orderId: o.id }, body: { ...body, approvalGrantId: dec.grantId }, commandId: cmd }, log, 'cancel continues with the remote grant');
    const r = lastRev();
    log({ ok: order(o.id).status === 'CANCELLED' && r?.credentialKind === 'REMOTE', text: `order ${order(o.id).status}; trace credential ${r?.credentialKind} approver ${r?.approverId}`, plain: t('الشيك اتلغى، والسجل بيقول هبة وافقت من جهازها') });
    // an expired grant (aged record — no clock change)
    const o2 = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway 2');
    await api(c, 'Order.AddLines', { params: { orderId: o2.id }, body: { expectedVersion: order(o2.id).version, lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }, log, 'tea');
    const l = order(o2.id).lines[0];
    const b2 = { expectedVersion: order(o2.id).version, expectedLineVersion: l.version };
    try { await call(c, 'Order.RemoveLine', { params: { orderId: o2.id, lineId: l.id }, body: b2 }); } catch (e) { d = (e as ApiFailure).details; }
    const g = await api<any>(c, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf('demo-manager-1'), approverCredentialKind: 'PIN', approverSecret: demo.pin } }, log, 'Ahmed PIN');
    const rec = store.db.grants.find((x) => x.id === g.grantId)!;
    rec.expiresAtMs = clock.now() - 1000; // the grant is older than its TTL (aged record)
    log({ ok: null, text: 'grant aged past its TTL', plain: t('عدّى على الموافقة أكتر من دقيقتين (من غير ما نغير الساعة)') });
    await expectRefusal(api(c, 'Order.RemoveLine', { params: { orderId: o2.id, lineId: l.id }, body: { ...b2, approvalGrantId: g.grantId } }), 'APPROVAL_GRANT_EXPIRED', log, 'use an expired grant', t('استخدام موافقة خلص وقتها'));
  } },
  { id: 'J-P1-9', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', text: { who: 'محمود الويتر على التابلت', do_ar: 'ترابيزة 9 قاعد عليها 2. محمود يفتح شيك، وبعدين شيك تاني، وبعدين يحاول شيك تالت ويقسم على 3.', do_en: 'Table 9 has 2 guests. Mahmoud opens a check, then a second, then tries a third and a split into 3.', expect_ar: 'عدد الشيكات مايعديش عدد الأفراد: الشيك التالت والتقسيم على 3 يترفضوا.', expect_en: 'No more checks than guests: the third check and the 3-way split are refused.', operations: [{ op: 'Order.Create', http: 'POST /orders', actor: 'waiter', expected: 'SPLIT_LIMIT_GUESTS' }] }, run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const tid = store.db.tables.find((x) => x.name === '9' && x.branchId === 'branch_main')!.id;
    let v = store.db.visits.find((x) => x.state === 'OPEN' && x.tableId === tid);
    if (v) { log({ ok: null, text: 'table 9 busy — skipping', plain: t('ترابيزة 9 مشغولة — هنستخدم ترابيزة تانية') }); }
    const free = store.db.tables.find((x) => x.branchId === 'branch_main' && x.active && !store.db.visits.some((y) => y.state === 'OPEN' && y.tableId === x.id))!;
    v = await api<any>(w, 'TableVisit.Open', { params: { tableId: free.id }, body: { guestCount: 2 } }, log, `table ${free.name} (2 guests)`);
    const c1 = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: free.id } }, log, 'check 1');
    await api(w, 'Order.AddLines', { params: { orderId: c1.id }, body: { expectedVersion: order(c1.id).version, lines: [{ productId: 'p_tea', quantity: '3', modifierOptionIds: ['opt_size_regular'] }] } }, log, 'tea ×3');
    await expectRefusal(api(w, 'Order.Split', { params: { orderId: c1.id }, body: { expectedVersion: order(c1.id).version, mode: 'EQUAL', parts: 3 } }), 'SPLIT_LIMIT_GUESTS', log, 'split into 3 with 2 guests', t('تقسيم الشيك على 3 والقاعدين 2'));
    await api(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: free.id } }, log, 'check 2');
    await expectRefusal(api(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: free.id } }), 'SPLIT_LIMIT_GUESTS', log, 'check 3 with 2 guests', t('شيك تالت والقاعدين 2'));
  } },
];

export const CONTROL_JOURNEY = {
  id: 'J-P1', title: 'مين عمل ومين سمح (الإلغاء والمرتجع ووجبة الموظف)', titleEn: 'Who did it vs who allowed it', reset: 'DEMO' as const,
  intro: 'الكاشير بيعمل الحركة والمدير بيوافق في مكانه بالرقم السري أو الكارت أو البصمة أو من موبايله: شيل صنف بعد الشيك المبدئي، مرتجع من درج الكاشير، مرتجع بعد قفل اليوم بالصلاحية التالتة، وجبة موظف بحد يومي وإلغاؤها في كل مرحلة، ومراجعة المحاسب للهالك.',
  steps: P1,
};
