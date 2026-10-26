// Operations & system area: capabilities, remote approval requests, check handover between drawer sessions,
// end of business day, offline sync (bootstrap / changes / replay / conflicts), outbox health and redrive,
// reconciliation, report export and schedules, and the background work these need (webhooks, schedules, alerts).
import { ApiError } from '../errors';
import type { Handler, Ctx } from '../kernel';
import { effectivePermission, hashOf, permsOf } from '../kernel';
import { nextId, event, hist } from '../store';
import { policy, approvalRule, ruleRequires, selfApprovalAllowed } from '../policies';
import { APPROVAL_ACTIONS } from '../policyRegistry';
import { opsById } from '../contracts';
import { sim } from '../sim';
import { clock, businessDate as bdOf } from '../clock';
import { computeTotals } from '../pricing';
import { buildFiscal } from '../outbox';
import { D, m4 } from '../money';
import { checkVersion, need, page, requireBranch, userName } from './util';
import { handlers } from './index';
import { outputHandlers } from './output';
import { CAPABILITIES, capabilityOn, blockingCapability, OFFLINE_ALLOWLIST } from '../ops-registry';
import { nextRun } from '../seed-ops';
import { deviceName } from '../../demo/people';
import type { DB, Order, ApprovalGrant } from '../types';
import type { ApprovalRequestRec, BusinessDaySummary, OfflineItem, ReconResult, ReportSchedule, WebhookDelivery, CapabilityState } from '../types-ops';

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const sumM = (xs: (string | number)[]) => m4(xs.reduce<any>((a, x) => a.plus(D(x)), D(0)));
const OPEN = (o: Order) => o.status === 'DRAFT' || o.status === 'CONFIRMED';

/** Wrap every handler: an operation whose capability is switched off answers CAPABILITY_NOT_AVAILABLE. */
export function gateByCapability(map: Record<string, Handler>): Record<string, Handler> {
  const out: Record<string, Handler> = {};
  for (const [id, h] of Object.entries(map)) {
    out[id] = (ctx) => {
      const c = blockingCapability(ctx.db, ctx.op, ctx.branchId);
      if (c) throw new ApiError('CAPABILITY_NOT_AVAILABLE', { capability: c.id, capabilityTitle: c.title, reason: 'switched off' });
      return h(ctx);
    };
  }
  return out;
}

// ───────── approval requests (remote approval)
const REQUEST_TTL_MS = 10 * 60_000;
function expireRequests(db: DB, now: number) {
  let changed = false;
  for (const r of db.approvalRequests ?? []) if (r.state === 'PENDING' && r.expiresAtMs <= now) { r.state = 'EXPIRED'; r.version++; changed = true; }
  return changed;
}
function requestView(ctx: Ctx, r: ApprovalRequestRec) {
  const def = APPROVAL_ACTIONS.find((a) => a.id === r.action);
  const term = ctx.db.terminals.find((t) => t.id === r.terminalId);
  return { ...r, requesterName: userName(ctx.db, r.requesterUserId), decidedByName: r.decidedBy ? userName(ctx.db, r.decidedBy) : null, terminalCode: term?.code ?? null, terminalName: term?.name ?? null, minutesWaiting: Math.floor((ctx.now - r.createdAtMs) / 60000), secondsLeft: Math.max(0, Math.floor((r.expiresAtMs - ctx.now) / 1000)), permission: def?.permission ?? null };
}
function canApprove(ctx: Ctx, r: ApprovalRequestRec) {
  const def = APPROVAL_ACTIONS.find((a) => a.id === r.action);
  return !!def && ctx.can(def.permission) && (r.requesterUserId !== ctx.user?.id || selfApprovalAllowed(r.action)) && (!r.branchId || r.branchId === ctx.branchId || ctx.can('*'));
}
function summaryOf(ctx: Ctx, action: string, context: Record<string, unknown>, targetId: string) {
  const o = ctx.db.orders.find((x) => x.id === (context.orderId ?? targetId));
  const amt = (context.amount ?? context.lineAmount ?? context.payable ?? context.absVariance) as string | undefined;
  const where = o ? (o.tableId ? `ترابيزة ${ctx.db.tables.find((t) => t.id === o.tableId)?.name} · شيك #${o.number}` : `شيك #${o.number}`) : '';
  const money = amt ? ` · ${Number(amt).toFixed(2)} ج.م` : '';
  const pct = context.discountPercent ? ` · ${context.discountPercent}%` : '';
  return { ar: `${where}${money}${pct}`.replace(/^ · /, ''), en: `${o ? '#' + o.number : targetId}${amt ? ' · ' + amt : ''}` };
}

// ───────── business day
function daySummary(db: DB, branchId: string, date: string): BusinessDaySummary {
  const sales = db.orders.filter((o) => o.branchId === branchId && o.status === 'COMPLETED' && o.kind === 'SALE' && o.completedBusinessDate === date);
  const totals = sales.map((o) => ({ o, t: computeTotals(o) }));
  const caps = db.captures.filter((c) => c.branchId === branchId && c.businessDate === date);
  const payments: Record<string, string> = {};
  for (const c of caps) { const k = c.method === 'DIGITAL_WALLET' && c.walletProvider ? `DIGITAL_WALLET:${c.walletProvider}` : c.method; payments[k] = m4(D(payments[k] ?? 0).plus(D(c.amount))); }
  const refunds = db.refunds.filter((r) => r.state === 'PAID' && r.businessDate === date && db.orders.find((o) => o.id === r.orderId)?.branchId === branchId);
  const dayOrders = db.orders.filter((o) => o.branchId === branchId && o.businessDate === date);
  const voided = dayOrders.flatMap((o) => o.lines.filter((l) => l.status === 'VOIDED'));
  const sessions = db.sessions.filter((s) => s.branchId === branchId && s.businessDate === date);
  const guests = totals.reduce((a, x) => a + (x.o.guestCount ?? db.visits.find((v) => v.id === x.o.visitId)?.guestCount ?? 1), 0);
  const net = sumM(totals.map((x) => x.t.netSales));
  return {
    orders: sales.length, guests, netSales: net, payable: sumM(totals.map((x) => x.t.payable)), tax: sumM(totals.map((x) => x.t.tax)), service: sumM(totals.map((x) => D(x.t.serviceCharge).minus(D(x.t.serviceDiscount)).toString())),
    avgCheck: sales.length ? m4(D(net).dividedBy(sales.length)) : m4(0), payments, refunds: sumM(refunds.map((r) => r.amount)), refundCount: refunds.length,
    discounts: sumM(totals.filter((x) => !x.t.comp).map((x) => x.t.discountTotal)), discountCount: totals.filter((x) => !x.t.comp && D(x.t.discountTotal).gt(0)).length, comps: totals.filter((x) => x.t.comp).length,
    voidedLines: voided.length, voidedAmount: sumM(voided.map((l) => l.lineTotal)), cancelledOrders: dayOrders.filter((o) => o.status === 'CANCELLED').length, voidedOrders: dayOrders.filter((o) => o.status === 'VOIDED').length,
    cashVariance: sumM(sessions.filter((s) => s.close).map((s) => s.close!.variance)), tips: sumM(db.tips.filter((t) => t.businessDate === date && db.orders.find((o) => o.id === t.orderId)?.branchId === branchId).map((t) => t.amount)), sessions: sessions.length,
  };
}

type Check = { id: string; level: 'BLOCKER' | 'WARNING' | 'OK'; title: { ar: string; en: string }; detail: { ar: string; en: string }; count: number; items: { id: string; label: string; sub?: string; amount?: string }[]; screen?: string };
function readiness(ctx: Ctx, branchId: string, date: string) {
  const db = ctx.db;
  const br = db.branches.find((b) => b.id === branchId);
  const current = bdOf(ctx.now, br?.timezone ?? 'Africa/Cairo', br?.businessDayCutoff ?? '04:00');
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'level'> & { level?: Check['level'] }, bad: 'BLOCKER' | 'WARNING') => checks.push({ ...c, level: c.count ? bad : 'OK' } as Check);
  if (date > current) checks.push({ id: 'NOT_STARTED', level: 'BLOCKER', title: { ar: 'اليوم ده لسه ما بدأش', en: 'This day has not started' }, detail: { ar: `اليوم التجاري الحالي ${current}`, en: `current business day is ${current}` }, count: 1, items: [] });
  const sessions = db.sessions.filter((s) => s.branchId === branchId && s.state === 'OPEN' && s.businessDate <= date);
  add({ id: 'OPEN_SESSIONS', title: { ar: 'أدراج لسه مفتوحة', en: 'Open drawers' }, detail: { ar: 'كل كاشير يقفل ورديته ويعد الدرج الأول', en: 'each cashier closes the shift and counts the drawer' }, count: sessions.length, screen: 'shift',
    items: sessions.map((s) => ({ id: s.id, label: `${deviceName(s.terminalId)} · ${userName(db, s.userId)}`, sub: `من ${new Date(s.openedAt).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' })}` })) }, 'BLOCKER');
  const open = db.orders.filter((o) => o.branchId === branchId && OPEN(o) && o.businessDate <= date);
  add({ id: 'OPEN_CHECKS', title: { ar: 'شيكات مفتوحة', en: 'Open checks' }, detail: { ar: 'اتحصلت أو اتلغت أو اتنقلت قبل القفل', en: 'pay, cancel or move them before closing' }, count: open.length, screen: 'checks',
    items: open.map((o) => ({ id: o.id, label: `#${o.number}${o.tableId ? ' · ترابيزة ' + (db.tables.find((t) => t.id === o.tableId)?.name ?? '') : o.channel === 'TAKEAWAY' ? ' · تيك أواي' : o.channel === 'DELIVERY' ? ' · دليفري' : ''}`, sub: userName(db, o.serverUserId), amount: computeTotals(o).payable })) }, 'BLOCKER');
  const deliveries = ((db as any).deliveries ?? []).filter((d: any) => d.branchId === branchId && !['DELIVERED', 'CANCELLED', 'COMPLETED', 'FAILED'].includes(d.state));
  add({ id: 'PENDING_DELIVERIES', title: { ar: 'طلبات دليفري لسه في الطريق', en: 'Deliveries still out' }, detail: { ar: 'استنى الطيار يرجع ويسلّم الفلوس', en: 'wait for drivers to return' }, count: deliveries.length, screen: 'delivery', items: deliveries.slice(0, 10).map((d: any) => ({ id: d.id, label: d.orderNumber ? `#${d.orderNumber}` : d.id, sub: d.state })) }, 'WARNING');
  const tickets = db.tickets.filter((t) => t.state !== 'DONE' && db.stations.find((s) => s.id === t.stationId)?.branchId === branchId && !(db.ticketMeta ?? []).some((m) => m.ticketId === t.id && m.transferredFrom === 'MERGED'));
  add({ id: 'KITCHEN', title: { ar: 'تذاكر لسه على شاشة المطبخ', en: 'Tickets still on the kitchen screen' }, detail: { ar: 'المطبخ يسلّمها أو يقفلها', en: 'kitchen should bump them' }, count: tickets.length, screen: 'kitchen', items: tickets.slice(0, 10).map((t) => ({ id: t.id, label: `#${t.orderNumber} · جولة ${t.round}`, sub: db.stations.find((s) => s.id === t.stationId)?.name })) }, 'WARNING');
  const kd = db.kitchenDeliveries.filter((d) => d.state === 'FAILED' && db.orders.find((o) => o.id === d.orderId)?.branchId === branchId);
  add({ id: 'KITCHEN_FAILED', title: { ar: 'طلبات ما وصلتش المطبخ', en: 'Kitchen sends that failed' }, detail: { ar: 'من "صحة النظام" ابعتها تاني', en: 'redrive from System health' }, count: kd.length, screen: 'health', items: kd.map((d) => ({ id: d.id, label: `#${db.orders.find((o) => o.id === d.orderId)?.number} · جولة ${d.round}` })) }, 'WARNING');
  const prints = db.printJobs.filter((j) => (j.state === 'FAILED' || j.state === 'DEAD') && db.terminals.find((t) => t.id === j.terminalId)?.branchId === branchId);
  add({ id: 'FAILED_PRINTS', title: { ar: 'طباعة فشلت', en: 'Failed prints' }, detail: { ar: 'راجع الطابعة وابعتها تاني', en: 'check the printer and retry' }, count: prints.length, screen: 'prints', items: prints.slice(0, 10).map((j) => ({ id: j.id, label: j.label, sub: j.state === 'DEAD' ? 'وقفت خالص' : 'بتتعاد' })) }, 'WARNING');
  const docs = db.fiscalDocuments.filter((d) => d.branchId === branchId && !['ACCEPTED', 'SUPERSEDED'].includes(d.state) && (db.orders.find((o) => o.id === d.orderId)?.completedBusinessDate ?? '') <= date);
  add({ id: 'ERECEIPTS', title: { ar: 'إيصالات إلكترونية لسه ما اتقبلتش', en: 'E-receipts not accepted yet' }, detail: { ar: 'آخر ميعاد 24 ساعة من البيع', en: '24 hour deadline' }, count: docs.length, screen: 'ereceipts', items: docs.slice(0, 10).map((d) => ({ id: d.id, label: `#${d.orderNumber}`, sub: d.state === 'PENDING_DATA' ? 'بيانات ناقصة' : d.state === 'REJECTED' ? 'اترفض' : 'مستني المنصة', amount: d.total })) }, 'WARNING');
  const refunds = db.refunds.filter((r) => (r.state === 'REQUESTED' || r.state === 'APPROVED') && db.orders.find((o) => o.id === r.orderId)?.branchId === branchId);
  add({ id: 'REFUNDS', title: { ar: 'مرتجعات لسه ما اتصرفتش', en: 'Refunds not paid out' }, detail: { ar: 'اعتمدها واصرفها أو ارفضها', en: 'approve and pay, or reject' }, count: refunds.length, screen: 'refunds', items: refunds.map((r) => ({ id: r.id, label: `#${db.orders.find((o) => o.id === r.orderId)?.number}`, sub: r.state === 'REQUESTED' ? 'مستني اعتماد' : 'مستني الصرف', amount: r.amount })) }, 'WARNING');
  const reqs = (db.approvalRequests ?? []).filter((r) => r.state === 'PENDING' && r.branchId === branchId);
  add({ id: 'APPROVALS', title: { ar: 'طلبات موافقة مستنية', en: 'Approval requests waiting' }, detail: { ar: 'وافق أو ارفض من صندوق الموافقات', en: 'decide them in the inbox' }, count: reqs.length, screen: 'approvals-inbox', items: reqs.map((r) => ({ id: r.id, label: r.actionTitle, sub: userName(db, r.requesterUserId) })) }, 'WARNING');
  const conflicts = (db.offlineItems ?? []).filter((x) => x.state === 'CONFLICT' && db.terminals.find((t) => t.id === x.terminalId)?.branchId === branchId);
  add({ id: 'OFFLINE', title: { ar: 'عمليات أوفلاين محتاجة قرار', en: 'Offline items needing a decision' }, detail: { ar: 'من شاشة المزامنة', en: 'from the Sync screen' }, count: conflicts.length, screen: 'sync', items: conflicts.map((x) => ({ id: x.offlineCommandId, label: x.label, sub: deviceName(x.terminalId) })) }, 'WARNING');
  const recon = (db.reconResults ?? []).filter((r) => r.status === 'UNEXPLAINED_DIFFERENCE' && r.businessDate <= date && (db.reconRuns ?? []).find((x) => x.id === r.runId)?.branchId === branchId);
  add({ id: 'RECON', title: { ar: 'فروقات مطابقة من غير تفسير', en: 'Unexplained reconciliation differences' }, detail: { ar: 'اكتب سبب كل فرق من شاشة المطابقة', en: 'explain them in Reconciliation' }, count: recon.length, screen: 'reconciliation', items: recon.map((r) => ({ id: r.id, label: r.title.ar, amount: r.difference })) }, 'WARNING');
  if (date === current) checks.push({ id: 'CUTOFF', level: 'WARNING', title: { ar: 'اليوم التجاري لسه شغال لحد 4 الفجر', en: 'The business day runs until 04:00' }, detail: { ar: 'أي بيع بعد القفل وقبل 4 الفجر هيتسجل على اليوم ده ويظهر "بعد القفل" في الملخص', en: 'sales after closing and before 04:00 still belong to this day and show as late' }, count: 1, items: [] });
  const closed = (db.businessDays ?? []).find((d) => d.branchId === branchId && d.date === date) ?? null;
  return { date, branchId, branchName: br?.name, currentBusinessDate: current, cutoff: br?.businessDayCutoff ?? '04:00', timezone: br?.timezone ?? 'Africa/Cairo', closed: closed ? dayView(ctx, closed) : null, checks, blockers: checks.filter((c) => c.level === 'BLOCKER').length, warnings: checks.filter((c) => c.level === 'WARNING').length, summary: daySummary(db, branchId, date), nextBusinessDate: addDays(date, 1) };
}
function dayView(ctx: Ctx, d: NonNullable<DB['businessDays']>[number]) {
  const late = ctx.db.orders.filter((o) => o.branchId === d.branchId && o.completedBusinessDate === d.date && (o.completedAtMs ?? 0) > Date.parse(d.closedAt)).length;
  return { ...d, closedByName: userName(ctx.db, d.closedBy), lateOrders: late };
}

// ───────── offline sync
const CONFLICT_KIND: Record<string, string> = { PRODUCT_UNAVAILABLE: 'SOLD_OUT', CONCURRENCY_CONFLICT: 'CHANGED_ELSEWHERE', ORDER_NOT_EDITABLE: 'CHECK_CLOSED', TABLE_VISIT_CLOSED: 'CHECK_CLOSED', APPROVAL_REQUIRED: 'NEEDS_MANAGER', TABLE_OCCUPIED: 'TABLE_TAKEN', SESSION_NOT_OPEN: 'SHIFT_CLOSED', PRICE_NOT_FOUND: 'NO_PRICE', KITCHEN_TRANSITION_INVALID: 'CHANGED_ELSEWHERE', OVERPAYMENT: 'ALREADY_PAID', ORDER_ALREADY_SETTLED: 'ALREADY_PAID' };
function restoreInPlace(db: DB, snap: DB) {
  for (const k of Object.keys(db)) delete (db as any)[k];
  Object.assign(db, snap);
}
/** Run one recorded command inside the replay transaction. Writes are undone if it is refused. */
function runOffline(ctx: Ctx, item: { offlineCommandId: string; operation: string; params: Record<string, string>; body: any }): { ok: true; body: unknown } | { ok: false; code: string; details: any } {
  const op = opsById.get(item.operation);
  if (!op || !OFFLINE_ALLOWLIST[item.operation]) return { ok: false, code: 'OFFLINE_COMMAND_NOT_ALLOWED', details: { operation: item.operation } };
  const req = effectivePermission(op);
  if (req !== 'AUTHENTICATED' && req !== 'PUBLIC' && !ctx.can(req)) return { ok: false, code: 'PERMISSION_DENIED', details: { required: req } };
  const off = policy<{ cashOnly: boolean }>('OfflineModePolicy', { branchId: ctx.branchId }) ?? { cashOnly: true };
  if (item.operation === 'Payment.Capture' && off.cashOnly && (item.body?.tenders ?? []).some((t: any) => t.method !== 'CASH')) return { ok: false, code: 'OFFLINE_COMMAND_NOT_ALLOWED', details: { rule: 'offline payments are cash only' } };
  const h = handlers[item.operation];
  if (!h) return { ok: false, code: 'CAPABILITY_NOT_AVAILABLE', details: {} };
  const snap = structuredClone(ctx.db);
  const child: Ctx = { ...ctx, op, params: item.params ?? {}, body: item.body ?? {}, commandId: item.offlineCommandId };
  try {
    const out = h(child) as any;
    const body = out && typeof out === 'object' && typeof out.status === 'number' && Object.keys(out).every((k) => ['status', 'body', 'headers'].includes(k)) ? out.body : out;
    ctx.db.idem[item.offlineCommandId] = { opId: item.operation, hash: hashOf({ op: item.operation, params: item.params ?? {}, body: item.body ?? {} }), status: 200, body: body ?? null, at: ctx.nowIso, userId: ctx.user?.id ?? null };
    return { ok: true, body };
  } catch (e: any) {
    restoreInPlace(ctx.db, snap);
    if (e instanceof ApiError) return { ok: false, code: e.code, details: e.details ?? null };
    return { ok: false, code: 'INTERNAL_ERROR', details: { message: String(e?.message ?? e) } };
  }
}
function offlineView(ctx: Ctx, x: OfflineItem) {
  const pid = x.errorDetails?.productId as string | undefined;
  return { ...x, userName: userName(ctx.db, x.userId), operationTitle: OFFLINE_ALLOWLIST[x.operation] ?? { ar: x.operation, en: x.operation }, problemItem: pid ? ctx.db.products.find((p) => p.id === pid)?.name ?? null : null };
}
const REFERENCE_OPS: [RegExp, { ar: string; en: string }][] = [
  [/^(Catalog\.SetPrice|Product\.PriceHistory)/, { ar: 'الأسعار', en: 'Prices' }],
  [/^Product\.SetAvailability/, { ar: 'الأصناف المتاحة', en: 'Availability' }],
  [/^(Product|Category|ModifierGroup|ModifierOption|Catalog\.Import)/, { ar: 'المنيو', en: 'Menu' }],
  [/^(Settings\.UpdatePolicy|Profile\.SetCapability)/, { ar: 'الإعدادات', en: 'Settings' }],
  [/^ReasonCode/, { ar: 'الأسباب', en: 'Reasons' }],
  [/^(Table\.|Floor\.)/, { ar: 'الترابيزات', en: 'Tables' }],
  [/^(TaxPolicy)/, { ar: 'الضرايب', en: 'Taxes' }],
  [/^(Promotion)/, { ar: 'العروض', en: 'Promotions' }],
];
const auditSeq = (id: string) => Number(id.split('_').pop()) || 0;

// ───────── outbox (consumer deliveries)
type DeliveryView = { id: string; consumerId: string; consumerName: { ar: string; en: string }; event: { type: string; label: string; ref: string }; state: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD'; attempts: number; lastError: string | null; lastErrorText: { ar: string; en: string } | null; createdAt: string; lastAttemptAt: string | null; nextAttemptAt: string | null; version: number; history: { at: string; error: string | null }[] };
const ERROR_TEXT: Record<string, { ar: string; en: string }> = {
  KDS_DOWN: { ar: 'شاشة المطبخ مش واصلة — الطلب مستني يتبعت', en: 'Kitchen screen unreachable' },
  PRINTER_UNREACHABLE: { ar: 'الطابعة مش بترد (مقفولة أو الكابل مفصول)', en: 'Printer not responding' },
  PAPER_OUT: { ar: 'ورق الطابعة خلص', en: 'Printer out of paper' },
  ETA_DOWN: { ar: 'منصة الإيصال الإلكتروني مش متاحة دلوقتي', en: 'E-receipt platform unavailable' },
  ETA_REJECTED: { ar: 'منصة الضرايب رفضت الإيصال (كود صنف غلط)', en: 'Tax platform rejected the receipt' },
  PENDING_DATA: { ar: 'بيانات ناقصة قبل الإرسال (كود صنف أو جهاز ضريبي)', en: 'Missing data before sending' },
  WEBHOOK_401: { ar: 'البرنامج التاني رفض الدخول — مفتاح الربط محتاج يتجدد', en: 'The other system refused the key' },
  WEBHOOK_TIMEOUT: { ar: 'البرنامج التاني ما ردش في الوقت', en: 'The other system timed out' },
  WEBHOOK_DOWN: { ar: 'البرنامج التاني واقع', en: 'The other system is down' },
};
const errText = (code: string | null) => (code ? ERROR_TEXT[code] ?? { ar: 'حصلت مشكلة في الإرسال', en: code } : null);
function deliveries(db: DB, branchId: string | null): DeliveryView[] {
  const out: DeliveryView[] = [];
  const kdsErr = (e: string | null) => (e ? 'KDS_DOWN' : null);
  for (const d of db.kitchenDeliveries) {
    const o = db.orders.find((x) => x.id === d.orderId);
    if (branchId && o?.branchId !== branchId) continue;
    out.push({ id: `kitchen:${d.id}`, consumerId: 'kitchen', consumerName: { ar: 'المطبخ', en: 'Kitchen' }, event: { type: 'OrderFired', label: `#${o?.number ?? ''} · جولة ${d.round}`, ref: d.orderId }, state: d.state === 'FAILED' ? (d.attempts >= 5 ? 'DEAD' : 'FAILED') : d.state === 'DELIVERED' ? 'DELIVERED' : 'PENDING', attempts: d.attempts, lastError: kdsErr(d.lastError), lastErrorText: errText(kdsErr(d.lastError)), createdAt: d.createdAt, lastAttemptAt: d.deliveredAt, nextAttemptAt: null, version: d.attempts * 10 + (d.state === 'DELIVERED' ? 1 : d.state === 'FAILED' ? 2 : 0), history: [] });
  }
  for (const j of db.printJobs) {
    if (branchId && db.terminals.find((t) => t.id === j.terminalId)?.branchId !== branchId) continue;
    const last = j.attempts.at(-1) ?? null;
    out.push({ id: `printing:${j.id}`, consumerId: 'printing', consumerName: { ar: 'الطباعة', en: 'Printing' }, event: { type: j.documentType, label: j.label, ref: j.documentId }, state: j.state === 'SUCCEEDED' ? 'DELIVERED' : j.state, attempts: j.attempts.length, lastError: last?.error ?? null, lastErrorText: errText(last?.error ?? null), createdAt: j.createdAt, lastAttemptAt: last?.at ?? null, nextAttemptAt: j.state === 'FAILED' ? new Date(j.nextAtMs).toISOString() : null, version: j.attempts.length * 10 + ['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'].indexOf(j.state), history: j.attempts });
  }
  for (const f of db.fiscalDocuments) {
    if (branchId && f.branchId !== branchId) continue;
    const code = f.state === 'PENDING_DATA' ? 'PENDING_DATA' : f.state === 'REJECTED' ? 'ETA_REJECTED' : f.nextTryAtMs && f.nextTryAtMs > clock.now() ? 'ETA_DOWN' : null;
    out.push({ id: `ereceipt:${f.id}`, consumerId: 'ereceipt', consumerName: { ar: 'الإيصال الإلكتروني', en: 'E-receipt' }, event: { type: f.documentType, label: `إيصال #${f.orderNumber}`, ref: f.orderId }, state: f.state === 'ACCEPTED' || f.state === 'SUPERSEDED' ? 'DELIVERED' : f.state === 'REJECTED' ? 'DEAD' : code ? 'FAILED' : 'PENDING', attempts: f.attempts, lastError: code, lastErrorText: errText(code), createdAt: f.createdAt, lastAttemptAt: f.submittedAt, nextAttemptAt: f.nextTryAtMs ? new Date(f.nextTryAtMs).toISOString() : null, version: f.attempts * 10 + ['PENDING_DATA', 'BUILT', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'].indexOf(f.state), history: f.history.map((h) => ({ at: h.at, error: typeof h.text === 'string' ? h.text : h.text.ar })) });
  }
  for (const w of db.webhookDeliveries ?? []) {
    const last = w.attempts.at(-1) ?? null;
    out.push({ id: `webhook:${w.id}`, consumerId: `webhook:${w.consumerId}`, consumerName: w.consumerName, event: { type: w.eventType, label: w.label, ref: w.ref }, state: w.state, attempts: w.attempts.length, lastError: last?.error ?? null, lastErrorText: errText(last?.error ?? null), createdAt: w.createdAt, lastAttemptAt: last?.at ?? null, nextAttemptAt: w.state === 'FAILED' ? new Date(w.nextAtMs).toISOString() : null, version: w.version, history: w.attempts });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ───────── reconciliation
const RECON_RULES = [
  { id: 'DRAWER_CASH', title: { ar: 'كاش الأدراج', en: 'Drawer cash' }, description: { ar: 'الكاش المتوقع في كل درج مقابل اللي اتعد وقت قفل الوردية', en: 'expected vs counted per drawer' } },
  { id: 'CARD_SETTLEMENT', title: { ar: 'الكروت مقابل تسوية البنك', en: 'Cards vs bank settlement' }, description: { ar: 'تحصيل الكارت في السيستم مقابل اللي البنك قال إنه نزل', en: 'card captures vs the bank batch' } },
  { id: 'WALLETS', title: { ar: 'المحافظ مقابل كشف المحفظة', en: 'Wallets vs statement' }, description: { ar: 'إنستاباي وفودافون كاش مقابل كشف الحساب', en: 'wallet captures vs provider statement' } },
  { id: 'E_RECEIPTS', title: { ar: 'الإيصالات الإلكترونية مقابل المبيعات', en: 'E-receipts vs sales' }, description: { ar: 'كل بيعة لازم يكون ليها إيصال مقبول من منصة الضرايب', en: 'each sale has an accepted e-receipt' } },
];
function evaluateRule(ctx: Ctx, ruleId: string, branchId: string, from: string, to: string, runId: string): ReconResult[] {
  const db = ctx.db;
  const out: ReconResult[] = [];
  const mk = (r: Omit<ReconResult, 'id' | 'runId' | 'ruleId' | 'ackBy' | 'ackAt' | 'ackReason' | 'version' | 'difference' | 'status'> & { status?: ReconResult['status'] }): ReconResult => {
    const diff = m4(D(r.actual).minus(D(r.expected)));
    return { ...r, id: nextId('rres'), runId, ruleId, difference: diff, status: r.status ?? (D(diff).isZero() ? 'MATCHED' : 'UNEXPLAINED_DIFFERENCE'), ackBy: null, ackAt: null, ackReason: null, version: 1 };
  };
  const dates: string[] = [];
  for (let d = from; d <= to && dates.length < 62; d = addDays(d, 1)) dates.push(d);
  const br = db.branches.find((b) => b.id === branchId);
  const today = bdOf(ctx.now, br?.timezone, br?.businessDayCutoff);
  if (ruleId === 'DRAWER_CASH') {
    for (const s of db.sessions.filter((x) => x.branchId === branchId && x.businessDate >= from && x.businessDate <= to)) {
      const code = db.terminals.find((t) => t.id === s.terminalId)?.code ?? '';
      const title = { ar: `درج ${deviceName(s.terminalId)} — ${userName(db, s.userId)} (${s.businessDate})`, en: `Drawer ${code} ${s.businessDate}` };
      const entries = db.cashEntries.filter((e) => e.sessionId === s.id).map((e) => ({ kind: 'CASH', id: e.id, label: e.kind, amount: e.amount }));
      if (!s.close) out.push(mk({ key: `DRAWER:${s.id}`, title, businessDate: s.businessDate, expected: m4(0), actual: m4(0), drilldown: entries, note: { ar: 'الوردية لسه مفتوحة — مفيش عد للدرج لسه', en: 'shift still open' }, status: 'MISSING' }));
      else out.push(mk({ key: `DRAWER:${s.id}`, title, businessDate: s.businessDate, expected: s.close.expectedCash, actual: s.close.countedCash, drilldown: entries, note: s.close.reason ? { ar: `ملاحظة الكاشير: ${s.close.reason}`, en: s.close.reason } : null }));
    }
  } else if (ruleId === 'CARD_SETTLEMENT' || ruleId === 'WALLETS') {
    const method = ruleId === 'CARD_SETTLEMENT' ? 'CARD' : 'DIGITAL_WALLET';
    for (const d of dates) {
      const caps = db.captures.filter((c) => c.branchId === branchId && c.businessDate === d && c.method === method);
      const hist = (db.salesHistory ?? []).find((h) => h.branchId === branchId && h.businessDate === d);
      const expected = caps.length ? sumM(caps.map((c) => c.amount)) : hist?.byMethod[method] ?? null;
      if (expected === null || D(expected).isZero()) continue;
      let batch = (db.settlementBatches ??= []).find((b) => b.branchId === branchId && b.businessDate === d && b.method === method);
      if (!batch && d < today && caps.length) {
        // the provider file for a finished day "arrives" the first time someone reconciles it
        const missing = method === 'CARD' && caps.length >= 3 ? caps[caps.length - 1].amount : '0';
        batch = { id: nextId('sb'), branchId, businessDate: d, provider: method === 'CARD' ? 'ماكينة البنك الأهلي' : 'إنستاباي', method, amount: m4(D(expected).minus(D(missing))), count: caps.length - (D(missing).isZero() ? 0 : 1), receivedAt: ctx.nowIso };
        db.settlementBatches.push(batch);
      }
      const label = method === 'CARD' ? 'كروت' : 'محافظ';
      const drill = [...caps.map((c) => ({ kind: 'CAPTURE', id: c.id, label: `#${db.orders.find((o) => o.id === c.orderId)?.number ?? ''} · ${c.reference ?? ''}`, amount: c.amount })), ...(batch ? [{ kind: 'SETTLEMENT', id: batch.id, label: `تسوية ${batch.provider} (${batch.count} عملية)`, amount: batch.amount }] : [])];
      if (!batch) out.push(mk({ key: `${method}:${d}`, title: { ar: `${label} ${d}: التسوية لسه ما وصلتش`, en: `${method} ${d}: settlement not received` }, businessDate: d, expected, actual: m4(0), drilldown: drill, note: { ar: d >= today ? 'البنك بيبعت التسوية تاني يوم الصبح' : 'ملف التسوية ما وصلش', en: 'settlement arrives next morning' }, status: 'MISSING' }));
      else out.push(mk({ key: `${method}:${d}`, title: { ar: `${label} ${d}: المتحصل مقابل ${batch.provider}`, en: `${method} ${d}` }, businessDate: d, expected, actual: batch.amount, drilldown: drill, note: D(batch.amount).lt(D(expected)) ? { ar: 'فيه عملية ظاهرة عندنا ومش ظاهرة في تسوية البنك — راجع إيصال الماكينة', en: 'a payment is missing from the settlement' } : null }));
    }
  } else if (ruleId === 'E_RECEIPTS') {
    const mode = policy<string>('FiscalDocumentPolicy', { branchId }) ?? 'OFF';
    for (const d of dates) {
      const sales = db.orders.filter((o) => o.branchId === branchId && o.status === 'COMPLETED' && o.kind === 'SALE' && o.completedBusinessDate === d);
      if (!sales.length) continue;
      const accepted = sales.filter((o) => db.fiscalDocuments.some((f) => f.orderId === o.id && f.state === 'ACCEPTED'));
      const missing = sales.filter((o) => !accepted.includes(o));
      out.push(mk({ key: `ERECEIPT:${d}`, title: { ar: `إيصالات ${d}: ${accepted.length} من ${sales.length} اتقبلت`, en: `E-receipts ${d}: ${accepted.length}/${sales.length}` }, businessDate: d, expected: sumM(sales.map((o) => computeTotals(o).payable)), actual: sumM(accepted.map((o) => computeTotals(o).payable)), drilldown: missing.map((o) => ({ kind: 'ORDER', id: o.id, label: `#${o.number} · ${db.fiscalDocuments.find((f) => f.orderId === o.id)?.state ?? 'من غير إيصال'}`, amount: computeTotals(o).payable })), note: mode === 'OFF' ? { ar: 'الإيصال الإلكتروني مقفول من الإعدادات — مفيش إيصالات بتطلع', en: 'e-receipts are off' } : null, status: mode === 'OFF' ? 'MATCHED' : undefined }));
    }
  }
  return out;
}

// ───────── reports: trend, export, schedules
function liveDay(db: DB, branchId: string, date: string) {
  const sales = db.orders.filter((o) => o.branchId === branchId && o.status === 'COMPLETED' && o.kind === 'SALE' && o.completedBusinessDate === date);
  if (!sales.length) return null;
  const byHour = Array(24).fill(0);
  const items = new Map<string, { name: any; qty: number; amount: number }>();
  let net = D(0), guests = 0;
  for (const o of sales) {
    const t = computeTotals(o);
    net = net.plus(D(t.netSales));
    guests += o.guestCount ?? db.visits.find((v) => v.id === o.visitId)?.guestCount ?? 1;
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(o.completedAtMs ?? o.createdAtMs)));
    byHour[h] += Number(t.netSales);
    for (const l of o.lines.filter((x) => x.status === 'ACTIVE')) { const it = items.get(l.productId) ?? { name: l.name, qty: 0, amount: 0 }; it.qty += Number(l.quantity); it.amount += Number(l.lineTotal); items.set(l.productId, it); }
  }
  const byMethod: Record<string, string> = {};
  for (const c of db.captures.filter((x) => x.branchId === branchId && x.businessDate === date)) byMethod[c.method] = m4(D(byMethod[c.method] ?? 0).plus(D(c.amount)));
  return { netSales: m4(net), orders: sales.length, guests, byHour: byHour.map((x) => Math.round(x)), byMethod, topItems: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 8).map((x) => ({ name: x.name, qty: x.qty, amount: m4(x.amount) })) };
}

const scheduleView = (ctx: Ctx, s: ReportSchedule) => ({ ...s, createdByName: userName(ctx.db, s.createdBy) });

// ───────── capabilities
function capabilityView(ctx: Ctx) {
  const list: CapabilityState[] = ctx.db.capabilities ?? [];
  return CAPABILITIES.map((c) => {
    const ten = list.find((x) => x.id === c.id && x.scopeType === 'TENANT');
    const br = ctx.branchId ? list.find((x) => x.id === c.id && x.scopeType === 'BRANCH' && x.scopeId === ctx.branchId) : undefined;
    return { id: c.id, title: c.title, titleEn: c.titleEn, description: c.description, offEffect: c.offEffect, icon: c.icon, screens: c.screens, groups: c.groups, enabled: capabilityOn(ctx.db, c.id, ctx.branchId), tenant: ten ? { enabled: ten.enabled, version: ten.version, updatedAt: ten.updatedAt, updatedByName: userName(ctx.db, ten.updatedBy) } : null, branch: br ? { enabled: br.enabled, version: br.version, updatedAt: br.updatedAt, updatedByName: userName(ctx.db, br.updatedBy) } : null, defaultOn: c.defaultOn, state: 'PROPOSED' };
  });
}

export const opsHandlers: Record<string, Handler> = {
  // ───── capabilities
  'Capability.List': (ctx) => ({ items: capabilityView(ctx), branchId: ctx.branchId }),
  'Profile.SetCapability': (ctx) => {
    const c = CAPABILITIES.find((x) => x.id === ctx.params.capability);
    need(c, 'VALIDATION_FAILED', { field: 'capability', rule: CAPABILITIES.map((x) => x.id).join('|') });
    const scopeType = ctx.body.scopeType === 'BRANCH' ? 'BRANCH' : 'TENANT';
    const scopeId = scopeType === 'BRANCH' ? (ctx.body.scopeId ?? requireBranch(ctx)) : 'biz';
    const list = (ctx.db.capabilities ??= []);
    const i = list.findIndex((x) => x.id === c!.id && x.scopeType === scopeType && x.scopeId === scopeId);
    if (i >= 0 && ctx.body.expectedVersion !== undefined) checkVersion(list[i], ctx.body.expectedVersion);
    if (ctx.body.inherit) { if (i >= 0) list.splice(i, 1); }
    else {
      need(typeof ctx.body.enabled === 'boolean', 'VALIDATION_FAILED', { field: 'enabled' });
      if (i >= 0) Object.assign(list[i], { enabled: ctx.body.enabled, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id, version: list[i].version + 1 });
      else list.push({ id: c!.id, scopeType, scopeId, enabled: ctx.body.enabled, updatedAt: ctx.nowIso, updatedBy: ctx.user!.id, version: 1 });
    }
    ctx.audit(`capability ${c!.id} ${ctx.body.inherit ? 'inherit' : ctx.body.enabled ? 'on' : 'off'} (${scopeType})`, c!.id, true);
    event('CapabilityChanged', c!.id, `${scopeType}:${scopeId} ${ctx.body.inherit ? 'inherit' : ctx.body.enabled}`);
    return { items: capabilityView(ctx) };
  },

  // ───── remote approval requests (PD-V4-03)
  'ApprovalRequest.Create': (ctx) => {
    const b = ctx.body ?? {};
    const def = APPROVAL_ACTIONS.find((a) => a.id === b.action);
    need(def, 'VALIDATION_FAILED', { field: 'action' });
    need(b.targetId && b.targetType, 'VALIDATION_FAILED', { field: 'targetId' });
    const list = (ctx.db.approvalRequests ??= []);
    expireRequests(ctx.db, ctx.now);
    const ctxHash = hashOf(b.context ?? {});
    const dup = list.find((r) => r.state === 'PENDING' && r.requesterUserId === ctx.user!.id && r.action === b.action && r.targetId === b.targetId && hashOf(r.context) === ctxHash);
    if (dup) return requestView(ctx, dup);
    const r: ApprovalRequestRec = {
      id: nextId('areq'), state: 'PENDING', action: def!.id, actionTitle: def!.title, targetType: b.targetType, targetId: b.targetId, context: b.context ?? {}, summary: summaryOf(ctx, def!.id, b.context ?? {}, b.targetId),
      opId: String(b.opId ?? ''), commandId: b.commandId ?? null, requesterUserId: ctx.user!.id, terminalId: ctx.terminal?.id ?? null, branchId: ctx.branchId,
      createdAt: ctx.nowIso, createdAtMs: ctx.now, expiresAtMs: ctx.now + REQUEST_TTL_MS, decidedBy: null, decidedAt: null, decisionNote: null, grantId: null, version: 1,
    };
    list.unshift(r);
    if (list.length > 200) list.length = 200;
    ctx.audit(`approval request ${r.action} for ${r.targetId}`, r.id, true);
    event('ApprovalRequested', r.id, `${r.action} by ${ctx.user!.username}`);
    return { status: 201, body: requestView(ctx, r) };
  },
  'ApprovalRequest.Find': (ctx) => {
    expireRequests(ctx.db, ctx.now);
    const all = ctx.db.approvalRequests ?? [];
    const mine = ctx.query.mine === 'true';
    const items = all.filter((r) => (mine ? r.requesterUserId === ctx.user!.id : canApprove(ctx, r)) && (!ctx.query.state || ctx.query.state.split(',').includes(r.state)));
    return { ...page(items.map((r) => requestView(ctx, r)), ctx.query), pending: items.filter((r) => r.state === 'PENDING').length };
  },
  'ApprovalRequest.Get': (ctx) => {
    expireRequests(ctx.db, ctx.now);
    const r = (ctx.db.approvalRequests ?? []).find((x) => x.id === ctx.params.requestId);
    if (!r || (r.requesterUserId !== ctx.user!.id && !canApprove(ctx, r))) throw new ApiError('APPROVAL_REQUEST_NOT_FOUND', { requestId: ctx.params.requestId }, 404);
    return requestView(ctx, r);
  },
  'ApprovalRequest.Decide': (ctx) => {
    expireRequests(ctx.db, ctx.now);
    const r = (ctx.db.approvalRequests ?? []).find((x) => x.id === ctx.params.requestId);
    if (!r) throw new ApiError('APPROVAL_REQUEST_NOT_FOUND', {}, 404);
    checkVersion(r, ctx.body.expectedVersion);
    if (r.state !== 'PENDING') throw new ApiError('APPROVAL_REQUEST_NOT_PENDING', { state: r.state }, 409);
    const def = APPROVAL_ACTIONS.find((a) => a.id === r.action)!;
    if (!ctx.can(def.permission)) throw new ApiError('APPROVER_NOT_AUTHORIZED', { required: def.permission });
    if (r.requesterUserId === ctx.user!.id && !selfApprovalAllowed(r.action)) throw new ApiError('SELF_APPROVAL_DENIED', { action: r.action });
    const decision = ctx.body.decision;
    need(decision === 'APPROVE' || decision === 'REJECT', 'VALIDATION_FAILED', { field: 'decision' });
    r.decidedBy = ctx.user!.id; r.decidedAt = ctx.nowIso; r.decisionNote = ctx.body.note ? String(ctx.body.note).slice(0, 200) : null; r.version++;
    if (decision === 'REJECT') {
      r.state = 'REJECTED';
      ctx.audit(`approval request ${r.action} rejected`, r.id, true);
      return requestView(ctx, r);
    }
    // the same one-use grant Approval.Grant issues, bound to the requester, the branch and the requesting terminal
    const ttl = policy<{ seconds: number }>('ApprovalTtlPolicy')?.seconds ?? 120;
    const g: ApprovalGrant = {
      id: nextId('grant'), action: r.action, targetType: r.targetType, targetId: r.targetId, context: r.context, contextHash: hashOf(r.context),
      requesterUserId: r.requesterUserId, approverUserId: ctx.user!.id, branchId: r.branchId, terminalId: r.terminalId,
      issuedAt: ctx.nowIso, expiresAtMs: ctx.now + Math.max(ttl, 120) * 1000, consumedAt: null, consumedBy: null, reason: r.decisionNote ?? 'remote approval',
    };
    ctx.db.grants.unshift(g);
    r.state = 'APPROVED'; r.grantId = g.id;
    ctx.audit(`remote grant ${g.action} for ${g.targetId} by ${ctx.user!.username}`, g.targetId, true, g.id);
    event('ApprovalGranted', r.id, `${r.action} remote by ${ctx.user!.username}`);
    return requestView(ctx, r);
  },
  'ApprovalRequest.Cancel': (ctx) => {
    const r = (ctx.db.approvalRequests ?? []).find((x) => x.id === ctx.params.requestId && x.requesterUserId === ctx.user!.id);
    if (!r) throw new ApiError('APPROVAL_REQUEST_NOT_FOUND', {}, 404);
    if (r.state !== 'PENDING') return requestView(ctx, r);
    r.state = 'CANCELLED'; r.version++;
    return requestView(ctx, r);
  },

  // ───── hand an open check over to another drawer session (shift handover)
  'Order.TransferSession': (ctx) => {
    const o = ctx.db.orders.find((x) => x.id === ctx.params.orderId && x.branchId === ctx.branchId);
    if (!o) throw new ApiError('ORDERS_ORDER_NOT_FOUND', { orderId: ctx.params.orderId });
    checkVersion(o, ctx.body.expectedVersion);
    if (!OPEN(o)) throw new ApiError('ORDER_NOT_EDITABLE', { status: o.status });
    need(o.sessionId, 'VALIDATION_FAILED', { rule: 'floor checks are not tied to a drawer: any open drawer in the branch can collect them' });
    const to = ctx.db.sessions.find((s) => s.id === ctx.body.toSessionId && s.branchId === ctx.branchId);
    if (!to) throw new ApiError('SESSION_NOT_FOUND', { sessionId: ctx.body.toSessionId });
    if (to.state !== 'OPEN') throw new ApiError('SESSION_NOT_OPEN', { sessionId: to.id });
    need(to.id !== o.sessionId, 'VALIDATION_FAILED', { field: 'toSessionId', rule: 'already on this shift' });
    const from = ctx.db.sessions.find((s) => s.id === o.sessionId);
    const g = ctx.requireApproval({ action: 'ORDER_SESSION_TRANSFER', targetType: 'orders.Order', targetId: o.id, context: { orderId: o.id, fromSessionId: o.sessionId, toSessionId: to.id, payable: computeTotals(o).payable }, grantId: ctx.body.approvalGrantId });
    const fromTerm = deviceName(from?.terminalId);
    const toTerm = deviceName(to.terminalId);
    o.sessionId = to.id;
    o.terminalId = to.terminalId;
    if (ctx.body.toServer) o.serverUserId = to.userId;
    o.version++;
    o.history.push(hist(ctx.user!.id, 'SESSION_TRANSFER', { ar: `الشيك اتنقل من وردية ${userName(ctx.db, from?.userId)} (${fromTerm}) لوردية ${userName(ctx.db, to.userId)} (${toTerm})${ctx.body.reason ? ' — ' + String(ctx.body.reason).slice(0, 120) : ''}`, en: `handed over ${fromTerm} → ${toTerm}` }, { from: from?.id, to: to.id, grantId: g?.id }, ctx.terminal?.code));
    ctx.audit(`order ${o.number} handed over ${fromTerm} → ${toTerm}`, o.id, true, g?.id);
    return { orderId: o.id, number: o.number, fromSessionId: from?.id ?? null, toSessionId: to.id, version: o.version };
  },

  // ───── end of business day
  'BusinessDay.Readiness': (ctx) => {
    const date = ctx.params.date;
    need(/^\d{4}-\d{2}-\d{2}$/.test(date), 'VALIDATION_FAILED', { field: 'date' });
    return readiness(ctx, requireBranch(ctx), date);
  },
  'BusinessDay.Find': (ctx) => {
    const branchId = requireBranch(ctx);
    const items = (ctx.db.businessDays ?? []).filter((d) => d.branchId === branchId).sort((a, b) => b.date.localeCompare(a.date)).map((d) => dayView(ctx, d));
    return page(items, ctx.query);
  },
  'BusinessDay.Close': (ctx) => {
    const branchId = requireBranch(ctx);
    const date = ctx.params.date;
    need(/^\d{4}-\d{2}-\d{2}$/.test(date), 'VALIDATION_FAILED', { field: 'date' });
    if ((ctx.db.businessDays ?? []).some((d) => d.branchId === branchId && d.date === date)) throw new ApiError('BUSINESS_DAY_ALREADY_CLOSED', { date }, 409);
    const r = readiness(ctx, branchId, date);
    if (r.checks.some((c) => c.id === 'NOT_STARTED')) throw new ApiError('BUSINESS_DAY_NOT_STARTED', { date, current: r.currentBusinessDate }, 409);
    // an earlier day must be closed first
    const prev = addDays(date, -1);
    const anyBefore = (ctx.db.businessDays ?? []).some((d) => d.branchId === branchId && d.date < date);
    const prevActivity = ctx.db.sessions.some((s) => s.branchId === branchId && s.businessDate === prev) || ctx.db.orders.some((o) => o.branchId === branchId && o.businessDate === prev);
    if (anyBefore && prevActivity && !(ctx.db.businessDays ?? []).some((d) => d.branchId === branchId && d.date === prev)) throw new ApiError('BUSINESS_DAY_NOT_READY', { reason: 'close the previous day first', previous: prev }, 409);
    if (r.blockers) throw new ApiError('BUSINESS_DAY_NOT_READY', { blockers: r.checks.filter((c) => c.level === 'BLOCKER').map((c) => ({ id: c.id, count: c.count })) }, 409);
    const warnings = r.checks.filter((c) => c.level === 'WARNING').map((c) => c.id);
    if (warnings.length && ctx.body.acknowledgeWarnings !== true) throw new ApiError('VALIDATION_FAILED', { field: 'acknowledgeWarnings', rule: 'confirm you have seen the warnings', warnings });
    const g = ctx.requireApproval({ action: 'BUSINESS_DAY_CLOSE', targetType: 'reporting.BusinessDay', targetId: `${branchId}:${date}`, context: { date, warnings: String(warnings.length) }, grantId: ctx.body.approvalGrantId });
    const rec = { date, branchId, state: 'CLOSED' as const, closedAt: ctx.nowIso, closedBy: ctx.user!.id, note: ctx.body.note ? String(ctx.body.note).slice(0, 300) : null, warningsAcknowledged: warnings, summary: r.summary, nextBusinessDate: r.nextBusinessDate, version: 1 };
    (ctx.db.businessDays ??= []).push(rec);
    // the accounting system gets the day (outbox webhook)
    (ctx.db.webhookDeliveries ??= []).unshift({ id: nextId('wh'), consumerId: 'accounting', consumerName: { ar: 'برنامج الحسابات', en: 'Accounting' }, eventType: 'BusinessDayClosed', ref: `${branchId}:${date}`, label: `إقفال يوم ${date}`, state: 'PENDING', attempts: [], createdAt: ctx.nowIso, nextAtMs: 0, version: 1 });
    ctx.audit(`business day ${date} closed (${warnings.length} warnings)`, `${branchId}:${date}`, true, g?.id);
    event('BusinessDayClosed', `${branchId}:${date}`, `${date} net ${r.summary.netSales}`);
    return { status: 201, body: dayView(ctx, rec) };
  },

  // ───── offline sync
  'Sync.Bootstrap': (ctx) => {
    const branchId = requireBranch(ctx);
    const db = ctx.db;
    const products = db.products.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, categoryId: p.categoryId, availability: db.availability.find((a) => a.productId === p.id && a.branchId === branchId)?.state ?? 'NOT_ON_BRANCH_MENU' }));
    const prices = db.priceRules.filter((r) => r.branchId === branchId && r.effectiveFrom <= ctx.now && (r.effectiveTo === null || r.effectiveTo > ctx.now)).map((r) => ({ productId: r.productId, channel: r.channel, amount: r.amount }));
    const tables = db.tables.filter((t) => t.branchId === branchId).map((t) => ({ id: t.id, name: t.name, area: t.area, capacity: t.capacity, active: t.active }));
    return { cursor: db.seq['au'] ?? 100, at: ctx.nowIso, branchId, catalog: { categories: db.categories.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })), products }, prices, policies: db.policyValues.length, reasonCodes: db.reasonCodes.filter((r) => r.active).map((r) => ({ kind: r.kind, code: r.code, label: r.label })), tables, counts: { products: products.length, prices: prices.length, tables: tables.length, reasonCodes: db.reasonCodes.filter((r) => r.active).length, policies: db.policyValues.length }, allowlist: OFFLINE_ALLOWLIST };
  },
  'Sync.Changes': (ctx) => {
    const cursor = Number(ctx.query.cursor);
    need(Number.isFinite(cursor), 'VALIDATION_FAILED', { field: 'cursor' });
    const limit = Math.min(Number(ctx.query.limit ?? 100) || 100, 500);
    const oldest = ctx.db.audit.length ? auditSeq(ctx.db.audit[ctx.db.audit.length - 1].id) : 0;
    const changes = ctx.db.audit.filter((a) => auditSeq(a.id) > cursor).map((a) => ({ a, k: REFERENCE_OPS.find(([re]) => re.test(a.op)) })).filter((x) => x.k).reverse().slice(0, limit)
      .map(({ a, k }) => ({ seq: auditSeq(a.id), at: a.at, kind: k![1], op: a.op, target: a.target, summary: a.summary, byName: userName(ctx.db, a.userId) }));
    return { changes, nextCursor: Math.max(cursor, ...ctx.db.audit.map((a) => auditSeq(a.id))), resetRequired: cursor > 0 && cursor < oldest - 1 && ctx.db.audit.length >= 1000 };
  },
  'Sync.Replay': (ctx) => {
    const cmds: any[] = Array.isArray(ctx.body.commands) ? ctx.body.commands : [];
    need(cmds.length > 0 && cmds.length <= 200, 'VALIDATION_FAILED', { field: 'commands', rule: '1..200' });
    const L = () => (ctx.db.offlineItems ??= []); // re-read: a refused item restores the database in place
    const results: any[] = [];
    const touched = new Set<string>();
    const touchKey = (x: { params: Record<string, string> }) => x.params?.orderId ?? x.params?.ticketId ?? x.params?.tableId ?? null;
    for (const c of cmds) {
      const list = L();
      need(c.offlineCommandId && c.operation, 'VALIDATION_FAILED', { field: 'commands[].offlineCommandId/operation' });
      const known = list.find((x) => x.offlineCommandId === c.offlineCommandId);
      if (known) { results.push({ offlineCommandId: c.offlineCommandId, state: known.state === 'APPLIED' || known.state === 'RESOLVED' ? 'DUPLICATE' : known.state, errorCode: known.errorCode, conflictKind: known.conflictKind, label: known.label }); continue; }
      const prior = ctx.db.idem[c.offlineCommandId];
      const base: OfflineItem = { offlineCommandId: c.offlineCommandId, terminalId: ctx.terminal?.id ?? null, deviceLabel: ctx.terminal?.code ?? '', userId: ctx.user!.id, operation: c.operation, params: c.params ?? {}, body: c.body ?? {}, label: String(c.label ?? OFFLINE_ALLOWLIST[c.operation]?.ar ?? c.operation).slice(0, 120), queuedAt: c.queuedAt ?? ctx.nowIso, replayedAt: ctx.nowIso, state: 'APPLIED', errorCode: null, errorDetails: null, conflictKind: null, resolution: null, resolvedBy: null, resolvedAt: null, version: 1 };
      if (prior) { base.state = 'DUPLICATE'; base.result = prior.body; list.unshift(base); results.push({ offlineCommandId: c.offlineCommandId, state: 'DUPLICATE', label: base.label }); continue; }
      let r = runOffline(ctx, base);
      // the device's own earlier recorded commands moved the version on: not a conflict, rebase on it
      const tk = touchKey(base);
      if (!r.ok && r.code === 'CONCURRENCY_CONFLICT' && tk && touched.has(tk) && r.details?.currentVersion !== undefined) { base.body = { ...base.body, expectedVersion: r.details.currentVersion }; r = runOffline(ctx, base); }
      if (r.ok && tk) touched.add(tk);
      const list2 = L();
      if (r.ok) { base.result = r.body; }
      else {
        base.state = r.code === 'OFFLINE_COMMAND_NOT_ALLOWED' || r.code === 'PERMISSION_DENIED' ? 'REJECTED' : 'CONFLICT';
        base.errorCode = r.code; base.errorDetails = r.details; base.conflictKind = CONFLICT_KIND[r.code] ?? 'REFUSED';
      }
      list2.unshift(base);
      results.push({ offlineCommandId: c.offlineCommandId, state: base.state, errorCode: base.errorCode, conflictKind: base.conflictKind, label: base.label });
    }
    if (L().length > 300) L().length = 300;
    const st = (ctx.db.syncTerminals ??= []);
    const tid = ctx.terminal?.id ?? 'BO';
    const rec = st.find((x) => x.terminalId === tid) ?? (st.push({ terminalId: tid, lastBootstrapAt: null, lastChangesAt: null, lastReplayAt: null, cursor: 0 }), st[st.length - 1]);
    rec.lastReplayAt = ctx.nowIso;
    ctx.audit(`offline replay: ${results.length} commands, ${results.filter((x) => x.state === 'CONFLICT').length} conflicts`, tid);
    event('OfflineReplay', tid, `${results.length} commands`);
    return { results, applied: results.filter((x) => x.state === 'APPLIED').length, duplicates: results.filter((x) => x.state === 'DUPLICATE').length, conflicts: results.filter((x) => x.state === 'CONFLICT').length, rejected: results.filter((x) => x.state === 'REJECTED').length };
  },
  'Sync.ResolveConflict': (ctx) => {
    const x = (ctx.db.offlineItems ?? []).find((i) => i.offlineCommandId === ctx.params.offlineCommandId && ctx.db.terminals.find((t) => t.id === i.terminalId)?.branchId === ctx.branchId);
    if (!x) throw new ApiError('OFFLINE_COMMAND_NOT_FOUND', { offlineCommandId: ctx.params.offlineCommandId });
    checkVersion(x, ctx.body.expectedVersion);
    if (x.state !== 'CONFLICT') throw new ApiError('VALIDATION_FAILED', { rule: 'only a conflict can be resolved', state: x.state });
    const how = ctx.body.resolution;
    need(['DISCARD', 'RETRY', 'APPLY_ON_LATEST', 'SKIP_UNAVAILABLE'].includes(how), 'VALIDATION_FAILED', { field: 'resolution' });
    if (x.userId !== ctx.user!.id && !ctx.can('session:zreport')) throw new ApiError('PERMISSION_DENIED', { reason: 'only the person who recorded it or a manager decides' });
    x.version++;
    x.resolvedBy = ctx.user!.id; x.resolvedAt = ctx.nowIso; x.resolution = how;
    if (how === 'DISCARD') { x.state = 'DISCARDED'; ctx.audit(`offline item discarded: ${x.label}`, x.offlineCommandId); return offlineView(ctx, x); }
    let body = structuredClone(x.body ?? {});
    if (how === 'SKIP_UNAVAILABLE' && Array.isArray(body.lines)) {
      const branchId = ctx.branchId;
      body.lines = body.lines.filter((l: any) => (ctx.db.availability.find((a) => a.productId === l.productId && a.branchId === branchId)?.state ?? 'AVAILABLE') === 'AVAILABLE');
      if (!body.lines.length) { x.state = 'DISCARDED'; return offlineView(ctx, x); }
    }
    const id = x.offlineCommandId;
    const item = { offlineCommandId: id, operation: x.operation, params: x.params };
    let r = runOffline(ctx, { ...item, body });
    if (!r.ok && how === 'APPLY_ON_LATEST' && r.code === 'CONCURRENCY_CONFLICT' && r.details?.currentVersion !== undefined) {
      body = { ...body, expectedVersion: r.details.currentVersion };
      r = runOffline(ctx, { ...item, body });
    }
    const y = (ctx.db.offlineItems ?? []).find((i) => i.offlineCommandId === id)!; // re-read after a possible in-place restore
    Object.assign(y, { version: x.version, resolvedBy: x.resolvedBy, resolvedAt: x.resolvedAt, resolution: how });
    if (r.ok) { y.state = 'RESOLVED'; y.result = r.body; y.body = body; }
    else { y.errorCode = r.code; y.errorDetails = r.details; y.conflictKind = CONFLICT_KIND[r.code] ?? 'REFUSED'; y.resolution = null; }
    ctx.audit(`offline conflict ${how}: ${y.label} → ${y.state}`, id);
    return offlineView(ctx, y);
  },
  'Sync.Status': (ctx) => {
    const tid = ctx.query.terminalId || null;
    const items = (ctx.db.offlineItems ?? []).filter((x) => (tid ? x.terminalId === tid : ctx.db.terminals.find((t) => t.id === x.terminalId)?.branchId === ctx.branchId));
    const st = (ctx.db.syncTerminals ?? []).filter((s) => (tid ? s.terminalId === tid : true));
    return { terminalId: tid, applied: items.filter((x) => x.state === 'APPLIED' || x.state === 'RESOLVED').length, failed: items.filter((x) => x.state === 'REJECTED').length, conflicts: items.filter((x) => x.state === 'CONFLICT').length, lastReplayAt: st.map((s) => s.lastReplayAt).filter(Boolean).sort().at(-1) ?? null, items: items.slice(0, 80).map((x) => offlineView(ctx, x)) };
  },

  // ───── outbox health and redrive
  'OutboxDelivery.Find': (ctx) => {
    const all = deliveries(ctx.db, ctx.branchId);
    const counts: Record<string, number> = { PENDING: 0, DELIVERED: 0, FAILED: 0, DEAD: 0 };
    for (const d of all) counts[d.state] = (counts[d.state] ?? 0) + 1;
    const byConsumer: Record<string, Record<string, number>> = {};
    for (const d of all) { const k = d.consumerId.startsWith('webhook:') ? 'webhook' : d.consumerId; byConsumer[k] ??= { PENDING: 0, DELIVERED: 0, FAILED: 0, DEAD: 0 }; byConsumer[k][d.state]++; }
    let items = all;
    if (ctx.query.state) items = items.filter((d) => ctx.query.state.split(',').includes(d.state));
    if (ctx.query.consumerId) items = items.filter((d) => d.consumerId === ctx.query.consumerId || (ctx.query.consumerId === 'webhook' && d.consumerId.startsWith('webhook:')));
    if (ctx.query.olderThan) items = items.filter((d) => d.createdAt < ctx.query.olderThan);
    return { ...page(items, ctx.query), countsByState: counts, countsByConsumer: byConsumer, sim: { kds: sim.get().kds, eta: sim.get().eta, webhooks: (sim.get() as any).webhooks ?? 'UP' } };
  },
  'OutboxDelivery.Get': (ctx) => {
    const d = deliveries(ctx.db, ctx.branchId).find((x) => x.id === ctx.params.deliveryId);
    if (!d) throw new ApiError('CONSUMER_DELIVERY_NOT_FOUND', { deliveryId: ctx.params.deliveryId });
    return d;
  },
  'Outbox.Redrive': (ctx) => {
    const d = deliveries(ctx.db, ctx.branchId).find((x) => x.id === ctx.params.deliveryId);
    if (!d) throw new ApiError('CONSUMER_DELIVERY_NOT_FOUND', { deliveryId: ctx.params.deliveryId });
    checkVersion(d, ctx.body.expectedVersion);
    if (d.state === 'DELIVERED') throw new ApiError('VALIDATION_FAILED', { rule: 'already delivered — nothing to redrive' });
    const g = ctx.requireApproval({ action: 'OUTBOX_REDRIVE', targetType: 'events.ConsumerDelivery', targetId: d.id, context: { deliveryId: d.id, consumerId: d.consumerId, attempts: String(d.attempts), deadLetter: d.state === 'DEAD' }, grantId: ctx.body.approvalGrantId });
    const [kind, id] = [d.id.slice(0, d.id.indexOf(':')), d.id.slice(d.id.indexOf(':') + 1)];
    if (kind === 'kitchen') { const k = ctx.db.kitchenDeliveries.find((x) => x.id === id)!; k.state = 'PENDING'; k.nextAt = 0; }
    else if (kind === 'printing') { const j = ctx.db.printJobs.find((x) => x.id === id)!; j.state = 'PENDING'; j.nextAtMs = 0; (j as any).retryFrom = j.attempts.length; }
    else if (kind === 'ereceipt') {
      const f = ctx.db.fiscalDocuments.find((x) => x.id === id)!;
      if (f.state === 'REJECTED') throw new ApiError('VALIDATION_FAILED', { rule: 'a rejected e-receipt is re-issued from the e-receipts screen (new document)' });
      if (f.state === 'PENDING_DATA') { buildFiscal(ctx.db, f); if (f.state === 'PENDING_DATA') throw new ApiError('VALIDATION_FAILED', { rule: 'data still missing', issues: f.issues.map((i) => i.code) }); }
      f.nextTryAtMs = 0;
    } else if (kind === 'webhook') { const w = (ctx.db.webhookDeliveries ?? []).find((x) => x.id === id)!; w.state = 'PENDING'; w.nextAtMs = 0; w.version++; }
    ctx.audit(`outbox redrive ${d.id}`, d.id, true, g?.id);
    return { deliveryId: d.id, state: 'PENDING', redriven: true };
  },

  // ───── reconciliation
  'Reconciliation.Board': (ctx) => {
    const branchId = ctx.query.branchId || requireBranch(ctx);
    const runs = (ctx.db.reconRuns ?? []).filter((r) => r.branchId === branchId);
    const runIds = new Set(runs.map((r) => r.id));
    let results = (ctx.db.reconResults ?? []).filter((r) => runIds.has(r.runId));
    if (ctx.query.ruleId) results = results.filter((r) => r.ruleId === ctx.query.ruleId);
    if (ctx.query.status) results = results.filter((r) => ctx.query.status.split(',').includes(r.status));
    if (ctx.query.from) results = results.filter((r) => r.businessDate >= ctx.query.from);
    if (ctx.query.to) results = results.filter((r) => r.businessDate <= ctx.query.to);
    results = [...results].sort((a, b) => b.businessDate.localeCompare(a.businessDate) || a.ruleId.localeCompare(b.ruleId));
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { rules: RECON_RULES.map((rule) => ({ ...rule, lastRunAt: runs.filter((x) => x.ruleId === rule.id || x.ruleId === 'ALL').map((x) => x.at).sort().at(-1) ?? null, open: results.filter((r) => r.ruleId === rule.id && r.status === 'UNEXPLAINED_DIFFERENCE').length })), items: results.map((r) => ({ ...r, ackByName: r.ackBy ? userName(ctx.db, r.ackBy) : null })), counts, runs: runs.slice(0, 10).map((r) => ({ ...r, byName: userName(ctx.db, r.by) })) };
  },
  'Reconciliation.Evaluate': (ctx) => {
    const branchId = ctx.body.branchId || requireBranch(ctx);
    const ruleId = ctx.params.ruleId;
    need(ruleId === 'ALL' || RECON_RULES.some((r) => r.id === ruleId), 'VALIDATION_FAILED', { field: 'ruleId' });
    const from = ctx.body.period?.from, to = ctx.body.period?.to ?? from;
    need(/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(to ?? '') && to >= from, 'VALIDATION_FAILED', { field: 'period' });
    need((Date.parse(to) - Date.parse(from)) / DAY <= 31, 'VALIDATION_FAILED', { field: 'period', rule: 'at most 31 days' });
    const runId = nextId('run');
    const rules = ruleId === 'ALL' ? RECON_RULES.map((r) => r.id) : [ruleId];
    const fresh = rules.flatMap((r) => evaluateRule(ctx, r, branchId, from, to, runId));
    const all = (ctx.db.reconResults ??= []);
    for (const r of fresh) {
      // a difference already explained stays explained while the numbers have not changed
      const prev = all.find((p) => p.key === r.key && (ctx.db.reconRuns ?? []).find((x) => x.id === p.runId)?.branchId === branchId);
      if (prev?.status === 'EXPLAINED' && prev.difference === r.difference) Object.assign(r, { status: 'EXPLAINED', ackBy: prev.ackBy, ackAt: prev.ackAt, ackReason: prev.ackReason });
      if (prev) all.splice(all.indexOf(prev), 1);
      all.push(r);
    }
    const counts: Record<string, number> = {};
    for (const r of fresh) counts[r.status] = (counts[r.status] ?? 0) + 1;
    (ctx.db.reconRuns ??= []).unshift({ id: runId, ruleId, branchId, from, to, at: ctx.nowIso, by: ctx.user!.id, resultIds: fresh.map((r) => r.id), counts });
    ctx.audit(`reconciliation ${ruleId} ${from}..${to}: ${fresh.length} results`, runId);
    return { status: 201, body: { id: runId, ruleId, from, to, counts, results: fresh } };
  },
  'Reconciliation.GetResult': (ctx) => {
    const r = (ctx.db.reconResults ?? []).find((x) => x.id === ctx.params.resultId);
    if (!r) throw new ApiError('RECONCILIATION_RESULT_NOT_FOUND', { resultId: ctx.params.resultId });
    return { ...r, ackByName: r.ackBy ? userName(ctx.db, r.ackBy) : null, rule: RECON_RULES.find((x) => x.id === r.ruleId), run: (ctx.db.reconRuns ?? []).find((x) => x.id === r.runId) };
  },
  'Reconciliation.Acknowledge': (ctx) => {
    const r = (ctx.db.reconResults ?? []).find((x) => x.id === ctx.params.resultId);
    if (!r) throw new ApiError('RECONCILIATION_RESULT_NOT_FOUND', { resultId: ctx.params.resultId });
    checkVersion(r, ctx.body.expectedVersion);
    if (r.status !== 'UNEXPLAINED_DIFFERENCE' && r.status !== 'EXPLAINED') throw new ApiError('RECONCILIATION_NOT_ACKNOWLEDGEABLE', { status: r.status });
    const reason = String(ctx.body.reason ?? '').trim();
    need(reason.length >= 5, 'REASON_REQUIRED', { field: 'reason', rule: 'at least 5 characters' });
    Object.assign(r, { status: 'EXPLAINED', ackBy: ctx.user!.id, ackAt: ctx.nowIso, ackReason: reason.slice(0, 300) });
    r.version++;
    ctx.audit(`reconciliation difference explained: ${r.key} (${r.difference})`, r.id, true);
    return { ...r, ackByName: userName(ctx.db, r.ackBy) };
  },

  // ───── reports: trend, export, schedules
  'Report.Trend': (ctx) => {
    const branchId = requireBranch(ctx);
    const days = Math.min(Math.max(Number(ctx.query.days ?? 14) || 14, 1), 60);
    const today = ctx.businessDate();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = addDays(today, -i);
      const live = liveDay(ctx.db, branchId, d);
      const h = (ctx.db.salesHistory ?? []).find((x) => x.branchId === branchId && x.businessDate === d);
      const src = live ?? h ?? null;
      out.push({ businessDate: d, source: live ? 'LIVE' : h ? 'HISTORY' : 'NONE', netSales: src?.netSales ?? m4(0), orders: src?.orders ?? 0, guests: src?.guests ?? 0, avgCheck: src && src.orders ? m4(D(src.netSales).dividedBy(src.orders)) : m4(0), byHour: src?.byHour ?? Array(24).fill(0), byMethod: src?.byMethod ?? {}, topItems: src?.topItems ?? [] });
    }
    return { items: out, today };
  },
  'Report.Export': (ctx) => {
    const b = ctx.body ?? {};
    need(b.reportId, 'VALIDATION_FAILED', { field: 'reportId' });
    const format: 'CSV' | 'XLSX' = b.format === 'XLSX' ? 'XLSX' : 'CSV';
    const res = outputHandlers['Report.Run']({ ...ctx, params: { reportId: b.reportId }, query: { fromBusinessDate: b.fromBusinessDate, toBusinessDate: b.toBusinessDate ?? b.fromBusinessDate } }) as any;
    const sheets = (res.sections ?? []).map((s: any) => ({ id: s.id, title: s.title, columns: s.columns ?? null, rows: s.rows ?? [] }));
    const code = ctx.db.branches.find((x) => x.id === ctx.branchId)?.code ?? 'BR';
    const filename = `nerdpos-${b.reportId}-${code}-${b.fromBusinessDate}${b.toBusinessDate && b.toBusinessDate !== b.fromBusinessDate ? '_' + b.toBusinessDate : ''}.${format.toLowerCase()}`;
    const rec = { id: nextId('rexp'), reportId: b.reportId, from: b.fromBusinessDate, to: b.toBusinessDate ?? b.fromBusinessDate, format, at: ctx.nowIso, by: ctx.user!.id, rows: sheets.reduce((a: number, s: any) => a + s.rows.length, 0), filename };
    (ctx.db.reportExports ??= []).unshift(rec);
    if (ctx.db.reportExports.length > 50) ctx.db.reportExports.length = 50;
    ctx.audit(`report export ${b.reportId} ${format}`, rec.id);
    return { status: 201, body: { ...rec, title: res.title, period: res.period, provisional: res.provisional, sheets } };
  },
  'Report.Schedule': (ctx) => {
    const b = ctx.body ?? {};
    const def = (outputHandlers['Report.List'](ctx) as any).items.find((r: any) => r.id === b.reportId);
    if (!def) throw new ApiError('REPORT_NOT_FOUND');
    need(b.frequency === 'DAILY' || b.frequency === 'WEEKLY', 'VALIDATION_FAILED', { field: 'frequency' });
    need(/^\d{2}:\d{2}$/.test(b.time ?? ''), 'VALIDATION_FAILED', { field: 'time' });
    if (b.frequency === 'WEEKLY') need(Number(b.weekday) >= 0 && Number(b.weekday) <= 6, 'VALIDATION_FAILED', { field: 'weekday' });
    const recipients: string[] = (b.recipients ?? []).map((x: string) => String(x).trim()).filter(Boolean).slice(0, 10);
    need(recipients.length > 0, 'VALIDATION_FAILED', { field: 'recipients', rule: 'at least one person' });
    const next = nextRun(ctx.now, b.frequency, b.frequency === 'WEEKLY' ? Number(b.weekday) : null, b.time);
    const s: ReportSchedule = { id: nextId('rs'), reportId: def.id, reportTitle: def.title, frequency: b.frequency, weekday: b.frequency === 'WEEKLY' ? Number(b.weekday) : null, time: b.time, format: b.format === 'CSV' ? 'CSV' : 'XLSX', recipients, branchId: requireBranch(ctx), active: true, createdAt: ctx.nowIso, createdBy: ctx.user!.id, nextRunAt: new Date(next).toISOString(), nextRunMs: next, runs: [], version: 1 };
    (ctx.db.reportSchedules ??= []).push(s);
    ctx.audit(`report schedule ${s.reportId} ${s.frequency} ${s.time}`, s.id);
    return { status: 201, body: scheduleView(ctx, s) };
  },
  'Report.ScheduleFind': (ctx) => page((ctx.db.reportSchedules ?? []).filter((s) => s.branchId === ctx.branchId).map((s) => scheduleView(ctx, s)), ctx.query),
  'Report.ScheduleUpdate': (ctx) => {
    const list = ctx.db.reportSchedules ?? [];
    const s = list.find((x) => x.id === ctx.params.scheduleId && x.branchId === ctx.branchId);
    if (!s) throw new ApiError('VALIDATION_FAILED', { field: 'scheduleId', rule: 'not found' }, 404);
    checkVersion(s, ctx.body.expectedVersion);
    if (ctx.body.delete) { list.splice(list.indexOf(s), 1); return { id: s.id, deleted: true }; }
    s.active = !!ctx.body.active;
    if (s.active) { s.nextRunMs = nextRun(ctx.now, s.frequency, s.weekday, s.time); s.nextRunAt = new Date(s.nextRunMs).toISOString(); }
    s.version++;
    return scheduleView(ctx, s);
  },
};

/** Background work of this area, called by the outbox drain every second. Returns true if something changed. */
export function runOpsBackground(db: DB): boolean {
  const now = clock.now();
  let changed = expireRequests(db, now);
  const webhooks = ((sim.get() as any).webhooks ?? 'UP') as 'UP' | 'DOWN';
  for (const w of db.webhookDeliveries ?? []) {
    if (w.state !== 'PENDING' && w.state !== 'FAILED') continue;
    if (w.nextAtMs > now) continue;
    const err = webhooks === 'DOWN' ? 'WEBHOOK_DOWN' : null;
    w.attempts.push({ at: new Date(now).toISOString(), error: err });
    w.version++;
    if (!err) w.state = 'DELIVERED';
    else { const n = w.attempts.filter((a) => a.error).length; w.state = n >= 5 ? 'DEAD' : 'FAILED'; w.nextAtMs = now + [10, 30, 60, 120, 300][Math.min(n - 1, 4)] * 1000; }
    changed = true;
  }
  for (const s of db.reportSchedules ?? []) {
    if (!s.active || s.nextRunMs > now) continue;
    s.runs.unshift({ at: new Date(now).toISOString(), status: 'SENT', note: `اتبعت لـ ${s.recipients.join('، ')} (${s.format})` });
    s.runs.length = Math.min(s.runs.length, 10);
    s.nextRunMs = nextRun(now, s.frequency, s.weekday, s.time); s.nextRunAt = new Date(s.nextRunMs).toISOString();
    changed = true;
  }
  const tp = { alertMinutes: 10, ...(policy<{ alertMinutes?: number }>('TableTurnPolicy') ?? {}) };
  for (const tt of db.tableTurns ?? []) {
    if (tt.state !== 'DIRTY' || !tp.alertMinutes) continue;
    const key = `dirty-${tt.tableId}-${tt.sinceMs}`;
    if ((now - tt.sinceMs) / 60000 >= tp.alertMinutes && !db.alerts.some((a) => a.ref === key)) {
      const name = db.tables.find((t) => t.id === tt.tableId)?.name ?? '';
      db.alerts.unshift({ id: nextId('al'), at: new Date(now).toISOString(), kind: 'TABLE_DIRTY', severity: 'warning', text: { ar: `ترابيزة ${name} مستنية تنضيف من ${tp.alertMinutes} دقيقة`, en: `Table ${name} waiting for cleaning` }, ref: key, ack: false });
      changed = true;
    }
  }
  return changed;
}

export { permsOf, approvalRule, ruleRequires };
export type { WebhookDelivery };
