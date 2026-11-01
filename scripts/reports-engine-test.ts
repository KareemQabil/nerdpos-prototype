// Headless test of the reports engine against the seeded fixtures (src/mock/seed-reports.ts) and through the API.
// Run: npx esbuild scripts/reports-engine-test.ts --bundle --platform=node --format=esm --outfile=$S/ret.mjs && node $S/ret.mjs
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { clock, businessDate } = await import('../src/mock/clock');
const R = await import('../src/reports');
const { BUILDERS } = await import('../src/reports/facts');
const { EVAL } = await import('../src/reports/engine');
const { ask } = await import('../src/reports/assistant');
const { D } = await import('../src/mock/money');
installMockFetch();
sim.set({ latencyMs: 0 });
demo.reset('DEMO');
sim.set({ latencyMs: 0 });

let failures = 0, passes = 0;
const ok = (cond: unknown, label: string, detail = '') => { if (cond) { passes++; console.log(`✓ ${label}${detail ? '  — ' + detail : ''}`); } else { failures++; console.log(`✗ ${label}${detail ? '  — ' + detail : ''}`); } };
const db = store.db as any;
const nowMs = clock.now();
const today = businessDate(nowMs);
const add = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const y1 = add(today, -1), y2 = add(today, -2);
const owner: any = { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main', 'branch_second'], nowMs, defaultBranchId: 'branch_main' };
const cashier: any = { userId: 'u_cashier_a', perms: (p: string) => ['report:run'].includes(p), accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' };
const v = (r: any, m: string) => r.totals[m]?.value;

console.log(`\n=== Registry & manifests (today ${today}, y1 ${y1}, y2 ${y2}, launch ${R.launchDate(db)})`);
{
  const s = { branchIds: ['branch_main', 'branch_second'], from: y2, to: today, asOfMs: nowMs };
  const dimsOf: Record<string, Set<string>> = {};
  for (const [k, fn] of Object.entries(BUILDERS)) { const fs = (fn as any)(db, s); dimsOf[k] = new Set(fs.flatMap((f: any) => Object.keys(f.dims))); }
  const bad: string[] = [];
  for (const m of R.METRICS) {
    if (m.status === 'AVAILABLE' && !EVAL[m.id]) bad.push(`${m.id}: no evaluator`);
    const fact = m.fact === 'composite' ? null : m.fact;
    if (fact && dimsOf[fact]?.size) for (const d of m.dimensions) if (!dimsOf[fact].has(d)) bad.push(`${m.id}: dimension ${d} not on fact ${fact}`);
    for (const d of m.dimensions) if (!R.dimensionById.has(d)) bad.push(`${m.id}: unknown dimension ${d}`);
  }
  ok(!bad.length, `every registered metric's dimensions are carried by its fact (${R.METRICS.length} metrics, ${R.DIMENSIONS.length} dimensions)`, bad.slice(0, 5).join('; '));
  const mbad = R.MANIFESTS.flatMap((m: any) => m.blocks.flatMap((b: any) => b.metrics.filter((x: string) => !R.metricById.has(x)).map((x: string) => `${m.id}.${b.id}:${x}`)));
  ok(!mbad.length, `${R.MANIFESTS.length} certified manifests use registered metrics only`, mbad.join(', '));
  let refusedBlocks = 0;
  for (const m of R.MANIFESTS) { const run = R.runManifest(db, owner, m.id, { from: m.period === 'DAY' ? y1 : y2, to: y1 }); for (const b of run.blocks as any[]) refusedBlocks += b.result?.meta.refused.length ?? 0; }
  ok(refusedBlocks === 0, 'every manifest block is a legal metric × dimension composition (no refusals when run as owner)', `refused ${refusedBlocks}`);
}

console.log('\n=== Split 100.00 / 3 (FIN-01, BUS-06)');
{
  const visit = db.visits.find((x: any) => x.tableId === 'tbl_4' && db.orders.filter((o: any) => o.visitId === x.id).length === 3);
  const checks = db.orders.filter((o: any) => o.visitId === visit?.id);
  const subtotals = checks.map((o: any) => o.confirmation.itemsSubtotal);
  ok(visit && checks.length === 3, 'the visit has three checks', subtotals.join(' + '));
  ok(subtotals.map(Number).sort().join() === [33.33, 33.33, 33.34].join() && D(subtotals.reduce((a: any, x: string) => a.plus(x), D(0))).equals(100), 'shares are 33.33 + 33.33 + 33.34 = 100.00 (no orphan piaster)');
  const r = R.query(db, owner, { metrics: ['check_count', 'order_count', 'guest_count'], filters: { table_visit: visit.id }, from: y1 });
  ok(v(r, 'check_count') === '3.0000' && v(r, 'order_count') === '1.0000' && v(r, 'guest_count') === '3.0000', 'checks 3, orders 1, guests 3 — split never multiplies orders or guests', `${v(r, 'check_count')} / ${v(r, 'order_count')} / ${v(r, 'guest_count')}`);
  const byHour = R.query(db, owner, { metrics: ['order_count'], dimensions: ['hour'], from: y1 });
  const sumRows = byHour.rows.reduce((a: any, x: any) => a.plus(x.values.order_count.value ?? 0), D(0));
  ok(D(v(byHour, 'order_count')).lte(sumRows), 'order_count total is recomputed (distinct), never the sum of hourly rows', `total ${v(byHour, 'order_count')} vs Σrows ${sumRows}`);
  const br = R.eodBridge(db, owner, { from: y1 });
  ok(br.checks.find((c: any) => c.id === 'split_allocation')?.status === 'MATCHED', 'reconciliation "split_allocation" MATCHED');
}

console.log('\n=== Refund the next day of a closed day (FIN-05) and same day');
{
  const rf = db.refunds.find((x: any) => x.id === 'fx_rf_1');
  const y2frozen = db.businessDays.find((d: any) => d.branchId === 'branch_main' && d.date === y2).summary.netSales;
  const r2 = R.query(db, owner, { metrics: ['item_net_sales', 'net_item_sales', 'return_sales_adjustment'], from: y2 });
  ok(D(v(r2, 'item_net_sales')).equals(y2frozen) && D(v(r2, 'net_item_sales')).equals(y2frozen), `y2 net is unchanged and equals the frozen close (${y2frozen})`);
  const r1 = R.query(db, owner, { metrics: ['item_net_sales', 'return_sales_adjustment', 'net_item_sales', 'tender_refunded'], dimensions: ['stage'], from: y1 });
  const t1 = R.query(db, owner, { metrics: ['item_net_sales', 'return_sales_adjustment', 'net_item_sales', 'tender_refunded'], from: y1 });
  ok(D(v(t1, 'net_item_sales')).equals(D(v(t1, 'item_net_sales')).minus(v(t1, 'return_sales_adjustment'))), 'y1 net = item net − returns paid on y1', `${v(t1, 'item_net_sales')} − ${v(t1, 'return_sales_adjustment')} = ${v(t1, 'net_item_sales')}`);
  ok(r1.rows.find((x: any) => x.dims.stage === 'S3')?.values.tender_refunded.value === rf.amount, `the S3 refund (${rf.amount}) is on its payout day y1`);
  ok(r1.rows.some((x: any) => x.dims.stage === 'S2'), 'the same-day card refund is S2');
  const br = R.eodBridge(db, owner, { from: y2, to: y2 });
  ok(br.checks.filter((c: any) => c.id.startsWith('closed_day_')).every((c: any) => c.status === 'MATCHED'), 'closed-day check: frozen summary = recompute (closed days immutable)');
}

console.log('\n=== Staff meal (QA-05)');
{
  const meal = db.orders.find((o: any) => o.kind === 'STAFF_MEAL' && o.id.startsWith('fx_'));
  const r = R.query(db, owner, { metrics: ['staff_meal_count', 'staff_meal_value', 'staff_meal_cost'], dimensions: ['staff'], from: y1 });
  ok(r.rows.some((x: any) => x.dims.staff === 'u_waiter_2'), 'staff meal by employee (يوسف)', `value ${v(r, 'staff_meal_value')}, cost ${v(r, 'staff_meal_cost') ?? r.totals.staff_meal_cost.availability}`);
  const lines = (BUILDERS.line as any)(db, { branchIds: ['branch_main'], from: y1, to: y1, asOfMs: nowMs });
  const discs = (BUILDERS.discount as any)(db, { branchIds: ['branch_main'], from: y1, to: y1, asOfMs: nowMs });
  ok(!lines.some((f: any) => f.ref.orderId === meal.id) && !discs.some((f: any) => f.ref.orderId === meal.id), 'the staff meal is in neither sales lines nor discounts');
}

console.log('\n=== Void after kitchen + S0 removal + review queue (FIN-06)');
{
  const r = R.query(db, owner, { metrics: ['void_line_count', 'void_value', 'waste_held_pending', 'waste_held_missing'], dimensions: ['stage', 'disposition'], from: y2, to: y1 });
  const s1w = r.rows.find((x: any) => x.dims.stage === 'S1' && x.dims.disposition === 'WASTE_HELD');
  const s0 = r.rows.find((x: any) => x.dims.stage === 'S0');
  ok(!!s1w && Number(s1w.values.void_line_count.value) >= 2, 'voids after the kitchen are S1 / waste held', s1w ? `${s1w.values.void_line_count.value} lines, ${s1w.values.void_value.value}` : '');
  ok(!!s0, 'the unsent removal is S0 (not prepared)');
  ok(v(r, 'waste_held_pending') === '1.0000' && v(r, 'waste_held_missing') === '1.0000', 'review queue: 1 pending, 1 missing (red flag on the approver)');
  const voided = db.orders.flatMap((o: any) => o.lines.filter((l: any) => l.status === 'VOIDED' && l.voided?.dispositionKind === 'WASTE_HELD').map((l: any) => `${o.id}:${l.id}`));
  const lines = (BUILDERS.line as any)(db, { branchIds: ['branch_main'], from: y2, to: y1, asOfMs: nowMs });
  ok(!lines.some((f: any) => voided.includes(f.id)), 'voided lines never count in sales');
}

console.log('\n=== Drawer bridge (FIN-09, doc 27 checks 2–3)');
{
  const br = R.eodBridge(db, owner, { from: y1 });
  const d = br.drawers.find((x: any) => x.sessionId === 'ses_hist_y1');
  const sum = d.lines.reduce((a: any, l: any) => a.plus(l.amount), D(0));
  ok(d && D(sum).equals(d.expected), 'opening + cash in − refunds − pay-outs = expected', `${d.lines.map((l: any) => `${l.label} ${l.amount}`).join(' | ')} = ${d.expected}`);
  ok(d.variance === '-30.0000' && d.checks.find((c: any) => c.id === 'drawer_variance')?.status === 'EXPLAINED', 'counted 30 short, explained by the cashier reason + approval');
  ok(br.drawers.every((x: any) => x.checks.filter((c: any) => c.id !== 'drawer_variance').every((c: any) => c.status === 'MATCHED')), 'every drawer: cash tenders = drawer ledger, Z = Σ entries');
  ok(br.gap.status !== 'UNEXPLAINED', `billed vs collected: difference ${br.gap.difference} explained (${br.gap.explanations.map((e: any) => e.label.en + ' ' + e.amount).join(', ')}), unexplained ${br.gap.unexplained}`);
  ok(br.checks.filter((c: any) => !c.id.startsWith('drawer')).every((c: any) => c.status !== 'UNEXPLAINED'), `all ${br.checks.length} certified checks matched/explained (status ${br.status})`, br.checks.filter((c: any) => c.status === 'UNEXPLAINED').map((c: any) => c.id).join(','));
  // FIN-09 synthetic arithmetic on the same function: opening 100 + cash 50 − refund 20 − pay-out 10 = 120
  const tmp = { cashEntries: [{ sessionId: 'X', kind: 'OPENING_FLOAT', amount: '100', at: new Date(0).toISOString() }, { sessionId: 'X', kind: 'TENDER_IN', amount: '50', at: new Date(0).toISOString() }, { sessionId: 'X', kind: 'REFUND_OUT', amount: '20', at: new Date(0).toISOString() }, { sessionId: 'X', kind: 'PAY_OUT', amount: '10', at: new Date(0).toISOString() }, { sessionId: 'X', kind: 'TENDER_IN', amount: '0', at: new Date(0).toISOString() }] };
  const { drawerParts } = await import('../src/reports/facts');
  ok(drawerParts(tmp as any, 'X').expected.equals(120), 'FIN-09 fixture: 100 + 50 − 20 − 10 = expected 120 (card never enters the drawer)');
}

console.log('\n=== Semi-additive stock');
{
  const a = R.query(db, owner, { metrics: ['stock_on_hand'], from: y1 });
  ok(a.totals.stock_on_hand.availability === 'NOT_DEFINED', 'stock on hand without an ingredient → not defined (kg + litres never added)', a.totals.stock_on_hand.reason?.en);
  const b = R.query(db, owner, { metrics: ['stock_on_hand', 'inventory_value'], dimensions: ['business_date'], from: y2, to: y1 });
  ok(b.meta.refused.length === 2 && b.totals.inventory_value.availability === 'REFUSED', 'stock × business date → refused (never summed over time)', b.meta.refused[0]?.reason.en);
  const c = R.query(db, owner, { metrics: ['inventory_value'], dimensions: ['inventory_item'], from: y1 });
  const sum = c.rows.reduce((x: any, r: any) => x.plus(r.values.inventory_value.value), D(0));
  ok(D(v(c, 'inventory_value')).equals(sum), 'inventory value adds across items at one instant', `${v(c, 'inventory_value')} @ ${c.totals.inventory_value.snapshotAt}`);
  const one = c.rows[0]?.dims.inventory_item;
  const wk = R.query(db, owner, { metrics: ['stock_on_hand'], filters: { inventory_item: one }, from: add(today, -6), to: today });
  const dy = R.query(db, owner, { metrics: ['stock_on_hand'], filters: { inventory_item: one }, from: today });
  ok(wk.totals.stock_on_hand.value === dy.totals.stock_on_hand.value, 'a 7-day period shows the asOf snapshot, not 7 × the balance', `${one}: ${dy.totals.stock_on_hand.value}`);
}

console.log('\n=== Ratios, refusals, not-available, scope');
{
  const all = R.query(db, owner, { metrics: ['avg_check', 'item_net_sales', 'check_count'], from: y1, branchIds: ['branch_main', 'branch_second'] });
  const per = R.query(db, owner, { metrics: ['avg_check'], dimensions: ['branch'], from: y1, branchIds: ['branch_main', 'branch_second'] });
  const naive = per.rows.reduce((a: any, r: any) => a.plus(r.values.avg_check.value), D(0)).dividedBy(per.rows.length);
  ok(D(v(all, 'avg_check')).equals(D(D(v(all, 'item_net_sales')).dividedBy(v(all, 'check_count')).toFixed(4))), 'avg check = Σ net ÷ Σ checks', `${v(all, 'avg_check')} (naive average of branch averages would be ${naive.toFixed(2)})`);
  const x = R.query(db, owner, { metrics: ['net_item_sales'], dimensions: ['payment_method'], from: y1 });
  ok(x.meta.refused[0]?.dimension === 'payment_method', 'net sales × payment method → refused (use the bridge)', x.meta.refused[0]?.reason.en);
  const c = R.query(db, cashier, { metrics: ['cash_variance', 'tender_collected'], from: y1 });
  ok(c.totals.cash_variance.availability === 'REFUSED' && c.totals.tender_collected.availability === 'AVAILABLE', 'a cashier is refused drawer variance (managers only), sees collected');
  const n = R.query(db, owner, { metrics: ['labor_cost', 'aggregator_commission', 'new_customers'], from: y1 });
  ok(['labor_cost', 'aggregator_commission', 'new_customers'].every((m) => n.totals[m].availability === 'NOT_AVAILABLE' && n.totals[m].value === null), 'labor cost / commission / new customers → NOT_AVAILABLE(reason), never 0 (BUS-05, REP-07)');
  const g = R.query(db, owner, { metrics: ['guest_count'], filters: { channel: 'TAKEAWAY' }, from: y1 });
  ok(g.totals.guest_count.availability === 'NOT_AVAILABLE', 'takeaway guests → not available, not 0');
  let denied = '';
  try { R.query(db, cashier, { metrics: ['net_item_sales'], from: y1, branchIds: ['branch_second'] }); } catch (e: any) { denied = e.code; }
  ok(denied === 'REPORT_SCOPE_DENIED', 'a branch outside the caller scope is refused (SEC-01)');
  const pre = R.query(db, owner, { metrics: ['discount_amount', 'net_item_sales'], from: add(today, -20), to: add(today, -15) });
  ok(pre.totals.discount_amount.availability === 'NOT_AVAILABLE' && pre.totals.net_item_sales.availability === 'AVAILABLE', 'pre-launch days: event-only metrics NOT_AVAILABLE, daily aggregates still answer net sales (labelled HISTORY)');
}

console.log('\n=== Business date, asOf, provisional (BUS-01, BUS-03, REP-04)');
{
  const cairo = (d: string, h: number, m: number) => { const g = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h, m); const p = (globalThis as any).Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(g)); const o: any = {}; for (const x of p) o[x.type] = x.value; const shown = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute); return g - (shown - g); };
  ok(businessDate(cairo(y1, 27, 59)) === y1 && businessDate(cairo(y1, 28, 0)) === add(y1, 1), '03:59 Cairo belongs to the previous business date, 04:00 to the next');
  const full = R.query(db, owner, { metrics: ['check_count'], from: y1 });
  const early = R.query(db, owner, { metrics: ['check_count'], from: y1, asOf: new Date(cairo(y1, 18, 0)).toISOString() });
  ok(Number(v(early, 'check_count')) < Number(v(full, 'check_count')) && early.meta.provisional, 'asOf hides later records and flags the snapshot provisional', `${v(early, 'check_count')} at 18:00 vs ${v(full, 'check_count')} now`);
  ok(!full.meta.provisional && full.meta.days[0].status === 'CLOSED', 'a closed day is final');
  const t = R.query(db, owner, { metrics: ['net_item_sales'], from: today });
  ok(t.meta.provisional && t.meta.days[0].status === 'OPEN', 'today is provisional (open day)');
}

console.log('\n=== Evidence, parity, analysis');
{
  const e = R.explain(db, owner, { metric: 'net_item_sales', from: y1 });
  ok(e.proof.holds === true, 'explain(net sales y1): the source records add up to the number', e.proof.equation);
  const p = R.query(db, owner, { metrics: ['item_net_sales'], dimensions: ['product'], from: y1, limit: 1 });
  const ec = R.explain(db, owner, { metric: 'item_net_sales', cell: { product: p.rows[0].dims.product }, from: y1 });
  ok(ec.proof.holds === true && D(ec.value.value).equals(p.rows[0].values.item_net_sales.value), `explain(top item cell) proves ${p.rows[0].labels.product.en} = ${p.rows[0].values.item_net_sales.value} from ${ec.parts[0].evidence.length} lines`);
  const legacy = R.runLegacyReport({ db, now: nowMs, nowIso: new Date(nowMs).toISOString(), businessDate: () => today } as any, 'daily_sales', y1, y1, ['branch_main']) as any;
  const lNet = legacy.sections[0].rows.find((r: any) => r[0] === 'net_sales')[1];
  const eNet = R.query(db, owner, { metrics: ['item_net_sales'], from: y1 });
  ok(D(lNet).equals(v(eNet, 'item_net_sales')), 'parity: legacy daily_sales net = engine item net (REP-01)', `${lNet} = ${v(eNet, 'item_net_sales')}`);
  const tm = R.query(db, owner, { metrics: ['tender_collected'], dimensions: ['payment_method'], from: y1 });
  ok(D(tm.rows.reduce((a: any, r: any) => a.plus(r.values.tender_collected.value), D(0))).equals(v(tm, 'tender_collected')), 'tenders by method add up to total (REP-05)');
  const dc: any = R.decompose(db, owner, { from: y1, baseFrom: y2 });
  ok(dc.available && Math.abs(Number(dc.effects.find((x: any) => x.id === 'unexplained').amount)) < 0.01, 'decompose y1 vs y2: volume + mix + price + new/dropped = Δ, unexplained ≈ 0', dc.available ? dc.effects.map((x: any) => `${x.id} ${Number(x.amount).toFixed(2)}`).join(', ') : '');
  const mm = R.menuMatrix(db, owner, { from: y2, to: y1 });
  ok(mm.items.length > 5 && mm.items.every((i: any) => i.class === 'COST_UNAVAILABLE' ? i.contribution.availability !== 'AVAILABLE' : true), 'menu matrix classes; items without recipe cost are "cost unavailable", never margin 0', Object.entries(mm.items.reduce((a: any, i: any) => ((a[i.class] = (a[i.class] ?? 0) + 1), a), {})).map(([k, n]) => `${k} ${n}`).join(', '));
  const clone = structuredClone(db); clone.inv.recipes = clone.inv.recipes.filter((r: any) => r.outputProductId !== 'p_kunafa');
  const mm2 = R.menuMatrix(clone, owner, { from: y2, to: y1 });
  const k = mm2.items.find((i: any) => i.product === 'p_kunafa');
  ok(k && k.class === 'COST_UNAVAILABLE' && k.contribution.availability === 'NOT_AVAILABLE' && Number(k.qty) > 0, 'QA-04: remove the kunafa recipe → "cost unavailable", popularity still shown, margin never 0', k ? `${k.qty} sold, ${k.contribution.reason?.en}` : 'kunafa not sold');
  const rr = R.query(db, owner, { metrics: ['rounding_adjustment', 'rounding_count'], from: y2, to: y1 });
  ok(Number(v(rr, 'rounding_count')) > 0, 'rounding report: cash payments rounded to 0.25', `${v(rr, 'rounding_count')} payments, net left to guests ${v(rr, 'rounding_adjustment')}`);
}

console.log('\n=== Through the API (handlers, permissions)');
{
  const A = { deviceId: 'ADMIN', label: 'ADMIN', terminalId: 't_admin', branchId: null, token: null as string | null };
  const M = { deviceId: 'ADMIN2', label: 'ADMIN2', terminalId: 't_admin', branchId: null, token: null as string | null };
  A.token = (await call(A, 'Auth.Login', { body: { method: 'PIN', username: 'demo-owner', secret: demo.pin } })).data.token;
  M.token = (await call(M, 'Auth.Login', { body: { method: 'PIN', username: 'demo-cashier-a', secret: demo.pin } })).data.token;
  const list = (await call<any>(A, 'Report.List', {})).data.items;
  ok(list.filter((x: any) => x.certified).length === R.MANIFESTS.length && list.some((x: any) => x.id === 'daily_sales'), `Report.List: ${list.filter((x: any) => x.certified).length} certified + legacy ids kept`);
  const run = (await call<any>(A, 'Report.Run', { params: { reportId: 'eod_bridge' }, query: { fromBusinessDate: y1 } })).data;
  ok(run.header.timezone === 'Africa/Cairo' && run.header.metrics.length > 5 && run.header.reconciliation.status !== 'UNEXPLAINED', `Report.Run eod_bridge header: ${run.header.days[0].status}, asOf, ${run.header.metrics.length} definitions, recon ${run.header.reconciliation.status}`);
  const legacy = (await call<any>(A, 'Report.Run', { params: { reportId: 'daily_sales' }, query: { fromBusinessDate: y1 } })).data;
  ok(legacy.sections?.[0]?.id === 'summary', 'legacy daily_sales keeps its shape (Home)');
  const exp = (await call<any>(A, 'Report.Export', { body: { reportId: 'eod_bridge', fromBusinessDate: y1, format: 'CSV' } })).data;
  ok(exp.sheets.length >= 3 && exp.meta?.metrics?.length > 0, `Report.Export: ${exp.sheets.length} sheets with definitions + versions`);
  const q = (await call<any>(A, 'Report.Query', { query: { q: JSON.stringify({ metrics: ['net_item_sales'], dimensions: ['channel'], from: y1 }) } })).data;
  ok(q.rows.length >= 2, `Report.Query by channel → ${q.rows.length} rows`);
  try { await call(M, 'Report.Query', { query: { q: JSON.stringify({ metrics: ['net_item_sales'], from: y1, branchIds: ['branch_second'] }) } }); ok(false, 'cashier other branch'); } catch (e: any) { ok(e instanceof ApiFailure && e.code === 'REPORT_SCOPE_DENIED', 'API refuses a cashier another branch (server-side)', e.code); }
  const askA = (await call<any>(A, 'Report.Ask', { query: { question: 'أنا بعت بكام النهاردة؟' } })).data;
  const askB = (await call<any>(A, 'Report.Ask', { query: { question: 'أنا بعت بكام امبارح؟', clarify: 'metric=net_item_sales' } })).data;
  const askC = (await call<any>(A, 'Report.Ask', { query: { question: 'ينفع نمسح مبيعات قبل إرسالها للضرائب؟' } })).data;
  ok(askA.status === 'CLARIFY' && askB.status === 'ANSWERED' && askC.status === 'REFUSED', 'Report.Ask: clarifies net vs gross, answers after the choice, refuses erasing sales', askB.text.ar);
  const cat = (await call<any>(A, 'Report.Catalog', {})).data;
  ok(cat.layers.length === 6, `Report.Catalog layers: ${cat.layers.map((l: any) => `${l.id}=${l.items}`).join(' ')}`);
}
void ask;
console.log(`\nPASSES: ${passes}  FAILURES: ${failures}`);
process.exit(0);
