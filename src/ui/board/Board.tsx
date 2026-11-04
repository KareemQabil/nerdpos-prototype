// One reusable board (Trello order, Stripe/Square calm): columns by state with counts and Decimal money sums, quick
// filter chips, search, grouping by state / priority / time bucket, visual aging, collapsed columns, density, loading
// skeletons, details in the page (side by side when wide, full page when narrow — never a side drawer).
//
// Moving a card: drag (pointer events — mouse, pen, touch long-press) ONLY onto a column the board says is a legal
// server transition; an illegal drop is refused visibly (column dims, card snaps back) and nothing is sent. Every
// accepted move runs the real command (onMove) and reverts if the server refuses. The same moves are always offered
// from the card menu (⋯) and the keyboard: arrows move the focus, Enter opens the details, M / Space opens the menu.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MoreHorizontal, ChevronsLeft, ChevronsRight, Rows3, Rows4, ArrowRight, ArrowLeft, Loader2, AlertTriangle, Check, Ban } from 'lucide-react';
import { cn } from '../../lib/format';
import { sumAmounts } from '../../lib/cash';
import { t, useLang } from '../../i18n';
import { Money, Pill, Popover, SearchInput, SegmentedControl, SkeletonCard, Kbd, toast, IconButton, Button } from '../index';
import { useBoardPrefs, type BoardGroup } from './prefs';
import type { Aging } from './aging';

export type ColTone = 'primary' | 'info' | 'warning' | 'success' | 'error' | 'violet' | 'neutral';
export interface ColumnDef { id: string; title: string; tone?: ColTone; /** collapsed until the user opens it */ collapsed?: boolean; /** soft work-in-progress limit */ wip?: number | null; /** a terminal state (done / decided) */ final?: boolean }
export interface MoveCheck { ok: boolean; /** why it is refused (shown on the column and in the menu) */ reason?: string; /** the action the move runs («إرسال للمطبخ») */ label?: string }
export interface FilterDef<T> { id: string; label: string; group?: string; test: (x: T) => boolean }
export interface CardAction { id: string; label: string; icon?: React.ReactNode; onSelect: () => void; disabled?: boolean; reason?: string; tone?: 'danger' | 'primary' }

export interface BoardProps<T> {
  id: string;
  userId: string | null | undefined;
  items: T[] | null;
  itemKey: (x: T) => string;
  columns: ColumnDef[];
  columnOf: (x: T) => string | null;
  aging: (x: T) => Aging;
  amount?: (x: T) => string | null | undefined;
  search: (x: T) => string;
  searchPlaceholder?: string;
  filters?: FilterDef<T>[];
  timeBuckets?: { columns: ColumnDef[]; of: (x: T) => string };
  sort?: (a: T, b: T) => number;
  canMove?: (x: T, to: string) => MoveCheck | null;
  onMove?: (x: T, to: string) => Promise<boolean>;
  renderCard: (x: T, c: { compact: boolean; aging: Aging; selected: boolean }) => React.ReactNode;
  cardActions?: (x: T) => CardAction[];
  renderDetail?: (x: T, close: () => void) => React.ReactNode;
  cardLabel?: (x: T) => string;
  /** screen title shown at the start of the toolbar */
  title?: React.ReactNode;
  toolbarStart?: React.ReactNode;
  toolbarEnd?: React.ReactNode;
  /** compact host (e.g. inside the cashier pane): no grouping switch, columns stack on narrow panes */
  embedded?: boolean;
  fb?: string;
}

const TONE: Record<ColTone, string> = {
  primary: 'var(--primary)', info: 'var(--info)', warning: 'var(--warning)', success: 'var(--success)', error: 'var(--error)', violet: 'var(--violet)', neutral: 'var(--glass-border)',
};
const HEAT_BORDER = ['transparent', 'color-mix(in srgb, var(--warning) 35%, transparent)', 'color-mix(in srgb, var(--warning) 70%, var(--error))', 'var(--error)'];

interface DragState { key: string; from: string; legal: Record<string, MoveCheck | null>; over: string | null }

export function Board<T>(props: BoardProps<T>) {
  const { id, userId, items, itemKey, columns, columnOf, aging, amount, search, filters = [], timeBuckets, sort, canMove, onMove, renderCard, cardActions, renderDetail, embedded } = props;
  const lang = useLang();
  const rtl = lang === 'ar';
  const [prefs, setPrefs] = useBoardPrefs(userId, id);
  const compact = prefs.density === 'compact';
  const group: BoardGroup = embedded ? 'status' : prefs.groupBy ?? 'status';
  const collapsed = useMemo(() => new Set(prefs.collapsed ?? columns.filter((c) => c.collapsed).map((c) => c.id)), [prefs.collapsed, columns]);
  const [q, setQ] = useState('');
  const [on, setOn] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; from: string; to: string } | null>(null);
  const [snap, setSnap] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1600);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const wide = width >= 1180;
  const narrow = width < 1000;

  // ── filtering
  const all = items ?? [];
  const byKey = useMemo(() => new Map(all.map((x) => [itemKey(x), x])), [all, itemKey]);
  const filterGroups = useMemo(() => {
    const g = new Map<string, FilterDef<T>[]>();
    for (const f of filters) if (on.has(f.id)) g.set(f.group ?? f.id, [...(g.get(f.group ?? f.id) ?? []), f]);
    return [...g.values()];
  }, [filters, on]);
  const needle = q.trim().toLowerCase();
  const visible = useMemo(() => all.filter((x) => columnOf(x) !== null && filterGroups.every((fs) => fs.some((f) => f.test(x))) && (!needle || search(x).toLowerCase().includes(needle))), [all, filterGroups, needle, columnOf, search]);

  // ── status of a card, with the optimistic move while its command runs
  const statusOf = useCallback((x: T) => {
    const k = itemKey(x);
    if (pending && pending.key === k) return pending.to;
    return columnOf(x);
  }, [pending, itemKey, columnOf]);
  // the optimistic move ends when the server data shows the card elsewhere (or after a short safety timeout)
  useEffect(() => {
    if (!pending) return;
    const x = byKey.get(pending.key);
    if (!x || columnOf(x) !== pending.from) { setPending(null); return; }
    const tm = setTimeout(() => setPending(null), 2500);
    return () => clearTimeout(tm);
  }, [pending, byKey, columnOf]);

  // ── grouping
  const statusCol = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const groupCols: ColumnDef[] = group === 'status' ? columns
    : group === 'priority' ? [{ id: 'g:late', title: t('متأخر'), tone: 'error' }, { id: 'g:soon', title: t('يقترب من التأخير'), tone: 'warning' }, { id: 'g:ok', title: t('في الوقت'), tone: 'success' }, { id: 'g:final', title: t('منتهٍ'), tone: 'neutral', collapsed: true, final: true }]
    : [...(timeBuckets?.columns ?? []), { id: 'g:final', title: t('منتهٍ'), tone: 'neutral', collapsed: true, final: true }];
  const groupOf = (x: T): string => {
    const s = statusOf(x);
    if (group === 'status') return s ?? '';
    if (s && statusCol.get(s)?.final) return 'g:final';
    if (group === 'priority') { const a = aging(x); return a.late ? 'g:late' : a.heat >= 1 ? 'g:soon' : 'g:ok'; }
    return timeBuckets?.of(x) ?? 'g:final';
  };
  const defaultSort = (a: T, b: T) => aging(b).heat - aging(a).heat;
  const byCol = new Map<string, T[]>();
  for (const c of groupCols) byCol.set(c.id, []);
  for (const x of visible) byCol.get(groupOf(x))?.push(x);
  for (const list of byCol.values()) list.sort(sort ?? defaultSort);
  const isCollapsed = (c: ColumnDef) => (prefs.collapsed ? collapsed.has(c.id) : !!c.collapsed);
  const toggleCollapse = (c: ColumnDef) => {
    const cur = new Set(groupCols.filter((x) => isCollapsed(x)).map((x) => x.id));
    if (cur.has(c.id)) cur.delete(c.id); else cur.add(c.id);
    setPrefs({ collapsed: [...cur, ...[...collapsed].filter((x) => !groupCols.some((g) => g.id === x))] });
  };

  // ── moving (shared by drag, menu and keyboard)
  const legalMoves = useCallback((x: T) => {
    const from = columnOf(x) ?? '';
    const out: Record<string, MoveCheck | null> = {};
    for (const c of columns) out[c.id] = c.id === from || !canMove ? null : canMove(x, c.id);
    return out;
  }, [columns, columnOf, canMove]);
  const doMove = useCallback(async (x: T, to: string) => {
    const from = columnOf(x) ?? '';
    const k = itemKey(x);
    const check = canMove?.(x, to) ?? null;
    if (!check || !check.ok || !onMove) {
      setSnap(k); setTimeout(() => setSnap((s) => (s === k ? null : s)), 700);
      toast('warning', check?.reason ?? t('لا يمكن النقل إلى هذا العمود'), undefined);
      return false;
    }
    setPending({ key: k, from, to });
    let ok = false;
    try { ok = await onMove(x, to); } catch { ok = false; }
    if (!ok) {
      setPending(null);
      setSnap(k); setTimeout(() => setSnap((s) => (s === k ? null : s)), 700);
    }
    return ok;
  }, [columnOf, itemKey, canMove, onMove]);

  // ── pointer drag (mouse / pen: after 5 px; touch: long press 280 ms)
  const dragRef = useRef<{ key: string; x0: number; y0: number; el: HTMLElement; pointerId: number; type: string; timer: any; active: boolean; ghost: HTMLElement | null; dx: number; dy: number; rect: DOMRect } | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  dragStateRef.current = drag;
  const justDragged = useRef(false);
  const autoScroll = useRef<{ raf: number; x: number; y: number } | null>(null);
  const canDrag = group === 'status' && !!onMove;

  // window listeners are stable wrappers over the latest render's handlers (no stale closures across drags)
  const live = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: (e: PointerEvent) => void; activate: () => void }>(null!);
  const stable = useMemo(() => ({
    move: (e: PointerEvent) => live.current.move(e), up: (e: PointerEvent) => live.current.up(e), cancel: (e: PointerEvent) => live.current.cancel(e),
    touch: (e: TouchEvent) => { if (dragRef.current?.active) e.preventDefault(); }, activate: () => live.current.activate(),
  }), []);
  function endDrag(dropX?: number, dropY?: number) {
    const d = dragRef.current;
    if (!d) return;
    clearTimeout(d.timer);
    window.removeEventListener('pointermove', stable.move);
    window.removeEventListener('pointerup', stable.up);
    window.removeEventListener('pointercancel', stable.cancel);
    window.removeEventListener('touchmove', stable.touch);
    if (autoScroll.current) { cancelAnimationFrame(autoScroll.current.raf); autoScroll.current = null; }
    dragRef.current = null;
    if (!d.active) return;
    justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 50);
    const st = dragStateRef.current;
    setDrag(null);
    const ghost = d.ghost;
    const over = dropX != null && dropY != null ? colAt(dropX, dropY) : null;
    const x = byKey.get(d.key);
    if (!x || !st || !over || over === st.from) { snapBack(ghost, d.rect); return; }
    const check = st.legal[over];
    if (!check || !check.ok) {
      snapBack(ghost, d.rect);
      setSnap(d.key); setTimeout(() => setSnap((s) => (s === d.key ? null : s)), 700);
      toast('warning', check?.reason ?? t('لا يمكن النقل إلى هذا العمود'));
      return;
    }
    ghost?.remove();
    void doMove(x, over);
  }

  function colAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const col = el?.closest('[data-board-col]') as HTMLElement | null;
    if (!col || !rootRef.current?.contains(col)) return null;
    return col.dataset.boardCol ?? null;
  }
  function snapBack(ghost: HTMLElement | null, rect: DOMRect) {
    if (!ghost) return;
    ghost.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s';
    ghost.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    ghost.style.opacity = '0.4';
    setTimeout(() => ghost.remove(), 240);
  }
  function activate() {
    const d = dragRef.current;
    if (!d || d.active) return;
    const x = byKey.get(d.key);
    if (!x) return;
    d.active = true;
    const g = d.el.cloneNode(true) as HTMLElement;
    g.removeAttribute('data-fb');
    g.querySelectorAll('[data-fb]').forEach((n) => n.removeAttribute('data-fb'));
    g.setAttribute('data-board-ghost', '');
    Object.assign(g.style, { position: 'fixed', left: '0', top: '0', width: `${d.rect.width}px`, zIndex: '95', pointerEvents: 'none', transform: `translate(${d.rect.left}px, ${d.rect.top}px)`, boxShadow: 'var(--shadow-pop)', opacity: '0.96', rotate: '1.5deg' });
    document.body.appendChild(g);
    d.ghost = g;
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
    setDrag({ key: d.key, from: columnOf(x) ?? '', legal: legalMoves(x), over: null });
  }
  function onMoveP(e: PointerEvent) {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dist = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.active) {
      if (d.type === 'touch') { if (dist > 10) endDrag(); return; } // a swipe scrolls; a long press drags
      if (dist > 5) activate(); else return;
    }
    if (d.ghost) d.ghost.style.transform = `translate(${e.clientX - d.dx}px, ${e.clientY - d.dy}px)`;
    const over = colAt(e.clientX, e.clientY);
    setDrag((s) => (s && s.over !== over ? { ...s, over } : s));
    // auto-scroll the board near its inline edges and the column under the pointer near its top / bottom
    const sc = scroller.current;
    if (sc) {
      const r = sc.getBoundingClientRect();
      const vx = e.clientX < r.left + 60 ? -14 : e.clientX > r.right - 60 ? 14 : 0;
      const list = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-board-list]') as HTMLElement | null;
      const lr = list?.getBoundingClientRect();
      const vy = lr ? (e.clientY < lr.top + 40 ? -10 : e.clientY > lr.bottom - 40 ? 10 : 0) : 0;
      if (autoScroll.current) cancelAnimationFrame(autoScroll.current.raf);
      autoScroll.current = null;
      if (vx || vy) {
        const tick = () => { sc.scrollLeft += vx; if (list) list.scrollTop += vy; autoScroll.current = { raf: requestAnimationFrame(tick), x: vx, y: vy }; };
        autoScroll.current = { raf: requestAnimationFrame(tick), x: vx, y: vy };
      }
    }
  }
  function onUpP(e: PointerEvent) { if (dragRef.current && e.pointerId === dragRef.current.pointerId) endDrag(e.clientX, e.clientY); }
  function onCancelP(e: PointerEvent) { if (dragRef.current && e.pointerId === dragRef.current.pointerId) endDrag(); }
  live.current = { move: onMoveP, up: onUpP, cancel: onCancelP, activate };
  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, k: string) => {
    if (!canDrag || e.button !== 0 || dragRef.current) return;
    if (!e.currentTarget.contains(e.target as Node)) return; // a popup portaled from inside the card
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [data-no-drag]')) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    dragRef.current = { key: k, x0: e.clientX, y0: e.clientY, el, pointerId: e.pointerId, type: e.pointerType, timer: null, active: false, ghost: null, dx: e.clientX - rect.left, dy: e.clientY - rect.top, rect };
    window.addEventListener('pointermove', stable.move);
    window.addEventListener('pointerup', stable.up);
    window.addEventListener('pointercancel', stable.cancel);
    if (e.pointerType === 'touch') {
      window.addEventListener('touchmove', stable.touch, { passive: false });
      dragRef.current.timer = setTimeout(stable.activate, 280);
    }
  };
  useEffect(() => () => { dragRef.current?.ghost?.remove(); dragRef.current && (dragRef.current.active = false); endDrag(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── keyboard: arrows move the focus, Enter opens, M / Space opens the move menu
  const focusCard = (k: string) => (rootRef.current?.querySelector(`[data-board-card="${CSS.escape(k)}"]`) as HTMLElement | null)?.focus();
  const shownCols = groupCols.filter((c) => !isCollapsed(c));
  const onCardKey = (e: React.KeyboardEvent<HTMLElement>, x: T) => {
    const k = itemKey(x);
    const g = groupOf(x);
    const list = byCol.get(g) ?? [];
    const i = list.findIndex((y) => itemKey(y) === k);
    const ci = shownCols.findIndex((c) => c.id === g);
    const nextCol = (dir: 1 | -1) => {
      for (let j = ci + dir; j >= 0 && j < shownCols.length; j += dir) { const l = byCol.get(shownCols[j].id) ?? []; if (l.length) return l[Math.min(i, l.length - 1)]; }
      return null;
    };
    let target: T | null | undefined = null;
    if (e.key === 'ArrowDown') target = list[i + 1];
    else if (e.key === 'ArrowUp') target = list[i - 1];
    else if (e.key === 'ArrowLeft') target = nextCol(rtl ? 1 : -1);
    else if (e.key === 'ArrowRight') target = nextCol(rtl ? -1 : 1);
    else if (e.key === 'Home') target = list[0];
    else if (e.key === 'End') target = list[list.length - 1];
    else if (e.key === 'Enter') { e.preventDefault(); setSelected(k); return; }
    else if (e.code === 'KeyM' || e.key === ' ' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); setMenu({ key: k, anchor: e.currentTarget }); return; }
    else return;
    e.preventDefault();
    if (target) focusCard(itemKey(target));
  };

  // ── layout
  const sel = selected ? byKey.get(selected) ?? null : null;
  useEffect(() => { if (selected && items && !byKey.has(selected)) setSelected(null); }, [selected, items, byKey]);
  const detailOpen = !!(sel && renderDetail);
  const fullDetail = detailOpen && !wide;
  const colW = compact ? 236 : 284;
  const menuItem = menu ? byKey.get(menu.key) ?? null : null;
  const totalShown = visible.length;

  const filterCount = (f: FilterDef<T>) => all.filter((x) => columnOf(x) !== null && f.test(x)).length;
  return (
    <div ref={rootRef} className="flex flex-col min-h-0 h-full gap-3" data-board={id} data-group={group} data-density={compact ? 'compact' : 'comfortable'} data-fb={props.fb}>
      {!fullDetail && (
        <div className="flex items-center gap-2 flex-wrap shrink-0" data-fb="board-toolbar">
          {props.title && <h1 className="text-xl font-bold font-display me-1 whitespace-nowrap" data-fb="board-title">{props.title}</h1>}
          {props.toolbarStart}
          <SearchInput value={q} onChange={setQ} placeholder={props.searchPlaceholder ?? t('بحث')} className={embedded ? '!flex-none w-56' : '!flex-none w-64'} data-fb="board-search" />
          {filters.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={t('عوامل التصفية')}>
              {filters.map((f) => {
                const active = on.has(f.id);
                const n = filterCount(f);
                return (
                  <button key={f.id} type="button" aria-pressed={active} data-fb={`board-filter:${f.id}`} onClick={() => setOn((s) => { const x = new Set(s); if (x.has(f.id)) x.delete(f.id); else x.add(f.id); return x; })}
                    className={cn('h-8 px-3 rounded-full border text-xs font-bold inline-flex items-center gap-1.5 transition-colors', active ? 'border-[var(--primary)] bg-[var(--primary-container)] text-[var(--primary)]' : 'border-[var(--glass-border)] surface-1 text-soft hover:text-[var(--foreground)]')}>
                    {active && <Check className="w-3 h-3" />}{f.label}<span className="num opacity-70">{n}</span>
                  </button>
                );
              })}
              {on.size > 0 && <Button size="sm" variant="ghost" onClick={() => setOn(new Set())} data-fb="board-filter:clear">{t('مسح التصفية')}</Button>}
            </div>
          )}
          <div className="flex-1" />
          {!embedded && (
            <SegmentedControl size="sm" value={group} onChange={(g) => setPrefs({ groupBy: g })} options={[
              { id: 'status', label: t('الحالة'), fb: 'board-group:status' },
              { id: 'priority', label: t('الأولوية'), fb: 'board-group:priority' },
              ...(timeBuckets ? [{ id: 'time' as const, label: t('الوقت'), fb: 'board-group:time' }] : []),
            ]} />
          )}
          <IconButton title={compact ? t('عرض مريح') : t('عرض مضغوط')} onClick={() => setPrefs({ density: compact ? 'comfortable' : 'compact' })} data-fb="board-density">{compact ? <Rows3 className="w-4 h-4" /> : <Rows4 className="w-4 h-4" />}</IconButton>
          {props.toolbarEnd}
        </div>
      )}
      <div className="flex-1 min-h-0 flex gap-3">
        {!fullDetail && (
          <div ref={scroller} className={cn('flex-1 min-w-0 flex gap-3 overflow-x-auto overflow-y-hidden pb-1', narrow && 'snap-x snap-mandatory')} data-fb="board-scroller" aria-label={t('اللوحة')}>
            {groupCols.map((c) => {
              const list = byCol.get(c.id) ?? [];
              const col = isCollapsed(c);
              const ds = drag ? (c.id === drag.from ? 'source' : drag.legal[c.id]?.ok ? 'ok' : 'refused') : undefined;
              const sum = amount && !embedded ? sumAmounts(list.map(amount)) : null;
              const overWip = c.wip != null && list.length > c.wip;
              const refusal = drag && ds === 'refused' ? drag.legal[c.id]?.reason : null;
              return (
                <section key={c.id} data-board-col={c.id} data-drop={ds} data-over={drag?.over === c.id || undefined} data-collapsed={col || undefined} data-fb={`board-col:${c.id}`} aria-label={c.title}
                  className={cn('rounded-2xl surface-1 border flex flex-col min-h-0 transition-[opacity,box-shadow,background] duration-150 snap-start',
                    col ? 'w-12 shrink-0' : 'shrink-0',
                    ds === 'refused' && 'opacity-40', ds === 'ok' && 'ring-1 ring-dashed ring-[color-mix(in_srgb,var(--primary)_50%,transparent)]',
                    drag?.over === c.id && ds === 'ok' && '!ring-2 ring-[var(--primary)] bg-[var(--primary-container)]',
                    drag?.over === c.id && ds === 'refused' && '!opacity-25')}
                  style={col ? undefined : { width: narrow ? `min(${colW + 30}px, 86%)` : undefined, minWidth: narrow ? undefined : colW, flex: narrow ? undefined : `1 0 ${colW}px`, borderColor: 'var(--glass-border)', borderTop: `3px solid ${TONE[c.tone ?? 'neutral']}` }}>
                  {col ? (
                    <button type="button" onClick={() => toggleCollapse(c)} className="flex-1 flex flex-col items-center gap-2 py-3 text-soft hover:text-[var(--foreground)]" title={t('فتح العمود')} data-fb={`board-expand:${c.id}`}>
                      {rtl ? <ChevronsLeft className="w-4 h-4" /> : <ChevronsRight className="w-4 h-4" />}
                      <span className="num text-xs font-bold">{list.length}</span>
                      <span className="text-xs font-bold [writing-mode:vertical-rl] whitespace-nowrap">{c.title}</span>
                    </button>
                  ) : (
                    <>
                      <header className="px-3 pt-2.5 pb-2 flex items-center gap-2 shrink-0">
                        <h3 className="font-bold text-sm truncate">{c.title}</h3>
                        <Pill size="sm" tone={overWip ? 'warning' : 'neutral'} title={c.wip != null ? t('حد العمل {n}', { n: c.wip }) : undefined}><span className="num" data-fb="board-count">{list.length}</span>{c.wip != null && <span className="num opacity-70">/{c.wip}</span>}</Pill>
                        <div className="flex-1" />
                        {sum && list.length > 0 && <Money v={sum} className="text-xs text-soft" />}
                        <IconButton className="!w-7 !h-7" title={t('طي العمود')} onClick={() => toggleCollapse(c)} data-fb={`board-collapse:${c.id}`}>{rtl ? <ChevronsRight className="w-3.5 h-3.5" /> : <ChevronsLeft className="w-3.5 h-3.5" />}</IconButton>
                      </header>
                      {refusal && <div className="mx-2 mb-1 rounded-lg px-2 py-1 text-[11px] text-[var(--error)] flex items-center gap-1" data-fb="board-refusal"><Ban className="w-3 h-3 shrink-0" />{refusal}</div>}
                      <div data-board-list className={cn('flex-1 min-h-0 overflow-y-auto px-2 pb-2', compact ? 'space-y-1.5' : 'space-y-2')}>
                        {items === null ? <><SkeletonCard lines={2} /><SkeletonCard lines={2} /><SkeletonCard lines={2} /></>
                          : list.length === 0 ? <div className="text-xs text-dim text-center py-6 select-none" data-fb="board-empty">{t('لا يوجد')}</div>
                          : list.map((x) => {
                            const k = itemKey(x);
                            const a = aging(x);
                            const isSel = selected === k;
                            const busy = pending?.key === k;
                            return (
                              <article key={k} data-board-card={k} data-heat={a.heat} data-late={a.late || undefined} data-status={statusOf(x) ?? ''} data-busy={busy || undefined} data-snap={snap === k || undefined}
                                tabIndex={0} role="button" aria-label={props.cardLabel?.(x)} aria-current={isSel || undefined}
                                onPointerDown={(e) => onCardPointerDown(e, k)}
                                onContextMenu={(e) => { if (dragRef.current) e.preventDefault(); }}
                                onClick={(e) => { if (!justDragged.current && e.currentTarget.contains(e.target as Node)) setSelected(isSel ? null : k); }}
                                onKeyDown={(e) => { if (e.currentTarget === e.target) onCardKey(e, x); }}
                                className={cn('group relative rounded-xl glass border text-start select-none outline-none transition-[box-shadow,opacity,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                                  compact ? 'p-2 text-[13px]' : 'p-2.5', canDrag ? 'cursor-grab active:cursor-grabbing touch-manipulation' : 'cursor-pointer',
                                  isSel && 'ring-2 ring-[var(--primary)]', drag?.key === k && 'opacity-30', busy && 'opacity-70', snap === k && 'board-snap', a.late && 'board-late')}
                                style={{ borderColor: 'var(--glass-border)', borderInlineStartWidth: a.heat ? 3 : 1, borderInlineStartColor: a.heat ? HEAT_BORDER[a.heat] : 'var(--glass-border)' }}>
                                <div className="flex items-start gap-1">
                                  <div className="flex-1 min-w-0">{renderCard(x, { compact, aging: a, selected: isSel })}</div>
                                  <button type="button" data-no-drag data-fb="board-card-menu" aria-label={t('الإجراءات')} title={`${t('الإجراءات')} (M)`} onClick={(e) => { e.stopPropagation(); setMenu({ key: k, anchor: e.currentTarget }); }}
                                    className="w-8 h-8 -mt-1 -me-1 shrink-0 rounded-lg flex items-center justify-center text-dim hover:text-[var(--foreground)] hover:bg-[var(--surface-2)]">
                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {detailOpen && (
          <aside className={cn('min-h-0 flex flex-col rounded-2xl glass border overflow-hidden', fullDetail ? 'flex-1' : 'w-[440px] 2xl:w-[500px] shrink-0')} style={{ borderColor: 'var(--glass-border)' }} data-fb="board-detail" aria-label={t('التفاصيل')}>
            <div className="flex items-center gap-2 px-3 py-2 border-b line shrink-0">
              <Button size="sm" variant="ghost" onClick={() => { const k = selected; setSelected(null); if (k) requestAnimationFrame(() => focusCard(k)); }} data-fb="board-detail-back">{rtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}{fullDetail ? t('رجوع إلى اللوحة') : t('إغلاق')}</Button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">{renderDetail!(sel!, () => setSelected(null))}</div>
          </aside>
        )}
      </div>
      {menu && menuItem && (
        <MoveMenu anchor={menu.anchor} onClose={() => setMenu(null)} columns={columns} from={columnOf(menuItem) ?? ''} legal={legalMoves(menuItem)} actions={cardActions?.(menuItem) ?? []}
          onMove={(to) => { setMenu(null); void doMove(menuItem, to); }} onDetails={renderDetail ? () => { setMenu(null); setSelected(itemKey(menuItem)); } : undefined} />
      )}
      {!embedded && <div className="sr-only" aria-live="polite">{t('{n} عنصر معروض', { n: totalShown })}</div>}
    </div>
  );
}

function MoveMenu({ anchor, onClose, columns, from, legal, actions, onMove, onDetails }: { anchor: HTMLElement; onClose: () => void; columns: ColumnDef[]; from: string; legal: Record<string, MoveCheck | null>; actions: CardAction[]; onMove: (to: string) => void; onDetails?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const id = requestAnimationFrame(() => (ref.current?.querySelector('button:not([disabled])') as HTMLElement | null)?.focus()); return () => cancelAnimationFrame(id); }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus();
  };
  const targets = columns.filter((c) => c.id !== from);
  return (
    <Popover anchor={anchor} open onClose={() => { onClose(); anchor.focus?.(); }} side="auto" align="end" width={300} label={t('الإجراءات')} fb="board-menu">
      <div ref={ref} onKeyDown={onKey} className="flex flex-col">
        <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold text-dim flex items-center justify-between">{t('نقل إلى')}<Kbd className="!text-[10px]">M</Kbd></div>
        {targets.map((c) => {
          const m = legal[c.id];
          const ok = !!m?.ok;
          return (
            <button key={c.id} type="button" disabled={!ok} onClick={() => onMove(c.id)} data-fb={`board-move:${c.id}`} data-legal={ok || undefined}
              className="w-full text-start rounded-xl px-2.5 py-2 hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] outline-none disabled:opacity-50 disabled:cursor-not-allowed">
              <span className="flex items-center gap-2 text-sm font-bold"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONE[c.tone ?? 'neutral'] }} />{c.title}{ok && m?.label ? <span className="text-xs text-[var(--primary)] font-bold ms-auto">{m.label}</span> : null}</span>
              {!ok && m?.reason && <span className="block text-[11px] text-dim ps-4 leading-snug">{m.reason}</span>}
            </button>
          );
        })}
        {(actions.length > 0 || onDetails) && <div className="border-t line my-1" />}
        {actions.map((a) => (
          <button key={a.id} type="button" disabled={a.disabled} onClick={() => { onClose(); a.onSelect(); }} data-fb={`board-action:${a.id}`}
            className={cn('w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold flex items-center gap-2 hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] outline-none disabled:opacity-50', a.tone === 'danger' && 'text-[var(--error)]', a.tone === 'primary' && 'text-[var(--primary)]')}
            title={a.disabled ? a.reason : undefined}>
            {a.icon}<span className="flex-1">{a.label}</span>{a.disabled && a.reason ? <AlertTriangle className="w-3.5 h-3.5 text-dim" /> : null}
          </button>
        ))}
        {onDetails && <button type="button" onClick={onDetails} data-fb="board-action:details" className="w-full text-start rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-[var(--surface-2)] focus-visible:bg-[var(--surface-2)] outline-none">{t('التفاصيل')} <Kbd className="!text-[10px] ms-1">Enter</Kbd></button>}
      </div>
    </Popover>
  );
}

/** Board / list switch of a screen, remembered per user (the profile gives the first default). */
export function BoardViewToggle({ value, onChange }: { value: 'board' | 'list'; onChange: (v: 'board' | 'list') => void }) {
  return <SegmentedControl size="sm" value={value} onChange={onChange} options={[{ id: 'board', label: t('لوحة'), fb: 'view:board' }, { id: 'list', label: t('قائمة'), fb: 'view:list' }]} />;
}
