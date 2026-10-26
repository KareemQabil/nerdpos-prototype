// Device context, server queries and commands (approval flow, unknown outcome, conflicts).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { call, ApiFailure, newCommandId, type DeviceAuth } from '../api/client';
import { devices } from './devices';
import { store } from '../mock/store';
import { toast } from '../ui';
import { t, getLang } from '../i18n';
import { errorsAr, errorsEn } from '../i18n/errors';
import { sim } from '../mock/sim';
import { clock } from '../mock/clock';
import { OFFLINE_ALLOWLIST, capabilityOn } from '../mock/ops-registry';
import { policy } from '../mock/policies';

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
  const [state, setState] = useState<{ data: T | null; error: ApiFailure | null; loading: boolean; stale?: boolean }>({ data: null, error: null, loading: !!opId && enabled });
  const key = JSON.stringify([opId, opts, auth.token, auth.terminalId, auth.branchId]);
  const keyRef = useRef(key);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (!opId || !enabled || !auth.token) { setState((s) => ({ ...s, loading: false })); return; }
    let alive = true;
    const changedKey = keyRef.current !== key;
    keyRef.current = key;
    if (changedKey) setState({ data: null, error: null, loading: true });
    call<T>(auth, opId, opts).then((r) => alive && setState({ data: r.data, error: null, loading: false, stale: !!r.stale })).catch((e) => {
      if (!alive) return;
      if (e instanceof ApiFailure && e.code === 'UNAUTHENTICATED' && auth.token) { devices.logout(auth.deviceId); toast('warning', t('الجلسة انتهت أو الحساب اتوقف — سجّل دخول تاني'), 'UNAUTHENTICATED 401', auth.label); }
      setState((s) => ({ data: changedKey ? null : s.data, error: e, loading: false, stale: e instanceof ApiFailure && e.offline ? true : s.stale }));
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
            const grantId = await requestApproval(auth, { ...e.details, opId, commandId });
            if (!grantId) { toast('info', t('اتلغت الموافقة — مفيش حاجة اتكتبت'), 'APPROVAL_REQUIRED 403', auth.label); return null; }
            body = { ...(body ?? {}), approvalGrantId: grantId };
            continue; // same X-Command-Id, now with the grant
          }
          if (e.offline) {
            // the device has no network: allowed operations are recorded on the device and replayed on reconnect
            const branchId = auth.branchId ?? store.db.terminals.find((x) => x.id === auth.terminalId)?.branchId ?? null;
            const max = policy<{ maxQueued?: number }>('OfflineModePolicy', { branchId })?.maxQueued ?? 50;
            if (!OFFLINE_ALLOWLIST[opId] || !capabilityOn(store.db, 'OFFLINE', branchId)) {
              toast('error', !OFFLINE_ALLOWLIST[opId] ? t('مفيش نت — العملية دي مينفعش تتعمل من غير نت. استنى لما النت يرجع.') : t('مفيش نت — والشغل من غير نت مقفول في الإمكانيات.'), `OFFLINE · ${opId}`, auth.label);
              return null;
            }
            if (queue.filter((x) => x.deviceId === auth.deviceId).length >= max) { toast('error', t('مفيش نت — وعدد العمليات المستنية وصل للحد. استنى لما النت يرجع.'), `OfflineModePolicy.maxQueued ${max}`, auth.label); return null; }
            enqueueOffline({ id: commandId, deviceId: auth.deviceId, auth, opId, params: opts.params ?? {}, body: body ?? {}, label: offlineLabel(opId, opts, body, meta), queuedAt: clock.iso() });
            toast('warning', t('اتسجلت على الجهاز من غير نت — هتتبعت أول ما النت يرجع'), `${opId} · X-Command-Id ${commandId.slice(0, 8)}…`, auth.label);
            return null;
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

// ───────── offline queue (per device): allowed commands recorded while the network is cut, replayed on reconnect
export interface QueuedCommand { id: string; deviceId: string; auth: DeviceAuth; opId: string; params: Record<string, any>; body: any; label: string; queuedAt: string }
const QKEY = 'nerdpos.offlineQueue.v1';
let queue: QueuedCommand[] = (() => { try { return JSON.parse(localStorage.getItem(QKEY) ?? '[]'); } catch { return []; } })();
const ql = new Set<() => void>();
function saveQueue() { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch { /* ignore */ } ql.forEach((f) => f()); }
function enqueueOffline(q: QueuedCommand) { queue = [...queue.filter((x) => x.id !== q.id), q]; saveQueue(); }
export function useOfflineQueue(deviceId?: string) {
  const list = useSyncExternalStore((cb) => { ql.add(cb); return () => ql.delete(cb); }, () => queue);
  return deviceId ? list.filter((x) => x.deviceId === deviceId) : list;
}
export function dropQueued(id: string) { queue = queue.filter((x) => x.id !== id); saveQueue(); }
export function clearOfflineQueue() { queue = []; saveQueue(); }

function offlineLabel(opId: string, opts: RunOptions, body: any, meta: RunMeta): string {
  const db = store.db;
  const base = OFFLINE_ALLOWLIST[opId]?.ar ?? opId;
  const order = opts.params?.orderId ? db.orders.find((o) => o.id === opts.params!.orderId) : null;
  const where = order ? ` · #${order.number}${order.tableId ? ' ' + t('ترابيزة') + ' ' + (db.tables.find((x) => x.id === order.tableId)?.name ?? '') : ''}` : '';
  if (opId === 'Order.AddLines') return `${base}${where}: ${(body?.lines ?? []).map((l: any) => `${db.products.find((p) => p.id === l.productId)?.name.ar ?? ''} ×${l.quantity ?? 1}`).join(t('، '))}`;
  if (opId === 'Kitchen.AdvanceTicket' || opId === 'TicketItem.Bump') { const tk = db.tickets.find((x) => x.id === opts.params?.ticketId); return `${base}${tk ? ` · #${tk.orderNumber} ${t('جولة')} ${tk.round}` : ''}${body?.toState ? ' → ' + ({ IN_PROGRESS: t('بيتعمل'), READY: t('جاهز'), DONE: t('اتسلّم') } as Record<string, string>)[body.toState] : ''}`; }
  if (opId === 'TableVisit.Open' || opId === 'Table.MarkClean') return `${base} ${db.tables.find((x) => x.id === opts.params?.tableId)?.name ?? ''}`;
  if (opId === 'Payment.Capture') return `${base}${where}`;
  return `${base}${where}${meta.label ? ' — ' + meta.label : ''}`;
}

let replaying = new Set<string>();
/** Send a device's recorded commands (same command ids) to Sync.Replay. Conflicts stay on the server for a decision. */
export async function replayOffline(deviceId: string): Promise<{ applied: number; conflicts: number; rejected: number; duplicates: number } | null> {
  const items = queue.filter((x) => x.deviceId === deviceId);
  if (!items.length || replaying.has(deviceId) || sim.isOffline(deviceId)) return null;
  replaying.add(deviceId);
  const cur = devices.auth(deviceId);
  const auth = cur.token ? cur : items[0].auth;
  try {
    const r = await call<any>(auth, 'Sync.Replay', { body: { commands: items.map((q) => ({ offlineCommandId: q.id, operation: q.opId, params: q.params, body: q.body, queuedAt: q.queuedAt, label: q.label })) } });
    const done = new Set<string>((r.data.results ?? []).map((x: any) => x.offlineCommandId));
    queue = queue.filter((x) => !(x.deviceId === deviceId && done.has(x.id)));
    saveQueue();
    const { applied, conflicts, rejected, duplicates } = r.data;
    if (conflicts || rejected) toast('warning', t('النت رجع: {a} عملية اتبعتت، و{c} محتاجين قرار — افتح شاشة المزامنة', { a: applied + duplicates, c: conflicts + rejected }), 'Sync.Replay', auth.label);
    else toast('success', t('النت رجع: كل العمليات اللي اتسجلت ({n}) اتبعتت', { n: applied + duplicates }), 'Sync.Replay', auth.label);
    refreshAll();
    return r.data;
  } catch (e) {
    if (!(e instanceof ApiFailure && e.network)) toast('error', errorText(e), (e as any).code, auth.label);
    return null;
  } finally { replaying.delete(deviceId); }
}
// reconnect: replay as soon as a device's network comes back
let wasOffline = new Set<string>(sim.get().offlineDevices ?? []);
sim.subscribe(() => {
  const now = new Set<string>(sim.get().offlineDevices ?? []);
  for (const d of wasOffline) if (!now.has(d)) setTimeout(() => replayOffline(d), 250);
  wasOffline = now;
});

export function DeviceProvider({ value, children }: { value: DevCtx; children: React.ReactNode }) {
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}
