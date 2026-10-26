// Shared display helpers for the output screens (G1–G4, H1): state pills and Arabic labels for codes.
// Display only: no money is computed here.
import React from 'react';
import { Pill } from '../../../ui';
import { Tech } from '../../../app/tech';
import { t } from '../../../i18n';
import { clock } from '../../../mock/clock';
import { time } from '../../../lib/format';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'violet';

// ───────── printing
export function printStateLabel(s: string): string {
  return ({ PENDING: t('مستني الطابعة'), SUCCEEDED: t('اتبعت للطابعة'), FAILED: t('فشلت — هتتعاد'), DEAD: t('وقفت — محتاجة إعادة') } as Record<string, string>)[s] ?? s;
}
export function PrintStatePill({ state }: { state: string }) {
  const tone: Tone = state === 'SUCCEEDED' ? 'success' : state === 'FAILED' ? 'warning' : state === 'DEAD' ? 'error' : 'info';
  return <Pill tone={tone} dot>{printStateLabel(state)}</Pill>;
}
export function docTypeLabel(d: string): string {
  return ({ RECEIPT: t('إيصال'), KITCHEN_TICKET: t('تذكرة مطبخ'), PRE_BILL: t('شيك مبدئي'), X_REPORT: t('تقرير X'), Z_REPORT: t('تقرير Z'), FISCAL_DOCUMENT: t('إيصال إلكتروني') } as Record<string, string>)[d] ?? d;
}
export function printErrorLabel(e: string): string {
  return ({ PAPER_OUT: t('الورق خلص'), PRINTER_UNREACHABLE: t('الطابعة مش بترد') } as Record<string, string>)[e] ?? e;
}
/** Time relative to the mock server clock ("بعد 12 ث"), display only. */
export function inTime(ms: number): string {
  const s = Math.round((ms - clock.now()) / 1000);
  if (s <= 0) return t('دلوقتي');
  if (s < 90) return t('بعد {n} ث', { n: s });
  return t('بعد {n} د', { n: Math.round(s / 60) }) + ` (${time(new Date(ms).toISOString())})`;
}

// ───────── e-receipt
export const FISCAL_STATES = ['PENDING_DATA', 'BUILT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export function fiscalStateLabel(s: string): string {
  return ({ PENDING_DATA: t('مستني بيانات'), BUILT: t('اتبنى (جاهز للإرسال)'), SUBMITTED: t('اتبعت للمنصة'), ACCEPTED: t('اتقبل'), REJECTED: t('اترفض'), SUPERSEDED: t('اتستبدل بإيصال مصحح') } as Record<string, string>)[s] ?? s;
}
export function FiscalStatePill({ state }: { state: string }) {
  const tone: Tone = state === 'ACCEPTED' ? 'success' : state === 'REJECTED' ? 'error' : state === 'PENDING_DATA' ? 'warning' : state === 'SUPERSEDED' ? 'neutral' : 'info';
  return <Pill tone={tone}>{fiscalStateLabel(state)}<Tech> <span className="num opacity-70 font-normal">{state}</span></Tech></Pill>;
}
export function issueLabel(code: string): string {
  return ({ NO_FISCAL_PROFILE: t('مفيش ملف ضريبي للفرع'), NO_ACTIVE_DEVICE: t('مفيش جهاز ضريبي نشط'), ITEM_CODE_MISSING: t('صنف من غير كود'), SERVICE_CHARGE_UNMAPPED: t('الخدمة برة الإيصال (معلومة، مش بتوقف)'), ROUNDING_UNMAPPED: t('التقريب مش متعرف') } as Record<string, string>)[code] ?? code;
}

// ───────── tenders and channels
export function methodLabel(m: string): string {
  const [base, provider] = String(m).split(':');
  const b = ({ CASH: t('كاش'), CARD: t('كارت'), WALLET: t('محفظة'), INSTAPAY: t('إنستاباي'), DEPOSIT: t('عربون') } as Record<string, string>)[base] ?? base;
  return provider ? `${b} (${provider})` : b;
}
export function channelLabel(c: string): string {
  return ({ DINE_IN: t('صالة'), TAKEAWAY: t('تيك أواي'), DELIVERY: t('دليفري'), PICKUP: t('استلام') } as Record<string, string>)[c] ?? c;
}

// ───────── report metric ids → Arabic labels
const METRICS: Record<string, string> = {
  gross_sales: 'إجمالي المبيعات', net_sales: 'صافي المبيعات', service_charge: 'الخدمة (منفصلة عن المبيعات)', tax: 'ضريبة القيمة المضافة',
  discounts: 'الخصومات', comps: 'الضيافة', order_count: 'عدد الطلبات', average_order_value: 'متوسط الطلب', guest_count: 'عدد الضيوف',
  refunds_paid: 'المرتجعات المصروفة', net_sales_after_refunds: 'صافي المبيعات بعد المرتجعات', charges: 'رسوم إضافية', table_tax: 'ضريبة الطاولة',
  staff_meals: 'وجبات الموظفين (مش بيع)', tips: 'البقشيش', method: 'وسيلة الدفع', gross_tender: 'المحصّل', refunded_tender: 'المرتجع',
  net_tender: 'صافي المحصّل', product: 'الصنف', item_quantity: 'الكمية', item_net_sales: 'صافي مبيعات الصنف', server: 'الويتر', orders: 'الطلبات',
  net: 'الصافي', aov: 'متوسط الطلب', voids: 'إلغاءات', cashier: 'الكاشير', captured: 'المحصّل', refunded: 'المرتجع', no_sale_opens: 'فتح درج من غير بيع',
  variance: 'الفرق', check: 'الشيك', item: 'الصنف', amount: 'المبلغ', reason: 'السبب', disposition: 'المصير', approver: 'الموافق', terminal: 'الجهاز',
  state: 'الحالة', expected_cash: 'الكاش المتوقع', counted: 'المعدود', hour: 'الساعة', guests: 'الضيوف', branch: 'الفرع', net_collected: 'صافي المحصّل',
  channel: 'القناة', table: 'الطاولة', remaining: 'الباقي', category: 'القسم', quantity: 'الكمية', customer: 'العميل', type: 'النوع', value: 'القيمة',
  approved: 'بموافقة', kind: 'النوع', user: 'المستخدم', label: 'المستند', action: 'العملية', requester: 'الطالب', target: 'الهدف', age: 'العمر',
  original_capture: 'الدفعة الأصلية', status: 'الحالة', note: 'ملاحظة', metric: 'المقياس',
};
export function metricLabel(id: string): string {
  const ar = METRICS[id];
  return ar ? t(ar) : id;
}
export const isMetricId = (v: unknown) => typeof v === 'string' && v in METRICS;

/** Default column names for report sections that come without `columns` (display only). */
export const SECTION_COLUMNS: Record<string, string[]> = {
  summary: ['metric', 'value'],
  by_channel: ['channel', 'orders', 'net'],
  outstanding_checks: ['check', 'table', 'remaining'],
  corrections: ['original_capture', 'method', 'amount'],
  tips: ['metric', 'value'],
  deposits: ['customer', 'state', 'amount'],
  by_category: ['category', 'item_net_sales'],
  staff_meals: ['item', 'quantity', 'customer'],
  order_ends: ['check', 'status', 'reason', 'note'],
  discounts: ['check', 'reason', 'type', 'value', 'approved'],
  comps: ['check', 'reason', 'kind'],
  refunds: ['check', 'method', 'amount', 'reason'],
  cash_moves: ['kind', 'amount', 'reason', 'user'],
  reprints: ['label', 'user', 'reason'],
  approvals: ['action', 'requester', 'approver', 'target'],
  open_drafts: ['check', 'age'],
  tenders_per_drawer: ['terminal', 'cashier', 'method', 'amount'],
};

/** Codes that appear as report values and deserve an Arabic word. */
export function codeLabel(v: string): string {
  const m = ({ OPEN: t('مفتوحة'), CLOSED: t('مقفولة'), VOIDED: t('ملغي'), CANCELLED: t('متلغي'), HELD: t('محجوز'), APPLIED: t('اتخصم'), REFUNDED: t('اترجع'), FORFEITED: t('اتصادر'), PAY_IN: t('إيداع'), PAY_OUT: t('صرف'), SAFE_DROP: t('تحويل للخزنة'), NO_SALE: t('فتح من غير بيع'), PERCENTAGE: t('نسبة'), FIXED_AMOUNT: t('مبلغ ثابت'), SALE: t('بيع'), STAFF_MEAL: t('وجبة موظف') } as Record<string, string>)[v];
  if (m) return m;
  const c = channelLabel(v);
  if (c !== v) return c;
  const meth = methodLabel(v);
  return meth;
}
