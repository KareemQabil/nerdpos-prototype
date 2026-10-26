// B1 Menu admin: products (sizes, combos, half-and-half, pictures), categories, units, modifier groups (required/optional,
// defaults, order, sub-choices, ingredients no/less/extra, sold out today), menus & dayparts, and the "sold out today" board.
import React, { useState } from 'react';
import { Plus, Pencil, Search, Image as ImageIcon, Save, ArrowUp, ArrowDown, Star, CircleSlash, RotateCcw, Layers, Pizza, Ruler } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Money, Pill, Section, Select, StateBadge, Switch, Table, Tabs } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { LocInputs, PolicyChip, Radio, Swatch, allergenLabel, availabilityLabel, availabilityTone, useItems, usePolicy } from './catalog/common';
import { ProductCreate, ProductDrawer, type DrawerTab } from './catalog/ProductEditor';
import { MenusAdmin } from '../menu/MenusAdmin';
import { SoldOutBoard } from '../menu/SoldOutBoard';

type Tab = 'products' | 'categories' | 'units' | 'modifiers' | 'menus' | 'soldout';
const OPS = ['Category.Create', 'Category.Configure', 'Unit.Create', 'Unit.Configure', 'Product.Create', 'Product.Configure', 'Product.NameCheck', 'Product.SetModifierGroups', 'Product.SetTaxPolicy', 'Product.SetAvailability', 'ModifierGroup.Create', 'ModifierGroup.Configure', 'ModifierOption.Create', 'ModifierOption.Configure', 'Variant.Upsert', 'Product.SetCombo', 'Menu.Upsert'];

export default function Menu() {
  const [tab, setTab] = useState<Tab>('products');
  const sku = usePolicy<any>('SkuGenerationPolicy');
  const names = usePolicy<any>('ProductNameUniquenessPolicy');
  const reasons = usePolicy<Record<string, string>>('AvailabilityReasonPolicy');
  const nap = usePolicy<string>('NewProductAvailabilityPolicy');
  return (
    <div>
      <Section title={t('المنيو')} badge={<StateBadge ops={OPS} />} sub={t('الأصناف بأحجامها ووجباتها والنص ونص، الإضافات، المنيوهات ومواعيدها، واللي خلص النهارده')} />
      <Tech>
        <div className="flex flex-wrap gap-1.5 mb-3" data-fb="menu:policies">
          <PolicyChip id="SkuGenerationPolicy" value={sku?.mode ?? '…'} />
          <PolicyChip id="ProductNameUniquenessPolicy" value={names?.default ?? '…'} />
          <PolicyChip id="AvailabilityReasonPolicy" value={reasons ? `SOLD_OUT ${reasons.SOLD_OUT} · BLOCKED ${reasons.BLOCKED}` : '…'} />
          <PolicyChip id="NewProductAvailabilityPolicy" value={nap ?? '…'} />
        </div>
      </Tech>
      <Banner tone="info">{t('تعديلات المنيو والأسعار والضرايب بتسري على الطلبات الجديدة بس؛ السطور اللي اتسجلت في الشيكات بتفضل بسعرها وضريبتها وإضافاتها.')}</Banner>
      <Tabs<Tab> className="my-4" value={tab} onChange={setTab} tabs={[
        { id: 'products', label: t('الأصناف') }, { id: 'categories', label: t('الأقسام') }, { id: 'modifiers', label: t('الإضافات') },
        { id: 'menus', label: t('المنيوهات والمواعيد') }, { id: 'soldout', label: t('خلص النهارده') }, { id: 'units', label: t('الوحدات') },
      ]} />
      {tab === 'products' && <Products />}
      {tab === 'categories' && <Categories />}
      {tab === 'units' && <Units />}
      {tab === 'modifiers' && <Modifiers />}
      {tab === 'menus' && <MenusAdmin />}
      {tab === 'soldout' && <SoldOutBoard />}
    </div>
  );
}

// ───────── products
function Products() {
  const [cat, setCat] = useState('');
  const [active, setActive] = useState<'all' | 'true' | 'false'>('true');
  const [qText, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; tab?: DrawerTab } | null>(null);
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const list = useItems<any>('Catalog.Search', { query: { categoryId: cat || undefined, active: active === 'all' ? undefined : active, q: qText.trim() || undefined } });
  const catName = (id: string) => L(cats.items.find((c) => c.id === id)?.name) || id;
  const unitCode = (id: string) => units.items.find((u) => u.id === id)?.code ?? id;
  const shown = list.items;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('بحث')} className="w-64"><div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="products:search" style={{ paddingInlineStart: 36 }} value={qText} onChange={(e) => setQ(e.target.value)} placeholder={t('اسم، كود أو باركود')} /></div></Field>
        <Field label={t('القسم')} className="w-52"><Select data-fb="products:category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل الأقسام') }, ...cats.items.map((c) => ({ value: c.id, label: L(c.name) }))]} /></Field>
        <Field label={t('الحالة')} className="w-40"><Select data-fb="products:active" value={active} onChange={(e) => setActive(e.target.value as any)} options={[{ value: 'true', label: t('الشغالة') }, { value: 'false', label: t('المؤرشفة') }, { value: 'all', label: t('الكل') }]} /></Field>
        <div className="flex-1" />
        <Button data-fb="products:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('صنف جديد')}</Button>
      </div>
      <div className="text-[11px] text-dim">{t('{n} صنف', { n: shown.length })}</div>
      <Table head={['', t('الصنف'), t('الكود'), t('القسم'), t('الوحدة'), t('الضريبة'), t('الإضافات'), t('في الفرع'), '']} rows={shown.map((p) => [
        p.imageUrl ? <img src={p.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover" /> : <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: (p.colorCode ?? '#64748b') + '33' }}><ImageIcon className="w-4 h-4 text-dim" /></span>,
        <div className="min-w-[180px]">
          <div className="font-bold flex items-center gap-1.5 flex-wrap"><Swatch color={p.colorCode} className="w-3 h-3" />{L(p.name)} {!p.active && <Pill tone="neutral">{t('مؤرشف')}</Pill>} {p.direction && <StateBadge state="PROPOSED" />}</div>
          <div className="text-xs text-dim" dir="ltr" style={{ textAlign: 'start' }}>{p.name.en}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {p.variants?.filter((v: any) => v.active).length > 0 && <button onClick={() => setOpen({ id: p.id, tab: 'sizes' })}><Pill tone="violet"><Ruler className="w-3 h-3" />{t('{n} أحجام', { n: p.variants.filter((v: any) => v.active).length })}</Pill></button>}
            {p.halfAndHalf && <button onClick={() => setOpen({ id: p.id, tab: 'half' })}><Pill tone="violet"><Pizza className="w-3 h-3" />{t('نص ونص')}</Pill></button>}
            {p.combo?.length > 0 && <button onClick={() => setOpen({ id: p.id, tab: 'combo' })}><Pill tone="info"><Layers className="w-3 h-3" />{t('وجبة · {n} اختيارات', { n: p.combo.length })}</Pill></button>}
            {(p.chargeTags ?? []).includes('TABLE_TAX') && <Pill tone="violet">{t('ضريبة جدول')}</Pill>}
            {p.calories != null && <Pill tone="neutral">{p.calories} {t('سعر حراري')}</Pill>}
            {(p.allergens ?? []).map((a: string) => <Pill key={a} tone="warning">{allergenLabel(a)}</Pill>)}
          </div>
        </div>,
        <span className="num text-xs">{p.sku}</span>,
        catName(p.categoryId),
        <span className="num text-xs">{unitCode(p.unitId)}</span>,
        p.taxPolicyName ? <span className="text-xs">{L(p.taxPolicyName)}</span> : <Pill tone="error">{t('مفيش')}</Pill>,
        <span className="num">{p.modifierGroupIds.length}</span>,
        <button data-fb={`products:availability:${p.id}`} onClick={() => setOpen({ id: p.id, tab: 'availability' })} className="text-start">
          <Pill tone={availabilityTone(p.availability.state)}>{availabilityLabel(p.availability.state)}{p.availability.soldOutFor ? ' · ' + t('النهارده') : ''}</Pill>
          {p.availability.reason && <div className="text-[11px] text-dim mt-0.5 max-w-[140px] truncate" title={p.availability.reason}>{p.availability.reason}</div>}
        </button>,
        <Button size="sm" data-fb={`products:open:${p.id}`} onClick={() => setOpen({ id: p.id })}><Pencil className="w-3.5 h-3.5" />{t('فتح')}</Button>,
      ])} />
      <ProductCreate open={creating} onClose={() => setCreating(false)} onCreated={(id, tab) => { setCreating(false); setOpen({ id, tab }); }} />
      <ProductDrawer productId={open?.id ?? null} initialTab={open?.tab ?? 'data'} onClose={() => setOpen(null)} />
    </div>
  );
}

// ───────── categories
function Categories() {
  const { run, busy } = useCommand();
  const cats = useItems<any>('Category.List');
  const [name, setName] = useState({ ar: '', en: '' });
  const [color, setColor] = useState('#22d3ee');
  const [edit, setEdit] = useState<any | null>(null);
  const create = async () => {
    const r = await run('Category.Create', { body: { name, colorCode: color } }, { success: t('القسم اتعمل') });
    if (r) setName({ ar: '', en: '' });
  };
  const configure = (c: any, patch: { name?: any; active?: boolean; sortOrder?: number }) => run('Category.Configure', { params: { categoryId: c.id }, body: { name: patch.name ?? c.name, active: patch.active ?? c.active, sortOrder: patch.sortOrder ?? c.sortOrder, expectedVersion: c.version } }, { success: t('القسم اتحدث') });
  const sorted = [...cats.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const move = async (i: number, d: number) => { const a = sorted[i], b = sorted[i + d]; if (!a || !b) return; if (await configure(a, { sortOrder: b.sortOrder })) await configure({ ...b }, { sortOrder: a.sortOrder }); };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-2">
        <Banner tone="warning">{t('إخفاء قسم بيشيل كل أصنافه من المنيو مرة واحدة.')}</Banner>
        <Table head={['', t('القسم'), t('اللون'), t('ظاهر'), '']} rows={sorted.map((c, i) => [
          <div className="flex flex-col"><button className="disabled:opacity-20" disabled={i === 0 || busy} onClick={() => move(i, -1)}><ArrowUp className="w-3.5 h-3.5" /></button><button className="disabled:opacity-20" disabled={i === sorted.length - 1 || busy} onClick={() => move(i, 1)}><ArrowDown className="w-3.5 h-3.5" /></button></div>,
          <div><div className="font-bold">{L(c.name)}</div><div className="text-xs text-dim" dir="ltr" style={{ textAlign: 'start' }}>{c.name.en}</div></div>,
          <Swatch color={c.colorCode} />,
          <Switch checked={c.active} onChange={(v) => configure(c, { active: v })} label={c.active ? t('ظاهر') : t('مخفي')} />,
          <Button size="sm" data-fb={`category:rename:${c.id}`} onClick={() => setEdit({ ...c, nameDraft: c.name })}><Pencil className="w-3.5 h-3.5" />{t('تغيير الاسم')}</Button>,
        ])} />
      </div>
      <Card title={t('قسم جديد')} badge={<StateBadge ops={['Category.Create']} />}>
        <div className="space-y-3">
          <LocInputs value={name} onChange={setName} fb="category-create" />
          <Field label={t('اللون')}>
            <div className="flex gap-2"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={color} onChange={(e) => setColor(e.target.value)} dir="ltr" /></div>
          </Field>
          <Button data-fb="category-create:submit" variant="primary" loading={busy} onClick={create} className="w-full"><Plus className="w-4 h-4" />{t('ضيف القسم')}</Button>
        </div>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('تغيير اسم القسم')} badge={<StateBadge ops={['Category.Configure']} />}
        footer={<><Button onClick={() => setEdit(null)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} data-fb="category-rename:save" onClick={async () => { if (await configure(edit, { name: edit.nameDraft })) setEdit(null); }}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {edit && <LocInputs value={edit.nameDraft} onChange={(v) => setEdit({ ...edit, nameDraft: v })} fb="category-rename" />}
      </Modal>
    </div>
  );
}

// ───────── units
function Units() {
  const { run, busy } = useCommand();
  const units = useItems<any>('Unit.List');
  const [code, setCode] = useState('');
  const [precision, setPrecision] = useState('0');
  const [edit, setEdit] = useState<any | null>(null);
  const create = async () => {
    const r = await run('Unit.Create', { body: { code: code.trim(), precision: Number(precision) } }, { success: t('الوحدة اتعملت') });
    if (r) { setCode(''); setPrecision('0'); }
  };
  const save = async () => {
    const r = await run('Unit.Configure', { params: { unitId: edit.id }, body: { code: edit.codeDraft, precision: Number(edit.precisionDraft), expectedVersion: edit.version } }, { success: t('الوحدة اتحدثت') });
    if (r) setEdit(null);
  };
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <Table head={[t('الكود'), t('الخانات العشرية'), t('مستخدمة'), '']} rows={units.items.map((u) => [
        <span className="num font-bold">{u.code}</span>,
        <span className="num">{u.precision}</span>,
        u.used ? <Pill tone="warning" title={t('الدقة اتقفلت لأن فيه أصناف عليها')}>{t('مستخدمة — الدقة مقفولة')}</Pill> : <Pill tone="neutral">{t('لسه')}</Pill>,
        <Button size="sm" data-fb={`unit:edit:${u.id}`} onClick={() => setEdit({ ...u, codeDraft: u.code, precisionDraft: String(u.precision) })}><Pencil className="w-3.5 h-3.5" />{t('تعديل')}</Button>,
      ])} />
      <Card title={t('وحدة جديدة')} badge={<StateBadge ops={['Unit.Create']} />}>
        <div className="space-y-3">
          <Field label={t('الكود')} hint={t('مثلاً PCS أو KG — فريد')}><Input data-fb="unit-create:code" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" /></Field>
          <Field label={t('الخانات العشرية للكمية')} hint={t('0 للقطعة، 3 للكيلو (وزن)')}><Input data-fb="unit-create:precision" type="number" min={0} max={6} value={precision} onChange={(e) => setPrecision(e.target.value)} /></Field>
          <Button data-fb="unit-create:submit" variant="primary" loading={busy} onClick={create} className="w-full"><Plus className="w-4 h-4" />{t('ضيف الوحدة')}</Button>
        </div>
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('تعديل الوحدة')} badge={<StateBadge ops={['Unit.Configure']} />}
        footer={<><Button onClick={() => setEdit(null)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} data-fb="unit-edit:save" onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {edit && (
          <div className="space-y-3">
            <Field label={t('الكود')}><Input value={edit.codeDraft} onChange={(e) => setEdit({ ...edit, codeDraft: e.target.value })} dir="ltr" /></Field>
            <Field label={t('الخانات العشرية')}><Input data-fb="unit-edit:precision" type="number" min={0} max={6} value={edit.precisionDraft} onChange={(e) => setEdit({ ...edit, precisionDraft: e.target.value })} /></Field>
            {edit.used && <Banner tone="warning">{t('الوحدة دي عليها أصناف: الدقة مش هتتغير.')}</Banner>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ───────── modifier groups and options
interface GroupDraft { name: { ar: string; en: string }; selectionRule: 'SINGLE' | 'MULTIPLE'; min: string; max: string; kind: 'STANDARD' | 'INGREDIENTS'; scalesWithSize: boolean; allowHalfPlacement: boolean }
const EMPTY_GROUP: GroupDraft = { name: { ar: '', en: '' }, selectionRule: 'SINGLE', min: '0', max: '1', kind: 'STANDARD', scalesWithSize: true, allowHalfPlacement: false };

function Modifiers() {
  const { run, busy } = useCommand();
  const groups = useItems<any>('ModifierGroup.List');
  const [draft, setDraft] = useState<GroupDraft>(EMPTY_GROUP);
  const [editGroup, setEditGroup] = useState<any | null>(null);
  const create = async () => {
    const r = await run('ModifierGroup.Create', { body: { name: draft.name, selectionRule: draft.kind === 'INGREDIENTS' ? 'MULTIPLE' : draft.selectionRule, min: draft.kind === 'INGREDIENTS' ? 0 : Number(draft.min), max: Math.max(1, Number(draft.max)), kind: draft.kind, scalesWithSize: draft.scalesWithSize, allowHalfPlacement: draft.allowHalfPlacement } }, { success: t('المجموعة اتعملت') });
    if (r) setDraft(EMPTY_GROUP);
  };
  const configure = (g: any, patch: any) => run('ModifierGroup.Configure', { params: { groupId: g.id }, body: { name: g.name, selectionRule: g.selectionRule, min: g.min, max: g.max, active: g.active, ...patch, expectedVersion: g.version } }, { success: t('المجموعة اتحدثت') });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4">
      <div className="space-y-3">
        {groups.items.map((g) => <GroupCard key={g.id} g={g} all={groups.items} onToggle={(v) => configure(g, { active: v })} onEdit={() => setEditGroup({ ...g, draft: { name: g.name, selectionRule: g.selectionRule, min: String(g.min), max: String(g.max), kind: g.kind ?? 'STANDARD', scalesWithSize: g.scalesWithSize !== false, allowHalfPlacement: !!g.allowHalfPlacement } })} />)}
      </div>
      <Card title={t('مجموعة إضافات جديدة')} badge={<StateBadge ops={['ModifierGroup.Create']} />}>
        <GroupForm draft={draft} setDraft={setDraft} fb="group-create" />
        <Button data-fb="group-create:submit" variant="primary" loading={busy} onClick={create} className="w-full mt-3"><Plus className="w-4 h-4" />{t('ضيف المجموعة')}</Button>
      </Card>
      <Modal open={!!editGroup} onClose={() => setEditGroup(null)} title={t('تعديل المجموعة')} badge={<StateBadge ops={['ModifierGroup.Configure']} />}
        footer={<><Button onClick={() => setEditGroup(null)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} data-fb="group-edit:save" onClick={async () => { const d: GroupDraft = editGroup.draft; if (await configure(editGroup, { name: d.name, selectionRule: d.selectionRule, min: d.kind === 'INGREDIENTS' ? 0 : Number(d.min), max: Number(d.max), kind: d.kind, scalesWithSize: d.scalesWithSize, allowHalfPlacement: d.allowHalfPlacement })) setEditGroup(null); }}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {editGroup && <GroupForm draft={editGroup.draft} setDraft={(d) => setEditGroup({ ...editGroup, draft: d })} fb="group-edit" />}
      </Modal>
    </div>
  );
}

function GroupForm({ draft, setDraft, fb }: { draft: GroupDraft; setDraft: (d: GroupDraft) => void; fb: string }) {
  const ing = draft.kind === 'INGREDIENTS';
  return (
    <div className="space-y-3">
      <LocInputs value={draft.name} onChange={(name) => setDraft({ ...draft, name })} fb={fb} />
      <Field label={t('نوع المجموعة')}>
        <Radio<'STANDARD' | 'INGREDIENTS'> fb={`${fb}:kind`} value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} options={[{ value: 'STANDARD', label: t('اختيارات (حجم، صوص، إضافات)') }, { value: 'INGREDIENTS', label: t('مكونات: بدون / خفيف / زيادة') }]} />
      </Field>
      {ing ? (
        <div className="text-[11px] text-dim">{t('كل مكوّن بيبقى "عادي" لوحده، والكاشير يقدر يخليه بدون أو خفيف (ملاحظة للمطبخ ببلاش) أو زيادة (بسعر الزيادة لو فيه).')}</div>
      ) : (
        <>
          <Field label={t('عدد الاختيارات')}>
            <Radio<'SINGLE' | 'MULTIPLE'> fb={`${fb}:rule`} value={draft.selectionRule} onChange={(v) => setDraft({ ...draft, selectionRule: v, max: v === 'SINGLE' ? '1' : draft.max })} options={[{ value: 'SINGLE', label: t('اختيار واحد') }, { value: 'MULTIPLE', label: t('أكتر من اختيار') }]} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('أقل عدد')} hint={t('0 = اختياري، 1 = إجباري')}><Input data-fb={`${fb}:min`} type="number" min={0} value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} /></Field>
            <Field label={t('أكتر عدد')}><Input data-fb={`${fb}:max`} type="number" min={1} value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} disabled={draft.selectionRule === 'SINGLE'} /></Field>
          </div>
        </>
      )}
      <Switch checked={draft.scalesWithSize} onChange={(v) => setDraft({ ...draft, scalesWithSize: v })} label={t('السعر بيتغير مع حجم الصنف (مثلاً الكبير ×1.5)')} />
      {!ing && <Switch checked={draft.allowHalfPlacement} onChange={(v) => setDraft({ ...draft, allowHalfPlacement: v })} label={t('في البيتزا نص ونص: الإضافة ممكن على نص واحد (بنص السعر)')} />}
    </div>
  );
}

function GroupCard({ g, all, onToggle, onEdit }: { g: any; all: any[]; onToggle: (v: boolean) => void; onEdit: () => void }) {
  const { run, busy } = useCommand();
  const ing = g.kind === 'INGREDIENTS';
  const [opt, setOpt] = useState({ name: { ar: '', en: '' }, priceDelta: '0' });
  const addOption = async () => {
    const r = await run('ModifierOption.Create', { params: { groupId: g.id }, body: { name: opt.name, priceDelta: ing ? '0' : opt.priceDelta.trim() || '0', extraPriceDelta: ing && opt.priceDelta.trim() && opt.priceDelta.trim() !== '0' ? opt.priceDelta.trim() : undefined } }, { success: t('الاختيار اتضاف') });
    if (r) setOpt({ name: { ar: '', en: '' }, priceDelta: '0' });
  };
  const setOption = (o: any, patch: any) => run('ModifierOption.Configure', { params: { groupId: g.id, optionId: o.id }, body: { name: o.name, priceDelta: o.priceDelta, active: o.active, ...patch, expectedVersion: o.version } }, { success: t('الاختيار اتحدث — للطلبات الجديدة بس') });
  const soldOut = (o: any, v: boolean) => run('ModifierOption.SetAvailability', { params: { groupId: g.id, optionId: o.id }, body: { state: v ? 'SOLD_OUT' : 'AVAILABLE', reason: v ? t('خلص النهارده') : undefined } }, { success: v ? t('{n} خلصت النهارده', { n: L(o.name) }) : t('{n} رجعت', { n: L(o.name) }) });
  const reorder = (i: number, d: number) => { const ids = g.options.map((o: any) => o.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; run('ModifierGroup.ReorderOptions', { params: { groupId: g.id }, body: { optionIds: ids, expectedVersion: g.version } }); };
  const [editOpt, setEditOpt] = useState<any | null>(null);
  const nestedName = (id?: string | null) => (id ? L(all.find((x) => x.id === id)?.name) : '');
  const rule = ing ? t('مكونات') : `${g.selectionRule === 'SINGLE' || g.max === 1 ? t('اختيار واحد') : t('لحد {n}', { n: g.max })}`;
  return (
    <Card title={<span className="flex items-center gap-2">{L(g.name)} <span className="text-xs text-dim font-normal" dir="ltr">{g.name.en}</span></span>}
      badge={<><Pill tone="primary">{rule}</Pill>{!ing && (g.min > 0 ? <Pill tone="warning">{t('إجباري')}</Pill> : <Pill tone="neutral">{t('اختياري')}</Pill>)}{g.allowHalfPlacement && <Pill tone="violet">{t('على نص')}</Pill>}{g.scalesWithSize === false && <Pill tone="neutral">{t('سعر ثابت مع الحجم')}</Pill>}</>}
      actions={<><Switch checked={g.active} onChange={onToggle} label={g.active ? t('شغالة') : t('موقوفة')} /><Button size="sm" data-fb={`group:edit:${g.id}`} onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></Button></>}>
      <Table head={['', t('الاختيار'), ing ? t('سعر الزيادة') : t('فرق السعر'), t('خلص النهارده'), t('شغال'), '']} rows={g.options.map((o: any, i: number) => [
        <div className="flex flex-col"><button className="disabled:opacity-20" disabled={i === 0 || busy} onClick={() => reorder(i, -1)}><ArrowUp className="w-3 h-3" /></button><button className="disabled:opacity-20" disabled={i === g.options.length - 1 || busy} onClick={() => reorder(i, 1)}><ArrowDown className="w-3 h-3" /></button></div>,
        <div>
          <div className="inline-flex items-center gap-1.5 font-bold">{L(o.name)} {o.isDefault && <Pill tone="primary"><Star className="w-3 h-3" />{t('افتراضي')}</Pill>}</div>
          {o.nestedGroupId && <div className="text-[11px] text-dim">↳ {t('بيسأل')}: {nestedName(o.nestedGroupId)}</div>}
          {o.allergens?.length > 0 && <div className="text-[11px] text-[var(--warning)]">{o.allergens.map(allergenLabel).join('، ')}</div>}
        </div>,
        ing ? <Money v={o.extraPriceDelta ?? o.priceDelta} /> : <Money v={o.priceDelta} tone={Number(o.priceDelta) < 0 ? 'error' : undefined} />,
        <button data-fb={`option:soldout:${o.id}`} disabled={busy} onClick={() => soldOut(o, !o.soldOut)} className="text-start">{o.soldOut ? <Pill tone="error"><CircleSlash className="w-3 h-3" />{t('خلصت')} <RotateCcw className="w-3 h-3" /></Pill> : <Pill tone="neutral">{t('متاحة')}</Pill>}</button>,
        <Switch checked={o.active} onChange={(v) => setOption(o, { active: v })} />,
        <Button size="sm" variant="ghost" data-fb={`option:edit:${o.id}`} onClick={() => setEditOpt({ ...o, d: { name: typeof o.name === 'string' ? { ar: o.name, en: o.name } : o.name, priceDelta: String(Number(o.priceDelta)), extraPriceDelta: o.extraPriceDelta ? String(Number(o.extraPriceDelta)) : '', isDefault: !!o.isDefault, nestedGroupId: o.nestedGroupId ?? '' } })}><Pencil className="w-3.5 h-3.5" /></Button>,
      ])} />
      <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-2 items-end">
        <LocInputs value={opt.name} onChange={(name) => setOpt({ ...opt, name })} fb={`option-create:${g.id}`} labelAr={ing ? t('مكوّن جديد (عربي)') : t('اختيار جديد (عربي)')} labelEn={t('(إنجليزي)')} />
        <Field label={ing ? t('سعر الزيادة') : t('فرق السعر')} hint={ing ? t('0 = الزيادة ببلاش') : t('ممكن بالسالب')}><Input data-fb={`option-create:${g.id}:delta`} inputMode="decimal" value={opt.priceDelta} onChange={(e) => setOpt({ ...opt, priceDelta: e.target.value })} /></Field>
        <Button data-fb={`option-create:${g.id}:submit`} loading={busy} onClick={addOption}><Plus className="w-4 h-4" />{t('ضيف')}</Button>
      </div>
      <Modal open={!!editOpt} onClose={() => setEditOpt(null)} title={t('تعديل الاختيار')} badge={<StateBadge ops={['ModifierOption.Configure']} />}
        footer={<><Button onClick={() => setEditOpt(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="option-edit:save" loading={busy} onClick={async () => { const d = editOpt.d; if (await setOption(editOpt, { name: d.name, priceDelta: d.priceDelta || '0', extraPriceDelta: d.extraPriceDelta, isDefault: d.isDefault, nestedGroupId: d.nestedGroupId })) setEditOpt(null); }}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {editOpt && (
          <div className="space-y-3">
            <LocInputs value={editOpt.d.name} onChange={(name) => setEditOpt({ ...editOpt, d: { ...editOpt.d, name } })} fb="option-edit" />
            <div className="grid grid-cols-2 gap-3">
              {!ing && <Field label={t('فرق السعر')}><Input data-fb="option-edit:delta" inputMode="decimal" value={editOpt.d.priceDelta} onChange={(e) => setEditOpt({ ...editOpt, d: { ...editOpt.d, priceDelta: e.target.value } })} /></Field>}
              {ing && <Field label={t('سعر الزيادة')}><Input data-fb="option-edit:extra" inputMode="decimal" value={editOpt.d.extraPriceDelta} onChange={(e) => setEditOpt({ ...editOpt, d: { ...editOpt.d, extraPriceDelta: e.target.value } })} /></Field>}
              {!ing && <Field label={t('اختيار افتراضي')} hint={t('بيتختار لوحده على الكاشير')}><Switch checked={editOpt.d.isDefault} onChange={(v) => setEditOpt({ ...editOpt, d: { ...editOpt.d, isDefault: v } })} label={editOpt.d.isDefault ? t('أيوه') : t('لأ')} /></Field>}
            </div>
            {!ing && (
              <Field label={t('يسأل كمان (اختيار جوه الاختيار)')} hint={t('مثلاً "جبنة" تسأل نوع الجبنة — مستوى واحد بس')}>
                <Select data-fb="option-edit:nested" value={editOpt.d.nestedGroupId} onChange={(e) => setEditOpt({ ...editOpt, d: { ...editOpt.d, nestedGroupId: e.target.value } })} options={[{ value: '', label: t('لأ') }, ...all.filter((x) => x.id !== g.id && x.kind !== 'INGREDIENTS').map((x) => ({ value: x.id, label: L(x.name) }))]} />
              </Field>
            )}
            <div className="text-[11px] text-dim">{t('المجموعة ثابتة للاختيار. السعر الجديد بيسري على الطلبات الجديدة بس.')}</div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

