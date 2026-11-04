import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId, hist, event } from '../store';
import { policy, channelPolicy } from '../policies';
import { quoteItem, capturePolicySnapshot, captureService, computeLiveTotals, computeTotals, activeLines } from '../pricing';
import { enqueueRound, enqueuePrint, issueFiscal } from '../outbox';
import { D, m4, allocate, q6, isMoney } from '../money';
import { checkVersion, getOrder, need, openSessionOn, orderView, page, reasonCheck, requireBranch, requireFields, settlementOf, userName } from './util';
import { openVisitOn, closeVisit } from './floor';
import { promotionActive } from './catalog';
import { setOrderCustomer } from './customers'; // crm area
import { onOrderCompleted } from './loyalty'; // crm area
import { autoApplyPromotions, findByCode, promotionForOrder } from './promotions';
import type { Channel, Order, OrderLine } from '../types';
import { inventoryOnOrderChange } from './inventory'; // inventory area: sales consumption
import { lineStage, STAGE_ACTION, recordReversal, approvedText, voidDisposition, checkDisposition, legacyDisposition, DISP_AR, allowanceOf, allowancePolicy, mealValue, staffOf } from './reversals'; // r3A: who did it vs who allowed it
import { assignShortNo } from '../r3b'; // r3B: short display number
import { resolveSalesChannel } from '../sales-channels'; // sales channels (E13)

const OPEN = (o: Order) => o.status === 'DRAFT' || o.status === 'CONFIRMED';

/** r3A (E03): a visit cannot hold more checks than its guests (SplitLimitPolicy). */
function assertCheckRoom(ctx: Ctx, visitId: string, adding: number) {
  if (policy<boolean>('SplitLimitPolicy', { branchId: ctx.branchId }) === false) return;
  const v = ctx.db.visits.find((x) => x.id === visitId);
  const guests = Number(v?.guestCount ?? 0);
  if (!guests) return;
  const existing = ctx.db.orders.filter((o) => o.visitId === visitId && !['CANCELLED', 'VOIDED', 'MERGED'].includes(o.status)).length;
  if (existing + adding > guests) throw new ApiError('SPLIT_LIMIT_GUESTS', { guests, checks: existing, adding });
}

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
  const qt = quoteItem(db, { branchId: o.branchId, channel: o.channel, productId: input.productId, quantity: qty, modifierOptionIds: modIds, variantId: input.variantId, halfProductId: input.halfProductId, comboSelections: input.comboSelections, at: ctx.now, modifierLevels: input.modifierLevels, modifierPlacement: input.modifierPlacement, nestedOptionIds: input.nestedOptionIds, salesChannelId: o.salesChannelId ?? null /* sales channels (E13) */ });
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
    const sc = resolveSalesChannel(db, channel, ctx.body.salesChannelId); // sales channels (E13): default = the order type's channel
    let visitId: string | null = null, tableId: string | null = null, guestCount: number | undefined;
    if (ctx.body.tableId) {
      if (channel !== 'DINE_IN') throw new ApiError('VALIDATION_FAILED', { field: 'tableId', rule: 'only DINE_IN checks sit on a table' });
      const t = db.tables.find((x) => x.id === ctx.body.tableId);
      if (!t || t.branchId !== branchId) throw new ApiError('TABLE_NOT_FOUND');
      const v = openVisitOn(ctx, t.id);
      if (!v) throw new ApiError('TABLE_NOT_OCCUPIED', { tableId: t.id, rule: 'a floor check is anchored to an open table visit' });
      const comp = channelPolicy('CheckCompositionPolicy', { branchId, channel }, 'VISIT_SINGLE_CHECK');
      if (comp === 'VISIT_SINGLE_CHECK' && db.orders.some((o) => o.visitId === v.id && OPEN(o))) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'CheckCompositionPolicy', value: comp, reason: 'one check per visit' });
      assertCheckRoom(ctx, v.id, 1); // r3A (E03)
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
      history: [hist(ctx.user!.id, 'CREATED', { ar: `فُتح شيك ${channel === 'DINE_IN' ? (visitId ? 'صالة على ترابيزة' : 'صالة كاونتر') : channel === 'DELIVERY' ? 'دليفري' : 'تيك أواي'}${sessionId ? ' على وردية الدرج' : ' بلا درج (شيك صالة)'}`, en: `created ${channel}${sessionId ? ' on drawer session' : ' floor check (no drawer)'}` }, null, ctx.terminal?.code)],
      guestCount, customerName: ctx.body.customerName, salesChannelId: sc.id,
    };
    if (!sc.isDefault) o.history.push(hist(ctx.user!.id, 'SALES_CHANNEL', { ar: `قناة البيع: ${sc.name.ar} — الأسعار من قائمتها`, en: `sales channel: ${sc.name.en} — priced from its list` }, { salesChannelId: sc.id }, ctx.terminal?.code));
    if (ctx.body.customerId) setOrderCustomer(ctx, o, ctx.body.customerId); // crm area: customer snapshot
    db.orders.push(o);
    assignShortNo(db, o); // r3B (E08): optional short call-out number; o.number stays the immutable transaction id
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
    bump(ctx, o, 'LINES_ADDED', { ar: `أُضيف: ${added.map((l: OrderLine) => `${l.name.ar} ×${l.quantity}`).join('، ')}`, en: `added: ${added.map((l: OrderLine) => `${l.name.en} ×${l.quantity}`).join(', ')}` }, { lineIds: added.map((l: OrderLine) => l.id) });
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
    // Owner decision (ux-03): lowering the quantity of an UNSENT line is not a void — no approval and no reason are
    // required; it is still written to the check history, the audit and the reversal trace. Removing the whole line
    // (Order.RemoveLine) keeps the removal rule, and a sent line is changed only by Order.VoidLine (LINE_VOID approval).
    let cut: { stage: 'S0' | 'S1'; g: any; qty: string; value: string } | null = null;
    if (D(qty).lt(D(before))) {
      const stage = lineStage(o, line!);
      const q = D(before).minus(D(qty)).toString();
      const value = m4(D(line!.unitTotal).times(q));
      cut = { stage, g: null, qty: q, value };
    }
    // ux-04 extension: the size (variant) of an UNSENT line may change; the server re-prices it with the same options.
    // A sent line never reaches here (LINE_ALREADY_FIRED above): changing it is a void + a new line, with its approval.
    const beforeVariant = line!.variant ?? null;
    let variantId: string | undefined = line!.variant?.id;
    if (ctx.body.variantId !== undefined && ctx.body.variantId !== (line!.variant?.id ?? null)) {
      const product = ctx.db.products.find((p) => p.id === line!.productId);
      const v = (product?.variants ?? []).find((x) => x.id === ctx.body.variantId && x.active);
      need(v, 'VALIDATION_FAILED', { field: 'variantId', rule: 'an active size of this item' });
      need(!(line!.children ?? []).length, 'VALIDATION_FAILED', { field: 'variantId', rule: 'a combo or half-and-half line is removed and added again' });
      variantId = v!.id;
    }
    const variantChanged = variantId !== (line!.variant?.id ?? undefined);
    if (ctx.body.modifiers || variantChanged) {
      const keep = !ctx.body.modifiers ? (line!.modifiers ?? []) : null; // a size change keeps the options and their levels
      const fresh = newLine(ctx, o, { productId: line!.productId, quantity: qty, modifiers: ctx.body.modifiers ?? keep, variantId, note: ctx.body.note ?? line!.note, ...(keep ? { modifierLevels: Object.fromEntries(keep.filter((m: any) => m.level).map((m: any) => [m.optionId, m.level])) } : {}) });
      Object.assign(line!, { quantity: fresh.quantity, unitPrice: fresh.unitPrice, modifiers: fresh.modifiers, unitTotal: fresh.unitTotal, lineTotal: fresh.lineTotal, priceRuleId: fresh.priceRuleId, variant: fresh.variant, children: fresh.children, taxSplit: fresh.taxSplit });
    } else {
      line!.quantity = q6(qty);
      line!.lineTotal = m4(D(line!.unitTotal).times(D(qty)));
    }
    if (ctx.body.note !== undefined) line!.note = ctx.body.note;
    line!.version++;
    if (cut) {
      recordReversal(ctx, { o, line: line!, quantity: cut.qty, value: cut.value, stage: cut.stage, kind: 'QTY_DECREASE', grant: cut.g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: 'NOT_PREPARED' });
      ctx.audit(`qty ${line!.name.en} ${before} → ${line!.quantity} on ${o.number}`, line!.id, true, cut.g?.id, { stage: cut.stage });
    }
    if (variantChanged) {
      const from = beforeVariant?.name ?? { ar: '—', en: '—' }, to = line!.variant?.name ?? { ar: '—', en: '—' };
      bump(ctx, o, 'LINE_UPDATED', { ar: `${line!.name.ar}: المقاس ${from.ar} ← ${to.ar} (قبل الإرسال)`, en: `${line!.name.en}: size ${from.en} → ${to.en} (before sending)` }, { field: 'variant', from: beforeVariant?.id ?? null, to: line!.variant?.id ?? null });
      ctx.audit(`size ${line!.name.en} ${from.en} → ${to.en} on ${o.number}`, line!.id);
    }
    if (D(qty).eq(D(before)) && variantChanged) return orderView(ctx.db, o);
    bump(ctx, o, 'LINE_UPDATED', { ar: `${line!.name.ar}: الكمية ${before} ← ${line!.quantity}${cut ? ' — تقليل كمية قبل الإرسال (من غير موافقة)' : ''}`, en: `${line!.name.en}: qty ${before} → ${line!.quantity}${cut ? ' (decrease before sending, no approval)' : ''}` }, cut ? { stage: cut.stage, grantId: cut.g?.id, approverId: cut.g?.approverUserId } : undefined);
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
    // r3A [OWNER]: every removal before payment needs a manager (S0 included) and is written to the trace
    const stage = lineStage(o, line!);
    const rc = ctx.body?.reasonCode ?? null;
    if (stage === 'S1') reasonCheck(ctx, 'LINE_VOID', rc ?? undefined, ctx.body?.reason);
    const g = ctx.requireApproval({ action: STAGE_ACTION[stage], targetType: 'orders.OrderLine', targetId: line!.id, context: { orderId: o.id, lineId: line!.id, lineVersion: line!.version, quantity: line!.quantity, lineAmount: line!.lineTotal, stage, reasonCode: rc }, grantId: ctx.body?.approvalGrantId });
    line!.status = 'REMOVED';
    line!.version++;
    line!.removed = { at: ctx.nowIso, by: ctx.user!.id, approverId: g?.approverUserId ?? null, approverName: g ? userName(ctx.db, g.approverUserId) : null, byName: userName(ctx.db, ctx.user!.id), approvalGrantId: g?.id ?? null, stage, reasonCode: rc, reason: ctx.body?.reason ?? null, quantity: line!.quantity };
    recordReversal(ctx, { o, line: line!, quantity: line!.quantity, value: line!.lineTotal, stage, kind: 'LINE_REMOVE', grant: g, reasonCode: rc, reason: ctx.body?.reason, disposition: 'NOT_PREPARED' });
    ctx.audit(`line removed ${line!.name.en} ×${line!.quantity} on ${o.number} (${stage})`, line!.id, true, g?.id, { stage });
    bump(ctx, o, 'LINE_REMOVED', { ar: `أُزيل ${stage === 'S0' ? '(قبل الإرسال)' : '(بعد الشيك المبدئي — قبل الدفع)'}: ${line!.name.ar} ×${Number(line!.quantity)} — ${approvedText(ctx.db, g)}`, en: `removed (${stage}): ${line!.name.en}` }, { lineId: line!.id, stage, grantId: g?.id, approverId: g?.approverUserId });
    return orderView(ctx.db, o);
  },
  'Order.Fire': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId, 'ORDER_NOT_FOUND');
    if (o.kind === 'STAFF_MEAL' && o.status === 'COMPLETED') {
      // r3A: a staff meal registered "send later" goes to the kitchen when the employee takes the break
      checkVersion(o, ctx.body.expectedVersion);
      const r = fireRound(ctx, o, 'FIRE');
      if (!r) throw new ApiError('NOTHING_TO_FIRE');
      if (o.staffMeal) o.staffMeal.sentToKitchen = true;
      o.version++;
      o.history.push(hist(ctx.user!.id, 'FIRED', { ar: 'أُرسلت وجبة الموظف للمطبخ', en: 'staff meal sent to the kitchen' }, r, ctx.terminal?.code));
      return { orderId: o.id, fireRound: r.round, lineIds: r.lineIds, firedAt: ctx.nowIso, version: o.version, order: orderView(ctx.db, o) };
    }
    if (o.status !== 'DRAFT') throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    if (o.visitId && ctx.db.visits.find((v) => v.id === o.visitId)?.state !== 'OPEN') throw new ApiError('TABLE_VISIT_CLOSED');
    checkVersion(o, ctx.body.expectedVersion);
    const mode = o.fireMode ?? channelPolicy('FireTimingPolicy', { branchId: o.branchId, channel: o.channel }, 'AT_CONFIRM');
    if (mode === 'AT_CONFIRM' && !o.rounds.length) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { policy: 'FireTimingPolicy', value: 'AT_CONFIRM', reason: 'this channel fires at confirm' });
    const r = fireRound(ctx, o, 'FIRE');
    if (!r) throw new ApiError('NOTHING_TO_FIRE');
    o.fireMode = o.fireMode ?? 'EXPLICIT_ROUNDS';
    bump(ctx, o, 'FIRED', { ar: `أُرسل للمطبخ: الجولة ${r.round} (${r.lineIds.length} صنف)`, en: `fired round ${r.round} (${r.lineIds.length} lines)` }, r);
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
    bump(ctx, o, 'CONFIRMED', r ? { ar: `تأكد الشيك وأُرسل الباقي للمطبخ (الجولة ${r.round})`, en: `confirmed; fired remaining as round ${r.round}` } : { ar: 'تأكد الشيك — كل الأصناف أُرسلت مسبقًا، ولا جولة جديدة', en: 'confirmed; everything was already fired, no new round' }, { payable: o.confirmation.payable });
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
    bump(ctx, o, 'COMPLETED', { ar: 'أُغلق الشيك (دُفع بالكامل)', en: 'completed (fully paid)' });
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
    // r3A: cancelling a check with items removes them — S0 / S1 authority and a trace per item
    const live = activeLines(o);
    let g: any = null;
    let stage: 'S0' | 'S1' = 'S0';
    if (live.length) {
      stage = live.some((l) => lineStage(o, l) === 'S1') ? 'S1' : 'S0';
      const payable = computeLiveTotals(o).payable;
      g = stage === 'S0'
        ? ctx.requireApproval({ action: 'LINE_REMOVE_UNSENT', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, lineId: 'ALL', quantity: String(live.length), lineAmount: payable, stage, reasonCode: ctx.body.reasonCode }, grantId: ctx.body.approvalGrantId })
        : ctx.requireApproval({ action: 'ORDER_VOID', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, orderVersion: o.version, reasonCode: ctx.body.reasonCode, payableBasis: 'DRAFT_PREVIEW', payable, currentEffectivePaid: '0.0000', captureCount: 0, stage }, grantId: ctx.body.approvalGrantId });
      for (const l of live) {
        l.status = 'REMOVED'; l.version++;
        l.removed = { at: ctx.nowIso, by: ctx.user!.id, approverId: g?.approverUserId ?? null, approverName: g ? userName(ctx.db, g.approverUserId) : null, byName: userName(ctx.db, ctx.user!.id), approvalGrantId: g?.id ?? null, stage, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason ?? null, quantity: l.quantity };
        recordReversal(ctx, { o, line: l, quantity: l.quantity, value: l.lineTotal, stage, kind: 'ORDER_CANCEL', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: 'NOT_PREPARED' });
      }
      ctx.audit(`order ${o.number} cancelled with ${live.length} items (${stage})`, o.id, true, g?.id, { stage });
    }
    o.status = 'CANCELLED';
    o.cancelledAt = ctx.nowIso;
    o.endReason = { code: ctx.body.reasonCode, note: ctx.body.reason };
    bump(ctx, o, 'CANCELLED', { ar: `أُلغي الشيك قبل الإرسال (${ctx.body.reasonCode})${live.length ? ` — ${live.length} صنف — ${approvedText(ctx.db, g)}` : ''}`, en: `cancelled (${ctx.body.reasonCode})` }, live.length ? { stage, grantId: g?.id, approverId: g?.approverUserId } : undefined);
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
    const chosen = checkDisposition(ctx.body.disposition); // r3A: what happens to the items (default per item by kitchen start)
    const g = ctx.requireApproval({ action: 'ORDER_VOID', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, orderVersion: o.version, reasonCode: ctx.body.reasonCode, payableBasis: o.confirmation ? 'CONFIRMED' : 'DRAFT_PREVIEW', payable: totals.payable, currentEffectivePaid: '0.0000', captureCount: 0, ...(chosen ? { disposition: chosen } : {}) }, grantId: ctx.body.approvalGrantId });
    const lineIds = activeLines(o).map((l) => l.id);
    for (const l of activeLines(o)) {
      const disp = l.fireRound === null ? 'NOT_PREPARED' : voidDisposition(ctx.db, l, chosen === 'NOT_PREPARED' ? null : chosen);
      const stage = lineStage(o, l);
      l.status = 'VOIDED'; l.version++;
      l.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: legacyDisposition(disp), approverId: g?.approverUserId, dispositionKind: disp, stage, terminal: ctx.terminal?.code ?? null, byName: userName(ctx.db, ctx.user!.id), approverName: g ? userName(ctx.db, g.approverUserId) : null };
      recordReversal(ctx, { o, line: l, quantity: l.quantity, value: l.lineTotal, stage, kind: 'ORDER_VOID', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: disp });
    }
    cancelTicketItems(ctx, o, lineIds);
    o.status = 'VOIDED';
    o.voidedAt = ctx.nowIso;
    o.endReason = { code: ctx.body.reasonCode, note: ctx.body.reason, approvalGrantId: g?.id };
    bump(ctx, o, 'VOIDED', { ar: `أُلغي الشيك بالكامل بعد الإرسال (${ctx.body.reasonCode}) بموافقة ${ctx.db.users.find((u) => u.id === g?.approverUserId)?.displayName ?? '—'}`, en: `voided (${ctx.body.reasonCode})` });
    ctx.audit(`order ${o.number} voided`, o.id, true, g?.id, { stage: 'S1' });
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
    // r3A: disposition of the item (short vs long void) — bound to the approval so the manager sees it
    const disp = voidDisposition(ctx.db, line!, checkDisposition(ctx.body.disposition));
    // ux-03 owner decision: lowering the quantity of a SENT line is a partial void (optional `quantity` = units voided)
    const part = ctx.body.quantity !== undefined && ctx.body.quantity !== null ? String(ctx.body.quantity) : null;
    if (part !== null) {
      if (!isMoney(part) || D(part).lte(0) || D(part).gt(D(line!.quantity))) throw new ApiError('VALIDATION_FAILED', { field: 'quantity', rule: '0 < quantity <= line quantity' });
    }
    const partial = part !== null && D(part).lt(D(line!.quantity));
    const voidValue = partial ? m4(D(line!.unitTotal).times(D(part!))) : line!.lineTotal;
    const g = ctx.requireApproval({ action: 'LINE_VOID', targetType: 'orders.OrderLine', targetId: line!.id, context: { orderId: o.id, lineId: line!.id, lineVersion: line!.version, reasonCode: ctx.body.reasonCode, lineAmount: voidValue, fireRound: line!.fireRound, ...(partial ? { quantity: q6(part!), fromQuantity: line!.quantity } : {}), ...(ctx.body.disposition ? { disposition: disp, stage: 'S1' } : {}) }, grantId: ctx.body.approvalGrantId });
    if (partial) {
      // the voided units become their own VOIDED line (history stays immutable); the sent line keeps the rest
      const rest = q6(D(line!.quantity).minus(D(part!)).toString());
      const cut: OrderLine = { ...line!, id: nextId('line'), quantity: q6(part!), lineTotal: voidValue, version: 1, kitchenMods: [], status: 'VOIDED' };
      cut.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: legacyDisposition(disp), approverId: g?.approverUserId, dispositionKind: disp, stage: 'S1', terminal: ctx.terminal?.code ?? null, byName: userName(ctx.db, ctx.user!.id), approverName: g ? userName(ctx.db, g.approverUserId) : null };
      line!.quantity = rest;
      line!.lineTotal = m4(D(line!.unitTotal).times(D(rest)));
      line!.version++;
      o.lines.splice(o.lines.indexOf(line!) + 1, 0, cut);
      for (const tk of ctx.db.tickets.filter((x) => x.orderId === o.id)) for (const it of tk.items) if (it.lineId === line!.id && it.status === 'ACTIVE') { it.quantity = rest; it.mods = [...(it.mods ?? []), { at: ctx.nowIso, text: `-${q6(part!)}` }]; tk.version++; }
      recordReversal(ctx, { o, line: cut, quantity: cut.quantity, value: voidValue, stage: 'S1', kind: 'LINE_VOID', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: disp });
      bump(ctx, o, 'LINE_VOIDED', { ar: `أُلغي جزء بعد الإرسال: ${line!.name.ar} ×${cut.quantity} من ${D(rest).plus(D(part!)).toString()} (${ctx.body.reasonCode}) — ${DISP_AR[disp]} — ${approvedText(ctx.db, g)}`, en: `partial void of fired line ${line!.name.en} ×${cut.quantity}` }, { lineId: line!.id, voidLineId: cut.id, stage: 'S1', disposition: disp, grantId: g?.id, approverId: g?.approverUserId });
      ctx.audit(`partial line void ${line!.name.en} ×${cut.quantity} on ${o.number}`, line!.id, true, g?.id, { stage: 'S1' });
      event('OrderLineVoided', o.id, `${o.number} ${line!.name.en} ×${cut.quantity}`);
      return orderView(ctx.db, o);
    }
    line!.status = 'VOIDED';
    line!.version++;
    line!.voided = { at: ctx.nowIso, by: ctx.user!.id, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, approvalGrantId: g?.id, disposition: legacyDisposition(disp), approverId: g?.approverUserId, dispositionKind: disp, stage: 'S1', terminal: ctx.terminal?.code ?? null, byName: userName(ctx.db, ctx.user!.id), approverName: g ? userName(ctx.db, g.approverUserId) : null };
    cancelTicketItems(ctx, o, [line!.id]);
    recordReversal(ctx, { o, line: line!, quantity: line!.quantity, value: line!.lineTotal, stage: 'S1', kind: 'LINE_VOID', grant: g, reasonCode: ctx.body.reasonCode, reason: ctx.body.reason, disposition: disp });
    bump(ctx, o, 'LINE_VOIDED', { ar: `أُلغي بعد الإرسال: ${line!.name.ar} (${ctx.body.reasonCode}) — ${DISP_AR[disp]} — ${approvedText(ctx.db, g)}`, en: `voided fired line ${line!.name.en}` }, { lineId: line!.id, stage: 'S1', disposition: disp, grantId: g?.id, approverId: g?.approverUserId });
    ctx.audit(`line void ${line!.name.en} on ${o.number}`, line!.id, true, g?.id, { stage: 'S1' });
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
    bump(ctx, src, 'LINES_MOVED_OUT', { ar: `نُقل إلى شيك ${dst.checkNo}: ${moving.map((l) => `${l.name.ar} ×${l.quantity}`).join('، ')}`, en: `moved to check ${dst.checkNo}` }, { lineIds: ids, target: dst.id });
    bump(ctx, dst, 'LINES_MOVED_IN', { ar: `نُقل من شيك ${src.checkNo}: ${moving.map((l) => `${l.name.ar} ×${l.quantity}`).join('، ')} (الجولات محفوظة)`, en: `moved in from check ${src.checkNo}` }, { lineIds: ids, source: src.id });
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
    bump(ctx, o, 'DISCOUNT_REMOVED', { ar: 'أُزيل الخصم', en: 'discount removed' });
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
    bump(ctx, o, 'DETAILS', { ar: 'عُدّلت بيانات الشيك', en: 'details updated' });
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
    o.salesChannelId = resolveSalesChannel(ctx.db, to, ctx.body.salesChannelId).id; // sales channels (E13)
    o.service = null;
    ensureService(ctx, o);
    bump(ctx, o, 'CHANNEL_CHANGED', { ar: `تغيّرت القناة ${from} ← ${to}؛ الأصناف وأسعارها والجولات كما هي، واحتُسبت الخدمة للقناة الجديدة`, en: `channel ${from} → ${to}` });
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
      c.history.push(hist(ctx.user!.id, 'CREATED', { ar: `أُنشئ من تقسيم شيك ${o.checkNo}`, en: `created by split of check ${o.checkNo}` }));
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
    // r3A (E03): never more checks than guests
    if (mode === 'EQUAL') assertCheckRoom(ctx, o.visitId, Math.max(0, Number(ctx.body.parts) - 1));
    if (mode === 'SHARE_ITEM') assertCheckRoom(ctx, o.visitId, Math.max(0, Number(ctx.body.parts) - 1 - (ctx.body.targetOrderIds ?? []).length));
    if (mode === 'BY_SEAT') {
      const seats = [...new Set(activeLines(o).map((l) => l.seat).filter((s) => s))] as number[];
      need(seats.length >= 2, 'VALIDATION_FAILED', { rule: 'assign lines to at least two seats first' });
      assertCheckRoom(ctx, o.visitId, seats.length - 1);
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
    bump(ctx, o, 'SPLIT', { ar: `قُسّم (${mode}) إلى ${created.length + 1} شيكات — القروش بأكبر باقي والفرق على ${residualFirst ? 'أول' : 'آخر'} حصة`, en: `split ${mode} into ${created.length + 1}` });
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
    src.history.push(hist(ctx.user!.id, 'MERGED', { ar: `دُمج في شيك ${dst.checkNo}`, en: `merged into check ${dst.checkNo}` }));
    ensureService(ctx, dst);
    bump(ctx, dst, 'MERGED_IN', { ar: `دُمج فيه شيك ${src.checkNo} (${moving.length} صنف)`, en: `merged check ${src.checkNo}` });
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
    bump(ctx, o, 'PRICE_OVERRIDE', { ar: `عُدّل سعر ${l!.name.ar} ${old} ← ${l!.unitTotal}${g ? ' بموافقة' : ''}`, en: 'price override' });
    return orderView(ctx.db, o);
  },
  // Direction D9 + r3A (F3-03, E12): staff meal — an identified employee, manager authorisation, a daily allowance
  // (sale value or cost), stock consumed like a sale, kitchen routing as normal; never a sale, never a discount.
  'Order.CreateStaffMeal': (ctx) => {
    const db = ctx.db;
    const branchId = requireBranch(ctx);
    const items = ctx.body.lines ?? [];
    need(Array.isArray(items) && items.length, 'VALIDATION_FAILED', { field: 'lines' });
    const emp = staffOf(db, branchId).find((u) => u.id === ctx.body.employeeUserId);
    if (!emp) throw new ApiError('STAFF_MEAL_EMPLOYEE_REQUIRED', { employeeUserId: ctx.body.employeeUserId ?? null });
    const sendNow = ctx.body.sendToKitchen !== false;
    const o: Order = {
      id: nextId('ord'), number: 'SM-' + formatNumber(ctx, branchId), branchId, channel: 'TAKEAWAY', status: 'COMPLETED', kind: 'STAFF_MEAL', visitId: null, tableId: null, sessionId: null, terminalId: ctx.terminal?.id ?? '', serverUserId: ctx.user!.id,
      createdAt: ctx.nowIso, createdAtMs: ctx.now, businessDate: ctx.businessDate(branchId), createdBy: ctx.user!.id, confirmedAt: ctx.nowIso, confirmedBy: ctx.user!.id, completedAt: ctx.nowIso, completedAtMs: ctx.now, completedBusinessDate: ctx.businessDate(branchId), completedSessionId: null,
      version: 1, checkNo: 1, fireMode: 'AT_CONFIRM', rounds: [], lines: [], discounts: [], comp: { reasonCode: 'STAFF_MEAL', at: ctx.nowIso, by: ctx.user!.id }, policy: capturePolicySnapshot(branchId, 'TAKEAWAY', ctx.nowIso), service: null, confirmation: null,
      history: [], customerName: emp.displayName,
    };
    o.lines = items.map((l: any) => newLine(ctx, o, l));
    const ap = allowancePolicy(branchId);
    const val = mealValue(db, o.lines, ap.basis, ctx.now);
    const al = allowanceOf(ctx, emp.id, branchId);
    if (ap.enabled && D(al.used).plus(val.value).gt(ap.dailyLimit)) throw new ApiError('STAFF_MEAL_ALLOWANCE_EXCEEDED', { employee: emp.displayName, basis: ap.basis, limit: ap.dailyLimit, used: al.used, requested: val.value, remaining: al.remaining });
    const g = ctx.requireApproval({ action: 'STAFF_MEAL', targetType: 'orders.StaffMeal', targetId: `staffmeal:${emp.id}`, context: { employeeUserId: emp.id, employeeName: emp.displayName, mealValue: val.value, basis: ap.basis, remainingBefore: al.remaining, lineCount: o.lines.length, linesHash: o.lines.map((l) => `${l.productId}x${l.quantity}:${l.modifiers.map((m) => m.optionId).join('+')}`).join('|') }, grantId: ctx.body.approvalGrantId });
    if (g && g.approverUserId === emp.id) throw new ApiError('SELF_APPROVAL_DENIED', { reason: 'an employee cannot approve their own meal' });
    o.staffMeal = { employeeUserId: emp.id, employeeName: emp.displayName, basis: ap.basis, value: val.value, saleValue: val.sale, approverId: g?.approverUserId ?? null, grantId: g?.id ?? null, sentToKitchen: sendNow };
    o.confirmation = computeLiveTotals(o);
    o.history.push(hist(ctx.user!.id, 'STAFF_MEAL', { ar: `وجبة موظف لـ ${emp.displayName} — قيمتها ${Number(val.value).toFixed(2)} ج.م ${ap.basis === 'COST' ? 'بالتكلفة' : 'بسعر البيع'}${ap.enabled ? ` من حد ${Number(ap.dailyLimit).toFixed(0)} ج.م` : ''} — ${approvedText(db, g)} — مش بيع، من غير إيصال`, en: `staff meal for ${emp.username} — not a sale` }, { employeeUserId: emp.id, grantId: g?.id, approverId: g?.approverUserId }, ctx.terminal?.code));
    db.orders.push(o);
    if (sendNow) fireRound(ctx, o, 'CONFIRM');
    inventoryOnOrderChange(ctx, o); // stock consumed like a sale (never a sale in the reports)
    ctx.audit(`staff meal ${o.number} for ${emp.username} (${val.value} ${ap.basis})`, o.id, true, g?.id);
    return orderView(db, o);
  },
};
