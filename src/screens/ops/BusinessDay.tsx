// End of business day (EOD): readiness checklist (blockers vs warnings), the day's summary (sales, payments by method,
// voids / discounts / refunds, cash variance) and closing the day; the next business date starts at 04:00 Cairo.
import React, { useEffect, useState } from 'react';
import { Moon, CheckCircle2, XCircle, AlertTriangle, ChevronDown, ArrowLeft, CalendarDays, Lock, Receipt, Users, TrendingUp, Wallet, Ban, Percent, RotateCcw, Scale, HandCoins, Clock } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Card, Button, Pill, Banner, Money, Field, Input, Textarea, Table, Empty, Spinner, KV } from '../../ui';
import { t, L } from '../../i18n';
import { Tech } from '../../app/tech';
import { cn, money, dateTime } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';
import { store } from '../../mock/store';
import { branchLabel } from '../../demo/people';

export const METHOD_AR: Record<string, string> = { CASH: 'كاش', CARD: 'كارت', DIGITAL_WALLET: 'محفظة', DEPOSIT: 'عربون', 'DIGITAL_WALLET:INSTAPAY': 'إنستاباي', 'DIGITAL_WALLET:VODAFONE_CASH': 'فودافون كاش', 'DIGITAL_WALLET:ORANGE_CASH': 'أورنج كاش', 'DIGITAL_WALLET:ETISALAT_CASH': 'اتصالات كاش', LOYALTY: 'نقاط', LOYALTY_POINTS: 'نقاط' };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const dayName = (iso: string) => new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

export default function BusinessDay() {
  const { auth, me, nav } = useDev();
  const branch = store.db.branches.find((b) => b.id === (me?.branchId ?? auth.branchId));
  const today = businessDate(clock.now(), branch?.timezone, branch?.businessDayCutoff);
  const [date, setDate] = useState(today);
  const r = useQuery<any>('BusinessDay.Readiness', { params: { date } });
  const days = useQuery<any>('BusinessDay.Find', { query: { limit: 30 } });
  const d = r.data;
  return (
    <div className="space-y-4" data-screen="EOD">
      <Section title={t('قفل اليوم')} badge={<StateBadge ops={['BusinessDay.Readiness', 'BusinessDay.Close', 'BusinessDay.Find']} />}
        sub={t('اليوم التجاري بيبدأ الساعة 4 الفجر بتوقيت القاهرة وبيخلص 4 الفجر اللي بعده — البيع الساعة 2 بالليل تبع اليوم اللي قبله. القفل بيثبّت أرقام اليوم ويبعتها للحسابات.')}
        actions={<div className="flex items-end gap-2">
          <Button size="sm" variant={date === addDays(today, -1) ? 'outline' : 'ghost'} onClick={() => setDate(addDays(today, -1))}>{t('امبارح')}</Button>
          <Button size="sm" variant={date === today ? 'outline' : 'ghost'} onClick={() => setDate(today)}>{t('النهارده')}</Button>
          <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-44" data-fb="eod-date" />
        </div>} />
      {r.loading && !d && <Spinner />}
      {d && (
        <>
          <DayHeader d={d} />
          {d.closed ? <ClosedDay rec={d.closed} /> : (
            <div className="grid xl:grid-cols-[1.1fr_1fr] gap-4 items-start">
              <Readiness d={d} nav={nav} />
              <div className="space-y-4">
                <Summary s={d.summary} title={t('ملخص اليوم لحد دلوقتي')} />
                <ClosePanel d={d} />
              </div>
            </div>
          )}
        </>
      )}
      <Card title={<span className="flex items-center gap-2"><CalendarDays className="w-4 h-4" />{t('الأيام اللي اتقفلت')}</span>}>
        <Table head={[t('اليوم'), t('صافي المبيعات'), t('الشيكات'), t('متوسط الشيك'), t('فرق الدرج'), t('قفله'), t('بعد القفل'), '']}
          rows={(days.data?.items ?? []).map((x: any) => [
            <div><div className="font-bold">{dayName(x.date)}</div><div className="num text-[11px] text-dim">{x.date}</div></div>,
            <Money v={x.summary.netSales} />, <span className="num">{x.summary.orders}</span>, <Money v={x.summary.avgCheck} />,
            <Money v={x.summary.cashVariance} tone={Number(x.summary.cashVariance) === 0 ? 'success' : 'error'} />,
            <div className="text-xs">{x.closedByName}<div className="text-dim num">{dateTime(x.closedAt)}</div></div>,
            x.lateOrders ? <Pill tone="warning">{x.lateOrders} {t('شيك')}</Pill> : <span className="text-dim">—</span>,
            <Button size="sm" variant="ghost" onClick={() => setDate(x.date)}>{t('افتح')}</Button>,
          ])} empty={t('لسه مفيش أيام اتقفلت')} />
      </Card>
    </div>
  );
}

function DayHeader({ d }: { d: any }) {
  const isToday = d.date === d.currentBusinessDate;
  return (
    <div className="glass rounded-2xl p-4 flex items-center gap-4 flex-wrap" data-fb="eod-header">
      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-600 flex items-center justify-center text-white"><Moon className="w-7 h-7" /></div>
      <div className="flex-1 min-w-[220px]">
        <div className="text-2xl font-extrabold">{dayName(d.date)}</div>
        <div className="text-xs text-dim">{t('من')} <span className="num">{d.cutoff}</span> {t('يوم')} <span className="num">{d.date}</span> {t('لحد')} <span className="num">{d.cutoff}</span> {t('يوم')} <span className="num">{d.nextBusinessDate}</span> · {branchLabel(store.db.branches.find((b) => b.id === d.branchId) ?? { name: d.branchName })}</div>
      </div>
      {d.closed ? <Pill tone="success" className="text-sm"><Lock className="w-3.5 h-3.5" />{t('اليوم مقفول')}</Pill>
        : d.blockers ? <Pill tone="error" className="text-sm"><XCircle className="w-3.5 h-3.5" />{t('{n} حاجة لازم تخلص قبل القفل', { n: d.blockers })}</Pill>
          : <Pill tone="success" className="text-sm"><CheckCircle2 className="w-3.5 h-3.5" />{t('جاهز للقفل')}</Pill>}
      {isToday && !d.closed && <Pill tone="info"><Clock className="w-3 h-3" />{t('شغال دلوقتي')}</Pill>}
      <div className="text-xs text-dim">{t('اليوم التجاري الجاي')}: <b className="num text-soft">{d.nextBusinessDate}</b></div>
    </div>
  );
}

function Readiness({ d, nav }: { d: any; nav: (s: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const order = { BLOCKER: 0, WARNING: 1, OK: 2 } as Record<string, number>;
  const checks = [...d.checks].sort((a: any, b: any) => order[a.level] - order[b.level]);
  return (
    <Card title={<span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t('قبل ما تقفل')}</span>} actions={<div className="flex gap-1">{d.blockers > 0 && <Pill tone="error">{d.blockers} {t('لازم')}</Pill>}{d.warnings > 0 && <Pill tone="warning">{d.warnings} {t('تحذير')}</Pill>}</div>}>
      <div className="space-y-2" data-fb="eod-checklist">
        {checks.map((c: any) => {
          const Icon = c.level === 'BLOCKER' ? XCircle : c.level === 'WARNING' ? AlertTriangle : CheckCircle2;
          const tone = c.level === 'BLOCKER' ? 'text-[var(--error)]' : c.level === 'WARNING' ? 'text-[var(--warning)]' : 'text-[var(--success)]';
          const expandable = c.items?.length > 0;
          return (
            <div key={c.id} className={cn('rounded-xl border px-3 py-2', c.level === 'BLOCKER' ? 'border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_7%,transparent)]' : c.level === 'WARNING' ? 'border-[color-mix(in_srgb,var(--warning)_35%,transparent)]' : 'border-[var(--glass-border)] surface-1')} data-fb={`eod-check:${c.id}`} data-level={c.level}>
              <div className="flex items-center gap-2">
                <Icon className={cn('w-4 h-4 shrink-0', tone)} />
                <button className="flex-1 text-start min-w-0" onClick={() => expandable && setOpen(open === c.id ? null : c.id)}>
                  <div className="text-sm font-bold flex items-center gap-2">{L(c.title)}{c.level !== 'OK' && c.count > 0 && c.id !== 'CUTOFF' && c.id !== 'NOT_STARTED' && <span className="num text-xs px-1.5 rounded-full surface-2">{c.count}</span>}{expandable && <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open === c.id && 'rotate-180')} />}</div>
                  {c.level !== 'OK' && <div className="text-xs text-dim">{L(c.detail)}</div>}
                </button>
                {c.level !== 'OK' && c.screen && <Button size="sm" variant="ghost" onClick={() => nav(c.screen)}>{t('روح')}<ArrowLeft className="w-3.5 h-3.5" /></Button>}
              </div>
              {open === c.id && (
                <div className="mt-2 space-y-1 ps-6">
                  {c.items.map((it: any) => <div key={it.id} className="flex items-center justify-between text-xs gap-2"><span>{it.label}{it.sub ? <span className="text-dim"> · {it.sub}</span> : null}</span>{it.amount && <Money v={it.amount} />}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function Summary({ s, title }: { s: any; title: string }) {
  const pays = Object.entries(s.payments ?? {}) as [string, string][];
  const totalPay = pays.reduce((a, [, v]) => a + Number(v), 0) || 1;
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode) => <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim flex items-center gap-1">{icon}{label}</div><div className="text-lg font-extrabold mt-0.5">{value}</div></div>;
  return (
    <Card title={<span className="flex items-center gap-2"><TrendingUp className="w-4 h-4" />{title}</span>}>
      <div className="space-y-4" data-fb="eod-summary">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {kpi(<TrendingUp className="w-3 h-3" />, t('صافي المبيعات'), <Money v={s.netSales} />)}
          {kpi(<Receipt className="w-3 h-3" />, t('الشيكات'), <span className="num">{s.orders}</span>)}
          {kpi(<Wallet className="w-3 h-3" />, t('متوسط الشيك'), <Money v={s.avgCheck} />)}
          {kpi(<Users className="w-3 h-3" />, t('الضيوف'), <span className="num">{s.guests}</span>)}
        </div>
        <div>
          <div className="text-xs font-bold text-soft mb-1.5">{t('الفلوس اللي دخلت حسب الطريقة')}</div>
          {pays.length === 0 ? <div className="text-xs text-dim">{t('مفيش دفعات')}</div> : pays.map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 text-sm mb-1">
              <span className="w-20 shrink-0">{t(METHOD_AR[k] ?? k)}</span>
              <div className="flex-1 h-2.5 rounded-full surface-2 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-cyan-400 to-blue-600" style={{ width: `${(Number(v) / totalPay) * 100}%` }} /></div>
              <Money v={v} className="w-28 text-end" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          <Row icon={<Ban className="w-3.5 h-3.5" />} label={t('أصناف اتلغت بعد الإرسال')} v={<span><span className="num">{s.voidedLines}</span> · <Money v={s.voidedAmount} /></span>} />
          <Row icon={<Ban className="w-3.5 h-3.5" />} label={t('شيكات اتلغت')} v={<span className="num">{s.cancelledOrders + s.voidedOrders}</span>} />
          <Row icon={<Percent className="w-3.5 h-3.5" />} label={t('خصومات')} v={<span><span className="num">{s.discountCount}</span> · <Money v={s.discounts} /></span>} />
          <Row icon={<Percent className="w-3.5 h-3.5" />} label={t('ضيافة')} v={<span className="num">{s.comps}</span>} />
          <Row icon={<RotateCcw className="w-3.5 h-3.5" />} label={t('مرتجعات اتصرفت')} v={<span><span className="num">{s.refundCount}</span> · <Money v={s.refunds} /></span>} />
          <Row icon={<Scale className="w-3.5 h-3.5" />} label={t('فرق عد الأدراج')} v={<Money v={s.cashVariance} tone={Number(s.cashVariance) === 0 ? 'success' : 'error'} />} />
          <Row icon={<HandCoins className="w-3.5 h-3.5" />} label={t('البقشيش (مش مبيعات)')} v={<Money v={s.tips} />} />
          <Row icon={<Receipt className="w-3.5 h-3.5" />} label={t('الضريبة · الخدمة')} v={<span><Money v={s.tax} /> · <Money v={s.service} /></span>} />
        </div>
      </div>
    </Card>
  );
}
const Row = ({ icon, label, v }: { icon: React.ReactNode; label: string; v: React.ReactNode }) => <div className="flex items-center justify-between gap-2 border-b line py-1"><span className="text-soft flex items-center gap-1.5">{icon}{label}</span>{v}</div>;

function ClosePanel({ d }: { d: any }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [d.date]);
  const close = () => run('BusinessDay.Close', { params: { date: d.date }, body: { note: note || undefined, acknowledgeWarnings: d.warnings ? ack : undefined } }, { success: t('اليوم اتقفل — اليوم التجاري الجاي {n}', { n: d.nextBusinessDate }) });
  return (
    <Card title={<span className="flex items-center gap-2"><Lock className="w-4 h-4" />{t('اقفل اليوم')}</span>}>
      <div className="space-y-3">
        {d.blockers > 0 ? <Banner tone="error">{t('فيه حاجات لازم تخلص الأول (اللي باللون الأحمر). اضغط "روح" جنب كل واحدة.')}</Banner>
          : d.warnings > 0 ? <label className="flex items-start gap-2 text-sm cursor-pointer rounded-xl border px-3 py-2 border-[color-mix(in_srgb,var(--warning)_40%,transparent)]"><input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} data-fb="eod-ack" /><span>{t('شفت التحذيرات ({n}) وعايز أقفل برضه — هتتسجل مع القفل.', { n: d.warnings })}</span></label>
            : <Banner tone="success">{t('كله تمام — تقدر تقفل اليوم.')}</Banner>}
        <Field label={t('ملاحظة للحسابات (اختياري)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلاً: الكهربا قطعت ساعة')} /></Field>
        <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={d.blockers > 0 || (d.warnings > 0 && !ack)} onClick={close} data-fb="eod-close"><Moon className="w-5 h-5" />{t('اقفل يوم {d}', { d: d.date })}</Button>
        <div className="text-[11px] text-dim">{t('بعد القفل الأرقام بتتثبت وتتبعت لبرنامج الحسابات. لو حصل بيع قبل 4 الفجر هيتسجل على نفس اليوم ويظهر "بعد القفل".')}</div>
      </div>
    </Card>
  );
}

function ClosedDay({ rec }: { rec: any }) {
  return (
    <div className="grid xl:grid-cols-[1fr_1.1fr] gap-4 items-start">
      <Card title={<span className="flex items-center gap-2"><Lock className="w-4 h-4" />{t('اتقفل')}</span>}>
        <div className="space-y-3" data-fb="eod-closed">
          <KV rows={[[t('قفله'), rec.closedByName], [t('إمتى'), dateTime(rec.closedAt)], [t('اليوم التجاري الجاي'), <span className="num">{rec.nextBusinessDate}</span>], [t('تحذيرات اتشافت'), rec.warningsAcknowledged?.length ? rec.warningsAcknowledged.length : t('مفيش')]]} />
          {rec.note && <Banner tone="info">{rec.note}</Banner>}
          {rec.lateOrders > 0 && <Banner tone="warning">{t('{n} شيك اتقفل بعد قفل اليوم (قبل 4 الفجر) — بيظهروا في تقرير اليوم ده كـ"بعد القفل".', { n: rec.lateOrders })}</Banner>}
          <Tech><div className="num text-[10px] text-dim">{rec.branchId}:{rec.date} · v{rec.version}</div></Tech>
        </div>
      </Card>
      <Summary s={rec.summary} title={t('أرقام اليوم (متثبتة)')} />
    </div>
  );
}

export { money };
