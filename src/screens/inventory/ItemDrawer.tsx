// Stock item drawer: balances per warehouse, units & packs, min/target levels, lots & expiry, cost history,
// where the item is used in recipes, and its movements. Adjustment and waste start from here.
import React, { useEffect, useState } from 'react';
import { Save, Plus, Trash2, SlidersHorizontal, Scale, PackagePlus } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Field, Input, KV, Modal, Money, Pill, Select, Spinner, StateBadge, Switch, Table, Tabs, Textarea } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { ADJUST_REASONS, ADJUST_REASON_TEXT, LevelPill, MovementTable, Qty, WH_KIND, fmtQty, unitLabel, useList } from './common';
import { WasteDialog } from './WasteDialog';

type Tab = 'stock' | 'setup' | 'levels' | 'lots' | 'cost' | 'recipes' | 'moves';
const OPS = ['InventoryItem.Get', 'InventoryItem.Configure', 'InventoryItem.SetLevels', 'Inventory.OnHand', 'Inventory.Adjust'];

export function ItemDrawer({ itemId, onClose, initialTab = 'stock' }: { itemId: string | null; onClose: () => void; initialTab?: Tab }) {
  const q = useQuery<any>(itemId ? 'InventoryItem.Get' : null, { params: { inventoryItemId: itemId } });
  const [tab, setTab] = useState<Tab>(initialTab);
  const [adjust, setAdjust] = useState<any | null>(null);
  const [waste, setWaste] = useState<string | null>(null);
  useEffect(() => setTab(initialTab), [itemId, initialTab]);
  const it = q.data;
  return (
    <Modal open={!!itemId} onClose={onClose} xwide title={it ? <span className="flex items-center gap-2">{L(it.name)} <span className="text-sm text-dim">{it.category}</span></span> : t('صنف مخزن')}
      badge={<>{it && !it.active && <Pill tone="neutral">{t('موقوف')}</Pill>}{it?.kind === 'PREP' && <Pill tone="violet">{t('تجهيزة مطبخ')}</Pill>}{it?.kind === 'RESALE' && <Pill tone="info">{t('بيتباع زي ما هو')}</Pill>}<StateBadge ops={OPS} /></>}>
      {!it ? <Spinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Box label={t('الرصيد في كل المخازن')} value={<Qty v={it.totalQuantity} unit={it.unit} />} />
            <Box label={t('متوسط التكلفة')} value={<span className="num">{money(it.avgCost)}</span>} sub={t('لكل {u}', { u: unitLabel(it.unit) })} />
            <Box label={t('آخر سعر شراء')} value={<span className="num">{money(it.lastCost)}</span>} />
            <Box label={t('قيمة المخزون')} value={<Money v={String(Number(it.totalQuantity) * Number(it.avgCost))} />} />
          </div>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: 'stock', label: t('الرصيد') }, { id: 'setup', label: t('البيانات والعبوات') }, { id: 'levels', label: t('الحد الأدنى') },
            { id: 'lots', label: t('الصلاحية ({n})', { n: it.lots.length }) }, { id: 'cost', label: t('التكلفة') }, { id: 'recipes', label: t('الوصفات ({n})', { n: it.whereUsed.length }) }, { id: 'moves', label: t('الحركات') },
          ]} />
          {tab === 'stock' && (
            <Table head={[t('المخزن'), t('الرصيد'), t('الحد الأدنى / المستهدف'), t('الحالة'), t('القيمة'), '']} rows={it.balances.filter((b: any) => b.active || Number(b.quantity) !== 0).map((b: any) => [
              <span><span className="font-bold">{b.warehouse.name}</span> <span className="text-xs text-dim">{b.warehouse.branchName}</span>{b.salesDefault && <Pill tone="primary" className="ms-1">{t('مخزن البيع')}</Pill>}</span>,
              <Qty v={b.quantity} unit={it.unit} />,
              b.level ? <span className="num text-xs">{fmtQty(b.level.min)} / {fmtQty(b.level.par)}</span> : <span className="text-dim text-xs">—</span>,
              <LevelPill state={b.state} />,
              <Money v={b.value} className="text-xs" />,
              <div className="flex gap-1 justify-end">
                <Button size="sm" data-fb={`item:adjust:${b.warehouse.id}`} onClick={() => setAdjust(b)}><SlidersHorizontal className="w-3.5 h-3.5" />{t('تسوية')}</Button>
                <Button size="sm" variant="warning" data-fb={`item:waste:${b.warehouse.id}`} onClick={() => setWaste(b.warehouse.id)}><Trash2 className="w-3.5 h-3.5" />{t('هالك')}</Button>
              </div>,
            ])} />
          )}
          {tab === 'setup' && <SetupTab it={it} />}
          {tab === 'levels' && <LevelsTab it={it} />}
          {tab === 'lots' && (
            <Table empty={it.trackLots ? t('مفيش دفعات فيها رصيد') : t('الصنف ده مش متتبع بالصلاحية — فعّلها من "البيانات والعبوات"')} head={[t('الدفعة'), t('المخزن'), t('اتستلمت'), t('تاريخ الصلاحية'), t('الباقي')]} rows={it.lots.map((l: any) => {
              const days = l.expiryDate ? Math.round((Date.parse(l.expiryDate) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000) : null;
              return [<span className="num text-xs">{l.lotCode}</span>, l.warehouse.name, <span className="text-xs">{dateTime(l.receivedAt)}</span>,
                l.expiryDate ? <span className="inline-flex items-center gap-1.5"><span className="num">{l.expiryDate}</span>{days !== null && days < 0 ? <Pill tone="error">{t('انتهت')}</Pill> : days !== null && days <= 2 ? <Pill tone="warning">{days === 0 ? t('النهارده') : t('فاضل {n} يوم', { n: days })}</Pill> : null}</span> : '—',
                <Qty v={l.remaining} unit={it.unit} />];
            })} />
          )}
          {tab === 'cost' && (
            <div className="space-y-3">
              <Banner tone="info">{t('التكلفة بمتوسط مرجّح: كل استلام بسعر جديد بيغيّر المتوسط حسب الكمية. الحركات الخارجة (بيع، هالك، تحويل) بتتسعّر بالمتوسط وقتها.')}</Banner>
              {it.kind === 'PREP' && <KV rows={[[t('تكلفة الوصفة دلوقتي (نظري)'), money(it.theoreticalCost)]]} />}
              <Table empty={t('لسه مفيش تغيير في التكلفة')} head={[t('إمتى'), t('السبب'), t('سعر الحركة'), t('المتوسط بعدها')]} rows={it.costHistory.map((h: any) => [<span className="text-xs">{dateTime(h.at)}</span>, <span className="text-xs">{({ RECEIPT: t('استلام'), OPENING: t('رصيد أول المدة'), PRODUCTION_IN: t('تحضير'), ADJUSTMENT: t('تسوية بسعر'), RECEIPT_REVERSAL: t('إلغاء استلام'), SUPPLIER_RETURN: t('مرتجع مورد') } as Record<string, string>)[h.source] ?? h.source} <span className="num text-dim">{h.ref}</span></span>, <span className="num">{money(h.unitCost)}</span>, <span className="num font-bold">{money(h.avgCost)}</span>])} />
            </div>
          )}
          {tab === 'recipes' && (
            <div className="space-y-3">
              {it.producedBy && <Banner tone="info">{t('الصنف ده بيتعمل في المطبخ بوصفة تحضير — شوفه في شاشة "التحضير".')}</Banner>}
              <Table empty={t('الصنف ده مش داخل في أي وصفة')} head={[t('الوصفة'), t('النوع'), t('الكمية')]} rows={it.whereUsed.map((w: any) => [<span className="font-bold">{L(w.name)}</span>, <Pill tone={w.kind === 'MENU' ? 'primary' : w.kind === 'PREP' ? 'violet' : 'neutral'}>{w.kind === 'MENU' ? t('صنف منيو') : w.kind === 'PREP' ? t('تحضير') : t('إضافة')}</Pill>, <span className="num">{fmtQty(w.enteredQuantity)} {w.enteredUnit === 'unit_g' ? t('جم') : w.enteredUnit === 'unit_ml' ? t('مل') : unitLabel(it.unit)}{w.kind === 'PREP' ? ` / ${fmtQty(w.perBatch)}` : ''}</span>])} />
            </div>
          )}
          {tab === 'moves' && <MovementTable items={it.movements} showItem={false} compact />}
          <Tech><div className="text-[11px] num text-dim">{it.id} · productId {it.productId} · v{it.version}</div></Tech>
        </div>
      )}
      {it && adjust && <AdjustDialog item={it} balance={adjust} onClose={() => setAdjust(null)} />}
      {it && waste && <WasteDialog open onClose={() => setWaste(null)} presetItemId={it.id} presetWarehouseId={waste} />}
    </Modal>
  );
}

function Box({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="rounded-xl surface-1 p-3"><div className="text-[11px] text-dim">{label}</div><div className="font-bold mt-0.5">{value}</div>{sub && <div className="text-[10px] text-dim">{sub}</div>}</div>;
}

export function AdjustDialog({ item, balance, onClose }: { item: any; balance: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [dir, setDir] = useState<'IN' | 'OUT'>('OUT');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<string>('DAMAGED');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const n = Number(qty);
  const after = Number(balance.quantity) + (dir === 'IN' ? n : -n);
  const submit = async () => {
    const r = await run('Inventory.Adjust', { body: { inventoryItemId: item.id, warehouseId: balance.warehouse.id, quantityDelta: dir === 'IN' ? qty : `-${qty}`, reason, stockUnitId: item.stockUnitId, expectedItemVersion: item.version, expectedVersion: balance.version, unitCost: dir === 'IN' && cost ? cost : undefined, note: note || undefined } }, { success: t('التسوية اتسجلت') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('تسوية رصيد — {n}', { n: L(item.name) })} badge={<StateBadge ops={['Inventory.Adjust']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="adjust:save" loading={busy} disabled={!(n > 0)} onClick={submit}><Save className="w-4 h-4" />{t('سجّل التسوية')}</Button></>}>
      <div className="space-y-3">
        <KV rows={[[t('المخزن'), balance.warehouse.name], [t('الرصيد دلوقتي'), <Qty v={balance.quantity} unit={item.unit} />]]} />
        <div className="grid grid-cols-2 gap-2">
          <Button data-fb="adjust:out" variant={dir === 'OUT' ? 'danger' : 'secondary'} onClick={() => { setDir('OUT'); setReason('DAMAGED'); }}>{t('نقص من الرصيد')}</Button>
          <Button data-fb="adjust:in" variant={dir === 'IN' ? 'success' : 'secondary'} onClick={() => { setDir('IN'); setReason('FOUND'); }}>{t('زيادة على الرصيد')}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('الكمية ({u})', { u: unitLabel(item.unit) })}><Input data-fb="adjust:qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label={t('السبب')}><Select data-fb="adjust:reason" value={reason} onChange={(e) => setReason(e.target.value)} options={ADJUST_REASONS.map((r) => ({ value: r, label: t(ADJUST_REASON_TEXT[r]) }))} /></Field>
          {dir === 'IN' && <Field label={t('سعر الوحدة (اختياري)')} hint={t('لو فاضي بتتسعر بمتوسط التكلفة')}><Input data-fb="adjust:cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={money(item.avgCost, false)} /></Field>}
        </div>
        <Field label={t('ملاحظة')} hint={reason === 'OTHER' ? t('لازم تكتب السبب') : undefined}><Textarea data-fb="adjust:note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {n > 0 && <Banner tone={after < 0 ? 'error' : 'info'}>{t('الرصيد هيبقى')} <b className="num">{fmtQty(after)} {unitLabel(item.unit)}</b> · {t('القيمة')} <b className="num">{money(String((dir === 'IN' ? 1 : -1) * n * Number(cost || item.avgCost)))}</b></Banner>}
        <Banner tone="warning">{t('أي تسوية بتحتاج موافقة مدير تاني (مش اللي بيسجل)، وبتتسجل في السجل باسمكم الاتنين.')}</Banner>
      </div>
    </Modal>
  );
}

function SetupTab({ it }: { it: any }) {
  const { run, busy } = useCommand();
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const [d, setD] = useState(() => ({ nameAr: it.name.ar, nameEn: it.name.en, sku: it.sku, category: it.category, kind: it.kind, packs: it.packs.map((p: any) => ({ ...p, nameAr: p.name.ar })), purchasePackId: it.purchasePackId ?? '', defaultSupplierId: it.defaultSupplierId ?? '', trackLots: it.trackLots, shelfLifeDays: it.shelfLifeDays ? String(it.shelfLifeDays) : '', allowNegative: it.allowNegative === null ? '' : String(it.allowNegative), active: it.active }));
  const save = () => run('InventoryItem.Configure', { params: { inventoryItemId: it.id }, body: {
    productId: it.productId, stockUnitId: it.stockUnitId, active: d.active, expectedVersion: it.version, name: { ar: d.nameAr, en: d.nameEn }, sku: d.sku, category: d.category, kind: d.kind,
    packs: d.packs.filter((p: any) => p.nameAr.trim()).map((p: any) => ({ id: p.id, name: { ar: p.nameAr, en: p.name?.en ?? '' }, factor: p.factor })), purchasePackId: d.purchasePackId || null,
    defaultSupplierId: d.defaultSupplierId || null, trackLots: d.trackLots, shelfLifeDays: d.shelfLifeDays ? Number(d.shelfLifeDays) : null, allowNegative: d.allowNegative === '' ? null : d.allowNegative === 'true',
  } }, { success: t('بيانات الصنف اتحفظت') });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t('الاسم بالعربي')}><Input data-fb="item:name-ar" value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} /></Field>
        <Field label={t('الاسم بالإنجليزي')}><Input dir="ltr" value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} /></Field>
        <Field label={t('الكود')}><Input dir="ltr" value={d.sku} onChange={(e) => setD({ ...d, sku: e.target.value })} /></Field>
        <Field label={t('المجموعة')}><Input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} /></Field>
        <Field label={t('نوع الصنف')}><Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} options={[{ value: 'RAW', label: t('خامة') }, { value: 'PREP', label: t('تجهيزة بتتعمل في المطبخ') }, { value: 'RESALE', label: t('بيتباع زي ما هو (كانز، مياه)') }]} /></Field>
        <Field label={t('وحدة المخزن')} hint={t('ثابتة بعد أول حركة')}><Input disabled value={unitLabel(it.unit)} /></Field>
        <Field label={t('المورد المعتاد')}><Select value={d.defaultSupplierId} onChange={(e) => setD({ ...d, defaultSupplierId: e.target.value })} options={[{ value: '', label: t('مفيش') }, ...suppliers.items.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label={t('الرصيد بالسالب')}><Select value={d.allowNegative} onChange={(e) => setD({ ...d, allowNegative: e.target.value })} options={[{ value: '', label: t('حسب إعداد المطعم') }, { value: 'true', label: t('مسموح للصنف ده') }, { value: 'false', label: t('ممنوع للصنف ده') }]} /></Field>
        <div className="flex flex-col gap-2 justify-end"><Switch checked={d.active} onChange={(v) => setD({ ...d, active: v })} label={t('الصنف شغال')} /></div>
      </div>
      <div className="rounded-xl surface-1 p-3 space-y-2">
        <div className="flex items-center justify-between"><div className="font-bold text-sm">{t('عبوات الشراء')}</div><Button size="sm" data-fb="item:add-pack" onClick={() => setD({ ...d, packs: [...d.packs, { id: `pk_${it.id}_${d.packs.length + 1}_${Date.now().toString(36)}`, nameAr: '', factor: '1', name: { en: '' } }] })}><PackagePlus className="w-3.5 h-3.5" />{t('عبوة')}</Button></div>
        <div className="text-xs text-dim">{t('مثال: شيكارة دقيق 25 كجم — بتشتري بالشيكارة والمخزن بيعد بالكيلو.')}</div>
        {d.packs.map((p: any, i: number) => (
          <div key={p.id} className="grid grid-cols-[1fr_140px_auto_auto] gap-2 items-center">
            <Input value={p.nameAr} placeholder={t('اسم العبوة')} onChange={(e) => setD({ ...d, packs: d.packs.map((x: any, j: number) => (j === i ? { ...x, nameAr: e.target.value } : x)) })} />
            <div className="flex items-center gap-1"><Input inputMode="decimal" value={p.factor} onChange={(e) => setD({ ...d, packs: d.packs.map((x: any, j: number) => (j === i ? { ...x, factor: e.target.value } : x)) })} /><span className="text-xs text-dim">{unitLabel(it.unit)}</span></div>
            <label className="text-xs flex items-center gap-1"><input type="radio" checked={d.purchasePackId === p.id} onChange={() => setD({ ...d, purchasePackId: p.id })} />{t('للشراء')}</label>
            <Button size="sm" variant="ghost" onClick={() => setD({ ...d, packs: d.packs.filter((_: any, j: number) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>
      <div className="rounded-xl surface-1 p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <Switch checked={d.trackLots} onChange={(v) => setD({ ...d, trackLots: v })} label={t('متابعة الصلاحية بالدفعات')} />
        <Field label={t('مدة الصلاحية الافتراضية (أيام)')} hint={t('بتتحط لوحدها وقت الاستلام لو مفيش تاريخ')}><Input inputMode="numeric" value={d.shelfLifeDays} onChange={(e) => setD({ ...d, shelfLifeDays: e.target.value.replace(/\D/g, '') })} /></Field>
      </div>
      <div className="flex justify-end"><Button variant="primary" data-fb="item:save" loading={busy} onClick={save}><Save className="w-4 h-4" />{t('حفظ')}</Button></div>
    </div>
  );
}

function LevelsTab({ it }: { it: any }) {
  const { run, busy } = useCommand();
  const [rows, setRows] = useState(() => it.balances.filter((b: any) => b.active).map((b: any) => ({ warehouseId: b.warehouse.id, name: b.warehouse.name, branch: b.warehouse.branchName, kind: b.warehouse.kind, min: b.level?.min ?? '', par: b.level?.par ?? '', qty: b.quantity })));
  const save = () => run('InventoryItem.SetLevels', { params: { inventoryItemId: it.id }, body: { expectedVersion: it.version, levels: rows.map((r: any) => ({ warehouseId: r.warehouseId, minQuantity: r.min === '' ? null : r.min, parQuantity: r.par === '' ? undefined : r.par })) } }, { success: t('الحدود اتحفظت') });
  return (
    <div className="space-y-3">
      <Banner tone="info">{t('الحد الأدنى: لو الرصيد وصله أو قل عنه، الصنف بيظهر في "النواقص". المستهدف: الكمية اللي بنكمّل لها لما نطلب من المورد.')}</Banner>
      <Table head={[t('المخزن'), t('الرصيد'), t('الحد الأدنى'), t('المستهدف')]} rows={rows.map((r: any, i: number) => [
        <span><span className="font-bold">{r.name}</span> <span className="text-xs text-dim">{t(WH_KIND[r.kind] ?? r.kind)} · {r.branch}</span></span>,
        <Qty v={r.qty} unit={it.unit} />,
        <Input data-fb={`levels:min:${r.warehouseId}`} className="w-28" inputMode="decimal" value={r.min} placeholder={t('مفيش')} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, min: e.target.value } : x)))} />,
        <Input data-fb={`levels:par:${r.warehouseId}`} className="w-28" inputMode="decimal" value={r.par} onChange={(e) => setRows(rows.map((x: any, j: number) => (j === i ? { ...x, par: e.target.value } : x)))} />,
      ])} />
      <div className="flex justify-end"><Button variant="primary" data-fb="levels:save" loading={busy} onClick={save}><Scale className="w-4 h-4" />{t('حفظ الحدود')}</Button></div>
    </div>
  );
}

export function NewItemDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { run, busy } = useCommand();
  const units = useList<any>('Unit.List');
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const products = useList<any>('Catalog.Search', { active: 'true' });
  const [d, setD] = useState({ nameAr: '', nameEn: '', category: '', unit: 'unit_kg', kind: 'RAW', packName: '', packFactor: '', supplier: '', cost: '', productId: '', trackLots: false, shelf: '' });
  const stockUnits = units.items.filter((u) => ['KG', 'G', 'L', 'ML', 'PCS', 'DEMO_EA'].includes(u.code) || u.id.startsWith('unit_'));
  const save = async () => {
    const id = `inv_${Date.now().toString(36)}`;
    const r = await run<any>('InventoryItem.Configure', { params: { inventoryItemId: id }, body: {
      productId: d.kind === 'RESALE' && d.productId ? d.productId : id, stockUnitId: d.unit, active: true, name: { ar: d.nameAr, en: d.nameEn }, category: d.category, kind: d.kind,
      packs: d.packName ? [{ name: { ar: d.packName }, factor: d.packFactor }] : [], defaultSupplierId: d.supplier || null, standardCost: d.cost || undefined, trackLots: d.trackLots, shelfLifeDays: d.shelf ? Number(d.shelf) : null,
    } }, { success: t('الصنف اتضاف للمخزن') });
    if (r) { onClose(); onCreated?.(r.id); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title={t('صنف مخزن جديد')} badge={<StateBadge ops={['InventoryItem.Configure']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="new-item:save" loading={busy} disabled={!d.nameAr.trim()} onClick={save}><Plus className="w-4 h-4" />{t('ضيف الصنف')}</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('الاسم بالعربي')}><Input data-fb="new-item:name" value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} placeholder={t('مثال: رز مصري')} /></Field>
        <Field label={t('الاسم بالإنجليزي')}><Input dir="ltr" value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} /></Field>
        <Field label={t('المجموعة')}><Input value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} placeholder={t('بقوليات وحبوب')} /></Field>
        <Field label={t('نوع الصنف')}><Select data-fb="new-item:kind" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} options={[{ value: 'RAW', label: t('خامة') }, { value: 'PREP', label: t('تجهيزة بتتعمل في المطبخ') }, { value: 'RESALE', label: t('بيتباع زي ما هو') }]} /></Field>
        {d.kind === 'RESALE' && <Field label={t('صنف المنيو المربوط')} hint={t('كل بيعة للصنف ده بتسحب واحدة من المخزن')}><Select value={d.productId} onChange={(e) => setD({ ...d, productId: e.target.value })} options={[{ value: '', label: t('اختار') }, ...products.items.map((p) => ({ value: p.id, label: L(p.name) }))]} /></Field>}
        <Field label={t('وحدة المخزن')}><Select data-fb="new-item:unit" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} options={stockUnits.map((u) => ({ value: u.id, label: unitLabel(u.code) }))} /></Field>
        <Field label={t('عبوة الشراء (اختياري)')}><Input value={d.packName} onChange={(e) => setD({ ...d, packName: e.target.value })} placeholder={t('شيكارة 10 كجم')} /></Field>
        <Field label={t('العبوة فيها كام وحدة')}><Input inputMode="decimal" value={d.packFactor} onChange={(e) => setD({ ...d, packFactor: e.target.value })} placeholder="10" /></Field>
        <Field label={t('المورد المعتاد')}><Select value={d.supplier} onChange={(e) => setD({ ...d, supplier: e.target.value })} options={[{ value: '', label: t('مفيش') }, ...suppliers.items.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label={t('تكلفة مبدئية للوحدة')} hint={t('لحد أول استلام')}><Input inputMode="decimal" value={d.cost} onChange={(e) => setD({ ...d, cost: e.target.value })} /></Field>
        <div className="flex items-end"><Switch checked={d.trackLots} onChange={(v) => setD({ ...d, trackLots: v })} label={t('متابعة الصلاحية')} /></div>
        {d.trackLots && <Field label={t('مدة الصلاحية (أيام)')}><Input inputMode="numeric" value={d.shelf} onChange={(e) => setD({ ...d, shelf: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}
