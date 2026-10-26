# 30. Printing and devices (W13, NP-D-L2-10)

**Status:** WORKER proposal (author `opus`), doc only, for DOMAIN review. Evidence state: SPEC_ONLY.
- Branch `agent/opus/w13-printing-devices`, base `agent/claude/domain-line` @ `f4b90711`.
- The `printing` module is **not in my scope** (03_TASKS W13: CONDITIONAL, so the doc only). No fragment is written; every proposal below is DOMAIN's to accept or reject.
- Every spec identifier in backticks is checked by `reference-tools/check_doc_refs.py`. Names this doc only proposes are declared at the end.

**The rule:** a print failure never blocks or undoes a sale. The sale commits first. Every print is a job processed after the commit, retried, and alerted on when it dies. This follows `CLAUDE.md`: never make committed business truth depend on hardware success.

## 1. Canonical surface (pin `6f5bfe2`, domain line `f4b90711`)

| Operation | Kind | Permission | What it does |
|---|---|---|---|
| `Receipt.Get` | query | `order:read` | Builds the ReceiptView from **persisted snapshots only**: the order, lines and snapshot, the settlement, and the optional fiscal document. It never recomputes a price or tax. |
| `printing.kitchen-routed` | consumer of `kitchen.KitchenRouted` | internal | Inserts one `printing.PrintJob` with type `PrintDocumentType:KITCHEN_TICKET` and copy kind `PrintCopyKind:ORIGINAL` for the station printer. Consumer dedupe applies. |
| `printing.Dispatch` | job | internal | Calls the printer adapter and writes one `printing.PrintAttempt` per try. It moves the job to SUCCEEDED or FAILED, and to DEAD when attempts run out. Adapter dedupe key = print job id + attempt. |
| `PrintJob.Retry` | command | `print:retry` | FAILED or DEAD → PENDING: **the same job, the same copy**, never a new copy. Any other state is `PRINT_JOB_NOT_RETRYABLE`. |
| `PrintJob.Find` / `PrintJob.Get` | query | `print:read` | Filter by state, terminal and document type. This is the "failed prints" view (docs/28 micro-action) and the monitoring source (docs/29). |
| `Print.Reprint` | command | `print:reprint` | V4 patch: inserts a **new** job with copy kind `PrintCopyKind:REPRINT` for a document type and document id, with an optional reason. Audit is SENSITIVE. Approval is NONE today; see section 6. |
| `cash.DrawerKick` | job | internal (cash) | Opens the drawer as an outbox side effect of `Drawer.OpenNoSale` or a cash `Payment.Capture`. It is an adapter call only: it never creates money and never changes a drawer event. |

**State machine `printing.PrintJob.state`** (canonical):
- PENDING → SUCCEEDED or FAILED (Dispatch);
- FAILED → PENDING (Retry);
- FAILED → DEAD (Dispatch, attempts exhausted);
- DEAD → PENDING (operator Retry).

Terminal states are SUCCEEDED and DEAD.

### 1.1 The unified plan's state names map onto the canonical ones

The unified plan (section 2.3) writes QUEUED → SENT → PRINTED / FAILED. **Canonical wins**, and the UI shows canonical states.

| Plan | Canonical | Meaning |
|---|---|---|
| QUEUED | `PrintJobState:PENDING` | waiting for a Dispatch lease |
| SENT | (no stored state) | an attempt inside the Dispatch lease, recorded as a `printing.PrintAttempt` |
| PRINTED | `PrintJobState:SUCCEEDED` | the adapter **delivered** the document to the device |
| FAILED | `PrintJobState:FAILED` (will retry) or `PrintJobState:DEAD` (gave up) | |

**Honesty note:** common network thermal printers accept bytes but confirm neither that paper came out nor that it was legible. A status query can report paper-out or cover-open. SUCCEEDED must therefore be shown as "sent to printer", never as "printed". The canonical model, with no PRINTED state, is right.

## 2. "A print failure never blocks a sale": the mechanics

1. **The command commits without touching a printer.** `Order.Complete`, `Payment.Capture` and `Order.Fire` write only business truth and outbox envelopes. Print jobs are created by consumers or by an explicit print command, never inside the sale transaction.
2. **Dispatch retries with backoff.** Proposed configuration: `printing.maxAttempts` = 5, backoff 5 s, 15 s, 45 s, 2 min, 5 min. Each attempt is a `printing.PrintAttempt` row with its error code.
3. **DEAD is loud.** The till that owns the job shows a banner listing the dead jobs and a Retry button (`PrintJob.Retry`). Monitoring raises the signal from docs/29 section 3 (`PrintJobState:DEAD`).
4. **Retry never duplicates.** It reuses the same job and the same copy kind. A second paper copy is only ever a Reprint (section 6), which is marked as a copy.
5. **Degraded mode is normal.** With the receipt printer down, the cashier keeps selling. Receipts can be reprinted later from order search (`Order.Find`, then `Receipt.Get`, then `Print.Reprint`). With a kitchen printer down, see 4.3.

## 3. Where each printed document comes from

| Document type | ORIGINAL job created by | Status |
|---|---|---|
| `PrintDocumentType:KITCHEN_TICKET` | `printing.kitchen-routed` | canonical |
| `PrintDocumentType:RECEIPT` | **nothing in canonical** | gap PRN-GAP-01 |
| `PrintDocumentType:FISCAL_DOCUMENT` | nothing in canonical | gap PRN-GAP-01 |
| `PrintDocumentType:X_REPORT` / `PrintDocumentType:Z_REPORT` | nothing in canonical (`Session.XReport` and `Session.ZReport` are queries) | gap PRN-GAP-01 |

**PRN-GAP-01 proposal.**
- A consumer `printing.order-completed` of the order-completed event inserts the RECEIPT ORIGINAL job for the completing terminal, governed by `ReceiptPrintPolicy`:
  - AUTO prints every receipt;
  - ASK is a till prompt that then calls a print command;
  - OFF prints nothing.
- MARKET_CONVENTION, confidence high: AUTO for TAKEAWAY. DINE_IN is AUTO too, because the guest normally gets the final receipt after paying.
- X and Z reports print on demand. Proposal: generalise `Print.Reprint` into one print command that records ORIGINAL for the first job of a document and REPRINT after it. The copy kind is derived by the server, never sent by the client.

**PRN-GAP-02: the pre-bill.** In Egyptian dine-in service the waiter brings a printed check to the table before payment. MARKET_CONVENTION, confidence high.
- `PrintDocumentType` has no such value. Proposal: add `PRE_BILL`, rendered from the open order.
- It is visibly titled "not a tax receipt / ليست فاتورة ضريبية" and carries no fiscal QR.
- Printing it changes nothing in the order. A pre-bill reprint needs no approval.

**Receipts and the e-receipt (docs/19).**
- The printed receipt carries the QR built from the fiscal document's uuid (docs/19 R6, I9).
- The uuid is computed locally from the stored receipt payload (docs/19 R4). It is therefore available as soon as the compliance consumer has built the document, before submission.
- Proposal: the RECEIPT job waits for that local build for up to 10 s. After that it prints without the QR and is flagged in `PrintJob.Find`. A reprint after the build carries the QR.
- Whether a receipt without QR is acceptable is OD-PRN-02, for tax counsel under `PG-05`.
- Printing failure never blocks the submission, and submission never waits for paper.

## 4. Kitchen chit vs KDS

### 4.1 What CORE has
- `kitchen.fire-round` writes one ticket per station per round (the KDS truth, `Kitchen.AdvanceTicket`). `kitchen.KitchenRouted` also drives `printing.kitchen-routed`, which creates the chit.
- `Kitchen.OrderFulfillment` shows each round as SENT, PENDING or FAILED (E-38). Its status comes from the delivery of the kitchen consumer. `Kitchen.Resend` (DOMAIN change request, NP-D-L2-07) re-sends a FAILED round with no duplicate obligation.

### 4.2 Station output is owner data (PRN-GAP-03)
`kitchen_routing.KitchenStation` has no output setting. Proposal: an `output` field on the station, with values KDS, PRINTER or BOTH. It is owner data, set at installation, and not a tenant policy.
- MARKET_CONVENTION, confidence medium-high: most Egyptian restaurant kitchens work from printed chits. Screens are rarer because of cost, heat and grease. New stations default to PRINTER when a printer is attached, else KDS.
- With PRINTER only, the KDS ticket still exists as the truth of what was fired. It is simply not displayed, and nothing in kitchen state depends on the paper.

### 4.3 A dead chit must reach the waiter (PRN-GAP-04)
For a PRINTER-only station, the round shows SENT once the kitchen consumer succeeded, even if the chit job is DEAD. The kitchen never got the order, but the waiter sees SENT.
- Proposal: `Kitchen.OrderFulfillment` reads the chit job state through a declared printing read contract, never by widening access (`CLAUDE.md`).
- A PRINTER station whose chit is `PrintJobState:DEAD` shows the round as FAILED, so the waiter can resend or walk to the kitchen.
- A resent or reprinted chit is printed with a large "REPRINT / مكرر" header so the kitchen does not cook twice. MARKET_CONVENTION, confidence high.

## 5. Printers are devices without a record (PRN-GAP-05)

`printing.PrintJob` has a free-text `target`. `organization.Terminal` and `kitchen_routing.KitchenStation` have no printer fields, so there is no place to configure a printer.

**Proposal:** a `printing.Printer` record, owned by printing, written by a declared printer command. Its fields:
- branch and name;
- connection: network, a USB printer behind a local bridge, or an OS print queue;
- address;
- paper width 58 or 80 mm;
- rendering mode: text or raster.

Two bindings attach printers to their users:
- terminal → receipt printer;
- station → kitchen printer.

Dispatch resolves the target from the binding at attempt time and stores the resolved target on the attempt.

**Arabic rendering.** IMPLEMENTATION_DEFAULT: render each document as a raster image at the printer's width. Many low-cost thermal printers have weak or no Arabic code pages, and right-to-left shaping in text mode is unreliable. Raster rendering trades speed for correctness. Text mode stays a per-printer option.

The docs/28 row FE-27 (terminal printer settings) points at this gap. `Terminal.Update` has no device fields today.

## 6. Reprint and its approval rule (PRN-GAP-06)

**Today:**
- `Print.Reprint` inserts a REPRINT job rendered from the same persisted snapshot. The paper must carry "COPY / نسخة".
- The audit is SENSITIVE and the reason is optional.
- The approval mode is NONE, and **no approval action exists for reprint** in `ApprovalAction`.

**Proposal:** a new approval action `RECEIPT_REPRINT`, BY_POLICY through `ApprovalRequirementPolicy`.

| Field | Proposal |
|---|---|
| applies to | RECEIPT and FISCAL_DOCUMENT; never KITCHEN_TICKET, X or Z reports, or the pre-bill |
| context | the document type, the document id, and the count of earlier REPRINT jobs for that document, derived by the server from `printing.PrintJob` |
| default rule | ABOVE_THRESHOLD on the prior-reprint count, threshold 0. The first copy is free and every later one needs a manager. |
| reason | required through `ReasonCodePolicy`, kind REPRINT, as managed codes: customer asked, paper jam, expense claim |
| self-approval | `SelfApprovalPolicy` DENY, as everywhere |
| label | MARKET_CONVENTION, confidence medium. Repeated receipt copies are a known way to support false refunds or inflated expense claims, so limiting copies is a common control. |

The grant follows the E-36 pattern: the context is derived by the owner, hashes use JCS sha256, the grant is consumed last (lock rank 99), and it is checked with `APPROVAL_GRANT_INVALID` and its siblings.

## 7. One inconsistency in canonical (PRN-GAP-07)

The V3 base of `Print.Reprint` declares a custom domain function `printing.invokeBoundAdapter`. It runs in the **caller's transaction** and writes a `printing.PrintAttempt`, so it calls the printer inside the command. The V4 patch adds the REPRINT job, and `printing.Dispatch` already owns adapter calls and attempts.

**Proposal:**
- `Print.Reprint` inserts only the job (plus audit and outbox). Only Dispatch calls the adapter and writes attempts: one writer per record, in the spirit of BP023.
- A slow or dead printer can then never hold a database transaction open or make the reprint command fail.

## 8. Required tests (when printing enters a slice)

| Test | Kind |
|---|---|
| A dead printer adapter: the order completes, the payment commits, the job ends DEAD, and the order is unchanged | integration, real PostgreSQL |
| Retry of a DEAD job moves the same job to PENDING; the job count is unchanged and no REPRINT row appears | integration |
| Reprint creates a REPRINT job, writes one SENSITIVE audit entry, and the paper renderer prints "COPY / نسخة" | integration + render snapshot |
| The second receipt reprint without a grant is refused; with a valid grant it succeeds and consumes the grant last | security (if PRN-GAP-06 is accepted) |
| `printing.kitchen-routed` delivered twice creates one job | consumer dedupe |
| No adapter call inside a command transaction | static check on command handlers |
| A PRINTER station with a DEAD chit shows its round as FAILED | integration (if PRN-GAP-04 is accepted) |
| An Arabic product name renders right to left and is legible at 58 and 80 mm | render snapshot |
| `cash.DrawerKick` fails: the capture stays committed and no money row is touched | integration |

## 9. Open decisions and questions

| Id | For | Question | Default until answered | Confidence |
|---|---|---|---|---|
| OD-PRN-01 | owner | Bring printing into scope (W13 is CONDITIONAL)? | doc only | n/a |
| OD-PRN-02 | tax counsel (`PG-05`) | Is a receipt printed without the e-receipt QR acceptable when the fiscal build is late? Must a copy of a fiscal receipt carry a specific marking? | print after 10 s without QR, flagged; copies say "COPY / نسخة" | low |
| OD-PRN-03 | DOMAIN | Accept PRN-GAP-01..07 (receipt consumer and print command, `PRE_BILL`, station output, chit state in fulfilment, the printer record, `RECEIPT_REPRINT`, Reprint without an in-transaction adapter call)? | none built | n/a |
| OD-PRN-04 | owner | `ReceiptPrintPolicy` default per channel | AUTO for every channel | high |

<!-- not-spec: printing.order-completed printing.Printer printing.maxAttempts ReceiptPrintPolicy PRE_BILL RECEIPT_REPRINT REPRINT -->
