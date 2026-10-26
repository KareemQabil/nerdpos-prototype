// D1 Pay: confirm, pay cash (tendered and change), card with terminal reference, wallets, split tender,
// partial payment, remaining shown; complete when paid. Every amount comes from the server.
import React, { useState } from 'react';
import { ArrowRight, Banknote, CreditCard, Smartphone, CheckCircle2, Receipt, PiggyBank, ShieldCheck } from 'lucide-react';
import { useDev, useQuery, useCommand, useUnknowns } from '../app/hooks';
import { Section, StateBadge, Button, Card, Money, Field, Input, Select, Banner, Pill, Tabs, KV, Spinner, Table } from '../ui';
import { t, L } from '../i18n';
import { cn, money, qty, time } from '../lib/format';
import { StatusPill } from './order/CheckPanel';

export default function Pay() {
  const { params, nav } = useDev();
  return <PayPanel orderId={params.orderId} onBack={() => nav(params.back ?? 'floor', params.back === 'order' ? { orderId: params.orderId, back: 'floor' } : {})} />;
}

export function PayPanel({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { nav, auth } = useDev();
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const order = o.data;
  const st = useQuery<any>(order && order.status !== 'DRAFT' ? 'Payment.GetSettlement' : null, { params: { orderId } });
  const { run, busy } = useCommand();
  const unknown = useUnknowns(auth.deviceId).find((u) => u.refId === orderId);
  const [lastChange, setLastChange] = useState<string | null>(null);
  if (!order) return <Spinner />;
  const T = order.totals;
  const s = st.data;
  const confirm = async () => {
    const r = await run<any>('Order.Confirm', { params: { orderId }, body: { expectedVersion: order.version } });
    if (r) setLastChange(null);
  };
  const complete = async () => { await run('Order.Complete', { params: { orderId }, body: { expectedVersion: order.version } }, { success: t('الشيك اتقفل') }); };
  return (
    <div data-screen="D1" className="space-y-4">
      <Section title={`${t('التحصيل')} · #${order.number}`} badge={<StateBadge ops={['Order.Confirm', 'Payment.Capture', 'Payment.GetSettlement', 'Order.Complete']} />} sub={order.tableName ? `${t('ترابيزة')} ${order.tableName} · ${t('شيك')} ${order.checkNo}` : order.channel === 'TAKEAWAY' ? t('تيك أواي') : ''}
        actions={<Button variant="ghost" onClick={onBack}><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع')}</Button>} />
      <div className="grid lg:grid-cols-[1fr_420px] gap-4">
        <Card title={<span className="flex items-center gap-2">{t('الشيك')} <StatusPill s={order.status} /></span>}>
          <div className="space-y-1 text-sm">
            {order.lines.filter((l: any) => l.status === 'ACTIVE' || l.status === 'VOIDED').map((l: any) => (
              <div key={l.id} className={cn('flex justify-between gap-2', l.status === 'VOIDED' && 'line-through opacity-50')}>
                <span>{qty(l.quantity)} × {L(l.name)}{l.variant ? ` (${L(l.variant.name)})` : ''}{l.modifiers.length ? ` — ${l.modifiers.map((m: any) => L(m.name)).join('، ')}` : ''}</span>
                <span className="num">{money(l.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div className="border-t line mt-3 pt-3 space-y-1 text-sm">
            <Line k={t('المجموع')} v={T.itemsSubtotal} />
            {T.discountTotal !== '0.0000' && <Line k={t('الخصم')} v={'-' + T.discountTotal} />}
            {T.serviceRate && <Line k={`${t('خدمة')} ${T.serviceRate}%`} v={T.serviceCharge} />}
            {T.charges.map((c: any) => <Line key={c.id} k={L(c.label)} v={c.amount} />)}
            {T.tableTax !== '0.0000' && <Line k={t('ضريبة الجدول')} v={T.tableTax} />}
            {T.taxLines.map((x: any, i: number) => <Line key={i} k={`${L(x.name)} ${x.rate}%`} v={x.amount} />)}
            <div className="flex justify-between items-center pt-2 border-t line"><b className="text-lg">{t('الإجمالي')}</b><Money v={T.payable} big tone="primary" /></div>
          </div>
        </Card>

        <div className="space-y-3">
          {order.status === 'DRAFT' && (
            <Card title={t('١. تأكيد الشيك')}>
              <p className="text-sm text-dim mb-3">{t('التأكيد بيثبت أسعار كل الأصناف، وبيبعت أي أصناف لسه ما اتبعتتش للمطبخ كجولة جديدة. لو كله اتبعت، مفيش جولة جديدة.')}</p>
              <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={confirm} data-fb="confirm-order">{t('تأكيد')}</Button>
            </Card>
          )}
          {order.status === 'CONFIRMED' && s && (
            <>
              <Card title={t('الحساب (من السيرفر)')}>
                <KV rows={[[t('المطلوب'), <Money v={s.payable} />], [t('المدفوع'), <Money v={s.paid} />], [t('المتبقي'), <Money v={s.remaining} big tone={s.settled ? 'success' : 'primary'} />], ...(s.cash.increment ? [[t('المطلوب كاش (بعد التقريب)'), <span><Money v={s.cash.due} /> <span className="text-[11px] text-dim">({t('فرق')} {money(s.cash.rounding)} · CashRoundingPolicy {s.cash.increment})</span></span>] as [string, React.ReactNode]] : [])]} />
                {lastChange && lastChange !== '0.0000' && <div className="mt-3 rounded-xl p-3 text-center bg-[color-mix(in_srgb,var(--success)_15%,transparent)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)]"><div className="text-xs text-dim">{t('الباقي للعميل')}</div><div className="text-3xl font-bold num text-[var(--success)]">{money(lastChange)}</div></div>}
              </Card>
              {unknown && <Banner tone="warning">{t('في دفعة نتيجتها مش معروفة — مفيش دفعة جديدة لحد ما تعيد المحاولة.')}</Banner>}
              {!s.settled && !unknown && <TenderBox order={order} remaining={s.remaining} onChange={setLastChange} />}
              {s.captures.length > 0 && (
                <Card title={t('الدفعات')}>
                  <div className="space-y-1 text-sm">{s.captures.map((c: any) => <div key={c.id} className="flex justify-between gap-2"><span>{methodLabel(c.method)}{c.walletProvider ? ` · ${c.walletProvider}` : ''}{c.reference ? <span className="num text-dim text-xs"> · {c.reference}</span> : ''}{c.tendered ? <span className="text-dim text-xs"> · {t('مستلم')} {money(c.tendered)} · {t('باقي')} {money(c.change)}</span> : ''}{c.tip !== '0.0000' ? <span className="text-xs text-dim"> · {t('بقشيش')} {money(c.tip)}</span> : ''}</span><span className="num font-bold">{money(c.amount)}</span></div>)}</div>
                </Card>
              )}
              {s.settled && <Button variant="success" size="xl" className="w-full" loading={busy} onClick={complete} data-fb="complete-order"><CheckCircle2 className="w-5 h-5" />{t('إنهاء الشيك')}</Button>}
            </>
          )}
          {order.status === 'COMPLETED' && (
            <Card>
              <div className="text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 mx-auto text-[var(--success)]" />
                <div className="font-bold text-lg">{t('الشيك اتقفل')}</div>
                {lastChange && lastChange !== '0.0000' && <div className="text-2xl num font-bold text-[var(--success)]">{t('الباقي')} {money(lastChange)}</div>}
                <div className="flex gap-2 justify-center flex-wrap">
                  <Button onClick={() => nav('receipt', { orderId })}><Receipt className="w-4 h-4" />{t('الإيصال')}</Button>
                  <Button variant="primary" onClick={onBack}>{t('رجوع')}</Button>
                </div>
                <div className="text-[11px] text-dim">{t('الطباعة والإيصال الإلكتروني بيحصلوا بعد الحفظ؛ لو فشلوا البيع بيفضل خلصان (شوف طابور الطباعة والإيصال الإلكتروني).')}</div>
              </div>
            </Card>
          )}
          {(order.status === 'VOIDED' || order.status === 'CANCELLED') && <Banner tone="error">{t('الشيك ده ملغي')}</Banner>}
        </div>
      </div>
    </div>
  );
}

const methodLabel = (m: string) => ({ CASH: t('كاش'), CARD: t('كارت'), DIGITAL_WALLET: t('محفظة'), DEPOSIT: t('عربون') } as Record<string, string>)[m] ?? m;
const Line = ({ k, v }: { k: React.ReactNode; v: string }) => <div className="flex justify-between"><span className="text-dim">{k}</span><span className="num">{money(v)}</span></div>;

function TenderBox({ order, remaining, onChange }: { order: any; remaining: string; onChange: (c: string | null) => void }) {
  const { auth } = useDev();
  const { run, busy } = useCommand();
  const tm = useQuery<any>('Settings.Effective', { query: { policyId: 'TenderMethodPolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const tip = useQuery<any>('Settings.Effective', { query: { policyId: 'TipPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const wp = useQuery<any>('Settings.Effective', { query: { policyId: 'WalletProvidersPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const deposits = useQuery<any>('Deposit.Find', { query: {} });
  const enabled: string[] = tm.data?.value?.enabled ?? ['CASH', 'CARD'];
  const held = (deposits.data?.items ?? []).filter((d: any) => d.state === 'HELD');
  const [method, setMethod] = useState('CASH');
  const [tendered, setTendered] = useState('');
  const [amount, setAmount] = useState('');
  const [ref, setRef] = useState('');
  const [provider, setProvider] = useState('INSTAPAY');
  const [tipAmt, setTipAmt] = useState('');
  const tipsOn = tip.data?.value === 'ON';
  const remainingDisplay = money(remaining, false).replace(/,/g, '');
  const quick = [remainingDisplay, ...[50, 100, 200, 500].map((n) => String(Math.ceil(Number(remainingDisplay) / n) * n))].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  const pay = async () => {
    const tender: any = method === 'CASH' ? { method, tendered: tendered || remainingDisplay } : { method, amount: amount || remainingDisplay, reference: ref || undefined, walletProvider: method === 'DIGITAL_WALLET' ? provider : undefined };
    if (tipsOn && tipAmt) tender.tip = tipAmt;
    const r = await run<any>('Payment.Capture', { params: { orderId: order.id }, body: { tenders: [tender] } }, { refId: order.id, label: t('دفع') });
    if (r) { onChange(r.change); setTendered(''); setAmount(''); setRef(''); setTipAmt(''); }
  };
  const applyDeposit = async (id: string) => { await run('Deposit.Apply', { params: { depositId: id }, body: { orderId: order.id } }, { success: t('العربون اتخصم') }); };
  return (
    <Card title={t('٢. الدفع')} badge={<StateBadge ops={['Payment.Capture']} />}>
      <div className="space-y-3">
        <Tabs value={method} onChange={setMethod} tabs={[
          ...enabled.map((m) => ({ id: m, label: <span className="flex items-center gap-1">{m === 'CASH' ? <Banknote className="w-4 h-4" /> : m === 'CARD' ? <CreditCard className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}{methodLabel(m)}</span> })),
          ...(held.length ? [{ id: 'DEPOSIT', label: <span className="flex items-center gap-1"><PiggyBank className="w-4 h-4" />{t('عربون')}</span> }] : []),
        ]} />
        {method === 'CASH' && (
          <>
            <Field label={t('المبلغ المستلم')} hint={t('لو أقل من المتبقي = دفع جزئي (تقسيم الدفع)')}><Input data-fb="cash-tendered" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={remainingDisplay} className="text-2xl" /></Field>
            <div className="flex gap-1.5 flex-wrap">{quick.map((q) => <Button key={q} size="sm" onClick={() => setTendered(q)} className="num">{q}</Button>)}</div>
          </>
        )}
        {(method === 'CARD' || method === 'DIGITAL_WALLET') && (
          <>
            {method === 'DIGITAL_WALLET' && <Field label={<span className="flex items-center gap-1">{t('المحفظة')} <StateBadge state="PROPOSED" /></span>}><Select value={provider} onChange={(e) => setProvider(e.target.value)} options={(wp.data?.value?.providers ?? ['INSTAPAY', 'VODAFONE_CASH']).map((p: string) => ({ value: p, label: p === 'INSTAPAY' ? 'InstaPay إنستاباي' : p === 'VODAFONE_CASH' ? 'Vodafone Cash فودافون كاش' : p }))} /></Field>}
            <Field label={t('المبلغ')} hint={t('الافتراضي = المتبقي من السيرفر. أكبر منه = OVERPAYMENT')}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={remainingDisplay} /></Field>
            <Field label={method === 'CARD' ? t('رقم العملية من مكنة الكارت (إجباري)') : t('رقم التحويل (إجباري)')} hint={t('مفيش ربط بمزود دفع — الرقم بيتسجل بس')}><Input data-fb="tender-reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="DEMO-REF-0001" className="num" /></Field>
          </>
        )}
        {method === 'DEPOSIT' && (
          <div className="space-y-1.5">{held.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-xl surface-1 px-3 py-2 text-sm"><span>{d.customer} · {d.purpose}</span><span className="flex items-center gap-2"><Money v={d.amount} /><Button size="sm" onClick={() => applyDeposit(d.id)}>{t('اخصم')}</Button></span></div>)}<div className="text-[11px] text-dim">{t('العربون التزام مش مبيعات لحد ما يتخصم من شيك.')} <StateBadge state="PROPOSED" /></div></div>
        )}
        {tipsOn && method !== 'DEPOSIT' && <Field label={<span className="flex items-center gap-1">{t('بقشيش')} <StateBadge state="PROPOSED" /></span>} hint={t('فلوس لوحدها مش مبيعات، بتظهر في تقرير الوردية')}><Input value={tipAmt} onChange={(e) => setTipAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /></Field>}
        {method !== 'DEPOSIT' && <Button variant="primary" size="xl" className="w-full" loading={busy} onClick={pay} data-fb="capture">{t('ادفع')}</Button>}
      </div>
    </Card>
  );
}
