// Customer profile: contact, tags, allergies and notes; addresses; orders and deliveries; loyalty points and tier;
// manual points adjustment; merge a duplicate into this customer.
import React, { useState } from 'react';
import { ArrowRight, Pencil, PhoneCall, MapPin, Plus, Trash2, Star, Crown, Merge, Gift, History, Bike, ShoppingBag, Phone, Mail, CheckCircle2, CalendarClock, Eye } from 'lucide-react';
import { useDev, useQuery, useCommand, useReasonMin } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Modal, Field, Input, Textarea, Banner, Tabs, Table, Spinner, Empty, KV, confirmDialog, DateTime } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L, tv } from '../../i18n';
import { cn, money, dateTime } from '../../lib/format';
import { ALLERGEN_AR } from '../order/MenuGrid';
import { TAGS, ALLERGENS, TagPills, TierBadge, AllergyWarning, AddressForm, EMPTY_ADDRESS, cleanAddress, addressText, useZones, CustomerPicker, CustomerRow, PhoneText, RevealPhonePopup, isMaskedPhone } from './common';
import { useApprovalRule } from '../admin/org/common';
import { ruleSentence } from '../../demo/policyText';
import { STATE, PAYMENT_MODE, DeliveryDetail } from '../delivery/common';
import { StatusPill } from '../order/CheckPanel';
import { personText } from '../../demo/people';
import { RES_STATE, DEP_STATE } from '../reservationLabels'; // ux-12

const ENTRY: Record<string, { ar: string; tone: 'success' | 'error' | 'info' | 'violet' | 'neutral' }> = {
  EARN: { ar: 'كسب', tone: 'success' }, REDEEM: { ar: 'صرف', tone: 'error' }, ADJUST: { ar: 'تعديل يدوي', tone: 'info' }, MERGE_IN: { ar: 'دمج (داخل)', tone: 'violet' }, MERGE_OUT: { ar: 'دمج (خارج)', tone: 'neutral' }, REVERSE: { ar: 'إلغاء', tone: 'neutral' },
  EXPIRE: { ar: 'انتهاء صلاحية', tone: 'neutral' }, // ux-13
};
export const entryLabel = ENTRY;

export default function CustomerProfile() {
  const { params, nav, can } = useDev();
  const q = useQuery<any>(params.customerId ? 'Customer.Get' : null, { params: { customerId: params.customerId } });
  const [tab, setTab] = useState<'addresses' | 'orders' | 'reservations' | 'points' | 'merge'>('addresses');
  const resv = useQuery<any>(params.customerId && can('table:read') ? 'Reservation.Find' : null, { query: { customerId: params.customerId } }); // ux-12
  const [edit, setEdit] = useState(false);
  const [reveal, setReveal] = useState(false); // ux-13
  const c = q.data;
  if (!params.customerId) return <Banner tone="info">{t('افتح عميل من شاشة العملاء')}</Banner>;
  if (q.error) return <Banner tone="error">{t('العميل ده مش موجود')}</Banner>;
  if (!c) return <Spinner />;
  const L1 = c.loyalty;
  return (
    <div data-screen="CR2" className="space-y-4">
      <Section title={c.name} badge={<StateBadge ops={['Customer.Get', 'Customer.Update', 'CustomerAddress.Upsert', 'Loyalty.Balance', 'Customer.Merge']} />}
        sub={<span className="flex items-center gap-2 flex-wrap"><span className="num">{c.code}</span><TierBadge tier={L1.tier} /><TagPills tags={c.tags} />{!c.active && <Pill tone="neutral">{t('اتدمج في عميل تاني')}</Pill>}</span>}
        actions={<>
          <Button variant="ghost" onClick={() => nav('customers')}><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('العملاء')}</Button>
          {c.active && can('customer:update') && <Button onClick={() => setEdit(true)} data-fb="customer-edit"><Pencil className="w-4 h-4" />{t('تعديل')}</Button>}
          {c.active && can('delivery:create') && <Button variant="primary" onClick={() => nav('counter', { mode: 'delivery', startDelivery: c.id })} data-fb="customer-order"><PhoneCall className="w-4 h-4" />{t('طلب دليفري')}</Button>}
        </>} />
      {!c.active && c.mergedInto && <Banner tone="warning" action={<Button size="sm" onClick={() => nav('customer', { customerId: c.mergedInto })}>{t('افتح العميل الأساسي')}</Button>}>{t('العميل ده اتدمج في عميل تاني — كل طلباته ونقاطه اتنقلت هناك.')}</Banner>}
      <div className="grid lg:grid-cols-[340px_1fr] gap-4">
        <div className="space-y-3">
          <Card>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 flex-wrap"><Phone className="w-4 h-4 text-dim" /><PhoneText v={c.phone} link className="font-bold" fb="customer-phone" />{c.altPhone && <span className="text-dim">· <PhoneText v={c.altPhone} link /></span>}
                {c.phoneReveal && isMaskedPhone(c.phone) && <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setReveal(true)} data-fb="phone-reveal"><Eye className="w-3.5 h-3.5" />{t('إظهار الرقم')}</Button>}</div>
              {c.email && <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-dim" />{c.email}</div>}
              <AllergyWarning allergies={c.allergies} />
              {tv(c.notes) && <div className="rounded-lg surface-1 px-3 py-2 text-xs">✎ {tv(c.notes)}</div>}
              <div className="text-[11px] text-dim">{t('عميل من')} {dateTime(c.createdAt)}</div>
            </div>
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <StatTile label={t('الطلبات')} v={String(c.stats.orders)} />
            <StatTile label={t('إجمالي الصرف')} v={<Money v={c.stats.spent} plain />} />
            <StatTile label={t('متوسط الطلب')} v={<Money v={c.stats.average} plain />} />
            <StatTile label={t('آخر طلب')} v={<DateTime v={c.stats.lastOrderAt} />} small />
          </div>
          <Card title={<span className="flex items-center gap-2"><Star className="w-4 h-4 text-[var(--primary)]" />{t('نقاط الولاء')}</span>}>
            <div className="text-center space-y-1">
              <div className="text-4xl font-bold num text-[var(--primary)]" data-fb="customer-points">{L1.balance}</div>
              <div className="text-xs text-dim">{t('نقطة')} · {t('تساوي')} {money(L1.valueEgp)}</div>
              {L1.nextTier ? (
                <div className="pt-2">
                  <div className="text-[11px] text-dim">{t('فاضل {n} نقطة ويوصل', { n: L1.nextTier.toGo })} <b>{L(L1.nextTier.name)}</b></div>
                  <div className="h-1.5 rounded-full surface-3 overflow-hidden mt-1"><div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, Math.round((L1.lifetime / L1.nextTier.minPoints) * 100))}%` }} /></div>
                </div>
              ) : L1.tier ? <div className="text-[11px] text-dim pt-1">{t('أعلى مستوى')}</div> : null}
              {c.stats.favourite && <div className="text-[11px] text-dim pt-2">{t('بيطلب غالبًا')}: <b className="text-soft">{tv(c.stats.favourite)}</b></div>}
            </div>
          </Card>
        </div>
        <div className="space-y-3">
          <Tabs value={tab} onChange={setTab} tabs={[
            { id: 'addresses', label: `${t('العناوين')} (${c.addresses.length})` },
            { id: 'orders', label: `${t('الطلبات')} (${c.orders.length + c.deliveries.filter((d: any) => d.historical).length})` },
            ...(can('table:read') ? [{ id: 'reservations' as const, label: `${t('الحجوزات')} (${resv.data?.items?.length ?? 0})`, fb: 'customer-tab:reservations' }] : []),
            { id: 'points', label: t('النقاط') },
            ...(c.active && can('customer:update') ? [{ id: 'merge' as const, label: <span className="flex items-center gap-1">{t('دمج مكرر')}{c.duplicates.length ? <span className="px-1.5 rounded-full bg-[var(--warning)] text-black text-[10px] font-bold">{c.duplicates.length}</span> : null}</span> }] : []),
          ]} />
          {tab === 'addresses' && <Addresses c={c} />}
          {tab === 'orders' && <Orders c={c} />}
          {tab === 'reservations' && <CustomerReservations items={resv.data?.items ?? null} />}
          {tab === 'points' && <Points c={c} />}
          {tab === 'merge' && <MergePanel c={c} />}
        </div>
      </div>
      {edit && <EditDialog c={c} onClose={() => setEdit(false)} />}
      {reveal && <RevealPhonePopup c={c} onClose={() => setReveal(false)} />}
    </div>
  );
}

function StatTile({ label, v, small }: { label: string; v: React.ReactNode; small?: boolean }) {
  return <div className="glass rounded-xl px-3 py-2"><div className="text-[11px] text-dim">{label}</div><div className={cn('font-bold', small ? 'text-sm' : 'text-lg')}>{typeof v === 'string' || typeof v === 'number' ? <span className="num">{v}</span> : v}</div></div>;
}

function EditDialog({ c, onClose }: { c: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  // ux-13: a masked number is not editable as text — the field starts empty (the number stays) and a new one is typed whole
  const mp = isMaskedPhone(c.phone), ma = isMaskedPhone(c.altPhone);
  const [f, setF] = useState({ name: c.name, phone: mp ? '' : c.phone, altPhone: ma ? '' : c.altPhone ?? '', email: c.email ?? '', notes: c.notes ?? '', tags: [...c.tags] as string[], allergies: [...c.allergies] as string[] });
  const toggle = (k: 'tags' | 'allergies', v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const save = async () => { const r = await run('Customer.Update', { params: { customerId: c.id }, body: { ...f, phone: f.phone.trim() || (mp ? c.phone : ''), altPhone: f.altPhone.trim() || (ma ? c.altPhone : null), email: f.email || null, expectedVersion: c.version } }, { success: t('بيانات العميل اتحفظت') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} wide title={t('تعديل بيانات العميل')} badge={<StateBadge ops={['Customer.Update']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={save} data-fb="customer-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label={t('الاسم')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('الموبايل')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder={mp ? c.phone : undefined} dir="ltr" className="num" data-fb="customer-edit-phone" /></Field>
          <Field label={t('رقم تاني (موبايل أو أرضي)')}><Input value={f.altPhone} onChange={(e) => setF({ ...f, altPhone: e.target.value })} placeholder={ma ? c.altPhone : undefined} dir="ltr" className="num" /></Field>
          <Field label={t('الإيميل')}><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} dir="ltr" /></Field>
        </div>
        <div><div className="text-xs font-bold text-soft mb-1.5">{t('تصنيف العميل')}</div><div className="flex flex-wrap gap-1.5">{Object.entries(TAGS).map(([k, v]) => <button key={k} type="button" onClick={() => toggle('tags', k)} className={cn('px-2.5 h-8 rounded-lg text-xs border', f.tags.includes(k) ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(v.ar)}</button>)}</div></div>
        <div><div className="text-xs font-bold text-soft mb-1.5">{t('حساسية من أكل')}</div><div className="flex flex-wrap gap-1.5">{ALLERGENS.map((a) => <button key={a} type="button" onClick={() => toggle('allergies', a)} className={cn('px-2.5 h-8 rounded-lg text-xs border', f.allergies.includes(a) ? 'border-amber-400 bg-amber-400/15 text-amber-300 font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(ALLERGEN_AR[a])}</button>)}</div></div>
        <Field label={t('ملاحظات')}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Addresses({ c }: { c: any }) {
  const { can } = useDev();
  const { run, busy } = useCommand();
  const { zoneOf } = useZones();
  const [edit, setEdit] = useState<any>(null);
  const remove = async (a: any) => { if (await confirmDialog(t('تشيل العنوان ده؟'), { danger: true })) await run('CustomerAddress.Upsert', { params: { customerId: c.id, addressId: a.id }, body: { active: false, expectedVersion: a.version } }, { success: t('العنوان اتشال') }); };
  const makeDefault = (a: any) => run('CustomerAddress.Upsert', { params: { customerId: c.id, addressId: a.id }, body: { active: true, isDefault: true, address: a, label: a.label, expectedVersion: a.version } }, { success: t('بقى العنوان الأساسي') });
  return (
    <div className="space-y-2">
      {c.addresses.map((a: any) => {
        const z = zoneOf(a.area);
        return (
          <Card key={a.id}>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 mt-0.5 shrink-0" style={{ color: z?.color }} />
              <div className="flex-1 min-w-0">
                <div className="font-bold flex items-center gap-2 flex-wrap">{tv(a.label) ?? t('عنوان')}{a.isDefault && <Pill tone="primary">{t('الأساسي')}</Pill>}{z ? <Pill tone="neutral">{L(z.name)} · {money(z.fee)} · {z.etaMinutes} {t('د')}</Pill> : <Pill tone="warning">{t('برة مناطق التوصيل')}</Pill>}</div>
                <div className="text-sm text-soft mt-0.5">{addressText(a)}</div>
              </div>
              {c.active && can('customeraddress:upsert') && <div className="flex gap-1">
                {!a.isDefault && <Button size="sm" variant="ghost" disabled={busy} onClick={() => makeDefault(a)}>{t('خليه الأساسي')}</Button>}
                <Button size="sm" variant="ghost" onClick={() => setEdit(a)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" className="text-[var(--error)]" disabled={busy} onClick={() => remove(a)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>}
            </div>
          </Card>
        );
      })}
      {!c.addresses.length && <Empty icon={<MapPin className="w-10 h-10" />} text={t('مفيش عناوين لسه')} />}
      {c.active && can('customeraddress:upsert') && <Button variant="outline" onClick={() => setEdit({})} data-fb="address-add"><Plus className="w-4 h-4" />{t('عنوان جديد')}</Button>}
      {edit && <AddressDialog c={c} a={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AddressDialog({ c, a, onClose }: { c: any; a: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [v, setV] = useState<any>({ ...EMPTY_ADDRESS, ...a });
  const save = async () => { const r = await run('CustomerAddress.Upsert', { params: { customerId: c.id, addressId: a.id ?? 'new' }, body: { address: cleanAddress(v), label: v.label || undefined, active: true, expectedVersion: a.version } }, { success: t('العنوان اتحفظ') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} wide title={a.id ? t('تعديل العنوان') : t('عنوان جديد')} badge={<StateBadge ops={['CustomerAddress.Upsert']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!v.area.trim() || !v.street.trim()} onClick={save} data-fb="address-dialog-save">{t('حفظ')}</Button></>}>
      <AddressForm value={v} onChange={setV} />
    </Modal>
  );
}

function Orders({ c }: { c: any }) {
  const { nav } = useDev();
  const [open, setOpen] = useState<string | null>(null);
  const hist = c.deliveries.filter((d: any) => d.historical);
  return (
    <div className="space-y-3">
      <Card title={<span className="flex items-center gap-2"><ShoppingBag className="w-4 h-4" />{t('الطلبات على السيستم')}</span>}>
        <Table head={[t('الطلب'), t('الوقت'), t('النوع'), t('الأصناف'), t('الإجمالي'), t('الحالة'), '']} empty={t('لسه مفيش طلبات على السيستم')}
          rows={c.orders.map((o: any) => [<span className="num font-bold">#{o.number}</span>, <DateTime v={o.createdAt} className="text-xs" />, o.channel === 'DELIVERY' ? t('دليفري') : o.channel === 'TAKEAWAY' ? t('تيك أواي') : t('صالة'), <span className="text-xs line-clamp-2">{L({ ar: o.items, en: o.itemsEn })}</span>, <Money v={o.payable} />, <StatusPill s={o.status} />,
            <span className="flex gap-1">{o.deliveryId && <Button size="sm" variant="ghost" onClick={() => setOpen(o.deliveryId)}><Bike className="w-3.5 h-3.5" /></Button>}{o.status === 'COMPLETED' && <Button size="sm" variant="ghost" onClick={() => nav('receipt', { orderId: o.id })}>{t('الإيصال')}</Button>}</span>])} />
      </Card>
      {hist.length > 0 && (
        <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4" />{t('توصيلات سابقة')}</span>}>
          <Table head={[t('الطلب'), t('الوقت'), t('المنطقة'), t('الطيار'), t('الدفع'), t('المبلغ')]}
            rows={hist.map((d: any) => [<span className="num">#{d.orderNumber}</span>, <DateTime v={d.createdAt} className="text-xs" />, d.zoneName, d.driverName ?? '—', t(PAYMENT_MODE[d.paymentMode]?.ar ?? ''), <Money v={d.amount} />])} />
        </Card>
      )}
      {c.stats.orders > c.orders.length + hist.length && <div className="text-xs text-dim">{t('العدد الكلي فيه طلبات قديمة من قبل تشغيل السيستم ({n} طلب).', { n: c.stats.orders - c.orders.length - hist.length })}</div>}
      {open && <DeliveryDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** ux-12: this customer's reservations (read-only; managed from «الحجوزات»). */
function CustomerReservations({ items }: { items: any[] | null }) {
  const rows = (items ?? []).slice().reverse();
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4" />{t('الحجوزات')}</span>} badge={<StateBadge ops={['Reservation.Find']} />}>
      <Table loading={items === null} head={[t('الموعد'), t('الأفراد'), t('الترابيزة'), t('العربون'), t('الحالة')]} align={['start', 'center', 'start', 'end', 'start']} empty={t('لا توجد حجوزات')}
        rows={rows.map((r: any) => [<DateTime v={r.at} className="text-xs" />, <span className="num font-bold">{r.partySize}</span>, r.tableName ? `${t('ترابيزة')} ${r.tableName}` : <span className="text-dim">—</span>,
          r.deposit ? <span className="inline-flex flex-col items-end"><Money v={r.deposit.amount} /><span className="text-[11px] text-dim">{t(DEP_STATE[r.deposit.state]?.[0] ?? '')}</span></span> : <span className="text-dim">—</span>,
          <Pill tone={RES_STATE[r.state]?.[1] ?? 'neutral'} dot>{t(RES_STATE[r.state]?.[0] ?? '—')}</Pill>])} />
    </Card>
  );
}

function Points({ c }: { c: any }) {
  const { can } = useDev();
  const q = useQuery<any>('Loyalty.Balance', { params: { customerId: c.id } });
  const [adj, setAdj] = useState(false);
  const d = q.data;
  return (
    <Card title={<span className="flex items-center gap-2"><Star className="w-4 h-4" />{t('حركة النقاط')}</span>} badge={<StateBadge ops={['Loyalty.Balance', 'Loyalty.Adjust']} />}
      actions={c.active && can('loyalty:adjust') && <Button size="sm" onClick={() => setAdj(true)} data-fb="points-adjust"><Gift className="w-4 h-4" />{t('تعديل يدوي')}</Button>}>
      {!d ? <Spinner /> : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3 text-xs" data-fb="points-rules">
            <Pill tone="neutral">{t('نقطة لكل')} <Money v={d.program.egpPerPoint} /></Pill>
            <Pill tone="neutral">{t('قيمة النقطة')} <Money v={d.program.pointValue} /></Pill>
            <Pill tone="neutral">{t('النقاط المكتسبة')} <span className="num">{d.lifetime}</span></Pill>
            {d.program.expiryMonths > 0 && <Pill tone="warning">{t('تنتهي بعد {n} شهر', { n: d.program.expiryMonths })}</Pill>}
          </div>
          <Table head={[t('الوقت'), t('الحركة'), t('النقاط'), t('الرصيد بعدها'), t('الطلب'), t('التفاصيل')]} empty={t('مفيش حركة نقاط')}
            rows={d.entries.map((e: any) => [<DateTime v={e.at} className="text-xs" />, <Pill tone={ENTRY[e.kind]?.tone}>{t(ENTRY[e.kind]?.ar ?? e.kind)}</Pill>, <b className={cn('num', e.points > 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>{e.points > 0 ? '+' : ''}{e.points}</b>, <span className="num">{e.balanceAfter}</span>, e.orderNumber ? <span className="num">#{e.orderNumber}</span> : '—', <span className="text-xs">{tv(e.reason) ?? ''}{e.multiplier ? <span className="num"> ×{e.multiplier}</span> : ''}{personText(e.byName) ? <span className="text-dim"> · {personText(e.byName)}</span> : ''}{e.approvalGrantId ? <span className="text-dim"> · {t('بموافقة')}</span> : ''}</span>])} />
        </>
      )}
      {adj && <AdjustDialog c={c} balance={d?.balance ?? 0} onClose={() => setAdj(false)} />}
    </Card>
  );
}

// ux-13: reason (ReasonTextPolicy), the balance shown is sent back (CAS), and the approval follows the LOYALTY_ADJUST rule
function AdjustDialog({ c, balance, onClose }: { c: any; balance: number; onClose: () => void }) {
  const { run, busy } = useCommand();
  const min = useReasonMin();
  const { rule } = useApprovalRule('LOYALTY_ADJUST');
  const [sign, setSign] = useState<1 | -1>(1);
  const [pts, setPts] = useState('');
  const [reason, setReason] = useState('');
  const quick = ['تعويض عن تأخير طلب', 'تعويض عن صنف ناقص', 'هدية عيد ميلاد', 'تصحيح خطأ في الطلب'];
  const save = async () => { const r = await run('Loyalty.Adjust', { params: { customerId: c.id }, body: { points: sign * Number(pts), reason: reason.trim(), expectedBalance: balance } }, { success: t('النقاط اتعدلت') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={t('تعديل نقاط يدوي')} badge={<StateBadge ops={['Loyalty.Adjust', 'Approval.Grant']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!Number(pts) || reason.trim().length < min || (sign === -1 && Number(pts) > balance)} onClick={save} data-fb="adjust-save">{t('حفظ')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm">{t('الرصيد الحالي')}: <b className="num">{balance}</b> {t('نقطة')}</div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setSign(1)} className={cn('h-11 rounded-xl border text-sm', sign === 1 ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t('إضافة نقاط')}</button>
          <button onClick={() => setSign(-1)} className={cn('h-11 rounded-xl border text-sm', sign === -1 ? 'border-[var(--error)] bg-red-500/10 font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t('خصم نقاط')}</button>
        </div>
        <Field label={t('عدد النقاط')} hint={rule ? ruleSentence('LOYALTY_ADJUST', rule) : undefined}><Input value={pts} onChange={(e) => setPts(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="num text-xl" data-fb="adjust-points" /></Field>
        <div className="flex flex-wrap gap-1.5">{quick.map((q) => <button key={q} onClick={() => setReason(q)} className={cn('px-2.5 h-8 rounded-lg text-xs border', reason === q ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{t(q)}</button>)}</div>
        <Field label={t('السبب')} required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="adjust-reason" /></Field>
      </div>
    </Modal>
  );
}

function MergePanel({ c }: { c: any }) {
  const { run, busy } = useCommand();
  const [pick, setPick] = useState(false);
  const [src, setSrc] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const merge = async () => {
    if (!src) return;
    const r = await run<any>('Customer.Merge', { params: { customerId: c.id }, body: { sourceCustomerId: src.id, expectedVersion: c.version } }, { success: t('العميلين اتدمجوا') });
    if (r) { setDone(r.merge); setSrc(null); }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Merge className="w-4 h-4" />{t('دمج عميل مكرر في')} {c.name}</span>} badge={<StateBadge ops={['Customer.Merge']} />}>
      <div className="space-y-3">
        {done && <Banner tone="success">{t('اتنقل {o} طلب و{p} نقطة.', { o: done.movedOrders, p: done.movedPoints })}</Banner>}
        {c.duplicates.length > 0 && (
          <div>
            <div className="text-xs font-bold text-[var(--warning)] mb-1.5">{t('ممكن يكونوا نفس العميل')}</div>
            <div className="space-y-1.5">{c.duplicates.map((d: any) => <button key={d.id} onClick={() => setSrc(d)} data-fb={`dup:${d.phone}`} className={cn('w-full text-start rounded-xl border px-3 py-2 text-sm', src?.id === d.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}><b>{d.name}</b> <PhoneText v={d.phone} className="text-xs text-dim" /> <span className="text-xs text-dim">{d.code}</span></button>)}</div>
          </div>
        )}
        <Button variant="ghost" onClick={() => setPick(true)}>{t('اختار عميل تاني بالبحث')}</Button>
        {src && (
          <div className="rounded-xl border border-[var(--warning)] p-3 space-y-2">
            <div className="text-sm">{t('هيتدمج')} <b>{src.name}</b> ({src.code}) {t('في')} <b>{c.name}</b> ({c.code}). {t('الخطوة دي مش بترجع.')}</div>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setSrc(null)}>{t('إلغاء')}</Button><Button variant="warning" loading={busy} onClick={merge} data-fb="merge-confirm"><Merge className="w-4 h-4" />{t('ادمج')}</Button></div>
          </div>
        )}
        {c.mergedFrom.length > 0 && <div className="text-xs text-dim">{t('اتدمج فيه قبل كده')}: {c.mergedFrom.map((m: any, i: number) => <span key={m.id}>{i ? t('، ') : ''}{m.name} (<PhoneText v={m.phone} />)</span>)}</div>}
      </div>
      <CustomerPicker open={pick} onClose={() => setPick(false)} title={t('اختار العميل المكرر')} onPick={(x) => { setPick(false); if (x.id !== c.id) setSrc(x); }} />
    </Card>
  );
}
