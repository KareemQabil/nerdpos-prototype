// ux-11 «موبايل الطيار»: the rider's own phone. His orders only — the server limits Delivery.Board / Get and every
// command to the deliveries assigned to him — with three big buttons: «استلمت» (Delivery.Dispatch), «سلّمت»
// (Delivery.Complete, the amount to collect in view) and «فشل التسليم» (Delivery.FailAttempt with a reason), his cash
// on hand, and his shift (DriverShift.Start / End; ending is refused while he holds orders or cash).
import React, { useState } from 'react';
import { Bike, PackageCheck, CheckCircle2, XCircle, Phone, MapPin, Power, PowerOff, Banknote, CreditCard, Clock3 } from 'lucide-react';
import { useQuery, useCommand } from '../../app/hooks';
import { Button, DateTime, EmptyState, Field, Input, Money, Pill, Popup, Spinner, useNow } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { sign } from '../../lib/cash';
import { addressText, PhoneText } from '../customers/common';
import { STATE, VehicleIcon } from './common';
import { hoursText } from './Drivers';

export default function RiderPhone() {
  useNow(30000);
  const me = useQuery<any>('Driver.List', { query: {} });
  const board = useQuery<any>('Delivery.Board', { query: { scope: 'active' } });
  const { run, busy } = useCommand();
  const [deliver, setDeliver] = useState<any>(null);
  const [fail, setFail] = useState<any>(null);
  const drv = me.data?.items?.[0] ?? null;
  const items: any[] = board.data?.items ?? [];
  const active = items.filter((d) => d.state === 'ASSIGNED' || d.state === 'PICKED_UP').sort((a, b) => a.promisedAtMs - b.promisedAtMs);
  const done = items.filter((d) => d.state === 'DELIVERED');
  if (me.loading && !me.data) return <div className="p-6"><Spinner /></div>;
  if (!drv) return <EmptyState icon={<Bike />} title={t('هذا الحساب غير مرتبط بطيار')} />;
  const shift = () => run(drv.onShift ? 'DriverShift.End' : 'DriverShift.Start', { params: { driverId: drv.id }, body: { expectedVersion: drv.version } }, { success: drv.onShift ? t('انتهت ورديتك') : t('بدأت ورديتك') });
  const picked = (d: any) => run('Delivery.Dispatch', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, toState: 'PICKED_UP' } }, { success: t('استلمت الطلب {n}', { n: d.number }), refId: d.id });
  return (
    <div className="mx-auto w-full max-w-[460px] space-y-3 pb-6" data-screen="DL5" data-fb="rider-phone">
      <div className="glass rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl surface-3 flex items-center justify-center shrink-0"><VehicleIcon v={drv.vehicle} className="w-6 h-6 text-[var(--primary)]" /></span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-lg truncate" data-fb="rider-phone:name">{drv.name}</div>
            <div className="text-xs text-dim flex items-center gap-1" data-fb="rider-phone:shift">{drv.shift ? <><Clock3 className="w-3.5 h-3.5" />{t('في الوردية منذ')} <DateTime v={drv.shift.startedAt} time /> · {hoursText(drv.shift.minutes)}</> : t('خارج الوردية')}</div>
          </div>
        </div>
        <Button size="lg" className="w-full h-14 text-base" variant={drv.onShift ? 'secondary' : 'primary'} loading={busy} onClick={shift} data-fb="rider-phone:shift-toggle">
          {drv.onShift ? <PowerOff className="w-5 h-5" /> : <Power className="w-5 h-5" />}{drv.onShift ? t('إنهاء الوردية') : t('بدء الوردية')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl surface-1 border line px-3 py-2"><div className="text-[11px] text-dim">{t('معك نقد')}</div><Money v={drv.cashInHand} className="text-lg font-bold" fb="rider-phone:cash" /></div>
          <div className="rounded-xl surface-1 border line px-3 py-2"><div className="text-[11px] text-dim">{t('سلّمت اليوم')}</div><span className="num text-lg font-bold">{drv.deliveredToday}</span></div>
        </div>
      </div>
      {active.length === 0 ? (
        <EmptyState compact icon={<PackageCheck />} title={drv.onShift ? t('لا توجد طلبات معك الآن') : t('ابدأ الوردية لتصلك الطلبات')} />
      ) : active.map((d) => {
        const due = d.order ? d.order.remaining : '0.0000';
        const card = d.paymentMode === 'CARD_ON_DELIVERY';
        return (
          <div key={d.id} className="glass rounded-2xl p-4 space-y-3" data-fb={`rider-order:${d.number}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-base truncate">{d.customerName}</div>
                <div className="text-xs text-dim"><span className="num">{d.number}</span> · <span className="num">#{d.orderNumber}</span> · {d.zoneName}</div>
              </div>
              <Pill tone={STATE[d.state]?.tone}>{t(STATE[d.state]?.ar)}</Pill>
            </div>
            <div className="text-sm flex items-start gap-1.5"><MapPin className="w-4 h-4 mt-0.5 shrink-0 text-dim" /><span>{addressText(d.address)}</span></div>
            {/* ux-13: the full number (a call link) arrives once he picked the order up (CustomerPrivacyPolicy.riderAccess) */}
            <PhoneText v={d.phone} link className="text-sm text-[var(--primary)] font-bold" fb={`rider-phone-number:${d.number}`} />
            <div className={cn('rounded-xl px-3 py-2.5 text-center border', sign(due) > 0 ? 'border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)]' : 'border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)]')}>
              <div className="text-xs text-soft font-bold flex items-center justify-center gap-1">{card ? <CreditCard className="w-3.5 h-3.5" /> : <Banknote className="w-3.5 h-3.5" />}{sign(due) > 0 ? (card ? t('المطلوب بالبطاقة') : t('المطلوب تحصيله')) : t('مدفوع')}</div>
              {sign(due) > 0 && <Money v={due} className="text-2xl" fb={`rider-due:${d.number}`} />}
            </div>
            {d.state === 'ASSIGNED' ? (
              <Button size="lg" variant="primary" className="w-full h-14 text-base" disabled={busy} onClick={() => picked(d)} data-fb={`rider-picked:${d.number}`}><PackageCheck className="w-5 h-5" />{t('استلمت')}</Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button size="lg" variant="success" className="h-14 text-base" disabled={busy} onClick={() => setDeliver(d)} data-fb={`rider-delivered:${d.number}`}><CheckCircle2 className="w-5 h-5" />{t('سلّمت')}</Button>
                <Button size="lg" variant="danger" className="h-14 text-base" disabled={busy} onClick={() => setFail(d)} data-fb={`rider-failed:${d.number}`}><XCircle className="w-5 h-5" />{t('فشل التسليم')}</Button>
              </div>
            )}
          </div>
        );
      })}
      {done.length > 0 && (
        <div className="glass rounded-2xl p-3 space-y-1.5" data-fb="rider-phone:done">
          <div className="text-xs font-bold text-dim">{t('سلّمتها اليوم')}</div>
          {done.map((d) => <div key={d.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate"><span className="num">{d.number}</span> · {d.customerName}</span><span className="text-xs text-dim shrink-0">{d.cod && !d.cod.settled ? <Money v={d.cod.amount} className="text-xs" /> : t('مُسوّى')}</span></div>)}
        </div>
      )}
      {deliver && <DeliverPopup d={deliver} onClose={() => setDeliver(null)} />}
      {fail && <FailPopup d={fail} reasons={board.data?.reasons ?? {}} onClose={() => setFail(null)} />}
    </div>
  );
}

function DeliverPopup({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const due = d.order ? d.order.remaining : '0.0000';
  const card = d.paymentMode === 'CARD_ON_DELIVERY' && sign(due) > 0;
  const [ref, setRef] = useState('');
  const ok = async () => {
    const r = await run('Delivery.Complete', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, collectedMethod: sign(due) > 0 ? (card ? 'CARD' : 'CASH') : undefined, reference: card ? ref.trim() : undefined } }, { success: t('سُلِّم الطلب {n}', { n: d.number }), refId: d.id });
    if (r) onClose();
  };
  return (
    <Popup open onClose={onClose} size="sm" fb="rider-deliver-popup" title={<span>{t('تأكيد التسليم')} · <span className="num">{d.number}</span></span>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="success" size="lg" loading={busy} disabled={card && !ref.trim()} onClick={ok} data-fb="rider-deliver-confirm"><CheckCircle2 className="w-4 h-4" />{t('سلّمت')}</Button></>}>
      <div className="space-y-3 text-center">
        <div className="text-sm">{d.customerName}</div>
        {sign(due) > 0 ? <><div className="text-xs text-dim">{card ? t('المطلوب بالبطاقة') : t('استلمت من العميل')}</div><Money v={due} big tone="primary" /></> : <div className="text-sm text-[var(--success)] font-bold">{t('مدفوع')}</div>}
        {card && <Field label={t('رقم العملية من ماكينة البطاقة')}><Input value={ref} onChange={(e) => setRef(e.target.value)} className="num" dir="ltr" data-fb="rider-card-ref" /></Field>}
      </div>
    </Popup>
  );
}

function FailPopup({ d, reasons, onClose }: { d: any; reasons: Record<string, { ar: string; en: string }>; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [code, setCode] = useState('NO_ANSWER');
  const [note, setNote] = useState('');
  const ok = async () => {
    const r = await run('Delivery.FailAttempt', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, reasonCode: code, reason: note.trim() || undefined } }, { success: t('سُجلت محاولة فاشلة — ارجع بالطلب إلى المطعم'), refId: d.id });
    if (r) onClose();
  };
  return (
    <Popup open onClose={onClose} size="sm" fb="rider-fail-popup" title={<span>{t('فشل التسليم')} · <span className="num">{d.number}</span></span>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" size="lg" loading={busy} disabled={code === 'OTHER' && !note.trim()} onClick={ok} data-fb="rider-fail-confirm"><XCircle className="w-4 h-4" />{t('تسجيل')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5">{Object.entries(reasons).map(([k, v]) => <button key={k} type="button" onClick={() => setCode(k)} data-fb={`rider-fail-reason:${k}`} className={cn('h-12 rounded-xl border text-sm px-2', code === k ? 'border-[var(--error)] bg-red-500/10 text-[var(--error)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{L(v)}</button>)}</div>
        <Field label={t('التفاصيل')} required={code === 'OTHER'}><Input value={note} onChange={(e) => setNote(e.target.value)} data-fb="rider-fail-note" /></Field>
      </div>
    </Popup>
  );
}
