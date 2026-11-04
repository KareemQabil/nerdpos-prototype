// H1 Reports (round 4): the reports home (catalog with search, topics, favourites, recent, certified vs custom),
// certified report pages (layered engine, read-only, «احفظ نسخة وعدّل»), custom report pages (pivot with subtotals,
// comparisons, print / PDF / Excel, schedule, history), schedules, print templates and the activity log — all in
// src/screens/reports/Home.tsx. The 8 legacy operator reports (doc 27) keep running for Home, shown as «عرض سريع».
import React from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useDev, useQuery, errorText } from '../../app/hooks';
import { Banner, Button, Pill, Card, Spinner, Field, Input, Money } from '../../ui';
import { t, L, getLang } from '../../i18n';
import { money } from '../../lib/format';
import { clock, businessDate } from '../../mock/clock';
import { metricLabel, isMetricId, SECTION_COLUMNS, codeLabel } from './output/labels';
import { ReportsHome, CertifiedPage, SavedPage } from '../reports/Home';

const MONEY_RE = /^-?\d+\.\d{4}$/;
function LegacyCell({ v }: { v: unknown }) {
  if (v === 'CAPABILITY_NOT_AVAILABLE') return <Pill tone="neutral">{t('مش متاح')}</Pill>;
  if (v === null || v === undefined || v === '') return <span className="text-dim">—</span>;
  if (typeof v === 'number') return <span className="num">{v}</span>;
  const s = String(v);
  if (MONEY_RE.test(s)) return <Money v={s} className="font-bold" />;
  if (isMetricId(s)) return <span>{metricLabel(s)}</span>;
  if (/^[A-Z][A-Z_:]+$/.test(s)) return <span title={s}>{codeLabel(s)}</span>;
  return <span>{s}</span>;
}
function LegacyReport({ r }: { r: any }) {
  return (
    <div className="space-y-3">
      <Banner tone="info">{t('ده عرض سريع من تقارير التشغيل القديمة (بيستخدمه الرئيسية). النسخة المعتمدة اللي كل رقم فيها بيتثبت موجودة في «التقارير المعتمدة».')}</Banner>
      <div className="grid xl:grid-cols-2 gap-3">
        {(r.sections ?? []).map((s: any) => {
          const rows: unknown[][] = s.rows ?? [];
          const cols: string[] = s.columns ?? SECTION_COLUMNS[s.id] ?? Array.from({ length: Math.max(0, ...rows.map((x) => x.length)) }, (_, i) => String(i + 1));
          return (
            <Card key={s.id} title={L(s.title)}>
              {rows.length === 0 ? <div className="text-sm text-dim">{t('مفيش بيانات في الفترة دي')}</div> : (
                <div className="overflow-x-auto rounded-xl border line"><table className="w-full text-sm"><thead className="surface-1"><tr>{cols.map((c, i) => <th key={i} className="text-start text-xs text-soft px-3 py-2">{metricLabel(c)}</th>)}</tr></thead>
                  <tbody>{rows.map((x, i) => <tr key={i} className="border-t line">{cols.map((_, j) => <td key={j} className="px-3 py-1.5"><LegacyCell v={x[j]} /></td>)}</tr>)}</tbody></table></div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function Reports() {
  const { params, nav } = useDev();
  const list = useQuery<any>('Report.List');
  const legacy = (list.data?.items ?? []).filter((r: any) => !r.certified);
  if (params?.savedId) return <SavedPage key={params.savedId} id={params.savedId} />;
  if (params?.reportId && legacy.some((x: any) => x.id === params.reportId)) return <LegacyPage id={params.reportId} />;
  if (params?.reportId) return <CertifiedPage key={params.reportId} id={params.reportId} />;
  return <ReportsHome legacy={legacy} onLegacy={(id) => nav('reports', { reportId: id })} />;
}

function LegacyPage({ id }: { id: string }) {
  const { nav } = useDev();
  const today = businessDate(clock.now());
  const [from, setFrom] = React.useState(today);
  const list = useQuery<any>('Report.List');
  const def = (list.data?.items ?? []).find((r: any) => r.id === id);
  const run = useQuery<any>('Report.Run', { params: { reportId: id }, query: { fromBusinessDate: from } });
  return (
    <div className="space-y-3 pb-16" data-screen-id="H1">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="icon" variant="ghost" onClick={() => nav('reports', {})} aria-label={t('كل التقارير')}>{getLang() === 'en' ? <ArrowLeft className="w-5 h-5" /> : <ArrowRight className="w-5 h-5" />}</Button>
        <h1 className="text-xl font-extrabold">{def ? L(def.title) : '…'}</h1><Pill size="sm" tone="neutral">{t('عرض سريع')}</Pill>
        <span className="flex-1" />
        <Field label={t('اليوم التجاري')} className="w-44"><Input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} data-fb="reports:from" /></Field>
      </div>
      {run.error && <Banner tone="error">{errorText(run.error)}</Banner>}
      {run.loading && !run.data ? <Spinner /> : run.data && <LegacyReport r={run.data} />}
    </div>
  );
}
