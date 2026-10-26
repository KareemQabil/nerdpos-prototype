// Negative controls N1..N12 (journeys/NEGATIVE_CONTROLS_N1_N12.md), reproduced against the mock.
// Each control asserts the expected outcome AND that nothing extra was written.
import { api, as, expectRefusal, tableId, openVisit, order, openSession, sleep, userIdOf, type Logger } from './runner';
import { call, newCommandId, ApiFailure } from '../api/client';
import { store } from '../mock/store';
import { sim } from '../mock/sim';
import { demo } from '../mock/demo';
import { runOutbox } from '../mock/outbox';
import { devices } from '../app/devices';

async function freshCheck(log: Logger, table: string, lines: any[] = [{ productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }]) {
  const w = await as('t_floor', 'demo-waiter-1', log);
  if (!openVisit(table)) await api(w, 'TableVisit.Open', { params: { tableId: tableId(table) }, body: { guestCount: 2 } }, log, `table ${table}`);
  const o = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId(table) } }, log, 'check');
  await api(w, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines } }, log, 'lines');
  return { w, id: o.id as string };
}
async function cashierWithShift(log: Logger) {
  const c = await as('t_cash', 'demo-cashier-b', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift');
  return c;
}
async function confirmedCheck(log: Logger, table: string) {
  const { w, id } = await freshCheck(log, table);
  const c = await cashierWithShift(log);
  await api(c, 'Order.Confirm', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'confirm');
  return { c, id, w };
}
const freeTable = (prefer: string[]) => prefer.find((n) => !openVisit(n)) ?? prefer[0];

export const NEGATIVE_RUNS: Record<string, (log: Logger) => Promise<boolean>> = {
  N1: async (log) => {
    const table = freeTable(['11', '10', '9']);
    const w1 = await as('t_floor', 'demo-waiter-1', log);
    const cmd = newCommandId();
    const first = await call(w1, 'TableVisit.Open', { params: { tableId: tableId(table) }, body: { guestCount: 2 }, commandId: cmd });
    log({ ok: first.status === 201, text: `waiter-1 open table ${table} → ${first.status}`, plain: `محمود فتح ترابيزة ${table}` });
    const w2 = await as('t_admin', 'demo-waiter-2', log);
    await expectRefusal(api(w2, 'TableVisit.Open', { params: { tableId: tableId(table) }, body: { guestCount: 3 } }), 'TABLE_OCCUPIED', log, 'waiter-2 opens the same table', 'يوسف حاول يفتح نفس الترابيزة من جهاز تاني');
    const replay = await call(w1, 'TableVisit.Open', { params: { tableId: tableId(table) }, body: { guestCount: 2 }, commandId: cmd });
    log({ ok: replay.replayed && replay.status === 201, text: `waiter-1 replay same X-Command-Id → ${replay.status} Idempotent-Replayed: ${replay.replayed}`, plain: replay.replayed ? 'محمود ضغط «فتح» تاني بنفس الطلب: رجعله نفس النتيجة من غير ما يتكرر' : 'الطلب المكرر ما رجعش نفس النتيجة' });
    const n = store.db.visits.filter((v) => v.state === 'OPEN' && v.tableId === tableId(table)).length;
    log({ ok: n === 1, text: `OPEN visits on table ${table}: ${n}`, plain: `على ترابيزة ${table} قعدة واحدة بس مفتوحة` });
    return n === 1 && replay.replayed;
  },
  N2: async (log) => {
    const { w, id } = await freshCheck(log, freeTable(['12', '10']));
    const cmd = newCommandId();
    const v = order(id).version;
    const a = await call(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: v }, commandId: cmd });
    const b = await call(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: v }, commandId: cmd });
    await sleep(150); runOutbox();
    const rounds = order(id).rounds.length;
    const tickets = store.db.tickets.filter((t) => t.orderId === id).length;
    log({ ok: b.replayed && a.data.fireRound === b.data.fireRound, text: `first fireRound ${a.data.fireRound}; resend → replayed ${b.replayed}, fireRound ${b.data.fireRound}`, plain: b.replayed ? 'الضغطة التانية على «ابعت للمطبخ» رجّعت نفس النتيجة الأولى' : 'الضغطة التانية عملت حاجة جديدة' });
    log({ ok: rounds === 1 && tickets === 1, text: `rounds ${rounds}, kitchen tickets ${tickets}`, plain: `المطبخ استلم ${tickets} طلب في ${rounds} دفعة` });
    return b.replayed && rounds === 1 && tickets === 1;
  },
  N3: async (log) => {
    const { w, id } = await freshCheck(log, freeTable(['10', '9']));
    const w2 = await as('t_admin', 'demo-waiter-2', log);
    const v = order(id).version;
    const res = await Promise.allSettled([call(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: v } }), call(w2, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: v } })]);
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const conflict = res.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    log({ ok: ok === 1 && conflict?.reason?.code === 'CONCURRENCY_CONFLICT', text: `${ok} × 200, other → ${conflict?.reason?.code} ${conflict?.reason?.status}`, plain: ok === 1 ? 'جهاز واحد بس نجح، والتاني اتقاله «حد تاني عدّل الشيك»' : `نجح ${ok} جهاز — كان المفروض واحد بس` });
    log({ ok: order(id).rounds.length === 1, text: `rounds ${order(id).rounds.length}`, plain: `الطلب راح المطبخ ${order(id).rounds.length === 1 ? 'مرة واحدة' : order(id).rounds.length + ' مرات'}` });
    return ok === 1 && order(id).rounds.length === 1;
  },
  N4: async (log) => {
    const { w, id } = await freshCheck(log, freeTable(['9', '8']));
    await api(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'fire');
    const line = order(id).lines[0];
    const auditBefore = store.db.audit.filter((a) => a.op === 'Order.VoidLine').length;
    const f = await expectRefusal(api(w, 'Order.VoidLine', { params: { orderId: id, lineId: line.id }, body: { expectedVersion: order(id).version, reasonCode: 'WRONG_ITEM' } }), 'APPROVAL_REQUIRED', log, 'void without approvalGrantId', 'محمود حاول يلغي صنف اتبعت من غير موافقة');
    const still = order(id).lines[0].status;
    const auditAfter = store.db.audit.filter((a) => a.op === 'Order.VoidLine').length;
    log({ ok: still === 'ACTIVE' && auditAfter === auditBefore, text: `line ${still}; void audit rows +${auditAfter - auditBefore}; dialog cancelled → nothing written`, plain: still === 'ACTIVE' ? 'لغينا شاشة الموافقة: الصنف فضل زي ما هو ومفيش حاجة اتسجلت' : 'الصنف اتلغى من غير موافقة!' });
    return !!f && still === 'ACTIVE';
  },
  N5: async (log) => {
    const { id } = await freshCheck(log, freeTable(['8', '6']));
    const m = await as('t_admin', 'demo-manager-1', log);
    await api(m, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'fire');
    const c = await cashierWithShift(log);
    await api(c, 'Order.Confirm', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'confirm');
    let details: any;
    try { await call(m, 'Order.Void', { params: { orderId: id }, body: { expectedVersion: order(id).version, reasonCode: 'CUSTOMER_LEFT', reason: 'test' } }); } catch (e) { details = (e as ApiFailure).details; log({ ok: true, text: `Order.Void → ${(e as ApiFailure).code}`, plain: 'إلغاء الشيك طلب موافقة مدير' }); }
    const grantsBefore = store.db.grants.length;
    await expectRefusal(api(m, 'Approval.Grant', { body: { action: 'ORDER_VOID', targetType: details.targetType, targetId: details.targetId, context: details.context, approverUserId: userIdOf('demo-manager-1'), approverCredentialKind: 'PIN', approverSecret: demo.pin } }), 'SELF_APPROVAL_DENIED', log, 'manager-1 approves their own void', 'أحمد حاول يوافق على طلبه هو');
    log({ ok: store.db.grants.length === grantsBefore && order(id).status === 'CONFIRMED', text: `grants issued: ${store.db.grants.length - grantsBefore}; order ${order(id).status}`, plain: store.db.grants.length === grantsBefore ? 'مفيش موافقة اتعملت، والشيك فضل زي ما هو' : 'اتعملت موافقة — غلط' });
    return store.db.grants.length === grantsBefore;
  },
  N6: async (log) => {
    const { c, id } = await confirmedCheck(log, freeTable(['6', '5']));
    const cmd = newCommandId();
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: id } });
    await expectRefusal(call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CARD', amount: st.remaining }] }, commandId: cmd }), 'TENDER_REFERENCE_REQUIRED', log, 'card without reference', 'دفع كارت من غير رقم العملية');
    const r = await call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CARD', amount: st.remaining, reference: 'DEMO-REF-0002' }] }, commandId: cmd });
    const n = store.db.captures.filter((x) => x.orderId === id).length;
    log({ ok: r.status === 201 && n === 1, text: `same command id with DEMO-REF-0002 → ${r.status}; captures ${n}`, plain: n === 1 ? 'بعد ما كتب رقم العملية الدفع اتسجل — دفعة واحدة بس' : `اتسجل ${n} دفعات — غلط` });
    return n === 1;
  },
  N7: async (log) => {
    const { c, id } = await confirmedCheck(log, freeTable(['5', '4']));
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: id } });
    const over = (Number(st.remaining) + 50).toFixed(2);
    await expectRefusal(api(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CARD', amount: over, reference: 'R-OVER' }] } }), 'OVERPAYMENT', log, `card ${over} > remaining ${st.remaining}`, 'دفع كارت بمبلغ أكبر من المتبقي');
    const res = await Promise.allSettled([call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CARD', amount: st.remaining, reference: 'R-A' }] } }), call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CARD', amount: st.remaining, reference: 'R-B' }] } })]);
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    const paid = store.db.captures.filter((x) => x.orderId === id).reduce((a, x) => a + Number(x.amount), 0);
    log({ ok: ok === 1, text: `parallel full captures: ${ok} succeeded, other → ${(res.find((r) => r.status === 'rejected') as any)?.reason?.code}`, plain: ok === 1 ? 'دفعتين بالمبلغ كله في نفس اللحظة: واحدة بس اتقبلت' : `اتقبل ${ok} دفعات — غلط` });
    log({ ok: paid <= Number(st.payable), text: `sum of captures ${paid.toFixed(2)} ≤ payable ${st.payable}`, plain: `المدفوع ${paid.toFixed(2)} جنيه — مش أكتر من المطلوب` });
    return ok === 1 && paid <= Number(st.payable);
  },
  N8: async (log) => {
    const w2 = await as('t_admin', 'demo-waiter-2', log);
    const table = freeTable(['4', '3']);
    if (!openVisit(table)) await api(w2, 'TableVisit.Open', { params: { tableId: tableId(table) }, body: { guestCount: 2 } }, log, `table ${table}`);
    const o = await api<any>(w2, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId(table) } }, log, 'check');
    await api(w2, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_hummus', quantity: '1' }] } }, log, 'line');
    const admin = await as('BO', 'demo-owner', log);
    const u = () => store.db.users.find((x) => x.username === 'demo-waiter-2')!;
    await api(admin, 'User.ManageAccess', { params: { userId: u().id }, body: { expectedVersion: u().version, active: false, roleAssignments: u().roleAssignments } }, log, 'deactivate demo-waiter-2');
    await expectRefusal(api(w2, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }), 'UNAUTHENTICATED', log, 'fire after deactivation', 'يوسف حاول يبعت للمطبخ بعد ما حسابه اتوقف');
    await api(admin, 'User.ManageAccess', { params: { userId: u().id }, body: { expectedVersion: u().version, active: true, roleAssignments: u().roleAssignments } }, log, 'reactivate');
    let noFire = store.db.roles.find((r) => r.name === 'Waiter without fire (N8)');
    if (!noFire) noFire = await api<any>(admin, 'Role.Create', { body: { name: 'Waiter without fire (N8)', permissionIds: store.db.roles.find((r) => r.id === 'role_waiter')!.permissionIds.filter((p) => p !== 'order:fire') } }, log, 'role without order:fire');
    const original = u().roleAssignments;
    await api(admin, 'User.ManageAccess', { params: { userId: u().id }, body: { expectedVersion: u().version, active: true, roleAssignments: [{ roleId: noFire!.id, branchIds: ['branch_main'] }] } }, log, 'role change');
    const w2b = await as('t_admin', 'demo-waiter-2', log);
    await expectRefusal(api(w2b, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }), 'PERMISSION_DENIED', log, 'fire without order:fire', 'يوسف حاول يبعت للمطبخ بعد ما الصلاحية اتشالت منه');
    await api(admin, 'User.ManageAccess', { params: { userId: u().id }, body: { expectedVersion: u().version, active: true, roleAssignments: original } }, log, 'restore role');
    const fired = order(o.id).rounds.length;
    log({ ok: fired === 0, text: `rounds fired: ${fired}`, plain: fired === 0 ? 'ولا طلب راح المطبخ' : 'طلب راح المطبخ — غلط' });
    return fired === 0;
  },
  N9: async (log) => {
    const w1 = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('7')) await api(w1, 'TableVisit.Open', { params: { tableId: tableId('7') }, body: { guestCount: 2 } }, log, 'main table 7');
    const v = openVisit('7')!;
    const before = { table: v.tableId, version: v.version };
    const ws = await as('t_second_floor', 'demo-waiter-second', log);
    await expectRefusal(api(ws, 'TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: 'tbl_second_7' } }), 'TABLE_VISIT_NOT_FOUND', log, 'second-branch waiter moves a main visit', 'ويتر الفرع التاني حاول ينقل زباين الفرع الرئيسي');
    await expectRefusal(api(w1, 'TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: 'tbl_second_7' } }), 'TABLE_NOT_FOUND', log, 'main waiter moves to the other branch table "7"', 'محمود حاول ينقل الزباين لترابيزة 7 بتاعة الفرع التاني');
    await expectRefusal(api(ws, 'Pricing.QuoteItem', { params: { productId: 'p_tea' }, body: { branchId: 'branch_second', channel: 'DINE_IN', quantity: '1', modifierOptionIds: ['opt_size_regular'] } }), 'PRICE_NOT_FOUND', log, 'second branch sells nothing (no price)', 'الفرع التاني حاول يبيع شاي (مالوش سعر هناك)');
    const after = openVisit('7')!;
    log({ ok: after.tableId === before.table && after.version === before.version, text: 'visit unchanged (table, version); nothing of the other branch revealed', plain: 'القعدة فضلت زي ما هي، ومفيش حاجة من الفرع التاني ظهرت' });
    return after.version === before.version;
  },
  N10: async (log) => {
    const { w, id } = await freshCheck(log, freeTable(['3', '2']));
    await api(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'round 1');
    await api(w, 'Order.AddLines', { params: { orderId: id }, body: { expectedVersion: order(id).version, lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }, log, 'more');
    await api(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'round 2');
    await sleep(150); runOutbox();
    const before = store.db.tickets.filter((t) => t.orderId === id).length;
    // redeliver round 1 with the same receipt, then deliver round 2 again "out of order"
    for (const d of store.db.kitchenDeliveries.filter((x) => x.orderId === id).reverse()) { d.state = 'PENDING'; d.nextAt = 0; }
    runOutbox();
    const after = store.db.tickets.filter((t) => t.orderId === id).length;
    log({ ok: before === after, text: `tickets before redelivery ${before}, after ${after} (dedupe by order+round+station)`, plain: before === after ? `بعتنا نفس الطلبات للمطبخ تاني وبترتيب غلط: فضلوا ${after} زي ما هم من غير تكرار` : 'الطلبات اتكررت في المطبخ — غلط' });
    return before === after;
  },
  N11: async (log) => {
    sim.set({ kds: 'DOWN' });
    log({ ok: null, text: 'worker stopped (kitchen delivery DOWN)', plain: 'وقّفنا توصيل الطلبات للمطبخ' });
    const ids: string[] = [];
    for (const table of ['2', '1'].filter((n) => !openVisit(n)).slice(0, 2)) { const { w, id } = await freshCheck(log, table); await api(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, `fire ${table}`); ids.push(id); }
    runOutbox();
    // restart: part of the batch already processed would be skipped; here every round is retried once
    sim.set({ kds: 'UP' });
    for (const d of store.db.kitchenDeliveries.filter((x) => ids.includes(x.orderId))) { d.state = 'PENDING'; d.nextAt = 0; }
    runOutbox(); runOutbox();
    const per = ids.map((id) => store.db.tickets.filter((t) => t.orderId === id).length);
    log({ ok: per.every((n) => n === 1), text: `ticket sets per round after restart: ${per.join(', ')}`, plain: per.every((n) => n === 1) ? 'بعد ما التوصيل رجع، كل طلب وصل المطبخ مرة واحدة بس' : 'في طلبات اتكررت — غلط' });
    return per.every((n) => n === 1);
  },
  N12: async (log) => {
    const { c, id } = await confirmedCheck(log, freeTable(['1', '12', '11']));
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: id } });
    sim.set({ dropNextResponse: 'Payment.Capture' });
    const cmd = newCommandId();
    try { await call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: st.remaining }] }, commandId: cmd }); } catch (e) { log({ ok: (e as ApiFailure).network, text: 'response lost → result unknown', plain: 'رد الدفع ضاع — النتيجة مش معروفة' }); }
    const r = await call(c, 'Payment.Capture', { params: { orderId: id }, body: { tenders: [{ method: 'CASH', tendered: st.remaining }] }, commandId: cmd });
    const n = store.db.captures.filter((x) => x.orderId === id).length;
    log({ ok: r.replayed && n === 1, text: `retry same X-Command-Id → ${r.status} Idempotent-Replayed ${r.replayed}; captures ${n}`, plain: r.replayed && n === 1 ? 'إعادة المحاولة رجّعت نفس النتيجة — والفلوس اتحسبت مرة واحدة' : `اتسجل ${n} دفعات — غلط` });
    return r.replayed && n === 1;
  },
};

export { devices };

/** Plain wording for each control: title, what we try, what should happen. */
export const NEGATIVE_PLAIN: Record<string, { title: string; titleEn: string; tryAr: string; tryEn: string; expectAr: string; expectEn: string }> = {
  N1: { title: 'ويترين بيفتحوا نفس الترابيزة', titleEn: 'Two waiters open the same table', tryAr: 'محمود يفتح ترابيزة، ويوسف يحاول يفتحها من جهاز تاني. وبعدين محمود يضغط «فتح» تاني (الرد اتأخر).', tryEn: 'Mahmoud opens a table and Youssef tries to open it from another device. Then Mahmoud taps "Open" again (slow reply).', expectAr: 'يوسف يترفض لأن الترابيزة مشغولة. ضغطة محمود التانية ترجع نفس النتيجة. قعدة واحدة بس على الترابيزة.', expectEn: 'Youssef is refused (table taken). Mahmoud\'s second tap returns the same result. Only one seating on the table.' },
  N2: { title: 'الضغط مرتين على «ابعت للمطبخ»', titleEn: 'Tapping "Send to kitchen" twice', tryAr: 'الويتر يضغط «ابعت للمطبخ» مرتين ورا بعض بنفس الطلب.', tryEn: 'The waiter taps "Send to kitchen" twice with the same request.', expectAr: 'الطلب يروح المطبخ مرة واحدة بس، والضغطة التانية ترجع نفس النتيجة.', expectEn: 'The order reaches the kitchen once; the second tap returns the same result.' },
  N3: { title: 'جهازين بيبعتوا نفس الشيك في نفس اللحظة', titleEn: 'Two devices send the same check at once', tryAr: 'محمود ويوسف يضغطوا «ابعت للمطبخ» على نفس الشيك في نفس اللحظة.', tryEn: 'Mahmoud and Youssef tap "Send to kitchen" on the same check at the same moment.', expectAr: 'واحد بس ينجح، والتاني يتقاله «حد تاني عدّل الشيك». المطبخ ياخد الطلب مرة واحدة.', expectEn: 'Only one succeeds; the other is told someone else changed the check. The kitchen gets it once.' },
  N4: { title: 'إلغاء صنف من غير موافقة', titleEn: 'Voiding an item without approval', tryAr: 'الويتر يلغي صنف اتبعت للمطبخ، ولما شاشة الموافقة تظهر يقفلها.', tryEn: 'The waiter voids an item already sent, then closes the approval screen.', expectAr: 'شاشة موافقة المدير تظهر. لو اتقفلت، الصنف يفضل زي ما هو ومفيش حاجة تتسجل.', expectEn: 'The manager approval screen appears. If closed, the item stays and nothing is recorded.' },
  N5: { title: 'المدير يوافق على طلبه هو', titleEn: 'A manager approves their own request', tryAr: 'أحمد يطلب إلغاء شيك، وبعدين يحاول يوافق عليه برقمه السري.', tryEn: 'Ahmed asks to void a check, then tries to approve it with his own PIN.', expectAr: 'الموافقة تترفض: لازم مدير تاني. الشيك يفضل زي ما هو.', expectEn: 'Refused: another manager must approve. The check stays as it is.' },
  N6: { title: 'دفع كارت من غير رقم العملية', titleEn: 'Card payment without a transaction number', tryAr: 'الكاشير يسجل دفع كارت من غير ما يكتب رقم العملية من المكنة، وبعدين يكتبه.', tryEn: 'The cashier records a card payment without the machine\'s transaction number, then adds it.', expectAr: 'الأول يترفض ويطلب رقم العملية. بعد ما يكتبه الدفع يتسجل مرة واحدة بس.', expectEn: 'First refused, asking for the number. Once typed, the payment is recorded exactly once.' },
  N7: { title: 'دفع زيادة، ودفعتين في نفس الوقت', titleEn: 'Overpaying, and two payments at once', tryAr: 'دفع كارت بمبلغ أكبر من المتبقي، وبعدين دفعتين بالمبلغ كله في نفس اللحظة.', tryEn: 'A card payment above what is left, then two full payments at the same moment.', expectAr: 'الدفع الزيادة يترفض. من الدفعتين واحدة بس تتقبل، والمدفوع عمره ما يعدّي المطلوب.', expectEn: 'The overpayment is refused. Only one of the two payments goes through; paid never exceeds due.' },
  N8: { title: 'الحساب يتوقف أو الصلاحية تتشال وهو شغال', titleEn: 'Account turned off or permission removed mid-work', tryAr: 'يوسف شغال على شيك، والمدير يوقّف حسابه. وبعدين يرجعه من غير صلاحية «ابعت للمطبخ».', tryEn: 'Youssef is working on a check when the manager turns his account off, then back on without the "send to kitchen" permission.', expectAr: 'بعد الإيقاف أي حركة تترفض ويرجع لشاشة الدخول. من غير الصلاحية «ابعت للمطبخ» يترفض. ولا طلب يروح المطبخ.', expectEn: 'After turning off, every action is refused and he returns to sign-in. Without the permission, sending is refused. Nothing reaches the kitchen.' },
  N9: { title: 'ترابيزة من فرع تاني', titleEn: 'A table from another branch', tryAr: 'ويتر الفرع التاني يحاول ينقل زباين الفرع الرئيسي، والويتر الرئيسي يحاول ينقلهم لترابيزة في الفرع التاني.', tryEn: 'The second-branch waiter tries to move main-branch guests; the main waiter tries to move them to a second-branch table.', expectAr: 'الاتنين يترفضوا ومفيش حاجة من الفرع التاني تبان. القعدة تفضل زي ما هي.', expectEn: 'Both are refused and nothing from the other branch is shown. The seating stays as it is.' },
  N10: { title: 'المطبخ يستلم نفس الطلب مرتين أو بترتيب غلط', titleEn: 'The kitchen receives the same order twice or out of order', tryAr: 'نبعت نفس الدفعات للمطبخ تاني وبترتيب معكوس.', tryEn: 'We deliver the same rounds to the kitchen again, in reverse order.', expectAr: 'المطبخ مايكررش ولا طلب.', expectEn: 'The kitchen duplicates nothing.' },
  N11: { title: 'توصيل المطبخ يقف ويرجع في النص', titleEn: 'Kitchen delivery stops and restarts midway', tryAr: 'نوقف توصيل الطلبات للمطبخ، نبعت طلبين، وبعدين التوصيل يرجع ويحاول تاني.', tryEn: 'We stop kitchen delivery, send two orders, then delivery restarts and retries.', expectAr: 'كل طلب يوصل المطبخ مرة واحدة بس.', expectEn: 'Each order reaches the kitchen exactly once.' },
  N12: { title: 'رد الدفع يضيع وبعدين إعادة المحاولة', titleEn: 'Payment reply lost, then retry', tryAr: 'الكاشير يدفع والرد يضيع، وبعدين يضغط «إعادة المحاولة».', tryEn: 'The cashier pays, the reply is lost, then they tap "Retry".', expectAr: 'إعادة المحاولة ترجع نفس النتيجة، والفلوس تتحسب مرة واحدة.', expectEn: 'Retry returns the same result and the money is counted once.' },
};
