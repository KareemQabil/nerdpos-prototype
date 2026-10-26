// Recipes & costing: the bill of materials of every menu item, kitchen preparation and modifier option, with waste %,
// cost per portion at today's average cost and food-cost % against the selling price. Editing makes a new version.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, BookOpen, History, Save, Trash2, CookingPot } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Empty, Field, Input, KV, Modal, Money, Pill, Section, Select, Spinner, StateBadge, Table, Tabs, Textarea } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { BandPill, ItemPicker, Pct, fmtQty, newKey, unitIdLabel, unitLabel, unitOptions, useItemsCatalog, useList } from './common';
import { FoodBar } from './Dashboard';

const OPS = ['Recipe.Define', 'Recipe.Find', 'Recipe.Get', 'Recipe.Cost'];
type Tab = 'MENU' | 'PREP' | 'MODIFIER' | 'MISSING';
const CH: Record<string, string> = { DINE_IN: 'صالة', TAKEAWAY: 'تيك أواي', DELIVERY: 'دليفري' };

export default function Recipes() {
  const { params } = useDev();
  const [tab, setTab] = useState<Tab>('MENU');
  const [text, setText] = useState('');
  const [band, setBand] = useState('');
  const q = useList<any>('Recipe.Find');
  const [open, setOpen] = useState<string | null>(params?.open ?? null);
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => { if (params?.open) setOpen(params.open); }, [params?.open]);
  const rows = useMemo(() => q.items.filter((r) => r.outputKind === tab && (!text || L(r.name).includes(text)) && (!band || r.cost.band === band))
    .sort((a, b) => (tab === 'MENU' ? Number(b.cost.foodCostPercent ?? -1) - Number(a.cost.foodCostPercent ?? -1) : L(a.name).localeCompare(L(b.name)))), [q.items, tab, text, band]);
  const missing: any[] = q.raw?.productsWithoutRecipe ?? [];
  const counts = { MENU: q.items.filter((r) => r.outputKind === 'MENU').length, PREP: q.items.filter((r) => r.outputKind === 'PREP').length, MODIFIER: q.items.filter((r) => r.outputKind === 'MODIFIER').length };
  const high = q.items.filter((r) => r.outputKind === 'MENU' && r.cost.band === 'HIGH').length;
  return (
    <div>
      <Section title={t('الوصفات والتكلفة')} badge={<StateBadge ops={OPS} />} sub={t('مكونات كل طبق وكل تحضيرة وكل إضافة، تكلفتها بمتوسط سعر الخامات النهارده، ونسبة تكلفة الأكل من سعر البيع.')}
        actions={<Button data-fb="recipes:new" variant="primary" onClick={() => setEdit({ kind: tab === 'MISSING' ? 'MENU' : tab })}><Plus className="w-4 h-4" />{t('وصفة جديدة')}</Button>} />
      {high > 0 && <Banner tone="warning">{t('{n} طبق تكلفته أعلى من 40% من سعره — راجع الكميات أو السعر.', { n: high })}</Banner>}
      <Tabs className="my-4" value={tab} onChange={setTab} tabs={[
        { id: 'MENU', label: t('أصناف المنيو ({n})', { n: counts.MENU }) }, { id: 'PREP', label: t('التحضيرات ({n})', { n: counts.PREP }) },
        { id: 'MODIFIER', label: t('الإضافات والأحجام ({n})', { n: counts.MODIFIER }) }, { id: 'MISSING', label: <span className={missing.length ? 'text-[var(--warning)]' : ''}>{t('من غير وصفة ({n})', { n: missing.length })}</span> },
      ]} />
      {tab !== 'MISSING' && (
        <div className="flex flex-wrap gap-2 mb-3">
          <Input className="w-60" data-fb="recipes:search" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('دوّر بالاسم')} />
          {tab === 'MENU' && <Select className="w-48" value={band} onChange={(e) => setBand(e.target.value)} options={[{ value: '', label: t('كل النسب') }, { value: 'HIGH', label: t('عالية (فوق 40%)') }, { value: 'WATCH', label: t('خلي بالك (30–40%)') }, { value: 'GOOD', label: t('كويسة (لحد 30%)') }]} />}
        </div>
      )}
      {q.loading && !q.raw ? <Spinner /> : tab === 'MISSING' ? (
        missing.length === 0 ? <Empty icon={<BookOpen className="w-10 h-10" />} text={t('كل أصناف المنيو ليها وصفة')} /> : (
          <Table head={[t('الصنف'), '']} rows={missing.map((p) => [<span className="font-bold">{L(p.name)}</span>, <Button size="sm" variant="primary" data-fb={`recipes:create-for:${p.id}`} onClick={() => setEdit({ kind: 'MENU', outputProductId: p.id })}><Plus className="w-3.5 h-3.5" />{t('اعمل وصفة')}</Button>])} />
        )
      ) : rows.length === 0 ? <Empty icon={<BookOpen className="w-10 h-10" />} text={t('مفيش وصفات هنا')} /> : (
        <Table head={tab === 'MENU' ? [t('الطبق'), t('المكونات'), t('التكلفة'), t('سعر الصالة'), t('نسبة التكلفة'), ''] : tab === 'PREP' ? [t('التحضيرة'), t('المكونات'), t('الدفعة بتطلع'), t('تكلفة الدفعة'), t('تكلفة الوحدة'), ''] : [t('الإضافة'), t('المكونات'), t('التكلفة الزيادة'), '']}
          rows={rows.map((r) => {
            const ings = <span className="text-xs text-dim">{r.activeVersion.inputsPerBatch.map((i: any) => L(i.name)).slice(0, 4).join('، ')}{r.activeVersion.inputsPerBatch.length > 4 ? ` +${r.activeVersion.inputsPerBatch.length - 4}` : ''}</span>;
            const name = <button data-fb={`recipes:open:${r.id}`} className="font-bold hover:text-[var(--primary)] text-start" onClick={() => setOpen(r.id)}>{L(r.name)}{r.versionCount > 1 && <Pill tone="neutral" className="ms-1">{t('نسخة {n}', { n: r.activeVersion.version })}</Pill>}</button>;
            if (tab === 'MENU') return [name, ings, <Money v={r.cost.perUnit} className="text-sm" />, r.cost.prices.find((p: any) => p.channel === 'DINE_IN')?.net ? <Money v={r.cost.prices.find((p: any) => p.channel === 'DINE_IN').net} className="text-xs" /> : <span className="text-dim text-xs">—</span>, <FoodBar pct={r.cost.foodCostPercent} band={r.cost.band} />, <BandPill band={r.cost.band} />];
            if (tab === 'PREP') return [name, ings, <span className="num">{fmtQty(r.activeVersion.outputQuantityPerBatch)} {unitLabel(r.outputUnit)}</span>, <Money v={r.cost.total} className="text-xs" />, <span className="num font-bold">{money(r.cost.perUnit)} <span className="text-[11px] text-dim">/ {unitLabel(r.outputUnit)}</span></span>, ''];
            return [name, ings, <Money v={r.cost.perUnit} className="text-sm" />, ''];
          })} />
      )}
      <RecipeView id={open} onClose={() => setOpen(null)} onEdit={(r) => { setOpen(null); setEdit({ recipe: r, kind: r.outputKind }); }} />
      {edit && <RecipeEditor init={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); setOpen(id); }} />}
    </div>
  );
}

function RecipeView({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (r: any) => void }) {
  const q = useQuery<any>(id ? 'Recipe.Get' : null, { params: { recipeId: id } });
  const [ver, setVer] = useState<string>('');
  useEffect(() => setVer(''), [id]);
  const r = q.data;
  const c = useQuery<any>(id ? 'Recipe.Cost' : null, { params: { recipeId: id }, query: { versionId: ver || undefined } });
  const cost = c.data;
  return (
    <Modal open={!!id} onClose={onClose} xwide title={r ? <span className="flex items-center gap-2"><CookingPot className="w-5 h-5 text-[var(--primary)]" />{L(r.name)}</span> : t('وصفة')}
      badge={r ? <><Pill tone={r.outputKind === 'MENU' ? 'primary' : r.outputKind === 'PREP' ? 'violet' : 'neutral'}>{r.outputKind === 'MENU' ? t('صنف منيو') : r.outputKind === 'PREP' ? t('تحضيرة') : t('إضافة')}</Pill><StateBadge ops={OPS} /></> : undefined}
      footer={r && <Button variant="primary" data-fb="recipe:edit" onClick={() => onEdit(r)}><Pencil className="w-4 h-4" />{t('عدّل (نسخة جديدة)')}</Button>}>
      {!r || !cost ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Box l={r.outputKind === 'PREP' ? t('تكلفة الدفعة') : t('تكلفة الطبق')} v={<Money v={cost.total} />} />
            {r.outputKind === 'PREP' && <Box l={t('تكلفة الوحدة')} v={<span className="num">{money(cost.perUnit)} / {unitLabel(r.outputUnit)}</span>} />}
            {r.outputKind === 'PREP' && <Box l={t('الدفعة بتطلع')} v={<span className="num">{fmtQty(cost.outputQuantity)} {unitLabel(r.outputUnit)}</span>} />}
            {r.outputKind === 'MENU' && cost.prices.map((p: any) => <Box key={p.channel} l={t('نسبة التكلفة — {c} ({p})', { c: t(CH[p.channel] ?? p.channel), p: money(p.net) })} v={<Pct v={p.foodCostPercent} band={p.band} />} />)}
          </div>
          {r.outputKind === 'MENU' && cost.band === 'HIGH' && <Banner tone="error">{t('التكلفة عالية: كل 100 جنيه بيع منهم {p} جنيه خامات. راجع البورشن أو السعر.', { p: cost.foodCostPercent })}</Banner>}
          <div className="flex items-center gap-2"><span className="text-xs text-soft">{t('النسخة')}</span><Select className="w-64" value={ver} onChange={(e) => setVer(e.target.value)} options={[{ value: '', label: t('الشغالة دلوقتي (نسخة {n})', { n: r.activeVersion.version }) }, ...r.versions.map((v: any) => ({ value: v.id, label: `${t('نسخة {n}', { n: v.version })} — ${dateTime(v.effectiveFrom)}` }))]} /></div>
          <Table head={[t('المكوّن'), t('الكمية'), t('هالك التحضير'), t('الكمية الفعلية'), t('سعر الوحدة'), t('التكلفة'), t('من التكلفة')]} rows={cost.lines.map((l: any) => [
            <span className="font-bold">{L(l.name)}</span>,
            <span className="num">{fmtQty(l.enteredQuantity)} {unitIdLabel(l.enteredUnit)}</span>,
            Number(l.wastePercent) > 0 ? <span className="num">{l.wastePercent}%</span> : <span className="text-dim">—</span>,
            <span className="num text-xs">{fmtQty(l.grossQuantity, 4)} {unitIdLabel(l.stockUnitId)}</span>,
            <span className="num text-xs">{money(l.unitCost)}</span>,
            <Money v={l.cost} className="text-sm" />,
            <div className="flex items-center gap-1.5 min-w-[90px]"><div className="flex-1 h-1.5 rounded-full surface-2 overflow-hidden"><div className="h-full bg-[var(--primary)]" style={{ width: `${(Number(l.cost) / Math.max(0.0001, Number(cost.total))) * 100}%` }} /></div><span className="num text-[11px]">{((Number(l.cost) / Math.max(0.0001, Number(cost.total))) * 100).toFixed(0)}%</span></div>,
          ])} />
          <div className="text-[11px] text-dim">{t('هالك التحضير: التقشير والتنضيف والفقد في الطبخ — بيتزود على الكمية وقت الخصم من المخزن. التكلفة بمتوسط سعر الخامة النهارده.')}</div>
          <div>
            <div className="text-xs font-bold text-soft mb-1 flex items-center gap-1"><History className="w-3.5 h-3.5" />{t('النسخ')}</div>
            <ol className="space-y-1 border-s-2 line ps-3 text-xs">{[...r.versions].reverse().map((v: any) => (
              <li key={v.id}><b>{t('نسخة {n}', { n: v.version })}</b> · {t('تبدأ')} {dateTime(v.effectiveFrom)} · {v.createdByName} · <span className="num">{money(v.cost)}</span>{v.id === r.activeVersionId && <Pill tone="success" className="ms-1">{t('الشغالة')}</Pill>}{v.note && <div className="text-dim">{v.note}</div>}</li>
            ))}</ol>
          </div>
          <Tech><div className="text-[11px] num text-dim">{r.id} · {r.outputProductId} · method {cost.method}</div></Tech>
        </div>
      )}
    </Modal>
  );
}
function Box({ l, v }: { l: React.ReactNode; v: React.ReactNode }) { return <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim">{l}</div><div className="font-bold mt-0.5">{v}</div></div>; }

interface Line { itemId: string; quantity: string; unit: string; wastePercent: string }
function RecipeEditor({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useCommand();
  const items = useItemsCatalog();
  const products = useList<any>('Catalog.Search', { active: 'true' });
  const groups = useList<any>('ModifierGroup.List');
  const r = init.recipe;
  const kind: 'MENU' | 'PREP' | 'MODIFIER' = r?.outputKind ?? init.kind ?? 'MENU';
  const [output, setOutput] = useState<string>(r ? (kind === 'MODIFIER' ? r.appliesToProductId ?? '' : r.outputProductId) : init.outputProductId ?? '');
  const [option, setOption] = useState<string>(r?.modifierOptionId ?? '');
  const [outQty, setOutQty] = useState<string>(r?.activeVersion.outputQuantityPerBatch ?? '1');
  const [lines, setLines] = useState<Line[]>(() => r ? r.activeVersion.inputsPerBatch.map((i: any) => ({ itemId: i.itemId, quantity: i.enteredQuantity, unit: i.enteredUnit, wastePercent: i.wastePercent === '0' ? '' : i.wastePercent })) : [{ itemId: '', quantity: '', unit: '', wastePercent: '' }]);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const options = groups.items.flatMap((g: any) => g.options.map((o: any) => ({ ...o, group: g.name })));
  const prepItems = items.items.filter((i) => i.kind === 'PREP');
  const estimate = lines.reduce((a, l) => {
    const it = items.items.find((i) => i.id === l.itemId);
    if (!it || !(Number(l.quantity) > 0)) return a;
    const f = unitOptions(it).find((o) => o.value === l.unit)?.factor ?? 1;
    return a + Number(l.quantity) * f * (1 + Number(l.wastePercent || 0) / 100) * Number(it.avgCost);
  }, 0);
  const save = async () => {
    const id = r?.id ?? newKey('rcp');
    const body: any = { outputQuantityPerBatch: kind === 'PREP' ? outQty : '1', inputsPerBatch: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit || undefined, wastePercent: l.wastePercent || '0' })), note: note || undefined, effectiveFrom: when ? new Date(when).toISOString() : undefined };
    if (kind === 'MODIFIER') { body.modifierOptionId = option; body.appliesToProductId = output || undefined; body.outputProductId = output || option; } else body.outputProductId = output;
    const res = await run<any>('Recipe.Define', { params: { recipeId: id }, body }, { success: r ? t('اتعملت نسخة جديدة من الوصفة') : t('الوصفة اتحفظت') });
    if (res) onSaved(res.id);
  };
  const valid = (kind === 'MODIFIER' ? !!option : !!output) && lines.some((l) => l.itemId && Number(l.quantity) > 0) && (kind !== 'PREP' || Number(outQty) > 0);
  return (
    <Modal open onClose={onClose} xwide title={r ? t('تعديل وصفة — {n}', { n: L(r.name) }) : t('وصفة جديدة')} badge={<StateBadge ops={['Recipe.Define']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="recipe-edit:save" loading={busy} disabled={!valid} onClick={save}><Save className="w-4 h-4" />{r ? t('احفظ نسخة جديدة') : t('احفظ الوصفة')}</Button></>}>
      <div className="space-y-3">
        {!r && <div className="text-sm text-dim">{kind === 'MENU' ? t('وصفة طبق من المنيو: الكميات لطبق واحد.') : kind === 'PREP' ? t('وصفة تحضيرة: الكميات لدفعة واحدة، واكتب الدفعة بتطلع كام.') : t('وصفة إضافة: المكونات الزيادة لما الزبون يختار الإضافة دي.')}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {kind === 'MENU' && <Field label={t('صنف المنيو')}><Select data-fb="recipe-edit:product" disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('اختار') }, ...products.items.map((p) => ({ value: p.id, label: L(p.name) }))]} /></Field>}
          {kind === 'PREP' && <>
            <Field label={t('التحضيرة (صنف مخزن)')}><Select data-fb="recipe-edit:prep" disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('اختار') }, ...prepItems.map((i) => ({ value: i.id, label: L(i.name) }))]} /></Field>
            <Field label={t('الدفعة بتطلع كام')} hint={unitLabel(items.items.find((i) => i.id === output)?.unit)}><Input data-fb="recipe-edit:out-qty" inputMode="decimal" value={outQty} onChange={(e) => setOutQty(e.target.value)} /></Field>
          </>}
          {kind === 'MODIFIER' && <>
            <Field label={t('الإضافة / الحجم')}><Select data-fb="recipe-edit:option" disabled={!!r} value={option} onChange={(e) => setOption(e.target.value)} options={[{ value: '', label: t('اختار') }, ...options.map((o: any) => ({ value: o.id, label: `${L(o.group)}: ${L(o.name)}` }))]} /></Field>
            <Field label={t('على صنف معين؟')} hint={t('فاضي = أي صنف')}><Select disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('أي صنف') }, ...products.items.map((p) => ({ value: p.id, label: L(p.name) }))]} /></Field>
          </>}
          <Field label={t('تبدأ من')} hint={t('فاضي = دلوقتي')}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        <Table head={[t('المكوّن'), t('الكمية'), t('الوحدة'), t('هالك التحضير %'), t('تكلفة تقريبية'), '']} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const opts = unitOptions(it);
          const f = opts.find((o) => o.value === l.unit)?.factor ?? 1;
          const c = it && Number(l.quantity) > 0 ? Number(l.quantity) * f * (1 + Number(l.wastePercent || 0) / 100) * Number(it.avgCost) : null;
          return [
            <ItemPicker fb={`recipe-edit:item:${i}`} className="min-w-[200px]" items={items.items.filter((x) => x.id !== output)} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: id, unit: item.unit === 'KG' ? 'unit_g' : item.unit === 'L' ? 'unit_ml' : item.stockUnitId } : x)))} />,
            <Input data-fb={`recipe-edit:qty:${i}`} className="w-24" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x)))} />,
            opts.length ? <Select className="w-32" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} options={opts.map((o) => ({ value: o.value, label: o.label }))} /> : '—',
            <Input className="w-20" inputMode="decimal" value={l.wastePercent} placeholder="0" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, wastePercent: e.target.value.replace(/[^\d.]/g, '') } : x)))} />,
            c !== null ? <span className="num text-xs">{money(c.toFixed(4))}</span> : '—',
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        <div className="flex items-center justify-between">
          <Button size="sm" data-fb="recipe-edit:add" onClick={() => setLines([...lines, { itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Plus className="w-3.5 h-3.5" />{t('مكوّن كمان')}</Button>
          <div className="text-sm">{t('التكلفة التقريبية')}: <b className="num">{money(estimate.toFixed(4))}</b>{kind === 'PREP' && Number(outQty) > 0 && <span className="text-dim"> · {money((estimate / Number(outQty)).toFixed(4))} / {unitLabel(items.items.find((i) => i.id === output)?.unit)}</span>}</div>
        </div>
        <Field label={t('ملاحظة على النسخة')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثال: تقليل البورشن بعد زيادة سعر اللحمة')} /></Field>
        {r && <Banner tone="info">{t('التعديل بيعمل نسخة جديدة — المبيعات اللي فاتت بتفضل محسوبة بالنسخة القديمة.')}</Banner>}
      </div>
    </Modal>
  );
}
