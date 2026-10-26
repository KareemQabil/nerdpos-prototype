// Customers: phone lookup (Egyptian mobile), duplicates, Egyptian-style addresses, order history, merge.
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event } from '../store';
import { computeTotals } from '../pricing';
import { D, m4 } from '../money';
import { checkVersion, need, page, requireFields } from './util';
import { loyaltySummary, addLoyaltyEntry, balanceOf } from './loyalty';
import type { DB, Order } from '../types';
import type { Customer, CustomerAddress, AddressSnapshot } from '../types-crm';

export const custs = (db: DB) => (db.customers ??= []);
export const PHONE_RE = /^01[0125]\d{8}$/;
const LANDLINE_RE = /^0[2-9]\d{7,9}$/;

/** Digits only: Arabic-Indic digits, spaces, dashes and the +20 / 0020 country prefix are normalised. */
export function normPhone(raw: unknown): string {
  let s = String(raw ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[^\d+]/g, '');
  if (s.startsWith('+20')) s = '0' + s.slice(3);
  else if (s.startsWith('0020')) s = '0' + s.slice(4);
  else if (s.startsWith('20') && s.length === 12) s = '0' + s.slice(2);
  return s.replace(/\+/g, '');
}
/** Arabic-insensitive text for search and duplicate detection. */
export function arNorm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
}
const nameKey = (n: string) => arNorm(n).replace(/^(ا\.|أ\.|م\.|د\.)\s*/, '').split(' ').slice(0, 2).join(' ');

export function getCustomer(ctx: { db: DB }, id: string | null | undefined): Customer {
  const c = custs(ctx.db).find((x) => x.id === id);
  if (!c) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: id });
  return c;
}

function validatePhone(raw: unknown, field = 'phone', allowLandline = false): string {
  const p = normPhone(raw);
  if (!PHONE_RE.test(p) && !(allowLandline && LANDLINE_RE.test(p))) throw new ApiError('CUSTOMER_PHONE_INVALID', { field, value: String(raw ?? ''), rule: '01[0125]xxxxxxxx' });
  return p;
}
function assertPhoneFree(db: DB, phone: string, exceptId?: string) {
  const other = custs(db).find((c) => c.active && c.id !== exceptId && (c.phone === phone || c.altPhone === phone));
  if (other) throw new ApiError('CUSTOMER_PHONE_TAKEN', { customerId: other.id, name: other.name, code: other.code });
}

export function zoneForArea(db: DB, area: string | undefined | null) {
  const a = arNorm(area);
  return (db.deliveryZones ?? []).find((z) => z.areas.some((x) => arNorm(x) === a)) ?? null;
}

function cleanAddress(db: DB, a: any): AddressSnapshot {
  const area = String(a?.area ?? '').trim();
  const street = String(a?.street ?? '').trim();
  if (!area) throw new ApiError('VALIDATION_FAILED', { field: 'address.area', rule: 'required' });
  if (!street) throw new ApiError('VALIDATION_FAILED', { field: 'address.street', rule: 'required' });
  const z = a?.zoneId ? (db.deliveryZones ?? []).find((x) => x.id === a.zoneId) ?? null : zoneForArea(db, area);
  const opt = (k: string) => (a?.[k] === undefined || a?.[k] === null || String(a[k]).trim() === '' ? undefined : String(a[k]).trim().slice(0, 120));
  return { area, street: street.slice(0, 160), building: opt('building'), floor: opt('floor'), apartment: opt('apartment'), landmark: opt('landmark'), notes: opt('notes'), zoneId: z?.id ?? null, city: opt('city') ?? 'القاهرة' };
}

/** Orders, spend and last order of a customer (live orders plus seed history before the system existed). */
export function customerStats(db: DB, c: Customer) {
  const orders = db.orders.filter((o) => o.customerId === c.id && o.status !== 'CANCELLED' && o.status !== 'VOIDED' && o.status !== 'MERGED');
  const done = orders.filter((o) => o.status === 'COMPLETED');
  const live = done.reduce((a, o) => a.plus(D(computeTotals(o).payable)), D(0));
  const lastLive = orders.reduce<string | null>((a, o) => (!a || o.createdAt > a ? o.createdAt : a), null);
  const h = c.history;
  const ordersCount = orders.length + (h?.orders ?? 0);
  const spent = m4(live.plus(D(h?.spent ?? 0)));
  const last = [lastLive, h?.lastOrderAt ?? null].filter(Boolean).sort().at(-1) ?? null;
  return { orders: ordersCount, spent, lastOrderAt: last, average: ordersCount ? m4(D(spent).dividedBy(ordersCount)) : '0.0000', favourite: h?.favourite ?? null, openOrders: orders.filter((o) => o.status === 'DRAFT' || o.status === 'CONFIRMED').length };
}

function possibleDuplicates(db: DB, c: Customer) {
  const key = nameKey(c.name);
  const addrKey = (a: CustomerAddress) => arNorm(`${a.area}|${a.street}|${a.building ?? ''}`);
  const mine = new Set(c.addresses.filter((a) => a.active).map(addrKey));
  return custs(db).filter((o) => o.active && o.id !== c.id && (nameKey(o.name) === key || o.addresses.some((a) => a.active && mine.has(addrKey(a))))).map((o) => ({ id: o.id, name: o.name, phone: o.phone, code: o.code }));
}

export function customerView(db: DB, c: Customer, full = false) {
  const base = { ...c, addresses: c.addresses.filter((a) => a.active), stats: customerStats(db, c), loyalty: loyaltySummary(db, c.id) };
  if (!full) return base;
  const orders = db.orders.filter((o) => o.customerId === c.id).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 30).map((o) => orderBrief(db, o));
  const deliveries = (db.deliveries ?? []).filter((d) => d.customerId === c.id).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 30)
    .map((d) => ({ id: d.id, number: d.number, orderNumber: d.orderNumber, state: d.state, amount: d.amount, fee: d.fee, zoneName: d.zoneName, createdAt: d.createdAt, deliveredAt: d.deliveredAt ?? null, historical: !!d.historical, paymentMode: d.paymentMode, driverName: (db.drivers ?? []).find((x) => x.id === d.driverId)?.name ?? null }));
  return { ...base, orders, deliveries, duplicates: possibleDuplicates(db, c), mergedFrom: custs(db).filter((x) => x.mergedInto === c.id).map((x) => ({ id: x.id, name: x.name, phone: x.phone })) };
}

function orderBrief(db: DB, o: Order) {
  const tt = computeTotals(o);
  return { id: o.id, number: o.number, channel: o.channel, status: o.status, createdAt: o.createdAt, payable: tt.payable, items: o.lines.filter((l) => l.status === 'ACTIVE').map((l) => `${l.name.ar} ×${l.quantity}`).join('، '), itemsEn: o.lines.filter((l) => l.status === 'ACTIVE').map((l) => `${l.name.en || l.name.ar} ×${l.quantity}`).join(', '), deliveryId: o.deliveryId ?? null };
}

/** Order.SetCustomer / Order.Create: the customer is snapshotted on the check (name and phone). */
export function setOrderCustomer(ctx: { db: DB }, o: Order, customerId: string | null) {
  if (!customerId) { o.customerId = null; o.customerPhone = null; o.customerName = undefined; return null; }
  const c = getCustomer(ctx, customerId);
  if (!c.active) throw new ApiError('CUSTOMER_INACTIVE', { customerId, mergedInto: c.mergedInto });
  o.customerId = c.id; o.customerName = c.name; o.customerPhone = c.phone;
  return c;
}

/** Find by phone or create (used by the call center and the online-orders inbox). */
export function findOrCreateCustomer(ctx: Ctx, input: { name: string; phone: string; address?: AddressSnapshot | null; source: Customer['source'] }) {
  const phone = normPhone(input.phone);
  const existing = custs(ctx.db).find((c) => c.active && (c.phone === phone || c.altPhone === phone));
  if (existing) return existing;
  if (!PHONE_RE.test(phone)) return null;
  return createCustomer(ctx, { name: input.name, phone, address: input.address ?? undefined, source: input.source });
}

function createCustomer(ctx: Ctx, b: any): Customer {
  const db = ctx.db;
  const name = String(b.name ?? '').trim();
  if (!name || name.length > 80) throw new ApiError('VALIDATION_FAILED', { field: 'name', rule: '1..80 characters' });
  const phone = b.phone ? validatePhone(b.phone) : '';
  if (phone) assertPhoneFree(db, phone);
  const altPhone = b.altPhone ? validatePhone(b.altPhone, 'altPhone', true) : null;
  db.seq['customer_code'] = (db.seq['customer_code'] ?? custs(db).length) + 1;
  const c: Customer = {
    id: nextId('cus'), code: `C-${String(db.seq['customer_code']).padStart(4, '0')}`, name, phone, altPhone, email: b.email ? String(b.email).trim() : null,
    notes: b.notes ? String(b.notes).slice(0, 300) : null, allergies: Array.isArray(b.allergies) ? b.allergies.map(String) : [], tags: Array.isArray(b.tags) ? b.tags.map(String) : ['NEW'],
    addresses: [], createdAt: ctx.nowIso, createdBy: ctx.user?.id ?? 'system', version: 1, active: true, mergedInto: null, source: b.source ?? (ctx.terminal?.kind === 'CASH' ? 'CALL_CENTER' : 'POS'),
  };
  if (b.address) c.addresses.push({ ...cleanAddress(db, b.address), id: nextId('adr'), label: b.address.label ?? 'البيت', active: true, isDefault: true, version: 1, createdAt: ctx.nowIso });
  custs(db).push(c);
  ctx.audit(`customer ${c.code} created`, c.id);
  event('CustomerCreated', c.id, `${c.code} ${c.name}`);
  return c;
}

export const customerHandlers: Record<string, Handler> = {
  'Customer.Create': (ctx) => {
    requireFields(ctx, 'name');
    const c = createCustomer(ctx, ctx.body);
    return { status: 201, body: customerView(ctx.db, c, true) };
  },
  'Customer.Get': (ctx) => customerView(ctx.db, getCustomer(ctx, ctx.params.customerId), true),
  'Customer.Search': (ctx) => {
    const q = ctx.query;
    let list = custs(ctx.db).filter((c) => (q.includeMerged === 'true' ? true : c.active));
    if (q.phone) {
      const p = normPhone(q.phone);
      if (p) list = list.filter((c) => c.phone.includes(p) || (c.altPhone ?? '').includes(p));
    }
    if (q.text) {
      const s = arNorm(q.text);
      list = list.filter((c) => arNorm([c.name, c.code, c.notes, c.email, ...c.tags, ...c.addresses.map((a) => `${a.area} ${a.street} ${a.landmark ?? ''}`)].join(' ')).includes(s) || c.phone.includes(s));
    }
    if (q.tag) list = list.filter((c) => c.tags.includes(q.tag));
    const views = list.map((c) => customerView(ctx.db, c));
    const sort = q.sort ?? 'RECENT';
    views.sort((a, b) =>
      sort === 'NAME' ? a.name.localeCompare(b.name, 'ar') :
      sort === 'SPENT' ? D(b.stats.spent).comparedTo(D(a.stats.spent)) :
      sort === 'POINTS' ? b.loyalty.balance - a.loyalty.balance :
      (b.stats.lastOrderAt ?? b.createdAt).localeCompare(a.stats.lastOrderAt ?? a.createdAt));
    return page(views, q);
  },
  'Customer.Update': (ctx) => {
    const c = getCustomer(ctx, ctx.params.customerId);
    if (!c.active) throw new ApiError('CUSTOMER_INACTIVE', { mergedInto: c.mergedInto });
    requireFields(ctx, 'name');
    checkVersion(c, ctx.body.expectedVersion);
    const b = ctx.body;
    const name = String(b.name).trim();
    need(name.length <= 80, 'VALIDATION_FAILED', { field: 'name', rule: 'at most 80 characters' });
    if (b.phone !== undefined && b.phone !== c.phone) {
      const p = b.phone ? validatePhone(b.phone) : '';
      if (p) assertPhoneFree(ctx.db, p, c.id);
      c.phone = p;
    }
    if (b.altPhone !== undefined) c.altPhone = b.altPhone ? validatePhone(b.altPhone, 'altPhone', true) : null;
    c.name = name;
    if (b.email !== undefined) c.email = b.email ? String(b.email).trim() : null;
    if (b.notes !== undefined) c.notes = b.notes ? String(b.notes).slice(0, 300) : null;
    if (Array.isArray(b.allergies)) c.allergies = b.allergies.map(String);
    if (Array.isArray(b.tags)) c.tags = [...new Set(b.tags.map(String))] as string[];
    c.version++;
    ctx.audit(`customer ${c.code} updated`, c.id, true);
    return customerView(ctx.db, c, true);
  },
  'CustomerAddress.Upsert': (ctx) => {
    const c = getCustomer(ctx, ctx.params.customerId);
    if (!c.active) throw new ApiError('CUSTOMER_INACTIVE', { mergedInto: c.mergedInto });
    need(ctx.body.active !== undefined, 'VALIDATION_FAILED', { field: 'active', rule: 'required' });
    let a = c.addresses.find((x) => x.id === ctx.params.addressId);
    if (a) {
      if (ctx.body.expectedVersion !== undefined) checkVersion(a, ctx.body.expectedVersion);
      if (ctx.body.active === false) { a.active = false; if (a.isDefault) { a.isDefault = false; const next = c.addresses.find((x) => x.active); if (next) next.isDefault = true; } }
      else Object.assign(a, cleanAddress(ctx.db, ctx.body.address), { label: ctx.body.label ?? a.label, active: true });
      a.version++;
    } else {
      if (ctx.body.active === false) throw new ApiError('CUSTOMER_ADDRESS_NOT_FOUND', { addressId: ctx.params.addressId });
      const id = /^adr_[\w-]+$/.test(ctx.params.addressId) && ctx.params.addressId !== 'new' ? ctx.params.addressId : nextId('adr');
      a = { ...cleanAddress(ctx.db, ctx.body.address), id, label: ctx.body.label ?? 'عنوان', active: true, isDefault: !c.addresses.some((x) => x.active), version: 1, createdAt: ctx.nowIso };
      c.addresses.push(a);
    }
    if (ctx.body.isDefault === true && a.active) for (const x of c.addresses) x.isDefault = x.id === a.id;
    c.version++;
    return { ...a, customerId: c.id, customerVersion: c.version, zoneName: (ctx.db.deliveryZones ?? []).find((z) => z.id === a!.zoneId)?.name ?? null };
  },
  // POST /customers/{customerId}/merge {sourceCustomerId}: the source folds into this customer (survivor).
  'Customer.Merge': (ctx) => {
    const db = ctx.db;
    const target = getCustomer(ctx, ctx.params.customerId);
    requireFields(ctx, 'sourceCustomerId');
    const src = getCustomer(ctx, ctx.body.sourceCustomerId);
    if (src.id === target.id || !src.active || !target.active) throw new ApiError('CUSTOMER_MERGE_INVALID', { source: src.id, target: target.id });
    if (ctx.body.expectedVersion !== undefined) checkVersion(target, ctx.body.expectedVersion);
    // addresses (skip exact duplicates)
    const key = (a: CustomerAddress) => arNorm(`${a.area}|${a.street}|${a.building ?? ''}|${a.apartment ?? ''}`);
    const have = new Set(target.addresses.filter((a) => a.active).map(key));
    for (const a of src.addresses.filter((x) => x.active)) if (!have.has(key(a))) target.addresses.push({ ...a, id: nextId('adr'), isDefault: false, label: a.label ? `${a.label} (${src.name})` : src.name });
    // phones: the source's number becomes the second number when free
    if (!target.altPhone && src.phone && src.phone !== target.phone) target.altPhone = src.phone;
    target.tags = [...new Set([...target.tags.filter((x) => x !== 'NEW'), ...src.tags.filter((x) => x !== 'NEW')])];
    target.allergies = [...new Set([...target.allergies, ...src.allergies])];
    if (src.notes) target.notes = [target.notes, src.notes].filter(Boolean).join(' · ').slice(0, 300);
    if (src.history) {
      const h = target.history ?? { orders: 0, spent: '0.0000', lastOrderAt: null };
      target.history = { ...h, orders: h.orders + src.history.orders, spent: m4(D(h.spent).plus(D(src.history.spent))), lastOrderAt: [h.lastOrderAt, src.history.lastOrderAt].filter(Boolean).sort().at(-1) ?? null };
    }
    // history references (orders, deliveries) are rewritten to the survivor
    let movedOrders = 0;
    for (const o of db.orders) if (o.customerId === src.id) { o.customerId = target.id; o.customerName = target.name; movedOrders++; }
    for (const d of db.deliveries ?? []) if (d.customerId === src.id) d.customerId = target.id;
    for (const e of db.externalOrders ?? []) if (e.customerId === src.id) e.customerId = target.id;
    // loyalty: the source balance moves as one pair of entries
    const pts = balanceOf(db, src.id);
    if (pts !== 0) {
      addLoyaltyEntry(ctx, src.id, 'MERGE_OUT', -pts, { reason: `اتنقلت لـ ${target.name} (${target.code})` });
      addLoyaltyEntry(ctx, target.id, 'MERGE_IN', pts, { reason: `من ${src.name} (${src.code}) بعد الدمج` });
    }
    src.active = false; src.mergedInto = target.id; src.version++;
    target.version++;
    ctx.audit(`customer ${src.code} merged into ${target.code} (${movedOrders} orders, ${pts} points)`, target.id, true);
    event('CustomerMerged', target.id, `${src.code} → ${target.code}`);
    return { ...customerView(db, target, true), merge: { sourceId: src.id, movedOrders, movedPoints: pts } };
  },
};
