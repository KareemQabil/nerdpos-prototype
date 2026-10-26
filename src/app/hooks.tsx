// Device context, server queries and commands (approval flow, unknown outcome, conflicts).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { call, ApiFailure, newCommandId, type DeviceAuth } from '../api/client';
import { devices } from './devices';
import { store } from '../mock/store';
import { toast } from '../ui';
import { t, getLang } from '../i18n';
import { errorsAr, errorsEn } from '../i18n/errors';

export interface DevCtx { id: string; auth: DeviceAuth; me: any | null; nav: (screen: string, params?: Record<string, any>) => void; screen: string; params: Record<string, any>; can: (p: string) => boolean; kind: string; terminal: any | null }
export const DeviceContext = createContext<DevCtx | null>(null);
export const useDev = () => {
  const c = useContext(DeviceContext);
  if (!c) throw new Error('no device');
  return c;
};

// store version → every query refetches after any committed change (devices see each other's actions)
let throttled = store.version();
let pending: ReturnType<typeof setTimeout> | null = null;
const vl = new Set<() => void>();
store.subscribe(() => {
  if (pending) return;
  pending = setTimeout(() => { pending = null; throttled = store.version(); vl.forEach((f) => f()); }, 60);
});
let manual = 0;
export function refreshAll() { manual++; throttled = store.version() + manual * 1e6; vl.forEach((f) => f()); }
export function useStoreVersion() {
  return useSyncExternalStore((cb) => { vl.add(cb); return () => vl.delete(cb); }, () => throttled);
}

export function errorText(e: unknown): string {
  if (e instanceof ApiFailure) {
    const ar = e.messageAr ?? errorsAr[e.code];
    const en = errorsEn[e.code] ?? e.message;
    return getLang() === 'ar' ? ar ?? en : en;
  }
  return String((e as any)?.message ?? e);
}

export function useQuery<T = any>(opId: string | null, opts: { params?: Record<string, any>; query?: Record<string, any> } = {}, enabled = true) {
  const { auth } = useDev();
  const v = useStoreVersion();
  const [state, setState] = useState<{ data: T | null; error: ApiFailure | null; loading: boolean }>({ data: null, error: null, loading: !!opId && enabled });
  const key = JSON.stringify([opId, opts, auth.token, auth.terminalId, auth.branchId]);
  const keyRef = useRef(key);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!opId || !enabled || !auth.token) { setState((s) => ({ ...s, loading: false })); return; }
    let alive = true;
    const changedKey = keyRef.current !== key;
    keyRef.current = key;
    if (changedKey) setState({ data: null, error: null, loading: true });
    call<T>(auth, opId, opts).then((r) => alive && setState({ data: r.data, error: null, loading: false })).catch((e) => {
      if (!alive) return;
      if (e instanceof ApiFailure && e.code === 'UNAUTHENTICATED' && auth.token) { devices.logout(auth.deviceId); toast('warning', t('الجلسة انتهت أو الحساب اتوقف — سجّل دخول تاني'), 'UNAUTHENTICATED 401', auth.label); }
      setState((s) => ({ data: changedKey ? null : s.data, error: e, loading: false }));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, v, enabled, bump]);
  return { ...state, refetch: () => setBump((b) => b + 1) };
}

// ───────── approval requests (per device)
export interface ApprovalRequest { id: number; deviceId: string; auth: DeviceAuth; details: any; resolve: (grantId: string | null) => void }
let approvals: ApprovalRequest[] = [];
let aid = 0;
const al = new Set<() => void>();
export function requestApproval(auth: DeviceAuth, details: any): Promise<string | null> {
  return new Promise((resolve) => {
    approvals = [...approvals, { id: ++aid, deviceId: auth.deviceId, auth, details, resolve: (g) => { approvals = approvals.filter((a) => a.id !== aidOf); al.forEach((f) => f()); resolve(g); } }];
    const aidOf = aid;
    al.forEach((f) => f());
  });
}
export function useApprovals(deviceId: string) {
  const list = useSyncExternalStore((cb) => { al.add(cb); return () => al.delete(cb); }, () => approvals);
  return list.filter((a) => a.deviceId === deviceId);
}

// ───────── unknown outcomes (lost response): only "retry the same command" is offered
export interface Unknown { id: number; deviceId: string; auth: DeviceAuth; opId: string; opts: any; commandId: string; label: string; refId?: string; resolve: (v: any) => void }
let unknowns: Unknown[] = [];
let uid = 0;
const ul = new Set<() => void>();
function emitU() { ul.forEach((f) => f()); }
export function useUnknowns(deviceId?: string) {
  const list = useSyncExternalStore((cb) => { ul.add(cb); return () => ul.delete(cb); }, () => unknowns);
  return deviceId ? list.filter((u) => u.deviceId === deviceId) : list;
}
export async function retryUnknown(u: Unknown) {
  try {
    const r = await call(u.auth, u.opId, { ...u.opts, commandId: u.commandId });
    unknowns = unknowns.filter((x) => x.id !== u.id); emitU();
    toast('success', r.replayed ? t('اتأكدنا: الطلب كان اتنفذ — ده نفس النتيجة المحفوظة (Idempotent-Replayed)') : t('اتنفذ'), `${u.opId} · X-Command-Id ${u.commandId.slice(0, 8)}…`, u.auth.label);
    u.resolve(r.data);
  } catch (e) {
    if (e instanceof ApiFailure && e.network) { toast('error', t('لسه مفيش رد — جرّب تاني'), undefined, u.auth.label); return; }
    unknowns = unknowns.filter((x) => x.id !== u.id); emitU();
    toast('error', errorText(e), (e as any).code, u.auth.label);
    u.resolve(null);
  }
}

export interface RunOptions { params?: Record<string, any>; query?: Record<string, any>; body?: any; commandId?: string }
export interface RunMeta { success?: string; quiet?: boolean; refId?: string; label?: string }

export function useCommand() {
  const { auth } = useDev();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T = any,>(opId: string, opts: RunOptions = {}, meta: RunMeta = {}): Promise<T | null> => {
    const commandId = opts.commandId ?? newCommandId();
    let body = opts.body;
    setBusy(true);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await call<T>(auth, opId, { ...opts, body, commandId });
          if (meta.success) toast('success', meta.success, r.replayed ? 'Idempotent-Replayed: true' : undefined, auth.label);
          return r.data;
        } catch (e) {
          if (!(e instanceof ApiFailure)) throw e;
          if (e.code === 'APPROVAL_REQUIRED') {
            const grantId = await requestApproval(auth, { ...e.details, opId });
            if (!grantId) { toast('info', t('اتلغت الموافقة — مفيش حاجة اتكتبت'), 'APPROVAL_REQUIRED 403', auth.label); return null; }
            body = { ...(body ?? {}), approvalGrantId: grantId };
            continue; // same X-Command-Id, now with the grant
          }
          if (e.network) {
            return await new Promise<T | null>((resolve) => {
              unknowns = [...unknowns, { id: ++uid, deviceId: auth.deviceId, auth, opId, opts: { ...opts, body }, commandId, label: meta.label ?? opId, refId: meta.refId, resolve }];
              emitU();
            });
          }
          if (e.code === 'UNAUTHENTICATED') { devices.logout(auth.deviceId); toast('warning', t('الجلسة انتهت أو الحساب اتوقف — سجّل دخول تاني'), 'UNAUTHENTICATED 401', auth.label); return null; }
          if (meta.quiet) throw e;
          if (e.code === 'CONCURRENCY_CONFLICT') { refreshAll(); toast('warning', errorText(e), 'CONCURRENCY_CONFLICT 409', auth.label); return null; }
          toast('error', errorText(e), `${e.code} · ${e.status}`, auth.label);
          return null;
        }
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [auth]);
  return { run, busy };
}

export function DeviceProvider({ value, children }: { value: DevCtx; children: React.ReactNode }) {
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
