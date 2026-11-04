// Customers directory: search by phone, name, notes or area; tags; tier and points; orders and spend.
import React, { useState } from 'react';
import { Users, UserPlus, Search, Copy, Crown } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { PageHeader, StateBadge, Button, Card, Money, Select, DataTable, cols, DensityToggle, EmptyState, StatGrid, StatCard, Toolbar, SearchInput, FilterChips, DateTime } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { TAGS, TagPills, TierBadge, CustomerPicker, addressText, PhoneText } from './common';

export default function Customers() {
  const { nav, kind } = useDev();
  const C = cols<any>();
  const area = (c: any) => (c.addresses.find((x: any) => x.isDefault) ?? c.addresses[0])?.area ?? null;
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
  const PAGE = 50;
  return (
    <div data-screen="CR1" className="space-y-4">
      <PageHeader icon={<Users />} title={t('العملاء')} badge={<StateBadge ops={['Customer.Search', 'Customer.Create', 'Customer.Get']} />}
        actions={<Button variant="primary" onClick={() => setCreating(true)} data-fb="customers-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}</Button>} />
      <StatGrid>
        <StatCard label={t('عدد العملاء')} value={res.data?.total ?? '—'} icon={<Users />} loading={res.loading && !res.data} />
        {(tiers.data?.items ?? []).filter((x: any) => x.active).map((x: any) => (
          <StatCard key={x.id} label={L(x.name)} value={<span style={{ color: x.color }}>{x.customers}</span>} icon={<Crown style={{ color: x.color }} />} hint={t('عميل في المستوى ده')} />
        ))}
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <SearchInput data-fb="customers-search" value={q} onChange={setQ} placeholder={t('رقم الموبايل، الاسم، الحي، ملاحظة…')} />
          <FilterChips value={tag} onChange={setTag} options={[{ id: '', label: t('الكل') }, ...Object.entries(TAGS).map(([k, v]) => ({ id: k, label: t(v.ar) }))]} />
          <Toolbar.Spacer />
          <Select className="!w-auto min-w-[150px]" value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: 'RECENT', label: t('ترتيب: آخر طلب') }, { value: 'SPENT', label: t('ترتيب: الأكتر صرفًا') }, { value: 'POINTS', label: t('ترتيب: الأكتر نقاط') }, { value: 'NAME', label: t('ترتيب: الاسم') }]} />
          {kind !== 'CASH' && <DensityToggle />}
        </Toolbar>
        <DataTable rows={items} rowKey={(c: any) => c.id} loading={res.loading && !items.length} maxHeight={640} pageSize={PAGE} touch={kind === 'CASH'} label={t('العملاء')}
          onRowOpen={(c) => nav('customer', { customerId: c.id })}
          empty={res.data?.phoneSearch === 'FULL_NUMBER_REQUIRED' ? <EmptyState compact icon={<Users />} title={t('اكتب الرقم كاملًا')} /> : <EmptyState compact icon={<Users />} title={t('مفيش عملاء بالبحث ده')} />}
          columns={[
            C.text('name', t('العميل'), (c) => c.name, { cell: (c) => <div className="text-start" data-fb={`open-customer:${c.phone}`}><div className="font-bold flex items-center gap-1.5 flex-wrap">{c.name}<TagPills tags={c.tags} /></div><div className="text-[11px] text-dim"><Tech><span className="num">{c.code}</span></Tech>{c.allergies?.length ? <span className="text-[var(--warning)]">⚠ {t('عنده حساسية')}</span> : null}</div></div> }),
            C.custom('phone', t('الموبايل'), (c) => <PhoneText v={c.phone} className="text-xs" />),
            C.text('area', t('المنطقة'), area, { maxChars: 16 }),
            C.status('tier', t('المستوى'), (c) => (c.loyalty.tier ? { label: L(c.loyalty.tier.name) } : null), { cell: (c) => <TierBadge tier={c.loyalty.tier} /> }),
            C.number('points', t('النقاط'), (c) => c.loyalty.balance, { cell: (c) => <span className="num font-bold text-[var(--primary)]">{c.loyalty.balance}</span> }),
            C.number('orders', t('الطلبات'), (c) => c.stats.orders),
            C.money('spent', t('إجمالي الصرف'), (c) => c.stats.spent),
            C.date('last', t('آخر طلب'), (c) => c.stats.lastOrderAt),
          ]} />
      </Card>
      <CustomerPicker open={creating} createFirst onClose={() => setCreating(false)} title={t('عميل جديد')} onPick={(c) => { setCreating(false); nav('customer', { customerId: c.id }); }} />
    </div>
  );
}
