// Round 3 (F2-04): things a person can find and follow — dishes, ingredients, suppliers, purchasing documents, checks,
// customers and people. Type labels/icons, where a thing opens, and the per-person follow list ("تابع").
import React, { useSyncExternalStore } from 'react';
import { UtensilsCrossed, Package, Handshake, ShoppingBag, PackageCheck, FileText, ClipboardList, Receipt, Contact, UserRound } from 'lucide-react';
import { t } from '../../i18n';

export type RefType = 'product' | 'item' | 'supplier' | 'po' | 'receipt' | 'invoice' | 'storeRequest' | 'order' | 'customer' | 'person';
export interface Ref { type: RefType; id: string }
export interface StatusView { type: RefType; id: string; title: { ar: string; en: string }; sub: { ar: string; en: string } | null; status: { text: { ar: string; en: string }; tone: 'success' | 'warning' | 'error' | 'info' | 'neutral' }; missing?: boolean }

export const REF_TYPES: { type: RefType; ar: string; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
  { type: 'product', ar: 'طبق / صنف منيو', icon: UtensilsCrossed, tone: 'from-purple-400 to-purple-600' },
  { type: 'item', ar: 'خامة', icon: Package, tone: 'from-emerald-400 to-green-600' },
  { type: 'supplier', ar: 'مورد', icon: Handshake, tone: 'from-indigo-400 to-blue-600' },
  { type: 'storeRequest', ar: 'طلبية مخزن', icon: ClipboardList, tone: 'from-amber-400 to-orange-500' },
  { type: 'po', ar: 'أمر شراء', icon: ShoppingBag, tone: 'from-fuchsia-400 to-pink-600' },
  { type: 'receipt', ar: 'إذن استلام', icon: PackageCheck, tone: 'from-lime-400 to-green-600' },
  { type: 'invoice', ar: 'فاتورة مورد', icon: FileText, tone: 'from-sky-400 to-blue-600' },
  { type: 'order', ar: 'شيك', icon: Receipt, tone: 'from-orange-400 to-orange-600' },
  { type: 'customer', ar: 'عميل', icon: Contact, tone: 'from-cyan-400 to-blue-600' },
  { type: 'person', ar: 'شخص', icon: UserRound, tone: 'from-slate-400 to-slate-600' },
];
export const refType = (type: string) => REF_TYPES.find((x) => x.type === type) ?? REF_TYPES[0];
export const refTypeLabel = (type: string) => t(refType(type).ar);

/** Where a thing opens (screen id + params). */
export function refTarget(r: Ref): { screen: string; params: Record<string, any> } {
  switch (r.type) {
    case 'product': return { screen: 'item360', params: { kind: 'product', id: r.id } };
    case 'item': return { screen: 'item360', params: { kind: 'item', id: r.id } };
    case 'supplier': return { screen: 'inv-suppliers', params: { open: r.id } };
    case 'po': return { screen: 'inv-po', params: { open: r.id } };
    case 'receipt': return { screen: 'inv-receipts', params: { open: r.id } };
    case 'invoice': return { screen: 'inv-purchasing', params: { tab: 'invoices', open: r.id } };
    case 'storeRequest': return { screen: 'inv-purchasing', params: { tab: 'requests', open: r.id } };
    case 'order': return { screen: 'receipt', params: { orderId: r.id } };
    case 'customer': return { screen: 'customer', params: { customerId: r.id } };
    case 'person': return { screen: 'users', params: { open: r.id } };
  }
}

// ───────── follow list, per person, kept on the device
const KEY = (userId: string) => `nerdpos.follow.v1.${userId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, Ref[]>();
function read(userId: string): Ref[] {
  if (!cache.has(userId)) { let v: Ref[] = []; try { v = JSON.parse(localStorage.getItem(KEY(userId)) ?? '[]'); } catch { /* ignore */ } cache.set(userId, Array.isArray(v) ? v : []); }
  return cache.get(userId)!;
}
function write(userId: string, list: Ref[]) { cache.set(userId, list); try { localStorage.setItem(KEY(userId), JSON.stringify(list)); } catch { /* ignore */ } listeners.forEach((f) => f()); }
export const follow = {
  list: read,
  has: (userId: string, r: Ref) => read(userId).some((x) => x.type === r.type && x.id === r.id),
  toggle(userId: string, r: Ref) { const cur = read(userId); write(userId, follow.has(userId, r) ? cur.filter((x) => !(x.type === r.type && x.id === r.id)) : [{ type: r.type, id: r.id }, ...cur].slice(0, 30)); },
  remove(userId: string, r: Ref) { write(userId, read(userId).filter((x) => !(x.type === r.type && x.id === r.id))); },
};
export function useFollowList(userId: string | null | undefined): Ref[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => (userId ? read(userId) : EMPTY));
}
const EMPTY: Ref[] = [];
export const refsParam = (list: Ref[]) => list.map((r) => `${r.type}:${r.id}`).join(',');
export const TONE_DOT: Record<string, string> = { success: 'bg-[var(--success)]', warning: 'bg-[var(--warning)]', error: 'bg-[var(--error)]', info: 'bg-[var(--info,#38bdf8)]', neutral: 'bg-[var(--text-dim,#94a3b8)]' };
