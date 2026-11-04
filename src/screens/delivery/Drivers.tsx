// ux-11 «الطيارون»: the riders list beside the rider file (MasterDetail; the selected rider and tab live in the route
// params). The file has five tabs — today (orders and cash), shifts (hours), trips (delivered / failed / average time),
// this rider's cash settlements, and the account (owed ledger, payouts, pay earned) — and one action bar: shift start /
// end, cash hand-over (the shared «استلام فلوس الطيار» popup), settling an old shortage, paying out, edit, deactivate.
// Deactivated riders are listed under «المتوقفون» with «إعادة تفعيل».
import React, { useRef, useState } from 'react';
import { Bike, UserPlus, Banknote, Pencil, Power, PowerOff, Wallet, Scale, RotateCcw, Phone, AlertTriangle, Clock3, Save, CheckCircle2 } from 'lucide-react';
import { useDev, useQuery, useCommand, useReasonMin } from '../../app/hooks';
import { Tech } from '../../app/tech';
import { Button, Card, DateTime, DetailPane, EmptyState, FILL_BODY, FILL_CARD, Field, FillPage, FilterChips, Input, MasterDetail, Money, Numpad, PageHeader, Pill, Popup, Select, Spinner, StatCard, StatGrid, StateBadge, Table, Tabs, Textarea, applyNumpadKey, useEnterSave, useNumpadKeys, type NumpadKey } from '../../ui';
import { t } from '../../i18n';
import { cn, money } from '../../lib/format';
import { sign, changePreview, plainAmount, minAmount } from '../../lib/cash';
import { DRIVER_STATUS, STATE, VEHICLE, VehicleIcon, RiderCashPopup } from './common';
import { personText } from '../../demo/people';

const OPS = ['Driver.List', 'Driver.Get', 'Driver.Upsert', 'Driver.SettleCash', 'Driver.SettleOwed', 'Driver.Payout', 'DriverShift.Start', 'DriverShift.End'];
type Filter = 'active' | 'shift' | 'inactive';
type Tab = 'today' | 'shifts' | 'trips' | 'settlements' | 'account';

/** Minutes as hours and minutes («7 س 25 د»). */
export const hoursText = (min: number | null | undefined) => {
  const m = Math.max(0, Math.round(min ?? 0));
  return t('{h} س {m} د', { h: Math.floor(m / 60), m: m % 60 });
};

export default function Drivers() {
  const { can, nav, params } = useDev();
  const filter: Filter = params?.filter === 'inactive' ? 'inactive' : params?.filter === 'shift' ? 'shift' : 'active';
  const q = useQuery<any>('Driver.List', { query: filter === 'inactive' ? { status: 'INACTIVE' } : {} });
  const [edit, setEdit] = useState<any>(null);
  const open: string | null = params?.open ?? null;
  const go = (p: Record<string, any>) => nav('drivers', { ...params, ...p });
  const all: any[] = q.data?.items ?? [];
  const list = filter === 'shift' ? all.filter((d) => d.onShift) : all;
  const s = q.data?.summary;
  const master = (compact: boolean) => (
    <FillPage>
      <PageHeader className="!mb-0" icon={<Bike />} title={t('الطيارين')} badge={<StateBadge ops={OPS} />}
        actions={can('delivery:configure') && <Button variant="primary" onClick={() => setEdit({})} data-fb="driver-new"><UserPlus className="w-4 h-4" />{t('طيار جديد')}</Button>} />
      {s && !compact && filter !== 'inactive' && (
        <StatGrid min={150}>
          <StatCard label={t('في الوردية')} value={String(s.onShift)} fb="riders-kpi:shift" />
          <StatCard label={t('متاحون الآن')} value={String(s.available)} tone="success" />
          <StatCard label={t('نقد مع الطيارين')} value={<Money v={s.cashInHand} />} tone={sign(s.cashInHand) > 0 ? 'warning' : 'neutral'} />
          <StatCard label={t('عجز على الطيارين')} value={<Money v={s.owed} />} tone={sign(s.owed) > 0 ? 'error' : 'neutral'} />
        </StatGrid>
      )}
      <Card padding="sm" className={FILL_CARD} bodyClassName={FILL_BODY}>
        <FilterChips value={filter} onChange={(f) => go({ filter: f === 'active' ? undefined : f, open: undefined })} className="mb-3"
          options={[{ id: 'active', label: t('الكل'), fb: 'riders-filter:active' }, { id: 'shift', label: t('في الوردية'), fb: 'riders-filter:shift' }, { id: 'inactive', label: t('المتوقفون'), count: q.data?.inactiveCount ?? undefined, fb: 'riders-filter:inactive' }]} />
        {q.loading && !q.data ? <Spinner /> : !list.length ? (
          <EmptyState compact icon={<Bike />} title={filter === 'inactive' ? t('لا يوجد طيارون متوقفون') : t('لا يوجد طيارون')} />
        ) : (
          <Table fill dense={compact} onRowClick={(i) => go({ open: list[i].id })} rowClassName={(i) => (list[i].id === open ? 'row-selected' : undefined)}
            head={compact ? [t('الطيار'), t('الحالة'), t('نقد معه')] : filter === 'inactive' ? [t('الطيار'), t('أوقف في'), t('السبب'), t('العجز')] : [t('الطيار'), t('الحالة'), t('معه الآن'), t('سُلِّم اليوم'), t('نقد معه'), t('العجز')]}
            align={compact ? ['start', 'start', 'end'] : filter === 'inactive' ? ['start', 'start', 'start', 'end'] : ['start', 'start', 'center', 'center', 'end', 'end']}
            rows={list.map((d) => {
              const who = (
                <div data-fb={`rider-row:${d.id}`} className="flex items-center gap-2.5 min-w-[150px]">
                  <span className="w-8 h-8 rounded-lg surface-3 flex items-center justify-center shrink-0"><VehicleIcon v={d.vehicle} className="w-4 h-4 text-[var(--primary)]" /></span>
                  <span className="min-w-0"><span className="font-bold block truncate">{d.name}</span><span className="text-[11px] text-dim num" dir="ltr">{d.phone}</span></span>
                </div>
              );
              const status = <Pill tone={DRIVER_STATUS[d.status]?.tone}>{t(DRIVER_STATUS[d.status]?.ar)}</Pill>;
              const cash = <Money v={d.cashInHand} tone={d.overCashLimit ? 'error' : sign(d.cashInHand) > 0 ? undefined : 'dim'} />;
              const owed = sign(d.owed) > 0 ? <Money v={d.owed} tone="error" /> : <span className="text-dim">—</span>;
              if (compact) return [who, status, cash];
              if (filter === 'inactive') return [who, d.deactivatedAt ? <DateTime v={d.deactivatedAt} className="text-xs" /> : '—', <span className="text-xs">{d.deactivationReason ?? '—'}</span>, owed];
              return [who, status, <span className="num font-bold">{d.activeCount}</span>, <span className="num">{d.deliveredToday}</span>, cash, owed];
            })} />
        )}
      </Card>
    </FillPage>
  );
  return (
    <div data-screen="DL4" className="h-full">
      <MasterDetail fb="riders" open={!!open} list={master} detail={open && <RiderFile id={open} tab={(params?.tab as Tab) ?? 'today'} onTab={(tab) => go({ tab })} onClose={() => go({ open: undefined, tab: undefined })} onEdit={setEdit} />} />
      {edit && <RiderForm d={edit} onClose={() => setEdit(null)} onSaved={(id) => { setEdit(null); if (!edit.id) go({ open: id }); }} />}
    </div>
  );
}

function RiderFile({ id, tab, onTab, onClose, onEdit }: { id: string; tab: Tab; onTab: (t: Tab) => void; onClose: () => void; onEdit: (d: any) => void }) {
  const { can, terminal } = useDev();
  const q = useQuery<any>('Driver.Get', { params: { driverId: id } });
  const { run, busy } = useCommand();
  const [pop, setPop] = useState<null | 'cash' | 'owed' | 'payout' | 'deactivate'>(null);
  const d = q.data?.id === id ? q.data : null;
  const drawer = !!terminal?.drawer;
  const shift = () => run(d.onShift ? 'DriverShift.End' : 'DriverShift.Start', { params: { driverId: d.id }, body: { expectedVersion: d.version } }, { success: d.onShift ? t('انتهت وردية {n}', { n: d.name }) : t('بدأت وردية {n}', { n: d.name }) });
  const reactivate = () => run('Driver.Upsert', { params: { driverId: d.id }, body: { expectedVersion: d.version, active: true } }, { success: t('أُعيد تفعيل {n}', { n: d.name }) });
  const footer = d && (d.active ? (
    <div className="flex gap-2 w-full [&>button]:flex-1 [&>button]:min-w-0 [&>button]:px-2" data-fb="rider-actions">
      {can('delivery:shift') && <Button variant={d.onShift ? 'secondary' : 'primary'} loading={busy} onClick={shift} data-fb="rider-act:shift">{d.onShift ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}{d.onShift ? t('إنهاء الوردية') : t('بدء الوردية')}</Button>}
      {can('delivery:settlecash') && <Button variant={sign(d.cashInHand) > 0 ? 'warning' : 'secondary'} disabled={!(sign(d.cashInHand) > 0) || !drawer} onClick={() => setPop('cash')} data-fb="rider-act:cash" title={!drawer ? t('من جهاز عليه درج نقدية مفتوح') : undefined}><Banknote className="w-4 h-4" />{t('استلام النقدية')}</Button>}
      {can('delivery:settlecash') && <Button disabled={!(sign(d.owed) > 0)} onClick={() => setPop('owed')} data-fb="rider-act:owed"><Scale className="w-4 h-4" />{t('تسوية العجز')}</Button>}
      {can('delivery:payout') && <Button onClick={() => setPop('payout')} disabled={!drawer} data-fb="rider-act:payout" title={!drawer ? t('من جهاز عليه درج نقدية مفتوح') : undefined}><Wallet className="w-4 h-4" />{t('صرف المستحقات')}</Button>}
    </div>
  ) : can('delivery:configure') ? <Button variant="primary" loading={busy} onClick={reactivate} data-fb="rider-act:reactivate"><RotateCcw className="w-4 h-4" />{t('إعادة تفعيل')}</Button> : null);
  return (
    <DetailPane fb="rider-file" onClose={onClose} backLabel={t('الطيارين')} icon={d ? <VehicleIcon v={d.vehicle} /> : <Bike />}
      title={d ? d.name : t('الطيار')}
      badge={d && (d.active ? <Pill tone={DRIVER_STATUS[d.status]?.tone}>{t(DRIVER_STATUS[d.status]?.ar)}</Pill> : <Pill tone="neutral">{t('متوقف')}</Pill>)}
      meta={d && <><a href={`tel:${d.phone}`} className="num inline-flex items-center gap-1" dir="ltr"><Phone className="w-3 h-3" />{d.phone}</a><span>{t(VEHICLE[d.vehicle] ?? d.vehicle)}{d.plate ? ` · ${d.plate}` : ''}</span>{d.shift && <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{t('في الوردية منذ')} <DateTime v={d.shift.startedAt} time /></span>}</>}
      actions={d && d.active && can('delivery:configure') && <>
        <Button size="sm" variant="ghost" title={t('تعديل')} onClick={() => onEdit(d)} data-fb="rider-act:edit"><Pencil className="w-4 h-4" /></Button>
        <Button size="sm" variant="ghost" className="text-[var(--error)]" onClick={() => setPop('deactivate')} data-fb="rider-act:deactivate">{t('إيقاف')}</Button>
      </>}
      footer={footer}>
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          {!d.active && <div className="rounded-xl border border-[var(--glass-border)] surface-1 px-3 py-2 text-sm" data-fb="rider-inactive">{t('متوقف منذ')} <DateTime v={d.deactivatedAt} /> · {d.deactivationReason}</div>}
          <Tabs value={tab} onChange={onTab} tabs={[
            { id: 'today', label: t('اليوم'), fb: 'rider-tab:today' }, { id: 'shifts', label: t('الورديات'), fb: 'rider-tab:shifts' }, { id: 'trips', label: t('المشاوير'), fb: 'rider-tab:trips' },
            { id: 'settlements', label: t('التسويات'), fb: 'rider-tab:settlements' }, { id: 'account', label: t('الحساب'), fb: 'rider-tab:account' },
          ]} />
          {tab === 'today' && <TodayTab d={d} />}
          {tab === 'shifts' && <ShiftsTab d={d} />}
          {tab === 'trips' && <TripsTab d={d} />}
          {tab === 'settlements' && <Table empty={t('لا توجد تسويات لهذا الطيار')} head={[t('الوقت'), t('المطلوب'), t('المعدود'), t('الفرق'), t('الطلبات'), t('استلم')]} align={['start', 'end', 'end', 'end', 'center', 'start']}
            rows={d.settlements.map((x: any) => [<DateTime v={x.at} className="text-xs" />, <Money v={x.expected} />, <Money v={x.counted} />, <Money v={x.variance} tone={sign(x.variance) < 0 ? 'error' : sign(x.variance) > 0 ? 'success' : 'dim'} />, <span className="num">{x.deliveryIds.length}</span>, personText(x.byName)])} />}
          {tab === 'account' && <AccountTab d={d} />}
          <Tech><div className="text-[11px] num text-dim">{d.id} · v{d.version}{d.userId ? ` · ${d.userId}` : ''}</div></Tech>
        </div>
      )}
      {d && pop === 'cash' && <RiderCashPopup d={d} onClose={() => setPop(null)} />}
      {d && pop === 'owed' && <OwedPopup d={d} onClose={() => setPop(null)} />}
      {d && pop === 'payout' && <PayoutPopup d={d} onClose={() => setPop(null)} />}
      {d && pop === 'deactivate' && <DeactivatePopup d={d} onClose={() => setPop(null)} />}
    </DetailPane>
  );
}

function TodayTab({ d }: { d: any }) {
  return (
    <div className="space-y-3" data-fb="rider-today">
      <StatGrid min={200}>
        <StatCard label={t('معه الآن')} value={String(d.activeCount)} />
        <StatCard label={t('سُلِّم اليوم')} value={String(d.deliveredToday)} tone="success" />
        <StatCard label={t('نقد معه')} value={<Money v={d.cashInHand} />} tone={d.overCashLimit ? 'error' : sign(d.cashInHand) > 0 ? 'warning' : 'neutral'} hint={<span>{t('الحد')} <Money v={d.cashLimit} className="text-xs" /></span>} />
        <StatCard label={t('سيحمل بعد التحصيل')} value={<Money v={d.exposure} />} tone={sign(changePreview(d.exposure, d.cashLimit)) > 0 ? 'error' : 'neutral'} />
      </StatGrid>
      <Table empty={t('لا توجد طلبات اليوم')} head={[t('الطلب'), t('العميل'), t('المنطقة'), t('الحالة'), t('للتحصيل')]} align={['start', 'start', 'start', 'start', 'end']}
        rows={d.today.map((x: any) => [<span className="num font-bold">{x.number}</span>, x.customerName, x.zoneName, <span className="flex items-center gap-1 flex-wrap"><Pill tone={STATE[x.state]?.tone ?? 'neutral'}>{t(STATE[x.state]?.ar ?? x.state)}</Pill>{x.failedHere && x.state !== 'FAILED' && <Pill size="sm" tone="error">{t('محاولة فاشلة')}</Pill>}{x.cod && !x.cod.settled && <Pill size="sm" tone="warning">{t('النقد معه')}</Pill>}</span>, sign(x.toCollect) > 0 ? <Money v={x.toCollect} /> : x.cod && !x.cod.settled ? <Money v={x.cod.amount} tone="dim" /> : <span className="text-dim">—</span>])} />
    </div>
  );
}

function ShiftsTab({ d }: { d: any }) {
  return (
    <div className="space-y-3" data-fb="rider-shifts">
      <StatGrid min={150}>
        <StatCard label={t('عدد الورديات')} value={String(d.shiftTotals.count)} />
        <StatCard label={t('إجمالي الساعات')} value={<span data-fb="rider-shift-hours">{hoursText(d.shiftTotals.minutes)}</span>} />
      </StatGrid>
      <Table empty={t('لا توجد ورديات')} head={[t('البداية'), t('النهاية'), t('المدة'), t('المشاوير')]} align={['start', 'start', 'start', 'center']}
        rows={d.shifts.map((s: any) => [<DateTime v={s.startedAt} className="text-xs" />, s.endedAt ? <DateTime v={s.endedAt} className="text-xs" /> : <Pill size="sm" tone="success">{t('مفتوحة')}</Pill>, <span data-fb={`shift-minutes:${s.id}`}>{hoursText(s.minutes)}</span>, <span className="num">{s.trips}</span>])} />
    </div>
  );
}

function TripsTab({ d }: { d: any }) {
  const tr = d.trips;
  return (
    <div className="space-y-3" data-fb="rider-trips">
      <StatGrid min={200}>
        <StatCard label={t('مُسلَّمة')} value={String(tr.delivered)} tone="success" fb="rider-trips:delivered" />
        <StatCard label={t('محاولات فاشلة')} value={String(tr.failed)} tone={tr.failed ? 'error' : 'neutral'} fb="rider-trips:failed" />
        <StatCard label={t('متوسط مدة المشوار')} value={tr.avgMinutes === null ? '—' : String(tr.avgMinutes)} unit={tr.avgMinutes === null ? undefined : t('د')} />
        <StatCard label={t('متأخرة')} value={String(tr.late)} tone={tr.late ? 'warning' : 'neutral'} />
      </StatGrid>
      <Table empty={t('لا توجد مشاوير')} head={[t('الطلب'), t('المنطقة'), t('سُلِّم'), t('المدة'), t('الأجر')]} align={['start', 'start', 'start', 'center', 'start']}
        rows={tr.list.map((x: any) => [<span className="num font-bold">{x.number}</span>, x.zoneName, <DateTime v={x.deliveredAt} className="text-xs" />, <span className={cn(x.late && 'text-[var(--warning-text)] font-bold')}>{x.minutes === null ? '—' : t('{n} د', { n: x.minutes })}</span>, x.paid ? <Pill size="sm" tone="success">{t('مصروف')}</Pill> : <Pill size="sm" tone="neutral">{t('غير مصروف')}</Pill>])} />
    </div>
  );
}

const OWED_KIND: Record<string, { ar: string; tone: 'error' | 'success' | 'info' | 'neutral' }> = {
  SHORTAGE: { ar: 'عجز في تسليم النقدية', tone: 'error' }, COLLECT_CASH: { ar: 'تحصيل نقدي', tone: 'success' }, DEDUCT_PAYOUT: { ar: 'خصم من المستحقات', tone: 'info' }, WAIVE: { ar: 'إعفاء', tone: 'neutral' },
};
const PAY_MODE: Record<string, string> = { PER_TRIP: 'لكل مشوار مُسلَّم', FIXED_SHIFT: 'لكل وردية منتهية', PERCENT_OF_FEE: 'نسبة من رسوم التوصيل' };
const payRuleText = (r: any) => (r.mode === 'PERCENT_OF_FEE' ? `${t(PAY_MODE[r.mode])} · ${r.feePercent}%` : null);

function AccountTab({ d }: { d: any }) {
  const a = d.account;
  const pv = a.preview;
  return (
    <div className="space-y-4" data-fb="rider-account">
      <StatGrid min={200}>
        <StatCard label={t('العجز الحالي')} value={<Money v={a.owed} fb="rider-owed" />} tone={sign(a.owed) > 0 ? 'error' : 'neutral'} />
        <StatCard label={t('مستحقات غير مصروفة')} value={<Money v={pv.gross} />} tone="success" hint={<span>{pv.mode === 'FIXED_SHIFT' ? t('{n} وردية', { n: pv.shifts.length }) : t('{n} مشوار', { n: pv.trips.length })}</span>} />
        <StatCard label={t('محوَّل للخصم')} value={<Money v={pv.deductions} />} tone={sign(pv.deductions) > 0 ? 'info' : 'neutral'} />
        <StatCard label={t('الصافي للصرف')} value={<Money v={pv.net} />} tone="primary" />
      </StatGrid>
      <div className="text-xs text-dim flex items-center gap-1.5 flex-wrap" data-fb="rider-pay-rule">
        <span>{t('أجر الطيار')}:</span>
        <b className="text-soft">{payRuleText(a.payRules) ?? <>{t(PAY_MODE[a.payRules.mode])} · <Money v={a.payRules.mode === 'FIXED_SHIFT' ? a.payRules.shiftAmount : a.payRules.perTripAmount} className="text-xs" /></>}</b>
      </div>
      <div>
        <div className="font-bold text-sm mb-2">{t('حركة العجز')}</div>
        <Table empty={t('لا يوجد عجز مسجل')} head={[t('الوقت'), t('الحركة'), t('المبلغ'), t('العجز بعدها'), t('السبب'), t('بموافقة')]} align={['start', 'start', 'end', 'end', 'start', 'start']}
          rows={a.ledger.map((e: any) => [<DateTime v={e.at} className="text-xs" />, <Pill size="sm" tone={OWED_KIND[e.kind]?.tone}>{t(OWED_KIND[e.kind]?.ar ?? e.kind)}</Pill>, <Money v={e.amount} />, <Money v={e.owedAfter} />, <span className="text-xs">{e.reason ?? '—'}</span>, <span className="text-xs">{e.approverName ? personText(e.approverName) : '—'}</span>])} />
      </div>
      <div>
        <div className="font-bold text-sm mb-2">{t('المستحقات المصروفة')}</div>
        <Table empty={t('لم تُصرف مستحقات بعد')} head={[t('الرقم'), t('الفترة حتى'), t('المشاوير'), t('الإجمالي'), t('الخصم'), t('الصافي')]} align={['start', 'start', 'center', 'end', 'end', 'end']}
          rows={a.payouts.map((p: any) => [<span className="num font-bold">{p.number}</span>, <DateTime v={p.periodTo} className="text-xs" />, <span className="num">{p.mode === 'FIXED_SHIFT' ? p.shiftIds.length : p.trips}</span>, <Money v={p.gross} />, <Money v={p.deductions} />, <Money v={p.net} />])} />
      </div>
    </div>
  );
}

/** An amount on the shared Numpad (keyboard too) with a «the whole amount» key. */
function AmountPad({ value, onChange, full, fullLabel, fb, onEnter }: { value: string; onChange: (v: string) => void; full?: string; fullLabel: string; fb: string; onEnter: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const key = (k: NumpadKey) => onChange(applyNumpadKey(value, k, { decimals: 2, maxDigits: 7 }));
  useNumpadKeys(true, key, { onEnter, scope: panel });
  return (
    <div ref={panel} className="space-y-2">
      <div className="rounded-2xl p-3 text-center border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]"><span className="num text-2xl font-extrabold" dir="ltr" data-fb={`${fb}-value`} data-value={value}>{value || '0'}</span></div>
      {full && sign(full) > 0 && <Button className="w-full" onClick={() => onChange(plainAmount(full))} data-fb={`${fb}-full`}>{fullLabel} · <Money v={full} /></Button>}
      <Numpad mode="amount" size="md" onKey={key} fb={`${fb}-numpad`} />
    </div>
  );
}

/** ux-11 owner decision 2: an old shortage — collect it in cash (into this drawer), move it to the next payout, or
 *  waive it. Every way needs a manager (DRIVER_OWED_SETTLE, the approval popup); moving and waiving need a reason. */
function OwedPopup({ d, onClose }: { d: any; onClose: () => void }) {
  const minReason = useReasonMin(); // ux-10b: ReasonTextPolicy
  const { run, busy } = useCommand();
  const { terminal } = useDev();
  const [mode, setMode] = useState<'COLLECT_CASH' | 'DEDUCT_PAYOUT' | 'WAIVE'>(terminal?.drawer ? 'COLLECT_CASH' : 'DEDUCT_PAYOUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const owed = d.account.owed;
  const available = changePreview(d.account.preview.gross, d.account.preview.deductions) ?? '0';
  const max = mode === 'DEDUCT_PAYOUT' ? minAmount(owed, available) : owed;
  const over = amount !== '' && sign(changePreview(amount, max)) > 0;
  const needReason = mode !== 'COLLECT_CASH';
  const ok = amount !== '' && sign(amount) > 0 && !over && (!needReason || reason.trim().length >= minReason) && !(mode === 'COLLECT_CASH' && !terminal?.drawer);
  const save = async () => {
    if (!ok || busy) return;
    const r = await run('Driver.SettleOwed', { params: { driverId: d.id }, body: { mode, amount, reason: reason.trim() || undefined, expectedVersion: d.version } }, { success: mode === 'COLLECT_CASH' ? t('دخل المبلغ الدرج ونقص العجز') : mode === 'DEDUCT_PAYOUT' ? t('حُوّل المبلغ للخصم من المستحقات') : t('أُعفي الطيار من المبلغ') });
    if (r) onClose();
  };
  const MODES = [{ id: 'COLLECT_CASH', label: t('تحصيل نقدي') }, { id: 'DEDUCT_PAYOUT', label: t('خصم من المستحقات') }, { id: 'WAIVE', label: t('إعفاء') }] as const;
  return (
    <Popup open onClose={onClose} size="lg" fb="owed-popup" title={<span className="flex items-center gap-2"><Scale className="w-5 h-5 text-[var(--primary)]" />{t('تسوية العجز')} · {d.name}</span>}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={save} data-fb="owed-confirm"><CheckCircle2 className="w-4 h-4" />{t('تسجيل')}</Button></>}>
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-4">
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl p-3 text-center border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]"><div className="text-xs text-soft font-bold">{t('العجز الحالي')}</div><Money v={owed} className="text-2xl" fb="owed-current" /></div>
            <div className="rounded-2xl p-3 text-center border border-[var(--glass-border)] surface-1"><div className="text-xs text-soft font-bold">{t('مستحقات متاحة للخصم')}</div><Money v={available} className="text-2xl" /></div>
          </div>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
            {MODES.map((m) => <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} disabled={m.id === 'COLLECT_CASH' && !terminal?.drawer} onClick={() => setMode(m.id)} data-fb={`owed-mode:${m.id}`} className={cn('h-12 rounded-xl border text-sm font-bold px-2 disabled:opacity-40', mode === m.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{m.label}</button>)}
          </div>
          {over && <div className="text-sm font-bold text-[var(--error)] flex items-center gap-1.5" data-fb="owed-over"><AlertTriangle className="w-4 h-4" />{t('المبلغ أكبر من المسموح ({m})', { m: money(max) })}</div>}
          <Field label={t('السبب')} required={needReason}><Input value={reason} onChange={(e) => setReason(e.target.value)} data-fb="owed-reason" maxLength={200} /></Field>
        </div>
        <AmountPad value={amount} onChange={setAmount} full={max} fullLabel={t('المبلغ كله')} fb="owed-amount" onEnter={save} />
      </div>
    </Popup>
  );
}

/** ux-11: pay the rider his unpaid pay up to now, less the shortage moved to the payout; PAY_OUT from this drawer. */
function PayoutPopup({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [note, setNote] = useState('');
  const [done, setDone] = useState<any>(null);
  const pv = d.account.preview;
  const nothing = !pv.trips.length && !pv.shifts.length && !pv.deductionIds.length;
  const save = async () => {
    if (busy || nothing) return;
    const r = await run<any>('Driver.Payout', { params: { driverId: d.id }, body: { periodTo: pv.periodTo, note: note.trim() || undefined, expectedVersion: d.version } }, { success: t('صُرفت مستحقات {n}', { n: d.name }) });
    if (r) setDone(r.payout);
  };
  const rule = d.account.payRules;
  return (
    <Popup open onClose={onClose} size="md" fb="payout-popup" title={<span className="flex items-center gap-2"><Wallet className="w-5 h-5 text-[var(--primary)]" />{t('صرف المستحقات')} · {d.name}</span>}
      footer={done ? <Button variant="primary" onClick={onClose} data-fb="payout-done">{t('تم')}</Button> : <><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="success" size="lg" loading={busy} disabled={nothing} onClick={save} data-fb="payout-confirm"><Wallet className="w-4 h-4" />{t('صرف من الدرج')}</Button></>}>
      {done ? (
        <div className="space-y-2 text-center py-2" data-fb="payout-result">
          <CheckCircle2 className="w-12 h-12 mx-auto text-[var(--success)]" />
          <div className="font-bold">{t('صُرف {a} — {n}', { a: money(done.net), n: done.number })}</div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs text-dim">{t('من')} <DateTime v={pv.periodFrom} /> {t('حتى')} <DateTime v={pv.periodTo} /></div>
          <div className="rounded-xl border line divide-y divide-[var(--line)]">
            <Row label={pv.mode === 'FIXED_SHIFT' ? t('{n} وردية × {r}', { n: pv.shifts.length, r: money(rule.shiftAmount) }) : pv.mode === 'PER_TRIP' ? t('{n} مشوار × {r}', { n: pv.trips.length, r: money(rule.perTripAmount) }) : t('{n} مشوار · {p}% من رسوم التوصيل', { n: pv.trips.length, p: rule.feePercent })} v={<Money v={pv.gross} fb="payout-gross" />} />
            <Row label={t('خصم العجز')} v={<Money v={sign(pv.deductions) > 0 ? `-${pv.deductions}` : pv.deductions} tone={sign(pv.deductions) > 0 ? 'error' : 'dim'} fb="payout-deductions" />} />
            <Row label={<b>{t('الصافي من الدرج')}</b>} v={<Money v={pv.net} big tone="primary" fb="payout-net" />} />
          </div>
          {nothing && <div className="text-sm text-dim">{t('لا توجد مستحقات لصرفها')}</div>}
          <Field label={t('ملاحظة')}><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} data-fb="payout-note" /></Field>
        </div>
      )}
    </Popup>
  );
}
const Row = ({ label, v }: { label: React.ReactNode; v: React.ReactNode }) => <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span>{label}</span>{v}</div>;

const STOP_REASONS = ['ترك العمل', 'إجازة طويلة', 'إيقاف مؤقت بقرار الإدارة'];
function DeactivatePopup({ d, onClose }: { d: any; onClose: () => void }) {
  const { run, busy } = useCommand();
  const minReason = useReasonMin(); // ux-10b: ReasonTextPolicy
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= minReason;
  const save = async () => { if (!ok || busy) return; const r = await run('Driver.Upsert', { params: { driverId: d.id }, body: { expectedVersion: d.version, active: false, reason: reason.trim() } }, { success: t('أُوقف {n}', { n: d.name }) }); if (r) onClose(); };
  const onKey = useEnterSave(save, ok && !busy);
  return (
    <Popup open onClose={onClose} size="sm" fb="deactivate-popup" title={t('إيقاف {n}', { n: d.name })}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="danger" loading={busy} disabled={!ok} onClick={save} data-fb="deactivate-confirm"><PowerOff className="w-4 h-4" />{t('إيقاف')}</Button></>}>
      <div className="space-y-3" onKeyDown={onKey}>
        <div className="flex flex-wrap gap-1.5">{STOP_REASONS.map((x) => <button key={x} type="button" onClick={() => setReason(t(x))} className={cn('px-2.5 h-8 rounded-lg text-xs border', reason === t(x) ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{t(x)}</button>)}</div>
        <Field label={t('السبب')} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} data-fb="deactivate-reason" /></Field>
      </div>
    </Popup>
  );
}

function RiderForm({ d, onClose, onSaved }: { d: any; onClose: () => void; onSaved: (id: string) => void }) {
  const { run, busy } = useCommand();
  const isNew = !d.id;
  const [f, setF] = useState({ name: d.name ?? '', phone: d.phone ?? '', vehicle: d.vehicle ?? 'MOTORCYCLE', plate: d.plate ?? '' });
  const ok = !!f.name.trim() && !!f.phone.trim();
  const save = async () => {
    if (!ok || busy) return;
    const r = await run<any>('Driver.Upsert', { params: { driverId: d.id ?? 'new' }, body: { ...f, expectedVersion: d.version } }, { success: isNew ? t('أُضيف الطيار') : t('حُفظت بيانات الطيار') });
    if (r) onSaved(r.id);
  };
  const onKey = useEnterSave(save, ok && !busy);
  return (
    <Popup open onClose={onClose} size="md" fb="rider-form" title={isNew ? t('طيار جديد') : t('تعديل بيانات الطيار')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={save} data-fb="driver-save"><Save className="w-4 h-4" />{t('حفظ')}</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3" onKeyDown={onKey}>
        <Field label={t('الاسم')} required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-autofocus data-fb="rider-form:name" /></Field>
        <Field label={t('الموبايل')} required><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} dir="ltr" inputMode="tel" className="num" data-fb="rider-form:phone" /></Field>
        <Field label={t('المركبة')}><Select value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })} options={Object.entries(VEHICLE).map(([value, label]) => ({ value, label: t(label) }))} /></Field>
        <Field label={t('رقم اللوحة')}><Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Field>
      </div>
    </Popup>
  );
}
