// «التقارير» — the reports home and the report pages.
//  • Home: one search box, simple filters (الكل / المفضلة / فتحتها قريب / المعتمدة / تقاريري), cards grouped by topic
//    with a clear «معتمد» or «مخصص» badge and a star. Tabs for sending (schedules), print templates and the activity log.
//  • A report page is calm by default: title, period, a status line, up to four big numbers, one chart and the table.
//    More is one click away: «قسّم حسب…», «قارن بـ…», «تفاصيل أكتر» (the designer), print / PDF, download, schedule.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileBarChart, Search, Star, ShieldCheck, Wand2, MessageCircleQuestion, ArrowRight, ArrowLeft, Printer, Download, CalendarClock, Pencil, Copy, History, MoreHorizontal, ClipboardCheck, BookOpen, ChevronDown, Archive, Layers, FileSpreadsheet, FileText, LayoutTemplate, Activity, RefreshCw, Clock, Sparkles, User, Plus } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { PageHeader, Tabs, Card, Button, Pill, SearchInput, FilterChips, EmptyState, Skeleton, SkeletonCard, Banner, Select, Spinner, toast, confirmDialog, StateBadge, Table } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { cn, dateTime } from '../../lib/format';
import { Tech } from '../../app/tech';
import { REPORT_CATEGORIES } from '../../reports/studio';
import { EvidenceCtx, type EvidenceSpec } from './parts';
import { EvidencePopup } from './Evidence';
import { ReportView } from './ReportView';
import { ExpertReview } from './ExpertReview';
import { AskDock } from './Assistant';
import { usePivot, designSpec, useRegistry, PERIODS, periodText, lang, today, useClickAway, EMPTY_TEXT } from './studio/common';
import { PivotGrid, initialExpanded } from './studio/PivotGrid';
import { Kpis, MiniChart, StatusLine, LeftOut, DefinitionsList } from './studio/Summary';
import { PrintStudio, type PrintSource } from './studio/PrintStudio';
import { SchedulesPanel, ScheduleDialog } from './studio/Schedules';
import { HistoryPopup, shareText, actionText } from './studio/SaveHistory';
import { exportPivot, exportCertified } from './studio/exports';
import { MenuRow } from './Designer';
import { SalesOverview } from '../ops/ReportExtras';
import type { PeriodPreset } from '../../reports/pivot';
import { resolvePeriod } from '../../reports/pivot';
import { CHECKLIST } from '../../reports/expert';
import { rangeText } from '../../reports/format';

const CORE_CHECKLIST = ['definition', 'example', 'business_date', 'provisional', 'not_available', 'permissions', 'export_parity'];
type Filter = 'all' | 'fav' | 'recent' | 'certified' | 'mine';

// ─────────────────────────── home
export function ReportsHome({ legacy, onLegacy }: { legacy: any[]; onLegacy: (id: string) => void }) {
  const { nav, params } = useDev();
  const list = useQuery<any>('Report.List');
  const sq = useQuery<any>('SavedReport.Find');
  const { run } = useCommand();
  const [tab, setTab] = useState<'reports' | 'schedules' | 'templates' | 'activity'>(params?.tab ?? 'reports');
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const [cat, setCat] = useState<string>('');
  const certified: any[] = (list.data?.items ?? []).filter((r: any) => r.certified);
  const saved: any[] = sq.data?.items ?? [];
  const favs: string[] = sq.data?.favourites ?? [];
  const recent: { id: string; at: string }[] = sq.data?.recent ?? [];
  const cards = useMemo(() => [
    ...certified.map((r) => ({ kind: 'certified' as const, id: r.id, title: L(r.title), text: L(r.purpose), category: REPORT_CATEGORIES[r.family] ? r.family : 'other', pilot: r.pilot, owner: null as string | null, share: null as string | null })),
    ...saved.map((r) => ({ kind: 'saved' as const, id: r.id, title: r.name, text: r.description, category: r.category, pilot: false, owner: r.ownerName, share: shareText(r.view) })),
  ], [certified, saved]);
  const lastAt = (id: string) => recent.find((x) => x.id === id)?.at ?? null;
  const match = (c: (typeof cards)[number]) => (!q.trim() || `${c.title} ${c.text}`.includes(q.trim())) && (!cat || c.category === cat) && (f === 'all' || (f === 'fav' && favs.includes(c.id)) || (f === 'recent' && !!lastAt(c.id)) || (f === 'certified' && c.kind === 'certified') || (f === 'mine' && c.kind === 'saved'));
  const shown = cards.filter(match).sort((a, b) => (f === 'recent' ? String(lastAt(b.id)).localeCompare(String(lastAt(a.id))) : 0));
  const grouped = Object.keys(REPORT_CATEGORIES).map((k) => [k, shown.filter((c) => c.category === k)] as const).filter(([, xs]) => xs.length);
  const star = async (id: string) => { await run('SavedReport.Favourite', { body: { id } }); sq.refetch(); };
  const open = (c: { kind: 'certified' | 'saved'; id: string }) => nav('reports', c.kind === 'certified' ? { reportId: c.id } : { savedId: c.id });
  const loading = (list.loading && !list.data) || (sq.loading && !sq.data);
  const quick = !q.trim() && f === 'all' && !cat;
  const favCards = cards.filter((c) => favs.includes(c.id));
  const recentCards = recent.map((r) => cards.find((c) => c.id === r.id)).filter(Boolean).slice(0, 4) as typeof cards;
  return (
    <AskDock>
    <div className="space-y-4 pb-16" data-screen-id="H1" data-fb="reports-home">
      <PageHeader title={t('التقارير')} icon={<FileBarChart className="w-5 h-5" />} badge={<StateBadge ops={['Report.List', 'SavedReport.Find', 'Report.Pivot', 'Report.Run']} />}
        description={t('كل أرقام المطعم في مكان واحد. دوس على أي رقم يوريك الشيكات اللي وراه.')}
        actions={<>
          <Button size="sm" variant="outline" onClick={() => nav('report-assistant')} data-fb="reports:ask"><MessageCircleQuestion className="w-4 h-4" />{t('اسأل التقارير')}</Button>
          <Button size="sm" variant="primary" onClick={() => nav('report-designer')} data-fb="reports:new"><Wand2 className="w-4 h-4" />{t('اعمل تقرير')}</Button>
        </>} />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[
        { id: 'reports', label: t('التقارير'), count: cards.length || undefined, fb: 'reports-tab:catalog' },
        { id: 'schedules', label: t('بتتبعت لوحدها'), fb: 'reports-tab:schedules' },
        { id: 'templates', label: t('قوالب الطباعة'), fb: 'reports-tab:templates' },
        { id: 'activity', label: t('السجل'), fb: 'reports-tab:activity' },
      ]} />
      {tab === 'schedules' && <SchedulesPanel certified={certified} />}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'activity' && <ActivityPanel />}
      {tab === 'reports' && <>
        <div className="flex items-center gap-2 flex-wrap">
          <SearchInput value={q} onChange={setQ} placeholder={t('دوّر على تقرير: مبيعات، درج، أصناف…')} className="w-full @3xl/main:w-80" data-fb="reports:search" />
          <FilterChips value={f} onChange={setF} options={[
            { id: 'all', label: t('الكل'), count: cards.length, fb: 'reports-filter:all' }, { id: 'fav', label: t('المفضلة'), count: favs.length, fb: 'reports-filter:fav' },
            { id: 'recent', label: t('فتحتها قريب'), count: recent.length, fb: 'reports-filter:recent' }, { id: 'certified', label: t('المعتمدة'), count: certified.length, fb: 'reports-filter:certified' },
            { id: 'mine', label: t('تقاريري'), count: saved.length, fb: 'reports-filter:mine' },
          ]} />
          <span className="flex-1" />
          <div className="w-48"><Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل المواضيع') }, ...Object.entries(REPORT_CATEGORIES).filter(([k]) => cards.some((c) => c.category === k)).map(([k, v]) => ({ value: k, label: L(v) }))]} data-fb="reports:category" /></div>
        </div>
        {loading ? <div className="grid @3xl/main:grid-cols-2 @6xl/main:grid-cols-3 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonCard key={i} />)}</div> : <>
          {quick && (favCards.length > 0 || recentCards.length > 0) && (
            <div className="grid @5xl/main:grid-cols-2 gap-3">
              {favCards.length > 0 && <Shelf title={t('المفضلة')} icon={<Star className="w-4 h-4 text-amber-400 fill-amber-400" />}>{favCards.slice(0, 4).map((c) => <MiniRow key={c.id} c={c} onOpen={() => open(c)} />)}</Shelf>}
              {recentCards.length > 0 && <Shelf title={t('فتحتها قريب')} icon={<Clock className="w-4 h-4 text-[var(--primary)]" />}>{recentCards.map((c) => <MiniRow key={c.id} c={c} at={lastAt(c.id)} onOpen={() => open(c)} />)}</Shelf>}
            </div>
          )}
          {!shown.length ? <EmptyState icon={<Search className="w-6 h-6" />} title={t('مفيش تقرير بالشكل ده')} text={t('جرّب كلمة تانية أو شيل الفلتر — أو اعمل تقرير جديد بنفسك.')} action={<Button variant="primary" onClick={() => nav('report-designer')}><Wand2 className="w-4 h-4" />{t('اعمل تقرير')}</Button>} /> : grouped.map(([k, xs]) => (
            <section key={k} className="space-y-2">
              <div className="text-sm font-bold text-soft">{L(REPORT_CATEGORIES[k])} <span className="text-dim font-normal num">({xs.length})</span></div>
              <div className="grid @3xl/main:grid-cols-2 @6xl/main:grid-cols-3 gap-3">
                {xs.map((c) => (
                  <div key={c.kind + c.id} role="button" tabIndex={0} onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)} data-fb={`report-card:${c.id}`}
                    className="group text-start rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)] p-4 hover:border-[var(--primary)]/50 hover:shadow-[var(--shadow-card)] transition-all cursor-pointer flex flex-col gap-2 min-h-[132px]">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 font-bold leading-snug group-hover:text-[var(--primary)]">{c.title}</div>
                      <button type="button" onClick={(e) => { e.stopPropagation(); star(c.id); }} aria-label={favs.includes(c.id) ? t('شيل من المفضلة') : t('ضيف للمفضلة')} data-fb={`report-star:${c.id}`} className="shrink-0 -m-1 p-1 rounded-lg hover:surface-2"><Star className={cn('w-4 h-4', favs.includes(c.id) ? 'text-amber-400 fill-amber-400' : 'text-dim')} /></button>
                    </div>
                    <div className="text-xs text-soft line-clamp-2 flex-1">{c.text || t('من غير وصف')}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.kind === 'certified' ? <Pill size="sm" tone="success"><ShieldCheck className="w-3 h-3 inline me-0.5" />{t('معتمد')}</Pill> : <Pill size="sm" tone="violet"><Sparkles className="w-3 h-3 inline me-0.5" />{t('مخصص')}</Pill>}
                      {c.owner && <span className="text-[11px] text-dim inline-flex items-center gap-0.5"><User className="w-3 h-3" />{c.owner.split(' — ')[0]}</span>}
                      {c.share && <span className="text-[11px] text-dim">· {c.share}</span>}
                      {lastAt(c.id) && <span className="text-[11px] text-dim ms-auto num">{dateTime(lastAt(c.id)!)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {quick && (
            <details className="rounded-2xl border border-[var(--glass-border)] p-3 text-sm" data-fb="reports:overview">
              <summary className="cursor-pointer text-soft">{t('نظرة سريعة على مبيعات آخر الأيام')}</summary>
              <div className="pt-3"><SalesOverview /></div>
            </details>
          )}
          {quick && legacy.length > 0 && (
            <details className="rounded-2xl border border-[var(--glass-border)] p-3 text-sm" data-fb="reports:legacy">
              <summary className="cursor-pointer text-soft">{t('عرض سريع من التقارير القديمة')} <span className="text-dim num">({legacy.length})</span></summary>
              <div className="flex flex-wrap gap-1.5 pt-2">{legacy.map((x) => <Button key={x.id} size="sm" variant="ghost" onClick={() => onLegacy(x.id)} data-fb={`reports:pick:${x.id}`}>{L(x.title)}</Button>)}</div>
            </details>
          )}
          {/* ux-07: the reports-engine page is a demo / engineering page */}
          <Tech><div className="flex items-center gap-2 text-xs text-dim"><Layers className="w-3.5 h-3.5" />{t('عايز تشوف إزاي الأرقام بتتحسب من أولها؟')}<button type="button" className="text-[var(--primary)] underline" onClick={() => nav('report-catalog')} data-fb="reports:engine">{t('محرك التقارير')}</button></div></Tech>
        </>}
      </>}
    </div>
    </AskDock>
  );
}
function Shelf({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)]/70 p-3 space-y-1"><div className="text-sm font-bold flex items-center gap-1.5 mb-1">{icon}{title}</div>{children}</div>;
}
function MiniRow({ c, at, onOpen }: { c: { kind: string; id: string; title: string }; at?: string | null; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:surface-2 text-start text-sm" data-fb={`shelf:${c.id}`}>{c.kind === 'certified' ? <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)] shrink-0" /> : <Sparkles className="w-3.5 h-3.5 text-[var(--violet)] shrink-0" />}<span className="flex-1 truncate">{c.title}</span>{at && <span className="text-[11px] text-dim num shrink-0">{dateTime(at)}</span>}</button>;
}

// ─────────────────────────── shared report page chrome
function BackTitle({ title, badge, sub, onBack, star, onStar }: { title: string; badge: React.ReactNode; sub?: React.ReactNode; onBack: () => void; star: boolean; onStar: () => void }) {
  return (
    <div className="flex items-start gap-2 min-w-0 flex-1 basis-[22rem]">
      <Button size="icon" variant="ghost" onClick={onBack} aria-label={t('كل التقارير')} data-fb="report:back">{getLang() === 'en' ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}</Button>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap"><h1 className="text-xl font-extrabold leading-tight">{title}</h1>{badge}<button type="button" onClick={onStar} aria-label={star ? t('شيل من المفضلة') : t('ضيف للمفضلة')} data-fb="report:star" className="p-1 rounded-lg hover:surface-2"><Star className={cn('w-4 h-4', star ? 'text-amber-400 fill-amber-400' : 'text-dim')} /></button></div>
        {sub && <div className="text-sm text-soft mt-0.5 line-clamp-2">{sub}</div>}
      </div>
    </div>
  );
}
function PeriodBar({ preset, from, to, onPreset, onRange, branch, setBranch, branches, range = true, extra }: { preset: PeriodPreset; from: string; to: string; onPreset: (p: PeriodPreset) => void; onRange: (f: string, t2: string) => void; branch: string; setBranch: (b: string) => void; branches: any[]; range?: boolean; extra?: React.ReactNode }) {
  const opts = PERIODS.filter((p) => range || ['TODAY', 'YESTERDAY', 'CUSTOM'].includes(p.id));
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)]/70 px-3 py-2" data-fb="report:periodbar">
      <div className="flex items-center gap-1 flex-wrap">{opts.map((p) => <button key={p.id} type="button" onClick={() => onPreset(p.id)} data-fb={`report-period:${p.id}`} className={cn('px-3 h-8 rounded-full text-[13px] border transition-colors', preset === p.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'border-transparent hover:surface-2')}>{p.label()}</button>)}</div>
      {preset === 'CUSTOM' && <div className="flex items-center gap-1.5"><input type="date" className="h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 text-[13px] num" value={from} max={today()} onChange={(e) => onRange(e.target.value, range ? (to < e.target.value ? e.target.value : to) : e.target.value)} data-fb="report:from" />{range && <><span className="text-dim">→</span><input type="date" className="h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 text-[13px] num" value={to} min={from} max={today()} onChange={(e) => onRange(from, e.target.value)} data-fb="report:to" /></>}</div>}
      <span className="text-xs text-dim">{preset !== 'CUSTOM' ? rangeText(from, to, lang()) : ''}</span>
      <span className="flex-1" />
      {extra}
      <select className="h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 text-[13px] max-w-[200px]" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={t('الفرع')} data-fb="report:branch">
        <option value="">{t('فرع الجهاز')}</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="*">{t('كل الفروع')}</option>
      </select>
    </div>
  );
}
function ActionsMenu({ items }: { items: { icon: React.ReactNode; title: string; sub?: string; onClick: () => void; fb?: string; hidden?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <Button size="icon" variant="ghost" onClick={() => setOpen(!open)} aria-label={t('اختيارات تانية')} data-fb="report:more"><MoreHorizontal className="w-5 h-5" /></Button>
      {open && <div className="absolute z-40 mt-1 end-0 w-60 overlay-panel rounded-xl border border-[var(--glass-border)] shadow-[var(--shadow-pop)] p-1.5" data-fb="report-more-menu">{items.filter((x) => !x.hidden).map((x, i) => <MenuRow key={i} icon={x.icon} title={x.title} sub={x.sub} fb={x.fb} onClick={() => { setOpen(false); x.onClick(); }} />)}</div>}
    </div>
  );
}
function DownloadButton({ busy, onPick }: { busy: string | null; onPick: (f: 'XLSX' | 'CSV' | 'PDF') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" loading={!!busy} onClick={() => setOpen(!open)} data-fb="report:download"><Download className="w-4 h-4" />{t('تنزيل')}</Button>
      {open && <div className="absolute z-40 mt-1 end-0 w-56 overlay-panel rounded-xl border border-[var(--glass-border)] shadow-[var(--shadow-pop)] p-1.5" data-fb="download-menu">
        <MenuRow icon={<FileSpreadsheet className="w-4 h-4 text-[var(--success)]" />} title={t('إكسل')} sub={t('مجمّع ومنسّق + صفحة التعريفات')} onClick={() => { setOpen(false); onPick('XLSX'); }} fb="dl:xlsx" />
        <MenuRow icon={<FileText className="w-4 h-4 text-[var(--error)]" />} title="PDF" sub={t('من معاينة الطباعة')} onClick={() => { setOpen(false); onPick('PDF'); }} fb="dl:pdf" />
        <MenuRow icon={<FileText className="w-4 h-4 text-dim" />} title="CSV" sub={t('جدول بسيط لبرامج تانية')} onClick={() => { setOpen(false); onPick('CSV'); }} fb="dl:csv" />
      </div>}
    </div>
  );
}
function useFavs() {
  const sq = useQuery<any>('SavedReport.Find');
  const { run } = useCommand();
  return { favs: (sq.data?.favourites ?? []) as string[], toggle: async (id: string) => { await run('SavedReport.Favourite', { body: { id } }); sq.refetch(); }, certifiedList: sq };
}
function useRangeState(initial: PeriodPreset) {
  const [preset, setPreset] = useState<PeriodPreset>(initial);
  const [custom, setCustom] = useState(() => resolvePeriod(initial, today()));
  const range = preset === 'CUSTOM' ? custom : resolvePeriod(preset, today());
  return { preset, range, setPreset: (p: PeriodPreset) => { if (p === 'CUSTOM') setCustom(range); setPreset(p); }, setRange: (f: string, t2: string) => { setCustom({ from: f, to: t2 }); setPreset('CUSTOM'); } };
}

// ─────────────────────────── certified report page
export function CertifiedPage({ id }: { id: string }) {
  const { auth, nav } = useDev();
  const list = useQuery<any>('Report.List');
  const branches = useQuery<any>('Branch.List');
  const def = (list.data?.items ?? []).find((r: any) => r.id === id);
  const { favs, toggle } = useFavs();
  const { run: runCmd } = useCommand();
  const p = useRangeState(def?.defaultPeriod === 'LAST_7' ? 'LAST_7' : def?.defaultPeriod === 'YESTERDAY' ? 'YESTERDAY' : 'TODAY');
  useEffect(() => { if (def) p.setPreset(def.defaultPeriod === 'LAST_7' ? 'LAST_7' : def.defaultPeriod === 'YESTERDAY' ? 'YESTERDAY' : 'TODAY'); }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [branch, setBranch] = useState('');
  const branchIds = branch === '*' ? (branches.data?.items ?? []).map((b: any) => b.id).join(',') : branch || undefined;
  const isRange = def?.period !== 'DAY';
  const from = p.range.from, to = isRange ? p.range.to : p.range.from;
  const audited = useRef(false);
  const q = useQuery<any>(def ? 'Report.Run' : null, { params: { reportId: id }, query: { fromBusinessDate: from, toBusinessDate: isRange ? to : undefined, branchIds, audit: audited.current ? undefined : '1' } });
  useEffect(() => { if (q.data) audited.current = true; }, [q.data]);
  const r = q.data;
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const [print, setPrint] = useState(false);
  const [sched, setSched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [expert, setExpert] = useState(false);
  const download = async (fmt: 'XLSX' | 'CSV' | 'PDF') => {
    if (fmt === 'PDF') { setPrint(true); return; }
    setBusy(fmt);
    try { const res = await exportCertified(auth, { reportId: id, from, to, branchIds, format: fmt, lang: lang() }); if (res.saved) toast('success', fmt === 'XLSX' ? t('ملف الإكسل اتنزل') : t('ملف CSV اتنزل'), res.filename, auth.label); } catch (e) { toast('error', errorText(e), (e as any)?.code, auth.label); } finally { setBusy(null); }
  };
  const saveAs = async () => { const d = await runCmd('SavedReport.FromCertified', { body: { reportId: id } }); if (d) nav('report-designer', { design: d.design, name: d.name, description: d.description, category: d.category, basedOn: d.basedOn }); };
  const certifiedRows = (list.data?.items ?? []).filter((x: any) => x.certified);
  if (!def && !list.loading) return <EmptyState title={t('التقرير ده مش موجود أو مش مسموح لك تشوفه')} action={<Button onClick={() => nav('reports', {})}>{t('كل التقارير')}</Button>} />;
  return (
    <EvidenceCtx.Provider value={setEv}>
      <AskDock>
      <div className="space-y-3 pb-16" data-screen-id="H1" data-fb="certified-page">
        <div className="flex items-start gap-2 flex-wrap">
          <BackTitle title={def ? L(def.title) : '…'} onBack={() => nav('reports', {})} star={favs.includes(id)} onStar={() => toggle(id)} badge={<Pill size="sm" tone="success"><ShieldCheck className="w-3 h-3 inline me-0.5" />{t('معتمد')}</Pill>} sub={def ? L(def.purpose) : null} />
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button size="sm" variant="ghost" onClick={saveAs} data-fb="report:save-as"><Copy className="w-4 h-4" />{t('احفظ نسخة وعدّل')}</Button>
            <Button size="sm" variant="outline" disabled={!r} onClick={() => setPrint(true)} data-fb="report:print"><Printer className="w-4 h-4" />{t('معاينة الطباعة')}</Button>
            <DownloadButton busy={busy} onPick={download} />
            <Button size="sm" variant="outline" onClick={() => setSched(true)} data-fb="report:schedule"><CalendarClock className="w-4 h-4" />{t('جدولة')}</Button>
            <ActionsMenu items={[{ icon: <ClipboardCheck className="w-4 h-4" />, title: t('مراجعة الخبير'), sub: t('راجع التعريفات ووقّع'), onClick: () => setExpert(true), fb: 'report:expert' }, { icon: <RefreshCw className="w-4 h-4" />, title: t('تحديث'), onClick: () => q.refetch() }]} />
          </div>
        </div>
        <PeriodBar preset={p.preset} from={from} to={to} onPreset={p.setPreset} onRange={p.setRange} branch={branch} setBranch={setBranch} branches={branches.data?.items ?? []} range={isRange} />
        {q.error && <Banner tone="error">{errorText(q.error)} <Tech><span className="num text-xs">({(q.error as any).code})</span></Tech></Banner>}
        {q.loading && !r && <div className="space-y-3"><SkeletonCard /><SkeletonCard lines={6} /></div>}
        {r && <ReportView run={r} hidePurpose />}
        {expert && r && <ExpertReview reportId={r.reportId} reportTitle={L(r.title)} checklist={r.checklist} />}
      </div>
      </AskDock>
      <EvidencePopup spec={ev} onClose={() => setEv(null)} />
      {print && r && <PrintStudio source={{ kind: 'certified', run: { ...r, kpis: kpisOfRun(r) }, templateId: 'tpl_accountant_a4' }} onClose={() => setPrint(false)} />}
      {sched && <ScheduleDialog certified={certifiedRows} prefill={{ kind: 'certified', id }} onClose={() => setSched(false)} onDone={() => toast('success', t('اتجدول'), t('هتلاقيه في «بتتبعت لوحدها»'), auth.label)} />}
    </EvidenceCtx.Provider>
  );
}
/** KPIs of a certified run for printing (the first «kpis» block). */
function kpisOfRun(r: any) { const b = r.blocks?.find((x: any) => x.kind === 'kpis'); if (!b) return []; return b.metrics.slice(0, 6).map((m: string) => { const meta = r.header.metrics.find((x: any) => x.id === m); return { metric: m, label: meta?.label, unit: meta?.unit, value: b.result?.totals[m] ?? null }; }); }

// ─────────────────────────── saved (custom) report page
export function SavedPage({ id }: { id: string }) {
  const { auth, nav } = useDev();
  const reg = useRegistry();
  const sq = useQuery<any>('SavedReport.Get', { params: { savedReportId: id } });
  const list = useQuery<any>('Report.List');
  const branches = useQuery<any>('Branch.List');
  const { favs, toggle } = useFavs();
  const { run } = useCommand();
  const rep = sq.data;
  const branchItems: any[] = branches.data?.items ?? [];
  const p = useRangeState('LAST_7');
  const [inited, setInited] = useState('');
  const [branch, setBranch] = useState('');
  const [compare, setCompare] = useState<string | null>(null);
  const [extraRow, setExtraRow] = useState<string | null>(null);
  useEffect(() => { if (rep && inited !== rep.id) { setInited(rep.id); p.setPreset(rep.design.period.preset); if (rep.design.period.preset === 'CUSTOM') p.setRange(rep.design.period.from, rep.design.period.to); setCompare(rep.design.compare ?? null); setExtraRow(null); } }, [rep?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const design = useMemo(() => rep ? { ...rep.design, period: { preset: 'CUSTOM' as const, from: p.range.from, to: p.range.to }, branches: branch === '*' ? 'ALL' : branch ? [branch] : rep.design.branches, compare: compare as any, rows: extraRow ? [...rep.design.rows, extraRow] : rep.design.rows, format: !compare && rep.design.format?.preset === 'arrows' ? { preset: 'none' } : rep.design.format } : null, [rep, p.range.from, p.range.to, branch, compare, extraRow]);
  const spec = useMemo(() => (design && branchItems.length ? designSpec(design, auth.branchId, branchItems.map((b) => b.id)) : null), [design, auth.branchId, branchItems.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pv = usePivot(spec, 150);
  const r = pv.data;
  // a person opening a saved report is a run: audited once on the server (who, when, period, branches, rows)
  const audited = useRef('');
  useEffect(() => { if (rep && audited.current !== rep.id) { audited.current = rep.id; call(auth, 'Report.Pivot', { query: { savedReportId: id, audit: '1' } }).catch(() => {}); } }, [rep?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastKey = useRef('');
  useEffect(() => { const k = r ? `${r.rows.join()}|${r.columns.join()}` : ''; if (r && k !== lastKey.current) { lastKey.current = k; setExpanded(initialExpanded(r, rep?.design.view.expandDepth ?? 1)); } }, [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const [print, setPrint] = useState(false);
  const [sched, setSched] = useState(false);
  const [hist, setHist] = useState(false);
  const [defs, setDefs] = useState(false);
  const [expert, setExpert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const changed = !!rep && (compare !== (rep.design.compare ?? null) || !!extraRow || !!branch || p.preset !== rep.design.period.preset);
  const download = async (fmt: 'XLSX' | 'CSV' | 'PDF') => {
    if (fmt === 'PDF') { setPrint(true); return; }
    setBusy(fmt);
    try { const res = await exportPivot(auth, { format: fmt, savedId: changed ? null : id, spec: spec!, name: rep.name, view: rep.design.view.columns, lang: lang(), venue: t('مطعم الحاج سامي للمشويات'), branchName: (b) => branchItems.find((x) => x.id === b)?.name ?? b, evidence: fmt === 'XLSX' }); if (res.saved) toast('success', fmt === 'XLSX' ? t('ملف الإكسل اتنزل') : t('ملف CSV اتنزل'), res.filename, auth.label); } catch (e) { toast('error', errorText(e), (e as any)?.code, auth.label); } finally { setBusy(null); }
  };
  const duplicate = async () => { const d = await run('SavedReport.Duplicate', { params: { savedReportId: id } }, { success: t('اتعملت نسخة ليك') }); if (d) nav('report-designer', { savedId: d.id }); };
  const archive = async () => { if (!(await confirmDialog(t('نأرشف «{n}»؟ هيختفي من القايمة، والسجل بتاعه بيفضل.', { n: rep.name }), { danger: true, confirmLabel: t('أرشف') }))) return; if (await run('SavedReport.Delete', { params: { savedReportId: id } }, { success: t('اتأرشف') })) nav('reports', {}); };
  if (sq.error) return <div className="space-y-3"><Banner tone="error">{errorText(sq.error)}</Banner><Button onClick={() => nav('reports', {})}>{t('كل التقارير')}</Button></div>;
  const dimsTaken = [...(design?.rows ?? []), ...(design?.columns ?? [])];
  const addable = rep ? reg.dims.filter((d) => d.status === 'AVAILABLE' && !dimsTaken.includes(d.id) && rep.design.metrics.every((m: string) => reg.metric(m)?.dimensions.includes(d.id))).slice(0, 30) : [];
  return (
    <EvidenceCtx.Provider value={setEv}>
      <AskDock>
      <div className="space-y-3 pb-16" data-screen-id="H1" data-fb="saved-page">
        <div className="flex items-start gap-2 flex-wrap">
          <BackTitle title={rep?.name ?? '…'} onBack={() => nav('reports', {})} star={favs.includes(id)} onStar={() => toggle(id)} badge={<Pill size="sm" tone="violet"><Sparkles className="w-3 h-3 inline me-0.5" />{t('مخصص')}</Pill>}
            sub={rep ? <>{rep.description}<span className="block text-xs text-dim mt-0.5">{rep.ownerName} · {shareText(rep.view)} · {t('نسخة {v}', { v: rep.version })}</span></> : null} />
          <div className="flex items-center gap-1.5 flex-wrap">
            {rep && (rep.canEdit ? <Button size="sm" variant="primary" onClick={() => nav('report-designer', { savedId: id })} data-fb="report:edit"><Pencil className="w-4 h-4" />{t('عدّل')}</Button> : <Button size="sm" variant="outline" onClick={duplicate} data-fb="report:copy"><Copy className="w-4 h-4" />{t('احفظ نسخة وعدّل')}</Button>)}
            <Button size="sm" variant="outline" disabled={!r} onClick={() => setPrint(true)} data-fb="report:print"><Printer className="w-4 h-4" />{t('معاينة الطباعة')}</Button>
            <DownloadButton busy={busy} onPick={download} />
            <Button size="sm" variant="outline" onClick={() => setSched(true)} data-fb="report:schedule"><CalendarClock className="w-4 h-4" />{t('جدولة')}</Button>
            <ActionsMenu items={[
              { icon: <History className="w-4 h-4" />, title: t('السجل والنسخ'), sub: t('مين عمل إيه، وكل النسخ'), onClick: () => setHist(true), fb: 'report:history' },
              { icon: <Copy className="w-4 h-4" />, title: t('اعمل نسخة'), onClick: duplicate, hidden: !rep?.canEdit, fb: 'report:duplicate' },
              { icon: <ClipboardCheck className="w-4 h-4" />, title: t('مراجعة الخبير'), sub: t('راجع التعريفات ووقّع'), onClick: () => setExpert(true), fb: 'report:expert' },
              { icon: <Archive className="w-4 h-4" />, title: t('أرشف التقرير'), onClick: archive, hidden: !rep?.canShare, fb: 'report:archive' },
            ]} />
          </div>
        </div>
        <PeriodBar preset={p.preset} from={p.range.from} to={p.range.to} onPreset={p.setPreset} onRange={p.setRange} branch={branch} setBranch={setBranch} branches={branchItems}
          extra={<>
            <select className="h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 text-[13px] max-w-[200px]" value={compare ?? ''} onChange={(e) => setCompare(e.target.value || null)} aria-label={t('قارن بـ')} data-fb="report:compare">
              <option value="">{t('من غير مقارنة')}</option><option value="previous_period">{t('قارن بالفترة اللي قبلها')}</option><option value="last_week">{t('قارن بالأسبوع اللي فات')}</option><option value="last_year">{t('قارن بالسنة اللي فاتت')}</option>
            </select>
            {rep && rep.design.rows.length < 4 && <select className="h-8 rounded-lg border border-[var(--glass-border)] bg-[var(--card-raised)] px-2 text-[13px] max-w-[200px]" value={extraRow ?? ''} onChange={(e) => setExtraRow(e.target.value || null)} aria-label={t('قسّم حسب…')} data-fb="report:split">
              <option value="">{t('قسّم كمان حسب…')}</option>{addable.map((d) => <option key={d.id} value={d.id}>{L(d.label)}</option>)}
            </select>}
          </>} />
        {changed && <div className="text-xs text-dim flex items-center gap-2">{t('التغييرات دي للعرض بس.')}{rep?.canEdit && <button type="button" className="text-[var(--primary)] underline" onClick={() => nav('report-designer', { savedId: id })}>{t('افتح التصميم عشان تحفظها')}</button>}<button type="button" className="underline" onClick={() => { setCompare(rep.design.compare ?? null); setExtraRow(null); setBranch(''); p.setPreset(rep.design.period.preset); }}>{t('رجّع زي ما كان')}</button></div>}
        {!r ? (pv.error ? <Banner tone="error">{errorText(pv.error)}</Banner> : <div className="space-y-3"><SkeletonCard /><SkeletonCard lines={6} /></div>) : <>
          <StatusLine r={r} loading={pv.loading} />
          <LeftOut r={r} />
          <Kpis r={r} view={rep?.design.view.columns} />
          <MiniChart r={r} kind={rep?.design.view.chart ?? 'none'} view={rep?.design.view.columns} />
          {r.rows.length > 0 && (r.root.children.length ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-xs">{r.rows.length > 1 && <><Button size="sm" variant="ghost" onClick={() => setExpanded(initialExpanded(r, 9))} data-fb="grid:expand-all">{t('افتح الكل')}</Button><Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())} data-fb="grid:collapse-all">{t('اقفل الكل')}</Button></>}<span className="flex-1" /><span className="text-dim">{t('دوس على سطر يفتح اللي تحته — وعلى أي رقم يوريك الشيكات اللي وراه')}</span></div>
              <PivotGrid result={r} view={rep?.design.view.columns} expanded={expanded} onToggle={(nid) => setExpanded((s) => { const n = new Set(s); n.has(nid) ? n.delete(nid) : n.add(nid); return n; })} height={620} />
            </div>
          ) : <EmptyState compact title={t('مفيش سطور')} text={EMPTY_TEXT()} />)}
          <button type="button" onClick={() => setDefs(!defs)} className="flex items-center gap-1.5 text-sm text-soft hover:text-[var(--primary)]" aria-expanded={defs} data-fb="report:definitions"><BookOpen className="w-4 h-4" />{t('إزاي اتحسبت الأرقام دي؟')}<ChevronDown className={cn('w-4 h-4 transition-transform', defs && 'rotate-180')} /></button>
          {defs && <DefinitionsList r={r} />}
        </>}
        {expert && rep && <ExpertReview reportId={id} reportTitle={rep.name} checklist={CORE_CHECKLIST.map((c) => ({ id: c, ...checklistItem(c) })).filter((x) => x.question)} />}
      </div>
      </AskDock>
      <EvidencePopup spec={ev} onClose={() => setEv(null)} />
      {print && r && rep && <PrintStudio source={{ kind: 'pivot', result: r, title: rep.name, view: rep.design.view.columns, chart: rep.design.view.chart, savedId: changed ? null : id, spec, templateId: rep.templateId }} onClose={() => setPrint(false)} />}
      {sched && <ScheduleDialog certified={(list.data?.items ?? []).filter((x: any) => x.certified)} prefill={{ kind: 'saved', id }} onClose={() => setSched(false)} onDone={() => toast('success', t('اتجدول'), t('هتلاقيه في «بتتبعت لوحدها»'), auth.label)} />}
      {rep && <HistoryPopup id={id} open={hist} onClose={() => setHist(false)} current={rep.design} onRestored={() => sq.refetch()} />}
    </EvidenceCtx.Provider>
  );
}
const checklistItem = (id: string) => (CHECKLIST as any)[id] ?? {};

// ─────────────────────────── templates tab
function TemplatesPanel() {
  const { auth } = useDev();
  const tq = useQuery<any>('ReportTemplate.Find');
  const [src, setSrc] = useState<PrintSource | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const preview = async (tplId: string) => {
    setLoading(tplId);
    try { const r = (await call<any>(auth, 'Report.Pivot', { query: { savedReportId: 'sr_branch_channel' } })).data; setSrc({ kind: 'pivot', result: r, title: r.saved?.name ?? t('تقرير تجريبي'), view: r.saved?.design?.view?.columns, chart: 'bars', savedId: 'sr_branch_channel', templateId: tplId }); } catch (e) { toast('error', errorText(e)); } finally { setLoading(null); }
  };
  const items: any[] = tq.data?.items ?? [];
  return (
    <div className="space-y-3" data-fb="templates-panel">
      <div className="flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-[var(--primary)]" /><div className="min-w-0 flex-1"><div className="font-bold">{t('قوالب الطباعة')}<StateBadge ops={['ReportTemplate.Find', 'ReportTemplate.Save']} /></div><div className="text-xs text-dim">{t('شكل الورقة اللي التقرير بيطلع عليها: A4 أو إيصال، اللوجو، التوقيعات، علامة «مبدئي». أي قالب ينفع مع أي تقرير.')}</div></div></div>
      {tq.loading && !items.length ? <SkeletonCard /> : (
        <div className="grid @3xl/main:grid-cols-2 @6xl/main:grid-cols-3 gap-3">
          {items.map((x) => (
            <Card key={x.id} className="flex flex-col gap-2" data-fb={`template-card:${x.id}`}>
              <div className="flex items-start gap-3">
                <div className={cn('shrink-0 rounded-lg border border-[var(--glass-border)] bg-white/90 flex items-center justify-center', x.paper === 'RECEIPT_80' ? 'w-9 h-14' : x.orientation === 'landscape' ? 'w-16 h-11' : 'w-11 h-14')}><FileText className="w-4 h-4 text-slate-500" /></div>
                <div className="min-w-0"><div className="font-bold">{L(x.name)}</div><div className="text-xs text-soft line-clamp-2">{L(x.description)}</div></div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Pill size="sm" tone="neutral">{x.paper === 'RECEIPT_80' ? t('إيصال 80مم') : x.orientation === 'landscape' ? t('A4 عرضي') : t('A4 طولي')}</Pill>
                {x.footer?.signatures?.length ? <Pill size="sm" tone="neutral">{t('توقيعات')}</Pill> : null}
                {x.watermark?.provisional && <Pill size="sm" tone="neutral">{t('علامة «مبدئي»')}</Pill>}
                {x.builtIn ? <Pill size="sm" tone="info">{t('جاهز')}</Pill> : <Pill size="sm" tone="violet">{t('بتاعي')}</Pill>}
              </div>
              <div className="flex items-center gap-2 mt-auto pt-1">
                <span className="text-[11px] text-dim">{t('نسخة {v}', { v: x.version })} · {dateTime(x.updatedAt)}</span><span className="flex-1" />
                <Button size="sm" variant="outline" loading={loading === x.id} onClick={() => preview(x.id)} data-fb={`template-open:${x.id}`}><Printer className="w-4 h-4" />{t('عاين وعدّل')}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {src && <PrintStudio source={src} onClose={() => { setSrc(null); tq.refetch(); }} />}
    </div>
  );
}

// ─────────────────────────── activity (audit) tab
function ActivityPanel() {
  const q = useQuery<any>('ReportAudit.Find');
  const branches = useQuery<any>('Branch.List');
  const bname = (ids?: string[]) => (ids ?? []).map((id) => (branches.data?.items ?? []).find((b: any) => b.id === id)?.name ?? id).join('، ');
  const [f, setF] = useState<'all' | 'RUN' | 'EXPORT' | 'EDIT' | 'SCHEDULE_RUN'>('all');
  const items: any[] = q.data?.items ?? [];
  const edits = ['SAVE', 'CREATE', 'DUPLICATE', 'SHARE', 'DELETE', 'TEMPLATE_SAVE', 'RESTORE'];
  const shown = items.filter((a) => f === 'all' || (f === 'EDIT' ? edits.includes(a.action) : a.action === f));
  return (
    <div className="space-y-3" data-fb="activity-panel">
      <div className="flex items-center gap-2 flex-wrap"><Activity className="w-4 h-4 text-[var(--primary)]" /><div className="min-w-0 flex-1"><div className="font-bold">{t('مين فتح ونزّل وعدّل إيه')}<StateBadge ops={['ReportAudit.Find']} /></div><div className="text-xs text-dim">{q.data?.scope === 'MINE' ? t('بتشوف حركاتك انت بس.') : t('كل حركات التقارير في المطعم: الفترة والفروع وعدد السطور.')}</div></div>
        <FilterChips value={f} onChange={setF} options={[{ id: 'all', label: t('الكل'), count: items.length }, { id: 'RUN', label: t('فتح') }, { id: 'EXPORT', label: t('تنزيل') }, { id: 'EDIT', label: t('تعديل') }, { id: 'SCHEDULE_RUN', label: t('إرسال') }]} />
      </div>
      <Table dense loading={q.loading && !q.data} head={[t('إمتى'), t('مين'), t('عمل إيه'), t('التقرير'), t('الفترة والفرع'), t('السطور')]} align={['start', 'start', 'start', 'start', 'start', 'end']}
        empty={<EmptyState compact icon={<Activity className="w-5 h-5" />} title={t('لسه مفيش حركة')} text={t('افتح أي تقرير أو نزّله وهيظهر هنا.')} />}
        rows={shown.map((a) => [
          <span className="num text-xs whitespace-nowrap">{dateTime(a.at)}</span>,
          <span className="text-sm">{a.userName || t('السيستم')}</span>,
          <span className="text-sm">{actionText(a.action)}{a.format ? <Pill size="sm" tone="neutral" className="ms-1">{a.format === 'XLSX' ? t('إكسل') : a.format}</Pill> : null}</span>,
          <span className="text-sm truncate">{a.targetName}{a.targetKind === 'CERTIFIED' && <ShieldCheck className="w-3 h-3 inline ms-1 text-[var(--success)]" />}</span>,
          <span className="text-xs">{a.params?.from ? rangeText(a.params.from, a.params.to ?? a.params.from, lang()) : '—'}{a.params?.branchIds?.length ? <span className="block text-[11px] text-dim truncate">{bname(a.params.branchIds)}</span> : null}</span>,
          <span className="num text-xs">{a.rows ?? '—'}</span>,
        ])} />
    </div>
  );
}
