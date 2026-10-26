// Online / aggregator orders: an adapter callback drops orders into an inbox; staff accept (with a prep time)
// or reject. Accepting creates the real check, maps external items to the menu, fires it to the kitchen,
// opens the delivery (or a pickup check) and records an app-paid order as paid.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event, hist } from '../store';
import { D, m4, isMoney } from '../money';
import { checkVersion, need, openSessionOn, page, requireFields, settlementOf, userName } from './util';
import { subCall, deliveriesOf } from './delivery';
import { deliveryHandlers } from './delivery';
import { findOrCreateCustomer, zoneForArea, normPhone } from './customers';
import { priceRuleAt } from '../pricing';
import type { Capture } from '../types';
import type { ExternalOrder, ExternalSource } from '../types-crm';

export const SOURCES: Record<ExternalSource, { ar: string; en: string; color: string }> = {
  APP_1: { ar: 'تطبيق التوصيل ١', en: 'Delivery app 1', color: '#f97316' },
  APP_2: { ar: 'تطبيق التوصيل ٢', en: 'Delivery app 2', color: '#22c55e' },
  WEBSITE: { ar: 'الموقع', en: 'Website', color: '#38bdf8' },
  WHATSAPP: { ar: 'واتساب', en: 'WhatsApp', color: '#4ade80' },
};
const extOf = (db: Ctx['db']) => (db.externalOrders ??= []);
const mapOf = (db: Ctx['db']) => (db.channelItemMap ??= []);
const mapped = (db: Ctx['db'], source: ExternalSource, code: string) => mapOf(db).find((m) => m.source === source && m.code === code)?.productId ?? null;

function extView(ctx: Ctx, e: ExternalOrder) {
  const db = ctx.db;
  const items = e.items.map((it) => {
    const pid = it.productId ?? mapped(db, e.source, it.code);
    const p = pid ? db.products.find((x) => x.id === pid) : null;
    const ch = e.fulfillment === 'DELIVERY' ? 'DELIVERY' : 'TAKEAWAY';
    const rule = p ? priceRuleAt(db, p.id, e.branchId, ch, ctx.now) : null;
    return { ...it, productId: pid, productName: p?.name ?? null, ourPrice: rule?.amount ?? null };
  });
  const order = e.orderId ? db.orders.find((o) => o.id === e.orderId) : null;
  const delivery = e.deliveryId ? deliveriesOf(db).find((d) => d.id === e.deliveryId) : null;
  const ageMinutes = Math.max(0, Math.floor((ctx.now - e.receivedAtMs) / 60000));
  const zone = e.customer.address ? zoneForArea(db, e.customer.address.area) : null;
  return {
    ...e, items, sourceLabel: SOURCES[e.source], ageMinutes, waitingTooLong: e.state === 'NEW' && ageMinutes >= 5, unmapped: items.filter((i) => !i.productId).length,
    zone: zone ? { id: zone.id, name: zone.name, etaMinutes: zone.etaMinutes } : null, areaCovered: e.fulfillment === 'PICKUP' || !!zone,
    order: order ? { id: order.id, number: order.number, status: order.status } : null, delivery: delivery ? { id: delivery.id, number: delivery.number, state: delivery.state } : null,
    acceptedByName: e.acceptedBy ? userName(db, e.acceptedBy) : null,
  };
}

// ── simulated incoming orders (the "simulate" button and Channel.IngestExternalOrder with simulate:true)
const SIM_PEOPLE = [
  ['هاني فوزي', '01014725836', 'الحي العاشر', 'شارع مكرم عبيد', '18', '6', '22', 'فوق صيدلية سيف'],
  ['ندى سامح', '01236925814', 'الكوربة', 'شارع الأهرام', '9', '3', '5', 'جنب كنيسة البازيليك'],
  ['محمد عصام', '01151478963', 'الحي السابع', 'شارع حسن المأمون', '44', '2', '8', 'قدام نادي السكة'],
  ['آية مجدي', '01098741236', 'روكسي', 'شارع الخليفة المأمون', '61', '5', '19', 'جنب مول روكسي'],
  ['عبد الله رضا', '01556987412', 'مكرم عبيد', 'شارع مكرم عبيد', '102', '8', '31', 'فوق فودافون'],
  ['سلمى حاتم', '01274185296', 'دجلة', 'شارع 233', '15', '1', '3', 'قدام كافيه بيانو'],
];
const SIM_MENUS: Record<ExternalSource, [string, string, string][]> = {
  APP_1: [['A1-SHAW-CH', 'Chicken Shawarma Plate', '155'], ['A1-KOFTA', 'Kofta Grill', '225'], ['A1-HUMMUS', 'Hummus', '62'], ['A1-BURGER', 'Beef Burger', '185'], ['A1-COLA', 'Cola Can', '25']],
  APP_2: [['X2-778', 'شاورما فراخ', '152'], ['X2-912', 'أم علي', '72'], ['X2-430', 'مشويات مشكلة', '330']],
  WEBSITE: [['WEB-KOFTA', 'كفتة مشوية', '220'], ['WEB-SALAD', 'سلطة خضراء', '55'], ['WEB-OJ', 'عصير برتقال فريش', '45']],
  WHATSAPP: [['WA-SHAW', 'شاورما فراخ', '150'], ['WA-GRILL', 'مشكل مشويات', '320']],
};
function simulated(db: Ctx['db'], source: ExternalSource, n: number) {
  const who = SIM_PEOPLE[n % SIM_PEOPLE.length];
  const menu = SIM_MENUS[source];
  const picks = [menu[n % menu.length], menu[(n + 2) % menu.length]].filter((v, i, a) => a.indexOf(v) === i);
  const items = picks.map(([code, name, price], i) => ({ code, name, quantity: String(i === 0 ? 1 + (n % 2) : 1), unitPrice: m4(price) }));
  const total = items.reduce((a, it) => a.plus(D(it.unitPrice).times(it.quantity)), D(0));
  const pickup = source === 'WEBSITE' && n % 3 === 0;
  return {
    externalRef: `${source === 'APP_1' ? 'A1' : source === 'APP_2' ? 'X2' : source === 'WEBSITE' ? 'WEB' : 'WA'}-${String(60000 + n * 137).slice(-5)}`,
    customer: { name: who[0], phone: who[1], address: pickup ? null : { area: who[2], street: who[3], building: who[4], floor: who[5], apartment: who[6], landmark: who[7] } },
    fulfillment: pickup ? 'PICKUP' : 'DELIVERY', payment: source === 'APP_1' || source === 'APP_2' ? (n % 3 === 1 ? 'CASH_ON_DELIVERY' : 'PAID_ONLINE') : 'CASH_ON_DELIVERY',
    items, sourceTotal: m4(total.plus(pickup ? 0 : 20)), note: n % 2 ? 'الجرس بايظ — كلّمني لما توصل' : null,
  };
}

export const channelHandlers: Record<string, Handler> = {
  // POST /channels/{channel}/orders — the aggregator adapter (simulated: body.simulate = true).
  'Channel.IngestExternalOrder': (ctx) => {
    const db = ctx.db;
    const source = ctx.params.channel as ExternalSource;
    need(SOURCES[source], 'ORDER_CHANNEL_UNAVAILABLE', { channel: source, allowed: Object.keys(SOURCES) });
    db.seq['ext_sim'] = (db.seq['ext_sim'] ?? 0) + 1;
    const b = ctx.body.simulate ? simulated(db, source, db.seq['ext_sim'] + extOf(db).length) : ctx.body;
    requireFields({ ...ctx, body: b } as Ctx, 'externalRef', 'customer', 'items');
    const dupe = extOf(db).find((e) => e.source === source && e.externalRef === b.externalRef);
    if (dupe) return { status: 200, body: { ...extView(ctx, dupe), duplicate: true } };
    need(Array.isArray(b.items) && b.items.length, 'VALIDATION_FAILED', { field: 'items' });
    for (const it of b.items) need(it.code && it.name && isMoney(String(it.quantity ?? '1')) && isMoney(String(it.unitPrice ?? '0')), 'VALIDATION_FAILED', { field: 'items', item: it.code });
    const e: ExternalOrder = {
      id: nextId('ext'), branchId: ctx.branchId ?? 'branch_main', source, externalRef: String(b.externalRef), receivedAt: ctx.nowIso, receivedAtMs: ctx.now,
      customer: { name: String(b.customer.name ?? 'عميل أونلاين'), phone: normPhone(b.customer.phone), address: b.customer.address ?? null },
      fulfillment: b.fulfillment === 'PICKUP' ? 'PICKUP' : 'DELIVERY', payment: b.payment === 'PAID_ONLINE' ? 'PAID_ONLINE' : 'CASH_ON_DELIVERY',
      items: b.items.map((it: any) => ({ code: String(it.code), name: String(it.name), quantity: String(it.quantity ?? '1'), unitPrice: m4(it.unitPrice ?? '0'), note: it.note ?? null, productId: mapped(db, source, String(it.code)) })),
      sourceTotal: m4(b.sourceTotal ?? '0'), note: b.note ?? null, state: 'NEW', version: 1,
    };
    extOf(db).unshift(e);
    event('ExternalOrderReceived', e.id, `${source} ${e.externalRef}`);
    return { status: 201, body: extView(ctx, e) };
  },
  'ExternalOrder.Find': (ctx) => {
    let list = extOf(ctx.db).filter((e) => !ctx.branchId || e.branchId === ctx.branchId);
    if (ctx.query.state) list = list.filter((e) => ctx.query.state.split(',').includes(e.state));
    const views = list.sort((a, b) => b.receivedAtMs - a.receivedAtMs).map((e) => extView(ctx, e));
    return { ...page(views, ctx.query), counts: { NEW: views.filter((v) => v.state === 'NEW').length, ACCEPTED: views.filter((v) => v.state === 'ACCEPTED').length, REJECTED: views.filter((v) => v.state === 'REJECTED').length }, sources: SOURCES };
  },
  'ChannelItemMap.Set': (ctx) => {
    const db = ctx.db;
    const source = ctx.params.source as ExternalSource;
    need(SOURCES[source], 'VALIDATION_FAILED', { field: 'source' });
    requireFields(ctx, 'productId');
    const p = db.products.find((x) => x.id === ctx.body.productId && x.active);
    if (!p) throw new ApiError('CATALOG_PRODUCT_NOT_FOUND', { productId: ctx.body.productId });
    const m = mapOf(db).find((x) => x.source === source && x.code === ctx.params.code);
    if (m) Object.assign(m, { productId: p.id, updatedAt: ctx.nowIso, by: ctx.user!.id });
    else mapOf(db).push({ source, code: ctx.params.code, productId: p.id, updatedAt: ctx.nowIso, by: ctx.user!.id });
    for (const e of extOf(db).filter((x) => x.source === source && x.state === 'NEW')) for (const it of e.items) if (it.code === ctx.params.code) { it.productId = p.id; e.version++; }
    return { source, code: ctx.params.code, productId: p.id, productName: p.name };
  },
  'ExternalOrder.Reject': (ctx) => {
    const e = extOf(ctx.db).find((x) => x.id === ctx.params.externalOrderId);
    if (!e) throw new ApiError('EXTERNAL_ORDER_NOT_FOUND');
    if (e.state !== 'NEW') throw new ApiError('EXTERNAL_ORDER_NOT_NEW', { state: e.state });
    if (ctx.body.expectedVersion !== undefined) checkVersion(e, ctx.body.expectedVersion);
    requireFields(ctx, 'reason');
    e.state = 'REJECTED'; e.rejectedAt = ctx.nowIso; e.rejectReason = String(ctx.body.reason); e.version++;
    ctx.audit(`external order ${e.source} ${e.externalRef} rejected: ${e.rejectReason}`, e.id);
    return extView(ctx, e);
  },
  'ExternalOrder.Accept': (ctx) => {
    const db = ctx.db;
    const e = extOf(db).find((x) => x.id === ctx.params.externalOrderId);
    if (!e) throw new ApiError('EXTERNAL_ORDER_NOT_FOUND');
    if (e.state !== 'NEW') throw new ApiError('EXTERNAL_ORDER_NOT_NEW', { state: e.state });
    if (ctx.body.expectedVersion !== undefined) checkVersion(e, ctx.body.expectedVersion);
    const prep = Number(ctx.body.prepMinutes);
    need(Number.isInteger(prep) && prep >= 5 && prep <= 120, 'VALIDATION_FAILED', { field: 'prepMinutes', rule: '5..120' });
    const missing = e.items.filter((it) => !(it.productId ?? mapped(db, e.source, it.code)));
    if (missing.length) throw new ApiError('EXTERNAL_ITEM_NOT_MAPPED', { codes: missing.map((m) => m.code), names: missing.map((m) => m.name) });
    if (!openSessionOn(db, ctx.terminal?.id)) throw new ApiError('SESSION_NOT_OPEN', { reason: 'online orders are accepted on a terminal with an open drawer' });
    const src = SOURCES[e.source];
    const cust = findOrCreateCustomer(ctx, { name: e.customer.name, phone: e.customer.phone, address: e.customer.address ?? null, source: 'ONLINE' });
    const channel = e.fulfillment === 'DELIVERY' ? 'DELIVERY' : 'TAKEAWAY';
    let o = subCall(ctx, 'Order.Create', {}, { channel, customerId: cust?.id, label: `${src.ar} ${e.externalRef}`, note: e.note ?? undefined });
    const order = db.orders.find((x) => x.id === o.id)!;
    if (!cust) { order.customerName = e.customer.name; order.customerPhone = e.customer.phone; }
    order.externalOrderId = e.id;
    const lines = e.items.map((it) => {
      const pid = (it.productId ?? mapped(db, e.source, it.code))!;
      const p = db.products.find((x) => x.id === pid)!;
      // required single choices (size, doneness) take the first option; the kitchen sees the app's item name
      const mods = p.modifierGroupIds.map((g) => db.modifierGroups.find((x) => x.id === g)).filter((g) => g && g.min > 0).flatMap((g) => g!.options.filter((x) => x.active).slice(0, g!.min).map((x) => x.id));
      return { productId: pid, quantity: it.quantity, modifierOptionIds: mods, note: [it.note, it.name !== p.name.ar && it.name !== p.name.en ? `(${it.name})` : null].filter(Boolean).join(' ') || undefined };
    });
    o = subCall(ctx, 'Order.AddLines', { orderId: order.id }, { expectedVersion: order.version, lines });
    let deliveryId: string | null = null;
    if (channel === 'DELIVERY') {
      if (!e.customer.address) throw new ApiError('VALIDATION_FAILED', { field: 'customer.address', rule: 'a delivery order needs an address' });
      const dv = (deliveryHandlers['Delivery.Create'] as any)({ ...ctx, params: {}, query: {}, body: { orderId: order.id, address: e.customer.address, customerId: cust?.id, customerName: e.customer.name, phone: e.customer.phone, paymentMode: e.payment === 'PAID_ONLINE' ? 'PAID_ONLINE' : 'CASH_ON_DELIVERY', source: 'ONLINE', sourceLabel: src.ar, externalOrderId: e.id, prepMinutes: prep, skipMinimum: true, note: e.note } });
      deliveryId = (dv.body ?? dv).id;
    }
    subCall(ctx, 'Order.Confirm', { orderId: order.id }, { expectedVersion: order.version });
    if (e.payment === 'PAID_ONLINE') {
      const s = openSessionOn(db, ctx.terminal?.id)!;
      const remaining = settlementOf(db, order).remaining;
      const c: Capture = { id: nextId('cap'), orderId: order.id, method: 'ONLINE', amount: remaining, tendered: null, change: '0.0000', reference: e.externalRef, walletProvider: src.ar, sessionId: s.id, terminalId: ctx.terminal?.id ?? '', branchId: order.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(order.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', rounding: '0.0000' };
      db.captures.push(c);
      order.version++;
      order.history.push(hist(ctx.user!.id, 'CAPTURED', { ar: `مدفوع على ${src.ar} (${e.externalRef}) — ${m4(remaining)}`, en: `paid on ${src.en} ${remaining}` }, null, ctx.terminal?.code));
    }
    e.state = 'ACCEPTED'; e.acceptedAt = ctx.nowIso; e.acceptedBy = ctx.user!.id; e.prepMinutes = prep; e.orderId = order.id; e.deliveryId = deliveryId; e.customerId = cust?.id ?? null; e.version++;
    ctx.audit(`external order ${e.source} ${e.externalRef} accepted → ${order.number}`, e.id);
    event('ExternalOrderAccepted', e.id, `${e.externalRef} → ${order.number}`);
    return extView(ctx, e);
  },
};
