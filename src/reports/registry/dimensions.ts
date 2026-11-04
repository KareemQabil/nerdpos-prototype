// L1 dimension registry. Source: research 04_DIMENSION_REGISTRY.csv (31 rows) + DESIGN Principle 1 (reversal stage,
// disposition) + kitchen station. A dimension the mock has no source for is listed with NOT_AVAILABLE and a reason.
import type { DimensionDef } from '../types';

const d = (id: string, ar: string, en: string, type: string, descAr: string, descEn: string, source: string, priority: DimensionDef['priority'], warnAr: string, warnEn: string, extra: Partial<DimensionDef> = {}): DimensionDef => ({
  id, label: { ar, en }, type, description: { ar: descAr, en: descEn }, source, priority, warning: { ar: warnAr, en: warnEn }, status: 'AVAILABLE', ...extra,
});
const NA = (ar: string, en: string) => ({ status: 'NOT_AVAILABLE' as const, reason: { ar, en } });
const MGR = 'session:zreport';

export const DIMENSIONS: DimensionDef[] = [
  d('business_date', 'اليوم التجاري', 'Business date', 'time', 'يبدأ اليوم الساعة 4 فجرًا بتوقيت القاهرة وينتهي 4 فجر اليوم التالي.', 'Starts 04:00 Africa/Cairo, ends 04:00 next day.', 'BusinessDatePolicy (server)', 'MUST', 'يُحتسب المرتجع يوم صرفه، لا يوم الشيك الأصلي.', 'Refunds count on their payout date.'),
  d('business_week', 'الأسبوع التجاري', 'Business week', 'time', 'الأيام التجارية مجمّعة من أول يوم في الأسبوع (السبت افتراضيًا).', 'Business dates grouped from the configured week start (Saturday by default).', 'reporting calendar', 'MUST', 'إن لم يتضح الأسبوع المقصود، نسأل عن أول يوم فيه.', 'Ask the week start when vague.'),
  d('weekday', 'يوم الأسبوع', 'Weekday', 'time', 'يوم الأسبوع لليوم التجاري (السبت، الأحد…) — مفيد لمقارنة الخميس بالخميس.', 'Weekday of the business date — compare Thursdays with Thursdays.', 'business_date', 'SHOULD', 'آخر الليل يتبع اليوم التجاري السابق، فيُحتسب عليه.', 'Late night belongs to the earlier business date.'),
  d('daypart', 'الفترة', 'Daypart', 'time', 'إفطار (4–11)، غداء (11–16)، عشاء (16–22)، آخر الليل (22–4) — من وقت الشيك.', 'Breakfast 04–11, lunch 11–16, dinner 16–22, late 22–04.', 'daypart config (MARKET)', 'MUST', 'آخر الليل يتبع اليوم التجاري السابق.', 'Late night belongs to the earlier business date.'),
  d('hour', 'الساعة', 'Hour', 'time', 'ساعة الحدث بتوقيت القاهرة من ساعة الخادم.', 'Hour of the trusted server event time, Cairo local.', 'event time (server)', 'MUST', 'ساعة الخادم فقط، لا ساعة الجهاز.', 'Never the device clock.'),
  d('branch', 'الفرع', 'Branch', 'organization', 'الفرع الذي وقع فيه الحدث.', 'Branch of the event.', 'branch_id', 'MUST', 'تظهر الفروع المسموح لك بها فقط.', 'Only branches you are allowed to see.'),
  d('location', 'المخزن', 'Stock location', 'organization', 'مخزن الخامات (مخزن رئيسي، المطبخ، البار).', 'Stock warehouse.', 'warehouse_id', 'SHOULD', 'ليس لكل المبيعات.', 'Not applicable to sales.'),
  d('revenue_center', 'منطقة البيع', 'Revenue center', 'organization', 'منطقة في الصالة (داخلي، تراس، الطابق العلوي).', 'Dining area.', 'table.area', 'SHOULD', 'مختلفة عن قناة البيع.', 'Different from sales channel.'),
  d('channel', 'قناة البيع', 'Sales channel', 'order', 'صالة، تيك أواي، دليفري.', 'Dine-in, takeaway, delivery.', 'order.channel', 'MUST', 'لكل قناة أسعارها.', 'Prices differ per channel.'),
  d('order', 'الطلب', 'Order', 'order', 'هوية الطلب: الجلسة كلها على الترابيزة، أو الشيك منفردًا خارج الصالة.', 'Order identity: the table visit, or the check outside the floor.', 'visit_id ?? order_id', 'MUST', 'تقسيم الشيك لا يضاعف الطلبات.', 'Splitting never multiplies orders.'),
  d('check', 'الشيك', 'Check', 'order', 'الشيك المحاسبي المدفوع.', 'The accounting check.', 'order_id', 'MUST', 'قد توجد عدة شيكات للجلسة نفسها.', 'One visit may have several checks.'),
  d('table_visit', 'الجلسة', 'Table visit', 'service', 'جلسة واحدة على ترابيزة من الفتح إلى الإغلاق.', 'One seating, open to close.', 'visit_id', 'SHOULD', 'يُعدّ الضيوف مرة واحدة لكل جلسة.', 'Guests counted once per visit.'),
  d('table', 'الترابيزة', 'Table', 'service', 'الترابيزة.', 'Physical table.', 'table_id', 'SHOULD', 'قد تُنقل الترابيزات أو تُضم.', 'Tables may move or join.'),
  d('staff', 'الموظف', 'Staff', 'personnel', 'منفّذ الحدث: الويتر على الشيك، والكاشير على الدفع، ومن ألغى الصنف.', 'Actor: server on checks, cashier on payments, actor on removals.', 'actor_user_id', 'MUST', 'الويتر غير الكاشير غير المدير الموافق.', 'Server ≠ cashier ≠ approver.', { permission: MGR }),
  d('role', 'الوظيفة', 'Role', 'personnel', 'وظيفة الموظف.', 'Job role.', 'role_id', 'SHOULD', 'بلا بيانات شخصية.', 'No PII.', { permission: MGR }),
  d('product', 'الصنف', 'Item', 'menu', 'الصنف كما سُجّل على السطر وقت البيع.', 'Item as captured on the line.', 'line.productId', 'MUST', 'يُحتسب الكومبو صنفًا واحدًا.', 'A combo counts as one item.'),
  d('category', 'القسم', 'Category', 'menu', 'قسم قائمة الطعام المسجل على السطر وقت البيع.', 'Category captured on the line at sale time.', 'line.categoryId', 'MUST', 'لا تُنقل المبيعات السابقة إذا تغيّر القسم.', 'Old sales keep their category.'),
  d('modifier', 'الإضافة', 'Modifier', 'menu', 'الإضافات المختارة على السطر.', 'Modifiers on the line.', 'line.modifiers', 'SHOULD', 'لا تُدمج التوليفات المختلفة.', 'Combinations are not flattened.'),
  d('size', 'الحجم', 'Size', 'menu', 'الحجم المختار (صغير/وسط/كبير).', 'Chosen size.', 'line.variant', 'SHOULD', 'يجب توحيد وحدة الاستهلاك.', 'Normalise recipe consumption.'),
  d('payment_method', 'طريقة الدفع', 'Payment method', 'finance', 'وسيلة التحصيل: نقدي، بطاقة، محفظة، مدفوع مسبقًا، نقاط.', 'How the money arrived.', 'capture.method', 'MUST', 'ليس بُعدًا للمبيعات دون جسر.', 'Not a dimension of sales without a bridge.'),
  d('drawer', 'الدرج (الوردية)', 'Drawer session', 'finance', 'درج الكاشير في وردية معينة.', 'Drawer + session.', 'session_id', 'MUST', 'يُقرأ الدرج بالوردية.', 'Scope the drawer by session.'),
  d('void_reason', 'السبب', 'Reason', 'control', 'سبب الإلغاء/الخصم/المرتجع من القائمة.', 'Policy reason code.', 'reason_code', 'MUST', 'الملاحظة الحرة محفوظة منفصلة.', 'Free note kept separately.'),
  d('approval_actor', 'المدير الموافق', 'Approver', 'control', 'المدير الذي وافق على العملية.', 'Approver identity.', 'grant.approver', 'MUST', 'للمدير والمحاسب فقط.', 'Managers and accountants only.', { permission: MGR }),
  d('stage', 'مرحلة الإلغاء', 'Reversal stage', 'control', 'S0 قبل الظهور، S1 بعد الشيك المبدئي أو المطبخ، S2 بعد الدفع واليوم مفتوح، S3 بعد إغلاق اليوم.', 'S0 unsent, S1 visible, S2 paid open day, S3 paid closed day.', 'removal.stage (DESIGN P1)', 'MUST', 'إن لم تُسجَّل المرحلة نستنتجها من الأحداث ونوضح ذلك.', 'Derived from events when not recorded, and labelled.'),
  d('disposition', 'مصير الصنف', 'Disposition', 'control', 'لم يُحضَّر / عاد إلى المخزن / هالك محجوز للمراجعة.', 'Not prepared / return to stock / waste held.', 'removal.disposition (DESIGN P1)', 'MUST', 'يدخل الهالك المحجوز طابور مراجعة المحاسب.', 'Waste held enters the accountant review queue.'),
  d('station', 'المحطة', 'Kitchen station', 'kitchen', 'محطة المطبخ (مشويات، بارد، بار).', 'Kitchen station.', 'ticket.stationId', 'SHOULD', 'لكل محطة وقتها.', 'Per-station times.'),
  d('inventory_item', 'الخامة', 'Ingredient', 'stock', 'الخامة بوحدة المخزن.', 'Stock item in base unit.', 'item_id', 'SHOULD', 'لا يُجمع الكيلو مع اللتر.', 'Never add kg to litres.'),
  d('supplier', 'المورد', 'Supplier', 'procurement', 'المورد.', 'Supplier.', 'supplier_id', 'SHOULD', 'يجب توحيد السعر بوحدة.', 'Normalise cost per unit.'),
  d('driver', 'الطيار', 'Driver', 'delivery', 'الطيار الذي سلّم الطلب.', 'Delivery driver.', 'driver_id', 'SHOULD', 'بيانات شخصية — للمدير فقط.', 'Sensitive.', { permission: MGR }),
  d('zone', 'منطقة التوصيل', 'Delivery zone', 'delivery', 'منطقة التوصيل.', 'Delivery zone.', 'zone_id', 'SHOULD', 'بلا العنوان التفصيلي.', 'Address minimised.'),
  d('customer_cohort', 'فوج العملاء', 'Customer cohort', 'customer', 'شهر أول شراء للعميل.', 'First purchase month.', 'cohort', 'LATER', 'يحتاج إلى موافقة العميل وقرار خصوصية.', 'Needs consent.', NA('مغلق حتى يُتخذ قرار الخصوصية والموافقة (OD06).', 'Disabled until consent and privacy are decided (OD06).')),
  d('tax_group', 'فئة الضريبة', 'Tax group', 'fiscal', 'فئة الضريبة المسجلة على السطر.', 'Tax policy snapshot.', 'line.taxPolicy', 'MUST', 'يؤكد المحاسب نسبة الضريبة.', 'Rate to be confirmed by the accountant.'),
  d('fiscal_status', 'حالة الإيصال', 'E-receipt status', 'fiscal', 'مسودة، مُرسل، مقبول، مرفوض.', 'Draft, submitted, accepted, rejected.', 'fiscalDocument.state', 'SHOULD', 'التجريبي غير الفعلي.', 'Sandbox ≠ production.'),
  d('device', 'الجهاز', 'Device', 'system', 'جهاز الكاشير أو التابلت.', 'POS terminal.', 'terminal_id', 'MUST', 'مفيد لتتبع العمل دون اتصال.', 'Useful for offline tracing.'),
  d('sync_status', 'حالة المزامنة', 'Sync status', 'system', 'مُطبّق، مكرر، تعارض، مرفوض.', 'Applied, duplicate, conflict, rejected.', 'offlineItem.state', 'MUST', 'لا تُحتسب العملية المكررة مرتين أبدًا.', 'No double count of replays.'),
];

export const dimensionById = new Map(DIMENSIONS.map((x) => [x.id, x]));
