// Waste & adjustments: waste with plain reasons ("اتحرق"، "انتهت صلاحيته"، "وقع"), manual adjustments with reason
// codes, and customer returns (restock or discard). Every one is a stock movement with value and approval.
import React, { useState } from 'react';
import { Plus, Trash2, SlidersHorizontal, Undo2 } from 'lucide-react';
import { useCommand, useQuery } from '../../app/hooks';
import { Banner, Button, Empty, Field, Input, Modal, Money, Pill, Section, Select, Spinner, StateBadge, Table, Tabs, EmptyState } from '../../ui';
import { t, L, tv } from '../../i18n';
import { dateTime } from '../../lib/format';
import { BranchScope, ItemPicker, MovementTable, Qty, WASTE_REASONS, WASTE_REASON_TEXT, WarehouseSelect, reasonText, useBranchScope, useItemsCatalog, useList, useWarehouses } from './common';
import { WasteDialog } from './WasteDialog';
import { AdjustDialog } from './ItemDrawer';
import { personText } from '../../demo/people';

const OPS = ['Stock.RecordWaste', 'Waste.Find', 'Inventory.Adjust', 'Stock.RecordReturn', 'Movement.Find'];
type Tab = 'waste' | 'adjust' | 'returns';

export default function WasteScreen() {
  const [tab, setTab] = useState<Tab>('waste');
  const scope = useBranchScope();
  return (
    <div>
      <Section title={t('الهالك والتسويات')} badge={<StateBadge ops={OPS} />} sub={t('اللي اتحرق أو باظ أو وقع، التسويات اليدوية، ومرتجعات الزباين — كل واحدة بقيمتها وسببها ومين وافق.')} actions={<BranchScope scope={scope} />} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'waste', label: t('الهالك') }, { id: 'adjust', label: t('التسويات') }, { id: 'returns', label: t('مرتجعات الزباين') }]} />
      {tab === 'waste' && <WasteTab branchId={scope.branchId} />}
      {tab === 'adjust' && <AdjustTab branchId={scope.branchId} />}
      {tab === 'returns' && <ReturnsTab branchId={scope.branchId} />}
    </div>
  );
}

function WasteTab({ branchId }: { branchId?: string }) {
  const whs = useWarehouses();
  const [reason, setReason] = useState('');
  const [wh, setWh] = useState('');
  const [open, setOpen] = useState(false);
  const q = useList<any>('Waste.Find', { branchId, reason: reason || undefined, warehouseId: wh || undefined });
  const byReason = new Map<string, number>();
  for (const w of q.items) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + Number(w.value));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('السبب')} className="w-48"><Select data-fb="waste-list:reason" value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: '', label: t('كل الأسباب') }, ...WASTE_REASONS.map((r) => ({ value: r, label: t(WASTE_REASON_TEXT[r]) }))]} /></Field>
        <Field label={t('المخزن')} className="w-52"><WarehouseSelect value={wh} onChange={setWh} warehouses={whs.items} includeAll={t('كل المخازن')} activeOnly={false} /></Field>
        <div className="flex-1" />
        <div className="text-sm">{t('الإجمالي')}: <Money v={q.raw?.totalValue} tone="error" /></div>
        <Button variant="warning" data-fb="waste-list:new" onClick={() => setOpen(true)}><Trash2 className="w-4 h-4" />{t('تسجيل هالك')}</Button>
      </div>
      {byReason.size > 0 && <div className="flex flex-wrap gap-1.5">{[...byReason].sort((a, b) => b[1] - a[1]).map(([r, v]) => <Pill key={r} tone="warning">{reasonText(r)} · <span className="num">{v.toFixed(2)}</span></Pill>)}</div>}
      <Table loading={q.loading && !q.raw} empty={<EmptyState compact icon={<Trash2 />} title={t('مفيش هالك متسجل')} />} head={[t('إمتى'), t('الصنف'), t('الكمية'), t('السبب'), t('المخزن'), t('القيمة'), t('مين'), t('وافق')]} rows={q.items.map((w) => [
          <span className="text-xs">{dateTime(w.at)} <span className="num text-dim">{w.number}</span></span>,
          <div><div className="font-bold">{L(w.name)} {w.itemKind === 'PRODUCT' && <Pill tone="info">{t('طبق')}</Pill>}</div>{w.lines?.length > 0 && <div className="text-[11px] text-dim">{w.lines.map((x: any) => `${L(x.name)} ${x.quantity}`).join(t('، '))}</div>}{tv(w.note) && <div className="text-[11px] text-dim">{tv(w.note)}</div>}</div>,
          w.itemKind === 'PRODUCT' ? <span className="num">{w.quantity} {t('طبق')}</span> : <Qty v={w.quantity} unit={w.unit} />,
          <Pill tone="warning">{reasonText(w.reason)}</Pill>,
          <span className="text-xs">{tv(w.warehouse.name)}</span>,
          <Money v={w.value} tone="error" className="text-xs" />,
          <span className="text-xs">{personText(w.userName)}</span>,
          <span className="text-xs text-dim">{personText(w.approverName) ?? '—'}</span>,
        ])} />
      <WasteDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function AdjustTab({ branchId }: { branchId?: string }) {
  const q = useList<any>('Movement.Find', { branchId, kind: 'ADJUSTMENT', limit: 200 });
  const [pick, setPick] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <Banner tone="info">{t('التسوية للحالات اللي مش هالك ومش جرد: تصحيح إدخال غلط، حاجة اتلقت أو ضاعت، استهلاك العاملين. كل تسوية بموافقة مدير تاني.')}</Banner>
        <Button variant="primary" data-fb="adjust-list:new" onClick={() => setPick(true)}><SlidersHorizontal className="w-4 h-4" />{t('تسوية جديدة')}</Button>
      </div>
      {q.loading && !q.raw ? <Spinner /> : <MovementTable items={q.items} empty={t('مفيش تسويات')} />}
      {pick && <PickForAdjust onClose={() => setPick(false)} />}
    </div>
  );
}
function PickForAdjust({ onClose }: { onClose: () => void }) {
  const items = useItemsCatalog();
  const whs = useWarehouses();
  const [itemId, setItemId] = useState('');
  const [wh, setWh] = useState('');
  const it = useQuery<any>(itemId ? 'InventoryItem.Get' : null, { params: { inventoryItemId: itemId } });
  const bal = it.data?.balances.find((b: any) => b.warehouse.id === wh);
  if (it.data && bal) return <AdjustDialog item={it.data} balance={bal} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title={t('تسوية جديدة')} badge={<StateBadge ops={['Inventory.Adjust']} />}>
      <div className="space-y-3">
        <Field label={t('الصنف')}><ItemPicker fb="adjust-pick:item" items={items.items} value={itemId} onChange={setItemId} /></Field>
        <Field label={t('المخزن')}><WarehouseSelect fb="adjust-pick:warehouse" value={wh} onChange={setWh} warehouses={whs.items} includeAll={t('اختار')} /></Field>
        {itemId && wh && !bal && <Spinner />}
      </div>
    </Modal>
  );
}

function ReturnsTab({ branchId }: { branchId?: string }) {
  const q = useList<any>('Waste.Find', { branchId });
  const [open, setOpen] = useState(false);
  const list: any[] = q.raw?.customerReturns ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <Banner tone="info">{t('لما زبون يرجّع صنف: لو ينفع يرجع المخزن (كانز، مياه مقفولة) اختار "يرجع المخزن". الأكل اللي اتعمل بيتسجل "يترمي" — مفيش حركة مخزن لأنه اتسحب وقت البيع.')}</Banner>
        <Button variant="primary" data-fb="returns:new" onClick={() => setOpen(true)}><Undo2 className="w-4 h-4" />{t('تسجيل مرتجع')}</Button>
      </div>
      <Table empty={t('مفيش مرتجعات')} head={[t('إمتى'), t('الشيك'), t('الصنف'), t('الكمية'), t('مصيره'), t('القيمة'), t('مين')]} rows={list.map((r) => [
        <span className="text-xs">{dateTime(r.at)}</span>, <span className="num">{r.orderNumber}</span>, <span className="font-bold">{L(r.name)}</span>, <span className="num">{r.quantity}</span>,
        r.disposition === 'RESTOCK' ? <Pill tone="success">{t('رجع المخزن')}</Pill> : <Pill tone="warning">{t('اترمى')}</Pill>, <Money v={r.value} className="text-xs" />, <span className="text-xs">{personText(r.userName)}</span>,
      ])} />
      {open && <ReturnDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
function ReturnDialog({ onClose }: { onClose: () => void }) {
  const { run, busy } = useCommand();
  const [num, setNum] = useState('');
  const orders = useList<any>('Order.Find', { lifecycle: 'COMPLETED,CONFIRMED', number: num || undefined, limit: 20 });
  const [orderId, setOrderId] = useState('');
  const [lineId, setLineId] = useState('');
  const [qty, setQty] = useState('1');
  const [disp, setDisp] = useState<'RESTOCK' | 'DISCARD'>('DISCARD');
  const o = orders.items.find((x) => x.id === orderId);
  const lines = (o?.lines ?? []).filter((l: any) => l.status === 'ACTIVE');
  const save = async () => {
    const r = await run('Stock.RecordReturn', { body: { orderId, orderLineId: lineId, quantity: qty, disposition: disp } }, { success: t('المرتجع اتسجل') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} wide title={t('مرتجع من زبون')} badge={<StateBadge ops={['Stock.RecordReturn']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="return:save" loading={busy} disabled={!orderId || !lineId || !(Number(qty) > 0)} onClick={save}><Undo2 className="w-4 h-4" />{t('سجّل')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('رقم الشيك')}><Input data-fb="return:number" value={num} onChange={(e) => setNum(e.target.value)} placeholder={t('اكتب جزء من الرقم')} /></Field>
        <div className="max-h-40 overflow-y-auto rounded-xl surface-1 p-1">
          {orders.items.length === 0 && <div className="text-xs text-dim p-2">{t('مفيش شيكات متأكدة أو مقفولة بالرقم ده')}</div>}
          {orders.items.map((x) => <button key={x.id} data-fb={`return:order:${x.id}`} onClick={() => { setOrderId(x.id); setLineId(''); }} className={`w-full text-start px-2 py-1.5 rounded-lg text-sm flex justify-between ${orderId === x.id ? 'surface-2 font-bold' : 'hover:surface-2'}`}><span className="num">{x.number}</span><span className="text-xs text-dim">{dateTime(x.createdAt)} · {x.lines.filter((l: any) => l.status === 'ACTIVE').length} {t('صنف')}</span></button>)}
        </div>
        {o && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label={t('الصنف')}><Select data-fb="return:line" value={lineId} onChange={(e) => setLineId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...lines.map((l: any) => ({ value: l.id, label: `${L(l.name)} × ${l.quantity}` }))]} /></Field>
            <Field label={t('الكمية')}><Input data-fb="return:qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label={t('مصيره')}><Select data-fb="return:disposition" value={disp} onChange={(e) => setDisp(e.target.value as any)} options={[{ value: 'DISCARD', label: t('يترمي') }, { value: 'RESTOCK', label: t('يرجع المخزن') }]} /></Field>
          </div>
        )}
        <Banner tone="info">{t('الفلوس بترجع للزبون من شاشة "المرتجعات" — هنا بنسجل مصير البضاعة بس.')}</Banner>
      </div>
    </Modal>
  );
}
