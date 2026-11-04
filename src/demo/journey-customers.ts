// ux-13 journey J-K1 — customers and loyalty with the phone masked, against the mock: the cashier finds the customer by the
// whole number and sees it masked (part of a number finds nobody, no «إظهار الرقم»); the manager reveals it with a reason
// (audited, nothing kept); a check with the customer earns points when it completes; the next check is paid in part with
// points within the cap (over the cap refused); a manual adjustment needs a second manager (self-approval refused, stale
// balance refused); then the settings change the effect: FULL_IN_VIEWS shows the manager the number, a lower redeem cap
// lowers the points allowed on a check. Every setting change goes through Settings.UpdatePolicy with the approval.
import { api, as, expectRefusal, withApproval, order, openSession, type Logger } from './runner';
import { store } from '../mock/store';
import { t } from '../i18n';
import { D, m4 } from '../mock/money';
import { maskPhone } from '../mock/privacy';
import type { StepDef } from './scripts';

const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });
/** نورهان أشرف (C-0010): a regular with points, not used by the other journeys. */
const cust = () => store.db.customers!.find((c) => c.code === 'C-0010')!;
const S: { first?: string; second?: string; earned?: number } = {};
const balance = (id: string) => store.db.loyaltyEntries!.filter((e) => e.customerId === id).reduce((a, e) => a + e.points, 0);

async function cashier(log: Logger) {
  const c = await as('t_cash', 'demo-cashier-a', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
  return c;
}
async function policyChange(log: Logger, policyId: string, patch: Record<string, unknown>) {
  const o = await as('t_admin', 'demo-owner', log);
  const cur = store.db.policyValues.find((v) => v.policyId === policyId && v.scopeType === 'TENANT');
  await withApproval(o, 'Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...((cur?.value as object) ?? {}), ...patch }, changeNote: 'J-K1' } }, 'demo-manager-1', log, `${policyId} ${JSON.stringify(patch)}`);
}
/** A takeaway check for the customer (kofta ×n), confirmed. */
async function check4(log: Logger, n: string) {
  const c = await cashier(log);
  const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
  await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_kofta', quantity: n, modifierOptionIds: ['opt_medium'] }] } }, log, `kofta ×${n}`);
  await api(c, 'Order.SetCustomer', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, customerId: cust().id } }, log, 'the customer on the check');
  await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
  return { c, id: o.id as string };
}

const K1: StepDef[] = [
  { id: 'J-K1-1', device: 't_cash', user: 'demo-cashier-a', screen: 'customers', run: async (log) => {
    const pv = store.db.policyValues.find((v) => v.policyId === 'CustomerPrivacyPolicy' && v.scopeType === 'TENANT')?.value as any;
    check(log, pv?.phoneDisplay === 'MASKED_UNLESS_PERMITTED' && pv?.revealMode === 'WITH_REASON' && pv?.riderAccess === 'OUT_FOR_DELIVERY' && pv?.partialSearch === 'PERMITTED_ONLY', `CustomerPrivacyPolicy ${JSON.stringify(pv)}`, t('الإعداد الافتراضي: الرقم مخفي لمن لا يملك صلاحية عرضه'));
    const c = await cashier(log);
    const cu = cust();
    const found = await api<any>(c, 'Customer.Search', { query: { phone: cu.phone } }, log, 'lookup by the whole number');
    check(log, found.items.length === 1 && found.items[0].id === cu.id && found.items[0].phone === maskPhone(cu.phone) && !JSON.stringify(found).includes(cu.phone), `${found.items[0]?.name} ${found.items[0]?.phone}`, t('وجد الكاشير العميل بكتابة رقمه كاملًا، والرقم يظهر مخفيًا'));
    const part = await api<any>(c, 'Customer.Search', { query: { phone: cu.phone.slice(0, 6) } }, log, 'part of the number');
    check(log, part.items.length === 0 && part.phoneSearch === 'FULL_NUMBER_REQUIRED', `part → ${part.items.length} (${part.phoneSearch})`, t('جزء من الرقم لا يجد أحدًا: يُكتب الرقم كاملًا'));
    const prof = await api<any>(c, 'Customer.Get', { params: { customerId: cu.id } }, log, 'profile');
    check(log, prof.phone === maskPhone(cu.phone) && prof.phoneReveal === false, `profile ${prof.phone}; reveal ${prof.phoneReveal}`, t('ملف العميل عند الكاشير: الرقم مخفي ولا يوجد زر «إظهار الرقم»'));
    await expectRefusal(api(c, 'Customer.RevealPhone', { params: { customerId: cu.id }, body: { reason: 'تأكيد العنوان', expectedVersion: cu.version } }), 'PERMISSION_DENIED', log, 'the cashier reveals', t('لا يُظهر الكاشير الرقم'));
  } },
  { id: 'J-K1-2', device: 't_admin', user: 'demo-manager-1', screen: () => ['customer', { customerId: cust().id }], run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const cu = cust();
    const prof = await api<any>(m, 'Customer.Get', { params: { customerId: cu.id } }, log, 'profile');
    check(log, prof.phone === maskPhone(cu.phone) && prof.phoneReveal === true, `manager: ${prof.phone}; reveal offered`, t('عند المدير الرقم مخفي أيضًا، ويظهر زر «إظهار الرقم»'));
    await expectRefusal(api(m, 'Customer.RevealPhone', { params: { customerId: cu.id }, body: { reason: '', expectedVersion: cu.version } }), 'VALIDATION_FAILED', log, 'reveal without a reason', t('الإظهار بلا سبب مرفوض'));
    const r = await api<any>(m, 'Customer.RevealPhone', { params: { customerId: cu.id }, body: { reason: 'الاتصال بالعميل لتأكيد طلب', expectedVersion: cu.version } }, log, 'reveal with a reason');
    const au = store.db.audit.find((x) => x.op === 'Customer.RevealPhone' && x.target === cu.id);
    check(log, r.phone === cu.phone && !!au && au.summary.includes('الاتصال بالعميل') && !au.summary.includes(cu.phone), `revealed once; audit «${au?.summary}»`, t('ظهر الرقم مرة واحدة، وسُجل في المراجعة من أظهره ولماذا دون الرقم'));
    const again = await api<any>(m, 'Customer.Get', { params: { customerId: cu.id } });
    check(log, again.phone === maskPhone(cu.phone), `profile again: ${again.phone}`, t('بعد الإغلاق يعود الرقم مخفيًا'));
  } },
  { id: 'J-K1-3', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const cu = cust();
    const before = balance(cu.id);
    const { c, id } = await check4(log, '2');
    await api(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: '1000.00' }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'complete');
    S.first = id;
    const e = store.db.loyaltyEntries!.find((x) => x.orderId === id && x.kind === 'EARN');
    S.earned = e?.points ?? 0;
    const tierMult = D(e?.multiplier ?? '1');
    const expect = D(e?.amount ?? '0').dividedBy(D('10')).times(tierMult).floor().toNumber();
    check(log, !!e && e.points > 0 && e.points === expect && balance(cu.id) === before + e.points, `EARN +${e?.points} on ${m4(e?.amount ?? '0')} (×${tierMult.toString()}); balance ${before} → ${balance(cu.id)}`, t('اكتمل الشيك فكسب العميل نقاطًا حسب قواعد البرنامج'));
  } },
  { id: 'J-K1-4', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const cu = cust();
    const { c, id } = await check4(log, '1');
    S.second = id;
    const q = await api<any>(c, 'Loyalty.Balance', { params: { customerId: cu.id }, query: { orderId: id } }, log, 'points on this check');
    const cap = D(q.redeem.remaining).times(q.program.maxRedeemPercent).dividedBy(100);
    check(log, q.redeem.canRedeem && D(q.redeem.maxValue).lte(cap), `max ${q.redeem.maxPoints} points = ${q.redeem.maxValue} (cap ${q.program.maxRedeemPercent}% = ${m4(cap)})`, t('أقصى نقاط على هذا الشيك لا تتجاوز نسبة الإعداد'));
    check(log, q.redeem.maxPoints < q.balance, `balance ${q.balance} > cap ${q.redeem.maxPoints}`, t('رصيد العميل أكبر من الحد المسموح على هذا الشيك'));
    if (q.redeem.maxPoints < q.balance) await expectRefusal(api(c, 'Loyalty.Redeem', { body: { orderId: id, points: q.redeem.maxPoints + 1 } }), 'LOYALTY_REDEEM_LIMIT', log, 'over the cap', t('النقاط فوق الحد مرفوضة'));
    const pts = q.redeem.maxPoints;
    const r = await api<any>(c, 'Loyalty.Redeem', { body: { orderId: id, points: pts } }, log, `redeem ${pts}`);
    check(log, r.capture.method === 'LOYALTY' && r.capture.amount === m4(D(pts).times(D(q.program.pointValue))) && r.entry.points === -pts, `LOYALTY ${r.capture.amount}; remaining ${r.settlement.remaining}`, t('دُفع جزء من الشيك بالنقاط، والباقي على الكاشير'));
    await api(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: '1000.00' }] } }, log, 'cash for the rest');
    await api(c, 'Order.Complete', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'complete');
    const e = store.db.loyaltyEntries!.find((x) => x.orderId === id && x.kind === 'EARN');
    check(log, !!e && D(e.amount ?? '0').lte(D(order(id).lines.reduce((a, l) => a.plus(D(l.lineTotal)), D(0))).minus(D(r.capture.amount))), `EARN on ${e?.amount} (the part paid with points earns nothing)`, t('الجزء المدفوع بالنقاط لا يكسب نقاطًا'));
  } },
  { id: 'J-K1-5', device: 't_admin', user: 'demo-manager-1', screen: () => ['customer', { customerId: cust().id }], run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const cu = cust();
    const b = (await api<any>(m, 'Loyalty.Balance', { params: { customerId: cu.id } })).balance;
    await expectRefusal(api(m, 'Loyalty.Adjust', { params: { customerId: cu.id }, body: { points: 30, reason: 'تعويض عن تأخير طلب', expectedBalance: b - 1 } }), 'CONCURRENCY_CONFLICT', log, 'a balance that changed meanwhile', t('رصيد تغيّر منذ فتح النافذة: مرفوض'));
    await expectRefusal(api(m, 'Loyalty.Adjust', { params: { customerId: cu.id }, body: { points: 30, reason: 'تعويض عن تأخير طلب', expectedBalance: b } }), 'APPROVAL_REQUIRED', log, '30 points (LOYALTY_ADJUST ALWAYS)', t('أي تعديل يدوي يحتاج موافقة مدير'));
    let self: string | null = null;
    try { await api(m, 'Approval.Grant', { body: { action: 'LOYALTY_ADJUST', targetType: 'customers.Customer', targetId: cu.id, context: { customerId: cu.id, points: '30', absPoints: '30', reason: 'تعويض عن تأخير طلب' }, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: '123456' } }); } catch (e: any) { self = e.code; }
    check(log, self === 'SELF_APPROVAL_DENIED', `self approval → ${self}`, t('لا يوافق المدير على طلبه هو'));
    const r = await withApproval<any>(m, 'Loyalty.Adjust', { params: { customerId: cu.id }, body: { points: 30, reason: 'تعويض عن تأخير طلب', expectedBalance: b } }, 'demo-manager-2', log, '+30 points');
    const au = store.db.audit.find((x) => x.op === 'Loyalty.Adjust' && x.target === cu.id);
    check(log, r.entry.kind === 'ADJUST' && !!r.entry.approvalGrantId && balance(cu.id) === b + 30 && !!au?.approvalGrantId && au.summary.includes(`${b} → ${b + 30}`), `ADJUST +30 (${b} → ${b + 30}) approved by demo-manager-2`, t('أُضيفت النقاط بموافقة مدير آخر، وسُجلت الحركة والسبب في المراجعة'));
  } },
  { id: 'J-K1-6', device: 't_admin', user: 'demo-owner', screen: 'settings', run: async (log) => {
    const cu = cust();
    await policyChange(log, 'CustomerPrivacyPolicy', { revealMode: 'FULL_IN_VIEWS' });
    const m = await as('t_admin', 'demo-manager-1', log);
    const pm = await api<any>(m, 'Customer.Get', { params: { customerId: cu.id } }, log, 'manager profile');
    const c = await cashier(log);
    const pc = await api<any>(c, 'Customer.Get', { params: { customerId: cu.id } }, log, 'cashier profile');
    check(log, pm.phone === cu.phone && pc.phone === maskPhone(cu.phone), `FULL_IN_VIEWS: manager ${pm.phone}, cashier ${pc.phone}`, t('بعد التغيير يرى المدير الرقم كاملًا، ويبقى مخفيًا عند الكاشير'));
    await policyChange(log, 'CustomerPrivacyPolicy', { revealMode: 'WITH_REASON' });
    const cur = store.db.policyValues.find((v) => v.policyId === 'LoyaltyProgramPolicy' && v.scopeType === 'TENANT')?.value as any;
    const was = cur?.maxRedeemPercent ?? 50;
    await policyChange(log, 'LoyaltyProgramPolicy', { maxRedeemPercent: 10 });
    const { id } = await check4(log, '3');
    const q = await api<any>(c, 'Loyalty.Balance', { params: { customerId: cu.id }, query: { orderId: id } }, log, 'points on a new check');
    check(log, q.program.maxRedeemPercent === 10 && D(q.redeem.maxValue).lte(D(q.redeem.remaining).times(10).dividedBy(100)), `cap 10%: max ${q.redeem.maxPoints} points = ${q.redeem.maxValue}`, t('خفض نسبة الصرف يخفض النقاط المسموحة على الشيك الجديد'));
    await api(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: '1000.00' }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'complete');
    await policyChange(log, 'LoyaltyProgramPolicy', { maxRedeemPercent: was });
    const ph = store.db.policyHistory.filter((h) => (h.policyId === 'CustomerPrivacyPolicy' || h.policyId === 'LoyaltyProgramPolicy') && h.via === 'SETTINGS' && h.note === 'J-K1');
    check(log, ph.length >= 4, `${ph.length} audited setting changes`, t('كل تغيير إعداد مسجل في سجل الإعدادات بموافقة'));
  } },
];

export const CUSTOMERS_JOURNEY = {
  id: 'J-K1', title: 'العملاء والولاء وإخفاء الرقم', titleEn: 'Customers, loyalty and phone masking', reset: null,
  intro: 'البحث برقم العميل كاملًا والرقم مخفي، إظهار الرقم بسبب، كسب النقاط، الدفع بالنقاط ضمن الحد، تعديل يدوي بموافقة مدير آخر، وأثر تغيير الإعدادات.',
  steps: K1,
};
