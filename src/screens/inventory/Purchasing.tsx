// Round 3 (E14, P1-030, A16): purchasing as four linked documents.
//  ١. طلبية المخزن — the store keeper lists what is short; suggested quantity = target − on hand, editable (seasons, holidays).
//  ٢. أمر الشراء — the purchasing officer turns it into purchase orders and may change the quantities (100 → 80).
//  ٣. الاستلام — what actually arrived (80 → 60); stock goes up by the received quantity only.
//  ٤. فاتورة المورد — generated from the receipt (60); or a "direct supplier invoice" that receives and costs in one go.
import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Send, XCircle, ShoppingBag, FileText, PackageCheck, Save, Trash2, Wand2, Receipt as ReceiptIcon, Workflow } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, DetailPane, EmptyState, Field, Input, KV, MasterDetail, Money, PageHeader, Pill, Popup, Select, Spinner, StatCard, StatGrid, StateBadge, Switch, Table, Tabs, Textarea, Toolbar } from '../../ui';
import { FullPage } from './purchasingLayout';
import { t, L, tv } from '../../i18n';
import { cn, dateTime, money } from '../../lib/format';
import { BranchScope, ItemPicker, Qty, StatePill, WarehouseSelect, fmtQty, unitLabel, useBranchScope, useItemsCatalog, useList, useWarehouses, Inp, Sel } from './common';
import { ChainView, SR_STATE } from './Chain';
import { personText } from '../../demo/people';

const OPS = ['StoreRequest.Suggest', 'StoreRequest.Create', 'StoreRequest.Submit', 'StoreRequest.Cancel', 'StoreRequest.Find', 'StoreRequest.Get', 'StoreRequest.CreatePurchaseOrders', 'SupplierInvoice.FromReceipt', 'SupplierInvoice.PostDirect', 'SupplierInvoice.Find', 'SupplierInvoice.Get', 'SupplierInvoice.Pending', 'Procurement.Chain'];
type Tab = 'requests' | 'invoices';

export default function Purchasing() {
  const { params, can } = useDev();
  const scope = useBranchScope();
  const [tab, setTab] = useState<Tab>(params?.tab === 'invoices' ? 'invoices' : 'requests');
  const [newReq, setNewReq] = useState<null | { itemId?: string }>(params?.newRequest ? { itemId: params?.itemId } : null);
  const [direct, setDirect] = useState(false);
  const [openSr, setOpenSr] = useState<string | null>(params?.tab !== 'invoices' ? params?.open ?? null : null);
  const [openInv, setOpenInv] = useState<string | null>(params?.tab === 'invoices' ? params?.open ?? null : null);
  useEffect(() => {
    if (params?.tab) setTab(params.tab === 'invoices' ? 'invoices' : 'requests');
    if (params?.open) { if (params.tab === 'invoices') setOpenInv(params.open); else setOpenSr(params.open); }
    if (params?.newRequest) setNewReq({ itemId: params?.itemId });
  }, [params?.tab, params?.open, params?.newRequest, params?.itemId]);
  const reqs = useList<any>('StoreRequest.Find', { branchId: scope.branchId });
  const canBuy = can('purchasing:read');
  const invs = useList<any>('SupplierInvoice.Find', { branchId: scope.branchId }, canBuy);
  const pending = useList<any>('SupplierInvoice.Pending', { branchId: scope.branchId }, canBuy);
  const waiting = reqs.items.filter((r) => r.state === 'SUBMITTED');
  const loading = reqs.loading && !reqs.raw;
  // ux-05: store request / invoice details beside the list (wide) or as a full page — ux-06 MasterDetail / DetailPane
  return (
    <MasterDetail fb="purchasing" open={!!(openSr || openInv)} detail={openSr ? <StoreRequestView id={openSr} onClose={() => setOpenSr(null)} /> : openInv ? <InvoiceView id={openInv} onClose={() => setOpenInv(null)} /> : null} list={<div className="space-y-4">
      <PageHeader icon={<Workflow />} title={t('دورة الشراء')} badge={<StateBadge ops={OPS} />}
        description={t('أربع مستندات مربوطة ببعض: طلبية المخزن ← أمر الشراء ← الاستلام ← فاتورة المورد. الكمية ممكن تختلف في كل خطوة (100 ← 80 ← 60) والفرق باين.')}
        actions={<><BranchScope scope={scope} />
          {can('supplierinvoice:post') && <Button data-fb="pur:direct" onClick={() => setDirect(true)}><ReceiptIcon className="w-4 h-4" />{t('فاتورة مورد مباشرة')}</Button>}
          {can('storerequest:create') && <Button data-fb="pur:new-request" variant="primary" onClick={() => setNewReq({})}><Plus className="w-4 h-4" />{t('طلبية مخزن جديدة')}</Button>}</>} />
      <StatGrid>
        {/* the store keeper sees requests only; purchasing also sees receipts and invoices */}
        <StatCard label={t('طلبيات مستنية المشتريات')} value={waiting.length} icon={<ClipboardList />} tone={waiting.length ? 'warning' : 'neutral'} loading={loading} onClick={() => setTab('requests')} fb="pur:kpi-waiting" />
        {canBuy && <><StatCard label={t('استلامات من غير فاتورة')} value={pending.items.length} icon={<PackageCheck />} tone={pending.items.length ? 'info' : 'neutral'} loading={pending.loading && !pending.raw} onClick={() => setTab('invoices')} fb="pur:kpi-pending" />
        <StatCard label={t('فواتير الموردين (الكل)')} value={invs.items.length} icon={<FileText />} loading={invs.loading && !invs.raw} hint={t('بقيمة {m}', { m: money(String(invs.items.reduce((a, x) => a + Number(x.total), 0))) })} />
        <StatCard label={t('فرق أسعار في الفواتير')} value={<Money v={String(invs.items.reduce((a, x) => a + Number(x.priceVariance), 0))} />} icon={<ShoppingBag />} hint={t('الفاتورة مقابل سعر الاستلام')} /></>}
      </StatGrid>
      <Tabs<Tab> variant="underline" value={tab} onChange={setTab} tabs={[
        { id: 'requests', label: t('طلبيات المخزن'), count: reqs.items.length, fb: 'pur:tab-requests' },
        ...(canBuy ? [{ id: 'invoices' as Tab, label: t('فواتير الموردين'), count: invs.items.length, fb: 'pur:tab-invoices' }] : []),
      ]} />
      {tab === 'requests' || !canBuy ? (
        <Card padding="sm">
          <Table loading={loading} onRowClick={(i) => setOpenSr(reqs.items[i].id)} align={['start', 'start', 'start', 'end', 'start', 'start']}
            empty={<EmptyState compact icon={<ClipboardList />} title={t('مفيش طلبيات مخزن')} text={t('أمين المخزن يعمل طلبية بالنواقص — الكمية بتتحسب لوحدها (المستهدف − الموجود) ويقدر يعدلها.')} action={can('storerequest:create') ? <Button variant="primary" onClick={() => setNewReq({})}>{t('طلبية مخزن جديدة')}</Button> : undefined} />}
            head={[t('الرقم'), t('المخزن'), t('الحالة'), t('أصناف'), t('مين طلب'), t('أوامر الشراء')]} rows={reqs.items.map((r) => [
              <span className="num font-bold" data-fb={`sr:open:${r.id}`}>{r.number}</span>, <span className="text-xs">{tv(r.warehouse.name)}</span>, <StatePill map={SR_STATE} state={r.state} />,
              <span className="num">{r.lines.length}</span>, <span className="text-xs">{personText(r.createdByName)} · {dateTime(r.createdAt)}</span>,
              r.purchaseOrders.length ? <span className="text-xs num">{r.purchaseOrders.map((p: any) => p.number).join(t('، '))}</span> : <span className="text-dim text-xs">—</span>,
            ])} />
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.items.length > 0 && (
            <Card title={t('استلامات مستنية فاتورة المورد')} description={t('الفاتورة بتتعمل على اللي اتستلم فعلًا — مش على اللي اتطلب.')} padding="sm">
              <Table dense head={[t('الإذن'), t('المورد'), t('أمر الشراء'), t('القيمة'), '']} align={['start', 'start', 'start', 'end', 'end']} rows={pending.items.map((r) => [
                <span className="num font-bold">{r.number}</span>, tv(r.supplierName), r.purchaseOrderNumber ? <span className="num text-xs">{r.purchaseOrderNumber}</span> : <span className="text-dim text-xs">{t('من غير أمر')}</span>, <Money v={r.total} className="text-xs" />,
                can('supplierinvoice:post') ? <InvoiceButton receipt={r} onDone={(id) => setOpenInv(id)} /> : null,
              ])} />
            </Card>
          )}
          <Card padding="sm">
            <Table loading={invs.loading && !invs.raw} onRowClick={(i) => setOpenInv(invs.items[i].id)} align={['start', 'start', 'start', 'start', 'end', 'end']}
              empty={<EmptyState compact icon={<FileText />} title={t('مفيش فواتير موردين')} text={t('اعمل فاتورة من أي استلام، أو سجّل فاتورة مباشرة.')} />}
              head={[t('الرقم'), t('المورد'), t('النوع'), t('الاستلام / أمر الشراء'), t('فرق السعر'), t('الإجمالي')]} rows={invs.items.map((x) => [
                <span className="num font-bold" data-fb={`inv:open:${x.id}`}>{x.number}{x.supplierInvoiceNo ? <span className="text-[11px] text-dim font-normal"> · {x.supplierInvoiceNo}</span> : null}</span>, tv(x.supplierName),
                <Pill tone={x.kind === 'DIRECT' ? 'violet' : 'info'}>{x.kind === 'DIRECT' ? t('فاتورة مباشرة') : t('من الاستلام')}</Pill>,
                <span className="text-xs num">{x.receiptNumbers.join(t('، '))}{x.purchaseOrderNumber ? ` · ${x.purchaseOrderNumber}` : ''}</span>,
                Number(x.priceVariance) !== 0 ? <Money v={x.priceVariance} className="text-xs" tone={Number(x.priceVariance) > 0 ? 'error' : 'success'} /> : <span className="text-dim text-xs">—</span>,
                <Money v={x.total} className="text-xs" />,
              ])} />
          </Card>
        </div>
      )}
      {newReq && <StoreRequestEditor presetItemId={newReq.itemId} onClose={() => setNewReq(null)} onSaved={(id) => { setNewReq(null); setOpenSr(id); }} />}
      {direct && <DirectInvoiceDialog onClose={() => setDirect(false)} onDone={(id) => { setDirect(false); setTab('invoices'); setOpenInv(id); }} />}
    </div>} />
  );
}

// ───────── ١. store request editor (suggestion = target − on hand, editable)
export function StoreRequestEditor({ presetItemId, onClose, onSaved }: { presetItemId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const whs = useWarehouses();
  const [wh, setWh] = useState('');
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'STORE')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  const sug = useQuery<any>(wh ? 'StoreRequest.Suggest' : null, { query: { warehouseId: wh } });
  const [pick, setPick] = useState<Record<string, { on: boolean; qty: string; note: string }>>({});
  const [onlyShort, setOnlyShort] = useState(true);
  const [note, setNote] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const rows: any[] = sug.data?.items ?? [];
  useEffect(() => {
    const init: typeof pick = {};
    for (const r of rows) init[r.item.id] = { on: r.item.id === presetItemId || (!presetItemId && r.short), qty: String(Number(r.suggestedQuantity) > 0 ? fmtQty(r.suggestedQuantity).replace(/,/g, '') : ''), note: '' };
    setPick(init);
    if (presetItemId && rows.length && !rows.find((r) => r.short && r.item.id === presetItemId)) setOnlyShort(false);
  }, [sug.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter((r) => !onlyShort || r.short || pick[r.item.id]?.on);
  const chosen = rows.filter((r) => pick[r.item.id]?.on && Number(pick[r.item.id]?.qty) > 0);
  const save = async (submit: boolean) => {
    const r = await run<any>('StoreRequest.Create', { body: { warehouseId: wh, note: note || undefined, neededBy: neededBy || undefined, submit, lines: chosen.map((x) => ({ itemId: x.item.id, requestedQuantity: pick[x.item.id].qty, note: pick[x.item.id].note || undefined })) } }, { success: submit ? t('طلبية المخزن اتبعتت للمشتريات') : t('الطلبية اتحفظت مسودة') });
    if (r) onSaved(r.id);
  };
  return (
    <FullPage onBack={onClose} title={t('طلبية مخزن جديدة')} badge={<StateBadge ops={['StoreRequest.Suggest', 'StoreRequest.Create']} />}
      sub={t('الكمية المقترحة = المستهدف − الموجود. عدّلها براحتك (مواسم، أعياد، المورد مش بيجي كل يوم).')}
      footer={<><span className="text-sm me-auto">{t('{n} صنف', { n: chosen.length })}</span><Button onClick={onClose}>{t('إلغاء')}</Button><Button data-fb="sr-edit:draft" loading={busy} disabled={!chosen.length} onClick={() => save(false)}><Save className="w-4 h-4" />{t('مسودة')}</Button><Button variant="primary" data-fb="sr-edit:submit" loading={busy} disabled={!chosen.length || !wh} onClick={() => save(true)}><Send className="w-4 h-4" />{t('ابعت للمشتريات')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('المخزن')}><WarehouseSelect fb="sr-edit:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
          <Field label={t('محتاجينها يوم')}><Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} /></Field>
          <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: زوّدنا عشان إجازة العيد')} /></Field>
        </div>
        <div className="flex items-center gap-3"><Switch checked={onlyShort} onChange={setOnlyShort} label={t('النواقص بس ({n})', { n: sug.data?.shortCount ?? 0 })} /></div>
        {!sug.data ? <Spinner /> : (
          <Table dense maxHeight={480} head={['', t('الصنف'), t('الموجود'), t('الحد الأدنى'), t('المستهدف'), t('المقترح'), t('هتطلب'), t('ملاحظة')]} align={['start', 'start', 'end', 'end', 'end', 'end', 'start', 'start']}
            empty={t('مفيش أصناف ليها حد أدنى في المخزن ده')}
            rows={shown.map((r) => {
              const p = pick[r.item.id] ?? { on: false, qty: '', note: '' };
              const set = (patch: Partial<typeof p>) => setPick({ ...pick, [r.item.id]: { ...p, ...patch } });
              const changed = p.qty !== '' && Number(p.qty) !== Number(r.suggestedQuantity);
              return [
                <input type="checkbox" data-fb={`sr-edit:on:${r.item.id}`} checked={p.on} onChange={(e) => set({ on: e.target.checked })} />,
                <div className="min-w-[130px]"><div className="font-bold">{L(r.item.name)}</div>{Number(r.onOrder) > 0 && <div className="text-[10px] text-[var(--info,#38bdf8)]">{t('عليه أمر شراء مفتوح: {q}', { q: fmtQty(r.onOrder) })}</div>}{r.short && <Pill tone="warning" size="sm">{t('ناقص')}</Pill>}</div>,
                <Qty v={r.onHand} unit={r.item.unit} hint={false} />, <span className="num text-xs">{fmtQty(r.min)}</span>, <span className="num text-xs">{fmtQty(r.target)}</span>,
                <span className="num font-bold" data-fb={`sr-edit:suggested:${r.item.id}`}>{fmtQty(r.suggestedQuantity)}</span>,
                <div className="flex items-center gap-1"><Inp data-fb={`sr-edit:qty:${r.item.id}`} className={cn('w-20', changed && 'border-[var(--warning)]')} inputMode="decimal" value={p.qty} onChange={(e) => set({ qty: e.target.value.replace(/[^\d.]/g, ''), on: true })} /><span className="text-[11px] text-dim">{unitLabel(r.item.unit)}</span>{changed && <span className="text-[10px] text-[var(--warning-text)]">{t('اتعدلت')}</span>}</div>,
                <Inp className="w-32" value={p.note} onChange={(e) => set({ note: e.target.value })} placeholder={t('اختياري')} />,
              ];
            })} />
        )}
      </div>
    </FullPage>
  );
}

// ───────── store request view + ٢. turn it into purchase orders
function StoreRequestView({ id, onClose }: { id: string; onClose: () => void }) {
  const { run, busy } = useCommand();
  const { can } = useDev();
  const q = useQuery<any>('StoreRequest.Get', { params: { storeRequestId: id } });
  const sr = q.data;
  const [toPo, setToPo] = useState(false);
  const [cancel, setCancel] = useState<string | null>(null);
  return (
    <DetailPane onClose={onClose} title={sr ? <span className="flex items-center gap-2">{t('طلبية مخزن')} <span className="num">{sr.number}</span> — {tv(sr.warehouse.name)}</span> : t('طلبية مخزن')} badge={sr ? <><StatePill map={SR_STATE} state={sr.state} /><StateBadge ops={['StoreRequest.Get', 'StoreRequest.CreatePurchaseOrders']} /></> : undefined}
      footer={sr && <>
        {['DRAFT', 'SUBMITTED'].includes(sr.state) && can('storerequest:create') && <Button variant="danger" data-fb="sr-view:cancel" onClick={() => setCancel('')}><XCircle className="w-4 h-4" />{t('الغي')}</Button>}
        <div className="flex-1" />
        {sr.state === 'DRAFT' && <Button variant="primary" data-fb="sr-view:submit" loading={busy} onClick={() => run('StoreRequest.Submit', { params: { storeRequestId: sr.id }, body: { expectedVersion: sr.version } }, { success: t('الطلبية اتبعتت للمشتريات') })}><Send className="w-4 h-4" />{t('ابعت للمشتريات')}</Button>}
        {sr.state === 'SUBMITTED' && can('purchaseorder:create') && <Button variant="primary" data-fb="sr-view:to-po" onClick={() => setToPo(true)}><ShoppingBag className="w-4 h-4" />{t('اعمل أوامر الشراء')}</Button>}
      </>}>
      {!sr ? <Spinner /> : (
        <div className="space-y-4">
          <KV rows={[[t('طلبها'), `${personText(sr.createdByName)} · ${dateTime(sr.createdAt)}`], [t('محتاجينها يوم'), sr.neededBy ?? '—'], [t('ملاحظة'), tv(sr.note) || '—'], ...(sr.cancelReason ? [[t('سبب الإلغاء'), sr.cancelReason] as [string, string]] : [])]} />
          <Table dense head={[t('الصنف'), t('كان موجود'), t('المقترح'), t('اتطلب'), t('اتعمل أمر شراء'), t('اتستلم'), t('اتفوتر')]} align={['start', 'end', 'end', 'end', 'end', 'end', 'end']} rows={sr.lines.map((l: any) => [
            <span className="font-bold">{L(l.item?.name)}{l.note ? <span className="text-[11px] text-dim font-normal"> · {l.note}</span> : null}</span>,
            <Qty v={l.onHand} unit={l.item?.unit} hint={false} />, <span className="num text-xs">{fmtQty(l.suggestedQuantity)}</span>,
            <span className={cn('num font-bold', Number(l.requestedQuantity) !== Number(l.suggestedQuantity) && 'text-[var(--warning-text)]')}>{fmtQty(l.requestedQuantity)}</span>,
            <span className="num">{fmtQty(l.orderedQuantity)}</span>, <span className="num">{fmtQty(l.receivedQuantity)}</span>, <span className="num">{fmtQty(l.invoicedQuantity)}</span>,
          ])} />
          {sr.state !== 'DRAFT' && <ChainView query={{ storeRequestId: sr.id }} title={t('المستندات المربوطة')} />}
          <Tech><div className="text-[11px] num text-dim">{sr.id} · v{sr.version}</div></Tech>
        </div>
      )}
      {toPo && sr && <ToPurchaseOrders sr={sr} onClose={() => setToPo(false)} />}
      {cancel !== null && sr && (
        <Popup open size="sm" onClose={() => setCancel(null)} title={t('إلغاء طلبية المخزن')} footer={<><Button onClick={() => setCancel(null)}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={!cancel.trim()} onClick={async () => { if (await run('StoreRequest.Cancel', { params: { storeRequestId: sr.id }, body: { expectedVersion: sr.version, reason: cancel } }, { success: t('الطلبية اتلغت') })) setCancel(null); }}>{t('الغي')}</Button></>}>
          <Field label={t('السبب')}><Textarea value={cancel} onChange={(e) => setCancel(e.target.value)} /></Field>
        </Popup>
      )}
    </DetailPane>
  );
}

function ToPurchaseOrders({ sr, onClose }: { sr: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const items = useItemsCatalog();
  const [issue, setIssue] = useState(true);
  const [rows, setRows] = useState<Record<string, { supplierId: string; packId: string; qty: string; cost: string }>>({});
  useEffect(() => {
    if (!items.items.length) return;
    const init: typeof rows = {};
    for (const l of sr.lines) {
      const it = items.items.find((i) => i.id === l.itemId);
      init[l.id] = { supplierId: l.defaultSupplierId ?? '', packId: '', qty: fmtQty(l.requestedQuantity).replace(/,/g, ''), cost: Number(it?.lastCost || it?.avgCost || 0).toFixed(2) };
    }
    setRows(init);
  }, [items.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const l of sr.lines) { const r = rows[l.id]; if (!r || !r.supplierId || !(Number(r.qty) > 0)) continue; g.set(r.supplierId, [...(g.get(r.supplierId) ?? []), { l, r }]); }
    return g;
  }, [rows, sr.lines]);
  const create = async () => {
    const orders = [...groups].map(([supplierId, list]) => ({ supplierId, issue, lines: list.map(({ l, r }) => ({ requestLineId: l.id, packId: r.packId || null, orderedQuantity: r.qty, orderedUnitCost: r.cost || '0' })) }));
    const res = await run<any>('StoreRequest.CreatePurchaseOrders', { params: { storeRequestId: sr.id }, body: { expectedVersion: sr.version, orders } }, { success: t('أوامر الشراء اتعملت من الطلبية') });
    if (res) onClose();
  };
  const total = [...groups.values()].flat().reduce((a, { r }) => a + Number(r.qty) * Number(r.cost), 0);
  return (
    <FullPage onBack={onClose} title={t('أوامر شراء من طلبية {n}', { n: sr.number })} badge={<StateBadge ops={['StoreRequest.CreatePurchaseOrders']} />}
      footer={<><span className="text-sm me-auto">{t('{n} أمر شراء', { n: groups.size })} · <b className="num">{money(total.toFixed(4))}</b></span><Switch checked={issue} onChange={setIssue} label={t('ابعتها للمورد على طول')} /><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="to-po:create" loading={busy} disabled={!groups.size} onClick={create}><ShoppingBag className="w-4 h-4" />{t('اعمل أوامر الشراء')}</Button></>}>
      <div className="space-y-3">
        <Banner tone="info">{t('مسؤول المشتريات يقرر الكمية حسب الفلوس والمورد — ممكن تختلف عن طلبية المخزن، والفرق هيفضل باين في المستندات.')}</Banner>
        <Table dense head={[t('الصنف'), t('المخزن طلب'), t('المورد'), t('الوحدة / العبوة'), t('هتطلب'), t('السعر'), t('الفرق')]} align={['start', 'end', 'start', 'start', 'start', 'start', 'end']} rows={sr.lines.map((l: any) => {
          const r = rows[l.id];
          if (!r) return [];
          const it = items.items.find((i) => i.id === l.itemId);
          const pk = it?.packs?.find((p: any) => p.id === r.packId);
          const stockQty = Number(r.qty || 0) * Number(pk?.factor ?? 1);
          const diff = stockQty - Number(l.requestedQuantity);
          const set = (patch: Partial<typeof r>) => setRows({ ...rows, [l.id]: { ...r, ...patch } });
          return [
            <span className="font-bold">{L(l.item?.name)}</span>, <Qty v={l.requestedQuantity} unit={l.item?.unit} hint={false} />,
            <Sel className="w-44" data-fb={`to-po:supplier:${l.itemId}`} value={r.supplierId} onChange={(e) => set({ supplierId: e.target.value })} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} />,
            it ? <Sel className="w-36" value={r.packId} onChange={(e) => { const p = it.packs.find((x: any) => x.id === e.target.value); const off = p?.offers?.find((o: any) => o.supplierId === r.supplierId) ?? p?.offers?.[0]; set({ packId: e.target.value, cost: off ? Number(off.packPrice).toFixed(2) : (Number(it.lastCost || it.avgCost) * Number(p?.factor ?? 1)).toFixed(2), qty: p ? String(Math.ceil(Number(l.requestedQuantity) / Number(p.factor))) : fmtQty(l.requestedQuantity).replace(/,/g, '') }); }} options={[{ value: '', label: unitLabel(it.unit) }, ...(it.packs ?? []).map((p: any) => ({ value: p.id, label: L(p.name) }))]} /> : '—',
            <div><Inp data-fb={`to-po:qty:${l.itemId}`} className="w-20" inputMode="decimal" value={r.qty} onChange={(e) => set({ qty: e.target.value.replace(/[^\d.]/g, '') })} />{pk && <div className="text-[10px] text-dim">= {fmtQty(stockQty)} {unitLabel(it.unit)}</div>}</div>,
            <Inp data-fb={`to-po:cost:${l.itemId}`} className="w-24" inputMode="decimal" value={r.cost} onChange={(e) => set({ cost: e.target.value.replace(/[^\d.]/g, '') })} />,
            Math.abs(diff) < 1e-9 ? <span className="text-[var(--success)] text-xs">✓</span> : <span className={cn('num text-xs font-bold', diff < 0 ? 'text-[var(--warning-text)]' : 'text-[var(--error)]')}>{diff > 0 ? '+' : '−'}{fmtQty(Math.abs(diff))}</span>,
          ];
        })} />
      </div>
    </FullPage>
  );
}

// ───────── ٤. invoice from a receipt
export function InvoiceButton({ receipt, onDone, size = 'sm' }: { receipt: any; onDone?: (id: string) => void; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="primary" data-fb={`invoice-from:${receipt.id}`} onClick={(e) => { e.stopPropagation(); setOpen(true); }}><FileText className="w-3.5 h-3.5" />{t('اعمل فاتورة المورد')}</Button>
      {open && <InvoiceFromReceiptDialog receipt={receipt} onClose={() => setOpen(false)} onDone={(id) => { setOpen(false); onDone?.(id); }} />}
    </>
  );
}

function InvoiceFromReceiptDialog({ receipt, onClose, onDone }: { receipt: any; onClose: () => void; onDone: (id: string) => void }) {
  const { run, busy } = useCommand();
  const [no, setNo] = useState(receipt.supplierInvoiceNo ?? '');
  const [tax, setTax] = useState('');
  const [due, setDue] = useState('');
  const [cost, setCost] = useState<Record<string, string>>(() => Object.fromEntries(receipt.lines.map((l: any) => [l.id, String(Number(l.packCost))])));
  const total = receipt.lines.reduce((a: number, l: any) => a + Number(l.packQuantity) * Number(cost[l.id] || 0), 0) + Number(tax || 0);
  const post = async () => {
    const r = await run<any>('SupplierInvoice.FromReceipt', { body: { receiptIds: [receipt.id], supplierInvoiceNo: no || undefined, taxAmount: tax || undefined, dueDate: due || undefined, lines: receipt.lines.map((l: any) => ({ receiptLineId: `${receipt.id}:${l.id}`, packCost: cost[l.id] || l.packCost })) } }, { success: t('فاتورة المورد اتسجلت على الكمية اللي اتستلمت') });
    if (r) onDone(r.id);
  };
  return (
    <Popup open size="lg" onClose={onClose} title={t('فاتورة المورد على إذن {n}', { n: receipt.number })}
      footer={<><span className="text-sm me-auto">{t('الإجمالي')}: <b className="num">{money(total.toFixed(4))}</b></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="invoice:post" loading={busy} onClick={post}><FileText className="w-4 h-4" />{t('سجّل الفاتورة')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('رقم فاتورة المورد')}><Input data-fb="invoice:no" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
          <Field label={t('الضريبة على الفاتورة')} hint={t('اختياري — زي ما مكتوبة في الفاتورة')}><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label={t('ميعاد الدفع')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Table dense head={[t('الصنف'), t('الكمية (اللي اتستلمت)'), t('سعر الاستلام'), t('سعر الفاتورة'), t('الإجمالي')]} align={['start', 'end', 'end', 'start', 'end']} rows={receipt.lines.map((l: any) => [
          <span className="font-bold">{L(l.item?.name)}</span>,
          <span className="num" data-fb={`invoice:qty:${l.itemId}`}>{fmtQty(l.packQuantity)} {l.packId ? L(l.item?.packs?.find((p: any) => p.id === l.packId)?.name) : unitLabel(l.item?.unit)}</span>,
          <span className="num text-xs">{money(l.packCost)}</span>,
          <div className="flex items-center gap-1"><Inp className="w-24" inputMode="decimal" value={cost[l.id]} onChange={(e) => setCost({ ...cost, [l.id]: e.target.value.replace(/[^\d.]/g, '') })} />{Number(cost[l.id]) !== Number(l.packCost) && <Pill tone="warning" size="sm">{t('فرق سعر')}</Pill>}</div>,
          <span className="num text-xs">{money((Number(l.packQuantity) * Number(cost[l.id] || 0)).toFixed(4))}</span>,
        ])} />
        <Banner tone="info">{t('الكمية في الفاتورة = اللي اتستلم بالظبط ومينفعش تتغير. لو المورد كاتب سعر مختلف، اكتبه — الفرق بيظهر كـ«فرق سعر» والرصيد مش بيتغير.')}</Banner>
      </div>
    </Popup>
  );
}

function InvoiceView({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>('SupplierInvoice.Get', { params: { invoiceId: id } });
  const x = q.data;
  return (
    <DetailPane onClose={onClose} title={x ? <span className="flex items-center gap-2">{t('فاتورة مورد')} <span className="num">{x.number}</span> — {tv(x.supplierName)}</span> : t('فاتورة مورد')} badge={x ? <><Pill tone={x.kind === 'DIRECT' ? 'violet' : 'info'}>{x.kind === 'DIRECT' ? t('فاتورة مباشرة') : t('من الاستلام')}</Pill><StateBadge ops={['SupplierInvoice.Get']} /></> : undefined}>
      {!x ? <Spinner /> : (
        <div className="space-y-4">
          <KV rows={[[t('رقم فاتورة المورد'), x.supplierInvoiceNo ?? '—'], [t('المخزن'), tv(x.warehouse.name)], [t('اتسجلت'), `${dateTime(x.at)} · ${personText(x.userName)}`], [t('ميعاد الدفع'), x.dueDate ?? '—'], [t('أذون الاستلام'), x.receiptNumbers.join(t('، '))], ...(x.purchaseOrderNumber ? [[t('أمر الشراء'), x.purchaseOrderNumber] as [string, string]] : []), ...(x.storeRequestNumber ? [[t('طلبية المخزن'), x.storeRequestNumber] as [string, string]] : [])]} />
          <Table dense head={[t('الصنف'), t('الكمية'), t('سعر الاستلام'), t('سعر الفاتورة'), t('فرق السعر'), t('الإجمالي')]} align={['start', 'end', 'end', 'end', 'end', 'end']} rows={x.lines.map((l: any) => [
            <span className="font-bold">{L(l.item?.name)}</span>, <Qty v={l.quantity} unit={l.item?.unit} hint={false} />, <span className="num text-xs">{money(l.receivedPackCost)}</span>, <span className="num text-xs">{money(l.packCost)}</span>,
            Number(l.priceVariance) !== 0 ? <Money v={l.priceVariance} className="text-xs" tone={Number(l.priceVariance) > 0 ? 'error' : 'success'} /> : <span className="text-dim text-xs">—</span>, <Money v={l.value} className="text-xs" />,
          ])} />
          <div className="flex flex-wrap gap-4 justify-end text-sm"><span>{t('قبل الضريبة')}: <b className="num">{money(x.subtotal)}</b></span><span>{t('الضريبة')}: <b className="num">{money(x.taxAmount)}</b></span><span>{t('الإجمالي')}: <b className="num text-[var(--primary)]">{money(x.total)}</b></span></div>
          <ChainView query={{ invoiceId: x.id }} title={t('المستندات المربوطة')} />
          <Tech><div className="text-[11px] num text-dim">{x.id}</div></Tech>
        </div>
      )}
    </DetailPane>
  );
}

// ───────── direct supplier invoice: one document that receives and costs
interface DLine { itemId: string; packId: string; quantity: string; unitCost: string; expiryDate: string }
function DirectInvoiceDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [supplierId, setSupplierId] = useState('');
  const [wh, setWh] = useState('');
  const [no, setNo] = useState('');
  const [tax, setTax] = useState('');
  const [due, setDue] = useState('');
  const [lines, setLines] = useState<DLine[]>([{ itemId: '', packId: '', quantity: '', unitCost: '', expiryDate: '' }]);
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'STORE')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unitCost || 0), 0) + Number(tax || 0);
  const valid = supplierId && wh && lines.some((l) => l.itemId && Number(l.quantity) > 0);
  const post = async () => {
    const r = await run<any>('SupplierInvoice.PostDirect', { body: { supplierId, warehouseId: wh, supplierInvoiceNo: no || undefined, taxAmount: tax || undefined, dueDate: due || undefined, lines: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, packId: l.packId || undefined, quantity: l.quantity, unitCost: l.unitCost || '0', expiryDate: l.expiryDate || undefined })) } }, { success: t('الفاتورة اتسجلت والبضاعة دخلت المخزن') });
    if (r) onDone(r.id);
  };
  return (
    <FullPage onBack={onClose} title={t('فاتورة مورد مباشرة')} badge={<StateBadge ops={['SupplierInvoice.PostDirect']} />} sub={t('البضاعة وصلت من غير أمر شراء (زي الصيدليات): مستند واحد بيدخّل البضاعة المخزن ويحدّث التكلفة ويسجل الفاتورة.')}
      footer={<><span className="text-sm me-auto">{t('الإجمالي')}: <b className="num">{money(total.toFixed(4))}</b></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="success" data-fb="direct:post" loading={busy} disabled={!valid} onClick={post}><PackageCheck className="w-4 h-4" />{t('سجّل الفاتورة واستلم')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={t('المورد')}><Select data-fb="direct:supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
          <Field label={t('يدخل مخزن')}><WarehouseSelect fb="direct:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
          <Field label={t('رقم فاتورة المورد')}><Input data-fb="direct:no" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
          <Field label={t('الضريبة على الفاتورة')}><Input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          <Field label={t('ميعاد الدفع')}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Table head={[t('الصنف'), t('العبوة'), t('الكمية'), t('السعر'), t('الإجمالي'), t('الصلاحية'), '']} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const set = (patch: Partial<DLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          const offerCost = (item: any, packId: string) => { const p = item?.packs?.find((x: any) => x.id === packId); const o = p?.offers?.find((x: any) => x.supplierId === supplierId) ?? p?.offers?.[0]; return o ? Number(o.packPrice).toFixed(2) : (Number(item?.lastCost || item?.avgCost || 0) * Number(p?.factor ?? 1)).toFixed(2); };
          return [
            <ItemPicker fb={`direct:item:${i}`} className="min-w-[180px]" items={items.items} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => { const p = item.packs?.find((x: any) => x.id === item.purchasePackId) ?? item.packs?.[0]; set({ itemId: id, packId: p?.id ?? '', unitCost: offerCost(item, p?.id ?? '') }); }} />,
            it ? <Sel className="w-36" value={l.packId} onChange={(e) => set({ packId: e.target.value, unitCost: offerCost(it, e.target.value) })} options={[{ value: '', label: unitLabel(it.unit) }, ...(it.packs ?? []).map((p: any) => ({ value: p.id, label: L(p.name) }))]} /> : '—',
            <Inp data-fb={`direct:qty:${i}`} className="w-20" inputMode="decimal" value={l.quantity} onChange={(e) => set({ quantity: e.target.value.replace(/[^\d.]/g, '') })} />,
            <Inp data-fb={`direct:cost:${i}`} className="w-24" inputMode="decimal" value={l.unitCost} onChange={(e) => set({ unitCost: e.target.value.replace(/[^\d.]/g, '') })} />,
            <span className="num text-xs">{money((Number(l.quantity || 0) * Number(l.unitCost || 0)).toFixed(4))}</span>,
            it?.trackLots ? <Inp className="w-36" type="date" value={l.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /> : <span className="text-dim text-xs">—</span>,
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        <Button size="sm" data-fb="direct:add" onClick={() => setLines([...lines, { itemId: '', packId: '', quantity: '', unitCost: '', expiryDate: '' }])}><Plus className="w-3.5 h-3.5" />{t('صنف كمان')}</Button>
      </div>
    </FullPage>
  );
}
export { Wand2, Toolbar };
