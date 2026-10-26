// Owner / manager home: today's sales against yesterday and the same day last week, the service that is running
// right now (tables, kitchen, deliveries, drawers), the things waiting for a decision (approvals, low stock, failed
// e-receipts and prints, drawer differences, reconciliation), quick links — and, for a new install, the setup
// checklist in the J-A1 order (computed from simple reads).
import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, Circle, ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, Receipt, Wallet, Armchair, ChefHat, Bike, Clock3,
  BellRing, PackageMinus, FileWarning, Printer, Scale, Banknote, ShieldCheck, ChevronDown, Sparkles, CalendarDays, Hourglass,
} from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { screenById } from '../app/registry';
import { Banner, Button, Card, Money, Pill, StateBadge, PageHeader, StatGrid, StatCard, EmptyState, Skeleton } from '../ui';
import { t, L, useLang } from '../i18n';
import { Tech } from '../app/tech';
import { cn, money } from '../lib/format';
import { clock, businessDate } from '../mock/clock';
import { branchLabel, personName } from '../demo/people';
import { useList } from './admin/org/common';

type Status = boolean | null; // null = not known (read refused or no simple read)
const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
/** «الاتنين، 26 أكتوبر» with Western digits. */
export const dayLabel = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')) : '—');
// business day runs 04:00 → 03:59: hours in that order
const DAY_HOURS = [...Array.from({ length: 20 }, (_, i) => i + 4), 0, 1, 2, 3];
const cairoHour = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(clock.now())));

export default function Home() {
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const branch = useQuery<any>(branchId ? 'Branch.Get' : null, { params: { branchId } });
  // display of the server rule (branch timezone + cutoff); every command resolves its own business date on the server
  const bd = branch.data ? businessDate(clock.now(), branch.data.timezone, branch.data.businessDayCutoff) : null;
  const setup = useSetupSteps(bd);
  // a new install: something before the first sale is still missing (the demo restaurant is set up already)
  const fresh = setup.steps.some((s) => s.screen !== 'counter' && s.status === false);
  const first = personName(me?.user?.username, me?.user?.displayName) || me?.user?.displayName || '';
  const daily = useQuery<any>(bd ? 'Report.Run' : null, { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: bd } });
  return (
    <div className="space-y-4 max-w-[1600px] mx-auto" data-fb="screen:HOME">
      <PageHeader
        title={first ? t('أهلًا يا {n}', { n: first }) : t('الرئيسية')}
        description={fresh ? t('المطعم لسه بيتجهز: كمّل الخطوات بالترتيب، وبعد أول بيعة الأرقام هتظهر هنا.') : t('المطعم النهارده في نظرة: المبيعات، الشغل اللي ماشي دلوقتي، والحاجات اللي مستنية قرار منك.')}
        badge={<StateBadge ops={['Access.Me', 'Report.Run', 'Report.Trend', 'Compliance.Find']} />}
        meta={<div className="flex items-center gap-2 flex-wrap">
          {bd && <Pill tone="primary"><CalendarDays className="w-3 h-3" />{t('اليوم التجاري')}: {dayLabel(bd)}</Pill>}
          {branch.data && <Pill>{branchLabel(branch.data)}</Pill>}
          {daily.data?.provisional && <Pill tone="warning" title={t('الأرقام بتتحدث لحد ما اليوم يتقفل')}>{t('اليوم لسه مفتوح — الأرقام مبدئية')}</Pill>}
        </div>}
        actions={<QuickHeaderActions next={fresh ? setup.steps.find((s) => s.status === false) : undefined} />}
      />
      {!bd && !branch.loading && !fresh && <Banner tone="info">{t('الجهاز ده مش متربط بفرع — اختار فرع من فوق عشان تشوف أرقام اليوم.')}</Banner>}
      {fresh && <SetupPath setup={setup} />}
      {bd && <SalesToday bd={bd} daily={daily} />}
      {bd && (
        <div className="grid xl:grid-cols-[1fr_380px] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            <LiveService />
            <QuickLinks />
          </div>
          <NeedsAction />
        </div>
      )}
      {!fresh && <SetupPath setup={setup} collapsed />}
    </div>
  );
}

function QuickHeaderActions({ next }: { next?: Step }) {
  const { nav } = useDev();
  const approvals = useQuery<any>(screenById.get('approvals-inbox') ? 'ApprovalRequest.Find' : null, { query: { state: 'PENDING', limit: 50 } });
  const pending = approvals.data?.pending ?? 0;
  return (
    <>
      {pending > 0 && <Button variant="warning" onClick={() => nav('approvals-inbox')} data-fb="home:approvals"><BellRing className="w-4 h-4" />{t('{n} طلب موافقة مستني', { n: pending })}</Button>}
      {next ? <Button variant="primary" onClick={() => nav(next.screen)} data-fb="home:next-step"><Sparkles className="w-4 h-4" />{t('الخطوة الجاية: {s}', { s: next.title })}</Button>
        : <Button variant={pending > 0 ? 'secondary' : 'primary'} onClick={() => nav('reports')} data-fb="home:reports"><TrendingUp className="w-4 h-4" />{t('التقارير')}</Button>}
    </>
  );
}

// ───────── today's sales
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (!before) return <span className="text-[11px] text-dim">{label}: —</span>;
  const p = ((now - before) / before) * 100;
  const up = p > 0.5, down = p < -0.5;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return <span className={cn('text-[11px] inline-flex items-center gap-1', up ? 'text-[var(--success)]' : down ? 'text-[var(--error)]' : 'text-dim')}><Icon className="w-3 h-3" /><span className="num">{p > 0 ? '+' : ''}{p.toFixed(0)}%</span><span className="text-dim">{label}</span></span>;
}

const sumUpTo = (byHour: number[] | undefined, hour: number) => {
  if (!byHour) return 0;
  let s = 0;
  for (const h of DAY_HOURS) { s += n(byHour[h]); if (h === hour) break; }
  return s;
};

function SalesToday({ bd, daily }: { bd: string; daily: ReturnType<typeof useQuery<any>> }) {
  const { nav } = useDev();
  const trend = useQuery<any>('Report.Trend', { query: { days: 15 } });
  const items: any[] = trend.data?.items ?? [];
  const today = items.at(-1), yday = items.at(-2), lastWeek = items.at(-8);
  const rows: any[][] = daily.data?.sections?.find((s: any) => s.id === 'summary')?.rows ?? [];
  const val = (k: string) => rows.find((x) => x[0] === k)?.[1];
  const outstanding: any[][] = daily.data?.sections?.find((s: any) => s.id === 'outstanding_checks')?.rows ?? [];
  const outstandingSum = outstanding.reduce((a, r) => a + n(r[2]), 0);
  const hour = cairoHour();
  const netToday = n(val('net_sales') ?? today?.netSales);
  const ordersToday = n(val('order_count') ?? today?.orders);
  const avgToday = ordersToday ? netToday / ordersToday : 0;
  // same time yesterday / last week: cumulative sales up to this hour of the business day
  const ydSoFar = sumUpTo(yday?.byHour, hour), lwSoFar = sumUpTo(lastWeek?.byHour, hour);
  const ydOrdersSoFar = yday?.orders && n(yday.netSales) ? Math.round((yday.orders * ydSoFar) / n(yday.netSales)) : 0;
  const lwOrdersSoFar = lastWeek?.orders && n(lastWeek.netSales) ? Math.round((lastWeek.orders * lwSoFar) / n(lastWeek.netSales)) : 0;
  const avg = (x: any) => (x?.orders ? n(x.netSales) / x.orders : 0);
  const loading = daily.loading && !daily.data;
  return (
    <div className="space-y-4">
      <StatGrid>
        <StatCard fb="home:kpi:net_sales" label={t('صافي المبيعات النهارده')} tone="primary" icon={<TrendingUp className="w-4 h-4" />} onClick={() => nav('reports')}
          value={loading ? <Skeleton className="h-7 w-28" /> : <span className="num">{fmt(netToday)} <span className="text-sm font-normal text-dim">{t('جنيه')}</span></span>}
          hint={netToday ? <span className="flex flex-col gap-0.5"><Delta now={netToday} before={ydSoFar} label={t('عن امبارح لحد نفس الساعة')} /><Delta now={netToday} before={lwSoFar} label={t('عن نفس اليوم الأسبوع اللي فات')} /></span>
            : <span className="flex flex-col gap-0.5"><span>{t('لسه مفيش بيع النهارده')}</span><span>{t('امبارح لحد نفس الساعة: {m} جنيه', { m: fmt(ydSoFar) })}</span></span>} />
        <StatCard fb="home:kpi:order_count" label={t('عدد الشيكات المقفولة')} icon={<Receipt className="w-4 h-4" />}
          value={loading ? <Skeleton className="h-7 w-16" /> : <span className="num">{ordersToday}</span>}
          hint={ordersToday ? <span className="flex flex-col gap-0.5"><Delta now={ordersToday} before={ydOrdersSoFar} label={t('عن امبارح لحد نفس الساعة')} /><Delta now={ordersToday} before={lwOrdersSoFar} label={t('عن نفس اليوم الأسبوع اللي فات')} /></span>
            : <span className="flex flex-col gap-0.5"><span>{t('امبارح لحد نفس الساعة: {n} شيك', { n: ydOrdersSoFar })}</span><span>{t('امبارح كله: {n} شيك', { n: yday?.orders ?? 0 })}</span></span>} />
        <StatCard fb="home:kpi:average_order_value" label={t('متوسط الشيك')} icon={<Wallet className="w-4 h-4" />}
          value={loading ? <Skeleton className="h-7 w-20" /> : <span className="num">{fmt(avgToday)} <span className="text-sm font-normal text-dim">{t('جنيه')}</span></span>}
          hint={avgToday ? <span className="flex flex-col gap-0.5"><Delta now={avgToday} before={avg(yday)} label={t('عن متوسط امبارح')} /><Delta now={avgToday} before={avg(lastWeek)} label={t('عن نفس اليوم الأسبوع اللي فات')} /></span>
            : <span className="flex flex-col gap-0.5"><span>{t('متوسط امبارح: {m} جنيه', { m: fmt(avg(yday)) })}</span><span>{t('الأسبوع اللي فات: {m} جنيه', { m: fmt(avg(lastWeek)) })}</span></span>} />
        <StatCard fb="home:kpi:outstanding" label={t('شيكات مستنية الدفع')} icon={<Hourglass className="w-4 h-4" />} tone={outstanding.length ? 'warning' : 'neutral'} onClick={() => nav('checks')}
          value={loading ? <Skeleton className="h-7 w-16" /> : <span className="num">{outstanding.length}</span>}
          hint={outstanding.length ? t('عليها {m} لسه ما اتدفعتش', { m: money(String(outstandingSum)) }) : t('كل الشيكات اللي اتأكدت اتدفعت')} />
      </StatGrid>
      <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4">
        <Card title={t('المبيعات على مدار اليوم')} description={t('النهارده لحد دلوقتي مقارنة بامبارح ونفس اليوم الأسبوع اللي فات (تراكمي من الساعة 4 الفجر).')} badge={<StateBadge ops={['Report.Trend']} />}>
          {trend.loading && !trend.data ? <Skeleton className="h-52 w-full" /> : <HourChart today={today} yday={yday} lastWeek={lastWeek} hour={hour} />}
        </Card>
        <Card title={t('آخر 14 يوم')} description={t('صافي المبيعات كل يوم — الخميس والجمعة بلون مختلف.')} actions={<Button size="sm" variant="ghost" onClick={() => nav('reports')}>{t('التفاصيل')}<ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" /></Button>}>
          {trend.loading && !trend.data ? <Skeleton className="h-52 w-full" /> : <DaysChart items={items.slice(-14)} />}
          <TodayBreakdown rows={rows} />
        </Card>
      </div>
      {daily.error && <Banner tone="warning">{t('أرقام اليوم مش متاحة للحساب ده.')}<Tech> <span className="num text-xs">{daily.error.code}</span></Tech></Banner>}
    </div>
  );
}

const MONEY_KEYS = new Set(['gross_sales', 'discounts', 'comps', 'net_sales', 'service_charge', 'tax', 'refunds_paid', 'net_sales_after_refunds', 'average_order_value', 'charges']);
const LABELS: Record<string, string> = { service_charge: 'الخدمة', tax: 'الضريبة', discounts: 'الخصومات', refunds_paid: 'مرتجعات اتصرفت' };
function TodayBreakdown({ rows }: { rows: any[][] }) {
  if (!rows.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t line">
      {Object.keys(LABELS).map((k) => {
        const v = rows.find((x) => x[0] === k)?.[1];
        return (
          <div key={k} className="min-w-0" data-fb={`home:kpi:${k}`}>
            <div className="text-[11px] text-dim truncate">{t(LABELS[k])}</div>
            <div className="text-sm">{MONEY_KEYS.has(k) ? <Money v={v ?? '0'} /> : <span className="num font-bold">{v ?? 0}</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

function HourChart({ today, yday, lastWeek, hour }: { today: any; yday: any; lastWeek: any; hour: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const cum = (x: any, upTo?: number) => { let s = 0; const out: number[] = []; for (const h of DAY_HOURS) { s += n(x?.byHour?.[h]); out.push(s); if (upTo !== undefined && h === upTo) break; } return out; };
  const tSeries = cum(today, hour), ySeries = cum(yday), wSeries = cum(lastWeek);
  const max = Math.max(1, ...ySeries, ...wSeries, ...tSeries);
  const W = 640, H = 200, P = 8, X = (i: number) => P + (i * (W - 2 * P)) / 23, Y = (v: number) => H - 24 - (v / max) * (H - 40);
  const line = (s: number[]) => s.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  const area = tSeries.length ? `${X(0)},${Y(0)} ${line(tSeries)} ${X(tSeries.length - 1)},${Y(0)}` : '';
  const hi = hover ?? tSeries.length - 1;
  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-52" role="img" aria-label={t('المبيعات على مدار اليوم')} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={P} x2={W - P} y1={Y(g * max)} y2={Y(g * max)} stroke="currentColor" strokeOpacity="0.07" />)}
        <polyline fill="none" stroke="var(--chart-3, #a78bfa)" strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="4 4" points={line(wSeries)} />
        <polyline fill="none" stroke="var(--chart-2, #fbbf24)" strokeOpacity="0.9" strokeWidth="2" points={line(ySeries)} />
        {area && <polygon points={area} fill="var(--primary)" fillOpacity="0.14" />}
        {tSeries.length > 0 && <polyline fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" points={line(tSeries)} />}
        {tSeries.length > 0 && <circle cx={X(tSeries.length - 1)} cy={Y(tSeries.at(-1)!)} r="4.5" fill="var(--primary)" />}
        {DAY_HOURS.map((h, i) => <rect key={h} x={X(i) - 13} y={0} width={26} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />)}
        {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={8} y2={H - 24} stroke="currentColor" strokeOpacity="0.25" />}
        {[0, 4, 8, 12, 16, 20, 23].map((i) => <text key={i} x={X(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.55">{DAY_HOURS[i]}</text>)}
      </svg>
      <div className="absolute top-1 left-2 rounded-lg glass-strong px-3 py-1.5 text-xs pointer-events-none space-y-0.5" dir="rtl">
        <div className="font-bold">{t('لحد الساعة {h}', { h: DAY_HOURS[hi] })}</div>
        {hi < tSeries.length && <div className="flex justify-between gap-3"><span className="text-[var(--primary)]">{t('النهارده')}</span><span className="num">{fmt(tSeries[hi])}</span></div>}
        <div className="flex justify-between gap-3"><span className="text-[var(--chart-2,#fbbf24)]">{t('امبارح')}</span><span className="num">{fmt(ySeries[hi] ?? 0)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[var(--chart-3,#a78bfa)]">{t('الأسبوع اللي فات')}</span><span className="num">{fmt(wSeries[hi] ?? 0)}</span></div>
      </div>
      <div className="flex gap-4 text-[11px] text-dim justify-end mt-1" dir="rtl">
        <span className="flex items-center gap-1.5"><span className="w-4 h-[3px] rounded bg-[var(--primary)]" />{t('النهارده')}</span>
        <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] rounded bg-[var(--chart-2,#fbbf24)]" />{t('امبارح')}</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[var(--chart-3,#a78bfa)]" />{t('نفس اليوم الأسبوع اللي فات')}</span>
      </div>
    </div>
  );
}

function DaysChart({ items }: { items: any[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...items.map((x) => n(x.netSales)));
  const W = 420, H = 170;
  const bw = W / Math.max(items.length, 1);
  const hi = hover !== null ? items[hover] : null;
  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-44" onMouseLeave={() => setHover(null)}>
        {items.map((x, i) => {
          const h = (n(x.netSales) / max) * (H - 30);
          const isToday = i === items.length - 1;
          const wknd = [4, 5].includes(new Date(x.businessDate + 'T12:00:00Z').getUTCDay());
          return (
            <g key={x.businessDate} onMouseEnter={() => setHover(i)}>
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * bw + bw * 0.18} y={H - 20 - h} width={bw * 0.64} height={Math.max(h, 1.5)} rx="4" fill={isToday ? 'var(--primary)' : wknd ? 'var(--chart-3, #a78bfa)' : 'var(--chart-1, #22d3ee)'} fillOpacity={hover === null || hover === i ? (isToday ? 1 : 0.7) : 0.35} />
              <text x={i * bw + bw / 2} y={H - 5} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">{Number(x.businessDate.slice(8, 10))}</text>
            </g>
          );
        })}
      </svg>
      {hi && <div className="absolute top-0 left-2 rounded-lg glass-strong px-3 py-1.5 text-xs pointer-events-none" dir="rtl"><b>{dayLabel(hi.businessDate)}</b><div><span className="num">{fmt(n(hi.netSales))}</span> {t('جنيه')} · <span className="num">{hi.orders}</span> {t('شيك')}</div></div>}
    </div>
  );
}

// ───────── live service
function LiveTile({ icon, label, value, sub, tone = 'neutral', onClick, fb }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'neutral' | 'warning' | 'error' | 'success'; onClick?: () => void; fb: string }) {
  const ring = tone === 'error' ? 'text-[var(--error)]' : tone === 'warning' ? 'text-[var(--warning)]' : tone === 'success' ? 'text-[var(--success)]' : 'text-[var(--primary)]';
  return (
    <button type="button" onClick={onClick} data-fb={fb} className="text-start rounded-xl surface-1 hover:surface-2 border line p-3 transition-colors min-w-0 flex flex-col gap-1">
      <span className="flex items-center gap-2 text-xs text-soft"><span className={ring}>{icon}</span>{label}</span>
      <span className="text-2xl font-bold num">{value}</span>
      {sub && <span className="text-[11px] text-dim leading-snug">{sub}</span>}
    </button>
  );
}

function LiveService() {
  const { nav } = useDev();
  const tables = useList<any>('Table.List');
  const visits = useList<any>('TableVisit.List', { query: { state: 'OPEN', limit: 200 } });
  const kitchen = useList<any>('Kitchen.Board', { query: { lifecycle: 'NEW,IN_PROGRESS,READY', limit: 200 } });
  const delivery = useQuery<any>('Delivery.Board', { query: { scope: 'active', limit: 200 } });
  const sessions = useList<any>('Session.Find', { query: { state: 'OPEN', limit: 50 } });
  const activeTables = tables.items.filter((x) => x.active !== false).length;
  const guests = visits.items.reduce((a, v) => a + n(v.guestCount), 0);
  const cooking = kitchen.items.filter((x) => x.state !== 'READY');
  const late = cooking.filter((x) => x.late).length;
  const ready = kitchen.items.filter((x) => x.state === 'READY').length;
  const ds = delivery.data?.summary;
  const anyLoaded = tables.data || kitchen.data || delivery.data || sessions.data;
  return (
    <Card title={<span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />{t('الشغل دلوقتي')}</span>} description={t('بيتحدث لوحده مع كل حركة على أي جهاز.')}>
      {!anyLoaded ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tables.data && <LiveTile fb="home:live:tables" icon={<Armchair className="w-4 h-4" />} label={t('الترابيزات المشغولة')} onClick={() => nav('floor')}
            value={<>{visits.items.length}<span className="text-sm text-dim font-normal"> / {activeTables}</span></>}
            sub={visits.items.length ? t('{g} ضيف قاعدين دلوقتي', { g: guests }) : t('الصالة فاضية')} />}
          {kitchen.data && <LiveTile fb="home:live:kitchen" icon={<ChefHat className="w-4 h-4" />} label={t('طلبات في المطبخ')} onClick={() => nav('kitchen')} tone={late ? 'error' : cooking.length > 8 ? 'warning' : 'neutral'}
            value={cooking.length}
            sub={late ? t('{l} متأخرين عن الوقت المحدد', { l: late }) : ready ? t('{r} جاهزين يطلعوا', { r: ready }) : cooking.length ? t('كله في الوقت') : t('المطبخ فاضي')} />}
          {delivery.data && <LiveTile fb="home:live:delivery" icon={<Bike className="w-4 h-4" />} label={t('الدليفري')} onClick={() => nav('delivery-board')} tone={ds?.late ? 'error' : ds?.failed ? 'warning' : 'neutral'}
            value={<>{n(ds?.onRoad)}<span className="text-sm text-dim font-normal"> {t('في الطريق')}</span></>}
            sub={[n(ds?.pending) ? t('{p} مستني طيار', { p: ds.pending }) : null, n(ds?.late) ? t('{l} متأخر', { l: ds.late }) : null, n(ds?.delivered) ? t('{d} اتسلم', { d: ds.delivered }) : null].filter(Boolean).join(' · ') || t('مفيش طلبات دليفري شغالة')} />}
          {sessions.data && <LiveTile fb="home:live:drawers" icon={<Clock3 className="w-4 h-4" />} label={t('الورديات المفتوحة')} onClick={() => nav('shift')} tone={sessions.items.length ? 'success' : 'neutral'}
            value={sessions.items.length}
            sub={sessions.items.length ? sessions.items.slice(0, 2).map((s) => personName(null, s.cashierName)).join('، ') : t('مفيش درج مفتوح — الكاشير يفتح وردية الأول')} />}
        </div>
      )}
    </Card>
  );
}

// ───────── needs action
interface Alert { id: string; tone: 'error' | 'warning' | 'info'; icon: React.ReactNode; title: string; text?: string; screen: string; cta: string }
function NeedsAction() {
  const { nav } = useDev();
  const approvals = useQuery<any>('ApprovalRequest.Find', { query: { state: 'PENDING', limit: 50 } });
  const low = useList<any>('Inventory.LowStock', { query: { limit: 200 } });
  const expiring = useList<any>('Inventory.Expiring', { query: { days: 3, limit: 200 } });
  const fiscal = useList<any>('Compliance.Find', { query: { submission: 'PENDING_DATA,BUILT,SUBMITTED,REJECTED', limit: 500 } });
  const prints = useList<any>('PrintJob.Find', { query: { state: 'FAILED,DEAD', limit: 200 } });
  const days = useList<any>('BusinessDay.Find', { query: { limit: 7 } });
  const recon = useQuery<any>('Reconciliation.Board', { query: { status: 'UNEXPLAINED_DIFFERENCE' } });
  const outbox = useQuery<any>('OutboxDelivery.Find', { query: { limit: 1 } });

  const alerts: Alert[] = [];
  const pending = approvals.data?.pending ?? 0;
  if (pending) alerts.push({ id: 'approvals', tone: 'warning', icon: <BellRing className="w-4 h-4" />, title: t('{n} طلب موافقة مستنيك', { n: pending }), text: t('موظفين طالبين موافقة مدير من جهاز تاني.'), screen: 'approvals-inbox', cta: t('راجع') });
  const out = low.items.filter((x) => x.state === 'OUT' || n(x.onHand) <= 0).length;
  if (low.items.length) alerts.push({ id: 'low', tone: out ? 'error' : 'warning', icon: <PackageMinus className="w-4 h-4" />, title: t('{n} خامة تحت الحد الأدنى', { n: low.items.length }), text: (out ? t('{o} خلصت خالص. ', { o: out }) : '') + low.items.slice(0, 3).map((x) => L(x.item?.name) || x.item?.name).filter(Boolean).join('، '), screen: 'inv-dashboard', cta: t('اطلب') });
  if (expiring.items.length) alerts.push({ id: 'expiring', tone: 'warning', icon: <Hourglass className="w-4 h-4" />, title: t('{n} دفعة صلاحيتها بتخلص خلال 3 أيام', { n: expiring.items.length }), text: t('استخدمها الأول أو سجلها هالك.'), screen: 'inv-dashboard', cta: t('اعرض') });
  const rejected = fiscal.items.filter((d) => d.state === 'REJECTED' || d.state === 'PENDING_DATA').length;
  const nearDeadline = fiscal.items.filter((d) => d.alert).length;
  if (rejected || nearDeadline) alerts.push({ id: 'fiscal', tone: nearDeadline ? 'error' : 'warning', icon: <FileWarning className="w-4 h-4" />, title: t('{n} إيصال إلكتروني محتاج تدخل', { n: rejected || nearDeadline }), text: nearDeadline ? t('{h} منهم قربوا من مهلة الـ 24 ساعة. البيع ماشي عادي.', { h: nearDeadline }) : t('مرفوض أو ناقصه بيانات — البيع ماشي عادي.'), screen: 'ereceipts', cta: t('افتح') });
  if (prints.items.length) alerts.push({ id: 'prints', tone: prints.items.some((j) => j.state === 'DEAD') ? 'error' : 'warning', icon: <Printer className="w-4 h-4" />, title: t('{n} أمر طباعة ما طبعش', { n: prints.items.length }), text: t('شوف الطابعة واضغط «إعادة» من طابور الطباعة.'), screen: 'prints', cta: t('افتح') });
  const lastClosed = days.items.find((d) => d.state === 'CLOSED');
  const variance = n(lastClosed?.summary?.cashVariance);
  if (lastClosed && variance !== 0) alerts.push({ id: 'variance', tone: Math.abs(variance) >= 100 ? 'error' : 'warning', icon: <Banknote className="w-4 h-4" />, title: variance < 0 ? t('عجز {m} في الدرج', { m: money(String(Math.abs(variance))) }) : t('زيادة {m} في الدرج', { m: money(String(variance)) }), text: t('في قفلة {d}.', { d: dayLabel(lastClosed.date) }), screen: 'reconciliation', cta: t('راجع') });
  const diffs = recon.data?.counts?.UNEXPLAINED_DIFFERENCE ?? 0;
  if (diffs) alerts.push({ id: 'recon', tone: 'warning', icon: <Scale className="w-4 h-4" />, title: t('{n} فرق في المطابقة من غير تفسير', { n: diffs }), text: t('فلوس الكروت أو المحافظ مش مطابقة لتسوية البنك.'), screen: 'reconciliation', cta: t('افتح') });
  const stuck = n(outbox.data?.counts?.DEAD) + n(outbox.data?.counts?.FAILED);
  if (stuck) alerts.push({ id: 'outbox', tone: 'warning', icon: <ShieldCheck className="w-4 h-4" />, title: t('{n} عملية في الخلفية واقفة', { n: stuck }), text: t('زي إرسال للمطبخ أو للمنظومة — ممكن تعيدها من صحة النظام.'), screen: 'health', cta: t('افتح') });

  const visible = alerts.filter((a) => screenById.get(a.screen));
  const loading = approvals.loading && low.loading && fiscal.loading;
  return (
    <Card title={<span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[var(--warning)]" />{t('محتاج منك')}</span>} badge={visible.length ? <Pill tone="warning">{visible.length}</Pill> : undefined} data-fb="home:alerts">
      {loading ? <Skeleton lines={4} /> : visible.length === 0 ? (
        <EmptyState compact icon={<CheckCircle2 className="w-6 h-6 text-[var(--success)]" />} title={t('كله تمام')} text={t('مفيش موافقات مستنية ولا مخزن ناقص ولا إيصالات أو طباعة واقفة.')} />
      ) : (
        <div className="space-y-2">
          {visible.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-xl surface-1 border line p-3" data-fb={`home:alert:${a.id}`}>
              <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', a.tone === 'error' ? 'bg-[color-mix(in_srgb,var(--error)_15%,transparent)] text-[var(--error)]' : a.tone === 'warning' ? 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-[var(--warning)]' : 'bg-[var(--primary-container)] text-[var(--primary)]')}>{a.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold leading-snug">{a.title}</div>
                {a.text && <div className="text-xs text-dim mt-0.5 leading-relaxed">{a.text}</div>}
              </div>
              <Button size="sm" variant="ghost" onClick={() => nav(a.screen)} data-fb={`home:alert-go:${a.id}`}>{a.cta}<ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" /></Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ───────── quick links
const LINKS = ['menu', 'prices', 'promotions', 'inv-dashboard', 'inv-po', 'customers', 'users', 'settings', 'businessday', 'audit'];
function QuickLinks() {
  const { nav, kind } = useDev();
  const lang = useLang();
  const list = LINKS.map((id) => screenById.get(id)).filter((d): d is NonNullable<typeof d> => !!d && (d.kinds as string[]).includes(kind));
  if (!list.length) return null;
  return (
    <Card title={t('اختصارات')}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {list.map((d) => {
          const Icon = d.icon;
          return (
            <button key={d.id} type="button" onClick={() => nav(d.id)} data-fb={`home:link:${d.id}`} className="flex items-center gap-2 rounded-xl surface-1 hover:surface-2 border line px-3 h-12 text-sm text-start min-w-0 transition-colors">
              <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-900 shrink-0', d.gradient)}><Icon className="w-4 h-4" /></span>
              <span className="truncate">{lang === 'ar' ? d.title : d.titleEn}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ───────── setup checklist (J-A1 order)
interface Step { screen: string; title: string; status: Status; detail: string; note?: string }
function useSetupSteps(bd: string | null) {
  const { kind } = useDev();
  const biz = useQuery<any>('Business.Get');
  const branches = useList<any>('Branch.List');
  const terms = useList<any>('Terminal.List');
  const users = useList<any>('User.Find');
  const roles = useList<any>('Role.List');
  const reasons = useList<any>('ReasonCode.List', { query: { active: true } });
  const floor = useQuery<any>('Settings.Effective', { query: { policyId: 'FloorIntakePolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const taxes = useList<any>('TaxPolicy.List');
  const products = useList<any>('Catalog.Search', { query: { limit: 500 } });
  const stations = useList<any>('KitchenStation.List');
  const rules = useList<any>('RoutingRule.List');
  const tables = useList<any>('Table.List');
  const fiscal = useQuery<any>('Settings.Effective', { query: { policyId: 'FiscalDocumentPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const sales = useQuery<any>(bd ? 'Report.Run' : null, { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: bd } });

  return useMemo(() => {
    const known = (...qs: { data: any; error: any }[]) => qs.every((q) => q.data && !q.error);
    const activeTerms = terms.items.filter((x) => x.lifecycle === 'ACTIVE');
    const kinds = new Set(activeTerms.map((x) => x.kind));
    const catchAll = rules.items.some((r) => r.active && !r.match?.productId && !r.match?.categoryId && !r.match?.channel);
    const orderCount = sales.data?.sections?.[0]?.rows?.find((r: any[]) => r[0] === 'order_count')?.[1];
    const fiscalMode = fiscal.data?.value?.mode ?? fiscal.data?.value;
    const FISCAL_MODE: Record<string, string> = { OFF: 'مقفول', SANDBOX: 'تجريبي', PRODUCTION: 'شغال فعلي' };
    const steps: Step[] = [
      { screen: 'org', title: t('بيانات المطعم والفروع والأجهزة'), status: known(biz, branches, terms) ? !!biz.data?.name && branches.items.length > 0 && ['CASH', 'FLOOR', 'KDS', 'ADMIN'].every((k) => kinds.has(k)) : null,
        detail: t('{b} فرع · {d} جهاز ({k} من 4 أنواع: كاشير، تابلت، مطبخ، إدارة)', { b: branches.items.length, d: activeTerms.length, k: kinds.size }) },
      { screen: 'users', title: t('الموظفين وصلاحياتهم'), status: known(users, roles) ? users.items.length >= 2 && roles.items.length >= 1 : null,
        detail: t('{u} موظف · {r} دور', { u: users.items.length, r: roles.items.length }) },
      { screen: 'settings', title: t('إعدادات السوق المصري والأسباب'), status: known(floor, reasons) ? (floor.data?.rows ?? []).length > 0 && reasons.items.length > 0 : null,
        detail: t('{n} سبب جاهز للإلغاء والخصم · إعدادات مصر {p}', { n: reasons.items.length, p: (floor.data?.rows ?? []).length > 0 ? t('متطبقة') : t('لسه') }) },
      { screen: 'taxes', title: t('الضرايب (القيمة المضافة 14%)'), status: known(taxes) ? taxes.items.some((x) => x.active) : null,
        detail: t('{n} ضريبة شغالة', { n: taxes.items.filter((x) => x.active).length }), note: t('المحاسب يأكدها قبل أول بيع حقيقي') },
      { screen: 'import', title: t('المنيو (استيراد من إكسيل أو صنف صنف)'), status: known(products) ? products.items.length > 0 : null,
        detail: t('{n} صنف', { n: products.items.length }) },
      { screen: 'prices', title: t('الأسعار لكل فرع ونوع طلب'), status: null, detail: t('راجع إن كل صنف ليه سعر — الصنف اللي من غير سعر ما ينفعش يتباع') },
      { screen: 'stations', title: t('المطبخ والمحطات والترابيزات'), status: known(stations, rules, tables) ? stations.items.length > 0 && catchAll && tables.items.length > 0 : null,
        detail: t('{s} محطة · {r} قاعدة توزيع{c} · {tb} ترابيزة', { s: stations.items.length, r: rules.items.length, c: catchAll ? '' : ' — ' + t('ناقصة قاعدة «أي حاجة تانية»'), tb: tables.items.length }) },
      { screen: 'fiscal', title: t('الإيصال الإلكتروني (منظومة الضرايب)'), status: fiscal.data ? (typeof fiscalMode === 'string' ? fiscalMode !== 'OFF' : null) : null,
        detail: t('الوضع: {m}', { m: typeof fiscalMode === 'string' ? t(FISCAL_MODE[fiscalMode] ?? fiscalMode) : '—' }), note: t('ابدأ بالتجريبي، والفعلي بعد اعتماد المنظومة') },
      { screen: 'counter', title: t('أول بيعة على الكاشير'), status: sales.data ? Number(orderCount ?? 0) > 0 : null,
        detail: t('{n} شيك اتقفل النهارده', { n: orderCount ?? '—' }), note: kind === 'BO' ? t('من جهاز الكاشير (فوق)') : undefined },
      { screen: 'reports', title: t('تقارير اليوم'), status: null, detail: t('المبيعات وطرق الدفع لنفس اليوم التجاري') },
    ];
    const done = steps.filter((s) => s.status === true).length;
    const measurable = steps.filter((s) => s.status !== null).length;
    return { steps, done, measurable };
  }, [biz, branches, terms, users, roles, reasons, floor, taxes, products, stations, rules, tables, fiscal, sales, kind]);
}

function SetupPath({ setup, collapsed }: { setup: ReturnType<typeof useSetupSteps>; collapsed?: boolean }) {
  const { nav } = useDev();
  const lang = useLang();
  const [open, setOpen] = useState(!collapsed);
  const { steps, done } = setup;
  const nextIdx = steps.findIndex((s) => s.status === false);
  const pct = Math.round((done / steps.length) * 100);
  return (
    <Card
      title={<span className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-[var(--primary)]" />{t('تجهيز المطعم من الصفر')}</span>}
      description={collapsed ? undefined : t('عشر خطوات بالترتيب لحد أول بيعة. كل خطوة بتفتح الشاشة بتاعتها.')}
      badge={<><Pill tone={nextIdx === -1 ? 'success' : 'warning'} title={t('الخطوات اللي اتعملت من كل الخطوات')}>{t('{d} من {n} خطوات', { d: done, n: steps.length })}</Pill><Tech><span className="num text-[10px] text-dim">J-A1</span></Tech></>}
      actions={collapsed ? <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} data-fb="home:setup-toggle">{open ? t('اخفي') : t('اعرض الخطوات')}<ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} /></Button> : undefined}
    >
      <div className="h-1.5 rounded-full surface-2 overflow-hidden mb-3"><div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${pct}%` }} /></div>
      {open ? (
        <div className="grid lg:grid-cols-2 gap-2">
          {steps.map((s, i) => {
            const def = screenById.get(s.screen);
            const Icon = def?.icon;
            const isNext = i === nextIdx;
            return (
              <div key={s.screen} className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 border', isNext ? 'border-[color-mix(in_srgb,var(--primary)_55%,transparent)] bg-[var(--primary-container)]' : 'line surface-1')} data-fb={`home:step:${s.screen}`}>
                <span className="num text-dim w-5 text-center font-bold text-sm">{i + 1}</span>
                {s.status === true ? <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0" /> : s.status === false ? <AlertTriangle className="w-5 h-5 text-[var(--warning)] shrink-0" /> : <Circle className="w-5 h-5 text-dim shrink-0" />}
                {Icon && <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-900 shrink-0', def?.gradient)}><Icon className="w-4 h-4" /></span>}
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm flex items-center gap-2 flex-wrap">{s.title}<Tech><span className="num text-[10px] text-dim font-normal">{def?.code}</span></Tech></div>
                  <div className="text-xs text-dim leading-relaxed">{s.detail}{s.note ? ` — ${s.note}` : ''}</div>
                </div>
                <Button size="sm" variant={isNext ? 'primary' : 'ghost'} onClick={() => nav(s.screen)} data-fb={`home:go:${s.screen}`} title={lang === 'ar' ? def?.title : def?.titleEn}>{isNext ? t('ابدأ') : t('افتح')}<ArrowLeft className="w-3.5 h-3.5 ltr:rotate-180" /></Button>
              </div>
            );
          })}
        </div>
      ) : null}
      {open && <div className="text-[11px] text-dim mt-3">{t('العلامة بتتحسب لوحدها من اللي اتعمل فعلًا (عدد الفروع والأجهزة والموظفين والضرايب والأصناف…). الدايرة الفاضية = خطوة بتتراجع بالعين، أو الحساب ده مش مسموح له يشوفها.')}</div>}
    </Card>
  );
}
