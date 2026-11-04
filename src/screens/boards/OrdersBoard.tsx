// Orders board (ux-05): every live check of the branch by its state — open (not sent), in the kitchen, ready, waiting
// for payment, closed today. Reads Order.Find (the same read as the checks list). Moves are the order owner's commands:
// send to the kitchen (Order.Fire) and confirm for payment (Order.Confirm); the kitchen moves its own states and
// closing happens by paying, so those drops are refused with the reason.
import React, { useMemo } from 'react';
import { ClipboardList, Wallet, Receipt, ChefHat, Users } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Board, BoardViewToggle, heatOf, minutesSince, FRESH, type ColumnDef, type MoveCheck, type Aging, type CardAction } from '../../ui/board';
import { Money, Pill, Button, KV } from '../../ui';
import { t, L } from '../../i18n';
import { qty, time, money } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';
import { personName } from '../../demo/people';
import { useBoardRules, AgeChip, mins } from './common';
import { StatusPill } from '../order/CheckPanel';
import { useCollect } from '../cashier/PaymentPopup';

type Stage = 'open' | 'kitchen' | 'ready' | 'payment' | 'closed';
export function orderStage(o: any): Stage | null {
  if (o.kind === 'STAFF_MEAL') return null;
  if (o.status === 'COMPLETED') return 'closed';
  if (o.status === 'CONFIRMED') return 'payment';
  if (o.status !== 'DRAFT') return null;
  if (!o.rounds?.length) return 'open';
  return o.rounds.some((r: any) => r.kitchen !== 'READY' && r.kitchen !== 'DONE') ? 'kitchen' : 'ready';
}
const since = (o: any, s: Stage | null) => (s === 'payment' ? o.confirmedAt : s === 'kitchen' || s === 'ready' ? o.rounds?.at(-1)?.firedAt : s === 'closed' ? o.completedAt : o.createdAt) ?? o.createdAt;
export const orderType = (o: any) => (o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة'));
const typeTone = (o: any) => (o.channel === 'TAKEAWAY' ? 'violet' : o.channel === 'DELIVERY' ? 'info' : 'primary') as 'violet' | 'info' | 'primary';
const placeOf = (o: any) => (o.tableName ? `${t('ترابيزة')} ${o.tableName}` : o.label || o.customerName || o.customer?.name || '');

export default function OrdersBoard({ onList }: { onList?: () => void }) {
  const { me, nav, kind, can } = useDev();
  const rules = useBoardRules();
  const { run } = useCommand();
  const today = businessDate(clock.now());
  const live = useQuery<any>('Order.Find', { query: { lifecycle: 'DRAFT,CONFIRMED', sort: 'OLDEST', limit: 300 } });
  const closed = useQuery<any>('Order.Find', { query: { lifecycle: 'COMPLETED', businessDate: today, limit: 300 } });
  const items = live.data && closed.data ? [...(live.data.items ?? []), ...(closed.data.items ?? [])] : null;
  const myId = me?.user?.id;
  const now = clock.now();

  const columns: ColumnDef[] = [
    { id: 'open', title: t('مفتوح'), tone: 'primary' },
    { id: 'kitchen', title: t('في المطبخ'), tone: 'warning' },
    { id: 'ready', title: t('جاهز'), tone: 'success' },
    { id: 'payment', title: t('بانتظار الدفع'), tone: 'info' },
    { id: 'closed', title: t('مغلق اليوم'), tone: 'neutral', collapsed: true, final: true },
  ];
  const aging = (o: any): Aging => {
    const s = orderStage(o);
    if (s === 'closed') return { ...FRESH, timer: time(o.completedAt) };
    const m = minutesSince(since(o, s), now);
    const heat = heatOf(m, rules.orderWarnMinutes, rules.orderLateMinutes);
    return { heat, late: heat === 3, timer: mins(m), title: t('منذ دخول الحالة: {n} دقيقة · متأخر بعد {l}', { n: m, l: rules.orderLateMinutes }) };
  };
  const canMove = (o: any, to: string): MoveCheck | null => {
    const s = orderStage(o);
    if (s === to) return null;
    if (s === 'closed') return { ok: false, reason: t('الشيك مغلق — السجل لا يتغير') };
    if (s === 'payment') return { ok: false, reason: t('الشيك مؤكد وبانتظار الدفع') };
    if (to === 'kitchen') {
      if (!can('order:fire')) return { ok: false, reason: t('لا تملك صلاحية الإرسال للمطبخ') };
      if (!o.unfiredCount) return { ok: false, reason: t('لا توجد أصناف جديدة للإرسال') };
      return { ok: true, label: t('إرسال للمطبخ') };
    }
    if (to === 'payment') {
      if (!can('order:confirm')) return { ok: false, reason: t('لا تملك صلاحية تأكيد الشيك') };
      if (!(o.lines ?? []).some((l: any) => l.status === 'ACTIVE')) return { ok: false, reason: t('الشيك فارغ') };
      return { ok: true, label: t('تأكيد الشيك') };
    }
    if (to === 'ready') return { ok: false, reason: t('حالة التجهيز يحدّثها المطبخ') };
    if (to === 'open') return { ok: false, reason: t('لا يمكن إرجاع طلب أُرسل للمطبخ') };
    if (to === 'closed') return { ok: false, reason: t('الإغلاق يتم بالدفع — استخدم «تحصيل»') };
    return { ok: false };
  };
  const onMove = async (o: any, to: string) => {
    if (to === 'kitchen') return !!(await run('Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: o.version } }, { success: t('تم الإرسال للمطبخ'), refId: o.id }));
    if (to === 'payment') return !!(await run('Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: o.version } }, { success: t('تم تأكيد الشيك'), refId: o.id }));
    return false;
  };
  const openCheck = (o: any) => nav(o.visitId ? 'order' : kind === 'CASH' ? 'counter' : 'order', { orderId: o.id, back: 'checks' });
  const pay = useCollect(); // ux-07: one payment UI on every device
  const collect = (o: any) => pay.collect(o);
  const liveO = (o: any) => o.status === 'DRAFT' || o.status === 'CONFIRMED';
  const actions = (o: any): CardAction[] => [
    ...(liveO(o) ? [{ id: 'open', label: t('فتح الشيك'), icon: <ClipboardList className="w-4 h-4" />, onSelect: () => openCheck(o) }] : []),
    ...(liveO(o) && kind !== 'FLOOR' ? [{ id: 'collect', label: t('تحصيل'), icon: <Wallet className="w-4 h-4" />, onSelect: () => collect(o), disabled: !can('payment:capture'), reason: t('لا تملك صلاحية التحصيل'), tone: 'primary' as const }] : []),
    ...(o.status !== 'DRAFT' ? [{ id: 'receipt', label: t('الإيصال'), icon: <Receipt className="w-4 h-4" />, onSelect: () => nav('receipt', { orderId: o.id }) }] : []),
  ];
  const timeBuckets = {
    columns: [{ id: 't:late', title: t('متأخر'), tone: 'error' as const }, { id: 't:now', title: t('الآن'), tone: 'primary' as const }, { id: 't:hour', title: t('خلال ساعة'), tone: 'info' as const }, { id: 't:day', title: t('اليوم'), tone: 'neutral' as const }],
    of: (o: any) => { if (aging(o).late) return 't:late'; const m = minutesSince(o.createdAt, now); return m < 15 ? 't:now' : m < 60 ? 't:hour' : 't:day'; },
  };
  return (
    <div className="h-full flex flex-col min-h-0" data-fb="orders-board">
      <Board id="orders" title={t('الشيكات')} userId={myId} items={items} itemKey={(o: any) => o.id} columns={columns} columnOf={orderStage} aging={aging} amount={(o: any) => o.totals?.payable}
        search={(o: any) => `${o.number} ${o.tableName ?? ''} ${o.label ?? ''} ${o.customerName ?? ''} ${o.customer?.name ?? ''} ${o.customer?.phone ?? ''} ${personName(null, o.serverName)}`}
        searchPlaceholder={t('رقم الشيك أو الترابيزة أو الاسم')}
        filters={[
          { id: 'mine', label: t('شيكاتي'), test: (o: any) => o.serverUserId === myId },
          { id: 'late', label: t('متأخر'), test: (o: any) => aging(o).late },
          { id: 'unsent', label: t('لم يُرسل بعد'), test: (o: any) => o.unfiredCount > 0 },
          { id: 'DINE_IN', label: t('صالة'), group: 'type', test: (o: any) => o.channel === 'DINE_IN' },
          { id: 'TAKEAWAY', label: t('تيك أواي'), group: 'type', test: (o: any) => o.channel === 'TAKEAWAY' },
          { id: 'DELIVERY', label: t('دليفري'), group: 'type', test: (o: any) => o.channel === 'DELIVERY' },
        ]}
        timeBuckets={timeBuckets} sort={(a: any, b: any) => a.createdAtMs - b.createdAtMs}
        canMove={canMove} onMove={onMove} cardActions={actions}
        cardLabel={(o: any) => `${t('شيك')} ${o.number} · ${orderType(o)} ${placeOf(o)}`}
        renderCard={(o: any, c) => (
          <div className="space-y-1.5" data-fb={`order-card:${o.number}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="num font-extrabold">#{o.number}</span>
              <Pill size="sm" tone={typeTone(o)}>{orderType(o)}</Pill>
              {o.unfiredCount > 0 && orderStage(o) !== 'open' && <Pill size="sm" tone="warning">{t('لم يُرسل {n}', { n: o.unfiredCount })}</Pill>}
            </div>
            {placeOf(o) && <div className="font-bold text-sm truncate">{placeOf(o)}</div>}
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-soft truncate inline-flex items-center gap-1"><Users className="w-3 h-3 shrink-0" />{personName(null, o.serverName)}</span>
              <Money v={o.totals?.payable} className="font-bold text-sm" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <AgeChip a={c.aging} />
              {o.settlement && o.settlement.paid !== '0.0000' && o.status !== 'COMPLETED' && <span className="text-[11px] text-[var(--success)]">{t('مدفوع جزئيًا')}</span>}
            </div>
          </div>
        )}
        renderDetail={(o: any) => <OrderDetail o={o} onOpen={() => openCheck(o)} onCollect={() => collect(o)} />}
        toolbarEnd={onList && <BoardViewToggle value="board" onChange={(v) => v === 'list' && onList()} />}
      />
      {pay.node}
    </div>
  );
}

function OrderDetail({ o, onOpen, onCollect }: { o: any; onOpen: () => void; onCollect: () => void }) {
  const { nav, kind, can } = useDev();
  const full = useQuery<any>('Order.Get', { params: { orderId: o.id } });
  const d = full.data ?? o;
  const live = o.status === 'DRAFT' || o.status === 'CONFIRMED';
  const lines = useMemo(() => (d.lines ?? []).filter((l: any) => l.status !== 'REMOVED'), [d.lines]);
  return (
    <div className="space-y-4" data-fb="order-detail">
      <div className="flex items-center gap-2 flex-wrap"><h2 className="text-lg font-bold">{t('شيك')} <span className="num">#{o.number}</span></h2><StatusPill s={o.status} /><Pill size="sm" tone={typeTone(o)}>{orderType(o)}</Pill></div>
      <KV rows={[[t('المكان'), placeOf(o) || '—'], [t('الويتر / الكاشير'), personName(null, o.serverName)], [t('فُتح'), <span className="num">{time(o.createdAt)}</span>], ...(d.guestCount ? [[t('الضيوف'), <span className="num">{d.guestCount}</span>] as [string, React.ReactNode]] : [])]} />
      <div className="rounded-xl surface-1 border line p-3 space-y-1.5 text-sm">
        {lines.map((l: any) => (
          <div key={l.id} className={l.status === 'VOIDED' ? 'flex justify-between gap-2 line-through opacity-50' : 'flex justify-between gap-2'}>
            <span><span className="num font-bold text-[var(--primary)]">{qty(l.quantity)}×</span> {L(l.name)}{l.fireRound === null && l.status === 'ACTIVE' ? <span className="text-[11px] text-[var(--warning-text)]"> · {t('لم يُرسل بعد')}</span> : null}</span>
            <span className="num">{money(l.lineTotal)}</span>
          </div>
        ))}
        <div className="border-t line pt-2 mt-2 flex justify-between font-bold"><span>{t('الإجمالي')}</span><Money v={d.totals?.payable} /></div>
        {d.settlement && <div className="flex justify-between text-xs text-dim"><span>{t('المدفوع')} <span className="num">{money(d.settlement.paid)}</span></span><span>{t('المتبقي')} <span className="num">{money(d.settlement.remaining)}</span></span></div>}
      </div>
      {(d.rounds ?? []).length > 0 && <div className="flex flex-wrap gap-1.5">{d.rounds.map((r: any) => <Pill key={r.round} size="sm" tone={r.kitchen === 'READY' || r.kitchen === 'DONE' ? 'success' : 'warning'}><ChefHat className="w-3 h-3" />{t('جولة')} {r.round}</Pill>)}</div>}
      <div className="flex flex-wrap gap-2">
        {live && <Button variant="primary" onClick={onOpen} data-fb="order-detail:open"><ClipboardList className="w-4 h-4" />{t('فتح الشيك')}</Button>}
        {live && kind !== 'FLOOR' && can('payment:capture') && <Button variant="success" onClick={onCollect} data-fb="order-detail:collect"><Wallet className="w-4 h-4" />{t('تحصيل')}</Button>}
        {o.status !== 'DRAFT' && <Button onClick={() => nav('receipt', { orderId: o.id })}><Receipt className="w-4 h-4" />{t('الإيصال')}</Button>}
      </div>
    </div>
  );
}
