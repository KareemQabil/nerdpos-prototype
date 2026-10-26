// F1 Kitchen display (KDS): tickets per station by round with timers coloured by the kitchen timing policy,
// rush, per-item bump, refire with a reason, move to another station, all-day counts, recall of delivered
// tickets and an expo view (all stations; a round is ready to serve when every station has it ready).
import React, { useMemo, useState } from 'react';
import { ChefHat, Clock, Play, Check, Truck, Undo2, AlertTriangle, Flame, RotateCcw, ArrowRightLeft, History, MoreVertical, LayoutList, ConciergeBell, Layers, CheckCircle2, Users } from 'lucide-react';
import { useQuery, useCommand } from '../app/hooks';
import { StateBadge, Tabs, Pill, Button, Empty, EmptyState, Skeleton, SegmentedControl, useNow, Modal, Field, Select, Input, Banner } from '../ui';
import { t, L } from '../i18n';
import { cn, qty, time } from '../lib/format';
import { ALLERGEN_AR } from './order/MenuGrid';
import { Tech } from '../app/tech';

import { stationName } from '../demo/humanLog';
import { personName } from '../demo/people';
export const stationLabel = (n?: string | null) => stationName(n);
const OPS = ['Kitchen.Board', 'Kitchen.AdvanceTicket', 'TicketItem.Bump', 'Ticket.SetPriority', 'Ticket.Refire', 'Ticket.TransferStation', 'Ticket.Recall'];

type Tone = 'ok' | 'warn' | 'late';
const toneOf = (tk: any): Tone => (tk.late ? 'late' : tk.warn ? 'warn' : 'ok');
const TONE: Record<Tone, { color: string; pill: 'success' | 'warning' | 'error' }> = {
  ok: { color: 'var(--success)', pill: 'success' },
  warn: { color: 'var(--warning)', pill: 'warning' },
  late: { color: 'var(--error)', pill: 'error' },
};

export default function Kitchen() {
  useNow(10000);
  const stations = useQuery<any>('KitchenStation.List', { query: {} });
  const [station, setStation] = useState<string>('ALL');
  const [view, setView] = useState<'board' | 'expo'>('board');
  const [showAllDay, setShowAllDay] = useState(true);
  const [recall, setRecall] = useState(false);
  const board = useQuery<any>('Kitchen.Board', { query: { lifecycle: 'NEW,IN_PROGRESS,READY' } });
  const all: any[] = board.data?.items ?? [];
  const tickets = station === 'ALL' ? all : all.filter((x) => x.stationId === station);
  const timing = board.data?.timing;
  const reasons = board.data?.refireReasons ?? {};
  const active = (stations.data?.items ?? []).filter((s: any) => s.active);
  // cooking queue: rush first, then the oldest
  const cooking = tickets.filter((x) => x.state !== 'READY').sort((a, b) => Number(b.priority === 'RUSH') - Number(a.priority === 'RUSH') || b.ageMinutes - a.ageMinutes);
  const ready = tickets.filter((x) => x.state === 'READY').sort((a, b) => (b.readyMinutes ?? 0) - (a.readyMinutes ?? 0));
  const late = cooking.filter((x) => x.late).length;
  const rush = cooking.filter((x) => x.priority === 'RUSH').length;
  const loading = board.loading && !board.data;
  return (
    <div data-screen="F1" className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h1 className="text-[22px] font-extrabold tracking-tight flex items-center gap-2"><ChefHat className="w-6 h-6 text-[var(--primary)]" />{t('شاشة المطبخ')}</h1>
        <StateBadge ops={OPS} />
        {timing && <span className="text-xs text-dim">{t('المستهدف {a} دقيقة · بتحمّر بعد {b} دقيقة', { a: timing.targetMinutes, b: timing.alertMinutes })}</span>}
        <div className="flex-1" />
        <SegmentedControl value={view} onChange={setView} options={[{ id: 'board', label: t('المحطات'), icon: <LayoutList />, fb: 'kds-view:board' }, { id: 'expo', label: t('التسليم (الإكسبو)'), icon: <ConciergeBell />, fb: 'kds-view:expo' }]} />
        <Button size="sm" variant={showAllDay ? 'subtle' : 'ghost'} onClick={() => setShowAllDay(!showAllDay)} data-fb="kds-allday-toggle"><Layers className="w-4 h-4" />{t('المطلوب كله')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setRecall(true)} data-fb="kds-recall-open"><History className="w-4 h-4" />{t('اتسلّم مؤخرًا')}</Button>
      </div>
      {view === 'board' && (
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Tabs value={station} onChange={setStation} tabs={[{ id: 'ALL', label: <span>{t('كل المحطات')} <span className="num text-xs opacity-70">{all.length}</span></span> }, ...active.map((s: any) => ({ id: s.id, label: <span data-fb={`kds-station:${s.name}`}>{stationLabel(s.name)} <span className="num text-xs opacity-70">{all.filter((x) => x.stationId === s.id).length}</span></span> }))]} />
          <div className="flex-1" />
          {rush > 0 && <Pill tone="error"><Flame className="w-3 h-3" /><span className="num">{rush}</span> {t('مستعجلة')}</Pill>}
          {late > 0 && <Pill tone="error"><AlertTriangle className="w-3 h-3" /><span className="num">{late}</span> {t('متأخرة')}</Pill>}
          <span className="flex items-center gap-3 text-[11px] text-soft"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE.ok.color }} />{t('في الوقت')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE.warn.color }} />{t('قربت')}</span><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE.late.color }} />{t('متأخرة')}</span></span>
        </div>
      )}
      {showAllDay && view === 'board' && <AllDay tickets={tickets} />}
      {view === 'board' ? (
        <div className="flex-1 min-h-0 flex gap-3">
          <div className="flex-1 min-w-0 overflow-y-auto pe-1" data-fb="kds-col:ACTIVE">
            {loading ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
              : cooking.length ? (
                <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                  {cooking.map((tk) => <Ticket key={tk.id} tk={tk} stations={active} reasons={reasons} showStation={station === 'ALL'} />)}
                </div>
              ) : <EmptyState icon={<ChefHat />} title={t('مفيش طلبات بتتعمل دلوقتي')} text={t('أول ما الويتر أو الكاشير يبعت طلب هيظهر هنا على طول.')} />}
          </div>
          <div className="w-[min(300px,34%)] shrink-0 rounded-2xl border-t-4 surface-1 flex flex-col min-h-0" style={{ borderTopColor: TONE.ok.color }} data-fb="kds-col:READY">
            <div className="px-3 py-2.5 font-bold flex items-center justify-between"><span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-[var(--success)]" />{t('جاهز للتسليم')}</span><Pill tone={ready.length ? 'success' : 'neutral'}><span className="num">{ready.length}</span></Pill></div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {ready.map((tk) => <ReadyCard key={tk.id} tk={tk} stations={active} reasons={reasons} showStation={station === 'ALL'} />)}
              {!ready.length && <EmptyState compact icon={<ConciergeBell />} text={t('اللي يجهز هيستنى هنا لحد ما يتسلّم.')} />}
            </div>
          </div>
        </div>
      ) : <Expo tickets={all} />}
      {recall && <RecallDrawer onClose={() => setRecall(false)} stations={active} reasons={reasons} />}
    </div>
  );
}

/** "All day": how many of each item are still to cook on the screen right now. */
function AllDay({ tickets }: { tickets: any[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { name: any; qty: number; tickets: number; mods: Map<string, number> }>();
    for (const tk of tickets) {
      if (tk.state === 'READY') continue;
      for (const it of tk.items) {
        if (it.status === 'CANCELLED' || it.bumped) continue;
        const k = it.name.ar;
        const r = m.get(k) ?? { name: it.name, qty: 0, tickets: 0, mods: new Map() };
        r.qty += Number(it.quantity); r.tickets++;
        for (const md of it.modifiers ?? []) r.mods.set(L(md), (r.mods.get(L(md)) ?? 0) + Number(it.quantity));
        m.set(k, r);
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [tickets]);
  if (!rows.length) return null;
  return (
    <div className="shrink-0 rounded-2xl surface-1 border line px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-hide" data-fb="kds-allday">
      <span className="text-xs font-bold text-soft whitespace-nowrap flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{t('المطلوب دلوقتي')}</span>
      {rows.map((r) => (
        <span key={r.name.ar} title={[...r.mods.entries()].map(([k, v]) => `${k} ×${v}`).join(' · ')} className="whitespace-nowrap inline-flex items-center gap-2 px-3 h-10 rounded-xl bg-[var(--card-raised)] border border-[var(--glass-border)] text-sm">
          <span className="num font-extrabold text-[var(--primary)] text-xl leading-none">{r.qty}</span><span className="font-bold">{L(r.name)}</span>
          {r.mods.size > 0 && <span className="text-[11px] text-[var(--warning-text)]">{[...r.mods.entries()].slice(0, 2).map(([k, v]) => `${k} ${v}`).join(t('، '))}</span>}
        </span>
      ))}
    </div>
  );
}

const whereOf = (tk: any) => (tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : tk.channel === 'TAKEAWAY' ? t('تيك أواي') : tk.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر'));

function Ticket({ tk, stations, reasons, showStation }: { tk: any; stations: any[]; reasons: Record<string, any>; showStation?: boolean }) {
  const { run, busy } = useCommand();
  const [menu, setMenu] = useState(false);
  const [dlg, setDlg] = useState<null | 'refire' | 'move' | 'history'>(null);
  const adv = (toState: string) => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState } });
  const bump = (it: any) => run('TicketItem.Bump', { params: { ticketId: tk.id, itemId: it.lineId }, body: {} });
  const rush = () => run('Ticket.SetPriority', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, priority: tk.priority === 'RUSH' ? 'NORMAL' : 'RUSH' } }, { success: tk.priority === 'RUSH' ? t('رجعت عادية') : t('الطلب بقى مستعجل — طلع أول الطابور') });
  const tone = TONE[toneOf(tk)];
  const isRush = tk.priority === 'RUSH';
  return (
    <div data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} data-ticket-state={tk.state} data-priority={tk.priority} className={cn('relative rounded-2xl overflow-hidden border-2 bg-[var(--card-raised)] shadow-[0_8px_24px_-14px_rgba(0,0,0,.5)]', toneOf(tk) === 'late' && 'animate-pulse-glow')} style={{ borderColor: isRush ? 'var(--error)' : tone.color }}>
      {/* header: where + timer, coloured by the timing */}
      <div className="px-3 py-2 flex items-center gap-2" style={{ background: `color-mix(in srgb, ${tone.color} 22%, transparent)` }}>
        <div className="min-w-0 flex-1">
          <div className="font-extrabold text-xl leading-tight flex items-center gap-1.5 flex-wrap">
            {isRush && <span className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md bg-[var(--error)] text-white"><Flame className="w-3 h-3" />{t('مستعجل')}</span>}
            {whereOf(tk)}
            {tk.guestCount ? <span className="text-xs text-soft font-bold inline-flex items-center gap-0.5"><Users className="w-3.5 h-3.5" /><span className="num">{tk.guestCount}</span></span> : null}
          </div>
          <div className="text-[11px] text-soft"><span className="num">#{tk.orderNumber}</span> · {t('الدفعة')} <span className="num">{tk.round}</span>{showStation ? ` · ${stationLabel(tk.stationName)}` : ''}{tk.serverName ? ` · ${personName(null, tk.serverName)}` : ''}</div>
        </div>
        <div className="text-center shrink-0 leading-none" title={t('من {a} دقيقة — المستهدف {b}', { a: tk.ageMinutes, b: tk.targetMinutes })}>
          <div className="num font-extrabold text-2xl" style={{ color: tone.color }}>{tk.ageMinutes} <span className="text-xs">{t('د')}</span></div>
          <div className="text-[10px] text-dim num">/ {tk.targetMinutes}</div>
        </div>
        <button className="w-9 h-9 rounded-lg hover:bg-[var(--surface-3)] flex items-center justify-center shrink-0" onClick={() => setMenu(!menu)} data-fb={`ticket-menu:${tk.orderNumber}:r${tk.round}`} aria-label={t('خيارات')}><MoreVertical className="w-5 h-5" /></button>
      </div>
      <div className="p-3 space-y-2">
        {(tk.refireOf || tk.transferredFromName || tk.recalledAt) && (
          <div className="flex flex-wrap gap-1">
            {tk.refireOf && <Pill tone="violet"><RotateCcw className="w-3 h-3" />{t('إعادة')}: {L(tk.refireReasonText)}{tk.refireNote ? ` — ${tk.refireNote}` : ''}</Pill>}
            {tk.transferredFromName && <Pill tone="info"><ArrowRightLeft className="w-3 h-3" />{t('جاية من')} {stationLabel(tk.transferredFromName)}</Pill>}
            {tk.recalledAt && <Pill tone="warning"><Undo2 className="w-3 h-3" />{t('اترجعت')} <span className="num">{time(tk.recalledAt)}</span></Pill>}
          </div>
        )}
        {menu && (
          <div className="rounded-xl surface-2 border line p-1.5 grid grid-cols-2 gap-1" data-fb="ticket-menu">
            <Button size="sm" variant={isRush ? 'ghost' : 'danger'} disabled={busy} onClick={() => { setMenu(false); rush(); }} data-fb="ticket-rush"><Flame className="w-3.5 h-3.5" />{isRush ? t('خليها عادية') : t('مستعجل')}</Button>
            <Button size="sm" disabled={busy} onClick={() => { setMenu(false); setDlg('move'); }} data-fb="ticket-move"><ArrowRightLeft className="w-3.5 h-3.5" />{t('انقل لمحطة')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMenu(false); setDlg('history'); }}><History className="w-3.5 h-3.5" />{t('اللي حصل')}</Button>
          </div>
        )}
        <div className="space-y-1">
          {tk.items.map((it: any) => {
            const cancelled = it.status === 'CANCELLED';
            return (
              <button key={it.lineId} disabled={cancelled || busy} onClick={() => bump(it)} data-fb={`ticket-item-bump:${it.name.ar}`} title={it.bumped ? t('رجّع الصنف') : t('الصنف ده خلص')}
                className={cn('w-full text-start rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)] disabled:hover:bg-transparent', cancelled && 'opacity-50', it.bumped && 'opacity-45')}>
                <div className="flex gap-2 items-start">
                  <span className={cn('w-6 h-6 mt-0.5 rounded-md border-2 flex items-center justify-center shrink-0', it.bumped ? 'bg-[var(--success)] border-[var(--success)] text-white' : 'border-[var(--glass-border)]')}>{it.bumped && <Check className="w-4 h-4" />}</span>
                  <span className="num font-extrabold text-lg text-[var(--primary)] leading-6">{qty(it.quantity)}×</span>
                  <span className={cn('font-bold text-lg leading-6 flex-1 min-w-0', (it.bumped || cancelled) && 'line-through')}>{L(it.name)}</span>
                  {it.seat ? <span className="text-[11px] px-1.5 py-0.5 rounded-md surface-3 font-bold">{t('كرسي')} <span className="num">{it.seat}</span></span> : null}{cancelled && <Pill tone="error">{t('اتلغى')}</Pill>}
                </div>
                {it.modifiers?.length > 0 && <div className="ps-14 text-sm font-bold text-[var(--warning-text)]">{it.modifiers.map((m: any) => L(m)).join(' · ')}</div>}
                {it.children?.length > 0 && <div className="ps-14 text-sm text-[var(--info)]">{it.children.map((c: string, i: number) => <div key={i}>↳ {c}</div>)}</div>}
                {it.note && <div className="ps-14 text-sm font-bold text-[var(--warning-text)] flex items-center gap-1">✎ {it.note}</div>}
                {it.allergens?.length > 0 && <div className="ps-14 text-sm font-extrabold text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{it.allergens.map((a: string) => t(ALLERGEN_AR[a] ?? a)).join(t('، '))}</div>}
                {it.mods?.map((m: any, i: number) => <div key={i} className="ms-14 mt-0.5 text-sm font-bold text-[var(--info)] bg-[color-mix(in_srgb,var(--info)_12%,transparent)] rounded-md px-1.5">{t('تعديل')}: {m.text} · <span className="num">{time(m.at)}</span></div>)}
              </button>
            );
          })}
        </div>
        {tk.siblings?.length > 0 && <div className="flex flex-wrap gap-1 text-[11px]">{tk.siblings.map((s: any) => { const ok = s.state === 'READY' || s.state === 'DONE'; return <span key={s.id} className={cn('px-1.5 py-0.5 rounded-md border font-bold', ok ? 'border-[color-mix(in_srgb,var(--success)_45%,transparent)] text-[var(--success)]' : 'border-[var(--glass-border)] text-dim')}>{stationLabel(s.stationName)}: {ok ? t('جاهز') : t('لسه')}</span>; })}</div>}
        <div className="flex gap-1.5 pt-1">
          {tk.state === 'NEW' && <Button size="lg" variant="secondary" disabled={busy} onClick={() => adv('IN_PROGRESS')} data-fb="ticket-start"><Play className="w-4 h-4" />{t('ابدأ')}</Button>}
          {tk.state === 'IN_PROGRESS' && <span className="h-12 px-2 rounded-xl text-xs font-bold text-[var(--warning-text)] flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t('بيتعمل')}</span>}
          <Button size="lg" variant="success" className="flex-1" disabled={busy} onClick={() => adv('READY')} data-fb="ticket-ready"><Check className="w-5 h-5" />{t('جاهز')}</Button>
        </div>
      </div>
      {dlg === 'refire' && <RefireDialog tk={tk} reasons={reasons} stations={stations} onClose={() => setDlg(null)} />}
      {dlg === 'move' && <MoveDialog tk={tk} stations={stations} onClose={() => setDlg(null)} />}
      {dlg === 'history' && <HistoryDialog tk={tk} onClose={() => setDlg(null)} />}
    </div>
  );
}

/** A ready ticket waiting for pickup: compact, with "handed over", back to cooking and "make it again". */
function ReadyCard({ tk, stations, reasons, showStation }: { tk: any; stations: any[]; reasons: Record<string, any>; showStation?: boolean }) {
  const { run, busy } = useCommand();
  const [dlg, setDlg] = useState<null | 'refire' | 'history'>(null);
  const adv = (toState: string) => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState } });
  const waiting = tk.readyMinutes ?? 0;
  return (
    <div data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} data-ticket-state={tk.state} className="rounded-xl bg-[var(--card-raised)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="font-extrabold leading-tight">{whereOf(tk)}</div><div className="text-[11px] text-dim"><span className="num">#{tk.orderNumber}</span> · {t('الدفعة')} <span className="num">{tk.round}</span>{showStation ? ` · ${stationLabel(tk.stationName)}` : ''}</div></div>
        <Pill tone={waiting >= 5 ? 'warning' : 'success'}><Clock className="w-3 h-3" />{t('مستني')} <span className="num">{waiting}</span>{t('د')}</Pill>
      </div>
      <div className="text-sm text-soft leading-snug">{tk.items.filter((i: any) => i.status === 'ACTIVE').map((i: any) => `${qty(i.quantity)}× ${L(i.name)}`).join(' · ')}</div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => adv('IN_PROGRESS')} title={t('رجّعها للشغل')} aria-label={t('رجّعها للشغل')}><Undo2 className="w-3.5 h-3.5" /></Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDlg('refire')} data-fb="ticket-refire" title={t('اعمله تاني')}><RotateCcw className="w-3.5 h-3.5" /></Button>
        <Button size="sm" variant="primary" className="flex-1" disabled={busy} onClick={() => adv('DONE')} data-fb="ticket-done"><Truck className="w-3.5 h-3.5" />{t('اتسلّم')}</Button>
      </div>
      {dlg === 'refire' && <RefireDialog tk={tk} reasons={reasons} stations={stations} onClose={() => setDlg(null)} />}
      {dlg === 'history' && <HistoryDialog tk={tk} onClose={() => setDlg(null)} />}
    </div>
  );
}

export function RefireDialog({ tk, reasons, stations, onClose }: { tk: any; reasons: Record<string, any>; stations: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const activeItems = tk.items.filter((i: any) => i.status === 'ACTIVE');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [ids, setIds] = useState<string[]>(activeItems.map((i: any) => i.lineId));
  const [stationId, setStationId] = useState(tk.stationId);
  const submit = async () => { if (await run('Ticket.Refire', { params: { ticketId: tk.id }, body: { reason, note: note || undefined, itemLineIds: ids, stationId, expectedVersion: tk.version } }, { success: t('اتبعتت تذكرة جديدة مستعجلة للمطبخ') })) onClose(); };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><RotateCcw className="w-5 h-5" />{t('اعمله تاني')} · #{tk.orderNumber}</span>} badge={<StateBadge ops={['Ticket.Refire']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!reason || !ids.length || (reason === 'OTHER' && !note.trim())} onClick={submit} data-fb="refire-submit">{t('ابعت للمطبخ تاني')}</Button></>}>
      <div className="space-y-4">
        <Field label={t('ليه هيتعمل تاني؟')}>
          <div className="grid grid-cols-2 gap-1.5">{Object.entries(reasons).map(([k, v]: any) => <button key={k} onClick={() => setReason(k)} data-fb={`refire-reason:${k}`} className={cn('h-10 rounded-xl border text-sm px-2', reason === k ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1')}>{L(v)}</button>)}</div>
        </Field>
        {reason === 'OTHER' && <Field label={t('اكتب السبب')}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        {reason && reason !== 'OTHER' && <Field label={t('ملاحظة للمطبخ (اختياري)')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلاً: ويل دن المرة دي')} /></Field>}
        <Field label={t('الأصناف اللي هتتعمل تاني')}>
          <div className="space-y-1">{activeItems.map((it: any) => (
            <label key={it.lineId} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg surface-1 cursor-pointer">
              <input type="checkbox" checked={ids.includes(it.lineId)} onChange={(e) => setIds(e.target.checked ? [...ids, it.lineId] : ids.filter((x) => x !== it.lineId))} />
              <span className="num font-bold">{qty(it.quantity)}×</span>{L(it.name)}
            </label>
          ))}</div>
        </Field>
        <Field label={t('على أنهي محطة')}><Select value={stationId} onChange={(e) => setStationId(e.target.value)} options={stations.map((s) => ({ value: s.id, label: stationLabel(s.name) }))} /></Field>
        <Banner tone="info">{t('التذكرة الجديدة بتطلع مستعجلة وعليها السبب، والسبب بيتسجل في تاريخ الشيك وتقرير الاستثناءات. مفيش فلوس بتتغير على الزبون.')}</Banner>
      </div>
    </Modal>
  );
}

function MoveDialog({ tk, stations, onClose }: { tk: any; stations: any[]; onClose: () => void }) {
  const { run, busy } = useCommand();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const submit = async () => { const r = await run<any>('Ticket.TransferStation', { params: { ticketId: tk.id }, body: { toStationId: to, reason: reason || undefined, expectedVersion: tk.version } }, { success: t('التذكرة اتنقلت') }); if (r) onClose(); };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5" />{t('انقل التذكرة لمحطة تانية')}</span>} badge={<StateBadge ops={['Ticket.TransferStation']} />}
      footer={<><Button variant="ghost" onClick={onClose}>{t('رجوع')}</Button><Button variant="primary" loading={busy} disabled={!to} onClick={submit} data-fb="move-submit">{t('انقل')}</Button></>}>
      <div className="space-y-3">
        <div className="text-sm">#{tk.orderNumber} · {t('الدفعة')} {tk.round} · {t('دلوقتي على')} <b>{stationLabel(tk.stationName)}</b></div>
        <div className="grid grid-cols-2 gap-2">{stations.filter((s) => s.id !== tk.stationId).map((s) => <button key={s.id} onClick={() => setTo(s.id)} data-fb={`move-to:${s.name}`} className={cn('h-14 rounded-xl border font-bold', to === s.id ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'border-[var(--glass-border)] surface-1')}>{stationLabel(s.name)}</button>)}</div>
        <Field label={t('السبب (اختياري)')}><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('مثلاً: الشوّاية زحمة')} /></Field>
        <div className="text-[11px] text-dim">{t('لو المحطة التانية عندها تذكرة لنفس الطلب ونفس الجولة، الأصناف بتنضم لها بدل ما تطلع تذكرتين.')}</div>
      </div>
    </Modal>
  );
}

function HistoryDialog({ tk, onClose }: { tk: any; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${t('اللي حصل للتذكرة')} #${tk.orderNumber}`}>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span>{t('وصلت المطبخ')}</span><span className="num">{time(tk.createdAt)}</span></div>
        {tk.startedAt && <div className="flex justify-between"><span>{t('بدأت')}</span><span className="num">{time(tk.startedAt)}</span></div>}
        {tk.readyAt && <div className="flex justify-between"><span>{t('جهزت')}</span><span className="num">{time(tk.readyAt)}</span></div>}
        {(tk.history ?? []).map((h: any, i: number) => <div key={i} className="flex justify-between gap-2 border-t line pt-2"><span>{L(h.text)}</span><span className="num text-dim">{time(h.at)}</span></div>)}
        <Tech><div className="num text-[10px] text-dim">{tk.id} · v{tk.version}</div></Tech>
      </div>
    </Modal>
  );
}

/** Expo: every open round across stations. A round is ready to serve when all its stations have it ready. */
function Expo({ tickets }: { tickets: any[] }) {
  const { run, busy } = useCommand();
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const tk of tickets) { const k = `${tk.orderId}:${tk.round}`; m.set(k, [...(m.get(k) ?? []), tk]); }
    return [...m.values()].map((list) => ({ list, ready: list.every((x) => x.state === 'READY'), first: list[0], oldest: Math.max(...list.map((x) => x.ageMinutes)), rush: list.some((x) => x.priority === 'RUSH'), late: list.some((x) => x.late && x.state !== 'READY') }))
      .sort((a, b) => Number(b.ready) - Number(a.ready) || Number(b.rush) - Number(a.rush) || b.oldest - a.oldest);
  }, [tickets]);
  const serve = async (list: any[]) => { for (const tk of list) await run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'DONE' } }); };
  if (!groups.length) return <Empty icon={<ChefHat className="w-10 h-10 opacity-40" />} text={t('مفيش طلبات في المطبخ دلوقتي')} />;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto grid gap-3 content-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }} data-fb="kds-expo">
      {groups.map(({ list, ready, first, oldest, rush, late }) => (
        <div key={`${first.orderId}:${first.round}`} className={cn('rounded-2xl bg-[var(--card-raised)] p-3 space-y-2 border-2', ready ? 'border-[var(--success)]' : late ? 'border-[var(--error)]' : 'border-[var(--glass-border)]')} data-fb={`expo:${first.orderNumber}:r${first.round}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-extrabold text-xl flex items-center gap-1.5">{rush && <Flame className="w-4 h-4 text-[var(--error)]" />}{first.tableName ? `${t('ترابيزة')} ${first.tableName}` : first.channel === 'TAKEAWAY' ? t('تيك أواي') : first.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')}</div>
              <div className="text-[11px] text-dim"><span className="num">#{first.orderNumber}</span> · {t('الدفعة')} {first.round} · {first.serverName ? personName(null, first.serverName) : ''}</div>
            </div>
            <Pill tone={ready ? 'success' : late ? 'error' : 'neutral'}><Clock className="w-3 h-3" /><span className="num">{oldest}</span>{t('د')}</Pill>
          </div>
          <div className="space-y-1.5">
            {list.map((tk) => (
              <div key={tk.id} className="rounded-lg surface-1 px-2 py-1.5">
                <div className="flex items-center justify-between text-xs mb-0.5"><b>{stationLabel(tk.stationName)}</b>{tk.state === 'READY' ? <Pill tone="success">{t('جاهز')}</Pill> : <Pill tone={tk.late ? 'error' : tk.warn ? 'warning' : 'neutral'}>{tk.state === 'NEW' ? t('لسه ما بدأش') : t('بيتعمل')}</Pill>}</div>
                <div className="text-sm text-soft">{tk.items.filter((i: any) => i.status === 'ACTIVE').map((i: any) => `${qty(i.quantity)}× ${L(i.name)}`).join(' · ')}</div>
              </div>
            ))}
          </div>
          {ready ? <Button variant="success" size="lg" className="w-full" disabled={busy} onClick={() => serve(list)} data-fb="expo-serve"><Truck className="w-4 h-4" />{t('كله جاهز — سلّم للويتر')}</Button>
            : <div className="text-xs text-dim text-center">{t('مستني')}: {list.filter((x) => x.state !== 'READY').map((x) => stationLabel(x.stationName)).join(t('، '))}</div>}
        </div>
      ))}
    </div>
  );
}

function RecallDrawer({ onClose, stations, reasons }: { onClose: () => void; stations: any[]; reasons: Record<string, any> }) {
  const q = useQuery<any>('Kitchen.Board', { query: { lifecycle: 'DONE', doneWithinMinutes: 120 } });
  const { run, busy } = useCommand();
  const [refire, setRefire] = useState<any>(null);
  const items = [...(q.data?.items ?? [])].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return (
    <Modal open onClose={onClose} wide title={<span className="flex items-center gap-2"><History className="w-5 h-5" />{t('اتسلّم في آخر ساعتين')}</span>} badge={<StateBadge ops={['Ticket.Recall', 'Ticket.Refire']} />}>
      <div className="space-y-2" data-fb="kds-recall">
        {!items.length && <Empty text={t('مفيش تذاكر اتسلمت قريب')} />}
        {items.map((tk) => (
          <div key={tk.id} className="flex items-center gap-3 px-3 py-2 rounded-xl surface-1 border line">
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : t('تيك أواي / كاونتر')} · <span className="num">#{tk.orderNumber}</span> · {t('الدفعة')} {tk.round} · {stationLabel(tk.stationName)}</div>
              <div className="text-xs text-dim truncate">{tk.items.filter((i: any) => i.status === 'ACTIVE').map((i: any) => `${qty(i.quantity)}× ${L(i.name)}`).join(' · ')}</div>
            </div>
            <span className="num text-xs text-dim">{time(tk.doneAt)}</span>
            <Button size="sm" disabled={busy} onClick={() => run('Ticket.Recall', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version } }, { success: t('التذكرة رجعت للشاشة') })} data-fb={`recall:${tk.orderNumber}:r${tk.round}`}><Undo2 className="w-3.5 h-3.5" />{t('رجّعها')}</Button>
            <Button size="sm" variant="outline" onClick={() => setRefire(tk)} data-fb={`recall-refire:${tk.orderNumber}:r${tk.round}`}><RotateCcw className="w-3.5 h-3.5" />{t('اعمله تاني')}</Button>
          </div>
        ))}
      </div>
      {refire && <RefireDialog tk={refire} reasons={reasons} stations={stations} onClose={() => setRefire(null)} />}
    </Modal>
  );
}
