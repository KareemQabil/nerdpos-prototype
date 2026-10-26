// Shared customer UI: tags, tier badge, address text and form, the phone lookup / quick-create picker and the
// customer chip shown on a check.
import React, { useEffect, useMemo, useState } from 'react';
import { Search, UserPlus, Phone, MapPin, AlertTriangle, Star, UserRound, X, Crown, Check } from 'lucide-react';
import { useDev, useQuery, useCommand, errorText } from '../../app/hooks';
import { call, ApiFailure } from '../../api/client';
import { Modal, Button, Field, Input, Select, Textarea, Pill, Banner, Spinner, Empty, StateBadge, toast } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money, dateTime } from '../../lib/format';
import { ALLERGEN_AR } from '../order/MenuGrid';

export const TAGS: Record<string, { ar: string; tone: 'violet' | 'success' | 'info' | 'primary' | 'warning' }> = {
  VIP: { ar: 'VIP', tone: 'violet' },
  REGULAR: { ar: 'عميل دايم', tone: 'success' },
  CORPORATE: { ar: 'شركات', tone: 'info' },
  NEW: { ar: 'جديد', tone: 'primary' },
  CAUTION: { ar: 'خلي بالك', tone: 'warning' },
};
export const ALLERGENS = Object.keys(ALLERGEN_AR);

export function TagPills({ tags, className }: { tags: string[]; className?: string }) {
  if (!tags?.length) return null;
  return <span className={cn('inline-flex flex-wrap gap-1', className)}>{tags.map((tg) => <Pill key={tg} tone={TAGS[tg]?.tone ?? 'neutral'}>{TAGS[tg]?.ar ? t(TAGS[tg].ar) : tg}</Pill>)}</span>;
}

export function TierBadge({ tier, className }: { tier: any; className?: string }) {
  if (!tier) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap', className)} style={{ color: tier.color, borderColor: `${tier.color}66`, background: `${tier.color}1f` }}>
      <Crown className="w-3 h-3" />{L(tier.name)}
    </span>
  );
}

export function AllergyWarning({ allergies, notes }: { allergies: string[]; notes?: string | null }) {
  if (!allergies?.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-sm font-bold border border-amber-400/50 bg-amber-400/10 text-amber-300">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{t('حساسية')}: {allergies.map((a) => t(ALLERGEN_AR[a] ?? a)).join('، ')}{notes ? <span className="block text-[11px] font-normal text-amber-200/80">{notes}</span> : null}</span>
    </div>
  );
}

/** "الحي الثامن، شارع الطيران، عمارة 12، الدور 3، شقة 7 — جنب البنك" */
export function addressText(a: any, withLandmark = true) {
  if (!a) return '';
  const parts = [a.area, a.street, a.building ? `${t('عمارة')} ${a.building}` : null, a.floor ? `${t('الدور')} ${a.floor}` : null, a.apartment ? `${t('شقة')} ${a.apartment}` : null].filter(Boolean);
  return parts.join('، ') + (withLandmark && a.landmark ? ` — ${a.landmark}` : '');
}

export function useZones() {
  const z = useQuery<any>('DeliveryZone.List', { query: {} });
  const zones: any[] = z.data?.items ?? [];
  const zoneOf = (area: string | undefined | null) => zones.find((x) => x.areas.includes(area));
  return { zones, zoneOf, loading: z.loading, data: z.data };
}

export const EMPTY_ADDRESS = { label: 'البيت', area: '', street: '', building: '', floor: '', apartment: '', landmark: '', notes: '' };

export function AddressForm({ value, onChange, compact }: { value: any; onChange: (v: any) => void; compact?: boolean }) {
  const { zones, zoneOf } = useZones();
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  const zone = zoneOf(value.area);
  const custom = value.area && !zone;
  return (
    <div className="space-y-2">
      <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'sm:grid-cols-3')}>
        <Field label={t('المنطقة')} className={compact ? 'col-span-2' : ''}>
          <select data-fb="address-area" value={zone || !value.area ? value.area : '__other'} onChange={(e) => set('area', e.target.value === '__other' ? ' ' : e.target.value)} className="glass-input w-full">
            <option value="" style={{ background: 'var(--card)' }}>{t('اختار المنطقة…')}</option>
            {zones.filter((z) => z.active).map((z) => (
              <optgroup key={z.id} label={`${L(z.name)} · ${t('توصيل')} ${money(z.fee)}`} style={{ background: 'var(--card)' }}>
                {z.areas.map((a: string) => <option key={a} value={a} style={{ background: 'var(--card)' }}>{a}</option>)}
              </optgroup>
            ))}
            <option value="__other" style={{ background: 'var(--card)' }}>{t('منطقة تانية (برة مناطق التوصيل)')}</option>
          </select>
        </Field>
        {custom && <Field label={t('اسم المنطقة')}><Input value={value.area.trim()} onChange={(e) => set('area', e.target.value || ' ')} /></Field>}
        <Field label={t('الشارع')} className={compact ? 'col-span-2' : ''}><Input data-fb="address-street" value={value.street} onChange={(e) => set('street', e.target.value)} placeholder={t('مثلاً: شارع عباس العقاد')} /></Field>
        <Field label={t('عمارة')}><Input value={value.building} onChange={(e) => set('building', e.target.value)} /></Field>
        <Field label={t('الدور')}><Input value={value.floor} onChange={(e) => set('floor', e.target.value)} /></Field>
        <Field label={t('شقة')}><Input value={value.apartment} onChange={(e) => set('apartment', e.target.value)} /></Field>
        <Field label={t('علامة مميزة')} className={compact ? 'col-span-2' : 'sm:col-span-2'}><Input value={value.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder={t('جنب إيه؟ قدام إيه؟')} /></Field>
        {!compact && <Field label={t('اسم العنوان')}><Input value={value.label ?? ''} onChange={(e) => set('label', e.target.value)} placeholder={t('البيت / الشغل')} /></Field>}
      </div>
      {zone ? (
        <div className="text-xs text-dim flex items-center gap-1.5 flex-wrap"><MapPin className="w-3.5 h-3.5" style={{ color: zone.color }} />{t('منطقة التوصيل')}: <b style={{ color: zone.color }}>{L(zone.name)}</b> · {t('رسوم')} {money(zone.fee)} · {t('أقل طلب')} {money(zone.minOrder)} · {t('حوالي')} {zone.etaMinutes} {t('دقيقة')}</div>
      ) : value.area?.trim() ? <div className="text-xs text-[var(--warning)]">{t('المنطقة دي مش في مناطق التوصيل — ينفع تتسجل، بس مش هينفع نوصل لها.')}</div> : null}
    </div>
  );
}

export const cleanAddress = (a: any) => ({ ...a, area: String(a.area ?? '').trim() });

/** Phone lookup → pick an existing customer, or create one quickly. */
export function CustomerPicker({ open, onClose, onPick, initialPhone, title, createFirst }: { open: boolean; onClose: () => void; onPick: (c: any) => void; initialPhone?: string; title?: string; createFirst?: boolean }) {
  const [q, setQ] = useState(initialPhone ?? '');
  const [creating, setCreating] = useState(false);
  const isPhone = /^[\d+\s٠-٩-]+$/.test(q.trim());
  const res = useQuery<any>(q.trim().length >= 3 ? 'Customer.Search' : null, { query: isPhone ? { phone: q.trim(), limit: 8 } : { text: q.trim(), limit: 8 } });
  const items: any[] = res.data?.items ?? [];
  useEffect(() => { if (open) { setQ(initialPhone ?? ''); setCreating(!!createFirst); } }, [open, initialPhone, createFirst]);
  return (
    <Modal open={open} onClose={onClose} wide title={title ?? t('اختيار العميل')} badge={<StateBadge ops={['Customer.Search', 'Customer.Create']} />}>
      {!creating ? (
        <div className="space-y-3">
          <div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input autoFocus data-fb="customer-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('رقم الموبايل أو الاسم…')} className="ps-9 text-lg" /></div>
          {q.trim().length < 3 && <div className="text-xs text-dim">{t('اكتب 3 أرقام أو حروف على الأقل')}</div>}
          {res.loading && <Spinner />}
          <div className="space-y-1.5">
            {items.map((c) => <CustomerRow key={c.id} c={c} onClick={() => onPick(c)} />)}
          </div>
          {q.trim().length >= 3 && !res.loading && !items.length && <Empty icon={<UserRound className="w-10 h-10" />} text={t('مفيش عميل بالبيانات دي')} />}
          <Button variant="outline" className="w-full" onClick={() => setCreating(true)} data-fb="customer-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}{isPhone && q.trim() ? ` · ${q.trim()}` : ''}</Button>
        </div>
      ) : (
        <QuickCreate phone={isPhone ? q.trim() : ''} name={!isPhone ? q.trim() : ''} onCancel={() => setCreating(false)} onCreated={onPick} />
      )}
    </Modal>
  );
}

export function CustomerRow({ c, onClick, active }: { c: any; onClick?: () => void; active?: boolean }) {
  const def = c.addresses?.find((a: any) => a.isDefault) ?? c.addresses?.[0];
  return (
    <button onClick={onClick} data-fb={`customer:${c.phone}`} className={cn('w-full text-start rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors', active ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)] hover:border-[var(--primary)]')}>
      <span className="w-9 h-9 shrink-0 rounded-full surface-3 flex items-center justify-center font-bold">{c.name.slice(0, 1)}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 flex-wrap font-bold">{c.name}<TierBadge tier={c.loyalty?.tier} /><TagPills tags={c.tags} /></span>
        <span className="block text-xs text-dim truncate"><span className="num" dir="ltr">{c.phone}</span>{def ? ` · ${addressText(def, false)}` : ''}</span>
      </span>
      <span className="text-end text-[11px] text-dim shrink-0"><span className="block num">{c.stats?.orders ?? 0} {t('طلب')}</span><span className="block num text-[var(--primary)] font-bold">{c.loyalty?.balance ?? 0} {t('نقطة')}</span></span>
    </button>
  );
}

function QuickCreate({ phone, name, onCancel, onCreated }: { phone: string; name: string; onCancel: () => void; onCreated: (c: any) => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const [f, setF] = useState({ name, phone, notes: '', allergies: [] as string[], withAddress: true });
  const [addr, setAddr] = useState<any>({ ...EMPTY_ADDRESS });
  const [taken, setTaken] = useState<any>(null);
  const save = async () => {
    setTaken(null);
    try {
      const r = await call<any>(auth, 'Customer.Create', { body: { name: f.name, phone: f.phone, notes: f.notes || undefined, allergies: f.allergies, address: f.withAddress && addr.area.trim() && addr.street ? cleanAddress(addr) : undefined } });
      toast('success', t('العميل اتسجل'), undefined, auth.label);
      onCreated(r.data);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'CUSTOMER_PHONE_TAKEN') { setTaken(e.details); return; }
      toast('error', errorText(e), (e as any).code, auth.label);
    }
  };
  const openExisting = async () => { const r = await run<any>('Customer.Get', { params: { customerId: taken.customerId } }); if (r) onCreated(r); };
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label={t('الاسم')}><Input autoFocus data-fb="new-customer-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('الموبايل')} hint={t('11 رقم يبدأ بـ 010 / 011 / 012 / 015')}><Input data-fb="new-customer-phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" dir="ltr" className="num" /></Field>
      </div>
      {taken && <Banner tone="warning" action={<Button size="sm" variant="primary" onClick={openExisting}>{t('اختار العميل ده')}</Button>}>{t('الرقم ده متسجل باسم')} <b>{taken.name}</b> ({taken.code})</Banner>}
      <div>
        <div className="text-xs font-bold text-soft mb-1.5">{t('حساسية من أكل')}</div>
        <div className="flex flex-wrap gap-1.5">{ALLERGENS.map((a) => <button key={a} type="button" onClick={() => setF({ ...f, allergies: f.allergies.includes(a) ? f.allergies.filter((x) => x !== a) : [...f.allergies, a] })} className={cn('px-2.5 h-8 rounded-lg text-xs border', f.allergies.includes(a) ? 'border-amber-400 bg-amber-400/15 text-amber-300 font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(ALLERGEN_AR[a])}</button>)}</div>
      </div>
      <Field label={t('ملاحظات')}><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t('مثلاً: كلّمه قبل ما توصل')} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.withAddress} onChange={(e) => setF({ ...f, withAddress: e.target.checked })} />{t('أضيف عنوان التوصيل دلوقتي')}</label>
      {f.withAddress && <AddressForm value={addr} onChange={setAddr} />}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onCancel}>{t('رجوع')}</Button>
        <Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.phone.trim()} onClick={save} data-fb="new-customer-save"><Check className="w-4 h-4" />{t('سجّل العميل')}</Button>
      </div>
    </div>
  );
}

/** The customer on a check: shows name, phone, tier and points; click to attach or change. */
export function CustomerChip({ order, editable = true, compact }: { order: any; editable?: boolean; compact?: boolean }) {
  const { can } = useDev();
  const { run, busy } = useCommand();
  const [open, setOpen] = useState(false);
  const c = useQuery<any>(order.customerId && can('customer:pii:read') ? 'Customer.Get' : null, { params: { customerId: order.customerId } });
  const cust = c.data;
  const canSet = editable && can('order:setcustomer') && (order.status === 'DRAFT' || order.status === 'CONFIRMED');
  const set = async (id: string | null) => {
    const r = await run('Order.SetCustomer', { params: { orderId: order.id }, body: { expectedVersion: order.version, customerId: id } }, { success: id ? t('العميل اتضاف على الشيك') : t('العميل اتشال من الشيك') });
    if (r) setOpen(false);
  };
  if (!order.customerId && !order.customerName) {
    if (!canSet) return null;
    return (
      <>
        <button data-fb="attach-customer" onClick={() => setOpen(true)} className="w-full flex items-center gap-2 rounded-lg border border-dashed border-[var(--glass-border)] px-2.5 h-8 text-xs text-dim hover:border-[var(--primary)] hover:text-[var(--primary)]"><UserPlus className="w-3.5 h-3.5" />{t('ضيف عميل (نقاط الولاء والسجل)')}</button>
        <CustomerPicker open={open} onClose={() => setOpen(false)} onPick={(x) => set(x.id)} />
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 rounded-lg surface-1 border border-[var(--glass-border)] px-2.5 py-1.5" data-fb="customer-chip">
        <UserRound className="w-4 h-4 text-[var(--primary)] shrink-0" />
        <div className="flex-1 min-w-0 text-xs">
          <div className="font-bold flex items-center gap-1.5 flex-wrap truncate">{cust?.name ?? order.customerName}{cust && <TierBadge tier={cust.loyalty?.tier} />}{cust?.tags?.includes('VIP') && <Pill tone="violet">VIP</Pill>}</div>
          <div className="text-dim truncate"><span className="num" dir="ltr">{cust?.phone ?? order.customerPhone ?? ''}</span>{cust ? <> · <Star className="w-3 h-3 inline -mt-0.5" /> <span className="num">{cust.loyalty?.balance ?? 0}</span> {t('نقطة')}</> : null}{!compact && cust?.stats ? ` · ${cust.stats.orders} ${t('طلب')}` : ''}</div>
          {cust?.allergies?.length ? <div className="text-amber-300 font-bold truncate">⚠ {cust.allergies.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join('، ')}</div> : null}
        </div>
        {canSet && <button onClick={() => setOpen(true)} className="text-[11px] text-[var(--primary)] font-bold shrink-0">{t('تغيير')}</button>}
        {canSet && <button title={t('شيل العميل')} disabled={busy} onClick={() => set(null)} className="text-dim hover:text-[var(--error)]"><X className="w-3.5 h-3.5" /></button>}
      </div>
      <CustomerPicker open={open} onClose={() => setOpen(false)} onPick={(x) => set(x.id)} />
    </>
  );
}

export function lastSeen(iso: string | null | undefined) {
  if (!iso) return t('لسه ما طلبش');
  return dateTime(iso);
}
export { Phone };
