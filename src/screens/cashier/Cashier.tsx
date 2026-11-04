// The sale screen (C2): counter sale and collecting dine-in checks on ONE screen, switched with one tap.
// Layout: product area (search / scanner + categories + large touch grid) | the cart, always visible on the
// reading-end side (left in Arabic, right in English) | the action bar fixed at the bottom. The cart lives in one
// place only; on a narrow pane the total in the action bar opens it.
// Quantity, four ways (each can be switched off by the work profile): a number typed before the item (keyboard or
// the numpad), repeated taps add one, + / − on the line and swipe to remove (with a visible button), long-press on
// an item for quantity / options / note (with a visible ⋯ button). Orders are created on the first item.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingBag, Utensils, Coffee, Bike, Wallet, Send, Receipt, Plus, PauseCircle, UserRound, Tag, ClipboardList, Printer, Gift, Shuffle, XCircle, Ban, History, Keyboard, Hash, X, ArrowRightLeft, Split, Merge, Armchair, PackageX, Undo2, Lock, BadgeCheck, Clock } from 'lucide-react';
import { useDev, useQuery, useCommand, useApprovals } from '../../app/hooks';
import { MenuGrid } from '../order/MenuGrid';
import { ProductDialog, type LineDraft } from '../order/ProductDialog';
import { CheckPanel, type CheckDialog, type LineChange } from '../order/CheckPanel';
import { needsDialog } from '../OrderScreen';
import { Button, Money, Modal, SegmentedControl, Popover, Numpad, applyNumpadKey, Kbd, EmptyState, Skeleton, Pill, Input, useNow } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { addQty, cmpQty, sumQty } from '../../lib/cash';
import { clock } from '../../mock/clock';
import { minutesSince } from '../order/tableStage';
import { profileFor, type SaleAction, type SaleMode } from '../../app/profiles';
import { call } from '../../api/client';
import { DeliveryStartPopup, DeliveryDraftBar, DeliveryQueue, CashierDeliveryBoard, deliveryDrafts } from './DeliveryMode';
import { useHotkeys, useKeymap, type KeyAction } from '../../app/keymap';
import { inScanBurst, burstLength } from '../../app/scanburst';
import { approvalRule } from '../../mock/policies';
import { ActionBar, type BarAction, type PrimaryState } from './ActionBar';
import { PaymentPopup, placeOf } from './PaymentPopup';
import { CollectWorkspace, type CollectView } from './CollectWorkspace';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { StaffMealDialog, StaffMealsList } from '../control/StaffMeal';
import { SalesChannelPicker } from '../channels/common';
import { CustomerPicker } from '../customers/common';
import { customerDisplay } from '../../app/customerDisplay';

type Mode = 'sell' | 'collect' | 'delivery';
const MODE_OF: Record<SaleMode, Mode> = { takeaway: 'sell', dinein: 'collect', delivery: 'delivery' };
// ux-05: each mode remembers its own current check on this device (switching modes never loses a check)
const MEM_KEY = 'nerdpos.saleModeChecks.v1';
let modeMem: Record<string, Partial<Record<Mode, string | null>>> = (() => { try { return JSON.parse(localStorage.getItem(MEM_KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const remember = (deviceId: string, m: Mode, orderId: string | null) => { modeMem = { ...modeMem, [deviceId]: { ...(modeMem[deviceId] ?? {}), [m]: orderId } }; try { localStorage.setItem(MEM_KEY, JSON.stringify(modeMem)); } catch { /* memory only */ } };
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

/** The short "undo" offer for the last unsent-line change (≈5 s), undone with the normal commands. */
type Undo = { id: number; text: string; lock?: boolean; run: () => Promise<any>; label?: string; fb?: string };

export function CashierScreen({ sessionId, staffMealOnOpen, businessDate }: { sessionId: string; staffMealOnOpen?: boolean; businessDate?: string | null }) {
  const { id: deviceId, terminal, nav, params, can, me, auth } = useDev();
  const profile = useMemo(() => profileFor((me?.user?.roleAssignments ?? []).map((r: any) => String(r.roleName ?? '')), terminal?.kind ?? null), [me, terminal]);
  const keys = useKeymap(deviceId);
  const showKeys = profile.input !== 'touch';
  const orderId: string | null = params.orderId ?? null;
  const o = useQuery<any>(orderId ? 'Order.Get' : null, { params: { orderId } });
  const order = o.data && o.data.id === orderId ? o.data : null;
  // ux-05 owner rule: three peer modes — تيك أواي (counter sale), الصالة (collect), دليفري — from the profile
  const allowed: Mode[] = useMemo(() => (profile.saleModes ?? ['takeaway', 'dinein', 'delivery']).map((m) => MODE_OF[m]).filter((m) => m !== 'delivery' || can('delivery:create')), [profile, can]);
  const requested: Mode = params.mode === 'collect' ? 'collect' : params.mode === 'delivery' ? 'delivery' : params.mode === 'sell' ? 'sell' : order?.channel === 'DELIVERY' ? 'delivery' : profile.defaultMode ? MODE_OF[profile.defaultMode] : 'sell';
  const mode: Mode = allowed.includes(requested) ? requested : allowed[0] ?? 'sell';
  const deliveryOn = allowed.includes('delivery');
  const deliveriesQ = useQuery<any>(deliveryOn && can('delivery:read') ? 'Delivery.Board' : null, { query: { scope: 'active' } });
  const deliveryOpen = useQuery<any>(deliveryOn ? 'Order.Find' : null, { query: { channel: 'DELIVERY', lifecycle: 'DRAFT,CONFIRMED' } });
  const [startOpen, setStartOpen] = useState<null | 'new' | 'edit'>(null);
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
  const [labelAnchor, setLabelAnchor] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<CollectView>('tables');
  const [flash, setFlash] = useState<string | null>(null);
  const [undo, setUndoState] = useState<Undo | null>(null);
  const undoSeq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerUndo = (u: Omit<Undo, 'id'>) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const id = ++undoSeq.current;
    setUndoState({ ...u, id });
    undoTimer.current = setTimeout(() => setUndoState((x) => (x?.id === id ? null : x)), 5000);
  };
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  useNow(30000);
  // the customer display of this terminal mirrors the check on screen (lines and totals come from the server there)
  useEffect(() => { customerDisplay.publish(deviceId, { orderId: order?.id ?? orderId ?? null, lastLineId: flash ?? null }); }, [deviceId, orderId, order?.id, order?.version, flash]);
  useEffect(() => () => customerDisplay.publish(deviceId, { orderId: null, lastLineId: null, paying: null }), [deviceId]);
  const checkAction = useRef<((k: CheckDialog) => void) | null>(null);
  const moreRef = useRef<(() => void) | null>(null);

  const go = (p: { orderId?: string | null; mode?: Mode }) => {
    const next: Record<string, any> = {};
    const oid = p.orderId === undefined ? orderId : p.orderId;
    const m = p.mode ?? mode;
    if (oid) next.orderId = oid;
    if (m === 'collect') next.mode = 'collect';
    if (m === 'delivery') next.mode = 'delivery';
    if (m === 'sell' && profile.defaultMode && profile.defaultMode !== 'takeaway') next.mode = 'sell';
    remember(deviceId, m, oid ?? null);
    nav('counter', next);
  };
  /** Switch to a mode and back to the check it was on (if that check is still open). */
  const switchMode = (m: Mode) => {
    if (!allowed.includes(m) || m === mode) return;
    remember(deviceId, mode, orderId);
    const want = modeMem[deviceId]?.[m] ?? null;
    const openIds = new Set<string>([...(counterOpen.data?.items ?? []), ...(dineOpen.data?.items ?? []), ...(deliveryOpen.data?.items ?? [])].map((x: any) => x.id));
    go({ mode: m, orderId: want && openIds.has(want) ? want : null });
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
  const removalLocked = approvalRule('LINE_REMOVE_UNSENT', { branchId: auth.branchId }).mode !== 'NEVER';
  const inCart = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const l of active) (m[l.productId] ??= []).push(l.quantity);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, sumQty(v)]));
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Latest known version of the check and of one of its lines (the undo runs after other changes). */
  const cur = () => (latest.current && latest.current.id === (orderId ?? curId.current) ? latest.current : order);
  const undoQty = (lineId: string, to: string) => async () => {
    const ord = cur(); const l = ord?.lines.find((x: any) => x.id === lineId);
    if (!ord || !l || l.status !== 'ACTIVE') return null;
    if (cmpQty(to, '0') <= 0) return run('Order.RemoveLine', { params: { orderId: ord.id, lineId }, query: { expectedVersion: ord.version, expectedLineVersion: l.version }, body: { expectedVersion: ord.version, expectedLineVersion: l.version } }, { success: t('تم التراجع') });
    const r = await run<any>('Order.UpdateLine', { params: { orderId: ord.id, lineId }, body: { expectedVersion: ord.version, expectedLineVersion: l.version, quantity: to } }, { success: t('تم التراجع') });
    if (r) { latest.current = r; setFlash(lineId); }
    return r;
  };
  const onLineChange = (c: LineChange) => {
    if (c.kind === 'qty') { setFlash(c.lineId); offerUndo({ text: `${L(c.name)}: ${c.from.replace(/\.?0+$/, '')} ← ${c.to}`, run: undoQty(c.lineId, c.from) }); }
    else offerUndo({ text: `${t('حُذف')}: ${L(c.line.name)}`, run: async () => {
      const ord = cur(); if (!ord) return null;
      const l = c.line;
      const r = await run<any>('Order.AddLines', { params: { orderId: ord.id }, body: { expectedVersion: ord.version, lines: [{ productId: l.productId, quantity: l.quantity, modifierOptionIds: (l.modifiers ?? []).map((m: any) => m.optionId), ...(l.variant?.id ? { variantId: l.variant.id } : {}), ...(l.note ? { note: l.note } : {}), ...(l.seat ? { seat: l.seat } : {}) }] } }, { success: t('تم التراجع') });
      if (r) { latest.current = r; const before = new Set(ord.lines.map((x: any) => x.id)); setFlash(r.lines.find((x: any) => !before.has(x.id))?.id ?? null); }
      return r;
    } });
  };

  // ── adding items (serialised so fast taps never race the check version)
  const chain = useRef<Promise<any>>(Promise.resolve());
  const latest = useRef<any>(null);
  const curId = useRef<string | null>(orderId);
  curId.current = orderId ?? (latest.current && curId.current === latest.current.id ? curId.current : null);
  useEffect(() => { if (order && (!latest.current || latest.current.id !== order.id || latest.current.version <= order.version)) latest.current = order; }, [order]);
  const ensureOrder = async (): Promise<any | null> => {
    if (latest.current && latest.current.id === curId.current && latest.current.status === 'DRAFT') return latest.current;
    if (orderId && order && order.status === 'DRAFT' && curId.current === orderId) return order;
    if (mode === 'delivery') { setStartOpen('new'); return null; }
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
    if (r) {
      latest.current = r;
      const before = new Set(ord.lines.map((x: any) => x.id));
      const lineId = same ? same.id : r.lines.find((x: any) => !before.has(x.id))?.id ?? null;
      setFlash(lineId);
      const name = L(r.lines.find((x: any) => x.id === lineId)?.name);
      if (lineId) offerUndo(same
        ? { text: `${name}: ${same.quantity.replace(/\.?0+$/, '')} ← ${addQty(same.quantity, draftLine.quantity)}`, run: undoQty(lineId, same.quantity) }
        : { text: `${t('أُضيف')}: ${name}`, lock: removalLocked, run: undoQty(lineId, '0') });
    }
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
  const sendDelivery = async () => {
    if (!order) return;
    const d = deliveryDrafts.get(order.id);
    if (!order.deliveryId) {
      if (!d) { setStartOpen('edit'); return; }
      const del = await run<any>('Delivery.Create', { body: { orderId: order.id, address: { ...d.address }, customerId: d.customerId, zoneId: d.zoneId ?? undefined, paymentMode: d.payMode } }, { refId: order.id });
      if (!del) return;
    }
    const fresh = await call<any>(auth, 'Order.Get', { params: { orderId: order.id } }).then((r) => r.data).catch(() => null);
    const r = await run<any>('Order.Confirm', { params: { orderId: order.id }, body: { expectedVersion: fresh?.version ?? order.version } }, { success: t('تم الإرسال للمطبخ') });
    if (!r) return;
    deliveryDrafts.drop(order.id);
    if (d?.payMode === 'PAID_ONLINE' && can('payment:capture')) setPayOpen(true);
  };
  const deliveryDraft = !!order && draft && order.channel === 'DELIVERY' && order.kind !== 'STAFF_MEAL';
  const primary: PrimaryState = deliveryDraft
    ? { kind: 'send', label: t('إرسال للمطبخ'), icon: <Send className="rtl:-scale-x-100" />, count: unfired.length || undefined, disabled: busy || !active.length, run: sendDelivery, fb: 'send-delivery', hotkey: keys.primary }
    : !order || !openStatus
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
    new: { id: 'new', label: t('جديد'), icon: <Plus />, fb: 'new-takeaway', run: () => {
      setPendQty(''); curId.current = null;
      // the current order is kept (held) — say so, with one tap back to it
      if (order && draft && active.length && !order.visitId) { const back = order.id; offerUndo({ text: t('عُلِّق الطلب #{n}', { n: order.number }), label: t('استرجاع'), fb: 'park-back', run: async () => { go({ orderId: back, mode: 'sell' }); return true; } }); }
      go({ orderId: null, mode: 'sell' });
    } },
    label: { id: 'label', label: t('تسمية الطلب'), icon: <BadgeCheck />, fb: 'bar:label', disabled: (!!order && !openStatus) || !can('order:updatedetails'), run: async (a) => { if (await ensureOrder()) setLabelAnchor(a ?? document.querySelector<HTMLElement>(`[data-device="${deviceId}"] [data-fb="bar:more"]`)); } },
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
  // the «دليفري» overflow action goes away when the profile has the delivery mode (delivery-new stays for dispatchers)
  const overflow = profile.actionBar.overflow.map((id) => defs[id]).filter((a): a is BarAction => !!a && !(a.id === 'delivery' && (!can('delivery:create') || deliveryOn))).map(withKey);

  const focusSearch = () => (document.querySelector(`[data-device="${deviceId}"] [data-fb="menu-search"]`) as HTMLInputElement | null)?.focus();
  const focusCollect = () => (document.querySelector(`[data-device="${deviceId}"] [data-fb="collect-search"] input, [data-device="${deviceId}"] input[data-fb="collect-search"]`) as HTMLInputElement | null)?.focus();
  // Ctrl+Z = تراجع while the undo is offered (keyboard parity with the toast button)
  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || !undoRef.current) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault(); runUndo();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const runUndo = async () => { const u = undoRef.current; if (!u) return; setUndoState(null); await u.run(); };
  const toggleMode = () => switchMode(allowed[(allowed.indexOf(mode) + 1) % allowed.length]);
  useHotkeys(deviceId, !payOpen, {
    primary: () => !primary.disabled && primary.run(),
    new: defs.new?.run as () => void,
    held: () => { const el = document.querySelector<HTMLElement>(`[data-device="${deviceId}"] [data-fb="bar:held"]`); if (held.length) setHeldAnchor(el); },
    customer: () => !defs.customer?.disabled && defs.customer?.run?.(null),
    discount: () => !defs.discount?.disabled && defs.discount?.run?.(null),
    orders: () => defs.orders?.run?.(null),
    more: () => moreRef.current?.(),
    mode: toggleMode,
    modeTakeaway: () => switchMode('sell'),
    modeDineIn: () => switchMode('collect'),
    modeDelivery: () => switchMode('delivery'),
    search: () => { if (mode !== 'sell') return focusCollect(); setTimeout(focusSearch, 50); },
    shortcuts: () => setKeysOpen(true),
    viewTables: () => { if (!allowed.includes('collect')) return; if (mode !== 'collect') switchMode('collect'); setView('tables'); },
    viewChecks: () => { if (!allowed.includes('collect')) return; if (mode !== 'collect') switchMode('collect'); setView('checks'); setTimeout(focusCollect, 60); },
    viewClosed: () => { if (!allowed.includes('collect')) return; if (mode !== 'collect') switchMode('collect'); setView('closed'); },
  });

  const actionLabels: Partial<Record<KeyAction, string>> = { primary: t('الزر الرئيسي'), shortcuts: t('الاختصارات'), new: t('طلب جديد'), held: t('الطلبات المعلقة'), customer: t('العميل'), discount: t('الخصم'), orders: t('الطلبات'), more: t('المزيد'), mode: t('الوضع التالي'), modeTakeaway: t('وضع تيك أواي'), modeDineIn: t('وضع الصالة'), modeDelivery: t('وضع دليفري'), search: t('البحث'), viewTables: t('تحصيل: الترابيزات'), viewChecks: t('تحصيل: الشيكات'), viewClosed: t('تحصيل: المغلقة اليوم') };

  const activeDeliveries: any[] = (deliveriesQ.data?.items ?? []).filter((d: any) => d.state !== 'DELIVERED' && d.state !== 'CANCELLED');
  const modeOpts = ([
    { id: 'sell' as Mode, label: t('تيك أواي'), icon: <ShoppingBag />, fb: 'mode:sell' },
    { id: 'collect' as Mode, label: t('الصالة'), icon: <Armchair />, count: dineChecks.length || undefined, fb: 'mode:collect' },
    { id: 'delivery' as Mode, label: t('دليفري'), icon: <Bike />, count: activeDeliveries.length || undefined, fb: 'mode:delivery' },
  ]).filter((x) => allowed.includes(x.id));
  const modeSwitch = modeOpts.length > 1 ? <SegmentedControl size="lg" value={mode} onChange={(m) => switchMode(m)} className="shrink-0" options={modeOpts} /> : null;
  const qtyControl = profile.quantity.typedPrefix && (
    <div className="flex items-center gap-1 shrink-0">
      {pendQty && <span className="h-12 ps-3.5 pe-1 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] font-bold inline-flex items-center gap-1 shadow-[0_4px_16px_-6px_var(--primary-glow)] animate-scale-in" data-fb="qty-pending" title={t('الكمية للصنف التالي')}><span className="num text-xl" dir="ltr">× {pendQty}</span>{showKeys && <Kbd className="!bg-black/10 !border-black/10 !text-current ms-1">Esc</Kbd>}<button onClick={() => setPendQty('')} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/10" aria-label={t('مسح الكمية')}><X className="w-4 h-4" /></button></span>}
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
    <CheckPanel order={order} refetch={o.refetch} mode="COUNTER" variant="cart" actionRef={checkAction} qty={{ stepper: profile.quantity.stepper, swipe: profile.quantity.swipe }} onCheckSwitch={(id) => go({ orderId: id })} onLineChange={onLineChange} flashLineId={flash} />
  ) : orderId && o.loading ? <Skeleton className="h-full rounded-2xl" /> : mode === 'delivery' ? (
    <div className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]" data-fb="check-panel">
      <div className="px-4 pt-3 pb-3 border-b line"><div className="font-bold text-lg font-display">{t('طلب دليفري جديد')}</div></div>
      <div className="flex-1 flex items-center justify-center p-4"><Button variant="primary" size="xl" onClick={() => setStartOpen('new')} disabled={!can('delivery:create')} data-fb="delivery-start-cart"><Bike className="w-5 h-5" />{t('بدء بالعميل')}</Button></div>
      <div className="border-t line px-4 py-3 surface-1 flex items-end justify-between"><span className="font-bold text-base">{t('الإجمالي')}</span><Money v="0" className="text-[28px] leading-none text-dim" /></div>
    </div>
  ) : (
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
    <div ref={rootRef} data-screen="C2" className="relative -m-5 h-[calc(100%+2.5rem)] flex flex-col min-h-0" data-profile={profile.id} data-mode={mode}>
      <div className="flex-1 min-h-0 flex gap-3 p-3">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {mode === 'delivery' ? (
            deliveryDraft ? (
              <div className="flex-1 min-h-0 flex gap-3">
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                  <MenuGrid size={profile.input === 'keyboard' ? 'md' : 'lg'} channel="DELIVERY" salesChannelId={order?.salesChannelId ?? null} disabled={!editable} onPick={onPick} onOptions={onOptions}
                    toolbarStart={<>{modeSwitch}<DeliveryDraftBar orderId={order!.id} delivery={null} onEdit={() => setStartOpen('edit')} /></>} toolbarEnd={qtyControl} inCart={inCart} />
                </div>
                {width >= 1180 && <div className="w-[290px] shrink-0 min-h-0"><DeliveryQueue list={activeDeliveries} current={orderId} onOpenCheck={(d) => go({ orderId: d.orderId, mode: 'delivery' })} /></div>}
              </div>
            ) : (
              <CashierDeliveryBoard list={activeDeliveries} loading={!!deliveriesQ.loading && !deliveriesQ.data} onNew={() => setStartOpen('new')} onOpenCheck={(d) => go({ orderId: d.orderId, mode: 'delivery' })} toolbarStart={modeSwitch} />
            )
          ) : mode === 'sell' ? (
            <MenuGrid size={profile.input === 'keyboard' ? 'md' : 'lg'} channel={order?.channel ?? newType} salesChannelId={order?.salesChannelId ?? (scPick[newType] || null)} disabled={!!order && !editable} onPick={onPick} onOptions={onOptions}
              toolbarStart={modeSwitch} toolbarEnd={qtyControl} inCart={inCart} />
          ) : (
            <CollectWorkspace view={view} onView={setView} current={orderId} sessionId={sessionId} businessDate={businessDate ?? null} showKeys={showKeys} keys={keys} onPick={(c) => go({ orderId: c.id, mode: 'collect' })} toolbarStart={modeSwitch} />
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
          {[...held].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((x) => {
            const age = minutesSince(x.createdAt, clock.now());
            const who = x.label || x.customerName || x.customer?.name || '';
            return (
              <button key={x.id} role="menuitem" onClick={() => { setHeldAnchor(null); go({ orderId: x.id, mode: 'sell' }); }} data-fb={`held:${x.number}`} className="min-h-14 py-1.5 px-3 rounded-xl flex items-center gap-3 text-sm hover:bg-[var(--surface-2)] text-start">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-2 min-w-0"><span className="font-bold truncate" data-fb={`held-name:${x.number}`}>{who || placeOf(x)}</span>{x.status === 'CONFIRMED' && <Pill size="sm" tone="warning">{t('بانتظار الدفع')}</Pill>}</span>
                  <span className="text-xs text-dim flex items-center gap-1.5"><span className="num">#{x.number}</span>{who && <span>· {placeOf(x)}</span>}{age !== null && <span className={cn('inline-flex items-center gap-0.5', age >= 15 && 'text-[var(--warning-text)] font-bold')}>· <Clock className="w-3 h-3" /><span className="num">{age}</span>{t('د')}</span>}</span>
                </span>
                <Money v={x.settlement?.remaining ?? x.totals.payable} />
              </button>
            );
          })}
        </div>
      </Popover>

      {pick && <ProductDialog product={pick.product} initialQty={pick.qty} channel={order?.channel ?? newType} salesChannelId={order?.salesChannelId ?? (scPick[newType] || null)} onClose={() => setPick(null)} onAdd={async (l) => { const r = await addLine(l, false); if (r) setPick(null); }} seatsEnabled={!!seatsP.data?.value && !!order?.visitId} guestCount={order?.guestCount} />}
      {payOpen && order && <PaymentPopup orderId={order.id} onClose={() => setPayOpen(false)} onNext={() => { setPayOpen(false); go({ orderId: null }); setTimeout(() => (mode === 'sell' ? focusSearch() : focusCollect()), 120); }} />}
      {labelAnchor && order && <LabelPopover anchor={labelAnchor} value={order.label ?? ''} onClose={() => setLabelAnchor(null)} onSave={async (v) => { const ord = cur() ?? order; const r = await run<any>('Order.UpdateDetails', { params: { orderId: ord.id }, body: { expectedVersion: ord.version, label: v } }, { success: t('تم حفظ اسم الطلب') }); if (r) { latest.current = r; setLabelAnchor(null); } }} />}
      {undo && (
        <div className="absolute z-[60] bottom-[84px] end-3 w-[min(400px,calc(100%-1.5rem))] undo-in" data-fb="undo-toast" role="status" aria-live="polite">
          <div className="toast-card rounded-2xl ps-4 pe-1.5 py-1.5 flex items-center gap-2 shadow-lg">
            <span className="flex-1 min-w-0 text-sm font-semibold truncate">{undo.text}</span>
            <button onClick={runUndo} data-fb={undo.fb ?? 'undo'} className="h-11 px-4 rounded-xl font-bold text-[var(--primary)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1.5 shrink-0" title={undo.lock ? t('يتطلب موافقة') : undefined}>
              {undo.lock ? <Lock className="w-3.5 h-3.5 text-[var(--warning-text)]" /> : <Undo2 className="w-4 h-4" />}{undo.label ?? t('تراجع')}{showKeys && !undo.label && <Kbd className="ms-0.5">Ctrl Z</Kbd>}
            </button>
            <button onClick={() => setUndoState(null)} className="w-9 h-9 rounded-lg flex items-center justify-center text-dim hover:bg-[var(--surface-2)] shrink-0" aria-label={t('إغلاق')}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {startOpen === 'new' && <DeliveryStartPopup onClose={() => setStartOpen(null)} onStarted={(id) => { setStartOpen(null); latest.current = null; curId.current = id; go({ orderId: id, mode: 'delivery' }); setTimeout(focusSearch, 120); }} />}
      {startOpen === 'edit' && order && <DeliveryStartPopup onClose={() => setStartOpen(null)} onStarted={() => setStartOpen(null)} edit={{ orderId: order.id, draft: deliveryDrafts.get(order.id) ?? { customerId: order.customerId ?? order.customer?.id ?? '', customerName: order.customer?.name ?? '', phone: order.customer?.phone ?? '', address: null, zoneId: null, payMode: 'CASH_ON_DELIVERY' } }} />}
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

/** Name the current order quickly (e.g. «أحمد – سيارة بيضاء»): one field, Enter saves, Esc closes. */
function LabelPopover({ anchor, value, onClose, onSave }: { anchor: HTMLElement | null; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <Popover anchor={anchor} open onClose={onClose} side="top" align="start" width={340} fb="label-popover" label={t('تسمية الطلب')}>
      <form className="p-1.5 space-y-2" onSubmit={(e) => { e.preventDefault(); if (v.trim() !== value) onSave(v.trim()); }}>
        <div className="text-sm font-bold">{t('اسم الطلب')}</div>
        <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} maxLength={40} data-fb="order-label" className="!h-12 text-base" />
        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={v.trim() === value} data-fb="order-label-save">{t('حفظ')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button>
      </form>
    </Popover>
  );
}
