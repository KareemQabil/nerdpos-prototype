import { ApiError } from '../errors';
import { hashOf, type Handler } from '../kernel';
import { nextId, event } from '../store';
import { policy } from '../policies';
import { policyMeta, POLICIES, startingValue } from '../policyRegistry';
import { checkVersion, need, page, requireFields, openSessionOn } from './util';
import { egProfile } from '../contracts';

export const orgHandlers: Record<string, Handler> = {
  'Health.Live': () => ({ status: 'ok' }),
  'Health.Ready': (ctx) => ({ status: 'ready', database: 'in-browser mock (localStorage)', migrationHead: 'prototype', orders: ctx.db.orders.length }),
  'Platform.BuildInfo': () => ({ release: 'prototype-2026-10-26', commit: 'mock', contracts: 'NERDPOS_PROTOTYPE_PACK 2026-10-26' }),
  'Business.Get': (ctx) => ctx.db.business,
  'Business.Configure': (ctx) => {
    const b = ctx.db.business;
    checkVersion(b, ctx.body.expectedVersion); // contract: expectedVersion is required
    if (ctx.body.currency && ctx.body.currency !== b.currency) throw new ApiError('CURRENCY_IMMUTABLE');
    if (ctx.body.name) b.name = ctx.body.name;
    if (ctx.body.nameAr !== undefined) b.nameAr = ctx.body.nameAr;
    if (ctx.body.legalName !== undefined) b.legalName = ctx.body.legalName;
    b.version++;
    ctx.audit('business configured', b.id);
    return b;
  },
  'Branch.List': (ctx) => page(ctx.db.branches, ctx.query),
  'Branch.Get': (ctx) => {
    const b = ctx.db.branches.find((x) => x.id === ctx.params.branchId);
    need(b, 'BRANCH_NOT_FOUND');
    return b;
  },
  'Branch.Create': (ctx) => {
    requireFields(ctx, 'code', 'name');
    need(!ctx.db.branches.some((b) => b.code === ctx.body.code), 'BRANCH_CODE_TAKEN');
    const tz = ctx.body.timezone ?? 'Africa/Cairo';
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new ApiError('TIMEZONE_INVALID'); }
    if (ctx.body.businessDayCutoff !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(ctx.body.businessDayCutoff))) throw new ApiError('VALIDATION_FAILED', { field: 'businessDayCutoff', rule: 'LocalTime HH:MM' });
    const b = { id: nextId('branch'), code: ctx.body.code, name: ctx.body.name, timezone: tz, businessDayCutoff: ctx.body.businessDayCutoff ?? '04:00', active: true, version: 1 };
    ctx.db.branches.push(b);
    ctx.audit(`branch ${b.code}`, b.id);
    return b;
  },
  'Branch.Configure': (ctx) => {
    const b = ctx.db.branches.find((x) => x.id === ctx.params.branchId);
    need(b, 'BRANCH_NOT_FOUND');
    checkVersion(b!, ctx.body.expectedVersion);
    Object.assign(b!, { name: ctx.body.name ?? b!.name, timezone: ctx.body.timezone ?? b!.timezone, businessDayCutoff: ctx.body.businessDayCutoff ?? b!.businessDayCutoff });
    b!.version++;
    return b;
  },
  'Branch.SetActive': (ctx) => {
    const b = ctx.db.branches.find((x) => x.id === ctx.params.branchId);
    need(b, 'BRANCH_NOT_FOUND');
    checkVersion(b!, ctx.body.expectedVersion);
    b!.active = !!ctx.body.active;
    b!.version++;
    return b;
  },
  'Terminal.List': (ctx) => page(ctx.db.terminals.map((t) => ({ ...t, openSession: openSessionOn(ctx.db, t.id)?.id ?? null })), ctx.query),
  'Terminal.Get': (ctx) => {
    const t = ctx.db.terminals.find((x) => x.id === ctx.params.terminalId);
    need(t, 'TERMINAL_NOT_FOUND');
    return t;
  },
  'Terminal.Register': (ctx) => {
    requireFields(ctx, 'code', 'name', 'branchId');
    const br = ctx.db.branches.find((b) => b.id === ctx.body.branchId);
    need(br, 'BRANCH_NOT_FOUND');
    need(br!.active, 'BRANCH_INACTIVE');
    need(!ctx.db.terminals.some((t) => t.code === ctx.body.code), 'TERMINAL_CODE_TAKEN');
    const kind = ctx.body.kind ?? (ctx.body.drawer ? 'CASH' : 'FLOOR');
    const t = { id: nextId('term'), code: ctx.body.code, name: ctx.body.name, branchId: ctx.body.branchId, drawer: !!ctx.body.drawer, lifecycle: 'ACTIVE' as const, purpose: ctx.body.purpose ?? '', kind, version: 1 };
    ctx.db.terminals.push(t);
    ctx.audit(`terminal ${t.code}`, t.id);
    return t;
  },
  'Terminal.Update': (ctx) => {
    const t = ctx.db.terminals.find((x) => x.id === ctx.params.terminalId);
    need(t, 'TERMINAL_NOT_FOUND');
    checkVersion(t!, ctx.body.expectedVersion);
    Object.assign(t!, { name: ctx.body.name ?? t!.name, drawer: ctx.body.drawer ?? t!.drawer, kind: ctx.body.kind ?? t!.kind });
    t!.version++;
    return t;
  },
  'Terminal.Decommission': (ctx) => {
    const t = ctx.db.terminals.find((x) => x.id === ctx.params.terminalId);
    need(t, 'TERMINAL_NOT_FOUND');
    checkVersion(t!, ctx.body.expectedVersion);
    requireFields(ctx, 'reason');
    need(t!.lifecycle === 'ACTIVE', 'TERMINAL_NOT_ACTIVE');
    t!.lifecycle = 'DECOMMISSIONED';
    t!.version++;
    ctx.audit(`terminal ${t!.code} decommissioned: ${ctx.body.reason}`, t!.id, true);
    return t;
  },
  'Terminal.Heartbeat': (ctx) => ({ terminalId: ctx.params.terminalId, at: ctx.nowIso }),

  // ───────── settings
  'Settings.Effective': (ctx) => {
    const id = ctx.query.policyId;
    need(policyMeta.has(id), 'SETTINGS_POLICY_UNKNOWN', { policyId: id });
    const scopeType = ctx.query.scopeType ?? 'TENANT';
    const value = policy(id, scopeType === 'BRANCH' ? { branchId: ctx.query.scopeId } : scopeType === 'TERMINAL' ? { terminalId: ctx.query.scopeId } : {});
    const rows = ctx.db.policyValues.filter((v) => v.policyId === id);
    return { policyId: id, value, rows, meta: policyMeta.get(id) };
  },
  'Settings.UpdatePolicy': (ctx) => {
    const id = ctx.params.policyId;
    const meta = policyMeta.get(id);
    need(meta, 'SETTINGS_POLICY_UNKNOWN', { policyId: id });
    const scopeType = ctx.body.scopeType ?? 'TENANT';
    const scopeId = ctx.body.scopeId ?? 'biz';
    if (!meta!.scopes.includes(scopeType)) throw new ApiError('SETTINGS_POLICY_SCOPE_NOT_ALLOWED', { policyId: id, scopeType, allowed: meta!.scopes });
    if (scopeType === 'BRANCH') need(ctx.db.branches.some((b) => b.id === scopeId), 'ORGANIZATION_BRANCH_NOT_FOUND');
    if (scopeType === 'TERMINAL') need(ctx.db.terminals.some((t) => t.id === scopeId), 'ORGANIZATION_TERMINAL_NOT_FOUND');
    validatePolicyValue(id, ctx.body.value);
    if (id === 'ReasonCodePolicy' && ctx.body.state !== 'INHERIT') {
      // docs/24 §5: a kind cannot become MANAGED without an active code
      const empty = Object.entries((ctx.body.value ?? {}) as Record<string, string>).filter(([kind, mode]) => mode === 'MANAGED' && !ctx.db.reasonCodes.some((r) => r.kind === kind && r.active)).map(([k]) => k);
      if (empty.length) throw new ApiError('VALIDATION_FAILED', { policyId: id, rule: 'MANAGED requires an active reason code of that kind', kinds: empty });
    }
    const existing = ctx.db.policyValues.find((v) => v.policyId === id && v.scopeType === scopeType && v.scopeId === scopeId);
    if (existing && ctx.body.expectedVersion !== undefined) checkVersion(existing, ctx.body.expectedVersion);
    const oldValue = existing?.value ?? null;
    ctx.requireApproval({ action: 'SENSITIVE_POLICY_CHANGE', targetType: 'settings.PolicyValue', targetId: `${id}:${scopeType}:${scopeId}`, context: { policyId: id, oldValueHash: hashOf(oldValue), newValueHash: hashOf(ctx.body.state === 'INHERIT' ? null : ctx.body.value) }, grantId: ctx.body.approvalGrantId });
    applyPolicy(ctx, id, scopeType, scopeId, ctx.body.state === 'INHERIT' ? undefined : ctx.body.value, 'SETTINGS', ctx.body.changeNote);
    return { policyId: id, scopeType, scopeId, value: ctx.body.value, version: (existing?.version ?? 0) + 1 };
  },
  'Policy.History': (ctx) => page(ctx.db.policyHistory.filter((h) => h.policyId === ctx.params.policyId), ctx.query),
  'Capability.List': () => ({ items: POLICIES.filter((p) => p.state === 'DIRECTION').map((p) => ({ id: p.id, state: 'PROPOSED' })) }),
  'ReasonCode.List': (ctx) => page(ctx.db.reasonCodes.filter((r) => (!ctx.query.kind || r.kind === ctx.query.kind) && (ctx.query.active === undefined || String(r.active) === ctx.query.active)).sort((a, b) => a.kind.localeCompare(b.kind) || a.sortOrder - b.sortOrder), ctx.query),
  'ReasonCode.Create': (ctx) => {
    requireFields(ctx, 'kind', 'code', 'label');
    need(/^[A-Z0-9_]{1,32}$/.test(ctx.body.code), 'VALIDATION_FAILED', { field: 'code', rule: '[A-Z0-9_]{1,32}' });
    need(ctx.body.label?.ar && ctx.body.label?.en && ctx.body.label.ar.length <= 80 && ctx.body.label.en.length <= 80, 'VALIDATION_FAILED', { field: 'label', rule: 'ar and en, at most 80 each' });
    need(ctx.db.reasonCodes.filter((r) => r.kind === ctx.body.kind).length < 100, 'VALIDATION_FAILED', { field: 'kind', rule: 'at most 100 codes per kind' });
    need(!ctx.db.reasonCodes.some((r) => r.kind === ctx.body.kind && r.code === ctx.body.code), 'REASON_CODE_TAKEN');
    const r = { id: nextId('rc'), kind: ctx.body.kind, code: ctx.body.code, label: ctx.body.label, requiresNote: !!ctx.body.requiresNote, sortOrder: ctx.body.sortOrder ?? 100, active: true, version: 1 };
    ctx.db.reasonCodes.push(r);
    return r;
  },
  'ReasonCode.Configure': (ctx) => {
    const r = ctx.db.reasonCodes.find((x) => x.id === ctx.params.reasonCodeId);
    need(r, 'REASON_CODE_NOT_FOUND');
    checkVersion(r!, ctx.body.expectedVersion);
    if (ctx.body.active === false && r!.active) {
      // docs/24 §5: the last active code of a MANAGED kind cannot be deactivated
      const mode = (policy<Record<string, string>>('ReasonCodePolicy') ?? {})[r!.kind];
      const others = ctx.db.reasonCodes.filter((x) => x.kind === r!.kind && x.active && x.id !== r!.id).length;
      if (mode === 'MANAGED' && others === 0) throw new ApiError('VALIDATION_FAILED', { rule: 'last active code of a MANAGED kind', kind: r!.kind });
    }
    Object.assign(r!, { label: ctx.body.label ?? r!.label, requiresNote: ctx.body.requiresNote ?? r!.requiresNote, sortOrder: ctx.body.sortOrder ?? r!.sortOrder, active: ctx.body.active ?? r!.active });
    r!.version++;
    return r;
  },
  'Session.Current': (ctx) => {
    const tid = ctx.query.terminalId ?? ctx.terminal?.id;
    need(ctx.db.terminals.some((t) => t.id === tid), 'TERMINAL_NOT_FOUND');
    const s = openSessionOn(ctx.db, tid);
    need(s, 'SESSION_NOT_FOUND');
    return s;
  },
};

export function validatePolicyValue(id: string, value: unknown) {
  const meta = policyMeta.get(id)!;
  if (value === undefined) return;
  if (meta.editor.kind === 'enum' && !meta.editor.options.includes(value as string)) throw new ApiError('VALIDATION_FAILED', { policyId: id, allowed: meta.editor.options });
  if (meta.editor.kind === 'bool' && typeof value !== 'boolean') throw new ApiError('VALIDATION_FAILED', { policyId: id, rule: 'boolean' });
  if (id === 'ServiceChargePolicy') {
    const v = value as any;
    const positive = Object.values(v?.byChannel ?? {}).some((r) => Number(r) > 0);
    // write guard (docs/25 §3): non-taxable positive service is not a capability yet
    if (v?.taxable === false && positive) throw new ApiError('VALIDATION_FAILED', { policyId: id, rule: 'taxable:false with a positive rate is not available (docs/25 §3)' });
  }
  if (id === 'ApprovalTtlPolicy') {
    const s = Number((value as any)?.seconds);
    if (!(s >= 15 && s <= 900)) throw new ApiError('VALIDATION_FAILED', { policyId: id, rule: 'seconds 15..900' });
  }
}

export function applyPolicy(ctx: { db: any; nowIso: string; user: any }, id: string, scopeType: any, scopeId: string, value: unknown, via: 'PANEL' | 'SETTINGS' | 'PROFILE', note?: string) {
  const db = ctx.db;
  const existing = db.policyValues.find((v: any) => v.policyId === id && v.scopeType === scopeType && v.scopeId === scopeId);
  const oldValue = existing?.value ?? null;
  if (value === undefined) {
    if (existing) db.policyValues.splice(db.policyValues.indexOf(existing), 1);
  } else if (existing) {
    existing.value = structuredClone(value); existing.version++; existing.updatedAt = ctx.nowIso; existing.updatedBy = ctx.user?.id ?? 'demo'; existing.source = via === 'PANEL' ? 'Policy Panel (demo)' : 'Settings.UpdatePolicy';
  } else {
    db.policyValues.push({ id: nextId('pv'), policyId: id, scopeType, scopeId, value: structuredClone(value), version: 1, updatedAt: ctx.nowIso, updatedBy: ctx.user?.id ?? 'demo', source: via === 'PANEL' ? 'Policy Panel (demo)' : 'Settings.UpdatePolicy' });
  }
  db.policyHistory.unshift({ id: nextId('ph'), policyId: id, scopeType, scopeId, oldValue, newValue: value ?? null, at: ctx.nowIso, by: ctx.user?.id ?? 'demo', via, note });
  event('PolicyChanged', id, `${id} @ ${scopeType}:${scopeId} via ${via}`);
}

/** settings.ApplyMarketProfile (internal, provisioning). Applies EG.profile values once at TENANT scope. */
export function applyMarketProfile(ctx: { db: any; nowIso: string; user: any }) {
  for (const v of egProfile.values) {
    applyPolicy(ctx, v.policyId, 'TENANT', 'biz', v.value, 'PROFILE', 'EG.profile 1.4.0');
  }
  for (const m of POLICIES) {
    if (m.editor.kind === 'readonly') continue;
    if (!ctx.db.policyValues.some((pv: any) => pv.policyId === m.id)) {
      const sv = startingValue(m);
      if (sv !== null && sv !== undefined) applyPolicy(ctx, m.id, 'TENANT', 'biz', sv, 'PROFILE', 'canonical/direction default');
    }
  }
}
