// The waiter's check on the tablet, opened in place from the floor map. Same layout grammar as the cashier:
// products | the check | the action bar. The bar comes from the waiter profile (الضيوف · الشيك المبدئي · نقل ·
// ملاحظة · المزيد); the primary reads «إرسال للمطبخ (n)» while lines are unsent and «الشيك المبدئي» after — never
// payment (the waiter has no drawer). With SeatsPolicy on, a seat is chosen before adding and every line shows it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Users, Printer, ArrowRightLeft, StickyNote, UserRound, Split, Merge, History, XCircle, Send, Armchair, Ban } from 'lucide-react';
import { useDev, useQuery, useCommand, useApprovals, errorText } from '../../app/hooks';
import { MenuGrid } from '../order/MenuGrid';
import { ProductDialog, type LineDraft } from '../order/ProductDialog';
import { CheckPanel, type CheckDialog } from '../order/CheckPanel';
import { needsDialog } from '../OrderScreen';
import { Button, Banner, Popover, Numpad, applyNumpadKey, Input, Kbd, Skeleton, Popup } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { addQty, sumQty } from '../../lib/cash';
import { profileFor, type SaleAction } from '../../app/profiles';
import { approvalRule } from '../../mock/policies';
import { ActionBar, type BarAction, type PrimaryState } from '../cashier/ActionBar';
import { CustomerPicker } from '../customers/common';

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [s, setS] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setS({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, s] as const;
}

/** An unsent plain line of the same product on the same seat that a repeat tap adds one to. */
function sameLine(order: any, productId: string, seat: number | null) {
  return order.lines.find((x: any) => x.status === 'ACTIVE' && x.fireRound === null && x.productId === productId && !x.modifiers?.length && !x.variant && !x.note && !x.children?.length && (x.seat ?? null) === seat && !x.shareOf) ?? null;
}

export function WaiterCheck({ orderId, onBack, onSwitch }: { orderId: string; onBack: () => void; onSwitch: (id: string) => void }) {
  const { me, terminal, can, auth, id: deviceId } = useDev();
  const profile = useMemo(() => profileFor((me?.user?.roleAssignments ?? []).map((r: any) => String(r.roleName ?? '')), terminal?.kind ?? 'FLOOR'), [me, terminal]);
  const bar = profile.id === 'waiter' || profile.id === 'captain' ? profile.actionBar : profileFor(['waiter'], 'FLOOR').actionBar;
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const order = o.data && o.data.id === orderId ? o.data : null;
  const fireP = useQuery<any>('Settings.Effective', { query: { policyId: 'FireTimingPolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const seatsP = useQuery<any>('Settings.Effective', { query: { policyId: 'SeatsPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const visitQ = useQuery<any>(order?.tableId ? 'TableVisit.List' : null, { query: { tableId: order?.tableId, state: 'OPEN' } });
  const tablesQ = useQuery<any>('Table.List', { query: {} });
  const approvals = useApprovals(deviceId);
  const { run, busy } = useCommand();
  const [rootRef, size] = useSize<HTMLDivElement>();
  const narrow = size.w < 760;
  const tall = narrow && size.h > size.w;
  const [pick, setPick] = useState<any>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [pop, setPop] = useState<null | { k: 'guests' | 'note' | 'move'; anchor: HTMLElement | null }>(null);
  const [tableMove, setTableMove] = useState(false);
  const [cust, setCust] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const checkAction = useRef<((k: CheckDialog) => void) | null>(null);
  const moreRef = useRef<(() => void) | null>(null);

  // adds are serialised against the check version (fast taps never race)
  const latest = useRef<any>(null);
  useEffect(() => { if (order && (!latest.current || latest.current.id !== order.id || latest.current.version <= order.version)) latest.current = order; }, [order]);
  const chain = useRef<Promise<any>>(Promise.resolve());
  const [flash, setFlash] = useState<string | null>(null);
  const addLine = (l: LineDraft, merge: boolean) => {
    const job = async () => {
      const ord = latest.current?.id === orderId ? latest.current : order;
      if (!ord) return null;
      const same = merge ? sameLine(ord, l.productId, l.seat ?? null) : null;
      const r = same
        ? await run<any>('Order.UpdateLine', { params: { orderId, lineId: same.id }, body: { expectedVersion: ord.version, expectedLineVersion: same.version, quantity: addQty(same.quantity, l.quantity) } })
        : await run<any>('Order.AddLines', { params: { orderId }, body: { expectedVersion: ord.version, lines: [l] } });
      if (r) {
        latest.current = r;
        const before = new Set(ord.lines.map((x: any) => x.id));
        setFlash(same ? same.id : r.lines.find((x: any) => !before.has(x.id))?.id ?? null);
      }
      return r;
    };
    chain.current = chain.current.then(job, job);
    return chain.current;
  };

  const inCart = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const l of order?.lines ?? []) if (l.status === 'ACTIVE') (m[l.productId] ??= []).push(l.quantity);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sumQty(v)]));
  }, [order]);
  if (o.error && !order) return <Banner tone="error" action={<Button size="sm" onClick={onBack}>{t('رجوع')}</Button>}>{errorText(o.error)}</Banner>;
  const draft = order?.status === 'DRAFT';
  const active: any[] = order ? order.lines.filter((l: any) => l.status === 'ACTIVE') : [];
  const unfired = active.filter((l) => l.fireRound === null);
  const policyFire = fireP.data?.value?.DINE_IN ?? 'AT_CONFIRM';
  const explicitRounds = !!order && draft && (order.fireModeBound === 'EXPLICIT_ROUNDS' || (order.fireModeBound === null && policyFire === 'EXPLICIT_ROUNDS'));
  const seats = !!seatsP.data?.value && !!order?.visitId;
  const guestN = Math.max(1, order?.guestCount ?? 2);
  const visit = (visitQ.data?.items ?? [])[0];
  const siblings = (visit?.checks ?? []).filter((c: any) => c.status === 'DRAFT' || c.status === 'CONFIRMED');
  const waitingFor = (ops: string[]) => approvals.some((a) => ops.includes(a.details?.opId));

  const fire = () => order && run('Order.Fire', { params: { orderId }, body: { expectedVersion: order.version } }, { success: t('تم الإرسال للمطبخ') });
  const prebill = () => order && run('Print.PreBill', { params: { orderId }, body: { terminalId: auth.terminalId } }, { success: t('أُرسل الشيك المبدئي للطابعة') });
  const primary: PrimaryState = !order || (!draft && order.status !== 'CONFIRMED')
    ? { kind: 'back', label: t('الصالة'), icon: <ArrowRight className="ltr:rotate-180" />, run: onBack, fb: 'go-floor' }
    : explicitRounds && unfired.length
      ? { kind: 'send', label: t('إرسال للمطبخ'), icon: <Send className="rtl:-scale-x-100" />, count: unfired.length, disabled: busy, run: fire, fb: 'send-round' }
      : { kind: 'prebill', label: t('الشيك المبدئي'), icon: <Printer />, disabled: !active.length || busy, run: prebill, fb: 'go-prebill' };

  const defs: Partial<Record<SaleAction, BarAction>> = {
    guests: { id: 'guests', label: t('الضيوف'), icon: <Users />, badge: order?.guestCount || undefined, fb: 'bar:guests', disabled: !draft || !can('order:updatedetails'), run: (a) => setPop({ k: 'guests', anchor: a }) },
    prebill: { id: 'prebill', label: t('الشيك المبدئي'), icon: <Printer />, fb: 'bar:prebill', disabled: !order || !active.length || !(draft || order?.status === 'CONFIRMED'), run: () => prebill() },
    move: { id: 'move', label: t('نقل'), icon: <ArrowRightLeft />, fb: 'bar:move', disabled: !draft || !order?.visitId, run: (a) => setPop({ k: 'move', anchor: a }) },
    note: { id: 'note', label: t('ملاحظة'), icon: <StickyNote />, fb: 'bar:note', badge: order?.note ? 1 : undefined, disabled: !order || !can('order:updatedetails'), run: (a) => setPop({ k: 'note', anchor: a }) },
    customer: { id: 'customer', label: t('العميل'), icon: <UserRound />, fb: 'bar:customer', disabled: !draft || !can('order:setcustomer'), run: () => setCust(true) },
    split: { id: 'split', label: t('تقسيم'), icon: <Split />, fb: 'bar:split', disabled: !draft || !active.length, run: () => checkAction.current?.('split') },
    merge: { id: 'merge', label: t('دمج'), icon: <Merge />, fb: 'bar:merge', disabled: !draft || siblings.length < 2, run: () => checkAction.current?.('merge') },
    history: { id: 'history', label: t('سجل الشيك'), icon: <History />, fb: 'bar:history', disabled: !order, run: () => checkAction.current?.('history') },
    cancel: order && order.rounds.length === 0
      ? { id: 'cancel', label: t('إلغاء الشيك'), icon: <XCircle />, danger: true, fb: 'bar:cancel', disabled: !draft || !(can('order:cancel') || can('approval:grant')), lock: !can('order:cancel') || approvalRule('ORDER_CANCEL', { branchId: auth.branchId }).mode !== 'NEVER', waiting: waitingFor(['Order.Cancel']), run: () => checkAction.current?.('cancel') }
      : { id: 'cancel', label: t('إلغاء بعد الإرسال'), icon: <Ban />, danger: true, fb: 'bar:void', disabled: !draft || !(can('order:void') || can('approval:grant')), lock: true, waiting: waitingFor(['Order.Void']), run: () => checkAction.current?.('voidOrder') },
  };
  const secondary = bar.secondary.slice(0, 5).map((id) => defs[id]).filter((a): a is BarAction => !!a);
  const overflow = bar.overflow.map((id) => defs[id]).filter((a): a is BarAction => !!a);

  const onPick = (p: any) => {
    if (needsDialog(p)) return setPick(p);
    addLine({ productId: p.id, quantity: '1', modifierOptionIds: [], ...(seats && seat ? { seat } : {}) }, true);
  };
  const seatBar = seats && draft && (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide shrink-0" data-fb="seat-pick" role="radiogroup" aria-label={t('المقعد')}>
      <span className="text-xs font-bold text-soft flex items-center gap-1 shrink-0"><Armchair className="w-4 h-4" />{t('المقعد')}</span>
      {[null, ...Array.from({ length: guestN }, (_, i) => i + 1)].map((s) => (
        <button key={String(s)} role="radio" aria-checked={seat === s} onClick={() => setSeat(s)} data-fb={`seat:${s ?? 0}`}
          className={cn('shrink-0 min-w-12 h-11 px-3 rounded-xl border text-sm font-bold transition-colors', seat === s ? 'bg-[var(--info)] text-white border-transparent' : 'surface-1 border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}>
          {s === null ? t('مشترك') : <span className="num">{s}</span>}
        </button>
      ))}
    </div>
  );
  const header = order && (
    <button onClick={onBack} data-fb="order-back" className="h-12 ps-2 pe-3 rounded-xl border border-[var(--glass-border)] surface-1 flex items-center gap-2 shrink-0 hover:bg-[var(--surface-2)]">
      <ArrowRight className="w-5 h-5 ltr:rotate-180" />
      <span className="font-bold whitespace-nowrap">{order.tableName ? `${t('ترابيزة')} ${order.tableName}` : `#${order.number}`}</span>
      {siblings.length > 1 && <span className="text-xs text-dim whitespace-nowrap">· {t('شيك')} <span className="num">{order.checkNo}</span></span>}
    </button>
  );
  const cart = order ? <CheckPanel order={order} refetch={o.refetch} mode="FLOOR" variant="cart" actionRef={checkAction} qty={{ stepper: profile.quantity.stepper, swipe: profile.quantity.swipe }} onCheckSwitch={onSwitch} flashLineId={flash} /> : <Skeleton className="h-full rounded-2xl" />;

  return (
    <div ref={rootRef} data-screen="C1" data-fb="waiter-check" data-profile={profile.id} className="-m-5 h-[calc(100%+2.5rem)] flex flex-col min-h-0">
      <div className={cn('flex-1 min-h-0 flex gap-3 p-3', tall && 'flex-col')}>
        <div className={cn('min-w-0 min-h-0 flex flex-col', tall ? 'h-[52%] shrink-0' : 'flex-1')}>
          <MenuGrid size="lg" channel="DINE_IN" salesChannelId={order?.salesChannelId ?? null} disabled={!draft} onPick={onPick} toolbarStart={header} above={seatBar} inCart={inCart} />
        </div>
        {narrow && !tall ? (cartOpen && (
          <Popup open onClose={() => setCartOpen(false)} size="md" bare fb="cart-popup"><div className="h-[70vh] p-2">{cart}</div></Popup>
        )) : <div className={cn('min-h-0', tall ? 'flex-1' : 'w-[40%] min-w-[300px] max-w-[420px] shrink-0')}>{cart}</div>}
      </div>
      <ActionBar secondary={secondary} overflow={overflow} primary={primary} showKeys={false} moreRef={moreRef}
        start={narrow && !tall ? <Button size="lg" onClick={() => setCartOpen(true)} data-fb="cart-pill">{t('الشيك')} <span className="num">({active.length})</span></Button> : null} />

      {pop?.k === 'guests' && order && <GuestsPopover anchor={pop.anchor} value={order.guestCount ?? 1} onClose={() => setPop(null)} onSave={async (n) => { const r = await run('Order.UpdateDetails', { params: { orderId }, body: { expectedVersion: order.version, guestCount: n } }, { success: t('تم تعديل عدد الضيوف') }); if (r) setPop(null); }} />}
      {pop?.k === 'note' && order && <NotePopover anchor={pop.anchor} value={order.note ?? ''} onClose={() => setPop(null)} onSave={async (v) => { const r = await run('Order.UpdateDetails', { params: { orderId }, body: { expectedVersion: order.version, note: v } }, { success: t('تم حفظ الملاحظة') }); if (r) setPop(null); }} />}
      {pop?.k === 'move' && (
        <Popover anchor={pop.anchor} open onClose={() => setPop(null)} side="top" align="start" width={260} fb="move-menu">
          <div className="grid gap-0.5">
            <button role="menuitem" onClick={() => { setPop(null); setTableMove(true); }} disabled={!visit} data-fb="move:table" className="h-12 px-3 rounded-xl flex items-center gap-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-40"><ArrowRightLeft className="w-[18px] h-[18px] text-soft" />{t('نقل الترابيزة')}</button>
            <button role="menuitem" onClick={() => { setPop(null); checkAction.current?.('move'); }} disabled={!active.length} data-fb="move:items" className="h-12 px-3 rounded-xl flex items-center gap-3 text-sm hover:bg-[var(--surface-2)] disabled:opacity-40"><Split className="w-[18px] h-[18px] text-soft" />{t('نقل أصناف')}</button>
          </div>
        </Popover>
      )}
      {tableMove && visit && <TableMovePopup visit={visit} tables={tablesQ.data?.items ?? []} onClose={() => setTableMove(false)} />}
      {pick && order && <ProductDialog product={pick} channel="DINE_IN" salesChannelId={order.salesChannelId} onClose={() => setPick(null)} onAdd={async (l) => { const r = await addLine(l, false); if (r) setPick(null); }} seatsEnabled={seats} guestCount={order.guestCount} initialSeat={seat} />}
      {cust && order && <CustomerPicker open onClose={() => setCust(false)} onPick={async (c) => { const r = await run('Order.SetCustomer', { params: { orderId }, body: { expectedVersion: order.version, customerId: c.id } }, { success: t('أُضيف العميل إلى الشيك') }); if (r) setCust(false); }} />}
    </div>
  );
}

function GuestsPopover({ anchor, value, onClose, onSave }: { anchor: HTMLElement | null; value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [v, setV] = useState('');
  const n = Number(v || value);
  return (
    <Popover anchor={anchor} open onClose={onClose} side="top" align="start" width={280} fb="guests-popover" label={t('الضيوف')}>
      <div className="p-1.5 space-y-2">
        <div className="h-14 rounded-xl surface-1 border line px-3 flex items-center justify-between"><span className="text-sm text-soft flex items-center gap-1.5"><Users className="w-4 h-4" />{t('الضيوف')}</span><span className="num text-3xl font-bold" data-fb="guests-value">{v || value}</span></div>
        <Numpad mode="integer" size="md" onKey={(k) => setV((c) => applyNumpadKey(c, k, { decimals: 0, maxDigits: 2 }).replace(/^0+/, ''))} fb="guests-numpad" />
        <Button variant="primary" size="lg" className="w-full" disabled={!n || n === value} onClick={() => onSave(n)} data-fb="guests-save">{t('حفظ')}</Button>
      </div>
    </Popover>
  );
}

function NotePopover({ anchor, value, onClose, onSave }: { anchor: HTMLElement | null; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Popover anchor={anchor} open onClose={onClose} side="top" align="start" width={320} fb="note-popover" label={t('ملاحظة')}>
      <form className="p-1.5 space-y-2" onSubmit={(e) => { e.preventDefault(); if (v.trim() !== value) onSave(v.trim()); }}>
        <div className="text-sm font-bold">{t('ملاحظة الشيك')}</div>
        <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={120} data-fb="check-note" className="!h-12" />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={v.trim() === value} data-fb="check-note-save">{t('حفظ')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button>
      </form>
    </Popover>
  );
}

/** Move the whole visit to a free table (a short centered popup: the free tables as large chips). */
function TableMovePopup({ visit, tables, onClose }: { visit: any; tables: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [to, setTo] = useState('');
  const free = tables.filter((x) => x.id !== visit.tableId && x.active && !x.occupancy && x.turn?.state !== 'DIRTY');
  const go = async () => { if (to && await run('TableVisit.Transfer', { params: { visitId: visit.id }, body: { expectedVersion: visit.version, toTableId: to } }, { success: t('تم نقل الترابيزة') })) onClose(); };
  return (
    <Popup open onClose={onClose} size="md" title={t('نقل الترابيزة')} fb="table-move"
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" disabled={!to || busy} loading={busy} onClick={go} data-fb="table-move-ok">{t('نقل')}</Button></>}>
      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
        {free.map((x) => <button key={x.id} onClick={() => setTo(x.id)} data-fb={`table-move:${x.name}`} className={cn('min-h-[64px] rounded-xl border-2 flex flex-col items-center justify-center', to === x.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}><span className="num text-xl font-extrabold">{x.name}</span><span className="text-[10px] text-dim num">{x.capacity} <Users className="w-3 h-3 inline" /></span></button>)}
      </div>
    </Popup>
  );
}

