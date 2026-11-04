// Promotion engine: which promotions are live, and how much an item / buy-X-get-Y promotion takes off a check.
// The discount captured on the check keeps a copy of the promotion rule (later edits never rewrite it), and the
// amount is recomputed from the check's current lines while the check is open (frozen at confirmation).
import { D, m4, round, pct, type RoundingMode } from './money';
import { zonedParts } from './clock';
import type { DB, Order, Channel, OrderDiscount, Loc } from './types';
import type { PromotionRule, PromotionX } from './types-ops';
import type Decimal from 'decimal.js';

export function ruleOf(pr: PromotionX): PromotionRule {
  return {
    mechanic: pr.mechanic ?? 'ORDER', benefitType: pr.benefitType, benefitValue: pr.benefitValue,
    productIds: pr.productIds ?? [], categoryIds: pr.categoryIds ?? [],
    buyQty: Number(pr.buyQty ?? 1), getQty: Number(pr.getQty ?? 1), getPercent: String(pr.getPercent ?? '100'),
    getProductIds: pr.getProductIds ?? [], getCategoryIds: pr.getCategoryIds ?? [], maxDiscount: pr.maxDiscount ?? null,
    bundleParts: (pr.bundleParts ?? []).map((x) => ({ productIds: x.productIds ?? [], categoryIds: x.categoryIds ?? [], qty: Math.max(1, Math.floor(Number(x.qty ?? 1))) })),
    bundlePrice: pr.bundlePrice ?? null, maxPerCheck: pr.maxPerCheck ?? null,
  };
}

export const dayparts = (pr: PromotionX) => (pr.dayparts?.length ? pr.dayparts : pr.schedule ? [pr.schedule] : []);

function inWindow(ms: number, s: { days: number[]; start: string; end: string }, tz: string) {
  const p = zonedParts(ms, tz);
  const t = p.hour * 60 + p.minute;
  const [sh, sm] = s.start.split(':').map(Number);
  const [eh, em] = s.end.split(':').map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  if (b > a) return s.days.includes(p.weekday) && t >= a && t < b;
  return (s.days.includes(p.weekday) && t >= a) || (s.days.includes((p.weekday + 6) % 7) && t < b);
}

/** Live now for a branch and channel (active, dates, dayparts). Usage limits are checked separately. */
export function promotionLive(db: DB, pr: PromotionX, branchId: string | null, channel: Channel, nowMs: number): boolean {
  if (!pr.active) return false;
  if (branchId && pr.branchIds.length && !pr.branchIds.includes(branchId)) return false;
  if (!pr.channels.includes(channel)) return false;
  if (pr.validFrom && nowMs < pr.validFrom) return false;
  if (pr.validTo && nowMs >= pr.validTo) return false;
  const tz = db.branches.find((b) => b.id === branchId)?.timezone ?? 'Africa/Cairo';
  const dp = dayparts(pr);
  return dp.length === 0 || dp.some((s) => inWindow(nowMs, s, tz));
}

/** How many checks used the promotion (open or completed; cancelled/voided checks do not count). */
export function usageOf(db: DB, promotionId: string, businessDate?: string) {
  return db.orders.filter((o) => o.status !== 'CANCELLED' && o.status !== 'VOIDED' && o.status !== 'MERGED' && (!businessDate || o.businessDate === businessDate) && o.discounts.some((d) => d.active && d.promotionId === promotionId)).length;
}

const inScope = (l: Order['lines'][number], productIds: string[], categoryIds: string[]) =>
  (productIds.length === 0 && categoryIds.length === 0) || productIds.includes(l.productId) || categoryIds.includes(l.categoryId);

/** Amount an ITEMS / BUY_X_GET_Y / BUNDLE rule takes off the current active lines. ORDER rules are priced by the caller.
 *  ux-15: `maxPerCheck` caps the discounted units (ITEMS), groups (BUY_X_GET_Y) or sets (BUNDLE); `rule.rounding`
 *  DOWN (PromotionPolicy.rounding, captured when applied) never rounds a percentage up. All Decimal, never floats. */
export function promoAmount(order: Order, rule: PromotionRule, scale = 2, mode: RoundingMode = 'HALF_UP'): Decimal {
  const lines = order.lines.filter((l) => l.status === 'ACTIVE');
  const rmode: RoundingMode = rule.rounding === 'DOWN' ? 'DOWN' : mode;
  const cap = rule.maxPerCheck && rule.maxPerCheck > 0 ? rule.maxPerCheck : Infinity;
  let amount = D(0);
  const units = (pIds: string[], cIds: string[]) => {
    const out: Decimal[] = [];
    for (const l of lines) if (inScope(l, pIds, cIds)) for (let i = 0; i < Math.floor(Number(l.quantity)); i++) out.push(D(l.unitTotal));
    return out.sort((a, b) => b.comparedTo(a));
  };
  if (rule.mechanic === 'ITEMS') {
    if (cap === Infinity) {
      for (const l of lines) {
        if (!inScope(l, rule.productIds, rule.categoryIds)) continue;
        const off = rule.benefitType === 'PERCENTAGE' ? D(round(pct(l.lineTotal, rule.benefitValue), scale, rmode)) : D(rule.benefitValue).times(D(l.quantity));
        amount = amount.plus(off.greaterThan(D(l.lineTotal)) ? D(l.lineTotal) : off);
      }
    } else {
      // capped: the cheapest qualifying units first (the restaurant never gives more than the cap on its dearest items)
      for (const u of units(rule.productIds, rule.categoryIds).reverse().slice(0, cap)) {
        const off = rule.benefitType === 'PERCENTAGE' ? D(round(pct(u, rule.benefitValue), scale, rmode)) : D(rule.benefitValue);
        amount = amount.plus(off.greaterThan(u) ? u : off);
      }
    }
  } else if (rule.mechanic === 'BUY_X_GET_Y') {
    const x = Math.max(1, rule.buyQty), y = Math.max(1, rule.getQty);
    const sameScope = rule.getProductIds.length === 0 && rule.getCategoryIds.length === 0;
    let free: Decimal[] = [];
    if (sameScope) {
      // groups of x+y units, most expensive first: in each group the y cheapest are discounted
      const u = units(rule.productIds, rule.categoryIds);
      for (let g = 0, n = 0; g + x + y <= u.length && n < cap; g += x + y, n++) free.push(...u.slice(g + x, g + x + y));
    } else {
      const buy = units(rule.productIds, rule.categoryIds).length;
      const get = units(rule.getProductIds, rule.getCategoryIds).reverse(); // cheapest first
      free = get.slice(0, Math.min(Math.floor(buy / x), cap) * y);
    }
    for (const p of free) amount = amount.plus(D(round(pct(p, rule.getPercent), scale, rmode)));
  } else if (rule.mechanic === 'BUNDLE' && rule.bundleParts?.length && rule.bundlePrice) {
    // a set = qty units of every part; each part takes its cheapest units first and a unit counts in one part only
    // (PROTOTYPE_GAPS §15l: the restaurant-safe selection). Discount per set = the set's prices − the set price (≥ 0).
    const pools = rule.bundleParts.map(() => [] as { key: string; price: Decimal }[]);
    lines.forEach((l) => { for (let i = 0; i < Math.floor(Number(l.quantity)); i++) rule.bundleParts!.forEach((pt, k) => { if (inScope(l, pt.productIds, pt.categoryIds)) pools[k].push({ key: `${l.id}#${i}`, price: D(l.unitTotal) }); }); });
    pools.forEach((pl) => pl.sort((a, b) => a.price.comparedTo(b.price) || a.key.localeCompare(b.key)));
    const used = new Set<string>();
    for (let n = 0; n < cap; n++) {
      const pick: { key: string; price: Decimal }[] = [];
      let complete = true;
      rule.bundleParts.forEach((pt, k) => {
        if (!complete) return;
        const got = pools[k].filter((u) => !used.has(u.key) && !pick.some((x) => x.key === u.key)).slice(0, pt.qty);
        if (got.length < pt.qty) complete = false; else pick.push(...got);
      });
      if (!complete) break;
      pick.forEach((u) => used.add(u.key));
      const sum = pick.reduce((a, u) => a.plus(u.price), D(0));
      if (sum.greaterThan(D(rule.bundlePrice))) amount = amount.plus(sum.minus(D(rule.bundlePrice)));
    }
  }
  if (rule.maxDiscount && amount.greaterThan(D(rule.maxDiscount))) amount = D(rule.maxDiscount);
  return amount;
}

/** The discount line a promotion puts on a check. */
export function discountFor(pr: PromotionX, by: string, nowIso: string, id: string, opts: { code?: string | null; rounding?: 'DOWN' | 'CHECK'; stackBase?: 'REMAINDER' | 'ORIGINAL' } = {}): OrderDiscount & { rule?: PromotionRule } {
  const rule = { ...ruleOf(pr), ...(opts.rounding ? { rounding: opts.rounding } : {}) };
  const base: OrderDiscount & { rule?: PromotionRule } = { id, type: pr.benefitType, value: pr.benefitValue, reasonCode: 'PROMOTION', appliedAt: nowIso, appliedBy: by, active: true, promotionId: pr.id, label: pr.name as Loc,
    promotionVersion: pr.version, code: opts.code ?? null, ...(opts.rounding ? { rounding: opts.rounding } : {}), ...(opts.stackBase ? { stackBase: opts.stackBase } : {}) };
  if (rule.mechanic !== 'ORDER') { base.rule = rule; base.type = 'FIXED_AMOUNT'; base.value = '0'; }
  return base;
}

/** Plain one-liner of what a promotion gives ({ar, en}; English names come from the optional en callbacks). */
export function promoSummary(pr: PromotionX, productName: (id: string) => string, categoryName: (id: string) => string, productNameEn: (id: string) => string = productName, categoryNameEn: (id: string) => string = categoryName): Loc {
  const r = ruleOf(pr);
  const scope = (p: string[], c: string[]) => [...p.map(productName), ...c.map(categoryName)].join('، ');
  const scopeEn = (p: string[], c: string[]) => [...p.map(productNameEn), ...c.map(categoryNameEn)].join(', ');
  const benefit = r.benefitType === 'PERCENTAGE' ? `${Number(r.benefitValue)}%` : `${Number(r.benefitValue)} ج.م`;
  const benefitEn = r.benefitType === 'PERCENTAGE' ? `${Number(r.benefitValue)}%` : `${Number(r.benefitValue)} EGP`;
  if (r.mechanic === 'ITEMS') return { ar: `خصم ${benefit} على ${scope(r.productIds, r.categoryIds) || 'جميع الأصناف'}`, en: `${benefitEn} off ${scopeEn(r.productIds, r.categoryIds) || 'all items'}` };
  if (r.mechanic === 'BUY_X_GET_Y') {
    const get = r.getProductIds.length || r.getCategoryIds.length ? scope(r.getProductIds, r.getCategoryIds) : scope(r.productIds, r.categoryIds) || 'أي صنف';
    const getEn = r.getProductIds.length || r.getCategoryIds.length ? scopeEn(r.getProductIds, r.getCategoryIds) : scopeEn(r.productIds, r.categoryIds) || 'any item';
    const off = Number(r.getPercent) >= 100 ? 'مجانًا' : `بخصم ${Number(r.getPercent)}%`;
    return { ar: `اشترِ ${r.buyQty} من ${scope(r.productIds, r.categoryIds) || 'أي صنف'} واحصل على ${r.getQty} من ${get} ${off}`, en: `Buy ${r.buyQty} ${scopeEn(r.productIds, r.categoryIds) || 'of any item'}, get ${r.getQty} ${getEn} ${Number(r.getPercent) >= 100 ? 'free' : r.getPercent + '% off'}` };
  }
  if (r.mechanic === 'BUNDLE') {
    const parts = (r.bundleParts ?? []).map((x) => `${x.qty} × ${scope(x.productIds, x.categoryIds) || 'أي صنف'}`).join(' + ');
    const partsEn = (r.bundleParts ?? []).map((x) => `${x.qty} × ${scopeEn(x.productIds, x.categoryIds) || 'any item'}`).join(' + ');
    return { ar: `${parts} بسعر ${Number(r.bundlePrice ?? 0)} ج.م`, en: `${partsEn} for ${Number(r.bundlePrice ?? 0)} EGP` };
  }
  return { ar: `خصم ${benefit} على الشيك كله`, en: `${benefitEn} off the whole check` };
}

export { m4 };
