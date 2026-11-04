// Delivery board (dispatch): columns by status, assign / dispatch / deliver / fail / cancel, late highlighting,
// and a simple map with the zones, the drivers and the open orders (simulated GPS).
import React, { useEffect, useRef, useState } from 'react';
import { Bike, PhoneCall, ChefHat, Clock, Map as MapIcon, LayoutGrid, Navigation, Globe, Banknote, List as ListIcon, ClipboardList, Send } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { call } from '../../api/client';
import { PageHeader, StateBadge, Button, Pill, EmptyState, SegmentedControl, Money, Card, Switch, useNow, Table, Popup, confirmDialog } from '../../ui';
import { t } from '../../i18n';
import { cn, time } from '../../lib/format';
import { sign } from '../../lib/cash';
import { clock } from '../../mock/clock';
import { STATE, KITCHEN, PAYMENT_MODE, DRIVER_STATUS, Eta, MiniMap, DeliveryDetail, DeliveryDetailBody, VehicleIcon, RiderButton, RiderList, CompleteDialog, StatePill } from './common';
import { addressText } from '../customers/common';
import { Board, FRESH, type Aging, type ColumnDef, type MoveCheck, type CardAction } from '../../ui/board';
import { useBoardView } from '../../app/useBoardView';
import { usePendingMove, AgeChip } from '../boards/common';

export default function DeliveryBoardScreen() {
  const { view, setView } = useBoardView('delivery');
  const [mode, setMode] = useState<'board' | 'list' | 'map'>(view);
  useEffect(() => { setMode((m) => (m === 'map' ? m : view)); }, [view]);
  const pick = (v: 'board' | 'list' | 'map') => { setMode(v); if (v !== 'map') setView(v); };
  return <DeliveryBoard mode={mode} onMode={pick} />;
}

const DL_STAGE = (d: any): string | null => {
  if (d.state === 'DELIVERED' || d.state === 'CANCELLED') return 'done';
  if (d.state === 'ASSIGNED' || d.state === 'PICKED_UP') return 'rider';
  if (d.state === 'FAILED') return 'ready';
  if (d.state !== 'PENDING') return null;
  const k = d.kitchen?.state;
  return k === 'READY' || k === 'HANDED' ? 'ready' : k === 'COOKING' ? 'cooking' : 'new';
};
export const deliveryStage = DL_STAGE;
export const deliveryAging = (d: any, now: number): Aging => {
  const st = DL_STAGE(d);
  if (st === 'done') return { ...FRESH, timer: d.state === 'DELIVERED' ? time(d.deliveredAt) : t('ملغى') };
  const left = Math.round((d.promisedAtMs - now) / 60000);
  const heat = d.late ? 3 : left <= 5 || d.readyWaiting ? 2 : left <= 12 ? 1 : 0;
  return { heat: heat as 0 | 1 | 2 | 3, late: !!d.late, timer: left >= 0 ? t('باقي {n} د', { n: left }) : t('تأخر {n} د', { n: -left }), title: `${t('الوصول المتوقع')} ${time(d.promisedAt)}` };
};
const unpaid = (d: any) => !!d.order && sign(d.order.remaining) > 0;

/** The board columns and moves of a delivery (shared by the dispatch board and the cashier's delivery mode). */
export function useDeliveryBoardDefs() {
  const { can } = useDev();
  const { run } = useCommand();
  const rider = usePendingMove<any>();
  const complete = usePendingMove<any>();
  const columns: ColumnDef[] = [
    { id: 'new', title: t('جديد'), tone: 'primary' },
    { id: 'cooking', title: t('قيد التحضير'), tone: 'warning' },
    { id: 'ready', title: t('جاهز للخروج'), tone: 'success' },
    { id: 'rider', title: t('مع الطيار'), tone: 'info' },
    { id: 'done', title: t('المنتهية اليوم'), tone: 'neutral', collapsed: true, final: true },
  ];
  const canMove = (d: any, to: string): MoveCheck | null => {
    const from = DL_STAGE(d);
    if (from === to) return null;
    if (from === 'done') return { ok: false, reason: t('التوصيل انتهى — السجل لا يتغير') };
    if (to === 'new' || to === 'cooking' || (to === 'ready' && from !== 'rider')) return { ok: false, reason: t('حالة التحضير يحدّثها المطبخ') };
    if (to === 'ready') return { ok: false, reason: t('لا يمكن سحب الطلب من الطيار — غيّر الطيار من الكارت') };
    if (to === 'rider') {
      if (!can('delivery:assign')) return { ok: false, reason: t('لا تملك صلاحية تعيين الطيار') };
      if (d.order?.status === 'DRAFT') return { ok: false, reason: t('لم يُرسل الطلب للمطبخ بعد') };
      return { ok: true, label: t('اختيار الطيار') };
    }
    if (to === 'done') {
      if (!can('delivery:complete')) return { ok: false, reason: t('لا تملك صلاحية تأكيد التسليم') };
      if (d.state !== 'PICKED_UP') return { ok: false, reason: from === 'rider' ? t('سجّل خروج الطلب أولًا') : t('الطلب لم يخرج مع طيار بعد') };
      return { ok: true, label: unpaid(d) ? t('تحصيل وتسليم') : t('تأكيد التسليم') };
    }
    return { ok: false };
  };
  const onMove = async (d: any, to: string) => {
    if (to === 'rider') return rider.ask(d);
    if (to === 'done') {
      if (unpaid(d)) return complete.ask(d);
      return !!(await run('Delivery.Complete', { params: { deliveryId: d.id }, body: { expectedVersion: d.version } }, { success: t('تم التسليم للعميل'), refId: d.id }));
    }
    return false;
  };
  const dispatch = async (d: any) => {
    if (!(d.kitchen?.state === 'READY' || d.kitchen?.state === 'HANDED') && !(await confirmDialog(t('لم ينتهِ المطبخ من هذا الطلب. إخراجه الآن؟')))) return;
    await run('Delivery.Dispatch', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, toState: 'PICKED_UP' } }, { success: t('خرج الطلب مع الطيار'), refId: d.id });
  };
  const popups = (
    <>
      {rider.open && (
        <Popup open onClose={() => rider.done(false)} size="sm" title={<span>{t('اختيار الطيار')} · <span className="num">{rider.open.number}</span></span>} fb="rider-popup">
          <RiderList d={rider.open} onDone={(ok) => ok && rider.done(true)} />
        </Popup>
      )}
      {complete.open && <CompleteDialog d={complete.open} onClose={() => complete.done(false)} onSuccess={() => complete.done(true)} />}
    </>
  );
  return { columns, canMove, onMove, dispatch, popups };
}

export function DeliveryCardBody({ d, compact, a }: { d: any; compact: boolean; a: Aging }) {
  const PM = PAYMENT_MODE[d.paymentMode];
  return (
    <div className="space-y-1.5" data-fb={`delivery:${d.number}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-sm truncate">{d.customerName || t('عميل')}</div>
          <div className="text-[11px] text-dim"><span className="num">{d.number}</span> · <span className="num">#{d.orderNumber}</span> · {d.zoneName}</div>
        </div>
        <AgeChip a={a} />
      </div>
      {!compact && <div className="text-xs text-soft line-clamp-1">{addressText(d.address, false)}</div>}
      <div className="flex items-center gap-1 flex-wrap">
        {d.state === 'PENDING' && d.kitchen?.state && <Pill size="sm" tone={KITCHEN[d.kitchen.state]?.tone ?? 'neutral'}><ChefHat className="w-3 h-3" />{t(KITCHEN[d.kitchen.state]?.ar ?? '')}</Pill>}
        {d.state === 'PICKED_UP' && <Pill size="sm" tone="violet">{t('في الطريق')}</Pill>}
        {d.state === 'CANCELLED' && <Pill size="sm" tone="neutral">{t('ملغى')}</Pill>}
        {d.readyWaiting && <Pill size="sm" tone="warning"><Clock className="w-3 h-3" />{t('جاهز بلا طيار')}</Pill>}
        {d.attempts?.length > 0 && d.state === 'FAILED' && <Pill size="sm" tone="error">{t('محاولة فاشلة')} {d.attempts.length}</Pill>}
        {d.sourceLabel && <Pill size="sm" tone="info">{d.sourceLabel}</Pill>}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1 text-dim min-w-0 truncate">{PM && <PM.icon className="w-3.5 h-3.5 shrink-0" />}{t(PM?.ar ?? '')}</span>
        {unpaid(d) ? <span className="font-bold text-[var(--warning-text)] whitespace-nowrap">{t('للتحصيل')} <Money v={d.order.remaining} className="text-xs" /></span> : <span className="text-[var(--success)] font-bold">{t('مدفوع')}</span>}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap"><RiderButton d={d} />{d.cod && !d.cod.settled && d.state === 'DELIVERED' && <span className="text-[11px] text-[var(--warning-text)] inline-flex items-center gap-1"><Banknote className="w-3 h-3" />{t('المبلغ مع الطيار')}</span>}</div>
    </div>
  );
}

export function deliveryCardActions(d: any, ctx: { can: (p: string) => boolean; dispatch: (d: any) => void; openCheck?: (d: any) => void }): CardAction[] {
  const out: CardAction[] = [];
  if (ctx.openCheck && d.orderId) out.push({ id: 'open-check', label: t('فتح الشيك'), icon: <ClipboardList className="w-4 h-4" />, onSelect: () => ctx.openCheck!(d) });
  if (d.state === 'ASSIGNED') out.push({ id: 'dispatch', label: t('خروج الطلب'), icon: <Send className="w-4 h-4" />, onSelect: () => ctx.dispatch(d), disabled: !ctx.can('delivery:dispatch'), reason: t('لا تملك صلاحية إخراج الطلب'), tone: 'primary' });
  return out;
}

function DeliveryBoard({ mode, onMode }: { mode: 'board' | 'list' | 'map'; onMode: (v: 'board' | 'list' | 'map') => void }) {
  useNow(15000);
  const { nav, can, me } = useDev();
  const board = useQuery<any>('Delivery.Board', { query: { scope: 'active' } });
  const zones = useQuery<any>('DeliveryZone.List', { query: {} });
  const drivers = useQuery<any>('Driver.List', { query: {} });
  const inbox = useQuery<any>(can('channel:manage') ? 'ExternalOrder.Find' : null, { query: { state: 'NEW', limit: 1 } });
  const [open, setOpen] = useState<string | null>(null);
  const defs = useDeliveryBoardDefs();
  const list: any[] = board.data?.items ?? [];
  const newOnline = inbox.data?.counts?.NEW ?? 0;
  const now = clock.now();
  const freeRiders = (drivers.data?.items ?? []).filter((x: any) => x.onShift && x.status === 'AVAILABLE').length;
  const columns = defs.columns.map((c) => (c.id === 'ready' && drivers.data ? { ...c, wip: freeRiders } : c));
  const zoneNames = [...new Set(list.map((d) => d.zoneName).filter(Boolean))] as string[];
  const modeSwitch = <SegmentedControl size="sm" value={mode} onChange={onMode} options={[{ id: 'board', label: t('لوحة'), icon: <LayoutGrid />, fb: 'view:board' }, { id: 'list', label: t('قائمة'), icon: <ListIcon />, fb: 'view:list' }, { id: 'map', label: t('الخريطة'), icon: <MapIcon />, fb: 'dl-view:map' }]} />;
  const actionsEnd = <>
    {newOnline > 0 && <Button size="sm" variant="warning" onClick={() => nav('online-orders')} data-fb="go-inbox"><Globe className="w-4 h-4" />{t('طلبات إلكترونية جديدة')} ({newOnline})</Button>}
    {can('delivery:create') && <Button size="sm" variant="primary" onClick={() => nav('delivery-new')} data-fb="new-delivery"><PhoneCall className="w-4 h-4" />{t('طلب دليفري جديد')}</Button>}
    {modeSwitch}
  </>;
  if (mode === 'board') {
    return (
      <div data-screen="DL2" className="h-full flex flex-col gap-3 min-h-0" data-fb="delivery-board">
        <Board id="delivery" title={t('لوحة الدليفري')} userId={me?.user?.id} items={board.data ? list : null} itemKey={(d: any) => d.id} columns={columns} columnOf={DL_STAGE} aging={(d) => deliveryAging(d, now)} amount={(d: any) => d.amount}
          search={(d: any) => `${d.number} ${d.orderNumber} ${d.customerName ?? ''} ${d.phone ?? ''} ${d.zoneName ?? ''} ${d.driver?.name ?? ''}`} searchPlaceholder={t('رقم الطلب أو الهاتف أو الاسم')}
          filters={[
            { id: 'late', label: t('متأخر'), test: (d: any) => !!d.late },
            { id: 'norider', label: t('بلا طيار'), test: (d: any) => !d.driverId && (d.state === 'PENDING' || d.state === 'FAILED') },
            { id: 'collect', label: t('للتحصيل'), test: (d: any) => unpaid(d) },
            ...zoneNames.map((z) => ({ id: `zone:${z}`, label: z, group: 'zone', test: (d: any) => d.zoneName === z })),
          ]}
          timeBuckets={{ columns: [{ id: 't:late', title: t('متأخر'), tone: 'error' }, { id: 't:now', title: t('الآن'), tone: 'warning' }, { id: 't:hour', title: t('خلال ساعة'), tone: 'info' }, { id: 't:later', title: t('لاحقًا'), tone: 'neutral' }], of: (d: any) => { if (d.late) return 't:late'; const left = (d.promisedAtMs - now) / 60000; return left <= 10 ? 't:now' : left <= 60 ? 't:hour' : 't:later'; } }}
          sort={(a: any, b: any) => a.promisedAtMs - b.promisedAtMs}
          canMove={defs.canMove} onMove={defs.onMove}
          cardActions={(d) => deliveryCardActions(d, { can, dispatch: defs.dispatch })}
          cardLabel={(d: any) => `${d.number} · ${d.customerName ?? ''}`}
          renderCard={(d: any, c) => <DeliveryCardBody d={d} compact={c.compact} a={c.aging} />}
          renderDetail={(d: any, close) => <DeliveryDetailBody id={d.id} onClose={close} stacked />}
          toolbarEnd={actionsEnd} />
        {defs.popups}
      </div>
    );
  }
  return (
    <div data-screen="DL2" className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader className="!mb-0" title={t('لوحة الدليفري')} ops={['Delivery.Board', 'Delivery.Assign', 'Delivery.Dispatch', 'Delivery.Complete', 'Delivery.FailAttempt', 'Delivery.Cancel']} actions={actionsEnd} />
      {mode === 'list' ? (
        <Table loading={board.loading && !board.data} onRowClick={(i) => setOpen(list[i].id)} maxHeight="calc(100vh - 230px)"
          head={[t('الرقم'), t('العميل'), t('المنطقة'), t('الحالة'), t('الطيار'), t('الوصول المتوقع'), t('القيمة')]} align={['start', 'start', 'start', 'start', 'start', 'start', 'end']}
          rows={list.map((d) => [<span className="num font-bold">{d.number}</span>, <span className="font-bold">{d.customerName}</span>, d.zoneName, <StatePill s={d.state} />, <RiderButton d={d} />, <Eta d={d} />, <Money v={d.amount} />])}
          empty={<EmptyState compact icon={<Bike />} title={t('لا توجد طلبات دليفري')} action={can('delivery:create') && <Button variant="primary" onClick={() => nav('delivery-new')}><PhoneCall className="w-4 h-4" />{t('طلب دليفري جديد')}</Button>} />} />
      ) : (
        <MapView zones={zones.data?.items ?? []} drivers={drivers.data?.items ?? []} deliveries={list} restaurant={zones.data?.restaurant} onOpen={setOpen} />
      )}
      {open && <DeliveryDetail id={open} onClose={() => setOpen(null)} />}
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
