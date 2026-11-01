// L4 evidence: the exact checks / lines / payments / refunds / drawer entries behind one number, with the proof that
// they add up to it, and a link to open each check. Calls Report.Explain (server) — never recomputed in the browser.
import React from 'react';
import { Receipt, CheckCircle2, AlertTriangle, ExternalLink, FileSearch } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { Drawer, Spinner, Banner, Pill, Table, Button, StateBadge } from '../../ui';
import { t, L } from '../../i18n';
import { dateTime } from '../../lib/format';
import { Tech } from '../../app/tech';
import { fmt, type EvidenceSpec } from './parts';

const KIND: Record<string, string> = { CHECK: 'شيك', LINE: 'سطر', PAYMENT: 'دفعة', REFUND: 'مرتجع', CASH_ENTRY: 'حركة درج', SESSION: 'وردية', REMOVAL: 'إلغاء', DISCOUNT: 'خصم', STAFF_MEAL: 'وجبة موظف', TICKET: 'تذكرة مطبخ', FISCAL: 'إيصال', APPROVAL: 'موافقة', STOCK: 'مخزن', WASTE: 'هالك', PO: 'أمر شراء', GRN: 'استلام', VISIT: 'قعدة', DELIVERY: 'دليفري', HISTORY: 'إجمالي يوم', RESERVATION: 'حجز', RECON: 'قاعدة مطابقة' };
const NOTE: Record<string, string> = { 'stage-derived': 'المرحلة مستنتجة من الأحداث', 'no-recipe': 'من غير وصفة — التكلفة مش متاحة', 'cost-current': 'تكلفة حالية (مفيش تاريخ)', 'aggregate-only': 'إجمالي مستورد — من غير شيكات', 'in-flight': 'لسه في المطبخ', 'same-order (counted once)': 'نفس الأوردر — اتعد مرة واحدة' };

function Rows({ rows, unit, onOpen }: { rows: any[]; unit?: string; onOpen: (orderId: string) => void }) {
  return (
    <Table dense maxHeight={420} head={[t('السجل'), t('النوع'), t('اليوم'), t('المبلغ'), '']} align={['start', 'start', 'start', 'end', 'end']}
      rows={rows.map((e) => [
        <div className="min-w-0"><div className="truncate">{e.label}</div>{e.note && <div className="text-[10px] text-dim">{t(NOTE[e.note] ?? e.note)}</div>}<Tech><span className="num text-[10px] text-dim">{e.id}</span></Tech></div>,
        <Pill size="sm" tone="neutral">{t(KIND[e.kind] ?? e.kind)}</Pill>,
        <span className="num text-xs">{e.businessDate ?? (e.at ? dateTime(e.at) : '—')}</span>,
        <span className="num">{e.amount === null || e.amount === undefined ? '—' : unit === 'EGP' || !unit ? fmt(e.amount) : fmt(e.amount, unit)}</span>,
        e.orderId ? <Button size="sm" variant="ghost" onClick={() => onOpen(e.orderId)} data-fb={`evidence-open:${e.orderId}`}><Receipt className="w-3.5 h-3.5" />{t('افتح الشيك')}</Button> : null,
      ])} />
  );
}

export function EvidenceDrawer({ spec, onClose }: { spec: EvidenceSpec | null; onClose: () => void }) {
  const { nav } = useDev();
  const list = spec?.metric === '__list';
  const q = useQuery<any>(spec && !list ? 'Report.Explain' : null, { query: { q: JSON.stringify(spec ? { metric: spec.metric, cell: spec.cell, filters: spec.filters, from: spec.from, to: spec.to, branchIds: spec.branchIds, asOf: spec.asOf } : {}) } });
  const r = q.data;
  const open = (orderId: string) => { onClose(); nav('receipt', { orderId }); };
  return (
    <Drawer open={!!spec} onClose={onClose} width="lg" icon={<FileSearch className="w-5 h-5" />} badge={<StateBadge ops={['Report.Explain']} />}
      title={list ? spec?.label : r ? L(r.metric.label) : t('الإثبات')}
      description={t('السجلات الأصلية اللي ورا الرقم — مش متغيرة. دوس «افتح الشيك» تشوف الشيك نفسه.')}>
      {list ? <Rows rows={spec!.filters!.__evidence} onOpen={open} /> : q.loading && !r ? <Spinner /> : q.error ? <Banner tone="error">{errorText(q.error)}</Banner> : r && (
        <div className="space-y-3" data-fb="evidence-drawer">
          <div className="rounded-xl surface-1 p-3 space-y-1">
            <div className="text-2xl font-extrabold num">{r.value.availability === 'AVAILABLE' ? fmt(r.value.value, r.metric.unit) : <span className="text-base">{L(r.value.reason) || t('مش متاح')}</span>}</div>
            <div className="text-sm text-soft">{L(r.metric.definition)}</div>
            {Object.keys(r.cell ?? {}).length > 0 && <div className="text-xs text-dim">{t('الخانة')}: {Object.entries(r.cell).map(([k, v]) => `${k}=${v}`).join(' · ')}</div>}
            <div className="text-xs text-dim num">{r.meta.from}{r.meta.to !== r.meta.from ? ` → ${r.meta.to}` : ''} · {t('لحد')} {dateTime(r.meta.asOf)} · {t('نسخة التعريف')} {r.metric.version}</div>
            {r.proof.holds === true && <div className="text-sm text-[var(--success)] flex items-center gap-1" data-fb="evidence-proof"><CheckCircle2 className="w-4 h-4" />{t('مجموع السجلات بيطلع نفس الرقم')} <span className="num text-xs text-dim">{r.proof.equation}</span></div>}
            {r.proof.holds === false && <div className="text-sm text-[var(--error)] flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{t('المجموع مختلف — ده لازم يتراجع')} <span className="num text-xs">{r.proof.equation}</span></div>}
            {r.metric.pitfalls?.map((p: any, i: number) => <div key={i} className="text-[11px] text-[var(--warning-text)]">{t('تنبيه')}: {L(p)}</div>)}
          </div>
          {r.parts.map((p: any, i: number) => (
            <div key={i} className="space-y-1">
              {r.parts.length > 1 && <div className="text-sm font-bold flex items-center gap-2">{p.sign < 0 ? '−' : p.role === 'denominator' ? '÷' : '+'} {L(p.label)} <span className="num text-xs text-dim">{p.sum !== null ? fmt(p.sum, p.role === 'denominator' ? 'count' : undefined) : ''}</span></div>}
              {p.evidence.length === 0 ? <div className="text-sm text-dim">{t('مفيش سجلات في النطاق ده.')}</div> : <Rows rows={p.evidence} unit={['count', 'unit', 'minutes'].includes(r.metric.unit) || p.role === 'denominator' ? 'count' : 'EGP'} onOpen={open} />}
            </div>
          ))}
          <Tech><div className="num text-[10px] text-dim" dir="ltr">{r.metric.id}: {r.metric.formula} <ExternalLink className="w-3 h-3 inline" /></div></Tech>
        </div>
      )}
    </Drawer>
  );
}
