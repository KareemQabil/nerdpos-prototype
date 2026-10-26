// Record waste: an ingredient ("اللبن باظ") or a whole dish ("طبق كفتة وقع" — its recipe comes out of stock).
import React, { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useCommand } from '../../app/hooks';
import { Banner, Button, Field, Input, Modal, Select, StateBadge, Textarea } from '../../ui';
import { t, L } from '../../i18n';
import { money } from '../../lib/format';
import { cn } from '../../lib/format';
import { ItemPicker, WASTE_REASONS, WASTE_REASON_TEXT, WarehouseSelect, unitOptions, useItemsCatalog, useList, useWarehouses, Sel } from './common';

export function WasteDialog({ open, onClose, presetItemId, presetWarehouseId, presetProductId }: { open: boolean; onClose: () => void; presetItemId?: string; presetWarehouseId?: string; presetProductId?: string }) {
  const { run, busy } = useCommand();
  const items = useItemsCatalog();
  const whs = useWarehouses();
  const recipes = useList<any>('Recipe.Find', { kind: 'MENU' }, open);
  const [mode, setMode] = useState<'ITEM' | 'DISH'>(presetProductId ? 'DISH' : 'ITEM');
  const [itemId, setItemId] = useState(presetItemId ?? '');
  const [productId, setProductId] = useState(presetProductId ?? '');
  const [wh, setWh] = useState(presetWarehouseId ?? '');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [reason, setReason] = useState('SPOILED');
  const [note, setNote] = useState('');
  const item = items.items.find((i) => i.id === itemId);
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.salesDefault && w.active)?.id ?? whs.items[0].id); }, [whs.items, wh]);
  useEffect(() => { if (item) setUnit(item.stockUnitId); }, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const opts = unitOptions(item);
  const factor = opts.find((o) => o.value === unit)?.factor ?? 1;
  const dish = recipes.items.find((r) => r.outputProductId === productId);
  const estimate = useMemo(() => {
    const n = Number(qty);
    if (!(n > 0)) return null;
    if (mode === 'ITEM' && item) return n * factor * Number(item.avgCost);
    if (mode === 'DISH' && dish) return n * Number(dish.cost.perUnit);
    return null;
  }, [qty, mode, item, factor, dish]);
  const submit = async () => {
    const body: any = { itemId: mode === 'ITEM' ? itemId : productId, quantity: qty, reason, warehouseId: wh, sourceType: 'MANUAL', sourceId: '', note: note || undefined };
    if (mode === 'ITEM' && unit && unit !== item?.stockUnitId) body.unit = unit;
    const r = await run('Stock.RecordWaste', { body }, { success: t('الهالك اتسجل') });
    if (r) { setQty(''); setNote(''); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} wide title={t('تسجيل هالك')} badge={<StateBadge ops={['Stock.RecordWaste']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="warning" data-fb="waste:save" loading={busy} disabled={!(Number(qty) > 0) || !wh || (mode === 'ITEM' ? !itemId : !productId)} onClick={submit}><Trash2 className="w-4 h-4" />{t('سجّل الهالك')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button data-fb="waste:mode-item" variant={mode === 'ITEM' ? 'primary' : 'secondary'} onClick={() => setMode('ITEM')}>{t('خامة أو تجهيزة')}</Button>
          <Button data-fb="waste:mode-dish" variant={mode === 'DISH' ? 'primary' : 'secondary'} onClick={() => setMode('DISH')}>{t('طبق كامل من المنيو')}</Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {mode === 'ITEM'
            ? <Field label={t('الصنف')}><ItemPicker fb="waste:item" items={items.items} value={itemId} onChange={setItemId} /></Field>
            : <Field label={t('الطبق')} hint={t('مكونات الوصفة كلها بتتخصم')}><Select data-fb="waste:dish" value={productId} onChange={(e) => setProductId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...recipes.items.map((r) => ({ value: r.outputProductId, label: L(r.name) }))]} /></Field>}
          <Field label={t('المخزن')}><WarehouseSelect fb="waste:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
          <Field label={t('الكمية')}>
            <div className="flex gap-2"><Input data-fb="waste:qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))} />
              {mode === 'ITEM' && opts.length > 1 && <Sel className="w-36" data-fb="waste:unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={opts.map((o) => ({ value: o.value, label: o.label }))} />}
              {mode === 'DISH' && <span className="self-center text-sm text-dim">{t('طبق')}</span>}
            </div>
          </Field>
          <div className="flex items-end text-sm">{estimate !== null && <span>{t('القيمة التقريبية')}: <b className="num">{money(estimate.toFixed(4))}</b></span>}</div>
        </div>
        <div>
          <div className="text-xs font-bold text-soft mb-1.5">{t('حصل إيه؟')}</div>
          <div className="flex flex-wrap gap-1.5">
            {WASTE_REASONS.map((r) => (
              <button key={r} type="button" data-fb={`waste:reason:${r}`} onClick={() => setReason(r)} className={cn('px-3 h-9 rounded-xl text-sm border', reason === r ? 'bg-[var(--warning)] text-black font-bold border-transparent' : 'surface-2 border-[var(--glass-border)]')}>{t(WASTE_REASON_TEXT[r])}</button>
            ))}
          </div>
        </div>
        <Field label={t('ملاحظة')} hint={reason === 'OTHER' ? t('لازم تكتب حصل إيه') : undefined}><Textarea data-fb="waste:note" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Banner tone="info">{t('أي هالك له قيمة بيحتاج موافقة مدير. الكمية بتتخصم من المخزن وبتظهر في تقرير الهالك.')}</Banner>
      </div>
    </Modal>
  );
}
