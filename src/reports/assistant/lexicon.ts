// The assistant's vocabulary: Egyptian-Arabic and English phrases → registered metrics, dimensions, periods and
// entities. Rules only (no model). Every phrase is normalised the same way as the question (see norm()).

/** Arabic normalisation: no diacritics/tatweel, one alef, ة→ه, ى→ي, Arabic-Indic digits → Western, lower-case. */
export function norm(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[؟?!.,،؛:"'«»()\-–—/]/g, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
export const has = (q: string, ...ps: string[]) => ps.some((p) => q.includes(norm(p)));

/** Metric phrases, most specific first. score = phrase length (longer phrase wins ties). */
export const METRIC_PHRASES: [string[], string][] = [
  [['عموله التطبيق', 'عمولة التطبيق', 'بعد العموله', 'commission', 'aggregator'], 'aggregator_commission'],
  [['رسوم التوصيل', 'delivery charge', 'delivery fee', 'مصاريف التوصيل'], 'delivery_fee_net'],
  [['تكلفه العماله', 'تكلفة العمالة', 'labor cost', 'رواتب', 'مرتبات', 'payroll', 'تكلفه اخر شيفت', 'shift labor'], 'labor_cost'],
  [['كم شيف', 'شيف مطلوب', 'ساعات العمل', 'الساعات الاضافيه', 'overtime', 'ساعه عمل', 'labor hour', 'ورديات كتير', 'scheduled too much', 'عامل اشتغل', 'employees worked', 'بصمات الحضور', 'attendance', 'انتاجيه الموظفين', 'labor productivity', 'نزود الشيفت', 'staffing'], 'labor_hours'],
  [['عملاء جدد', 'عميل جديد', 'new customers', 'العملاء الجدد', 'بياناتهم ناقصه', 'incomplete required data'], 'new_customers'],
  [['رجعوا تاني', 'العملاء اللي رجعوا', 'repeat', 'retained', 'retention', 'فوج', 'cohort', 'الولاء', 'loyalty', 'ياخد كام زياره', 'visits precede', 'يرجعوا لو بعتنا', 'return offer'], 'repeat_rate'],
  [['توقع', 'نتوقع', 'forecast', 'التوقع', 'سيناريو', 'scenario', 'لو الاسعار زادت', 'what if', 'demand scenario'], 'sales_forecast'],
  [['عدم الحضور', 'no-show', 'no show', 'نو شو'], 'no_show_count'],
  [['حجز', 'حجوزات', 'الحجوزات', 'reservation', 'reservations', 'bookings', 'booking'], 'reservation_count'],
  [['ايصالات ضريبيه مرفوضه', 'مرفوضه', 'rejected e-receipt', 'rejected eta', 'اتاخر عن النافذه', 'outside the allowed window', 'من غير اصل', 'without originals'], 'eta_failed_count'],
  [['معلقه اكتر من المعتاد', 'unusually delayed', 'اتبعتت ولا معلقه', 'submitted or pending'], 'eta_pending_count'],
  [['الايصال', 'ايصالات', 'الايصالات', 'e-receipt', 'eta receipt', 'receipt uuid', 'fiscal receipts', 'ايصال مرتجع', 'return receipt'], 'eta_receipt_count'],
  [['فرق ضريبه المبيعات', 'vat differs', 'ضريبه وخدمه', 'tax and service'], 'tax_amount'],
  [['ضريبه', 'الضريبه', 'ضرايب', 'vat', 'tax'], 'tax_amount'],
  [['رسوم الخدمه', 'الخدمه', 'سيرفس', 'service charge'], 'service_charge'],
  [['وجبات الموظفين', 'وجبه موظف', 'اكل الموظفين', 'staff meal', 'staff meals'], 'staff_meal_value'],
  [['شورت فويد', 'لونج فويد', 'restockable', 'waste void', 'هالك محجوز'], 'waste_held_pending'],
  [['ضيافه', 'الضيافه', 'comp ', 'comps'], 'comps_value'],
  [['عرض اتباع', 'offer was redeemed', 'عدد الخصومات'], 'discount_count'],
  [['خصومات الكوبونات', 'كوبون', 'coupons', 'خصم', 'خصومات', 'الخصومات', 'discount', 'discounts', 'العرض', 'promotion'], 'discount_amount'],
  [['المرتجع اعلي من الاصلي', 'exceed the original', 'اتسجلت مرتين', 'recorded twice', 'double count', 'اتحسبت مرتين', 'فرق قرش', 'piaster discrepancy', 'متوازن', 'postings balance', 'متطابق', 'متطابقه', 'reconcile', 'مطابقه', 'الاختبارات اللي اتفشلت', 'failed reporting', 'تقريرين', 'two reports disagree', 'مجموعه مختلف', 'fail to reconcile', 'مش متطابقه', 'do not match'], 'reconciliation_errors'],
  [['فويد', 'void', 'voids', 'اتلغت', 'اتلغي', 'بيلغي', 'الغاءات', 'الغاء', 'اتشالت', 'removed', 'تاثير الالغاء', 'cancellations'], 'void_line_count'],
  [['مرتجع', 'مرتجعات', 'المرتجعات', 'refund', 'refunds', 'returned', 'مردود', 'رجعت', 'اترد', 'refunded'], 'tender_refunded'],
  [['عجز', 'بعجز', 'shortage', 'shortages', 'short', 'فرق الدرج', 'drawer variance'], 'cash_variance'],
  [['الكاش المتوقع', 'expected cash', 'اللي اتعد', 'counted cash', 'x و z', 'x and z'], 'cash_expected'],
  [['مسحوب', 'مسحوبات', 'withdrawal', 'withdrawals'], 'cash_withdrawals'],
  [['من غير بيع', 'non-sale', 'no-sale', 'no sale'], 'no_sale_opens'],
  [['تقريب', 'الفكه', 'rounding'], 'rounding_adjustment'],
  [['مدفوعات معلقه', 'pending card', 'معلقه من فيزا'], 'payment_count'],
  [['التحصيل', 'المتحصل', 'متحصل', 'collections', 'collected', 'collection', 'الكاش كام', 'وسائل الدفع', 'tender', 'tenders', 'instapay', 'انستاباي', 'عربون', 'deposit'], 'tender_collected'],
  [['متوسط الصرف', 'per diner', 'per guest', 'للفرد'], 'avg_guest_spend'],
  [['متوسط الشيك', 'average check', 'check size', 'متوسط مبيعات كل ويتر', 'average sales per waiter'], 'avg_check'],
  [['عدد الضيوف', 'ضيوف', 'guests', 'زباين'], 'guest_count'],
  [['شيك لسه مفتوح', 'لسه مفتوح', 'open checks', 'still open', 'غير المحصله', 'unpaid receivables', 'unpaid', 'مش مدفوعه'], 'outstanding_checks'],
  [['بتقعد وقت', 'قعدت قد ايه', 'مده القعده', 'dining time', 'dining times', 'longest dining', 'stay occupied', 'بيقفل شيكات بسرعه', 'closes checks fastest', 'وقت انتظار', 'wait'], 'avg_dining_minutes'],
  [['دوران', 'turnover', 'التنظيف', 'cleaning', 'الاشغال', 'occupancy', 'زياره الترابيزه', 'table visit timeline'], 'table_turns'],
  [['استقبال التذكره', 'receive and prep', 'متوسط وقت', 'وقت التجهيز', 'prep time', 'ticket time', 'average time', 'الاستقبال والتجهيز', 'receive and prep', 'قبل الشيف يبدا', 'before prep started', 'kitchen speed', 'المطبخ ازاي'], 'kds_avg_ticket_minutes'],
  [['المطبخ متاخر', 'kitchen station is delayed', 'تاخيرات', 'kitchen delays', 'جاهزه للتسليم', 'stuck at dispatch', 'كام شيف', 'chefs should work'], 'kds_late_count'],
  [['لسه علي الشيف', 'pending in kitchen'], 'kds_late_count'],
  [['اعاده تجهيز', 'refired', 'refire'], 'waste_value'],
  [['قيمه المخزون', 'قيمته في الفروع', 'inventory value', 'inventory valuations'], 'inventory_value'],
  [['فرق الجرد', 'count variance'], 'stock_variance_qty'],
  [['الهالك', 'هالك', 'waste'], 'waste_value'],
  [['الخامات الناقصه', 'ingredients are low', 'يكفينا', 'stock last', 'نفاد', 'stock-out', 'حركه خامه', 'movement history', 'اعاده الطلب', 'reorder', 'نطلبها', 'رصيد', 'الرصيد', 'مخزن مقفول', 'inventory module'], 'stock_on_hand'],
  [['ملهاش وصفه', 'مالهاش recipe', 'missing recipe', 'lack a recipe', 'ملهاش'], 'menu_contribution'],
  [['النجوم', 'الخيول', 'stars', 'horses', 'هندسه المنيو', 'menu matrix'], 'menu_contribution_pct'],
  [['هامش المنيو', 'menu contribution', 'هامش', 'margin', 'خسرانه', 'losing money', 'بتكسبنا', 'make us more money', 'بيكسب'], 'menu_contribution'],
  [['التكلفه النظريه', 'theoretical cost', 'تكلفه الساندوتش', 'recipe cost', 'فود كوست', 'food-cost', 'food cost', 'من مكوناته'], 'food_theoretical_cost'],
  [['اوامر الشراء', 'امر شراء', 'purchase order', 'purchase orders', 'ما اتسلمتش', 'unreceived', 'طلبنا 100'], 'po_ordered_value'],
  [['غلي اكتر', 'غلّى', 'increased prices', 'اغلي', 'more expensive', 'سعر لتر', 'price per liter', 'سعرها زاد', 'rose in price'], 'supplier_price_change'],
  [['اشتريت', 'اشترينا', 'bought', 'الشراء', 'purchasing', 'الموردين اللي بيتاخروا', 'suppliers deliver late'], 'goods_received_value'],
  [['طيار', 'الطيار', 'courier', 'driver', 'مده التوصيل', 'delivery time', 'بتتاخر', 'are deliveries'], 'delivery_avg_minutes'],
  [['محاوله توصيل', 'delivery attempts failed', 'attempts failed'], 'delivery_failed_count'],
  [['اخر داتا', 'last sync', 'متاخر في المزامنه', 'sync lag', 'as of', 'asof', 'snapshot'], 'data_freshness_minutes'],
  [['وافق علي عمليه هو نفسه', 'self-approve', 'self approve'], 'self_approval_count'],
  [['المرفوض من موافقات', 'denied manager'], 'approval_denied_count'],
  [['مين وافق', 'who approved', 'موافقات المدير', 'approval'], 'approval_count'],
  [['كميه', 'اتباع', 'بيتباع', 'sold', 'slow-moving', 'سلو موفر', 'الكومبو', 'combo', 'بيطلب', 'بتطلب', 'buys the most', 'الاضافات', 'modifiers'], 'sold_quantity'],
  [['قبل الخصم', 'gross'], 'gross_item_sales'],
  [['اجمالي الفواتير', 'billed', 'بالضريبه'], 'recognized_sales_total'],
  [['انشط', 'busiest', 'اوردرات اكتر', 'ordered most', 'عدد الاوردرات', 'orders', 'طلبًا', 'طلبا', 'busiest weekdays', 'اوردر واحد', 'stable id', 'id ثابت'], 'order_count'],
  [['شيكات', 'checks'], 'check_count'],
  [['صافي المبيعات', 'net sales', 'صافي'], 'net_item_sales'],
  [['مبيعات', 'المبيعات', 'بعت', 'بعنا', 'نبيع', 'sales', 'sell', 'sold', 'revenue', 'ارباحنا', 'profit', 'بيعمل', 'outperform', 'اعلي من', 'قارن فروعنا', 'compare our branches'], 'net_item_sales'],
];

/** Dimension phrases ("by …", "which …", "who …"). */
export const DIM_PHRASES: [string[], string][] = [
  [['حسب الساعه', 'بالساعه', 'انشط ساعه', 'busiest hour', 'ساعه الذروه', 'peak hour', 'hour by hour'], 'hour'],
  [['اوقات الزحمه', 'peak periods', 'الفتره', 'daypart'], 'daypart'],
  [['قارن فروعنا', 'compare our branches', 'اكتر فرع', 'which branch', 'اي فرع', 'بين الفروع', 'across branches', 'الفروع', 'كل فرع', 'each store', 'store peak', 'across stores', 'by branch'], 'branch'],
  [['مين اعلي تطبيق', 'which app', 'قارن التيك اواي بالدليفري', 'takeaway and delivery', 'حسب القناه', 'by channel'], 'channel'],
  [['عدت الحد', 'exceeded policy', 'مين عنده', 'مين اكتر كاشير', 'which cashier', 'عند مين', 'مين قفل', 'who closed', 'مين عمل', 'who made', 'كل ويتر', 'per waiter', 'ويتر معين', 'one waiter', 'مين الطيار', 'which courier', 'مين اكتر ويتر', 'which waiter', 'مين صرف', 'which cashier drawer'], 'staff'],
  [['اكتر صنف', 'which item', 'الاصناف', 'items', 'مين الكومبو', 'which combo', 'منطقه بتطلب', 'buys the most'], 'product'],
  [['المشروبات', 'beverages', 'حسب القسم'], 'category'],
  [['اكتر عرض', 'which offer', 'حسب السبب', 'by reason'], 'void_reason'],
  [['شورت فويد', 'لونج فويد', 'restockable-vs-waste'], 'disposition'],
  [['ملخص ضرائب', 'vat by group', 'حسب الفئه'], 'tax_group'],
  [['اكتر ترابيزه', 'which table has'], 'table'],
  [['الكاش كام والفيزا', 'cash card and wallet', 'كل وسائل الدفع', 'وسائل الدفع', 'by method', 'طريقه الدفع'], 'payment_method'],
  [['من اي درج', 'which cashier drawer', 'الدرج'], 'drawer'],
  [['محطه', 'station', 'فين'], 'station'],
  [['المورد', 'supplier', 'الموردين', 'suppliers'], 'supplier'],
  [['الخامات', 'ingredients', 'خامه', 'ingredient'], 'inventory_item'],
  [['الترابيزه', 'which table', 'table '], 'table'],
  [['ايام الاسبوع', 'weekdays', 'اقوي يوم', 'which day', 'الويك اند', 'weekends', 'most advance bookings'], 'business_date'],
  [['حاله', 'status', 'اتبعتت ولا معلقه'], 'fiscal_status'],
  [['المنطقه', 'zone'], 'zone'],
];

export const MONTHS: [string[], number][] = [[['يناير', 'january'], 1], [['فبراير', 'february'], 2], [['مارس', 'march'], 3], [['ابريل', 'april'], 4], [['مايو', 'may'], 5], [['يونيو', 'june'], 6], [['يوليو', 'july'], 7], [['اغسطس', 'august'], 8], [['سبتمبر', 'september'], 9], [['شهر اكتوبر', 'october'], 10], [['نوفمبر', 'november'], 11], [['ديسمبر', 'december'], 12]];
