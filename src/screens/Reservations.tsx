// Direction D14 reservations (with deposit and no-show fee) and D10 deposits (a liability, not sales, until applied).
import React, { useState } from 'react';
import { CalendarPlus, UserCheck, UserX, PiggyBank, CalendarClock, Phone, Users } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { PageHeader, Button, Field, Input, Select, Money, Table, Pill, Banner, Tabs, Drawer, FilterChips, Toolbar, EmptyState, confirmDialog } from '../ui';
import { Tech } from '../app/tech';
import { t } from '../i18n';
import { dateTime, time, money } from '../lib/format';
import { clock } from '../mock/clock';
import { METHOD_AR } from './ops/BusinessDay';

const RES: Record<string, [string, 'primary' | 'success' | 'error' | 'neutral']> = { BOOKED: ['محجوز', 'primary'], SEATED: ['قعد', 'success'], NO_SHOW: ['ما جاش', 'error'], CANCELLED: ['اتلغى', 'neutral'] };
const DEP: Record<string, [string, 'warning' | 'success' | 'neutral' | 'error']> = { HELD: ['محجوز في الدرج', 'warning'], APPLIED: ['اتخصم من شيك', 'success'], FORFEITED: ['اتصادر (ما جاش)', 'error'], REFUNDED: ['اترجع', 'neutral'] };
const methodText = (m: string) => t(METHOD_AR[m] ?? 'طريقة تانية');

export default function Reservations() {
  const { nav, terminal } = useDev();
  const res = useQuery<any>('Reservation.Find', { query: {} });
  const deps = useQuery<any>('Deposit.Find', { query: {} });
  const { run } = useCommand();
  const [tab, setTab] = useState<'res' | 'dep'>('res');
  const [f, setF] = useState<'BOOKED' | 'ALL'>('BOOKED');
  const [creating, setCreating] = useState(false);
  const all: any[] = (res.data?.items ?? []).slice().sort((a: any, b: any) => a.at.localeCompare(b.at));
  const list = f === 'ALL' ? all : all.filter((r) => r.state === 'BOOKED');
  const seat = async (r: any) => {
    if (!r.tableId) return nav('floor');
    const v = await run('TableVisit.Open', { params: { tableId: r.tableId }, body: { guestCount: r.partySize, reservationId: r.id } }, { success: t('{n} قعد على ترابيزة {tb}', { n: r.customer, tb: r.tableName }) });
    if (v) nav('floor');
  };
  const noShow = async (r: any) => {
    if (!(await confirmDialog(t('تسجّل إن {n} ما جاش؟', { n: r.customer }), { danger: true, confirmLabel: t('أيوه، ما جاش'), detail: r.deposit ? t('العربون ({a}) هيتصادر وغرامة عدم الحضور هتتسجل.', { a: money(r.deposit.amount) }) : undefined }))) return;
    run('Reservation.MarkNoShow', { params: { reservationId: r.id }, body: {} }, { success: t('اتسجل عدم حضور') });
  };
  return (
    <div data-screen="D14" className="space-y-4">
      <PageHeader title={t('الحجوزات والعربون')} state="PROPOSED" description={t('سجّل حجز بعربون، وقعّد الضيوف لما ييجوا. العربون مش مبيعات لحد ما يتخصم من الشيك.')}
        actions={<Button variant="primary" onClick={() => setCreating(true)} data-fb="reservation-new"><CalendarPlus className="w-4 h-4" />{t('حجز جديد')}</Button>} className="!mb-0" />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'res', label: t('الحجوزات'), count: all.filter((r) => r.state === 'BOOKED').length || undefined }, { id: 'dep', label: t('العربون'), count: (deps.data?.items ?? []).filter((d: any) => d.state === 'HELD').length || undefined }]} />
      {tab === 'res' && (
        <>
          <Toolbar className="!mb-0"><FilterChips value={f} onChange={setF} options={[{ id: 'BOOKED', label: t('الجايين') }, { id: 'ALL', label: t('الكل') }]} /></Toolbar>
          <Table loading={res.loading} align={['start', 'start', 'center', 'start', 'end', 'start', 'end']} head={[t('الميعاد'), t('الضيف'), t('الأفراد'), t('الترابيزة'), t('العربون'), t('الحالة'), '']} rows={list.map((r: any) => [
            <span className="font-bold"><span className="num">{time(r.at)}</span><span className="block text-[11px] text-dim font-normal num">{dateTime(r.at)}</span></span>,
            <span><b>{r.customer}</b><span className="block text-xs text-dim num" dir="ltr" style={{ textAlign: 'start' }}>{r.phone}</span></span>,
            <span className="num font-bold">{r.partySize}</span>,
            r.tableName ? `${t('ترابيزة')} ${r.tableName}` : <span className="text-dim">{t('لسه')}</span>,
            r.deposit ? <Money v={r.deposit.amount} /> : <span className="text-dim">—</span>,
            <Pill tone={RES[r.state]?.[1] ?? 'neutral'} dot>{t(RES[r.state]?.[0] ?? '—')}</Pill>,
            r.state === 'BOOKED' ? <div className="flex gap-1 justify-end"><Button size="sm" variant="success" onClick={() => seat(r)} data-fb={`reservation-seat:${r.customer}`}><UserCheck className="w-3.5 h-3.5" />{t('قعّد')}</Button><Button size="sm" variant="ghost" className="text-[var(--error)]" onClick={() => noShow(r)} title={t('ما جاش')} aria-label={t('ما جاش')}><UserX className="w-3.5 h-3.5" /></Button></div> : null,
          ])} empty={<EmptyState compact icon={<CalendarClock />} title={f === 'BOOKED' ? t('مفيش حجوزات جاية') : t('لسه مفيش حجوزات')} text={t('سجّل حجز جديد من الزرار فوق.')} action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}>{t('حجز جديد')}</Button>} />} />
        </>
      )}
      {tab === 'dep' && (
        <>
          <Banner tone="info">{t('العربون الكاش بيدخل الدرج، بس محاسبيًا هو فلوس للزبون عندنا. بيتحول مبيعات لما يتخصم من شيك (من شاشة التحصيل)، أو بيتصادر لو الزبون ما جاش.')}</Banner>
          <Table loading={deps.loading} align={['start', 'start', 'end', 'start', 'start', 'start']} head={[t('الزبون'), t('عشان'), t('المبلغ'), t('اتدفع'), t('الحالة'), t('إمتى')]} rows={(deps.data?.items ?? []).map((d: any) => [<b>{d.customer}</b>, d.purpose === 'BOOKING' ? t('حجز') : t('طلب مسبق'), <Money v={d.amount} />, methodText(d.method), <Pill tone={DEP[d.state]?.[1] ?? 'neutral'} dot>{t(DEP[d.state]?.[0] ?? '—')}<Tech><span className="num opacity-70">{d.state}</span></Tech></Pill>, <span className="num text-xs">{dateTime(d.createdAt)}</span>])}
            empty={<EmptyState compact icon={<PiggyBank />} title={t('مفيش عربون')} text={t('العربون بيتسجل مع الحجز.')} />} />
        </>
      )}
      {creating && <NewReservation drawer={!!terminal?.drawer} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewReservation({ drawer, onClose }: { drawer: boolean; onClose: () => void }) {
  const tables = useQuery<any>('Table.List', { query: {} });
  const { run, busy } = useCommand();
  const [f, setF] = useState({ customer: '', phone: '', partySize: '4', at: new Date(clock.now() + 2 * 3600_000).toISOString().slice(0, 16), tableId: '', noShowFee: '100', deposit: drawer ? '200' : '0', method: 'CASH', reference: '' });
  const create = async () => {
    let depositId: string | undefined;
    if (Number(f.deposit) > 0) {
      const d = await run<any>('Deposit.Create', { body: { customer: f.customer, phone: f.phone, amount: f.deposit, method: f.method, reference: f.reference || undefined, purpose: 'BOOKING' } });
      if (!d) return;
      depositId = d.id;
    }
    const r = await run('Reservation.Create', { body: { customer: f.customer, phone: f.phone, partySize: f.partySize, at: new Date(f.at).toISOString(), tableId: f.tableId || undefined, noShowFee: f.noShowFee, depositId } }, { success: t('الحجز اتسجل') });
    if (r) onClose();
  };
  return (
    <Drawer open onClose={onClose} title={t('حجز جديد')} badge={<Pill tone="violet" size="sm">{t('مقترح')}</Pill>} width="md" icon={<CalendarPlus />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!f.customer || !f.phone} onClick={create} data-fb="reservation-create">{t('احجز')}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('الاسم')} required><Input value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} /></Field>
          <Field label={<span className="flex items-center gap-1"><Phone className="w-3 h-3" />{t('الموبايل')}</span>} required><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="num" dir="ltr" inputMode="tel" /></Field>
        </div>
        <Field label={<span className="flex items-center gap-1"><Users className="w-3 h-3" />{t('عدد الأفراد')}</span>}>
          <div className="flex gap-1.5 flex-wrap">{['2', '3', '4', '5', '6', '8', '10'].map((n) => <button key={n} onClick={() => setF({ ...f, partySize: n })} className={f.partySize === n ? 'w-11 h-11 rounded-xl font-bold num bg-[var(--primary)] text-[var(--primary-foreground)]' : 'w-11 h-11 rounded-xl font-bold num surface-1 border border-[var(--glass-border)]'}>{n}</button>)}</div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('الميعاد')}><Input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          <Field label={t('الترابيزة')} hint={t('ممكن تختارها بعدين')}><Select value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })} options={[{ value: '', label: t('لسه') }, ...(tables.data?.items ?? []).map((x: any) => ({ value: x.id, label: `${t('ترابيزة')} ${x.name} · ${x.capacity} ${t('كراسي')}` }))]} /></Field>
        </div>
        <div className="rounded-2xl surface-1 border line p-3 space-y-3">
          <div className="text-sm font-bold flex items-center gap-1.5"><PiggyBank className="w-4 h-4 text-[var(--primary)]" />{t('العربون والغرامة')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('العربون (جنيه)')} hint={drawer ? undefined : t('العربون محتاج جهاز فيه درج مفتوح')}><Input value={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" /></Field>
            <Field label={t('غرامة عدم الحضور')}><Input value={f.noShowFee} onChange={(e) => setF({ ...f, noShowFee: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" /></Field>
          </div>
          {Number(f.deposit) > 0 && <Field label={t('العربون اتدفع إزاي')}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: methodText(m) }))} /></Field>}
          {Number(f.deposit) > 0 && f.method !== 'CASH' && <Field label={t('رقم العملية')}><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className="num" /></Field>}
        </div>
      </div>
    </Drawer>
  );
}
