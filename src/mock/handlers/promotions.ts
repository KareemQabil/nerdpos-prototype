// Full promotion model (Promotion.Upsert, PD-held): order / item / buy-X-get-Y benefits, item and category scope,
// channels, branches, dayparts, several codes, usage limits and stacking. Used by catalog.ts (admin) and orders.ts
// (applying a promotion to a check). Pricing of item promotions lives in ../promo-engine.ts.
import { ApiError } from '../errors';
import type { Ctx } from '../kernel';
import { nextId, hist } from '../store';
import { policy } from '../policies';
import { D, m4, isMoney } from '../money';
import { checkVersion, getOrder, need } from './util';
import { computeLiveTotals } from '../pricing';
import { promotionLive, usageOf, promoAmount, ruleOf, discountFor, promoSummary, dayparts } from '../promo-engine';
import { policyFields } from '../policies';
import { reasonText } from '../drawer-count';
import { tierFor, lifetimeOf } from './loyalty';
import type { Channel, DB, Order, OrderDiscount } from '../types';
import type { PromotionX, PromotionRevision } from '../types-ops';

/** ux-15 PromotionPolicy (PROPOSED, PROTOTYPE_GAPS §15l): how promotions combine, round and leave a check. */
export interface PromotionRules { maxPromotionsPerCheck: number; stackBase: 'REMAINDER' | 'ORIGINAL'; manualWithPromotion: 'DENY' | 'ALLOW'; rounding: 'DOWN' | 'CHECK'; removeReason: 'REQUIRED' | 'OPTIONAL' }
export const promotionRules = (branchId?: string | null): PromotionRules => policyFields<PromotionRules>('PromotionPolicy', { branchId });
/** A refusal a check can get from a promotion: code + machine rule (shown in words by the cashier screen). */
export interface PromoRefusal { code: string; rule: string; status?: number; details?: Record<string, unknown> }
const refuse = (r: PromoRefusal) => new ApiError(r.code, { rule: r.rule, reason: r.rule, ...(r.details ?? {}) }, r.status);

const CH: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
const MECHANICS = ['ORDER', 'ITEMS', 'BUY_X_GET_Y', 'BUNDLE'];
const all = (db: DB) => db.promotions as PromotionX[];
const codesOf = (p: PromotionX) => (p.codes?.length ? p.codes : p.code ? [p.code] : []);

export function findByCode(db: DB, code: string): PromotionX | undefined {
  const c = String(code ?? '').trim().toUpperCase();
  return all(db).find((p) => p.kind === 'CODED' && codesOf(p).some((x) => x.toUpperCase() === c));
}

function normDayparts(list: any): { days: number[]; start: string; end: string }[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map((s: any) => {
    const days = (s.daysOfWeek ?? s.days ?? []).map(Number);
    const start = s.startLocalTime ?? s.start, end = s.endLocalTime ?? s.end;
    need(days.length > 0 && days.every((d: number) => d >= 0 && d <= 6), 'VALIDATION_FAILED', { field: 'dayparts.days' });
    need(/^\d{2}:\d{2}$/.test(start ?? '') && /^\d{2}:\d{2}$/.test(end ?? '') && start !== end, 'VALIDATION_FAILED', { field: 'dayparts', rule: 'HH:MM, start != end' });
    return { days, start, end };
  });
}

/** PUT /promotions/{promotionId}: create (new id) or replace the whole promotion. Kind is fixed after creation. */
export function upsertPromotion(ctx: Ctx) {
  const b = ctx.body ?? {};
  const id = String(ctx.params.promotionId);
  need(/^[A-Za-z0-9_-]{3,40}$/.test(id), 'VALIDATION_FAILED', { field: 'promotionId' });
  const existing = all(ctx.db).find((p) => p.id === id);
  if (existing) checkVersion(existing, b.expectedVersion);
  need(b.name?.ar && String(b.name.ar).trim(), 'VALIDATION_FAILED', { field: 'name' });
  const kind = existing?.kind ?? b.kind;
  need(kind === 'CODED' || kind === 'AUTOMATIC', 'VALIDATION_FAILED', { field: 'kind' });
  const mechanic = b.mechanic ?? 'ORDER';
  need(MECHANICS.includes(mechanic), 'VALIDATION_FAILED', { field: 'mechanic' });
  const benefitType = b.benefitType ?? 'PERCENTAGE';
  const benefitValue = String(b.benefitValue ?? (mechanic === 'BUY_X_GET_Y' ? '100' : ''));
  need(['PERCENTAGE', 'FIXED_AMOUNT'].includes(benefitType), 'VALIDATION_FAILED', { field: 'benefitType' });
  if (mechanic !== 'BUY_X_GET_Y' && mechanic !== 'BUNDLE') need(isMoney(benefitValue) && D(benefitValue).gt(0) && (benefitType !== 'PERCENTAGE' || D(benefitValue).lte(100)), 'VALIDATION_FAILED', { field: 'benefitValue', rule: 'PERCENTAGE 0 < v <= 100, FIXED_AMOUNT > 0' });
  const productIds: string[] = (b.productIds ?? []).filter((x: string) => ctx.db.products.some((p) => p.id === x));
  const categoryIds: string[] = (b.categoryIds ?? []).filter((x: string) => ctx.db.categories.some((c) => c.id === x));
  if (mechanic === 'ITEMS') need(productIds.length + categoryIds.length > 0, 'VALIDATION_FAILED', { field: 'scope', rule: 'choose items or categories' });
  const buyQty = Math.floor(Number(b.buyQty ?? 1)), getQty = Math.floor(Number(b.getQty ?? 1));
  const getPercent = String(b.getPercent ?? '100');
  if (mechanic === 'BUY_X_GET_Y') {
    need(buyQty >= 1 && buyQty <= 20 && getQty >= 1 && getQty <= 20, 'VALIDATION_FAILED', { field: 'buyQty/getQty', rule: '1..20' });
    need(isMoney(getPercent) && D(getPercent).gt(0) && D(getPercent).lte(100), 'VALIDATION_FAILED', { field: 'getPercent', rule: '0 < v <= 100' });
    need(productIds.length + categoryIds.length > 0, 'VALIDATION_FAILED', { field: 'scope', rule: 'choose what the guest buys' });
  }
  // ux-15 BUNDLE: 2..6 parts, each with items / categories and a quantity 1..10, and a set price > 0
  let bundleParts: { productIds: string[]; categoryIds: string[]; qty: number }[] = [];
  let bundlePrice: string | null = null;
  if (mechanic === 'BUNDLE') {
    const raw = Array.isArray(b.bundleParts) ? b.bundleParts : [];
    bundleParts = raw.map((x: any) => ({ productIds: (x.productIds ?? []).filter((id: string) => ctx.db.products.some((p) => p.id === id)), categoryIds: (x.categoryIds ?? []).filter((id: string) => ctx.db.categories.some((c) => c.id === id)), qty: Math.floor(Number(x.qty ?? 1)) }));
    need(bundleParts.length >= 2 && bundleParts.length <= 6, 'VALIDATION_FAILED', { field: 'bundleParts', rule: '2..6 parts' });
    need(bundleParts.every((x) => x.productIds.length + x.categoryIds.length > 0 && x.qty >= 1 && x.qty <= 10), 'VALIDATION_FAILED', { field: 'bundleParts', rule: 'every part: items or categories, quantity 1..10' });
    need(isMoney(String(b.bundlePrice ?? '')) && D(b.bundlePrice).gt(0), 'VALIDATION_FAILED', { field: 'bundlePrice', rule: '> 0' });
    bundlePrice = m4(b.bundlePrice);
  }
  // ux-15 who gets it: anyone, an identified customer, or the customers of chosen loyalty tiers
  const customerScope = (b.customerScope ?? existing?.customerScope ?? 'ANY') as 'ANY' | 'IDENTIFIED' | 'TIERS';
  need(['ANY', 'IDENTIFIED', 'TIERS'].includes(customerScope), 'VALIDATION_FAILED', { field: 'customerScope' });
  const tierIds: string[] = customerScope === 'TIERS' ? [...new Set<string>((b.tierIds ?? []).map(String))] : [];
  if (customerScope === 'TIERS') need(tierIds.length > 0 && tierIds.every((id) => (ctx.db.loyaltyTiers ?? []).some((x) => x.id === id)), 'VALIDATION_FAILED', { field: 'tierIds', rule: 'one or more loyalty tiers' });
  const maxUsesPerCustomer = b.maxUsesPerCustomer ? Math.floor(Number(b.maxUsesPerCustomer)) : null;
  if (maxUsesPerCustomer !== null) need(maxUsesPerCustomer >= 1 && maxUsesPerCustomer <= 1000, 'VALIDATION_FAILED', { field: 'maxUsesPerCustomer', rule: '1..1000' });
  const maxPerCheck = b.maxPerCheck ? Math.floor(Number(b.maxPerCheck)) : null;
  if (maxPerCheck !== null) need(mechanic !== 'ORDER' && maxPerCheck >= 1 && maxPerCheck <= 50, 'VALIDATION_FAILED', { field: 'maxPerCheck', rule: '1..50, item / buy-get / bundle promotions' });
  const channels: Channel[] = (b.channels ?? []).filter((c: Channel) => CH.includes(c));
  need(channels.length > 0, 'VALIDATION_FAILED', { field: 'channels' });
  const branchIds: string[] = (b.branchIds ?? []).filter((x: string) => ctx.db.branches.some((br) => br.id === x));
  need(String(b.name.ar).trim().length <= 60 && String(b.name.en ?? '').trim().length <= 60, 'VALIDATION_FAILED', { field: 'name', rule: 'at most 60 characters' });
  // codes: unique across every promotion (archived included)
  let codes: string[] = [];
  if (kind === 'CODED') {
    codes = [...new Set<string>((b.codes ?? (b.code ? [b.code] : [])).map((c: string) => String(c).trim().toUpperCase()).filter(Boolean))];
    need(codes.length > 0 && codes.length <= 20, 'VALIDATION_FAILED', { field: 'codes', rule: '1..20 codes' });
    for (const c of codes) {
      need(/^[A-Z0-9_-]{3,24}$/.test(c), 'VALIDATION_FAILED', { field: 'codes', rule: 'A-Z 0-9 _ - (3..24)', code: c });
      const other = all(ctx.db).find((p) => p.id !== id && codesOf(p).some((x) => x.toUpperCase() === c));
      if (other) throw new ApiError('PROMOTION_CODE_TAKEN', { code: c, promotionId: other.id });
    }
  }
  const dp = normDayparts(b.dayparts);
  need(b.priority === undefined || b.priority === null || (Number.isInteger(Number(b.priority)) && Number(b.priority) >= 1 && Number(b.priority) <= 999), 'VALIDATION_FAILED', { field: 'priority', rule: '1..999 (lower applies first)' });
  const maxUses = b.maxUses ? Math.floor(Number(b.maxUses)) : null;
  const maxUsesPerDay = b.maxUsesPerDay ? Math.floor(Number(b.maxUsesPerDay)) : null;
  if (maxUses !== null) need(maxUses >= 1, 'VALIDATION_FAILED', { field: 'maxUses' });
  if (maxUsesPerDay !== null) need(maxUsesPerDay >= 1, 'VALIDATION_FAILED', { field: 'maxUsesPerDay' });
  if (b.minSubtotal) need(isMoney(String(b.minSubtotal)), 'VALIDATION_FAILED', { field: 'minSubtotal' });
  if (b.maxDiscount) need(isMoney(String(b.maxDiscount)) && D(b.maxDiscount).gt(0), 'VALIDATION_FAILED', { field: 'maxDiscount' });
  const validFrom = b.validFrom ? Date.parse(b.validFrom) : null, validTo = b.validTo ? Date.parse(b.validTo) : null;
  need(!(b.validFrom && Number.isNaN(validFrom)) && !(b.validTo && Number.isNaN(validTo)), 'VALIDATION_FAILED', { field: 'validFrom/validTo', rule: 'ISO date-time' });
  if (validFrom && validTo) need(validTo > validFrom, 'VALIDATION_FAILED', { field: 'validTo', rule: 'after validFrom' });
  // ux-15: a promotion that already ended is not created (an existing one can still be edited, e.g. to switch it off)
  if (!existing && validTo) need(validTo > ctx.now, 'VALIDATION_FAILED', { field: 'validTo', rule: 'in the future' });
  // ux-15: a change to a promotion that checks already used is written with a reason (append-only revisions)
  const active = b.active ?? existing?.active ?? true;
  const used = existing ? usageOf(ctx.db, existing.id) : 0;
  const changeReason = b.changeReason ? reasonText(ctx, b.changeReason, 'VALIDATION_FAILED') : null;
  if (existing && used > 0 && !changeReason) throw new ApiError('REASON_REQUIRED', { field: 'changeReason', rule: 'the promotion has been used on checks', used });
  const rec: PromotionX = {
    id, name: { ar: String(b.name.ar).trim(), en: String(b.name.en || b.name.ar).trim() }, kind, code: codes[0] ?? null, codes,
    benefitType: mechanic === 'BUY_X_GET_Y' ? 'PERCENTAGE' : benefitType, benefitValue: mechanic === 'BUY_X_GET_Y' ? getPercent : benefitValue,
    branchIds, channels, minSubtotal: b.minSubtotal ? m4(b.minSubtotal) : null, schedule: dp[0] ?? null, dayparts: dp, validFrom, validTo,
    active, version: (existing?.version ?? 0) + 1,
    mechanic, productIds, categoryIds, buyQty, getQty, getPercent, getProductIds: (b.getProductIds ?? []).filter((x: string) => ctx.db.products.some((p) => p.id === x)), getCategoryIds: (b.getCategoryIds ?? []).filter((x: string) => ctx.db.categories.some((c) => c.id === x)),
    maxDiscount: b.maxDiscount ? m4(b.maxDiscount) : null, maxUses, maxUsesPerDay, stacking: b.stacking === 'STACKABLE' ? 'STACKABLE' : 'EXCLUSIVE', priority: Number(b.priority ?? 100),
    description: b.description?.ar ? { ar: String(b.description.ar).slice(0, 120), en: String(b.description.en ?? b.description.ar).slice(0, 120) } : null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id,
    bundleParts, bundlePrice, maxPerCheck, customerScope, tierIds, maxUsesPerCustomer,
  };
  const change: PromotionRevision['change'] = !existing ? 'CREATED' : existing.active !== active ? (active ? 'ACTIVATED' : 'DEACTIVATED') : 'EDITED';
  const pn = (x: string) => ctx.db.products.find((y) => y.id === x)?.name.ar ?? x, cn = (x: string) => ctx.db.categories.find((y) => y.id === x)?.name.ar ?? x;
  const summary = promoSummary(rec, pn, cn, (x) => ctx.db.products.find((y) => y.id === x)?.name.en ?? pn(x), (x) => ctx.db.categories.find((y) => y.id === x)?.name.en ?? cn(x));
  rec.revisions = [...(existing?.revisions ?? []), { version: rec.version, at: ctx.nowIso, by: ctx.user!.id, change, reason: changeReason, summary }];
  if (existing) Object.assign(existing, rec); else ctx.db.promotions.push(rec);
  ctx.audit(`promotion ${rec.name.ar} v${rec.version} ${change.toLowerCase()}${changeReason ? `: ${changeReason}` : ''}`, id, used > 0);
  return { status: existing ? 200 : 201, body: promotionView(ctx, existing ?? rec) };
}

export function promotionView(ctx: Ctx, p: PromotionX) {
  const bd = ctx.businessDate();
  const pn = (id: string) => ctx.db.products.find((x) => x.id === id)?.name.ar ?? id;
  const cn = (id: string) => ctx.db.categories.find((x) => x.id === id)?.name.ar ?? id;
  return {
    ...p, codes: codesOf(p), mechanic: p.mechanic ?? 'ORDER', dayparts: dayparts(p), stacking: p.stacking ?? 'EXCLUSIVE',
    liveNow: (['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as Channel[]).some((c) => promotionLive(ctx.db, p, ctx.branchId, c, ctx.now)),
    usage: { total: usageOf(ctx.db, p.id), today: usageOf(ctx.db, p.id, bd) }, summary: promoSummary(p, pn, cn, (id) => ctx.db.products.find((x) => x.id === id)?.name.en ?? pn(id), (id) => ctx.db.categories.find((x) => x.id === id)?.name.en ?? cn(id)),
    exhausted: (p.maxUses ? usageOf(ctx.db, p.id) >= p.maxUses : false) || (p.maxUsesPerDay ? usageOf(ctx.db, p.id, bd) >= p.maxUsesPerDay : false),
    customerScope: p.customerScope ?? 'ANY', tierIds: p.tierIds ?? [], tierNames: (p.tierIds ?? []).map((id) => (ctx.db.loyaltyTiers ?? []).find((x) => x.id === id)?.name ?? { ar: id, en: id }),
    maxUsesPerCustomer: p.maxUsesPerCustomer ?? null, maxPerCheck: p.maxPerCheck ?? null, bundleParts: p.bundleParts ?? [], bundlePrice: p.bundlePrice ?? null,
    revisions: [...(p.revisions ?? [])].reverse().map((r) => ({ ...r, byName: ctx.db.users.find((u) => u.id === r.by)?.displayName ?? r.by })),
  };
}

const isPromo = (d: OrderDiscount) => !!d.promotionId;
/** Checks the customer on `o` used `promotionId` on (open or completed; cancelled / voided / merged do not count). */
export function customerUsage(db: DB, promotionId: string, customerId: string, exceptOrderId?: string) {
  return db.orders.filter((x) => x.id !== exceptOrderId && x.customerId === customerId && x.status !== 'CANCELLED' && x.status !== 'VOIDED' && x.status !== 'MERGED' && x.discounts.some((d) => d.active && d.promotionId === promotionId)).length;
}

/** Every condition a promotion must meet on this check, in order. Returns the refusal, or null when it applies.
 *  ux-15: customer scope and per-customer limit, promotions per check, manager discount with a promotion. */
export function promotionRefusal(ctx: Ctx, o: Order, p: PromotionX, opts: { code?: string | null } = {}): PromoRefusal | null {
  if (!p.active) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'INACTIVE' };
  if (!promotionLive(ctx.db, p, o.branchId, o.channel, ctx.now)) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'NOT_LIVE' };
  if (p.kind === 'CODED' && !opts.code) return { code: 'PROMOTION_CODE_INVALID', rule: 'CODE_REQUIRED' };
  if (o.discounts.some((d) => d.active && d.promotionId === p.id)) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'ALREADY_ON_CHECK' };
  if (p.maxUses && usageOf(ctx.db, p.id) >= p.maxUses) return { code: 'PROMOTION_LIMIT_REACHED', rule: 'TOTAL', status: 409, details: { maxUses: p.maxUses } };
  if (p.maxUsesPerDay && usageOf(ctx.db, p.id, o.businessDate) >= p.maxUsesPerDay) return { code: 'PROMOTION_LIMIT_REACHED', rule: 'PER_DAY', status: 409, details: { maxUsesPerDay: p.maxUsesPerDay } };
  const scope = p.customerScope ?? 'ANY';
  if ((scope !== 'ANY' || p.maxUsesPerCustomer) && !o.customerId) return { code: 'PROMOTION_CUSTOMER_REQUIRED', rule: 'CUSTOMER_REQUIRED', status: 409 };
  if (scope === 'TIERS') {
    const tier = tierFor(ctx.db, lifetimeOf(ctx.db, o.customerId!));
    if (!tier || !(p.tierIds ?? []).includes(tier.id)) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'TIER', details: { tierId: tier?.id ?? null } };
  }
  if (p.maxUsesPerCustomer && customerUsage(ctx.db, p.id, o.customerId!, o.id) >= p.maxUsesPerCustomer) return { code: 'PROMOTION_LIMIT_REACHED', rule: 'PER_CUSTOMER', status: 409, details: { maxUsesPerCustomer: p.maxUsesPerCustomer } };
  const st = policy<{ mode: string }>('DiscountStackingPolicy') ?? { mode: 'NO_STACKING' };
  const pr = promotionRules(o.branchId);
  const others = o.discounts.filter((d) => d.active);
  if (others.length) {
    if (st.mode === 'NO_STACKING') return { code: 'DISCOUNT_STACKING_NOT_ALLOWED', rule: 'NO_STACKING' };
    if (others.some((d) => !isPromo(d)) && pr.manualWithPromotion === 'DENY') return { code: 'DISCOUNT_STACKING_NOT_ALLOWED', rule: 'MANUAL_WITH_PROMOTION' };
    const exclusiveOther = others.some((d) => isPromo(d) && (all(ctx.db).find((x) => x.id === d.promotionId)?.stacking ?? 'EXCLUSIVE') === 'EXCLUSIVE');
    if ((p.stacking ?? 'EXCLUSIVE') === 'EXCLUSIVE' || exclusiveOther) return { code: 'DISCOUNT_STACKING_NOT_ALLOWED', rule: 'EXCLUSIVE' };
    if (others.filter(isPromo).length >= pr.maxPromotionsPerCheck) return { code: 'PROMOTION_LIMIT_REACHED', rule: 'PER_CHECK', status: 409, details: { maxPromotionsPerCheck: pr.maxPromotionsPerCheck } };
  }
  const pre = computeLiveTotals(o);
  const eligible = D(pre.itemsSubtotal).plus(pre.serviceCharge);
  if (p.minSubtotal && eligible.lt(p.minSubtotal)) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'MIN_SUBTOTAL', details: { minSubtotal: p.minSubtotal } };
  const rule = ruleOf(p);
  if (rule.mechanic !== 'ORDER' && promoAmount(o, rule, o.policy.rounding.scale, o.policy.rounding.mode).isZero()) return { code: 'PROMOTION_NOT_APPLICABLE', rule: 'NO_QUALIFYING_ITEMS' };
  return null;
}

/** The discount line a promotion adds to this check (throws the first refusal). The rounding and stacking rules of
 *  PromotionPolicy are captured on the line, so a later settings change never re-prices an open check silently. */
export function promotionForOrder(ctx: Ctx, o: Order, p: PromotionX, by: string, opts: { code?: string | null } = {}) {
  const r = promotionRefusal(ctx, o, p, opts);
  if (r) throw refuse(r);
  const pr = promotionRules(o.branchId);
  const d = discountFor(p, by, ctx.nowIso, nextId('disc'), { code: opts.code ?? null, rounding: pr.rounding, stackBase: pr.stackBase });
  (d as any).priority = p.priority ?? 100;
  return d;
}

/** AUTOMATIC promotions when DiscountStackingPolicy.autoApply is on: applied on create and re-checked as lines change. */
export function autoApplyPromotions(ctx: Ctx, o: Order) {
  const st = policy<{ mode: string; autoApply: boolean }>('DiscountStackingPolicy') ?? { mode: 'NO_STACKING', autoApply: false };
  if (!st.autoApply || o.status !== 'DRAFT') return;
  const cands = all(ctx.db).filter((p) => p.kind === 'AUTOMATIC' && promotionLive(ctx.db, p, o.branchId, o.channel, ctx.now)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const p of cands) {
    if (o.discounts.some((d) => d.promotionId === p.id && (d.active || (d.removedBy && d.removedBy !== 'system')))) continue; // ux-15: removed by a person = stays off this check
    if (p.customerScope && p.customerScope !== 'ANY') continue; // ux-15: customer promotions are offered, never put on silently
    if (o.discounts.some((d) => d.active) && st.mode === 'NO_STACKING') return;
    const rule = ruleOf(p);
    // item promotions wait for qualifying items; an order-wide one goes on at once (existing behaviour)
    if (rule.mechanic !== 'ORDER' && promoAmount(o, rule).isZero()) continue;
    try {
      const d = promotionForOrder(ctx, o, p, 'system');
      o.discounts.push(d);
      o.history.push(hist('system', 'PROMOTION', { ar: `طُبّق عرض تلقائي: ${p.name.ar}`, en: `auto promotion: ${p.name.en}` }));
      ctx.audit(`auto promotion ${p.id} v${p.version} on ${o.number ?? o.id}`, o.id);
    } catch { /* conditions not met (minimum, limits): skip */ }
  }
}

/** ux-15: what a promotion would take off this check now — computed by the server on a copy of the check (nothing is
 *  written). `amount` is the promotion's own line; `payableBefore` / `payableAfter` the check's total. */
export function promotionPreview(ctx: Ctx, o: Order, p: PromotionX, code: string | null = null) {
  const copy = structuredClone(o);
  const d = discountFor(p, ctx.user?.id ?? 'preview', ctx.nowIso, '__preview', { code, rounding: promotionRules(o.branchId).rounding, stackBase: promotionRules(o.branchId).stackBase });
  (d as any).priority = p.priority ?? 100;
  copy.discounts.push(d);
  const before = computeLiveTotals(o), after = computeLiveTotals(copy);
  return { amount: after.discountLines?.find((x) => x.discountId === '__preview')?.amount ?? m4(0), payableBefore: before.payable, payableAfter: after.payable };
}

/** ux-15 Order.PromotionOptions (PROPOSED): the automatic promotions live for this check's branch and channel now (and the
 *  coded one when `code` is given), each with whether it applies, the refusal rule when it does not, and the amount. */
export const promotionHandlers: Record<string, import('../kernel').Handler> = {
  'Order.PromotionOptions': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const code = ctx.query.code ? String(ctx.query.code).trim().toUpperCase() : null;
    const list = all(ctx.db).filter((p) => p.active && p.kind === 'AUTOMATIC' && promotionLive(ctx.db, p, o.branchId, o.channel, ctx.now));
    let coded: PromotionX | undefined;
    if (code) { coded = findByCode(ctx.db, code); if (!coded) throw new ApiError('PROMOTION_CODE_INVALID'); }
    const items = [...list, ...(coded ? [coded] : [])].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)).map((p) => {
      const onCheck = o.discounts.find((d) => d.active && d.promotionId === p.id) ?? null;
      const removed = o.discounts.some((d) => !d.active && d.promotionId === p.id && d.removedBy);
      const r = onCheck || o.status !== 'DRAFT' ? null : promotionRefusal(ctx, o, p, { code: p.kind === 'CODED' ? code : null });
      const v = promotionView(ctx, p);
      return {
        promotionId: p.id, name: p.name, kind: p.kind, mechanic: v.mechanic, summary: v.summary, description: p.description ?? null, priority: p.priority ?? 100, stacking: v.stacking,
        customerScope: v.customerScope, onCheck: !!onCheck, discountId: onCheck?.id ?? null, removedOnThisCheck: removed,
        applicable: !onCheck && !r && o.status === 'DRAFT', refusal: r ? { code: r.code, rule: r.rule, details: r.details ?? null } : null,
        amount: onCheck ? (computeLiveTotals(o).discountLines?.find((x) => x.discountId === onCheck.id)?.amount ?? m4(0)) : !r && o.status === 'DRAFT' ? promotionPreview(ctx, o, p, code).amount : null,
      };
    });
    return { orderId: o.id, version: o.version, items };
  },
};
