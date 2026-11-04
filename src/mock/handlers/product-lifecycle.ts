// ux-15 (PROPOSED, PROTOTYPE_GAPS §15l): the life of a product. A product that has ever been on a check is never deleted —
// it is retired (off every menu and sale screen, kept for history, reports, refunds and its price history) with a written
// reason, and can be reinstated. Deleting is only for a product created by mistake: never on any check, not part of a
// meal, a half-and-half pairing, a promotion, a menu list, a recipe or stock, and only when ProductRemovalPolicy.mode is
// DELETE_UNSOLD (RETIRE_ONLY by default). Authorization (catalog:upsertitem) is checked by the kernel before any read.
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { policyFields } from '../policies';
import { reasonText } from '../drawer-count';
import { menuState } from '../menu-engine';
import { checkVersion, need } from './util';
import type { DB, Product } from '../types';

export interface ProductRemovalRule { mode: 'RETIRE_ONLY' | 'DELETE_UNSOLD' }
export const productRemovalRule = (): ProductRemovalRule => policyFields<ProductRemovalRule>('ProductRemovalPolicy');

/** Where a product is used: checks it was sold on (any status), and the records that point to it. */
export function productUsage(db: DB, productId: string) {
  const checks = db.orders.filter((o) => o.lines.some((l) => l.productId === productId || (l as any).halfProductId === productId || ((l as any).comboSelections ?? []).some((c: any) => c.productId === productId)));
  const combos = db.products.filter((p) => p.id !== productId && (p.combo ?? []).some((s) => s.options.some((o) => o.productId === productId))).map((p) => ({ id: p.id, name: p.name, active: p.active }));
  const promotions = (db.promotions as any[]).filter((p) => [...(p.productIds ?? []), ...(p.getProductIds ?? []), ...((p.bundleParts ?? []).flatMap((x: any) => x.productIds ?? []))].includes(productId)).map((p) => ({ id: p.id, name: p.name, active: p.active }));
  const menus = menuState(db).menus.filter((m) => m.productIds.includes(productId) || m.excludedProductIds.includes(productId)).map((m) => ({ id: m.id, name: m.name }));
  const inv = db.inv;
  const recipes = (inv?.recipes ?? []).filter((r) => r.outputProductId === productId || r.appliesToProductId === productId).length;
  const stock = (inv?.items ?? []).filter((i) => i.productId === productId && i.id !== productId).length;
  const display = (db.dev?.content ?? []).filter((c) => c.productId === productId && !c.retired).length;
  return {
    productId, checks: checks.length, completedChecks: checks.filter((o) => o.status === 'COMPLETED').length, openChecks: checks.filter((o) => o.status === 'DRAFT' || o.status === 'CONFIRMED').length,
    combos, promotions, menus, recipes, stock, display,
  };
}

const view = (db: DB, p: Product) => ({ id: p.id, sku: p.sku, name: p.name, active: p.active, version: p.version, retired: (p as any).retired ?? null, usage: productUsage(db, p.id) });
const find = (ctx: Ctx) => { const p = ctx.db.products.find((x) => x.id === ctx.params.productId); need(p, 'CATALOG_PRODUCT_NOT_FOUND'); return p!; };

export const productLifecycleHandlers: Record<string, Handler> = {
  'Product.Usage': (ctx) => {
    const p = find(ctx);
    return { ...view(ctx.db, p), removal: productRemovalRule(), canDelete: canDelete(ctx.db, p).ok, deleteBlockers: canDelete(ctx.db, p).blockers };
  },
  'Product.Retire': (ctx) => {
    const p = find(ctx);
    checkVersion(p, ctx.body.expectedVersion);
    if (!p.active) throw new ApiError('PRODUCT_ALREADY_RETIRED', { productId: p.id }, 409);
    const reason = reasonText(ctx, ctx.body.reason, 'REASON_REQUIRED');
    // a meal that offers it must be changed first (the meal would lose a choice without anyone deciding)
    const meals = productUsage(ctx.db, p.id).combos.filter((c) => c.active);
    if (meals.length) throw new ApiError('PRODUCT_IN_USE', { combos: meals.map((m) => m.id), rule: 'remove it from these meals first' }, 409);
    p.active = false;
    (p as any).retired = { at: ctx.nowIso, by: ctx.user!.id, reason };
    p.version++;
    ctx.audit(`product ${p.sku} retired: ${reason}`, p.id, true);
    return view(ctx.db, p);
  },
  'Product.Reinstate': (ctx) => {
    const p = find(ctx);
    checkVersion(p, ctx.body.expectedVersion);
    if (p.active) throw new ApiError('VALIDATION_FAILED', { field: 'active', rule: 'the product is not retired' });
    const reason = ctx.body.reason ? reasonText(ctx, ctx.body.reason, 'VALIDATION_FAILED') : null;
    const was = (p as any).retired ?? null;
    p.active = true;
    (p as any).retired = null;
    (p as any).retiredHistory = [...((p as any).retiredHistory ?? []), { ...(was ?? {}), reinstatedAt: ctx.nowIso, reinstatedBy: ctx.user!.id, reinstateReason: reason }];
    p.version++;
    ctx.audit(`product ${p.sku} reinstated${reason ? `: ${reason}` : ''}`, p.id, true);
    return view(ctx.db, p);
  },
  'Product.Delete': (ctx) => {
    const p = find(ctx);
    checkVersion(p, ctx.body.expectedVersion);
    if (productRemovalRule().mode !== 'DELETE_UNSOLD') throw new ApiError('PRODUCT_DELETE_NOT_ALLOWED', { rule: 'ProductRemovalPolicy RETIRE_ONLY: retire the product instead' }, 409);
    const reason = reasonText(ctx, ctx.body.reason, 'REASON_REQUIRED');
    const c = canDelete(ctx.db, p);
    if (!c.ok) throw new ApiError('PRODUCT_HAS_HISTORY', { blockers: c.blockers, rule: 'retire the product instead' }, 409);
    // what belongs only to this product goes with it: its price rules, branch availability and routing rules
    const db = ctx.db;
    db.products.splice(db.products.indexOf(p), 1);
    db.priceRules = db.priceRules.filter((r) => r.productId !== p.id);
    db.availability = db.availability.filter((a) => a.productId !== p.id);
    db.routingRules = db.routingRules.filter((r) => r.match.productId !== p.id);
    ctx.audit(`product ${p.sku} (${p.name.ar}) deleted — never sold: ${reason}`, p.id, true);
    return { id: p.id, deleted: true };
  },
};

function canDelete(db: DB, p: Product) {
  const u = productUsage(db, p.id);
  const blockers: string[] = [];
  if (u.checks) blockers.push('CHECKS');
  if (u.combos.length) blockers.push('COMBOS');
  if (u.promotions.length) blockers.push('PROMOTIONS');
  if (u.menus.length) blockers.push('MENUS');
  if (u.recipes) blockers.push('RECIPES');
  if (u.stock) blockers.push('STOCK');
  if (u.display) blockers.push('DISPLAY');
  if ((p as any).halfAndHalf) blockers.push('HALF_AND_HALF');
  return { ok: blockers.length === 0, blockers };
}
