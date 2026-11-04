// ux-13 customer privacy: the customer's phone leaves the server masked unless the viewer may see it. Applied in the
// kernel to every answer (and to the replay copy of a command): one place covers customer lists / search / profile,
// duplicates, merge, checks (customerPhone), deliveries (incl. the rider's board), reservations, deposits, online orders,
// receipts and print jobs, report rows and exports, the audit log and history texts — a full customer number never
// reaches a browser that may not show it. CustomerPrivacyPolicy decides who sees it (strictest workable defaults).
import { store } from './store';
import { policyFields, type PolicyCtx } from './policies';
import type { DB } from './types';

export interface CustomerPrivacy {
  /** MASKED_UNLESS_PERMITTED (default): masked for everyone without customer:viewphone · FULL_FOR_ALL: no masking. */
  phoneDisplay: 'MASKED_UNLESS_PERMITTED' | 'FULL_FOR_ALL';
  /** How holders of customer:viewphone see it: WITH_REASON (default) — masked in every view, one number revealed at a time
   *  with a written reason (audited) · FULL_IN_VIEWS — the full number in every view · NOT_ALLOWED — never (masked for all). */
  revealMode: 'WITH_REASON' | 'FULL_IN_VIEWS' | 'NOT_ALLOWED';
  /** The rider (a user linked to a rider record): the number of his own delivery — OUT_FOR_DELIVERY (default, after he
   *  picked it up until it is delivered / failed) · ACTIVE_DELIVERY (also while assigned) · NONE. */
  riderAccess: 'OUT_FOR_DELIVERY' | 'ACTIVE_DELIVERY' | 'NONE';
  /** Search by part of a number: PERMITTED_ONLY (default; everyone else types the whole number) · ALL. */
  partialSearch: 'PERMITTED_ONLY' | 'ALL';
}
export const PRIVACY_DEFAULT: CustomerPrivacy = { phoneDisplay: 'MASKED_UNLESS_PERMITTED', revealMode: 'WITH_REASON', riderAccess: 'OUT_FOR_DELIVERY', partialSearch: 'PERMITTED_ONLY' };
export const privacyPolicy = (ctx: PolicyCtx = {}): CustomerPrivacy => ({ ...PRIVACY_DEFAULT, ...policyFields<CustomerPrivacy>('CustomerPrivacyPolicy', ctx) });

export const MASK_CHAR = '•';
/** 01001234567 → 010•••••567 (the first three and the last three digits stay). */
export function maskPhone(p: string | null | undefined): string {
  const s = String(p ?? '');
  if (!s) return s;
  if (s.length <= 6) return MASK_CHAR.repeat(s.length);
  return s.slice(0, 3) + MASK_CHAR.repeat(s.length - 6) + s.slice(-3);
}
export const isMasked = (p: unknown) => typeof p === 'string' && p.includes(MASK_CHAR);

/** Every number that belongs to a customer: the record (phone, second number), and the copies kept on checks, deliveries,
 *  reservations, deposits and online orders (also when no customer record exists). Cached per committed store version. */
let cache: { version: number; db: DB; set: Set<string> } | null = null;
export function customerPhones(db: DB): Set<string> {
  const v = store.version();
  if (cache && cache.version === v && cache.db === db) return cache.set;
  const set = new Set<string>();
  const add = (p: unknown) => { const s = String(p ?? '').replace(/\D/g, ''); if (s.length >= 7) set.add(s); };
  for (const c of db.customers ?? []) { add(c.phone); add(c.altPhone); }
  for (const d of db.deliveries ?? []) add(d.phone);
  for (const e of db.externalOrders ?? []) add(e.customer?.phone);
  for (const r of db.reservations ?? []) add(r.phone);
  for (const d of db.deposits ?? []) add(d.phone);
  for (const o of db.orders) add(o.customerPhone);
  cache = { version: v, db, set };
  return set;
}

export interface PhoneViewer { full: boolean; allow: Set<string>; canReveal: boolean; partial: boolean; policy: CustomerPrivacy }
interface ViewerCtx { db: DB; user: { id: string } | null; branchId: string | null; can: (p: string) => boolean }

/** What this request may see. `allow` = numbers shown in full although the rest is masked (the rider's own delivery). */
export function phoneViewer(ctx: ViewerCtx): PhoneViewer {
  const pol = privacyPolicy({ branchId: ctx.branchId });
  const holder = !!ctx.user && ctx.can('customer:viewphone');
  const full = pol.phoneDisplay === 'FULL_FOR_ALL' || (holder && pol.revealMode === 'FULL_IN_VIEWS');
  const allow = new Set<string>();
  if (!full && ctx.user && pol.riderAccess !== 'NONE') {
    const drv = (ctx.db.drivers ?? []).find((d) => d.userId === ctx.user!.id);
    if (drv) {
      const states = pol.riderAccess === 'ACTIVE_DELIVERY' ? ['ASSIGNED', 'PICKED_UP'] : ['PICKED_UP'];
      for (const d of ctx.db.deliveries ?? []) {
        if (d.driverId !== drv.id || !states.includes(d.state)) continue;
        allow.add(d.phone);
        const c = d.customerId ? (ctx.db.customers ?? []).find((x) => x.id === d.customerId) : null;
        if (c?.phone) allow.add(c.phone);
      }
    }
  }
  return { full, allow, canReveal: holder && pol.phoneDisplay !== 'FULL_FOR_ALL' && pol.revealMode === 'WITH_REASON', partial: full || holder || pol.partialSearch === 'ALL', policy: pol };
}

const DIGITS = /\d{7,15}/g;
/** A copy of `v` with every customer number masked in every string (fields, free texts, labels, CSV cells). */
export function maskDeep(v: unknown, phones: Set<string>, allow: Set<string>, depth = 0): unknown {
  if (depth > 40 || v === null || v === undefined) return v;
  if (typeof v === 'string') {
    if (v.length < 7 || !/\d{7}/.test(v)) return v;
    return v.replace(DIGITS, (m) => (phones.has(m) && !allow.has(m) ? maskPhone(m) : m));
  }
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, phones, allow, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = maskDeep(x, phones, allow, depth + 1);
  return out;
}

/** The answer as this viewer may see it (unchanged when the viewer sees full numbers). */
export function applyPhonePrivacy(ctx: ViewerCtx, body: unknown): unknown {
  if (body === null || body === undefined || typeof body !== 'object') return typeof body === 'string' ? maskString(ctx, body) : body;
  const v = phoneViewer(ctx);
  if (v.full) return body;
  return maskDeep(body, customerPhones(ctx.db), v.allow);
}
function maskString(ctx: ViewerCtx, s: string) {
  const v = phoneViewer(ctx);
  return v.full ? s : (maskDeep(s, customerPhones(ctx.db), v.allow) as string);
}
/** Masked for everyone (the replay copy and the request log of a reveal never keep the number). */
export const maskAll = (db: DB, body: unknown) => maskDeep(body, customerPhones(db), new Set());
