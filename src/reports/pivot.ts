// L3 «التقسيم» — the pivot / tabular result model over the ONE query engine (engine.ts). Nothing here re-implements a
// metric: every value at every level comes from query() run at that grouping, so
//  • subtotals and the grand total are recomputed per metric additivity (ratios Σnum/Σden, distinct counts recounted,
//    semi-additive stock a snapshot) — never a sum of the rows shown;
//  • the «الباقي» bucket of a top-N (or of rows hidden by a condition) is evaluated exactly with an «in» filter;
//  • comparisons / MTD / YTD / rolling windows run the same pivot on the other period and match rows by path;
//    a period with no data (or only imported daily totals that do not carry the breakdown) is NOT_AVAILABLE, never 0;
//  • calculated columns are only ratio / difference / share of registered, summable metrics (formula returned);
//  • formatting rules are data, evaluated here so the screen and the files show the same colours;
//  • every cell carries the path that Report.Explain needs (a subtotal's evidence = the union of its children).
import type { DB, Loc } from '../mock/types';
import { D, m4 } from '../mock/money';
import { zonedParts } from '../mock/clock';
import { query, ReportRefusal, NULL_KEY, preLaunchCoverage, EVAL, type Caller, type QueryOpts } from './engine';
import { metricById } from './registry/metrics';
import { dimensionById } from './registry/dimensions';
import { addDays, weekOf } from './facts';
import type { MetricValue, QueryMeta, QueryResult, Fact, Unit } from './types';

export type CompareMode = 'previous_period' | 'last_week' | 'last_year';
export type ExtraKind = 'share_total' | 'share_parent' | 'rank' | 'mtd' | 'ytd' | 'rolling7' | 'rolling28';
export type MeasureKind = 'value' | 'compare' | 'change' | 'change_pct' | ExtraKind | 'calc';
export interface CalcDef { id: string; kind: 'ratio' | 'difference' | 'share'; a: string; b: string; label?: Loc }
export interface HavingRule { measure: string; op: 'gt' | 'gte' | 'lt' | 'lte'; value: string }
export interface FormatRule { id: string; measure: string; kind: 'scale' | 'threshold' | 'topbottom' | 'arrows'; op?: 'lt' | 'gt'; value?: string; n?: number; highIsGood?: boolean; tone?: 'good' | 'bad' | 'warn' }
export interface PivotSpec {
  metrics: string[];            // the columns the user picked (registered metric ids)
  hidden?: string[];            // registered metrics used only as parts of calculated columns
  rows?: string[];              // nested row breakdowns, outer → inner (≤ 4)
  columns?: string[];           // optional cross-tab breakdown(s) (≤ 2)
  filters?: Record<string, string[]>; exclude?: Record<string, string[]>;
  from: string; to?: string; branchIds?: string[]; asOf?: string;
  compare?: CompareMode | null;
  extras?: ExtraKind[]; extrasFor?: string[]; // extra measures, for these metrics (default: the first metric)
  topN?: { n: number; by?: string; others?: boolean } | null;
  sort?: { by: string; dir: 'asc' | 'desc' } | null; // by = measure id or 'label'
  having?: HavingRule[]; calcs?: CalcDef[]; formats?: FormatRule[];
}
export interface CellStyle { tone?: 'good' | 'bad' | 'warn'; scale?: number; icon?: 'up' | 'down' | 'flat' }
export type Cell = MetricValue & { style?: CellStyle };
export interface PivotNode {
  id: string; level: number; dim: string | null; value: string | null; label: Loc;
  path: Record<string, string>;  // filter-ready (null → «∅», «الباقي» → comma list) — Report.Explain «cell»
  others?: number;               // «الباقي»: how many rows it gathers
  cells: Record<string, Record<string, Cell>>; // colKey ('' = row total) → measure id → value
  children: PivotNode[];
}
export interface ColHead { key: string; path: Record<string, string>; labels: Loc[] }
export interface MeasureMeta {
  id: string; metric: string | null; kind: MeasureKind; label: Loc; unit: Unit | 'rank'; formula: Loc | null;
  period: { from: string; to: string; asOf?: string } | null; // evidence period (null → not provable cell by cell)
  additive: boolean; // a plain sum across sibling leaf rows equals the parent (carried-forward subtotals in print)
  inColumns: boolean; // shown under every cross-tab column (else only in the total column)
}
export interface PivotResult {
  spec: PivotSpec; meta: QueryMeta & { notes: Loc[]; compare: { from: string; to: string; label: Loc } | null };
  rows: string[]; columns: string[]; dimLabels: Record<string, Loc>; cols: ColHead[]; measures: MeasureMeta[]; root: PivotNode; nodeCount: number;
}

const L = (ar: string, en: string): Loc => ({ ar, en });
const TIME_DIMS = new Set(['business_date', 'business_week', 'weekday', 'hour', 'daypart']);
const DAYPART_ORDER = ['BREAKFAST', 'LUNCH', 'DINNER', 'LATE'];
const timeOrder = (dim: string, v: string | null) => (v === null ? 'zz' : dim === 'weekday' ? String((Number(v) + 1) % 7) : dim === 'daypart' ? String(DAYPART_ORDER.indexOf(v)) : v);
const NA = (reason: Loc): Cell => ({ value: null, availability: 'NOT_AVAILABLE', reason });
const ND = (reason: Loc): Cell => ({ value: null, availability: 'NOT_DEFINED', reason });
const OK = (v: any, extra: Partial<Cell> = {}): Cell => ({ value: m4(v), availability: 'AVAILABLE', ...extra });
const avail = (c?: Cell | MetricValue) => !!c && c.availability === 'AVAILABLE' && c.value !== null;
const keyOfPath = (dims: string[], vals: Record<string, string | null | undefined>) => dims.map((d) => vals[d] ?? NULL_KEY).join('\u0001');
const fkey = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? NULL_KEY : String(v));
const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;

/** End of a business date (04:00 Cairo the next calendar day), as epoch ms. */
export function businessDayEndMs(date: string): number {
  const next = addDays(date, 1);
  const guess = Date.UTC(+next.slice(0, 4), +next.slice(5, 7) - 1, +next.slice(8, 10), 4, 0);
  const p = zonedParts(guess, 'Africa/Cairo');
  return guess - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess);
}

export type PeriodPreset = 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'LAST_WEEK' | 'LAST_7' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
/** Saved designs keep a relative period; it resolves on the server's business date when the report runs. */
export function resolvePeriod(preset: PeriodPreset, today: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  switch (preset) {
    case 'TODAY': return { from: today, to: today };
    case 'YESTERDAY': return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'THIS_WEEK': return { from: weekOf(today), to: today };
    case 'LAST_WEEK': { const s = addDays(weekOf(today), -7); return { from: s, to: addDays(s, 6) }; }
    case 'LAST_7': return { from: addDays(today, -6), to: today };
    case 'THIS_MONTH': return { from: today.slice(0, 8) + '01', to: today };
    case 'LAST_MONTH': { const first = today.slice(0, 8) + '01'; const end = addDays(first, -1); return { from: end.slice(0, 8) + '01', to: end }; }
    default: return { from: custom?.from ?? today, to: custom?.to ?? custom?.from ?? today };
  }
}
export function comparePeriod(mode: CompareMode, from: string, to: string): { from: string; to: string; label: Loc } {
  if (mode === 'last_week') return { from: addDays(from, -7), to: addDays(to, -7), label: L('نفس الأيام الأسبوع اللي فات', 'Same days last week') };
  if (mode === 'last_year') return { from: addDays(from, -364), to: addDays(to, -364), label: L('نفس الأيام السنة اللي فاتت', 'Same days last year') };
  const n = daysBetween(from, to); const pto = addDays(from, -1);
  return { from: addDays(pto, -(n - 1)), to: pto, label: L('الفترة اللي قبلها', 'Previous period') };
}
const EXTRA_LABEL: Record<ExtraKind, Loc> = {
  share_total: L('من الإجمالي', '% of total'), share_parent: L('من المجموعة', '% of group'), rank: L('الترتيب', 'Rank'),
  mtd: L('من أول الشهر', 'Month to date'), ytd: L('من أول السنة', 'Year to date'), rolling7: L('آخر 7 أيام', 'Last 7 days'), rolling28: L('آخر 28 يوم', 'Last 28 days'),
};
function windowOf(kind: ExtraKind, to: string): { from: string; to: string } | null {
  if (kind === 'mtd') return { from: to.slice(0, 8) + '01', to };
  if (kind === 'ytd') return { from: to.slice(0, 5) + '01-01', to };
  if (kind === 'rolling7') return { from: addDays(to, -6), to };
  if (kind === 'rolling28') return { from: addDays(to, -27), to };
  return null;
}
/** A metric whose value at any grouping is a recomputed total (sum, distinct count, snapshot) — not itself a ratio. */
const summable = (id: string) => { const m = metricById.get(id); return !!m && m.additivity !== 'WEIGHTED_RATIO' && m.unit !== '%' && !['share', 'price_change', 'freshness'].includes(EVAL[id]?.t ?? ''); };

/** The plain words of a calculated column. */
export function calcFormula(c: CalcDef): Loc {
  const a = metricById.get(c.a)?.label ?? L(c.a, c.a), b = metricById.get(c.b)?.label ?? L(c.b, c.b);
  if (c.kind === 'ratio') return L(`${a.ar} ÷ ${b.ar}`, `${a.en} ÷ ${b.en}`);
  if (c.kind === 'share') return L(`${a.ar} ÷ ${b.ar} × 100`, `${a.en} ÷ ${b.en} × 100`);
  return L(`${a.ar} − ${b.ar}`, `${a.en} − ${b.en}`);
}
/** Ready calculated columns offered to users (the designer shows only these). Each part is a registered summable metric. */
export const READY_CALCS: (CalcDef & { label: Loc; hint: Loc })[] = [
  { id: 'avg_order', kind: 'ratio', a: 'item_net_sales', b: 'order_count', label: L('متوسط الأوردر', 'Average order'), hint: L('صافي مبيعات الأصناف على عدد الأوردرات (القعدة أوردر واحد).', 'Item net sales per order (a visit is one order).') },
  { id: 'discount_rate', kind: 'share', a: 'discount_amount', b: 'gross_item_sales', label: L('نسبة الخصم', 'Discount rate'), hint: L('الخصومات من المبيعات قبل الخصم.', 'Discounts as a share of gross item sales.') },
  { id: 'refund_rate', kind: 'share', a: 'tender_refunded', b: 'tender_collected', label: L('نسبة المرتجع من المتحصل', 'Refunds % of collected'), hint: L('المرتجعات المصروفة من الفلوس اللي دخلت.', 'Refunds paid as a share of money collected.') },
  { id: 'price_per_unit', kind: 'ratio', a: 'item_net_sales', b: 'sold_quantity', label: L('متوسط سعر القطعة', 'Average price per unit'), hint: L('صافي مبيعات الأصناف على الكمية المباعة.', 'Item net sales per unit sold.') },
  { id: 'void_rate', kind: 'share', a: 'void_value', b: 'gross_item_sales', label: L('نسبة الإلغاءات', 'Void rate'), hint: L('قيمة الأصناف اللي اتشالت من المبيعات قبل الخصم.', 'Removed value as a share of gross item sales.') },
  { id: 'uncollected', kind: 'difference', a: 'recognized_sales_total', b: 'tender_collected', label: L('الفواتير ناقص المتحصل', 'Billed minus collected'), hint: L('الفرق بين المطلوب على الشيكات والفلوس اللي دخلت (مش لازم يبقى صفر — شوف جسر اليوم).', 'Billed minus collected (not necessarily zero — see the EOD bridge).') },
];

interface Ctx2 { db: DB; caller: Caller; cache: Map<string, Fact[]>; base: { filters: Record<string, string[]>; exclude: Record<string, string[]>; branchIds?: string[] }; metrics: string[] }
type Vals = Record<string, MetricValue>;
/** One period, every grouping level: pathKey → metric values (root key = ''). With cols: rowKey + '\u0002' + colKey. */
interface PeriodEval { meta: QueryMeta; byKey: Map<string, Vals>; labels: Map<string, Record<string, Loc>>; dimsOfKey: Map<string, Record<string, string | null>> }

function run(c: Ctx2, dims: string[], from: string, to: string, asOf: string | undefined, extraFilters: Record<string, string[]> = {}, opts: QueryOpts = {}): QueryResult {
  return query(c.db, c.caller, { metrics: c.metrics, dimensions: dims, filters: { ...c.base.filters, ...extraFilters }, exclude: c.base.exclude, from, to, branchIds: c.base.branchIds, asOf }, { cache: c.cache, ...opts });
}
function evalLevels(c: Ctx2, rows: string[], cols: string[], from: string, to: string, asOf: string | undefined, opts: QueryOpts = {}): PeriodEval {
  const byKey = new Map<string, Vals>(); const labels = new Map<string, Record<string, Loc>>(); const dimsOfKey = new Map<string, Record<string, string | null>>();
  let meta: QueryMeta | null = null;
  for (let k = 0; k <= rows.length; k++) {
    const g = rows.slice(0, k);
    for (const withCols of cols.length ? [false, true] : [false]) {
      const dims = withCols ? [...g, ...cols] : g;
      const r = run(c, dims, from, to, asOf, {}, opts);
      if (!meta || (k === 0 && !withCols)) meta = r.meta;
      if (!dims.length) { byKey.set('', r.totals); continue; }
      for (const row of r.rows) {
        const key = keyOfPath(g, row.dims) + (withCols ? '\u0002' + keyOfPath(cols, row.dims) : '');
        byKey.set(key, row.values); labels.set(key, row.labels); dimsOfKey.set(key, row.dims);
      }
    }
  }
  return { meta: meta!, byKey, labels, dimsOfKey };
}

/** Why a period cannot give a value for this metric at this grouping (null = it can). */
function coverageReason(meta: QueryMeta, metric: string, dims: string[]): Loc | null {
  if (meta.days.some((d) => d.source === 'NONE')) return L('فترة المقارنة فيها أيام من غير أي بيانات (قبل ما نبدأ نسجل) — مش هنقول صفر.', 'The comparison period has days with no data at all — not zero.');
  if (meta.days.some((d) => d.source === 'HISTORY')) {
    const cov = preLaunchCoverage(metric);
    if (!cov.ok) return L('الأيام دي قبل تشغيل السيستم وعندها إجمالي يومي بس — الرقم ده مش متسجل فيها.', 'Those days precede launch (daily totals only) — this number was not recorded.');
    const bad = cov.dims ? dims.find((d) => !cov.dims!.includes(d)) : undefined;
    if (bad) return L(`الأيام دي عندها إجمالي يومي بس — مش متقسم حسب «${dimensionById.get(bad)?.label.ar ?? bad}».`, `Those days only have daily totals — not broken down by ${dimensionById.get(bad)?.label.en ?? bad}.`);
  }
  return null;
}
const dimsInScope = (spec: PivotSpec, g: string[]) => [...g, ...Object.keys(spec.filters ?? {}), ...Object.keys(spec.exclude ?? {})];

function compareOp(op: HavingRule['op'], a: any, b: any) { const x = D(a), y = D(b); return op === 'gt' ? x.gt(y) : op === 'gte' ? x.gte(y) : op === 'lt' ? x.lt(y) : x.lte(y); }

export function pivot(db: DB, caller: Caller, specIn: PivotSpec): PivotResult {
  const spec: PivotSpec = { ...specIn, rows: [...new Set(specIn.rows ?? [])], columns: [...new Set(specIn.columns ?? [])], metrics: [...new Set(specIn.metrics ?? [])] };
  const rows = spec.rows!, cols = spec.columns!;
  const from = spec.from, to = spec.to ?? spec.from;
  // ── validation (server-side; the designer shows the same rules before sending)
  if (!spec.metrics.length || spec.metrics.length > 12) throw new ReportRefusal('VALIDATION_FAILED', { field: 'metrics', rule: '1..12' });
  if (rows.length > 4) throw new ReportRefusal('VALIDATION_FAILED', { field: 'rows', rule: 'at most 4 levels' });
  if (cols.length > 2) throw new ReportRefusal('VALIDATION_FAILED', { field: 'columns', rule: 'at most 2' });
  if (rows.some((d) => cols.includes(d))) throw new ReportRefusal('VALIDATION_FAILED', { field: 'columns', rule: 'a breakdown is either rows or columns' });
  for (const d of [...rows, ...cols]) { const dd = dimensionById.get(d); if (!dd) throw new ReportRefusal('VALIDATION_FAILED', { field: 'dimension', value: d }); if (dd.status !== 'AVAILABLE') throw new ReportRefusal('VALIDATION_FAILED', { field: 'dimension', value: d, rule: 'not available' }); }
  for (const id of [...spec.metrics, ...(spec.hidden ?? [])]) if (!metricById.has(id)) throw new ReportRefusal('METRIC_NOT_FOUND', { metric: id });
  if (spec.topN && (!(spec.topN.n >= 1) || spec.topN.n > 500)) throw new ReportRefusal('VALIDATION_FAILED', { field: 'topN', rule: '1..500' });
  const calcs = (spec.calcs ?? []).slice(0, 6);
  for (const c of calcs) {
    if (!metricById.has(c.a) || !metricById.has(c.b)) throw new ReportRefusal('METRIC_NOT_FOUND', { metric: !metricById.has(c.a) ? c.a : c.b });
    if (!['ratio', 'difference', 'share'].includes(c.kind)) throw new ReportRefusal('VALIDATION_FAILED', { field: 'calcs', rule: 'ratio | difference | share' });
    if (!summable(c.a) || !summable(c.b)) throw new ReportRefusal('VALIDATION_FAILED', { field: 'calcs', rule: 'parts must be summable registered metrics (no ratio of ratios)', calc: c.id });
    if (c.kind === 'difference' && metricById.get(c.a)!.unit !== metricById.get(c.b)!.unit) throw new ReportRefusal('VALIDATION_FAILED', { field: 'calcs', rule: 'difference needs the same unit', calc: c.id });
  }
  const parts = calcs.flatMap((c) => [c.a, c.b]);
  const allMetrics = [...new Set([...spec.metrics, ...(spec.hidden ?? []), ...parts])];
  const filters: Record<string, string[]> = {}; const exclude: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(spec.filters ?? {})) if (v?.length) filters[k] = v.map(String);
  for (const [k, v] of Object.entries(spec.exclude ?? {})) if (v?.length) exclude[k] = v.map(String);
  const c: Ctx2 = { db, caller, cache: new Map(), base: { filters, exclude, branchIds: spec.branchIds }, metrics: allMetrics };

  // ── the deepest grouping decides which metrics are legal (a metric refused at the leaves is refused everywhere)
  const probe = query(db, caller, { metrics: allMetrics, dimensions: [...rows, ...cols], filters, exclude, from, to, branchIds: spec.branchIds, asOf: spec.asOf }, { cache: c.cache });
  const refusedIds = new Set(probe.meta.refused.map((r) => r.metric));
  const naIds = new Set(probe.meta.notAvailable.map((r) => r.metric));
  c.metrics = allMetrics.filter((m) => !refusedIds.has(m) && !naIds.has(m));
  const naCell = (m: string): Cell => NA(probe.meta.notAvailable.find((x) => x.metric === m)?.reason ?? L('مش متاح', 'Not available'));
  const branchIds = probe.meta.branchIds;
  c.base.branchIds = branchIds;
  const asOf = probe.meta.asOf;
  const main = c.metrics.length ? evalLevels(c, rows, cols, from, to, asOf) : { meta: probe.meta, byKey: new Map<string, Vals>([['', {}]]), labels: new Map(), dimsOfKey: new Map() } as PeriodEval;
  const shown = spec.metrics.filter((m) => !refusedIds.has(m));

  // ── column heads (cross-tab)
  const colMap = new Map<string, ColHead>();
  if (cols.length) for (const [k, dims] of main.dimsOfKey) {
    if (!k.includes('\u0002') || k.split('\u0002')[0] !== keyOfPath(rows.slice(0, 0), {})) continue; // level-0 rows × cols
    const ck = k.split('\u0002')[1];
    colMap.set(ck, { key: ck, path: Object.fromEntries(cols.map((d) => [d, fkey(dims[d])])), labels: cols.map((d) => main.labels.get(k)?.[d] ?? L(String(dims[d] ?? '—'), String(dims[d] ?? '—'))) });
  }
  const colHeads = [...colMap.values()].sort((a, b) => cols.map((d) => TIME_DIMS.has(d) ? timeOrder(d, a.path[d]) : a.labels[cols.indexOf(d)].ar).join('|').localeCompare(cols.map((d) => TIME_DIMS.has(d) ? timeOrder(d, b.path[d]) : b.labels[cols.indexOf(d)].ar).join('|'), 'ar'));
  if (colHeads.length > 100) throw new ReportRefusal('VALIDATION_FAILED', { field: 'columns', rule: 'at most 100 columns — pick a shorter breakdown or period' });

  // ── tree
  let seq = 0;
  const notes: Loc[] = [];
  const mkCells = (rowKey: string, vals: Vals | undefined): PivotNode['cells'] => {
    const out: PivotNode['cells'] = { '': {} };
    for (const m of allMetrics) out[''][m] = naIds.has(m) ? naCell(m) : (vals?.[m] as Cell) ?? ND(L('مفيش بيانات', 'No data'));
    for (const ch of colHeads) {
      const v = main.byKey.get(rowKey + '\u0002' + ch.key);
      out[ch.key] = {};
      for (const m of allMetrics) out[ch.key][m] = naIds.has(m) ? naCell(m) : v?.[m] ? (v[m] as Cell) : zeroLike(m);
    }
    return out;
  };
  const root: PivotNode = { id: 'n0', level: 0, dim: null, value: null, label: L('الإجمالي', 'Grand total'), path: {}, cells: mkCells('', main.byKey.get('')), children: [] };
  const byLevel: PivotNode[][] = [[root]];
  for (let k = 1; k <= rows.length; k++) {
    const g = rows.slice(0, k), dim = rows[k - 1];
    const parents = new Map(byLevel[k - 1].map((n) => [keyOfPath(rows.slice(0, k - 1), unPath(n.path)), n]));
    const list: PivotNode[] = [];
    for (const [key, dims] of main.dimsOfKey) {
      if (key.includes('\u0002')) continue;
      if (key.split('\u0001').length !== k || Object.keys(dims).length !== k) continue;
      const parent = parents.get(keyOfPath(rows.slice(0, k - 1), dims));
      if (!parent) continue;
      const node: PivotNode = { id: `n${++seq}`, level: k, dim, value: dims[dim] ?? null, label: main.labels.get(key)?.[dim] ?? L('—', '—'), path: { ...parent.path, [dim]: fkey(dims[dim]) }, cells: mkCells(key, main.byKey.get(key)), children: [] };
      parent.children.push(node); list.push(node);
    }
    void g;
    byLevel.push(list);
  }
  if (seq > 20000) throw new ReportRefusal('VALIDATION_FAILED', { rule: 'the result is too big — narrow the period, add a filter or use top N' });

  // ── calculated columns (from the node's own summed parts — so every subtotal is Σa / Σb)
  const calcCell = (cl: CalcDef, vals: Record<string, Cell>): Cell => {
    const a = vals[cl.a], b = vals[cl.b];
    if (!avail(a)) return a?.availability === 'NOT_AVAILABLE' ? NA(a.reason!) : ND(L('الجزء الأول مش متاح', 'First part unavailable'));
    if (!avail(b)) return b?.availability === 'NOT_AVAILABLE' ? NA(b.reason!) : ND(L('الجزء التاني مش متاح', 'Second part unavailable'));
    if (cl.kind === 'difference') return OK(D(a.value!).minus(b.value!), { numerator: a.value!, denominator: b.value! });
    if (D(b.value!).isZero()) return ND(L('المقسوم عليه صفر — النسبة مش متعرفة', 'Denominator is zero — undefined'));
    return OK(D(a.value!).dividedBy(b.value!).times(cl.kind === 'share' ? 100 : 1), { numerator: a.value!, denominator: b.value! });
  };
  const forEachNode = (fn: (n: PivotNode, parent: PivotNode | null) => void) => { const walk = (n: PivotNode, p: PivotNode | null) => { fn(n, p); n.children.forEach((ch) => walk(ch, n)); }; walk(root, null); };
  const applyCalcs = (n: PivotNode) => { for (const ck of Object.keys(n.cells)) for (const cl of calcs) n.cells[ck]['calc:' + cl.id] = calcCell(cl, n.cells[ck]); };
  forEachNode(applyCalcs);

  // ── measures (value columns first; extras are filled before sorting so any column can sort / filter)
  const measures: MeasureMeta[] = [];
  const per = { from, to, asOf };
  for (const m of shown) {
    const md = metricById.get(m)!;
    measures.push({ id: m, metric: m, kind: 'value', label: md.label, unit: md.unit, formula: null, period: naIds.has(m) ? null : per, additive: md.additivity === 'ADD' && !['distinct', 'distinct_sum'].includes(EVAL[m]?.t ?? '') && md.unit !== '%', inColumns: true });
  }
  const extrasFor = (spec.extrasFor?.length ? spec.extrasFor : shown.slice(0, 1)).filter((m) => shown.includes(m) && !naIds.has(m));
  const extras = [...new Set(spec.extras ?? [])];
  let cmp: { from: string; to: string; label: Loc } | null = null;
  let cAsOf = asOf;
  let prev: PeriodEval | null = null;
  if (spec.compare && c.metrics.length) {
    cmp = comparePeriod(spec.compare, from, to);
    cAsOf = new Date(Math.min(Date.parse(asOf), businessDayEndMs(cmp.to))).toISOString();
    prev = evalLevels(c, rows, [], cmp.from, cmp.to, cAsOf, { maxDays: 400 });
    for (const m of extrasFor) {
      const md = metricById.get(m)!;
      const one = extrasFor.length === 1; // one number gets the extras → short column titles (the formula says which)
      measures.push({ id: `${m}@cmp`, metric: m, kind: 'compare', label: one ? cmp.label : L(`${md.label.ar} — ${cmp.label.ar}`, `${md.label.en} — ${cmp.label.en}`), unit: md.unit, formula: null, period: { from: cmp.from, to: cmp.to, asOf: cAsOf }, additive: false, inColumns: false });
      measures.push({ id: `${m}@chg`, metric: m, kind: 'change', label: one ? L('الفرق', 'Change') : L(`${md.label.ar} — الفرق`, `${md.label.en} — change`), unit: md.unit, formula: L(`${md.label.ar} − ${cmp.label.ar}`, `${md.label.en} − ${cmp.label.en}`), period: null, additive: false, inColumns: false });
      measures.push({ id: `${m}@chg%`, metric: m, kind: 'change_pct', label: one ? L('التغيير %', 'Change %') : L(`${md.label.ar} — التغيير %`, `${md.label.en} — change %`), unit: '%', formula: L('(الحالي − السابق) ÷ السابق × 100', '(current − previous) ÷ previous × 100'), period: null, additive: false, inColumns: false });
    }
  }
  const timeRow = rows.find((d) => d === 'business_date' || d === 'business_week');
  const winEval = new Map<ExtraKind, PeriodEval | null>();
  for (const kind of extras) for (const m of extrasFor) {
    const md = metricById.get(m)!;
    const label = extrasFor.length === 1 ? EXTRA_LABEL[kind] : L(`${md.label.ar} — ${EXTRA_LABEL[kind].ar}`, `${md.label.en} — ${EXTRA_LABEL[kind].en}`);
    const w = windowOf(kind, to);
    if (kind === 'share_total' || kind === 'share_parent') measures.push({ id: `${m}@${kind}`, metric: m, kind, label, unit: '%', formula: kind === 'share_total' ? L(`${md.label.ar} ÷ الإجمالي × 100`, `${md.label.en} ÷ grand total × 100`) : L(`${md.label.ar} ÷ المجموعة اللي فوقه × 100`, `${md.label.en} ÷ parent group × 100`), period: null, additive: false, inColumns: false });
    else if (kind === 'rank') measures.push({ id: `${m}@rank`, metric: m, kind, label, unit: 'rank', formula: L(`ترتيب ${md.label.ar} بين اللي جنبه (1 = الأعلى)`, `Rank of ${md.label.en} among siblings (1 = highest)`), period: null, additive: false, inColumns: false });
    else if (w) {
      measures.push({ id: `${m}@${kind}`, metric: m, kind, label, unit: md.unit, formula: L(`${md.label.ar} من ${w.from} لحد ${w.to}`, `${md.label.en} from ${w.from} to ${w.to}`), period: { ...w, asOf }, additive: false, inColumns: false });
      if (!winEval.has(kind)) winEval.set(kind, timeRow || !c.metrics.length ? null : evalLevels(c, rows, [], w.from, w.to, asOf, { maxDays: 400 }));
    }
  }
  const fillCompare = (n: PivotNode, pv: Vals | undefined) => {
    if (!prev) return;
    for (const m of extrasFor) {
      const why = coverageReason(prev.meta, m, dimsInScope(spec, rows.slice(0, n.level)));
      const cur = n.cells[''][m];
      const p: Cell = why ? NA(why) : (pv?.[m] as Cell) ?? zeroLike(m);
      const none = p.availability === 'NOT_AVAILABLE' ? NA(p.reason!) : ND(L('مفيش رقمين نقارنهم', 'Nothing to compare'));
      n.cells[''][`${m}@cmp`] = { ...p };
      n.cells[''][`${m}@chg`] = avail(cur) && avail(p) ? OK(D(cur.value!).minus(p.value!)) : none;
      n.cells[''][`${m}@chg%`] = avail(cur) && avail(p) ? (D(p.value!).isZero() ? ND(L('السابق صفر — النسبة مش متعرفة', 'Previous is zero — undefined')) : OK(D(cur.value!).minus(p.value!).dividedBy(D(p.value!).abs()).times(100))) : none;
    }
  };
  const fillWindows = (n: PivotNode, get: (ev: PeriodEval, kind: ExtraKind) => Vals | undefined) => {
    for (const [kind, ev] of winEval) for (const m of extrasFor) {
      if (!ev) { n.cells[''][`${m}@${kind}`] = ND(L('التراكمي مش منطقي والتقسيم بالأيام — شيل «اليوم» من الصفوف.', 'Running totals make no sense split by day.')); continue; }
      const why = coverageReason(ev.meta, m, dimsInScope(spec, rows.slice(0, n.level)));
      n.cells[''][`${m}@${kind}`] = why ? NA(why) : ({ ...((get(ev, kind)?.[m] as Cell) ?? zeroLike(m)) });
    }
  };
  const fillShares = (n: PivotNode, parent: PivotNode | null) => {
    for (const kind of extras) if (kind === 'share_total' || kind === 'share_parent') for (const m of extrasFor) {
      const base = kind === 'share_total' ? root : parent;
      const v = n.cells[''][m], b = base?.cells[''][m];
      n.cells[''][`${m}@${kind}`] = !summable(m) ? ND(L('النسبة من الإجمالي ما تنفعش لرقم هو نفسه نسبة أو متوسط.', 'A share is not defined for a ratio or average.')) : !base ? ND(L('—', '—')) : avail(v) && avail(b) && !D(b!.value!).isZero() ? OK(D(v.value!).dividedBy(b!.value!).times(100)) : ND(L('الإجمالي صفر', 'Total is zero'));
    }
  };
  const rankKids = (n: PivotNode) => {
    if (!extras.includes('rank')) return;
    for (const m of extrasFor) {
      for (const x of n.children) x.cells[''][`${m}@rank`] = ND(L('—', '—'));
      const sib = n.children.filter((x) => !x.others && avail(x.cells[''][m])).sort((a, b) => D(b.cells[''][m].value!).comparedTo(D(a.cells[''][m].value!)));
      let rank = 0, prevV: string | null = null;
      sib.forEach((x, i) => { if (x.cells[''][m].value !== prevV) rank = i + 1; prevV = x.cells[''][m].value; x.cells[''][`${m}@rank`] = OK(rank); });
    }
  };
  if (extras.includes('rank')) for (const m of extrasFor) root.cells[''][`${m}@rank`] = ND(L('—', '—'));
  // a time breakdown is matched on the shifted period (Oct 31 ↔ Oct 24 for «last week»); weekday / hour / daypart match as they are
  const shiftDays = cmp ? Math.round((Date.parse(cmp.from) - Date.parse(from)) / DAY) : 0;
  const prevPath = (n: PivotNode) => { const p = unPath(n.path); for (const d of ['business_date', 'business_week']) if (p[d]) p[d] = d === 'business_week' ? weekOf(addDays(p[d]!, shiftDays)) : addDays(p[d]!, shiftDays); return p; };
  forEachNode((n, parent) => {
    fillCompare(n, prev?.byKey.get(keyOfPath(rows.slice(0, n.level), prevPath(n))));
    fillWindows(n, (ev) => ev.byKey.get(keyOfPath(rows.slice(0, n.level), unPath(n.path))));
    fillShares(n, parent);
    rankKids(n);
  });

  // ── sort, condition (deepest level), top N + exact «الباقي»
  const sortBy = spec.sort?.by ?? null;
  const firstMetric = shown[0] ?? allMetrics[0];
  const numOf = (n: PivotNode, id: string) => { const v = n.cells['']?.[id]; return avail(v) ? D(v!.value!) : null; };
  const sortKids = (kids: PivotNode[], dim: string) => {
    const by = sortBy && sortBy !== 'label' ? sortBy : null;
    if (!by && (TIME_DIMS.has(dim) || sortBy === 'label')) { kids.sort((a, b) => (TIME_DIMS.has(dim) ? timeOrder(dim, a.value).localeCompare(timeOrder(dim, b.value)) : a.label.ar.localeCompare(b.label.ar, 'ar'))); if (spec.sort?.dir === 'desc' && sortBy === 'label') kids.reverse(); return; }
    const id = by ?? firstMetric; const dir = spec.sort?.dir === 'asc' ? 1 : -1;
    kids.sort((a, b) => { const x = numOf(a, id), y = numOf(b, id); if (x === null && y === null) return 0; if (x === null) return 1; if (y === null) return -1; return dir * x.comparedTo(y); });
  };
  const having = (spec.having ?? []).filter((h) => h.value !== '' && h.value !== undefined && Number.isFinite(Number(h.value)));
  const othersOn = spec.topN?.others !== false;
  let hiddenNoOthers = 0;
  const othersNodes: { node: PivotNode; parent: PivotNode; dim: string; values: string[] }[] = [];
  for (let k = 0; k < rows.length; k++) {
    for (const parent of byLevel[k]) {
      const dim = rows[k];
      const kids = parent.children;
      sortKids(kids, dim);
      let keep = kids;
      let hidden: PivotNode[] = [];
      if (k === rows.length - 1 && having.length) { const pass = (n: PivotNode) => having.every((h) => { const v = numOf(n, h.measure); return v !== null && compareOp(h.op, v, h.value); }); hidden = keep.filter((n) => !pass(n)); keep = keep.filter(pass); }
      if (spec.topN && keep.length > spec.topN.n) {
        const by = spec.topN.by ?? firstMetric;
        const ranked = [...keep].sort((a, b) => { const x = numOf(a, by), y = numOf(b, by); if (x === null) return 1; if (y === null) return -1; return y.comparedTo(x); });
        const top = new Set(ranked.slice(0, spec.topN.n));
        hidden = [...hidden, ...keep.filter((n) => !top.has(n))]; keep = keep.filter((n) => top.has(n));
      }
      if (!hidden.length) continue;
      parent.children = keep;
      if (!othersOn) { hiddenNoOthers += hidden.length; continue; }
      const values = hidden.map((n) => n.path[dim]);
      const node: PivotNode = { id: `n${++seq}`, level: k + 1, dim, value: null, label: L(`الباقي (${hidden.length})`, `Others (${hidden.length})`), path: { ...parent.path, [dim]: values.join(',') }, others: hidden.length, cells: {}, children: [] };
      parent.children.push(node);
      othersNodes.push({ node, parent, dim, values });
    }
  }
  // «الباقي» evaluated exactly: the parent's grouping, filtered to the hidden values (never a sum of the hidden rows)
  const othersVals = (o: { parent: PivotNode; dim: string; values: string[] }, f: string, t: string, as: string | undefined, withCols: boolean, opts: QueryOpts = {}) => {
    const g = rows.slice(0, o.parent.level);
    const r = run(c, withCols ? [...g, ...cols] : g, f, t, as, { ...pathFilters(o.parent.path), [o.dim]: o.values }, opts);
    if (!withCols) return { total: g.length ? r.rows.find((x) => keyOfPath(g, x.dims) === keyOfPath(g, unPath(o.parent.path)))?.values : r.totals, byCol: new Map<string, Vals>() };
    const byCol = new Map<string, Vals>();
    for (const x of r.rows) byCol.set(keyOfPath(cols, x.dims), x.values);
    return { total: undefined, byCol };
  };
  for (const o of othersNodes) {
    const t = c.metrics.length ? othersVals(o, from, to, asOf, false).total : undefined;
    o.node.cells[''] = {};
    for (const m of allMetrics) o.node.cells[''][m] = naIds.has(m) ? naCell(m) : (t?.[m] as Cell) ?? zeroLike(m);
    if (cols.length) {
      const cc = c.metrics.length ? othersVals(o, from, to, asOf, true).byCol : new Map<string, Vals>();
      for (const ch of colHeads) { o.node.cells[ch.key] = {}; for (const m of allMetrics) o.node.cells[ch.key][m] = naIds.has(m) ? naCell(m) : (cc.get(ch.key)?.[m] as Cell) ?? zeroLike(m); }
    }
    applyCalcs(o.node);
    if (cmp) {
      const sh = (d: string, v: string) => (d === 'business_date' ? addDays(v, shiftDays) : d === 'business_week' ? weekOf(addDays(v, shiftDays)) : v);
      const shifted = { parent: { ...o.parent, path: Object.fromEntries(Object.entries(o.parent.path).map(([d, v]) => [d, v.split(',').map((x) => (x === NULL_KEY ? x : sh(d, x))).join(',')])) }, dim: o.dim, values: o.values.map((x) => (x === NULL_KEY ? x : sh(o.dim, x))) };
      fillCompare(o.node, othersVals(shifted, cmp.from, cmp.to, cAsOf, false, { maxDays: 400 }).total);
    }
    fillWindows(o.node, (ev, kind) => { const w = windowOf(kind, to)!; void ev; return othersVals(o, w.from, w.to, asOf, false, { maxDays: 400 }).total; });
    fillShares(o.node, o.parent);
    if (extras.includes('rank')) for (const m of extrasFor) o.node.cells[''][`${m}@rank`] = ND(L('—', '—'));
  }
  if (hiddenNoOthers) notes.push(L(`فيه ${hiddenNoOthers} صف متخبي (أعلى كام / الشرط) — الإجماليات لسه شاملاهم.`, `${hiddenNoOthers} row(s) hidden by top N / condition — totals still include them.`));

  for (const cl of calcs) {
    const a = metricById.get(cl.a)!;
    measures.push({ id: 'calc:' + cl.id, metric: null, kind: 'calc', label: cl.label ?? READY_CALCS.find((x) => x.id === cl.id)?.label ?? calcFormula(cl), unit: cl.kind === 'share' ? '%' : cl.kind === 'difference' ? a.unit : (a.unit === 'EGP' ? 'EGP' : 'count'), formula: calcFormula(cl), period: null, additive: cl.kind === 'difference' && metricById.get(cl.a)!.additivity === 'ADD' && metricById.get(cl.b)!.additivity === 'ADD', inColumns: true });
  }

  // ── conditional formatting (data → styles on cells; the files read the same styles)
  for (const rule of spec.formats ?? []) {
    const ms = measures.find((x) => x.id === rule.measure);
    if (!ms) continue;
    const colKeys = ms.inColumns ? ['', ...colHeads.map((h) => h.key)] : [''];
    for (let k = 0; k <= rows.length; k++) for (const ck of colKeys) {
      const nodes = byLevelAll(root, k).filter((n) => !n.others && avail(n.cells[ck]?.[rule.measure]));
      const vals = nodes.map((n) => D(n.cells[ck][rule.measure].value!));
      const set = (n: PivotNode, st: CellStyle) => { const cell = n.cells[ck][rule.measure]; cell.style = { ...(cell.style ?? {}), ...st }; };
      if (rule.kind === 'scale' && k > 0 && nodes.length > 1) {
        const min = vals.reduce((a, b) => (b.lt(a) ? b : a)), max = vals.reduce((a, b) => (b.gt(a) ? b : a)); const span = max.minus(min);
        nodes.forEach((n, i) => { const s = span.isZero() ? 0.5 : vals[i].minus(min).dividedBy(span).toNumber(); set(n, { scale: Math.round((rule.highIsGood === false ? 1 - s : s) * 100) / 100 }); });
      } else if (rule.kind === 'threshold' && rule.value !== undefined && rule.value !== '' && Number.isFinite(Number(rule.value))) {
        nodes.forEach((n, i) => { if (rule.op === 'gt' ? vals[i].gt(rule.value!) : vals[i].lt(rule.value!)) set(n, { tone: rule.tone ?? 'bad' }); });
      } else if (rule.kind === 'topbottom' && k > 0 && nodes.length > 2) {
        const nTop = Math.max(1, Math.min(rule.n ?? 3, Math.floor(nodes.length / 2)));
        const order = nodes.map((n, i) => ({ n, v: vals[i] })).sort((a, b) => b.v.comparedTo(a.v));
        order.slice(0, nTop).forEach((x) => set(x.n, { tone: rule.highIsGood === false ? 'bad' : 'good' }));
        order.slice(-nTop).forEach((x) => set(x.n, { tone: rule.highIsGood === false ? 'good' : 'bad' }));
      } else if (rule.kind === 'arrows') {
        nodes.forEach((n, i) => { const s = vals[i].comparedTo(0); set(n, { icon: s > 0 ? 'up' : s < 0 ? 'down' : 'flat', tone: s === 0 ? undefined : (s > 0) === (rule.highIsGood !== false) ? 'good' : 'bad' }); });
      }
    }
  }
  // compact cells: AVAILABLE values don't carry reasons / counts (keeps big pivots small)
  forEachNode((n) => { for (const ck of Object.keys(n.cells)) for (const id of Object.keys(n.cells[ck])) { const x = n.cells[ck][id]; if (x.availability === 'AVAILABLE') { delete x.reason; delete x.evidenceCount; delete (x as any).snapshotAt; } } });
  // hidden helper metrics are not output columns
  const outIds = new Set(measures.map((x) => x.id));
  forEachNode((n) => { for (const ck of Object.keys(n.cells)) for (const id of Object.keys(n.cells[ck])) if (!outIds.has(id)) delete n.cells[ck][id]; });

  const meta = { ...main.meta, refused: probe.meta.refused.filter((r) => spec.metrics.includes(r.metric) || parts.includes(r.metric)), notAvailable: probe.meta.notAvailable, notes, compare: cmp, filters: { ...filters } } as PivotResult['meta'];
  const dimLabels = Object.fromEntries([...rows, ...cols].map((d) => [d, dimensionById.get(d)!.label]));
  return { spec, meta, rows, columns: cols, dimLabels, cols: colHeads, measures, root, nodeCount: seq + 1 };

  function zeroLike(m: string): Cell {
    const md = metricById.get(m)!;
    if (md.additivity === 'WEIGHTED_RATIO' || md.additivity === 'NON_ADDITIVE') return ND(L('مفيش بيانات في الخانة دي', 'No data in this cell'));
    return OK(0, { evidenceCount: 0 });
  }
}
function byLevelAll(root: PivotNode, k: number): PivotNode[] { let lv = [root]; for (let i = 0; i < k; i++) lv = lv.flatMap((n) => n.children); return lv; }
const unPath = (p: Record<string, string>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === NULL_KEY ? null : v]));
const pathFilters = (p: Record<string, string>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.split(',')]));

// ───────── shared helpers for the screen, the files and the print layout (pure)
export interface FlatRow { node: PivotNode; depth: number; hasChildren: boolean; expanded: boolean; kind: 'total' | 'group' | 'leaf' | 'others' }
/** The visible rows: the root total at the end (or start), groups expanded per `expanded` ('all' | ids | depth number). */
export function flatten(r: PivotResult, expanded: 'all' | Set<string> | number, opts: { totalFirst?: boolean; withTotal?: boolean } = {}): FlatRow[] {
  const out: FlatRow[] = [];
  const isOpen = (n: PivotNode) => expanded === 'all' || (typeof expanded === 'number' ? n.level < expanded : expanded.has(n.id));
  const walk = (n: PivotNode) => {
    for (const ch of n.children) {
      const open = ch.children.length > 0 && isOpen(ch);
      out.push({ node: ch, depth: ch.level - 1, hasChildren: ch.children.length > 0, expanded: open, kind: ch.others ? 'others' : ch.children.length ? 'group' : 'leaf' });
      if (open) walk(ch);
    }
  };
  walk(r.root);
  if (opts.withTotal !== false) { const t: FlatRow = { node: r.root, depth: 0, hasChildren: false, expanded: true, kind: 'total' }; if (opts.totalFirst) out.unshift(t); else out.push(t); }
  return out;
}
/** Output columns in order: for a cross-tab, each column head × its measures, then the total column. */
export function outputColumns(r: PivotResult): { colKey: string; head: ColHead | null; measure: MeasureMeta }[] {
  const out: { colKey: string; head: ColHead | null; measure: MeasureMeta }[] = [];
  if (r.cols.length) for (const h of r.cols) for (const m of r.measures.filter((x) => x.inColumns)) out.push({ colKey: h.key, head: h, measure: m });
  for (const m of r.measures) out.push({ colKey: '', head: null, measure: m });
  return out;
}
