// ux-04 (kitchen displays, call board, customer display, line size change): proposed operations and the input
// extensions of existing operations. Not in operations.json; badged «مقترح» in the UI and listed in PROTOTYPE_GAPS.md.
import type { OperationDef } from './contracts';

export const UX04_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Kitchen.CallOrder', module: 'kitchen', kind: 'CMD', method: 'POST', path: '/kitchen/orders/{orderId}/call', permission: 'kitchen:advanceticket', input: { orderId: { type: 'Ref<orders.Order>', required: true }, force: { type: 'Boolean', required: false } }, output: 'CallView', errors: ['ORDER_NOT_FOUND', 'KDS_DISPATCH_ONLY', 'KITCHEN_TRANSITION_INVALID', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-04: the dispatch screen calls the order number to the call board (only when every station is ready); calling again re-announces it' },
  { id: 'CallBoard.View', module: 'kitchen', kind: 'QRY', method: 'GET', path: '/call-board', permission: 'kitchen:read', input: { readyMinutes: { type: 'Integer', required: false }, auto: { type: 'Boolean', required: false } }, output: 'CallBoardView', errors: [], approval: null, backend_state: 'PROPOSED', note: 'ux-04: numbers being prepared and numbers called; a number leaves after hand-off or readyMinutes after the call; orders with a table are served at the table and are not shown' },
  { id: 'CustomerDisplay.View', module: 'orders', kind: 'QRY', method: 'GET', path: '/customer-display', permission: 'order:read', input: { orderId: { type: 'Ref<orders.Order>', required: false } }, output: 'CustomerDisplayView', errors: ['ORDER_NOT_FOUND'], approval: null, backend_state: 'PROPOSED', note: 'ux-04: guest-facing read model of the check on a cashier terminal: venue branding, active promotions, lines, server totals and settlement only' },
];

/** Optional inputs added to existing operations by ux-04 (the handlers accept them; the shape stays backward compatible). */
export const UX04_INPUT_EXTENSIONS: Record<string, Record<string, { type: string; required: boolean }>> = {
  'Order.UpdateLine': { variantId: { type: 'Ref<catalog.Variant>', required: false } }, // size of an UNSENT line, re-priced by the server
  'KdsScreen.Configure': { warnMinutes: { type: 'Integer', required: false }, lateMinutes: { type: 'Integer', required: false }, itemBump: { type: 'Boolean', required: false } },
  'Ticket.Recall': { undo: { type: 'Boolean', required: false } }, // undo a hand-off within 2 minutes: back to ready, not to cooking
};

export function applyUx04Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX04_INPUT_EXTENSIONS[op.id];
    if (!ext) continue;
    op.input = { ...(op.input ?? {}), ...ext };
    op.note = `${op.note ? op.note + ' · ' : ''}ux-04 extension: ${Object.keys(ext).join(', ')}`;
  }
}

// ux-05 (boards): purchase-order approval step. «بانتظار الاعتماد» is a real state: a buyer sends the draft for
// approval; issuing it then needs an approver's grant (PURCHASE_ORDER_APPROVE, same popup / PIN / X-Command-Id retry as
// the till); returning it to draft needs a reason. Issuing a draft directly stays as before (backward compatible).
export const UX05_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'PurchaseOrder.Submit', module: 'purchasing', kind: 'CMD', method: 'POST', path: '/purchase-orders/{purchaseOrderId}/submit', permission: 'purchaseorder:update', input: { purchaseOrderId: { type: 'Ref<purchasing.PurchaseOrder>', required: true }, expectedVersion: { type: 'Version', required: true } }, output: 'PurchaseOrderView', errors: ['PURCHASE_ORDER_NOT_FOUND', 'PURCHASE_ORDER_NOT_DRAFT', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-05: DRAFT → PENDING_APPROVAL; the order is locked while waiting' },
  { id: 'PurchaseOrder.ReturnToDraft', module: 'purchasing', kind: 'CMD', method: 'POST', path: '/purchase-orders/{purchaseOrderId}/return-to-draft', permission: 'purchaseorder:issue', input: { purchaseOrderId: { type: 'Ref<purchasing.PurchaseOrder>', required: true }, expectedVersion: { type: 'Version', required: true }, reason: { type: 'Text', required: true } }, output: 'PurchaseOrderView', errors: ['PURCHASE_ORDER_NOT_FOUND', 'PURCHASE_ORDER_NOT_PENDING_APPROVAL', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-05: PENDING_APPROVAL → DRAFT with a required reason (the approver refuses it)' },
];
export const UX05_INPUT_EXTENSIONS: Record<string, Record<string, { type: string; required: boolean }>> = {
  'PurchaseOrder.Issue': { approvalGrantId: { type: 'Ref<approvals.ApprovalGrant>', required: false } }, // from PENDING_APPROVAL: PURCHASE_ORDER_APPROVE grant
};
export function applyUx05Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX05_INPUT_EXTENSIONS[op.id];
    if (!ext) continue;
    op.input = { ...(op.input ?? {}), ...ext };
    op.note = `${op.note ? op.note + ' · ' : ''}ux-05 extension: ${Object.keys(ext).join(', ')}`;
    if (op.id === 'PurchaseOrder.Issue') { op.errors = [...new Set([...(op.errors ?? []), 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED'])]; op.approval = { mode: 'WHEN_PENDING_APPROVAL', action: 'PURCHASE_ORDER_APPROVE' }; }
  }
}

// ux-09 (profiles drive navigation): a user's work profile. Owner decision pending — the default: the profile comes
// from the role, and a user may carry an override (null = «حسب الدور»). The profile is UI only (which screens are in
// the person's way, where they start, the action bar and keys); it never grants a permission, so changing it is not an
// access change (no USER_ACCESS_CHANGE approval) — it is audited like the other user edits.
/** The work profiles a user can be given (same ids as src/app/profiles.ts; the app's Profile.id is typed by this list). */
export const WORK_PROFILE_IDS = [
  'cashier', 'waiter', 'captain', 'host', 'runner', 'barista', 'bartender',
  'stationChef', 'expediter', 'kitchenManager',
  'shiftManager', 'branchManager', 'areaManager', 'owner',
  'accountant', 'auditor', 'storekeeper', 'purchasing',
  'driver', 'dispatcher', 'callCenter',
  'support',
] as const;
export type WorkProfileId = (typeof WORK_PROFILE_IDS)[number];
export const UX09_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'User.SetProfile', module: 'access', kind: 'CMD', method: 'POST', path: '/users/{userId}/profile', permission: 'user:manageaccess', input: { userId: { type: 'Ref<access.User>', required: true }, profileId: { type: 'Code', required: false }, expectedVersion: { type: 'Version', required: true } }, output: 'UserView', errors: ['USER_NOT_FOUND', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-09: work profile override of one user (profileId one of WORK_PROFILE_IDS, or null = from the role); UI only, grants nothing; audited with the old and new value; UserView carries profileId' },
];

// ux-10 (shift and drawer inside the sale screen): no new drawer command — the popups use Session.Open, Cash.Move,
// Drawer.OpenNoSale, Session.XReport and Session.Close (SESSION_VARIANCE approval) unchanged. One PROPOSED rule on the
// existing Refund.Cancel: only the requester of a pending refund (or a holder of refund:reject, the decider) withdraws
// it, with a required reason (trimmed, ≤ 200 characters), CAS on expectedVersion, never after it was approved / paid /
// rejected. The cancellation is recorded as new facts on the case (cancelledBy, cancelledAt, cancelReason), the check's
// history (REFUND_CANCELLED) and the audit; RefundCaseView (Refund.Find) carries cancelledByName.
export const UX10_RULE_EXTENSIONS: Record<string, { errors: string[]; note: string }> = {
  'Refund.Cancel': {
    errors: ['REFUND_CANCEL_NOT_REQUESTER', 'VALIDATION_FAILED'],
    note: 'ux-10 PROPOSED rule: requester (or refund:reject) only — REFUND_CANCEL_NOT_REQUESTER 403 (not in errors.json yet); reason required (VALIDATION_FAILED); REFUND_CASE_NOT_PENDING once approved / paid / rejected / cancelled; CONCURRENCY_CONFLICT on a stale expectedVersion; audited, check history REFUND_CANCELLED; the case keeps cancelledBy / cancelledAt / cancelReason',
  },
};
export function applyUx10Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX10_RULE_EXTENSIONS[op.id];
    if (!ext) continue;
    op.errors = [...new Set([...(op.errors ?? []), ...ext.errors])];
    op.note = `${op.note ? op.note + ' · ' : ''}${ext.note}`;
  }
}
