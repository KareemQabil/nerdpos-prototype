import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, hist, event } from '../store';
import { policy, channelPolicy } from '../policies';
import { quoteItem, capturePolicySnapshot, captureService, computeLiveTotals, computeTotals, activeLines } from '../pricing';
import { enqueueRound, enqueuePrint, issueFiscal } from '../outbox';
import { D, m4, allocate, q6, isMoney } from '../money';
import { checkVersion, getOrder, need, openSessionOn, orderView, page, reasonCheck, requireBranch, requireFields, settlementOf } from './util';
import { openVisitOn, closeVisit } from './floor';
import { promotionActive } from './catalog';
import { setOrderCustomer } from './customers'; // crm area
import { onOrderCompleted } from './loyalty'; // crm area
import { autoApplyPromotions, findByCode, promotionForOrder } from './promotions';
import type { Channel, Order, OrderLine } from '../types';
import { inventoryOnOrderChange } from './inventory'; // inventory area: sales consumption

const OPEN = (o: Order) => o.status === 'DRAFT' || o.status === 'CONFIRMED';

function formatNumber(ctx: Ctx, branchId: string) {
  const p = policy<{ prefix?: string | null; width?: number; includeBranchCode?: boolean }>('OrderNumberPolicy', { branchId }) ?? {};
  const key = `orderno:${branchId}`;
  ctx.db.seq[key] = (ctx.db.seq[key] ?? 0) + 1;
  const n = String(ctx.db.seq[key]).padStart(Number(p.width ?? 4), '0');
  const code = p.includeBranchCode ? ctx.db.branches.find((b) => b.id === branchId)?.code + '-' : '';
  return `${p.prefix ?? ''}${code}${n}`;
}

function assertEditable(ctx: Ctx, o: Order) {
  if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
  if (o.visitId) {
    const v = ctx.db.visits.find((x) => x.id === o.visitId);
    if (!v || v.state !== 'OPEN') throw new ApiError('TABLE_VISIT_CLOSED', { visitId: o.visitId });
  }
  if (o.sessionId) {
    const s = ctx.db.sessions.find((x) => x.id === o.sessionId);
    if (!s || s.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN', { sessionId: o.sessionId, reason: 'origin drawer session is closed' });
  }
}

function bump(ctx: Ctx, o: Order, kind: string, text: { ar: string; en: string }, data?: unknown) {
  o.version++;
  o.history.push(hist(ctx.user!.id, kind, text, data, ctx.terminal?.code));
  inventoryOnOrderChange(ctx, o); // consumes recipes on confirm, reverses/wastes on void (idempotent)
}

function newLine(ctx: Ctx, o: Order, input: any): OrderLine {
  const db = ctx.db;
  const modIds: string[] = input.modifierOptionIds ?? (input.modifiers ?? []).map((m: any) => m.optionId ?? m.modifierOptionId);
  const qty = String(input.quantity ?? '1');
  if (!isMoney(qty) || D(qty).lte(0)) throw new ApiError('VALIDATION_FAILED', { field: 'quantity' });
  const qt = quoteItem(db, { branchId: o.branchId, channel: o.channel, productId: input.productId, quantity: qty, modifierOptionIds: modIds, variantId: input.variantId, halfProductId: input.halfProductId, comboSelections: input.comboSelections, at: ctx.now, modifierLevels: input.modifierLevels, modifierPlacement: input.modifierPlacement, nestedOptionIds: input.nestedOptionIds });
  const product = db.products.find((p) => p.id === input.productId)!;
  const tax = db.taxPolicies.find((t) => t.id === qt.tax.taxPolicyId)!;
  db.units.find((u) => u.id === product.unitId)!.used = true;
  const seatsOn = policy<boolean>('SeatsPolicy') !== false;
  return {
    id: nextId('line'), productId: product.id, sku: product.sku, name: product.name, categoryId: product.categoryId,
    quantity: q6(qty), unitPrice: qt.unitPrice, modifiers: qt.modifiers, unitTotal: qt.unitTotal, lineTotal: qt.lineTotal,
    taxPolicy: { id: tax.id, rate: tax.rate, mode: tax.calculationMode, version: tax.version, name: tax.name, roundingMode: tax.roundingMode, roundingScale: tax.roundingScale, exemption: tax.exemption },
    priceRuleId: qt.priceRuleId, status: 'ACTIVE', version: 1, note: input.note || undefined, fireRound: null, firedAt: null, addedAt: ctx.nowIso, addedBy: ctx.user!.id,
    seat: seatsOn && input.seat ? Number(input.seat) : null, variant: qt.variant, children: qt.children, allergens: product.allergens, chargeTags: product.chargeTags, kitchenMods: [], taxSplit: qt.taxSplit,
  };
}

function ensureService(ctx: Ctx, o: Order) {
  if (!o.service && activeLines(o).length) o.service = captureService(o, ctx.nowIso);
}

function maybeAutoPromotion(ctx: Ctx, o: Order) {
  autoApplyPromotions(ctx, o); // promotions.ts: order / item / buy-X-get-Y, limits and stacking
}

/** VisitAutoClosePolicy: free the table when its last check completes, is cancelled or voided. */
function afterEnd(ctx: Ctx, o: Order) {
  if (!o.visitId) return;
  if ((policy<string>('VisitAutoClosePolicy', { branchId: o.branchId }) ?? 'MANUAL') !== 'ON_LAST_CHECK_COMPLETED') return;
  const v = ctx.db.visits.find((x) => x.id === o.visitId);
  if (!v || v.state !== 'OPEN') return;
  const stillOpen = ctx.db.orders.some((x) => x.visitId === v.id && OPEN(x));
  if (!stillOpen) closeVisit(ctx, v, 'AUTO');
}

function cancelTicketItems(ctx: Ctx, o: Order, lineIds: string[]) {
  for (const t of ctx.db.tickets.filter((t) => t.orderId === o.id || t.items.some((i) => lineIds.includes(i.lineId)))) {
    for (const it of t.items) if (lineIds.includes(it.lineId)) it.status = 'CANCELLED';
    t.version++;
  }
}

function fireRound(ctx: Ctx, o: Order, via: 'FIRE' | 'CONFIRM') {
  const unfired = activeLines(o).filter((l) => l.fireRound === null);
  if (!unfired.length) return null;
  const round = (o.rounds.at(-1)?.round ?? 0) + 1;
  for (const l of unfired) { l.fireRound = round; l.firedAt = ctx.nowIso; l.version++; }
  o.rounds.push({ round, firedAt: ctx.nowIso, firedBy: ctx.user!.id, lineIds: unfired.map((l) => l.id), via, commandId: ctx.commandId ?? '' });
  enqueueRound(ctx.db, o, round);
  event('OrderFired', o.id, `${o.number} round ${round} (${unfired.length} lines) via ${via}`);
  return { round, lineIds: unfired.map((l) => l.id) };
}

export const orderHandlers: Record<string, Handler> = {
  'Order.Find': (ctx) => {
    const q = ctx.query;
    let items = ctx.db.orders.filter((o) => o.branchId === ctx.branchId);
    if (q.number) items = items.filter((o) => o.number.includes(q.number));
    if (q.businessDate) items = items.filter((o) => o.businessDate === q.businessDate || o.completedBusinessDate === q.businessDate);
    if (q.lifecycle) items = items.filter((o) => q.lifecycle.split(',').includes(o.status));
    if (q.sessionId) items = items.filter((o) => o.sessionId === q.sessionId || o.completedSessionId === q.sessionId);
    if (q.visitId) items = items.filter((o) => o.visitId === q.visitId);
    if (q.tableId) items = items.filter((o) => o.tableId === q.tableId);
    if (q.channel) items = items.filter((o) => o.channel === q.channel);
    items = [...items].sort((a, b) => (q.sort === 'OLDEST' ? a.createdAtMs - b.createdAtMs : b.createdAtMs - a.createdAtMs));
    return page(items.map((o) => orderView(ctx.db, o)), q);
  },
  'Order.Get': (ctx) => orderView(ctx.db, getOrder(ctx, ctx.params.orderId)),
  'Order.Timeline': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const caps = ctx.db.captures.filter((c) => c.orderId === o.id).map((c) => ({ at: c.at, by: c.by, kind: 'CAPTURE', text: { ar: `دفع ${c.method} ${c.amount}`, en: `capture ${c.method} ${c.amount}` } }));
    const refs = ctx.db.refunds.filter((r) => r.orderId === o.id).map((r) => ({ at: r.requestedAt, by: r.requestedBy, kind: 'REFUND_' + r.state, text: { ar: `مرتجع ${r.amount} (${r.state})`, en: `refund ${r.amount} (${r.state})` } }));
    return { items: [...o.history, ...caps, ...refs].sort((a, b) => a.at.localeCompare(b.at)) };
  },
  'Order.Create': (ctx) => {
    requireFields(ctx, 'channel');
    const db = ctx.db;
    const branchId = requireBranch(ctx);
    const channel = ctx.body.channel as Channel;
    need(['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(channel), 'ORDER_CHANNEL_UNAVAILABLE', { channel });
    let visitId: string | null = null, tableId: string | null = null, guestCount: number | undefined;
    if (ctx.body.tableId) {
      if (channel !== 'DINE_IN') throw new ApiError('VALIDATION_FAILED', { field: 'tableId', rule: 'only DINE_IN checks sit on a table' });
      const t = db.tables.find((x) => x.id === ctx.body.tableId);
      if (!t || t.branchId !== branchId) throw new ApiError('TABLE_NOT_FOUND');
      const v = openVisitOn(ctx, t.id);
      if (!v) throw new ApiError('TABLE_NOT_OCCUPIED', { tableId: t.id, rule: 'a floor check is anchored to an open table visit' });
      const comp = channelPolicy('CheckCompositionPolicy', { branchId, channel }, 'VISIT_SINGLE_CHECK');
      if (comp === 'VISIT_SINGLE_CHECK' && db.orders.some((o) => o.visitId === v.id && OPEN(o))) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'CheckCompositionPolicy', value: comp, reason: 'one check per visit' });
      visitId = v.id; tableId = v.tableId; guestCount = v.guestCount;
    }
    let sessionId: string | null = null;
    const intake: string = channel === 'DINE_IN' ? channelPolicy<string>('FloorIntakePolicy', { branchId, channel }, 'SESSION_REQUIRED') : 'SESSION_REQUIRED';
    if (!(intake === 'FLOOR_WITHOUT_DRAWER' && visitId)) {
      const s = openSessionOn(db, ctx.terminal?.id);
      if (!s) throw new ApiError('SESSION_NOT_OPEN', { terminal: ctx.terminal?.code ?? null, policy: channel === 'DINE_IN' ? `FloorIntakePolicy ${intake}` : 'counter/takeaway needs a drawer session' });
      sessionId = s.id;
    }
    const o: Order = {
      id: nextId('ord'), number: formatNumber(ctx, branchId), branchId, channel, status: 'DRAFT', kind: 'SALE', visitId, tableId, sessionId, terminalId: ctx.terminal?.id ?? '', serverUserId: ctx.user!.id,
      createdAt: ctx.nowIso, createdAtMs: ctx.now, businessDate: ctx.businessDate(branchId), createdBy: ctx.user!.id, confirmedAt: null, confirmedBy: null, completedAt: null, completedAtMs: null, completedBusinessDate: null, completedSessionId: null,
      version: 1, label: ctx.body.label, note: ctx.body.note, checkNo: visitId ? db.orders.filter((x) => x.visitId === visitId).length + 1 : 1,
      fireMode: null, rounds: [], lines: [], discounts: [], comp: null, policy: capturePolicySnapshot(branchId, channel, ctx.nowIso), service: null, confirmation: null,
      history: [hist(ctx.user!.id, 'CREATED', { ar: `اتفتح شيك ${channel === 'DINE_IN' ? (visitId ? 'صالة على ترابيزة' : 'صالة كاونتر') : channel === 'DELIVERY' ? 'دليفري' : 'تيك أواي'}${sessionId ? ' على وردية الدرج' : ' من غير درج (شيك صالة)'}`, en: `created ${channel}${sessionId ? ' on drawer session' : ' floor check (no drawer)'}` }, null, ctx.terminal?.code)],
      guestCount, customerName: ctx.body.customerName,
    };
    if (ctx.body.customerId) setOrderCustomer(ctx, o, ctx.body.customerId); // crm area: customer snapshot
    db.orders.push(o);
    ctx.audit(`order ${o.number} created`, o.id);
    return { status: 201, body: orderView(db, o) };
  },
  'Order.AddLines': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    assertEditable(ctx, o);
    checkVersion(o, ctx.body.expectedVersion);
    const inputs = ctx.body.lines ?? [];
    need(Array.isArray(inputs) && inputs.length, 'VALIDATION_FAILED', { field: 'lines' });
    const added = inputs.map((l: any) => newLine(ctx, o, l));
    o.lines.push(...added);
    ensureService(ctx, o);
    maybeAutoPromotion(ctx, o);
    bump(ctx, o, 'LINES_ADDED', { ar: `اتضاف: ${added.map((l: OrderLine) => `${l.name.ar} ×${l.quantity}`).join('، ')}`, en: `added: ${added.map((l: OrderLine) => `${l.name.en} ×${l.quantity}`).join(', ')}` }, { lineIds: added.map((l: OrderLine) => l.id) });
    return orderView(ctx.db, o);
  },
  'Order.UpdateLine': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const line = o.lines.find((l) => l.id === ctx.params.lineId);
    need(line, 'ORDERS_ORDERLINE_NOT_FOUND');
    assertEditable(ctx, o);
    if (line!.status === 'VOIDED') throw new ApiError('LINE_ALREADY_VOIDED');
    if (line!.status !== 'ACTIVE') throw new ApiError('LINE_ALREADY_REMOVED');
    if (line!.fireRound !== null) throw new ApiError('LINE_ALREADY_FIRED', { lineId: line!.id, fireRound: line!.fireRound });
    checkVersion(o, ctx.body.expectedVersion);
    checkVersion(line!, ctx.body.expectedLineVersion, 'expectedLineVersion');
    const qty = String(ctx.body.quantity ?? line!.quantity);
    if (!isMoney(qty) || D(qty).lte(0)) throw new ApiError('VALIDATION_FAILED', { field: 'quantity' });
    const unit = ctx.db.units.find((u) => u.id === ctx.db.products.find((p) => p.id === line!.productId)?.unitId);
    if (unit && D(qty).decimalPlaces() > unit.precision) throw new ApiError('QUANTITY_PRECISION_UNSUPPORTED', { precision: unit.precision });
    const before = line!.quantity;
    if (ctx.body.modifiers) {
      const fresh = newLine(ctx, o, { productId: line!.productId, quantity: qty, modifiers: ctx.body.modifiers, variantId: line!.variant?.id, note: ctx.body.note ?? line!.note });
      Object.assign(line!, { quantity: fresh.quantity, unitPrice: fresh.unitPrice, modifiers: fresh.modifiers, unitTotal: fresh.unitTotal, lineTotal: fresh.lineTotal, priceRuleId: fresh.priceRuleId });
    } else {
      line!.quantity = q6(qty);
      line!.lineTotal = m4(D(line!.unitTotal).times(D(qty)));
    }
    if (ctx.body.note !== undefined) line!.note = ctx.body.note;
    line!.version++;
    bump(ctx, o, 'LINE_UPDATED', { ar: `${line!.name.ar}: الكمية ${before} ← ${line!.quantity}`, en: `${line!.name.en}: qty ${before} → ${line!.quantity}` });
    return orderView(ctx.db, o);
  },
  'Order.RemoveLine': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const line = o.lines.find((l) => l.id === ctx.params.lineId);
    need(line, 'ORDERS_ORDERLINE_NOT_FOUND');
    assertEditable(ctx, o);
    if (line!.status === 'VOIDED') throw new ApiError('LINE_ALREADY_VOIDED');
    if (line!.status !== 'ACTIVE') throw new ApiError('LINE_ALREADY_REMOVED');
    if (line!.fireRound !== null) throw new ApiError('LINE_ALREADY_FIRED', { lineId: line!.id, fireRound: line!.fireRound });
    checkVersion(o, ctx.query.expectedVersion ?? ctx.body?.expectedVersion);
    checkVersion(line!, ctx.query.expectedLineVersion ?? ctx.body?.expectedLineVersion, 'expectedLineVersion');
    line!.status = 'REMOVED';
    line!.version++;
    bump(ctx, o, 'LINE_REMOVED', { ar: `اتشال (قبل الإرسال): ${line!.name.ar}`, en: `removed (unfired): ${line!.name.en}` });
    return orderView(ctx.db, o);
  },
  'Order.Fire': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (o.visitId && ctx.db.visits.find((v) => v.id === o.visitId)?.state !== 'OPEN') throw new ApiError('TABLE_VISIT_CLOSED');
    checkVersion(o, ctx.body.expectedVersion);
    const mode = o.fireMode ?? channelPolicy('FireTimingPolicy', { branchId: o.branchId, channel: o.channel }, 'AT_CONFIRM');
    if (mode === 'AT_CONFIRM' && !o.rounds.length) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'FireTimingPolicy', value: 'AT_CONFIRM', reason: 'this channel fires at confirm' });
    const r = fireRound(ctx, o, 'FIRE');
    if (!r) throw new ApiError('NOTHING_TO_FIRE');
    o.fireMode = o.fireMode ?? 'EXPLICIT_ROUNDS';
    bump(ctx, o, 'FIRED', { ar: `اتبعت للمطبخ: الجولة ${r.round} (${r.lineIds.length} صنف)`, en: `fired round ${r.round} (${r.lineIds.length} lines)` }, r);
    return { orderId: o.id, fireRound: r.round, lineIds: r.lineIds, firedAt: ctx.nowIso, version: o.version, order: orderView(ctx.db, o) };
  },
  'Order.Confirm': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_DRAFT', { status: o.status });
    checkVersion(o, ctx.body.expectedVersion);
    if (!activeLines(o).length) throw new ApiError('ORDER_EMPTY');
    if (o.sessionId) {
      const s = ctx.db.sessions.find((x) => x.id === o.sessionId);
      if (!s || s.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN');
    }
    if (!o.policy.confirmationMode) throw new ApiError('PRICING_POLICY_REJECTED', { policy: 'OrderConfirmationPricingPolicy', reason: 'not configured (fail-closed)' });
    if (!o.policy.confirmationChannels.includes(o.channel)) throw new ApiError('PRICING_POLICY_REJECTED', { policy: 'OrderConfirmationPricingPolicy', reason: `channel ${o.channel} not listed` });
    const r = fireRound(ctx, o, 'CONFIRM');
    if (!o.fireMode) o.fireMode = channelPolicy('FireTimingPolicy', { branchId: o.branchId, channel: o.channel }, 'AT_CONFIRM') as any;
    ensureService(ctx, o);
    o.confirmation = computeLiveTotals(o);
    o.status = 'CONFIRMED';
    o.confirmedAt = ctx.nowIso;
    o.confirmedBy = ctx.user!.id;
    bump(ctx, o, 'CONFIRMED', r ? { ar: `اتأكد الشيك واتبعت الباقي للمطبخ (الجولة ${r.round})`, en: `confirmed; fired remaining as round ${r.round}` } : { ar: 'اتأكد الشيك — كل الأصناف كانت اتبعتت قبل كده، مفيش جولة جديدة', en: 'confirmed; everything was already fired, no new round' }, { payable: o.confirmation.payable });
    return { ...orderView(ctx.db, o), confirmFireRound: r?.round ?? null, confirmMessage: r ? 'FIRED_REMAINING' : 'ALL_ALREADY_FIRED' };
  },
  'Order.Complete': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'CONFIRMED') throw new ApiError(o.status === 'DRAFT' ? 'ORDER_NOT_CONFIRMED' : 'ORDER_NOT_EDITABLE', { status: o.status });
    checkVersion(o, ctx.body.expectedVersion);
    const st = settlementOf(ctx.db, o);
    if (!st.settled) throw new ApiError('ORDER_NOT_SETTLED', { remaining: st.remaining });
    const comp = policy<{ mode: string }>('OrderCompletionPolicy', { channel: o.channel })?.mode ?? 'COMMERCIAL_ONLY';
    if (comp === 'FULFILLMENT_REQUIRED') {
      const pending = ctx.db.tickets.filter((t) => t.orderId === o.id && t.state !== 'DONE' && t.state !== 'READY');
      if (pending.length) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'OrderCompletionPolicy FULFILLMENT_REQUIRED', reason: 'kitchen tickets not ready', tickets: pending.map((t) => t.id) });
    }
    const session = o.sessionId ? ctx.db.sessions.find((s) => s.id === o.sessionId) : openSessionOn(ctx.db, ctx.terminal?.id);
    if (o.sessionId && session?.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN');
    const lastCap = ctx.db.captures.filter((c) => c.orderId === o.id).at(-1);
    o.status = 'COMPLETED';
    o.completedAt = ctx.nowIso;
    o.completedAtMs = ctx.now;
    o.completedBusinessDate = ctx.businessDate(o.branchId);
    o.completedSessionId = lastCap?.sessionId ?? session?.id ?? null;
    bump(ctx, o, 'COMPLETED', { ar: 'الشيك اتقفل (اتدفع بالكامل)', en: 'completed (fully paid)' });
    // side effects after the commit: receipt print, e-receipt, table auto-close
    const rp = policy<Record<string, string>>('ReceiptPrintPolicy', { channel: o.channel, terminalId: ctx.terminal?.id }) ?? {};
    if ((rp[o.channel] ?? 'AUTO') === 'AUTO' && o.kind !== 'STAFF_MEAL' && ctx.terminal) enqueuePrint(ctx.db, { documentType: 'RECEIPT', documentId: o.id, copyKind: 'ORIGINAL', terminalId: ctx.terminal.id, createdBy: ctx.user!.id, label: `إيصال ${o.number}` });
    issueFiscal(ctx.db, o);
    onOrderCompleted(ctx, o); // crm area: loyalty points on a completed check
    afterEnd(ctx, o);
    event('OrderCompleted', o.id, `${o.number} payable ${computeTotals(o).payable}`);
    return orderView(ctx.db, o);
  },
  'Order.Cancel': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    checkVersion(o, ctx.body.expectedVersion);
    if (o.lines.some((l) => l.fireRound !== null && l.status !== 'REMOVED')) throw new ApiError('ORDER_ALREADY_FIRED');
    reasonCheck(ctx, 'ORDER_CANCEL', ctx.body.reasonCode, ctx.body.reason);
    o.status = 'CANCELLED';
    o.cancelledAt = ctx.nowIso;
    o.endReason = { code: ctx.body.reasonCode, note: ctx.body.reason };
    bump(ctx, o, 'CANCELLED', { ar: `الشيك اتلغى قبل الإرسال (${ctx.body.reasonCode})`, en: `cancelled (${ctx.body.reasonCode})` });
    afterEnd(ctx, o);
    return orderView(ctx.db, o);
  },
  'Order.Void': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    if (!OPEN(o)) throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    checkVersion(o, ctx.body.expectedVersion);
    const caps = ctx.db.captures.filter((c) => c.orderId === o.id);
    if (caps.length) throw new ApiError('ORDER_HAS_PAYMENTS', { captureCount: caps.length, hint: 'use a refund' });
    if (!o.rounds.length) throw new ApiError('ORDER_NOT_FIRED', { hint: 'an unfired check is cancelled, not voided' });
    reasonCheck(ctx, 'ORDER_VOID', ctx.body.reasonCode, ctx.body.reason);
    if (!(ctx.body.reason ?? '').trim()) throw new ApiError('VALIDATION_FAILED', { field: 'reason', rule: 'required for a void' });
    const totals = computeTotals(o);
    const g = ctx.requireApproval({ action: 'ORDER_VOID', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, orderVersion: o.version, reasonCode: ctx.body.reasonCode, payableBasis: o.confirmation ? 'CONFIRMED' : 'DRAFT_PREVIEW', payable: totals.payable, currentEffectivePaid: '0.0000', captureCount: 0 }, grantId: ctx.body.approvalGrantId });
    const lineIds = activeLines(o).map((l) => l.id);
    for (const l of activeLines(o)) { l.status = 'VOIDED'; l.version++; l.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: 'ORDER_VOID', approverId: g?.approverUserId }; }
    cancelTicketItems(ctx, o, lineIds);
    o.status = 'VOIDED';
    o.voidedAt = ctx.nowIso;
    o.endReason = { code: ctx.body.reasonCode, note: ctx.body.reason, approvalGrantId: g?.id };
    bump(ctx, o, 'VOIDED', { ar: `الشيك اتلغى بالكامل بعد الإرسال (${ctx.body.reasonCode}) بموافقة ${ctx.db.users.find((u) => u.id === g?.approverUserId)?.displayName ?? '—'}`, en: `voided (${ctx.body.reasonCode})` });
    ctx.audit(`order ${o.number} voided`, o.id, true, g?.id);
    afterEnd(ctx, o);
    return orderView(ctx.db, o);
  },
  'Order.VoidLine': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    const line = o.lines.find((l) => l.id === ctx.params.lineId);
    need(line, 'ORDER_LINE_NOT_FOUND');
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (line!.status === 'VOIDED') throw new ApiError('LINE_ALREADY_VOIDED');
    if (line!.status !== 'ACTIVE') throw new ApiError('LINE_ALREADY_REMOVED');
    if (line!.fireRound === null) throw new ApiError('LINE_NOT_FIRED');
    checkVersion(o, ctx.body.expectedVersion);
    reasonCheck(ctx, 'LINE_VOID', ctx.body.reasonCode, ctx.body.reason);
    const g = ctx.requireApproval({ action: 'LINE_VOID', targetType: 'orders.OrderLine', targetId: line!.id, context: { orderId: o.id, lineId: line!.id, lineVersion: line!.version, reasonCode: ctx.body.reasonCode, lineAmount: line!.lineTotal, fireRound: line!.fireRound }, grantId: ctx.body.approvalGrantId });
    const started = ctx.db.tickets.some((t) => t.items.some((i) => i.lineId === line!.id) && t.state !== 'NEW');
    const disp = policy<{ beforeKitchenStart: string; afterKitchenStart: string }>('LineVoidDispositionPolicy') ?? { beforeKitchenStart: 'NOT_PREPARED', afterKitchenStart: 'WASTE' };
    line!.status = 'VOIDED';
    line!.version++;
    line!.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: started ? disp.afterKitchenStart : disp.beforeKitchenStart, approverId: g?.approverUserId };
    cancelTicketItems(ctx, o, [line!.id]);
    bump(ctx, o, 'LINE_VOIDED', { ar: `اتلغى بعد الإرسال: ${line!.name.ar} (${ctx.body.reasonCode}) — ${line!.voided.disposition === 'WASTE' ? 'هالك' : 'ما اتعملش'} — موافقة ${ctx.db.users.find((u) => u.id === g?.approverUserId)?.displayName ?? 'غير مطلوبة'}`, en: `voided fired line ${line!.name.en}` });
    ctx.audit(`line void ${line!.name.en} on ${o.number}`, line!.id, true, g?.id);
    event('OrderLineVoided', o.id, `${o.number} ${line!.name.en}`);
    return orderView(ctx.db, o);
  },
  'Order.MoveLines': (ctx) => {
    const src = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    const dst = getOrder(ctx, ctx.body.targetOrderId, 'ORDER_NOT_FOUND');
    if (src.status !== 'DRAFT' || dst.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    if (src.id === dst.id || !src.visitId || src.visitId !== dst.visitId) throw new ApiError('VALIDATION_FAILED', { rule: 'lines move only to another open check of the same visit' });
    checkVersion(src, ctx.body.expectedVersion);
    checkVersion(dst, ctx.body.targetExpectedVersion, 'targetExpectedVersion');
    const ids: string[] = ctx.body.lineIds ?? [];
    need(ids.length, 'VALIDATION_FAILED', { field: 'lineIds' });
    const moving = ids.map((id) => {
      const l = src.lines.find((x) => x.id === id);
      if (!l) throw new ApiError('VALIDATION_FAILED', { lineId: id, rule: 'not on the source check' });
      if (l.status === 'VOIDED') throw new ApiError('LINE_ALREADY_VOIDED', { lineId: id });
      if (l.status !== 'ACTIVE') throw new ApiError('VALIDATION_FAILED', { lineId: id, rule: 'line is not active' });
      return l;
    });
    src.lines = src.lines.filter((l) => !ids.includes(l.id));
    for (const l of moving) { l.movedFrom = src.id; l.version++; dst.lines.push(l); }
    ensureService(ctx, dst);
    bump(ctx, src, 'LINES_MOVED_OUT', { ar: `اتنقل لشيك ${dst.checkNo}: ${moving.map((l) => `${l.name.ar} ×${l.quantity}`).join('، ')}`, en: `moved to check ${dst.checkNo}` }, { lineIds: ids, target: dst.id });
    bump(ctx, dst, 'LINES_MOVED_IN', { ar: `اتنقل من شيك ${src.checkNo}: ${moving.map((l) => `${l.name.ar} ×${l.quantity}`).join('، ')} (الجولات محفوظة)`, en: `moved in from check ${src.checkNo}` }, { lineIds: ids, source: src.id });
    return { source: orderView(ctx.db, src), target: orderView(ctx.db, dst) };
  },
  'Order.ApplyDiscount': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    checkVersion(o, ctx.body.expectedVersion);
    if (!activeLines(o).length) throw new ApiError('ORDER_EMPTY');
    let d = ctx.body.discount ?? {};
    if (d.promotionCode || d.promotionId) {
      // promotions.ts: the full promotion model (codes, item scope, buy X get Y, limits, stacking)
      const pr = d.promotionId ? (ctx.db.promotions.find((p) => p.id === d.promotionId) as any) : findByCode(ctx.db, d.promotionCode);
      if (!pr || (pr.kind === 'CODED' && !d.promotionCode)) throw new ApiError('PROMOTION_CODE_INVALID');
      o.discounts.push(promotionForOrder(ctx, o, pr, ctx.user!.id));
      bump(ctx, o, 'DISCOUNT', { ar: `عرض: ${pr.name.ar}`, en: `promotion: ${pr.name.en}` });
      return orderView(ctx.db, o);
    }
    let promo = null as any;
    if (d.promotionCode) {
      promo = ctx.db.promotions.find((p) => p.kind === 'CODED' && p.code === d.promotionCode);
      if (!promo) throw new ApiError('PROMOTION_CODE_INVALID');
      if (!promotionActive(ctx, promo, o.channel)) throw new ApiError('PROMOTION_NOT_APPLICABLE');
      d = { type: promo.benefitType, value: promo.benefitValue };
    } else {
      reasonCheck(ctx, 'DISCOUNT', ctx.body.reasonCode, ctx.body.reason);
    }
    need(['PERCENTAGE', 'FIXED_AMOUNT'].includes(d.type), 'VALIDATION_FAILED', { field: 'discount.type' });
    need(isMoney(d.value) && D(d.value).gt(0), 'VALIDATION_FAILED', { field: 'discount.value' });
    if (d.type === 'PERCENTAGE' && D(d.value).gt(100)) throw new ApiError('DISCOUNT_EXCEEDS_ELIGIBLE_BASE');
    const st = policy<{ mode: string }>('DiscountStackingPolicy') ?? { mode: 'NO_STACKING' };
    if (st.mode === 'NO_STACKING' && o.discounts.some((x) => x.active)) throw new ApiError('DISCOUNT_STACKING_NOT_ALLOWED');
    const pre = computeLiveTotals(o);
    const eligible = D(pre.itemsSubtotal).plus(pre.serviceCharge);
    if (promo?.minSubtotal && eligible.lt(promo.minSubtotal)) throw new ApiError('PROMOTION_NOT_APPLICABLE', { minSubtotal: promo.minSubtotal });
    const amount = d.type === 'PERCENTAGE' ? eligible.times(d.value).dividedBy(100) : D(d.value);
    if (amount.gt(eligible)) throw new ApiError('DISCOUNT_EXCEEDS_ELIGIBLE_BASE', { eligible: m4(eligible), amount: m4(amount) });
    const percent = eligible.isZero() ? '100' : amount.dividedBy(eligible).times(100).toDecimalPlaces(2).toString();
    const g = promo ? null : ctx.requireApproval({ action: 'ORDER_DISCOUNT', targetType: 'orders.Order', targetId: o.id, context: { amount: m4(amount), discountPercent: percent, kind: d.type }, grantId: ctx.body.approvalGrantId });
    o.discounts.push({ id: nextId('disc'), type: d.type, value: String(d.value), reasonCode: promo ? 'PROMOTION' : ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, appliedAt: ctx.nowIso, appliedBy: ctx.user!.id, active: true, promotionId: promo?.id, label: promo?.name });
    bump(ctx, o, 'DISCOUNT', { ar: `خصم ${d.type === 'PERCENTAGE' ? d.value + '%' : d.value + ' ج.م'}${promo ? ` (عرض ${promo.name.ar})` : ` (${ctx.body.reasonCode})`}${g ? ' بموافقة مدير' : ''}`, en: `discount ${d.type} ${d.value}` });
    return orderView(ctx.db, o);
  },
  'Order.RemoveDiscount': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    const d = o.discounts.find((x) => x.id === ctx.params.discountId && x.active);
    need(d, 'ORDER_DISCOUNT_NOT_FOUND');
    d!.active = false;
    bump(ctx, o, 'DISCOUNT_REMOVED', { ar: 'الخصم اتشال', en: 'discount removed' });
    return orderView(ctx.db, o);
  },
  'Order.Comp': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    checkVersion(o, ctx.body.expectedVersion);
    if (!activeLines(o).length) throw new ApiError('ORDER_EMPTY');
    reasonCheck(ctx, 'COMP', ctx.body.reasonCode, ctx.body.reason);
    const pre = computeLiveTotals(o);
    const g = ctx.requireApproval({ action: 'ORDER_COMP', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, amount: pre.payable, reasonCode: ctx.body.reasonCode }, grantId: ctx.body.approvalGrantId });
    o.comp = { reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, at: ctx.nowIso, by: ctx.user!.id };
    bump(ctx, o, 'COMP', { ar: `ضيافة كاملة (${ctx.body.reasonCode})${g ? ' بموافقة مدير' : ''} — المطلوب صفر`, en: `comped (${ctx.body.reasonCode})` });
    return orderView(ctx.db, o);
  },
  'Order.UpdateDetails': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    checkVersion(o, ctx.body.expectedVersion);
    if (ctx.body.label !== undefined) o.label = ctx.body.label;
    if (ctx.body.note !== undefined) o.note = ctx.body.note;
    if (ctx.body.guestCount !== undefined && o.status === 'DRAFT') o.guestCount = Number(ctx.body.guestCount);
    bump(ctx, o, 'DETAILS', { ar: 'بيانات الشيك اتعدلت', en: 'details updated' });
    return orderView(ctx.db, o);
  },
  'Order.SetCustomer': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    // crm area: non-terminal checks only; the customer (name, phone) is snapshotted on the check
    if (!OPEN(o)) throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (ctx.body.expectedVersion !== undefined) checkVersion(o, ctx.body.expectedVersion);
    if (ctx.body.customerId !== undefined) setOrderCustomer(ctx, o, ctx.body.customerId || null);
    else o.customerName = ctx.body.customerName ?? undefined;
    bump(ctx, o, 'CUSTOMER', { ar: o.customerName ? `العميل: ${o.customerName}${o.customerPhone ? ` (${o.customerPhone})` : ''}` : 'العميل اتشال من الشيك', en: `customer: ${o.customerName ?? '—'}` });
    return orderView(ctx.db, o);
  },
  // Direction D8: channel change, keeping the lines and the fired facts.
  'Order.ChangeChannel': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    checkVersion(o, ctx.body.expectedVersion);
    const to = ctx.body.channel as Channel;
    need(['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(to) && to !== o.channel, 'VALIDATION_FAILED', { field: 'channel' });
    if (o.deliveryId && (ctx.db.deliveries ?? []).some((d) => d.id === o.deliveryId && d.state !== 'CANCELLED')) throw new ApiError('VALIDATION_FAILED', { field: 'channel', rule: 'cancel the delivery first' }); // crm area
    if (to === 'DINE_IN') {
      need(ctx.body.tableId, 'VALIDATION_FAILED', { field: 'tableId' });
      const v = openVisitOn(ctx, ctx.body.tableId);
      if (!v) throw new ApiError('TABLE_NOT_OCCUPIED', { rule: 'open the table first' });
      o.visitId = v.id; o.tableId = v.tableId; o.guestCount = v.guestCount;
      o.checkNo = ctx.db.orders.filter((x) => x.visitId === v.id).length + 1;
    } else {
      const s = openSessionOn(ctx.db, ctx.terminal?.id);
      if (!s) throw new ApiError('SESSION_NOT_OPEN');
      o.visitId = null; o.tableId = null; o.sessionId = s.id;
    }
    const from = o.channel;
    o.channel = to;
    o.service = null;
    ensureService(ctx, o);
    bump(ctx, o, 'CHANNEL_CHANGED', { ar: `القناة اتغيرت ${from} ← ${to}؛ الأصناف وأسعارها والجولات زي ما هي، والخدمة اتحسبت للقناة الجديدة (سؤال للخبير)`, en: `channel ${from} → ${to}` });
    return orderView(ctx.db, o);
  },
  // Direction D3: split by seat, equally into N, or share one item (fraction). Cents by largest remainder; residual to the last share.
  'Order.Split': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    if (!o.visitId) throw new ApiError('VALIDATION_FAILED', { rule: 'split works on table checks' });
    checkVersion(o, ctx.body.expectedVersion);
    const mode = ctx.body.mode as 'BY_SEAT' | 'EQUAL' | 'SHARE_ITEM';
    const residualFirst = policy<{ residual: string }>('SplitAllocationPolicy')?.residual === 'FIRST_SHARE';
    const mkCheck = () => {
      const c: Order = { ...structuredClone(o), id: nextId('ord'), number: formatNumber(ctx, o.branchId), lines: [], discounts: [], comp: null, rounds: [], history: [], version: 1, checkNo: ctx.db.orders.filter((x) => x.visitId === o.visitId).length + 1, createdAt: ctx.nowIso, createdAtMs: ctx.now, service: o.service };
      c.history.push(hist(ctx.user!.id, 'CREATED', { ar: `اتعمل من تقسيم شيك ${o.checkNo}`, en: `created by split of check ${o.checkNo}` }));
      // a percentage discount follows each share
      c.discounts = o.discounts.filter((d) => d.active && d.type === 'PERCENTAGE').map((d) => ({ ...d, id: nextId('disc') }));
      ctx.db.orders.push(c);
      return c;
    };
    const shareLine = (l: OrderLine, parts: number, targets: Order[]) => {
      const amounts = allocate(l.lineTotal, Array(parts).fill(1), 2);
      if (residualFirst) amounts.reverse();
      const qty = D(l.quantity).dividedBy(parts);
      targets.forEach((t, i) => {
        const nl: OrderLine = { ...structuredClone(l), id: i === 0 && t === o ? l.id : nextId('line'), quantity: q6(qty), lineTotal: amounts[i], unitTotal: m4(D(amounts[i]).dividedBy(qty)), shareOf: { lineId: l.id, parts, index: i + 1 } };
        if (t === o) { Object.assign(l, nl); } else t.lines.push(nl);
      });
    };
    let created: Order[] = [];
    if (mode === 'BY_SEAT') {
      const seats = [...new Set(activeLines(o).map((l) => l.seat).filter((s) => s))] as number[];
      need(seats.length >= 2, 'VALIDATION_FAILED', { rule: 'assign lines to at least two seats first' });
      for (const s of seats.slice(1)) {
        const c = mkCheck(); c.label = `كرسي ${s}`;
        const moving = o.lines.filter((l) => l.status === 'ACTIVE' && l.seat === s);
        o.lines = o.lines.filter((l) => !moving.includes(l));
        moving.forEach((l) => { l.movedFrom = o.id; c.lines.push(l); });
        created.push(c);
      }
      o.label = `كرسي ${seats[0]}`;
    } else if (mode === 'EQUAL') {
      const n = Number(ctx.body.parts);
      need(n >= 2 && n <= 20, 'VALIDATION_FAILED', { field: 'parts', rule: '2..20' });
      created = Array.from({ length: n - 1 }, () => mkCheck());
      for (const l of activeLines(o)) shareLine(l, n, [o, ...created]);
    } else if (mode === 'SHARE_ITEM') {
      const n = Number(ctx.body.parts);
      const l = o.lines.find((x) => x.id === ctx.body.lineId && x.status === 'ACTIVE');
      need(l, 'ORDER_LINE_NOT_FOUND');
      need(n >= 2 && n <= 20, 'VALIDATION_FAILED', { field: 'parts' });
      const targets: Order[] = [o];
      for (const id of ctx.body.targetOrderIds ?? []) { const t = getOrder(ctx, id); need(t.visitId === o.visitId && t.status === 'DRAFT', 'VALIDATION_FAILED'); targets.push(t); }
      while (targets.length < n) { const c = mkCheck(); created.push(c); targets.push(c); }
      shareLine(l!, n, targets);
    } else throw new ApiError('VALIDATION_FAILED', { field: 'mode' });
    // a fixed-amount discount is re-allocated by the same rule
    const fixed = o.discounts.filter((d) => d.active && d.type === 'FIXED_AMOUNT');
    for (const d of fixed) {
      const all = [o, ...created];
      const parts = allocate(d.value, all.map((c) => activeLines(c).reduce((a, l) => a.plus(l.lineTotal), D(0))), 2);
      d.value = parts[0];
      created.forEach((c, i) => c.discounts.push({ ...d, id: nextId('disc'), value: parts[i + 1] }));
    }
    for (const c of created) { ensureService(ctx, c); }
    bump(ctx, o, 'SPLIT', { ar: `اتقسم (${mode}) لـ ${created.length + 1} شيكات — القروش بأكبر باقي والفرق على ${residualFirst ? 'أول' : 'آخر'} حصة`, en: `split ${mode} into ${created.length + 1}` });
    return { source: orderView(ctx.db, o), created: created.map((c) => orderView(ctx.db, c)) };
  },
  'Order.Merge': (ctx) => {
    const dst = getOrder(ctx, ctx.params.orderId);
    const src = getOrder(ctx, ctx.body.sourceOrderId);
    if (dst.status !== 'DRAFT' || src.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE');
    if (!dst.visitId || dst.visitId !== src.visitId || dst.id === src.id) throw new ApiError('VALIDATION_FAILED', { rule: 'merge two checks of the same visit' });
    if (ctx.db.captures.some((c) => c.orderId === src.id)) throw new ApiError('ORDER_HAS_PAYMENTS');
    checkVersion(dst, ctx.body.expectedVersion);
    const moving = src.lines.filter((l) => l.status === 'ACTIVE');
    src.lines = src.lines.filter((l) => l.status !== 'ACTIVE');
    moving.forEach((l) => { l.movedFrom = src.id; dst.lines.push(l); });
    src.status = 'MERGED';
    src.version++;
    src.history.push(hist(ctx.user!.id, 'MERGED', { ar: `اتدمج في شيك ${dst.checkNo}`, en: `merged into check ${dst.checkNo}` }));
    ensureService(ctx, dst);
    bump(ctx, dst, 'MERGED_IN', { ar: `اتدمج فيه شيك ${src.checkNo} (${moving.length} صنف)`, en: `merged check ${src.checkNo}` });
    return orderView(ctx.db, dst);
  },
  'Order.AssignSeat': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const l = o.lines.find((x) => x.id === ctx.params.lineId && x.status === 'ACTIVE');
    need(l, 'ORDER_LINE_NOT_FOUND');
    if (policy<boolean>('SeatsPolicy') === false) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'SeatsPolicy' });
    l!.seat = ctx.body.seat ? Number(ctx.body.seat) : null;
    l!.version++;
    bump(ctx, o, 'SEAT', { ar: `${l!.name.ar} ← كرسي ${l!.seat ?? '—'}`, en: `${l!.name.en} → seat ${l!.seat}` });
    return orderView(ctx.db, o);
  },
  // Direction D12: a change after firing shows on the same ticket as "تعديل".
  'Order.ModifyFiredLine': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const l = o.lines.find((x) => x.id === ctx.params.lineId && x.status === 'ACTIVE');
    need(l, 'ORDER_LINE_NOT_FOUND');
    if (l!.fireRound === null) throw new ApiError('LINE_NOT_FIRED', { hint: 'edit the unfired line directly' });
    requireFields(ctx, 'text');
    const mod = { id: nextId('kmod'), at: ctx.nowIso, by: ctx.user!.id, text: ctx.body.text };
    l!.kitchenMods = [...(l!.kitchenMods ?? []), mod];
    for (const t of ctx.db.tickets) for (const it of t.items) if (it.lineId === l!.id) { it.mods = [...(it.mods ?? []), { at: mod.at, text: mod.text }]; t.version++; }
    bump(ctx, o, 'KITCHEN_MOD', { ar: `تعديل للمطبخ على ${l!.name.ar}: ${ctx.body.text}`, en: `kitchen modification on ${l!.name.en}: ${ctx.body.text}` });
    return orderView(ctx.db, o);
  },
  'Order.OverrideLinePrice': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    const l = o.lines.find((x) => x.id === ctx.params.lineId && x.status === 'ACTIVE');
    need(l, 'ORDER_LINE_NOT_FOUND');
    assertEditable(ctx, o);
    need(isMoney(ctx.body.newUnitPrice), 'VALIDATION_FAILED', { field: 'newUnitPrice' });
    const g = ctx.requireApproval({ action: 'PRICE_OVERRIDE', targetType: 'orders.OrderLine', targetId: l!.id, context: { oldUnitPrice: l!.unitTotal, newUnitPrice: m4(ctx.body.newUnitPrice) }, grantId: ctx.body.approvalGrantId });
    const old = l!.unitTotal;
    l!.unitTotal = m4(ctx.body.newUnitPrice);
    l!.lineTotal = m4(D(l!.unitTotal).times(l!.quantity));
    l!.version++;
    bump(ctx, o, 'PRICE_OVERRIDE', { ar: `سعر ${l!.name.ar} اتعدل ${old} ← ${l!.unitTotal}${g ? ' بموافقة' : ''}`, en: 'price override' });
    return orderView(ctx.db, o);
  },
  // Direction D9: staff meal — not a sale, no receipt, own report line.
  'Order.CreateStaffMeal': (ctx) => {
    const db = ctx.db;
    const branchId = requireBranch(ctx);
    const items = ctx.body.lines ?? [];
    need(items.length, 'VALIDATION_FAILED', { field: 'lines' });
    const o: Order = {
      id: nextId('ord'), number: 'SM-' + formatNumber(ctx, branchId), branchId, channel: 'TAKEAWAY', status: 'COMPLETED', kind: 'STAFF_MEAL', visitId: null, tableId: null, sessionId: null, terminalId: ctx.terminal?.id ?? '', serverUserId: ctx.user!.id,
      createdAt: ctx.nowIso, createdAtMs: ctx.now, businessDate: ctx.businessDate(branchId), createdBy: ctx.user!.id, confirmedAt: ctx.nowIso, confirmedBy: ctx.user!.id, completedAt: ctx.nowIso, completedAtMs: ctx.now, completedBusinessDate: ctx.businessDate(branchId), completedSessionId: null,
      version: 1, checkNo: 1, fireMode: 'AT_CONFIRM', rounds: [], lines: [], discounts: [], comp: { reasonCode: 'STAFF_MEAL', at: ctx.nowIso, by: ctx.user!.id }, policy: capturePolicySnapshot(branchId, 'TAKEAWAY', ctx.nowIso), service: null, confirmation: null,
      history: [hist(ctx.user!.id, 'STAFF_MEAL', { ar: `وجبة موظف لـ ${ctx.body.staffName ?? '—'} — مش بيع، من غير إيصال`, en: 'staff meal — not a sale' })], customerName: ctx.body.staffName,
    };
    o.lines = items.map((l: any) => newLine(ctx, o, l));
    o.confirmation = computeLiveTotals(o);
    fireRound(ctx, o, 'CONFIRM');
    db.orders.push(o);
    return orderView(db, o);
  },
};
