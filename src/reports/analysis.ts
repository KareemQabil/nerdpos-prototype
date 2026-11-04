// L3 — analysis primitives over the engine (never over raw data): compare periods, trend, "why did it change"
// (volume × price × mix with an explicit unexplained residual) and the menu engineering matrix.
// Causal words are avoided: a decomposition says how the number moved arithmetically, not why people did it.
import type { DB, Loc } from '../mock/types';
import { D, m4 } from '../mock/money';
import { query, dimLabel, type Caller } from './engine';
import { metricById } from './registry/metrics';
import { addDays } from './facts';

const L = (ar: string, en: string): Loc => ({ ar, en });
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** The period before (same length) or the same weekday last week. */
export function previousPeriod(from: string, to: string, mode: 'PREVIOUS' | 'SAME_WEEKDAY_LAST_WEEK' = 'PREVIOUS') {
  if (mode === 'SAME_WEEKDAY_LAST_WEEK') return { from: addDays(from, -7), to: addDays(to, -7) };
  const n = days(from, to);
  return { from: addDays(from, -n), to: addDays(to, -n) };
}

export function compare(db: DB, caller: Caller, spec: { metrics: string[]; from: string; to?: string; baseFrom?: string; baseTo?: string; mode?: 'PREVIOUS' | 'SAME_WEEKDAY_LAST_WEEK'; branchIds?: string[]; filters?: Record<string, string> }) {
  const to = spec.to ?? spec.from;
  const base = spec.baseFrom ? { from: spec.baseFrom, to: spec.baseTo ?? spec.baseFrom } : previousPeriod(spec.from, to, spec.mode);
  const a = query(db, caller, { metrics: spec.metrics, from: spec.from, to, branchIds: spec.branchIds, filters: spec.filters });
  const b = query(db, caller, { metrics: spec.metrics, from: base.from, to: base.to, branchIds: spec.branchIds, filters: spec.filters });
  const rows = spec.metrics.map((id) => {
    const x = a.totals[id], y = b.totals[id];
    const ok = x?.availability === 'AVAILABLE' && y?.availability === 'AVAILABLE';
    const delta = ok ? D(x.value!).minus(y.value!) : null;
    const pct = ok && !D(y.value!).isZero() ? delta!.dividedBy(y.value!).times(100) : null;
    return { metric: id, label: metricById.get(id)?.label, current: x, base: y, delta: delta ? m4(delta) : null, pct: pct ? m4(pct) : null };
  });
  return { current: { from: spec.from, to }, base, rows, meta: a.meta, baseMeta: b.meta };
}

export function trend(db: DB, caller: Caller, spec: { metric: string; from: string; to: string; grain?: 'business_date' | 'business_week' | 'hour'; branchIds?: string[]; filters?: Record<string, string> }) {
  const r = query(db, caller, { metrics: [spec.metric], dimensions: [spec.grain ?? 'business_date'], from: spec.from, to: spec.to, branchIds: spec.branchIds, filters: spec.filters });
  return { points: r.rows.map((x) => ({ key: x.dims[spec.grain ?? 'business_date'], label: x.labels[spec.grain ?? 'business_date'], value: x.values[spec.metric], source: x.source ?? 'EVENTS' })), meta: r.meta, total: r.totals[spec.metric] };
}

/**
 * Why did item net sales change between two periods? Exact arithmetic split by product:
 *   Δ = volume + mix + price + new/dropped items + unexplained
 *   volume = (Q₁ − Q₀) × P̄₀           mix = Q₁ × Σ (s₁ᵢ − s₀ᵢ) × p₀ᵢ        price = Σ q₁ᵢ × (p₁ᵢ − p₀ᵢ)
 * where p = net per unit (after discounts, ex-tax), s = share of units. Returns are shown as their own bucket.
 */
export function decompose(db: DB, caller: Caller, spec: { from: string; to?: string; baseFrom?: string; baseTo?: string; mode?: 'PREVIOUS' | 'SAME_WEEKDAY_LAST_WEEK'; branchIds?: string[]; filters?: Record<string, string> }) {
  const to = spec.to ?? spec.from;
  const base = spec.baseFrom ? { from: spec.baseFrom, to: spec.baseTo ?? spec.baseFrom } : previousPeriod(spec.from, to, spec.mode);
  const get = (f: string, t: string) => query(db, caller, { metrics: ['item_net_sales', 'sold_quantity'], dimensions: ['product'], from: f, to: t, branchIds: spec.branchIds, filters: spec.filters });
  const cur = get(spec.from, to), old = get(base.from, base.to);
  const totC = query(db, caller, { metrics: ['item_net_sales', 'net_item_sales', 'return_sales_adjustment'], from: spec.from, to, branchIds: spec.branchIds, filters: spec.filters });
  const totO = query(db, caller, { metrics: ['item_net_sales', 'net_item_sales', 'return_sales_adjustment'], from: base.from, to: base.to, branchIds: spec.branchIds, filters: spec.filters });
  const avail = [totC, totO].every((t) => t.totals.item_net_sales.availability === 'AVAILABLE') && cur.rows.length + old.rows.length > 0;
  if (!avail) return { available: false as const, reason: L('يحتاج إلى بيانات تفصيلية (شيكات) في الفترتين — للأيام قبل التشغيل إجماليات فقط.', 'Needs event-level data in both periods.'), current: { from: spec.from, to }, base };
  const map = (r: typeof cur) => new Map(r.rows.map((x) => [x.dims.product!, { q: D(x.values.sold_quantity?.value ?? 0), r: D(x.values.item_net_sales?.value ?? 0), label: x.labels.product }]));
  const A = map(old), B = map(cur);
  const Q0 = [...A.values()].reduce((a, x) => a.plus(x.q), D(0)), Q1 = [...B.values()].reduce((a, x) => a.plus(x.q), D(0));
  const R0 = [...A.values()].reduce((a, x) => a.plus(x.r), D(0)), R1 = [...B.values()].reduce((a, x) => a.plus(x.r), D(0));
  const both = [...B.keys()].filter((k) => A.has(k) && !A.get(k)!.q.isZero() && !B.get(k)!.q.isZero());
  const QA = both.reduce((a, k) => a.plus(A.get(k)!.q), D(0)), QB = both.reduce((a, k) => a.plus(B.get(k)!.q), D(0));
  const RA = both.reduce((a, k) => a.plus(A.get(k)!.r), D(0));
  const P0 = QA.isZero() ? D(0) : RA.dividedBy(QA);
  const volume = QB.minus(QA).times(P0);
  let mix = D(0), price = D(0);
  const items = both.map((k) => {
    const a = A.get(k)!, b = B.get(k)!;
    const p0 = a.r.dividedBy(a.q), p1 = b.r.dividedBy(b.q);
    const s0 = QA.isZero() ? D(0) : a.q.dividedBy(QA), s1 = QB.isZero() ? D(0) : b.q.dividedBy(QB);
    const mi = QB.times(s1.minus(s0)).times(p0), pr = b.q.times(p1.minus(p0));
    mix = mix.plus(mi); price = price.plus(pr);
    return { product: k, label: b.label, q0: a.q.toString(), q1: b.q.toString(), p0: m4(p0), p1: m4(p1), mix: m4(mi), price: m4(pr), delta: m4(b.r.minus(a.r)) };
  });
  const newItems = [...B.keys()].filter((k) => !both.includes(k)).reduce((a, k) => a.plus(B.get(k)!.r), D(0));
  const dropped = [...A.keys()].filter((k) => !both.includes(k)).reduce((a, k) => a.plus(A.get(k)!.r), D(0));
  const itemDelta = R1.minus(R0);
  const returnsDelta = D(totC.totals.return_sales_adjustment.value ?? 0).minus(totO.totals.return_sales_adjustment.value ?? 0).negated();
  const explained = volume.plus(mix).plus(price).plus(newItems).minus(dropped);
  const unexplained = itemDelta.minus(explained);
  const netDelta = D(totC.totals.net_item_sales.value ?? 0).minus(totO.totals.net_item_sales.value ?? 0);
  return {
    available: true as const, current: { from: spec.from, to }, base,
    totals: { current: m4(R1), base: m4(R0), delta: m4(itemDelta), netCurrent: totC.totals.net_item_sales.value, netBase: totO.totals.net_item_sales.value, netDelta: m4(netDelta), units: { current: Q1.toString(), base: Q0.toString() } },
    effects: [
      { id: 'volume', label: L('حجم البيع (عدد القطع)', 'Volume (units)'), amount: m4(volume), note: L(`القطع ${QA} ← ${QB} بمتوسط سعر الفترة الأولى ${m4(P0)}`, `Units ${QA} → ${QB} at base average price`) },
      { id: 'mix', label: L('التشكيلة (الناس اشترت أصناف أغلى/أرخص)', 'Mix'), amount: m4(mix), note: L('نصيب كل صنف من القطع اتغير', 'Each item\'s share of units changed') },
      { id: 'price', label: L('السعر الفعلي للقطعة (بعد الخصم)', 'Realised price per unit'), amount: m4(price), note: L('سعر الصنف أو الخصم عليه اتغير', 'Item price or discount changed') },
      { id: 'new', label: L('أصناف جديدة في هذه الفترة', 'New items'), amount: m4(newItems), note: L('بِيعت الآن ولم تُبع قبل ذلك', 'Sold now, not before') },
      { id: 'dropped', label: L('أصناف لم تُبع هذه المرة', 'Dropped items'), amount: m4(dropped.negated()), note: L('بِيعت قبل ذلك وليس الآن', 'Sold before, not now') },
      { id: 'unexplained', label: L('غير مفسَّر', 'Unexplained'), amount: m4(unexplained), note: L('الباقي بعد الحساب — بيبان دايمًا حتى لو صفر', 'The residual — always shown, even when zero') },
    ],
    returns: { amount: m4(returnsDelta), label: L('فرق المرتجعات (على صافي المبيعات)', 'Returns difference (on net sales)') },
    items: items.sort((a, b) => D(b.delta).abs().comparedTo(D(a.delta).abs())).slice(0, 12),
    caveat: L('هذا تقسيم حسابي للفرق، وليس سببًا. معرفة سبب سلوك العملاء تحتاج إلى سؤال فريق المطعم.', 'An arithmetic split, not a cause.'),
  };
}

/** Kasavana–Smith menu engineering: popularity threshold 70% of an equal share; contribution threshold = weighted average. */
export function menuMatrix(db: DB, caller: Caller, spec: { from: string; to?: string; branchIds?: string[]; filters?: Record<string, string> }) {
  const r = query(db, caller, { metrics: ['sold_quantity', 'item_net_sales', 'food_theoretical_cost', 'menu_contribution'], dimensions: ['product'], from: spec.from, to: spec.to, branchIds: spec.branchIds, filters: spec.filters });
  const n = r.rows.length;
  const totalQ = r.rows.reduce((a, x) => a.plus(D(x.values.sold_quantity?.value ?? 0)), D(0));
  const withCost = r.rows.filter((x) => x.values.menu_contribution?.availability === 'AVAILABLE');
  const cmTotal = withCost.reduce((a, x) => a.plus(D(x.values.menu_contribution.value!)), D(0));
  const qCost = withCost.reduce((a, x) => a.plus(D(x.values.sold_quantity.value!)), D(0));
  const cmThreshold = qCost.isZero() ? null : cmTotal.dividedBy(qCost);
  const popThreshold = n ? D(70).dividedBy(n) : D(0); // % of units
  const items = r.rows.map((x) => {
    const q = D(x.values.sold_quantity?.value ?? 0);
    const pop = totalQ.isZero() ? D(0) : q.dividedBy(totalQ).times(100);
    const cmv = x.values.menu_contribution;
    const cmUnit = cmv?.availability === 'AVAILABLE' && !q.isZero() ? D(cmv.value!).dividedBy(q) : null;
    const high = pop.gte(popThreshold);
    const cls = cmUnit === null || cmThreshold === null ? 'COST_UNAVAILABLE' : high && cmUnit.gte(cmThreshold) ? 'STAR' : high ? 'PLOWHORSE' : cmUnit.gte(cmThreshold) ? 'PUZZLE' : 'DOG';
    return { product: x.dims.product, label: x.labels.product, qty: q.toString(), net: x.values.item_net_sales?.value, cost: x.values.food_theoretical_cost, contribution: cmv, popularity: m4(pop), cmPerUnit: cmUnit ? m4(cmUnit) : null, class: cls };
  });
  return { items, thresholds: { popularityPct: m4(popThreshold), contributionPerUnit: cmThreshold ? m4(cmThreshold) : null }, meta: r.meta, classes: CLASS_LABEL };
}
export const CLASS_LABEL: Record<string, Loc & { advice: Loc }> = {
  STAR: { ar: 'نجم', en: 'Star', advice: L('مبيعاته عالية وهامشه جيد — حافظ عليه.', 'Popular and profitable — keep.') },
  PLOWHORSE: { ar: 'حصان', en: 'Plowhorse', advice: L('مبيعاته عالية وهامشه منخفض — راجع التكلفة أو السعر.', 'Popular, low margin — review cost/price.') },
  PUZZLE: { ar: 'لغز', en: 'Puzzle', advice: L('هامشه عالٍ ومبيعاته قليلة — حسِّن عرضه.', 'Profitable, unpopular — promote.') },
  DOG: { ar: 'كلب', en: 'Dog', advice: L('قليل في الاتنين — فكر تشيله.', 'Low on both — consider removing.') },
  COST_UNAVAILABLE: { ar: 'التكلفة غير متاحة', en: 'Cost unavailable', advice: L('لا وصفة تكلفة — نعرض الشعبية فقط، والهامش ليس صفرًا.', 'No recipe cost — popularity only, margin not zero.') },
};
export { dimLabel };
