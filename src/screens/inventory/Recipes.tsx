// Recipes & costing: the bill of materials of every menu item, kitchen preparation and modifier option, with waste %,
// cost per portion at today's average cost and food-cost % against the selling price. Editing makes a new version.
// ux-06: a recipe opens beside the list (wide) or as a full page (narrow) — params.open; the editor is a full page
// with back and a sticky save footer — params.edit ('new' or the recipe id), refresh keeps both.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, BookOpen, History, Save, Trash2, CookingPot } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, DetailPane, EmptyState, FILL_BODY, FILL_CARD, Field, FillPage, Input, MasterDetail, Money, PageHeader, Pill, Select, Spinner, StateBadge, Table, Tabs, Textarea, Toolbar, SearchInput, confirmDialog } from '../../ui';
import { t, L, tv } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { BandPill, ItemPicker, Pct, fmtQty, newKey, unitIdLabel, unitLabel, unitOptions, useItemsCatalog, useList, Inp, Sel } from './common';
import { FoodBar } from './Dashboard';
import { personText } from '../../demo/people';
import { D } from '../../mock/money';

const OPS = ['Recipe.Define', 'Recipe.Find', 'Recipe.Get', 'Recipe.Cost'];
type Tab = 'MENU' | 'PREP' | 'MODIFIER' | 'MISSING';
const CH: Record<string, string> = { DINE_IN: 'صالة', TAKEAWAY: 'تيك أواي', DELIVERY: 'دليفري' };

export default function Recipes() {
  const { params, nav } = useDev();
  const [tab, setTab] = useState<Tab>('MENU');
  const [text, setText] = useState('');
  const [band, setBand] = useState('');
  const q = useList<any>('Recipe.Find');
  const open: string | null = params?.open ?? null;
  const edit: string | null = params?.edit ?? null; // 'new' or a recipe id
  const go = (p: Record<string, any>) => nav('inv-recipes', p);
  const rows = useMemo(() => q.items.filter((r) => r.outputKind === tab && (!text || L(r.name).includes(text)) && (!band || r.cost.band === band))
    .sort((a, b) => (tab === 'MENU' ? Number(b.cost.foodCostPercent ?? -1) - Number(a.cost.foodCostPercent ?? -1) : L(a.name).localeCompare(L(b.name)))), [q.items, tab, text, band]);
  const missing: any[] = q.raw?.productsWithoutRecipe ?? [];
  const counts = { MENU: q.items.filter((r) => r.outputKind === 'MENU').length, PREP: q.items.filter((r) => r.outputKind === 'PREP').length, MODIFIER: q.items.filter((r) => r.outputKind === 'MODIFIER').length };
  const high = q.items.filter((r) => r.outputKind === 'MENU' && r.cost.band === 'HIGH').length;
  const startNew = (p: Record<string, any> = {}) => go({ edit: 'new', kind: tab === 'MISSING' ? 'MENU' : tab, ...p });
  const list = (compact: boolean) => (
    <FillPage>
      <PageHeader className="!mb-0" icon={<CookingPot />} title={t('الوصفات والتكلفة')} badge={<StateBadge ops={OPS} />}
        actions={<Button data-fb="recipes:new" variant="primary" onClick={() => startNew()}><Plus className="w-4 h-4" />{t('وصفة جديدة')}</Button>} />
      {high > 0 && !compact && <Banner tone="warning">{t('{n} طبق تكلفته أعلى من 40% من سعره — راجع الكميات أو السعر.', { n: high })}</Banner>}
      <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
        <Tabs className="mb-3" value={tab} onChange={setTab} tabs={[
          { id: 'MENU', label: t('أصناف المنيو ({n})', { n: counts.MENU }) }, { id: 'PREP', label: t('التحضيرات ({n})', { n: counts.PREP }) },
          { id: 'MODIFIER', label: t('الإضافات والأحجام ({n})', { n: counts.MODIFIER }) }, { id: 'MISSING', label: <span className={missing.length ? 'text-[var(--warning)]' : ''}>{t('من غير وصفة ({n})', { n: missing.length })}</span> },
        ]} />
        {tab !== 'MISSING' && (
          <Toolbar>
            <SearchInput data-fb="recipes:search" value={text} onChange={setText} placeholder={t('دوّر بالاسم')} />
            {tab === 'MENU' && <Sel className="w-48" value={band} onChange={(e) => setBand(e.target.value)} options={[{ value: '', label: t('كل النسب') }, { value: 'HIGH', label: t('عالية (فوق 40%)') }, { value: 'WATCH', label: t('خلي بالك (30–40%)') }, { value: 'GOOD', label: t('كويسة (لحد 30%)') }]} />}
          </Toolbar>
        )}
        {q.loading && !q.raw ? <Spinner /> : tab === 'MISSING' ? (
          missing.length === 0 ? <EmptyState compact icon={<BookOpen />} title={t('كل أصناف المنيو ليها وصفة')} /> : (
            <Table fill head={[t('الصنف'), '']} rows={missing.map((p) => [<span className="font-bold">{L(p.name)}</span>, <Button size="sm" variant="primary" data-fb={`recipes:create-for:${p.id}`} onClick={() => go({ edit: 'new', kind: 'MENU', outputProductId: p.id })}><Plus className="w-3.5 h-3.5" />{t('إنشاء وصفة')}</Button>])} align={['start', 'end']} />
          )
        ) : rows.length === 0 ? <EmptyState compact icon={<BookOpen />} title={t('لا توجد وصفات.')} action={!text && !band ? <Button variant="primary" onClick={() => startNew()}><Plus className="w-4 h-4" />{t('وصفة جديدة')}</Button> : undefined} /> : (
          <Table fill dense={compact} onRowClick={(i) => go({ open: rows[i].id })} rowClassName={(i) => (rows[i].id === open ? 'row-selected' : undefined)}
            align={compact ? ['start', 'end', 'start'] : tab === 'MENU' ? ['start', 'start', 'end', 'end', 'start', 'start'] : tab === 'PREP' ? ['start', 'start', 'end', 'end', 'end', 'start'] : ['start', 'start', 'end', 'start']}
            head={compact ? [tab === 'PREP' ? t('التحضيرة') : tab === 'MODIFIER' ? t('الإضافة') : t('الطبق'), t('التكلفة'), tab === 'MENU' ? t('نسبة التكلفة') : ''] : tab === 'MENU' ? [t('الطبق'), t('المكونات'), t('التكلفة'), t('سعر الصالة'), t('نسبة التكلفة'), ''] : tab === 'PREP' ? [t('التحضيرة'), t('المكونات'), t('الدفعة بتطلع'), t('تكلفة الدفعة'), t('تكلفة الوحدة'), ''] : [t('الإضافة'), t('المكونات'), t('التكلفة الزيادة'), '']}
            rows={rows.map((r) => {
              const ings = <span className="text-xs text-dim">{r.activeVersion.inputsPerBatch.map((i: any) => L(i.name)).slice(0, 4).join(t('، '))}{r.activeVersion.inputsPerBatch.length > 4 ? ` +${r.activeVersion.inputsPerBatch.length - 4}` : ''}</span>;
              const name = <span data-fb={`recipes:open:${r.id}`} className="font-bold text-start">{L(r.name)}{r.versionCount > 1 && <Pill tone="neutral" className="ms-1">{t('نسخة {n}', { n: r.activeVersion.version })}</Pill>}</span>;
              if (compact) return [name, <Money v={tab === 'PREP' ? r.cost.total : r.cost.perUnit} className="text-xs" />, tab === 'MENU' ? <BandPill band={r.cost.band} /> : ''];
              if (tab === 'MENU') return [name, ings, <Money v={r.cost.perUnit} className="text-sm" />, r.cost.prices.find((p: any) => p.channel === 'DINE_IN')?.net ? <Money v={r.cost.prices.find((p: any) => p.channel === 'DINE_IN').net} className="text-xs" /> : <span className="text-dim text-xs">—</span>, <FoodBar pct={r.cost.foodCostPercent} band={r.cost.band} />, <BandPill band={r.cost.band} />];
              if (tab === 'PREP') return [name, ings, <span className="num">{fmtQty(r.activeVersion.outputQuantityPerBatch)} {unitLabel(r.outputUnit)}</span>, <Money v={r.cost.total} className="text-xs" />, <span className="num font-bold">{money(r.cost.perUnit)} <span className="text-[11px] text-dim">/ {unitLabel(r.outputUnit)}</span></span>, ''];
              return [name, ings, <Money v={r.cost.perUnit} className="text-sm" />, ''];
            })} />
        )}
      </Card>
    </FillPage>
  );
  return (
    <MasterDetail fb="recipes" open={!!(open || edit)} side={!edit} list={list}
      detail={edit ? <RecipeEditorPage key={edit} editId={edit} kind={params?.kind} outputProductId={params?.outputProductId} onClose={() => go(open ? { open } : {})} onSaved={(id) => go({ open: id })} />
        : open && <RecipeView id={open} onClose={() => go({})} onEdit={(r) => go({ edit: r.id, open: r.id })} />} />
  );
}

function RecipeView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (r: any) => void }) {
  const q = useQuery<any>('Recipe.Get', { params: { recipeId: id } });
  const [ver, setVer] = useState<string>('');
  useEffect(() => setVer(''), [id]);
  const r = q.data?.id === id ? q.data : null;
  const c = useQuery<any>('Recipe.Cost', { params: { recipeId: id }, query: { versionId: ver || undefined } });
  const cost = c.data;
  return (
    <DetailPane fb="recipe-detail" onClose={onClose} backLabel={t('الوصفات والتكلفة')} icon={<CookingPot />} title={r ? L(r.name) : t('وصفة')}
      badge={r ? <><Pill tone={r.outputKind === 'MENU' ? 'primary' : r.outputKind === 'PREP' ? 'violet' : 'neutral'}>{r.outputKind === 'MENU' ? t('صنف منيو') : r.outputKind === 'PREP' ? t('تحضيرة') : t('إضافة')}</Pill><StateBadge ops={OPS} /></> : undefined}
      footer={r && <Button variant="primary" data-fb="recipe:edit" onClick={() => onEdit(r)}><Pencil className="w-4 h-4" />{t('تعديل الوصفة')}</Button>}>
      {!r || !cost ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
            <Box l={r.outputKind === 'PREP' ? t('تكلفة الدفعة') : t('تكلفة الطبق')} v={<Money v={cost.total} />} />
            {r.outputKind === 'PREP' && <Box l={t('تكلفة الوحدة')} v={<span className="num">{money(cost.perUnit)} / {unitLabel(r.outputUnit)}</span>} />}
            {r.outputKind === 'PREP' && <Box l={t('الدفعة بتطلع')} v={<span className="num">{fmtQty(cost.outputQuantity)} {unitLabel(r.outputUnit)}</span>} />}
            {r.outputKind === 'MENU' && cost.prices.map((p: any) => <Box key={p.channel} l={t('نسبة التكلفة — {c} ({p})', { c: t(CH[p.channel] ?? p.channel), p: money(p.net) })} v={<Pct v={p.foodCostPercent} band={p.band} />} />)}
          </div>
          {r.outputKind === 'MENU' && cost.band === 'HIGH' && <Banner tone="error">{t('التكلفة عالية: كل 100 جنيه بيع منهم {p} جنيه خامات. راجع البورشن أو السعر.', { p: cost.foodCostPercent })}</Banner>}
          <div className="flex items-center gap-2"><span className="text-xs text-soft">{t('النسخة')}</span><Sel className="w-64" value={ver} onChange={(e) => setVer(e.target.value)} options={[{ value: '', label: t('الشغالة دلوقتي (نسخة {n})', { n: r.activeVersion.version }) }, ...r.versions.map((v: any) => ({ value: v.id, label: `${t('نسخة {n}', { n: v.version })} — ${dateTime(v.effectiveFrom)}` }))]} /></div>
          <Table head={[t('المكوّن'), t('الكمية'), t('هالك التحضير'), t('الكمية الفعلية'), t('سعر الوحدة'), t('التكلفة'), t('من التكلفة')]} rows={cost.lines.map((l: any) => [
            <span className="font-bold">{L(l.name)}</span>,
            <span className="num whitespace-nowrap">{fmtQty(l.enteredQuantity)} {unitIdLabel(l.enteredUnit)}</span>,
            Number(l.wastePercent) > 0 ? <span className="num">{l.wastePercent}%</span> : <span className="text-dim">—</span>,
            <span className="num text-xs whitespace-nowrap">{fmtQty(l.grossQuantity, 4)} {unitIdLabel(l.stockUnitId)}</span>,
            <span className="num text-xs whitespace-nowrap">{money(l.unitCost)}</span>,
            <Money v={l.cost} className="text-sm" />,
            <Share part={l.cost} total={cost.total} />,
          ])} />
          <div>
            <div className="text-xs font-bold text-soft mb-1 flex items-center gap-1"><History className="w-3.5 h-3.5" />{t('النسخ')}</div>
            <ol className="space-y-1 border-s-2 line ps-3 text-xs">{[...r.versions].reverse().map((v: any) => (
              <li key={v.id}><b>{t('نسخة {n}', { n: v.version })}</b> · {t('تبدأ')} {dateTime(v.effectiveFrom)} · {personText(v.createdByName)} · <span className="num">{money(v.cost)}</span>{v.id === r.activeVersionId && <Pill tone="success" className="ms-1">{t('الشغالة')}</Pill>}{tv(v.note) && <div className="text-dim">{tv(v.note)}</div>}</li>
            ))}</ol>
          </div>
          <Tech><div className="text-[11px] num text-dim">{r.id} · {r.outputProductId} · method {cost.method}</div></Tech>
        </div>
      )}
    </DetailPane>
  );
}
/** One ingredient's share of the cost (display only, Decimal). */
function Share({ part, total }: { part: string; total: string }) {
  const tot = D(total);
  const pct = tot.gt(0) ? D(part).div(tot).times(100) : D(0);
  return <div className="flex items-center gap-1.5 min-w-[90px]"><div className="flex-1 h-1.5 rounded-full surface-2 overflow-hidden"><div className="h-full bg-[var(--primary)]" style={{ width: `${pct.toDecimalPlaces(2).toString()}%` }} /></div><span className="num text-[11px]">{pct.toFixed(0)}%</span></div>;
}
function Box({ l, v }: { l: React.ReactNode; v: React.ReactNode }) { return <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim">{l}</div><div className="font-bold mt-0.5">{v}</div></div>; }

/** The editor as a full page: loads the recipe when editing (params.edit = id), or starts a new one ('new'). */
function RecipeEditorPage({ editId, kind, outputProductId, onClose, onSaved }: { editId: string; kind?: string; outputProductId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const isNew = editId === 'new';
  const q = useQuery<any>(isNew ? null : 'Recipe.Get', { params: { recipeId: editId } });
  if (!isNew && q.data?.id !== editId) return <DetailPane fb="recipe-editor" onClose={onClose} title={t('تعديل وصفة')} escape={false}><Spinner /></DetailPane>;
  return <RecipeEditor init={isNew ? { kind: kind ?? 'MENU', outputProductId } : { recipe: q.data, kind: q.data.outputKind }} onClose={onClose} onSaved={onSaved} />;
}

interface Line { itemId: string; quantity: string; unit: string; wastePercent: string }
/** Estimated cost of one line at today's average cost (display only, Decimal). */
const lineCost = (l: Line, it: any) => {
  if (!it || !/^\d+(\.\d+)?$/.test(l.quantity) || !D(l.quantity).gt(0)) return null;
  const f = unitOptions(it).find((o) => o.value === l.unit)?.factor ?? 1;
  const waste = /^\d+(\.\d+)?$/.test(l.wastePercent) ? D(l.wastePercent) : D(0);
  return D(l.quantity).times(D(f)).times(D(1).plus(waste.div(100))).times(D(it.avgCost));
};
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
  const snapshot = JSON.stringify({ output, option, outQty, lines, when, note });
  const initial = useRef(snapshot);
  const dirty = snapshot !== initial.current;
  const options = groups.items.flatMap((g: any) => g.options.map((o: any) => ({ ...o, group: g.name })));
  const prepItems = items.items.filter((i) => i.kind === 'PREP');
  const estimate = lines.reduce((a, l) => a.plus(lineCost(l, items.items.find((i) => i.id === l.itemId)) ?? 0), D(0));
  const save = async () => {
    const id = r?.id ?? newKey('rcp');
    const body: any = { outputQuantityPerBatch: kind === 'PREP' ? outQty : '1', inputsPerBatch: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit || undefined, wastePercent: l.wastePercent || '0' })), note: note || undefined, effectiveFrom: when ? new Date(when).toISOString() : undefined };
    if (kind === 'MODIFIER') { body.modifierOptionId = option; body.appliesToProductId = output || undefined; body.outputProductId = output || option; } else body.outputProductId = output;
    const res = await run<any>('Recipe.Define', { params: { recipeId: id }, body }, { success: r ? t('اتعملت نسخة جديدة من الوصفة') : t('الوصفة اتحفظت') });
    if (res) { initial.current = snapshot; onSaved(res.id); }
  };
  const leave = async () => { if (!dirty || (await confirmDialog(t('تجاهل التعديلات غير المحفوظة؟'), { danger: true, confirmLabel: t('تجاهل التعديلات'), cancelLabel: t('متابعة التعديل') }))) onClose(); };
  const valid = (kind === 'MODIFIER' ? !!option : !!output) && lines.some((l) => l.itemId && Number(l.quantity) > 0) && (kind !== 'PREP' || Number(outQty) > 0);
  const outUnit = unitLabel(items.items.find((i) => i.id === output)?.unit);
  return (
    <DetailPane fb="recipe-editor" onClose={leave} escape={false} backLabel={t('الوصفات والتكلفة')} icon={<CookingPot />} title={r ? t('تعديل وصفة — {n}', { n: L(r.name) }) : t('وصفة جديدة')} badge={<StateBadge ops={['Recipe.Define']} />}
      footer={<>
        <span className="me-auto text-sm">{t('التكلفة التقريبية')}: <b className="num" data-fb="recipe-edit:estimate">{money(estimate.toFixed(4))}</b>{kind === 'PREP' && Number(outQty) > 0 && <span className="text-dim"> · {money(estimate.div(D(outQty)).toFixed(4))} / {outUnit}</span>}</span>
        <Button variant="ghost" onClick={leave}>{t('إلغاء')}</Button>
        <Button variant="primary" data-fb="recipe-edit:save" loading={busy} disabled={!valid} onClick={save}><Save className="w-4 h-4" />{r ? t('حفظ نسخة جديدة') : t('حفظ الوصفة')}</Button>
      </>}>
      <div className="space-y-4 max-w-[1100px]">
        <div className="grid grid-cols-1 @xl/detail:grid-cols-3 gap-3">
          {kind === 'MENU' && <Field label={t('صنف المنيو')} required><Select data-fb="recipe-edit:product" disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('اختار') }, ...products.items.map((p) => ({ value: p.id, label: L(p.name) }))]} /></Field>}
          {kind === 'PREP' && <>
            <Field label={t('التحضيرة (صنف مخزن)')} required><Select data-fb="recipe-edit:prep" disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('اختار') }, ...prepItems.map((i) => ({ value: i.id, label: L(i.name) }))]} /></Field>
            <Field label={t('الدفعة بتطلع كام')} required hint={outUnit}><Input data-fb="recipe-edit:out-qty" inputMode="decimal" value={outQty} onChange={(e) => setOutQty(e.target.value)} /></Field>
          </>}
          {kind === 'MODIFIER' && <>
            <Field label={t('الإضافة / الحجم')} required><Select data-fb="recipe-edit:option" disabled={!!r} value={option} onChange={(e) => setOption(e.target.value)} options={[{ value: '', label: t('اختار') }, ...options.map((o: any) => ({ value: o.id, label: `${L(o.group)}: ${L(o.name)}` }))]} /></Field>
            <Field label={t('على صنف معين؟')}><Select disabled={!!r} value={output} onChange={(e) => setOutput(e.target.value)} options={[{ value: '', label: t('أي صنف') }, ...products.items.map((p) => ({ value: p.id, label: L(p.name) }))]} /></Field>
          </>}
          <Field label={t('تبدأ من')}><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        <Table head={[t('المكوّن'), t('الكمية'), t('الوحدة'), t('هالك التحضير %'), t('تكلفة تقريبية'), '']} align={['start', 'start', 'start', 'start', 'end', 'end']} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const opts = unitOptions(it);
          const c = lineCost(l, it);
          return [
            <ItemPicker fb={`recipe-edit:item:${i}`} className="min-w-[200px]" items={items.items.filter((x) => x.id !== output)} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: id, unit: item.unit === 'KG' ? 'unit_g' : item.unit === 'L' ? 'unit_ml' : item.stockUnitId } : x)))} />,
            <Inp data-fb={`recipe-edit:qty:${i}`} className="w-24" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x)))} />,
            opts.length ? <Sel className="w-32" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} options={opts.map((o) => ({ value: o.value, label: o.label }))} /> : '—',
            <Inp className="w-20" inputMode="decimal" value={l.wastePercent} placeholder="0" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, wastePercent: e.target.value.replace(/[^\d.]/g, '') } : x)))} />,
            c !== null ? <span className="num text-xs">{money(c.toFixed(4))}</span> : '—',
            <Button size="sm" variant="ghost" title={t('حذف المكوّن')} onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        <Button size="sm" data-fb="recipe-edit:add" onClick={() => setLines([...lines, { itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Plus className="w-3.5 h-3.5" />{t('إضافة مكوّن')}</Button>
        <Field label={t('ملاحظة على النسخة')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </DetailPane>
  );
}
