// Tender taxonomy in plain words (round 3, F3-05): "how did the money arrive?"
//   CASH كاش · CARD كارت (مكنة الكارت) · WALLET محفظة / تحويل (InstaPay, Vodafone Cash… — the provider is chosen once)
//   PREPAID مدفوع قبل كده (delivery app or payment link — internal code ONLINE) · POINTS نقاط (internal code LOYALTY) · عربون
// The internal method codes stay as they are (CARD, DIGITAL_WALLET, ONLINE, LOYALTY, DEPOSIT) — shown only with technical details on.
import { t } from '../i18n';

const BASE: Record<string, string> = { CASH: 'كاش', CARD: 'كارت', DIGITAL_WALLET: 'محفظة / تحويل', ONLINE: 'مدفوع قبل كده', LOYALTY: 'نقاط', LOYALTY_POINTS: 'نقاط', DEPOSIT: 'عربون', WALLET: 'محفظة / تحويل', PREPAID: 'مدفوع قبل كده', POINTS: 'نقاط' };
const PROVIDER: Record<string, string> = { INSTAPAY: 'إنستاباي', VODAFONE_CASH: 'فودافون كاش', ORANGE_CASH: 'أورنج كاش', ETISALAT_CASH: 'اتصالات كاش', ONLINE_CARD: 'لينك دفع بالكارت', WALLET: 'محفظة موبايل', PAYMENT_LINK: 'لينك دفع', CARD_TERMINAL: 'مكنة الكارت', DELIVERY_APP: 'تطبيق دليفري' };

/** Plain name of the taxonomy group (for buttons). */
export const tenderGroupLabel = (method: string) => t(BASE[method] ?? 'طريقة دفع تانية');
/** One payment in plain words: «إنستاباي», «فودافون كاش», «مدفوع قبل كده — طلبات», «كارت». `m` may be "METHOD:PROVIDER". */
export function tenderLabel(m: string, provider?: string | null): string {
  const [base, p0] = String(m).split(':');
  const p = provider ?? p0 ?? null;
  if (base === 'DIGITAL_WALLET' && p) return PROVIDER[p] ? t(PROVIDER[p]) : t('محفظة');
  if (base === 'ONLINE' && p) return `${t('مدفوع قبل كده')} — ${PROVIDER[p] ? t(PROVIDER[p]) : p}`;
  return t(BASE[base] ?? 'طريقة دفع تانية');
}
export const providerLabel = (p: string) => (PROVIDER[p] ? t(PROVIDER[p]) : p);
