// Handlers of the proposed menu & pricing operations (menu-contracts.ts): dayparts and menus, the "sold out today"
// board, option availability, option order, combos, half-and-half, the branch price list and bulk price changes.
import { ApiError } from './errors';
import type { Handler, Ctx } from './kernel';
import { hashOf } from './kernel';
import { nextId } from './store';
import { policy } from './policies';
import { D, m4, isMoney } from './money';
import { checkVersion, need, page, userName } from './handlers/util';
import type { Channel, ComboSlot, DB, Product } from './types';
import type { BulkPriceChange, BulkPriceRow, Daypart, MenuDef } from './menu-types';
import { menuState, activeDayparts, daypartActive, nextDaypartStart, branchBusinessDate, effectiveAvailability, optionSoldOut, activeVariants, ruleAt, roundToStep, recipeCostOf, marginPercent, hm } from './menu-engine';
import { planPriceWindow, applyPriceWindow } from './menu-prices';
import { zonedParts } from './clock';

const CHANNELS: Channel[] = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function freshId(db: DB, prefix: string) {
  const ms = menuState(db);
  const taken = (id: string) => db.priceRules.some((r) => r.id === id) || ms.menus.some((m) => m.id === id) || ms.dayparts.some((d) => d.id === id) || ms.bulkChanges.some((b) => b.id === id);
  let id = nextId(prefix);
  while (taken(id)) id = nextId(prefix);
  return id;
}

/** Next business-day start (cutoff) after now, for "back automatically at …". */
function nextCutoff(db: DB, branchId: string | null, now: number): string {
  const br = db.branches.find((b) => b.id === branchId);
  const [ch, cm] = (br?.businessDayCutoff ?? '04:00').split(':').map(Number);
  const p = zonedParts(now, br?.timezone ?? 'Africa/Cairo');
  let delta = (ch * 60 + cm) - (p.hour * 60 + p.minute);
  if (delta <= 0) delta += 1440;
  return new Date(now - p.second * 1000 + delta * 60_000).toISOString();
}

function validateCombo(db: DB, p: Product, slots: any[]): ComboSlot[] {
  need(Array.isArray(slots), 'VALIDATION_FAILED', { field: 'slots' });
  need(slots.length <= 8, 'VALIDATION_FAILED', { field: 'slots', rule: 'at most 8', reasonAr: 'أقصى عدد 8 اختيارات في الوجبة' });
  const ids = new Set<string>();
  return slots.map((s: any, i: number) => {
    const id = String(s.id || `slot_${i + 1}`);
    need(!ids.has(id), 'VALIDATION_FAILED', { field: 'slots.id', reasonAr: 'فيه اختيارين بنفس الكود' });
    ids.add(id);
    need(s.name && String(s.name.ar ?? '').trim(), 'VALIDATION_FAILED', { field: `slots[${i}].name`, reasonAr: 'اسم كل اختيار في الوجبة مطلوب (مثلاً: المشروب)' });
    need(Array.isArray(s.options) && s.options.length > 0, 'VALIDATION_FAILED', { field: `slots[${i}].options`, reasonAr: `"${s.name?.ar ?? ''}" محتاج صنف واحد على الأقل` });
    const seen = new Set<string>();
    const options = s.options.map((o: any) => {
      const sp = db.products.find((x) => x.id === o.productId);
      need(sp && sp.active, 'CATALOG_PRODUCT_NOT_FOUND', { productId: o.productId, reasonAr: 'صنف في الوجبة مش موجود' });
      need(sp!.id !== p.id && !sp!.combo?.length, 'VALIDATION_FAILED', { field: 'productId', reasonAr: 'مينفعش وجبة جوه وجبة' });
      need(!seen.has(o.productId + ':' + (o.variantId ?? '')), 'VALIDATION_FAILED', { reasonAr: `${sp!.name.ar} متكرر في نفس الاختيار` });
      seen.add(o.productId + ':' + (o.variantId ?? ''));
      need(isMoney(String(o.upcharge ?? '0')) && D(String(o.upcharge ?? '0')).gte(0), 'VALIDATION_FAILED', { field: 'upcharge', reasonAr: 'فرق الترقية لازم رقم موجب أو صفر' });
      if (o.variantId) need((sp!.variants ?? []).some((v) => v.id === o.variantId), 'VALIDATION_FAILED', { field: 'variantId', reasonAr: `الحجم مش موجود في ${sp!.name.ar}` });
      if (o.nestedGroupId) need(db.modifierGroups.some((g) => g.id === o.nestedGroupId), 'MODIFIER_DEFINITION_NOT_FOUND', { groupId: o.nestedGroupId });
      return { productId: sp!.id, upcharge: m4(String(o.upcharge ?? '0')), ...(o.nestedGroupId ? { nestedGroupId: o.nestedGroupId } : {}), ...(o.variantId ? { variantId: o.variantId } : {}) };
    });
    const def = s.defaultProductId && options.some((o: any) => o.productId === s.defaultProductId) ? s.defaultProductId : options[0].productId;
    return { id, name: { ar: String(s.name.ar).trim(), en: String(s.name.en ?? s.name.ar).trim() }, options, defaultProductId: def, required: s.required !== false, sortOrder: (i + 1) * 10 };
  });
}

export const menuHandlers: Record<string, Handler> = {
  // ───────── dayparts & menus
  'Menu.Overview': (ctx) => {
    const ms = menuState(ctx.db);
    const dps = [...ms.dayparts].sort((a, b) => a.sortOrder - b.sortOrder).map((d) => ({ ...d, runningNow: daypartActive(d, ctx.now), nextStart: (() => { const n = nextDaypartStart(d, ctx.now); return n ? new Date(n).toISOString() : null; })() }));
    const menus = [...ms.menus].sort((a, b) => a.sortOrder - b.sortOrder).map((m) => ({ ...m, runningNow: m.active && (!m.daypartIds.length || m.daypartIds.some((id) => { const d = ms.dayparts.find((x) => x.id === id); return d ? daypartActive(d, ctx.now) : false; })) && (!m.branchIds.length || !ctx.branchId || m.branchIds.includes(ctx.branchId)) }));
    return { dayparts: dps, menus, now: { at: new Date(ctx.now).toISOString(), local: hm(ctx.now), businessDate: branchBusinessDate(ctx.db, ctx.branchId, ctx.now), activeDaypartIds: activeDayparts(ctx.db, ctx.now).map((d) => d.id) }, restricted: ms.menus.some((m) => m.active) };
  },
  'Daypart.Upsert': (ctx) => {
    const ms = menuState(ctx.db);
    const b = ctx.body;
    const id = ctx.params.daypartId === 'new' ? freshId(ctx.db, 'dp') : String(ctx.params.daypartId);
    const cur = ms.dayparts.find((d) => d.id === id);
    if (cur) checkVersion(cur, b.expectedVersion);
    need(b.name && String(b.name.ar ?? '').trim(), 'VALIDATION_FAILED', { field: 'name', reasonAr: 'اسم الفترة مطلوب' });
    need(HHMM.test(b.start ?? '') && HHMM.test(b.end ?? '') && b.start !== b.end, 'VALIDATION_FAILED', { field: 'start', rule: 'HH:MM, start != end (end < start crosses midnight)', reasonAr: 'البداية والنهاية لازم ساعة صحيحة ومختلفين' });
    const days = (b.days ?? [0, 1, 2, 3, 4, 5, 6]).map(Number);
    need(days.length > 0 && days.every((d: number) => d >= 0 && d <= 6), 'VALIDATION_FAILED', { field: 'days', reasonAr: 'اختار يوم واحد على الأقل' });
    const data: Daypart = { id, name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, start: b.start, end: b.end, days, color: b.color ?? cur?.color, active: b.active ?? cur?.active ?? true, sortOrder: b.sortOrder ?? cur?.sortOrder ?? (ms.dayparts.length + 1) * 10, version: (cur?.version ?? 0) + 1 };
    if (cur) Object.assign(cur, data); else ms.dayparts.push(data);
    ctx.audit(`daypart ${data.name.en} ${data.start}-${data.end}`, id);
    return data;
  },
  'Menu.Upsert': (ctx) => {
    const ms = menuState(ctx.db);
    const b = ctx.body;
    const id = ctx.params.menuId === 'new' ? freshId(ctx.db, 'menu') : String(ctx.params.menuId);
    const cur = ms.menus.find((m) => m.id === id);
    if (cur) checkVersion(cur, b.expectedVersion);
    need(b.name && String(b.name.ar ?? '').trim(), 'VALIDATION_FAILED', { field: 'name', reasonAr: 'اسم المنيو مطلوب' });
    const channels = (b.channels ?? cur?.channels ?? []) as Channel[];
    need(channels.length > 0 && channels.every((c) => CHANNELS.includes(c)), 'VALIDATION_FAILED', { field: 'channels', reasonAr: 'اختار قناة واحدة على الأقل (صالة، تيك أواي، دليفري)' });
    const branchIds: string[] = b.branchIds ?? cur?.branchIds ?? [];
    for (const x of branchIds) need(ctx.db.branches.some((br) => br.id === x), 'ORGANIZATION_BRANCH_NOT_FOUND', { branchId: x });
    const daypartIds: string[] = b.daypartIds ?? cur?.daypartIds ?? [];
    for (const x of daypartIds) need(ms.dayparts.some((d) => d.id === x), 'VALIDATION_FAILED', { field: 'daypartIds', reasonAr: 'فترة مش موجودة' });
    const categoryIds: string[] = b.categoryIds ?? cur?.categoryIds ?? [];
    const excludedCategoryIds: string[] = b.excludedCategoryIds ?? cur?.excludedCategoryIds ?? [];
    for (const x of [...categoryIds, ...excludedCategoryIds]) need(ctx.db.categories.some((c) => c.id === x), 'CATALOG_CATEGORY_NOT_FOUND', { categoryId: x });
    const productIds: string[] = b.productIds ?? cur?.productIds ?? [];
    const excludedProductIds: string[] = b.excludedProductIds ?? cur?.excludedProductIds ?? [];
    for (const x of [...productIds, ...excludedProductIds]) need(ctx.db.products.some((p) => p.id === x), 'CATALOG_PRODUCT_NOT_FOUND', { productId: x });
    const allCategories = b.allCategories ?? cur?.allCategories ?? false;
    need(allCategories || categoryIds.length || productIds.length, 'VALIDATION_FAILED', { field: 'categoryIds', reasonAr: 'المنيو فاضي — اختار أقسام أو أصناف' });
    const data: MenuDef = { id, name: { ar: String(b.name.ar).trim(), en: String(b.name.en ?? b.name.ar).trim() }, channels, branchIds, daypartIds, allCategories, categoryIds, productIds, excludedProductIds, excludedCategoryIds, active: b.active ?? cur?.active ?? true, sortOrder: b.sortOrder ?? cur?.sortOrder ?? (ms.menus.length + 1) * 10, version: (cur?.version ?? 0) + 1, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id };
    if (cur) Object.assign(cur, data); else ms.menus.push(data);
    ctx.audit(`menu ${data.name.en} (${channels.join(',')})`, id, true);
    return data;
  },

  // ───────── sold out today (86)
  'SoldOut.Board': (ctx) => {
    const db = ctx.db;
    need(ctx.branchId, 'CONTEXT_REQUIRED');
    const bid = ctx.branchId!;
    const today = branchBusinessDate(db, bid, ctx.now);
    const products = db.products.filter((p) => p.active).map((p) => ({ p, av: effectiveAvailability(db, p.id, bid, ctx.now) })).filter((x) => x.av && x.av.state !== 'AVAILABLE').map(({ p, av }) => ({
      productId: p.id, name: p.name, sku: p.sku, categoryId: p.categoryId, state: av!.state, reason: av!.reason, today: av!.soldOutFor === today, soldOutFor: av!.soldOutFor ?? null, updatedAt: av!.updatedAt, updatedByName: userName(db, av!.updatedBy),
    }));
    const options = menuState(db).optionAvailability.filter((o) => o.branchId === bid && optionSoldOut(db, o.optionId, bid, ctx.now)).map((o) => {
      const g = db.modifierGroups.find((x) => x.id === o.groupId);
      const opt = g?.options.find((x) => x.id === o.optionId);
      return { optionId: o.optionId, groupId: o.groupId, groupName: g?.name ?? null, name: opt?.name ?? { ar: o.optionId, en: o.optionId }, reason: o.reason, today: o.soldOutFor === today, updatedAt: o.updatedAt, updatedByName: userName(db, o.updatedBy) };
    });
    return { businessDate: today, resetsAt: nextCutoff(db, bid, ctx.now), autoReset: (policy<string>('SoldOutResetPolicy') ?? 'NEXT_BUSINESS_DAY') !== 'MANUAL', products, options };
  },
  'ModifierOption.SetAvailability': (ctx) => {
    const db = ctx.db;
    const g = db.modifierGroups.find((x) => x.id === ctx.params.groupId);
    const o = g?.options.find((x) => x.id === ctx.params.optionId);
    need(o, 'MODIFIER_OPTION_NOT_FOUND');
    need(ctx.branchId, 'CONTEXT_REQUIRED');
    const state = ctx.body.state;
    need(['AVAILABLE', 'SOLD_OUT'].includes(state), 'VALIDATION_FAILED', { field: 'state' });
    const ms = menuState(db);
    let row = ms.optionAvailability.find((x) => x.optionId === o!.id && x.branchId === ctx.branchId);
    if (!row) { row = { optionId: o!.id, groupId: g!.id, branchId: ctx.branchId!, state, soldOutFor: null, reason: null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id }; ms.optionAvailability.push(row); }
    Object.assign(row, { state, reason: state === 'SOLD_OUT' ? (ctx.body.reason ?? null) : null, soldOutFor: state === 'SOLD_OUT' && ctx.body.until !== 'UNTIL_RESET' ? branchBusinessDate(db, ctx.branchId, ctx.now) : null, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id });
    ctx.audit(`option ${o!.id} → ${state}`, o!.id);
    return row;
  },
  'ModifierGroup.ReorderOptions': (ctx) => {
    const g = ctx.db.modifierGroups.find((x) => x.id === ctx.params.groupId);
    need(g, 'MODIFIER_DEFINITION_NOT_FOUND');
    checkVersion(g!, ctx.body.expectedVersion);
    const ids: string[] = ctx.body.optionIds ?? [];
    need(Array.isArray(ids) && ids.length === g!.options.length && ids.every((id) => g!.options.some((o) => o.id === id)) && new Set(ids).size === ids.length, 'VALIDATION_FAILED', { field: 'optionIds', rule: 'every option of the group exactly once' });
    ids.forEach((id, i) => { g!.options.find((o) => o.id === id)!.sortOrder = (i + 1) * 10; });
    g!.version++;
    return g;
  },

  // ───────── combos & half-and-half
  'Product.SetCombo': (ctx) => {
    const p = ctx.db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    checkVersion(p!, ctx.body.expectedVersion);
    const slots = validateCombo(ctx.db, p!, ctx.body.slots ?? []);
    need(!slots.length || !p!.halfAndHalf, 'VALIDATION_FAILED', { reasonAr: 'الوجبة مينفعش تبقى نص ونص في نفس الوقت' });
    p!.combo = slots.length ? slots : undefined;
    p!.version++;
    ctx.audit(`combo ${p!.sku}: ${slots.length} choice groups`, p!.id);
    return { ...p!, combo: p!.combo ?? [] };
  },
  'Product.SetHalfAndHalf': (ctx) => {
    const p = ctx.db.products.find((x) => x.id === ctx.params.productId);
    need(p, 'CATALOG_PRODUCT_NOT_FOUND');
    checkVersion(p!, ctx.body.expectedVersion);
    const enabled = !!ctx.body.enabled;
    const ratio = String(ctx.body.halfPriceRatio ?? p!.halfPriceRatio ?? '0.5');
    need(/^\d(\.\d{1,4})?$/.test(ratio) && D(ratio).gt(0) && D(ratio).lte(1), 'VALIDATION_FAILED', { field: 'halfPriceRatio', rule: '0 < r <= 1', reasonAr: 'نسبة سعر النص من 0.01 لـ 1' });
    need(!enabled || !p!.combo?.length, 'VALIDATION_FAILED', { reasonAr: 'الوجبة (كومبو) مينفعش تبقى نص ونص' });
    p!.halfAndHalf = enabled;
    p!.halfGroup = (String(ctx.body.halfGroup ?? p!.halfGroup ?? '').trim() || null);
    p!.halfPriceRatio = ratio;
    p!.version++;
    ctx.audit(`half-and-half ${p!.sku} ${enabled ? 'on' : 'off'} (${p!.halfGroup ?? '-'})`, p!.id);
    return p;
  },

  // ───────── price list & bulk change
  'Catalog.PriceList': (ctx) => {
    const db = ctx.db;
    const bid = (ctx.query.branchId || ctx.branchId) as string;
    need(bid, 'CONTEXT_REQUIRED');
    const at = ctx.now;
    const items = db.products.filter((p) => p.active && (!ctx.query.categoryId || p.categoryId === ctx.query.categoryId)).map((p) => {
      const scopes = [null, ...activeVariants(p).map((v) => v.id)];
      const prices: Record<string, any> = {};
      for (const ch of CHANNELS) {
        for (const vid of scopes) {
          const cur = ruleAt(db, p.id, bid, ch, at, vid);
          const next = db.priceRules.filter((r) => r.productId === p.id && r.branchId === bid && r.channel === ch && (r.variantId ?? null) === vid && r.effectiveFrom > at).sort((a, b) => a.effectiveFrom - b.effectiveFrom)[0];
          if (cur || next) prices[`${ch}:${vid ?? 'BASE'}`] = { current: cur ? { amount: cur.amount, ruleId: cur.id, from: new Date(cur.effectiveFrom).toISOString() } : null, next: next ? { amount: next.amount, ruleId: next.id, from: new Date(next.effectiveFrom).toISOString() } : null };
        }
      }
      return { productId: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, variants: activeVariants(p).map((v) => ({ id: v.id, name: v.name, priceDelta: v.priceDelta, sku: v.sku ?? null })), prices, cost: recipeCostOf(db, p.id) };
    });
    return { branchId: bid, at: new Date(at).toISOString(), items };
  },
  'Catalog.PriceChangeBatches': (ctx) => page([...menuState(ctx.db).bulkChanges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({ ...b, createdByName: userName(ctx.db, b.createdBy), effectiveFromIso: new Date(b.effectiveFrom).toISOString(), status: b.effectiveFrom > ctx.now ? 'SCHEDULED' : 'APPLIED' })), ctx.query),
  'Catalog.BulkPriceChange': (ctx) => bulkPriceChange(ctx),
};

function bulkPriceChange(ctx: Ctx) {
  const db = ctx.db;
  const b = ctx.body;
  const mode = b.change?.mode;
  need(['PERCENT', 'FIXED'].includes(mode), 'VALIDATION_FAILED', { field: 'change.mode', reasonAr: 'اختار نسبة أو مبلغ ثابت' });
  const value = String(b.change?.value ?? '');
  need(isMoney(value) && !D(value).isZero(), 'VALIDATION_FAILED', { field: 'change.value', reasonAr: 'اكتب قيمة التغيير (ممكن بالسالب للتخفيض)' });
  if (mode === 'PERCENT') need(D(value).gt(-100) && D(value).lte(200), 'VALIDATION_FAILED', { field: 'change.value', rule: '-100 < % <= 200', reasonAr: 'النسبة لازم بين -99% و 200%' });
  const step = String(b.rounding?.step ?? '0');
  need(['0', '0.25', '0.50', '0.5', '1', '1.00', '5', '5.00'].includes(step), 'VALIDATION_FAILED', { field: 'rounding.step' });
  const direction = (b.rounding?.direction ?? 'NEAREST') as 'NEAREST' | 'UP' | 'DOWN';
  need(['NEAREST', 'UP', 'DOWN'].includes(direction), 'VALIDATION_FAILED', { field: 'rounding.direction' });
  const branchIds: string[] = b.filter?.branchIds?.length ? b.filter.branchIds : ctx.branchId ? [ctx.branchId] : db.branches.map((x) => x.id);
  for (const x of branchIds) need(db.branches.some((br) => br.id === x), 'ORGANIZATION_BRANCH_NOT_FOUND', { branchId: x });
  const channels: Channel[] = b.filter?.channels?.length ? b.filter.channels : CHANNELS;
  need(channels.every((c) => CHANNELS.includes(c)), 'VALIDATION_FAILED', { field: 'filter.channels' });
  const categoryIds: string[] = b.filter?.categoryIds ?? [];
  const productIds: string[] = b.filter?.productIds ?? [];
  const includeVariants = b.filter?.includeVariants !== false;
  const from = b.effectiveFrom ? Date.parse(b.effectiveFrom) : ctx.now;
  need(!Number.isNaN(from), 'VALIDATION_FAILED', { field: 'effectiveFrom' });
  if (from < ctx.now - 60_000) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveFrom', rule: 'no backdating', reasonAr: 'مينفعش تاريخ فات' });
  if (from > ctx.now + 366 * 86_400_000) throw new ApiError('VALIDATION_FAILED', { field: 'effectiveFrom', rule: 'at most 366 days ahead' });
  if (from > ctx.now + 60_000 && policy<string>('PriceSchedulingPolicy') === 'IMMEDIATE_ONLY') throw new ApiError('PRICE_SCHEDULING_NOT_ALLOWED');
  const zeroDenied = policy<string>('ZeroPricePolicy') === 'DENY';
  const at = Math.max(from, ctx.now);

  const rows: (BulkPriceRow & { name: any; variantName: any; sku: string; cost: string | null; marginOld: string | null; marginNew: string | null; categoryId: string })[] = [];
  const products = db.products.filter((p) => p.active && (!categoryIds.length || categoryIds.includes(p.categoryId)) && (!productIds.length || productIds.includes(p.id)));
  for (const p of products) {
    const scopes: (string | null)[] = [null, ...(includeVariants ? activeVariants(p).map((v) => v.id) : [])];
    for (const bid of branchIds) for (const ch of channels) for (const vid of scopes) {
      const cur = ruleAt(db, p.id, bid, ch, at, vid);
      if (!cur) continue; // nothing to change (a size without its own price follows the product price)
      const old = D(cur.amount);
      const raw = mode === 'PERCENT' ? old.times(D(100).plus(value)).dividedBy(100) : old.plus(value);
      let next = roundToStep(raw.lt(0) ? 0 : raw, step, direction);
      let skipped: string | null = null;
      if (D(next).eq(old)) skipped = 'UNCHANGED';
      else if (D(next).isZero() && zeroDenied) skipped = 'ZERO_NOT_ALLOWED';
      else { try { planPriceWindow(db, ctx.now, { productId: p.id, variantId: vid, branchId: bid, channel: ch, amount: next, from, to: null }); } catch (e: any) { skipped = e?.code === 'PRICE_SCHEDULE_CONFLICT' ? 'SCHEDULE_CONFLICT' : 'INVALID'; } }
      const v = vid ? (p.variants ?? []).find((x) => x.id === vid) : null;
      const cost = recipeCostOf(db, p.id, vid);
      const changePercent = old.isZero() ? null : D(next).minus(old).dividedBy(old).times(100).toDecimalPlaces(2).toString();
      rows.push({ productId: p.id, variantId: vid, branchId: bid, channel: ch, oldAmount: m4(old), newAmount: m4(next), changePercent, skipped, name: p.name, variantName: v?.name ?? null, sku: v?.sku || p.sku, cost, marginOld: marginPercent(m4(old), cost), marginNew: marginPercent(m4(next), cost), categoryId: p.categoryId });
    }
  }
  const effective = rows.filter((r) => !r.skipped);
  const maxPct = effective.reduce((a, r) => (r.changePercent && D(r.changePercent).abs().gt(a) ? D(r.changePercent).abs() : a), D(0));
  const summary = { rows: rows.length, changed: effective.length, skipped: rows.length - effective.length, maxChangePercent: maxPct.toString(), oldTotal: m4(effective.reduce((a, r) => a.plus(r.oldAmount), D(0))), newTotal: m4(effective.reduce((a, r) => a.plus(r.newAmount), D(0))), effectiveFrom: new Date(from).toISOString(), scheduled: from > ctx.now + 60_000 };
  if (b.dryRun) return { status: 200, body: { dryRun: true, rows, summary } };
  need(effective.length > 0, 'VALIDATION_FAILED', { reasonAr: 'مفيش أسعار هتتغير بالاختيارات دي' });

  // one PRICE_CHANGE approval for the whole batch (ApprovalRequirementPolicy[PRICE_CHANGE], same rule fields as one price)
  const targetId = 'bulk:' + hashOf({ f: b.filter ?? {}, c: b.change, r: b.rounding ?? {}, from: b.effectiveFrom ?? null, rows: effective.map((r) => [r.productId, r.variantId, r.branchId, r.channel, r.newAmount]) });
  ctx.requireApproval({ action: 'PRICE_CHANGE', targetType: 'catalog.PriceList', targetId, context: { productId: 'BULK', branchId: branchIds.join(','), channel: channels.join(','), effectiveFrom: new Date(from).toISOString(), changeKind: 'CHANGE', oldAmount: summary.oldTotal, newAmount: summary.newTotal, changePercent: summary.maxChangePercent, firstPrice: false, decrease: effective.some((r) => D(r.newAmount).lt(r.oldAmount)), rows: effective.length }, grantId: b.approvalGrantId });
  const batchId = freshId(db, 'pcb');
  for (const r of effective) {
    const plan = planPriceWindow(db, ctx.now, { productId: r.productId, variantId: r.variantId, branchId: r.branchId, channel: r.channel, amount: r.newAmount, from, to: null });
    const { rule } = applyPriceWindow(db, plan, ctx.user!.id, ctx.nowIso, (prefix) => freshId(db, prefix), { bulkChangeId: batchId });
    r.ruleId = rule.id;
  }
  const batch: BulkPriceChange = {
    id: batchId, createdAt: ctx.nowIso, createdBy: ctx.user!.id, effectiveFrom: from, status: from > ctx.now + 60_000 ? 'SCHEDULED' : 'APPLIED',
    filter: { categoryIds, branchIds, channels, productIds, includeVariants }, change: { mode, value }, rounding: { step, direction },
    rows: rows.map(({ productId, variantId, branchId, channel, oldAmount, newAmount, changePercent, ruleId, skipped }) => ({ productId, variantId, branchId, channel, oldAmount, newAmount, changePercent, ruleId: ruleId ?? null, skipped })), note: b.note, approvalGrantId: b.approvalGrantId ?? null,
  };
  menuState(db).bulkChanges.push(batch);
  ctx.audit(`bulk price change ${mode} ${value} (${effective.length} prices${batch.status === 'SCHEDULED' ? ', scheduled' : ''})`, batchId, true, b.approvalGrantId);
  return { status: 200, body: { dryRun: false, batch: { ...batch, effectiveFromIso: new Date(from).toISOString() }, rows, summary } };
}
