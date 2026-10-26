// Full promotion model (Promotion.Upsert, PD-held): order / item / buy-X-get-Y benefits, item and category scope,
// channels, branches, dayparts, several codes, usage limits and stacking. Used by catalog.ts (admin) and orders.ts
// (applying a promotion to a check). Pricing of item promotions lives in ../promo-engine.ts.
import { ApiError } from '../errors';
import type { Ctx } from '../kernel';
import { nextId, hist } from '../store';
import { policy } from '../policies';
import { D, m4, isMoney } from '../money';
import { checkVersion, need } from './util';
import { computeLiveTotals } from '../pricing';
import { promotionLive, usageOf, promoAmount, ruleOf, discountFor, promoSummary, dayparts } from '../promo-engine';
import type { Channel, DB, Order } from '../types';
import type { PromotionX } from '../types-ops';

const CH: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
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
  need(['ORDER', 'ITEMS', 'BUY_X_GET_Y'].includes(mechanic), 'VALIDATION_FAILED', { field: 'mechanic' });
  const benefitType = b.benefitType ?? 'PERCENTAGE';
  const benefitValue = String(b.benefitValue ?? (mechanic === 'BUY_X_GET_Y' ? '100' : ''));
  need(['PERCENTAGE', 'FIXED_AMOUNT'].includes(benefitType), 'VALIDATION_FAILED', { field: 'benefitType' });
  if (mechanic !== 'BUY_X_GET_Y') need(isMoney(benefitValue) && D(benefitValue).gt(0) && (benefitType !== 'PERCENTAGE' || D(benefitValue).lte(100)), 'VALIDATION_FAILED', { field: 'benefitValue', rule: 'PERCENTAGE 0 < v <= 100, FIXED_AMOUNT > 0' });
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
  const channels: Channel[] = (b.channels ?? []).filter((c: Channel) => CH.includes(c));
  need(channels.length > 0, 'VALIDATION_FAILED', { field: 'channels' });
  const branchIds: string[] = b.branchIds ?? [];
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
  const maxUses = b.maxUses ? Math.floor(Number(b.maxUses)) : null;
  const maxUsesPerDay = b.maxUsesPerDay ? Math.floor(Number(b.maxUsesPerDay)) : null;
  if (maxUses !== null) need(maxUses >= 1, 'VALIDATION_FAILED', { field: 'maxUses' });
  if (maxUsesPerDay !== null) need(maxUsesPerDay >= 1, 'VALIDATION_FAILED', { field: 'maxUsesPerDay' });
  if (b.minSubtotal) need(isMoney(String(b.minSubtotal)), 'VALIDATION_FAILED', { field: 'minSubtotal' });
  if (b.maxDiscount) need(isMoney(String(b.maxDiscount)) && D(b.maxDiscount).gt(0), 'VALIDATION_FAILED', { field: 'maxDiscount' });
  const validFrom = b.validFrom ? Date.parse(b.validFrom) : null, validTo = b.validTo ? Date.parse(b.validTo) : null;
  if (validFrom && validTo) need(validTo > validFrom, 'VALIDATION_FAILED', { field: 'validTo', rule: 'after validFrom' });
  const rec: PromotionX = {
    id, name: { ar: String(b.name.ar).trim(), en: String(b.name.en || b.name.ar).trim() }, kind, code: codes[0] ?? null, codes,
    benefitType: mechanic === 'BUY_X_GET_Y' ? 'PERCENTAGE' : benefitType, benefitValue: mechanic === 'BUY_X_GET_Y' ? getPercent : benefitValue,
    branchIds, channels, minSubtotal: b.minSubtotal ? m4(b.minSubtotal) : null, schedule: dp[0] ?? null, dayparts: dp, validFrom, validTo,
    active: b.active ?? existing?.active ?? true, version: (existing?.version ?? 0) + 1,
    mechanic, productIds, categoryIds, buyQty, getQty, getPercent, getProductIds: (b.getProductIds ?? []).filter((x: string) => ctx.db.products.some((p) => p.id === x)), getCategoryIds: (b.getCategoryIds ?? []).filter((x: string) => ctx.db.categories.some((c) => c.id === x)),
    maxDiscount: b.maxDiscount ? m4(b.maxDiscount) : null, maxUses, maxUsesPerDay, stacking: b.stacking === 'STACKABLE' ? 'STACKABLE' : 'EXCLUSIVE', priority: Number(b.priority ?? 100),
    description: b.description?.ar ? { ar: String(b.description.ar), en: String(b.description.en ?? b.description.ar) } : null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id,
  };
  if (existing) Object.assign(existing, rec); else ctx.db.promotions.push(rec);
  ctx.audit(`promotion ${rec.name.ar} v${rec.version}`, id);
  return { status: existing ? 200 : 201, body: promotionView(ctx, existing ?? rec) };
}

export function promotionView(ctx: Ctx, p: PromotionX) {
  const bd = ctx.businessDate();
  const pn = (id: string) => ctx.db.products.find((x) => x.id === id)?.name.ar ?? id;
  const cn = (id: string) => ctx.db.categories.find((x) => x.id === id)?.name.ar ?? id;
  return {
    ...p, codes: codesOf(p), mechanic: p.mechanic ?? 'ORDER', dayparts: dayparts(p), stacking: p.stacking ?? 'EXCLUSIVE',
    liveNow: (['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as Channel[]).some((c) => promotionLive(ctx.db, p, ctx.branchId, c, ctx.now)),
    usage: { total: usageOf(ctx.db, p.id), today: usageOf(ctx.db, p.id, bd) }, summary: promoSummary(p, pn, cn),
    exhausted: (p.maxUses ? usageOf(ctx.db, p.id) >= p.maxUses : false) || (p.maxUsesPerDay ? usageOf(ctx.db, p.id, bd) >= p.maxUsesPerDay : false),
  };
}

/** Every condition a promotion must meet on this check; returns the discount line to add. */
export function promotionForOrder(ctx: Ctx, o: Order, p: PromotionX, by: string) {
  if (!promotionLive(ctx.db, p, o.branchId, o.channel, ctx.now)) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'not valid now for this branch / channel' });
  if (p.maxUses && usageOf(ctx.db, p.id) >= p.maxUses) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'usage limit reached', maxUses: p.maxUses });
  if (p.maxUsesPerDay && usageOf(ctx.db, p.id, o.businessDate) >= p.maxUsesPerDay) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'daily usage limit reached', maxUsesPerDay: p.maxUsesPerDay });
  if (o.discounts.some((d) => d.active && d.promotionId === p.id)) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'already on this check' });
  const st = policy<{ mode: string }>('DiscountStackingPolicy') ?? { mode: 'NO_STACKING' };
  const others = o.discounts.filter((d) => d.active);
  if (others.length) {
    if (st.mode === 'NO_STACKING') throw new ApiError('DISCOUNT_STACKING_NOT_ALLOWED');
    const exclusiveOther = others.some((d) => (all(ctx.db).find((x) => x.id === d.promotionId)?.stacking ?? 'EXCLUSIVE') === 'EXCLUSIVE' && d.promotionId);
    if ((p.stacking ?? 'EXCLUSIVE') === 'EXCLUSIVE' || exclusiveOther) throw new ApiError('DISCOUNT_STACKING_NOT_ALLOWED', { reason: 'promotion does not combine' });
  }
  const pre = computeLiveTotals(o);
  const eligible = D(pre.itemsSubtotal).plus(pre.serviceCharge);
  if (p.minSubtotal && eligible.lt(p.minSubtotal)) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'minimum subtotal', minSubtotal: p.minSubtotal });
  const rule = ruleOf(p);
  if (rule.mechanic !== 'ORDER' && promoAmount(o, rule, o.policy.rounding.scale, o.policy.rounding.mode).isZero()) throw new ApiError('PROMOTION_NOT_APPLICABLE', { reason: 'no qualifying items on the check' });
  return discountFor(p, by, ctx.nowIso, nextId('disc'));
}

/** AUTOMATIC promotions when DiscountStackingPolicy.autoApply is on: applied on create and re-checked as lines change. */
export function autoApplyPromotions(ctx: Ctx, o: Order) {
  const st = policy<{ mode: string; autoApply: boolean }>('DiscountStackingPolicy') ?? { mode: 'NO_STACKING', autoApply: false };
  if (!st.autoApply || o.status !== 'DRAFT') return;
  const cands = all(ctx.db).filter((p) => p.kind === 'AUTOMATIC' && promotionLive(ctx.db, p, o.branchId, o.channel, ctx.now)).sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const p of cands) {
    if (o.discounts.some((d) => d.active && d.promotionId === p.id)) continue;
    if (o.discounts.some((d) => d.active) && st.mode === 'NO_STACKING') return;
    const rule = ruleOf(p);
    // item promotions wait for qualifying items; an order-wide one goes on at once (existing behaviour)
    if (rule.mechanic !== 'ORDER' && promoAmount(o, rule).isZero()) continue;
    try {
      const d = promotionForOrder(ctx, o, p, 'system');
      o.discounts.push(d);
      o.history.push(hist('system', 'PROMOTION', { ar: `اتطبق عرض أوتوماتيك: ${p.name.ar}`, en: `auto promotion: ${p.name.en}` }));
    } catch { /* conditions not met (minimum, limits): skip */ }
  }
}
