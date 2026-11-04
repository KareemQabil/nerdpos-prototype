// Round 3 (r3B) server helpers: kitchen screens subscribed to stations, the receipt/document template, the short
// display number (E08) and second-language names (E16). Pure helpers over the DB; handlers live in
// handlers/kitchen.ts (KdsScreen.*) and handlers/templates.ts (DocTemplate.*).
import type { DB, Loc, Order } from './types';
import type { DocTemplate, KdsScreenConfig, R3BState } from './types-r3b';
import { policy } from './policies';
import { ApiError } from './errors';

export function r3bOf(db: DB): R3BState {
  db.r3b ??= { kdsScreens: [], docTemplate: null, shortNo: {} };
  db.r3b.kdsScreens ??= [];
  db.r3b.shortNo ??= {};
  return db.r3b;
}

// ───────── kitchen screens
/** The configuration of a kitchen screen. A KDS terminal without one shows every station and is its own dispatch
 *  screen (the behaviour before round 3). Non-KDS devices (office PC, back office) see the full dispatch view. */
export function kdsScreenOf(db: DB, terminalId: string | null | undefined): KdsScreenConfig & { configured: boolean } {
  const c = terminalId ? r3bOf(db).kdsScreens.find((x) => x.terminalId === terminalId) : undefined;
  if (c) return { ...c, configured: true };
  return { terminalId: terminalId ?? '', stationIds: [], dispatch: true, start: 'HIDDEN', version: 0, updatedAt: '', updatedBy: '', configured: false };
}
/** Is there at least one dispatch screen in the branch (other than the default)? When none is configured, every
 *  kitchen screen can hand off (nobody else would). */
export function branchHasDispatch(db: DB, branchId: string | null | undefined): boolean {
  return r3bOf(db).kdsScreens.some((c) => c.dispatch && db.terminals.find((t) => t.id === c.terminalId && t.branchId === branchId && t.lifecycle === 'ACTIVE'));
}

// ───────── short display number (E08)
export interface ShortNoPolicy { mode: 'OFF' | 'DAILY' | 'EVERY_N'; every?: number }
/** Gives a new order its short call-out number. The transaction number (`order.number`) is never touched.
 *  DAILY: 1, 2, 3… and back to 1 when the business date changes or the day is closed. EVERY_N: 1..N, then 1 again
 *  (and back to 1 each business day). */
export function assignShortNo(db: DB, o: Order): string | null {
  if (o.shortNo) return o.shortNo;
  const p = policy<ShortNoPolicy>('ShortOrderNumberPolicy', { branchId: o.branchId }) ?? { mode: 'OFF' };
  if (!p || p.mode === 'OFF' || o.kind === 'STAFF_MEAL') return null;
  const st = r3bOf(db).shortNo;
  const cur = st[o.branchId];
  const closed = !!cur && (db.businessDays ?? []).some((d) => d.branchId === o.branchId && d.date === cur.businessDate && d.state === 'CLOSED');
  const fresh = !cur || cur.businessDate !== o.businessDate || (closed && !cur.afterClose);
  const count = fresh ? 1 : cur.count + 1;
  st[o.branchId] = { businessDate: o.businessDate, count, afterClose: closed || undefined };
  const every = Math.max(10, Number(p.every ?? 100));
  const n = p.mode === 'EVERY_N' ? ((count - 1) % every) + 1 : count;
  o.shortNo = String(n);
  return o.shortNo;
}

// ───────── second language (E16 / P1-034)
export interface SecondLang { receipt: boolean; kitchen: boolean; menu: boolean }
export const secondLangOf = (branchId?: string | null): SecondLang => { const v = policy<Partial<SecondLang>>('SecondLanguagePolicy', { branchId }) ?? {}; return { receipt: !!v.receipt, kitchen: !!v.kitchen, menu: !!v.menu }; };
/** The item's second name, only when one was entered (not empty, not a copy of the Arabic name). No machine translation. */
export function secondName(name: Loc | null | undefined): string | null {
  const en = (name?.en ?? '').trim();
  if (!en || en === (name?.ar ?? '').trim()) return null;
  return en;
}

// ───────── receipt / document template (E16, P1-033)
export const LOGO_MAX_CHARS = 280_000; // ≈ 200 KB image as a data URL
export function docTemplateOf(db: DB): DocTemplate {
  return r3bOf(db).docTemplate ?? { logoDataUrl: null, logoName: null, logoWidthPct: 45, logoOnReceipt: true, logoOnReports: true, headerLines: [], footerLines: ['شكرًا لزيارتكم'], paper: '80MM', version: 0, updatedAt: '', updatedBy: '' };
}

// ───────── tender taxonomy (F3-05, F3-06): CASH · CARD (card terminal) · WALLET (DIGITAL_WALLET + provider) ·
// PREPAID (internal code ONLINE: paid before arrival — delivery app or payment link only) · POINTS (LOYALTY)
export type RefRule = 'OFF' | 'OPTIONAL' | 'REQUIRED';
/** Reference capture rule of a method (TenderReferencePolicy; default optional). Cash, deposit and points have none. */
export function referenceRule(method: string, branchId?: string | null): RefRule {
  if (method !== 'CARD' && method !== 'DIGITAL_WALLET' && method !== 'ONLINE') return 'OFF';
  const p = policy<Record<string, RefRule>>('TenderReferencePolicy', { branchId }) ?? {};
  return (p[method] as RefRule) ?? 'OPTIONAL';
}
/** Validates the reference of one tender: required when the venue says so, never the same number twice on the same
 *  method/provider in a business day (a duplicate authorization). Returns the reference to store. */
export function checkTenderReference(db: DB, o: Order, tender: { method: string; walletProvider?: string | null }, raw: string | null, businessDate: string, fromAuthorization: boolean): string | null {
  const rule = referenceRule(tender.method, o.branchId);
  const ref = (raw ?? '').trim() || null;
  if (rule === 'OFF' && !fromAuthorization) return null; // the venue doesn't take a reference for this method
  if (rule === 'REQUIRED' && !ref) throw new ApiError('TENDER_REFERENCE_REQUIRED', { method: tender.method, policy: 'TenderReferencePolicy' });
  if (ref) {
    const dup = db.captures.find((c) => c.branchId === o.branchId && c.method === tender.method && (c.walletProvider ?? null) === (tender.walletProvider ?? null) && c.reference === ref && c.businessDate === businessDate && !c.correctionOf && !c.corrected && Number(c.amount) > 0);
    if (dup) throw new ApiError('TENDER_REFERENCE_DUPLICATE', { method: tender.method, reference: ref, existingOrderId: dup.orderId });
  }
  return ref;
}
/** PREPAID ("مدفوع قبل كده") is only for orders that came from a delivery app or were paid by a payment link. */
export function prepaidAllowed(o: Order, hasAuthorization: boolean): boolean {
  return hasAuthorization || !!o.externalOrderId || !!o.deliveryId;
}
