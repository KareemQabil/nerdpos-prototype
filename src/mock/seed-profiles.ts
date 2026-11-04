// ux-09 seed — one demo user for each work profile nobody could reach (host, captain, runner, barista, bartender,
// expediter, area manager, auditor, storekeeper, purchasing, driver, dispatcher, call center; the support profile is
// the existing NerdPOS support user). Same pattern as seed-control (accountant): a demo role per job, named so the role
// gives the profile (src/app/profiles.ts profileFor), with permissions for that job only, and a user on the main branch.
// Roles are prototype additions (demoAdded), listed in PROTOTYPE_GAPS §15e.
import type { DB } from './types';

/** role id → name (the profile comes from the name) and the job's permissions. */
export const PROFILE_ROLES: Record<string, { name: string; permissionIds: string[] }> = {
  role_host: { name: 'Demo Host', permissionIds: ['table:read', 'table:assign', 'table:release', 'customer:pii:read', 'customer:create', 'settings:read', 'print:read'] },
  role_captain: { name: 'Demo Floor Captain', permissionIds: ['table:read', 'table:assign', 'table:release', 'table:transfer', 'order:create', 'order:read', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:voidline', 'order:changechannel', 'order:updatedetails', 'order:setcustomer', 'approval:grant', 'catalog:read', 'product:read', 'kitchen:read', 'customer:pii:read', 'customer:create', 'settings:read', 'print:read'] },
  role_runner: { name: 'Demo Runner', permissionIds: ['kitchen:read', 'kitchen:advanceticket', 'order:read', 'settings:read'] },
  role_barista: { name: 'Demo Barista', permissionIds: ['kitchen:read', 'kitchen:advanceticket', 'order:create', 'order:read', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'catalog:read', 'product:read', 'session:read', 'settings:read', 'print:read'] },
  role_bartender: { name: 'Demo Bartender', permissionIds: ['kitchen:read', 'kitchen:advanceticket', 'order:create', 'order:read', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'table:read', 'catalog:read', 'product:read', 'session:read', 'settings:read', 'print:read'] },
  role_expediter: { name: 'Demo Expediter', permissionIds: ['kitchen:read', 'kitchen:advanceticket', 'order:read', 'settings:read', 'print:read'] },
  role_area_manager: { name: 'Demo Area Manager', permissionIds: ['report:run', 'approval:read', 'approval:grant', 'business:read', 'branch:read', 'terminal:read', 'audit:read', 'order:read', 'payment:read', 'session:read', 'cash:read', 'refund:read', 'settings:read'] },
  role_auditor: { name: 'Demo Internal Auditor', permissionIds: ['audit:read', 'approval:read', 'report:run', 'business:read', 'branch:read', 'terminal:read', 'user:read', 'order:read', 'payment:read', 'session:read', 'cash:read', 'refund:read', 'settings:read', 'inventory:read'] },
  role_storekeeper: { name: 'Demo Storekeeper', permissionIds: ['inventory:read', 'purchasing:read', 'recipe:read', 'stock:count', 'stockcount:start', 'stockcount:recordobservations', 'stockcount:submit', 'stock:transfer', 'transfer:create', 'transfer:receive', 'transfer:cancel', 'stock:recordwaste', 'goodsreceipt:post', 'supplierreturn:post', 'storerequest:create', 'settings:read'] },
  role_purchasing: { name: 'Demo Purchasing Officer', permissionIds: ['purchasing:read', 'inventory:read', 'supplier:upsert', 'purchaseorder:create', 'purchaseorder:update', 'purchaseorder:issue', 'purchaseorder:close', 'purchaseorder:cancel', 'supplierinvoice:post', 'storerequest:create', 'settings:read'] },
  role_driver: { name: 'Demo Driver', permissionIds: ['delivery:read', 'delivery:complete', 'delivery:failattempt', 'order:read', 'settings:read'] },
  role_dispatcher: { name: 'Demo Delivery Dispatcher', permissionIds: ['delivery:read', 'delivery:create', 'delivery:assign', 'delivery:dispatch', 'delivery:complete', 'delivery:failattempt', 'delivery:cancel', 'delivery:settlecash', 'order:create', 'order:read', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:setcustomer', 'order:updatedetails', 'order:changechannel', 'catalog:read', 'product:read', 'kitchen:read', 'customer:pii:read', 'customer:create', 'customer:update', 'customeraddress:upsert', 'session:read', 'settings:read', 'print:read'] },
  role_callcenter: { name: 'Demo Call Center', permissionIds: ['order:create', 'order:read', 'order:addlines', 'order:updateline', 'order:removeline', 'order:fire', 'order:setcustomer', 'order:updatedetails', 'order:changechannel', 'catalog:read', 'product:read', 'customer:pii:read', 'customer:create', 'customer:update', 'customeraddress:upsert', 'loyalty:read', 'delivery:read', 'delivery:create', 'session:read', 'settings:read', 'print:read'] },
};

/** username → [user id, role id]. Personas (names) are in src/demo/people.ts. */
export const PROFILE_USERS: Record<string, [string, string]> = {
  'demo-host': ['u_host', 'role_host'],
  'demo-captain': ['u_captain', 'role_captain'],
  'demo-runner': ['u_runner', 'role_runner'],
  'demo-barista': ['u_barista', 'role_barista'],
  'demo-bartender': ['u_bartender', 'role_bartender'],
  'demo-expediter': ['u_expediter', 'role_expediter'],
  'demo-area-manager': ['u_area_manager', 'role_area_manager'],
  'demo-auditor': ['u_auditor', 'role_auditor'],
  'demo-storekeeper': ['u_storekeeper', 'role_storekeeper'],
  'demo-purchasing': ['u_purchasing', 'role_purchasing'],
  'demo-driver': ['u_driver', 'role_driver'],
  'demo-dispatcher': ['u_dispatcher', 'role_dispatcher'],
  'demo-callcenter': ['u_callcenter', 'role_callcenter'],
};
/** The area manager and the auditor work across branches; everyone else on the main branch. */
const BRANCHES: Record<string, string[]> = { u_area_manager: ['branch_main', 'branch_second'], u_auditor: ['branch_main', 'branch_second'], u_purchasing: ['branch_main', 'branch_second'] };

export function seedProfiles(db: DB, pin: string, password: string, displayName: (u: string) => string) {
  for (const [id, r] of Object.entries(PROFILE_ROLES)) {
    if (db.roles.some((x) => x.id === id)) continue;
    db.roles.push({ id, name: r.name, permissionIds: [...r.permissionIds], active: true, version: 1, demoAdded: [...r.permissionIds] } as any);
  }
  for (const [username, [id, roleId]] of Object.entries(PROFILE_USERS)) {
    if (db.users.some((u) => u.id === id)) continue;
    db.users.push({ id, username, displayName: displayName(username), active: true, version: 1, pin, password, roleAssignments: [{ roleId, branchIds: BRANCHES[id] ?? ['branch_main'] }], failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: false });
  }
}
