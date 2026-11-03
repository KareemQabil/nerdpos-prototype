// Payment as a large centered popup over the sale screen (not a side panel, not a route).
// Amount due large; tender tiles; the shared Numpad; quick cash (exact, next 50/100/200…); split tender as lines;
// change in very large type before confirming. Keyboard: digits, ".", Backspace, Delete, Enter confirm, Esc close,
// F1…F6 pick the tender. Every amount comes from the server: the change shown while typing is a Decimal preview of
// server strings; the confirmed change comes back with the payment. The check is confirmed (prices locked, items
// fired) only when the first payment is confirmed, so closing the popup before paying leaves the check untouched.
import React, { useEffect, useRef, useState } from 'react';
import { Banknote, CreditCard, Smartphone, Globe, Star, PiggyBank, CheckCircle2, Receipt, Plus, Split, X, AlertTriangle, Printer } from 'lucide-react';
import { useDev, useQuery, useCommand, useUnknowns, errorText } from '../../app/hooks';
import { call } from '../../api/client';
import { Popup, Money, Numpad, applyNumpadKey, useNumpadKeys, Kbd, Skeleton, Button, Input, Pill, type NumpadKey } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money, qty } from '../../lib/format';
import { changePreview, sign, plainAmount, quickCash } from '../../lib/cash';
import { tenderLabel, tenderGroupLabel, providerLabel } from '../../demo/tenderText';
import { LoyaltyRedeemBox, EarnedNote } from '../customers/PayExtras';
import { Tech } from '../../app/tech';
import { customerDisplay } from '../../app/customerDisplay';

type Method = 'CASH' | 'CARD' | 'DIGITAL_WALLET' | 'ONLINE' | 'LOYALTY' | 'DEPOSIT';
const ICON: Record<Method, React.ReactElement> = { CASH: <Banknote />, CARD: <CreditCard />, DIGITAL_WALLET: <Smartphone />, ONLINE: <Globe />, LOYALTY: <Star />, DEPOSIT: <PiggyBank /> };
const TENDER_KEYS = ['F1', 'F2', 'F3', 'F4', 'F6', 'F7'];

export const placeOf = (o: any) => (o.kind === 'STAFF_MEAL' ? t('وجبة موظف') : o.tableName ? `${t('ترابيزة')} ${o.tableName} · ${t('شيك')} ${o.checkNo}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : o.channel === 'DELIVERY' ? t('دليفري') : t('صالة كاونتر'));

export function PaymentPopup({ orderId, onClose, onNext }: { orderId: string; onClose: () => void; onNext: () => void }) {
  const { auth, nav } = useDev();
  const o = useQuery<any>('Order.Get', { params: { orderId } });
  const order = o.data;
  const st = useQuery<any>(order && order.status !== 'DRAFT' ? 'Payment.GetSettlement' : null, { params: { orderId } });
  const tm = useQuery<any>('Settings.Effective', { query: { policyId: 'TenderMethodPolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const tip = useQuery<any>('Settings.Effective', { query: { policyId: 'TipPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const wp = useQuery<any>('Settings.Effective', { query: { policyId: 'WalletProvidersPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const refPol = useQuery<any>('Settings.Effective', { query: { policyId: 'TenderReferencePolicy', scopeType: 'BRANCH', scopeId: auth.branchId } });
  const deposits = useQuery<any>('Deposit.Find', { query: {} });
  const { run, busy } = useCommand();
  const unknown = useUnknowns(auth.deviceId).find((u) => u.refId === orderId);
  const panel = useRef<HTMLDivElement>(null);

  const [method, setMethod] = useState<Method>('CASH');
  const [entry, setEntry] = useState('');
  const [split, setSplit] = useState(false);
  const [ref, setRef] = useState('');
  const [provider, setProvider] = useState('INSTAPAY');
  const [prepaidVia, setPrepaidVia] = useState<'APP' | 'PAYMENT_LINK'>('PAYMENT_LINK');
  const [tipAmt, setTipAmt] = useState('');
  const [done, setDone] = useState<null | { change: string; completed: boolean }>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (order?.externalOrderId) setPrepaidVia('APP'); }, [order?.externalOrderId]);
  useEffect(() => { if (order?.status === 'COMPLETED' && !done) setDone({ change: '0.0000', completed: true }); }, [order?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = st.data;
  const draft = order?.status === 'DRAFT';
  const remaining: string = draft ? order?.totals?.payable ?? '0' : s?.remaining ?? '0';
  const due: string = method === 'CASH' && !draft && s?.cash?.increment && !s?.settled ? s.cash.due : remaining;
  const enabled: string[] = tm.data?.value?.enabled ?? ['CASH', 'CARD'];
  const held = (deposits.data?.items ?? []).filter((d: any) => d.state === 'HELD');
  const prepaidOk = !!(order?.externalOrderId || order?.deliveryId);
  const methods: Method[] = [
    ...(['CASH', 'CARD', 'DIGITAL_WALLET'] as Method[]).filter((m) => enabled.includes(m)),
    ...(prepaidOk ? ['ONLINE' as Method] : []),
    ...(order?.customerId ? ['LOYALTY' as Method] : []),
    ...(held.length ? ['DEPOSIT' as Method] : []),
  ];
  const plain = method !== 'LOYALTY' && method !== 'DEPOSIT';
  const refRule: 'OFF' | 'OPTIONAL' | 'REQUIRED' = method === 'CARD' || method === 'DIGITAL_WALLET' || method === 'ONLINE' ? (refPol.data?.value?.[method] ?? 'OPTIONAL') : 'OFF';
  const tipsOn = tip.data?.value === 'ON';
  const value = entry || plainAmount(due);
  // previews (Decimal on server strings): cash change / still to pay; other methods cannot exceed what is left
  const diff = changePreview(value, due);
  const change = method === 'CASH' && diff && sign(diff) > 0 ? diff : null;
  const short = diff && sign(diff) < 0 ? diff.replace('-', '') : null;
  const over = method !== 'CASH' && diff && sign(diff) > 0;
  const captures: any[] = (s?.captures ?? []).filter((c: any) => !c.correctionOf);
  const paidSome = !draft && s && s.paid !== '0.0000';
  const canPay = plain && !busy && !unknown && !over && sign(value) > 0 && !(refRule === 'REQUIRED' && !ref.trim()) && !done;

  // the customer display shows what is being paid: due, the amount typed, change (same Decimal preview as here)
  useEffect(() => {
    if (!order || done) return;
    customerDisplay.publish(auth.deviceId, { orderId, paying: { method, walletProvider: method === 'DIGITAL_WALLET' ? provider : null, due, entered: value, change, short } });
  }, [auth.deviceId, orderId, !!order, done, method, provider, due, value, change, short]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (done) customerDisplay.publish(auth.deviceId, { orderId, paying: null, paid: { orderId, change: done.change, method, at: Date.now() } }); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => customerDisplay.publish(auth.deviceId, { paying: null }), [auth.deviceId]);
  const pick = (m: Method) => { setMethod(m); setEntry(''); setErr(null); };
  const key = (k: NumpadKey) => { setErr(null); setEntry((cur) => applyNumpadKey(cur, k)); };

  const pay = async () => {
    if (!canPay || !order) return;
    setErr(null);
    let set = s;
    if (draft) {
      const c = await run<any>('Order.Confirm', { params: { orderId }, body: { expectedVersion: order.version } }, { label: t('تأكيد الشيك') });
      if (!c) return;
      try { set = (await call<any>(auth, 'Payment.GetSettlement', { params: { orderId } })).data; } catch (e) { setErr(errorText(e)); return; }
    }
    const dueNow = method === 'CASH' && set?.cash?.increment ? set.cash.due : set?.remaining ?? remaining;
    const amt = entry || plainAmount(dueNow);
    const tender: any = method === 'CASH'
      ? { method, tendered: amt }
      : { method, amount: amt, reference: refRule !== 'OFF' && ref.trim() ? ref.trim() : undefined, walletProvider: method === 'DIGITAL_WALLET' ? provider : method === 'ONLINE' ? (prepaidVia === 'APP' ? 'DELIVERY_APP' : 'PAYMENT_LINK') : undefined };
    if (tipsOn && tipAmt) tender.tip = tipAmt;
    const r = await run<any>('Payment.Capture', { params: { orderId }, body: { tenders: [tender] } }, { refId: orderId, label: t('دفع') });
    if (!r) return;
    setEntry(''); setRef(''); setTipAmt('');
    if (r.settlement?.settled) {
      let completed = false;
      try {
        const fresh = (await call<any>(auth, 'Order.Get', { params: { orderId } })).data;
        completed = !!(await run('Order.Complete', { params: { orderId }, body: { expectedVersion: fresh.version } }, { quiet: true }));
      } catch { completed = false; }
      setDone({ change: r.change, completed });
    } else {
      setSplit(true);
      if (method !== 'CASH') setMethod('CASH');
    }
  };

  // keyboard: digits / Backspace / Delete / Enter on the amount; F-keys pick the tender
  useNumpadKeys(!!order && plain && !done, key, { onEnter: pay, scope: panel });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!panel.current || document.querySelectorAll('[role="dialog"]').length > 1) return;
      if (done && e.key === 'Enter') { e.preventDefault(); onNext(); return; }
      const i = TENDER_KEYS.indexOf(e.key);
      if (i >= 0 && methods[i] && !done) { e.preventDefault(); pick(methods[i]); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const close = () => { if (!busy) (done ? onNext() : onClose()); };
  return (
    <Popup open onClose={close} size="xl" bare fb="pay-popup" labelledBy="pay-title" closeOnBackdrop={false}>
      <div ref={panel} className="flex flex-col min-h-0" data-screen="D1">
        {/* header */}
        <div className="flex items-center gap-3 px-5 h-14 border-b line shrink-0">
          <h2 id="pay-title" className="text-lg font-bold">{t('الدفع')}</h2>
          {order && <span className="text-sm text-soft truncate">{placeOf(order)} · <span className="num">#{order.number}</span></span>}
          {order?.shortNo && <span className="text-xs font-bold px-2 py-1 rounded-lg bg-[var(--foreground)] text-[var(--background)]" data-fb="pay-short-no">{t('نداء')} <span className="num">{order.shortNo}</span></span>}
          <div className="flex-1" />
          <button onClick={close} className="h-10 px-3 rounded-xl text-sm text-soft hover:bg-[var(--surface-2)] inline-flex items-center gap-2" data-fb="pay-close"><X className="w-4 h-4" />{done ? t('طلب جديد') : t('إغلاق')}<Kbd>Esc</Kbd></button>
        </div>

        {!order ? <div className="p-5 grid grid-cols-2 gap-4"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div> : done ? (
          <DoneView order={order} change={done.change} completed={done.completed} onNext={onNext} onReceipt={() => { onClose(); nav('receipt', { orderId }); }} />
        ) : (
          <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] min-h-0 overflow-y-auto">
            {/* summary: due, lines, change */}
            <div className="p-5 flex flex-col gap-4 md:border-e line min-w-0">
              <div data-fb="pay-due">
                <div className="text-sm text-soft font-semibold">{paidSome ? t('المتبقي') : t('المستحق')}</div>
                <Money v={due} className="text-[52px] leading-[1.1] tracking-tight text-[var(--primary)] font-bold" />
                {method === 'CASH' && !draft && s?.cash?.increment && s.cash.rounding !== '0.0000' && <div className="text-xs text-dim mt-1">{t('بعد تقريب النقدي')} <Money v={s.cash.rounding} className="font-medium" /><Tech> (CashRoundingPolicy {s.cash.increment})</Tech></div>}
                {paidSome && <div className="text-sm text-dim mt-1 flex gap-4"><span>{t('الإجمالي')} <Money v={s.payable} className="font-semibold text-[var(--foreground)]" /></span><span>{t('المدفوع')} <Money v={s.paid} tone="success" /></span></div>}
              </div>

              {(captures.length > 0 || split) && (
                <div className="rounded-2xl border line overflow-hidden" data-fb="pay-lines">
                  {captures.map((c, i) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-3.5 h-12 border-b line text-sm">
                      <span className="flex items-center gap-2 min-w-0"><span className="w-6 h-6 rounded-full bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-[var(--success)] flex items-center justify-center text-[11px] font-bold num">{i + 1}</span><b className="truncate">{tenderLabel(c.method, c.walletProvider)}</b>{c.reference && <span className="text-dim text-xs num">{c.reference}</span>}</span>
                      <Money v={c.amount} />
                    </div>
                  ))}
                  {plain && <div className="flex items-center justify-between gap-3 px-3.5 h-12 text-sm border-dashed bg-[var(--surface-1)]">
                    <span className="flex items-center gap-2 text-soft"><span className="w-6 h-6 rounded-full border border-dashed border-[var(--glass-border)] flex items-center justify-center text-[11px] num">{captures.length + 1}</span>{tenderGroupLabel(method)}</span>
                    <span className="amount font-semibold text-soft"><span className="num">{money(value, false)}</span></span>
                  </div>}
                </div>
              )}

              {captures.length === 0 && !split && (
                <div className="rounded-2xl border line divide-y divide-[var(--line)] max-h-[200px] overflow-y-auto text-sm" data-fb="pay-items">
                  {order.lines.filter((l: any) => l.status === 'ACTIVE').map((l: any) => (
                    <div key={l.id} className="flex items-center justify-between gap-3 px-3.5 h-10">
                      <span className="min-w-0 truncate"><span className="num font-semibold text-[var(--primary)]">{qty(l.quantity)}×</span> {L(l.name)}</span>
                      <Money v={l.lineTotal} className="font-medium text-soft" />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-auto">
                {change ? (
                  <div className="rounded-2xl px-4 py-3 bg-[color-mix(in_srgb,var(--success)_12%,var(--card-raised))] border border-[color-mix(in_srgb,var(--success)_40%,transparent)]" data-fb="pay-change">
                    <div className="text-sm font-semibold text-soft">{t('الباقي للعميل')}</div>
                    <Money v={change} className="text-[64px] leading-[1.05] tracking-tight text-[var(--success)] font-bold" />
                  </div>
                ) : short ? (
                  <div className="rounded-2xl px-4 py-3 bg-[color-mix(in_srgb,var(--warning)_10%,var(--card-raised))] border border-[color-mix(in_srgb,var(--warning)_35%,transparent)]" data-fb="pay-short">
                    <div className="text-sm font-semibold text-soft">{t('دفعة جزئية · يتبقى')}</div>
                    <Money v={short} className="text-[36px] leading-tight text-[var(--warning-text)] font-bold" />
                  </div>
                ) : <div className="h-2" />}
              </div>
            </div>

            {/* entry: tenders, amount, quick cash, numpad */}
            <div className="p-5 flex flex-col gap-3 min-w-0">
              <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(3, methods.length)}, minmax(0, 1fr))` }} role="radiogroup" aria-label={t('طريقة الدفع')}>
                {methods.map((m, i) => (
                  <button key={m} role="radio" aria-checked={method === m} onClick={() => pick(m)} data-fb={`tender-method:${m}`}
                    className={cn('relative h-16 rounded-xl border flex flex-col items-center justify-center gap-1 text-sm font-semibold [&>svg]:w-5 [&>svg]:h-5 transition-colors', method === m ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)] shadow-[0_0_0_1px_var(--primary)]' : 'surface-1 border-[var(--glass-border)] text-soft hover:bg-[var(--surface-2)]')}>
                    {ICON[m]}<span className="truncate max-w-full px-1">{m === 'DEPOSIT' ? t('عربون') : tenderGroupLabel(m)}</span>
                    {TENDER_KEYS[i] && <span className="absolute top-1 end-1.5 num text-[9px] font-semibold opacity-60">{TENDER_KEYS[i]}</span>}
                  </button>
                ))}
              </div>

              {method === 'LOYALTY' && <LoyaltyRedeemBox order={order} />}
              {method === 'DEPOSIT' && (
                <div className="space-y-1.5">{held.map((d: any) => <div key={d.id} className="flex items-center justify-between rounded-xl surface-1 px-3 min-h-[56px] text-sm"><span>{d.customer} · {d.purpose === 'BOOKING' ? t('عربون حجز') : t('عربون')}</span><span className="flex items-center gap-2"><Money v={d.amount} /><Button size="lg" variant="primary" onClick={() => run('Deposit.Apply', { params: { depositId: d.id }, body: { orderId: order.id } }, { success: t('تم خصم العربون') })}>{t('خصم')}</Button></span></div>)}</div>
              )}

              {plain && <>
                <div className={cn('rounded-2xl border px-4 h-[76px] flex items-center justify-between gap-3', over ? 'border-[var(--error)]' : 'border-[color-mix(in_srgb,var(--primary)_45%,var(--glass-border))] bg-[var(--surface-1)]')} data-fb="cash-tendered">
                  <div className="text-sm text-soft font-semibold leading-tight">{method === 'CASH' && !split ? t('المبلغ المستلم') : t('مبلغ هذه الدفعة')}</div>
                  <span className={cn('amount text-[40px] font-bold leading-none', !entry && 'opacity-45')}><span className="num">{money(value, false)}</span><span className="amount-unit">{L({ ar: 'ج.م', en: 'EGP' })}</span></span>
                </div>
                {over && <div className="text-xs text-[var(--error)] flex items-center gap-1 -mt-1"><AlertTriangle className="w-3.5 h-3.5" />{t('المبلغ أكبر من المتبقي')}</div>}

                {method === 'DIGITAL_WALLET' && (
                  <div className="flex gap-1.5 flex-wrap" data-fb="tender-wallet-provider">{(wp.data?.value?.providers ?? ['INSTAPAY', 'VODAFONE_CASH']).map((p: string) => <button key={p} onClick={() => setProvider(p)} className={cn('h-11 px-3.5 rounded-xl border text-sm', provider === p ? 'border-[var(--primary)] bg-[var(--primary-container)] font-semibold' : 'surface-1 border-[var(--glass-border)]')}>{providerLabel(p)}</button>)}</div>
                )}
                {method === 'ONLINE' && (
                  <div className="flex gap-1.5">
                    {order.externalOrderId && <button onClick={() => setPrepaidVia('APP')} data-fb="prepaid-via:APP" className={cn('h-11 px-3.5 rounded-xl border text-sm', prepaidVia === 'APP' ? 'border-[var(--primary)] bg-[var(--primary-container)] font-semibold' : 'surface-1 border-[var(--glass-border)]')}>{t('تطبيق الدليفري')}</button>}
                    <button onClick={() => setPrepaidVia('PAYMENT_LINK')} data-fb="prepaid-via:PAYMENT_LINK" className={cn('h-11 px-3.5 rounded-xl border text-sm', prepaidVia === 'PAYMENT_LINK' ? 'border-[var(--primary)] bg-[var(--primary-container)] font-semibold' : 'surface-1 border-[var(--glass-border)]')}>{t('رابط دفع')}</button>
                  </div>
                )}
                {refRule !== 'OFF' && <Input data-fb="tender-reference" data-rule={refRule} value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pay(); } }} placeholder={refRule === 'REQUIRED' ? t('رقم العملية (مطلوب)') : t('رقم العملية (اختياري)')} className="num !h-12" />}

                <div className="grid grid-cols-4 gap-1.5" data-fb="cash-quick">
                  <Quick fb="cash-quick:exact" on={!entry} onClick={() => setEntry(plainAmount(method === 'CASH' ? due : remaining))}><span className="text-[11px] text-soft font-semibold leading-none">{method === 'CASH' ? t('بالضبط') : t('المتبقي')}</span><span className="num text-sm leading-tight">{money(method === 'CASH' ? due : remaining, false)}</span></Quick>
                  {method === 'CASH' && !split && quickCash(due).map((v) => <Quick key={v} fb={`cash-quick:${v}`} on={entry === v} onClick={() => setEntry(v)}><span className="num text-xl">{v}</span></Quick>)}
                </div>
                <Numpad onKey={key} mode="amount" fb="cash-keypad" />
                {tipsOn && <Input value={tipAmt} onChange={(e) => setTipAmt(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={t('بقشيش (اختياري)')} className="num" />}
              </>}
              {unknown && <div className="rounded-xl border border-[color-mix(in_srgb,var(--warning)_40%,transparent)] px-3 py-2 text-sm text-[var(--warning-text)]">{t('نتيجة دفعة سابقة غير معروفة · أعد المحاولة أولًا')}</div>}
              {err && <div className="text-sm text-[var(--error)]">{err}</div>}
            </div>
          </div>
        )}

        {/* footer */}
        {order && !done && (
          <div className="flex items-center gap-2 px-5 py-3 border-t line overlay-footer rounded-b-3xl shrink-0">
            {plain && <Button variant={split ? 'subtle' : 'ghost'} size="lg" onClick={() => { setSplit(!split); setEntry(''); }} data-fb="pay-split" aria-pressed={split}><Split className="w-4 h-4" />{t('تقسيم الدفع')}</Button>}
            <div className="flex-1" />
            {plain && (
              <Button variant="primary" size="xl" className="min-w-[280px] !h-16 text-xl" loading={busy} disabled={!canPay} onClick={pay} data-fb="capture">
                {ICON[method]}
                {split || short ? t('إضافة دفعة') : t('تأكيد الدفع')}
                <Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd>
              </Button>
            )}
          </div>
        )}
      </div>
    </Popup>
  );
}

function Quick({ children, onClick, on, fb }: { children: React.ReactNode; onClick: () => void; on?: boolean; fb: string }) {
  return <button onClick={onClick} data-fb={fb} className={cn('h-14 rounded-xl border font-bold flex flex-col items-center justify-center gap-0.5 px-1 transition-colors', on ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]' : 'surface-1 border-[var(--glass-border)] hover:bg-[var(--surface-2)]')}>{children}</button>;
}

function DoneView({ order, change, completed, onNext, onReceipt }: { order: any; change: string; completed: boolean; onNext: () => void; onReceipt: () => void }) {
  const has = change && change !== '0.0000';
  return (
    <div className="p-8 flex flex-col items-center text-center gap-4" data-fb="pay-done">
      <span className="w-16 h-16 rounded-full flex items-center justify-center bg-[color-mix(in_srgb,var(--success)_15%,transparent)]"><CheckCircle2 className="w-9 h-9 text-[var(--success)]" /></span>
      <div className="text-2xl font-bold font-display">{completed ? t('تم الدفع') : t('تم الدفع بالكامل')}</div>
      {has && <div className="rounded-3xl px-10 py-4 bg-[color-mix(in_srgb,var(--success)_10%,transparent)] border border-[color-mix(in_srgb,var(--success)_35%,transparent)]" data-fb="pay-change"><div className="text-sm font-semibold text-soft">{t('الباقي للعميل')}</div><Money v={change} className="text-[72px] leading-[1.05] text-[var(--success)] font-bold" /></div>}
      <EarnedNote order={order} />
      <div className="text-xs text-dim flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" />{t('طباعة الإيصال تلقائيًا')}</div>
      <div className="grid grid-cols-2 gap-2 w-full max-w-md pt-1">
        <Button size="xl" onClick={onReceipt} data-fb="pay-receipt"><Receipt className="w-5 h-5" />{t('الإيصال')}</Button>
        <Button size="xl" variant="primary" onClick={onNext} data-fb="pay-next" autoFocus><Plus className="w-5 h-5" />{t('طلب جديد')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button>
      </div>
      {!completed && <Pill tone="warning">{t('الشيك مدفوع ولم يُغلق بعد')}</Pill>}
    </div>
  );
}
