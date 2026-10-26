import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId } from '../store';
import { policy } from '../policies';
import { quoteItem, availabilityOf } from '../pricing';
import { D, m4, isMoney } from '../money';
import { checkVersion, need, page, requireFields } from './util';
import type { Channel, Product, PriceRule, DB } from '../types';
import { zonedParts } from '../clock';
import { promotionLive } from '../promo-engine';
import { upsertPromotion, promotionView, findByCode } from './promotions';
import { effectiveAvailability, menuCheck, menuState, optionSoldOut, branchBusinessDate, activeVariants } from '../menu-engine';
import { planPriceWindow, applyPriceWindow } from '../menu-prices';

/** nextId, skipping ids the seed already uses (seed price rules are pr_1…pr_N and promotions promo_1, promo_2). */
function freshId(db: DB, prefix: string): string {
  const taken = (id: string) => db.priceRules.some((r) => r.id === id) || db.promotions.some((x) => x.id === id) || db.products.some((x) => x.id === id) || db.categories.some((x) => x.id === id) || db.units.some((x) => x.id === id) || db.taxPolicies.some((x) => x.id === id) || db.modifierGroups.some((g) => g.id === id || g.options.some((o) => o.id === id));
  let id = nextId(prefix);
  while (taken(id)) id = nextId(prefix);
  return id;
}

const showDirection = () => policy<boolean>('DirectionCatalogDemo') !== false;

function productView(db: DB, p: Product, branchId: string | null, opts: { channel?: Channel; now?: number } = {}) {
  // menu area: "sold out today" rows from an earlier business day read as AVAILABLE; menuNow = on the menu right now
  const now = opts.now ?? Date.now();
  const av = branchId ? effectiveAvailability(db, p.id, branchId, now) : null;
  const mc = branchId && opts.channel ? menuCheck(db, p, branchId, opts.channel, now) : null;
  const menuNow = mc ? (mc.onMenu ? { onMenu: true, restricted: mc.restricted, endsAt: mc.endsAt ? new Date(mc.endsAt).toISOString() : null, menus: mc.menus } : { onMenu: false, reason: mc.reason, nextStart: mc.nextStart ? new Date(mc.nextStart).toISOString() : null, dayparts: mc.dayparts, reasonAr: mc.reasonAr, reasonEn: mc.reasonEn }) : null;
  return { ...p, availability: av ? { state: av.state, reason: av.reason, soldOutFor: av.state === 'SOLD_OUT' ? av.soldOutFor ?? null : null, updatedAt: av.updatedAt, updatedBy: av.updatedBy } : { state: 'NOT_ON_BRANCH_MENU', reason: null }, menuNow, taxPolicyName: db.taxPolicies.find((t) => t.id === p.taxPolicyId)?.name ?? null, taxPolicy: (() => { const t = db.taxPolicies.find((x) => x.id === p.taxPolicyId); return t ? { id: t.id, rate: t.rate, mode: t.calculationMode, exemption: t.exemption ?? 'NONE' } : null; })(), fiscalItemCode: db.itemMappings.find((m) => m.productId === p.id)?.itemCode ?? null };
}
const IMAGE_MAX_CHARS = 400_000; // ~300 KB image as a data URL (the editor downsizes before upload)
function checkImage(v: unknown) {
  if (v === undefined || v === null || v === '') return;
  const s = String(v);
  need(/^(https?:\/\/|data:image\/(png|jpeg|jpg|webp|gif|svg\+xml)[;,])/.test(s), 'VALIDATION_FAILED', { field: 'imageUrl', rule: 'http(s) URL or data:image/…', reasonAr: 'الصورة لازم تبقى ملف صورة (PNG أو JPG أو WEBP)' });
  need(s.length <= IMAGE_MAX_CHARS, 'VALIDATION_FAILED', { field: 'imageUrl', rule: `at most ${IMAGE_MAX_CHARS} characters`, reasonAr: 'الصورة كبيرة — الحد 300 كيلوبايت' });
}
function checkCalories(v: unknown) {
  if (v === undefined || v === null || v === '') return;
  need(Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 5000, 'VALIDATION_FAILED', { field: 'calories', rule: 'integer 0..5000', reasonAr: 'السعرات رقم صحيح من 0 لـ 5000' });
}

function nextSku(db: DB, categoryId: string) {
  const sp = policy<{ mode: string; defaultPrefix?: string; categoryPrefixes?: Record<string, string>; separator?: string; width?: number }>('SkuGenerationPolicy') ?? { mode: 'MANUAL' };
  const prefix = sp.categoryPrefixes?.[categoryId] ?? sp.defaultPrefix ?? '';
  const width = sp.width ?? 5;
  db.seq['sku'] = (db.seq['sku'] ?? 0) + 1;
  const n = String(db.seq['sku']).padStart(width, '0');
  if (n.length > width) throw new ApiError('CATALOG_SKU_SEQUENCE_EXHAUSTED');
  return (prefix ? prefix + (sp.separator ?? '-') : '') + n;
}

function checkName(db: DB, name: { ar: string; en: string }, exceptId?: string) {
  const rule = policy<{ default: string }>('ProductNameUniquenessPolicy')?.default ?? 'BLOCK';
  const clash = db.products.find((p) => p.id !== exceptId && p.active && (p.name.ar.trim() === name.ar?.trim() || p.name.en.trim().toLowerCase() === name.en?.trim().toLowerCase()));
  if (clash && rule === 'BLOCK') throw new ApiError('CATALOG_PRODUCT_NAME_TAKEN', { productId: clash.id });
  return clash && rule === 'WARN' ? { warning: 'NAME_DUPLICATE', productId: clash.id } : null;
}

function taxUsage(db: DB, taxPolicyId: string) {
  return db.products.filter((p) => p.taxPolicyId === taxPolicyId);
}
function validateTax(b: any) {
  need(isMoney(String(b.rate)) || /^\d+(\.\d{1,6})?$/.test(String(b.rate)), 'VALIDATION_FAILED', { field: 'rate', rule: 'decimal string' });
  need(D(b.rate).gte(0) && D(b.rate).lte(100), 'VALIDATION_FAILED', { field: 'rate', rule: '0..100' });
  need(['INCLUSIVE', 'EXCLUSIVE'].includes(b.calculationMode), 'VALIDATION_FAILED', { field: 'calculationMode' });
  need(['HALF_UP', 'HALF_EVEN', 'DOWN'].includes(b.roundingMode), 'VALIDATION_FAILED', { field: 'roundingMode' });
  need(Number.isInteger(Number(b.roundingScale)) && Number(b.roundingScale) >= 0 && Number(b.roundingScale) <= 4, 'VALIDATION_FAILED', { field: 'roundingScale', rule: '0..4' });
}

/** Promotion schedule: doc 26 shape {daysOfWeek, startLocalTime, endLocalTime}; the mock stores {days, start, end}. */
function normSchedule(s: any): { days: number[]; start: string; end: string } | null {
  if (!s) return null;
  const days = (s.daysOfWeek ?? s.days ?? []).map(Number);
  const start = s.startLocalTime ?? s.start, end = s.endLocalTime ?? s.end;
  need(days.length > 0 && days.every((d: number) => d >= 0 && d <= 6), 'VALIDATION_FAILED', { field: 'schedule.daysOfWeek' });
  need(/^\d{2}:\d{2}$/.test(start ?? '') && /^\d{2}:\d{2}$/.test(end ?? '') && start !== end, 'VALIDATION_FAILED', { field: 'schedule', rule: 'HH:MM, start != end (end < start crosses midnight)' });
  return { days, start, end };
}
function validateBenefit(type: string, value: unknown) {
  need(['PERCENTAGE', 'FIXED_AMOUNT'].includes(type), 'VALIDATION_FAILED', { field: 'benefitType' });
  need(isMoney(String(value)) && D(String(value)).gt(0) && (type !== 'PERCENTAGE' || D(String(value)).lte(100)), 'VALIDATION_FAILED', { field: 'benefitValue', rule: 'PERCENTAGE 0 < v <= 100, FIXED_AMOUNT > 0' });
}

function inHappyHour(ms: number, schedule: { days: number[]; start: string; end: string } | null, tz = 'Africa/Cairo') {
  if (!schedule) return true;
  const p = zonedParts(ms, tz);
  const t = p.hour * 60 + p.minute;
  const [sh, sm] = schedule.start.split(':').map(Number);
  const [eh, em] = schedule.end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  if (e > s) return schedule.days.includes(p.weekday) && t >= s && t < e;
  // end < start crosses midnight (doc 26 §3): the part after midnight belongs to the previous day's schedule
  return (schedule.days.includes(p.weekday) && t >= s) || (schedule.days.includes((p.weekday + 6) % 7) && t < e);
}
export function promotionActive(ctx: Ctx, pr: DB['promotions'][number], channel: Channel) {
  return promotionLive(ctx.db, pr, ctx.branchId, channel, ctx.now); // promo-engine.ts (dayparts, dates, branch, channel)
}

export const catalogHandlers: Record<string, Handler> = {
  'Category.List': (ctx) => page(ctx.db.categories.filter((c) => (ctx.query.active === undefined || String(c.active) === ctx.query.active) && (showDirection() || c.id !== 'cat_direction')).sort((a, b) => a.sortOrder - b.sortOrder), ctx.query),
  'Category.Create': (ctx) => {
    requireFields(ctx, 'name');
    const c = { id: freshId(ctx.db, 'cat'), name: ctx.body.name, active: true, sortOrder: ctx.body.sortOrder ?? (ctx.db.categories.length + 1) * 10, colorCode: ctx.body.colorCode, version: 1 };
    ctx.db.categories.push(c);
    return c;
  },
  'Category.Configure': (ctx) => {
    const c = ctx.db.categories.find((x) => x.id === ctx.params.categoryId);
    need(c, 'CATALOG_CATEGORY_NOT_FOUND');
    checkVersion(c!, ctx.body.expectedVersion);
    Object.assign(c!, { name: ctx.body.name ?? c!.name, active: ctx.body.active ?? c!.active, sortOrder: ctx.body.sortOrder ?? c!.sortOrder, colorCode: ctx.body.colorCode ?? c!.colorCode });
    c!.version++;
    return c;
  },
  'Unit.List': (ctx) => page(ctx.db.units, ctx.query),
  'Unit.Create': (ctx) => {
    requireFields(ctx, 'code');
    need(!ctx.db.units.some((u) => u.code === ctx.body.code), 'UNIT_CODE_TAKEN');
    need(Number.isInteger(Number(ctx.body.precision ?? 0)) && Number(ctx.body.precision ?? 0) >= 0 && Number(ctx.body.precision ?? 0) <= 6, 'VALIDATION_FAILED', { field: 'precision', rule: '0..6' });
    const u = { id: freshId(ctx.db, 'unit'), code: ctx.body.code, precision: Number(ctx.body.precision ?? 0), active: true, used: false, version: 1 };
    ctx.db.units.push(u);
    return u;
  },
  'Unit.Configure': (ctx) => {
    const u = ctx.db.units.find((x) => x.id === ctx.params.unitId);
    need(u, 'CATALOG_UNIT_NOT_FOUND');
    checkVersion(u!, ctx.body.expectedVersion);
    if (ctx.body.precision !== undefined && Number(ctx.body.precision) !== u!.precision && u!.used) throw new ApiError('UNIT_PRECISION_IMMUTABLE');
    // contract: Unit.Configure also renames (code unique)
    if (ctx.body.code && ctx.body.code !== u!.code) need(!ctx.db.units.some((x) => x.code === ctx.body.code), 'UNIT_CODE_TAKEN');
    Object.assign(u!, { code: ctx.body.code || u!.code, precision: ctx.body.precision !== undefined ? Number(ctx.body.precision) : u!.precision, active: ctx.body.active ?? u!.active });
    u!.version++;
    return u;
  },
  // menu area: options in display order, each with soldOut (today, this branch)
  'ModifierGroup.List': (ctx) => page(ctx.db.modifierGroups.filter((g) => ctx.query.active === undefined || String(g.active) === ctx.query.active).map((g) => ({ ...g, options: [...g.options].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((o) => { const so = optionSoldOut(ctx.db, o.id, ctx.branchId, ctx.now); return { ...o, soldOut: !!so, soldOutReason: so?.reason ?? null }; }) })), ctx.query),
  'ModifierGroup.Create': (ctx) => {
    requireFields(ctx, 'name', 'selectionRule');
    const min = Number(ctx.body.min ?? 0), max = Number(ctx.body.max ?? 1);
    need(min >= 0 && max >= min && max >= 1, 'VALIDATION_FAILED', { rule: '0 <= min <= max, max >= 1' });
    need(!ctx.body.kind || ['STANDARD', 'INGREDIENTS'].includes(ctx.body.kind), 'VALIDATION_FAILED', { field: 'kind' });
    const g = { id: freshId(ctx.db, 'mg'), name: ctx.body.name, selectionRule: ctx.body.selectionRule, min, max, active: true, options: [], version: 1, kind: ctx.body.kind ?? 'STANDARD', scalesWithSize: ctx.body.scalesWithSize ?? true, allowHalfPlacement: !!ctx.body.allowHalfPlacement };
    ctx.db.modifierGroups.push(g);
    return g;
  },
  'ModifierGroup.Configure': (ctx) => {
    const g = ctx.db.modifierGroups.find((x) => x.id === ctx.params.groupId);
    need(g, 'MODIFIER_DEFINITION_NOT_FOUND');
    checkVersion(g!, ctx.body.expectedVersion);
    const nmin = Number(ctx.body.min ?? g!.min), nmax = Number(ctx.body.max ?? g!.max);
    need(nmin >= 0 && nmax >= nmin && nmax >= 1, 'VALIDATION_FAILED', { rule: '0 <= min <= max, max >= 1', reasonAr: 'أقل عدد لازم يبقى أصغر من أو يساوي أكتر عدد' });
    Object.assign(g!, { name: ctx.body.name ?? g!.name, selectionRule: ctx.body.selectionRule ?? g!.selectionRule, min: nmin, max: nmax, active: ctx.body.active ?? g!.active, kind: ctx.body.kind ?? g!.kind, scalesWithSize: ctx.body.scalesWithSize ?? g!.scalesWithSize, allowHalfPlacement: ctx.body.allowHalfPlacement ?? g!.allowHalfPlacement });
    g!.version++;
    return g;
  },
  'ModifierOption.Create': (ctx) => {
    const g = ctx.db.modifierGroups.find((x) => x.id === ctx.params.groupId);
    need(g, 'MODIFIER_DEFINITION_NOT_FOUND');
    requireFields(ctx, 'name');
    need(isMoney(ctx.body.priceDelta ?? '0'), 'VALIDATION_FAILED', { field: 'priceDelta' });
    if (ctx.body.nestedGroupId) need(ctx.db.modifierGroups.some((x) => x.id === ctx.body.nestedGroupId && x.id !== g!.id), 'MODIFIER_DEFINITION_NOT_FOUND', { groupId: ctx.body.nestedGroupId });
    if (ctx.body.extraPriceDelta) need(isMoney(ctx.body.extraPriceDelta), 'VALIDATION_FAILED', { field: 'extraPriceDelta' });
    const o = { id: freshId(ctx.db, 'opt'), name: ctx.body.name, priceDelta: m4(ctx.body.priceDelta ?? '0'), active: true, version: 1, isDefault: !!ctx.body.isDefault, sortOrder: ctx.body.sortOrder ?? (g!.options.length + 1) * 10, nestedGroupId: ctx.body.nestedGroupId || null, extraPriceDelta: ctx.body.extraPriceDelta ? m4(ctx.body.extraPriceDelta) : null, allergens: ctx.body.allergens };
    g!.options.push(o);
    g!.version++;
    return o;
  },
  'ModifierOption.Configure': (ctx) => {
    const g = ctx.db.modifierGroups.find((x) => x.id === ctx.params.groupId);
    const o = g?.options.find((x) => x.id === ctx.params.optionId);
    need(o, 'MODIFIER_OPTION_NOT_FOUND');
    checkVersion(o!, ctx.body.expectedVersion);
    if (ctx.body.nestedGroupId) need(ctx.db.modifierGroups.some((x) => x.id === ctx.body.nestedGroupId && x.id !== g!.id), 'MODIFIER_DEFINITION_NOT_FOUND', { groupId: ctx.body.nestedGroupId });
    if (ctx.body.extraPriceDelta) need(isMoney(ctx.body.extraPriceDelta), 'VALIDATION_FAILED', { field: 'extraPriceDelta' });
    Object.assign(o!, { name: ctx.body.name ?? o!.name, priceDelta: ctx.body.priceDelta !== undefined ? m4(ctx.body.priceDelta) : o!.priceDelta, active: ctx.body.active ?? o!.active,
      isDefault: ctx.body.isDefault ?? o!.isDefault, nestedGroupId: ctx.body.nestedGroupId !== undefined ? ctx.body.nestedGroupId || null : o!.nestedGroupId, extraPriceDelta: ctx.body.extraPriceDelta !== undefined ? (ctx.body.extraPriceDelta ? m4(ctx.body.extraPriceDelta) : null) : o!.extraPriceDelta, allergens: ctx.body.allergens ?? o!.allergens });
    // a single-choice group keeps one default
    if (ctx.body.isDefault && g!.selectionRule === 'SINGLE') for (const x of g!.options) if (x.id !== o!.id) x.isDefault = false;
    o!.version++;
    return o;
  },
  'Catalog.Search': (ctx) => {
    // menu area (proposed query fields): channel → menuNow per product (dayparts, channel and branch menus); q → name/sku/barcode search
    const qq = (ctx.query.q ?? '').trim().toLowerCase();
    const channel = (['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(ctx.query.channel) ? ctx.query.channel : undefined) as Channel | undefined;
    const items = ctx.db.products
      .filter((p) => (!ctx.query.categoryId || p.categoryId === ctx.query.categoryId) && (ctx.query.active === undefined || String(p.active) === ctx.query.active) && (showDirection() || !p.direction))
      .filter((p) => !qq || p.name.ar.toLowerCase().includes(qq) || p.name.en.toLowerCase().includes(qq) || p.sku.toLowerCase().includes(qq) || (p.variants ?? []).some((v) => (v.sku ?? '').toLowerCase() === qq || (v.barcode ?? '') === qq))
      .map((p) => productView(ctx.db, p, ctx.branchId, { channel, now: ctx.now }));
    return page(items, ctx.query);
  },
  'Product.Get': (ctx) => {
    const p = ctx.db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    return productView(ctx.db, p!, ctx.branchId, { now: ctx.now });
  },
  'Product.NameCheck': (ctx) => {
    const rule = policy<{ default: string }>('ProductNameUniquenessPolicy')?.default ?? 'BLOCK';
    // contract: excludeProductId (the product being edited never clashes with itself); names compared trimmed
    const ar = (ctx.body.name?.ar ?? '').trim(), en = (ctx.body.name?.en ?? '').trim().toLowerCase();
    const clash = ctx.db.products.find((p) => p.active && p.id !== ctx.body.excludeProductId && ((ar && p.name.ar.trim() === ar) || (en && p.name.en?.trim().toLowerCase() === en)));
    return { available: !clash, rule, clash: clash ? { id: clash.id, name: clash.name } : null };
  },
  'Product.Create': (ctx) => {
    requireFields(ctx, 'name', 'categoryId', 'unitId');
    const db = ctx.db;
    need(db.categories.some((c) => c.id === ctx.body.categoryId), 'CATALOG_CATEGORY_NOT_FOUND');
    const unit = db.units.find((u) => u.id === ctx.body.unitId);
    need(unit, 'CATALOG_UNIT_NOT_FOUND');
    const taxDefault = policy<{ taxPolicyId?: string } | null>('ProductTaxDefaultPolicy')?.taxPolicyId;
    const taxId = ctx.body.taxPolicyId ?? taxDefault ?? null;
    if (taxId) {
      const tp = db.taxPolicies.find((t) => t.id === taxId);
      need(tp, 'TAX_POLICY_NOT_FOUND');
      need(tp!.active, 'TAX_POLICY_ARCHIVED');
    }
    const warn = checkName(db, ctx.body.name);
    checkImage(ctx.body.imageUrl); checkCalories(ctx.body.calories);
    let sku = (ctx.body.sku ?? '').trim();
    const sp = policy<{ mode: string }>('SkuGenerationPolicy')?.mode ?? 'MANUAL';
    if (!sku) {
      if (sp !== 'AUTO_IF_EMPTY') throw new ApiError('VALIDATION_FAILED', { field: 'sku', rule: 'required (SkuGenerationPolicy MANUAL)' });
      sku = nextSku(db, ctx.body.categoryId);
    }
    need(!db.products.some((p) => p.sku === sku), 'CATALOG_SKU_TAKEN', { sku });
    const p: Product = { id: freshId(ctx.db, 'prod'), sku, name: ctx.body.name, categoryId: ctx.body.categoryId, unitId: ctx.body.unitId, taxPolicyId: taxId, modifierGroupIds: [], imageUrl: ctx.body.imageUrl, colorCode: ctx.body.colorCode, description: ctx.body.description, active: true, version: 1, createdAt: ctx.nowIso, createdBranchId: ctx.branchId ?? undefined, allergens: ctx.body.allergens, chargeTags: ctx.body.chargeTags, calories: ctx.body.calories !== undefined && ctx.body.calories !== '' ? Number(ctx.body.calories) : null };
    db.products.push(p);
    unit!.used = true;
    const nap = policy<string>('NewProductAvailabilityPolicy') ?? 'EXPLICIT_PER_BRANCH';
    if (nap === 'CREATING_BRANCH' && ctx.branchId) db.availability.push({ productId: p.id, branchId: ctx.branchId, state: 'AVAILABLE', reason: null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
    ctx.audit(`product ${p.sku}`, p.id);
    return { ...productView(db, p, ctx.branchId), warning: warn };
  },
  'Product.Configure': (ctx) => {
    const db = ctx.db;
    const p = db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    checkVersion(p!, ctx.body.expectedVersion);
    if (ctx.body.name) checkName(db, ctx.body.name, p!.id);
    if (ctx.body.unitId && ctx.body.unitId !== p!.unitId) throw new ApiError('VALIDATION_FAILED', { field: 'unitId', rule: "a product's unit is fixed" });
    if (ctx.body.sku && ctx.body.sku !== p!.sku) need(!db.products.some((x) => x.sku === ctx.body.sku), 'CATALOG_SKU_TAKEN');
    checkImage(ctx.body.imageUrl); checkCalories(ctx.body.calories);
    if (ctx.body.calories !== undefined) p!.calories = ctx.body.calories === '' || ctx.body.calories === null ? null : Number(ctx.body.calories);
    Object.assign(p!, { name: ctx.body.name ?? p!.name, categoryId: ctx.body.categoryId ?? p!.categoryId, sku: ctx.body.sku ?? p!.sku, imageUrl: ctx.body.imageUrl ?? p!.imageUrl, colorCode: ctx.body.colorCode ?? p!.colorCode, description: ctx.body.description ?? p!.description, active: ctx.body.active ?? p!.active, allergens: ctx.body.allergens ?? p!.allergens, chargeTags: ctx.body.chargeTags ?? p!.chargeTags });
    p!.version++;
    return productView(db, p!, ctx.branchId);
  },
  'Product.SetAvailability': (ctx) => {
    const db = ctx.db;
    const p = db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    const state = ctx.body.state;
    need(['AVAILABLE', 'SOLD_OUT', 'BLOCKED'].includes(state), 'VALIDATION_FAILED', { field: 'state' });
    const rp = policy<Record<string, string>>('AvailabilityReasonPolicy') ?? {};
    if (state !== 'AVAILABLE' && rp[state] === 'REQUIRED' && !(ctx.body.reason ?? '').trim()) throw new ApiError('REASON_REQUIRED', { state });
    const branchId = ctx.body.branchId ?? ctx.branchId;
    need(branchId, 'CONTEXT_REQUIRED');
    let av = availabilityOf(db, p!.id, branchId);
    if (!av) { av = { productId: p!.id, branchId, state, reason: null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id }; db.availability.push(av); }
    // menu area (proposed field until): END_OF_BUSINESS_DAY = "sold out today", back automatically on the next business day
    const today = state === 'SOLD_OUT' && ctx.body.until === 'END_OF_BUSINESS_DAY' ? branchBusinessDate(db, branchId, ctx.now) : null;
    Object.assign(av, { state, reason: state === 'AVAILABLE' ? null : ctx.body.reason ?? null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id, soldOutFor: today });
    ctx.audit(`availability ${p!.sku} → ${state}`, p!.id);
    return av;
  },
  'Product.SetModifierGroups': (ctx) => {
    const p = ctx.db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    checkVersion(p!, ctx.body.expectedVersion);
    // contract field is `groupIds` (ordered = display order, unique, at most 20 — doc 21); `modifierGroupIds` kept for older callers
    const ids: string[] = ctx.body.groupIds ?? ctx.body.modifierGroupIds ?? [];
    need(Array.isArray(ids) && new Set(ids).size === ids.length && ids.length <= 20, 'VALIDATION_FAILED', { field: 'groupIds', rule: 'unique, at most 20' });
    for (const g of ids) need(ctx.db.modifierGroups.some((x) => x.id === g), 'MODIFIER_DEFINITION_NOT_FOUND', { groupId: g });
    p!.modifierGroupIds = [...ids];
    p!.version++;
    return productView(ctx.db, p!, ctx.branchId);
  },
  'Product.SetTaxPolicy': (ctx) => {
    const db = ctx.db;
    const p = db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    checkVersion(p!, ctx.body.expectedVersion);
    const tp = db.taxPolicies.find((t) => t.id === ctx.body.taxPolicyId);
    need(tp, 'TAX_POLICY_NOT_FOUND');
    need(tp!.active, 'TAX_POLICY_ARCHIVED');
    ctx.requireApproval({ action: 'PRODUCT_TAX_CHANGE', targetType: 'catalog.Product', targetId: p!.id, context: { productId: p!.id, productVersion: p!.version, oldTaxPolicyId: p!.taxPolicyId, newTaxPolicyId: tp!.id }, grantId: ctx.body.approvalGrantId });
    p!.taxPolicyId = tp!.id;
    p!.version++;
    ctx.audit(`product tax ${p!.sku} → ${tp!.id}`, p!.id, true);
    return productView(db, p!, ctx.branchId);
  },
  'Variant.Upsert': (ctx) => {
    // contract: attributes + barcode (unique among active variants). Proposed fields (menu area): name, priceDelta,
    // modifierMultiplier, sku, calories, isDefault, sortOrder. A size's own price per branch/channel is Catalog.SetPrice + variantId.
    const db = ctx.db;
    const p = db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    if (ctx.body.expectedVersion !== undefined) checkVersion(p!, ctx.body.expectedVersion);
    const b = ctx.body;
    const vid = String(ctx.params.variantId);
    need(/^[A-Za-z0-9_-]{1,40}$/.test(vid), 'VALIDATION_FAILED', { field: 'variantId' });
    p!.variants = p!.variants ?? [];
    const v = p!.variants.find((x) => x.id === vid);
    const name = b.name ?? v?.name ?? (b.attributes?.[0] ? { ar: String(b.attributes[0].value), en: String(b.attributes[0].value) } : null);
    need(name && (name.ar || '').trim(), 'VALIDATION_FAILED', { field: 'name', reasonAr: 'اسم الحجم مطلوب' });
    const delta = b.priceDelta ?? v?.priceDelta ?? '0';
    need(isMoney(String(delta)), 'VALIDATION_FAILED', { field: 'priceDelta', reasonAr: 'فرق السعر لازم يبقى رقم' });
    const mult = String(b.modifierMultiplier ?? v?.modifierMultiplier ?? '1');
    need(/^\d+(\.\d{1,4})?$/.test(mult) && D(mult).gt(0) && D(mult).lte(5), 'VALIDATION_FAILED', { field: 'modifierMultiplier', rule: '0 < x <= 5', reasonAr: 'مضاعف الإضافات من 0.25 لـ 5' });
    const sku = b.sku !== undefined ? (String(b.sku ?? '').trim() || null) : v?.sku ?? null;
    if (sku) need(!db.products.some((x) => x.sku === sku) && !db.products.some((x) => (x.variants ?? []).some((y) => y.sku === sku && !(x.id === p!.id && y.id === vid))), 'CATALOG_SKU_TAKEN', { sku, reasonAr: `الكود ${sku} مستخدم` });
    const barcode = b.barcode !== undefined ? (String(b.barcode ?? '').trim() || null) : v?.barcode ?? null;
    if (barcode) need(!db.products.some((x) => (x.variants ?? []).some((y) => y.active && y.barcode === barcode && !(x.id === p!.id && y.id === vid))), 'VALIDATION_FAILED', { field: 'barcode', rule: 'barcode unique among active variants', reasonAr: `الباركود ${barcode} مستخدم في حجم تاني` });
    if (b.calories !== undefined && b.calories !== null && b.calories !== '') need(Number.isInteger(Number(b.calories)) && Number(b.calories) >= 0, 'VALIDATION_FAILED', { field: 'calories' });
    const active = b.active ?? v?.active ?? true;
    if (!active && v?.isDefault) need(p!.variants.some((x) => x.id !== vid && x.active), 'VALIDATION_FAILED', { reasonAr: 'لازم يفضل حجم واحد شغال على الأقل' });
    const data = {
      id: vid, name, priceDelta: m4(delta), modifierMultiplier: mult, active, sku, barcode,
      attributes: b.attributes ?? v?.attributes ?? [{ name: 'size', value: name.en || name.ar }],
      calories: b.calories !== undefined ? (b.calories === '' || b.calories === null ? null : Number(b.calories)) : v?.calories ?? null,
      isDefault: b.isDefault ?? v?.isDefault ?? !p!.variants.some((x) => x.isDefault),
      sortOrder: b.sortOrder ?? v?.sortOrder ?? (p!.variants.length + 1) * 10, version: (v?.version ?? 0) + 1,
    };
    if (v) Object.assign(v, data); else p!.variants.push(data);
    if (data.isDefault) for (const x of p!.variants) if (x.id !== vid) x.isDefault = false;
    p!.version++;
    ctx.audit(`variant ${p!.sku}/${vid} ${v ? 'updated' : 'created'}`, p!.id);
    return productView(db, p!, ctx.branchId, { now: ctx.now });
  },

  // ───────── prices
  'Pricing.QuoteItem': (ctx) => {
    const b = ctx.body;
    const branchId = b.branchId ?? ctx.branchId;
    need(branchId, 'CONTEXT_REQUIRED');
    if (ctx.branchId && branchId !== ctx.branchId) throw new ApiError('PERMISSION_DENIED', { reason: 'other branch' });
    return quoteItem(ctx.db, { branchId, channel: b.channel ?? 'DINE_IN', productId: ctx.params.productId, quantity: String(b.quantity ?? '1'), modifierOptionIds: b.modifierOptionIds ?? [], variantId: b.variantId, halfProductId: b.halfProductId, comboSelections: b.comboSelections, at: ctx.now, modifierLevels: b.modifierLevels, modifierPlacement: b.modifierPlacement, nestedOptionIds: b.nestedOptionIds });
  },
  'Catalog.SetPrice': (ctx) => {
    const db = ctx.db;
    const b = ctx.body;
    const p = db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    need(db.branches.some((x) => x.id === b.branchId), 'ORGANIZATION_BRANCH_NOT_FOUND');
    need(['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(b.channel), 'VALIDATION_FAILED', { field: 'channel' });
    need(isMoney(b.amount) && D(b.amount).gte(0), 'VALIDATION_FAILED', { field: 'amount' });
    if (b.currency && b.currency !== 'EGP') throw new ApiError('VALIDATION_FAILED', { field: 'currency', rule: 'branch currency EGP' });
    // menu area (proposed field): variantId = the own price of one size
    const variantId = b.variantId ? String(b.variantId) : null;
    if (variantId) need((p!.variants ?? []).some((v) => v.id === variantId), 'VALIDATION_FAILED', { field: 'variantId', reasonAr: 'الحجم ده مش موجود' });
    const amount = m4(b.amount);
    if (D(amount).isZero() && policy<string>('ZeroPricePolicy') === 'DENY') throw new ApiError('PRICE_ZERO_NOT_ALLOWED');
    const from = b.effectiveFrom ? Date.parse(b.effectiveFrom) : ctx.now;
    const to = b.effectiveTo ? Date.parse(b.effectiveTo) : null;
    if (Number.isNaN(from) || (to !== null && (Number.isNaN(to) || to <= from))) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveTo', rule: 'effectiveTo > effectiveFrom' });
    if (from < ctx.now - 60_000) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveFrom', rule: 'no backdating; a started window is never re-priced' });
    if (from > ctx.now + 366 * 86_400_000) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveFrom', rule: 'at most 366 days ahead' });
    if (from > ctx.now + 60_000 && policy<string>('PriceSchedulingPolicy') === 'IMMEDIATE_ONLY') throw new ApiError('PRICE_SCHEDULING_NOT_ALLOWED');
    // doc 22 §3 over the rows of scope S = (product[, size], branch, channel) — menu-prices.ts
    const plan = planPriceWindow(db, ctx.now, { productId: p!.id, variantId, branchId: b.branchId, channel: b.channel, amount, from, to });
    const basis = plan.E ?? plan.C;
    ctx.requireApproval({ action: 'PRICE_CHANGE', targetType: 'catalog.Product', targetId: p!.id, context: { productId: p!.id, branchId: b.branchId, channel: b.channel, effectiveFrom: new Date(from).toISOString(), changeKind: plan.changeKind, basisRuleId: basis?.id ?? null, basisRuleVersion: basis?.version ?? null, oldAmount: plan.old, newAmount: amount, changePercent: plan.changePercent, firstPrice: plan.firstPrice, decrease: !!plan.old && D(amount).lessThan(plan.old), ...(variantId ? { variantId } : {}) }, grantId: b.approvalGrantId });
    const { rule, closedRule } = applyPriceWindow(db, plan, ctx.user!.id, ctx.nowIso, (prefix) => freshId(ctx.db, prefix));
    ctx.audit(`price ${p!.sku}${variantId ? '/' + variantId : ''} ${b.branchId}/${b.channel} ${plan.changeKind} ${plan.old ?? '—'} → ${amount}`, p!.id, true, b.approvalGrantId);
    return { rule, closedRule, changeKind: plan.changeKind, replacedRuleId: closedRule?.id ?? null, firstPrice: plan.firstPrice, changePercent: plan.changePercent };
  },
  'Product.PriceHistory': (ctx) => {
    // menu area: rows carry variantId (null = the product price); ?variantId= filters one size, ?variantId=BASE the product price only
    const vq = ctx.query.variantId;
    const rows = ctx.db.priceRules
      .filter((r) => r.productId === ctx.params.productId && (!ctx.query.branchId || r.branchId === ctx.query.branchId) && (!ctx.query.channel || r.channel === ctx.query.channel) && (!vq || (vq === 'BASE' ? !r.variantId : r.variantId === vq)))
      .sort((a, b) => b.effectiveFrom - a.effectiveFrom)
      .map((r) => ({ ...r, variantId: r.variantId ?? null, effectiveFromIso: new Date(r.effectiveFrom).toISOString(), effectiveToIso: r.effectiveTo ? new Date(r.effectiveTo).toISOString() : null, state: r.effectiveFrom > ctx.now ? 'SCHEDULED' : r.effectiveTo !== null && r.effectiveTo <= ctx.now ? 'ENDED' : 'CURRENT' }));
    return page(rows, ctx.query);
  },

  // ───────── taxes
  // contract: archived policies hidden unless includeArchived; usage counts archived products too (doc 23 §3)
  'TaxPolicy.List': (ctx) => page(ctx.db.taxPolicies.filter((t) => t.active || ctx.query.includeArchived === 'true').map((t) => ({ ...t, usedBy: taxUsage(ctx.db, t.id).length, usedByDefault: policy<{ taxPolicyId?: string } | null>('ProductTaxDefaultPolicy')?.taxPolicyId === t.id })), ctx.query),
  'TaxPolicy.Create': (ctx) => {
    requireFields(ctx, 'name', 'rate', 'calculationMode', 'jurisdiction', 'roundingMode', 'roundingScale');
    validateTax(ctx.body);
    if (ctx.body.calculationMode === 'INCLUSIVE') { /* allowed as data; service on inclusive menus is CAPABILITY_NOT_AVAILABLE at pricing */ }
    const t = { id: freshId(ctx.db, 'tax'), name: ctx.body.name, jurisdiction: ctx.body.jurisdiction, rate: String(ctx.body.rate), calculationMode: ctx.body.calculationMode, roundingMode: ctx.body.roundingMode, roundingScale: Number(ctx.body.roundingScale), fiscalTaxType: ctx.body.fiscalTaxType ?? null, fiscalSubtype: ctx.body.fiscalSubtype ?? null, active: true, version: 1, history: [{ at: ctx.nowIso, by: ctx.user!.id, change: `created ${ctx.body.rate}%` }], exemption: ctx.body.exemption ?? 'NONE' };
    ctx.db.taxPolicies.push(t);
    ctx.audit(`tax policy ${t.rate}%`, t.id, true);
    return t;
  },
  'TaxPolicy.Configure': (ctx) => {
    const t = ctx.db.taxPolicies.find((x) => x.id === ctx.params.taxPolicyId);
    need(t, 'TAX_POLICY_NOT_FOUND');
    need(t!.active, 'TAX_POLICY_ARCHIVED');
    checkVersion(t!, ctx.body.expectedVersion);
    validateTax({ ...t!, ...ctx.body });
    // doc 23 §3: every tax-relevant value is hashed; a name-only change raises no action
    const relevant = (x: any) => [x.calculationMode, x.jurisdiction, D(x.rate).toFixed(6), x.roundingMode, Number(x.roundingScale), x.fiscalTaxType ?? null, x.fiscalSubtype ?? null].join('|');
    const next = { ...t!, ...Object.fromEntries(Object.entries(ctx.body).filter(([, v]) => v !== undefined)) };
    if (relevant(t) !== relevant(next)) {
      ctx.requireApproval({ action: 'SENSITIVE_POLICY_CHANGE', targetType: 'taxes.TaxPolicy', targetId: t!.id, context: { policyId: `taxes.TaxPolicy:${t!.id}`, oldValueHash: relevant(t), newValueHash: relevant(next) }, grantId: ctx.body.approvalGrantId });
    }
    const before = `${t!.rate}% ${t!.calculationMode} ${t!.roundingMode}/${t!.roundingScale}`;
    Object.assign(t!, { name: ctx.body.name ?? t!.name, rate: ctx.body.rate !== undefined ? String(ctx.body.rate) : t!.rate, calculationMode: ctx.body.calculationMode ?? t!.calculationMode, roundingMode: ctx.body.roundingMode ?? t!.roundingMode, roundingScale: ctx.body.roundingScale ?? t!.roundingScale, jurisdiction: ctx.body.jurisdiction ?? t!.jurisdiction, fiscalTaxType: ctx.body.fiscalTaxType ?? t!.fiscalTaxType, fiscalSubtype: ctx.body.fiscalSubtype ?? t!.fiscalSubtype, exemption: ctx.body.exemption ?? t!.exemption });
    t!.version++;
    t!.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, change: `${before} → ${t!.rate}% ${t!.calculationMode} ${t!.roundingMode}/${t!.roundingScale} (applies to new quotes only)` });
    ctx.audit(`tax policy ${t!.id} configured`, t!.id, true, ctx.body.approvalGrantId);
    return t;
  },
  'TaxPolicy.SetActive': (ctx) => {
    const t = ctx.db.taxPolicies.find((x) => x.id === ctx.params.taxPolicyId);
    need(t, 'TAX_POLICY_NOT_FOUND');
    checkVersion(t!, ctx.body.expectedVersion);
    // in use = any product (archived included) or ProductTaxDefaultPolicy (doc 23 §3)
    const usedByDefault = policy<{ taxPolicyId?: string } | null>('ProductTaxDefaultPolicy')?.taxPolicyId === t!.id;
    if (!ctx.body.active && (taxUsage(ctx.db, t!.id).length || usedByDefault)) throw new ApiError('TAX_POLICY_IN_USE', { products: taxUsage(ctx.db, t!.id).map((p) => p.sku), productTaxDefault: usedByDefault });
    t!.active = !!ctx.body.active;
    t!.version++;
    t!.history.unshift({ at: ctx.nowIso, by: ctx.user!.id, change: t!.active ? 'reactivated' : 'archived' });
    return t;
  },

  // ───────── promotions
  'Promotion.Find': (ctx) => {
    const ch = ctx.query.validFor as Channel | undefined;
    const list = ctx.db.promotions.filter((p) => (ctx.query.includeInactive === 'true' || p.active) && (!ch || promotionActive(ctx, p, ch)));
    return page(list.map((p) => promotionView(ctx, p)), ctx.query);
  },
  'Promotion.Upsert': (ctx) => upsertPromotion(ctx),
  'Promotion.Create': (ctx) => {
    requireFields(ctx, 'name', 'kind', 'benefitType', 'benefitValue', 'channels', 'branchIds');
    if (ctx.body.kind === 'CODED') {
      need(ctx.body.code, 'VALIDATION_FAILED', { field: 'code' });
      need(!ctx.db.promotions.some((p) => p.code === ctx.body.code), 'PROMOTION_CODE_TAKEN');
    }
    need(['CODED', 'AUTOMATIC'].includes(ctx.body.kind), 'VALIDATION_FAILED', { field: 'kind' });
    validateBenefit(ctx.body.benefitType, ctx.body.benefitValue);
    need(Array.isArray(ctx.body.channels) && ctx.body.channels.length > 0, 'VALIDATION_FAILED', { field: 'channels' });
    if (ctx.body.minSubtotal) need(isMoney(String(ctx.body.minSubtotal)), 'VALIDATION_FAILED', { field: 'minSubtotal' });
    const pr = { id: freshId(ctx.db, 'promo'), name: ctx.body.name, kind: ctx.body.kind, code: ctx.body.code ?? null, benefitType: ctx.body.benefitType, benefitValue: String(ctx.body.benefitValue), branchIds: ctx.body.branchIds, channels: ctx.body.channels, minSubtotal: ctx.body.minSubtotal ? m4(ctx.body.minSubtotal) : null, schedule: normSchedule(ctx.body.schedule), validFrom: ctx.body.validFrom ? Date.parse(ctx.body.validFrom) : null, validTo: ctx.body.validTo ? Date.parse(ctx.body.validTo) : null, active: true, version: 1 };
    ctx.db.promotions.push(pr);
    return pr;
  },
  'Promotion.Configure': (ctx) => {
    const pr = ctx.db.promotions.find((x) => x.id === ctx.params.promotionId);
    need(pr, 'PROMOTION_NOT_FOUND');
    checkVersion(pr!, ctx.body.expectedVersion);
    // contract: kind and code are fixed; every other field may change
    const bt = ctx.body.benefitType ?? pr!.benefitType, bv = ctx.body.benefitValue !== undefined ? String(ctx.body.benefitValue) : pr!.benefitValue;
    validateBenefit(bt, bv);
    if (ctx.body.channels !== undefined) need(Array.isArray(ctx.body.channels) && ctx.body.channels.length > 0, 'VALIDATION_FAILED', { field: 'channels' });
    Object.assign(pr!, {
      active: ctx.body.active ?? pr!.active, benefitType: bt, benefitValue: bv, name: ctx.body.name ?? pr!.name,
      schedule: ctx.body.schedule !== undefined ? normSchedule(ctx.body.schedule) : pr!.schedule,
      channels: ctx.body.channels ?? pr!.channels, branchIds: ctx.body.branchIds ?? pr!.branchIds,
      minSubtotal: ctx.body.minSubtotal !== undefined ? (ctx.body.minSubtotal ? m4(ctx.body.minSubtotal) : null) : pr!.minSubtotal,
      validFrom: ctx.body.validFrom !== undefined ? (ctx.body.validFrom ? Date.parse(ctx.body.validFrom) : null) : pr!.validFrom,
      validTo: ctx.body.validTo !== undefined ? (ctx.body.validTo ? Date.parse(ctx.body.validTo) : null) : pr!.validTo,
    });
    pr!.version++;
    return pr;
  },
  'Promotion.ValidateCode': (ctx) => {
    const pr = findByCode(ctx.db, ctx.body.code);
    if (!pr) throw new ApiError('PROMOTION_CODE_INVALID');
    if (!promotionActive(ctx, pr, ctx.body.channel ?? 'DINE_IN')) throw new ApiError('PROMOTION_NOT_APPLICABLE');
    return pr;
  },

  // ───────── import (dry run then all-or-nothing)
  'Catalog.Import': (ctx) => importCatalog(ctx),
};

function importCatalog(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const issues: { sheet: string; row: number; field: string; code: string; message: string }[] = [];
  const keyMap: Record<string, string> = {};
  const units = b.units ?? [], categories = b.categories ?? [], products = b.products ?? [], prices = b.prices ?? [], groups = b.modifierGroups ?? [], options = b.modifierOptions ?? [], availability = b.availability ?? [];
  const unitCodes = new Set(db.units.map((u) => u.code));
  units.forEach((u: any, i: number) => {
    if (!u.code) issues.push({ sheet: 'units', row: i + 2, field: 'code', code: 'VALIDATION_FAILED', message: 'كود الوحدة مطلوب' });
    else if (unitCodes.has(u.code) && !db.units.find((x) => x.code === u.code)) issues.push({ sheet: 'units', row: i + 2, field: 'code', code: 'UNIT_CODE_TAKEN', message: 'كود مكرر في الملف' });
    unitCodes.add(u.code);
  });
  const catNames = new Set<string>();
  categories.forEach((c: any, i: number) => {
    if (!c.key) issues.push({ sheet: 'categories', row: i + 2, field: 'key', code: 'VALIDATION_FAILED', message: 'مفتاح القسم مطلوب' });
    if (!c.name_ar || !c.name_en) issues.push({ sheet: 'categories', row: i + 2, field: 'name', code: 'VALIDATION_FAILED', message: 'الاسم بالعربي والإنجليزي مطلوب' });
    if (catNames.has(c.key)) issues.push({ sheet: 'categories', row: i + 2, field: 'key', code: 'VALIDATION_FAILED', message: 'مفتاح مكرر' });
    catNames.add(c.key);
  });
  const groupKeys = new Set<string>(db.modifierGroups.map((g) => g.id));
  groups.forEach((g: any, i: number) => {
    if (!g.key || !g.name_ar) issues.push({ sheet: 'modifierGroups', row: i + 2, field: 'key', code: 'VALIDATION_FAILED', message: 'المفتاح والاسم مطلوبين' });
    if (Number(g.min ?? 0) > Number(g.max ?? 1)) issues.push({ sheet: 'modifierGroups', row: i + 2, field: 'min', code: 'VALIDATION_FAILED', message: 'الحد الأدنى أكبر من الأقصى' });
    groupKeys.add(g.key);
  });
  options.forEach((o: any, i: number) => {
    if (!groupKeys.has(o.group)) issues.push({ sheet: 'modifierOptions', row: i + 2, field: 'group', code: 'MODIFIER_DEFINITION_NOT_FOUND', message: `مجموعة "${o.group}" مش موجودة` });
    if (!isMoney(o.priceDelta ?? '0')) issues.push({ sheet: 'modifierOptions', row: i + 2, field: 'priceDelta', code: 'VALIDATION_FAILED', message: 'فرق السعر مش رقم' });
  });
  const skus = new Set(db.products.map((p) => p.sku));
  const prodKeys = new Set<string>();
  const sp = policy<{ mode: string }>('SkuGenerationPolicy')?.mode ?? 'MANUAL';
  products.forEach((p: any, i: number) => {
    const row = i + 2;
    if (!p.key) issues.push({ sheet: 'products', row, field: 'key', code: 'VALIDATION_FAILED', message: 'مفتاح الصنف مطلوب' });
    if (!p.name_ar || !p.name_en) issues.push({ sheet: 'products', row, field: 'name', code: 'VALIDATION_FAILED', message: 'الاسم بالعربي والإنجليزي مطلوب' });
    if (!catNames.has(p.category) && !db.categories.some((c) => c.id === p.category)) issues.push({ sheet: 'products', row, field: 'category', code: 'CATALOG_CATEGORY_NOT_FOUND', message: `القسم "${p.category}" مش موجود` });
    if (!unitCodes.has(p.unit)) issues.push({ sheet: 'products', row, field: 'unit', code: 'CATALOG_UNIT_NOT_FOUND', message: `الوحدة "${p.unit}" مش موجودة` });
    if (p.sku) { if (skus.has(p.sku)) issues.push({ sheet: 'products', row, field: 'sku', code: 'CATALOG_SKU_TAKEN', message: `الكود ${p.sku} مستخدم` }); skus.add(p.sku); }
    else if (sp !== 'AUTO_IF_EMPTY') issues.push({ sheet: 'products', row, field: 'sku', code: 'VALIDATION_FAILED', message: 'الكود مطلوب (السياسة MANUAL)' });
    if (p.tax && !db.taxPolicies.some((t) => t.id === p.tax && t.active)) issues.push({ sheet: 'products', row, field: 'tax', code: 'TAX_POLICY_NOT_FOUND', message: `الضريبة "${p.tax}" مش موجودة` });
    for (const g of String(p.modifier_groups ?? '').split(/[;,|]/).map((x) => x.trim()).filter(Boolean)) if (!groupKeys.has(g)) issues.push({ sheet: 'products', row, field: 'modifier_groups', code: 'MODIFIER_DEFINITION_NOT_FOUND', message: `مجموعة "${g}" مش موجودة` });
    if (p.key && prodKeys.has(p.key)) issues.push({ sheet: 'products', row, field: 'key', code: 'VALIDATION_FAILED', message: 'مفتاح صنف مكرر في الملف' });
    prodKeys.add(p.key);
  });
  // the import used to bypass ProductNameUniquenessPolicy, which Product.Create enforces
  if ((policy<{ default: string }>('ProductNameUniquenessPolicy')?.default ?? 'BLOCK') === 'BLOCK') {
    const seenAr = new Set<string>(), seenEn = new Set<string>();
    products.forEach((p: any, i: number) => {
      const ar = String(p.name_ar ?? '').trim(), en = String(p.name_en ?? '').trim().toLowerCase();
      if (!ar && !en) return;
      const clash = db.products.find((x) => x.active && ((ar && x.name.ar.trim() === ar) || (en && x.name.en.trim().toLowerCase() === en)));
      if (clash || (ar && seenAr.has(ar)) || (en && seenEn.has(en))) issues.push({ sheet: 'products', row: i + 2, field: 'name', code: 'CATALOG_PRODUCT_NAME_TAKEN', message: clash ? `الاسم مستخدم في صنف تاني (${clash.sku})` : 'الاسم متكرر في الملف' });
      if (ar) seenAr.add(ar);
      if (en) seenEn.add(en);
    });
  }
  prices.forEach((r: any, i: number) => {
    const row = i + 2;
    if (!prodKeys.has(r.product) && !db.products.some((p) => p.id === r.product)) issues.push({ sheet: 'prices', row, field: 'product', code: 'CATALOG_PRODUCT_NOT_FOUND', message: `الصنف "${r.product}" مش موجود` });
    if (!db.branches.some((b2) => b2.id === r.branch || b2.code === r.branch)) issues.push({ sheet: 'prices', row, field: 'branch', code: 'ORGANIZATION_BRANCH_NOT_FOUND', message: `الفرع "${r.branch}" مش موجود` });
    if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(r.channel)) issues.push({ sheet: 'prices', row, field: 'channel', code: 'VALIDATION_FAILED', message: 'القناة لازم DINE_IN أو TAKEAWAY أو DELIVERY' });
    if (!isMoney(r.amount)) issues.push({ sheet: 'prices', row, field: 'amount', code: 'VALIDATION_FAILED', message: 'السعر مش رقم صحيح (4 خانات عشرية بحد أقصى)' });
    else if (D(r.amount).isZero() && policy<string>('ZeroPricePolicy') === 'DENY') issues.push({ sheet: 'prices', row, field: 'amount', code: 'PRICE_ZERO_NOT_ALLOWED', message: 'السعر صفر ممنوع' });
  });
  // availability rows were not validated: a bad branch or state made the apply crash instead of refusing
  const reasonRule = policy<Record<string, string>>('AvailabilityReasonPolicy') ?? {};
  availability.forEach((a: any, i: number) => {
    const row = i + 2;
    if (!prodKeys.has(a.product) && !db.products.some((p) => p.id === a.product)) issues.push({ sheet: 'availability', row, field: 'product', code: 'CATALOG_PRODUCT_NOT_FOUND', message: `الصنف "${a.product}" مش موجود` });
    if (!db.branches.some((b2) => b2.id === a.branch || b2.code === a.branch)) issues.push({ sheet: 'availability', row, field: 'branch', code: 'ORGANIZATION_BRANCH_NOT_FOUND', message: `الفرع "${a.branch}" مش موجود` });
    const st = a.state ?? 'AVAILABLE';
    if (!['AVAILABLE', 'SOLD_OUT', 'BLOCKED'].includes(st)) issues.push({ sheet: 'availability', row, field: 'state', code: 'VALIDATION_FAILED', message: 'الحالة لازم AVAILABLE أو SOLD_OUT أو BLOCKED' });
    else if (st !== 'AVAILABLE' && reasonRule[st] === 'REQUIRED' && !String(a.reason ?? '').trim()) issues.push({ sheet: 'availability', row, field: 'reason', code: 'REASON_REQUIRED', message: 'السبب مطلوب للحالة دي (AvailabilityReasonPolicy)' });
  });
  const summary = { units: units.length, categories: categories.length, modifierGroups: groups.length, modifierOptions: options.length, products: products.length, prices: prices.length, availability: availability.length };
  if (!b.dryRun && issues.length) throw new ApiError('VALIDATION_FAILED', { issues, summary, rule: 'import is all-or-nothing: nothing was applied' });
  if (b.dryRun) return { status: 200, body: { dryRun: true, applied: false, ok: issues.length === 0, issues, summary } };
  // apply all-or-nothing (the kernel snapshot guarantees atomicity on any refusal)
  for (const u of units) if (!db.units.some((x) => x.code === u.code)) { const id = freshId(ctx.db, 'unit'); db.units.push({ id, code: u.code, precision: Number(u.precision ?? 0), active: true, used: true, version: 1 }); keyMap['unit:' + u.code] = id; }
  for (const c of categories) { const id = freshId(ctx.db, 'cat'); db.categories.push({ id, name: { ar: c.name_ar, en: c.name_en }, active: true, sortOrder: (db.categories.length + 1) * 10, version: 1, colorCode: c.color }); keyMap['cat:' + c.key] = id; }
  for (const g of groups) { const id = freshId(ctx.db, 'mg'); db.modifierGroups.push({ id, name: { ar: g.name_ar, en: g.name_en ?? g.name_ar }, selectionRule: g.selection ?? (Number(g.max ?? 1) > 1 ? 'MULTIPLE' : 'SINGLE'), min: Number(g.min ?? 0), max: Number(g.max ?? 1), active: true, options: [], version: 1 }); keyMap['mg:' + g.key] = id; }
  for (const o of options) { const gid = keyMap['mg:' + o.group] ?? o.group; const g = db.modifierGroups.find((x) => x.id === gid)!; g.options.push({ id: freshId(ctx.db, 'opt'), name: { ar: o.name_ar, en: o.name_en ?? o.name_ar }, priceDelta: m4(o.priceDelta ?? '0'), active: true, version: 1 }); }
  const branchOf = (x: string) => db.branches.find((b2) => b2.id === x || b2.code === x)!.id;
  for (const p of products) {
    const id = freshId(ctx.db, 'prod');
    const unitId = db.units.find((u) => u.code === p.unit)!.id;
    const catId = keyMap['cat:' + p.category] ?? p.category;
    const sku = p.sku || nextSku(db, catId);
    const mgs = String(p.modifier_groups ?? '').split(/[;,|]/).map((x) => x.trim()).filter(Boolean).map((k) => keyMap['mg:' + k] ?? k);
    db.products.push({ id, sku, name: { ar: p.name_ar, en: p.name_en }, categoryId: catId, unitId, taxPolicyId: p.tax ?? (policy<any>('ProductTaxDefaultPolicy')?.taxPolicyId ?? db.taxPolicies.find((t) => t.active)?.id ?? null), modifierGroupIds: mgs, active: true, version: 1, createdAt: ctx.nowIso, colorCode: p.color, imageUrl: p.image });
    keyMap['prod:' + p.key] = id;
  }
  for (const r of prices) {
    const pid = keyMap['prod:' + r.product] ?? r.product;
    db.priceRules.push({ id: freshId(ctx.db, 'pr'), productId: pid, branchId: branchOf(r.branch), channel: r.channel, amount: m4(r.amount), currency: 'EGP', effectiveFrom: ctx.now, effectiveTo: null, createdAt: ctx.nowIso, createdBy: ctx.user!.id, version: 1, replacesRuleId: null });
  }
  const avKeys = new Set<string>();
  for (const a of availability) {
    const pid = keyMap['prod:' + a.product] ?? a.product;
    const bid = branchOf(a.branch);
    avKeys.add(pid + bid);
    db.availability.push({ productId: pid, branchId: bid, state: a.state ?? 'AVAILABLE', reason: a.reason ?? null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
  }
  // products with a price on a branch are on that branch's menu unless availability says otherwise
  for (const r of prices) {
    const pid = keyMap['prod:' + r.product] ?? r.product;
    const bid = branchOf(r.branch);
    if (!avKeys.has(pid + bid) && !db.availability.some((a) => a.productId === pid && a.branchId === bid)) db.availability.push({ productId: pid, branchId: bid, state: 'AVAILABLE', reason: null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
  }
  ctx.audit(`catalog import: ${products.length} products, ${prices.length} prices`, 'catalog', true);
  return { status: 200, body: { dryRun: false, applied: true, ok: true, issues: [], summary, keyMap } };
}
