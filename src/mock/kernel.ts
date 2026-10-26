// The mock server kernel: routing from the contracts, authentication, permissions,
// idempotency (X-Command-Id), transactional commit, approvals and the request log.
import { matchRoute, type OperationDef } from './contracts';
import { ApiError } from './errors';
import { store, nextId } from './store';
import { clock, businessDate } from './clock';
import { sim } from './sim';
import { policy, approvalRule, ruleRequires, selfApprovalAllowed } from './policies';
import { APPROVAL_ACTIONS } from './policyRegistry';
import type { DB, User, AuthSession, Terminal, ApprovalGrant } from './types';
import { handlers } from './handlers';
import { runOutbox } from './outbox';

export interface Ctx {
  op: OperationDef;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  db: DB;
  user: User | null;
  auth: AuthSession | null;
  terminal: Terminal | null;
  branchId: string | null;
  perms: Set<string>;
  commandId: string | null;
  now: number;
  nowIso: string;
  businessDate: (branchId?: string | null) => string;
  can: (perm: string) => boolean;
  requireApproval: (a: { action: string; targetType: string; targetId: string; context: Record<string, unknown>; grantId?: string | null }) => ApprovalGrant | null;
  audit: (summary: string, target: string, sensitive?: boolean, grantId?: string) => void;
}
export interface HandlerResult { status?: number; body?: unknown; headers?: Record<string, string> }
export type Handler = (ctx: Ctx) => HandlerResult | unknown;

export interface LogEntry {
  id: number; at: string; deviceLabel: string; method: string; path: string; opId: string | null; status: number; commandId: string | null;
  replayed: boolean; errorCode: string | null; ms: number; dropped: boolean; backendState: string | null; request: unknown; response: unknown;
}
const log: LogEntry[] = [];
let logSeq = 0;
const logListeners = new Set<() => void>();
export const apiLog = {
  entries: () => log,
  subscribe(fn: () => void) { logListeners.add(fn); return () => { logListeners.delete(fn); }; },
  clear() { log.length = 0; logListeners.forEach((l) => l()); },
};

export function permsOf(db: DB, user: User, branchId: string | null): Set<string> {
  const out = new Set<string>();
  for (const ra of user.roleAssignments) {
    if (branchId && ra.branchIds.length && !ra.branchIds.includes(branchId) && !ra.branchIds.includes('*')) continue;
    const role = db.roles.find((r) => r.id === ra.roleId && r.active);
    role?.permissionIds.forEach((p) => out.add(p));
  }
  return out;
}

/**
 * PD-held operations carry permission INTERNAL in operations.json (no actor may call them yet).
 * The prototype shows them as direction (مقترح) under a proposed permission, listed in PROTOTYPE_GAPS.md.
 */
export const DIRECTION_PERMISSION: Record<string, string> = {
  'Order.Split': 'order:updateline', 'Order.Merge': 'order:updateline', 'Order.OverrideLinePrice': 'order:updateline',
  'Table.Merge': 'table:assign', 'Table.AssignWaiter': 'table:assign', 'Reservation.Create': 'table:assign', 'Reservation.Find': 'table:read',
  'Ticket.Recall': 'kitchen:advanceticket', 'TicketItem.Bump': 'kitchen:advanceticket', 'Ticket.SetPriority': 'kitchen:advanceticket', 'Ticket.TransferStation': 'kitchen:advanceticket', 'Ticket.Refire': 'kitchen:advanceticket',
  'Compliance.VerifyChain': 'compliance:read',
};
export function effectivePermission(op: OperationDef): string {
  if (op.permission === 'INTERNAL' && DIRECTION_PERMISSION[op.id]) return DIRECTION_PERMISSION[op.id];
  return op.permission;
}

export const stableStringify = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify((v as any)[k])).join(',') + '}';
};
export const hashOf = (v: unknown) => {
  const s = stableStringify(v);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = Math.imul(h2 + s.charCodeAt(i), 2654435761); }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
};

export interface MockRequest { method: string; url: string; headers: Record<string, string>; body: unknown; deviceLabel?: string }
export interface MockResponse { status: number; body: unknown; headers: Record<string, string>; dropped?: boolean }

export async function handleRequest(req: MockRequest): Promise<MockResponse> {
  const started = performance.now();
  const s = sim.get();
  const u = new URL(req.url, 'http://mock.local');
  const path = u.pathname.replace(/^\/api/, '');
  const query = Object.fromEntries(u.searchParams.entries());
  const match = matchRoute(req.method, path);
  const commandId = req.headers['x-command-id'] ?? null;

  let delay = s.latencyMs;
  if (s.slowOp && match?.op.id === s.slowOp.op) delay += s.slowOp.ms;
  if (delay) await new Promise((r) => setTimeout(r, delay));

  let res: MockResponse;
  let dropped = false;
  try {
    if (!match) throw new ApiError('ROUTE_NOT_FOUND', { method: req.method, path });
    if (s.offlineNext && match.op.kind === 'CMD') {
      sim.set({ offlineNext: false });
      throw Object.assign(new Error('network'), { network: true });
    }
    res = execute(match.op, match.params, query, req, commandId);
    if (s.dropNextResponse && match.op.id === s.dropNextResponse && res.status < 300) {
      sim.set({ dropNextResponse: null });
      dropped = true;
    }
  } catch (e: any) {
    if (e?.network) {
      pushLog(req, match?.op ?? null, path, 0, commandId, false, 'NETWORK', performance.now() - started, true, null);
      throw new TypeError('Failed to fetch (simulated offline)');
    }
    const err = e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR', { message: String(e?.message ?? e) });
    if (!(e instanceof ApiError)) console.error(e);
    res = { status: err.status, body: err.toBody(), headers: {} };
  }
  const code = (res.body as any)?.error?.code ?? null;
  pushLog(req, match?.op ?? null, path, res.status, commandId, res.headers['idempotent-replayed'] === 'true', code, performance.now() - started, dropped, res.body);
  if (dropped) throw new TypeError('Failed to fetch (simulated lost response)');
  return res;
}

function pushLog(req: MockRequest, op: OperationDef | null, path: string, status: number, commandId: string | null, replayed: boolean, errorCode: string | null, ms: number, dropped: boolean, response: unknown) {
  log.unshift({ id: ++logSeq, at: clock.iso(), deviceLabel: req.deviceLabel ?? '', method: req.method, path, opId: op?.id ?? null, status, commandId, replayed, errorCode, ms: Math.round(ms), dropped, backendState: op?.backend_state ?? null, request: req.body ?? null, response });
  if (log.length > 300) log.length = 300;
  logListeners.forEach((l) => l());
}

function execute(op: OperationDef, params: Record<string, string>, query: Record<string, string>, req: MockRequest, commandId: string | null): MockResponse {
  const db = store.db;
  const now = clock.now();
  // 1. authentication
  let user: User | null = null;
  let auth: AuthSession | null = null;
  const token = (req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
  if (token) {
    auth = db.authSessions.find((a) => a.id === token) ?? null;
    if (auth) user = db.users.find((x) => x.id === auth!.userId) ?? null;
  }
  const authValid = !!(auth && user && user.active && !auth.revokedAt && auth.expiresAt > now && auth.credentialVersion === user.credentialVersion);
  if (op.permission !== 'PUBLIC' && !authValid) throw new ApiError('UNAUTHENTICATED');
  if (!authValid) { user = null; auth = null; }

  // 2. terminal and branch context
  const terminalId = req.headers['x-terminal-id'] || auth?.terminalId || null;
  const terminal = terminalId ? db.terminals.find((t) => t.id === terminalId) ?? null : null;
  if (terminalId && !terminal && op.permission !== 'PUBLIC') throw new ApiError('TERMINAL_NOT_FOUND');
  if (terminal && terminal.lifecycle !== 'ACTIVE' && op.permission !== 'PUBLIC') throw new ApiError('TERMINAL_NOT_ACTIVE');
  const branchId = terminal?.branchId ?? (req.headers['x-branch-id'] || null) ?? auth?.branchId ?? null;
  if (branchId) {
    const br = db.branches.find((b) => b.id === branchId);
    if (!br) throw new ApiError('BRANCH_NOT_FOUND');
    if (!br.active && op.permission !== 'PUBLIC') throw new ApiError('BRANCH_INACTIVE');
  }
  const perms = user ? permsOf(db, user, branchId) : new Set<string>();
  const can = (p: string) => perms.has('*') || perms.has(p);

  // 3. permission (authorization precedes every read and write)
  const required = effectivePermission(op);
  if (required !== 'PUBLIC' && required !== 'AUTHENTICATED' && !can(required)) {
    throw new ApiError('PERMISSION_DENIED', { required });
  }

  // 4. idempotency
  const isCmd = op.kind === 'CMD';
  const body = req.body ?? {};
  if (isCmd && op.id !== 'Auth.Login' && !commandId) throw new ApiError('VALIDATION_FAILED', { field: 'X-Command-Id', rule: 'every command carries a command id' });
  const reqHash = hashOf({ op: op.id, params, body: stripVolatile(body) });
  if (isCmd && commandId) {
    const prior = db.idem[commandId];
    if (prior) {
      if (prior.hash === reqHash) {
        return { status: prior.status, body: prior.body, headers: { 'idempotent-replayed': 'true' } };
      }
      throw new ApiError('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST', { commandId, firstOperation: prior.opId });
    }
  }

  const handler = handlers[op.id];
  if (!handler) {
    throw new ApiError('CAPABILITY_NOT_AVAILABLE', { reason: 'not simulated in this prototype', operation: op.id, backend_state: op.backend_state });
  }

  // 5. run inside a "transaction": snapshot, restore on refusal
  const snapshot = isCmd ? structuredClone(db) : null;
  const consumed: ApprovalGrant[] = [];
  const ctx: Ctx = {
    op, params, query, body, db, user, auth, terminal, branchId, perms, commandId, now, nowIso: new Date(now).toISOString(),
    businessDate: (b) => {
      const br = db.branches.find((x) => x.id === (b ?? branchId));
      return businessDate(now, br?.timezone ?? 'Africa/Cairo', br?.businessDayCutoff ?? '04:00');
    },
    can,
    requireApproval: ({ action, targetType, targetId, context, grantId }) => {
      const rule = approvalRule(action, { branchId });
      const needed = ruleRequires(rule, context);
      if (!needed && !grantId) return null;
      if (!grantId) {
        throw new ApiError('APPROVAL_REQUIRED', { action, targetType, targetId, context, rule, actionTitle: APPROVAL_ACTIONS.find((a) => a.id === action)?.title });
      }
      const g = db.grants.find((x) => x.id === grantId);
      if (!g) throw new ApiError('APPROVAL_GRANT_INVALID', { grantId });
      if (g.consumedAt) throw new ApiError('APPROVAL_GRANT_ALREADY_CONSUMED', { grantId });
      if (g.expiresAtMs < now) throw new ApiError('APPROVAL_GRANT_EXPIRED', { grantId });
      const mismatch =
        g.action !== action ? 'action' :
        g.targetId !== targetId ? 'target' :
        g.contextHash !== hashOf(context) ? 'context' :
        g.requesterUserId !== user?.id ? 'requester' :
        (g.branchId && g.branchId !== branchId) ? 'branch' :
        (g.terminalId && g.terminalId !== terminal?.id) ? 'terminal' : null;
      if (mismatch) throw new ApiError('APPROVAL_GRANT_INVALID', { grantId, mismatch, expectedContext: g.context, actualContext: context });
      consumed.push(g);
      return g;
    },
    audit: (summary, target, sensitive = false, grantId) => {
      db.audit.unshift({ id: nextId('au'), at: new Date(now).toISOString(), userId: user?.id ?? null, terminalId: terminal?.id ?? null, op: op.id, target, sensitive, summary, commandId: commandId ?? undefined, approvalGrantId: grantId });
      if (db.audit.length > 1000) db.audit.length = 1000;
    },
  };
  try {
    const out = handler(ctx) as HandlerResult | undefined;
    const isWrapped = !!out && typeof out === 'object' && typeof (out as any).status === 'number' && Object.keys(out).every((k) => k === 'status' || k === 'body' || k === 'headers');
    const result: HandlerResult = isWrapped ? out! : { body: out };
    const status = result.status ?? (isCmd ? (op.method === 'POST' && /Create|Open|Register|Request|Grant|Login/.test(op.id) ? 201 : 200) : 200);
    if (isCmd) {
      // the grant is consumed last, in the same transaction
      for (const g of consumed) { g.consumedAt = ctx.nowIso; g.consumedBy = commandId; }
      if (commandId) db.idem[commandId] = { opId: op.id, hash: reqHash, status, body: result.body ?? null, at: ctx.nowIso, userId: user?.id ?? null };
      store.commit();
      queueMicrotask(() => runOutbox());
    }
    return { status, body: result.body ?? null, headers: result.headers ?? {} };
  } catch (e) {
    if (snapshot && !(e as any)?.keepWrites) store.db = snapshot; // nothing written
    else if ((e as any)?.keepWrites) store.commit(); // e.g. a failed-attempt counter
    throw e;
  }
}

/** Fields that do not change the intent of a command (the grant id is added on the approved retry). */
function stripVolatile(body: any) {
  if (!body || typeof body !== 'object') return body;
  const { approvalGrantId, commandId, ...rest } = body;
  return rest;
}

/** Approval.Grant is a normal command handled in handlers/approvals.ts; exposed for it. */
export function issueGrant(ctx: Ctx, input: { action: string; targetType: string; targetId: string; context: Record<string, unknown>; approverUserId: string; approverSecret: string; reason?: string }) {
  const db = ctx.db;
  const approver = db.users.find((x) => x.id === input.approverUserId);
  if (!approver || !approver.active) throw new ApiError('APPROVER_NOT_AUTHORIZED', { reason: 'unknown or inactive approver' });
  const lock = policy<{ maxFailedAttempts: number; lockMinutes: number }>('LoginLockoutPolicy') ?? { maxFailedAttempts: 5, lockMinutes: 15 };
  if (approver.lockedUntil && approver.lockedUntil > ctx.now) throw new ApiError('CREDENTIAL_LOCKED', { until: new Date(approver.lockedUntil).toISOString() });
  if (approver.pin !== input.approverSecret) {
    approver.failedAttempts++;
    if (approver.failedAttempts >= lock.maxFailedAttempts) { approver.lockedUntil = ctx.now + lock.lockMinutes * 60_000; approver.failedAttempts = 0; }
    throw Object.assign(new ApiError('APPROVER_NOT_AUTHORIZED', { reason: 'wrong PIN' }), { keepWrites: true });
  }
  approver.failedAttempts = 0;
  const def = APPROVAL_ACTIONS.find((a) => a.id === input.action);
  const approverPerms = permsOf(db, approver, ctx.branchId);
  if (!def || !(approverPerms.has('*') || approverPerms.has(def.permission))) throw new ApiError('APPROVER_NOT_AUTHORIZED', { required: def?.permission ?? input.action });
  if (approver.id === ctx.user?.id && !selfApprovalAllowed(input.action)) throw new ApiError('SELF_APPROVAL_DENIED', { action: input.action });
  const ttl = policy<{ seconds: number }>('ApprovalTtlPolicy')?.seconds ?? 120;
  const g: ApprovalGrant = {
    id: nextId('grant'), action: input.action, targetType: input.targetType, targetId: input.targetId, context: input.context, contextHash: hashOf(input.context),
    requesterUserId: ctx.user!.id, approverUserId: approver.id, branchId: ctx.branchId, terminalId: ctx.terminal?.id ?? null,
    issuedAt: ctx.nowIso, expiresAtMs: ctx.now + ttl * 1000, consumedAt: null, consumedBy: null, reason: input.reason,
  };
  db.grants.unshift(g);
  ctx.audit(`grant ${g.action} for ${g.targetId} by ${approver.username}`, g.targetId, true, g.id);
  return g;
}
