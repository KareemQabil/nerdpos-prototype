// Renders one certified report (L2 manifest run by the engine): header, blocks, reconciliation, expert review.
// No finance logic here — every number comes from Report.Run and opens its evidence (Report.Explain).
import React, { useState } from 'react';
import { ArrowDown, Equal, Wallet, Scale, Layers, Info, FileText } from 'lucide-react';
import { Card, Pill, Table, Banner, Button } from '../../ui';
import { t, L } from '../../i18n';
import { cn } from '../../lib/format';
import { Tech } from '../../app/tech';
import { Val, fmt, ReportHeader, ReconList, useEvidence, type EvidenceSpec } from './parts';
import { ExpertReview } from './ExpertReview';

const AUD: Record<string, string> = { owner: 'صاحب المطعم', accountant: 'المحاسب', manager: 'المدير', cashier: 'الكاشير', auditor: 'المراجع', chef: 'الشيف', stock_manager: 'أمين المخزن', buyer: 'المشتريات', floor_manager: 'مدير الصالة', delivery_manager: 'مدير الدليفري', marketing: 'التسويق' };
const metaOf = (run: any, id: string) => run.header.metrics.find((m: any) => m.id === id);
const unitOf = (run: any, id: string) => metaOf(run, id)?.unit;

function Kpis({ run, b }: { run: any; b: any }) {
  const r = b.result;
  return (
    <div className="grid grid-cols-2 @3xl/main:grid-cols-3 @6xl/main:grid-cols-5 gap-2">
      {b.metrics.map((m: string) => {
        const v = r.totals[m];
        const meta = metaOf(run, m);
        return (
          <div key={m} className="rounded-xl surface-1 px-3 py-2.5 min-w-0" data-metric={m}>
            <div className="text-xs text-soft truncate" title={L(meta?.definition)}>{L(meta?.label) || m}</div>
            <div className="mt-0.5"><Val v={v} unit={meta?.unit} big spec={{ metric: m, from: run.period.from, to: run.period.to, branchIds: run.branchIds, filters: b.filters }} /></div>
            {v?.availability === 'NOT_AVAILABLE' && <div className="text-[10px] text-dim mt-0.5 line-clamp-2">{L(v.reason)}</div>}
            {v?.availability === 'AVAILABLE' && v.reason && <div className="text-[10px] text-dim mt-0.5 line-clamp-2">{L(v.reason)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function QTable({ run, b }: { run: any; b: any }) {
  const r = b.result;
  if (!r.rows.length) return <div className="text-sm text-dim py-2">{t('مفيش بيانات في الفترة دي')}</div>;
  const spec = (m: string, row?: any): EvidenceSpec => ({ metric: m, cell: row?.dims, from: run.period.from, to: run.period.to, branchIds: run.branchIds, filters: b.filters });
  return (
    <Table dense maxHeight={420} align={[...r.dimensions.map(() => 'start' as const), ...r.metrics.map(() => 'end' as const)]}
      head={[...r.dimensions.map((d: string) => t(DIM_AR[d] ?? d)), ...r.metrics.map((m: string) => L(metaOf(run, m)?.label) || m)]}
      rows={[
        ...r.rows.map((row: any) => [...r.dimensions.map((d: string) => <span className="font-medium">{L(row.labels[d])}{row.source === 'HISTORY' && <Pill size="sm" tone="neutral" className="ms-1">{t('إجمالي مستورد')}</Pill>}</span>), ...r.metrics.map((m: string) => <Val v={row.values[m]} unit={unitOf(run, m)} spec={spec(m, row)} />)]),
        [<span className="font-bold text-soft">{t('الإجمالي')} <span className="text-[10px] font-normal text-dim">({t('محسوب من جديد')})</span></span>, ...r.dimensions.slice(1).map(() => ''), ...r.metrics.map((m: string) => <Val v={r.totals[m]} unit={unitOf(run, m)} spec={spec(m)} />)],
      ]} />
  );
}
const DIM_AR: Record<string, string> = { business_date: 'اليوم', business_week: 'الأسبوع', daypart: 'الفترة', hour: 'الساعة', branch: 'الفرع', channel: 'القناة', staff: 'الموظف', product: 'الصنف', category: 'القسم', payment_method: 'طريقة الدفع', drawer: 'الوردية', void_reason: 'السبب', approval_actor: 'اللي وافق', stage: 'المرحلة', disposition: 'المصير', station: 'المحطة', inventory_item: 'الخامة', supplier: 'المورد', fiscal_status: 'حالة الإيصال', order: 'الأوردر', check: 'الشيك', table: 'الترابيزة' };

function Bars({ run, b }: { run: any; b: any }) {
  const r = b.result; const m = b.metrics[0]; const d = r.dimensions[0];
  const open = useEvidence();
  const max = Math.max(1, ...r.rows.map((x: any) => Number(x.values[m]?.value ?? 0)));
  return (
    <div className="space-y-1.5">
      {r.rows.map((row: any) => (
        <button key={row.key} type="button" onClick={() => open({ metric: m, cell: row.dims, from: run.period.from, to: run.period.to, branchIds: run.branchIds })} className="w-full flex items-center gap-2 text-sm hover:surface-1 rounded-md px-1" data-fb={`bar:${row.key}`}>
          <span className="w-36 truncate text-start">{L(row.labels[d])}</span>
          <div className="flex-1 h-3 rounded-full surface-2 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-l from-cyan-400 to-violet-500" style={{ width: `${(Number(row.values[m]?.value ?? 0) / max) * 100}%` }} /></div>
          <span className="num text-xs w-28 text-end">{fmt(row.values[m]?.value, unitOf(run, m))}</span>
          {b.metrics[1] && <span className="num text-[11px] text-dim w-20 text-end">{fmt(row.values[b.metrics[1]]?.value, unitOf(run, b.metrics[1]))}</span>}
        </button>
      ))}
      {!r.rows.length && <div className="text-sm text-dim">{t('مفيش بيانات في الفترة دي')}</div>}
    </div>
  );
}

function Line({ run, b }: { run: any; b: any }) {
  const r = b.result; const m = b.metrics[0]; const d = r.dimensions[0];
  const open = useEvidence();
  const pts = r.rows.map((x: any) => ({ k: x.key, label: L(x.labels[d]), v: Number(x.values[m]?.value ?? 0), dims: x.dims, hist: x.source === 'HISTORY' }));
  if (!pts.length) return <div className="text-sm text-dim">{t('مفيش بيانات في الفترة دي')}</div>;
  const max = Math.max(1, ...pts.map((p: any) => p.v)); const W = 640, H = 170, step = W / Math.max(1, pts.length);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H + 26}`} className="w-full h-52" role="img">
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1="0" x2={W} y1={H - g * (H - 10)} y2={H - g * (H - 10)} stroke="currentColor" strokeOpacity="0.08" />)}
        {pts.map((p: any, i: number) => { const h = (p.v / max) * (H - 10); return (
          <g key={p.k} className="cursor-pointer" onClick={() => open({ metric: m, cell: p.dims, from: run.period.from, to: run.period.to, branchIds: run.branchIds })}>
            <rect x={i * step + step * 0.15} y={H - h} width={step * 0.7} height={Math.max(h, 1)} rx="4" fill={p.hist ? '#a78bfa' : '#22d3ee'} fillOpacity="0.85"><title>{`${p.label}: ${fmt(String(p.v), unitOf(run, m))}`}</title></rect>
            {(pts.length <= 14 || i % 2 === 0) && <text x={i * step + step / 2} y={H + 16} textAnchor="middle" fontSize="10" fill="currentColor" fillOpacity="0.6">{p.label.replace(':00', '').slice(-5)}</text>}
          </g>); })}
      </svg>
      {pts.some((p: any) => p.hist) && <div className="text-[11px] text-dim">{t('البنفسجي = إجمالي يومي مستورد من قبل التشغيل (من غير شيكات).')}</div>}
    </div>
  );
}

/** EOD money bridge: gross → discounts → net → service → VAT → billed, vs collected/refunded; gap explained by events. */
export function Bridge({ run, br }: { run: any; br: any }) {
  const open = useEvidence();
  const spec = (metric?: string, filter?: any): EvidenceSpec | null => (metric ? { metric, filters: filter, from: run.period.from, to: run.period.to, branchIds: run.branchIds } : null);
  const Row = ({ x }: { x: any }) => (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg', x.total ? 'surface-2 font-bold' : 'surface-1')}>
      {x.total ? <Equal className="w-3.5 h-3.5 text-dim" /> : x.sign < 0 ? <ArrowDown className="w-3.5 h-3.5 text-[var(--error)]" /> : <span className="w-3.5 text-center text-[var(--success)]">+</span>}
      <span className="flex-1 text-sm">{L(x.label).replace(/^[=+−-]\s*/, '')}{x.note && <span className="block text-[10px] text-dim font-normal">{L(x.note)}</span>}</span>
      <Val v={{ value: x.amount, availability: 'AVAILABLE' }} spec={spec(x.metric, x.filter)} />
    </div>
  );
  const g = br.gap;
  return (
    <div className="space-y-3" data-fb="eod-bridge">
      <div className="grid @4xl/main:grid-cols-2 gap-3">
        <div className="space-y-1"><div className="text-xs font-bold text-soft flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{t('من المبيعات للفواتير')}</div>{br.sales.map((x: any) => <Row key={x.id} x={x} />)}</div>
        <div className="space-y-1"><div className="text-xs font-bold text-soft flex items-center gap-1"><Wallet className="w-3.5 h-3.5" />{t('الفلوس اللي دخلت وخرجت')}</div>{br.money.map((x: any) => <Row key={x.id} x={x} />)}</div>
      </div>
      <div className={cn('rounded-xl p-3 border', g.status === 'UNEXPLAINED' ? 'border-[var(--error)]' : 'border-[var(--glass-border)]')} data-fb="bridge-gap">
        <div className="flex items-center gap-2 flex-wrap text-sm"><Scale className="w-4 h-4" /><b>{t('الفواتير − المتحصل')}</b> = <span className="num">{fmt(g.billed)} − {fmt(g.collected)} = <b>{fmt(g.difference)}</b></span>
          <Pill tone={g.status === 'MATCHED' ? 'success' : g.status === 'EXPLAINED' ? 'info' : 'error'} size="sm">{g.status === 'MATCHED' ? t('متساويين') : g.status === 'EXPLAINED' ? t('الفرق متشرح بالكامل') : t('فيه فرق مش متشرح')}</Pill></div>
        <div className="mt-2 space-y-1">
          {g.explanations.map((e: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm"><span className="flex-1">• {L(e.label)}</span><span className="num">{fmt(e.amount)}</span>
              <Button size="sm" variant="ghost" onClick={() => open({ metric: '__list', label: L(e.label), from: '', filters: { __evidence: e.evidence } })} data-fb={`gap-evidence:${i}`}>{t('{n} سجل', { n: e.evidence.length })}</Button></div>
          ))}
          <div className="flex items-center gap-2 text-sm font-bold"><span className="flex-1">{t('غير مفسَّر')}</span><span className={cn('num', Number(g.unexplained) !== 0 && 'text-[var(--error)]')}>{fmt(g.unexplained)}</span></div>
        </div>
        <div className="text-[11px] text-dim mt-1">{t('المبيعات والتحصيل مقاييس مختلفة — مش لازم يتساووا، بس كل فرق لازم يتشرح بحركات مربوطة.')}</div>
      </div>
      <div className="grid @3xl/main:grid-cols-2 gap-1.5">
        {br.outside.map((x: any) => (
          <div key={x.id} className="rounded-lg surface-1 px-3 py-1.5 text-sm flex items-center gap-2"><Info className="w-3.5 h-3.5 text-dim" /><span className="flex-1">{L(x.label)}<span className="block text-[10px] text-dim">{L(x.note)}</span></span><Val v={{ value: x.amount, availability: 'AVAILABLE' }} spec={spec(x.metric)} /></div>
        ))}
      </div>
    </div>
  );
}

export function Drawers({ run, drawers }: { run: any; drawers: any[] }) {
  const open = useEvidence();
  if (!drawers.length) return <div className="text-sm text-dim">{t('مفيش ورديات في الفترة دي')}</div>;
  return (
    <div className="grid @4xl/main:grid-cols-2 gap-3" data-fb="drawer-bridge">
      {drawers.map((d) => (
        <div key={d.sessionId} className="rounded-xl surface-1 p-3 space-y-1">
          <div className="font-bold text-sm flex items-center gap-2">{d.label}<Pill size="sm" tone={d.state === 'OPEN' ? 'warning' : 'neutral'}>{d.state === 'OPEN' ? t('مفتوحة') : t('مقفولة')}</Pill></div>
          {d.lines.map((l: any) => (
            <button key={l.kind} type="button" onClick={() => open({ metric: '__list', label: l.label, from: '', filters: { __evidence: l.evidence } })} className="w-full flex justify-between text-sm hover:surface-2 rounded px-1"><span>{l.label} <span className="text-[10px] text-dim">({l.evidence.length})</span></span><span className="num">{fmt(l.amount)}</span></button>
          ))}
          <div className="flex justify-between text-sm font-bold border-t line pt-1"><span>{t('= المتوقع')}</span><span className="num">{fmt(d.expected)}</span></div>
          <div className="flex justify-between text-sm"><span>{t('المعدود')}</span><span className="num">{d.counted === null ? t('لسه ما اتعدش') : fmt(d.counted)}</span></div>
          {d.variance !== null && <div className={cn('flex justify-between text-sm font-bold', Number(d.variance) < 0 && 'text-[var(--error)]', Number(d.variance) > 0 && 'text-[var(--warning-text)]')}><span>{t('الفرق')}</span><span className="num">{fmt(d.variance)}</span></div>}
          {d.reason && <div className="text-xs text-soft">{t('سبب الكاشير')}: {d.reason}{d.approvedBy ? ` — ${t('بموافقة')} ${d.approvedBy}` : ''}</div>}
          <div className="flex flex-wrap gap-1 pt-1">{d.checks.map((c: any) => <Pill key={c.id} size="sm" tone={c.status === 'MATCHED' ? 'success' : c.status === 'EXPLAINED' ? 'info' : 'error'} title={c.equation}>{L(c.title)}</Pill>)}</div>
        </div>
      ))}
    </div>
  );
}

const CLASS_TONE: Record<string, string> = { STAR: '#22c55e', PLOWHORSE: '#3b82f6', PUZZLE: '#f59e0b', DOG: '#ef4444', COST_UNAVAILABLE: '#94a3b8' };
export function Matrix({ run, mm }: { run: any; mm: any }) {
  const open = useEvidence();
  const items = mm.items;
  const withCm = items.filter((i: any) => i.cmPerUnit !== null);
  const maxPop = Math.max(1, ...items.map((i: any) => Number(i.popularity)));
  const cms = withCm.map((i: any) => Number(i.cmPerUnit));
  const minCm = Math.min(0, ...cms), maxCm = Math.max(1, ...cms);
  const W = 560, H = 300;
  const x = (p: number) => 30 + (p / maxPop) * (W - 50); const y = (c: number) => H - 25 - ((c - minCm) / (maxCm - minCm || 1)) * (H - 45);
  return (
    <div className="space-y-2" data-fb="menu-matrix">
      <div className="grid @4xl/main:grid-cols-[1.3fr_1fr] gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-72 surface-1 rounded-xl">
          {mm.thresholds.contributionPerUnit && <line x1="30" x2={W - 10} y1={y(Number(mm.thresholds.contributionPerUnit))} y2={y(Number(mm.thresholds.contributionPerUnit))} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="4 3" />}
          <line x1={x(Number(mm.thresholds.popularityPct))} x2={x(Number(mm.thresholds.popularityPct))} y1="10" y2={H - 25} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="4 3" />
          <text x={W - 12} y={H - 8} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.6">{t('الشعبية ←')}</text>
          <text x="34" y="18" fontSize="10" fill="currentColor" fillOpacity="0.6">{t('الهامش للقطعة ↑')}</text>
          {withCm.map((i: any) => <g key={i.product} className="cursor-pointer" onClick={() => open({ metric: 'menu_contribution', cell: { product: i.product }, from: run.period.from, to: run.period.to, branchIds: run.branchIds })}><circle cx={x(Number(i.popularity))} cy={y(Number(i.cmPerUnit))} r="6" fill={CLASS_TONE[i.class]} fillOpacity="0.85"><title>{`${L(i.label)} — ${t(L(mm.classes[i.class]))}`}</title></circle></g>)}
        </svg>
        <div className="space-y-1.5">
          {['STAR', 'PLOWHORSE', 'PUZZLE', 'DOG', 'COST_UNAVAILABLE'].map((c) => { const xs = items.filter((i: any) => i.class === c); return (
            <div key={c} className="rounded-lg surface-1 p-2">
              <div className="flex items-center gap-2 text-sm font-bold"><span className="w-3 h-3 rounded-full" style={{ background: CLASS_TONE[c] }} />{L(mm.classes[c])} <span className="text-dim num text-xs">{xs.length}</span></div>
              <div className="text-[11px] text-dim">{L(mm.classes[c].advice)}</div>
              <div className="text-xs mt-0.5">{xs.slice(0, 8).map((i: any) => L(i.label)).join('، ') || '—'}</div>
            </div>); })}
        </div>
      </div>
      <div className="text-[11px] text-dim">{t('حد الشعبية = 70% من النصيب المتساوي ({p}%)، وحد الهامش = متوسط الهامش المرجح ({c}). التكلفة من الوصفة اللي كانت شغالة وقت البيع.', { p: Number(mm.thresholds.popularityPct).toFixed(1), c: mm.thresholds.contributionPerUnit ? fmt(mm.thresholds.contributionPerUnit) : '—' })}</div>
    </div>
  );
}

function EvidenceList({ b }: { b: any }) {
  const ev = b.evidence.parts.flatMap((p: any) => p.evidence);
  const open = useEvidence();
  return (
    <Table dense maxHeight={360} head={[t('السجل'), t('اليوم'), t('المبلغ')]} align={['start', 'start', 'end']} empty={<div className="text-sm text-dim p-2">{t('مفيش سجلات في الفترة دي')}</div>}
      onRowClick={(i) => ev[i].orderId && open({ metric: '__list', label: ev[i].label, from: '', filters: { __evidence: [ev[i]] } })}
      rows={ev.map((e: any) => [e.label, <span className="num text-xs">{e.businessDate}</span>, <span className="num">{fmt(e.amount)}</span>])} />
  );
}

export function ReportView({ run, onTemplate }: { run: any; onTemplate: () => void }) {
  const [recon, setRecon] = useState(false);
  return (
    <div className="space-y-3" data-fb="reports:result">
      <ReportHeader h={run.header} onShowRecon={() => setRecon(!recon)} />
      {recon && <Card title={t('قواعد المطابقة للفترة')} description={t('كل قاعدة يا متطابقة، يا الفرق متشرح بحركات مربوطة، يا بتتعلم «مش متشرح».')}><ReconList checks={run.bridgeChecks} /></Card>}
      <div className="text-sm text-soft flex items-start gap-2"><Info className="w-4 h-4 mt-0.5 shrink-0" /><span>{L(run.manifest.purpose)} <span className="text-dim">{t('القرار')}: {L(run.manifest.decision)} · {t('بيتابعه')}: {run.manifest.audience.map((a: string) => t(AUD[a] ?? a)).join('، ')} · {t('التنقل')}: {L(run.manifest.drilldown)}</span></span></div>
      {run.manifest.notes?.map((n: any, i: number) => <Banner key={i} tone="info">{L(n)}</Banner>)}
      {run.blocks.map((b: any) => (
        <Card key={b.id} title={L(b.title)} className="min-w-0" data-fb={`block:${b.id}`} actions={<Tech><span className="num text-[10px] text-dim" dir="ltr">{b.kind} · {b.metrics.join(',')}{b.dimensions?.length ? ' × ' + b.dimensions.join(',') : ''}</span></Tech>}>
          {b.note && <div className="text-xs text-dim mb-2">{L(b.note)}</div>}
          {b.result?.meta.refused.map((x: any, i: number) => <Banner key={i} tone="warning">{L(x.reason)}</Banner>)}
          {b.kind === 'kpis' && <Kpis run={run} b={b} />}
          {b.kind === 'table' && <QTable run={run} b={b} />}
          {b.kind === 'bars' && <Bars run={run} b={b} />}
          {b.kind === 'line' && <Line run={run} b={b} />}
          {b.kind === 'bridge' && <Bridge run={run} br={b.bridge} />}
          {b.kind === 'drawers' && <Drawers run={run} drawers={b.drawers} />}
          {b.kind === 'matrix' && <Matrix run={run} mm={b.matrix} />}
          {b.kind === 'evidence' && <EvidenceList b={b} />}
        </Card>
      ))}
      <div className="flex justify-end"><Button size="sm" variant="outline" onClick={onTemplate} data-fb="reports:template"><FileText className="w-4 h-4" />{t('عرض كقالب (A4 / إيصال)')}</Button></div>
      <ExpertReview reportId={run.reportId} reportTitle={L(run.title)} checklist={run.checklist} />
    </div>
  );
}
