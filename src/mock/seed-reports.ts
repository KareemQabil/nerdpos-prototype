// Reports engine fixtures: two real, event-level business days (the day before yesterday and yesterday, both closed)
// for the main branch, and yesterday for the second branch — orders, lines, visits, kitchen tickets, captures, drawer
// sessions and entries, refunds, removals, approvals and e-receipts — so every report number can be proven down to
// the check. The edge cases the experts asked about are planted on purpose (documented in FIXTURES below):
// split 100.00 / 3, a refund the next day of a closed day (S3) and one the same day (S2), a staff meal with approver,
// a void after the kitchen held as waste (review pending) and one marked missing, an unsent line removed (S0), a
// comp, a whole-check void and a cancel, cash rounding to 0.25, a drawer short by 30 with its reason, a pay-out.
// The closed-day summaries, sales history and seeded reconciliation for those days are recomputed from the facts, so
// the frozen close equals a recompute (the engine checks it).
import type { DB, Order, OrderLine, Capture, CashEntry, Session, KitchenTicket, ApprovalGrant, RefundCase, TableVisit, FiscalDocument, PolicySnapshot } from './types';
import { computeLiveTotals } from './pricing';
import { D, m4, allocate } from './money';
import { businessDate, zonedParts } from './clock';

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
function rng(seed: string) { let h = 2166136261; for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** ms of a Cairo local time on a business date (hours ≥ 24 roll into the next calendar day, same business date). */
function cairoMs(date: string, h: number, m = 0): number {
  const guess = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h, m);
  const p = zonedParts(guess, 'Africa/Cairo');
  const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return guess - (shown - guess);
}
const iso = (ms: number) => new Date(ms).toISOString();

export const FIXTURES = {
  split: 'y1 main: table 4, 3 guests, hummus 60 + turkish coffee 40 = 100.00 split equally → 33.33 + 33.33 + 33.34 (one order, three checks, guests once)',
  refundS3: 'y2 main order refunded on y1 (the day after a closed day): payout business date y1, y2 unchanged',
  refundS2: 'y1 main card refund the same day (wrong charge)',
  staffMeal: 'y1 main: staff meal for يوسف approved by أحمد (zero price, not sales, not discount)',
  voidAfterKitchen: 'y1 main: a kofta voided after the kitchen, WASTE_HELD, review pending; y2: a burger WASTE_HELD marked missing',
  removedS0: 'y1 main: an unsent line removed with manager approval (S0)',
  comp: 'y2 main: a check comped (owner guest)',
  orderVoid: 'y2 main: a whole check voided after the kitchen (customer left) and one cancelled before sending',
  rounding: 'cash payments rounded to the nearest 0.25 (positive = left to the guest)',
  drawer: 'y1 main T1 (منى): opening 500, cash in, refund out, pay-out 150 to a supplier, counted 30 short with a reason',
};

export function seedReports(db: DB, nowMs: number) {
  const today = businessDate(nowMs);
  const y1 = addDays(today, -1), y2 = addDays(today, -2);
  // only on top of the seeded closed history (a fresh install has none)
  if (!(db.businessDays ?? []).some((d) => d.branchId === 'branch_main' && d.date === y1)) return;
  const tax = db.taxPolicies.find((t) => t.id === 'tax_demo');
  if (!tax) return;
  const priced = db.products.filter((p) => p.active && !p.direction && db.priceRules.some((r) => r.productId === p.id && r.branchId === 'branch_main' && r.channel === 'DINE_IN' && !r.variantId && !(r as any).salesChannelId));
  if (priced.length < 6) return;
  const price = (pid: string, ch: string) => db.priceRules.find((r) => r.productId === pid && r.branchId === 'branch_main' && r.channel === (ch === 'DELIVERY' ? 'TAKEAWAY' : ch) && !r.variantId && !(r as any).salesChannelId)?.amount ?? db.priceRules.find((r) => r.productId === pid && !r.variantId)!.amount;
  const station = (cat: string) => db.routingRules.filter((r) => r.active !== false).sort((a, b) => a.priority - b.priority).find((r) => !r.match.categoryId || r.match.categoryId === cat)?.stationId ?? db.stations[0]?.id ?? 'st_grill';
  const name = (uid: string) => db.users.find((u) => u.id === uid)?.displayName ?? uid;
  const grants: ApprovalGrant[] = [];
  const grant = (action: string, targetId: string, requester: string, approver: string, ms: number, branchId = 'branch_main'): string => {
    const g: ApprovalGrant = { id: `fx_gr_${grants.length + 1}`, action, targetType: 'orders.Order', targetId, context: {}, contextHash: 'fixture', requesterUserId: requester, approverUserId: approver, branchId, terminalId: 't_cash', issuedAt: iso(ms), expiresAtMs: ms + 120_000, consumedAt: iso(ms + 5_000), consumedBy: requester, credentialKind: 'PIN' } as ApprovalGrant;
    grants.push(g); return g.id;
  };
  let lineSeq = 0, ordSeq = 0, capSeq = 0, ceSeq = 0, tkSeq = 0, visSeq = 0;
  const snap = (atIso: string): PolicySnapshot => ({ pricingOrder: 'DISCOUNT_BEFORE_TAX', rounding: { mode: 'HALF_UP', scale: 2 }, confirmationMode: 'CAPTURED_BASE_SERVICE_POLICY', confirmationChannels: ['DINE_IN', 'TAKEAWAY', 'DELIVERY'], charges: [], tableTax: { enabled: false, rate: '0', order: 'BEFORE_VAT' }, halfAndHalf: 'HIGHER_HALF', capturedAt: atIso });
  const mkLine = (pid: string, qty: number, ch: string, atIso: string, by: string, override?: string): OrderLine => {
    const p = db.products.find((x) => x.id === pid)!;
    const unit = override ?? price(pid, ch);
    return { id: `fx_ln_${++lineSeq}`, productId: pid, sku: p.sku, name: p.name, categoryId: p.categoryId, quantity: String(qty), unitPrice: unit, modifiers: [], unitTotal: unit, lineTotal: m4(D(unit).times(qty)), taxPolicy: { id: tax.id, rate: tax.rate, mode: tax.calculationMode, version: tax.version, name: tax.name, roundingMode: tax.roundingMode, roundingScale: tax.roundingScale, exemption: tax.exemption }, priceRuleId: 'fixture', status: 'ACTIVE', version: 1, fireRound: 1, firedAt: atIso, addedAt: atIso, addedBy: by, seat: null, variant: null, children: [], allergens: p.allergens, chargeTags: p.chargeTags, kitchenMods: [] } as OrderLine;
  };
  const sessions: Session[] = [];
  const entries: CashEntry[] = [];
  const captures: Capture[] = [];
  const orders: Order[] = [];
  const tickets: KitchenTicket[] = [];
  const visits: TableVisit[] = [];
  const refunds: RefundCase[] = [];
  const fiscal: FiscalDocument[] = [];
  const reversals: any[] = [];
  const ce = (sessionId: string, kind: CashEntry['kind'], amount: string, ms: number, by: string, extra: Partial<CashEntry> = {}) => entries.push({ id: `fx_ce_${++ceSeq}`, sessionId, kind, amount: m4(amount), at: iso(ms), by, ...extra });
  const openSession = (id: string, branchId: string, terminalId: string, userId: string, date: string, openH: number) => {
    const existing = db.sessions.find((s) => s.id === id);
    const s: Session = existing ?? { id, terminalId, branchId, userId, state: 'OPEN', openingFloat: m4(500), openedAt: iso(cairoMs(date, openH)), openedAtMs: cairoMs(date, openH), businessDate: date, closedAt: null, closedBy: null, version: 1, close: null };
    if (!existing) sessions.push(s);
    ce(id, 'OPENING_FLOAT', '500', s.openedAtMs, userId);
    return s;
  };

  function day(date: string, branchId: string, count: number, cashiers: { a: Session; b: Session }, waiters: string[], tablesIds: string[], tag: string) {
    const r = rng(`${tag}:${date}:${branchId}`);
    const menu = priced.filter((p) => p.categoryId !== 'cat_direction');
    const mains = menu.filter((p) => ['cat_mains', 'cat_meals', 'cat_pizza', 'cat_breakfast'].includes(p.categoryId));
    const sides = menu.filter((p) => ['cat_starters', 'cat_desserts'].includes(p.categoryId));
    const drinks = menu.filter((p) => ['cat_hot', 'cat_cold'].includes(p.categoryId));
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    for (let i = 0; i < count; i++) {
      const minute = Math.floor(11 * 60 + r() * (14.5 * 60)); // 11:00 → 01:30 (next day, same business day)
      const startMs = cairoMs(date, Math.floor(minute / 60), minute % 60);
      const ch = r() < 0.55 ? 'DINE_IN' : r() < 0.7 ? 'TAKEAWAY' : 'DELIVERY';
      const session = startMs < cairoMs(date, 16) ? cashiers.a : cashiers.b;
      const waiter = ch === 'DINE_IN' ? pick(waiters) : session.userId;
      const atIso = iso(startMs);
      const lines: OrderLine[] = [mkLine(pick(mains).id, r() < 0.25 ? 2 : 1, ch, atIso, waiter)];
      if (r() < 0.6) lines.push(mkLine(pick(drinks).id, 1 + Math.floor(r() * 2), ch, atIso, waiter));
      if (r() < 0.45) lines.push(mkLine(pick(sides).id, 1, ch, atIso, waiter));
      const guests = ch === 'DINE_IN' ? 1 + Math.floor(r() * 4) : undefined;
      makeOrder({ date, branchId, ch, startMs, waiter, session, lines, guests, tableId: ch === 'DINE_IN' ? pick(tablesIds) : null, discount: r() < 0.08, method: r() < 0.6 ? 'CASH' : r() < 0.8 ? 'CARD' : 'DIGITAL_WALLET', prepMin: 6 + Math.floor(r() * 22) });
    }
  }

  function makeOrder(o: { date: string; branchId: string; ch: string; startMs: number; waiter: string; session: Session; lines: OrderLine[]; guests?: number; tableId?: string | null; discount?: boolean; method: Capture['method']; prepMin: number; comp?: boolean; number?: string; visit?: TableVisit; checkNo?: number; voidLine?: { idx: number; disposition: 'WASTE_HELD'; review: 'PENDING' | 'MISSING' | 'VERIFIED'; reason: string }; removeLine?: OrderLine; noPay?: boolean; status?: Order['status'] }): Order {
    const atIso = iso(o.startMs);
    const doneMs = o.startMs + (o.prepMin + 12 + Math.floor((o.startMs / 1000) % 25)) * 60_000;
    let visit = o.visit ?? null;
    if (o.ch === 'DINE_IN' && !visit && o.tableId) {
      visit = { id: `fx_vis_${++visSeq}`, tableId: o.tableId, branchId: o.branchId, state: 'CLOSED', guestCount: o.guests ?? 2, serverUserId: o.waiter, openedAt: iso(o.startMs - 3 * 60_000), openedAtMs: o.startMs - 3 * 60_000, closedAt: iso(doneMs + 4 * 60_000), version: 2, joinedTableIds: [], history: [] };
      visits.push(visit);
    }
    const id = `fx_ord_${++ordSeq}`;
    const number = o.number ?? `${o.date.slice(5, 7)}${o.date.slice(8, 10)}-${String(ordSeq).padStart(3, '0')}`;
    const ord: Order = {
      id, number, branchId: o.branchId, channel: o.ch as any, status: o.status ?? 'COMPLETED', kind: 'SALE', visitId: visit?.id ?? null, tableId: visit?.tableId ?? null, sessionId: o.ch === 'DINE_IN' ? null : o.session.id, terminalId: o.ch === 'DINE_IN' ? (o.branchId === 'branch_main' ? 't_floor' : 't_second_floor') : o.session.terminalId, serverUserId: o.waiter,
      createdAt: atIso, createdAtMs: o.startMs, businessDate: o.date, createdBy: o.waiter, confirmedAt: atIso, confirmedBy: o.waiter, completedAt: null, completedAtMs: null, completedBusinessDate: null, completedSessionId: null,
      version: 5, checkNo: o.checkNo ?? 1, fireMode: 'AT_CONFIRM', rounds: [{ round: 1, firedAt: atIso, firedBy: o.waiter, lineIds: o.lines.map((l) => l.id), via: 'CONFIRM', commandId: 'fixture' }], lines: o.lines, discounts: [], comp: null, policy: snap(atIso),
      service: o.ch === 'DINE_IN' ? { rate: '12', taxable: true, origin: 'POLICY', capturedAt: atIso, channel: 'DINE_IN' } : { rate: '0', taxable: true, origin: 'CHANNEL_ABSENT', capturedAt: atIso, channel: o.ch as any }, confirmation: null,
      history: [{ at: atIso, by: o.waiter, byName: name(o.waiter), kind: 'CREATED', text: { ar: 'فُتح الشيك', en: 'opened' } }], guestCount: visit?.guestCount,
    };
    if (o.removeLine) { o.removeLine.status = 'REMOVED'; o.removeLine.fireRound = null; o.removeLine.firedAt = null; const g = grant('LINE_REMOVE', id, o.waiter, 'u_manager_1', o.startMs + 60_000); o.removeLine.removed = { at: iso(o.startMs + 60_000), by: o.waiter, approverId: 'u_manager_1', approvalGrantId: g, stage: 'S0', reasonCode: 'CHANGED_MIND', reason: null, quantity: o.removeLine.quantity }; ord.lines.push(o.removeLine); ord.history.push({ at: iso(o.startMs + 60_000), by: o.waiter, kind: 'LINE_REMOVED', text: { ar: `أُزيل قبل الإرسال: ${o.removeLine.name.ar} — بموافقة ${name('u_manager_1')}`, en: 'removed (S0)' } }); reversals.push(rev(ord, o.removeLine, 'S0', 'LINE_REMOVE', 'NOT_PREPARED', o.waiter, 'u_manager_1', g, o.startMs + 60_000, o.date, 'CHANGED_MIND', null)); }
    if (o.voidLine) { const l = o.lines[o.voidLine.idx]; const vms = o.startMs + 9 * 60_000; const g = grant('LINE_VOID', id, o.waiter, 'u_manager_1', vms); l.status = 'VOIDED'; l.voided = { at: iso(vms), by: o.waiter, reasonCode: o.voidLine.reason, approvalGrantId: g, disposition: 'WASTE', approverId: 'u_manager_1', dispositionKind: 'WASTE_HELD', stage: 'S1', terminal: 'DEMO-FLOOR-1' }; ord.history.push({ at: iso(vms), by: o.waiter, kind: 'LINE_VOIDED', text: { ar: `أُلغي بعد المطبخ: ${l.name.ar} — هالك محجوز للمراجعة — بموافقة ${name('u_manager_1')}`, en: 'voided after kitchen (S1)' } }); const rr: any = rev(ord, l, 'S1', 'LINE_VOID', 'WASTE_HELD', o.waiter, 'u_manager_1', g, vms, o.date, o.voidLine.reason, null); rr.review = o.voidLine.review === 'PENDING' ? { state: 'PENDING' } : { state: o.voidLine.review, by: 'u_accountant', at: iso(vms + DAY / 2), note: o.voidLine.review === 'MISSING' ? 'الصنف غير موجود في ثلاجة الهالك' : 'اتشاف' }; reversals.push(rr); }
    if (o.discount) { const g = grant('ORDER_DISCOUNT', id, o.waiter, 'u_manager_1', o.startMs + 30 * 60_000); ord.discounts.push({ id: `fx_dc_${ordSeq}`, type: 'PERCENTAGE', value: '10', reasonCode: 'REGULAR_GUEST', approvalGrantId: g, appliedAt: iso(o.startMs + 30 * 60_000), appliedBy: o.waiter, active: true }); }
    if (o.comp) ord.comp = { reasonCode: 'OWNER_GUEST', at: iso(doneMs - 60_000), by: 'u_manager_1' };
    ord.confirmation = computeLiveTotals(ord);
    // kitchen: one ticket per station of the active lines
    const byStation = new Map<string, OrderLine[]>();
    for (const l of ord.lines.filter((x) => x.fireRound)) byStation.set(station(l.categoryId), [...(byStation.get(station(l.categoryId)) ?? []), l]);
    let k = 0;
    for (const [st, ls] of byStation) {
      const c = o.startMs + 60_000; const ready = c + (o.prepMin + k++ * 2) * 60_000;
      tickets.push({ id: `fx_tk_${++tkSeq}`, orderId: id, orderNumber: number, tableName: visit ? db.tables.find((t) => t.id === visit!.tableId)?.name ?? null : null, channel: ord.channel, round: 1, stationId: st, state: 'DONE', items: ls.map((l) => ({ lineId: l.id, name: l.name, quantity: l.quantity, modifiers: [], status: l.status === 'VOIDED' ? 'CANCELLED' : 'ACTIVE' })), createdAt: iso(c), createdAtMs: c, startedAt: null, readyAt: iso(ready), doneAt: iso(ready + 3 * 60_000), version: 3, serverName: name(o.waiter) });
    }
    if (o.status === 'VOIDED' || o.status === 'CANCELLED') { orders.push(ord); return ord; }
    const pay = D(ord.confirmation.payable);
    if (!o.noPay && pay.gt(0)) {
      let amount = pay, rounding = D(0);
      if (o.method === 'CASH') { const due = pay.dividedBy('0.25').toDecimalPlaces(0, 4).times('0.25'); rounding = pay.minus(due); amount = due; }
      const capId = `fx_cap_${++capSeq}`;
      const tendered = o.method === 'CASH' ? D(Math.ceil(amount.toNumber() / 50) * 50) : null;
      captures.push({ id: capId, orderId: id, method: o.method, amount: m4(amount), tendered: tendered ? m4(tendered) : null, change: tendered ? m4(tendered.minus(amount)) : '0.0000', reference: o.method === 'CASH' ? null : o.method === 'CARD' ? `TRX${String(400000 + capSeq)}` : `IP-${String(880000 + capSeq)}`, walletProvider: o.method === 'DIGITAL_WALLET' ? 'INSTAPAY' : null, sessionId: o.session.id, terminalId: o.session.terminalId, branchId: o.branchId, at: iso(doneMs), atMs: doneMs, businessDate: o.date, by: o.session.userId, commandId: `fx-${capId}`, tip: '0.0000', rounding: m4(rounding) });
      if (o.method === 'CASH') ce(o.session.id, 'TENDER_IN', m4(amount), doneMs, o.session.userId, { ref: number });
      ord.history.push({ at: iso(doneMs), by: o.session.userId, byName: name(o.session.userId), kind: 'CAPTURED', text: { ar: `دُفع ${o.method === 'CASH' ? 'نقدًا' : o.method === 'CARD' ? 'ببطاقة' : 'بمحفظة'} ${amount.toFixed(2)} ج.م${rounding.isZero() ? '' : ` (تقريب ${rounding.toFixed(2)})`}`, en: 'paid' } });
    }
    ord.status = 'COMPLETED'; ord.completedAt = iso(doneMs); ord.completedAtMs = doneMs; ord.completedBusinessDate = o.date; ord.completedSessionId = o.session.id;
    orders.push(ord);
    if (!o.comp && pay.gt(0)) fiscal.push({ id: `fx_fd_${ordSeq}`, orderId: id, orderNumber: number, branchId: o.branchId, terminalId: o.session.terminalId, deviceId: null, documentType: 'RECEIPT', state: 'ACCEPTED', issues: [], uuid: `fx${String(ordSeq).padStart(8, '0')}${'a'.repeat(54)}`, previousUUID: null, referenceOldUUID: null, sequence: null, createdAt: iso(doneMs), createdAtMs: doneMs, builtAt: iso(doneMs), submittedAt: iso(doneMs + 60_000), acceptedAt: iso(doneMs + 120_000), rejectedReason: null, attempts: 1, mode: 'SANDBOX', total: ord.confirmation.payable, history: [] });
    return ord;
  }
  function rev(o: Order, l: OrderLine | null, stage: string, kind: string, disposition: string | null, actor: string, approver: string | null, g: string | null, ms: number, bd: string, reason: string | null, refundId: string | null) {
    return { id: `fx_rv_${reversals.length + 1}`, at: iso(ms), atMs: ms, businessDate: bd, originalBusinessDate: o.businessDate, branchId: o.branchId, orderId: o.id, orderNumber: o.number, orderKind: o.kind, lineId: l?.id ?? null, productId: l?.productId ?? null, name: l?.name ?? { ar: `الشيك ${o.number}`, en: `check ${o.number}` }, quantity: l?.quantity ?? '1', value: l?.lineTotal ?? (o.confirmation?.payable ?? '0.0000'), stage, kind, actorId: actor, approverId: approver, grantId: g, credentialKind: 'PIN', terminalId: 't_floor', sessionId: null, drawerOwnerId: null, reasonCode: reason, reason: null, disposition, refundId, afterClose: stage === 'S3', review: null };
  }

  // ───── sessions
  const s2a = openSession('fx_ses_y2_a', 'branch_main', 't_cash', 'u_cashier_a', y2, 10);
  const s2b = openSession('fx_ses_y2_b', 'branch_main', 't_cash2', 'u_cashier_b', y2, 16);
  const s1a = openSession('fx_ses_y1_a', 'branch_main', 't_cash2', 'u_cashier_a', y1, 10);
  const s1b = openSession('ses_hist_y1', 'branch_main', 't_cash', 'u_cashier_b', y1, 16); // the r3A seeded takeaway was paid in this drawer
  const s1s = openSession('fx_ses_y1_s', 'branch_second', 't_second_floor', 'u_waiter_second', y1, 11);
  // the r3A seeded cash sale of yesterday entered this drawer
  for (const c of db.captures.filter((x) => x.sessionId === 'ses_hist_y1' && x.method === 'CASH')) ce('ses_hist_y1', 'TENDER_IN', c.amount, c.atMs, c.by, { ref: db.orders.find((o) => o.id === c.orderId)?.number });
  const mainTables = db.tables.filter((t) => t.branchId === 'branch_main').map((t) => t.id);
  const secondTables = db.tables.filter((t) => t.branchId === 'branch_second').map((t) => t.id);

  // ───── planted cases (before the random fill so their numbers are stable)
  // y2: comp, whole-check void, cancel before sending, a burger held as waste marked missing, the order refunded tomorrow
  const p = (id: string) => (priced.some((x) => x.id === id) ? id : priced[0].id);
  makeOrder({ date: y2, branchId: 'branch_main', ch: 'DINE_IN', startMs: cairoMs(y2, 14, 10), waiter: 'u_waiter_1', session: s2a, lines: [mkLine(p('p_mixed_grill'), 1, 'DINE_IN', iso(cairoMs(y2, 14, 10)), 'u_waiter_1'), mkLine(p('p_tea'), 2, 'DINE_IN', iso(cairoMs(y2, 14, 10)), 'u_waiter_1')], guests: 2, tableId: 'tbl_2', method: 'CASH', prepMin: 14, comp: true });
  makeOrder({ date: y2, branchId: 'branch_main', ch: 'DINE_IN', startMs: cairoMs(y2, 20, 5), waiter: 'u_waiter_2', session: s2b, lines: [mkLine(p('p_kofta'), 1, 'DINE_IN', iso(cairoMs(y2, 20, 5)), 'u_waiter_2')], guests: 1, tableId: 'tbl_7', method: 'CASH', prepMin: 10, status: 'VOIDED' }).endReason = { code: 'CUSTOMER_LEFT', approvalGrantId: grant('ORDER_VOID', `fx_ord_${ordSeq}`, 'u_waiter_2', 'u_manager_1', cairoMs(y2, 20, 30)) };
  { const o = orders.at(-1)!; o.voidedAt = iso(cairoMs(y2, 20, 30)); for (const l of o.lines) { l.status = 'VOIDED'; l.voided = { at: o.voidedAt, by: 'u_waiter_2', reasonCode: 'CUSTOMER_LEFT', approvalGrantId: o.endReason!.approvalGrantId, disposition: 'ORDER_VOID', approverId: 'u_manager_1', stage: 'S1' }; } o.confirmation = computeLiveTotals(o); reversals.push(rev(o, null, 'S1', 'ORDER_VOID', null, 'u_waiter_2', 'u_manager_1', o.endReason!.approvalGrantId!, cairoMs(y2, 20, 30), y2, 'CUSTOMER_LEFT', null)); }
  { const o = makeOrder({ date: y2, branchId: 'branch_main', ch: 'TAKEAWAY', startMs: cairoMs(y2, 13, 2), waiter: 'u_cashier_a', session: s2a, lines: [mkLine(p('p_beef_burger'), 1, 'TAKEAWAY', iso(cairoMs(y2, 13, 2)), 'u_cashier_a')], method: 'CASH', prepMin: 0, status: 'CANCELLED' }); o.cancelledAt = iso(cairoMs(y2, 13, 3)); o.endReason = { code: 'OPENED_BY_MISTAKE' }; o.rounds = []; o.lines.forEach((l) => { l.fireRound = null; l.firedAt = null; }); for (let i = tickets.length - 1; i >= 0; i--) if (tickets[i].orderId === o.id) tickets.splice(i, 1); reversals.push(rev(o, null, 'S0', 'ORDER_CANCEL', 'NOT_PREPARED', 'u_cashier_a', null, null, cairoMs(y2, 13, 3), y2, 'OPENED_BY_MISTAKE', null)); }
  makeOrder({ date: y2, branchId: 'branch_main', ch: 'DINE_IN', startMs: cairoMs(y2, 21, 15), waiter: 'u_waiter_1', session: s2b, lines: [mkLine(p('p_beef_burger'), 1, 'DINE_IN', iso(cairoMs(y2, 21, 15)), 'u_waiter_1'), mkLine(p('p_orange_juice'), 1, 'DINE_IN', iso(cairoMs(y2, 21, 15)), 'u_waiter_1'), mkLine(p('p_kunafa'), 1, 'DINE_IN', iso(cairoMs(y2, 21, 15)), 'u_waiter_1')], guests: 2, tableId: 'tbl_5', method: 'CARD', prepMin: 12, voidLine: { idx: 0, disposition: 'WASTE_HELD', review: 'MISSING', reason: 'QUALITY' } });
  const toRefund = makeOrder({ date: y2, branchId: 'branch_main', ch: 'TAKEAWAY', startMs: cairoMs(y2, 19, 40), waiter: 'u_cashier_b', session: s2b, lines: [mkLine(p('p_kofta'), 1, 'TAKEAWAY', iso(cairoMs(y2, 19, 40)), 'u_cashier_b'), mkLine(p('p_hummus'), 1, 'TAKEAWAY', iso(cairoMs(y2, 19, 40)), 'u_cashier_b')], method: 'CASH', prepMin: 11 });
  // y1: split 100 / 3, the S3 refund of y2, an S2 card refund, a void after kitchen (waste held, pending), an S0 removal
  { const startMs = cairoMs(y1, 15, 20); const at = iso(startMs);
    const visit: TableVisit = { id: `fx_vis_${++visSeq}`, tableId: 'tbl_4', branchId: 'branch_main', state: 'CLOSED', guestCount: 3, serverUserId: 'u_waiter_1', openedAt: iso(startMs - 120_000), openedAtMs: startMs - 120_000, closedAt: iso(startMs + 50 * 60_000), version: 4, joinedTableIds: [], history: [] };
    visits.push(visit);
    const base = [mkLine(p('p_hummus'), 1, 'DINE_IN', at, 'u_waiter_1', m4(60)), mkLine(p('p_turkish_coffee'), 1, 'DINE_IN', at, 'u_waiter_1', m4(40))];
    const shares = base.map((l) => allocate(l.lineTotal, [1, 1, 1], 2)); // 20/20/20 and 13.33/13.33/13.34 → checks 33.33 + 33.33 + 33.34
    for (let k = 0; k < 3; k++) {
      const ls = base.map((l, j) => ({ ...structuredClone(l), id: `fx_ln_${++lineSeq}`, quantity: m4(D(1).dividedBy(3)).replace(/0+$/, ''), lineTotal: shares[j][k], unitTotal: m4(D(shares[j][k]).times(3)), shareOf: { lineId: l.id, parts: 3, index: k + 1 } }));
      const o = makeOrder({ date: y1, branchId: 'branch_main', ch: 'DINE_IN', startMs: startMs + k * 1000, waiter: 'u_waiter_1', session: s1a, lines: ls, visit, checkNo: k + 1, tableId: 'tbl_4', method: k === 2 ? 'CARD' : 'CASH', prepMin: 9 });
      o.label = `ضيف ${k + 1} من 3`;
      o.history.push({ at, by: 'u_waiter_1', kind: 'SPLIT', text: { ar: `قُسّم بالتساوي على 3 (100.00 = 33.33 + 33.33 + 33.34) — هذا الشيك ${k + 1}`, en: 'split equally into 3' } });
      if (k > 0) for (let i = tickets.length - 1; i >= 0; i--) if (tickets[i].orderId === o.id) tickets.splice(i, 1); // one kitchen ticket for the visit
    }
  }
  { const rms = cairoMs(y1, 13, 5); const payable = D(toRefund.confirmation!.payable); const kofta = toRefund.lines[0]; const amount = m4(D(kofta.lineTotal).dividedBy(D(toRefund.confirmation!.itemsSubtotal)).times(payable).toDecimalPlaces(2));
    const g = grant('REFUND', toRefund.id, 'u_cashier_a', 'u_manager_1', rms);
    refunds.push({ id: 'fx_rf_1', orderId: toRefund.id, amount, method: 'CASH', reasonCode: 'QUALITY', reason: 'وصلت الكفتة باردة — عاد العميل في اليوم التالي', state: 'PAID', allocations: [{ captureId: captures.find((c) => c.orderId === toRefund.id)!.id, amount }], lines: [{ lineId: kofta.id, quantity: '1', disposition: 'NOT_PREPARED' }], requestedBy: 'u_cashier_a', requestedAt: iso(rms - 60_000), decidedBy: 'u_manager_1', decidedAt: iso(rms - 30_000), paidAt: iso(rms), paidSessionId: s1a.id, businessDate: y1, version: 3, approvalGrantId: g, stage: 'S3', afterClose: true, originalBusinessDate: y2, approverId: 'u_manager_1', paidBy: 'u_cashier_a', drawerOwnerId: 'u_cashier_a', paidTerminalId: 't_cash2' });
    ce(s1a.id, 'REFUND_OUT', amount, rms, 'u_cashier_a', { ref: toRefund.number, reason: 'مرتجع بعد قفل اليوم', approvalGrantId: g });
    toRefund.history.push({ at: iso(rms), by: 'u_cashier_a', kind: 'REFUND', text: { ar: `مرتجع نقدي ${amount} ج.م بعد إغلاق يوم ${y2} — سُجّل في يوم ${y1} دون تغيير اليوم الأصلي`, en: 'refund after close' } });
    reversals.push({ ...rev(toRefund, kofta, 'S3', 'RETURN_AFTER_CLOSE', 'NOT_PREPARED', 'u_cashier_a', 'u_manager_1', g, rms, y1, 'QUALITY', 'fx_rf_1'), sessionId: s1a.id, drawerOwnerId: 'u_cashier_a', value: amount });
  }
  { const o = makeOrder({ date: y1, branchId: 'branch_main', ch: 'TAKEAWAY', startMs: cairoMs(y1, 18, 30), waiter: 'u_cashier_b', session: s1b, lines: [mkLine(p('p_chicken_shawarma'), 1, 'TAKEAWAY', iso(cairoMs(y1, 18, 30)), 'u_cashier_b'), mkLine(p('p_lemon_mint'), 1, 'TAKEAWAY', iso(cairoMs(y1, 18, 30)), 'u_cashier_b')], method: 'CARD', prepMin: 8 });
    const rms = cairoMs(y1, 19, 10); const amount = m4(D(o.lines[1].lineTotal).times('1.14').toDecimalPlaces(2)); const g = grant('REFUND', o.id, 'u_cashier_b', 'u_manager_1', rms);
    refunds.push({ id: 'fx_rf_2', orderId: o.id, amount, method: 'CARD', reasonCode: 'WRONG_CHARGE', reason: 'احتُسب المشروب ولم يُطلب', state: 'PAID', allocations: [{ captureId: captures.find((c) => c.orderId === o.id)!.id, amount }], lines: [{ lineId: o.lines[1].id, quantity: '1', disposition: 'NOT_PREPARED' }], requestedBy: 'u_cashier_b', requestedAt: iso(rms - 60_000), decidedBy: 'u_manager_1', decidedAt: iso(rms - 30_000), paidAt: iso(rms), paidSessionId: s1b.id, businessDate: y1, version: 3, approvalGrantId: g, stage: 'S2', afterClose: false, originalBusinessDate: y1, approverId: 'u_manager_1', paidBy: 'u_cashier_b', drawerOwnerId: 'u_cashier_b', paidTerminalId: 't_cash' });
    reversals.push({ ...rev(o, o.lines[1], 'S2', 'REFUND', 'NOT_PREPARED', 'u_cashier_b', 'u_manager_1', g, rms, y1, 'WRONG_CHARGE', 'fx_rf_2'), sessionId: s1b.id, drawerOwnerId: 'u_cashier_b', value: amount });
  }
  makeOrder({ date: y1, branchId: 'branch_main', ch: 'DINE_IN', startMs: cairoMs(y1, 21, 40), waiter: 'u_waiter_2', session: s1b, lines: [mkLine(p('p_kofta'), 1, 'DINE_IN', iso(cairoMs(y1, 21, 40)), 'u_waiter_2'), mkLine(p('p_green_salad'), 1, 'DINE_IN', iso(cairoMs(y1, 21, 40)), 'u_waiter_2'), mkLine(p('p_pepsi'), 2, 'DINE_IN', iso(cairoMs(y1, 21, 40)), 'u_waiter_2')], guests: 2, tableId: 'tbl_9', method: 'CASH', prepMin: 13, voidLine: { idx: 0, disposition: 'WASTE_HELD', review: 'PENDING', reason: 'QUALITY' }, removeLine: mkLine(p('p_om_ali'), 1, 'DINE_IN', iso(cairoMs(y1, 21, 41)), 'u_waiter_2') });
  // staff meal (zero price, approver, employee)
  { const ms = cairoMs(y1, 16, 45); const at = iso(ms); const ls = [mkLine(p('p_shawarma_sandwich'), 1, 'TAKEAWAY', at, 'u_cashier_a'), mkLine(p('p_tea'), 1, 'TAKEAWAY', at, 'u_cashier_a')];
    const g = grant('STAFF_MEAL', `fx_ord_${ordSeq + 1}`, 'u_cashier_a', 'u_manager_1', ms);
    const meal: Order = { id: `fx_ord_${++ordSeq}`, number: `SM-${y1.slice(5, 7)}${y1.slice(8, 10)}-01`, branchId: 'branch_main', channel: 'TAKEAWAY', status: 'COMPLETED', kind: 'STAFF_MEAL', visitId: null, tableId: null, sessionId: null, terminalId: 't_cash2', serverUserId: 'u_cashier_a', createdAt: at, createdAtMs: ms, businessDate: y1, createdBy: 'u_cashier_a', confirmedAt: at, confirmedBy: 'u_cashier_a', completedAt: at, completedAtMs: ms, completedBusinessDate: y1, completedSessionId: null, version: 2, checkNo: 1, fireMode: 'AT_CONFIRM', rounds: [{ round: 1, firedAt: at, firedBy: 'u_cashier_a', lineIds: ls.map((l) => l.id), via: 'CONFIRM', commandId: 'fixture' }], lines: ls, discounts: [], comp: { reasonCode: 'STAFF_MEAL', at, by: 'u_cashier_a' }, policy: snap(at), service: null, confirmation: null, history: [{ at, by: 'u_cashier_a', kind: 'STAFF_MEAL', text: { ar: `وجبة موظف لـ ${name('u_waiter_2')} — بموافقة ${name('u_manager_1')} — مش بيع`, en: 'staff meal' } }], customerName: name('u_waiter_2') };
    meal.staffMeal = { employeeUserId: 'u_waiter_2', employeeName: name('u_waiter_2'), basis: 'SALE_PRICE', value: m4(ls.reduce((a, l) => a.plus(l.lineTotal), D(0))), saleValue: m4(ls.reduce((a, l) => a.plus(l.lineTotal), D(0))), approverId: 'u_manager_1', grantId: g, sentToKitchen: true };
    meal.confirmation = computeLiveTotals(meal);
    orders.push(meal);
  }

  // ───── random fill (realistic volume)
  day(y2, 'branch_main', 92, { a: s2a, b: s2b }, ['u_waiter_1', 'u_waiter_2'], mainTables, 'main');
  day(y1, 'branch_main', 98, { a: s1a, b: s1b }, ['u_waiter_1', 'u_waiter_2'], mainTables, 'main');
  day(y1, 'branch_second', 38, { a: s1s, b: s1s }, ['u_waiter_second'], secondTables.length ? secondTables : mainTables.slice(0, 1), 'second');

  // ───── drawer movements and closes
  ce(s1b.id, 'PAY_OUT', '150', cairoMs(y1, 20, 15), 'u_cashier_b', { reasonCode: 'SUPPLIER', reason: 'عيش من الفرن', approvalGrantId: grant('CASH_MOVE', s1b.id, 'u_cashier_b', 'u_manager_1', cairoMs(y1, 20, 15)) });
  ce(s2b.id, 'SAFE_DROP', '2000', cairoMs(y2, 22, 0), 'u_cashier_b', { reasonCode: 'SAFE_DROP' });
  ce(s1a.id, 'NO_SALE', '0', cairoMs(y1, 12, 30), 'u_cashier_a', { reasonCode: 'CHANGE', reason: 'صرف فكة لعميل' });
  const SIGN: Record<string, number> = { OPENING_FLOAT: 1, TENDER_IN: 1, REFUND_OUT: -1, PAY_IN: 1, PAY_OUT: -1, SAFE_DROP: -1, NO_SALE: 0, TIP_IN: 1, TIP_OUT: -1, DEPOSIT_IN: 1, TENDER_CORRECTION_IN: 1, TENDER_CORRECTION_OUT: -1 };
  const allSessions = [...sessions, ...db.sessions.filter((s) => s.id === 'ses_hist_y1')];
  for (const s of allSessions) {
    const es = entries.filter((e) => e.sessionId === s.id);
    const expected = es.reduce((a, e) => a.plus(D(e.amount).times(SIGN[e.kind] ?? 0)), D(0));
    const short = s.id === 'ses_hist_y1' ? D(-30) : D(0);
    const lastMs = Math.max(s.openedAtMs, ...es.map((e) => Date.parse(e.at)), ...captures.filter((c) => c.sessionId === s.id).map((c) => c.atMs), ...db.captures.filter((c) => c.sessionId === s.id).map((c) => c.atMs));
    const closeMs = lastMs + 20 * 60_000;
    const caps = captures.filter((c) => c.sessionId === s.id);
    const tender: Record<string, string> = {}; for (const c of caps) tender[c.method] = m4(D(tender[c.method] ?? 0).plus(c.amount));
    const byKind: Record<string, string> = {}; for (const e of es) byKind[e.kind] = m4(D(byKind[e.kind] ?? 0).plus(e.amount));
    const refundBreakdown: Record<string, string> = {}; for (const rf of refunds.filter((x) => x.paidSessionId === s.id)) refundBreakdown[rf.method] = m4(D(refundBreakdown[rf.method] ?? 0).plus(rf.amount));
    s.state = 'CLOSED'; s.closedAt = iso(closeMs); s.closedBy = s.userId; s.version += 3;
    s.close = { countedCash: m4(expected.plus(short)), expectedCash: m4(expected), variance: m4(short), reason: short.isZero() ? undefined : 'باقٍ سُلِّم خطأً لعميل — تمت مراجعة الكاشير', approvalGrantId: short.isZero() ? undefined : grant('DRAWER_VARIANCE', s.id, s.userId, 'u_manager_1', closeMs), z: { sessionId: s.id, terminalCode: db.terminals.find((t) => t.id === s.terminalId)?.code ?? s.terminalId, cashierName: name(s.userId), openedAt: s.openedAt, closedAt: iso(closeMs), businessDate: s.businessDate, openingFloat: s.openingFloat, tenderBreakdown: tender, refundBreakdown, cashByKind: byKind, expectedCash: m4(expected), countedCash: m4(expected.plus(short)), variance: m4(short), orderCounts: { COMPLETED: caps.length }, outstandingChecks: [], tips: '0.0000', snapshotAt: iso(closeMs) } };
  }

  // ───── commit
  db.sessions.push(...sessions);
  db.cashEntries.push(...entries);
  db.captures.push(...captures);
  db.orders.push(...orders);
  db.tickets.push(...tickets);
  db.visits.push(...visits);
  db.refunds.push(...refunds);
  db.grants.push(...grants);
  db.fiscalDocuments.push(...fiscal);
  ((db as any).reversals ??= []).push(...reversals);
  (db.approvalRequests ??= []).push({ id: 'fx_ar_1', state: 'REJECTED', action: 'ORDER_DISCOUNT', actionTitle: 'خصم على الشيك', targetType: 'orders.Order', targetId: orders[10]?.id ?? 'x', context: { discountPercent: 30 }, summary: { ar: 'خصم 30% على شيك', en: '30% discount' }, opId: 'Order.ApplyDiscount', commandId: null, requesterUserId: 'u_waiter_2', terminalId: 't_floor', branchId: 'branch_main', createdAt: iso(cairoMs(y1, 22, 5)), createdAtMs: cairoMs(y1, 22, 5), expiresAtMs: cairoMs(y1, 22, 7), decidedBy: 'u_manager_1', decidedAt: iso(cairoMs(y1, 22, 6)), decisionNote: 'الخصم أكبر من المسموح', grantId: null, version: 2 } as any);

  // ───── the frozen closes, sales history and seeded reconciliation for those days now come from the facts
  for (const [date, branchId] of [[y2, 'branch_main'], [y1, 'branch_main'], [y1, 'branch_second']] as const) {
    const sales = db.orders.filter((o) => o.branchId === branchId && o.kind === 'SALE' && o.status === 'COMPLETED' && o.completedBusinessDate === date);
    const caps = db.captures.filter((c) => c.branchId === branchId && c.businessDate === date);
    const tot = sales.map((o) => computeLiveTotals(o));
    const sum = (f: (t: ReturnType<typeof computeLiveTotals>) => string) => tot.reduce((a, t) => a.plus(f(t)), D(0));
    const nonComp = sales.filter((o) => !o.comp);
    const net = sum((t) => (t.comp ? '0' : t.netSales));
    const byMethod: Record<string, string> = {}; for (const c of caps) byMethod[c.method] = m4(D(byMethod[c.method] ?? 0).plus(c.amount));
    const guests = [...new Set(nonComp.map((o) => o.visitId).filter(Boolean))].reduce((a, v) => a + (db.visits.find((x) => x.id === v)?.guestCount ?? 0), 0);
    const orderCount = new Set(nonComp.map((o) => o.visitId ?? o.id)).size;
    const byHour = Array(24).fill(0); for (const o of nonComp) byHour[zonedParts(o.completedAtMs!, 'Africa/Cairo').hour] += Number(computeLiveTotals(o).netSales);
    const items = new Map<string, { name: any; qty: number; amount: number }>(); for (const o of nonComp) for (const l of o.lines.filter((x) => x.status === 'ACTIVE')) { const it = items.get(l.productId) ?? { name: l.name, qty: 0, amount: 0 }; it.qty += Number(l.quantity); it.amount += Number(l.lineTotal); items.set(l.productId, it); }
    const h = (db.salesHistory ?? []).find((x) => x.branchId === branchId && x.businessDate === date);
    const hist = { branchId, businessDate: date, netSales: m4(net), orders: orderCount, guests, byHour: byHour.map((x) => Math.round(x)), byMethod: { CASH: byMethod.CASH ?? m4(0), CARD: byMethod.CARD ?? m4(0), DIGITAL_WALLET: byMethod.DIGITAL_WALLET ?? m4(0) }, topItems: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 8).map((x) => ({ name: x.name, qty: x.qty, amount: m4(x.amount) })) };
    if (h) Object.assign(h, hist); else (db.salesHistory ??= []).push(hist);
    const rec = (db.businessDays ?? []).find((d) => d.branchId === branchId && d.date === date);
    if (rec) {
      const dayRefunds = db.refunds.filter((r) => r.state === 'PAID' && r.businessDate === date && db.orders.find((o) => o.id === r.orderId)?.branchId === branchId);
      const voided = db.orders.filter((o) => o.branchId === branchId && o.businessDate === date).flatMap((o) => o.lines.filter((l) => l.status === 'VOIDED' && l.voided?.disposition !== 'ORDER_VOID'));
      const sess = db.sessions.filter((s) => s.branchId === branchId && s.businessDate === date);
      rec.summary = { orders: orderCount, guests, netSales: m4(net), payable: m4(sum((t) => t.payable)), tax: m4(sum((t) => t.tax)), service: m4(sum((t) => D(t.serviceCharge).minus(t.serviceDiscount).toString())), avgCheck: nonComp.length ? m4(net.dividedBy(nonComp.length)) : m4(0), payments: byMethod, refunds: m4(dayRefunds.reduce((a, r) => a.plus(r.amount), D(0))), refundCount: dayRefunds.length, discounts: m4(sum((t) => (t.comp ? '0' : D(t.itemDiscount).plus(t.discountAfterTax).toString()))), discountCount: nonComp.filter((o) => o.discounts.some((d) => d.active)).length, comps: sales.filter((o) => o.comp).length, voidedLines: voided.length, voidedAmount: m4(voided.reduce((a, l) => a.plus(l.lineTotal), D(0))), cancelledOrders: db.orders.filter((o) => o.branchId === branchId && o.businessDate === date && o.status === 'CANCELLED').length, voidedOrders: db.orders.filter((o) => o.branchId === branchId && o.businessDate === date && o.status === 'VOIDED').length, cashVariance: m4(sess.reduce((a, s) => a.plus(s.close?.variance ?? 0), D(0))), tips: m4(0), sessions: sess.length };
      (rec as any).fixture = 'reports engine: recomputed from event-level facts';
    }
    if (branchId === 'branch_main') {
      const sb = (db.settlementBatches ?? []).find((b) => b.id === `sb_card_${date}`); if (sb) sb.amount = m4(D(byMethod.CARD ?? 0).minus(date === y2 ? 250 : 0));
      const sw = (db.settlementBatches ?? []).find((b) => b.id === `sb_wallet_${date}`); if (sw) sw.amount = byMethod.DIGITAL_WALLET ?? m4(0);
      for (const r of db.reconResults ?? []) {
        if (r.key === `CARD:${date}`) { r.expected = byMethod.CARD ?? m4(0); r.actual = m4(D(r.expected).minus(250)); }
        if (r.key === `WALLET:${date}`) { r.expected = byMethod.DIGITAL_WALLET ?? m4(0); r.actual = r.expected; }
        if (r.key === `DRAWER:${date}:T1`) { const s = db.sessions.find((x) => x.id === 'ses_hist_y1'); if (s?.close) { r.expected = s.close.expectedCash; r.actual = s.close.countedCash; r.difference = s.close.variance; r.drilldown = [{ kind: 'SESSION', id: s.id, label: `وردية ${name(s.userId)}`, amount: s.close.variance }]; } }
      }
    }
  }
}
