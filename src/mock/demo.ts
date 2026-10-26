// Demo-only controls. NOT part of the product contracts: the Policy Panel's live flip, resets,
// the login directory and provisioning helpers. Every use is visible in the UI as a demo control.
import { store } from './store';
import { clock } from './clock';
import { sim } from './sim';
import { applyPolicy, applyMarketProfile, validatePolicyValue } from './handlers/org';
import { policy } from './policies';
import { DEMO_PIN, DEMO_PASSWORD } from './seed';
import { permsOf } from './kernel';
import { runOutbox } from './outbox';

export const demo = {
  pin: DEMO_PIN,
  password: DEMO_PASSWORD,
  /** Who can log in on a terminal: A1 needs this public list; no contract operation provides it (PROTOTYPE_GAPS). */
  directory(terminalId: string | null) {
    const db = store.db;
    const t = db.terminals.find((x) => x.id === terminalId);
    return db.users
      .filter((u) => u.active)
      .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, roles: u.roleAssignments.map((r) => db.roles.find((x) => x.id === r.roleId)?.name ?? r.roleId), branchIds: u.roleAssignments.flatMap((r) => r.branchIds), scoped: !t || u.roleAssignments.some((r) => r.branchIds.includes(t.branchId) || r.branchIds.includes('*')), locked: !!(u.lockedUntil && u.lockedUntil > clock.now()) }));
  },
  approvers(action: string, branchId: string | null) {
    const db = store.db;
    return db.users.filter((u) => u.active).map((u) => ({ id: u.id, displayName: u.displayName, username: u.username, can: [...permsOf(db, u, branchId)].some((p) => p === '*' || p === `approve:${action.toLowerCase()}`) }));
  },
  policy,
  /** Policy Panel: applies immediately to new actions, never rewrites existing checks. No approval (demo). */
  setPolicy(policyId: string, value: unknown, scopeType: 'TENANT' | 'BRANCH' | 'CHANNEL' | 'TERMINAL' = 'TENANT', scopeId = 'biz') {
    validatePolicyValue(policyId, value);
    applyPolicy({ db: store.db, nowIso: clock.iso(), user: null }, policyId, scopeType, scopeId, value, 'PANEL');
    store.commit();
  },
  clearPolicyScope(policyId: string, scopeType: any, scopeId: string) {
    applyPolicy({ db: store.db, nowIso: clock.iso(), user: null }, policyId, scopeType, scopeId, undefined, 'PANEL');
    store.commit();
  },
  applyEgProfile() {
    applyMarketProfile({ db: store.db, nowIso: clock.iso(), user: null });
    store.commit();
  },
  reset(mode: 'DEMO' | 'ZERO' = 'DEMO') {
    store.reset(mode);
    sim.reset();
    clock.reset();
  },
  tick() {
    runOutbox();
  },
  ackAlert(id: string) {
    const a = store.db.alerts.find((x) => x.id === id);
    if (a) { a.ack = true; store.commit(); }
  },
  snapshot() {
    return store.db;
  },
};
