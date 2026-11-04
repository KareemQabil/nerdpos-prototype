// ux-14: the device registry (organization owns it — the peripherals and display screens attached to its terminals),
// print routing to the registered printers, device status, the display content library and its schedule, and each
// terminal's keyboard changes. Device failures are never swallowed: a job that cannot reach its device fails visibly
// (retryable, an alert is raised) and committed business truth never depends on it.
import type { DB, PrintJob } from './types';
import type { Device, DevState, DeviceKind, DisplayContent, PrintRole, ContentSchedule } from './types-devices';
import { nextId } from './store';
import { clock, zonedParts } from './clock';
import { sim } from './sim';
import { policyFields } from './policies';

export function devOf(db: DB): DevState {
  if (!db.dev) {
    db.dev = { devices: [], content: [], keys: [] };
    seedDevices(db, clock.now()); // a database saved before ux-14: its demo terminals get their devices (none on a fresh install)
  }
  db.dev.devices ??= []; db.dev.content ??= []; db.dev.keys ??= [];
  return db.dev;
}

// ───────── policies (strictest workable defaults; PROTOTYPE_GAPS §15k)
export interface CustomerDisplayRule { idleContent: 'ASSIGNED_ONLY' | 'ASSIGNED_AND_PROMOTIONS'; slideSeconds: number; thanksSeconds: number }
export interface PrintRoutingRule { fallback: 'NONE' | 'BRANCH_BACKUP' }
export interface DeviceHealthRule { offlineAfterSeconds: number }
export interface KeyMapRule { changeBy: 'MANAGERS' | 'ANY_SIGNED_IN' }
export const CUSTOMER_DISPLAY_DEFAULT: CustomerDisplayRule = { idleContent: 'ASSIGNED_ONLY', slideSeconds: 8, thanksSeconds: 60 };
export const PRINT_ROUTING_DEFAULT: PrintRoutingRule = { fallback: 'NONE' };
export const DEVICE_HEALTH_DEFAULT: DeviceHealthRule = { offlineAfterSeconds: 120 };
export const KEYMAP_DEFAULT: KeyMapRule = { changeBy: 'MANAGERS' };
export const customerDisplayRule = (branchId?: string | null): CustomerDisplayRule => ({ ...CUSTOMER_DISPLAY_DEFAULT, ...policyFields<CustomerDisplayRule>('CustomerDisplayPolicy', { branchId }) });
export const printRoutingRule = (branchId?: string | null): PrintRoutingRule => ({ ...PRINT_ROUTING_DEFAULT, ...policyFields<PrintRoutingRule>('PrintRoutingPolicy', { branchId }) });
export const deviceHealthRule = (branchId?: string | null): DeviceHealthRule => ({ ...DEVICE_HEALTH_DEFAULT, ...policyFields<DeviceHealthRule>('DeviceHealthPolicy', { branchId }) });
export const keyMapRule = (branchId?: string | null): KeyMapRule => ({ ...KEYMAP_DEFAULT, ...policyFields<KeyMapRule>('KeyMapPolicy', { branchId }) });

// ───────── print routing
/** The printer role a document needs. */
export function roleOf(documentType: PrintJob['documentType']): PrintRole | null {
  if (documentType === 'KITCHEN_TICKET') return 'KITCHEN';
  if (documentType === 'X_REPORT' || documentType === 'Z_REPORT') return 'REPORT';
  if (documentType === 'TEST_PAGE' || documentType === 'DRAWER_KICK') return null; // always pinned to one device
  return 'RECEIPT';
}
/** Where a job goes now: its pinned device, else an enabled printer of its terminal with the role, else (BRANCH_BACKUP)
 *  the branch's backup printer. `error` names why nothing can take it — the job fails visibly with that error. */
export function resolvePrinter(db: DB, j: PrintJob): { device: Device | null; error: string | null } {
  const devs = devOf(db).devices;
  if (j.pinned && j.printerId) {
    const d = devs.find((x) => x.id === j.printerId) ?? null;
    if (!d) return { device: null, error: 'NO_PRINTER' };
    if (!d.enabled) return { device: d, error: 'DEVICE_DISABLED' };
    return { device: d, error: null };
  }
  const role = roleOf(j.documentType);
  const term = db.terminals.find((t) => t.id === j.terminalId);
  const fits = (d: Device) => d.kind === 'PRINTER' && !!role && (d.printer?.roles ?? []).includes(role);
  const own = devs.filter((d) => fits(d) && d.terminalId === j.terminalId);
  const on = own.find((d) => d.enabled);
  if (on) return { device: on, error: null };
  if (term && printRoutingRule(term.branchId).fallback === 'BRANCH_BACKUP') {
    const backup = devs.find((d) => fits(d) && d.enabled && d.printer?.backup && d.branchId === term.branchId);
    if (backup) return { device: backup, error: null };
  }
  return { device: own[0] ?? null, error: own.length ? 'DEVICE_DISABLED' : 'NO_PRINTER' };
}

/** The simulated state the device reports (the demo's fault simulator): by device id; a printer also by its terminal
 *  (the simulator's former per-terminal printer switch). */
export function simState(d: Device): 'UP' | 'DOWN' | 'PAPER_OUT' | 'ERROR' {
  const s = sim.get().printers as Record<string, string>;
  const v = s[d.id] ?? (d.kind === 'PRINTER' && d.terminalId ? s[d.terminalId] : undefined);
  return (v as any) ?? 'UP';
}

export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'PAPER_OUT' | 'ERROR' | 'DISABLED' | 'NOT_SEEN';
/** What the device is doing now. A display is online while it has read its screen within DeviceHealthPolicy. */
export function deviceStatus(db: DB, d: Device, now = clock.now()): DeviceStatus {
  if (!d.enabled) return 'DISABLED';
  const host = d.terminalId ? db.terminals.find((t) => t.id === d.terminalId) : null;
  if (d.terminalId && (!host || host.lifecycle !== 'ACTIVE' || sim.isOffline(d.terminalId))) return 'OFFLINE';
  const s = simState(d);
  if (s === 'DOWN') return 'OFFLINE';
  if (s === 'PAPER_OUT') return d.kind === 'PRINTER' ? 'PAPER_OUT' : 'ERROR';
  if (s === 'ERROR') return 'ERROR';
  if (d.kind === 'CUSTOMER_DISPLAY' || d.kind === 'CALL_BOARD') {
    if (!d.lastSeenAt) return 'NOT_SEEN';
    const age = (now - Date.parse(d.lastSeenAt)) / 1000;
    if (age > deviceHealthRule(d.branchId).offlineAfterSeconds) return 'OFFLINE';
  }
  return 'ONLINE';
}

/** A device failure is raised once while it is not acknowledged (System health, the print queue banner). */
export function raiseDeviceAlert(db: DB, d: Device, error: string, jobLabel: string) {
  const ref = `dev-${d.id}-${error}`;
  if (db.alerts.some((a) => a.ref === ref && !a.ack)) return;
  const what: Record<string, [string, string]> = {
    PAPER_OUT: ['نفد الورق', 'paper out'], PRINTER_UNREACHABLE: ['لا يستجيب', 'not responding'], DEVICE_ERROR: ['عطل', 'error'],
    DEVICE_DISABLED: ['متوقف', 'disabled'], NO_PRINTER: ['لا توجد طابعة', 'no printer'],
  };
  const [ar, en] = what[error] ?? ['عطل', 'error'];
  db.alerts.unshift({ id: nextId('al'), at: clock.iso(), kind: 'DEVICE_FAILURE', severity: 'error', text: { ar: `${d.code}: ${ar} — ${jobLabel}`, en: `${d.code}: ${en} — ${jobLabel}` }, ref, ack: false });
}

/** Enqueue a drawer kick on the terminal's cash drawer (a side effect of a cash capture or a no-sale opening, written in
 *  the same transaction). No drawer registered → nothing to open (null). It never creates or moves money. */
export function kickDrawer(db: DB, enqueue: (db: DB, j: any) => PrintJob, terminalId: string | null | undefined, documentId: string, label: string, by: string): PrintJob | null {
  if (!terminalId) return null;
  const d = devOf(db).devices.find((x) => x.kind === 'CASH_DRAWER' && x.terminalId === terminalId);
  if (!d) return null;
  return enqueue(db, { documentType: 'DRAWER_KICK', documentId, copyKind: 'ORIGINAL', terminalId, createdBy: by, label, printerId: d.id, pinned: true });
}

// ───────── display content
const pad = (n: number) => String(n).padStart(2, '0');
/** Is the content inside its schedule now (branch local date, weekday and daily window)? */
export function contentActiveNow(c: DisplayContent, now: number, timeZone = 'Africa/Cairo'): boolean {
  if (c.retired) return false;
  const s = c.schedule;
  const p = zonedParts(now, timeZone);
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  if (s.from && day < s.from) return false;
  if (s.to && day > s.to) return false;
  if (s.days?.length && !s.days.includes(p.weekday)) return false;
  if (s.start && s.end) {
    const hm = `${pad(p.hour)}:${pad(p.minute)}`;
    const inside = s.start <= s.end ? hm >= s.start && hm < s.end : hm >= s.start || hm < s.end;
    if (!inside) return false;
  }
  return true;
}
export const EMPTY_SCHEDULE: ContentSchedule = { from: null, to: null, start: null, end: null, days: [] };
export const CONTENT_IMAGE_MAX = 300_000; // ≈ 220 KB picture as a data URL

export const isDisplayKind = (k: DeviceKind) => k === 'CUSTOMER_DISPLAY' || k === 'CALL_BOARD';

// ───────── seed (demo restaurant)
const banner = (emoji: string, a: string, b: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="360" rx="36" fill="url(#g)"/><text x="320" y="230" font-size="170" text-anchor="middle">${emoji}</text></svg>`);

/** Printers, drawers, a scanner, the two display screens, the content library and the customer display's playlist.
 *  Idempotent: only for the demo terminals that exist (a fresh install has none). */
export function seedDevices(db: DB, nowMs: number) {
  const st = db.dev!;
  const iso = new Date(nowMs).toISOString();
  const has = (id: string) => db.terminals.some((t) => t.id === id && t.lifecycle === 'ACTIVE');
  const meta = { version: 1, createdAt: iso, createdBy: 'provisioning', updatedAt: iso, updatedBy: 'provisioning', lastSeenAt: null };
  const P = (id: string, code: string, name: string, terminalId: string | null, roles: PrintRole[], extra: Partial<Device['printer']> = {}): Device => ({ id, code, name, kind: 'PRINTER', branchId: 'branch_main', terminalId, enabled: true, printer: { roles, stationIds: [], paper: '80MM', connection: terminalId ? 'USB' : 'NETWORK', address: terminalId ? null : '192.168.1.60', backup: false, ...extra }, ...meta });
  const add = (d: Device) => { if (!st.devices.some((x) => x.id === d.id)) st.devices.push(d); };
  if (has('t_cash')) { add(P('prn_cash', 'PRN-CASH-1', 'طابعة الكاشير 1', 't_cash', ['RECEIPT', 'REPORT'])); add({ id: 'drw_cash', code: 'DRW-CASH-1', name: 'درج النقدية 1', kind: 'CASH_DRAWER', branchId: 'branch_main', terminalId: 't_cash', enabled: true, ...meta }); add({ id: 'scn_cash', code: 'SCN-CASH-1', name: 'ماسح الباركود 1', kind: 'SCANNER', branchId: 'branch_main', terminalId: 't_cash', enabled: true, ...meta }); }
  if (has('t_cash2')) { add(P('prn_cash2', 'PRN-CASH-2', 'طابعة الكاشير 2', 't_cash2', ['RECEIPT', 'REPORT'])); add({ id: 'drw_cash2', code: 'DRW-CASH-2', name: 'درج النقدية 2', kind: 'CASH_DRAWER', branchId: 'branch_main', terminalId: 't_cash2', enabled: true, ...meta }); }
  if (has('t_floor')) add(P('prn_floor', 'PRN-FLOOR-1', 'طابعة الصالة', 't_floor', ['RECEIPT']));
  if (has('t_admin')) add(P('prn_office', 'PRN-OFFICE', 'طابعة المكتب', 't_admin', ['RECEIPT', 'REPORT'], { paper: '80MM' }));
  if (has('t_second_floor')) add({ ...P('prn_second', 'PRN-B2-1', 'طابعة الفرع الثاني', 't_second_floor', ['RECEIPT']), branchId: db.terminals.find((t) => t.id === 't_second_floor')!.branchId });
  if (has('t_kds')) add(P('prn_kitchen', 'PRN-KITCHEN', 'طابعة المطبخ', null, ['KITCHEN']));
  // the display screens of the demo (ux-04): the call board follows the dispatch screen, the customer display cashier 1
  if (has('t_kds')) add({ id: 'd_callboard', code: 'CB-1', name: 'شاشة النداء', kind: 'CALL_BOARD', branchId: 'branch_main', terminalId: 't_kds', enabled: true, display: { style: 'theme', branding: true, playlist: [] }, ...meta });
  if (!has('t_cash')) return;
  add({ id: 'd_customer', code: 'CD-1', name: 'شاشة العميل', kind: 'CUSTOMER_DISPLAY', branchId: 'branch_main', terminalId: 't_cash', enabled: true, display: { style: 'theme', branding: true, playlist: [] }, ...meta });
  const C = (id: string, kind: DisplayContent['kind'], title: [string, string], extra: Partial<DisplayContent> = {}): DisplayContent => ({ id, kind, title: { ar: title[0], en: title[1] }, body: null, imageDataUrl: null, promotionId: null, productId: null, schedule: { ...EMPTY_SCHEDULE }, retired: false, retiredReason: null, version: 1, createdAt: iso, createdBy: 'provisioning', updatedAt: iso, updatedBy: 'provisioning', ...extra });
  const items: DisplayContent[] = [];
  const promo = (pid: string) => db.promotions.find((p) => p.id === pid);
  if (promo('promo_1')) items.push(C('dc_happy', 'PROMOTION', ['ساعة المشروبات الباردة', 'Cold drinks happy hour'], { promotionId: 'promo_1' }));
  if (promo('promo_2')) items.push(C('dc_welcome', 'PROMOTION', ['كود الترحيب', 'Welcome code'], { promotionId: 'promo_2' }));
  items.push(C('dc_breakfast', 'MESSAGE', ['الفطور المصري كل صباح', 'Egyptian breakfast every morning'], { body: { ar: 'من 8 صباحًا حتى 12 ظهرًا', en: 'From 8 am to 12 noon' }, schedule: { ...EMPTY_SCHEDULE, start: '08:00', end: '12:00' } }));
  items.push(C('dc_family', 'IMAGE', ['وجبات العائلة', 'Family meals'], { body: { ar: 'اسأل الكاشير عن وجبات العائلة', en: 'Ask the cashier about family meals' }, imageDataUrl: banner('🍽️', '#fde68a', '#f97316') }));
  for (const p of db.products.filter((x) => x.active !== false && x.imageUrl && !(x as any).direction).slice(0, 4)) items.push(C(`dc_dish_${p.id}`, 'DISH', [p.name.ar, p.name.en ?? p.name.ar], { productId: p.id }));
  if (promo('promo_late_desserts')) items.push(C('dc_desserts', 'PROMOTION', ['حلويات آخر الليل', 'Late-night desserts'], { promotionId: 'promo_late_desserts' }));
  for (const c of items) if (!st.content.some((x) => x.id === c.id)) st.content.push(c);
  const cd = st.devices.find((d) => d.id === 'd_customer');
  if (cd?.display && !cd.display.playlist.length) cd.display.playlist = items.filter((c) => c.id !== 'dc_desserts').map((c) => c.id); // the late-night desserts slide waits in the library, unassigned
}
