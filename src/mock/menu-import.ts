// Catalog.Import — menu-area sheets (proposed): sizes (variants), combo choice groups and their options, dayparts and
// menus. Validated with the rest of the import (row-level issues, all-or-nothing), applied after products and prices.
import { D, m4, isMoney } from './money';
import type { Channel, DB, ComboSlot, Variant } from './types';
import { menuState } from './menu-engine';
import { nextId } from './store';

type Issue = { sheet: string; row: number; field: string; code: string; message: string };
const CH = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const list = (v: unknown) => String(v ?? '').split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
const yes = (v: unknown) => ['1', 'true', 'yes', 'y', 'نعم', 'ايوه', 'أيوه'].includes(String(v ?? '').trim().toLowerCase());

export interface MenuSheets { variants: any[]; comboSlots: any[]; comboOptions: any[]; dayparts: any[]; menus: any[] }
export const menuSheetsOf = (b: any): MenuSheets => ({ variants: b.variants ?? [], comboSlots: b.comboSlots ?? [], comboOptions: b.comboOptions ?? [], dayparts: b.dayparts ?? [], menus: b.menus ?? [] });

/** prodKeys: product keys in the file; catKeys: category keys in the file; groupKeys: modifier group keys (file + db). */
export function validateMenuSheets(db: DB, s: MenuSheets, prices: any[], prodKeys: Set<string>, catKeys: Set<string>, groupKeys: Set<string>, issues: Issue[]) {
  const prodExists = (k: string) => prodKeys.has(k) || db.products.some((p) => p.id === k);
  const variantKeys = new Set<string>();
  s.variants.forEach((v, i) => {
    const row = i + 2;
    if (!prodExists(v.product)) issues.push({ sheet: 'variants', row, field: 'product', code: 'CATALOG_PRODUCT_NOT_FOUND', message: `الصنف "${v.product}" مش موجود` });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(v.key ?? ''))) issues.push({ sheet: 'variants', row, field: 'key', code: 'VALIDATION_FAILED', message: 'كود الحجم مطلوب (حروف إنجليزي وأرقام)' });
    if (!v.name_ar) issues.push({ sheet: 'variants', row, field: 'name_ar', code: 'VALIDATION_FAILED', message: 'اسم الحجم بالعربي مطلوب' });
    if (v.price_delta && !isMoney(v.price_delta)) issues.push({ sheet: 'variants', row, field: 'price_delta', code: 'VALIDATION_FAILED', message: 'فرق السعر مش رقم' });
    if (v.multiplier && !(/^\d+(\.\d{1,4})?$/.test(String(v.multiplier)) && D(v.multiplier).gt(0) && D(v.multiplier).lte(5))) issues.push({ sheet: 'variants', row, field: 'multiplier', code: 'VALIDATION_FAILED', message: 'مضاعف الإضافات من 0.25 لـ 5' });
    const k = `${v.product}:${v.key}`;
    if (variantKeys.has(k)) issues.push({ sheet: 'variants', row, field: 'key', code: 'VALIDATION_FAILED', message: 'الحجم متكرر لنفس الصنف' });
    variantKeys.add(k);
    if (v.sku && db.products.some((p) => p.sku === v.sku || (p.variants ?? []).some((x) => x.sku === v.sku))) issues.push({ sheet: 'variants', row, field: 'sku', code: 'CATALOG_SKU_TAKEN', message: `الكود ${v.sku} مستخدم` });
  });
  const hasVariant = (product: string, key: string) => variantKeys.has(`${product}:${key}`) || !!db.products.find((p) => p.id === product)?.variants?.some((x) => x.id === key);
  prices.forEach((r, i) => { if (r.variant && !hasVariant(r.product, r.variant)) issues.push({ sheet: 'prices', row: i + 2, field: 'variant', code: 'VALIDATION_FAILED', message: `الحجم "${r.variant}" مش موجود في الصنف` }); });
  const slotKeys = new Set<string>();
  s.comboSlots.forEach((c, i) => {
    const row = i + 2;
    if (!prodExists(c.product)) issues.push({ sheet: 'comboSlots', row, field: 'product', code: 'CATALOG_PRODUCT_NOT_FOUND', message: `الوجبة "${c.product}" مش موجودة` });
    if (!c.slot || !c.name_ar) issues.push({ sheet: 'comboSlots', row, field: 'slot', code: 'VALIDATION_FAILED', message: 'كود الاختيار واسمه بالعربي مطلوبين' });
    if (slotKeys.has(`${c.product}:${c.slot}`)) issues.push({ sheet: 'comboSlots', row, field: 'slot', code: 'VALIDATION_FAILED', message: 'الاختيار متكرر في نفس الوجبة' });
    slotKeys.add(`${c.product}:${c.slot}`);
  });
  const slotHasOption = new Set<string>();
  s.comboOptions.forEach((o, i) => {
    const row = i + 2;
    if (!slotKeys.has(`${o.product}:${o.slot}`)) issues.push({ sheet: 'comboOptions', row, field: 'slot', code: 'VALIDATION_FAILED', message: `الاختيار "${o.slot}" مش موجود في شيت comboSlots للوجبة دي` });
    if (!prodExists(o.option_product)) issues.push({ sheet: 'comboOptions', row, field: 'option_product', code: 'CATALOG_PRODUCT_NOT_FOUND', message: `الصنف "${o.option_product}" مش موجود` });
    if (o.option_product === o.product) issues.push({ sheet: 'comboOptions', row, field: 'option_product', code: 'VALIDATION_FAILED', message: 'مينفعش الوجبة تبقى جوه نفسها' });
    if (o.variant && !hasVariant(o.option_product, o.variant)) issues.push({ sheet: 'comboOptions', row, field: 'variant', code: 'VALIDATION_FAILED', message: `الحجم "${o.variant}" مش موجود` });
    if (o.upcharge && !(isMoney(o.upcharge) && D(o.upcharge).gte(0))) issues.push({ sheet: 'comboOptions', row, field: 'upcharge', code: 'VALIDATION_FAILED', message: 'فرق الترقية لازم رقم موجب أو صفر' });
    if (o.sub_group && !groupKeys.has(o.sub_group)) issues.push({ sheet: 'comboOptions', row, field: 'sub_group', code: 'MODIFIER_DEFINITION_NOT_FOUND', message: `مجموعة "${o.sub_group}" مش موجودة` });
    slotHasOption.add(`${o.product}:${o.slot}`);
  });
  s.comboSlots.forEach((c, i) => { if (c.slot && !slotHasOption.has(`${c.product}:${c.slot}`)) issues.push({ sheet: 'comboSlots', row: i + 2, field: 'slot', code: 'VALIDATION_FAILED', message: 'الاختيار ده مفيهوش أصناف في شيت comboOptions' }); });
  const dpKeys = new Set<string>(menuState(db).dayparts.map((d) => d.id));
  s.dayparts.forEach((d, i) => {
    const row = i + 2;
    if (!d.key || !d.name_ar) issues.push({ sheet: 'dayparts', row, field: 'key', code: 'VALIDATION_FAILED', message: 'الكود والاسم بالعربي مطلوبين' });
    if (!HHMM.test(d.start ?? '') || !HHMM.test(d.end ?? '') || d.start === d.end) issues.push({ sheet: 'dayparts', row, field: 'start', code: 'VALIDATION_FAILED', message: 'البداية والنهاية لازم بالشكل 07:00 ومختلفين' });
    if (d.days && !list(d.days).every((x) => /^[0-6]$/.test(x))) issues.push({ sheet: 'dayparts', row, field: 'days', code: 'VALIDATION_FAILED', message: 'الأيام أرقام من 0 (الحد) لـ 6 (السبت)' });
    dpKeys.add(d.key);
  });
  s.menus.forEach((m, i) => {
    const row = i + 2;
    if (!m.key || !m.name_ar) issues.push({ sheet: 'menus', row, field: 'key', code: 'VALIDATION_FAILED', message: 'الكود والاسم بالعربي مطلوبين' });
    const chs = list(m.channels);
    if (!chs.length || !chs.every((c) => CH.includes(c))) issues.push({ sheet: 'menus', row, field: 'channels', code: 'VALIDATION_FAILED', message: 'القنوات: DINE_IN / TAKEAWAY / DELIVERY مفصولة بـ ;' });
    for (const d of list(m.dayparts)) if (!dpKeys.has(d)) issues.push({ sheet: 'menus', row, field: 'dayparts', code: 'VALIDATION_FAILED', message: `الفترة "${d}" مش موجودة` });
    for (const c of [...list(m.categories), ...list(m.exclude_categories)]) if (!catKeys.has(c) && !db.categories.some((x) => x.id === c)) issues.push({ sheet: 'menus', row, field: 'categories', code: 'CATALOG_CATEGORY_NOT_FOUND', message: `القسم "${c}" مش موجود` });
    if (!yes(m.all_categories) && !list(m.categories).length) issues.push({ sheet: 'menus', row, field: 'categories', code: 'VALIDATION_FAILED', message: 'المنيو فاضي — اكتب أقسام أو all_categories = yes' });
  });
}

export function applyMenuSheets(db: DB, s: MenuSheets, keyMap: Record<string, string>, nowIso: string, userId: string) {
  const pid = (k: string) => keyMap['prod:' + k] ?? k;
  const cid = (k: string) => keyMap['cat:' + k] ?? k;
  const gid = (k: string) => keyMap['mg:' + k] ?? k;
  for (const v of s.variants) {
    const p = db.products.find((x) => x.id === pid(v.product))!;
    p.variants = p.variants ?? [];
    const data: Variant = { id: v.key, name: { ar: v.name_ar, en: v.name_en || v.name_ar }, priceDelta: m4(v.price_delta || '0'), modifierMultiplier: String(v.multiplier || '1'), active: true, sku: v.sku || null, barcode: v.barcode || null, isDefault: yes(v.default), sortOrder: (p.variants.length + 1) * 10, version: 1, attributes: [{ name: 'size', value: v.name_en || v.name_ar }] };
    const cur = p.variants.find((x) => x.id === v.key);
    if (cur) Object.assign(cur, data); else p.variants.push(data);
    if (data.isDefault) for (const x of p.variants) if (x.id !== data.id) x.isDefault = false;
    if (!p.variants.some((x) => x.isDefault)) p.variants[0].isDefault = true;
  }
  const byCombo = new Map<string, ComboSlot[]>();
  s.comboSlots.forEach((c, i) => {
    const options = s.comboOptions.filter((o) => o.product === c.product && o.slot === c.slot).map((o) => ({ productId: pid(o.option_product), upcharge: m4(o.upcharge || '0'), ...(o.variant ? { variantId: o.variant } : {}), ...(o.sub_group ? { nestedGroupId: gid(o.sub_group) } : {}) }));
    const def = s.comboOptions.find((o) => o.product === c.product && o.slot === c.slot && yes(o.default));
    const slot: ComboSlot = { id: c.slot, name: { ar: c.name_ar, en: c.name_en || c.name_ar }, options, defaultProductId: def ? pid(def.option_product) : options[0].productId, required: c.required === undefined || c.required === '' ? true : yes(c.required), sortOrder: (i + 1) * 10 };
    byCombo.set(pid(c.product), [...(byCombo.get(pid(c.product)) ?? []), slot]);
  });
  for (const [id, slots] of byCombo) { const p = db.products.find((x) => x.id === id)!; p.combo = slots; p.halfAndHalf = false; }
  const ms = menuState(db);
  // the first menus switch the cashier to "only what is on a running menu": keep everything else on an all-day base menu
  if (s.menus.length && !ms.menus.some((m) => m.active)) {
    const timed = s.menus.filter((m) => list(m.dayparts).length && !yes(m.all_categories)).flatMap((m) => list(m.categories).map(cid));
    ms.menus.push({ id: 'menu_main', name: { ar: 'المنيو الأساسي', en: 'Main menu' }, channels: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'], branchIds: [], daypartIds: [], allCategories: true, categoryIds: [], productIds: [], excludedProductIds: [], excludedCategoryIds: [...new Set(timed)], active: true, sortOrder: 5, version: 1, updatedAt: nowIso, updatedBy: userId });
  }
  for (const d of s.dayparts) {
    const data = { id: d.key, name: { ar: d.name_ar, en: d.name_en || d.name_ar }, start: d.start, end: d.end, days: d.days ? list(d.days).map(Number) : [0, 1, 2, 3, 4, 5, 6], color: d.color || '#22d3ee', active: true, sortOrder: (ms.dayparts.length + 1) * 10, version: 1 };
    const cur = ms.dayparts.find((x) => x.id === d.key);
    if (cur) Object.assign(cur, { ...data, version: cur.version + 1 }); else ms.dayparts.push(data);
  }
  for (const m of s.menus) {
    const data = { id: m.key || nextId('menu'), name: { ar: m.name_ar, en: m.name_en || m.name_ar }, channels: list(m.channels) as Channel[], branchIds: [], daypartIds: list(m.dayparts), allCategories: yes(m.all_categories), categoryIds: list(m.categories).map(cid), productIds: [], excludedProductIds: [], excludedCategoryIds: list(m.exclude_categories).map(cid), active: true, sortOrder: (ms.menus.length + 1) * 10, version: 1, updatedAt: nowIso, updatedBy: userId };
    const cur = ms.menus.find((x) => x.id === data.id);
    if (cur) Object.assign(cur, { ...data, version: cur.version + 1 }); else ms.menus.push(data);
  }
}
