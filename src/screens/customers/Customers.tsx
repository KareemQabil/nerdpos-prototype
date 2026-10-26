// Customers directory: search by phone, name, notes or area; tags; tier and points; orders and spend.
import React, { useState } from 'react';
import { Users, UserPlus, Search, Copy, Crown } from 'lucide-react';
import { useDev, useQuery } from '../../app/hooks';
import { PageHeader, StateBadge, Button, Card, Money, Select, Table, EmptyState, StatGrid, StatCard, Toolbar, SearchInput, FilterChips } from '../../ui';
import { Tech } from '../../app/tech';
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
  const PAGE = 50;
  const [n, setN] = useState(PAGE);
  return (
    <div data-screen="CR1" className="space-y-4">
      <PageHeader icon={<Users />} title={t('العملاء')} badge={<StateBadge ops={['Customer.Search', 'Customer.Create', 'Customer.Get']} />}
        description={t('كل العملاء اللي طلبوا قبل كده: عناوينهم، طلباتهم، نقاطهم وملاحظاتهم. ابحث برقم الموبايل أو الاسم.')}
        actions={<Button variant="primary" onClick={() => setCreating(true)} data-fb="customers-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}</Button>} />
      <StatGrid>
        <StatCard label={t('عدد العملاء')} value={res.data?.total ?? '—'} icon={<Users />} loading={res.loading && !res.data} />
        {(tiers.data?.items ?? []).filter((x: any) => x.active).map((x: any) => (
          <StatCard key={x.id} label={L(x.name)} value={<span style={{ color: x.color }}>{x.customers}</span>} icon={<Crown style={{ color: x.color }} />} hint={t('عميل في المستوى ده')} />
        ))}
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <SearchInput data-fb="customers-search" value={q} onChange={(v) => { setQ(v); setN(PAGE); }} placeholder={t('رقم الموبايل، الاسم، الحي، ملاحظة…')} />
          <FilterChips value={tag} onChange={(v) => { setTag(v); setN(PAGE); }} options={[{ id: '', label: t('الكل') }, ...Object.entries(TAGS).map(([k, v]) => ({ id: k, label: t(v.ar) }))]} />
          <Toolbar.Spacer />
          <Select className="!w-auto min-w-[150px]" value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: 'RECENT', label: t('ترتيب: آخر طلب') }, { value: 'SPENT', label: t('ترتيب: الأكتر صرفًا') }, { value: 'POINTS', label: t('ترتيب: الأكتر نقاط') }, { value: 'NAME', label: t('ترتيب: الاسم') }]} />
        </Toolbar>
        {(
          <Table loading={res.loading && !items.length} maxHeight={640} onRowClick={(i) => nav('customer', { customerId: items[i].id })} align={[undefined, undefined, undefined, undefined, 'end', 'end', 'end', undefined]}
            head={[t('العميل'), t('الموبايل'), t('المنطقة'), t('المستوى'), t('النقاط'), t('الطلبات'), t('إجمالي الصرف'), t('آخر طلب')]} empty={<EmptyState compact icon={<Users />} title={t('مفيش عملاء بالبحث ده')} text={t('جرّب رقم موبايل تاني، أو ضيف العميل من «عميل جديد».')} />}
            rows={items.slice(0, n).map((c) => {
              const a = c.addresses.find((x: any) => x.isDefault) ?? c.addresses[0];
              return [
                <div className="text-start" data-fb={`open-customer:${c.phone}`}><div className="font-bold flex items-center gap-1.5 flex-wrap">{c.name}<TagPills tags={c.tags} /></div><div className="text-[11px] text-dim"><Tech><span className="num">{c.code}</span></Tech>{c.allergies?.length ? <span className="text-[var(--warning)]">⚠ {t('عنده حساسية')}</span> : null}</div></div>,
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
        {n < items.length && <div className="flex justify-center mt-2"><Button size="sm" variant="ghost" onClick={() => setN(n + PAGE)}>{t('اعرض أكتر ({n} كمان)', { n: items.length - n })}</Button></div>}
      </Card>
      <CustomerPicker open={creating} createFirst onClose={() => setCreating(false)} title={t('عميل جديد')} onPick={(c) => { setCreating(false); nav('customer', { customerId: c.id }); }} />
    </div>
  );
}
