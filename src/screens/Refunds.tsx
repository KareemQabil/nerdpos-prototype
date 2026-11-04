// D3 Refunds (r3A — who did it vs who allowed it): the cashier finds the paid check, the refundable value fills in by
// itself, picks what happens to each returned item, and pays out on HER OWN device: a manager authorises right there
// (PIN / card / fingerprint / request to his device) and the cash leaves THAT cashier's drawer (F2-01, F3-04, A07).
// After the business day closed it is a "return after close": the third-level permission (accountant / owner)
// authorises it, it is booked today and linked to the original check — the closed day is never rewritten (A08).
// Staff meals found here are cancelled / returned through their own stages (F3-01).
import React, { useEffect, useState } from 'react';
import { RotateCcw, Check, X, Receipt, Search, Wallet, Coffee, ShieldCheck, Lock, Undo2 } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { PageHeader, Card, Input, Button, Field, Select, Money, Table, Pill, Textarea, Tabs, SearchInput, EmptyState, Skeleton, FilterChips, Toolbar, Banner, confirmDialog, DateTime, Popup, StateBadge } from '../ui';
import { Tech } from '../app/tech';
import { t, L } from '../i18n';
import { cn, money, qty } from '../lib/format';
import { useReasons } from './order/CheckPanel';
import { METHOD_AR } from './ops/BusinessDay';
import { STAGE_TEXT, DISPOSITION_TEXT, DISPOSITIONS } from '../mock/control-registry';
import { StaffMealCancelDialog, mealStage } from './control/StaffMeal';
import { personName } from '../demo/people';
import { D } from '../mock/money';

const methodText = (m: string) => t(METHOD_AR[m] ?? 'طريقة تانية');
const STATE: Record<string, [string, 'warning' | 'success' | 'neutral' | 'error' | 'info']> = { REQUESTED: ['مستني الصرف', 'warning'], APPROVED: ['اتوافق', 'info'], PAID: ['اتصرف', 'success'], REJECTED: ['اترفض', 'error'], CANCELLED: ['اتلغى', 'neutral'] };
const first = (s?: string | null) => (s ? personName(null, s) : '—');

export default function Refunds() {
  const [tab, setTab] = useState<'new' | 'cases'>('new');
  const cases = useQuery<any>('Refund.Find', { query: {} });
  const waiting = (cases.data?.items ?? []).filter((r: any) => r.state === 'REQUESTED').length;
  const { terminal } = useDev();
  return (
    <div data-screen="D3" className="space-y-4">
      <PageHeader title={t('المرتجعات')} ops={['Refund.Refundable', 'Refund.Request', 'Refund.Approve', 'Refund.Cancel', 'Refund.Find', 'Order.CancelStaffMeal']} className="!mb-0" />
      {!terminal?.drawer && <Banner tone="info" title={t('الجهاز ده من غير درج')}>{t('المرتجع الكاش بيطلع من درج الكاشير اللي بيعمله: اطلبه واصرفه من جهاز الكاشير، والمدير يوافق هناك بالرقم السري أو الكارت أو البصمة — أو يوافق على الطلب من جهازه.')}</Banner>}
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'new', label: t('مرتجع جديد'), fb: 'refunds-tab:new' }, { id: 'cases', label: t('الطلبات'), count: waiting || undefined, fb: 'refunds-tab:cases' }]} />
      {tab === 'new' ? <NewRefund onDone={() => setTab('cases')} /> : <Cases q={cases} />}
    </div>
  );
}

function NewRefund({ onDone }: { onDone: () => void }) {
  const [number, setNumber] = useState('');
  const found = useQuery<any>(number.length >= 1 ? 'Order.Find' : null, { query: { number, lifecycle: 'COMPLETED,CONFIRMED' } });
  const [orderId, setOrderId] = useState<string | null>(null);
  const list: any[] = found.data?.items ?? [];
  const sel = list.find((o) => o.id === orderId);
  return (
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
      <Card title={t('١. دوّر على الشيك')}>
        <SearchInput value={number} onChange={setNumber} placeholder={t('رقم الشيك أو وجبة الموظف')} className="!max-w-none" data-fb="refund-search" />
        <div className="mt-2 space-y-1.5">
          {found.loading && <Skeleton lines={3} />}
          {list.map((o: any) => <button key={o.id} onClick={() => setOrderId(o.id)} data-fb={`refund-order:${o.number}`} className={cn('w-full text-start px-3 min-h-[52px] rounded-xl border text-sm flex items-center justify-between gap-2', orderId === o.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>
            <span><span className="num font-bold">#{o.number}</span> · {o.kind === 'STAFF_MEAL' ? <span className="inline-flex items-center gap-1"><Coffee className="w-3.5 h-3.5" />{t('وجبة موظف')} — {first(o.staffMeal?.employeeName ?? o.customerName)}</span> : o.tableName ? `${t('ترابيزة')} ${o.tableName}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')}<span className="block text-[11px] text-dim num">{o.completedBusinessDate ?? o.businessDate}</span></span>
            <Money v={o.kind === 'STAFF_MEAL' ? o.staffMeal?.value ?? '0' : o.totals.payable} /></button>)}
          {number && !found.loading && !list.length && <div className="text-sm text-dim text-center py-3">{t('مفيش شيك مدفوع بالرقم ده')}</div>}
          {!number && <div className="text-xs text-dim py-2">{t('اكتب رقم الشيك اللي على الإيصال (مثلًا 0388 من امبارح).')}</div>}
        </div>
      </Card>
      {sel?.kind === 'STAFF_MEAL' ? <StaffMealReturn order={sel} /> : orderId ? <RefundForm key={orderId} orderId={orderId} onDone={onDone} /> : <Card><EmptyState icon={<Search />} title={t('اختار شيك اتدفع')} text={t('دوّر برقم الشيك الأول، وبعدها اختار الأصناف — المبلغ بيتحسب لوحده.')} /></Card>}
    </div>
  );
}

function StageBanner({ stage, paidOn, bookedOn }: { stage: 'S2' | 'S3'; paidOn: string; bookedOn: string }) {
  return stage === 'S3'
    ? <Banner tone="error" title={t('مرتجع بعد قفل اليوم')}><span data-fb="refund-stage:S3">{t('الشيك ده اتدفع يوم {d} واليوم ده اتقفل. المرتجع هيتسجل على يوم {b} ومربوط بالشيك الأصلي — أرقام يوم {d} مش هتتغير. الصرف محتاج الصلاحية التالتة (المحاسب أو صاحب المطعم).', { d: paidOn, b: bookedOn })}</span></Banner>
    : <Banner tone="info" title={t('مرتجع في نفس اليوم')}><span data-fb="refund-stage:S2">{t('الفلوس هتطلع من درج الكاشير اللي على الجهاز ده، والمدير يوافق هنا على نفس الجهاز.')}</span></Banner>;
}

export function RefundForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const rf = useQuery<any>('Refund.Refundable', { params: { orderId } });
  const reasons = useReasons('REFUND');
  const { terminal } = useDev();
  const { run, busy } = useCommand();
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [disp, setDisp] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [method, setMethod] = useState('CASH');
  const [alloc, setAlloc] = useState<string>('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  const [payNow, setPayNow] = useState(true);
  const d = rf.data;
  const suggested = (d?.lines ?? []).filter((l: any) => Number(lineQty[l.lineId] || 0) > 0).map((l: any) => ({ l, q: lineQty[l.lineId] }));
  const auto = suggested.reduce((a: any, x: any) => a.plus(D(x.l.unitRefundable).times(x.q)), D(0)).toFixed(2);
  // the refundable value fills in by itself from the chosen items (meeting T2: "ما جابش السعر أوتوماتيك")
  useEffect(() => { if (!touched) setAmount(suggested.length ? auto : ''); }, [auto, touched]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (d && !alloc) { const c = d.captures.find((x: any) => x.method === method && Number(x.remaining) > 0) ?? d.captures.find((x: any) => Number(x.remaining) > 0); if (c) setAlloc(c.captureId); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Skeleton className="h-80 rounded-2xl" />;
  const submit = async () => {
    const r = await run<any>('Refund.Request', { params: { orderId }, body: { amount, method, allocations: [{ captureId: alloc, amount }], lines: suggested.map((x: any) => ({ lineId: x.l.lineId, quantity: x.q, disposition: disp[x.l.lineId] || 'WASTE_HELD' })), reasonCode: rc, reason: note } }, { success: t('طلب المرتجع اتسجل') });
    if (!r) return;
    if (payNow && terminal?.drawer) await run('Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, payoutMethod: method } }, { success: t('المرتجع اتصرف من الدرج') });
    onDone();
  };
  return (
    <Card title={t('٢. تفاصيل المرتجع')} description={t('المبلغ لكل صنف شامل نصيبه من الخصم والخدمة والضريبة.')}>
      <div className="space-y-4">
        <StageBanner stage={d.stage} paidOn={d.paidBusinessDate} bookedOn={d.bookedOn} />
        <Table dense align={['start', 'end', 'end', 'end', 'end', 'start']} head={[t('الصنف'), t('الكمية'), t('اترجع قبل كده'), t('للواحدة'), t('هيرجع'), t('الصنف هيروح فين')]} rows={d.lines.map((l: any) => [L(l.name), <span className="num">{qty(l.quantity)}</span>, <span className="num">{qty(l.refundedQuantity)}</span>, <Money v={l.unitRefundable} />,
          <div className="flex items-center gap-1 justify-end"><Input data-fb={`refund-qty:${l.lineId}`} value={lineQty[l.lineId] ?? ''} onChange={(e) => setLineQty({ ...lineQty, [l.lineId]: e.target.value.replace(/[^0-9.]/g, '') })} className="!w-16 !py-1 text-center" inputMode="decimal" /><Button size="sm" variant="ghost" onClick={() => setLineQty({ ...lineQty, [l.lineId]: '1' })} data-fb={`refund-one:${l.lineId}`}>{t('واحدة')}</Button></div>,
          <Select data-fb={`refund-disp:${l.lineId}`} className="!w-auto min-w-[150px] !py-1 text-xs" value={disp[l.lineId] ?? 'WASTE_HELD'} onChange={(e) => setDisp({ ...disp, [l.lineId]: e.target.value })} options={DISPOSITIONS.filter((x) => x !== 'NOT_PREPARED').map((x) => ({ value: x, label: t(DISPOSITION_TEXT[x].label) }))} />])} />
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t('المبلغ اللي هيرجع')} hint={`${t('اتدفع فعلًا')} ${money(d.effectivePaid)}${suggested.length ? ` · ${t('محسوب من الأصناف')}` : ''}`}><Input data-fb="refund-amount" value={amount} onChange={(e) => { setTouched(true); setAmount(e.target.value.replace(/[^0-9.]/g, '')); }} inputMode="decimal" className="h-12" style={{ fontSize: 20 }} /></Field>
          <Field label={t('هيرجع إزاي')}><Select value={method} onChange={(e) => setMethod(e.target.value)} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: methodText(m) }))} /></Field>
          <Field label={t('من أنهي دفعة')} hint={t('الافتراضي: يرجع بنفس طريقة الدفع.')}><Select value={alloc} onChange={(e) => setAlloc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...d.captures.map((c: any) => ({ value: c.captureId, label: `${methodText(c.method)} ${money(c.amount)} — ${t('متاح')} ${money(c.remaining)}` }))]} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('السبب')}><Select data-fb="refund-reason" value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار السبب') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
          <Field label={t('ملاحظة (مطلوبة)')}><Textarea data-fb="refund-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[44px]" /></Field>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={payNow && !!terminal?.drawer} disabled={!terminal?.drawer} onChange={(e) => setPayNow(e.target.checked)} data-fb="refund-pay-now" />{terminal?.drawer ? t('اصرف دلوقتي من الدرج اللي على الجهاز ده (المدير يوافق هنا)') : t('الصرف هيكون من جهاز الكاشير')}</label>
          <Button variant="primary" size="lg" loading={busy} disabled={!amount || !alloc || !rc || !note} onClick={submit} data-fb="refund-request"><RotateCcw className="w-4 h-4" />{payNow && terminal?.drawer ? t('اطلب واصرف') : t('اطلب المرتجع')}</Button>
        </div>
      </div>
    </Card>
  );
}

function StaffMealReturn({ order }: { order: any }) {
  const al = useQuery<any>('StaffMeal.Allowance', {});
  const [open, setOpen] = useState(false);
  const stage = mealStage(order, al.data?.closedDates ?? []);
  return (
    <Card title={<span className="flex items-center gap-2"><Coffee className="w-4 h-4" />{t('وجبة موظف')} — {first(order.staffMeal?.employeeName ?? order.customerName)}</span>} description={t('وجبة الموظف مش بيع ومفيش فلوس بترجع — بتتلغي أو تترجع بموافقة حسب المرحلة، والمخزن بيتظبط.')}>
      <div className="space-y-3" data-fb="refund-staff-meal">
        <div className="text-sm">{order.lines.filter((l: any) => l.status !== 'REMOVED').map((l: any) => `${L(l.name)} ×${Number(l.quantity)}`).join(t('، '))}</div>
        <div className="flex items-center gap-2 flex-wrap"><Pill tone={stage === 'S3' ? 'error' : stage === 'S1' ? 'warning' : 'info'}>{t(STAGE_TEXT[stage].short)}</Pill><span className="text-xs text-dim">{t(STAGE_TEXT[stage].long)}</span></div>
        {order.status === 'VOIDED' ? <Banner tone="info">{t('الوجبة دي اتلغت قبل كده.')}</Banner> : <Button variant="danger" onClick={() => setOpen(true)} data-fb="refund-staff-meal-cancel"><RotateCcw className="w-4 h-4" />{stage === 'S3' ? t('مرتجع بعد قفل اليوم') : t('إلغاء الوجبة')}</Button>}
      </div>
      {open && <StaffMealCancelDialog order={order} stage={stage} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function Cases({ q }: { q: any }) {
  const { run } = useCommand();
  const { terminal, me, can } = useDev();
  const [f, setF] = useState<'ALL' | 'REQUESTED' | 'PAID' | 'S3'>('ALL');
  const [cancel, setCancel] = useState<any>(null);
  // ux-10: the requester withdraws a pending request (a refund:reject holder may too); the server decides
  const canCancel = (r: any) => r.requestedBy === me?.user?.id || can('refund:reject');
  const approve = (r: any) => run('Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, payoutMethod: r.method } }, { success: t('المرتجع اتصرف') });
  const reject = async (r: any) => { if (await confirmDialog(t('ترفض طلب المرتجع ده؟ الزبون مش هياخد فلوس.'), { danger: true, confirmLabel: t('أيوه، ارفض') })) run('Refund.Reject', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, decisionReason: 'rejected' } }, { success: t('الطلب اترفض') }); };
  const all: any[] = (q.data?.items ?? []).slice().reverse();
  const list = f === 'ALL' ? all : f === 'S3' ? all.filter((r) => r.afterClose) : all.filter((r) => r.state === f);
  return (
    <div className="space-y-3">
      <Toolbar className="!mb-0"><FilterChips value={f} onChange={setF} options={[{ id: 'ALL', label: t('الكل'), count: all.length }, { id: 'REQUESTED', label: t('مستني الصرف'), count: all.filter((r) => r.state === 'REQUESTED').length, tone: 'warning' }, { id: 'PAID', label: t('اتصرف'), count: all.filter((r) => r.state === 'PAID').length }, { id: 'S3', label: t('بعد قفل اليوم'), count: all.filter((r) => r.afterClose).length, tone: 'error' }]} /></Toolbar>
      <Table align={['start', 'end', 'start', 'start', 'start', 'start', 'start', 'end']} loading={q.loading} head={[t('الشيك'), t('المبلغ'), t('هيرجع إزاي'), t('المرحلة'), t('السبب'), t('مين عمل ومين وافق'), t('الحالة'), '']} rows={list.map((r: any) => [
        <span className="font-bold"><span className="num">#{r.orderNumber}</span><DateTime v={r.requestedAt} className="block text-[10px] text-dim font-normal" /></span>, <Money v={r.amount} />, methodText(r.method),
        r.stage ? <Pill tone={r.stage === 'S3' ? 'error' : 'info'} data-fb={`refund-case-stage:${r.orderNumber}`}>{t(STAGE_TEXT[r.stage as 'S2'].short)}</Pill> : <span className="text-dim">—</span>,
        <span className="text-soft">{r.reason}<Tech><span className="num text-[10px] ms-1">{r.reasonCode}</span></Tech></span>,
        <span className="text-xs" data-fb={`refund-case-who:${r.orderNumber}`}>{t('طلب')}: {first(r.requestedByName)}{r.state === 'PAID' && <><br />{t('صرف')}: {first(r.paidByName)}{r.drawerOwnerName ? ` · ${t('من درج')} ${first(r.drawerOwnerName)}` : ''}<br /><ShieldCheck className="w-3 h-3 inline" /> {t('وافق')}: <b>{first(r.approverName)}</b></>}{r.afterClose && r.state === 'PAID' && <><br /><span className="text-[var(--error)]">{t('اتسجل يوم')} <span className="num">{r.businessDate}</span> ({t('الأصلي')} <span className="num">{r.originalBusinessDate}</span>)</span></>}{r.state === 'CANCELLED' && r.cancelledByName && <><br /><span data-fb={`refund-case-cancelled:${r.orderNumber}`}>{t('ألغاه')}: {first(r.cancelledByName)}{r.cancelReason ? ` — ${r.cancelReason}` : ''}</span></>}</span>,
        <Pill tone={STATE[r.state]?.[1] ?? 'neutral'} dot>{t(STATE[r.state]?.[0] ?? '—')}</Pill>,
        r.state === 'REQUESTED' ? <div className="flex gap-1 justify-end">{terminal?.drawer || r.method !== 'CASH' ? <Button size="sm" variant="success" onClick={() => approve(r)} data-fb={`refund-approve:${r.orderNumber}`}><Wallet className="w-3.5 h-3.5" />{t('اصرف (موافقة مدير)')}</Button> : <Pill tone="neutral"><Lock className="w-3 h-3" />{t('من جهاز الكاشير')}</Pill>}{canCancel(r) && <Button size="sm" variant="ghost" onClick={() => setCancel(r)} data-fb={`refund-cancel:${r.orderNumber}`} title={t('إلغاء الطلب')} aria-label={t('إلغاء الطلب')}><Undo2 className="w-3.5 h-3.5" /></Button>}{can('refund:reject') && <Button size="sm" variant="ghost" onClick={() => reject(r)} title={t('ارفض')} aria-label={t('ارفض')}><X className="w-3.5 h-3.5" /></Button>}</div> : null,
      ])} empty={<EmptyState compact icon={<Receipt />} title={t('مفيش طلبات مرتجع')} text={t('اطلب مرتجع من التاب الأول.')} />} />
      <div className="text-[11px] text-dim">{t('الموافقة لازم تكون من مدير غير اللي طلب، والصرف الكاش بيطلع من الدرج المفتوح على الجهاز اللي بيصرف — عشان يتعرف الفلوس طلعت من درج مين.')}</div>
      {cancel && <CancelRefundPopup r={cancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

/** ux-10: withdraw a pending refund request — required reason, CAS on the case version (Refund.Cancel). */
function CancelRefundPopup({ r, onClose }: { r: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const submit = async () => { if (!reason.trim() || busy) return; if (await run('Refund.Cancel', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, reason: reason.trim() } }, { success: t('أُلغي طلب المرتجع') })) onClose(); };
  return (
    <Popup open onClose={onClose} size="sm" fb="refund-cancel-popup" title={<span className="flex items-center gap-2"><Undo2 className="w-5 h-5 text-[var(--primary)]" />{t('إلغاء طلب المرتجع')} <span className="num">#{r.orderNumber}</span></span>} badge={<StateBadge ops={['Refund.Cancel']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit} data-fb="refund-cancel-confirm">{t('تأكيد الإلغاء')}</Button></>}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between rounded-xl surface-1 border line px-3 py-2"><span className="text-soft">{r.reason}</span><Money v={r.amount} /></div>
        <Field label={t('سبب الإلغاء')}><Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="refund-cancel-reason" className="min-h-[72px]" /></Field>
      </div>
    </Popup>
  );
}
void Check;
