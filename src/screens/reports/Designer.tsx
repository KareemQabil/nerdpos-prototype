// «اعمل تقرير» — the report designer. Three plain steps: «عايز تشوف إيه؟» (numbers from the certified registry),
// «مقسّم إزاي؟» (rows, optional columns — drag or tap), «في أنهي فترة؟» (presets). Everything else sits in one tidy
// «خيارات» panel with safe defaults (compare, extra numbers, top N, sort, colours, ready ratios, filters, condition).
// The live preview (Report.Pivot, debounced) takes most of the screen: click a row to open the next level, click a
// number to see the checks behind it. Save keeps the design (versioned); print / PDF / Excel use the same result.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Save, Printer, Download, History, Plus, X, GripVertical, AlertTriangle, EyeOff, Eye, ChevronUp, ChevronDown, ArrowLeftRight, SlidersHorizontal, Wand2, RefreshCw, FileSpreadsheet, FileText, Filter, Sparkles, LayoutGrid, Rows3, Columns3, CalendarDays, Hash } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { Button, Card, Pill, Select, SegmentedControl, Switch, Input, Field, Banner, EmptyState, SkeletonCard, Spinner, toast, StateBadge } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import { READY_CALCS, type PivotResult } from '../../reports/pivot';
import { emptyDesign, type ReportDesign, type ColumnView, type FormatPreset } from '../../reports/studio';
import { EvidenceCtx, type EvidenceSpec } from './parts';
import { EvidenceDrawer } from './EvidenceDrawer';
import { useRegistry, usePivot, designSpec, whyNot, PERIODS, periodText, today, lang, useClickAway, EMPTY_TEXT, type Registry } from './studio/common';
import { PivotGrid, initialExpanded } from './studio/PivotGrid';
import { Kpis, MiniChart, StatusLine, LeftOut } from './studio/Summary';
import { MetricPicker, DimPicker } from './studio/Pickers';
import { SaveDialog, HistoryDrawer, shareText } from './studio/SaveHistory';
import { PrintStudio } from './studio/PrintStudio';
import { exportPivot } from './studio/exports';

type Meta = { id: string; version: number; canEdit: boolean; canShare: boolean; description: string; category: string; view: any; edit: any; templateId: string | null; ownerName?: string };
type Drag = { kind: 'metric' | 'dim'; id: string; from?: 'rows' | 'columns' };

export default function ReportDesigner() {
  const { auth, nav, params } = useDev();
  const reg = useRegistry();
  const branches = useQuery<any>('Branch.List');
  const branchItems: any[] = branches.data?.items ?? [];
  const allIds = branchItems.map((b) => b.id);
  const savedId: string | undefined = params?.savedId;
  const savedQ = useQuery<any>(savedId ? 'SavedReport.Get' : null, { params: { savedReportId: savedId } });
  const [design, setDesign] = useState<ReportDesign>(() => normalize(params?.design ?? emptyDesign()));
  const [name, setName] = useState<string>(params?.name ?? t('تقرير جديد'));
  const [meta, setMeta] = useState<Meta | null>(null);
  const [dirty, setDirty] = useState(!!params?.design);
  const loadedKey = useRef('');
  useEffect(() => {
    const r = savedQ.data; if (!r) return;
    const k = `${r.id}:${r.version}`; if (loadedKey.current === k) return; loadedKey.current = k;
    setDesign(normalize(r.design)); setName(r.name); setMeta({ id: r.id, version: r.version, canEdit: r.canEdit, canShare: r.canShare, description: r.description, category: r.category, view: r.view, edit: r.edit, templateId: r.templateId, ownerName: r.ownerName }); setDirty(false);
  }, [savedQ.data]);
  const upd = (patch: Partial<ReportDesign>) => { setDesign((d) => ({ ...d, ...patch })); setDirty(true); };
  const spec = useMemo(() => (design.metrics.length && allIds.length ? designSpec(design, auth.branchId, allIds) : null), [design, auth.branchId, allIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = usePivot(spec);
  const r = pv.data;
  const structKey = r ? `${r.rows.join('|')}#${r.columns.join('|')}#${design.view.expandDepth}` : '';
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastStruct = useRef('');
  useEffect(() => { if (r && structKey !== lastStruct.current) { lastStruct.current = structKey; setExpanded(initialExpanded(r, design.view.expandDepth)); } }, [r, structKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const [picker, setPicker] = useState(false);
  const [dimPick, setDimPick] = useState<{ zone: 'rows' | 'columns'; rect: DOMRect } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [print, setPrint] = useState(false);
  const [dl, setDl] = useState<string | null>(null);
  const [optsOpen, setOptsOpen] = useState(false);
  const drag = useRef<Drag | null>(null);
  const dims = [...design.rows, ...design.columns];
  const filterDims = [...Object.keys(design.filters ?? {}), ...Object.keys(design.exclude ?? {})];
  const hiddenCols = design.view.columns.filter((c) => c.hidden);

  const addMetric = (id: string) => upd({ metrics: design.metrics.includes(id) ? design.metrics.filter((m) => m !== id) : [...design.metrics, id].slice(0, 12) });
  const moveMetric = (id: string, to: number) => { const xs = design.metrics.filter((m) => m !== id); xs.splice(Math.max(0, Math.min(xs.length, to)), 0, id); upd({ metrics: xs }); };
  const addDim = (zone: 'rows' | 'columns', id: string) => upd(zone === 'rows' ? { rows: [...design.rows, id].slice(0, 4), columns: design.columns.filter((x) => x !== id) } : { columns: [id], rows: design.rows.filter((x) => x !== id) });
  const moveDim = (id: string, zone: 'rows' | 'columns', to: number) => {
    const rows = design.rows.filter((x) => x !== id); const cols = design.columns.filter((x) => x !== id);
    if (zone === 'rows') { rows.splice(Math.max(0, Math.min(rows.length, to)), 0, id); upd({ rows: rows.slice(0, 4), columns: cols }); }
    else upd({ rows, columns: [id] });
  };
  const removeDim = (id: string) => upd({ rows: design.rows.filter((x) => x !== id), columns: design.columns.filter((x) => x !== id), sort: null });
  const setView = (cols: ColumnView[]) => upd({ view: { ...design.view, columns: cols } });
  const doExport = async (format: 'XLSX' | 'CSV') => {
    setDl(format);
    try {
      const res = await exportPivot(auth, { format, savedId: meta && !dirty ? meta.id : null, spec: spec!, name, view: design.view.columns, lang: lang(), venue: t('مطعم الحاج سامي للمشويات'), branchName: (id) => branchItems.find((b) => b.id === id)?.name ?? id, evidence: format === 'XLSX' });
      if (res.saved) toast('success', format === 'XLSX' ? t('ملف الإكسل اتنزل') : t('ملف CSV اتنزل'), res.filename, auth.label);
    } catch (e) { toast('error', errorText(e), (e as any)?.code, auth.label); } finally { setDl(null); }
  };
  const ro = !!meta && !meta.canEdit;

  return (
    <EvidenceCtx.Provider value={setEv}>
      <div className="flex flex-col gap-3 @3xl/main:h-[calc(100dvh-148px)] @3xl/main:min-h-[620px]" data-screen-id="H4" data-fb="designer">
        {/* top bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="icon" variant="ghost" onClick={() => nav('reports', meta ? { savedId: meta.id } : {})} aria-label={t('رجوع للتقارير')} data-fb="designer:back">{getLang() === 'en' ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}</Button>
          <div className="min-w-0 flex-1">
            <input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label={t('اسم التقرير')} data-fb="designer:name"
              className="w-full bg-transparent text-xl font-extrabold outline-none border-b border-transparent hover:border-[var(--glass-border)] focus:border-[var(--primary)] truncate" />
            <div className="flex items-center gap-2 text-xs text-dim mt-0.5 flex-wrap">
              {meta ? <span>{t('نسخة {v}', { v: meta.version })} · {shareText(meta.view)}{meta.ownerName ? ` · ${meta.ownerName}` : ''}</span> : <span>{t('تقرير جديد — لسه ما اتحفظش')}</span>}
              {dirty && <Pill size="sm" tone="warning" dot>{t('فيه تعديلات مش محفوظة')}</Pill>}
              {ro && <Pill size="sm" tone="neutral">{t('للقراءة — الحفظ هيعمل نسخة ليك')}</Pill>}
              <StateBadge ops={['Report.Pivot', 'SavedReport.Save']} />
            </div>
          </div>
          {meta && <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} data-fb="designer:history"><History className="w-4 h-4" />{t('السجل')}</Button>}
          <DownloadMenu busy={dl} disabled={!r} onPick={doExport} onPdf={() => setPrint(true)} />
          <Button size="sm" variant="outline" disabled={!r} onClick={() => setPrint(true)} data-fb="designer:print"><Printer className="w-4 h-4" />{t('معاينة الطباعة')}</Button>
          <Button size="sm" variant="primary" disabled={!design.metrics.length} onClick={() => setSaveOpen(true)} data-fb="designer:save"><Save className="w-4 h-4" />{t('احفظ')}</Button>
        </div>

        <div className="flex-1 min-h-0 grid gap-4 @3xl/main:grid-cols-[296px_minmax(0,1fr)] @6xl/main:grid-cols-[350px_minmax(0,1fr)]">
          {/* steps */}
          <aside className="space-y-3 @3xl/main:min-h-0 @3xl/main:overflow-y-auto @3xl/main:pe-1" data-fb="designer:steps">
            <Step n={1} title={t('عايز تشوف إيه؟')} hint={t('الأرقام اللي هتبقى أعمدة. اسحبها عشان ترتبها.')} icon={<Hash className="w-4 h-4" />}>
              <div className="space-y-1.5" onDragOver={(e) => e.preventDefault()}>
                {design.metrics.map((m, i) => {
                  const why = whyNot(reg, m, [...dims, ...filterDims]);
                  const col = design.view.columns.find((c) => c.id === m);
                  return (
                    <div key={m} draggable onDragStart={() => (drag.current = { kind: 'metric', id: m })} onDragOver={(e) => e.preventDefault()} onDrop={() => { const d = drag.current; if (d?.kind === 'metric') moveMetric(d.id, i); drag.current = null; }}
                      className={cn('group flex items-center gap-1.5 rounded-xl border px-2 h-10 bg-[var(--card-raised)]', why ? 'border-[var(--warning)]/60' : 'border-[var(--glass-border)]')} data-fb={`metric-chip:${m}`} title={why ?? L(reg.metric(m)?.definition)}>
                      <GripVertical className="w-4 h-4 text-dim cursor-grab shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm font-medium">{col?.label || L(reg.metric(m)?.label) || m}</span>
                      {why && <AlertTriangle className="w-4 h-4 text-[var(--warning-text)] shrink-0" />}
                      {col?.hidden && <button type="button" onClick={() => setView(design.view.columns.map((c) => (c.id === m ? { ...c, hidden: false } : c)))} aria-label={t('اظهر العمود')}><EyeOff className="w-4 h-4 text-dim" /></button>}
                      <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <IconBtn label={t('لفوق')} onClick={() => moveMetric(m, i - 1)} disabled={i === 0}><ChevronUp className="w-3.5 h-3.5" /></IconBtn>
                        <IconBtn label={t('لتحت')} onClick={() => moveMetric(m, i + 1)} disabled={i === design.metrics.length - 1}><ChevronDown className="w-3.5 h-3.5" /></IconBtn>
                      </span>
                      <IconBtn label={t('شيل')} onClick={() => addMetric(m)} fb={`metric-remove:${m}`}><X className="w-3.5 h-3.5" /></IconBtn>
                    </div>
                  );
                })}
                {design.metrics.some((m) => whyNot(reg, m, [...dims, ...filterDims])) && <div className="text-[11px] text-[var(--warning-text)] leading-relaxed">{design.metrics.map((m) => whyNot(reg, m, [...dims, ...filterDims])).filter(Boolean).join(' ')} {t('— هيظهر من غير الرقم ده. شيل التقسيم أو اختار رقم تاني.')}</div>}
                <Button size="sm" variant="outline" className="w-full border-dashed" onClick={() => setPicker(true)} data-fb="designer:add-metric"><Plus className="w-4 h-4" />{t('ضيف رقم')}</Button>
              </div>
            </Step>
            <Step n={2} title={t('مقسّم إزاي؟')} hint={t('كل تقسيم بيفتح جوه اللي قبله. ودوس على أي سطر يفتح اللي تحته.')} icon={<LayoutGrid className="w-4 h-4" />}>
              <Zone title={t('الصفوف')} icon={<Rows3 className="w-3.5 h-3.5" />} empty={t('من غير تقسيم — رقم واحد للإجمالي')} onDrop={() => { const d = drag.current; if (d?.kind === 'dim') moveDim(d.id, 'rows', design.rows.length); drag.current = null; }} fb="zone:rows">
                {design.rows.map((d, i) => (
                  <DimChip key={d} label={L(reg.dim(d)?.label) || d} n={i + 1} onDragStart={() => (drag.current = { kind: 'dim', id: d, from: 'rows' })} onDrop={() => { const x = drag.current; if (x?.kind === 'dim') moveDim(x.id, 'rows', i); drag.current = null; }}
                    onUp={i > 0 ? () => moveDim(d, 'rows', i - 1) : undefined} onDown={i < design.rows.length - 1 ? () => moveDim(d, 'rows', i + 1) : undefined} onSwap={() => moveDim(d, 'columns', 0)} swapLabel={t('انقله للأعمدة')} onRemove={() => removeDim(d)} fb={`dim-chip:${d}`} />
                ))}
                {design.rows.length < 4 && <button type="button" onClick={(e) => setDimPick({ zone: 'rows', rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })} className="w-full h-9 rounded-xl border border-dashed border-[var(--glass-border)] text-sm text-soft hover:border-[var(--primary)] hover:text-[var(--primary)] inline-flex items-center justify-center gap-1.5" data-fb="designer:add-row"><Plus className="w-4 h-4" />{design.rows.length ? t('قسّم كمان') : t('قسّم حسب…')}</button>}
              </Zone>
              <Zone title={t('الأعمدة (اختياري)')} icon={<Columns3 className="w-3.5 h-3.5" />} empty={t('مثلاً الفترة أو يوم الأسبوع — يبقى جدول متقاطع')} onDrop={() => { const d = drag.current; if (d?.kind === 'dim') moveDim(d.id, 'columns', 0); drag.current = null; }} fb="zone:columns">
                {design.columns.map((d) => <DimChip key={d} label={L(reg.dim(d)?.label) || d} onDragStart={() => (drag.current = { kind: 'dim', id: d, from: 'columns' })} onSwap={design.rows.length < 4 ? () => moveDim(d, 'rows', design.rows.length) : undefined} swapLabel={t('انقله للصفوف')} onRemove={() => removeDim(d)} fb={`dim-chip:${d}`} />)}
                {!design.columns.length && <button type="button" onClick={(e) => setDimPick({ zone: 'columns', rect: (e.currentTarget as HTMLElement).getBoundingClientRect() })} className="w-full h-9 rounded-xl border border-dashed border-[var(--glass-border)] text-sm text-soft hover:border-[var(--primary)] hover:text-[var(--primary)] inline-flex items-center justify-center gap-1.5" data-fb="designer:add-col"><Plus className="w-4 h-4" />{t('ضيف أعمدة')}</button>}
              </Zone>
            </Step>
            <Step n={3} title={t('في أنهي فترة؟')} hint={t('الأيام التجارية — اليوم بيبدأ 4 الفجر.')} icon={<CalendarDays className="w-4 h-4" />}>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
                {PERIODS.map((p) => <button key={p.id} type="button" role="radio" aria-checked={design.period.preset === p.id} onClick={() => upd({ period: p.id === 'CUSTOM' ? { preset: 'CUSTOM', from: design.period.from ?? today(), to: design.period.to ?? today() } : { preset: p.id } })} data-fb={`period:${p.id}`}
                  className={cn('h-9 rounded-xl text-[13px] border transition-colors', design.period.preset === p.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-[var(--glass-border)] hover:surface-2')}>{p.label()}</button>)}
              </div>
              {design.period.preset === 'CUSTOM' && <div className="grid grid-cols-2 gap-2 mt-2"><Field label={t('من')}><Input type="date" value={design.period.from} max={today()} onChange={(e) => upd({ period: { ...design.period, from: e.target.value, to: (design.period.to ?? '') < e.target.value ? e.target.value : design.period.to } })} data-fb="period:from" /></Field><Field label={t('لحد')}><Input type="date" value={design.period.to} min={design.period.from} max={today()} onChange={(e) => upd({ period: { ...design.period, to: e.target.value } })} data-fb="period:to" /></Field></div>}
              <Field label={t('الفرع')} className="mt-2"><Select value={Array.isArray(design.branches) ? design.branches[0] : design.branches} onChange={(e) => upd({ branches: e.target.value === 'DEVICE' || e.target.value === 'ALL' ? (e.target.value as any) : [e.target.value] })} options={[{ value: 'DEVICE', label: t('فرع الجهاز') }, ...branchItems.map((b) => ({ value: b.id, label: b.name })), { value: 'ALL', label: t('كل الفروع المسموحة') }]} data-fb="designer:branch" /></Field>
            </Step>
            <Options open={optsOpen} setOpen={setOptsOpen} design={design} upd={upd} reg={reg} r={r} spec={spec} />
          </aside>

          {/* live preview */}
          <section className="min-w-0 space-y-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)]/40 p-4 @3xl/main:min-h-0 @3xl/main:overflow-y-auto" data-fb="designer:preview">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-dim flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-[var(--primary)]" />{t('معاينة حية — بتتحدث وانت بتعدّل')}</div>
                <div className="text-lg font-bold truncate">{name}</div>
                <div className="text-sm text-soft">{periodText(design.period)}{r ? ` · ${r.meta.branchIds.map((b) => branchItems.find((x) => x.id === b)?.name ?? b).join('، ')}` : ''}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => pv.refetch()} data-fb="designer:refresh"><RefreshCw className={cn('w-4 h-4', pv.loading && 'animate-spin')} />{t('تحديث')}</Button>
            </div>
            {!design.metrics.length ? <EmptyState icon={<Wand2 className="w-6 h-6" />} title={t('ابدأ من الخطوة 1')} text={t('اختار رقم واحد على الأقل (مثلاً صافي مبيعات الأصناف) والمعاينة هتظهر هنا على طول.')} action={<Button variant="primary" onClick={() => setPicker(true)}><Plus className="w-4 h-4" />{t('ضيف رقم')}</Button>} />
              : pv.error && !r ? <Banner tone="error" title={t('التقرير ده ما ينفعش بالشكل ده')}>{errorText(pv.error)} <Tech><span className="num text-xs">({pv.error.code})</span></Tech></Banner>
              : !r ? <div className="space-y-3"><SkeletonCard /><SkeletonCard lines={6} /></div>
              : <>
                <StatusLine r={r} loading={pv.loading} />
                {pv.error && <Banner tone="warning">{errorText(pv.error)}</Banner>}
                <LeftOut r={r} />
                <Kpis r={r} view={design.view.columns} />
                <MiniChart r={r} kind={design.view.chart} view={design.view.columns} />
                {r.rows.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {r.rows.length > 1 && <><Button size="sm" variant="ghost" onClick={() => setExpanded(initialExpanded(r, 9))} data-fb="grid:expand-all">{t('افتح الكل')}</Button><Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())} data-fb="grid:collapse-all">{t('اقفل الكل')}</Button></>}
                      {hiddenCols.length > 0 && <Button size="sm" variant="ghost" onClick={() => setView(design.view.columns.map((c) => ({ ...c, hidden: false })))} data-fb="grid:show-hidden"><Eye className="w-4 h-4" />{t('اظهر {n} عمود مخفي', { n: hiddenCols.length })}</Button>}
                      <span className="flex-1" />
                      <span className="text-dim">{t('دوس على سطر يفتح اللي تحته — وعلى أي رقم يوريك الشيكات اللي وراه')}</span>
                    </div>
                    {r.root.children.length ? <PivotGrid result={r} view={design.view.columns} onView={setView} sort={design.sort ?? null} onSort={(s) => upd({ sort: s })} expanded={expanded} onToggle={toggle} height={560} />
                      : <EmptyState compact title={t('مفيش سطور')} text={EMPTY_TEXT()} />}
                  </div>
                )}
                {!r.rows.length && <div className="text-xs text-dim">{t('من غير تقسيم: الأرقام فوق هي الإجمالي. قسّم حسب حاجة من الخطوة 2 عشان يظهر جدول.')}</div>}
              </>}
          </section>
        </div>
      </div>
      <MetricPicker open={picker} onClose={() => setPicker(false)} reg={reg} selected={design.metrics} dims={[...dims, ...filterDims]} onToggle={addMetric} />
      {dimPick && <DimPicker anchor={dimPick.rect} onClose={() => setDimPick(null)} reg={reg} metrics={design.metrics} taken={dims} onPick={(id) => addDim(dimPick.zone, id)} title={dimPick.zone === 'rows' ? t('قسّم الصفوف حسب') : t('الأعمدة حسب')} />}
      <SaveDialog open={saveOpen} onClose={() => setSaveOpen(false)} design={design} templateId={meta?.templateId ?? null}
        initial={{ name, description: meta?.description ?? params?.description ?? '', category: meta?.category ?? params?.category ?? 'sales', view: meta?.view, edit: meta?.edit, basedOn: params?.basedOn ?? null }}
        existing={meta ? { id: meta.id, version: meta.version, canEdit: meta.canEdit, canShare: meta.canShare } : null}
        onSaved={(x) => { loadedKey.current = `${x.id}:${x.version}`; setMeta({ id: x.id, version: x.version, canEdit: x.canEdit, canShare: x.canShare, description: x.description, category: x.category, view: x.view, edit: x.edit, templateId: x.templateId, ownerName: x.ownerName }); setName(x.name); setDirty(false); if (savedId !== x.id) nav('report-designer', { savedId: x.id }); }} />
      {meta && <HistoryDrawer id={meta.id} open={historyOpen} onClose={() => setHistoryOpen(false)} current={design} onRestored={(x) => { loadedKey.current = ''; savedQ.refetch(); void x; }} />}
      {print && r && <PrintStudio source={{ kind: 'pivot', result: r, title: name, view: design.view.columns, chart: design.view.chart, savedId: meta && !dirty ? meta.id : null, spec, templateId: meta?.templateId ?? null }} onClose={() => setPrint(false)} />}
      <EvidenceDrawer spec={ev} onClose={() => setEv(null)} />
    </EvidenceCtx.Provider>
  );
}

const normalize = (d: ReportDesign): ReportDesign => ({ ...emptyDesign(), ...d, view: { ...{ columns: [] as ColumnView[], chart: 'bars' as const, expandDepth: 1 }, ...(d.view ?? {}) }, format: d.format ?? { preset: 'none' } });

function Step({ n, title, hint, icon, children }: { n: number; title: string; hint: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)]/70 p-3.5 space-y-2.5" data-fb={`step:${n}`}>
      <div className="flex items-start gap-2.5">
        <span className="w-7 h-7 rounded-full bg-[var(--primary)]/15 text-[var(--primary)] font-extrabold text-sm flex items-center justify-center shrink-0 num">{n}</span>
        <div className="min-w-0"><div className="font-bold flex items-center gap-1.5">{title}<span className="text-dim">{icon}</span></div><div className="text-[11px] text-dim">{hint}</div></div>
      </div>
      {children}
    </section>
  );
}
function IconBtn({ label, onClick, disabled, children, fb }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; fb?: string }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} data-fb={fb} className="w-6 h-6 rounded-md inline-flex items-center justify-center text-soft hover:surface-2 hover:text-[var(--foreground)] disabled:opacity-30">{children}</button>;
}
function Zone({ title, icon, empty, children, onDrop, fb }: { title: string; icon: React.ReactNode; empty: string; children: React.ReactNode; onDrop: () => void; fb: string }) {
  const [over, setOver] = useState(false);
  const kids = React.Children.toArray(children).filter(Boolean);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={() => { setOver(false); onDrop(); }} className={cn('rounded-xl p-2 space-y-1.5 border transition-colors', over ? 'border-[var(--primary)] bg-[var(--primary)]/5' : 'border-transparent surface-1')} data-fb={fb}>
      <div className="text-[11px] font-bold text-soft flex items-center gap-1">{icon}{title}</div>
      {kids}
      {kids.length <= 1 && <div className="text-[11px] text-dim">{empty}</div>}
    </div>
  );
}
function DimChip({ label, n, onDragStart, onDrop, onUp, onDown, onSwap, swapLabel, onRemove, fb }: { label: string; n?: number; onDragStart: () => void; onDrop?: () => void; onUp?: () => void; onDown?: () => void; onSwap?: () => void; swapLabel: string; onRemove: () => void; fb: string }) {
  return (
    <div draggable onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { if (onDrop) { e.stopPropagation(); onDrop(); } }} className="group flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 h-9" data-fb={fb}>
      <GripVertical className="w-4 h-4 text-dim cursor-grab shrink-0" />
      {n !== undefined && <span className="w-5 h-5 rounded-md surface-2 text-[11px] font-bold flex items-center justify-center num shrink-0">{n}</span>}
      <span className="flex-1 min-w-0 truncate text-sm">{label}</span>
      <span className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {onUp && <IconBtn label={t('لفوق')} onClick={onUp}><ChevronUp className="w-3.5 h-3.5" /></IconBtn>}
        {onDown && <IconBtn label={t('لتحت')} onClick={onDown}><ChevronDown className="w-3.5 h-3.5" /></IconBtn>}
        {onSwap && <IconBtn label={swapLabel} onClick={onSwap}><ArrowLeftRight className="w-3.5 h-3.5" /></IconBtn>}
      </span>
      <IconBtn label={t('شيل')} onClick={onRemove}><X className="w-3.5 h-3.5" /></IconBtn>
    </div>
  );
}

function DownloadMenu({ busy, disabled, onPick, onPdf }: { busy: string | null; disabled?: boolean; onPick: (f: 'XLSX' | 'CSV') => void; onPdf: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" disabled={disabled} loading={!!busy} onClick={() => setOpen(!open)} data-fb="designer:download"><Download className="w-4 h-4" />{t('تنزيل')}</Button>
      {open && (
        <div className="absolute z-40 mt-1 end-0 w-56 overlay-panel rounded-xl border border-[var(--glass-border)] shadow-[var(--shadow-pop)] p-1.5" data-fb="download-menu">
          <MenuRow icon={<FileSpreadsheet className="w-4 h-4 text-[var(--success)]" />} title={t('إكسل')} sub={t('مجمّع ومنسّق + صفحة التعريفات')} onClick={() => { setOpen(false); onPick('XLSX'); }} fb="dl:xlsx" />
          <MenuRow icon={<FileText className="w-4 h-4 text-[var(--error)]" />} title={t('PDF')} sub={t('من معاينة الطباعة')} onClick={() => { setOpen(false); onPdf(); }} fb="dl:pdf" />
          <MenuRow icon={<FileText className="w-4 h-4 text-dim" />} title="CSV" sub={t('جدول بسيط لبرامج تانية')} onClick={() => { setOpen(false); onPick('CSV'); }} fb="dl:csv" />
        </div>
      )}
    </div>
  );
}
export function MenuRow({ icon, title, sub, onClick, fb }: { icon: React.ReactNode; title: string; sub?: string; onClick: () => void; fb?: string }) {
  return <button type="button" onClick={onClick} data-fb={fb} className="w-full flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:surface-2 text-start"><span className="mt-0.5">{icon}</span><span className="min-w-0"><span className="block text-sm font-bold">{title}</span>{sub && <span className="block text-[11px] text-dim">{sub}</span>}</span></button>;
}

/** «خيارات»: one tidy panel, safe defaults, presets instead of knobs. */
function Options({ open, setOpen, design, upd, reg, r, spec }: { open: boolean; setOpen: (v: boolean) => void; design: ReportDesign; upd: (p: Partial<ReportDesign>) => void; reg: Registry; r: PivotResult | null; spec: any }) {
  const dims = [...design.rows, ...design.columns];
  const summary = [
    design.compare ? ({ previous_period: t('مقارنة بالفترة اللي قبلها'), last_week: t('مقارنة بالأسبوع اللي فات'), last_year: t('مقارنة بالسنة اللي فاتت') } as Record<string, string>)[design.compare] : null,
    design.topN ? t('أعلى {n}', { n: design.topN.n }) : null,
    (design.extras ?? []).length ? t('{n} رقم إضافي', { n: design.extras!.length }) : null,
    design.format?.preset && design.format.preset !== 'none' ? t('ألوان') : null,
    (design.calcs ?? []).length ? t('{n} رقم محسوب', { n: design.calcs!.length }) : null,
    Object.keys(design.filters ?? {}).length + Object.keys(design.exclude ?? {}).length ? t('فلتر') : null,
    (design.having ?? []).length ? t('شرط') : null,
  ].filter(Boolean) as string[];
  const ex = new Set(design.extras ?? []);
  const toggleExtra = (k: any) => { const s = new Set(ex); s.has(k) ? s.delete(k) : s.add(k); upd({ extras: [...s] as any }); };
  const measureOpts = r ? r.measures.filter((m) => m.kind === 'value' || m.kind === 'calc' || m.kind === 'change' || m.kind === 'change_pct').map((m) => ({ value: m.id, label: L(m.label) })) : design.metrics.map((m) => ({ value: m, label: L(reg.metric(m)?.label) || m }));
  const timeRow = design.rows.includes('business_date') || design.rows.includes('business_week');
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)]/70" data-fb="designer:options">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 p-3.5 text-start" aria-expanded={open} data-fb="options:toggle">
        <SlidersHorizontal className="w-4 h-4 text-[var(--primary)]" />
        <span className="font-bold">{t('خيارات')}</span>
        <span className="flex-1 min-w-0 truncate text-[11px] text-dim">{summary.length ? summary.join(' · ') : t('المقارنة، أعلى كام، الترتيب، الألوان، الفلاتر')}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-3.5 border-t line pt-3">
          <Field label={t('قارن بـ')}><Select value={design.compare ?? ''} onChange={(e) => upd({ compare: (e.target.value || null) as any, format: !e.target.value && design.format?.preset === 'arrows' ? { preset: 'none' } : design.format })} options={[{ value: '', label: t('من غير مقارنة') }, { value: 'previous_period', label: t('الفترة اللي قبلها') }, { value: 'last_week', label: t('نفس الأيام الأسبوع اللي فات') }, { value: 'last_year', label: t('نفس الأيام السنة اللي فاتت') }]} data-fb="opt:compare" /></Field>
          <div>
            <div className="text-xs text-soft mb-1.5">{t('أرقام إضافية لأول رقم')}</div>
            <div className="flex flex-wrap gap-1.5">
              {([['share_total', t('النسبة من الإجمالي')], ['share_parent', t('النسبة من المجموعة')], ['rank', t('الترتيب')], ['rolling7', t('آخر 7 أيام')], ['mtd', t('من أول الشهر')], ['ytd', t('من أول السنة')]] as const).map(([k, label]) => {
                const off = timeRow && (k === 'rolling7' || k === 'mtd' || k === 'ytd');
                return <button key={k} type="button" disabled={off} title={off ? t('التراكمي مش منطقي والتقسيم بالأيام') : undefined} onClick={() => toggleExtra(k)} data-fb={`opt:extra:${k}`} className={cn('px-2.5 h-7 rounded-full text-xs border', ex.has(k as any) ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-[var(--glass-border)] hover:surface-2', off && 'opacity-40')}>{label}</button>;
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('اعرض')}><Select value={String(design.topN?.n ?? 0)} onChange={(e) => upd({ topN: Number(e.target.value) ? { n: Number(e.target.value), others: design.topN?.others ?? true } : null })} options={[{ value: '0', label: t('كل الصفوف') }, { value: '5', label: t('أعلى 5') }, { value: '10', label: t('أعلى 10') }, { value: '20', label: t('أعلى 20') }]} data-fb="opt:topn" /></Field>
            <Field label={t('رتّب حسب')}><Select value={design.sort?.by ?? ''} onChange={(e) => upd({ sort: e.target.value ? { by: e.target.value, dir: design.sort?.dir ?? 'desc' } : null })} options={[{ value: '', label: t('تلقائي') }, { value: 'label', label: t('الاسم / الوقت') }, ...measureOpts]} data-fb="opt:sort" /></Field>
          </div>
          {design.topN && <Switch checked={design.topN.others} onChange={(v) => upd({ topN: { ...design.topN!, others: v } })} label={t('اجمع الباقي في سطر واحد «الباقي»')} />}
          {design.sort?.by && <SegmentedControl size="sm" value={design.sort.dir} onChange={(v) => upd({ sort: { ...design.sort!, dir: v } })} options={[{ id: 'desc', label: t('من الأكبر') }, { id: 'asc', label: t('من الأصغر') }]} />}
          <Field label={t('الألوان')}>
            <Select value={design.format?.preset ?? 'none'} onChange={(e) => upd({ format: { ...design.format, preset: e.target.value as FormatPreset } })} options={[{ value: 'none', label: t('من غير ألوان') }, { value: 'highlow', label: t('لوّن الأعلى والأقل') }, { value: 'topbottom', label: t('علّم أحسن 3 وأسوأ 3') }, { value: 'below_target', label: t('علّم اللي تحت الهدف') }, ...(design.compare ? [{ value: 'arrows', label: t('أسهم الزيادة والنقص') }] : [])]} data-fb="opt:format" />
          </Field>
          {design.format?.preset && design.format.preset !== 'none' && design.format.preset !== 'arrows' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('على أنهي رقم')}><Select value={design.format.measure ?? design.metrics[0]} onChange={(e) => upd({ format: { ...design.format!, measure: e.target.value } })} options={measureOpts} /></Field>
              {design.format.preset === 'below_target' && <Field label={t('الهدف')}><Input type="number" inputMode="decimal" value={design.format.target ?? ''} onChange={(e) => upd({ format: { ...design.format!, target: e.target.value } })} placeholder="1000" data-fb="opt:target" /></Field>}
            </div>
          )}
          <div>
            <div className="text-xs text-soft mb-1.5">{t('أرقام محسوبة جاهزة')}</div>
            <div className="space-y-1">
              {READY_CALCS.map((c) => {
                const why = whyNot(reg, c.a, [...dims]) ?? whyNot(reg, c.b, [...dims]);
                const on = (design.calcs ?? []).includes(c.id);
                return (
                  <label key={c.id} className={cn('flex items-start gap-2 rounded-lg px-2 py-1.5 hover:surface-1 cursor-pointer', why && !on && 'opacity-45 cursor-not-allowed')} title={why ?? L(c.hint)} data-fb={`opt:calc:${c.id}`}>
                    <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={on} disabled={!!why && !on} onChange={() => upd({ calcs: on ? (design.calcs ?? []).filter((x) => x !== c.id) : [...(design.calcs ?? []), c.id] })} />
                    <span className="min-w-0"><span className="block text-sm">{L(c.label)}</span><span className="block text-[11px] text-dim">{why ?? L(c.hint)}</span></span>
                  </label>
                );
              })}
            </div>
          </div>
          <FilterEditor design={design} upd={upd} reg={reg} spec={spec} />
          <HavingEditor design={design} upd={upd} options={measureOpts} />
          <Field label={t('رسم بياني فوق الجدول')}><SegmentedControl full size="sm" value={design.view.chart} onChange={(v) => upd({ view: { ...design.view, chart: v } })} options={[{ id: 'none', label: t('من غير') }, { id: 'bars', label: t('أعمدة') }, { id: 'line', label: t('على الوقت') }]} /></Field>
          <Field label={t('لما يفتح')}><SegmentedControl full size="sm" value={String(design.view.expandDepth) as any} onChange={(v) => upd({ view: { ...design.view, expandDepth: Number(v) } })} options={[{ id: '1', label: t('المستوى الأول') }, { id: '2', label: t('مستويين') }, { id: '9', label: t('مفتوح كله') }]} /></Field>
        </div>
      )}
    </section>
  );
}

function FilterEditor({ design, upd, reg, spec }: { design: ReportDesign; upd: (p: Partial<ReportDesign>) => void; reg: Registry; spec: any }) {
  const { auth } = useDev();
  const [dim, setDim] = useState('');
  const [mode, setMode] = useState<'only' | 'except'>('only');
  const [vals, setVals] = useState<{ id: string; label: string }[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const legal = reg.dims.filter((d) => d.status === 'AVAILABLE' && design.metrics.every((m) => reg.metric(m)?.dimensions.includes(d.id)));
  const load = async (d: string) => {
    setDim(d); setVals(null); setPick([...(design.filters?.[d] ?? design.exclude?.[d] ?? [])]); setMode(design.exclude?.[d] ? 'except' : 'only');
    if (!d || !spec) return;
    setLoading(true);
    try { const q = await call<any>(auth, 'Report.Query', { query: { q: JSON.stringify({ metrics: [design.metrics[0]], dimensions: [d], from: spec.from, to: spec.to, branchIds: spec.branchIds }) } }); setVals(q.data.rows.map((x: any) => ({ id: x.dims[d] ?? '∅', label: L(x.labels[d]) }))); } catch { setVals([]); } finally { setLoading(false); }
  };
  const apply = () => {
    const f = { ...(design.filters ?? {}) }; const x = { ...(design.exclude ?? {}) }; delete f[dim]; delete x[dim];
    if (pick.length) (mode === 'only' ? f : x)[dim] = pick;
    upd({ filters: f, exclude: x }); setDim(''); setVals(null);
  };
  const chips = [...Object.entries(design.filters ?? {}).map(([d, v]) => ({ d, v, ex: false })), ...Object.entries(design.exclude ?? {}).map(([d, v]) => ({ d, v, ex: true }))];
  return (
    <div className="space-y-1.5" data-fb="opt:filters">
      <div className="text-xs text-soft flex items-center gap-1"><Filter className="w-3.5 h-3.5" />{t('فلتر')}</div>
      {chips.map((c) => (
        <div key={c.d} className="flex items-center gap-1.5 rounded-lg surface-1 px-2 py-1 text-xs">
          <span className="font-bold">{L(reg.dim(c.d)?.label)}</span><span className="text-dim">{c.ex ? t('ما عدا') : t('بس')}</span><span className="flex-1 truncate">{t('{n} اختيار', { n: c.v.length })}</span>
          <button type="button" onClick={() => load(c.d)} className="text-[var(--primary)]">{t('عدّل')}</button>
          <button type="button" aria-label={t('شيل')} onClick={() => { const f = { ...(design.filters ?? {}) }; const x = { ...(design.exclude ?? {}) }; delete f[c.d]; delete x[c.d]; upd({ filters: f, exclude: x }); }}><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <Select value={dim} onChange={(e) => load(e.target.value)} options={[{ value: '', label: t('+ اعرض بس… / ما عدا…') }, ...legal.map((d) => ({ value: d.id, label: L(d.label) }))]} data-fb="opt:filter-dim" />
      {dim && (
        <div className="rounded-xl border border-[var(--glass-border)] p-2 space-y-2">
          <SegmentedControl full size="sm" value={mode} onChange={setMode} options={[{ id: 'only', label: t('بس دول') }, { id: 'except', label: t('ما عدا دول') }]} />
          {loading ? <Spinner /> : !vals?.length ? <div className="text-xs text-dim">{t('مفيش قيم في الفترة دي.')}</div> : (
            <div className="max-h-44 overflow-y-auto space-y-0.5">
              {vals.map((v) => <label key={v.id} className="flex items-center gap-2 text-sm px-1 py-0.5 rounded hover:surface-1 cursor-pointer"><input type="checkbox" className="accent-[var(--primary)]" checked={pick.includes(v.id)} onChange={() => setPick(pick.includes(v.id) ? pick.filter((x) => x !== v.id) : [...pick, v.id])} /><span className="truncate">{v.label}</span></label>)}
            </div>
          )}
          <div className="flex gap-1.5 justify-end"><Button size="sm" variant="ghost" onClick={() => { setDim(''); setVals(null); }}>{t('إلغاء')}</Button><Button size="sm" variant="primary" onClick={apply} data-fb="opt:filter-apply">{t('طبّق')}</Button></div>
        </div>
      )}
    </div>
  );
}
function HavingEditor({ design, upd, options }: { design: ReportDesign; upd: (p: Partial<ReportDesign>) => void; options: { value: string; label: string }[] }) {
  const h = design.having?.[0];
  return (
    <div className="space-y-1.5" data-fb="opt:having">
      <div className="text-xs text-soft">{t('اعرض الصفوف اللي فيها (في آخر مستوى)')}</div>
      <div className="grid grid-cols-[1fr_88px] gap-1.5">
        <Select value={h?.measure ?? ''} onChange={(e) => upd({ having: e.target.value ? [{ measure: e.target.value, op: h?.op ?? 'gte', value: h?.value ?? '' }] : [] })} options={[{ value: '', label: t('من غير شرط') }, ...options]} data-fb="opt:having-measure" />
        <Select value={h?.op ?? 'gte'} disabled={!h} onChange={(e) => upd({ having: [{ ...h!, op: e.target.value as any }] })} options={[{ value: 'gte', label: t('على الأقل') }, { value: 'lt', label: t('أقل من') }]} />
      </div>
      {h && <Input type="number" inputMode="decimal" value={h.value} onChange={(e) => upd({ having: [{ ...h, value: e.target.value }] })} placeholder={t('القيمة')} data-fb="opt:having-value" />}
    </div>
  );
}
