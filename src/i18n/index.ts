// i18n: Arabic first. UI strings are written in Arabic (Egyptian wording) and used as keys;
// the English UI comes from the single file ./en.ts. Missing English falls back to Arabic.
import { useSyncExternalStore } from 'react';
import { en } from './en';
import { arMsa } from './ar-msa';
import { techMode } from '../app/tech';

export type Lang = 'ar' | 'en';
const KEY = 'nerdpos.lang';
let lang: Lang = (() => { try { return (localStorage.getItem(KEY) as Lang) || 'ar'; } catch { return 'ar'; } })();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') { document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  listeners.forEach((f) => f());
}
export const getLang = () => lang;
export function useLang(): Lang {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => lang);
}

/** Translate an Arabic UI string. `{x}` placeholders are filled from vars. */
export function t(ar: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? en[ar] ?? miss(ar) : arMsa[ar] ?? ar;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return techMode.get() ? s : stripTech(s);
}

// Safety net for demo users: when technical details are off, drop parenthesised technical tokens such as
// " (PRICE_NOT_FOUND)", " (FloorIntakePolicy)", " (Order.Fire)", " (dryRun: true)", " (Idempotent-Replayed)".
// Only parentheses whose WHOLE content is such tokens are removed, so normal text and numbers are never touched.
const TOKEN = String.raw`(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+(?:\s+\d{3})?|[A-Z][A-Za-z]*Policy(?:\[[A-Z_]+\])?|[A-Z][a-z]+(?:[A-Z][a-z]+)*\.[A-Z][A-Za-z]+(?:@\d+)?|[a-z][A-Za-z]*:\s*(?:true|false|null|\d+)|[A-Z][a-z]+(?:-[A-Z][a-z]+)+(?::\s*\w+)?|[A-Z]{1,6}:[A-Za-z0-9_:.-]+)`;
const TECH_PAREN = new RegExp(String.raw`\s?\((?:${TOKEN})(?:\s*[,،·/|]\s*(?:${TOKEN}))*\)`, 'g');
export function stripTech(s: string): string {
  if (!s || s.indexOf('(') < 0) return s;
  return s.replace(TECH_PAREN, '');
}

// QA aid: in English mode, Arabic keys with no English are collected on window.__i18nMiss (read by the scan script).
const AR_RE = /[\u0600-\u06FF]/;
function miss(ar: string): string {
  if (typeof window !== 'undefined' && ar && AR_RE.test(ar)) ((window as unknown as { __i18nMiss?: Set<string> }).__i18nMiss ??= new Set()).add(ar);
  return ar;
}

/** Translate a seeded data value (branch, device, supplier, unit, reason… stored in Arabic) when English exists in en.ts. */
export function tv(v: string | null | undefined): string {
  if (!v) return v as unknown as string; // keep null/undefined so `tv(x) ?? '—'` still falls back
  return lang === 'en' ? en[v] ?? miss(v) : arMsa[v] ?? v;
}

// Server-made one-line labels ("إيصال #1042", "#1042 · جولة 2", "إقفال يوم 2026-10-25") → English fragments.
const LABEL_FRAGMENTS: [RegExp, string][] = [
  [/إقفال يوم /g, 'Day close '], [/إيصال مرتجع /g, 'Refund receipt '], [/شيك مبدئي /g, 'Pre-bill '], [/إيصال /g, 'Receipt '], [/^نسخة /g, 'Copy '],
  [/ · جولة /g, ' · round '], [/ · ترابيزة /g, ' · table '], [/ · تيك أواي/g, ' · takeaway'], [/ · دليفري/g, ' · delivery'], [/من غير إيصال/g, 'no receipt'],
  [/^تسوية /g, 'Settlement '], [/ عملية\)/g, ' transactions)'], [/^درج /g, 'Drawer '], [/^من /g, 'from '], [/(\d) م$/g, '$1 PM'], [/(\d) ص$/g, '$1 AM'],
  [/^مبيعات يوم (\S+) \(بيانات العرض\)$/g, 'Sales on $1 (demo data)'], [/^خبز-/g, 'BREAD-'], [/\u2068?ج\.م\u2069?/g, 'EGP'],
];
// Arabic mode: server-made labels/values use the glossary terms (docs/ux/WRITING_GUIDE.md). A whole known string comes
// from arMsa; otherwise colloquial glossary words are swapped (an optional و/ف + بال/لل/كال/ال/ب/ل/ك prefix is kept).
const AR_L = 'ء-ي';
const arTerm = (from: string, to: string): [RegExp, string] => [new RegExp(`(?<![${AR_L}])([وف]?(?:بال|لل|كال|ال|ب|ل|ك)?)${from}(?![${AR_L}])`, 'g'), `$1${to}`];
const AR_GLOSSARY: [RegExp, string][] = [
  [/إقفال يوم /g, 'إغلاق يوم '], [/من غير إيصال/g, 'بلا إيصال'], [/من غير درج/g, 'بلا درج'],
  // Owner decision: شيك، ترابيزة، ويتر، تيك أواي، دليفري، طيار stay as they are; only non-owner colloquial words are swapped.
  arTerm('ويترية', 'ويترز'), arTerm('منيوهات', 'قوائم'), arTerm('منيو', 'قائمة'), arTerm('سيستم', 'نظام'),
  // ux-08: ux-07 leftovers — cash/card, customer, taxes, currency (wallet brands such as «فودافون كاش» keep their name)
  [new RegExp(`(?<!(?:فودافون|أورنج|اورنج|أورانج|اتصالات|وي)\\s)(?<![${AR_L}])([وف]?(?:بال|لل|كال|ال|ب|ل|ك)?)كاش(?![${AR_L}])`, 'g'), '$1نقدي'],
  arTerm('كروت', 'بطاقات'), arTerm('كارت', 'بطاقة'), arTerm('زباين', 'عملاء'), arTerm('زبون', 'عميل'), arTerm('ضرايب', 'ضرائب'),
  [/(\d[\d,.]*)\s*جنيه(?:ات|ًا)?(?![ء-ي])/g, '$1 ج.م'],
];
function arLabel(v: string): string {
  if (!v || !AR_RE.test(v)) return v;
  const known = arMsa[v];
  if (known) return known;
  let s = v;
  for (const [re, rep] of AR_GLOSSARY) s = s.replace(re, rep);
  return s;
}

/** Translate a server-made label: a whole known string via en.ts, otherwise known fragments. Arabic mode applies the glossary pass. */
export function tLabel(v: string | null | undefined): string {
  if (!v) return v ?? '';
  if (lang !== 'en') return arLabel(v);
  if (en[v]) return en[v];
  let s = v;
  for (const [re, rep] of LABEL_FRAGMENTS) s = s.replace(re, rep);
  return AR_RE.test(s) ? miss(s) : s;
}

/** Pick a localized server value {ar, en}. */
export function L(v: { ar?: string; en?: string } | string | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string') return lang === 'en' ? v : arLabel(v);
  return (lang === 'en' ? v.en || (v.ar && en[v.ar]) || miss(v.ar ?? '') : arLabel(v.ar || v.en || '')) ?? '';
}

// initialise document direction
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
