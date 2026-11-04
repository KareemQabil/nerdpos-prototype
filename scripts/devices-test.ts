// ux-14 headless check of the device registry and the customer display content (PROPOSED Device.* / Display.* /
// DisplayContent.* / Terminal.KeyMap, PROTOTYPE_GAPS §15k), against the mock through fetch like smoke.ts: the defaults
// and who may do what (authorization before every read and write), registration rules, CAS, audit with reasons, the
// display reading only its own content inside each item's schedule, print routing to the registered printers with
// visible, retryable failures while the sale stays committed, the drawer kick, the backup printer, kitchen printers,
// test pages, the terminals' key changes kept by the server, and the new settings' validation.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { store } = await import('../src/mock/store');
const { runOutbox } = await import('../src/mock/outbox');
const { devOf, contentActiveNow, deviceStatus, EMPTY_SCHEDULE } = await import('../src/mock/devices');
const { clock, zonedParts } = await import('../src/mock/clock');
installMockFetch();
demo.reset('DEMO');
sim.set({ latencyMs: 0, printers: {} });
const PIN = demo.pin;
let passes = 0, failures = 0;
const ok = (cond: any, text: string) => { if (cond) { passes++; console.log('  ✓', text); } else { failures++; console.log('  ✗ FAIL', text); } };
const dev = (deviceId: string, terminalId: string | null) => ({ deviceId, label: deviceId, terminalId, branchId: terminalId ? null : 'branch_main', token: null as string | null });
const CASH = dev('T1', 't_cash'), CASH2 = dev('T3', 't_cash2'), MGR = dev('M1', 't_admin'), MGRC = dev('M2', 't_cash'), OWN = dev('O1', 't_admin'), WAIT = dev('W1', 't_floor'), KDS = dev('K1', 't_kds');
async function login(d: any, username: string) { const r = await call(d, 'Auth.Login', { body: { method: 'PIN', username, secret: PIN } }); d.token = r.data.token; }
async function code(p: Promise<any>): Promise<string> { try { await p; return 'OK'; } catch (e: any) { if (!(e instanceof ApiFailure)) throw e; return e.code; } }
const settle = () => new Promise((r) => setTimeout(r, 40));
const D = (id: string) => devOf(store.db).devices.find((d) => d.id === id)!;
const C = (id: string) => devOf(store.db).content.find((c) => c.id === id)!;
const job = (id: string) => store.db.printJobs.find((j) => j.id === id)!;
const drain = (ids: string[], rounds = 3) => { for (let i = 0; i < rounds; i++) { for (const j of store.db.printJobs) if (ids.includes(j.id) && (j.state === 'PENDING' || j.state === 'FAILED')) j.nextAtMs = 0; runOutbox(); } };
const pv = (id: string) => store.db.policyValues.find((v) => v.policyId === id && v.scopeType === 'TENANT')?.value as any;
const audit = (op: string, target?: string) => store.db.audit.find((a) => a.op === op && (!target || a.target === target));
async function setPolicy(policyId: string, patch: Record<string, unknown>) {
  const body = { scopeType: 'TENANT', scopeId: 'biz', value: { ...(pv(policyId) ?? {}), ...patch } };
  let r: any = null; try { await call(OWN, 'Settings.UpdatePolicy', { params: { policyId }, body }); } catch (e: any) { r = e; }
  if (r?.code !== 'APPROVAL_REQUIRED') return r?.code ?? 'OK';
  const g = (await call(OWN, 'Approval.Grant', { body: { action: r.details.action, targetType: r.details.targetType, targetId: r.details.targetId, context: r.details.context, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
  await call(OWN, 'Settings.UpdatePolicy', { params: { policyId }, body: { ...body, approvalGrantId: g.grantId } });
  return 'OK';
}
async function sale(d: any, terminal: string) {
  if (!store.db.sessions.some((s) => s.terminalId === terminal && s.state === 'OPEN')) await call(d, 'Session.Open', { body: { terminalId: terminal, openingFloat: '500.00' } });
  let o = (await call(d, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
  o = (await call(d, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: o.version, lines: [{ productId: 'p_espresso', quantity: '1' }] } })).data;
  await call(d, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: store.db.orders.find((x) => x.id === o.id)!.version } });
  await call(d, 'Payment.Capture', { params: { orderId: o.id }, body: { tenders: [{ method: 'CASH', tendered: '100' }] } });
  await call(d, 'Order.Complete', { params: { orderId: o.id }, body: { expectedVersion: store.db.orders.find((x) => x.id === o.id)!.version } });
  return o.id as string;
}

await login(CASH, 'demo-cashier-a'); await login(CASH2, 'demo-cashier-b'); await login(MGR, 'demo-manager-1'); await login(MGRC, 'demo-manager-1'); await login(OWN, 'demo-owner'); await login(WAIT, 'demo-waiter-1'); await login(KDS, 'demo-chef-1');

console.log('\n== defaults, seed and permissions');
ok(JSON.stringify(pv('CustomerDisplayPolicy')) === JSON.stringify({ idleContent: 'ASSIGNED_ONLY', slideSeconds: 8, thanksSeconds: 60 }), `CustomerDisplayPolicy ${JSON.stringify(pv('CustomerDisplayPolicy'))}`);
ok(pv('PrintRoutingPolicy')?.fallback === 'NONE' && pv('DeviceHealthPolicy')?.offlineAfterSeconds === 120 && pv('KeyMapPolicy')?.changeBy === 'MANAGERS', 'PrintRoutingPolicy NONE · DeviceHealthPolicy 120 s · KeyMapPolicy MANAGERS');
const role = (id: string) => store.db.roles.find((r) => r.id === id)!.permissionIds;
ok(['device:read', 'device:test', 'device:manage', 'displaycontent:manage'].every((p) => role('role_manager').includes(p)), 'manager: device:read / test / manage, displaycontent:manage');
ok(role('role_cashier').includes('device:read') && role('role_cashier').includes('device:test') && !role('role_cashier').includes('device:manage') && !role('role_cashier').includes('displaycontent:manage'), 'cashier: device:read and device:test only');
ok(!role('role_waiter').some((p) => p.startsWith('device:') || p.startsWith('displaycontent:')), 'waiter: no device permission');
const all = (await call(MGR, 'Device.List', {})).data.items;
ok(['PRINTER', 'CASH_DRAWER', 'SCANNER', 'CUSTOMER_DISPLAY', 'CALL_BOARD'].every((k) => all.some((d: any) => d.kind === k)), `seeded registry: ${all.length} devices of every kind`);
ok(D('d_customer').terminalId === 't_cash' && D('d_callboard').terminalId === 't_kds' && D('d_customer').display!.playlist.length >= 4, 'the demo displays: customer display on cashier 1 (with a playlist), call board on the dispatch screen');
ok(D('d_customer').display!.playlist.every((id) => !!C(id)) && !D('d_customer').display!.playlist.includes('dc_desserts'), 'the playlist points to library items; one item waits unassigned');
ok(await code(call(WAIT, 'Device.List', {})) === 'PERMISSION_DENIED', 'waiter Device.List → PERMISSION_DENIED (authorization before the read)');
ok(await code(call(WAIT, 'DisplayContent.List', {})) === 'PERMISSION_DENIED', 'waiter DisplayContent.List → PERMISSION_DENIED');
ok(await code(call(CASH, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-Z', name: 'z', terminalId: 't_cash' } })) === 'PERMISSION_DENIED', 'cashier Device.Register → PERMISSION_DENIED');
ok(await code(call(CASH, 'Device.SetEnabled', { params: { deviceId: 'prn_cash' }, body: { enabled: false, reason: 'تجربة الإيقاف', expectedVersion: D('prn_cash').version } })) === 'PERMISSION_DENIED', 'cashier Device.SetEnabled → PERMISSION_DENIED');
ok(await code(call(CASH, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'عرض' } } })) === 'PERMISSION_DENIED', 'cashier DisplayContent.Upsert → PERMISSION_DENIED');
ok(await code(call(CASH, 'Display.SetPlaylist', { params: { deviceId: 'd_customer' }, body: { contentIds: [], expectedVersion: D('d_customer').version } })) === 'PERMISSION_DENIED', 'cashier Display.SetPlaylist → PERMISSION_DENIED');
ok((await code(call(CASH, 'Device.List', {}))) === 'OK', 'cashier reads the device status');

console.log('\n== registration rules, CAS and audit');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'TOASTER', code: 'X-1', name: 'x' } })) === 'VALIDATION_FAILED', 'an unknown kind → VALIDATION_FAILED');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-CASH-1', name: 'x' } })) === 'DEVICE_CODE_TAKEN', 'a taken code → DEVICE_CODE_TAKEN');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'CASH_DRAWER', code: 'DRW-X', name: 'x' } })) === 'DEVICE_HOST_INVALID', 'a drawer without a terminal → DEVICE_HOST_INVALID');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'CASH_DRAWER', code: 'DRW-X', name: 'x', terminalId: 't_floor' } })) === 'DEVICE_HOST_INVALID', 'a drawer on a waiter tablet → DEVICE_HOST_INVALID');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'CASH_DRAWER', code: 'DRW-X', name: 'x', terminalId: 't_cash' } })) === 'DEVICE_HOST_TAKEN', 'a second drawer on cashier 1 → DEVICE_HOST_TAKEN');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'CUSTOMER_DISPLAY', code: 'CD-X', name: 'x', terminalId: 't_cash' } })) === 'DEVICE_HOST_TAKEN', 'a second customer display on cashier 1 → DEVICE_HOST_TAKEN');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'CALL_BOARD', code: 'CB-X', name: 'x', terminalId: 't_cash' } })) === 'DEVICE_HOST_INVALID', 'a call board on a cashier terminal → DEVICE_HOST_INVALID');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-Y', name: 'y', printer: { roles: ['KITCHEN'], stationIds: ['st_nowhere'] } } })) === 'VALIDATION_FAILED', 'a kitchen printer for an unknown station → VALIDATION_FAILED');
ok(await code(call(MGR, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-Y', name: 'y', printer: { roles: [] } } })) === 'VALIDATION_FAILED', 'a printer that prints nothing → VALIDATION_FAILED');
const regCmd = 'reg-cd2-1';
const cd2 = (await call(MGR, 'Device.Register', { body: { kind: 'CUSTOMER_DISPLAY', code: 'cd-2', name: 'شاشة العميل 2', terminalId: 't_cash2', display: { style: 'theme', branding: true } }, commandId: regCmd })).data;
const again = await call(MGR, 'Device.Register', { body: { kind: 'CUSTOMER_DISPLAY', code: 'cd-2', name: 'شاشة العميل 2', terminalId: 't_cash2', display: { style: 'theme', branding: true } }, commandId: regCmd });
ok(cd2.code === 'CD-2' && cd2.status === 'NOT_SEEN' && again.replayed && devOf(store.db).devices.filter((d) => d.code === 'CD-2').length === 1, 'registered CD-2 on cashier 2 (code upper-cased, NOT_SEEN); a replay does not register twice');
ok(!!audit('Device.Register', cd2.id), `audited: «${audit('Device.Register', cd2.id)?.summary}»`);
ok(await code(call(MGR, 'Device.Update', { params: { deviceId: cd2.id }, body: { expectedVersion: cd2.version + 2, display: { style: 'display' } } })) === 'CONCURRENCY_CONFLICT', 'a stale version → CONCURRENCY_CONFLICT');
ok(await code(call(MGR, 'Device.Update', { params: { deviceId: cd2.id }, body: { expectedVersion: cd2.version, display: { style: 'neon' } } })) === 'VALIDATION_FAILED', 'an unknown look → VALIDATION_FAILED');
const up = (await call(MGR, 'Device.Update', { params: { deviceId: cd2.id }, body: { expectedVersion: cd2.version, display: { style: 'display', branding: false } } })).data;
ok(up.display.style === 'display' && up.display.branding === false && up.version === cd2.version + 1 && audit('Device.Update', cd2.id)?.summary.includes('theme/branding → display/no branding'), `look changed on the server, audited old → new («${audit('Device.Update', cd2.id)?.summary}»)`);
const net = (await call(MGR, 'Device.Register', { body: { kind: 'PRINTER', code: 'PRN-NET-2', name: 'طابعة الشبكة 2', printer: { roles: ['RECEIPT'], connection: 'NETWORK', address: '192.168.1.77' } } })).data;
ok(net.terminalId === null && net.printer.address === '192.168.1.77', 'a network printer without a terminal');
const moved = (await call(MGR, 'Device.Update', { params: { deviceId: net.id }, body: { expectedVersion: net.version, terminalId: 't_floor' } })).data;
ok(moved.terminalId === 't_floor' && audit('Device.Update', net.id)?.summary.includes('terminal none → DEMO-FLOOR-1'), 'attached to a terminal later (audited)');

console.log('\n== enable / disable with a reason; test page');
ok(await code(call(MGR, 'Device.SetEnabled', { params: { deviceId: net.id }, body: { enabled: false, reason: '', expectedVersion: moved.version } })) === 'REASON_REQUIRED', 'disable without a reason → REASON_REQUIRED');
const off = (await call(MGR, 'Device.SetEnabled', { params: { deviceId: net.id }, body: { enabled: false, reason: 'نُقلت إلى المخزن', expectedVersion: moved.version } })).data;
const offAudit = audit('Device.SetEnabled', net.id);
ok(off.status === 'DISABLED' && off.disabledReason === 'نُقلت إلى المخزن' && offAudit?.sensitive && offAudit.summary.includes('نُقلت إلى المخزن'), 'disabled: reason kept on the device and in the audit (sensitive)');
ok(await code(call(CASH, 'Device.TestPrint', { params: { deviceId: net.id } })) === 'DEVICE_DISABLED', 'test page on a disabled printer → DEVICE_DISABLED');
ok(await code(call(CASH, 'Device.TestPrint', { params: { deviceId: 'drw_cash' } })) === 'VALIDATION_FAILED', 'a test page on a drawer → VALIDATION_FAILED (its test is the audited no-sale opening)');
const tp = (await call(CASH, 'Device.TestPrint', { params: { deviceId: 'prn_cash' } })).data;
drain([tp.id]);
ok(job(tp.id).documentType === 'TEST_PAGE' && job(tp.id).pinned && job(tp.id).printerId === 'prn_cash' && job(tp.id).state === 'SUCCEEDED' && !!D('prn_cash').lastSeenAt && !!audit('Device.TestPrint', 'prn_cash'), 'the cashier prints a test page: a pinned TEST_PAGE job, sent, printer seen, audited');

console.log('\n== the display reads only its own content, inside each item\'s schedule');
const h = zonedParts(clock.now()).hour;
const p2 = (n: number) => String(n).padStart(2, '0');
const nowWin = { start: `${p2(h)}:00`, end: `${p2((h + 1) % 24)}:00` };
const laterWin = { start: `${p2((h + 3) % 24)}:00`, end: `${p2((h + 4) % 24)}:00` };
const today = (() => { const z = zonedParts(clock.now()); return `${z.year}-${p2(z.month)}-${p2(z.day)}`; })();
const mk = async (title: string, extra: any = {}) => (await call(MGR, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: title, en: title }, ...extra } })).data;
const cNow = await mk('الآن', { schedule: nowWin });
const cLater = await mk('لاحقًا', { schedule: laterWin });
const cFuture = await mk('غدًا', { schedule: { from: '2999-01-01' } });
const cOtherDay = await mk('يوم آخر', { schedule: { days: [(zonedParts(clock.now()).weekday + 1) % 7] } });
const cToday = await mk('اليوم', { schedule: { from: today, to: today } });
ok(cNow.activeNow && !cLater.activeNow && !cFuture.activeNow && !cOtherDay.activeNow && cToday.activeNow, 'schedule: this hour ✓, later ✗, a future day ✗, another weekday ✗, today only ✓');
const night = { ...EMPTY_SCHEDULE, start: '22:00', end: '02:00' };
const at = (hh: number) => { const base = clock.now(); const z = zonedParts(base); return base + ((hh - z.hour) * 60 - z.minute) * 60000; };
const asC = (s: any) => ({ ...C(cNow.id), schedule: s });
ok(contentActiveNow(asC(night), at(23)) && contentActiveNow(asC(night), at(1)) && !contentActiveNow(asC(night), at(12)), 'a window over midnight (22:00–02:00): 23:00 ✓, 01:00 ✓, 12:00 ✗');
const promoC = (await call(MGR, 'DisplayContent.Upsert', { body: { kind: 'PROMOTION', title: { ar: 'كود الترحيب' }, promotionId: 'promo_2' } })).data;
const dishC = (await call(MGR, 'DisplayContent.Upsert', { body: { kind: 'DISH', title: { ar: 'إسبريسو' }, productId: 'p_espresso' } })).data;
await call(MGR, 'Display.SetPlaylist', { params: { deviceId: cd2.id }, body: { contentIds: [cNow.id, cLater.id, cFuture.id, cOtherDay.id, promoC.id, dishC.id], expectedVersion: D(cd2.id).version } });
const v = (await call(CASH2, 'CustomerDisplay.View', { query: { displayId: cd2.id } })).data;
const ids = v.content.map((x: any) => x.id);
ok(JSON.stringify(ids) === JSON.stringify([cNow.id, promoC.id, dishC.id]), `CD-2 shows its playlist in order, only what is due now: ${ids.join(', ')}`);
ok(!ids.some((x: string) => D('d_customer').display!.playlist.includes(x)) && v.promos.length === 0 && v.featured.length === 0, 'nothing of cashier 1\'s display; no automatic promotions under ASSIGNED_ONLY');
const pr = v.content.find((x: any) => x.id === promoC.id);
ok(pr.promo.benefit.kind === 'AMOUNT' && pr.promo.benefit.value === '50.0000' && pr.promo.code === 'WELCOME50', 'a promotion slide carries the server\'s benefit (50.0000) — no typed amount');
ok(v.display.style === 'display' && v.display.branding === false && v.display.slideSeconds === 8 && v.display.thanksSeconds === 60, 'the display gets its server settings (look, branding, slide and thank-you seconds)');
ok(await code(call(CASH, 'CustomerDisplay.View', { query: { displayId: cd2.id } })) === 'DISPLAY_NOT_ATTACHED', 'read from another terminal → DISPLAY_NOT_ATTACHED');
ok(await code(call(CASH2, 'CustomerDisplay.View', { query: { displayId: 'd_nowhere' } })) === 'DEVICE_NOT_FOUND', 'an unknown display → DEVICE_NOT_FOUND');
ok(await code(call(KDS, 'CallBoard.View', { query: { displayId: 'd_customer' } })) === 'DEVICE_NOT_FOUND', 'a customer display read as a call board → DEVICE_NOT_FOUND');
const cb = (await call(KDS, 'CallBoard.View', { query: { displayId: 'd_callboard' } })).data;
ok(cb.display?.id === 'd_callboard' && cb.readyMinutes === 10 && await code(call(CASH, 'CallBoard.View', { query: { displayId: 'd_callboard' } })) === 'DISPLAY_NOT_ATTACHED', 'the call board reads its settings through the dispatch screen (venue rule still CallBoardPolicy); another terminal is refused');
ok(D(cd2.id).lastSeenAt && deviceStatus(store.db, D(cd2.id)) === 'ONLINE', 'reading its screen marks the display seen (ONLINE)');
D(cd2.id).lastSeenAt = new Date(clock.now() - 200_000).toISOString();
ok(deviceStatus(store.db, D(cd2.id)) === 'OFFLINE', 'not seen for longer than DeviceHealthPolicy (120 s) → OFFLINE');
store.db.promotions.find((p) => p.id === 'promo_2')!.active = false;
const v2 = (await call(CASH2, 'CustomerDisplay.View', { query: { displayId: cd2.id } })).data;
ok(!v2.content.some((x: any) => x.id === promoC.id), 'a promotion switched off leaves the screen at once');
store.db.promotions.find((p) => p.id === 'promo_2')!.active = true;
ok(await setPolicy('CustomerDisplayPolicy', { idleContent: 'ASSIGNED_AND_PROMOTIONS' }) === 'OK', 'CustomerDisplayPolicy → ASSIGNED_AND_PROMOTIONS (Settings.UpdatePolicy with the manager\'s approval)');
const v3 = (await call(CASH2, 'CustomerDisplay.View', { query: { displayId: cd2.id } })).data;
ok(v3.promos.length > 0 && v3.content.length === 3, `the automatic promotions join the assigned content (${v3.promos.length} promotions)`);
await setPolicy('CustomerDisplayPolicy', { idleContent: 'ASSIGNED_ONLY' });
ok(await setPolicy('CustomerDisplayPolicy', { slideSeconds: 2 }) === 'VALIDATION_FAILED' && await setPolicy('CustomerDisplayPolicy', { idleContent: 'EVERYTHING' }) === 'VALIDATION_FAILED' && await setPolicy('KeyMapPolicy', { changeBy: 'NOBODY' }) === 'VALIDATION_FAILED' && await setPolicy('DeviceHealthPolicy', { offlineAfterSeconds: 5 }) === 'VALIDATION_FAILED' && await setPolicy('PrintRoutingPolicy', { fallback: 'ANY' }) === 'VALIDATION_FAILED', 'the new settings are validated field by field (range, options)');

console.log('\n== content validation, playlist rules, retire');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: '' } } })) === 'VALIDATION_FAILED', 'no title → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'س' }, schedule: { start: '08:00' } } })) === 'VALIDATION_FAILED', 'a window without an end → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'MESSAGE', title: { ar: 'س' }, schedule: { from: '2026-12-10', to: '2026-12-01' } } })) === 'VALIDATION_FAILED', 'last day before the first → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'IMAGE', title: { ar: 'صورة' } } })) === 'VALIDATION_FAILED', 'a picture item without a picture → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'IMAGE', title: { ar: 'صورة' }, imageDataUrl: 'data:image/png;base64,' + 'A'.repeat(310_000) } })) === 'VALIDATION_FAILED', 'a picture over ~220 KB → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { kind: 'PROMOTION', title: { ar: 'ع' }, promotionId: 'promo_none' } })) === 'VALIDATION_FAILED', 'an unknown promotion → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Upsert', { body: { id: cNow.id, kind: 'MESSAGE', title: { ar: 'تعديل' }, expectedVersion: cNow.version + 4 } })) === 'CONCURRENCY_CONFLICT', 'editing a stale item → CONCURRENCY_CONFLICT');
const ed = (await call(MGR, 'DisplayContent.Upsert', { body: { id: cNow.id, title: { ar: 'الآن (معدّل)', en: 'Now' }, expectedVersion: cNow.version } })).data;
ok(ed.title.ar === 'الآن (معدّل)' && ed.version === cNow.version + 1 && !!audit('DisplayContent.Upsert', cNow.id), 'edited (CAS, audited)');
ok(await code(call(MGR, 'Display.SetPlaylist', { params: { deviceId: cd2.id }, body: { contentIds: ['dc_none'], expectedVersion: D(cd2.id).version } })) === 'DISPLAY_CONTENT_NOT_FOUND', 'an unknown item → DISPLAY_CONTENT_NOT_FOUND');
ok(await code(call(MGR, 'Display.SetPlaylist', { params: { deviceId: cd2.id }, body: { contentIds: [cNow.id, cNow.id], expectedVersion: D(cd2.id).version } })) === 'VALIDATION_FAILED', 'an item twice → VALIDATION_FAILED');
ok(await code(call(MGR, 'Display.SetPlaylist', { params: { deviceId: cd2.id }, body: { contentIds: [cNow.id], expectedVersion: D(cd2.id).version - 1 } })) === 'CONCURRENCY_CONFLICT', 'a stale playlist → CONCURRENCY_CONFLICT');
ok(await code(call(MGR, 'Display.SetPlaylist', { params: { deviceId: 'd_callboard' }, body: { contentIds: [], expectedVersion: D('d_callboard').version } })) === 'VALIDATION_FAILED', 'a call board has no playlist → VALIDATION_FAILED');
ok(await code(call(MGR, 'DisplayContent.Retire', { params: { contentId: cNow.id }, body: { reason: '', expectedVersion: C(cNow.id).version } })) === 'REASON_REQUIRED', 'retire without a reason → REASON_REQUIRED');
const pv0 = D(cd2.id).version;
const rt = (await call(MGR, 'DisplayContent.Retire', { params: { contentId: cNow.id }, body: { reason: 'انتهى العرض', expectedVersion: C(cNow.id).version } })).data;
ok(rt.retired && rt.retiredReason === 'انتهى العرض' && !D(cd2.id).display!.playlist.includes(cNow.id) && D(cd2.id).version === pv0 + 1 && audit('DisplayContent.Retire', cNow.id)?.summary.includes('removed from CD-2'), 'retired: reason kept, removed from CD-2 (its version moved), audited');
ok(!!C(cNow.id) && (await call(MGR, 'DisplayContent.List', { query: { retired: 'true' } })).data.items.some((x: any) => x.id === cNow.id) && !(await call(MGR, 'DisplayContent.List', {})).data.items.some((x: any) => x.id === cNow.id), 'kept for history (listed with retired=true only)');
ok(await code(call(MGR, 'DisplayContent.Retire', { params: { contentId: cNow.id }, body: { reason: 'مرة أخرى', expectedVersion: C(cNow.id).version } })) === 'DISPLAY_CONTENT_RETIRED' && await code(call(MGR, 'Display.SetPlaylist', { params: { deviceId: cd2.id }, body: { contentIds: [cNow.id], expectedVersion: D(cd2.id).version } })) === 'DISPLAY_CONTENT_RETIRED', 'a retired item cannot be retired again or put back on a screen');

console.log('\n== a disabled display shows nothing');
await call(MGR, 'Device.SetEnabled', { params: { deviceId: cd2.id }, body: { enabled: false, reason: 'نقل الشاشة', expectedVersion: D(cd2.id).version } });
const vd = (await call(CASH2, 'CustomerDisplay.View', { query: { displayId: cd2.id, orderId: store.db.orders.find((o) => o.branchId === 'branch_main')!.id } })).data;
ok(vd.display.enabled === false && vd.content.length === 0 && vd.order === null && vd.promos.length === 0, 'disabled: no content, no check, no promotions');
await call(MGR, 'Device.SetEnabled', { params: { deviceId: cd2.id }, body: { enabled: true, expectedVersion: D(cd2.id).version } });

console.log('\n== printing: a failed print is a visible, retryable job; the sale stays committed');
sim.set({ printers: { prn_cash: 'PAPER_OUT' } });
const o1 = await sale(CASH, 't_cash');
const rc = () => store.db.printJobs.find((j) => j.documentId === o1 && j.documentType === 'RECEIPT')!;
const kk = () => store.db.printJobs.find((j) => j.documentId === o1 && j.documentType === 'DRAWER_KICK')!;
drain([rc().id, kk().id], 2);
ok(store.db.orders.find((o) => o.id === o1)!.status === 'COMPLETED', 'the sale is COMPLETED although the printer is out of paper');
ok(rc().state === 'FAILED' && rc().attempts.every((a) => a.error === 'PAPER_OUT' && a.printerId === 'prn_cash') && rc().printerId === 'prn_cash', `the receipt is a FAILED job on PRN-CASH-1 (${rc().attempts.length} attempts, PAPER_OUT)`);
ok(store.db.alerts.some((a) => a.kind === 'DEVICE_FAILURE' && a.ref === 'dev-prn_cash-PAPER_OUT' && !a.ack), 'an alert is raised (never swallowed)');
ok((await call(MGR, 'Device.Get', { params: { deviceId: 'prn_cash' } })).data.status === 'PAPER_OUT' && (await call(MGR, 'Device.Get', { params: { deviceId: 'prn_cash' } })).data.failedJobs >= 1, 'the printer shows PAPER_OUT with its failed job');
ok(kk().state === 'SUCCEEDED' && kk().printerId === 'drw_cash', 'the cash drawer was kicked as its own job (DRAWER_KICK on DRW-CASH-1)');
const pjf = (await call(MGR, 'PrintJob.Find', { query: { printerId: 'prn_cash', state: 'FAILED' } })).data.items;
ok(pjf.some((j: any) => j.id === rc().id && j.printerCode === 'PRN-CASH-1'), 'PrintJob.Find by printer carries the printer code');
sim.set({ printers: {} });
await call(CASH, 'PrintJob.Retry', { params: { printJobId: rc().id } });
drain([rc().id]);
ok(rc().state === 'SUCCEEDED' && store.db.printJobs.filter((j) => j.documentId === o1 && j.documentType === 'RECEIPT').length === 1, 'after the paper change the same job is retried and sent — one receipt');
sim.set({ printers: { prn_cash: 'DOWN' } });
const tpd = (await call(CASH, 'Device.TestPrint', { params: { deviceId: 'prn_cash' } })).data;
drain([tpd.id], 6);
ok(job(tpd.id).state === 'DEAD' && job(tpd.id).attempts.filter((a) => a.error === 'PRINTER_UNREACHABLE').length === 5, 'five failed attempts → DEAD (waits for «إعادة»)');
sim.set({ printers: {} });
sim.setOffline('t_cash', true);
ok(deviceStatus(store.db, D('prn_cash')) === 'OFFLINE' && deviceStatus(store.db, D('d_customer')) === 'OFFLINE', 'the host terminal offline → its printer and display are OFFLINE');
sim.setOffline('t_cash', false);
sim.set({ printers: { drw_cash: 'ERROR' } });
const o2 = await sale(CASH, 't_cash');
const k2 = () => store.db.printJobs.find((j) => j.documentId === o2 && j.documentType === 'DRAWER_KICK')!;
drain([k2().id], 1);
ok(store.db.orders.find((o) => o.id === o2)!.status === 'COMPLETED' && k2().state === 'FAILED' && k2().attempts[0].error === 'DEVICE_ERROR', 'a drawer fault: the kick is a FAILED job, the sale stays COMPLETED');
sim.set({ printers: {} });
const ns = store.db.sessions.find((s) => s.terminalId === 't_cash' && s.state === 'OPEN')!;
const reasonCode = store.db.reasonCodes.find((r) => r.kind === 'NO_SALE' && r.active)?.code;
const nsr = (await call(CASH, 'Drawer.OpenNoSale', { params: { sessionId: ns.id }, body: { reasonCode, reason: 'تجربة درج النقدية' } })).data;
ok(nsr.drawerKick === 'queued' && job(nsr.drawerJobId)?.documentType === 'DRAWER_KICK', 'a no-sale opening kicks the registered drawer (a job)');

console.log('\n== routing: no printer, disabled printer, the backup printer');
const d2 = D('prn_cash2');
await call(MGR, 'Device.SetEnabled', { params: { deviceId: d2.id }, body: { enabled: false, reason: 'الطابعة في الصيانة', expectedVersion: d2.version } });
const o3 = await sale(CASH2, 't_cash2');
const r3 = () => store.db.printJobs.find((j) => j.documentId === o3 && j.documentType === 'RECEIPT')!;
drain([r3().id], 1);
ok(r3().state === 'FAILED' && r3().attempts[0].error === 'DEVICE_DISABLED', 'the only receipt printer of cashier 2 is disabled → FAILED (DEVICE_DISABLED), the sale committed');
ok(await setPolicy('PrintRoutingPolicy', { fallback: 'BRANCH_BACKUP' }) === 'OK', 'PrintRoutingPolicy → BRANCH_BACKUP');
drain([r3().id], 1);
ok(r3().state === 'FAILED' && r3().attempts.at(-1)!.error === 'DEVICE_DISABLED', 'no backup printer marked yet → still FAILED');
await call(MGR, 'Device.Update', { params: { deviceId: 'prn_office' }, body: { expectedVersion: D('prn_office').version, printer: { backup: true } } });
await call(CASH2, 'PrintJob.Retry', { params: { printJobId: r3().id } });
drain([r3().id], 1);
ok(r3().state === 'SUCCEEDED' && r3().printerId === 'prn_office', 'with the office printer as the backup the same job is sent there');
await setPolicy('PrintRoutingPolicy', { fallback: 'NONE' });
await call(MGR, 'Device.SetEnabled', { params: { deviceId: d2.id }, body: { enabled: true, expectedVersion: D(d2.id).version } });
const tm = store.db.terminals.find((t) => t.id === 't_second_floor');
if (tm) { const pre = devOf(store.db).devices.filter((d) => d.terminalId === tm.id); devOf(store.db).devices = devOf(store.db).devices.filter((d) => d.terminalId !== tm.id); const fake = { id: 'pj_test_np', documentType: 'RECEIPT', documentId: 'x', copyKind: 'ORIGINAL', terminalId: tm.id, state: 'PENDING', attempts: [], nextAtMs: 0, createdAt: clock.iso(), createdBy: 'test', label: 'إيصال X' } as any; store.db.printJobs.unshift(fake); runOutbox(); ok(job('pj_test_np').state === 'FAILED' && job('pj_test_np').attempts[0].error === 'NO_PRINTER', 'a terminal without a printer → FAILED (NO_PRINTER), never silently dropped'); devOf(store.db).devices.push(...pre); }

console.log('\n== kitchen printer');
const bar = store.db.stations.find((s) => s.name === 'BAR') ?? store.db.stations[0];
await call(MGR, 'Device.Update', { params: { deviceId: 'prn_kitchen' }, body: { expectedVersion: D('prn_kitchen').version, printer: { roles: ['KITCHEN'], stationIds: [bar.id] } } });
let ko = (await call(CASH, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
ko = (await call(CASH, 'Order.AddLines', { params: { orderId: ko.id }, body: { expectedVersion: ko.version, lines: [{ productId: 'p_tea', quantity: '1', modifierOptionIds: ['opt_size_regular'] }, { productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }] } })).data;
await call(CASH, 'Order.Confirm', { params: { orderId: ko.id }, body: { expectedVersion: store.db.orders.find((x) => x.id === ko.id)!.version } });
await settle(); runOutbox();
const tks = store.db.tickets.filter((x) => x.orderId === ko.id);
const kj = store.db.printJobs.filter((j) => j.documentType === 'KITCHEN_TICKET' && tks.some((x) => x.id === j.documentId));
drain(kj.map((j) => j.id));
ok(tks.length >= 1 && kj.length === tks.filter((x) => x.stationId === bar.id).length && kj.length >= 1 && kj.every((j) => j.printerId === 'prn_kitchen' && job(j.id).state === 'SUCCEEDED'), `only the bar's tickets print on the kitchen printer (${kj.length} of ${tks.length} tickets)`);

console.log('\n== keyboard changes kept by the server (KeyMapPolicy)');
const km0 = (await call(CASH, 'Terminal.KeyMap', { params: { terminalId: 't_cash' } })).data;
ok(km0.canChange === false && km0.changeBy === 'MANAGERS', 'the cashier reads the keys, may not change them (MANAGERS)');
ok(await code(call(CASH, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9' }, expectedVersion: km0.version } })) === 'KEYMAP_CHANGE_NOT_ALLOWED', 'cashier → KEYMAP_CHANGE_NOT_ALLOWED');
const km1 = (await call(MGRC, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9', hold: 'Shift+F9' }, expectedVersion: km0.version } })).data;
ok(km1.sale.pay === 'F9' && km1.version === km0.version + 1 && audit('Terminal.SetKeyMap', 't_cash')?.summary.includes('pay=F9'), 'the manager changes the keys of cashier 1 (audited)');
ok(await code(call(MGRC, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: { pay: 'F9', hold: 'F9' }, expectedVersion: km1.version } })) === 'VALIDATION_FAILED', 'two actions on one key → VALIDATION_FAILED');
ok(await code(call(MGRC, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: {}, expectedVersion: km0.version } })) === 'CONCURRENCY_CONFLICT', 'a stale key map → CONCURRENCY_CONFLICT');
ok((await call(CASH, 'Terminal.KeyMap', { params: { terminalId: 't_cash' } })).data.sale.pay === 'F9', 'any browser of the terminal reads the same keys');
await setPolicy('KeyMapPolicy', { changeBy: 'ANY_SIGNED_IN' });
ok(await code(call(CASH, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'kds', changes: { bump: 'b' }, expectedVersion: km1.version } })) === 'OK', 'ANY_SIGNED_IN: the cashier changes the keys of his own terminal');
ok(await code(call(CASH, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash2' }, body: { scope: 'sale', changes: { pay: 'F9' }, expectedVersion: 0 } })) === 'KEYMAP_CHANGE_NOT_ALLOWED', '… but not another terminal\'s');
await setPolicy('KeyMapPolicy', { changeBy: 'MANAGERS' });
await call(MGRC, 'Terminal.SetKeyMap', { params: { terminalId: 't_cash' }, body: { scope: 'sale', changes: {}, expectedVersion: (await call(MGRC, 'Terminal.KeyMap', { params: { terminalId: 't_cash' } })).data.version } });

console.log('\n== audit and secrets');
const ops = ['Device.Register', 'Device.Update', 'Device.SetEnabled', 'Device.TestPrint', 'Display.SetPlaylist', 'DisplayContent.Upsert', 'DisplayContent.Retire', 'Terminal.SetKeyMap'];
ok(ops.every((op) => store.db.audit.some((a) => a.op === op && a.userId)), 'every device command writes an audit line with its actor');
ok(!store.db.audit.some((a) => ops.includes(a.op) && /secret:\/\/|password|\b\d{4,6}\b(?=.*PIN)/i.test(a.summary)), 'no credential in the device audit lines');

console.log(`\nPASSES: ${passes}\nFAILURES: ${failures}`);
process.exit(0);
