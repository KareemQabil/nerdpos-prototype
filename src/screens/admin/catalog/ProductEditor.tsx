// B1 product create form and product drawer: data (picture, description, calories, allergens), sizes, combo,
// half-and-half, modifier groups, tax and branch availability (incl. "sold out today" and the menus it is on).
import { unitLabel } from '../../inventory/common';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Plus, Save, Pizza, Layers, Ruler, Package, AlertTriangle } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Modal, Drawer, Money, Pill, Select, Spinner, StateBadge, Switch, Textarea, Tabs, toast } from '../../../ui';
import { Tech } from '../../../app/tech';
import { t, L } from '../../../i18n';
import { branchLabel } from '../../../demo/people';
import { dateTime } from '../../../lib/format';
import { ALLERGENS, Check, LocInputs, Radio, Swatch, allergenLabel, availabilityLabel, availabilityTone, channelLabel, useDebounced, useItems, usePolicy } from './common';
import { ImageInput } from '../../menu/parts';
import { VariantsEditor } from './VariantsEditor';
import { ComboEditor } from './ComboEditor';
import { HalfEditor } from './HalfEditor';

type Loc = { ar: string; en: string };

/** Live name check (Product.NameCheck, read-only); the write enforces the name rule itself. */
export function NameCheckHint({ name, excludeProductId }: { name: Loc; excludeProductId?: string }) {
  const d = useDebounced(name, 350);
  const enabled = !!(d.ar.trim() || d.en.trim());
  const opts: any = { body: { name: d, excludeProductId } };
  const q = useQuery<any>(enabled ? 'Product.NameCheck' : null, opts);
  if (!enabled || !q.data) return null;
  if (q.data.available) return <span className="text-[11px] text-[var(--success)] inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />{t('الاسم مش متكرر')}</span>;
  const rule = q.data.rule as string;
  const tone = rule === 'BLOCK' ? 'error' : rule === 'WARN' ? 'warning' : 'info';
  return (
    <Banner tone={tone}>
      {t('فيه صنف تاني بنفس الاسم: {n}', { n: L(q.data.clash?.name) })}
      <div className="text-xs text-dim">{rule === 'BLOCK' ? t('الحفظ هيترفض — غيّر الاسم') : rule === 'WARN' ? t('الحفظ مسموح مع تحذير') : t('مسموح')}</div>
      <Tech><span className="num text-[11px]">ProductNameUniquenessPolicy = {rule}</span></Tech>
    </Banner>
  );
}

function AllergenPicker({ value, onChange, fb }: { value: string[]; onChange: (v: string[]) => void; fb: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALLERGENS.map((a) => <Check key={a} fb={`${fb}:allergen:${a}`} checked={value.includes(a)} onChange={(on) => onChange(on ? [...value, a] : value.filter((x) => x !== a))}>{allergenLabel(a)}</Check>)}
    </div>
  );
}

type Kind = 'SIMPLE' | 'SIZES' | 'COMBO' | 'HALF';
const KIND_TAB: Record<Kind, DrawerTab> = { SIMPLE: 'data', SIZES: 'sizes', COMBO: 'combo', HALF: 'half' };

// ───────── create
export function ProductCreate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, tab?: DrawerTab) => void }) {
  const { run, busy } = useCommand();
  const { me, auth } = useDev();
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const taxes = useItems<any>('TaxPolicy.List');
  const sku = usePolicy<any>('SkuGenerationPolicy');
  const taxDefault = usePolicy<any>('ProductTaxDefaultPolicy');
  const [name, setName] = useState<Loc>({ ar: '', en: '' });
  const [desc, setDesc] = useState<Loc>({ ar: '', en: '' });
  const [kind, setKind] = useState<Kind>('SIMPLE');
  const [f, setF] = useState({ categoryId: '', unitId: '', taxPolicyId: '', sku: '', imageUrl: '', colorCode: '#22d3ee', calories: '', price: '', takeaway: '' });
  const [allergens, setAllergens] = useState<string[]>([]);
  const [tableTax, setTableTax] = useState(false);
  const [activate, setActivate] = useState(true);
  const branchId = me?.branchId ?? auth.branchId;
  useEffect(() => {
    if (!open) return;
    setName({ ar: '', en: '' }); setDesc({ ar: '', en: '' }); setAllergens([]); setTableTax(false); setKind('SIMPLE'); setActivate(true);
    setF((x) => ({ ...x, sku: '', imageUrl: '', calories: '', price: '', takeaway: '', categoryId: x.categoryId || cats.items.find((c) => c.active)?.id || '', unitId: x.unitId || units.items[0]?.id || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const hasDefault = !!taxDefault?.taxPolicyId;
  useEffect(() => {
    if (open && !hasDefault && !f.taxPolicyId) { const first = taxes.items.find((x) => x.active); if (first) setF((x) => ({ ...x, taxPolicyId: first.id })); }
  }, [open, hasDefault, taxes.items, f.taxPolicyId]);
  const auto = sku?.mode === 'AUTO_IF_EMPTY';
  const submit = async () => {
    const body: any = { name, categoryId: f.categoryId || cats.items[0]?.id, unitId: f.unitId || units.items[0]?.id, colorCode: f.colorCode };
    if (f.taxPolicyId) body.taxPolicyId = f.taxPolicyId;
    if (f.sku.trim()) body.sku = f.sku.trim();
    if (f.imageUrl) body.imageUrl = f.imageUrl;
    if (desc.ar.trim() || desc.en.trim()) body.description = { ar: desc.ar.trim(), en: desc.en.trim() || desc.ar.trim() };
    if (f.calories.trim()) body.calories = Number(f.calories);
    if (allergens.length) body.allergens = allergens;
    if (tableTax) body.chargeTags = ['TABLE_TAX'];
    const r = await run<any>('Product.Create', { body }, { success: t('الصنف اتعمل') });
    if (!r) return;
    if (r.warning) toast('warning', t('الاسم متكرر — اتحفظ مع تحذير'));
    // optional first steps to make it sellable here: price per channel, then on this branch's menu
    if (f.price.trim() && branchId) {
      await run('Catalog.SetPrice', { params: { productId: r.id }, body: { amount: f.price.trim(), currency: 'EGP', branchId, channel: 'DINE_IN' } });
      await run('Catalog.SetPrice', { params: { productId: r.id }, body: { amount: (f.takeaway.trim() || f.price.trim()), currency: 'EGP', branchId, channel: 'TAKEAWAY' } });
    }
    if (activate && r.availability?.state !== 'AVAILABLE') await run('Product.SetAvailability', { params: { productId: r.id }, body: { state: 'AVAILABLE' } });
    if (kind === 'HALF') await run('Product.SetHalfAndHalf', { params: { productId: r.id }, body: { enabled: true, halfGroup: 'PIZZA', halfPriceRatio: '0.5', expectedVersion: r.version } });
    onCreated(r.id, KIND_TAB[kind]);
  };
  return (
    <Drawer width="xl" open={open} onClose={onClose} title={t('صنف جديد')} badge={<StateBadge ops={['Product.Create', 'Product.NameCheck', 'Catalog.SetPrice', 'Product.SetAvailability']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button data-fb="product-create:submit" variant="primary" loading={busy} onClick={submit}><Save className="w-4 h-4" />{kind === 'SIMPLE' ? t('حفظ الصنف') : t('حفظ وكمّل الإعداد')}</Button></>}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        <div className="space-y-4">
          <Field label={t('نوع الصنف')}>
            <Radio<Kind> fb="product-create:kind" value={kind} onChange={setKind} options={[
              { value: 'SIMPLE', label: <span className="inline-flex items-center gap-1"><Package className="w-3.5 h-3.5" />{t('صنف عادي')}</span> },
              { value: 'SIZES', label: <span className="inline-flex items-center gap-1"><Ruler className="w-3.5 h-3.5" />{t('بأحجام')}</span> },
              { value: 'COMBO', label: <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{t('وجبة (كومبو)')}</span> },
              { value: 'HALF', label: <span className="inline-flex items-center gap-1"><Pizza className="w-3.5 h-3.5" />{t('بيتزا نص ونص')}</span> },
            ]} />
          </Field>
          <LocInputs value={name} onChange={setName} fb="product-create" />
          <NameCheckHint name={name} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('القسم')}><Select data-fb="product-create:category" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={cats.items.map((c) => ({ value: c.id, label: L(c.name) + (c.active ? '' : ` (${t('مخفي')})`) }))} /></Field>
            <Field label={t('الوحدة')} hint={t('ثابتة بعد الإنشاء')}><Select data-fb="product-create:unit" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })} options={units.items.filter((u) => u.active).map((u) => ({ value: u.id, label: `${unitLabel(u.code)} (${u.precision ? t('بالوزن') : t('بالقطعة')})` }))} /></Field>
            <Field label={t('مجموعة الضريبة')} hint={hasDefault ? t('فاضي = الضريبة الافتراضية') : t('لازم تختار')}>
              <Select data-fb="product-create:tax" value={f.taxPolicyId} onChange={(e) => setF({ ...f, taxPolicyId: e.target.value })} options={[...(hasDefault ? [{ value: '', label: t('— الافتراضية —') }] : []), ...taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.rate}%` }))]} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('كود الصنف (SKU)')} hint={auto ? t('سيبه فاضي يتولد أوتوماتيك') : t('مطلوب')}>
              <Input data-fb="product-create:sku" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" placeholder={auto ? t('أوتوماتيك') : 'SKU-001'} />
            </Field>
            <Field label={t('السعرات الحرارية')} hint={t('اختياري')}><Input data-fb="product-create:calories" inputMode="numeric" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value.replace(/[^0-9]/g, '') })} /></Field>
            <Field label={t('اللون على الشاشة')}>
              <div className="flex gap-2 items-center"><input data-fb="product-create:color" type="color" value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} dir="ltr" /></div>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('الوصف (عربي)')}><Textarea data-fb="product-create:desc-ar" value={desc.ar} onChange={(e) => setDesc({ ...desc, ar: e.target.value })} className="min-h-[56px]" /></Field>
            <Field label={t('الوصف (إنجليزي)')}><Textarea data-fb="product-create:desc-en" value={desc.en} onChange={(e) => setDesc({ ...desc, en: e.target.value })} className="min-h-[56px]" dir="ltr" /></Field>
          </div>
          <div className="rounded-xl border line p-3 space-y-3">
            <div className="text-sm font-bold">{t('مسببات الحساسية')}</div>
            <AllergenPicker value={allergens} onChange={setAllergens} fb="product-create" />
            <Check fb="product-create:table-tax" checked={tableTax} onChange={setTableTax}>{t('عليه ضريبة جدول (شيشة، مكسرات…)')}</Check>
          </div>
          <div className="rounded-xl border line p-3 space-y-3">
            <div className="text-sm font-bold">{t('عشان يتباع على طول (اختياري)')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <Field label={kind === 'SIZES' || kind === 'HALF' ? t('سعر الحجم الأساسي — صالة') : kind === 'COMBO' ? t('سعر الوجبة — صالة') : t('السعر — صالة')}><Input data-fb="product-create:price" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0.00" /></Field>
              <Field label={t('السعر — تيك أواي')} hint={t('فاضي = زي الصالة')}><Input data-fb="product-create:price-takeaway" inputMode="decimal" value={f.takeaway} onChange={(e) => setF({ ...f, takeaway: e.target.value })} placeholder={f.price || '0.00'} /></Field>
              <Switch checked={activate} onChange={setActivate} label={t('متاح في الفرع ده')} />
            </div>
            <div className="text-[11px] text-dim">{t('الصنف مش بيتباع غير لما يبقى ليه سعر في الفرع والقناة، ويبقى متاح في الفرع.')}{kind !== 'SIMPLE' ? ' ' + t('بعد الحفظ هتكمّل الأحجام/الوجبة/النص ونص.') : ''}</div>
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-bold text-soft">{t('صورة الصنف')}</div>
          <ImageInput value={f.imageUrl} onChange={(v) => setF({ ...f, imageUrl: v })} color={f.colorCode} fb="product-create" />
        </div>
      </div>
    </Drawer>
  );
}

// ───────── drawer
export type DrawerTab = 'data' | 'sizes' | 'combo' | 'half' | 'modifiers' | 'tax' | 'availability';
export function ProductDrawer({ productId, onClose, initialTab = 'data' }: { productId: string | null; onClose: () => void; initialTab?: DrawerTab | 'direction' }) {
  const q = useQuery<any>(productId ? 'Product.Get' : null, { params: { productId } });
  const start = (initialTab === 'direction' ? 'sizes' : initialTab) as DrawerTab;
  const [tab, setTab] = useState<DrawerTab>(start);
  useEffect(() => setTab(start), [productId, start]);
  const p = q.data;
  return (
    <Drawer width="xl" open={!!productId} onClose={onClose} title={p ? <span className="flex items-center gap-2"><Swatch color={p.colorCode} />{L(p.name)} <Tech><span className="num text-sm text-dim">{p.sku}</span></Tech></span> : t('صنف')}
      badge={<>{p && <Tech><Pill tone="neutral">v{p.version}</Pill></Tech>}{p?.combo?.length > 0 && <Pill tone="info">{t('وجبة')}</Pill>}{p?.halfAndHalf && <Pill tone="violet">{t('نص ونص')}</Pill>}</>}>
      {!p ? <Spinner /> : (
        <div className="space-y-4">
          <Readiness p={p} />
          <Tabs<DrawerTab> value={tab} onChange={setTab} tabs={[
            { id: 'data', label: t('البيانات') },
            { id: 'sizes', label: <span className="inline-flex items-center gap-1">{t('الأحجام')}{p.variants?.length ? <span className="num text-xs opacity-70">{p.variants.filter((v: any) => v.active).length}</span> : null}</span> },
            { id: 'combo', label: <span className="inline-flex items-center gap-1">{t('الوجبة')}{p.combo?.length ? <span className="num text-xs opacity-70">{p.combo.length}</span> : null}</span> },
            { id: 'half', label: t('نص ونص') },
            { id: 'modifiers', label: t('الإضافات') },
            { id: 'tax', label: t('الضريبة') },
            { id: 'availability', label: t('التوفر والمنيو') },
          ]} />
          {tab === 'data' && <DataTab p={p} />}
          {tab === 'sizes' && <VariantsEditor p={p} />}
          {tab === 'combo' && <ComboEditor p={p} />}
          {tab === 'half' && <HalfEditor p={p} />}
          {tab === 'modifiers' && <ModifiersTab p={p} />}
          {tab === 'tax' && <TaxTab p={p} />}
          {tab === 'availability' && <AvailabilityTab p={p} />}
        </div>
      )}
    </Drawer>
  );
}

/** Doc 21: the admin screen shows what is missing before a product is sellable (it does not hide it). */
function Readiness({ p }: { p: any }) {
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const hist = useItems<any>('Product.PriceHistory', { params: { productId: p.id }, query: { branchId, variantId: 'BASE' } });
  const current = hist.items.filter((r) => r.state === 'CURRENT');
  const steps: [boolean, React.ReactNode][] = [
    [!!p.taxPolicyId, <>{t('ضريبة')}: {p.taxPolicyName ? L(p.taxPolicyName) : '—'}</>],
    [current.length > 0, <>{t('سعر في الفرع')}: {current.length ? current.map((r) => <span key={r.id} className="ms-1">{channelLabel(r.channel)} <Money v={r.amount} /></span>) : t('مفيش لسه')}</>],
    [p.availability?.state === 'AVAILABLE', <>{t('في الفرع')}: {availabilityLabel(p.availability?.state)}</>],
    [p.active, <>{p.active ? t('الصنف شغال') : t('الصنف مؤرشف')}</>],
  ];
  return (
    <div className="flex flex-wrap gap-2" data-fb="product:readiness">
      {steps.map(([ok, label], i) => (
        <span key={i} className={'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ' + (ok ? 'border-[color-mix(in_srgb,var(--success)_40%,transparent)] text-[var(--success)]' : 'border-[color-mix(in_srgb,var(--warning)_40%,transparent)] text-[var(--warning)]')}>
          {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}{label}
        </span>
      ))}
    </div>
  );
}

function DataTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const init = () => ({ categoryId: p.categoryId, sku: p.sku, imageUrl: p.imageUrl ?? '', colorCode: p.colorCode ?? '#22d3ee', active: p.active, calories: p.calories != null ? String(p.calories) : '' });
  const [name, setName] = useState<Loc>(p.name);
  const [desc, setDesc] = useState<Loc>(p.description ?? { ar: '', en: '' });
  const [f, setF] = useState(init);
  const [allergens, setAllergens] = useState<string[]>(p.allergens ?? []);
  const [tableTax, setTableTax] = useState<boolean>((p.chargeTags ?? []).includes('TABLE_TAX'));
  useEffect(() => {
    setName(p.name); setDesc(p.description ?? { ar: '', en: '' }); setF(init());
    setAllergens(p.allergens ?? []); setTableTax((p.chargeTags ?? []).includes('TABLE_TAX'));
  }, [p.version, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => run('Product.Configure', { params: { productId: p.id }, body: { name, categoryId: f.categoryId, sku: f.sku, imageUrl: f.imageUrl, colorCode: f.colorCode, active: f.active, description: desc, calories: f.calories, allergens, chargeTags: tableTax ? ['TABLE_TAX'] : [], expectedVersion: p.version } }, { success: t('اتحفظ — بيسري على الطلبات الجديدة بس') });
  const unit = units.items.find((u) => u.id === p.unitId);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
      <div className="space-y-3">
        <LocInputs value={name} onChange={setName} fb="product-edit" />
        <NameCheckHint name={name} excludeProductId={p.id} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('القسم')}><Select data-fb="product-edit:category" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={cats.items.map((c) => ({ value: c.id, label: L(c.name) }))} /></Field>
          <Field label={t('كود الصنف (SKU)')} hint={t('فريد حتى بين الأصناف المؤرشفة')}><Input data-fb="product-edit:sku" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" /></Field>
          <Field label={t('الوحدة')} hint={t('ثابتة بعد الإنشاء')}><Input value={unit ? unit.code : p.unitId} disabled dir="ltr" /></Field>
          <Field label={t('السعرات الحرارية')}><Input data-fb="product-edit:calories" inputMode="numeric" value={f.calories} onChange={(e) => setF({ ...f, calories: e.target.value.replace(/[^0-9]/g, '') })} /></Field>
          <Field label={t('اللون')}><div className="flex gap-2"><input type="color" data-fb="product-edit:color" value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} dir="ltr" /></div></Field>
          <Field label={t('الحالة')} hint={t('الأرشفة بدل المسح')}><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={f.active ? t('شغال') : t('مؤرشف')} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('الوصف (عربي)')} hint={t('بيظهر للكاشير في شاشة الصنف')}><Textarea data-fb="product-edit:desc-ar" value={desc.ar} onChange={(e) => setDesc({ ...desc, ar: e.target.value })} className="min-h-[56px]" /></Field>
          <Field label={t('الوصف (إنجليزي)')}><Textarea data-fb="product-edit:desc-en" value={desc.en} onChange={(e) => setDesc({ ...desc, en: e.target.value })} className="min-h-[56px]" dir="ltr" /></Field>
        </div>
        <div className="rounded-xl border line p-3 space-y-2">
          <div className="text-sm font-bold">{t('مسببات الحساسية وضريبة الجدول')}</div>
          <AllergenPicker value={allergens} onChange={setAllergens} fb="product-edit" />
          <Check fb="product-edit:table-tax" checked={tableTax} onChange={setTableTax}>{t('عليه ضريبة جدول (شيشة، مكسرات…)')}</Check>
        </div>
        <div className="flex justify-end"><Button data-fb="product-edit:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ التعديل')}</Button></div>
      </div>
      <div className="space-y-3">
        <ImageInput value={f.imageUrl} onChange={(v) => setF({ ...f, imageUrl: v })} color={f.colorCode} fb="product-edit" />
        <KV rows={[[t('اتعمل'), dateTime(p.createdAt)], [t('كود منظومة الضرايب'), p.fiscalItemCode ?? '—']]} />
      </div>
    </div>
  );
}

const groupRule = (g: any) => (g.kind === 'INGREDIENTS' ? t('مكونات: بدون/خفيف/زيادة') : `${g.min > 0 ? t('إجباري') : t('اختياري')} · ${g.selectionRule === 'SINGLE' || g.max === 1 ? t('اختيار واحد') : t('لحد {n}', { n: g.max })}`);

function ModifiersTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const groups = useItems<any>('ModifierGroup.List');
  const [ids, setIds] = useState<string[]>(p.modifierGroupIds ?? []);
  useEffect(() => setIds(p.modifierGroupIds ?? []), [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(groups.items.map((g) => [g.id, g])), [groups.items]);
  const move = (i: number, d: number) => { const n = [...ids]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setIds(n); };
  const save = () => run('Product.SetModifierGroups', { params: { productId: p.id }, body: { groupIds: ids, expectedVersion: p.version } }, { success: t('مجموعات الإضافات اتحفظت') });
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title={t('الإضافات على الصنف (بالترتيب اللي هيظهر للكاشير)')} badge={<StateBadge ops={['Product.SetModifierGroups']} />}>
        {ids.length === 0 && <div className="text-dim text-sm">{t('مفيش إضافات')}</div>}
        <div className="space-y-1.5">
          {ids.map((id, i) => {
            const g = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 surface-1 rounded-lg px-2 py-1.5">
                <span className="num text-dim w-5">{i + 1}</span>
                <span className="flex-1 text-sm">{g ? L(g.name) : id} {g && <span className="text-dim text-xs">· {groupRule(g)}</span>} {g && !g.active && <Pill tone="warning">{t('موقوفة')}</Pill>}</span>
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === ids.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="danger" onClick={() => setIds(ids.filter((x) => x !== id))}>{t('شيل')}</Button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-3"><Button data-fb="product-modifiers:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></div>
      </Card>
      <Card title={t('كل مجموعات الإضافات')}>
        <div className="space-y-1.5">
          {groups.items.filter((g) => !ids.includes(g.id)).map((g) => (
            <div key={g.id} className="flex items-center gap-2 surface-1 rounded-lg px-2 py-1.5">
              <span className="flex-1 text-sm">{L(g.name)} <span className="text-dim text-xs">· {groupRule(g)} · {t('{n} اختيار', { n: g.options.length })}</span></span>
              <Button size="sm" data-fb={`product-modifiers:add:${g.id}`} onClick={() => setIds([...ids, g.id])} disabled={ids.length >= 20}><Plus className="w-3.5 h-3.5" />{t('ضيف')}</Button>
            </div>
          ))}
        </div>
        <div className="text-[11px] text-dim mt-2">{t('المجموعات نفسها (الاختيارات والأسعار والإجباري) بتتعدل من تبويب "الإضافات" في المنيو.')}</div>
      </Card>
    </div>
  );
}

function TaxTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const taxes = useItems<any>('TaxPolicy.List');
  const approvals = usePolicy<Record<string, any>>('ApprovalRequirementPolicy');
  const [taxId, setTaxId] = useState<string>(p.taxPolicyId ?? '');
  useEffect(() => setTaxId(p.taxPolicyId ?? ''), [p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = taxes.items.find((x) => x.id === p.taxPolicyId);
  const needs = approvals?.PRODUCT_TAX_CHANGE?.mode && approvals.PRODUCT_TAX_CHANGE.mode !== 'NEVER';
  const save = () => run('Product.SetTaxPolicy', { params: { productId: p.id }, body: { taxPolicyId: taxId, expectedVersion: p.version } }, { success: t('ضريبة الصنف اتغيرت — بتسري على الطلبات الجديدة بس') });
  const label = (x: any) => `${L(x.name)} · ${x.rate}% · ${x.calculationMode === 'INCLUSIVE' ? t('شاملة في السعر') : t('بتتضاف على السعر')}`;
  return (
    <div className="space-y-3 max-w-xl">
      <KV rows={[[t('الضريبة دلوقتي'), cur ? label(cur) : (p.taxPolicyName ? L(p.taxPolicyName) : '—')]]} />
      <Field label={t('مجموعة الضريبة الجديدة')}><Select data-fb="product-tax:select" value={taxId} onChange={(e) => setTaxId(e.target.value)} options={taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: label(x) }))} /></Field>
      <Banner tone="info">
        {t('تغيير ضريبة الصنف أمر لوحده لصلاحية إدارة الضرايب.')} {needs ? t('ومحتاج موافقة مدير حسب الإعدادات.') : t('من غير موافقة حسب الإعدادات الحالية.')}
        <div className="text-xs text-dim">{t('السطور المسجلة في الشيكات بتفضل بضريبتها. لو الصنف جزء من وجبة، الجزء بتاعه في الوجبة بياخد الضريبة دي.')}</div>
      </Banner>
      <Button data-fb="product-tax:save" variant="primary" loading={busy} disabled={!taxId || taxId === p.taxPolicyId} onClick={save}>{t('غيّر الضريبة')}</Button>
    </div>
  );
}

function AvailabilityTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const { me, auth } = useDev();
  const branches = useItems<any>('Branch.List');
  const overview = useQuery<any>('Menu.Overview');
  const reasonPolicy = usePolicy<Record<string, string>>('AvailabilityReasonPolicy');
  const [state, setState] = useState<'AVAILABLE' | 'SOLD_OUT' | 'BLOCKED'>(p.availability?.state === 'NOT_ON_BRANCH_MENU' ? 'AVAILABLE' : p.availability?.state ?? 'AVAILABLE');
  const [reason, setReason] = useState(p.availability?.reason ?? '');
  const [today, setToday] = useState(true);
  const branchId = me?.branchId ?? auth.branchId;
  const branch = branches.items.find((b) => b.id === branchId);
  const required = state !== 'AVAILABLE' && reasonPolicy?.[state] === 'REQUIRED';
  const save = () => run('Product.SetAvailability', { params: { productId: p.id }, body: { state, reason: state === 'AVAILABLE' ? undefined : reason, until: state === 'SOLD_OUT' && today ? 'END_OF_BUSINESS_DAY' : undefined } }, { success: t('التوفر اتحدث في الفرع') });
  const menus = (overview.data?.menus ?? []).filter((m: any) => m.active && !m.excludedProductIds?.includes(p.id) && (m.productIds?.includes(p.id) || (!m.excludedCategoryIds?.includes(p.categoryId) && (m.allCategories || m.categoryIds?.includes(p.categoryId)))));
  const dpName = (id: string) => L((overview.data?.dayparts ?? []).find((d: any) => d.id === id)?.name) || id;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        <KV rows={[
          [t('الفرع'), branch ? branchLabel(branch) : '—'],
          [t('الحالة دلوقتي'), <Pill tone={availabilityTone(p.availability?.state)}>{availabilityLabel(p.availability?.state)}{p.availability?.soldOutFor ? ' · ' + t('النهارده بس') : ''}</Pill>],
          [t('السبب'), p.availability?.reason ?? '—'],
        ]} />
        <Radio<'AVAILABLE' | 'SOLD_OUT' | 'BLOCKED'> fb="product-availability:state" value={state} onChange={setState} options={[
          { value: 'AVAILABLE', label: t('متاح') }, { value: 'SOLD_OUT', label: t('خلص') }, { value: 'BLOCKED', label: t('متوقف') },
        ]} />
        {state === 'SOLD_OUT' && <Switch checked={today} onChange={setToday} label={today ? t('النهارده بس — يرجع لوحده بكرة') : t('لحد ما حد يرجّعه')} />}
        {state !== 'AVAILABLE' && (
          <Field label={<>{t('السبب')} {required ? <span className="text-[var(--error)]">*</span> : <span className="text-dim">({t('اختياري')})</span>}</>}>
            <Input data-fb="product-availability:reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثلاً: الفريزر عطلان')} />
          </Field>
        )}
        <div className="text-[11px] text-dim">{t('الفرع من جهاز الدخول — كل فرع بيتحكم في المنيو بتاعه')}</div>
        <Button data-fb="product-availability:save" variant="primary" loading={busy} onClick={save}>{t('حفظ التوفر')}</Button>
      </div>
      <Card title={t('بيظهر في أنهي منيو')} badge={<StateBadge ops={['Menu.Overview']} />}>
        {!overview.data?.restricted ? <div className="text-sm text-dim">{t('مفيش منيوهات متحددة — الصنف بيظهر طول اليوم في كل القنوات.')}</div> : menus.length === 0 ? (
          <Banner tone="warning"><AlertTriangle className="inline w-4 h-4" /> {t('الصنف مش في أي منيو شغال — مش هيظهر على الكاشير. ضيفه لمنيو من تبويب "المنيوهات والمواعيد".')}</Banner>
        ) : (
          <div className="space-y-2">
            {menus.map((m: any) => (
              <div key={m.id} className="surface-1 rounded-lg px-3 py-2 text-sm">
                <div className="font-bold">{L(m.name)} {m.runningNow && <Pill tone="success">{t('شغال دلوقتي')}</Pill>}</div>
                <div className="text-xs text-dim">{m.channels.map(channelLabel).join('، ')} · {m.daypartIds.length ? m.daypartIds.map(dpName).join('، ') : t('طول اليوم')}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
