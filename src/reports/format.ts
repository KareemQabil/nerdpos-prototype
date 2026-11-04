// Pure value formatting shared by the screen, the print layout and the files (no React): numbers are Western digits,
// tabular, with thousands separators; money with 2 decimals and «ج.م» after the number; NOT_AVAILABLE is never shown as 0.
import type { Loc } from '../mock/types';
import type { MetricValue, Unit } from './types';
import type { NumberFormat } from './studio';

export type Lang = 'ar' | 'en';
export const pick = (l: Loc | null | undefined, lang: Lang) => (l ? l[lang] || l.ar : '');
const NUM = (n: number, min: number, max: number) => n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max });

/** The number format a column uses when the user did not choose one. */
export function autoFormat(unit: Unit | 'rank' | string | undefined): NumberFormat {
  if (!unit || unit.startsWith('EGP')) return 'money';
  if (unit === '%') return 'pct';
  if (unit === 'count' || unit === 'rank') return 'number0';
  return 'number';
}
export function fmtNumber(v: string | number | null | undefined, format: NumberFormat, lang: Lang = 'ar', unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const f = format === 'auto' ? autoFormat(unit) : format;
  const cur = 'ج.م'; // owner rule: always «ج.م», after the number (both UI languages)
  if (f === 'money') return `${NUM(n, 2, 2)} ${cur}`;
  if (f === 'money0') return `${NUM(Math.round(n), 0, 0)} ${cur}`;
  if (f === 'pct') return `${NUM(n, 1, 1)}%`;
  if (f === 'number0') return NUM(Math.round(n * 100) / 100, 0, Number.isInteger(n) ? 0 : 2);
  if (unit === 'minutes') return `${NUM(n, 1, 1)} ${lang === 'ar' ? 'دقيقة' : 'min'}`;
  return NUM(n, 0, 2);
}
export const NA_TEXT: Record<Lang, string> = { ar: 'مش متاح', en: 'Not available' };
export const REFUSED_TEXT: Record<Lang, string> = { ar: 'اترفض', en: 'Refused' };
/** A cell as text (print / CSV): never «0» for something that is not available. */
export function cellText(v: MetricValue | undefined, format: NumberFormat, lang: Lang, unit?: string): string {
  if (!v) return '—';
  if (v.availability === 'NOT_AVAILABLE') return NA_TEXT[lang];
  if (v.availability === 'REFUSED') return REFUSED_TEXT[lang];
  if (v.availability === 'NOT_DEFINED' || v.value === null) return '—';
  return fmtNumber(v.value, format, lang, unit);
}
/** Excel number formats per column format (the value stays a number in the file). */
export function excelFormat(format: NumberFormat, lang: Lang): string {
  const cur = 'ج.م';
  if (format === 'money') return `#,##0.00 "${cur}";-#,##0.00 "${cur}"`;
  if (format === 'money0') return `#,##0 "${cur}";-#,##0 "${cur}"`;
  if (format === 'pct') return '0.0"%"';
  if (format === 'number0') return '#,##0';
  return '#,##0.##';
}

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** «26 أكتوبر» / «Oct 26» (year added when it is not the current one). */
export function dayText(d: string, lang: Lang = 'ar', withYear = false): string {
  const [y, m, dd] = d.split('-').map(Number);
  if (!y || !m || !dd) return d;
  return lang === 'ar' ? `${dd} ${MONTHS_AR[m - 1]}${withYear ? ' ' + y : ''}` : `${MONTHS_EN[m - 1]} ${dd}${withYear ? ', ' + y : ''}`;
}
/** A business-date range in words: «من 26 أكتوبر لـ 1 نوفمبر 2026» — no arrows that flip in right-to-left text. */
export function rangeText(from: string, to: string, lang: Lang = 'ar'): string {
  const y = from.slice(0, 4) !== to.slice(0, 4);
  if (from === to) return dayText(from, lang, true);
  return lang === 'ar' ? `من ${dayText(from, lang, y)} لـ ${dayText(to, lang, true)}` : `${dayText(from, lang, y)} – ${dayText(to, lang, true)}`;
}
