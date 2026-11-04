// Principle 1 — who did it vs who allowed it. Approval actions per reversal stage, the policies of this area
// (registered at load time into the shared registries, like ops-registry.ts), the operations a supervisor can
// authorise in place, and the pure stage helpers used by the mock server and the screens.
import { APPROVAL_ACTIONS, POLICIES, policyMeta, type PolicyMeta } from './policyRegistry';
import type { Order, OrderLine } from './types';
import type { StageId, Disposition } from './types-control';

// ───────── approval actions (one per stage that did not have one, plus the staff meal)
const ACTIONS: typeof APPROVAL_ACTIONS = [
  { id: 'LINE_REMOVE_UNSENT', title: 'شيل صنف قبل ما يظهر للزبون أو يتبعت للمطبخ', context: ['orderId', 'lineId', 'quantity', 'lineAmount', 'stage', 'reasonCode'], numeric: ['lineAmount', 'quantity'], boolean: [], defaultRule: { mode: 'ALWAYS' }, state: 'DIRECTION', permission: 'approve:line_void', commands: ['Order.RemoveLine', 'Order.UpdateLine', 'Order.Cancel', 'Order.CancelStaffMeal'] },
  { id: 'RETURN_AFTER_CLOSE', title: 'مرتجع بعد قفل اليوم', context: ['orderId', 'amount', 'originalBusinessDate', 'reasonCode', 'method'], numeric: ['amount'], boolean: [], defaultRule: { mode: 'ALWAYS' }, state: 'DIRECTION', permission: 'approve:return_after_close', commands: ['Refund.Approve', 'Order.CancelStaffMeal'] },
  { id: 'STAFF_MEAL', title: 'وجبة موظف', context: ['employeeName', 'mealValue', 'basis', 'remainingBefore', 'lineCount'], numeric: ['mealValue', 'lineCount'], boolean: [], defaultRule: { mode: 'ALWAYS' }, state: 'DIRECTION', permission: 'approve:staff_meal', commands: ['Order.CreateStaffMeal'] },
];
for (const a of ACTIONS) if (!APPROVAL_ACTIONS.some((x) => x.id === a.id)) APPROVAL_ACTIONS.push(a);
// the existing "void a fired line" action now covers every removal at stage S1 (pre-bill printed or sent, unpaid)
const lv = APPROVAL_ACTIONS.find((a) => a.id === 'LINE_VOID');
if (lv) { lv.title = 'إلغاء صنف ظهر للعميل أو أُرسل (قبل الدفع)'; for (const c of ['Order.RemoveLine', 'Order.UpdateLine', 'Order.CancelStaffMeal']) if (!lv.commands.includes(c)) lv.commands.push(c); }
const rf = APPROVAL_ACTIONS.find((a) => a.id === 'REFUND_APPROVE');
if (rf) rf.title = 'مرتجع في نفس اليوم (بعد الدفع)';

// ───────── policies of this area
const NEW_POLICIES: PolicyMeta[] = [
  { id: 'SupervisorOverridePolicy', group: 'approvals', title: 'المدير يوافق في مكانه بدل ما يدخل بحسابه', titleEn: 'Supervisor override', description: 'لو الحركة مش من صلاحية الموظف (إلغاء، مرتجع، ضيافة، صرف من الدرج…) يقدر يكملها من جهازه لو مدير عنده الصلاحية وافق بالرقم السري أو الكارت أو البصمة أو من موبايله. الحركة بتتسجل باسم الموظف واسم المدير اللي وافق.', state: 'CORE', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'bool' }, canonicalDefault: true, reacts: 'زراير الإلغاء والمرتجع بتظهر للكاشير وبتطلب موافقة مدير' },
  { id: 'ApprovalCredentialPolicy', group: 'approvals', title: 'المدير يثبت شخصيته إزاي', titleEn: 'Approval credentials', description: 'الطرق اللي المدير يقدر يوافق بيها على جهاز الكاشير: الرقم السري، تمرير الكارت، البصمة (لو فيه جهاز بصمة)، أو طلب على موبايله.', state: 'CORE', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'object', fields: [{ key: 'methods', label: 'الطرق', kind: 'multi', options: ['PIN', 'CARD', 'FINGERPRINT', 'REMOTE'] }] }, canonicalDefault: { methods: ['PIN', 'CARD', 'FINGERPRINT', 'REMOTE'] }, reacts: 'شاشة موافقة المدير' },
  { id: 'StaffMealAllowancePolicy', group: 'orders', title: 'حد وجبة الموظف في اليوم', titleEn: 'Staff meal allowance', description: 'كل موظف ليه حد في اليوم لوجباته، محسوب بسعر البيع أو بالتكلفة. الوجبة اللي تعدّي الحد بتترفض قبل ما تتسجل.', state: 'CORE', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'object', fields: [{ key: 'enabled', label: 'فيه حد', kind: 'bool' }, { key: 'basis', label: 'بيتحسب', kind: 'enum', options: ['SALE_PRICE', 'COST'] }, { key: 'dailyLimit', label: 'الحد في اليوم', kind: 'money' }] }, canonicalDefault: { enabled: true, basis: 'SALE_PRICE', dailyLimit: '200.00' }, question: 'حد وجبة الموظف في اليوم كام، ومحسوب بسعر البيع ولا بالتكلفة؟', reacts: 'شاشة وجبة الموظف: الباقي من الحد والرفض لو عدّى' },
  { id: 'SplitLimitPolicy', group: 'orders', title: 'عدد الشيكات مايزيدش عن عدد الأفراد', titleEn: 'Split limit = guests', description: 'على الترابيزة، عدد الشيكات (شيك جديد أو تقسيم) مايعديش عدد الأفراد اللي قاعدين. مثلًا 3 أفراد = 3 شيكات بالكتير.', state: 'CORE', scopes: ['TENANT', 'BRANCH'], appliesTo: 'NEW_ACTIONS', editor: { kind: 'bool' }, canonicalDefault: true, reacts: 'زرار «شيك جديد» والتقسيم على الترابيزة' },
];
for (const p of NEW_POLICIES) if (!policyMeta.has(p.id)) { POLICIES.push(p); policyMeta.set(p.id, p); }

/**
 * Operations a supervisor can authorise in place when the person at the terminal lacks the permission.
 * Each handler asks for the matching approval (stage-aware where relevant); the kernel forces it and checks
 * that the approver holds the operation's permission as well as the approval permission.
 */
export const DELEGABLE_OPS = new Set([
  'Order.RemoveLine', 'Order.UpdateLine', 'Order.Cancel', 'Order.VoidLine', 'Order.Void', 'Order.Comp', 'Order.ApplyDiscount', 'Order.OverrideLinePrice',
  'Refund.Approve', 'Cash.Move', 'Drawer.OpenNoSale', 'Payment.CorrectTender', 'Order.CreateStaffMeal', 'Order.CancelStaffMeal',
]);

// ───────── stage helpers (pure — used by the server and the screens)
/** S0 = not on a pre-bill and not sent; S1 = a pre-bill printed after it was added, or sent to the kitchen. */
export function lineStage(o: Pick<Order, 'history'>, l: Pick<OrderLine, 'fireRound' | 'addedAt'>): 'S0' | 'S1' {
  if (l.fireRound !== null && l.fireRound !== undefined) return 'S1';
  const pre = (o.history ?? []).filter((h) => h.kind === 'PRE_BILL').map((h) => h.at);
  return pre.some((at) => at >= l.addedAt) ? 'S1' : 'S0';
}
/** The approval action for a removal at a stage. */
export const STAGE_ACTION: Record<StageId, string> = { S0: 'LINE_REMOVE_UNSENT', S1: 'LINE_VOID', S2: 'REFUND_APPROVE', S3: 'RETURN_AFTER_CLOSE' };

/** Plain Arabic (wrap with t() in screens). */
export const STAGE_TEXT: Record<StageId, { short: string; long: string }> = {
  S0: { short: 'قبل ما يظهر للزبون', long: 'لسه ما اتبعتش ولا اتطبع في شيك مبدئي' },
  S1: { short: 'بعد ما ظهر للزبون (قبل الدفع)', long: 'اتطبع في شيك مبدئي أو اتبعت للمطبخ، ولسه ما اتدفعش' },
  S2: { short: 'بعد الدفع (نفس اليوم)', long: 'اتدفع واليوم لسه مفتوح — الفلوس بتطلع من درج الكاشير' },
  S3: { short: 'مرتجع بعد قفل اليوم', long: 'اليوم اتقفل — المرتجع بيتسجل على النهارده ومربوط بالشيك الأصلي' },
};
export const DISPOSITION_TEXT: Record<Disposition, { label: string; help: string }> = {
  NOT_PREPARED: { label: 'ما اتعملش', help: 'محدش بدأ فيه — مفيش خسارة' },
  RETURN_TO_STOCK: { label: 'رجع المخزن', help: 'سليم ويتباع تاني (زي كانز مقفول) — بيرجع للرصيد' },
  WASTE_HELD: { label: 'هالك محفوظ للمراجعة', help: 'اتعمل أو باظ — المدير يحتفظ بيه لحد ما المحاسب يشوفه' },
};
export const DISPOSITIONS: Disposition[] = ['NOT_PREPARED', 'RETURN_TO_STOCK', 'WASTE_HELD'];
/** Old disposition value the inventory consumer understands (WASTE = consumed then wasted; NOT_PREPARED = consumption reversed). */
export const legacyDisposition = (d: Disposition) => (d === 'WASTE_HELD' ? 'WASTE' : 'NOT_PREPARED');
