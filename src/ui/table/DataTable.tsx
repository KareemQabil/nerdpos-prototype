// ux-16 «الجدول الموحّد» — the one table renderer. TanStack Table is the headless layer (column model, sort state with
// Ant Design's cycle none → ascending → descending → none, pagination); ./model.ts sorts deterministically (Decimal
// strings for money and quantities, never floating point) and computes widths, totals and the truncation decision.
//
//   const C = cols<Row>();
//   <DataTable rows={rows} rowKey={(r) => r.id} onRowOpen={(r) => open(r.id)} columns={[
//     C.text('name', t('الاسم'), (r) => r.name, { maxChars: 32 }),
//     C.status('state', t('الحالة'), (r) => ({ label: t(STATE[r.state]), tone: TONE[r.state] })),
//     C.date('at', t('الوقت'), (r) => r.at),
//     C.money('total', t('الإجمالي'), (r) => r.total, { total: true }),
//     C.actions('act', (r) => <Button …/>),
//   ]} />
//
// Typed cells: money (<Money>, end, tabular), qty / number (end, tabular), status (badge), date / day / time (<DateTime>,
// one format), text (cut with an ellipsis, the whole text on hover / focus), actions (end, clicks never open the row),
// custom. Sticky head inside the region's single scroll container (ux-06 §15c), row hover, keyboard rows (Tab / ↑ ↓,
// Enter opens), sort buttons in the head, density (the viewer's choice, ./model.ts), empty / loading / error states,
// a totals row (Decimal) and pages for long lists.
import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useReactTable, getCoreRowModel, getPaginationRowModel, type ColumnDef, type SortingState, type PaginationState } from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, ChevronLeft, ChevronRight, Rows3, Rows4 } from 'lucide-react';
import { cn, money, qty as fmtQty, dateTime, time as fmtTime, dateLocale } from '../../lib/format';
import { t, getLang } from '../../i18n';
import { Money, Pill, DateTime, EmptyState, Skeleton, Button } from '../index';
import { alignOf, sortableKind, sortIndices, totalOf, truncates, widthCh, getDensity, subscribeDensity, setDensity, effectiveDensity, legacyColumns, type ColKind, type ColAlign, type Density, type SortDir, type SortValue } from './model';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info' | 'violet';
export interface StatusValue { label: string; tone?: Tone }
export interface Column<T> {
  id: string;
  header: React.ReactNode;
  /** The header as text when `header` is not a string (width and accessible name). */
  headerText?: string;
  kind: ColKind;
  /** The raw value: sort key, total and default display (money / quantity: server Decimal strings). */
  value?: (row: T) => SortValue;
  /** A custom cell (replaces the kind's default rendering; sorting still uses `value`). */
  cell?: (row: T, index: number) => React.ReactNode;
  /** Text kind: the display text (default: the value). */
  text?: (row: T) => string | null | undefined;
  /** Text kind: a second, dimmer line. */
  sub?: (row: T) => React.ReactNode;
  /** Status kind: the badge. */
  status?: (row: T) => StatusValue | null | undefined;
  /** Quantity kind: the unit after the number. */
  unit?: (row: T) => string | null | undefined;
  /** Money kind: a tone per row (a negative difference in red). */
  tone?: (row: T) => 'primary' | 'error' | 'success' | 'dim' | undefined;
  align?: ColAlign;
  sortable?: boolean;
  /** Text kind: longer texts are cut with an ellipsis (whole text on hover / focus). */
  maxChars?: number;
  /** A fixed width in characters (otherwise computed from the content). */
  width?: number;
  /** Footer total (Decimal sum of all rows, every page). */
  total?: boolean;
  className?: string;
}
type Opts<T> = Partial<Omit<Column<T>, 'id' | 'header' | 'kind'>>;
/** Typed column helpers for rows of type T. */
export function cols<T>() {
  const mk = (kind: ColKind) => (id: string, header: React.ReactNode, value?: (row: T) => SortValue, o: Opts<T> = {}): Column<T> => ({ id, header, kind, value, ...o });
  return {
    text: (id: string, header: React.ReactNode, value: (row: T) => string | null | undefined, o: Opts<T> = {}): Column<T> => ({ id, header, kind: 'text', value, text: value, maxChars: 48, ...o }),
    money: mk('money'), qty: mk('qty'), number: mk('number'), date: mk('date'), day: mk('day'), time: mk('time'),
    status: (id: string, header: React.ReactNode, status: (row: T) => StatusValue | null | undefined, o: Opts<T> = {}): Column<T> => ({ id, header, kind: 'status', status, value: (r) => status(r)?.label ?? null, ...o }),
    actions: (id: string, cell: (row: T, index: number) => React.ReactNode, o: Opts<T> = {}): Column<T> => ({ id, header: '', headerText: '', kind: 'actions', cell, sortable: false, ...o }),
    custom: (id: string, header: React.ReactNode, cell: (row: T, index: number) => React.ReactNode, o: Opts<T> = {}): Column<T> => ({ id, header, kind: 'custom', cell, ...o }),
  };
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const noop = () => () => {};
/** The viewer's table density (null until chosen). */
export function useDensity(): Density | null {
  return useSyncExternalStore(subscribeDensity, getDensity, () => null);
}

/** A business date «2026-11-03» as «03 نوفمبر» / «03 Nov» (with the year when it is not this year). */
export function DayText({ v, className }: { v?: string | null; className?: string }) {
  if (!v) return <span className={cn('datetime', className)}>—</span>;
  const d = new Date(String(v).slice(0, 10) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return <span className={className}>{v}</span>;
  const withYear = d.getUTCFullYear() !== new Date().getUTCFullYear();
  const parts = new Intl.DateTimeFormat(dateLocale(), { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? '';
  return (
    <span className={cn('datetime', className)} dir={getLang() === 'ar' ? 'rtl' : 'ltr'} data-day={String(v).slice(0, 10)}>
      <span className="num">{get('day')}</span>{' '}<span>{get('month')}</span>{withYear && <>{' '}<span className="num">{get('year')}</span></>}
    </span>
  );
}
const dayText = (v: SortValue) => {
  if (!v) return '—';
  try { return new Intl.DateTimeFormat(dateLocale(), { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(String(v).slice(0, 10) + 'T12:00:00Z')); } catch { return String(v); }
};

/** A text cut with an ellipsis when it does not fit; the whole text shows in a tooltip on hover and on keyboard focus. */
export function TruncText({ text, maxChars, className, children }: { text: string; maxChars?: number; className?: string; children?: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<DOMRect | null>(null);
  const [cut, setCut] = useState(() => truncates(text, maxChars));
  const id = useId();
  useIsoLayoutEffect(() => { const el = ref.current; if (el) setCut(truncates(text, maxChars) || el.scrollWidth > el.clientWidth + 1); }, [text, maxChars]);
  const show = () => { const el = ref.current; if (el && el.scrollWidth > el.clientWidth + 1) setTip(el.getBoundingClientRect()); };
  const hide = () => setTip(null);
  const below = tip ? tip.top < 72 : false;
  return (
    <>
      <span ref={ref} className={cn('block truncate', className)} style={maxChars ? { maxWidth: `${maxChars}ch` } : undefined}
        tabIndex={cut ? 0 : undefined} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
        aria-describedby={tip ? id : undefined} data-trunc={cut || undefined}>{children ?? text}</span>
      {tip && typeof document !== 'undefined' && createPortal(
        <div id={id} role="tooltip" data-fb="table-tooltip" className="fixed z-[300] max-w-[min(440px,90vw)] rounded-lg overlay-panel px-2.5 py-1.5 text-xs leading-relaxed whitespace-normal break-words pointer-events-none"
          style={{ top: below ? tip.bottom + 6 : tip.top - 6, transform: below ? undefined : 'translateY(-100%)', ...(getLang() === 'ar' ? { right: Math.max(8, window.innerWidth - tip.right) } : { left: Math.max(8, tip.left) }) }}
          dir={getLang() === 'ar' ? 'rtl' : 'ltr'}>{text}</div>, document.body)}
    </>
  );
}

/** The viewer's density switch (comfortable / compact), shown under long tables and in back-office toolbars. */
export function DensityToggle({ className, dense }: { className?: string; dense?: boolean }) {
  const viewer = useDensity();
  const cur = effectiveDensity(viewer, dense);
  const btn = (d: Density, icon: React.ReactNode, label: string) => (
    <button type="button" onClick={() => setDensity(d)} aria-pressed={cur === d} title={label} aria-label={label} data-fb={`table-density:${d}`}
      className={cn('w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors', cur === d ? 'bg-[var(--primary-container)] text-[var(--primary)]' : 'text-dim hover:text-[var(--foreground)] hover:surface-2')}>{icon}</button>
  );
  return (
    <div role="group" aria-label={t('كثافة الجدول')} className={cn('inline-flex items-center gap-0.5 rounded-lg border line p-0.5', className)} data-fb="table-density">
      {btn('comfortable', <Rows3 className="w-4 h-4" />, t('عرض مريح'))}
      {btn('compact', <Rows4 className="w-4 h-4" />, t('عرض مضغوط'))}
    </div>
  );
}

function displayText<T>(c: Column<T>, row: T): string {
  const v = c.value?.(row);
  switch (c.kind) {
    case 'money': return money(v as string, false);
    case 'qty': return v === null || v === undefined || v === '' ? '—' : `${fmtQty(String(v))}${c.unit?.(row) ? ' ' + c.unit(row) : ''}`;
    case 'number': return v === null || v === undefined ? '—' : String(v);
    case 'status': return c.status?.(row)?.label ?? '';
    case 'date': return dateTime(v as string);
    case 'time': return fmtTime(v as string);
    case 'day': return dayText(v);
    case 'text': return c.text?.(row) ?? (v === null || v === undefined ? '' : String(v));
    default: return '';
  }
}

function DefaultCell<T>({ c, row, i }: { c: Column<T>; row: T; i: number }) {
  if (c.cell) return <>{c.cell(row, i)}</>;
  const v = c.value?.(row);
  const dash = <span className="text-dim">—</span>;
  switch (c.kind) {
    case 'money': return v === null || v === undefined || v === '' ? dash : <Money v={v} className="font-semibold" tone={c.tone?.(row)} />;
    case 'qty': {
      if (v === null || v === undefined || v === '') return dash;
      const u = c.unit?.(row);
      return <span className="inline-flex items-baseline gap-1 whitespace-nowrap"><span className="num">{fmtQty(String(v))}</span>{u && <span className="text-[11px] text-dim">{u}</span>}</span>;
    }
    case 'number': return v === null || v === undefined || v === '' ? dash : <span className="num">{String(v)}</span>;
    case 'status': { const s = c.status?.(row); return s ? <Pill size="sm" tone={s.tone ?? 'neutral'} dot>{s.label}</Pill> : dash; }
    case 'date': return <DateTime v={v as string} />;
    case 'time': return <DateTime v={v as string} time />;
    case 'day': return <DayText v={v as string} />;
    case 'text': {
      const s = c.text?.(row) ?? (v === null || v === undefined ? '' : String(v));
      const sub = c.sub?.(row);
      if (!s && !sub) return dash;
      return <div className="min-w-0"><TruncText text={s} maxChars={c.maxChars} className="font-medium" />{sub ? <div className="text-[11px] text-dim truncate" style={c.maxChars ? { maxWidth: `${c.maxChars}ch` } : undefined}>{sub}</div> : null}</div>;
    }
    default: return null;
  }
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey?: (row: T, index: number) => React.Key;
  /** Opens a row: click, Enter or Space on a focused row. */
  onRowOpen?: (row: T, index: number) => void;
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Extra attributes per row (data-fb, data-state). */
  rowAttrs?: (row: T, index: number) => Record<string, string | undefined>;
  /** The selected row's key (selection only where the screen already had it: master–detail lists). */
  selectedKey?: React.Key | null;
  empty?: React.ReactNode;
  loading?: boolean;
  error?: React.ReactNode;
  /** The table's default density (the viewer's choice wins). */
  dense?: boolean;
  /** Cashier-facing: rows at least 48 px high in any density. */
  touch?: boolean;
  /** Fill the flex parent and be the region's only scroller (sticky head, horizontal scroll inside). */
  fill?: boolean;
  maxHeight?: number | string;
  className?: string;
  /** Classes of the bordered scroll box (the older API's className). */
  wrapClassName?: string;
  defaultSort?: { id: string; dir: SortDir };
  /** Rows per page for long lists (default 50); false shows every row. */
  pageSize?: number | false;
  /** A footer row from the server (a report's own totals): one cell per column; replaces the computed totals. */
  footer?: (c: Column<T>, index: number) => React.ReactNode;
  /** Footer label of the totals row (shown when a column has `total`). */
  totalLabel?: React.ReactNode;
  /** Accessible name of the table. */
  label?: string;
  fb?: string;
  /** Older API: the empty text in a plain centered cell (parity with <Table>). */
  plainEmpty?: boolean;
}

/** The one table. */
export function DataTable<T>({ columns, rows, rowKey, onRowOpen, rowClassName, rowAttrs, selectedKey, empty, loading, error, dense, touch, fill, maxHeight, className, wrapClassName, defaultSort, pageSize = 50, footer, totalLabel, label, fb, plainEmpty }: DataTableProps<T>) {
  const lang = getLang();
  const viewer = useDensity();
  const density = effectiveDensity(viewer, dense);
  const [sorting, setSorting] = useState<SortingState>(defaultSort ? [{ id: defaultSort.id, desc: defaultSort.dir === 'desc' }] : []);
  const paged = pageSize !== false && rows.length > pageSize;
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: pageSize || 50 });
  const byId = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  // deterministic sort (model.ts) over the original indices; TanStack keeps the state and the column model
  const data = useMemo(() => {
    const s = sorting[0]; const c = s && byId.get(s.id);
    const order = c && c.value ? sortIndices(rows, c.value, c.kind, s.desc ? 'desc' : 'asc', lang) : rows.map((_, i) => i);
    return order.map((i) => ({ r: rows[i], i }));
  }, [rows, sorting, byId, lang]);
  const defs = useMemo<ColumnDef<{ r: T; i: number }>[]>(() => columns.map((c) => ({
    id: c.id,
    accessorFn: (x) => c.value?.(x.r),
    enableSorting: (c.sortable ?? sortableKind(c.kind)) && !!c.value,
  })), [columns]);
  const table = useReactTable({
    data, columns: defs,
    state: { sorting, ...(paged ? { pagination } : {}) },
    onSortingChange: (u) => { setSorting(u); setPagination((p) => ({ ...p, pageIndex: 0 })); },
    onPaginationChange: setPagination,
    manualSorting: true, enableMultiSort: false, sortDescFirst: false, enableSortingRemoval: true,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    ...(paged ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    getRowId: (x) => String(rowKey ? rowKey(x.r, x.i) : x.i),
  });
  const pageCount = paged ? Math.max(1, Math.ceil(rows.length / pagination.pageSize)) : 1;
  useEffect(() => { if (paged && pagination.pageIndex >= pageCount) setPagination((p) => ({ ...p, pageIndex: pageCount - 1 })); }, [paged, pageCount, pagination.pageIndex]);
  const shown = (paged ? table.getPaginationRowModel() : table.getCoreRowModel()).rows;

  // computed widths (characters) from the header and up to 200 rows
  const widths = useMemo(() => {
    const sample = rows.slice(0, 200);
    return columns.map((c) => widthCh(c.kind, typeof c.header === 'string' ? c.header : c.headerText ?? '', c.kind === 'custom' || c.kind === 'actions' ? [] : sample.map((r) => displayText(c, r)), { maxChars: c.kind === 'text' ? c.maxChars : undefined, width: c.width }));
  }, [columns, rows, lang]);
  const totals = useMemo(() => columns.some((c) => c.total) ? columns.map((c) => (c.total && c.value ? totalOf(rows, c.value, c.kind) : null)) : null, [columns, rows]);

  // flow with the page scroller while the table fits (ux-06: no nested scrollers); scroll inside otherwise
  const wrap = useRef<HTMLDivElement>(null);
  const tbl = useRef<HTMLTableElement>(null);
  const [flow, setFlow] = useState(false);
  useIsoLayoutEffect(() => {
    const w = wrap.current, tb = tbl.current;
    if (maxHeight || fill || !w || !tb || typeof ResizeObserver === 'undefined') { setFlow(false); return; }
    const check = () => setFlow(tb.offsetWidth <= w.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(w); ro.observe(tb);
    return () => ro.disconnect();
  }, [maxHeight, fill]);

  const al = (c: Column<T>) => { const a = alignOf(c.kind, c.align); return a === 'end' ? 'text-end' : a === 'center' ? 'text-center' : 'text-start'; };
  const py = density === 'compact' ? 'py-1.5' : 'py-2.5';
  const focusRow = (el: Element | null | undefined) => { if (el instanceof HTMLElement && el.tabIndex >= 0) el.focus(); };
  const onRowKey = (e: React.KeyboardEvent<HTMLTableRowElement>, x: { r: T; i: number }) => {
    if (e.target !== e.currentTarget) return;
    if ((e.key === 'Enter' || e.key === ' ') && onRowOpen) { e.preventDefault(); onRowOpen(x.r, x.i); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusRow(e.currentTarget.nextElementSibling); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusRow(e.currentTarget.previousElementSibling); }
  };
  const firstText = columns.findIndex((c) => !c.total && c.kind !== 'actions');
  const emptyNode = plainEmpty || (empty !== undefined && empty !== null && !React.isValidElement(empty))
    ? <div className="px-3 py-8 text-center text-dim">{empty ?? t('لا توجد بيانات')}</div>
    : (empty ?? <EmptyState compact title={t('لا توجد بيانات')} />);

  return (
    <div className={cn('flex flex-col min-w-0', fill && 'flex-1 min-h-0', className)} data-fb={fb}>
      <div ref={wrap} className={cn('rounded-xl border line table-wrap', flow ? 'overflow-visible' : 'overflow-auto', fill && 'flex-1 min-h-0', wrapClassName)} style={maxHeight ? { maxHeight } : undefined} data-table-fill={fill || undefined}>
        <table ref={tbl} className="w-full text-sm border-separate border-spacing-0 tabular-nums" data-table="v2" data-density={density} data-touch={touch || undefined} aria-label={label} aria-busy={loading || undefined}>
          <colgroup>{columns.map((c, j) => <col key={c.id} style={widths[j] ? { width: `calc(${widths[j]}ch + 1.5rem)` } : undefined} />)}</colgroup>
          <thead>
            <tr>
              {table.getHeaderGroups()[0].headers.map((h, j) => {
                const c = columns[j];
                const can = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                const head = c.header;
                return (
                  <th key={h.id} scope="col" aria-sort={can ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                    className={cn('table-head sticky top-0 z-[1] font-bold text-[11px] text-soft px-3 py-2.5 whitespace-nowrap border-b line', al(c))} data-col={c.id} data-kind={c.kind}>
                    {can ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} data-fb={`sort:${c.id}`}
                        className={cn('inline-flex items-center gap-1 -mx-1 px-1 py-0.5 rounded hover:text-[var(--foreground)]', dir && 'text-[var(--foreground)]', alignOf(c.kind, c.align) === 'end' && 'flex-row-reverse')}
                        aria-label={`${typeof head === 'string' ? head : c.headerText ?? ''} — ${dir === 'asc' ? t('ترتيب تصاعدي') : dir === 'desc' ? t('ترتيب تنازلي') : t('بلا ترتيب')}`}>
                        <span>{head}</span>
                        {dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : dir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                      </button>
                    ) : head}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 4 }, (_, i) => <tr key={`sk${i}`}>{columns.map((c, j) => <td key={c.id} className={cn('px-3 border-b line', py)}><Skeleton className={cn('h-4', j === 0 ? 'w-3/4' : 'w-1/2', alignOf(c.kind, c.align) === 'end' && 'ms-auto')} /></td>)}</tr>)}
            {error && <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-[var(--error)]" role="alert" data-fb="table-error">{error}</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={columns.length} className="p-0" data-fb="table-empty">{emptyNode}</td></tr>}
            {shown.map((row) => {
              const x = row.original;
              const sel = selectedKey !== undefined && selectedKey !== null && row.id === String(selectedKey);
              return (
                <tr key={row.id} onClick={onRowOpen ? () => onRowOpen(x.r, x.i) : undefined} onKeyDown={(e) => onRowKey(e, x)} tabIndex={onRowOpen ? 0 : undefined}
                  aria-selected={selectedKey !== undefined ? sel : undefined} data-row={row.id}
                  className={cn('table-row transition-colors', onRowOpen && 'cursor-pointer', sel && 'row-selected', rowClassName?.(x.r, x.i))} {...(rowAttrs?.(x.r, x.i) ?? {})}>
                  {columns.map((c) => (
                    <td key={c.id} className={cn('px-3 align-middle border-b line', py, touch && 'h-12', al(c), c.kind === 'text' && !c.cell && 'max-w-0 w-auto', c.className)} data-kind={c.kind}
                      onClick={c.kind === 'actions' ? (e) => e.stopPropagation() : undefined} onKeyDown={c.kind === 'actions' ? (e) => e.stopPropagation() : undefined}>
                      {c.kind === 'actions' ? <div className="inline-flex items-center justify-end gap-1">{c.cell?.(x.r, x.i)}</div> : <DefaultCell c={c} row={x.r} i={x.i} />}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {footer && rows.length > 0 && (
            <tfoot>
              <tr data-fb="table-totals">
                {columns.map((c, j) => <td key={c.id} className={cn('table-head px-3 py-2 border-t line font-bold', !flow && 'sticky bottom-0', al(c))} data-kind={c.kind}>{footer(c, j)}</td>)}
              </tr>
            </tfoot>
          )}
          {!footer && totals && rows.length > 0 && (
            <tfoot>
              <tr data-fb="table-totals">
                {columns.map((c, j) => (
                  <td key={c.id} className={cn('table-head px-3 py-2 border-t line font-bold', !flow && 'sticky bottom-0', al(c))} data-kind={c.kind}>
                    {totals[j] !== null ? (c.kind === 'money' ? <Money v={totals[j]} /> : <span className="num">{c.kind === 'qty' ? fmtQty(totals[j]!) : totals[j]}</span>) : j === firstText ? <span className="text-soft text-xs">{totalLabel ?? t('الإجمالي')}</span> : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {paged && (
        <div className="flex items-center gap-2 pt-2 text-xs text-soft" data-fb="table-pager">
          <span data-fb="table-range"><span className="num">{pagination.pageIndex * pagination.pageSize + 1}–{Math.min(rows.length, (pagination.pageIndex + 1) * pagination.pageSize)}</span> {t('من أصل')} <span className="num">{rows.length}</span></span>
          <span className="flex-1" />
          {!touch && <DensityToggle dense={dense} />}
          <Button size="icon" variant="ghost" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label={t('الصفحة السابقة')} data-fb="table-page:prev">{getLang() === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}</Button>
          <Button size="icon" variant="ghost" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label={t('الصفحة التالية')} data-fb="table-page:next">{getLang() === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</Button>
        </div>
      )}
    </div>
  );
}

/** The older API (head / rows of rendered cells / align) on the one table: same columns, cells, alignment, row click,
 *  keys, classes, scrolling and empty text; it gains keyboard rows, the viewer's density and tabular figures. */
export function LegacyTable({ head, rows, empty, className, align, loading, onRowClick, maxHeight, dense, rowKey, rowClassName, fill }: { head: React.ReactNode[]; rows: React.ReactNode[][]; empty?: React.ReactNode; className?: string; align?: ('start' | 'end' | 'center' | undefined)[]; loading?: boolean; onRowClick?: (i: number) => void; maxHeight?: number | string; dense?: boolean; rowKey?: (i: number) => React.Key; rowClassName?: (i: number) => string | undefined; fill?: boolean }) {
  const columns = useMemo<Column<React.ReactNode[]>[]>(() => legacyColumns(head, align).map((c) => ({ id: c.id, header: head[c.index], kind: 'custom', align: c.align, sortable: false, cell: (r) => r[c.index] })), [head, align]);
  return (
    <DataTable<React.ReactNode[]> columns={columns} rows={rows} empty={empty ?? t('لا توجد بيانات')} plainEmpty wrapClassName={className} loading={loading}
      onRowOpen={onRowClick ? (_, i) => onRowClick(i) : undefined} maxHeight={maxHeight} dense={dense} fill={fill} pageSize={false}
      rowKey={rowKey ? (_, i) => rowKey(i) : undefined} rowClassName={rowClassName ? (_, i) => rowClassName(i) : undefined} />
  );
}
