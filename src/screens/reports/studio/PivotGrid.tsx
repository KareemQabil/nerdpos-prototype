// The report table: rows grouped by the chosen breakdowns (click a row to open the next level), optional columns
// (cross-tab) with a total column, sticky header and first column, virtualised rows for big results, resizable
// columns, a header menu (sort, rename, number format, hide, what is this) and every number — subtotals too — opening
// the checks behind it (Report.Explain). The values come from the server as they are; nothing is added up here.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, EyeOff, Info, TrendingUp, TrendingDown, Minus, Pencil } from 'lucide-react';
import { t, L, getLang } from '../../../i18n';
import { cn } from '../../../lib/format';
import { Pill } from '../../../ui';
import { Tech } from '../../../app/tech';
import { flatten, type PivotResult, type PivotNode, type MeasureMeta } from '../../../reports/pivot';
import { exportTable, type ExportColumn } from '../../../reports/export/table';
import type { ColumnView, NumberFormat } from '../../../reports/studio';
import { useEvidence } from '../parts';
import { lang, useClickAway, fmtCell } from './common';

const ROW_H = 36;
const FIRST_W = 260;
const COL_W = 136;

export function initialExpanded(r: PivotResult | null, depth: number): Set<string> {
  const s = new Set<string>(); if (!r) return s;
  const walk = (n: PivotNode) => { for (const c of n.children) { if (c.level < depth && c.children.length) s.add(c.id); walk(c); } };
  walk(r.root); return s;
}
/** Plain path of a row: «الفرع الرئيسي › صالة › فطار». */
export function wherePath(r: PivotResult, n: PivotNode): string {
  if (n.level === 0) return t('الإجمالي');
  const out: string[] = []; let cur: PivotNode | undefined = r.root;
  for (let k = 0; k < n.level && cur; k++) { const want = n.path[r.rows[k]]; cur = cur.children.find((c) => c.path[r.rows[k]] === want); if (cur) out.push(L(cur.label)); }
  return out.join(' › ');
}

export function PivotGrid({ result: r, view, onView, sort, onSort, expanded, onToggle, height = 520, fb = 'pivot-grid', dense }: {
  result: PivotResult; view?: ColumnView[]; onView?: (v: ColumnView[]) => void;
  sort?: { by: string; dir: 'asc' | 'desc' } | null; onSort?: (s: { by: string; dir: 'asc' | 'desc' } | null) => void;
  expanded: Set<string>; onToggle: (id: string) => void; height?: number | string; fb?: string; dense?: boolean;
}) {
  const open = useEvidence();
  const lg = lang();
  const tb = useMemo(() => exportTable(r, view, lg), [r, view, lg]);
  const rows = useMemo(() => flatten(r, expanded, { withTotal: false }), [r, expanded]);
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(600);
  const [menu, setMenu] = useState<{ col: ExportColumn; x: number; y: number } | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  useLayoutEffect(() => { const el = scroller.current; if (!el) return; const ro = new ResizeObserver(() => setVh(el.clientHeight)); ro.observe(el); setVh(el.clientHeight); return () => ro.disconnect(); }, []);
  const rtl = getLang() !== 'en';
  const single = r.cols.length > 0 && new Set(tb.columns.map((c) => c.measure.id)).size === 1; // one number across columns → one header row
  const cross = r.cols.length > 0 && !single;
  const headH = cross ? 72 : 40;
  const virtual = rows.length > 60;
  const start = virtual ? Math.max(0, Math.floor(top / ROW_H) - 12) : 0;
  const end = virtual ? Math.min(rows.length, Math.ceil((top + vh) / ROW_H) + 12) : rows.length;
  const firstW = widths.__first ?? FIRST_W;
  const colW = (c: ExportColumn) => widths[c.colKey + '|' + c.measure.id] ?? (c.width || COL_W);
  const total = firstW + tb.columns.reduce((a, c) => a + colW(c), 0);
  const groups = useMemo(() => { const g: { name: string; span: number; total: boolean }[] = []; for (const c of tb.columns) { const name = c.group ?? ''; const last = g.at(-1); if (last && last.name === name && (c.colKey === '') === last.total) last.span++; else g.push({ name, span: 1, total: c.colKey === '' }); } return g; }, [tb]);

  const evidence = (n: PivotNode, c: ExportColumn) => {
    const m = c.measure;
    const metric = m.metric ?? r.spec.calcs?.find((x) => 'calc:' + x.id === m.id)?.a;
    if (!metric) return;
    const colPath = c.colKey ? r.cols.find((h) => h.key === c.colKey)?.path ?? {} : {};
    const per = m.period ?? { from: r.meta.from, to: r.meta.to };
    open({ metric, cell: { ...n.path, ...colPath }, filters: r.spec.filters, exclude: r.spec.exclude, from: per.from, to: per.to, branchIds: r.meta.branchIds, asOf: (per as any).asOf, where: [wherePath(r, n), c.colKey ? c.group : null].filter(Boolean).join(' · ') });
  };
  const startResize = (key: string, e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX; const w0 = key === '__first' ? firstW : widths[key] ?? COL_W;
    const move = (ev: PointerEvent) => { const d = (ev.clientX - x0) * (rtl ? -1 : 1); setWidths((w) => ({ ...w, [key]: Math.max(key === '__first' ? 140 : 80, Math.min(520, w0 + d)) })); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const Resizer = ({ k }: { k: string }) => <span role="separator" aria-orientation="vertical" onPointerDown={(e) => startResize(k, e)} onClick={(e) => e.stopPropagation()} className="absolute top-0 bottom-0 w-2 cursor-col-resize hover:bg-[var(--primary)]/30 z-10" style={{ insetInlineEnd: -4 }} data-fb="pivot-resize" />;

  const Cell = ({ n, c, bold }: { n: PivotNode; c: ExportColumn; bold?: boolean }) => {
    const v = n.cells[c.colKey]?.[c.measure.id];
    if (!v) return <td className="pg-num text-dim">—</td>;
    if (v.availability === 'NOT_AVAILABLE') return <td className="pg-num"><span title={L(v.reason)}><Pill size="sm" tone="neutral">{t('مش متاح')}</Pill></span></td>;
    if (v.availability === 'REFUSED') return <td className="pg-num"><span title={L(v.reason)}><Pill size="sm" tone="warning">{t('اترفض')}</Pill></span></td>;
    if (v.availability === 'NOT_DEFINED' || v.value === null) return <td className="pg-num text-dim" title={L(v.reason)}>—</td>;
    const st: any = (v as any).style ?? {};
    const neg = Number(v.value) < 0 && c.measure.kind !== 'change' && c.measure.kind !== 'change_pct';
    const bg = st.tone ? `var(--pg-${st.tone})` : typeof st.scale === 'number' ? `color-mix(in srgb, var(--success) ${Math.round(st.scale * 28)}%, transparent)` : undefined;
    const Icon = st.icon === 'up' ? TrendingUp : st.icon === 'down' ? TrendingDown : st.icon === 'flat' ? Minus : null;
    return (
      <td className="pg-num p-0" style={bg ? { backgroundImage: `linear-gradient(${bg}, ${bg})` } : undefined}>
        <button type="button" onClick={() => evidence(n, c)} title={t('اعرض الشيكات والسجلات اللي ورا الرقم ده')} data-fb={`cell:${c.measure.id}`}
          className={cn('w-full h-full px-3 text-end num tabular-nums hover:text-[var(--primary)] hover:underline decoration-dotted underline-offset-4 inline-flex items-center justify-end gap-1', bold && 'font-bold', neg && 'text-[var(--error)]', st.tone === 'bad' && 'text-[var(--error)]', st.tone === 'good' && 'text-[var(--success)]')}>
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}{fmtCell(v, c.measure, view)}
        </button>
      </td>
    );
  };

  return (
    <div className="pg relative rounded-xl border border-[var(--glass-border)] overflow-hidden" data-fb={fb}>
      <style>{`
        .pg { --pg-bg: var(--card-raised); --pg-good: color-mix(in srgb, var(--success) 16%, transparent); --pg-bad: color-mix(in srgb, var(--error) 14%, transparent); --pg-warn: color-mix(in srgb, var(--warning) 18%, transparent); }
        .pg table { border-collapse: separate; border-spacing: 0; table-layout: fixed; }
        .pg th { position: sticky; z-index: 3; background: var(--table-head); font-weight: 600; font-size: 12px; color: var(--text-soft, inherit); border-bottom: 1px solid var(--glass-border); }
        .pg td { height: ${dense ? 32 : ROW_H}px; border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 60%, transparent); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background-color: var(--pg-bg); }
        .pg .pg-first { position: sticky; inset-inline-start: 0; z-index: 2; }
        .pg th.pg-first { z-index: 5; }
        .pg tr.pg-g1 td { background-image: linear-gradient(var(--surface-1), var(--surface-1)); }
        .pg tbody tr:hover td { background-image: linear-gradient(var(--row-hover), var(--row-hover)); }
        .pg tfoot td { position: sticky; bottom: 0; z-index: 2; font-weight: 700; border-top: 1px solid var(--glass-border); background-image: linear-gradient(var(--surface-2, var(--surface-1)), var(--surface-2, var(--surface-1))); }
        .pg tfoot td.pg-first { z-index: 4; }
        .pg .pg-num { text-align: end; }
      `}</style>
      <div ref={scroller} className="overflow-auto" style={{ maxHeight: height }} onScroll={(e) => setTop((e.target as HTMLDivElement).scrollTop)}>
        <table style={{ width: total, minWidth: '100%' }}>
          <colgroup><col style={{ width: firstW }} />{tb.columns.map((c, i) => <col key={i} style={{ width: colW(c) }} />)}</colgroup>
          <thead>
            {cross && (
              <tr>
                <th className="pg-first px-3 text-start" style={{ top: 0, height: 32 }} rowSpan={2}>
                  <div className="relative h-full flex items-end pb-2">{tb.rowHeader}<Resizer k="__first" /></div>
                </th>
                {groups.map((g, i) => <th key={i} colSpan={g.span} style={{ top: 0, height: 32 }} className={cn('px-2 text-center border-s border-[var(--glass-border)]', g.total && 'text-[var(--primary)]')}>{g.name}</th>)}
              </tr>
            )}
            <tr>
              {!cross && <th className="pg-first px-3 text-start relative" style={{ top: 0, height: headH }}><span className="truncate block">{tb.rowHeader}</span>{single && <span className="block truncate text-[10px] font-normal text-dim">{tb.columns[0]?.header}</span>}<Resizer k="__first" /></th>}
              {tb.columns.map((c, i) => {
                const sorted = sort?.by === c.measure.id && c.colKey === '';
                return (
                  <th key={i} style={{ top: cross ? 32 : 0, height: cross ? 40 : headH }} className="relative px-0">
                    <button type="button" className="w-full h-full px-3 text-end flex items-center justify-end gap-1 hover:text-[var(--primary)]" data-fb={`col-menu:${c.measure.id}`}
                      title={L(c.measure.formula) || t('اختيارات العمود')}
                      onClick={(e) => { const rc = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ col: c, x: rtl ? rc.left : rc.right, y: rc.bottom }); }}>
                      <span className="truncate leading-tight whitespace-normal line-clamp-2">{single ? c.group ?? c.header : c.header}</span>
                      {sorted ? (sort!.dir === 'asc' ? <ArrowUp className="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" /> : <ArrowDown className="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" />) : null}
                    </button>
                    <Resizer k={c.colKey + '|' + c.measure.id} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtual && start > 0 && <tr style={{ height: start * ROW_H }}><td colSpan={tb.columns.length + 1} style={{ padding: 0, border: 0, height: start * ROW_H }} /></tr>}
            {rows.slice(start, end).map((f) => {
              const n = f.node;
              const Chev = f.expanded ? ChevronDown : rtl ? ChevronLeft : ChevronRight;
              return (
                <tr key={n.id} className={cn(f.depth === 0 && f.hasChildren && 'pg-g1')} data-fb={`row:${n.id}`}>
                  <td className="pg-first px-0">
                    <div className="flex items-center h-full min-w-0" style={{ paddingInlineStart: 8 + f.depth * 18 }}>
                      {f.hasChildren ? (
                        <button type="button" onClick={() => onToggle(n.id)} aria-expanded={f.expanded} aria-label={f.expanded ? t('اقفل') : t('افتح')} data-fb={`toggle:${n.id}`}
                          className="w-7 h-7 shrink-0 rounded-md hover:surface-2 inline-flex items-center justify-center text-soft"><Chev className="w-4 h-4" /></button>
                      ) : <span className="w-7 shrink-0" />}
                      <button type="button" onClick={() => f.hasChildren && onToggle(n.id)} className={cn('truncate text-start min-w-0', f.hasChildren && 'font-semibold cursor-pointer hover:text-[var(--primary)]', f.kind === 'others' && 'italic text-soft', !f.hasChildren && 'cursor-default')} title={L(n.label)}>
                        {L(n.label)}
                      </button>
                      {f.hasChildren && !f.expanded && <span className="ms-2 px-1.5 rounded-full surface-2 text-[10px] text-dim shrink-0 num leading-4" title={t('{n} تحته', { n: n.children.length })}>{n.children.length}</span>}
                    </div>
                  </td>
                  {tb.columns.map((c, i) => <Cell key={i} n={n} c={c} bold={f.hasChildren} />)}
                </tr>
              );
            })}
            {virtual && end < rows.length && <tr style={{ height: (rows.length - end) * ROW_H }}><td colSpan={tb.columns.length + 1} style={{ padding: 0, border: 0, height: (rows.length - end) * ROW_H }} /></tr>}
          </tbody>
          <tfoot>
            <tr data-fb="row:total">
              <td className="pg-first px-3">{t('الإجمالي')}<span className="ms-1.5 text-[10px] font-normal text-dim">{t('(محسوب من جديد)')}</span></td>
              {tb.columns.map((c, i) => <Cell key={i} n={r.root} c={c} bold />)}
            </tr>
          </tfoot>
        </table>
      </div>
      {menu && <ColumnMenu menu={menu} r={r} view={view} onView={onView} sort={sort} onSort={onSort} onClose={() => setMenu(null)} />}
    </div>
  );
}

const FORMATS: { id: NumberFormat; label: () => string }[] = [
  { id: 'auto', label: () => t('تلقائي') }, { id: 'money', label: () => t('فلوس بالقروش') }, { id: 'money0', label: () => t('فلوس من غير قروش') },
  { id: 'number', label: () => t('رقم') }, { id: 'number0', label: () => t('رقم صحيح') }, { id: 'pct', label: () => t('نسبة %') },
];
function ColumnMenu({ menu, r, view, onView, sort, onSort, onClose }: { menu: { col: ExportColumn; x: number; y: number }; r: PivotResult; view?: ColumnView[]; onView?: (v: ColumnView[]) => void; sort?: any; onSort?: (s: any) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, onClose);
  const m: MeasureMeta = menu.col.measure;
  const cur = view?.find((x) => x.id === m.id) ?? { id: m.id };
  const [label, setLabel] = useState(cur.label ?? '');
  const set = (patch: Partial<ColumnView>) => { const list = [...(view ?? [])]; const i = list.findIndex((x) => x.id === m.id); const next = { ...cur, ...patch }; if (i >= 0) list[i] = next; else list.push(next); onView?.(list); };
  const rtl = getLang() !== 'en';
  const W = 264;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, rtl ? menu.x : menu.x - W));
  const md = r.measures.find((x) => x.id === m.id);
  return createPortal(
    <div ref={ref} className="fixed z-[80] overlay-panel rounded-xl shadow-[var(--shadow-pop)] border border-[var(--glass-border)] p-2 space-y-1 text-sm" style={{ top: Math.min(menu.y + 4, window.innerHeight - 360), left, width: W }} data-fb="col-menu">
      <div className="px-2 pt-1 pb-1.5 border-b line">
        <div className="font-bold truncate">{menu.col.header}</div>
        {md?.formula && <div className="text-[11px] text-dim">{L(md.formula)}</div>}
      </div>
      {onSort && menu.col.colKey === '' && <>
        <MenuItem icon={<ArrowDown className="w-4 h-4" />} label={t('رتّب من الأكبر للأصغر')} active={sort?.by === m.id && sort?.dir === 'desc'} onClick={() => { onSort({ by: m.id, dir: 'desc' }); onClose(); }} fb="col:sort-desc" />
        <MenuItem icon={<ArrowUp className="w-4 h-4" />} label={t('رتّب من الأصغر للأكبر')} active={sort?.by === m.id && sort?.dir === 'asc'} onClick={() => { onSort({ by: m.id, dir: 'asc' }); onClose(); }} fb="col:sort-asc" />
        {sort?.by === m.id && <MenuItem icon={<ArrowUpDown className="w-4 h-4" />} label={t('الترتيب الطبيعي')} onClick={() => { onSort(null); onClose(); }} />}
      </>}
      {onView && <>
        <div className="px-2 pt-1.5 text-[11px] text-dim">{t('اسم العمود')}</div>
        <div className="px-2 flex gap-1"><input className="glass-input h-8 flex-1 min-w-0 rounded-lg px-2 text-sm" value={label} placeholder={L(m.label)} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { set({ label: label.trim() || undefined }); onClose(); } }} data-fb="col:rename" /><button type="button" className="px-2 rounded-lg hover:surface-2" onClick={() => { set({ label: label.trim() || undefined }); onClose(); }} aria-label={t('احفظ')}><Pencil className="w-4 h-4" /></button></div>
        <div className="px-2 pt-1.5 text-[11px] text-dim">{t('شكل الرقم')}</div>
        <div className="px-2 flex flex-wrap gap-1">{FORMATS.map((f) => <button key={f.id} type="button" onClick={() => set({ format: f.id })} className={cn('px-2 h-7 rounded-md text-xs border', (cur.format ?? 'auto') === f.id ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent' : 'border-[var(--glass-border)] hover:surface-2')}>{f.label()}</button>)}</div>
        <MenuItem icon={<EyeOff className="w-4 h-4" />} label={t('اخفي العمود')} onClick={() => { set({ hidden: true }); onClose(); }} fb="col:hide" />
      </>}
      {md?.metric && <div className="px-2 py-1 text-[11px] text-soft flex gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{t('دوس على أي رقم في العمود يوريك الشيكات اللي وراه.')}</span></div>}
      <Tech><div className="px-2 text-[10px] text-dim num" dir="ltr">{m.id} · {m.kind}</div></Tech>
    </div>, document.body);
}
function MenuItem({ icon, label, onClick, active, fb }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; fb?: string }) {
  return <button type="button" onClick={onClick} data-fb={fb} className={cn('w-full flex items-center gap-2 px-2 h-8 rounded-lg text-start hover:surface-2', active && 'text-[var(--primary)] font-bold')}>{icon}<span className="flex-1">{label}</span></button>;
}
