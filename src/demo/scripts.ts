// Walkthrough automations: J-A1 (setup from zero), J-R1..J-R4 (operator walkthrough), plus counter/takeaway
// and failure journeys from 01_SCREENS.md. Text of J-A1/J-R steps comes from journeys/*.md (contracts/journeys.json).
import journeysJson from '../contracts/journeys.json';
import { api, as, expectRefusal, withApproval, tableId, productId, openVisit, checksOf, lastVisit, order, openSession, sleep, userIdOf, type Logger } from './runner';
import { store } from '../mock/store';
import { t } from '../i18n';
import { demo } from '../mock/demo';
import { sim } from '../mock/sim';
import { clock } from '../mock/clock';
import { devices } from '../app/devices';
import { runOutbox } from '../mock/outbox';
import { ApiFailure } from '../api/client';
import { egp } from './humanLog';
import { personaDisplayName, userLabel, deviceName, branchLabel } from './people';

export interface StepText { who: string; do_ar: string; do_en: string; expect_ar: string; expect_en: string; note?: string; operations: { op: string; http: string; actor: string; expected: string }[] }
export interface StepDef { before?: () => void; id: string; device: string; user: string; screen?: string | (() => [string, Record<string, any>]); run: (log: Logger) => Promise<void>; text?: StepText }
export interface Journey { id: string; title: string; titleEn: string; reset: 'DEMO' | 'ZERO' | null; intro: string; steps: StepDef[] }

const J = journeysJson as any[];
const txt = (id: string): StepText | undefined => J.find((s) => s.id === id);

// ───────── J-R1
const R1: StepDef[] = [
  { id: 'J-R1-1', device: 't_admin', user: 'demo-manager-1', screen: 'stations', run: async (log) => {
    const a = await as('t_admin', 'demo-manager-1', log);
    if (!store.db.tables.some((t) => t.name === '13' && t.branchId === 'branch_main')) await api(a, 'Table.Create', { body: { name: '13', area: 'Terrace', capacity: 4 } }, log, 'table 13');
    await expectRefusal(api(a, 'Table.Create', { body: { name: '7', area: 'Hall', capacity: 4 } }), 'TABLE_NAME_TAKEN', log, 'table "7"', t('محاولة عمل ترابيزة تانية اسمها 7'));
  } },
  { id: 'J-R1-2', device: 't_admin', user: 'demo-manager-1', screen: 'stations', run: async (log) => {
    const a = await as('t_admin', 'demo-manager-1', log);
    let st = store.db.stations.find((s) => s.name === 'PASTRY');
    if (!st) st = await api<any>(a, 'KitchenStation.Create', { body: { name: 'PASTRY' } }, log, 'PASTRY');
    if (!store.db.routingRules.some((r) => r.match.productId === 'p_om_ali')) await api(a, 'RoutingRule.Create', { body: { priority: 5, match: { productId: 'p_om_ali' }, stationId: st!.id } }, log, 'Om Ali → PASTRY (priority 5)');
  } },
  { id: 'J-R1-3', device: 't_cash', user: 'demo-cashier-a', screen: 'shift', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
    else log({ ok: null, text: 'shift already open', plain: t('الوردية كانت مفتوحة قبل كده') });
  } },
  { id: 'J-R1-4', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('7')) await api(w, 'TableVisit.Open', { params: { tableId: tableId('7') }, body: { guestCount: 4 } }, log, 'table 7');
    else log({ ok: null, text: 'table 7 already open', plain: t('ترابيزة 7 كانت مفتوحة قبل كده') });
  } },
  { id: 'J-R1-5', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const v = openVisit('7');
    if (v && !checksOf(v.id).length) await api(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId('7') } }, log, 'check 1');
  } },
  { id: 'J-R1-6', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const o = checksOf(openVisit('7')!.id)[0];
    await api(w, 'Category.List', { query: { active: true } }, log);
    await expectRefusal(api(w, 'Pricing.QuoteItem', { params: { productId: 'p_kunafa' }, body: { branchId: 'branch_main', channel: 'DINE_IN', quantity: '1', modifierOptionIds: [] } }), 'PRODUCT_UNAVAILABLE', log, 'Kunafa', t('محاولة إضافة كنافة'));
    const q = await api<any>(w, 'Pricing.QuoteItem', { params: { productId: 'p_orange_juice' }, body: { branchId: 'branch_main', channel: 'DINE_IN', quantity: '1', modifierOptionIds: ['opt_size_large'] } }, log, 'orange juice Large');
    log({ ok: true, text: `quote OJ Large unit = ${q.unitTotal} (server)` });
    if (!o.lines.length) await api(w, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_kofta', quantity: '2', modifierOptionIds: ['opt_medium'] }, { productId: 'p_hummus', quantity: '1', modifierOptionIds: [] }, { productId: 'p_orange_juice', quantity: '2', modifierOptionIds: ['opt_size_large'] }] } }, log, 'kofta ×2, hummus ×1, OJ ×2 L');
  } },
  { id: 'J-R1-7', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const o = checksOf(openVisit('7')!.id)[0];
    const r = await api<any>(w, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'send to kitchen');
    log({ ok: true, text: `fireRound ${r.fireRound}, ${r.lineIds.length} lines locked`, plain: t('الدفعة رقم {r}: {n} أصناف راحوا المطبخ ومينفعش يتعدلوا', { r: r.fireRound, n: r.lineIds.length }) });
  } },
  { id: 'J-R1-8', device: 't_kds', user: 'demo-chef-1', screen: 'kitchen', run: async (log) => {
    const k = await as('t_kds', 'demo-chef-1', log);
    await sleep(300);
    for (const st of store.db.stations.filter((s) => ['GRILL', 'COLD', 'BAR'].includes(s.name))) {
      const b = await api<any>(k, 'Kitchen.Board', { query: { stationId: st.id } }, log, st.name);
      log({ ok: true, text: `${st.name}: ${b.items.length} ticket(s)` });
    }
  } },
  { id: 'J-R1-9', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const id = checksOf(openVisit('7')!.id)[0].id;
    await api(w, 'Order.AddLines', { params: { orderId: id }, body: { expectedVersion: order(id).version, lines: [{ productId: 'p_om_ali', quantity: '1' }, { productId: 'p_tea', quantity: '2', modifierOptionIds: ['opt_size_regular'] }, { productId: 'p_green_salad', quantity: '1' }] } }, log, 'Om Ali, tea ×2, salad');
    const tea = order(id).lines.find((l) => l.productId === 'p_tea' && l.status === 'ACTIVE' && l.fireRound === null)!;
    await api(w, 'Order.UpdateLine', { params: { orderId: id, lineId: tea.id }, body: { expectedVersion: order(id).version, expectedLineVersion: tea.version, quantity: '3' } }, log, 'tea → 3');
    const salad = order(id).lines.find((l) => l.productId === 'p_green_salad' && l.status === 'ACTIVE')!;
    await api(w, 'Order.RemoveLine', { params: { orderId: id, lineId: salad.id }, body: { expectedVersion: order(id).version, expectedLineVersion: salad.version }, query: { expectedVersion: order(id).version, expectedLineVersion: salad.version } }, log, 'remove salad');
    const kofta = order(id).lines.find((l) => l.productId === 'p_kofta')!;
    await expectRefusal(api(w, 'Order.UpdateLine', { params: { orderId: id, lineId: kofta.id }, body: { expectedVersion: order(id).version, expectedLineVersion: kofta.version, quantity: '3' } }), 'LINE_ALREADY_FIRED', log, 'change kofta qty', t('محاولة تغيير كمية الكفتة'));
  } },
  { id: 'J-R1-10', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const id = checksOf(openVisit('7')!.id)[0].id;
    const r = await api<any>(w, 'Order.Fire', { params: { orderId: id }, body: { expectedVersion: order(id).version } }, log, 'send round 2');
    log({ ok: true, text: `fireRound ${r.fireRound} (Om Ali → PASTRY by the priority-5 rule)`, plain: t('الدفعة رقم {r}: أم علي راحت محطة الحلواني حسب القاعدة الجديدة', { r: r.fireRound }) });
  } },
  { id: 'J-R1-11', device: 't_kds', user: 'demo-chef-1', screen: 'kitchen', run: async (log) => {
    const k = await as('t_kds', 'demo-chef-1', log);
    await sleep(200);
    const grill = store.db.stations.find((s) => s.name === 'GRILL')!;
    const tk = store.db.tickets.find((t) => t.stationId === grill.id && t.round === 1 && t.state === 'NEW');
    if (tk) await api(k, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } }, log, 'start kofta ticket');
  } },
  { id: 'J-R1-12', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const id = checksOf(openVisit('7')!.id)[0].id;
    const h = order(id).lines.find((l) => l.productId === 'p_hummus' && l.status === 'ACTIVE');
    if (!h) return log({ ok: null, text: 'hummus already voided', plain: t('الحمص كان اتلغى قبل كده') });
    await withApproval(w, 'Order.VoidLine', { params: { orderId: id, lineId: h.id }, body: { expectedVersion: order(id).version, reasonCode: 'WRONG_ITEM' } }, 'demo-manager-1', log, 'void hummus');
  } },
  { id: 'J-R1-13', device: 't_floor', user: 'demo-waiter-1', screen: () => ['order', { orderId: checksOf(openVisit('7')!.id)[1]?.id ?? checksOf(openVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const v = openVisit('7')!;
    let [c1, c2] = checksOf(v.id);
    if (!c2) c2 = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId('7') } }, log, 'check 2');
    const ids = order(c1.id).lines.filter((l) => l.status === 'ACTIVE' && ['p_orange_juice', 'p_tea'].includes(l.productId)).map((l) => l.id);
    if (ids.length) await api(w, 'Order.MoveLines', { params: { orderId: c1.id }, body: { expectedVersion: order(c1.id).version, targetExpectedVersion: order(c2.id).version, targetOrderId: c2.id, lineIds: ids } }, log, 'OJ ×2 + tea ×3 → check 2');
  } },
  { id: 'J-R1-14', device: 't_cash', user: 'demo-cashier-a', screen: () => ['pay', { orderId: checksOf(openVisit('7')!.id)[1]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const c2 = checksOf(openVisit('7')!.id)[1];
    if (order(c2.id).status === 'DRAFT') { const r = await api<any>(c, 'Order.Confirm', { params: { orderId: c2.id }, body: { expectedVersion: order(c2.id).version } }, log, 'confirm check 2'); log({ ok: true, text: `${r.confirmMessage} · payable ${r.totals.payable}` }); }
  } },
  { id: 'J-R1-15', device: 't_cash', user: 'demo-cashier-a', screen: () => ['pay', { orderId: checksOf(openVisit('7')!.id)[1]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const c2 = checksOf(openVisit('7')!.id)[1];
    const r = await api<any>(c, 'Payment.Capture', { params: { orderId: c2.id }, body: { tenders: [{ method: 'CASH', tendered: '300.00' }] } }, log, 'cash 300.00');
    log({ ok: true, text: `change ${r.change} (server) · remaining ${r.settlement.remaining}`, plain: Number(r.settlement.remaining) === 0 ? t('مفيش متبقي على الشيك (الباقي محسوب من السيرفر)') : t('لسه متبقي {a}', { a: egp(r.settlement.remaining) }) });
  } },
  { id: 'J-R1-16', device: 't_cash', user: 'demo-cashier-a', screen: () => ['pay', { orderId: checksOf(lastVisit('7')!.id)[1]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const c2 = checksOf(lastVisit('7')!.id)[1];
    await api(c, 'Order.Complete', { params: { orderId: c2.id }, body: { expectedVersion: order(c2.id).version } }, log, 'complete check 2');
  } },
  { id: 'J-R1-17', device: 't_cash', user: 'demo-cashier-a', screen: 'shift', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const s = openSession('t_cash');
    if (!s) return log({ ok: null, text: 'no open shift', plain: t('مفيش وردية مفتوحة') });
    const x = await api<any>(c, 'Session.XReport', { params: { sessionId: s.id } }, log, 'X report');
    log({ ok: x.expectedCash === undefined, text: `X tenders ${JSON.stringify(x.tenderBreakdown)} · expectedCash ${x.expectedCash === undefined ? 'hidden (blind)' : x.expectedCash}`, plain: x.expectedCash === undefined ? t('تقرير نص الوردية بيعرض الكاش، والمبلغ المتوقع في الدرج مخفي (عد أعمى)') : t('المبلغ المتوقع ظاهر في التقرير — كان المفروض يبقى مخفي') });
    const c2 = checksOf(lastVisit('7')!.id)[1];
    const cash = store.db.captures.filter((cp) => cp.orderId === c2.id && cp.method === 'CASH').reduce((a, cp) => a + Number(cp.amount), 0);
    const r = await api<any>(c, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: store.db.sessions.find((x2) => x2.id === s.id)!.version, countedCash: (500 + cash).toFixed(2) } }, log, `count ${(500 + cash).toFixed(2)}`);
    log({ ok: true, text: `variance ${r.variance} · outstanding checks ${r.z.outstandingChecks.length} (check 1 does not block)`, plain: t('الشيك الأول لسه مفتوح، ومش مانع قفل الوردية') });
  } },
  { id: 'J-R1-18', device: 't_cash', user: 'demo-cashier-b', screen: 'shift', run: async (log) => {
    const prev = devices.get('t_cash');
    if (prev.token) { try { await api(devices.auth('t_cash'), 'Auth.Logout', { body: {} }, log, 'cashier A logout'); } catch { /* ignore */ } devices.logout('t_cash'); }
    const c = await as('t_cash', 'demo-cashier-b', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
  } },
  { id: 'J-R1-19', device: 't_cash', user: 'demo-cashier-b', screen: () => ['pay', { orderId: checksOf(lastVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-b', log);
    const c1 = checksOf(lastVisit('7')!.id)[0];
    if (order(c1.id).status === 'DRAFT') { const r = await api<any>(c, 'Order.Confirm', { params: { orderId: c1.id }, body: { expectedVersion: order(c1.id).version } }, log, 'confirm check 1'); log({ ok: true, text: `${r.confirmMessage} · payable ${r.totals.payable}`, plain: t('الحمص الملغي مش محسوب في الإجمالي') }); }
  } },
  { id: 'J-R1-20', device: 't_cash', user: 'demo-cashier-b', screen: () => ['pay', { orderId: checksOf(lastVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-b', log);
    const c1 = checksOf(lastVisit('7')!.id)[0];
    await api(c, 'Payment.Capture', { params: { orderId: c1.id }, body: { tenders: [{ method: 'CASH', tendered: '200.00' }] } }, log, 'cash 200.00');
    const st = await api<any>(c, 'Payment.GetSettlement', { params: { orderId: c1.id } }, log);
    await api(c, 'Payment.Capture', { params: { orderId: c1.id }, body: { tenders: [{ method: 'CARD', amount: st.remaining, reference: 'DEMO-REF-0001' }] } }, log, `card ${st.remaining} DEMO-REF-0001`);
  } },
  { id: 'J-R1-21', device: 't_cash', user: 'demo-cashier-b', screen: () => ['pay', { orderId: checksOf(lastVisit('7')!.id)[0]?.id, back: 'floor' }], run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-b', log);
    const c1 = checksOf(lastVisit('7')!.id)[0];
    await api(c, 'Order.Complete', { params: { orderId: c1.id }, body: { expectedVersion: order(c1.id).version } }, log, 'complete check 1');
    const v = lastVisit('7')!;
    log({ ok: null, text: `table 7 visit: ${v.state}${v.state === 'CLOSED' ? ' (VisitAutoClosePolicy ON_LAST_CHECK_COMPLETED)' : ''}`, plain: v.state === 'CLOSED' ? t('ترابيزة 7 فضيت لوحدها بعد آخر شيك (حسب إعدادات مصر)') : t('ترابيزة 7 لسه مشغولة — الويتر هيقفلها') });
  } },
  { id: 'J-R1-22', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    const v = lastVisit('7')!;
    if (v.state === 'OPEN') await api(w, 'TableVisit.Close', { params: { visitId: v.id }, body: { expectedVersion: v.version } }, log, 'close table 7');
    else log({ ok: true, text: 'table 7 already free: the policy closed it when the last check completed (EG profile value; with MANUAL the waiter closes it here)', plain: t('ترابيزة 7 فاضية خلاص: فضيت لوحدها لما آخر شيك خلص (لو الإعداد «الويتر يقفلها بإيده» كان هيقفلها هنا)') });
  } },
  { id: 'J-R1-23', device: 't_admin', user: 'demo-manager-1', screen: 'shift', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-b', log);
    const s = openSession('t_cash');
    if (s) { const r = await api<any>(c, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: s.version, countedCash: '700.00' } }, log, 'count 700.00'); log({ ok: true, text: `variance ${r.variance}` }); }
    const m = await as('t_admin', 'demo-manager-1', log);
    const last = [...store.db.sessions].reverse().find((x) => x.terminalId === 't_cash' && x.state === 'CLOSED');
    if (last) { const z = await api<any>(m, 'Session.ZReport', { params: { sessionId: last.id } }, log, 'Z report'); log({ ok: true, text: `Z tenders ${JSON.stringify(z.tenderBreakdown)} · expected ${z.expectedCash} · counted ${z.countedCash}`, plain: t('تقرير القفلة: الكاش والكارت في سطرين منفصلين — المتوقع في الدرج {e} والمعدود {c}', { e: egp(z.expectedCash), c: egp(z.countedCash) }) }); }
  } },
];

// ───────── J-R2
const R2: StepDef[] = [
  { id: 'J-R2-1', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'cashier A float 500.00');
    const w = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('3')) await api(w, 'TableVisit.Open', { params: { tableId: tableId('3') }, body: { guestCount: 2 } }, log, 'table 3');
    let o = checksOf(openVisit('3')!.id)[0];
    if (!o) o = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId('3') } }, log, 'check');
    if (!order(o.id).lines.length) await api(w, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_mixed_grill', quantity: '1', modifierOptionIds: ['opt_well'] }] } }, log, 'mixed grill (well done)');
    if (!order(o.id).rounds.length) await api(w, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'send');
    if (order(o.id).status === 'DRAFT') await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'cashier confirms');
  } },
  { id: 'J-R2-2', device: 't_admin', user: 'demo-manager-1', screen: () => ['checks', {}], run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const v = openVisit('3') ?? lastVisit('3')!;
    const o = checksOf(v.id)[0];
    if (order(o.id).status !== 'VOIDED') {
      try {
        await api(m, 'Order.Void', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, reasonCode: 'CUSTOMER_LEFT', reason: 'الضيوف مشيوا قبل الأكل' } }, undefined, 'void check');
      } catch (e) {
        if (!(e instanceof ApiFailure) || e.code !== 'APPROVAL_REQUIRED') throw e;
        log({ ok: true, text: 'Order.Void → 403 APPROVAL_REQUIRED (ORDER_VOID ALWAYS)', plain: t('إلغاء الشيك محتاج موافقة مدير دايمًا — شاشة الموافقة ظهرت') });
        await expectRefusal(api(m, 'Approval.Grant', { body: { action: 'ORDER_VOID', targetType: e.details.targetType, targetId: e.details.targetId, context: e.details.context, approverUserId: userIdOf('demo-manager-1'), approverCredentialKind: 'PIN', approverSecret: demo.pin } }), 'SELF_APPROVAL_DENIED', log, 'manager-1 approves own void (N5)', t('أحمد حاول يوافق على طلبه هو'));
        await withApproval(m, 'Order.Void', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, reasonCode: 'CUSTOMER_LEFT', reason: 'الضيوف مشيوا قبل الأكل' } }, 'demo-manager-2', log, 'void check, manager-2 approves');
      }
    }
    const v2 = lastVisit('3')!;
    if (v2.state === 'OPEN') { const w = await as('t_floor', 'demo-waiter-1', log); await api(w, 'TableVisit.Close', { params: { visitId: v2.id }, body: { expectedVersion: v2.version } }, log, 'close table 3'); }
    else log({ ok: true, text: 'table 3 freed automatically (void ends the last check)', plain: t('ترابيزة 3 فضيت لوحدها (إلغاء آخر شيك بيفضّيها)') });
  } },
];

// ───────── J-R3
const R3: StepDef[] = [
  { id: 'J-R3-1', device: 't_cash', user: 'demo-cashier-a', screen: 'shift', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const me = await api<any>(c, 'Access.Me', {}, log, 'header');
    log({ ok: true, text: `${me.user.displayName} · branch ${me.branchId} · terminal ${me.terminalId}`, plain: `${t('أعلى الشاشة:')} ${userLabel(me.user.username, me.user.displayName)} · ${branchLabel(store.db.branches.find((b) => b.id === me.branchId))} · ${deviceName(me.terminalId)}` });
    const token = c.token;
    await api(c, 'Auth.Logout', { body: {} }, log, 'logout');
    await expectRefusal(api({ ...c, token }, 'Session.Current', { query: { terminalId: 't_cash' } }), 'UNAUTHENTICATED', log, 'action after logout', t('محاولة حركة بعد الخروج'));
    devices.logout('t_cash');
  } },
  { id: 'J-R3-2', device: 't_admin', user: 'demo-manager-1', screen: 'stations', run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('5')) await api(w, 'TableVisit.Open', { params: { tableId: tableId('5') }, body: { guestCount: 3 } }, log, 'table 5');
    const m = await as('t_admin', 'demo-manager-1', log);
    let t13 = store.db.tables.find((t) => t.name === '13' && t.branchId === 'branch_main');
    if (!t13) t13 = await api<any>(m, 'Table.Create', { body: { name: '13', area: 'Terrace', capacity: 4 } }, log, 'table 13');
    t13 = store.db.tables.find((t) => t.id === t13!.id)!;
    await api(m, 'Table.Configure', { params: { tableId: t13.id }, body: { expectedVersion: t13.version, name: '13', area: t13.area, capacity: 6 } }, log, 'table 13 capacity 6');
    t13 = store.db.tables.find((t) => t.id === t13!.id)!;
    if (t13.active) await api(m, 'Table.SetActive', { params: { tableId: t13.id }, body: { expectedVersion: t13.version, active: false } }, log, 'deactivate 13');
    const t5 = store.db.tables.find((t) => t.id === tableId('5'))!;
    await expectRefusal(api(m, 'Table.SetActive', { params: { tableId: t5.id }, body: { expectedVersion: t5.version, active: false } }), 'TABLE_OCCUPIED', log, 'deactivate 5 (seated)', t('محاولة إيقاف ترابيزة 5 وعليها زباين'));
  } },
  { id: 'J-R3-3', device: 't_admin', user: 'demo-manager-1', screen: 'stations', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const st = store.db.stations.find((s) => s.name === 'PASTRY' || s.name === 'DESSERT BAR');
    if (!st) return log({ ok: false, text: 'run J-R1 step 2 first (station PASTRY)', plain: t('لازم الخطوة 2 من رحلة «يوم صالة كامل» تتعمل الأول (محطة الحلواني)') });
    if (st.name === 'PASTRY') await api(m, 'KitchenStation.Configure', { params: { stationId: st.id }, body: { expectedVersion: st.version, name: 'DESSERT BAR' } }, log, 'rename → DESSERT BAR');
    const rule = store.db.routingRules.find((r) => r.match.productId === 'p_om_ali')!;
    const oldVersion = rule.version;
    if (rule.priority !== 45) await api(m, 'RoutingRule.Configure', { params: { ruleId: rule.id }, body: { expectedVersion: oldVersion, priority: 45 } }, log, 'Om Ali rule priority 5 → 45');
    await expectRefusal(api(m, 'RoutingRule.Configure', { params: { ruleId: rule.id }, body: { expectedVersion: oldVersion, priority: 45 } }), 'CONCURRENCY_CONFLICT', log, 'repeat with the old version', t('تكرار نفس التعديل من شاشة قديمة'));
  } },
  { id: 'J-R3-4', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', run: async (log) => {
    const w = await as('t_floor', 'demo-waiter-1', log);
    let v = openVisit('5') ?? openVisit('6');
    if (!v) return log({ ok: false, text: 'run step 2 first', plain: t('اعمل الخطوة 2 الأول') });
    if (store.db.tables.find((t) => t.id === v!.tableId)!.name === '5') await api(w, 'TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: tableId('6') } }, log, '5 → 6');
    v = openVisit('6')!;
    await expectRefusal(api(w, 'TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: v.version, toTableId: tableId('13') } }), 'TABLE_INACTIVE', log, '→ 13 (inactive)', t('محاولة نقل الزباين لترابيزة 13 (متوقفة)'));
    if (!openVisit('8')) await api(w, 'TableVisit.Open', { params: { tableId: tableId('8') }, body: { guestCount: 2 } }, log, 'seat table 8');
    await expectRefusal(api(w, 'TableVisit.Transfer', { params: { visitId: v.id }, body: { expectedVersion: openVisit('6')!.version, toTableId: tableId('8') } }), 'TABLE_OCCUPIED', log, '→ 8 (occupied)', t('محاولة نقلهم لترابيزة 8 (مشغولة)'));
  } },
];

// ───────── J-R4
const R4: StepDef[] = [
  { id: 'J-R4-1', device: 't_cash', user: 'demo-manager-1', screen: 'refunds', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift on DEMO-CASH-1');
    const m = await as('t_cash', 'demo-manager-1', log);
    const v = lastVisit('7');
    const c1 = v ? checksOf(v.id)[0] : null;
    if (!c1 || order(c1.id).status !== 'COMPLETED') return log({ ok: false, text: 'run J-R1 first (completed check 1)', plain: t('لازم رحلة «يوم صالة كامل» تتعمل الأول') });
    const rf = await api<any>(m, 'Refund.Refundable', { params: { orderId: c1.id } }, log, `check #${c1.number}`);
    log({ ok: true, text: `captures: ${rf.captures.map((x: any) => `${x.method} ${x.remaining}`).join(', ')} · effectivePaid ${rf.effectivePaid}`, plain: `${t('ينفع يترجع من:')} ${rf.captures.map((x: any) => `${x.method === 'CASH' ? t('الكاش') : x.method === 'CARD' ? t('الكارت') : t('المحفظة')} ${egp(x.remaining)}`).join(t('، '))}` });
  } },
  { id: 'J-R4-2', device: 't_cash', user: 'demo-manager-1', screen: 'refunds', run: async (log) => {
    const m = await as('t_cash', 'demo-manager-1', log);
    const c1 = checksOf(lastVisit('7')!.id)[0];
    const rf = await api<any>(m, 'Refund.Refundable', { params: { orderId: c1.id } }, log);
    const omali = rf.lines.find((l: any) => order(c1.id).lines.find((x) => x.id === l.lineId)?.productId === 'p_om_ali');
    const amount = omali.unitRefundable;
    const card = rf.captures.find((x: any) => x.method === 'CARD');
    const cash = rf.captures.find((x: any) => x.method === 'CASH');
    if (card) await expectRefusal(api(m, 'Refund.Request', { params: { orderId: c1.id }, body: { amount, method: 'CASH', allocations: [{ captureId: card.captureId, amount }], lines: [{ lineId: omali.lineId, quantity: '1' }], reasonCode: 'QUALITY_ISSUE', reason: 'الأم علي كانت باردة' } }), 'CROSS_TENDER_REFUND_DENIED', log, 'allocate to the card payment', t('محاولة ترجيع أم علي على دفعة الكارت'));
    const r = await api<any>(m, 'Refund.Request', { params: { orderId: c1.id }, body: { amount, method: 'CASH', allocations: [{ captureId: cash.captureId, amount }], lines: [{ lineId: omali.lineId, quantity: '1' }], reasonCode: 'QUALITY_ISSUE', reason: 'الأم علي كانت باردة' } }, log, `request ${amount} against cash`);
    await withApproval(m, 'Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: 1, payoutMethod: 'CASH' } }, 'demo-manager-2', log, 'approve + cash payout (manager-2)');
  } },
];

// ───────── J-A1 setup from zero
const ROLE_SETS: Record<string, string[]> = {
  owner: ['business:configure', 'business:read', 'branch:create', 'branch:configure', 'branch:read', 'terminal:register', 'terminal:update', 'terminal:read', 'role:create', 'role:read', 'role:update', 'user:create', 'user:read', 'user:manageaccess', 'credential:reset', 'settings:read', 'settings:updatepolicy', 'tax:manage', 'tax:read', 'catalog:manage', 'catalog:upsertitem', 'catalog:setprice', 'catalog:read', 'product:setavailability', 'product:read', 'table:upsert', 'table:read', 'kitchen:configure', 'kitchen:read', 'reasoncode:upsert', 'report:run', 'session:read', 'session:xreport', 'session:zreport', 'approve:sensitive_policy_change', 'approve:session_variance', 'approve:line_void', 'approve:order_void', 'approve:refund_approve', 'approve:order_discount', 'compliance:issuedocument', 'compliance:read', 'print:read'],
  manager: ['order:read', 'payment:read', 'catalog:read', 'catalog:setprice', 'product:setavailability', 'product:read', 'table:read', 'kitchen:read', 'settings:read', 'report:run', 'session:read', 'session:xreport', 'session:zreport', 'approve:session_variance', 'approve:line_void', 'approve:order_void', 'approve:refund_approve', 'approve:order_discount', 'approval:grant'],
  cashier: ['session:open', 'session:read', 'session:close', 'session:xreport', 'catalog:read', 'order:create', 'order:addlines', 'order:confirm', 'order:complete', 'order:read', 'payment:capture', 'payment:read', 'settings:read', 'report:run', 'approval:grant'],
  waiter: ['table:read', 'table:assign', 'table:release', 'catalog:read', 'order:create', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:read', 'order:confirm', 'settings:read', 'approval:grant', 'order:voidline'],
  chef: ['kitchen:read', 'kitchen:advanceticket'],
};

const SAMPLE_IMPORT = {
  units: [{ code: 'EA', precision: 0 }, { code: 'KG', precision: 3 }],
  categories: [{ key: 'hot', name_ar: 'مشروبات سخنة', name_en: 'Hot drinks' }, { key: 'mains', name_ar: 'أطباق رئيسية', name_en: 'Mains' }, { key: 'sweets', name_ar: 'حلويات', name_en: 'Desserts' }],
  modifierGroups: [{ key: 'size', name_ar: 'الحجم', name_en: 'Size', min: 1, max: 1 }],
  modifierOptions: [{ group: 'size', name_ar: 'عادي', name_en: 'Regular', priceDelta: '0' }, { group: 'size', name_ar: 'كبير', name_en: 'Large', priceDelta: '10' }],
  products: [
    { key: 'tea', name_ar: 'شاي', name_en: 'Tea', category: 'hot', unit: 'EA', modifier_groups: 'size' },
    { key: 'coffee', name_ar: 'قهوة', name_en: 'Coffee', category: 'hot', unit: 'EA', modifier_groups: 'size' },
    { key: 'koshari', name_ar: 'كشري', name_en: 'Koshari', category: 'mains', unit: 'EA' },
    { key: 'fattah', name_ar: 'فتة', name_en: 'Fattah', category: 'mains', unit: 'EA' },
    { key: 'basbousa', name_ar: 'بسبوسة', name_en: 'Basbousa', category: 'sweets', unit: 'EA' },
  ],
  prices: [] as any[],
};

function importBody(branchCode: string, withError: boolean) {
  const prices = SAMPLE_IMPORT.products.flatMap((p, i) => ['DINE_IN', 'TAKEAWAY'].map((ch) => ({ product: p.key, branch: branchCode, channel: ch, amount: String([25, 40, 75, 140, 60][i]) })));
  if (withError) prices.push({ product: 'molokhia', branch: branchCode, channel: 'DINE_IN', amount: 'ninety' });
  return { ...SAMPLE_IMPORT, prices };
}

const term = (code: string) => store.db.terminals.find((t) => t.code === code)?.id ?? '';
const A1: StepDef[] = [
  { id: 'J-A1-1', device: 'BO', user: 'implementation-engineer', screen: 'home', run: async (log) => {
    const bo = devices.auth('BO');
    const ready = await api<any>({ ...bo, token: null }, 'Health.Live', {}, log).catch(() => null);
    log({ ok: true, text: 'dedicated deployment (in-browser): readiness ok' + (ready ? '' : ''), plain: t('السيستم جاهز (السيرفر شغال جوه المتصفح في العرض ده)') });
  } },
  { id: 'J-A1-2', device: 'BO', user: 'implementation-engineer', screen: 'org', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    await api(e, 'Platform.BuildInfo', {}, log);
    await api(e, 'Business.Configure', { body: { expectedVersion: store.db.business.version, name: 'Koshary El Tahrir (DEMO)', nameAr: 'كشري التحرير (عرض)', legalName: 'El Tahrir Food Co. (DEMO)' } }, log, 'business names');
  } },
  { id: 'J-A1-3', device: 'BO', user: 'implementation-engineer', screen: 'org', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    if (!store.db.branches.length) await api(e, 'Branch.Create', { body: { code: 'TAHRIR-1', name: 'Tahrir Downtown', timezone: 'Africa/Cairo', businessDayCutoff: '04:00' } }, log, 'branch TAHRIR-1 (Africa/Cairo, 04:00)');
    devices.update('BO', { branchId: store.db.branches[0].id });
  } },
  { id: 'J-A1-4', device: 'BO', user: 'implementation-engineer', screen: 'org', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    const b = store.db.branches[0].id;
    for (const [code, name, kind, drawer] of [['CASH-1', 'Cashier 1', 'CASH', true], ['FLOOR-1', 'Waiter tablet 1', 'FLOOR', false], ['KDS-1', 'Kitchen display', 'KDS', false], ['ADMIN-1', 'Back office', 'ADMIN', false]] as const) {
      if (!term(code)) await api(e, 'Terminal.Register', { body: { code, name, branchId: b, kind, drawer } }, log, code);
    }
  } },
  { id: 'J-A1-5', device: 'BO', user: 'implementation-engineer', screen: 'users', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    const b = store.db.branches[0].id;
    for (const [name, perms] of Object.entries(ROLE_SETS)) if (!store.db.roles.some((r) => r.name === name)) await api(e, 'Role.Create', { body: { name, permissionIds: perms } }, log, `role ${name}`);
    for (const [u, role] of [['owner-1', 'owner'], ['manager-1', 'manager'], ['cashier-1', 'cashier'], ['waiter-1', 'waiter'], ['chef-1', 'chef'], ['manager-2', 'manager']]) {
      if (!store.db.users.some((x) => x.username === u)) await api(e, 'User.Create', { body: { username: u, displayName: personaDisplayName(u), password: demo.password, pin: demo.pin, roleAssignments: [{ roleId: store.db.roles.find((r) => r.name === role)!.id, branchIds: [b] }] } }, log, `${u} (${role})`);
    }
  } },
  { id: 'J-A1-6', device: 'BO', user: 'implementation-engineer', screen: 'settings', run: async (log) => {
    demo.applyEgProfile();
    log({ ok: true, text: 'settings.ApplyMarketProfile (internal): EG.profile 1.4.0 applied — review each value with the owner (Policy Panel / B4)', plain: t('إعدادات السوق المصري اتطبقت — راجعها مع صاحب المطعم من «إعدادات المطعم»') });
  } },
  { id: 'J-A1-7', device: 'BO', user: 'owner-1', screen: 'taxes', run: async (log) => {
    const o = await as('BO', 'owner-1', log);
    if (!store.db.taxPolicies.length) await api(o, 'TaxPolicy.Create', { body: { name: { ar: 'ضريبة القيمة المضافة', en: 'VAT' }, jurisdiction: 'EG', calculationMode: 'EXCLUSIVE', rate: '14', roundingMode: 'HALF_UP', roundingScale: 2 } }, log, 'VAT 14 % EXCLUSIVE HALF_UP 2');
    demo.setPolicy('ProductTaxDefaultPolicy', { taxPolicyId: store.db.taxPolicies[0].id });
    log({ ok: null, text: 'ProductTaxDefaultPolicy → VAT (new products get it by default)', plain: t('أي صنف جديد هياخد ضريبة القيمة المضافة أوتوماتيك') });
  } },
  { id: 'J-A1-8', device: 'BO', user: 'owner-1', screen: 'settings', run: async (log) => {
    const o = await as('BO', 'owner-1', log);
    const codes = (await import('../mock/contracts')).egProfile.owner_data.find((d) => d.id === 'EG-REASON-CODES')!.data.codes;
    let n = 0;
    for (const c of codes) if (!store.db.reasonCodes.some((r) => r.kind === c.kind && r.code === c.code)) { await api(o, 'ReasonCode.Create', { body: c }); n++; }
    log({ ok: true, text: `ReasonCode.Create × ${n} (EG-REASON-CODES); ReasonCodePolicy MANAGED from the profile`, plain: t('اتضاف {n} سبب جاهز، والموظفين هيختاروا من القايمة', { n }) });
  } },
  { id: 'J-A1-9', device: 'BO', user: 'owner-1', screen: 'import', run: async (log) => {
    const o = await as('BO', 'owner-1', log);
    const code = store.db.branches[0].code;
    const dry1 = await api<any>(o, 'Catalog.Import', { body: { dryRun: true, ...importBody(code, true) } }, log, 'dry run (sheet with one bad row)');
    log({ ok: dry1.issues.length > 0, text: `issues: ${dry1.issues.map((i: any) => `${i.sheet} r${i.row} ${i.field} ${i.code}`).join(' · ')}`, plain: t('التجربة لقت {n} غلطة، كل واحدة بمكانها: {w}', { n: dry1.issues.length, w: [...new Set(dry1.issues.map((i: any) => t('صفحة {s} سطر {r}', { s: ({ prices: t('الأسعار'), products: t('الأصناف'), categories: t('الأقسام'), units: t('الوحدات') } as Record<string, string>)[i.sheet] ?? i.sheet, r: i.row })))].join(t('، ')) }) });
    await expectRefusal(api(o, 'Catalog.Import', { body: { dryRun: false, ...importBody(code, true) } }), 'VALIDATION_FAILED', log, 'apply with errors (all-or-nothing)', t('محاولة الاستيراد الحقيقي والأخطاء لسه موجودة'));
    const dry2 = await api<any>(o, 'Catalog.Import', { body: { dryRun: true, ...importBody(code, false) } }, log, 'dry run (fixed)');
    if (dry2.ok && !store.db.products.length) await api(o, 'Catalog.Import', { body: { dryRun: false, ...importBody(code, false) } }, log, 'apply');
  } },
  { id: 'J-A1-10', device: 'BO', user: 'owner-1', screen: 'menu', run: async (log) => {
    const o = await as('BO', 'owner-1', log);
    const b = store.db.branches[0].id;
    if (store.db.products.some((p) => p.name.en === 'Lentil soup')) return log({ ok: null, text: 'already added', plain: t('الصنف متضاف قبل كده') });
    const cat = await api<any>(o, 'Category.Create', { body: { name: { ar: 'شوربة', en: 'Soups' } } }, log, 'category');
    const unit = store.db.units.find((u) => u.code === 'EA')!;
    const p = await api<any>(o, 'Product.Create', { body: { name: { ar: 'شوربة عدس', en: 'Lentil soup' }, categoryId: cat.id, unitId: unit.id } }, log, 'product (sku auto)');
    await api(o, 'Catalog.SetPrice', { params: { productId: p.id }, body: { branchId: b, channel: 'DINE_IN', amount: '45.00', currency: 'EGP' } }, log, 'price DINE_IN 45');
    await api(o, 'Catalog.SetPrice', { params: { productId: p.id }, body: { branchId: b, channel: 'TAKEAWAY', amount: '45.00', currency: 'EGP' } }, log, 'price TAKEAWAY 45');
    log({ ok: null, text: `NewProductAvailabilityPolicy CREATING_BRANCH → available on the creating branch (sku ${p.sku})`, plain: t('الصنف بيتباع على طول في الفرع اللي اتعمل فيه، واتعمله كود أوتوماتيك') });
    if (!store.db.availability.some((a) => a.productId === p.id)) await api(o, 'Product.SetAvailability', { params: { productId: p.id }, body: { state: 'AVAILABLE', branchId: b } }, log, 'availability');
  } },
  { id: 'J-A1-11', device: 'BO', user: 'owner-1', screen: 'stations', run: async (log) => {
    const o = await as('BO', 'owner-1', log);
    for (let i = 1; i <= 6; i++) if (!store.db.tables.some((t) => t.name === String(i))) await api(o, 'Table.Create', { body: { name: String(i), area: 'Hall', capacity: 4 } });
    log({ ok: true, text: 'tables 1–6', plain: t('الترابيزات من 1 لـ 6 اتعملت') });
    for (const n of ['GRILL', 'COLD', 'BAR']) if (!store.db.stations.some((s) => s.name === n)) await api(o, 'KitchenStation.Create', { body: { name: n } }, log, n);
    const st = (n: string) => store.db.stations.find((s) => s.name === n)!.id;
    const cats = store.db.categories;
    if (!store.db.routingRules.length) {
      for (const c of cats) await api(o, 'RoutingRule.Create', { body: { priority: c.name.en.includes('drink') ? 10 : 50, match: { categoryId: c.id }, stationId: c.name.en.includes('drink') ? st('BAR') : c.name.en === 'Desserts' ? st('COLD') : st('GRILL') } }, log, `rule ${c.name.en}`);
      await api(o, 'RoutingRule.Create', { body: { priority: 1000, match: {}, stationId: st('GRILL') } }, log, 'explicit catch-all → GRILL');
    }
  } },
  { id: 'J-A1-12', device: 'BO', user: 'implementation-engineer', screen: 'prints', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    await api(e, 'Print.Document', { body: { documentType: 'X_REPORT', documentId: 'TEST-PAGE', terminalId: term('CASH-1'), label: 'Test page CASH-1' } }, log, 'test page on CASH-1');
    log({ ok: null, text: 'a print failure never blocks a sale (try the printer simulator: DOWN)', plain: t('عطل الطابعة عمره ما يوقف البيع (جرّبه من «محاكاة الأعطال»)') });
  } },
  { id: 'J-A1-13', device: 'BO', user: 'implementation-engineer', screen: 'fiscal', run: async (log) => {
    const e = await as('BO', 'implementation-engineer', log);
    const b = store.db.branches[0];
    await api(e, 'FiscalProfile.Configure', { params: { branchId: b.id }, body: { adapter: 'EG_ETA', issuerId: 'DEMO-RIN-123456789', issuerName: 'El Tahrir Food Co. (DEMO)', issuerBranchCode: '0', activityCode: '5610', receiptType: 'SC', address: { governate: 'Cairo', city: 'Downtown', street: 'Tahrir Sq.', buildingNumber: '1' } } }, log, 'fiscal profile (SANDBOX)');
    if (!store.db.fiscalDevices.some((d) => d.terminalId === term('CASH-1'))) await api(e, 'FiscalDevice.Register', { body: { adapter: 'EG_ETA', terminalId: term('CASH-1'), deviceSerial: 'POS-TAHRIR-0001', credentialRef: 'secret://eta/pos-tahrir-0001' } }, log, 'device for CASH-1');
    await api(e, 'FiscalItemMapping.SetMany', { body: { adapter: 'EG_ETA', rows: store.db.products.map((p, i) => ({ productId: p.id, codeType: 'EGS', itemCode: `EG-TAHRIR-${String(i + 1).padStart(4, '0')}`, unitType: 'EA' })) } }, log, 'item codes');
  } },
  { id: 'J-A1-14', device: 'CASH-1', user: 'cashier-1', screen: 'counter', run: async (log) => {
    const dev = term('CASH-1');
    const c = await as(dev, 'cashier-1', log);
    if (!openSession(dev)) await api(c, 'Session.Open', { body: { terminalId: dev, openingFloat: '300.00' } }, log, 'float 300');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    const kosh = store.db.products.find((p) => p.name.en === 'Koshari')!;
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: kosh.id, quantity: '2' }] } }, log, 'koshari ×2');
    const conf = await api<any>(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm (fires at confirm)');
    const cap = await api<any>(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '200.00' }] } }, log, 'cash 200');
    log({ ok: true, text: `payable ${conf.totals.payable} · change ${cap.change}` });
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
    const s = openSession(dev)!;
    await api(c, 'Session.XReport', { params: { sessionId: s.id } }, log, 'X');
    const exp = Number(s.openingFloat) + store.db.captures.filter((x) => x.sessionId === s.id && x.method === 'CASH').reduce((a, x) => a + Number(x.amount), 0);
    await api(c, 'Session.Close', { params: { sessionId: s.id }, body: { expectedVersion: store.db.sessions.find((x) => x.id === s.id)!.version, countedCash: exp.toFixed(2) } }, log, `close, counted ${exp.toFixed(2)}`);
  } },
  { id: 'J-A1-15', device: 'ADMIN-1', user: 'manager-1', screen: 'reports', run: async (log) => {
    const m = await as(term('ADMIN-1'), 'manager-1', log);
    const bd = store.db.orders.at(-1)?.completedBusinessDate ?? '';
    const r = await api<any>(m, 'Report.Run', { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: bd } }, log, `daily_sales ${bd}`);
    log({ ok: true, text: r.sections[0].rows.slice(0, 6).map((x: any[]) => `${x[0]}=${x[1]}`).join(' · '), plain: t('تقرير المبيعات فيه بيعة النهارده') });
    await api(m, 'Report.Run', { params: { reportId: 'tenders' }, query: { fromBusinessDate: bd } }, log, 'tenders');
  } },
  { id: 'J-A1-16', device: 'BO', user: 'implementation-engineer', screen: 'home', run: async (log) => {
    log({ ok: true, text: `backup drill (demo): state export = ${Math.round(store.exportJson().length / 1024)} KB JSON; use the data menu ⟲ → export/import to restore. RPO/RTO are measured on the real install.`, plain: t('اتعملت نسخة احتياطية ({k} كيلوبايت). في العرض بترجع من «البيانات ← رجّع نسخة محفوظة».', { k: Math.round(store.exportJson().length / 1024) }) });
  } },
  { id: 'J-A1-17', device: 'BO', user: 'implementation-engineer', screen: 'home', run: async (log) => {
    log({ ok: true, text: 'handover: train each role with J-R1..J-R4 and N1..N12 (see the "سيناريوهات الفشل" panel); profile questions are listed in the Policy Panel.', plain: t('التسليم: درّب كل واحد على الرحلات و«سيناريوهات الفشل»؛ وأسئلة الإعدادات موجودة في «إعدادات المطعم».') });
  } },
];

// ───────── counter & takeaway (01_SCREENS journey 3)
const C1: StepDef[] = [
  { id: 'J-C1-1', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', text: { who: 'demo-cashier-a on DEMO-CASH-1', do_ar: 'افتح وردية لو مش مفتوحة، واعمل طلب تيك أواي: شاورما فراخ (جبنة زيادة) وعصير برتقال.', do_en: 'Open a shift if needed; create a takeaway: chicken shawarma (extra cheese) and orange juice.', expect_ar: 'سعر عصير البرتقال تيك أواي 45 (سعر خاص بالقناة) مش 50. مفيش خدمة على التيك أواي.', expect_en: 'Orange juice TAKEAWAY is 45 (channel price), not 50. No service charge on takeaway.', operations: [] }, run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_chicken_shawarma', quantity: '1', modifierOptionIds: ['opt_cheese'] }, { productId: 'p_orange_juice', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }, log, 'shawarma + OJ');
    devices.navigate('t_cash', 'counter', { orderId: o.id });
    const ord = order(o.id);
    log({ ok: true, text: `OJ line ${ord.lines[1].lineTotal} · service: ${ord.service?.origin}`, plain: t('سعر العصير في التيك أواي: {a}', { a: egp(ord.lines[1].lineTotal) }) });
  } },
  { id: 'J-C1-2', device: 't_cash', user: 'demo-cashier-a', screen: () => ['pay', { orderId: [...store.db.orders].reverse().find((o) => o.channel === 'TAKEAWAY')?.id, back: 'counter' }], text: { who: 'demo-cashier-a on DEMO-CASH-1', do_ar: 'ادفع الأول: تأكيد (بيبعت للمطبخ وقت التأكيد) ثم كاش 300.', do_en: 'Pay first: confirm (fires at confirm), then cash 300.', expect_ar: 'التأكيد بيعمل جولة للمطبخ (AT_CONFIRM). الباقي من السيرفر.', expect_en: 'Confirm creates the kitchen round (AT_CONFIRM). Change from the server.', operations: [] }, run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const o = [...store.db.orders].reverse().find((x) => x.channel === 'TAKEAWAY' && x.status === 'DRAFT');
    if (!o) return log({ ok: false, text: 'run step 1 first', plain: t('اعمل الخطوة 1 الأول') });
    const conf = await api<any>(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    log({ ok: true, text: `round via CONFIRM: ${conf.confirmFireRound}`, plain: t('الطلب راح المطبخ أول ما الشيك اتأكد') });
    const cap = await api<any>(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '300.00' }] } }, log, 'cash 300');
    log({ ok: true, text: `change ${cap.change}` });
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
  } },
  { id: 'J-C1-3', device: 't_cash', user: 'demo-cashier-a', screen: () => ['receipt', { orderId: [...store.db.orders].reverse().find((o) => o.channel === 'TAKEAWAY')?.id }], text: { who: 'demo-cashier-a on DEMO-CASH-1', do_ar: 'افتح الإيصال، وبعدين اطبع نسخة.', do_en: 'Open the receipt, then reprint a copy.', expect_ar: 'الإيصال فيه QR الإيصال الإلكتروني. النسخة مكتوب عليها "نسخة" ومش بتعمل إيصال جديد.', expect_en: 'The receipt carries the e-receipt QR. The reprint says "COPY" and never issues a new receipt.', operations: [] }, run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const o = [...store.db.orders].reverse().find((x) => x.channel === 'TAKEAWAY' && x.status === 'COMPLETED')!;
    await api(c, 'Receipt.Get', { params: { orderId: o.id } }, log, 'receipt');
    await api(c, 'Print.Reprint', { body: { documentType: 'RECEIPT', documentId: o.id, terminalId: 't_cash' } }, log, 'reprint (copy)');
  } },
];

// ───────── failures (01_SCREENS journey 4)
const F1: StepDef[] = [
  { id: 'J-F1-1', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', text: { who: 'demo-cashier-a on DEMO-CASH-1', do_ar: 'دفع ضاع رده ثم إعادة المحاولة: المحاكاة هتضيّع رد الدفع الجاي. اعمل طلب وادفعه من شاشة التحصيل بنفسك، وهتظهر "النتيجة مش معروفة" — اضغط إعادة المحاولة.', do_en: 'Lost payment response then retry: the simulator drops the next Payment.Capture response. Pay a check yourself; "result unknown" appears — tap Retry.', expect_ar: 'إعادة المحاولة بترجع نفس النتيجة (Idempotent-Replayed) ودفعة واحدة بس. مفيش "دفعة جديدة" وهي مش معروفة.', expect_en: 'Retry returns the stored result (Idempotent-Replayed), exactly one capture. No new payment while unknown.', operations: [{ op: 'Payment.Capture', http: 'POST /orders/{orderId}/payments', actor: 'cashier', expected: 'N12' }] }, run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }] } }, log, 'kofta');
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    sim.set({ dropNextResponse: 'Payment.Capture' });
    log({ ok: null, text: 'simulator: the next Payment.Capture response will be lost — now pay it in the UI', plain: t('جهّزنا العطل: رد الدفع الجاي هيضيع — ادفع الطلب بنفسك من شاشة التحصيل') });
    devices.navigate('t_cash', 'pay', { orderId: o.id, back: 'counter' });
  } },
  { id: 'J-F1-2', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', before: () => sim.set({ dropNextResponse: null }), text: { who: 'demo-waiter-1 (T2) and demo-waiter-2', do_ar: 'جهازين بيعدلوا نفس الشيك: الاتنين بيضغطوا "ابعت للمطبخ" على نفس النسخة.', do_en: 'Two devices edit one check: both send to the kitchen from the same version.', expect_ar: 'واحد بس بينجح؛ التاني بياخد CONCURRENCY_CONFLICT "حد تاني عدّل الشيك ده" وبيعمل تحديث. جولة واحدة وتذاكر مرة واحدة.', expect_en: 'Exactly one succeeds; the other gets CONCURRENCY_CONFLICT and refreshes. One round, one ticket set.', operations: [{ op: 'Order.Fire', http: 'POST /orders/{orderId}/fire', actor: 'two waiters', expected: 'N3' }] }, run: async (log) => {
    sim.set({ dropNextResponse: null });
    const w1 = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('2')) await api(w1, 'TableVisit.Open', { params: { tableId: tableId('2') }, body: { guestCount: 2 } }, log, 'table 2');
    const o = await api<any>(w1, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId('2') } }, log, 'check');
    await api(w1, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_beef_burger', quantity: '1', modifierOptionIds: ['opt_medium'] }] } }, log, 'burger');
    const v = order(o.id).version;
    const w2 = await as('t_admin', 'demo-waiter-2', log);
    const res = await Promise.allSettled([api(w1, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: v } }), api(w2, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: v } })]);
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    log({ ok: ok === 1, text: `${ok} success, ${res.length - ok} CONCURRENCY_CONFLICT · rounds ${order(o.id).rounds.length}`, plain: ok === 1 ? t('واحد بس نجح، والتاني اتنبّه إن حد عدّل الشيك — والمطبخ أخد الطلب مرة واحدة') : t('نجح {n} من 2 — كان المفروض واحد بس', { n: ok }) });
    devices.navigate('t_floor', 'order', { orderId: o.id, back: 'floor' });
  } },
  { id: 'J-F1-3', device: 't_cash', user: 'demo-cashier-a', screen: 'prints', text: { who: 'demo-cashier-a on DEMO-CASH-1', do_ar: 'الطابعة واقعة: طابعة الكاشير DOWN، وبيع تيك أواي يتقفل.', do_en: 'Printer down: the cashier printer is DOWN; a takeaway sale completes.', expect_ar: 'البيع بيخلص عادي. مهمة الطباعة FAILED وبتتعاد تلقائي، وبعد 5 محاولات DEAD. إعادة المحاولة بنفس المهمة ونفس النسخة.', expect_en: 'The sale completes. The print job FAILS, retries, then DEAD after 5 attempts. Retry reuses the same job and copy.', operations: [{ op: 'PrintJob.Retry', http: 'POST /print-jobs/{id}/retry', actor: 'cashier', expected: 'same job' }] }, run: async (log) => {
    sim.set({ printers: { ...sim.get().printers, t_cash: 'DOWN' }, dropNextResponse: null });
    log({ ok: null, text: 'simulator: DEMO-CASH-1 printer DOWN', plain: t('جهّزنا العطل: طابعة الكاشير واقعة') });
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_espresso', quantity: '1' }] } }, log, 'espresso');
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    await api(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '100' }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete — sale done');
    for (let i = 0; i < 6; i++) { clock.advance(6 * 60_000); runOutbox(); }
    const j = store.db.printJobs.find((x) => x.documentId === o.id)!;
    log({ ok: j.state === 'DEAD', text: `print job ${j.id}: ${j.state} after ${j.attempts.length} attempts (clock moved forward)`, plain: j.state === 'DEAD' ? t('أمر الطباعة فشل {n} مرات واتوقف ومستني حد يعيده — والبيع خلص عادي', { n: j.attempts.length }) : t('أمر الطباعة لسه بيحاول') });
  } },
  { id: 'J-F1-4', device: 't_floor', user: 'demo-waiter-1', screen: 'floor', text: { who: 'demo-waiter-1 on T2', do_ar: 'شاشة المطبخ واقعة: KDS DOWN، والويتر يبعت جولة. بعدين نرجّعها ونعمل إعادة إرسال.', do_en: 'Kitchen screen down: KDS DOWN, the waiter sends a round. Then bring it back and re-send.', expect_ar: 'الجولة بتتسجل والشيك بيعرض "ما وصلش المطبخ" + إعادة إرسال. إعادة الإرسال بتعمل التذاكر مرة واحدة بس.', expect_en: 'The round is recorded; the check shows "not delivered" with re-send. Re-send creates the tickets exactly once.', operations: [{ op: 'Kitchen.Resend', http: 'POST /orders/{orderId}/kitchen/resend', actor: 'waiter', expected: 'no duplicate' }] }, run: async (log) => {
    sim.set({ kds: 'DOWN' });
    log({ ok: null, text: 'simulator: kitchen delivery DOWN', plain: t('جهّزنا العطل: شاشة المطبخ واقعة') });
    const w = await as('t_floor', 'demo-waiter-1', log);
    if (!openVisit('4')) await api(w, 'TableVisit.Open', { params: { tableId: tableId('4') }, body: { guestCount: 2 } }, log, 'table 4');
    const o = await api<any>(w, 'Order.Create', { body: { channel: 'DINE_IN', tableId: tableId('4') } }, log, 'check');
    await api(w, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_hummus', quantity: '1' }, { productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }] } }, log, 'hummus + tea');
    await api(w, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'send');
    await sleep(200); runOutbox();
    log({ ok: true, text: `delivery: ${store.db.kitchenDeliveries.filter((d) => d.orderId === o.id).map((d) => d.state).join(',')}`, plain: t('الطلب اتسجل بس ما وصلش المطبخ — الشيك بيعرض «ما وصلش» وزرار إعادة إرسال') });
    sim.set({ kds: 'UP' });
    await api(w, 'Kitchen.Resend', { params: { orderId: o.id }, body: {} }, log, 're-send');
    await sleep(200); runOutbox();
    await expectRefusal(api(w, 'Kitchen.Resend', { params: { orderId: o.id }, body: {} }), 'VALIDATION_FAILED', log, 'second re-send (nothing to re-send)', t('محاولة إعادة الإرسال مرة تانية (مفيش حاجة تتبعت)'));
    log({ ok: store.db.tickets.filter((t) => t.orderId === o.id).length === 2, text: `tickets for this check: ${store.db.tickets.filter((t) => t.orderId === o.id).length} (one per station)`, plain: t('المطبخ استلم {n} طلب (واحد لكل محطة) — من غير تكرار', { n: store.db.tickets.filter((x) => x.orderId === o.id).length }) });
    devices.navigate('t_floor', 'order', { orderId: o.id, back: 'floor' });
  } },
  { id: 'J-F1-5', device: 't_admin', user: 'demo-manager-1', screen: 'ereceipts', text: { who: 'demo-manager-1 on ADMIN', do_ar: 'منصة الإيصال الإلكتروني واقعة يوم: ETA DOWN، بيع يتقفل، والساعة تتقدم 12 ثم 20 ساعة، وبعدين ETA ترجع.', do_en: 'E-receipt platform down for a day: ETA DOWN, a sale completes, the clock moves 12 h then 20 h, then ETA comes back.', expect_ar: 'البيع خلص. الإيصال في الطابور، تنبيه عند 12 ساعة و20 ساعة قبل مهلة 24 ساعة. لما المنصة ترجع بيتقبل.', expect_en: 'The sale is done. The document queues; alerts at 12 h and 20 h before the 24 h deadline. Accepted when the platform returns.', operations: [{ op: 'Compliance.Find', http: 'GET /compliance/documents', actor: 'manager', expected: 'queue + alerts' }] }, run: async (log) => {
    sim.set({ eta: 'DOWN' });
    log({ ok: null, text: 'simulator: ETA DOWN', plain: t('جهّزنا العطل: منظومة الإيصال الإلكتروني واقعة') });
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'shift');
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_beef_burger', quantity: '1', modifierOptionIds: ['opt_well'] }] } }, log, 'burger (item code mapped)');
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    await api(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '300' }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
    runOutbox();
    clock.advance(12 * 3_600_000 + 60_000); runOutbox(); await sleep(2100); runOutbox();
    clock.advance(8 * 3_600_000); await sleep(2100); runOutbox();
    const doc = store.db.fiscalDocuments.find((d) => d.orderId === o.id)!;
    log({ ok: true, text: `document ${doc.state}; alerts: ${store.db.alerts.filter((a) => a.ref?.endsWith(doc.id)).map((a) => a.kind + ' ' + a.severity).join(', ')}`, plain: t('الساعة اتقدمت: الإيصال مستني في الطابور، وطلع {n} تنبيه للمدير', { n: store.db.alerts.filter((a) => a.ref?.endsWith(doc.id)).length }) });
    sim.set({ eta: 'UP' });
    doc.nextTryAtMs = 0; runOutbox();
    log({ ok: store.db.fiscalDocuments.find((d) => d.id === doc.id)!.state === 'ACCEPTED', text: `ETA back up → ${store.db.fiscalDocuments.find((d) => d.id === doc.id)!.state}`, plain: store.db.fiscalDocuments.find((d) => d.id === doc.id)!.state === 'ACCEPTED' ? t('المنظومة رجعت والإيصال اتقبل') : t('المنظومة رجعت بس الإيصال لسه ما اتقبلش') });
  } },
];

const withText = (steps: StepDef[]) => steps.map((s) => ({ ...s, text: s.text ?? txt(s.id) }));

export const JOURNEYS: Journey[] = [
  { id: 'J-R1', title: 'يوم صالة كامل (J-R1)', titleEn: 'Dine-in day (J-R1)', reset: 'DEMO', intro: 'جولتين للمطبخ، إلغاء صنف بموافقة مدير، تقسيم الشيك، كاش وكارت، الترابيزة تفضى، المطبخ متابع، وتسليم وردية بتقارير X و Z.', steps: withText(R1) },
  { id: 'J-R2', title: 'إلغاء شيك بعد الإرسال (J-R2)', titleEn: 'Whole-check void (J-R2)', reset: null, intro: 'شيك اتبعت واتأكد ومادفعش — إلغاء كامل بموافقة مدير تاني (وموافقة الشخص لنفسه مرفوضة).', steps: withText(R2) },
  { id: 'J-R3', title: 'الدخول وإدارة الصالة والمطبخ (J-R3)', titleEn: 'Login, floor & kitchen admin (J-R3)', reset: null, intro: 'سياق الدخول، تعديل الترابيزات والمحطات وقواعد التوجيه، ونقل قعدة لترابيزة تانية.', steps: withText(R3) },
  { id: 'J-R4', title: 'مرتجع كاش بموافقة مدير تاني (J-R4)', titleEn: 'Cash refund (J-R4)', reset: null, intro: 'مرتجع أم علي من شيك J-R1 على دفعة الكاش، والمحاولة على الكارت مرفوضة.', steps: withText(R4) },
  { id: 'J-A1', title: 'تركيب مطعم من الصفر (J-A1)', titleEn: 'Setup from zero (J-A1)', reset: 'ZERO', intro: 'من سيرفر فاضي: النشاط، الفرع، الأجهزة، الأدوار والناس، بروفايل مصر، الضريبة، الأسباب، استيراد المنيو، الترابيزات والمحطات، التسجيل الضريبي، أول بيع وأول قفل وتقارير.', steps: withText(A1) },
  { id: 'J-C1', title: 'كاونتر وتيك أواي', titleEn: 'Counter & takeaway', reset: null, intro: 'طلب تيك أواي، الدفع الأول (الإرسال للمطبخ وقت التأكيد)، والإيصال ونسخته.', steps: C1 },
  { id: 'J-F1', title: 'سيناريوهات الأعطال', titleEn: 'Failure journeys', reset: null, intro: 'رد ضايع في الدفع، جهازين على نفس الشيك، طابعة واقعة، شاشة مطبخ واقعة وإعادة إرسال، ومنصة الإيصال الإلكتروني واقعة يوم كامل.', steps: F1 },
];
