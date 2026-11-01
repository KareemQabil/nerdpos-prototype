// Shared pieces of the report studio UI: the registry (numbers and breakdowns with plain words), which combinations
// are allowed and why, the debounced live preview, period presets and file downloads. Display only — the server
// computes every number (Report.Pivot / Report.PivotExport).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDev, useQuery } from '../../../app/hooks';
import { call } from '../../../api/client';
import { t, L, getLang } from '../../../i18n';
import { clock, businessDate } from '../../../mock/clock';
import { resolvePeriod, type PivotResult, type PivotSpec, type PeriodPreset } from '../../../reports/pivot';
import { specOf, type ReportDesign, type ColumnView } from '../../../reports/studio';
import { cellText, rangeText, type Lang } from '../../../reports/format';
import { columnFormat } from '../../../reports/export/table';
import type { MeasureMeta } from '../../../reports/pivot';

export type Loc = { ar: string; en: string };
export const lang = (): Lang => (getLang() === 'en' ? 'en' : 'ar');
export const today = () => businessDate(clock.now());

/** Topics for the number picker (registry families) — plain names. */
export const FAMILY: Record<string, () => string> = {
  sales: () => t('المبيعات'), payments: () => t('الفلوس والدرج'), service: () => t('الصالة والشيكات'), menu: () => t('المنيو والأصناف'),
  controls: () => t('الرقابة والإلغاءات'), kitchen: () => t('المطبخ'), inventory: () => t('المخزن'), purchasing: () => t('المشتريات'),
  fiscal: () => t('الضرايب'), system: () => t('السيستم'), reservations: () => t('الحجوزات'), delivery: () => t('الدليفري'),
  labor: () => t('العمالة'), customers: () => t('العملاء'), forecast: () => t('التوقعات'),
};
export const FAMILY_ORDER = ['sales', 'menu', 'payments', 'service', 'controls', 'kitchen', 'delivery', 'inventory', 'purchasing', 'fiscal', 'reservations', 'system', 'labor', 'customers', 'forecast'];
/** Breakdown topics («قسّم حسب»). */
export const DIM_GROUPS: { id: string; label: () => string; dims: string[] }[] = [
  { id: 'time', label: () => t('الوقت'), dims: ['business_date', 'business_week', 'weekday', 'daypart', 'hour'] },
  { id: 'place', label: () => t('المكان'), dims: ['branch', 'revenue_center', 'table', 'device', 'location'] },
  { id: 'menu', label: () => t('المنيو'), dims: ['category', 'product', 'size', 'modifier', 'tax_group'] },
  { id: 'sale', label: () => t('البيع والفلوس'), dims: ['channel', 'payment_method', 'drawer', 'check', 'order', 'table_visit', 'fiscal_status'] },
  { id: 'people', label: () => t('الناس'), dims: ['staff', 'approval_actor', 'driver', 'role'] },
  { id: 'control', label: () => t('الرقابة والمطبخ'), dims: ['void_reason', 'stage', 'disposition', 'station'] },
  { id: 'stock', label: () => t('المخزن والتوصيل'), dims: ['inventory_item', 'supplier', 'zone'] },
];
export const PERIODS: { id: PeriodPreset; label: () => string }[] = [
  { id: 'TODAY', label: () => t('النهارده') }, { id: 'YESTERDAY', label: () => t('امبارح') }, { id: 'THIS_WEEK', label: () => t('الأسبوع ده') },
  { id: 'LAST_7', label: () => t('آخر 7 أيام') }, { id: 'THIS_MONTH', label: () => t('الشهر ده') }, { id: 'CUSTOM', label: () => t('مخصص') },
];
export const periodText = (p: ReportDesign['period']) => { const x = PERIODS.find((y) => y.id === p.preset); const r = resolvePeriod(p.preset, today(), p); const words = rangeText(r.from, r.to, lang()); return x && p.preset !== 'CUSTOM' ? `${x.label()} (${words})` : words; };

export interface Registry { metrics: any[]; dims: any[]; metric: (id: string) => any; dim: (id: string) => any; loading: boolean }
/** The certified registry (Metric.List) — numbers users may pick (helper parts hidden). */
export function useRegistry(): Registry {
  const q = useQuery<any>('Metric.List');
  return useMemo(() => {
    const metrics: any[] = q.data?.metrics ?? []; const dims: any[] = q.data?.dimensions ?? [];
    const mm = new Map(metrics.map((m) => [m.id, m])); const dm = new Map(dims.map((d) => [d.id, d]));
    return { metrics, dims, metric: (id: string) => mm.get(id), dim: (id: string) => dm.get(id), loading: q.loading };
  }, [q.data, q.loading]);
}
/** Why a number cannot be shown with these breakdowns (null = it can). Same rule as the server. */
export function whyNot(reg: Registry, metricId: string, dims: string[]): string | null {
  const m = reg.metric(metricId);
  if (!m) return null;
  if (m.status !== 'AVAILABLE') return L(m.reason) || t('مش متاح لسه');
  if (!m.allowed) return t('الرقم ده للمدير والمحاسب بس.');
  const bad = dims.find((d) => !m.dimensions.includes(d));
  if (bad) return t('«{m}» ما بيتقسمش حسب «{d}».', { m: L(m.label), d: L(reg.dim(bad)?.label) || bad });
  return null;
}
export function dimWhyNot(reg: Registry, dimId: string, metrics: string[]): string | null {
  const d = reg.dim(dimId);
  if (!d || d.status !== 'AVAILABLE') return d ? L(d.reason) || t('مش متاح لسه') : null;
  const bad = metrics.filter((m) => reg.metric(m) && !reg.metric(m).dimensions.includes(dimId));
  if (bad.length) return t('مش بيتقسم كده: {list}', { list: bad.map((m) => L(reg.metric(m)?.label)).join('، ') });
  return null;
}

/** Live preview: debounced, keeps the last result on screen while the next one loads. */
export function usePivot(spec: PivotSpec | null, debounce = 350) {
  const { auth } = useDev();
  const [st, setSt] = useState<{ data: (PivotResult & { saved?: any }) | null; error: any; loading: boolean }>({ data: null, error: null, loading: !!spec });
  const key = spec ? JSON.stringify(spec) : '';
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!spec || !auth.token) return;
    let alive = true;
    setSt((s) => ({ ...s, loading: true }));
    const h = setTimeout(() => {
      call<any>(auth, 'Report.Pivot', { query: { q: key } }).then((r) => alive && setSt({ data: r.data, error: null, loading: false })).catch((e) => alive && setSt((s) => ({ data: s.data, error: e, loading: false })));
    }, st.data ? debounce : 0);
    return () => { alive = false; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auth.token, bump]);
  return { ...st, refetch: () => setBump((b) => b + 1) };
}
export const designSpec = (d: ReportDesign, deviceBranch: string | null, allBranches: string[]) => specOf(d, today(), deviceBranch, allBranches);

export function fmtCell(v: any, m: MeasureMeta, view?: ColumnView[]) { return cellText(v, columnFormat(m, view), lang(), m.unit); }
export const isNum = (v: any) => v?.availability === 'AVAILABLE' && v.value !== null;

/** Click-outside helper for popovers. */
export function useClickAway(ref: React.RefObject<HTMLElement>, onAway: () => void, active = true) {
  const cb = useRef(onAway); cb.current = onAway;
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb.current(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [active, ref]);
}
export const EMPTY_TEXT = () => t('مفيش بيانات في الفترة دي. جرّب فترة تانية أو شيل فلتر.');
