// ux-12c headless check of the call board ↔ dispatch screen ↔ kitchen stations link (Kitchen.CallOrder, CallBoard.View,
// ticket transitions, CallBoardPolicy). Runs against the mock through fetch, like smoke.ts.
(globalThis as any).window = globalThis;
const { installMockFetch } = await import('../src/mock/fetch');
const { call, ApiFailure } = await import('../src/api/client');
const { demo } = await import('../src/mock/demo');
const { sim } = await import('../src/mock/sim');
const { clock } = await import('../src/mock/clock');
const { store } = await import('../src/mock/store');
installMockFetch();
demo.reset('DEMO');
sim.set({ latencyMs: 0 });
const PIN = demo.pin;
let passes = 0, failures = 0;
const ok = (cond: any, text: string) => { if (cond) { passes++; console.log('  ✓', text); } else { failures++; console.log('  ✗ FAIL', text); } };
const dev = (deviceId: string, terminalId: string | null) => ({ deviceId, label: deviceId, terminalId, branchId: null, token: null as string | null });
const T1 = dev('T1', 't_cash'), K1 = dev('K1', 't_kds'), K2 = dev('K2', 't_kds2'), T2 = dev('T2', 't_floor');
async function login(d: any, username: string) { const r = await call(d, 'Auth.Login', { body: { method: 'PIN', username, secret: PIN } }); d.token = r.data.token; }
async function code(p: Promise<any>): Promise<string> { try { await p; return 'OK'; } catch (e: any) { if (!(e instanceof ApiFailure)) throw e; return e.code; } }
const settle = () => new Promise((r) => setTimeout(r, 60));
const board = async () => (await call(K1, 'CallBoard.View', {})).data;
const where = async (orderId: string) => { const b = await board(); return b.ready.some((x: any) => x.orderId === orderId) ? 'READY' : b.preparing.some((x: any) => x.orderId === orderId) ? 'PREPARING' : 'NONE'; };
const tickets = async (orderId: string) => (await call(K1, 'Kitchen.Board', { query: { lifecycle: 'NEW,IN_PROGRESS,READY', limit: '500' } })).data.items.filter((t: any) => t.orderId === orderId && t.state !== 'DONE');
const advance = async (d: any, tk: any, to: string) => call(d, 'Kitchen.AdvanceTicket', { params: { ticketId: tk.id }, body: { expectedVersion: (store.db.tickets.find((x: any) => x.id === tk.id) as any).version, toState: to } });
const allReady = async (orderId: string) => { for (const tk of await tickets(orderId)) if (tk.state !== 'READY') await advance(K1, tk, 'READY'); };
const callOrder = (d: any, orderId: string, body: any = {}) => call(d, 'Kitchen.CallOrder', { params: { orderId }, body });
const setPolicy = (v: any) => demo.setPolicy('CallBoardPolicy', v);

await login(T1, 'demo-cashier-a'); await login(K1, 'demo-chef-1'); await login(K2, 'demo-chef-1'); await login(T2, 'demo-waiter-1');
await call(T1, 'Session.Open', { body: { terminalId: 't_cash', openingFloat: '500.00' } });
/** Fire a round: dine-in fires with «إرسال», takeaway / delivery fire when the check is confirmed (FireTimingPolicy). */
async function fire(d: any, o: any) {
  const c = await code(call(d, 'Order.Fire', { params: { orderId: o.id }, body: { expectedVersion: o.version } }));
  if (c === 'CAPABILITY_NOT_AVAILABLE') await call(d, 'Order.Confirm', { params: { orderId: o.id }, body: { expectedVersion: o.version } });
  else if (c !== 'OK') throw new Error('fire: ' + c);
}
async function order(channel: string, lines: any[], extra: any = {}) {
  let o = (await call(T1, 'Order.Create', { body: { channel, ...extra } })).data;
  o = (await call(T1, 'Order.AddLines', { params: { orderId: o.id }, body: { expectedVersion: o.version, lines } })).data;
  await fire(T1, o);
  await settle();
  return (await call(T1, 'Order.Get', { params: { orderId: o.id } })).data;
}
const TWO = [{ productId: 'p_kofta', quantity: '1', modifierOptionIds: ['opt_medium'] }, { productId: 'p_hummus', quantity: '1', modifierOptionIds: [] }];

console.log('\n== policy defaults');
const pol = (await call(K1, 'CallBoard.View', {})).data;
ok(pol.readyMinutes === 10 && pol.auto === false && pol.delivery === false, `CallBoardPolicy default: ready ${pol.readyMinutes} min, auto ${pol.auto}, delivery ${pol.delivery}`);

console.log('\n== takeaway across two stations');
let o = await order('TAKEAWAY', TWO);
let tks = await tickets(o.id);
ok(tks.length === 2 && new Set(tks.map((t: any) => t.stationId)).size === 2, `fired to two stations: ${tks.map((t: any) => t.stationName).join(' + ')}`);
ok(tks.every((t: any) => t.callable === true), 'tickets say the order is called by number (callable)');
ok(await where(o.id) === 'PREPARING', 'board: preparing');
await advance(K1, tks[0], 'READY');
ok(await code(callOrder(K1, o.id)) === 'KITCHEN_TRANSITION_INVALID', 'call refused while one station still cooks');
ok(await where(o.id) === 'PREPARING', 'board: still preparing with one station ready');
await allReady(o.id);
ok(await where(o.id) === 'PREPARING', 'manual mode: all ready but not called → preparing');
const grillScreen = await code(callOrder(K2, o.id));
ok(grillScreen === 'KDS_DISPATCH_ONLY', `a station screen (not dispatch) cannot call: ${grillScreen}`);
ok(await code(callOrder(K1, o.id)) === 'OK', 'dispatch calls the number');
ok(await where(o.id) === 'READY', 'board: ready');

console.log('\n== a called number goes back to preparing when the food goes back to the kitchen');
tks = await tickets(o.id);
await call(K1, 'Ticket.Recall', { params: { ticketId: tks[0].id }, body: {} });
ok(await where(o.id) === 'PREPARING', 'recall of a ready ticket → board: preparing');
tks = await tickets(o.id);
ok(tks.find((t: any) => t.id === tks[0].id)?.calledAt === null, 'the recalled ticket is no longer called');
await allReady(o.id);
ok(await where(o.id) === 'PREPARING', 'ready again → needs a new call');
await callOrder(K1, o.id);
ok(await where(o.id) === 'READY', 'called again → ready');

// item bump undo: marking the item done and then undoing it puts the ticket back to cooking
tks = await tickets(o.id);
const tk0 = tks[0];
const bump = () => call(K1, 'TicketItem.Bump', { params: { ticketId: tk0.id, itemId: tk0.items[0].lineId }, body: {} });
await bump(); await bump();
const st0 = (store.db.tickets.find((x: any) => x.id === tk0.id) as any).state;
ok(st0 === 'IN_PROGRESS', `item bump undone → ticket ${st0}`);
ok(await where(o.id) === 'PREPARING', 'item bump undone → board: preparing');
await allReady(o.id);
ok(await where(o.id) === 'PREPARING', 'ready again after the undo → needs a new call');
await callOrder(K1, o.id);

// refire after the call
tks = await tickets(o.id);
await call(K1, 'Ticket.Refire', { params: { ticketId: tks[0].id }, body: { reason: 'BURNT' } });
ok(await where(o.id) === 'PREPARING', 'refire after the call → board: preparing');
await allReady(o.id);
ok(await where(o.id) === 'PREPARING', 'refire ready → needs a new call');
await callOrder(K1, o.id);
ok(await where(o.id) === 'READY', 'called → ready');

// hand-off and undo
for (const tk of await tickets(o.id)) await advance(K1, tk, 'DONE');
ok(await where(o.id) === 'NONE', 'handed off → off the board');
const doneIds = store.db.tickets.filter((t: any) => t.orderId === o.id && t.state === 'DONE').map((t: any) => t.id);
for (const id of doneIds.slice(-1)) await call(K1, 'Ticket.Recall', { params: { ticketId: id }, body: { undo: true } });
ok(await where(o.id) === 'READY', 'hand-off undone → back on «ready» (it was called)');

console.log('\n== a second round after the call (counter dine-in fires each round)');
let cd = await order('DINE_IN', TWO.slice(0, 1));
await allReady(cd.id); await callOrder(K1, cd.id);
ok(await where(cd.id) === 'READY', 'counter dine-in round 1 called → ready');
cd = (await call(T1, 'Order.Get', { params: { orderId: cd.id } })).data;
cd = (await call(T1, 'Order.AddLines', { params: { orderId: cd.id }, body: { expectedVersion: cd.version, lines: [{ productId: 'p_hummus', quantity: '1', modifierOptionIds: [] }] } })).data;
await fire(T1, cd); await settle();
ok((await tickets(cd.id)).some((t: any) => t.round === 2), 'round 2 reached the kitchen');
ok(await where(cd.id) === 'PREPARING', 'round 2 fired after the call → board: preparing');
ok(await code(callOrder(K1, cd.id)) === 'KITCHEN_TRANSITION_INVALID', 'call refused while round 2 cooks');
await allReady(cd.id); await callOrder(K1, cd.id);
ok(await where(cd.id) === 'READY', 'round 2 ready and called → ready');

console.log('\n== voided food is not waited for and a voided order is not shown');
async function withGrant(run: (grant?: string) => Promise<any>) {
  try { return await run(); } catch (e: any) {
    if (!(e instanceof ApiFailure) || e.code !== 'APPROVAL_REQUIRED') throw e;
    const d: any = e.details;
    const g = (await call(T1, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: 'u_manager_1', approverCredentialKind: 'PIN', approverSecret: PIN } })).data;
    return run(g.grantId);
  }
}
let vo = await order('DINE_IN', TWO);
const hummus = vo.lines.find((l: any) => l.productId === 'p_hummus');
await withGrant(async (grant) => { const cur = (await call(T1, 'Order.Get', { params: { orderId: vo.id } })).data; return call(T1, 'Order.VoidLine', { params: { orderId: vo.id, lineId: hummus.id }, body: { expectedVersion: cur.version, reasonCode: 'WRONG_ITEM', ...(grant ? { approvalGrantId: grant } : {}) } }); });
const dead = (await tickets(vo.id)).filter((t: any) => t.items.every((i: any) => i.status === 'CANCELLED'));
ok(dead.length === 1, 'the cold station ticket now holds only a voided item');
for (const tk of (await tickets(vo.id)).filter((t: any) => !dead.includes(t))) await advance(K1, tk, 'READY');
ok(await code(callOrder(K1, vo.id)) === 'OK', 'the station whose only item was voided does not block the call');
ok(await where(vo.id) === 'READY', 'board: ready');
vo = await order('DINE_IN', TWO.slice(0, 1));
const voidRes = await code(withGrant(async (grant) => { const cur = (await call(T1, 'Order.Get', { params: { orderId: vo.id } })).data; const rc = (store.db.reasonCodes as any[]).find((r) => r.kind === 'ORDER_VOID' && r.active)?.code ?? 'CUSTOMER_LEFT'; return call(T1, 'Order.Void', { params: { orderId: vo.id }, body: { expectedVersion: cur.version, reasonCode: rc, reason: 'test', ...(grant ? { approvalGrantId: grant } : {}) } }); }));
const vs = (await call(T1, 'Order.Get', { params: { orderId: vo.id } })).data.status;
ok(vs === 'VOIDED' || vs === 'CANCELLED', `the whole check is voided (${voidRes}, ${vs})`);
ok(await where(vo.id) === 'NONE', 'voided check → off the board');
ok(await code(callOrder(K1, vo.id)) === 'KITCHEN_ORDER_NOT_CALLABLE', 'calling a voided check is refused');

console.log('\n== which orders are called by number');
const dine = await order('DINE_IN', TWO.slice(0, 1), {});
ok(await where(dine.id) === 'PREPARING', 'counter dine-in without a table is shown');
await login(T2, 'demo-waiter-1');
await call(T2, 'TableVisit.Open', { params: { tableId: 'tbl_9' }, body: { guestCount: 2 } }).catch(() => null);
let tbl = (await call(T2, 'Order.Create', { body: { channel: 'DINE_IN', tableId: 'tbl_9' } })).data;
tbl = (await call(T2, 'Order.AddLines', { params: { orderId: tbl.id }, body: { expectedVersion: tbl.version, lines: TWO.slice(0, 1) } })).data;
await fire(T2, tbl); await settle();
ok(await where(tbl.id) === 'NONE', 'a table check is served at the table → not shown');
ok((await tickets(tbl.id)).every((t: any) => t.callable === false), 'its tickets are not callable');
await allReady(tbl.id);
ok(await code(callOrder(K1, tbl.id)) === 'KITCHEN_ORDER_NOT_CALLABLE', 'calling a table check is refused');

const cu = (store.db.customers as any[]).filter((x) => x.addresses[0]?.zoneId)[0];
let del = (await call(T1, 'Order.Create', { body: { channel: 'DELIVERY', customerId: cu.id } })).data;
del = (await call(T1, 'Order.AddLines', { params: { orderId: del.id }, body: { expectedVersion: del.version, lines: TWO.slice(0, 1) } })).data;
const addr = cu.addresses[0];
await call(T1, 'Delivery.Create', { body: { orderId: del.id, customerId: cu.id, address: addr, zoneId: addr.zoneId, paymentMode: 'CASH_ON_DELIVERY' } });
del = (await call(T1, 'Order.Get', { params: { orderId: del.id } })).data;
await call(T1, 'Order.Confirm', { params: { orderId: del.id }, body: { expectedVersion: del.version } }); await settle();
ok((await tickets(del.id)).length > 0, 'the delivery order reached the kitchen');
ok(await where(del.id) === 'NONE', 'delivery orders are not on the guests\' board by default');
ok((await tickets(del.id)).every((t: any) => t.callable === false), 'delivery tickets are not callable by default');
await allReady(del.id);
ok(await code(callOrder(K1, del.id)) === 'KITCHEN_ORDER_NOT_CALLABLE', 'calling a delivery order is refused by default');
setPolicy({ readyMinutes: 10, call: 'MANUAL', delivery: true });
ok((await tickets(del.id)).every((t: any) => t.callable === true), 'CallBoardPolicy.delivery = true → delivery tickets callable');
ok(await code(callOrder(K1, del.id)) === 'OK', 'and the dispatch screen can call it');
ok(await where(del.id) === 'READY', 'the delivery number shows on the board');
setPolicy({ readyMinutes: 10, call: 'MANUAL', delivery: false });

const staff = store.db.orders.find((x: any) => x.kind === 'STAFF_MEAL');
if (staff) ok(await code(callOrder(K1, staff.id)) === 'KITCHEN_ORDER_NOT_CALLABLE' || (await code(callOrder(K1, staff.id))) === 'VALIDATION_FAILED', 'a staff meal is never called');

console.log('\n== policy: automatic call and ready minutes');
o = await order('TAKEAWAY', TWO.slice(0, 1));
await allReady(o.id);
ok(await where(o.id) === 'PREPARING', 'MANUAL: ready but not called → preparing');
setPolicy({ readyMinutes: 3, call: 'AUTO', delivery: false });
ok(await where(o.id) === 'READY', 'AUTO: every station ready → ready without a call');
clock.advance(4 * 60000);
ok(await where(o.id) === 'NONE', 'after readyMinutes (3) the number leaves the board');
clock.advance(-4 * 60000);
setPolicy({ readyMinutes: 10, call: 'MANUAL', delivery: false });

console.log(`\nPASSES: ${passes}  FAILURES: ${failures}`);
process.exit(0);
