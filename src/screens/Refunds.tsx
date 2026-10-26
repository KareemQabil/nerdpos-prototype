// D3 Refunds: request (lines, amount, method, allocation to payments), manager approval (another manager),
// payout from the drawer. A refund counts on its payout date and never restates the original Z.
import React, { useState } from 'react';
import { RotateCcw, Check, X, Receipt, Search } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { PageHeader, Card, Input, Button, Field, Select, Money, Table, Pill, Textarea, Tabs, SearchInput, EmptyState, Skeleton, FilterChips, Toolbar, confirmDialog } from '../ui';
import { Tech } from '../app/tech';
import { t, L } from '../i18n';
import { cn, money, qty, dateTime } from '../lib/format';
import { useReasons } from './order/CheckPanel';
import { METHOD_AR } from './ops/BusinessDay';

const methodText = (m: string) => t(METHOD_AR[m] ?? 'طريقة تانية');
const STATE: Record<string, [string, 'warning' | 'success' | 'neutral' | 'error' | 'info']> = { REQUESTED: ['مستني موافقة', 'warning'], APPROVED: ['اتوافق', 'info'], PAID: ['اتصرف', 'success'], REJECTED: ['اترفض', 'error'], CANCELLED: ['اتلغى', 'neutral'] };

export default function Refunds() {
  const [tab, setTab] = useState<'new' | 'cases'>('new');
  const cases = useQuery<any>('Refund.Find', { query: {} });
  const waiting = (cases.data?.items ?? []).filter((r: any) => r.state === 'REQUESTED').length;
  return (
    <div data-screen="D3" className="space-y-4">
      <PageHeader title={t('المرتجعات')} ops={['Refund.Refundable', 'Refund.Request', 'Refund.Approve', 'Refund.Find']} description={t('رجّع فلوس لزبون على شيك اتدفع. الصرف محتاج موافقة مدير غير اللي طلب.')} className="!mb-0" />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'new', label: t('طلب مرتجع جديد'), fb: 'refunds-tab:new' }, { id: 'cases', label: t('الطلبات'), count: waiting || undefined, fb: 'refunds-tab:cases' }]} />
      {tab === 'new' ? <NewRefund onDone={() => setTab('cases')} /> : <Cases q={cases} />}
    </div>
  );
}

function NewRefund({ onDone }: { onDone: () => void }) {
  const [number, setNumber] = useState('');
  const found = useQuery<any>(number.length >= 1 ? 'Order.Find' : null, { query: { number, lifecycle: 'COMPLETED,CONFIRMED' } });
  const [orderId, setOrderId] = useState<string | null>(null);
  const list: any[] = found.data?.items ?? [];
  return (
    <div className="grid lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
      <Card title={t('١. دوّر على الشيك')}>
        <SearchInput value={number} onChange={setNumber} placeholder={t('رقم الشيك')} className="!max-w-none" data-fb="refund-search" />
        <div className="mt-2 space-y-1.5">
          {found.loading && <Skeleton lines={3} />}
          {list.map((o: any) => <button key={o.id} onClick={() => setOrderId(o.id)} data-fb={`refund-order:${o.number}`} className={cn('w-full text-start px-3 min-h-[52px] rounded-xl border text-sm flex items-center justify-between gap-2', orderId === o.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}><span><span className="num font-bold">#{o.number}</span> · {o.tableName ? `${t('ترابيزة')} ${o.tableName}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')}</span><span className="num font-bold">{money(o.totals.payable)}</span></button>)}
          {number && !found.loading && !list.length && <div className="text-sm text-dim text-center py-3">{t('مفيش شيك مدفوع بالرقم ده')}</div>}
          {!number && <div className="text-xs text-dim py-2">{t('اكتب رقم الشيك اللي على الإيصال.')}</div>}
        </div>
      </Card>
      {orderId ? <RefundForm orderId={orderId} onDone={onDone} /> : <Card><EmptyState icon={<Search />} title={t('اختار شيك اتدفع')} text={t('دوّر برقم الشيك الأول، وبعدها اختار الأصناف والمبلغ اللي هيرجع.')} /></Card>}
    </div>
  );
}

function RefundForm({ orderId, onDone }: { orderId: string; onDone: () => void }) {
  const rf = useQuery<any>('Refund.Refundable', { params: { orderId } });
  const reasons = useReasons('REFUND');
  const { run, busy } = useCommand();
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [alloc, setAlloc] = useState<string>('');
  const [rc, setRc] = useState('');
  const [note, setNote] = useState('');
  const d = rf.data;
  if (!d) return <Skeleton className="h-80 rounded-2xl" />;
  const suggested = d.lines.filter((l: any) => Number(lineQty[l.lineId] || 0) > 0).map((l: any) => ({ l, q: lineQty[l.lineId] }));
  const submit = async () => {
    const r = await run('Refund.Request', { params: { orderId }, body: { amount, method, allocations: [{ captureId: alloc, amount }], lines: suggested.map((x: any) => ({ lineId: x.l.lineId, quantity: x.q })), reasonCode: rc, reason: note } }, { success: t('طلب المرتجع اتسجل — مستني موافقة مدير') });
    if (r) onDone();
  };
  return (
    <Card title={t('٢. تفاصيل المرتجع')} description={t('المبلغ لكل صنف شامل نصيبه من الخصم والخدمة والضريبة.')}>
      <div className="space-y-4">
        <Table dense align={['start', 'end', 'end', 'end', 'end']} head={[t('الصنف'), t('الكمية'), t('اترجع قبل كده'), t('للواحدة'), t('هيرجع')]} rows={d.lines.map((l: any) => [L(l.name), <span className="num">{qty(l.quantity)}</span>, <span className="num">{qty(l.refundedQuantity)}</span>, <Money v={l.unitRefundable} />, <div className="flex items-center gap-1 justify-end"><Input value={lineQty[l.lineId] ?? ''} onChange={(e) => setLineQty({ ...lineQty, [l.lineId]: e.target.value.replace(/[^0-9.]/g, '') })} className="!w-16 !py-1 text-center" inputMode="decimal" /><Button size="sm" variant="ghost" onClick={() => { setLineQty({ ...lineQty, [l.lineId]: '1' }); setAmount(money(l.unitRefundable, false).replace(/,/g, '')); }}>{t('واحدة')}</Button></div>])} />
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t('المبلغ اللي هيرجع')} hint={`${t('اتدفع فعلًا')} ${money(d.effectivePaid)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="h-12" style={{ fontSize: 20 }} /></Field>
          <Field label={t('هيرجع إزاي')}><Select value={method} onChange={(e) => setMethod(e.target.value)} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: methodText(m) }))} /></Field>
          <Field label={t('من أنهي دفعة')} hint={t('الافتراضي: يرجع بنفس طريقة الدفع.')}><Select value={alloc} onChange={(e) => setAlloc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...d.captures.map((c: any) => ({ value: c.captureId, label: `${methodText(c.method)} ${money(c.amount)} — ${t('متاح')} ${money(c.remaining)}` }))]} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار السبب') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
          <Field label={t('ملاحظة (مطلوبة)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[44px]" /></Field>
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] text-dim">{t('المرتجع فلوس بتطلع — مش إرجاع للصنف للمخزن. بيتحسب في يوم الصرف ومش بيغيّر تقرير يوم البيع.')}</span>
          <Button variant="primary" size="lg" loading={busy} disabled={!amount || !alloc || !rc || !note} onClick={submit} data-fb="refund-request"><RotateCcw className="w-4 h-4" />{t('اطلب المرتجع')}</Button>
        </div>
      </div>
    </Card>
  );
}

function Cases({ q }: { q: any }) {
  const { run } = useCommand();
  const [f, setF] = useState<'ALL' | 'REQUESTED' | 'PAID'>('ALL');
  const approve = (r: any) => run('Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, payoutMethod: r.method } }, { success: t('المرتجع اتصرف') });
  const reject = async (r: any) => { if (await confirmDialog(t('ترفض طلب المرتجع ده؟ الزبون مش هياخد فلوس.'), { danger: true, confirmLabel: t('أيوه، ارفض') })) run('Refund.Reject', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version } }, { success: t('الطلب اترفض') }); };
  const all: any[] = (q.data?.items ?? []).slice().reverse();
  const list = f === 'ALL' ? all : all.filter((r) => r.state === f);
  return (
    <div className="space-y-3">
      <Toolbar className="!mb-0"><FilterChips value={f} onChange={setF} options={[{ id: 'ALL', label: t('الكل'), count: all.length }, { id: 'REQUESTED', label: t('مستني موافقة'), count: all.filter((r) => r.state === 'REQUESTED').length, tone: 'warning' }, { id: 'PAID', label: t('اتصرف'), count: all.filter((r) => r.state === 'PAID').length }]} /></Toolbar>
      <Table align={['start', 'end', 'start', 'start', 'start', 'start', 'end']} loading={q.loading} head={[t('الشيك'), t('المبلغ'), t('هيرجع إزاي'), t('السبب'), t('الحالة'), t('اتطلب'), '']} rows={list.map((r: any) => [
        <span className="num font-bold">#{r.orderNumber}</span>, <Money v={r.amount} />, methodText(r.method), <span className="text-soft">{r.reason}<Tech><span className="num text-[10px] ms-1">{r.reasonCode}</span></Tech></span>,
        <Pill tone={STATE[r.state]?.[1] ?? 'neutral'} dot>{t(STATE[r.state]?.[0] ?? '—')}</Pill>,
        <span className="num text-xs">{dateTime(r.requestedAt)}</span>,
        r.state === 'REQUESTED' ? <div className="flex gap-1 justify-end"><Button size="sm" variant="success" onClick={() => approve(r)} data-fb={`refund-approve:${r.orderNumber}`}><Check className="w-3.5 h-3.5" />{t('وافق واصرف')}</Button><Button size="sm" variant="ghost" onClick={() => reject(r)} title={t('ارفض')} aria-label={t('ارفض')}><X className="w-3.5 h-3.5" /></Button></div> : null,
      ])} empty={<EmptyState compact icon={<Receipt />} title={t('مفيش طلبات مرتجع')} text={t('اطلب مرتجع من التاب الأول.')} />} />
      <div className="text-[11px] text-dim">{t('الموافقة لازم تكون من مدير غير اللي طلب. الصرف الكاش بيطلع من الدرج المفتوح على الجهاز ده.')}</div>
    </div>
  );
}
