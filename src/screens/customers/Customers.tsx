// Customers directory: search by phone, name, notes or area; tags; tier and points; orders and spend.
import React, { useState } from 'react';
import { Users, UserPlus, Search, Copy, Crown } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Input, Select, Table, Spinner, Empty } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, dateTime } from '../../lib/format';
import { TAGS, TagPills, TierBadge, CustomerPicker, addressText } from './common';

export default function Customers() {
  const { nav } = useDev();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('RECENT');
  const [creating, setCreating] = useState(false);
  const isPhone = /^[\d+\s٠-٩-]+$/.test(q.trim());
  const query: Record<string, any> = { sort, tag: tag || undefined, limit: 200 };
  if (q.trim()) Object.assign(query, isPhone ? { phone: q.trim() } : { text: q.trim() });
  const res = useQuery<any>('Customer.Search', { query });
  const tiers = useQuery<any>('LoyaltyTier.List', { query: {} });
  const items: any[] = res.data?.items ?? [];
  return (
    <div data-screen="CR1" className="space-y-4">
      <Section title={t('العملاء')} badge={<StateBadge ops={['Customer.Search', 'Customer.Create', 'Customer.Get']} />}
        sub={t('كل العملاء اللي طلبوا قبل كده: عناوينهم، طلباتهم، نقاطهم وملاحظاتهم. ابحث برقم الموبايل أو الاسم.')}
        actions={<Button variant="primary" onClick={() => setCreating(true)} data-fb="customers-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}</Button>} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="glass rounded-xl px-3 py-2"><div className="text-[11px] text-dim">{t('عدد العملاء')}</div><div className="text-xl font-bold num">{res.data?.total ?? '—'}</div></div>
        {(tiers.data?.items ?? []).filter((x: any) => x.active).map((x: any) => (
          <div key={x.id} className="glass rounded-xl px-3 py-2"><div className="text-[11px] text-dim flex items-center gap-1"><Crown className="w-3 h-3" style={{ color: x.color }} />{L(x.name)}</div><div className="text-xl font-bold num" style={{ color: x.color }}>{x.customers}</div></div>
        ))}
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="customers-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('رقم الموبايل، الاسم، الحي، ملاحظة…')} className="ps-9" /></div>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setTag('')} className={cn('px-3 h-9 rounded-lg text-xs border', !tag ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t('الكل')}</button>
            {Object.entries(TAGS).map(([k, v]) => <button key={k} onClick={() => setTag(k)} className={cn('px-3 h-9 rounded-lg text-xs border', tag === k ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(v.ar)}</button>)}
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-44" options={[{ value: 'RECENT', label: t('آخر طلب') }, { value: 'SPENT', label: t('الأكتر صرفًا') }, { value: 'POINTS', label: t('الأكتر نقاط') }, { value: 'NAME', label: t('الاسم') }]} />
        </div>
        {res.loading && !items.length ? <Spinner /> : (
          <Table head={[t('العميل'), t('الموبايل'), t('المنطقة'), t('المستوى'), t('النقاط'), t('الطلبات'), t('إجمالي الصرف'), t('آخر طلب')]} empty={<Empty icon={<Users className="w-10 h-10" />} text={t('مفيش عملاء بالبحث ده')} />}
            rows={items.map((c) => {
              const a = c.addresses.find((x: any) => x.isDefault) ?? c.addresses[0];
              return [
                <button className="text-start" onClick={() => nav('customer', { customerId: c.id })} data-fb={`open-customer:${c.phone}`}><div className="font-bold flex items-center gap-1.5 flex-wrap">{c.name}<TagPills tags={c.tags} /></div><div className="text-[11px] text-dim num">{c.code}{c.allergies?.length ? <span className="text-amber-300"> · ⚠ {t('حساسية')}</span> : null}</div></button>,
                <span className="num text-xs" dir="ltr">{c.phone}</span>,
                <span className="text-xs">{a ? a.area : '—'}</span>,
                <TierBadge tier={c.loyalty.tier} />,
                <span className="num font-bold text-[var(--primary)]">{c.loyalty.balance}</span>,
                <span className="num">{c.stats.orders}</span>,
                <Money v={c.stats.spent} />,
                <span className="text-xs num">{c.stats.lastOrderAt ? dateTime(c.stats.lastOrderAt) : '—'}</span>,
              ];
            })} />
        )}
      </Card>
      <CustomerPicker open={creating} createFirst onClose={() => setCreating(false)} title={t('عميل جديد')} onPick={(c) => { setCreating(false); nav('customer', { customerId: c.id }); }} />
    </div>
  );
}
