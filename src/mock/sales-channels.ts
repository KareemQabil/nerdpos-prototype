// Sales channels (E13): records with an order type and a price list. The order type (DINE_IN / TAKEAWAY / DELIVERY)
// keeps driving operations; the sales channel decides the price. Every order type has one default channel that owns
// the order type's existing price list (price rules without salesChannelId), so old data and journeys price the same.
import { ApiError } from './errors';
import { m4 } from './money';
import type { Channel, DB, PriceRule } from './types';
import type { SalesChannel } from './types-channels';

export const ORDER_TYPES: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
export const defaultChannelId = (orderType: Channel) => `sch_${orderType.toLowerCase()}`;

const DEFAULTS: { orderType: Channel; name: { ar: string; en: string }; color: string; sortOrder: number }[] = [
  { orderType: 'DINE_IN', name: { ar: 'صالة', en: 'Dine-in' }, color: '#38bdf8', sortOrder: 10 },
  { orderType: 'TAKEAWAY', name: { ar: 'تيك أواي', en: 'Takeaway' }, color: '#f59e0b', sortOrder: 20 },
  { orderType: 'DELIVERY', name: { ar: 'دليفري', en: 'Delivery' }, color: '#22c55e', sortOrder: 30 },
];

/** Every sales channel; the three defaults are created on first read (old saved data, fresh installs). */
export function salesChannelsOf(db: DB): SalesChannel[] {
  const list = (db.salesChannels ??= []);
  for (const d of DEFAULTS) {
    if (list.some((c) => c.id === defaultChannelId(d.orderType))) continue;
    list.push({ id: defaultChannelId(d.orderType), name: d.name, orderType: d.orderType, isDefault: true, active: true, sortOrder: d.sortOrder, color: d.color, priceMode: 'OWN', follow: null, note: null, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'provisioning', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'provisioning', version: 1, history: [] });
  }
  return list;
}

export function salesChannelById(db: DB, id: string | null | undefined): SalesChannel | null {
  if (!id) return null;
  return salesChannelsOf(db).find((c) => c.id === id) ?? null;
}
export function defaultChannelFor(db: DB, orderType: Channel): SalesChannel {
  return salesChannelsOf(db).find((c) => c.id === defaultChannelId(orderType))!;
}
/** The sales channel of an order (old orders without one = the default channel of their order type). */
export function orderSalesChannel(db: DB, o: { channel: Channel; salesChannelId?: string | null }): SalesChannel {
  return salesChannelById(db, o.salesChannelId) ?? defaultChannelFor(db, o.channel);
}

/** ux-07: the sales channel an online-order source lands on — the active channel that lists the source and sells this
 *  order type; otherwise the order type's default channel. Owned here (Sales channels); online orders only read it. */
export function channelForSource(db: DB, source: string, orderType: Channel): SalesChannel {
  return salesChannelsOf(db).find((c) => c.active && c.orderType === orderType && (c.externalSources ?? []).includes(source)) ?? defaultChannelFor(db, orderType);
}
/** The channel a source is mapped to (any order type), for display; null = not mapped. */
export function mappedChannelOf(db: DB, source: string): SalesChannel | null {
  return salesChannelsOf(db).find((c) => c.active && (c.externalSources ?? []).includes(source)) ?? null;
}

/** Validates the channel picked for a new order of this order type; none = the order type's default channel. */
export function resolveSalesChannel(db: DB, orderType: Channel, id: string | null | undefined): SalesChannel {
  if (!id) return defaultChannelFor(db, orderType);
  const sc = salesChannelById(db, id);
  if (!sc) throw new ApiError('SALES_CHANNEL_NOT_FOUND', { salesChannelId: id });
  if (!sc.active) throw new ApiError('SALES_CHANNEL_INACTIVE', { salesChannelId: id, name: sc.name.ar });
  if (sc.orderType !== orderType) throw new ApiError('SALES_CHANNEL_ORDER_TYPE_MISMATCH', { salesChannelId: id, orderType: sc.orderType, requested: orderType });
  return sc;
}

/** Price-rule key of a channel: null for a default channel (the order type's own price list), else its id. */
export const priceKeyOf = (sc: SalesChannel | null | undefined): string | null => (!sc || sc.isDefault ? null : sc.id);
/** Does this rule belong to the price list with this key? */
export const ruleInList = (r: PriceRule, key: string | null) => (r.salesChannelId ?? null) === key;

/** Demo: the "طلبات" delivery-app channel with its own prices for a few items (≈ delivery + 20%); the rest falls back to delivery. */
export function seedSalesChannels(db: DB, nowMs: number) {
  const iso = new Date(nowMs).toISOString();
  const list = salesChannelsOf(db);
  list.push({
    id: 'sch_talabat', name: { ar: 'طلبات', en: 'Talabat' }, orderType: 'DELIVERY', isDefault: false, active: true, sortOrder: 40, color: '#ff5a00',
    priceMode: 'OWN', follow: null, note: 'تطبيق توصيل — أسعاره أعلى عشان العمولة', externalSources: ['APP_1'] /* ux-07: «تطبيق التوصيل ١» orders land here */, createdAt: iso, createdBy: 'u_owner', updatedAt: iso, updatedBy: 'u_owner', version: 1,
    history: [{ at: iso, by: 'u_owner', text: 'اتعملت قناة طلبات (دليفري) بأسعار خاصة' }],
  });
  const own: Record<string, string> = { p_tea: '30', p_turkish_coffee: '48', p_chicken_shawarma: '180', p_kofta: '265', p_mixed_grill: '385', p_beef_burger: '215' };
  let n = db.priceRules.length + 900;
  const from = db.priceRules.find((r) => r.channel === 'DELIVERY')?.effectiveFrom ?? nowMs - 86_400_000;
  for (const [pid, amount] of Object.entries(own)) {
    if (!db.products.some((p) => p.id === pid)) continue;
    db.priceRules.push({ id: `pr_${++n}`, productId: pid, branchId: 'branch_main', channel: 'DELIVERY', salesChannelId: 'sch_talabat', amount: m4(amount), currency: 'EGP', effectiveFrom: from, effectiveTo: null, createdAt: new Date(from).toISOString(), createdBy: 'u_owner', version: 1, replacesRuleId: null });
  }
}

/**
 * r3C seed: sales channels (طلبات demo), the vendor support persona ("دعم NerdPOS" — the only one who sees licensed
 * modules), and the manager's right to create sales channels (the manager is not a super-user: no '*').
 */
export function seedR3C(db: DB, nowMs: number, pin: string, password: string, displayName: string) {
  seedSalesChannels(db, nowMs);
  const mgr = db.roles.find((r) => r.id === 'role_manager');
  if (mgr && !mgr.permissionIds.includes('saleschannel:manage')) {
    mgr.permissionIds.push('saleschannel:manage');
    ((mgr as any).demoAdded ??= []).push('saleschannel:manage');
  }
  db.roles.push({ id: 'role_vendor', name: 'NerdPOS Support', permissionIds: ['vendor:capabilities', 'settings:read', 'business:read', 'branch:read', 'terminal:read', 'audit:read'], active: true, version: 1 });
  db.users.push({ id: 'u_vendor', username: 'nerdpos-support', displayName, active: true, version: 1, pin, password, roleAssignments: [{ roleId: 'role_vendor', branchIds: ['*'] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false });
}
