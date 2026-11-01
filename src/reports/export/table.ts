// One table model for every output (screen print, Excel, CSV): the visible columns in the user's order, with their
// display label, number format and width, and the rows (groups, leaves, «الباقي», the grand total) from the pivot.
// The values are the engine's values — nothing is recomputed here.
import type { MetricValue } from '../types';
import type { PivotResult, PivotNode, MeasureMeta } from '../pivot';
import { flatten, outputColumns } from '../pivot';
import type { ColumnView, NumberFormat } from '../studio';
import { autoFormat, pick, type Lang } from '../format';

export interface ExportColumn { colKey: string; measure: MeasureMeta; header: string; group: string | null; format: NumberFormat; width: number }
export interface ExportRow { node: PivotNode; kind: 'group' | 'leaf' | 'others' | 'total'; depth: number; label: string; dimLabels: string[]; values: (MetricValue | undefined)[] }
export interface ExportTable { title: string; rowHeader: string; rowDims: string[]; columns: ExportColumn[]; rows: ExportRow[] }

/** Order / rename / format / hide measures per the saved column settings. */
export function orderedMeasures(r: PivotResult, view: ColumnView[] | undefined): MeasureMeta[] {
  const v = view ?? [];
  const idx = (id: string) => { const i = v.findIndex((x) => x.id === id); return i < 0 ? 1000 + r.measures.findIndex((m) => m.id === id) : i; };
  return [...r.measures].filter((m) => !v.find((x) => x.id === m.id)?.hidden).sort((a, b) => idx(a.id) - idx(b.id));
}
export function columnLabel(m: MeasureMeta, view: ColumnView[] | undefined, lang: Lang) { return view?.find((x) => x.id === m.id)?.label?.trim() || pick(m.label, lang); }
export function columnFormat(m: MeasureMeta, view: ColumnView[] | undefined): NumberFormat { const f = view?.find((x) => x.id === m.id)?.format; return f && f !== 'auto' ? f : m.unit === 'rank' ? 'number0' : autoFormat(m.unit); }

export function exportTable(r: PivotResult, view: ColumnView[] | undefined, lang: Lang, expanded: 'all' | number = 'all', title = ''): ExportTable {
  const ms = orderedMeasures(r, view);
  const order = new Map(ms.map((m, i) => [m.id, i]));
  const cols = outputColumns(r).filter((c) => order.has(c.measure.id)).sort((a, b) => {
    const ga = a.colKey === '' ? 1e6 : r.cols.findIndex((h) => h.key === a.colKey), gb = b.colKey === '' ? 1e6 : r.cols.findIndex((h) => h.key === b.colKey);
    return ga - gb || order.get(a.measure.id)! - order.get(b.measure.id)!;
  });
  const columns: ExportColumn[] = cols.map((c) => ({
    colKey: c.colKey, measure: c.measure, header: columnLabel(c.measure, view, lang),
    group: c.head ? c.head.labels.map((l) => pick(l, lang)).join(' · ') : r.cols.length ? (lang === 'ar' ? 'الإجمالي' : 'Total') : null,
    format: columnFormat(c.measure, view), width: view?.find((x) => x.id === c.measure.id)?.width ?? 0,
  }));
  const flat = flatten(r, expanded, { withTotal: true });
  const rows: ExportRow[] = flat.map((f) => {
    const dimLabels = r.rows.map((d, i) => (i < f.node.level ? pick(labelAt(r, f.node, i), lang) : ''));
    return { node: f.node, kind: f.kind === 'total' ? 'total' : f.kind, depth: f.depth, label: f.kind === 'total' ? (lang === 'ar' ? 'الإجمالي' : 'Grand total') : pick(f.node.label, lang), dimLabels, values: columns.map((c) => f.node.cells[c.colKey]?.[c.measure.id]) };
  });
  const rowHeader = r.rows.length ? r.rows.map((d) => pick(r.dimLabels[d], lang)).join(' ← ') : lang === 'ar' ? 'البند' : 'Item';
  return { title, rowHeader, rowDims: r.rows.map((d) => pick(r.dimLabels[d], lang)), columns, rows };
}
/** The label of the ancestor at row level i (for flat CSV: one column per breakdown). */
function labelAt(r: PivotResult, node: PivotNode, i: number) {
  let cur: PivotNode | undefined = r.root; let found = node.label;
  for (let k = 0; k <= i; k++) {
    const want = node.path[r.rows[k]];
    const next: PivotNode | undefined = cur?.children.find((c) => c.path[r.rows[k]] === want);
    if (!next) break;
    cur = next; if (k === i) found = next.label;
  }
  return found;
}
