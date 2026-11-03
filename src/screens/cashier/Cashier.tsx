// The sale screen (C2): counter sale and collecting dine-in checks on ONE screen, switched with one tap.
// Layout: product area (search / scanner + categories + large touch grid) | the cart, always visible on the
// reading-end side (left in Arabic, right in English) | the action bar fixed at the bottom. The cart lives in one
// place only; on a narrow pane the total in the action bar opens it.
// Quantity, four ways (each can be switched off by the work profile): a number typed before the item (keyboard or
// the numpad), repeated taps add one, + / − on the line and swipe to remove (with a visible button), long-press on
// an item for quantity / options / note (with a visible ⋯ button). Orders are created on the first item.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, Utensils, Coffee, Bike, Wallet, Send, Receipt, Plus, PauseCircle, UserRound, Tag, ClipboardList, Printer, Gift, Shuffle, XCircle, Ban, History, Keyboard, Hash, X, ArrowRightLeft, Split, Merge, Armchair, PackageX } from 'lucide-react';
import { useDev, useQuery, useCommand, useApprovals } from '../../app/hooks';
import { MenuGrid } from '../order/MenuGrid';
import { ProductDialog, type LineDraft } from '../order/ProductDialog';
import { CheckPanel, type CheckDialog } from '../order/CheckPanel';
import { needsDialog } from '../OrderScreen';
import { Button, Money, Modal, SegmentedControl, Popover, Numpad, applyNumpadKey, Kbd, EmptyState, Skeleton, Pill } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { addQty } from '../../lib/cash';
import { profileFor, type SaleAction } from '../../app/profiles';
import { useHotkeys, useKeymap, type KeyAction } from '../../app/keymap';
import { inScanBurst, burstLength } from '../../app/scanburst';
import { approvalRule } from '../../mock/policies';
import { ActionBar, type BarAction, type PrimaryState } from './ActionBar';
import { PaymentPopup, placeOf } from './PaymentPopup';
import { CollectBoard } from './CollectBoard';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { StaffMealDialog, StaffMealsList } from '../control/StaffMeal';
import { SalesChannelPicker } from '../channels/common';
import { CustomerPicker } from '../customers/common';

type Mode = 'sell' | 'collect';
type NewType = 'TAKEAWAY' | 'DINE_IN';

/** Width of an element (drives the narrow layout where the cart opens from the total). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** An unsent plain line of the same product (no options, note, seat or parts) that a repeat tap adds to. */
function samePlainLine(order: any, productId: string) {
  return order.lines.find((x: any) => x.status === 'ACTIVE' && x.fireRound === null && x.productId === productId && !x.modifiers?.length && !x.variant && !x.note && !x.children?.length && !x.seat && !x.shareOf) ?? null;
}

export function CashierScreen({ sessionId, staffMealOnOpen }: { sessionId: string; staffMealOnOpen?: boolean }) {
  const { id: deviceId, terminal, nav, params, can, me, auth } = useDev();
  const profile = useMemo(() => profileFor((me?.user?.roleAssignments ?? []).map((r: any) => String(r.roleName ?? '')), terminal?.kind ?? null), [me, terminal]);
  const keys = useKeymap(deviceId);
  const showKeys = profile.input !== 'touch';
  const orderId: string | null = params.orderId ?? null;
  const mode: Mode = params.mode === 'collect' ? 'collect' : 'sell';
  const o = useQuery<any>(orderId ? 'Order.Get' : null, { params: { orderId } });
  const order = o.data && o.data.id === orderId ? o.data : null;
  const counterOpen = useQuery<any>('Order.Find', { query: { sessionId, lifecycle: 'DRAFT,CONFIRMED' } });
  const dineOpen = useQuery<any>('Order.Find', { query: { channel: 'DINE_IN', lifecycle: 'DRAFT,CONFIRMED', sort: 'OLDEST' } });
  const fireP = useQuery<any>('Settings.Effective', { query: { policyId: 'FireTimingPolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const seatsP = useQuery<any>('Settings.Effective', { query: { policyId: 'SeatsPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const approvals = useApprovals(deviceId);
  const { run, busy } = useCommand();
  const [rootRef, width] = useWidth<HTMLDivElement>();
  const narrow = width < 760;

  const [newType, setNewType] = useState<NewType>('TAKEAWAY');
  const [scPick, setScPick] = useState<Record<string, string>>({});
  const [pendQty, setPendQty] = useState('');
  const [pick, setPick] = useState<null | { product: any; qty: string }>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [staffMeal, setStaffMeal] = useState(!!staffMealOnOpen);
  const [meals, setMeals] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [heldAnchor, setHeldAnchor] = useState<HTMLElement | null>(null);
  const [qtyAnchor, setQtyAnchor] = useState<HTMLElement | null>(null);
  const checkAction = useRef<((k: CheckDialog) => void) | null>(null);
  const moreRef = useRef<(() => void) | null>(null);

  const go = (p: { orderId?: string | null; mode?: Mode }) => {
    const next: Record<string, any> = {};
    const oid = p.orderId === undefined ? orderId : p.orderId;
    const m = p.mode ?? mode;
    if (oid) next.orderId = oid;
    if (m === 'collect') next.mode = 'collect';
    nav('counter', next);
  };

  // ── check state
  const draft = order?.status === 'DRAFT';
  const openStatus = draft || order?.status === 'CONFIRMED';
  const active: any[] = order ? order.lines.filter((l: any) => l.status === 'ACTIVE') : [];
  const unfired = active.filter((l) => l.fireRound === null);
  const rounds = order ? order.lines.filter((l: any) => l.fireRound !== null).length : 0;
  const policyFire = fireP.data?.value?.[order?.channel ?? 'TAKEAWAY'] ?? 'AT_CONFIRM';
  const explicitRounds = !!order && draft && (order.fireModeBound === 'EXPLICIT_ROUNDS' || (order.fireModeBound === null && policyFire === 'EXPLICIT_ROUNDS'));
  const paid = order?.settlement && order.settlement.paid !== '0.0000' && !order.settlement.settled;
  const held: any[] = (counterOpen.data?.items ?? []).filter((x: any) => !x.visitId && x.id !== orderId && x.kind !== 'STAFF_MEAL');
  const dineChecks: any[] = (dineOpen.data?.items ?? []).filter((x: any) => x.visitId);
  const canAsk = (perm: string) => can(perm) || can('approval:grant');
  const needsApproval = (action: string, perm?: string) => (perm ? !can(perm) : false) || approvalRule(action, { branchId: auth.branchId }).mode !== 'NEVER';
  const waitingFor = (ops: string[]) => approvals.some((a) => ops.includes(a.details?.opId));
  const editable = !!order && draft && order.kind !== 'STAFF_MEAL';

  // ── adding items (serialised so fast taps never race the check version)
  const chain = useRef<Promise<any>>(Promise.resolve());
  const latest = useRef<any>(null);
  const curId = useRef<string | null>(orderId);
  curId.current = orderId ?? (latest.current && curId.current === latest.current.id ? curId.current : null);
  useEffect(() => { if (order && (!latest.current || latest.current.id !== order.id || latest.current.version <= order.version)) latest.current = order; }, [order]);
  const ensureOrder = async (): Promise<any | null> => {
    if (latest.current && latest.current.id === curId.current && latest.current.status === 'DRAFT') return latest.current;
    if (orderId && order && order.status === 'DRAFT' && curId.current === orderId) return order;
    const created = await run<any>('Order.Create', { body: { channel: newType, ...(scPick[newType] ? { salesChannelId: scPick[newType] } : {}) } });
    if (!created) return null;
    latest.current = created;
    curId.current = created.id;
    go({ orderId: created.id, mode: 'sell' });
    return created;
  };
  const enqueue = (fn: () => Promise<any>) => { chain.current = chain.current.then(fn, fn); return chain.current; };
  const addLine = (draftLine: LineDraft, merge: boolean) => enqueue(async () => {
    const ord = await ensureOrder();
    if (!ord) return null;
    const same = merge && profile.quantity.repeatTap ? samePlainLine(ord, draftLine.productId) : null;
    const r = same
      ? await run<any>('Order.UpdateLine', { params: { orderId: ord.id, lineId: same.id }, body: { expectedVersion: ord.version, expectedLineVersion: same.version, quantity: addQty(same.quantity, draftLine.quantity) } })
      : await run<any>('Order.AddLines', { params: { orderId: ord.id }, body: { expectedVersion: ord.version, lines: [draftLine] } });
    if (r) latest.current = r;
    return r;
  });
  const onPick = (p: any) => {
    const q = (profile.quantity.typedPrefix && pendQty) || '1';
    setPendQty('');
    if (needsDialog(p)) return setPick({ product: p, qty: q });
    addLine({ productId: p.id, quantity: q, modifierOptionIds: [] }, true);
  };
  const onOptions = profile.quantity.longPress ? (p: any) => { const q = pendQty || '1'; setPendQty(''); setPick({ product: p, qty: q }); } : undefined;

  // typed quantity before the item (digits on the keyboard; a scanner burst is not a quantity)
  const qtySnap = useRef('');
  useEffect(() => {
    if (!profile.quantity.typedPrefix || mode !== 'sell') return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (/^[0-9]$/.test(e.key)) {
        if (burstLength() === 1) setPendQty((cur) => { qtySnap.current = cur; return cur; });
        if (inScanBurst()) { setPendQty(qtySnap.current); return; }
        setPendQty((cur) => (cur.length >= 3 ? cur : (cur + e.key).replace(/^0+/, '')));
      } else if (e.key === 'Backspace') setPendQty((cur) => cur.slice(0, -1));
      else if (e.key === 'Escape') setPendQty('');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [profile.quantity.typedPrefix, mode]);

  // ── primary button: follows the check state
  const openPay = () => { if (order && active.length && can('payment:capture')) setPayOpen(true); };
  const fire = () => order && run('Order.Fire', { params: { orderId: order.id }, body: { expectedVersion: order.version } }, { success: t('تم الإرسال للمطبخ') });
  const primary: PrimaryState = !order || !openStatus
    ? (order && order.status === 'COMPLETED'
      ? { kind: 'new', label: t('طلب جديد'), icon: <Plus />, run: () => go({ orderId: null }), fb: 'go-new', hotkey: keys.primary }
      : { kind: 'pay', label: t('الدفع'), icon: <Wallet />, disabled: true, run: () => {}, fb: 'go-pay', hotkey: keys.primary })
    : explicitRounds && unfired.length && order.kind !== 'STAFF_MEAL'
      ? { kind: 'send', label: t('إرسال للمطبخ'), icon: <Send className="rtl:-scale-x-100" />, count: unfired.length, disabled: busy, run: fire, fb: 'send-round', hotkey: keys.primary }
      : paid
        ? { kind: 'resume', label: t('استكمال الدفع'), icon: <Wallet />, amount: order.settlement.remaining, disabled: !can('payment:capture'), run: openPay, fb: 'go-pay', hotkey: keys.primary }
        : { kind: 'pay', label: t('الدفع'), icon: <Wallet />, amount: order.totals.payable, disabled: !active.length || !can('payment:capture'), run: openPay, fb: 'go-pay', hotkey: keys.primary };

  // ── actions (positions come from the profile; an action this user cannot run stays in place, disabled)
  const defs: Partial<Record<SaleAction, BarAction>> = {
    new: { id: 'new', label: t('جديد'), icon: <Plus />, fb: 'new-takeaway', run: () => { setPendQty(''); curId.current = null; go({ orderId: null, mode: 'sell' }); } },
    held: { id: 'held', label: t('المعلقة'), icon: <PauseCircle />, badge: held.length || undefined, disabled: !held.length, fb: 'bar:held', run: (a) => setHeldAnchor(heldAnchor ? null : a) },
    customer: { id: 'customer', label: t('العميل'), icon: <UserRound />, fb: 'bar:customer', disabled: !can('order:setcustomer') || (!!order && !openStatus), run: async () => { if (await ensureOrder()) setCustOpen(true); } },
    discount: { id: 'discount', label: t('الخصم'), icon: <Tag />, fb: 'bar:discount', disabled: !editable || !active.length || !canAsk('order:applydiscount'), lock: needsApproval('ORDER_DISCOUNT', 'order:applydiscount'), waiting: waitingFor(['Order.ApplyDiscount']), run: () => checkAction.current?.('discount') },
    orders: { id: 'orders', label: t('الطلبات'), icon: <ClipboardList />, fb: 'bar:orders', run: () => nav('checks') },
    delivery: { id: 'delivery', label: t('دليفري'), icon: <Bike />, fb: 'counter-delivery', disabled: !can('delivery:create'), run: () => nav('delivery-new') },
    staffMeal: { id: 'staffMeal', label: t('وجبة موظف'), icon: <Coffee />, fb: 'staff-meal', run: () => setStaffMeal(true) },
    staffMeals: { id: 'staffMeals', label: t('وجبات الموظفين'), icon: <Utensils />, fb: 'staff-meals-list-open', run: () => setMeals(true) },
    prebill: { id: 'prebill', label: t('شيك مبدئي'), icon: <Printer />, fb: 'bar:prebill', disabled: !editable || !active.length, run: () => order && run('Print.PreBill', { params: { orderId: order.id }, body: { terminalId: auth.terminalId } }, { success: t('أُرسل الشيك المبدئي للطابعة') }) },
    comp: { id: 'comp', label: t('ضيافة'), icon: <Gift />, fb: 'bar:comp', disabled: !editable || !active.length || !can('order:comp'), lock: needsApproval('ORDER_COMP'), waiting: waitingFor(['Order.Comp']), run: () => checkAction.current?.('comp') },
    channel: { id: 'channel', label: t('تغيير نوع الطلب'), icon: <Shuffle />, fb: 'bar:channel', disabled: !editable || !can('order:changechannel'), run: () => checkAction.current?.('channel') },
    cancel: rounds === 0 && draft
      ? { id: 'cancel', label: t('إلغاء الشيك'), icon: <XCircle />, danger: true, fb: 'bar:cancel', disabled: !editable || !canAsk('order:cancel'), lock: !can('order:cancel'), waiting: waitingFor(['Order.Cancel']), run: () => checkAction.current?.('cancel') }
      : { id: 'cancel', label: t('إلغاء بعد الإرسال'), icon: <Ban />, danger: true, fb: 'bar:void', disabled: !order || !openStatus || order.kind === 'STAFF_MEAL' || !canAsk('order:void'), lock: true, waiting: waitingFor(['Order.Void']), run: () => checkAction.current?.('voidOrder') },
    history: { id: 'history', label: t('سجل الشيك'), icon: <History />, fb: 'bar:history', disabled: !order, run: () => checkAction.current?.('history') },
    move: { id: 'move', label: t('نقل أصناف'), icon: <ArrowRightLeft />, disabled: !editable || !order?.visitId, run: () => checkAction.current?.('move') },
    split: { id: 'split', label: t('تقسيم'), icon: <Split />, disabled: !editable || !order?.visitId, run: () => checkAction.current?.('split') },
    merge: { id: 'merge', label: t('دمج'), icon: <Merge />, disabled: !editable || !order?.visitId, run: () => checkAction.current?.('merge') },
    soldOut: { id: 'soldOut', label: t('خلص النهارده'), icon: <PackageX />, run: () => nav('soldout') },
    drawer: { id: 'drawer', label: t('الوردية والدرج'), icon: <Wallet />, fb: 'bar:drawer', run: () => nav('shift') },
    shortcuts: { id: 'shortcuts', label: t('الاختصارات'), icon: <Keyboard />, fb: 'bar:shortcuts', run: () => setKeysOpen(true) },
  };
  const withKey = (a: BarAction): BarAction => ({ ...a, hotkey: keys[a.id as KeyAction] });
  const secondary = profile.actionBar.secondary.slice(0, 5).map((id) => defs[id]).filter(Boolean).map((a) => withKey(a!));
  const overflow = profile.actionBar.overflow.map((id) => defs[id]).filter((a): a is BarAction => !!a && !(a.id === 'delivery' && !can('delivery:create'))).map(withKey);

  const focusSearch = () => (document.querySelector(`[data-device="${deviceId}"] [data-fb="menu-search"]`) as HTMLInputElement | null)?.focus();
  const toggleMode = () => go({ mode: mode === 'sell' ? 'collect' : 'sell' });
  useHotkeys(deviceId, !payOpen, {
    primary: () => !primary.disabled && primary.run(),
    new: defs.new?.run as () => void,
    held: () => { const el = document.querySelector<HTMLElement>(`[data-device="${deviceId}"] [data-fb="bar:held"]`); if (held.length) setHeldAnchor(el); },
    customer: () => !defs.customer?.disabled && defs.customer?.run?.(null),
    discount: () => !defs.discount?.disabled && defs.discount?.run?.(null),
    orders: () => defs.orders?.run?.(null),
    more: () => moreRef.current?.(),
    mode: toggleMode,
    search: () => { if (mode !== 'sell') go({ mode: 'sell' }); setTimeout(focusSearch, 50); },
    shortcuts: () => setKeysOpen(true),
  });

  const actionLabels: Partial<Record<KeyAction, string>> = { primary: t('الزر الرئيسي'), shortcuts: t('الاختصارات'), new: t('طلب جديد'), held: t('الطلبات المعلقة'), customer: t('العميل'), discount: t('الخصم'), orders: t('الطلبات'), more: t('المزيد'), mode: t('بيع / تحصيل'), search: t('البحث عن صنف') };

  const modeSwitch = (
    <SegmentedControl size="lg" value={mode} onChange={(m) => go({ mode: m })} className="shrink-0"
      options={[{ id: 'sell', label: t('بيع'), icon: <ShoppingBag />, fb: 'mode:sell' }, { id: 'collect', label: t('تحصيل'), icon: <Armchair />, count: dineChecks.length || undefined, fb: 'mode:collect' }]} />
  );
  const qtyControl = profile.quantity.typedPrefix && (
    <div className="flex items-center gap-1 shrink-0">
      {pendQty && <span className="h-12 ps-3 pe-1 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold inline-flex items-center gap-1.5" data-fb="qty-pending"><span className="text-sm">{t('الكمية')}</span><span className="num text-xl">×{pendQty}</span><button onClick={() => setPendQty('')} className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-black/10" aria-label={t('مسح الكمية')}><X className="w-4 h-4" /></button></span>}
      <button onClick={(e) => setQtyAnchor(qtyAnchor ? null : e.currentTarget)} data-fb="qty-pad" title={t('الكمية قبل الصنف')} aria-label={t('الكمية قبل الصنف')} className={cn('h-12 w-12 rounded-xl border flex items-center justify-center', qtyAnchor ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}><Hash className="w-5 h-5" /></button>
      <Popover anchor={qtyAnchor} open={!!qtyAnchor} onClose={() => setQtyAnchor(null)} side="bottom" align="end" width={264} fb="qty-popover">
        <div className="p-1.5 space-y-2">
          <div className="h-12 rounded-xl surface-1 border line px-3 flex items-center justify-between"><span className="text-sm text-soft">{t('الكمية')}</span><span className="num text-2xl font-bold">{pendQty || '1'}</span></div>
          <Numpad mode="integer" size="md" onKey={(k) => setPendQty((cur) => applyNumpadKey(cur, k, { decimals: 0, maxDigits: 3 }).replace(/^0+/, ''))} fb="qty-numpad" />
          <Button variant="primary" size="lg" className="w-full" onClick={() => setQtyAnchor(null)}>{t('اختيار الصنف')}</Button>
        </div>
      </Popover>
    </div>
  );

  const cart = order ? (
    <CheckPanel order={order} refetch={o.refetch} mode="COUNTER" variant="cart" actionRef={checkAction} qty={{ stepper: profile.quantity.stepper, swipe: profile.quantity.swipe }} onCheckSwitch={(id) => go({ orderId: id })} />
  ) : orderId && o.loading ? <Skeleton className="h-full rounded-2xl" /> : (
    <div className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]" data-fb="check-panel">
      <div className="px-4 pt-3 pb-3 border-b line space-y-2.5">
        <div className="font-bold text-lg font-display">{t('طلب جديد')}</div>
        <SegmentedControl full size="lg" value={newType} onChange={setNewType} options={[{ id: 'TAKEAWAY', label: t('تيك أواي'), icon: <ShoppingBag />, fb: 'order-type:TAKEAWAY' }, { id: 'DINE_IN', label: t('صالة'), icon: <Utensils />, fb: 'new-counter-dinein' }]} />
        <SalesChannelPicker orderType={newType} compact fb="counter-channel" label={t('قناة البيع')} value={scPick[newType] ?? ''} onChange={(id) => setScPick({ ...scPick, [newType]: id })} />
      </div>
      <div className="flex-1 flex items-center justify-center"><EmptyState compact icon={<Receipt />} title={t('لا توجد أصناف')} /></div>
      <div className="border-t line px-4 py-3 surface-1 flex items-end justify-between"><span className="font-bold text-base">{t('الإجمالي')}</span><Money v="0" className="text-[28px] leading-none text-dim" /></div>
    </div>
  );

  return (
    <div ref={rootRef} data-screen="C2" className="-m-5 h-[calc(100%+2.5rem)] flex flex-col min-h-0" data-profile={profile.id}>
      <div className="flex-1 min-h-0 flex gap-3 p-3">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {mode === 'sell' ? (
            <MenuGrid size={profile.input === 'keyboard' ? 'md' : 'lg'} channel={order?.channel ?? newType} salesChannelId={order?.salesChannelId ?? (scPick[newType] || null)} disabled={!!order && !editable} onPick={onPick} onOptions={onOptions}
              toolbarStart={modeSwitch} toolbarEnd={qtyControl} />
          ) : (
            <CollectBoard checks={dineChecks} loading={dineOpen.loading} current={orderId} onPick={(c) => go({ orderId: c.id, mode: 'collect' })} toolbarStart={modeSwitch} />
          )}
        </div>
        {narrow ? (
          cartOpen && (
            <div className="fixed inset-x-0 bottom-0 top-12 z-[65] flex items-stretch justify-center p-3" role="dialog" aria-modal aria-label={t('السلة')}>
              <div className="absolute inset-0 glass-overlay" onClick={() => setCartOpen(false)} />
              <div className="relative w-full max-w-md flex flex-col gap-2">
                <div className="flex-1 min-h-0">{cart}</div>
                <Button size="xl" onClick={() => setCartOpen(false)}>{t('إغلاق')}</Button>
              </div>
            </div>
          )
        ) : <div className="w-[38%] min-w-[320px] max-w-[420px] shrink-0 min-h-0">{cart}</div>}
        {narrow && !cartOpen && <div className="hidden">{order && cart}</div>}
      </div>

      <ActionBar secondary={secondary} overflow={overflow} primary={primary} moreKey={keys.more} showKeys={showKeys} moreRef={moreRef}
        start={narrow ? (
          <button onClick={() => setCartOpen(true)} data-fb="cart-pill" className="h-14 px-4 rounded-2xl border border-[var(--glass-border)] surface-1 flex items-center gap-2 shrink-0">
            <Receipt className="w-5 h-5 text-soft" /><span className="num text-sm text-dim">{active.length}</span><Money v={order?.totals?.payable ?? '0'} className="text-lg" />
          </button>
        ) : null} />

      {/* held orders: one tap to switch */}
      <Popover anchor={heldAnchor} open={!!heldAnchor} onClose={() => setHeldAnchor(null)} side="top" align="start" width={320} fb="counter-open-orders">
        <div className="grid gap-0.5">
          {held.map((x) => (
            <button key={x.id} role="menuitem" onClick={() => { setHeldAnchor(null); go({ orderId: x.id, mode: 'sell' }); }} data-fb={`held:${x.number}`} className="h-14 px-3 rounded-xl flex items-center gap-3 text-sm hover:bg-[var(--surface-2)] text-start">
              <span className="num font-bold">#{x.number}</span>
              <span className="flex-1 min-w-0 truncate text-soft">{placeOf(x)}</span>
              {x.status === 'CONFIRMED' && <Pill size="sm" tone="warning">{t('بانتظار الدفع')}</Pill>}
              <Money v={x.settlement?.remaining ?? x.totals.payable} />
            </button>
          ))}
        </div>
      </Popover>

      {pick && <ProductDialog product={pick.product} initialQty={pick.qty} channel={order?.channel ?? newType} salesChannelId={order?.salesChannelId ?? (scPick[newType] || null)} onClose={() => setPick(null)} onAdd={async (l) => { const r = await addLine(l, false); if (r) setPick(null); }} seatsEnabled={!!seatsP.data?.value && !!order?.visitId} guestCount={order?.guestCount} />}
      {payOpen && order && <PaymentPopup orderId={order.id} onClose={() => setPayOpen(false)} onNext={() => { setPayOpen(false); go({ orderId: null }); }} />}
      {keysOpen && <ShortcutsOverlay deviceId={deviceId} labels={actionLabels} profileName={L(profile.role)} onClose={() => setKeysOpen(false)} />}
      {custOpen && order && <CustomerPicker open onClose={() => setCustOpen(false)} onPick={async (c) => { const r = await run('Order.SetCustomer', { params: { orderId: order.id }, body: { expectedVersion: (latest.current?.id === order.id ? latest.current : order).version, customerId: c.id } }, { success: t('أُضيف العميل إلى الشيك') }); if (r) setCustOpen(false); }} />}
      {staffMeal && <StaffMealDialog onClose={() => setStaffMeal(false)} />}
      {meals && <Modal open onClose={() => setMeals(false)} wide title={t('وجبات الموظفين')}><StaffMealsList /></Modal>}
    </div>
  );
}

export function NoDrawer() {
  return <EmptyState icon={<ShoppingBag />} title={t('هذا الجهاز بلا درج نقدية')} />;
}
export function NoShift({ onOpen }: { onOpen: () => void }) {
  return <EmptyState icon={<Wallet />} title={t('لا توجد وردية مفتوحة')} action={<Button variant="primary" size="xl" onClick={onOpen} data-fb="counter-open-shift">{t('فتح وردية')}</Button>} />;
}
