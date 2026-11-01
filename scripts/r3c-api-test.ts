// r3C headless checks: sales channels + channel prices, bulk change with exceptions and pinned overrides,
// per-user permission overrides (with expiry), vendor-only capabilities. Run like the journeys test.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { devices } = await import('../src/app/devices');
const { as } = await import('../src/demo/runner');
const { call } = await import('../src/api/client');
const { store } = await import('../src/mock/store');
const { clock } = await import('../src/mock/clock');
installMockFetch();
demo.reset('DEMO'); devices.resetAll(); sim.set({ latencyMs: 0 });
let fails = 0;
const ok = (c: boolean, msg: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); if (!c) fails++; };
const tryCall = async (dev: any, op: string, opts: any) => { try { return { ok: true, data: (await call(dev, op, opts)).data } as any; } catch (e: any) { return { ok: false, code: e.code, details: e.details } as any; } };
const n = (x: any) => Number(x);
const mods = (pid: string) => { const p = store.db.products.find((x: any) => x.id === pid)!; return p.modifierGroupIds.map((g: string) => store.db.modifierGroups.find((x: any) => x.id === g)).filter((g: any) => g && g.min > 0).flatMap((g: any) => g.options.filter((o: any) => o.active && Number(o.priceDelta) === 0).slice(0, g.min).map((o: any) => o.id)); };

const owner = await as('BO', 'demo-owner');
// 1. channels
const list = (await call(owner, 'SalesChannel.List', {})).data.items;
ok(list.length === 4 && list.some((c: any) => c.id === 'sch_talabat' && c.orderType === 'DELIVERY'), `seeded channels: ${list.map((c: any) => c.name.ar).join('، ')}`);
const created = await tryCall(owner, 'SalesChannel.Upsert', { params: { salesChannelId: 'new' }, body: { name: { ar: 'كيتا', en: 'Keeta' }, orderType: 'DELIVERY', priceMode: 'FOLLOW', follow: { channelId: 'sch_delivery', percent: '20', roundingStep: '1' }, color: '#e11d48' } });
ok(created.ok && created.data.id === 'sch_keeta', `create channel كيتا follow دليفري +20% → ${created.data?.id ?? created.code}`);
const dup = await tryCall(owner, 'SalesChannel.Upsert', { params: { salesChannelId: 'new' }, body: { name: { ar: 'طلبات', en: 'x' }, orderType: 'DELIVERY', priceMode: 'OWN' } });
ok(!dup.ok && dup.code === 'SALES_CHANNEL_NAME_TAKEN', `duplicate name refused → ${dup.code}`);
const cashierOnly = await as('t_cash', 'demo-cashier-a');
const noPerm = await tryCall(cashierOnly, 'SalesChannel.Upsert', { params: { salesChannelId: 'new' }, body: { name: { ar: 'مرسول', en: 'Mrsool' }, orderType: 'DELIVERY' } });
ok(!noPerm.ok && noPerm.code === 'PERMISSION_DENIED', `cashier cannot create channels → ${noPerm.code}`);
const q = async (pid: string, body: any) => (await call(owner, 'Pricing.QuoteItem', { params: { productId: pid }, body: { branchId: 'branch_main', quantity: '1', modifierOptionIds: mods(pid), ...body } })).data;
const qDine = await q('p_turkish_coffee', { channel: 'DINE_IN' });
const qTal = await q('p_turkish_coffee', { salesChannelId: 'sch_talabat' });
const qKeeta = await q('p_turkish_coffee', { salesChannelId: 'sch_keeta' });
const qHum = await q('p_hummus', { salesChannelId: 'sch_talabat' });
ok(n(qDine.unitTotal) === 40 && n(qTal.unitTotal) === 48 && qTal.salesChannel.priceSource === 'OWN', `turkish coffee: dine-in ${qDine.unitTotal}, طلبات ${qTal.unitTotal} (${qTal.salesChannel?.priceSource})`);
ok(n(qKeeta.unitTotal) === 48 && qKeeta.salesChannel.priceSource === 'FOLLOW', `كيتا follows دليفري +20%: ${qKeeta.unitTotal} (${qKeeta.salesChannel?.priceSource})`);
ok(n(qHum.unitTotal) === 60 && qHum.salesChannel.priceSource === 'ORDER_TYPE', `hummus on طلبات falls back to delivery: ${qHum.unitTotal} (${qHum.salesChannel?.priceSource})`);

// 2. orders carry the channel
const cashier = await as('t_cash', 'demo-cashier-a');
await tryCall(cashier, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.0000' } });
const oDine = (await call(cashier, 'Order.Create', { body: { channel: 'TAKEAWAY' } })).data;
const oTal = (await call(cashier, 'Order.Create', { body: { channel: 'DELIVERY', salesChannelId: 'sch_talabat' } })).data;
const bad = await tryCall(cashier, 'Order.Create', { body: { channel: 'TAKEAWAY', salesChannelId: 'sch_talabat' } });
ok(!bad.ok && bad.code === 'SALES_CHANNEL_ORDER_TYPE_MISMATCH', `takeaway order with طلبات refused → ${bad.code}`);
const a1 = (await call(cashier, 'Order.AddLines', { params: { orderId: oDine.id }, body: { expectedVersion: oDine.version, lines: [{ productId: 'p_turkish_coffee', quantity: '1', modifierOptionIds: mods('p_turkish_coffee') }] } })).data;
const a2 = (await call(cashier, 'Order.AddLines', { params: { orderId: oTal.id }, body: { expectedVersion: oTal.version, lines: [{ productId: 'p_turkish_coffee', quantity: '1', modifierOptionIds: mods('p_turkish_coffee') }] } })).data;
ok(oDine.salesChannelId === 'sch_takeaway' && oTal.salesChannelId === 'sch_talabat', `orders carry salesChannelId: ${oDine.salesChannelId} / ${oTal.salesChannelId}`);
ok(n(a1.lines[0].unitPrice) === 40 && n(a2.lines[0].unitPrice) === 48, `same coffee: takeaway line ${a1.lines[0].unitPrice}, طلبات line ${a2.lines[0].unitPrice}`);

// 3. bulk: delivery +20%, tea excluded; dine-in untouched; preview = result; audit
const mgr = await as('t_admin', 'demo-manager-1');
const bulkBody = (dry: boolean, extra: any = {}) => ({ dryRun: dry, filter: { salesChannelIds: ['sch_delivery'], branchIds: ['branch_main'], includeVariants: true }, change: { mode: 'PERCENT', value: '20' }, rounding: { step: '1', direction: 'NEAREST' }, exclusions: { productIds: ['p_tea'], categoryIds: [], rowKeys: [] }, ...extra });
const pv = (await call(mgr, 'Catalog.BulkPriceChange', { body: bulkBody(true) })).data;
const teaRow = pv.rows.find((r: any) => r.productId === 'p_tea');
ok(teaRow?.skipped === 'EXCLUDED' && teaRow.excluded === 'ITEM', `preview: tea row excluded (${teaRow?.skipped}/${teaRow?.excluded}), changed ${pv.summary.changed}, excluded ${pv.summary.excluded}`);
ok(pv.rows.every((r: any) => r.salesChannelId === 'sch_delivery'), 'preview touches only the delivery channel');
const ap = (await call(mgr, 'Catalog.BulkPriceChange', { body: bulkBody(false) })).data;
const sig = (rows: any[]) => rows.filter((r) => !r.skipped).map((r) => `${r.key}=${r.newAmount}`).sort().join(',');
ok(sig(pv.rows) === sig(ap.rows) && ap.summary.changed === pv.summary.changed, `result = preview (${ap.summary.changed} applied, ${ap.summary.excluded} excluded)`);
ok(!!ap.batch.exclusions && ap.batch.exclusions.productIds[0] === 'p_tea', 'exceptions saved with the batch');
const teaDel = await q('p_tea', { channel: 'DELIVERY' }); const teaDine = await q('p_tea', { channel: 'DINE_IN' });
const cofDel = await q('p_turkish_coffee', { channel: 'DELIVERY' }); const cofDine = await q('p_turkish_coffee', { channel: 'DINE_IN' });
ok(n(teaDel.unitTotal) === 25 && n(teaDine.unitTotal) === 25, `tea: delivery ${teaDel.unitTotal} (excluded), dine-in ${teaDine.unitTotal}`);
ok(n(cofDel.unitTotal) === 48 && n(cofDine.unitTotal) === 40, `coffee: delivery ${cofDel.unitTotal} (+20%), dine-in ${cofDine.unitTotal} (untouched)`);
const keetaAfter = await q('p_turkish_coffee', { salesChannelId: 'sch_keeta' });
ok(n(keetaAfter.unitTotal) === 58, `كيتا follows the new delivery price +20%: ${keetaAfter.unitTotal}`);
const talAfter = await q('p_turkish_coffee', { salesChannelId: 'sch_talabat' });
ok(n(talAfter.unitTotal) === 48, `طلبات own price untouched by the delivery change: ${talAfter.unitTotal}`);
const aud = store.db.audit.find((a: any) => a.target === ap.batch.id);
ok(!!aud && aud.sensitive && /1 excluded/.test(aud.summary), `audit: ${aud?.summary}`);
const lineStill = store.db.orders.find((o: any) => o.id === oTal.id)!.lines[0].unitPrice;
ok(n(lineStill) === 48, 'existing check lines keep their captured price');

// 4. a single-item override that the next bulk change respects unless included
const sp = await tryCall(mgr, 'Catalog.SetPrice', { params: { productId: 'p_kofta' }, body: { amount: '250', currency: 'EGP', branchId: 'branch_main', channel: 'DELIVERY', pinned: true } });
ok(sp.ok && sp.data.rule.pinned === true, `pinned override kofta delivery 250 → ${sp.ok ? 'ok' : sp.code}`);
const pv2 = (await call(mgr, 'Catalog.BulkPriceChange', { body: bulkBody(true, { change: { mode: 'PERCENT', value: '10' }, exclusions: {} }) })).data;
const kRow = pv2.rows.find((r: any) => r.productId === 'p_kofta');
ok(kRow?.skipped === 'PINNED', `next bulk skips the pinned kofta (${kRow?.skipped})`);
const pv3 = (await call(mgr, 'Catalog.BulkPriceChange', { body: bulkBody(true, { change: { mode: 'PERCENT', value: '10' }, exclusions: {}, includePinned: [kRow.key] }) })).data;
ok(!pv3.rows.find((r: any) => r.productId === 'p_kofta')?.skipped, 'explicitly included → it changes');
// a row unticked in the preview
const pv4 = (await call(mgr, 'Catalog.BulkPriceChange', { body: bulkBody(true, { change: { mode: 'PERCENT', value: '10' }, exclusions: { rowKeys: [pv2.rows.find((r: any) => r.productId === 'p_hummus').key] } }) })).data;
ok(pv4.rows.find((r: any) => r.productId === 'p_hummus')?.excluded === 'ROW', 'row unticked in the preview is excluded');
// a new own channel with no prices starts from the order type price
const tal2 = (await call(mgr, 'Catalog.BulkPriceChange', { body: { dryRun: true, filter: { salesChannelIds: ['sch_talabat'], branchIds: ['branch_main'] }, change: { mode: 'PERCENT', value: '20' }, rounding: { step: '1' } } })).data;
const humTal = tal2.rows.find((r: any) => r.productId === 'p_hummus');
const humDel = await q('p_hummus', { channel: 'DELIVERY' });
ok(humTal && !humTal.ownBefore && n(humTal.oldAmount) === n(humDel.unitTotal) && n(humTal.newAmount) === Math.round(n(humDel.unitTotal) * 1.2), `طلبات bulk on an item without own price starts from the delivery price: ${humTal?.oldAmount} → ${humTal?.newAmount}`);

// 5. per-user permission overrides
const before = await tryCall(cashier, 'Catalog.SetPrice', { params: { productId: 'p_tea' }, body: { amount: '26', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY' } });
ok(!before.ok && before.code === 'PERMISSION_DENIED', `cashier cannot set prices (role) → ${before.code}`);
const uCash = store.db.users.find((u: any) => u.username === 'demo-cashier-a')!;
const g = await tryCall(mgr, 'User.SetPermissionOverride', { params: { userId: uCash.id }, body: { permission: 'catalog:setprice', effect: 'GRANT', reason: 'مسؤولة الأسعار الليلة', expiresAt: new Date(clock.now() + 2 * 3_600_000).toISOString() } });
ok(g.ok, `manager grants catalog:setprice to سارة for 2h → ${g.ok ? 'ok' : g.code}`);
const after = await tryCall(cashier, 'Catalog.SetPrice', { params: { productId: 'p_tea' }, body: { amount: '26', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY' } });
ok(after.ok, `cashier now sets a price → ${after.ok ? 'ok' : after.code}`);
const r1 = await tryCall(mgr, 'User.SetPermissionOverride', { params: { userId: uCash.id }, body: { permission: 'report:run', effect: 'REVOKE', reason: 'مش محتاجة التقارير' } });
const me1 = (await call(cashier, 'Access.Me', {})).data.effectivePermissions as string[];
ok(r1.ok && !me1.includes('report:run') && me1.includes('-report:run') && me1.includes('catalog:setprice'), 'revoke report:run takes effect on the next request');
const ov = (await call(mgr, 'User.PermissionOverrides', { params: { userId: uCash.id } })).data;
ok(ov.overrides.filter((o: any) => o.state === 'ACTIVE').length === 2, `user page data: ${ov.overrides.map((o: any) => `${o.effect} ${o.permission} ${o.state}`).join(' | ')}`);
clock.advance(3 * 3_600_000);
const expired = await tryCall(cashier, 'Catalog.SetPrice', { params: { productId: 'p_tea' }, body: { amount: '27', currency: 'EGP', branchId: 'branch_main', channel: 'TAKEAWAY' } });
ok(!expired.ok && expired.code === 'PERMISSION_DENIED', `after expiry the grant is gone → ${expired.code}`);
clock.advance(-3 * 3_600_000);
const allPerms: string[] = (await call(owner, 'Permission.List', { query: { limit: 500 } })).data.items.map((p: any) => p.id);
const mgrPerms = new Set((await call(mgr, 'Access.Me', {})).data.effectivePermissions as string[]);
const notHeld = allPerms.find((p) => !mgrPerms.has(p) && !p.startsWith('vendor:'))!;
const esc = await tryCall(mgr, 'User.SetPermissionOverride', { params: { userId: uCash.id }, body: { permission: notHeld, effect: 'GRANT', reason: 'تجربة' } });
ok(!esc.ok && esc.code === 'PERMISSION_ESCALATION', `manager cannot hand out ${notHeld} (does not hold it) → ${esc.code}`);
const ven = await tryCall(owner, 'User.SetPermissionOverride', { params: { userId: uCash.id }, body: { permission: 'vendor:capabilities', effect: 'GRANT', reason: 'تجربة' } });
ok(!ven.ok && ven.code === 'VENDOR_ONLY_PERMISSION', `owner cannot hand out the vendor permission → ${ven.code}`);
const self = await tryCall(mgr, 'User.SetPermissionOverride', { params: { userId: store.db.users.find((u: any) => u.username === 'demo-manager-1')!.id }, body: { permission: 'report:run', effect: 'REVOKE', reason: 'تجربة' } });
ok(!self.ok && self.code === 'SELF_PERMISSION_CHANGE', `no self-edit → ${self.code}`);
const roleEsc = await tryCall(mgr, 'Role.Update', { params: { roleId: 'role_manager' }, body: { permissionIds: [...store.db.roles.find((r: any) => r.id === 'role_manager')!.permissionIds, '*'], expectedVersion: store.db.roles.find((r: any) => r.id === 'role_manager')!.version } });
ok(!roleEsc.ok && roleEsc.code === 'PERMISSION_ESCALATION', `manager cannot make their role a super-user → ${roleEsc.code}`);
ok(!store.db.roles.find((r: any) => r.id === 'role_manager')!.permissionIds.includes('*'), 'manager role has no "*"');
const ownerTarget = await tryCall(mgr, 'User.SetPermissionOverride', { params: { userId: 'u_owner' }, body: { permission: 'report:run', effect: 'REVOKE', reason: 'تجربة' } });
ok(!ownerTarget.ok && ownerTarget.code === 'PERMISSION_ESCALATION', `manager cannot change the owner → ${ownerTarget.code}`);
const audits = store.db.audit.filter((a: any) => /permission (granted|revoked)/.test(a.summary));
ok(audits.length >= 2 && audits.every((a: any) => a.sensitive), `audited: ${audits.map((a: any) => a.summary).join(' | ')}`);

// 6. vendor-only capabilities
const capOwner = (await call(owner, 'Capability.List', {})).data;
ok(capOwner.manage === false && !('title' in capOwner.items[0]), 'owner gets only which parts are present (no licensing view)');
const setOwner = await tryCall(owner, 'Profile.SetCapability', { params: { capability: capOwner.items[0].id }, body: { scopeType: 'TENANT', enabled: false } });
ok(!setOwner.ok && setOwner.code === 'PERMISSION_DENIED', `owner cannot switch a licensed module → ${setOwner.code}`);
const setMgr = await tryCall(mgr, 'Profile.SetCapability', { params: { capability: capOwner.items[0].id }, body: { scopeType: 'TENANT', enabled: false } });
ok(!setMgr.ok && setMgr.code === 'PERMISSION_DENIED', `manager (settings:updatepolicy) cannot either → ${setMgr.code}`);
const vendor = await as('BO', 'nerdpos-support');
const capV = (await call(vendor, 'Capability.List', {})).data;
const setV = await tryCall(vendor, 'Profile.SetCapability', { params: { capability: capV.items.find((c: any) => c.id === 'RESERVATIONS')?.id ?? capV.items[0].id }, body: { scopeType: 'TENANT', inherit: true } });
ok(capV.manage === true && 'title' in capV.items[0] && setV.ok, `vendor sees and manages licensed modules → ${setV.ok ? 'ok' : setV.code}`);
console.log(`\nR3C FAILURES: ${fails}`);
process.exit(0);
