// L4 evidence: the exact checks / lines / payments / refunds / drawer entries behind one number, with the proof that
// they add up to it, and a link to open each check. Calls Report.Explain (server) — never recomputed in the browser.
// ux-06: a centered popup over the report (sized to the evidence, header fixed, body scrolls), never a side sheet.
import React from 'react';
import { Receipt, CheckCircle2, AlertTriangle, ExternalLink, FileSearch } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { Popup, Spinner, Banner, Pill, Table, Button, StateBadge, DateTime } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { rangeText } from '../../reports/format';
import { Tech } from '../../app/tech';
import { fmt, Amt, type EvidenceSpec } from './parts';

const KIND: Record<string, string> = { CHECK: 'شيك', LINE: 'سطر', PAYMENT: 'دفعة', REFUND: 'مرتجع', CASH_ENTRY: 'حركة درج', SESSION: 'وردية', REMOVAL: 'إلغاء', DISCOUNT: 'خصم', STAFF_MEAL: 'وجبة موظف', TICKET: 'تذكرة مطبخ', FISCAL: 'إيصال', APPROVAL: 'موافقة', STOCK: 'مخزن', WASTE: 'هالك', PO: 'أمر شراء', GRN: 'استلام', VISIT: 'قعدة', DELIVERY: 'دليفري', HISTORY: 'إجمالي يوم', RESERVATION: 'حجز', RECON: 'قاعدة مطابقة' };
const NOTE: Record<string, string> = { 'rider-shift-pay': 'أجر الطيار بالوردية — لا تكلفة للمشوار', 'partner-commission': 'طلب من تطبيق — العمولة غير مسجلة', 'stage-derived': 'المرحلة مستنتجة من الأحداث', 'no-recipe': 'من غير وصفة — التكلفة مش متاحة', 'cost-current': 'تكلفة حالية (مفيش تاريخ)', 'aggregate-only': 'إجمالي مستورد — من غير شيكات', 'in-flight': 'لسه في المطبخ', 'same-order (counted once)': 'نفس الأوردر — اتعد مرة واحدة' };

function Rows({ rows, unit, onOpen }: { rows: any[]; unit?: string; onOpen: (orderId: string) => void }) {
  return (
    <Table dense head={[t('السجل'), t('النوع'), t('اليوم'), t('المبلغ'), '']} align={['start', 'start', 'start', 'end', 'end']}
      rows={rows.map((e) => [
        <div className="min-w-0"><div className="truncate">{e.label}</div>{e.note && <div className="text-[10px] text-dim">{t(NOTE[e.note] ?? e.note)}</div>}<Tech><span className="num text-[10px] text-dim">{e.id}</span></Tech></div>,
        <Pill size="sm" tone="neutral">{t(KIND[e.kind] ?? e.kind)}</Pill>,
        <span className="text-xs whitespace-nowrap">{e.businessDate ? <span className="num">{e.businessDate}</span> : <DateTime v={e.at} />}</span>,
        <Amt v={e.amount} unit={unit === 'EGP' ? undefined : unit} className="whitespace-nowrap" />,
        e.orderId ? <Button size="icon" variant="ghost" onClick={() => onOpen(e.orderId)} data-fb={`evidence-open:${e.orderId}`} title={t('افتح الشيك')} aria-label={t('افتح الشيك')}><Receipt className="w-4 h-4" /></Button> : null,
      ])} />
  );
}

export function EvidencePopup({ spec, onClose }: { spec: EvidenceSpec | null; onClose: () => void }) {
  const { nav } = useDev();
  const list = spec?.metric === '__list';
  const q = useQuery<any>(spec && !list ? 'Report.Explain' : null, { query: { q: JSON.stringify(spec ? { metric: spec.metric, cell: spec.cell, filters: spec.filters, exclude: spec.exclude, from: spec.from, to: spec.to, branchIds: spec.branchIds, asOf: spec.asOf } : {}) } });
  const r = q.data;
  const open = (orderId: string) => { onClose(); nav('receipt', { orderId }); };
  return (
    <Popup open={!!spec} onClose={onClose} size="xl" fb="evidence-popup" title={<span className="flex items-center gap-2 flex-wrap"><FileSearch className="w-5 h-5 text-[var(--primary)]" />{list ? spec?.label : r ? L(r.metric.label) : t('الإثبات')}<StateBadge ops={['Report.Explain']} /></span>}>
      {list ? <Rows rows={spec!.filters!.__evidence} onOpen={open} /> : q.loading && !r ? <Spinner /> : q.error ? <Banner tone="error">{errorText(q.error)}</Banner> : r && (
        <div className="space-y-3" data-fb="evidence-body">
          <div className="rounded-xl surface-1 p-3 space-y-1">
            <div className="text-2xl font-extrabold">{r.value.availability === 'AVAILABLE' ? <Amt v={r.value.value} unit={r.metric.unit} className="font-extrabold" /> : <span className="text-base">{L(r.value.reason) || t('مش متاح')}</span>}</div>
            <div className="text-sm text-soft">{L(r.metric.definition)}</div>
            {spec?.where && <div className="text-sm font-medium" data-fb="evidence-where">{spec.where}</div>}
            {Object.keys(r.cell ?? {}).length > 0 && <Tech><div className="text-[10px] text-dim num" dir="ltr">{Object.entries(r.cell).map(([k, v]) => `${k}=${v}`).join(' · ')}</div></Tech>}
            <div className="text-xs text-dim">{rangeText(r.meta.from, r.meta.to, getLang() === 'en' ? 'en' : 'ar')} · {t('لحد')} <DateTime v={r.meta.asOf} /> · {t('نسخة التعريف')} <span className="num">{r.metric.version}</span></div>
            {r.proof.holds === true && <div className="text-sm text-[var(--success)] flex items-center gap-1" data-fb="evidence-proof"><CheckCircle2 className="w-4 h-4" />{t('مجموع السجلات بيطلع نفس الرقم')} <span className="num text-xs text-dim">{r.proof.equation}</span></div>}
            {r.proof.holds === false && <div className="text-sm text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('المجموع مختلف — ده لازم يتراجع')} <span className="num text-xs">{r.proof.equation}</span></div>}
            {r.metric.pitfalls?.map((p: any, i: number) => <div key={i} className="text-[11px] text-[var(--warning-text)]">{t('تنبيه')}: {L(p)}</div>)}
          </div>
          {r.parts.map((p: any, i: number) => (
            <div key={i} className="space-y-1">
              {r.parts.length > 1 && <div className="text-sm font-bold flex items-center gap-2">{p.sign < 0 ? '−' : p.role === 'denominator' ? '÷' : '+'} {L(p.label)} {p.sum !== null ? <Amt v={p.sum} unit={p.role === 'denominator' ? 'count' : undefined} className="text-xs text-dim" /> : null}</div>}
              {p.evidence.length === 0 ? <div className="text-sm text-dim">{t('مفيش سجلات في النطاق ده.')}</div> : <Rows rows={p.evidence} unit={['count', 'unit', 'minutes'].includes(r.metric.unit) || p.role === 'denominator' ? 'count' : 'EGP'} onOpen={open} />}
            </div>
          ))}
          <Tech><div className="num text-[10px] text-dim" dir="ltr">{r.metric.id}: {r.metric.formula} <ExternalLink className="w-3 h-3 inline" /></div></Tech>
        </div>
      )}
    </Popup>
  );
}
