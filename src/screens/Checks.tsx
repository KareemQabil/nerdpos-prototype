// D2 Find and reopen checks: by number, status and business date. Tap a row for the details and the next step.
// After a lost response or a restart the check is re-read from the server (the same command never runs twice).
import React, { useState } from 'react';
import { History, Wallet, Receipt, ClipboardList, ArrowRightLeft, CalendarDays } from 'lucide-react';
import { TransferSessionDialog } from './ops/TransferSessionDialog';
import { useDev, useQuery } from '../app/hooks';
import { PageHeader, Input, Table, Money, Button, Toolbar, SearchInput, FilterChips, EmptyState, Modal, KV, StateBadge } from '../ui';
import { t, L } from '../i18n';
import { time, money, qty } from '../lib/format';
import { StatusPill, HistoryDialog } from './order/CheckPanel';
import { clock, businessDate } from '../mock/clock';
import { personName } from '../demo/people';
import { useBoardView } from '../app/useBoardView';
import { BoardViewToggle } from '../ui/board';
import OrdersBoard from './boards/OrdersBoard';
import { PaymentPopup, useCollect } from './cashier/PaymentPopup';

type St = 'ALL' | 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED,VOIDED';
const placeOf = (o: any) => (o.kind === 'STAFF_MEAL' ? t('وجبة موظف') : o.tableName ? `${t('ترابيزة')} ${o.tableName} · ${t('شيك')} ${o.checkNo}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة كاونتر'));
const live = (o: any) => o.status === 'DRAFT' || o.status === 'CONFIRMED';

// ux-05: the checks screen is the orders board or this list (board / list switch, remembered per user).
export default function Checks() {
  const { view, setView } = useBoardView('orders');
  const { params, nav } = useDev();
  // ux-07: the old «pay» route lands here (?pay=<orderId>) on a device without the sale screen: the one payment popup
  const payHere = params.pay ? <PaymentPopup orderId={params.pay} onClose={() => nav('checks', {})} onNext={() => nav('checks', {})} nextLabel={t('تم')} /> : null;
  if (view === 'board') return <div data-screen="D2" className="h-full"><OrdersBoard onList={() => setView('list')} />{payHere}</div>;
  return <><ChecksList onBoard={() => setView('board')} />{payHere}</>;
}

function ChecksList({ onBoard }: { onBoard: () => void }) {
  const { nav, kind, can } = useDev();
  const pay = useCollect();
  const [number, setNumber] = useState('');
  const [st, setSt] = useState<St>('ALL');
  const [bd, setBd] = useState('');
  const [hist, setHist] = useState<any>(null);
  const [move, setMove] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const q = useQuery<any>('Order.Find', { query: { number: number || undefined, lifecycle: st === 'ALL' ? undefined : st, businessDate: bd || undefined, limit: 200 } });
  const items: any[] = q.data?.items ?? [];
  const today = businessDate(clock.now());
  const open = (o: any) => nav(o.visitId ? 'order' : kind === 'CASH' ? 'counter' : 'order', { orderId: o.id, back: 'checks' });
  const rows = items.map((o: any) => [
    <span className="num font-bold">#{o.number}</span>,
    <span className="font-bold">{placeOf(o)}</span>,
    <StatusPill s={o.status} />,
    <span className="num text-xs text-soft">{o.businessDate === today ? t('النهارده') : o.businessDate} · {time(o.createdAt)}</span>,
    <span className="text-soft">{personName(null, o.serverName)}</span>,
    <Money v={o.totals.payable} />,
    <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
      {live(o) && <Button size="sm" onClick={() => open(o)} data-fb={`check-open:${o.number}`}><ClipboardList className="w-3.5 h-3.5" />{t('افتح')}</Button>}
      {live(o) && can('payment:capture') && kind !== 'FLOOR' && <Button size="sm" variant="success" onClick={() => pay.collect(o)} title={t('تحصيل')} aria-label={t('تحصيل')} data-fb={`check-pay:${o.number}`}><Wallet className="w-3.5 h-3.5" /></Button>}
      {o.status !== 'DRAFT' && <Button size="sm" variant="ghost" onClick={() => nav('receipt', { orderId: o.id })} title={t('الإيصال')} aria-label={t('الإيصال')}><Receipt className="w-3.5 h-3.5" /></Button>}
    </div>,
  ]);
  return (
    <div data-screen="D2" className="space-y-4">
      <PageHeader title={t('الشيكات')} ops={['Order.Find', 'Order.Get', 'Order.Timeline']} description={t('دوّر على أي شيك وافتحه تاني، حصّله، أو شوف إيصاله وسجله.')} className="!mb-0" actions={<BoardViewToggle value="list" onChange={(v) => v === 'board' && onBoard()} />} />
      <Toolbar className="!mb-0">
        <SearchInput value={number} onChange={setNumber} placeholder={t('رقم الشيك')} data-fb="checks-search" />
        <FilterChips value={st} onChange={setSt} options={[{ id: 'ALL', label: t('الكل') }, { id: 'DRAFT', label: t('مفتوح') }, { id: 'CONFIRMED', label: t('مستني الدفع'), tone: 'warning' }, { id: 'COMPLETED', label: t('اتقفل') }, { id: 'CANCELLED,VOIDED', label: t('ملغي') }]} />
        <Toolbar.Spacer />
        <Button size="sm" variant={bd === today ? 'subtle' : 'ghost'} onClick={() => setBd(bd === today ? '' : today)} data-fb="checks-today"><CalendarDays className="w-4 h-4" />{t('النهارده')}</Button>
        <Input type="date" value={bd} onChange={(e) => setBd(e.target.value)} className="!w-44 h-10" aria-label={t('اليوم')} />
      </Toolbar>
      <Table head={['#', t('المكان'), t('الحالة'), t('الوقت'), t('الويتر / الكاشير'), t('الإجمالي'), '']} align={['start', 'start', 'start', 'start', 'start', 'end', 'end']} rows={rows} loading={q.loading} maxHeight="calc(100vh - 300px)"
        onRowClick={(i) => setSel(items[i])}
        empty={<EmptyState compact icon={<Receipt />} title={number || st !== 'ALL' || bd ? t('مفيش شيكات بالبحث ده') : t('لسه مفيش شيكات')} text={number || st !== 'ALL' || bd ? t('غيّر الرقم أو الحالة أو اليوم.') : t('أول شيك هيتفتح من الصالة أو نقطة البيع هيظهر هنا.')} />} />
      {sel && <CheckDrawer o={items.find((x) => x.id === sel.id) ?? sel} onClose={() => setSel(null)} onOpen={() => open(sel)} onHistory={() => setHist(sel)} onMove={() => setMove(sel)} onPay={() => { setSel(null); pay.collect(sel); }} />}
      {pay.node}
      {hist && <HistoryDialog order={hist} onClose={() => setHist(null)} />}
      {move && <TransferSessionDialog orders={[move]} onClose={() => setMove(null)} />}
    </div>
  );
}

function CheckDrawer({ o, onClose, onOpen, onHistory, onMove, onPay }: { o: any; onClose: () => void; onOpen: () => void; onHistory: () => void; onMove: () => void; onPay: () => void }) {
  const { nav, kind, can } = useDev();
  const full = useQuery<any>('Order.Get', { params: { orderId: o.id } });
  const d = full.data ?? o;
  const T = d.totals;
  return (
    <Modal open onClose={onClose} size="md" title={<span className="flex items-center gap-2">{t('شيك')} <span className="num">#{o.number}</span><StatusPill s={o.status} /></span>} description={placeOf(o)} badge={<StateBadge ops={['Order.Get']} />}
      footer={<>
        <Button variant="ghost" onClick={onHistory}><History className="w-4 h-4" />{t('السجل')}</Button>
        {live(o) && o.sessionId && can('session:close') && <Button variant="ghost" onClick={onMove} data-fb={`check-transfer:${o.number}`}><ArrowRightLeft className="w-4 h-4" />{t('نقل لدرج تاني')}</Button>}
        <div className="flex-1" />
        {o.status !== 'DRAFT' && <Button onClick={() => nav('receipt', { orderId: o.id })}><Receipt className="w-4 h-4" />{t('الإيصال')}</Button>}
        {live(o) && can('payment:capture') && kind !== 'FLOOR' && <Button variant="success" onClick={onPay} data-fb="check-collect"><Wallet className="w-4 h-4" />{t('تحصيل')}</Button>}
        {live(o) && <Button variant="primary" onClick={onOpen}><ClipboardList className="w-4 h-4" />{t('افتح الشيك')}</Button>}
      </>}>
      <div className="space-y-4">
        <KV rows={[[t('اليوم'), <span className="num">{o.businessDate}</span>], [t('اتفتح'), <span className="num">{time(o.createdAt)}</span>], [t('الويتر / الكاشير'), personName(null, o.serverName)], ...(d.guestCount ? [[t('الضيوف'), <span className="num">{d.guestCount}</span>] as [string, React.ReactNode]] : [])]} />
        {d.lines ? (
          <div className="rounded-xl surface-1 border line p-3 space-y-1.5 text-sm">
            {d.lines.filter((l: any) => l.status !== 'REMOVED').map((l: any) => <div key={l.id} className={l.status === 'VOIDED' ? 'flex justify-between gap-2 line-through opacity-50' : 'flex justify-between gap-2'}><span><span className="num font-bold text-[var(--primary)]">{qty(l.quantity)}×</span> {L(l.name)}</span><Money v={l.lineTotal} plain /></div>)}
            <div className="border-t line pt-2 mt-2 flex justify-between font-bold"><span>{t('الإجمالي')}</span><Money v={T.payable} /></div>
            {d.settlement && <div className="flex justify-between text-xs text-dim"><span>{t('اتدفع')} <Money v={d.settlement.paid} plain /></span><span>{t('الباقي')} <Money v={d.settlement.remaining} plain /></span></div>}
          </div>
        ) : <EmptyState compact text={t('بنحمّل التفاصيل…')} />}
      </div>
    </Modal>
  );
}
