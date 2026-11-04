// ux-17: Home's numbers ARE report numbers. One server read (Report.Home, PROPOSED) runs the certified reports for the
// viewer's business day and branch scope — the business day is resolved on the server — and returns each Home card
// with the report, block and metric that produced it, so «الرئيسية» and «التقارير» always agree. Nothing is summed on
// the client: the «so far» comparisons are engine totals over the hours of the business day up to now, and the chart's
// running totals are Decimal sums of the same report's hour rows, made here.
import type { DB, Loc } from '../mock/types';
import { D, m4 } from '../mock/money';
import { zonedParts } from '../mock/clock';
import { query, type Caller } from './engine';
import { runManifest } from './run';
import { manifestById } from './manifests';
import { addDays } from './facts';
import type { MetricValue } from './types';

/** A business day runs 04:00 → 03:59: its hours in that order. */
export const DAY_HOURS = [...Array.from({ length: 20 }, (_, i) => i + 4), 0, 1, 2, 3];

/** Where a Home number comes from: open this report for this period and the same number is there. */
export interface HomeSource { reportId: string; block: string; metric: string; from: string; to: string }
export interface HomeCard { id: string; value: MetricValue; unit: string; source: HomeSource }
export interface HomeSummary {
  businessDate: string; branchIds: string[]; asOf: string; provisional: boolean; provisionalReasons: Loc[]; hour: number;
  cards: Record<string, HomeCard>;
  compare: { netSoFar: { today: string | null; yesterday: string | null; lastWeek: string | null }; checksSoFar: { today: string | null; yesterday: string | null; lastWeek: string | null }; avg: { yesterday: string | null; lastWeek: string | null }; yesterdayChecks: string | null; source: HomeSource } | null;
  paymentMix: { source: HomeSource; rows: { method: string; label: Loc; value: string | null }[]; total: string | null } | null;
  topItems: { source: HomeSource; rows: { product: string; label: Loc; net: string | null; qty: string | null }[] } | null;
  hourly: { source: HomeSource; hours: number[]; today: string[]; yesterday: string[]; lastWeek: string[] } | null;
  days: { source: HomeSource; rows: { date: string; value: string | null }[] } | null;
  /** Reports the viewer may not run: their cards are left out (never shown as 0). */
  refused: string[];
}

/** The Home cards: id → report block metric. */
export const HOME_CARDS: { id: string; reportId: string; block: string; metric: string }[] = [
  { id: 'net_sales', reportId: 'eod_bridge', block: 'kpis', metric: 'net_item_sales' },
  { id: 'checks', reportId: 'eod_bridge', block: 'kpis', metric: 'check_count' },
  { id: 'avg_check', reportId: 'eod_bridge', block: 'kpis', metric: 'avg_check' },
  { id: 'open_checks', reportId: 'eod_bridge', block: 'kpis', metric: 'outstanding_checks' },
  { id: 'open_amount', reportId: 'eod_bridge', block: 'kpis', metric: 'outstanding_amount' },
  { id: 'refunded', reportId: 'eod_bridge', block: 'kpis', metric: 'tender_refunded' },
  { id: 'service', reportId: 'eod_bridge', block: 'bridge', metric: 'service_charge' },
  { id: 'tax', reportId: 'eod_bridge', block: 'bridge', metric: 'tax_amount' },
  { id: 'discounts', reportId: 'eod_bridge', block: 'bridge', metric: 'discount_amount' },
  { id: 'collected', reportId: 'tender_settlement', block: 'kpis', metric: 'tender_collected' },
];

const cairoHour = (ms: number) => zonedParts(ms, 'Africa/Cairo').hour;
const val = (v: MetricValue | undefined) => (v && v.availability === 'AVAILABLE' ? v.value : null);

export function homeSummary(db: DB, caller: Caller, o: { businessDate: string; branchIds?: string[] }): HomeSummary {
  const bd = o.businessDate;
  const may = (id: string) => { const m = manifestById.get(id); return !!m && caller.perms(m.permission); };
  const refused = ['eod_bridge', 'tender_settlement', 'top_items', 'hourly_daypart'].filter((id) => !may(id));
  const runs: Record<string, any> = {};
  const run = (id: string, from: string, to = from) => (runs[`${id}|${from}|${to}`] ??= runManifest(db, caller, id, { from, to, branchIds: o.branchIds }));
  const block = (r: any, id: string) => r.blocks.find((b: any) => b.id === id);
  const cards: Record<string, HomeCard> = {};
  let head: any = null;
  for (const c of HOME_CARDS) {
    if (!may(c.reportId)) continue;
    const r = run(c.reportId, bd); head ??= r.header;
    const b = block(r, c.block);
    let v: MetricValue | undefined;
    if (b?.result) v = b.result.totals[c.metric];
    else if (b?.bridge) { const row = b.bridge.sales.find((x: any) => x.metric === c.metric && !x.filter); v = row ? { value: row.amount, availability: 'AVAILABLE' } : undefined; }
    const unit = (r.header.metrics.find((m: any) => m.id === c.metric)?.unit as string) ?? 'EGP';
    cards[c.id] = { id: c.id, value: v ?? { value: '0.0000', availability: 'AVAILABLE' }, unit, source: { reportId: c.reportId, block: c.block, metric: c.metric, from: bd, to: bd } };
  }
  const branchIds = head?.venue?.branches?.map((b: any) => b.id) ?? o.branchIds ?? (caller.defaultBranchId ? [caller.defaultBranchId] : caller.accessibleBranchIds);
  const hour = cairoHour(caller.nowMs);
  const yd = addDays(bd, -1), lw = addDays(bd, -7);
  let compare: HomeSummary['compare'] = null, hourly: HomeSummary['hourly'] = null, days: HomeSummary['days'] = null;
  if (may('hourly_daypart')) {
    // the hours of the business day up to now; the same hours of yesterday and of the same day last week
    const soFar = DAY_HOURS.slice(0, DAY_HOURS.indexOf(hour) + 1).map(String);
    const q = (d: string) => query(db, caller, { metrics: ['item_net_sales', 'check_count'], filters: { hour: soFar }, from: d, to: d, branchIds: o.branchIds }).totals;
    const t0 = q(bd), t1 = q(yd), t7 = q(lw);
    const whole = (d: string) => query(db, caller, { metrics: ['avg_check', 'check_count'], from: d, to: d, branchIds: o.branchIds }).totals;
    const w1 = whole(yd), w7 = whole(lw);
    compare = {
      netSoFar: { today: val(t0.item_net_sales), yesterday: val(t1.item_net_sales), lastWeek: val(t7.item_net_sales) },
      checksSoFar: { today: val(t0.check_count), yesterday: val(t1.check_count), lastWeek: val(t7.check_count) },
      avg: { yesterday: val(w1.avg_check), lastWeek: val(w7.avg_check) }, yesterdayChecks: val(w1.check_count),
      source: { reportId: 'hourly_daypart', block: 'by_hour', metric: 'item_net_sales', from: bd, to: bd },
    };
    // the chart: running totals of the report's hour rows (Decimal), for the three days
    const cum = (d: string) => {
      const b = block(run('hourly_daypart', d), 'by_hour');
      let acc = D(0);
      return DAY_HOURS.map((h) => { const row = b?.result?.rows.find((x: any) => Number(x.dims.hour) === h); const v = val(row?.values.item_net_sales); if (v) acc = acc.plus(v); return m4(acc); });
    };
    hourly = { source: { reportId: 'hourly_daypart', block: 'by_hour', metric: 'item_net_sales', from: bd, to: bd }, hours: DAY_HOURS, today: cum(bd).slice(0, DAY_HOURS.indexOf(hour) + 1), yesterday: cum(yd), lastWeek: cum(lw) };
    const from14 = addDays(bd, -13);
    const b14 = block(run('hourly_daypart', from14, bd), 'by_day');
    days = { source: { reportId: 'hourly_daypart', block: 'by_day', metric: 'net_item_sales', from: from14, to: bd }, rows: Array.from({ length: 14 }, (_, i) => addDays(from14, i)).map((d) => ({ date: d, value: val(b14?.result?.rows.find((x: any) => x.dims.business_date === d)?.values.net_item_sales) ?? '0.0000' })) };
  }
  let paymentMix: HomeSummary['paymentMix'] = null, topItems: HomeSummary['topItems'] = null;
  if (may('tender_settlement')) {
    const b = block(run('tender_settlement', bd), 'by_method');
    paymentMix = { source: { reportId: 'tender_settlement', block: 'by_method', metric: 'tender_collected', from: bd, to: bd }, rows: (b?.result?.rows ?? []).map((x: any) => ({ method: x.dims.payment_method, label: x.labels.payment_method, value: val(x.values.tender_collected) })), total: val(b?.result?.totals.tender_collected) };
  }
  if (may('top_items')) {
    const b = block(run('top_items', bd, bd), 'top');
    topItems = { source: { reportId: 'top_items', block: 'top', metric: 'item_net_sales', from: bd, to: bd }, rows: (b?.result?.rows ?? []).slice(0, 5).map((x: any) => ({ product: x.dims.product, label: x.labels.product, net: val(x.values.item_net_sales), qty: val(x.values.sold_quantity) })) };
  }
  const anyRun: any = head ?? Object.values(runs)[0]?.header ?? null;
  return {
    businessDate: bd, branchIds, asOf: anyRun?.asOf ?? new Date(caller.nowMs).toISOString(), provisional: !!anyRun?.provisional, provisionalReasons: anyRun?.provisionalReasons ?? [], hour,
    cards, compare, paymentMix, topItems, hourly, days, refused,
  };
}
