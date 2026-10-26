# Rules the mock must enforce

These rules come from the specification (`reference/CORE_SELLABLE_RESTAURANT.md`, `reference/12_DOMAIN_02_DECISIONS.md`). Error codes come from `contracts/errors.json`. When a rule refuses, return the HTTP status of that error and show its Arabic message.

## 1. Money and history

- Money is computed with a decimal library at scale 4. It is shown with 2 decimals, in EGP. Never use floating point.
- **Nothing financial is edited or deleted.** A correction is a new record: void, refund, return, tender correction. Each keeps a link to the original. Show the history on every check.
- A captured line keeps its price, tax and modifiers. Menu, price and tax edits apply to new quotes only.
- Every displayed price comes from the server quote (`Pricing.QuoteItem`). The client never computes a price itself.

## 2. Commands and retries

- Every command carries a command id, the `X-Command-Id` header.
- The same id with the same body returns the stored result, with the header `Idempotent-Replayed: true`, and has no new effect.
- The same id with another body is an idempotency conflict.
- Edits carry `expectedVersion`. A stale version gives `CONCURRENCY_CONFLICT`. Show "someone else changed this check, refresh".

## 3. Orders and kitchen

- A **dine-in check on the floor** can exist without a drawer (FloorIntakePolicy FLOOR_WITHOUT_DRAWER for DINE_IN). It is anchored to an open table visit.
- **Fire:**
  - fires the unfired active lines as the next round;
  - nothing to fire gives `NOTHING_TO_FIRE`;
  - under FireTimingPolicy AT_CONFIRM, Fire gives `CAPABILITY_NOT_AVAILABLE`, unless the order already has a fired round. The fire mode binds to the order at its first fire.
- **Edit boundary:**
  - fired lines cannot be updated or removed (`LINE_ALREADY_FIRED`, 409);
  - they leave only through void (with approval) or move to another check of the same visit;
  - unfired lines stay editable even after earlier rounds.
- **Confirm:**
  - prices every active line;
  - fires the remaining unfired lines as a new round;
  - if everything was already fired, it creates no round and says so.
- **Cancel:** only for a check with nothing fired, with a reason code.
- **Kitchen:**
  - a round is "sent" when its ticket exists;
  - if delivery failed, the check shows "pending/failed" and offers re-send;
  - a re-send never duplicates a ticket.

## 4. Tables

- A table visit **cannot close while any check is open** (`TABLE_HAS_OPEN_CHECKS`).
- Under VisitAutoClosePolicy ON_LAST_CHECK_COMPLETED, the visit closes automatically when its last check completes, is cancelled or is voided.

## 5. Payment and drawer

- A **floor check** is confirmed and collected at the cashier terminal with an open drawer (CollectionScopePolicy BRANCH_COLLECTING_DRAWER). The money goes into that cashier's shift.
- A confirmed but unpaid floor check never blocks a shift close. It is listed as outstanding.
- **Card** is recorded with the terminal reference (mandatory). There is no provider call.
- **Tenders:** split tender is allowed by default. Paid ≥ payable completes the order. Cash gives change. No cash rounding.
- **Void:** a check with any original capture cannot be voided (`ORDER_HAS_PAYMENTS`). Use a refund.

## 6. Approvals

**Actions:**
- LINE_VOID, ORDER_VOID, ORDER_DISCOUNT, ORDER_COMP;
- REFUND_APPROVE, SESSION_VARIANCE, CASH_MOVE, DRAWER_NO_SALE, TENDER_CORRECTION;
- PRICE_CHANGE, PRODUCT_TAX_CHANGE, SENSITIVE_POLICY_CHANGE, USER_ACCESS_CHANGE, CREDENTIAL_RESET, RECEIPT_REPRINT.

Each action has a rule, editable in the Policy Panel: ALWAYS, NEVER, ABOVE_THRESHOLD on a context field, or WHEN_TRUE. Defaults are in `rules/approval_actions.json` and `rules/EG.profile.json`.

PRICE_CHANGE (fields `changePercent` as magnitude, `decrease`, `firstPrice`), PRODUCT_TAX_CHANGE and RECEIPT_REPRINT are DOMAIN additions not yet in `approval_actions.json`. Their default is NEVER.

**Flow:**
1. The command returns `APPROVAL_REQUIRED` with `{action, targetType, targetId, context}`.
2. The manager popup shows exactly that context.
3. The manager enters a PIN, which issues a grant.
4. The original command retries with `approvalGrantId`.

**A grant:**
- is single-use;
- expires (ApprovalTtlPolicy, default 120 s);
- is bound to the exact context, the requester, the branch and the terminal.

**Self-approval is refused** (`SELF_APPROVAL_DENIED`).

## 7. Prices and taxes

- **Price windows** per product × branch × channel never overlap.
- No backdating.
- A window that has started is never re-priced; a new window starts instead.
- A started window's correction is refused.
- **Tax policies:** a rate change needs approval (SENSITIVE_POLICY_CHANGE). A policy in use cannot be archived (`TAX_POLICY_IN_USE`). An archived policy cannot be assigned (`TAX_POLICY_ARCHIVED`).
- **Service charge** (EG default 12 % on dine-in only) is its own line between subtotal and VAT. It is never part of net sales in reports.
- **Discount** before tax by default (PricingOrderPolicy).

## 8. Business date

The business date is computed by the server per branch (Africa/Cairo, cutoff 04:00). It is never taken from the device clock. A sale at 02:00 belongs to the previous business day.

## 9. Side effects never block a sale

Printing, the kitchen screen and the e-receipt run after the sale is saved. A failure shows a state and a retry, and the sale stays done.

**Receipt reprint:** prints "نسخة" (copy) and never issues a new receipt.

**E-receipt:**
- **Missing data** (no item code, no profile, no active fiscal device): the document is "pending data" with the reason. The sale is still completed.
- **Alerts:** at 12 h and at 20 h if a document is not yet accepted.
