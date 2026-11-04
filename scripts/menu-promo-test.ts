// ux-15 headless check of menu management and promotions (PROPOSED Order.PromotionOptions / Product.Usage /
// Product.Retire / Product.Reinstate / Product.Delete and the promotion model extensions, PROTOTYPE_GAPS §15l), against
// the mock through fetch like smoke.ts: the new settings and who may do what (authorization before every read and write);
// versioned prices that never re-price a past sale; retire instead of delete when a product has sales, delete only an
// unsold, unused product and only when the restaurant allows it; availability; every promotion type (whole check
// percent / amount, items, buy-X-get-Y, bundle price, happy hour, code, customer and loyalty tier); scheduling (dates,
// daily windows incl. over midnight, weekdays, branch, channel); stacking, priority and the stacked base; limits (total,
// per day, per customer, per check, promotions per check); rounding; code redemption; idempotency; removal with a reason
// that keeps history; manager discount approval; promotion revisions; the settings' validation.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { clock, zonedParts } = await import('../src/mock/clock');
const { promotionLive } = await import('../src/mock/promo-engine');
installMockFetch();
demo.reset('DEMO');
sim.set({ latencyMs: 0, printers: {} });
const PIN = demo.pin;
let passes = 0, failures = 0;
const ok = (cond: any, text: string) => { if (cond) { passes++; console.log('  ✓', text); } else { failures++; console.log('  ✗ FAIL', text); } };
const dev = (deviceId: string, terminalId: string | null) => ({ deviceId, label: deviceId, terminalId, branchId: terminalId ? null : 'branch_main', token: null as string | null });
const CASH = dev('T1', 't_cash'), MGR = dev('M1', 't_admin'), MGRC = dev('M2', 't_cash'), OWN = dev('O1', 't_admin'), WAIT = dev('W1', 't_floor');
async function login(d: any, username: string) { const r = await call(d, 'Auth.Login', { body: { method: 'PIN', username, secret: PIN } }); d.token = r.data.token; }
async function code(p: Promise<any>): Promise<string> { try { await p; return 'OK'; } catch (e: any) { if (!(e instanceof ApiFailure)) throw e; return e.code; } }
async function fail(p: Promise<any>): Promise<{ code: string; details: any }> { try { await p; return { code: 'OK', details: null }; } catch (e: any) { if (!(e instanceof ApiFailure)) throw e; return { code: e.code, details: (e as any).details ?? (e as any).body?.error?.details ?? null }; } }
const pv = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
const ord = (id: string) => store.db.orders.find((o) => o.id === id)!;
const audit = (re: RegExp) => store.db.audit.find((a) => re.test(a.summary));
async function setPolicy(policyId: string, patch: Record<string, unknown> | string) {
  const body = { scopeType: 'TENANT', scopeId: 'biz', value: typeof patch === 'string' ? patch : { ...(pv(policyId) ?? {}), ...patch } };
  let r: any = null; try { await call(OWN, 'Settings.UpdatePolicy', { params: { policyId }, body }); } catch (e: any) { r = e; }
  if (r?.code !== 'APPROVAL_REQUIRED') return r?.code ?? 'OK';
  const g = (await call(OWN, 'Approval.Grant', { body: { action: r.details.action, targetType: r.details.targetType, targetId: r.details.targetId, context: r.details.context, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
  await call(OWN, 'Settings.UpdatePolicy', { params: { policyId }, body: { ...body, approvalGrantId: g.grantId } });
  return 'OK';
}
async function check(lines0: { productId: string; quantity: string; variantId?: string }[], channel = 'TAKEAWAY', customerId?: string) {
  const lines = lines0.map((l) => (['p_kofta', 'p_mixed_grill'].includes(l.productId) ? { ...l, modifierOptionIds: ['opt_medium'] } : l)); // doneness is required
  if (!store.db.sessions.some((s) => s.terminalId === 't_cash' && s.state === 'OPEN')) await call(CASH, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } });
  const o = (await call(CASH, 'Order.Create', { body: { channel } })).data;
  await call(CASH, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: ord(o.id).version, lines } });
  if (customerId) await call(CASH, 'Order.SetCustomer', { params: { orderId: o.id }, body: { expectedVersion: ord(o.id).version, customerId } });
  return o.id as string;
}
const apply = (orderId: string, discount: any, d: any = CASH, extra: any = {}) => call(d, 'Order.ApplyDiscount', { params: { orderId }, body: { expectedVersion: ord(orderId).version, discount, ...extra } });
const totals = async (orderId: string) => (await call(CASH, 'Order.Get', { params: { orderId } })).data.totals;
const lineAmt = (t: any, discountId: string) => t.discountLines?.find((x: any) => x.discountId === discountId)?.amount;
const activeDisc = (orderId: string) => ord(orderId).discounts.filter((d) => d.active);
let seq = 0;
async function promo(body: Record<string, any>) {
  const id = `promo_t${++seq}`;
  await call(MGR, 'Promotion.Upsert', { params: { promotionId: id }, body: { name: { ar: `عرض ${seq}`, en: `Promo ${seq}` }, kind: 'AUTOMATIC', channels: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'], branchIds: ['branch_main'], stacking: 'EXCLUSIVE', ...body } });
  return id;
}
const promoRec = (id: string) => (store.db.promotions as any[]).find((p) => p.id === id);
async function sell(orderId: string) {
  await call(CASH, 'Order.Confirm', { params: { orderId }, body: { expectedVersion: ord(orderId).version } });
  const pay = ord(orderId).confirmation!.payable;
  await call(CASH, 'Payment.Capture', { params: { orderId }, body: { tenders: [{ method: 'CASH', tendered: pay }] } });
  await call(CASH, 'Order.Complete', { params: { orderId }, body: { expectedVersion: ord(orderId).version } });
}

await login(CASH, 'demo-cashier-a'); await login(MGR, 'demo-manager-1'); await login(MGRC, 'demo-manager-1'); await login(OWN, 'demo-owner'); await login(WAIT, 'demo-waiter-1');

console.log('\n== settings, defaults and permissions');
ok(JSON.stringify(pv('PromotionPolicy')) === JSON.stringify({ maxPromotionsPerCheck: 2, stackBase: 'REMAINDER', manualWithPromotion: 'DENY', rounding: 'DOWN', removeReason: 'REQUIRED' }), `PromotionPolicy ${JSON.stringify(pv('PromotionPolicy'))}`);
ok(pv('ProductRemovalPolicy')?.mode === 'RETIRE_ONLY', 'ProductRemovalPolicy RETIRE_ONLY');
ok(pv('DiscountStackingPolicy')?.mode === 'NO_STACKING' && pv('DiscountStackingPolicy')?.autoApply === false, 'DiscountStackingPolicy NO_STACKING, no auto-apply (unchanged)');
ok(await code(call(CASH, 'Promotion.Upsert', { params: { promotionId: 'promo_x1' }, body: { name: { ar: 'س' }, kind: 'AUTOMATIC', channels: ['DINE_IN'], benefitType: 'PERCENTAGE', benefitValue: '5' } })) === 'PERMISSION_DENIED', 'cashier Promotion.Upsert → PERMISSION_DENIED');
ok(await code(call(CASH, 'Product.Retire', { params: { productId: 'p_espresso' }, body: { reason: 'تجربة الإيقاف', expectedVersion: 1 } })) === 'PERMISSION_DENIED', 'cashier Product.Retire → PERMISSION_DENIED (before any read)');
ok(await code(call(CASH, 'Product.Usage', { params: { productId: 'p_espresso' } })) === 'PERMISSION_DENIED', 'cashier Product.Usage → PERMISSION_DENIED');
ok(await code(call(MGR, 'Product.Delete', { params: { productId: 'p_espresso' }, body: { reason: 'تجربة', expectedVersion: 1 } })) !== 'PERMISSION_DENIED', 'manager reaches Product.Delete (catalog:manage)');
const o0 = await check([{ productId: 'p_espresso', quantity: '1' }]);
ok(await code(call(WAIT, 'Order.PromotionOptions', { params: { orderId: o0 } })) === 'PERMISSION_DENIED', 'waiter Order.PromotionOptions → PERMISSION_DENIED (order:applydiscount)');
ok(await code(call(dev('B2', 't_cash_b2'), 'Order.PromotionOptions', { params: { orderId: o0 } })) !== 'OK', 'an unauthenticated device cannot read the options');

console.log('\n== a product with sizes, versioned prices');
const TAX = store.db.products.find((p) => p.id === 'p_espresso')!.taxPolicyId!;
const created = (await call(MGR, 'Product.Create', { body: { name: { ar: 'قهوة اختبار', en: 'Test coffee' }, categoryId: 'cat_hot', unitId: 'unit_ea', sku: 'T-COF-1', taxPolicyId: TAX } })).data;
const PT = created.id as string;
await call(MGR, 'Variant.Upsert', { params: { productId: PT, variantId: 'v_s' }, body: { name: { ar: 'صغير', en: 'Small' }, priceDelta: '0', isDefault: true } });
await call(MGR, 'Variant.Upsert', { params: { productId: PT, variantId: 'v_l' }, body: { name: { ar: 'كبير', en: 'Large' }, priceDelta: '11.11' } });
for (const ch of ['DINE_IN', 'TAKEAWAY']) await call(MGR, 'Catalog.SetPrice', { params: { productId: PT }, body: { amount: '33.33', currency: 'EGP', branchId: 'branch_main', channel: ch } });
await call(MGR, 'Product.SetAvailability', { params: { productId: PT }, body: { state: 'AVAILABLE', branchId: 'branch_main' } });
const PB = (await call(MGR, 'Product.Create', { body: { name: { ar: 'كعكة اختبار', en: 'Test cake' }, categoryId: 'cat_desserts', unitId: 'unit_ea', sku: 'T-CAKE-1', taxPolicyId: TAX } })).data.id as string;
for (const ch of ['DINE_IN', 'TAKEAWAY']) await call(MGR, 'Catalog.SetPrice', { params: { productId: PB }, body: { amount: '25.00', currency: 'EGP', branchId: 'branch_main', channel: ch } });
await call(MGR, 'Product.SetAvailability', { params: { productId: PB }, body: { state: 'AVAILABLE', branchId: 'branch_main' } });
const oS = await check([{ productId: PT, quantity: '1', variantId: 'v_l' }]);
const lineL = ord(oS).lines[0];
ok(lineL.unitTotal === '44.4400' && lineL.variant?.id === 'v_l', `the large size sells at 33.33 + 11.11 = ${lineL.unitTotal}`);
const future = new Date(clock.now() + 3600_000).toISOString();
await call(MGR, 'Catalog.SetPrice', { params: { productId: PT }, body: { amount: '40.00', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY', effectiveFrom: future } });
const hist = (await call(MGR, 'Product.PriceHistory', { params: { productId: PT }, query: { branchId: 'branch_main', channel: 'TAKEAWAY', variantId: 'BASE' } })).data.items;
ok(hist.some((r: any) => r.state === 'CURRENT' && r.amount === '33.3300') && hist.some((r: any) => r.state === 'SCHEDULED' && r.amount === '40.0000'), 'price history: 33.33 current, 40.00 scheduled for an hour later (effective-from)');
ok(await code(call(MGR, 'Catalog.SetPrice', { params: { productId: PT }, body: { amount: '30.00', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY', effectiveFrom: new Date(clock.now() - 86400_000).toISOString() } })) === 'VALIDATION_FAILED', 'a back-dated price → VALIDATION_FAILED (a started window is never re-priced)');
await sell(oS);
const soldTotal = ord(oS).confirmation!.payable;
clock.advance(3700_000);
const oS2 = await check([{ productId: PT, quantity: '1' }]);
ok(ord(oS2).lines[0].unitTotal === '40.0000', `after the effective time a new check sells at ${ord(oS2).lines[0].unitTotal}`);
ok(ord(oS).lines[0].unitTotal === '44.4400' && ord(oS).confirmation!.payable === soldTotal, 'the completed sale keeps its price and total (history never re-priced)');
await call(MGR, 'Catalog.SetPrice', { params: { productId: PT }, body: { amount: '33.33', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY' } });
await call(CASH, 'Order.Cancel', { params: { orderId: oS2 }, body: { expectedVersion: ord(oS2).version, reasonCode: store.db.reasonCodes.find((r) => r.kind === 'ORDER_CANCEL')?.code ?? 'CUSTOMER_LEFT', reason: 'اختبار' } }).catch(() => {});

console.log('\n== availability');
await call(MGR, 'Product.SetAvailability', { params: { productId: PB }, body: { state: 'SOLD_OUT', branchId: 'branch_main', reason: 'نفدت الكمية', until: 'END_OF_BUSINESS_DAY' } });
const oA = (await call(CASH, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
ok(await code(call(CASH, 'Order.AddLines', { params: { orderId: oA.id }, body: { expectedVersion: ord(oA.id).version, lines: [{ productId: PB, quantity: '1' }] } })) !== 'OK', 'a sold-out item cannot be added to a check');
await call(MGR, 'Product.SetAvailability', { params: { productId: PB }, body: { state: 'AVAILABLE', branchId: 'branch_main' } });
ok(await code(call(CASH, 'Order.AddLines', { params: { orderId: oA.id }, body: { expectedVersion: ord(oA.id).version, lines: [{ productId: PB, quantity: '1' }] } })) === 'OK', 'back on sale: the item is added');

console.log('\n== retire instead of delete');
const usage = (await call(MGR, 'Product.Usage', { params: { productId: PT } })).data;
ok(usage.usage.checks >= 1 && usage.canDelete === false && usage.deleteBlockers.includes('CHECKS'), `a sold product: ${usage.usage.checks} checks, cannot be deleted (${usage.deleteBlockers})`);
ok((await fail(call(MGR, 'Product.Delete', { params: { productId: PT }, body: { reason: 'أضيف بالخطأ', expectedVersion: store.db.products.find((p) => p.id === PT)!.version } }))).code === 'PRODUCT_DELETE_NOT_ALLOWED', 'RETIRE_ONLY: Product.Delete → PRODUCT_DELETE_NOT_ALLOWED');
ok(await setPolicy('ProductRemovalPolicy', { mode: 'DELETE_UNSOLD' }) === 'OK', 'owner allows deleting unsold products (SENSITIVE_POLICY_CHANGE approval)');
const r1 = await fail(call(MGR, 'Product.Delete', { params: { productId: PT }, body: { reason: 'أضيف بالخطأ', expectedVersion: store.db.products.find((p) => p.id === PT)!.version } }));
ok(r1.code === 'PRODUCT_HAS_HISTORY', 'a product with sales → PRODUCT_HAS_HISTORY (retire it instead)');
const PU = (await call(MGR, 'Product.Create', { body: { name: { ar: 'صنف بالخطأ', en: 'Mistake item' }, categoryId: 'cat_hot', unitId: 'unit_ea', sku: 'T-MIS-1', taxPolicyId: TAX } })).data.id as string;
await call(MGR, 'Catalog.SetPrice', { params: { productId: PU }, body: { amount: '10.00', currency: 'EGP', branchId: 'branch_main', channel: 'DINE_IN' } });
const vU = () => store.db.products.find((p) => p.id === PU)?.version;
ok(await code(call(MGR, 'Product.Delete', { params: { productId: PU }, body: { reason: '', expectedVersion: vU() } })) === 'REASON_REQUIRED', 'delete without a reason → REASON_REQUIRED');
ok(await code(call(MGR, 'Product.Delete', { params: { productId: PU }, body: { reason: 'أضيف بالخطأ', expectedVersion: 99 } })) === 'CONCURRENCY_CONFLICT', 'a stale version → CONCURRENCY_CONFLICT');
ok(await code(call(MGR, 'Product.Delete', { params: { productId: PU }, body: { reason: 'أضيف بالخطأ', expectedVersion: vU() } })) === 'OK' && !store.db.products.some((p) => p.id === PU) && !store.db.priceRules.some((r) => r.productId === PU), 'an unsold, unused product is deleted with its own price rules');
ok(!!audit(/T-MIS-1.*deleted — never sold: أضيف بالخطأ/) && store.db.audit.find((a) => /T-MIS-1/.test(a.summary))?.sensitive, 'the deletion is a sensitive audit line with the reason');
await setPolicy('ProductRemovalPolicy', { mode: 'RETIRE_ONLY' });
const vT = () => store.db.products.find((p) => p.id === PT)!.version;
ok(await code(call(MGR, 'Product.Retire', { params: { productId: PT }, body: { reason: 'ص', expectedVersion: vT() } })) === 'REASON_REQUIRED', 'retire with a too-short reason → REASON_REQUIRED');
ok(await code(call(MGR, 'Product.Configure', { params: { productId: PT }, body: { active: false, expectedVersion: vT() } })) === 'VALIDATION_FAILED', 'switching active off through Product.Configure → VALIDATION_FAILED (retire is its own command)');
ok(await code(call(MGR, 'Product.Retire', { params: { productId: PT }, body: { reason: 'خرج من قائمة الطعام', expectedVersion: vT() } })) === 'OK' && store.db.products.find((p) => p.id === PT)!.active === false, 'retired with a reason');
ok((store.db.products.find((p) => p.id === PT) as any).retired?.reason === 'خرج من قائمة الطعام' && !!audit(/T-COF-1 retired: خرج من قائمة الطعام/), 'the reason is kept on the product and in the audit');
ok(await code(call(MGR, 'Product.Retire', { params: { productId: PT }, body: { reason: 'مرة ثانية', expectedVersion: vT() } })) === 'PRODUCT_ALREADY_RETIRED', 'retiring twice → PRODUCT_ALREADY_RETIRED');
const oR = (await call(CASH, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
ok(await code(call(CASH, 'Order.AddLines', { params: { orderId: oR.id }, body: { expectedVersion: ord(oR.id).version, lines: [{ productId: PT, quantity: '1' }] } })) === 'CATALOG_PRODUCT_NOT_FOUND', 'a retired product is not sold');
ok(ord(oS).status === 'COMPLETED' && ord(oS).lines[0].productId === PT, 'its past sale is untouched');
const cats = (await call(MGR, 'Catalog.Search', { query: { active: 'false' } })).data.items;
ok(cats.some((p: any) => p.id === PT), 'the retired product is listed under the retired filter (kept for history)');
ok(await code(call(MGR, 'Product.Reinstate', { params: { productId: PT }, body: { expectedVersion: vT() } })) === 'OK' && store.db.products.find((p) => p.id === PT)!.active && (store.db.products.find((p) => p.id === PT) as any).retiredHistory?.length === 1, 'reinstated; the retirement stays in its history');
const comboPart = store.db.products.find((p) => p.active && (p.combo ?? []).length)!.combo![0].options[0].productId;
ok((await fail(call(MGR, 'Product.Retire', { params: { productId: comboPart }, body: { reason: 'لم يعد متوفرًا', expectedVersion: store.db.products.find((p) => p.id === comboPart)!.version } }))).code === 'PRODUCT_IN_USE', 'a product an active meal offers → PRODUCT_IN_USE (change the meal first)');

console.log('\n== scheduling (server time, branch time zone)');
const mk = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 2, mi); // Cairo = UTC+2 in November
const base = { id: 'x', name: { ar: 'x', en: 'x' }, kind: 'AUTOMATIC', code: null, benefitType: 'PERCENTAGE', benefitValue: '10', branchIds: ['branch_main'], channels: ['DINE_IN'], minSubtotal: null, schedule: null, validFrom: null, validTo: null, active: true, version: 1 } as any;
const live = (pr: any, ms: number, ch = 'DINE_IN', br = 'branch_main') => promotionLive(store.db, pr, br, ch as any, ms);
// 2026-11-05 is a Thursday (weekday 4)
ok(zonedParts(mk(2026, 11, 5, 12)).weekday === 4, 'calendar: 2026-11-05 is a Thursday in Cairo');
const night = { ...base, dayparts: [{ days: [4], start: '22:00', end: '02:00' }] };
ok(live(night, mk(2026, 11, 5, 23)) && live(night, mk(2026, 11, 6, 1, 30)), 'over midnight (Thu 22:00–02:00): Thu 23:00 and Fri 01:30 are live');
ok(!live(night, mk(2026, 11, 6, 23)) && !live(night, mk(2026, 11, 5, 1)) && !live(night, mk(2026, 11, 6, 2)), 'over midnight: Fri 23:00, Thu 01:00 and Fri 02:00 (end excluded) are not');
const lunch = { ...base, dayparts: [{ days: [0, 1, 2, 3, 4], start: '13:00', end: '16:00' }, { days: [5, 6], start: '12:00', end: '14:00' }] };
ok(live(lunch, mk(2026, 11, 5, 13)) && !live(lunch, mk(2026, 11, 5, 16)) && live(lunch, mk(2026, 11, 6, 12, 30)) && !live(lunch, mk(2026, 11, 6, 15)), 'two windows by weekday (Sun–Thu 13–16, Fri–Sat 12–14)');
const dated = { ...base, validFrom: mk(2026, 11, 10, 0), validTo: mk(2026, 11, 20, 0) };
ok(!live(dated, mk(2026, 11, 9, 23)) && live(dated, mk(2026, 11, 10, 0)) && !live(dated, mk(2026, 11, 20, 0)), 'dates: from inclusive, to exclusive');
ok(!live(base, mk(2026, 11, 5, 12), 'TAKEAWAY') && !live(base, mk(2026, 11, 5, 12), 'DINE_IN', 'branch_2') && !live({ ...base, active: false }, mk(2026, 11, 5, 12)), 'channel, branch and switched-off promotions are not live');

console.log('\n== promotion types on a check (server amounts)');
const pOrder = await promo({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '15' });
const oP1 = await check([{ productId: PT, quantity: '1' }]); // 33.33 → 15% = 4.9995
const opts1 = (await call(CASH, 'Order.PromotionOptions', { params: { orderId: oP1 } })).data.items;
const o1 = opts1.find((x: any) => x.promotionId === pOrder);
ok(o1?.applicable && o1.amount === '4.9900', `options: the 15% promotion applies, preview ${o1?.amount} (rounded down)`);
await apply(oP1, { promotionId: pOrder });
const t1 = await totals(oP1);
ok(lineAmt(t1, activeDisc(oP1)[0].id) === '4.9900' && t1.discountTotal === '4.9900', `applied: 15% of 33.33 = ${lineAmt(t1, activeDisc(oP1)[0].id)} (PromotionPolicy.rounding DOWN, never more than computed)`);
ok(activeDisc(oP1)[0].promotionVersion === promoRec(pOrder).version && activeDisc(oP1)[0].rounding === 'DOWN' && activeDisc(oP1)[0].stackBase === 'REMAINDER', 'the line captures the promotion version, rounding and stacked base');
ok(!!audit(new RegExp(`promotion ${pOrder} v1 on`)), 'the application is audited');
const pAmt = await promo({ mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '20' });
const oP2 = await check([{ productId: 'p_espresso', quantity: '2' }]);
await apply(oP2, { promotionId: pAmt });
ok((await totals(oP2)).discountTotal === '20.0000', 'fixed amount off the whole check: 20.00');
const pItems = await promo({ mechanic: 'ITEMS', benefitType: 'FIXED_AMOUNT', benefitValue: '5', productIds: ['p_espresso'] });
const oP3 = await check([{ productId: 'p_espresso', quantity: '3' }, { productId: 'p_pepsi', quantity: '1' }]);
await apply(oP3, { promotionId: pItems });
ok((await totals(oP3)).discountTotal === '15.0000', 'amount per item on chosen items: 3 × 5.00 = 15.00 (the soft drink untouched)');
const pCap = await promo({ mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '50', productIds: ['p_espresso'], maxPerCheck: 2 });
const oP4 = await check([{ productId: 'p_espresso', quantity: '3' }]);
await apply(oP4, { promotionId: pCap });
ok((await totals(oP4)).discountTotal === '45.0000', 'maxPerCheck 2 on 50% items: two units discounted = 45.00 of 135.00');
const pBx = await promo({ mechanic: 'BUY_X_GET_Y', productIds: [PT], buyQty: 2, getQty: 1, getPercent: '100' });
const oP5 = await check([{ productId: PT, quantity: '3' }]);
await apply(oP5, { promotionId: pBx });
ok((await totals(oP5)).discountTotal === '33.3300', 'buy 2 get 1 free: 33.33');
const pBundle = await promo({ mechanic: 'BUNDLE', bundleParts: [{ productIds: [PT], qty: 1 }, { categoryIds: ['cat_desserts'], qty: 1 }], bundlePrice: '50', maxPerCheck: 1 });
const oP6 = await check([{ productId: PT, quantity: '2' }, { productId: PB, quantity: '2' }]);
const prev6 = (await call(CASH, 'Order.PromotionOptions', { params: { orderId: oP6 } })).data.items.find((x: any) => x.promotionId === pBundle);
await apply(oP6, { promotionId: pBundle });
const t6 = await totals(oP6);
ok(t6.discountTotal === '8.3300' && prev6.amount === '8.3300', `bundle (coffee + dessert for 50.00, one set per check): 58.33 − 50.00 = ${t6.discountTotal}; preview = applied`);
const oP6b = await check([{ productId: PT, quantity: '1' }]);
ok((await fail(apply(oP6b, { promotionId: pBundle }))).code === 'PROMOTION_NOT_APPLICABLE', 'an incomplete bundle → PROMOTION_NOT_APPLICABLE (no qualifying items)');
const h = zonedParts(clock.now()).hour;
const hh = (x: number) => String((x + 24) % 24).padStart(2, '0') + ':00';
const pHappy = await promo({ mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '20', categoryIds: ['cat_hot'], dayparts: [{ days: [0, 1, 2, 3, 4, 5, 6], start: hh(h), end: hh(h + 1) }] });
const pLater = await promo({ mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '20', categoryIds: ['cat_hot'], dayparts: [{ days: [0, 1, 2, 3, 4, 5, 6], start: hh(h + 2), end: hh(h + 3) }] });
const oH = await check([{ productId: 'p_espresso', quantity: '1' }]);
const optsH = (await call(CASH, 'Order.PromotionOptions', { params: { orderId: oH } })).data.items;
ok(optsH.some((x: any) => x.promotionId === pHappy && x.applicable && x.amount === '9.0000') && !optsH.some((x: any) => x.promotionId === pLater), 'happy hour this hour is offered (20% of 45.00 = 9.00); the one two hours later is not');
ok((await fail(apply(oH, { promotionId: pLater }))).details?.rule === 'NOT_LIVE', 'applying the later one → PROMOTION_NOT_APPLICABLE (NOT_LIVE)');
await apply(oH, { promotionId: pHappy });
ok((await totals(oH)).discountTotal === '9.0000', 'happy hour applied: 9.00');

console.log('\n== codes');
const pCode = await promo({ kind: 'CODED', codes: ['TEST15', 'spring15'], mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10' });
ok(JSON.stringify(promoRec(pCode).codes) === JSON.stringify(['TEST15', 'SPRING15']), 'codes are stored upper-case');
ok(await code(promo({ kind: 'CODED', codes: ['TEST15'], benefitType: 'PERCENTAGE', benefitValue: '5' })) === 'PROMOTION_CODE_TAKEN', 'a code taken by another promotion → PROMOTION_CODE_TAKEN');
const oC = await check([{ productId: 'p_kofta', quantity: '1' }]);
ok(await code(apply(oC, { promotionId: pCode })) === 'PROMOTION_CODE_INVALID', 'a coded promotion by id (without its code) → PROMOTION_CODE_INVALID');
ok(await code(apply(oC, { promotionCode: 'NOPE99' })) === 'PROMOTION_CODE_INVALID', 'an unknown code → PROMOTION_CODE_INVALID');
const vc = (await call(CASH, 'Promotion.ValidateCode', { body: { code: 'spring15', orderId: oC } })).data;
ok(vc.id === pCode && vc.preview.amount === '22.0000', `ValidateCode with the check: 10% of 220.00 = ${vc.preview?.amount}`);
const cmd = 'cmd-ux15-idem-1';
const a1 = await call(CASH, 'Order.ApplyDiscount', { params: { orderId: oC }, body: { expectedVersion: ord(oC).version, discount: { promotionCode: 'spring15' } }, commandId: cmd });
const a2 = await call(CASH, 'Order.ApplyDiscount', { params: { orderId: oC }, body: { expectedVersion: ord(oC).version - 1, discount: { promotionCode: 'spring15' } }, commandId: cmd });
ok(a2.replayed && activeDisc(oC).length === 1 && a1.data.version === a2.data.version, 'the same command id twice: replayed, one promotion on the check (idempotent)');
ok(activeDisc(oC)[0].code === 'SPRING15', 'the code typed is kept on the discount line');

console.log('\n== customers and loyalty tiers, per-customer limits');
const pCust = await promo({ mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '10', customerScope: 'IDENTIFIED', maxUsesPerCustomer: 1 });
const oU1 = await check([{ productId: 'p_kofta', quantity: '1' }]);
ok((await fail(apply(oU1, { promotionId: pCust }))).code === 'PROMOTION_CUSTOMER_REQUIRED', 'no customer on the check → PROMOTION_CUSTOMER_REQUIRED');
await call(CASH, 'Order.SetCustomer', { params: { orderId: oU1 }, body: { expectedVersion: ord(oU1).version, customerId: 'cus_3' } });
ok(await code(apply(oU1, { promotionId: pCust })) === 'OK', 'with the customer: applied');
const oU2 = await check([{ productId: 'p_kofta', quantity: '1' }], 'TAKEAWAY', 'cus_3');
const rU2 = await fail(apply(oU2, { promotionId: pCust }));
ok(rU2.code === 'PROMOTION_LIMIT_REACHED' && rU2.details?.rule === 'PER_CUSTOMER', 'second check of the same customer → PROMOTION_LIMIT_REACHED (PER_CUSTOMER)');
const oU3 = await check([{ productId: 'p_kofta', quantity: '1' }], 'TAKEAWAY', 'cus_2');
ok(await code(apply(oU3, { promotionId: pCust })) === 'OK', 'another customer: applied');
const pTier = await promo({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '5', customerScope: 'TIERS', tierIds: ['tier_platinum'] });
const oT = await check([{ productId: 'p_kofta', quantity: '1' }], 'TAKEAWAY', 'cus_2');
const rT = await fail(apply(oT, { promotionId: pTier }));
ok(rT.code === 'PROMOTION_NOT_APPLICABLE' && rT.details?.rule === 'TIER', 'a platinum-only promotion for a lower tier → PROMOTION_NOT_APPLICABLE (TIER)');
await setPolicy('DiscountStackingPolicy', { autoApply: true });
const oT2 = await check([{ productId: 'p_kofta', quantity: '1' }], 'TAKEAWAY');
ok(!ord(oT2).discounts.some((d) => d.promotionId === pTier || d.promotionId === pCust), 'customer promotions are never put on silently by auto-apply');
await setPolicy('DiscountStackingPolicy', { autoApply: false });

console.log('\n== limits');
const pOnce = await promo({ mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '5', maxUses: 1 });
const oL1 = await check([{ productId: 'p_espresso', quantity: '1' }]);
await apply(oL1, { promotionId: pOnce });
const oL2 = await check([{ productId: 'p_espresso', quantity: '1' }]);
const rL2 = await fail(apply(oL2, { promotionId: pOnce }));
ok(rL2.code === 'PROMOTION_LIMIT_REACHED' && rL2.details?.rule === 'TOTAL', 'total uses reached → PROMOTION_LIMIT_REACHED (TOTAL)');
const pDay = await promo({ mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '5', maxUsesPerDay: 1 });
await apply(oL2, { promotionId: pDay });
const oL3 = await check([{ productId: 'p_espresso', quantity: '1' }]);
ok((await fail(apply(oL3, { promotionId: pDay }))).details?.rule === 'PER_DAY', 'daily uses reached → PER_DAY');
const pMin = await promo({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', minSubtotal: '500' });
ok((await fail(apply(oL3, { promotionId: pMin }))).details?.rule === 'MIN_SUBTOTAL', 'below the minimum → MIN_SUBTOTAL');
const optsL3 = (await call(CASH, 'Order.PromotionOptions', { params: { orderId: oL3 } })).data.items;
ok(optsL3.find((x: any) => x.promotionId === pMin)?.refusal?.rule === 'MIN_SUBTOTAL' && optsL3.find((x: any) => x.promotionId === pDay)?.refusal?.rule === 'PER_DAY', 'the options show each refusal rule for the cashier');

console.log('\n== stacking, priority and the stacked base');
const rc = store.db.reasonCodes.find((r) => r.kind === 'DISCOUNT' && r.active)!.code;
const pS1 = await promo({ mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '10', productIds: ['p_kofta'], stacking: 'STACKABLE', priority: 20 });
const pS2 = await promo({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', stacking: 'STACKABLE', priority: 10 });
const pS3 = await promo({ mechanic: 'ORDER', benefitType: 'FIXED_AMOUNT', benefitValue: '1', stacking: 'STACKABLE', priority: 30 });
const oK = await check([{ productId: 'p_kofta', quantity: '1' }]);
await apply(oK, { promotionId: pS1 });
const rNo = await fail(apply(oK, { promotionId: pS2 }));
ok(rNo.code === 'DISCOUNT_STACKING_NOT_ALLOWED' && rNo.details?.rule === 'NO_STACKING', 'NO_STACKING (default): a second promotion → DISCOUNT_STACKING_NOT_ALLOWED');
await setPolicy('DiscountStackingPolicy', { mode: 'ALLOW_STACKING' });
ok((await fail(apply(oK, { promotionId: pOrder }))).details?.rule === 'EXCLUSIVE', 'an exclusive promotion never combines → EXCLUSIVE');
await apply(oK, { promotionId: pS2 });
const tK = await totals(oK);
const [dS1, dS2] = [activeDisc(oK).find((d) => d.promotionId === pS1)!, activeDisc(oK).find((d) => d.promotionId === pS2)!];
ok(tK.discountLines[0].discountId === dS2.id && tK.discountLines[1].discountId === dS1.id, 'application order follows priority (10 before 20), not the order they were added');
ok(lineAmt(tK, dS2.id) === '22.0000' && lineAmt(tK, dS1.id) === '22.0000' && tK.discountTotal === '44.0000', `stacked: 10% of the check 22.00, then 10% of kofta 22.00 = ${tK.discountTotal}`);
const rMax = await fail(apply(oK, { promotionId: pS3 }));
ok(rMax.code === 'PROMOTION_LIMIT_REACHED' && rMax.details?.rule === 'PER_CHECK', 'a third promotion (maxPromotionsPerCheck 2) → PER_CHECK');
const rMan = await fail(apply(oK, { type: 'PERCENTAGE', value: '5' }, CASH, { reasonCode: rc, reason: 'عميل دائم' }));
ok(rMan.code === 'DISCOUNT_STACKING_NOT_ALLOWED' && rMan.details?.rule === 'MANUAL_WITH_PROMOTION', 'a manager discount on a check with a promotion → MANUAL_WITH_PROMOTION (DENY)');
const oRem = await check([{ productId: 'p_mixed_grill', quantity: '1' }]); // 320.00
await apply(oRem, { promotionId: pS3 }); // 1.00 fixed (priority 30)
await apply(oRem, { promotionId: pS2 }); // 10% (priority 10) first → 32.00; then 1.00
const tRem = await totals(oRem);
ok(tRem.discountTotal === '33.0000', `REMAINDER: 10% of 320.00 = 32.00 then 1.00 = ${tRem.discountTotal}`);
await setPolicy('PromotionPolicy', { stackBase: 'ORIGINAL' });
const oRem2 = await check([{ productId: 'p_kofta', quantity: '1' }]);
await apply(oRem2, { promotionId: pS1 }); await apply(oRem2, { promotionId: pS2 });
const tRem2 = await totals(oRem2);
ok(tRem2.discountTotal === '44.0000' && activeDisc(oRem2).every((d) => d.stackBase === 'ORIGINAL'), 'ORIGINAL: each promotion on the original amounts (captured on the line)');
await setPolicy('PromotionPolicy', { stackBase: 'REMAINDER', manualWithPromotion: 'ALLOW' });

console.log('\n== manager discount approval');
const oM = await check([{ productId: 'p_kofta', quantity: '1' }]);
ok((await fail(apply(oM, { type: 'PERCENTAGE', value: '20' }, CASH, { reasonCode: 'NO_SUCH_REASON', reason: 'عميل دائم' }))).code !== 'OK', 'an unknown reason code is refused');
const rApp2 = await fail(apply(oM, { type: 'PERCENTAGE', value: '20' }, CASH, { reasonCode: rc, reason: 'عميل دائم' }));
ok(rApp2.code === 'APPROVAL_REQUIRED', '20% (above the 10% threshold) → APPROVAL_REQUIRED');
const gr = (await call(CASH, 'Approval.Grant', { body: { action: rApp2.details.action, targetType: rApp2.details.targetType, targetId: rApp2.details.targetId, context: rApp2.details.context, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
ok(await code(apply(oM, { type: 'PERCENTAGE', value: '20' }, CASH, { reasonCode: rc, reason: 'عميل دائم', approvalGrantId: gr.grantId })) === 'OK' && activeDisc(oM)[0].approvalGrantId === gr.grantId, 'with the manager\'s grant: applied and bound to the grant');
await apply(oM, { promotionId: pS2 });
const tM = await totals(oM);
ok(tM.discountLines[0].discountId === activeDisc(oM).find((d) => d.promotionId)!.id && tM.discountTotal === '61.6000', `manualWithPromotion ALLOW: the promotion first (22.00), the manager discount on the remainder (20% of 198.00 = 39.60) = ${tM.discountTotal}`);
await setPolicy('PromotionPolicy', { manualWithPromotion: 'DENY' });
await setPolicy('DiscountStackingPolicy', { mode: 'NO_STACKING' });

console.log('\n== removal keeps history');
const dRem = activeDisc(oH)[0];
ok(await code(call(CASH, 'Order.RemoveDiscount', { params: { orderId: oH, discountId: dRem.id }, body: {} })) === 'REASON_REQUIRED', 'removing a promotion without a reason → REASON_REQUIRED (PromotionPolicy.removeReason)');
ok(await code(call(CASH, 'Order.RemoveDiscount', { params: { orderId: oH, discountId: dRem.id }, body: { reason: 'طلب العميل', expectedVersion: ord(oH).version - 1 } })) === 'CONCURRENCY_CONFLICT', 'a stale version → CONCURRENCY_CONFLICT');
ok(await code(call(CASH, 'Order.RemoveDiscount', { params: { orderId: oH, discountId: dRem.id }, body: { reason: 'طلب العميل', expectedVersion: ord(oH).version } })) === 'OK', 'removed with a reason');
const gone = ord(oH).discounts.find((d) => d.id === dRem.id)!;
ok(!gone.active && gone.removeReason === 'طلب العميل' && gone.removedBy === 'u_cashier_a' && !!gone.removedAt, 'the line stays on the check with who, when and why');
ok(ord(oH).history.some((x: any) => x.kind === 'DISCOUNT_REMOVED' && /طلب العميل/.test(x.text.ar)) && store.db.audit.some((a) => a.sensitive && /removed from .*طلب العميل/.test(a.summary)), 'in the check history and a sensitive audit line');
ok((await totals(oH)).discountTotal === '0.0000', 'the total no longer has it');
await setPolicy('DiscountStackingPolicy', { autoApply: true });
const pAuto = await promo({ mechanic: 'ITEMS', benefitType: 'PERCENTAGE', benefitValue: '10', productIds: ['p_om_ali'], priority: 5 });
const oAu = await check([{ productId: 'p_om_ali', quantity: '1' }]);
const dAu = activeDisc(oAu).find((d) => d.promotionId === pAuto);
ok(!!dAu && dAu.appliedBy === 'system' && !!audit(new RegExp(`auto promotion ${pAuto}`)), 'auto-apply puts the automatic promotion on and audits it');
await call(CASH, 'Order.RemoveDiscount', { params: { orderId: oAu, discountId: dAu!.id }, body: { reason: 'العميل رفض العرض', expectedVersion: ord(oAu).version } });
await call(CASH, 'Order.AddLines', { params: { orderId: oAu }, body: { expectedVersion: ord(oAu).version, lines: [{ productId: 'p_om_ali', quantity: '1' }] } });
ok(!activeDisc(oAu).some((d) => d.promotionId === pAuto), 'a promotion a person removed is not put back when lines change');
const optsAu = (await call(CASH, 'Order.PromotionOptions', { params: { orderId: oAu } })).data.items.find((x: any) => x.promotionId === pAuto);
ok(optsAu?.removedOnThisCheck === true && optsAu.onCheck === false && optsAu.refusal?.rule !== 'ALREADY_ON_CHECK', 'the options mark it removed on this check (the cashier may still apply it on purpose)');
await setPolicy('DiscountStackingPolicy', { autoApply: false });

console.log('\n== promotion edits, revisions and history');
const vUse = promoRec(pOrder).version;
ok(await code(call(MGR, 'Promotion.Upsert', { params: { promotionId: pOrder }, body: { name: { ar: 'عرض 1' }, kind: 'AUTOMATIC', channels: ['TAKEAWAY'], mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '25', expectedVersion: vUse } })) === 'REASON_REQUIRED', 'editing a promotion checks already used without a reason → REASON_REQUIRED');
await sell(oP1);
const paidBefore = ord(oP1).confirmation!.payable;
ok(await code(call(MGR, 'Promotion.Upsert', { params: { promotionId: pOrder }, body: { name: { ar: 'عرض 1' }, kind: 'AUTOMATIC', channels: ['TAKEAWAY'], mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '25', expectedVersion: vUse, changeReason: 'رفع النسبة للموسم' } })) === 'OK', 'with a reason: saved');
ok(ord(oP1).confirmation!.payable === paidBefore && ord(oP1).discounts[0].value === '15', 'the completed check keeps the old promotion amount');
const revs = (await call(MGR, 'Promotion.Find', { query: { includeInactive: 'true' } })).data.items.find((p: any) => p.id === pOrder).revisions;
ok(revs.length === 2 && revs[0].change === 'EDITED' && revs[0].reason === 'رفع النسبة للموسم' && revs[1].change === 'CREATED', 'revisions: created, then edited with the reason (newest first)');
ok(await code(call(MGR, 'Promotion.Upsert', { params: { promotionId: pOrder }, body: { name: { ar: 'عرض 1' }, kind: 'AUTOMATIC', channels: ['TAKEAWAY'], mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '25', active: false, expectedVersion: promoRec(pOrder).version, changeReason: 'انتهى الموسم' } })) === 'OK' && promoRec(pOrder).revisions.at(-1).change === 'DEACTIVATED', 'switched off: a DEACTIVATED revision; the promotion is kept');
ok(store.db.promotions.some((p) => p.id === pOrder) && store.db.audit.some((a) => a.sensitive && new RegExp(`promotion .* v\\d deactivated: انتهى الموسم`).test(a.summary)), 'never deleted; a sensitive audit line with the reason');

console.log('\n== the customer display shows what a promotion gives');
const cdv = (await call(CASH, 'CustomerDisplay.View', {})).data;
const bx = cdv.promos?.find((x: any) => x.id === 'promo_bxgy'), wl = cdv.promos?.find((x: any) => x.id === 'promo_2');
ok(bx?.benefit.kind === 'SUMMARY' && /اشترِ 2 .* واحصل على 1 .* مجانًا/.test(bx.benefit.summary.ar) && /Buy 2 .*get 1 .*free/.test(bx.benefit.summary.en), `buy-and-get on the display: «${bx?.benefit.summary?.ar}» (was «خصم 100%»)`);
ok(wl?.benefit.kind === 'AMOUNT' && wl.benefit.value === '50.0000', 'a whole-check amount stays an amount (50.00)');
const bundleOnDisplay = cdv.promos?.find((x: any) => x.id === pBundle);
ok(bundleOnDisplay?.benefit.kind === 'SUMMARY' && /بسعر 50 ج\.م/.test(bundleOnDisplay.benefit.summary.ar), `a bundle on the display: «${bundleOnDisplay?.benefit.summary?.ar}»`);

console.log('\n== promotion validation');
const bad = async (body: any) => (await fail(promo(body))).code;
ok(await bad({ mechanic: 'BUNDLE', bundleParts: [{ productIds: [PT], qty: 1 }], bundlePrice: '50' }) === 'VALIDATION_FAILED', 'a bundle with one part → VALIDATION_FAILED');
ok(await bad({ mechanic: 'BUNDLE', bundleParts: [{ productIds: [PT], qty: 1 }, { productIds: [PB], qty: 1 }], bundlePrice: '0' }) === 'VALIDATION_FAILED', 'a bundle without a price → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', maxPerCheck: 2 }) === 'VALIDATION_FAILED', 'maxPerCheck on a whole-check promotion → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', customerScope: 'TIERS', tierIds: [] }) === 'VALIDATION_FAILED', 'tier scope without tiers → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '110' }) === 'VALIDATION_FAILED', 'a percentage above 100 → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', validTo: new Date(clock.now() - 3600_000).toISOString() }) === 'VALIDATION_FAILED', 'a promotion that already ended → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', dayparts: [{ days: [1], start: '10:00', end: '10:00' }] }) === 'VALIDATION_FAILED', 'a daily window that starts and ends at the same time → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', channels: [] }) === 'VALIDATION_FAILED', 'no channel → VALIDATION_FAILED');
ok(await bad({ mechanic: 'ORDER', benefitType: 'PERCENTAGE', benefitValue: '10', priority: 0 }) === 'VALIDATION_FAILED', 'priority 0 → VALIDATION_FAILED (1..999)');

console.log('\n== settings validation');
ok(await setPolicy('PromotionPolicy', { maxPromotionsPerCheck: 9 }) === 'VALIDATION_FAILED', 'PromotionPolicy.maxPromotionsPerCheck 9 → VALIDATION_FAILED (1..5)');
ok(await setPolicy('PromotionPolicy', { stackBase: 'SUM' }) === 'VALIDATION_FAILED', 'an unknown stackBase → VALIDATION_FAILED');
ok(await setPolicy('PromotionPolicy', { rounding: 'UP' }) === 'VALIDATION_FAILED', 'rounding UP is not an option → VALIDATION_FAILED');
ok(await setPolicy('ProductRemovalPolicy', { mode: 'DELETE_ALL' }) === 'VALIDATION_FAILED', 'ProductRemovalPolicy DELETE_ALL → VALIDATION_FAILED');
ok(await code(call(MGR, 'Settings.UpdatePolicy', { params: { policyId: 'PromotionPolicy' }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...pv('PromotionPolicy'), removeReason: 'OPTIONAL' } } })) === 'APPROVAL_REQUIRED', 'changing PromotionPolicy needs SENSITIVE_POLICY_CHANGE approval');
await setPolicy('PromotionPolicy', { removeReason: 'OPTIONAL' });
const oO = await check([{ productId: 'p_espresso', quantity: '1' }]);
await apply(oO, { promotionId: pAmt });
ok(await code(call(CASH, 'Order.RemoveDiscount', { params: { orderId: oO, discountId: activeDisc(oO)[0].id }, body: {} })) === 'OK' && ord(oO).discounts[0].removeReason === null, 'removeReason OPTIONAL: removed without a reason (still kept on the check)');
await setPolicy('PromotionPolicy', { removeReason: 'REQUIRED' });

console.log(`\nPASSES: ${passes}\nFAILURES: ${failures}`);
process.exit(0);
