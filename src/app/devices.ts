// Simulated devices in one browser: each registered terminal is a device with its own logged-in user,
// plus a back-office device without a terminal. Experts can show two devices side by side.
import { useSyncExternalStore } from 'react';
import { store } from '../mock/store';
import type { DeviceAuth } from '../api/client';

export interface DeviceState { id: string; terminalId: string | null; branchId: string | null; token: string | null; userName: string | null; screen: string; params: Record<string, any> }
interface Persisted { devices: Record<string, DeviceState>; primary: string; secondary: string | null; split: boolean }
const KEY = 'nerdpos.devices.v1';

let st: Persisted = (() => {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p?.devices) return p; } catch { /* ignore */ }
  return { devices: {}, primary: 't_floor', secondary: 't_cash', split: false };
})();
const ls = new Set<() => void>();
let snapshot = { ...st };
function emit() {
  snapshot = { ...st, devices: { ...st.devices } };
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ }
  ls.forEach((f) => f());
}

export const SEEDED_LABELS: Record<string, { ar: string; en: string; short: string }> = {
  t_cash: { ar: 'كاشير (درج)', en: 'Cashier (drawer)', short: 'T1' },
  t_floor: { ar: 'تابلت الويتر', en: 'Waiter tablet', short: 'T2' },
  t_kds: { ar: 'شاشة المطبخ', en: 'Kitchen screen', short: 'K1' },
  t_admin: { ar: 'مكتب المدير', en: 'Manager office', short: 'ADM' },
  t_second_floor: { ar: 'تابلت الفرع التاني', en: 'Second branch tablet', short: 'B2' },
  BO: { ar: 'باك أوفيس (من غير جهاز)', en: 'Back office (no terminal)', short: 'BO' },
};

export function deviceIds(): string[] {
  const ids = store.db.terminals.filter((t) => t.lifecycle === 'ACTIVE').map((t) => t.id);
  return [...ids, 'BO'];
}

export function getDevice(id: string): DeviceState {
  const existing = st.devices[id];
  if (existing) return existing;
  const t = store.db.terminals.find((x) => x.id === id);
  const kind = t?.kind;
  const screen = kind === 'KDS' ? 'kitchen' : kind === 'FLOOR' ? 'floor' : kind === 'CASH' ? 'counter' : 'home';
  const d: DeviceState = { id, terminalId: t ? t.id : null, branchId: t?.branchId ?? store.db.branches[0]?.id ?? null, token: null, userName: null, screen, params: {} };
  st.devices[id] = d;
  return d;
}

export const devices = {
  get: getDevice,
  update(id: string, patch: Partial<DeviceState>) {
    st.devices[id] = { ...getDevice(id), ...patch };
    emit();
  },
  navigate(id: string, screen: string, params: Record<string, any> = {}) {
    st.devices[id] = { ...getDevice(id), screen, params };
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
  if (s) return { short: s.short, name: lang === 'ar' ? s.ar : s.en, code: t?.code ?? (id === 'BO' ? '—' : id) };
  return { short: t?.code ?? id, name: t?.name ?? id, code: t?.code ?? id };
}
