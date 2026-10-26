// i18n: Arabic first. UI strings are written in Arabic (Egyptian wording) and used as keys;
// the English UI comes from the single file ./en.ts. Missing English falls back to Arabic.
import { useSyncExternalStore } from 'react';
import { en } from './en';
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
  let s = lang === 'en' ? en[ar] ?? miss(ar) : ar;
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
  return lang === 'en' ? en[v] ?? miss(v) : v;
}

// Server-made one-line labels ("إيصال #1042", "#1042 · جولة 2", "إقفال يوم 2026-10-25") → English fragments.
const LABEL_FRAGMENTS: [RegExp, string][] = [
  [/إقفال يوم /g, 'Day close '], [/إيصال مرتجع /g, 'Refund receipt '], [/شيك مبدئي /g, 'Pre-bill '], [/إيصال /g, 'Receipt '], [/^نسخة /g, 'Copy '],
  [/ · جولة /g, ' · round '], [/ · ترابيزة /g, ' · table '], [/ · تيك أواي/g, ' · takeaway'], [/ · دليفري/g, ' · delivery'], [/من غير إيصال/g, 'no receipt'],
  [/^تسوية /g, 'Settlement '], [/ عملية\)/g, ' transactions)'], [/^درج /g, 'Drawer '], [/^من /g, 'from '], [/(\d) م$/g, '$1 PM'], [/(\d) ص$/g, '$1 AM'],
  [/^مبيعات يوم (\S+) \(بيانات العرض\)$/g, 'Sales on $1 (demo data)'], [/^خبز-/g, 'BREAD-'],
];
/** Translate a server-made label: a whole known string via en.ts, otherwise known fragments. Arabic mode returns it unchanged. */
export function tLabel(v: string | null | undefined): string {
  if (!v || lang !== 'en') return v ?? '';
  if (en[v]) return en[v];
  let s = v;
  for (const [re, rep] of LABEL_FRAGMENTS) s = s.replace(re, rep);
  return AR_RE.test(s) ? miss(s) : s;
}

/** Pick a localized server value {ar, en}. */
export function L(v: { ar?: string; en?: string } | string | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return (lang === 'en' ? v.en || (v.ar && en[v.ar]) || miss(v.ar ?? '') : v.ar || v.en) ?? '';
}

// initialise document direction
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}
