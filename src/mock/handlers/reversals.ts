// Principle 1 — who did it vs who allowed it. The removal trace (every removal at every stage), stage helpers that
// need the database, stock effects of a return (reusing the inventory engine), staff-meal allowance, the staff-meal
// cancellation through the stages, and the accountant's void review queue.
import { ApiError } from '../errors';
import type { Ctx, Handler } from '../kernel';
import { nextId, hist, event } from '../store';
import { policy } from '../policies';
import Decimal from 'decimal.js';
import { D, m4 } from '../money';
import { need, page, requireBranch, userName, getOrder, checkVersion, reasonCheck } from './util';
import { invOf, post, explodeProduct, itemUnitCost, type Actor } from './inventory-engine';
import { inventoryOnOrderChange } from './inventory';
import { quoteItem } from '../pricing';
import { lineStage, STAGE_ACTION, legacyDisposition, DISPOSITIONS } from '../control-registry';
import type { DB, Order, OrderLine, ApprovalGrant, Loc } from '../types';
import type { ReversalRec, StageId, Disposition, CredentialKind } from '../types-control';

export const reversalsOf = (db: DB): ReversalRec[] => (db.reversals ??= []);

/** How the approver proved who they are (a remote grant came from an approval request). */
export function credKindOf(db: DB, g: ApprovalGrant | null | undefined): CredentialKind | null {
  if (!g) return null;
  if (g.credentialKind) return g.credentialKind;
  if ((db.approvalRequests ?? []).some((r) => r.grantId === g.id)) return 'REMOTE';
  return 'PIN';
}

export const isDayClosed = (db: DB, branchId: string, date: string) => (db.businessDays ?? []).some((d) => d.branchId === branchId && d.date === date);

/** The business date the money of a paid check belongs to. */
export function paidDateOf(db: DB, o: Order): string {
  const lastCap = db.captures.filter((c) => c.orderId === o.id).map((c) => c.businessDate).sort().at(-1);
  return o.completedBusinessDate ?? lastCap ?? o.businessDate;
}
/** S2 = paid, business day still open; S3 = that business day is closed. */
export function paidStage(db: DB, o: Order): 'S2' | 'S3' {
  return isDayClosed(db, o.branchId, paidDateOf(db, o)) ? 'S3' : 'S2';
}
export { lineStage, STAGE_ACTION };

export function checkDisposition(v: unknown, field = 'disposition'): Disposition | null {
  if (v === undefined || v === null || v === '') return null;
  if (!DISPOSITIONS.includes(v as Disposition)) throw new ApiError('VALIDATION_FAILED', { field, rule: DISPOSITIONS.join('|') });
  return v as Disposition;
}
export function kitchenStartedFor(db: DB, lineId: string) {
  return db.tickets.some((t) => t.items.some((i) => i.lineId === lineId) && (t.state !== 'NEW' || !!(t as any).startedAt));
}
/** A disposition for a fired line: chosen, else by kitchen start (not started → nothing made; started → spoiled, kept). */
export function voidDisposition(db: DB, l: OrderLine, chosen: Disposition | null): Disposition {
  const started = kitchenStartedFor(db, l.id);
  if (chosen === 'NOT_PREPARED' && started) throw new ApiError('DISPOSITION_NOT_ALLOWED', { disposition: chosen, reason: 'the kitchen already started this item' });
  if (chosen) return chosen;
  const p = policy<{ beforeKitchenStart: string; afterKitchenStart: string }>('LineVoidDispositionPolicy') ?? { beforeKitchenStart: 'NOT_PREPARED', afterKitchenStart: 'WASTE' };
  const v = started ? p.afterKitchenStart : p.beforeKitchenStart;
  return v === 'WASTE' ? 'WASTE_HELD' : 'NOT_PREPARED';
}
export { legacyDisposition };

/** Write one removal to the trace. WASTE_HELD items wait for the accountant. */
export function recordReversal(ctx: Ctx, r: { o: Order; line?: OrderLine | null; name?: Loc; quantity: string; value: string; stage: StageId; kind: ReversalRec['kind']; grant?: ApprovalGrant | null; reasonCode?: string | null; reason?: string | null; disposition?: Disposition | null; sessionId?: string | null; refundId?: string | null; afterClose?: boolean }): ReversalRec {
  const db = ctx.db;
  const session = r.sessionId ? db.sessions.find((s) => s.id === r.sessionId) : null;
  const rec: ReversalRec = {
    id: nextId('rev'), at: ctx.nowIso, atMs: ctx.now, businessDate: ctx.businessDate(r.o.branchId), originalBusinessDate: r.o.completedBusinessDate ?? r.o.businessDate,
    branchId: r.o.branchId, orderId: r.o.id, orderNumber: r.o.number, orderKind: r.o.kind,
    lineId: r.line?.id ?? null, productId: r.line?.productId ?? null, name: r.name ?? r.line?.name ?? { ar: 'الشيك كله', en: 'Whole check' }, quantity: String(r.quantity), value: m4(r.value),
    stage: r.stage, kind: r.kind, actorId: ctx.user!.id, approverId: r.grant?.approverUserId ?? null, grantId: r.grant?.id ?? null, credentialKind: credKindOf(db, r.grant),
    terminalId: ctx.terminal?.id ?? null, sessionId: r.sessionId ?? null, drawerOwnerId: session?.userId ?? null,
    reasonCode: r.reasonCode ?? null, reason: r.reason ?? null, disposition: r.disposition ?? null, refundId: r.refundId ?? null, afterClose: !!r.afterClose,
    review: r.disposition === 'WASTE_HELD' ? { state: 'PENDING' } : null,
  };
  reversalsOf(db).unshift(rec);
  if (reversalsOf(db).length > 2000) reversalsOf(db).length = 2000;
  return rec;
}

/** "بموافقة هبة (كارت)" — the approver in words for history lines. */
export function approvedText(db: DB, g: ApprovalGrant | null | undefined): string {
  if (!g) return 'بلا موافقة (حسب الإعداد)';
  const k = credKindOf(db, g);
  const how = k === 'CARD' ? 'بالبطاقة' : k === 'FINGERPRINT' ? 'بالبصمة' : k === 'REMOTE' ? 'من جهازه' : 'بالرقم السري';
  return `بموافقة ${userName(db, g.approverUserId)} ${how}`;
}
export const DISP_AR: Record<Disposition, string> = { NOT_PREPARED: 'لم يُحضَّر', RETURN_TO_STOCK: 'عاد إلى المخزن', WASTE_HELD: 'هالك محفوظ للمراجعة' };
export const STAGE_AR: Record<StageId, string> = { S0: 'قبل أن يظهر للعميل', S1: 'بعد ظهوره للعميل (قبل الدفع)', S2: 'بعد الدفع (اليوم نفسه)', S3: 'مرتجع بعد إغلاق اليوم' };

/**
 * Stock effect of returning `qty` of a consumed line (refund or return after close): back to the shelf, or the
 * consumption re-booked as waste (the item is kept for the accountant). Uses the line's own consumption movements.
 */
export function stockForReturn(ctx: Ctx, o: Order, l: OrderLine, qty: string, disp: Disposition | null) {
  if (!disp || disp === 'NOT_PREPARED') return;
  const db = ctx.db;
  const inv = (db as any).inv ? invOf(db) : null;
  if (!inv) return;
  try {
    const eff = inv.orderEffects[`${o.id}:${l.id}`];
    if (!eff || eff.state !== 'SALE') return;
    const share = D(qty).dividedBy(D(l.quantity));
    const actor: Actor = { userId: ctx.user?.id ?? null, nowMs: ctx.now, commandId: ctx.commandId };
    const source = { module: 'refunds', command: ctx.op.id, id: o.id, number: o.number, orderId: o.id, lineId: l.id, label: l.name.ar };
    for (const id of eff.movementIds) {
      const m = inv.movements.find((x) => x.id === id && x.kind === 'SALE');
      if (!m) continue;
      const part = D(m.quantity).times(share); // negative (it was an outflow)
      if (part.isZero()) continue;
      if (disp === 'RETURN_TO_STOCK') post(db, actor, { itemId: m.itemId, warehouseId: m.warehouseId, kind: 'CUSTOMER_RETURN', quantity: part.negated(), unitCost: m.unitCost, source, reason: 'RETURN_TO_STOCK', negative: 'ALLOW' });
      else {
        post(db, actor, { itemId: m.itemId, warehouseId: m.warehouseId, kind: 'SALE_REVERSAL', quantity: part.negated(), unitCost: m.unitCost, source, reason: 'RETURNED_SPOILED', negative: 'ALLOW' });
        post(db, actor, { itemId: m.itemId, warehouseId: m.warehouseId, kind: 'VOID_WASTE', quantity: part, unitCost: m.unitCost, source, reason: 'RETURNED_SPOILED', negative: 'ALLOW' });
      }
    }
  } catch (e) {
    console.error('stock for return', e); // the money decision never fails on a stock problem
  }
}

// ───────── staff meals: value against the daily allowance
export interface Allowance { enabled: boolean; basis: 'SALE_PRICE' | 'COST'; dailyLimit: string; used: string; remaining: string | null; meals: number }
function lineCost(db: DB, l: OrderLine, atMs: number): { cost: string; known: boolean } {
  try {
    if (!(db as any).inv) return { cost: l.lineTotal, known: false };
    const { needs, recipeFound } = explodeProduct(db, l.productId, l.quantity, l.modifiers.map((m) => m.optionId), atMs);
    if (!recipeFound) return { cost: l.lineTotal, known: false };
    const inv = invOf(db);
    let c = D(0);
    needs.forEach((q, itemId) => { const it = inv.items.find((i) => i.id === itemId); if (it) c = c.plus(q.times(itemUnitCost(db, it))); });
    return { cost: m4(c), known: true };
  } catch { return { cost: l.lineTotal, known: false }; }
}
export function mealValue(db: DB, lines: OrderLine[], basis: 'SALE_PRICE' | 'COST', atMs: number) {
  let v = D(0), sale = D(0), unknown = 0;
  for (const l of lines) {
    sale = sale.plus(l.lineTotal);
    if (basis === 'COST') { const c = lineCost(db, l, atMs); v = v.plus(c.cost); if (!c.known) unknown++; } else v = v.plus(l.lineTotal);
  }
  return { value: m4(v), sale: m4(sale), costUnknownLines: unknown };
}
export function allowancePolicy(branchId: string | null) {
  const p = policy<{ enabled?: boolean; basis?: string; dailyLimit?: string }>('StaffMealAllowancePolicy', { branchId }) ?? {};
  return { enabled: p.enabled !== false, basis: (p.basis === 'COST' ? 'COST' : 'SALE_PRICE') as 'SALE_PRICE' | 'COST', dailyLimit: m4(p.dailyLimit ?? '200') };
}
export function allowanceOf(ctx: Ctx, employeeUserId: string, branchId: string): Allowance {
  const p = allowancePolicy(branchId);
  const today = ctx.businessDate(branchId);
  const meals = ctx.db.orders.filter((o) => o.kind === 'STAFF_MEAL' && o.branchId === branchId && o.businessDate === today && o.staffMeal?.employeeUserId === employeeUserId && o.status !== 'VOIDED');
  let used = D(0);
  for (const o of meals) used = used.plus(mealValue(ctx.db, o.lines.filter((l) => l.status === 'ACTIVE'), p.basis, o.createdAtMs).value);
  return { enabled: p.enabled, basis: p.basis, dailyLimit: p.dailyLimit, used: m4(used), remaining: p.enabled ? m4(Decimal.max(0, D(p.dailyLimit).minus(used))) : null, meals: meals.length };
}
/** People a staff meal can be for: active users with a role in this branch (the owner excluded). */
export function staffOf(db: DB, branchId: string) {
  return db.users.filter((u) => u.active && u.roleAssignments.some((ra) => ra.roleId !== 'role_owner' && (ra.branchIds.includes(branchId) || ra.branchIds.includes('*'))));
}

const OPEN = (o: Order) => o.status === 'DRAFT' || o.status === 'CONFIRMED';

export const reversalHandlers: Record<string, Handler> = {
  'Reversal.Find': (ctx) => {
    const q = ctx.query;
    const branchId = requireBranch(ctx);
    let items = reversalsOf(ctx.db).filter((r) => r.branchId === branchId);
    if (q.stage) items = items.filter((r) => q.stage.split(',').includes(r.stage));
    if (q.kind) items = items.filter((r) => q.kind.split(',').includes(r.kind));
    if (q.orderId) items = items.filter((r) => r.orderId === q.orderId);
    if (q.businessDate) items = items.filter((r) => r.businessDate === q.businessDate);
    if (q.afterClose === 'true') items = items.filter((r) => r.afterClose);
    const view = items.map((r) => ({ ...r, actorName: userName(ctx.db, r.actorId), approverName: r.approverId ? userName(ctx.db, r.approverId) : null, drawerOwnerName: r.drawerOwnerId ? userName(ctx.db, r.drawerOwnerId) : null, reviewerName: r.review?.by ? userName(ctx.db, r.review.by) : null }));
    const byStage: Record<string, { count: number; value: string }> = {};
    for (const r of items) { const s = (byStage[r.stage] ??= { count: 0, value: '0.0000' }); s.count++; s.value = m4(D(s.value).plus(r.value)); }
    return { ...page(view, q), byStage };
  },
  'VoidReview.Find': (ctx) => {
    const branchId = requireBranch(ctx);
    const all = reversalsOf(ctx.db).filter((r) => r.branchId === branchId && r.disposition === 'WASTE_HELD');
    const st = ctx.query.state;
    const items = st ? all.filter((r) => st.split(',').includes(r.review?.state ?? 'PENDING')) : all;
    const flags: Record<string, { approverId: string; name: string; missing: number; verified: number; pending: number }> = {};
    for (const r of all) {
      const who = r.approverId ?? r.actorId;
      const f = (flags[who] ??= { approverId: who, name: userName(ctx.db, who), missing: 0, verified: 0, pending: 0 });
      if (r.review?.state === 'MISSING') f.missing++; else if (r.review?.state === 'VERIFIED') f.verified++; else f.pending++;
    }
    return {
      ...page(items.map((r) => ({ ...r, actorName: userName(ctx.db, r.actorId), approverName: r.approverId ? userName(ctx.db, r.approverId) : null, reviewerName: r.review?.by ? userName(ctx.db, r.review.by) : null })), ctx.query),
      pending: all.filter((r) => r.review?.state === 'PENDING').length, flags: Object.values(flags).sort((a, b) => b.missing - a.missing),
    };
  },
  'VoidReview.Decide': (ctx) => {
    const r = reversalsOf(ctx.db).find((x) => x.id === ctx.params.reversalId && x.branchId === ctx.branchId);
    if (!r || r.disposition !== 'WASTE_HELD' || !r.review) throw new ApiError('VOID_REVIEW_NOT_FOUND', { reversalId: ctx.params.reversalId }, 404);
    if (r.review.state !== 'PENDING') throw new ApiError('VOID_REVIEW_ALREADY_DECIDED', { state: r.review.state }, 409);
    const d = ctx.body.decision;
    need(d === 'VERIFIED' || d === 'MISSING', 'VALIDATION_FAILED', { field: 'decision', rule: 'VERIFIED|MISSING' });
    const note = String(ctx.body.note ?? '').trim().slice(0, 300);
    if (d === 'MISSING' && !note) throw new ApiError('VALIDATION_FAILED', { field: 'note', rule: 'say what you found' });
    if (ctx.user!.id === r.approverId || ctx.user!.id === r.actorId) throw new ApiError('SELF_APPROVAL_DENIED', { reason: 'the person who removed or approved the item cannot review it' });
    r.review = { state: d, by: ctx.user!.id, at: ctx.nowIso, note: note || undefined };
    const resp = r.approverId ?? r.actorId;
    if (d === 'MISSING') {
      ctx.db.alerts.unshift({ id: nextId('al'), at: ctx.nowIso, kind: 'VOID_ITEM_MISSING', severity: 'error', text: { ar: `صنف ملغي غير موجود وقت المراجعة: ${r.name.ar} ×${Number(r.quantity)} من شيك #${r.orderNumber} — المسؤول ${userName(ctx.db, resp)}`, en: `Voided item missing at review: ${r.name.en} on #${r.orderNumber}` }, ref: `reversal:${r.id}`, ack: false });
      event('VoidItemMissing', r.id, `${r.orderNumber} ${r.name.en} — approver ${userName(ctx.db, resp)}`);
    }
    const o = ctx.db.orders.find((x) => x.id === r.orderId);
    if (o) o.history.push(hist(ctx.user!.id, 'VOID_REVIEW', { ar: `مراجعة الهالك: ${r.name.ar} — ${d === 'VERIFIED' ? 'اتشاف ومتأكد' : 'مش موجود'}${note ? ' — ' + note : ''}`, en: `void review: ${r.name.en} ${d}` }, { reversalId: r.id }, ctx.terminal?.code));
    ctx.audit(`void review ${r.id} ${d} (approver ${resp})`, r.id, true, undefined, { stage: r.stage });
    return { ...r, reviewerName: userName(ctx.db, ctx.user!.id) };
  },
  'StaffMeal.Allowance': (ctx) => {
    const branchId = requireBranch(ctx);
    const p = allowancePolicy(branchId);
    const people = staffOf(ctx.db, branchId).map((u) => ({ userId: u.id, username: u.username, displayName: u.displayName, ...allowanceOf(ctx, u.id, branchId) }));
    let quote: any = null;
    if (ctx.query.lines) {
      try {
        const lines = JSON.parse(ctx.query.lines) as { productId: string; quantity: string; modifierOptionIds?: string[]; variantId?: string }[];
        const priced = lines.map((l) => { const qt = quoteItem(ctx.db, { branchId, channel: 'TAKEAWAY', productId: l.productId, quantity: String(l.quantity ?? '1'), modifierOptionIds: l.modifierOptionIds ?? [], variantId: l.variantId, at: ctx.now } as any); return { productId: l.productId, quantity: String(l.quantity ?? '1'), lineTotal: qt.lineTotal, modifiers: (l.modifierOptionIds ?? []).map((id) => ({ optionId: id })) } as any; });
        quote = mealValue(ctx.db, priced, p.basis, ctx.now);
      } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError('VALIDATION_FAILED', { field: 'lines' }); }
    }
    const closedDates = (ctx.db.businessDays ?? []).filter((d) => d.branchId === branchId).map((d) => d.date).sort().reverse().slice(0, 14);
    return { ...p, businessDate: ctx.businessDate(branchId), people, quote, closedDates };
  },
  // F3-01: cancel / return a staff meal through the same stages — before the kitchen, after the kitchen, after close
  'Order.CancelStaffMeal': (ctx) => {
    const db = ctx.db;
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    if (o.kind !== 'STAFF_MEAL') throw new ApiError('VALIDATION_FAILED', { rule: 'not a staff meal' });
    if (o.status === 'VOIDED') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (reversalsOf(db).some((r) => r.orderId === o.id && r.kind === 'STAFF_MEAL_CANCEL')) throw new ApiError('ORDER_NOT_EDITABLE', { reason: 'already returned' });
    checkVersion(o, ctx.body.expectedVersion);
    reasonCheck(ctx, 'LINE_VOID', ctx.body.reasonCode, ctx.body.reason);
    const active = o.lines.filter((l) => l.status === 'ACTIVE');
    need(active.length, 'ORDER_EMPTY');
    const closed = isDayClosed(db, o.branchId, o.businessDate);
    const fired = active.some((l) => l.fireRound !== null);
    const stage: StageId = closed ? 'S3' : fired ? 'S1' : 'S0';
    const chosen = checkDisposition(ctx.body.disposition);
    const basis = o.staffMeal?.basis ?? 'SALE_PRICE';
    const value = mealValue(db, active, basis, o.createdAtMs).value;
    const action = stage === 'S3' ? 'RETURN_AFTER_CLOSE' : STAGE_ACTION[stage];
    const context = stage === 'S3'
      ? { orderId: o.id, amount: value, originalBusinessDate: o.businessDate, reasonCode: ctx.body.reasonCode, method: 'NONE', stage, disposition: chosen }
      : { orderId: o.id, lineId: 'ALL', quantity: String(active.length), lineAmount: value, stage, reasonCode: ctx.body.reasonCode, disposition: chosen };
    const g = ctx.requireApproval({ action, targetType: 'orders.Order', targetId: o.id, context, grantId: ctx.body.approvalGrantId });
    const who = approvedText(db, g);
    if (stage === 'S3') {
      // the closed day is never rewritten: a linked return in today's business date, stock back or re-booked as waste
      const disp: Disposition = chosen ?? 'WASTE_HELD';
      for (const l of active) {
        stockForReturn(ctx, o, l, l.quantity, disp);
        recordReversal(ctx, { o, line: l, quantity: l.quantity, value: mealValue(db, [l], basis, o.createdAtMs).value, stage, kind: 'STAFF_MEAL_CANCEL', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: disp, afterClose: true });
      }
      o.history.push(hist(ctx.user!.id, 'STAFF_MEAL_RETURNED', { ar: `مرتجع وجبة موظف بعد إغلاق يوم ${o.businessDate} — سُجّل على يوم ${ctx.businessDate(o.branchId)} (${DISP_AR[disp]}) ${who}`, en: `staff meal returned after close` }, { stage }, ctx.terminal?.code));
      ctx.audit(`staff meal ${o.number} returned after close`, o.id, true, g?.id, { stage });
      return { order: { id: o.id, number: o.number }, stage, disposition: disp };
    }
    for (const l of active) {
      const disp: Disposition = l.fireRound === null ? 'NOT_PREPARED' : voidDisposition(db, l, chosen);
      l.status = 'VOIDED'; l.version++;
      l.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: legacyDisposition(disp), dispositionKind: disp, approverId: g?.approverUserId, stage, terminal: ctx.terminal?.code ?? null, byName: userName(ctx.db, ctx.user!.id), approverName: g ? userName(ctx.db, g.approverUserId) : null };
      recordReversal(ctx, { o, line: l, quantity: l.quantity, value: mealValue(db, [l], basis, o.createdAtMs).value, stage, kind: 'STAFF_MEAL_CANCEL', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: disp });
    }
    for (const t of db.tickets.filter((t) => t.orderId === o.id)) { for (const it of t.items) it.status = 'CANCELLED'; t.version++; }
    o.status = 'VOIDED';
    o.voidedAt = ctx.nowIso;
    o.endReason = { code: ctx.body.reasonCode, note: ctx.body.reason, approvalGrantId: g?.id };
    o.version++;
    o.history.push(hist(ctx.user!.id, 'STAFF_MEAL_CANCELLED', { ar: `أُلغيت وجبة الموظف ${stage === 'S0' ? 'قبل إرسالها للمطبخ' : 'بعد إرسالها للمطبخ'} ${who}`, en: `staff meal cancelled (${stage})` }, { stage }, ctx.terminal?.code));
    inventoryOnOrderChange(ctx, o);
    ctx.audit(`staff meal ${o.number} cancelled (${stage})`, o.id, true, g?.id, { stage });
    return { order: { id: o.id, number: o.number, status: o.status }, stage };
  },
};
void OPEN;
