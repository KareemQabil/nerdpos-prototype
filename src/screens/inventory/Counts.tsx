// Stock counts: start (the system remembers the balance at the start), several people count on the sheet (fast
// entry, partial is fine), submit, review the variance valued at cost, post it (manager approval) or cancel.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, ClipboardCheck, Send, CheckCheck, XCircle, Eye, EyeOff, Save } from 'lucide-react';
import { useCommand, useDev, useQuery } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Banner, Button, Card, Empty, Field, Input, KV, Modal, Drawer, Money, Pill, Section, Select, Spinner, StateBadge, Switch, Table, Textarea, EmptyState } from '../../ui';
import { t, L } from '../../i18n';
import { cn, dateTime, money } from '../../lib/format';
import { BranchScope, COUNT_STATE, Qty, StatePill, WarehouseSelect, fmtQty, unitLabel, unitOptions, useBranchScope, useItemsCatalog, useList, useWarehouses, Inp, Sel } from './common';

const OPS = ['StockCount.Start', 'StockCount.RecordObservations', 'StockCount.Submit', 'Stock.Count', 'StockCount.Cancel', 'StockCount.Find', 'StockCount.Get'];

export default function Counts() {
  const { params } = useDev();
  const scope = useBranchScope();
  const [state, setState] = useState('');
  const list = useList<any>('StockCount.Find', { branchId: scope.branchId, lifecycle: state || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(!!params?.start);
  useEffect(() => { if (params?.start) setStarting(true); }, [params?.start]);
  return (
    <div>
      <Section title={t('الجرد')} badge={<StateBadge ops={OPS} />} sub={t('ابدأ جرد لمخزن، اعدّوا (أكتر من حد ينفع يعد في نفس الوقت)، سلّم، راجع الفروقات بقيمتها، واعتمدها.')}
        actions={<><BranchScope scope={scope} /><Button data-fb="counts:new" variant="primary" onClick={() => setStarting(true)}><Plus className="w-4 h-4" />{t('جرد جديد')}</Button></>} />
      <div className="flex gap-2 mb-3"><Sel className="w-52" value={state} onChange={(e) => setState(e.target.value)} options={[{ value: '', label: t('كل الحالات') }, ...Object.entries(COUNT_STATE).map(([k, v]) => ({ value: k, label: t(v.ar) }))]} /></div>
      <Table loading={list.loading && !list.raw} empty={<EmptyState compact icon={<ClipboardCheck />} title={t('مفيش جرد لسه. ابدأ أول جرد.')} />} head={[t('رقم الجرد'), t('المخزن'), t('بدأ'), t('الحالة'), t('اتعد'), t('الفروقات'), '']} rows={list.items.map((c) => [
          <button className="num font-bold hover:text-[var(--primary)]" data-fb={`counts:open:${c.id}`} onClick={() => setOpen(c.id)}>{c.number}</button>,
          <span>{c.warehouse.name} <span className="text-xs text-dim">{c.warehouse.branchName}</span></span>,
          <span className="text-xs">{dateTime(c.startedAt)} · {c.startedByName}</span>,
          <StatePill map={COUNT_STATE} state={c.state} />,
          <span className="num text-xs">{c.countedCount} / {c.lineCount}</span>,
          c.state === 'POSTED' ? <Money v={c.varianceValue} tone={Number(c.varianceValue) < 0 ? 'error' : 'success'} className="text-sm" /> : c.previewVarianceValue !== null && c.state !== 'CANCELLED' ? <span className="text-xs text-dim">{t('متوقع')} <Money v={c.previewVarianceValue} className="text-xs" /></span> : '—',
          <Button size="sm" onClick={() => setOpen(c.id)}>{c.state === 'DRAFT' ? t('كمّل العد') : c.state === 'SUBMITTED' ? t('راجع واعتمد') : t('اعرض')}</Button>,
        ])} />
      {starting && <StartDialog onClose={() => setStarting(false)} onStarted={(id) => { setStarting(false); setOpen(id); }} />}
      <CountSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function StartDialog({ onClose, onStarted }: { onClose: () => void; onStarted: (id: string) => void }) {
  const { run, busy } = useCommand();
  const { auth } = useDev();
  const whs = useWarehouses();
  const items = useItemsCatalog();
  const [wh, setWh] = useState('');
  const [mode, setMode] = useState<'ALL' | 'CATEGORY' | 'PICK'>('ALL');
  const [cats, setCats] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  useEffect(() => { if (!wh && whs.items.length) setWh(whs.items.find((w) => w.branchId === auth.branchId && w.salesDefault)?.id ?? whs.items[0].id); }, [whs.items, wh, auth.branchId]);
  const categories = [...new Set(items.items.map((i) => i.category))];
  const chosen = mode === 'CATEGORY' ? items.items.filter((i) => cats.includes(i.category)).map((i) => i.id) : mode === 'PICK' ? picked : undefined;
  const start = async () => {
    const r = await run<any>('StockCount.Start', { body: { warehouseId: wh, itemIds: chosen, note: note || undefined } }, { success: t('الجرد بدأ — الرصيد وقت البداية اتسجل') });
    if (r) onStarted(r.id);
  };
  return (
    <Modal open onClose={onClose} wide title={t('جرد جديد')} badge={<StateBadge ops={['StockCount.Start']} />}
      footer={<><Button onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" data-fb="count-start:go" loading={busy} disabled={!wh || (chosen !== undefined && chosen.length === 0)} onClick={start}><ClipboardCheck className="w-4 h-4" />{t('ابدأ الجرد')}</Button></>}>
      <div className="space-y-3">
        <Field label={t('المخزن')}><WarehouseSelect fb="count-start:warehouse" value={wh} onChange={setWh} warehouses={whs.items} /></Field>
        <div className="grid grid-cols-3 gap-2">
          {(['ALL', 'CATEGORY', 'PICK'] as const).map((m) => <Button key={m} data-fb={`count-start:mode:${m}`} variant={mode === m ? 'primary' : 'secondary'} onClick={() => setMode(m)}>{m === 'ALL' ? t('كل الأصناف') : m === 'CATEGORY' ? t('مجموعات معينة') : t('أصناف أختارها')}</Button>)}
        </div>
        {mode === 'CATEGORY' && <div className="flex flex-wrap gap-1.5">{categories.map((c) => <button key={c} type="button" onClick={() => setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c])} className={cn('px-3 h-8 rounded-xl text-sm border', cats.includes(c) ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-bold' : 'surface-2 border-[var(--glass-border)]')}>{c}</button>)}</div>}
        {mode === 'PICK' && (
          <div className="max-h-60 overflow-y-auto rounded-xl surface-1 p-2 grid grid-cols-2 gap-1">
            {items.items.map((i) => <label key={i.id} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked(picked.includes(i.id) ? picked.filter((x) => x !== i.id) : [...picked, i.id])} />{L(i.name)}</label>)}
          </div>
        )}
        <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثال: جرد آخر الشهر')} /></Field>
        <Banner tone="info">{t('أول ما الجرد يبدأ، السيستم بيحفظ رصيد كل صنف. أي بيع أو استلام بيحصل وانتو بتعدّوا بيتحسب لوحده في الفرق — مش لازم تقفلوا المحل.')}</Banner>
      </div>
    </Modal>
  );
}

function CountSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { run, busy } = useCommand();
  const q = useQuery<any>(id ? 'StockCount.Get' : null, { params: { countId: id } });
  const c = q.data;
  const [vals, setVals] = useState<Record<string, { q: string; unit: string }>>({});
  const [blind, setBlind] = useState(true);
  const [filter, setFilter] = useState('');
  const [submitAsk, setSubmitAsk] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => { setVals({}); setFilter(''); }, [id]);
  const lines = useMemo(() => (c?.lines ?? []).filter((l: any) => !filter || `${l.item?.name.ar} ${l.item?.category}`.includes(filter)), [c, filter]);
  if (!id) return null;
  const draft = c?.state === 'DRAFT';
  const saveLine = async (itemId: string) => {
    const v = vals[itemId];
    if (!v || v.q === '') return;
    const r = await run('StockCount.RecordObservations', { params: { countId: id }, body: { observations: [{ itemId, countedQuantity: v.q, unit: v.unit || undefined }] } }, { quiet: false });
    if (r) setVals((s) => { const n = { ...s }; delete n[itemId]; return n; });
  };
  const saveAll = async () => {
    const obs = Object.entries(vals).filter(([, v]) => v.q !== '').map(([itemId, v]) => ({ itemId, countedQuantity: v.q, unit: v.unit || undefined }));
    if (!obs.length) return;
    const r = await run('StockCount.RecordObservations', { params: { countId: id }, body: { observations: obs } }, { success: t('اتحفظ {n} صنف', { n: obs.length }) });
    if (r) setVals({});
  };
  const next = (idx: number) => { const nx = lines[idx + 1]; if (nx) refs.current[nx.itemId]?.focus(); };
  return (
    <Drawer width="xl" open onClose={onClose} title={c ? <span className="flex items-center gap-2">{t('جرد')} <span className="num">{c.number}</span> — {c.warehouse.name}</span> : t('جرد')} badge={c ? <><StatePill map={COUNT_STATE} state={c.state} /><StateBadge ops={OPS} /></> : undefined}
      footer={c && <>
        {(c.state === 'DRAFT' || c.state === 'SUBMITTED') && <Button variant="danger" data-fb="count:cancel" onClick={() => setCancelAsk(true)}><XCircle className="w-4 h-4" />{t('إلغاء الجرد')}</Button>}
        <div className="flex-1" />
        {draft && <Button data-fb="count:save" loading={busy} disabled={!Object.keys(vals).length} onClick={saveAll}><Save className="w-4 h-4" />{t('احفظ العد')}</Button>}
        {draft && <Button variant="primary" data-fb="count:submit" onClick={async () => { await saveAll(); setSubmitAsk(true); }}><Send className="w-4 h-4" />{t('سلّم الجرد للمراجعة')}</Button>}
        {c.state === 'SUBMITTED' && <Button variant="success" data-fb="count:post" loading={busy} onClick={() => run('Stock.Count', { params: { countId: c.id }, body: { expectedVersion: c.version } }, { success: t('الفروقات اتعتمدت والرصيد اتظبط') })}><CheckCheck className="w-4 h-4" />{t('اعتمد الفروقات')}</Button>}
      </>}>
      {!c ? <Spinner /> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Box l={t('اتعد')} v={<span className="num">{c.countedCount} / {c.lineCount}</span>} />
            <Box l={t('بدأه')} v={`${c.startedByName} · ${dateTime(c.startedAt)}`} />
            <Box l={t('اللي عدّوا')} v={(c.lines.map((l: any) => l.countedByName).filter(Boolean) as string[]).filter((x, i, a) => a.indexOf(x) === i).join('، ') || '—'} />
            <Box l={c.state === 'POSTED' ? t('الفروقات المعتمدة') : t('الفروقات لحد دلوقتي')} v={<Money v={c.state === 'POSTED' ? c.varianceValue : c.previewVarianceValue} tone={Number(c.state === 'POSTED' ? c.varianceValue : c.previewVarianceValue) < 0 ? 'error' : 'success'} />} />
          </div>
          <div className="h-2 rounded-full surface-2 overflow-hidden"><div className="h-full bg-[var(--primary)]" style={{ width: `${(c.countedCount / Math.max(1, c.lineCount)) * 100}%` }} /></div>
          {c.note && <div className="text-sm text-dim">{c.note}</div>}
          {c.state === 'CANCELLED' && <Banner tone="error">{t('الجرد اتلغى')}: {c.cancelReason}</Banner>}
          {c.state === 'SUBMITTED' && <Banner tone="warning">{t('راجع الفروقات: بالأحمر عجز، بالأخضر زيادة. الاعتماد بيعمل حركة "فرق جرد" لكل صنف بقيمته بالتكلفة، وبيحتاج موافقة مدير لو فيه أي فرق.')}</Banner>}
          <div className="flex flex-wrap gap-2 items-center">
            <Inp className="w-60" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('دوّر في الورقة')} />
            {draft && <Button size="sm" variant="ghost" data-fb="count:blind" onClick={() => setBlind(!blind)}>{blind ? <><Eye className="w-3.5 h-3.5" />{t('اعرض الرصيد المتوقع')}</> : <><EyeOff className="w-3.5 h-3.5" />{t('عد أعمى')}</>}</Button>}
            {draft && <span className="text-xs text-dim">{t('اكتب الكمية واضغط Enter تنزل على اللي بعده — بيتحفظ لوحده.')}</span>}
          </div>
          <Table head={[t('الصنف'), ...(draft && blind ? [] : [t('المتوقع')]), t('المعدود'), ...(draft ? [] : [t('الفرق'), t('قيمة الفرق')]), t('عدّه')]} rows={lines.map((l: any, idx: number) => {
            const unit = l.item?.unit;
            const v = vals[l.itemId];
            const opts = unitOptions(l.item);
            return [
              <div><div className="font-bold">{L(l.item?.name)}</div><div className="text-[11px] text-dim">{l.item?.category}</div></div>,
              ...(draft && blind ? [] : [<Qty v={l.expectedQty} unit={unit} hint={false} />]),
              draft ? (
                <div className="flex gap-1 items-center">
                  <input ref={(el) => { refs.current[l.itemId] = el; }} data-fb={`count:qty:${l.itemId}`} className={cn('glass-input num w-28', v ? 'border-[var(--warning)]' : l.countedQty !== null ? 'border-[var(--success)]' : '')} inputMode="decimal"
                    value={v ? v.q : l.countedQty ?? ''} placeholder={l.countedQty === null ? '—' : ''}
                    onChange={(e) => setVals({ ...vals, [l.itemId]: { q: e.target.value.replace(/[^\d.]/g, ''), unit: v?.unit ?? l.item?.stockUnitId } })}
                    onKeyDown={(e) => { if (e.key === 'Enter') { saveLine(l.itemId); next(idx); } }} onBlur={() => saveLine(l.itemId)} />
                  {opts.length > 1 ? <Sel className="w-28 h-9 text-xs" value={v?.unit ?? l.item?.stockUnitId} onChange={(e) => setVals({ ...vals, [l.itemId]: { q: v?.q ?? '', unit: e.target.value } })} options={opts.map((o) => ({ value: o.value, label: o.label }))} /> : <span className="text-xs text-dim">{unitLabel(unit)}</span>}
                </div>
              ) : <Qty v={l.countedQty} unit={unit} hint={false} />,
              ...(draft ? [] : [<Qty v={l.varianceQty} unit={unit} signed hint={false} />, <Money v={l.varianceValue} tone={Number(l.varianceValue) < 0 ? 'error' : Number(l.varianceValue) > 0 ? 'success' : 'dim'} className="text-xs" />]),
              <span className="text-xs text-dim">{l.countedByName ?? '—'}</span>,
            ];
          })} />
          <Tech><div className="text-[11px] num text-dim">{c.id} · v{c.version} · baselineSeq {c.lines[0]?.baselineSeq}</div></Tech>
        </div>
      )}
      {submitAsk && c && <SubmitDialog c={c} onClose={() => setSubmitAsk(false)} />}
      {cancelAsk && c && <CancelDialog c={c} onClose={() => setCancelAsk(false)} />}
    </Drawer>
  );
}
function Box({ l, v }: { l: React.ReactNode; v: React.ReactNode }) { return <div className="rounded-xl surface-1 p-2.5"><div className="text-[11px] text-dim">{l}</div><div className="font-bold text-sm mt-0.5 truncate">{v}</div></div>; }

function SubmitDialog({ c, onClose }: { c: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const missing = c.lines.filter((l: any) => l.countedQty === null);
  const [zero, setZero] = useState(false);
  return (
    <Modal open onClose={onClose} title={t('تسليم الجرد')} badge={<StateBadge ops={['StockCount.Submit']} />}
      footer={<><Button onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" data-fb="count-submit:go" loading={busy} disabled={missing.length > 0 && !zero} onClick={async () => { const r = await run('StockCount.Submit', { params: { countId: c.id }, body: { expectedVersion: c.version, zeroUncounted: zero } }, { success: t('الجرد اتسلم — راجع الفروقات') }); if (r) onClose(); }}><Send className="w-4 h-4" />{t('سلّم')}</Button></>}>
      <div className="space-y-3">
        {missing.length ? (<>
          <Banner tone="warning">{t('فيه {n} صنف لسه ما اتعدش:', { n: missing.length })} {missing.slice(0, 8).map((l: any) => L(l.item?.name)).join('، ')}{missing.length > 8 ? '…' : ''}</Banner>
          <Switch checked={zero} onChange={setZero} label={t('اللي ما اتعدش يتحسب صفر (مش موجود)')} />
        </>) : <Banner tone="success">{t('كل الأصناف اتعدت.')}</Banner>}
        <div className="text-sm text-dim">{t('بعد التسليم مفيش تعديل في العد. لو فيه غلط، الغي الجرد وابدأ جرد جديد.')}</div>
      </div>
    </Modal>
  );
}
function CancelDialog({ c, onClose }: { c: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={t('إلغاء الجرد')} badge={<StateBadge ops={['StockCount.Cancel']} />}
      footer={<><Button onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" data-fb="count-cancel:go" loading={busy} disabled={!reason.trim()} onClick={async () => { const r = await run('StockCount.Cancel', { params: { countId: c.id }, body: { expectedVersion: c.version, reason } }, { success: t('الجرد اتلغى — مفيش أي تغيير في الرصيد') }); if (r) onClose(); }}>{t('الغي الجرد')}</Button></>}>
      <Field label={t('السبب')}><Textarea data-fb="count-cancel:reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثال: اتعد غلط — هنعيده بكرة')} /></Field>
    </Modal>
  );
}
