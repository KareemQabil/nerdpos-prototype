// Goods receipts & supplier returns: receive against a purchase order or without one (market buys), with packs,
// cost, lot and expiry; reverse a wrong receipt (manager approval); send damaged goods back to the supplier.
import React, { useEffect, useState } from 'react';
import { Plus, PackageCheck, Undo2, RotateCcw, Trash2, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, DetailPane, Empty, Field, Input, KV, MasterDetail, Money, Pill, Popup, Section, Select, Spinner, StateBadge, Table, DataTable, cols, DateTime, Tabs, Textarea, EmptyState } from '../../ui';
import { FullPage } from './purchasingLayout';
import { t, L, tv, tLabel } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { sumLines } from '../../lib/cash';
import { BranchScope, ItemPicker, Qty, WarehouseSelect, fmtQty, unitLabel, useBranchScope, useItemsCatalog, useList, useWarehouses, Inp, Sel } from './common';
import { personText } from '../../demo/people';
import { ChainView } from './Chain';
import { InvoiceButton } from './Purchasing';

const OPS = ['GoodsReceipt.Post', 'GoodsReceipt.Find', 'GoodsReceipt.Get', 'GoodsReceipt.Reverse', 'SupplierReturn.Post', 'SupplierReturn.Find'];

export default function Receipts() {
  const { params } = useDev();
  const [tab, setTab] = useState<'gr' | 'sr'>('gr');
  const scope = useBranchScope();
  // ux-05: a receipt opens beside the list (wide) or as a full page (narrow) — ux-06 MasterDetail / DetailPane
  const [open, setOpen] = useState<string | null>(params?.open ?? null);
  useEffect(() => { if (params?.open) setOpen(params.open); }, [params?.open]);
  return (
    <MasterDetail fb="receipts" open={tab === 'gr' && !!open} detail={open && <ReceiptView id={open} onClose={() => setOpen(null)} />} list={<div>
      <Section title={t('الاستلام ومرتجع الموردين')} badge={<StateBadge ops={OPS} />} sub={t('استلام البضاعة (على أمر شراء أو من السوق)، بسعرها وتاريخ صلاحيتها — بيحدّث الرصيد ومتوسط التكلفة. والمرتجع للمورد للبضاعة التالفة.')} actions={<BranchScope scope={scope} />} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'gr', label: t('أذون الاستلام') }, { id: 'sr', label: t('مرتجعات الموردين') }]} />
      {tab === 'gr' ? <ReceiptList branchId={scope.branchId} autoNew={!!params?.newReceipt} setOpen={setOpen} /> : <ReturnList branchId={scope.branchId} />}
    </div>} />
  );
}

function ReceiptList({ branchId, autoNew, setOpen }: { branchId?: string; autoNew: boolean; setOpen: (id: string | null) => void }) {
  const suppliers = useList<any>('Supplier.List');
  const [supplier, setSupplier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useList<any>('GoodsReceipt.Find', { branchId, supplierId: supplier || undefined, businessDateFrom: from || undefined, businessDateTo: to || undefined });
  const [creating, setCreating] = useState(autoNew);
  useEffect(() => { if (autoNew) setCreating(true); }, [autoNew]);
  const RC = cols<any>();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <Field label={t('المورد')} className="w-60"><Select value={supplier} onChange={(e) => setSupplier(e.target.value)} options={[{ value: '', label: t('كل الموردين') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
        <Field label={t('من يوم')} className="w-40"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t('لحد يوم')} className="w-40"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="flex-1" />
        <Button variant="primary" data-fb="receipts:new" onClick={() => setCreating(true)}><PackageCheck className="w-4 h-4" />{t('استلام جديد')}</Button>
      </div>
      <DataTable rows={q.items} rowKey={(r: any) => r.id} loading={q.loading && !q.raw} onRowOpen={(r) => setOpen(r.id)} label={t('الاستلامات')} empty={<EmptyState compact icon={<PackageCheck />} title={t('مفيش استلامات')} />}
        columns={[
          RC.text('number', t('الإذن'), (r) => r.number, { cell: (r) => <span className="num font-bold" data-fb={`receipts:open:${r.id}`}>{r.number}</span> }),
          RC.text('supplier', t('المورد'), (r) => tv(r.supplierName), { maxChars: 24, className: 'font-bold' }),
          RC.text('po', t('أمر الشراء'), (r) => r.purchaseOrderNumber ?? t('من غير أمر'), { cell: (r) => <span className="num text-xs">{r.purchaseOrderNumber ?? t('من غير أمر')}</span> }),
          RC.text('invoice', t('فاتورة المورد'), (r) => tLabel(r.supplierInvoiceNo) || null, { cell: (r) => <span className="num text-xs">{tLabel(r.supplierInvoiceNo) || '—'}</span> }),
          RC.text('warehouse', t('المخزن'), (r) => tv(r.warehouse.name), { maxChars: 16 }),
          RC.money('total', t('القيمة'), (r) => r.total),
          RC.date('at', t('إمتى'), (r) => r.at, { cell: (r) => <div><DateTime v={r.at} className="text-xs" /><div className="text-[11px] text-dim">{personText(r.userName)}</div></div> }),
          RC.status('state', t('الحالة'), (r) => (r.state === 'REVERSED' ? { label: t('اتلغى'), tone: 'error' } : Number(r.returnedValue) > 0 ? { label: t('فيه مرتجع'), tone: 'warning' } : { label: t('متسجل'), tone: 'success' })),
        ]} />
      {creating && <ReceiveDialog onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id); }} />}
    </div>
  );
}

interface RLine { itemId: string; poLineId: string | null; packId: string; quantity: string; unitCost: string; lotCode: string; expiryDate: string }
export function ReceiveDialog({ po, onClose, onDone, presetItemId, presetSupplierId }: { po?: any; onClose: () => void; onDone?: (id: string) => void; presetItemId?: string; presetSupplierId?: string }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const openPos = useList<any>('PurchaseOrder.Find', { lifecycle: 'ISSUED,PARTIALLY_RECEIVED', branchId: 'ALL' }, !po);
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [poId, setPoId] = useState<string>(po?.id ?? '');
  const selPo = po ?? openPos.items.find((p) => p.id === poId);
  const [supplierId, setSupplierId] = useState<string>(po?.supplierId ?? presetSupplierId ?? '');
  const [wh, setWh] = useState<string>(po?.warehouseId ?? '');
  const [invoice, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const fromPo = (p: any): RLine[] => p.lines.filter((l: any) => Number(l.outstandingQuantity) > 0).map((l: any) => ({ itemId: l.itemId, poLineId: l.id, packId: l.packId ?? '', quantity: fmtQty(Number(l.outstandingQuantity) / Number(l.factor || 1), 3).replace(/,/g, ''), unitCost: l.orderedUnitCost.replace(/0+$/, '').replace(/\.$/, ''), lotCode: '', expiryDate: '' }));
  const [lines, setLines] = useState<RLine[]>(() => (po ? fromPo(po) : [{ itemId: '', poLineId: null, packId: '', quantity: '', unitCost: '', lotCode: '', expiryDate: '' }]));
  useEffect(() => { if (!po && selPo) { setSupplierId(selPo.supplierId); setWh(selPo.warehouseId); setLines(fromPo(selPo)); } }, [poId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'STORE')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  // round 3: "استلام" from the item 360 page starts with that item
  useEffect(() => {
    if (po || !presetItemId || lines.some((l) => l.itemId)) return;
    const item = items.items.find((x) => x.id === presetItemId);
    if (!item) return;
    const p = item.packs?.find((x: any) => x.id === item.purchasePackId) ?? item.packs?.[0];
    setLines([{ itemId: item.id, poLineId: null, packId: p?.id ?? '', quantity: '', unitCost: (Number(item.lastCost || item.avgCost) * Number(p?.factor ?? 1)).toFixed(2), lotCode: '', expiryDate: '' }]);
  }, [items.items, presetItemId]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = sumLines(lines.map((l) => [l.quantity, l.unitCost])); // Decimal
  const post = async () => {
    const body = { supplierId, warehouseId: wh, purchaseOrderId: selPo?.id, supplierInvoiceNo: invoice || undefined, note: note || undefined,
      lines: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, poLineId: l.poLineId ?? undefined, packId: l.packId || undefined, quantity: l.quantity, unitCost: l.unitCost || '0', lotCode: l.lotCode || undefined, expiryDate: l.expiryDate || undefined })) };
    const r = await run<any>('GoodsReceipt.Post', { body }, { success: t('البضاعة اتستلمت والرصيد اتحدث') });
    if (r) { onDone?.(r.id); onClose(); }
  };
  const valid = supplierId && wh && lines.some((l) => l.itemId && Number(l.quantity) > 0);
  return (
    <FullPage onBack={onClose} fb="receive-page" title={selPo ? t('استلام على أمر شراء {n}', { n: selPo.number }) : t('استلام بضاعة')} badge={<StateBadge ops={['GoodsReceipt.Post']} />}
      footer={<><span className="text-sm me-auto">{t('قيمة الإذن')}: <Money v={total} /></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="success" data-fb="receive:post" loading={busy} disabled={!valid} onClick={post}><PackageCheck className="w-4 h-4" />{t('سجّل الاستلام')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {!po && <Field label={t('على أمر شراء؟')}><Select data-fb="receive:po" value={poId} onChange={(e) => setPoId(e.target.value)} options={[{ value: '', label: t('لأ — استلام من غير أمر') }, ...openPos.items.map((p) => ({ value: p.id, label: `${p.number} — ${tv(p.supplierName)}` }))]} /></Field>}
          <Field label={t('المورد')}><Select data-fb="receive:supplier" disabled={!!selPo} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
          <Field label={t('يدخل مخزن')}><WarehouseSelect fb="receive:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
          <Field label={t('رقم فاتورة المورد')}><Input data-fb="receive:invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        </div>
        <Table head={[t('الصنف'), t('العبوة'), t('الكمية'), t('السعر'), t('الإجمالي'), t('رقم الدفعة'), t('الصلاحية'), '']} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const pk = it?.packs?.find((p: any) => p.id === l.packId);
          const set = (patch: Partial<RLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return [
            l.poLineId ? <span className="font-bold">{L(it?.name)}</span> : <ItemPicker fb={`receive:item:${i}`} className="min-w-[180px]" items={items.items} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => { const p = item.packs?.find((x: any) => x.id === item.purchasePackId) ?? item.packs?.[0]; set({ itemId: id, packId: p?.id ?? '', unitCost: (Number(item.lastCost || item.avgCost) * Number(p?.factor ?? 1)).toFixed(2) }); }} />,
            it ? <Sel className="w-36" disabled={!!l.poLineId} value={l.packId} onChange={(e) => set({ packId: e.target.value })} options={[{ value: '', label: unitLabel(it.unit) }, ...(it.packs ?? []).map((p: any) => ({ value: p.id, label: L(p.name) }))]} /> : '—',
            <div><Inp data-fb={`receive:qty:${i}`} className="w-20" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^\d.]/g, '') })} />{pk && Number(l.quantity) > 0 && <div className="text-[10px] text-dim mt-0.5">= {fmtQty(Number(l.quantity) * Number(pk.factor))} {unitLabel(it.unit)}</div>}</div>,
            <Inp data-fb={`receive:cost:${i}`} className="w-24" inputMode="decimal" value={l.unitCost} onChange={(e) => set({ unitCost: e.target.value.replace(/[^\d.]/g, '') })} />,
            <Money v={(Number(l.quantity || 0) * Number(l.unitCost || 0)).toFixed(4)} className="text-xs" plain />,
            <Inp className="w-24" value={l.lotCode} placeholder={t('اختياري')} onChange={(e) => set({ lotCode: e.target.value })} />,
            it?.trackLots ? <Inp data-fb={`receive:expiry:${i}`} className="w-36" type="date" value={l.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /> : <span className="text-dim text-xs">—</span>,
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        {!selPo && <Button size="sm" data-fb="receive:add" onClick={() => setLines([...lines, { itemId: '', poLineId: null, packId: '', quantity: '', unitCost: '', lotCode: '', expiryDate: '' }])}><Plus className="w-3.5 h-3.5" />{t('صنف كمان')}</Button>}
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Banner tone="info">{t('السعر بالعبوة اللي اخترتها. الأصناف اللي بتتابع صلاحيتها: لو ما كتبتش تاريخ، بيتحط حسب مدة الصلاحية المعتادة. استلام أكتر من المطلوب في الأمر بيترفض حسب الإعداد.')}</Banner>
      </div>
    </FullPage>
  );
}

function ReceiptView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { can, nav } = useDev();
  const q = useQuery<any>(id ? 'GoodsReceipt.Get' : null, { params: { receiptId: id } });
  const r = q.data;
  const [rev, setRev] = useState<string | null>(null);
  const [ret, setRet] = useState(false);
  if (!id) return null;
  return (
    <DetailPane fb="receipt-detail" onClose={onClose} title={r ? <span className="truncate">{t('إذن استلام')} <span className="num">{r.number}</span> — {tv(r.supplierName)}</span> : t('إذن استلام')} badge={r ? <>{r.state === 'REVERSED' ? <Pill tone="error">{t('اتلغى')}</Pill> : <Pill tone="success">{t('متسجل')}</Pill>}<StateBadge ops={['GoodsReceipt.Get', 'GoodsReceipt.Reverse']} /></> : undefined}
      footer={r && r.state === 'POSTED' && <>
        <Button variant="danger" data-fb="receipt:reverse" onClick={() => setRev('')}><RotateCcw className="w-4 h-4" />{t('الغي الإذن ده')}</Button>
        <div className="flex-1" />
        <Button data-fb="receipt:return" onClick={() => setRet(true)}><Undo2 className="w-4 h-4" />{t('رجّع حاجة للمورد')}</Button>
        {!r.invoiceId && can('supplierinvoice:post') && <InvoiceButton receipt={r} size="md" onDone={(iid) => nav('inv-purchasing', { tab: 'invoices', open: iid })} />}
      </>}>
      {!r ? <Spinner /> : (
        <div className="space-y-3">
          <KV rows={[[t('المخزن'), `${tv(r.warehouse.name)} — ${tv(r.warehouse.branchName)}`], [t('أمر الشراء'), r.purchaseOrderNumber ?? t('من غير أمر')], [t('فاتورة المورد'), tLabel(r.supplierInvoiceNo) || '—'], [t('إمتى'), `${dateTime(r.at)} · ${personText(r.userName)}`], [t('ملاحظة'), tv(r.note) ?? '—']]} />
          {r.reversal && <Banner tone="error">{t('الإذن اتلغى')} {dateTime(r.reversal.at)}: {r.reversal.reason}</Banner>}
          {r.state === 'POSTED' && !r.invoiceId && <Banner tone="warning">{t('الإذن ده لسه مالوش فاتورة مورد — الفاتورة بتتعمل على الكمية اللي اتستلمت.')}</Banner>}
          <Table head={[t('الصنف'), t('الكمية'), t('بالوحدة'), t('السعر'), t('تكلفة الوحدة'), t('القيمة'), t('الدفعة / الصلاحية')]} rows={r.lines.map((l: any) => [
            <span className="font-bold">{L(l.item?.name)}</span>,
            <span className="num">{fmtQty(l.packQuantity)} {l.packId ? L(l.item?.packs?.find((p: any) => p.id === l.packId)?.name) : unitLabel(l.item?.unit)}</span>,
            <Qty v={l.quantity} unit={l.item?.unit} />, <Money v={l.packCost} className="text-xs" plain />, <Money v={l.unitCost} className="text-xs" plain />, <Money v={l.value} className="text-xs" />,
            <span className="text-xs">{l.lotCode ?? '—'}{l.expiryDate ? ` · ${l.expiryDate}` : ''}</span>,
          ])} />
          <div className="text-sm">{t('الإجمالي')}: <Money v={r.total} />{Number(r.returnedValue) > 0 && <span className="text-dim"> · {t('اترجع منه')} <Money v={r.returnedValue} plain /></span>}</div>
          <ChainView query={{ receiptId: r.id }} title={t('المستندات المربوطة')} />
          <Tech><div className="text-[11px] num text-dim">{r.id} · movements {r.movementIds.join(', ')}</div></Tech>
        </div>
      )}
      {rev !== null && r && (
        <Popup open onClose={() => setRev(null)} size="sm" fb="receipt-reverse" title={t('إلغاء إذن الاستلام')}
          footer={<><Button onClick={() => setRev(null)}>{t('رجوع')}</Button><Button variant="danger" data-fb="receipt-reverse:go" loading={busy} disabled={!rev.trim()} onClick={async () => { const x = await run('GoodsReceipt.Reverse', { params: { receiptId: r.id }, body: { reason: rev } }, { success: t('الإذن اتلغى والكميات خرجت من المخزن') }); if (x) setRev(null); }}>{t('الغي الإذن')}</Button></>}>
          <div className="space-y-2">
            <div className="text-sm">{t('الإلغاء بيعمل حركة عكسية بنفس الكميات والأسعار، ولو على أمر شراء الكمية بترجع "باقي". محتاج موافقة مدير.')}</div>
            <Field label={t('السبب')}><Textarea data-fb="receipt-reverse:reason" value={rev} onChange={(e) => setRev(e.target.value)} placeholder={t('مثال: الفاتورة اتسجلت مرتين')} /></Field>
          </div>
        </Popup>
      )}
      {ret && r && <SupplierReturnDialog receipt={r} onClose={() => setRet(false)} />}
    </DetailPane>
  );
}

function ReturnList({ branchId }: { branchId?: string }) {
  const q = useList<any>('SupplierReturn.Find', { branchId });
  const [open, setOpen] = useState(false);
  const RC = cols<any>();
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button variant="primary" data-fb="supplier-returns:new" onClick={() => setOpen(true)}><Undo2 className="w-4 h-4" />{t('مرتجع جديد')}</Button></div>
      <DataTable rows={q.items} rowKey={(r: any) => r.id ?? r.number} loading={q.loading && !q.raw} label={t('مرتجعات الموردين')} empty={<EmptyState compact icon={<Undo2 />} title={t('مفيش مرتجعات للموردين')} />}
        columns={[
          RC.text('number', t('الرقم'), (r) => r.number, { cell: (r) => <span className="num font-bold">{r.number}</span> }),
          RC.text('supplier', t('المورد'), (r) => tv(r.supplierName), { maxChars: 24, className: 'font-bold' }),
          RC.text('receipt', t('من إذن'), (r) => r.receiptNumber, { cell: (r) => <span className="num text-xs">{r.receiptNumber ?? '—'}</span> }),
          RC.text('lines', t('الأصناف'), (r) => r.lines.map((l: any) => `${L(l.name)} ${fmtQty(l.quantity)} ${unitLabel(l.unit)}`).join(t('، ')), { maxChars: 36 }),
          RC.text('reason', t('السبب'), (r) => tv(r.reason), { maxChars: 24 }),
          RC.money('total', t('القيمة'), (r) => r.total),
          RC.date('at', t('إمتى'), (r) => r.at, { cell: (r) => <div><DateTime v={r.at} className="text-xs" /><div className="text-[11px] text-dim">{personText(r.userName)}</div></div> }),
        ]} />
      {open && <SupplierReturnDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function SupplierReturnDialog({ receipt, onClose }: { receipt?: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const suppliers = useList<any>('Supplier.List');
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [supplierId, setSupplierId] = useState<string>(receipt?.supplierId ?? '');
  const [wh, setWh] = useState<string>(receipt?.warehouseId ?? '');
  const receipts = useList<any>(supplierId && !receipt ? 'GoodsReceipt.Find' : null, { supplierId, branchId: 'ALL' });
  const [receiptId, setReceiptId] = useState<string>(receipt?.id ?? '');
  const rc = receipt ?? receipts.items.find((r) => r.id === receiptId);
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unitCost: string }[]>([{ itemId: '', quantity: '', unitCost: '' }]);
  const [reason, setReason] = useState('');
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'STORE')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  useEffect(() => { if (rc && !receipt) setWh(rc.warehouseId); }, [receiptId]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = rc ? items.items.filter((i) => rc.lines.some((l: any) => l.itemId === i.id)) : items.items;
  const total = sumLines(lines.map((l) => [l.quantity, l.unitCost])); // Decimal
  const save = async () => {
    const r = await run('SupplierReturn.Post', { body: { supplierId, warehouseId: wh, receiptId: rc?.id, reason, lines: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost || undefined })) } }, { success: t('المرتجع اتسجل والكمية خرجت من المخزن') });
    if (r) onClose();
  };
  return (
    <FullPage onBack={onClose} fb="supplier-return-page" title={t('مرتجع للمورد')} badge={<StateBadge ops={['SupplierReturn.Post']} />}
      footer={<><span className="text-sm me-auto">{t('القيمة')}: <Money v={total} /></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="supplier-return:save" loading={busy} disabled={!supplierId || !wh || !reason.trim() || !lines.some((l) => l.itemId && Number(l.quantity) > 0)} onClick={save}><Save className="w-4 h-4" />{t('سجّل المرتجع')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('المورد')}><Select data-fb="supplier-return:supplier" disabled={!!receipt} value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setReceiptId(''); }} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
          {!receipt && <Field label={t('من إذن استلام (اختياري)')}><Select data-fb="supplier-return:receipt" value={receiptId} onChange={(e) => setReceiptId(e.target.value)} options={[{ value: '', label: t('من غير إذن') }, ...receipts.items.filter((r) => r.state === 'POSTED').map((r) => ({ value: r.id, label: `${r.number} — ${dateTime(r.at)}` }))]} /></Field>}
          <Field label={t('يخرج من مخزن')}><WarehouseSelect value={wh} onChange={setWh} warehouses={whs.items} /></Field>
        </div>
        <Table head={[t('الصنف'), t('الكمية'), t('سعر الوحدة'), ''].concat(rc ? [t('في الإذن')] : [])} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const gl = rc?.lines.find((x: any) => x.itemId === l.itemId);
          const set = (patch: any) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return [
            <ItemPicker fb={`supplier-return:item:${i}`} className="min-w-[200px]" items={choices} value={l.itemId} onChange={(id, item) => { const g = rc?.lines.find((x: any) => x.itemId === id); set({ itemId: id, unitCost: Number(g?.unitCost ?? item.avgCost).toFixed(2) }); }} />,
            <div className="flex items-center gap-1"><Inp data-fb={`supplier-return:qty:${i}`} className="w-24" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^\d.]/g, '') })} /><span className="text-xs text-dim">{unitLabel(it?.unit)}</span></div>,
            <Inp className="w-24" inputMode="decimal" value={l.unitCost} onChange={(e) => set({ unitCost: e.target.value.replace(/[^\d.]/g, '') })} />,
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 className="w-3.5 h-3.5" /></Button>,
            ...(rc ? [gl ? <Qty v={gl.quantity} unit={it?.unit} /> : '—'] : []),
          ];
        })} />
        <Button size="sm" onClick={() => setLines([...lines, { itemId: '', quantity: '', unitCost: '' }])}><Plus className="w-3.5 h-3.5" />{t('صنف كمان')}</Button>
        <Field label={t('السبب')}><Textarea data-fb="supplier-return:reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثال: طماطم مفعوصة في القفص')} /></Field>
        <Banner tone="warning">{t('المرتجع بيخرج الكمية من المخزن بسعر الاستلام، وبيحتاج موافقة مدير.')}</Banner>
      </div>
    </FullPage>
  );
}
