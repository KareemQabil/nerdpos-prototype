// ux-13 headless check of customer phone masking (CustomerPrivacyPolicy, customer:viewphone, Customer.RevealPhone) and the
// loyalty rules made settings (manual adjustment with reason / CAS / approval, earnBase, expiry). Runs against the mock
// through fetch, like smoke.ts: no full customer number reaches a viewer who may not see it, in any read.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { operations } = await import('../src/mock/contracts');
const { apiLog } = await import('../src/mock/kernel');
const { customerPhones, maskPhone } = await import('../src/mock/privacy');
installMockFetch();
demo.reset('DEMO');
sim.set({ latencyMs: 0 });
const PIN = demo.pin;
let passes = 0, failures = 0;
const ok = (cond: any, text: string) => { if (cond) { passes++; console.log('  ✓', text); } else { failures++; console.log('  ✗ FAIL', text); } };
const dev = (deviceId: string, terminalId: string | null) => ({ deviceId, label: deviceId, terminalId, branchId: terminalId ? null : 'branch_main', token: null as string | null });
const CASH = dev('T1', 't_cash'), MGR = dev('M1', 't_admin'), MGR2 = dev('M2', 't_admin'), OWN = dev('O1', 't_admin'), CC = dev('CC', 't_cash'), DSP = dev('DS', 't_admin'), RID = dev('R1', 't_rider'), HOST = dev('H1', 't_floor'), KDS = dev('K1', 't_kds');
async function login(d: any, username: string) { const r = await call(d, 'Auth.Login', { body: { method: 'PIN', username, secret: PIN } }); d.token = r.data.token; }
async function code(p: Promise<any>): Promise<string> { try { await p; return 'OK'; } catch (e: any) { if (!(e instanceof ApiFailure)) throw e; return e.code; } }
const settle = () => new Promise((r) => setTimeout(r, 40));
const cust = (i: number) => store.db.customers![i];
const setPrivacy = (v: any) => demo.setPolicy('CustomerPrivacyPolicy', { phoneDisplay: 'MASKED_UNLESS_PERMITTED', revealMode: 'WITH_REASON', riderAccess: 'OUT_FOR_DELIVERY', partialSearch: 'PERMITTED_ONLY', ...v });
const all = () => [...customerPhones(store.db)];
/** The full customer numbers found in an answer (minus the ones this viewer may see). */
const leaks = (data: unknown, allowed: string[] = []) => { const s = JSON.stringify(data ?? null); return all().filter((p) => s.includes(p) && !allowed.includes(p)); };

await login(CASH, 'demo-cashier-a'); await login(MGR, 'demo-manager-1'); await login(MGR2, 'demo-manager-2'); await login(OWN, 'demo-owner');
await login(CC, 'demo-callcenter'); await login(DSP, 'demo-dispatcher'); await login(RID, 'demo-driver'); await login(HOST, 'demo-host'); await login(KDS, 'demo-chef-1');
await call(CASH, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } });

console.log('\n== defaults and permissions');
const pv = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
ok(JSON.stringify(pv('CustomerPrivacyPolicy')) === JSON.stringify({ phoneDisplay: 'MASKED_UNLESS_PERMITTED', revealMode: 'WITH_REASON', riderAccess: 'OUT_FOR_DELIVERY', partialSearch: 'PERMITTED_ONLY' }), `CustomerPrivacyPolicy default ${JSON.stringify(pv('CustomerPrivacyPolicy'))}`);
const roleHas = (role: string) => store.db.roles.find((r) => r.id === role)!.permissionIds.includes('customer:viewphone');
ok(roleHas('role_manager') && !['role_cashier', 'role_waiter', 'role_host', 'role_captain', 'role_callcenter', 'role_dispatcher', 'role_driver'].some(roleHas), 'customer:viewphone: manager only (owner holds *)');
ok(maskPhone('01001234567') === '010•••••567' && maskPhone('0224150000') === '022••••000', `mask format ${maskPhone('01001234567')} · ${maskPhone('0224150000')}`);
const adjRule = (pv('ApprovalRequirementPolicy') ?? {}).LOYALTY_ADJUST;
ok(!adjRule || adjRule.mode === 'ALWAYS', `LOYALTY_ADJUST rule ${JSON.stringify(adjRule ?? 'default ALWAYS')}`);
const lp = pv('LoyaltyProgramPolicy');
ok(lp && (lp.earnBase ?? 'ITEMS_AFTER_DISCOUNT') === 'ITEMS_AFTER_DISCOUNT' && Number(lp.expiryMonths ?? 0) === 0, `LoyaltyProgramPolicy ${JSON.stringify(lp)}`);

console.log('\n== scenario data: a delivery (customer 0), a takeaway with customer 1, a deposit (customer 2)');
const c0 = cust(0), c1 = cust(1), c2 = cust(2), c24 = cust(24);
let o = (await call(CASH, 'Order.Create', { body: { channel: 'DELIVERY', customerId: c0.id } })).data;
o = (await call(CASH, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: o.version, lines: [{ productId: 'p_kofta', quantity: '2', modifierOptionIds: ['opt_medium'] }] } })).data;
const a0 = c0.addresses[0];
const dl = (await call(CASH, 'Delivery.Create', { body: { orderId: o.id, customerId: c0.id, address: a0, zoneId: a0.zoneId, paymentMode: 'CASH_ON_DELIVERY' } })).data;
o = (await call(CASH, 'Order.Get', { params: { orderId: o.id } })).data;
await call(CASH, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: store.db.orders.find((x) => x.id === o.id)!.version } });
await settle();
let t1 = (await call(CASH, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
t1 = (await call(CASH, 'Order.AddLines', { params: { orderId: t1.id }, body: { expectedVersion: t1.version, lines: [{ productId: 'p_kofta', quantity: '4', modifierOptionIds: ['opt_medium'] }] } })).data;
t1 = (await call(CASH, 'Order.SetCustomer', { params: { orderId: t1.id }, body: { expectedVersion: t1.version, customerId: c1.id } })).data;
ok(store.db.orders.find((x) => x.id === t1.id)!.customerPhone === c1.phone, 'the check keeps the customer snapshot (server side)');
await call(CASH, 'Deposit.Create', { body: { customer: c2.name, phone: c2.phone, customerId: c2.id, amount: '100.00', method: 'CASH', purpose: 'BOOKING' } });

console.log('\n== no full number reaches a viewer without customer:viewphone (every read)');
const viewers: [string, any][] = [['cashier', CASH], ['call center', CC], ['dispatcher', DSP], ['host', HOST], ['rider', RID], ['manager (WITH_REASON)', MGR], ['owner (WITH_REASON)', OWN]];
const qryOps = operations.filter((op) => op.kind === 'QRY' && !op.path.includes('{'));
for (const [who, d] of viewers) {
  let calls = 0; const bad: string[] = [];
  for (const op of qryOps) {
    try { const r = await call(d, op.id, { query: { limit: '500' } }); calls++; const l = leaks(r.data); if (l.length) bad.push(`${op.id}:${l.join('/')}`); } catch { /* not allowed or needs input */ }
  }
  // the reads that take an id
  const ids: [string, any][] = [
    ...store.db.customers!.slice(0, 27).map((c) => ['Customer.Get', { params: { customerId: c.id } }] as [string, any]),
    ...store.db.customers!.slice(0, 5).map((c) => ['Loyalty.Balance', { params: { customerId: c.id } }] as [string, any]),
    ...[o.id, t1.id].map((id) => ['Order.Get', { params: { orderId: id } }] as [string, any]),
    ...[o.id, t1.id].map((id) => ['Receipt.Get', { params: { orderId: id } }] as [string, any]),
    ...(store.db.deliveries ?? []).slice(-40).map((x) => ['Delivery.Get', { params: { deliveryId: x.id } }] as [string, any]),
    ['Customer.Search', { query: { phone: c0.phone } }], ['Customer.Search', { query: { text: c24.altPhone } }], ['Search.Global', { query: { q: c0.phone } }], ['Search.Global', { query: { q: c0.name } }],
    ['Reservation.Find', { query: {} }], ['Deposit.Find', { query: {} }], ['Audit.Find', { query: { limit: '500' } }],
  ];
  for (const [op, opts] of ids) { try { const r = await call(d, op, opts); calls++; const l = leaks(r.data); if (l.length) bad.push(`${op}:${l.join('/')}`); } catch { /* not allowed */ } }
  ok(!bad.length && calls > 10, `${who}: ${calls} reads, no full customer number${bad.length ? ' — LEAKS ' + bad.slice(0, 6).join(' ') : ''}`);
}
const cs = (await call(CASH, 'Customer.Get', { params: { customerId: c1.id } })).data;
ok(cs.phone === maskPhone(c1.phone) && cs.phoneMasked === true && cs.phoneReveal === false, `cashier profile: ${cs.phone}, no reveal`);
ok(cs.duplicates.length > 0 && cs.duplicates.every((x: any) => x.phone.includes('•')), `duplicates masked: ${cs.duplicates.map((x: any) => x.phone).join(', ')}`);
const og = (await call(CASH, 'Order.Get', { params: { orderId: t1.id } })).data;
ok(og.customerPhone === maskPhone(c1.phone) && JSON.stringify(og.history ?? og).includes(maskPhone(c1.phone)), `check customerPhone + history: ${og.customerPhone}`);
const legacy = (await call(HOST, 'Reservation.Find', { query: {} })).data.items.find((r: any) => r.legacy);
ok(legacy && legacy.phone.includes('•'), `legacy free-text reservation phone masked: ${legacy?.phone}`);

console.log('\n== lookup by the whole number still works (masked answer); a part needs the permission');
const byFull = (await call(CASH, 'Customer.Search', { query: { phone: c0.phone } })).data;
ok(byFull.items.length === 1 && byFull.items[0].id === c0.id && byFull.items[0].phone === maskPhone(c0.phone), `cashier types ${c0.phone} → ${byFull.items[0]?.name} ${byFull.items[0]?.phone}`);
const byIntl = (await call(CC, 'Customer.Search', { query: { phone: '+20' + c0.phone.slice(1) } })).data;
ok(byIntl.items.length === 1 && byIntl.items[0].id === c0.id, 'call center: +20 form of the number finds the customer');
const byLand = (await call(CASH, 'Customer.Search', { query: { phone: c24.altPhone } })).data;
ok(byLand.items.length === 1 && byLand.items[0].id === c24.id && byLand.items[0].altPhone.includes('•'), `landline second number finds ${byLand.items[0]?.name} (${byLand.items[0]?.altPhone})`);
const part = (await call(CASH, 'Customer.Search', { query: { phone: c0.phone.slice(0, 7) } })).data;
ok(part.items.length === 0 && part.phoneSearch === 'FULL_NUMBER_REQUIRED', `cashier, part of a number: ${part.items.length} results, ${part.phoneSearch}`);
const partText = (await call(CASH, 'Customer.Search', { query: { text: c0.phone.slice(-5) } })).data;
ok(!partText.items.some((x: any) => x.id === c0.id), 'cashier, last digits as text: no match');
const g360 = (await call(CASH, 'Search.Global', { query: { q: c0.phone.slice(-6) } })).data;
ok(!JSON.stringify(g360).includes(c0.id), 'global search: part of a number finds nobody for the cashier');
const partM = (await call(MGR, 'Customer.Search', { query: { phone: c0.phone.slice(0, 7) } })).data;
ok(partM.items.some((x: any) => x.id === c0.id) && partM.phoneSearch === 'PARTIAL', `manager (customer:viewphone), part of a number: ${partM.items.length} results`);

console.log('\n== reveal with a reason (manager), audited; refused for the cashier');
const mg = (await call(MGR, 'Customer.Get', { params: { customerId: c0.id } })).data;
ok(mg.phone === maskPhone(c0.phone) && mg.phoneReveal === true, `manager under WITH_REASON: masked (${mg.phone}), «إظهار الرقم» offered`);
ok(await code(call(CASH, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: 'تأكيد العنوان', expectedVersion: c0.version } })) === 'PERMISSION_DENIED', 'cashier reveal → PERMISSION_DENIED');
ok(await code(call(MGR, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: '', expectedVersion: c0.version } })) === 'VALIDATION_FAILED', 'reveal without a reason → VALIDATION_FAILED');
ok(await code(call(MGR, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: 'تأكيد العنوان', expectedVersion: c0.version + 5 } })) === 'CONCURRENCY_CONFLICT', 'reveal with a stale version → CONCURRENCY_CONFLICT');
const auditBefore = store.db.audit.length;
const cmd = 'reveal-' + Date.now();
const rv = await call(MGR, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: 'تأكيد العنوان مع العميل', expectedVersion: c0.version }, commandId: cmd });
ok(rv.data.phone === c0.phone, `reveal returns the full number once (${rv.data.phone})`);
const au = store.db.audit.find((x) => x.op === 'Customer.RevealPhone' && x.target === c0.id);
ok(store.db.audit.length === auditBefore + 1 && au && au.userId === 'u_manager_1' && au.sensitive && au.summary.includes('تأكيد العنوان مع العميل') && !au.summary.includes(c0.phone), `audited: «${au?.summary}» (no number)`);
const rp = await call(MGR, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: 'تأكيد العنوان مع العميل', expectedVersion: c0.version }, commandId: cmd });
ok(rp.replayed && rp.data.phone === maskPhone(c0.phone), `replay of the same command: masked (${rp.data.phone})`);
ok(!JSON.stringify(store.db.idem).includes(`"phone":"${c0.phone}"`) || !Object.values(store.db.idem).some((x: any) => x.opId === 'Customer.RevealPhone' && JSON.stringify(x.body).includes(c0.phone)), 'replay storage keeps the masked number only');
ok(!apiLog.entries().some((e) => e.opId === 'Customer.RevealPhone' && JSON.stringify(e.response).includes(c0.phone)), 'request log keeps the masked number only');
const after = (await call(MGR, 'Customer.Get', { params: { customerId: c0.id } })).data;
ok(after.phone === maskPhone(c0.phone), 'after the reveal the profile stays masked (nothing kept)');
const auditView = (await call(MGR, 'Audit.Find', { query: { limit: '50' } })).data;
ok(JSON.stringify(auditView).includes('Customer.RevealPhone'), 'the reveal is in the audit log');

console.log('\n== the rider: his own delivery\'s number once picked up (OUT_FOR_DELIVERY)');
const rid = store.db.drivers!.find((x) => x.id === 'drv_5')!;
if (!rid.onShift) await call(RID, 'DriverShift.Start', { params: { driverId: 'drv_5' }, body: { expectedVersion: rid.version } });
for (const tk of store.db.tickets.filter((x) => x.orderId === o.id)) {
  if (tk.state === 'NEW') await call(KDS, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: tk.version, toState: 'IN_PROGRESS' } });
  await call(KDS, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: store.db.tickets.find((x) => x.id === tk.id)!.version, toState: 'READY' } });
}
const dv = () => store.db.deliveries!.find((x) => x.id === dl.id)!;
await call(CASH, 'Delivery.Assign', { params: { deliveryId: dl.id }, body: { expectedVersion: dv().version, driverId: 'drv_5' } });
let rb = (await call(RID, 'Delivery.Get', { params: { deliveryId: dl.id } })).data;
ok(rb.phone === maskPhone(c0.phone), `assigned, not picked up: ${rb.phone}`);
await call(RID, 'Delivery.Dispatch', { params: { deliveryId: dl.id }, body: { expectedVersion: dv().version, toState: 'PICKED_UP' } });
rb = (await call(RID, 'Delivery.Get', { params: { deliveryId: dl.id } })).data;
ok(rb.phone === c0.phone, `picked up: the rider sees ${rb.phone} to call the customer`);
const board = (await call(RID, 'Delivery.Board', { query: { scope: 'active' } })).data;
ok(leaks(board, [c0.phone]).length === 0, 'his board: no other customer\'s full number');
ok((await call(CASH, 'Delivery.Get', { params: { deliveryId: dl.id } })).data.phone === maskPhone(c0.phone), 'the cashier still sees it masked');
setPrivacy({ riderAccess: 'NONE' });
ok((await call(RID, 'Delivery.Get', { params: { deliveryId: dl.id } })).data.phone === maskPhone(c0.phone), 'riderAccess NONE: masked for the rider too');
setPrivacy({ riderAccess: 'ACTIVE_DELIVERY' });
ok((await call(RID, 'Delivery.Get', { params: { deliveryId: dl.id } })).data.phone === c0.phone, 'riderAccess ACTIVE_DELIVERY: full');
await call(RID, 'Delivery.Complete', { params: { deliveryId: dl.id }, body: { expectedVersion: dv().version, collectedMethod: 'CASH' } });
setPrivacy({});
ok((await call(RID, 'Delivery.Board', { query: {} })).data && leaks((await call(RID, 'Delivery.Board', { query: {} })).data).length === 0, 'delivered: the number is masked again for the rider');

console.log('\n== settings change the effect');
setPrivacy({ revealMode: 'FULL_IN_VIEWS' });
ok((await call(MGR, 'Customer.Get', { params: { customerId: c0.id } })).data.phone === c0.phone, 'FULL_IN_VIEWS: the manager sees the full number in the profile');
ok((await call(CASH, 'Customer.Get', { params: { customerId: c0.id } })).data.phone === maskPhone(c0.phone), 'FULL_IN_VIEWS: still masked for the cashier');
setPrivacy({ revealMode: 'NOT_ALLOWED' });
ok(await code(call(MGR, 'Customer.RevealPhone', { params: { customerId: c0.id }, body: { reason: 'تأكيد العنوان', expectedVersion: c0.version } })) === 'CUSTOMER_PHONE_REVEAL_NOT_ALLOWED', 'NOT_ALLOWED: reveal refused (403)');
ok((await call(MGR, 'Customer.Get', { params: { customerId: c0.id } })).data.phoneReveal === false, 'NOT_ALLOWED: no reveal offered');
setPrivacy({ phoneDisplay: 'FULL_FOR_ALL' });
const full = (await call(CASH, 'Customer.Get', { params: { customerId: c1.id } })).data;
ok(full.phone === c1.phone && full.phoneMasked === false, `FULL_FOR_ALL: the cashier sees ${full.phone}`);
setPrivacy({ partialSearch: 'ALL' });
ok((await call(CASH, 'Customer.Search', { query: { phone: c0.phone.slice(0, 7) } })).data.items.some((x: any) => x.id === c0.id), 'partialSearch ALL: the cashier finds by part of the number (masked answer)');
setPrivacy({});
// through the settings screen path: audited, with a manager's approval
const pvRow = store.db.policyValues.find((v) => v.policyId === 'CustomerPrivacyPolicy' && v.scopeType === 'TENANT')!;
const body = { scopeType: 'TENANT', scopeId: 'biz', value: { ...(pvRow.value as object), revealMode: 'FULL_IN_VIEWS' }, expectedVersion: pvRow.version };
let r1: any = null; try { await call(OWN, 'Settings.UpdatePolicy', { params: { policyId: 'CustomerPrivacyPolicy' }, body }); } catch (e: any) { r1 = e; }
ok(r1?.code === 'APPROVAL_REQUIRED', 'the setting change needs SENSITIVE_POLICY_CHANGE');
const g = (await call(OWN, 'Approval.Grant', { body: { action: r1.details.action, targetType: r1.details.targetType, targetId: r1.details.targetId, context: r1.details.context, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
await call(OWN, 'Settings.UpdatePolicy', { params: { policyId: 'CustomerPrivacyPolicy' }, body: { ...body, approvalGrantId: g.grantId } });
ok(store.db.policyHistory.some((h) => h.policyId === 'CustomerPrivacyPolicy' && h.via === 'SETTINGS' && (h.newValue as any)?.revealMode === 'FULL_IN_VIEWS') && store.db.audit.some((x) => x.op === 'Approval.Grant' && x.target.startsWith('CustomerPrivacyPolicy') && x.approverUserId === 'u_manager_1'), 'changed through the settings: policy history (old → new) + the approval in the audit');
ok(await code(call(OWN, 'Settings.UpdatePolicy', { params: { policyId: 'CustomerPrivacyPolicy' }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { phoneDisplay: 'NOBODY' } } })) === 'VALIDATION_FAILED', 'an unknown option is refused');
setPrivacy({});

console.log('\n== customer edit with the masked number keeps it');
const cv = (await call(CASH, 'Customer.Get', { params: { customerId: c1.id } })).data;
await call(CASH, 'Customer.Update', { params: { customerId: c1.id }, body: { name: cv.name, phone: cv.phone, altPhone: cv.altPhone, notes: cv.notes, expectedVersion: cv.version } });
ok(store.db.customers!.find((x) => x.id === c1.id)!.phone === c1.phone, 'saving the form with the masked number: the number is unchanged');
const cv2 = (await call(CASH, 'Customer.Get', { params: { customerId: c1.id } })).data;
await call(CASH, 'Customer.Update', { params: { customerId: c1.id }, body: { name: cv2.name, phone: '01019191919', expectedVersion: cv2.version } });
ok(store.db.customers!.find((x) => x.id === c1.id)!.phone === '01019191919' && store.db.audit.some((x) => x.op === 'Customer.Update' && x.summary.includes('phone changed') && !x.summary.includes('01019191919')), 'a new number typed whole is saved; audit says the phone changed (no number)');

console.log('\n== loyalty: manual adjustment (reason, CAS, approval, append-only)');
const bal = (id: string) => store.db.loyaltyEntries!.filter((e) => e.customerId === id).reduce((a, e) => a + e.points, 0);
const b0 = bal(c2.id);
const entriesBefore = store.db.loyaltyEntries!.length;
ok(await code(call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 50, reason: 'تعويض عن تأخير طلب' } })) === 'VALIDATION_FAILED', 'without expectedBalance → VALIDATION_FAILED');
ok(await code(call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 50, reason: 'ab', expectedBalance: b0 } })) === 'VALIDATION_FAILED', 'reason shorter than ReasonTextPolicy.minLength → VALIDATION_FAILED');
ok(await code(call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 50, reason: 'تعويض عن تأخير طلب', expectedBalance: b0 + 1 } })) === 'CONCURRENCY_CONFLICT', 'stale expectedBalance → CONCURRENCY_CONFLICT');
ok(await code(call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 5, reason: 'تعويض عن تأخير طلب', expectedBalance: b0 } })) === 'APPROVAL_REQUIRED', 'even 5 points need a manager (LOYALTY_ADJUST ALWAYS)');
ok(await code(call(CASH, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 5, reason: 'تعويض عن تأخير طلب', expectedBalance: b0 } })) === 'PERMISSION_DENIED', 'the cashier cannot adjust points');
const adjBody = { points: 50, reason: 'تعويض عن تأخير طلب', expectedBalance: b0 };
let ar: any = null; try { await call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: adjBody, commandId: 'adj-1' }); } catch (e: any) { ar = e; }
const grant = (approver: string) => call(MGR, 'Approval.Grant', { body: { action: ar.details.action, targetType: ar.details.targetType, targetId: ar.details.targetId, context: ar.details.context, approverUserId: approver, approverCredentialKind: 'PIN', approverSecret: PIN } });
ok(await code(grant('u_manager_1')) === 'SELF_APPROVAL_DENIED', 'the requester cannot approve his own adjustment');
const g2 = (await grant('u_manager_2')).data;
const done = (await call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { ...adjBody, approvalGrantId: g2.grantId }, commandId: 'adj-1' })).data;
ok(done.entry.points === 50 && done.entry.approvalGrantId === g2.grantId && bal(c2.id) === b0 + 50 && store.db.loyaltyEntries!.length === entriesBefore + 1, `+50 with demo-manager-2's approval (balance ${b0} → ${bal(c2.id)})`);
const adjAudit = store.db.audit.find((x) => x.op === 'Loyalty.Adjust' && x.target === c2.id);
ok(adjAudit && adjAudit.approvalGrantId === g2.grantId && adjAudit.summary.includes(`${b0} → ${b0 + 50}`) && adjAudit.summary.includes('تعويض'), `audit: «${adjAudit?.summary}»`);
ok(await code(call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { ...adjBody, expectedBalance: b0 + 50, approvalGrantId: g2.grantId } })) === 'APPROVAL_GRANT_ALREADY_CONSUMED', 'the grant is single use');

console.log('\n== loyalty: earnBase and expiry are settings');
const lpol = () => store.db.policyValues.find((v) => v.policyId === 'LoyaltyProgramPolicy' && v.scopeType === 'TENANT')!.value as any;
const q1 = (await call(CASH, 'Loyalty.Balance', { params: { customerId: c1.id }, query: { orderId: t1.id } })).data;
demo.setPolicy('LoyaltyProgramPolicy', { ...lpol(), earnBase: 'CHECK_TOTAL' });
const q2 = (await call(CASH, 'Loyalty.Balance', { params: { customerId: c1.id }, query: { orderId: t1.id } })).data;
ok(q1.earnPreview && q2.earnPreview && q2.earnPreview.points >= q1.earnPreview.points && q2.earnPreview.earnBase === 'CHECK_TOTAL', `earn preview items ${q1.earnPreview?.points} → whole check ${q2.earnPreview?.points}`);
demo.setPolicy('LoyaltyProgramPolicy', { ...lpol(), earnBase: 'ITEMS_AFTER_DISCOUNT' });
const before3 = (await call(CASH, 'Loyalty.Balance', { params: { customerId: c2.id } })).data.balance;
demo.setPolicy('LoyaltyProgramPolicy', { ...lpol(), expiryMonths: 1 });
const after3 = (await call(CASH, 'Loyalty.Balance', { params: { customerId: c2.id } })).data.balance;
ok(after3 < before3 && after3 === 50, `expiryMonths 1: the old seeded points expire (${before3} → ${after3}; the fresh +50 stays)`);
const ledger1 = store.db.loyaltyEntries!.length;
const b4 = (await call(MGR, 'Loyalty.Balance', { params: { customerId: c2.id } })).data.balance;
let ar2: any = null; try { await call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 10, reason: 'هدية عيد ميلاد', expectedBalance: b4 } }); } catch (e: any) { ar2 = e; }
const g3 = (await call(MGR, 'Approval.Grant', { body: { action: ar2.details.action, targetType: ar2.details.targetType, targetId: ar2.details.targetId, context: ar2.details.context, approverUserId: 'u_manager_2', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
await call(MGR, 'Loyalty.Adjust', { params: { customerId: c2.id }, body: { points: 10, reason: 'هدية عيد ميلاد', expectedBalance: b4, approvalGrantId: g3.grantId } });
const exp = store.db.loyaltyEntries!.slice(ledger1).find((e) => e.kind === 'EXPIRE');
ok(exp && exp.points === -(before3 - 50) && bal(c2.id) === 60, `the next command writes the EXPIRE entry (${exp?.points}); balance ${bal(c2.id)}`);
demo.setPolicy('LoyaltyProgramPolicy', { ...lpol(), expiryMonths: 0 });
ok(await code(call(OWN, 'Settings.UpdatePolicy', { params: { policyId: 'LoyaltyProgramPolicy' }, body: { scopeType: 'TENANT', scopeId: 'biz', value: { ...lpol(), egpPerPoint: '0' } } })) === 'VALIDATION_FAILED', 'egpPerPoint 0 is refused');

console.log(`\nPASSES: ${passes}\nFAILURES: ${failures}`);
process.exit(0);
