// ux-14 seed — the device registry of the demo restaurant (printers, cash drawers, a scanner, the call board and the
// customer display, the content library and the customer display's playlist: devices.ts seedDevices) and who manages
// devices. Owner decision (default, strictest workable): the manager registers, attaches, enables / disables devices and
// manages the display content (device:manage, displaycontent:manage); the cashier sees device status and prints a test
// page after fixing a printer (device:read, device:test); the owner holds '*'. Prototype additions (demoAdded), PROTOTYPE_GAPS §15k.
import type { DB } from './types';
import { devOf } from './devices';

export const UX14_ROLE_ADDITIONS: Record<string, string[]> = {
  role_manager: ['device:read', 'device:test', 'device:manage', 'displaycontent:manage'],
  role_cashier: ['device:read', 'device:test'],
};

export function seedDevicesAndRoles(db: DB) {
  devOf(db); // creates the registry and seeds the demo devices for the terminals that exist
  for (const r of db.roles) {
    const fresh = (UX14_ROLE_ADDITIONS[r.id] ?? []).filter((p) => !r.permissionIds.includes(p));
    if (!fresh.length) continue;
    r.permissionIds = [...r.permissionIds, ...fresh];
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...fresh];
  }
}
