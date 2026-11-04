// Shared pieces of the reports UI: value formatting by unit, clickable numbers (→ evidence), availability pills,
// the report header (business date, timezone, asOf, provisional/closed, definitions + versions, reconciliation).
import React, { createContext, useContext, useState } from 'react';
import { ShieldCheck, ShieldAlert, Clock, Info, CheckCircle2, AlertTriangle, BookOpen, ChevronDown } from 'lucide-react';
import { Pill, Card, Button, Money, DateTime } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { cn, CURRENCY } from '../../lib/format';
import { Tech } from '../../app/tech';

export type Loc = { ar: string; en: string };
export interface EvidenceSpec { metric: string; cell?: Record<string, string | null>; filters?: Record<string, any>; exclude?: Record<string, any>; from: string; to?: string; branchIds?: string[]; asOf?: string; label?: string; where?: string }

/** Any number in a report can open its evidence; the page provides the opener. */
export const EvidenceCtx = createContext<(s: EvidenceSpec) => void>(() => {});
export const useEvidence = () => useContext(EvidenceCtx);

export function fmt(v: string | null | undefined, unit?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const loc = 'en-US';
  if (unit === 'count' || unit === 'unit') return Number.isInteger(n) ? n.toLocaleString(loc) : n.toLocaleString(loc, { maximumFractionDigits: 2 });
  if (unit === '%') return `${n.toFixed(1)}%`;
  if (unit === 'minutes') return `${n.toFixed(1)} ${t('دقيقة')}`;
  if (unit === 'hours') return `${n.toFixed(1)} ${t('ساعة')}`;
  return `${n.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;
}
/** A report number for the screen: money as <Money> (number in `.num`, «ج.م» after it in reading order), any other unit as
 *  a `.num` span. fmt() keeps the currency for running text and titles only (scripts/check-money.mjs). */
export function Amt({ v, unit, className }: { v: string | number | null | undefined; unit?: string; className?: string }) {
  const txt = fmt(v === null || v === undefined ? v : String(v), unit);
  const suffix = ' ' + CURRENCY;
  return txt.endsWith(suffix) ? <Money text={txt.slice(0, -suffix.length)} className={cn('font-bold', className)} /> : <span className={cn('num', className)}>{txt}</span>;
}

/** One metric value: number (clickable → evidence), or a plain «مش متاح» / «اترفض» / «—» with the reason on hover. */
export function Val({ v, unit, spec, big, className }: { v: any; unit?: string; spec?: EvidenceSpec | null; big?: boolean; className?: string }) {
  const open = useEvidence();
  if (!v) return <span className="text-dim">—</span>;
  if (v.availability === 'NOT_AVAILABLE') return <Pill tone="neutral" size="sm" title={L(v.reason)}><span data-fb="na-pill">{t('مش متاح')}</span></Pill>;
  if (v.availability === 'REFUSED') return <Pill tone="warning" size="sm" title={L(v.reason)}>{t('اترفض')}</Pill>;
  if (v.availability === 'NOT_DEFINED') return <span className="text-dim" title={L(v.reason)}>—</span>;
  const neg = Number(v.value) < 0;
  const txt = <Amt v={v.value} unit={unit} className={cn(big ? 'text-2xl font-extrabold' : 'font-bold', neg && 'text-[var(--error)]', className)} />;
  if (!spec) return txt;
  return (
    <button type="button" onClick={() => open(spec)} data-fb={`evidence:${spec.metric}`} title={t('اعرض الشيكات والسجلات اللي ورا الرقم ده')}
      className="underline decoration-dotted underline-offset-4 decoration-[var(--primary)]/60 hover:decoration-solid hover:text-[var(--primary)] cursor-pointer">{txt}</button>
  );
}

export const STATUS_TONE: Record<string, 'success' | 'info' | 'error' | 'neutral'> = { MATCHED: 'success', EXPLAINED: 'info', UNEXPLAINED: 'error', NOT_RUN: 'neutral' };
export const statusText = (s: string) => (s === 'MATCHED' ? t('متطابق') : s === 'EXPLAINED' ? t('الفرق متشرح') : s === 'UNEXPLAINED' ? t('فرق مش متشرح') : t('ما اتشغلش'));
const dayText = (s: string) => (s === 'CLOSED' ? t('مقفول') : s === 'OPEN' ? t('مفتوح') : s === 'ENDED_NOT_CLOSED' ? t('خلص ومستني الإقفال') : t('لسه ما جاش'));
export const additivityText = (a: string) => (a === 'ADD' ? t('بيتجمع') : a === 'SEMI_ADDITIVE' ? t('لقطة — ما بيتجمعش على الأيام') : a === 'WEIGHTED_RATIO' ? t('نسبة من المجاميع') : t('بيتحسب من جديد (مش بيتجمع)'));
export const authorityText = (a: string) => (a === 'CANONICAL' ? t('معتمد في العقد') : a === 'MARKET' ? t('عُرف السوق') : t('مقترح'));

/** The report header every report shows (business date, tz, asOf, provisional/closed, definitions, reconciliation). */
export function ReportHeader({ h, onShowRecon }: { h: any; onShowRecon?: () => void }) {
  const [defs, setDefs] = useState(false);
  const rec = h.reconciliation;
  return (
    <Card padding="sm" className="space-y-2" data-fb="report-header">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Pill tone="neutral"><Clock className="w-3.5 h-3.5 inline me-1" />{t('اليوم التجاري')}: <span className="num ms-1">{h.period.from}{h.period.to !== h.period.from ? ` → ${h.period.to}` : ''}</span></Pill>
        <Pill tone="neutral">{t('توقيت القاهرة — اليوم بيبدأ {c}', { c: h.cutoff })}<Tech><span className="num ms-1">Africa/Cairo</span></Tech></Pill>
        <Pill tone="neutral">{t('لحد')} <DateTime v={h.asOf} className="ms-1" /></Pill>
        {h.provisional ? <Pill tone="warning" dot title={h.provisionalReasons.map((x: Loc) => L(x)).join(' ')}>{t('مبدئي')}</Pill> : <Pill tone="success" dot>{t('نهائي — الأيام مقفولة')}</Pill>}
        <button type="button" onClick={onShowRecon} data-fb="report:recon-status" className="inline-flex"><Pill tone={STATUS_TONE[rec.status]} dot>{rec.status === 'UNEXPLAINED' ? <ShieldAlert className="w-3.5 h-3.5 inline me-1" /> : <ShieldCheck className="w-3.5 h-3.5 inline me-1" />}{t('المطابقة')}: {statusText(rec.status)} <span className="num ms-1 opacity-70">({rec.counts.MATCHED}✓ {rec.counts.EXPLAINED ? `${rec.counts.EXPLAINED}≈ ` : ''}{rec.counts.UNEXPLAINED ? `${rec.counts.UNEXPLAINED}✗` : ''})</span></Pill></button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setDefs(!defs)} data-fb="report:definitions"><BookOpen className="w-4 h-4" />{t('التعريفات والنسخ')} <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', defs && 'rotate-180')} /></Button>
      </div>
      {h.days.length <= 7 && h.days.length > 1 && <div className="flex flex-wrap gap-1 text-[11px]">{h.days.map((d: any) => <span key={d.date} className={cn('px-2 py-0.5 rounded-md surface-1', d.status === 'OPEN' && 'text-[var(--warning-text)]')}><span className="num">{d.date.slice(5)}</span> {dayText(d.status)}</span>)}</div>}
      {h.provisional && <div className="text-xs text-[var(--warning-text)] flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{h.provisionalReasons.map((x: Loc) => L(x)).join(' ')}</div>}
      {h.preLaunch && <div className="text-xs text-dim flex items-start gap-1"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{t('الأيام قبل {d} عندها إجماليات يومية مستوردة بس (من غير شيكات) — أي رقم محتاج تفاصيل بيطلع «مش متاح» للأيام دي.', { d: h.launchDate })}</div>}
      {defs && (
        <div className="grid @3xl/main:grid-cols-2 gap-2 pt-1" data-fb="report:definitions-list">
          {h.metrics.map((m: any) => (
            <div key={m.id} className="rounded-lg surface-1 p-2 text-xs space-y-0.5">
              <div className="font-bold text-sm flex items-center gap-1.5 flex-wrap">{L(m.label)} <Pill size="sm" tone={m.status === 'AVAILABLE' ? 'neutral' : 'warning'}>{m.status === 'AVAILABLE' ? t('نسخة {v}', { v: m.version }) : t('مش متاح')}</Pill><Pill size="sm" tone={m.authority === 'CANONICAL' ? 'success' : m.authority === 'MARKET' ? 'info' : 'neutral'}>{authorityText(m.authority)}</Pill></div>
              <div className="text-soft">{L(m.definition)}</div>
              {m.reason && <div className="text-[var(--warning-text)]">{L(m.reason)}</div>}
              <div className="text-dim">{additivityText(m.additivity)}{m.pitfalls?.length ? ` · ${t('تنبيه')}: ${m.pitfalls.map((p: Loc) => L(p)).join(' ')}` : ''}</div>
              <Tech><div className="num text-[10px] text-dim" dir="ltr">{m.id} · {m.formula}</div></Tech>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Reconciliation checks list (doc 27 §5 + research 06). */
export function ReconList({ checks }: { checks: any[] }) {
  const open = useEvidence();
  return (
    <div className="space-y-1.5" data-fb="recon-checks">
      {checks.map((c) => (
        <div key={c.id} className="rounded-lg surface-1 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 flex-wrap">
            {c.status === 'MATCHED' ? <CheckCircle2 className="w-4 h-4 text-[var(--success)]" /> : c.status === 'EXPLAINED' ? <Info className="w-4 h-4 text-[var(--info)]" /> : <ShieldAlert className="w-4 h-4 text-[var(--error)]" />}
            <span className="font-bold">{L(c.title)}</span>
            <Pill size="sm" tone={STATUS_TONE[c.status]}>{statusText(c.status)}</Pill>
            {Number(c.difference) !== 0 && <span className="text-xs">{t('الفرق')} <Amt v={c.difference} /></span>}
            <Tech><span className="num text-[10px] text-dim" dir="ltr">{c.id}: {c.equation}</span></Tech>
          </div>
          {c.explanations?.map((e: any, i: number) => (
            <div key={i} className="text-xs text-soft ms-6 mt-1 flex items-center gap-2 flex-wrap">• {L(e.label)} <Amt v={e.amount} />
              {e.evidence?.length > 0 && <button type="button" className="text-[var(--primary)] underline" onClick={() => open({ metric: '__list', label: L(e.label), from: '', filters: { __evidence: e.evidence } })}>{t('{n} سجل', { n: e.evidence.length })}</button>}
            </div>
          ))}
          {c.note && <div className="text-[11px] text-dim ms-6">{L(c.note)}</div>}
        </div>
      ))}
    </div>
  );
}
