// Owner / manager home: today's sales against yesterday and the same day last week, the service that is running
// right now (tables, kitchen, deliveries, drawers), the things waiting for a decision (approvals, low stock, failed
// e-receipts and prints, drawer differences, reconciliation), quick links — and, for a new install, the setup
// checklist in the J-A1 order (computed from simple reads).
import React, { useMemo, useState } from 'react';
import {
  CheckCircle2, Circle, ArrowLeft, AlertTriangle, TrendingUp, TrendingDown, Minus, Receipt, Wallet, Armchair, ChefHat, Bike, Clock3,
  BellRing, PackageMinus, FileWarning, Printer, Scale, Banknote, ShieldCheck, ChevronDown, Sparkles, CalendarDays, Hourglass, FileBarChart,
} from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { screenById } from '../app/registry';
import { Banner, Button, Card, Money, Pill, StateBadge, PageHeader, StatGrid, StatCard, EmptyState, Skeleton } from '../ui';
import { t, L, tv, useLang } from '../i18n';
import { Tech } from '../app/tech';
import { cn, money, dayLong, qty, currency } from '../lib/format';
import { pctChange, sign } from '../lib/cash';
import { D } from '../mock/money';
import { DAY_HOURS } from '../reports/home';
import { clock, businessDate } from '../mock/clock';
import { branchLabel, personName, personText } from '../demo/people';
import { useList } from './admin/org/common';

type Status = boolean | null; // null = not known (read refused or no simple read)
const n = (v: unknown) => Number(v ?? 0) || 0;
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
/** «الاتنين، 26 أكتوبر» with Western digits. */
export const dayLabel = (iso: string | null | undefined) => (iso ? dayLong(iso) : '—');

export default function Home() {
  const { me, auth, can } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const branch = useQuery<any>(branchId ? 'Branch.Get' : null, { params: { branchId } });
  // display of the server rule (branch timezone + cutoff); every command resolves its own business date on the server
  const bd = branch.data ? businessDate(clock.now(), branch.data.timezone, branch.data.businessDayCutoff) : null;
  const setup = useSetupSteps(bd);
  // a new install: something before the first sale is still missing (the demo restaurant is set up already)
  const fresh = setup.steps.some((s) => s.screen !== 'counter' && s.status === false);
  const first = personName(me?.user?.username, me?.user?.displayName) || me?.user?.displayName || '';
  // ux-17: Home's numbers are the certified reports' numbers (Report.Home: server business day, device branch)
  const home = useQuery<any>(bd && can('report:run') ? 'Report.Home' : null, {});
  return (
    <div className="space-y-4 max-w-[1600px] mx-auto" data-fb="screen:HOME">
      <PageHeader
        title={first ? t('أهلًا يا {n}', { n: first }) : t('الرئيسية')}
        badge={<StateBadge ops={['Access.Me', 'Report.Run', 'Report.Query', 'Compliance.Find']} />}
        meta={<div className="flex items-center gap-2 flex-wrap">
          {bd && <Pill tone="primary"><CalendarDays className="w-3 h-3" />{t('اليوم التجاري')}: {dayLabel(home.data?.businessDate ?? bd)}</Pill>}
          {branch.data && <Pill>{branchLabel(branch.data)}</Pill>}
          {home.data?.provisional && <Pill tone="warning" title={home.data.provisionalReasons.map((x: any) => L(x)).join(' ')}>{t('اليوم ما زال مفتوحًا — الأرقام مبدئية')}</Pill>}
        </div>}
        actions={<QuickHeaderActions next={fresh ? setup.steps.find((s) => s.status === false) : undefined} />}
      />
      {!bd && !branch.loading && !fresh && <Banner tone="info">{t('الجهاز ده مش متربط بفرع — اختار فرع من فوق عشان تشوف أرقام اليوم.')}</Banner>}
      {fresh && <SetupPath setup={setup} />}
      {bd && can('report:run') && <SalesToday home={home} />}
      {bd && (
        <div className="grid min-[1400px]:grid-cols-[1fr_380px] gap-4 items-start">
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
function Delta({ now, before, label }: { now: string | null; before: string | null; label: string }) {
  const p = pctChange(now, before); // Decimal, whole percent
  if (p === null) return <span className="text-[11px] text-dim">{label}: —</span>;
  const v = Number(p);
  const up = v > 0, down = v < 0;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return <span className={cn('text-[11px] inline-flex items-center gap-1', up ? 'text-[var(--success)]' : down ? 'text-[var(--error)]' : 'text-dim')}><Icon className="w-3 h-3" /><span className="num" dir="ltr">{up ? '+' : ''}{p}%</span><span className="text-dim">{label}</span></span>;
}

// ux-17: every Home number is a certified report's number for the server's business day and the device branch
// (Report.Home runs eod_bridge, tender_settlement, top_items and hourly_daypart and returns each value with its source).
// Nothing is summed here; each card opens the report — on the same day — that produced it.
type Hourly = { cumNet: string[] };
type Src = { reportId: string; from: string; to: string };
const HOUR_IDX = (h: number) => DAY_HOURS.indexOf(h);
const mv = (cards: any, id: string): string | null => { const v = cards?.[id]?.value; return v && v.availability === 'AVAILABLE' ? v.value : null; };
const whole = (v: string | null | undefined) => (v == null ? '—' : money(v, false));
/** Opens the report that produced a Home number, on the same business day / range. */
function useOpenReport() { const { nav } = useDev(); return (s: Src | null | undefined) => s && nav('reports', { reportId: s.reportId, from: s.from, to: s.to }); }
function SourceLink({ src, fb }: { src: Src | null | undefined; fb: string }) {
  const open = useOpenReport();
  if (!src) return null;
  return <Button size="sm" variant="ghost" onClick={() => open(src)} data-fb={fb} data-report={src.reportId}><FileBarChart className="w-3.5 h-3.5" />{t('التقرير')}</Button>;
}

function SalesToday({ home }: { home: ReturnType<typeof useQuery<any>> }) {
  const open = useOpenReport();
  const h = home.data;
  const c = h?.cards ?? {};
  const netToday = mv(c, 'net_sales'), checksToday = mv(c, 'checks'), avgToday = mv(c, 'avg_check');
  const cmp = h?.compare;
  const outN = Number(mv(c, 'open_checks') ?? 0) || 0;
  const loading = home.loading && !h;
  const has = (v: string | null) => sign(v) !== 0;
  const src = (id: string) => c[id]?.source as Src | undefined;
  const hourly: { today: Hourly | null; yday: Hourly | null; lastWeek: Hourly | null } = h?.hourly ? { today: { cumNet: h.hourly.today }, yday: { cumNet: h.hourly.yesterday }, lastWeek: { cumNet: h.hourly.lastWeek } } : { today: null, yday: null, lastWeek: null };
  if (h && !Object.keys(c).length && !h.hourly) return null; // the viewer may run none of Home's reports
  return (
    <div className="space-y-4" data-fb="home:sales" data-business-date={h?.businessDate ?? ''}>
      <StatGrid>
        {(loading || c.net_sales) && <StatCard fb="home:kpi:net_sales" label={t('صافي المبيعات')} tone="primary" icon={<TrendingUp className="w-4 h-4" />} onClick={() => open(src('net_sales'))}
          loading={loading} value={<span className="num" data-value={netToday ?? ''} data-business-date={h?.businessDate ?? ''}>{whole(netToday)}</span>} unit={currency()}
          hint={cmp ? (has(netToday) ? <span className="flex flex-col gap-0.5"><Delta now={cmp.netSoFar.today} before={cmp.netSoFar.yesterday} label={t('مقارنة بالأمس حتى الساعة نفسها')} /><Delta now={cmp.netSoFar.today} before={cmp.netSoFar.lastWeek} label={t('مقارنة باليوم نفسه من الأسبوع الماضي')} /></span>
            : <span>{t('الأمس حتى الساعة نفسها: {m}', { m: money(cmp.netSoFar.yesterday ?? '0') })}</span>) : undefined} />}
        {(loading || c.checks) && <StatCard fb="home:kpi:order_count" label={t('الشيكات المغلقة')} icon={<Receipt className="w-4 h-4" />} onClick={() => open(src('checks'))}
          loading={loading} value={<span className="num" data-value={checksToday ?? ''}>{checksToday == null ? '—' : qty(checksToday)}</span>}
          hint={cmp ? (has(checksToday) ? <span className="flex flex-col gap-0.5"><Delta now={cmp.checksSoFar.today} before={cmp.checksSoFar.yesterday} label={t('مقارنة بالأمس حتى الساعة نفسها')} /><Delta now={cmp.checksSoFar.today} before={cmp.checksSoFar.lastWeek} label={t('مقارنة باليوم نفسه من الأسبوع الماضي')} /></span>
            : <span>{t('الأمس كاملًا: {n} شيك', { n: qty(cmp.yesterdayChecks ?? '0') })}</span>) : undefined} />}
        {(loading || c.avg_check) && <StatCard fb="home:kpi:average_order_value" label={t('متوسط الشيك')} icon={<Wallet className="w-4 h-4" />} onClick={() => open(src('avg_check'))}
          loading={loading} value={<span className="num" data-value={avgToday ?? ''}>{whole(avgToday)}</span>} unit={currency()}
          hint={cmp ? (has(avgToday) ? <span className="flex flex-col gap-0.5"><Delta now={avgToday} before={cmp.avg.yesterday} label={t('مقارنة بمتوسط الأمس')} /><Delta now={avgToday} before={cmp.avg.lastWeek} label={t('مقارنة باليوم نفسه من الأسبوع الماضي')} /></span>
            : <span>{t('متوسط الأمس: {m}', { m: money(cmp.avg.yesterday ?? '0') })}</span>) : undefined} />}
        {(loading || c.open_checks) && <StatCard fb="home:kpi:outstanding" label={t('شيكات بانتظار الدفع')} icon={<Hourglass className="w-4 h-4" />} tone={outN ? 'warning' : 'neutral'} onClick={() => open(src('open_checks'))}
          loading={loading} value={<span className="num" data-value={mv(c, 'open_checks') ?? ''}>{outN}</span>}
          hint={outN ? t('عليها {m} لم تُدفع بعد', { m: money(mv(c, 'open_amount') ?? '0') }) : undefined} />}
      </StatGrid>
      {h?.hourly && (
        <div className="grid xl:grid-cols-[1.5fr_1fr] gap-4">
          <Card title={t('المبيعات على مدار اليوم')} actions={<SourceLink src={h.hourly.source} fb="home:source:hourly" />} data-fb="home:card:hourly">
            <HourChart today={hourly.today} yday={hourly.yday} lastWeek={hourly.lastWeek} hour={h.hour} />
          </Card>
          <Card title={t('آخر 14 يومًا')} actions={<SourceLink src={h.days?.source} fb="home:source:days" />} data-fb="home:card:days">
            <DaysChart items={(h.days?.rows ?? []).map((x: any) => ({ businessDate: x.date, netSales: x.value ?? '0' }))} />
            <TodayBreakdown cards={c} />
          </Card>
        </div>
      )}
      {(h?.paymentMix || h?.topItems) && (
        <div className="grid xl:grid-cols-2 gap-4">
          {h.paymentMix && <Card title={t('طرق الدفع')} actions={<SourceLink src={h.paymentMix.source} fb="home:source:payments" />} data-fb="home:card:payments"><PaymentMix mix={h.paymentMix} /></Card>}
          {h.topItems && <Card title={t('الأصناف الأعلى مبيعًا')} actions={<SourceLink src={h.topItems.source} fb="home:source:top-items" />} data-fb="home:card:top-items"><TopItems top={h.topItems} /></Card>}
        </div>
      )}
      {home.error && <Banner tone="warning">{t('أرقام اليوم غير متاحة لهذا الحساب.')}<Tech> <span className="num text-xs">{home.error.code}</span></Tech></Banner>}
    </div>
  );
}

const BREAKDOWN: [string, string][] = [['service', 'الخدمة'], ['tax', 'الضريبة'], ['discounts', 'الخصومات'], ['refunded', 'المرتجعات المصروفة']];
function TodayBreakdown({ cards }: { cards: any }) {
  const open = useOpenReport();
  const shown = BREAKDOWN.filter(([k]) => cards[k]);
  if (!shown.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t line">
      {shown.map(([k, label]) => (
        <button type="button" key={k} className="min-w-0 text-start rounded-lg hover:surface-1 px-1" data-fb={`home:kpi:${k}`} onClick={() => open(cards[k].source)}>
          <div className="text-[11px] text-dim truncate">{t(label)}</div>
          <div className="text-sm"><Money v={mv(cards, k) ?? '0'} /></div>
        </button>
      ))}
    </div>
  );
}

function PaymentMix({ mix }: { mix: any }) {
  const rows: any[] = mix.rows.filter((r: any) => r.value !== null);
  if (!rows.length) return <div className="text-sm text-dim py-6 text-center" data-fb="home:payments:empty">{t('لا مدفوعات اليوم')}</div>;
  const total = D(mix.total ?? '0');
  return (
    <div className="space-y-2" data-fb="home:payments">
      {rows.map((r) => {
        const pct = total.isZero() ? 0 : Number(D(r.value).div(total).times(100).toFixed(1));
        return (
          <div key={r.method} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm" data-method={r.method} data-value={r.value}>
            <span className="truncate">{L(r.label)}</span>
            <span className="h-2 rounded-full surface-2 overflow-hidden"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} /></span>
            <span className="flex items-baseline gap-2 justify-end"><Money v={r.value} /><span className="num text-[11px] text-dim w-12 text-end">{pct.toFixed(1)}%</span></span>
          </div>
        );
      })}
      <div className="flex items-center justify-between border-t line pt-2 text-sm font-bold"><span>{t('الإجمالي')}</span><Money v={mix.total ?? '0'} /></div>
    </div>
  );
}

function TopItems({ top }: { top: any }) {
  const rows: any[] = top.rows;
  if (!rows.length) return <div className="text-sm text-dim py-6 text-center" data-fb="home:top-items:empty">{t('لا مبيعات اليوم')}</div>;
  return (
    <ol className="space-y-1.5" data-fb="home:top-items">
      {rows.map((r, i) => (
        <li key={r.product} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-3 text-sm" data-product={r.product} data-value={r.net}>
          <span className="num text-dim text-center">{i + 1}</span>
          <span className="truncate">{L(r.label)}</span>
          <span className="num text-dim text-xs">{r.qty == null ? '—' : qty(r.qty)}</span>
          <Money v={r.net ?? '0'} />
        </li>
      ))}
    </ol>
  );
}

function HourChart({ today, yday, lastWeek, hour }: { today: Hourly | null; yday: Hourly | null; lastWeek: Hourly | null; hour: number }) {
  const [hover, setHover] = useState<number | null>(null);
  // amounts stay Decimal strings (tooltip); Number() only places points on the chart
  const tStr = (today?.cumNet ?? []).slice(0, HOUR_IDX(hour) + 1), yStr = yday?.cumNet ?? [], wStr = lastWeek?.cumNet ?? [];
  const tSeries = tStr.map(n), ySeries = yStr.map(n), wSeries = wStr.map(n);
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
        {hi < tSeries.length && <div className="flex justify-between gap-3"><span className="text-[var(--primary)]">{t('النهارده')}</span><span className="num">{money(tStr[hi], false)}</span></div>}
        <div className="flex justify-between gap-3"><span className="text-[var(--chart-2,#fbbf24)]">{t('امبارح')}</span><span className="num">{money(yStr[hi] ?? '0', false)}</span></div>
        <div className="flex justify-between gap-3"><span className="text-[var(--chart-3,#a78bfa)]">{t('الأسبوع اللي فات')}</span><span className="num">{money(wStr[hi] ?? '0', false)}</span></div>
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
      {hi && <div className="absolute top-0 left-2 rounded-lg glass-strong px-3 py-1.5 text-xs pointer-events-none" dir="rtl"><b>{dayLabel(hi.businessDate)}</b><div><Money v={hi.netSales} plain /></div></div>}
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
    <Card title={<span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />{t('الشغل دلوقتي')}</span>}>
      {!anyLoaded ? <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div> : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
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
            sub={sessions.items.length ? sessions.items.slice(0, 2).map((s) => personName(null, personText(s.cashierName))).join(t('، ')) : t('مفيش درج مفتوح — الكاشير يفتح وردية الأول')} />}
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
  const { can } = useDev();
  const devs = useList<any>(can('device:read') ? 'Device.List' : null); // ux-14

  const alerts: Alert[] = [];
  const pending = approvals.data?.pending ?? 0;
  if (pending) alerts.push({ id: 'approvals', tone: 'warning', icon: <BellRing className="w-4 h-4" />, title: t('{n} طلب موافقة مستنيك', { n: pending }), text: t('موظفين طالبين موافقة مدير من جهاز تاني.'), screen: 'approvals-inbox', cta: t('راجع') });
  const out = low.items.filter((x) => x.state === 'OUT' || n(x.onHand) <= 0).length;
  if (low.items.length) alerts.push({ id: 'low', tone: out ? 'error' : 'warning', icon: <PackageMinus className="w-4 h-4" />, title: t('{n} خامة تحت الحد الأدنى', { n: low.items.length }), text: (out ? t('{o} خلصت خالص. ', { o: out }) : '') + low.items.slice(0, 3).map((x) => L(x.item?.name) || x.item?.name).filter(Boolean).join(t('، ')), screen: 'inv-dashboard', cta: t('اطلب') });
  if (expiring.items.length) alerts.push({ id: 'expiring', tone: 'warning', icon: <Hourglass className="w-4 h-4" />, title: t('{n} دفعة صلاحيتها بتخلص خلال 3 أيام', { n: expiring.items.length }), text: t('استخدمها الأول أو سجلها هالك.'), screen: 'inv-dashboard', cta: t('اعرض') });
  const rejected = fiscal.items.filter((d) => d.state === 'REJECTED' || d.state === 'PENDING_DATA').length;
  const nearDeadline = fiscal.items.filter((d) => d.alert).length;
  if (rejected || nearDeadline) alerts.push({ id: 'fiscal', tone: nearDeadline ? 'error' : 'warning', icon: <FileWarning className="w-4 h-4" />, title: t('{n} إيصال إلكتروني محتاج تدخل', { n: rejected || nearDeadline }), text: nearDeadline ? t('{h} منهم قربوا من مهلة الـ 24 ساعة. البيع ماشي عادي.', { h: nearDeadline }) : t('مرفوض أو ناقصه بيانات — البيع ماشي عادي.'), screen: 'ereceipts', cta: t('افتح') });
  if (prints.items.length) alerts.push({ id: 'prints', tone: prints.items.some((j) => j.state === 'DEAD') ? 'error' : 'warning', icon: <Printer className="w-4 h-4" />, title: t('{n} أمر طباعة ما طبعش', { n: prints.items.length }), text: t('شوف الطابعة واضغط «إعادة» من طابور الطباعة.'), screen: 'prints', cta: t('افتح') });
  const sick = devs.items.filter((d) => d.status === 'OFFLINE' || d.status === 'PAPER_OUT' || d.status === 'ERROR');
  if (sick.length) alerts.push({ id: 'devices', tone: 'error', icon: <Printer className="w-4 h-4" />, title: t('{n} جهاز يحتاج انتباهًا', { n: sick.length }), text: sick.slice(0, 3).map((d) => tv(d.name)).join(t('، ')), screen: 'devices', cta: t('افتح') }); // ux-14
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
        {list.map((d) => {
          const Icon = d.icon;
          return (
            <button key={d.id} type="button" onClick={() => nav(d.id)} data-fb={`home:link:${d.id}`} className="flex items-center gap-2 rounded-xl surface-1 hover:surface-2 border line px-3 h-12 text-sm text-start min-w-0 transition-colors">
              <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-to-br text-slate-900 shrink-0', d.gradient)}><Icon className="w-4 h-4" /></span>
              <span className="truncate">{lang === 'ar' ? t(d.title) : d.titleEn}</span>
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
  const sales = useQuery<any>(bd ? 'Report.Query' : null, { query: { q: JSON.stringify({ metrics: ['check_count'], from: bd, to: bd }) } });

  return useMemo(() => {
    const known = (...qs: { data: any; error: any }[]) => qs.every((q) => q.data && !q.error);
    const activeTerms = terms.items.filter((x) => x.lifecycle === 'ACTIVE');
    const kinds = new Set(activeTerms.map((x) => x.kind));
    const catchAll = rules.items.some((r) => r.active && !r.match?.productId && !r.match?.categoryId && !r.match?.channel);
    const orderCount = sales.data?.totals?.check_count?.value;
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
      { screen: 'stations', title: t('المحطات والتوجيه'), status: known(stations, rules) ? stations.items.length > 0 && catchAll : null,
        detail: t('{s} محطة · {r} قاعدة توزيع{c}', { s: stations.items.length, r: rules.items.length, c: catchAll ? '' : ' — ' + t('ناقصة قاعدة «أي حاجة تانية»') }) },
      // ux-07: tables are created and drawn in one place
      { screen: 'floorplan', title: t('خريطة الصالة والترابيزات'), status: known(tables) ? tables.items.length > 0 : null, detail: t('{n} ترابيزة', { n: tables.items.length }) },
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
    </Card>
  );
}
