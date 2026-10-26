// F1 Kitchen display (KDS): tickets per station by round with timers coloured by the kitchen timing policy,
// rush, per-item bump, refire with a reason, move to another station, all-day counts, recall of delivered
// tickets and an expo view (all stations; a round is ready to serve when every station has it ready).
import React, { useMemo, useState } from 'react';
import { ChefHat, Clock, Play, Check, Truck, Undo2, AlertTriangle, Flame, RotateCcw, ArrowRightLeft, History, MoreVertical, LayoutList, ConciergeBell, Layers, CheckCircle2, Users } from 'lucide-react';
import { useQuery, useCommand } from '../app/hooks';
import { Section, StateBadge, Tabs, Pill, Button, Empty, useNow, Modal, Field, Select, Input, Banner } from '../ui';
import { t, L } from '../i18n';
import { cn, qty, time } from '../lib/format';
import { ALLERGEN_AR } from './order/MenuGrid';
import { Tech } from '../app/tech';

import { stationName } from '../demo/humanLog';
export const stationLabel = (n?: string | null) => stationName(n);
const OPS = ['Kitchen.Board', 'Kitchen.AdvanceTicket', 'TicketItem.Bump', 'Ticket.SetPriority', 'Ticket.Refire', 'Ticket.TransferStation', 'Ticket.Recall'];

type Tone = 'ok' | 'warn' | 'late';
const toneOf = (tk: any): Tone => (tk.late ? 'late' : tk.warn ? 'warn' : 'ok');
const TONE: Record<Tone, { bar: string; pill: 'success' | 'warning' | 'error'; ring: string }> = {
  ok: { bar: 'bg-emerald-500', pill: 'success', ring: 'border-transparent' },
  warn: { bar: 'bg-amber-400', pill: 'warning', ring: 'border-amber-400/60' },
  late: { bar: 'bg-red-500', pill: 'error', ring: 'border-red-500/70 animate-pulse-glow' },
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
  const cols: { id: string; title: string; tone: string }[] = [
    { id: 'NEW', title: t('جديد'), tone: 'border-cyan-400/60' },
    { id: 'IN_PROGRESS', title: t('بيتعمل'), tone: 'border-amber-400/60' },
    { id: 'READY', title: t('جاهز للتسليم'), tone: 'border-emerald-400/60' },
  ];
  const late = tickets.filter((x) => x.late && x.state !== 'READY').length;
  const rush = tickets.filter((x) => x.priority === 'RUSH' && x.state !== 'READY').length;
  return (
    <div data-screen="F1" className="h-full flex flex-col gap-3 min-h-0">
      <Section title={t('شاشة المطبخ')} badge={<StateBadge ops={OPS} />}
        sub={timing ? t('المستهدف {a} دقيقة · بتحمّر بعد {b} دقيقة', { a: timing.targetMinutes, b: timing.alertMinutes }) : ''}
        actions={<>
          <Tabs value={view} onChange={setView} tabs={[{ id: 'board', label: <span className="flex items-center gap-1.5"><LayoutList className="w-4 h-4" />{t('المحطات')}</span> }, { id: 'expo', label: <span className="flex items-center gap-1.5"><ConciergeBell className="w-4 h-4" />{t('الإكسبو (التسليم)')}</span> }]} />
          <Button size="sm" variant={showAllDay ? 'outline' : 'ghost'} onClick={() => setShowAllDay(!showAllDay)} data-fb="kds-allday-toggle"><Layers className="w-4 h-4" />{t('المطلوب كله')}</Button>
          <Button size="sm" variant="ghost" onClick={() => setRecall(true)} data-fb="kds-recall-open"><History className="w-4 h-4" />{t('اتسلّم مؤخراً')}</Button>
        </>} />
      {view === 'board' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={station} onChange={setStation} tabs={[{ id: 'ALL', label: <span>{t('كل المحطات')} <span className="num text-xs opacity-70">{all.length}</span></span> }, ...active.map((s: any) => ({ id: s.id, label: <span data-fb={`kds-station:${s.name}`}>{stationLabel(s.name)} <span className="num text-xs opacity-70">{all.filter((x) => x.stationId === s.id).length}</span></span> }))]} />
          <div className="flex-1" />
          {rush > 0 && <Pill tone="error"><Flame className="w-3 h-3" />{rush} {t('مستعجلة')}</Pill>}
          {late > 0 && <Pill tone="error"><AlertTriangle className="w-3 h-3" />{late} {t('متأخرة')}</Pill>}
          <span className="flex items-center gap-1.5 text-[11px] text-dim"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />{t('في الوقت')}<span className="w-2.5 h-2.5 rounded-full bg-amber-400 ms-2" />{t('قربت')}<span className="w-2.5 h-2.5 rounded-full bg-red-500 ms-2" />{t('متأخرة')}</span>
        </div>
      )}
      {showAllDay && view === 'board' && <AllDay tickets={tickets} />}
      {view === 'board' ? (
        <div className="flex-1 min-h-0 grid gap-3 grid-cols-1 md:grid-cols-3">
          {cols.map((c) => {
            const list = tickets.filter((x) => x.state === c.id);
            return (
              <div key={c.id} className={cn('rounded-2xl border-t-4 surface-1 flex flex-col min-h-[240px]', c.tone)} data-fb={`kds-col:${c.id}`}>
                <div className="px-3 py-2 font-bold flex items-center justify-between">{c.title}<Pill tone="neutral">{list.length}</Pill></div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {list.map((tk) => <Ticket key={tk.id} tk={tk} stations={active} reasons={reasons} showStation={station === 'ALL'} />)}
                  {!list.length && <Empty text={t('مفيش تذاكر')} />}
                </div>
              </div>
            );
          })}
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
    <div className="rounded-xl surface-1 border line px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-hide" data-fb="kds-allday">
      <span className="text-xs font-bold text-soft whitespace-nowrap flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{t('المطلوب دلوقتي')}:</span>
      {rows.map((r) => (
        <span key={r.name.ar} title={[...r.mods.entries()].map(([k, v]) => `${k} ×${v}`).join(' · ')} className="whitespace-nowrap inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg surface-2 border border-[var(--glass-border)] text-sm">
          <span className="num font-extrabold text-[var(--primary)] text-base">{r.qty}</span><span className="font-bold">{L(r.name)}</span>
          {r.mods.size > 0 && <span className="text-[10px] text-orange-300">{[...r.mods.entries()].slice(0, 2).map(([k, v]) => `${k} ${v}`).join('، ')}</span>}
        </span>
      ))}
    </div>
  );
}

function Ticket({ tk, stations, reasons, showStation, compact }: { tk: any; stations: any[]; reasons: Record<string, any>; showStation?: boolean; compact?: boolean }) {
  const { run, busy } = useCommand();
  const [menu, setMenu] = useState(false);
  const [dlg, setDlg] = useState<null | 'refire' | 'move' | 'history'>(null);
  const adv = (toState: string) => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState } });
  const bump = (it: any) => run('TicketItem.Bump', { params: { ticketId: tk.id, itemId: it.lineId }, body: {} });
  const rush = () => run('Ticket.SetPriority', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, priority: tk.priority === 'RUSH' ? 'NORMAL' : 'RUSH' } }, { success: tk.priority === 'RUSH' ? t('رجعت عادية') : t('التذكرة بقت مستعجلة — طلعت أول الطابور') });
  const tone = toneOf(tk);
  const where = tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : tk.channel === 'TAKEAWAY' ? t('تيك أواي') : tk.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر');
  return (
    <div data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} data-ticket-state={tk.state} data-priority={tk.priority} className={cn('relative rounded-xl glass overflow-hidden border-2', tk.state === 'READY' ? 'border-emerald-400/40' : TONE[tone].ring, tk.priority === 'RUSH' && tk.state !== 'READY' && 'ring-2 ring-red-500/60')}>
      <div className={cn('h-1.5', tk.state === 'READY' ? 'bg-emerald-400' : TONE[tone].bar)} />
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold text-lg flex items-center gap-1.5 flex-wrap">
              {tk.priority === 'RUSH' && <Pill tone="error"><Flame className="w-3 h-3" />{t('مستعجل')}</Pill>}
              {where}
              {tk.guestCount ? <span className="text-xs text-dim font-normal flex items-center gap-0.5"><Users className="w-3 h-3" />{tk.guestCount}</span> : null}
            </div>
            <div className="text-[11px] text-dim"><span className="num">#{tk.orderNumber}</span> · {t('الجولة')} {tk.round}{showStation ? ` · ${stationLabel(tk.stationName)}` : ''} · {tk.serverName}</div>
          </div>
          <div className="flex items-center gap-1">
            {tk.state === 'READY' ? <Pill tone="success"><CheckCircle2 className="w-3 h-3" />{t('مستني')} <span className="num">{tk.readyMinutes ?? 0}</span>{t('د')}</Pill>
              : <Pill tone={TONE[tone].pill}><Clock className="w-3 h-3" /><span className="num">{tk.ageMinutes}</span>/<span className="num">{tk.targetMinutes}</span>{t('د')}</Pill>}
            <button className="w-8 h-8 rounded-lg hover:surface-2 flex items-center justify-center" onClick={() => setMenu(!menu)} data-fb={`ticket-menu:${tk.orderNumber}:r${tk.round}`} aria-label={t('خيارات')}><MoreVertical className="w-4 h-4" /></button>
          </div>
        </div>
        {(tk.refireOf || tk.transferredFromName || tk.recalledAt) && (
          <div className="flex flex-wrap gap-1">
            {tk.refireOf && <Pill tone="violet"><RotateCcw className="w-3 h-3" />{t('إعادة')}: {L(tk.refireReasonText)}{tk.refireNote ? ` — ${tk.refireNote}` : ''}</Pill>}
            {tk.transferredFromName && <Pill tone="info"><ArrowRightLeft className="w-3 h-3" />{t('جاية من')} {stationLabel(tk.transferredFromName)}</Pill>}
            {tk.recalledAt && <Pill tone="warning"><Undo2 className="w-3 h-3" />{t('اترجعت')} {time(tk.recalledAt)}</Pill>}
          </div>
        )}
        {menu && (
          <div className="rounded-xl surface-2 border line p-1.5 grid grid-cols-2 gap-1" data-fb="ticket-menu">
            {tk.state !== 'READY' && <Button size="sm" variant={tk.priority === 'RUSH' ? 'ghost' : 'danger'} disabled={busy} onClick={() => { setMenu(false); rush(); }} data-fb="ticket-rush"><Flame className="w-3.5 h-3.5" />{tk.priority === 'RUSH' ? t('خليها عادية') : t('مستعجل')}</Button>}
            <Button size="sm" disabled={busy} onClick={() => { setMenu(false); setDlg('move'); }} data-fb="ticket-move"><ArrowRightLeft className="w-3.5 h-3.5" />{t('انقل لمحطة')}</Button>
            {tk.state === 'READY' && <Button size="sm" disabled={busy} onClick={() => { setMenu(false); setDlg('refire'); }} data-fb="ticket-refire"><RotateCcw className="w-3.5 h-3.5" />{t('اعمله تاني')}</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setMenu(false); setDlg('history'); }}><History className="w-3.5 h-3.5" />{t('اللي حصل')}</Button>
          </div>
        )}
        {!compact && (
          <div className="space-y-1.5">
            {tk.items.map((it: any) => (
              <div key={it.lineId} className={cn('text-sm rounded-lg px-1 -mx-1', it.status === 'CANCELLED' && 'line-through opacity-50', it.bumped && 'opacity-50')}>
                <div className="flex gap-2 items-center">
                  {it.status !== 'CANCELLED' && tk.state !== 'READY' && <button onClick={() => bump(it)} disabled={busy} data-fb={`ticket-item-bump:${it.name.ar}`} className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0', it.bumped ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-[var(--glass-border)] hover:border-emerald-400')} title={t('الصنف ده خلص')}>{it.bumped && <Check className="w-3.5 h-3.5" />}</button>}
                  <span className="num font-extrabold text-[var(--primary)]">{qty(it.quantity)}×</span><span className={cn('font-bold', it.bumped && 'line-through')}>{L(it.name)}</span>
                  {it.seat ? <span className="text-[10px] px-1 rounded bg-white/10">{t('كرسي')} {it.seat}</span> : null}{it.status === 'CANCELLED' && <Pill tone="error">{t('ملغي')}</Pill>}
                </div>
                {it.modifiers?.length > 0 && <div className="ps-7 text-xs text-orange-300">{it.modifiers.map((m: any) => L(m)).join(' · ')}</div>}
                {it.children?.length > 0 && <div className="ps-7 text-xs text-sky-300">{it.children.map((c: string, i: number) => <div key={i}>↳ {c}</div>)}</div>}
                {it.note && <div className="ps-7 text-xs text-amber-300">✎ {it.note}</div>}
                {it.allergens?.length > 0 && <div className="ps-7 text-xs font-extrabold text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{it.allergens.map((a: string) => ALLERGEN_AR[a] ?? a).join('، ')}</div>}
                {it.mods?.map((m: any, i: number) => <div key={i} className="ps-7 text-xs font-bold text-sky-300 bg-sky-500/10 rounded px-1 mt-0.5">{t('تعديل')}: {m.text} · <span className="num">{time(m.at)}</span></div>)}
              </div>
            ))}
          </div>
        )}
        {tk.siblings?.length > 0 && <div className="flex flex-wrap gap-1 text-[10px]">{tk.siblings.map((s: any) => <span key={s.id} className={cn('px-1.5 py-0.5 rounded border', s.state === 'READY' || s.state === 'DONE' ? 'border-emerald-400/50 text-emerald-300' : 'border-[var(--glass-border)] text-dim')}>{stationLabel(s.stationName)}: {s.state === 'READY' || s.state === 'DONE' ? t('جاهز') : t('لسه')}</span>)}</div>}
        <div className="flex gap-1.5 pt-1">
          {tk.state === 'NEW' && <Button size="sm" variant="primary" className="flex-1" disabled={busy} onClick={() => adv('IN_PROGRESS')} data-fb="ticket-start"><Play className="w-3.5 h-3.5" />{t('ابدأ')}</Button>}
          {(tk.state === 'NEW' || tk.state === 'IN_PROGRESS') && <Button size="sm" variant="success" className="flex-1" disabled={busy} onClick={() => adv('READY')} data-fb="ticket-ready"><Check className="w-3.5 h-3.5" />{t('جاهز')}</Button>}
          {tk.state === 'READY' && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => adv('IN_PROGRESS')} title={t('رجّعها للشغل')}><Undo2 className="w-3.5 h-3.5" /></Button><Button size="sm" className="flex-1" disabled={busy} onClick={() => adv('DONE')} data-fb="ticket-done"><Truck className="w-3.5 h-3.5" />{t('اتسلّم')}</Button></>}
        </div>
      </div>
      {dlg === 'refire' && <RefireDialog tk={tk} reasons={reasons} stations={stations} onClose={() => setDlg(null)} />}
      {dlg === 'move' && <MoveDialog tk={tk} stations={stations} onClose={() => setDlg(null)} />}
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
        <div className="text-sm">#{tk.orderNumber} · {t('الجولة')} {tk.round} · {t('دلوقتي على')} <b>{stationLabel(tk.stationName)}</b></div>
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
        <div key={`${first.orderId}:${first.round}`} className={cn('rounded-2xl glass p-3 space-y-2 border-2', ready ? 'border-emerald-400/70' : late ? 'border-red-500/60' : 'border-transparent')} data-fb={`expo:${first.orderNumber}:r${first.round}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-extrabold text-lg flex items-center gap-1.5">{rush && <Flame className="w-4 h-4 text-red-400" />}{first.tableName ? `${t('ترابيزة')} ${first.tableName}` : first.channel === 'TAKEAWAY' ? t('تيك أواي') : first.channel === 'DELIVERY' ? t('دليفري') : t('كاونتر')}</div>
              <div className="text-[11px] text-dim"><span className="num">#{first.orderNumber}</span> · {t('الجولة')} {first.round} · {first.serverName}</div>
            </div>
            <Pill tone={ready ? 'success' : late ? 'error' : 'neutral'}><Clock className="w-3 h-3" /><span className="num">{oldest}</span>{t('د')}</Pill>
          </div>
          <div className="space-y-1.5">
            {list.map((tk) => (
              <div key={tk.id} className="rounded-lg surface-1 px-2 py-1.5">
                <div className="flex items-center justify-between text-xs mb-0.5"><b>{stationLabel(tk.stationName)}</b>{tk.state === 'READY' ? <Pill tone="success">{t('جاهز')}</Pill> : <Pill tone={tk.late ? 'error' : tk.warn ? 'warning' : 'neutral'}>{tk.state === 'NEW' ? t('لسه ما بدأش') : t('بيتعمل')}</Pill>}</div>
                <div className="text-xs text-soft">{tk.items.filter((i: any) => i.status === 'ACTIVE').map((i: any) => `${qty(i.quantity)}× ${L(i.name)}`).join(' · ')}</div>
              </div>
            ))}
          </div>
          {ready ? <Button variant="success" className="w-full" disabled={busy} onClick={() => serve(list)} data-fb="expo-serve"><Truck className="w-4 h-4" />{t('كله جاهز — سلّم للويتر')}</Button>
            : <div className="text-xs text-dim text-center">{t('مستني')}: {list.filter((x) => x.state !== 'READY').map((x) => stationLabel(x.stationName)).join('، ')}</div>}
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
              <div className="font-bold text-sm">{tk.tableName ? `${t('ترابيزة')} ${tk.tableName}` : t('تيك أواي / كاونتر')} · <span className="num">#{tk.orderNumber}</span> · {t('الجولة')} {tk.round} · {stationLabel(tk.stationName)}</div>
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
