// Server-side pricing: item quotes and check totals. The browser never computes a price.
import { ApiError } from './errors';
import { D, m4, round, add, sub, pct, allocate, ZERO, gt, minM, isZero } from './money';
import { policy, channelPolicy } from './policies';
import type { DB, Channel, Order, OrderLine, PolicySnapshot, Product, ServiceCapture, Totals, LineModifier, ChargeComponent } from './types';

export interface QuoteInput { branchId: string; channel: Channel; productId: string; quantity: string; modifierOptionIds: string[]; variantId?: string | null; halfProductId?: string | null; comboSelections?: Record<string, { productId: string; modifierOptionIds?: string[] }>; at: number }
export interface Quote {
  productId: string; branchId: string; channel: Channel; quantity: string; currency: 'EGP';
  unitPrice: string; modifiers: LineModifier[]; unitTotal: string; lineTotal: string; priceRuleId: string;
  tax: { taxPolicyId: string; rate: string; mode: string; version: number };
  variant: { id: string; name: { ar: string; en: string }; priceDelta: string } | null;
  children: OrderLine['children'];
  quotedAt: string;
}

export function priceRuleAt(db: DB, productId: string, branchId: string, channel: Channel, at: number) {
  return db.priceRules.find((r) => r.productId === productId && r.branchId === branchId && r.channel === channel && r.effectiveFrom <= at && (r.effectiveTo === null || r.effectiveTo > at)) ?? null;
}

export function availabilityOf(db: DB, productId: string, branchId: string) {
  return db.availability.find((a) => a.productId === productId && a.branchId === branchId) ?? null;
}

export function quoteItem(db: DB, input: QuoteInput): Quote {
  const product = db.products.find((p) => p.id === input.productId);
  if (!product || !product.active) throw new ApiError('CATALOG_PRODUCT_NOT_FOUND', { productId: input.productId });
  const unit = db.units.find((u) => u.id === product.unitId);
  if (!unit) throw new ApiError('CATALOG_UNIT_NOT_FOUND');
  const qty = D(input.quantity || '1');
  if (qty.lte(0)) throw new ApiError('VALIDATION_FAILED', { field: 'quantity', rule: '> 0' });
  if (qty.decimalPlaces() > unit.precision) throw new ApiError('QUANTITY_PRECISION_UNSUPPORTED', { precision: unit.precision });
  const av = availabilityOf(db, product.id, input.branchId);
  if (av && av.state !== 'AVAILABLE') throw new ApiError('PRODUCT_UNAVAILABLE', { productId: product.id, state: av.state, reason: av.reason ?? null });
  const rule = priceRuleAt(db, product.id, input.branchId, input.channel, input.at);
  if (!rule) throw new ApiError('PRICE_NOT_FOUND', { productId: product.id, branchId: input.branchId, channel: input.channel });
  if (!av) throw new ApiError('PRODUCT_UNAVAILABLE', { productId: product.id, state: 'NOT_ON_BRANCH_MENU', rule: 'NewProductAvailabilityPolicy EXPLICIT_PER_BRANCH: activate the product on this branch' });
  const tax = product.taxPolicyId ? db.taxPolicies.find((t) => t.id === product.taxPolicyId) : null;
  if (!tax || !tax.active) throw new ApiError('TAX_POLICY_NOT_FOUND', { productId: product.id });

  // variant (size) — direction D1
  let variant: Quote['variant'] = null;
  let modMultiplier = D(1);
  if (product.variants?.length) {
    const v = product.variants.find((x) => x.id === (input.variantId ?? 'v_m')) ?? product.variants[0];
    variant = { id: v.id, name: v.name, priceDelta: v.priceDelta };
    modMultiplier = D(v.modifierMultiplier);
  }
  let base = D(rule.amount).plus(variant ? D(variant.priceDelta) : 0);

  // half-and-half — direction D1
  const children: NonNullable<OrderLine['children']> = [];
  if (input.halfProductId) {
    const other = db.products.find((p) => p.id === input.halfProductId);
    const otherRule = other ? priceRuleAt(db, other.id, input.branchId, input.channel, input.at) : null;
    if (!other || !otherRule || !product.halfAndHalf || !other.halfAndHalf) throw new ApiError('MODIFIER_SELECTION_INVALID', { reason: 'half-and-half not allowed for these products' });
    const otherBase = D(otherRule.amount).plus(variant ? D(variant.priceDelta) : 0);
    const mode = policy<string>('HalfAndHalfPricingPolicy') ?? 'HIGHER_HALF';
    const chosen = mode === 'AVERAGE' ? base.plus(otherBase).dividedBy(2) : (base.greaterThan(otherBase) ? base : otherBase);
    children.push({ kind: 'HALF', name: product.name, productId: product.id, upcharge: ZERO, detail: { ar: 'النص الأول', en: 'first half' } });
    children.push({ kind: 'HALF', name: other.name, productId: other.id, upcharge: ZERO, detail: { ar: `النص التاني · السعر ${mode === 'AVERAGE' ? 'متوسط' : 'الأغلى'}`, en: `second half · price ${mode}` } });
    base = chosen;
  }

  // modifiers
  const mods: LineModifier[] = [];
  const groups = product.modifierGroupIds.map((g) => db.modifierGroups.find((x) => x.id === g)).filter(Boolean) as DB['modifierGroups'];
  const chosen = new Set(input.modifierOptionIds ?? []);
  for (const g of groups) {
    const picked = g.options.filter((o) => chosen.has(o.id));
    if (picked.length < g.min || picked.length > g.max || (g.selectionRule === 'SINGLE' && picked.length > 1)) {
      throw new ApiError('MODIFIER_SELECTION_INVALID', { groupId: g.id, group: g.name, min: g.min, max: g.max, picked: picked.length });
    }
    for (const o of picked) {
      if (!o.active || !g.active) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: o.id });
      mods.push({ optionId: o.id, groupId: g.id, name: o.name, priceDelta: m4(D(o.priceDelta).times(modMultiplier)) });
      chosen.delete(o.id);
    }
  }
  if (chosen.size) throw new ApiError('MODIFIER_SELECTION_INVALID', { unknownOptions: [...chosen] });

  // combo slots — direction D1 (swaps with upcharge, nested choice one level deep)
  if (product.combo?.length) {
    for (const slot of product.combo) {
      const sel = input.comboSelections?.[slot.id] ?? { productId: slot.defaultProductId, modifierOptionIds: [] };
      const opt = slot.options.find((o) => o.productId === sel.productId);
      if (!opt) throw new ApiError('MODIFIER_SELECTION_INVALID', { slot: slot.id });
      const sp = db.products.find((p) => p.id === opt.productId)!;
      let nestedDetail: { ar: string; en: string } | undefined;
      let nestedDelta = D(0);
      if (opt.nestedGroupId) {
        const ng = db.modifierGroups.find((g) => g.id === opt.nestedGroupId)!;
        const picks = ng.options.filter((o) => (sel.modifierOptionIds ?? []).includes(o.id));
        if (picks.length < ng.min || picks.length > ng.max) throw new ApiError('MODIFIER_SELECTION_INVALID', { slot: slot.id, nestedGroup: ng.id });
        nestedDelta = picks.reduce((a, o) => a.plus(D(o.priceDelta)), D(0));
        nestedDetail = { ar: picks.map((p) => p.name.ar).join('، '), en: picks.map((p) => p.name.en).join(', ') };
      }
      children.push({ kind: 'COMBO_SLOT', name: { ar: `${slot.name.ar}: ${sp.name.ar}`, en: `${slot.name.en}: ${sp.name.en}` }, productId: sp.id, upcharge: m4(D(opt.upcharge).plus(nestedDelta)), detail: nestedDetail });
      base = base.plus(D(opt.upcharge)).plus(nestedDelta);
    }
  }

  const unitTotal = base.plus(mods.reduce((a, m) => a.plus(D(m.priceDelta)), D(0)));
  return {
    productId: product.id, branchId: input.branchId, channel: input.channel, quantity: qty.toString(), currency: 'EGP',
    unitPrice: m4(base), modifiers: mods, unitTotal: m4(unitTotal), lineTotal: m4(unitTotal.times(qty)), priceRuleId: rule.id,
    tax: { taxPolicyId: tax.id, rate: tax.rate, mode: tax.calculationMode, version: tax.version }, variant, children: children.length ? children : undefined,
    quotedAt: new Date(input.at).toISOString(),
  };
}

/** Policy snapshot frozen on the check at creation: later policy edits never rewrite it. */
export function capturePolicySnapshot(branchId: string, channel: Channel, nowIso: string): PolicySnapshot {
  const ctx = { branchId, channel };
  const conf = policy<{ mode: string; channels: Channel[] } | null>('OrderConfirmationPricingPolicy', ctx);
  const comps = policy<any>('ChargeComponentsPolicy', ctx) ?? {};
  const minc = policy<any>('MinimumChargePolicy', ctx) ?? {};
  const charges: ChargeComponent[] = [];
  if (comps.packaging?.enabled) charges.push({ id: 'PACKAGING', label: { ar: 'رسوم تغليف', en: 'Packaging fee' }, basis: 'PER_CHECK', amount: m4(comps.packaging.amount ?? '0'), channels: ['TAKEAWAY'], taxable: !!comps.taxable, fiscalCode: null });
  if (comps.cover?.enabled) charges.push({ id: 'COVER', label: { ar: 'رسوم دخول', en: 'Cover fee' }, basis: 'PER_GUEST', amount: m4(comps.cover.amount ?? '0'), channels: ['DINE_IN'], taxable: !!comps.taxable, fiscalCode: null });
  if (minc.enabled) charges.push({ id: 'MINIMUM', label: { ar: 'فرق الحد الأدنى', en: 'Minimum charge top-up' }, basis: 'MINIMUM_PER_GUEST', amount: m4(minc.perPerson ?? '0'), channels: ['DINE_IN'], taxable: !!minc.taxable, fiscalCode: null });
  const tt = policy<any>('StackedTaxPolicy', ctx) ?? {};
  const rounding = policy<{ mode: any; scale: number }>('RoundingPolicy', ctx) ?? { mode: 'HALF_UP', scale: 2 };
  return {
    pricingOrder: policy<any>('PricingOrderPolicy', ctx) ?? 'DISCOUNT_BEFORE_TAX',
    rounding: { mode: rounding.mode ?? 'HALF_UP', scale: Number(rounding.scale ?? 2) },
    confirmationMode: conf?.mode ?? null, confirmationChannels: conf?.channels ?? [],
    charges, tableTax: { enabled: !!tt.enabled, rate: String(tt.rate ?? '0'), order: tt.order ?? 'BEFORE_VAT' },
    halfAndHalf: policy<any>('HalfAndHalfPricingPolicy') ?? 'HIGHER_HALF', capturedAt: nowIso,
  };
}

/** ServiceChargePolicy is captured once, at the first ACTIVE participation (PD-N7 freeze). */
export function captureService(order: Order, nowIso: string): ServiceCapture {
  const snap = order.policy;
  if (snap.confirmationMode !== 'CAPTURED_BASE_SERVICE_POLICY' || !snap.confirmationChannels.includes(order.channel)) {
    return { rate: '0', taxable: true, origin: 'NOT_ACTIVATED', capturedAt: nowIso, channel: order.channel };
  }
  const sc = policy<{ byChannel: Record<string, string>; taxable: boolean }>('ServiceChargePolicy', { branchId: order.branchId, channel: order.channel }) ?? { byChannel: {}, taxable: true };
  const rate = sc.byChannel?.[order.channel];
  if (rate === undefined || rate === null || rate === '') return { rate: '0', taxable: sc.taxable, origin: 'CHANNEL_ABSENT', capturedAt: nowIso, channel: order.channel };
  return { rate: String(rate), taxable: sc.taxable !== false, origin: 'POLICY', capturedAt: nowIso, channel: order.channel };
}

export const activeLines = (o: Order) => o.lines.filter((l) => l.status === 'ACTIVE');

/** Check totals from captured line prices and the frozen snapshots. */
export function computeTotals(order: Order): Totals {
  if (order.confirmation) return order.confirmation;
  return computeLiveTotals(order);
}

export function computeLiveTotals(order: Order): Totals {
  const snap = order.policy;
  const { mode, scale } = snap.rounding;
  const lines = activeLines(order);
  const rawItems = lines.reduce((a, l) => a.plus(D(l.lineTotal)), D(0));
  const itemsSubtotal = round(rawItems, scale, mode);
  const svc = order.service;
  const serviceRate = svc && svc.origin === 'POLICY' && gt(svc.rate, 0) ? svc.rate : null;
  const serviceCharge = serviceRate ? round(pct(rawItems, serviceRate), scale, mode) : ZERO;

  // charges (direction D4)
  const charges: Totals['charges'] = [];
  const guests = order.guestCount ?? 1;
  for (const c of snap.charges) {
    if (!c.channels.includes(order.channel)) continue;
    let amt = D(0);
    if (c.basis === 'PER_CHECK') amt = D(c.amount);
    else if (c.basis === 'PER_GUEST') amt = D(c.amount).times(guests);
    else if (c.basis === 'MINIMUM_PER_GUEST') { const min = D(c.amount).times(guests); amt = min.greaterThan(rawItems) ? min.minus(rawItems) : D(0); }
    if (amt.greaterThan(0) && lines.length) charges.push({ id: c.id, label: c.label, amount: round(amt, scale, mode), taxable: c.taxable });
  }
  const chargesTotal = charges.reduce((a, c) => a.plus(D(c.amount)), D(0));
  const taxableCharges = charges.filter((c) => c.taxable).reduce((a, c) => a.plus(D(c.amount)), D(0));

  // table tax (direction D4) on tagged lines
  const tagged = lines.filter((l) => l.chargeTags?.includes('TABLE_TAX')).reduce((a, l) => a.plus(D(l.lineTotal)), D(0));
  const tableTax = snap.tableTax.enabled && tagged.greaterThan(0) ? round(pct(tagged, snap.tableTax.rate), scale, mode) : ZERO;

  // discount (one active, or promotion) / comp
  let itemDiscount = ZERO, serviceDiscount = ZERO, discountAfterTax = ZERO;
  const comp = !!order.comp;
  const disc = order.discounts.filter((d) => d.active);
  const eligible = D(itemsSubtotal).plus(D(serviceCharge));
  const discountOn = (base: any) => {
    let t = D(0);
    for (const d of disc) t = t.plus(d.type === 'PERCENTAGE' ? D(round(pct(base, d.value), scale, mode)) : D(d.value));
    return t.greaterThan(base) ? D(base) : t;
  };
  const totalDiscount = discountOn(eligible);

  // VAT by rate group
  const groups = new Map<string, { rate: string; name: { ar: string; en: string }; base: any; roundingMode: any; scale: number }>();
  for (const l of lines) {
    const k = `${l.taxPolicy.id}:${l.taxPolicy.version}`;
    const g = groups.get(k) ?? { rate: l.taxPolicy.exemption && l.taxPolicy.exemption !== 'NONE' ? '0' : l.taxPolicy.rate, name: l.taxPolicy.name, base: D(0), roundingMode: l.taxPolicy.roundingMode, scale: l.taxPolicy.roundingScale };
    g.base = g.base.plus(D(l.lineTotal));
    groups.set(k, g);
  }

  if (comp) {
    itemDiscount = itemsSubtotal; serviceDiscount = serviceCharge;
  } else if (snap.pricingOrder === 'DISCOUNT_BEFORE_TAX' && totalDiscount.greaterThan(0)) {
    const [a, b] = allocate(totalDiscount, [itemsSubtotal, serviceCharge], scale);
    itemDiscount = a; serviceDiscount = b;
  }

  // tax base allocation across groups (largest remainder by line weight)
  const groupList = [...groups.values()];
  const itemBaseAfterDiscount = D(itemsSubtotal).minus(D(itemDiscount));
  const groupItemBases = allocate(itemBaseAfterDiscount, groupList.map((g) => g.base), scale);
  const svcTaxable = svc?.taxable !== false;
  const serviceNet = D(serviceCharge).minus(D(serviceDiscount));
  const extraBase = (svcTaxable ? serviceNet : D(0)).plus(comp ? 0 : taxableCharges).plus(snap.tableTax.order === 'BEFORE_VAT' ? D(tableTax) : 0);
  const extraAlloc = allocate(extraBase, groupList.map((g) => g.base), scale);
  const taxLines: Totals['taxLines'] = [];
  let tax = D(0);
  let taxBase = D(0);
  groupList.forEach((g, i) => {
    const base = comp ? D(0) : D(groupItemBases[i]).plus(D(extraAlloc[i]));
    const amount = D(round(pct(base, g.rate), g.scale, g.roundingMode));
    taxBase = taxBase.plus(base);
    tax = tax.plus(amount);
    taxLines.push({ rate: g.rate, base: m4(base), amount: m4(amount), name: g.name });
  });

  let payable = comp ? D(0) : itemBaseAfterDiscount.plus(serviceNet).plus(chargesTotal).plus(D(tableTax)).plus(tax);
  if (!comp && snap.pricingOrder === 'DISCOUNT_AFTER_TAX' && totalDiscount.greaterThan(0)) {
    const gross = payable;
    const dat = discountOn(gross);
    discountAfterTax = m4(dat);
    payable = gross.minus(dat);
  }
  const netSales = comp ? ZERO : sub(itemBaseAfterDiscount, snap.pricingOrder === 'DISCOUNT_AFTER_TAX' ? 0 : 0);
  return {
    itemsSubtotal, itemDiscount, serviceCharge, serviceDiscount, serviceRate, charges, tableTax,
    taxBase: m4(taxBase), tax: m4(tax), taxLines, discountTotal: comp ? add(itemsSubtotal, serviceCharge) : add(itemDiscount, serviceDiscount, discountAfterTax),
    discountAfterTax, payable: m4(payable), netSales, comp,
  };
}

export function lineAmount(l: OrderLine) { return l.lineTotal; }
export { minM, isZero };
export type { Product };
