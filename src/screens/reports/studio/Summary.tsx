// The calm top of a report: a status line (final / provisional, «لحد» time, what was left out and why), up to four big
// numbers (each opens its evidence; the change vs the comparison period under it), and one simple chart.
import React from 'react';
import { Clock, AlertTriangle, CheckCircle2, Info, TrendingUp, TrendingDown } from 'lucide-react';
import { t, L } from '../../../i18n';
import { cn, dateTime } from '../../../lib/format';
import { Pill, Banner } from '../../../ui';
import type { PivotResult, PivotNode } from '../../../reports/pivot';
import type { ColumnView } from '../../../reports/studio';
import { orderedMeasures, columnLabel } from '../../../reports/export/table';
import { useEvidence } from '../parts';
import { fmtCell, CellVal, isNum, lang, useRegistry } from './common';
import { rangeText } from '../../../reports/format';
import { wherePath } from './PivotGrid';

export function StatusLine({ r, loading }: { r: PivotResult; loading?: boolean }) {
  const m = r.meta;
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs" data-fb="report-status">
      {m.provisional
        ? <Pill tone="warning" dot title={m.provisionalReasons.map((x) => L(x)).join(' ')}>{t('مبدئي — ممكن يتغير')}</Pill>
        : <Pill tone="success" dot>{t('نهائي — الأيام مقفولة')}</Pill>}
      <span className="inline-flex items-center gap-1 text-dim"><Clock className="w-3.5 h-3.5" />{t('الأرقام لحد')} <span className="num">{dateTime(m.asOf)}</span></span>
      <span className="text-dim">·</span>
      <span className="text-dim">{t('اليوم التجاري من {c} الفجر بتوقيت القاهرة', { c: m.cutoff })}</span>
      {m.compare && <><span className="text-dim">·</span><span className="text-dim">{t('مقارنة بـ')} {L(m.compare.label)} ({rangeText(m.compare.from, m.compare.to, lang())})</span></>}
      {loading && <span className="text-dim animate-pulse">{t('بيتحدث…')}</span>}
    </div>
  );
}
export function LeftOut({ r }: { r: PivotResult }) {
  const refused = r.meta.refused; const notes = r.meta.notes ?? [];
  if (!refused.length && !notes.length) return null;
  return (
    <div className="space-y-1.5">
      {refused.length > 0 && <Banner tone="warning" title={t('فيه أرقام ما ظهرتش مع التقسيم ده')}><ul className="space-y-0.5">{refused.map((x, i) => <li key={i}>• {L(x.reason)}</li>)}</ul></Banner>}
      {notes.map((n, i) => <div key={i} className="text-xs text-dim flex items-center gap-1"><Info className="w-3.5 h-3.5" />{L(n)}</div>)}
    </div>
  );
}

export function Kpis({ r, view, max = 4 }: { r: PivotResult; view?: ColumnView[]; max?: number }) {
  const open = useEvidence();
  const ms = orderedMeasures(r, view).filter((m) => m.kind === 'value' || m.kind === 'calc').slice(0, max);
  if (!ms.length) return null;
  return (
    <div className="@container"><div className={cn('grid gap-2.5 grid-cols-2', ms.length >= 3 && '@xl:grid-cols-3', ms.length >= 4 && '@3xl:grid-cols-4')} data-fb="report-kpis">
      {ms.map((m) => {
        const v = r.root.cells['']?.[m.id];
        const chg = r.root.cells['']?.[`${m.id}@chg%`];
        const metric = m.metric ?? r.spec.calcs?.find((c) => 'calc:' + c.id === m.id)?.a;
        return (
          <button key={m.id} type="button" disabled={!isNum(v) || !metric} onClick={() => metric && open({ metric, from: r.meta.from, to: r.meta.to, branchIds: r.meta.branchIds, filters: r.spec.filters, exclude: r.spec.exclude, where: t('الإجمالي') })}
            className="text-start rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)] px-4 py-3 hover:border-[var(--primary)]/50 transition-colors min-w-0 disabled:cursor-default" data-fb={`kpi:${m.id}`}>
            <div className="text-xs text-soft truncate">{columnLabel(m, view, lang())}</div>
            <div className={cn('mt-1 text-2xl font-extrabold num tabular-nums truncate', isNum(v) && Number(v!.value) < 0 && 'text-[var(--error)]')}>
              {v?.availability === 'NOT_AVAILABLE' ? <span className="text-base font-bold text-dim">{t('مش متاح')}</span> : <CellVal v={v} m={m} view={view} />}
            </div>
            {isNum(chg) ? (
              <div className={cn('mt-0.5 text-xs inline-flex items-center gap-1 num', Number(chg!.value) >= 0 ? 'text-[var(--success)]' : 'text-[var(--error)]')}>
                {Number(chg!.value) >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}{Number(chg!.value) >= 0 ? '+' : ''}{Number(chg!.value).toFixed(1)}%
                <span className="text-dim">{r.meta.compare ? L(r.meta.compare.label) : ''}</span>
              </div>
            ) : chg?.availability === 'NOT_AVAILABLE' ? <div className="mt-0.5 text-[11px] text-dim truncate" title={L(chg.reason)}>{t('المقارنة مش متاحة')}</div> : v?.availability === 'NOT_AVAILABLE' ? <div className="mt-0.5 text-[11px] text-dim line-clamp-2">{L(v.reason)}</div> : null}
          </button>
        );
      })}
    </div></div>
  );
}

/** One simple chart of the first number over the first breakdown (bars, or columns over time). */
export function MiniChart({ r, kind, view }: { r: PivotResult; kind: 'bars' | 'line' | 'none'; view?: ColumnView[] }) {
  const open = useEvidence();
  if (kind === 'none' || !r.rows.length) return null;
  const m = orderedMeasures(r, view).find((x) => x.kind === 'value' && x.unit !== '%');
  if (!m) return null;
  const pts = r.root.children.filter((n) => isNum(n.cells['']?.[m.id])).slice(0, kind === 'line' ? 40 : 12);
  if (pts.length < 2) return null;
  const vals = pts.map((n) => Number(n.cells[''][m.id].value));
  const max = Math.max(1, ...vals.map(Math.abs));
  const ev = (n: PivotNode) => open({ metric: m.metric!, cell: n.path, from: r.meta.from, to: r.meta.to, branchIds: r.meta.branchIds, filters: r.spec.filters, exclude: r.spec.exclude, where: wherePath(r, n) });
  if (kind === 'line') {
    const W = 720, H = 150, step = W / pts.length;
    return (
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)] p-3" data-fb="report-chart">
        <div className="text-xs text-soft mb-1">{columnLabel(m, view, lang())} — {L(r.dimLabels[r.rows[0]])}</div>
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-44" role="img">
          {[0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={H - g * (H - 8)} y2={H - g * (H - 8)} stroke="currentColor" strokeOpacity="0.07" />)}
          {pts.map((n, i) => { const h = (Math.abs(vals[i]) / max) * (H - 8); return (
            <g key={n.id} className="cursor-pointer" onClick={() => ev(n)}>
              <rect x={i * step + step * 0.18} y={H - h} width={step * 0.64} height={Math.max(1, h)} rx="4" fill="var(--primary)" fillOpacity="0.8"><title>{`${L(n.label)}: ${fmtCell(n.cells[''][m.id], m, view)}`}</title></rect>
              {(pts.length <= 14 || i % 2 === 0) && <text x={i * step + step / 2} y={H + 15} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.55">{L(n.label).slice(-5)}</text>}
            </g>); })}
        </svg>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--card-raised)] p-3 space-y-1.5" data-fb="report-chart">
      <div className="text-xs text-soft">{columnLabel(m, view, lang())} — {L(r.dimLabels[r.rows[0]])}</div>
      {pts.map((n, i) => (
        <button key={n.id} type="button" onClick={() => ev(n)} className="w-full flex items-center gap-3 text-sm rounded-lg px-1.5 py-0.5 hover:surface-1">
          <span className="w-40 truncate text-start">{L(n.label)}</span>
          <span className="flex-1 h-2.5 rounded-full surface-2 overflow-hidden"><span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${(Math.abs(vals[i]) / max) * 100}%`, opacity: 0.85 }} /></span>
          <span className="w-32 text-end tabular-nums text-xs"><CellVal v={n.cells[''][m.id]} m={m} view={view} /></span>
        </button>
      ))}
    </div>
  );
}
export function DefinitionsList({ r }: { r: PivotResult }) {
  return (
    <div className="grid @3xl/main:grid-cols-2 gap-2" data-fb="report-definitions">
      {r.measures.map((m) => (
        <div key={m.id} className="rounded-xl surface-1 px-3 py-2 text-xs space-y-0.5">
          <div className="font-bold text-sm">{L(m.label)}</div>
          {m.formula && <div className="text-soft">{L(m.formula)}</div>}
          {m.kind === 'value' && <DefOf id={m.id} />}
        </div>
      ))}
      <div className="rounded-xl surface-1 px-3 py-2 text-xs text-soft flex items-start gap-1.5 @3xl/main:col-span-2"><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[var(--success)] shrink-0" />{t('كل إجمالي وإجمالي فرعي بيتحسب من جديد من السجلات — النسب من مجاميعها، والعدد من غير تكرار، والمخزون لقطة في لحظة واحدة. «مش متاح» معناه إن البيانات مش موجودة، مش صفر.')}</div>
    </div>
  );
}
function DefOf({ id }: { id: string }) {
  const reg = useRegistry(); const m = reg.metric(id);
  if (!m) return null;
  return <><div className="text-soft">{L(m.definition)}</div>{m.pitfalls?.length > 0 && <div className="text-[var(--warning-text)] flex gap-1"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{m.pitfalls.map((p: any) => L(p)).join(' ')}</div>}</>;
}
