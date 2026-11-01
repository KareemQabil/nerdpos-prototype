// H1 Reports: certified report manifests run by the layered engine (src/reports/**) — header with business date,
// timezone, asOf, provisional/closed, definitions + versions and reconciliation; every number opens its evidence;
// branded A4 / receipt templates; CSV / Excel export; schedules; expert review; the assistant one click away.
// The 8 legacy operator reports (doc 27) keep running for Home and the journeys, shown as «عرض سريع».
import React, { useEffect, useMemo, useState } from 'react';
import { FileBarChart, RefreshCw, Layers, MessageCircleQuestion, Star, History, Download } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { PageHeader, StateBadge, Banner, Button, Pill, Card, Field, Input, Spinner, Empty, toast, Tabs, Select } from '../../ui';
import { t, L } from '../../i18n';
import { money, cn } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';
import { saveFile } from '../../lib/files';
import { metricLabel, isMetricId, SECTION_COLUMNS, codeLabel } from './output/labels';
import { SalesOverview, ExportButtons, Schedules } from '../ops/ReportExtras';
import { Tech } from '../../app/tech';
import { ReportView } from '../reports/ReportView';
import { EvidenceDrawer } from '../reports/EvidenceDrawer';
import { TemplatePreview } from '../reports/Templates';
import { AskFab } from '../reports/Assistant';
import { EvidenceCtx, type EvidenceSpec } from '../reports/parts';

const FAMILY: Record<string, string> = { sales: 'المبيعات', payments: 'الفلوس والدرج', service: 'الصالة والشيكات', controls: 'الرقابة والإلغاءات', menu: 'المنيو والأصناف', channels: 'القنوات', inventory: 'المخزن', purchasing: 'المشتريات', fiscal: 'الضرايب', kitchen: 'المطبخ', multi_branch: 'الفروع' };
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const MONEY_RE = /^-?\d+\.\d{4}$/;

function LegacyCell({ v }: { v: unknown }) {
  if (v === 'CAPABILITY_NOT_AVAILABLE') return <Pill tone="neutral">{t('مش متاح')}</Pill>;
  if (v === null || v === undefined || v === '') return <span className="text-dim">—</span>;
  if (typeof v === 'number') return <span className="num">{v}</span>;
  const s = String(v);
  if (MONEY_RE.test(s)) return <span className="num font-bold">{money(s)}</span>;
  if (isMetricId(s)) return <span>{metricLabel(s)}</span>;
  if (/^[A-Z][A-Z_:]+$/.test(s)) return <span title={s}>{codeLabel(s)}</span>;
  return <span>{s}</span>;
}
function LegacyReport({ r }: { r: any }) {
  return (
    <div className="space-y-3">
      <Banner tone="info">{t('ده عرض سريع من تقارير التشغيل القديمة (بيستخدمه الرئيسية). النسخة المعتمدة اللي كل رقم فيها بيتثبت موجودة في «التقارير المعتمدة».')}</Banner>
      <div className="grid xl:grid-cols-2 gap-3">
        {(r.sections ?? []).map((s: any) => {
          const rows: unknown[][] = s.rows ?? [];
          const cols: string[] = s.columns ?? SECTION_COLUMNS[s.id] ?? Array.from({ length: Math.max(0, ...rows.map((x) => x.length)) }, (_, i) => String(i + 1));
          return (
            <Card key={s.id} title={L(s.title)}>
              {rows.length === 0 ? <div className="text-sm text-dim">{t('مفيش بيانات في الفترة دي')}</div> : (
                <div className="overflow-x-auto rounded-xl border line"><table className="w-full text-sm"><thead className="surface-1"><tr>{cols.map((c, i) => <th key={i} className="text-start text-xs text-soft px-3 py-2">{metricLabel(c)}</th>)}</tr></thead>
                  <tbody>{rows.map((x, i) => <tr key={i} className="border-t line">{cols.map((_, j) => <td key={j} className="px-3 py-1.5"><LegacyCell v={x[j]} /></td>)}</tr>)}</tbody></table></div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function Reports() {
  const { auth, nav, params } = useDev();
  const today = businessDate(clock.now());
  const list = useQuery<any>('Report.List');
  const branches = useQuery<any>('Branch.List');
  const reports: any[] = list.data?.items ?? [];
  const certified = reports.filter((r) => r.certified);
  const legacy = reports.filter((r) => !r.certified);
  const [tab, setTab] = useState<'certified' | 'overview' | 'legacy' | 'schedules'>('certified');
  const [reportId, setReportId] = useState<string>(params?.reportId ?? '');
  const [from, setFrom] = useState(addDays(today, -1));
  const [to, setTo] = useState(addDays(today, -1));
  const [branch, setBranch] = useState<string>('');
  const [ev, setEv] = useState<EvidenceSpec | null>(null);
  const [tpl, setTpl] = useState(false);
  const [exporting, setExporting] = useState(false);
  const def = useMemo(() => reports.find((r) => r.id === reportId), [reports, reportId]);
  const pick = (r: any) => {
    setReportId(r.id);
    const p = r.defaultPeriod ?? (r.period === 'DAY' ? 'TODAY' : 'TODAY');
    if (p === 'YESTERDAY') { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); } else if (p === 'LAST_7') { setFrom(addDays(today, -6)); setTo(today); } else { setFrom(today); setTo(today); }
  };
  useEffect(() => { if (!reportId && certified[0]) pick(certified.find((r) => r.id === 'eod_bridge') ?? certified[0]); }, [certified.length]);
  useEffect(() => { if (def && !def.certified) setTab('legacy'); }, [def?.id]);
  const isRange = def?.period === 'RANGE';
  const branchIds = branch === '*' ? (branches.data?.items ?? []).map((b: any) => b.id).join(',') : branch || undefined;
  const run = useQuery<any>(reportId ? 'Report.Run' : null, { params: { reportId }, query: { fromBusinessDate: from, toBusinessDate: isRange ? to : undefined, branchIds } });
  const r = run.data;
  const families = useMemo(() => { const m = new Map<string, any[]>(); for (const x of certified) m.set(x.family, [...(m.get(x.family) ?? []), x]); return [...m.entries()]; }, [certified]);
  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await call<any>(auth, 'Report.AccountantExport', { query: { fromBusinessDate: from, toBusinessDate: isRange ? to : from } });
      if (await saveFile(res.data.filename ?? 'nerdpos-export.csv', '﻿' + res.data.csv, 'text/csv;charset=utf-8')) toast('success', t('ملف المحاسب اتنزل'), res.data.filename, auth.label);
    } catch (e) { toast('error', errorText(e), (e as any).code, auth.label); } finally { setExporting(false); }
  };

  return (
    <EvidenceCtx.Provider value={setEv}>
      <div className="space-y-4 pb-16" data-screen-id="H1">
        <PageHeader title={t('التقارير')} icon={<FileBarChart className="w-5 h-5" />} badge={<StateBadge ops={['Report.List', 'Report.Run', 'Report.Explain', 'Report.Export', 'Report.Schedule']} />}
          description={t('تقارير معتمدة من محرك واحد: كل رقم بيفتح الشيكات اللي وراه، وكل تقرير بيقول اليوم التجاري ولحد إمتى ومبدئي ولا نهائي والمطابقة. قراءة بس — عمرها ما بتغير حاجة.')}
          actions={<>
            <Button size="sm" variant="outline" onClick={() => nav('report-catalog')} data-fb="reports:engine"><Layers className="w-4 h-4" />{t('محرك التقارير')}</Button>
            <Button size="sm" variant="outline" onClick={() => nav('report-assistant')} data-fb="reports:ask"><MessageCircleQuestion className="w-4 h-4" />{t('اسأل التقارير')}</Button>
            <Button size="sm" variant="ghost" onClick={() => run.refetch()} data-fb="reports:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>
          </>} />
        <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'certified', label: t('التقارير المعتمدة'), count: certified.length, fb: 'reports-tab:certified' }, { id: 'overview', label: t('نظرة سريعة'), fb: 'reports-tab:overview' }, { id: 'legacy', label: t('عرض سريع (التقارير القديمة)'), count: legacy.length, fb: 'reports-tab:legacy' }, { id: 'schedules', label: t('بتتبعت لوحدها'), fb: 'reports-tab:schedules' }]} />
        {tab === 'overview' && <SalesOverview />}
        {tab === 'schedules' && reports.length > 0 && <Schedules reports={reports} />}
        {(tab === 'certified' || tab === 'legacy') && (
          <Card padding="sm">
            {list.loading && !list.data ? <Spinner /> : reports.length === 0 ? <Empty text={t('مفيش تقارير مسموحة للمستخدم ده')} /> : (
              <div className="space-y-2">
                {tab === 'certified' ? <div className="grid @5xl/main:grid-cols-2 gap-x-6 gap-y-1.5">{families.map(([f, xs]) => (
                  <div key={f} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-dim w-24 shrink-0">{t(FAMILY[f] ?? f)}</span>
                    {xs.map((x) => <button key={x.id} data-fb={`reports:pick:${x.id}`} onClick={() => pick(x)} title={L(x.purpose)} className={cn('px-2.5 h-7 rounded-lg text-[13px] border transition-colors inline-flex items-center gap-1', reportId === x.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold border-transparent' : 'surface-1 border-[var(--glass-border)] hover:surface-2')}>{x.pilot && <Star className="w-3 h-3 opacity-70" />}{L(x.title)}</button>)}
                  </div>
                ))}</div> : (
                  <div className="flex items-center gap-1.5 flex-wrap"><History className="w-4 h-4 text-dim" />{legacy.map((x) => <button key={x.id} data-fb={`reports:pick:${x.id}`} onClick={() => pick(x)} className={cn('px-3 h-8 rounded-lg text-sm border', reportId === x.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold border-transparent' : 'surface-1 border-[var(--glass-border)]')}>{L(x.title)}</button>)}</div>
                )}
                <div className="flex items-end gap-3 flex-wrap pt-1 border-t line">
                  <Field label={isRange ? t('من يوم تجاري') : t('اليوم التجاري')} className="w-44"><Input data-fb="reports:from" type="date" value={from} max={today} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
                  {isRange && <Field label={t('لحد يوم تجاري')} className="w-44" hint={t('أقصى فترة 93 يوم')}><Input data-fb="reports:to" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>}
                  <div className="flex gap-1 pb-0.5">
                    <Button size="sm" variant="ghost" onClick={() => { setFrom(today); setTo(today); }} data-fb="reports:today">{t('النهارده')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }} data-fb="reports:yesterday">{t('امبارح')}</Button>
                    {isRange && <Button size="sm" variant="ghost" onClick={() => { setFrom(addDays(today, -6)); setTo(today); }} data-fb="reports:last7">{t('آخر 7 أيام')}</Button>}
                  </div>
                  <Field label={t('الفرع')} className="w-56"><Select data-fb="reports:branch" value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: '', label: t('فرع الجهاز') }, ...((branches.data?.items ?? []) as any[]).map((b) => ({ value: b.id, label: b.name })), { value: '*', label: t('كل الفروع المسموحة') }]} /></Field>
                  <span className="flex-1" />
                  {r && <ExportButtons reportId={reportId} from={from} to={isRange ? to : from} />}
                  <Button size="sm" variant="ghost" loading={exporting} onClick={exportCsv} data-fb="reports:accountant-export" title={t('ملف المحاسب (CSV)')}><Download className="w-4 h-4" />{t('ملف المحاسب')}</Button>
                </div>
              </div>
            )}
          </Card>
        )}
        {(tab === 'certified' || tab === 'legacy') && <>
          {run.error && <Banner tone="error">{errorText(run.error)} <Tech><span className="num text-xs">({(run.error as any).code})</span></Tech></Banner>}
          {run.loading && !r && <Spinner />}
          {r && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold">{L(r.title)}</h2>{r.certified ? <Pill tone="success" size="sm">{t('تقرير معتمد من المحرك')}</Pill> : <Pill tone="neutral" size="sm">{t('عرض سريع')}</Pill>}<Tech><span className="num text-[11px] text-dim">{r.reportId} v{r.manifest?.version}</span></Tech></div>
              {r.certified ? <ReportView run={r} onTemplate={() => setTpl(true)} /> : <LegacyReport r={r} />}
            </div>
          )}
        </>}
      </div>
      <EvidenceDrawer spec={ev} onClose={() => setEv(null)} />
      {tpl && r?.certified && <TemplatePreview run={r} onClose={() => setTpl(false)} />}
      <AskFab />
    </EvidenceCtx.Provider>
  );
}
