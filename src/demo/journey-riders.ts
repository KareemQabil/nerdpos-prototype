// ux-11 journey J-D1 — the riders system against the mock: the rider's shift on his phone, trips (one fails and comes
// back RETURNED, then goes again), assignment over the cash limit (BLOCK refused, APPROVAL with a grant), the cash
// settlement with a shortage, settling the shortage (collect / deduct with approvals, over-settle and stale refusals),
// the payout per trip (permission and approval), the shift end with minutes, deactivation / reactivation, and the
// rider's isolation (another rider's delivery does not exist for him).
import { api, as, expectRefusal, withApproval, order, openSession, type Logger } from './runner';
import { store } from '../mock/store';
import { t } from '../i18n';
import type { StepDef } from './scripts';
import { add, sub } from '../mock/money';

const S: { trips: string[]; other?: string } = { trips: [] };
const rider = () => store.db.drivers!.find((d) => d.id === 'drv_5')!;
const dlv = (id: string) => store.db.deliveries!.find((d) => d.id === id)!;
const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });

async function cashier(log: Logger) {
  const c = await as('t_cash', 'demo-cashier-a', log);
  if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
  return c;
}
/** A confirmed delivery order (cash on delivery) whose kitchen tickets are ready. */
async function readyDelivery(log: Logger, customerIndex: number) {
  const c = await cashier(log);
  const cu = store.db.customers!.filter((x) => x.addresses[0]?.zoneId)[customerIndex];
  const o = await api<any>(c, 'Order.Create', { body: { channel: 'DELIVERY', customerId: cu.id } }, log, 'delivery order');
  await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_kofta', quantity: '2', modifierOptionIds: ['opt_medium'] }] } }, log, 'kofta ×2');
  const a = cu.addresses[0];
  const d = await api<any>(c, 'Delivery.Create', { body: { orderId: o.id, customerId: cu.id, address: a, zoneId: a.zoneId, paymentMode: 'CASH_ON_DELIVERY' } }, log, 'delivery');
  await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
  const chef = await as('t_kds', 'demo-chef-1', log);
  for (const tk of store.db.tickets.filter((x) => x.orderId === o.id)) {
    if (tk.state === 'NEW') await api(chef, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } }, log, 'start');
    await api(chef, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: store.db.tickets.find((x) => x.id === tk.id)!.version, toState: 'READY' } }, log, 'ready');
  }
  return d.id as string;
}
async function riderTrip(log: Logger, id: string, end: 'deliver' | 'fail') {
  const r = await as('t_rider', 'demo-driver', log);
  await api(r, 'Delivery.Dispatch', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, toState: 'PICKED_UP' } }, log, '«استلمت»');
  if (end === 'fail') await api(r, 'Delivery.FailAttempt', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, reasonCode: 'NO_ANSWER' } }, log, '«فشل التسليم»');
  else await api(r, 'Delivery.Complete', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, collectedMethod: 'CASH' } }, log, '«سلّمت»');
}
async function deliveryPolicy(log: Logger, patch: Record<string, unknown>) {
  const o = await as('t_admin', 'demo-owner', log);
  const cur = store.db.policyValues.find((v) => v.policyId === 'DeliveryPolicy' && v.scopeType === 'TENANT');
  await withApproval(o, 'Settings.UpdatePolicy', { params: { policyId: 'DeliveryPolicy' }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...((cur?.value as object) ?? {}), ...patch }, changeNote: 'J-D1' } }, 'demo-manager-1', log, 'DeliveryPolicy');
}

const D1: StepDef[] = [
  { id: 'J-D1-1', device: 't_rider', user: 'demo-driver', screen: 'rider', run: async (log) => {
    const r = await as('t_rider', 'demo-driver', log);
    const me = await api<any>(r, 'Driver.List', { query: {} }, log, 'his rider record');
    check(log, me.items.length === 1 && me.items[0].id === 'drv_5', `Driver.List as the rider: ${me.items.map((d: any) => d.id).join(',')}`, t('الطيار يرى سجله فقط'));
    if (!rider().onShift) await api(r, 'DriverShift.Start', { params: { driverId: 'drv_5' }, body: { expectedVersion: rider().version } }, log, 'shift start');
    check(log, rider().onShift && !!store.db.driverShifts!.find((s) => s.driverId === 'drv_5' && !s.endedAt), 'shift record open', t('بدأت وردية الطيار وسُجلت'));
  } },
  { id: 'J-D1-2', device: 't_cash', user: 'demo-cashier-a', screen: 'delivery-board', run: async (log) => {
    S.trips = [await readyDelivery(log, 0), await readyDelivery(log, 1)];
    const c = await cashier(log);
    const sug = await api<any>(c, 'Delivery.SuggestRider', { params: { deliveryId: S.trips[0] } }, log, 'suggestion');
    const r0 = sug.ranked[0];
    check(log, sug.suggested === r0?.driverId && sug.ranked.every((x: any, i: number) => i === 0 || Number(x.overLimit) > Number(sug.ranked[i - 1].overLimit) || x.load >= sug.ranked[i - 1].load || Number(x.sameZone) < Number(sug.ranked[i - 1].sameZone) || (x.availableSince ?? '') >= (sug.ranked[i - 1].availableSince ?? '')), `suggested ${sug.suggested}; ranked ${sug.ranked.map((x: any) => `${x.driverId}:${x.load}`).join(' ')}`, t('الاقتراح هو الأول في الترتيب'));
    await api(c, 'Delivery.Assign', { params: { deliveryId: S.trips[0] }, body: { expectedVersion: dlv(S.trips[0]).version, driverId: 'drv_5' } }, log, 'trip 1 → سعيد');
    const r = await as('t_rider', 'demo-driver', log);
    const board = await api<any>(r, 'Delivery.Board', { query: { scope: 'active' } }, log, 'his board');
    check(log, board.items.length > 0 && board.items.every((d: any) => d.driverId === 'drv_5'), `rider board: ${board.items.map((d: any) => d.number).join(',')}`, t('لوحة الطيار فيها طلباته فقط'));
    S.other = store.db.deliveries!.find((d) => d.driverId && d.driverId !== 'drv_5')?.id ?? store.db.deliveries!.find((d) => d.driverId !== 'drv_5')!.id;
    await expectRefusal(api(r, 'Delivery.Get', { params: { deliveryId: S.other } }), 'DELIVERY_NOT_FOUND', log, 'another rider\'s delivery', t('توصيل طيار آخر غير موجود بالنسبة له'));
    await expectRefusal(api(r, 'Driver.Get', { params: { driverId: 'drv_1' } }), 'DRIVER_NOT_FOUND', log, 'another rider\'s file', t('ملف طيار آخر غير موجود بالنسبة له'));
    await riderTrip(log, S.trips[0], 'deliver');
    check(log, dlv(S.trips[0]).state === 'DELIVERED' && !!dlv(S.trips[0]).cod && !dlv(S.trips[0]).cod!.settled, 'trip 1 delivered, cash with the rider', t('المشوار الأول سُلّم والنقد مع الطيار'));
  } },
  { id: 'J-D1-3', device: 't_cash', user: 'demo-cashier-a', screen: 'delivery-board', run: async (log) => {
    const c = await cashier(log);
    const id = S.trips[1];
    await api(c, 'Delivery.Assign', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, driverId: 'drv_5' } }, log, 'trip 2 → سعيد');
    await riderTrip(log, id, 'fail');
    await expectRefusal(api(c, 'Delivery.Return', { params: { deliveryId: S.trips[0] }, body: { expectedVersion: dlv(S.trips[0]).version } }), 'DELIVERY_TRANSITION_INVALID', log, 'return a delivered order', t('لا يُستلم مرتجع لطلب سُلّم'));
    await api(c, 'Delivery.Return', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, note: 'رجع مع الطيار' } }, log, 'received back');
    check(log, dlv(id).state === 'RETURNED', `state ${dlv(id).state}`, t('الطلب مرتجع للمطعم'));
    await api(c, 'Delivery.Assign', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, driverId: 'drv_5' } }, log, 'dispatched again');
    await riderTrip(log, id, 'deliver');
    check(log, dlv(id).state === 'DELIVERED' && dlv(id).attempts.length === 1, 'trip 2 delivered on the second attempt', t('المشوار الثاني سُلّم في المحاولة الثانية'));
  } },
  { id: 'J-D1-4', device: 't_cash', user: 'demo-cashier-a', screen: 'delivery-board', run: async (log) => {
    const id = await readyDelivery(log, 2);
    S.trips.push(id);
    await deliveryPolicy(log, { driverCashLimit: '100.00', cashLimitMode: 'BLOCK' });
    const c = await cashier(log);
    await expectRefusal(api(c, 'Delivery.Assign', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, driverId: 'drv_5' } }), 'DRIVER_CASH_LIMIT_EXCEEDED', log, 'over the limit (BLOCK)', t('التعيين فوق حد النقد ممنوع'));
    await deliveryPolicy(log, { cashLimitMode: 'APPROVAL' });
    await withApproval(c, 'Delivery.Assign', { params: { deliveryId: id }, body: { expectedVersion: dlv(id).version, driverId: 'drv_5' } }, 'demo-manager-1', log, 'over the limit (APPROVAL)');
    check(log, dlv(id).driverId === 'drv_5' && dlv(id).timeline.some((h) => h.kind === 'CASH_LIMIT'), 'assigned with DRIVER_CASH_LIMIT_OVERRIDE', t('عُيّن الطيار فوق الحد بموافقة المدير'));
    await deliveryPolicy(log, { driverCashLimit: '2000.00', cashLimitMode: 'APPROVAL' });
    await riderTrip(log, id, 'deliver');
    const r = await as('t_rider', 'demo-driver', log);
    await expectRefusal(api(r, 'DriverShift.End', { params: { driverId: 'drv_5' }, body: { expectedVersion: rider().version } }), 'DRIVER_CASH_NOT_SETTLED', log, 'end the shift holding cash', t('لا تنتهي الوردية والنقد مع الطيار'));
  } },
  { id: 'J-D1-5', device: 't_cash', user: 'demo-cashier-a', screen: () => ['drivers', { open: 'drv_5', tab: 'account' }], run: async (log) => {
    const c = await cashier(log);
    const f = await api<any>(c, 'Driver.Get', { params: { driverId: 'drv_5' } }, log, 'rider file');
    const owed0 = rider().owed;
    const counted = sub(f.cashInHand, '60');
    await withApproval(c, 'Driver.SettleCash', { params: { driverId: 'drv_5' }, body: { countedCash: counted } }, 'demo-manager-1', log, 'shortage 60.00');
    check(log, rider().owed === add(owed0, '60'), `owed ${owed0} → ${rider().owed}`, t('زاد العجز على الطيار 60.00'));
    await expectRefusal(api(c, 'Driver.SettleOwed', { params: { driverId: 'drv_5' }, body: { mode: 'WAIVE', amount: '1000.00', reason: 'تجربة', expectedVersion: rider().version } }), 'DRIVER_OWED_OVER_SETTLE', log, 'over-settle', t('لا تُسوّى أكثر من العجز'));
    await expectRefusal(api(c, 'Driver.SettleOwed', { params: { driverId: 'drv_5' }, body: { mode: 'COLLECT_CASH', amount: '5.00', expectedVersion: rider().version - 1 } }), 'CONCURRENCY_CONFLICT', log, 'stale version', t('نسخة قديمة تُرفض'));
    await expectRefusal(api(c, 'Driver.SettleOwed', { params: { driverId: 'drv_5' }, body: { mode: 'DEDUCT_PAYOUT', amount: '60.00', reason: 'خصم', expectedVersion: rider().version } }), 'DRIVER_PAYOUT_INSUFFICIENT', log, 'deduct more than the unpaid pay (45.00)', t('لا يُخصم أكثر من المستحقات'));
    await withApproval(c, 'Driver.SettleOwed', { params: { driverId: 'drv_5' }, body: { mode: 'COLLECT_CASH', amount: '20.00', expectedVersion: rider().version } }, 'demo-manager-1', log, 'collect 20.00');
    await withApproval(c, 'Driver.SettleOwed', { params: { driverId: 'drv_5' }, body: { mode: 'DEDUCT_PAYOUT', amount: '40.00', reason: 'يُخصم من مستحقات المشاوير', expectedVersion: rider().version } }, 'demo-manager-1', log, 'deduct 40.00');
    check(log, rider().owed === owed0, `owed back to ${rider().owed}`, t('عاد العجز إلى ما كان عليه'));
    const sid = openSession('t_cash')!.id;
    check(log, store.db.cashEntries.some((e) => e.sessionId === sid && e.reasonCode === 'DRIVER_OWED_COLLECT' && e.kind === 'PAY_IN' && e.amount === '20.0000'), 'drawer PAY_IN 20.00', t('دخل التحصيل الدرج'));
  } },
  { id: 'J-D1-6', device: 't_cash', user: 'demo-cashier-a', screen: () => ['drivers', { open: 'drv_5', tab: 'account' }], run: async (log) => {
    const disp = await as('t_cash', 'demo-dispatcher', log);
    const f = await api<any>(disp, 'Driver.Get', { params: { driverId: 'drv_5' } }, log, 'rider file (dispatcher)');
    await expectRefusal(api(disp, 'Driver.Payout', { params: { driverId: 'drv_5' }, body: { periodTo: f.account.preview.periodTo, expectedVersion: rider().version } }), 'PERMISSION_DENIED', log, 'payout without delivery:payout', t('الموزع لا يصرف المستحقات'));
    const c = await cashier(log);
    const po = await withApproval<any>(c, 'Driver.Payout', { params: { driverId: 'drv_5' }, body: { periodTo: f.account.preview.periodTo, expectedVersion: rider().version } }, 'demo-manager-1', log, 'payout');
    check(log, po.payout.tripIds.length === 3 && po.payout.gross === '45.0000' && po.payout.deductions === '40.0000' && po.payout.net === '5.0000', `payout ${po.payout.number}: gross ${po.payout.gross} − ${po.payout.deductions} = ${po.payout.net}`, t('صُرف 3 × 15.00 − 40.00 = 5.00'));
    await expectRefusal(api(c, 'Driver.Payout', { params: { driverId: 'drv_5' }, body: { periodTo: po.payout.periodTo, expectedVersion: rider().version } }), 'VALIDATION_FAILED', log, 'the same period again', t('لا تُصرف الفترة نفسها مرتين'));
  } },
  { id: 'J-D1-7', device: 't_admin', user: 'demo-owner', screen: 'drivers', run: async (log) => {
    const r = await as('t_rider', 'demo-driver', log);
    const end = await api<any>(r, 'DriverShift.End', { params: { driverId: 'drv_5' }, body: { expectedVersion: rider().version } }, log, 'shift end');
    check(log, !rider().onShift && end.shift.minutes !== null, `shift minutes ${end.shift.minutes}`, t('انتهت الوردية وسُجلت مدتها'));
    const o = await as('t_admin', 'demo-owner', log);
    const d4 = () => store.db.drivers!.find((d) => d.id === 'drv_4')!;
    await expectRefusal(api(o, 'Driver.Upsert', { params: { driverId: 'drv_4' }, body: { expectedVersion: d4().version, active: false } }), 'REASON_REQUIRED', log, 'deactivate without a reason', t('الإيقاف يحتاج سببًا'));
    await api(o, 'Driver.Upsert', { params: { driverId: 'drv_4' }, body: { expectedVersion: d4().version, active: false, reason: 'إجازة طويلة' } }, log, 'deactivate');
    const inactive = await api<any>(o, 'Driver.List', { query: { status: 'INACTIVE' } }, log, 'deactivated riders');
    check(log, inactive.items.some((d: any) => d.id === 'drv_4'), 'listed under «المتوقفون»', t('الطيار الموقوف ظاهر في «المتوقفون»'));
    await api(o, 'Driver.Upsert', { params: { driverId: 'drv_4' }, body: { expectedVersion: d4().version, active: true } }, log, 'reactivate');
    check(log, d4().active, 'active again', t('أُعيد تفعيل الطيار'));
  } },
];

export const RIDERS_JOURNEY = {
  id: 'J-D1', title: 'الطيارون من بداية الوردية إلى نهايتها', titleEn: 'Riders from shift start to shift end', reset: 'DEMO' as const,
  intro: 'سعيد يبدأ ورديته من موبايله، ثلاثة مشاوير منها واحد يفشل ويرجع ثم يخرج ثانية، تعيين فوق حد النقد، عجز في التسليم وتسويته بالتحصيل والخصم، صرف المستحقات لكل مشوار، وإنهاء الوردية.',
  steps: D1,
};
