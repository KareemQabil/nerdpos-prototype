// L2 — certified report manifests. DATA ONLY: a report is a composition of registered metrics and dimensions with a
// purpose, audience, default period, visual, drill-down path, reconciliation and expert checklist. No finance logic
// lives in a React component; the engine computes every block. Source: research §8 (pilot 15) + catalog ids, the
// meeting (rounding report, staff meals) and DESIGN Principle 1 (removals by stage, void review queue).
import type { Loc } from '../mock/types';

export type BlockKind = 'kpis' | 'bridge' | 'drawers' | 'table' | 'bars' | 'line' | 'matrix' | 'evidence';
export interface Block { id: string; title: Loc; kind: BlockKind; metrics: string[]; dimensions?: string[]; filters?: Record<string, string>; sort?: { metric: string; dir: 'asc' | 'desc' }; limit?: number; note?: Loc }
export interface Manifest {
  id: string; family: string; title: Loc; purpose: Loc; decision: Loc; audience: string[]; researchIds: string[];
  permission: string; period: 'DAY' | 'RANGE'; defaultPeriod: 'TODAY' | 'YESTERDAY' | 'LAST_7' | 'NOW';
  metrics: string[]; dimensions: string[]; filters: string[]; visual: string; drilldown: Loc; blocks: Block[]; checklist: string[]; notes?: Loc[];
  certified: true; version: string; pilot: boolean;
}
const L = (ar: string, en: string): Loc => ({ ar, en });
const B = (id: string, ar: string, en: string, kind: BlockKind, metrics: string[], dims: string[] = [], extra: Partial<Block> = {}): Block => ({ id, title: L(ar, en), kind, metrics, dimensions: dims, ...extra });
function M(x: Omit<Manifest, 'metrics' | 'dimensions' | 'certified' | 'version'> & { version?: string }): Manifest {
  const metrics = [...new Set(x.blocks.flatMap((b) => b.metrics))];
  const dimensions = [...new Set(x.blocks.flatMap((b) => b.dimensions ?? []))];
  return { ...x, metrics, dimensions, certified: true, version: x.version ?? '1.0' };
}
const CORE = ['definition', 'example', 'business_date', 'provisional', 'not_available', 'permissions', 'export_parity'];

export const MANIFESTS: Manifest[] = [
  M({ id: 'eod_bridge', family: 'sales', pilot: true, title: L('مبيعات اليوم وجسر نهاية اليوم', 'Daily sales & EOD money bridge'), purpose: L('يشرح كل قرش: من المبيعات قبل الخصم لحد الفواتير، ومن الفواتير للفلوس اللي دخلت والدرج.', 'Explains every piaster: from gross to billed, from billed to money collected and the drawer.'), decision: L('هل اليوم مقفول صح؟ فين الفرق لو فيه؟', 'Is the day right? Where is any gap?'), audience: ['owner', 'accountant'], researchIds: ['R-001', 'R-033', 'R-074', 'R-006'], permission: 'report:run', period: 'DAY', defaultPeriod: 'YESTERDAY', filters: ['branch'], visual: 'KPI + waterfall bridge', drilldown: L('اليوم ← الشيكات ← السطور والدفعات', 'Day → checks → lines and payments'),
    blocks: [
      B('kpis', 'الأرقام الأساسية', 'Key numbers', 'kpis', ['net_item_sales', 'recognized_sales_total', 'tender_collected', 'tender_refunded', 'order_count', 'check_count', 'guest_count', 'avg_check', 'outstanding_checks']),
      B('bridge', 'جسر الفلوس', 'Money bridge', 'bridge', ['gross_item_sales', 'discount_amount', 'item_net_sales', 'service_charge', 'tax_amount', 'recognized_sales_total', 'tender_collected', 'tender_refunded']),
      B('drawers', 'الأدراج: المتوقع مقابل المعدود', 'Drawers: expected vs counted', 'drawers', ['cash_expected', 'cash_counted', 'cash_variance']),
      B('by_channel', 'حسب قناة البيع', 'By channel', 'table', ['item_net_sales', 'service_charge', 'tax_amount', 'recognized_sales_total', 'check_count'], ['channel']),
    ], checklist: [...CORE, 'refund_cross_day', 'comps', 'staff_meals', 'tax_inclusive', 'reconciliation'] }),
  M({ id: 'split_checks', family: 'service', pilot: true, title: L('تقسيم الشيكات وتتبعها', 'Split & check trace'), purpose: L('يثبت إن تقسيم الشيك ما ضيعش قرش ولا كرر أوردرات أو ضيوف.', 'Proves splitting lost no piaster and multiplied no order or guest.'), decision: L('التقسيم سليم؟', 'Are splits clean?'), audience: ['accountant', 'manager'], researchIds: ['R-021', 'R-020'], permission: 'report:run', period: 'DAY', defaultPeriod: 'YESTERDAY', filters: ['branch', 'channel'], visual: 'audit table', drilldown: L('القعدة ← الشيكات ← الأنصبة', 'Visit → checks → shares'),
    blocks: [
      B('kpis', 'شيكات، أوردرات، ضيوف', 'Checks, orders, guests', 'kpis', ['check_count', 'order_count', 'guest_count']),
      B('by_visit', 'كل أوردر (قعدة) وشيكاته', 'Each order (visit) and its checks', 'table', ['check_count', 'recognized_sales_total', 'guest_count'], ['order'], { sort: { metric: 'check_count', dir: 'desc' } }),
      B('checks', 'الشيكات', 'Checks', 'table', ['recognized_sales_total', 'item_net_sales'], ['check'], { limit: 60 }),
    ], checklist: [...CORE, 'split'] }),
  M({ id: 'drawer_xz', family: 'payments', pilot: true, title: L('الدرج: تقرير X وZ', 'Cash drawer X / Z'), purpose: L('كل وردية: فلوس أول الوردية + الكاش الداخل − المرتجعات − المسحوبات = المتوقع، مقابل اللي اتعد.', 'Each session: float + cash in − refunds − pay-outs = expected, vs counted.'), decision: L('مين عنده عجز وليه؟', 'Who is short and why?'), audience: ['cashier', 'manager', 'accountant'], researchIds: ['R-030', 'R-034', 'R-075'], permission: 'session:xreport', period: 'DAY', defaultPeriod: 'YESTERDAY', filters: ['branch'], visual: 'closing sheet', drilldown: L('الوردية ← حركات الدرج', 'Session → drawer entries'),
    blocks: [
      B('kpis', 'الدرج', 'Drawer', 'kpis', ['cash_expected', 'cash_counted', 'cash_variance', 'no_sale_opens', 'cash_withdrawals']),
      B('drawers', 'كل وردية', 'Each session', 'drawers', ['cash_expected', 'cash_counted', 'cash_variance']),
      B('by_cashier', 'حسب الكاشير', 'By cashier', 'table', ['cash_expected', 'cash_counted', 'cash_variance'], ['staff']),
    ], checklist: [...CORE, 'reconciliation', 'rounding'] }),
  M({ id: 'tender_settlement', family: 'payments', pilot: true, title: L('طرق الدفع والتسوية', 'Payment methods & settlement'), purpose: L('الفلوس دخلت إزاي: كاش، كارت، محفظة، مدفوع مسبقًا — وكام رجع.', 'How money arrived and how much went back.'), decision: L('التحصيل متطابق مع البنك والمحافظ؟', 'Do tenders match bank and wallets?'), audience: ['accountant', 'cashier'], researchIds: ['R-029', 'R-076', 'R-032'], permission: 'report:run', period: 'DAY', defaultPeriod: 'YESTERDAY', filters: ['branch', 'payment_method'], visual: 'payment matrix', drilldown: L('طريقة الدفع ← الدفعات ← الشيك', 'Method → payments → check'),
    blocks: [
      B('kpis', 'المتحصل', 'Collected', 'kpis', ['tender_collected', 'tender_refunded', 'net_tender_movement', 'payment_count', 'tender_corrections']),
      B('by_method', 'حسب طريقة الدفع', 'By method', 'table', ['tender_collected', 'tender_refunded', 'net_tender_movement', 'payment_count'], ['payment_method']),
      B('by_drawer', 'حسب الوردية', 'By session', 'table', ['tender_collected', 'payment_count'], ['drawer']),
    ], checklist: [...CORE, 'reconciliation'] }),
  M({ id: 'discounts_comps', family: 'controls', pilot: true, title: L('الخصومات والضيافة', 'Discounts & comps'), purpose: L('كل خصم وضيافة: مين عمل، مين وافق، السبب والقيمة.', 'Every discount and comp: who, who approved, reason, value.'), decision: L('فين التسريب؟', 'Where is the leak?'), audience: ['manager', 'auditor'], researchIds: ['R-038', 'R-065'], permission: 'session:zreport', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'channel'], visual: 'heatmap + table', drilldown: L('السبب ← الخصم ← الموافقة ← الشيك', 'Reason → discount → grant → check'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['discount_amount', 'discount_count', 'comps_value']),
      B('by_reason', 'الخصومات حسب السبب', 'Discounts by reason', 'table', ['discount_amount', 'discount_count'], ['void_reason']),
      B('by_staff', 'حسب الموظف', 'By staff', 'table', ['discount_amount', 'discount_count'], ['staff']),
      B('comps', 'الضيافة', 'Comps', 'table', ['comps_value'], ['void_reason']),
    ], checklist: [...CORE, 'comps', 'staff_meals'] }),
  M({ id: 'removals_by_stage', family: 'controls', pilot: true, title: L('الإلغاءات والمرتجعات حسب المرحلة', 'Voids & refunds by stage'), purpose: L('كل شيلة فلوس أو بضاعة في أي مرحلة (S0–S3): مين عمل، مين وافق، مصير الصنف.', 'Every removal at every stage S0–S3: actor, approver, disposition.'), decision: L('الإلغاءات طبيعية ولا فيه نمط؟', 'Are removals normal or patterned?'), audience: ['auditor', 'manager', 'accountant'], researchIds: ['R-035', 'R-039', 'R-040'], permission: 'session:zreport', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'stage', 'staff'], visual: 'stage matrix', drilldown: L('المرحلة ← الإلغاء ← الشيك', 'Stage → removal → check'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['void_line_count', 'void_value', 'order_void_count', 'refund_count', 'tender_refunded', 'approval_count']),
      B('by_stage', 'حسب المرحلة', 'By stage', 'table', ['void_line_count', 'void_value', 'refund_count', 'tender_refunded'], ['stage']),
      B('by_disposition', 'مصير الأصناف', 'Disposition', 'table', ['void_line_count', 'void_value'], ['disposition']),
      B('by_actor', 'مين عمل ومين وافق', 'Actor and approver', 'table', ['void_line_count', 'void_value'], ['staff', 'approval_actor']),
    ], checklist: [...CORE, 'void_after_kitchen', 'refund_cross_day'] }),
  M({ id: 'refunds_ledger', family: 'controls', pilot: true, title: L('المرتجعات بيوم الصرف والشيك الأصلي', 'Refunds by payout date & original check'), purpose: L('كل مرتجع في يوم صرفه، مربوط بالشيك الأصلي ويومه، ومين صرف من أنهي درج.', 'Each refund on its payout day, linked to the original check and drawer.'), decision: L('المرتجعات سليمة؟', 'Are refunds sound?'), audience: ['accountant', 'auditor'], researchIds: ['R-036', 'R-037'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'payment_method'], visual: 'ledger', drilldown: L('المرتجع ← الشيك الأصلي ← الدرج', 'Refund → original check → drawer'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['refund_count', 'tender_refunded', 'return_sales_adjustment', 'refund_tax_amount']),
      B('by_day', 'حسب يوم الصرف', 'By payout day', 'table', ['refund_count', 'tender_refunded', 'return_sales_adjustment'], ['business_date']),
      B('by_stage', 'نفس اليوم ولا بعد القفل', 'Same day or after close', 'table', ['refund_count', 'tender_refunded'], ['stage']),
      B('list', 'كل مرتجع', 'Every refund', 'evidence', ['tender_refunded']),
    ], checklist: [...CORE, 'refund_cross_day'] }),
  M({ id: 'top_items', family: 'menu', pilot: true, title: L('أعلى وأقل الأصناف', 'Top & bottom items'), purpose: L('إيه اللي بيتباع وبكام، صافي من غير ضريبة.', 'What sells and for how much, ex-tax.'), decision: L('نزود إيه ونشيل إيه؟', 'What to push or drop?'), audience: ['manager', 'owner', 'chef'], researchIds: ['R-009'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'channel', 'category'], visual: 'ranked bars', drilldown: L('الصنف ← السطور', 'Item → lines'),
    blocks: [
      B('top', 'الأعلى', 'Top', 'bars', ['item_net_sales', 'sold_quantity'], ['product'], { sort: { metric: 'item_net_sales', dir: 'desc' }, limit: 10 }),
      B('bottom', 'الأقل', 'Bottom', 'table', ['item_net_sales', 'sold_quantity'], ['product'], { sort: { metric: 'item_net_sales', dir: 'asc' }, limit: 5 }),
      B('by_category', 'حسب القسم', 'By category', 'table', ['item_net_sales', 'sold_quantity'], ['category']),
    ], checklist: [...CORE] }),
  M({ id: 'hourly_daypart', family: 'sales', pilot: true, title: L('المبيعات حسب الساعة والفترة', 'Sales by hour & daypart'), purpose: L('إمتى الزحمة، بساعة السيرفر وتوقيت القاهرة.', 'When the rush is, server time, Cairo.'), decision: L('نظبط الشيفتات إزاي؟', 'How to staff?'), audience: ['manager', 'owner'], researchIds: ['R-002', 'R-008'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'channel'], visual: 'line + heatmap', drilldown: L('الساعة ← الشيكات', 'Hour → checks'),
    blocks: [
      B('by_hour', 'حسب الساعة', 'By hour', 'line', ['item_net_sales', 'check_count'], ['hour']),
      B('by_daypart', 'حسب الفترة', 'By daypart', 'table', ['item_net_sales', 'check_count', 'avg_check'], ['daypart']),
    ], checklist: [...CORE] }),
  M({ id: 'channel_economics', family: 'channels', pilot: true, title: L('قنوات البيع واقتصاديات التطبيقات', 'Channels & aggregator economics'), purpose: L('صالة مقابل تيك أواي مقابل دليفري — وعمولة التطبيقات لو متاحة.', 'Dine-in vs takeaway vs delivery — and app commission if available.'), decision: L('أنهي قناة بتكسبنا؟', 'Which channel pays?'), audience: ['owner', 'accountant'], researchIds: ['R-003', 'R-023', 'R-024', 'R-028'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch'], visual: 'stacked bars', drilldown: L('القناة ← الأوردرات', 'Channel → orders'),
    blocks: [
      B('by_channel', 'حسب القناة', 'By channel', 'bars', ['item_net_sales', 'order_count', 'avg_check'], ['channel']),
      B('economics', 'بعد العمولة', 'After commission', 'kpis', ['aggregator_commission', 'delivery_fee_net', 'delivery_avg_minutes'], [], { note: L('العمولة وصافي التوصيل مش متاحين لحد ما كشوف التسوية والعقود تتسجل — مش صفر.', 'Commission and fee net are not available until statements and contracts are recorded — not zero.') }),
    ], checklist: [...CORE, 'delivery_fees'] }),
  M({ id: 'staff_meals', family: 'controls', pilot: true, title: L('وجبات الموظفين', 'Staff meals'), purpose: L('مين أكل إيه، بموافقة مين، بقيمته وتكلفته — برة المبيعات والخصومات.', 'Who ate what, approved by whom, value and cost — outside sales and discounts.'), decision: L('الوجبات في حدود السياسة؟', 'Within policy?'), audience: ['manager', 'accountant'], researchIds: ['R-041'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'staff'], visual: 'table', drilldown: L('الموظف ← الوجبة ← الأصناف', 'Employee → meal → items'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['staff_meal_count', 'staff_meal_value', 'staff_meal_cost']),
      B('by_employee', 'حسب الموظف', 'By employee', 'table', ['staff_meal_count', 'staff_meal_value', 'staff_meal_cost'], ['staff']),
      B('by_item', 'الأصناف', 'Items', 'table', ['staff_meal_value'], ['product']),
    ], checklist: [...CORE, 'staff_meals'] }),
  M({ id: 'stock_waste', family: 'inventory', pilot: true, title: L('الرصيد والهالك', 'Stock on hand & waste'), purpose: L('الرصيد لقطة في لحظة واحدة، والهالك بقيمته وسببه.', 'Stock as a snapshot; waste with value and reason.'), decision: L('نطلب إيه؟ الهالك فين؟', 'What to order? Where is waste?'), audience: ['chef', 'stock_manager', 'accountant'], researchIds: ['R-055', 'R-058', 'R-056'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'location'], visual: 'table', drilldown: L('الخامة ← الحركات', 'Item → movements'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['inventory_value', 'waste_value', 'stock_variance_value']),
      B('stock', 'الرصيد (لقطة asOf)', 'Stock (asOf snapshot)', 'table', ['stock_on_hand', 'inventory_value'], ['inventory_item'], { sort: { metric: 'inventory_value', dir: 'desc' }, limit: 25 }),
      B('waste', 'الهالك حسب السبب', 'Waste by reason', 'table', ['waste_value'], ['void_reason']),
      B('waste_items', 'الهالك حسب الخامة', 'Waste by item', 'table', ['stock_waste_qty', 'waste_value'], ['inventory_item']),
    ], checklist: [...CORE] }),
  M({ id: 'purchasing', family: 'purchasing', pilot: true, title: L('المشتريات: أوامر الشراء والاستلام', 'Purchasing: PO & receipts'), purpose: L('طلبنا كام واستلمنا كام من كل مورد.', 'Ordered vs received per supplier.'), decision: L('مين ناقص ومين غلّى؟', 'Who is short, who raised prices?'), audience: ['buyer', 'accountant'], researchIds: ['R-061', 'R-062', 'R-063'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'supplier'], visual: 'variance table', drilldown: L('المورد ← أمر الشراء ← الاستلام', 'Supplier → PO → receipt'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['po_ordered_value', 'goods_received_value', 'supplier_price_change']),
      B('by_supplier', 'حسب المورد', 'By supplier', 'table', ['po_ordered_value', 'goods_received_value'], ['supplier']),
      B('price', 'تغير السعر', 'Price change', 'table', ['supplier_price_change', 'goods_received_value'], ['inventory_item']),
    ], checklist: [...CORE] }),
  M({ id: 'vat_ereceipt', family: 'fiscal', pilot: true, title: L('الضريبة وحالة الإيصال الإلكتروني', 'VAT & e-receipt status'), purpose: L('الضريبة والخدمة لوحدهم، وحالة كل إيصال (تجريبي ولا حقيقي).', 'VAT and service apart; each receipt state (sandbox vs production).'), decision: L('فيه إيصالات مرفوضة أو متأخرة؟', 'Rejected or late receipts?'), audience: ['accountant'], researchIds: ['R-005', 'R-070', 'R-071', 'R-073'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch'], visual: 'table + waterfall', drilldown: L('فئة الضريبة ← الإيصال', 'Tax group → receipt'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['tax_amount', 'service_charge', 'refund_tax_amount', 'eta_receipt_count', 'eta_pending_count', 'eta_failed_count']),
      B('by_status', 'الإيصالات حسب الحالة', 'Receipts by status', 'table', ['eta_receipt_count', 'eta_pending_count', 'eta_failed_count'], ['fiscal_status']),
      B('by_channel', 'الضريبة والخدمة حسب القناة', 'VAT and service by channel', 'table', ['tax_amount', 'service_charge', 'item_net_sales'], ['channel']),
    ], checklist: [...CORE, 'tax_inclusive'], notes: [L('نسبة الضريبة إعداد لازم المحاسب يأكده؛ التجريبي مش قبول حقيقي من الضرايب.', 'VAT rate is configuration to be confirmed; sandbox is not production acceptance.')] }),
  M({ id: 'kitchen_times', family: 'kitchen', pilot: true, title: L('أوقات المطبخ', 'Kitchen prep times'), purpose: L('متوسط وقت التجهيز والتذاكر المتأخرة لكل محطة — الوقت بيبدأ من الوصول.', 'Average ticket time and late tickets per station — timer starts on arrival.'), decision: L('فين عنق الزجاجة؟', 'Where is the bottleneck?'), audience: ['chef', 'manager'], researchIds: ['R-051', 'R-052', 'R-054'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'station'], visual: 'boxplot', drilldown: L('المحطة ← التذاكر', 'Station → tickets'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['kds_avg_ticket_minutes', 'kds_completed_count', 'kds_late_count']),
      B('by_station', 'حسب المحطة', 'By station', 'table', ['kds_avg_ticket_minutes', 'kds_completed_count', 'kds_late_count'], ['station']),
      B('by_daypart', 'حسب الفترة', 'By daypart', 'table', ['kds_avg_ticket_minutes', 'kds_late_count'], ['daypart']),
    ], checklist: [...CORE] }),
  M({ id: 'branch_comparison', family: 'multi_branch', pilot: true, title: L('مقارنة الفروع', 'Branch comparison'), purpose: L('نفس التعريفات لكل فرع — والمتوسطات من المجاميع.', 'Same definitions per branch — averages from sums.'), decision: L('أنهي فرع محتاج تدخل؟', 'Which branch needs attention?'), audience: ['owner'], researchIds: ['R-078', 'R-079'], permission: 'session:zreport', period: 'RANGE', defaultPeriod: 'LAST_7', filters: [], visual: 'table', drilldown: L('الفرع ← اليوم ← الشيكات', 'Branch → day → checks'),
    blocks: [
      B('by_branch', 'الفروع', 'Branches', 'table', ['net_item_sales', 'order_count', 'avg_check', 'tender_collected', 'discount_amount', 'void_line_count', 'cash_variance'], ['branch']),
      B('by_day', 'حسب اليوم', 'By day', 'line', ['net_item_sales'], ['business_date']),
    ], checklist: [...CORE] }),
  M({ id: 'cash_rounding', family: 'payments', pilot: false, title: L('تقرير التقريب (الفكة)', 'Cash rounding report'), purpose: L('للمحاسب: سبنا كام قرش للزباين وأخدنا كام، بالدفعة — والحسابات نفسها بالقرش.', 'For the accountant: how much was left to guests or taken, per payment — books stay exact.'), decision: L('التقريب بيكلفنا قد إيه؟', 'What does rounding cost?'), audience: ['accountant'], researchIds: ['meeting T1 ~1339–1370'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'staff'], visual: 'table', drilldown: L('اليوم ← الدفعة ← الشيك', 'Day → payment → check'),
    blocks: [
      B('kpis', 'الملخص', 'Summary', 'kpis', ['rounding_adjustment', 'rounding_count', 'tender_collected']),
      B('by_day', 'حسب اليوم', 'By day', 'table', ['rounding_adjustment', 'rounding_count'], ['business_date']),
      B('by_cashier', 'حسب الكاشير', 'By cashier', 'table', ['rounding_adjustment', 'rounding_count'], ['staff']),
      B('list', 'كل دفعة اتقربت', 'Every rounded payment', 'evidence', ['rounding_adjustment']),
    ], checklist: [...CORE, 'rounding'], notes: [L('موجب = سبناه للزبون (الدفع اتقرب لتحت)، سالب = أخدناه زيادة. الشيك والإيصال والضريبة بالقرش زي ما هم.', 'Positive = left to the guest; negative = taken. Check, receipt and VAT stay exact.')] }),
  M({ id: 'void_review_queue', family: 'controls', pilot: false, title: L('طابور مراجعة الهالك المحجوز', 'Void review queue'), purpose: L('الأصناف اللي اتلغت واتحجزت هالك: المحاسب يعلم «اتشافت» أو «ناقصة».', 'Items voided and held as waste: the accountant marks seen or missing.'), decision: L('الهالك المحجوز موجود فعلًا؟', 'Is held waste really there?'), audience: ['accountant', 'auditor'], researchIds: ['DESIGN P1 §3'], permission: 'session:zreport', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch'], visual: 'queue', drilldown: L('الصنف ← الإلغاء ← اللي وافق', 'Item → removal → approver'),
    blocks: [
      B('kpis', 'الطابور', 'Queue', 'kpis', ['waste_held_pending', 'waste_held_missing', 'void_value']),
      B('by_disposition', 'حسب المصير', 'By disposition', 'table', ['void_line_count', 'void_value', 'waste_held_pending', 'waste_held_missing'], ['disposition']),
      B('by_approver', 'حسب اللي وافق', 'By approver', 'table', ['void_line_count', 'waste_held_missing'], ['approval_actor']),
    ], checklist: [...CORE, 'void_after_kitchen'] }),
  M({ id: 'menu_matrix', family: 'menu', pilot: false, title: L('مصفوفة هندسة المنيو', 'Menu engineering matrix'), purpose: L('نجوم، خيول، ألغاز، كلاب — بالتكلفة وقت البيع، ولو التكلفة مش متاحة بنقول كده.', 'Stars, horses, puzzles, dogs — cost at sale time; unavailable cost is said so.'), decision: L('نسعّر ونرتب المنيو إزاي؟', 'How to price and place items?'), audience: ['owner', 'chef'], researchIds: ['R-010', 'R-013'], permission: 'report:run', period: 'RANGE', defaultPeriod: 'LAST_7', filters: ['branch', 'category'], visual: 'scatter', drilldown: L('الصنف ← الوصفة ← السطور', 'Item → recipe → lines'),
    blocks: [B('matrix', 'المصفوفة', 'Matrix', 'matrix', ['sold_quantity', 'item_net_sales', 'food_theoretical_cost', 'menu_contribution'], ['product'])], checklist: [...CORE] }),
];
export const manifestById = new Map(MANIFESTS.map((x) => [x.id, x]));
