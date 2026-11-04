// ux-12 journey J-B1 — reservations complete against the mock: a booking with a deposit linked to a customer, the
// table-conflict and past-time refusals, moving it (time, table, party size) with CAS, seating it through the one path
// and applying the deposit to the check in part, refunding the remainder; a second booking cancelled early and its
// deposit refunded out of the drawer with a manager's approval (REFUNDED); a third cancelled late (forfeited by
// ReservationPolicy); a fourth marked no-show; the refusals (over the remainder, no open shift, stale version, missing
// reason, table conflict, still booked), the audit lines, the customer's reservations, and the legacy free-text one.
import { api, as, expectRefusal, withApproval, order, openSession, tableId, type Logger } from './runner';
import { store } from '../mock/store';
import { clock } from '../mock/clock';
import { t } from '../i18n';
import { D } from '../mock/money';
import type { StepDef } from './scripts';

const S: { a?: string; b?: string; c?: string; d?: string; e?: string; f?: string; depA?: string; depC?: string; check?: string } = {};
const res = (id: string) => store.db.reservations.find((r) => r.id === id)!;
const dep = (id: string) => store.db.deposits.find((d) => d.id === id)!;
const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });
const Q = 15 * 60_000;
/** A time `min` minutes from now on a quarter hour (what the screen sends). */
const inMin = (min: number) => new Date(Math.ceil((clock.now() + min * 60_000) / Q) * Q).toISOString();
const cust = (i: number) => store.db.customers![i];
/** Free tables of the main branch (no open visit, no reservation near), picked once for the journey. */
const T: string[] = [];
function freeTables() {
  if (T.length) return T;
  const busy = new Set(store.db.visits.filter((v) => v.state === 'OPEN').flatMap((v) => [v.tableId, ...v.joinedTableIds]));
  const held = new Set(store.db.reservations.filter((r) => r.state === 'BOOKED' && r.tableId).map((r) => r.tableId));
  T.push(...store.db.tables.filter((x) => x.branchId === 'branch_main' && x.active && x.capacity >= 4 && !busy.has(x.id) && !held.has(x.id)).map((x) => x.name));
  return T;
}

async function cashier(log: Logger) {
  const c = await as('t_cash', 'demo-cashier-a', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
  return c;
}
/** A deposit taken at the till, then the reservation that holds it (the screen's two calls). */
async function booking(log: Logger, ci: number, min: number, party: number, table: string | null, deposit: string | null, label: string) {
  const c = await cashier(log);
  const cu = cust(ci);
  let depositId: string | undefined;
  if (deposit) depositId = (await api<any>(c, 'Deposit.Create', { body: { customer: cu.name, phone: cu.phone, customerId: cu.id, amount: deposit, method: 'CASH', purpose: 'BOOKING' } }, log, `${label}: deposit ${deposit}`)).id;
  const r = await api<any>(c, 'Reservation.Create', { body: { customerId: cu.id, partySize: party, at: inMin(min), tableId: table ? tableId(table) : undefined, noShowFee: '0', depositId } }, log, `${label}: reservation`);
  return { id: r.id as string, depositId };
}

const B1: StepDef[] = [
  { id: 'J-B1-1', device: 't_floor', user: 'demo-host', screen: 'reservations', run: async (log) => {
    const h = await as('t_floor', 'demo-host', log);
    const all = await api<any>(h, 'Reservation.Find', { query: {} }, log, 'the book');
    const legacy = all.items.find((r: any) => r.legacy);
    check(log, !!legacy && !!legacy.customerName && !!legacy.phone, `legacy free-text reservation readable: ${legacy?.customerName} ${legacy?.phone}`, t('الحجز القديم بالاسم المكتوب ما زال مقروءًا'));
    check(log, all.rules?.seatMinutes === 90 && all.rules?.bufferMinutes === 15 && all.rules?.cancelDepositMode === 'FORFEIT_IF_LATE' && all.rules?.lateCancelHours === 2, `ReservationPolicy ${JSON.stringify(all.rules)}`, t('قواعد الحجز الافتراضية: 90 دقيقة و15 فاصل، ومصادرة العربون عند الإلغاء المتأخر'));
    const w = await as('t_floor', 'demo-waiter-1', log);
    await expectRefusal(api(w, 'Reservation.Create', { body: { customerId: cust(0).id, partySize: 2, at: inMin(300) } }), 'PERMISSION_DENIED', log, 'a waiter takes a reservation', t('الويتر لا يسجل الحجوزات'));
  } },
  { id: 'J-B1-2', device: 't_cash', user: 'demo-cashier-a', screen: 'reservations', run: async (log) => {
    const [tA, tB] = freeTables();
    const a = await booking(log, 0, 180, 4, tA, '200.00', 'A');
    S.a = a.id; S.depA = a.depositId;
    check(log, res(S.a).customerId === cust(0).id && dep(S.depA!).reservationId === S.a && dep(S.depA!).customerId === cust(0).id, 'reservation ↔ deposit ↔ customer linked', t('الحجز والعربون مربوطان بالعميل'));
    const c = await cashier(log);
    await expectRefusal(api(c, 'Reservation.Create', { body: { customerId: cust(1).id, partySize: 2, at: inMin(225), tableId: tableId(tA) } }), 'RESERVATION_TABLE_CONFLICT', log, 'the same table 45 minutes later', t('ترابيزة محجوزة في وقت قريب تُرفض'));
    await expectRefusal(api(c, 'Reservation.Create', { body: { customerId: cust(1).id, partySize: 2, at: new Date(clock.now() - 3_600_000).toISOString() } }), 'RESERVATION_TIME_PAST', log, 'a time in the past', t('لا يُحجز في وقت مضى'));
    S.b = (await booking(log, 1, 360, 2, tB, null, 'B')).id;
  } },
  { id: 'J-B1-3', device: 't_floor', user: 'demo-host', screen: 'reservations', run: async (log) => {
    const h = await as('t_floor', 'demo-host', log);
    const to = inMin(240);
    await api(h, 'Reservation.Update', { params: { reservationId: S.a! }, body: { at: to, expectedVersion: res(S.a!).version } }, log, 'A: one hour later');
    const ev = res(S.a!).history!.at(-1)!;
    check(log, res(S.a!).at === to && ev.kind === 'UPDATED' && ev.changes?.[0].field === 'at' && !!ev.changes?.[0].from, `history: ${ev.changes?.map((x) => `${x.field} ${x.from} → ${x.to}`).join('; ')}`, t('التعديل مسجل بالقيمة القديمة والجديدة'));
    const v = res(S.a!).version!;
    await api(h, 'Reservation.Update', { params: { reservationId: S.a! }, body: { partySize: 5, expectedVersion: v } }, log, 'A: party 4 → 5');
    await expectRefusal(api(h, 'Reservation.Update', { params: { reservationId: S.a! }, body: { partySize: 6, expectedVersion: v } }), 'CONCURRENCY_CONFLICT', log, 'stale version', t('نسخة قديمة تُرفض'));
    await expectRefusal(api(h, 'Reservation.Update', { params: { reservationId: S.a! }, body: { tableId: tableId(freeTables()[1]), at: inMin(375), expectedVersion: res(S.a!).version } }), 'RESERVATION_TABLE_CONFLICT', log, 'move onto B (its table, 15 minutes apart)', t('النقل فوق حجز آخر يُرفض'));
    check(log, res(S.a!).partySize === 5 && res(S.a!).tableId === tableId(freeTables()[0]), `A: party ${res(S.a!).partySize}, table ${res(S.a!).tableId}`, t('الحجز كما هو بعد الرفض'));
    const au = store.db.audit.filter((x) => x.target === S.a && x.op === 'Reservation.Update');
    check(log, au.length === 2 && au.some((x) => /partySize 4 → 5/.test(x.summary)), `audit: ${au.map((x) => x.summary).join(' | ')}`, t('التعديلات في سجل المراجعة'));
  } },
  { id: 'J-B1-4', device: 't_floor', user: 'demo-host', screen: 'floor', run: async (log) => {
    // the table shows the reservation once it is near: move A to 30 minutes from now (legal), then seat it from the plan
    const h = await as('t_floor', 'demo-host', log);
    await api(h, 'Reservation.Update', { params: { reservationId: S.a! }, body: { at: inMin(30), expectedVersion: res(S.a!).version } }, log, 'A: in 30 minutes');
    const tl = await api<any>(h, 'Table.List', { query: {} }, log, 'floor plan');
    const t1 = tl.items.find((x: any) => x.id === tableId(freeTables()[0]));
    check(log, t1?.reservation?.id === S.a && D(t1.reservation.deposit).eq(200), `table marker: ${t1?.reservation?.customer} in ${t1?.reservation?.minutesTo} min, deposit ${t1?.reservation?.deposit}`, t('الترابيزة عليها علامة الحجز'));
    const out = await api<any>(h, 'Reservation.Seat', { params: { reservationId: S.a! }, body: { guestCount: 5, expectedVersion: res(S.a!).version } }, log, 'seat A from the floor plan');
    const visit = store.db.visits.find((x) => x.id === out.visit.id)!;
    check(log, res(S.a!).state === 'SEATED' && res(S.a!).visitId === visit.id && visit.reservationId === S.a && visit.guestCount === 5, 'A SEATED, visit open for 5 with the reservation', t('جلس الضيوف وفُتحت الترابيزة للحجز'));
    await expectRefusal(api(h, 'Reservation.Seat', { params: { reservationId: S.a! }, body: { expectedVersion: res(S.a!).version } }), 'RESERVATION_NOT_BOOKED', log, 'seat A again', t('الحجز لا يُجلس مرتين'));
    // the other door: TableVisit.Open with reservationId runs the same path (waiter)
    S.f = (await booking(log, 2, 20, 2, freeTables()[2], null, 'F')).id;
    const w = await as('t_floor', 'demo-waiter-1', log);
    const v2 = await api<any>(w, 'TableVisit.Open', { params: { tableId: tableId(freeTables()[2]) }, body: { guestCount: 2, reservationId: S.f } }, log, 'waiter opens F\'s table');
    check(log, res(S.f!).state === 'SEATED' && res(S.f!).visitId === v2.id && store.db.visits.find((x) => x.id === v2.id)!.reservationId === S.f && res(S.f!).history!.some((e) => e.kind === 'SEATED'), 'TableVisit.Open + reservationId = Reservation.Seat', t('فتح الترابيزة للحجز هو نفس مسار الإجلاس'));
  } },
  { id: 'J-B1-5', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const o = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId(freeTables()[0]) } }, log, 'check on the table');
    S.check = o.id;
    await api(w, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_hummus', quantity: '1', modifierOptionIds: [] }] } }, log, 'hummus');
    const c = await cashier(log);
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: o.id } }, log, 'settlement');
    const ds = await api<any>(c, 'Deposit.Find', { query: {} }, log, 'deposits');
    const mine = ds.items.find((d: any) => d.visitId === store.db.visits.find((v) => v.reservationId === S.a)!.id);
    check(log, mine?.id === S.depA, 'the check finds the reservation\'s deposit through its visit', t('الشيك يعرف عربون حجز ترابيزته'));
    const ap = await api<any>(c, 'Deposit.Apply', { params: { depositId: S.depA! }, body: { orderId: o.id } }, log, 'apply the deposit');
    check(log, D(ap.deposit.applied).eq(D(st.remaining)) && D(ap.deposit.remaining).eq(D('200').minus(D(st.remaining))) && dep(S.depA!).state === 'HELD' && ap.settlement.settled, `applied ${ap.deposit.applied}, remains ${ap.deposit.remaining} (check ${st.remaining})`, t('خُصم من العربون قدر الشيك وبقي الباقي'));
    if (order(o.id).status === 'CONFIRMED') await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
    const left = dep(S.depA!);
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depA! }, body: { amount: '200.00', reason: 'رد الباقي', expectedVersion: left.version } }), 'DEPOSIT_REFUND_OVER_REMAINING', log, 'refund the whole 200.00 after part was applied', t('لا يُرد أكثر من المتبقي'));
    const rf = await withApproval<any>(c, 'Deposit.Refund', { params: { depositId: S.depA! }, body: { reason: 'رد باقي العربون بعد الشيك', expectedVersion: left.version } }, 'demo-manager-1', log, 'refund the remainder');
    check(log, dep(S.depA!).state === 'REFUNDED' && D(rf.refund.amount).eq(D(ap.deposit.remaining)), `refund ${rf.refund.number} ${rf.refund.amount}; deposit ${dep(S.depA!).state}`, t('رُد باقي العربون فقط'));
  } },
  { id: 'J-B1-6', device: 't_cash', user: 'demo-cashier-a', screen: 'reservations', run: async (log) => {
    const cb = await booking(log, 3, 300, 2, null, '150.00', 'C');
    S.c = cb.id; S.depC = cb.depositId;
    const c = await cashier(log);
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: 'الضيف طلب', expectedVersion: dep(S.depC!).version } }), 'DEPOSIT_RESERVATION_ACTIVE', log, 'refund while still booked', t('لا يُرد العربون والحجز قائم'));
    await expectRefusal(api(c, 'Reservation.Cancel', { params: { reservationId: S.c }, body: { reason: '', expectedVersion: res(S.c).version } }), 'REASON_REQUIRED', log, 'cancel without a reason', t('الإلغاء يحتاج سببًا'));
    await expectRefusal(api(c, 'Reservation.Cancel', { params: { reservationId: S.c }, body: { reason: 'تغيرت خطة الضيف', expectedVersion: res(S.c).version! - 1 } }), 'CONCURRENCY_CONFLICT', log, 'cancel with a stale version', t('نسخة قديمة تُرفض'));
    const x = await api<any>(c, 'Reservation.Cancel', { params: { reservationId: S.c }, body: { reason: 'تغيرت خطة الضيف', expectedVersion: res(S.c).version } }, log, 'C cancelled 5 hours ahead');
    check(log, x.state === 'CANCELLED' && x.cancel.depositOutcome === 'REFUNDABLE' && dep(S.depC!).state === 'HELD', `outcome ${x.cancel.depositOutcome}; deposit ${dep(S.depC!).state}`, t('أُلغي مبكرًا: العربون باقٍ للرد بموافقة'));
    const m = await as('t_admin', 'demo-manager-1', log);
    await expectRefusal(api(m, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: 'رد العربون', expectedVersion: dep(S.depC!).version } }), 'SESSION_NOT_OPEN', log, 'refund on a terminal without an open shift', t('الرد يحتاج درجًا في وردية مفتوحة'));
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: 'رد العربون', expectedVersion: dep(S.depC!).version! - 1 } }), 'CONCURRENCY_CONFLICT', log, 'refund with a stale version', t('نسخة قديمة تُرفض'));
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { amount: '150.01', reason: 'رد العربون', expectedVersion: dep(S.depC!).version } }), 'DEPOSIT_REFUND_OVER_REMAINING', log, 'refund 150.01 of 150.00', t('لا يُرد أكثر من المتبقي'));
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: '  ', expectedVersion: dep(S.depC!).version } }), 'REASON_REQUIRED', log, 'refund without a reason', t('الرد يحتاج سببًا'));
    const before = store.db.cashEntries.length;
    const rf = await withApproval<any>(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: 'إلغاء مبكر — رد العربون', expectedVersion: dep(S.depC!).version } }, 'demo-manager-1', log, 'refund C');
    const ce = store.db.cashEntries.slice(before).find((e) => e.kind === 'PAY_OUT' && e.reasonCode === 'DEPOSIT_REFUND');
    check(log, dep(S.depC!).state === 'REFUNDED' && rf.refund.amount === '150.0000' && !!ce && ce.sessionId === openSession('t_cash')?.id && !!rf.refund.approvalGrantId, `deposit ${dep(S.depC!).state}; PAY_OUT ${ce?.amount} in ${ce?.sessionId}; grant ${rf.refund.approvalGrantId}`, t('رُد العربون من الدرج بموافقة المدير'));
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: S.depC! }, body: { reason: 'مرة ثانية', expectedVersion: dep(S.depC!).version } }), 'DEPOSIT_NOT_REFUNDABLE', log, 'refund it again', t('لا يُرد العربون مرتين'));
    check(log, res(S.c).history!.map((e) => e.kind).join(',') === 'CREATED,CANCELLED,DEPOSIT_REFUNDED', `history ${res(S.c).history!.map((e) => e.kind).join(',')}`, t('السجل: إنشاء ثم إلغاء ثم رد العربون'));
  } },
  { id: 'J-B1-7', device: 't_cash', user: 'demo-cashier-a', screen: 'reservations', run: async (log) => {
    const db = await booking(log, 4, 75, 2, null, '100.00', 'D');
    S.d = db.id;
    const c = await cashier(log);
    const x = await api<any>(c, 'Reservation.Cancel', { params: { reservationId: S.d }, body: { reason: 'الضيف اعتذر', expectedVersion: res(S.d).version } }, log, 'D cancelled 75 minutes ahead');
    const d = dep(db.depositId!);
    check(log, x.cancel.late && x.cancel.depositOutcome === 'FORFEITED' && d.state === 'FORFEITED' && d.forfeit?.cause === 'LATE_CANCEL' && d.forfeit.amount === '100.0000', `late ${x.cancel.late}; deposit ${d.state} (${d.forfeit?.cause})`, t('إلغاء متأخر: صودر العربون حسب السياسة'));
    await expectRefusal(api(c, 'Deposit.Refund', { params: { depositId: d.id }, body: { reason: 'رد العربون', expectedVersion: d.version } }), 'DEPOSIT_NOT_REFUNDABLE', log, 'refund a forfeited deposit', t('العربون المصادر لا يُرد'));
    const eb = await booking(log, 5, 15, 2, null, '100.00', 'E');
    S.e = eb.id;
    const h = await as('t_floor', 'demo-host', log);
    await api(h, 'Reservation.MarkNoShow', { params: { reservationId: S.e }, body: {} }, log, 'E no-show');
    check(log, res(S.e).state === 'NO_SHOW' && dep(eb.depositId!).state === 'FORFEITED' && dep(eb.depositId!).forfeit?.cause === 'NO_SHOW', `E ${res(S.e).state}; deposit ${dep(eb.depositId!).state}`, t('عدم الحضور: صودر العربون'));
  } },
  { id: 'J-B1-8', device: 't_admin', user: 'demo-owner', screen: 'customer', run: async (log) => {
    const o = await as('t_admin', 'demo-owner', log);
    const mine = await api<any>(o, 'Reservation.Find', { query: { customerId: cust(0).id } }, log, 'the customer\'s reservations');
    check(log, mine.items.some((r: any) => r.id === S.a && r.state === 'SEATED' && r.deposit?.state === 'REFUNDED'), `${cust(0).name}: ${mine.items.map((r: any) => `${r.state}/${r.deposit?.state ?? '-'}`).join(', ')}`, t('حجوزات العميل في ملفه'));
    const ops = ['Reservation.Create', 'Reservation.Update', 'Reservation.Cancel', 'Reservation.Seat', 'Reservation.MarkNoShow', 'Deposit.Refund'];
    const seen = ops.filter((op) => store.db.audit.some((x) => x.op === op));
    check(log, seen.length === ops.length && store.db.audit.some((x) => x.op === 'Deposit.Refund' && !!x.approvalGrantId && !!x.approverUserId), `audit ops: ${seen.join(', ')}`, t('كل حركات الحجز والعربون في سجل المراجعة'));
  } },
];

export const RESERVATIONS_JOURNEY = {
  id: 'J-B1', title: 'الحجوزات من التسجيل إلى الإجلاس أو الإلغاء', titleEn: 'Reservations from booking to seating or cancellation', reset: null,
  intro: 'حجز بعربون مربوط بعميل، نقل الموعد والترابيزة وتعديل العدد، الإجلاس من خريطة الصالة وخصم العربون من الشيك، إلغاء مبكر ورد العربون من الدرج بموافقة، إلغاء متأخر يصادر العربون، وعدم حضور.',
  steps: B1,
};
