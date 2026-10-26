// Policy resolution inside the command: the most specific scope wins (TERMINAL > CHANNEL > BRANCH > TENANT),
// else the canonical default from the registry. Fail-closed policies return null.
import { store } from './store';
import { policyMeta, APPROVAL_ACTIONS, type Rule } from './policyRegistry';
import type { Channel } from './types';

export interface PolicyCtx { branchId?: string | null; channel?: Channel | null; terminalId?: string | null }

export function policy<T = any>(policyId: string, ctx: PolicyCtx = {}): T {
  const vals = store.db.policyValues.filter((v) => v.policyId === policyId);
  const pick = (scopeType: string, scopeId?: string | null) => (scopeId ? vals.find((v) => v.scopeType === scopeType && v.scopeId === scopeId) : undefined);
  const hit =
    pick('TERMINAL', ctx.terminalId) ??
    pick('CHANNEL', ctx.channel && ctx.branchId ? `${ctx.branchId}:${ctx.channel}` : null) ??
    pick('BRANCH', ctx.branchId) ??
    vals.find((v) => v.scopeType === 'TENANT');
  if (hit) return structuredClone(hit.value) as T;
  return structuredClone(policyMeta.get(policyId)?.canonicalDefault ?? null) as T;
}

/** Channel-map policies like FloorIntakePolicy {DINE_IN: ...}. */
export function channelPolicy<T = string>(policyId: string, ctx: PolicyCtx & { channel: Channel }, fallback: T): T {
  const v = policy<Record<string, T>>(policyId, ctx);
  if (v && typeof v === 'object' && ctx.channel in v) return v[ctx.channel];
  return fallback;
}

export function approvalRule(action: string, ctx: PolicyCtx = {}): Rule {
  const map = policy<Record<string, Rule>>('ApprovalRequirementPolicy', ctx) ?? {};
  return map[action] ?? APPROVAL_ACTIONS.find((a) => a.id === action)?.defaultRule ?? { mode: 'ALWAYS' };
}

export function ruleRequires(rule: Rule, context: Record<string, unknown>): boolean {
  switch (rule.mode) {
    case 'ALWAYS': return true;
    case 'NEVER': return false;
    case 'WHEN_TRUE': return context[rule.field] === true;
    case 'ABOVE_THRESHOLD': {
      const v = context[rule.field];
      // a null percent (first price, zero old price) fails closed under a threshold (E-36)
      if (v === null || v === undefined || v === '') return true;
      return Number(v) > Number(rule.threshold);
    }
    case 'ANY_OF': return rule.rules.some((r) => ruleRequires(r, context));
    default: return true;
  }
}

export function selfApprovalAllowed(action: string): boolean {
  const map = policy<Record<string, { mode: string }>>('SelfApprovalPolicy') ?? {};
  return map[action]?.mode === 'ALLOW';
}
