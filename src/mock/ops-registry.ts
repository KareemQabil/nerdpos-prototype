// Operations & system area: product capabilities (runtime composition switches), plus the policies and approval
// actions this area adds. They are registered at load time into the shared registries (no edit of the shared lists).
import { APPROVAL_ACTIONS, POLICIES, policyMeta, type PolicyMeta } from './policyRegistry';
import type { DB } from './types';
import type { CapabilityState } from './types-ops';

export interface CapabilityDef {
  id: string; title: string; titleEn: string; description: string; offEffect: string; icon: string;
  /** Screens hidden when off (by id) and sidebar groups hidden when off. */
  screens: string[]; groups: string[];
  /** Operations refused when off: by contract module, by id prefix; `allow` keeps a few reads used elsewhere. */
  modules: string[]; opPrefixes: string[]; allow: string[];
  defaultOn: boolean; core?: boolean;
}

export const CAPABILITIES: CapabilityDef[] = [
  { id: 'TABLE_SERVICE', icon: 'Armchair', title: 'خدمة الترابيزات (الصالة)', titleEn: 'Table service', description: 'الويتر بيفتح ترابيزة، يعمل شيكات عليها، ويقفلها. فيه خريطة الصالة وتنضيف الترابيزات.', offEffect: 'الصالة وخريطة الترابيزات بيختفوا، والمطعم يشتغل كاونتر وتيك أواي بس.', screens: ['floor', 'floorplan'], groups: [], modules: ['tables'], opPrefixes: [], allow: ['Table.List', 'TableVisit.List'], defaultOn: true },
  { id: 'KDS', icon: 'ChefHat', title: 'شاشة المطبخ', titleEn: 'Kitchen display', description: 'التذاكر بتظهر على شاشة في المطبخ بدل الورق، بالوقت والأولوية والتسليم.', offEffect: 'شاشة المطبخ بتختفي. الطلبات لسه بتتبعت للمطبخ (للطابعة).', screens: ['kitchen'], groups: [], modules: [], opPrefixes: ['Kitchen.Board', 'Kitchen.AdvanceTicket', 'Ticket.', 'TicketItem.'], allow: [], defaultOn: true },
  { id: 'RESERVATIONS', icon: 'CalendarClock', title: 'الحجوزات والعربون', titleEn: 'Reservations', description: 'حجز ترابيزة بميعاد وعربون، وعدم الحضور.', offEffect: 'شاشة الحجوزات بتختفي ومحدش يقدر يعمل حجز جديد.', screens: ['reservations'], groups: [], modules: [], opPrefixes: ['Reservation.', 'Deposit.'], allow: ['Reservation.Find'], defaultOn: true },
  { id: 'DELIVERY', icon: 'Bike', title: 'الدليفري', titleEn: 'Delivery', description: 'طلبات توصيل بالعنوان والطيار وتحصيل الكاش من الطيار.', offEffect: 'قسم الدليفري بيختفي من القايمة وطلبات التوصيل بتترفض.', screens: [], groups: ['delivery'], modules: ['delivery'], opPrefixes: [], allow: [], defaultOn: true },
  { id: 'ONLINE_ORDERS', icon: 'Globe', title: 'الطلبات الأونلاين', titleEn: 'Online orders', description: 'استقبال طلبات من تطبيقات التوصيل والموقع جوه السيستم.', offEffect: 'الطلبات اللي جاية من برة بتترفض لحد ما تتفتح تاني.', screens: ['online-orders'], groups: [], modules: ['order_channels'], opPrefixes: ['OnlineOrder.'], allow: [], defaultOn: true },
  { id: 'INVENTORY', icon: 'Package', title: 'المخزن والمشتريات', titleEn: 'Inventory', description: 'الخامات والوصفات والجرد وأوامر الشراء والهالك.', offEffect: 'قسم المخزن والمشتريات بيختفي وحركات المخزن بتترفض.', screens: [], groups: ['inventory'], modules: ['inventory', 'counts_adjustments', 'production', 'purchasing', 'receiving', 'recipes', 'returns', 'stock_movements', 'suppliers', 'transfers', 'warehouses', 'waste'], opPrefixes: [], allow: [], defaultOn: true },
  { id: 'LOYALTY', icon: 'Heart', title: 'الولاء والنقاط', titleEn: 'Loyalty', description: 'نقاط للعميل على كل شيك ويستبدلها بخصم.', offEffect: 'النقاط مش بتتحسب ومحدش يقدر يستبدل.', screens: ['loyalty'], groups: [], modules: ['loyalty'], opPrefixes: [], allow: [], defaultOn: true },
  { id: 'PROMOTIONS', icon: 'Gift', title: 'العروض وأكواد الخصم', titleEn: 'Promotions', description: 'هابي أور، اشتري واحد وخد التاني، أكواد خصم.', offEffect: 'شاشة العروض بتختفي وأكواد الخصم بتترفض. الخصم اليدوي بموافقة المدير لسه شغال.', screens: ['promotions'], groups: [], modules: [], opPrefixes: ['Promotion.Create', 'Promotion.Configure', 'Promotion.Upsert', 'Promotion.ValidateCode'], allow: [], defaultOn: true },
  { id: 'E_RECEIPT', icon: 'FileCheck2', title: 'الإيصال الإلكتروني', titleEn: 'E-receipt', description: 'إرسال الإيصالات لمنصة الضرايب ومتابعتها.', offEffect: 'شاشات الإيصال الإلكتروني والتسجيل الضريبي بيختفوا.', screens: ['ereceipts', 'fiscal'], groups: [], modules: ['compliance'], opPrefixes: [], allow: ['FiscalSetup.Get'], defaultOn: true },
  { id: 'OFFLINE', icon: 'WifiOff', title: 'الشغل من غير نت', titleEn: 'Offline mode', description: 'لو النت قطع، الجهاز يكمّل يسجل العمليات المسموحة ويبعتها أول ما النت يرجع.', offEffect: 'لو النت قطع، الجهاز بيوقف ومش بيسجل حاجة لحد ما يرجع.', screens: ['sync'], groups: [], modules: ['offline'], opPrefixes: [], allow: ['Sync.Status'], defaultOn: true },
  { id: 'REMOTE_APPROVALS', icon: 'BellRing', title: 'الموافقة عن بعد', titleEn: 'Remote approvals', description: 'الكاشير يبعت طلب موافقة لموبايل/جهاز المدير بدل ما المدير ييجي يكتب الرقم السري.', offEffect: 'لازم المدير ييجي للجهاز ويكتب رقمه السري بنفسه.', screens: ['approvals-inbox'], groups: [], modules: [], opPrefixes: ['ApprovalRequest.'], allow: [], defaultOn: true },
  { id: 'RECONCILIATION', icon: 'Scale', title: 'المطابقة', titleEn: 'Reconciliation', description: 'مطابقة الدرج والكروت والمحافظ والإيصالات مع المبيعات.', offEffect: 'شاشة المطابقة بتختفي.', screens: ['reconciliation'], groups: [], modules: ['reconciliation'], opPrefixes: [], allow: [], defaultOn: true },
];
export const capabilityById = new Map(CAPABILITIES.map((c) => [c.id, c]));

/** Effective switch: branch value wins over the business value, else the default. */
export function capabilityOn(db: DB, id: string, branchId: string | null): boolean {
  const list: CapabilityState[] = db.capabilities ?? [];
  const br = branchId ? list.find((c) => c.id === id && c.scopeType === 'BRANCH' && c.scopeId === branchId) : undefined;
  if (br) return br.enabled;
  const ten = list.find((c) => c.id === id && c.scopeType === 'TENANT');
  if (ten) return ten.enabled;
  return capabilityById.get(id)?.defaultOn ?? true;
}

/** The capability that is OFF and blocks this operation, if any. */
export function blockingCapability(db: DB, op: { id: string; module: string }, branchId: string | null): CapabilityDef | null {
  if (op.id === 'Capability.List' || op.id === 'Profile.SetCapability') return null;
  for (const c of CAPABILITIES) {
    if (c.allow.includes(op.id)) continue;
    const hit = c.modules.includes(op.module) || c.opPrefixes.some((p) => op.id === p || (p.endsWith('.') && op.id.startsWith(p)));
    if (hit && !capabilityOn(db, c.id, branchId)) return c;
  }
  return null;
}

// ───────── approval actions added by this area (registered once)
const ACTIONS: typeof APPROVAL_ACTIONS = [
  { id: 'OUTBOX_REDRIVE', title: 'إعادة إرسال عملية واقفة', context: ['deliveryId', 'consumerId', 'attempts', 'deadLetter'], numeric: ['attempts'], boolean: ['deadLetter'], defaultRule: { mode: 'WHEN_TRUE', field: 'deadLetter' }, state: 'DIRECTION', permission: 'approve:outbox_redrive', commands: ['Outbox.Redrive'] },
  { id: 'ORDER_SESSION_TRANSFER', title: 'نقل شيك لوردية تانية', context: ['orderId', 'fromSessionId', 'toSessionId', 'payable'], numeric: ['payable'], boolean: [], defaultRule: { mode: 'NEVER' }, state: 'DIRECTION', permission: 'approve:order_session_transfer', commands: ['Order.TransferSession'] },
  { id: 'BUSINESS_DAY_CLOSE', title: 'قفل اليوم التجاري مع تحذيرات', context: ['date', 'warnings'], numeric: ['warnings'], boolean: [], defaultRule: { mode: 'ABOVE_THRESHOLD', field: 'warnings', threshold: '0' }, state: 'DIRECTION', permission: 'approve:business_day_close', commands: ['BusinessDay.Close'] },
];
for (const a of ACTIONS) if (!APPROVAL_ACTIONS.some((x) => x.id === a.id)) APPROVAL_ACTIONS.push(a);

// ───────── policies added by this area (shown in the policy panel under their group)
const NEW_POLICIES: PolicyMeta[] = [
  { id: 'TableTurnPolicy', group: 'orders', title: 'تنضيف الترابيزة بعد القعدة', titleEn: 'Table turn', description: 'بعد ما القعدة تتقفل الترابيزة بتبقى "محتاجة تنضيف" لحد ما حد يعلّم إنها اتنضفت. ممكن تمنع فتحها قبل التنضيف أو تحذّر بس.', state: 'DIRECTION', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'object', fields: [{ key: 'markDirty', label: 'تتعلم محتاجة تنضيف', kind: 'bool' }, { key: 'blockSeating', label: 'ممنوع تتفتح قبل التنضيف', kind: 'bool' }, { key: 'alertMinutes', label: 'تنبيه لو فضلت مش نضيفة (دقيقة)', kind: 'number' }] }, canonicalDefault: { markDirty: true, blockSeating: false, alertMinutes: 10 }, question: 'الترابيزة لازم تتنضف قبل ما حد يقعد عليها، ولا الويتر يقرر؟' },
  { id: 'OfflineModePolicy', group: 'orders', title: 'الشغل من غير نت', titleEn: 'Offline mode', description: 'لما النت يقطع: العمليات المسموحة بتتسجل على الجهاز وتتبعت أول ما يرجع. الدفع الكاش بس، ومن غير خصومات أو إلغاءات محتاجة مدير.', state: 'DIRECTION', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'object', fields: [{ key: 'maxQueued', label: 'أقصى عدد عمليات مستنية', kind: 'number' }, { key: 'cashOnly', label: 'الدفع كاش بس', kind: 'bool' }] }, canonicalDefault: { maxQueued: 50, cashOnly: true }, question: 'لو النت قطع، تسمحوا بتحصيل الكارت يدوي ولا كاش بس؟' },
];
for (const p of NEW_POLICIES) if (!policyMeta.has(p.id)) { POLICIES.push(p); policyMeta.set(p.id, p); }

/** Operations a device may record while offline and replay later (typed allowlist). */
export const OFFLINE_ALLOWLIST: Record<string, { ar: string; en: string }> = {
  'Order.AddLines': { ar: 'إضافة أصناف على شيك', en: 'Add items to a check' },
  'Order.UpdateLine': { ar: 'تعديل صنف', en: 'Change an item' },
  'Order.Fire': { ar: 'إرسال للمطبخ', en: 'Send to kitchen' },
  'Kitchen.AdvanceTicket': { ar: 'تحريك تذكرة في المطبخ', en: 'Move a kitchen ticket' },
  'TicketItem.Bump': { ar: 'تعليم صنف جاهز', en: 'Bump an item' },
  'Payment.Capture': { ar: 'تحصيل كاش', en: 'Cash payment' },
  'TableVisit.Open': { ar: 'فتح ترابيزة', en: 'Open a table' },
  'Table.MarkClean': { ar: 'تعليم ترابيزة نضيفة', en: 'Mark table clean' },
  'Cash.Move': { ar: 'حركة درج', en: 'Drawer movement' },
};
