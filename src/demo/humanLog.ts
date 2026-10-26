// Turns automation steps into plain sentences for the demo user
// ("✓ منى فتحت الوردية بـ 500 جنيه في الدرج", "✓ أحمد وافق على إلغاء صنف اتبعت").
// Used by runner.ts: every log line keeps its technical text (shown inside <Tech>) and gets a `plain` sentence.
import { store } from '../mock/store';
import { APPROVAL_ACTIONS } from '../mock/policyRegistry';
import { personName, deviceName, verb, roleLabel } from './people';

export interface Actor { username: string | null; name: string }
const STATION_AR: Record<string, string> = { GRILL: 'المشويات', COLD: 'البارد', BAR: 'البار', PASTRY: 'الحلواني', 'DESSERT BAR': 'بار الحلويات' };
export const stationName = (n: string | undefined | null) => (n ? STATION_AR[n] ?? n : '');
const CHANNEL_AR: Record<string, string> = { DINE_IN: 'الصالة', TAKEAWAY: 'التيك أواي', DELIVERY: 'الدليفري' };
const REPORT_AR: Record<string, string> = { daily_sales: 'تقرير مبيعات اليوم', tenders: 'تقرير طرق الدفع', product_mix: 'تقرير الأصناف', voids: 'تقرير الإلغاءات' };
const KIND_AR: Record<string, string> = { CASH: 'كاشير بدرج', FLOOR: 'تابلت ويتر', KDS: 'شاشة مطبخ', ADMIN: 'كمبيوتر إدارة' };

export function actorOf(token: string | null | undefined): Actor {
  const s = token ? store.db.authSessions.find((x) => x.id === token) : null;
  const u = s ? store.db.users.find((x) => x.id === s.userId) : null;
  return { username: u?.username ?? null, name: personName(u?.username, u?.displayName) || 'حد' };
}
export const actorByUsername = (username: string): Actor => { const u = store.db.users.find((x) => x.username === username); return { username, name: personName(username, u?.displayName) }; };
export const actorById = (id: string): Actor => { const u = store.db.users.find((x) => x.id === id); return { username: u?.username ?? null, name: personName(u?.username, u?.displayName) }; };

/** "500.00" → "500 جنيه" */
export function egp(v: unknown): string {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return String(v ?? '');
  return `${Number.isInteger(n) ? n : n.toFixed(2)} جنيه`;
}
const tableName = (id: string | undefined) => store.db.tables.find((x) => x.id === id)?.name ?? id ?? '';
const productName = (id: string | undefined) => { const p = store.db.products.find((x) => x.id === id); return p ? (p.name as any)?.ar ?? (p.name as any)?.en ?? String(p.name) : id ?? ''; };
const lineProduct = (orderId: string | undefined, lineId: string | undefined) => { const o = store.db.orders.find((x) => x.id === orderId); const l = o?.lines.find((x) => x.id === lineId); return l ? productName(l.productId) : 'الصنف'; };
const qty = (q: unknown) => { const n = Number(q ?? 1); return n === 1 ? '' : ` ×${n}`; };
const linesText = (lines: any[] | undefined) => (lines ?? []).map((l) => `${productName(l.productId)}${qty(l.quantity)}`).join('، ');
const v = (a: Actor, m: string, f: string) => verb(a.username, m, f);
const count = (n: number, one: string, two: string, many: string) => (n === 1 ? one : n === 2 ? two : `${n} ${many}`);
export const actionTitle = (id: string) => APPROVAL_ACTIONS.find((x) => x.id === id)?.title ?? 'الحركة';

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

/** Past-tense sentence for a successful call. */
export function doneText(opId: string, actor: Actor, opts: { body?: any; params?: any; query?: any }, data?: any): string {
  const f = DONE[opId];
  try { if (f) return f(actor, opts.body ?? {}, data ?? {}, opts.params ?? {}, opts.query ?? {}); } catch { /* fall through */ }
  return `${actor.name} ${verb(actor.username, 'عمل', 'عملت')} خطوة في السيستم`;
}
export const loginText = (username: string, deviceId: string) => { const a = actorByUsername(username); const term = store.db.terminals.find((x) => x.id === deviceId); return `${a.name} ${verb(username, 'دخل', 'دخلت')} على ${deviceName(deviceId, term?.kind, term?.name)}`; };
export const approvalAskText = (action: string, deviceId: string) => `«${actionTitle(action)}» محتاج موافقة مدير — شاشة الموافقة ظهرت على ${deviceName(deviceId, store.db.terminals.find((x) => x.id === deviceId)?.kind)}`;
