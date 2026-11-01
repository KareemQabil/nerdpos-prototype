// Legacy operator reports (doc 27, 8 reports) moved here from src/mock/handlers/output.ts unchanged, so the existing
// report ids keep their shapes for Home, the journeys and the smoke test. The certified engine versions live in
// manifests.ts; the parity check "legacy daily_sales net = engine item net" is run by the engine test.
import { ApiError } from '../mock/errors';
import type { Ctx } from '../mock/kernel';
import { computeTotals } from '../mock/pricing';
import { D, m4, add } from '../mock/money';
import { zonedParts, businessDate as bdOf } from '../mock/clock';
import { settlementOf, userName } from '../mock/handlers/util';
import { expectedCash } from '../mock/handlers/money';
import type { Order } from '../mock/types';

export const LEGACY_REPORTS = [
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

export function runLegacyReport(ctx: Ctx, id: string, from: string, to: string, branchIds: string[]) {
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

