// D2 Find and reopen checks: by number, table, status, business date. After a lost response or a restart,
// the check is re-read from the server (the same command never runs twice).
import React, { useState } from 'react';
import { Search, History, Wallet, Receipt, ClipboardList } from 'lucide-react';
import { useDev, useQuery } from '../app/hooks';
import { Section, StateBadge, Input, Select, Table, Money, Button, Field } from '../ui';
import { t } from '../i18n';
import { time } from '../lib/format';
import { StatusPill, HistoryDialog } from './order/CheckPanel';
import { clock, businessDate } from '../mock/clock';

export default function Checks() {
  const { nav, kind, can } = useDev();
  const [number, setNumber] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [bd, setBd] = useState('');
  const [hist, setHist] = useState<any>(null);
  const q = useQuery<any>('Order.Find', { query: { number: number || undefined, lifecycle: lifecycle || undefined, businessDate: bd || undefined, limit: 200 } });
  const rows = (q.data?.items ?? []).map((o: any) => [
    <span className="num font-bold">#{o.number}</span>,
    o.kind === 'STAFF_MEAL' ? t('وجبة موظف') : o.tableName ? `${t('ترابيزة')} ${o.tableName} · ${t('شيك')} ${o.checkNo}` : o.channel === 'TAKEAWAY' ? t('تيك أواي') : t('صالة كاونتر'),
    <StatusPill s={o.status} />,
    <span className="num text-xs">{o.businessDate}</span>,
    <span className="num text-xs">{time(o.createdAt)}</span>,
    o.serverName,
    <Money v={o.totals.payable} />,
    <div className="flex gap-1">
      {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && <Button size="sm" onClick={() => nav(o.visitId ? 'order' : kind === 'CASH' ? 'counter' : 'order', { orderId: o.id, back: 'checks' })}><ClipboardList className="w-3.5 h-3.5" />{t('افتح')}</Button>}
      {(o.status === 'DRAFT' || o.status === 'CONFIRMED') && can('payment:capture') && kind !== 'FLOOR' && <Button size="sm" variant="success" onClick={() => nav('pay', { orderId: o.id, back: 'checks' })}><Wallet className="w-3.5 h-3.5" /></Button>}
      {o.status !== 'DRAFT' && <Button size="sm" onClick={() => nav('receipt', { orderId: o.id })}><Receipt className="w-3.5 h-3.5" /></Button>}
      <Button size="sm" variant="ghost" onClick={() => setHist(o)}><History className="w-3.5 h-3.5" /></Button>
    </div>,
  ]);
  return (
    <div data-screen="D2">
      <Section title={t('الشيكات')} badge={<StateBadge ops={['Order.Find', 'Order.Get', 'Order.Timeline']} />} sub={t('دوّر على أي شيك وافتحه تاني — بعد رد ضايع أو بعد إعادة تشغيل الجهاز، نفس الأمر عمره ما بيتنفذ مرتين.')} />
      <div className="grid sm:grid-cols-4 gap-2 mb-3">
        <Field label={t('رقم الشيك')}><div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={number} onChange={(e) => setNumber(e.target.value)} className="ps-9" placeholder="0001" /></div></Field>
        <Field label={t('الحالة')}><Select value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} options={[{ value: '', label: t('الكل') }, { value: 'DRAFT', label: t('مفتوح') }, { value: 'CONFIRMED', label: t('متأكد — مستني الدفع') }, { value: 'COMPLETED', label: t('اتقفل') }, { value: 'CANCELLED,VOIDED', label: t('ملغي') }]} /></Field>
        <Field label={t('اليوم التجاري')}><Input type="date" value={bd} onChange={(e) => setBd(e.target.value)} /></Field>
        <div className="flex items-end"><Button variant="ghost" onClick={() => setBd(businessDate(clock.now()))}>{t('النهارده')}</Button></div>
      </div>
      <Table head={['#', t('المكان'), t('الحالة'), t('اليوم التجاري'), t('الوقت'), t('الويتر'), t('الإجمالي'), '']} rows={rows} empty={t('مفيش شيكات')} />
      {hist && <HistoryDialog order={hist} onClose={() => setHist(null)} />}
    </div>
  );
}
