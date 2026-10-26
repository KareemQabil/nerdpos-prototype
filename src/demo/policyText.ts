// Plain-language layer for policies (used by the Policy Panel and the real Settings screen B4).
// Every policy gets a plain title, a one-sentence explanation of what it changes in the restaurant,
// and every value is shown IN WORDS: enum options, per-channel rows, approval rules as sentences,
// scopes, booleans and numbers with units. Raw ids / JSON stay for <Tech> only.
import { t } from '../i18n';
import { APPROVAL_ACTIONS, type PolicyMeta, type Field, type Rule } from '../mock/policyRegistry';

export interface OptText { label: string; help?: string }
export interface Row { label: string; value: string }

// ───────── plain title / explanation / what reacts / expert question (Arabic)
interface Plain { title?: string; explain: string; reacts?: string; question?: string }
const PLAIN: Record<string, Plain> = {
  FloorIntakePolicy: { title: 'الويتر يفتح شيك من غير درج', explain: 'بيحدد هل الويتر يقدر يفتح ويعدّل شيكات الترابيزات من التابلت بتاعه من غير ما تكون فيه وردية درج مفتوحة. التيك أواي دايمًا محتاج درج.', reacts: 'تابلت الويتر: فتح شيك جديد على ترابيزة يتقبل أو يترفض لو مفيش وردية.', question: 'الويترية عندكم بيفتحوا ويعدّلوا شيكات الترابيزات من موبايلاتهم أو تابلتاتهم من غير درج فلوس؟ (الكاونتر والتيك أواي فاضلين بدرج)' },
  FireTimingPolicy: { title: 'إمتى الطلب يروح المطبخ', explain: 'الطلب يروح المطبخ على دفعات بزرار «ابعت للمطبخ» (مقبلات وبعدين رئيسي)، ولا مرة واحدة أول ما الشيك يتأكد.', reacts: 'زرار «ابعت للمطبخ» في شاشة الشيك بيظهر أو يختفي.' },
  CheckCompositionPolicy: { title: 'كذا شيك على نفس الترابيزة', explain: 'ينفع الترابيزة الواحدة يبقى عليها أكتر من شيك (كل مجموعة تدفع لوحدها)، ولا شيك واحد بس.', reacts: 'زرار «شيك جديد» التاني على نفس الترابيزة.' },
  VisitAutoClosePolicy: { title: 'الترابيزة تفضى لوحدها بعد الدفع', explain: 'لما آخر شيك على الترابيزة يخلص، الترابيزة تفضى أوتوماتيك، ولا الويتر لازم يقفلها بإيده.', reacts: 'خريطة الصالة بعد ما الشيك يتقفل.', question: 'الزباين عندكم بيطلبوا تاني كتير بعد ما يدفعوا؟' },
  OrderNumberPolicy: { title: 'شكل رقم الطلب', explain: 'إزاي رقم الطلب بيتكتب على الشيك والإيصال: بادئة، كام رقم، وهل فيه كود الفرع.' },
  LineVoidDispositionPolicy: { title: 'الصنف الملغي يتحسب إيه', explain: 'لما صنف يتلغي، يتسجل «ما اتعملش» ولا «هالك» — حسب هل المطبخ كان بدأ فيه ولا لأ.' },
  ComplimentaryOrderPolicy: { title: 'الضيافة (شيك مجاني)', explain: 'الضيافة بتتسجل كخصم كامل على الشيك، والمطلوب من الزبون صفر.' },
  OrderCompletionPolicy: { title: 'إمتى الشيك يتقفل', explain: 'الشيك يتقفل أول ما يتدفع، ولا لازم المطبخ يخلّص كل الأصناف الأول.', reacts: 'زرار «إنهاء» بيترفض لحد ما المطبخ يخلّص (لو الإعداد كده).' },

  PricingOrderPolicy: { title: 'الخصم قبل الضريبة ولا بعدها', explain: 'الخصم بيتخصم قبل حساب الضريبة (فالضريبة تقل)، ولا بيتخصم من الإجمالي بعد الضريبة.', reacts: 'أرقام الضريبة والإجمالي في الشيك والإيصال.', question: 'المحاسب يأكد: الخصم بيقلل الضريبة (يتخصم قبل الضريبة)؟' },
  RoundingPolicy: { title: 'تقريب الإجماليات', explain: 'إزاي السيستم يقرّب أرقام الشيك (الضريبة والإجمالي) ولكام رقم بعد العلامة.', question: 'التقريب العادي ولا البنكي في إجماليات الإيصال الإلكتروني؟' },
  ServiceChargePolicy: { title: 'الخدمة (سيرفس)', explain: 'نسبة الخدمة على كل نوع طلب، وهل عليها ضريبة. بتظهر سطر لوحدها في الشيك ومش بتتحسب من المبيعات.', reacts: 'سطر الخدمة في الشيك والإيصال (للشيكات الجديدة).', question: 'خدمة 12% على الصالة طبيعية لنوع المطعم ده؟ والضريبة بتتحسب على الخدمة؟' },
  OrderConfirmationPricingPolicy: { title: 'طريقة حساب الشيك وقت التأكيد', explain: 'بتحدد إزاي السيستم يحسب الخدمة والضريبة لما الشيك يتأكد، وعلى أنهي نوع طلبات. لو مش متحددة، السيستم بيرفض التأكيد بدل ما يحسب غلط.', question: 'الخدمة على الصالة بس، والضريبة على الأصناف والخدمة، وضريبة واحدة لكل شيك — ده نفس طريقة إيصالاتكم النهارده؟' },
  DiscountApprovalPolicy: { title: 'حد الخصم اللي بيظهر للموظف', explain: 'رقم بيظهر للموظف بس للتوضيح. اللي بيقرر فعلًا إمتى الخصم محتاج موافقة هي قاعدة «خصم على الشيك» في قسم الموافقات.' },
  DiscountStackingPolicy: { title: 'خصم وعرض مع بعض', explain: 'ينفع خصم المدير يتجمع مع عرض على نفس الشيك؟ والعروض الأوتوماتيك (زي الهابي أور) تتطبق لوحدها؟', question: 'الزبون ينفع ياخد عرض وخصم مدير مع بعض؟' },
  ZeroPricePolicy: { title: 'أصناف ببلاش', explain: 'ينفع صنف سعره صفر (عيش، مخلل، مية) يتسجل عشان يظهر في تذكرة المطبخ والإيصال؟', question: 'بتسجلوا الحاجات المجانية (عيش، مخلل، مية، صوصات) على السيستم عشان المطبخ أو الإيصال؟' },
  PriceSchedulingPolicy: { title: 'جدولة الأسعار', explain: 'ينفع المدير يحدد سعر جديد يبدأ من بكرة مثلًا، ولا تغيير السعر بيحصل فورًا بس.', question: 'المديرين بيجدولوا زيادة الأسعار لليوم اللي بعده، ولا بيغيروها فورًا بس؟' },
  ProductTaxDefaultPolicy: { title: 'الضريبة الافتراضية للأصناف الجديدة', explain: 'أي صنف جديد بياخد الضريبة دي أوتوماتيك، إلا لو حد غيّرها.' },

  NewProductAvailabilityPolicy: { title: 'الصنف الجديد يظهر فين', explain: 'الصنف الجديد يتباع على طول في الفرع اللي اتعمل فيه، ولا لازم يتفعّل في كل فرع لوحده.', question: 'لو عندكم أكتر من فرع، الصنف الجديد يظهر بس في الفرع اللي اتعمل فيه؟' },
  AvailabilityReasonPolicy: { title: 'سبب وقف الصنف', explain: 'لما صنف يخلص أو يتوقف، الموظف لازم يكتب السبب ولا اختياري.', question: 'الموظفين لازم يكتبوا سبب لما يوقفوا صنف؟' },
  SkuGenerationPolicy: { title: 'كود الصنف', explain: 'المدير يكتب كود كل صنف بنفسه، ولا السيستم يعمله أوتوماتيك لو اتساب فاضي.', question: 'عندكم أكواد أصناف قديمة لازم تفضل زي ما هي؟' },
  ProductNameUniquenessPolicy: { title: 'صنفين بنفس الاسم', explain: 'لو حد عمل صنف بنفس اسم صنف موجود: السيستم يمنعه، ينبّه بس، ولا يسيبه.', question: 'بتبيعوا صنفين بنفس الاسم (زي الأحجام كأصناف منفصلة)؟' },

  TenderMethodPolicy: { title: 'طرق الدفع المتاحة', explain: 'الزبون يقدر يدفع بإيه: كاش، كارت، محفظة. الكارت والمحفظة بيتسجلوا برقم العملية بس (مفيش ربط بمكنة حقيقية).', reacts: 'أزرار الدفع في شاشة التحصيل.', question: 'أنهي محافظ وتحويلات لازم تظهر لوحدها في تقرير قفلة الوردية؟' },
  SplitTenderPolicy: { title: 'الدفع بأكتر من طريقة', explain: 'الزبون يقدر يقسم الشيك بين كاش وكارت مثلًا، ولا يدفع بطريقة واحدة بس.', reacts: 'لو مقفول: الدفع الجزئي بيترفض في شاشة التحصيل.', question: 'الزباين بيقسموا الشيك بين كاش وكارت؟' },
  CollectionScopePolicy: { title: 'مين يحصّل شيك الترابيزة', explain: 'أي كاشير فاتح وردية في الفرع يقدر يحصّل شيك الترابيزة (والشيك بيفضل محسوب على الويتر)، ولا الوردية اللي فتحت الشيك بس.', question: 'أي درج مفتوح في الفرع يحصّل شيك الترابيزة، والويتر يفضل محسوب عليه؟' },
  RefundMethodPolicy: { title: 'المرتجع يرجع إزاي', explain: 'فلوس المرتجع لازم ترجع بنفس طريقة الدفع، ولا ينفع ترجع كاش، ولا بأي طريقة.' },
  BlindClosePolicy: { title: 'العد الأعمى للدرج', explain: 'وقت قفل الوردية، الكاشير يعد الفلوس من غير ما يشوف المبلغ اللي المفروض يكون في الدرج.', reacts: 'تقرير نص الوردية وشاشة القفل: المبلغ المتوقع مخفي أو ظاهر.', question: 'الكاشير يعد الدرج من غير ما يشوف المبلغ المتوقع؟' },
  VarianceApprovalPolicy: { title: 'حد فرق الدرج اللي بيظهر', explain: 'رقم للعرض بس. اللي بيقرر إمتى فرق الدرج محتاج موافقة هي قاعدة «فرق في عد الدرج» في قسم الموافقات.' },
  SessionDurationPolicy: { title: 'أقصى مدة للوردية', explain: 'أطول مدة ممكن الوردية تفضل مفتوحة، وإمتى السيستم ينبّه إنها طولت.' },
  CashRoundingPolicy: { title: 'تقريب الكاش لأقرب فكة', explain: 'المطلوب كاش يتقرّب لأقرب فكة متاحة، والفرق يتسجل لوحده. الكارت عمره ما بيتقرب. في مصر: مقفول لحد ما الخبير يقرر.', reacts: 'شاشة الدفع: «المطلوب كاش» وسطر فرق التقريب.', question: 'الفكة الشائعة عندكم ربع جنيه ولا نص جنيه؟ وفرق التقريب يظهر إزاي في الإيصال الإلكتروني؟' },
  TipPolicy: { title: 'البقشيش على السيستم', explain: 'البقشيش يتسجل على السيستم كفلوس لوحدها مش مبيعات، ويتوزع على الطاقم ويظهر في تقرير الوردية.', reacts: 'خانة البقشيش في شاشة الدفع.', question: 'الويترية بياخدوا بقشيش الكارت عن طريق السيستم؟ ولو أيوه: بيتجمع ولا كل واحد بتاعه، وبيتصرف كل وردية؟' },

  ApprovalRequirementPolicy: { title: 'إمتى الحركة تحتاج موافقة مدير', explain: 'لكل حركة حساسة (إلغاء، خصم، مرتجع…): محتاجة موافقة مدير دايمًا، ولا أبدًا، ولا لما المبلغ أو النسبة تعدّي حد معين.', reacts: 'شاشة «موافقة مدير» بتظهر أو لأ.', question: 'فرق الدرج المسموح قبل ما المدير يوافق (10 جنيه)؟ المرتجع محتاج موافقة دايمًا ولا فوق مبلغ معين؟ وحد الخصم (10% أو 100 جنيه)؟' },
  SelfApprovalPolicy: { title: 'المدير يوافق على طلبه هو', explain: 'هل المدير يقدر يوافق على حركة هو اللي طلبها؟ الأصل إنه ممنوع في كل الحركات — لازم مدير تاني.', reacts: 'محاولة الموافقة على طلبك بنفسك بتترفض.' },
  ApprovalTtlPolicy: { title: 'مدة صلاحية الموافقة', explain: 'موافقة المدير بتتستخدم مرة واحدة بس، وبتنتهي بعد المدة دي لو ما اتستخدمتش.' },

  KitchenTimingPolicy: { title: 'وقت التحضير في المطبخ', explain: 'الوقت المستهدف لكل طلب في المطبخ، وإمتى الشاشة تنبّه إنه اتأخر.', reacts: 'عداد التأخير على شاشة المطبخ.', question: 'الوقت المستهدف يختلف من محطة لمحطة (المشويات غير البار)؟' },
  ReceiptPrintPolicy: { title: 'طباعة الإيصال بعد الدفع', explain: 'بعد الدفع، الإيصال يطبع لوحده، ولا السيستم يسأل الكاشير، ولا مايطبعش خالص.' },
  ReasonCodePolicy: { title: 'الأسباب: من قايمة ولا كتابة حرة', explain: 'لكل نوع حركة (إلغاء، خصم، مرتجع…): الموظف يختار السبب من قايمة ثابتة، ولا يكتبه بإيده.', question: 'الموظفين عندكم بيستخدموا أنهي أسباب فعلًا؟ خلّوا القايمة قصيرة.' },

  FiscalDocumentPolicy: { title: 'الإيصال الإلكتروني', explain: 'الإيصال الإلكتروني مقفول، ولا شغال تجريبي (مش بيتبعت للضرايب بجد)، ولا شغال رسمي (بعد الاعتماد بس).', reacts: 'طابور الإيصالات الإلكترونية والـ QR على الإيصال.', question: 'المطعم التجريبي متسجل في منظومة الإيصال الإلكتروني؟ ينفع نطلع إيصالات وقت انقطاع المنظومة ونبعتها بعدين في المهلة؟' },
  BusinessDatePolicy: { title: 'اليوم التجاري', explain: 'اليوم التجاري بيبدأ الساعة 4 الصبح بتوقيت القاهرة: البيع الساعة 2 بالليل بيتحسب على اليوم اللي قبله. بيتظبط من بيانات الفرع.' },

  LoginLockoutPolicy: { title: 'قفل الحساب بعد محاولات غلط', explain: 'بعد كام محاولة رقم سري غلط الحساب يتقفل، ولمدة قد إيه.' },
  AuthSessionPolicy: { title: 'مدة الدخول', explain: 'الشخص يفضل داخل على الجهاز قد إيه قبل ما السيستم يطلب منه يدخل تاني.' },
  CredentialPolicy: { title: 'طول الرقم السري', explain: 'أقل طول للباسورد، وعدد أرقام الرقم السري (PIN).' },

  DirectionCatalogDemo: { title: 'أصناف تجريبية في المنيو', explain: 'يظهر قسم فيه أمثلة لأفكار جديدة: بيتزا بأحجام ونص ونص، وجبة كومبو، وشيشة عليها ضريبة جدول.' },
  HalfAndHalfPricingPolicy: { title: 'سعر البيتزا نص ونص', explain: 'البيتزا النص ونص تتحسب بسعر النص الأغلى، ولا بمتوسط النصين، ولا كل نص بنسبة من سعره والمجموع هو السعر.', question: 'المطاعم عندكم بتحسب النص ونص بالأغلى ولا بالمتوسط؟' },
  MenuPriceDisplayPolicy: { title: 'عرض الأسعار على الكاشير', explain: 'الأسعار على شاشة البيع تظهر زي ما هي والضريبة تتضاف في الشيك، ولا تظهر شاملة الضريبة. ده عرض بس — الشيك بيتحسب بنفس الطريقة.', question: 'الزبون بيشوف الأسعار شاملة الضريبة ولا الضريبة بتتضاف في الآخر؟' },
  SoldOutResetPolicy: { title: 'رجوع الأصناف اللي خلصت', explain: 'الصنف أو الإضافة اللي اتعلّمت «خلص النهارده» ترجع لوحدها أول اليوم التجاري الجاي، ولا تفضل لحد ما حد يرجّعها.' },
  SplitAllocationPolicy: { title: 'توزيع القروش عند تقسيم الشيك', explain: 'لما الشيك يتقسم على كذا حد والقسمة مش مظبوطة، القروش الزيادة تروح على مين. الخصم والخدمة بيتوزعوا بنفس الطريقة.' },
  TipDistributionPolicy: { title: 'توزيع البقشيش', explain: 'البقشيش للويتر صاحب الشيك، ولا يتجمع في صندوق ويتقسم على الكل آخر الوردية.', question: 'البقشيش بيتجمع ويتقسم، ولا كل ويتر ياخد بتاعه؟' },
  StackedTaxPolicy: { title: 'ضريبة الجدول (دخان ومكسرات)', explain: 'ضريبة زيادة على أصناف معينة زي الشيشة، تتحسب قبل ضريبة القيمة المضافة (فتدخل فيها) أو بعدها.', question: 'ضريبة الجدول بتدخل في حساب القيمة المضافة عندكم؟ وأنهي أصناف عليها؟' },
  MinimumChargePolicy: { title: 'الحد الأدنى للفرد (مينيمم تشارج)', explain: 'حد أدنى للطلب لكل فرد في الصالة؛ لو الأصناف أقل، الفرق بيتضاف سطر لوحده.', question: 'المينيمم تشارج للفرد ولا للترابيزة؟ وعليه ضريبة؟' },
  ChargeComponentsPolicy: { title: 'رسوم إضافية', explain: 'رسوم تغليف على التيك أواي، ورسوم دخول للفرد في الصالة، وهل عليها ضريبة.' },
  SeatsPolicy: { title: 'الكراسي', explain: 'الويتر يقدر يحدد كل صنف لأنهي كرسي، ويقسم الشيك بالكرسي.' },
  TableTurnPolicy: { title: 'تنضيف الترابيزة بعد القعدة', explain: 'أول ما القعدة تتقفل الترابيزة بتبان «محتاجة تنضيف» على خريطة الصالة لحد ما حد يدوس «اتنضفت». ممكن تمنع حد يقعد عليها قبل التنضيف، أو تحذّر بس.', reacts: 'خريطة الصالة: الترابيزة بتبقى مقلّمة أصفر لحد ما تتنضف، وتنبيه لو اتأخرت.', question: 'الترابيزة لازم تتنضف قبل ما حد يقعد عليها، ولا الويتر يقرر؟' },
  OfflineModePolicy: { title: 'الشغل من غير نت', explain: 'لما النت يقطع، الجهاز بيسجل العمليات المسموحة (إضافة أصناف، إرسال للمطبخ، تحصيل كاش) ويبعتها أول ما النت يرجع. ممكن تحدد أقصى عدد ومين يتحصل كاش بس.', reacts: 'شريط «أوفلاين» فوق الشاشة وشاشة المزامنة.', question: 'لو النت قطع، تسمحوا بتحصيل الكارت يدوي ولا كاش بس؟' },
  WalletProvidersPolicy: { title: 'المحافظ الإلكترونية', explain: 'إنستاباي وفودافون كاش وغيرهم كطرق دفع برقم العملية، وكل واحدة تظهر سطر لوحدها في تقرير قفلة الوردية.' },
};

export const policyTitle = (p: PolicyMeta) => t(PLAIN[p.id]?.title ?? p.title);
export const policyExplain = (p: PolicyMeta) => t(PLAIN[p.id]?.explain ?? p.description);
export const policyReacts = (p: PolicyMeta) => (PLAIN[p.id]?.reacts ? t(PLAIN[p.id].reacts!) : p.reacts && !/[A-Z]{3,}/.test(p.reacts) ? t(p.reacts) : undefined);
export const policyQuestion = (p: PolicyMeta) => (PLAIN[p.id]?.question ? t(PLAIN[p.id].question!) : p.question && /[؀-ۿ]/.test(p.question) ? t(p.question) : undefined);

// ───────── option labels (every enum option of every policy)
const O = (label: string, help?: string): OptText => ({ label, help });
const ON_SALE = { CASH: O('كاش'), CARD: O('كارت'), DIGITAL_WALLET: O('محفظة / إنستاباي') };
const OPTIONS: Record<string, Record<string, OptText>> = {
  'FloorIntakePolicy.DINE_IN': {
    FLOOR_WITHOUT_DRAWER: O('الويتر يفتح الشيك من التابلت من غير درج', 'الويتر بيفتح ويعدّل شيكات الترابيزات من التابلت، ومش محتاج حد يفتح وردية درج.'),
    SESSION_REQUIRED: O('لازم وردية درج مفتوحة', 'أي شيك صالة محتاج وردية كاشير مفتوحة على نفس الجهاز.'),
  },
  'FireTimingPolicy.*': {
    EXPLICIT_ROUNDS: O('على دفعات بزرار «ابعت للمطبخ»', 'الويتر يبعت المقبلات الأول وبعدين الرئيسي، كل مرة بزرار.'),
    AT_CONFIRM: O('مرة واحدة وقت تأكيد الشيك', 'مفيش زرار إرسال؛ الطلب كله بيروح المطبخ أول ما الشيك يتأكد.'),
  },
  'CheckCompositionPolicy.DINE_IN': {
    VISIT_MULTI_CHECK: O('ينفع أكتر من شيك على الترابيزة', 'كل مجموعة على الترابيزة ممكن يبقى ليها شيك لوحدها وتدفع لوحدها.'),
    VISIT_SINGLE_CHECK: O('شيك واحد بس لكل ترابيزة', 'الترابيزة كلها على شيك واحد.'),
  },
  VisitAutoClosePolicy: {
    ON_LAST_CHECK_COMPLETED: O('تفضى لوحدها بعد آخر شيك', 'أول ما آخر شيك على الترابيزة يتقفل، الترابيزة بتفضى.'),
    MANUAL: O('الويتر يقفلها بإيده', 'الترابيزة تفضل مشغولة لحد ما الويتر يضغط «قفل الترابيزة».'),
  },
  'OverReceiptPolicy.aboveTolerance': { BLOCK: O('يترفض', 'الزيادة عن نسبة السماح ما تتستلمش.'), REQUIRE_APPROVAL: O('يحتاج موافقة مدير', 'الزيادة تتستلم بموافقة مدير.') }, // inventory area
  NegativeStockPolicy: { BLOCK: O('ممنوع', 'الحركة اليدوية اللي هتخلي الرصيد بالسالب بتترفض.'), ALLOW: O('مسموح بالسالب', 'الحركة بتتسجل والرصيد بيبان بالسالب لحد الجرد.') }, // inventory area
  'LineVoidDispositionPolicy.*': {
    NOT_PREPARED: O('يتسجل «ما اتعملش»', 'مش بيتحسب خسارة.'),
    WASTE: O('يتسجل هالك', 'بيتحسب خسارة (اتعمل واترمى).'),
  },
  ComplimentaryOrderPolicy: { FULL_COMP_DISCOUNT_ZERO_TENDER: O('خصم كامل والمطلوب صفر', 'الشيك بيتسجل بأصنافه وأسعاره، وبيتخصم بالكامل.') },
  'OrderCompletionPolicy.mode': {
    COMMERCIAL_ONLY: O('يتقفل أول ما يتدفع', 'مش لازم نستنى المطبخ.'),
    FULFILLMENT_REQUIRED: O('لازم المطبخ يخلّص الأول', 'زرار «إنهاء» بيستنى لحد ما كل الطلبات تجهز.'),
  },
  PricingOrderPolicy: {
    DISCOUNT_BEFORE_TAX: O('الخصم قبل الضريبة', 'الخصم بيقلل المبلغ اللي بتتحسب عليه الضريبة، فالضريبة بتقل.'),
    DISCOUNT_AFTER_TAX: O('الخصم بعد الضريبة', 'الضريبة بتتحسب على السعر كامل، والخصم بيتخصم من الإجمالي.'),
  },
  'RoundingPolicy.mode': {
    HALF_UP: O('تقريب عادي', 'من نص قرش وفوق يطلع لفوق.'),
    HALF_EVEN: O('تقريب بنكي', 'النص بالظبط يروح للرقم الزوجي.'),
    DOWN: O('تقريب لتحت دايمًا', 'أي كسر بيتشال.'),
  },
  'OrderConfirmationPricingPolicy.mode': {
    CAPTURED_BASE_SERVICE_POLICY: O('خدمة حسب إعدادها + ضريبة واحدة', 'وقت التأكيد بيحسب الخدمة حسب إعداد الخدمة، وضريبة واحدة على الشيك.'),
    CAPTURED_BASE_SINGLE_TAX_POLICY: O('ضريبة واحدة من غير خدمة', 'الشيك عليه ضريبة واحدة ومفيش خدمة.'),
    CAPTURED_BASE_MIXED_TAX_ALLOCATED: O('أكتر من نوع ضريبة على الشيك', 'كل صنف بضريبته، والخصم بيتوزع عليهم.'),
    CAPTURED_BASE_INCLUSIVE_TAX_POLICY: O('الأسعار شاملة الضريبة', 'السعر المكتوب في المنيو هو اللي الزبون بيدفعه، والضريبة جواه.'),
  },
  'OrderConfirmationPricingPolicy.channels': { DINE_IN: O('الصالة'), TAKEAWAY: O('التيك أواي') },
  'DiscountStackingPolicy.mode': {
    NO_STACKING: O('خصم واحد بس على الشيك', 'لو فيه عرض، مفيش خصم مدير معاه (والعكس).'),
    ALLOW_STACKING: O('ينفع خصم مع عرض', 'خصم المدير والعرض يتجمعوا على نفس الشيك.'),
  },
  ZeroPricePolicy: {
    ALLOW: O('مسموح أصناف ببلاش', 'عيش، مخلل، مية… تتسجل بسعر صفر عشان تظهر للمطبخ وفي الإيصال.'),
    DENY: O('ممنوع — كل صنف لازم له سعر', 'السعر صفر بيترفض.'),
  },
  PriceSchedulingPolicy: {
    FUTURE_ALLOWED: O('ينفع تجدول سعر يبدأ بعدين', 'مثلًا سعر جديد يبدأ من أول اليوم الجاي.'),
    IMMEDIATE_ONLY: O('التغيير فوري بس', 'السعر الجديد بيبدأ من دلوقتي.'),
  },
  NewProductAvailabilityPolicy: {
    CREATING_BRANCH: O('يتباع على طول في الفرع اللي اتعمل فيه', 'وفي باقي الفروع لما يتفعّل.'),
    EXPLICIT_PER_BRANCH: O('لازم يتفعّل في كل فرع لوحده', 'الصنف مش هيظهر في أي فرع لحد ما حد يفعّله.'),
  },
  'AvailabilityReasonPolicy.*': { OPTIONAL: O('السبب اختياري'), REQUIRED: O('لازم سبب') },
  'SkuGenerationPolicy.mode': {
    AUTO_IF_EMPTY: O('أوتوماتيك لو اتساب فاضي', 'المدير ممكن يكتب الكود، ولو سابه فاضي السيستم يعمله.'),
    MANUAL: O('المدير يكتبه بنفسه', 'مفيش كود أوتوماتيك.'),
  },
  'ProductNameUniquenessPolicy.default': {
    BLOCK: O('ممنوع صنفين بنفس الاسم'), WARN: O('تنبيه بس، ويتحفظ عادي'), ALLOW: O('مسموح'),
  },
  'TenderMethodPolicy.enabled': ON_SALE,
  'CollectionScopePolicy.DINE_IN': {
    BRANCH_COLLECTING_DRAWER: O('أي كاشير مفتوح في الفرع يحصّل', 'والشيك يفضل محسوب على الويتر اللي فتحه.'),
    ORIGIN_SESSION: O('الوردية اللي فتحت الشيك بس', 'الشيك لازم يتحصّل على نفس الدرج اللي اتفتح عليه.'),
  },
  'RefundMethodPolicy.crossTender': {
    DENY: O('بنفس طريقة الدفع بس', 'اللي دفع كاش ياخد كاش، واللي دفع كارت يرجع على الكارت.'),
    ALLOW_TO_CASH: O('ينفع يرجع كاش', 'حتى لو الدفع كان كارت.'),
    ALLOW_ANY: O('بأي طريقة', 'من غير قيود.'),
  },
  'CashRoundingPolicy.mode': { OFF: O('من غير تقريب'), HALF_UP: O('تقريب لأقرب فكة') },
  'CashRoundingPolicy.increment': { '0.25': O('ربع جنيه'), '0.50': O('نص جنيه'), '1.00': O('جنيه') },
  TipPolicy: { OFF: O('البقشيش مش بيتسجل على السيستم'), ON: O('البقشيش بيتسجل على السيستم', 'خانة بقشيش في الدفع، ويظهر في تقرير الوردية.') },
  'ReceiptPrintPolicy.*': { AUTO: O('يطبع لوحده'), ASK: O('يسأل الكاشير'), OFF: O('مايطبعش') },
  'ReasonCodePolicy.*': { MANAGED: O('من قايمة ثابتة'), FREE_TEXT: O('كتابة حرة') },
  FiscalDocumentPolicy: {
    OFF: O('مقفول', 'مفيش إيصالات إلكترونية.'),
    SANDBOX: O('تجريبي', 'الإيصالات بتتبعت لبيئة تجربة، مش للضرايب بجد.'),
    PRODUCTION: O('شغال رسمي', 'بعد اعتماد المطعم في المنظومة بس.'),
  },
  HalfAndHalfPricingPolicy: { HIGHER_HALF: O('بسعر النص الأغلى'), AVERAGE: O('بمتوسط النصين'), SUM_OF_HALVES: O('مجموع النصين', 'كل نص بنسبة من سعره (عادةً نص السعر)، والسعر هو المجموع.') },
  'MenuPriceDisplayPolicy.*': { AS_PRICED: O('السعر زي ما هو (الضريبة في الشيك)'), WITH_TAX: O('شامل الضريبة') },
  SoldOutResetPolicy: { NEXT_BUSINESS_DAY: O('يرجع لوحده أول اليوم التجاري الجاي'), MANUAL: O('يفضل لحد ما حد يرجّعه') },
  'SplitAllocationPolicy.method': { LARGEST_REMAINDER: O('القروش تروح للي عنده أكبر كسر', 'الطريقة الثابتة الوحيدة دلوقتي.') },
  'SplitAllocationPolicy.residual': { LAST_SHARE: O('الفرق الأخير على آخر حد'), FIRST_SHARE: O('الفرق الأخير على أول حد') },
  TipDistributionPolicy: { PER_SERVER: O('للويتر صاحب الشيك'), POOLED: O('صندوق مشترك يتقسم آخر الوردية') },
  'StackedTaxPolicy.order': { BEFORE_VAT: O('قبل القيمة المضافة (تدخل فيها)'), AFTER_VAT: O('بعد القيمة المضافة') },
  'WalletProvidersPolicy.providers': { INSTAPAY: O('إنستاباي'), VODAFONE_CASH: O('فودافون كاش'), ORANGE_CASH: O('أورنج كاش'), ETISALAT_CASH: O('اتصالات كاش') },
};
// Generic fallbacks for policies added later by other screens.
const GENERIC: Record<string, OptText> = {
  ON: O('شغال'), OFF: O('مقفول'), ALLOW: O('مسموح'), DENY: O('ممنوع'), BLOCK: O('ممنوع'), WARN: O('تنبيه بس'), REQUIRED: O('إجباري'), OPTIONAL: O('اختياري'),
  MANUAL: O('يدوي'), AUTO: O('أوتوماتيك'), ASK: O('يسأل'), NONE: O('ولا حاجة'), ALWAYS: O('دايمًا'), NEVER: O('أبدًا'),
  DINE_IN: O('الصالة'), TAKEAWAY: O('التيك أواي'), DELIVERY: O('الدليفري'), CASH: O('كاش'), CARD: O('كارت'), DIGITAL_WALLET: O('محفظة'),
  ON_CONFIRM: O('وقت تأكيد الشيك'), ON_COMPLETE: O('وقت قفل الشيك'), ON_PAYMENT: O('وقت الدفع'),
};

export function optionText(policyId: string, fieldKey: string | null, value: unknown): OptText {
  const v = String(value);
  const m = (fieldKey && (OPTIONS[`${policyId}.${fieldKey}`] ?? OPTIONS[`${policyId}.*`])) || OPTIONS[policyId] || OPTIONS[`${policyId}.*`];
  const o = m?.[v] ?? GENERIC[v];
  if (o) return { label: t(o.label), help: o.help ? t(o.help) : undefined };
  return { label: v.toLowerCase().replace(/_/g, ' ') };
}

// ───────── field labels and units
const FIELD_LABEL: Record<string, string> = {
  'FloorIntakePolicy.DINE_IN': 'الصالة', 'FireTimingPolicy.DINE_IN': 'الصالة', 'FireTimingPolicy.TAKEAWAY': 'التيك أواي',
  'MenuPriceDisplayPolicy.DINE_IN': 'الصالة', 'MenuPriceDisplayPolicy.TAKEAWAY': 'التيك أواي', 'MenuPriceDisplayPolicy.DELIVERY': 'الدليفري',
  'CheckCompositionPolicy.DINE_IN': 'الصالة', 'CollectionScopePolicy.DINE_IN': 'الصالة', 'ReceiptPrintPolicy.DINE_IN': 'الصالة', 'ReceiptPrintPolicy.TAKEAWAY': 'التيك أواي',
  'OrderNumberPolicy.prefix': 'بادئة قبل الرقم', 'OrderNumberPolicy.width': 'عدد الأرقام', 'OrderNumberPolicy.includeBranchCode': 'فيه كود الفرع',
  'LineVoidDispositionPolicy.beforeKitchenStart': 'لو اتلغى قبل ما المطبخ يبدأ', 'LineVoidDispositionPolicy.afterKitchenStart': 'لو اتلغى بعد ما المطبخ بدأ',
  'OrderCompletionPolicy.mode': 'الشيك يتقفل', 'RoundingPolicy.mode': 'طريقة التقريب', 'RoundingPolicy.scale': 'لحد كام رقم بعد العلامة',
  'ServiceChargePolicy.byChannel.DINE_IN': 'الصالة', 'ServiceChargePolicy.byChannel.TAKEAWAY': 'التيك أواي', 'ServiceChargePolicy.taxable': 'عليها ضريبة',
  'OrderConfirmationPricingPolicy.mode': 'طريقة الحساب', 'OrderConfirmationPricingPolicy.channels': 'على أنهي طلبات',
  'DiscountApprovalPolicy.thresholdPercent': 'الحد', 'DiscountStackingPolicy.mode': 'الخصومات', 'DiscountStackingPolicy.autoApply': 'العروض الأوتوماتيك تتطبق لوحدها',
  'ProductTaxDefaultPolicy.taxPolicyId': 'الضريبة', 'AvailabilityReasonPolicy.SOLD_OUT': 'لما الصنف يخلص', 'AvailabilityReasonPolicy.BLOCKED': 'لما الصنف يتوقف',
  'SkuGenerationPolicy.mode': 'الكود', 'SkuGenerationPolicy.defaultPrefix': 'بادئة الكود', 'SkuGenerationPolicy.width': 'عدد الأرقام',
  'ProductNameUniquenessPolicy.default': 'القاعدة', 'TenderMethodPolicy.enabled': 'المتاح', 'RefundMethodPolicy.crossTender': 'المرتجع',
  'VarianceApprovalPolicy.threshold': 'الحد', 'SessionDurationPolicy.maxHours': 'أقصى مدة', 'SessionDurationPolicy.warningHours': 'ينبّه بعد',
  'CashRoundingPolicy.mode': 'التقريب', 'CashRoundingPolicy.increment': 'لأقرب', 'ApprovalTtlPolicy.seconds': 'صالحة لمدة',
  'KitchenTimingPolicy.targetMinutes': 'الوقت المستهدف', 'KitchenTimingPolicy.alertMinutes': 'ينبّه بعد',
  'LoginLockoutPolicy.maxFailedAttempts': 'يتقفل بعد', 'LoginLockoutPolicy.lockMinutes': 'مدة القفل',
  'AuthSessionPolicy.maxHours': 'بالباسورد', 'AuthSessionPolicy.pinSessionMaxHours': 'بالرقم السري',
  'CredentialPolicy.passwordMinLength': 'الباسورد على الأقل', 'CredentialPolicy.pinLength': 'الرقم السري',
  'SplitAllocationPolicy.method': 'الطريقة', 'SplitAllocationPolicy.residual': 'آخر قرش',
  'StackedTaxPolicy.enabled': 'شغالة', 'StackedTaxPolicy.rate': 'النسبة', 'StackedTaxPolicy.order': 'بتتحسب',
  'MinimumChargePolicy.enabled': 'شغال', 'MinimumChargePolicy.perPerson': 'للفرد', 'MinimumChargePolicy.taxable': 'عليه ضريبة',
  'ChargeComponentsPolicy.packaging.enabled': 'رسوم تغليف (تيك أواي)', 'ChargeComponentsPolicy.packaging.amount': 'مبلغ التغليف',
  'ChargeComponentsPolicy.cover.enabled': 'رسوم دخول للفرد (صالة)', 'ChargeComponentsPolicy.cover.amount': 'مبلغ الدخول', 'ChargeComponentsPolicy.taxable': 'الرسوم عليها ضريبة',
  'WalletProvidersPolicy.providers': 'المحافظ',
  'TableTurnPolicy.markDirty': 'تتعلم «محتاجة تنضيف» بعد القعدة', 'TableTurnPolicy.blockSeating': 'ممنوع حد يقعد عليها قبل التنضيف', 'TableTurnPolicy.alertMinutes': 'ينبّه لو فضلت مش نضيفة بعد',
  'OfflineModePolicy.maxQueued': 'أقصى عمليات مستنية على الجهاز', 'OfflineModePolicy.cashOnly': 'التحصيل من غير نت كاش بس',
};
const REASON_KIND: Record<string, string> = {
  ORDER_CANCEL: 'إلغاء شيك ما اتبعتش', ORDER_VOID: 'إلغاء شيك كامل', LINE_VOID: 'إلغاء صنف', DISCOUNT: 'خصم', COMP: 'ضيافة', REFUND: 'مرتجع',
  CASH_MOVE: 'حركة فلوس من الدرج', NO_SALE: 'فتح الدرج من غير بيع', TENDER_CORRECTION: 'تصحيح طريقة دفع', VARIANCE: 'فرق الدرج', REPRINT: 'إعادة طباعة',
};
export const reasonKindText = (k: string) => t(REASON_KIND[k] ?? k);

type Unit = 'min' | 'hour' | 'sec' | 'try' | 'digit' | 'char' | 'egp' | 'pct' | 'none';
const UNITS: Record<string, Unit> = {
  'OrderNumberPolicy.width': 'digit', 'RoundingPolicy.scale': 'digit', 'SkuGenerationPolicy.width': 'digit',
  'SessionDurationPolicy.maxHours': 'hour', 'SessionDurationPolicy.warningHours': 'hour', 'ApprovalTtlPolicy.seconds': 'sec',
  'KitchenTimingPolicy.targetMinutes': 'min', 'KitchenTimingPolicy.alertMinutes': 'min', 'LoginLockoutPolicy.maxFailedAttempts': 'try', 'LoginLockoutPolicy.lockMinutes': 'min',
  'TableTurnPolicy.alertMinutes': 'min',
  'AuthSessionPolicy.maxHours': 'hour', 'AuthSessionPolicy.pinSessionMaxHours': 'hour', 'CredentialPolicy.passwordMinLength': 'char', 'CredentialPolicy.pinLength': 'digit',
};
export function fieldLabel(policyId: string, f: { key: string; label: string }): string {
  if (policyId === 'ReasonCodePolicy') return reasonKindText(f.key);
  return t(FIELD_LABEL[`${policyId}.${f.key}`] ?? f.label.replace(/\s*%$/, ''));
}

/** "500.00" → "500 جنيه", "12.5" → "12.50 جنيه". */
export function egp(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return t('{n} جنيه', { n: Number.isInteger(n) ? String(n) : n.toFixed(2) });
}
const pct = (v: unknown) => `${Number(v)}%`;
export function withUnit(v: unknown, u: Unit): string {
  if (v === undefined || v === null || v === '') return t('مش متحدد');
  const n = Number(v);
  switch (u) {
    case 'min': return n === 1 ? t('دقيقة') : n === 2 ? t('دقيقتين') : t('{n} دقيقة', { n });
    case 'hour': return n === 1 ? t('ساعة') : n === 2 ? t('ساعتين') : t('{n} ساعة', { n });
    case 'sec': return n % 60 === 0 ? withUnit(n / 60, 'min') : t('{n} ثانية', { n });
    case 'try': return t('{n} محاولات غلط', { n });
    case 'digit': return t('{n} أرقام', { n });
    case 'char': return t('{n} حروف', { n });
    case 'egp': return egp(v);
    case 'pct': return pct(v);
    default: return String(v);
  }
}

const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const yes = () => t('أيوه');
const no = () => t('لأ');

/** Whole-policy booleans in words. */
const BOOL_POLICY: Record<string, [string, string]> = {
  SplitTenderPolicy: ['الزبون يقدر يقسم الدفع (كاش + كارت)', 'الشيك يتدفع بطريقة واحدة بس'],
  BlindClosePolicy: ['الكاشير يعد الدرج من غير ما يشوف المتوقع', 'المبلغ المتوقع ظاهر وقت العد'],
  DirectionCatalogDemo: ['ظاهرة في المنيو', 'مخفية'],
  SeatsPolicy: ['شغالة: الأصناف بتتحدد لكل كرسي', 'مقفولة'],
};
export function boolPolicyText(policyId: string, v: unknown): string {
  const b = BOOL_POLICY[policyId];
  return b ? t(v ? b[0] : b[1]) : v ? t('شغال') : t('مقفول');
}

/** A single field value in words. */
export function fieldValueText(policyId: string, f: Field, v: unknown, ctx?: Ctx): string {
  const unit = UNITS[`${policyId}.${f.key}`];
  switch (f.kind) {
    case 'enum': return v === undefined || v === null || v === '' ? t('مش متحدد') : optionText(policyId, f.key, v).label;
    case 'bool': return v === undefined ? t('مش متحدد') : v ? yes() : no();
    case 'multi': { const arr = (v as string[] | undefined) ?? []; return arr.length ? arr.map((x) => optionText(policyId, f.key, x).label).join(t('، ')) : t('ولا حاجة'); }
    case 'money': return egp(v);
    case 'percent': return v === undefined || v === null || v === '' ? t('مش متحدد') : pct(v);
    case 'percentOrNone': return v === undefined || v === null || v === '' ? (policyId === 'ServiceChargePolicy' ? t('مفيش خدمة') : t('مفيش')) : pct(v);
    case 'number': return withUnit(v, unit ?? 'none');
    case 'text':
      if (policyId === 'ProductTaxDefaultPolicy' && f.key === 'taxPolicyId') return v ? ctx?.taxName?.(String(v)) ?? t('ضريبة محددة') : t('مفيش ضريبة افتراضية');
      return v ? String(v) : t('فاضي');
    default: return v === undefined || v === null ? t('مش متحدد') : String(v);
  }
}

export interface Ctx { taxName?: (id: string) => string | undefined }

/** Rows "label: value" describing a policy value in words (per-channel objects become rows). */
export function valueRows(p: PolicyMeta, value: unknown, ctx?: Ctx): Row[] {
  const e = p.editor;
  if (value === undefined || value === null) return [{ label: '', value: t('مش متحدد — السيستم بيرفض الحركة لحد ما يتحدد') }];
  if (e.kind === 'enum') return [{ label: '', value: optionText(p.id, null, value).label }];
  if (e.kind === 'bool') return [{ label: '', value: boolPolicyText(p.id, value) }];
  if (e.kind === 'approvals') return APPROVAL_ACTIONS.map((a) => ({ label: t(a.title), value: ruleSentence(a.id, (value as any)?.[a.id] ?? a.defaultRule) }));
  if (e.kind === 'selfApproval') {
    const allowed = Object.entries((value as any) ?? {}).filter(([, v]: any) => v?.mode === 'ALLOW').map(([k]) => actionTitle(k));
    return [{ label: '', value: allowed.length ? t('مسموح يوافق على طلبه في: {a}', { a: allowed.join(t('، ')) }) : t('ممنوع في كل الحركات — لازم مدير تاني') }];
  }
  if (e.kind === 'readonly') {
    if (p.id === 'BusinessDatePolicy') { const v: any = value; return [{ label: '', value: t('توقيت القاهرة، واليوم بيبدأ الساعة {c}', { c: cutoffText(v?.cutoff ?? '04:00') }) }]; }
    return [{ label: '', value: typeof value === 'object' ? t('قيمة مركبة') : String(value) }];
  }
  if (e.kind === 'object') {
    const rows = e.fields.map((f) => ({ label: fieldLabel(p.id, f), value: fieldValueText(p.id, f, getPath(value, f.key), ctx) }));
    if (p.id === 'OrderNumberPolicy') rows.push({ label: t('مثال'), value: orderNumberExample(value) });
    return rows;
  }
  return [{ label: '', value: String(value) }];
}

/** One line in words — for "now / Egypt profile / safe default" comparisons. */
export function valueSummary(p: PolicyMeta, value: unknown, ctx?: Ctx): string {
  if (p.editor.kind === 'approvals') {
    if (!value || typeof value !== 'object') return t('مش متحدد');
    const rules = APPROVAL_ACTIONS.map((a) => ((value as any)[a.id] ?? a.defaultRule) as Rule);
    const always = rules.filter((r) => r.mode === 'ALWAYS').length;
    const never = rules.filter((r) => r.mode === 'NEVER').length;
    const cond = rules.length - always - never;
    return t('{a} حركة محتاجة موافقة دايمًا، {c} فوق حد معين، {n} من غير موافقة', { a: always, c: cond, n: never });
  }
  return valueRows(p, value, ctx).map((r) => (r.label ? `${r.label}: ${r.value}` : r.value)).join(' · ');
}

/** Approval-rule lines that differ between two values (e.g. now vs Egypt profile). */
export function approvalDiff(a: unknown, b: unknown): string[] {
  const out: string[] = [];
  for (const x of APPROVAL_ACTIONS) {
    const ra = (a as any)?.[x.id] ?? x.defaultRule;
    const rb = (b as any)?.[x.id] ?? x.defaultRule;
    if (JSON.stringify(ra) !== JSON.stringify(rb)) out.push(`${t(x.title)}: ${ruleSentence(x.id, rb)}`);
  }
  return out;
}

function cutoffText(c: string): string {
  const [h, m] = c.split(':').map(Number);
  const hh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const part = h < 5 ? t('الفجر') : h < 12 ? t('الصبح') : h < 17 ? t('الضهر') : t('بالليل');
  return m ? `${hh}:${String(m).padStart(2, '0')} ${part}` : `${hh} ${part}`;
}
function orderNumberExample(v: any): string {
  const width = Number(v?.width ?? 4) || 4;
  const n = '42'.padStart(Math.max(width, 2), '0');
  return [v?.prefix || null, v?.includeBranchCode ? 'MAIN' : null, n].filter(Boolean).join('-');
}

// ───────── approval rules in sentences
const CONTEXT_FIELD: Record<string, [string, Unit]> = {
  lineAmount: ['قيمة الصنف', 'egp'], fireRound: ['رقم الدفعة اللي اتبعتت للمطبخ', 'none'], payable: ['قيمة الشيك', 'egp'], currentEffectivePaid: ['المدفوع', 'egp'],
  captureCount: ['عدد الدفعات', 'none'], amount: ['المبلغ', 'egp'], discountPercent: ['نسبة الخصم', 'pct'], countedCash: ['المبلغ المعدود', 'egp'],
  expectedCash: ['المبلغ المتوقع', 'egp'], absVariance: ['فرق الدرج', 'egp'], changePercent: ['نسبة تغيير السعر', 'pct'], oldAmount: ['السعر القديم', 'egp'],
  newAmount: ['السعر الجديد', 'egp'], priorReprintCount: ['عدد النسخ اللي اتطبعت قبل كده', 'none'], oldUnitPrice: ['السعر القديم', 'egp'], newUnitPrice: ['السعر الجديد', 'egp'],
  firstPrice: ['ده أول سعر للصنف', 'none'], decrease: ['السعر بيقل', 'none'], active: ['الحساب هيفضل شغال', 'none'],
  points: ['عدد النقاط', 'none'], absPoints: ['عدد النقاط', 'none'], expected: ['المبلغ المتوقع', 'egp'], counted: ['المبلغ المعدود', 'egp'],
  warehouseId: ['المخزن', 'none'], quantityDelta: ['الكمية (زيادة أو نقص)', 'none'], reasonCode: ['السبب', 'none'], absVarianceValue: ['قيمة الفروقات', 'egp'], lineCount: ['عدد الأصناف', 'none'], value: ['القيمة بالتكلفة', 'egp'], // inventory area
  foodFired: ['الأكل كان اتبعت للمطبخ', 'none'], variance: ['الفرق', 'egp'], quantity: ['الكمية', 'none'], percent: ['النسبة', 'pct'],
  orderId: ['الشيك', 'none'], fromSessionId: ['من وردية', 'none'], toSessionId: ['لوردية', 'none'], date: ['اليوم', 'none'], deliveryId: ['العملية', 'none'], consumerId: ['رايحة لـ', 'none'],
  attempts: ['عدد المحاولات', 'none'], warnings: ['عدد التحذيرات', 'none'], deadLetter: ['العملية وقفت بعد محاولات كتير', 'none'],
};
export const contextFieldLabel = (f: string) => t(CONTEXT_FIELD[f]?.[0] ?? f.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
export const contextFieldUnit = (f: string): Unit => CONTEXT_FIELD[f]?.[1] ?? 'none';
export function contextValueText(field: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? yes() : no();
  const u = contextFieldUnit(field);
  return u === 'none' ? String(v) : withUnit(v, u);
}
export const actionTitle = (id: string) => t(APPROVAL_ACTIONS.find((a) => a.id === id)?.title ?? id);

function condText(r: Rule): string {
  if (r.mode === 'ABOVE_THRESHOLD') return t('{f} أكتر من {v}', { f: contextFieldLabel(r.field), v: withUnit(r.threshold, contextFieldUnit(r.field) === 'none' ? 'none' : contextFieldUnit(r.field)) });
  if (r.mode === 'WHEN_TRUE') return contextFieldLabel(r.field);
  if (r.mode === 'ANY_OF') return r.rules.map(condText).join(t(' أو '));
  return '';
}
/** "لازم مدير يوافق لو الخصم أكتر من 10%". */
export function ruleSentence(_actionId: string, rule: Rule | null | undefined): string {
  if (!rule) return t('مش متحدد');
  if (rule.mode === 'ALWAYS') return t('لازم مدير يوافق دايمًا');
  if (rule.mode === 'NEVER') return t('من غير موافقة مدير');
  return t('لازم مدير يوافق لو {c}', { c: condText(rule) });
}
/** Short rule wording for buttons in the editor. */
export const RULE_MODE_TEXT: Record<string, { label: string; help: string }> = {
  ALWAYS: { label: 'دايمًا', help: 'كل مرة لازم مدير يوافق' },
  NEVER: { label: 'من غير موافقة', help: 'الموظف يعملها لوحده' },
  ABOVE_THRESHOLD: { label: 'فوق حد معين', help: 'لما المبلغ أو النسبة تعدّي رقم تحدده' },
  WHEN_TRUE: { label: 'في حالة معينة', help: 'لما حاجة معينة تحصل (زي إن السعر بيقل)' },
  ANY_OF: { label: 'أي شرط من اتنين', help: 'لو النسبة عدّت حد أو المبلغ عدّى حد' },
};

// ───────── scopes, states, confidence
export function scopeText(scopeType: string, scopeName?: string): string {
  switch (scopeType) {
    case 'TENANT': return t('على مستوى المطعم كله (كل الفروع)');
    case 'BRANCH': return scopeName ? t('{b} بس', { b: /^(ال)?فرع/.test(scopeName) ? scopeName : `فرع ${scopeName}` }) : t('على مستوى الفرع كله');
    case 'CHANNEL': return scopeName ? t('{c} بس', { c: scopeName }) : t('نوع طلب واحد بس (صالة أو تيك أواي)');
    case 'TERMINAL': return scopeName ? t('{d} بس', { d: scopeName }) : t('الجهاز ده بس');
    default: return scopeType;
  }
}
const SCOPE_SHORT: Record<string, string> = { TENANT: 'للمطعم كله', BRANCH: 'لكل فرع', CHANNEL: 'لكل نوع طلب', TERMINAL: 'لكل جهاز' };
export const scopesText = (scopes: string[]) => t('ينفع يتظبط: {s}', { s: scopes.map((s) => t(SCOPE_SHORT[s] ?? s)).join(' · ') });

export const STATE_TEXT: Record<string, { label: string; help: string }> = {
  CANONICAL: { label: 'متفق عليه', help: 'جزء من التصميم الأساسي' },
  CORE: { label: 'جديد في التصميم', help: 'اتضاف في آخر نسخة من التصميم' },
  PENDING: { label: 'مستني رأي خبير', help: 'القيمة مؤقتة لحد ما خبير يقرر' },
  DIRECTION: { label: 'فكرة مقترحة', help: 'لسه مش في التصميم — بنعرضها عشان نسمع رأيكم' },
};
export const appliesToText = (a: string) => (a === 'NEW_CHECKS' ? t('بيطبق على الشيكات الجديدة بس') : t('بيطبق على اللي جاي بس'));
export const CONFIDENCE_TEXT: Record<string, string> = { HIGH: 'متأكدين منها', MEDIUM: 'غالبًا كده — محتاجة تأكيد', LOW: 'مش متأكدين — محتاجة رأي' };
export const REVIEWER_TEXT: Record<string, string> = { ACCOUNTANT: 'يراجعها المحاسب', OWNER_EXPERT: 'يراجعها صاحب المطعم' };
export const confidenceText = (c?: string, r?: string) => [c ? t(CONFIDENCE_TEXT[c] ?? c) : '', r ? t(REVIEWER_TEXT[r] ?? r) : ''].filter(Boolean).join(' · ');
export const VIA_TEXT: Record<string, string> = { SETTINGS: 'من شاشة الإعدادات', PANEL: 'من لوحة العرض', PROFILE: 'من بروفايل مصر', SEED: 'من التجهيز' };
export const viaText = (v: string) => t(VIA_TEXT[v] ?? v);

/** Plain one-line description of any policy value for history rows. */
export function historyValueText(p: PolicyMeta | undefined, v: unknown, ctx?: Ctx): string {
  if (!p) return v === undefined ? t('رجع للموروث') : t('قيمة جديدة');
  if (v === undefined) return t('رجع للقيمة الموروثة');
  return valueSummary(p, v, ctx);
}
