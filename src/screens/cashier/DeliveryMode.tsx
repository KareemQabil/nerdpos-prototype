// The cashier's third mode «دليفري» (owner rule: the cashier never needs the side menu). Everything happens on the sale
// screen: start with the customer (phone lookup, existing or new, then the address and zone — the fee is the server's),
// then the normal sale layout (items, the one cart, the same action bar); beside it the active deliveries (the delivery
// board's cards, grouped by state, late from DeliveryPolicy) with the inline actions the role may run: open the check,
// rider (popover), out, delivered, and «استلام فلوس الطيار» (shared centered popup). Same commands as the dispatch
// screens: Order.Create (DELIVERY), Delivery.Create, Order.Confirm, Delivery.Assign / Dispatch / Complete, Driver.SettleCash.
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Bike, Phone, UserPlus, MapPin, Banknote, Globe, CreditCard, ClipboardList, Send, CheckCircle2, Search, PhoneCall, Pencil, Plus } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Popup, Popover, Button, Input, Money, Pill, Spinner, Banner, SearchInput, useNow } from '../../ui';
import { Board } from '../../ui/board';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { sign } from '../../lib/cash';
import { clock } from '../../mock/clock';
import { CustomerRow, QuickCreate, AddressForm, EMPTY_ADDRESS, cleanAddress, addressText, useZones } from '../customers/common';
import { PAYMENT_MODE, RiderButton, RiderCashPopup, CompleteDialog, VehicleIcon } from '../delivery/common';
import { deliveryStage, deliveryAging, DeliveryCardBody, useDeliveryBoardDefs, deliveryCardActions } from '../delivery/Board';
import { AgeChip } from '../boards/common';

export type PayMode = 'CASH_ON_DELIVERY' | 'PAID_ONLINE' | 'CARD_ON_DELIVERY';
export interface DeliveryDraft { customerId: string; customerName: string; phone: string; address: any; zoneId: string | null; payMode: PayMode }

// The address and payment chosen before the delivery record exists (it needs the items first). Kept on this device
// per check until Delivery.Create; never business truth (the server records the delivery on send).
const KEY = 'nerdpos.deliveryDrafts.v1';
let drafts: Record<string, DeliveryDraft> = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } })();
const dl = new Set<() => void>();
export const deliveryDrafts = {
  get: (orderId: string | null | undefined) => (orderId ? drafts[orderId] ?? null : null),
  set(orderId: string, d: DeliveryDraft) { drafts = { ...drafts, [orderId]: d }; try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch { /* memory only */ } dl.forEach((f) => f()); },
  drop(orderId: string) { const { [orderId]: _, ...rest } = drafts; drafts = rest; try { localStorage.setItem(KEY, JSON.stringify(drafts)); } catch { /* memory only */ } dl.forEach((f) => f()); },
};
export function useDeliveryDraft(orderId: string | null | undefined) {
  useSyncExternalStore((cb) => { dl.add(cb); return () => dl.delete(cb); }, () => drafts);
  return deliveryDrafts.get(orderId);
}

const PAY_OPTS: { id: PayMode; label: string; icon: React.ReactNode }[] = [
  { id: 'CASH_ON_DELIVERY', label: 'نقدًا عند الاستلام', icon: <Banknote className="w-4 h-4" /> },
  { id: 'PAID_ONLINE', label: 'مدفوع مسبقًا', icon: <Globe className="w-4 h-4" /> },
  { id: 'CARD_ON_DELIVERY', label: 'بطاقة عند الاستلام', icon: <CreditCard className="w-4 h-4" /> },
];

/**
 * Start (or edit) a delivery check with the customer: phone lookup → customer (or quick create) → address with its
 * zone and fee → payment. «بدء الطلب» creates the DELIVERY check for that customer; the items follow on the sale screen.
 */
export function DeliveryStartPopup({ onClose, onStarted, edit, customerId }: { onClose: () => void; onStarted: (orderId: string) => void; edit?: { orderId: string; draft: DeliveryDraft }; customerId?: string | null /* ux-07: start with this customer (a customer's page, the old delivery-new link) */ }) {
  const { run, busy } = useCommand();
  const { zones, zoneOf } = useZones();
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const startCust = edit?.draft.customerId ?? customerId ?? null;
  const custQ = useQuery<any>(startCust ? 'Customer.Get' : null, { params: { customerId: startCust } });
  const [cust, setCust] = useState<any>(null);
  const c = cust ?? custQ.data ?? null;
  const q = phone.trim();
  const isPhone = /^[\d+\s٠-٩-]+$/.test(q);
  const res = useQuery<any>(!c && q.length >= 3 ? 'Customer.Search' : null, { query: isPhone ? { phone: q, limit: 6 } : { text: q, limit: 6 } });
  const addresses: any[] = (c?.addresses ?? []).filter((a: any) => a.active !== false);
  const [addrId, setAddrId] = useState<string | null>(edit?.draft.address?.id ?? null);
  const [newAddr, setNewAddr] = useState<any>(null);
  const [payMode, setPayMode] = useState<PayMode>(edit?.draft.payMode ?? 'CASH_ON_DELIVERY');
  const addr = addresses.find((a) => a.id === addrId) ?? (addresses.length && !newAddr ? addresses.find((a) => a.isDefault) ?? addresses[0] : null);
  const zone = addr ? zones.find((z) => z.id === addr.zoneId) ?? zoneOf(addr.area) : null;
  const pickCustomer = (x: any) => { setCust(x); setCreating(false); setAddrId(null); setNewAddr(null); };
  const saveAddress = async () => {
    if (!c || !newAddr) return;
    const r = await run<any>('CustomerAddress.Upsert', { params: { customerId: c.id, addressId: 'new' }, body: { address: cleanAddress(newAddr), label: newAddr.label || undefined, active: true } }, { success: t('حُفظ العنوان') });
    if (r) { setCust(r); setAddrId(r.addresses?.at(-1)?.id ?? null); setNewAddr(null); }
  };
  const start = async () => {
    if (!c || !addr || !zone?.active) return;
    const draft: DeliveryDraft = { customerId: c.id, customerName: c.name, phone: c.phone, address: addr, zoneId: zone.id, payMode };
    if (edit) { deliveryDrafts.set(edit.orderId, draft); onStarted(edit.orderId); return; }
    const o = await run<any>('Order.Create', { body: { channel: 'DELIVERY', customerId: c.id } }, { label: t('طلب دليفري') });
    if (!o) return;
    deliveryDrafts.set(o.id, draft);
    onStarted(o.id);
  };
  return (
    <Popup open onClose={onClose} size="md" fb="delivery-start" title={<span className="flex items-center gap-2"><Bike className="w-5 h-5 text-[var(--primary)]" />{edit ? t('العميل والعنوان') : t('طلب دليفري جديد')}</span>}
      footer={c && !creating && !newAddr ? <><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!addr || !zone?.active} onClick={start} data-fb="delivery-start:go">{edit ? t('حفظ') : t('بدء الطلب')}</Button></> : undefined}>
      {!c ? (
        creating ? <QuickCreate phone={isPhone ? q : ''} name={!isPhone ? q : ''} onCancel={() => setCreating(false)} onCreated={pickCustomer} /> : (
          <div className="space-y-3">
            <div className="relative"><Phone className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-dim" /><Input autoFocus data-autofocus data-fb="delivery-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" placeholder={t('رقم الهاتف أو الاسم')} className="ps-9 !h-12 text-lg num" onKeyDown={(e) => { if (e.key === 'Enter' && res.data?.items?.length === 1) pickCustomer(res.data.items[0]); }} /></div>
            {res.loading && <Spinner />}
            <div className="space-y-1.5 max-h-72 overflow-y-auto">{(res.data?.items ?? []).map((x: any) => <CustomerRow key={x.id} c={x} onClick={() => pickCustomer(x)} />)}</div>
            {q.length >= 3 && !res.loading && !(res.data?.items ?? []).length && <div className="text-sm text-dim text-center py-2">{t('لا يوجد عميل بهذه البيانات')}</div>}
            <Button variant="outline" className="w-full" onClick={() => setCreating(true)} data-fb="delivery-new-customer"><UserPlus className="w-4 h-4" />{t('عميل جديد')}{isPhone && q ? ` · ${q}` : ''}</Button>
          </div>
        )
      ) : newAddr ? (
        <div className="space-y-3">
          <AddressForm value={newAddr} onChange={setNewAddr} compact />
          <div className="flex gap-2 justify-end"><Button variant="ghost" onClick={() => setNewAddr(null)}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!newAddr.area?.trim() || !newAddr.street?.trim()} onClick={saveAddress} data-fb="delivery-address-save">{t('حفظ العنوان')}</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl surface-1 border line px-3 py-2 flex items-center gap-2">
            <span className="flex-1 min-w-0"><span className="font-bold block truncate">{c.name}</span><span className="text-xs text-dim num" dir="ltr">{c.phone}</span></span>
            {!edit && <Button size="sm" variant="ghost" onClick={() => setCust(null)} data-fb="delivery-change-customer">{t('تغيير')}</Button>}
          </div>
          <div className="space-y-1.5" role="radiogroup" aria-label={t('العنوان')}>
            {addresses.map((a) => {
              const z = zones.find((x) => x.id === a.zoneId) ?? zoneOf(a.area);
              const on = addr?.id === a.id;
              return (
                <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => setAddrId(a.id)} data-fb={`delivery-address:${a.id}`} disabled={!z?.active}
                  className={cn('w-full text-start rounded-xl border px-3 py-2 flex items-start gap-2 disabled:opacity-50', on ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)] hover:border-[var(--primary)]')}>
                  <MapPin className="w-4 h-4 mt-0.5 shrink-0" style={{ color: z?.color }} />
                  <span className="flex-1 min-w-0"><span className="text-sm block">{addressText(a, false)}</span><span className="text-[11px] text-dim">{z ? `${L(z.name)} · ${t('رسوم التوصيل')} ${money(z.fee)} · ${t('حوالي {n} دقيقة', { n: z.etaMinutes })}` : t('خارج مناطق التوصيل')}</span></span>
                </button>
              );
            })}
            <Button size="sm" variant="ghost" onClick={() => setNewAddr({ ...EMPTY_ADDRESS })} data-fb="delivery-address-new"><Plus className="w-4 h-4" />{t('عنوان جديد')}</Button>
          </div>
          {zone && <div className="text-xs text-dim" data-fb="delivery-fee">{t('رسوم التوصيل')}: <Money v={zone.fee} className="text-[var(--foreground)]" /> · {t('الحد الأدنى')} <Money v={zone.minOrder} plain /></div>}
          <div className="grid grid-cols-3 gap-1.5">
            {PAY_OPTS.map((p) => <button key={p.id} type="button" onClick={() => setPayMode(p.id)} data-fb={`delivery-pay:${p.id}`} aria-pressed={payMode === p.id} className={cn('h-12 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 px-1', payMode === p.id ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)]')}>{p.icon}{t(p.label)}</button>)}
          </div>
        </div>
      )}
    </Popup>
  );
}

/** Compact line above the menu for the delivery check being built: customer · zone · fee · payment, editable. */
export function DeliveryDraftBar({ orderId, delivery, onEdit }: { orderId: string; delivery: any | null; onEdit: () => void }) {
  const d = useDeliveryDraft(orderId);
  const { zones } = useZones();
  const z = zones.find((x) => x.id === (delivery?.zoneId ?? d?.zoneId));
  if (!d && !delivery) return <Button size="lg" variant="warning" onClick={onEdit} data-fb="delivery-draft:missing"><MapPin className="w-4 h-4" />{t('اختيار العنوان')}</Button>;
  const name = delivery?.customerName ?? d?.customerName;
  const pay = delivery?.paymentMode ?? d?.payMode;
  return (
    <div className="h-12 rounded-xl border border-[var(--glass-border)] surface-1 ps-3 pe-1 flex items-center gap-2 min-w-0 text-sm" data-fb="delivery-draft">
      <Bike className="w-4 h-4 text-[var(--primary)] shrink-0" />
      <span className="font-bold truncate max-w-[12rem]">{name}</span>
      {z && <span className="text-dim truncate hidden xl:inline">· {L(z.name)} · {money(z.fee)}</span>}
      <span className="text-dim truncate">· {t(PAYMENT_MODE[pay]?.ar ?? '')}</span>
      {!delivery && <Button size="sm" variant="ghost" onClick={onEdit} data-fb="delivery-draft:edit" title={t('تعديل')}><Pencil className="w-3.5 h-3.5" /></Button>}
    </div>
  );
}

/** Riders holding cash → «استلام فلوس الطيار» (popover to pick the rider, then the shared popup). */
export function RiderCashButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { can } = useDev();
  const drivers = useQuery<any>(can('delivery:read') ? 'Driver.List' : null, { query: {} });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [rider, setRider] = useState<any>(null);
  const holding: any[] = (drivers.data?.items ?? []).filter((x: any) => x.cashDeliveries?.length);
  if (!can('delivery:settlecash')) return null;
  return (
    <>
      <Button size={size} variant={holding.length ? 'outline' : 'ghost'} disabled={!holding.length} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} data-fb="rider-cash"><Banknote className="w-4 h-4" />{t('استلام فلوس الطيار')}{holding.length ? <span className="num">({holding.length})</span> : null}</Button>
      <Popover anchor={anchor} open={!!anchor} onClose={() => setAnchor(null)} side="auto" width={300} fb="rider-cash-pick" label={t('استلام فلوس الطيار')}>
        <div className="flex flex-col gap-1">
          {holding.map((x) => (
            <button key={x.id} type="button" onClick={() => { setAnchor(null); setRider(x); }} data-fb={`rider-cash:${x.id}`} className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-[var(--surface-2)]">
              <VehicleIcon v={x.vehicle} className="w-4 h-4 text-[var(--primary)]" /><span className="flex-1 font-bold text-sm">{x.name}</span><span className="text-[11px] text-dim num">{x.cashDeliveries.length}</span><Money v={x.cashInHand} />
            </button>
          ))}
        </div>
      </Popover>
      {rider && <RiderCashPopup d={(drivers.data?.items ?? []).find((x: any) => x.id === rider.id) ?? rider} onClose={() => setRider(null)} />}
    </>
  );
}

/** Inline, permission-gated actions of one delivery on the cashier screen: open the check, out, delivered. */
export function DeliveryInlineActions({ d, onOpenCheck }: { d: any; onOpenCheck: (d: any) => void }) {
  const { can } = useDev();
  const { run } = useCommand();
  const [complete, setComplete] = useState(false);
  const dispatch = () => run('Delivery.Dispatch', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, toState: 'PICKED_UP' } }, { success: t('خرج الطلب مع الطيار'), refId: d.id });
  const deliver = () => (d.order && sign(d.order.remaining) > 0 ? setComplete(true) : run('Delivery.Complete', { params: { deliveryId: d.id }, body: { expectedVersion: d.version } }, { success: t('تم التسليم للعميل'), refId: d.id }));
  return (
    <div className="flex gap-1 flex-wrap" data-no-drag>
      {d.orderId && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpenCheck(d); }} data-fb={`dq-open:${d.number}`}><ClipboardList className="w-3.5 h-3.5" />{t('الشيك')}</Button>}
      {d.state === 'ASSIGNED' && can('delivery:dispatch') && <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); dispatch(); }} data-fb={`dq-out:${d.number}`}><Send className="w-3.5 h-3.5 rtl:-scale-x-100" />{t('خروج')}</Button>}
      {d.state === 'PICKED_UP' && can('delivery:complete') && <Button size="sm" variant="success" onClick={(e) => { e.stopPropagation(); deliver(); }} data-fb={`dq-delivered:${d.number}`}><CheckCircle2 className="w-3.5 h-3.5" />{t('تم التسليم')}</Button>}
      {complete && <CompleteDialog d={d} onClose={() => setComplete(false)} />}
    </div>
  );
}

/** Active deliveries beside the sale area: the delivery board's cards in one column, grouped by state. */
export function DeliveryQueue({ list, onOpenCheck, current }: { list: any[]; onOpenCheck: (d: any) => void; current: string | null }) {
  useNow(15000);
  const { can } = useDev();
  const { run } = useCommand();
  const [q, setQ] = useState('');
  const now = clock.now();
  const needle = q.trim().toLowerCase();
  const shown = list.filter((d) => deliveryStage(d) !== 'done' && (!needle || `${d.number} ${d.orderNumber} ${d.phone ?? ''} ${d.customerName ?? ''}`.toLowerCase().includes(needle)));
  const groups: [string, string][] = [['new', t('جديد')], ['cooking', t('قيد التحضير')], ['ready', t('جاهز للخروج')], ['rider', t('مع الطيار')]];
  return (
    <div className="h-full min-h-0 flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] surface-1 p-2" data-fb="delivery-queue">
      <div className="flex items-center gap-2 px-1"><span className="font-bold text-sm flex-1">{t('الطلبات النشطة')} <span className="num text-dim">{shown.length}</span></span></div>
      <SearchInput value={q} onChange={setQ} placeholder={t('الرقم أو الهاتف أو الاسم')} className="!max-w-none !flex-none" data-fb="delivery-queue-search" />
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pe-0.5">
        {groups.map(([id, title]) => {
          const items = shown.filter((d) => deliveryStage(d) === id).sort((a, b) => a.promisedAtMs - b.promisedAtMs);
          if (!items.length) return null;
          return (
            <section key={id} data-fb={`delivery-group:${id}`}>
              <div className="text-[11px] font-bold text-dim px-1 mb-1">{title} <span className="num">{items.length}</span></div>
              <div className="space-y-1.5">
                {items.map((d) => {
                  const a = deliveryAging(d, now);
                  return (
                    <div key={d.id} data-fb={`dq:${d.number}`} data-late={a.late || undefined} className={cn('rounded-xl glass border p-2 space-y-1.5', d.orderId === current && 'ring-2 ring-[var(--primary)]', a.late && 'board-late')} style={{ borderColor: 'var(--glass-border)', borderInlineStartWidth: a.heat ? 3 : 1, borderInlineStartColor: a.heat ? (a.late ? 'var(--error)' : 'color-mix(in srgb, var(--warning) 70%, var(--error))') : 'var(--glass-border)' }}>
                      <DeliveryCardBody d={d} compact a={a} />
                      <DeliveryInlineActions d={d} onOpenCheck={onOpenCheck} />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!shown.length && <div className="text-xs text-dim text-center py-6">{t('لا يوجد')}</div>}
      </div>
      <RiderCashButton size="sm" />
    </div>
  );
}

/** No check in progress: the delivery board itself (embedded), with «طلب دليفري جديد» first. */
export function CashierDeliveryBoard({ list, loading, onNew, onOpenCheck, toolbarStart }: { list: any[]; loading: boolean; onNew: () => void; onOpenCheck: (d: any) => void; toolbarStart?: React.ReactNode }) {
  useNow(15000);
  const { me, can } = useDev();
  const defs = useDeliveryBoardDefs();
  const now = clock.now();
  return (
    <div className="h-full min-h-0 flex flex-col" data-fb="cashier-delivery-board">
      <Board id="cashier-delivery" embedded userId={me?.user?.id} items={loading ? null : list} itemKey={(d: any) => d.id} columns={defs.columns} columnOf={deliveryStage} aging={(d) => deliveryAging(d, now)}
        search={(d: any) => `${d.number} ${d.orderNumber} ${d.customerName ?? ''} ${d.phone ?? ''}`} searchPlaceholder={t('الرقم أو الهاتف أو الاسم')}
        filters={[{ id: 'late', label: t('متأخر'), test: (d: any) => !!d.late }, { id: 'norider', label: t('بلا طيار'), test: (d: any) => !d.driverId && (d.state === 'PENDING' || d.state === 'FAILED' || d.state === 'RETURNED') }, { id: 'returned', label: t('مرتجع للمطعم'), test: (d: any) => d.state === 'RETURNED' || d.state === 'FAILED' }]}
        sort={(a: any, b: any) => a.promisedAtMs - b.promisedAtMs} canMove={defs.canMove} onMove={defs.onMove}
        cardActions={(d) => deliveryCardActions(d, { can, dispatch: defs.dispatch, openCheck: onOpenCheck, received: defs.received })}
        renderCard={(d: any, c) => <div className="space-y-1.5"><DeliveryCardBody d={d} compact a={c.aging} /><DeliveryInlineActions d={d} onOpenCheck={onOpenCheck} /></div>}
        toolbarStart={<>{toolbarStart}{can('delivery:create') && <Button size="lg" variant="primary" onClick={onNew} data-fb="delivery-new-start"><PhoneCall className="w-5 h-5" />{t('طلب دليفري جديد')}</Button>}</>}
        toolbarEnd={<RiderCashButton />} />
      {defs.popups}
    </div>
  );
}

