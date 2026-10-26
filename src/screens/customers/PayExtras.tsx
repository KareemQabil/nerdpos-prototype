// Checkout extras used by the payment screen: pay with loyalty points, and an external card/wallet
// authorization (card terminal, online card link, InstaPay, wallet) followed by the normal capture.
import React, { useState } from 'react';
import { Star, CreditCard, ShieldCheck, Gift } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Button, Field, Input, Banner, Money, Switch, Spinner, StateBadge } from '../../ui';
import { t, L } from '../../i18n';
import { cn, money } from '../../lib/format';
import { TierBadge } from './common';

export function LoyaltyRedeemBox({ order }: { order: any }) {
  const q = useQuery<any>(order.customerId ? 'Loyalty.Balance' : null, { params: { customerId: order.customerId }, query: { orderId: order.id } });
  const { run, busy } = useCommand();
  const [pts, setPts] = useState('');
  const d = q.data;
  if (!order.customerId) return <Banner tone="info">{t('ضيف العميل على الشيك الأول عشان يدفع بنقاطه.')}</Banner>;
  if (!d) return <Spinner />;
  const r = d.redeem;
  const redeem = async () => { const x = await run('Loyalty.Redeem', { body: { orderId: order.id, points: Number(pts) } }, { success: t('اتخصم من النقاط') }); if (x) setPts(''); };
  return (
    <div className="space-y-3" data-fb="loyalty-box">
      <div className="flex items-center justify-between rounded-xl surface-1 px-3 py-2">
        <span className="text-sm flex items-center gap-1.5">{d.customerName}<TierBadge tier={d.tier} /></span>
        <span className="text-end"><b className="num text-lg text-[var(--primary)]">{d.balance}</b> <span className="text-xs text-dim">{t('نقطة')} = {money(d.valueEgp)}</span></span>
      </div>
      {!d.program.enabled ? <Banner tone="warning">{t('برنامج النقاط مقفول.')}</Banner> : !r?.canRedeem ? (
        <Banner tone="info">{d.balance < d.program.minRedeemPoints ? t('لازم يكون معاه {m} نقطة على الأقل عشان يصرف.', { m: d.program.minRedeemPoints }) : t('مفيش مبلغ متاح يتدفع بالنقاط على الشيك ده.')}</Banner>
      ) : (
        <>
          <div className="text-xs text-dim">{t('النقطة بـ {v} ج.م · أقصى حاجة على الشيك ده {p} نقطة = {m} (لحد {x}% من الشيك)', { v: money(d.program.pointValue, false), p: r.maxPoints, m: money(r.maxValue), x: r.maxRedeemPercent })}</div>
          <Field label={t('عدد النقاط')}><Input data-fb="redeem-points" value={pts} onChange={(e) => setPts(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" className="text-2xl num" placeholder={String(r.maxPoints)} /></Field>
          <div className="flex gap-1.5 flex-wrap">
            {[r.minRedeemPoints, Math.floor(r.maxPoints / 2), r.maxPoints].filter((v, i, a) => v >= r.minRedeemPoints && a.indexOf(v) === i).map((v) => <Button key={v} size="sm" className="num" onClick={() => setPts(String(v))}>{v}</Button>)}
          </div>
          <Button variant="primary" size="xl" className="w-full" loading={busy} disabled={!Number(pts)} onClick={redeem} data-fb="redeem"><Star className="w-5 h-5" />{t('ادفع بالنقاط')}</Button>
        </>
      )}
      {d.earnPreview?.points > 0 && <div className="text-[11px] text-dim flex items-center gap-1"><Gift className="w-3.5 h-3.5" />{t('هيكسب حوالي {p} نقطة لما الشيك يتقفل', { p: d.earnPreview.points })}</div>}
    </div>
  );
}

const PROVIDERS: [string, string, string][] = [['CARD_TERMINAL', 'مكنة الكارت', 'CARD'], ['ONLINE_CARD', 'كارت أونلاين (لينك)', 'CARD'], ['INSTAPAY', 'إنستاباي', 'DIGITAL_WALLET'], ['WALLET', 'محفظة موبايل', 'DIGITAL_WALLET']];

export function ExternalAuthBox({ order, remaining }: { order: any; remaining: string }) {
  const { run, busy } = useCommand();
  const [provider, setProvider] = useState('CARD_TERMINAL');
  const [amount, setAmount] = useState('');
  const [approve, setApprove] = useState(true);
  const [last, setLast] = useState<any>(null);
  const plain = money(remaining, false).replace(/,/g, '');
  const go = async () => {
    const a = await run<any>('Payment.AuthorizeExternal', { body: { orderId: order.id, provider, amount: amount || plain, outcome: approve ? 'APPROVE' : 'DECLINE' } });
    if (!a) return;
    setLast(a);
    if (a.state === 'APPROVED') {
      const c = await run('Payment.Capture', { params: { orderId: order.id }, body: { tenders: [{ method: a.method, amount: a.amount, authorizationId: a.id, walletProvider: provider === 'INSTAPAY' ? 'INSTAPAY' : undefined }] } }, { success: t('اتدفع إلكتروني'), refId: order.id });
      if (c) setAmount('');
    }
  };
  return (
    <div className="space-y-3" data-fb="external-box">
      <div className="grid grid-cols-2 gap-1.5">{PROVIDERS.map(([k, v]) => <button key={k} onClick={() => setProvider(k)} data-fb={`provider:${k}`} className={cn('h-11 rounded-xl border text-sm', provider === k ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{t(v)}</button>)}</div>
      <Field label={t('المبلغ')} hint={t('الافتراضي = المتبقي')}><Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={plain} className="num" /></Field>
      <div className="rounded-xl border border-dashed line p-2.5 flex items-center justify-between gap-2"><span className="text-xs text-dim">{t('محاكاة رد البنك / المحفظة')}</span><Switch checked={approve} onChange={setApprove} label={approve ? t('هيوافق') : t('هيرفض')} /></div>
      {last?.state === 'DECLINED' && <Banner tone="error">{t('اترفضت')}: {last.declineReason}</Banner>}
      {last?.state === 'APPROVED' && <Banner tone="success">{t('اتوافق')} — <span className="num">{last.reference}</span></Banner>}
      <Button variant="primary" size="xl" className="w-full" loading={busy} onClick={go} data-fb="external-authorize"><ShieldCheck className="w-5 h-5" />{t('اطلب الموافقة وادفع')}</Button>
      <div className="text-[11px] text-dim">{t('بيطلب موافقة من المكنة / المحفظة، ولو اتوافق بيتسجل الدفع برقم الموافقة. مفيش ربط حقيقي في النسخة دي.')}</div>
    </div>
  );
}

export function EarnedNote({ order }: { order: any }) {
  const q = useQuery<any>(order.customerId ? 'Loyalty.Balance' : null, { params: { customerId: order.customerId } });
  const e = (q.data?.entries ?? []).find((x: any) => x.orderId === order.id && x.kind === 'EARN');
  if (!order.customerId || !q.data) return null;
  return <div className="text-sm text-[var(--primary)] flex items-center justify-center gap-1.5" data-fb="earned-note"><Star className="w-4 h-4" />{e ? t('{n} كسب {p} نقطة — رصيده دلوقتي {b}', { n: q.data.customerName, p: e.points, b: q.data.balance }) : t('رصيد {n}: {b} نقطة', { n: q.data.customerName, b: q.data.balance })}</div>;
}
