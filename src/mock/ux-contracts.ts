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

// ux-11 (the riders system): the rider file, rider shifts, the owed ledger (collect / deduct / waive), pay and payouts,
// the assignment suggestion, the RETURNED state, and the rider's own device. Owner decisions pending — defaults used
// (listed in PROTOTYPE_GAPS §15g): DriverPayPolicy PER_TRIP 15.0000 per DELIVERED trip; an old shortage is settled only
// with a manager's approval (DRIVER_OWED_SETTLE); assignment over the cash limit needs DRIVER_CASH_LIMIT_OVERRIDE
// (DeliveryPolicy.cashLimitMode APPROVAL; BLOCK / WARN selectable); RETURNED exists.
const V = { type: 'Version', required: true };
const DRV = { type: 'Ref<delivery.Driver>', required: true };
const GRANT = { type: 'Ref<approvals.ApprovalGrant>', required: false };
export const UX11_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Driver.Get', module: 'delivery', kind: 'QRY', method: 'GET', path: '/drivers/{driverId}', permission: 'delivery:read', input: { driverId: DRV }, output: 'DriverFileView', errors: ['DRIVER_NOT_FOUND'], approval: null, backend_state: 'PROPOSED', note: 'ux-11: the rider file (active or deactivated): today (orders and cash), shifts with minutes, trips (delivered / failed attempts / late / average pick-up→delivered minutes), this rider\'s cash settlements, the account (owed ledger, payouts, payout preview by DriverPayPolicy). A rider (user linked by Driver.userId without delivery:assign) reads only himself' },
  { id: 'DriverShift.Start', module: 'delivery', kind: 'CMD', method: 'POST', path: '/drivers/{driverId}/shift/start', permission: 'delivery:shift', input: { driverId: DRV, expectedVersion: V }, output: 'DriverShiftView', errors: ['DRIVER_NOT_FOUND', 'DRIVER_SHIFT_ALREADY_OPEN', 'CONCURRENCY_CONFLICT'], approval: null, backend_state: 'PROPOSED', note: 'ux-11: opens a shift record (started at / by / terminal); the rider himself or a dispatcher / manager; audited' },
  { id: 'DriverShift.End', module: 'delivery', kind: 'CMD', method: 'POST', path: '/drivers/{driverId}/shift/end', permission: 'delivery:shift', input: { driverId: DRV, expectedVersion: V }, output: 'DriverShiftView', errors: ['DRIVER_NOT_FOUND', 'DRIVER_SHIFT_NOT_OPEN', 'DRIVER_HAS_ACTIVE_DELIVERIES', 'DRIVER_CASH_NOT_SETTLED', 'CONCURRENCY_CONFLICT'], approval: null, backend_state: 'PROPOSED', note: 'ux-11: closes the open shift and records its minutes; refused while the rider has orders on the road or holds cash (the rule Driver.Upsert had); Driver.Upsert {onShift} now goes through the same start / end' },
  { id: 'DriverShift.Find', module: 'delivery', kind: 'QRY', method: 'GET', path: '/driver-shifts', permission: 'delivery:read', input: { driverId: { type: 'Ref<delivery.Driver>', required: false }, open: { type: 'Boolean', required: false }, from: { type: 'Timestamp', required: false }, to: { type: 'Timestamp', required: false } }, output: 'Page<DriverShiftView>', errors: [], approval: null, backend_state: 'PROPOSED', note: 'ux-11: shift log with minutes (running for the open shift) and delivered trips per shift; a rider sees his own' },
  { id: 'Driver.SettleOwed', module: 'delivery', kind: 'CMD', method: 'POST', path: '/drivers/{driverId}/owed/settlements', permission: 'delivery:settlecash', input: { driverId: DRV, mode: { type: 'Enum<COLLECT_CASH|DEDUCT_PAYOUT|WAIVE>', required: true }, amount: { type: 'Money', required: true }, reason: { type: 'Text', required: false }, expectedVersion: V, approvalGrantId: GRANT }, output: 'DriverOwedEntryView', errors: ['DRIVER_NOT_FOUND', 'DRIVER_OWED_OVER_SETTLE', 'DRIVER_PAYOUT_INSUFFICIENT', 'REASON_REQUIRED', 'SESSION_NOT_OPEN', 'CONCURRENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED', 'VALIDATION_FAILED'], approval: { mode: 'ALWAYS', action: 'DRIVER_OWED_SETTLE' }, backend_state: 'PROPOSED', note: 'ux-11 owner decision 2 (default): owed goes down by amount (≤ owed, else DRIVER_OWED_OVER_SETTLE 409); COLLECT_CASH = drawer PAY_IN in this terminal\'s open shift (reason code DRIVER_OWED_COLLECT); DEDUCT_PAYOUT = netted by the next Driver.Payout (≤ unpaid earned pay − deductions already moved, else DRIVER_PAYOUT_INSUFFICIENT 409); WAIVE = written off. DEDUCT_PAYOUT and WAIVE need a reason (≥ 3, ≤ 200). CAS on the rider version; append-only owed ledger entry (before / after / grant / reason); audited' },
  { id: 'Driver.Payout', module: 'delivery', kind: 'CMD', method: 'POST', path: '/drivers/{driverId}/payouts', permission: 'delivery:payout', input: { driverId: DRV, periodTo: { type: 'Timestamp', required: true }, note: { type: 'Text', required: false }, expectedVersion: V, approvalGrantId: GRANT }, output: 'DriverPayoutView', errors: ['DRIVER_NOT_FOUND', 'DRIVER_NOTHING_TO_PAY', 'DRIVER_PAYOUT_INSUFFICIENT', 'SESSION_NOT_OPEN', 'CONCURRENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED', 'VALIDATION_FAILED'], approval: { mode: 'ALWAYS', action: 'DRIVER_PAYOUT' }, backend_state: 'PROPOSED', note: 'ux-11: pays the unpaid DELIVERED trips (PER_TRIP / PERCENT_OF_FEE) or ended shifts (FIXED_SHIFT) up to periodTo (≤ now, after the last payout; sent explicitly so the approval context is stable) by DriverPayPolicy, less the pending DEDUCT_PAYOUT entries; the net leaves this terminal\'s drawer as PAY_OUT (reason code DRIVER_PAYOUT); the payout is immutable (period, rule and rate, trip / shift / deduction ids, gross, deductions, net, grant)' },
  { id: 'DriverPayout.Find', module: 'delivery', kind: 'QRY', method: 'GET', path: '/driver-payouts', permission: 'delivery:read', input: { driverId: { type: 'Ref<delivery.Driver>', required: false } }, output: 'Page<DriverPayoutView>', errors: [], approval: null, backend_state: 'PROPOSED', note: 'ux-11: payouts (a rider sees his own)' },
  { id: 'Delivery.SuggestRider', module: 'delivery', kind: 'QRY', method: 'GET', path: '/deliveries/{deliveryId}/rider-suggestions', permission: 'delivery:assign', input: { deliveryId: { type: 'Ref<delivery.Delivery>', required: true } }, output: 'RiderSuggestionView', errors: ['DELIVERY_NOT_FOUND'], approval: null, backend_state: 'PROPOSED', note: 'ux-11: riders on shift with room, ranked: heading to the same zone, then least load, then free the longest; riders who would go over the cash limit last; suggested = the first' },
  { id: 'Delivery.Return', module: 'delivery', kind: 'CMD', method: 'POST', path: '/deliveries/{deliveryId}/return', permission: 'delivery:assign', input: { deliveryId: { type: 'Ref<delivery.Delivery>', required: true }, note: { type: 'Text', required: false }, expectedVersion: V }, output: 'DeliveryView', errors: ['DELIVERY_NOT_FOUND', 'DELIVERY_TRANSITION_INVALID', 'CONCURRENCY_CONFLICT'], approval: null, backend_state: 'PROPOSED', note: 'ux-11 owner decision 4 (default): FAILED → RETURNED when the food is back at the restaurant (received by staff, not by the rider); RETURNED is assignable (Assign / Dispatch with driverId) or cancellable (Delivery.Cancel unchanged); audited' },
];
/** Rules added to existing operations by ux-11 (errors and notes; the input extensions are listed in the note). */
export const UX11_RULE_EXTENSIONS: Record<string, { errors: string[]; note: string; input?: Record<string, { type: string; required: boolean }>; approval?: { mode: string; action: string } }> = {
  'Delivery.Assign': { errors: ['DRIVER_CASH_LIMIT_EXCEEDED', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED'], input: { approvalGrantId: GRANT }, approval: { mode: 'WHEN_OVER_CASH_LIMIT', action: 'DRIVER_CASH_LIMIT_OVERRIDE' }, note: 'ux-11: assignable from PENDING / FAILED / RETURNED / ASSIGNED; when cash on hand + cash to collect on the rider\'s deliveries + this delivery > DeliveryPolicy.driverCashLimit: cashLimitMode APPROVAL (default) → DRIVER_CASH_LIMIT_OVERRIDE grant, BLOCK → DRIVER_CASH_LIMIT_EXCEEDED 409, WARN → assigned with a timeline note; audited' },
  'Delivery.Dispatch': { errors: ['DRIVER_CASH_LIMIT_EXCEEDED', 'APPROVAL_REQUIRED'], input: { approvalGrantId: GRANT }, note: 'ux-11: the same cash-limit rule when driverId assigns; a rider dispatches («استلمت») only a delivery assigned to him and cannot name another rider' },
  'Delivery.Board': { errors: [], note: 'ux-11: a rider (linked by Driver.userId, without delivery:assign) gets only his own deliveries; summary.returned' },
  'Delivery.Get': { errors: [], note: 'ux-11: another rider\'s delivery answers DELIVERY_NOT_FOUND to a rider' },
  'Delivery.Complete': { errors: [], note: 'ux-11: a rider completes only his own delivery (DELIVERY_NOT_FOUND otherwise)' },
  'Delivery.FailAttempt': { errors: [], note: 'ux-11: a rider records a failed attempt only on his own delivery' },
  'Delivery.Cancel': { errors: [], note: 'ux-11: also from RETURNED' },
  'Driver.Upsert': { errors: ['REASON_REQUIRED', 'DRIVER_CASH_NOT_SETTLED', 'DRIVER_SHIFT_ALREADY_OPEN'], input: { reason: { type: 'Text', required: false }, userId: { type: 'Ref<access.User>', required: false } }, note: 'ux-11: active:false needs a reason and no cash in hand, ends the open shift and keeps the record (deactivatedAt / By / reason); active:true reactivates; onShift goes through DriverShift start / end; userId links the rider\'s sign-in account' },
  'Driver.List': { errors: [], note: 'ux-11: status=INACTIVE lists deactivated riders; inactiveCount; a rider sees only himself' },
  'Driver.SettleCash': { errors: [], note: 'ux-11: a shortage also writes a SHORTAGE entry in the owed ledger' },
};
export function applyUx11Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX11_RULE_EXTENSIONS[op.id];
    if (!ext) continue;
    op.errors = [...new Set([...(op.errors ?? []), ...ext.errors])];
    if (ext.input) op.input = { ...(op.input ?? {}), ...ext.input };
    if (ext.approval) op.approval = ext.approval;
    op.note = `${op.note ? op.note + ' · ' : ''}${ext.note}`;
  }
}

// ux-12 (reservations complete): update / cancel a reservation, refund a deposit, the customer link, one seating path.
// Owner decisions pending — defaults used (PROTOTYPE_GAPS §15h): ReservationPolicy {seatMinutes 90, bufferMinutes 15,
// cancelDepositMode FORFEIT_IF_LATE, lateCancelHours 2, upcomingMinutes 120}; every deposit refund needs a manager's
// approval (DEPOSIT_REFUND, rule ALWAYS) and leaves this terminal's drawer in an open shift; a deposit is refunded in
// cash out of the drawer whatever method it was taken by.
const RESV = { type: 'Ref<tables.Reservation>', required: true };
const DEP = { type: 'Ref<payments.Deposit>', required: true };
export const UX12_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Reservation.Update', module: 'tables', kind: 'CMD', method: 'POST', path: '/reservations/{reservationId}/update', permission: 'reservation:manage', input: { reservationId: RESV, at: { type: 'Timestamp', required: false }, tableId: { type: 'Ref<tables.Table>', required: false }, partySize: { type: 'Integer', required: false }, notes: { type: 'Text', required: false }, customerId: { type: 'Ref<customers.Customer>', required: false }, expectedVersion: V }, output: 'ReservationView', errors: ['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_BOOKED', 'RESERVATION_TABLE_CONFLICT', 'RESERVATION_TIME_PAST', 'TABLE_NOT_FOUND', 'TABLE_INACTIVE', 'CUSTOMER_NOT_FOUND', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-12: a BOOKED reservation only; changes the time (not in the past), the table (null clears it), the party size (1..200), the notes (≤ 200) or links a legacy free-text reservation to a customer; a table change or a time change is refused when another reservation holds the same table closer than ReservationPolicy.seatMinutes + bufferMinutes (RESERVATION_TABLE_CONFLICT 409, details name it). CAS on the reservation version; each change is an append-only history entry with old → new and an audit line' },
  { id: 'Reservation.Cancel', module: 'tables', kind: 'CMD', method: 'POST', path: '/reservations/{reservationId}/cancel', permission: 'reservation:manage', input: { reservationId: RESV, reason: { type: 'Text', required: true }, expectedVersion: V }, output: 'ReservationView', errors: ['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_BOOKED', 'REASON_REQUIRED', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-12: BOOKED → CANCELLED with a required reason (3..200). The deposit is never refunded here: ReservationPolicy.cancelDepositMode decides — ALWAYS_FORFEIT forfeits the held remainder, FORFEIT_IF_LATE (default) forfeits it when cancelled within lateCancelHours (default 2) of the time, otherwise (and always under REFUND_WITH_APPROVAL) it stays held for Deposit.Refund. The outcome is recorded on the reservation (cancel.depositOutcome) and the deposit (forfeit {cause LATE_CANCEL | CANCEL_POLICY}); audited as sensitive' },
  { id: 'Deposit.Refund', module: 'payments', kind: 'CMD', method: 'POST', path: '/deposits/{depositId}/refunds', permission: 'deposit:refund', input: { depositId: DEP, amount: { type: 'Money', required: false }, reason: { type: 'Text', required: true }, expectedVersion: V, approvalGrantId: GRANT }, output: 'DepositRefundView', errors: ['DEPOSIT_NOT_FOUND', 'DEPOSIT_NOT_REFUNDABLE', 'DEPOSIT_RESERVATION_ACTIVE', 'DEPOSIT_REFUND_OVER_REMAINING', 'SESSION_NOT_OPEN', 'REASON_REQUIRED', 'CONCURRENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED', 'VALIDATION_FAILED'], approval: { mode: 'ALWAYS', action: 'DEPOSIT_REFUND' }, backend_state: 'PROPOSED', note: 'ux-12: refunds up to the remainder (amount − applied − refunded; default the whole remainder; more → DEPOSIT_REFUND_OVER_REMAINING 409) out of this terminal\'s drawer in an open shift (PAY_OUT, reason code DEPOSIT_REFUND); a reason (3..200) and a DEPOSIT_REFUND grant bound to {depositId, reservationId, amount, remaining}. Refused while the reservation is BOOKED (DEPOSIT_RESERVATION_ACTIVE — cancel it first) and after a forfeit (DEPOSIT_NOT_REFUNDABLE). The refund (number DR-nnnn, amount, remaining before, reason, session, terminal, grant, approver) is immutable; the deposit becomes REFUNDED when nothing remains; CAS on the deposit version' },
];
/** Rules added to existing operations by ux-12. */
export const UX12_RULE_EXTENSIONS: Record<string, { errors: string[]; note: string; input?: Record<string, { type: string; required: boolean }>; permission?: string }> = {
  'Reservation.Create': { errors: ['RESERVATION_TABLE_CONFLICT', 'RESERVATION_TIME_PAST', 'CUSTOMER_NOT_FOUND', 'TABLE_INACTIVE'], permission: 'reservation:manage', input: { customerId: { type: 'Ref<customers.Customer>', required: false }, customer: { type: 'Text', required: false }, phone: { type: 'Phone', required: false }, partySize: { type: 'Integer', required: true }, at: { type: 'Timestamp', required: true }, tableId: { type: 'Ref<tables.Table>', required: false }, notes: { type: 'Text', required: false }, depositId: { type: 'Ref<payments.Deposit>', required: false }, noShowFee: { type: 'Money', required: false } }, note: 'ux-12: customerId links the reservation to a customer record (name and phone come from it); the free-text name + phone stay accepted (legacy). Not in the past; the table-conflict rule; the deposit link is two-way; history + audit' },
  'Reservation.Find': { errors: [], input: { customerId: { type: 'Ref<customers.Customer>', required: false }, state: { type: 'Text', required: false }, from: { type: 'Timestamp', required: false }, to: { type: 'Timestamp', required: false } }, note: 'ux-12: filters customerId / state / from / to; each item has customerName, legacy, deposit balances, endsAt, cancelPreview (what cancelling now does to the deposit), history; the page carries the branch ReservationPolicy (rules) so the screen refuses an illegal move before sending it' },
  'Reservation.MarkNoShow': { errors: ['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_BOOKED', 'CONCURRENCY_CONFLICT'], permission: 'reservation:manage', input: { expectedVersion: { type: 'Version', required: false } }, note: 'ux-12: unchanged rule (the held deposit is forfeited); the outcome is recorded (deposit forfeit {cause NO_SHOW}, history, audit)' },
  'Reservation.Seat': { errors: ['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_BOOKED', 'RESERVATION_TABLE_CONFLICT', 'TABLE_OCCUPIED', 'TABLE_INACTIVE', 'CONCURRENCY_CONFLICT'], input: { reservationId: RESV, tableId: { type: 'Ref<tables.Table>', required: false }, guestCount: { type: 'Integer', required: false }, expectedVersion: V }, note: 'ux-12: the one seating path — opens the table visit (the booked table, or tableId) for guestCount (default the party size) and marks the reservation SEATED in the same transaction; returns {reservation, visit}. TableVisit.Open with reservationId runs the same path' },
  'TableVisit.Open': { errors: ['RESERVATION_NOT_FOUND', 'RESERVATION_NOT_BOOKED'], input: { reservationId: { type: 'Ref<tables.Reservation>', required: false }, reservationVersion: { type: 'Version', required: false } }, note: 'ux-12: with reservationId it seats the reservation exactly like Reservation.Seat (a reservation that is not booked is refused, not ignored)' },
  'Table.List': { errors: [], note: 'ux-12: reservation = the booked reservation of the table from ReservationPolicy.upcomingMinutes before its time until its seat ends (id, version, customer, party size, minutes to, deposit held)' },
  'Deposit.Create': { errors: ['CUSTOMER_NOT_FOUND', 'VALIDATION_FAILED'], input: { customerId: { type: 'Ref<customers.Customer>', required: false } }, note: 'ux-12: customerId; positive amount; audited' },
  'Deposit.Find': { errors: [], input: { customerId: { type: 'Ref<customers.Customer>', required: false }, state: { type: 'Text', required: false } }, note: 'ux-12: balances (applied / refunded / forfeited / remaining), applications, refunds, forfeit, refundBlock, the reservation and its visit' },
  'Deposit.Apply': { errors: ['DEPOSIT_OVER_REMAINING', 'OVERPAYMENT', 'CONCURRENCY_CONFLICT'], input: { amount: { type: 'Money', required: false }, expectedVersion: { type: 'Version', required: false } }, note: 'ux-12: applies up to the smaller of the deposit remainder and the check remainder (amount optional); each application is an append-only record with its DEPOSIT capture; APPLIED when nothing remains (the remainder of a partly applied deposit can be refunded)' },
};
export function applyUx12Extensions(ops: OperationDef[]) {
  for (const op of ops) {
    const ext = UX12_RULE_EXTENSIONS[op.id];
    if (!ext) continue;
    op.errors = [...new Set([...(op.errors ?? []), ...ext.errors])];
    if (ext.input) op.input = { ...(op.input ?? {}), ...ext.input };
    if (ext.permission && op.permission !== 'INTERNAL') op.permission = ext.permission;
    op.note = `${op.note ? op.note + ' · ' : ''}${ext.note}`;
  }
}

// ux-10b (shift handover + the remaining defaults as settings): the canonical Session.Handover stays PD-held (PD-V4-04);
// this slice proposes three handover commands and an approved blind recount. Owner decision (handover): ShiftHandoverPolicy
// {mode DUAL_COUNT (FULL_CLOSE | DIRECT_SWAP), countMismatchTolerance 0.0000, mismatchRecounts 1}. Every other default is a
// setting with its strictest workable value (PROTOTYPE_GAPS §15i): OpeningFloatPolicy {standardFloat 500.0000, change
// APPROVAL}, BlindRecountPolicy {mode NOT_ALLOWED}, RefundCancelPolicy {cancelBy REQUESTER_OR_DECIDER}, ReasonTextPolicy
// {minLength 3}, DriverPayPolicy.payoutDrawer OWN_DRAWER.
const SES = { type: 'Ref<sessions.Session>', required: true };
export const UX10B_PROPOSED_OPERATIONS: OperationDef[] = [
  { id: 'Session.HandoverStart', module: 'sessions', kind: 'CMD', method: 'POST', path: '/sessions/{sessionId}/handover/start', permission: 'session:close', input: { sessionId: SES, countedCash: { type: 'Money', required: true }, note: { type: 'Text', required: false }, expectedVersion: V }, output: 'HandoverStartView', errors: ['SESSION_NOT_FOUND', 'HANDOVER_NOT_SESSION_OWNER', 'HANDOVER_DISABLED', 'HANDOVER_ALREADY_PENDING', 'SESSION_NOT_OPEN', 'HANDOVER_TERMINAL_MISMATCH', 'SESSION_HAS_OPEN_ORDERS', 'BLIND_COUNT_LOCKED', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-10b: the outgoing cashier (the session owner, on its terminal) confirms a blind count; refused under ShiftHandoverPolicy FULL_CLOSE (HANDOVER_DISABLED 409) and, like the close, while counter / takeaway checks of the drawer are open (SESSION_HAS_OPEN_ORDERS). Records an immutable handover HO-nnnn (outgoing count, expected cash snapshot — never returned while pending — mode, tolerance and recounts from the policy) and the confirmed count; the session becomes HANDOVER_PENDING: nothing is sold, collected or moved on the drawer until it is accepted or cancelled (SESSION_NOT_OPEN / SESSION_HANDOVER_PENDING). Audited (sensitive)' },
  { id: 'Session.HandoverAccept', module: 'sessions', kind: 'CMD', method: 'POST', path: '/sessions/{sessionId}/handover/accept', permission: 'session:open', input: { sessionId: SES, countedCash: { type: 'Money', required: false }, reason: { type: 'Text', required: false }, expectedVersion: V, approvalGrantId: GRANT }, output: 'HandoverAcceptView', errors: ['SESSION_NOT_FOUND', 'HANDOVER_NOT_PENDING', 'HANDOVER_SAME_USER', 'HANDOVER_TERMINAL_MISMATCH', 'HANDOVER_COUNT_MISMATCH', 'BLIND_COUNT_LOCKED', 'REASON_REQUIRED', 'CONCURRENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED', 'VALIDATION_FAILED'], approval: { mode: 'WHEN_VARIANCE_OVER_SESSION_VARIANCE_RULE_OR_COUNTS_DISAGREE', action: 'SHIFT_HANDOVER_VARIANCE' }, backend_state: 'PROPOSED', note: 'ux-10b: the incoming cashier (≠ the outgoing one — HANDOVER_SAME_USER 409 — signed in on the same terminal) accepts the drawer. DUAL_COUNT: countedCash is the incoming blind count; |incoming − outgoing| > countMismatchTolerance is a mismatch → HANDOVER_COUNT_MISMATCH 409 {recountsLeft, needsApproval} with no amounts; a recount is a new countedCash, allowed only after a mismatch and within mismatchRecounts (else BLIND_COUNT_LOCKED); once no recount is left the same count with a reason (ReasonTextPolicy) goes to a manager. DIRECT_SWAP: no count, the outgoing count is taken. SHIFT_HANDOVER_VARIANCE grant bound to {handoverId, expectedCash, outgoingCount, incomingCount, absVariance, absDifference, varianceOverThreshold (SESSION_VARIANCE rule), countMismatch, needsApproval}. Every incoming count is recorded even when refused. On accept: the outgoing session closes on the accepted amount (variance = accepted − expected, the outgoing cashier\'s; Z frozen with handoverOut), a new session opens for the incoming cashier with openingFloat = the accepted amount (OPENING_FLOAT entry ref HO-nnnn, handoverFromId), the handover becomes ACCEPTED (both counts, expected, variance, difference, grant, approver, reason, who / when). Audited' },
  { id: 'Session.HandoverCancel', module: 'sessions', kind: 'CMD', method: 'POST', path: '/sessions/{sessionId}/handover/cancel', permission: 'AUTHENTICATED', input: { sessionId: SES, reason: { type: 'Text', required: true }, expectedVersion: V }, output: 'HandoverView', errors: ['SESSION_NOT_FOUND', 'HANDOVER_CANCEL_NOT_ALLOWED', 'HANDOVER_NOT_PENDING', 'REASON_REQUIRED', 'CONCURRENCY_CONFLICT', 'VALIDATION_FAILED'], approval: null, backend_state: 'PROPOSED', note: 'ux-10b: the outgoing cashier or a holder of approve:session_variance (else HANDOVER_CANCEL_NOT_ALLOWED 403, checked first) cancels a pending handover with a reason (ReasonTextPolicy); the record is kept CANCELLED (who, when, why) and the session is OPEN again; its confirmed count still locks the drawer until cash moves. Audited (sensitive)' },
  { id: 'Session.Recount', module: 'sessions', kind: 'CMD', method: 'POST', path: '/sessions/{sessionId}/recount', permission: 'session:close', input: { sessionId: SES, countedCash: { type: 'Money', required: true }, reason: { type: 'Text', required: true }, expectedVersion: V, approvalGrantId: GRANT }, output: 'DrawerCountView', errors: ['SESSION_NOT_FOUND', 'SESSION_NOT_OPEN', 'SESSION_HANDOVER_PENDING', 'BLIND_RECOUNT_NOT_ALLOWED', 'REASON_REQUIRED', 'CONCURRENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED', 'VALIDATION_FAILED'], approval: { mode: 'ALWAYS', action: 'SESSION_RECOUNT' }, backend_state: 'PROPOSED', note: 'ux-10b: only under BlindRecountPolicy WITH_APPROVAL (default NOT_ALLOWED → BLIND_RECOUNT_NOT_ALLOWED 409); replaces the confirmed blind count for the close with a different amount, a reason and a SESSION_RECOUNT grant bound to {sessionId, firstCount, recount}; both counts are kept (append-only counts, the close records how many recounts); CAS on the session version' },
];
/** Rules added to existing operations by ux-10b. */
export const UX10B_RULE_EXTENSIONS: Record<string, { errors: string[]; note: string; approval?: { mode: string; action: string }; input?: Record<string, { type: string; required: boolean }> }> = {
  'Session.Open': { errors: ['OPENING_FLOAT_LOCKED', 'SESSION_HANDOVER_PENDING', 'APPROVAL_REQUIRED', 'APPROVAL_GRANT_INVALID', 'SELF_APPROVAL_DENIED'], input: { approvalGrantId: GRANT }, approval: { mode: 'WHEN_FLOAT_DIFFERS_AND_POLICY_APPROVAL', action: 'OPENING_FLOAT_OVERRIDE' }, note: 'ux-10b OpeningFloatPolicy: an opening float other than standardFloat (default 500.0000) is refused under LOCKED (OPENING_FLOAT_LOCKED 409), needs an OPENING_FLOAT_OVERRIDE grant {terminalId, standardFloat, openingFloat, absDifference} under APPROVAL (default), is free under FREE; refused while the terminal\'s drawer waits for a handover (SESSION_HANDOVER_PENDING 409)' },
  'Session.Close': { errors: ['BLIND_COUNT_LOCKED', 'SESSION_HANDOVER_PENDING'], note: 'ux-10b: the count is confirmed when the approval is asked for and recorded (kept even though the close is refused); while no cash moved after it, a different countedCash is BLIND_COUNT_LOCKED 409 {recount NOT_ALLOWED | WITH_APPROVAL} until Session.Recount; the close keeps how many recounts were made' },
  'Session.Current': { errors: [], note: 'ux-10b: a drawer waiting for its handover is still the terminal\'s session (state HANDOVER_PENDING, handover: id, number, mode, outgoing cashier, started at, recounts left — never the counts or the expected cash)' },
  'Session.Get': { errors: [], note: 'ux-10b: confirmedCount (the count that still locks the drawer), handover / handoverFrom (the counts only once accepted or cancelled), cancelledHandovers' },
  'Session.Find': { errors: [], note: 'ux-10b: handover / handoverFrom links per session and the HANDOVER_PENDING state' },
  'Session.ZReport': { errors: [], note: 'ux-10b: handoverOut (to whom, both counts, expected, variance, difference, approver, reason) on the outgoing Z; handoverIn on the incoming session\'s reports' },
  'Refund.Cancel': { errors: [], note: 'ux-10b RefundCancelPolicy.cancelBy: REQUESTER_OR_DECIDER (default, the ux-10 rule) | REQUESTER_ONLY | DECIDER_ONLY (refund:reject holders); refusals stay REFUND_CANCEL_NOT_REQUESTER 403 {cancelBy}; the reason needs ReasonTextPolicy.minLength characters' },
  'Driver.Payout': { errors: ['DRIVER_PAYOUT_NOT_DRAWER_HOLDER'], note: 'ux-10b DriverPayPolicy.payoutDrawer: OWN_DRAWER (default) — only the cashier who holds this terminal\'s open shift pays out of it (DRIVER_PAYOUT_NOT_DRAWER_HOLDER 403 for anyone else); TERMINAL_DRAWER — any delivery:payout holder pays out of this terminal\'s open drawer' },
  'Reservation.Cancel': { errors: [], note: 'ux-10b: reason length from ReasonTextPolicy.minLength (default 3)' },
  'Deposit.Refund': { errors: [], note: 'ux-10b: reason length from ReasonTextPolicy.minLength (default 3)' },
  'Driver.SettleOwed': { errors: [], note: 'ux-10b: reason length (deduct / waive) from ReasonTextPolicy.minLength (default 3)' },
  'Driver.Upsert': { errors: [], note: 'ux-10b: deactivation reason length from ReasonTextPolicy.minLength (default 3)' },
};
export function applyUx10bExtensions(ops: OperationDef[]) {
  for (const op of ops) {
    if (op.id === 'Session.Handover') { op.note = `${op.note ? op.note + ' · ' : ''}ux-10b: superseded in the prototype by Session.HandoverStart / HandoverAccept / HandoverCancel (PROPOSED, ShiftHandoverPolicy)`; continue; }
    const ext = UX10B_RULE_EXTENSIONS[op.id];
    if (!ext) continue;
    op.errors = [...new Set([...(op.errors ?? []), ...ext.errors])];
    if (ext.input) op.input = { ...(op.input ?? {}), ...ext.input };
    if (ext.approval) op.approval = ext.approval;
    op.note = `${op.note ? op.note + ' · ' : ''}${ext.note}`;
  }
}
