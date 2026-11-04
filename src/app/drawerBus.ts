// ux-10: the drawer's jobs open as popups over the sale screen. Anything on the device (the header's shift chip, the
// sale screen's «المزيد», a key, the no-shift call to action) asks for a job here; the sale screen's DrawerHost takes it.
// Per device and in memory only (a popup is never restored after a reload).
export type DrawerJob = 'hub' | 'open' | 'cashIn' | 'cashOut' | 'noSale' | 'x' | 'count' | 'tips' | 'handover' | 'handoverAccept' | 'handoverCancel'; // ux-10b: the shift handover

let pending: Record<string, DrawerJob | undefined> = {};
const ls = new Set<() => void>();

export const drawerBus = {
  /** Ask the sale screen of this device to open a drawer job. */
  request(deviceId: string, job: DrawerJob) { pending = { ...pending, [deviceId]: job }; ls.forEach((f) => f()); },
  /** The host takes the waiting job (once). */
  take(deviceId: string): DrawerJob | undefined { const j = pending[deviceId]; if (j) { const { [deviceId]: _, ...rest } = pending; pending = rest; } return j; },
  peek: (deviceId: string) => pending[deviceId],
  subscribe(fn: () => void) { ls.add(fn); return () => { ls.delete(fn); }; },
};
