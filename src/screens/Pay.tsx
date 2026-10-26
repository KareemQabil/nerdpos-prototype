// D1 Pay: confirm, pay cash (keypad, quick cash, change), card with terminal reference, wallets, split tender,
// partial payment, remaining shown; complete when paid. Every amount comes from the server (the change shown while
// typing is only a preview; the real change comes back with the payment).
import React, { useEffect, useState } from 'react';
import { ArrowRight, Banknote, CreditCard, Smartphone, CheckCircle2, Receipt, PiggyBank, ShieldCheck, Star, Delete, Printer, Plus, Wallet } from 'lucide-react';
import { useDev, useQuery, useCommand, useUnknowns } from '../app/hooks';
import { PageHeader, StateBadge, Button, Card, Money, Field, Input, Select, Banner, Pill, Skeleton, Stepper, Kbd, EmptyState } from '../ui';
import { t, L } from '../i18n';
import { cn, money, qty } from '../lib/format';
import { StatusPill } from './order/CheckPanel';
import { CustomerChip } from './customers/common'; // crm area
import { LoyaltyRedeemBox, ExternalAuthBox, EarnedNote } from './customers/PayExtras'; // crm area
import { METHOD_AR } from './ops/BusinessDay';
import { Tech } from '../app/tech';

export default function Pay() {
  const { params, nav } = useDev();
  if (!params.orderId) return <EmptyState icon={<Wallet />} title={t('مفيش شيك للتحصيل')} text={t('افتح الشيك من الصالة أو الشيكات ودوس «تحصيل».')} action={<Button variant="primary" onClick={() => nav('checks')}>{t('الشيكات')}</Button>} />;
  return <PayPanel orderId={params.orderId} onBack={() => nav(params.back ?? 'floor', params.back === 'order' ? { orderId: params.orderId, back: 'floor' } : {})} />;
}

const where = (o: any) => (o.kind === 'STAFF_MEAL' ? t('وجبة موظف') : o.tableName ? `${t('ترابيزة')} ${o.tableName} · ${t('شيك')} ${o.checkNo}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة كاونتر'));

export function PayPanel({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { nav, auth } = useDev();
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const order = o.data;
  const st = useQuery<any>(order && order.status !== 'DRAFT' ? 'Payment.GetSettlement' : null, { params: { orderId } });
  const { run, busy } = useCommand();
  const unknown = useUnknowns(auth.deviceId).find((u) => u.refId === orderId);
  const [lastChange, setLastChange] = useState<string | null>(null);
  if (!order) return <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4"><Skeleton className="h-[420px] rounded-2xl" /><Skeleton className="h-[420px] rounded-2xl" /></div>;
  const T = order.totals;
  const s = st.data;
  const confirm = async () => {
    const r = await run<any>('Order.Confirm', { params: { orderId }, body: { expectedVersion: order.version } });
    if (r) setLastChange(null);
  };
  const complete = async () => { await run('Order.Complete', { params: { orderId }, body: { expectedVersion: order.version } }, { success: t('الشيك اتقفل') }); };
  const step = order.status === 'DRAFT' ? 0 : order.status === 'CONFIRMED' ? (s?.settled ? 2 : 1) : 3;
  return (
    <div data-screen="D1" className="@container/pay space-y-4">
      <PageHeader title={<>{t('التحصيل')} <span className="num text-soft text-lg font-bold">#{order.number}</span></>} ops={['Order.Confirm', 'Payment.Capture', 'Payment.GetSettlement', 'Order.Complete']} description={where(order)}
        actions={<Button variant="ghost" onClick={onBack} data-fb="pay-back"><ArrowRight className="w-4 h-4 ltr:rotate-180" />{t('رجوع')}</Button>} className="!mb-0" />
      {order.status !== 'VOIDED' && order.status !== 'CANCELLED' && <Stepper steps={[{ label: t('تأكيد الشيك') }, { label: t('الدفع') }, { label: t('إنهاء') }]} current={step} className="max-w-xl" />}
      <div className="grid @[880px]/pay:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 items-start">
        {/* the check */}
        <Card title={<span className="flex items-center gap-2">{t('الشيك')} <StatusPill s={order.status} /></span>} className="order-2 @[880px]/pay:order-none">
          {order.kind !== 'STAFF_MEAL' && <div className="mb-3"><CustomerChip order={order} editable={order.status !== 'COMPLETED'} /></div>}
          <div className="space-y-1.5 text-sm max-h-[38vh] overflow-y-auto pe-1">
            {order.lines.filter((l: any) => l.status === 'ACTIVE' || l.status === 'VOIDED').map((l: any) => (
              <div key={l.id} className={cn('flex justify-between gap-3', l.status === 'VOIDED' && 'line-through opacity-50')}>
                <span className="min-w-0"><span className="num font-bold text-[var(--primary)]">{qty(l.quantity)}×</span> {L(l.name)}{l.variant ? ` (${L(l.variant.name)})` : ''}{l.modifiers.length ? <span className="text-dim text-xs"> — {l.modifiers.map((m: any) => L(m.name)).join(t('، '))}</span> : ''}</span>
                <span className="num shrink-0">{money(l.lineTotal)}</span>
              </div>
            ))}
          </div>
          <div className="border-t line mt-3 pt-3 space-y-1 text-sm">
            <Line k={t('الأصناف')} v={T.itemsSubtotal} />
            {T.discountTotal !== '0.0000' && <Line k={t('الخصم')} v={'-' + T.discountTotal} />}
            {T.serviceRate && <Line k={<>{t('خدمة')} <span className="num">{qty(T.serviceRate)}%</span></>} v={T.serviceCharge} />}
            {T.charges.map((c: any) => <Line key={c.id} k={L(c.label)} v={c.amount} />)}
            {T.tableTax !== '0.0000' && <Line k={t('ضريبة الجدول')} v={T.tableTax} />}
            {T.taxLines.map((x: any, i: number) => <Line key={i} k={<>{L(x.name)} <span className="num">{qty(x.rate)}%</span></>} v={x.amount} />)}
            <div className="flex justify-between items-center pt-2 border-t line"><b className="text-base">{t('الإجمالي')}</b><Money v={T.payable} big /></div>
          </div>
        </Card>

        <div className="space-y-3">
          {order.status === 'DRAFT' && (
            <Card padding="lg">
              <div className="text-center space-y-1 mb-4"><div className="text-sm text-dim">{t('المطلوب')}</div><Money v={T.payable} className="text-5xl tracking-tight text-[var(--primary)]" /></div>
              <p className="text-sm text-dim mb-4 text-center leading-relaxed">{t('أكّد الشيك الأول: الأسعار بتتثبت، وأي صنف لسه ما اتبعتش بيروح المطبخ دلوقتي.')}</p>
              <Button variant="primary" size="xl" className="w-full" loading={busy} onClick={confirm} data-fb="confirm-order"><CheckCircle2 className="w-5 h-5" />{t('تأكيد الشيك')}</Button>
            </Card>
          )}
          {order.status === 'CONFIRMED' && !s && <Skeleton className="h-64 rounded-2xl" />}
          {order.status === 'CONFIRMED' && s && (
            <>
              <DueBox s={s} lastChange={lastChange} />
              {unknown && <Banner tone="warning" title={t('في دفعة نتيجتها مش معروفة')}>{t('مفيش دفع جديد لحد ما تدوس «إعادة المحاولة» على الدفعة دي.')}</Banner>}
              {!s.settled && !unknown && <TenderBox order={order} remaining={s.remaining} onChange={setLastChange} />}
              {s.captures.length > 0 && (
                <Card title={t('الدفعات')} description={s.captures.length > 1 ? t('الشيك اتدفع بأكتر من طريقة') : undefined}>
                  <div className="space-y-2 text-sm">{s.captures.map((c: any) => (
                    <div key={c.id} className="flex justify-between items-start gap-3">
                      <span className="min-w-0"><b>{methodLabel(c.method, c.walletProvider)}</b>{c.reference ? <span className="text-dim text-xs"> · {t('رقم العملية')} <span className="num">{c.reference}</span></span> : ''}{c.tendered ? <div className="text-dim text-xs">{t('الزبون إدّى')} <span className="num">{money(c.tendered)}</span> · {t('الباقي له')} <span className="num">{money(c.change)}</span></div> : null}{c.tip !== '0.0000' ? <div className="text-xs text-dim">{t('بقشيش')} <span className="num">{money(c.tip)}</span></div> : null}</span>
                      <span className="num font-bold shrink-0">{money(c.amount)}</span>
                    </div>
                  ))}</div>
                </Card>
              )}
              {s.settled && <Button variant="success" size="xl" className="w-full" loading={busy} onClick={complete} data-fb="complete-order"><CheckCircle2 className="w-5 h-5" />{t('إنهاء الشيك')}</Button>}
            </>
          )}
          {order.status === 'COMPLETED' && (
            <Card padding="lg">
              <div className="text-center space-y-3" data-fb="pay-done">
                <span className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-[color-mix(in_srgb,var(--success)_15%,transparent)]"><CheckCircle2 className="w-9 h-9 text-[var(--success)]" /></span>
                <div className="font-extrabold text-xl">{t('الشيك اتقفل')}</div>
                {lastChange && lastChange !== '0.0000' && <div className="rounded-2xl py-3 bg-[color-mix(in_srgb,var(--success)_10%,transparent)]"><div className="text-sm text-dim">{t('الباقي للزبون')}</div><Money v={lastChange} className="text-4xl text-[var(--success)]" /></div>}
                <EarnedNote order={order} />
                <div className="text-xs text-dim flex items-center justify-center gap-1.5"><Printer className="w-3.5 h-3.5" />{t('الإيصال بيتطبع لوحده، ولو الطابعة وقفت البيع بيفضل محفوظ.')}</div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button size="lg" onClick={() => nav('receipt', { orderId })} data-fb="pay-receipt"><Receipt className="w-4 h-4" />{t('اعرض الإيصال')}</Button>
                  <Button size="lg" variant="primary" onClick={onBack} data-fb="pay-next">{order.visitId ? t('رجوع للصالة') : <><Plus className="w-4 h-4" />{t('طلب جديد')}</>}</Button>
                </div>
              </div>
            </Card>
          )}
          {(order.status === 'VOIDED' || order.status === 'CANCELLED') && <Banner tone="error">{t('الشيك ده ملغي — مفيش تحصيل عليه.')}</Banner>}
        </div>
      </div>
    </div>
  );
}

/** Amount due, paid so far and the change of the last cash payment — big and readable. */
function DueBox({ s, lastChange }: { s: any; lastChange: string | null }) {
  const paid = s.paid !== '0.0000';
  return (
    <div className="rounded-2xl px-5 py-4 border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]" data-fb="pay-due">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-sm text-soft font-bold">{s.settled ? t('اتدفع بالكامل') : paid ? t('الباقي على الشيك') : t('المطلوب')}</div>
          <Money v={s.cash?.increment && !s.settled ? s.cash.due : s.remaining} className={cn('tracking-tight text-[44px] leading-tight', s.settled ? 'text-[var(--success)]' : 'text-[var(--primary)]')} />
          {s.cash?.increment && !s.settled && <div className="text-xs text-dim mt-1">{t('كاش بعد التقريب لأقرب فكة — الفرق')} <span className="num">{money(s.cash.rounding)}</span><Tech> (CashRoundingPolicy {s.cash.increment})</Tech></div>}
        </div>
        <div className="text-sm space-y-0.5 text-end">
          <div className="text-dim">{t('الإجمالي')} <span className="num font-bold text-[var(--foreground)]">{money(s.payable)}</span></div>
          {paid && <div className="text-dim">{t('اتدفع')} <span className="num font-bold text-[var(--success)]">{money(s.paid)}</span></div>}
        </div>
      </div>
      {lastChange && lastChange !== '0.0000' && <div className="mt-4 rounded-xl p-3 text-center bg-[color-mix(in_srgb,var(--success)_14%,var(--card-raised))] border border-[color-mix(in_srgb,var(--success)_40%,transparent)]" data-fb="pay-change"><div className="text-xs text-dim">{t('الباقي للزبون')}</div><Money v={lastChange} className="text-4xl text-[var(--success)]" /></div>}
    </div>
  );
}

const methodLabel = (m: string, provider?: string | null) => (provider && METHOD_AR[`${m}:${provider}`] ? t(METHOD_AR[`${m}:${provider}`]) : ({ CASH: t('كاش'), CARD: t('كارت'), DIGITAL_WALLET: t('محفظة'), DEPOSIT: t('عربون'), LOYALTY: t('نقاط'), ONLINE: t('مدفوع أونلاين'), EXTERNAL: t('دفع إلكتروني') } as Record<string, string>)[m] ?? t('طريقة دفع تانية'));
const Line = ({ k, v }: { k: React.ReactNode; v: string }) => <div className="flex justify-between"><span className="text-soft">{k}</span><span className="num">{money(v)}</span></div>;
const plainNum = (v: string) => money(v, false).replace(/,/g, '');

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
  const rem = plainNum(remaining);
  const remN = Number(rem);
  const quick = [...new Set([5, 10, 20, 50, 100, 200, 500].filter((n) => n >= 50 || remN < 50).map((n) => Math.ceil(remN / n) * n).filter((v) => v > remN))].slice(0, 4);
  const tenderN = Number(tendered || rem);
  const preview = method === 'CASH' && tendered ? tenderN - remN : 0;
  const pay = async () => {
    const tender: any = method === 'CASH' ? { method, tendered: tendered || rem } : { method, amount: amount || rem, reference: ref || undefined, walletProvider: method === 'DIGITAL_WALLET' ? provider : undefined };
    if (tipsOn && tipAmt) tender.tip = tipAmt;
    const r = await run<any>('Payment.Capture', { params: { orderId: order.id }, body: { tenders: [tender] } }, { refId: order.id, label: t('دفع') });
    if (r) { onChange(r.change); setTendered(''); setAmount(''); setRef(''); setTipAmt(''); }
  };
  const key = (k: string) => setTendered((cur) => {
    if (k === 'C') return '';
    if (k === '<') return cur.slice(0, -1);
    if (k === '.' && cur.includes('.')) return cur;
    const next = cur + k;
    return /^\d{0,6}(\.\d{0,2})?$/.test(next) ? next.replace(/^0+(?=\d)/, '') : cur;
  });
  // physical keyboard on the cashier: digits type the amount, Enter pays, Backspace deletes
  useEffect(() => {
    if (method !== 'CASH') return;
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('[role="dialog"]')) return;
      if (/^[0-9.]$/.test(e.key)) { key(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { key('<'); e.preventDefault(); }
      else if (e.key === 'Enter' && !busy) { pay(); e.preventDefault(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const methods = [
    ...enabled.map((m) => ({ id: m, label: methodLabel(m), icon: m === 'CASH' ? <Banknote /> : m === 'CARD' ? <CreditCard /> : <Smartphone /> })),
    ...(held.length ? [{ id: 'DEPOSIT', label: t('عربون'), icon: <PiggyBank /> }] : []),
    ...(order.customerId ? [{ id: 'LOYALTY', label: t('نقاط'), icon: <Star /> }] : []),
    { id: 'EXTERNAL', label: t('أونلاين'), icon: <ShieldCheck /> },
  ];
  const plainMethod = !['DEPOSIT', 'LOYALTY', 'EXTERNAL'].includes(method);
  return (
    <Card padding="md" title={t('اختار طريقة الدفع')} badge={<StateBadge ops={['Payment.Capture']} />}>
      <div className="space-y-4">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(methods.length, 6)}, minmax(0, 1fr))` }} role="radiogroup">
          {methods.map((m) => <button key={m.id} role="radio" aria-checked={method === m.id} onClick={() => setMethod(m.id)} data-fb={`tender-method:${m.id}`} className={cn('min-h-[50px] rounded-xl border flex flex-col items-center justify-center gap-0.5 text-xs font-bold [&>svg]:w-5 [&>svg]:h-5 transition-colors', method === m.id ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'surface-1 border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}>{m.icon}{m.label}</button>)}
        </div>
        {method === 'LOYALTY' && <LoyaltyRedeemBox order={order} />}
        {method === 'EXTERNAL' && <ExternalAuthBox order={order} remaining={remaining} />}
        {method === 'CASH' && (
          <div className="space-y-3">
            <div className="rounded-2xl surface-1 border line px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0"><div className="text-xs text-dim">{t('الزبون إدّى')}</div><input data-fb="cash-tendered" value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) pay(); }} inputMode="decimal" placeholder={rem} className="num bg-transparent outline-none font-extrabold w-full placeholder:text-[var(--text-dim)] placeholder:opacity-60" style={{ textAlign: 'start', fontSize: 34, lineHeight: 1.15 }} /></div>
              <div className="text-end shrink-0">
                <div className="text-xs text-dim">{preview > 0 ? t('الباقي للزبون') : preview < 0 ? t('دفع جزئي — هيفضل') : t('الباقي')}</div>
                <div className={cn('num text-2xl font-extrabold', preview > 0 ? 'text-[var(--success)]' : preview < 0 ? 'text-[var(--warning-text)]' : 'text-dim')}>{money(String(Math.abs(preview)), false)}</div>
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1.15fr)] gap-1.5">
              <div className="grid grid-cols-4 gap-1.5" data-fb="cash-keypad">
                {['7', '8', '9', '<', '4', '5', '6', 'C', '1', '2', '3', '.', '0', '00'].map((k) => (
                  <button key={k} onClick={() => (k === '00' ? (key('0'), key('0')) : key(k))} className={cn('h-11 rounded-xl border text-xl font-bold num flex items-center justify-center transition-colors active:scale-[.97]', k === 'C' || k === '<' ? 'surface-2 border-[var(--glass-border)] text-soft !text-sm' : 'bg-[var(--card-raised)] border-[var(--glass-border)] hover:bg-[var(--surface-2)]', k === '0' && 'col-span-2', k === '00' && 'col-span-2')} aria-label={k === '<' ? t('امسح رقم') : k === 'C' ? t('امسح الكل') : k}>
                    {k === '<' ? <Delete className="w-5 h-5 ltr:rotate-180" /> : k === 'C' ? t('مسح') : k}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <QuickCash fb="cash-quick:exact" on={tendered === rem} onClick={() => setTendered(rem)}><span className="text-[10px] block leading-tight text-soft">{t('بالظبط')}</span><span className="num text-sm">{rem}</span></QuickCash>
                {quick.slice(0, 3).map((v) => <QuickCash key={v} fb={`cash-quick:${v}`} on={tendered === String(v)} onClick={() => setTendered(String(v))}><span className="num text-lg">{v}</span></QuickCash>)}
              </div>
            </div>
            <div className="text-[11px] text-dim flex items-center gap-1.5 flex-wrap">{t('لو المبلغ أقل من المطلوب بيتسجل دفع جزئي وتكمّل الباقي بطريقة تانية.')}<span className="hidden lg:inline-flex items-center gap-1">· <Kbd>Enter</Kbd> {t('للدفع')}</span></div>
          </div>
        )}
        {(method === 'CARD' || method === 'DIGITAL_WALLET') && (
          <div className="space-y-3">
            {method === 'DIGITAL_WALLET' && <Field label={<span className="flex items-center gap-1">{t('المحفظة')} <StateBadge state="PROPOSED" /></span>}><Select value={provider} onChange={(e) => setProvider(e.target.value)} options={(wp.data?.value?.providers ?? ['INSTAPAY', 'VODAFONE_CASH']).map((p: string) => ({ value: p, label: METHOD_AR[`DIGITAL_WALLET:${p}`] ? t(METHOD_AR[`DIGITAL_WALLET:${p}`]) : t('محفظة تانية') }))} /></Field>}
            <Field label={t('المبلغ')} hint={t('سيبه فاضي = الباقي كله ({a}). أقل منه = دفع جزئي.', { a: money(remaining) })}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={rem} className="text-2xl h-14" /></Field>
            <Field label={method === 'CARD' ? t('رقم العملية من مكنة الكارت') : t('رقم التحويل')} required hint={t('الرقم بيتسجل بس — مفيش ربط بمكنة أو بنك في النسخة دي.')}><Input data-fb="tender-reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t('مثلًا 004512')} className="num h-12" onKeyDown={(e) => { if (e.key === 'Enter' && !busy) pay(); }} /></Field>
          </div>
        )}
        {method === 'DEPOSIT' && (
          <div className="space-y-1.5">{held.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-xl surface-1 px-3 min-h-[52px] text-sm"><span>{d.customer} · {d.purpose === 'BOOKING' ? t('عربون حجز') : t('عربون')}</span><span className="flex items-center gap-2"><Money v={d.amount} /><Button size="sm" variant="primary" onClick={() => run('Deposit.Apply', { params: { depositId: d.id }, body: { orderId: order.id } }, { success: t('العربون اتخصم') })}>{t('اخصم')}</Button></span></div>)}<div className="text-[11px] text-dim flex items-center gap-1">{t('العربون مش مبيعات لحد ما يتخصم من شيك.')} <StateBadge state="PROPOSED" /></div></div>
        )}
        {tipsOn && plainMethod && <Field label={<span className="flex items-center gap-1">{t('بقشيش')} <StateBadge state="PROPOSED" /></span>} hint={t('البقشيش فلوس لوحدها مش مبيعات، وبيظهر في تقرير الوردية.')}><Input value={tipAmt} onChange={(e) => setTipAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" /></Field>}
        {plainMethod && (
          <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pb-4 pt-2 rounded-b-2xl bg-[linear-gradient(to_top,var(--glass-bg-strong)_70%,transparent)]">
          <Button variant="primary" size="xl" className="w-full !h-16 text-xl" loading={busy} disabled={(method === 'CARD' || method === 'DIGITAL_WALLET') && !ref.trim()} onClick={pay} data-fb="capture">
            {method === 'CASH' ? <Banknote className="w-6 h-6" /> : method === 'CARD' ? <CreditCard className="w-6 h-6" /> : <Smartphone className="w-6 h-6" />}
            {t('ادفع')} <span className="num">{method === 'CASH' ? money(String(Math.min(tenderN, remN))) : money(amount || rem)}</span>
          </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function QuickCash({ children, onClick, on, fb }: { children: React.ReactNode; onClick: () => void; on?: boolean; fb: string }) {
  return <button onClick={onClick} data-fb={fb} className={cn('flex-1 min-h-12 rounded-xl border font-extrabold flex flex-col items-center justify-center px-1 transition-colors', on ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>{children}</button>;
}

