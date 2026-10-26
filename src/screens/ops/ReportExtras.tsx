// Reports extras: KPI cards with yesterday / last-week comparisons, plain-SVG charts (14 days, hours of the day,
// payment mix, top items), export of any report to CSV / Excel (Report.Export) and scheduled reports (Report.Schedule).
import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Receipt, Users, Wallet, Download, CalendarClock, Plus, Pause, Play, Trash2, Send, FileSpreadsheet, FileText } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { Card, Button, Pill, Modal, Field, Input, Select, Tabs, Table, Empty, StateBadge, Banner, toast, Money } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, money, dateTime } from '../../lib/format';
import { saveFile } from '../../lib/files';
import { metricLabel, isMetricId, SECTION_COLUMNS, codeLabel } from '../admin/output/labels';
import { METHOD_AR } from './BusinessDay';

const dayShort = (iso: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'short', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
const dayNum = (iso: string) => String(Number(iso.slice(8, 10)));
const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <span className="text-[11px] text-dim">{label}: —</span>;
  const p = ((now - before) / before) * 100;
  const up = p > 0.5, down = p < -0.5;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return <span className={cn('text-[11px] inline-flex items-center gap-0.5', up ? 'text-[var(--success)]' : down ? 'text-[var(--error)]' : 'text-dim')}><Icon className="w-3 h-3" />{label} <span className="num">{p > 0 ? '+' : ''}{p.toFixed(0)}%</span></span>;
}

/** KPI cards and charts from the daily trend (live days + the days before the demo started). */
export function SalesOverview() {
  const q = useQuery<any>('Report.Trend', { query: { days: 15 } });
  const items: any[] = q.data?.items ?? [];
  const [hover, setHover] = useState<number | null>(null);
  if (!items.length) return null;
  const today = items[items.length - 1], yday = items[items.length - 2], lastWeek = items[items.length - 8];
  const last14 = items.slice(-14);
  const max = Math.max(1, ...last14.map((x) => n(x.netSales)));
  const avgHour = Array.from({ length: 24 }, (_, h) => items.slice(-8, -1).reduce((a, x) => a + n(x.byHour?.[h]), 0) / 7);
  const hourSrc = n(today.netSales) > 0 ? today : yday;
  const hMax = Math.max(1, ...hourSrc.byHour, ...avgHour);
  const methods = Object.entries(hourSrc.byMethod ?? {}) as [string, string][];
  const mTotal = methods.reduce((a, [, v]) => a + n(v), 0) || 1;
  const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];
  const top = (hourSrc.topItems ?? []).slice(0, 6);
  const topMax = Math.max(1, ...top.map((x: any) => n(x.amount)));
  const kpi = (icon: React.ReactNode, label: string, value: string, a: number, b: number, c: number) => (
    <div className="glass rounded-xl p-4" data-fb="report-kpi">
      <div className="text-xs text-dim flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-2xl font-extrabold num mt-1">{value}</div>
      <div className="flex gap-3 mt-1"><Delta now={a} before={b} label={t('عن امبارح')} /><Delta now={a} before={c} label={t('عن نفس اليوم الأسبوع اللي فات')} /></div>
    </div>
  );
  const avg = (x: any) => (x?.orders ? n(x.netSales) / x.orders : 0);
  return (
    <div className="space-y-3" data-fb="reports:overview">
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {kpi(<TrendingUp className="w-3.5 h-3.5" />, t('صافي مبيعات النهارده'), `${fmt(n(today.netSales))} ${t('جنيه')}`, n(today.netSales), n(yday?.netSales), n(lastWeek?.netSales))}
        {kpi(<Receipt className="w-3.5 h-3.5" />, t('عدد الشيكات'), String(today.orders), today.orders, yday?.orders ?? 0, lastWeek?.orders ?? 0)}
        {kpi(<Wallet className="w-3.5 h-3.5" />, t('متوسط الشيك'), `${fmt(avg(today))} ${t('جنيه')}`, avg(today), avg(yday), avg(lastWeek))}
        {kpi(<Users className="w-3.5 h-3.5" />, t('الضيوف'), String(today.guests), today.guests, yday?.guests ?? 0, lastWeek?.guests ?? 0)}
      </div>
      <div className="grid xl:grid-cols-[1.4fr_1fr] gap-3">
        <Card title={t('المبيعات آخر 14 يوم')}>
          <div className="relative">
            <svg viewBox="0 0 700 220" className="w-full h-56" role="img" aria-label={t('المبيعات آخر 14 يوم')}>
              {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2="700" y1={190 - g * 170} y2={190 - g * 170} stroke="currentColor" strokeOpacity="0.08" />)}
              {last14.map((x, i) => {
                const h = (n(x.netSales) / max) * 170;
                const isToday = i === last14.length - 1;
                const wknd = [4, 5].includes(new Date(x.businessDate + 'T12:00:00Z').getUTCDay());
                return (
                  <g key={x.businessDate} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <rect x={i * 50 + 8} y={190 - h} width="34" height={Math.max(h, 1)} rx="6" fill={isToday ? 'url(#gToday)' : wknd ? '#a78bfa' : '#22d3ee'} fillOpacity={hover === null || hover === i ? 0.9 : 0.45} />
                    <text x={i * 50 + 25} y="208" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">{dayNum(x.businessDate)}</text>
                  </g>
                );
              })}
              <defs><linearGradient id="gToday" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f472b6" /><stop offset="1" stopColor="#fb7185" /></linearGradient></defs>
            </svg>
            {hover !== null && last14[hover] && <div className="absolute top-0 start-2 rounded-lg glass-strong px-3 py-1.5 text-xs pointer-events-none"><b>{dayShort(last14[hover].businessDate)} {last14[hover].businessDate}</b><div><span className="num">{fmt(n(last14[hover].netSales))}</span> {t('جنيه')} · <span className="num">{last14[hover].orders}</span> {t('شيك')}</div>{last14[hover].source === 'HISTORY' && <div className="text-dim">{t('من بيانات الأيام اللي فاتت')}</div>}</div>}
          </div>
          <div className="flex gap-3 text-[11px] text-dim"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-cyan-400" />{t('أيام عادية')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-violet-400" />{t('الخميس والجمعة')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-pink-400" />{t('النهارده')}</span></div>
        </Card>
        <Card title={<span>{t('المبيعات حسب الساعة')} <span className="text-xs text-dim font-normal">({hourSrc === today ? t('النهارده') : t('امبارح')} {t('مقابل متوسط الأسبوع')})</span></span>}>
          <svg viewBox="0 0 480 200" className="w-full h-52">
            {Array.from({ length: 24 }, (_, h) => { const v = n(hourSrc.byHour[h]); const hh = (v / hMax) * 160; return <rect key={h} x={h * 20 + 3} y={170 - hh} width="14" height={Math.max(hh, 0.5)} rx="3" fill="#22d3ee" fillOpacity="0.85"><title>{`${h}:00 — ${fmt(v)}`}</title></rect>; })}
            <polyline fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="4 3" points={avgHour.map((v, h) => `${h * 20 + 10},${170 - (v / hMax) * 160}`).join(' ')} />
            {[0, 6, 12, 18, 23].map((h) => <text key={h} x={h * 20 + 10} y="188" textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.6">{h}</text>)}
          </svg>
          <div className="flex gap-3 text-[11px] text-dim"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-cyan-400" />{t('المبيعات')}</span><span className="flex items-center gap-1"><span className="w-4 border-t-2 border-dashed border-amber-400" />{t('متوسط آخر 7 أيام')}</span></div>
        </Card>
      </div>
      <div className="grid xl:grid-cols-2 gap-3">
        <Card title={t('الفلوس دخلت إزاي')}>
          {methods.length === 0 ? <div className="text-sm text-dim">{t('مفيش دفعات لسه')}</div> : (
            <div className="space-y-2">
              <div className="flex h-4 rounded-full overflow-hidden">{methods.map(([k, v], i) => <div key={k} style={{ width: `${(n(v) / mTotal) * 100}%`, background: colors[i % colors.length] }} title={`${t(METHOD_AR[k] ?? k)}: ${money(v)}`} />)}</div>
              <div className="flex flex-wrap gap-3 text-sm">{methods.map(([k, v], i) => <span key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded" style={{ background: colors[i % colors.length] }} />{t(METHOD_AR[k] ?? k)} <span className="num font-bold">{((n(v) / mTotal) * 100).toFixed(0)}%</span> <span className="text-dim text-xs">{money(v)}</span></span>)}</div>
            </div>
          )}
        </Card>
        <Card title={t('أكتر أصناف بتتباع')}>
          {top.length === 0 ? <div className="text-sm text-dim">{t('لسه مفيش مبيعات')}</div> : (
            <div className="space-y-1.5">{top.map((x: any) => (
              <div key={L(x.name)} className="flex items-center gap-2 text-sm">
                <span className="w-28 truncate">{L(x.name)}</span>
                <div className="flex-1 h-3 rounded-full surface-2 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-pink-400 to-violet-500" style={{ width: `${(n(x.amount) / topMax) * 100}%` }} /></div>
                <span className="num text-xs w-12 text-end">{x.qty}×</span><span className="num text-xs w-24 text-end">{money(x.amount)}</span>
              </div>
            ))}</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ───────── export
const cellValue = (v: unknown) => (v === 'CAPABILITY_NOT_AVAILABLE' ? t('مش متاح') : typeof v === 'string' && /^-?\d+\.\d{4}$/.test(v) ? Number(Number(v).toFixed(2)) : typeof v === 'string' && isMetricId(v) ? metricLabel(v) : typeof v === 'string' && /^[A-Z][A-Z_:]+$/.test(v) ? codeLabel(v) : v ?? '');
function sheetRows(s: any): unknown[][] {
  const rows: unknown[][] = s.rows ?? [];
  const width = Math.max(s.columns?.length ?? 0, ...rows.map((r) => r.length), 0);
  const cols: string[] = s.columns ?? SECTION_COLUMNS[s.id] ?? Array.from({ length: width }, (_, i) => String(i + 1));
  return [cols.map((c) => metricLabel(c)), ...rows.map((r) => r.map(cellValue))];
}
export function ExportButtons({ reportId, from, to }: { reportId: string; from: string; to?: string }) {
  const { auth } = useDev();
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (format: 'CSV' | 'XLSX') => {
    setBusy(format);
    try {
      const r = (await call<any>(auth, 'Report.Export', { body: { reportId, fromBusinessDate: from, toBusinessDate: to ?? from, format } })).data;
      let ok = false;
      if (format === 'CSV') {
        const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const lines: string[] = [esc(L(r.title)) + ',' + esc(`${r.period?.from ?? from} → ${r.period?.to ?? to ?? from}`)];
        for (const s of r.sheets) { lines.push('', esc(L(s.title))); for (const row of sheetRows(s)) lines.push(row.map(esc).join(',')); }
        ok = await saveFile(r.filename, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
      } else {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        r.sheets.forEach((s: any, i: number) => { const ws = XLSX.utils.aoa_to_sheet(sheetRows(s)); (ws as any)['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }]; XLSX.utils.book_append_sheet(wb, ws, (L(s.title) || `S${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 30)); });
        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        ok = await saveFile(r.filename, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }
      if (ok) toast('success', t('الملف اتنزل'), r.filename, auth.label);
    } catch (e) { toast('error', errorText(e), (e as any).code, auth.label); } finally { setBusy(null); }
  };
  return (
    <div className="flex gap-1.5" data-fb="reports:export">
      <Button size="sm" variant="outline" loading={busy === 'XLSX'} onClick={() => go('XLSX')} data-fb="reports:export-xlsx"><FileSpreadsheet className="w-4 h-4" />{t('إكسل')}</Button>
      <Button size="sm" variant="outline" loading={busy === 'CSV'} onClick={() => go('CSV')} data-fb="reports:export-csv"><FileText className="w-4 h-4" />CSV</Button>
    </div>
  );
}

// ───────── schedules
const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
const wd = (d: number) => [t('الحد'), t('الاتنين'), t('التلات'), t('الأربع'), t('الخميس'), t('الجمعة'), t('السبت')][d];
export function Schedules({ reports }: { reports: any[] }) {
  const q = useQuery<any>('Report.ScheduleFind');
  const { run, busy } = useCommand();
  const [form, setForm] = useState(false);
  const items: any[] = q.data?.items ?? [];
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4" />{t('تقارير بتتبعت لوحدها')}</span>} badge={<StateBadge ops={['Report.Schedule', 'Report.ScheduleFind', 'Report.ScheduleUpdate']} />}
      actions={<Button size="sm" variant="primary" onClick={() => setForm(true)} data-fb="reports:schedule-new"><Plus className="w-4 h-4" />{t('جدول تقرير')}</Button>}>
      {items.length === 0 ? <Empty text={t('مفيش تقارير متجدولة — مثلاً ابعت مبيعات اليوم للمالك كل يوم الصبح')} /> : (
        <Table head={[t('التقرير'), t('إمتى'), t('لمين'), t('الشكل'), t('المرة الجاية'), t('آخر مرة'), '']} rows={items.map((s) => [
          <span className="font-bold">{L(s.reportTitle)}</span>,
          <span className="text-sm">{s.frequency === 'DAILY' ? t('كل يوم') : t('كل {d}', { d: wd(s.weekday) })} <span className="num">{s.time}</span></span>,
          <div className="flex flex-wrap gap-1">{s.recipients.map((r: string) => <Pill key={r} tone="neutral">{r}</Pill>)}</div>,
          s.format === 'XLSX' ? t('إكسل') : 'CSV',
          s.active ? <span className="num text-xs">{dateTime(s.nextRunAt)}</span> : <Pill tone="neutral">{t('متوقف')}</Pill>,
          s.runs?.[0] ? <span className="text-xs"><Send className="w-3 h-3 inline" /> {dateTime(s.runs[0].at)}</span> : <span className="text-dim">—</span>,
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('Report.ScheduleUpdate', { params: { scheduleId: s.id }, body: { active: !s.active, expectedVersion: s.version } }, { success: s.active ? t('اتوقف') : t('رجع يشتغل') })} title={s.active ? t('وقّف') : t('شغّل')}>{s.active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('Report.ScheduleUpdate', { params: { scheduleId: s.id }, body: { active: false, delete: true, expectedVersion: s.version } }, { success: t('اتمسح') })} title={t('امسح')}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>,
        ])} />
      )}
      {form && <ScheduleDialog reports={reports} onClose={() => setForm(false)} />}
    </Card>
  );
}

function ScheduleDialog({ reports, onClose }: { reports: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const users = useQuery<any>('User.Find', { query: {} });
  const [reportId, setReportId] = useState(reports[0]?.id ?? 'daily_sales');
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('DAILY');
  const [weekday, setWeekday] = useState(6);
  const [time, setTime] = useState('04:30');
  const [format, setFormat] = useState<'XLSX' | 'CSV'>('XLSX');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const people: string[] = (users.data?.items ?? []).filter((u: any) => u.active).map((u: any) => u.displayName);
  const toggle = (r: string) => setRecipients(recipients.includes(r) ? recipients.filter((x) => x !== r) : [...recipients, r]);
  const submit = async () => { const all = [...recipients, ...extra.split(/[،,]/).map((x) => x.trim()).filter(Boolean)]; if (await run('Report.Schedule', { body: { reportId, frequency, weekday: frequency === 'WEEKLY' ? weekday : undefined, time, format, recipients: all } }, { success: t('التقرير اتجدول') })) onClose(); };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><CalendarClock className="w-5 h-5" />{t('جدول تقرير يتبعت لوحده')}</span>} badge={<StateBadge ops={['Report.Schedule']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!recipients.length && !extra.trim()} onClick={submit} data-fb="schedule-submit">{t('جدول')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('التقرير')}><Select value={reportId} onChange={(e) => setReportId(e.target.value)} options={reports.map((r) => ({ value: r.id, label: L(r.title) }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('كل قد إيه')}><Tabs value={frequency} onChange={setFrequency} tabs={[{ id: 'DAILY', label: t('كل يوم') }, { id: 'WEEKLY', label: t('كل أسبوع') }]} /></Field>
          <Field label={t('الساعة (بتوقيت القاهرة)')}><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" /></Field>
        </div>
        {frequency === 'WEEKLY' && <Field label={t('يوم')}><div className="flex flex-wrap gap-1">{WEEKDAYS.map((d) => <button key={d} onClick={() => setWeekday(d)} className={cn('px-3 h-9 rounded-lg border text-sm', weekday === d ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1')}>{wd(d)}</button>)}</div></Field>}
        <Field label={t('الشكل')}><Tabs value={format} onChange={setFormat} tabs={[{ id: 'XLSX', label: t('إكسل') }, { id: 'CSV', label: 'CSV' }]} /></Field>
        <Field label={t('يتبعت لمين')}><div className="flex flex-wrap gap-1.5">{people.map((p) => <button key={p} onClick={() => toggle(p)} className={cn('px-2.5 h-8 rounded-lg border text-xs', recipients.includes(p) ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1')} data-fb={`schedule-to:${p}`}>{p}</button>)}</div></Field>
        <Field label={t('حد تاني (اكتب الاسم)')} hint={t('مثلاً: أ. هاني المحاسب — أكتر من اسم بينهم فاصلة')}><Input value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
        {time < '04:00' && frequency === 'DAILY' && <Banner tone="info">{t('قبل 4 الفجر اليوم التجاري لسه ما خلصش — التقرير هيطلع بأرقام اليوم اللي قبله لحد اللحظة دي.')}</Banner>}
        <div className="text-[11px] text-dim">{t('في البروتوتايب الإرسال بيتسجل بس (مفيش إيميل بيتبعت فعلاً).')}</div>
      </div>
    </Modal>
  );
}

export { Money };
