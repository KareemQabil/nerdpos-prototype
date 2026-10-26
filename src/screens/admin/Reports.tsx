// H1 Daily operator reports: Report.List (only allowed reports), Report.Run by business date, accountant CSV export.
import { saveFile } from '../../lib/files';
import React, { useEffect, useMemo, useState } from 'react';
import { FileBarChart, RefreshCw, Download, AlertTriangle, Info } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { Section, StateBadge, Banner, Button, Pill, Card, Field, Input, Spinner, Empty, toast } from '../../ui';
import { t, L } from '../../i18n';
import { money, dateTime, cn } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';
import { metricLabel, isMetricId, SECTION_COLUMNS, codeLabel } from './output/labels';
import { SalesOverview, ExportButtons, Schedules } from '../ops/ReportExtras';
import { Tech } from '../../app/tech';

const MONEY_RE = /^-?\d+\.\d{4}$/;
const NA = 'CAPABILITY_NOT_AVAILABLE';

function Cell({ v }: { v: unknown }) {
  if (v === NA) return <Pill tone="neutral" title={NA}>{t('مش متاح')}</Pill>;
  if (v === null || v === undefined || v === '') return <span className="text-dim">—</span>;
  if (typeof v === 'number') return <span className="num">{v}</span>;
  const s = String(v);
  if (MONEY_RE.test(s)) return <span className={cn('num font-bold', s.startsWith('-') && 'text-[var(--error)]')}>{money(s)}</span>;
  if (isMetricId(s)) return <span>{metricLabel(s)}</span>;
  if (/^[A-Z][A-Z_:]+$/.test(s)) return <span title={s}>{codeLabel(s)}</span>;
  return <span>{s}</span>;
}

function ReportSection({ s }: { s: any }) {
  const rows: unknown[][] = s.rows ?? [];
  const width = Math.max(s.columns?.length ?? 0, ...rows.map((r) => r.length), 0);
  const cols: string[] = s.columns ?? SECTION_COLUMNS[s.id] ?? Array.from({ length: width }, (_, i) => String(i + 1));
  const isSummary = !s.columns && rows.length > 0 && rows.every((r) => r.length === 2 && isMetricId(r[0]));
  return (
    <Card title={<span>{L(s.title)} <Tech><span className="num text-[11px] text-dim font-normal">{s.id}</span></Tech></span>} className="min-w-0">
      {rows.length === 0 ? <div className="text-sm text-dim py-2">{t('مفيش بيانات في الفترة دي')}</div> : isSummary ? (
        <div className="grid sm:grid-cols-2 gap-2">
          {rows.map((r, i) => (
            <div key={i} className={cn('rounded-xl surface-1 px-3 py-2 flex items-center justify-between gap-2', r[0] === 'net_sales' && 'border border-[var(--primary)]', r[0] === 'service_charge' && 'border border-[var(--info)]')} data-metric={String(r[0])}>
              <span className="text-sm text-soft">{metricLabel(String(r[0]))}</span>
              <span className="text-base"><Cell v={r[1]} /></span>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border line">
          <table className="w-full text-sm">
            <thead className="surface-1"><tr>{cols.map((c, i) => <th key={i} className="text-start font-bold text-xs text-soft px-3 py-2 whitespace-nowrap" title={c}>{metricLabel(c)}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t line">{Array.from({ length: Math.max(cols.length, r.length) }, (_, j) => <td key={j} className="px-3 py-2"><Cell v={r[j]} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Reports() {
  const { auth } = useDev();
  const today = businessDate(clock.now());
  const list = useQuery<any>('Report.List');
  const reports: any[] = list.data?.items ?? [];
  const [reportId, setReportId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { if (!reportId && reports[0]) setReportId(reports[0].id); }, [reports, reportId]);
  const def = useMemo(() => reports.find((r) => r.id === reportId), [reports, reportId]);
  const isRange = def?.period === 'RANGE';
  const run = useQuery<any>(reportId ? 'Report.Run' : null, { params: { reportId }, query: { fromBusinessDate: from, toBusinessDate: isRange ? to : undefined } });
  const r = run.data;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await call<any>(auth, 'Report.AccountantExport', { query: { fromBusinessDate: from, toBusinessDate: isRange ? to : from } });
      const ok = await saveFile(res.data.filename ?? 'nerdpos-export.csv', '﻿' + res.data.csv, 'text/csv;charset=utf-8');
      if (ok) toast('success', t('ملف المحاسب اتنزل'), res.data.filename, auth.label);
    } catch (e) {
      toast('error', errorText(e), (e as any).code, auth.label);
    } finally { setExporting(false); }
  };

  return (
    <div className="space-y-4" data-screen-id="H1">
      <Section title={t('التقارير')} badge={<StateBadge ops={['Report.List', 'Report.Run', 'Report.Trend', 'Report.Export', 'Report.Schedule']} />}
        sub={t('تقارير اليوم التجاري (من 04:00 لـ 04:00 بتوقيت القاهرة) — قراءة بس، عمرها ما بتغير حاجة. التقارير اللي بتظهر هي اللي صلاحيتك بتسمح بيها.')}
        actions={<>
          <Button size="sm" variant="outline" loading={exporting} onClick={exportCsv} data-fb="reports:accountant-export"><Download className="w-4 h-4" />{t('ملف المحاسب (CSV)')} <StateBadge state="PROPOSED" /></Button>
          <Button size="sm" variant="ghost" onClick={() => run.refetch()} data-fb="reports:refresh"><RefreshCw className="w-4 h-4" />{t('تحديث')}</Button>
        </>} />

      <SalesOverview />

      <Card>
        {list.loading && !list.data ? <Spinner /> : reports.length === 0 ? <Empty text={t('مفيش تقارير مسموحة للمستخدم ده')} /> : (
          <div className="space-y-3">
            <div className="flex gap-1.5 flex-wrap">
              {reports.map((x) => (
                <button key={x.id} data-fb={`reports:pick:${x.id}`} onClick={() => setReportId(x.id)} className={cn('px-3 h-9 rounded-lg text-sm border transition-colors', reportId === x.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-bold border-transparent' : 'surface-1 border-[var(--glass-border)] hover:surface-2')}>
                  {L(x.title)} <span className="text-[10px] opacity-70">{x.period === 'RANGE' ? t('فترة') : t('يوم')}</span>
                </button>
              ))}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <Field label={isRange ? t('من يوم تجاري') : t('اليوم التجاري')} className="w-48"><Input data-fb="reports:from" type="date" value={from} max={today} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
              {isRange && <Field label={t('لحد يوم تجاري')} className="w-48" hint={t('أقصى فترة 93 يوم')}><Input data-fb="reports:to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>}
              <Button size="sm" variant="ghost" onClick={() => { setFrom(today); setTo(today); }} data-fb="reports:today">{t('النهارده')} <span className="num">{today}</span></Button>
              <span className="text-xs text-dim pb-2">{t('الفرع: فرع الجهاز ده')}</span>
            </div>
          </div>
        )}
      </Card>

      {run.error && <Banner tone="error">{errorText(run.error)} <Tech><span className="num text-xs">({run.error.code})</span></Tech></Banner>}
      {run.loading && !r && <Spinner />}
      {r && (
        <div className="space-y-3" data-fb="reports:result">
          <div className="flex items-center gap-2 flex-wrap">
            <FileBarChart className="w-5 h-5 text-[var(--primary)]" />
            <h2 className="text-xl font-bold">{L(r.title)}</h2>
            <Pill tone="neutral"><span className="num">{r.period.from}{r.period.to !== r.period.from ? ` → ${r.period.to}` : ''}</span></Pill>
            {r.provisional ? <Pill tone="warning" title="provisional">{t('مبدئي — اليوم لسه ما خلصش أو فيه وردية مفتوحة')}</Pill> : <Pill tone="success">{t('نهائي للفترة')}</Pill>}
            <span className="text-xs text-dim">{t('لحد')} {dateTime(r.asOf)}</span>
            <span className="flex-1" />
            <ExportButtons reportId={reportId} from={from} to={isRange ? to : from} />
          </div>
          {r.provisional && <Banner tone="warning"><span className="flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('الأرقام ممكن تتغير: فيه وردية مفتوحة أو اليوم التجاري لسه ما انتهاش بتوقيت الفرع. تقرير Z بتاع الوردية هو المرجع.')}</span></Banner>}
          {r.note && <Banner tone="info"><span className="flex items-center gap-1"><Info className="w-4 h-4" />{L(r.note)}</span></Banner>}
          <div className="grid xl:grid-cols-2 gap-3">
            {(r.sections ?? []).map((s: any) => <ReportSection key={s.id} s={s} />)}
          </div>
          <div className="text-[11px] text-dim">{t('الخدمة مقياس لوحده ومش جوه صافي المبيعات. وسائل الدفع عمرها ما بتتسمى مبيعات. المرتجعات بتتحسب يوم صرفها. أي مقياس مش متاح بيظهر "مش متاح" مش صفر.')}</div>
        </div>
      )}
      {reports.length > 0 && <Schedules reports={reports} />}
    </div>
  );
}
