// Call-center delivery order: phone lookup → customer card (or quick create) → address and zone → menu →
// totals with the delivery fee (from the server) → payment (cash on delivery / paid online / card on delivery) → send.
import { SalesChannelPicker, SalesChannelTag } from '../channels/common'; // r3C sales channels
import React, { useEffect, useMemo, useState } from 'react';
import { PhoneCall, Search, UserPlus, MapPin, Plus, Minus, Trash2, Send, CheckCircle2, Bike, Globe, Banknote, CreditCard, Star, ArrowRight, RotateCcw, ShoppingBag, ClipboardCheck, AlertTriangle, ChevronDown, UserRoundPen } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { MenuGrid } from '../order/MenuGrid';
import { ProductDialog, type LineDraft } from '../order/ProductDialog';
import { needsDialog } from '../OrderScreen';
import { Button, Card, Pill, Banner, Money, Field, Input, Textarea, Spinner, Empty, StateBadge, Modal, Switch, Stepper, toast } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L, tv } from '../../i18n';
import { cn, money, qty, time, dateTime } from '../../lib/format';
import { CustomerRow, CustomerPicker, TierBadge, TagPills, AllergyWarning, AddressForm, EMPTY_ADDRESS, cleanAddress, addressText, useZones } from '../customers/common';
import { PAYMENT_MODE } from './common';

type PayMode = 'CASH_ON_DELIVERY' | 'PAID_ONLINE' | 'CARD_ON_DELIVERY';

export default function NewDelivery() {
  const { params, nav, terminal } = useDev();
  const session = useQuery<any>(terminal?.drawer ? 'Session.Current' : null, { query: { terminalId: terminal?.id } });
  const set = (p: Record<string, any>) => nav('delivery-new', { ...params, ...p });
  if (!terminal?.drawer) return <Banner tone="warning">{t('طلبات الدليفري بتتعمل من جهاز الكاشير (فيه درج) — الطلب بيتسجل على وردية الدرج.')}</Banner>;
  if (session.loading && !session.data) return <Spinner />;
  if (!session.data) return (
    <div data-screen="DL1" className="space-y-3">
      <h1 className="text-2xl font-bold">{t('طلب دليفري جديد')}</h1>
      <Banner tone="warning" action={<Button variant="primary" size="sm" onClick={() => nav('shift')}>{t('افتح وردية')}</Button>}>{t('مفيش وردية درج مفتوحة على الجهاز ده. افتح الوردية الأول عشان تاخد طلبات.')}</Banner>
    </div>
  );
  if (params.doneDeliveryId) return <Done deliveryId={params.doneDeliveryId} onNew={() => nav('delivery-new', {})} />;
  return <Workspace params={params} set={set} />;
}

function Workspace({ params, set }: { params: Record<string, any>; set: (p: Record<string, any>) => void }) {
  const { nav } = useDev();
  const { run, busy } = useCommand();
  const { zoneOf } = useZones();
  const customerQ = useQuery<any>(params.customerId ? 'Customer.Get' : null, { params: { customerId: params.customerId } });
  const orderQ = useQuery<any>(params.orderId ? 'Order.Get' : null, { params: { orderId: params.orderId } });
  const deliveryQ = useQuery<any>(orderQ.data?.deliveryId ? 'Delivery.Get' : null, { params: { deliveryId: orderQ.data?.deliveryId } });
  const cust = customerQ.data;
  const order = orderQ.data;
  const delivery = deliveryQ.data && deliveryQ.data.state !== 'CANCELLED' ? deliveryQ.data : null;
  const addresses: any[] = cust?.addresses ?? [];
  const address = addresses.find((a) => a.id === params.addressId) ?? null;
  const zone = address ? zoneOf(address.area) : null;
  const payMode: PayMode = params.payMode ?? 'CASH_ON_DELIVERY';
  const [pick, setPick] = useState<any>(null);
  const [note, setNote] = useState('');
  const [payOnline, setPayOnline] = useState(false);
  const ready = !!cust && !!address && !!zone && zone.active;
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 1080));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // pick the default address when a customer is chosen
  useEffect(() => {
    if (cust && !params.addressId && addresses.length) set({ addressId: (addresses.find((a) => a.isDefault) ?? addresses[0]).id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cust?.id]);

  const addLine = async (l: LineDraft) => {
    if (!ready) { toast('warning', t('اختار العميل وعنوان التوصيل الأول')); return; }
    let o = order;
    if (!o) {
      o = await run<any>('Order.Create', { body: { channel: 'DELIVERY', customerId: cust.id, note: note || undefined, ...(params.salesChannelId ? { salesChannelId: params.salesChannelId } : {}) } }, { label: t('طلب دليفري') });
      if (!o) return;
      set({ orderId: o.id });
    }
    const r = await run('Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: o.version, lines: [l] } });
    if (r) setPick(null);
  };
  const review = async () => {
    if (!order || !address) return;
    await run('Delivery.Create', { body: { orderId: order.id, address: { ...address }, customerId: cust.id, paymentMode: payMode, note: note || undefined } }, { success: t('رسوم التوصيل اتضافت — راجع وابعت') });
  };
  const send = async () => {
    if (!order) return;
    const fresh = order;
    const r = await run<any>('Order.Confirm', { params: { orderId: fresh.id }, body: { expectedVersion: fresh.version } }, { success: t('الطلب اتبعت للمطبخ') });
    if (!r) return;
    if (payMode === 'PAID_ONLINE') setPayOnline(true);
    else set({ doneDeliveryId: delivery?.id, orderId: undefined });
  };
  const reset = () => nav('delivery-new', {});

  const step = !cust ? 0 : !address ? 1 : !order?.lines?.length ? 2 : !delivery ? 3 : 4;
  return (
    <div data-screen="DL1" className="h-full flex flex-col gap-3 min-h-0" ref={rootRef}>
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <h1 className="text-[22px] font-extrabold tracking-tight me-2 flex items-center gap-2"><PhoneCall className="w-5 h-5 text-[var(--primary)]" />{t('طلب دليفري جديد')}</h1>
        <StateBadge ops={['Customer.Search', 'Customer.Create', 'CustomerAddress.Upsert', 'Order.Create', 'Delivery.Create', 'Order.Confirm', 'Payment.AuthorizeExternal']} />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => nav('delivery-board')}><Bike className="w-4 h-4" />{t('لوحة الدليفري')}</Button>
        {(params.customerId || params.orderId) && !order?.lines?.length && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="w-4 h-4" />{t('ابدأ من الأول')}</Button>}
      </div>
      <Stepper className="shrink-0" current={step} steps={[{ label: t('العميل') }, { label: t('العنوان') }, { label: t('الأصناف') }, { label: t('مراجعة التوصيل') }, { label: t('ابعت للمطبخ') }]} />
      {/* round 3 (F2-07): one compact customer line (name, phone, tier, alerts, address, payment) — expand for details,
          addresses and history — so the menu and the cart get the screen */}
      <CustomerBar cust={cust} loading={customerQ.loading} locked={!!order?.lines?.length} lockedDelivery={!!delivery} onPick={(c) => set({ customerId: c.id, addressId: undefined })}
        addressId={params.addressId} onAddress={(id) => set({ addressId: id })} zone={zone} payMode={payMode} onPayMode={(m) => set({ payMode: m })} note={note} onNote={setNote} />
      <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: wide ? 'minmax(0, 1fr) minmax(320px, 360px)' : 'minmax(0, 1fr) minmax(270px, 300px)' }}>
        {/* menu */}
        <div className="min-h-0 flex flex-col gap-2">
          {!ready && cust && (
            <Banner tone={address && !zone ? 'warning' : 'info'}>
              {!cust ? t('ابدأ برقم موبايل العميل — لو مش متسجل اعمله في ثانية.') : !address ? t('اختار عنوان التوصيل أو ضيف عنوان جديد.') : !zone ? t('العنوان ده برة مناطق التوصيل. اختار عنوان تاني أو خليه تيك أواي.') : t('التوصيل للمنطقة دي واقف دلوقتي.')}
            </Banner>
          )}
          {/* r3C: pick the sales channel (دليفري / طلبات …) before the first item; it fixes the price list of this order */}
          {!order?.lines?.length ? <SalesChannelPicker orderType="DELIVERY" fb="delivery-channel" value={params.salesChannelId ?? ''} onChange={(id) => set({ salesChannelId: id || undefined })} /> : <SalesChannelTag id={order?.salesChannelId} />}
          <div className="flex-1 min-h-0"><MenuGrid channel="DELIVERY" salesChannelId={order?.salesChannelId ?? params.salesChannelId ?? null} disabled={!ready || busy || (order && order.status !== 'DRAFT')} onPick={(p) => (needsDialog(p) ? setPick(p) : addLine({ productId: p.id, quantity: '1', modifierOptionIds: [] }))} /></div>
        </div>

        {/* order */}
        <OrderSide order={order} zone={zone} delivery={delivery} busy={busy} onReview={review} onSend={send} cust={cust} />
      </div>
      {pick && <ProductDialog product={pick} channel="DELIVERY" salesChannelId={order?.salesChannelId ?? params.salesChannelId ?? null} onClose={() => setPick(null)} onAdd={addLine} />}
      {payOnline && order && <PayOnlineDialog order={order} onClose={(paid) => { setPayOnline(false); set({ doneDeliveryId: delivery?.id, orderId: undefined, paidOnline: paid ? '1' : undefined }); }} />}
    </div>
  );
}

/** Round 3 (F2-07): the customer as ONE compact line — name, phone, tier, alerts, address (zone + fee) and payment —
 * with «تفاصيل» to expand notes, tags, history and address management. Before a customer is chosen it is the phone
 * lookup itself. The menu and the cart keep the rest of the screen. */
function CustomerBar({ cust, loading, locked, lockedDelivery, onPick, addressId, onAddress, zone, payMode, onPayMode, note, onNote }: {
  cust: any; loading: boolean; locked: boolean; lockedDelivery: boolean; onPick: (c: any) => void; addressId?: string; onAddress: (id: string) => void; zone: any;
  payMode: PayMode; onPayMode: (m: PayMode) => void; note: string; onNote: (v: string) => void;
}) {
  const { zoneOf } = useZones();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState(false);
  const [open, setOpen] = useState(false);
  const isPhone = /^[\d+\s٠-٩-]+$/.test(q.trim());
  const res = useQuery<any>(!cust && q.trim().length >= 3 ? 'Customer.Search' : null, { query: isPhone ? { phone: q.trim(), limit: 6 } : { text: q.trim(), limit: 6 } });
  const items: any[] = res.data?.items ?? [];
  const addresses: any[] = cust?.addresses ?? [];
  const address = addresses.find((a) => a.id === addressId) ?? null;
  // open the details by itself when something needs attention (no address yet / outside the zones)
  useEffect(() => { if (cust && (!addresses.length || (address && !zoneOf(address.area)))) setOpen(true); }, [cust?.id, addresses.length, addressId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !cust) return <div className="shrink-0 h-14 rounded-2xl surface-1 border border-[var(--glass-border)] flex items-center px-4"><Spinner /></div>;
  if (!cust) return (
    <div className="shrink-0 relative rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-3 py-2 flex items-center gap-2 flex-wrap" data-fb="customer-bar">
      <span className="text-xs font-bold text-soft shrink-0">{t('١. العميل')}</span>
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-dim" />
        <Input autoFocus data-fb="phone-lookup" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('رقم الموبايل أو الاسم…')} className="ps-9 h-10 text-lg num" inputMode="tel" dir="ltr" />
        {q.trim().length >= 3 && (
          <div className="absolute z-40 mt-1 w-full min-w-[300px] overlay-panel rounded-xl p-1.5 shadow-xl space-y-1">
            {res.loading && <Spinner />}
            {items.map((c) => <CustomerRow key={c.id} c={c} onClick={() => onPick(c)} />)}
            {!res.loading && !items.length && <div className="text-sm text-dim text-center py-2">{t('الرقم ده مش متسجل')}</div>}
          </div>
        )}
      </div>
      <Button variant={q.trim().length >= 3 && !items.length ? 'primary' : 'outline'} onClick={() => setCreating(true)} data-fb="customer-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}</Button>
      <CustomerPicker open={creating} createFirst initialPhone={isPhone ? q.trim() : ''} title={t('عميل جديد')} onClose={() => setCreating(false)} onPick={(c) => { setCreating(false); onPick(c); }} />
    </div>
  );
  const z = address ? zoneOf(address.area) : null;
  return (
    <div className="shrink-0 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]" data-fb="customer-card">
      <div className="px-3 py-2 flex items-center gap-x-2.5 gap-y-2 flex-wrap min-h-[56px]" data-fb="customer-bar">
        {/* who */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-9 h-9 rounded-full surface-3 flex items-center justify-center font-bold shrink-0">{cust.name.slice(0, 1)}</span>
          <div className="min-w-0 leading-tight">
            <div className="font-bold flex items-center gap-1.5 min-w-0"><span className="truncate max-w-[160px]" data-fb="customer-name">{cust.name}</span><TierBadge tier={cust.loyalty?.tier} /></div>
            <div className="text-[11px] text-dim num truncate" dir="ltr" style={{ textAlign: 'start' }}>{cust.phone}{cust.altPhone ? ` · ${cust.altPhone}` : ''}</div>
          </div>
        </div>
        {/* alerts */}
        <div className="flex items-center gap-1.5 min-w-0" data-fb="customer-alerts">
          {cust.allergies?.length > 0 && <Pill tone="warning" title={t('حساسية')}><AlertTriangle className="w-3 h-3" />{t('حساسية')}: {cust.allergies.length}</Pill>}
          {tv(cust.notes) && <button type="button" onClick={() => setOpen(true)} title={tv(cust.notes)} className="max-w-[120px] truncate text-[11px] rounded-full surface-1 border border-[var(--glass-border)] px-2 h-[22px]">✎ {tv(cust.notes)}</button>}
          <span className="text-[11px] text-dim whitespace-nowrap num">{t('{n} طلب', { n: cust.stats.orders })} · <span className="text-[var(--primary)] font-bold">{cust.loyalty.balance}</span> {t('نقطة')}</span>
        </div>
        {/* address */}
        <div className="flex items-center gap-1.5 min-w-0 ms-auto">
          <MapPin className="w-4 h-4 text-dim shrink-0" />
          {addresses.length ? (
            <select data-fb="address-select" disabled={lockedDelivery} value={addressId ?? ''} onChange={(e) => onAddress(e.target.value)} className="glass-input !h-9 !py-0 !text-sm max-w-[230px] min-w-[150px]">
              {!address && <option value="">{t('اختار العنوان')}</option>}
              {addresses.map((a) => { const zz = zoneOf(a.area); return <option key={a.id} value={a.id}>{`${a.label ?? t('عنوان')} — ${a.area}${zz ? ` · ${L(zz.name)} ${money(zz.fee)}` : ` · ${t('برة المناطق')}`}`}</option>; })}
            </select>
          ) : <span className="text-xs text-[var(--warning-text)]">{t('مفيش عنوان — ضيف واحد')}</span>}
          {z ? <Pill tone="neutral" size="sm"><span className="w-2 h-2 rounded-full" style={{ background: z.color }} />{money(z.fee)}</Pill> : address ? <Pill tone="warning" size="sm">{t('برة مناطق التوصيل')}</Pill> : null}
        </div>
        {/* payment */}
        {address && (
          <div className="flex items-center gap-1 p-0.5 rounded-xl surface-1 border border-[var(--glass-border)]" role="radiogroup" aria-label={t('الدفع')}>
            {(Object.keys(PAYMENT_MODE) as PayMode[]).map((m) => { const P = PAYMENT_MODE[m]; return (
              <button key={m} role="radio" aria-checked={payMode === m} disabled={lockedDelivery} onClick={() => onPayMode(m)} data-fb={`paymode:${m}`} title={t(P.ar)}
                className={cn('h-8 px-2 rounded-lg text-xs flex items-center gap-1 disabled:opacity-60', payMode === m ? 'bg-[var(--primary-container)] text-[var(--primary)] font-bold' : 'text-soft hover:text-[var(--foreground)]')}>
                <P.icon className="w-3.5 h-3.5" />{payMode === m && <span className="whitespace-nowrap">{t(P.ar)}</span>}
              </button>
            ); })}
          </div>
        )}
        {note && !open && <span className="text-[11px] text-[var(--warning-text)] max-w-[140px] truncate" title={note}>✎ {note}</span>}
        <div className="flex items-center gap-1">
          {!locked && <Button size="sm" variant="ghost" data-fb="customer-change" title={t('تغيير العميل')} aria-label={t('تغيير العميل')} onClick={() => setChanging(true)}><UserRoundPen className="w-4 h-4" /></Button>}
          <Button size="sm" variant={open ? 'subtle' : 'ghost'} data-fb="customer-expand" aria-expanded={open} onClick={() => setOpen(!open)}>{t('تفاصيل')}<ChevronDown className={cn('w-4 h-4 transition-transform', open && 'rotate-180')} /></Button>
        </div>
      </div>
      {open && (
        <div className="border-t line p-3 grid gap-3 grid-cols-1 @3xl/main:grid-cols-3" data-fb="customer-details">
          <div className="space-y-2 min-w-0">
            <AllergyWarning allergies={cust.allergies} />
            {tv(cust.notes) && <div className="text-xs rounded-lg surface-1 px-2.5 py-1.5">✎ {tv(cust.notes)}</div>}
            <TagPills tags={cust.tags} />
            <div className="grid grid-cols-3 gap-1.5 text-center">
              <div className="rounded-lg surface-1 py-1.5"><div className="text-[10px] text-dim">{t('طلبات')}</div><div className="font-bold num">{cust.stats.orders}</div></div>
              <div className="rounded-lg surface-1 py-1.5"><div className="text-[10px] text-dim">{t('النقاط')}</div><div className="font-bold num text-[var(--primary)]">{cust.loyalty.balance}</div></div>
              <div className="rounded-lg surface-1 py-1.5"><div className="text-[10px] text-dim">{t('آخر طلب')}</div><div className="font-bold text-[11px]">{cust.stats.lastOrderAt ? dateTime(cust.stats.lastOrderAt) : '—'}</div></div>
            </div>
            {cust.stats.favourite && <div className="text-[11px] text-dim">{t('بيطلب غالبًا')}: <b className="text-soft">{cust.stats.favourite}</b></div>}
            {cust.orders?.length > 0 && <div className="text-[11px] text-dim">{t('آخر طلب')}: {L({ ar: cust.orders[0].items, en: cust.orders[0].itemsEn })}</div>}
          </div>
          <div className="min-w-0"><AddressStep cust={cust} selected={addressId} locked={lockedDelivery} onSelect={onAddress} /></div>
          <div className="space-y-2 min-w-0">
            <Field label={t('ملاحظة للطيار / المطبخ')}><Input data-fb="delivery-note" value={note} onChange={(e) => onNote(e.target.value)} disabled={lockedDelivery} placeholder={t('مثلاً: الجرس بايظ — كلّمه')} /></Field>
            {lockedDelivery && <div className="text-[11px] text-dim">{t('العنوان وطريقة الدفع اتثبتوا مع التوصيل.')}</div>}
            {zone && <div className="text-[11px] text-dim">{t('المنطقة')}: <b className="text-soft">{L(zone.name)}</b> · {t('رسوم التوصيل')} <span className="num">{money(zone.fee)}</span> · {t('الحد الأدنى')} <span className="num">{money(zone.minOrder)}</span></div>}
          </div>
        </div>
      )}
      <CustomerPicker open={changing} onClose={() => setChanging(false)} onPick={(c) => { setChanging(false); onPick(c); }} />
    </div>
  );
}

function AddressStep({ cust, selected, locked, onSelect }: { cust: any; selected?: string; locked: boolean; onSelect: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { zoneOf } = useZones();
  const [adding, setAdding] = useState(!cust.addresses.length);
  const [addr, setAddr] = useState<any>({ ...EMPTY_ADDRESS });
  useEffect(() => { setAdding(!cust.addresses.length); }, [cust.id]);
  const save = async () => {
    const r = await run<any>('CustomerAddress.Upsert', { params: { customerId: cust.id, addressId: 'new' }, body: { address: cleanAddress(addr), label: addr.label || undefined, active: true } }, { success: t('العنوان اتسجل') });
    if (r) { setAdding(false); setAddr({ ...EMPTY_ADDRESS }); onSelect(r.id); }
  };
  return (
    <Card title={t('٢. عنوان التوصيل')} actions={!adding && !locked && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="w-3.5 h-3.5" />{t('عنوان جديد')}</Button>}>
      <div className="space-y-1.5">
        {cust.addresses.map((a: any) => {
          const z = zoneOf(a.area);
          return (
            <button key={a.id} disabled={locked} onClick={() => onSelect(a.id)} data-fb={`address:${a.id}`} className={cn('w-full text-start rounded-xl border px-3 py-2 text-sm disabled:opacity-70', selected === a.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>
              <div className="flex items-center justify-between gap-2"><b>{a.label ?? t('عنوان')}</b>{z ? <Pill tone="neutral"><MapPin className="w-3 h-3" style={{ color: z.color }} />{L(z.name)} · {money(z.fee)}</Pill> : <Pill tone="warning">{t('برة مناطق التوصيل')}</Pill>}</div>
              <div className="text-xs text-soft mt-0.5">{addressText(a)}</div>
            </button>
          );
        })}
        {adding && (
          <div className="rounded-xl border border-dashed line p-2.5 space-y-2">
            <AddressForm value={addr} onChange={setAddr} compact />
            <div className="flex gap-2 justify-end">{cust.addresses.length > 0 && <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('إلغاء')}</Button>}<Button size="sm" variant="primary" loading={busy} disabled={!addr.area.trim() || !addr.street.trim()} onClick={save} data-fb="address-save">{t('حفظ العنوان')}</Button></div>
          </div>
        )}
      </div>
    </Card>
  );
}

function OrderSide({ order, zone, delivery, busy, onReview, onSend, cust }: { order: any; zone: any; delivery: any; busy: boolean; onReview: () => void; onSend: () => void; cust: any }) {
  const { run } = useCommand();
  const lines: any[] = (order?.lines ?? []).filter((l: any) => l.status === 'ACTIVE');
  const T = order?.totals;
  const net = T ? Number(T.itemsSubtotal) : 0; // progress toward the zone minimum (display only; the server decides)
  const min = zone ? Number(zone.minOrder) : 0;
  const pct = min ? Math.min(100, Math.round((net / min) * 100)) : 100;
  const qtyChange = (l: any, d: number) => {
    const n = Math.round(Number(l.quantity) + d);
    if (n < 1) return run('Order.RemoveLine', { params: { orderId: order.id, lineId: l.id }, query: { expectedVersion: order.version, expectedLineVersion: l.version }, body: { expectedVersion: order.version, expectedLineVersion: l.version } });
    return run('Order.UpdateLine', { params: { orderId: order.id, lineId: l.id }, body: { expectedVersion: order.version, expectedLineVersion: l.version, quantity: String(n) } });
  };
  return (
    <div className="min-h-0 flex flex-col rounded-2xl overflow-hidden border border-[var(--glass-border)] bg-[var(--glass-bg-strong)]" data-fb="delivery-order">
      <div className="px-4 py-3 border-b line">
        <div className="font-bold flex items-center gap-2"><ShoppingBag className="w-4 h-4" />{t('الطلب')}{order && <span className="text-dim text-xs num font-normal">#{order.number}</span>}</div>
        {cust && <div className="text-[11px] text-dim">{cust.name}{zone ? ` · ${L(zone.name)}` : ''}</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {!lines.length && <Empty icon={<ShoppingBag className="w-10 h-10" />} text={t('اختار أصناف من المنيو')} />}
        {lines.map((l) => (
          <div key={l.id} className="rounded-xl surface-1 px-3 py-2 text-sm" data-fb={`dline:${l.sku}`}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0"><div className="font-bold leading-tight">{L(l.name)}</div>{(l.modifiers.length > 0 || l.variant) && <div className="text-[11px] text-[var(--warning-text)]">{[l.variant ? L(l.variant.name) : null, ...l.modifiers.map((m: any) => L(m.name))].filter(Boolean).join(t('، '))}</div>}{tv(l.note) && <div className="text-[11px] text-[var(--warning-text)]">✎ {tv(l.note)}</div>}</div>
              <span className="num font-bold">{money(l.lineTotal)}</span>
            </div>
            {order.status === 'DRAFT' && (
              <div className="flex items-center gap-1 mt-1">
                <button onClick={() => qtyChange(l, -1)} disabled={busy} className="w-7 h-7 rounded-lg surface-2 flex items-center justify-center">{Number(l.quantity) <= 1 ? <Trash2 className="w-3.5 h-3.5 text-[var(--error)]" /> : <Minus className="w-3.5 h-3.5" />}</button>
                <span className="num w-7 text-center font-bold">{qty(l.quantity)}</span>
                <button onClick={() => qtyChange(l, 1)} disabled={busy} className="w-7 h-7 rounded-lg surface-2 flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="border-t line surface-1 p-4 space-y-1.5 text-sm">
        {T ? (
          <>
            <Row k={t('الأصناف')} v={T.itemsSubtotal} />
            {T.discountTotal !== '0.0000' && <Row k={t('الخصم')} v={'-' + T.discountTotal} />}
            {T.charges.map((c: any) => <Row key={c.id} k={L(c.label)} v={c.amount} />)}
            {!delivery && zone && <div className="flex justify-between text-dim text-xs"><span>{t('رسوم التوصيل ({z}) — هتتضاف في المراجعة', { z: L(zone.name) })}</span><span className="num">{money(zone.fee)}</span></div>}
            {T.taxLines.map((x: any, i: number) => <Row key={i} k={`${L(x.name)} ${qty(x.rate)}%`} v={x.amount} />)}
            <div className="border-t line pt-2 flex items-center justify-between"><span className="font-bold text-lg">{delivery ? t('الإجمالي') : t('الإجمالي (من غير التوصيل)')}</span><Money v={T.payable} big tone="primary" /></div>
            {zone && !delivery && (
              <div className="pt-1">
                <div className="flex justify-between text-[11px] text-dim"><span>{t('الحد الأدنى للمنطقة')} {money(zone.minOrder)}</span><span>{pct >= 100 ? t('تمام ✓') : t('ناقص شوية')}</span></div>
                <div className="h-1.5 rounded-full surface-3 overflow-hidden mt-1"><div className={cn('h-full rounded-full', pct >= 100 ? 'bg-[var(--success)]' : 'bg-[var(--warning)]')} style={{ width: `${pct}%` }} /></div>
              </div>
            )}
          </>
        ) : <div className="text-xs text-dim text-center">{t('الإجمالي بيظهر هنا أول ما تضيف أصناف')}</div>}
      </div>
      <div className="border-t line p-3 space-y-2">
        {order && order.status === 'DRAFT' && !delivery && <Button variant="primary" size="lg" className="w-full" disabled={!lines.length || busy || !zone} loading={busy} onClick={onReview} data-fb="delivery-review"><ClipboardCheck className="w-5 h-5" />{t('مراجعة (ضيف التوصيل)')}</Button>}
        {order && order.status === 'DRAFT' && delivery && (
          <>
            <div className="text-xs rounded-lg surface-1 px-3 py-2"><b className="num">{delivery.number}</b> · {t('الوصول خلال حوالي')} {Math.max(0, Math.round((delivery.promisedAtMs - Date.parse(delivery.createdAt)) / 60000))} {t('دقيقة')} · {t(PAYMENT_MODE[delivery.paymentMode]?.ar)}</div>
            <Button variant="success" size="xl" className="w-full" disabled={!lines.length || busy} loading={busy} onClick={onSend} data-fb="delivery-send"><Send className="w-5 h-5" />{t('ابعت للمطبخ')}</Button>
          </>
        )}
      </div>
    </div>
  );
}
const Row = ({ k, v }: { k: React.ReactNode; v: string }) => <div className="flex justify-between"><span className="text-dim">{k}</span><span className="num">{money(v)}</span></div>;

/** "Paid online": a payment link / InstaPay request, simulated approve or decline, then a normal capture. */
export function PayOnlineDialog({ order, onClose }: { order: any; onClose: (paid: boolean) => void }) {
  const { run, busy } = useCommand();
  const [provider, setProvider] = useState('INSTAPAY');
  const [approve, setApprove] = useState(true);
  const [result, setResult] = useState<any>(null);
  const st = useQuery<any>('Payment.GetSettlement', { params: { orderId: order.id } });
  const go = async () => {
    const a = await run<any>('Payment.AuthorizeExternal', { body: { orderId: order.id, provider, outcome: approve ? 'APPROVE' : 'DECLINE' } });
    if (!a) return;
    setResult(a);
    if (a.state === 'APPROVED') {
      // round 3 tender taxonomy: a payment link is PREPAID («مدفوع قبل كده», internal ONLINE) — never a counter card/wallet
      const c = await run('Payment.Capture', { params: { orderId: order.id }, body: { tenders: [{ method: 'ONLINE', amount: a.amount, authorizationId: a.id, walletProvider: provider === 'INSTAPAY' ? 'INSTAPAY' : provider === 'ONLINE_CARD' ? 'ONLINE_CARD' : 'WALLET' }] } }, { success: t('الدفع بلينك الدفع اتسجل — مدفوع قبل كده') });
      if (c) setTimeout(() => onClose(true), 600);
    }
  };
  return (
    <Modal open onClose={() => onClose(false)} title={t('الدفع أونلاين')} badge={<StateBadge ops={['Payment.AuthorizeExternal', 'Payment.Capture']} />}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>{t('خليه كاش عند الاستلام')}</Button><Button variant="primary" loading={busy} onClick={go} data-fb="online-authorize">{result?.state === 'DECLINED' ? t('جرّب تاني') : t('ابعت طلب الدفع')}</Button></>}>
      <div className="space-y-3">
        <div className="rounded-xl p-3 text-center surface-1 border line"><div className="text-xs text-dim">{t('المطلوب')}</div><Money v={st.data?.remaining ?? order.totals.payable} big tone="primary" /></div>
        <div className="grid grid-cols-2 gap-2">
          {[['INSTAPAY', 'إنستاباي'], ['ONLINE_CARD', 'لينك دفع بالكارت'], ['WALLET', 'محفظة موبايل']].map(([k, v]) => <button key={k} onClick={() => setProvider(k)} className={cn('h-11 rounded-xl border text-sm', provider === k ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(v)}</button>)}
        </div>
        <div className="rounded-xl border border-dashed line p-3 flex items-center justify-between gap-2">
          <span className="text-xs text-dim">{t('محاكاة رد البنك / المحفظة')}</span>
          <Switch checked={approve} onChange={setApprove} label={approve ? t('هيوافق') : t('هيرفض')} />
        </div>
        {result?.state === 'DECLINED' && <Banner tone="error">{t('العملية اترفضت')}: {result.declineReason}. {t('جرّب تاني أو خليه كاش عند الاستلام.')}</Banner>}
        {result?.state === 'APPROVED' && <Banner tone="success">{t('اتوافق — رقم الموافقة')} <span className="num">{result.reference}</span></Banner>}
        <div className="text-[11px] text-dim">{t('في النسخة دي مفيش ربط حقيقي ببنك أو محفظة — الموافقة والرفض محاكاة.')}</div>
      </div>
    </Modal>
  );
}

function Done({ deliveryId, onNew }: { deliveryId: string; onNew: () => void }) {
  const { nav, params } = useDev();
  const d = useQuery<any>(deliveryId ? 'Delivery.Get' : null, { params: { deliveryId } });
  const x = d.data;
  return (
    <div data-screen="DL1" className="max-w-xl mx-auto mt-10">
      <Card>
        <div className="text-center space-y-3 py-4">
          <CheckCircle2 className="w-14 h-14 mx-auto text-[var(--success)]" />
          <div className="text-xl font-bold">{t('الطلب اتبعت للمطبخ')}</div>
          {x ? (
            <>
              <div className="text-sm text-soft">{x.number} · {t('طلب')} #{x.orderNumber} · {x.customerName}</div>
              <div className="text-sm">{addressText(x.address)}</div>
              <div className="flex justify-center gap-2 flex-wrap">
                <Pill tone="info">{t('الوصول المتوقع')} {time(x.promisedAt)}</Pill>
                <Pill tone={Number(x.order?.remaining ?? 0) > 0 ? 'warning' : 'success'}>{Number(x.order?.remaining ?? 0) > 0 ? `${t('يتحصّل عند الاستلام')} ${money(x.order.remaining)}` : t('مدفوع')}</Pill>
              </div>
              {params.paidOnline && <div className="text-xs text-[var(--success)]">{t('الدفع الأونلاين اتسجل على الطلب')}</div>}
            </>
          ) : <Spinner />}
          <div className="flex gap-2 justify-center pt-2">
            <Button variant="primary" onClick={onNew} data-fb="delivery-new-again"><PhoneCall className="w-4 h-4" />{t('طلب جديد')}</Button>
            <Button onClick={() => nav('delivery-board')} data-fb="go-board"><Bike className="w-4 h-4" />{t('لوحة الدليفري')}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
