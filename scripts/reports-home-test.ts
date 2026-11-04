// ux-17 headless test: Home's numbers are the certified reports' numbers (same business day and scope, per role, through
// the API), permission-limited roles see only what they may, delivery_fee_net from the delivery data, the catalog groups,
// and the real-text PDF (extractable Arabic in logical order with joined glyphs; money equal to the report).
// Run: npx esbuild scripts/reports-home-test.ts --bundle --platform=node --format=esm --outfile=$S/rht.mjs --loader:.json=json && node $S/rht.mjs
// Needs pdftotext (poppler-utils). PDF_OUT=<dir> keeps the PDFs it writes.
(globalThis as any).window = globalThis;
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { execFileSync } = await import('node:child_process');
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { clock, businessDate } = await import('../src/mock/clock');
const R = await import('../src/reports');
const { D, m4 } = await import('../src/mock/money');
const { tripRiderCost } = await import('../src/reports/facts');
const { REPORT_GROUPS, reportGroup, seedTemplates } = await import('../src/reports/studio');
const { docFromCertified, docFromPivot, paginate, receiptColumns } = await import('../src/reports/print/layout');
const { renderPdf } = await import('../src/reports/print/pdf');
const { visualOrder } = await import('../src/reports/print/bidi');
const { jsPDF } = await import('jspdf');
const AT: any = await import('jspdf-autotable');
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
const y1 = add(today, -1);
const login = async (username: string, terminalId = 't_admin') => { const A: any = { deviceId: `T-${username}-${terminalId}`, label: username, terminalId, branchId: null, token: null }; A.token = (await call<any>(A, 'Auth.Login', { body: { method: 'PIN', username, secret: demo.pin } })).data.token; return A; };
const api = async (A: any, op: string, o: any = {}) => (await call<any>(A, op, o)).data;
const v = (x: any) => (x && x.availability === 'AVAILABLE' ? x.value : x ? `(${x.availability})` : null);

console.log(`\n=== Sales today through the API (business day ${today})`);
{
  const c = await login('demo-cashier-a', 't_cash');
  if (!db.sessions.some((s: any) => s.terminalId === 't_cash' && s.state === 'OPEN')) await api(c, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } });
  const ord = (id: string) => db.orders.find((o: any) => o.id === id);
  for (const [lines, method] of [[[{ productId: 'p_kofta', quantity: '2', modifierOptionIds: ['opt_medium'] }, { productId: 'p_espresso', quantity: '1' }], 'CASH'], [[{ productId: 'p_mixed_grill', quantity: '1', modifierOptionIds: ['opt_medium'] }], 'CARD'], [[{ productId: 'p_espresso', quantity: '3' }], 'CASH']] as const) {
    const o = await api(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } });
    await api(c, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: ord(o.id).version, lines } });
    await api(c, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: ord(o.id).version } });
    const st = await api(c, 'Payment.GetSettlement', { params: { orderId: o.id } });
    await api(c, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method, amount: st.remaining }] } });
    await api(c, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: ord(o.id).version } });
  }
  const open = await api(c, 'Order.Create', { body: { channel: 'TAKEAWAY' } }); // one confirmed, unpaid check
  await api(c, 'Order.AddLines', { params: { orderId: open.id }, body: { expectedVersion: ord(open.id).version, lines: [{ productId: 'p_espresso', quantity: '1' }] } });
  await api(c, 'Order.Confirm', { params: { orderId: open.id }, body: { expectedVersion: ord(open.id).version } });
  const done = db.orders.filter((o: any) => o.status === 'COMPLETED' && (o.completedBusinessDate ?? o.businessDate) === today).length;
  ok(done >= 3, `three paid checks today (cash, card, cash) and one confirmed unpaid`, `${done} completed`);
}

console.log('\n=== Home = the certified reports, per role (same business day and scope, through the API)');
const homeEqualsReports = async (who: string, A: any, branchIds?: string) => {
  const h = await api(A, 'Report.Home', { query: branchIds ? { branchIds } : {} });
  const bd = h.businessDate;
  ok(bd === businessDate(nowMs, db.branches.find((b: any) => b.id === h.branchIds[0])?.timezone, db.branches.find((b: any) => b.id === h.branchIds[0])?.businessDayCutoff), `${who}: Home's business day is resolved on the server (${bd}, ${h.branchIds.join(',')})`);
  const runs = new Map<string, any>();
  const run = async (s: any) => { const k = `${s.reportId}|${s.from}|${s.to}`; if (!runs.has(k)) runs.set(k, await api(A, 'Report.Run', { params: { reportId: s.reportId }, query: { fromBusinessDate: s.from, toBusinessDate: s.to, branchIds: h.branchIds.join(',') } })); return runs.get(k); };
  const bad: string[] = [];
  for (const card of Object.values<any>(h.cards)) {
    const r = await run(card.source);
    const b = r.blocks.find((x: any) => x.id === card.source.block);
    const want = b.result ? b.result.totals[card.source.metric] : { value: b.bridge.sales.find((x: any) => x.metric === card.source.metric && !x.filter)?.amount, availability: 'AVAILABLE' };
    if (v(want) !== v(card.value) || r.period.from !== bd || JSON.stringify(r.branchIds) !== JSON.stringify(h.branchIds)) bad.push(`${card.id}: home ${v(card.value)} report ${v(want)}`);
  }
  ok(Object.keys(h.cards).length === R.HOME_CARDS.length && !bad.length, `${who}: every Home card (${Object.keys(h.cards).length}) equals its report block for the same day and branch`, bad.join('; ') || `net ${v(h.cards.net_sales.value)}, checks ${v(h.cards.checks.value)}, avg ${v(h.cards.avg_check.value)}, open ${v(h.cards.open_checks.value)} / ${v(h.cards.open_amount.value)}, collected ${v(h.cards.collected.value)}`);
  const tsr = await run(h.paymentMix.source); const byM = tsr.blocks.find((x: any) => x.id === 'by_method').result;
  ok(JSON.stringify(h.paymentMix.rows.map((x: any) => [x.method, x.value])) === JSON.stringify(byM.rows.map((x: any) => [x.dims.payment_method, v(x.values.tender_collected)])) && h.paymentMix.total === v(byM.totals.tender_collected) && h.paymentMix.total === v(h.cards.collected.value), `${who}: payment mix = «طرق الدفع والتسوية» by method (${h.paymentMix.rows.map((x: any) => `${x.method} ${x.value}`).join(', ')}), total = collected`);
  const tir = await run(h.topItems.source); const top = tir.blocks.find((x: any) => x.id === 'top').result;
  ok(JSON.stringify(h.topItems.rows.map((x: any) => [x.product, x.net, x.qty])) === JSON.stringify(top.rows.slice(0, 5).map((x: any) => [x.dims.product, v(x.values.item_net_sales), v(x.values.sold_quantity)])), `${who}: top items = «أعلى وأقل الأصناف» for the day (${h.topItems.rows.length})`);
  const hr = await run(h.hourly.source); const byH = hr.blocks.find((x: any) => x.id === 'by_hour').result;
  const sumRows = byH.rows.reduce((a: any, x: any) => a.plus(D(v(x.values.item_net_sales) ?? 0)), D(0));
  ok(D(h.hourly.today.at(-1)).equals(sumRows) && D(h.compare.netSoFar.today).equals(sumRows) && D(h.compare.netSoFar.today).equals(D(v(byH.totals.item_net_sales))), `${who}: «so far» today = the hourly report's total (${m4(sumRows)}) = the chart's last point`);
  const dr = await run(h.days.source); const byD = dr.blocks.find((x: any) => x.id === 'by_day').result;
  ok(h.days.rows.length === 14 && h.days.rows.every((x: any) => (v(byD.rows.find((y: any) => y.dims.business_date === x.date)?.values.net_item_sales) ?? '0.0000') === x.value) && h.days.rows.at(-1).value === v(h.cards.net_sales.value), `${who}: the 14 days = «المبيعات حسب الساعة والفترة» by day, and today's bar = today's net sales`);
  return h;
};
const owner = await login('demo-owner');
const hOwner = await homeEqualsReports('owner', owner);
ok(D(v(hOwner.cards.net_sales.value)).gt(0) && hOwner.paymentMix.rows.length >= 2 && hOwner.topItems.rows.length >= 2 && Number(v(hOwner.cards.open_checks.value)) >= 1, 'the day has sales, two payment methods, items and an open check (not an empty comparison)');
const acc = await login('demo-accountant');
const hAcc = await homeEqualsReports('accountant', acc);
ok(JSON.stringify(hAcc.cards) === JSON.stringify(hOwner.cards), 'owner and accountant see the same figures for the same day and branch');
const cash = await login('demo-cashier-a', 't_cash');
await homeEqualsReports('cashier', cash);
const area = await login('demo-area-manager');
await homeEqualsReports('area manager', area);
const hSecond = await homeEqualsReports('owner, second branch', owner, 'branch_second');
ok(hSecond.branchIds[0] === 'branch_second' && v(hSecond.cards.net_sales.value) !== v(hOwner.cards.net_sales.value), `the second branch has its own figures (${v(hSecond.cards.net_sales.value)} vs ${v(hOwner.cards.net_sales.value)})`);
try { await api(cash, 'Report.Home', { query: { branchIds: 'branch_second' } }); ok(false, 'cashier other branch'); } catch (e: any) { ok(e instanceof ApiFailure && e.code === 'REPORT_SCOPE_DENIED', 'a cashier cannot read another branch on Home (REPORT_SCOPE_DENIED, server-side)', e.code); }
const waiter = await login('demo-waiter-1', 't_floor');
try { await api(waiter, 'Report.Home'); ok(false, 'waiter'); } catch (e: any) { ok(e.code === 'PERMISSION_DENIED', 'a waiter (no report:run) gets no sales figures at all', e.code); }
{
  const none: any = { userId: 'u_x', perms: (p: string) => p === 'report:run' && false, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' };
  const h = R.homeSummary(db, none, { businessDate: today });
  ok(h.refused.length === 4 && !Object.keys(h.cards).length && !h.hourly && !h.paymentMix && !h.topItems, 'a caller who may run none of the reports gets no cards (refused, never zeros)', h.refused.join(','));
  const partial: any = { userId: 'u_owner', perms: (p: string) => p !== 'session:zreport', accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' };
  const lp = R.MANIFESTS.filter((m: any) => partial.perms(m.permission)).map((m: any) => m.id);
  ok(!lp.includes('staff_sales') && !lp.includes('delivery_riders') && Object.keys(R.homeSummary(db, partial, { businessDate: today }).cards).length === R.HOME_CARDS.length, 'without the manager permission the staff and delivery reports are hidden, Home keeps its report:run cards');
  const list = (await api(area, 'Report.List')).items.map((x: any) => x.id);
  ok(!list.includes('staff_sales') && !list.includes('delivery_riders') && list.includes('eod_bridge'), 'the area manager (no session:zreport) is not offered the staff or delivery reports');
}

console.log('\n=== delivery_fee_net from the delivery data');
{
  const s = { from: add(today, -7), to: today };
  const q = (extra: any = {}) => R.query(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main', 'branch_second'], nowMs, defaultBranchId: 'branch_main' } as any, { metrics: ['delivery_fee_net', 'delivered_count'], ...s, ...extra });
  const delivered = db.deliveries.filter((d: any) => d.deliveredAt && d.branchId === 'branch_main' && businessDate(d.createdAtMs) >= s.from && businessDate(d.createdAtMs) <= s.to);
  const expect = delivered.reduce((a: any, d: any) => a.plus(D(d.fee)).minus(15), D(0)); // default DriverPayPolicy: 15.00 per delivered trip
  const r0 = q();
  ok(r0.totals.delivery_fee_net.availability === 'AVAILABLE' && D(r0.totals.delivery_fee_net.value).equals(expect) && delivered.length > 0, `Σ(fee − 15.00 per delivered trip) over ${delivered.length} trips = ${m4(expect)}`, v(r0.totals.delivery_fee_net));
  const byDrv = q({ dimensions: ['driver'] });
  ok(byDrv.rows.reduce((a: any, x: any) => a.plus(D(x.values.delivery_fee_net.value)), D(0)).equals(D(byDrv.totals.delivery_fee_net.value)), `per rider rows add up to the total (${byDrv.rows.length} riders)`);
  const ex = R.explain(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' } as any, { metric: 'delivery_fee_net', ...s });
  ok(ex.proof.holds === true && ex.parts[0].evidence.length === delivered.length, `evidence: ${ex.parts[0].evidence.length} trips, ${ex.proof.equation}`);
  db.policyValues.push({ policyId: 'DriverPayPolicy', scopeType: 'BRANCH', scopeId: 'branch_main', value: { mode: 'PERCENT_OF_FEE', feePercent: '30', perTripAmount: '15.0000', shiftAmount: '150.0000', payoutDrawer: 'OWN_DRAWER' } });
  const pct = delivered.reduce((a: any, d: any) => a.plus(D(d.fee)).minus(D(m4(D(d.fee).times(30).dividedBy(100)))), D(0));
  ok(D(q().totals.delivery_fee_net.value).equals(pct), `percent of fee (30%): ${m4(pct)}`);
  // a paid trip keeps the payout's own rule (immutable), whatever the rule in force now
  const trip = delivered[0];
  db.driverPayouts.push({ id: 'po_test', number: 'P-T', driverId: trip.driverId, branchId: trip.branchId, periodFrom: '', periodTo: '', mode: 'PER_TRIP', rate: '20.0000', tripIds: [trip.id], shiftIds: [], gross: '20.0000', deductions: '0.0000', deductionIds: [], net: '20.0000', sessionId: null, terminalId: null, at: new Date(nowMs).toISOString(), by: 'u_owner', approvalGrantId: null, note: null });
  const cost = tripRiderCost(db, trip);
  ok('cost' in cost && cost.cost === '20.0000' && D(q().totals.delivery_fee_net.value).equals(pct.plus(D(m4(D(trip.fee).times(30).dividedBy(100)))).minus(20)), 'a trip already paid out uses the payout rule (20.00 per trip), the others the rule in force');
  db.driverPayouts.pop();
  db.policyValues.at(-1).value.mode = 'FIXED_SHIFT';
  const na = q().totals.delivery_fee_net;
  ok(na.availability === 'NOT_AVAILABLE' && na.value === null && /بالوردية/.test(na.reason.ar) && /per shift/.test(na.reason.en), 'riders paid per shift: not available with the reason (never 0)', na.reason.ar);
  db.policyValues.pop();
  db.externalOrders.push({ id: 'ext_t', branchId: 'branch_main', source: 'APP_1', externalRef: 'T', state: 'ACCEPTED' });
  trip.externalOrderId = 'ext_t';
  const app = q().totals.delivery_fee_net;
  ok(app.availability === 'NOT_AVAILABLE' && /تطبيق توصيل/.test(app.reason.ar), 'an order from a delivery app (commission not recorded): not available, says why', app.reason.ar);
  delete trip.externalOrderId; db.externalOrders.pop();
  const run = R.runManifest(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' } as any, 'delivery_riders', s);
  const k = run.blocks.find((b: any) => b.id === 'kpis').result.totals;
  ok(v(k.delivery_fee_net) === v(r0.totals.delivery_fee_net) && run.blocks.every((b: any) => !b.result?.meta.refused.length), `«الدليفري والطيارون»: fee net ${v(k.delivery_fee_net)}, delivered ${v(k.delivered_count)}, avg ${v(k.delivery_avg_minutes)} min`);
  const ch = R.runManifest(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' } as any, 'channel_economics', s);
  ok(ch.blocks.find((b: any) => b.id === 'economics').result.totals.delivery_fee_net.availability === 'AVAILABLE' && ch.blocks.find((b: any) => b.id === 'economics').result.totals.aggregator_commission.availability === 'NOT_AVAILABLE', 'channel economics: delivery fee net now available; aggregator commission stays not available');
}

console.log('\n=== Catalog groups');
{
  const all = R.MANIFESTS.map((m: any) => [m.id, reportGroup(m.family, m.id)]);
  const groups = new Set(all.map((x: any) => x[1]));
  ok(all.every((x: any) => x[1] !== 'other') && ['sales', 'payments', 'fiscal', 'menu', 'kitchen', 'staff', 'delivery', 'inventory', 'controls'].every((g) => groups.has(g)), `${R.MANIFESTS.length} certified reports in ${groups.size} accountant groups, none in «أخرى»`, all.map((x: any) => `${x[0]}→${x[1]}`).join(' '));
  ok(Object.keys(REPORT_GROUPS).length === 11 && reportGroup('purchasing') === 'inventory' && reportGroup('channels') === 'sales' && reportGroup('service') === 'controls' && reportGroup('nonsense') === 'other', 'saved reports\' old categories map into the groups (purchasing → inventory & purchasing …)');
  const ids = ['eod_bridge', 'split_checks', 'drawer_xz', 'tender_settlement', 'discounts_comps', 'removals_by_stage', 'refunds_ledger', 'top_items', 'hourly_daypart', 'channel_economics', 'staff_meals', 'stock_waste', 'purchasing', 'vat_ereceipt', 'kitchen_times', 'branch_comparison', 'cash_rounding', 'void_review_queue', 'menu_matrix'];
  ok(ids.every((id) => R.manifestById.has(id)), 'every existing report id is kept');
}

console.log('\n=== Real-text PDF (jsPDF + autotable + embedded IBM Plex Sans Arabic)');
{
  const out = process.env.PDF_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'ux17-pdf-'));
  fs.mkdirSync(out, { recursive: true });
  const kit = { jsPDF, autoTable: AT.autoTable ?? AT.default, fonts: { regular: fs.readFileSync('src/assets/fonts/IBMPlexSansArabic-Regular.ttf').toString('base64'), bold: fs.readFileSync('src/assets/fonts/IBMPlexSansArabic-Bold.ttf').toString('base64') } };
  const bidiMarks = /[‎‏‪-‮⁦-⁩]/g;
  const extract = (file: string, page?: number) => execFileSync('pdftotext', [...(page ? ['-f', String(page), '-l', String(page)] : []), '-layout', file, '-'], { encoding: 'utf8' });
  const norm = (s: string) => s.normalize('NFKC').replace(bidiMarks, '');
  const flat = (s: string) => norm(s).replace(/\s+/g, '');
  const templates = seedTemplates(new Date(nowMs).toISOString());
  const tplA4 = templates.find((x: any) => x.id === 'tpl_accountant_a4')!;
  const venue = { name: 'مطعم الحاج سامي للمشويات', branches: 'الفرع الرئيسي', logo: null, headerLines: [], footerLines: [], taxNumber: null };
  // the certified daily report for yesterday (a full day), as the accountant's A4 (header, params, KPIs, bridge, tables, signatures)
  const run = R.runManifest(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' } as any, 'eod_bridge', { from: y1 });
  const kb = run.blocks.find((b: any) => b.kind === 'kpis');
  const kpis = kb.metrics.slice(0, 6).map((m: string) => { const meta = run.header.metrics.find((x: any) => x.id === m); return { metric: m, label: meta?.label, unit: meta?.unit, value: kb.result.totals[m] }; });
  const doc = docFromCertified({ ...run, kpis }, { lang: 'ar', venue, generatedBy: 'الحاج سامي', generatedAt: new Date(nowMs).toISOString(), sandbox: true });
  const pages = paginate(doc, tplA4);
  const file = path.join(out, 'eod_bridge-ar.pdf');
  fs.writeFileSync(file, Buffer.from(renderPdf(kit, doc, tplA4, pages)));
  const raw = extract(file);
  const txt = norm(raw);
  ok(fs.statSync(file).size > 10_000 && raw.length > 500, `the PDF has a text layer (${pages.length} pages, ${raw.length} characters extracted)`);
  const title = 'مبيعات اليوم وجسر نهاية اليوم';
  ok(txt.includes(title), 'the Arabic title comes out in logical order (as typed)', title);
  ok(/[ﹰ-﻿]/.test(raw) && (raw.match(/[ﹰ-﻿]/g) || []).length > 200 && !/[ء-ي]{3}/.test(raw.replace(bidiMarks, '')), 'Arabic is drawn with joined (contextual) glyph forms, not isolated letters', `${(raw.match(/[ﹰ-﻿]/g) || []).length} shaped glyphs`);
  const money = (x: string) => Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const net = v(kb.result.totals.net_item_sales), col = v(kb.result.totals.tender_collected);
  ok(txt.includes(money(net)) && txt.includes(money(col)) && flat(raw).includes(flat(`${money(net)} ج.م`)), `money equals the report (net ${money(net)}, collected ${money(col)}), with «ج.م» after the number`);
  const bridgeAmounts = run.blocks.find((b: any) => b.kind === 'bridge').bridge.sales.map((x: any) => money(x.amount));
  ok(bridgeAmounts.every((a: string) => txt.includes(a)), `every money-bridge line is printed (${bridgeAmounts.join(' · ')})`);
  ok(flat(raw).includes(flat(`صفحة 1 من ${pages.length}`)) && txt.includes('الفرع الرئيسي') && txt.includes('اليوم التجاري'), 'footer: page n of N, business day and branch on every page');
  const perPage = Array.from({ length: pages.length }, (_, i) => norm(extract(file, i + 1)));
  ok(perPage.every((p) => p.includes('صفحة') && p.includes('الفرع الرئيسي') && p.includes('اليوم التجاري')), 'every page carries the footer (page number, branch, business day)');
  ok(visualOrder('4 نوفمبر 2026، 23:22', 'rtl') === '23:22 ،2026 ربمفون 4' && visualOrder('صافي المبيعات (تكملة)', 'rtl') === '(ةلمكت) تاعيبملا يفاص' && visualOrder('نسبة الضريبة 14%', 'rtl') === '14% ةبيرضلا ةبسن' && visualOrder('1,234.50 ج.م', 'rtl') === 'م.ج 1,234.50', 'bidi: a leading day number, brackets, percent and money keep their place in a right-to-left line');
  // a long custom report: several A4 pages, the table head on every page, carried-forward subtotals
  const big = R.pivot(db, { userId: 'u_owner', perms: () => true, accessibleBranchIds: ['branch_main'], nowMs, defaultBranchId: 'branch_main' } as any, { metrics: ['item_net_sales', 'sold_quantity'], rows: ['business_date', 'check'], from: add(today, -2), to: y1, branchIds: ['branch_main'] } as any);
  const bdoc = docFromPivot(big, { title: 'مبيعات الشيكات', lang: 'ar', depth: 0, venue, generatedBy: 'نادر', generatedAt: new Date(nowMs).toISOString() });
  const bpages = paginate(bdoc, tplA4);
  const bfile = path.join(out, 'checks-ar.pdf');
  fs.writeFileSync(bfile, Buffer.from(renderPdf(kit, bdoc, tplA4, bpages)));
  const head = bdoc.tables[0].columns[0].label;
  // a head label may wrap to two lines: every word of it on every page
  const heads = Array.from({ length: bpages.length }, (_, i) => { const p = norm(extract(bfile, i + 1)); return head.split(' ').every((w: string) => p.includes(w.replace(/[()]/g, ''))) ? 1 : 0; });
  ok(bpages.length > 2 && heads.every((n) => n >= 1), `${bpages.length} pages, the table head «${head}» repeated on every page`, heads.join(','));
  const segs = bpages.flatMap((p: any) => p.items.filter((i: any) => i.t === 'table'));
  const carry = segs[0].carryOut?.find((x: string) => x);
  ok(!!carry && norm(extract(bfile, 2)).includes(carry.replace(/ ج\.م$/, '')) && norm(extract(bfile, 2)).includes('منقول من الصفحة السابقة'), `page 2 starts with the subtotal carried from page 1 (${carry})`);
  const totalRow = bdoc.tables[0].rows.at(-1)!;
  ok(norm(extract(bfile, bpages.length)).includes(totalRow.cells[0].replace(/ ج\.م$/, '')), `the last page ends with the report's grand total (${totalRow.cells[0]})`);
  // English and the 80 mm roll
  const en = docFromCertified({ ...run, kpis }, { lang: 'en', venue: { ...venue, name: 'Hajj Sami Grill' }, generatedBy: 'Sami', generatedAt: new Date(nowMs).toISOString(), sandbox: true });
  const efile = path.join(out, 'eod_bridge-en.pdf');
  fs.writeFileSync(efile, Buffer.from(renderPdf(kit, en, tplA4, paginate(en, tplA4))));
  const etxt = norm(extract(efile));
  ok(etxt.includes('Daily sales & EOD money bridge') && etxt.includes(`${money(net)} EGP`) && /Page 1 of \d/.test(etxt), 'English PDF: title, «EGP» after the number, page n of N');
  const rtpl = { ...tplA4, paper: 'RECEIPT_80' as const };
  const rdoc = receiptColumns(doc);
  const rfile = path.join(out, 'eod_bridge-receipt.pdf');
  fs.writeFileSync(rfile, Buffer.from(renderPdf(kit, rdoc, rtpl as any, paginate(rdoc, rtpl as any))));
  const rtxt = norm(extract(rfile));
  ok(rtxt.includes(money(net)) && rtxt.includes('مبيعات اليوم'), 'the 80 mm receipt template prints real text too');
  console.log(`  PDFs in ${out}`);
}

console.log(`\nPASSES ${passes}  FAILURES ${failures}`);
process.exit(failures ? 1 : 0);
