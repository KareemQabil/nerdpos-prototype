// Round 3 (F2-04, P1-029): ONE guided flow for a new product instead of four screens — name ar/en and category,
// prices per channel and tax group, how it is stocked (a recipe from ingredients / a stock item sold as is / not
// tracked), min & target levels and an optional first receipt — then it shows on the menu and the POS.
// It only calls the existing operations, in order (Product.Create → Catalog.SetPrice → Product.SetAvailability →
// Recipe.Define or InventoryItem.Configure + InventoryItem.SetLevels + GoodsReceipt.Post), so the separate admin
// screens keep working and every rule (approvals, name check, price rules) still applies.
import React, { useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, ChevronLeft, ChevronRight, CookingPot, Package, CircleSlash, Plus, Trash2, Loader2, XCircle, ShoppingCart, ScanSearch, UtensilsCrossed, Sparkles } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../../app/hooks';
import { Banner, Button, Drawer, Field, Input, KV, Pill, Select, StateBadge, Stepper, Table } from '../../../ui';
import { Tech } from '../../../app/tech';
import { t, L, tv } from '../../../i18n';
import { cn, money } from '../../../lib/format';
import { LocInputs, useItems, usePolicy } from './common';
import { NameCheckHint } from './ProductEditor';
import { ItemPicker, unitOptions, unitLabel, useItemsCatalog, useList, useWarehouses, newKey, Inp, Sel, fmtQty } from '../../inventory/common';

type Stocking = 'RECIPE' | 'STOCK_ITEM' | 'NOT_TRACKED';
const CHANNELS: { id: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'; ar: string }[] = [{ id: 'DINE_IN', ar: 'صالة' }, { id: 'TAKEAWAY', ar: 'تيك أواي' }, { id: 'DELIVERY', ar: 'دليفري' }];
interface RLine { itemId: string; quantity: string; unit: string; wastePercent: string }
type StepState = 'todo' | 'run' | 'ok' | 'fail' | 'skip';

export function NewProductWizard({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (productId: string) => void }) {
  const { run } = useCommand();
  const { auth, me, nav } = useDev();
  const branchId: string = me?.branchId ?? auth.branchId;
  const cats = useItems<any>('Category.List');
  const units = useItems<any>('Unit.List');
  const taxes = useItems<any>('TaxPolicy.List');
  const taxDefault = usePolicy<any>('ProductTaxDefaultPolicy');
  const items = useItemsCatalog();
  const whs = useWarehouses();
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const [step, setStep] = useState(0);
  const [name, setName] = useState({ ar: '', en: '' });
  const [categoryId, setCategoryId] = useState('');
  const [sku, setSku] = useState('');
  const [color, setColor] = useState('#22d3ee');
  const [prices, setPrices] = useState<Record<string, string>>({ DINE_IN: '', TAKEAWAY: '', DELIVERY: '' });
  const [taxPolicyId, setTax] = useState('');
  const [stocking, setStocking] = useState<Stocking>('RECIPE');
  const [lines, setLines] = useState<RLine[]>([{ itemId: '', quantity: '', unit: '', wastePercent: '' }]);
  const [stock, setStock] = useState({ unitId: 'unit_pcs', packName: '', packFactor: '', supplierId: '', cost: '', shelfLife: '' });
  const [levels, setLevels] = useState<Record<string, { min: string; par: string }>>({});
  const [first, setFirst] = useState({ on: false, warehouseId: '', supplierId: '', quantity: '', unitCost: '', byPack: true });
  const [progress, setProgress] = useState<{ key: string; label: string; state: StepState; note?: string }[]>([]);
  const [done, setDone] = useState<{ productId: string; itemId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const myWhs = whs.items.filter((w) => w.branchId === branchId && w.active);
  const salesWh = myWhs.find((w) => w.salesDefault) ?? myWhs[0];
  const storeWh = myWhs.find((w) => w.kind === 'STORE') ?? salesWh;
  useEffect(() => {
    if (!open) return;
    setStep(0); setName({ ar: '', en: '' }); setSku(''); setPrices({ DINE_IN: '', TAKEAWAY: '', DELIVERY: '' }); setStocking('RECIPE'); setLines([{ itemId: '', quantity: '', unit: '', wastePercent: '' }]);
    setStock({ unitId: 'unit_pcs', packName: '', packFactor: '', supplierId: '', cost: '', shelfLife: '' }); setLevels({}); setFirst({ on: false, warehouseId: '', supplierId: '', quantity: '', unitCost: '', byPack: true }); setProgress([]); setDone(null);
    setCategoryId((x) => x || cats.items.find((c) => c.active && c.id !== 'cat_breakfast')?.id || cats.items[0]?.id || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !taxDefault?.taxPolicyId && !taxPolicyId) { const f = taxes.items.find((x) => x.active); if (f) setTax(f.id); } }, [open, taxes.items, taxDefault, taxPolicyId]);

  // recipe cost estimate (display only — the server computes the real cost on save)
  const recipeCost = lines.reduce((a, l) => { const it = items.items.find((i) => i.id === l.itemId); if (!it || !(Number(l.quantity) > 0)) return a; const f = unitOptions(it).find((o) => o.value === l.unit)?.factor ?? 1; return a + Number(l.quantity) * f * (1 + Number(l.wastePercent || 0) / 100) * Number(it.avgCost); }, 0);
  const unitCost = stocking === 'RECIPE' ? recipeCost : stocking === 'STOCK_ITEM' ? Number(stock.cost || 0) : 0;
  const taxRate = Number(taxes.items.find((x) => x.id === (taxPolicyId || taxDefault?.taxPolicyId))?.rate ?? 0);
  const inclusive = taxes.items.find((x) => x.id === (taxPolicyId || taxDefault?.taxPolicyId))?.calculationMode === 'INCLUSIVE';
  const foodCost = (ch: string) => { const p = Number(prices[ch] || 0); if (!p || !unitCost) return null; const net = inclusive ? p / (1 + taxRate / 100) : p; return (unitCost / net) * 100; };

  const steps = [{ label: t('الاسم والقسم') }, { label: t('الأسعار والضريبة') }, { label: t('التخزين') }, { label: t('الحد والاستلام') }, { label: t('مراجعة وحفظ') }];
  const valid = [
    !!name.ar.trim() && !!categoryId,
    CHANNELS.some((c) => Number(prices[c.id]) > 0) && (!!taxPolicyId || !!taxDefault?.taxPolicyId),
    stocking === 'NOT_TRACKED' || (stocking === 'RECIPE' ? lines.some((l) => l.itemId && Number(l.quantity) > 0) : !!stock.unitId),
    !first.on || (!!first.supplierId && Number(first.quantity) > 0),
    true,
  ];

  const save = async () => {
    setSaving(true);
    const plan: { key: string; label: string; state: StepState; note?: string }[] = [
      { key: 'product', label: t('الصنف في المنيو'), state: 'todo' },
      ...CHANNELS.filter((c) => Number(prices[c.id]) > 0).map((c) => ({ key: `price:${c.id}`, label: t('سعر {c}', { c: t(c.ar) }), state: 'todo' as StepState })),
      { key: 'available', label: t('متاح للبيع في الفرع'), state: 'todo' },
      ...(stocking === 'RECIPE' ? [{ key: 'recipe', label: t('الوصفة (بتسحب الخامات مع كل بيعة)'), state: 'todo' as StepState }] : []),
      ...(stocking === 'STOCK_ITEM' ? [{ key: 'item', label: t('صنف المخزن (بيتباع زي ما هو)'), state: 'todo' as StepState }, { key: 'levels', label: t('الحد الأدنى والمستهدف'), state: 'todo' as StepState }, ...(first.on ? [{ key: 'receipt', label: t('أول استلام'), state: 'todo' as StepState }] : [])] : []),
    ];
    setProgress(plan);
    const mark = (key: string, state: StepState, note?: string) => setProgress((p) => p.map((x) => (x.key === key ? { ...x, state, note } : x)));
    const stop = () => { setSaving(false); };
    mark('product', 'run');
    const body: any = { name: { ar: name.ar.trim(), en: name.en.trim() || name.ar.trim() }, categoryId, unitId: units.items.find((u) => u.code === 'DEMO_EA' || u.code === 'EA')?.id ?? units.items[0]?.id, colorCode: color };
    if (taxPolicyId) body.taxPolicyId = taxPolicyId;
    if (sku.trim()) body.sku = sku.trim();
    const p = await run<any>('Product.Create', { body });
    if (!p) { mark('product', 'fail'); return stop(); }
    mark('product', 'ok', p.sku);
    for (const c of CHANNELS.filter((x) => Number(prices[x.id]) > 0)) {
      mark(`price:${c.id}`, 'run');
      const r = await run('Catalog.SetPrice', { params: { productId: p.id }, body: { amount: prices[c.id], currency: 'EGP', branchId, channel: c.id } });
      mark(`price:${c.id}`, r ? 'ok' : 'fail', r ? money(prices[c.id]) : undefined);
      if (!r) return stop();
    }
    mark('available', 'run');
    if (p.availability?.state !== 'AVAILABLE') { const r = await run('Product.SetAvailability', { params: { productId: p.id }, body: { state: 'AVAILABLE', branchId } }); mark('available', r ? 'ok' : 'fail'); if (!r) return stop(); } else mark('available', 'ok');
    let itemId: string | null = null;
    if (stocking === 'RECIPE') {
      mark('recipe', 'run');
      const r = await run('Recipe.Define', { params: { recipeId: newKey('rcp') }, body: { outputProductId: p.id, outputQuantityPerBatch: '1', inputsPerBatch: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit || undefined, wastePercent: l.wastePercent || '0' })) } });
      mark('recipe', r ? 'ok' : 'fail');
      if (!r) return stop();
    }
    if (stocking === 'STOCK_ITEM') {
      mark('item', 'run');
      itemId = newKey('inv');
      const packs = stock.packName.trim() && Number(stock.packFactor) > 0 ? [{ id: `pk_${itemId}`, name: { ar: stock.packName.trim(), en: stock.packName.trim() }, factor: stock.packFactor }] : [];
      const cat = cats.items.find((c) => c.id === categoryId);
      const it = await run<any>('InventoryItem.Configure', { params: { inventoryItemId: itemId }, body: { productId: p.id, active: true, stockUnitId: stock.unitId, name: body.name, sku: p.sku, category: cat ? L(cat.name) : t('بيتباع زي ما هو'), kind: 'RESALE', packs, purchasePackId: packs[0]?.id ?? null, defaultSupplierId: stock.supplierId || null, standardCost: stock.cost || undefined, trackLots: !!stock.shelfLife, shelfLifeDays: stock.shelfLife || undefined } });
      if (!it) { mark('item', 'fail'); return stop(); }
      mark('item', 'ok');
      mark('levels', 'run');
      const rows = Object.entries(levels).filter(([, v]) => v.min !== '').map(([warehouseId, v]) => ({ warehouseId, minQuantity: v.min, parQuantity: v.par || undefined }));
      if (rows.length) { const r = await run('InventoryItem.SetLevels', { params: { inventoryItemId: itemId }, body: { levels: rows, expectedVersion: it.version } }); mark('levels', r ? 'ok' : 'fail'); if (!r) return stop(); } else mark('levels', 'skip', t('من غير حد أدنى'));
      if (first.on) {
        mark('receipt', 'run');
        const usePack = first.byPack && packs.length;
        const r = await run('GoodsReceipt.Post', { body: { supplierId: first.supplierId, warehouseId: first.warehouseId || salesWh?.id, supplierInvoiceNo: undefined, lines: [{ itemId, packId: usePack ? packs[0].id : undefined, quantity: first.quantity, unitCost: first.unitCost || (usePack ? String(Number(stock.cost || 0) * Number(stock.packFactor)) : stock.cost || '0') }] } });
        mark('receipt', r ? 'ok' : 'fail');
        if (!r) return stop();
      }
    }
    setSaving(false);
    setDone({ productId: p.id, itemId });
    onCreated?.(p.id);
  };

  const check = useQuery<any>(done ? 'Catalog.Search' : null, { query: { q: undefined, active: true, limit: 500, channel: 'DINE_IN' } });
  const onPos = done ? (check.data?.items ?? []).find((x: any) => x.id === done.productId) : null;

  const footer = done ? (
    <><Button onClick={onClose}>{t('قفل')}</Button>
      <Button data-fb="np:open-360" onClick={() => { onClose(); nav('item360', { kind: 'product', id: done.productId }); }}><ScanSearch className="w-4 h-4" />{t('صفحة الصنف')}</Button>
      <Button variant="primary" data-fb="np:open-pos" onClick={() => { onClose(); nav('counter'); }}><ShoppingCart className="w-4 h-4" />{t('بيعه في نقطة البيع')}</Button></>
  ) : (
    <>{step > 0 && !saving && <Button data-fb="np:back" onClick={() => setStep(step - 1)}><ChevronRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع')}</Button>}
      <div className="flex-1" />
      <Button onClick={onClose} disabled={saving}>{t('إلغاء')}</Button>
      {step < 4 ? <Button variant="primary" data-fb="np:next" disabled={!valid[step]} onClick={() => setStep(step + 1)}>{step === 2 && stocking !== 'STOCK_ITEM' ? t('التالي') : t('التالي')}<ChevronLeft className="w-4 h-4 ltr:rotate-180" /></Button>
        : <Button variant="success" data-fb="np:save" loading={saving} disabled={!!progress.length && !progress.some((x) => x.state === 'fail')} onClick={save}><CheckIcon className="w-4 h-4" />{progress.some((x) => x.state === 'fail') ? t('جرّب تاني') : t('احفظ ونزّله المنيو')}</Button>}</>
  );

  return (
    <Drawer width="xl" open={open} onClose={onClose} title={t('صنف جديد — خطوة بخطوة')} icon={<Sparkles className="w-5 h-5" />}
      badge={<StateBadge ops={['Product.Create', 'Catalog.SetPrice', 'Product.SetAvailability', 'Recipe.Define', 'InventoryItem.Configure', 'InventoryItem.SetLevels', 'GoodsReceipt.Post']} />}
      description={t('كل اللي يحتاجه الصنف عشان يتباع في مكان واحد: الاسم، السعر في كل قناة، الضريبة، بيتخزن إزاي، الحد الأدنى وأول استلام.')} footer={footer}>
      <div className="space-y-4" data-fb="new-product-wizard">
        <Stepper steps={steps} current={done ? 5 : step} onStep={(i) => { if (!saving && !done && i < step) setStep(i); }} />

        {step === 0 && !done && (
          <div className="space-y-3">
            <LocInputs value={name} onChange={setName} fb="np" />
            <NameCheckHint name={name} />
            <div className="text-[11px] text-dim">{t('الاسم الإنجليزي بيظهر لما الواجهة أو الإيصال يتحول إنجليزي — لو سبته فاضي بيتكتب العربي.')}</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t('القسم في المنيو')}><Select data-fb="np:category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={cats.items.map((c) => ({ value: c.id, label: L(c.name) + (c.active ? '' : ` (${t('مخفي')})`) }))} /></Field>
              <Field label={t('كود الصنف')} hint={t('سيبه فاضي يتولد أوتوماتيك')}><Input data-fb="np:sku" dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
              <Field label={t('اللون على الشاشة')}><div className="flex gap-2 items-center"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-10 h-10 rounded-lg bg-transparent border border-[var(--glass-border)]" /><Input value={color} onChange={(e) => setColor(e.target.value)} dir="ltr" /></div></Field>
            </div>
          </div>
        )}

        {step === 1 && !done && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CHANNELS.map((c) => (
                <Field key={c.id} label={t('سعر {c}', { c: t(c.ar) })} hint={c.id !== 'DINE_IN' && prices.DINE_IN && !prices[c.id] ? t('فاضي = مش هيتباع في القناة دي') : undefined}>
                  <Input data-fb={`np:price:${c.id}`} inputMode="decimal" value={prices[c.id]} onChange={(e) => setPrices({ ...prices, [c.id]: e.target.value.replace(/[^\d.]/g, '') })} placeholder={t('جنيه')} />
                </Field>
              ))}
            </div>
            {prices.DINE_IN && <Button size="sm" variant="ghost" data-fb="np:same-price" onClick={() => setPrices({ DINE_IN: prices.DINE_IN, TAKEAWAY: prices.DINE_IN, DELIVERY: prices.DINE_IN })}>{t('نفس سعر الصالة في كل القنوات')}</Button>}
            <Field label={t('مجموعة الضريبة')} hint={taxDefault?.taxPolicyId ? t('فاضي = الضريبة الافتراضية') : undefined}>
              <Select data-fb="np:tax" value={taxPolicyId} onChange={(e) => setTax(e.target.value)} options={[...(taxDefault?.taxPolicyId ? [{ value: '', label: t('— الافتراضية —') }] : []), ...taxes.items.filter((x) => x.active).map((x) => ({ value: x.id, label: `${L(x.name)} · ${x.rate}%` }))]} />
            </Field>
            <div className="text-[11px] text-dim">{t('الأسعار للفرع ده. لو السعر أول مرة أو التغيير كبير، ممكن مدير يوافق.')}</div>
          </div>
        )}

        {step === 2 && !done && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-fb="np:stocking">
              {([['RECIPE', CookingPot, 'من وصفة', 'طبق بيتعمل من خامات — كل بيعة بتسحب الخامات من مخزن البيع.'], ['STOCK_ITEM', Package, 'بيتباع زي ما هو', 'منتج جاهز (كانز، مياه، حلويات جاهزة) — له رصيد وعبوة شراء ومورد.'], ['NOT_TRACKED', CircleSlash, 'مش متتبع', 'خدمة أو حاجة مالهاش مخزون (رسوم، شيشة بالساعة…).']] as const).map(([k, Icon, ar, help]) => (
                <button key={k} type="button" data-fb={`np:stocking:${k}`} onClick={() => setStocking(k)} className={cn('rounded-xl border p-3 text-start transition-colors', stocking === k ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1 hover:surface-2')}>
                  <div className="font-bold flex items-center gap-2"><Icon className="w-4 h-4" />{t(ar)}</div><div className="text-[11px] text-dim mt-1">{t(help)}</div>
                </button>
              ))}
            </div>
            {stocking === 'RECIPE' && (
              <div className="space-y-2">
                <Table dense head={[t('الخامة'), t('الكمية لطبق واحد'), t('الوحدة'), t('هالك %'), '']} rows={lines.map((l, i) => {
                  const it = items.items.find((x) => x.id === l.itemId);
                  const set = (patch: Partial<RLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return [
                    <ItemPicker fb={`np:ing:${i}`} className="min-w-[180px]" items={items.items} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => set({ itemId: id, unit: item.unit === 'KG' ? 'unit_g' : item.unit === 'L' ? 'unit_ml' : item.stockUnitId })} />,
                    <Inp data-fb={`np:ing-qty:${i}`} className="w-20" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^\d.]/g, '') })} />,
                    it ? <Sel className="w-28" value={l.unit} onChange={(e) => set({ unit: e.target.value })} options={unitOptions(it).filter((o) => !o.value.startsWith('pk_')).map((o) => ({ value: o.value, label: o.label }))} /> : '—',
                    <Inp className="w-16" inputMode="decimal" value={l.wastePercent} onChange={(e) => set({ wastePercent: e.target.value.replace(/[^\d.]/g, '') })} />,
                    <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Trash2 className="w-3.5 h-3.5" /></Button>,
                  ];
                })} />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Button size="sm" data-fb="np:ing-add" onClick={() => setLines([...lines, { itemId: '', quantity: '', unit: '', wastePercent: '' }])}><Plus className="w-3.5 h-3.5" />{t('خامة كمان')}</Button>
                  <span className="text-sm">{t('تكلفة الطبق تقريبًا')}: <b className="num">{money(recipeCost.toFixed(4))}</b></span>
                </div>
              </div>
            )}
            {stocking === 'STOCK_ITEM' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('وحدة المخزون')}><Select data-fb="np:stock-unit" value={stock.unitId} onChange={(e) => setStock({ ...stock, unitId: e.target.value })} options={[{ value: 'unit_pcs', label: t('قطعة') }, { value: 'unit_kg', label: t('كجم') }, { value: 'unit_l', label: t('لتر') }]} /></Field>
                <Field label={t('عبوة الشراء')} hint={t('مثلًا: كرتونة 24')}><Input data-fb="np:pack-name" value={stock.packName} onChange={(e) => setStock({ ...stock, packName: e.target.value })} /></Field>
                <Field label={t('العبوة فيها كام')}><Input data-fb="np:pack-factor" inputMode="decimal" value={stock.packFactor} onChange={(e) => setStock({ ...stock, packFactor: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                <Field label={t('المورد الأساسي')}><Select data-fb="np:supplier" value={stock.supplierId} onChange={(e) => setStock({ ...stock, supplierId: e.target.value })} options={[{ value: '', label: t('بعدين') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
                <Field label={t('تكلفة الوحدة المتوقعة')}><Input data-fb="np:cost" inputMode="decimal" value={stock.cost} onChange={(e) => setStock({ ...stock, cost: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                <Field label={t('مدة الصلاحية (يوم)')} hint={t('اختياري — بيتابع الدفعات')}><Input inputMode="numeric" value={stock.shelfLife} onChange={(e) => setStock({ ...stock, shelfLife: e.target.value.replace(/\D/g, '') })} /></Field>
              </div>
            )}
            {stocking === 'NOT_TRACKED' && <Banner tone="info">{t('الصنف هيتباع عادي، بس مش هيسحب أي حاجة من المخزن — مفيش رصيد ولا تكلفة.')}</Banner>}
          </div>
        )}

        {step === 3 && !done && (
          <div className="space-y-3">
            {stocking !== 'STOCK_ITEM' ? (
              <Banner tone="info">{stocking === 'RECIPE' ? t('الطبق مالوش رصيد هو نفسه — الحد الأدنى بيتحط على الخامات. افتح صفحة أي خامة من صفحة الصنف بعد الحفظ.') : t('الصنف مش متتبع — مفيش حد أدنى ولا استلام.')}</Banner>
            ) : (
              <>
                <div className="text-sm font-bold">{t('الحد الأدنى والمستهدف')}</div>
                <div className="text-[11px] text-dim">{t('لما الرصيد يوصل للحد الأدنى بيظهر في النواقص، والطلبية بتقترح (المستهدف − الموجود).')}</div>
                <Table dense head={[t('المخزن'), t('الحد الأدنى'), t('المستهدف')]} rows={myWhs.map((w) => {
                  const v = levels[w.id] ?? { min: '', par: '' };
                  return [<span className="font-bold text-sm">{tv(w.name)}{w.salesDefault ? ' ★' : ''}</span>,
                    <Inp data-fb={`np:min:${w.id}`} className="w-24" inputMode="decimal" value={v.min} onChange={(e) => setLevels({ ...levels, [w.id]: { ...v, min: e.target.value.replace(/[^\d.]/g, '') } })} />,
                    <Inp data-fb={`np:par:${w.id}`} className="w-24" inputMode="decimal" value={v.par} onChange={(e) => setLevels({ ...levels, [w.id]: { ...v, par: e.target.value.replace(/[^\d.]/g, '') } })} />];
                })} />
                <label className="flex items-center gap-2 text-sm font-bold pt-2"><input type="checkbox" data-fb="np:first-on" checked={first.on} onChange={(e) => setFirst({ ...first, on: e.target.checked, supplierId: first.supplierId || stock.supplierId, warehouseId: first.warehouseId || salesWh?.id || '' })} />{t('سجّل أول استلام دلوقتي')}</label>
                {first.on && (
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <Field label={t('المورد')}><Select data-fb="np:first-supplier" value={first.supplierId} onChange={(e) => setFirst({ ...first, supplierId: e.target.value })} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
                    <Field label={t('يدخل مخزن')} hint={t('★ = المخزن اللي نقطة البيع بتسحب منه')}><Select value={first.warehouseId} onChange={(e) => setFirst({ ...first, warehouseId: e.target.value })} options={myWhs.map((w) => ({ value: w.id, label: `${tv(w.name)}${w.salesDefault ? ' ★' : ''}` }))} /></Field>
                    <Field label={stock.packName && Number(stock.packFactor) > 0 && first.byPack ? t('الكمية ({p})', { p: stock.packName }) : t('الكمية')}><Input data-fb="np:first-qty" inputMode="decimal" value={first.quantity} onChange={(e) => setFirst({ ...first, quantity: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                    <Field label={t('السعر')} hint={t('فاضي = التكلفة المتوقعة')}><Input inputMode="decimal" value={first.unitCost} onChange={(e) => setFirst({ ...first, unitCost: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <KV rows={[
              [t('الاسم'), <span className="inline-flex flex-wrap gap-x-2"><b>{name.ar}</b>{name.en ? <bdi dir="ltr" className="text-dim">{name.en}</bdi> : null}</span>],
              [t('القسم'), L(cats.items.find((c) => c.id === categoryId)?.name)],
              [t('الأسعار'), <span className="flex flex-wrap gap-1.5">{CHANNELS.map((c) => <Pill key={c.id} tone={prices[c.id] ? 'primary' : 'neutral'}>{t(c.ar)}: {prices[c.id] ? money(prices[c.id]) : t('مش بيتباع')}</Pill>)}</span>],
              [t('الضريبة'), taxPolicyId ? `${L(taxes.items.find((x) => x.id === taxPolicyId)?.name)} · ${taxRate}%` : t('الافتراضية')],
              [t('التخزين'), stocking === 'RECIPE' ? t('من وصفة ({n} خامة) — تكلفة تقريبًا {c}', { n: lines.filter((l) => l.itemId).length, c: money(recipeCost.toFixed(4)) }) : stocking === 'STOCK_ITEM' ? t('بيتباع زي ما هو — {u}{p}', { u: unitLabel(stock.unitId.replace('unit_', '').toUpperCase()), p: stock.packName ? ` · ${stock.packName} = ${fmtQty(stock.packFactor)}` : '' }) : t('مش متتبع')],
              ...(stocking === 'STOCK_ITEM' ? [[t('أول استلام'), first.on ? `${first.quantity} · ${tv(suppliers.items.find((s) => s.id === first.supplierId)?.name)}` : t('بعدين')] as [string, React.ReactNode]] : []),
              ...(unitCost ? [[t('تكلفة الأكل'), <span className="flex flex-wrap gap-1.5">{CHANNELS.filter((c) => prices[c.id]).map((c) => { const fc = foodCost(c.id); return <Pill key={c.id} tone={fc === null ? 'neutral' : fc > 40 ? 'error' : fc > 30 ? 'warning' : 'success'}>{t(c.ar)}: {fc === null ? '—' : `${fc.toFixed(1)}%`}</Pill>; })}</span>] as [string, React.ReactNode]] : []),
            ]} />
            {progress.length > 0 && (
              <div className="rounded-xl surface-1 border border-[var(--glass-border)] p-3 space-y-1.5" data-fb="np:progress">
                {progress.map((x) => (
                  <div key={x.key} className="flex items-center gap-2 text-sm" data-fb={`np:step:${x.key}:${x.state}`}>
                    {x.state === 'ok' ? <CheckIcon className="w-4 h-4 text-[var(--success)]" /> : x.state === 'run' ? <Loader2 className="w-4 h-4 animate-spin text-[var(--primary)]" /> : x.state === 'fail' ? <XCircle className="w-4 h-4 text-[var(--error)]" /> : <span className="w-4 h-4 rounded-full border border-[var(--glass-border)]" />}
                    <span className={cn(x.state === 'todo' && 'text-dim', x.state === 'skip' && 'text-dim line-through')}>{x.label}</span>
                    {x.note && <span className="text-[11px] text-dim num">{x.note}</span>}
                  </div>
                ))}
                {progress.some((x) => x.state === 'fail') && <div className="text-[11px] text-[var(--error)]">{t('خطوة ما نفعتش — اللي اتعمل قبلها اتحفظ. صلّح السبب وكمّل من صفحة الصنف أو شاشة المنيو.')}</div>}
              </div>
            )}
            {done && (
              <Banner tone="success" title={t('الصنف جاهز للبيع')}>
                <div data-fb="np:done" className="space-y-1">
                  {onPos ? (onPos.menuNow && onPos.menuNow.onMenu === false ? <span>{t('اتحفظ — بس مش ظاهر في نقطة البيع دلوقتي: {r}', { r: L({ ar: onPos.menuNow.reasonAr, en: onPos.menuNow.reasonEn }) })}</span> : <span className="inline-flex items-center gap-1.5"><UtensilsCrossed className="w-4 h-4" />{t('ظاهر في المنيو ونقطة البيع دلوقتي في قسم «{c}».', { c: L(cats.items.find((c) => c.id === categoryId)?.name) })}</span>) : <span>{t('بنتأكد إنه ظاهر في نقطة البيع…')}</span>}
                  <Tech><span className="num text-[11px]">{done.productId}{done.itemId ? ` · ${done.itemId}` : ''}</span></Tech>
                </div>
              </Banner>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
