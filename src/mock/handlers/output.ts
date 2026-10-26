import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { nextId } from '../store';
import { computeTotals } from '../pricing';
import { enqueuePrint, buildFiscal, issueFiscal, runOutbox } from '../outbox';
import { D, m4, add } from '../money';
import { zonedParts, businessDate as bdOf } from '../clock';
import { getOrder, need, page, requireFields, settlementOf, userName } from './util';
import { expectedCash } from './money';
import type { Order, DB } from '../types';

function receiptView(ctx: Ctx, o: Order) {
  const db = ctx.db;
  const totals = computeTotals(o);
  const br = db.branches.find((b) => b.id === o.branchId)!;
  const fdoc = db.fiscalDocuments.find((d) => d.orderId === o.id && d.state !== 'SUPERSEDED') ?? null;
  const caps = db.captures.filter((c) => c.orderId === o.id);
  const profile = db.fiscalProfiles.find((p) => p.branchId === o.branchId);
  return {
    orderId: o.id, number: o.number, kind: o.kind, status: o.status, channel: o.channel, table: o.tableId ? db.tables.find((t) => t.id === o.tableId)?.name : null, checkNo: o.checkNo,
    business: { name: db.business.name, nameAr: db.business.nameAr, legalName: db.business.legalName, taxNumber: profile?.issuerId ?? null, address: profile ? `${profile.address.street} ${profile.address.buildingNumber}، ${profile.address.city}` : null },
    branch: { code: br.code, name: br.name }, server: userName(db, o.serverUserId), cashier: userName(db, caps.at(-1)?.by), completedAt: o.completedAt, businessDate: o.completedBusinessDate ?? o.businessDate,
    lines: o.lines.filter((l) => l.status === 'ACTIVE' || l.status === 'VOIDED').map((l) => ({ id: l.id, name: l.name, quantity: l.quantity, unitTotal: l.unitTotal, lineTotal: l.lineTotal, modifiers: l.modifiers.map((m) => m.name), variant: l.variant?.name ?? null, children: l.children ?? [], voided: l.status === 'VOIDED', seat: l.seat ?? null })),
    totals, payments: caps.map((c) => ({ method: c.method, amount: c.amount, tendered: c.tendered, change: c.change, reference: c.reference, walletProvider: c.walletProvider, tip: c.tip })),
    settlement: o.status === 'DRAFT' ? null : settlementOf(db, o),
    fiscal: fdoc ? { state: fdoc.state, uuid: fdoc.uuid, mode: fdoc.mode, qr: fdoc.uuid ? `https://invoicing.eta.gov.eg/receipts/search/${fdoc.uuid}` : null, issues: fdoc.issues } : null,
    serviceOffReceipt: totals.serviceCharge !== '0.0000' && !!fdoc,
  };
}

const REPORTS = [
  { id: 'daily_sales', title: { ar: 'مبيعات اليوم', en: 'Daily sales' }, permission: 'report:run', period: 'DAY' },
  { id: 'tenders', title: { ar: 'وسائل الدفع', en: 'Tenders' }, permission: 'report:run', period: 'DAY' },
  { id: 'products', title: { ar: 'الأصناف', en: 'Products' }, permission: 'report:run', period: 'RANGE' },
  { id: 'staff', title: { ar: 'الموظفين', en: 'Staff' }, permission: 'session:zreport', period: 'RANGE' },
  { id: 'exceptions', title: { ar: 'الاستثناءات (إلغاء، خصم، مرتجع)', en: 'Exceptions' }, permission: 'session:zreport', period: 'RANGE' },
  { id: 'shift', title: { ar: 'الورديات والأدراج', en: 'Shifts & drawers' }, permission: 'session:xreport', period: 'DAY' },
  { id: 'peak_hours', title: { ar: 'ساعات الذروة', en: 'Peak hours' }, permission: 'report:run', period: 'RANGE' },
  { id: 'branch_comparison', title: { ar: 'مقارنة الفروع', en: 'Branch comparison' }, permission: 'session:zreport', period: 'RANGE' },
];

function inRange(d: string | null | undefined, from: string, to: string) { return !!d && d >= from && d <= to; }
const sum = (xs: string[]) => m4(xs.reduce((a, x) => a.plus(D(x)), D(0)));

function runReport(ctx: Ctx, id: string, from: string, to: string, branchIds: string[]) {
  const db = ctx.db;
  const completed = db.orders.filter((o) => branchIds.includes(o.branchId) && o.status === 'COMPLETED' && o.kind === 'SALE' && inRange(o.completedBusinessDate, from, to));
  const staffMeals = db.orders.filter((o) => branchIds.includes(o.branchId) && o.kind === 'STAFF_MEAL' && inRange(o.completedBusinessDate, from, to));
  const T = (o: Order) => computeTotals(o);
  const caps = db.captures.filter((c) => branchIds.includes(c.branchId) && inRange(c.businessDate, from, to));
  const refunds = db.refunds.filter((r) => r.state === 'PAID' && inRange(r.businessDate, from, to) && branchIds.includes(db.orders.find((o) => o.id === r.orderId)!.branchId));
  const provisional = db.sessions.some((s) => branchIds.includes(s.branchId) && s.state === 'OPEN') || to >= ctx.businessDate();
  const base = { reportId: id, period: { from, to }, branchIds, provisional, asOf: ctx.nowIso };
  const netOf = (o: Order) => { const t = T(o); return t.comp ? '0.0000' : m4(D(t.itemsSubtotal).minus(t.itemDiscount).minus(t.discountAfterTax)); };
  switch (id) {
    case 'daily_sales': {
      const byChannel: Record<string, any> = {};
      for (const o of completed) { const c = (byChannel[o.channel] ??= { orders: 0, net: '0' }); c.orders++; c.net = add(c.net, netOf(o)); }
      const net = sum(completed.map(netOf));
      const refunded = sum(refunds.map((r) => r.amount));
      const guests = completed.reduce((a, o) => a + (o.guestCount ?? 0), 0);
      const outstanding = db.orders.filter((o) => branchIds.includes(o.branchId) && o.status === 'CONFIRMED').map((o) => ({ number: o.number, table: o.tableId ? db.tables.find((t) => t.id === o.tableId)?.name : null, remaining: settlementOf(db, o).remaining }));
      return { ...base, sections: [
        { id: 'summary', title: { ar: 'الملخص', en: 'Summary' }, rows: [
          ['order_count', completed.length], ['gross_sales', sum(completed.map((o) => T(o).itemsSubtotal))], ['discounts', sum(completed.filter((o) => !T(o).comp).map((o) => add(T(o).itemDiscount, T(o).discountAfterTax)))], ['comps', sum(completed.filter((o) => T(o).comp).map((o) => T(o).itemsSubtotal))],
          ['net_sales', net], ['service_charge', sum(completed.map((o) => m4(D(T(o).serviceCharge).minus(T(o).serviceDiscount))))], ['tax', sum(completed.map((o) => T(o).tax))], ['charges', sum(completed.flatMap((o) => T(o).charges.map((c) => c.amount)))], ['table_tax', sum(completed.map((o) => T(o).tableTax))],
          ['refunds_paid', refunded], ['net_sales_after_refunds', m4(D(net).minus(refunded))], ['average_order_value', completed.length ? m4(D(net).dividedBy(completed.length)) : '0.0000'], ['guest_count', guests || 'CAPABILITY_NOT_AVAILABLE'], ['staff_meals', staffMeals.length],
        ] },
        { id: 'by_channel', title: { ar: 'حسب القناة', en: 'By channel' }, rows: Object.entries(byChannel).map(([k, v]) => [k, v.orders, v.net]) },
        { id: 'outstanding_checks', title: { ar: 'شيكات مفتوحة (مأكدة ومش مدفوعة)', en: 'Outstanding checks' }, rows: outstanding.map((o) => [o.number, o.table ?? '—', o.remaining]) },
      ], note: { ar: 'الخدمة مقياس لوحده ومش جوه صافي المبيعات. المرتجعات بتتحسب يوم صرفها.', en: 'Service charge is its own measure, never inside net sales. Refunds count on their payout date.' } };
    }
    case 'tenders': {
      const methods = [...new Set([...caps.map((c) => c.method + (c.walletProvider ? ':' + c.walletProvider : '')), ...refunds.map((r) => r.method)])];
      return { ...base, sections: [
        { id: 'by_method', title: { ar: 'حسب وسيلة الدفع', en: 'By method' }, columns: ['method', 'gross_tender', 'refunded_tender', 'net_tender'], rows: methods.map((m) => { const g = sum(caps.filter((c) => c.method + (c.walletProvider ? ':' + c.walletProvider : '') === m).map((c) => c.amount)); const r = sum(refunds.filter((x) => x.method === m).map((x) => x.amount)); return [m, g, r, m4(D(g).minus(r))]; }) },
        { id: 'corrections', title: { ar: 'تصحيحات وسيلة الدفع', en: 'Tender corrections' }, rows: caps.filter((c) => c.correctionOf && D(c.amount).gt(0)).map((c) => [c.correctionOf, c.method, c.amount]) },
        { id: 'tips', title: { ar: 'البقشيش (مش مبيعات)', en: 'Tips (not sales)' }, rows: [['tips', sum(db.tips.filter((t) => inRange(t.businessDate, from, to)).map((t) => t.amount))]] },
        { id: 'deposits', title: { ar: 'العربون (التزام)', en: 'Deposits (liability)' }, rows: db.deposits.filter((d) => branchIds.includes(d.branchId)).map((d) => [d.customer, d.state, d.amount]) },
      ], note: { ar: 'وسائل الدفع عمرها ما بتتسمى "مبيعات".', en: 'Tenders are never called sales.' } };
    }
    case 'products': {
      const by = new Map<string, any>();
      for (const o of completed) for (const l of o.lines.filter((x) => x.status === 'ACTIVE')) { const r = by.get(l.productId) ?? { name: l.name.ar, cat: l.categoryId, qty: D(0), net: D(0) }; r.qty = r.qty.plus(l.quantity); r.net = r.net.plus(l.lineTotal); by.set(l.productId, r); }
      const rows = [...by.values()].sort((a, b) => b.net.comparedTo(a.net)).slice(0, 50);
      const byCat = new Map<string, any>();
      for (const r of rows) byCat.set(r.cat, (byCat.get(r.cat) ?? D(0)).plus(r.net));
      return { ...base, sections: [
        { id: 'top', title: { ar: 'أعلى 50 صنف', en: 'Top 50 products' }, columns: ['product', 'item_quantity', 'item_net_sales'], rows: rows.map((r) => [r.name, r.qty.toString(), m4(r.net)]) },
        { id: 'by_category', title: { ar: 'حسب القسم (المسجل على السطر)', en: 'By category (captured)' }, rows: [...byCat.entries()].map(([c, n]) => [db.categories.find((x) => x.id === c)?.name.ar ?? c, m4(n)]) },
        { id: 'staff_meals', title: { ar: 'وجبات الموظفين (مش بيع)', en: 'Staff meals (not sales)' }, rows: staffMeals.flatMap((o) => o.lines.map((l) => [l.name.ar, l.quantity, o.customerName ?? ''])) },
      ] };
    }
    case 'staff': {
      const servers = new Map<string, any>();
      for (const o of db.orders.filter((x) => branchIds.includes(x.branchId) && inRange(x.completedBusinessDate ?? x.businessDate, from, to) && x.kind === 'SALE')) {
        const s = servers.get(o.serverUserId) ?? { orders: 0, net: D(0), discounts: D(0), comps: 0, voids: 0 };
        if (o.status === 'COMPLETED') { s.orders++; s.net = s.net.plus(netOf(o)); s.discounts = s.discounts.plus(T(o).itemDiscount); if (T(o).comp) s.comps++; }
        s.voids += o.lines.filter((l) => l.status === 'VOIDED').length + (o.status === 'VOIDED' ? 1 : 0);
        servers.set(o.serverUserId, s);
      }
      const cashiers = new Map<string, any>();
      for (const c of caps) { const x = cashiers.get(c.by) ?? { captured: D(0), refunded: D(0), noSale: 0, variance: D(0) }; x.captured = x.captured.plus(c.amount); cashiers.set(c.by, x); }
      for (const s of db.sessions.filter((x) => branchIds.includes(x.branchId) && inRange(x.businessDate, from, to))) { const x = cashiers.get(s.userId) ?? { captured: D(0), refunded: D(0), noSale: 0, variance: D(0) }; x.noSale += db.cashEntries.filter((e) => e.sessionId === s.id && e.kind === 'NO_SALE').length; if (s.close) x.variance = x.variance.plus(s.close.variance); cashiers.set(s.userId, x); }
      for (const r of refunds) { const x = cashiers.get(r.decidedBy!) ?? { captured: D(0), refunded: D(0), noSale: 0, variance: D(0) }; x.refunded = x.refunded.plus(r.amount); cashiers.set(r.decidedBy!, x); }
      return { ...base, sections: [
        { id: 'servers', title: { ar: 'الويترز', en: 'Servers' }, columns: ['server', 'orders', 'net', 'aov', 'discounts', 'comps', 'voids'], rows: [...servers.entries()].map(([u, s]) => [userName(db, u), s.orders, m4(s.net), s.orders ? m4(s.net.dividedBy(s.orders)) : '0.0000', m4(s.discounts), s.comps, s.voids]) },
        { id: 'cashiers', title: { ar: 'الكاشيرية', en: 'Cashiers' }, columns: ['cashier', 'captured', 'refunded', 'no_sale_opens', 'variance'], rows: [...cashiers.entries()].map(([u, x]) => [userName(db, u), m4(x.captured), m4(x.refunded), x.noSale, m4(x.variance)]) },
      ] };
    }
    case 'exceptions': {
      const orders = db.orders.filter((o) => branchIds.includes(o.branchId) && inRange(o.businessDate, from, to));
      const voidLines = orders.flatMap((o) => o.lines.filter((l) => l.status === 'VOIDED' && l.voided?.disposition !== 'ORDER_VOID').map((l) => [o.number, l.name.ar, l.lineTotal, l.voided!.reasonCode, l.voided!.disposition, userName(db, l.voided!.approverId)]));
      const ends = orders.filter((o) => o.status === 'VOIDED' || o.status === 'CANCELLED').map((o) => [o.number, o.status, o.endReason?.code ?? '', o.endReason?.note ?? '']);
      const disc = orders.flatMap((o) => o.discounts.filter((d) => d.active).map((d) => [o.number, d.reasonCode, d.type, d.value, d.approvalGrantId ? '✓' : '—']));
      const comps = orders.filter((o) => o.comp).map((o) => [o.number, o.comp!.reasonCode, o.kind]);
      const moves = db.cashEntries.filter((e) => ['PAY_IN', 'PAY_OUT', 'SAFE_DROP', 'NO_SALE'].includes(e.kind) && inRange(bdOf(Date.parse(e.at)), from, to)).map((e) => [e.kind, e.amount, e.reasonCode ?? '', userName(db, e.by)]);
      const reprints = db.printJobs.filter((j) => j.copyKind === 'REPRINT').map((j) => [j.label, userName(db, j.createdBy), j.reason ?? '']);
      const grants = db.grants.filter((g) => g.consumedAt && inRange(bdOf(Date.parse(g.issuedAt)), from, to)).map((g) => [g.action, userName(db, g.requesterUserId), userName(db, g.approverUserId), g.targetId]);
      const drafts = db.orders.filter((o) => branchIds.includes(o.branchId) && o.status === 'DRAFT').map((o) => [o.number, Math.floor((ctx.now - o.createdAtMs) / 60000) + ' دقيقة']);
      return { ...base, sections: [
        { id: 'line_voids', title: { ar: 'أصناف اتلغت بعد الإرسال', en: 'Line voids' }, columns: ['check', 'item', 'amount', 'reason', 'disposition', 'approver'], rows: voidLines },
        { id: 'order_ends', title: { ar: 'شيكات اتلغت', en: 'Voids and cancels' }, rows: ends },
        { id: 'discounts', title: { ar: 'الخصومات حسب السبب', en: 'Discounts by reason' }, rows: disc },
        { id: 'comps', title: { ar: 'الضيافة', en: 'Comps' }, rows: comps },
        { id: 'refunds', title: { ar: 'المرتجعات حسب الوسيلة', en: 'Refunds by method' }, rows: refunds.map((r) => [db.orders.find((o) => o.id === r.orderId)?.number, r.method, r.amount, r.reasonCode]) },
        { id: 'cash_moves', title: { ar: 'حركات الدرج', en: 'Drawer and cash moves' }, rows: moves },
        { id: 'reprints', title: { ar: 'إعادة الطباعة', en: 'Reprints' }, rows: reprints },
        { id: 'approvals', title: { ar: 'الموافقات المستخدمة', en: 'Approvals used' }, rows: grants },
        { id: 'open_drafts', title: { ar: 'شيكات مسودة مفتوحة (عمرها)', en: 'Open drafts aging' }, rows: drafts },
      ] };
    }
    case 'shift': {
      const sessions = db.sessions.filter((s) => branchIds.includes(s.branchId) && inRange(s.businessDate, from, to));
      return { ...base, sections: [
        { id: 'drawers', title: { ar: 'أدراج اليوم', en: 'Drawers of the day' }, columns: ['terminal', 'cashier', 'state', 'expected_cash', 'counted', 'variance'], rows: sessions.map((s) => [db.terminals.find((t) => t.id === s.terminalId)?.code, userName(db, s.userId), s.state, s.close?.expectedCash ?? expectedCash(ctx, s.id), s.close?.countedCash ?? '—', s.close?.variance ?? '—']) },
        { id: 'tenders_per_drawer', title: { ar: 'وسائل الدفع لكل درج', en: 'Tenders per drawer' }, rows: sessions.flatMap((s) => { const by: Record<string, string> = {}; for (const c of db.captures.filter((x) => x.sessionId === s.id)) by[c.method] = add(by[c.method] ?? '0', c.amount); return Object.entries(by).map(([m, a]) => [db.terminals.find((t) => t.id === s.terminalId)?.code, userName(db, s.userId), m, a]); }) },
      ], note: { ar: 'تقرير Z بتاع الوردية هو المرجع.', en: 'The Z stays the shift authority.' } };
    }
    case 'peak_hours': {
      const hours = Array.from({ length: 24 }, (_, h) => ({ h, orders: 0, net: D(0), guests: 0 }));
      for (const o of completed) { const p = zonedParts(o.completedAtMs!, 'Africa/Cairo'); hours[p.hour].orders++; hours[p.hour].net = hours[p.hour].net.plus(netOf(o)); hours[p.hour].guests += o.guestCount ?? 0; }
      return { ...base, sections: [{ id: 'by_hour', title: { ar: 'حسب الساعة (توقيت الفرع)', en: 'By hour (branch local)' }, columns: ['hour', 'orders', 'net', 'guests'], rows: hours.filter((x) => x.orders).map((x) => [`${String(x.h).padStart(2, '0')}:00`, x.orders, m4(x.net), x.guests]) }] };
    }
    case 'branch_comparison': {
      return { ...base, sections: [{ id: 'branches', title: { ar: 'الفروع', en: 'Branches' }, columns: ['branch', 'orders', 'net', 'aov', 'net_collected'], rows: db.branches.filter((b) => branchIds.includes(b.id)).map((b) => { const os = completed.filter((o) => o.branchId === b.id); const net = sum(os.map(netOf)); const col = sum(caps.filter((c) => c.branchId === b.id).map((c) => c.amount)); return [b.code, os.length, net, os.length ? m4(D(net).dividedBy(os.length)) : '0.0000', col]; }) }] };
    }
  }
  throw new ApiError('REPORT_NOT_FOUND');
}

export const outputHandlers: Record<string, Handler> = {
  'Receipt.Get': (ctx) => receiptView(ctx, getOrder(ctx, ctx.params.orderId)),
  'Print.Reprint': (ctx) => {
    requireFields(ctx, 'documentType', 'documentId');
    const db = ctx.db;
    const prior = db.printJobs.filter((j) => j.documentId === ctx.body.documentId && j.documentType === ctx.body.documentType && j.copyKind === 'REPRINT').length;
    if (ctx.body.documentType === 'RECEIPT' || ctx.body.documentType === 'FISCAL_DOCUMENT') {
      ctx.requireApproval({ action: 'RECEIPT_REPRINT', targetType: 'printing.Document', targetId: ctx.body.documentId, context: { documentType: ctx.body.documentType, documentId: ctx.body.documentId, priorReprintCount: prior }, grantId: ctx.body.approvalGrantId });
    }
    const o = db.orders.find((x) => x.id === ctx.body.documentId);
    const j = enqueuePrint(db, { documentType: ctx.body.documentType, documentId: ctx.body.documentId, copyKind: 'REPRINT', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: `نسخة ${o?.number ?? ctx.body.documentId}`, reason: ctx.body.reasonCode });
    ctx.audit(`reprint ${ctx.body.documentType} ${ctx.body.documentId} (copy #${prior + 1})`, ctx.body.documentId, true);
    return { status: 201, body: j };
  },
  'Print.PreBill': (ctx) => {
    const o = getOrder(ctx, ctx.params.orderId);
    if (!(o.status === 'DRAFT' || o.status === 'CONFIRMED')) throw new ApiError('ORDER_NOT_EDITABLE');
    const j = enqueuePrint(ctx.db, { documentType: 'PRE_BILL', documentId: o.id, copyKind: 'ORIGINAL', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: `شيك مبدئي ${o.number}` });
    o.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'PRE_BILL', text: { ar: 'اتطبع شيك مبدئي (ليس فاتورة ضريبية) — الشيك ما اتغيرش', en: 'pre-bill printed' } });
    return { status: 201, body: j };
  },
  'Print.Document': (ctx) => {
    requireFields(ctx, 'documentType', 'documentId');
    const prior = ctx.db.printJobs.some((j) => j.documentId === ctx.body.documentId && j.documentType === ctx.body.documentType);
    const j = enqueuePrint(ctx.db, { documentType: ctx.body.documentType, documentId: ctx.body.documentId, copyKind: prior ? 'REPRINT' : 'ORIGINAL', terminalId: ctx.body.terminalId ?? ctx.terminal!.id, createdBy: ctx.user!.id, label: ctx.body.label ?? `${ctx.body.documentType} ${ctx.body.documentId}` });
    return { status: 201, body: j };
  },
  'PrintJob.Find': (ctx) => page(ctx.db.printJobs.filter((j) => (!ctx.query.state || ctx.query.state.split(',').includes(j.state)) && (!ctx.query.terminalId || j.terminalId === ctx.query.terminalId) && (!ctx.query.documentType || j.documentType === ctx.query.documentType)).map((j) => ({ ...j, terminalCode: ctx.db.terminals.find((t) => t.id === j.terminalId)?.code })), ctx.query),
  'PrintJob.Get': (ctx) => {
    const j = ctx.db.printJobs.find((x) => x.id === ctx.params.printJobId);
    need(j, 'PRINT_JOB_NOT_FOUND');
    return j;
  },
  'PrintJob.Retry': (ctx) => {
    const j = ctx.db.printJobs.find((x) => x.id === ctx.params.printJobId);
    need(j, 'PRINT_JOB_NOT_FOUND');
    if (j!.state !== 'FAILED' && j!.state !== 'DEAD') throw new ApiError('PRINT_JOB_NOT_RETRYABLE', { state: j!.state });
    j!.state = 'PENDING';
    j!.nextAtMs = ctx.now;
    (j as any).retryFrom = j!.attempts.length; // an operator retry starts a fresh backoff cycle (docs/30 silent; listed in gaps)
    return j; // the same job, the same copy — never a new copy
  },

  // ───────── e-receipt (compliance adapter EG_ETA)
  'Compliance.Find': (ctx) => {
    const items = ctx.db.fiscalDocuments.filter((d) => d.branchId === ctx.branchId && (!ctx.query.orderId || d.orderId === ctx.query.orderId) && (!ctx.query.submission || ctx.query.submission.split(',').includes(d.state)));
    return page(items.map((d) => ({ ...d, ageHours: Number(((ctx.now - d.createdAtMs) / 3_600_000).toFixed(1)), deadlineHours: 24, alert: d.state === 'ACCEPTED' || d.state === 'SUPERSEDED' ? null : (ctx.now - d.createdAtMs) / 3_600_000 >= 20 ? 'H20' : (ctx.now - d.createdAtMs) / 3_600_000 >= 12 ? 'H12' : null })), ctx.query);
  },
  'Compliance.Get': (ctx) => {
    const d = ctx.db.fiscalDocuments.find((x) => x.id === ctx.params.documentId);
    need(d, 'FISCAL_DOCUMENT_NOT_FOUND');
    return d;
  },
  'Compliance.IssueDocument': (ctx) => {
    const o = getOrder(ctx, ctx.body.orderId);
    need(o.status === 'COMPLETED', 'VALIDATION_FAILED', { rule: 'issued from the frozen snapshot at completion' });
    const d = issueFiscal(ctx.db, o);
    need(d, 'CAPABILITY_NOT_AVAILABLE', { reason: 'FiscalDocumentPolicy OFF' });
    return d;
  },
  'Compliance.ReissueDocument': (ctx) => {
    requireFields(ctx, 'reason');
    const d = ctx.db.fiscalDocuments.find((x) => x.id === ctx.params.documentId && x.branchId === ctx.branchId);
    need(d, 'FISCAL_DOCUMENT_NOT_FOUND');
    if (d!.state === 'PENDING_DATA') {
      buildFiscal(ctx.db, d!);
      d!.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'REBUILD', text: `إعادة بناء بعد تصحيح البيانات: ${ctx.body.reason}` });
      queueMicrotask(() => runOutbox());
      return { document: d, result: d!.state === 'PENDING_DATA' ? 'STILL_PENDING_DATA' : 'BUILT' };
    }
    if (d!.state === 'REJECTED') {
      const o = ctx.db.orders.find((x) => x.id === d!.orderId)!;
      d!.state = 'SUPERSEDED';
      const n = issueFiscal(ctx.db, o, d!);
      d!.history.push({ at: ctx.nowIso, by: ctx.user!.id, kind: 'SUPERSEDED', text: `اتصحح بإيصال جديد ${n?.id}: ${ctx.body.reason}` });
      return { document: n, supersedes: d!.id, referenceOldUUID: d!.uuid };
    }
    throw new ApiError('VALIDATION_FAILED', { rule: 'only PENDING_DATA (rebuild) or REJECTED (correct) can be reissued', state: d!.state });
  },
  'Compliance.VerifyChain': (ctx) => {
    const out = ctx.db.fiscalDevices.map((dev) => {
      const docs = ctx.db.fiscalDocuments.filter((d) => d.deviceId === dev.id && d.sequence !== null).sort((a, b) => a.sequence! - b.sequence!);
      let ok = true; let prev: string | null = null;
      for (const d of docs) { if (d.previousUUID !== prev) ok = false; prev = d.uuid; }
      return { deviceId: dev.id, documents: docs.length, ok, head: dev.lastDocumentHash };
    });
    return { devices: out, ok: out.every((x) => x.ok) };
  },
  'FiscalSetup.Get': (ctx) => ({ profiles: ctx.db.fiscalProfiles, devices: ctx.db.fiscalDevices.map((d) => ({ ...d, terminalCode: ctx.db.terminals.find((t) => t.id === d.terminalId)?.code })), mappings: ctx.db.itemMappings }),
  'FiscalProfile.Configure': (ctx) => {
    requireFields(ctx, 'issuerId', 'issuerName', 'issuerBranchCode', 'activityCode', 'receiptType', 'address');
    need(ctx.db.branches.some((b) => b.id === ctx.params.branchId), 'ORGANIZATION_BRANCH_NOT_FOUND');
    const p = ctx.db.fiscalProfiles.find((x) => x.branchId === ctx.params.branchId);
    if (p && ctx.body.expectedVersion !== undefined && Number(ctx.body.expectedVersion) !== p.version) throw new ApiError('CONCURRENCY_CONFLICT');
    const data = { branchId: ctx.params.branchId, adapter: 'EG_ETA' as const, issuerId: ctx.body.issuerId, issuerName: ctx.body.issuerName, issuerBranchCode: ctx.body.issuerBranchCode, activityCode: ctx.body.activityCode, receiptType: ctx.body.receiptType, address: ctx.body.address, version: (p?.version ?? 0) + 1 };
    if (p) Object.assign(p, data); else ctx.db.fiscalProfiles.push(data);
    return { ok: true, profile: data };
  },
  'FiscalDevice.Register': (ctx) => {
    requireFields(ctx, 'terminalId', 'deviceSerial', 'credentialRef');
    need(ctx.db.terminals.some((t) => t.id === ctx.body.terminalId), 'ORGANIZATION_TERMINAL_NOT_FOUND');
    need(!ctx.db.fiscalDevices.some((d) => d.terminalId === ctx.body.terminalId && d.state === 'ACTIVE'), 'VALIDATION_FAILED', { rule: 'one active device per terminal' });
    need(/^secret:\/\//.test(ctx.body.credentialRef), 'VALIDATION_FAILED', { field: 'credentialRef', rule: 'names a secret (secret://...), never the secret itself' });
    const d = { id: nextId('fd'), terminalId: ctx.body.terminalId, adapter: 'EG_ETA' as const, deviceSerial: ctx.body.deviceSerial, credentialRef: ctx.body.credentialRef, state: 'ACTIVE' as const, lastSequence: 0, lastDocumentHash: null, version: 1 };
    ctx.db.fiscalDevices.push(d);
    return { ok: true, device: d };
  },
  'FiscalDevice.SetState': (ctx) => {
    const d = ctx.db.fiscalDevices.find((x) => x.id === ctx.params.deviceId);
    need(d, 'VALIDATION_FAILED', { reason: 'device not found' });
    d!.state = ctx.body.state === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    d!.version++;
    return { ok: true, device: d };
  },
  'FiscalItemMapping.SetMany': (ctx) => {
    const rows = ctx.body.rows ?? [];
    for (const r of rows) {
      need(ctx.db.products.some((p) => p.id === r.productId), 'CATALOG_PRODUCT_NOT_FOUND', { productId: r.productId });
      need(/^[A-Z0-9-]{4,40}$/i.test(r.itemCode ?? ''), 'VALIDATION_FAILED', { productId: r.productId, field: 'itemCode' });
    }
    for (const r of rows) {
      const m = ctx.db.itemMappings.find((x) => x.productId === r.productId);
      const data = { productId: r.productId, codeType: r.codeType ?? 'EGS', itemCode: r.itemCode, unitType: r.unitType ?? 'EA' };
      if (m) Object.assign(m, data); else ctx.db.itemMappings.push(data);
    }
    return { ok: true, count: rows.length };
  },

  // ───────── reports
  'Report.List': (ctx) => ({ items: REPORTS.filter((r) => ctx.can(r.permission)) }),
  'Report.Run': (ctx) => {
    const def = REPORTS.find((r) => r.id === ctx.params.reportId);
    if (!def || !ctx.can(def.permission)) throw new ApiError('REPORT_NOT_FOUND');
    const from = ctx.query.fromBusinessDate;
    need(from && /^\d{4}-\d{2}-\d{2}$/.test(from), 'VALIDATION_FAILED', { field: 'fromBusinessDate' });
    const to = def.period === 'DAY' ? from : (ctx.query.toBusinessDate ?? from);
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 93) throw new ApiError('VALIDATION_FAILED', { rule: 'a range is at most 93 days' });
    const branchIds = ctx.query.branchIds ? ctx.query.branchIds.split(',') : [ctx.branchId!];
    return { title: def.title, ...runReport(ctx, def.id, from, to, branchIds) };
  },
  'Report.AccountantExport': (ctx) => {
    const from = ctx.query.fromBusinessDate ?? ctx.businessDate();
    const to = ctx.query.toBusinessDate ?? from;
    const r = runReport(ctx, 'daily_sales', from, to, [ctx.branchId!]);
    const t = runReport(ctx, 'tenders', from, to, [ctx.branchId!]);
    const lines = ['section,metric,value', ...(r as any).sections[0].rows.map((x: any[]) => `summary,${x[0]},${x[1]}`), ...(t as any).sections[0].rows.map((x: any[]) => `tenders,${x[0]},${x[3]}`)];
    return { filename: `nerdpos-${ctx.db.branches.find((b) => b.id === ctx.branchId)?.code}-${from}_${to}.csv`, csv: lines.join('\n') };
  },
};

export type { DB };
