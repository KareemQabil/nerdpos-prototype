// Excel (ExcelJS, passed in so the browser loads it lazily and the headless test uses the same code):
//  sheet 1 — the report: grouped rows with outline levels (summary above), subtotals bold, formatted numbers (numbers
//            stay numbers), frozen header + first column, right-to-left for Arabic, the formatting rule colours;
//  sheet 2 — parameters & definitions: venue, branches, period, business-day rule, asOf, provisional/closed, filters,
//            comparison, who/when, every column's definition + version and the formula of calculated columns;
//  sheet 3 — evidence (optional): the source records behind the grand total of the first number.
// Plus CSV (flat: one row per leaf with a column per breakdown, then the grand total).
import type { Loc } from '../../mock/types';
import type { PivotResult } from '../pivot';
import { metricById } from '../registry/metrics';
import { excelFormat, cellText, pick, rangeText, type Lang } from '../format';
import type { ExportTable } from './table';

export interface DocParams { label: Loc; value: string }
export interface XlsxInput {
  table: ExportTable; result: PivotResult; lang: Lang; title: string; venue: string; branches: string[];
  generatedBy: string; generatedAt: string; params: DocParams[]; evidence?: { label: string; kind: string; businessDate: string | null; amount: string | null }[] | null;
}
const T = (lang: Lang, ar: string, en: string) => (lang === 'ar' ? ar : en);
const FILL: Record<string, string> = { good: 'FFDCFCE7', bad: 'FFFEE2E2', warn: 'FFFEF3C7' };
const scaleFill = (s: number) => { const g = Math.round(255 - s * 90), r = Math.round(255 - (1 - s) * 40); return `FF${r.toString(16).padStart(2, '0')}${'FF'}${g.toString(16).padStart(2, '0')}`.toUpperCase(); };

export async function buildPivotXlsx(ExcelJS: any, x: XlsxInput): Promise<ArrayBuffer> {
  const { table, result: r, lang } = x;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NerdPOS'; wb.created = new Date(x.generatedAt);
  const rtl = lang === 'ar';
  const ws = wb.addWorksheet(T(lang, 'التقرير', 'Report'), { views: [{ rightToLeft: rtl }], properties: { outlineProperties: { summaryBelow: false, summaryRight: false } } });
  ws.getCell(1, 1).value = x.title; ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(2, 1).value = `${x.venue} · ${x.branches.join('، ')} · ${rangeText(r.meta.from, r.meta.to, lang)} · ${r.meta.provisional ? T(lang, 'مبدئي', 'Provisional') : T(lang, 'نهائي', 'Final')}`;
  ws.getCell(2, 1).font = { color: { argb: 'FF555555' } };
  let row = 4;
  const single = r.cols.length > 0 && new Set(table.columns.map((c) => c.measure.id)).size === 1; // one number across columns → one header row
  const crossTab = r.cols.length > 0 && !single;
  if (crossTab) {
    let c = 2;
    const groups: { name: string; from: number; to: number }[] = [];
    for (const col of table.columns) { const g = col.group ?? ''; const last = groups.at(-1); if (last && last.name === g) last.to = c; else groups.push({ name: g, from: c, to: c }); c++; }
    for (const g of groups) { if (g.to > g.from) ws.mergeCells(row, g.from, row, g.to); const cell = ws.getCell(row, g.from); cell.value = g.name; cell.font = { bold: true }; cell.alignment = { horizontal: 'center' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; }
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    row++;
  }
  const headRow = row;
  ws.getCell(headRow, 1).value = table.rowHeader;
  table.columns.forEach((c, i) => { ws.getCell(headRow, i + 2).value = single ? c.group ?? c.header : c.header; });
  if (single) ws.getCell(3, 1).value = table.columns[0]?.header ?? '';
  ws.getRow(headRow).font = { bold: true };
  ws.getRow(headRow).eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; cell.alignment = { wrapText: true, vertical: 'middle' }; cell.border = { bottom: { style: 'thin' } }; });
  ws.views = [{ rightToLeft: rtl, state: 'frozen', xSplit: 1, ySplit: headRow }];
  ws.getColumn(1).width = Math.min(60, Math.max(22, ...table.rows.map((rr) => rr.label.length + rr.depth * 2 + 2)));
  table.columns.forEach((c, i) => { ws.getColumn(i + 2).width = c.width ? Math.round(c.width / 7) : Math.max(12, Math.min(28, c.header.length + 4)); });
  for (const rr of table.rows) {
    row++;
    const xr = ws.getRow(row);
    xr.getCell(1).value = rr.label;
    xr.getCell(1).alignment = { indent: rr.kind === 'total' ? 0 : rr.depth };
    rr.values.forEach((v, i) => {
      const col = table.columns[i]; const cell = xr.getCell(i + 2);
      if (v && v.availability === 'AVAILABLE' && v.value !== null) { cell.value = Number(v.value); cell.numFmt = excelFormat(col.format, lang); }
      else cell.value = cellText(v, col.format, lang, col.measure.unit);
      const st = (v as any)?.style;
      if (st?.tone) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL[st.tone] } };
      else if (typeof st?.scale === 'number') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scaleFill(st.scale) } };
      if (st?.icon === 'up' || st?.icon === 'down') cell.font = { color: { argb: st.tone === 'bad' ? 'FFB91C1C' : 'FF15803D' } };
    });
    if (rr.kind !== 'total' && rr.depth > 0) xr.outlineLevel = Math.min(7, rr.depth);
    if (rr.kind === 'group' || rr.kind === 'total') xr.font = { bold: true };
    if (rr.kind === 'total') xr.eachCell((cell: any) => { cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; cell.fill = cell.fill ?? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; });
    if (rr.kind === 'others') xr.font = { italic: true };
  }
  // ── parameters & definitions
  const ps = wb.addWorksheet(T(lang, 'المعايير والتعريفات', 'Parameters & definitions'), { views: [{ rightToLeft: rtl }] });
  ps.getColumn(1).width = 30; ps.getColumn(2).width = 70; ps.getColumn(3).width = 50; ps.getColumn(4).width = 10;
  const kv = (k: string, v: string) => { const rr = ps.addRow([k, v]); rr.getCell(1).font = { bold: true }; };
  ps.addRow([x.title]).font = { bold: true, size: 14 };
  kv(T(lang, 'المطعم', 'Venue'), x.venue);
  kv(T(lang, 'الفروع', 'Branches'), x.branches.join('، '));
  for (const p of x.params) kv(pick(p.label, lang), p.value);
  kv(T(lang, 'اتطلع بواسطة', 'Generated by'), x.generatedBy);
  kv(T(lang, 'اتطلع في', 'Generated at'), x.generatedAt);
  ps.addRow([]);
  const h = ps.addRow([T(lang, 'العمود', 'Column'), T(lang, 'التعريف', 'Definition'), T(lang, 'المعادلة', 'Formula'), T(lang, 'النسخة', 'Version')]);
  h.font = { bold: true }; h.eachCell((cell: any) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; });
  for (const m of r.measures) {
    const md = m.metric ? metricById.get(m.metric) : null;
    ps.addRow([pick(m.label, lang), md ? pick(md.definition, lang) : '', m.formula ? pick(m.formula, lang) : md?.formula ?? '', md?.version ?? '']).alignment = { wrapText: true, vertical: 'top' };
  }
  for (const rf of r.meta.refused) ps.addRow([metricById.get(rf.metric)?.label[lang] ?? rf.metric, T(lang, 'اترفض: ', 'Refused: ') + pick(rf.reason, lang)]);
  // ── evidence (optional)
  if (x.evidence?.length) {
    const es = wb.addWorksheet(T(lang, 'الإثبات', 'Evidence'), { views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 1 }] });
    es.columns = [{ header: T(lang, 'السجل', 'Record'), width: 60 }, { header: T(lang, 'النوع', 'Kind'), width: 14 }, { header: T(lang, 'اليوم التجاري', 'Business date'), width: 16 }, { header: T(lang, 'المبلغ', 'Amount'), width: 16 }];
    es.getRow(1).font = { bold: true };
    for (const e of x.evidence) { const rr = es.addRow([e.label, e.kind, e.businessDate ?? '', e.amount === null ? '' : Number(e.amount)]); rr.getCell(4).numFmt = '#,##0.00'; }
  }
  return wb.xlsx.writeBuffer();
}

/** CSV (flat): a column per breakdown, then the numbers (plain, 2 decimals for money); the grand total last. */
export function buildPivotCsv(table: ExportTable, lang: Lang): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = [...(table.rowDims.length ? table.rowDims : [lang === 'ar' ? 'البند' : 'Item']), ...table.columns.map((c) => (c.group ? `${c.group} — ${c.header}` : c.header))];
  const lines = [head.map(esc).join(',')];
  for (const rr of table.rows) {
    if (rr.kind === 'group') continue;
    const dims = rr.kind === 'total' ? [lang === 'ar' ? 'الإجمالي' : 'Grand total', ...table.rowDims.slice(1).map(() => '')] : rr.dimLabels.map((x, i) => (i === rr.node.level - 1 ? rr.label : x));
    const vals = rr.values.map((v) => (v?.availability === 'AVAILABLE' && v.value !== null ? Number(v.value).toFixed(2) : v?.availability === 'NOT_AVAILABLE' ? (lang === 'ar' ? 'مش متاح' : 'Not available') : ''));
    lines.push([...(dims.length ? dims : [rr.label]), ...vals].map((s) => esc(String(s))).join(','));
  }
  return '﻿' + lines.join('\n');
}
