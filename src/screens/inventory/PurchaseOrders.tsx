// Purchase orders: draft (by hand or from the low-stock suggestions, one per supplier), issue to the supplier,
// receive against it (partially or fully), close the remainder or cancel.
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, ShoppingBag, Send, XCircle, Lock, PackageCheck, Pencil, Trash2, Save, MessageSquareText, Wand2 } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, Empty, EmptyState, Field, Input, KV, Modal, Drawer, Money, PageHeader, Pill, Section, Select, Spinner, StatCard, StatGrid, StateBadge, Table, Textarea, Toolbar } from '../../ui';
import { t, L, tv } from '../../i18n';
import { dateTime, money } from '../../lib/format';
import { BranchScope, ItemPicker, PO_STATE, Qty, StatePill, WarehouseSelect, fmtQty, unitLabel, useBranchScope, useItemsCatalog, useList, useWarehouses, Inp, Sel } from './common';
import { ReceiveDialog } from './Receipts';
import { clock } from '../../mock/clock';
import { personText } from '../../demo/people';

const OPS = ['PurchaseOrder.Create', 'PurchaseOrder.Update', 'PurchaseOrder.Issue', 'PurchaseOrder.Find', 'PurchaseOrder.Get', 'PurchaseOrder.Close', 'PurchaseOrder.Cancel', 'Inventory.LowStock'];

export default function PurchaseOrders() {
  const { params } = useDev();
  const scope = useBranchScope();
  const [state, setState] = useState('');
  const [supplier, setSupplier] = useState('');
  const suppliers = useList<any>('Supplier.List');
  const q = useList<any>('PurchaseOrder.Find', { branchId: scope.branchId, lifecycle: state || undefined, supplierId: supplier || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [editor, setEditor] = useState<any | null>(params?.create ? { supplierId: params?.supplierId } : null);
  const [suggest, setSuggest] = useState(!!params?.fromLowStock);
  useEffect(() => { if (params?.fromLowStock) setSuggest(true); if (params?.create) setEditor({ supplierId: params?.supplierId }); }, [params?.fromLowStock, params?.create, params?.supplierId]);
  const all = useList<any>('PurchaseOrder.Find', { branchId: scope.branchId });
  const openPos = all.items.filter((p) => ['DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state));
  const waiting = all.items.filter((p) => ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state));
  const today = new Date(clock.now()).toISOString().slice(0, 10);
  const late = waiting.filter((p) => p.expectedDate && p.expectedDate < today);
  const loading = all.loading && !all.raw;
  return (
    <div className="space-y-4">
      <PageHeader icon={<ShoppingBag />} title={t('أوامر الشراء')} badge={<StateBadge ops={OPS} />} description={t('اطلب من المورد: مسودة ← اتبعت للمورد ← اتستلم جزء أو كله ← اتقفل. ممكن تعمل الأوامر أوتوماتيك من النواقص.')}
        actions={<><BranchScope scope={scope} /><Button data-fb="po:suggest" onClick={() => setSuggest(true)}><Wand2 className="w-4 h-4" />{t('من النواقص')}</Button><Button data-fb="po:new" variant="primary" onClick={() => setEditor({})}><Plus className="w-4 h-4" />{t('أمر شراء جديد')}</Button></>} />
      <StatGrid>
        <StatCard label={t('أوامر مفتوحة')} value={openPos.length} icon={<ShoppingBag />} loading={loading} hint={t('بقيمة {m}', { m: money(String(openPos.reduce((a, p) => a + Number(p.total), 0))) })} onClick={() => setState(state === 'DRAFT,ISSUED,PARTIALLY_RECEIVED' ? '' : 'DRAFT,ISSUED,PARTIALLY_RECEIVED')} />
        <StatCard label={t('مسودات لسه ما اتبعتتش')} value={all.items.filter((p) => p.state === 'DRAFT').length} icon={<Pencil />} loading={loading} onClick={() => setState(state === 'DRAFT' ? '' : 'DRAFT')} />
        <StatCard label={t('مستنيين الاستلام')} value={waiting.length} icon={<PackageCheck />} tone={waiting.length ? 'info' : 'neutral'} loading={loading} onClick={() => setState(state === 'ISSUED,PARTIALLY_RECEIVED' ? '' : 'ISSUED,PARTIALLY_RECEIVED')} />
        <StatCard label={t('متأخرين عن ميعاد التوريد')} value={late.length} icon={<XCircle />} tone={late.length ? 'error' : 'neutral'} loading={loading} hint={late.length ? late.map((p) => tv(p.supplierName)).slice(0, 2).join(t('، ')) : t('كله في ميعاده')} />
      </StatGrid>
      <Card padding="sm">
        <Toolbar>
          <Sel className="w-52" data-fb="po:state" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, { value: 'DRAFT,ISSUED,PARTIALLY_RECEIVED', label: t('المفتوحة بس') }, { value: 'ISSUED,PARTIALLY_RECEIVED', label: t('مستنية الاستلام') }, ...Object.entries(PO_STATE).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} />
          <Sel className="w-60" value={supplier} onChange={(e) => setSupplier(e.target.value)} options={[{ value: '', label: t('كل الموردين') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} />
        </Toolbar>
        <Table loading={q.loading && !q.raw} onRowClick={(i) => setOpen(q.items[i].id)} align={[undefined, undefined, undefined, undefined, 'end', 'end', undefined, 'end']}
          empty={<EmptyState compact icon={<ShoppingBag />} title={t('مفيش أوامر شراء')} text={t('اعمل أمر شراء جديد، أو خلّي السيستم يجهّزه من النواقص.')} action={<Button variant="primary" onClick={() => setSuggest(true)}><Wand2 className="w-4 h-4" />{t('من النواقص')}</Button>} />}
          head={[t('الرقم'), t('المورد'), t('يستلم في'), t('الحالة'), t('القيمة'), t('اتستلم'), t('ميعاد التوريد'), '']} rows={q.items.map((p) => [
          <span className="num font-bold" data-fb={`po:open:${p.id}`}>{p.number}</span>,
          <span className="font-bold">{tv(p.supplierName)}</span>, <span className="text-xs">{tv(p.warehouse.name)}</span>, <StatePill map={PO_STATE} state={p.state} />,
          <Money v={p.total} className="text-xs" />, Number(p.receivedValue) > 0 ? <Money v={p.receivedValue} className="text-xs" tone="success" /> : <span className="text-dim text-xs">—</span>,
          <span className={`num text-xs ${p.expectedDate && p.expectedDate < today && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) ? 'text-[var(--error)] font-bold' : ''}`}>{p.expectedDate ?? '—'}</span>,
          <Button size="sm" variant={p.state === 'DRAFT' || ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) ? 'outline' : 'ghost'} onClick={(e) => { e.stopPropagation(); setOpen(p.id); }}>{p.state === 'DRAFT' ? t('راجع وابعت') : ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.state) ? t('استلم') : t('اعرض')}</Button>,
        ])} />
      </Card>
      {suggest && <Suggestions branchId={scope.branchId} onClose={() => setSuggest(false)} onDone={(id) => { setSuggest(false); if (id) setOpen(id); }} />}
      {editor && <PoEditor init={editor} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); setOpen(id); }} />}
      <PoView id={open} onClose={() => setOpen(null)} onEdit={(po) => { setOpen(null); setEditor({ po }); }} />
    </div>
  );
}

function Suggestions({ branchId, onClose, onDone }: { branchId?: string; onClose: () => void; onDone: (id?: string) => void }) {
  const { run, busy } = useCommand();
  const low = useList<any>('Inventory.LowStock', { branchId });
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const [pick, setPick] = useState<Record<string, { on: boolean; packs: string; cost: string; supplier: string }>>({});
  const rows = low.items.filter((r) => !(r.openPurchaseOrders?.length));
  const already = low.items.filter((r) => r.openPurchaseOrders?.length);
  useEffect(() => {
    const init: typeof pick = {};
    for (const r of rows) {
      const key = `${r.item.id}|${r.warehouse.id}`;
      init[key] = { on: !!r.defaultSupplierId, packs: r.suggestedPacks ?? r.suggestedQuantity, cost: r.pack ? (Number(r.unitCost) * Number(r.pack.factor)).toFixed(2) : Number(r.unitCost).toFixed(2), supplier: r.defaultSupplierId ?? '' };
    }
    setPick(init);
  }, [low.raw]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const r of rows) { const k = `${r.item.id}|${r.warehouse.id}`; const p = pick[k]; if (!p?.on || !p.supplier) continue; const gk = `${p.supplier}|${r.warehouse.id}`; g.set(gk, [...(g.get(gk) ?? []), { r, p }]); }
    return g;
  }, [rows, pick]);
  const create = async () => {
    let last: string | undefined;
    for (const [gk, list] of groups) {
      const [supplierId, warehouseId] = gk.split('|');
      const res = await run<any>('PurchaseOrder.Create', { body: { supplierId, warehouseId, note: t('من النواقص'), lines: list.map(({ r, p }) => ({ itemId: r.item.id, packId: r.pack?.id ?? null, orderedQuantity: p.packs, orderedUnitCost: p.cost })) } });
      if (!res) return;
      last = res.id;
    }
    onDone(last);
  };
  const total = [...groups.values()].flat().reduce((a, { p }) => a + Number(p.packs) * Number(p.cost), 0);
  return (
    <Modal open onClose={onClose} xwide title={t('اطلب النواقص')} badge={<StateBadge ops={['Inventory.LowStock', 'PurchaseOrder.Create']} />}
      footer={<><span className="text-sm me-auto">{t('{n} أمر شراء', { n: groups.size })} · <b className="num">{money(total.toFixed(4))}</b></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="po-suggest:create" loading={busy} disabled={!groups.size} onClick={create}><ShoppingBag className="w-4 h-4" />{t('اعمل أوامر الشراء (مسودة)')}</Button></>}>
      {low.loading && !low.raw ? <Spinner /> : rows.length === 0 ? <Empty text={already.length ? t('كل النواقص عليها أوامر شراء مفتوحة بالفعل.') : t('مفيش نواقص — كله فوق الحد الأدنى.')} /> : (
        <div className="space-y-3">
          <Banner tone="info">{t('الكمية المقترحة بتكمّل لحد "المستهدف" ومتقرّبة لعبوة الشراء. هيتعمل أمر شراء لكل مورد ومخزن — راجعه وابعته بعد كده.')}</Banner>
          <Table head={['', t('الصنف'), t('المخزن'), t('الموجود / الحد'), t('المورد'), t('الكمية'), t('السعر'), t('الإجمالي')]} rows={rows.map((r) => {
            const key = `${r.item.id}|${r.warehouse.id}`;
            const p = pick[key];
            if (!p) return [];
            const set = (patch: Partial<typeof p>) => setPick({ ...pick, [key]: { ...p, ...patch } });
            return [
              <input type="checkbox" data-fb={`po-suggest:on:${r.item.id}`} checked={p.on} onChange={(e) => set({ on: e.target.checked })} />,
              <span className="font-bold">{L(r.item.name)}</span>, <span className="text-xs">{tv(r.warehouse.name)}</span>,
              <span className="text-xs"><Qty v={r.onHand} unit={r.item.unit} hint={false} /> / <span className="num">{fmtQty(r.min)}</span></span>,
              <Sel className="w-44" value={p.supplier} onChange={(e) => set({ supplier: e.target.value })} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} />,
              <div className="flex items-center gap-1"><Inp className="w-20" inputMode="decimal" value={p.packs} onChange={(e) => set({ packs: e.target.value })} /><span className="text-[11px] text-dim">{r.pack ? L(r.pack.name) : unitLabel(r.item.unit)}</span></div>,
              <Inp className="w-24" inputMode="decimal" value={p.cost} onChange={(e) => set({ cost: e.target.value })} />,
              <span className="num text-xs">{money((Number(p.packs) * Number(p.cost)).toFixed(4))}</span>,
            ];
          })} />
          {already.length > 0 && <div className="text-xs text-dim">{t('عليهم أوامر مفتوحة')}: {already.map((r) => `${L(r.item.name)} (${r.openPurchaseOrders.map((o: any) => o.number).join(t('، '))})`).join(' · ')}</div>}
        </div>
      )}
    </Modal>
  );
}

interface PLine { itemId: string; packId: string; orderedQuantity: string; orderedUnitCost: string }
function PoEditor({ init, onClose, onSaved }: { init: any; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const po = init.po;
  const suppliers = useList<any>('Supplier.List', { active: 'true' });
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [supplierId, setSupplierId] = useState<string>(po?.supplierId ?? init.supplierId ?? '');
  const [wh, setWh] = useState<string>(po?.warehouseId ?? '');
  const [date, setDate] = useState<string>(po?.expectedDate ?? '');
  const [note, setNote] = useState<string>(po?.note ?? '');
  const [lines, setLines] = useState<PLine[]>(po ? po.lines.map((l: any) => ({ itemId: l.itemId, packId: l.packId ?? '', orderedQuantity: l.orderedQuantity, orderedUnitCost: l.orderedUnitCost })) : [{ itemId: '', packId: '', orderedQuantity: '', orderedUnitCost: '' }]);
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.kind === 'STORE')?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  const supplierItems = items.items.filter((i) => !supplierId || i.defaultSupplierId === supplierId);
  const total = lines.reduce((a, l) => a + Number(l.orderedQuantity || 0) * Number(l.orderedUnitCost || 0), 0);
  const body = () => ({ lines: lines.filter((l) => l.itemId && Number(l.orderedQuantity) > 0).map((l) => ({ itemId: l.itemId, packId: l.packId || null, orderedQuantity: l.orderedQuantity, orderedUnitCost: l.orderedUnitCost || '0' })), expectedDate: date || null, note });
  const save = async () => {
    const r = po
      ? await run<any>('PurchaseOrder.Update', { params: { purchaseOrderId: po.id }, body: { ...body(), expectedVersion: po.version, warehouseId: wh } }, { success: t('أمر الشراء اتعدل') })
      : await run<any>('PurchaseOrder.Create', { body: { ...body(), supplierId, warehouseId: wh } }, { success: t('أمر الشراء اتحفظ كمسودة') });
    if (r) onSaved(r.id);
  };
  const [showAll, setShowAll] = useState(false);
  return (
    <Drawer width="xl" open onClose={onClose} title={po ? t('تعديل أمر شراء {n}', { n: po.number }) : t('أمر شراء جديد')} badge={<StateBadge ops={[po ? 'PurchaseOrder.Update' : 'PurchaseOrder.Create']} />}
      footer={<><span className="text-sm me-auto">{t('الإجمالي')}: <b className="num">{money(total.toFixed(4))}</b></span><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="po-edit:save" loading={busy} disabled={!supplierId || !wh || !lines.some((l) => l.itemId && Number(l.orderedQuantity) > 0)} onClick={save}><Save className="w-4 h-4" />{t('احفظ مسودة')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Field label={t('المورد')}><Select data-fb="po-edit:supplier" disabled={!!po} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: '', label: t('اختار') }, ...suppliers.items.map((s) => ({ value: s.id, label: tv(s.name) }))]} /></Field>
          <Field label={t('يستلم في')}><WarehouseSelect fb="po-edit:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
          <Field label={t('ميعاد التوريد')}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{t('اعرض كل الأصناف (مش بس أصناف المورد ده)')}</label>
        <Table head={[t('الصنف'), t('العبوة'), t('الكمية'), t('سعر العبوة'), t('الإجمالي'), '']} rows={lines.map((l, i) => {
          const it = items.items.find((x) => x.id === l.itemId);
          const set = (patch: Partial<PLine>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return [
            <ItemPicker fb={`po-edit:item:${i}`} className="min-w-[200px]" items={showAll ? items.items : supplierItems} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => { const pk = item.packs?.find((p: any) => p.id === item.purchasePackId) ?? item.packs?.[0]; set({ itemId: id, packId: pk?.id ?? '', orderedUnitCost: (Number(item.avgCost) * Number(pk?.factor ?? 1)).toFixed(2) }); }} />,
            it ? <Sel className="w-40" value={l.packId} onChange={(e) => { const pk = it.packs.find((p: any) => p.id === e.target.value); set({ packId: e.target.value, orderedUnitCost: (Number(it.avgCost) * Number(pk?.factor ?? 1)).toFixed(2) }); }} options={[{ value: '', label: unitLabel(it.unit) }, ...(it.packs ?? []).map((p: any) => ({ value: p.id, label: L(p.name) }))]} /> : '—',
            <Inp data-fb={`po-edit:qty:${i}`} className="w-20" inputMode="decimal" value={l.orderedQuantity} onChange={(e) => set({ orderedQuantity: e.target.value.replace(/[^\d.]/g, '') })} />,
            <Inp data-fb={`po-edit:cost:${i}`} className="w-24" inputMode="decimal" value={l.orderedUnitCost} onChange={(e) => set({ orderedUnitCost: e.target.value.replace(/[^\d.]/g, '') })} />,
            <span className="num text-xs">{money((Number(l.orderedQuantity || 0) * Number(l.orderedUnitCost || 0)).toFixed(4))}</span>,
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: '', packId: '', orderedQuantity: '', orderedUnitCost: '' }])}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        <Button size="sm" data-fb="po-edit:add" onClick={() => setLines([...lines, { itemId: '', packId: '', orderedQuantity: '', orderedUnitCost: '' }])}><Plus className="w-3.5 h-3.5" />{t('صنف كمان')}</Button>
      </div>
    </Drawer>
  );
}

function PoView({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (po: any) => void }) {
  const { run, busy } = useCommand();
  const q = useQuery<any>(id ? 'PurchaseOrder.Get' : null, { params: { purchaseOrderId: id } });
  const po = q.data;
  const [ask, setAsk] = useState<null | 'cancel' | 'close'>(null);
  const [reason, setReason] = useState('');
  const [receive, setReceive] = useState(false);
  const [msg, setMsg] = useState(false);
  if (!id) return null;
  const open = po && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(po.state);
  const message = po ? `${t('السلام عليكم')} ${po.supplierName}،\n${t('طلبية رقم')} ${po.number}${po.expectedDate ? ` — ${t('التوريد يوم')} ${po.expectedDate}` : ''}:\n${po.lines.map((l: any) => `• ${L(l.item?.name)}: ${fmtQty(l.orderedQuantity)} ${l.packId ? L(l.item?.packs?.find((p: any) => p.id === l.packId)?.name) : unitLabel(l.item?.unit)}`).join('\n')}\n${t('الإجمالي التقريبي')}: ${money(po.total)}\n${t('شكرًا')}` : '';
  return (
    <Drawer width="xl" open onClose={onClose} title={po ? <span className="flex items-center gap-2">{t('أمر شراء')} <span className="num">{po.number}</span> — {tv(po.supplierName)}</span> : t('أمر شراء')} badge={po ? <><StatePill map={PO_STATE} state={po.state} /><StateBadge ops={OPS} /></> : undefined}
      footer={po && <>
        {['DRAFT', 'ISSUED'].includes(po.state) && <Button variant="danger" data-fb="po-view:cancel" onClick={() => { setReason(''); setAsk('cancel'); }}><XCircle className="w-4 h-4" />{t('الغي')}</Button>}
        {open && <Button data-fb="po-view:close" onClick={() => { setReason(''); setAsk('close'); }}><Lock className="w-4 h-4" />{t('اقفل الأمر (الباقي مش جاي)')}</Button>}
        <Button variant="ghost" data-fb="po-view:message" onClick={() => setMsg(!msg)}><MessageSquareText className="w-4 h-4" />{t('رسالة للمورد')}</Button>
        <div className="flex-1" />
        {po.state === 'DRAFT' && <Button data-fb="po-view:edit" onClick={() => onEdit(po)}><Pencil className="w-4 h-4" />{t('تعديل')}</Button>}
        {po.state === 'DRAFT' && <Button variant="primary" data-fb="po-view:issue" loading={busy} onClick={() => run('PurchaseOrder.Issue', { params: { purchaseOrderId: po.id }, body: { expectedVersion: po.version } }, { success: t('أمر الشراء اتبعت للمورد') })}><Send className="w-4 h-4" />{t('ابعت للمورد')}</Button>}
        {open && <Button variant="success" data-fb="po-view:receive" onClick={() => setReceive(true)}><PackageCheck className="w-4 h-4" />{t('استلام')}</Button>}
      </>}>
      {!po ? <Spinner /> : (
        <div className="space-y-3">
          <KV rows={[[t('يستلم في'), `${tv(po.warehouse.name)} — ${tv(po.warehouse.branchName)}`], [t('ميعاد التوريد'), po.expectedDate ?? '—'], [t('اتعمل'), `${dateTime(po.createdAt)} · ${personText(po.createdByName)}`], [t('ملاحظة'), tv(po.note) ?? '—'], ...(po.closeReason ? [[t('سبب القفل'), po.closeReason] as [string, string]] : []), ...(po.cancelReason ? [[t('سبب الإلغاء'), tv(po.cancelReason)] as [string, string]] : [])]} />
          {msg && <Textarea readOnly className="min-h-[140px] text-sm" value={message} onFocus={(e) => e.currentTarget.select()} />}
          <Table head={[t('الصنف'), t('المطلوب'), t('سعر العبوة'), t('الإجمالي'), t('اتستلم'), t('باقي')]} rows={po.lines.map((l: any) => [
            <span className="font-bold">{L(l.item?.name)}</span>,
            <span className="num">{fmtQty(l.orderedQuantity)} {l.packId ? L(l.item?.packs?.find((p: any) => p.id === l.packId)?.name) : unitLabel(l.item?.unit)}{l.packId && <span className="text-[11px] text-dim"> = {fmtQty(l.orderedStockQuantity)} {unitLabel(l.item?.unit)}</span>}</span>,
            <span className="num text-xs">{money(l.orderedUnitCost)}</span>, <Money v={l.lineTotal} className="text-xs" />,
            Number(l.receivedQuantity) > 0 ? <Qty v={l.receivedQuantity} unit={l.item?.unit} className="text-[var(--success)]" /> : <span className="text-dim">—</span>,
            Number(l.outstandingQuantity) > 0 ? <Qty v={l.outstandingQuantity} unit={l.item?.unit} /> : <span className="text-dim">—</span>,
          ])} />
          <div className="flex justify-between text-sm"><span>{t('الإجمالي')}: <b className="num">{money(po.total)}</b></span><span>{t('اتستلم بقيمة')}: <b className="num">{money(po.receivedValue)}</b></span></div>
          {po.receipts?.length > 0 && (
            <div><div className="text-xs font-bold text-soft mb-1">{t('الاستلامات')}</div>
              <div className="flex flex-wrap gap-1.5">{po.receipts.map((r: any) => <Pill key={r.id} tone={r.state === 'REVERSED' ? 'error' : 'success'}><span className="num">{r.number}</span> · {dateTime(r.at)} · <span className="num">{money(r.total)}</span>{r.state === 'REVERSED' ? ` · ${t('اتلغى')}` : ''}</Pill>)}</div>
            </div>
          )}
          <div><div className="text-xs font-bold text-soft mb-1">{t('السجل')}</div>
            <ol className="space-y-1 border-s-2 line ps-3 text-xs">{po.history.map((h: any, i: number) => <li key={i}><span className="text-dim">{dateTime(h.at)}</span> · {poHistoryText(h.text)}</li>)}</ol>
          </div>
          <Tech><div className="text-[11px] num text-dim">{po.id} · v{po.version}</div></Tech>
        </div>
      )}
      {ask && po && (
        <Modal open onClose={() => setAsk(null)} title={ask === 'cancel' ? t('إلغاء أمر الشراء') : t('قفل أمر الشراء')} badge={<StateBadge ops={[ask === 'cancel' ? 'PurchaseOrder.Cancel' : 'PurchaseOrder.Close']} />}
          footer={<><Button onClick={() => setAsk(null)}>{t('رجوع')}</Button><Button variant="danger" data-fb="po-ask:go" loading={busy} disabled={ask === 'cancel' && !reason.trim()} onClick={async () => { const r = await run(ask === 'cancel' ? 'PurchaseOrder.Cancel' : 'PurchaseOrder.Close', { params: { purchaseOrderId: po.id }, body: { expectedVersion: po.version, reason } }, { success: ask === 'cancel' ? t('أمر الشراء اتلغى') : t('أمر الشراء اتقفل — الباقي اتلغى') }); if (r) setAsk(null); }}>{ask === 'cancel' ? t('الغي') : t('اقفل')}</Button></>}>
          <div className="space-y-2">
            <div className="text-sm">{ask === 'cancel' ? t('الإلغاء بيتعمل بس لو لسه ما اتستلمش أي حاجة.') : t('القفل بيلغي الكمية الباقية اللي لسه ما وصلتش، واللي اتستلم بيفضل زي ما هو.')}</div>
            <Field label={t('السبب')}><Textarea data-fb="po-ask:reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
      {receive && po && <ReceiveDialog po={po} onClose={() => setReceive(false)} />}
    </Drawer>
  );
}
const poHistoryText = (s: string) => s.replace(/^DRAFT$/, t('اتعمل مسودة')).replace(/^ISSUED$/, t('اتبعت للمورد')).replace(/^CANCELLED/, t('اتلغى')).replace(/^CLOSED/, t('اتقفل')).replace('lines updated', t('الأصناف اتعدلت')).replace(/^received (\S+) → (\S+)$/, (_m, n, st) => `${t('استلام')} ${n} ← ${t(PO_STATE[st]?.ar ?? st)}`).replace(/^received → (\S+)$/, (_m, st) => `${t('استلام')} ← ${t(PO_STATE[st]?.ar ?? st)}`).replace(/^receipt (\S+) reversed → (\S+)$/, (_m, n, st) => `${t('إلغاء استلام')} ${n} ← ${t(PO_STATE[st]?.ar ?? st)}`);
