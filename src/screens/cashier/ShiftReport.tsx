// ux-10: what the drawer popups (sale screen) and the shift history page share — the X / Z report body, the count
// difference in words, the cash entry kinds and the Egyptian denominations. Every amount is a server Decimal string
// rendered with <Money>; signs and absolute values come from lib/cash (Decimal), never from JS floats.
import React from 'react';
import { CheckCircle2, Scale } from 'lucide-react';
import { useQuery, errorText } from '../../app/hooks';
import { Money, KV, Pill, Popup, Banner, Skeleton, StateBadge, DateTime } from '../../ui';
import { t } from '../../i18n';
import { cn } from '../../lib/format';
import { sign, absAmount } from '../../lib/cash';
import { METHOD_AR } from '../ops/BusinessDay';
import { deviceName, personName, personText } from '../../demo/people';

/** Egyptian notes and coins, in piasters (100 = 1 جنيه); counts are whole numbers, totals integer piasters. */
export const DENOMS: { p: number; label: string; coin?: boolean }[] = [
  { p: 20000, label: '200' }, { p: 10000, label: '100' }, { p: 5000, label: '50' }, { p: 2000, label: '20' }, { p: 1000, label: '10' }, { p: 500, label: '5' },
  { p: 100, label: '1', coin: true }, { p: 50, label: '0.50', coin: true }, { p: 25, label: '0.25', coin: true },
];
export const fromPiasters = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

export const OUT_KINDS = new Set(['REFUND_OUT', 'PAY_OUT', 'SAFE_DROP', 'TIP_OUT', 'TENDER_CORRECTION_OUT']);
export const kindLabel = (k: string) => ({ OPENING_FLOAT: t('الرصيد الافتتاحي'), TENDER_IN: t('تحصيل كاش'), REFUND_OUT: t('مرتجع كاش'), PAY_IN: t('إدخال'), PAY_OUT: t('صرف'), SAFE_DROP: t('إيداع في الخزنة'), NO_SALE: t('فتح الدرج من غير بيع'), TIP_IN: t('بقشيش كاش'), TIP_OUT: t('توزيع بقشيش'), DEPOSIT_IN: t('عربون'), TENDER_CORRECTION_IN: t('تصحيح دفع (داخل)'), TENDER_CORRECTION_OUT: t('تصحيح دفع (خارج)') } as Record<string, string>)[k] ?? t('حركة تانية');

/** The count difference in words: «مطابق» / «عجز 30.00 ج.م» / «زيادة 5.00 ج.م» (sign and absolute value in Decimal). */
export function VarianceText({ v, className }: { v: string; className?: string }) {
  const n = sign(v);
  if (n === 0) return <span className={cn('text-[var(--success)] font-bold inline-flex items-center gap-1', className)} data-fb="variance" data-variance={v}><CheckCircle2 className="w-[1em] h-[1em]" />{t('مظبوط')}</span>;
  return <span className={cn('font-bold', n < 0 ? 'text-[var(--error)]' : 'text-[var(--warning-text)]', className)} data-fb="variance" data-variance={v}>{n < 0 ? t('عجز') : t('زيادة')} <Money v={absAmount(v)} /></span>;
}

/** X (live) or Z (frozen at close) report body. `expectedCash` is absent while the count is blind. */
export function ReportView({ r, z }: { r: any; z?: boolean }) {
  const sec = (title: string, rows: [React.ReactNode, React.ReactNode][]) => (
    <div className="rounded-xl surface-1 border line p-3"><div className="text-xs font-bold text-soft mb-1.5">{title}</div>{rows.length ? <div className="space-y-1">{rows.map(([k, v], i) => <div key={i} className="flex justify-between gap-2"><span>{k}</span>{v}</div>)}</div> : <div className="text-dim text-xs">{t('مفيش')}</div>}</div>
  );
  return (
    <div className="space-y-3 text-sm">
      <KV rows={[[t('الجهاز'), deviceName(r.terminalCode)], [t('الكاشير'), personName(null, personText(r.cashierName))], [t('اليوم'), <span className="num">{r.businessDate}</span>], [t('الرصيد الافتتاحي'), <Money v={r.openingFloat} />]]} />
      <div className="grid sm:grid-cols-2 gap-2">
        {sec(t('الفلوس حسب طريقة الدفع'), Object.entries(r.tenderBreakdown).map(([k, v]) => [t(METHOD_AR[k] ?? 'طريقة تانية'), <Money v={v as string} />]))}
        {sec(t('حركات الكاش'), Object.entries(r.cashByKind).map(([k, v]) => [kindLabel(k), <Money v={v as string} />]))}
        {Object.keys(r.refundBreakdown ?? {}).length > 0 && sec(t('المرتجعات'), Object.entries(r.refundBreakdown).map(([k, v]) => [t(METHOD_AR[k] ?? 'طريقة تانية'), <Money v={v as string} />]))}
        {r.tips && r.tips !== '0.0000' && sec(t('البقشيش (مش مبيعات)'), [[t('الإجمالي'), <Money v={r.tips} />]])}
      </div>
      <div className="rounded-xl border-2 border-[var(--glass-border)] p-3 space-y-1.5">
        <div className="flex justify-between"><span>{t('الكاش المفروض في الدرج')}</span>{r.expectedCash !== undefined ? <Money v={r.expectedCash} fb="report-expected" /> : <Pill tone="neutral">{t('مخفي لحد ما تعد (عد أعمى)')}</Pill>}</div>
        {z && <><div className="flex justify-between"><span>{t('اللي اتعد فعلًا')}</span><Money v={r.countedCash} /></div><div className="flex justify-between items-center border-t line pt-1.5"><span className="font-bold flex items-center gap-1"><Scale className="w-4 h-4" />{t('الفرق')}</span><VarianceText v={r.variance} /></div></>}
      </div>
      <div className="rounded-xl surface-1 border line p-3"><div className="text-xs font-bold text-soft mb-1.5">{t('شيكات لسه مفتوحة (مش بتمنع القفل)')}</div>{r.outstandingChecks.length === 0 ? <div className="text-dim text-xs">{t('مفيش')}</div> : r.outstandingChecks.map((o: any) => <div key={o.orderId} className="flex justify-between text-xs"><span><span className="num">#{o.number}</span> {o.table ? `· ${t('ترابيزة')} ${o.table}` : ''}</span><Money v={o.payable} /></div>)}</div>
      <div className="text-[11px] text-dim">{z ? t('تقرير Z') : t('تقرير X')} · <DateTime v={r.snapshotAt} /></div>
    </div>
  );
}

/** Z report of a closed shift (read only; session:zreport). */
export function ZPopup({ sid, onClose }: { sid: string; onClose: () => void }) {
  const z = useQuery<any>('Session.ZReport', { params: { sessionId: sid } });
  return <Popup open onClose={onClose} size="lg" fb="z-popup" title={t('تقرير قفلة الوردية (Z)')} badge={<StateBadge ops={['Session.ZReport']} />}>{z.data ? <ReportView r={z.data} z /> : z.error ? <Banner tone="error">{errorText(z.error)}</Banner> : <Skeleton lines={8} />}</Popup>;
}
