// Direction D14 reservations (with deposit and no-show fee) and D10 deposits (a liability, not sales, until applied).
// ux-12: the day as a timeline (tables × hours; drag only onto a legal time / table, with menu and keyboard moves) or
// as a list; the reservation popup with its customer; edit, cancel (deposit outcome by ReservationPolicy), refund
// (out of the drawer with a manager's approval) and seat popups. Centered popups only — no side drawers.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, UserCheck, UserX, PiggyBank, CalendarClock, Users, Pencil, Ban, Undo2, Clock, Search, UserPlus, UserRound, List, GanttChart, AlertTriangle, CheckCircle2, Armchair, StickyNote, History, Minus, Plus, Phone, MoreHorizontal, ExternalLink, X } from 'lucide-react';
import { useDev, useQuery, useCommand, useReasonMin } from '../app/hooks';
import { PageHeader, Button, Field, Input, Select, Money, Table, Pill, Tabs, Popup, Popover, Kbd, FilterChips, SegmentedControl, EmptyState, DateTime, Numpad, Spinner, toast, useNow, applyNumpadKey, useNumpadKeys, type NumpadKey } from '../ui';
import { sign, plainAmount, changePreview } from '../lib/cash';
import { Tech } from '../app/tech';
import { t } from '../i18n';
import { cn, money, dateTime } from '../lib/format';
import { clock, cairoAt, zonedParts } from '../mock/clock';
import { METHOD_AR } from './ops/BusinessDay';
import { CustomerRow, QuickCreate, TierBadge } from './customers/common';
import { personName } from '../demo/people';

import { RES_STATE, DEP_STATE } from './reservationLabels';
const FORFEIT_CAUSE: Record<string, string> = { NO_SHOW: 'عدم الحضور', LATE_CANCEL: 'إلغاء متأخر', CANCEL_POLICY: 'سياسة الإلغاء' };
const EVENT: Record<string, string> = { CREATED: 'سُجل الحجز', UPDATED: 'عُدّل الحجز', SEATED: 'جلس الضيوف', CANCELLED: 'أُلغي الحجز', NO_SHOW: 'لم يحضر', DEPOSIT_FORFEITED: 'صودر العربون', DEPOSIT_REFUNDED: 'رُدّ العربون', DEPOSIT_APPLIED: 'خُصم العربون من الشيك' };
const FIELD: Record<string, string> = { at: 'الموعد', tableId: 'الترابيزة', partySize: 'عدد الأفراد', notes: 'ملاحظات', customerId: 'العميل', depositId: 'العربون' };
const CANCEL_REASONS = ['طلب الضيف', 'تغيّرت خطط الضيف', 'ظرف طارئ', 'حجز مكرر'];
const methodText = (m: string) => t(METHOD_AR[m] ?? 'طريقة أخرى');
const Q = 15 * 60_000;
const VIEW_KEY = 'nerdpos.reservations.view';

// ── Cairo wall time helpers (the server's business timezone; the device clock is never used)
const pad = (n: number) => String(n).padStart(2, '0');
export const cairoDate = (ms: number) => { const p = zonedParts(ms); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; };
const cairoHm = (ms: number) => { const p = zonedParts(ms); return `${pad(p.hour)}:${pad(p.minute)}`; };
/** The instant of Cairo wall time hh:mm on date (YYYY-MM-DD). */
export const cairoInstant = (date: string, hh: number, mm: number) => cairoAt(hh, mm, Date.parse(`${date}T10:00:00Z`));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

interface Rules { seatMinutes: number; bufferMinutes: number; cancelDepositMode: string; lateCancelHours: number; upcomingMinutes: number }
const DEFAULT_RULES: Rules = { seatMinutes: 90, bufferMinutes: 15, cancelDepositMode: 'FORFEIT_IF_LATE', lateCancelHours: 2, upcomingMinutes: 120 };
interface Check { ok: boolean; reason?: string }

/** The same rule the server applies (Reservation.Update): not in the past, an active table, no other booking of the
 *  table closer than the seat + buffer. Used to refuse a move before any request is sent. */
export function moveCheck(r: any, atMs: number, tableId: string | null, all: any[], tables: any[], rules: Rules, nowMs: number): Check {
  if (r.state !== 'BOOKED') return { ok: false, reason: t('الحجز ليس قائمًا') };
  if (atMs < nowMs) return { ok: false, reason: t('هذا الوقت مضى') };
  if (tableId) {
    const tb = tables.find((x) => x.id === tableId);
    if (!tb || !tb.active) return { ok: false, reason: t('الترابيزة متوقفة') };
    const win = (rules.seatMinutes + rules.bufferMinutes) * 60_000;
    const c = all.find((o) => o.id !== r.id && o.tableId === tableId && (o.state === 'BOOKED' || (o.state === 'SEATED' && o.visitOpen)) && Math.abs(Date.parse(o.at) - atMs) < win);
    if (c) return { ok: false, reason: t('محجوزة لـ{n} الساعة {h}', { n: c.customerName, h: cairoHm(Date.parse(c.at)) }) };
  }
  return { ok: true };
}

const readView = (): 'timeline' | 'list' => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'timeline'; } catch { return 'timeline'; } };

export default function Reservations() {
  const { can, terminal } = useDev();
  useNow(30_000);
  const res = useQuery<any>('Reservation.Find', { query: {} });
  const deps = useQuery<any>('Deposit.Find', { query: {} });
  const tablesQ = useQuery<any>('Table.List', { query: {} });
  const [tab, setTab] = useState<'res' | 'dep'>('res');
  const [view, setViewS] = useState<'timeline' | 'list'>(readView);
  const setView = (v: 'timeline' | 'list') => { setViewS(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } };
  const [day, setDay] = useState(() => cairoDate(clock.now()));
  const [f, setF] = useState<'DAY' | 'BOOKED' | 'CLOSED'>('DAY');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [act, setAct] = useState<{ kind: 'edit' | 'cancel' | 'refund' | 'seat'; id: string } | null>(null);
  const all: any[] = res.data?.items ?? [];
  const rules: Rules = res.data?.rules ?? DEFAULT_RULES;
  const tables: any[] = (tablesQ.data?.items ?? []).filter((x: any) => x.active).sort((a: any, b: any) => Number(a.name) - Number(b.name) || String(a.name).localeCompare(String(b.name)));
  tableNames = Object.fromEntries((tablesQ.data?.items ?? []).map((x: any) => [x.id, x.name]));
  const today = cairoDate(clock.now());
  const ofDay = all.filter((r) => cairoDate(Date.parse(r.at)) === day);
  const list = f === 'DAY' ? ofDay : f === 'BOOKED' ? all.filter((r) => r.state === 'BOOKED') : all.filter((r) => r.state === 'CANCELLED' || r.state === 'NO_SHOW');
  const opened = openId ? all.find((r) => r.id === openId) ?? null : null;
  const target = act ? all.find((r) => r.id === act.id) ?? null : null;
  const manage = can('reservation:manage');
  const { run } = useCommand();
  const move = async (r: any, atMs: number, tableId: string | null) => {
    const body: any = { expectedVersion: r.version };
    if (atMs !== Date.parse(r.at)) body.at = new Date(atMs).toISOString();
    if (tableId !== (r.tableId ?? null)) body.tableId = tableId;
    if (Object.keys(body).length === 1) return true;
    const out = await run('Reservation.Update', { params: { reservationId: r.id }, body }, { success: t('نُقل حجز {n} إلى {h}{tb}', { n: r.customerName, h: cairoHm(atMs), tb: tableId ? ` · ${t('ترابيزة')} ${tables.find((x) => x.id === tableId)?.name ?? ''}` : '' }) });
    return !!out;
  };
  const dayLabel = day === today ? t('اليوم') : day === addDays(today, 1) ? t('غدًا') : null;
  return (
    <div data-screen="D14" className="h-full flex flex-col gap-3 min-h-0">
      <PageHeader title={t('الحجوزات والعربون')} state="PROPOSED" ops={['Reservation.Find', 'Reservation.Create', 'Reservation.Update', 'Reservation.Cancel', 'Reservation.Seat', 'Deposit.Refund']} className="!mb-0"
        actions={manage && <Button variant="primary" onClick={() => setCreating(true)} data-fb="reservation-new"><CalendarPlus className="w-4 h-4" />{t('حجز جديد')}</Button>} />
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[{ id: 'res', label: t('الحجوزات'), count: all.filter((r) => r.state === 'BOOKED').length || undefined, fb: 'res-tab:res' }, { id: 'dep', label: t('العربون'), count: (deps.data?.items ?? []).filter((d: any) => d.state === 'HELD').length || undefined, fb: 'res-tab:dep' }]} />
      {tab === 'res' && (
        <>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <SegmentedControl size="sm" value={view} onChange={setView} options={[{ id: 'timeline', label: t('الخط الزمني'), icon: <GanttChart />, fb: 'res-view:timeline' }, { id: 'list', label: t('قائمة'), icon: <List />, fb: 'res-view:list' }]} />
            {(view === 'timeline' || f === 'DAY') && (
              <div className="flex items-center gap-1" data-fb="res-day">
                <Button size="sm" variant={day === today ? 'primary' : 'ghost'} onClick={() => setDay(today)} data-fb="res-day:today">{t('اليوم')}</Button>
                <Button size="sm" variant={day === addDays(today, 1) ? 'primary' : 'ghost'} onClick={() => setDay(addDays(today, 1))} data-fb="res-day:tomorrow">{t('غدًا')}</Button>
                <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="!h-9 !w-40 num" aria-label={t('اليوم')} data-fb="res-day:date" />
              </div>
            )}
            {view === 'list' && <FilterChips value={f} onChange={setF} options={[{ id: 'DAY', label: dayLabel ?? t('اليوم المختار'), count: ofDay.length, fb: 'res-filter:day' }, { id: 'BOOKED', label: t('القادمة'), count: all.filter((r) => r.state === 'BOOKED').length, fb: 'res-filter:booked' }, { id: 'CLOSED', label: t('الملغاة وعدم الحضور'), count: all.filter((r) => r.state === 'CANCELLED' || r.state === 'NO_SHOW').length, fb: 'res-filter:closed' }]} />}
          </div>
          {view === 'timeline' ? (
            <Timeline items={ofDay} all={all} tables={tables} rules={rules} day={day} loading={res.loading && !res.data} canDrag={manage} onOpen={(r) => setOpenId(r.id)} onMove={move}
              onAct={(kind, r) => setAct({ kind, id: r.id })} empty={!ofDay.length} onNew={manage ? () => setCreating(true) : undefined} />
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ResTable rows={list} loading={res.loading && !res.data} onOpen={(r) => setOpenId(r.id)} onSeat={(r) => setAct({ kind: 'seat', id: r.id })} canSeat={can('table:assign')}
                empty={<EmptyState compact icon={<CalendarClock />} title={t('لا توجد حجوزات')} action={manage ? <Button size="sm" variant="primary" onClick={() => setCreating(true)}>{t('حجز جديد')}</Button> : undefined} />} />
            </div>
          )}
        </>
      )}
      {tab === 'dep' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Table loading={deps.loading && !deps.data} align={['start', 'start', 'end', 'end', 'end', 'start', 'start', 'start', 'end']} head={[t('العميل'), t('الغرض'), t('المبلغ'), t('المخصوم'), t('المتبقي'), t('طريقة الدفع'), t('الحالة'), t('التاريخ'), '']}
            rows={(deps.data?.items ?? []).slice().reverse().map((d: any) => [
              <b>{d.customerName}</b>, d.purpose === 'BOOKING' ? t('حجز') : t('طلب مسبق'), <Money v={d.amount} />, sign(d.applied) > 0 ? <Money v={d.applied} /> : <span className="text-dim">—</span>, <Money v={d.remaining} />, methodText(d.method),
              <DepPill d={d} />, <DateTime v={d.createdAt} className="text-xs" />,
              !d.refundBlock && can('deposit:refund') ? <Button size="sm" variant="ghost" onClick={() => setAct({ kind: 'refund', id: d.reservationId ?? `dep:${d.id}` })} data-fb={`dep-refund:${d.id}`}><Undo2 className="w-3.5 h-3.5" />{t('رد العربون')}</Button> : null,
            ])}
            empty={<EmptyState compact icon={<PiggyBank />} title={t('لا يوجد عربون')} />} />
        </div>
      )}
      {creating && <NewReservation all={all} tables={tables} rules={rules} day={day} drawer={!!terminal?.drawer} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpenId(id); }} />}
      {opened && !act && <ReservationPopup r={opened} onClose={() => setOpenId(null)} onAct={(kind) => setAct({ kind, id: opened.id })} />}
      {act?.kind === 'edit' && target && <EditPopup r={target} all={all} tables={tables} rules={rules} onClose={() => setAct(null)} />}
      {act?.kind === 'cancel' && target && <CancelPopup r={target} rules={rules} onClose={() => setAct(null)} onRefund={() => setAct({ kind: 'refund', id: target.id })} />}
      {act?.kind === 'seat' && target && <SeatPopup r={target} all={all} tables={tables} rules={rules} onClose={() => setAct(null)} />}
      {act?.kind === 'refund' && (target?.deposit || act.id.startsWith('dep:')) && <RefundPopup d={target?.deposit ?? (deps.data?.items ?? []).find((x: any) => `dep:${x.id}` === act.id)} who={target?.customerName} onClose={() => setAct(null)} />}
    </div>
  );
}

function DepPill({ d }: { d: any }) {
  return <Pill tone={DEP_STATE[d.state]?.[1] ?? 'neutral'} dot>{t(DEP_STATE[d.state]?.[0] ?? '—')}{d.state === 'HELD' && sign(d.applied) > 0 ? ` · ${t('جزئيًا')}` : ''}<Tech><span className="num opacity-70">{d.state}</span></Tech></Pill>;
}
function GuestName({ r, className }: { r: any; className?: string }) {
  return <span className={cn('min-w-0', className)}><b className="truncate">{r.customerName}</b>{r.legacy && <Pill size="sm" tone="neutral" className="ms-1.5" title={t('اسم مكتوب بلا ملف عميل')}>{t('بلا ملف')}</Pill>}</span>;
}

function ResTable({ rows, loading, onOpen, onSeat, canSeat, empty }: { rows: any[]; loading: boolean; onOpen: (r: any) => void; onSeat: (r: any) => void; canSeat: boolean; empty: React.ReactNode }) {
  return (
    <Table loading={loading} align={['start', 'start', 'center', 'start', 'end', 'start', 'end']} head={[t('الموعد'), t('الضيف'), t('الأفراد'), t('الترابيزة'), t('العربون'), t('الحالة'), '']} onRowClick={(i) => onOpen(rows[i])}
      rows={rows.map((r: any) => [
        <span className="font-bold"><DateTime v={r.at} time /><DateTime v={r.at} className="block text-[11px] text-dim font-normal" /></span>,
        <span className="block" data-fb={`res-row:${r.customerName}`}><GuestName r={r} /><span className="block text-xs text-dim num" dir="ltr" style={{ textAlign: 'start' }}>{r.phone}</span></span>,
        <span className="num font-bold">{r.partySize}</span>,
        r.tableName ? `${t('ترابيزة')} ${r.tableName}` : <span className="text-dim">{t('بلا ترابيزة')}</span>,
        r.deposit ? <span className="inline-flex flex-col items-end"><Money v={r.deposit.amount} /><span className="text-[11px] text-dim">{t(DEP_STATE[r.deposit.state]?.[0] ?? '')}</span></span> : <span className="text-dim">—</span>,
        <Pill tone={RES_STATE[r.state]?.[1] ?? 'neutral'} dot>{t(RES_STATE[r.state]?.[0] ?? '—')}</Pill>,
        r.state === 'BOOKED' && canSeat ? <Button size="sm" variant="success" onClick={(e) => { e.stopPropagation(); onSeat(r); }} data-fb={`reservation-seat:${r.customerName}`}><UserCheck className="w-3.5 h-3.5" />{t('إجلاس')}</Button> : null,
      ])} empty={empty} />
  );
}

// ───────── the day timeline: tables × hours
const ROW_H = 54;
function Timeline({ items, all, tables, rules, day, loading, canDrag, onOpen, onMove, onAct, empty, onNew }: {
  items: any[]; all: any[]; tables: any[]; rules: Rules; day: string; loading: boolean; canDrag: boolean; onOpen: (r: any) => void; onMove: (r: any, atMs: number, tableId: string | null) => Promise<boolean>;
  onAct: (k: 'edit' | 'cancel' | 'seat', r: any) => void; empty: boolean; onNew?: () => void;
}) {
  const rtl = document.documentElement.dir === 'rtl';
  const now = clock.now();
  const shown = items.filter((r) => r.state === 'BOOKED' || r.state === 'SEATED');
  const dayStart = cairoInstant(day, 0, 0);
  const hourOf = (ms: number) => (ms - dayStart) / 3_600_000;
  const h0 = Math.max(0, Math.min(12, ...shown.map((r) => Math.floor(hourOf(Date.parse(r.at))))));
  const h1 = Math.min(24, Math.max(24, ...shown.map((r) => Math.ceil(hourOf(Date.parse(r.at)) + rules.seatMinutes / 60))));
  const total = (h1 - h0) * 60;
  const startMs = dayStart + h0 * 3_600_000;
  const pct = (ms: number) => ((ms - startMs) / 60_000 / total) * 100;
  const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  const rows: { id: string | null; label: string; cap?: number }[] = [...tables.map((x) => ({ id: x.id as string, label: x.name as string, cap: x.capacity as number })), { id: null, label: t('بلا ترابيزة') }];
  const head = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; atMs: number; tableId: string | null; check: Check } | null>(null);
  const [pending, setPending] = useState<{ id: string; atMs: number; tableId: string | null } | null>(null);
  const [menu, setMenu] = useState<{ r: any; anchor: HTMLElement } | null>(null);
  const dref = useRef<{ r: any; x0: number; y0: number; pid: number; type: string; offMin: number; active: boolean; timer: any; tableId: string | null } | null>(null);
  const justDragged = useRef(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const minutesAt = (x: number) => {
    const rc = head.current!.getBoundingClientRect();
    const frac = rtl ? (rc.right - x) / rc.width : (x - rc.left) / rc.width;
    return frac * total;
  };
  const check = (r: any, atMs: number, tableId: string | null) => moveCheck(r, atMs, tableId, all, tables, rules, clock.now());
  const attempt = async (r: any, atMs: number, tableId: string | null) => {
    const c = check(r, atMs, tableId);
    if (!c.ok) { toast('warning', c.reason ?? t('لا يمكن النقل إلى هنا')); return; } // refused here: nothing is sent
    setPending({ id: r.id, atMs, tableId });
    const ok = await onMove(r, atMs, tableId);
    if (!ok) setPending(null);
  };
  useEffect(() => { if (pending && !all.some((r) => r.id === pending.id && Date.parse(r.at) === pending.atMs && (r.tableId ?? null) === pending.tableId)) { const tm = setTimeout(() => setPending(null), 2500); return () => clearTimeout(tm); } setPending(null); return undefined; }, [all, pending]);
  const live = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void }>(null!);
  const stable = useMemo(() => ({ move: (e: PointerEvent) => live.current.move(e), up: (e: PointerEvent) => live.current.up(e), touch: (e: TouchEvent) => { if (dref.current?.active) e.preventDefault(); } }), []);
  const stop = () => { window.removeEventListener('pointermove', stable.move); window.removeEventListener('pointerup', stable.up); window.removeEventListener('pointercancel', stable.up); window.removeEventListener('touchmove', stable.touch); };
  const place = (e: PointerEvent) => {
    const d = dref.current!;
    const raw = minutesAt(e.clientX) - d.offMin;
    const m = Math.max(0, Math.min(total - 15, Math.round(raw / 15) * 15));
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-tl-row]') as HTMLElement | null;
    if (el) d.tableId = el.dataset.tlRow || null;
    const atMs = startMs + m * 60_000;
    setDrag({ id: d.r.id, atMs, tableId: d.tableId, check: check(d.r, atMs, d.tableId) });
  };
  live.current = {
    move: (e) => {
      const d = dref.current;
      if (!d || e.pointerId !== d.pid) return;
      const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
      if (!d.active) {
        if (d.type === 'touch') { if (dist > 10) { clearTimeout(d.timer); dref.current = null; stop(); } return; }
        if (dist < 5) return;
        d.active = true;
      }
      place(e);
    },
    up: (e) => {
      const d = dref.current;
      if (!d || e.pointerId !== d.pid) return;
      clearTimeout(d.timer); stop(); dref.current = null;
      if (!d.active) return;
      justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 60);
      const st = dragRef.current;
      setDrag(null);
      if (!st || (st.atMs === Date.parse(d.r.at) && st.tableId === (d.r.tableId ?? null))) return;
      if (!st.check.ok) { toast('warning', st.check.reason ?? t('لا يمكن النقل إلى هنا')); return; } // refused here: nothing is sent
      void attempt(d.r, st.atMs, st.tableId);
    },
  };
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const onDown = (e: React.PointerEvent<HTMLElement>, r: any) => {
    if (!canDrag || r.state !== 'BOOKED' || e.button !== 0 || dref.current) return;
    const startMin = (Date.parse(r.at) - startMs) / 60_000;
    dref.current = { r, x0: e.clientX, y0: e.clientY, pid: e.pointerId, type: e.pointerType, offMin: minutesAt(e.clientX) - startMin, active: false, timer: null, tableId: r.tableId ?? null };
    window.addEventListener('pointermove', stable.move); window.addEventListener('pointerup', stable.up); window.addEventListener('pointercancel', stable.up);
    if (e.pointerType === 'touch') {
      window.addEventListener('touchmove', stable.touch, { passive: false });
      const ev = e.nativeEvent;
      dref.current.timer = setTimeout(() => { if (dref.current) { dref.current.active = true; place(ev); try { navigator.vibrate?.(8); } catch { /* not supported */ } } }, 300);
    }
  };
  const rowIds = rows.map((x) => x.id);
  const onKey = (e: React.KeyboardEvent<HTMLElement>, r: any) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(r); return; }
    if (e.code === 'KeyM' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setMenu({ r, anchor: e.currentTarget }); return; }
    if (!e.altKey && !e.shiftKey) return;
    if (!canDrag || r.state !== 'BOOKED') return;
    const at = Date.parse(r.at);
    const i = rowIds.indexOf(r.tableId ?? null);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const later = (e.key === 'ArrowLeft') === rtl; void attempt(r, at + (later ? Q : -Q), r.tableId ?? null); }
    else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); void attempt(r, at, rowIds[i - 1]); }
    else if (e.key === 'ArrowDown' && i < rowIds.length - 1) { e.preventDefault(); void attempt(r, at, rowIds[i + 1]); }
  };
  if (loading) return <div className="flex-1 grid place-items-center"><Spinner /></div>;
  const nowPct = pct(now);
  const gridBg = `repeating-linear-gradient(${rtl ? 'to left' : 'to right'}, var(--glass-border) 0 1px, transparent 1px ${100 / hours.length}%)`;
  return (
    <div className="flex-1 min-h-0 rounded-2xl surface-1 border line overflow-auto relative" data-fb="res-timeline" role="grid" aria-label={t('الخط الزمني')}>
      <div className="min-w-[880px]">
        <div className="sticky top-0 z-10 flex border-b line surface-2" style={{ height: 34 }}>
          <div className="w-24 shrink-0 sticky start-0 surface-2 z-10 border-e line px-2 text-[11px] font-bold text-soft flex items-center">{t('الترابيزة')}</div>
          <div ref={head} className="relative flex-1" data-fb="res-timeline-hours">
            {hours.map((h) => <span key={h} className="absolute top-0 bottom-0 text-[11px] font-bold text-soft flex items-center ps-1.5 border-s line" style={{ insetInlineStart: `${pct(dayStart + h * 3_600_000)}%` }}><span className="num">{pad(h)}:00</span></span>)}
          </div>
        </div>
        {rows.map((row) => {
          const own = shown.filter((r) => (r.tableId ?? null) === row.id && !(pending?.id === r.id));
          const pend = pending ? shown.find((r) => r.id === pending.id && pending.tableId === row.id) : null;
          const ghost = drag && drag.tableId === row.id ? drag : null;
          return (
            <div key={row.id ?? 'none'} className="flex border-b line last:border-b-0" style={{ height: ROW_H }} data-tl-row={row.id ?? ''} data-fb={`tl-row:${row.label}`}>
              <div className="w-24 shrink-0 sticky start-0 z-[5] surface-1 border-e line px-2 flex items-center gap-1.5 text-sm">
                {row.id ? <><Armchair className="w-3.5 h-3.5 text-dim" /><b className="num">{row.label}</b><span className="text-[11px] text-dim num inline-flex items-center gap-0.5"><Users className="w-3 h-3" />{row.cap}</span></> : <span className="text-xs text-soft font-bold">{row.label}</span>}
              </div>
              <div className="relative flex-1" style={{ backgroundImage: gridBg }}>
                {day === cairoDate(now) && nowPct >= 0 && nowPct <= 100 && <span className="absolute top-0 bottom-0 w-0.5 bg-[var(--error)] opacity-70 pointer-events-none" style={{ insetInlineStart: `${nowPct}%` }} />}
                {own.map((r) => <Bar key={r.id} r={r} pct={pct} total={total} rules={rules} now={now} dragging={drag?.id === r.id} canDrag={canDrag}
                  onDown={(e) => onDown(e, r)} onClick={() => { if (!justDragged.current) onOpen(r); }} onKey={(e) => onKey(e, r)} onMenu={(el) => setMenu({ r, anchor: el })} />)}
                {pend && <Bar r={{ ...pend, at: new Date(pending!.atMs).toISOString() }} pct={pct} total={total} rules={rules} now={now} busy canDrag={false} onDown={() => {}} onClick={() => {}} onKey={() => {}} onMenu={() => {}} />}
                {ghost && (
                  <div className="absolute top-1 bottom-1 rounded-xl border-2 border-dashed pointer-events-none flex items-center px-2 text-[11px] font-bold gap-1 z-20" data-fb="tl-ghost" data-legal={ghost.check.ok || undefined}
                    style={{ insetInlineStart: `${pct(ghost.atMs)}%`, width: `${(rules.seatMinutes / total) * 100}%`, borderColor: ghost.check.ok ? 'var(--success)' : 'var(--error)', background: ghost.check.ok ? 'color-mix(in srgb, var(--success) 14%, transparent)' : 'color-mix(in srgb, var(--error) 14%, transparent)' }}>
                    <span className="num">{cairoHm(ghost.atMs)}</span>{!ghost.check.ok && <span className="truncate text-[var(--error)]">· {ghost.check.reason}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {empty && <div className="absolute inset-x-0 top-24 flex justify-center pointer-events-none"><div className="pointer-events-auto"><EmptyState compact icon={<CalendarClock />} title={t('لا توجد حجوزات في هذا اليوم')} action={onNew && <Button size="sm" variant="primary" onClick={onNew}>{t('حجز جديد')}</Button>} /></div></div>}
      {menu && <MoveMenu r={menu.r} anchor={menu.anchor} rows={rows} check={check} canDrag={canDrag} onClose={() => setMenu(null)} onOpen={() => { setMenu(null); onOpen(menu.r); }} onAct={(k) => { setMenu(null); onAct(k, menu.r); }} onMove={(at, tb) => { setMenu(null); void attempt(menu.r, at, tb); }} />}
    </div>
  );
}

function Bar({ r, pct, total, rules, now, dragging, busy, canDrag, onDown, onClick, onKey, onMenu }: { r: any; pct: (ms: number) => number; total: number; rules: Rules; now: number; dragging?: boolean; busy?: boolean; canDrag: boolean; onDown: (e: React.PointerEvent<HTMLElement>) => void; onClick: () => void; onKey: (e: React.KeyboardEvent<HTMLElement>) => void; onMenu: (el: HTMLElement) => void }) {
  const at = Date.parse(r.at);
  const seated = r.state === 'SEATED';
  const late = r.state === 'BOOKED' && now > at;
  const held = r.deposit && r.deposit.state === 'HELD';
  return (
    <div role="button" tabIndex={0} data-fb={`tl-bar:${r.customerName}`} data-res={r.id} data-state={r.state} aria-label={`${r.customerName} · ${cairoHm(at)} · ${r.partySize} ${t('أفراد')}`}
      onPointerDown={onDown} onClick={onClick} onKeyDown={(e) => { if (e.currentTarget === e.target) onKey(e); }} onContextMenu={(e) => { e.preventDefault(); onMenu(e.currentTarget); }}
      className={cn('group absolute top-1 bottom-1 rounded-xl border px-2 py-1 flex items-center gap-1.5 text-start select-none outline-none overflow-hidden focus-visible:ring-2 focus-visible:ring-[var(--primary)] transition-opacity',
        canDrag && r.state === 'BOOKED' ? 'cursor-grab active:cursor-grabbing touch-manipulation' : 'cursor-pointer', dragging && 'opacity-30', busy && 'opacity-60')}
      style={{ insetInlineStart: `${pct(at)}%`, width: `calc(${(rules.seatMinutes / total) * 100}% - 3px)`, background: seated ? 'color-mix(in srgb, var(--success) 18%, var(--card-raised))' : 'color-mix(in srgb, var(--primary) 16%, var(--card-raised))', borderColor: late ? 'var(--warning)' : seated ? 'color-mix(in srgb, var(--success) 50%, transparent)' : 'color-mix(in srgb, var(--primary) 45%, transparent)', borderInlineStartWidth: 3 }}>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-[13px] font-bold truncate">{r.customerName}</div>
        <div className="text-[11px] text-soft flex items-center gap-1.5 num"><span>{cairoHm(at)}</span><span className="inline-flex items-center gap-0.5"><Users className="w-3 h-3" />{r.partySize}</span>{held && <PiggyBank className="w-3 h-3 text-[var(--warning-text)]" />}{r.notes && <StickyNote className="w-3 h-3" />}{late && <AlertTriangle className="w-3 h-3 text-[var(--warning-text)]" />}</div>
      </div>
      <button type="button" data-no-drag aria-label={t('الإجراءات')} title={`${t('الإجراءات')} (M)`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onMenu(e.currentTarget); }} data-fb="tl-bar-menu"
        className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-dim hover:text-[var(--foreground)] hover:bg-[var(--surface-2)] opacity-70 group-hover:opacity-100"><MoreHorizontal className="w-4 h-4" /></button>
    </div>
  );
}

/** The keyboard / menu alternative to dragging: the same legal moves, refused here with the reason. */
function MoveMenu({ r, anchor, rows, check, canDrag, onClose, onOpen, onAct, onMove }: { r: any; anchor: HTMLElement; rows: { id: string | null; label: string }[]; check: (r: any, at: number, tb: string | null) => Check; canDrag: boolean; onClose: () => void; onOpen: () => void; onAct: (k: 'edit' | 'cancel' | 'seat') => void; onMove: (at: number, tb: string | null) => void }) {
  const at = Date.parse(r.at);
  const tb = r.tableId ?? null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const id = requestAnimationFrame(() => (ref.current?.querySelector('button:not([disabled])') as HTMLElement | null)?.focus()); return () => cancelAnimationFrame(id); }, []);
  const steps: [string, number][] = [[t('قبل ساعة'), -60], [t('قبل ربع ساعة'), -15], [t('بعد ربع ساعة'), 15], [t('بعد ساعة'), 60]];
  const movable = canDrag && r.state === 'BOOKED';
  return (
    <Popover anchor={anchor} open onClose={() => { onClose(); anchor.focus?.(); }} side="auto" align="end" width={320} label={t('الإجراءات')} fb="tl-menu">
      <div ref={ref} className="flex flex-col gap-1">
        <button type="button" onClick={onOpen} className="w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] outline-none" data-fb="tl-menu:open">{t('تفاصيل الحجز')} <Kbd className="!text-[10px] ms-1">Enter</Kbd></button>
        {movable && <>
          <div className="px-2.5 pt-1 text-[11px] font-bold text-dim">{t('الوقت')} <Kbd className="!text-[10px] ms-1">Shift ←→</Kbd></div>
          <div className="grid grid-cols-2 gap-1 px-1">
            {steps.map(([label, m]) => { const c = check(r, at + m * 60_000, tb); return <button key={m} type="button" disabled={!c.ok} title={c.reason} onClick={() => onMove(at + m * 60_000, tb)} data-fb={`tl-move:${m}`} className="rounded-lg px-2 py-1.5 text-xs font-bold surface-1 border line hover:border-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed">{label}</button>; })}
          </div>
          <div className="px-2.5 pt-1 text-[11px] font-bold text-dim">{t('الترابيزة')} <Kbd className="!text-[10px] ms-1">Shift ↑↓</Kbd></div>
          <div className="grid grid-cols-5 gap-1 px-1 max-h-40 overflow-y-auto">
            {rows.filter((x) => x.id !== tb).map((x) => { const c = check(r, at, x.id); return <button key={x.id ?? 'none'} type="button" disabled={!c.ok} title={c.reason} onClick={() => onMove(at, x.id)} data-fb={`tl-table:${x.label}`} data-legal={c.ok || undefined} className={cn('rounded-lg py-1.5 text-xs font-bold surface-1 border line hover:border-[var(--primary)] disabled:opacity-35 disabled:cursor-not-allowed', !x.id && 'col-span-2', x.id && 'num')}>{x.label}</button>; })}
          </div>
        </>}
        {r.state === 'BOOKED' && <div className="border-t line my-1" />}
        {r.state === 'BOOKED' && <>
          <button type="button" onClick={() => onAct('seat')} className="w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-2)] outline-none focus-visible:bg-[var(--surface-2)] text-[var(--success)]" data-fb="tl-menu:seat"><UserCheck className="w-4 h-4" />{t('إجلاس')}</button>
          {movable && <button type="button" onClick={() => onAct('edit')} className="w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-2)] outline-none focus-visible:bg-[var(--surface-2)]" data-fb="tl-menu:edit"><Pencil className="w-4 h-4" />{t('تعديل')}</button>}
          {movable && <button type="button" onClick={() => onAct('cancel')} className="w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-2)] outline-none focus-visible:bg-[var(--surface-2)] text-[var(--error)]" data-fb="tl-menu:cancel"><Ban className="w-4 h-4" />{t('إلغاء الحجز')}</button>}
        </>}
      </div>
    </Popover>
  );
}

// ───────── the reservation popup: customer, time, table, deposit, history; the actions of its state
function ReservationPopup({ r, onClose, onAct }: { r: any; onClose: () => void; onAct: (k: 'edit' | 'cancel' | 'refund' | 'seat') => void }) {
  const { can, nav, terminal } = useDev();
  const { run, busy } = useCommand();
  const [linking, setLinking] = useState(false);
  const booked = r.state === 'BOOKED';
  const manage = can('reservation:manage');
  const d = r.deposit;
  const noShow = async () => {
    const out = await run('Reservation.MarkNoShow', { params: { reservationId: r.id }, body: { expectedVersion: r.version } }, { success: d && d.state === 'HELD' ? t('سُجل عدم الحضور وصودر العربون') : t('سُجل عدم الحضور') });
    if (out) onClose();
  };
  const link = async (c: any) => { const out = await run('Reservation.Update', { params: { reservationId: r.id }, body: { customerId: c.id, expectedVersion: r.version } }, { success: t('رُبط الحجز بالعميل') }); if (out) setLinking(false); };
  return (
    <Popup open onClose={onClose} size="lg" fb="res-popup"
      title={<span className="flex items-center gap-2 flex-wrap"><CalendarClock className="w-5 h-5 text-[var(--primary)]" />{r.customerName}<Pill tone={RES_STATE[r.state]?.[1] ?? 'neutral'} dot>{t(RES_STATE[r.state]?.[0] ?? '—')}</Pill><Tech><Pill tone="violet" size="sm">{t('مقترح')}</Pill></Tech></span>}
      footer={<>
        {booked && manage && <Button variant="ghost" className="text-[var(--error)]" onClick={() => onAct('cancel')} data-fb="res-act:cancel"><Ban className="w-4 h-4" />{t('إلغاء الحجز')}</Button>}
        {booked && manage && <Button variant="ghost" onClick={noShow} loading={busy} data-fb="res-act:noshow"><UserX className="w-4 h-4" />{t('لم يحضر')}</Button>}
        {d && !d.refundBlock && can('deposit:refund') && <Button variant={booked ? 'ghost' : 'primary'} onClick={() => onAct('refund')} disabled={!terminal?.drawer} title={!terminal?.drawer ? t('الرد من جهاز به درج نقدية') : undefined} data-fb="res-act:refund"><Undo2 className="w-4 h-4" />{t('رد العربون')}</Button>}
        <div className="flex-1" />
        {booked && manage && <Button onClick={() => onAct('edit')} data-fb="res-act:edit"><Pencil className="w-4 h-4" />{t('تعديل')}</Button>}
        {booked && can('table:assign') && <Button variant="primary" size="lg" onClick={() => onAct('seat')} data-fb="res-act:seat"><UserCheck className="w-4 h-4" />{t('إجلاس')}</Button>}
      </>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3 min-w-0">
          <div className="rounded-2xl surface-1 border line p-3 space-y-2" data-fb="res-customer">
            <div className="flex items-center gap-2"><UserRound className="w-4 h-4 text-[var(--primary)]" /><b className="flex-1 truncate">{r.customerName}</b>{r.legacy ? <Pill size="sm" tone="neutral">{t('بلا ملف')}</Pill> : r.customerRef?.code && <span className="text-[11px] text-dim num">{r.customerRef.code}</span>}</div>
            <div className="text-sm flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-dim" /><span className="num" dir="ltr">{r.phone}</span></div>
            {r.customerRef?.allergies?.length > 0 && <div className="text-xs font-bold text-[var(--warning-text)] flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{t('حساسية')}: {r.customerRef.allergies.length}</div>}
            {!r.legacy && can('customer:pii:read') && <Button size="sm" variant="ghost" onClick={() => nav('customer', { customerId: r.customerId })} data-fb="res-customer-open"><ExternalLink className="w-3.5 h-3.5" />{t('ملف العميل')}</Button>}
            {r.legacy && booked && manage && !linking && <Button size="sm" onClick={() => setLinking(true)} data-fb="res-customer-link"><UserPlus className="w-3.5 h-3.5" />{t('ربط بعميل')}</Button>}
            {linking && <GuestPicker value={null} onChange={(c) => c && link(c)} initial={r.phone?.includes("•") ? "" : r.phone /* ux-13: a masked number cannot be searched */} />}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Fact label={t('الموعد')} value={<DateTime v={r.at} time />} hint={<DateTime v={r.at} />} />
            <Fact label={t('الترابيزة')} value={r.tableName ? <span className="num">{r.tableName}</span> : <span className="text-dim text-sm">{t('بلا ترابيزة')}</span>} />
            <Fact label={t('الأفراد')} value={<span className="num">{r.partySize}</span>} />
          </div>
          {r.notes && <div className="rounded-xl surface-1 border line px-3 py-2 text-sm flex items-start gap-2"><StickyNote className="w-4 h-4 text-dim mt-0.5" />{r.notes}</div>}
          {r.cancel && <div className="rounded-xl border px-3 py-2 text-sm space-y-0.5" style={{ borderColor: 'var(--glass-border)' }} data-fb="res-cancel-info"><div className="font-bold">{t('أُلغي')} · <DateTime v={r.cancel.at} /> · {personName(null, r.cancelledByName)}</div><div className="text-soft">{r.cancel.reason}</div><div className="text-xs text-dim">{r.cancel.late ? t('إلغاء متأخر') : t('إلغاء مبكر')} · {t(OUTCOME[r.cancel.depositOutcome] ?? '')}</div></div>}
        </div>
        <div className="space-y-3 min-w-0">
          {d ? <DepositCard d={d} /> : <div className="rounded-2xl surface-1 border line p-3 text-sm text-dim flex items-center gap-2"><PiggyBank className="w-4 h-4" />{t('بلا عربون')}</div>}
          <div>
            <div className="text-sm font-bold mb-1.5 flex items-center gap-1.5"><History className="w-4 h-4" />{t('السجل')}</div>
            <ol className="space-y-1 text-xs max-h-48 overflow-y-auto" data-fb="res-history">
              {(r.history ?? []).slice().reverse().map((e: any, i: number) => (
                <li key={i} className="rounded-lg surface-1 px-2.5 py-1.5">
                  <div className="flex items-center gap-2"><b>{t(EVENT[e.kind] ?? e.kind)}</b>{e.amount && <Money v={e.amount} className="text-xs" />}<span className="flex-1" /><span className="text-dim"><DateTime v={e.at} /></span></div>
                  {e.changes?.map((c: any, j: number) => <div key={j} className="text-soft">{t(FIELD[c.field] ?? c.field)}: <ChangeVal f={c.field} v={c.from} /> ← <ChangeVal f={c.field} v={c.to} /></div>)}
                  {e.reason && e.kind !== 'DEPOSIT_FORFEITED' && <div className="text-soft">{e.reason}</div>}
                  {e.kind === 'DEPOSIT_FORFEITED' && e.reason && <div className="text-soft">{t(FORFEIT_CAUSE[e.reason] ?? e.reason)}</div>}
                  <div className="text-dim">{personName(null, e.byName)}</div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Popup>
  );
}
const OUTCOME: Record<string, string> = { NONE: 'بلا عربون', REFUNDABLE: 'العربون قابل للرد بموافقة المدير', FORFEITED: 'صودر العربون' };
function ChangeVal({ f, v }: { f: string; v: any }) {
  if (v === null || v === undefined || v === '') return <span className="text-dim">—</span>;
  if (f === 'at') return <DateTime v={v} />;
  if (f === 'tableId') return <span>{t('ترابيزة')} {tableNameOf(v)}</span>;
  if (f === 'customerId' || f === 'depositId') return <span className="text-dim">✓</span>;
  return <span className="num">{String(v)}</span>;
}
let tableNames: Record<string, string> = {};
const tableNameOf = (id: string) => tableNames[id] ?? '';
function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <div className="rounded-2xl surface-1 border line px-3 py-2 min-w-0"><div className="text-[11px] text-dim">{label}</div><div className="font-extrabold text-lg leading-tight truncate">{value}</div>{hint && <div className="text-[10px] text-dim">{hint}</div>}</div>;
}
function DepositCard({ d }: { d: any }) {
  return (
    <div className="rounded-2xl border p-3 space-y-2" style={{ borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)' }} data-fb="res-deposit">
      <div className="flex items-center gap-2"><PiggyBank className="w-4 h-4 text-[var(--primary)]" /><b className="flex-1">{t('العربون')}</b><DepPill d={d} /></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span className="text-soft">{t('المبلغ')}</span><Money v={d.amount} className="text-end" />
        <span className="text-soft">{t('طريقة الدفع')}</span><span className="text-end">{methodText(d.method)}</span>
        {sign(d.applied) > 0 && <><span className="text-soft">{t('خُصم من الشيك')}</span><Money v={d.applied} className="text-end" /></>}
        {sign(d.refunded) > 0 && <><span className="text-soft">{t('رُدّ')}</span><Money v={d.refunded} className="text-end" /></>}
        {sign(d.forfeited) > 0 && <><span className="text-soft">{t('صودر')}</span><Money v={d.forfeited} className="text-end" tone="error" /></>}
        <span className="font-bold">{t('المتبقي')}</span><Money v={d.remaining} className="text-end font-bold" fb="res-deposit-remaining" />
      </div>
      {d.forfeit && <div className="text-xs text-[var(--error)]" data-fb="res-deposit-forfeit">{t('صودر بسبب {c}', { c: t(FORFEIT_CAUSE[d.forfeit.cause] ?? d.forfeit.cause) })} · <DateTime v={d.forfeit.at} /></div>}
      {d.refunds?.map((x: any) => <div key={x.id} className="text-xs text-soft flex items-center gap-1.5" data-fb="res-deposit-refund"><Undo2 className="w-3 h-3" /><span className="num">{x.number}</span> · <Money v={x.amount} className="text-xs" /> · <DateTime v={x.at} /></div>)}
    </div>
  );
}

// ───────── pick a customer, or create one (QuickCreate) — inside the popup, no nested window
function GuestPicker({ value, onChange, initial }: { value: any | null; onChange: (c: any | null) => void; initial?: string }) {
  const [q, setQ] = useState(initial ?? '');
  const [creating, setCreating] = useState(false);
  const isPhone = /^[\d+\s٠-٩-]+$/.test(q.trim());
  const res = useQuery<any>(!value && q.trim().length >= 3 ? 'Customer.Search' : null, { query: isPhone ? { phone: q.trim(), limit: 5 } : { text: q.trim(), limit: 5 } });
  if (value) return (
    <div className="flex items-center gap-2 rounded-xl border border-[var(--primary)] bg-[var(--primary-container)] px-3 py-2" data-fb="guest-picked">
      <UserRound className="w-4 h-4 text-[var(--primary)]" /><div className="flex-1 min-w-0"><div className="font-bold flex items-center gap-1.5 truncate">{value.name}<TierBadge tier={value.loyalty?.tier} /></div><div className="text-xs text-dim num" dir="ltr" style={{ textAlign: 'start' }}>{value.phone}</div></div>
      <Button size="sm" variant="ghost" onClick={() => onChange(null)} data-fb="guest-change"><X className="w-3.5 h-3.5" />{t('تغيير')}</Button>
    </div>
  );
  if (creating) return <div className="rounded-xl surface-1 border line p-3"><QuickCreate phone={isPhone ? q.trim() : ''} name={!isPhone ? q.trim() : ''} onCancel={() => setCreating(false)} onCreated={(c) => { setCreating(false); onChange(c); }} /></div>;
  const items: any[] = res.data?.items ?? [];
  return (
    <div className="space-y-2" data-fb="guest-picker">
      <div className="relative"><Search className="w-4 h-4 absolute top-3 start-3 text-dim" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('رقم الموبايل أو الاسم')} className="ps-9" data-fb="guest-search" /></div>
      {res.loading && <Spinner />}
      <div className="space-y-1.5">{items.map((c) => <CustomerRow key={c.id} c={c} onClick={() => onChange(c)} />)}</div>
      {q.trim().length >= 3 && !res.loading && !items.length && <div className="text-xs text-dim">{res.data?.phoneSearch === 'FULL_NUMBER_REQUIRED' ? t('اكتب الرقم كاملًا') : t('لا يوجد عميل بهذه البيانات')}</div>}
      <Button variant="outline" size="sm" className="w-full" onClick={() => setCreating(true)} data-fb="guest-new"><UserPlus className="w-4 h-4" />{t('عميل جديد')}{isPhone && q.trim() ? ` · ${q.trim()}` : ''}</Button>
    </div>
  );
}

/** Time of day: a 15-minute step select (Cairo wall time). */
function TimeSelect({ value, onChange, fb }: { value: string; onChange: (v: string) => void; fb?: string }) {
  const opts = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
  return <Select value={value} onChange={(e) => onChange(e.target.value)} options={opts.map((o) => ({ value: o, label: o }))} className="num" data-fb={fb} />;
}
function PartyPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-fb="party-picker">
      <Button size="icon" onClick={() => onChange(Math.max(1, value - 1))} aria-label={t('أقل')}><Minus className="w-4 h-4" /></Button>
      <span className="w-12 text-center text-2xl font-extrabold num" data-fb="party-value">{value}</span>
      <Button size="icon" onClick={() => onChange(Math.min(200, value + 1))} aria-label={t('أكثر')}><Plus className="w-4 h-4" /></Button>
      {[2, 4, 6, 8].map((n) => <button key={n} type="button" onClick={() => onChange(n)} data-fb={`party:${n}`} className={cn('w-10 h-10 rounded-xl font-bold num border', value === n ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'surface-1 border-[var(--glass-border)]')}>{n}</button>)}
    </div>
  );
}
/** The table choice with the same conflict rule the server applies (illegal tables cannot be chosen). */
function TablePick({ value, onChange, r, atMs, all, tables, rules, partySize }: { value: string; onChange: (v: string) => void; r: any; atMs: number; all: any[]; tables: any[]; rules: Rules; partySize: number }) {
  return (
    <div className="grid grid-cols-6 gap-1.5" data-fb="table-pick">
      <button type="button" onClick={() => onChange('')} className={cn('col-span-2 min-h-[44px] rounded-xl border text-xs font-bold', value === '' ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{t('بلا ترابيزة')}</button>
      {tables.map((x) => {
        const c = moveCheck({ ...r, state: 'BOOKED' }, atMs, x.id, all, tables, rules, -Infinity);
        const small = x.capacity < partySize;
        return <button key={x.id} type="button" disabled={!c.ok} title={c.reason ?? (small ? t('الكراسي أقل من عدد الأفراد') : undefined)} onClick={() => onChange(x.id)} data-fb={`table-pick:${x.name}`} data-legal={c.ok || undefined}
          className={cn('min-h-[44px] rounded-xl border text-sm font-extrabold num leading-none disabled:opacity-30 disabled:cursor-not-allowed', value === x.id ? 'border-[var(--primary)] bg-[var(--primary-container)] ring-2 ring-[var(--primary)]' : 'surface-1 border-[var(--glass-border)]', small && c.ok && 'text-[var(--warning-text)]')}>
          {x.name}<span className="block text-[10px] font-normal text-dim">{x.capacity}</span></button>;
      })}
    </div>
  );
}

function NewReservation({ all, tables, rules, day, drawer, onClose, onDone }: { all: any[]; tables: any[]; rules: Rules; day: string; drawer: boolean; onClose: () => void; onDone: (id: string) => void }) {
  const { run, busy } = useCommand();
  const now = clock.now();
  const startMs = Math.max(cairoInstant(day, 19, 0), Math.ceil((now + 3_600_000) / Q) * Q);
  const [guest, setGuest] = useState<any | null>(null);
  const [date, setDate] = useState(cairoDate(startMs));
  const [time, setTime] = useState(cairoHm(startMs));
  const [party, setParty] = useState(4);
  const [tableId, setTableId] = useState('');
  const [notes, setNotes] = useState('');
  const [deposit, setDeposit] = useState(drawer ? '200' : '');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [fee, setFee] = useState('0');
  const [hh, mm] = time.split(':').map(Number);
  const atMs = cairoInstant(date, hh, mm);
  const tableCheck = moveCheck({ id: null, state: 'BOOKED' }, atMs, tableId || null, all, tables, rules, now);
  const ok = !!guest && tableCheck.ok && (!sign(deposit) || method === 'CASH' || reference.trim());
  const create = async () => {
    if (!ok || busy) return;
    const r = await run<any>('Reservation.Create', { body: { customerId: guest.id, partySize: party, at: new Date(atMs).toISOString(), tableId: tableId || undefined, notes: notes.trim() || undefined, noShowFee: fee || '0' } }, { success: t('سُجل الحجز') });
    if (!r) return;
    if (drawer && sign(deposit) > 0) await run('Deposit.Create', { body: { customer: guest.name, phone: guest.phone, customerId: guest.id, reservationId: r.id, amount: deposit, method, reference: reference || undefined, purpose: 'BOOKING' } }, { success: t('سُجل العربون في الدرج') });
    onDone(r.id);
  };
  return (
    <Popup open onClose={onClose} size="lg" fb="reservation-popup" title={<span className="flex items-center gap-2"><CalendarPlus className="w-5 h-5 text-[var(--primary)]" />{t('حجز جديد')}<Tech><Pill tone="violet" size="sm">{t('مقترح')}</Pill></Tech></span>}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={create} data-fb="reservation-create">{t('حفظ الحجز')}<Kbd className="!bg-black/10 !border-black/10 !text-current">Enter</Kbd></Button></>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3 min-w-0">
          <Group label={t('العميل')} required><GuestPicker value={guest} onChange={setGuest} /></Group>
          <Group icon={<Users />} label={t('عدد الأفراد')}><PartyPicker value={party} onChange={setParty} /></Group>
          <Field icon={<StickyNote />} label={t('ملاحظات')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} data-fb="res-notes" /></Field>
        </div>
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('التاريخ')}><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="num" data-fb="res-date" /></Field>
            <Field label={t('الوقت')}><TimeSelect value={time} onChange={setTime} fb="res-time" /></Field>
          </div>
          {atMs < now && <div className="text-xs font-bold text-[var(--error)]">{t('هذا الوقت مضى')}</div>}
          <Group label={t('الترابيزة')} error={tableId && !tableCheck.ok ? tableCheck.reason ?? null : null}><TablePick value={tableId} onChange={setTableId} r={{ id: null }} atMs={atMs} all={all} tables={tables} rules={rules} partySize={party} /></Group>
          <div className="rounded-2xl surface-1 border line p-3 space-y-2">
            <div className="text-sm font-bold flex items-center gap-1.5"><PiggyBank className="w-4 h-4 text-[var(--primary)]" />{t('العربون والغرامة')}</div>
            <div className="grid grid-cols-3 gap-2">
              {drawer && <Field label={t('العربون (ج.م)')}><Input value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="num" data-fb="res-deposit-amount" /></Field>}
              {drawer && <Field label={t('طريقة الدفع')}><Select value={method} onChange={(e) => setMethod(e.target.value)} options={['CASH', 'CARD', 'DIGITAL_WALLET'].map((m) => ({ value: m, label: methodText(m) }))} /></Field>}
              <Field label={t('غرامة عدم الحضور (ج.م)')}><Input value={fee} onChange={(e) => setFee(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" className="num" data-fb="res-fee" /></Field>
            </div>
            {drawer && sign(deposit) > 0 && method !== 'CASH' && <Field label={t('رقم العملية')}><Input value={reference} onChange={(e) => setReference(e.target.value)} className="num" /></Field>}
          </div>
        </div>
      </div>
    </Popup>
  );
}

function EditPopup({ r, all, tables, rules, onClose }: { r: any; all: any[]; tables: any[]; rules: Rules; onClose: () => void }) {
  const { run, busy } = useCommand();
  const now = clock.now();
  const at0 = Date.parse(r.at);
  const [date, setDate] = useState(cairoDate(at0));
  const [time, setTime] = useState(cairoHm(at0));
  const [party, setParty] = useState<number>(r.partySize);
  const [tableId, setTableId] = useState<string>(r.tableId ?? '');
  const [notes, setNotes] = useState<string>(r.notes ?? '');
  // CAS: the save is based on the reservation as it was when the popup opened (another device's change is not overwritten)
  const [seen, setSeen] = useState<number>(r.version);
  const [hh, mm] = time.split(':').map(Number);
  const atMs = cairoInstant(date, hh, mm);
  const c = moveCheck(r, atMs, tableId || null, all, tables, rules, atMs === at0 ? -Infinity : now);
  const rebase = () => { const a = Date.parse(r.at); setDate(cairoDate(a)); setTime(cairoHm(a)); setParty(r.partySize); setTableId(r.tableId ?? ''); setNotes(r.notes ?? ''); setSeen(r.version); };
  const changed = atMs !== at0 || (tableId || null) !== (r.tableId ?? null) || party !== r.partySize || notes.trim() !== (r.notes ?? '');
  const save = async () => {
    if (!c.ok || !changed || busy) return;
    const body: any = { expectedVersion: seen };
    if (atMs !== at0) body.at = new Date(atMs).toISOString();
    if ((tableId || null) !== (r.tableId ?? null)) body.tableId = tableId || null;
    if (party !== r.partySize) body.partySize = party;
    if (notes.trim() !== (r.notes ?? '')) body.notes = notes.trim();
    if (await run('Reservation.Update', { params: { reservationId: r.id }, body }, { success: t('حُفظ التعديل') })) onClose();
    else if (r.version !== seen) rebase(); // refused as stale: show what is there now
  };
  return (
    <Popup open onClose={onClose} size="lg" fb="edit-popup" title={<span className="flex items-center gap-2"><Pencil className="w-5 h-5 text-[var(--primary)]" />{t('تعديل الحجز')} · {r.customerName}</span>}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('إلغاء')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!c.ok || !changed} onClick={save} data-fb="edit-save"><CheckCircle2 className="w-4 h-4" />{t('حفظ')}</Button></>}>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('التاريخ')}><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="num" data-fb="edit-date" /></Field>
            <Field label={t('الوقت')}><TimeSelect value={time} onChange={setTime} fb="edit-time" /></Field>
          </div>
          <Group icon={<Users />} label={t('عدد الأفراد')}><PartyPicker value={party} onChange={setParty} /></Group>
          <Field icon={<StickyNote />} label={t('ملاحظات')}><Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} data-fb="edit-notes" /></Field>
        </div>
        <div className="space-y-2 min-w-0">
          <Group label={t('الترابيزة')}><TablePick value={tableId} onChange={setTableId} r={r} atMs={atMs} all={all} tables={tables} rules={rules} partySize={party} /></Group>
          {!c.ok && <div className="text-sm font-bold text-[var(--error)] flex items-center gap-1.5" data-fb="edit-refusal"><AlertTriangle className="w-4 h-4" />{c.reason}</div>}
        </div>
      </div>
    </Popup>
  );
}

function CancelPopup({ r, rules, onClose, onRefund }: { r: any; rules: Rules; onClose: () => void; onRefund: () => void }) {
  const { run, busy } = useCommand();
  const { can, terminal } = useDev();
  const minReason = useReasonMin(); // ux-10b: ReasonTextPolicy
  const [reason, setReason] = useState('');
  const [seen, setSeen] = useState<number>(r.version);
  const p = r.cancelPreview ?? { outcome: 'NONE', late: false, amount: '0', cutoffAt: r.at };
  const ok = reason.trim().length >= minReason;
  const confirm = async () => {
    if (!ok || busy) return;
    const out = await run<any>('Reservation.Cancel', { params: { reservationId: r.id }, body: { reason: reason.trim(), expectedVersion: seen } }, { success: out0(p.outcome) });
    if (!out) { if (r.version !== seen) setSeen(r.version); return; }
    if (out.cancel?.depositOutcome === 'REFUNDABLE' && can('deposit:refund') && terminal?.drawer) onRefund(); else onClose();
  };
  return (
    <Popup open onClose={onClose} size="md" fb="cancel-popup" title={<span className="flex items-center gap-2"><Ban className="w-5 h-5 text-[var(--error)]" />{t('إلغاء الحجز')} · {r.customerName}</span>}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('رجوع')}</Button><Button variant="danger" size="lg" loading={busy} disabled={!ok} onClick={confirm} data-fb="cancel-confirm"><Ban className="w-4 h-4" />{t('إلغاء الحجز')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm"><DateTime v={r.at} /> · {r.partySize} {t('أفراد')}{r.tableName ? ` · ${t('ترابيزة')} ${r.tableName}` : ''}</div>
        <div className="rounded-2xl border p-3 space-y-1" data-fb="cancel-outcome" data-outcome={p.outcome}
          style={{ borderColor: p.outcome === 'FORFEITED' ? 'color-mix(in srgb, var(--error) 45%, transparent)' : p.outcome === 'REFUNDABLE' ? 'color-mix(in srgb, var(--warning) 45%, transparent)' : 'var(--glass-border)', background: p.outcome === 'FORFEITED' ? 'color-mix(in srgb, var(--error) 8%, transparent)' : p.outcome === 'REFUNDABLE' ? 'color-mix(in srgb, var(--warning) 8%, transparent)' : undefined }}>
          {p.outcome === 'NONE' ? <div className="font-bold">{t('بلا عربون')}</div> : (
            <>
              <div className="font-bold flex items-center gap-2">{p.outcome === 'FORFEITED' ? <AlertTriangle className="w-4 h-4 text-[var(--error)]" /> : <Undo2 className="w-4 h-4 text-[var(--warning-text)]" />}{p.outcome === 'FORFEITED' ? t('سيُصادر العربون') : t('العربون قابل للرد بموافقة المدير')} · <Money v={p.amount} /></div>
              <div className="text-xs text-soft">{p.late ? t('الإلغاء متأخر: أقل من {h} ساعة قبل الموعد', { h: rules.lateCancelHours }) : t('إلغاء مبكر: قبل {t}', { t: dateTime(p.cutoffAt) })}</div>
            </>
          )}
        </div>
        <Group label={t('السبب')} required>
          <div className="flex gap-1.5 flex-wrap mb-2">{CANCEL_REASONS.map((x) => <button key={x} type="button" onClick={() => setReason(t(x))} data-fb={`cancel-reason:${x}`} className={cn('h-9 px-3 rounded-full border text-xs font-bold', reason === t(x) ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>{t(x)}</button>)}</div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="cancel-reason" aria-label={t('السبب')} />
        </Group>
      </div>
    </Popup>
  );
}
const out0 = (o: string) => (o === 'FORFEITED' ? t('أُلغي الحجز وصودر العربون') : o === 'REFUNDABLE' ? t('أُلغي الحجز والعربون قابل للرد') : t('أُلغي الحجز'));

function RefundPopup({ d, who, onClose }: { d: any; who?: string; onClose: () => void }) {
  const minReason = useReasonMin(); // ux-10b: ReasonTextPolicy
  const { run, busy } = useCommand();
  const { terminal } = useDev();
  const [amount, setAmount] = useState(plainAmount(d?.remaining));
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<any>(null);
  const [seen, setSeen] = useState<number | undefined>(d?.version);
  const panel = useRef<HTMLDivElement>(null);
  const key = (k: NumpadKey) => setAmount((v) => applyNumpadKey(v, k, { decimals: 2, maxDigits: 7 }));
  useNumpadKeys(!done, key, { scope: panel });
  if (!d) return null;
  const over = amount !== '' && sign(changePreview(amount, d.remaining)) > 0;
  const ok = amount !== '' && sign(amount) > 0 && !over && reason.trim().length >= minReason && !!terminal?.drawer;
  const confirm = async () => {
    if (!ok || busy) return;
    const out = await run<any>('Deposit.Refund', { params: { depositId: d.id }, body: { amount, reason: reason.trim(), expectedVersion: seen ?? d.version } }, { success: t('رُدّ العربون من الدرج') });
    if (out) setDone(out); else if (d.version !== seen) { setSeen(d.version); setAmount(plainAmount(d.remaining)); }
  };
  return (
    <Popup open onClose={onClose} size="lg" fb="refund-popup" title={<span className="flex items-center gap-2"><Undo2 className="w-5 h-5 text-[var(--primary)]" />{t('رد العربون')}{who ? ` · ${who}` : ''}</span>}
      footer={done ? <><div className="flex-1" /><Button variant="primary" size="lg" onClick={onClose} data-fb="refund-done">{t('تم')}</Button></> : <><Button variant="ghost" size="lg" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" size="lg" loading={busy} disabled={!ok} onClick={confirm} data-fb="refund-confirm"><Undo2 className="w-4 h-4" />{t('رد من الدرج')}</Button></>}>
      {done ? (
        <div className="text-center space-y-2 py-4" data-fb="refund-result">
          <CheckCircle2 className="w-10 h-10 mx-auto text-[var(--success)]" />
          <div className="text-lg font-bold">{t('خرج من الدرج')} <Money v={done.refund.amount} /></div>
          <div className="text-sm text-soft"><span className="num">{done.refund.number}</span> · {t('حالة العربون')}: {t(DEP_STATE[done.deposit.state]?.[0] ?? '')}</div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[minmax(0,1fr)_260px] gap-4" ref={panel}>
          <div className="space-y-3 min-w-0">
            <div className="grid grid-cols-3 gap-2">
              <Stat label={t('العربون')} v={d.amount} />
              <Stat label={t('خُصم من الشيك')} v={d.applied} />
              <Stat label={t('المتبقي')} v={d.remaining} strong fb="refund-remaining" />
            </div>
            {over && <div className="text-sm font-bold text-[var(--error)] flex items-center gap-1.5" data-fb="refund-over"><AlertTriangle className="w-4 h-4" />{t('المبلغ أكبر من المتبقي ({m})', { m: money(d.remaining) })}</div>}
            {!terminal?.drawer && <div className="text-sm font-bold text-[var(--error)]">{t('الرد من جهاز به درج نقدية')}</div>}
            <Field label={t('السبب')} required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-fb="refund-reason" /></Field>
          </div>
          <div className="space-y-2">
            <div className="rounded-2xl p-3 text-center border border-[color-mix(in_srgb,var(--primary)_30%,transparent)] bg-[var(--primary-container)]"><span className="num text-2xl font-extrabold" dir="ltr" data-fb="refund-amount" data-value={amount}>{amount || '0'}</span></div>
            <Button className="w-full" onClick={() => setAmount(plainAmount(d.remaining))} data-fb="refund-full">{t('المتبقي كله')} · <Money v={d.remaining} /></Button>
            <Numpad mode="amount" size="md" onKey={key} fb="refund-numpad" />
          </div>
        </div>
      )}
    </Popup>
  );
}
function Stat({ label, v, strong, fb }: { label: string; v: string; strong?: boolean; fb?: string }) {
  return <div className={cn('rounded-2xl p-2.5 text-center border', strong ? 'border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}><div className="text-[11px] text-soft font-bold">{label}</div><Money v={v} className={strong ? 'text-xl' : 'text-base'} fb={fb} /></div>;
}

/** Seat the reservation (Reservation.Seat): its table, or a free table chosen here. */
function SeatPopup({ r, all, tables, rules, onClose }: { r: any; all: any[]; tables: any[]; rules: Rules; onClose: () => void }) {
  const { run, busy } = useCommand();
  const free = (x: any) => !x.occupancy && x.active;
  const own = tables.find((x) => x.id === r.tableId);
  const [tableId, setTableId] = useState<string>(own && free(own) ? own.id : '');
  const [guests, setGuests] = useState<number>(r.partySize);
  const now = clock.now();
  const seat = async () => {
    if (!tableId || busy) return;
    const out = await run<any>('Reservation.Seat', { params: { reservationId: r.id }, body: { tableId, guestCount: guests, expectedVersion: r.version } }, { success: t('جلس {n} على ترابيزة {tb}', { n: r.customerName, tb: tables.find((x) => x.id === tableId)?.name ?? '' }) });
    if (out) onClose();
  };
  return (
    <Popup open onClose={onClose} size="md" fb="seat-popup" title={<span className="flex items-center gap-2"><UserCheck className="w-5 h-5 text-[var(--success)]" />{t('إجلاس')} · {r.customerName}</span>}
      footer={<><Button variant="ghost" size="lg" onClick={onClose}>{t('رجوع')}</Button><Button variant="success" size="lg" loading={busy} disabled={!tableId} onClick={seat} data-fb="seat-confirm"><UserCheck className="w-4 h-4" />{t('إجلاس')}</Button></>}>
      <div className="space-y-3">
        <Group icon={<Users />} label={t('عدد الضيوف')}><PartyPicker value={guests} onChange={setGuests} /></Group>
        <Group label={t('الترابيزة')}>
          <div className="grid grid-cols-6 gap-1.5">
            {tables.map((x) => {
              const c = x.id === r.tableId ? { ok: true } : moveCheck(r, now, x.id, all, tables, rules, -Infinity);
              const can = free(x) && c.ok;
              return <button key={x.id} type="button" disabled={!can} title={!free(x) ? t('مشغولة') : c.reason} onClick={() => setTableId(x.id)} data-fb={`seat-table:${x.name}`}
                className={cn('min-h-[48px] rounded-xl border text-sm font-extrabold num leading-none disabled:opacity-30', tableId === x.id ? 'border-[var(--success)] bg-[color-mix(in_srgb,var(--success)_14%,transparent)] ring-2 ring-[var(--success)]' : 'surface-1 border-[var(--glass-border)]', x.id === r.tableId && 'border-[var(--primary)]')}>
                {x.name}<span className="block text-[10px] font-normal text-dim">{x.capacity}</span></button>;
            })}
          </div>
        </Group>
      </div>
    </Popup>
  );
}

/** A labelled group for composite controls (buttons inside a <label> would take its clicks). */
function Group({ label, icon, required, error, children }: { label: string; icon?: React.ReactNode; required?: boolean; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0" role="group" aria-label={label}>
      <span className="h-5 flex items-center gap-1.5 text-xs font-semibold text-soft leading-none whitespace-nowrap">{icon && <span className="shrink-0 text-dim flex items-center [&_svg]:w-3.5 [&_svg]:h-3.5">{icon}</span>}{label}{required && <span className="text-[var(--error)]" aria-hidden>*</span>}</span>
      {children}
      {error && <span className="text-[11px] text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{error}</span>}
    </div>
  );
}
