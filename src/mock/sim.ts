// Simulated external systems and network faults. Experts flip these from the demo controls.
export type Mode = 'UP' | 'DOWN' | 'SLOW';
export interface SimState {
  latencyMs: number;
  printers: Record<string, 'UP' | 'DOWN' | 'PAPER_OUT'>; // per terminal id
  kds: Mode; // kitchen delivery worker / kitchen screen
  eta: 'UP' | 'DOWN' | 'REJECT' | 'TIMEOUT'; // e-receipt platform
  cardTerminal: 'UP' | 'DECLINE' | 'TIMEOUT'; // there is no provider call: the card result is typed by the cashier; this only drives the helper
  /** Drop the response of the next command matching this operation id (committed, client sees a network failure). */
  dropNextResponse: string | null;
  /** Fail the next command before it reaches the server (nothing written). */
  offlineNext: boolean;
  /** Next N requests of this op are delayed (to race two devices). */
  slowOp: { op: string; ms: number } | null;
  /** Devices whose network is cut (by device id: t_cash, t_floor, …). Requests never leave the device. */
  offlineDevices: string[];
  /** Outside systems that receive webhooks (accounting, delivery apps). */
  webhooks: 'UP' | 'DOWN';
}

const KEY = 'nerdpos.sim.v1';
const defaults: SimState = { latencyMs: 120, printers: {}, kds: 'UP', eta: 'UP', cardTerminal: 'UP', dropNextResponse: null, offlineNext: false, slowOp: null, offlineDevices: [], webhooks: 'UP' };
let state: SimState = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...defaults }; }
})();
const listeners = new Set<() => void>();

export const sim = {
  get: () => state,
  set(patch: Partial<SimState>) {
    state = { ...state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    listeners.forEach((l) => l());
  },
  printer(terminalId: string) {
    return state.printers[terminalId] ?? 'UP';
  },
  reset() {
    sim.set({ ...defaults, printers: {}, offlineDevices: [] });
  },
  isOffline(deviceId: string | null | undefined) {
    return !!deviceId && (state.offlineDevices ?? []).includes(deviceId);
  },
  setOffline(deviceId: string, offline: boolean) {
    const cur = new Set(state.offlineDevices ?? []);
    if (offline) cur.add(deviceId); else cur.delete(deviceId);
    sim.set({ offlineDevices: [...cur] });
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
