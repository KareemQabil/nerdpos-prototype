// Client for the (mocked) NerdPOS API. Paths come from the contracts; every command carries X-Command-Id.
import { buildPath, opsById } from '../mock/contracts';

export interface DeviceAuth { deviceId: string; label: string; terminalId: string | null; branchId: string | null; token: string | null }

export class ApiFailure extends Error {
  status: number;
  code: string;
  messageAr: string | null;
  details: any;
  network: boolean;
  commandId: string | null;
  opId: string;
  constructor(init: { status: number; code: string; message: string; messageAr?: string | null; details?: any; network?: boolean; commandId?: string | null; opId: string }) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.messageAr = init.messageAr ?? null;
    this.details = init.details ?? null;
    this.network = !!init.network;
    this.commandId = init.commandId ?? null;
    this.opId = init.opId;
  }
}

export interface CallResult<T = any> { status: number; data: T; replayed: boolean; commandId: string | null }

export const newCommandId = () => (crypto?.randomUUID ? crypto.randomUUID() : `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export async function call<T = any>(dev: DeviceAuth, opId: string, opts: { params?: Record<string, any>; query?: Record<string, any>; body?: any; commandId?: string } = {}): Promise<CallResult<T>> {
  const op = opsById.get(opId);
  if (!op) throw new Error(`unknown operation ${opId}`);
  const { method, path } = buildPath(opId, opts.params ?? {});
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString() : '';
  const isCmd = op.kind === 'CMD';
  const commandId = isCmd ? opts.commandId ?? newCommandId() : null;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-device-label': dev.label };
  if (dev.token) headers['authorization'] = `Bearer ${dev.token}`;
  if (dev.terminalId) headers['x-terminal-id'] = dev.terminalId;
  if (!dev.terminalId && dev.branchId) headers['x-branch-id'] = dev.branchId;
  if (commandId) headers['x-command-id'] = commandId;
  let res: Response;
  try {
    res = await fetch('/api' + path + (qs.length > 1 ? qs : ''), { method, headers, body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}) });
  } catch (e) {
    if ((globalThis as any).__DEBUG_FETCH) console.error(e);
    throw new ApiFailure({ status: 0, code: 'UNKNOWN_OUTCOME', message: 'network failure', messageAr: null, network: true, commandId, opId });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiFailure({ status: res.status, code: err.code ?? 'INTERNAL_ERROR', message: err.message ?? res.statusText, messageAr: err.messageAr, details: err.details, commandId, opId });
  }
  return { status: res.status, data, replayed: res.headers.get('idempotent-replayed') === 'true', commandId };
}
