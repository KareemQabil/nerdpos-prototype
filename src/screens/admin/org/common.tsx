// Small helpers shared by the A0 / A2 / B4 / F2 / audit / home screens.
import React from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import { useDev, useQuery, useApprovals, useUnknowns } from '../../../app/hooks';
import { Banner, Pill, Modal as UiModal } from '../../../ui';
import { t } from '../../../i18n';
import { APPROVAL_ACTIONS } from '../../../mock/policyRegistry';

/** The UI-kit modal rendered into document.body: a .glass ancestor (backdrop-filter) would otherwise become the
 *  containing block of its position:fixed overlay and clip it inside the card. Context still flows through the portal. */
export function Modal(props: React.ComponentProps<typeof UiModal>) {
  const { id } = useDev();
  // while this device shows the manager-approval popup (C5) or the "result unknown" dialog, step aside (state is kept)
  const approvals = useApprovals(id);
  const unknowns = useUnknowns(id);
  const blocked = approvals.length > 0 || unknowns.length > 0;
  if (!props.open || blocked) return null;
  return createPortal(<UiModal {...props} />, document.body);
}

/** A paged list query: returns the items (empty while loading or refused) plus the raw query state. */
export function useList<T = any>(opId: string | null, opts: { params?: Record<string, any>; query?: Record<string, any> } = {}, enabled = true) {
  const q = useQuery<{ items: T[]; total?: number }>(opId, opts, enabled);
  return { ...q, items: (q.data?.items ?? []) as T[] };
}

/** Show a value as compact text (policy values, contexts). */
export const show = (v: unknown): string => (v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export const getPath = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
export function setPath(o: any, path: string, v: any) {
  const out = structuredClone(o ?? {});
  const keys = path.split('.');
  let cur = out;
  keys.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  if (v === undefined) delete cur[keys.at(-1)!]; else cur[keys.at(-1)!] = v;
  return out;
}

/** Human text of an approval rule {mode, field, threshold}. */
export function ruleText(rule: any): string {
  if (!rule) return '—';
  if (rule.mode === 'ALWAYS') return t('دايمًا');
  if (rule.mode === 'NEVER') return t('أبدًا (من غير موافقة)');
  if (rule.mode === 'ABOVE_THRESHOLD') return `${rule.field} > ${rule.threshold}`;
  if (rule.mode === 'WHEN_TRUE') return `${rule.field} = true`;
  if (rule.mode === 'ANY_OF') return (rule.rules ?? []).map(ruleText).join(t(' أو '));
  return String(rule.mode);
}

/** The approval rule currently in force for one action (Settings.Effective ApprovalRequirementPolicy). */
export function useApprovalRule(action: string) {
  const { me, auth } = useDev();
  const branchId = me?.branchId ?? auth.branchId;
  const q = useQuery<any>('Settings.Effective', { query: branchId ? { policyId: 'ApprovalRequirementPolicy', scopeType: 'BRANCH', scopeId: branchId } : { policyId: 'ApprovalRequirementPolicy', scopeType: 'TENANT', scopeId: 'biz' } });
  const def = APPROVAL_ACTIONS.find((a) => a.id === action);
  const rule = q.data?.value?.[action] ?? def?.defaultRule ?? null;
  return { rule, title: def?.title ?? action, loaded: !!q.data };
}

export function RulePill({ action }: { action: string }) {
  const { rule } = useApprovalRule(action);
  const needs = rule && rule.mode !== 'NEVER';
  return <Pill tone={needs ? 'warning' : 'neutral'} title={`ApprovalRequirementPolicy[${action}]`}><span className="num">{action}</span>: {ruleText(rule)}</Pill>;
}

/** A refused read (usually PERMISSION_DENIED) shown in place of the content. */
export function Refused({ error }: { error: any }) {
  if (!error) return null;
  return <Banner tone="warning"><span className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" />{t('مش متاح للمستخدم ده')}</span> <span className="num text-xs text-dim">{error.code}{error.details?.required ? ` · ${error.details.required}` : ''}</span></Banner>;
}

/** Permission check with a visible reason on disabled buttons. */
export function usePerm(p: string) {
  const { can } = useDev();
  const ok = can(p);
  return { ok, title: ok ? undefined : t('محتاج صلاحية {p}', { p }) };
}

export const CHANNELS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const;
export const channelLabel = (c: string) => ({ DINE_IN: t('صالة'), TAKEAWAY: t('تيك أواي'), DELIVERY: t('دليفري') } as Record<string, string>)[c] ?? c;

export const REASON_KINDS = ['ORDER_CANCEL', 'ORDER_VOID', 'LINE_VOID', 'DISCOUNT', 'COMP', 'REFUND', 'CASH_MOVE', 'NO_SALE', 'TENDER_CORRECTION', 'VARIANCE', 'REPRINT'] as const;
export const reasonKindLabel = (k: string) => ({
  ORDER_CANCEL: t('إلغاء شيك مبعتش'), ORDER_VOID: t('إلغاء شيك كامل'), LINE_VOID: t('إلغاء صنف'), DISCOUNT: t('خصم'), COMP: t('ضيافة'), REFUND: t('مرتجع'),
  CASH_MOVE: t('حركة نقدية'), NO_SALE: t('فتح الدرج بدون بيع'), TENDER_CORRECTION: t('تصحيح وسيلة دفع'), VARIANCE: t('فرق الدرج'), REPRINT: t('إعادة طباعة'),
} as Record<string, string>)[k] ?? k;

export const terminalKindLabel = (k: string) => ({ CASH: t('كاشير'), FLOOR: t('تابلت صالة'), KDS: t('شاشة مطبخ'), ADMIN: t('إدارة') } as Record<string, string>)[k] ?? k;
