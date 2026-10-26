// D3 Refunds: request (lines, amount, method, allocation to captures), manager approval (another manager),
// payout from the drawer. A refund counts on its payout date and never restates the original Z.
import React, { useMemo, useState } from 'react';
import { Search, RotateCcw, Check, X } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Card, Input, Button, Field, Select, Money, Banner, Table, Pill, Textarea, Tabs, Modal } from '../ui';
import { t, L } from '../i18n';
import { money, qty, dateTime } from '../lib/format';
import { useReasons } from './order/CheckPanel';

export default function Refunds() {
  const { can } = useDev();
  const [tab, setTab] = useState<'new' | 'cases'>('new');
  return (
    <div data-screen="D3" className="space-y-4">
      <Section title={t('المرتجعات')} badge={<StateBadge ops={['Refund.Refundable', 'Refund.Request', 'Refund.Approve', 'Refund.Find']} />} sub={t('المرتجع فلوس بتطلع بموافقة مدير تاني. مش إرجاع فعلي للصنف ولا إشعار دائن ضريبي (قرار مفتوح H2).')}
        actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'new', label: t('طلب مرتجع') }, { id: 'cases', label: t('الطلبات') }]} />} />
      {tab === 'new' ? <NewRefund onDone={() => setTab('cases')} /> : <Cases />}
    </div>
  );
}

function NewRefund({ onDone }: { onDone: () => void }) {
  const [number, setNumber] = useState('');
  const found = useQuery<any>(number.length >= 1 ? 'Order.Find' : null, { query: { number, lifecycle: 'COMPLETED,CONFIRMED' } });
  const [orderId, setOrderId] = useState<string | null>(null);
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <Card title={t('دوّر على الشيك')}>
        <div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={number} onChange={(e) => setNumber(e.target.value)} className="ps-9" placeholder={t('رقم الشيك')} /></div>
        <div className="mt-2 space-y-1">{(found.data?.items ?? []).map((o: any) => <button key={o.id} onClick={() => setOrderId(o.id)} className={`w-full text-start px-3 py-2 rounded-xl border text-sm ${orderId === o.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]'}`}><span className="num font-bold">#{o.number}</span> · {o.tableName ? `${t('ترابيزة')} ${o.tableName}` : o.channel} · <span className="num">{money(o.totals.payable)}</span></button>)}</div>
      </Card>
      {orderId ? <RefundForm orderId={orderId} onDone={onDone} /> : <Banner tone="info">{t('اختار شيك اتدفع')}</Banner>}
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
  if (!d) return null;
  const suggested = d.lines.filter((l: any) => Number(lineQty[l.lineId] || 0) > 0).map((l: any) => ({ l, q: lineQty[l.lineId] }));
  const submit = async () => {
    const r = await run('Refund.Request', { params: { orderId }, body: { amount, method, allocations: [{ captureId: alloc, amount }], lines: suggested.map((x: any) => ({ lineId: x.l.lineId, quantity: x.q })), reasonCode: rc, reason: note } }, { success: t('طلب المرتجع اتسجل — مستني موافقة') });
    if (r) onDone();
  };
  return (
    <Card title={t('طلب مرتجع')}>
      <div className="space-y-4">
        <div>
          <div className="text-sm font-bold mb-1">{t('الأصناف')} <span className="text-dim font-normal text-xs">({t('المبلغ لكل صنف شامل نصيبه من الخصم والخدمة والضريبة — من السيرفر')})</span></div>
          <Table head={[t('الصنف'), t('الكمية'), t('اترجع'), t('للوحدة'), t('ارجع')]} rows={d.lines.map((l: any) => [L(l.name), qty(l.quantity), qty(l.refundedQuantity), <Money v={l.unitRefundable} />, <div className="flex items-center gap-1"><Input value={lineQty[l.lineId] ?? ''} onChange={(e) => setLineQty({ ...lineQty, [l.lineId]: e.target.value.replace(/[^0-9.]/g, '') })} className="!w-16 !py-1" inputMode="decimal" /><Button size="sm" variant="ghost" onClick={() => { setLineQty({ ...lineQty, [l.lineId]: '1' }); setAmount(money(l.unitRefundable, false).replace(/,/g, '')); }}>{t('1 + المبلغ')}</Button></div>])} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={t('المبلغ')} hint={`${t('المدفوع الفعلي')} ${money(d.effectivePaid)}`}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /></Field>
          <Field label={t('طريقة الصرف')}><Select value={method} onChange={(e) => setMethod(e.target.value)} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: m }))} /></Field>
          <Field label={t('على أنهي دفعة')} hint={t('RefundMethodPolicy: الافتراضي نفس الوسيلة بس')}><Select value={alloc} onChange={(e) => setAlloc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...d.captures.map((c: any) => ({ value: c.captureId, label: `${c.method} ${money(c.amount)} — ${t('متاح')} ${money(c.remaining)}` }))]} /></Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t('السبب')}><Select value={rc} onChange={(e) => setRc(e.target.value)} options={[{ value: '', label: t('اختار') }, ...reasons.map((r) => ({ value: r.code, label: L(r.label) }))]} /></Field>
          <Field label={t('ملاحظة (مطلوبة)')}><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[44px]" /></Field>
        </div>
        <Button variant="primary" loading={busy} disabled={!amount || !alloc || !rc || !note} onClick={submit}><RotateCcw className="w-4 h-4" />{t('اطلب المرتجع')}</Button>
      </div>
    </Card>
  );
}

function Cases() {
  const q = useQuery<any>('Refund.Find', { query: {} });
  const { run } = useCommand();
  const approve = (r: any) => run('Refund.Approve', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version, payoutMethod: r.method } }, { success: t('المرتجع اتصرف') });
  return (
    <Card>
      <Table head={[t('الشيك'), t('المبلغ'), t('الوسيلة'), t('السبب'), t('الحالة'), t('اتطلب'), '']} rows={(q.data?.items ?? []).slice().reverse().map((r: any) => [
        <span className="num">#{r.orderNumber}</span>, <Money v={r.amount} />, r.method, `${r.reasonCode} — ${r.reason}`,
        <Pill tone={r.state === 'PAID' ? 'success' : r.state === 'REQUESTED' ? 'warning' : 'neutral'}>{({ REQUESTED: t('مستني موافقة'), PAID: t('اتصرف'), REJECTED: t('اترفض'), CANCELLED: t('اتلغى'), APPROVED: t('اتوافق') } as any)[r.state]}</Pill>,
        <span className="num text-xs">{dateTime(r.requestedAt)}</span>,
        r.state === 'REQUESTED' && <div className="flex gap-1"><Button size="sm" variant="success" onClick={() => approve(r)}><Check className="w-3.5 h-3.5" />{t('موافقة وصرف')}</Button><Button size="sm" variant="ghost" onClick={() => run('Refund.Reject', { params: { refundCaseId: r.id }, body: { expectedVersion: r.version } })}><X className="w-3.5 h-3.5" /></Button></div>,
      ])} />
      <div className="text-[11px] text-dim mt-2">{t('الموافقة REFUND_APPROVE دايمًا، ومن مدير غير اللي طلب (SelfApprovalPolicy). الصرف الكاش بيطلع من درج مفتوح على الجهاز ده ويتحسب في يوم الصرف.')}</div>
    </Card>
  );
}
