// ux-17: the report PDF as real text (jsPDF + jspdf-autotable + IBM Plex Sans Arabic embedded, OFL). It draws the SAME
// pages as the print preview (layout.ts paginate: header, period and status, the big numbers, chart, money bridge, the
// table with its header on every page and the carried-forward subtotals, notes, signatures) and adds the footer every
// page needs: business day, branch, when and by whom it was made, page n of N. Arabic is shaped by jsPDF and ordered
// by bidi.ts (letters joined; numbers and Latin left to right inside right-to-left lines); money is end-aligned.
// Pure: no DOM and no fetch — the caller hands in jsPDF, autoTable and the font files (the browser loads them lazily,
// the node test reads them from disk), so the test checks the very file the button saves.
import type { ReportTemplate } from '../studio';
import { paperOf, kpisPerRow, H, cairoText, type DocModel, type Page, type PageItem } from './layout';
import { visualOrder, hasRtl } from './bidi';

export interface PdfKit { jsPDF: any; autoTable: (doc: any, o: any) => void; fonts: { regular: string; bold: string } }
const FONT = 'NerdPlexArabic';
type RGB = [number, number, number];
const INK: RGB = [17, 17, 17], DIM: RGB = [85, 85, 85], LINE: RGB = [212, 215, 221], SOFT: RGB = [246, 247, 249];

/** A jsPDF document with the Arabic font and WITHOUT jsPDF's own Arabic / bidi passes (this module does both). */
function newDoc(kit: PdfKit, o: { orientation: 'portrait' | 'landscape'; format: any }) {
  const API = kit.jsPDF.API;
  const saved = API.events.slice();
  // the built-in passes re-shape and re-order text that is already in visual order — leave them out of this document
  API.events.splice(0, API.events.length, ...saved.filter((e: any) => !((e[0] === 'preProcessText' && e[1] === API.processArabic) || (e[0] === 'postProcessText' && String(e[1]).includes('doBidiReorder')))));
  // a jsPDF whose hooks look different would draw reversed Arabic: refuse rather than print a wrong document
  if (saved.length - API.events.length !== 2) { API.events.splice(0, API.events.length, ...saved); throw new Error('PDF_WRITER_UNSUPPORTED_JSPDF'); }
  let doc: any;
  try { doc = new kit.jsPDF({ unit: 'mm', compress: true, ...o }); } finally { API.events.splice(0, API.events.length, ...saved); }
  doc.addFileToVFS(`${FONT}-Regular.ttf`, kit.fonts.regular); doc.addFont(`${FONT}-Regular.ttf`, FONT, 'normal');
  doc.addFileToVFS(`${FONT}-Bold.ttf`, kit.fonts.bold); doc.addFont(`${FONT}-Bold.ttf`, FONT, 'bold');
  doc.setFont(FONT, 'normal');
  return doc;
}

/** Renders the document model to a PDF (ArrayBuffer). `pages` = paginate(doc, tpl), as the preview shows them. */
export function renderPdf(kit: PdfKit, model: DocModel, tpl: ReportTemplate, pages: Page[], o: { title?: string } = {}): ArrayBuffer {
  const rtl = model.lang === 'ar';
  const base: 'rtl' | 'ltr' = rtl ? 'rtl' : 'ltr';
  const T = (ar: string, en: string) => (rtl ? ar : en);
  const paper = paperOf(tpl);
  const receipt = tpl.paper === 'RECEIPT_80';
  const recH = receipt ? receiptHeight(model, tpl, pages) : 0;
  const doc = newDoc(kit, { orientation: !receipt && tpl.orientation === 'landscape' ? 'landscape' : 'portrait', format: receipt ? [paper.w, recH] : 'a4' });
  const W = paper.w, PH = receipt ? recH : paper.h, M = paper.margin, x0 = M, x1 = W - M, CW = x1 - x0;
  doc.setProperties({ title: o.title ?? model.title, subject: model.params[0]?.value ?? '', creator: 'NerdPOS', author: model.generatedBy || 'NerdPOS' });
  doc.setLanguage?.(rtl ? 'ar-EG' : 'en-US');

  // ── text primitives (positions measured from the line's start edge: right in Arabic, left in English)
  const vis = (s: string) => (hasRtl(s) ? visualOrder(doc.processArabic(s), base) : s);
  const font = (size: number, bold = false, color: RGB = INK) => { doc.setFont(FONT, bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  const width = (s: string) => doc.getTextWidth(vis(s));
  /** Cuts a logical string with «…» until it fits (never wraps: the layout's rows have fixed heights). */
  const fit = (s: string, max: number) => { if (width(s) <= max) return s; let t = s; while (t.length > 1 && width(t + '…') > max) t = t.slice(0, -1); return t.trimEnd() + '…'; };
  const sx = (d: number) => (rtl ? x1 - d : x0 + d), ex = (d: number) => (rtl ? x0 + d : x1 - d);
  const text = (s: string, d: number, y: number, a: { align?: 'start' | 'end' | 'center'; max?: number; size?: number; bold?: boolean; color?: RGB } = {}) => {
    font(a.size ?? 8.6, a.bold, a.color);
    const v = vis(a.max ? fit(s, a.max) : s);
    if (a.align === 'center') doc.text(v, d, y, { align: 'center' });
    else if (a.align === 'end') doc.text(v, ex(d), y, { align: rtl ? 'left' : 'right' });
    else doc.text(v, sx(d), y, { align: rtl ? 'right' : 'left' });
  };
  const rule = (y: number, w = 0.2, c: RGB = LINE) => { doc.setDrawColor(...c); doc.setLineWidth(w); doc.line(x0, y, x1, y); };
  const box = (x: number, y: number, w: number, h: number, fill: RGB | null, stroke: RGB | null = null, r = 1.5) => { if (fill) doc.setFillColor(...fill); if (stroke) { doc.setDrawColor(...stroke); doc.setLineWidth(0.3); } doc.roundedRect(x, y, w, h, r, r, fill && stroke ? 'FD' : fill ? 'F' : 'S'); };
  /** A box placed from the start edge (d = distance from the start, w = width). */
  const sbox = (d: number, y: number, w: number, h: number, fill: RGB | null, stroke: RGB | null = null) => box(rtl ? x1 - d - w : x0 + d, y, w, h, fill, stroke);

  const period = model.params[0]?.value ?? '';
  const statusText = model.status.provisional ? T('مبدئي — قد يتغير', 'Provisional — may change') : T('نهائي — الأيام مغلقة', 'Final — days closed');
  const total = pages.length;

  // ── page items (heights follow layout.ts H so the page breaks are the preview's)
  const draw = (it: PageItem, y: number): number => {
    switch (it.t) {
      case 'header': {
        if (!it.full) { text(model.title, 0, y + 6, { bold: true, size: 9.5, max: CW * 0.6 }); text(period, 0, y + 6, { align: 'end', size: 7.4, color: DIM }); rule(y + H.headerCompact - 2, 0.3, [34, 34, 34]); return H.headerCompact; }
        if (receipt) {
          let yy = y + 5;
          if (tpl.header.venue) { text(model.venue.name, W / 2, yy, { align: 'center', bold: true, size: 10, max: CW }); yy += 4.6; }
          if (tpl.header.branch && model.venue.branches) { text(model.venue.branches, W / 2, yy, { align: 'center', size: 7.6, max: CW }); yy += 4; }
          text(model.title, W / 2, yy + 1, { align: 'center', bold: true, size: 8.6, max: CW }); yy += 5;
          text(`${period} · ${model.status.provisional ? T('مبدئي', 'Provisional') : T('نهائي', 'Final')}`, W / 2, yy, { align: 'center', size: 7.4, max: CW }); yy += 3;
          doc.setLineDashPattern([0.8, 0.8], 0); rule(yy, 0.3, [51, 51, 51]); doc.setLineDashPattern([], 0);
          return yy - y + 2;
        }
        const half = CW * 0.45;
        let ys = y + 6;
        if (tpl.header.logo && model.venue.logo) { try { const fmt = /^data:image\/(png|jpe?g)/i.exec(model.venue.logo)?.[1]?.toUpperCase().replace('JPG', 'JPEG'); if (fmt) doc.addImage(model.venue.logo, fmt, rtl ? x1 - 18 : x0, y, 18, 18); } catch { /* a logo the PDF cannot embed is left out */ } }
        const ld = tpl.header.logo && model.venue.logo ? 21 : 0;
        if (tpl.header.venue) { text(model.venue.name, ld, ys, { bold: true, size: 13, max: half - ld }); ys += 5; }
        if (tpl.header.branch && model.venue.branches) { text(model.venue.branches, ld, ys, { size: 8.6, max: half - ld }); ys += 4.2; }
        for (const l of model.venue.headerLines.slice(0, 2)) { text(l, ld, ys, { size: 7, color: DIM, max: half - ld }); ys += 3.6; }
        text(model.title, 0, y + 6, { align: 'end', bold: true, size: 12, max: CW * 0.55 });
        text(period, 0, y + 11, { align: 'end', size: 8.6, max: CW * 0.55 });
        font(7, true); const bw = width(statusText) + 4;
        box(rtl ? x0 : x1 - bw, y + 13.2, bw, 4.4, model.status.provisional ? [254, 243, 199] : [220, 252, 231], null, 1);
        text(statusText, 2, y + 16.3, { align: 'end', size: 7, bold: true, color: model.status.provisional ? [146, 64, 14] : [22, 101, 52] });
        rule(y + H.headerFull - 3, 0.5, INK);
        return H.headerFull;
      }
      case 'params': {
        const rows = model.params.slice(0, receipt ? 3 : 6);
        if (receipt) { rows.forEach((p, i) => text(`${p.label}: ${p.value}`, 0, y + 3.5 + i * 4, { size: 7, max: CW })); return rows.length * 4 + 2 + H.gap; }
        box(x0, y, CW, H.params, SOFT);
        const colW = CW / 3;
        rows.forEach((p, i) => { const c = i % 3, r = Math.floor(i / 3); text(`${p.label}: ${p.value}`, 2.5 + c * colW, y + 5.5 + r * 6.5, { size: 7.2, max: colW - 4 }); });
        return H.params + H.gap;
      }
      case 'kpis': {
        const per = kpisPerRow(tpl), gap = 2, bw = (CW - gap * (per - 1)) / per;
        model.kpis.forEach((k, i) => {
          const c = i % per, r = Math.floor(i / per), yy = y + r * H.kpiRow, d = c * (bw + gap);
          sbox(d, yy, bw, H.kpiRow - 2, null, LINE);
          text(k.label, d + 2, yy + 4.6, { size: 6.8, color: DIM, max: bw - 4 });
          text(k.value, d + 2, yy + 11.6, { size: receipt ? 9 : 12, bold: true, max: bw - 4 });
        });
        return Math.ceil(model.kpis.length / per) * H.kpiRow + H.gap;
      }
      case 'chart': {
        const c = model.chart!; const max = Math.max(1, ...c.points.map((p) => Math.abs(p.value)));
        box(x0, y, CW, H.chart, null, [226, 229, 234]);
        text(c.title, 3, y + 6, { bold: true, size: 8.6, max: CW - 6 });
        c.points.slice(0, 12).forEach((p, i) => {
          const yy = y + 10 + i * 4.2, lw = CW * 0.32, vw = CW * 0.22, tw = CW - 6 - lw - vw - 4;
          text(p.label, 3, yy + 2.6, { size: 7, max: lw - 2 });
          box(rtl ? x1 - 3 - lw - tw : x0 + 3 + lw, yy, tw, 2.6, [238, 241, 245], null, 1);
          const fw = Math.max(0.4, (Math.abs(p.value) / max) * tw);
          box(rtl ? x1 - 3 - lw - fw : x0 + 3 + lw, yy, fw, 2.6, [8, 145, 178], null, 1);
          text(p.display, 3, yy + 2.6, { align: 'end', size: 7 });
        });
        return H.chart + H.gap;
      }
      case 'bridge': {
        text(T('جسر النقدية', 'Money bridge'), 0, y + 4.5, { bold: true, size: 8.6 });
        model.bridge!.forEach((b, i) => { const yy = y + H.bridgeHead + i * H.bridgeRow; text(b.label, 0, yy + 4, { bold: !!b.strong, size: 8, max: CW * 0.7 }); text(b.amount, 0, yy + 4, { align: 'end', bold: !!b.strong, size: 8 }); rule(yy + H.bridgeRow, 0.2, [238, 238, 238]); });
        return H.bridgeHead + model.bridge!.length * H.bridgeRow + H.gap;
      }
      case 'notes': {
        const lines: string[] = doc.splitTextToSize(tpl.notes, CW - 8) as string[];
        const h = H.notesBase + Math.max(0, lines.length - 1) * H.noteLine;
        box(x0, y, CW, h - 1, SOFT);
        lines.forEach((l, i) => text(i === 0 ? `${T('ملاحظات', 'Notes')}: ${l}` : l, 3, y + 5.5 + i * H.noteLine, { size: 7.4, max: CW - 6 }));
        return h + H.gap;
      }
      case 'signatures': {
        const sg = tpl.footer.signatures!; const gap = 4, sw = (CW - gap * (sg.length - 1)) / sg.length;
        sg.forEach((s, i) => {
          const d = i * (sw + gap), cx = rtl ? x1 - d - sw / 2 : x0 + d + sw / 2;
          text(s.label, cx, y + 8, { align: 'center', bold: true, size: 7.4, max: sw });
          doc.setDrawColor(51, 51, 51); doc.setLineWidth(0.3); doc.line(cx - sw / 2 + 2, y + 17, cx + sw / 2 - 2, y + 17);
          text(s.name || T('الاسم: ............', 'Name: ............'), cx, y + 21, { align: 'center', size: 7.4, max: sw });
          if (!receipt) text(s.role || T('الوظيفة: ............', 'Role: ............'), cx, y + 24.5, { align: 'center', size: 7, color: DIM, max: sw });
        });
        return H.signatures + 4;
      }
      case 'table': return drawTable(it, y);
    }
  };

  const drawTable = (it: Extract<PageItem, { t: 'table' }>, y: number): number => {
    const tb = model.tables[it.table];
    let yy = y;
    if (tb.title) { text(tb.title + (it.continued ? T(' (تكملة)', ' (continued)') : ''), 0, yy + 5, { bold: true, size: 8.6, max: CW }); yy += H.tableTitle; }
    const n = tb.columns.length;
    const labelW = CW * ((receipt ? 40 : n > 8 ? 28 : 34) / 100), valW = (CW - labelW) / Math.max(1, n);
    const bodySize = n > 9 ? 7 : 7.6;
    const cellFit = (s: string, w: number, bold = false) => { font(bodySize, bold); return vis(fit(s, w - 2.8)); };
    const headCell = (s: string, w: number) => { font(6.8, true); const lines: string[] = []; let rest = s; for (let k = 0; k < 2 && rest; k++) { const words = rest.split(' '); let line = ''; while (words.length && width(line ? line + ' ' + words[0] : words[0]) <= w - 2.4) line = line ? line + ' ' + words.shift()! : words.shift()!; if (!line) line = fit(words.shift()!, w - 2.4); rest = words.join(' '); if (k === 1 && rest) { line = fit(line + ' ' + rest, w - 2.4); rest = ''; } lines.push(vis(line)); } return lines.join('\n'); };
    // columns in reading order: the label first; Arabic reverses them so the label is on the right
    const order = (cells: any[]) => (rtl ? [...cells].reverse() : cells);
    const head: any[][] = [];
    if (tb.columns.some((c) => c.group)) {
      const groups: { name: string; span: number }[] = [];
      for (const c of tb.columns) { const g = c.group ?? ''; const last = groups.at(-1); if (last && last.name === g) last.span++; else groups.push({ name: g, span: 1 }); }
      head.push(order([{ content: '', styles: { fillColor: [255, 255, 255] } }, ...groups.map((g) => ({ content: g.name ? headCell(g.name, valW * g.span) : '', colSpan: g.span, styles: { fillColor: [238, 242, 246], textColor: INK, halign: 'center', minCellHeight: H.groupHead } }))]));
    }
    head.push(order([{ content: headCell(tb.rowHeader, labelW), styles: { halign: rtl ? 'right' : 'left' } }, ...tb.columns.map((c) => ({ content: headCell(c.label, valW), styles: { halign: rtl ? 'left' : 'right' } }))]));
    const carryRow = (label: string, vals: string[]) => order([{ content: cellFit(label, labelW), styles: { fillColor: [243, 244, 246], textColor: DIM } }, ...vals.map((v) => ({ content: cellFit(v, valW), styles: { fillColor: [243, 244, 246], textColor: DIM } }))]);
    const body: any[][] = [];
    if (it.carryIn) body.push(carryRow(T('منقول من الصفحة السابقة', 'Brought forward'), it.carryIn));
    for (const ri of it.rows) {
      const r = tb.rows[ri]; const totalRow = r.kind === 'total', group = r.kind === 'group';
      const strong = totalRow || group;
      const fill: RGB | undefined = totalRow ? [229, 231, 235] : group && r.depth === 0 ? [248, 250, 252] : undefined;
      const pad = 1.4 + r.depth * 3.2;
      body.push(order([
        { content: cellFit(totalRow ? (r.label || T('الإجمالي', 'Grand total')) : r.label, labelW - (pad - 1.4), strong), styles: { fontStyle: strong ? 'bold' : 'normal', fillColor: fill, cellPadding: { top: 1, bottom: 1, [rtl ? 'right' : 'left']: pad, [rtl ? 'left' : 'right']: 1.4 } } },
        ...r.cells.map((v, i) => ({ content: cellFit(v, valW, strong), styles: { fontStyle: strong ? 'bold' : 'normal', fillColor: totalRow ? fill : r.tones[i] === 'good' ? [220, 252, 231] : r.tones[i] === 'bad' ? [254, 226, 226] : fill, textColor: r.tones[i] === 'bad' ? [185, 28, 28] : INK } })),
      ]));
    }
    if (it.carryOut) body.push(carryRow(T('يُرحَّل إلى الصفحة التالية', 'Carried forward'), it.carryOut));
    const widths = order([labelW, ...tb.columns.map(() => valW)]);
    const columnStyles: Record<number, any> = {};
    widths.forEach((w: number, i: number) => { const isLabel = rtl ? i === widths.length - 1 : i === 0; columnStyles[i] = { cellWidth: w, halign: isLabel ? (rtl ? 'right' : 'left') : (rtl ? 'left' : 'right') }; });
    kit.autoTable(doc, {
      startY: yy, margin: { top: M, bottom: M + H.footer, left: x0, right: W - x1 }, tableWidth: CW, theme: 'plain',
      head, body, showHead: 'firstPage', pageBreak: 'avoid', rowPageBreak: 'avoid', columnStyles,
      styles: { font: FONT, fontStyle: 'normal', fontSize: bodySize, textColor: INK, cellPadding: { top: 1, bottom: 1, left: 1.4, right: 1.4 }, minCellHeight: H.row, valign: 'middle', overflow: 'visible', lineColor: [229, 231, 235], lineWidth: { bottom: 0.2 } },
      headStyles: { font: FONT, fontStyle: 'bold', fontSize: 6.8, fillColor: [31, 41, 55], textColor: [255, 255, 255], minCellHeight: H.tableHead, valign: 'middle' },
      didParseCell: (d: any) => { const tr = d.section === 'body' && tb.rows[it.rows[d.row.index - (it.carryIn ? 1 : 0)]]?.kind === 'total'; if (tr) { d.cell.styles.lineWidth = { top: 0.4, bottom: 0.2 }; d.cell.styles.lineColor = [17, 17, 17]; } },
    });
    const head0 = (tb.title ? H.tableTitle : 0) + H.tableHead + (tb.columns.some((c) => c.group) ? H.groupHead : 0);
    const planned = head0 + (it.carryIn ? H.carry : 0) + it.rows.length * H.row + (it.carryOut ? H.carry : 0);
    const end = (doc as any).lastAutoTable?.finalY ?? y + planned;
    return Math.max(end - y, planned) + H.gap;
  };

  const footer = (n: number) => {
    if (receipt) return;
    const fy = PH - M - H.footer + 2;
    rule(fy, 0.2, [204, 204, 204]);
    if (tpl.footer.confidentiality) text(tpl.footer.confidentiality, 0, fy + 3.6, { size: 6.8, color: DIM, max: CW * 0.62 });
    const line2 = [`${T('اليوم التجاري', 'Business day')}: ${period}`, model.venue.branches, `${T('أُنشئ', 'Generated')}: ${cairoText(model.generatedAt, model.lang)}`, model.generatedBy].filter(Boolean).join(' · ');
    text(line2, 0, fy + 7.4, { size: 6.8, color: DIM, max: CW * 0.72 });
    if (tpl.footer.pageNumbers) text(T(`صفحة ${n} من ${total}`, `Page ${n} of ${total}`), 0, fy + 7.4, { align: 'end', bold: true, size: 7.4 });
    if (tpl.watermark.sandbox && model.status.sandbox) text(T('بيانات تجريبية', 'Demo data'), 0, fy + 3.6, { align: 'end', size: 6.8, color: [180, 83, 9] });
  };
  const watermark = () => {
    if (!(tpl.watermark.provisional && model.status.provisional)) return;
    try { doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.08 })); } catch { /* no transparency: skip the mark */ return; }
    font(receipt ? 34 : 92, true, [220, 38, 38]);
    doc.text(vis(T('مبدئي', 'PROVISIONAL')), W / 2, PH / 2, { align: 'center', angle: 28, baseline: 'middle' });
    doc.restoreGraphicsState();
  };

  pages.forEach((p, i) => {
    if (i > 0) doc.addPage(receipt ? [paper.w, recH] : 'a4', !receipt && tpl.orientation === 'landscape' ? 'landscape' : 'portrait');
    watermark();
    let y = M;
    for (const it of p.items) y += draw(it, y);
    if (receipt) { let fy = y + 3; doc.setLineDashPattern([0.8, 0.8], 0); rule(fy, 0.3, [51, 51, 51]); doc.setLineDashPattern([], 0); fy += 4; for (const l of [tpl.footer.confidentiality, ...model.venue.footerLines.slice(0, 2), `${T('أُنشئ', 'Generated')}: ${cairoText(model.generatedAt, model.lang)} · ${model.generatedBy}`].filter(Boolean)) { text(l, W / 2, fy, { align: 'center', size: 6.6, color: DIM, max: CW }); fy += 3.4; } }
    footer(p.n);
  });
  return doc.output('arraybuffer') as ArrayBuffer;
}

/** The 80 mm roll is one page as long as its content. */
function receiptHeight(model: DocModel, tpl: ReportTemplate, pages: Page[]): number {
  let h = 4;
  for (const it of pages[0]?.items ?? []) {
    if (it.t === 'header') h += 24; else if (it.t === 'params') h += Math.min(3, model.params.length) * 4 + 2 + H.gap;
    else if (it.t === 'kpis') h += Math.ceil(model.kpis.length / kpisPerRow(tpl)) * H.kpiRow + H.gap;
    else if (it.t === 'bridge') h += H.bridgeHead + (model.bridge?.length ?? 0) * H.bridgeRow + H.gap;
    else if (it.t === 'notes') h += H.notesBase + Math.ceil(tpl.notes.length / 40) * H.noteLine + H.gap;
    else if (it.t === 'signatures') h += H.signatures + 4;
    else if (it.t === 'table') { const tb = model.tables[it.table]; h += (tb.title ? H.tableTitle : 0) + H.tableHead + it.rows.length * (H.row + 0.4) + H.gap; }
  }
  return Math.max(80, h + 24);
}
