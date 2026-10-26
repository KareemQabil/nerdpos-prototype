# Negative controls N1..N12 (NP-W-02)

**Generated** by `reference-tools/author_acceptance_scripts.py` from canonical V4, DOMAIN manifest 2.9.0, docs/13 (codes, HTTP, retry class) and demo data 1.1.0. Do not edit by hand. Evidence state of this document: SPEC_ONLY. It becomes evidence only when a run fills the capture items (evidence folder of the run) on the L1 environment (NP-R-13) with demo data 1.1.0.

A control passes only when the expected outcome is observed **and** the "nothing written" part is proven from the database or the read model. A retry class tells the UI what to offer next (docs/13).

| # | Case | Operation | Expected code · HTTP · retry class |
|---|---|---|---|
| N1 | Duplicate visit open on the same table | `TableVisit.Open` | `TABLE_OCCUPIED` 409 `FINAL_NEW_INTENT_ONLY` |
| N2 | Fire replay with the same X-Command-Id produces one round | `Order.Fire` | behavioural (no code) |
| N3 | Concurrent Fire on the same check | `Order.Fire` | `CONCURRENCY_CONFLICT` 409 `REFRESH_THEN_DECIDE` |
| N4 | Void without approval | `Order.VoidLine` | `APPROVAL_REQUIRED` 403 `APPROVAL_FLOW_SAME_ID` |
| N5 | Requester approves their own void | `Approval.Grant` | `SELF_APPROVAL_DENIED` 403 `NOT_PERMITTED` |
| N6 | Card capture without reference | `Payment.Capture` | `TENDER_REFERENCE_REQUIRED` 400 `FIX_AND_RESUBMIT` |
| N7 | Overpayment and concurrent captures | `Payment.Capture` | `OVERPAYMENT` 409 `FINAL_NEW_INTENT_ONLY` |
| N8 | Access revoked mid-operation | `Order.Fire` | `UNAUTHENTICATED` 401 `REAUTHENTICATE_SAME_ACTOR`<br>`PERMISSION_DENIED` 403 `NOT_PERMITTED` |
| N9 | Cross-branch table and visit access | `TableVisit.Transfer` | `TABLE_NOT_FOUND` 404 `FINAL_NEW_INTENT_ONLY`<br>`TABLE_VISIT_NOT_FOUND` 404 `FIX_AND_RESUBMIT`<br>`PERMISSION_DENIED` 403 `NOT_PERMITTED` |
| N10 | Duplicate and out-of-order kitchen events | `kitchen.fire-round` | behavioural (no code) |
| N11 | Worker restart mid-batch | `kitchen.fire-round` | behavioural (no code) |
| N12 | Unknown response, then retry the same command | `Payment.Capture` | behavioural (no code) |

## N1: Duplicate visit open on the same table

- **Operation:** `TableVisit.Open` (tables/operation/TableVisit.Open@2, POST /tables/{tableId}/visits) · actor `demo-waiter-2` on `DEMO-FLOOR-1` · `table:assign` ✓
- **Precondition:** J-R1 step 4 done: table 7 has an OPEN visit.
- **Steps:**
  1. demo-waiter-2 taps table 7 → "Open table" on a second tablet session.
  2. Replay check: resend demo-waiter-1's original TableVisit.Open with the same X-Command-Id.
- **Expected:** Waiter 2: rejected, still one OPEN visit on table 7; the floor map refreshes and shows it occupied. Waiter 1 replay: the stored 201 response is returned with header `Idempotent-Replayed: true` (tier A, packages/platform executor), not TABLE_OCCUPIED.
- **Codes:** `TABLE_OCCUPIED` 409 `FINAL_NEW_INTENT_ONLY`
- **Capture:** both HTTP responses; count of OPEN visits for table 7 = 1; one audit row for the open

## N2: Fire replay with the same X-Command-Id produces one round

- **Operation:** `Order.Fire` (orders/operation/Order.Fire@4, POST /orders/{orderId}/fire) · actor `demo-waiter-1` on `DEMO-FLOOR-1` · `order:fire` ✓
- **Precondition:** A floor check with unfired lines.
- **Steps:**
  1. Fire once and record the X-Command-Id and response.
  2. Resend the identical request (same X-Command-Id, same body).
- **Expected:** The second response equals the first (same status, body and fireRound) with header `Idempotent-Replayed: true` (tier A). One OrderFired outbox event; one set of kitchen tickets.
- **Capture:** both responses; outbox rows for the order (1 OrderFired for the round); kitchen ticket count per station

## N3: Concurrent Fire on the same check

- **Operation:** `Order.Fire` (orders/operation/Order.Fire@4, POST /orders/{orderId}/fire) · actor `demo-waiter-1` on `DEMO-FLOOR-1` · `order:fire` ✓
- **Precondition:** A floor check with unfired lines open on two tablets (demo-waiter-1 and demo-waiter-2), both at the same version.
- **Steps:**
  1. Both press "Send to kitchen" at the same moment (or fire two API calls in parallel with the same expectedVersion and different command ids).
- **Expected:** Exactly one 200. The other is rejected; that tablet refetches and shows the lines as sent. One fire round, one set of tickets.
- **Codes:** `CONCURRENCY_CONFLICT` 409 `REFRESH_THEN_DECIDE`
- **Capture:** both responses; fireRound values on the lines; ticket count

## N4: Void without approval

- **Operation:** `Order.VoidLine` (orders/operation/Order.VoidLine@5, POST /orders/{orderId}/lines/{lineId}/void) · actor `demo-waiter-1` on `DEMO-FLOOR-1` · `order:voidline` ✓
- **Precondition:** A fired line on a DRAFT floor check.
- **Steps:**
  1. Void the line with reason WRONG_ITEM and no approvalGrantId.
  2. Cancel the approval dialog.
- **Expected:** Rejected; the line stays ACTIVE; nothing written; the UI opens the approval dialog and, if cancelled, keeps the line unchanged.
- **Codes:** `APPROVAL_REQUIRED` 403 `APPROVAL_FLOW_SAME_ID`
- **Capture:** response; line status; no void audit row

## N5: Requester approves their own void

- **Operation:** `Approval.Grant` (canonical, approvals/change_request/Approval.Grant@3, POST /approvals) · actor `demo-manager-1` on `DEMO-ADMIN-1` · `approval:grant` ✓
- **Precondition:** J-R2 step 2 at the approval dialog (demo-manager-1 requested ORDER_VOID).
- **Steps:**
  1. demo-manager-1 picks their own name and enters their own PIN.
- **Expected:** Rejected (SelfApprovalPolicy DENY); no grant issued; the check is not voided. Another manager must approve.
- **Codes:** `SELF_APPROVAL_DENIED` 403 `NOT_PERMITTED`
- **Capture:** response; approval grant rows for the context = 0; order status unchanged

## N6: Card capture without reference

- **Operation:** `Payment.Capture` (canonical, payments/change_request/Payment.Capture@1, POST /orders/{orderId}/payments) · actor `demo-cashier-b` on `DEMO-CASH-1` · `payment:capture` ✓
- **Precondition:** A CONFIRMED check with a remaining balance; an open shift.
- **Steps:**
  1. Choose Card and submit without a reference.
  2. Type DEMO-REF-0002 and submit again.
- **Expected:** First: rejected, nothing captured; the UI asks for the reference. Second: 201 (the same command id may be reused with the corrected body).
- **Codes:** `TENDER_REFERENCE_REQUIRED` 400 `FIX_AND_RESUBMIT`
- **Capture:** both responses; capture rows (1 after the second call)

## N7: Overpayment and concurrent captures

- **Operation:** `Payment.Capture` (canonical, payments/change_request/Payment.Capture@1, POST /orders/{orderId}/payments) · actor `demo-cashier-b` on `DEMO-CASH-1` · `payment:capture` ✓
- **Precondition:** A CONFIRMED check with a remaining balance R.
- **Steps:**
  1. Submit a card amount greater than R (as an API call; the UI fills the amount from the settlement).
  2. From two sessions submit the full remaining R at the same moment.
- **Expected:** The over-amount is rejected. Of the two parallel captures one succeeds and the other is rejected; the paid total never exceeds the payable.
- **Codes:** `OVERPAYMENT` 409 `FINAL_NEW_INTENT_ONLY`
- **Capture:** responses; sum of captures ≤ payable (from Payment.GetSettlement)

## N8: Access revoked mid-operation

- **Operation:** `Order.Fire` (orders/operation/Order.Fire@4, POST /orders/{orderId}/fire) · actor `demo-waiter-2` on `DEMO-FLOOR-1` · `order:fire` ✓
- **Precondition:** demo-waiter-2 is logged in with a floor check that has unfired lines.
- **Steps:**
  1. The environment administrator deactivates demo-waiter-2 (User.ManageAccess active=false). Repeat with a role change that removes order:fire.
  2. demo-waiter-2 taps "Send to kitchen".
- **Expected:** Deactivated: UNAUTHENTICATED and the app returns to login. Role removed: PERMISSION_DENIED. In both cases nothing is fired.
- **Codes:** `UNAUTHENTICATED` 401 `REAUTHENTICATE_SAME_ACTOR` · `PERMISSION_DENIED` 403 `NOT_PERMITTED`
- **Administrative call:** `User.ManageAccess` (canonical, POST /users/{userId}/access, `user:manageaccess`) by the environment administrator; no demo role holds it.
- **Capture:** responses; lines unfired; no OrderFired event

## N9: Cross-branch table and visit access

- **Operation:** `TableVisit.Transfer` (tables/operation/TableVisit.Transfer@1, POST /table-visits/{visitId}/transfer) · actor `demo-waiter-second` on `DEMO-SECOND-FLOOR-1` · `table:transfer` ✓
- **Precondition:** Main-branch table 7 has an OPEN visit V. Demo data 1.1.0 provisions branch DEMO-SECOND with its own table "7".
- **Steps:**
  1. demo-waiter-second (second branch) calls TableVisit.Transfer on visit V to the second branch's table 7.
  2. demo-waiter-1 (main branch) calls TableVisit.Transfer on visit V to the second branch's table 7 id.
- **Expected:** Both refused with a not-found or permission code; no row of the other branch is read, revealed or written. The runtime may return the module-prefixed TABLES_TABLE_NOT_FOUND (docs/13 name alignment).
- **Codes:** `TABLE_NOT_FOUND` 404 `FINAL_NEW_INTENT_ONLY` · `TABLE_VISIT_NOT_FOUND` 404 `FIX_AND_RESUBMIT` · `PERMISSION_DENIED` 403 `NOT_PERMITTED`
- **Capture:** responses; visit V unchanged (table, version); audit shows no transfer

## N10: Duplicate and out-of-order kitchen events

- **Operation:** `kitchen.fire-round` (canonical, kitchen/change_request/kitchen.fire-round@4, internal (no HTTP)) · actor `-` on `worker (BUILD harness)` · internal
- **Precondition:** Two fire rounds committed for one check. Harness access to the outbox/inbox (BUILD, NP-R-11).
- **Steps:**
  1. Redeliver round 1's OrderFired with the same delivery receipt.
  2. Deliver round 2 before round 1 on a fresh check.
- **Expected:** No duplicate tickets. The early round 2 is retried and succeeds once round 1 is processed (or is processed independently if the design allows); never lost, never doubled.
- **Capture:** kitchen ticket count per (order, round, station); inbox receipt rows; retry log lines

## N11: Worker restart mid-batch

- **Operation:** `kitchen.fire-round` (canonical, kitchen/change_request/kitchen.fire-round@4, internal (no HTTP)) · actor `-` on `worker (BUILD harness)` · internal
- **Precondition:** Several OrderFired events queued.
- **Steps:**
  1. Stop the worker after it has processed part of the batch.
  2. Start it again.
- **Expected:** Every round ends with exactly one ticket set; processed receipts are not re-applied.
- **Capture:** ticket counts before and after restart; inbox receipts; worker log

## N12: Unknown response, then retry the same command

- **Operation:** `Payment.Capture` (canonical, payments/change_request/Payment.Capture@1, POST /orders/{orderId}/payments) · actor `demo-cashier-b` on `DEMO-CASH-1` · `payment:capture` ✓
- **Precondition:** A CONFIRMED check with a remaining balance; network control on the cashier device (devtools offline after send, or a proxy that drops the response).
- **Steps:**
  1. Submit a cash capture and drop the response after the request was sent.
  2. The app shows "result unknown" with Retry. Tap Retry (same X-Command-Id, same body).
- **Expected:** The retry returns the stored result (same status and captureIds) with header `Idempotent-Replayed: true` (tier A). Exactly one capture. While unknown, the app offers no "new payment" for that check.
- **Capture:** both responses; capture rows = 1; settlement after retry

