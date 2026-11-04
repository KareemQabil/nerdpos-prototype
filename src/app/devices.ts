// Simulated devices in one browser: each registered terminal is a device with its own logged-in user,
// plus a back-office device without a terminal. Experts can show two devices side by side.
import { useSyncExternalStore } from 'react';
import { store } from '../mock/store';
import type { DeviceAuth } from '../api/client';
import { DEVICE_NAMES } from '../demo/people';
import { resolveRoute } from './routes';
import { techMode } from './tech';
import { devOf } from '../mock/devices'; // ux-14: display screens come from the device registry

export interface DeviceState { id: string; terminalId: string | null; branchId: string | null; token: string | null; userName: string | null; screen: string; params: Record<string, any> }
interface Persisted { devices: Record<string, DeviceState>; primary: string; secondary: string | null; split: boolean }
const KEY = 'nerdpos.devices.v1';

let st: Persisted = (() => {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p?.devices) return p; } catch { /* ignore */ }
  return { devices: {}, primary: 't_floor', secondary: 't_cash', split: false };
})();
/** ux-07: removed / merged screens land on the surviving entry point (stored state, deep links, journeys, search). */
const kindOf = (id: string) => (store.db.terminals.find((x) => x.id === id)?.kind ?? (id === 'BO' ? 'BO' : null));
const orderVisit = (orderId: string) => !!store.db.orders.find((o) => o.id === orderId)?.visitId;
export const routeFor = (id: string, screen: string, params: Record<string, any>) => resolveRoute(screen, params, kindOf(id), techMode.get(), orderVisit);
try {
  let moved = false;
  for (const [id, d] of Object.entries(st.devices)) { const r = routeFor(id, d.screen, d.params ?? {}); if (r.screen !== d.screen) { st.devices[id] = { ...d, screen: r.screen, params: r.params }; moved = true; } }
  if (moved) localStorage.setItem(KEY, JSON.stringify(st));
} catch { /* the store is not ready: getDevice / ScreenHost redirect later */ }
const ls = new Set<() => void>();
let snapshot = { ...st };
function emit() {
  snapshot = { ...st, devices: { ...st.devices } };
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ }
  ls.forEach((f) => f());
}

/** Short top-bar codes of the seeded devices (shown only with technical details on). The device NAME has one source:
 *  DEVICE_NAMES in demo/people.ts, which is also what the seed writes into terminal.name (ux-07). */
export const SEEDED_LABELS: Record<string, { short: string }> = {
  t_cash: { short: 'T1' }, t_floor: { short: 'T2' }, t_kds: { short: 'K1' }, t_admin: { short: 'ADM' }, t_second_floor: { short: 'B2' },
  t_cash2: { short: 'T3' }, t_kds2: { short: 'K2' }, t_rider: { short: 'R1' }, BO: { short: 'BO' }, d_callboard: { short: 'CB' }, d_customer: { short: 'CD' },
};

/** ux-04: display screens are attached to a terminal (HDMI / second screen) and use its session — no sign-in of their
 *  own. ux-14: they are the registered display screens of the device registry (the server record says which terminal
 *  each one follows; it changes in «الأجهزة», not on the screen). A registered display appears in the device bar. */
export interface DisplayDevice { kind: 'CALLBOARD' | 'CUSTOMER'; host: string; name: string; code: string; enabled: boolean }
export function displayOf(id: string): DisplayDevice | null {
  const d = devOf(store.db).devices.find((x) => x.id === id && (x.kind === 'CUSTOMER_DISPLAY' || x.kind === 'CALL_BOARD'));
  return d ? { kind: d.kind === 'CALL_BOARD' ? 'CALLBOARD' : 'CUSTOMER', host: d.terminalId ?? '', name: d.name, code: d.code, enabled: d.enabled } : null;
}
export const isDisplay = (id: string) => !!displayOf(id);

export function deviceIds(): string[] {
  const ids = store.db.terminals.filter((t) => t.lifecycle === 'ACTIVE').map((t) => t.id);
  const displays = devOf(store.db).devices.filter((d) => (d.kind === 'CUSTOMER_DISPLAY' || d.kind === 'CALL_BOARD') && !!d.terminalId && ids.includes(d.terminalId)).map((d) => d.id);
  return [...ids, 'BO', ...displays];
}

export function getDevice(id: string): DeviceState {
  const existing = st.devices[id];
  if (existing) {
    const r = routeFor(id, existing.screen, existing.params);
    if (r.screen !== existing.screen) st.devices[id] = { ...existing, screen: r.screen, params: r.params };
    return st.devices[id];
  }
  const t = store.db.terminals.find((x) => x.id === id);
  const kind = t?.kind;
  const screen = isDisplay(id) ? 'display' : kind === 'KDS' ? 'kitchen' : kind === 'FLOOR' ? 'floor' : kind === 'CASH' ? 'counter' : kind === 'MOBILE' ? 'rider' : 'home';
  const d: DeviceState = { id, terminalId: t ? t.id : null, branchId: t?.branchId ?? store.db.branches[0]?.id ?? null, token: null, userName: null, screen, params: {} };
  st.devices[id] = d;
  return d;
}

// The pane that takes keyboard shortcuts: the one last touched (two panes side by side), else the main one.
let lastPane: string | null = null;
export const markKeyPane = (id: string) => { lastPane = id; };
export const keyPane = (): string => (lastPane && typeof document !== 'undefined' && document.querySelector(`[data-device="${lastPane}"]`) ? lastPane : st.primary);

export const devices = {
  get: getDevice,
  update(id: string, patch: Partial<DeviceState>) {
    st.devices[id] = { ...getDevice(id), ...patch };
    emit();
  },
  navigate(id: string, screen: string, params: Record<string, any> = {}) {
    const r = routeFor(id, screen, params);
    st.devices[id] = { ...getDevice(id), screen: r.screen, params: r.params };
    emit();
  },
  logout(id: string) {
    const d = getDevice(id);
    st.devices[id] = { ...d, token: null, userName: null };
    emit();
  },
  setPrimary(id: string) { if (st.secondary === id) st.secondary = st.primary; st.primary = id; emit(); },
  setSecondary(id: string | null) { st.secondary = id; emit(); },
  setSplit(v: boolean) { st.split = v; if (v && !st.secondary) st.secondary = deviceIds().find((x) => x !== st.primary) ?? null; emit(); },
  resetAll() { st = { devices: {}, primary: deviceIds()[0] ?? 'BO', secondary: deviceIds()[1] ?? null, split: false }; emit(); },
  state: () => st,
  auth(id: string): DeviceAuth {
    const d = getDevice(id);
    const label = SEEDED_LABELS[id]?.short ?? store.db.terminals.find((t) => t.id === id)?.code ?? id;
    return { deviceId: id, label, terminalId: d.terminalId, branchId: d.branchId, token: d.token };
  },
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
};

export function useDevicesState() {
  return useSyncExternalStore(devices.subscribe, () => snapshot);
}

export function deviceLabel(id: string, lang: 'ar' | 'en') {
  const s = SEEDED_LABELS[id];
  const t = store.db.terminals.find((x) => x.id === id);
  const n = DEVICE_NAMES[id];
  if (s && n) return { short: s.short, name: lang === 'ar' ? n.name : n.en, code: t?.code ?? (id === 'BO' ? '—' : id) };
  const disp = displayOf(id);
  if (disp) return { short: disp.code, name: disp.name, code: disp.code };
  return { short: t?.code ?? id, name: t?.name ?? id, code: t?.code ?? id };
}
