// Shared delivery UI: plain labels, the simple zone map, the delivery card actions and the details dialog.
import React, { useState } from 'react';
import { Bike, Car, Clock, MapPin, Phone, ChefHat, CheckCircle2, XCircle, AlertTriangle, Send, UserCheck, Ban, Banknote, CreditCard, Globe, History, Store } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Modal, Button, Field, Input, Select, Textarea, Pill, Banner, KV, Money, StateBadge, Spinner, confirmDialog } from '../../ui';
import { Tech } from '../../app/tech';
import { t, L } from '../../i18n';
import { cn, money, time, dateTime, qty } from '../../lib/format';
import { clock } from '../../mock/clock';
import { addressText, AllergyWarning, TierBadge } from '../customers/common';

export const STATE: Record<string, { ar: string; tone: 'primary' | 'warning' | 'info' | 'success' | 'error' | 'neutral' | 'violet' }> = {
  PENDING: { ar: 'جديد', tone: 'primary' },
  ASSIGNED: { ar: 'مع الطيار', tone: 'info' },
  PICKED_UP: { ar: 'في الطريق', tone: 'violet' },
  DELIVERED: { ar: 'اتسلّم', tone: 'success' },
  FAILED: { ar: 'محاولة فشلت', tone: 'error' },
  CANCELLED: { ar: 'ملغي', tone: 'neutral' },
};
export const KITCHEN: Record<string, { ar: string; tone: 'neutral' | 'warning' | 'success' | 'info' | 'primary' }> = {
  NOT_SENT: { ar: 'لسه ما اتبعتش للمطبخ', tone: 'neutral' },
  WAITING: { ar: 'مستني المطبخ', tone: 'neutral' },
  COOKING: { ar: 'بيتعمل', tone: 'warning' },
  READY: { ar: 'جاهز للخروج', tone: 'success' },
  HANDED: { ar: 'اتسلّم للطيار', tone: 'info' },
};
export const PAYMENT_MODE: Record<string, { ar: string; icon: React.ComponentType<{ className?: string }> }> = {
  CASH_ON_DELIVERY: { ar: 'كاش عند الاستلام', icon: Banknote },
  PAID_ONLINE: { ar: 'مدفوع أونلاين', icon: Globe },
  CARD_ON_DELIVERY: { ar: 'كارت عند الاستلام', icon: CreditCard },
};
export const DRIVER_STATUS: Record<string, { ar: string; tone: 'neutral' | 'success' | 'info' | 'violet' }> = {
  OFF: { ar: 'خارج الوردية', tone: 'neutral' },
  AVAILABLE: { ar: 'متاح', tone: 'success' },
  ASSIGNED: { ar: 'معاه طلبات', tone: 'info' },
  ON_TRIP: { ar: 'في مشوار', tone: 'violet' },
};
export const VEHICLE: Record<string, string> = { MOTORCYCLE: 'موتوسيكل', CAR: 'عربية', BICYCLE: 'عجلة' };
export const VehicleIcon = ({ v, className }: { v: string; className?: string }) => (v === 'CAR' ? <Car className={className} /> : <Bike className={className} />);

export const StatePill = ({ s }: { s: string }) => <Pill tone={STATE[s]?.tone ?? 'neutral'}>{t(STATE[s]?.ar ?? s)}</Pill>;

/** Minutes left until the promised time, ticking with the mock clock. */
export function Eta({ d, className }: { d: any; className?: string }) {
  if (d.state === 'DELIVERED') return <span className={cn('text-xs', d.deliveredLate ? 'text-[var(--warning)]' : 'text-[var(--success)]', className)}>{t('اتسلّم')} {time(d.deliveredAt)}{d.deliveredLate ? ` · ${t('متأخر')}` : ''}</span>;
  if (d.state === 'CANCELLED') return <span className={cn('text-xs text-dim', className)}>{t('اتلغى')} {time(d.cancelledAt)}</span>;
  const left = Math.round((d.promisedAtMs - clock.now()) / 60000);
  const late = left < -(d.graceMinutes ?? 0) || d.late;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-bold num', late ? 'text-[var(--error)]' : left <= 5 ? 'text-[var(--warning)]' : 'text-soft', className)} title={`${t('الوصول المتوقع')} ${time(d.promisedAt)}`}>
      <Clock className="w-3.5 h-3.5" />{left >= 0 ? `${left} ${t('د')}` : `${t('متأخر')} ${-left} ${t('د')}`}
    </span>
  );
}

// ───────── map (zones as areas, no tiles)
export function MiniMap({ zones, drivers = [], deliveries = [], restaurant, height = 340, onZone, selectedZone }: { zones: any[]; drivers?: any[]; deliveries?: any[]; restaurant?: { x: number; y: number }; height?: number; onZone?: (z: any) => void; selectedZone?: string | null }) {
  const R = restaurant ?? { x: 63, y: 55 };
  const zoneCenter = (z: any) => ({ x: z.map.x + z.map.w / 2, y: z.map.y + z.map.h / 2 });
  return (
    <div className="rounded-xl border line overflow-hidden" style={{ background: 'radial-gradient(circle at 70% 60%, rgba(34,211,238,.06), transparent 60%), var(--surface-1, rgba(255,255,255,.03))' }}>
      <svg viewBox="0 0 100 70" style={{ width: '100%', height }} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t('خريطة مناطق التوصيل')}>
        <defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M 5 0 L 0 0 0 5" fill="none" stroke="rgba(148,163,184,.16)" strokeWidth="0.2" /></pattern></defs>
        <rect x="0" y="0" width="100" height="70" fill="url(#grid)" />
        {/* the Nile, for orientation */}
        <path d="M 40 0 C 36 14, 42 26, 38 38 S 30 56, 33 70" fill="none" stroke="rgba(56,189,248,.35)" strokeWidth="2.2" strokeLinecap="round" />
        <text x="35" y="66" fontSize="2.2" fill="rgba(56,189,248,.7)">{t('النيل')}</text>
        {zones.map((z) => (
          <g key={z.id} onClick={() => onZone?.(z)} style={{ cursor: onZone ? 'pointer' : 'default', opacity: z.active ? 1 : 0.35 }}>
            <rect x={z.map.x} y={z.map.y} width={z.map.w} height={z.map.h} rx="2" fill={`${z.color}22`} stroke={z.color} strokeWidth={selectedZone === z.id ? 0.8 : 0.35} strokeDasharray={z.active ? undefined : '1 1'} />
            <text x={z.map.x + z.map.w - 1.5} y={z.map.y + 3.6} fontSize="2.6" fontWeight="700" fill={z.color} direction="rtl" textAnchor="start">{L(z.name)}</text>
            <text x={z.map.x + z.map.w - 1.5} y={z.map.y + 6.6} fontSize="1.9" style={{ fill: 'var(--text-soft)' }} direction="rtl" textAnchor="start">{money(z.fee)} · {z.etaMinutes} {t('د')}</text>
          </g>
        ))}
        {deliveries.filter((d) => d.zoneId && d.state !== 'DELIVERED' && d.state !== 'CANCELLED').map((d, i) => {
          const z = zones.find((x) => x.id === d.zoneId);
          if (!z) return null;
          const c = zoneCenter(z);
          const px = c.x + ((i * 7) % 11) - 5, py = c.y + ((i * 5) % 7) - 2;
          return <g key={d.id}><circle cx={px} cy={py} r="1.4" fill={d.late ? '#ef4444' : '#f8fafc'} stroke={z.color} strokeWidth="0.5" /><text x={px + 1.8} y={py + 0.8} fontSize="1.8" style={{ fill: 'var(--foreground)' }} direction="ltr" textAnchor="start">{d.number}</text></g>;
        })}
        <g><circle cx={R.x} cy={R.y} r="2.4" fill="#22d3ee" stroke="#0f172a" strokeWidth="0.5" /><text x={R.x} y={R.y + 5} fontSize="2.2" fontWeight="700" fill="#22d3ee" textAnchor="middle">{t('المطعم')}</text></g>
        {drivers.filter((d) => d.location && d.onShift).map((d, i, all) => {
          // drivers standing at the same spot (e.g. waiting at the restaurant) fan out so each one stays readable
          const same = all.filter((o) => Math.abs(o.location.x - d.location.x) < 4 && Math.abs(o.location.y - d.location.y) < 4);
          const k = same.indexOf(d);
          const dx = same.length > 1 ? (k - (same.length - 1) / 2) * 7 : 0, dy = same.length > 1 ? -5 : 0;
          return (
            <g key={d.id} style={{ transition: 'transform 1s linear' }} transform={`translate(${d.location.x + dx} ${d.location.y + dy})`}>
              <circle r="1.9" fill={d.status === 'ON_TRIP' ? '#a855f7' : d.status === 'ASSIGNED' ? '#38bdf8' : '#22c55e'} stroke="#0f172a" strokeWidth="0.45" />
              <text x="0" y="-2.6" fontSize="1.8" fontWeight="700" style={{ fill: 'var(--foreground)' }} textAnchor="middle">{d.name.split(' ')[0]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ───────── action dialogs
export function AssignDialog({ d, onClose, dispatch }: { d: any; onClose: () => void; dispatch?: boolean }) {
  const drivers = useQuery<any>('Driver.List', { query: {} });
  const { run, busy } = useCommand();
  const list: any[] = (drivers.data?.items ?? []).filter((x: any) => x.onShift);
  const max = drivers.data?.rules?.maxActivePerDriver ?? 3;
  const pick = async (drv: any) => {
    const r = dispatch
      ? await run('Delivery.Dispatch', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, toState: 'PICKED_UP', driverId: drv.id } }, { success: t('الطلب خرج مع {n}', { n: drv.name }) })
      : await run('Delivery.Assign', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, driverId: drv.id } }, { success: t('الطلب اتسلّم لـ {n}', { n: drv.name }) });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={dispatch ? t('اختار الطيار وطلّع الطلب') : t('اختار الطيار')} badge={<StateBadge ops={[dispatch ? 'Delivery.Dispatch' : 'Delivery.Assign', 'Driver.List']} />}>
      <div className="text-sm text-dim mb-3">{d.number} · {d.customerName} · {d.zoneName}</div>
      {drivers.loading && <Spinner />}
      <div className="space-y-1.5">
        {list.map((drv) => {
          const full = drv.activeCount >= max;
          const sameZone = drv.active.some((a: any) => a.zoneId === d.zoneId);
          return (
            <button key={drv.id} disabled={busy || full || drv.id === d.driverId} onClick={() => pick(drv)} data-fb={`pick-driver:${drv.id}`} className="w-full flex items-center gap-3 rounded-xl surface-1 border border-[var(--glass-border)] px-3 py-2.5 text-start hover:border-[var(--primary)] disabled:opacity-40">
              <VehicleIcon v={drv.vehicle} className="w-5 h-5 text-[var(--primary)]" />
              <span className="flex-1 min-w-0"><span className="font-bold block">{drv.name}</span><span className="text-xs text-dim">{t(DRIVER_STATUS[drv.status]?.ar)} · {drv.activeCount}/{max} {t('طلبات')}{sameZone ? ` · ${t('رايح نفس المنطقة')}` : ''}</span></span>
              <span className="text-end text-xs"><span className="block text-dim">{t('معاه كاش')}</span><Money v={drv.cashInHand} tone={drv.overCashLimit ? 'error' : undefined} /></span>
            </button>
          );
        })}
        {!drivers.loading && !list.length && <Banner tone="warning">{t('مفيش طيارين في الوردية دلوقتي — شغّل طيار من شاشة الطيارين.')}</Banner>}
      </div>
    </Modal>
  );
}

export function CompleteDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const remaining = d.order?.remaining ?? '0.0000';
  const toCollect = Number(remaining) > 0;
  const [method, setMethod] = useState<'CASH' | 'CARD'>(d.paymentMode === 'CARD_ON_DELIVERY' ? 'CARD' : 'CASH');
  const [ref, setRef] = useState('');
  const ok = async () => {
    const r = await run('Delivery.Complete', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, collectedMethod: toCollect ? method : undefined, reference: method === 'CARD' ? ref : undefined } }, { success: t('الطلب اتسلّم للعميل') });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} title={t('تأكيد التسليم')} badge={<StateBadge ops={['Delivery.Complete']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="success" loading={busy} disabled={toCollect && method === 'CARD' && !ref.trim()} onClick={ok} data-fb="confirm-delivered"><CheckCircle2 className="w-4 h-4" />{t('اتسلّم')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm">{d.number} · {d.customerName} · {addressText(d.address)}</div>
        {toCollect ? (
          <>
            <div className="rounded-xl p-3 text-center surface-1 border line"><div className="text-xs text-dim">{t('المطلوب من العميل')}</div><Money v={remaining} big tone="primary" /></div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMethod('CASH')} className={cn('h-12 rounded-xl border flex items-center justify-center gap-2 text-sm', method === 'CASH' ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}><Banknote className="w-4 h-4" />{t('كاش مع الطيار')}</button>
              <button onClick={() => setMethod('CARD')} className={cn('h-12 rounded-xl border flex items-center justify-center gap-2 text-sm', method === 'CARD' ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'surface-1 border-[var(--glass-border)]')}><CreditCard className="w-4 h-4" />{t('كارت (مكنة الطيار)')}</button>
            </div>
            {method === 'CASH' ? <Banner tone="info">{t('الفلوس هتفضل مع الطيار لحد ما يسلّمها للكاشير من شاشة الطيارين — والطلب يتقفل ساعتها.')}</Banner>
              : <Field label={t('رقم العملية من مكنة الكارت')}><Input value={ref} onChange={(e) => setRef(e.target.value)} className="num" placeholder="POS-000123" /></Field>}
          </>
        ) : <Banner tone="success">{t('الطلب مدفوع بالكامل — مفيش فلوس تتحصّل. الطلب هيتقفل مع التسليم.')}</Banner>}
      </div>
    </Modal>
  );
}

export function FailDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const reasons = useQuery<any>('Delivery.Board', { query: { limit: 1 } });
  const { run, busy } = useCommand();
  const [code, setCode] = useState('NO_ANSWER');
  const [note, setNote] = useState('');
  const list = Object.entries(reasons.data?.reasons ?? { NO_ANSWER: { ar: 'العميل مش بيرد' } }) as [string, any][];
  const ok = async () => { const r = await run('Delivery.FailAttempt', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, reasonCode: code, reason: note || undefined } }, { success: t('اتسجلت محاولة فاشلة — اختار تعيد المحاولة ولا ترجّع الطلب') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={t('التوصيل ما تمّش')} badge={<StateBadge ops={['Delivery.FailAttempt']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={code === 'OTHER' && !note.trim()} onClick={ok} data-fb="confirm-fail"><XCircle className="w-4 h-4" />{t('سجّل المحاولة')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm text-dim">{d.number} · {d.customerName} · <span className="num" dir="ltr">{d.phone}</span></div>
        <div className="grid grid-cols-2 gap-1.5">{list.map(([k, v]) => <button key={k} onClick={() => setCode(k)} data-fb={`fail-reason:${k}`} className={cn('h-11 rounded-xl border text-sm px-2', code === k ? 'border-[var(--error)] bg-red-500/10 text-[var(--error)] font-bold' : 'surface-1 border-[var(--glass-border)]')}>{L(v)}</button>)}</div>
        <Field label={t('تفاصيل')} hint={code === 'OTHER' ? t('مطلوبة مع "سبب تاني"') : undefined}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلاً: رن 3 مرات ومفيش رد')} /></Field>
        <div className="text-[11px] text-dim">{t('بعد المحاولة الفاشلة الطيار بيرجع، وتقدر تسلّم الطلب لطيار تاني (إعادة المحاولة) أو تلغيه وترجّعه.')}</div>
      </div>
    </Modal>
  );
}

export function CancelDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [reason, setReason] = useState('');
  const quick = ['العميل لغى بالتليفون', 'العنوان برة مناطق التوصيل', 'العميل مش بيرد بعد كذا محاولة', 'الطلب رجع المطعم', 'طلب مكرر'];
  const fired = d.order && d.order.status !== 'DRAFT';
  const ok = async () => { const r = await run('Delivery.Cancel', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, reason } }, { success: t('التوصيل اتلغى') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={t('إلغاء طلب الدليفري')} badge={<StateBadge ops={['Delivery.Cancel', 'Approval.Grant']} />} footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={ok} data-fb="confirm-cancel-delivery"><Ban className="w-4 h-4" />{t('إلغاء التوصيل')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm">{d.number} · {d.customerName} · <Money v={d.amount} /></div>
        {fired && <Banner tone="warning">{t('الطلب اتبعت للمطبخ — الإلغاء محتاج موافقة مدير، والأكل اللي اتعمل بيتسجل هالك.')}{Number(d.order?.paid ?? 0) > 0 ? ` ${t('الطلب مدفوع — هتحتاج تعمل مرتجع بعد الإلغاء.')}` : ''}</Banner>}
        <div className="flex flex-wrap gap-1.5">{quick.map((q) => <button key={q} onClick={() => setReason(q)} className={cn('px-2.5 h-8 rounded-lg text-xs border', reason === q ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{t(q)}</button>)}</div>
        <Field label={t('السبب')}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Buttons for the next step of a delivery (used on board cards and in the details dialog). */
export function DeliveryActions({ d, size = 'sm', onOpen }: { d: any; size?: 'sm' | 'md'; onOpen?: () => void }) {
  const { can } = useDev();
  const { run, busy } = useCommand();
  const [dlg, setDlg] = useState<null | 'assign' | 'dispatch' | 'complete' | 'fail' | 'cancel'>(null);
  const kitchenReady = d.kitchen?.state === 'READY' || d.kitchen?.state === 'HANDED';
  const dispatch = async () => {
    if (!kitchenReady && !(await confirmDialog(t('المطبخ لسه ما خلّصش الطلب ده. تطلّعه برضه؟')))) return;
    await run('Delivery.Dispatch', { params: { deliveryId: d.id }, body: { expectedVersion: d.version, toState: 'PICKED_UP' } }, { success: t('الطلب خرج — في الطريق') });
  };
  const notSent = d.order?.status === 'DRAFT';
  return (
    <div className="flex gap-1.5 flex-wrap">
      {(d.state === 'PENDING' || d.state === 'FAILED') && can('delivery:assign') && <Button size={size} variant={d.state === 'FAILED' ? 'warning' : 'primary'} disabled={busy || notSent} onClick={() => setDlg('assign')} data-fb={`assign:${d.number}`}><UserCheck className="w-3.5 h-3.5" />{d.state === 'FAILED' ? t('إعادة المحاولة') : t('سلّم لطيار')}</Button>}
      {d.state === 'ASSIGNED' && can('delivery:dispatch') && <Button size={size} variant="primary" disabled={busy} onClick={dispatch} data-fb={`dispatch:${d.number}`}><Send className="w-3.5 h-3.5" />{t('خرج')}</Button>}
      {d.state === 'ASSIGNED' && can('delivery:assign') && <Button size={size} variant="ghost" disabled={busy} onClick={() => setDlg('assign')}>{t('غيّر الطيار')}</Button>}
      {d.state === 'PICKED_UP' && can('delivery:complete') && <Button size={size} variant="success" disabled={busy} onClick={() => setDlg('complete')} data-fb={`deliver:${d.number}`}><CheckCircle2 className="w-3.5 h-3.5" />{t('اتسلّم')}</Button>}
      {(d.state === 'ASSIGNED' || d.state === 'PICKED_UP') && can('delivery:failattempt') && <Button size={size} variant="ghost" disabled={busy} onClick={() => setDlg('fail')} data-fb={`fail:${d.number}`}><XCircle className="w-3.5 h-3.5" />{t('ما اتسلّمش')}</Button>}
      {['PENDING', 'ASSIGNED', 'PICKED_UP', 'FAILED'].includes(d.state) && can('delivery:cancel') && <Button size={size} variant="ghost" className="text-[var(--error)]" disabled={busy} onClick={() => setDlg('cancel')} data-fb={`cancel:${d.number}`}><Ban className="w-3.5 h-3.5" /></Button>}
      {onOpen && <Button size={size} variant="ghost" onClick={onOpen} title={t('التفاصيل')}><History className="w-3.5 h-3.5" /></Button>}
      {dlg === 'assign' && <AssignDialog d={d} onClose={() => setDlg(null)} />}
      {dlg === 'complete' && <CompleteDialog d={d} onClose={() => setDlg(null)} />}
      {dlg === 'fail' && <FailDialog d={d} onClose={() => setDlg(null)} />}
      {dlg === 'cancel' && <CancelDialog d={d} onClose={() => setDlg(null)} />}
    </div>
  );
}

export function DeliveryDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery<any>('Delivery.Get', { params: { deliveryId: id } });
  const { nav } = useDev();
  const d = q.data;
  return (
    <Modal open onClose={onClose} wide title={d ? `${t('توصيل')} ${d.number} · ${t('طلب')} #${d.orderNumber}` : t('التوصيل')} badge={<StateBadge ops={['Delivery.Get']} />}>
      {!d ? <Spinner /> : (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap"><StatePill s={d.state} />{d.kitchen && d.state === 'PENDING' && <Pill tone={KITCHEN[d.kitchen.state]?.tone}><ChefHat className="w-3 h-3" />{t(KITCHEN[d.kitchen.state]?.ar ?? d.kitchen.state)}</Pill>}<Eta d={d} />{d.sourceLabel && <Pill tone="info"><Globe className="w-3 h-3" />{d.sourceLabel}</Pill>}</div>
            <KV rows={[
              [t('العميل'), <span className="flex items-center gap-1.5 flex-wrap">{d.customerName}{d.customer?.loyalty?.tier && <TierBadge tier={d.customer.loyalty.tier} />}{d.customerId && <button className="text-xs text-[var(--primary)] font-bold" onClick={() => { onClose(); nav('customer', { customerId: d.customerId }); }}>{t('الملف')}</button>}</span>],
              [t('الموبايل'), <a href={`tel:${d.phone}`} className="num inline-flex items-center gap-1" dir="ltr"><Phone className="w-3 h-3" />{d.phone}</a>],
              [t('العنوان'), addressText(d.address)],
              [t('المنطقة'), `${d.zoneName} · ${t('رسوم')} ${money(d.fee)}`],
              [t('الدفع'), t(PAYMENT_MODE[d.paymentMode]?.ar ?? d.paymentMode)],
              [t('الطيار'), d.driver ? `${d.driver.name} · ${d.driver.phone}` : '—'],
              [t('الوصول المتوقع'), time(d.promisedAt)],
              ...(d.note ? [[t('ملاحظة'), d.note] as [string, string]] : []),
            ]} />
            {d.customer?.allergies?.length ? <AllergyWarning allergies={d.customer.allergies} /> : null}
            {d.order && (
              <div className="rounded-xl border line p-3 text-sm space-y-1">
                {(d.lines ?? []).map((l: any) => <div key={l.id} className="flex justify-between gap-2"><span>{qty(l.quantity)} × {L(l.name)}{l.modifiers?.length ? <span className="text-dim text-xs"> — {l.modifiers.map((m: any) => L(m)).join('، ')}</span> : null}{l.note ? <span className="text-[var(--warning-text)] text-xs"> ✎ {l.note}</span> : null}</span><span className="num">{money(l.lineTotal)}</span></div>)}
                {d.totals && <div className="border-t line pt-2 mt-2 space-y-0.5">
                  {d.totals.charges.map((c: any) => <div key={c.id} className="flex justify-between text-dim"><span>{L(c.label)}</span><span className="num">{money(c.amount)}</span></div>)}
                  <div className="flex justify-between font-bold"><span>{t('الإجمالي')}</span><Money v={d.order.payable} /></div>
                  <div className="flex justify-between text-xs text-dim"><span>{t('المدفوع / المتبقي')}</span><span className="num">{money(d.order.paid)} / {money(d.order.remaining)}</span></div>
                </div>}
              </div>
            )}
            {d.cod && <Banner tone={d.cod.settled ? 'success' : 'warning'}>{d.cod.settled ? t('فلوس الطلب اتسلّمت للكاشير') : t('الطيار معاه {a} كاش لسه ما سلّمهاش', { a: money(d.cod.amount) })}</Banner>}
            {d.cancel && <Banner tone="error">{t('اتلغى')}: {d.cancel.reason}{d.cancel.orderOutcome === 'REFUND_NEEDED' ? ` — ${t('الطلب مدفوع: اعمل مرتجع من شاشة المرتجعات')}` : ''}</Banner>}
            <DeliveryActions d={d} size="md" />
          </div>
          <div>
            <div className="font-bold text-sm mb-2 flex items-center gap-1.5"><History className="w-4 h-4" />{t('الخط الزمني')}</div>
            <ol className="relative border-s line ms-2 space-y-3">
              {d.timeline.map((h: any, i: number) => (
                <li key={i} className="ms-4">
                  <span className="absolute -start-1.5 w-3 h-3 rounded-full bg-[var(--primary)] border-2 border-[var(--card,#0f172a)]" />
                  <div className="text-[11px] text-dim num">{time(h.at)} · {h.byName ?? ''}</div>
                  <div className="text-sm">{L(h.text)}</div>
                  <Tech><div className="text-[10px] text-dim num">{h.kind}</div></Tech>
                </li>
              ))}
            </ol>
            {d.attempts?.length > 0 && <div className="mt-3 text-xs text-dim">{t('محاولات فاشلة')}: {d.attempts.length}</div>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export { MapPin, Store, AlertTriangle };
