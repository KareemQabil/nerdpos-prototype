// ux-11 seed — the riders system: permissions for rider shifts and payouts, the approvals of the three new actions,
// the rider's own phone («موبايل الطيار», one name from DEVICE_NAMES), سعيد's rider record linked to the demo-driver
// account, the shift log behind the riders already on shift, and the owed ledger behind the seeded old shortage.
// Prototype additions (demoAdded), listed in PROTOTYPE_GAPS §15g.
import type { DB } from './types';
import type { Driver, DriverShift, DriverOwedEntry } from './types-crm';
import { DEVICE_NAMES } from '../demo/people';
import { RESTAURANT_XY } from './seed-crm';

export const UX11_ROLE_ADDITIONS: Record<string, string[]> = {
  role_manager: ['delivery:shift', 'delivery:payout', 'approve:driver_cash_limit_override', 'approve:driver_owed_settle', 'approve:driver_payout'],
  role_cashier: ['delivery:payout'], // pays a rider out of the drawer she holds — always with a manager's approval (DRIVER_PAYOUT)
  role_dispatcher: ['delivery:shift'],
  role_driver: ['delivery:dispatch', 'delivery:shift'], // «استلمت» and his own shift — limited to his own record server side
};
const DAY = 86_400_000;

export function seedRiders(db: DB, nowMs: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  for (const r of db.roles) {
    const fresh = (UX11_ROLE_ADDITIONS[r.id] ?? []).filter((p) => !r.permissionIds.includes(p));
    if (!fresh.length) continue;
    r.permissionIds = [...r.permissionIds, ...fresh];
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...fresh];
  }
  // the rider's phone: a handheld without a drawer, signed in by the rider himself
  if (!db.terminals.some((t) => t.id === 't_rider')) db.terminals.push({ id: 't_rider', code: 'DEMO-RIDER-1', name: DEVICE_NAMES.t_rider.name, branchId: 'branch_main', drawer: false, lifecycle: 'ACTIVE', purpose: 'RIDER_PHONE', kind: 'MOBILE', version: 1 });

  const drivers = (db.drivers ??= []);
  if (!drivers.some((d) => d.id === 'drv_5')) {
    const saeed: Driver = { id: 'drv_5', branchId: 'branch_main', name: 'سعيد منصور', phone: '01001234567', vehicle: 'MOTORCYCLE', plate: 'ص ع د 7310', onShift: false, active: true, location: null, version: 1, createdAt: iso(nowMs - 40 * DAY), owed: '0.0000', userId: 'u_driver', shiftId: null };
    drivers.push(saeed);
  }

  // shift log: the past week's shifts of the riders with past deliveries, and the open shift of each rider on shift now
  const shifts: DriverShift[] = (db.driverShifts ??= []);
  let n = 0;
  const day0 = (k: number) => { const d = new Date(nowMs - k * DAY); d.setUTCHours(9, 0, 0, 0); return d.getTime(); }; // 11:00 Cairo
  for (const drv of drivers.filter((d) => d.id !== 'drv_5')) {
    for (let k = 7; k >= 1; k--) {
      if ((Number(drv.id.slice(-1)) + k) % 3 === 0) continue; // a day off now and then
      const start = day0(k) + (Number(drv.id.slice(-1)) % 2) * 3 * 3600_000;
      const minutes = 7 * 60 + ((k * 37 + Number(drv.id.slice(-1)) * 11) % 120);
      shifts.push({ id: `dsh_s${++n}`, driverId: drv.id, branchId: drv.branchId, startedAt: iso(start), startedAtMs: start, startedBy: 'u_manager_1', endedAt: iso(start + minutes * 60_000), endedAtMs: start + minutes * 60_000, endedBy: 'u_manager_1', minutes, terminalId: 't_cash', version: 2 });
    }
    if (drv.onShift) {
      const start = nowMs - (150 + Number(drv.id.slice(-1)) * 20) * 60_000;
      const sh: DriverShift = { id: `dsh_s${++n}`, driverId: drv.id, branchId: drv.branchId, startedAt: iso(start), startedAtMs: start, startedBy: 'u_manager_1', endedAt: null, endedAtMs: null, endedBy: null, minutes: null, terminalId: 't_cash', version: 1 };
      shifts.push(sh);
      drv.shiftId = sh.id;
      drv.location = { ...RESTAURANT_XY, at: iso(start) };
    }
  }
  shifts.sort((a, b) => b.startedAtMs - a.startedAtMs);

  // the owed ledger behind a seeded old shortage (أحمد فتحي: 35.00 from a settlement three days ago)
  const owed: DriverOwedEntry[] = (db.driverOwedEntries ??= []);
  for (const drv of drivers) {
    if (Number(drv.owed) > 0 && !owed.some((e) => e.driverId === drv.id)) {
      owed.push({ id: `dow_s${drv.id}`, driverId: drv.id, branchId: drv.branchId, kind: 'SHORTAGE', amount: drv.owed, owedBefore: '0.0000', owedAfter: drv.owed, at: iso(nowMs - 3 * DAY), by: 'u_cashier_a', reason: 'عجز في تسليم نقدية الطلبات', approvalGrantId: null, sessionId: null, settlementId: null, terminalId: 't_cash' });
    }
  }
  db.driverPayouts ??= [];
}
