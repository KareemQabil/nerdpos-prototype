// ux-14 journey J-V1 — devices, printers and display screens against the mock: the defaults and who may do what; the
// manager registers a second customer display on cashier 2 (a second one on the same terminal and a call board on a
// cashier terminal are refused), sets its look, gives it content (one item inside its daily window, one outside) and
// the display reads only its own content — another terminal's session is refused; retiring an item needs a reason and
// takes it off the screen; the cashier's printer runs out of paper during a sale: the sale is committed, the receipt
// is a visible failed job with an alert, and after the paper is changed the same job is retried; disabling a printer
// needs a reason, its test page is refused, and with PrintRoutingPolicy BRANCH_BACKUP a pre-bill goes to the backup
// printer; a kitchen printer assigned to a station prints its tickets; the keyboard changes are kept by the server
// (the cashier may not change them under KeyMapPolicy MANAGERS); a disabled display shows nothing.
import { api, as, expectRefusal, withApproval, order, openSession, type Logger } from './runner';
import { store } from '../mock/store';
import { sim } from '../mock/sim';
import { runOutbox } from '../mock/outbox';
import { devOf } from '../mock/devices';
import { clock, zonedParts } from '../mock/clock';
import { t } from '../i18n';
import type { StepDef } from './scripts';

const check = (log: Logger, ok: boolean, text: string, plain: string) => log({ ok, text, plain });
const dev = (id: string) => devOf(store.db).devices.find((d) => d.id === id)!;
const devByCode = (code: string) => devOf(store.db).devices.find((d) => d.code === code);
const S: { cd2?: string; now?: string; later?: string } = {};
const pv = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
async function policyChange(log: Logger, policyId: string, patch: Record<string, unknown>) {
  const o = await as('t_admin', 'demo-owner', log);
  await withApproval(o, 'Settings.UpdatePolicy', { params: { policyId }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...(pv(policyId) ?? {}), ...patch }, changeNote: 'J-V1' } }, 'demo-manager-1', log, `${policyId} ${JSON.stringify(patch)}`);
}
/** Drives the outbox so the waiting jobs run now (the clock never moves: their next try is made due). */
function drain(ids: string[]) { for (let i = 0; i < 3; i++) { for (const j of store.db.printJobs) if (ids.includes(j.id) && (j.state === 'PENDING' || j.state === 'FAILED')) j.nextAtMs = 0; runOutbox(); } }

const V1: StepDef[] = [
  { id: 'J-V1-1', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const ok = pv('CustomerDisplayPolicy')?.idleContent === 'ASSIGNED_ONLY' && pv('PrintRoutingPolicy')?.fallback === 'NONE' && pv('KeyMapPolicy')?.changeBy === 'MANAGERS' && pv('DeviceHealthPolicy')?.offlineAfterSeconds === 120;
    check(log, ok, `defaults: ${JSON.stringify({ CustomerDisplayPolicy: pv('CustomerDisplayPolicy'), PrintRoutingPolicy: pv('PrintRoutingPolicy'), KeyMapPolicy: pv('KeyMapPolicy') })}`, t('الإعدادات الافتراضية: شاشة العميل تعرض المحتوى المخصص لها فقط، ولا طابعة بديلة، والمفاتيح يغيّرها المدير'));
    const m = await as('t_admin', 'demo-manager-1', log);
    const list = await api<any>(m, 'Device.List', {}, log, 'devices');
    const kinds = new Set(list.items.map((d: any) => d.kind));
    check(log, ['PRINTER', 'CASH_DRAWER', 'SCANNER', 'CUSTOMER_DISPLAY', 'CALL_BOARD'].every((k) => kinds.has(k)), `${list.items.length} devices: ${[...kinds].join(', ')}`, t('الأجهزة كلها في مكان واحد: الطابعات والأدراج والماسح وشاشات العرض'));
    const c = await as('t_cash2', 'demo-cashier-b', log);
    await api(c, 'Device.List', {}, log, 'the cashier reads the device status');
    await expectRefusal(api(c, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-X', name: 'x', terminalId: 't_cash2' } }), 'PERMISSION_DENIED', log, 'the cashier registers a device', t('لا يسجّل الكاشير جهازًا'));
  } },
  { id: 'J-V1-2', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    await expectRefusal(api(m, 'Device.Register', { body: { kind: 'CUSTOMER_DISPLAY', code: 'CD-X', name: 'شاشة ثانية', terminalId: 't_cash' } }), 'DEVICE_HOST_TAKEN', log, 'a second customer display on cashier 1', t('لكل جهاز كاشير شاشة عميل واحدة'));
    await expectRefusal(api(m, 'Device.Register', { body: { kind: 'CALL_BOARD', code: 'CB-X', name: 'شاشة نداء', terminalId: 't_cash2' } }), 'DEVICE_HOST_INVALID', log, 'a call board on a cashier terminal', t('شاشة النداء تتبع شاشة مطبخ، لا جهاز كاشير'));
    let cd2 = devByCode('CD-2');
    if (!cd2) { const r = await api<any>(m, 'Device.Register', { body: { kind: 'CUSTOMER_DISPLAY', code: 'CD-2', name: 'شاشة العميل 2', terminalId: 't_cash2', display: { style: 'theme', branding: true } } }, log, 'customer display on cashier 2'); cd2 = dev(r.id); }
    S.cd2 = cd2.id;
    await expectRefusal(api(m, 'Device.Update', { params: { deviceId: cd2.id }, body: { expectedVersion: cd2.version + 3, display: { style: 'display' } } }), 'CONCURRENCY_CONFLICT', log, 'a stale version', t('تعديل على نسخة قديمة مرفوض'));
    await api(m, 'Device.Update', { params: { deviceId: cd2.id }, body: { expectedVersion: dev(cd2.id).version, display: { style: 'display', branding: false } } }, log, 'high contrast, no branding strip');
    const au = store.db.audit.find((a) => a.op === 'Device.Update' && a.target === cd2!.id);
    check(log, dev(cd2.id).display!.style === 'display' && !!au, `${dev(cd2.id).code}: ${dev(cd2.id).display!.style}; audit «${au?.summary}»`, t('إعدادات الشاشة محفوظة على الخادم ومسجلة في المراجعة، لا في متصفح الشاشة'));
  } },
  { id: 'J-V1-3', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const c = await as('t_cash2', 'demo-cashier-b', log);
    await expectRefusal(api(c, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'عرض', en: 'Offer' } } }), 'PERMISSION_DENIED', log, 'the cashier adds content', t('لا يضيف الكاشير محتوى للشاشات'));
    const p = (n: number) => String(n).padStart(2, '0');
    const h = zonedParts(clock.now()).hour; // the windows are branch local time (server clock)
    const inWin = { start: `${p(h)}:00`, end: `${p((h + 1) % 24)}:00` };
    const outWin = { start: `${p((h + 3) % 24)}:00`, end: `${p((h + 4) % 24)}:00` };
    const a = await api<any>(m, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'خصم الطلاب', en: 'Student discount' }, body: { ar: 'اعرض بطاقة الطالب', en: 'Show your student card' }, schedule: inWin } }, log, 'a message for this hour');
    const b = await api<any>(m, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'عشاء العائلة', en: 'Family dinner' }, schedule: outWin } }, log, 'a message for later today');
    S.now = a.id; S.later = b.id;
    const happy = devOf(store.db).content.find((x) => x.id === 'dc_happy');
    await api(m, 'Display.SetPlaylist', { params: { deviceId: S.cd2 }, body: { contentIds: [a.id, b.id, ...(happy ? [happy.id] : [])], expectedVersion: dev(S.cd2!).version } }, log, 'the playlist of cashier 2\'s display');
    const v = await api<any>(c, 'CustomerDisplay.View', { query: { displayId: S.cd2 } }, log, 'the display reads its screen');
    const ids = v.content.map((x: any) => x.id);
    const cd1 = dev('d_customer').display!.playlist;
    check(log, ids.includes(a.id) && !ids.includes(b.id) && !ids.some((x: string) => cd1.includes(x) && x !== happy?.id) && v.promos.length === 0 && v.display.style === 'display', `shows ${ids.join(', ')} (not ${b.id}); promotions ${v.promos.length}`, t('الشاشة تعرض محتواها هي فقط، وما كان في وقته فقط'));
    const k = await as('t_cash', 'demo-cashier-a', log);
    await expectRefusal(api(k, 'CustomerDisplay.View', { query: { displayId: S.cd2 } }), 'DISPLAY_NOT_ATTACHED', log, 'cashier 1 reads cashier 2\'s display', t('جهاز آخر لا يقرأ محتوى هذه الشاشة'));
    await expectRefusal(api(m, 'DisplayContent.Retire', { params: { contentId: a.id }, body: { reason: '', expectedVersion: 1 } }), 'REASON_REQUIRED', log, 'retire without a reason', t('إيقاف المحتوى بلا سبب مرفوض'));
    await api(m, 'DisplayContent.Retire', { params: { contentId: a.id }, body: { reason: 'انتهى العرض', expectedVersion: devOf(store.db).content.find((x) => x.id === a.id)!.version } }, log, 'retire with a reason');
    const v2 = await api<any>(c, 'CustomerDisplay.View', { query: { displayId: S.cd2 } }, log, 'the display again');
    const au = store.db.audit.find((x) => x.op === 'DisplayContent.Retire' && x.target === a.id);
    check(log, !v2.content.some((x: any) => x.id === a.id) && !dev(S.cd2!).display!.playlist.includes(a.id) && !!au?.summary.includes('انتهى العرض'), `retired: off the screen and the playlist; audit «${au?.summary}»`, t('المحتوى الموقوف خرج من الشاشة، والسبب مسجل في المراجعة'));
  } },
  { id: 'J-V1-4', device: 't_cash', user: 'demo-cashier-a', screen: 'prints', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    if (!openSession('t_cash')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } }, log, 'float 500.00');
    sim.set({ printers: { ...sim.get().printers, prn_cash: 'PAPER_OUT' } });
    log({ ok: null, text: 'simulator: PRN-CASH-1 paper out', plain: t('نفد الورق في طابعة الكاشير 1') });
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [{ productId: 'p_espresso', quantity: '1' }] } }, log, 'espresso');
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm');
    await api(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '100' }] } }, log, 'cash');
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'complete');
    const rcpt = () => store.db.printJobs.find((j) => j.documentId === o.id && j.documentType === 'RECEIPT')!;
    const kick = () => store.db.printJobs.find((j) => j.documentId === o.id && j.documentType === 'DRAWER_KICK')!;
    drain([rcpt().id, kick().id]);
    const m = await as('t_admin', 'demo-manager-1', log);
    const ds = await api<any>(m, 'Device.Get', { params: { deviceId: 'prn_cash' } }, log, 'the printer');
    const alert = store.db.alerts.find((a) => a.ref === 'dev-prn_cash-PAPER_OUT' && !a.ack);
    check(log, order(o.id).status === 'COMPLETED' && rcpt().state === 'FAILED' && rcpt().attempts.at(-1)?.error === 'PAPER_OUT' && ds.status === 'PAPER_OUT' && !!alert && kick().state === 'SUCCEEDED', `sale ${order(o.id).status}; receipt ${rcpt().state} (${rcpt().attempts.at(-1)?.error}); printer ${ds.status}; drawer ${kick().state}; alert ${!!alert}`, t('البيع اكتمل والدرج فُتح، والإيصال مهمة فاشلة ظاهرة مع تنبيه — لم يضع شيء'));
    sim.set({ printers: { ...sim.get().printers, prn_cash: 'UP' } });
    await api(c, 'PrintJob.Retry', { params: { printJobId: rcpt().id } }, log, 'paper changed: retry the same job');
    drain([rcpt().id]);
    check(log, rcpt().state === 'SUCCEEDED' && store.db.printJobs.filter((j) => j.documentId === o.id && j.documentType === 'RECEIPT').length === 1, `receipt ${rcpt().state} after ${rcpt().attempts.length} attempts — one job`, t('بعد تغيير الورق أُعيدت المهمة نفسها وطُبع الإيصال مرة واحدة'));
  } },
  { id: 'J-V1-5', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const p = dev('prn_floor');
    await expectRefusal(api(m, 'Device.SetEnabled', { params: { deviceId: p.id }, body: { enabled: false, reason: '', expectedVersion: p.version } }), 'REASON_REQUIRED', log, 'disable without a reason', t('إيقاف الطابعة بلا سبب مرفوض'));
    await api(m, 'Device.SetEnabled', { params: { deviceId: p.id }, body: { enabled: false, reason: 'الطابعة في الصيانة', expectedVersion: p.version } }, log, 'disable the floor printer');
    await expectRefusal(api(m, 'Device.TestPrint', { params: { deviceId: p.id } }), 'DEVICE_DISABLED', log, 'a test page on a disabled printer', t('لا تُطبع صفحة تجربة على طابعة متوقفة'));
    const w = await as('t_floor', 'demo-waiter-1', log);
    const takeOpen = store.db.orders.find((o) => o.terminalId === 't_floor' && (o.status === 'DRAFT' || o.status === 'CONFIRMED') && o.channel === 'DINE_IN');
    const target = takeOpen ?? store.db.orders.find((o) => (o.status === 'DRAFT' || o.status === 'CONFIRMED') && o.channel === 'DINE_IN');
    if (!target) { log({ ok: false, text: 'no open dine-in check', plain: t('لا يوجد شيك صالة مفتوح') }); return; }
    const j1 = await api<any>(w, 'Print.PreBill', { params: { orderId: target.id }, body: { terminalId: 't_floor' } }, log, 'pre-bill on the floor tablet');
    drain([j1.id]);
    const a1 = store.db.printJobs.find((j) => j.id === j1.id)!;
    check(log, a1.state === 'FAILED' && a1.attempts.at(-1)?.error === 'DEVICE_DISABLED', `pre-bill ${a1.state} (${a1.attempts.at(-1)?.error})`, t('الطابعة متوقفة: الشيك المبدئي مهمة فاشلة ظاهرة، لا تضيع'));
    await policyChange(log, 'PrintRoutingPolicy', { fallback: 'BRANCH_BACKUP' });
    const office = dev('prn_office');
    await api(m, 'Device.Update', { params: { deviceId: office.id }, body: { expectedVersion: office.version, printer: { backup: true } } }, log, 'the office printer is the backup');
    await api(m, 'PrintJob.Retry', { params: { printJobId: j1.id } }, log, 'retry the same pre-bill');
    drain([j1.id]);
    const a2 = store.db.printJobs.find((j) => j.id === j1.id)!;
    check(log, a2.state === 'SUCCEEDED' && a2.printerId === office.id, `pre-bill ${a2.state} on ${dev(a2.printerId!).code}`, t('مع الطابعة البديلة ذهب الشيك المبدئي إلى طابعة المكتب'));
    await policyChange(log, 'PrintRoutingPolicy', { fallback: 'NONE' });
    await api(m, 'Device.SetEnabled', { params: { deviceId: p.id }, body: { enabled: true, expectedVersion: dev(p.id).version } }, log, 'the floor printer is back');
    const t1 = await api<any>(m, 'Device.TestPrint', { params: { deviceId: p.id } }, log, 'test page');
    drain([t1.id]);
    check(log, store.db.printJobs.find((j) => j.id === t1.id)!.state === 'SUCCEEDED' && !!dev(p.id).lastSeenAt, `test page ${store.db.printJobs.find((j) => j.id === t1.id)!.state}`, t('صفحة التجربة طُبعت على الطابعة بعد تشغيلها'));
  } },
  { id: 'J-V1-6', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const k = dev('prn_kitchen');
    const bar = store.db.stations.find((s) => s.name === 'BAR' || s.id === 'st_bar') ?? store.db.stations[0];
    await api(m, 'Device.Update', { params: { deviceId: k.id }, body: { expectedVersion: k.version, printer: { roles: ['KITCHEN'], stationIds: [bar.id] } } }, log, 'the kitchen printer prints the bar');
    const c = await as('t_cash', 'demo-cashier-a', log);
    const o = await api<any>(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }, log, 'takeaway');
    const prod = store.db.products.find((p) => store.db.routingRules.some((r) => r.active && r.stationId === bar.id && r.match.categoryId === p.categoryId)) ?? store.db.products.find((p) => p.id === 'p_tea')!;
    const line: any = { productId: prod.id, quantity: '1' };
    if (prod.id === 'p_tea') line.modifierOptionIds = ['opt_size_regular'];
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version, lines: [line] } }, log, prod.name.en);
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: order(o.id).version } }, log, 'confirm (sent to the kitchen)');
    for (let i = 0; i < 3; i++) { for (const d of store.db.kitchenDeliveries) if (d.orderId === o.id && d.state === 'PENDING') d.nextAt = 0; runOutbox(); }
    const tk = store.db.tickets.filter((x) => x.orderId === o.id && x.stationId === bar.id).map((x) => x.id);
    const jobs = store.db.printJobs.filter((j) => j.documentType === 'KITCHEN_TICKET' && tk.includes(j.documentId));
    drain(jobs.map((j) => j.id));
    check(log, tk.length > 0 && jobs.length === tk.length && jobs.every((j) => j.printerId === k.id && store.db.printJobs.find((x) => x.id === j.id)!.state === 'SUCCEEDED'), `${tk.length} bar ticket(s) → ${jobs.length} kitchen job(s) on ${k.code}`, t('تذكرة البار وصلت الشاشة وطُبعت على طابعة المطبخ'));
    await api(m, 'Device.Update', { params: { deviceId: k.id }, body: { expectedVersion: dev(k.id).version, printer: { stationIds: [] } } }, log, 'back: no station');
  } },
  { id: 'J-V1-7', device: 't_cash', user: 'demo-cashier-a', screen: 'counter', run: async (log) => {
    const c = await as('t_cash', 'demo-cashier-a', log);
    const km = await api<any>(c, 'Terminal.KeyMap', { params: { terminalId: 't_cash' } }, log, 'the keys of cashier 1');
    await expectRefusal(api(c, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9' }, expectedVersion: km.version } }), 'KEYMAP_CHANGE_NOT_ALLOWED', log, 'the cashier changes a key', t('لا يغيّر الكاشير المفاتيح: يغيّرها المدير'));
    const m = await as('t_cash', 'demo-manager-1', log);
    const r = await api<any>(m, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9' }, expectedVersion: km.version } }, log, 'the manager sets pay = F9');
    await expectRefusal(api(m, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9', hold: 'F9' }, expectedVersion: r.version } }), 'VALIDATION_FAILED', log, 'two actions on one key', t('مفتاح واحد لا يأخذ أمرين'));
    const back = await api<any>(c, 'Terminal.KeyMap', { params: { terminalId: 't_cash' } }, log, 'read again');
    check(log, back.sale.pay === 'F9' && back.canChange === false, `sale keys ${JSON.stringify(back.sale)}; cashier canChange ${back.canChange}`, t('مفاتيح الجهاز محفوظة على الخادم وتظهر على أي متصفح للجهاز'));
    await api(m, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: {}, expectedVersion: back.version } }, log, 'back to the profile\'s keys');
  } },
  { id: 'J-V1-8', device: 't_admin', user: 'demo-manager-1', screen: 'devices', run: async (log) => {
    const m = await as('t_admin', 'demo-manager-1', log);
    const d = dev(S.cd2 ?? 'd_customer');
    await api(m, 'Device.SetEnabled', { params: { deviceId: d.id }, body: { enabled: false, reason: 'الشاشة تُنقل إلى مكان آخر', expectedVersion: d.version } }, log, 'disable the display');
    const host = d.terminalId === 't_cash2' ? await as('t_cash2', 'demo-cashier-b', log) : await as('t_cash', 'demo-cashier-a', log);
    const v = await api<any>(host, 'CustomerDisplay.View', { query: { displayId: d.id } }, log, 'the display');
    check(log, v.display.enabled === false && v.content.length === 0 && !v.order, `disabled display: content ${v.content.length}, order ${v.order}`, t('الشاشة الموقوفة لا تعرض شيئًا'));
    await api(m, 'Device.SetEnabled', { params: { deviceId: d.id }, body: { enabled: true, expectedVersion: dev(d.id).version } }, log, 'enable it again');
    const n = store.db.audit.filter((a) => ['Device.Register', 'Device.Update', 'Device.SetEnabled', 'Display.SetPlaylist', 'DisplayContent.Upsert', 'DisplayContent.Retire', 'Device.TestPrint', 'Terminal.SetKeyMap'].includes(a.op)).length;
    check(log, n >= 10, `${n} audited device changes`, t('كل تغيير في الأجهزة والمحتوى مسجل في المراجعة'));
  } },
];

export const DEVICES_JOURNEY = {
  id: 'J-V1', title: 'الأجهزة والطابعات وشاشات العرض', titleEn: 'Devices, printers and displays', reset: null,
  intro: 'تسجيل شاشة عميل وضبطها، محتوى في وقته لشاشته فقط، نفاد الورق أثناء البيع وإعادة المهمة نفسها، الطابعة البديلة، طابعة المطبخ، ومفاتيح الجهاز على الخادم.',
  steps: V1,
};
