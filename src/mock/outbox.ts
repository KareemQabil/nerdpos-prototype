// Side effects after a committed command: kitchen routing, printing, e-receipt, alerts.
// They run after the sale is saved; a failure shows a state and a retry, and the sale stays done.
import { store, nextId, event } from './store';
import { clock } from './clock';
import { sim } from './sim';
import { policy } from './policies';
import { computeTotals } from './pricing';
import type { DB, KitchenDelivery, KitchenTicket, Order, PrintJob, FiscalDocument } from './types';
import { hashOf } from './kernel';
import { runOpsBackground } from './handlers/ops';
import { comboRoute, kitchenItem, type ComboPart } from './menu-kitchen';

const BACKOFF = [5, 15, 45, 120, 300]; // seconds, printing.maxAttempts = 5

/** Route a fired round to stations: ascending priority then id, all match fields in conjunction, active station. */
export function routeLines(db: DB, order: Order, lineIds: string[]) {
  const byStation = new Map<string, string[]>();
  const suppressed: string[] = [];
  const parts = new Map<string, ComboPart>(); // menu area: combo components routed to their own stations (menu-kitchen.ts)
  const rules = db.routingRules.filter((r) => r.active && r.branchId === order.branchId).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const ruleFor = (productId: string | undefined, categoryId: string | undefined) => rules.find((r) => {
    const st = db.stations.find((s) => s.id === r.stationId);
    if (r.destination === 'STATION' && (!st || !st.active)) return false;
    if (r.match.productId && r.match.productId !== productId) return false;
    if (r.match.categoryId && r.match.categoryId !== categoryId) return false;
    if (r.match.channel && r.match.channel !== order.channel) return false;
    return true;
  });
  for (const lid of lineIds) {
    const line = order.lines.find((l) => l.id === lid);
    if (!line) continue;
    const rule = ruleFor(line.productId, line.categoryId);
    if (comboRoute(line, rule, ruleFor, byStation, parts)) continue;
    if (!rule) continue; // unmatched: no implicit default station
    if (rule.destination === 'NO_TICKET') { suppressed.push(lid); continue; }
    byStation.set(rule.stationId, [...(byStation.get(rule.stationId) ?? []), lid]);
  }
  return { byStation, suppressed, parts };
}

/** The kitchen.fire-round consumer: one ticket set per (order, round, station); never duplicated. */
function deliverRound(db: DB, d: KitchenDelivery) {
  const order = db.orders.find((o) => o.id === d.orderId);
  if (!order) return;
  const round = order.rounds.find((r) => r.round === d.round);
  if (!round) return;
  const mode = sim.get().kds;
  d.attempts++;
  if (mode === 'DOWN') { d.state = 'FAILED'; d.lastError = 'KITCHEN_DELIVERY_FAILED (simulated: kitchen screen down)'; return; }
  if (mode === 'SLOW' && clock.now() < d.nextAt) { d.state = 'PENDING'; return; }
  const { byStation, parts } = routeLines(db, order, round.lineIds);
  const table = order.tableId ? db.tables.find((t) => t.id === order.tableId)?.name ?? null : null;
  const server = db.users.find((u) => u.id === order.serverUserId)?.displayName ?? '';
  for (const [stationId, lids] of byStation) {
    const exists = db.tickets.find((t) => t.orderId === order.id && t.round === d.round && t.stationId === stationId);
    if (exists) continue; // dedupe: (order, round, station)
    const t: KitchenTicket = {
      id: nextId('kt'), orderId: order.id, orderNumber: order.number, tableName: table, channel: order.channel, round: d.round, stationId, state: 'NEW',
      items: lids.map((lid) => kitchenItem(order.lines.find((x) => x.id === lid)!, stationId, parts)),
      createdAt: clock.iso(), createdAtMs: clock.now(), startedAt: null, readyAt: null, doneAt: null, version: 1, serverName: server,
    };
    db.tickets.push(t);
    d.ticketIds.push(t.id);
  }
  d.state = 'DELIVERED';
  d.deliveredAt = clock.iso();
  d.lastError = null;
  event('KitchenRouted', order.id, `round ${d.round} of ${order.number} → ${[...byStation.keys()].join(', ') || 'no station'}`);
}

export function enqueueRound(db: DB, order: Order, round: number) {
  const d: KitchenDelivery = { id: nextId('kd'), orderId: order.id, round, state: 'PENDING', attempts: 0, lastError: null, createdAt: clock.iso(), deliveredAt: null, ticketIds: [], nextAt: clock.now() + 10_000 };
  db.kitchenDeliveries.push(d);
  return d;
}

export function enqueuePrint(db: DB, job: Omit<PrintJob, 'id' | 'state' | 'attempts' | 'nextAtMs' | 'createdAt'>) {
  const j: PrintJob = { ...job, id: nextId('pj'), state: 'PENDING', attempts: [], nextAtMs: clock.now(), createdAt: clock.iso() };
  db.printJobs.unshift(j);
  return j;
}

function dispatchPrint(j: PrintJob) {
  const st = sim.printer(j.terminalId);
  const at = clock.iso();
  if (st === 'UP') { j.attempts.push({ at, error: null }); j.state = 'SUCCEEDED'; return; }
  j.attempts.push({ at, error: st === 'PAPER_OUT' ? 'PAPER_OUT' : 'PRINTER_UNREACHABLE' });
  const n = j.attempts.slice((j as any).retryFrom ?? 0).filter((a) => a.error).length;
  if (n >= BACKOFF.length) { j.state = 'DEAD'; return; }
  j.state = 'FAILED';
  j.nextAtMs = clock.now() + BACKOFF[n - 1] * 1000;
}

/** compliance.order-completed: build the document from the frozen snapshot, or PENDING_DATA with named issues. */
export function issueFiscal(db: DB, order: Order, supersedes?: FiscalDocument) {
  const mode = policy<string>('FiscalDocumentPolicy', { branchId: order.branchId }) ?? 'OFF';
  if (mode === 'OFF' || order.kind === 'STAFF_MEAL') return null;
  const terminalId = order.completedSessionId ? db.sessions.find((s) => s.id === order.completedSessionId)?.terminalId ?? order.terminalId : order.terminalId;
  const doc: FiscalDocument = {
    id: nextId('fdoc'), orderId: order.id, orderNumber: order.number, branchId: order.branchId, terminalId, deviceId: null, documentType: 'RECEIPT',
    state: 'PENDING_DATA', issues: [], uuid: null, previousUUID: null, referenceOldUUID: supersedes?.uuid ?? null, sequence: null,
    createdAt: clock.iso(), createdAtMs: order.completedAtMs ?? clock.now(), builtAt: null, submittedAt: null, acceptedAt: null, rejectedReason: null, attempts: 0,
    mode: mode as 'SANDBOX' | 'PRODUCTION', total: computeTotals(order).payable, history: [],
  };
  db.fiscalDocuments.unshift(doc);
  buildFiscal(db, doc);
  return doc;
}

export function buildFiscal(db: DB, doc: FiscalDocument) {
  const order = db.orders.find((o) => o.id === doc.orderId)!;
  const issues: FiscalDocument['issues'] = [];
  if (!db.fiscalProfiles.find((p) => p.branchId === doc.branchId)) issues.push({ code: 'NO_FISCAL_PROFILE', detail: 'الفرع مالوش ملف تسجيل ضريبي' });
  const device = db.fiscalDevices.find((d) => d.terminalId === doc.terminalId && d.state === 'ACTIVE');
  if (!device) issues.push({ code: 'NO_ACTIVE_DEVICE', detail: `مفيش جهاز ضريبي نشط للجهاز ${db.terminals.find((t) => t.id === doc.terminalId)?.code ?? doc.terminalId}` });
  for (const l of order.lines.filter((x) => x.status === 'ACTIVE')) {
    if (!db.itemMappings.find((m) => m.productId === l.productId)) issues.push({ code: 'ITEM_CODE_MISSING', detail: `الصنف "${l.name.ar}" مالوش كود EGS/GS1` });
  }
  const t = computeTotals(order);
  if (t.serviceCharge !== '0.0000') issues.push({ code: 'SERVICE_CHARGE_UNMAPPED', detail: 'الخدمة مش متعرفة على الإيصال لحد ما المحاسب يحدد T9 أو T17 (OD-EG-4) — بتفضل برة الإيصال' });
  const blocking = issues.filter((i) => i.code !== 'SERVICE_CHARGE_UNMAPPED');
  doc.issues = issues;
  if (blocking.length) { doc.state = 'PENDING_DATA'; return; }
  device!.lastSequence++;
  doc.deviceId = device!.id;
  doc.sequence = device!.lastSequence;
  doc.previousUUID = device!.lastDocumentHash;
  doc.uuid = (hashOf({ order: order.id, total: doc.total, seq: doc.sequence, prev: doc.previousUUID }) + hashOf({ n: order.number, at: doc.createdAt })).padEnd(64, '0');
  device!.lastDocumentHash = doc.uuid;
  doc.state = 'BUILT';
  doc.builtAt = clock.iso();
}

function submitFiscal(doc: FiscalDocument) {
  const eta = sim.get().eta;
  doc.attempts++;
  if (eta === 'DOWN') { doc.nextTryAtMs = clock.now() + 10_000; doc.history.push({ at: clock.iso(), by: 'system', kind: 'SUBMIT_FAILED', text: 'منصة الإيصال الإلكتروني واقعة — هيتعاد تلقائي' }); return; }
  if (eta === 'TIMEOUT') { doc.state = 'SUBMITTED'; doc.submittedAt = doc.submittedAt ?? clock.iso(); return; }
  doc.state = 'SUBMITTED';
  doc.submittedAt = clock.iso();
  if (eta === 'REJECT') { doc.state = 'REJECTED'; doc.rejectedReason = 'ETA: invalid item code (simulated rejection)'; return; }
  doc.state = 'ACCEPTED';
  doc.acceptedAt = clock.iso();
}

let lastAlertCheck = 0;
/** Drain: called after each commit and every second. Returns true if something changed. */
export function runOutbox(): boolean {
  const db = store.db;
  let changed = false;
  for (const d of db.kitchenDeliveries) {
    if (d.state === 'PENDING') { const before = d.state; deliverRound(db, d); if (d.state !== before || d.ticketIds.length) changed = true; }
  }
  const now = clock.now();
  for (const j of db.printJobs) {
    if ((j.state === 'PENDING' || j.state === 'FAILED') && j.nextAtMs <= now) { dispatchPrint(j); changed = true; }
  }
  for (const doc of db.fiscalDocuments) {
    if ((doc.nextTryAtMs ?? 0) > now) continue;
    if (doc.state === 'BUILT' || (doc.state === 'SUBMITTED' && sim.get().eta !== 'TIMEOUT')) { submitFiscal(doc); changed = true; }
  }
  // e-receipt alerts at 12 h and 20 h if not accepted (24 h deadline)
  if (now - lastAlertCheck > 2000) {
    lastAlertCheck = now;
    for (const doc of db.fiscalDocuments) {
      if (doc.state === 'ACCEPTED' || doc.state === 'SUPERSEDED') continue;
      const age = (now - doc.createdAtMs) / 3_600_000;
      for (const h of [12, 20]) {
        const key = `eta-${h}-${doc.id}`;
        if (age >= h && !db.alerts.find((a) => a.ref === key)) {
          db.alerts.unshift({ id: nextId('al'), at: clock.iso(), kind: 'ETA_DEADLINE', severity: h === 20 ? 'error' : 'warning', text: { ar: `إيصال ${doc.orderNumber} لسه ما اتقبلش من ${h} ساعة — آخر ميعاد 24 ساعة`, en: `Receipt ${doc.orderNumber} not accepted after ${h} h — 24 h deadline` }, ref: key, ack: false });
          changed = true;
        }
      }
    }
    // late kitchen tickets
    const kt = policy<{ alertMinutes: number }>('KitchenTimingPolicy') ?? { alertMinutes: 20 };
    for (const t of db.tickets) {
      if (t.state === 'DONE' || t.state === 'READY') continue;
      const key = `late-${t.id}`;
      if ((now - t.createdAtMs) / 60000 >= kt.alertMinutes && !db.alerts.find((a) => a.ref === key)) {
        db.alerts.unshift({ id: nextId('al'), at: clock.iso(), kind: 'KITCHEN_LATE', severity: 'warning', text: { ar: `تذكرة ${t.orderNumber} (جولة ${t.round}) متأخرة`, en: `Ticket ${t.orderNumber} round ${t.round} is late` }, ref: key, ack: false });
        changed = true;
      }
    }
  }
  if (runOpsBackground(db)) changed = true; // webhooks, report schedules, table-cleaning alerts, approval request expiry
  if (changed) store.commit();
  return changed;
}

let ticker: ReturnType<typeof setInterval> | null = null;
export function startTicker() {
  if (ticker) return;
  ticker = setInterval(() => runOutbox(), 1000);
}
