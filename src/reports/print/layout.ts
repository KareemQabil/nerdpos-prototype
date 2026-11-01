// Print layout (pure, no React): a document model built from a pivot result (custom reports) or a certified run, and a
// deterministic paginator for A4 portrait / landscape and the 80 mm receipt. Every row has a fixed height (labels are
// cut with «…», never wrapped), so page breaks are known before rendering: the table header repeats on every page and
// additive columns carry a running subtotal («منقول من الصفحة اللي قبلها» / «يتنقل للصفحة اللي بعدها»). The preview,
// the PDF and the test all use this one layout. Carried-forward sums add the rows printed so far (decimal), and the
// test proves they meet the engine's grand total.
import type { Loc } from '../../mock/types';
import { D, m4 } from '../../mock/money';
import type { PivotResult } from '../pivot';
import type { ReportTemplate, ColumnView, NumberFormat } from '../studio';
import { exportTable } from '../export/table';
import { cellText, fmtNumber, pick, rangeText, dayText, type Lang } from '../format';
import { zonedParts } from '../../mock/clock';
/** An instant in Cairo local time, in words: «1 نوفمبر 2026، 16:44». */
export function cairoText(iso: string, lang: Lang): string { const p = zonedParts(Date.parse(iso), 'Africa/Cairo'); const d = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; return `${dayText(d, lang, true)}${lang === 'ar' ? '، ' : ', '}${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; }
import { flatten } from '../pivot';

export interface DocColumn { group: string | null; label: string; format: NumberFormat; unit?: string; carry: boolean }
export interface DocRow { label: string; depth: number; kind: 'group' | 'leaf' | 'others' | 'total' | 'plain'; terminal: boolean; cells: string[]; raw: (string | null)[]; tones: (string | null)[] }
export interface DocTable { title: string | null; rowHeader: string; columns: DocColumn[]; rows: DocRow[] }
export interface DocModel {
  lang: Lang; title: string; venue: { name: string; branches: string; logo: string | null; headerLines: string[]; footerLines: string[]; taxNumber: string | null };
  params: { label: string; value: string }[]; status: { provisional: boolean; reasons: string[]; closed: boolean; sandbox: boolean };
  generatedBy: string; generatedAt: string; definitions: string;
  kpis: { label: string; value: string }[]; tables: DocTable[]; chart: { title: string; points: { label: string; value: number; display: string }[] } | null;
  bridge: { label: string; amount: string; strong?: boolean }[] | null;
}
export type PageItem =
  | { t: 'header'; full: boolean } | { t: 'params' } | { t: 'kpis' } | { t: 'chart' } | { t: 'bridge' } | { t: 'notes' } | { t: 'signatures' }
  | { t: 'table'; table: number; rows: number[]; carryIn: string[] | null; carryOut: string[] | null; continued: boolean };
export interface Page { n: number; items: PageItem[] }
export interface PaperSize { w: number; h: number; margin: number }

export function paperOf(t: Pick<ReportTemplate, 'paper' | 'orientation' | 'margins'>): PaperSize {
  if (t.paper === 'RECEIPT_80') return { w: 80, h: 0, margin: 4 };
  const m = t.margins === 'narrow' ? 7 : 12;
  return t.orientation === 'landscape' ? { w: 297, h: 210, margin: m } : { w: 210, h: 297, margin: m };
}
/** Fixed heights in mm (the renderer uses the same numbers). */
export const H = { headerFull: 28, headerCompact: 10, params: 19, kpiRow: 19, chart: 60, bridgeHead: 8, bridgeRow: 6, notesBase: 9, noteLine: 4.6, tableTitle: 7, groupHead: 6.5, tableHead: 8, row: 6, carry: 6, signatures: 28, footer: 12, gap: 3 };
export const kpisPerRow = (t: Pick<ReportTemplate, 'orientation' | 'paper'>) => (t.paper === 'RECEIPT_80' ? 2 : t.orientation === 'landscape' ? 6 : 4);

const L = (lang: Lang, ar: string, en: string) => (lang === 'ar' ? ar : en);

/** A pivot result → the printable document (columns in the user's order, labels and formats applied). */
export function docFromPivot(r: PivotResult, o: { title: string; lang: Lang; view?: ColumnView[]; depth: number; venue: DocModel['venue']; generatedBy: string; generatedAt: string; chart?: 'none' | 'bars' | 'line'; sandbox?: boolean; filtersText?: string }): DocModel {
  const lang = o.lang;
  const tb = exportTable(r, o.view, lang, o.depth > 0 ? o.depth : 'all', o.title);
  const flat = flatten(r, o.depth > 0 ? o.depth : 'all', { withTotal: true });
  const rows: DocRow[] = tb.rows.map((rr, i) => ({
    label: rr.label, depth: rr.depth, kind: rr.kind, terminal: rr.kind !== 'total' && !flat[i].expanded,
    cells: rr.values.map((v, j) => cellText(v, tb.columns[j].format, lang, tb.columns[j].measure.unit)),
    raw: rr.values.map((v) => (v?.availability === 'AVAILABLE' ? v.value : null)), tones: rr.values.map((v) => (v as any)?.style?.tone ?? null),
  }));
  const single = r.cols.length > 0 && new Set(tb.columns.map((c) => c.measure.id)).size === 1;
  const columns: DocColumn[] = tb.columns.map((c) => ({ group: single ? null : c.group, label: single ? c.group ?? c.header : c.header, format: c.format, unit: c.measure.unit, carry: c.measure.additive }));
  const first = tb.columns.filter((c) => c.colKey === '' && (c.measure.kind === 'value' || c.measure.kind === 'calc')).slice(0, 6);
  const kpis = first.map((c) => ({ label: c.header, value: cellText(r.root.cells[''][c.measure.id], c.format, lang, c.measure.unit) }));
  const chartCol = tb.columns.find((c) => c.colKey === '' && c.measure.kind === 'value');
  const chart = o.chart && o.chart !== 'none' && chartCol && r.rows.length ? { title: chartCol.header, points: r.root.children.slice(0, 14).map((n) => ({ label: pick(n.label, lang), value: Number(n.cells['']?.[chartCol.measure.id]?.value ?? 0), display: cellText(n.cells['']?.[chartCol.measure.id], chartCol.format, lang, chartCol.measure.unit) })) } : null;
  return {
    lang, title: o.title, venue: o.venue, generatedBy: o.generatedBy, generatedAt: o.generatedAt,
    params: paramsOf(r, lang, o.filtersText),
    status: { provisional: r.meta.provisional, reasons: r.meta.provisionalReasons.map((x) => pick(x, lang)), closed: r.meta.days.every((d) => d.status === 'CLOSED'), sandbox: !!o.sandbox },
    definitions: r.measures.filter((m) => m.metric).map((m) => `${pick(m.label, lang)}`).slice(0, 8).join('، '),
    kpis, tables: [{ title: single ? tb.columns[0]?.header ?? null : null, rowHeader: tb.rowHeader, columns, rows }], chart, bridge: null,
  };
}
export function paramsOf(r: PivotResult, lang: Lang, filtersText?: string): { label: string; value: string }[] {
  const p = [
    { label: L(lang, 'الفترة', 'Period'), value: rangeText(r.meta.from, r.meta.to, lang) },
    { label: L(lang, 'اليوم التجاري', 'Business day'), value: L(lang, `من ${r.meta.cutoff} الفجر لـ ${r.meta.cutoff} الفجر بتوقيت القاهرة`, `${r.meta.cutoff} to ${r.meta.cutoff}, Cairo time`) },
    { label: L(lang, 'لحد', 'As of'), value: cairoText(r.meta.asOf, lang) },
    { label: L(lang, 'الحالة', 'Status'), value: r.meta.provisional ? L(lang, 'مبدئي — ممكن يتغير', 'Provisional — may change') : L(lang, 'نهائي — الأيام مقفولة', 'Final — days closed') },
  ];
  if (r.meta.compare) p.push({ label: L(lang, 'المقارنة', 'Compared with'), value: `${pick(r.meta.compare.label, lang)} (${rangeText(r.meta.compare.from, r.meta.compare.to, lang)})` });
  if (filtersText) p.push({ label: L(lang, 'الفلاتر', 'Filters'), value: filtersText });
  return p;
}

/** A certified run (sections from Report.Run / Report.Export) → the printable document. */
export function docFromCertified(run: any, o: { lang: Lang; venue: DocModel['venue']; generatedBy: string; generatedAt: string; sandbox?: boolean }): DocModel {
  const lang = o.lang; const h = run.header;
  const MONEY = /^-?\d+\.\d{4}$/;
  const tables: DocTable[] = (run.sections ?? []).map((s: any) => ({
    title: pick(s.title, lang), rowHeader: s.columns?.[0] ?? '', columns: (s.columns ?? []).slice(1).map((c: string) => ({ group: null, label: c, format: 'money' as NumberFormat, carry: false })),
    rows: (s.rows ?? []).map((row: any[]) => { const total = typeof row[0] === 'string' && /الإجمالي|الفرق/.test(row[0]); return { label: String(row[0] ?? ''), depth: 0, kind: total ? 'total' as const : 'plain' as const, terminal: !total, raw: row.slice(1).map((c) => (typeof c === 'string' && MONEY.test(c) ? c : null)), tones: row.slice(1).map(() => null), cells: row.slice(1).map((c) => (c === 'CAPABILITY_NOT_AVAILABLE' ? L(lang, 'مش متاح', 'Not available') : typeof c === 'string' && MONEY.test(c) ? fmtNumber(c, 'money', lang) : String(c ?? ''))) }; }),
  }));
  const kpis = (run.kpis ?? []).map((k: any) => ({ label: pick(k.label, lang), value: cellText(k.value, k.unit === '%' ? 'pct' : k.unit === 'count' || k.unit === 'unit' ? 'number0' : 'money', lang, k.unit) }));
  const bridge = run.bridge ? [...run.bridge.sales.map((x: any) => ({ label: pick(x.label, lang), amount: fmtNumber(x.amount, 'money', lang), strong: !!x.total })), ...run.bridge.money.map((x: any) => ({ label: pick(x.label, lang), amount: fmtNumber(x.amount, 'money', lang), strong: !!x.total }))] : null;
  return {
    lang, title: pick(run.title, lang), venue: o.venue, generatedBy: o.generatedBy, generatedAt: o.generatedAt,
    params: [
      { label: L(lang, 'الفترة', 'Period'), value: rangeText(h.period.from, h.period.to, lang) },
      { label: L(lang, 'اليوم التجاري', 'Business day'), value: L(lang, `من ${h.cutoff} الفجر لـ ${h.cutoff} الفجر بتوقيت القاهرة`, `${h.cutoff} to ${h.cutoff}, Cairo time`) },
      { label: L(lang, 'لحد', 'As of'), value: cairoText(String(h.asOf), lang) },
      { label: L(lang, 'الحالة', 'Status'), value: h.provisional ? L(lang, 'مبدئي — ممكن يتغير', 'Provisional — may change') : L(lang, 'نهائي — الأيام مقفولة', 'Final — days closed') },
    ],
    status: { provisional: h.provisional, reasons: (h.provisionalReasons ?? []).map((x: Loc) => pick(x, lang)), closed: !!h.closed, sandbox: !!o.sandbox },
    definitions: (h.metrics ?? []).slice(0, 8).map((m: any) => `${pick(m.label, lang)} v${m.version}`).join('، '),
    kpis, tables, chart: null, bridge,
  };
}

/** Deterministic pages. */
export function paginate(doc: DocModel, t: ReportTemplate): Page[] {
  const paper = paperOf(t);
  const receipt = t.paper === 'RECEIPT_80';
  const avail = receipt ? Infinity : paper.h - 2 * paper.margin - H.footer;
  const pages: Page[] = [];
  let cur: Page; let used = 0;
  const open = (first: boolean) => { cur = { n: pages.length + 1, items: [{ t: 'header', full: first }] }; pages.push(cur); used = first ? H.headerFull : H.headerCompact; };
  const fits = (h: number) => used + h <= avail;
  const place = (item: PageItem, h: number) => { if (!fits(h) && cur.items.length > 1) open(false); cur.items.push(item); used += h + H.gap; };
  open(true);
  if (t.header.params) { cur!.items.push({ t: 'params' }); used += H.params + H.gap; }
  if (t.blocks.kpis && doc.kpis.length) place({ t: 'kpis' }, Math.ceil(doc.kpis.length / kpisPerRow(t)) * H.kpiRow);
  if (t.blocks.chart && doc.chart && !receipt) place({ t: 'chart' }, H.chart);
  if (t.blocks.bridge && doc.bridge?.length) place({ t: 'bridge' }, H.bridgeHead + doc.bridge.length * H.bridgeRow);
  if (t.blocks.table) doc.tables.forEach((tb, ti) => {
    if (!tb.rows.length) return;
    const head = (tb.title ? H.tableTitle : 0) + H.tableHead + (tb.columns.some((c) => c.group) ? H.groupHead : 0);
    const carryOn = !receipt && tb.columns.some((c) => c.carry);
    if (t.blocks.tableOnNewPage && ti === 0 && cur!.items.length > 1 + (t.header.params ? 1 : 0)) open(false);
    let i = 0; let continued = false;
    const running = tb.columns.map(() => D(0));
    const carryText = () => tb.columns.map((c, j) => (c.carry ? fmtNumber(m4(running[j]), c.format, doc.lang, c.unit) : ''));
    while (i < tb.rows.length) {
      const carryIn = continued && carryOn ? carryText() : null;
      const need0 = head + (carryIn ? H.carry : 0) + H.row + (i + 1 < tb.rows.length && carryOn ? H.carry : 0);
      if (!fits(need0)) open(false);
      let h = head + (carryIn ? H.carry : 0);
      const rows: number[] = [];
      while (i < tb.rows.length) {
        const last = i === tb.rows.length - 1;
        const needRow = H.row + (!last && carryOn ? H.carry : 0);
        if (!receipt && used + h + needRow > avail && rows.length) break;
        rows.push(i);
        const row = tb.rows[i];
        if (row.terminal) row.raw.forEach((v, j) => { if (tb.columns[j].carry && v !== null) running[j] = running[j].plus(D(v)); });
        h += H.row; i++;
      }
      const more = i < tb.rows.length;
      const carryOut = more && carryOn ? carryText() : null;
      if (carryOut) h += H.carry;
      cur!.items.push({ t: 'table', table: ti, rows, carryIn, carryOut, continued });
      used += h + H.gap;
      continued = true;
      if (more) open(false);
    }
  });
  if (t.blocks.notes && t.notes.trim()) place({ t: 'notes' }, H.notesBase + Math.ceil(t.notes.length / (receipt ? 40 : t.orientation === 'landscape' ? 150 : 100)) * H.noteLine);
  if (t.footer.signatures?.length) place({ t: 'signatures' }, H.signatures);
  return pages;
}
