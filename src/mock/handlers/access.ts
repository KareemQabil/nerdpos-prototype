import { ApiError } from '../errors';
import { issueGrant, permsOf, hashOf, type Handler } from '../kernel';
import { nextId } from '../store';
import { policy } from '../policies';
import { checkVersion, need, page, requireFields } from './util';
import type { User } from '../types';
import { operations } from '../contracts';
import { APPROVAL_ACTIONS } from '../policyRegistry';

/** Registered permission ids: every permission named by an operation, the approve:* permissions, and those already on roles. */
function permissionCatalog(db: any): Set<string> {
  const out = new Set<string>();
  operations.forEach((o) => { if (o.permission && !['PUBLIC', 'AUTHENTICATED', 'INTERNAL'].includes(o.permission)) out.add(o.permission); });
  APPROVAL_ACTIONS.forEach((a) => out.add(a.permission));
  db.roles.forEach((r: any) => r.permissionIds.forEach((p: string) => p !== '*' && out.add(p)));
  return out;
}
function assertPermissions(db: any, ids: unknown) {
  const cat = permissionCatalog(db);
  const unknown = ((ids as string[]) ?? []).filter((p) => p !== '*' && !cat.has(p));
  if (unknown.length) throw new ApiError('UNKNOWN_PERMISSION_ID', { permissionIds: unknown });
}
const managesAccess = (db: any, roleIds: string[]) => roleIds.some((id) => { const r = db.roles.find((x: any) => x.id === id); return r?.active && (r.permissionIds.includes('*') || r.permissionIds.includes('user:manageaccess')); });

const userView = (db: any, u: User) => ({
  id: u.id, username: u.username, displayName: u.displayName, active: u.active, version: u.version, mustChangeCredentials: u.mustChangeCredentials,
  roleAssignments: u.roleAssignments.map((ra) => ({ ...ra, roleName: db.roles.find((r: any) => r.id === ra.roleId)?.name })),
  locked: !!(u.lockedUntil && u.lockedUntil > Date.now()),
});

export const accessHandlers: Record<string, Handler> = {
  'Auth.Login': (ctx) => {
    const { method = 'PIN', secret, userId, username } = ctx.body ?? {};
    const db = ctx.db;
    const u = db.users.find((x) => (userId && x.id === userId) || (username && x.username === username));
    if (!u || !u.active) throw new ApiError('UNAUTHENTICATED', { reason: 'unknown or inactive user' });
    const lock = policy<{ maxFailedAttempts: number; lockMinutes: number }>('LoginLockoutPolicy') ?? { maxFailedAttempts: 5, lockMinutes: 15 };
    if (u.lockedUntil && u.lockedUntil > ctx.now) throw new ApiError('CREDENTIAL_LOCKED', { until: new Date(u.lockedUntil).toISOString() });
    const ok = method === 'PASSWORD' ? u.password === secret : u.pin === secret;
    if (!ok) {
      u.failedAttempts++;
      const left = lock.maxFailedAttempts - u.failedAttempts;
      if (u.failedAttempts >= lock.maxFailedAttempts) { u.lockedUntil = ctx.now + lock.lockMinutes * 60_000; u.failedAttempts = 0; }
      throw Object.assign(new ApiError(u.lockedUntil && u.lockedUntil > ctx.now ? 'CREDENTIAL_LOCKED' : 'UNAUTHENTICATED', { reason: 'wrong credential', attemptsLeft: Math.max(left, 0) }), { keepWrites: true });
    }
    u.failedAttempts = 0;
    const terminal = ctx.terminal;
    const firstBranch = u.roleAssignments.flatMap((r) => r.branchIds).find((b) => b !== '*') ?? null;
    const branchId = terminal?.branchId ?? (ctx.branchId || firstBranch);
    if (terminal) {
      const scoped = u.roleAssignments.some((ra) => ra.branchIds.includes(terminal.branchId) || ra.branchIds.includes('*'));
      if (!scoped) throw new ApiError('PERMISSION_DENIED', { reason: 'user is not scoped to this terminal branch' });
    }
    const ap = policy<{ maxHours: number; pinSessionMaxHours: number }>('AuthSessionPolicy') ?? { maxHours: 12, pinSessionMaxHours: 12 };
    const hours = method === 'PIN' ? ap.pinSessionMaxHours : ap.maxHours;
    const s = { id: nextId('auth') + '.' + Math.random().toString(36).slice(2, 8), userId: u.id, terminalId: terminal?.id ?? null, branchId, credentialKind: method, createdAt: ctx.nowIso, expiresAt: ctx.now + hours * 3_600_000, revokedAt: null, credentialVersion: u.credentialVersion } as const;
    db.authSessions.push({ ...s });
    ctx.audit(`login ${u.username} on ${terminal?.code ?? 'no terminal'}`, u.id);
    return { status: 200, body: { token: s.id, authSession: { id: s.id, expiresAt: new Date(s.expiresAt).toISOString(), credentialKind: method }, user: userView(db, u), terminalId: terminal?.id ?? null, branchId, effectivePermissions: [...permsOf(db, u, branchId)] } };
  },
  'Auth.Logout': (ctx) => {
    if (ctx.auth) ctx.auth.revokedAt = ctx.nowIso;
    return { status: 200, body: { ok: true } };
  },
  'Auth.VerifyPin': (ctx) => {
    need(ctx.user && ctx.user.pin === ctx.body?.secret, 'CURRENT_CREDENTIAL_MISMATCH');
    return { ok: true };
  },
  'Access.Me': (ctx) => ({
    user: userView(ctx.db, ctx.user!), authSession: { id: ctx.auth!.id, expiresAt: new Date(ctx.auth!.expiresAt).toISOString(), credentialKind: ctx.auth!.credentialKind },
    branchId: ctx.branchId, terminalId: ctx.terminal?.id ?? null, effectivePermissions: [...ctx.perms], mustChangeCredentials: ctx.user!.mustChangeCredentials,
  }),
  'AuthSession.Revoke': (ctx) => {
    const s = ctx.db.authSessions.find((a) => a.id === ctx.params.authSessionId);
    need(s, 'AUTH_SESSION_NOT_FOUND');
    s!.revokedAt = ctx.nowIso;
    return { id: s!.id, revokedAt: s!.revokedAt };
  },
  'Permission.List': (ctx) => {
    const all = [...permissionCatalog(ctx.db)].sort().map((id) => ({ id, module: id.split(':')[0] }));
    return page(all.filter((p) => !ctx.query.module || p.module === ctx.query.module), ctx.query);
  },
  'Role.List': (ctx) => page(ctx.db.roles, ctx.query),
  'Role.Create': (ctx) => {
    requireFields(ctx, 'name');
    need(!ctx.db.roles.some((r) => r.name === ctx.body.name), 'ROLE_NAME_TAKEN');
    assertPermissions(ctx.db, ctx.body.permissionIds);
    ctx.requireApproval({ action: 'USER_ACCESS_CHANGE', targetType: 'access.Role', targetId: 'new', context: { active: true, roleIdsHash: hashOf([ctx.body.name]), branchScopeHash: hashOf([]) }, grantId: ctx.body.approvalGrantId });
    const r = { id: nextId('role'), name: ctx.body.name, permissionIds: [...(ctx.body.permissionIds ?? [])], active: true, version: 1 };
    ctx.db.roles.push(r);
    ctx.audit(`role created ${r.name}`, r.id, true);
    return r;
  },
  'Role.Update': (ctx) => {
    const r = ctx.db.roles.find((x) => x.id === ctx.params.roleId);
    need(r, 'ROLE_NOT_FOUND');
    checkVersion(r!, ctx.body.expectedVersion);
    if (ctx.body.permissionIds) assertPermissions(ctx.db, ctx.body.permissionIds);
    if (ctx.body.name && ctx.body.name !== r!.name) need(!ctx.db.roles.some((x) => x.name === ctx.body.name), 'ROLE_NAME_TAKEN');
    ctx.requireApproval({ action: 'USER_ACCESS_CHANGE', targetType: 'access.Role', targetId: r!.id, context: { active: ctx.body.active ?? r!.active, roleIdsHash: hashOf([r!.id]), branchScopeHash: hashOf(ctx.body.permissionIds ?? r!.permissionIds) }, grantId: ctx.body.approvalGrantId });
    if (ctx.body.name) r!.name = ctx.body.name;
    if (ctx.body.permissionIds) r!.permissionIds = [...ctx.body.permissionIds];
    if (ctx.body.active !== undefined) r!.active = !!ctx.body.active;
    r!.version++;
    ctx.audit(`role updated ${r!.name}`, r!.id, true);
    return r;
  },
  'User.Find': (ctx) => page(ctx.db.users.map((u) => userView(ctx.db, u)), ctx.query),
  'User.Get': (ctx) => {
    const u = ctx.db.users.find((x) => x.id === ctx.params.userId);
    need(u, 'USER_NOT_FOUND');
    return userView(ctx.db, u!);
  },
  'User.Create': (ctx) => {
    requireFields(ctx, 'username', 'displayName', 'password', 'roleAssignments');
    const db = ctx.db;
    need(!db.users.some((u) => u.username === ctx.body.username), 'USERNAME_TAKEN');
    const cp = policy<{ passwordMinLength: number; pinLength: number }>('CredentialPolicy') ?? { passwordMinLength: 10, pinLength: 6 };
    if (String(ctx.body.password).length < cp.passwordMinLength) throw new ApiError('CREDENTIAL_POLICY_VIOLATION', { field: 'password', minLength: cp.passwordMinLength });
    if (ctx.body.pin && !new RegExp(`^\\d{${cp.pinLength}}$`).test(ctx.body.pin)) throw new ApiError('CREDENTIAL_POLICY_VIOLATION', { field: 'pin', length: cp.pinLength });
    for (const ra of ctx.body.roleAssignments) {
      const role = db.roles.find((r) => r.id === ra.roleId);
      need(role, 'ROLE_NOT_FOUND', { roleId: ra.roleId });
      need(role!.active, 'ROLE_INACTIVE');
      for (const b of ra.branchIds ?? []) need(db.branches.some((x) => x.id === b), 'BRANCH_NOT_FOUND', { branchId: b });
    }
    ctx.requireApproval({ action: 'USER_ACCESS_CHANGE', targetType: 'access.User', targetId: 'new:' + ctx.body.username, context: { active: true, roleIdsHash: hashOf(ctx.body.roleAssignments.map((r: any) => r.roleId)), branchScopeHash: hashOf(ctx.body.roleAssignments.map((r: any) => r.branchIds)) }, grantId: ctx.body.approvalGrantId });
    const u: User = { id: nextId('user'), username: ctx.body.username, displayName: ctx.body.displayName, active: true, version: 1, pin: ctx.body.pin ?? '', password: ctx.body.password, roleAssignments: ctx.body.roleAssignments, failedAttempts: 0, lockedUntil: null, credentialVersion: 1, mustChangeCredentials: !ctx.body.pin };
    db.users.push(u);
    ctx.audit(`user created ${u.username}`, u.id, true);
    return userView(db, u);
  },
  'User.Update': (ctx) => {
    const u = ctx.db.users.find((x) => x.id === ctx.params.userId);
    need(u, 'USER_NOT_FOUND');
    checkVersion(u!, ctx.body.expectedVersion);
    if (ctx.body.displayName) u!.displayName = ctx.body.displayName;
    u!.version++;
    return userView(ctx.db, u!);
  },
  'User.ManageAccess': (ctx) => {
    const db = ctx.db;
    const u = db.users.find((x) => x.id === ctx.params.userId);
    need(u, 'USER_NOT_FOUND');
    checkVersion(u!, ctx.body.expectedVersion);
    const active = !!ctx.body.active;
    const assignments = ctx.body.roleAssignments ?? u!.roleAssignments;
    for (const ra of assignments) need(db.roles.some((r) => r.id === ra.roleId), 'ROLE_NOT_FOUND', { roleId: ra.roleId });
    // nobody left who can manage access → refused
    const othersManage = db.users.some((x) => x.id !== u!.id && x.active && managesAccess(db, x.roleAssignments.map((r) => r.roleId)));
    if (!othersManage && managesAccess(db, u!.roleAssignments.map((r) => r.roleId)) && !(active && managesAccess(db, assignments.map((r: any) => r.roleId)))) throw new ApiError('LAST_OWNER_PROTECTED', { userId: u!.id });
    ctx.requireApproval({ action: 'USER_ACCESS_CHANGE', targetType: 'access.User', targetId: u!.id, context: { active, roleIdsHash: hashOf(assignments.map((r: any) => r.roleId)), branchScopeHash: hashOf(assignments.map((r: any) => r.branchIds)) }, grantId: ctx.body.approvalGrantId });
    u!.active = active;
    u!.roleAssignments = assignments;
    u!.version++;
    if (!active) db.authSessions.filter((s) => s.userId === u!.id && !s.revokedAt).forEach((s) => (s.revokedAt = ctx.nowIso));
    ctx.audit(`access changed for ${u!.username}: active=${active}`, u!.id, true, ctx.body.approvalGrantId);
    return userView(db, u!);
  },
  'Credential.Reset': (ctx) => {
    const u = ctx.db.users.find((x) => x.id === ctx.params.userId);
    need(u, 'USER_NOT_FOUND');
    requireFields(ctx, 'kind', 'newSecret');
    const cp = policy<{ passwordMinLength: number; pinLength: number }>('CredentialPolicy') ?? { passwordMinLength: 10, pinLength: 6 };
    if (ctx.body.kind === 'PIN' && !new RegExp(`^\\d{${cp.pinLength}}$`).test(ctx.body.newSecret)) throw new ApiError('CREDENTIAL_POLICY_VIOLATION', { field: 'pin', length: cp.pinLength });
    if (ctx.body.kind === 'PASSWORD' && String(ctx.body.newSecret).length < cp.passwordMinLength) throw new ApiError('CREDENTIAL_POLICY_VIOLATION', { field: 'password', minLength: cp.passwordMinLength });
    ctx.requireApproval({ action: 'CREDENTIAL_RESET', targetType: 'access.User', targetId: u!.id, context: { userId: u!.id, kind: ctx.body.kind }, grantId: ctx.body.approvalGrantId });
    if (ctx.body.kind === 'PIN') u!.pin = ctx.body.newSecret; else u!.password = ctx.body.newSecret;
    u!.credentialVersion++;
    u!.mustChangeCredentials = true; // contract: admin reset sets mustChangeCredentials
    u!.lockedUntil = null;
    u!.failedAttempts = 0;
    ctx.audit(`credential ${ctx.body.kind} reset for ${u!.username}`, u!.id, true);
    return { status: 204, body: null };
  },
  'Credential.Rotate': (ctx) => {
    const u = ctx.user!;
    need(u.pin === ctx.body.currentSecret || u.password === ctx.body.currentSecret, 'CURRENT_CREDENTIAL_MISMATCH');
    if (ctx.body.kind === 'PIN') u.pin = ctx.body.newSecret; else u.password = ctx.body.newSecret;
    u.mustChangeCredentials = false;
    return { ok: true };
  },
  'AuthenticationAttempt.Find': (ctx) => page(ctx.db.audit.filter((a) => a.op === 'Auth.Login'), ctx.query),
  'Audit.Find': (ctx) => page(ctx.db.audit, ctx.query),
  'Audit.Get': (ctx) => {
    const a = ctx.db.audit.find((x) => x.id === ctx.params.auditEntryId);
    need(a, 'AUDIT_ENTRY_NOT_FOUND');
    return a;
  },
  'Approval.Grant': (ctx) => {
    requireFields(ctx, 'action', 'approverUserId', 'approverSecret', 'targetId', 'context');
    const g = issueGrant(ctx, { action: ctx.body.action, targetType: ctx.body.targetType ?? '', targetId: ctx.body.targetId, context: ctx.body.context, approverUserId: ctx.body.approverUserId, approverSecret: ctx.body.approverSecret, reason: ctx.body.reason });
    return { status: 201, body: { grantId: g.id, action: g.action, targetType: g.targetType, targetId: g.targetId, expiresAt: new Date(g.expiresAtMs).toISOString(), approverId: g.approverUserId } };
  },
  'Approval.Find': (ctx) => page(ctx.db.grants.map((g) => ({ ...g, expiresAt: new Date(g.expiresAtMs).toISOString() })), ctx.query),
  'Approval.Get': (ctx) => {
    const g = ctx.db.grants.find((x) => x.id === ctx.params.grantId);
    need(g, 'APPROVAL_GRANT_NOT_FOUND');
    return g;
  },
};
