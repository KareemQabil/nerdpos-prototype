// Work profiles (UI only — NOT permissions). A profile decides which workspaces a person sees, where they start,
// the action bar (fixed positions, order, overflow), how quantities are entered and touch vs keyboard density.
// Permissions still come from the server (Access.Me); a button the profile shows but the user may not run is
// shown locked (needs approval) or disabled — never hidden silently behind a permission the profile did not ask for.
// Source: ROLES_PROPOSAL.csv (owner interview 2026-11-03). The cashier profile is fully used by the sale screen.

/** Every action the sale screen's action bar knows. Positions come from the profile, never from state. */
export type SaleAction =
  | 'new' | 'held' | 'customer' | 'discount' | 'orders'
  | 'note' | 'prebill' | 'comp' | 'move' | 'split' | 'merge' | 'channel' | 'cancel' | 'history'
  | 'delivery' | 'staffMeal' | 'staffMeals' | 'soldOut' | 'drawer' | 'mode' | 'search' | 'shortcuts' | 'more';

/** What the big primary button does; 'auto' follows the check state (send → pay → finish paying). */
export type PrimaryAction = 'auto' | 'send' | 'pay' | 'seat' | 'ready' | 'delivered' | 'dispatch' | 'confirm';

export type QuantityMethod = 'typedPrefix' | 'repeatTap' | 'stepper' | 'swipe' | 'longPress';

export interface Profile {
  id: string;
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
}

const ALL_QTY: Record<QuantityMethod, boolean> = { typedPrefix: true, repeatTap: true, stepper: true, swipe: true, longPress: true };
const TOUCH_QTY: Record<QuantityMethod, boolean> = { typedPrefix: false, repeatTap: true, stepper: true, swipe: true, longPress: true };
const NO_QTY: Record<QuantityMethod, boolean> = { typedPrefix: false, repeatTap: false, stepper: false, swipe: false, longPress: false };
const g = (ar: string, en: string) => ({ ar, en });
const SALE_OVERFLOW: SaleAction[] = ['delivery', 'staffMeal', 'staffMeals', 'prebill', 'comp', 'channel', 'cancel', 'history', 'soldOut', 'drawer', 'shortcuts'];

export const PROFILES: Profile[] = [
  // ── floor & counter
  { id: 'cashier', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('كاشير', 'Cashier'), workspaces: ['counter', 'checks', 'shift', 'receipt', 'refunds'], start: 'counter',
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'mixed', hidden: ['expectedCash', 'reports'] },
  { id: 'waiter', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('ويتر', 'Waiter'), workspaces: ['floor', 'order'], start: 'floor',
    actionBar: { secondary: ['customer', 'prebill', 'move', 'note'], overflow: ['split', 'merge', 'history'], primary: 'send' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['collection', 'drawer', 'reports'] },
  { id: 'captain', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('كابتن صالة', 'Floor captain'), workspaces: ['floor', 'order', 'reservations'], start: 'floor',
    actionBar: { secondary: ['move', 'merge', 'split', 'prebill'], overflow: ['history', 'note'], primary: 'send' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['drawer', 'financialReports'] },
  { id: 'host', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('مستقبل وحجوزات', 'Host & reservations'), workspaces: ['reservations', 'floor'], start: 'reservations',
    actionBar: { secondary: [], overflow: [], primary: 'seat' }, quantity: NO_QTY, input: 'touch', hidden: ['orders', 'payment'] },
  { id: 'runner', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('رانر', 'Runner'), workspaces: ['kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'delivered' }, quantity: NO_QTY, input: 'touch', hidden: ['everythingButHandover'] },
  { id: 'barista', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('باريستا', 'Barista'), workspaces: ['counter', 'kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['drawer', 'reports'] },
  { id: 'bartender', group: g('الصالة والكاونتر', 'Floor & counter'), role: g('بارتندر', 'Bartender'), workspaces: ['counter', 'kitchen'], start: 'kitchen',
    actionBar: { secondary: ['orders'], overflow: [], primary: 'ready' }, quantity: TOUCH_QTY, input: 'touch', hidden: ['reports'] },
  // ── kitchen
  { id: 'stationChef', group: g('المطبخ', 'Kitchen'), role: g('شيف محطة', 'Station chef'), workspaces: ['kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'touch', hidden: ['prices', 'amounts'] },
  { id: 'expediter', group: g('المطبخ', 'Kitchen'), role: g('منسق التسليم', 'Expediter'), workspaces: ['kitchen'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'touch', hidden: ['amounts'] },
  { id: 'kitchenManager', group: g('المطبخ', 'Kitchen'), role: g('مدير مطبخ', 'Kitchen manager'), workspaces: ['kitchen', 'inv-waste', 'soldout'], start: 'kitchen',
    actionBar: { secondary: [], overflow: [], primary: 'ready' }, quantity: NO_QTY, input: 'mixed', hidden: ['drawer', 'financialReports'] },
  // ── management
  { id: 'shiftManager', group: g('الإدارة', 'Management'), role: g('مدير وردية', 'Shift manager'), workspaces: ['approvals-inbox', 'counter', 'floor', 'shift'], start: 'approvals-inbox',
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'mixed', hidden: [] },
  { id: 'branchManager', group: g('الإدارة', 'Management'), role: g('مدير فرع', 'Branch manager'), workspaces: [], start: 'home',
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['systemSettings', 'license'] },
  { id: 'areaManager', group: g('الإدارة', 'Management'), role: g('مدير منطقة', 'Area manager'), workspaces: ['home', 'reports', 'approvals-inbox'], start: 'home',
    actionBar: { secondary: [], overflow: [], primary: 'auto' }, quantity: NO_QTY, input: 'keyboard', hidden: ['dailyOperations'] },
  { id: 'owner', group: g('الإدارة', 'Management'), role: g('مالك', 'Owner'), workspaces: [], start: 'home',
    actionBar: { secondary: ['new', 'held', 'customer', 'discount', 'orders'], overflow: SALE_OVERFLOW, primary: 'auto' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['license'] },
  // ── back office
  { id: 'accountant', group: g('المكتب', 'Back office'), role: g('محاسب', 'Accountant'), workspaces: ['reports', 'void-review', 'refunds'], start: 'reports',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['sale'] },
  { id: 'auditor', group: g('المكتب', 'Back office'), role: g('مراجع داخلي', 'Internal auditor'), workspaces: ['reports', 'audit'], start: 'audit',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['anyWrite'] },
  { id: 'storekeeper', group: g('المكتب', 'Back office'), role: g('أمين مخزن', 'Storekeeper'), workspaces: ['inv-dashboard', 'inv-receipts', 'inv-counts', 'inv-transfers', 'inv-waste'], start: 'inv-dashboard',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'mixed', hidden: ['sales', 'prices'] },
  { id: 'purchasing', group: g('المكتب', 'Back office'), role: g('مسؤول مشتريات', 'Purchasing officer'), workspaces: ['inv-purchasing', 'inv-po', 'inv-suppliers'], start: 'inv-purchasing',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['sale'] },
  // ── delivery
  { id: 'driver', group: g('الدليفري', 'Delivery'), role: g('طيار', 'Driver'), workspaces: ['delivery-board'], start: 'delivery-board',
    actionBar: { secondary: [], overflow: [], primary: 'delivered' }, quantity: NO_QTY, input: 'touch', hidden: ['everythingButOwnOrders'] },
  { id: 'dispatcher', group: g('الدليفري', 'Delivery'), role: g('موزع الدليفري', 'Delivery dispatcher'), workspaces: ['delivery-board', 'drivers'], start: 'delivery-board',
    actionBar: { secondary: [], overflow: [], primary: 'dispatch' }, quantity: NO_QTY, input: 'mixed', hidden: ['financialReports'] },
  { id: 'callCenter', group: g('الدليفري', 'Delivery'), role: g('مركز الاتصال', 'Call center'), workspaces: ['delivery-new', 'customers'], start: 'delivery-new',
    actionBar: { secondary: ['customer'], overflow: [], primary: 'confirm' }, quantity: ALL_QTY, input: 'keyboard', hidden: ['drawer'] },
  // ── system
  { id: 'support', group: g('النظام', 'System'), role: g('فريق التركيب والدعم', 'Install & support team'), workspaces: ['import', 'settings', 'org', 'capabilities'], start: 'org',
    actionBar: { secondary: [], overflow: [], primary: 'confirm' }, quantity: NO_QTY, input: 'keyboard', hidden: ['customerPersonalData'] },
];

export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0];

/** Default keys of the sale screen (per device they can be remapped without conflicts — see keymap.ts). */
export const SALE_KEYS: Partial<Record<SaleAction | 'primary', string>> = {
  shortcuts: 'F1', new: 'F2', held: 'F3', customer: 'F4', discount: 'F6', orders: 'F7', more: 'F8', mode: 'F9', search: 'F10', primary: 'Enter',
};

/**
 * The profile of the signed-in person on this device. Role names come from Access.Me; the device kind breaks ties
 * (a manager on a cashier terminal works the sale screen like a cashier, with the manager's bar).
 */
export function profileFor(roleNames: string[], deviceKind: string | null): Profile {
  const r = roleNames.map((x) => x.toLowerCase());
  const has = (...k: string[]) => r.some((x) => k.some((y) => x.includes(y)));
  if (has('owner', 'bootstrap')) return profileById(deviceKind === 'CASH' ? 'cashier' : 'owner');
  if (has('manager')) return profileById(deviceKind === 'CASH' ? 'shiftManager' : deviceKind === 'KDS' ? 'kitchenManager' : 'branchManager');
  if (has('cashier')) return profileById('cashier');
  if (has('waiter', 'server')) return profileById('waiter');
  if (has('chef', 'kitchen', 'cook')) return profileById('stationChef');
  if (has('driver')) return profileById('driver');
  if (has('account')) return profileById('accountant');
  return profileById(deviceKind === 'FLOOR' ? 'waiter' : deviceKind === 'KDS' ? 'stationChef' : deviceKind === 'CASH' ? 'cashier' : 'owner');
}
