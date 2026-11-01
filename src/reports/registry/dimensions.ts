// L1 dimension registry. Source: research 04_DIMENSION_REGISTRY.csv (31 rows) + DESIGN Principle 1 (reversal stage,
// disposition) + kitchen station. A dimension the mock has no source for is listed with NOT_AVAILABLE and a reason.
import type { DimensionDef } from '../types';

const d = (id: string, ar: string, en: string, type: string, descAr: string, descEn: string, source: string, priority: DimensionDef['priority'], warnAr: string, warnEn: string, extra: Partial<DimensionDef> = {}): DimensionDef => ({
  id, label: { ar, en }, type, description: { ar: descAr, en: descEn }, source, priority, warning: { ar: warnAr, en: warnEn }, status: 'AVAILABLE', ...extra,
});
const NA = (ar: string, en: string) => ({ status: 'NOT_AVAILABLE' as const, reason: { ar, en } });
const MGR = 'session:zreport';

export const DIMENSIONS: DimensionDef[] = [
  d('business_date', 'اليوم التجاري', 'Business date', 'time', 'اليوم بيبدأ الساعة 4 الفجر بتوقيت القاهرة وبيخلص 4 الفجر اللي بعده.', 'Starts 04:00 Africa/Cairo, ends 04:00 next day.', 'BusinessDatePolicy (server)', 'MUST', 'المرتجع بيتحسب يوم صرفه، مش يوم الشيك الأصلي.', 'Refunds count on their payout date.'),
  d('business_week', 'الأسبوع التجاري', 'Business week', 'time', 'الأيام التجارية متجمعة من أول يوم في الأسبوع (السبت افتراضيًا).', 'Business dates grouped from the configured week start (Saturday by default).', 'reporting calendar', 'MUST', 'لو السؤال مش واضح أنهي أسبوع، بنسأل أول يوم الأسبوع.', 'Ask the week start when vague.'),
  d('weekday', 'يوم الأسبوع', 'Weekday', 'time', 'يوم الأسبوع بتاع اليوم التجاري (السبت، الحد…) — مفيد تقارن الخميس بالخميس.', 'Weekday of the business date — compare Thursdays with Thursdays.', 'business_date', 'SHOULD', 'آخر الليل تبع اليوم التجاري اللي قبله، فبيتحسب على يومه.', 'Late night belongs to the earlier business date.'),
  d('daypart', 'الفترة', 'Daypart', 'time', 'فطار (4–11)، غدا (11–16)، عشا (16–22)، آخر الليل (22–4) — من وقت الشيك.', 'Breakfast 04–11, lunch 11–16, dinner 16–22, late 22–04.', 'daypart config (MARKET)', 'MUST', 'آخر الليل تبع اليوم التجاري اللي قبله.', 'Late night belongs to the earlier business date.'),
  d('hour', 'الساعة', 'Hour', 'time', 'ساعة الحدث بتوقيت القاهرة من ساعة السيرفر.', 'Hour of the trusted server event time, Cairo local.', 'event time (server)', 'MUST', 'ساعة السيرفر بس، مش ساعة الجهاز.', 'Never the device clock.'),
  d('branch', 'الفرع', 'Branch', 'organization', 'الفرع اللي حصل فيه الحدث.', 'Branch of the event.', 'branch_id', 'MUST', 'بتشوف بس الفروع المسموح لك بيها.', 'Only branches you are allowed to see.'),
  d('location', 'المخزن', 'Stock location', 'organization', 'مخزن الخامات (مخزن رئيسي، المطبخ، البار).', 'Stock warehouse.', 'warehouse_id', 'SHOULD', 'مش لكل المبيعات.', 'Not applicable to sales.'),
  d('revenue_center', 'منطقة البيع', 'Revenue center', 'organization', 'منطقة في الصالة (داخلي، تراس، الدور العلوي).', 'Dining area.', 'table.area', 'SHOULD', 'مختلفة عن قناة البيع.', 'Different from sales channel.'),
  d('channel', 'قناة البيع', 'Sales channel', 'order', 'صالة، تيك أواي، دليفري.', 'Dine-in, takeaway, delivery.', 'order.channel', 'MUST', 'كل قناة ليها أسعارها.', 'Prices differ per channel.'),
  d('order', 'الأوردر', 'Order', 'order', 'هوية الأوردر: القعدة كلها على الترابيزة، أو الشيك لوحده برة الصالة.', 'Order identity: the table visit, or the check outside the floor.', 'visit_id ?? order_id', 'MUST', 'تقسيم الشيك ما بيكترش الأوردرات.', 'Splitting never multiplies orders.'),
  d('check', 'الشيك', 'Check', 'order', 'الشيك المحاسبي اللي اتدفع.', 'The accounting check.', 'order_id', 'MUST', 'ممكن يبقى فيه كذا شيك لنفس القعدة.', 'One visit may have several checks.'),
  d('table_visit', 'القعدة', 'Table visit', 'service', 'قعدة واحدة على ترابيزة من الفتح للقفل.', 'One seating, open to close.', 'visit_id', 'SHOULD', 'الضيوف بيتعدوا مرة واحدة للقعدة.', 'Guests counted once per visit.'),
  d('table', 'الترابيزة', 'Table', 'service', 'الترابيزة.', 'Physical table.', 'table_id', 'SHOULD', 'الترابيزات ممكن تتنقل أو تتجمع.', 'Tables may move or join.'),
  d('staff', 'الموظف', 'Staff', 'personnel', 'اللي عمل الحدث: الويتر على الشيك، الكاشير على الدفع، اللي شال الصنف.', 'Actor: server on checks, cashier on payments, actor on removals.', 'actor_user_id', 'MUST', 'الويتر غير الكاشير غير المدير اللي وافق.', 'Server ≠ cashier ≠ approver.', { permission: MGR }),
  d('role', 'الوظيفة', 'Role', 'personnel', 'وظيفة الموظف.', 'Job role.', 'role_id', 'SHOULD', 'من غير بيانات شخصية.', 'No PII.', { permission: MGR }),
  d('product', 'الصنف', 'Item', 'menu', 'الصنف زي ما اتسجل على السطر وقت البيع.', 'Item as captured on the line.', 'line.productId', 'MUST', 'الكومبو بيتحسب كصنف واحد.', 'A combo counts as one item.'),
  d('category', 'القسم', 'Category', 'menu', 'قسم المنيو المسجل على السطر وقت البيع.', 'Category captured on the line at sale time.', 'line.categoryId', 'MUST', 'المبيعات القديمة ما بتتنقلش لو القسم اتغير.', 'Old sales keep their category.'),
  d('modifier', 'الإضافة', 'Modifier', 'menu', 'الإضافات المختارة على السطر.', 'Modifiers on the line.', 'line.modifiers', 'SHOULD', 'التوليفات المختلفة ما بتتدمجش.', 'Combinations are not flattened.'),
  d('size', 'الحجم', 'Size', 'menu', 'الحجم المختار (صغير/وسط/كبير).', 'Chosen size.', 'line.variant', 'SHOULD', 'لازم نوحد وحدة الاستهلاك.', 'Normalise recipe consumption.'),
  d('payment_method', 'طريقة الدفع', 'Payment method', 'finance', 'الفلوس وصلت إزاي: كاش، كارت، محفظة، مدفوع مسبقًا، نقاط.', 'How the money arrived.', 'capture.method', 'MUST', 'مش بُعد للمبيعات من غير جسر.', 'Not a dimension of sales without a bridge.'),
  d('drawer', 'الدرج (الوردية)', 'Drawer session', 'finance', 'درج الكاشير في وردية معينة.', 'Drawer + session.', 'session_id', 'MUST', 'الدرج بيتقرا بالوردية.', 'Scope the drawer by session.'),
  d('void_reason', 'السبب', 'Reason', 'control', 'سبب الإلغاء/الخصم/المرتجع من القايمة.', 'Policy reason code.', 'reason_code', 'MUST', 'الملاحظة الحرة محفوظة لوحدها.', 'Free note kept separately.'),
  d('approval_actor', 'المدير اللي وافق', 'Approver', 'control', 'المدير اللي وافق على العملية.', 'Approver identity.', 'grant.approver', 'MUST', 'للمدير والمحاسب بس.', 'Managers and accountants only.', { permission: MGR }),
  d('stage', 'مرحلة الإلغاء', 'Reversal stage', 'control', 'S0 قبل ما يظهر، S1 بعد الشيك المبدئي أو المطبخ، S2 بعد الدفع واليوم مفتوح، S3 بعد قفل اليوم.', 'S0 unsent, S1 visible, S2 paid open day, S3 paid closed day.', 'removal.stage (DESIGN P1)', 'MUST', 'لو المرحلة مش متسجلة بنستنتجها من الأحداث ونقول كده.', 'Derived from events when not recorded, and labelled.'),
  d('disposition', 'مصير الصنف', 'Disposition', 'control', 'ما اتعملش / رجع المخزن / هالك محجوز للمراجعة.', 'Not prepared / return to stock / waste held.', 'removal.disposition (DESIGN P1)', 'MUST', 'الهالك المحجوز بيدخل طابور مراجعة المحاسب.', 'Waste held enters the accountant review queue.'),
  d('station', 'المحطة', 'Kitchen station', 'kitchen', 'محطة المطبخ (مشويات، بارد، بار).', 'Kitchen station.', 'ticket.stationId', 'SHOULD', 'كل محطة ليها وقتها.', 'Per-station times.'),
  d('inventory_item', 'الخامة', 'Ingredient', 'stock', 'الخامة بوحدة المخزن.', 'Stock item in base unit.', 'item_id', 'SHOULD', 'ما ينفعش نجمع كيلو مع لتر.', 'Never add kg to litres.'),
  d('supplier', 'المورد', 'Supplier', 'procurement', 'المورد.', 'Supplier.', 'supplier_id', 'SHOULD', 'السعر لازم يتوحد بوحدة.', 'Normalise cost per unit.'),
  d('driver', 'الطيار', 'Driver', 'delivery', 'الطيار اللي وصّل.', 'Delivery driver.', 'driver_id', 'SHOULD', 'بيانات شخصية — للمدير بس.', 'Sensitive.', { permission: MGR }),
  d('zone', 'منطقة التوصيل', 'Delivery zone', 'delivery', 'منطقة التوصيل.', 'Delivery zone.', 'zone_id', 'SHOULD', 'من غير العنوان التفصيلي.', 'Address minimised.'),
  d('customer_cohort', 'فوج العملاء', 'Customer cohort', 'customer', 'شهر أول شراء للعميل.', 'First purchase month.', 'cohort', 'LATER', 'محتاج موافقة العميل وقرار خصوصية.', 'Needs consent.', NA('مقفول لحد ما قرار الخصوصية والموافقة يتاخد (OD06).', 'Disabled until consent and privacy are decided (OD06).')),
  d('tax_group', 'فئة الضريبة', 'Tax group', 'fiscal', 'فئة الضريبة المسجلة على السطر.', 'Tax policy snapshot.', 'line.taxPolicy', 'MUST', 'نسبة الضريبة لازم المحاسب يأكدها.', 'Rate to be confirmed by the accountant.'),
  d('fiscal_status', 'حالة الإيصال', 'E-receipt status', 'fiscal', 'مسودة، اتبعت، اتقبل، اترفض.', 'Draft, submitted, accepted, rejected.', 'fiscalDocument.state', 'SHOULD', 'التجريبي غير الحقيقي.', 'Sandbox ≠ production.'),
  d('device', 'الجهاز', 'Device', 'system', 'جهاز الكاشير أو التابلت.', 'POS terminal.', 'terminal_id', 'MUST', 'مفيد لتتبع الأوفلاين.', 'Useful for offline tracing.'),
  d('sync_status', 'حالة المزامنة', 'Sync status', 'system', 'اتطبق، مكرر، تعارض، اترفض.', 'Applied, duplicate, conflict, rejected.', 'offlineItem.state', 'MUST', 'العملية المكررة عمرها ما بتتحسب مرتين.', 'No double count of replays.'),
];

export const dimensionById = new Map(DIMENSIONS.map((x) => [x.id, x]));
