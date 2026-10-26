// Turns automation steps into plain sentences for the demo user
// ("✓ منى فتحت الوردية بـ 500 جنيه في الدرج", "✓ أحمد وافق على إلغاء صنف اتبعت").
// Used by runner.ts: every log line keeps its technical text (shown inside <Tech>) and gets a `plain` sentence.
import { store } from '../mock/store';
import { APPROVAL_ACTIONS } from '../mock/policyRegistry';
import { personName, deviceName, verb, roleLabel } from './people';
import { getLang, t, tv, L } from '../i18n';

// Sentences follow the UI language at the moment the step runs (Arabic DONE map, English DONE_EN map).
const isEn = () => getLang() === 'en';

export interface Actor { username: string | null; name: string }
const STATION_AR: Record<string, string> = { GRILL: 'المشويات', COLD: 'البارد', BAR: 'البار', PASTRY: 'الحلواني', 'DESSERT BAR': 'بار الحلويات' };
const STATION_EN: Record<string, string> = { GRILL: 'Grill', COLD: 'Cold', BAR: 'Bar', PASTRY: 'Pastry', 'DESSERT BAR': 'Dessert bar' };
export const stationName = (n: string | undefined | null) => (n ? (isEn() ? STATION_EN[n] ?? tv(STATION_AR[n] ?? n) : STATION_AR[n] ?? n) : '');
const CHANNEL_AR: Record<string, string> = { DINE_IN: 'الصالة', TAKEAWAY: 'التيك أواي', DELIVERY: 'الدليفري' };
const REPORT_AR: Record<string, string> = { daily_sales: 'تقرير مبيعات اليوم', tenders: 'تقرير طرق الدفع', product_mix: 'تقرير الأصناف', voids: 'تقرير الإلغاءات' };
const KIND_AR: Record<string, string> = { CASH: 'كاشير بدرج', FLOOR: 'تابلت ويتر', KDS: 'شاشة مطبخ', ADMIN: 'كمبيوتر إدارة' };

export function actorOf(token: string | null | undefined): Actor {
  const s = token ? store.db.authSessions.find((x) => x.id === token) : null;
  const u = s ? store.db.users.find((x) => x.id === s.userId) : null;
  return { username: u?.username ?? null, name: personName(u?.username, u?.displayName) || (isEn() ? 'Someone' : 'حد') };
}
export const actorByUsername = (username: string): Actor => { const u = store.db.users.find((x) => x.username === username); return { username, name: personName(username, u?.displayName) }; };
export const actorById = (id: string): Actor => { const u = store.db.users.find((x) => x.id === id); return { username: u?.username ?? null, name: personName(u?.username, u?.displayName) }; };

/** "500.00" → "500 جنيه" */
export function egp(v: unknown): string {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return String(v ?? '');
  return `${Number.isInteger(n) ? n : n.toFixed(2)} ${isEn() ? 'EGP' : 'جنيه'}`;
}
const tableName = (id: string | undefined) => store.db.tables.find((x) => x.id === id)?.name ?? id ?? '';
const productName = (id: string | undefined) => { const p = store.db.products.find((x) => x.id === id); return p ? L(p.name as any) || String(p.name) : id ?? ''; };
const lineProduct = (orderId: string | undefined, lineId: string | undefined) => { const o = store.db.orders.find((x) => x.id === orderId); const l = o?.lines.find((x) => x.id === lineId); return l ? productName(l.productId) : isEn() ? 'the item' : 'الصنف'; };
const qty = (q: unknown) => { const n = Number(q ?? 1); return n === 1 ? '' : ` ×${n}`; };
const linesText = (lines: any[] | undefined) => (lines ?? []).map((l) => `${productName(l.productId)}${qty(l.quantity)}`).join(isEn() ? ', ' : '، ');
const v = (a: Actor, m: string, f: string) => verb(a.username, m, f);
const count = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);
export const actionTitle = (id: string) => { const ar = APPROVAL_ACTIONS.find((x) => x.id === id)?.title; return ar ? t(ar) : isEn() ? 'the action' : 'الحركة'; };

type Fn = (a: Actor, body: any, data: any, params: any, query: any) => string;
const DONE: Record<string, Fn> = {
  'Auth.Login': (a) => `${a.name} ${v(a, 'دخل', 'دخلت')} على الجهاز`,
  'Auth.Logout': (a) => `${a.name} ${v(a, 'خرج', 'خرجت')} من الجهاز`,
  'Access.Me': (a) => `${a.name} ${v(a, 'شاف', 'شافت')} في أعلى الشاشة ${v(a, 'اسمه', 'اسمها')} والفرع والجهاز`,
  'Health.Live': () => 'اتأكدنا إن السيستم شغال',
  'Platform.BuildInfo': () => 'اتأكدنا من نسخة السيستم',
  'Business.Configure': (a, b) => `${a.name} ${v(a, 'كتب', 'كتبت')} اسم المطعم: ${b?.nameAr ?? b?.name ?? ''}`,
  'Branch.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} الفرع (توقيت القاهرة، واليوم بيبدأ ${b?.businessDayCutoff === '04:00' ? '4 الفجر' : b?.businessDayCutoff ?? ''})`,
  'Terminal.Register': (a, b) => `${a.name} ${v(a, 'سجّل', 'سجّلت')} جهاز: ${KIND_AR[b?.kind] ?? b?.kind}`,
  'Role.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} دور «${roleLabel(b?.name)}»`,
  'User.Create': (a, b) => `${a.name} ${v(a, 'ضاف', 'ضافت')} ${b?.displayName ?? b?.username}`,
  'User.ManageAccess': (a, b, _d, p) => { const u = actorById(p?.userId); return b?.active === false ? `${a.name} ${v(a, 'وقّف', 'وقّفت')} حساب ${u.name}` : `${a.name} ${v(a, 'عدّل', 'عدّلت')} صلاحيات ${u.name}`; },
  'TaxPolicy.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} ضريبة القيمة المضافة ${b?.rate ?? ''}%`,
  'ReasonCode.Create': (a, b) => `${a.name} ${v(a, 'ضاف', 'ضافت')} سبب «${b?.label?.ar ?? b?.code}»`,
  'Catalog.Import': (a, b, d) => (b?.dryRun ? `${a.name} ${v(a, 'جرّب', 'جرّبت')} استيراد شيت المنيو من غير حفظ${d?.issues?.length ? ` — لقى ${d.issues.length} غلطة` : ' — مفيش أخطاء'}` : `${a.name} ${v(a, 'استورد', 'استوردت')} المنيو كله مرة واحدة`),
  'Category.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} قسم «${b?.name?.ar ?? ''}»`,
  'Category.List': (a) => `${a.name} ${v(a, 'فتح', 'فتحت')} المنيو`,
  'Product.Create': (a, b, d) => `${a.name} ${v(a, 'ضاف', 'ضافت')} صنف «${b?.name?.ar ?? ''}»${d?.sku ? ' (الكود اتعمل أوتوماتيك)' : ''}`,
  'Catalog.SetPrice': (a, b, _d, p) => `${a.name} ${v(a, 'حط', 'حطت')} سعر ${productName(p?.productId)} في ${CHANNEL_AR[b?.channel] ?? ''}: ${egp(b?.amount)}`,
  'Product.SetAvailability': (a, _b, _d, p) => `${a.name} ${v(a, 'خلّى', 'خلّت')} ${productName(p?.productId)} متاح للبيع`,
  'Pricing.QuoteItem': (a, _b, d, p) => `${a.name} ${v(a, 'شاف', 'شافت')} سعر ${productName(p?.productId)}: ${egp(d?.unitTotal)} (من السيرفر)`,
  'Table.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} ترابيزة ${b?.name}${b?.capacity ? ` (${b.capacity} كراسي)` : ''}`,
  'Table.Configure': (a, b) => `${a.name} ${v(a, 'غيّر', 'غيّرت')} ترابيزة ${b?.name}: بقت ${b?.capacity} كراسي`,
  'Table.SetActive': (a, b, _d, p) => (b?.active ? `${a.name} ${v(a, 'رجّع', 'رجّعت')} ترابيزة ${tableName(p?.tableId)}` : `${a.name} ${v(a, 'وقّف', 'وقّفت')} ترابيزة ${tableName(p?.tableId)} (مش هتظهر في الصالة)`),
  'KitchenStation.Create': (a, b) => `${a.name} ${v(a, 'عمل', 'عملت')} محطة مطبخ «${stationName(b?.name)}»`,
  'KitchenStation.Configure': (a, b) => `${a.name} ${v(a, 'غيّر', 'غيّرت')} اسم المحطة لـ «${stationName(b?.name)}»`,
  'RoutingRule.Create': (a, b) => { const st = store.db.stations.find((x) => x.id === b?.stationId)?.name; const what = b?.match?.productId ? productName(b.match.productId) : b?.match?.categoryId ? `قسم ${(store.db.categories.find((c) => c.id === b.match.categoryId)?.name as any)?.ar ?? ''}` : 'أي حاجة تانية'; return `${a.name} ${v(a, 'خلّى', 'خلّت')} ${what} يروح محطة ${stationName(st)}`; },
  'RoutingRule.Configure': (a, b, _d, p) => { const r = store.db.routingRules.find((x) => x.id === p?.ruleId); const what = r?.match?.productId ? productName(r.match.productId) : 'القاعدة'; return `${a.name} ${v(a, 'غيّر', 'غيّرت')} ترتيب قاعدة ${what} (بقت رقم ${b?.priority})`; },
  'TableVisit.Open': (a, b, _d, p) => `${a.name} ${v(a, 'فتح', 'فتحت')} ترابيزة ${tableName(p?.tableId)} لـ ${b?.guestCount ?? ''} أفراد`,
  'TableVisit.Close': (a) => `${a.name} ${v(a, 'قفل', 'قفلت')} الترابيزة وبقت فاضية`,
  'TableVisit.Transfer': (a, b) => `${a.name} ${v(a, 'نقل', 'نقلت')} الزباين لترابيزة ${tableName(b?.toTableId)}`,
  'Order.Create': (a, b) => (b?.channel === 'TAKEAWAY' ? `${a.name} ${v(a, 'بدأ', 'بدأت')} طلب تيك أواي جديد` : `${a.name} ${v(a, 'فتح', 'فتحت')} شيك جديد على ترابيزة ${tableName(b?.tableId)}`),
  'Order.AddLines': (a, b) => `${a.name} ${v(a, 'ضاف', 'ضافت')} ${linesText(b?.lines)}`,
  'Order.UpdateLine': (a, b, _d, p) => `${a.name} ${v(a, 'غيّر', 'غيّرت')} كمية ${lineProduct(p?.orderId, p?.lineId)} لـ ${Number(b?.quantity)}`,
  'Order.RemoveLine': (a, _b, _d, p) => `${a.name} ${v(a, 'شال', 'شالت')} ${lineProduct(p?.orderId, p?.lineId)} (لسه ما كانش اتبعت)`,
  'Order.Fire': (a, _b, d) => `${a.name} ${v(a, 'بعت', 'بعتت')} الطلب للمطبخ${d?.fireRound ? ` (الدفعة رقم ${d.fireRound})` : ''}`,
  'Order.Confirm': (a, _b, d) => `${a.name} ${v(a, 'أكّد', 'أكّدت')} الشيك${d?.totals?.payable ? ` — المطلوب ${egp(d.totals.payable)}` : ''}`,
  'Order.Complete': (a) => `${a.name} ${v(a, 'قفل', 'قفلت')} الشيك (خلص)`,
  'Order.VoidLine': (a, _b, _d, p) => `${a.name} ${v(a, 'لغى', 'لغت')} «${lineProduct(p?.orderId, p?.lineId)}» من الشيك`,
  'Order.Void': (a) => `${a.name} ${v(a, 'لغى', 'لغت')} الشيك كله`,
  'Order.MoveLines': (a, b) => `${a.name} ${v(a, 'نقل', 'نقلت')} ${count(b?.lineIds?.length ?? 0, 'صنف', 'صنفين', 'أصناف')} للشيك التاني`,
  'Payment.Capture': (a, b, d) => {
    const parts = (b?.tenders ?? []).map((x: any) => (x.method === 'CASH' ? `كاش ${egp(x.tendered ?? x.amount)}` : x.method === 'CARD' ? `كارت ${egp(x.amount)}` : `محفظة ${egp(x.amount)}`));
    const change = d?.change && Number(d.change) > 0 ? ` — الباقي للزبون ${egp(d.change)}` : '';
    return `${a.name} ${v(a, 'حصّل', 'حصّلت')} ${parts.join(' + ')}${change}`;
  },
  'Payment.GetSettlement': (a, _b, d) => `${a.name} ${v(a, 'شاف', 'شافت')} المتبقي على الشيك: ${egp(d?.remaining)}`,
  'Session.Open': (a, b) => `${a.name} ${v(a, 'فتح', 'فتحت')} الوردية بـ ${egp(b?.openingFloat)} في الدرج`,
  'Session.Close': (a, b, d) => `${a.name} ${v(a, 'قفل', 'قفلت')} الوردية — عدّ الدرج ${egp(b?.countedCash)}${d?.variance !== undefined ? (Number(d.variance) === 0 ? ' والفرق صفر' : ` والفرق ${egp(d.variance)}`) : ''}`,
  'Session.XReport': (a) => `${a.name} ${v(a, 'فتح', 'فتحت')} تقرير نص الوردية (X)`,
  'Session.ZReport': (a) => `${a.name} ${v(a, 'فتح', 'فتحت')} تقرير قفلة الوردية (Z)`,
  'Session.Current': (a) => `${a.name} ${v(a, 'شاف', 'شافت')} الوردية الحالية`,
  'Kitchen.Board': (a, _b, d, _p, q) => `${a.name} ${v(a, 'فتح', 'فتحت')} شاشة محطة ${stationName(store.db.stations.find((x) => x.id === q?.stationId)?.name)}${d?.items ? ` — ${d.items.length ? `فيها ${count(d.items.length, 'طلب واحد', 'طلبين', 'طلبات')}` : 'مفيهاش طلبات'}` : ''}`,
  'Kitchen.AdvanceTicket': (a, b) => (b?.toState === 'IN_PROGRESS' ? `${a.name} ${v(a, 'بدأ', 'بدأت')} يحضّر الطلب` : b?.toState === 'READY' ? `${a.name} ${v(a, 'خلّص', 'خلّصت')} الطلب` : `${a.name} ${v(a, 'حرّك', 'حرّكت')} الطلب`),
  'Kitchen.Resend': (a) => `${a.name} ${v(a, 'عاد', 'عادت')} إرسال الطلب للمطبخ`,
  'Refund.Refundable': (a) => `${a.name} ${v(a, 'فتح', 'فتحت')} شاشة المرتجع للشيك`,
  'Refund.Request': (a, b) => `${a.name} ${v(a, 'طلب', 'طلبت')} مرتجع ${egp(b?.amount)} ${b?.method === 'CASH' ? 'كاش' : ''}`,
  'Refund.Approve': () => 'المرتجع اتعمد والفلوس طلعت من الدرج',
  'Approval.Grant': (_a, b) => { const ap = actorById(b?.approverUserId); return `${ap.name} ${verb(ap.username, 'وافق', 'وافقت')} على «${actionTitle(b?.action)}» بالرقم السري`; },
  'Receipt.Get': (a) => `${a.name} ${v(a, 'فتح', 'فتحت')} الإيصال`,
  'Print.Reprint': (a) => `${a.name} ${v(a, 'طبع', 'طبعت')} نسخة من الإيصال (مكتوب عليها «نسخة»)`,
  'Print.Document': (a) => `${a.name} ${v(a, 'طبع', 'طبعت')} صفحة تجربة على طابعة الكاشير`,
  'Report.Run': (a, _b, _d, p) => `${a.name} ${v(a, 'فتح', 'فتحت')} ${REPORT_AR[p?.reportId] ?? 'تقرير'}`,
  'FiscalProfile.Configure': (a) => `${a.name} ${v(a, 'سجّل', 'سجّلت')} بيانات المطعم في الإيصال الإلكتروني (بيئة تجربة)`,
  'FiscalDevice.Register': (a) => `${a.name} ${v(a, 'سجّل', 'سجّلت')} جهاز الكاشير في منظومة الإيصال الإلكتروني`,
  'FiscalItemMapping.SetMany': (a, b) => `${a.name} ${v(a, 'ربط', 'ربطت')} ${count(b?.rows?.length ?? 0, 'صنف', 'صنفين', 'أصناف')} بأكواد الضرايب`,
};

const REPORT_EN: Record<string, string> = { daily_sales: 'the daily sales report', tenders: 'the payment methods report', product_mix: 'the items report', voids: 'the voids report' };
const KIND_EN: Record<string, string> = { CASH: 'cashier with a drawer', FLOOR: 'waiter tablet', KDS: 'kitchen screen', ADMIN: 'office computer' };
const CHANNEL_EN: Record<string, string> = { DINE_IN: 'dine-in', TAKEAWAY: 'takeaway', DELIVERY: 'delivery' };
const countEn = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const catName = (id: string | undefined) => L(store.db.categories.find((c) => c.id === id)?.name as any);
const DONE_EN: Record<string, Fn> = {
  'Auth.Login': (a) => `${a.name} signed in on the device`,
  'Auth.Logout': (a) => `${a.name} signed out of the device`,
  'Access.Me': (a) => `${a.name} saw their name, branch and device at the top of the screen`,
  'Health.Live': () => 'We checked the system is running',
  'Platform.BuildInfo': () => 'We checked the system version',
  'Business.Configure': (a, b) => `${a.name} wrote the restaurant name: ${b?.name ?? b?.nameAr ?? ''}`,
  'Branch.Create': (a, b) => `${a.name} created the branch (Cairo time, the day starts at ${b?.businessDayCutoff === '04:00' ? '4 AM' : b?.businessDayCutoff ?? ''})`,
  'Terminal.Register': (a, b) => `${a.name} registered a device: ${KIND_EN[b?.kind] ?? b?.kind}`,
  'Role.Create': (a, b) => `${a.name} created the role «${roleLabel(b?.name)}»`,
  'User.Create': (a, b) => `${a.name} added ${personName(b?.username, b?.displayName)}`,
  'User.ManageAccess': (a, b, _d, p) => { const u = actorById(p?.userId); return b?.active === false ? `${a.name} deactivated ${u.name}'s account` : `${a.name} changed ${u.name}'s permissions`; },
  'TaxPolicy.Create': (a, b) => `${a.name} created VAT ${b?.rate ?? ''}%`,
  'ReasonCode.Create': (a, b) => `${a.name} added the reason «${b?.label?.en ?? b?.label?.ar ?? b?.code}»`,
  'Catalog.Import': (a, b, d) => (b?.dryRun ? `${a.name} tried importing the menu sheet without saving${d?.issues?.length ? ` — found ${d.issues.length} mistakes` : ' — no mistakes'}` : `${a.name} imported the whole menu at once`),
  'Category.Create': (a, b) => `${a.name} created the category «${b?.name?.en ?? b?.name?.ar ?? ''}»`,
  'Category.List': (a) => `${a.name} opened the menu`,
  'Product.Create': (a, b, d) => `${a.name} added the item «${b?.name?.en ?? b?.name?.ar ?? ''}»${d?.sku ? ' (the code was generated automatically)' : ''}`,
  'Catalog.SetPrice': (a, b, _d, p) => `${a.name} set the ${CHANNEL_EN[b?.channel] ?? ''} price of ${productName(p?.productId)}: ${egp(b?.amount)}`,
  'Product.SetAvailability': (a, _b, _d, p) => `${a.name} made ${productName(p?.productId)} available for sale`,
  'Pricing.QuoteItem': (a, _b, d, p) => `${a.name} saw the price of ${productName(p?.productId)}: ${egp(d?.unitTotal)} (from the server)`,
  'Table.Create': (a, b) => `${a.name} created table ${b?.name}${b?.capacity ? ` (${b.capacity} seats)` : ''}`,
  'Table.Configure': (a, b) => `${a.name} changed table ${b?.name}: now ${b?.capacity} seats`,
  'Table.SetActive': (a, b, _d, p) => (b?.active ? `${a.name} brought back table ${tableName(p?.tableId)}` : `${a.name} turned off table ${tableName(p?.tableId)} (it will not show on the floor)`),
  'KitchenStation.Create': (a, b) => `${a.name} created the kitchen station «${stationName(b?.name)}»`,
  'KitchenStation.Configure': (a, b) => `${a.name} renamed the station to «${stationName(b?.name)}»`,
  'RoutingRule.Create': (a, b) => { const st = store.db.stations.find((x) => x.id === b?.stationId)?.name; const what = b?.match?.productId ? productName(b.match.productId) : b?.match?.categoryId ? `the ${catName(b.match.categoryId)} category` : 'anything else'; return `${a.name} sent ${what} to the ${stationName(st)} station`; },
  'RoutingRule.Configure': (a, b, _d, p) => { const r = store.db.routingRules.find((x) => x.id === p?.ruleId); const what = r?.match?.productId ? productName(r.match.productId) : 'the rule'; return `${a.name} changed the order of the ${what} rule (now number ${b?.priority})`; },
  'TableVisit.Open': (a, b, _d, p) => `${a.name} opened table ${tableName(p?.tableId)} for ${b?.guestCount ?? ''} guests`,
  'TableVisit.Close': (a) => `${a.name} closed the table and it is free`,
  'TableVisit.Transfer': (a, b) => `${a.name} moved the guests to table ${tableName(b?.toTableId)}`,
  'Order.Create': (a, b) => (b?.channel === 'TAKEAWAY' ? `${a.name} started a new takeaway order` : `${a.name} opened a new check on table ${tableName(b?.tableId)}`),
  'Order.AddLines': (a, b) => `${a.name} added ${linesText(b?.lines)}`,
  'Order.UpdateLine': (a, b, _d, p) => `${a.name} changed the quantity of ${lineProduct(p?.orderId, p?.lineId)} to ${Number(b?.quantity)}`,
  'Order.RemoveLine': (a, _b, _d, p) => `${a.name} removed ${lineProduct(p?.orderId, p?.lineId)} (it had not been sent yet)`,
  'Order.Fire': (a, _b, d) => `${a.name} sent the order to the kitchen${d?.fireRound ? ` (round ${d.fireRound})` : ''}`,
  'Order.Confirm': (a, _b, d) => `${a.name} confirmed the check${d?.totals?.payable ? ` — due ${egp(d.totals.payable)}` : ''}`,
  'Order.Complete': (a) => `${a.name} closed the check (finished)`,
  'Order.VoidLine': (a, _b, _d, p) => `${a.name} voided «${lineProduct(p?.orderId, p?.lineId)}» from the check`,
  'Order.Void': (a) => `${a.name} voided the whole check`,
  'Order.MoveLines': (a, b) => `${a.name} moved ${countEn(b?.lineIds?.length ?? 0, 'item', 'items')} to the other check`,
  'Payment.Capture': (a, b, d) => {
    const parts = (b?.tenders ?? []).map((x: any) => (x.method === 'CASH' ? `cash ${egp(x.tendered ?? x.amount)}` : x.method === 'CARD' ? `card ${egp(x.amount)}` : `wallet ${egp(x.amount)}`));
    const change = d?.change && Number(d.change) > 0 ? ` — change for the guest ${egp(d.change)}` : '';
    return `${a.name} collected ${parts.join(' + ')}${change}`;
  },
  'Payment.GetSettlement': (a, _b, d) => `${a.name} saw what is left on the check: ${egp(d?.remaining)}`,
  'Session.Open': (a, b) => `${a.name} opened the shift with ${egp(b?.openingFloat)} in the drawer`,
  'Session.Close': (a, b, d) => `${a.name} closed the shift — counted ${egp(b?.countedCash)} in the drawer${d?.variance !== undefined ? (Number(d.variance) === 0 ? ' with zero difference' : ` with a difference of ${egp(d.variance)}`) : ''}`,
  'Session.XReport': (a) => `${a.name} opened the mid-shift report (X)`,
  'Session.ZReport': (a) => `${a.name} opened the end-of-shift report (Z)`,
  'Session.Current': (a) => `${a.name} looked at the current shift`,
  'Kitchen.Board': (a, _b, d, _p, q) => `${a.name} opened the ${stationName(store.db.stations.find((x) => x.id === q?.stationId)?.name)} station screen${d?.items ? ` — ${d.items.length ? `with ${countEn(d.items.length, 'order', 'orders')}` : 'no orders'}` : ''}`,
  'Kitchen.AdvanceTicket': (a, b) => (b?.toState === 'IN_PROGRESS' ? `${a.name} started preparing the order` : b?.toState === 'READY' ? `${a.name} finished the order` : `${a.name} moved the order`),
  'Kitchen.Resend': (a) => `${a.name} resent the order to the kitchen`,
  'Refund.Refundable': (a) => `${a.name} opened the refund screen for the check`,
  'Refund.Request': (a, b) => `${a.name} requested a ${b?.method === 'CASH' ? 'cash ' : ''}refund of ${egp(b?.amount)}`,
  'Refund.Approve': () => 'The refund was approved and the money left the drawer',
  'Approval.Grant': (_a, b) => { const ap = actorById(b?.approverUserId); return `${ap.name} approved «${actionTitle(b?.action)}» with their PIN`; },
  'Receipt.Get': (a) => `${a.name} opened the receipt`,
  'Print.Reprint': (a) => `${a.name} printed a copy of the receipt (marked «copy»)`,
  'Print.Document': (a) => `${a.name} printed a test page on the cashier printer`,
  'Report.Run': (a, _b, _d, p) => `${a.name} opened ${REPORT_EN[p?.reportId] ?? 'a report'}`,
  'FiscalProfile.Configure': (a) => `${a.name} registered the restaurant details for e-receipts (test environment)`,
  'FiscalDevice.Register': (a) => `${a.name} registered the cashier device on the e-receipt platform`,
  'FiscalItemMapping.SetMany': (a, b) => `${a.name} linked ${countEn(b?.rows?.length ?? 0, 'item', 'items')} to tax codes`,
};

/** Past-tense sentence for a successful call (in the UI language). */
export function doneText(opId: string, actor: Actor, opts: { body?: any; params?: any; query?: any }, data?: any): string {
  const f = (isEn() ? DONE_EN : DONE)[opId];
  try { if (f) return f(actor, opts.body ?? {}, data ?? {}, opts.params ?? {}, opts.query ?? {}); } catch { /* fall through */ }
  return isEn() ? `${actor.name} did a step in the system` : `${actor.name} ${verb(actor.username, 'عمل', 'عملت')} خطوة في السيستم`;
}
export const loginText = (username: string, deviceId: string) => { const a = actorByUsername(username); const term = store.db.terminals.find((x) => x.id === deviceId); return isEn() ? `${a.name} signed in on the ${deviceName(deviceId, term?.kind, term?.name)}` : `${a.name} ${verb(username, 'دخل', 'دخلت')} على ${deviceName(deviceId, term?.kind, term?.name)}`; };
export const approvalAskText = (action: string, deviceId: string) => { const dev = deviceName(deviceId, store.db.terminals.find((x) => x.id === deviceId)?.kind); return isEn() ? `«${actionTitle(action)}» needs a manager approval — the approval screen appeared on the ${dev}` : `«${actionTitle(action)}» محتاج موافقة مدير — شاشة الموافقة ظهرت على ${dev}`; };
