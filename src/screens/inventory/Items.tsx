// Stock items: every ingredient, preparation and resale item with its balance per warehouse, value, level state
// and nearest expiry. Opening one shows its drawer (units & packs, levels, lots, cost history, recipes, movements).
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Package } from 'lucide-react';
import { useDev } from '../../app/hooks';
import { Button, Empty, Field, Input, Money, Pill, Section, Select, Spinner, StateBadge, Table } from '../../ui';
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
  return (
    <div>
      <Section title={t('الخامات والأصناف')} badge={<StateBadge ops={OPS} />} sub={t('رصيد كل صنف في كل مخزن، وحدة المخزن وعبوة الشراء، الحد الأدنى، الصلاحية والتكلفة.')}
        actions={<><BranchScope scope={scope} /><Button data-fb="items:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('صنف جديد')}</Button></>} />
      <div className="flex flex-wrap gap-2 items-end mb-3">
        <Field label={t('بحث')} className="w-60"><div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="items:search" style={{ paddingInlineStart: 36 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('اسم أو كود')} /></div></Field>
        <Field label={t('المجموعة')} className="w-48"><Select data-fb="items:category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل المجموعات') }, ...(q.raw?.categories ?? []).map((c: string) => ({ value: c, label: c }))]} /></Field>
        <Field label={t('النوع')} className="w-40"><Select data-fb="items:kind" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: '', label: t('الكل') }, ...Object.entries(KIND_LABEL).map(([k, v]) => ({ value: k, label: t(v) }))]} /></Field>
        <Field label={t('الحالة')} className="w-48"><Select data-fb="items:state" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, { value: 'LOW,OUT,NEGATIVE', label: t('النواقص بس') }, ...Object.entries(LEVEL_TEXT).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} /></Field>
        <label className="text-xs flex items-center gap-1.5 h-10"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />{t('اعرض الموقوف')}</label>
        <div className="flex-1" />
        <div className="text-sm text-dim">{t('{n} صنف', { n: shown.length })} · {t('القيمة')} <Money v={totalValue.toFixed(4)} /></div>
      </div>
      {q.loading && !q.raw ? <div className="py-10 flex justify-center"><Spinner /></div> : shown.length === 0 ? (
        <Empty icon={<Package className="w-10 h-10" />} text={q.items.length ? t('مفيش أصناف بالفلتر ده') : t('لسه مفيش أصناف في المخزن. ضيف أول خامة.')}>{!q.items.length && <Button variant="primary" onClick={() => setCreating(true)}>{t('صنف جديد')}</Button>}</Empty>
      ) : (
        <Table head={[t('الصنف'), t('المجموعة'), ...whs.map((w) => <span key={w.id}>{w.name}{w.salesDefault ? ' ★' : ''}</span>), t('القيمة'), t('الحالة'), t('أقرب صلاحية'), t('في وصفات')]} rows={shown.map((i) => [
          <button data-fb={`items:open:${i.id}`} className="text-start min-w-[150px]" onClick={() => setOpen(i.id)}>
            <div className="font-bold hover:text-[var(--primary)] flex items-center gap-1.5">{L(i.name)}{!i.active && <Pill tone="neutral">{t('موقوف')}</Pill>}</div>
            <div className="text-[11px] text-dim flex gap-1.5 items-center"><span className="num">{i.sku}</span>{i.kind !== 'RAW' && <Pill tone={i.kind === 'PREP' ? 'violet' : 'info'}>{t(KIND_LABEL[i.kind])}</Pill>}{i.packs?.length ? <span>{L(i.packs.find((p: any) => p.id === i.purchasePackId)?.name ?? i.packs[0].name)}</span> : null}</div>
          </button>,
          <span className="text-xs">{i.category}</span>,
          ...i.stock.map((s: any) => <span key={s.warehouseId} className={s.state === 'LOW' || s.state === 'OUT' ? 'text-[var(--warning)]' : s.state === 'NEGATIVE' ? 'text-[var(--error)]' : ''}><Qty v={s.quantity} unit={i.unit} hint={false} /></span>),
          <Money v={i.value} className="text-xs" />,
          <LevelPill state={i.state} />,
          i.nextExpiry ? <span className="num text-xs">{i.nextExpiry}</span> : <span className="text-dim text-xs">—</span>,
          i.usedInRecipes ? <span className="num text-xs">{i.usedInRecipes}</span> : <span className="text-dim text-xs">—</span>,
        ])} />
      )}
      <ItemDrawer itemId={open} onClose={() => setOpen(null)} />
      <NewItemDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />
    </div>
  );
}
