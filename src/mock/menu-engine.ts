// Menu & pricing engine helpers (server side): dayparts and channel/branch menus, sold-out-for-today with automatic
// reset on the next business day, size prices, rounding steps for bulk price changes, recipe cost lookup.
// Money is always Decimal (decimal.js) and Money strings; never floats.
import { D, m4, Decimal } from './money';
import { businessDate, zonedParts } from './clock';
import { policy } from './policies';
import type { Channel, DB, Loc, Product, Variant } from './types';
import type { MenuDef, MenuState } from './menu-types';

export function menuState(db: DB): MenuState {
  const m = (db.menu ??= { dayparts: [], menus: [], optionAvailability: [], bulkChanges: [] });
  m.dayparts ??= []; m.menus ??= []; m.optionAvailability ??= []; m.bulkChanges ??= [];
  return m;
}

export function branchBusinessDate(db: DB, branchId: string | null | undefined, at: number) {
  const br = db.branches.find((b) => b.id === branchId);
  return businessDate(at, br?.timezone ?? 'Africa/Cairo', br?.businessDayCutoff ?? '04:00');
}

/** SoldOutResetPolicy: NEXT_BUSINESS_DAY (default) puts "sold out today" items back at the start of the next business day. */
export function soldOutResets() {
  return (policy<string>('SoldOutResetPolicy') ?? 'NEXT_BUSINESS_DAY') !== 'MANUAL';
}

/** Availability as the menu sees it now: a "sold out today" row from an earlier business day counts as AVAILABLE. */
export function effectiveAvailability(db: DB, productId: string, branchId: string, at: number) {
  const row = db.availability.find((a) => a.productId === productId && a.branchId === branchId) ?? null;
  if (!row) return null;
  if (row.state === 'SOLD_OUT' && row.soldOutFor && soldOutResets() && row.soldOutFor < branchBusinessDate(db, branchId, at)) {
    return { ...row, state: 'AVAILABLE' as const, reason: null, expired: true };
  }
  return { ...row, expired: false };
}

export function optionSoldOut(db: DB, optionId: string, branchId: string | null, at: number) {
  if (!branchId) return null;
  const row = menuState(db).optionAvailability.find((o) => o.optionId === optionId && o.branchId === branchId);
  if (!row || row.state !== 'SOLD_OUT') return null;
  if (row.soldOutFor && soldOutResets() && row.soldOutFor < branchBusinessDate(db, branchId, at)) return null;
  return row;
}

// ───────── dayparts & menus
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Is the daypart running at `at` (Cairo)? end < start crosses midnight: the part after midnight belongs to the previous day. */
export function daypartActive(dp: { start: string; end: string; days: number[]; active: boolean }, at: number) {
  if (!dp.active) return false;
  const p = zonedParts(at, 'Africa/Cairo');
  const t = p.hour * 60 + p.minute;
  const s = toMin(dp.start), e = toMin(dp.end);
  const days = dp.days?.length ? dp.days : [0, 1, 2, 3, 4, 5, 6];
  if (e > s) return days.includes(p.weekday) && t >= s && t < e;
  return (days.includes(p.weekday) && t >= s) || (days.includes((p.weekday + 6) % 7) && t < e);
}

/** Next start instant of a daypart after `at` (within 8 days), or null. */
export function nextDaypartStart(dp: { start: string; days: number[]; active: boolean }, at: number): number | null {
  if (!dp.active) return null;
  const p = zonedParts(at, 'Africa/Cairo');
  const nowMin = p.hour * 60 + p.minute;
  const s = toMin(dp.start);
  const days = dp.days?.length ? dp.days : [0, 1, 2, 3, 4, 5, 6];
  for (let d = 0; d <= 7; d++) {
    if (!days.includes((p.weekday + d) % 7)) continue;
    const delta = d * 1440 + s - nowMin;
    if (delta > 0) return at - p.second * 1000 + delta * 60_000;
  }
  return null;
}

export function activeDayparts(db: DB, at: number) {
  return menuState(db).dayparts.filter((dp) => daypartActive(dp, at));
}

function menuIncludes(m: MenuDef, p: Product) {
  if (m.excludedProductIds?.includes(p.id)) return false;
  if (m.productIds?.includes(p.id)) return true;
  if (m.excludedCategoryIds?.includes(p.categoryId)) return false;
  return m.allCategories || (m.categoryIds ?? []).includes(p.categoryId);
}

export type MenuCheck =
  | { onMenu: true; menus: { id: string; name: Loc }[]; restricted: boolean; endsAt: number | null }
  | { onMenu: false; reason: 'NOT_ON_ANY_MENU' | 'NOT_IN_BRANCH_MENU' | 'NOT_ON_CHANNEL_MENU' | 'OUTSIDE_MENU_HOURS'; nextStart: number | null; dayparts: Loc[]; reasonAr: string; reasonEn: string };

/**
 * Menus decide what is sellable now. With no active menu at all, nothing is restricted (fresh installs, old data).
 * Otherwise the product must be on at least one active menu for this branch, channel and a running daypart.
 */
export function menuCheck(db: DB, p: Product, branchId: string, channel: Channel, at: number): MenuCheck {
  const ms = menuState(db);
  const active = ms.menus.filter((m) => m.active);
  if (!active.length) return { onMenu: true, menus: [], restricted: false, endsAt: null };
  const withP = active.filter((m) => menuIncludes(m, p));
  if (!withP.length) return { onMenu: false, reason: 'NOT_ON_ANY_MENU', nextStart: null, dayparts: [], reasonAr: 'الصنف مش على أي منيو شغال', reasonEn: 'Not on any active menu' };
  const inBranch = withP.filter((m) => !m.branchIds?.length || m.branchIds.includes(branchId));
  if (!inBranch.length) return { onMenu: false, reason: 'NOT_IN_BRANCH_MENU', nextStart: null, dayparts: [], reasonAr: 'الصنف مش على منيو الفرع ده', reasonEn: 'Not on this branch menu' };
  const inChannel = inBranch.filter((m) => m.channels.includes(channel));
  if (!inChannel.length) return { onMenu: false, reason: 'NOT_ON_CHANNEL_MENU', nextStart: null, dayparts: [], reasonAr: `الصنف مش متاح في ${channelAr(channel)}`, reasonEn: `Not on the ${channel} menu` };
  const dps = ms.dayparts;
  const runningNow = inChannel.filter((m) => !m.daypartIds?.length || m.daypartIds.some((id) => { const dp = dps.find((d) => d.id === id); return dp ? daypartActive(dp, at) : false; }));
  if (runningNow.length) {
    // when does it leave the menu? only when every running menu is daypart-bound
    const allDay = runningNow.some((m) => !m.daypartIds?.length);
    let endsAt: number | null = null;
    if (!allDay) {
      for (const m of runningNow) for (const id of m.daypartIds) {
        const dp = dps.find((d) => d.id === id);
        if (dp && daypartActive(dp, at)) { const e = daypartEnd(dp, at); if (e && (endsAt === null || e > endsAt)) endsAt = e; }
      }
    }
    return { onMenu: true, menus: runningNow.map((m) => ({ id: m.id, name: m.name })), restricted: !allDay, endsAt };
  }
  const candidates = inChannel.flatMap((m) => m.daypartIds.map((id) => dps.find((d) => d.id === id)).filter(Boolean)) as MenuState['dayparts'];
  const starts = candidates.map((dp) => nextDaypartStart(dp, at)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const names = [...new Map(candidates.map((d) => [d.id, d.name])).values()];
  const nextStart = starts[0] ?? null;
  const hhmm = nextStart ? hm(nextStart) : null;
  return {
    onMenu: false, reason: 'OUTSIDE_MENU_HOURS', nextStart, dayparts: names,
    reasonAr: `الصنف ده في منيو ${names.map((n) => n.ar).join(' / ')} بس${hhmm ? ` — يرجع الساعة ${hhmm}` : ''}`,
    reasonEn: `Only on the ${names.map((n) => n.en).join(' / ')} menu${hhmm ? ` — back at ${hhmm}` : ''}`,
  };
}

function daypartEnd(dp: { start: string; end: string }, at: number): number {
  const p = zonedParts(at, 'Africa/Cairo');
  const nowMin = p.hour * 60 + p.minute;
  const e = toMin(dp.end);
  let delta = e - nowMin;
  if (delta <= 0) delta += 1440;
  return at - p.second * 1000 + delta * 60_000;
}

export const hm = (ms: number) => { const p = zonedParts(ms, 'Africa/Cairo'); return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`; };
export const channelAr = (c: string) => ({ DINE_IN: 'الصالة', TAKEAWAY: 'التيك أواي', DELIVERY: 'الدليفري' } as Record<string, string>)[c] ?? c;

// ───────── sizes & prices
export function activeVariants(p: Product): Variant[] {
  return (p.variants ?? []).filter((v) => v.active).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
export function defaultVariant(p: Product): Variant | null {
  const vs = activeVariants(p);
  return vs.find((v) => v.isDefault) ?? vs.find((v) => v.id === 'v_m') ?? vs[0] ?? null;
}
/** The same size on another product (pizza halves): by id, else by position. */
export function matchingVariant(other: Product, v: Variant | null, from: Product): Variant | null {
  if (!v) return defaultVariant(other);
  const ov = activeVariants(other);
  return ov.find((x) => x.id === v.id) ?? ov[activeVariants(from).findIndex((x) => x.id === v.id)] ?? defaultVariant(other);
}

export function ruleAt(db: DB, productId: string, branchId: string, channel: Channel, at: number, variantId: string | null = null) {
  return db.priceRules.find((r) => r.productId === productId && r.branchId === branchId && r.channel === channel && (r.variantId ?? null) === variantId && r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo > at)) ?? null;
}

/** Unit price of a product (and size) in a scope: the size's own price rule, else the product price + size delta. */
export function priceFor(db: DB, p: Product, v: Variant | null, branchId: string, channel: Channel, at: number): { amount: string; ruleId: string; source: 'SIZE_PRICE' | 'PRODUCT_PRICE' } | null {
  if (v) {
    const own = ruleAt(db, p.id, branchId, channel, at, v.id);
    if (own) return { amount: own.amount, ruleId: own.id, source: 'SIZE_PRICE' };
  }
  const base = ruleAt(db, p.id, branchId, channel, at, null);
  if (!base) return null;
  return { amount: m4(D(base.amount).plus(v ? D(v.priceDelta) : 0)), ruleId: base.id, source: 'PRODUCT_PRICE' };
}

// ───────── bulk price rounding
/** Round to a step (0.25 / 0.50 / 1.00 / 5.00 …): NEAREST (half up), UP or DOWN. step "0" or empty = cents. */
export function roundToStep(v: Decimal.Value, step: string, direction: 'NEAREST' | 'UP' | 'DOWN'): string {
  const s = D(step || '0');
  if (s.lte(0)) return m4(D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  const q = D(v).dividedBy(s);
  const n = direction === 'UP' ? q.toDecimalPlaces(0, Decimal.ROUND_CEIL) : direction === 'DOWN' ? q.toDecimalPlaces(0, Decimal.ROUND_FLOOR) : q.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return m4(n.times(s));
}

// ───────── recipe cost (another area builds inventory/recipes; read it only if it exists)
export function recipeCostOf(db: DB, productId: string, variantId: string | null = null): string | null {
  try {
    const anyDb = db as any;
    const recipes: any[] = anyDb.recipes ?? anyDb.inventory?.recipes ?? [];
    const r = recipes.find((x) => (x.productId === productId || x.outputProductId === productId) && (variantId ? (x.variantId ?? null) === variantId || !x.variantId : !x.variantId) && x.active !== false);
    if (!r) return null;
    const v = r.cost ?? r.unitCost ?? r.costPerUnit ?? r.currentCost ?? r.versions?.at?.(-1)?.cost ?? null;
    if (v === null || v === undefined) return null;
    const c = D(typeof v === 'object' ? v.amount ?? v.total ?? 0 : v);
    return c.gt(0) ? m4(c) : null;
  } catch { return null; }
}
export function marginPercent(price: string, cost: string | null): string | null {
  if (!cost || D(price).lte(0)) return null;
  return D(price).minus(cost).dividedBy(price).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}
