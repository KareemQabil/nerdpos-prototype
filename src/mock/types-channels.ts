// Sales channels (E13) and per-user permission overrides (P1-041). Optional collections on DB, always read through
// salesChannelsOf(db) / permOverridesOf(db) with a default.
import type { Channel, Loc } from './types';

/**
 * A sales channel: where a sale comes from (صالة، تيك أواي، دليفري، طلبات …). Its order type drives operations
 * (kitchen, service charge, delivery); its price list decides the price.
 * - default channel of an order type: owns the order type's price list (price rules without salesChannelId).
 * - OWN: own price rules (salesChannelId = id); an item without an own price falls back to the order-type price.
 * - FOLLOW: price = the followed channel's price ± percent (rounded); an item's own price rule still wins.
 */
export interface SalesChannel {
  id: string; name: Loc; orderType: Channel; isDefault: boolean; active: boolean; sortOrder: number; color: string;
  priceMode: 'OWN' | 'FOLLOW';
  follow: { channelId: string; percent: string; roundingStep: string } | null;
  note?: string | null;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; version: number;
  history: { at: string; by: string; text: string }[];
}

/** A per-user exception to the role permissions: GRANT adds a permission, REVOKE takes one away. Optional expiry. */
export interface PermOverride {
  id: string; userId: string; permission: string; effect: 'GRANT' | 'REVOKE'; reason: string;
  expiresAtMs: number | null; createdAt: string; createdBy: string;
  removedAt: string | null; removedBy: string | null; removeReason?: string | null;
}

/** Permissions that only the vendor (NerdPOS support) holds: '*' (owner, setup admin) does NOT include them. */
export const VENDOR_PERMISSIONS = ['vendor:capabilities'];
export const isVendorPermission = (p: string) => p.startsWith('vendor:');

/** The one permission check used by the kernel and the device: '*' = everything except vendor-only; '-p' markers = revoked. */
export function hasPermission(perms: { has(p: string): boolean } | string[], p: string): boolean {
  const has = Array.isArray(perms) ? (x: string) => perms.includes(x) : (x: string) => perms.has(x);
  if (has('-' + p)) return false;
  return has(p) || (has('*') && !isVendorPermission(p));
}
