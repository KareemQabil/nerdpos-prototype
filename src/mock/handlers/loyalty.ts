// Loyalty: points earned on completed checks, tiers, manual adjustments (approval above a threshold) and
// redemption as a payment at checkout (a LOYALTY capture: no cash moves, the points leave the balance).
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, event, hist } from '../store';
import { policy } from '../policies';
import { computeTotals } from '../pricing';
import { D, m4, round } from '../money';
import { checkVersion, getOrder, need, openSessionOn, page, requireFields, settlementOf, userName } from './util';
import type { DB, Order } from '../types';
import type { LoyaltyEntry, LoyaltyEntryKind, LoyaltyTier } from '../types-crm';

export interface LoyaltyProgram { enabled: boolean; egpPerPoint: string; pointValue: string; minRedeemPoints: number; maxRedeemPercent: number }
export function program(): LoyaltyProgram {
  const v = policy<Partial<LoyaltyProgram>>('LoyaltyProgramPolicy') ?? {};
  return { enabled: v.enabled !== false, egpPerPoint: String(v.egpPerPoint ?? '10'), pointValue: String(v.pointValue ?? '0.25'), minRedeemPoints: Number(v.minRedeemPoints ?? 100), maxRedeemPercent: Number(v.maxRedeemPercent ?? 50) };
}
const entriesOf = (db: DB) => (db.loyaltyEntries ??= []);
const tiersOf = (db: DB) => (db.loyaltyTiers ??= []);

export const balanceOf = (db: DB, customerId: string) => entriesOf(db).filter((e) => e.customerId === customerId).reduce((a, e) => a + e.points, 0);
/** Points ever earned (earn, positive adjustments, merged in) — the tier is decided on this, redemption does not lower it. */
export const lifetimeOf = (db: DB, customerId: string) => entriesOf(db).filter((e) => e.customerId === customerId && e.points > 0 && e.kind !== 'REVERSE').reduce((a, e) => a + e.points, 0);
export function tierFor(db: DB, lifetime: number): LoyaltyTier | null {
  const list = tiersOf(db).filter((t) => t.active).sort((a, b) => b.minPoints - a.minPoints);
  return list.find((t) => lifetime >= t.minPoints) ?? null;
}

export function loyaltySummary(db: DB, customerId: string) {
  const balance = balanceOf(db, customerId);
  const lifetime = lifetimeOf(db, customerId);
  const tier = tierFor(db, lifetime);
  const next = tiersOf(db).filter((t) => t.active && t.minPoints > lifetime).sort((a, b) => a.minPoints - b.minPoints)[0] ?? null;
  const p = program();
  return {
    balance, lifetime, valueEgp: round(D(balance).times(D(p.pointValue)), 2),
    tier: tier ? { id: tier.id, name: tier.name, color: tier.color, multiplier: tier.multiplier } : null,
    nextTier: next ? { id: next.id, name: next.name, minPoints: next.minPoints, toGo: next.minPoints - lifetime } : null,
  };
}

export function addLoyaltyEntry(ctx: { db: DB; nowIso: string; user: { id: string } | null }, customerId: string, kind: LoyaltyEntryKind, points: number, extra: Partial<LoyaltyEntry> = {}): LoyaltyEntry {
  const e: LoyaltyEntry = { id: nextId('le'), customerId, kind, points, balanceAfter: balanceOf(ctx.db, customerId) + points, at: ctx.nowIso, by: ctx.user?.id ?? 'system', ...extra };
  entriesOf(ctx.db).push(e);
  return e;
}

/** Earn rule: one point per `egpPerPoint` of item value after discount; the part paid with points earns nothing; × tier multiplier. */
export function earnQuote(db: DB, o: Order) {
  const p = program();
  if (!p.enabled || !o.customerId || o.kind === 'STAFF_MEAL') return null;
  const tt = computeTotals(o);
  if (tt.comp) return null;
  const netItems = D(tt.itemsSubtotal).minus(D(tt.itemDiscount));
  const paidByPoints = db.captures.filter((c) => c.orderId === o.id && c.method === 'LOYALTY').reduce((a, c) => a.plus(D(c.amount)), D(0));
  const base = netItems.minus(paidByPoints);
  if (base.lte(0)) return { points: 0, base: '0.0000', multiplier: '1' };
  const tier = tierFor(db, lifetimeOf(db, o.customerId));
  const mult = D(tier?.multiplier ?? '1');
  const points = base.dividedBy(D(p.egpPerPoint)).times(mult).floor().toNumber();
  return { points, base: m4(base), multiplier: mult.toString(), tierName: tier?.name ?? null };
}

/** Hook called when a check completes (Order.Complete). Idempotent per order. */
export function onOrderCompleted(ctx: Ctx, o: Order) {
  if (!o.customerId) return;
  if (entriesOf(ctx.db).some((e) => e.orderId === o.id && e.kind === 'EARN')) return;
  const q = earnQuote(ctx.db, o);
  if (!q || q.points <= 0) return;
  addLoyaltyEntry(ctx, o.customerId, 'EARN', q.points, { orderId: o.id, orderNumber: o.number, amount: q.base, reason: q.multiplier !== '1' ? `مضاعف المستوى ×${q.multiplier}` : null });
  o.history.push(hist(ctx.user?.id ?? 'system', 'LOYALTY_EARNED', { ar: `العميل كسب ${q.points} نقطة على الطلب ده`, en: `customer earned ${q.points} points` }));
  event('LoyaltyEarned', o.customerId, `${o.number} +${q.points}`);
}

function redeemQuote(db: DB, o: Order) {
  const p = program();
  const st = settlementOf(db, o);
  const balance = o.customerId ? balanceOf(db, o.customerId) : 0;
  const alreadyPoints = db.captures.filter((c) => c.orderId === o.id && c.method === 'LOYALTY').reduce((a, c) => a.plus(D(c.amount)), D(0));
  const capByPercent = D(computeTotals(o).payable).times(p.maxRedeemPercent).dividedBy(100).minus(alreadyPoints);
  const capValue = capByPercent.lt(D(st.remaining)) ? capByPercent : D(st.remaining);
  const maxByValue = capValue.lte(0) ? 0 : capValue.dividedBy(D(p.pointValue)).floor().toNumber();
  const maxPoints = Math.max(0, Math.min(balance, maxByValue));
  return { balance, pointValue: p.pointValue, minRedeemPoints: p.minRedeemPoints, maxRedeemPercent: p.maxRedeemPercent, maxPoints, maxValue: round(D(maxPoints).times(D(p.pointValue)), 2), remaining: st.remaining, canRedeem: p.enabled && maxPoints >= p.minRedeemPoints };
}

export const loyaltyHandlers: Record<string, Handler> = {
  'Loyalty.Balance': (ctx) => {
    const c = (ctx.db.customers ?? []).find((x) => x.id === ctx.params.customerId);
    if (!c) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: ctx.params.customerId });
    const entries = entriesOf(ctx.db).filter((e) => e.customerId === c.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100).map((e) => ({ ...e, byName: e.by === 'seed' || e.by === 'system' ? null : userName(ctx.db, e.by) }));
    const out: any = { customerId: c.id, customerName: c.name, ...loyaltySummary(ctx.db, c.id), program: program(), entries };
    if (ctx.query.orderId) {
      const o = getOrder(ctx, ctx.query.orderId);
      out.redeem = o.status === 'CONFIRMED' && o.customerId === c.id ? redeemQuote(ctx.db, o) : null;
      out.earnPreview = earnQuote(ctx.db, o);
    }
    return out;
  },
  'Loyalty.Adjust': (ctx) => {
    requireFields(ctx, 'points', 'reason');
    const c = (ctx.db.customers ?? []).find((x) => x.id === ctx.params.customerId);
    if (!c) throw new ApiError('CUSTOMER_NOT_FOUND', { customerId: ctx.params.customerId });
    if (!c.active) throw new ApiError('CUSTOMER_INACTIVE', { mergedInto: c.mergedInto });
    const points = Number(ctx.body.points);
    need(Number.isInteger(points) && points !== 0 && Math.abs(points) <= 100000, 'VALIDATION_FAILED', { field: 'points', rule: 'whole number, not zero' });
    const reason = String(ctx.body.reason).trim();
    need(reason.length >= 3 && reason.length <= 200, 'VALIDATION_FAILED', { field: 'reason', rule: '3..200 characters' });
    if (balanceOf(ctx.db, c.id) + points < 0) throw new ApiError('LOYALTY_INSUFFICIENT_POINTS', { balance: balanceOf(ctx.db, c.id), points });
    const g = ctx.requireApproval({ action: 'LOYALTY_ADJUST', targetType: 'customers.Customer', targetId: c.id, context: { customerId: c.id, points: String(points), absPoints: String(Math.abs(points)), reason }, grantId: ctx.body.approvalGrantId });
    addLoyaltyEntry(ctx, c.id, 'ADJUST', points, { reason, approvalGrantId: g?.id ?? null });
    ctx.audit(`loyalty adjust ${points} for ${c.code}: ${reason}`, c.id, true, g?.id);
    return { customerId: c.id, ...loyaltySummary(ctx.db, c.id) };
  },
  // POST /loyalty/redemptions {orderId, points}: points pay part of a confirmed check (proposed LOYALTY tender).
  'Loyalty.Redeem': (ctx) => {
    requireFields(ctx, 'orderId', 'points');
    const db = ctx.db;
    const o = getOrder(ctx, ctx.body.orderId);
    if (o.status === 'DRAFT') throw new ApiError('ORDER_NOT_CONFIRMED');
    if (o.status !== 'CONFIRMED') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (!o.customerId) throw new ApiError('LOYALTY_NO_CUSTOMER');
    const p = program();
    if (!p.enabled) throw new ApiError('LOYALTY_DISABLED');
    const points = Number(ctx.body.points);
    need(Number.isInteger(points) && points > 0, 'VALIDATION_FAILED', { field: 'points', rule: 'whole number > 0' });
    const q = redeemQuote(db, o);
    if (points > q.balance) throw new ApiError('LOYALTY_INSUFFICIENT_POINTS', { balance: q.balance, points });
    if (points < p.minRedeemPoints) throw new ApiError('LOYALTY_BELOW_MINIMUM', { minRedeemPoints: p.minRedeemPoints, points });
    if (points > q.maxPoints) throw new ApiError('LOYALTY_REDEEM_LIMIT', { maxPoints: q.maxPoints, maxValue: q.maxValue, maxRedeemPercent: p.maxRedeemPercent });
    const session = openSessionOn(db, ctx.terminal?.id) ?? (o.sessionId ? db.sessions.find((s) => s.id === o.sessionId && s.state === 'OPEN') ?? null : null);
    if (!session) throw new ApiError('SESSION_NOT_OPEN', { reason: 'a redemption is recorded on an open drawer session' });
    const value = round(D(points).times(D(p.pointValue)), 2);
    const entryId = nextId('le');
    const cap = { id: nextId('cap'), orderId: o.id, method: 'LOYALTY' as const, amount: m4(value), tendered: null, change: '0.0000', reference: `${points} نقطة`, walletProvider: null, sessionId: session.id, terminalId: ctx.terminal?.id ?? '', branchId: o.branchId, at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(o.branchId), by: ctx.user!.id, commandId: ctx.commandId ?? '', tip: '0.0000', rounding: '0.0000' };
    db.captures.push(cap);
    const e: LoyaltyEntry = { id: entryId, customerId: o.customerId, kind: 'REDEEM', points: -points, balanceAfter: balanceOf(db, o.customerId) - points, orderId: o.id, orderNumber: o.number, amount: m4(value), reason: 'اتصرفت كدفع في التحصيل', at: ctx.nowIso, by: ctx.user!.id, captureId: cap.id };
    entriesOf(db).push(e);
    o.version++;
    o.history.push(hist(ctx.user!.id, 'LOYALTY_REDEEMED', { ar: `اتدفع ${m4(value)} ج.م بالنقاط (${points} نقطة)`, en: `paid ${value} with ${points} points` }, null, ctx.terminal?.code));
    ctx.audit(`loyalty redeem ${points} pts = ${value} on ${o.number}`, o.id, true);
    event('LoyaltyRedeemed', o.id, `${o.number} -${points}`);
    return { status: 201, body: { entry: e, capture: cap, settlement: settlementOf(db, o), loyalty: loyaltySummary(db, o.customerId) } };
  },
  'LoyaltyTier.List': (ctx) => {
    const db = ctx.db;
    const counts = new Map<string, number>();
    for (const c of (db.customers ?? []).filter((x) => x.active)) { const t = tierFor(db, lifetimeOf(db, c.id)); if (t) counts.set(t.id, (counts.get(t.id) ?? 0) + 1); }
    return page([...tiersOf(db)].sort((a, b) => a.minPoints - b.minPoints).map((t) => ({ ...t, customers: counts.get(t.id) ?? 0 })), ctx.query);
  },
  'LoyaltyTier.Upsert': (ctx) => {
    const db = ctx.db;
    const b = ctx.body;
    need(b.name?.ar && String(b.name.ar).trim().length <= 40, 'LOYALTY_TIER_INVALID', { field: 'name.ar' });
    const minPoints = Number(b.minPoints);
    need(Number.isInteger(minPoints) && minPoints >= 0, 'LOYALTY_TIER_INVALID', { field: 'minPoints' });
    const mult = String(b.multiplier ?? '1');
    need(/^\d+(\.\d{1,2})?$/.test(mult) && D(mult).gte(1) && D(mult).lte(5), 'LOYALTY_TIER_INVALID', { field: 'multiplier', rule: '1..5' });
    let t = tiersOf(db).find((x) => x.id === ctx.params.tierId);
    const active = b.active !== false;
    if (active && tiersOf(db).some((x) => x.active && x.id !== t?.id && x.minPoints === minPoints)) throw new ApiError('LOYALTY_TIER_INVALID', { field: 'minPoints', rule: 'two active tiers cannot start at the same points' });
    if (t) {
      checkVersion(t, b.expectedVersion);
      Object.assign(t, { name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, minPoints, multiplier: mult, color: b.color ?? t.color, perks: b.perks ?? t.perks, active });
      t.version++;
    } else {
      t = { id: ctx.params.tierId === 'new' ? nextId('tier') : ctx.params.tierId, name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, minPoints, multiplier: mult, color: b.color ?? '#94a3b8', perks: b.perks ?? { ar: '', en: '' }, active, sortOrder: minPoints, version: 1 };
      tiersOf(db).push(t);
    }
    if (!tiersOf(db).some((x) => x.active && x.minPoints === 0)) throw new ApiError('LOYALTY_TIER_INVALID', { rule: 'an active starting tier (0 points) must exist' });
    ctx.audit(`loyalty tier ${t.name.en} saved`, t.id);
    return t;
  },
  'Loyalty.Ledger': (ctx) => {
    const db = ctx.db;
    const q = ctx.query;
    let list = entriesOf(db);
    if (q.customerId) list = list.filter((e) => e.customerId === q.customerId);
    if (q.kind) list = list.filter((e) => q.kind.split(',').includes(e.kind));
    const name = new Map((db.customers ?? []).map((c) => [c.id, c]));
    const items = [...list].sort((a, b) => b.at.localeCompare(a.at)).map((e) => ({ ...e, customerName: name.get(e.customerId)?.name ?? e.customerId, customerCode: name.get(e.customerId)?.code ?? '', byName: e.by === 'seed' || e.by === 'system' ? null : userName(db, e.by) }));
    const totals = { earned: list.filter((e) => e.kind === 'EARN').reduce((a, e) => a + e.points, 0), redeemed: -list.filter((e) => e.kind === 'REDEEM').reduce((a, e) => a + e.points, 0), adjusted: list.filter((e) => e.kind === 'ADJUST').reduce((a, e) => a + e.points, 0), outstanding: list.reduce((a, e) => a + e.points, 0) };
    return { ...page(items, q), totals, liabilityEgp: round(D(totals.outstanding).times(D(program().pointValue)), 2) };
  },
};
