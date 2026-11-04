// F1 Kitchen display (KDS), touch or bump bar. Designed for 22" (1920×1080) and 15" (1366×768) landscape screens.
// - Station screen (شيف محطة): large tickets of its stations; tap the header = the ticket is ready (sent to dispatch),
//   tap an item = that item is ready (when the screen allows per-item bump); «بدء» per the screen policy; the timer runs
//   from arrival with the screen's colour thresholds; voided items struck through and flagged; priority, recalled and
//   re-fired tickets marked. The all-day panel is fixed on the side (never scrolls away).
// - Dispatch screen (منسق التسليم): orders grouped with every station's readiness; «جاهز للتسليم», «تسليم» and «نداء»
//   (to the call board) only here — the server enforces KDS_DISPATCH_ONLY.
// - Undo the last bump for a few seconds; recall recently bumped tickets; sound on a new ticket and when one turns late
//   (mute per screen; browsers allow sound only after the first touch).
// - Bump bar: a keyboard map per screen (↑/↓ or ←/→ move, 1–9 pick, Enter bump, Space item, + start, * priority,
//   ⌫ undo, 0 recall, − call, / view), remappable in the «?» overlay with swap-on-conflict (app/keymap.ts, scope kds).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChefHat, Undo2, AlertTriangle, Flame, History, LayoutGrid, Layers, ConciergeBell, Volume2, VolumeX, Keyboard, X, Truck, RotateCcw, ArrowRightLeft, Trash2, PackageX, CheckCircle2, Clock } from 'lucide-react';
import { useDev, useQuery, useCommand } from '../app/hooks';
import { StateBadge, Tabs, Pill, Button, Empty, EmptyState, Skeleton, SegmentedControl, useNow, Modal, Popup, Field, Select, Input, Banner, Kbd, toast } from '../ui';
import { t, L } from '../i18n';
import { cn, qty, time } from '../lib/format';
import { Tech } from '../app/tech';
import { stationName } from '../demo/humanLog';
import { profileById } from '../app/profiles';
import { useProfile } from '../app/useProfile';
import { useHotkeys, useKeymap, keyLabel, type KeyAction } from '../app/keymap';
import { cue, useSound } from '../app/sound';
import { ShortcutsOverlay } from './cashier/ShortcutsOverlay';
import { TicketCard, toneOf, headline } from './kitchen/TicketCard';
import { DispatchBoard, groupOrders, type OrderGroup } from './kitchen/DispatchBoard';

export const stationLabel = (n?: string | null) => stationName(n);
const OPS = ['Kitchen.Board', 'Kitchen.AdvanceTicket', 'TicketItem.Bump', 'Ticket.SetPriority', 'Ticket.Refire', 'Ticket.TransferStation', 'Ticket.Recall', 'Kitchen.CallOrder'];
type View = 'orders' | 'tickets';
type UndoAction = { id: number; text: string; run: () => Promise<any> };

export default function Kitchen() {
  useNow(1000);
  const { id: deviceId, me, can, nav } = useDev();
  const stations = useQuery<any>('KitchenStation.List', { query: {} });
  const board = useQuery<any>('Kitchen.Board', { query: { lifecycle: 'NEW,IN_PROGRESS,READY' } });
  const { run, busy } = useCommand();
  const all: any[] = board.data?.items ?? [];
  const screen = board.data?.screen ?? { stationIds: [], canHandOff: true, dispatch: true, start: 'HIDDEN', isKds: false, itemBump: true };
  const dispatch: boolean = !!screen.canHandOff;
  const startPolicy: 'HIDDEN' | 'OPTIONAL' | 'REQUIRED' = screen.start ?? 'HIDDEN';
  const itemBump = screen.itemBump !== false;
  const base = useProfile('KDS'); // ux-09: role or the user's override, read as a kitchen screen
  const profile = base.id === 'stationChef' && dispatch && screen.isKds ? profileById('expediter') : base;
  const active = (stations.data?.items ?? []).filter((s: any) => s.active);
  const mine = screen.stationIds?.length ? active.filter((s: any) => screen.stationIds.includes(s.id)) : active;
  const own = all.filter((x) => x.onMyScreen !== false);
  const [station, setStation] = useState<string>('ALL');
  const [view, setView] = useState<View>('tickets');
  // the first board says which screen this is: the expediter (and the kitchen manager) start on the grouped orders
  const viewSet = useRef(false);
  useEffect(() => { if (!board.data || !me || viewSet.current) return; viewSet.current = true; setView(dispatch && profile.id !== 'stationChef' ? 'orders' : 'tickets'); }, [board.data, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const v: View = dispatch ? view : 'tickets';
  const tickets = station === 'ALL' || !mine.some((s: any) => s.id === station) ? own : own.filter((x) => x.stationId === station);
  // cooking queue: priority first, then the oldest
  const cooking = useMemo(() => tickets.filter((x) => x.state !== 'READY').sort((a, b) => Number(b.priority === 'RUSH') - Number(a.priority === 'RUSH') || Number(a.createdAtMs) - Number(b.createdAtMs)), [tickets]);
  const ready = (dispatch && station === 'ALL' ? all : tickets).filter((x) => x.state === 'READY').sort((a, b) => String(a.readyAt).localeCompare(String(b.readyAt)));
  const groups = useMemo(() => groupOrders(all), [all]);
  const late = cooking.filter((x) => toneOf(x) === 'late').length;
  const rush = cooking.filter((x) => x.priority === 'RUSH').length;
  const loading = board.loading && !board.data;
  const single = mine.length === 1 ? mine[0] : null;
  const showStation = mine.length > 1 && station === 'ALL';
  const timing = board.data?.timing;
  const reasons = board.data?.refireReasons ?? {};
  const keys = useKeymap(deviceId, 'kds', profile.kdsKeys);
  const snd = useSound(deviceId);

  // ── selection (bump bar) over the visible list
  const list: any[] = v === 'orders' ? groups : cooking;
  const [sel, setSel] = useState(0);
  const selIdx = list.length ? Math.min(sel, list.length - 1) : -1;
  // ── undo the last bump (a few seconds)
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const undoSeq = useRef(0);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerUndo = (u: Omit<UndoAction, 'id'>) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const id = ++undoSeq.current;
    setUndo({ ...u, id });
    undoTimer.current = setTimeout(() => setUndo((x) => (x?.id === id ? null : x)), 8000);
  };
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  const latest = useRef(all);
  latest.current = all;
  const fresh = (id: string) => latest.current.find((x) => x.id === id);
  const runUndo = async () => { const u = undo; if (!u) return; setUndo(null); await u.run(); };

  // ── actions
  const bumpTicket = async (tk: any) => {
    if (startPolicy === 'REQUIRED' && tk.state === 'NEW') { toast('warning', t('اضغط «بدء» أولًا')); return; }
    const r = await run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'READY' } });
    if (r) offerUndo({ text: t('جاهز: {w}', { w: headline(tk) }), run: async () => { const cur = fresh(tk.id); if (!cur || cur.state !== 'READY') { toast('warning', t('تعذر التراجع: تغيرت التذكرة')); return null; } return run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: cur.version, toState: 'IN_PROGRESS' } }, { success: t('تم التراجع') }); } });
  };
  const bumpItem = async (tk: any, it: any) => {
    const r = await run('TicketItem.Bump', { params: { ticketId: tk.id, itemId: it.lineId }, body: {} });
    if (r) offerUndo({ text: `${it.bumped ? t('إلغاء التجهيز') : t('جاهز')}: ${L(it.name)}`, run: () => run('TicketItem.Bump', { params: { ticketId: tk.id, itemId: it.lineId }, body: {} }, { success: t('تم التراجع') }) });
  };
  const bumpNextItem = (tk: any) => { const it = tk.items.find((i: any) => i.status !== 'CANCELLED' && !i.bumped); if (it && itemBump) bumpItem(tk, it); };
  const start = (tk: any) => tk.state === 'NEW' && startPolicy !== 'HIDDEN' && run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } });
  const priority = async (tks: any[]) => {
    const on = !tks.some((x) => x.priority === 'RUSH');
    for (const tk of tks) { const cur = fresh(tk.id) ?? tk; await run('Ticket.SetPriority', { params: { ticketId: tk.id }, body: { expectedVersion: cur.version, priority: on ? 'RUSH' : 'NORMAL' } }, { success: on ? t('أصبحت التذكرة أولوية — في أول الطابور') : t('أُلغيت الأولوية') }); }
  };
  const serve = async (g: OrderGroup) => {
    if (!g.ready) { toast('warning', t('بانتظار: {s}', { s: g.list.filter((x) => x.state !== 'READY').map((x) => stationName(x.stationName)).join(t('، ')) })); return; }
    const done: string[] = [];
    for (const tk of g.list) { const cur = fresh(tk.id) ?? tk; if (await run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: cur.version, toState: 'DONE' } })) done.push(tk.id); }
    if (done.length) offerUndo({ text: t('سُلِّم: {w}', { w: headline(g.first) }), run: async () => { for (const id of done) await run('Ticket.Recall', { params: { ticketId: id }, body: { undo: true } }); toast('success', t('تم التراجع')); return true; } });
  };
  const call = (g: OrderGroup) => g.byNumber && run('Kitchen.CallOrder', { params: { orderId: g.first.orderId }, body: {} }, { success: g.calledAt ? t('أُعيد النداء على الرقم {n}', { n: g.first.shortNo ?? g.first.orderNumber }) : t('نودي على الرقم {n}', { n: g.first.shortNo ?? g.first.orderNumber }) });

  // ── dialogs
  const [dlg, setDlg] = useState<null | { k: 'move' | 'history' | 'refire'; tk: any }>(null);
  const [recall, setRecall] = useState(false);
  const [help, setHelp] = useState(false);
  const onMenu = (tk: any) => (a: 'priority' | 'move' | 'history') => (a === 'priority' ? priority([tk]) : setDlg({ k: a, tk }));

  // ── bump bar / keyboard
  const selected = selIdx >= 0 ? list[selIdx] : null;
  const move = (d: number) => list.length && setSel((i) => (Math.min(i, list.length - 1) + d + list.length) % list.length);
  useHotkeys(deviceId, !help && !recall && !dlg, {
    kdsNext: () => move(1), kdsPrev: () => move(-1),
    kdsBump: () => selected && (v === 'orders' ? serve(selected) : bumpTicket(selected)),
    kdsBumpItem: () => selected && v === 'tickets' && bumpNextItem(selected),
    kdsStart: () => selected && v === 'tickets' && start(selected),
    kdsPriority: () => selected && priority(v === 'orders' ? (selected as OrderGroup).list : [selected]),
    kdsUndo: () => runUndo(),
    kdsRecall: () => setRecall(true),
    kdsCall: () => selected && v === 'orders' && (selected as OrderGroup).ready && call(selected),
    kdsView: () => dispatch && setView((x) => (x === 'orders' ? 'tickets' : 'orders')),
    kdsHelp: () => setHelp(true), shortcuts: () => setHelp(true),
  }, 'kds', profile.kdsKeys);
  // fixed keys: ←/→ move visually (reading direction aware), 1–9 pick a ticket
  const fixedRef = useRef({ move, list, setSel });
  fixedRef.current = { move, list, setSel };
  useEffect(() => {
    if (help || recall || dlg) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (document.querySelector('[role="dialog"], [role="menu"]') || !document.querySelector(`[data-device="${deviceId}"] [data-screen="F1"]`)) return;
      const rtl = document.documentElement.dir !== 'ltr';
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); fixedRef.current.move((e.key === 'ArrowLeft') === rtl ? 1 : -1); return; }
      if (/^[1-9]$/.test(e.key) && Number(e.key) <= fixedRef.current.list.length) { e.preventDefault(); fixedRef.current.setSel(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [help, recall, dlg, deviceId]);

  // ── sound: a new ticket on this screen, a ticket turning late
  const known = useRef<Set<string> | null>(null);
  const lateSeen = useRef<Set<string>>(new Set());
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!board.data) return;
    const ids = new Set(own.filter((x) => x.state !== 'READY').map((x) => x.id));
    if (known.current) {
      const added = [...ids].filter((id) => !known.current!.has(id));
      if (added.length) { cue('new', deviceId); setArrived(new Set(added)); setTimeout(() => setArrived(new Set()), 1500); }
    } else for (const x of own) if (toneOf(x) === 'late') lateSeen.current.add(x.id); // already late when the screen opened: no alarm
    known.current = new Set([...(known.current ?? []), ...ids]);
  }, [board.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const lateIds = cooking.filter((x) => toneOf(x) === 'late').map((x) => x.id).join(',');
  useEffect(() => {
    if (!known.current) return;
    const turned = cooking.filter((x) => toneOf(x) === 'late' && !lateSeen.current.has(x.id));
    turned.forEach((x) => lateSeen.current.add(x.id));
    if (turned.length) cue('late', deviceId);
  }, [lateIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const kLabel = (a: KeyAction) => keyLabel(keys[a]);
  const labels: Partial<Record<KeyAction, string>> = {
    kdsNext: t('التذكرة التالية'), kdsPrev: t('التذكرة السابقة'), kdsBump: dispatch ? t('جاهز / تسليم المحددة') : t('جاهز للتذكرة المحددة'), kdsBumpItem: t('تجهيز الصنف التالي'), kdsStart: t('بدء التحضير'),
    kdsPriority: t('أولوية'), kdsUndo: t('تراجع عن آخر خطوة'), kdsRecall: t('استعادة تذكرة'), kdsCall: t('نداء الرقم'), kdsView: t('تبديل العرض'), kdsHelp: t('عرض الاختصارات'),
  };
  const title = single && !dispatch ? t('محطة {s}', { s: stationLabel(single.name) }) /* ux-07: a station screen is named «محطة …» (the device «محطة المشويات») */ : dispatch && screen.isKds ? t('شاشة التسليم') : t('شاشة المطبخ');
  return (
    <div data-screen="F1" data-kds-dispatch={dispatch ? '1' : '0'} data-kds-start={startPolicy} data-kds-view={v} data-profile={profile.id} className="relative -m-5 h-[calc(100%+2.5rem)] flex flex-col min-h-0 p-3 gap-3">
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">
        <h1 className="text-[22px] font-extrabold tracking-tight flex items-center gap-2"><ChefHat className="w-6 h-6 text-[var(--primary)]" />{title}</h1>
        <StateBadge ops={OPS} />
        <Pill tone={dispatch ? 'success' : 'neutral'} data-fb="kds-role">{L(profile.role)}</Pill>
        <span className="h-9 px-3 rounded-xl surface-1 border border-[var(--glass-border)] inline-flex items-center gap-1.5 text-sm font-bold" data-fb="kds-count"><Layers className="w-4 h-4 text-soft" /><span className="num">{v === 'orders' ? groups.length : cooking.length}</span></span>
        {rush > 0 && <span className="h-9 px-3 rounded-xl bg-[var(--error)] text-white inline-flex items-center gap-1.5 text-sm font-extrabold"><Flame className="w-4 h-4" /><span className="num">{rush}</span>{t('أولوية')}</span>}
        {late > 0 && <span className="h-9 px-3 rounded-xl border-2 border-[var(--error)] text-[var(--error)] inline-flex items-center gap-1.5 text-sm font-extrabold"><AlertTriangle className="w-4 h-4" /><span className="num">{late}</span>{t('متأخرة')}</span>}
        {timing && <Legend warn={timing.targetMinutes} late={timing.alertMinutes} />}
        <div className="flex-1" />
        {dispatch && <SegmentedControl size="lg" value={view} onChange={setView} options={[{ id: 'orders', label: t('تجميع الطلبات'), icon: <ConciergeBell />, fb: 'kds-view:expo' }, { id: 'tickets', label: t('التذاكر'), icon: <LayoutGrid />, fb: 'kds-view:board' }]} />}
        {profile.id === 'kitchenManager' && <>
          {can('stock:recordwaste') && <Button size="lg" variant="ghost" onClick={() => nav('inv-waste')} data-fb="kds-waste"><Trash2 className="w-4 h-4" />{t('الهالك')}</Button>}
          <Button size="lg" variant="ghost" onClick={() => nav('soldout')} data-fb="kds-soldout"><PackageX className="w-4 h-4" />{t('نفد اليوم')}</Button>
        </>}
        <Button size="lg" variant="secondary" onClick={() => setRecall(true)} data-fb="kds-recall-open"><History className="w-5 h-5" />{t('استعادة')}<Kbd>{kLabel('kdsRecall')}</Kbd></Button>
        <button onClick={() => snd.setMuted(!snd.muted)} data-fb="kds-mute" aria-pressed={snd.muted} title={snd.muted ? t('تشغيل الصوت') : t('كتم الصوت')} aria-label={snd.muted ? t('تشغيل الصوت') : t('كتم الصوت')} className={cn('h-12 w-12 rounded-xl border flex items-center justify-center', snd.muted ? 'border-[var(--error)] text-[var(--error)]' : 'border-[var(--glass-border)] surface-1 text-soft')}>{snd.muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}</button>
        <button onClick={() => setHelp(true)} data-fb="kds-help" title={t('اختصارات شاشة المطبخ')} aria-label={t('اختصارات شاشة المطبخ')} className="h-12 w-12 rounded-xl border border-[var(--glass-border)] surface-1 text-soft text-lg font-black flex items-center justify-center">?</button>
      </div>
      {v === 'tickets' && mine.length > 1 && (
        <div className="shrink-0">
          <Tabs value={station} onChange={setStation} tabs={[{ id: 'ALL', label: <span>{screen.stationIds?.length ? t('محطاتي') : t('كل المحطات')} <span className="num text-xs opacity-70">{own.filter((x) => x.state !== 'READY').length}</span></span> }, ...mine.map((s: any) => ({ id: s.id, label: <span data-fb={`kds-station:${s.name}`}>{stationLabel(s.name)} <span className="num text-xs opacity-70">{own.filter((x) => x.stationId === s.id && x.state !== 'READY').length}</span></span> }))]} />
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* the all-day box: a fixed panel, always in view (never scrolls away with the tickets) — E06 */}
        <AllDay tickets={tickets} sentToDispatch={dispatch ? null : ready} />
        <div className="flex-1 min-w-0 overflow-y-auto p-1.5 pb-24" data-fb="kds-col:ACTIVE">
          {loading ? <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}</div>
            : v === 'orders' ? <DispatchBoard groups={groups} sel={selIdx} onSelect={setSel} onServe={serve} onCall={call} busy={busy} keys={{ bump: kLabel('kdsBump'), call: kLabel('kdsCall') }} />
              : cooking.length ? (
                <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))' }}>
                  {cooking.map((tk, i) => <TicketCard key={tk.id} tk={tk} index={i} selected={i === selIdx} onSelect={() => setSel(i)} onBump={() => bumpTicket(tk)} onBumpItem={(it) => bumpItem(tk, it)} onStart={() => start(tk)} onMenu={onMenu(tk)} startPolicy={startPolicy} itemBump={itemBump} dispatch={dispatch} showStation={showStation} busy={busy} fresh={arrived.has(tk.id)} keys={{ bump: kLabel('kdsBump') }} />)}
                </div>
              ) : <EmptyState icon={<ChefHat />} title={t('لا توجد طلبات قيد التحضير')} />}
        </div>
        {/* "ready for hand-off" exists only on the dispatch screen (F3-02) */}
        {dispatch && v === 'tickets' && (
          <div className="w-[min(300px,28%)] shrink-0 rounded-2xl border-t-4 border-[var(--success)] surface-1 flex flex-col min-h-0" data-fb="kds-col:READY">
            <div className="px-3 py-2.5 font-bold flex items-center justify-between"><span className="flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-[var(--success)]" />{t('جاهز للتسليم')}</span><Pill tone={ready.length ? 'success' : 'neutral'}><span className="num">{ready.length}</span></Pill></div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {ready.map((tk) => <ReadyCard key={tk.id} tk={tk} showStation={mine.length > 1} onServe={() => { const g = groups.find((x) => x.list.some((y) => y.id === tk.id)); if (g) serve(g); }} onBack={() => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } })} onRefire={() => setDlg({ k: 'refire', tk })} busy={busy} />)}
              {!ready.length && <div className="text-sm text-dim text-center py-8">—</div>}
            </div>
          </div>
        )}
      </div>

      {undo && (
        <div className="absolute z-[60] bottom-4 end-4 w-[min(440px,calc(100%-2rem))] undo-in" data-fb="undo-toast" role="status" aria-live="polite">
          <div className="toast-card rounded-2xl ps-4 pe-1.5 py-1.5 flex items-center gap-2 shadow-lg">
            <span className="flex-1 min-w-0 text-base font-bold truncate">{undo.text}</span>
            <button onClick={runUndo} data-fb="kds-undo" className="h-12 px-4 rounded-xl font-extrabold text-[var(--primary)] hover:bg-[var(--surface-2)] inline-flex items-center gap-1.5 shrink-0"><Undo2 className="w-5 h-5" />{t('تراجع')}<Kbd>{kLabel('kdsUndo')}</Kbd></button>
            <button onClick={() => setUndo(null)} className="w-10 h-10 rounded-lg flex items-center justify-center text-dim hover:bg-[var(--surface-2)] shrink-0" aria-label={t('إغلاق')}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {recall && <RecallPopup onClose={() => setRecall(false)} stations={active} reasons={reasons} dispatch={dispatch} />}
      {help && <ShortcutsOverlay deviceId={deviceId} scope="kds" labels={labels} profileName={L(profile.role)} profileKeys={profile.kdsKeys} onClose={() => setHelp(false)} title={t('اختصارات شاشة المطبخ')} fb="kds-keys"
        fixed={[['← →', t('التنقل بين التذاكر')], ['1–9', t('اختيار تذكرة برقمها')], ['?', t('عرض الاختصارات')], ['Esc', t('إغلاق النافذة')]]} />}
      {dlg?.k === 'refire' && <RefireDialog tk={dlg.tk} reasons={reasons} stations={active} onClose={() => setDlg(null)} />}
      {dlg?.k === 'move' && <MoveDialog tk={dlg.tk} stations={active} onClose={() => setDlg(null)} />}
      {dlg?.k === 'history' && <HistoryDialog tk={dlg.tk} onClose={() => setDlg(null)} />}
    </div>
  );
}

function Legend({ warn, late }: { warn: number; late: number }) {
  const Dot = ({ c, children }: { c: string; children: React.ReactNode }) => <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: c }} /><span className="num">{children}</span></span>;
  return <span className="flex items-center gap-3 text-xs font-bold text-soft" data-fb="kds-legend" data-warn={warn} data-late={late}><Dot c="var(--success)">{'<'} {warn}</Dot><Dot c="var(--warning)">{warn}–{late}</Dot><Dot c="var(--error)">≥ {late}</Dot><span>{t('د')}</span></span>;
}

/** "All day": how many of each item are still to cook on this screen right now, split by size / options (E06).
 *  A fixed side panel — the chef sees "9 شاي، 3 بيتزا" without scrolling. A meal split over two stations counts once. */
function AllDay({ tickets, sentToDispatch }: { tickets: any[]; sentToDispatch: any[] | null }) {
  const { run, busy } = useCommand();
  const rows = useMemo(() => {
    const m = new Map<string, { name: any; qty: number; mods: Map<string, number> }>();
    const seen = new Set<string>(); // one line of one round counts once, even if a meal is split over two stations
    for (const tk of tickets) {
      if (tk.state === 'READY') continue;
      for (const it of tk.items) {
        if (it.status === 'CANCELLED' || it.bumped) continue;
        const once = `${tk.orderId}|${tk.round}|${it.lineId}`;
        if (seen.has(once)) continue;
        seen.add(once);
        const k = it.name.ar;
        const r = m.get(k) ?? { name: it.name, qty: 0, mods: new Map() };
        const q = Number(it.quantity); // a count of portions to cook (display only, never money)
        r.qty += q;
        const sig = (it.modifiers ?? []).map((md: any) => L(md)).join(' · ') || t('عادي');
        r.mods.set(sig, (r.mods.get(sig) ?? 0) + q);
        m.set(k, r);
      }
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  }, [tickets]);
  const total = rows.reduce((a, r) => a + r.qty, 0);
  return (
    <aside className="w-[min(250px,24%)] shrink-0 rounded-2xl surface-1 border line flex flex-col min-h-0" data-fb="kds-allday" aria-label={t('المطلوب دلوقتي')}>
      <div className="px-3 py-3 font-bold flex items-center justify-between border-b line"><span className="flex items-center gap-1.5 text-base"><Layers className="w-5 h-5 text-[var(--primary)]" />{t('المطلوب دلوقتي')}</span><span className="num text-lg font-black text-soft">{total || ''}</span></div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
        {!rows.length && <div className="text-sm text-dim text-center py-6">—</div>}
        {rows.map((r) => (
          <div key={r.name.ar} className="rounded-xl bg-[var(--card-raised)] border border-[var(--glass-border)] px-2.5 py-2" data-fb={`allday:${r.name.ar}`}>
            <div className="flex items-baseline gap-2"><span className="num font-black text-[var(--primary)] text-[28px] leading-none" data-allday-qty>{qtyN(r.qty)}</span><span className="font-bold text-[17px] leading-tight min-w-0">{L(r.name)}</span></div>
            {(r.mods.size > 1 || ![...r.mods.keys()].includes(t('عادي'))) && (
              <div className="mt-1 space-y-0.5">{[...r.mods.entries()].map(([k, v]) => <div key={k} className="text-[13px] text-[var(--warning-text)] flex gap-1.5"><span className="num font-bold">{qtyN(v)}</span><span className="min-w-0">{k}</span></div>)}</div>
            )}
          </div>
        ))}
      </div>
      {sentToDispatch && (
        <div className="border-t line p-2 space-y-1.5 max-h-[40%] overflow-y-auto" data-fb="kds-sent">
          <div className="text-xs font-bold text-soft flex items-center gap-1"><ConciergeBell className="w-3.5 h-3.5" />{t('اتبعت لشاشة التسليم')} <span className="num">{sentToDispatch.length}</span></div>
          {sentToDispatch.slice(0, 6).map((tk) => (
            <div key={tk.id} className="flex items-center gap-1.5 text-sm rounded-lg surface-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate">{tk.shortNo ? <b className="num">{tk.shortNo} · </b> : null}{headline(tk)}</span>
              <button disabled={busy} onClick={() => run('Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } })} title={t('إعادة إلى التحضير')} aria-label={t('إعادة إلى التحضير')} className="w-9 h-9 rounded-md hover:bg-[var(--surface-3)] flex items-center justify-center"><Undo2 className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
const qtyN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** A ready ticket waiting for pickup (dispatch, tickets view): compact, with hand-off, back to cooking and make again. */
function ReadyCard({ tk, showStation, onServe, onBack, onRefire, busy }: { tk: any; showStation?: boolean; onServe: () => void; onBack: () => void; onRefire: () => void; busy: boolean }) {
  const waiting = tk.readyMinutes ?? 0;
  return (
    <div data-fb={`ticket:${tk.orderNumber}:r${tk.round}`} data-ticket-state={tk.state} className="rounded-xl bg-[var(--card-raised)] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] p-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><div className="font-extrabold leading-tight flex items-center gap-1.5">{tk.shortNo && !tk.tableName && <span className="num px-1.5 rounded-md bg-[var(--foreground)] text-[var(--background)] text-lg">{tk.shortNo}</span>}{headline(tk)}</div><div className="text-[11px] text-dim"><span className="num">#{tk.orderNumber}</span> · {t('الدفعة')} <span className="num">{tk.round}</span>{showStation ? ` · ${stationLabel(tk.stationName)}` : ''}</div></div>
        <Pill tone={waiting >= 5 ? 'warning' : 'success'}><Clock className="w-3 h-3" /><span className="num">{waiting}</span>{t('د')}</Pill>
      </div>
      <div className="text-sm text-soft leading-snug">{tk.items.filter((i: any) => i.status === 'ACTIVE').map((i: any) => `${qty(i.quantity)}× ${L(i.name)}`).join(' · ')}</div>
      <div className="flex gap-1">
        <Button size="lg" variant="ghost" disabled={busy} onClick={onBack} title={t('إعادة إلى التحضير')} aria-label={t('إعادة إلى التحضير')}><Undo2 className="w-4 h-4" /></Button>
        <Button size="lg" variant="ghost" disabled={busy} onClick={onRefire} data-fb="ticket-refire" title={t('إعادة التحضير')}><RotateCcw className="w-4 h-4" /></Button>
        <Button size="lg" variant="primary" className="flex-1" disabled={busy} onClick={onServe} data-fb="ticket-done"><Truck className="w-4 h-4 rtl:-scale-x-100" />{t('تسليم')}</Button>
      </div>
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
          <div className="grid grid-cols-2 gap-1.5">{Object.entries(reasons).map(([k, v]: any) => <button key={k} onClick={() => setReason(k)} data-fb={`refire-reason:${k}`} className={cn('h-12 rounded-xl border text-sm px-2', reason === k ? 'border-[var(--primary)] bg-[var(--primary-container)] font-bold' : 'border-[var(--glass-border)] surface-1')}>{L(v)}</button>)}</div>
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
      </div>
    </Modal>
  );
}

function HistoryDialog({ tk, onClose }: { tk: any; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`${t('اللي حصل للتذكرة')} #${tk.orderNumber}`}>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span>{t('وصلت المطبخ')}</span><span className="num">{time(tk.createdAt)}</span></div>
        {tk.startedAt ? <div className="flex justify-between"><span>{t('بدأت (الشيف داس «ابدأ»)')}</span><span className="num">{time(tk.startedAt)}{tk.waitBeforeStartMinutes != null ? ` · ${t('استنت {m} دقيقة قبل ما تبدأ', { m: tk.waitBeforeStartMinutes })}` : ''}</span></div>
          : <div className="flex justify-between text-dim"><span>{t('العداد')}</span><span>{t('شغال من ساعة ما وصلت')}</span></div>}
        {tk.readyAt && <div className="flex justify-between"><span>{t('جهزت')}</span><span className="num">{time(tk.readyAt)}</span></div>}
        {(tk.history ?? []).map((h: any, i: number) => <div key={i} className="flex justify-between gap-2 border-t line pt-2"><span>{L(h.text)}</span><span className="num text-dim">{time(h.at)}</span></div>)}
        <Tech><div className="num text-[10px] text-dim">{tk.id} · v{tk.version}</div></Tech>
      </div>
    </Modal>
  );
}

/** Recall: the tickets bumped in the last two hours (ready and handed off), newest first. ↑/↓ choose, Enter recalls. */
function RecallPopup({ onClose, stations, reasons, dispatch }: { onClose: () => void; stations: any[]; reasons: Record<string, any>; dispatch: boolean }) {
  const q = useQuery<any>('Kitchen.Board', { query: { lifecycle: 'READY,DONE', doneWithinMinutes: 120 } });
  const { run, busy } = useCommand();
  const [refire, setRefire] = useState<any>(null);
  const [sel, setSel] = useState(0);
  const items = [...(q.data?.items ?? [])].filter((x) => x.onMyScreen !== false || dispatch).sort((a, b) => String(b.doneAt ?? b.readyAt ?? '').localeCompare(String(a.doneAt ?? a.readyAt ?? ''))).slice(0, 12);
  const doRecall = async (tk: any) => { if (await run('Ticket.Recall', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version } }, { success: t('أُعيدت التذكرة إلى الشاشة') })) onClose(); };
  const ref = useRef({ items, sel, doRecall });
  ref.current = { items, sel, doRecall };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (refire) return;
      const { items: list, sel: s } = ref.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(list.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
      else if (e.key === 'Enter' && list[s]) { e.preventDefault(); ref.current.doRecall(list[s]); }
      else if (/^[1-9]$/.test(e.key) && list[Number(e.key) - 1]) { e.preventDefault(); setSel(Number(e.key) - 1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [refire]);
  return (
    <Popup open onClose={onClose} size="lg" fb="kds-recall-popup" title={<span className="flex items-center gap-2"><History className="w-5 h-5" />{t('استعادة تذكرة')}<StateBadge ops={['Ticket.Recall', 'Ticket.Refire']} /></span>}>
      <div className="space-y-1.5" data-fb="kds-recall">
        {q.loading && !q.data && <Skeleton className="h-40 rounded-xl" />}
        {q.data && !items.length && <Empty text={t('لا توجد تذاكر منجزة مؤخرًا')} />}
        {items.map((tk, i) => (
          <div key={tk.id} onPointerDown={() => setSel(i)} data-selected={i === sel || undefined} className={cn('flex items-center gap-3 px-3 py-2 rounded-xl border', i === sel ? 'border-[var(--primary)] bg-[var(--primary-container)]' : 'surface-1 border-[var(--glass-border)]')}>
            <span className="num w-7 h-7 rounded-md surface-3 text-sm font-black flex items-center justify-center shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold">{headline(tk)} · <span className="num">#{tk.orderNumber}</span> · {t('الدفعة')} <span className="num">{tk.round}</span> · {stationLabel(tk.stationName)}</div>
              <div className="text-xs text-dim truncate">{tk.items.filter((x: any) => x.status === 'ACTIVE').map((x: any) => `${qty(x.quantity)}× ${L(x.name)}`).join(' · ')}</div>
            </div>
            <Pill tone={tk.state === 'DONE' ? 'neutral' : 'success'}>{tk.state === 'DONE' ? t('سُلِّمت') : t('جاهز')} <span className="num">{time(tk.doneAt ?? tk.readyAt)}</span></Pill>
            <Button size="lg" disabled={busy} onClick={() => doRecall(tk)} data-fb={`recall:${tk.orderNumber}:r${tk.round}`}><Undo2 className="w-4 h-4" />{t('استعادة')}{i === sel && <Kbd>Enter</Kbd>}</Button>
            {(tk.state === 'DONE' || tk.state === 'READY') && <Button size="lg" variant="outline" onClick={() => setRefire(tk)} data-fb={`recall-refire:${tk.orderNumber}:r${tk.round}`}><RotateCcw className="w-4 h-4" />{t('إعادة التحضير')}</Button>}
          </div>
        ))}
      </div>
      {refire && <RefireDialog tk={refire} reasons={reasons} stations={stations} onClose={() => setRefire(null)} />}
    </Popup>
  );
}
