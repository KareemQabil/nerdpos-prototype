// Stock items: every ingredient, preparation and resale item with its balance per warehouse, value, level state
// and nearest expiry. Opening one shows its drawer (units & packs, levels, lots, cost history, recipes, movements).
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Package, Coins, TrendingDown, PackageX } from 'lucide-react';
import { useDev } from '../../app/hooks';
import { Button, Card, EmptyState, Money, PageHeader, Pill, SearchInput, Select, StatCard, StatGrid, StateBadge, Switch, Table, Toolbar } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { BranchScope, LEVEL_TEXT, LevelPill, Qty, useBranchScope, useList } from './common';
import { ItemDrawer, NewItemDialog } from './ItemDrawer';

const OPS = ['InventoryItem.Find', 'InventoryItem.Get', 'InventoryItem.Configure', 'InventoryItem.SetLevels', 'Inventory.OnHand', 'Inventory.Adjust'];
const KIND_LABEL: Record<string, string> = { RAW: 'خامة', PREP: 'تجهيزة', RESALE: 'بيتباع زي ما هو' };

export default function InventoryItems() {
  const { params } = useDev();
  const scope = useBranchScope();
  const [text, setText] = useState('');
  const [cat, setCat] = useState('');
  const [kind, setKind] = useState('');
  const [state, setState] = useState<string>(params?.state ?? '');
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState<string | null>(params?.open ?? null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params?.state) setState(params.state); if (params?.open) setOpen(params.open); }, [params?.state, params?.open]);
  const q = useList<any>('InventoryItem.Find', { branchId: scope.branchId, category: cat || undefined, kind: kind || undefined, state: state || undefined, active: showInactive ? undefined : 'true' });
  const whs: any[] = q.raw?.warehouses ?? [];
  const shown = useMemo(() => {
    const s = text.trim().toLowerCase();
    return s ? q.items.filter((i) => `${i.name.ar} ${i.name.en} ${i.sku}`.toLowerCase().includes(s)) : q.items;
  }, [q.items, text]);
  const totalValue = shown.reduce((a, i) => a + Number(i.value), 0);
  const all = q.items;
  const low = all.filter((i) => i.state === 'LOW').length;
  const out = all.filter((i) => i.state === 'OUT' || i.state === 'NEGATIVE').length;
  const loading = q.loading && !q.raw;
  return (
    <div className="space-y-4">
      <PageHeader icon={<Package />} title={t('الخامات والأصناف')} badge={<StateBadge ops={OPS} />} description={t('رصيد كل صنف في كل مخزن، عبوة الشراء، الحد الأدنى، الصلاحية والتكلفة. اضغط على أي صنف عشان تفتح تفاصيله.')}
        actions={<><BranchScope scope={scope} /><Button data-fb="items:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('صنف جديد')}</Button></>} />
      <StatGrid>
        <StatCard label={t('أصناف في المخزن')} value={all.length} icon={<Package />} loading={loading} />
        <StatCard label={t('قيمة المخزون')} value={<Money v={all.reduce((a, i) => a + Number(i.value), 0).toFixed(4)} />} icon={<Coins />} tone="primary" loading={loading} hint={t('بالتكلفة')} />
        <StatCard label={t('قرب يخلص')} value={low} icon={<TrendingDown />} tone={low ? 'warning' : 'neutral'} onClick={() => setState(state === 'LOW' ? '' : 'LOW')} fb="items:kpi-low" loading={loading} hint={t('تحت الحد الأدنى')} />
        <StatCard label={t('خلص أو بالسالب')} value={out} icon={<PackageX />} tone={out ? 'error' : 'neutral'} onClick={() => setState(state === 'OUT,NEGATIVE' ? '' : 'OUT,NEGATIVE')} fb="items:kpi-out" loading={loading} />
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <SearchInput data-fb="items:search" value={text} onChange={setText} placeholder={t('دوّر باسم الصنف')} />
          <Select data-fb="items:category" className="!w-auto min-w-[150px]" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل المجموعات') }, ...(q.raw?.categories ?? []).map((c: string) => ({ value: c, label: c }))]} />
          <Select data-fb="items:kind" className="!w-auto min-w-[140px]" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: t('كل الأنواع') }, ...Object.entries(KIND_LABEL).map(([k, v]) => ({ value: k, label: t(v) }))]} />
          <Select data-fb="items:state" className="!w-auto min-w-[150px]" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, { value: 'LOW,OUT,NEGATIVE', label: t('النواقص بس') }, ...Object.entries(LEVEL_TEXT).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} />
          <Switch checked={showInactive} onChange={setShowInactive} label={t('اعرض الموقوف')} />
          <Toolbar.Spacer />
          <span className="text-xs text-dim">{t('{n} صنف', { n: shown.length })} · {t('القيمة')} <Money v={totalValue.toFixed(4)} /></span>
        </Toolbar>
        <Table loading={loading} dense maxHeight={640} onRowClick={(i) => setOpen(shown[i].id)}
          align={['start', 'start', ...whs.map(() => 'end' as const), 'end', 'start', 'start', 'end']}
          empty={<EmptyState compact icon={<Package />} title={q.items.length ? t('مفيش أصناف بالفلتر ده') : t('لسه مفيش أصناف في المخزن')} text={q.items.length ? t('غيّر البحث أو الفلتر.') : t('ضيف أول خامة من «صنف جديد».')} action={!q.items.length ? <Button variant="primary" onClick={() => setCreating(true)}>{t('صنف جديد')}</Button> : undefined} />}
          head={[t('الصنف'), t('المجموعة'), ...whs.map((w) => <span key={w.id}>{w.name}{w.salesDefault ? ' ★' : ''}</span>), t('القيمة'), t('الحالة'), t('أقرب صلاحية'), t('في وصفات')]} rows={shown.map((i) => [
          <div data-fb={`items:open:${i.id}`} className="text-start min-w-[150px]">
            <div className="font-bold flex items-center gap-1.5">{L(i.name)}{!i.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</div>
            <div className="text-[11px] text-dim flex gap-1.5 items-center"><Tech><span className="num">{i.sku}</span></Tech>{i.kind !== 'RAW' && <Pill tone={i.kind === 'PREP' ? 'violet' : 'info'}>{t(KIND_LABEL[i.kind])}</Pill>}{i.packs?.length ? <span>{L(i.packs.find((p: any) => p.id === i.purchasePackId)?.name ?? i.packs[0].name)}</span> : null}</div>
          </div>,
          <span className="text-xs">{i.category}</span>,
          ...i.stock.map((s: any) => <span key={s.warehouseId} className={s.state === 'LOW' || s.state === 'OUT' ? 'text-[var(--warning)]' : s.state === 'NEGATIVE' ? 'text-[var(--error)]' : ''}><Qty v={s.quantity} unit={i.unit} hint={false} /></span>),
          <Money v={i.value} className="text-xs" />,
          <LevelPill state={i.state} />,
          i.nextExpiry ? <span className="num text-xs">{i.nextExpiry}</span> : <span className="text-dim text-xs">—</span>,
          i.usedInRecipes ? <span className="num text-xs">{i.usedInRecipes}</span> : <span className="text-dim text-xs">—</span>,
        ])} />
      </Card>
      <ItemDrawer itemId={open} onClose={() => setOpen(null)} />
      <NewItemDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
    </div>
  );
}
