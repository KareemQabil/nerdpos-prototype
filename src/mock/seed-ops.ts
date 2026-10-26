// Seed for the operations & system area: floor plans with table positions, the days before the demo
// (sales history, closed business days), a previous reconciliation, outbox webhooks and report schedules.
import { businessDate, zonedParts } from './clock';
import { m4, D } from './money';
import type { DB, Loc } from './types';
import type { FloorPlan, TableLayout, SalesHistoryDay, BusinessDayRec, WebhookDelivery, ReportSchedule, ReconResult, ReconRun, SettlementBatch } from './types-ops';
import './ops-registry';

/** Permissions this area needs on the demo roles (added like DEMO_ROLE_ADDITIONS; listed as prototype additions). */
export const OPS_ROLE_ADDITIONS: Record<string, string[]> = {
  role_waiter: ['sync:read', 'sync:replay'],
  role_cashier: ['sync:read', 'sync:replay', 'table:release'],
  role_chef: ['sync:read', 'sync:replay'],
  role_manager: ['sync:read', 'sync:replay', 'outbox:read', 'outbox:redrive', 'reconciliation:read', 'reconciliation:evaluate', 'reconciliation:acknowledge', 'approve:outbox_redrive', 'approve:order_session_transfer', 'approve:business_day_close', 'session:close'],
};

const DAY = 86_400_000;
const rnd = (seed: number) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

export function seedOps(db: DB, nowMs: number) {
  const nowIso = new Date(nowMs).toISOString();
  for (const r of db.roles) {
    const add = OPS_ROLE_ADDITIONS[r.id] ?? [];
    const fresh = add.filter((p) => !r.permissionIds.includes(p));
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...fresh];
    r.permissionIds = [...r.permissionIds, ...fresh];
  }

  // a second drawer at the takeaway counter: shift handover moves open checks between two drawers (Order.TransferSession)
  if (!db.terminals.some((t) => t.id === 't_cash2')) db.terminals.push({ id: 't_cash2', code: 'DEMO-CASH-2', name: 'كاشير التيك أواي', branchId: 'branch_main', drawer: true, lifecycle: 'ACTIVE', purpose: 'TAKEAWAY_COUNTER', kind: 'CASH', version: 1 });

  // ───────── floors and positions (canvas units: 1000 × 620)
  const floor = (id: string, branchId: string, ar: string, en: string, sortOrder: number, decor: FloorPlan['decor']): FloorPlan => ({ id, branchId, name: { ar, en }, sortOrder, width: 1000, height: 620, active: true, decor, version: 1, updatedAt: nowIso, updatedBy: 'provisioning' });
  db.floors = [
    floor('floor_hall', 'branch_main', 'الصالة الرئيسية', 'Main hall', 10, [
      { id: 'd1', kind: 'BAR', x: 40, y: 30, w: 320, h: 70, label: 'البار' },
      { id: 'd2', kind: 'DOOR', x: 440, y: 580, w: 120, h: 30, label: 'المدخل' },
      { id: 'd3', kind: 'WINDOW', x: 960, y: 120, w: 20, h: 380, label: 'شبابيك' },
      { id: 'd4', kind: 'LABEL', x: 600, y: 40, w: 220, h: 40, label: 'ناحية المطبخ ←' },
    ]),
    floor('floor_terrace', 'branch_main', 'التراس', 'Terrace', 20, [
      { id: 'd5', kind: 'PLANT', x: 30, y: 30, w: 60, h: 60 }, { id: 'd6', kind: 'PLANT', x: 910, y: 30, w: 60, h: 60 },
      { id: 'd7', kind: 'PLANT', x: 30, y: 530, w: 60, h: 60 }, { id: 'd8', kind: 'WALL', x: 0, y: 300, w: 20, h: 300, label: '' },
      { id: 'd9', kind: 'DOOR', x: 420, y: 0, w: 160, h: 26, label: 'باب الصالة' },
    ]),
    floor('floor_upper', 'branch_main', 'الدور التاني', 'Upper floor', 30, [
      { id: 'd10', kind: 'LABEL', x: 40, y: 30, w: 260, h: 40, label: 'ركن العائلات' },
      { id: 'd11', kind: 'DOOR', x: 860, y: 560, w: 110, h: 30, label: 'السلم' },
    ]),
    floor('floor_second_hall', 'branch_second', 'الصالة', 'Hall', 10, [{ id: 'd12', kind: 'DOOR', x: 440, y: 580, w: 120, h: 30, label: 'المدخل' }]),
  ];
  // tables on the upper floor (new in this area; names do not clash with the provisioning set)
  for (const [i, cap] of [4, 4, 6, 10].entries()) {
    const id = `tbl_up_${i + 1}`;
    if (!db.tables.some((t) => t.id === id)) db.tables.push({ id, branchId: 'branch_main', name: String(21 + i), area: 'الدور التاني', capacity: cap, active: true, version: 1 });
  }
  const L = (tableId: string, floorId: string, x: number, y: number, shape: TableLayout['shape'], seats: number, w = 110, h = 110): TableLayout => ({ tableId, floorId, x, y, w, h, shape, rotation: 0, seats });
  db.tableLayouts = [
    L('tbl_1', 'floor_hall', 90, 170, 'SQUARE', 4), L('tbl_2', 'floor_hall', 290, 170, 'SQUARE', 4), L('tbl_3', 'floor_hall', 490, 170, 'SQUARE', 4), L('tbl_4', 'floor_hall', 690, 170, 'SQUARE', 4),
    L('tbl_5', 'floor_hall', 80, 380, 'RECT', 6, 170, 110), L('tbl_6', 'floor_hall', 320, 380, 'RECT', 6, 170, 110), L('tbl_7', 'floor_hall', 560, 380, 'SQUARE', 4), L('tbl_8', 'floor_hall', 760, 390, 'ROUND', 2, 90, 90),
    L('tbl_9', 'floor_terrace', 160, 140, 'ROUND', 2, 90, 90), L('tbl_10', 'floor_terrace', 380, 140, 'ROUND', 2, 90, 90), L('tbl_11', 'floor_terrace', 620, 140, 'SQUARE', 4), L('tbl_12', 'floor_terrace', 300, 340, 'RECT', 8, 300, 120),
    L('tbl_up_1', 'floor_upper', 120, 150, 'SQUARE', 4), L('tbl_up_2', 'floor_upper', 340, 150, 'SQUARE', 4), L('tbl_up_3', 'floor_upper', 580, 150, 'RECT', 6, 170, 110), L('tbl_up_4', 'floor_upper', 200, 360, 'BOOTH', 10, 360, 130),
    L('tbl_second_7', 'floor_second_hall', 440, 240, 'SQUARE', 4),
  ];
  db.tableTurns = [];

  // ───────── the 28 business days before today: sales history (aggregates) and closed days
  const today = businessDate(nowMs);
  const names: Loc[] = [{ ar: 'مشويات مشكلة', en: 'Mixed grill' }, { ar: 'شاورما فراخ', en: 'Chicken shawarma' }, { ar: 'كفتة مشوية', en: 'Grilled kofta' }, { ar: 'برجر لحم', en: 'Beef burger' }, { ar: 'حمص', en: 'Hummus' }, { ar: 'شاي', en: 'Tea' }, { ar: 'عصير برتقال', en: 'Orange juice' }, { ar: 'أم علي', en: 'Om Ali' }];
  const prices = [320, 140, 210, 180, 45, 20, 45, 70];
  const hist: SalesHistoryDay[] = [];
  const days: BusinessDayRec[] = [];
  for (let n = 28; n >= 1; n--) {
    const date = addDays(today, -n);
    const wd = new Date(date + 'T12:00:00Z').getUTCDay();
    for (const branchId of ['branch_main', 'branch_second']) {
      const scale = branchId === 'branch_main' ? 1 : 0.45;
      const weekend = wd === 4 || wd === 5 ? 1.35 : wd === 6 ? 1.15 : 1;
      const r = rnd(n * 7 + (branchId === 'branch_main' ? 1 : 3));
      const orders = Math.round((95 + r * 50) * weekend * scale);
      const avg = 205 + rnd(n * 13) * 60;
      const net = D(orders).times(avg).toDecimalPlaces(0);
      const byHour = Array.from({ length: 24 }, (_, h) => {
        const w = h >= 13 && h <= 16 ? 1.4 : h >= 19 && h <= 23 ? 2.2 : h >= 10 && h < 13 ? 0.6 : h < 2 ? 0.8 : h >= 17 && h < 19 ? 0.9 : 0.05;
        return w;
      });
      const sumW = byHour.reduce((a, b) => a + b, 0);
      const hours = byHour.map((w) => Math.round((net.toNumber() * w) / sumW));
      const cash = net.times(0.58 + rnd(n) * 0.06).toDecimalPlaces(0);
      const card = net.times(0.3).toDecimalPlaces(0);
      const wallet = net.minus(cash).minus(card);
      const top = names.map((nm, i) => { const qty = Math.round(orders * (0.15 + rnd(n * 31 + i) * 0.35)); return { name: nm, qty, amount: m4(qty * prices[i]) }; }).sort((a, b) => Number(b.amount) - Number(a.amount));
      const guests = Math.round(orders * 2.3);
      hist.push({ branchId, businessDate: date, netSales: m4(net), orders, guests, byHour: hours, byMethod: { CASH: m4(cash), CARD: m4(card), DIGITAL_WALLET: m4(wallet) }, topItems: top });
      if (n <= 7) {
        const tax = net.times(0.14).toDecimalPlaces(2);
        const service = branchId === 'branch_main' ? net.times(0.12).toDecimalPlaces(2) : D(0);
        const variance = rnd(n * 17) > 0.7 ? D(-Math.round(rnd(n) * 40)) : D(0);
        days.push({
          date, branchId, state: 'CLOSED', closedAt: new Date(Date.parse(addDays(date, 1) + 'T01:15:00Z')).toISOString(), closedBy: 'u_manager_1', note: null, warningsAcknowledged: [],
          summary: {
            orders, guests, netSales: m4(net), payable: m4(net.plus(tax).plus(service)), tax: m4(tax), service: m4(service), avgCheck: m4(net.dividedBy(orders)),
            payments: { CASH: m4(cash), CARD: m4(card), DIGITAL_WALLET: m4(wallet) }, refunds: m4(rnd(n * 5) > 0.6 ? 180 : 0), refundCount: rnd(n * 5) > 0.6 ? 1 : 0,
            discounts: m4(net.times(0.03).toDecimalPlaces(0)), discountCount: Math.round(orders * 0.08), comps: rnd(n * 3) > 0.8 ? 1 : 0, voidedLines: Math.round(rnd(n * 11) * 5), voidedAmount: m4(Math.round(rnd(n * 11) * 5) * 95),
            cancelledOrders: Math.round(rnd(n * 19) * 3), voidedOrders: rnd(n * 23) > 0.85 ? 1 : 0, cashVariance: m4(variance), tips: m4(Math.round(orders * 6)), sessions: branchId === 'branch_main' ? 2 : 1,
          },
          nextBusinessDate: addDays(date, 1), version: 1,
        });
      }
    }
  }
  db.salesHistory = hist;
  db.businessDays = days;

  // card / wallet settlements reported by the providers for the past week (main branch)
  const batches: SettlementBatch[] = [];
  for (const h of hist.filter((x) => x.branchId === 'branch_main').slice(-7)) {
    const missing = h.businessDate === addDays(today, -2) ? 250 : 0;
    batches.push({ id: `sb_card_${h.businessDate}`, branchId: 'branch_main', businessDate: h.businessDate, provider: 'ماكينة البنك الأهلي', method: 'CARD', amount: m4(D(h.byMethod.CARD).minus(missing)), count: Math.round(h.orders * 0.3), receivedAt: new Date(Date.parse(addDays(h.businessDate, 1) + 'T08:00:00Z')).toISOString() });
    batches.push({ id: `sb_wallet_${h.businessDate}`, branchId: 'branch_main', businessDate: h.businessDate, provider: 'إنستاباي', method: 'DIGITAL_WALLET', amount: h.byMethod.DIGITAL_WALLET, count: Math.round(h.orders * 0.1), receivedAt: new Date(Date.parse(addDays(h.businessDate, 1) + 'T09:00:00Z')).toISOString() });
  }
  db.settlementBatches = batches;

  // a reconciliation already run for the last two days (one difference explained, one waiting)
  const y1 = addDays(today, -1), y2 = addDays(today, -2);
  const h1 = hist.find((x) => x.branchId === 'branch_main' && x.businessDate === y1)!;
  const h2 = hist.find((x) => x.branchId === 'branch_main' && x.businessDate === y2)!;
  const results: ReconResult[] = [
    { id: 'rr_seed_1', runId: 'run_seed_1', ruleId: 'CARD_SETTLEMENT', key: `CARD:${y2}`, title: { ar: `كروت ${y2}: المتحصل مقابل تسوية البنك`, en: `Cards ${y2}` }, businessDate: y2, expected: h2.byMethod.CARD, actual: m4(D(h2.byMethod.CARD).minus(250)), difference: m4(-250), status: 'UNEXPLAINED_DIFFERENCE', drilldown: [{ kind: 'SETTLEMENT', id: `sb_card_${y2}`, label: 'تسوية ماكينة البنك الأهلي', amount: m4(D(h2.byMethod.CARD).minus(250)) }], note: { ar: 'عملية كارت واحدة مش ظاهرة في تسوية البنك', en: 'one card payment missing in the bank batch' }, ackBy: null, ackAt: null, ackReason: null, version: 1 },
    { id: 'rr_seed_2', runId: 'run_seed_1', ruleId: 'DRAWER_CASH', key: `DRAWER:${y1}:T1`, title: { ar: `درج الكاشير T1 — ${y1}`, en: `Drawer T1 ${y1}` }, businessDate: y1, expected: m4(D(h1.byMethod.CASH).plus(500)), actual: m4(D(h1.byMethod.CASH).plus(470)), difference: m4(-30), status: 'EXPLAINED', drilldown: [], note: null, ackBy: 'u_manager_1', ackAt: new Date(nowMs - DAY / 2).toISOString(), ackReason: 'فكة اتدّت غلط لعميل — اتكلمنا مع الكاشير', version: 2 },
    { id: 'rr_seed_3', runId: 'run_seed_1', ruleId: 'WALLETS', key: `WALLET:${y1}`, title: { ar: `محافظ ${y1}: إنستاباي`, en: `Wallets ${y1}` }, businessDate: y1, expected: h1.byMethod.DIGITAL_WALLET, actual: h1.byMethod.DIGITAL_WALLET, difference: m4(0), status: 'MATCHED', drilldown: [], note: null, ackBy: null, ackAt: null, ackReason: null, version: 1 },
  ];
  const run: ReconRun = { id: 'run_seed_1', ruleId: 'ALL', branchId: 'branch_main', from: y2, to: y1, at: new Date(nowMs - DAY / 2).toISOString(), by: 'u_manager_1', resultIds: results.map((r) => r.id), counts: { MATCHED: 1, UNEXPLAINED_DIFFERENCE: 1, EXPLAINED: 1 } };
  db.reconRuns = [run];
  db.reconResults = results;

  // ───────── outbox: webhooks to outside systems (the kitchen, printing and e-receipt queues come from real activity)
  const wh = (id: string, consumerId: string, ar: string, en: string, eventType: string, label: string, state: WebhookDelivery['state'], errors: (string | null)[], ageMin: number): WebhookDelivery => ({
    id, consumerId, consumerName: { ar, en }, eventType, ref: id, label, state, createdAt: new Date(nowMs - ageMin * 60_000).toISOString(), nextAtMs: state === 'FAILED' ? nowMs + 60_000 : 0, version: errors.length + 1,
    attempts: errors.map((e, i) => ({ at: new Date(nowMs - (ageMin - i * 3) * 60_000).toISOString(), error: e })),
  });
  db.webhookDeliveries = [
    wh('wh_1', 'accounting', 'برنامج الحسابات', 'Accounting', 'BusinessDayClosed', `إقفال يوم ${y1}`, 'DELIVERED', [null], 600),
    wh('wh_2', 'accounting', 'برنامج الحسابات', 'Accounting', 'BusinessDayClosed', `إقفال يوم ${y2}`, 'DEAD', ['WEBHOOK_401', 'WEBHOOK_401', 'WEBHOOK_401', 'WEBHOOK_401', 'WEBHOOK_401'], 1900),
    wh('wh_3', 'aggregator', 'تطبيق التوصيل (طلبات)', 'Delivery app', 'MenuAvailabilityChanged', 'الكنافة خلصت', 'FAILED', ['WEBHOOK_TIMEOUT', 'WEBHOOK_TIMEOUT'], 45),
    wh('wh_4', 'loyalty', 'تطبيق الولاء', 'Loyalty app', 'OrderCompleted', 'شيك يوم أمس', 'DELIVERED', [null], 900),
  ];

  // ───────── report schedules
  const sched = (id: string, reportId: string, ar: string, en: string, frequency: 'DAILY' | 'WEEKLY', weekday: number | null, time: string, recipients: string[], format: 'CSV' | 'XLSX'): ReportSchedule => {
    const next = nextRun(nowMs, frequency, weekday, time);
    return { id, reportId, reportTitle: { ar, en }, frequency, weekday, time, format, recipients, branchId: 'branch_main', active: true, createdAt: new Date(nowMs - 10 * DAY).toISOString(), createdBy: 'u_manager_1', nextRunAt: new Date(next).toISOString(), nextRunMs: next, runs: [{ at: new Date(next - (frequency === 'DAILY' ? DAY : 7 * DAY)).toISOString(), status: 'SENT', note: 'اتبعت' }], version: 1 };
  };
  db.reportSchedules = [
    sched('rs_1', 'daily_sales', 'مبيعات اليوم', 'Daily sales', 'DAILY', null, '04:30', ['أ. محمود (المالك)', 'أ. هاني (المحاسب)'], 'XLSX'),
    sched('rs_2', 'products', 'الأصناف', 'Products', 'WEEKLY', 6, '10:00', ['شيف حسن'], 'CSV'),
  ];
  db.reportExports = [];
  db.approvalRequests = [];
  db.offlineItems = [];
  db.syncTerminals = [];
  db.ticketMeta = [];
  db.capabilities = [];
}

/** Next run of a schedule after `nowMs`, in Cairo local time. */
export function nextRun(nowMs: number, frequency: 'DAILY' | 'WEEKLY', weekday: number | null, time: string): number {
  const [hh, mm] = time.split(':').map(Number);
  const p = zonedParts(nowMs, 'Africa/Cairo');
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(nowMs / 1000) * 1000;
  let t = Date.UTC(p.year, p.month - 1, p.day, hh, mm) - offset;
  for (let i = 0; i < 9 && (t <= nowMs || (frequency === 'WEEKLY' && weekday !== null && zonedParts(t, 'Africa/Cairo').weekday !== weekday)); i++) t += DAY;
  return t;
}
