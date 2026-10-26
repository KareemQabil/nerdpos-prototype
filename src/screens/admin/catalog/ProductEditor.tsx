// B1 product create form and product drawer (data, modifier groups, tax, branch availability, sizes/combo).
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Plus, Save, Pizza, Layers, AlertTriangle } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Card, Field, Input, KV, Modal, Money, Pill, Select, Spinner, StateBadge, Switch, Table, Tabs, toast } from '../../../ui';
import { t, L } from '../../../i18n';
import { dateTime } from '../../../lib/format';
import { ALLERGENS, Check, LocInputs, Radio, Swatch, allergenLabel, availabilityLabel, availabilityTone, channelLabel, useDebounced, useItems, usePolicy } from './common';

type Loc = { ar: string; en: string };

/** Live name check (Product.NameCheck, read-only); the write enforces ProductNameUniquenessPolicy itself. */
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
      {t('فيه صنف تاني بنفس الاسم: {n}', { n: L(q.data.clash?.name) })} · <span className="num text-xs">ProductNameUniquenessPolicy = {rule}</span>
      <div className="text-xs text-dim">{rule === 'BLOCK' ? t('الحفظ هيترفض (CATALOG_PRODUCT_NAME_TAKEN)') : rule === 'WARN' ? t('الحفظ مسموح مع تحذير') : t('مسموح')}</div>
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

// ───────── create
export function ProductCreate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { run, busy } = useCommand();
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const taxes = useItems<any>('TaxPolicy.List');
  const sku = usePolicy<any>('SkuGenerationPolicy');
  const taxDefault = usePolicy<any>('ProductTaxDefaultPolicy');
  const nap = usePolicy<string>('NewProductAvailabilityPolicy');
  const [name, setName] = useState<Loc>({ ar: '', en: '' });
  const [f, setF] = useState({ categoryId: '', unitId: '', taxPolicyId: '', sku: '', imageUrl: '', colorCode: '#22d3ee' });
  const [allergens, setAllergens] = useState<string[]>([]);
  const [tableTax, setTableTax] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName({ ar: '', en: '' }); setAllergens([]); setTableTax(false);
    setF((x) => ({ ...x, sku: '', imageUrl: '', categoryId: x.categoryId || cats.items.find((c) => c.active)?.id || '', unitId: x.unitId || units.items[0]?.id || '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // without a ProductTaxDefaultPolicy a product needs an explicit tax, or it can never be quoted (doc 21)
  const hasDefault = !!taxDefault?.taxPolicyId;
  useEffect(() => {
    if (open && !hasDefault && !f.taxPolicyId) { const first = taxes.items.find((x) => x.active); if (first) setF((x) => ({ ...x, taxPolicyId: first.id })); }
  }, [open, hasDefault, taxes.items, f.taxPolicyId]);
  const auto = sku?.mode === 'AUTO_IF_EMPTY';
  const submit = async () => {
    const body: any = { name, categoryId: f.categoryId || cats.items[0]?.id, unitId: f.unitId || units.items[0]?.id, colorCode: f.colorCode };
    if (f.taxPolicyId) body.taxPolicyId = f.taxPolicyId;
    if (f.sku.trim()) body.sku = f.sku.trim();
    if (f.imageUrl.trim()) body.imageUrl = f.imageUrl.trim();
    if (allergens.length) body.allergens = allergens;
    if (tableTax) body.chargeTags = ['TABLE_TAX'];
    const r = await run<any>('Product.Create', { body }, { success: t('الصنف اتعمل') });
    if (!r) return;
    if (r.warning) toast('warning', t('الاسم متكرر — اتحفظ مع تحذير (سياسة WARN)'), r.warning.warning);
    onCreated(r.id);
  };
  return (
    <Modal open={open} onClose={onClose} wide title={t('صنف جديد')} badge={<StateBadge ops={['Product.Create', 'Product.NameCheck']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button data-fb="product-create:submit" variant="primary" loading={busy} onClick={submit}><Save className="w-4 h-4" />{t('حفظ الصنف')}</Button></>}>
      <div className="space-y-4">
        <LocInputs value={name} onChange={setName} fb="product-create" />
        <NameCheckHint name={name} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('القسم')}><Select data-fb="product-create:category" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={cats.items.map((c) => ({ value: c.id, label: L(c.name) + (c.active ? '' : ` (${t('مخفي')})`) }))} /></Field>
          <Field label={t('الوحدة')} hint={t('الوحدة ثابتة بعد الإنشاء')}><Select data-fb="product-create:unit" value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })} options={units.items.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.code} (${t('{n} خانة عشرية', { n: u.precision })})` }))} /></Field>
          <Field label={t('الضريبة')} hint={hasDefault ? t('فاضي = الافتراضي من ProductTaxDefaultPolicy') : t('مفيش ضريبة افتراضية (ProductTaxDefaultPolicy) — لازم تختار')}>
            <Select data-fb="product-create:tax" value={f.taxPolicyId} onChange={(e) => setF({ ...f, taxPolicyId: e.target.value })} options={[...(hasDefault ? [{ value: '', label: t('— الافتراضي —') }] : []), ...taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.rate}%` }))]} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('كود الصنف (SKU)')} hint={auto ? t('سيبه فاضي يتولد أوتوماتيك (SkuGenerationPolicy = AUTO_IF_EMPTY)') : t('مطلوب (SkuGenerationPolicy = MANUAL)')}>
            <Input data-fb="product-create:sku" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" placeholder={auto ? t('أوتوماتيك') : 'SKU-001'} />
          </Field>
          <Field label={t('رابط الصورة')}><Input data-fb="product-create:image" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} dir="ltr" placeholder="https://…" /></Field>
          <Field label={t('اللون على الشاشة')}>
            <div className="flex gap-2 items-center"><input data-fb="product-create:color" type="color" value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} dir="ltr" /></div>
          </Field>
        </div>
        <div className="rounded-xl border line p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold">{t('مسببات الحساسية')} <StateBadge state="PROPOSED" /></div>
          <AllergenPicker value={allergens} onChange={setAllergens} fb="product-create" />
          <div className="flex items-center gap-2 flex-wrap">
            <Check fb="product-create:table-tax" checked={tableTax} onChange={setTableTax}>{t('عليه ضريبة جدول (TABLE_TAX)')}</Check>
            <StateBadge state="PROPOSED" />
            <span className="text-[11px] text-dim">{t('للشيشة والمكسرات وغيرها — نسبة الضريبة من سياسة ضريبة الجدول')}</span>
          </div>
        </div>
        <Banner tone="info">
          {t('الصنف الجديد مش بيتباع غير بعد: سعر للفرع والقناة، وإنه يبقى متاح في الفرع.')}{' '}
          <span className="num text-xs">NewProductAvailabilityPolicy = {nap ?? '…'}</span>
          {nap === 'CREATING_BRANCH' && <span> · {t('هيبقى متاح أوتوماتيك في الفرع ده')}</span>}
        </Banner>
      </div>
    </Modal>
  );
}

// ───────── drawer
type DrawerTab = 'data' | 'modifiers' | 'tax' | 'availability' | 'direction';
export function ProductDrawer({ productId, onClose, initialTab = 'data' }: { productId: string | null; onClose: () => void; initialTab?: DrawerTab }) {
  const q = useQuery<any>(productId ? 'Product.Get' : null, { params: { productId } });
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  useEffect(() => setTab(initialTab), [productId, initialTab]);
  const p = q.data;
  const isDir = !!(p && (p.direction || p.variants?.length || p.combo?.length || p.halfAndHalf || p.chargeTags?.length));
  return (
    <Modal open={!!productId} onClose={onClose} xwide title={p ? <span className="flex items-center gap-2"><Swatch color={p.colorCode} />{L(p.name)} <span className="num text-sm text-dim">{p.sku}</span></span> : t('صنف')}
      badge={<>{p && <Pill tone="neutral">v{p.version}</Pill>}{p?.direction && <StateBadge state="PROPOSED" />}</>}>
      {!p ? <Spinner /> : (
        <div className="space-y-4">
          <Readiness p={p} />
          <Tabs<DrawerTab> value={tab} onChange={setTab} tabs={[
            { id: 'data', label: t('البيانات') },
            { id: 'modifiers', label: t('مجموعات الإضافات') },
            { id: 'tax', label: t('الضريبة') },
            { id: 'availability', label: t('التوفر في الفرع') },
            ...(isDir ? [{ id: 'direction' as DrawerTab, label: <span className="inline-flex items-center gap-1">{t('أحجام وكومبو')} <StateBadge state="PROPOSED" /></span> }] : []),
          ]} />
          {tab === 'data' && <DataTab p={p} />}
          {tab === 'modifiers' && <ModifiersTab p={p} />}
          {tab === 'tax' && <TaxTab p={p} />}
          {tab === 'availability' && <AvailabilityTab p={p} />}
          {tab === 'direction' && <DirectionTab p={p} />}
        </div>
      )}
    </Modal>
  );
}

/** Doc 21: the admin screen shows what is missing before a product is sellable (it does not hide it). */
function Readiness({ p }: { p: any }) {
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const hist = useItems<any>('Product.PriceHistory', { params: { productId: p.id }, query: { branchId } });
  const current = hist.items.filter((r) => r.state === 'CURRENT');
  const steps: [boolean, React.ReactNode][] = [
    [!!p.taxPolicyId, <>{t('ضريبة')}: {p.taxPolicyName ? L(p.taxPolicyName) : '—'}</>],
    [current.length > 0, <>{t('سعر ساري في الفرع')}: {current.length ? current.map((r) => <span key={r.id} className="ms-1">{channelLabel(r.channel)} <Money v={r.amount} /></span>) : t('مفيش (PRICE_NOT_FOUND)')}</>],
    [p.availability?.state === 'AVAILABLE', <>{t('متاح في الفرع')}: {availabilityLabel(p.availability?.state)}</>],
    [p.active, <>{t('الصنف نشط')}</>],
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
  const [name, setName] = useState<Loc>(p.name);
  const [f, setF] = useState({ categoryId: p.categoryId, sku: p.sku, imageUrl: p.imageUrl ?? '', colorCode: p.colorCode ?? '#22d3ee', active: p.active });
  const [allergens, setAllergens] = useState<string[]>(p.allergens ?? []);
  const [tableTax, setTableTax] = useState<boolean>((p.chargeTags ?? []).includes('TABLE_TAX'));
  useEffect(() => {
    setName(p.name); setF({ categoryId: p.categoryId, sku: p.sku, imageUrl: p.imageUrl ?? '', colorCode: p.colorCode ?? '#22d3ee', active: p.active });
    setAllergens(p.allergens ?? []); setTableTax((p.chargeTags ?? []).includes('TABLE_TAX'));
  }, [p.version, p.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => run('Product.Configure', { params: { productId: p.id }, body: { name, categoryId: f.categoryId, sku: f.sku, imageUrl: f.imageUrl, colorCode: f.colorCode, active: f.active, allergens, chargeTags: tableTax ? ['TABLE_TAX'] : [], expectedVersion: p.version } }, { success: t('اتحفظ — بيسري على التسعيرات الجديدة بس') });
  const unit = units.items.find((u) => u.id === p.unitId);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4">
      <div className="space-y-3">
        <LocInputs value={name} onChange={setName} fb="product-edit" />
        <NameCheckHint name={name} excludeProductId={p.id} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('القسم')}><Select data-fb="product-edit:category" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} options={cats.items.map((c) => ({ value: c.id, label: L(c.name) }))} /></Field>
          <Field label={t('كود الصنف (SKU)')} hint={t('فريد حتى بين الأصناف المؤرشفة')}><Input data-fb="product-edit:sku" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} dir="ltr" /></Field>
          <Field label={t('الوحدة')} hint={t('ثابتة بعد الإنشاء')}><Input value={unit ? `${unit.code} · ${unit.precision}` : p.unitId} disabled dir="ltr" /></Field>
          <Field label={t('رابط الصورة')}><Input data-fb="product-edit:image" value={f.imageUrl} onChange={(e) => setF({ ...f, imageUrl: e.target.value })} dir="ltr" /></Field>
          <Field label={t('اللون')}><div className="flex gap-2"><input type="color" data-fb="product-edit:color" value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={f.colorCode} onChange={(e) => setF({ ...f, colorCode: e.target.value })} dir="ltr" /></div></Field>
          <Field label={t('الحالة')} hint={t('الأرشفة بدل المسح — مفيش مسح')}><Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={f.active ? t('نشط') : t('مؤرشف')} /></Field>
        </div>
        <div className="rounded-xl border line p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-bold">{t('مسببات الحساسية وضريبة الجدول')} <StateBadge state="PROPOSED" /></div>
          <AllergenPicker value={allergens} onChange={setAllergens} fb="product-edit" />
          <Check fb="product-edit:table-tax" checked={tableTax} onChange={setTableTax}>{t('عليه ضريبة جدول (TABLE_TAX)')}</Check>
        </div>
        <div className="flex justify-end"><Button data-fb="product-edit:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ التعديل')}</Button></div>
      </div>
      <div className="space-y-2">
        <div className="aspect-square rounded-xl border line overflow-hidden flex items-center justify-center" style={{ background: f.colorCode + '33' }}>
          {f.imageUrl ? <img src={f.imageUrl} alt="" className="w-full h-full object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : <span className="text-dim text-xs">{t('مفيش صورة')}</span>}
        </div>
        <KV rows={[[t('اتعمل'), dateTime(p.createdAt)], [t('كود الضرايب'), p.fiscalItemCode ?? '—'], [t('النسخة'), `v${p.version}`]]} />
      </div>
    </div>
  );
}

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
      <Card title={t('المجموعات على الصنف (بالترتيب اللي هيظهر)')}>
        {ids.length === 0 && <div className="text-dim text-sm">{t('مفيش إضافات')}</div>}
        <div className="space-y-1.5">
          {ids.map((id, i) => {
            const g = byId.get(id);
            return (
              <div key={id} className="flex items-center gap-2 surface-1 rounded-lg px-2 py-1.5">
                <span className="num text-dim w-5">{i + 1}</span>
                <span className="flex-1 text-sm">{g ? L(g.name) : id} {g && <span className="text-dim text-xs">· {g.selectionRule} {g.min}–{g.max}</span>} {g && !g.active && <Pill tone="warning">{t('موقوفة')}</Pill>}</span>
                <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === ids.length - 1}><ArrowDown className="w-3.5 h-3.5" /></Button>
                <Button size="sm" variant="danger" onClick={() => setIds(ids.filter((x) => x !== id))}>{t('شيل')}</Button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-3"><Button data-fb="product-modifiers:save" variant="primary" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></div>
      </Card>
      <Card title={t('كل المجموعات')}>
        <div className="space-y-1.5">
          {groups.items.filter((g) => !ids.includes(g.id)).map((g) => (
            <div key={g.id} className="flex items-center gap-2 surface-1 rounded-lg px-2 py-1.5">
              <span className="flex-1 text-sm">{L(g.name)} <span className="text-dim text-xs">· {g.options.length} {t('اختيار')}</span></span>
              <Button size="sm" data-fb={`product-modifiers:add:${g.id}`} onClick={() => setIds([...ids, g.id])} disabled={ids.length >= 20}><Plus className="w-3.5 h-3.5" />{t('ضيف')}</Button>
            </div>
          ))}
        </div>
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
  const rule = approvals?.PRODUCT_TAX_CHANGE;
  const save = () => run('Product.SetTaxPolicy', { params: { productId: p.id }, body: { taxPolicyId: taxId, expectedVersion: p.version } }, { success: t('ضريبة الصنف اتغيرت — بتسري على التسعيرات الجديدة بس') });
  return (
    <div className="space-y-3 max-w-xl">
      <KV rows={[[t('الضريبة الحالية'), cur ? `${L(cur.name)} · ${cur.rate}% · ${cur.calculationMode}` : (p.taxPolicyName ? L(p.taxPolicyName) : '—')]]} />
      <Field label={t('الضريبة الجديدة')}><Select data-fb="product-tax:select" value={taxId} onChange={(e) => setTaxId(e.target.value)} options={taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.rate}% · ${x.calculationMode}` }))} /></Field>
      <Banner tone="info">
        {t('تغيير الضريبة أمر لوحده بصلاحية tax:manage، وموافقة المدير حسب السياسة.')} <span className="num text-xs">PRODUCT_TAX_CHANGE: {rule?.mode ?? 'NEVER'}</span>
        <div className="text-xs text-dim">{t('السطور المسجلة في الشيكات بتفضل بضريبتها')}</div>
      </Banner>
      <Button data-fb="product-tax:save" variant="primary" loading={busy} disabled={!taxId || taxId === p.taxPolicyId} onClick={save}>{t('غيّر الضريبة')}</Button>
    </div>
  );
}

function AvailabilityTab({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const { me, auth } = useDev();
  const branches = useItems<any>('Branch.List');
  const reasonPolicy = usePolicy<Record<string, string>>('AvailabilityReasonPolicy');
  const [state, setState] = useState<'AVAILABLE' | 'SOLD_OUT' | 'BLOCKED'>(p.availability?.state === 'NOT_ON_BRANCH_MENU' ? 'AVAILABLE' : p.availability?.state ?? 'AVAILABLE');
  const [reason, setReason] = useState(p.availability?.reason ?? '');
  const branchId = me?.branchId ?? auth.branchId;
  const branch = branches.items.find((b) => b.id === branchId);
  const required = state !== 'AVAILABLE' && reasonPolicy?.[state] === 'REQUIRED';
  const save = () => run('Product.SetAvailability', { params: { productId: p.id }, body: { state, reason: state === 'AVAILABLE' ? undefined : reason } }, { success: t('التوفر اتحدث في الفرع') });
  return (
    <div className="space-y-3 max-w-xl">
      <KV rows={[
        [t('الفرع'), branch?.name ?? branchId ?? '—'],
        [t('الحالة دلوقتي'), <Pill tone={availabilityTone(p.availability?.state)}>{availabilityLabel(p.availability?.state)}</Pill>],
        [t('السبب'), p.availability?.reason ?? '—'],
      ]} />
      <Radio<'AVAILABLE' | 'SOLD_OUT' | 'BLOCKED'> fb="product-availability:state" value={state} onChange={setState} options={[
        { value: 'AVAILABLE', label: t('متاح') }, { value: 'SOLD_OUT', label: t('خلص') }, { value: 'BLOCKED', label: t('متوقف') },
      ]} />
      {state !== 'AVAILABLE' && (
        <Field label={<>{t('السبب')} {required ? <span className="text-[var(--error)]">*</span> : <span className="text-dim">({t('اختياري')})</span>}</>} hint={<span className="num">AvailabilityReasonPolicy[{state}] = {reasonPolicy?.[state] ?? '…'}</span>}>
          <Input data-fb="product-availability:reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثلاً: الفريزر عطلان')} />
        </Field>
      )}
      <div className="text-[11px] text-dim">{t('الفرع من جهاز الدخول — كل فرع بيتحكم في المنيو بتاعه')}</div>
      <Button data-fb="product-availability:save" variant="primary" loading={busy} onClick={save}>{t('حفظ التوفر')}</Button>
    </div>
  );
}

function DirectionTab({ p }: { p: any }) {
  const products = useItems<any>('Catalog.Search');
  const pname = (id: string) => L(products.items.find((x) => x.id === id)?.name) || id;
  return (
    <div className="space-y-4">
      <Banner tone="info">{t('الأحجام والكومبو والنص ونص اتجاه للمنتج — مش في العقود المبنية لسه. السعر بيطلع من السيرفر في التسعيرة بس.')} <StateBadge state="PROPOSED" /></Banner>
      <VariantsEditor p={p} />
      {p.halfAndHalf && <Card title={<span className="inline-flex items-center gap-2"><Pizza className="w-4 h-4" />{t('نص ونص')}</span>} badge={<StateBadge state="PROPOSED" />}><div className="text-sm">{t('الصنف ده ينفع يتقسم نصين مع صنف تاني بيقبل نص ونص. طريقة التسعير من HalfAndHalfPricingPolicy (أعلى نص أو المتوسط).')}</div></Card>}
      {p.combo?.length > 0 && (
        <Card title={<span className="inline-flex items-center gap-2"><Layers className="w-4 h-4" />{t('خانات الكومبو')}</span>} badge={<StateBadge state="PROPOSED" />}>
          <Table head={[t('الخانة'), t('الاختيارات'), t('الافتراضي')]} rows={p.combo.map((s: any) => [
            L(s.name),
            <div className="flex flex-wrap gap-1">{s.options.map((o: any) => <Pill key={o.productId} tone="neutral">{pname(o.productId)} {Number(o.upcharge) ? <>+<Money v={o.upcharge} /></> : null}</Pill>)}</div>,
            pname(s.defaultProductId),
          ])} />
        </Card>
      )}
      {(p.chargeTags ?? []).includes('TABLE_TAX') && <Banner tone="warning"><AlertTriangle className="inline w-4 h-4" /> {t('عليه ضريبة جدول (TABLE_TAX) — بتتحسب في الشيك حسب سياسة ضريبة الجدول')} <StateBadge state="PROPOSED" /></Banner>}
    </div>
  );
}

function VariantsEditor({ p }: { p: any }) {
  const { run, busy } = useCommand();
  const [edit, setEdit] = useState<{ id: string; name: Loc; priceDelta: string; modifierMultiplier: string; active: boolean; isNew?: boolean } | null>(null);
  const save = async () => {
    if (!edit) return;
    const r = await run('Variant.Upsert', { params: { productId: p.id, variantId: edit.id }, body: { name: edit.name, priceDelta: edit.priceDelta, modifierMultiplier: edit.modifierMultiplier, active: edit.active, attributes: [{ name: 'size', value: edit.name.en || edit.name.ar }], expectedVersion: p.version } }, { success: t('الحجم اتحفظ') });
    if (r) setEdit(null);
  };
  return (
    <Card title={t('الأحجام')} badge={<StateBadge ops={['Variant.Upsert']} />} actions={<Button size="sm" data-fb="variant:new" onClick={() => setEdit({ id: 'v_' + Math.random().toString(36).slice(2, 7), name: { ar: '', en: '' }, priceDelta: '0', modifierMultiplier: '1', active: true, isNew: true })}><Plus className="w-3.5 h-3.5" />{t('حجم جديد')}</Button>}>
      <Table head={[t('الحجم'), t('فرق السعر'), t('مضاعف الإضافات'), t('الحالة'), '']} empty={t('مفيش أحجام — الصنف بسعر واحد')} rows={(p.variants ?? []).map((v: any) => [
        <span>{L(v.name)} <span className="num text-dim text-xs">{v.id}</span></span>,
        <Money v={v.priceDelta} />,
        <span className="num">×{v.modifierMultiplier}</span>,
        v.active ? <Pill tone="success">{t('نشط')}</Pill> : <Pill tone="neutral">{t('موقوف')}</Pill>,
        <Button size="sm" data-fb={`variant:edit:${v.id}`} onClick={() => setEdit({ id: v.id, name: v.name, priceDelta: String(v.priceDelta), modifierMultiplier: String(v.modifierMultiplier), active: v.active })}>{t('تعديل')}</Button>,
      ])} />
      <div className="text-[11px] text-dim mt-2">{t('العقد (Variant.Upsert) فيه attributes و barcode بس؛ الاسم وفرق السعر ومضاعف الإضافات اتجاه.')}</div>
      {edit && (
        <div className="mt-3 rounded-xl border line p-3 space-y-3">
          <LocInputs value={edit.name} onChange={(name) => setEdit({ ...edit, name })} fb="variant" />
          <div className="grid grid-cols-3 gap-3">
            <Field label={t('فرق السعر (ج.م)')}><Input data-fb="variant:delta" inputMode="decimal" value={edit.priceDelta} onChange={(e) => setEdit({ ...edit, priceDelta: e.target.value })} /></Field>
            <Field label={t('مضاعف الإضافات')}><Input data-fb="variant:mult" inputMode="decimal" value={edit.modifierMultiplier} onChange={(e) => setEdit({ ...edit, modifierMultiplier: e.target.value })} /></Field>
            <Field label={t('الحالة')}><Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label={edit.active ? t('نشط') : t('موقوف')} /></Field>
          </div>
          <div className="flex gap-2 justify-end"><Button onClick={() => setEdit(null)}>{t('إلغاء')}</Button><Button variant="primary" data-fb="variant:save" loading={busy} onClick={save}>{t('حفظ الحجم')}</Button></div>
        </div>
      )}
    </Card>
  );
}
