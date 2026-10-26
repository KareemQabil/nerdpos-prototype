// Transfers between warehouses (store → kitchen, or to another branch): draft, send (leaves the source, in transit),
// receive at the destination (a shortage is recorded), or cancel a draft.
import React, { useEffect, useState } from 'react';
import { Plus, ArrowLeftRight, Truck, PackageCheck, XCircle, Trash2, ArrowLeft } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Empty, Field, Input, KV, Modal, Money, Section, Select, Spinner, StateBadge, Table, Textarea } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { BranchScope, ItemPicker, Qty, StatePill, TRANSFER_STATE, WarehouseSelect, fmtQty, unitOptions, useBranchScope, useList, useWarehouses, Inp, Sel } from './common';

const OPS = ['Transfer.Create', 'Stock.Transfer', 'Transfer.Receive', 'Transfer.Cancel', 'Transfer.Find', 'Transfer.Get'];

export default function Transfers() {
  const { params } = useDev();
  const scope = useBranchScope();
  const [state, setState] = useState('');
  const list = useList<any>('Transfer.Find', { branchId: scope.branchId, lifecycle: state || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(!!params?.create);
  useEffect(() => { if (params?.create) setCreating(true); }, [params?.create]);
  return (
    <div>
      <Section title={t('التحويلات')} badge={<StateBadge ops={OPS} />} sub={t('نقل بضاعة من مخزن لمخزن: من المخزن الرئيسي للمطبخ، أو لفرع تاني. البضاعة بتطلع من المخزن أول ما تتبعت، وبتدخل لما تتستلم.')}
        actions={<><BranchScope scope={scope} /><Button data-fb="transfers:new" variant="primary" onClick={() => setCreating(true)}><Plus className="w-4 h-4" />{t('تحويل جديد')}</Button></>} />
      <div className="flex gap-2 mb-3"><Sel className="w-52" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, ...Object.entries(TRANSFER_STATE).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} /></div>
      {list.loading && !list.raw ? <Spinner /> : list.items.length === 0 ? <Empty icon={<ArrowLeftRight className="w-10 h-10" />} text={t('مفيش تحويلات')} /> : (
        <Table head={[t('الرقم'), t('من'), t('إلى'), t('الحالة'), t('الأصناف'), t('القيمة'), t('آخر تحديث'), '']} rows={list.items.map((tr) => [
          <button className="num font-bold hover:text-[var(--primary)]" data-fb={`transfers:open:${tr.id}`} onClick={() => setOpen(tr.id)}>{tr.number}</button>,
          <span>{tr.from.name} <span className="text-[11px] text-dim">{tr.from.branchName}</span></span>,
          <span>{tr.to.name} <span className="text-[11px] text-dim">{tr.to.branchName}</span></span>,
          <StatePill map={TRANSFER_STATE} state={tr.state} />,
          <span className="text-xs">{tr.lines.map((l: any) => L(l.item?.name)).slice(0, 3).join('، ')}{tr.lines.length > 3 ? ` +${tr.lines.length - 3}` : ''}</span>,
          <Money v={tr.value} className="text-xs" />,
          <span className="text-xs text-dim">{dateTime(tr.receivedAt ?? tr.dispatchedAt ?? tr.cancelledAt ?? tr.createdAt)}</span>,
          <Button size="sm" onClick={() => setOpen(tr.id)}>{tr.state === 'DRAFT' ? t('ابعت') : tr.state === 'DISPATCHED' ? t('استلم') : t('اعرض')}</Button>,
        ])} />
      )}
      {creating && <CreateTransfer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpen(id); }} />}
      <TransferView id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function CreateTransfer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const whs = useWarehouses();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [lines, setLines] = useState<{ itemId: string; quantity: string; unit: string }[]>([{ itemId: '', quantity: '', unit: '' }]);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!from && whs.items.length) {
      const mine = whs.items.filter((w) => w.branchId === auth.branchId && w.active);
      setFrom(mine.find((w) => !w.salesDefault)?.id ?? mine[0]?.id ?? whs.items[0].id);
      setTo(mine.find((w) => w.salesDefault)?.id ?? '');
    }
  }, [whs.items, from, auth.branchId]);
  const stock = useList<any>(from ? 'InventoryItem.Find' : null, { warehouseId: from, active: 'true' });
  const create = async (dispatch: boolean) => {
    const body = { fromWarehouseId: from, toWarehouseId: to, note: note || undefined, lines: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: l.quantity, unit: l.unit || undefined })) };
    const r = await run<any>('Transfer.Create', { body }, { success: dispatch ? undefined : t('التحويل اتحفظ كمسودة') });
    if (!r) return;
    if (dispatch) await run('Stock.Transfer', { params: { transferId: r.id }, body: { expectedVersion: r.version } }, { success: t('التحويل اتبعت — البضاعة في الطريق') });
    onCreated(r.id);
  };
  const valid = from && to && from !== to && lines.some((l) => l.itemId && Number(l.quantity) > 0);
  return (
    <Modal open onClose={onClose} xwide title={t('تحويل جديد')} badge={<StateBadge ops={['Transfer.Create', 'Stock.Transfer']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button data-fb="transfer-new:draft" loading={busy} disabled={!valid} onClick={() => create(false)}>{t('احفظ مسودة')}</Button><Button variant="primary" data-fb="transfer-new:send" loading={busy} disabled={!valid} onClick={() => create(true)}><Truck className="w-4 h-4" />{t('احفظ وابعت')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <Field label={t('من مخزن')}><WarehouseSelect fb="transfer-new:from" value={from} onChange={setFrom} warehouses={whs.items} /></Field>
          <ArrowLeft className="w-5 h-5 mb-2.5 text-dim" />
          <Field label={t('إلى مخزن')}><WarehouseSelect fb="transfer-new:to" value={to} onChange={setTo} warehouses={whs.items} includeAll={t('اختار')} exclude={from} /></Field>
        </div>
        <Table head={[t('الصنف'), t('الموجود في المخزن ده'), t('الكمية'), '']} rows={lines.map((l, i) => {
          const it = stock.items.find((x) => x.id === l.itemId);
          const opts = unitOptions(it);
          const have = it?.stock?.[0]?.quantity;
          return [
            <ItemPicker fb={`transfer-new:item:${i}`} className="min-w-[220px]" items={stock.items} value={l.itemId} exclude={lines.filter((_, j) => j !== i).map((x) => x.itemId)} onChange={(id, item) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: id, unit: item.stockUnitId } : x)))} />,
            it ? <Qty v={have} unit={it.unit} /> : '—',
            <div className="flex gap-1"><Inp data-fb={`transfer-new:qty:${i}`} className="w-24" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x)))} />{opts.length > 1 && <Sel className="w-32" value={l.unit} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} options={opts.map((o) => ({ value: o.value, label: o.label }))} />}</div>,
            <Button size="sm" variant="ghost" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ itemId: '', quantity: '', unit: '' }])}><Trash2 className="w-3.5 h-3.5" /></Button>,
          ];
        })} />
        <Button size="sm" data-fb="transfer-new:add" onClick={() => setLines([...lines, { itemId: '', quantity: '', unit: '' }])}><Plus className="w-3.5 h-3.5" />{t('صنف كمان')}</Button>
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثال: تحويل الصبح للمطبخ')} /></Field>
      </div>
    </Modal>
  );
}

function TransferView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { run, busy } = useCommand();
  const q = useQuery<any>(id ? 'Transfer.Get' : null, { params: { transferId: id } });
  const tr = q.data;
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [cancel, setCancel] = useState<string | null>(null);
  useEffect(() => { if (tr?.state === 'DISPATCHED') setRecv(Object.fromEntries(tr.lines.map((l: any) => [l.itemId, l.quantity]))); }, [tr?.id, tr?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!id) return null;
  const short = tr?.state === 'DISPATCHED' ? tr.lines.some((l: any) => Number(recv[l.itemId] ?? l.quantity) < Number(l.quantity)) : false;
  return (
    <Modal open onClose={onClose} xwide title={tr ? <span className="flex items-center gap-2">{t('تحويل')} <span className="num">{tr.number}</span></span> : t('تحويل')} badge={tr ? <><StatePill map={TRANSFER_STATE} state={tr.state} /><StateBadge ops={OPS} /></> : undefined}
      footer={tr && <>
        {tr.state === 'DRAFT' && <Button variant="danger" data-fb="transfer:cancel" onClick={() => setCancel('')}><XCircle className="w-4 h-4" />{t('الغي')}</Button>}
        <div className="flex-1" />
        {tr.state === 'DRAFT' && <Button variant="primary" data-fb="transfer:dispatch" loading={busy} onClick={() => run('Stock.Transfer', { params: { transferId: tr.id }, body: { expectedVersion: tr.version } }, { success: t('اتبعت — البضاعة طلعت من {w}', { w: tr.from.name }) })}><Truck className="w-4 h-4" />{t('ابعت (اطلع من المخزن)')}</Button>}
        {tr.state === 'DISPATCHED' && <Button variant="success" data-fb="transfer:receive" loading={busy} onClick={() => run('Transfer.Receive', { params: { transferId: tr.id }, body: { expectedVersion: tr.version, lines: tr.lines.map((l: any) => ({ itemId: l.itemId, receivedQuantity: recv[l.itemId] ?? l.quantity })) } }, { success: t('اتستلم في {w}', { w: tr.to.name }) })}><PackageCheck className="w-4 h-4" />{short ? t('استلم (فيه عجز)') : t('استلم كله')}</Button>}
      </>}>
      {!tr ? <Spinner /> : (
        <div className="space-y-3">
          <KV rows={[
            [t('من'), `${tr.from.name} — ${tr.from.branchName}`], [t('إلى'), `${tr.to.name} — ${tr.to.branchName}`],
            [t('اتعمل'), `${dateTime(tr.createdAt)} · ${tr.createdByName}`],
            ...(tr.dispatchedAt ? [[t('اتبعت'), `${dateTime(tr.dispatchedAt)} · ${tr.dispatchedByName}`] as [string, string]] : []),
            ...(tr.receivedAt ? [[t('اتستلم'), `${dateTime(tr.receivedAt)} · ${tr.receivedByName}`] as [string, string]] : []),
            [t('ملاحظة'), tr.note ?? '—'],
          ]} />
          {tr.state === 'DISPATCHED' && <Banner tone="info">{t('البضاعة في الطريق: طلعت من {f} ولسه ما دخلتش {t}. لو وصل أقل، اكتب اللي وصل فعلًا — الفرق بيتسجل عجز تحويل.', { f: tr.from.name, t: tr.to.name })}</Banner>}
          {tr.state === 'RECEIVED' && Number(tr.shortValue) > 0 && <Banner tone="warning">{t('وصل ناقص — قيمة العجز')} <b className="num"><Money v={tr.shortValue} /></b></Banner>}
          {tr.state === 'CANCELLED' && <Banner tone="error">{t('اتلغى')}: {tr.cancelReason}</Banner>}
          <Table head={[t('الصنف'), t('اتبعت'), ...(tr.state === 'DISPATCHED' ? [t('وصل فعلًا')] : tr.state === 'RECEIVED' ? [t('وصل'), t('العجز')] : []), t('التكلفة'), t('الدفعات')]} rows={tr.lines.map((l: any) => [
            <span className="font-bold">{L(l.item?.name)}</span>,
            <Qty v={l.quantity} unit={l.item?.unit} />,
            ...(tr.state === 'DISPATCHED' ? [<Inp data-fb={`transfer:recv:${l.itemId}`} className="w-28" inputMode="decimal" value={recv[l.itemId] ?? l.quantity} onChange={(e) => setRecv({ ...recv, [l.itemId]: e.target.value.replace(/[^\d.]/g, '') })} />] : tr.state === 'RECEIVED' ? [<Qty v={l.receivedQuantity} unit={l.item?.unit} />, Number(l.shortQuantity) > 0 ? <Qty v={l.shortQuantity} unit={l.item?.unit} className="text-[var(--error)]" /> : '—'] : []),
            l.value ? <Money v={l.value} className="text-xs" /> : <span className="text-xs text-dim">{t('بتتحدد وقت البعت')}</span>,
            <span className="text-[11px] text-dim">{l.lots?.map((x: any) => `${x.lotCode}${x.expiryDate ? ' (' + x.expiryDate + ')' : ''}`).join('، ') || '—'}</span>,
          ])} />
          <Tech><div className="text-[11px] num text-dim">{tr.id} · v{tr.version}</div></Tech>
        </div>
      )}
      {cancel !== null && tr && (
        <Modal open onClose={() => setCancel(null)} title={t('إلغاء التحويل')} footer={<><Button onClick={() => setCancel(null)}>{t('رجوع')}</Button><Button variant="danger" data-fb="transfer-cancel:go" disabled={!cancel.trim()} loading={busy} onClick={async () => { const r = await run('Transfer.Cancel', { params: { transferId: tr.id }, body: { expectedVersion: tr.version, reason: cancel } }, { success: t('التحويل اتلغى') }); if (r) setCancel(null); }}>{t('الغي')}</Button></>}>
          <Field label={t('السبب')}><Textarea data-fb="transfer-cancel:reason" value={cancel} onChange={(e) => setCancel(e.target.value)} /></Field>
        </Modal>
      )}
    </Modal>
  );
}
