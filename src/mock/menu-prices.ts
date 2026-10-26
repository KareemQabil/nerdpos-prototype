// Price windows per (product[, size], branch, channel) — docs/22 §3 — shared by Catalog.SetPrice and the bulk change.
// E = window starting exactly at F, C = window containing F, N = next window starting after F.
import { ApiError } from './errors';
import { nextId } from './store';
import { D, m4 } from './money';
import type { Channel, DB, PriceRule } from './types';

export interface PricePlan {
  productId: string; variantId: string | null; branchId: string; channel: Channel; amount: string; from: number; end: number | null;
  E: PriceRule | null; C: PriceRule | null; changeKind: 'FIRST_PRICE' | 'CHANGE' | 'CORRECTION'; old: string | null; changePercent: string | null; firstPrice: boolean;
}

/** Plans one price window; throws PRICE_SCHEDULE_CONFLICT like the single command. Writes nothing. */
export function planPriceWindow(db: DB, now: number, s: { productId: string; variantId?: string | null; branchId: string; channel: Channel; amount: string; from: number; to: number | null }): PricePlan {
  const variantId = s.variantId ?? null;
  const rules = db.priceRules.filter((r) => r.productId === s.productId && r.branchId === s.branchId && r.channel === s.channel && (r.variantId ?? null) === variantId);
  const E = rules.find((r) => r.effectiveFrom === s.from) ?? null;
  const C = E ? null : rules.find((r) => r.effectiveFrom < s.from && (r.effectiveTo === null || r.effectiveTo > s.from)) ?? null;
  const N = rules.filter((r) => r.effectiveFrom > s.from).sort((x, y) => x.effectiveFrom - y.effectiveFrom)[0] ?? null;
  let changeKind: PricePlan['changeKind'];
  let end: number | null = null;
  if (E) {
    // a started window is never corrected; a scheduled one may be, if its end stays the same
    if (E.effectiveFrom <= now || (s.to !== null && s.to !== E.effectiveTo)) throw new ApiError('PRICE_SCHEDULE_CONFLICT', { conflictingRuleIds: [E.id] });
    changeKind = 'CORRECTION';
  } else {
    end = s.to ?? N?.effectiveFrom ?? null;
    if (N && (end === null || end > N.effectiveFrom)) throw new ApiError('PRICE_SCHEDULE_CONFLICT', { conflictingRuleIds: [N.id] });
    changeKind = rules.some((r) => r.effectiveFrom < s.from) || C ? 'CHANGE' : 'FIRST_PRICE';
  }
  const basis = E ?? C;
  const old = basis?.amount ?? null;
  const changePercent = old && !D(old).isZero() ? D(s.amount).minus(old).abs().dividedBy(old).times(100).toDecimalPlaces(2).toString() : null;
  return { productId: s.productId, variantId, branchId: s.branchId, channel: s.channel, amount: m4(s.amount), from: s.from, end, E, C, changeKind, old, changePercent, firstPrice: changeKind === 'FIRST_PRICE' };
}

/** Applies a plan: correct E, or close C at F and open [F, end). */
export function applyPriceWindow(db: DB, plan: PricePlan, by: string, nowIso: string, freshId: (prefix: string) => string, extra: Partial<PriceRule> = {}): { rule: PriceRule; closedRule: PriceRule | null } {
  if (plan.E) {
    plan.E.amount = plan.amount;
    plan.E.version++;
    return { rule: plan.E, closedRule: null };
  }
  let closedRule: PriceRule | null = null;
  if (plan.C) { plan.C.effectiveTo = plan.from; plan.C.version++; closedRule = plan.C; }
  const rule: PriceRule = { id: freshId('pr'), productId: plan.productId, branchId: plan.branchId, channel: plan.channel, amount: plan.amount, currency: 'EGP', effectiveFrom: plan.from, effectiveTo: plan.end, createdAt: nowIso, createdBy: by, version: 1, replacesRuleId: plan.C?.id ?? null, ...(plan.variantId ? { variantId: plan.variantId } : {}), ...extra };
  db.priceRules.push(rule);
  return { rule, closedRule };
}

export const fallbackId = (prefix: string) => nextId(prefix);
