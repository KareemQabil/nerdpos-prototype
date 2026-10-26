// Display formatting only. The browser formats server money; it never computes a price, total, tax or change.
import { getLang } from '../i18n';

export function money(v: string | number | null | undefined, withCurrency = true): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = String(v);
  const neg = s.startsWith('-');
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.');
  const frac = (f + '00').slice(0, 2);
  // round half-up on the third decimal for display of scale-4 server strings
  let intPart = i, fracPart = frac;
  if (f.length > 2 && Number(f[2]) >= 5) {
    const cents = (BigInt(i) * 100n + BigInt(frac) + 1n).toString().padStart(3, '0');
    intPart = cents.slice(0, -2); fracPart = cents.slice(-2);
  }
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const out = `${neg ? '-' : ''}${grouped}.${fracPart}`;
  return withCurrency ? `${out} ${getLang() === 'ar' ? 'ج.م' : 'EGP'}` : out;
}

export function qty(v: string | number): string {
  const s = String(v);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  return clock(new Date(iso));
}
// Arabic: "07:05 م" with Western digits and a colon (some ICU builds print "07.05" for ar-EG).
function clock(d: Date, withDate = false): string {
  const ar = getLang() === 'ar';
  const parts = new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { timeZone: 'Africa/Cairo', ...(withDate ? { day: '2-digit', month: 'short' } : {}), hour: '2-digit', minute: '2-digit', hour12: ar }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  const hm = `${get('hour')}:${get('minute')}`;
  const tm = ar ? `${hm} ${get('dayPeriod')}`.trim() : hm;
  return withDate ? `${get('day')} ${get('month')} ${tm}` : tm;
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return clock(new Date(iso), true);
}
export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
