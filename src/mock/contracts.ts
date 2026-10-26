// The real contracts, loaded into the browser. Every simulated endpoint comes from here.
import operationsJson from '../contracts/operations.json';
import errorsJson from '../contracts/errors.json';
import policiesJson from '../contracts/policies.json';
import approvalActionsJson from '../contracts/approval_actions.json';
import egProfileJson from '../contracts/eg-profile.json';
import seedJson from '../contracts/seed.json';

export interface OperationDef {
  id: string; module: string; kind: 'CMD' | 'QRY' | string; method: string; path: string; permission: string;
  input: Record<string, { type: string; required: boolean }>; output: string | null; errors: string[];
  approval: { mode: string; action: string } | null; backend_state: 'BUILT_ON_MAIN' | 'SPECIFIED' | 'PD_HELD' | 'PROPOSED' | 'DECLARED'; note?: string | null; source?: string;
}
export interface ErrorDef { code: string; http_status: number; condition: string; safe_message: string; retryable: boolean }

/**
 * Operations the prototype needs that are not in operations.json.
 * Named in the style of the contracts; every one is listed in PROTOTYPE_GAPS.md and badged in the UI.
 */
export const PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Kitchen.Resend', module: 'kitchen', kind: 'CMD', method: 'POST', path: '/orders/{orderId}/kitchen/resend', permission: 'order:fire', input: { orderId: { type: 'Ref<orders.Order>', required: true }, commandId: { type: 'CommandId', required: true } }, output: 'KitchenFulfillmentView', errors: ['ORDER_NOT_FOUND', 'VALIDATION_FAILED'], approval: null, backend_state: 'DECLARED', note: 'E-38 declared; path not in operations.json' },
  { id: 'Print.PreBill', module: 'printing', kind: 'CMD', method: 'POST', path: '/orders/{orderId}/pre-bill', permission: 'order:read', input: { orderId: { type: 'Ref<orders.Order>', required: true }, terminalId: { type: 'Ref<organization.Terminal>', required: true } }, output: 'PrintJobView', errors: ['ORDER_NOT_FOUND'], approval: null, backend_state: 'PROPOSED', note: 'PRN-GAP-02' },
  { id: 'Print.Document', module: 'printing', kind: 'CMD', method: 'POST', path: '/print-jobs/documents', permission: 'order:read', input: { documentType: { type: 'Code', required: true }, documentId: { type: 'Id', required: true }, terminalId: { type: 'Ref<organization.Terminal>', required: true } }, output: 'PrintJobView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'PRN-GAP-01 generalised print command' },
  { id: 'Order.ModifyFiredLine', module: 'orders', kind: 'CMD', method: 'POST', path: '/orders/{orderId}/lines/{lineId}/kitchen-modifications', permission: 'order:updateline', input: { text: { type: 'Text', required: true } }, output: 'OrderView', errors: ['LINE_NOT_FIRED'], approval: null, backend_state: 'PROPOSED', note: 'D12' },
  { id: 'Order.AssignSeat', module: 'orders', kind: 'CMD', method: 'POST', path: '/orders/{orderId}/lines/{lineId}/seat', permission: 'order:updateline', input: { seat: { type: 'Integer', required: false } }, output: 'OrderView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D2' },
  { id: 'Order.CreateStaffMeal', module: 'orders', kind: 'CMD', method: 'POST', path: '/staff-meals', permission: 'order:create', input: {}, output: 'OrderView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D9' },
  { id: 'Deposit.Create', module: 'payments', kind: 'CMD', method: 'POST', path: '/deposits', permission: 'payment:capture', input: {}, output: 'DepositView', errors: ['SESSION_NOT_OPEN'], approval: null, backend_state: 'PROPOSED', note: 'D10' },
  { id: 'Deposit.Find', module: 'payments', kind: 'QRY', method: 'GET', path: '/deposits', permission: 'payment:read', input: {}, output: 'Page<DepositView>', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D10' },
  { id: 'Deposit.Apply', module: 'payments', kind: 'CMD', method: 'POST', path: '/deposits/{depositId}/apply', permission: 'payment:capture', input: {}, output: 'DepositView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D10' },
  { id: 'Reservation.MarkNoShow', module: 'tables', kind: 'CMD', method: 'POST', path: '/reservations/{reservationId}/no-show', permission: 'table:assign', input: {}, output: 'ReservationView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D14' },
  { id: 'Reservation.Seat', module: 'tables', kind: 'CMD', method: 'POST', path: '/reservations/{reservationId}/seat', permission: 'table:assign', input: {}, output: 'ReservationView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D14' },
  { id: 'Tip.Distribute', module: 'payments', kind: 'CMD', method: 'POST', path: '/sessions/{sessionId}/tips/distribute', permission: 'session:close', input: {}, output: 'TipDistributionView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D6' },
  { id: 'Report.AccountantExport', module: 'reporting', kind: 'QRY', method: 'GET', path: '/reports/exports/accountant', permission: 'report:run', input: {}, output: 'CSV', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D13' },
  { id: 'FiscalSetup.Get', module: 'compliance', kind: 'QRY', method: 'GET', path: '/compliance/setup', permission: 'compliance:read', input: {}, output: 'FiscalSetupView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'G4 needs a read of profile/devices/mappings; only writers exist' },
  { id: 'Table.Release', module: 'tables', kind: 'CMD', method: 'POST', path: '/table-visits/{visitId}/release-table', permission: 'table:release', input: {}, output: 'TableVisitView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'D5 release a joined table' },
];

export const operations: OperationDef[] = [...(operationsJson as unknown as OperationDef[]), ...PROPOSED_OPERATIONS];
export const opsById = new Map(operations.map((o) => [o.id, o]));
export const errorsByCode = new Map((errorsJson as ErrorDef[]).map((e) => [e.code, e]));
export const policyDefs = policiesJson as { id: string; owner: string; type: string; allowed: unknown; default: unknown; scope_dimensions: unknown; note: string | null }[];
export const approvalActionDefs = approvalActionsJson as { id: string; commands: string[]; target: string; context: string[]; default_rule: { mode: string; field?: string; threshold?: string }; approver_permission: string }[];
export const egProfile = egProfileJson as {
  values: { policyId: string; scope: string; value: unknown; label: string; confidence: string; reviewer: string; expertQuestion: string; source: string }[];
  owner_data: { id: string; operation: string; data: any; confidence: string; expertQuestion: string }[];
  pending: { policyId: string; awaiting: string; value: unknown; confidence: string; expertQuestion: string }[];
};
export const seed = seedJson as any;

// Route matcher: literal segments win over parameters.
interface CompiledRoute { op: OperationDef; re: RegExp; keys: string[]; score: number }
const compiled: CompiledRoute[] = operations
  .map((op) => {
    const keys: string[] = [];
    const re = new RegExp(
      '^' + op.path.replace(/\{(\w+)\}/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$',
    );
    return { op, re, keys, score: keys.length };
  })
  .sort((a, b) => a.score - b.score);

export function matchRoute(method: string, path: string): { op: OperationDef; params: Record<string, string> } | null {
  for (const r of compiled) {
    if (r.op.method !== method) continue;
    const m = path.match(r.re);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    return { op: r.op, params };
  }
  return null;
}

export function buildPath(opId: string, params: Record<string, string | number> = {}): { method: string; path: string } {
  const op = opsById.get(opId);
  if (!op) throw new Error(`Unknown operation ${opId}`);
  const path = op.path.replace(/\{(\w+)\}/g, (_, k) => {
    if (params[k] === undefined) throw new Error(`Missing path param ${k} for ${opId}`);
    return encodeURIComponent(String(params[k]));
  });
  return { method: op.method, path };
}

export type BadgeState = 'BUILT' | 'SPECIFIED' | 'PROPOSED';
export function badgeOfOp(id: string): BadgeState {
  const s = opsById.get(id)?.backend_state;
  if (s === 'BUILT_ON_MAIN') return 'BUILT';
  if (s === 'SPECIFIED' || s === 'DECLARED') return 'SPECIFIED';
  return 'PROPOSED';
}
export function badgeOfOps(ids: string[]): BadgeState {
  const states = ids.map(badgeOfOp);
  if (states.includes('PROPOSED')) return 'PROPOSED';
  if (states.includes('SPECIFIED')) return 'SPECIFIED';
  return 'BUILT';
}
