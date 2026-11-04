// ux-16 «الجدول الموحّد» — the pure logic of the one table system (no React, no DOM): column kinds and their alignment,
// deterministic sorting (money and quantities as Decimal strings, never floating point; dates; text by the UI
// language's collation; empty values always last), footer totals (Decimal), the truncation decision, computed column
// widths, the viewer's density (a per-viewer convenience in localStorage, wrapped in try/catch) and the adapter that
// maps the older <Table head rows align> API onto typed columns. Rendered by ./DataTable.tsx on TanStack Table.
import Decimal from 'decimal.js';

export type ColKind = 'text' | 'money' | 'qty' | 'number' | 'status' | 'date' | 'day' | 'time' | 'actions' | 'custom';
export type ColAlign = 'start' | 'end' | 'center';
export type Density = 'comfortable' | 'compact';
export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;

/** Ant Design's alignment rules: numbers, money and quantities end-aligned (tabular figures); actions at the end;
 *  status, text and dates start-aligned. */
export function alignOf(kind: ColKind, align?: ColAlign): ColAlign {
  if (align) return align;
  if (kind === 'money' || kind === 'qty' || kind === 'number' || kind === 'actions') return 'end';
  return 'start';
}
/** Kinds whose values are sortable by default (actions and free cells are not). */
export const sortableKind = (kind: ColKind) => kind !== 'actions' && kind !== 'custom';

const DEC = /^\s*-?\d+(\.\d+)?\s*$/;
/** A Decimal of a server number string (or a plain integer count), or null when empty / not a number. */
export function decOf(v: SortValue): Decimal | null {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v).replace(/,/g, '');
  if (!DEC.test(s)) return null;
  return new Decimal(s.trim());
}
const isEmpty = (v: SortValue) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
/** Time of an ISO date / date-time string (business dates 'YYYY-MM-DD' compare as UTC midnight). */
export function timeOf(v: SortValue): number | null {
  if (isEmpty(v)) return null;
  if (typeof v === 'number') return v;
  const ms = Date.parse(String(v));
  return Number.isNaN(ms) ? null : ms;
}

let collators: Record<string, Intl.Collator> = {};
const collator = (lang: string) => (collators[lang] ??= new Intl.Collator(lang === 'ar' ? 'ar' : 'en', { numeric: true, sensitivity: 'base' }));

/** Ascending comparison of two present values of one kind (empty values are handled by the caller). */
export function compareValues(kind: ColKind, a: SortValue, b: SortValue, lang = 'ar'): number {
  if (kind === 'money' || kind === 'qty' || kind === 'number') {
    const da = decOf(a), db = decOf(b);
    if (da && db) return da.comparedTo(db);
    if (da) return -1; if (db) return 1;
    return 0;
  }
  if (kind === 'date' || kind === 'day' || kind === 'time') {
    const ta = timeOf(a), tb = timeOf(b);
    if (ta !== null && tb !== null) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if (ta !== null) return -1; if (tb !== null) return 1;
    return 0;
  }
  return collator(lang).compare(String(a), String(b));
}

/** Sorted row indices: stable (equal values keep the original order), empty values always last in both directions. */
export function sortIndices<T>(rows: T[], value: (row: T) => SortValue, kind: ColKind, dir: SortDir | null, lang = 'ar'): number[] {
  const idx = rows.map((_, i) => i);
  if (!dir) return idx;
  const vals = rows.map(value);
  const empty = vals.map((v) => isEmpty(v) || ((kind === 'money' || kind === 'qty' || kind === 'number') && !decOf(v)) || ((kind === 'date' || kind === 'day' || kind === 'time') && timeOf(v) === null));
  return idx.sort((i, j) => {
    if (empty[i] || empty[j]) return empty[i] && empty[j] ? i - j : empty[i] ? 1 : -1;
    const c = compareValues(kind, vals[i], vals[j], lang);
    if (c !== 0) return dir === 'desc' ? -c : c;
    return i - j;
  });
}

/** Ant Design's cycle on a header: none → ascending → descending → none. */
export const nextSort = (cur: SortDir | null | false | undefined): SortDir | null => (cur === 'asc' ? 'desc' : cur === 'desc' ? null : 'asc');

/** Footer total of a money / quantity / number column: Decimal sum of the present values, as a fixed-scale string
 *  (money 4, quantity 6 trimmed by the formatter, numbers as summed); null when no row has a value. */
export function totalOf<T>(rows: T[], value: (row: T) => SortValue, kind: ColKind): string | null {
  let sum: Decimal | null = null;
  for (const r of rows) { const d = decOf(value(r)); if (d) sum = (sum ?? new Decimal(0)).plus(d); }
  if (!sum) return null;
  return kind === 'money' ? sum.toFixed(4) : kind === 'qty' ? sum.toFixed(6) : sum.toFixed();
}

/** Characters of a string as the reader sees them (an Arabic letter with its harakat, an emoji, counts once). */
export function visibleLength(s: string): number {
  return [...s.replace(/[ً-ْٰ‌-‏⁦-⁩]/g, '')].length;
}
/** The truncation decision of a text cell: cut (ellipsis + the whole text on hover / focus) when it is longer than the
 *  column's limit. A column without a limit never cuts. */
export const truncates = (text: string | null | undefined, maxChars?: number) => !!text && !!maxChars && visibleLength(text) > maxChars;

/** Default character budgets per kind (the width of the column is computed from its content within these). */
export const KIND_CH: Record<ColKind, { min: number; max: number }> = {
  money: { min: 9, max: 18 }, qty: { min: 5, max: 12 }, number: { min: 4, max: 12 }, status: { min: 7, max: 18 },
  date: { min: 13, max: 16 }, day: { min: 9, max: 12 }, time: { min: 7, max: 9 }, text: { min: 8, max: 40 }, actions: { min: 4, max: 30 }, custom: { min: 0, max: 0 },
};
/** Computed width of a column in `ch`: the longest of its header and its cells' display texts, clamped to the kind's
 *  budget (money adds room for the currency). Text columns with a limit take at most the limit; otherwise `null`
 *  (the column takes the remaining width). */
export function widthCh(kind: ColKind, header: string, texts: string[], opts: { maxChars?: number; width?: number } = {}): number | null {
  if (opts.width) return opts.width;
  if (kind === 'custom' || (kind === 'text' && !opts.maxChars)) return null;
  const b = KIND_CH[kind];
  const longest = Math.max(0, ...texts.map(visibleLength));
  const extra = kind === 'money' ? 4 : kind === 'status' ? 3 : 0;
  const body = kind === 'text' ? Math.min(longest, opts.maxChars ?? b.max) : longest + extra;
  return Math.max(b.min, Math.min(b.max, Math.max(body, Math.ceil(visibleLength(header) * 0.9))));
}

// ── density: a per-viewer convenience (never business state); the table's own default applies until the viewer picks one
const DKEY = 'nerdpos.table.density.v1';
let density: Density | null = (() => { try { const v = typeof localStorage !== 'undefined' ? localStorage.getItem(DKEY) : null; return v === 'compact' || v === 'comfortable' ? v : null; } catch { return null; } })();
const dl = new Set<() => void>();
export const getDensity = () => density;
export function setDensity(d: Density | null) {
  density = d;
  try { if (typeof localStorage !== 'undefined') { if (d) localStorage.setItem(DKEY, d); else localStorage.removeItem(DKEY); } } catch { /* storage blocked: keep it for this page only */ }
  dl.forEach((f) => f());
}
export const subscribeDensity = (cb: () => void) => { dl.add(cb); return () => { dl.delete(cb); }; };
/** The density a table renders with: the viewer's choice, else the table's default (`dense` → compact). */
export const effectiveDensity = (viewer: Density | null, dense?: boolean): Density => viewer ?? (dense ? 'compact' : 'comfortable');

// ── the older API: <Table head rows align …> → typed columns (cells are already rendered, so not sortable)
export interface LegacyCol { id: string; index: number; kind: 'custom'; align: ColAlign; sortable: false }
export function legacyColumns(head: unknown[], align?: (ColAlign | undefined)[]): LegacyCol[] {
  return head.map((_, j) => ({ id: `c${j}`, index: j, kind: 'custom', align: align?.[j] ?? 'start', sortable: false }));
}
