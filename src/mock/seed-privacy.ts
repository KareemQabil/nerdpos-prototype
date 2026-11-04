// ux-13 seed — customer phone privacy: who may see a customer's full number (customer:viewphone). Owner decision
// (default, strictest workable): the manager (and the owner, who holds '*'); not the cashier, waiter, host, floor captain,
// call center, dispatcher or rider — they see 010•••••678. The call center and the dispatcher find a customer by typing
// the whole number the caller gives; the rider sees the number of his own delivery once he picked it up
// (CustomerPrivacyPolicy.riderAccess). Prototype additions (demoAdded), listed in PROTOTYPE_GAPS §15j.
import type { DB } from './types';

export const UX13_ROLE_ADDITIONS: Record<string, string[]> = {
  role_manager: ['customer:viewphone'],
};

export function seedPrivacy(db: DB) {
  for (const r of db.roles) {
    const fresh = (UX13_ROLE_ADDITIONS[r.id] ?? []).filter((p) => !r.permissionIds.includes(p));
    if (!fresh.length) continue;
    r.permissionIds = [...r.permissionIds, ...fresh];
    (r as any).demoAdded = [...((r as any).demoAdded ?? []), ...fresh];
  }
}
