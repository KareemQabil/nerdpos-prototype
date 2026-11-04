// Drivers: roster with status, active orders and cash in hand from cash-on-delivery orders; shift on/off,
// add/edit, and the end-of-trip cash settlement into this terminal's drawer (shortage needs a manager).
import React, { useState } from 'react';
import { Bike, UserPlus, Banknote, Power, Pencil, Phone, AlertTriangle, CheckCircle2, History, Wallet } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../../app/hooks';
import { Section, StateBadge, Button, Card, Pill, Money, Modal, Field, Input, Select, Banner, Empty, Table, Switch, Spinner, DateTime } from '../../ui';
import { t } from '../../i18n';
import { cn, money, time, dateTime } from '../../lib/format';
import { sign } from '../../lib/cash';
import { DRIVER_STATUS, STATE, VEHICLE, VehicleIcon, RiderCashPopup } from './common';
import { personText } from '../../demo/people';

export default function Drivers() {
  const { can, terminal } = useDev();
  const q = useQuery<any>('Driver.List', { query: {} });
  const { run, busy } = useCommand();
  const [edit, setEdit] = useState<any>(null);
  const [settle, setSettle] = useState<any>(null);
  const list: any[] = q.data?.items ?? [];
  const s = q.data?.summary;
  const toggle = (d: any) => run('Driver.Upsert', { params: { driverId: d.id }, body: { expectedVersion: d.version, onShift: !d.onShift } }, { success: d.onShift ? t('{n} خرج من الوردية', { n: d.name }) : t('{n} دخل الوردية', { n: d.name }) });
  return (
    <div data-screen="DL4" className="space-y-4">
      <Section title={t('الطيارين')} badge={<StateBadge ops={['Driver.List', 'Driver.Upsert', 'Driver.SettleCash', 'Driver.UpdateLocation']} />}
        actions={can('delivery:configure') && <Button variant="primary" onClick={() => setEdit({})} data-fb="driver-new"><UserPlus className="w-4 h-4" />{t('طيار جديد')}</Button>} />
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Tile label={t('في الوردية')} v={String(s.onShift)} />
          <Tile label={t('متاحين دلوقتي')} v={String(s.available)} />
          <Tile label={t('في مشوار')} v={String(s.onTrip)} />
          <Tile label={t('كاش مع الطيارين')} v={<Money v={s.cashInHand} />} tone={sign(s.cashInHand) > 0 ? 'warning' : undefined} />
        </div>
      )}
      {q.loading && !list.length && <Spinner />}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((d) => (
          <Card key={d.id} className={cn(!d.onShift && 'opacity-75')}>
            <div className="space-y-3" data-fb={`driver:${d.id}`}>
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl surface-3 flex items-center justify-center"><VehicleIcon v={d.vehicle} className="w-6 h-6 text-[var(--primary)]" /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2 flex-wrap">{d.name}<Pill tone={DRIVER_STATUS[d.status]?.tone}>{t(DRIVER_STATUS[d.status]?.ar)}</Pill></div>
                  <div className="text-xs text-dim"><a href={`tel:${d.phone}`} className="num" dir="ltr">{d.phone}</a> · {t(VEHICLE[d.vehicle] ?? d.vehicle)}{d.plate ? ` · ${d.plate}` : ''}</div>
                </div>
                {can('delivery:configure') && <button title={t('تعديل')} onClick={() => setEdit(d)} className="text-dim hover:text-[var(--primary)]"><Pencil className="w-4 h-4" /></button>}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded-lg surface-1 py-1.5"><div className="text-[10px] text-dim">{t('معاه دلوقتي')}</div><div className="font-bold num">{d.activeCount}</div></div>
                <div className="rounded-lg surface-1 py-1.5"><div className="text-[10px] text-dim">{t('وصّل النهارده')}</div><div className="font-bold num">{d.deliveredToday}</div></div>
                <div className={cn('rounded-lg py-1.5', d.overCashLimit ? 'bg-red-500/15 border border-red-500/40' : 'surface-1')}><div className="text-[10px] text-dim">{t('معاه كاش')}</div><div className={cn('font-bold num text-sm', sign(d.cashInHand) > 0 && 'text-[var(--warning)]', d.overCashLimit && 'text-[var(--error)]')}>{money(d.cashInHand, false)}</div></div>
              </div>
              {d.overCashLimit && <Banner tone="error">{t('الطيار معاه كاش أكتر من الحد ({l}) — خليه يسلّم قبل المشوار الجاي.', { l: money(d.cashLimit) })}</Banner>}
              {sign(d.owed) > 0 && <div className="text-xs text-[var(--warning)] flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('عليه عجز قديم')} {money(d.owed)}</div>}
              {d.active.length > 0 && <div className="space-y-1">{d.active.map((a: any) => <div key={a.id} className="text-xs flex justify-between gap-2 rounded-lg surface-1 px-2 py-1"><span className="truncate">{a.number} · {a.customerName} · {a.zoneName}</span><span className={cn('font-bold shrink-0', a.late && 'text-[var(--error)]')}>{t(STATE[a.state]?.ar)}{a.late ? ` · ${t('متأخر')}` : ''}</span></div>)}</div>}
              {d.lastSettlement && <div className="text-[11px] text-dim">{t('آخر تسليم فلوس')}: {time(d.lastSettlement.at)} · {money(d.lastSettlement.counted)}</div>}
              <div className="flex gap-2">
                {can('delivery:settlecash') && <Button size="sm" variant={Number(d.cashInHand) > 0 ? 'warning' : 'secondary'} className="flex-1" disabled={!(Number(d.cashInHand) > 0)} onClick={() => setSettle(d)} data-fb={`settle:${d.id}`}><Banknote className="w-4 h-4" />{t('استلم الفلوس')}</Button>}
                {can('delivery:configure') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(d)} data-fb={`shift:${d.id}`}><Power className="w-4 h-4" />{d.onShift ? t('خروج من الوردية') : t('دخول الوردية')}</Button>}
              </div>
            </div>
          </Card>
        ))}
      </div>
      {!terminal?.drawer && <Banner tone="info">{t('استلام فلوس الطيار بيتعمل من جهاز الكاشير اللي فيه درج مفتوح (الفلوس بتدخل الدرج ده).')}</Banner>}
      <Card title={<span className="flex items-center gap-2"><History className="w-4 h-4" />{t('آخر تسليمات الفلوس')}</span>}>
        <Table head={[t('الوقت'), t('الطيار'), t('المفروض'), t('اتعد'), t('الفرق'), t('عدد الطلبات'), t('استلم')]} empty={t('لسه مفيش تسليمات النهارده')}
          rows={(q.data?.recentSettlements ?? []).map((x: any) => [<DateTime v={x.at} className="text-xs" />, x.driverName, <Money v={x.expected} />, <Money v={x.counted} />, <Money v={x.variance} tone={Number(x.variance) < 0 ? 'error' : Number(x.variance) > 0 ? 'success' : 'dim'} />, <span className="num">{x.deliveryIds.length}</span>, personText(x.byName)])} />
      </Card>
      {edit && <DriverDialog d={edit} onClose={() => setEdit(null)} />}
      {settle && <SettleDialog d={settle} onClose={() => setSettle(null)} />}
    </div>
  );
}

function Tile({ label, v, tone }: { label: string; v: React.ReactNode; tone?: 'warning' }) {
  return <div className="glass rounded-xl px-3 py-2"><div className="text-[11px] text-dim">{label}</div><div className={cn('text-xl font-bold', tone === 'warning' && 'text-[var(--warning)]')}>{typeof v === 'string' ? <span className="num">{v}</span> : v}</div></div>;
}

function DriverDialog({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const isNew = !d.id;
  const [f, setF] = useState({ name: d.name ?? '', phone: d.phone ?? '', vehicle: d.vehicle ?? 'MOTORCYCLE', plate: d.plate ?? '', onShift: d.onShift ?? true });
  const save = async () => {
    const r = await run('Driver.Upsert', { params: { driverId: d.id ?? 'new' }, body: { ...f, expectedVersion: d.version } }, { success: isNew ? t('الطيار اتضاف') : t('بيانات الطيار اتحفظت') });
    if (r) onClose();
  };
  const remove = async () => { const r = await run('Driver.Upsert', { params: { driverId: d.id }, body: { expectedVersion: d.version, active: false } }, { success: t('الطيار اتشال من القائمة') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={isNew ? t('طيار جديد') : t('تعديل بيانات الطيار')} badge={<StateBadge ops={['Driver.Upsert']} />}
      footer={<>{!isNew && <Button variant="ghost" className="me-auto text-[var(--error)]" onClick={remove}>{t('شيله من القائمة')}</Button>}<Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.phone.trim()} onClick={save} data-fb="driver-save">{t('حفظ')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label={t('الاسم')}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('الموبايل')}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" className="num" /></Field>
        <Field label={t('المركبة')}><Select value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} options={Object.entries(VEHICLE).map(([value, label]) => ({ value, label: t(label) }))} /></Field>
        <Field label={t('رقم اللوحة')}><Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Field>
        {isNew && <div className="sm:col-span-2"><Switch checked={f.onShift} onChange={(v) => setF({ ...f, onShift: v })} label={t('في الوردية دلوقتي')} /></div>}
      </div>
    </Modal>
  );
}

/** ux-05: the same «استلام فلوس الطيار» popup as the cashier's delivery mode (no drawer / Modal divergence). */
function SettleDialog({ d, onClose }: { d: any; onClose: () => void }) {
  return <RiderCashPopup d={d} onClose={onClose} />;
}
