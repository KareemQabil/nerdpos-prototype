// Automation helpers for the walkthrough player and the negative controls. They drive the same API the
// screens use, as a given user on a given simulated device, so every step is visible on the devices.
import { call, ApiFailure, newCommandId, type DeviceAuth } from '../api/client';
import { devices } from '../app/devices';
import { store } from '../mock/store';
import { demo } from '../mock/demo';
import { errorsAr, errorsEn } from '../i18n/errors';
import { t, getLang } from '../i18n';
/** The plain error sentence for a code in the UI language. */
const errMsg = (code: string | undefined, fallback?: string) => (code ? (getLang() === 'en' ? errorsEn[code] ?? errorsAr[code] : errorsAr[code]) : undefined) ?? fallback ?? '';
import { actorOf, doneText, loginText, approvalAskText } from './humanLog';

/** `text` is the technical line (shown with technical details on); `plain` is the same step in plain words for demo users. */
export interface LogLine { ok: boolean | null; text: string; code?: string; plain?: string }
export type Logger = (l: LogLine) => void;

export const userIdOf = (username: string) => store.db.users.find((u) => u.username === username)?.id ?? username;
export const tableId = (name: string, branchId = 'branch_main') => store.db.tables.find((t) => t.name === name && t.branchId === branchId)?.id ?? name;
export const productId = (sku: string) => store.db.products.find((p) => p.sku === sku)?.id ?? sku;
export const terminalByCode = (code: string) => store.db.terminals.find((t) => t.code === code)?.id ?? code;

/** Ensure `deviceId` is logged in as `username` (demo PIN) and return its auth. */
export async function as(deviceId: string, username: string, log?: Logger): Promise<DeviceAuth> {
  const d = devices.get(deviceId);
  const uid = userIdOf(username);
  const session = d.token ? store.db.authSessions.find((s) => s.id === d.token && !s.revokedAt) : null;
  if (session && session.userId === uid) return devices.auth(deviceId);
  const a = { ...devices.auth(deviceId), token: null };
  const r = await call(a, 'Auth.Login', { body: { method: 'PIN', username, secret: demo.pin } });
  devices.update(deviceId, { token: r.data.token, userName: r.data.user.displayName, branchId: r.data.branchId ?? d.branchId });
  log?.({ ok: true, text: `Auth.Login ${username} @ ${a.label}`, plain: loginText(username, deviceId) });
  return devices.auth(deviceId);
}

export async function api<T = any>(dev: DeviceAuth, opId: string, opts: { params?: any; query?: any; body?: any; commandId?: string } = {}, log?: Logger, label?: string): Promise<T> {
  try {
    const r = await call<T>(dev, opId, opts);
    log?.({ ok: true, text: `${opId}${label ? ' — ' + label : ''} → ${r.status}${r.replayed ? ' (Idempotent-Replayed)' : ''}`, plain: doneText(opId, actorOf(dev.token), opts, r.data) + (r.replayed ? t(' (نفس النتيجة اللي اتحفظت — ما اتكررش)') : '') });
    return r.data;
  } catch (e) {
    if (e instanceof ApiFailure) log?.({ ok: false, text: `${opId}${label ? ' — ' + label : ''} → ${e.status} ${e.code}`, code: e.code, plain: t('ما نفعش: {e}', { e: errMsg(e.code, t('حصلت مشكلة')) }) });
    throw e;
  }
}

/** Expect a refusal with `code`; logs ✓ when it happens, ✗ otherwise. Returns the failure. */
export async function expectRefusal(p: Promise<any>, code: string, log: Logger, label: string, plain?: string): Promise<ApiFailure | null> {
  const tried = plain ?? t('المحاولة');
  try {
    await p;
    log({ ok: false, text: `${label}: ${'expected'} ${code}, got success`, plain: t('{x}: كان المفروض تترفض، بس اتقبلت', { x: tried }) });
    return null;
  } catch (e) {
    if (e instanceof ApiFailure && e.code === code) {
      log({ ok: true, text: `${label}: ${code} ${e.status} — ${errorsAr[code] ?? ''}`, code, plain: t('{x} — اترفضت زي المتوقع: «{e}»', { x: tried, e: errMsg(code) }) });
      return e;
    }
    log({ ok: false, text: `${label}: expected ${code}, got ${(e as any).code ?? e}`, plain: t('{x}: اترفضت لسبب تاني غير المتوقع ({e})', { x: tried, e: errMsg((e as any).code, t('مشكلة')) }) });
    return null;
  }
}

/** Run a command; if APPROVAL_REQUIRED, the approver enters their PIN on the same device and the same command id retries. */
export async function withApproval<T = any>(dev: DeviceAuth, opId: string, opts: { params?: any; body?: any }, approver: string, log: Logger, label?: string): Promise<T> {
  const commandId = newCommandId();
  try {
    const r = await call<T>(dev, opId, { ...opts, commandId });
    log({ ok: true, text: `${opId}${label ? ' — ' + label : ''} → ${r.status} (no approval needed by the current rule)`, plain: `${doneText(opId, actorOf(dev.token), { ...opts, commandId } as any, r.data)}${t(' (من غير موافقة حسب الإعداد الحالي)')}` });
    return r.data;
  } catch (e) {
    if (!(e instanceof ApiFailure)) throw e;
    if (e.code !== 'APPROVAL_REQUIRED') { log({ ok: false, text: `${opId}${label ? ' — ' + label : ''} → ${e.status} ${e.code}`, code: e.code, plain: t('ما نفعش: {e}', { e: errMsg(e.code, t('حصلت مشكلة')) }) }); throw e; }
    log({ ok: true, text: `${opId}${label ? ' — ' + label : ''} → 403 APPROVAL_REQUIRED (${e.details?.action}) — manager popup`, code: e.code, plain: approvalAskText(e.details?.action, dev.deviceId) });
    const d = e.details;
    const g = await api<any>(dev, 'Approval.Grant', { body: { action: d.action, targetType: d.targetType, targetId: d.targetId, context: d.context, approverUserId: userIdOf(approver), approverCredentialKind: 'PIN', approverSecret: demo.pin } }, log, `${approver} PIN`);
    return api<T>(dev, opId, { ...opts, body: { ...(opts.body ?? {}), approvalGrantId: g.grantId }, commandId }, log, `${label ?? ''} + grant (same X-Command-Id)`);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function openVisit(tableName: string) {
  const tid = tableId(tableName);
  return store.db.visits.find((v) => v.state === 'OPEN' && (v.tableId === tid || v.joinedTableIds.includes(tid))) ?? null;
}
export function checksOf(visitId: string) {
  return store.db.orders.filter((o) => o.visitId === visitId).sort((a, b) => a.checkNo - b.checkNo);
}
export function lastVisit(tableName: string) {
  const tid = tableId(tableName);
  return [...store.db.visits].reverse().find((v) => v.tableId === tid) ?? null;
}
export const order = (id: string) => store.db.orders.find((o) => o.id === id)!;
export const openSession = (terminalId: string) => store.db.sessions.find((s) => s.terminalId === terminalId && s.state === 'OPEN') ?? null;
