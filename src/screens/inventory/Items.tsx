// Stock items: every ingredient, preparation and resale item with its balance per warehouse, value, level state
// and nearest expiry. Opening one shows its details beside the list (wide) or as a full page with back (narrow):
// units & packs, levels, lots, cost history, recipes, movements. The open item lives in the route (params.open).
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Package, Coins, TrendingDown, PackageX, ScanSearch } from 'lucide-react';
import { useDev } from '../../app/hooks';
import { Button, Card, EmptyState, FILL_BODY, FILL_CARD, FillPage, MasterDetail, Money, PageHeader, Pill, SearchInput, Select, StatCard, StatGrid, StateBadge, Switch, DataTable, cols, DensityToggle, Toolbar } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L, tv } from '../../i18n';
import { D } from '../../mock/money';
import { BranchScope, LEVEL_TEXT, LevelPill, Qty, useBranchScope, useList } from './common';
import { ItemDetail, NewItemDialog } from './ItemDetail';

const OPS = ['InventoryItem.Find', 'InventoryItem.Get', 'InventoryItem.Configure', 'InventoryItem.SetLevels', 'Inventory.OnHand', 'Inventory.Adjust'];
const KIND_LABEL: Record<string, string> = { RAW: 'خامة', PREP: 'تجهيزة', RESALE: 'بيتباع زي ما هو' };

export default function InventoryItems() {
  const { params, nav } = useDev();
  const scope = useBranchScope();
  const [text, setText] = useState('');
  const [cat, setCat] = useState('');
  const [kind, setKind] = useState('');
  const [state, setState] = useState<string>(params?.state ?? '');
  const [showInactive, setShowInactive] = useState(false);
  const open: string | null = params?.open ?? null;
  const back = params?.back as { screen: string; params?: Record<string, any> } | undefined;
  const setOpen = (id: string | null) => nav('inv-items', { ...params, open: id ?? undefined, back: id ? back : undefined });
  const close = () => (back ? nav(back.screen, back.params ?? {}) : setOpen(null));
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params?.state) setState(params.state); }, [params?.state]);
  const q = useList<any>('InventoryItem.Find', { branchId: scope.branchId, category: cat || undefined, kind: kind || undefined, state: state || undefined, active: showInactive ? undefined : 'true' });
  const whs: any[] = q.raw?.warehouses ?? [];
  const shown = useMemo(() => {
    const s = text.trim().toLowerCase();
    return s ? q.items.filter((i) => `${i.name.ar} ${i.name.en} ${i.sku}`.toLowerCase().includes(s)) : q.items;
  }, [q.items, text]);
  const totalValue = shown.reduce((a, i) => a.plus(D(i.value)), D(0));
  const IC = cols<any>();
  const stockOf = (i: any) => i.stock.reduce((a: any, x: any) => a.plus(D(x.quantity)), D(0)).toFixed(6);
  const level = (i: any) => ({ label: t(LEVEL_TEXT[i.state]?.ar ?? '—') });
  const all = q.items;
  const low = all.filter((i) => i.state === 'LOW').length;
  const out = all.filter((i) => i.state === 'OUT' || i.state === 'NEGATIVE').length;
  const loading = q.loading && !q.raw;
  const list = (compact: boolean) => (
    <FillPage>
      <PageHeader className="!mb-0" icon={<Package />} title={t('الخامات والأصناف')} badge={<StateBadge ops={OPS} />}
        actions={<><BranchScope scope={scope} /><Button data-fb="items:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('صنف جديد')}</Button></>} />
      {!compact && <StatGrid>
        <StatCard label={t('أصناف في المخزن')} value={all.length} icon={<Package />} loading={loading} />
        <StatCard label={t('قيمة المخزون')} value={<Money v={all.reduce((a, i) => a.plus(D(i.value)), D(0)).toFixed(4)} />} icon={<Coins />} tone="primary" loading={loading} />
        <StatCard label={t('قرب يخلص')} value={low} icon={<TrendingDown />} tone={low ? 'warning' : 'neutral'} onClick={() => setState(state === 'LOW' ? '' : 'LOW')} fb="items:kpi-low" loading={loading} />
        <StatCard label={t('خلص أو بالسالب')} value={out} icon={<PackageX />} tone={out ? 'error' : 'neutral'} onClick={() => setState(state === 'OUT,NEGATIVE' ? '' : 'OUT,NEGATIVE')} fb="items:kpi-out" loading={loading} />
      </StatGrid>}
      <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
        <Toolbar>
          <SearchInput data-fb="items:search" value={text} onChange={setText} placeholder={t('دوّر باسم الصنف')} />
          {!compact && <Select data-fb="items:category" className="!w-auto min-w-[150px]" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل المجموعات') }, ...(q.raw?.categories ?? []).map((c: string) => ({ value: c, label: tv(c) }))]} />}
          {!compact && <Select data-fb="items:kind" className="!w-auto min-w-[140px]" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: t('كل الأنواع') }, ...Object.entries(KIND_LABEL).map(([k, v]) => ({ value: k, label: t(v) }))]} />}
          <Select data-fb="items:state" className="!w-auto min-w-[150px]" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, { value: 'LOW,OUT,NEGATIVE', label: t('النواقص بس') }, ...Object.entries(LEVEL_TEXT).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} />
          {!compact && <Switch checked={showInactive} onChange={setShowInactive} label={t('اعرض الموقوف')} />}
          <Toolbar.Spacer />
          <span className="text-xs text-dim">{t('{n} صنف', { n: shown.length })} · {t('القيمة')} <Money v={totalValue.toFixed(4)} /></span>
          {!compact && <DensityToggle dense />}
        </Toolbar>
        <DataTable fill dense rows={shown} rowKey={(i: any) => i.id} selectedKey={open} onRowOpen={(i) => setOpen(i.id)} loading={loading} label={t('الخامات والأصناف')} pageSize={100}
          empty={<EmptyState compact icon={<Package />} title={q.items.length ? t('مفيش أصناف بالفلتر ده') : t('لسه مفيش أصناف في المخزن')} action={!q.items.length ? <Button variant="primary" onClick={() => setCreating(true)}>{t('صنف جديد')}</Button> : undefined} />}
          columns={compact ? [
            IC.text('name', t('الصنف'), (i) => L(i.name), { cell: (i) => <div data-fb={`items:open:${i.id}`} className="text-start min-w-[140px]"><div className="font-bold flex items-center gap-1.5">{L(i.name)}{!i.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</div><div className="text-[11px] text-dim">{tv(i.category)}</div></div> }),
            IC.qty('stock', t('الرصيد'), stockOf, { cell: (i) => <Qty v={stockOf(i)} unit={i.unit} hint={false} /> }),
            IC.status('state', t('الحالة'), level, { cell: (i) => <LevelPill state={i.state} /> }),
          ] : [
            IC.text('name', t('الصنف'), (i) => L(i.name), { cell: (i) => (
              <div data-fb={`items:open:${i.id}`} className="text-start min-w-[150px]">
                <div className="font-bold flex items-center gap-1.5">{L(i.name)}{!i.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</div>
                <div className="text-[11px] text-dim flex gap-1.5 items-center"><Tech><span className="num">{i.sku}</span></Tech>{i.kind !== 'RAW' && <Pill tone={i.kind === 'PREP' ? 'violet' : 'info'}>{t(KIND_LABEL[i.kind])}</Pill>}{i.packs?.length ? <span>{L(i.packs.find((p: any) => p.id === i.purchasePackId)?.name ?? i.packs[0].name)}</span> : null}</div>
              </div>) }),
            IC.text('category', t('المجموعة'), (i) => tv(i.category), { maxChars: 16 }),
            ...whs.map((w, k) => IC.qty(`wh:${w.id}`, <span>{tv(w.name)}{w.salesDefault ? ' ★' : ''}</span>, (i) => i.stock[k]?.quantity, { headerText: tv(w.name), cell: (i) => { const st = i.stock[k]; return st ? <span className={st.state === 'LOW' || st.state === 'OUT' ? 'text-[var(--warning)]' : st.state === 'NEGATIVE' ? 'text-[var(--error)]' : ''}><Qty v={st.quantity} unit={i.unit} hint={false} /></span> : <span className="text-dim">—</span>; } })),
            IC.money('value', t('القيمة'), (i) => i.value),
            IC.status('state', t('الحالة'), level, { cell: (i) => <LevelPill state={i.state} /> }),
            IC.day('expiry', t('أقرب صلاحية'), (i) => i.nextExpiry),
            IC.number('recipes', t('في وصفات'), (i) => i.usedInRecipes || null),
            IC.actions('go', (i) => <Button size="sm" variant="ghost" data-fb={`items:360:${i.id}`} title={t('صفحة الصنف كاملة')} onClick={() => nav('item360', { kind: 'item', id: i.id })}><ScanSearch className="w-3.5 h-3.5" />{t('الرحلة')}</Button>),
          ]} />
      </Card>
      <NewItemDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
    </FillPage>
  );
  return <MasterDetail fb="items" open={!!open} list={list} detail={open && <ItemDetail itemId={open} onClose={close} backLabel={back ? t('رجوع') : t('الخامات والأصناف')} />} />;
}
