// Reconciliation: the EOD money bridge (gross → discounts → net → service → VAT → billed vs tenders collected/refunded,
// drawer expected vs counted) and the certified checks of doc 27 §5 + research 06 (FIN/REP). Every difference is
// either zero, or explained by linked source events, or reported UNEXPLAINED — never hidden.
import type { DB } from '../mock/types';
import { D, m4 } from '../mock/money';
import type { Fact, ReconCheck, EvidenceRef } from './types';
import { factsOf, drawerParts, inRange, CASH_KIND_AR, TENDER, type FactScope } from './facts';
import { query, explain as _e, scopeBranches, setReconFactSource, datesOf, dayStatus, launchDate, TENDER_LABEL, type Caller } from './engine';
void _e;

const sum = (fs: Fact[], f: string) => fs.reduce((a, x) => a.plus(D(x.n[f] || 0)), D(0));
const L = (ar: string, en: string) => ({ ar, en });
const status = (diff: any, explained: any): ReconCheck['status'] => (D(diff).isZero() ? 'MATCHED' : D(diff).minus(explained).isZero() ? 'EXPLAINED' : 'UNEXPLAINED');

export interface Bridge {
  scope: { from: string; to: string; branchIds: string[]; asOf: string };
  sales: { id: string; label: { ar: string; en: string }; amount: string; sign: 1 | -1 | 0; metric?: string; total?: boolean; note?: { ar: string; en: string } }[];
  money: { id: string; label: { ar: string; en: string }; amount: string; sign: 1 | -1 | 0; metric?: string; filter?: Record<string, string>; total?: boolean }[];
  outside: { id: string; label: { ar: string; en: string }; amount: string; metric?: string; note: { ar: string; en: string } }[];
  gap: { billed: string; collected: string; difference: string; explanations: ReconCheck['explanations']; unexplained: string; status: ReconCheck['status'] };
  drawers: { sessionId: string; label: string; state: string; lines: { kind: string; label: string; amount: string; evidence: EvidenceRef[] }[]; expected: string; counted: string | null; variance: string | null; reason: string | null; approvedBy: string | null; checks: ReconCheck[] }[];
  checks: ReconCheck[];
  status: 'MATCHED' | 'EXPLAINED' | 'UNEXPLAINED' | 'NOT_RUN';
  preLaunch: boolean;
}

export function eodBridge(db: DB, caller: Caller, spec: { from: string; to?: string; branchIds?: string[]; asOf?: string }): Bridge {
  const to = spec.to ?? spec.from;
  const branchIds = scopeBranches(db, caller, spec.branchIds);
  const asOfMs = Math.min(spec.asOf ? Date.parse(spec.asOf) : caller.nowMs, caller.nowMs);
  const s: FactScope = { branchIds, from: spec.from, to, asOfMs };
  const cache = new Map<string, Fact[]>();
  const checks = factsOf(db, 'check', s, cache), lines = factsOf(db, 'line', s, cache), pays = factsOf(db, 'payment', s, cache), refunds = factsOf(db, 'refund', s, cache);
  const comps = factsOf(db, 'comp', s, cache), meals = factsOf(db, 'staff_meal', s, cache), removals = factsOf(db, 'removal', s, cache);
  const q = query(db, caller, { metrics: ['gross_item_sales', 'discount_amount', 'item_net_sales', 'return_sales_adjustment', 'net_item_sales', 'service_charge', 'other_fees', 'table_tax', 'tax_amount', 'recognized_sales_total', 'tender_collected', 'tender_refunded', 'net_tender_movement', 'rounding_adjustment'], from: spec.from, to, branchIds, asOf: new Date(asOfMs).toISOString() });
  const v = (id: string) => q.totals[id]?.value ?? '0.0000';
  const gross = sum(checks, 'gross'), disc = sum(checks, 'discount'), inside = sum(checks, 'inside_tax'), net = sum(checks, 'net');
  const service = sum(checks, 'service'), fees = sum(checks, 'fees'), ttax = sum(checks, 'table_tax'), tax = sum(checks, 'tax'), billed = sum(checks, 'payable');
  const collected = sum(pays, 'amount'), refunded = sum(refunds, 'amount');
  const lineNet = sum(lines, 'net');
  const sales: Bridge['sales'] = [
    { id: 'gross', label: L('المبيعات قبل الخصم', 'Gross item sales'), amount: m4(gross), sign: 1, metric: 'gross_item_sales' },
    { id: 'discount', label: L('− الخصومات', '− Discounts'), amount: m4(disc), sign: -1, metric: 'discount_amount' },
    ...(inside.isZero() ? [] : [{ id: 'inside_tax', label: L('− الضريبة المضمّنة في الأسعار', '− VAT inside prices'), amount: m4(inside), sign: -1 as const, note: L('أسعار شاملة الضريبة: بنطلع الضريبة من جوه السعر', 'Tax-inclusive prices') }]),
    { id: 'item_net', label: L('= صافي مبيعات الأصناف', '= Item net sales'), amount: m4(net), sign: 0, metric: 'item_net_sales', total: true },
    { id: 'service', label: L('+ الخدمة', '+ Service charge'), amount: m4(service), sign: 1, metric: 'service_charge' },
    ...(fees.isZero() ? [] : [{ id: 'fees', label: L('+ رسوم أخرى', '+ Other fees'), amount: m4(fees), sign: 1 as const, metric: 'other_fees' }]),
    ...(ttax.isZero() ? [] : [{ id: 'table_tax', label: L('+ ضريبة الجدول', '+ Table tax'), amount: m4(ttax), sign: 1 as const, metric: 'table_tax' }]),
    { id: 'vat', label: L('+ ضريبة القيمة المضافة', '+ VAT'), amount: m4(tax), sign: 1, metric: 'tax_amount' },
    { id: 'billed', label: L('= إجمالي الفواتير (المطلوب من العملاء)', '= Billed total'), amount: m4(billed), sign: 0, metric: 'recognized_sales_total', total: true },
  ];
  const byMethod = new Map<string, any>();
  for (const p of pays) byMethod.set(p.dims.payment_method!, (byMethod.get(p.dims.payment_method!) ?? D(0)).plus(p.n.amount));
  const refByMethod = new Map<string, any>();
  for (const r of refunds) refByMethod.set(r.dims.payment_method!, (refByMethod.get(r.dims.payment_method!) ?? D(0)).plus(r.n.amount));
  const money: Bridge['money'] = [
    ...[...byMethod].map(([k, a]) => ({ id: `in:${k}`, label: { ar: `${TENDER_LABEL[k]?.ar ?? k} داخل`, en: `${TENDER_LABEL[k]?.en ?? k} in` }, amount: m4(a), sign: 1 as const, metric: 'tender_collected', filter: { payment_method: k } })),
    { id: 'collected', label: L('= المتحصل', '= Collected'), amount: m4(collected), sign: 0, metric: 'tender_collected', total: true },
    ...[...refByMethod].map(([k, a]) => ({ id: `out:${k}`, label: { ar: `− مرتجع ${TENDER_LABEL[k]?.ar ?? k}`, en: `− ${TENDER_LABEL[k]?.en ?? k} refunds` }, amount: m4(a), sign: -1 as const, metric: 'tender_refunded', filter: { payment_method: k } })),
    { id: 'net_collected', label: L('= صافي التحصيل', '= Net collected'), amount: m4(collected.minus(refunded)), sign: 0, metric: 'net_tender_movement', total: true },
  ];
  const outside: Bridge['outside'] = [
    { id: 'returns', label: L('مرتجعات صُرفت في الفترة (صافيها بلا ضريبة)', 'Returns paid in the period (ex-tax)'), amount: v('return_sales_adjustment'), metric: 'return_sales_adjustment', note: L('تُنقص صافي المبيعات في يوم الصرف — ولا يتغير اليوم الأصلي.', 'Reduce net sales on the payout day — the original day is never restated.') },
    { id: 'comps', label: L('ضيافة (ليست مبيعات)', 'Comps (not sales)'), amount: m4(sum(comps, 'amount')), metric: 'comps_value', note: L('بسعر قائمة الطعام، ومطلوبها صفر.', 'At menu price; payable zero.') },
    { id: 'meals', label: L('وجبات موظفين (ليست مبيعات ولا خصمًا)', 'Staff meals (not sales nor discounts)'), amount: m4(sum(meals, 'value')), metric: 'staff_meal_value', note: L('طلبات سعرها صفر وتسحب من المخزون.', 'Zero-price orders that consume stock.') },
    { id: 'removed', label: L('أصناف أُزيلت أو أُلغيت (ليست ضمن المبيعات)', 'Removed/voided items (never in sales)'), amount: m4(sum(removals, 'value')), metric: 'void_value', note: L('كل إلغاء مسجل بمرحلته والموافق عليه.', 'Every removal is recorded with its stage and approver.') },
  ];
  // billed vs collected: explained by rounding, timing (paid on another day) and partial payments on open checks
  const periodChecks = new Set(checks.map((c) => c.id));
  const allCaps = db.captures.filter((c) => c.atMs <= asOfMs);
  const roundingOfP = allCaps.filter((c) => periodChecks.has(c.orderId) && !D(c.rounding ?? 0).isZero());
  const paidOutside = allCaps.filter((c) => periodChecks.has(c.orderId) && !(inRange(c.businessDate, spec.from, to) && branchIds.includes(c.branchId)));
  const otherInP = pays.filter((p) => !periodChecks.has(p.ref.orderId!));
  const ref = (c: typeof allCaps[number], amt: string): EvidenceRef => ({ kind: 'PAYMENT', id: c.id, orderId: c.orderId, label: `#${db.orders.find((o) => o.id === c.orderId)?.number ?? c.orderId} — ${c.method} (يوم ${c.businessDate})`, businessDate: c.businessDate, at: c.at, amount: amt });
  const rSum = roundingOfP.reduce((a, c) => a.plus(c.rounding ?? 0), D(0));
  const outSum = paidOutside.reduce((a, c) => a.plus(c.amount), D(0));
  const otherSum = sum(otherInP, 'amount');
  const explanations: ReconCheck['explanations'] = [];
  if (!rSum.isZero()) explanations.push({ label: L('تقريب النقدي (الكسور المتروكة للعميل)', 'Cash rounding left to guests'), amount: m4(rSum), evidence: roundingOfP.map((c) => ref(c, c.rounding ?? '0')) });
  if (!outSum.isZero()) explanations.push({ label: L('شيكات الفترة دُفعت في يوم آخر', 'Period checks paid on another day'), amount: m4(outSum), evidence: paidOutside.map((c) => ref(c, c.amount)) });
  if (!otherSum.isZero()) explanations.push({ label: L('دفعات في الفترة لشيكات من يوم آخر أو ما زالت مفتوحة', 'Payments in the period for other-day or open checks'), amount: m4(otherSum.negated()), evidence: otherInP.map((p) => ({ ...p.ref, amount: m4(D(p.n.amount).negated()) })) });
  const diff = billed.minus(collected);
  const explained = explanations.reduce((a, e) => a.plus(e.amount), D(0));
  const gap = { billed: m4(billed), collected: m4(collected), difference: m4(diff), explanations, unexplained: m4(diff.minus(explained)), status: status(diff, explained) };

  // drawers
  const sessions = factsOf(db, 'drawer', s, cache);
  const drawers: Bridge['drawers'] = sessions.map((f) => {
    const sess = db.sessions.find((x) => x.id === f.id)!;
    const dp = drawerParts(db, sess.id, asOfMs);
    const kinds = ['OPENING_FLOAT', 'TENDER_IN', 'REFUND_OUT', 'PAY_IN', 'PAY_OUT', 'SAFE_DROP', 'TIP_IN', 'TIP_OUT', 'DEPOSIT_IN', 'TENDER_CORRECTION_IN', 'TENDER_CORRECTION_OUT'];
    const SIGNS: Record<string, number> = { OPENING_FLOAT: 1, TENDER_IN: 1, REFUND_OUT: -1, PAY_IN: 1, PAY_OUT: -1, SAFE_DROP: -1, TIP_IN: 1, TIP_OUT: -1, DEPOSIT_IN: 1, TENDER_CORRECTION_IN: 1, TENDER_CORRECTION_OUT: -1 };
    const dl = kinds.filter((k) => dp.by[k]).map((k) => ({ kind: k, label: `${SIGNS[k] < 0 ? '− ' : '+ '}${CASH_KIND_AR[k]}`, amount: m4(D(dp.by[k]).times(SIGNS[k])), evidence: dp.entries.filter((e) => e.kind === k).map((e) => ({ kind: 'CASH_ENTRY' as const, id: e.id, label: `${CASH_KIND_AR[e.kind]}${e.ref ? ' · #' + e.ref : ''}${e.reason ? ' · ' + e.reason : ''}`, at: e.at, businessDate: sess.businessDate, amount: m4(D(e.amount).times(SIGNS[k])) })) }));
    // doc 27 check 2: cash captures − cash refunds of the session = TENDER_IN − REFUND_OUT (± corrections) entries
    const cashCaps = db.captures.filter((c) => c.sessionId === sess.id && c.method === 'CASH' && c.atMs <= asOfMs).reduce((a, c) => a.plus(c.amount), D(0));
    const cashRef = db.refunds.filter((r) => r.paidSessionId === sess.id && r.method === 'CASH' && r.state === 'PAID').reduce((a, r) => a.plus(r.amount), D(0));
    const ledger = D(dp.by.TENDER_IN ?? 0).minus(dp.by.REFUND_OUT ?? 0).plus(dp.by.TENDER_CORRECTION_IN ?? 0).minus(dp.by.TENDER_CORRECTION_OUT ?? 0);
    const c2d = cashCaps.minus(cashRef).minus(ledger);
    const closed = sess.state === 'CLOSED' && sess.close;
    const c3d = closed ? D(sess.close!.expectedCash).minus(dp.expected) : D(0);
    const term = db.terminals.find((t) => t.id === sess.terminalId);
    const g = db.grants.find((x) => x.id === sess.close?.approvalGrantId);
    return {
      sessionId: sess.id, label: f.ref.label, state: sess.state, lines: dl, expected: m4(dp.expected), counted: closed ? sess.close!.countedCash : null, variance: closed ? sess.close!.variance : null, reason: sess.close?.reason ?? null, approvedBy: g ? (db.users.find((u) => u.id === g.approverUserId)?.displayName ?? null) : null,
      checks: [
        { id: `tender_vs_cash_session:${sess.id}`, title: L(`كاش ${term?.name ?? ''}: التحصيل = حركات الدرج`, `Cash tenders = drawer ledger`), equation: 'cash captures − cash refunds = TENDER_IN − REFUND_OUT ± corrections', expected: m4(cashCaps.minus(cashRef)), actual: m4(ledger), difference: m4(c2d), status: c2d.isZero() ? 'MATCHED' : 'UNEXPLAINED', explanations: [] },
        ...(closed ? [{ id: `session_snapshot_vs_ledger:${sess.id}`, title: L('تقرير Z = مجموع حركات الدرج', 'Z expected = Σ drawer entries'), equation: 'Z.expectedCash = Σ CashEntry', expected: sess.close!.expectedCash, actual: m4(dp.expected), difference: m4(c3d), status: (c3d.isZero() ? 'MATCHED' : 'UNEXPLAINED') as ReconCheck['status'], explanations: [] }] : []),
        ...(closed && !D(sess.close!.variance).isZero() ? [{ id: `drawer_variance:${sess.id}`, title: L('فرق العد', 'Count variance'), equation: 'counted − expected', expected: sess.close!.expectedCash, actual: sess.close!.countedCash, difference: sess.close!.variance, status: (sess.close!.reason || sess.close!.approvalGrantId ? 'EXPLAINED' : 'UNEXPLAINED') as ReconCheck['status'], explanations: [{ label: L(`سبب الكاشير: ${sess.close!.reason ?? '—'}${g ? ' — بموافقة' : ''}`, `Reason: ${sess.close!.reason ?? '—'}`), amount: sess.close!.variance, evidence: [{ kind: 'SESSION' as const, id: sess.id, label: f.ref.label, amount: sess.close!.variance, at: sess.closedAt, businessDate: sess.businessDate }] }] }] : []),
      ],
    };
  });

  // certified checks
  const C: ReconCheck[] = [];
  const mk = (id: string, ar: string, en: string, eq: string, exp: any, act: any, expl: ReconCheck['explanations'] = [], note?: { ar: string; en: string }) => { const d = D(exp).minus(act); const e = expl.reduce((a, x) => a.plus(x.amount), D(0)); C.push({ id, title: L(ar, en), equation: eq, expected: m4(exp), actual: m4(act), difference: m4(d), status: status(d, e), explanations: expl, note }); };
  mk('item_net_vs_check_net', 'صافي الأصناف = صافي الشيكات', 'Σ item net = Σ check net', 'Σ line.net = Σ check.net (largest-remainder allocation)', net, lineNet);
  mk('sales_bridge', 'قبل الخصم − الخصم − الضريبة الداخلة = الصافي', 'gross − discount − inside VAT = net', 'gross − discounts − inclusive VAT = item net', gross.minus(disc).minus(inside), net);
  mk('billed_identity', 'الصافي + الخدمة + الرسوم + الضرائب = الفواتير', 'net + service + fees + taxes = billed', 'item net + service + fees + table tax + VAT = Σ payable', net.plus(service).plus(fees).plus(ttax).plus(tax), billed);
  C.push({ id: 'billed_vs_collected', title: L('الفواتير مقابل المتحصل', 'Billed vs collected'), equation: 'Σ payable − Σ captures = rounding + paid-on-other-day − other-day payments', expected: gap.billed, actual: gap.collected, difference: gap.difference, status: gap.status, explanations, note: L('لا يلزم أن يتساويا: يجب أن يُفسَّر الفرق بحركات.', 'Need not be equal; the difference must be explained by events.') });
  mk('tenders_by_method', 'مجموع طرق الدفع = إجمالي المتحصل', 'Σ by method = collected', 'Σ_m tender(m) = tender_collected (REP-05)', [...byMethod.values()].reduce((a, x) => a.plus(x), D(0)), D(v('tender_collected')));
  mk('engine_parity', 'المحرك = الجسر (نفس الأرقام)', 'Engine = bridge', 'query(item_net_sales) = bridge item net; query(tender_collected) = bridge collected', net.plus(collected), D(v('item_net_sales')).plus(v('tender_collected')));
  // split allocation: shares of one line differ by at most one piaster and carry no fraction of a piaster
  const shares = new Map<string, string[]>();
  for (const o of db.orders.filter((x) => branchIds.includes(x.branchId) && x.status === 'COMPLETED' && inRange(x.completedBusinessDate, spec.from, to))) for (const l of o.lines) if (l.shareOf) (shares.get(l.shareOf.lineId) ?? shares.set(l.shareOf.lineId, []).get(l.shareOf.lineId)!).push(l.lineTotal);
  const badSplit = [...shares.entries()].filter(([, a]) => { const ds = a.map(D); const mx = ds.reduce((x, y) => (y.gt(x) ? y : x)); const mn = ds.reduce((x, y) => (y.lt(x) ? y : x)); return mx.minus(mn).gt('0.01') || ds.some((x) => !x.times(100).isInteger()); });
  C.push({ id: 'split_allocation', title: L(`تقسيم الشيكات: ${shares.size} صنف مقسَّم — لم يضع أي قرش`, `Split shares: ${shares.size} split lines — no orphan piaster`), equation: 'max(share) − min(share) ≤ 0.01 and every share in whole piasters (LARGEST_REMAINDER / LAST_SHARE)', expected: '0', actual: String(badSplit.length), difference: m4(badSplit.length), status: badSplit.length ? 'UNEXPLAINED' : 'MATCHED', explanations: [] });
  // refunds: an original check, a reason, never more than paid
  const badRef = refunds.filter((r) => { const o = db.orders.find((x) => x.id === r.ref.orderId); if (!o || !r.dims.void_reason) return true; const paid = db.captures.filter((c) => c.orderId === o.id).reduce((a, c) => a.plus(c.amount), D(0)); const allRef = db.refunds.filter((x) => x.orderId === o.id && x.state === 'PAID').reduce((a, x) => a.plus(x.amount), D(0)); return allRef.gt(paid); });
  C.push({ id: 'refunds_have_origin', title: L('لكل مرتجع شيك أصلي وسبب، ولا يتجاوز المدفوع', 'Every refund has an original check, a reason, ≤ paid'), equation: 'refund.orderId ∧ reasonCode ∧ Σ refunds(order) ≤ Σ captures(order)', expected: '0', actual: String(badRef.length), difference: m4(badRef.length), status: badRef.length ? 'UNEXPLAINED' : 'MATCHED', explanations: badRef.map((r) => ({ label: L('مرتجع غير سليم', 'Bad refund'), amount: '1', evidence: [r.ref] })) });
  // duplicate payments (same command id twice) — offline replay must never double count
  const cmd = new Map<string, number>();
  for (const p of pays) { const c = db.captures.find((x) => x.id === p.id); if (c?.commandId) cmd.set(c.commandId + ':' + c.method, (cmd.get(c.commandId + ':' + c.method) ?? 0) + 1); }
  const dups = [...cmd.values()].filter((n) => n > 1).length;
  C.push({ id: 'no_duplicate_payments', title: L('لم تُسجَّل أي دفعة مرتين', 'No payment recorded twice'), equation: 'COUNT(captures per commandId × method) = 1', expected: '0', actual: String(dups), difference: m4(dups), status: dups ? 'UNEXPLAINED' : 'MATCHED', explanations: [] });
  // closed days are immutable: the frozen close summary equals a recompute of that day
  for (const d of datesOf(spec.from, to)) for (const b of branchIds) {
    const rec = (db.businessDays ?? []).find((x) => x.branchId === b && x.date === d);
    if (!rec) continue;
    const r = query(db, caller, { metrics: ['item_net_sales', 'tender_collected'], from: d, branchIds: [b], asOf: new Date(asOfMs).toISOString() });
    const live = D(r.totals.item_net_sales.value ?? 0);
    mk(`closed_day_${b}_${d}`, `يوم ${d} مقفول: الرقم المتجمد = إعادة الحساب`, `Closed ${d}: frozen = recompute`, 'BusinessDay.summary.netSales = item_net_sales(recompute at asOf); later refunds post on their payout day', D(rec.summary.netSales), live, [], L('يُسجَّل أي مرتجع بعد الإغلاق في يوم صرفه — ولا يُعاد تحرير اليوم المغلق.', 'Refunds after close post on their payout day — a closed day is never rewritten.'));
  }
  for (const dr of drawers) C.push(...dr.checks);
  const worst = C.some((c) => c.status === 'UNEXPLAINED') || gap.status === 'UNEXPLAINED' ? 'UNEXPLAINED' : C.some((c) => c.status === 'EXPLAINED') || gap.status === 'EXPLAINED' ? 'EXPLAINED' : 'MATCHED';
  return { scope: { from: spec.from, to, branchIds, asOf: new Date(asOfMs).toISOString() }, sales, money, outside, gap, drawers, checks: C, status: worst, preLaunch: spec.from < launchDate(db) };
}

/** Facts for reconciliation_errors: one fact per (date, branch, rule) with failed = 1 when UNEXPLAINED. */
setReconFactSource((db, s) => {
  const out: Fact[] = [];
  const caller: Caller = { userId: null, perms: () => true, accessibleBranchIds: s.branchIds, nowMs: s.asOfMs, defaultBranchId: null };
  for (const d of datesOf(s.from, s.to)) {
    if (d < launchDate(db) || dayStatus(db, s.branchIds, d, s.asOfMs) === 'FUTURE') continue;
    for (const b of s.branchIds) {
      const br = eodBridge(db, caller, { from: d, branchIds: [b], asOf: new Date(s.asOfMs).toISOString() });
      for (const c of br.checks) out.push({ kind: 'recon', id: `${b}:${d}:${c.id}`, branchId: b, businessDate: d, recordedMs: s.asOfMs, dims: { business_date: d, business_week: d, weekday: String(new Date(d + 'T12:00:00Z').getUTCDay()), branch: b }, n: { failed: c.status === 'UNEXPLAINED' ? '1' : '0', one: '1' }, ref: { kind: 'RECON', id: `${b}:${d}:${c.id}`, label: `${c.title.ar} — ${c.status === 'MATCHED' ? 'متطابق' : c.status === 'EXPLAINED' ? 'الفرق متشرح' : 'فرق غير مفسَّر'}`, businessDate: d, amount: c.status === 'UNEXPLAINED' ? '1' : '0' } });
    }
  }
  return out;
});
export { TENDER };
