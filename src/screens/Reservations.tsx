// Direction D14 reservations (with deposit and no-show fee) and D10 deposits (a liability, not sales, until applied).
import React, { useState } from 'react';
import { CalendarPlus, UserCheck, UserX, PiggyBank } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Card, Button, Field, Input, Select, Money, Table, Pill, Banner, Tabs } from '../ui';
import { t } from '../i18n';
import { dateTime } from '../lib/format';
import { clock } from '../mock/clock';

export default function Reservations() {
  const { nav, terminal } = useDev();
  const res = useQuery<any>('Reservation.Find', { query: {} });
  const deps = useQuery<any>('Deposit.Find', { query: {} });
  const tables = useQuery<any>('Table.List', { query: {} });
  const { run, busy } = useCommand();
  const [tab, setTab] = useState<'res' | 'dep'>('res');
  const [f, setF] = useState({ customer: '', phone: '', partySize: '4', at: new Date(clock.now() + 2 * 3600_000).toISOString().slice(0, 16), tableId: '', noShowFee: '100', deposit: '200', method: 'CASH', reference: '' });
  const create = async () => {
    let depositId: string | undefined;
    if (Number(f.deposit) > 0) {
      const d = await run<any>('Deposit.Create', { body: { customer: f.customer, phone: f.phone, amount: f.deposit, method: f.method, reference: f.reference || undefined, purpose: 'BOOKING' } });
      if (!d) return;
      depositId = d.id;
    }
    await run('Reservation.Create', { body: { customer: f.customer, phone: f.phone, partySize: f.partySize, at: new Date(f.at).toISOString(), tableId: f.tableId || undefined, noShowFee: f.noShowFee, depositId } }, { success: t('الحجز اتسجل') });
  };
  const seat = async (r: any) => {
    if (!r.tableId) return nav('floor');
    const v = await run('TableVisit.Open', { params: { tableId: r.tableId }, body: { guestCount: r.partySize, reservationId: r.id } }, { success: t('الحجز اتقعد') });
    if (v) nav('floor');
  };
  return (
    <div data-screen="D10/D14" className="space-y-4">
      <Section title={t('الحجوزات والعربون')} badge={<StateBadge state="PROPOSED" />} sub={t('اتجاه مقترح: Reservation.* موقوفة لقرار (PD_HELD)، والعربون عملية مقترحة. العربون التزام مش مبيعات لحد ما يتخصم من شيك.')} actions={<Tabs value={tab} onChange={setTab} tabs={[{ id: 'res', label: t('الحجوزات') }, { id: 'dep', label: t('العربون') }]} />} />
      {tab === 'res' && (
        <>
          <Card title={<span className="flex items-center gap-2"><CalendarPlus className="w-4 h-4" />{t('حجز جديد')}</span>}>
            <div className="grid sm:grid-cols-4 gap-2">
              <Field label={t('الاسم')}><Input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
              <Field label={t('الموبايل')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="num" /></Field>
              <Field label={t('عدد الأفراد')}><Input value={f.partySize} onChange={(e) => setF({ ...f, partySize: e.target.value })} inputMode="numeric" /></Field>
              <Field label={t('الميعاد')}><Input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
              <Field label={t('الترابيزة')}><Select value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })} options={[{ value: '', label: '—' }, ...(tables.data?.items ?? []).map((x: any) => ({ value: x.id, label: x.name }))]} /></Field>
              <Field label={t('غرامة عدم الحضور')}><Input value={f.noShowFee} onChange={(e) => setF({ ...f, noShowFee: e.target.value })} inputMode="decimal" /></Field>
              <Field label={t('العربون')} hint={terminal?.drawer ? '' : t('العربون محتاج جهاز فيه درج مفتوح')}><Input value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value })} inputMode="decimal" /></Field>
              <Field label={t('وسيلة العربون')}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: m }))} /></Field>
            </div>
            {f.method !== 'CASH' && <Field label={t('رقم العملية')} className="mt-2"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>}
            <Button variant="primary" className="mt-3" loading={busy} disabled={!f.customer || !f.phone} onClick={create}>{t('احجز')}</Button>
          </Card>
          <Card>
            <Table head={[t('الميعاد'), t('الاسم'), t('الأفراد'), t('الترابيزة'), t('العربون'), t('الغرامة'), t('الحالة'), '']} rows={(res.data?.items ?? []).map((r: any) => [
              <span className="num text-xs">{dateTime(r.at)}</span>, `${r.customer} · ${r.phone}`, r.partySize, r.tableName ?? '—', r.deposit ? <Money v={r.deposit.amount} /> : '—', <Money v={r.noShowFee} />,
              <Pill tone={r.state === 'BOOKED' ? 'primary' : r.state === 'SEATED' ? 'success' : 'error'}>{({ BOOKED: t('محجوز'), SEATED: t('قعد'), NO_SHOW: t('ما جاش'), CANCELLED: t('اتلغى') } as any)[r.state]}</Pill>,
              r.state === 'BOOKED' && <div className="flex gap-1"><Button size="sm" variant="success" onClick={() => seat(r)}><UserCheck className="w-3.5 h-3.5" />{t('قعّد')}</Button><Button size="sm" variant="danger" onClick={() => run('Reservation.MarkNoShow', { params: { reservationId: r.id }, body: {} }, { success: t('اتسجل عدم حضور — العربون اتصادر') })}><UserX className="w-3.5 h-3.5" /></Button></div>,
            ])} />
          </Card>
        </>
      )}
      {tab === 'dep' && (
        <Card title={<span className="flex items-center gap-2"><PiggyBank className="w-4 h-4" />{t('العربون')}</span>}>
          <Banner tone="info">{t('العربون بيدخل الدرج لو كاش، بس محاسبيًا التزام. بيتحول مبيعات لما يتخصم من شيك (من شاشة التحصيل)، أو يتصادر لو العميل ما جاش (سؤال للمحاسب: إيراد ولا لأ؟).')}</Banner>
          <Table className="mt-3" head={[t('العميل'), t('الغرض'), t('المبلغ'), t('الوسيلة'), t('الحالة'), t('اتعمل')]} rows={(deps.data?.items ?? []).map((d: any) => [d.customer, d.purpose, <Money v={d.amount} />, d.method, <Pill tone={d.state === 'HELD' ? 'warning' : d.state === 'APPLIED' ? 'success' : 'neutral'}>{d.state}</Pill>, <span className="num text-xs">{dateTime(d.createdAt)}</span>])} />
        </Card>
      )}
    </div>
  );
}
