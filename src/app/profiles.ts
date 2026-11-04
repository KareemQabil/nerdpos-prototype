// Work profiles (UI only — NOT permissions). A profile decides which workspaces a person sees, where they start,
// the action bar (fixed positions, order, overflow), how quantities are entered and touch vs keyboard density.
// Permissions still come from the server (Access.Me); a button the profile shows but the user may not run is
// shown locked (needs approval) or disabled — never hidden silently behind a permission the profile did not ask for.
// Source: ROLES_PROPOSAL.csv (owner interview 2026-11-03). The cashier profile is fully used by the sale screen.

import type { WorkProfileId } from '../mock/ux-contracts';

/** Every action the sale screen's action bar knows. Positions come from the profile, never from state. */
export type SaleAction =
  | 'new' | 'held' | 'customer' | 'discount' | 'orders'
  | 'note' | 'prebill' | 'comp' | 'move' | 'split' | 'merge' | 'channel' | 'cancel' | 'history'
  | 'delivery' | 'staffMeal' | 'staffMeals' | 'soldOut' | 'drawer' | 'mode' | 'search' | 'shortcuts' | 'more'
  | 'guests' | 'label' | 'undo' | 'viewTables' | 'viewChecks' | 'viewClosed'
  | 'modeTakeaway' | 'modeDineIn' | 'modeDelivery'
  // ux-10: the drawer's jobs, as popups over the sale screen («drawer» opens the shift popup)
  | 'cashIn' | 'cashOut' | 'noSale' | 'xReport' | 'closeShift'
  // ux-10b: the shift handover (a popup over the sale screen)
  | 'handover';

/** What the big primary button does; 'auto' follows the check state (send → pay → finish paying). */
export type PrimaryAction = 'auto' | 'send' | 'pay' | 'seat' | 'ready' | 'delivered' | 'dispatch' | 'confirm';
// waiter: 'send' = إرسال للمطبخ (unsent lines) → then الشيك المبدئي; the waiter never takes payment (no drawer).

export type QuantityMethod = 'typedPrefix' | 'repeatTap' | 'stepper' | 'swipe' | 'longPress';

export interface Profile {
  /** ux-09: one of the server's work profile ids (User.SetProfile accepts exactly these) */
  id: WorkProfileId;
  group: { ar: string; en: string };
  role: { ar: string; en: string };
  /** device screens (registry ids) this profile works in; [] = decided by permissions only */
  workspaces: string[];
  start: string;
  actionBar: { secondary: SaleAction[]; overflow: SaleAction[]; primary: PrimaryAction };
  /** the four quantity methods, each can be switched off per profile */
  quantity: Record<QuantityMethod, boolean>;
  input: 'touch' | 'keyboard' | 'mixed';
  /** areas kept out of this profile's way (plain words, UI only) */
  hidden: string[];
  /** ux-05: first view of the boards this profile works with (each person can switch; the choice is remembered) */
  boards?: Partial<Record<BoardId, 'board' | 'list'>>;
  /** ux-05 owner rule: the sale screen's peer modes this profile has (default all three) and the one it opens in.
   *  «دليفري» also needs delivery:create on the server; without it the mode is hidden. */
  saleModes?: SaleMode[];
  defaultMode?: SaleMode;
  /** ux-09: the profile's own keys on top of the default map (sale screen / kitchen bump bar); a device can override
   *  any key («?» overlay, swap on conflict). Effective map = defaults ← profile ← device. */
  keys?: Partial<Record<SaleAction | 'primary', string>>;
  kdsKeys?: Partial<Record<KdsAction, string>>;
}

/** The cashier's three peer jobs: sell تيك أواي, close a ترابيزة (الصالة), sell دليفري. */
export type SaleMode = 'takeaway' | 'dinein' | 'delivery';

/** ux-05: the four boards. orders = «الشيكات», delivery = «لوحة الدليفري», purchasing = «أوامر الشراء», approvals = «الموافقات والمراجعات». */
export type BoardId = 'orders' | 'delivery' | 'purchasing' | 'approvals';

const ALL_QTY: Record<QuantityMethod, boolean> = { typedPrefix: true, repeatTap: true, stepper: true, swipe: true, longPress: true };
const TOUCH_QTY: Record<QuantityMethod, boolean> = { typedPrefix: false, repeatTap: true, stepper: true, swipe: true, longPress: true };
const NO_QTY: Record<QuantityMethod, boolean> = { typedPrefix: false, repeatTap: false, stepper: false, swipe: false, longPress: false };
const g = (ar: string, en: string) => ({ ar, en });
const SALE_OVERFLOW: SaleAction[] = ['label', 'staffMeal', 'staffMeals', 'prebill', 'comp', 'channel', 'cancel', 'history', 'soldOut', 'drawer', 'shortcuts'];

export const PROFILES: Profile[] = [
  // ── floor & counter
  { id: 'cashier', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('كاشير', 'Cashier'), workspaces: ['counter', 'shift', 'receipt', 'refunds'], start: 'counter', boards: { orders: 'list' }, /* ux-07: the cashier's checks list is inside the sale screen (F7); the checks page (sidenav until ux-09) stays a list */ saleModes: ['takeaway', 'dinein', 'delivery'], defaultMode: 'takeaway',
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'mixed', hidden: ['expectedCash', 'reports'] },
  { id: 'waiter', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('ويتر', 'Waiter'), workspaces: ['floor', 'order'], start: 'floor',
    actionBar: { secondary: ['guests', 'prebill', 'move', 'note'], overflow: ['customer', 'split', 'merge', 'history', 'cancel'], primary: 'send' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['collection', 'drawer', 'reports'] },
  { id: 'captain', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('كابتن صالة', 'Floor captain'), workspaces: ['floor', 'order', 'checks', 'reservations'], start: 'floor', boards: { orders: 'board' },
    actionBar: { secondary: ['guests', 'prebill', 'move', 'merge', 'split'], overflow: ['note', 'customer', 'history', 'cancel'], primary: 'send' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['drawer', 'financialReports'] },
  { id: 'host', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('مستقبل وحجوزات', 'Host & reservations'), workspaces: ['reservations', 'floor'], start: 'reservations',
    actionBar: { secondary: [], overflow: [], primary: 'seat' }, quantity: NO_QTY, input: 'touch', hidden: ['orders', 'payment'] },
  { id: 'runner', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('رانر', 'Runner'), workspaces: ['kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'delivered' }, quantity: NO_QTY, input: 'touch', hidden: ['everythingButHandover'] },
  { id: 'barista', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('باريستا', 'Barista'), workspaces: ['counter', 'kitchen'], start: 'kitchen', saleModes: ['takeaway'],
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['drawer', 'reports'] },
  { id: 'bartender', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('بارتندر', 'Bartender'), workspaces: ['counter', 'kitchen'], start: 'kitchen', saleModes: ['takeaway', 'dinein'], keys: { orders: 'F2', new: 'F7' },
    actionBar: { secondary: ['orders'], overflow: [], primary: 'ready' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['reports'] },
  // ── kitchen
  { id: 'stationChef', group: g('المطبخ', 'Kitchen'), role: g('شيف محطة', 'Station chef'), workspaces: ['kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'touch', hidden: ['prices', 'amounts'] },
  { id: 'expediter', group: g('المطبخ', 'Kitchen'), role: g('منسق التسليم', 'Expediter'), workspaces: ['kitchen', 'checks'], start: 'kitchen', boards: { orders: 'board' },
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'touch', hidden: ['amounts'] },
  { id: 'kitchenManager', group: g('المطبخ', 'Kitchen'), role: g('مدير مطبخ', 'Kitchen manager'), workspaces: ['kitchen', 'inv-waste', 'soldout'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'mixed', hidden: ['drawer', 'financialReports'] },
  // ── management
  { id: 'shiftManager', group: g('الإدارة', 'Management'), role: g('مدير وردية', 'Shift manager'), workspaces: ['approvals-inbox', 'checks', 'counter', 'floor', 'shift'], start: 'approvals-inbox', boards: { approvals: 'board', orders: 'board' }, saleModes: ['takeaway', 'dinein', 'delivery'],
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'mixed', hidden: [] },
  { id: 'branchManager', group: g('الإدارة', 'Management'), role: g('مدير فرع', 'Branch manager'), workspaces: [], start: 'approvals-inbox', boards: { approvals: 'board', orders: 'board', delivery: 'board', purchasing: 'board' },
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['systemSettings', 'license'] },
  { id: 'areaManager', group: g('الإدارة', 'Management'), role: g('مدير منطقة', 'Area manager'), workspaces: ['home', 'reports', 'approvals-inbox'], start: 'home', boards: { approvals: 'board' },
    actionBar: { secondary: [], overflow: [], primary: 'auto' }, quantity: NO_QTY, input: 'keyboard', hidden: ['dailyOperations'] },
  { id: 'owner', group: g('الإدارة', 'Management'), role: g('مالك', 'Owner'), workspaces: [], start: 'home', boards: { approvals: 'board', orders: 'board', delivery: 'board', purchasing: 'board' },
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['license'] },
  // ── back office
  { id: 'accountant', group: g('المكتب', 'Back office'), role: g('محاسب', 'Accountant'), workspaces: ['reports', 'approvals-inbox', 'void-review', 'refunds'], start: 'reports', boards: { approvals: 'board' },
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['sale'] },
  { id: 'auditor', group: g('المكتب', 'Back office'), role: g('مراجع داخلي', 'Internal auditor'), workspaces: ['reports', 'audit'], start: 'audit',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['anyWrite'] },
  { id: 'storekeeper', group: g('المكتب', 'Back office'), role: g('أمين مخزن', 'Storekeeper'), workspaces: ['inv-dashboard', 'inv-po', 'inv-receipts', 'inv-counts', 'inv-transfers', 'inv-waste'], start: 'inv-dashboard', boards: { purchasing: 'list' },
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'mixed', hidden: ['sales', 'prices'] },
  { id: 'purchasing', group: g('المكتب', 'Back office'), role: g('مسؤول مشتريات', 'Purchasing officer'), workspaces: ['inv-po', 'inv-purchasing', 'inv-suppliers'], start: 'inv-po', boards: { purchasing: 'board' },
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['sale'] },
  // ── delivery
  // ux-11: the rider works from his phone («طلباتي»); on a cashier terminal he falls back to the board, limited to his orders by the server
  { id: 'driver', group: g('الدليفري', 'Delivery'), role: g('طيار', 'Driver'), workspaces: ['rider', 'delivery-board'], start: 'rider', boards: { delivery: 'list' },
    actionBar: { secondary: [], overflow: [], primary: 'delivered' }, quantity: NO_QTY, input: 'touch', hidden: ['everythingButOwnOrders'] },
  { id: 'dispatcher', group: g('الدليفري', 'Delivery'), role: g('موزع الدليفري', 'Delivery dispatcher'), workspaces: ['delivery-board', 'counter', 'drivers'], start: 'delivery-board', boards: { delivery: 'board' }, saleModes: ['delivery'], defaultMode: 'delivery', /* ux-07: new deliveries from the sale screen's «دليفري» mode */
    actionBar: { secondary: [], overflow: [], primary: 'dispatch' }, quantity: NO_QTY, input: 'mixed', hidden: ['financialReports'] },
  { id: 'callCenter', group: g('الدليفري', 'Delivery'), role: g('مركز الاتصال', 'Call center'), workspaces: ['counter', 'customers'], start: 'counter', saleModes: ['delivery'], defaultMode: 'delivery', keys: { customer: 'F2', new: 'F4' },
    actionBar: { secondary: ['customer'], overflow: [], primary: 'confirm' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['drawer'] },
  // ── system
  { id: 'support', group: g('النظام', 'System'), role: g('فريق التركيب والدعم', 'Install & support team'), workspaces: ['import', 'settings', 'org', 'devices', 'capabilities'], start: 'org',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['customerPersonalData'] },
];

export const profileById = (id: string): Profile => PROFILES.find((p) => p.id === id) ?? PROFILES[0];

/** Default keys of the sale screen (per device they can be remapped without conflicts — see keymap.ts). */
export const SALE_KEYS: Partial<Record<SaleAction | 'primary', string>> = {
  shortcuts: 'F1', new: 'F2', held: 'F3', customer: 'F4', discount: 'F6', orders: 'F7', more: 'F8', mode: 'F9', search: 'F10', primary: 'Enter',
  viewTables: 'PageUp', viewChecks: 'PageDown', viewClosed: 'End',
  modeTakeaway: 'Insert', modeDineIn: 'Home', modeDelivery: 'Delete', // ux-05: the three peer modes (F9 still cycles)
  // ux-10: the drawer's jobs on Shift + a function key (the plain function keys are all taken)
  drawer: 'Shift+F1', cashIn: 'Shift+F2', cashOut: 'Shift+F3', noSale: 'Shift+F4', xReport: 'Shift+F6', closeShift: 'Shift+F7',
  handover: 'Shift+F8', // ux-10b
};

/** Kitchen screen actions a bump bar (or a keyboard) drives. ←/→ move between tickets and 1–9 pick one (fixed). */
export type KdsAction = 'kdsNext' | 'kdsPrev' | 'kdsBump' | 'kdsBumpItem' | 'kdsStart' | 'kdsPriority' | 'kdsUndo' | 'kdsRecall' | 'kdsCall' | 'kdsView' | 'kdsHelp';
/** Default bump-bar map: the keys a 10-key bump bar sends (each can be remapped per screen, swap on conflict). */
export const KDS_KEYS: Partial<Record<KdsAction, string>> = {
  kdsNext: 'ArrowDown', kdsPrev: 'ArrowUp', kdsBump: 'Enter', kdsBumpItem: ' ', kdsStart: '+', kdsPriority: '*', kdsUndo: 'Backspace', kdsRecall: '0', kdsCall: '-', kdsView: '/', kdsHelp: 'F1',
};

/**
 * The profile a role gives on this device (ux-09: the default — the owner decision «per user or from the role» is open,
 * so the role decides and a user may carry an override, see resolveProfile). Role names come from Access.Me; the
 * device kind breaks ties (a manager on a cashier terminal works the sale screen like a cashier, with the manager's bar).
 */
export function profileFor(roleNames: string[], deviceKind: string | null): Profile {
  const r = roleNames.map((x) => x.toLowerCase());
  const has = (...k: string[]) => r.some((x) => k.some((y) => x.includes(y)));
  if (has('owner', 'bootstrap')) return profileById(deviceKind === 'CASH' ? 'cashier' : 'owner');
  if (has('area manager')) return profileById('areaManager'); // ux-09: before «manager»
  if (has('manager')) return profileById(deviceKind === 'CASH' ? 'shiftManager' : deviceKind === 'KDS' ? 'kitchenManager' : 'branchManager');
  // ux-05: roles named after a profile get it (counter-only, call center, dispatch, purchasing, store)
  if (has('barista')) return profileById('barista');
  if (has('bartender')) return profileById('bartender');
  if (has('call center', 'callcenter')) return profileById('callCenter');
  if (has('dispatch')) return profileById('dispatcher');
  if (has('purchas')) return profileById('purchasing');
  if (has('storekeeper')) return profileById('storekeeper');
  // ux-09: the remaining profiles (each has a demo user)
  if (has('host')) return profileById('host');
  if (has('captain')) return profileById('captain');
  if (has('runner')) return profileById('runner');
  if (has('expedit')) return profileById('expediter');
  if (has('auditor')) return profileById('auditor');
  if (has('support')) return profileById('support');
  if (has('cashier')) return profileById('cashier');
  if (has('waiter', 'server')) return profileById('waiter');
  if (has('chef', 'kitchen', 'cook')) return profileById('stationChef');
  if (has('driver')) return profileById('driver');
  if (has('account')) return profileById('accountant');
  return profileById(deviceKind === 'FLOOR' ? 'waiter' : deviceKind === 'KDS' ? 'stationChef' : deviceKind === 'CASH' ? 'cashier' : 'owner');
}

// ───────── ux-09: the profile drives navigation (it only narrows what permissions and the device allow)

/** A workspace that stands for a family of screens: «التقارير» covers its tools (ask, designer, engine). */
const REPORT_SCREENS = ['reports', 'report-assistant', 'report-designer', 'report-catalog'];
const WORKSPACE_FAMILY: Record<string, string[]> = { reports: REPORT_SCREENS };
/** The `hidden` words of a profile that name screens. Other words (expectedCash, amounts, anyWrite…) hide parts of a
 *  screen, not a screen, and are read by the screens themselves. */
const HIDDEN_SCREENS: Record<string, string[]> = {
  reports: REPORT_SCREENS, financialReports: REPORT_SCREENS,
  license: ['capabilities'], systemSettings: ['capabilities', 'health', 'sync'],
  sale: ['counter'], sales: ['counter', 'checks'], orders: ['checks', 'counter'],
  payment: ['refunds', 'shift'], collection: ['refunds', 'shift'], drawer: ['shift'],
  prices: ['prices'], customerPersonalData: ['customers', 'customer', 'loyalty'],
  dailyOperations: ['counter', 'floor', 'checks', 'kitchen', 'shift', 'reservations'],
};
const screensOfWorkspace = (w: string) => WORKSPACE_FAMILY[w] ?? [w];
/** Whether the profile keeps this screen in the person's way (sidenav, screen search). Permissions and the device kind
 *  are checked separately and stay authoritative: a profile only narrows. */
export function profileShows(p: Profile, screenId: string): boolean {
  if (p.hidden.some((h) => HIDDEN_SCREENS[h]?.includes(screenId))) return false;
  return p.workspaces.length === 0 || p.workspaces.some((w) => screensOfWorkspace(w).includes(screenId));
}

/** What Access.Me / Auth.Login say about a user (roles with names, the optional profile override). */
export interface ProfileUser { roleAssignments?: { roleName?: string | null }[]; profileId?: string | null }
export const roleNamesOf = (u: ProfileUser | null | undefined) => (u?.roleAssignments ?? []).map((r) => String(r.roleName ?? ''));
export const isProfileId = (id: string | null | undefined): id is string => !!id && PROFILES.some((p) => p.id === id);

/**
 * The profile of a signed-in person on a device kind. Owner decision pending (ux-09): the default is that the role
 * decides (profileFor) and a user may carry an override (`profileId`, set on the users screen). An override that has
 * no workspace on this device kind (e.g. a storekeeper override on the cashier terminal) falls back to the role's
 * profile there, so nobody signs in to an empty screen. `kindHas(screenId)` tells whether the device kind has a screen.
 */
export function resolveProfile(u: ProfileUser | null | undefined, deviceKind: string | null, kindHas?: (screenId: string) => boolean): Profile {
  const byRole = profileFor(roleNamesOf(u), deviceKind);
  const id = u?.profileId;
  if (!isProfileId(id)) return byRole;
  const o = profileById(id);
  if (kindHas && o.workspaces.length && !o.workspaces.some((w) => screensOfWorkspace(w).some(kindHas))) return byRole;
  return o;
}
