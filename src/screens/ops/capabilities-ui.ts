// Which screens a switched-off product capability hides (sidebar and screen host use this).
import { store } from '../../mock/store';
import { CAPABILITIES, capabilityOn, type CapabilityDef } from '../../mock/ops-registry';

export function capabilityHiding(screen: { id: string; group?: string }, branchId: string | null): CapabilityDef | null {
  for (const c of CAPABILITIES) {
    if (!c.screens.includes(screen.id) && !(screen.group && c.groups.includes(screen.group))) continue;
    if (!capabilityOn(store.db, c.id, branchId)) return c;
  }
  return null;
}

/** Pending remote approval requests this user could decide (sidebar badge). */
export function pendingApprovalCount(branchId: string | null): number {
  return (store.db.approvalRequests ?? []).filter((r) => r.state === 'PENDING' && (!branchId || r.branchId === branchId)).length;
}
