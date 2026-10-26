# PROTOTYPE_GAPS — assumptions, proposals and contract gaps

> كل حاجة البروتوتايب اضطر يفترضها أو يقترحها عشان الشاشات والرحلات تكمل، وكل تعارض لقيناه بين العقود والوثائق.
> كل بند عليه: **أين** (العقد/الوثيقة)، **إيه اللي عملناه**، و**سؤال للباك إند/المنتج**.

Legend: **[CONTRACT]** missing or inconsistent in `operations.json` / `errors.json` / `openapi` ·
**[PROPOSED]** invented by the prototype (badge مقترح) · **[ASSUMED]** a reading of an ambiguous rule ·
**[DEMO]** shortcut that exists only for the demo.

---

## 1. Auth & access

| # | Gap | What the prototype does | Question |
|---|---|---|---|
| A1 | **[CONTRACT]** `Auth.Login`, `Auth.Logout`, `Auth.VerifyPin` exist only in the OpenAPI file, not in `operations.json`. | Added to the generated operations list from OpenAPI (`scripts/build-contracts.mjs`). | Add them to `operations.json` with their error codes. |
| A2 | **[CONTRACT]** No "login directory" operation (who can log in on this terminal). | Login screen lists users from the mock store directly. | Is there a public `Terminal.LoginDirectory` (names only), or must users type their username? |
| A3 | **[DEMO]** Demo credentials: PIN `123456`, password `demo-password-1` for every user. | Seed credentials are hashed placeholders. | — |
| A4 | **[CONTRACT]** Seed roles are minimal; many journey steps need permissions the roles don't have (cashier firing orders, manager approving discounts, etc.). | `DEMO_ROLE_ADDITIONS` in `src/mock/seed.ts` adds them; Users screen marks added permissions "مضاف للعرض". Plus `demo-owner` with `*` (exploration only). | Publish the intended permission matrix per role. |
| A5 | **[CONTRACT]** Ops marked `PD_HELD` have permission `INTERNAL`. | `effectivePermission` (kernel) maps them to proposed permissions (e.g. `Compliance.VerifyChain` → `compliance:read`). | Which real permission guards each PD_HELD op? |
| A6 | **[ASSUMED]** Refund self-approval: the approver must differ from the refund *requester*, not only from the cashier who took the payment. | `SELF_APPROVAL_DENIED` when approver = requester (J-R4). | Confirm. |

## 2. Approvals

| # | Gap | What the prototype does | Question |
|---|---|---|---|
| B1 | **[CONTRACT]** `Approval.Grant` `action` enum lists only 7 actions; `approval_actions.json` and the docs use more. | Kernel accepts every action in `approval_actions.json` + additions below. | Align the enum. |
| B2 | **[CONTRACT]** `ORDER_COMP` is in the docs but not in `approval_actions.json` nor in the `Order.Comp` input (`approvalGrantId`). | Added `ORDER_COMP` (direction default ALWAYS) and accepted `approvalGrantId` on `Order.Comp`. | Add to contract. |
| B3 | **[PROPOSED]** `PRICE_CHANGE`, `PRODUCT_TAX_CHANGE`, `RECEIPT_REPRINT` added as approval actions, default **NEVER** (docs/30 proposes approval for reprint). | Switchable in Policy Panel. | Default values? |
| B4 | **[DEMO]** The Policy Panel changes policies instantly without approval. The real settings screen (B4) uses `Business.Configure` with `SENSITIVE_POLICY_CHANGE` approval. | Banner on the panel says so. | — |
| B5 | **[ASSUMED]** `approvalGrantId` and `X-Command-Id` are excluded from the idempotency hash so retrying the same command with a grant is "the same command". | Same command id after grant → executes once. | Confirm the hash rule. |

## 3. Proposed operations (badge مقترح)

None of these exist in the contract; each screen that needs them shows the مقترح badge.

| Operation | Method / path | Why |
|---|---|---|
| `Kitchen.Resend` | `POST /orders/{orderId}/kitchen/resend` | Re-send a round after a KDS outage (J-F1). Path invented. |
| `Print.PreBill` | `POST /orders/{orderId}/pre-bill` | Pre-bill print before payment. |
| `Print.Document` | `POST /print-jobs/documents` | Generic document print (X/Z, reports). |
| `Order.ModifyFiredLine` | `POST /orders/{orderId}/lines/{lineId}/kitchen-modifications` | "No onions" after firing → kitchen modification ticket. |
| `Order.AssignSeat` | `POST /orders/{orderId}/lines/{lineId}/seat` | Seats (SeatsPolicy). |
| `Order.CreateStaffMeal` | `POST /staff-meals` | Staff meals as a separate check type. |
| `Deposit.Create / Find / Apply` | `/deposits…` | Reservation deposits applied to the final check. |
| `Reservation.MarkNoShow / Seat` | `/reservations/{id}/…` | Reservations screen. |
| `Tip.Distribute` | `POST /sessions/{sessionId}/tips/distribute` | Tip pooling at close. |
| `Report.AccountantExport` | `GET /reports/exports/accountant` | Accountant export (xlsx). |
| `FiscalSetup.Get` | `GET /compliance/setup` | One read for the fiscal setup screen. |
| `Table.Release` | `POST /table-visits/{visitId}/release-table` | Free the table while a check is still open. |

## 4. Policies

| # | Gap | What the prototype does |
|---|---|---|
| P1 | **[CONTRACT]** Many policies referenced by journeys/docs are not in `policies.json`. | Shaped from CORE docs + EG profile into `src/mock/policyRegistry.ts`; each shows its state: CANONICAL (35) / CORE (18) / PENDING (3: CashRoundingPolicy, TipPolicy, KitchenTimingPolicy) / DIRECTION (11). |
| P2 | **[PROPOSED]** Direction policies: ReceiptPrintPolicy, DirectionCatalogDemo, HalfAndHalfPricingPolicy, SplitAllocationPolicy, TipDistributionPolicy, StackedTaxPolicy, MinimumChargePolicy, ChargeComponentsPolicy, SeatsPolicy, WalletProvidersPolicy. | Badge مقترح; off by default unless needed by a journey. |
| P3 | **[ASSUMED]** `FireTimingPolicy` TAKEAWAY = `AT_CONFIRM` (fires at first payment/confirm). | Counter journey J-C1. |
| P4 | **[ASSUMED]** Composition policy name `VISIT_SINGLE_CHECK`. | |
| P5 | **[ASSUMED]** Policy snapshot is frozen at check creation; service charge captured at first active line (`CAPTURED_BASE_SERVICE_POLICY`). Changing channel re-captures service. | "Applies to new actions only" banner. |
| P6 | **[ASSUMED]** `VisitAutoClosePolicy` closes the visit when the last check settles, which makes J-R1 step 22 ("close the table") a no-op. | Step 22 verifies the table is already free. |
| P7 | **[DEMO]** `DirectionCatalogDemo` adds a 6th category (pizzas, combo, shisha, nuts). J-R1 says "5 categories". | Toggle in Policy Panel. |

## 5. Request/response shapes we had to assume

- `OrderWideDiscountRequest` (kind/value/reason) and `TenderInput` (method, amount, tendered, reference) — partial in OpenAPI.
- Kitchen ticket state names (`NEW → IN_PROGRESS → READY → DONE`).
- Report response sections have no column definitions; the UI infers columns.
- `Print.Reprint` has no `reason` field though docs/30 asks for one; the UI collects it and sends it as `reasonCode` (ignored by contract).

## 6. Rule interpretations

| # | Rule | Interpretation |
|---|---|---|
| R1 | Discount on a fired check | Allowed at runtime only on unfired lines? Docs disagree; prototype allows on fired-but-unpaid checks. |
| R2 | Confirm a floor check without a drawer | Allowed (FLOOR_WITHOUT_DRAWER); takeaway needs an open session. |
| R3 | `SESSION_HAS_OPEN_ORDERS` | Blocks close only for counter/takeaway checks bound to that drawer session (DRAFT/CONFIRMED); floor checks never block. |
| R4 | Quote error order | Availability SOLD_OUT/BLOCKED → `PRODUCT_UNAVAILABLE`; then no price → `PRICE_NOT_FOUND`; then not on branch menu → `PRODUCT_UNAVAILABLE` (`NOT_ON_BRANCH_MENU`). Seed note says branch_second must give `PRICE_NOT_FOUND` (N9). |
| R5 | Order numbers | Continuous per branch, not reset at business date. |
| R6 | Report dates | Business date (cutoff 04:00 Africa/Cairo), not calendar date. |
| R7 | N7 (drawer) | Single drawer per terminal approximation. |
| R8 | Service charge on e-receipt | Shown as a separate non-taxed line when service is not taxable. |

## 7. Output / fiscal (from the output screens review)

- `Compliance.VerifyChain` is `INTERNAL` in contract — mapped to `compliance:read`.
- Corrected receipt chaining vs docs/19: the prototype keeps `previousUUID` pointing to the original; docs suggest the chain head.
- `RECEIPT_REPRINT` default NEVER vs docs/30 proposal (approval).
- `FiscalSetup.Get` and `Report.AccountantExport` are proposed.
- FiscalDevice `RETIRED` state is not handled by any op; `expectedVersion` ignored on device ops.
- Retrying a `DEAD` print job: undefined in docs — prototype starts a fresh backoff cycle (5/15/45/120/300 s).
- Reports have no branch picker in the contract (filter by header `X-Branch-Id` only).

## 8. Catalog (from the catalog screens review)

- `Variant.Upsert` contract only has attributes/barcode: no name, price delta or modifier multiplier (sizes/half-and-half shown as مقترح).
- ModifierOption `name` is plain text in the contract while the bilingual UI sends `{ar, en}`.
- Fields with no contract: category colour, product allergens, `TABLE_TAX` tag, tax exemption, availability across other branches.
- No product search by name (list filters on the client).
- `Catalog.SetPrice` implemented per docs/22 §3: an unstarted price can be corrected, a new price ends where the next scheduled one starts, an explicit end leaves a gap (no auto-revert), max 366 days ahead, result includes `changeKind`.
- Catalog import validates availability rows, duplicate product keys and name uniqueness (all-or-nothing).

## 9. Organization, users & settings (from the admin screens review)

- `Business.Configure` has no Arabic name field, and it accepts `taxRegistrationNumber`, which conflicts with E-40.
- `Terminal.Register` has no `kind` or drawer field (both shown as مقترح in the form).
- `RoutingRule.Configure` cannot change the target station; a `NO_TICKET` target is proposed.
- The internal "apply EG profile" provisioning tool re-applies on a second run instead of refusing.
- No read operation returns all prices at once (the price grid issues one read per product).
- `Credential.Reset` returns 204 with no body, so the UI cannot show what changed (`mustChangeCredentials` is set by the mock).
- `Permission.List` is derived from the contract's permission ids; free-text permissions are refused with `UNKNOWN_PERMISSION_ID`.
- `User.ManageAccess` refuses to remove the last owner (`LAST_OWNER_PROTECTED`); the last active MANAGED reason code of a kind cannot be deactivated.
- `CONCURRENCY_CONFLICT` has one message for every entity; the Arabic text was made generic ("البيانات دي") instead of naming a check.

## 10. Prototype limitations

- Single-browser simulation: "devices" share one localStorage database; no real concurrency, only simulated races.
- Offline mode is simulated as network failures; there is no offline queue (contracts don't define one).
- The e-receipt platform (ETA) is a simulator; documents are not signed.
- Not every one of the 1000 situations is executable; they are browsable and can be filed as feedback. N1–N12 and the journeys are executable.
