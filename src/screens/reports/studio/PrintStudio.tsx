// «معاينة الطباعة»: pick a ready template and see real pages immediately — page breaks, the table header repeated on
// every page, carried-forward subtotals, signatures, «مبدئي» watermark — with zoom, page navigation and thumbnails.
// Editing a template is a handful of switches; the pages update live. «تنزيل PDF» writes these same pages as real text
// (ux-17: jsPDF + jspdf-autotable + the embedded IBM Plex Sans Arabic — src/reports/print/pdf.ts). Templates are saved
// and versioned on the server (ReportTemplate.Save).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, FileDown, ZoomIn, ZoomOut, ChevronRight, ChevronLeft, Save, Copy, FileText, ReceiptText, LayoutTemplate, Check } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../../app/hooks';
import { call } from '../../../api/client';
import { Button, SegmentedControl, Switch, Field, Input, Textarea, Select, Spinner, toast, Pill } from '../../../ui';
import { t, L, getLang } from '../../../i18n';
import { cn, dateTime } from '../../../lib/format';
import { exportPdf } from './exports';
import { useDocTemplate } from '../../../ui/doc';
import { docFromPivot, docFromCertified, paginate, paperOf, kpisPerRow, receiptColumns, H, type DocModel, type Page, type PageItem } from '../../../reports/print/layout';
import type { PivotResult } from '../../../reports/pivot';
import type { ReportTemplate, ColumnView } from '../../../reports/studio';
import { lang } from './common';

export type PrintSource =
  | { kind: 'pivot'; result: PivotResult; title: string; view?: ColumnView[]; chart?: 'none' | 'bars' | 'line'; savedId?: string | null; spec?: any; templateId?: string | null; generatedAt?: string }
  | { kind: 'certified'; run: any; templateId?: string | null; generatedAt?: string };

type Draft = Omit<ReportTemplate, 'versions'> & { versions?: any };

/** The venue block of a printed report (name, logo, header / footer lines from the venue's document template, branches). */
export function useDocVenue(branchIds: string[]): DocModel['venue'] {
  const branches = useQuery<any>('Branch.List');
  const { template: venueTpl } = useDocTemplate();
  const key = branchIds.join(',');
  return useMemo(() => ({
    name: venueTpl?.business?.nameAr || venueTpl?.business?.name || t('المطعم'),
    branches: branchIds.map((id) => (branches.data?.items ?? []).find((b: any) => b.id === id)?.name ?? id).join('، '),
    logo: venueTpl?.logoDataUrl ?? null, headerLines: venueTpl?.headerLines ?? [], footerLines: venueTpl?.footerLines ?? [], taxNumber: null,
  }), [venueTpl, branches.data, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function PrintStudio({ source, onClose }: { source: PrintSource; onClose: () => void }) {
  const { auth, me } = useDev();
  const tq = useQuery<any>('ReportTemplate.Find');
  const branches = useQuery<any>('Branch.List');
  const { template: venueTpl } = useDocTemplate();
  const { run: runCmd, busy } = useCommand();
  const templates: ReportTemplate[] = tq.data?.items ?? [];
  const [tplId, setTplId] = useState<string | null>(source.templateId ?? null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [cur, setCur] = useState(1);
  const [pdfBusy, setPdfBusy] = useState(false);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const mainRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!templates.length) return; const pick = templates.find((x) => x.id === tplId) ?? templates.find((x) => x.id === (source.kind === 'certified' ? 'tpl_accountant_a4' : 'tpl_accountant_a4')) ?? templates[0]; if (!draft || draft.id !== pick.id) { setTplId(pick.id); setDraft(structuredClone(pick)); } }, [templates.length, tplId]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = templates.find((x) => x.id === draft?.id);
  const dirty = !!(base && draft && JSON.stringify({ ...base, versions: 0 }) !== JSON.stringify({ ...draft, versions: 0 }));
  const lng = lang();
  const branchName = (id: string) => (branches.data?.items ?? []).find((b: any) => b.id === id)?.name ?? id;
  const generatedAt = source.generatedAt ?? new Date().toISOString();
  const venue = useDocVenue(source.kind === 'pivot' ? source.result.meta.branchIds : source.run.branchIds ?? []);
  const generatedBy = me?.displayName ?? '';
  const doc: DocModel | null = useMemo(() => {
    if (!draft) return null;
    const d = source.kind === 'pivot'
      ? docFromPivot(source.result, { title: source.title, lang: lng, view: source.view, depth: draft.depth, venue, generatedBy, generatedAt, chart: source.chart ?? 'bars', sandbox: true })
      : docFromCertified(source.run, { lang: lng, venue, generatedBy, generatedAt, sandbox: true });
    return draft.paper === 'RECEIPT_80' ? receiptColumns(d) : d;
  }, [draft, source, venue, lng, generatedBy, generatedAt]);
  const pages = useMemo(() => (doc && draft ? paginate(doc, draft as ReportTemplate) : []), [doc, draft]);
  useEffect(() => { if (cur > pages.length) setCur(Math.max(1, pages.length)); }, [pages.length, cur]);
  const go = (n: number) => { const k = Math.max(1, Math.min(pages.length, n)); setCur(k); pageRefs.current[k - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const title = source.kind === 'pivot' ? source.title : L(source.run.title);

  const saveTpl = async (asNew: boolean) => {
    if (!draft) return;
    let name = draft.name;
    if (asNew) { const nm = window.prompt(t('اسم القالب الجديد'), `${L(draft.name)} — ${t('نسختي')}`); if (!nm?.trim()) return; name = { ar: nm.trim(), en: nm.trim() }; }
    const body: any = { ...draft, name, note: asNew ? t('قالب جديد') : t('تعديل من المعاينة') };
    delete body.versions;
    if (asNew) { delete body.id; } else body.expectedVersion = base?.version;
    const r = await runCmd('ReportTemplate.Save', { body }, { success: asNew ? t('القالب الجديد اتحفظ') : t('القالب اتحفظ — نسخة جديدة') });
    if (r) { await tq.refetch(); setTplId(r.id); setDraft(structuredClone(r)); }
  };
  // ux-17: «تنزيل PDF» writes real text (jsPDF + autotable + the embedded Arabic font) from these same pages
  const pdf = async () => {
    if (!draft || !doc || !pages.length) return;
    setPdfBusy(true);
    try {
      const res = await exportPdf(auth, { source, template: draft as ReportTemplate, doc, venue, generatedBy, lang: lng });
      if (res.saved) toast('success', t('تم تنزيل ملف PDF'), res.filename, auth.label);
    } catch (e) { toast('error', errorText(e), (e as any)?.code ?? String(e), auth.label); } finally { setPdfBusy(false); }
  };
  const print = () => { document.body.classList.add('printing-report'); setTimeout(() => { window.print(); setTimeout(() => document.body.classList.remove('printing-report'), 500); }, 60); };

  return createPortal(
    <div id="report-print-root" className="fixed inset-0 top-12 z-[60] overlay-panel flex flex-col" data-fb="print-studio">
      <style>{`@media print { body.printing-report > *:not(#report-print-root) { display: none !important; } body.printing-report #report-print-root { position: static !important; } body.printing-report .no-print { display: none !important; } body.printing-report .pp-zoom { zoom: 1 !important; } body.printing-report [data-print-page] { box-shadow: none !important; margin: 0 !important; break-after: page; } @page { size: ${draft?.paper === 'RECEIPT_80' ? '80mm auto' : `A4 ${draft?.orientation ?? 'portrait'}`}; margin: 0; } }`}</style>
      <div className="no-print flex items-center gap-2 px-4 h-14 border-b border-[var(--glass-border)] bg-[var(--card-raised)]">
        <LayoutTemplate className="w-5 h-5 text-[var(--primary)]" />
        <div className="min-w-0"><div className="font-bold truncate">{t('معاينة الطباعة')}</div><div className="text-[11px] text-dim truncate">{title}</div></div>
        <span className="flex-1" />
        <div className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] px-1">
          <Button size="icon" variant="ghost" onClick={() => go(cur - 1)} disabled={cur <= 1} aria-label={t('الصفحة اللي قبل')} data-fb="pp:prev">{getLang() === 'en' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</Button>
          <span className="text-sm num px-1" data-fb="pp:pageno">{t('صفحة {a} من {b}', { a: cur, b: pages.length })}</span>
          <Button size="icon" variant="ghost" onClick={() => go(cur + 1)} disabled={cur >= pages.length} aria-label={t('الصفحة اللي بعد')} data-fb="pp:next">{getLang() === 'en' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}</Button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-[var(--glass-border)] px-1">
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))} aria-label={t('صغّر')} data-fb="pp:zoom-out"><ZoomOut className="w-4 h-4" /></Button>
          <span className="text-sm num w-12 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="icon" variant="ghost" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(2)))} aria-label={t('كبّر')} data-fb="pp:zoom-in"><ZoomIn className="w-4 h-4" /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={print} data-fb="pp:print"><Printer className="w-4 h-4" />{t('اطبع')}</Button>
        <Button variant="primary" size="sm" loading={pdfBusy} onClick={pdf} data-fb="pp:pdf"><FileDown className="w-4 h-4" />{t('تنزيل PDF')}</Button>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('اقفل')} data-fb="pp:close"><X className="w-5 h-5" /></Button>
      </div>
      <div className="flex-1 min-h-0 flex">
        {/* template panel */}
        <aside className="no-print w-[320px] shrink-0 border-e border-[var(--glass-border)] overflow-y-auto p-4 space-y-4 bg-[var(--card-raised)]/60" data-fb="pp:panel">
          <div>
            <div className="text-xs font-bold text-soft mb-2">{t('اختار قالب')}</div>
            {tq.loading && !templates.length ? <Spinner /> : (
              <div className="space-y-1.5">
                {templates.map((x) => (
                  <button key={x.id} type="button" onClick={() => { setTplId(x.id); setDraft(structuredClone(x)); }} data-fb={`pp:tpl:${x.id}`}
                    className={cn('w-full text-start rounded-xl border p-2.5 flex gap-2.5 items-start transition-colors', draft?.id === x.id ? 'border-[var(--primary)] bg-[var(--primary)]/8' : 'border-[var(--glass-border)] hover:border-[var(--primary)]/40')}>
                    <span className={cn('shrink-0 rounded-md border border-[var(--glass-border)] surface-1 flex items-center justify-center', x.paper === 'RECEIPT_80' ? 'w-6 h-9' : x.orientation === 'landscape' ? 'w-10 h-7' : 'w-7 h-9')}>{x.paper === 'RECEIPT_80' ? <ReceiptText className="w-3.5 h-3.5 text-dim" /> : <FileText className="w-3.5 h-3.5 text-dim" />}</span>
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-1 font-bold text-sm">{L(x.name)}{draft?.id === x.id && <Check className="w-3.5 h-3.5 text-[var(--primary)]" />}</span><span className="block text-[11px] text-dim line-clamp-2">{L(x.description)}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {draft && <TemplateEditor d={draft} set={set} certified={source.kind === 'certified'} />}
          {draft && (
            <div className="space-y-2 border-t line pt-3">
              {dirty && <Pill tone="warning" size="sm" dot>{t('فيه تعديلات مش محفوظة على القالب')}</Pill>}
              <div className="flex gap-2 flex-wrap">
                {(base as any)?.canEdit && <Button size="sm" variant="primary" disabled={!dirty || busy} loading={busy} onClick={() => saveTpl(false)} data-fb="pp:save-tpl"><Save className="w-4 h-4" />{t('احفظ القالب')}</Button>}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => saveTpl(true)} data-fb="pp:save-tpl-new"><Copy className="w-4 h-4" />{t('احفظ كقالب جديد')}</Button>
              </div>
              {base && <div className="text-[11px] text-dim">{t('نسخة القالب {v}', { v: base.version })}{(base as any).versions?.[0] ? ` · ${dateTime((base as any).versions[0].at)}` : ''}</div>}
            </div>
          )}
        </aside>
        {/* pages */}
        <div ref={mainRef} className="flex-1 min-w-0 overflow-auto bg-neutral-500/25 p-6" data-fb="pp:pages" onScroll={(e) => { const el = e.currentTarget; const idx = pageRefs.current.findIndex((p) => p && p.offsetTop + p.offsetHeight * zoom * 0.5 > el.scrollTop / zoom); if (idx >= 0 && idx + 1 !== cur) setCur(idx + 1); }}>
          {!doc || !draft ? <Spinner /> : (
            <div className="pp-zoom mx-auto w-fit space-y-6" style={{ zoom }}>
              {pages.map((p, i) => <div key={p.n} ref={(el) => (pageRefs.current[i] = el)}><PrintPage doc={doc} tpl={draft as ReportTemplate} page={p} total={pages.length} /></div>)}
            </div>
          )}
        </div>
        {/* thumbnails */}
        {pages.length > 1 && doc && draft && (
          <aside className="no-print w-[132px] shrink-0 border-s border-[var(--glass-border)] overflow-y-auto p-3 space-y-3 bg-[var(--card-raised)]/60" data-fb="pp:thumbs">
            {pages.map((p, i) => (
              <button key={p.n} type="button" onClick={() => go(i + 1)} className={cn('block w-full rounded-md overflow-hidden border-2 transition-colors', cur === i + 1 ? 'border-[var(--primary)]' : 'border-transparent hover:border-[var(--glass-border)]')} data-fb={`pp:thumb:${p.n}`}>
                <div style={{ zoom: draft.orientation === 'landscape' ? 0.13 : 0.18, pointerEvents: 'none' }}><PrintPage doc={doc} tpl={draft as ReportTemplate} page={p} total={pages.length} /></div>
                <div className="text-[11px] text-dim num py-0.5">{p.n}</div>
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>, document.body);
}

function TemplateEditor({ d, set, certified }: { d: Draft; set: (p: Partial<Draft>) => void; certified: boolean }) {
  const receipt = d.paper === 'RECEIPT_80';
  const sw = (label: string, checked: boolean, on: (v: boolean) => void, fb: string) => <div className="flex items-center justify-between gap-2 py-0.5" data-fb={fb}><span className="text-sm">{label}</span><Switch checked={checked} onChange={on} /></div>;
  return (
    <div className="space-y-3" data-fb="pp:editor">
      <div className="text-xs font-bold text-soft">{t('عدّل الشكل')}</div>
      <Field label={t('الورق')}><SegmentedControl size="sm" full value={d.paper} onChange={(v) => set({ paper: v })} options={[{ id: 'A4', label: t('A4'), fb: 'pp:a4' }, { id: 'RECEIPT_80', label: t('إيصال 80مم'), fb: 'pp:receipt' }]} /></Field>
      {!receipt && <Field label={t('اتجاه الصفحة')}><SegmentedControl size="sm" full value={d.orientation} onChange={(v) => set({ orientation: v })} options={[{ id: 'portrait', label: t('طولي'), fb: 'pp:portrait' }, { id: 'landscape', label: t('عرضي'), fb: 'pp:landscape' }]} /></Field>}
      <div className="rounded-xl surface-1 px-3 py-2 space-y-0.5">
        {sw(t('اللوجو واسم المطعم'), d.header.logo, (v) => set({ header: { ...d.header, logo: v } }), 'pp:sw-logo')}
        {sw(t('بيانات التقرير (الفترة والحالة)'), d.header.params, (v) => set({ header: { ...d.header, params: v } }), 'pp:sw-params')}
        {sw(t('الأرقام الكبيرة'), d.blocks.kpis, (v) => set({ blocks: { ...d.blocks, kpis: v } }), 'pp:sw-kpis')}
        {!receipt && sw(t('رسم بياني'), d.blocks.chart, (v) => set({ blocks: { ...d.blocks, chart: v } }), 'pp:sw-chart')}
        {sw(t('الجدول'), d.blocks.table, (v) => set({ blocks: { ...d.blocks, table: v } }), 'pp:sw-table')}
        {certified && sw(t('جسر الفلوس'), d.blocks.bridge, (v) => set({ blocks: { ...d.blocks, bridge: v } }), 'pp:sw-bridge')}
        {!receipt && sw(t('الجدول يبدأ في صفحة جديدة'), d.blocks.tableOnNewPage, (v) => set({ blocks: { ...d.blocks, tableOnNewPage: v } }), 'pp:sw-newpage')}
      </div>
      {!certified && <Field label={t('التفاصيل في الجدول')}><Select value={String(d.depth)} onChange={(e) => set({ depth: Number(e.target.value) })} options={[{ value: '0', label: t('كل المستويات') }, { value: '1', label: t('المستوى الأول بس') }, { value: '2', label: t('أول مستويين') }]} data-fb="pp:depth" /></Field>}
      <div className="rounded-xl surface-1 px-3 py-2 space-y-1.5">
        {sw(t('توقيعات (أعده / راجعه / اعتمده)'), !!d.footer.signatures?.length, (v) => set({ footer: { ...d.footer, signatures: v ? (d.footer.signatures?.length ? d.footer.signatures : [{ label: 'أعده', name: '', role: '' }, { label: 'راجعه', name: '', role: '' }, { label: 'اعتمده', name: '', role: '' }]) : null } }), 'pp:sw-sign')}
        {d.footer.signatures?.map((s, i) => (
          <div key={i} className="grid grid-cols-[64px_1fr_1fr] gap-1">
            <Input className="h-8 text-xs" value={s.label} onChange={(e) => { const x = [...d.footer.signatures!]; x[i] = { ...s, label: e.target.value }; set({ footer: { ...d.footer, signatures: x } }); }} aria-label={t('الخانة')} />
            <Input className="h-8 text-xs" value={s.name} placeholder={t('الاسم')} onChange={(e) => { const x = [...d.footer.signatures!]; x[i] = { ...s, name: e.target.value }; set({ footer: { ...d.footer, signatures: x } }); }} />
            <Input className="h-8 text-xs" value={s.role} placeholder={t('الوظيفة')} onChange={(e) => { const x = [...d.footer.signatures!]; x[i] = { ...s, role: e.target.value }; set({ footer: { ...d.footer, signatures: x } }); }} />
          </div>
        ))}
        {sw(t('علامة «مبدئي» لما الأرقام مش نهائية'), d.watermark.provisional, (v) => set({ watermark: { ...d.watermark, provisional: v } }), 'pp:sw-wm')}
        {!receipt && sw(t('رقم الصفحة'), d.footer.pageNumbers, (v) => set({ footer: { ...d.footer, pageNumbers: v } }), 'pp:sw-pageno')}
        {sw(t('ملاحظات'), d.blocks.notes, (v) => set({ blocks: { ...d.blocks, notes: v } }), 'pp:sw-notes')}
        {d.blocks.notes && <Textarea rows={2} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t('اكتب ملاحظة تظهر في آخر التقرير')} />}
      </div>
      <Field label={t('سطر السرية تحت')}><Input value={d.footer.confidentiality} onChange={(e) => set({ footer: { ...d.footer, confidentiality: e.target.value } })} placeholder={t('مثلاً: سري — للإدارة بس')} data-fb="pp:conf" /></Field>
    </div>
  );
}

/** One printed page at real size (mm), white paper, right-to-left for Arabic. Heights follow layout.ts H. */
export function PrintPage({ doc, tpl, page, total, flat }: { doc: DocModel; tpl: ReportTemplate; page: Page; total: number; flat?: boolean }) {
  const paper = paperOf(tpl);
  const receipt = tpl.paper === 'RECEIPT_80';
  const rtl = doc.lang === 'ar';
  const T = (ar: string, en: string) => (rtl ? ar : en);
  const isLast = page.n === total;
  const fs = receipt ? 7.6 : 8.6;
  return (
    <div data-print-page={page.n} dir={rtl ? 'rtl' : 'ltr'} className={cn('relative bg-white text-[#111] overflow-hidden', !flat && 'shadow-2xl')}
      style={{ width: `${paper.w}mm`, height: receipt ? 'auto' : `${paper.h}mm`, padding: `${paper.margin}mm`, fontFamily: "'Almarai', 'Noto Sans Arabic', 'Arial', sans-serif", fontSize: `${fs}pt`, lineHeight: 1.25 }}>
      {tpl.watermark.provisional && doc.status.provisional && <div aria-hidden className="absolute inset-0 flex items-center justify-center pointer-events-none select-none" style={{ transform: 'rotate(-28deg)' }}><span style={{ fontSize: receipt ? '34pt' : '92pt', fontWeight: 800, color: 'rgba(220,38,38,0.08)' }}>{T('مبدئي', 'PROVISIONAL')}</span></div>}
      <div className="relative">
        {page.items.map((it, i) => <Item key={i} it={it} doc={doc} tpl={tpl} T={T} />)}
      </div>
      {!receipt && (
        <div className="absolute flex items-end justify-between gap-3" style={{ insetInline: `${paper.margin}mm`, bottom: `${paper.margin - 2}mm`, height: `${H.footer - 2}mm`, fontSize: '6.8pt', color: '#555', borderTop: '0.2mm solid #ccc', paddingTop: '1mm' }}>
          <div className="min-w-0"><div className="truncate">{tpl.footer.confidentiality}</div><div className="truncate">{T('أُنشئ بواسطة', 'Generated by')} {doc.generatedBy || '—'} · {dateTime(doc.generatedAt)} · {T('التعريفات', 'Definitions')}: {doc.definitions}</div></div>
          <div className="shrink-0 flex items-center gap-2">
            {tpl.watermark.sandbox && doc.status.sandbox && <span style={{ color: '#b45309', border: '0.3mm solid #f59e0b', borderRadius: '1mm', padding: '0 1.2mm' }}>{T('بيانات تجريبية', 'Demo data')}</span>}
            {tpl.footer.pageNumbers && <span className="font-bold num">{T(`صفحة ${page.n} من ${total}`, `Page ${page.n} of ${total}`)}</span>}
          </div>
        </div>
      )}
      {receipt && <div style={{ marginTop: '3mm', fontSize: '6.6pt', color: '#444', textAlign: 'center', borderTop: '0.3mm dashed #333', paddingTop: '1.5mm' }}>{tpl.footer.confidentiality && <div>{tpl.footer.confidentiality}</div>}{doc.venue.footerLines.slice(0, 2).map((l, i) => <div key={i}>{l}</div>)}<div>{T('أُنشئ بواسطة', 'Generated by')} {doc.generatedBy} · {dateTime(doc.generatedAt)}</div></div>}
      {isLast && null}
    </div>
  );
}

function Item({ it, doc, tpl, T }: { it: PageItem; doc: DocModel; tpl: ReportTemplate; T: (a: string, e: string) => string }) {
  const receipt = tpl.paper === 'RECEIPT_80';
  const mm = (v: number) => `${v}mm`;
  switch (it.t) {
    case 'header': {
      if (!it.full) return <div className="flex items-end justify-between" style={{ height: mm(H.headerCompact - 2), marginBottom: mm(2), borderBottom: '0.3mm solid #222' }}><b className="truncate">{doc.title}</b><span style={{ fontSize: '7pt' }}>{doc.params[0]?.value}</span></div>;
      if (receipt) return (
        <div className="text-center" style={{ paddingBottom: mm(2), marginBottom: mm(2), borderBottom: '0.3mm dashed #333' }}>
          {tpl.header.logo && doc.venue.logo && <img src={doc.venue.logo} alt="" style={{ maxHeight: '14mm', margin: '0 auto 1mm' }} />}
          {tpl.header.venue && <div style={{ fontWeight: 800, fontSize: '10pt' }}>{doc.venue.name}</div>}
          {tpl.header.branch && <div>{doc.venue.branches}</div>}
          <div style={{ fontWeight: 700, marginTop: '1mm' }}>{doc.title}</div>
          <div>{doc.params[0]?.value} · {doc.status.provisional ? T('مبدئي', 'Provisional') : T('نهائي', 'Final')}</div>
        </div>
      );
      return (
        <div className="flex items-start justify-between gap-4" style={{ height: mm(H.headerFull - 3), marginBottom: mm(3), borderBottom: '0.5mm solid #111' }}>
          <div className="flex items-start gap-3 min-w-0">
            {tpl.header.logo && doc.venue.logo && <img src={doc.venue.logo} alt="" style={{ height: '18mm', objectFit: 'contain' }} />}
            <div className="min-w-0">
              {tpl.header.venue && <div style={{ fontSize: '13pt', fontWeight: 800, lineHeight: 1.15 }}>{doc.venue.name}</div>}
              {tpl.header.branch && <div className="truncate">{doc.venue.branches}</div>}
              {doc.venue.headerLines.slice(0, 2).map((l, i) => <div key={i} className="truncate" style={{ fontSize: '7pt', color: '#444' }}>{l}</div>)}
            </div>
          </div>
          <div className="text-end shrink-0" style={{ maxWidth: '55%' }}>
            <div style={{ fontSize: '12pt', fontWeight: 800 }}>{doc.title}</div>
            <div>{doc.params[0]?.value}</div>
            <div style={{ display: 'inline-block', marginTop: '1mm', padding: '0.3mm 2mm', borderRadius: '1mm', fontSize: '7pt', fontWeight: 700, background: doc.status.provisional ? '#fef3c7' : '#dcfce7', color: doc.status.provisional ? '#92400e' : '#166534' }}>{doc.status.provisional ? T('مبدئي — قد يتغير', 'Provisional') : T('نهائي — الأيام مغلقة', 'Final — days closed')}</div>
          </div>
        </div>
      );
    }
    case 'params': return (
      <div className="grid gap-x-3 gap-y-0.5" style={{ gridTemplateColumns: receipt ? '1fr' : 'repeat(3, minmax(0, 1fr))', height: receipt ? 'auto' : mm(H.params), marginBottom: mm(H.gap), fontSize: '7.2pt', background: '#f6f7f9', borderRadius: '1.5mm', padding: '1.5mm 2.5mm' }}>
        {doc.params.slice(0, receipt ? 3 : 6).map((p, i) => <div key={i} className="min-w-0 truncate"><span style={{ color: '#666' }}>{p.label}: </span><span>{p.value}</span></div>)}
      </div>
    );
    case 'kpis': {
      const per = kpisPerRow(tpl);
      return (
        <div className="grid gap-[2mm]" style={{ gridTemplateColumns: `repeat(${per}, minmax(0, 1fr))`, marginBottom: mm(H.gap) }}>
          {doc.kpis.map((k, i) => <div key={i} style={{ height: mm(H.kpiRow - 2), border: '0.3mm solid #d4d7dd', borderRadius: '1.5mm', padding: '1.5mm 2mm' }} className="min-w-0"><div className="truncate" style={{ fontSize: '6.8pt', color: '#555' }}>{k.label}</div><div className="truncate num" style={{ fontSize: receipt ? '9pt' : '12pt', fontWeight: 800, marginTop: '1mm' }}>{k.value}</div></div>)}
        </div>
      );
    }
    case 'chart': {
      const c = doc.chart!; const max = Math.max(1, ...c.points.map((p) => Math.abs(p.value)));
      return (
        <div style={{ height: mm(H.chart), marginBottom: mm(H.gap), border: '0.3mm solid #e2e5ea', borderRadius: '1.5mm', padding: '2mm 3mm' }}>
          <div style={{ fontWeight: 700, marginBottom: '1.5mm' }}>{c.title}</div>
          <div className="space-y-[1mm]">{c.points.slice(0, 12).map((p, i) => <div key={i} className="flex items-center gap-[2mm]" style={{ height: '3.4mm', fontSize: '7pt' }}><span className="truncate" style={{ width: '32%' }}>{p.label}</span><span style={{ flex: 1, height: '2.4mm', background: '#eef1f5', borderRadius: '1mm', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(Math.abs(p.value) / max) * 100}%`, background: '#0891b2' }} /></span><span className="num" style={{ width: '22%', textAlign: 'end' }}>{p.display}</span></div>)}</div>
        </div>
      );
    }
    case 'bridge': return (
      <div style={{ marginBottom: mm(H.gap) }}>
        <div style={{ height: mm(H.bridgeHead - 2), fontWeight: 700 }}>{T('جسر النقدية', 'Money bridge')}</div>
        {doc.bridge!.map((b, i) => <div key={i} className="flex justify-between" style={{ height: mm(H.bridgeRow), alignItems: 'center', borderBottom: '0.2mm solid #eee', fontWeight: b.strong ? 700 : 400 }}><span className="truncate">{b.label}</span><span className="num">{b.amount}</span></div>)}
      </div>
    );
    case 'notes': return <div style={{ marginBottom: mm(H.gap), padding: '2mm 3mm', background: '#f6f7f9', borderRadius: '1.5mm', fontSize: '7.4pt' }}><b>{T('ملاحظات', 'Notes')}: </b>{tpl.notes}</div>;
    case 'signatures': return (
      <div className="grid gap-[4mm]" style={{ gridTemplateColumns: `repeat(${tpl.footer.signatures!.length}, minmax(0, 1fr))`, height: receipt ? 'auto' : mm(H.signatures), marginTop: mm(4) }} data-fb="pp:signatures">
        {tpl.footer.signatures!.map((s, i) => <div key={i} className="text-center" style={{ fontSize: '7.4pt' }}><div style={{ fontWeight: 700 }}>{s.label}</div><div style={{ height: receipt ? '8mm' : '10mm', borderBottom: '0.3mm solid #333' }} /><div className="truncate" style={{ marginTop: '1mm' }}>{s.name || T('الاسم: ............', 'Name: ............')}</div>{!receipt && <div className="truncate" style={{ color: '#555' }}>{s.role || T('الوظيفة: ............', 'Role: ............')}</div>}{!receipt && <div style={{ color: '#555' }}>{T('التاريخ: ..../..../........', 'Date: ..../..../........')}</div>}</div>)}
      </div>
    );
    case 'table': {
      const tb = doc.tables[it.table];
      const groups: { name: string; span: number }[] = [];
      for (const c of tb.columns) { const g = c.group ?? ''; const last = groups.at(-1); if (last && last.name === g) last.span++; else groups.push({ name: g, span: 1 }); }
      const hasGroups = tb.columns.some((c) => c.group);
      const cellBase: React.CSSProperties = { height: mm(H.row), padding: '0 1.4mm', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderBottom: '0.2mm solid #e5e7eb' };
      const labelW = receipt ? 40 : tb.columns.length > 8 ? 28 : 34;
      return (
        <div style={{ marginBottom: mm(H.gap) }} data-fb="pp:table">
          {tb.title && <div style={{ height: mm(H.tableTitle - 1), fontWeight: 700, display: 'flex', alignItems: 'flex-end', paddingBottom: '1mm' }}>{tb.title}{it.continued ? T(' (تكملة)', ' (continued)') : ''}</div>}
          <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: tb.columns.length > 9 ? '7pt' : undefined }}>
            <colgroup><col style={{ width: `${labelW}%` }} />{tb.columns.map((_, i) => <col key={i} />)}</colgroup>
            <thead>
              {hasGroups && <tr>{[<th key="x" style={{ height: mm(H.groupHead) }} />, ...groups.map((g, i) => <th key={i} colSpan={g.span} style={{ height: mm(H.groupHead), background: '#eef2f6', fontSize: '7pt', borderInlineStart: '0.3mm solid #fff' }}>{g.name}</th>)]}</tr>}
              <tr data-fb="pp:thead">
                <th style={{ ...cellBase, height: mm(H.tableHead), textAlign: 'start', background: '#1f2937', color: '#fff', fontWeight: 700 }}>{tb.rowHeader}</th>
                {tb.columns.map((c, i) => <th key={i} style={{ ...cellBase, height: mm(H.tableHead), textAlign: 'end', background: '#1f2937', color: '#fff', fontWeight: 700, whiteSpace: 'normal', lineHeight: 1.1, fontSize: '7pt' }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {it.carryIn && <tr data-fb="pp:carry-in"><td style={{ ...cellBase, fontStyle: 'italic', background: '#f3f4f6' }}>{T('منقول من الصفحة السابقة', 'Brought forward')}</td>{it.carryIn.map((v, i) => <td key={i} className="num" style={{ ...cellBase, textAlign: 'end', fontStyle: 'italic', background: '#f3f4f6' }}>{v}</td>)}</tr>}
              {it.rows.map((ri) => {
                const r = tb.rows[ri]; const total = r.kind === 'total'; const group = r.kind === 'group';
                return (
                  <tr key={ri}>
                    <td style={{ ...cellBase, paddingInlineStart: `${1.4 + r.depth * 3.2}mm`, fontWeight: total || group ? 700 : 400, fontStyle: r.kind === 'others' ? 'italic' : undefined, background: total ? '#e5e7eb' : group && r.depth === 0 ? '#f8fafc' : undefined, borderTop: total ? '0.4mm solid #111' : undefined }}>{total ? (r.label || T('الإجمالي', 'Grand total')) : r.label}</td>
                    {r.cells.map((v, i) => <td key={i} className="num" style={{ ...cellBase, textAlign: 'end', fontWeight: total || group ? 700 : 400, background: total ? '#e5e7eb' : r.tones[i] === 'good' ? '#dcfce7' : r.tones[i] === 'bad' ? '#fee2e2' : group && r.depth === 0 ? '#f8fafc' : undefined, color: r.tones[i] === 'bad' ? '#b91c1c' : undefined, borderTop: total ? '0.4mm solid #111' : undefined }}>{v}</td>)}
                  </tr>
                );
              })}
              {it.carryOut && <tr data-fb="pp:carry-out"><td style={{ ...cellBase, fontStyle: 'italic', background: '#f3f4f6', borderTop: '0.3mm solid #999' }}>{T('يُرحَّل إلى الصفحة التالية', 'Carried forward')}</td>{it.carryOut.map((v, i) => <td key={i} className="num" style={{ ...cellBase, textAlign: 'end', fontStyle: 'italic', background: '#f3f4f6', borderTop: '0.3mm solid #999' }}>{v}</td>)}</tr>}
            </tbody>
          </table>
        </div>
      );
    }
  }
}
