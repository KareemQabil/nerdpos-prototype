// B1 Menu admin: categories, units, products (sku auto if empty, name uniqueness, image, colour, tax, modifiers,
// branch availability, direction sizes/combo) and modifier groups with options.
import React, { useMemo, useState } from 'react';
import { Plus, Pencil, Search, Image as ImageIcon, Save } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Card, Field, Input, Modal, Money, Pill, Section, Select, StateBadge, Switch, Table, Tabs } from '../../ui';
import { t, L } from '../../i18n';
import { LocInputs, PolicyChip, Radio, Swatch, allergenLabel, availabilityLabel, availabilityTone, useItems, usePolicy } from './catalog/common';
import { ProductCreate, ProductDrawer } from './catalog/ProductEditor';

type Tab = 'products' | 'categories' | 'units' | 'modifiers';
const OPS = ['Category.Create', 'Category.Configure', 'Unit.Create', 'Unit.Configure', 'Product.Create', 'Product.Configure', 'Product.NameCheck', 'Product.SetModifierGroups', 'Product.SetTaxPolicy', 'Product.SetAvailability', 'ModifierGroup.Create', 'ModifierGroup.Configure', 'ModifierOption.Create', 'ModifierOption.Configure'];

export default function Menu() {
  const [tab, setTab] = useState<Tab>('products');
  const sku = usePolicy<any>('SkuGenerationPolicy');
  const names = usePolicy<any>('ProductNameUniquenessPolicy');
  const reasons = usePolicy<Record<string, string>>('AvailabilityReasonPolicy');
  const nap = usePolicy<string>('NewProductAvailabilityPolicy');
  return (
    <div>
      <Section title={t('المنيو')} badge={<StateBadge ops={OPS} />} sub={t('الأقسام والوحدات والأصناف والإضافات، وتوفر الصنف في الفرع')} />
      <div className="flex flex-wrap gap-1.5 mb-3" data-fb="menu:policies">
        <PolicyChip id="SkuGenerationPolicy" value={sku?.mode ?? '…'} />
        <PolicyChip id="ProductNameUniquenessPolicy" value={names?.default ?? '…'} />
        <PolicyChip id="AvailabilityReasonPolicy" value={reasons ? `SOLD_OUT ${reasons.SOLD_OUT} · BLOCKED ${reasons.BLOCKED}` : '…'} />
        <PolicyChip id="NewProductAvailabilityPolicy" value={nap ?? '…'} />
      </div>
      <Banner tone="info">{t('تعديلات المنيو والأسعار والضرايب بتسري على التسعيرات الجديدة بس؛ السطور المسجلة في الشيكات بتفضل بسعرها وضريبتها وإضافاتها.')}</Banner>
      <Tabs<Tab> className="my-4" value={tab} onChange={setTab} tabs={[
        { id: 'products', label: t('الأصناف') }, { id: 'categories', label: t('الأقسام') }, { id: 'units', label: t('الوحدات') }, { id: 'modifiers', label: t('الإضافات') },
      ]} />
      {tab === 'products' && <Products />}
      {tab === 'categories' && <Categories />}
      {tab === 'units' && <Units />}
      {tab === 'modifiers' && <Modifiers />}
    </div>
  );
}

// ───────── products
function Products() {
  const [cat, setCat] = useState('');
  const [active, setActive] = useState<'all' | 'true' | 'false'>('true');
  const [qText, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<{ id: string; tab?: any } | null>(null);
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const list = useItems<any>('Catalog.Search', { query: { categoryId: cat || undefined, active: active === 'all' ? undefined : active } });
  const catName = (id: string) => L(cats.items.find((c) => c.id === id)?.name) || id;
  const unitCode = (id: string) => units.items.find((u) => u.id === id)?.code ?? id;
  const shown = useMemo(() => {
    const s = qText.trim().toLowerCase();
    return s ? list.items.filter((p) => p.name.ar.includes(s) || p.name.en.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)) : list.items;
  }, [list.items, qText]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('بحث')} className="w-60"><div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input data-fb="products:search" style={{ paddingInlineStart: 36 }} value={qText} onChange={(e) => setQ(e.target.value)} placeholder={t('اسم أو كود')} /></div></Field>
        <Field label={t('القسم')} className="w-52"><Select data-fb="products:category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: t('كل الأقسام') }, ...cats.items.map((c) => ({ value: c.id, label: L(c.name) }))]} /></Field>
        <Field label={t('الحالة')} className="w-40"><Select data-fb="products:active" value={active} onChange={(e) => setActive(e.target.value as any)} options={[{ value: 'true', label: t('النشطة') }, { value: 'false', label: t('المؤرشفة') }, { value: 'all', label: t('الكل') }]} /></Field>
        <div className="flex-1" />
        <Button data-fb="products:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('صنف جديد')}</Button>
      </div>
      <div className="text-[11px] text-dim">{t('البحث بالاسم بيفلتر القايمة على الشاشة بس (Catalog.Search بيفلتر بالقسم)')} · {t('{n} صنف', { n: shown.length })}</div>
      <Table head={['', t('الصنف'), t('الكود'), t('القسم'), t('الوحدة'), t('الضريبة'), t('الإضافات'), t('في الفرع'), '']} rows={shown.map((p) => [
        p.imageUrl ? <img src={p.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover" /> : <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: (p.colorCode ?? '#64748b') + '33' }}><ImageIcon className="w-4 h-4 text-dim" /></span>,
        <div className="min-w-[160px]">
          <div className="font-bold flex items-center gap-1.5 flex-wrap"><Swatch color={p.colorCode} className="w-3 h-3" />{L(p.name)} {!p.active && <Pill tone="neutral">{t('مؤرشف')}</Pill>} {p.direction && <StateBadge state="PROPOSED" />}</div>
          <div className="text-xs text-dim" dir="ltr" style={{ textAlign: 'start' }}>{p.name.en}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {p.variants?.length > 0 && <Pill tone="violet">{t('{n} أحجام', { n: p.variants.length })}</Pill>}
            {p.halfAndHalf && <Pill tone="violet">{t('نص ونص')}</Pill>}
            {p.combo?.length > 0 && <Pill tone="violet">{t('كومبو')}</Pill>}
            {(p.chargeTags ?? []).includes('TABLE_TAX') && <Pill tone="violet">{t('ضريبة جدول')}</Pill>}
            {(p.allergens ?? []).map((a: string) => <Pill key={a} tone="warning">{allergenLabel(a)}</Pill>)}
          </div>
        </div>,
        <span className="num text-xs">{p.sku}</span>,
        catName(p.categoryId),
        <span className="num text-xs">{unitCode(p.unitId)}</span>,
        p.taxPolicyName ? L(p.taxPolicyName) : <Pill tone="error">{t('مفيش')}</Pill>,
        <span className="num">{p.modifierGroupIds.length}</span>,
        <button data-fb={`products:availability:${p.id}`} onClick={() => setOpen({ id: p.id, tab: 'availability' })} className="text-start">
          <Pill tone={availabilityTone(p.availability.state)}>{availabilityLabel(p.availability.state)}</Pill>
          {p.availability.reason && <div className="text-[11px] text-dim mt-0.5 max-w-[140px] truncate" title={p.availability.reason}>{p.availability.reason}</div>}
        </button>,
        <Button size="sm" data-fb={`products:open:${p.id}`} onClick={() => setOpen({ id: p.id })}><Pencil className="w-3.5 h-3.5" />{t('فتح')}</Button>,
      ])} />
      <ProductCreate open={creating} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen({ id }); }} />
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
  const configure = (c: any, patch: { name?: any; active?: boolean }) => run('Category.Configure', { params: { categoryId: c.id }, body: { name: patch.name ?? c.name, active: patch.active ?? c.active, expectedVersion: c.version } }, { success: t('القسم اتحدث') });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-2">
        <Banner tone="warning">{t('إخفاء قسم بيشيل كل أصنافه من المنيو مرة واحدة.')}</Banner>
        <Table head={[t('القسم'), t('اللون'), t('الترتيب'), t('ظاهر'), '']} rows={cats.items.map((c) => [
          <div><div className="font-bold">{L(c.name)}</div><div className="text-xs text-dim" dir="ltr" style={{ textAlign: 'start' }}>{c.name.en}</div></div>,
          <Swatch color={c.colorCode} />,
          <span className="num">{c.sortOrder}</span>,
          <Switch checked={c.active} onChange={(v) => configure(c, { active: v })} label={c.active ? t('ظاهر') : t('مخفي')} />,
          <Button size="sm" data-fb={`category:rename:${c.id}`} onClick={() => setEdit({ ...c, nameDraft: c.name })}><Pencil className="w-3.5 h-3.5" />{t('تغيير الاسم')}</Button>,
        ])} />
      </div>
      <Card title={t('قسم جديد')} badge={<StateBadge ops={['Category.Create']} />}>
        <div className="space-y-3">
          <LocInputs value={name} onChange={setName} fb="category-create" />
          <Field label={<span className="inline-flex items-center gap-1">{t('اللون')} <StateBadge state="PROPOSED" /></span>} hint={t('العقد فيه الاسم بس — اللون اتجاه')}>
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
            {edit.used && <Banner tone="warning">{t('الوحدة دي عليها أصناف: تغيير الدقة هيترفض (UNIT_PRECISION_IMMUTABLE).')}</Banner>}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ───────── modifier groups and options
function Modifiers() {
  const { run, busy } = useCommand();
  const groups = useItems<any>('ModifierGroup.List');
  const [draft, setDraft] = useState({ name: { ar: '', en: '' }, selectionRule: 'SINGLE' as 'SINGLE' | 'MULTIPLE', min: '0', max: '1' });
  const [editGroup, setEditGroup] = useState<any | null>(null);
  const create = async () => {
    const r = await run('ModifierGroup.Create', { body: { name: draft.name, selectionRule: draft.selectionRule, min: Number(draft.min), max: Number(draft.max) } }, { success: t('المجموعة اتعملت') });
    if (r) setDraft({ name: { ar: '', en: '' }, selectionRule: 'SINGLE', min: '0', max: '1' });
  };
  const configure = (g: any, patch: any) => run('ModifierGroup.Configure', { params: { groupId: g.id }, body: { name: g.name, selectionRule: g.selectionRule, min: g.min, max: g.max, active: g.active, ...patch, expectedVersion: g.version } }, { success: t('المجموعة اتحدثت') });
  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-3">
        {groups.items.map((g) => <GroupCard key={g.id} g={g} onToggle={(v) => configure(g, { active: v })} onEdit={() => setEditGroup({ ...g, draft: { name: g.name, selectionRule: g.selectionRule, min: String(g.min), max: String(g.max) } })} />)}
      </div>
      <Card title={t('مجموعة إضافات جديدة')} badge={<StateBadge ops={['ModifierGroup.Create']} />}>
        <GroupForm draft={draft} setDraft={setDraft} fb="group-create" />
        <Button data-fb="group-create:submit" variant="primary" loading={busy} onClick={create} className="w-full mt-3"><Plus className="w-4 h-4" />{t('ضيف المجموعة')}</Button>
      </Card>
      <Modal open={!!editGroup} onClose={() => setEditGroup(null)} title={t('تعديل المجموعة')} badge={<StateBadge ops={['ModifierGroup.Configure']} />}
        footer={<><Button onClick={() => setEditGroup(null)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} data-fb="group-edit:save" onClick={async () => { const d = editGroup.draft; if (await configure(editGroup, { name: d.name, selectionRule: d.selectionRule, min: Number(d.min), max: Number(d.max) })) setEditGroup(null); }}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {editGroup && <GroupForm draft={editGroup.draft} setDraft={(d: any) => setEditGroup({ ...editGroup, draft: d })} fb="group-edit" />}
      </Modal>
    </div>
  );
}

function GroupForm({ draft, setDraft, fb }: { draft: any; setDraft: (d: any) => void; fb: string }) {
  return (
    <div className="space-y-3">
      <LocInputs value={draft.name} onChange={(name) => setDraft({ ...draft, name })} fb={fb} />
      <Field label={t('نوع الاختيار')}>
        <Radio<'SINGLE' | 'MULTIPLE'> fb={`${fb}:rule`} value={draft.selectionRule} onChange={(v) => setDraft({ ...draft, selectionRule: v, max: v === 'SINGLE' ? '1' : draft.max })} options={[{ value: 'SINGLE', label: t('اختيار واحد') }, { value: 'MULTIPLE', label: t('أكتر من اختيار') }]} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('أقل عدد')} hint={t('1 = إجباري')}><Input data-fb={`${fb}:min`} type="number" min={0} value={draft.min} onChange={(e) => setDraft({ ...draft, min: e.target.value })} /></Field>
        <Field label={t('أكتر عدد')} hint={draft.selectionRule === 'SINGLE' ? t('اختيار واحد = 1') : undefined}><Input data-fb={`${fb}:max`} type="number" min={1} value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value })} disabled={draft.selectionRule === 'SINGLE'} /></Field>
      </div>
    </div>
  );
}

function GroupCard({ g, onToggle, onEdit }: { g: any; onToggle: (v: boolean) => void; onEdit: () => void }) {
  const { run, busy } = useCommand();
  const [opt, setOpt] = useState({ name: { ar: '', en: '' }, priceDelta: '0' });
  const addOption = async () => {
    const r = await run('ModifierOption.Create', { params: { groupId: g.id }, body: { name: opt.name, priceDelta: opt.priceDelta.trim() || '0' } }, { success: t('الاختيار اتضاف') });
    if (r) setOpt({ name: { ar: '', en: '' }, priceDelta: '0' });
  };
  const setOption = (o: any, patch: any) => run('ModifierOption.Configure', { params: { groupId: g.id, optionId: o.id }, body: { name: o.name, priceDelta: o.priceDelta, active: o.active, ...patch, expectedVersion: o.version } }, { success: t('الاختيار اتحدث — السعر الجديد للتسعيرات الجديدة بس') });
  const [editOpt, setEditOpt] = useState<any | null>(null);
  return (
    <Card title={<span className="flex items-center gap-2">{L(g.name)} <span className="text-xs text-dim font-normal" dir="ltr">{L({ ar: g.name.en, en: g.name.ar })}</span></span>}
      badge={<><Pill tone="primary">{g.selectionRule === 'SINGLE' ? t('اختيار واحد') : t('أكتر من اختيار')}</Pill><Pill tone="neutral"><span className="num">{g.min}–{g.max}</span></Pill>{g.min > 0 && <Pill tone="warning">{t('إجباري')}</Pill>}</>}
      actions={<><Switch checked={g.active} onChange={onToggle} label={g.active ? t('شغالة') : t('موقوفة')} /><Button size="sm" data-fb={`group:edit:${g.id}`} onClick={onEdit}><Pencil className="w-3.5 h-3.5" /></Button></>}>
      <Table head={[t('الاختيار'), t('فرق السعر'), t('الحالة'), '']} rows={g.options.map((o: any) => [
        L(o.name),
        <Money v={o.priceDelta} tone={Number(o.priceDelta) < 0 ? 'error' : undefined} />,
        <Switch checked={o.active} onChange={(v) => setOption(o, { active: v })} />,
        <Button size="sm" variant="ghost" data-fb={`option:edit:${o.id}`} onClick={() => setEditOpt({ ...o, d: { name: typeof o.name === 'string' ? { ar: o.name, en: o.name } : o.name, priceDelta: String(o.priceDelta) } })}><Pencil className="w-3.5 h-3.5" /></Button>,
      ])} />
      <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_120px_auto] gap-2 items-end">
        <LocInputs value={opt.name} onChange={(name) => setOpt({ ...opt, name })} fb={`option-create:${g.id}`} labelAr={t('اختيار جديد (عربي)')} labelEn={t('(إنجليزي)')} />
        <Field label={t('فرق السعر')} hint={t('ممكن بالسالب')}><Input data-fb={`option-create:${g.id}:delta`} inputMode="decimal" value={opt.priceDelta} onChange={(e) => setOpt({ ...opt, priceDelta: e.target.value })} /></Field>
        <Button data-fb={`option-create:${g.id}:submit`} loading={busy} onClick={addOption}><Plus className="w-4 h-4" />{t('ضيف')}</Button>
      </div>
      <Modal open={!!editOpt} onClose={() => setEditOpt(null)} title={t('تعديل الاختيار')} badge={<StateBadge ops={['ModifierOption.Configure']} />}
        footer={<><Button onClick={() => setEditOpt(null)}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} onClick={async () => { if (await setOption(editOpt, { name: editOpt.d.name, priceDelta: editOpt.d.priceDelta })) setEditOpt(null); }}><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
        {editOpt && (
          <div className="space-y-3">
            <LocInputs value={editOpt.d.name} onChange={(name) => setEditOpt({ ...editOpt, d: { ...editOpt.d, name } })} fb="option-edit" />
            <Field label={t('فرق السعر')}><Input inputMode="decimal" value={editOpt.d.priceDelta} onChange={(e) => setEditOpt({ ...editOpt, d: { ...editOpt.d, priceDelta: e.target.value } })} /></Field>
            <div className="text-[11px] text-dim">{t('المجموعة ثابتة للاختيار. السعر الجديد بيسري على التسعيرات الجديدة بس.')}</div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
