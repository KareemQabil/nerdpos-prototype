// The query engine: ONE function over the mock DB facts — metrics × dimensions × filters × period → rows + lineage.
// Rules it enforces (research §4 "grain / additivity rules", doc 27 §4):
//  • business date (04:00 Africa/Cairo) on every fact; refunds on their payout date; closed days are never restated;
//  • branch scope from the caller's grants; staff-level breakdowns need a manager permission;
//  • asOf: facts recorded after asOf are invisible (late sync never rewrites an earlier snapshot);
//  • provisional flag when a day of the period is open / not closed;
//  • ratios = Σ numerator / Σ denominator (never an average of averages); totals are recomputed, never summed rows;
//  • distinct counts (orders, guests, staff meals) never multiply on split checks;
//  • semi-additive stock is a snapshot at asOf, never summed over time;
//  • an illegal metric × dimension is refused with a reason; an unavailable source is NOT_AVAILABLE(reason), never 0.
import type { DB } from '../mock/types';
import { D, m4 } from '../mock/money';
import { businessDate as bdOf } from '../mock/clock';
import { capabilityOn } from '../mock/ops-registry';
import { userLabel } from '../demo/people';
import { METRICS, metricById } from './registry/metrics';
import { dimensionById } from './registry/dimensions';
import { factsOf, addDays, inRange, DAYPART_LABEL, weekOf, type FactScope } from './facts';
import type { Fact, FactKind, MetricDef, MetricValue, QueryResult, QuerySpec, QueryRow, QueryMeta, EvidenceRef, DayStatus } from './types';
import type { Loc } from '../mock/types';

export interface Caller { userId: string | null; perms: (p: string) => boolean; accessibleBranchIds: string[]; nowMs: number; defaultBranchId: string | null }
export class ReportRefusal extends Error { constructor(public code: string, public details: Record<string, unknown> = {}) { super(code); } }

type Ev =
  | { t: 'sum'; fact: FactKind; field: string }
  | { t: 'distinct'; fact: FactKind; key: string }
  | { t: 'distinct_sum'; fact: FactKind; key: string; field: string }
  | { t: 'sum_requires'; fact: FactKind; field: string }
  | { t: 'diff_requires'; fact: FactKind; a: string; b: string }
  | { t: 'share'; fact: FactKind; field: string }
  | { t: 'snapshot'; fact: FactKind; field: string }
  | { t: 'requires_dim'; dim: string; inner: Ev }
  | { t: 'trace'; inner: Ev }
  | { t: 'price_change' } | { t: 'freshness' } | { t: 'recon' } | { t: 'registry' };

/** Evaluators, by metric id (the registry stays data). Metrics without an evaluator are NOT_AVAILABLE. */
export const EVAL: Record<string, Ev> = {
  gross_item_sales: { t: 'sum', fact: 'line', field: 'gross' },
  discount_amount: { t: 'sum', fact: 'discount', field: 'amount' },
  item_net_sales: { t: 'sum', fact: 'line', field: 'net' },
  dine_in_item_net_sales: { t: 'sum', fact: 'line', field: 'dine_in_net' },
  return_sales_adjustment: { t: 'sum', fact: 'refund', field: 'net' },
  net_item_sales: { t: 'registry' },
  tax_amount: { t: 'sum', fact: 'check', field: 'tax' },
  refund_tax_amount: { t: 'sum', fact: 'refund', field: 'tax' },
  service_charge: { t: 'sum', fact: 'check', field: 'service' },
  other_fees: { t: 'sum', fact: 'check', field: 'fees' },
  table_tax: { t: 'sum', fact: 'check', field: 'table_tax' },
  recognized_sales_total: { t: 'sum', fact: 'check', field: 'payable' },
  tender_collected: { t: 'sum', fact: 'payment', field: 'amount' },
  tender_refunded: { t: 'sum', fact: 'refund', field: 'amount' },
  net_tender_movement: { t: 'registry' },
  rounding_adjustment: { t: 'sum', fact: 'payment', field: 'rounding' },
  rounding_count: { t: 'sum', fact: 'payment', field: 'rounded' },
  cash_expected: { t: 'sum', fact: 'drawer', field: 'expected' },
  cash_counted: { t: 'sum', fact: 'drawer', field: 'counted' },
  cash_variance: { t: 'sum', fact: 'drawer', field: 'variance' },
  payment_count: { t: 'sum', fact: 'payment', field: 'positive' },
  tender_corrections: { t: 'sum', fact: 'payment', field: 'correction' },
  no_sale_opens: { t: 'sum', fact: 'cash_entry', field: 'no_sale' },
  cash_withdrawals: { t: 'sum', fact: 'cash_entry', field: 'withdrawal' },
  order_count: { t: 'distinct', fact: 'check', key: 'order' },
  check_count: { t: 'distinct', fact: 'check', key: 'check' },
  avg_check: { t: 'registry' },
  guest_count: { t: 'distinct_sum', fact: 'check', key: 'visit', field: 'guests' },
  avg_guest_spend: { t: 'registry' },
  table_turns: { t: 'sum', fact: 'visit', field: 'one' },
  visit_minutes: { t: 'sum', fact: 'visit', field: 'minutes' },
  avg_dining_minutes: { t: 'registry' },
  outstanding_checks: { t: 'sum', fact: 'open_check', field: 'one' },
  outstanding_amount: { t: 'sum', fact: 'open_check', field: 'remaining' },
  sold_quantity: { t: 'sum', fact: 'line', field: 'qty' },
  food_theoretical_cost: { t: 'sum_requires', fact: 'line', field: 'cost' },
  menu_contribution: { t: 'diff_requires', fact: 'line', a: 'net', b: 'cost' },
  menu_contribution_pct: { t: 'registry' },
  menu_popularity: { t: 'share', fact: 'line', field: 'qty' },
  discount_count: { t: 'sum', fact: 'discount', field: 'one' },
  comps_value: { t: 'sum', fact: 'comp', field: 'amount' },
  void_line_count: { t: 'sum', fact: 'removal', field: 'line' },
  void_value: { t: 'sum', fact: 'removal', field: 'value' },
  order_void_count: { t: 'sum', fact: 'removal', field: 'order' },
  refund_count: { t: 'sum', fact: 'refund', field: 'one' },
  approval_count: { t: 'sum', fact: 'approval', field: 'granted' },
  approval_denied_count: { t: 'sum', fact: 'approval', field: 'denied' },
  self_approval_count: { t: 'sum', fact: 'approval', field: 'self' },
  staff_meal_count: { t: 'distinct', fact: 'staff_meal', key: 'meal' },
  staff_meal_value: { t: 'sum', fact: 'staff_meal', field: 'value' },
  staff_meal_cost: { t: 'sum_requires', fact: 'staff_meal', field: 'cost' },
  waste_held_pending: { t: 'trace', inner: { t: 'sum', fact: 'removal', field: 'pending' } },
  waste_held_missing: { t: 'trace', inner: { t: 'sum', fact: 'removal', field: 'missing' } },
  kds_ticket_minutes: { t: 'sum', fact: 'kitchen', field: 'minutes' },
  kds_completed_count: { t: 'sum', fact: 'kitchen', field: 'done' },
  kds_avg_ticket_minutes: { t: 'registry' },
  kds_late_count: { t: 'sum', fact: 'kitchen', field: 'late' },
  stock_on_hand: { t: 'requires_dim', dim: 'inventory_item', inner: { t: 'snapshot', fact: 'stock', field: 'qty' } },
  inventory_value: { t: 'snapshot', fact: 'stock', field: 'value' },
  waste_value: { t: 'sum', fact: 'waste', field: 'value' },
  stock_waste_qty: { t: 'requires_dim', dim: 'inventory_item', inner: { t: 'sum', fact: 'waste', field: 'qty' } },
  stock_variance_qty: { t: 'requires_dim', dim: 'inventory_item', inner: { t: 'sum', fact: 'count', field: 'qty' } },
  stock_variance_value: { t: 'sum', fact: 'count', field: 'value' },
  po_ordered_value: { t: 'sum', fact: 'po', field: 'value' },
  goods_received_value: { t: 'sum', fact: 'grn', field: 'value' },
  supplier_price_change: { t: 'price_change' },
  eta_receipt_count: { t: 'sum', fact: 'fiscal', field: 'accepted' },
  eta_pending_count: { t: 'sum', fact: 'fiscal', field: 'pending' },
  eta_failed_count: { t: 'sum', fact: 'fiscal', field: 'rejected' },
  reconciliation_errors: { t: 'recon' },
  data_freshness_minutes: { t: 'freshness' },
  reservation_count: { t: 'sum', fact: 'reservation', field: 'one' },
  no_show_count: { t: 'sum', fact: 'reservation', field: 'no_show' },
  delivery_minutes_total: { t: 'sum', fact: 'delivery', field: 'minutes' },
  delivered_count: { t: 'sum', fact: 'delivery', field: 'delivered' },
  delivery_failed_count: { t: 'sum', fact: 'delivery', field: 'failed' },
  delivery_avg_minutes: { t: 'registry' },
};
/** Metrics that can read the pre-launch daily aggregates (no evidence below the day) and the dimensions they allow. */
const HISTORY: Record<string, { field: string; dims: string[]; byMethod?: boolean }> = {
  item_net_sales: { field: 'net', dims: ['business_date', 'business_week', 'branch'] },
  net_item_sales: { field: 'net', dims: ['business_date', 'business_week', 'branch'] },
  order_count: { field: 'orders', dims: ['business_date', 'business_week', 'branch'] },
  check_count: { field: 'orders', dims: ['business_date', 'business_week', 'branch'] },
  guest_count: { field: 'guests', dims: ['business_date', 'business_week', 'branch'] },
  tender_collected: { field: 'tender', dims: ['business_date', 'business_week', 'branch', 'payment_method'], byMethod: true },
};
const CAPABILITY_OF: Partial<Record<FactKind, string>> = { stock: 'INVENTORY', waste: 'INVENTORY', count: 'INVENTORY', po: 'INVENTORY', grn: 'INVENTORY', fiscal: 'E_RECEIPT', delivery: 'DELIVERY', reservation: 'RESERVATIONS', visit: 'TABLE_SERVICE' };
const SPECIAL_REFUSAL: Record<string, Loc> = {
  'payment_method': { ar: 'طريقة الدفع بُعد للفلوس اللي دخلت، مش للمبيعات. استخدم «المتحصل» أو جسر نهاية اليوم.', en: 'Payment method applies to collections, not sales. Use collected or the EOD bridge.' },
  'business_date@SEMI': { ar: 'الرصيد لقطة في لحظة واحدة — ما بيتجمعش على الأيام. اختار لحظة (asOf).', en: 'Stock is a snapshot — never summed over days. Pick an asOf instant.' },
};

const NOT_AVAIL = (reason: Loc): MetricValue => ({ value: null, availability: 'NOT_AVAILABLE', reason });
const LAUNCH_CACHE = new WeakMap<DB, string>();
/** First business date with event-level facts. Earlier days only have imported daily aggregates. */
export function launchDate(db: DB): string {
  const c = LAUNCH_CACHE.get(db); if (c && db.orders.length) return c;
  const dates = [...db.orders.map((o) => o.completedBusinessDate ?? o.businessDate), ...db.sessions.map((s) => s.businessDate)].filter(Boolean) as string[];
  const prov = db.events.find((e) => e.type === 'Provisioned' || e.type === 'Installed');
  const provDate = prov ? bdOf(Date.parse(prov.at)) : '9999-12-31';
  const v = [provDate, ...dates].sort()[0];
  LAUNCH_CACHE.set(db, v);
  return v;
}
export function dayStatus(db: DB, branchIds: string[], date: string, nowMs: number): DayStatus {
  const today = bdOf(nowMs);
  if (date > today) return 'FUTURE';
  const closed = branchIds.every((b) => (db.businessDays ?? []).some((d) => d.branchId === b && d.date === date));
  if (closed) return 'CLOSED';
  return date === today ? 'OPEN' : 'ENDED_NOT_CLOSED';
}
export function datesOf(from: string, to: string) { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) { out.push(d); if (out.length > 400) break; } return out; }

// ───────── labels
const CH: Record<string, Loc> = { DINE_IN: { ar: 'صالة', en: 'Dine-in' }, TAKEAWAY: { ar: 'تيك أواي', en: 'Takeaway' }, DELIVERY: { ar: 'دليفري', en: 'Delivery' } };
export const TENDER_LABEL: Record<string, Loc> = { CASH: { ar: 'كاش', en: 'Cash' }, CARD: { ar: 'كارت', en: 'Card' }, WALLET: { ar: 'محفظة (إنستاباي/فودافون كاش)', en: 'Wallet' }, PREPAID: { ar: 'مدفوع مسبقًا', en: 'Prepaid' }, POINTS: { ar: 'نقاط', en: 'Points' } };
export const STAGE_LABEL: Record<string, Loc> = { S0: { ar: 'S0 قبل ما يظهر (لسه ما اتبعتش)', en: 'S0 unsent' }, S1: { ar: 'S1 ظاهر (شيك مبدئي/المطبخ) ومش مدفوع', en: 'S1 visible, unpaid' }, S2: { ar: 'S2 مدفوع واليوم مفتوح', en: 'S2 paid, day open' }, S3: { ar: 'S3 مدفوع بعد قفل اليوم', en: 'S3 paid, day closed' } };
export const DISP_LABEL: Record<string, Loc> = { NOT_PREPARED: { ar: 'ما اتعملش', en: 'Not prepared' }, RETURN_TO_STOCK: { ar: 'رجع المخزن', en: 'Back to stock' }, WASTE_HELD: { ar: 'هالك محجوز للمراجعة', en: 'Waste held' } };
const FISCAL_LABEL: Record<string, Loc> = { PENDING_DATA: { ar: 'ناقصه بيانات', en: 'Pending data' }, BUILT: { ar: 'اتجهز', en: 'Built' }, SUBMITTED: { ar: 'اتبعت', en: 'Submitted' }, ACCEPTED: { ar: 'اتقبل', en: 'Accepted' }, REJECTED: { ar: 'اترفض', en: 'Rejected' }, SUPERSEDED: { ar: 'اتصحح بإيصال جديد', en: 'Superseded' } };
const same = (s: string): Loc => ({ ar: s, en: s });
export function dimLabel(db: DB, dim: string, v: string | null): Loc {
  if (v === null || v === undefined || v === '') return { ar: '—', en: '—' };
  const u = () => { const x = db.users.find((y) => y.id === v); return same(x ? userLabel(x.username, x.displayName) : v); };
  switch (dim) {
    case 'business_date': return same(v);
    case 'business_week': return { ar: `أسبوع ${v}`, en: `Week of ${v}` };
    case 'daypart': return DAYPART_LABEL[v] ?? same(v);
    case 'hour': return same(`${v}:00`);
    case 'branch': { const b = db.branches.find((x) => x.id === v); return same(b?.name ?? v); }
    case 'channel': return CH[v] ?? same(v);
    case 'staff': case 'approval_actor': return u();
    case 'device': { const t = db.terminals.find((x) => x.id === v); return same(t?.name ?? v); }
    case 'table': { const t = db.tables.find((x) => x.id === v); return { ar: `ترابيزة ${t?.name ?? v}`, en: `Table ${t?.name ?? v}` }; }
    case 'check': { const o = db.orders.find((x) => x.id === v); return same(o ? `#${o.number}` : v); }
    case 'order': { if (v.startsWith('visit:')) { const vi = db.visits.find((x) => x.id === v.slice(6)); const t = db.tables.find((x) => x.id === vi?.tableId); return { ar: `قعدة ترابيزة ${t?.name ?? ''}`, en: `Visit table ${t?.name ?? ''}` }; } const o = db.orders.find((x) => x.id === v.slice(6)); return same(o ? `#${o.number}` : v); }
    case 'table_visit': { const vi = db.visits.find((x) => x.id === v); const t = db.tables.find((x) => x.id === vi?.tableId); return { ar: `قعدة ترابيزة ${t?.name ?? ''}`, en: `Visit table ${t?.name ?? ''}` }; }
    case 'product': { const p = db.products.find((x) => x.id === v); return p ? p.name : same(v); }
    case 'category': { const c = db.categories.find((x) => x.id === v); return c ? c.name : same(v); }
    case 'size': { for (const p of db.products) { const vv = p.variants?.find((x) => x.id === v); if (vv) return vv.name; } return same(v); }
    case 'modifier': { const names = v.split('+').map((id) => { for (const g of db.modifierGroups) { const o = g.options.find((x) => x.id === id); if (o) return o.name.ar; } return id; }); return same(names.join(' + ')); }
    case 'tax_group': { const t = db.taxPolicies.find((x) => x.id === v); return t ? t.name : same(v); }
    case 'payment_method': return TENDER_LABEL[v] ?? same(v);
    case 'drawer': { const s = db.sessions.find((x) => x.id === v); const t = db.terminals.find((x) => x.id === s?.terminalId); const x = db.users.find((y) => y.id === s?.userId); return same(s ? `${x ? userLabel(x.username, x.displayName) : ''} — ${t?.name ?? ''} (${s.businessDate})` : v); }
    case 'void_reason': { const r = db.reasonCodes.find((x) => x.code === v); return r ? r.label : same(v); }
    case 'stage': return STAGE_LABEL[v] ?? same(v);
    case 'disposition': return DISP_LABEL[v] ?? same(v);
    case 'station': { const s = db.stations.find((x) => x.id === v); return same(s?.name ?? v); }
    case 'fiscal_status': return FISCAL_LABEL[v] ?? same(v);
    case 'inventory_item': { const it = (db as any).inv?.items?.find((x: any) => x.id === v); return it ? it.name : same(v); }
    case 'location': { const w = (db as any).inv?.warehouses?.find((x: any) => x.id === v); return same(w?.name ?? v); }
    case 'supplier': { const s = (db as any).inv?.suppliers?.find((x: any) => x.id === v); return same(s?.name ?? v); }
    case 'zone': { const z = (db as any).deliveryZones?.find((x: any) => x.id === v); return z ? (z.name?.ar ? z.name : same(z.name ?? v)) : same(v); }
    case 'driver': { const d = (db as any).drivers?.find((x: any) => x.id === v); return same(d?.name ?? v); }
    case 'revenue_center': return same(v);
    default: return same(v);
  }
}

// ───────── evaluation
interface Ctx { db: DB; scope: FactScope; cache: Map<string, Fact[]>; dims: string[]; filters: Record<string, string[]>; launch: string; caller: Caller }
type Groups = Map<string, { dims: Record<string, string | null>; value: MetricValue; facts: Fact[]; source?: 'EVENTS' | 'HISTORY' }>;
const keyOf = (dims: string[], f: Fact) => dims.map((d) => f.dims[d] ?? '∅').join('|');
const dimsOf = (dims: string[], f: Fact) => Object.fromEntries(dims.map((d) => [d, f.dims[d] ?? null]));

function factDims(kind: FactKind, sample?: Fact): string[] | null { return sample ? Object.keys(sample.dims) : null; }
function filterFacts(c: Ctx, facts: Fact[]): Fact[] {
  const fs = Object.entries(c.filters).filter(([, v]) => v.length);
  if (!fs.length) return facts;
  return facts.filter((f) => fs.every(([d, vs]) => vs.includes(String(f.dims[d] ?? ''))));
}
const evFact = (e: Ev): FactKind | null => ('fact' in e ? e.fact : e.t === 'requires_dim' || e.t === 'trace' ? evFact(e.inner) : e.t === 'price_change' ? 'grn' : null);

function group(c: Ctx, facts: Fact[], fn: (fs: Fact[]) => MetricValue): Groups {
  const g: Groups = new Map();
  const buckets = new Map<string, Fact[]>();
  for (const f of facts) { const k = keyOf(c.dims, f); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(f); }
  for (const [k, fs] of buckets) g.set(k, { dims: dimsOf(c.dims, fs[0]), value: fn(fs), facts: fs });
  return g;
}
const sumField = (fs: Fact[], field: string) => fs.reduce((a, f) => a.plus(D(f.n[field] || 0)), D(0));
const val = (v: any, n?: number): MetricValue => ({ value: m4(v), availability: 'AVAILABLE', evidenceCount: n });

function evaluate(c: Ctx, m: MetricDef, e: Ev): Groups {
  switch (e.t) {
    case 'sum': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => val(sumField(fs, e.field), fs.length));
    case 'distinct': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => val(new Set(fs.map((f) => f.key?.[e.key] ?? f.id)).size, fs.length));
    case 'distinct_sum': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => {
      const seen = new Map<string, string>();
      for (const f of fs) { const k = f.key?.[e.key]; if (k && f.n[e.field] !== '') seen.set(k, f.n[e.field]); }
      if (!seen.size) return NOT_AVAIL({ ar: 'مفيش عدد ضيوف متسجل (تيك أواي/كاونتر) — مش هنقول صفر.', en: 'No guest count recorded — not zero.' });
      return val([...seen.values()].reduce((a, x) => a.plus(D(x)), D(0)), seen.size);
    });
    case 'sum_requires': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => {
      const missing = fs.filter((f) => f.n[e.field] === undefined);
      if (missing.length) return NOT_AVAIL({ ar: `التكلفة مش متاحة: ${missing.length} سطر لأصناف من غير وصفة تكلفة.`, en: `Cost unavailable: ${missing.length} line(s) without a recipe.` });
      return val(sumField(fs, e.field), fs.length);
    });
    case 'diff_requires': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => {
      const missing = fs.filter((f) => f.n[e.b] === undefined);
      if (missing.length) return NOT_AVAIL({ ar: `الهامش مش متاح: ${missing.length} سطر من غير وصفة تكلفة (عمره ما بيتحسب صفر).`, en: `Margin unavailable: ${missing.length} line(s) without recipe cost (never zero).` });
      return val(sumField(fs, e.a).minus(sumField(fs, e.b)), fs.length);
    });
    case 'share': {
      const facts = filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache));
      const total = sumField(facts, e.field);
      return group(c, facts, (fs) => total.isZero() ? { value: null, availability: 'NOT_DEFINED', reason: { ar: 'مفيش كميات في النطاق', en: 'No quantity in scope' } } : { ...val(sumField(fs, e.field).dividedBy(total).times(100), fs.length), numerator: m4(sumField(fs, e.field)), denominator: m4(total) });
    }
    case 'snapshot': return group(c, filterFacts(c, factsOf(c.db, e.fact, c.scope, c.cache)), (fs) => ({ ...val(sumField(fs, e.field), fs.length), snapshotAt: new Date(c.scope.asOfMs).toISOString() }));
    case 'requires_dim': {
      if (!c.dims.includes(e.dim) && !(c.filters[e.dim]?.length === 1)) { const g: Groups = new Map(); g.set('*', { dims: {}, value: { value: null, availability: 'NOT_DEFINED', reason: { ar: 'اختار الخامة: ما ينفعش نجمع كميات بوحدات مختلفة (كيلو + لتر + قطعة).', en: 'Pick the ingredient: quantities in different units cannot be added.' } }, facts: [] }); return g; }
      return evaluate(c, m, e.inner);
    }
    case 'trace': {
      if (!((c.db as any).reversals?.length)) { const g: Groups = new Map(); g.set('*', { dims: {}, value: NOT_AVAIL({ ar: 'طابور مراجعة الهالك لسه ما اتسجلش فيه حاجة (سجل الإلغاءات بالمراحل مش موجود).', en: 'No reversal trace recorded yet.' }), facts: [] }); return g; }
      return evaluate(c, m, e.inner);
    }
    case 'price_change': return group(c, filterFacts(c, factsOf(c.db, 'grn', c.scope, c.cache)), (fs) => {
      const byItem = new Map<string, Fact[]>();
      for (const f of fs) (byItem.get(f.dims.inventory_item!) ?? byItem.set(f.dims.inventory_item!, []).get(f.dims.inventory_item!)!).push(f);
      let num = D(0), den = D(0);
      for (const list of byItem.values()) { const s = list.sort((a, b) => a.recordedMs - b.recordedMs); if (s.length < 2) continue; const last = D(s.at(-1)!.n.unit_cost), prev = D(s.at(-2)!.n.unit_cost); num = num.plus(last.minus(prev)); den = den.plus(prev); }
      if (den.isZero()) return { value: null, availability: 'NOT_DEFINED', reason: { ar: 'محتاج استلامين على الأقل لنفس الخامة في الفترة.', en: 'Needs two receipts of the same item.' } };
      return { ...val(num.dividedBy(den).times(100), fs.length), numerator: m4(num), denominator: m4(den) };
    });
    case 'freshness': {
      const kinds: FactKind[] = ['check', 'payment', 'refund', 'drawer', 'removal'];
      const all = kinds.flatMap((k) => filterFacts(c, factsOf(c.db, k, c.scope, c.cache)));
      return group(c, all.length ? all : [], (fs) => { const last = Math.max(...fs.map((f) => f.recordedMs)); return { ...val((c.scope.asOfMs - last) / 60000, fs.length), snapshotAt: new Date(last).toISOString() }; });
    }
    case 'recon': {
      const facts = filterFacts(c, factsOf(c.db, 'recon', c.scope, c.cache));
      if (!facts.length) { const g: Groups = new Map(); g.set('*', { dims: {}, value: NOT_AVAIL({ ar: 'المطابقة ما اتشغلتش على الفترة دي.', en: 'Reconciliation not run for this period.' }), facts: [] }); return g; }
      return group(c, facts, (fs) => val(sumField(fs, 'failed'), fs.length));
    }
    case 'registry': {
      if (m.terms) {
        const parts = m.terms.map((t) => ({ t, g: evalMetric(c, metricById.get(t.metric)!) }));
        const keys = new Set(parts.flatMap((p) => [...p.g.keys()]));
        const out: Groups = new Map();
        for (const k of keys) {
          let acc = D(0); let na: MetricValue | null = null; let dims: Record<string, string | null> = {}; const facts: Fact[] = []; let src: 'EVENTS' | 'HISTORY' | undefined;
          for (const p of parts) { const x = p.g.get(k); if (!x) continue; dims = x.dims; facts.push(...x.facts); if (x.source === 'HISTORY') src = 'HISTORY'; if (x.value.availability !== 'AVAILABLE') { na = x.value; continue; } acc = acc.plus(D(x.value.value!).times(p.t.sign)); }
          out.set(k, { dims, value: na ?? val(acc, facts.length), facts, source: src });
        }
        return out;
      }
      if (m.numerator && m.denominator) {
        const nm = metricById.get(m.numerator)!, dm = metricById.get(m.denominator)!;
        const n = evalMetric(c, nm), d = evalMetric(c, dm);
        const out: Groups = new Map();
        for (const k of new Set([...n.keys(), ...d.keys()])) {
          const a = n.get(k), b = d.get(k);
          const dims = a?.dims ?? b!.dims;
          if (a && a.value.availability !== 'AVAILABLE') { out.set(k, { dims, value: a.value, facts: [] }); continue; }
          if (b && b.value.availability !== 'AVAILABLE') { out.set(k, { dims, value: b.value, facts: [] }); continue; }
          const num = D(a?.value.value ?? 0), den = D(b?.value.value ?? 0);
          out.set(k, { dims, facts: [...(a?.facts ?? []), ...(b?.facts ?? [])], source: a?.source ?? b?.source, value: den.isZero() ? { value: null, availability: 'NOT_DEFINED', reason: { ar: `مفيش ${dm.label.ar} — النسبة مش متعرفة`, en: `No ${dm.label.en} — ratio undefined` }, numerator: m4(num), denominator: '0.0000' } : { value: m4(num.dividedBy(den).times(m.scale ?? 1)), availability: 'AVAILABLE', numerator: m4(num), denominator: m4(den) } });
        }
        return out;
      }
      return new Map();
    }
  }
}

/** Evaluate a metric over events, then fill pre-launch days from the daily aggregates where allowed. */
function evalMetric(c: Ctx, m: MetricDef): Groups {
  const e = EVAL[m.id];
  const g = evaluate(c, m, e);
  const h = HISTORY[m.id];
  const preLaunch = c.scope.from < c.launch;
  if (!preLaunch || m.terms || m.numerator) return g; // composites and ratios get history through their parts
  if (h && c.dims.every((d) => h.dims.includes(d)) && Object.keys(c.filters).every((d) => h.dims.includes(d) || !c.filters[d].length)) {
    const hs = filterFacts(c, factsOf(c.db, 'history', { ...c.scope, to: addDays(c.launch, -1) < c.scope.to ? addDays(c.launch, -1) : c.scope.to }, c.cache));
    const expanded: Fact[] = h.byMethod ? hs.flatMap((f) => (['CASH', 'CARD', 'WALLET'] as const).map((pm) => ({ ...f, id: `${f.id}:${pm}`, dims: { ...f.dims, payment_method: pm }, n: { ...f.n, tender: f.n[pm === 'CASH' ? 'cash' : pm === 'CARD' ? 'card' : 'wallet'] } }))) : hs;
    const filtered = filterFacts(c, expanded);
    const hg = group(c, filtered, (fs) => val(sumField(fs, h.field), fs.length));
    for (const [k, x] of hg) { const ex = g.get(k); if (ex && ex.value.availability === 'AVAILABLE') { ex.value = val(D(ex.value.value!).plus(D(x.value.value!))); ex.facts.push(...x.facts); ex.source = 'HISTORY'; } else g.set(k, { ...x, source: 'HISTORY' }); }
  }
  return g;
}

function pmRefusal(m: MetricDef, dim: string): Loc {
  if (dim === 'payment_method' && ['line', 'check', 'composite', 'discount'].includes(m.fact) && !m.id.startsWith('net_tender')) return SPECIAL_REFUSAL.payment_method;
  if (m.additivity === 'SEMI_ADDITIVE' && (dim === 'business_date' || dim === 'business_week')) return SPECIAL_REFUSAL['business_date@SEMI'];
  const dd = dimensionById.get(dim);
  return { ar: `«${m.label.ar}» ما ينفعش يتقسم حسب «${dd?.label.ar ?? dim}» — المصدر بتاعه (${m.grain}) مفيهوش البُعد ده، والتقسيم كان هيكرر أرقام.`, en: `${m.label.en} cannot be broken down by ${dd?.label.en ?? dim}: its grain (${m.grain}) does not carry it; the join would duplicate measures.` };
}

/** Branches the caller may read in reports. */
export function scopeBranches(db: DB, caller: Caller, requested?: string[]): string[] {
  const list = requested?.length ? requested : caller.defaultBranchId ? [caller.defaultBranchId] : caller.accessibleBranchIds;
  const bad = list.filter((b) => !caller.accessibleBranchIds.includes(b));
  if (bad.length) throw new ReportRefusal('REPORT_SCOPE_DENIED', { branchIds: bad });
  if (!list.length) throw new ReportRefusal('REPORT_SCOPE_DENIED', { reason: 'no branch' });
  return list;
}

export function query(db: DB, caller: Caller, q: QuerySpec): QueryResult {
  const from = q.from; const to = q.to ?? q.from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new ReportRefusal('VALIDATION_FAILED', { field: 'period' });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 93) throw new ReportRefusal('VALIDATION_FAILED', { rule: 'a range is at most 93 days' });
  const branchIds = scopeBranches(db, caller, q.branchIds);
  const asOfMs = Math.min(q.asOf ? Date.parse(q.asOf) : caller.nowMs, caller.nowMs);
  const dims = [...new Set(q.dimensions ?? [])];
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(q.filters ?? {})) if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) filters[k] = (Array.isArray(v) ? v : String(v).split(',')).map(String);
  const refused: QueryMeta['refused'] = []; const notAvailable: QueryMeta['notAvailable'] = [];
  for (const d of [...dims, ...Object.keys(filters)]) if (!dimensionById.has(d)) throw new ReportRefusal('VALIDATION_FAILED', { field: 'dimension', value: d });
  const scope: FactScope = { branchIds, from, to, asOfMs };
  const c: Ctx = { db, scope, cache: new Map(), dims, filters, launch: launchDate(db), caller };
  // the recon fact source is built lazily by the reconciliation module (avoids an import cycle)
  if (q.metrics.includes('reconciliation_errors')) c.cache.set(`recon|${branchIds.join(',')}|${from}|${to}|${asOfMs}`, reconFacts(db, scope));
  const ok: MetricDef[] = [];
  for (const id of q.metrics) {
    const m = metricById.get(id);
    if (!m) throw new ReportRefusal('METRIC_NOT_FOUND', { metric: id });
    if (m.status === 'NOT_AVAILABLE' || !EVAL[id]) { notAvailable.push({ metric: id, reason: m.reason ?? { ar: 'المصدر مش موجود', en: 'No source' } }); continue; }
    const fk = evFact(EVAL[id]) ?? (m.numerator ? evFact(EVAL[m.numerator]) : m.terms ? evFact(EVAL[m.terms[0].metric]) : null);
    const cap = fk ? CAPABILITY_OF[fk] : undefined;
    if (cap && !branchIds.some((b) => capabilityOn(db, cap, b))) { notAvailable.push({ metric: id, reason: { ar: 'الموديول ده مقفول للفرع — الرقم مش متاح (مش صفر).', en: 'Module switched off for this branch — not available (not zero).' } }); continue; }
    if (m.permission && !caller.perms(m.permission)) { refused.push({ metric: id, reason: { ar: 'الرقم ده للمدير والمحاسب بس.', en: 'Managers and accountants only.' } }); continue; }
    const badDim = [...dims, ...Object.keys(filters)].find((d) => !m.dimensions.includes(d));
    if (badDim) { refused.push({ metric: id, dimension: badDim, reason: pmRefusal(m, badDim) }); continue; }
    const permDim = dims.find((d) => dimensionById.get(d)?.permission && !caller.perms(dimensionById.get(d)!.permission!));
    if (permDim) { refused.push({ metric: id, dimension: permDim, reason: { ar: `التقسيم حسب «${dimensionById.get(permDim)!.label.ar}» للمدير بس.`, en: `Breakdown by ${dimensionById.get(permDim)!.label.en} is for managers.` } }); continue; }
    ok.push(m);
  }
  const groups = new Map(ok.map((m) => [m.id, evalMetric(c, m)]));
  const totalsCtx: Ctx = { ...c, dims: [] };
  const totals: Record<string, MetricValue> = {};
  const preLaunchDays = datesOf(from, to).filter((d) => d < c.launch);
  for (const m of ok) {
    const g = evalMetric(totalsCtx, m).get('') ?? evalMetric(totalsCtx, m).get('*');
    totals[m.id] = g?.value ?? zeroOrNA(m, c);
    if (preLaunchDays.length && !hasHistory(m) && totals[m.id].availability === 'AVAILABLE') totals[m.id] = { ...totals[m.id], reason: { ar: `الأيام قبل ${c.launch} مفيهاش بيانات تفصيلية — مش داخلة في الرقم.`, en: `Days before ${c.launch} have no event-level data — excluded.` } };
    if (preLaunchDays.length === datesOf(from, to).length && !hasHistory(m) && m.fact !== 'stock' && m.fact !== 'open_check') totals[m.id] = NOT_AVAIL({ ar: `الفترة كلها قبل تشغيل السيستم (${c.launch}) — عندنا إجماليات يومية بس.`, en: `Whole period precedes launch (${c.launch}) — daily aggregates only.` });
  }
  for (const id of notAvailable.map((x) => x.metric)) totals[id] = NOT_AVAIL(notAvailable.find((x) => x.metric === id)!.reason);
  for (const r of refused) totals[r.metric] = { value: null, availability: 'REFUSED', reason: r.reason };
  // rows: union of keys over metrics
  const rowMap = new Map<string, QueryRow>();
  if (dims.length) for (const m of ok) for (const [k, x] of groups.get(m.id)!) {
    if (k === '*') continue;
    const r = rowMap.get(k) ?? { key: k, dims: x.dims, labels: Object.fromEntries(dims.map((d) => [d, dimLabel(db, d, x.dims[d])])), values: {} };
    r.values[m.id] = x.value; if (x.source) r.source = x.source;
    rowMap.set(k, r);
  }
  let rows = [...rowMap.values()];
  for (const r of rows) for (const m of ok) {
    if (r.values[m.id]) continue;
    const pre = r.dims.business_date && r.dims.business_date < c.launch;
    r.values[m.id] = pre && !hasHistory(m) ? NOT_AVAIL({ ar: 'يوم قبل تشغيل السيستم — مفيش بيانات تفصيلية.', en: 'Pre-launch day — no event-level data.' }) : zeroOrNA(m, c);
  }
  const sortM = q.sort?.metric ?? ok[0]?.id;
  if (dims.includes('business_date') || dims.includes('hour') || dims.includes('business_week')) rows.sort((a, b) => a.key.localeCompare(b.key));
  else if (sortM) rows.sort((a, b) => (q.sort?.dir === 'asc' ? 1 : -1) * D(a.values[sortM]?.value ?? -1e15).comparedTo(D(b.values[sortM]?.value ?? -1e15)));
  if (q.limit) rows = rows.slice(0, q.limit);
  const days = datesOf(from, to).map((d) => ({ date: d, status: dayStatus(db, branchIds, d, caller.nowMs), source: (d < c.launch ? ((db.salesHistory ?? []).some((h) => h.businessDate === d && branchIds.includes(h.branchId)) ? 'HISTORY' : 'NONE') : 'EVENTS') as 'EVENTS' | 'HISTORY' | 'NONE' }));
  const openSessions = db.sessions.filter((s) => branchIds.includes(s.branchId) && s.state === 'OPEN' && inRange(s.businessDate, from, to));
  const provisionalReasons: Loc[] = [];
  if (days.some((d) => d.status === 'OPEN')) provisionalReasons.push({ ar: 'اليوم التجاري لسه ما خلصش (بيخلص 4 الفجر).', en: 'The business day has not ended (04:00).' });
  if (openSessions.length) provisionalReasons.push({ ar: `فيه ${openSessions.length} وردية مفتوحة.`, en: `${openSessions.length} open session(s).` });
  if (days.some((d) => d.status === 'ENDED_NOT_CLOSED')) provisionalReasons.push({ ar: 'فيه يوم خلص بس لسه ما اتقفلش (إقفال اليوم).', en: 'A day ended but is not closed yet.' });
  if (asOfMs < caller.nowMs - 60_000) provisionalReasons.push({ ar: 'التقرير لقطة قديمة (asOf) — اللي اتسجل بعدها مش ظاهر.', en: 'An older asOf snapshot — later records hidden.' });
  const meta: QueryMeta = {
    from, to, branchIds, timezone: 'Africa/Cairo', cutoff: db.branches.find((b) => b.id === branchIds[0])?.businessDayCutoff ?? '04:00', asOf: new Date(asOfMs).toISOString(), days,
    provisional: provisionalReasons.length > 0, provisionalReasons, refused, notAvailable, weekStart: 'SATURDAY', filters: q.filters ?? {},
    metrics: q.metrics.map((id) => metricById.get(id)!).filter(Boolean).map((m) => ({ id: m.id, label: m.label, version: m.version, definition: m.definition, unit: m.unit, additivity: m.additivity, authority: m.authority, status: m.status })),
  };
  return { meta, dimensions: dims, metrics: q.metrics, rows, totals };
}
const hasHistory = (m: MetricDef) => !!HISTORY[m.id] || !!m.terms?.every((t) => HISTORY[t.metric]) || (!!m.numerator && !!HISTORY[m.numerator] && !!HISTORY[m.denominator!]);
function zeroOrNA(m: MetricDef, c: Ctx): MetricValue {
  if (m.additivity === 'WEIGHTED_RATIO') return { value: null, availability: 'NOT_DEFINED', reason: { ar: 'مفيش بيانات في النطاق — النسبة مش متعرفة.', en: 'No data in scope — ratio undefined.' } };
  if (m.id === 'guest_count') return NOT_AVAIL({ ar: 'مفيش عدد ضيوف متسجل في النطاق.', en: 'No guest count recorded.' });
  if (m.id === 'data_freshness_minutes') return NOT_AVAIL({ ar: 'مفيش أي حركة اتسجلت في النطاق — مش عارفين آخر تحديث.', en: 'No event in scope.' });
  return { value: '0.0000', availability: 'AVAILABLE', evidenceCount: 0, reason: { ar: 'المصدر شغال ومفيش حركات في الفترة دي.', en: 'Source live; no events in this period.' } };
}

/** L4: the exact source records behind one cell. Their amounts add up to the cell (the proof is returned too). */
export function explain(db: DB, caller: Caller, spec: { metric: string; cell?: Record<string, string | null>; filters?: QuerySpec['filters']; from: string; to?: string; branchIds?: string[]; asOf?: string }) {
  const m = metricById.get(spec.metric);
  if (!m) throw new ReportRefusal('METRIC_NOT_FOUND', { metric: spec.metric });
  const cellFilters = Object.fromEntries(Object.entries(spec.cell ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v)]));
  const r = query(db, caller, { metrics: [spec.metric], filters: { ...(spec.filters ?? {}), ...cellFilters }, from: spec.from, to: spec.to, branchIds: spec.branchIds, asOf: spec.asOf });
  const total = r.totals[spec.metric];
  const branchIds = r.meta.branchIds;
  const scope: FactScope = { branchIds, from: r.meta.from, to: r.meta.to, asOfMs: Date.parse(r.meta.asOf) };
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries({ ...(spec.filters ?? {}), ...cellFilters })) if (v !== undefined && v !== '') filters[k] = (Array.isArray(v) ? v : String(v).split(',')).map(String);
  const c: Ctx = { db, scope, cache: new Map(), dims: [], filters, launch: launchDate(db), caller };
  if (spec.metric === 'reconciliation_errors') c.cache.set(`recon|${branchIds.join(',')}|${scope.from}|${scope.to}|${scope.asOfMs}`, reconFacts(db, scope));
  const parts: { metric: string; label: Loc; sign: 1 | -1; role: 'term' | 'numerator' | 'denominator' | 'value'; field: string | null; evidence: EvidenceRef[]; sum: string | null }[] = [];
  const collect = (mm: MetricDef, sign: 1 | -1, role: 'term' | 'numerator' | 'denominator' | 'value') => {
    const e = EVAL[mm.id];
    if (e?.t === 'registry') { if (mm.terms) mm.terms.forEach((t) => collect(metricById.get(t.metric)!, (sign * t.sign) as 1 | -1, 'term')); else { collect(metricById.get(mm.numerator!)!, 1, 'numerator'); collect(metricById.get(mm.denominator!)!, 1, 'denominator'); } return; }
    const g = evalMetric(c, mm);
    const facts = [...g.values()].flatMap((x) => x.facts);
    const inner = e && (e.t === 'requires_dim' || e.t === 'trace') ? e.inner : e;
    const field = inner && 'field' in inner ? inner.field : inner && inner.t === 'diff_requires' ? inner.a : null;
    const distinct = inner && (inner.t === 'distinct' || inner.t === 'distinct_sum');
    const seenKeys = new Set<string>();
    const evidence = facts.map((f) => {
      let amt: string | null = field ? (f.n[field] ?? null) : f.ref.amount ?? null;
      if (inner?.t === 'diff_requires') amt = f.n.cost !== undefined ? m4(D(f.n.net).minus(f.n.cost)) : null;
      if (f.kind === 'history' && inner && 'field' in inner && HISTORY[mm.id]) amt = f.n[HISTORY[mm.id].field] ?? f.ref.amount ?? null;
      if (distinct) { const k = f.key?.[(inner as any).key] ?? f.id; const dup = seenKeys.has(k); seenKeys.add(k); return { ...f.ref, amount: dup ? '0' : inner!.t === 'distinct_sum' ? f.n[(inner as any).field] || '0' : '1', note: dup ? 'same-order (counted once)' : f.ref.note }; }
      return { ...f.ref, amount: amt };
    }).filter((x) => x.amount === null || !D(x.amount).isZero() || distinct || (field !== 'positive' && field !== 'rounded' && field !== 'line' && field !== 'order' && field !== 'pending' && field !== 'missing' && field !== 'no_sale' && field !== 'withdrawal' && field !== 'correction' && field !== 'dine_in_net' && field !== 'late' && field !== 'done' && field !== 'accepted' && field !== 'rejected' && field !== 'granted' && field !== 'denied' && field !== 'self' && field !== 'no_show' && field !== 'delivered' && field !== 'failed'));
    const sum = evidence.every((x) => x.amount !== null) ? m4(evidence.reduce((a, x) => a.plus(D(x.amount!)), D(0))) : null;
    parts.push({ metric: mm.id, label: mm.label, sign, role, field, evidence: evidence.slice(0, 500), sum });
  };
  collect(m, 1, 'value');
  let proof: { equation: string; holds: boolean | null } = { equation: '', holds: null };
  if (m.terms) { const s = parts.reduce((a, p) => a.plus(D(p.sum ?? 0).times(p.sign)), D(0)); proof = { equation: parts.map((p) => `${p.sign < 0 ? '− ' : '+ '}${p.label.ar} ${p.sum}`).join(' ') + ` = ${m4(s)}`, holds: total.value !== null ? D(total.value).equals(s) : null }; }
  else if (m.numerator) { const n = parts.find((p) => p.role === 'numerator'), d = parts.find((p) => p.role === 'denominator'); proof = { equation: `${n?.label.ar} ${n?.sum} ÷ ${d?.label.ar} ${d?.sum}${m.scale ? ' × ' + m.scale : ''}`, holds: total.value !== null && n?.sum && d?.sum && !D(d.sum).isZero() ? D(total.value).equals(D(m4(D(n.sum).dividedBy(d.sum).times(m.scale ?? 1)))) : null }; }
  else if (parts[0]?.sum !== null && total.value !== null && !['share', 'snapshot', 'price_change', 'freshness'].includes(EVAL[m.id]?.t)) proof = { equation: `Σ ${parts[0].evidence.length} = ${parts[0].sum}`, holds: D(parts[0].sum!).equals(D(total.value)) };
  return { metric: { id: m.id, label: m.label, version: m.version, definition: m.definition, formula: m.formula, unit: m.unit, pitfalls: m.pitfalls }, value: total, cell: spec.cell ?? {}, meta: r.meta, parts, proof };
}

// late-bound reconciliation facts (set by recon.ts) — avoids engine ↔ recon import cycle
let reconFacts: (db: DB, s: FactScope) => Fact[] = () => [];
export function setReconFactSource(fn: (db: DB, s: FactScope) => Fact[]) { reconFacts = fn; }

export function metricList(caller: Caller) {
  return METRICS.filter((m) => !m.hidden).map((m) => ({ ...m, evaluator: EVAL[m.id]?.t ?? null, allowed: !m.permission || caller.perms(m.permission) }));
}
export { weekOf };
