// Server-side pricing: item quotes and check totals. The browser never computes a price.
import { ApiError } from './errors';
import { D, m4, round, add, sub, pct, allocate, ZERO, gt, minM, isZero, Decimal } from './money';
import { effectiveAvailability, optionSoldOut, menuCheck, priceFor, ruleAt, defaultVariant, matchingVariant, activeVariants } from './menu-engine';
import type { LineTaxPart, ModifierLevel, HalfPlacement } from './menu-types';
import { policy, channelPolicy } from './policies';
import { promoAmount } from './promo-engine';
import type { DB, Channel, Order, OrderLine, PolicySnapshot, Product, ServiceCapture, Totals, LineModifier, ChargeComponent, Variant } from './types';

export interface QuoteInput {
  branchId: string; channel: Channel; productId: string; quantity: string; modifierOptionIds: string[]; variantId?: string | null; halfProductId?: string | null;
  comboSelections?: Record<string, { productId: string; variantId?: string | null; modifierOptionIds?: string[] }>; at: number;
  /** menu area (proposed): no/less/extra per ingredient option, topping placement on a pizza half, sub-choices of an option */
  modifierLevels?: Record<string, ModifierLevel>; modifierPlacement?: Record<string, HalfPlacement>; nestedOptionIds?: Record<string, string[]>;
}
export interface Quote {
  productId: string; branchId: string; channel: Channel; quantity: string; currency: 'EGP';
  unitPrice: string; modifiers: LineModifier[]; unitTotal: string; lineTotal: string; priceRuleId: string;
  tax: { taxPolicyId: string; rate: string; mode: string; version: number };
  variant: { id: string; name: { ar: string; en: string }; priceDelta: string } | null;
  children: OrderLine['children'];
  quotedAt: string;
  // menu area (proposed)
  variantPrices?: { variantId: string; unitPrice: string; source: string }[];
  taxSplit?: LineTaxPart[];
  display: { unitTotal: string; lineTotal: string; taxIncluded: boolean; label: { ar: string; en: string } };
  halfAndHalf?: { mode: string; halves: { productId: string; name: { ar: string; en: string }; price: string }[] } | null;
  menu?: { restricted: boolean; endsAt: string | null; menus: { id: string; name: { ar: string; en: string } }[] };
}

/** The product price window (sizes with their own price are matched by variantId; base rows have none). */
export function priceRuleAt(db: DB, productId: string, branchId: string, channel: Channel, at: number) {
  return ruleAt(db, productId, branchId, channel, at, null);
}

/** Raw availability row (writers mutate it). Use effectiveAvailability for what the menu sees now. */
export function availabilityOf(db: DB, productId: string, branchId: string) {
  return db.availability.find((a) => a.productId === productId && a.branchId === branchId) ?? null;
}

type TaxPolicyRow = DB['taxPolicies'][number];
const taxPart = (t: TaxPolicyRow, weight: Decimal.Value, label?: { ar: string; en: string }): LineTaxPart => ({ taxPolicyId: t.id, rate: t.rate, mode: t.calculationMode, version: t.version, name: t.name, roundingMode: t.roundingMode, roundingScale: t.roundingScale, exemption: t.exemption, weight: m4(weight), label });
const levelName = (lv: ModifierLevel, n: { ar: string; en: string }) => lv === 'NO' ? { ar: `بدون ${n.ar}`, en: `No ${n.en}` } : lv === 'LESS' ? { ar: `${n.ar} خفيف`, en: `Light ${n.en}` } : { ar: `${n.ar} زيادة`, en: `Extra ${n.en}` };
const placeName = (pl: HalfPlacement, n: { ar: string; en: string }) => pl === 'LEFT' ? { ar: `${n.ar} (النص الأول)`, en: `${n.en} (1st half)` } : pl === 'RIGHT' ? { ar: `${n.ar} (النص التاني)`, en: `${n.en} (2nd half)` } : n;

export function quoteItem(db: DB, input: QuoteInput): Quote {
  const product = db.products.find((p) => p.id === input.productId);
  if (!product || !product.active) throw new ApiError('CATALOG_PRODUCT_NOT_FOUND', { productId: input.productId });
  const unit = db.units.find((u) => u.id === product.unitId);
  if (!unit) throw new ApiError('CATALOG_UNIT_NOT_FOUND');
  const qty = D(input.quantity || '1');
  if (qty.lte(0)) throw new ApiError('VALIDATION_FAILED', { field: 'quantity', rule: '> 0' });
  if (qty.decimalPlaces() > unit.precision) throw new ApiError('QUANTITY_PRECISION_UNSUPPORTED', { precision: unit.precision });
  const av = effectiveAvailability(db, product.id, input.branchId, input.at);
  if (av && av.state !== 'AVAILABLE') throw new ApiError('PRODUCT_UNAVAILABLE', { productId: product.id, state: av.state, reason: av.reason ?? null, reasonAr: av.state === 'SOLD_OUT' ? (av.soldOutFor ? 'الصنف خلص النهارده' : 'الصنف خلص') + (av.reason ? ` — ${av.reason}` : '') : `الصنف متوقف${av.reason ? ` — ${av.reason}` : ''}` });

  // sizes: the requested size, or the default size; a size can carry its own price rule (per branch and channel)
  let v: Variant | null = null;
  if (product.variants?.length) {
    if (input.variantId) {
      v = product.variants.find((x) => x.id === input.variantId) ?? null;
      if (!v || !v.active) throw new ApiError('MODIFIER_SELECTION_INVALID', { field: 'variantId', variantId: input.variantId, reasonAr: 'الحجم ده مش متاح' });
    } else v = defaultVariant(product);
  }
  const priced = priceFor(db, product, v, input.branchId, input.channel, input.at);
  if (!priced) throw new ApiError('PRICE_NOT_FOUND', { productId: product.id, branchId: input.branchId, channel: input.channel });
  if (!av) throw new ApiError('PRODUCT_UNAVAILABLE', { productId: product.id, state: 'NOT_ON_BRANCH_MENU', rule: 'NewProductAvailabilityPolicy EXPLICIT_PER_BRANCH: activate the product on this branch', reasonAr: 'الصنف لسه مش متفعل في الفرع ده' });
  const mc = menuCheck(db, product, input.branchId, input.channel, input.at);
  if (!mc.onMenu) throw new ApiError('PRODUCT_UNAVAILABLE', { productId: product.id, state: mc.reason, nextStart: mc.nextStart ? new Date(mc.nextStart).toISOString() : null, reasonAr: mc.reasonAr, reasonEn: mc.reasonEn });
  const tax = product.taxPolicyId ? db.taxPolicies.find((t) => t.id === product.taxPolicyId) : null;
  if (!tax || !tax.active) throw new ApiError('TAX_POLICY_NOT_FOUND', { productId: product.id });

  const variant: Quote['variant'] = v ? { id: v.id, name: v.name, priceDelta: m4(D(priced.amount).minus(priceFor(db, product, null, input.branchId, input.channel, input.at)?.amount ?? priced.amount)) } : null;
  const modMultiplier = v ? D(v.modifierMultiplier || '1') : D(1);
  let base = D(priced.amount);
  const parts: LineTaxPart[] = [];

  // half-and-half (pizza): HalfAndHalfPricingPolicy = HIGHER_HALF | AVERAGE | SUM_OF_HALVES
  const children: NonNullable<OrderLine['children']> = [];
  let half: Quote['halfAndHalf'] = null;
  if (input.halfProductId) {
    const other = db.products.find((p) => p.id === input.halfProductId);
    if (!other || !other.active || !product.halfAndHalf || !other.halfAndHalf || other.id === product.id || (product.halfGroup ?? null) !== (other.halfGroup ?? null)) {
      throw new ApiError('MODIFIER_SELECTION_INVALID', { field: 'halfProductId', reason: 'half-and-half not allowed for these products', reasonAr: 'الصنفين دول ما ينفعش يتعملوا نص ونص مع بعض' });
    }
    const oav = effectiveAvailability(db, other.id, input.branchId, input.at);
    if (!oav || oav.state !== 'AVAILABLE') throw new ApiError('PRODUCT_UNAVAILABLE', { productId: other.id, state: oav?.state ?? 'NOT_ON_BRANCH_MENU', reasonAr: `${other.name.ar} خلص — اختار نص تاني` });
    const ov = matchingVariant(other, v, product);
    const op = priceFor(db, other, ov, input.branchId, input.channel, input.at);
    if (!op) throw new ApiError('PRICE_NOT_FOUND', { productId: other.id, branchId: input.branchId, channel: input.channel });
    const a = D(priced.amount), b = D(op.amount);
    const mode = policy<string>('HalfAndHalfPricingPolicy') ?? 'HIGHER_HALF';
    let pa: Decimal, pb: Decimal;
    if (mode === 'AVERAGE') { const avg = D(m4(a.plus(b).dividedBy(2))); pa = D(m4(avg.dividedBy(2))); pb = avg.minus(pa); }
    else if (mode === 'SUM_OF_HALVES') { pa = D(round(a.times(D(product.halfPriceRatio ?? '0.5')), 2)); pb = D(round(b.times(D(other.halfPriceRatio ?? '0.5')), 2)); }
    else { const hi = a.greaterThan(b) ? a : b; pa = D(m4(hi.dividedBy(2))); pb = hi.minus(pa); }
    const modeAr = mode === 'AVERAGE' ? 'متوسط النصين' : mode === 'SUM_OF_HALVES' ? 'مجموع النصين' : 'سعر النص الأغلى';
    const modeEn = mode === 'AVERAGE' ? 'average of halves' : mode === 'SUM_OF_HALVES' ? 'sum of halves' : 'higher half';
    children.push({ kind: 'HALF', name: product.name, productId: product.id, upcharge: ZERO, allocated: m4(pa), categoryId: product.categoryId, taxPolicyId: tax.id, detail: { ar: `النص الأول · ${modeAr}`, en: `first half · ${modeEn}` } });
    const otax = (other.taxPolicyId ? db.taxPolicies.find((t) => t.id === other.taxPolicyId && t.active) : null) ?? tax;
    children.push({ kind: 'HALF', name: other.name, productId: other.id, upcharge: ZERO, allocated: m4(pb), categoryId: other.categoryId, taxPolicyId: otax.id, detail: { ar: `النص التاني · ${modeAr}`, en: `second half · ${modeEn}` } });
    half = { mode, halves: [{ productId: product.id, name: product.name, price: m4(a) }, { productId: other.id, name: other.name, price: m4(b) }] };
    base = pa.plus(pb);
    parts.push(taxPart(tax, pa), taxPart(otax, pb));
  }

  // modifiers: standard groups (min/max, sold out today, size multiplier, half placement, one level of sub-choices)
  // and ingredient groups (no / less / extra)
  const mods: LineModifier[] = [];
  const groups = product.modifierGroupIds.map((g) => db.modifierGroups.find((x) => x.id === g)).filter(Boolean) as DB['modifierGroups'];
  const chosen = new Set(input.modifierOptionIds ?? []);
  const levels = input.modifierLevels ?? {};
  const placement = input.modifierPlacement ?? {};
  const optionPrice = (g: DB['modifierGroups'][number], delta: Decimal.Value) => D(delta).times(g.scalesWithSize === false ? 1 : modMultiplier);
  for (const g of groups) {
    if (g.kind === 'INGREDIENTS') {
      for (const o of g.options) {
        chosen.delete(o.id);
        const lv = levels[o.id];
        if (!lv) continue;
        if (!['NO', 'LESS', 'EXTRA'].includes(lv)) throw new ApiError('MODIFIER_SELECTION_INVALID', { optionId: o.id, level: lv });
        if (!o.active || !g.active) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: o.id, reasonAr: `${o.name.ar} مش متاح` });
        if (lv === 'EXTRA' && optionSoldOut(db, o.id, input.branchId, input.at)) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: o.id, soldOut: true, reasonAr: `${o.name.ar} خلص النهارده — مينفعش زيادة` });
        const delta = lv === 'EXTRA' ? optionPrice(g, o.extraPriceDelta ?? o.priceDelta) : D(0);
        mods.push({ optionId: o.id, groupId: g.id, name: levelName(lv, o.name), priceDelta: m4(delta), level: lv });
      }
      continue;
    }
    const picked = g.options.filter((o) => chosen.has(o.id));
    if (picked.length < g.min || picked.length > g.max || (g.selectionRule === 'SINGLE' && picked.length > 1)) {
      throw new ApiError('MODIFIER_SELECTION_INVALID', { groupId: g.id, group: g.name, min: g.min, max: g.max, picked: picked.length, reasonAr: picked.length < g.min ? `لازم تختار من "${g.name.ar}"` : `أقصى عدد في "${g.name.ar}" هو ${g.max}` });
    }
    for (const o of picked) {
      if (!o.active || !g.active) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: o.id, reasonAr: `${o.name.ar} مش متاح` });
      if (optionSoldOut(db, o.id, input.branchId, input.at)) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: o.id, soldOut: true, reasonAr: `${o.name.ar} خلص النهارده` });
      const pl: HalfPlacement = input.halfProductId && g.allowHalfPlacement && placement[o.id] ? placement[o.id] : 'WHOLE';
      const delta = optionPrice(g, o.priceDelta).times(pl === 'WHOLE' ? 1 : D('0.5'));
      mods.push({ optionId: o.id, groupId: g.id, name: placeName(pl, o.name), priceDelta: m4(delta), placement: pl === 'WHOLE' ? undefined : pl });
      chosen.delete(o.id);
      if (o.nestedGroupId) {
        const ng = db.modifierGroups.find((x) => x.id === o.nestedGroupId);
        if (ng && ng.active) {
          const subIds = new Set(input.nestedOptionIds?.[o.id] ?? []);
          const subs = ng.options.filter((x) => subIds.has(x.id));
          if (subs.length < ng.min || subs.length > ng.max) throw new ApiError('MODIFIER_SELECTION_INVALID', { groupId: ng.id, parentOptionId: o.id, min: ng.min, max: ng.max, picked: subs.length, reasonAr: `اختار "${ng.name.ar}" لـ ${o.name.ar}` });
          for (const s of subs) {
            if (!s.active || optionSoldOut(db, s.id, input.branchId, input.at)) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: s.id, soldOut: true, reasonAr: `${s.name.ar} خلص النهارده` });
            mods.push({ optionId: s.id, groupId: ng.id, name: { ar: `${o.name.ar}: ${s.name.ar}`, en: `${o.name.en}: ${s.name.en}` }, priceDelta: m4(optionPrice(ng, s.priceDelta)), parentOptionId: o.id });
          }
        }
      }
    }
  }
  if (chosen.size) throw new ApiError('MODIFIER_SELECTION_INVALID', { unknownOptions: [...chosen] });
  const modsTotal = mods.reduce((a, m) => a.plus(D(m.priceDelta)), D(0));

  // combo: choice groups with upgrade deltas and one level of sub-choice; the combo price is allocated over the
  // components by their own prices (largest remainder) so each component is taxed by its own tax group
  if (product.combo?.length) {
    const comboBase = base;
    const comps: { slotId: string; p: Product; v: Variant | null; upcharge: Decimal; nested: Decimal; nestedDetail?: { ar: string; en: string }; weight: Decimal; tax: TaxPolicyRow; slotName: { ar: string; en: string } }[] = [];
    const slots = [...product.combo].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const slot of slots) {
      const sel = input.comboSelections?.[slot.id] ?? { productId: slot.defaultProductId, modifierOptionIds: undefined };
      if (slot.required === false && (!sel.productId || sel.productId === 'NONE')) continue;
      const selVariant = (sel as { variantId?: string | null }).variantId;
      const opt = slot.options.find((o) => o.productId === sel.productId && (selVariant === undefined || (o.variantId ?? null) === (selVariant ?? null)));
      if (!opt) throw new ApiError('MODIFIER_SELECTION_INVALID', { slot: slot.id, reasonAr: `اختار ${slot.name.ar}` });
      const sp = db.products.find((p) => p.id === opt.productId);
      if (!sp || !sp.active) throw new ApiError('PRODUCT_UNAVAILABLE', { productId: opt.productId, slot: slot.id, reasonAr: `${slot.name.ar}: الاختيار ده مش متاح` });
      const sav = effectiveAvailability(db, sp.id, input.branchId, input.at);
      if (sav && sav.state !== 'AVAILABLE') throw new ApiError('PRODUCT_UNAVAILABLE', { productId: sp.id, slot: slot.id, state: sav.state, reasonAr: `${sp.name.ar} خلص النهارده — اختار بديل في ${slot.name.ar}` });
      const sv = opt.variantId ? (sp.variants ?? []).find((x) => x.id === opt.variantId && x.active) ?? null : null;
      let nested = D(0);
      let nestedDetail: { ar: string; en: string } | undefined;
      if (opt.nestedGroupId) {
        const ng = db.modifierGroups.find((g) => g.id === opt.nestedGroupId);
        if (ng && ng.active) {
          const ids = sel.modifierOptionIds ?? ng.options.filter((o) => o.active && o.isDefault).slice(0, ng.max).map((o) => o.id);
          const picks = ng.options.filter((o) => ids.includes(o.id));
          if (picks.length < ng.min || picks.length > ng.max) throw new ApiError('MODIFIER_SELECTION_INVALID', { slot: slot.id, nestedGroup: ng.id, reasonAr: `اختار ${ng.name.ar} لـ ${sp.name.ar}` });
          for (const pk of picks) if (!pk.active || optionSoldOut(db, pk.id, input.branchId, input.at)) throw new ApiError('MODIFIER_UNAVAILABLE', { optionId: pk.id, soldOut: true, reasonAr: `${pk.name.ar} خلص النهارده` });
          nested = picks.reduce((a, o) => a.plus(D(o.priceDelta)), D(0));
          nestedDetail = picks.length ? { ar: picks.map((p) => p.name.ar).join('، '), en: picks.map((p) => p.name.en).join(', ') } : undefined;
        }
      }
      const standalone = priceFor(db, sp, sv ?? defaultVariant(sp), input.branchId, input.channel, input.at);
      const ctax = (sp.taxPolicyId ? db.taxPolicies.find((t) => t.id === sp.taxPolicyId && t.active) : null) ?? tax;
      comps.push({ slotId: slot.id, p: sp, v: sv, upcharge: D(opt.upcharge), nested, nestedDetail, weight: standalone ? D(standalone.amount) : D(0), tax: ctax, slotName: slot.name });
    }
    const shares = comps.length ? allocate(comboBase, comps.some((c) => c.weight.gt(0)) ? comps.map((c) => c.weight) : comps.map(() => D(1)), 4) : [];
    comps.forEach((c, i) => {
      const allocated = D(shares[i]).plus(c.upcharge).plus(c.nested);
      const vname = c.v ? ` ${c.v.name.ar}` : '';
      children.push({ kind: 'COMBO_SLOT', slotId: c.slotId, name: { ar: `${c.slotName.ar}: ${c.p.name.ar}${vname}`, en: `${c.slotName.en}: ${c.p.name.en}${c.v ? ' ' + c.v.name.en : ''}` }, productId: c.p.id, variantId: c.v?.id ?? null, categoryId: c.p.categoryId, upcharge: m4(c.upcharge.plus(c.nested)), allocated: m4(allocated), taxPolicyId: c.tax.id, detail: c.nestedDetail });
      parts.push(taxPart(c.tax, allocated, c.p.name));
      base = base.plus(c.upcharge).plus(c.nested);
    });
    if (!comps.length) parts.push(taxPart(tax, comboBase));
  }

  const unitTotal = base.plus(modsTotal);
  // tax parts: modifiers belong to the product's own tax; a single-tax line keeps no split
  if (!parts.length) parts.push(taxPart(tax, base));
  if (!modsTotal.isZero()) parts.push(taxPart(tax, modsTotal));
  const merged = new Map<string, LineTaxPart>();
  for (const p of parts) { const k = `${p.taxPolicyId}:${p.version}`; const e = merged.get(k); if (e) e.weight = m4(D(e.weight).plus(p.weight)); else merged.set(k, { ...p, label: undefined }); }
  const taxSplit = merged.size > 1 ? [...merged.values()] : undefined;

  // what the operator sees: MenuPriceDisplayPolicy (per channel) AS_PRICED or WITH_TAX — computed here, never in the browser
  const displayMode = (policy<Record<string, string>>('MenuPriceDisplayPolicy', { branchId: input.branchId }) ?? {})[input.channel] ?? 'AS_PRICED';
  const lineTotal = unitTotal.times(qty);
  const withTax = (amount: Decimal) => {
    const ps = taxSplit ?? [taxPart(tax, unitTotal)];
    const weights = ps.map((p) => D(p.weight));
    const alloc = allocate(amount, weights, 4);
    return ps.reduce((acc, p, i) => acc.plus(p.mode === 'EXCLUSIVE' && (!p.exemption || p.exemption === 'NONE') ? D(alloc[i]).times(D(100).plus(p.rate)).dividedBy(100) : D(alloc[i])), D(0));
  };
  const anyExclusive = (taxSplit ?? [taxPart(tax, unitTotal)]).some((p) => p.mode === 'EXCLUSIVE' && (!p.exemption || p.exemption === 'NONE') && D(p.rate).gt(0));
  const allExempt = (taxSplit ?? [taxPart(tax, unitTotal)]).every((p) => (p.exemption && p.exemption !== 'NONE') || D(p.rate).isZero());
  const showWithTax = displayMode === 'WITH_TAX' && anyExclusive;
  const display = {
    unitTotal: showWithTax ? round(withTax(unitTotal), 2) : m4(unitTotal),
    lineTotal: showWithTax ? round(withTax(lineTotal), 2) : m4(lineTotal),
    taxIncluded: allExempt || !anyExclusive || showWithTax,
    label: allExempt ? { ar: 'معفي من الضريبة', en: 'Tax exempt' } : !anyExclusive || showWithTax ? { ar: 'شامل الضريبة', en: 'Tax included' } : { ar: `+ ضريبة ${D(tax.rate).toString()}%`, en: `+ ${D(tax.rate).toString()}% tax` },
  };

  return {
    productId: product.id, branchId: input.branchId, channel: input.channel, quantity: qty.toString(), currency: 'EGP',
    unitPrice: m4(base), modifiers: mods, unitTotal: m4(unitTotal), lineTotal: m4(lineTotal), priceRuleId: priced.ruleId,
    tax: { taxPolicyId: tax.id, rate: tax.rate, mode: tax.calculationMode, version: tax.version }, variant, children: children.length ? children : undefined,
    quotedAt: new Date(input.at).toISOString(),
    variantPrices: activeVariants(product).map((x) => { const pr = priceFor(db, product, x, input.branchId, input.channel, input.at); return pr ? { variantId: x.id, unitPrice: pr.amount, source: pr.source } : null; }).filter(Boolean) as Quote['variantPrices'],
    taxSplit, display, halfAndHalf: half,
    menu: { restricted: mc.restricted, endsAt: mc.endsAt ? new Date(mc.endsAt).toISOString() : null, menus: mc.menus },
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
    for (const d of disc) t = t.plus((d as any).rule ? promoAmount(order, (d as any).rule, scale, mode) : d.type === 'PERCENTAGE' ? D(round(pct(base, d.value), scale, mode)) : D(d.value)); // item / buy-X-get-Y promotions: promo-engine.ts
    return t.greaterThan(base) ? D(base) : t;
  };
  const totalDiscount = discountOn(eligible);

  // VAT by rate group
  // a line with taxSplit (combo components, halves under different tax groups) spreads its total over its parts by weight
  const groups = new Map<string, { rate: string; name: { ar: string; en: string }; base: any; roundingMode: any; scale: number; mode: string }>();
  const addToGroup = (tp: { id?: string; taxPolicyId?: string; version: number; rate: string; exemption?: string; name: { ar: string; en: string }; roundingMode: any; roundingScale: number; mode: string }, amount: any) => {
    const id = tp.id ?? tp.taxPolicyId;
    const k = `${id}:${tp.version}`;
    const g = groups.get(k) ?? { rate: tp.exemption && tp.exemption !== 'NONE' ? '0' : tp.rate, name: tp.name, base: D(0), roundingMode: tp.roundingMode, scale: tp.roundingScale, mode: tp.mode };
    g.base = g.base.plus(D(amount));
    groups.set(k, g);
  };
  for (const l of lines) {
    if (l.taxSplit?.length) {
      const shares = allocate(l.lineTotal, l.taxSplit.map((p) => p.weight), 4);
      l.taxSplit.forEach((p, i) => addToGroup(p, shares[i]));
    } else addToGroup(l.taxPolicy, l.lineTotal);
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
  let taxAdded = D(0); // only EXCLUSIVE tax is added on top; INCLUSIVE tax is already inside the item prices
  groupList.forEach((g, i) => {
    if (g.mode === 'INCLUSIVE') {
      // tax-inclusive items: extract the tax from the item part; extras (service, charges) are still taxed on top
      const itemPart = comp ? D(0) : D(groupItemBases[i]);
      const extraPart = comp ? D(0) : D(extraAlloc[i]);
      const inside = D(round(itemPart.times(g.rate).dividedBy(D(100).plus(g.rate)), g.scale, g.roundingMode));
      const onTop = D(round(pct(extraPart, g.rate), g.scale, g.roundingMode));
      const base = itemPart.minus(inside).plus(extraPart);
      taxBase = taxBase.plus(base);
      tax = tax.plus(inside).plus(onTop);
      taxAdded = taxAdded.plus(onTop);
      taxLines.push({ rate: g.rate, base: m4(base), amount: m4(inside.plus(onTop)), name: { ar: `${g.name.ar} (شاملة في الأسعار)`, en: `${g.name.en} (included in prices)` }, mode: 'INCLUSIVE' });
      return;
    }
    const base = comp ? D(0) : D(groupItemBases[i]).plus(D(extraAlloc[i]));
    const amount = D(round(pct(base, g.rate), g.scale, g.roundingMode));
    taxBase = taxBase.plus(base);
    tax = tax.plus(amount);
    taxAdded = taxAdded.plus(amount);
    taxLines.push({ rate: g.rate, base: m4(base), amount: m4(amount), name: g.name, mode: 'EXCLUSIVE' });
  });

  let payable = comp ? D(0) : itemBaseAfterDiscount.plus(serviceNet).plus(chargesTotal).plus(D(tableTax)).plus(taxAdded);
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
