// Delivery board (dispatch): columns by status, assign / dispatch / deliver / fail / cancel, late highlighting,
// and a simple map with the zones, the drivers and the open orders (simulated GPS).
import React, { useEffect, useRef, useState } from 'react';
import { Bike, PhoneCall, ChefHat, AlertTriangle, Clock, Map as MapIcon, LayoutGrid, Navigation, Globe, Banknote } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { call } from '../../api/client';
import { Section, StateBadge, Button, Pill, Empty, Tabs, Money, Card, Switch, useNow } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { STATE, KITCHEN, PAYMENT_MODE, DRIVER_STATUS, Eta, MiniMap, DeliveryActions, DeliveryDetail, VehicleIcon } from './common';
import { addressText } from '../customers/common';

const COLS: { id: string; title: string; filter: (d: any) => boolean; tone: string }[] = [
  { id: 'kitchen', title: 'في المطبخ', filter: (d) => d.state === 'PENDING' && d.kitchen?.state !== 'READY', tone: 'border-cyan-400/50' },
  { id: 'ready', title: 'جاهز للخروج', filter: (d) => d.state === 'PENDING' && d.kitchen?.state === 'READY', tone: 'border-emerald-400/60' },
  { id: 'assigned', title: 'مع الطيار', filter: (d) => d.state === 'ASSIGNED', tone: 'border-sky-400/50' },
  { id: 'road', title: 'في الطريق', filter: (d) => d.state === 'PICKED_UP', tone: 'border-purple-400/60' },
  { id: 'failed', title: 'محاولة فشلت', filter: (d) => d.state === 'FAILED', tone: 'border-red-400/60' },
  { id: 'done', title: 'خلص النهارده', filter: (d) => d.state === 'DELIVERED' || d.state === 'CANCELLED', tone: 'border-[var(--glass-border)]' },
];

export default function DeliveryBoard() {
  useNow(15000);
  const { nav, can } = useDev();
  const board = useQuery<any>('Delivery.Board', { query: { scope: 'active' } });
  const zones = useQuery<any>('DeliveryZone.List', { query: {} });
  const drivers = useQuery<any>('Driver.List', { query: {} });
  const inbox = useQuery<any>(can('channel:manage') ? 'ExternalOrder.Find' : null, { query: { state: 'NEW', limit: 1 } });
  const [view, setView] = useState<'board' | 'map'>('board');
  const [open, setOpen] = useState<string | null>(null);
  const list: any[] = board.data?.items ?? [];
  const s = board.data?.summary;
  const grace = board.data?.rules?.graceMinutes ?? 10;
  const newOnline = inbox.data?.counts?.NEW ?? 0;
  return (
    <div data-screen="DL2" className="h-full flex flex-col gap-3 min-h-0">
      <Section title={t('لوحة الدليفري')} badge={<StateBadge ops={['Delivery.Board', 'Delivery.Assign', 'Delivery.Dispatch', 'Delivery.Complete', 'Delivery.FailAttempt', 'Delivery.Cancel']} />}
        sub={t('كل طلبات التوصيل المفتوحة: من المطبخ لحد ما توصل للعميل. الطلب بيبقى متأخر لو عدّى الوقت المتوقع + {g} دقيقة سماح.', { g: grace })}
        actions={<>
          {newOnline > 0 && <Button variant="warning" onClick={() => nav('online-orders')} data-fb="go-inbox"><Globe className="w-4 h-4" />{t('طلبات أونلاين جديدة')} ({newOnline})</Button>}
          {can('delivery:create') && <Button variant="primary" onClick={() => nav('delivery-new')} data-fb="new-delivery"><PhoneCall className="w-4 h-4" />{t('طلب دليفري جديد')}</Button>}
          <Tabs value={view} onChange={setView} tabs={[{ id: 'board', label: <span className="flex items-center gap-1"><LayoutGrid className="w-4 h-4" />{t('اللوحة')}</span> }, { id: 'map', label: <span className="flex items-center gap-1"><MapIcon className="w-4 h-4" />{t('الخريطة')}</span> }]} />
        </>} />
      {s && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
          <Stat label={t('في المطبخ / جديد')} v={s.pending} />
          <Stat label={t('جاهز ومستني طيار')} v={s.readyWaiting} tone={s.readyWaiting ? 'warning' : undefined} hint={t('أكتر من {m} دقيقة', { m: board.data?.rules?.readyWaitMinutes ?? 10 })} />
          <Stat label={t('مع الطيارين')} v={s.onRoad} />
          <Stat label={t('متأخر')} v={s.late} tone={s.late ? 'error' : undefined} />
          <Stat label={t('محاولات فشلت')} v={s.failed} tone={s.failed ? 'error' : undefined} />
          <Stat label={t('اتسلّم النهارده')} v={s.delivered} tone="success" />
        </div>
      )}
      {view === 'board' && !board.loading && !list.length ? (
        <Empty icon={<Bike className="w-12 h-12" />} text={t('مفيش طلبات دليفري مفتوحة دلوقتي')}>{can('delivery:create') && <Button variant="primary" onClick={() => nav('delivery-new')}><PhoneCall className="w-4 h-4" />{t('ابدأ طلب دليفري')}</Button>}</Empty>
      ) : view === 'board' ? (
        <div className="flex-1 min-h-0 grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: 'repeat(6, minmax(230px, 1fr))' }}>
          {COLS.map((c) => {
            const items = list.filter(c.filter);
            return (
              <div key={c.id} className={cn('rounded-2xl border-t-4 surface-1 flex flex-col min-h-0', c.tone)} data-fb={`col:${c.id}`}>
                <div className="px-3 py-2 font-bold flex items-center justify-between text-sm">{t(c.title)}<Pill tone="neutral">{items.length}</Pill></div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {items.map((d) => <DeliveryCard key={d.id} d={d} onOpen={() => setOpen(d.id)} />)}
                  {!items.length && <Empty text={t('مفيش')} />}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <MapView zones={zones.data?.items ?? []} drivers={drivers.data?.items ?? []} deliveries={list} restaurant={zones.data?.restaurant} onOpen={setOpen} />
      )}
      {open && <DeliveryDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Stat({ label, v, tone, hint }: { label: string; v: number; tone?: 'error' | 'warning' | 'success'; hint?: string }) {
  const c = tone === 'error' ? 'text-[var(--error)]' : tone === 'warning' ? 'text-[var(--warning)]' : tone === 'success' ? 'text-[var(--success)]' : '';
  return <div className="glass rounded-xl px-3 py-2" title={hint}><div className="text-[11px] text-dim">{label}</div><div className={cn('text-2xl font-bold num', c)}>{v}</div></div>;
}

function DeliveryCard({ d, onOpen }: { d: any; onOpen: () => void }) {
  const PM = PAYMENT_MODE[d.paymentMode];
  const unpaid = d.order && Number(d.order.remaining) > 0;
  return (
    <div data-fb={`delivery:${d.number}`} className={cn('rounded-xl glass p-2.5 space-y-1.5 border-2', d.late ? 'border-red-500/70 animate-pulse-glow' : d.readyWaiting ? 'border-amber-400/60' : 'border-transparent')}>
      <div className="flex items-start justify-between gap-2">
        <button onClick={onOpen} className="text-start min-w-0">
          <div className="font-bold text-sm truncate">{d.customerName || t('عميل')}</div>
          <div className="text-[11px] text-dim num">{d.number} · #{d.orderNumber}</div>
        </button>
        <Eta d={d} />
      </div>
      <div className="text-xs text-soft line-clamp-2">{d.zoneName} · {addressText(d.address, false)}</div>
      <div className="flex items-center gap-1 flex-wrap">
        {d.state === 'PENDING' && <Pill tone={KITCHEN[d.kitchen?.state]?.tone ?? 'neutral'}><ChefHat className="w-3 h-3" />{t(KITCHEN[d.kitchen?.state]?.ar ?? '')}</Pill>}
        {d.late && <Pill tone="error"><AlertTriangle className="w-3 h-3" />{t('متأخر')} {d.lateMinutes} {t('د')}</Pill>}
        {d.readyWaiting && <Pill tone="warning"><Clock className="w-3 h-3" />{t('جاهز ومستني')}</Pill>}
        {d.sourceLabel && <Pill tone="info">{d.sourceLabel}</Pill>}
        {d.attempts?.length > 0 && <Pill tone="error">{t('محاولة')} {d.attempts.length}: {L(d.reasonLabels?.at(-1))}</Pill>}
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1 text-dim">{PM && <PM.icon className="w-3.5 h-3.5" />}{t(PM?.ar ?? '')}</span>
        <span className="num font-bold">{unpaid ? <span className="text-[var(--warning)]">{t('يتحصّل')} {money(d.order.remaining)}</span> : <span className="text-[var(--success)]">{t('مدفوع')}</span>}</span>
      </div>
      {d.driver && <div className="text-xs flex items-center gap-1 text-[var(--info)]"><VehicleIcon v={d.driver.vehicle} className="w-3.5 h-3.5" />{d.driver.name}</div>}
      {d.cod && !d.cod.settled && d.state === 'DELIVERED' && <div className="text-[11px] text-[var(--warning)] flex items-center gap-1"><Banknote className="w-3 h-3" />{t('الفلوس لسه مع الطيار')}</div>}
      {d.order?.status === 'DRAFT' && <div className="text-[11px] text-[var(--warning)]">{t('الطلب لسه ما اتبعتش للمطبخ')}</div>}
      <DeliveryActions d={d} onOpen={onOpen} />
    </div>
  );
}

/** Simulated GPS: drivers on a trip move a step toward their destination zone every few seconds. */
function MapView({ zones, drivers, deliveries, restaurant, onOpen }: { zones: any[]; drivers: any[]; deliveries: any[]; restaurant?: { x: number; y: number }; onOpen: (id: string) => void }) {
  const { auth, can } = useDev();
  const [gps, setGps] = useState(false);
  const ref = useRef({ drivers, zones });
  ref.current = { drivers, zones };
  useEffect(() => {
    if (!gps) return;
    const i = setInterval(() => {
      const { drivers: ds, zones: zs } = ref.current;
      for (const d of ds.filter((x: any) => x.status === 'ON_TRIP' && x.location)) {
        const dest = d.active.find((a: any) => a.state === 'PICKED_UP');
        const z = zs.find((x: any) => x.id === dest?.zoneId);
        if (!z) continue;
        const tx = z.map.x + z.map.w / 2, ty = z.map.y + z.map.h / 2;
        const dx = tx - d.location.x, dy = ty - d.location.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 1) continue;
        const stepLen = Math.min(4, dist);
        call(auth, 'Driver.UpdateLocation', { params: { driverId: d.id }, body: { x: d.location.x + (dx / dist) * stepLen, y: d.location.y + (dy / dist) * stepLen } }).catch(() => undefined);
      }
    }, 2500);
    return () => clearInterval(i);
  }, [gps, auth]);
  return (
    <div className="flex-1 min-h-0 grid lg:grid-cols-[1fr_320px] gap-3">
      <Card className="min-h-0" title={<span className="flex items-center gap-2"><MapIcon className="w-4 h-4" />{t('الخريطة')}</span>} badge={<StateBadge ops={['DeliveryZone.List', 'Driver.List', 'Driver.UpdateLocation']} />}
        actions={can('delivery:dispatch') && <Switch checked={gps} onChange={setGps} label={<span className="flex items-center gap-1 text-xs"><Navigation className="w-3.5 h-3.5" />{t('محاكاة تحرك الطيارين')}</span>} />}>
        <MiniMap zones={zones} drivers={drivers} deliveries={deliveries} restaurant={restaurant} height={420} />
        <div className="flex gap-3 text-[11px] text-dim mt-2 flex-wrap">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />{t('متاح')}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#38bdf8]" />{t('معاه طلبات')}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#a855f7]" />{t('في مشوار')}</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />{t('طلب متأخر')}</span>
          <span>{t('المواقع تقريبية — مفيش خريطة حقيقية في النسخة دي.')}</span>
        </div>
      </Card>
      <div className="space-y-2 overflow-y-auto min-h-0">
        {drivers.filter((d) => d.onShift).map((d) => (
          <div key={d.id} className="glass rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2"><span className="font-bold flex items-center gap-1.5"><VehicleIcon v={d.vehicle} className="w-4 h-4 text-[var(--primary)]" />{d.name}</span><Pill tone={DRIVER_STATUS[d.status]?.tone}>{t(DRIVER_STATUS[d.status]?.ar)}</Pill></div>
            {d.active.map((a: any) => <button key={a.id} onClick={() => onOpen(a.id)} className="w-full text-start text-xs flex justify-between gap-2 rounded-lg surface-1 px-2 py-1"><span>{a.number} · {a.customerName} · {a.zoneName}</span><span className={cn('font-bold', a.late && 'text-[var(--error)]')}>{t(STATE[a.state]?.ar)}</span></button>)}
            <div className="text-[11px] text-dim flex justify-between"><span>{t('معاه كاش')}: <Money v={d.cashInHand} className="text-[11px]" /></span>{d.locationAgeMinutes !== null && <span>{t('آخر موقع من {m} د', { m: d.locationAgeMinutes })}</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
