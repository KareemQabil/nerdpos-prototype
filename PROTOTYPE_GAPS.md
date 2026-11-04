# PROTOTYPE_GAPS — assumptions, proposals and contract gaps

> كل حاجة البروتوتايب اضطر يفترضها أو يقترحها عشان الشاشات والرحلات تكمل، وكل تعارض لقيناه بين العقود والوثائق.
> كل بند عليه: **أين** (العقد/الوثيقة)، **إيه اللي عملناه**، و**سؤال للباك إند/المنتج**.

Legend: **[CONTRACT]** missing or inconsistent in `operations.json` / `errors.json` / `openapi` ·
**[PROPOSED]** invented by the prototype (badge مقترح) · **[ASSUMED]** a reading of an ambiguous rule ·
**[DEMO]** shortcut that exists only for the demo · **[QUESTION]** needs a product decision.

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
| `Reservation.MarkNoShow / Seat` | `/reservations/{id}/…` | Reservations screen. ux-12: `Reservation.Update / Cancel`, `Deposit.Refund` (§15h). |
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

- `Variant.Upsert` contract only has attributes/barcode: no name, price delta or modifier multiplier (now implemented with proposed fields — see section 12).
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

## 10. Inventory & purchasing (round 2)

All 53 inventory/purchasing operations (SPECIFIED / BUILT_ON_MAIN) are simulated.

| # | Gap | What the prototype does |
|---|---|---|
| I1 | **[CONTRACT]** A stock item must point at a catalog product; ingredients are not products. | Ingredients are stock-only items whose `productId` points at themselves (never on the menu). Resale items (cans, water) link to a real menu product. |
| I2 | **[CONTRACT]** `InventoryItem.Configure` has no name, category, purchase packs or shelf life; `SetLevels`, `LowStock`, `Expiring`, `Recipe.Cost`, `Production.Preview` have empty inputs. | Accepted as extra fields / inputs defined by the prototype. |
| I3 | **[PROPOSED]** No item list and no dashboard read. | `InventoryItem.Find` (GET /inventory/items), `Inventory.Dashboard` (GET /inventory/dashboard). |
| I4 | **[ASSUMED]** When sales consume stock. | `InventoryEffectTimingPolicy` (proposed, default on confirm) from the branch sales warehouse; idempotent reconcile per order line; void before kitchen start → `SALE_REVERSAL`; after → per `LineVoidDispositionPolicy` as waste. Branch without a sales warehouse → skipped with a dashboard warning. |
| I5 | **[ASSUMED]** Negative stock. | Sales are never refused (movement flagged). Manual movements follow `NegativeStockPolicy` (proposed, default BLOCK) with a per-item override. |
| I6 | **[CONTRACT]** Costing method not ratified. | Moving-average cost across all warehouses; lots consumed first-expiry-first-out. |
| I7 | **[ASSUMED]** Count variance. | counted − (start balance + movements since start), valued at average cost. |
| I8 | **[CONTRACT]** Transfer shortage rules (PD-V4-06) not available. | Single receive; shortage recorded on the transfer, no movement. |
| I9 | **[PROPOSED]** Approvals. | `INVENTORY_ADJUST`, `STOCK_COUNT_POST`, `STOCK_WASTE`; `OverReceiptPolicy` REQUIRE_APPROVAL reuses `INVENTORY_ADJUST`. |
| I10 | **[PROPOSED]** Recipe extensions. | Modifier-option recipes, size scaling by the size's multiplier, combo slots consume the chosen products' recipes. "No/less/extra" levels are not applied to consumption. |
| I11 | **[ASSUMED]** Customer returns. | RESTOCK puts the recipe back; DISCARD records the return with no movement. |
| I12 | **[ASSUMED]** Branch scope. | Reads default to the device's branch (with an all-branches toggle); writes are not branch-restricted. |

## 11. Customers, delivery, drivers, loyalty, online orders (round 2)

| # | Gap | What the prototype does |
|---|---|---|
| C1 | **[CONTRACT]** Drivers are `access.User` "until PD-V4-13". | Drivers are their own records. |
| C2 | **[CONTRACT]** `Driver.SettleCash`, `DeliveryZone.Upsert`, `Driver.Upsert`, `LoyaltyTier.Upsert`, `Loyalty.Redeem` are PD_HELD with no inputs. | Inputs designed by the prototype. |
| C3 | **[PROPOSED]** Missing reads/actions. | `DeliveryZone.List`, `Driver.List`, `LoyaltyTier.List`, `Loyalty.Ledger`, `ExternalOrder.Find/Accept/Reject`, `ChannelItemMap.Set`, `Payment.AuthorizationFind`. |
| C4 | **[CONTRACT]** INTERNAL permissions. | Mapped to `customer:update`, `delivery:configure`, `delivery:dispatch`, `delivery:settlecash`, `payment:capture`, `loyalty:configure`, `channel:ingest`. |
| C5 | **[ASSUMED]** Delivery fee & minimum. | `Delivery.Create` adds the zone fee to the check (taxable is a setting) and must run before confirm; the minimum order is checked there. |
| C6 | **[ASSUMED]** Delivery states. | Contract states (PENDING/ASSIGNED/PICKED_UP/DELIVERED/FAILED/CANCELLED); kitchen stage derived from tickets. Extensions: re-assign from ASSIGNED, `Dispatch` with `driverId` assigns + dispatches, fixed reason codes for `FailAttempt`. |
| C7 | **[ASSUMED]** Cash on delivery. | The driver holds the cash; settlement records a CASH payment into the settling drawer and closes the order; shortage = drawer pay-out owed by the driver, overage = pay-in. Shift close is blocked while a driver holds cash. |
| C8 | **[PROPOSED]** Approvals. | `DELIVERY_CANCEL` (after kitchen), `LOYALTY_ADJUST` (> 200 points), `DRIVER_CASH_VARIANCE` (any difference). A paid cancelled order is flagged "refund needed". |
| C9 | **[PROPOSED]** `LoyaltyProgramPolicy`. | Earn 1 point / 10 EGP of item value after discount (no fee, tax or points-paid part) × tier multiplier; redeem 1 point = 0.25 EGP, min 100 points, max 50% of the check; tiers by lifetime points; redemption is a proposed `LOYALTY` tender (VAT on the full amount). Not handled: expiry, clawback on refund, refunding a points tender. |
| C10 | **[ASSUMED]** Online/aggregator orders. | Priced from our DELIVERY prices (app price shown for comparison); app-paid = proposed `ONLINE` tender; accepting needs an open drawer on that terminal; required single choices default to the first option. Source names are generic. |
| C11 | **[ASSUMED]** `Customer.Merge`. | Keeps the customer in the path and folds `sourceCustomerId` in; audited as sensitive, no approval. |
| C12 | **[PROPOSED]** Validation & errors. | Egyptian mobile validation (`01[0125]` + 8 digits, +20 and Arabic digits normalised) and error codes `CUSTOMER_PHONE_*`, `DELIVERY_*`, `DRIVER_*`, `LOYALTY_*`, `EXTERNAL_*`, `PAYMENT_AUTHORIZATION_*`. |

## 12. Menu & pricing (round 2)

| # | Gap | What the prototype does |
|---|---|---|
| M1 | **[PROPOSED]** Operations. | `Menu.Overview`, `Menu.Upsert`, `Daypart.Upsert`, `SoldOut.Board`, `ModifierOption.SetAvailability`, `ModifierGroup.ReorderOptions`, `Product.SetCombo`, `Product.SetHalfAndHalf`, `Catalog.PriceList`, `Catalog.BulkPriceChange` (dry run), `Catalog.PriceChangeBatches`. |
| M2 | **[CONTRACT]** Fields missing on existing ops. | `Variant.Upsert`: name, priceDelta, modifierMultiplier, sku, calories, isDefault, sortOrder · `Catalog.SetPrice/PriceHistory`: `variantId` · `Product.SetAvailability`: `until: END_OF_BUSINESS_DAY` · `Product.Create/Configure`: calories, image (data URL ≤ 300 KB) · ModifierGroup: kind INGREDIENTS, scalesWithSize, allowHalfPlacement · ModifierOption: isDefault, sortOrder, nestedGroupId, extraPriceDelta · `Catalog.Search`: channel, q · `Pricing.QuoteItem` in: modifierLevels, modifierPlacement, nestedOptionIds, size inside meals; out: variantPrices, taxSplit, display, halfAndHalf, menu · `Catalog.Import`: 5 new sheets. |
| M3 | **[ASSUMED]** Combo pricing. | The meal price is split over its parts by their own prices (largest remainder) so each part is taxed in its own group; the meal's own add-ons stay on the meal's tax group. |
| M4 | **[ASSUMED]** Half-and-half. | `HalfAndHalfPricingPolicy` gains `SUM_OF_HALVES`; half toppings cost half. |
| M5 | **[ASSUMED]** Menus by time/channel. | With menus defined, an item outside every running menu is refused by the server; with no menus, nothing is restricted. |
| M6 | **[PROPOSED]** Policies. | `SoldOutResetPolicy` (sold-out resets next business day), `MenuPriceDisplayPolicy` (shown as priced / with tax per channel). |
| M7 | **[ASSUMED]** Tax-inclusive groups. | Tax is extracted from the price (previously it was wrongly added on top); service charge on a tax-inclusive check is still taxed on top. |
| M8 | **[ASSUMED]** Bulk price change approval. | One `PRICE_CHANGE` approval per batch; context changePercent = the biggest absolute change; target `bulk:<hash>`. |

## 13. Operations & system (round 2)

| # | Gap | What the prototype does |
|---|---|---|
| O1 | **[CONTRACT]** `Floor.Upsert`, `Table.MarkClean` are PD_HELD. | Floor plans with sections and positions, table cleaning cycle (`TableTurnPolicy`, proposed; default: opening a table counts as cleaning). |
| O2 | **[CONTRACT]** INTERNAL permissions. | `Floor.Upsert` table:upsert · `Table.MarkClean` table:release · `Order.TransferSession` session:close · `BusinessDay.Close` session:zreport · `ApprovalRequest.Create` any signed-in user · `Promotion.Upsert` catalog:setprice · `Sync.ResolveConflict` sync:replay · `Report.Export/Schedule` report:run · `Profile.SetCapability` settings:updatepolicy. |
| O3 | **[PROPOSED]** Operations. | `Floor.List`, `BusinessDay.Readiness`, `BusinessDay.Find`, `ApprovalRequest.Find/Get/Decide/Cancel`, `Report.Trend`, `Report.ScheduleFind`, `Report.ScheduleUpdate`. |
| O4 | **[ASSUMED]** `Order.TransferSession`. | Only drawer-bound checks; floor checks are refused (collectable at any drawer). Approval action `ORDER_SESSION_TRANSFER` defaults to NEVER. |
| O5 | **[QUESTION]** Item / buy-X-get-Y promotions. | Allocated over items and service like any check discount — should item promotions skip the service charge? Usage counts open + completed checks per business date. |
| O6 | **[ASSUMED]** Business day close. | Sales after close and before 04:00 are allowed and shown as "after closing"; days close in order; closing with warnings needs an acknowledgement (approval default NEVER). |
| O7 | **[DEMO]** Offline mode. | Simulated in the client: a cut device keeps reading its last answers and queues allowed commands (add/update lines, send to kitchen, kitchen moves, cash payment, open table, mark clean, drawer moves) with their command ids; replayed via `Sync.Replay` with conflict resolution. |
| O8 | **[ASSUMED]** Remote approval. | Accepting issues the same one-use grant as a PIN, bound to the requester and the requesting device; the waiting command retries with the same command id. |
| O9 | **[DEMO]** Reconciliation. | The bank settlement file is simulated (with ≥ 3 card payments the last is missing to create a difference); acknowledging needs a reason and never changes numbers. |
| O10 | **[PROPOSED]** Capabilities. | 12 switches (business/branch); off hides the screens and the server refuses their operations with `CAPABILITY_NOT_AVAILABLE`. |

## 14. Round 3 — authority, trusted time, venue configuration, journeys, reports engine

Design rationale: `docs/round3/DESIGN.md`; per-note and per-task status: `docs/round3/TRACEABILITY.md`.

**Authority & reversals**
- **[PROPOSED]** Ops `Order.CancelStaffMeal`, `StaffMeal.Allowance`, `Reversal.Find`, `VoidReview.Find`, `VoidReview.Decide`.
- **[CONTRACT]** Extended inputs: `Order.RemoveLine/UpdateLine/Cancel` take `reasonCode`/`reason` (a quantity decrease is a removal); `Order.VoidLine/Void` and `Refund.Request` lines take `disposition`; `Approval.Grant` takes `CARD`/`FINGERPRINT` and `overridePermission`.
- **[PROPOSED]** Approval actions `LINE_REMOVE_UNSENT` (default ALWAYS — owner decision), `RETURN_AFTER_CLOSE`, `STAFF_MEAL`; policies `SupervisorOverridePolicy`, `ApprovalCredentialPolicy`, `StaffMealAllowancePolicy` (200 EGP/day, sale price or cost), `SplitLimitPolicy`; permissions `approve:staff_meal`, `approve:return_after_close`, `voidreview:decide`; new role "accountant" (`demo-accountant`).
- **[ASSUMED]** Stage S1 = a pre-bill printed after the line was added, or the line was sent to the kitchen; S0 removals reuse `approve:line_void`; refund line disposition defaults to "waste held"; staff-meal cost basis falls back to sale price when no recipe exists.
- **[DEMO]** Manager card and fingerprint are simulated (fake card codes / reader ids in the seed). No hardware tested.

**Trusted time**
- **[DEMO]** The mock runs in the browser, so "server time" is the browser clock kept monotonic; the real product must take time from the server. No UI can move the accounting clock (owner decision); time-based views are read-only previews (`Catalog.Search previewAt`).

**Venue configuration**
- **[PROPOSED]** `KdsScreen.List/Configure` (stations per screen, dispatch flag, Start hidden/optional/required); `DocTemplate.Get/Update` (logo ≤ 200 KB, header/footer, 80/58 mm, A4); policies `TenderReferencePolicy`, `ShortOrderNumberPolicy` (default DAILY — the meeting called it optional), `SecondLanguagePolicy`.
- **[ASSUMED]** Internal tender codes kept (`DIGITAL_WALLET` = wallet, `ONLINE` = prepaid, `LOYALTY` = points); an unconfigured KDS screen shows all stations and can hand off; "required Start": bumping an item counts as starting; duplicate reference scope = method + provider + business day + branch.
- **[PROPOSED]** Sales channels as records: `SalesChannel.List/Upsert` (order type + own prices or follow another channel ± %); orders carry `salesChannelId`. Per-user permissions: `User.PermissionOverrides`, `User.SetPermissionOverride`, `User.RemovePermissionOverride`. Licensing is vendor-only (`vendor:capabilities`, persona «دعم NerdPOS»).
- **[GAP]** Dayparts, promotions and service charge still key on the order type, not the sales channel; receipts and reports don't show the channel name yet.

**Journeys**
- **[PROPOSED]** `StoreRequest.*`, `SupplierInvoice.*`, `Procurement.Chain`, `InventoryItem.PackAdvice/SetPackOffer`, `Item.Lifecycle`, `Search.Global`, `Search.Status`; permissions `storerequest:create`, `supplierinvoice:post`.
- **[ASSUMED]** Supplier invoices are simplified (an invoice price difference doesn't re-cost stock; no payment step; supplier returns not subtracted); pack advice uses 4-week usage and ≤ 8 weeks / shelf life; the follow list is per person on the device.
- **[DEMO]** Barcode scanning is a keyboard-wedge simulation (fast keystrokes + Enter); no USB scanner tested.

**Reports engine**
- **[PROPOSED]** `Report.Query`, `Report.Explain`, `Report.Bridge`, `Report.Analyze`, `Report.Ask`, `Metric.List`, `Report.Catalog`; registry of 85 metrics / 34 dimensions; 19 certified report manifests.
- **[QUESTION — accountant]** Encoded defaults: refund ex-tax part pro-rata over the original check (OD13); discount after tax treated as an item discount; comps excluded from gross sales; service charge never in net sales; week starts Saturday (OD11); dayparts 4–11 / 11–16 / 16–22 / 22–4; kitchen target 15 min; Kasavana–Smith menu matrix.
- **[GAP]** NOT_AVAILABLE by design until a source exists: labour, payroll, customer cohorts (OD06), aggregator commission, delivery fee net, forecast, refires, item affinity, supplier lateness, three-way match, return e-receipts, items × zone. VAT by tax group returns the check-level total.
- **[DEMO]** Fixture days use cash rounding 0.25 (policy currently OFF) to exercise the rounding report; days before launch answer from imported daily totals ("HISTORY"). The assistant's 198-question scores were tuned on the same bank — an unseen question set is still needed.

## 15. Reports studio — pivot, designer, saved reports, print templates, exports, schedules

Principle kept from round 3: the depth sits in the engine, the screens stay simple (a report opens with a few key numbers and one table; more detail is one click away). Engine test: `scripts/reports-engine-test.ts` (101 checks).

- **[PROPOSED]** Ops (all `report:run`): `Report.Pivot`, `Report.PivotExport`, `SavedReport.Find/Get/Save/Duplicate/FromCertified/Restore/Delete/Favourite`, `ReportTemplate.Find/Save`, `ReportAudit.Find`, `Report.ScheduleRunNow`, `Report.ScheduleOutput`.
- **[PROPOSED]** Extended: `Report.Schedule` (saved report, template, PDF, recipients by role or person, one output per branch); `Report.Export` (PDF, audited); `Report.Run` (`audit=1` records an open and the "recently opened" list).
- **[PROPOSED]** Error codes `REPORT_EDIT_DENIED`, `REPORT_SHARE_DENIED`, `TEMPLATE_NOT_FOUND`, `TEMPLATE_EDIT_DENIED`.
- **Engine guarantees:** subtotals and grand totals are recomputed by the engine at each level (never summed from rows) — ratios stay sum ÷ sum, distinct counts are recounted, stock is a snapshot; a subtotal's evidence is exactly its children; top N has an exact «الباقي» row; dividing an average/ratio is refused; colour rules are evaluated by the engine so screen, Excel and print agree; Excel is read back cell by cell in the test.
- **[ASSUMED]** "Last year" = 364 days back (same weekday); comparisons are "as of" the end of the comparison period; any day without data in a comparison / MTD / YTD window → not available (MTD shows this today because history goes back 28 days); a condition on a number applies to the deepest level; carried-forward print totals only for plain additive money/quantity columns; built-in templates editable by owner/manager, anyone can save a copy; "managers & accountant" sharing = manager + accountant roles, the owner sees every saved report.
- **Cut for simplicity (engine supports more):** A4 portrait/landscape + 80 mm only (no A3/Letter, no margin controls); six ready calculated columns instead of a formula editor; one column breakdown in the UI (engine: two); four colour presets instead of a rule editor; one condition on a number; comparisons/extra numbers on the first number only and in the total column of a cross-tab.
- **[DEMO]** Schedules record the send, they don't email; PDF pages are images (text not selectable) and use the browser's Arabic font when offline; only the last 24 schedule outputs are kept in browser storage; studio data is seeded lazily on first use (no schema bump).

## 15a. UX slice 04 — kitchen screen, call board, customer display, size change, pre-bill barcode

- **[PROPOSED]** `Kitchen.CallOrder` (`kitchen:advanceticket`, dispatch screens only → `KDS_DISPATCH_ONLY`; every station ready first; again = re-announce), `CallBoard.View` (`kitchen:read`; preparing / ready, a number leaves on hand-off or `readyMinutes` after the call, `auto` = ready counts as called; orders with a table are not shown), `CustomerDisplay.View` (`order:read`; branding, active promotions, the check's lines, server totals, settlement, last tender, e-receipt link — nothing else).
- **[PROPOSED] Input extensions** (backward compatible, listed in `src/mock/ux-contracts.ts`): `Order.UpdateLine.variantId` (UNSENT lines only — a sent line keeps `LINE_ALREADY_FIRED`; re-priced by the server with the same options; history «المقاس: … ← …» and audit); `KdsScreen.Configure.warnMinutes/lateMinutes/itemBump` (timer colours of the screen, per-item bump on/off); `Ticket.Recall.undo` (a hand-off undone within 2 minutes goes back to ready, not to cooking).
- **[RULE]** `TicketItem.Bump` refuses a voided item and a handed-off ticket; un-marking an item of a ready ticket puts it back to cooking.
- **[ASSUMED]** A display screen (call board, customer display) is attached to a terminal and reads with that terminal's session (call board → dispatch kitchen screen, customer display → cashier terminal; changeable on the display). Its own settings (look, minutes on «جاهز», automatic call, branding strip) live on the display device.
- **[ASSUMED]** The customer display learns which check is on the cashier's screen and what is being typed in the payment popup from the terminal itself (same device); every amount it shows is the server's (the change while typing is the same Decimal preview the cashier sees).
- **[DEMO]** The e-receipt QR on the thank-you screen is a placeholder link (`receipt.nerdpos.example`); sounds are Web Audio tones (played only after the first touch, mute per screen).
- The pre-bill prints the check number as a Code 128 barcode (not a QR — the QR stays the e-receipt); scanning it in collect mode opens the check.

## 15b. UX slice 05 — boards, drawer-free purchasing, the cashier's three modes

- **[PROPOSED]** `PurchaseOrder.Submit` (`purchaseorder:update`; DRAFT → PENDING_APPROVAL, the order is locked while it waits) and `PurchaseOrder.ReturnToDraft` (`purchaseorder:issue`; PENDING_APPROVAL → DRAFT, reason required; `PURCHASE_ORDER_NOT_PENDING_APPROVAL` 409). Listed in `src/mock/ux-contracts.ts`.
- **[PROPOSED] Input extension** `PurchaseOrder.Issue.approvalGrantId`: issuing an order that waits for approval needs a `PURCHASE_ORDER_APPROVE` grant (new approval action, permission `approve:purchase_order`, default rule ALWAYS — the strictest operable default; the approver cannot be the issuer unless SelfApprovalPolicy allows it). Issuing a draft directly is unchanged (backward compatible). Approved / returned facts (who, when, grant, reason) are kept on the order, its history and the audit.
- **[RULE]** PENDING_APPROVAL counts as an open purchase order (low stock «on order», supplier and item pages); goods can be received only after ISSUED.
- **[PROPOSED] Policy** `BoardAgingPolicy` (DIRECTION, settings screen «تنبيه التأخير في اللوحات»): order warn/late minutes in the same state (10 / 20), approval request warn/late minutes (2 / 5), void-review late hours (24), purchase warn days before / grace days after the due date (1 / 0). Delivery lateness stays in `DeliveryPolicy` (server `late` flag).
- **[DEMO]** `role_manager` gains `approve:purchase_order` (demo role addition).
- **[ASSUMED]** Boards are a presentation over the existing reads (Order.Find, Delivery.Board, PurchaseOrder.Find, ApprovalRequest.Find, VoidReview.Find); a drop is offered only where the owner module has a legal command and is always sent as that command (Order.Fire, Order.Confirm, Delivery.Assign / Complete, PurchaseOrder.Submit / Issue / ReturnToDraft, GoodsReceipt.Post, ApprovalRequest.Decide, VoidReview.Decide). Kitchen states, payment-closing and decided approvals are never moved from a board.
- **[ASSUMED]** The address and payment chosen when a cashier starts a delivery check live on the device until the items exist and `Delivery.Create` records them (the server needs the lines for the minimum order and the fee). The fee shown before that is the zone fee from `DeliveryZone.List`; the charged fee is the server's on send.
- Purchasing screens no longer use side drawers: purchase order, receipt, store request and invoice details use ux-06 `MasterDetail` / `DetailPane` (beside the list when wide, full page when narrow; on the boards the same pane sits in the board's detail column); long forms (new / edit order, suggestions, receiving, supplier return, store request, direct invoice) are full pages with back built on `DetailPane`; short forms are centered popups. With no users left, the deprecated `Drawer` component is removed from `src/ui/index.tsx`.

## 15c. UX slice 06 — no side drawers, one scroll container per region

- No new server reads or commands: details read the existing `Supplier.Get`, `InventoryItem.Get`, `Recipe.Get`/`Recipe.Cost`, `StockCount.Get`, `Approval.Get`, `Audit.Get`, `Product.Get`, `Report.Explain`; nothing added to `src/mock/ux-contracts.ts`.
- **[ASSUMED]** The selected record of a master-detail screen (and an open full-page editor) lives in the device's route params (`open`, `edit`, `role`, `grant`, `event`, `openProduct` + `ptab`, `newProduct`, `quickProduct`), persisted with the device state, so refresh keeps it; "back" is the in-page back button (the prototype has no browser-history routing).
- **[UI]** Detail beside the list when the screen area (window minus the sidebar) is ≥ 1040 px — about a 1280 px wide window — otherwise a full page with back; long forms (product, quick add, new-product wizard, recipe editor, count sheet, role editor) are always full pages.
- **[OBSERVED, not changed]** The in-browser mock keeps `User.Create` / `Credential.Reset` secrets as given (`db.users[].password`, `pin`); the real backend hashes credentials.
- `Drawer` stays exported (deprecated) only for the purchasing screens owned by ux-05; remove it once they are converted.
## 15d. UX slice 07 — consistency: names, duplicates, dev artifacts

- **[PROPOSED] Input extension** `SalesChannel.Upsert.externalSources` (array of online-order sources: APP_1, APP_2, WEBSITE, WHATSAPP): the sales channel owns which online sources land on it; one source → at most one active channel; not on a DINE_IN channel (`VALIDATION_FAILED` with the clashing channel). `SalesChannel.List` also returns the source catalogue (`sources`). Notes in `src/mock/channels-contracts.ts`.
- **[PROPOSED] Behaviour change** `ExternalOrder.Accept`: the sales channel is read from that mapping (the active channel of the order type that lists the source, else the order type's default channel); a `salesChannelId` in the body must equal it (`VALIDATION_FAILED` otherwise). `ExternalOrder.Find` items carry the resolved `salesChannel`. The manual channel pick on accept is gone. Demo seed: «تطبيق التوصيل ١» → «طلبات».
- **[RULE] Kitchen timing, one source:** a kitchen screen's own colours (`KdsScreen.Configure` warn/late) override the venue default `KitchenTimingPolicy` on that screen; per-station targets (`KitchenStation.targetMinutes`, no editor) are removed. The kitchen-late report fact uses the same venue default (15 min when unset — unchanged numbers).
- **[UI] One payment UI:** the full-page «التحصيل» (`pay` route, `Pay.tsx`) is removed; every «تحصيل» opens `PaymentPopup` (over the sale screen on a cashier terminal, in place on other devices). Same commands (`Order.Confirm` on the first payment, `Payment.Capture`, `Order.Complete`), so no business rule changes. The popup confirms a draft check on the first payment (the old page had an explicit «تأكيد» step first) — the same server rule, one fewer click.
- **[UI] Removed routes → redirects** (`src/app/routes.ts`, applied to stored device state, deep links, search, journeys and in-app navigation): `pay` → sale screen with the popup (cashier terminal) / «الشيكات» with the popup (other devices); `staffmeal` → sale screen with the staff-meal popup; `delivery-new` → sale screen «دليفري» mode with the start popup (optionally a customer); `soldout` → sale-screen popup (cashier terminal) / Menu tab «نفد اليوم» (office PC, remote back office); `report-catalog` → reports while technical details are off.
- **[ASSUMED] Demo gate:** there is no separate demo-mode switch yet; demo / engineering controls (simulation buttons, design status of policies, expert questions, the reports-engine page, backend-state badges) use the existing «تفاصيل تقنية» switch. «دخول سريع (تجربة)» on the sign-in screen stays (the demo has no other sign-in path).
- **[DEMO]** The demo tax is shown as «ضريبة القيمة المضافة» (VAT) — the rate stays the pack's illustrative 14% until the accountant confirms the mapping (docs/pack is not edited; the seed overrides the display name). The demo category is «أصناف جديدة» (owner default).
- **[OPEN, ux-14]** Display-screen pairing and settings live only in the display's browser storage (`display/settings.ts`). **[OPEN, ux-09]** Key maps are per device in browser storage, not per profile / server; the sidenav is still built from device kind and permissions (profiles do not drive it yet), so the cashier still sees «الشيكات» and the sidenav sold-out entry is limited by device kind (kitchen, waiter tablet).

## 15e. UX slice 09 — profiles drive navigation

- **[PROPOSED]** `User.SetProfile` (`POST /users/{userId}/profile`, `user:manageaccess`; `profileId` = one of `WORK_PROFILE_IDS` or null = «حسب الدور»; `VALIDATION_FAILED` for any other id, `CONCURRENCY_CONFLICT` on a stale `expectedVersion`). The profile is UI only (screens in the person's way, start screen, action bar, keys) and grants nothing, so it is not a `USER_ACCESS_CHANGE`; every change is audited with the old and new value. `UserView` (User.Find / User.Get / Access.Me / Auth.Login) carries `profileId`. Listed in `src/mock/ux-contracts.ts` (`UX09_PROPOSED_OPERATIONS`, `WORK_PROFILE_IDS`; the app's `Profile.id` is typed by that list).
- **[OWNER DECISION, default used] Profile assignment:** the profile comes from the user's role (`profileFor`, role name → profile; the device kind breaks ties for managers and owners), and a user may carry an override set on the users screen («البروفايل», default «حسب الدور»). An override with no workspace on the device kind (e.g. a storekeeper override on a cashier terminal) falls back to the role's profile on that device.
- **[OWNER DECISION, default used] Keys:** the keymap comes from the profile (defaults ← `profile.keys` / `profile.kdsKeys`; e.g. the call center has «العميل» on F2 and «طلب جديد» on F4) and the device may override any key in the «?» overlay. The device stores only its changes and replays them over the signed-in person's profile map with swap-on-conflict, so no two actions ever share a key whichever profile signs in; «استعادة الافتراضي» returns to the profile's keys. Still device-local (browser storage), not server-side: storing the device map on the server needs a terminal setting contract (open).
- **[RULE] The profile only narrows.** Sidenav and screen search = device kind ∩ permissions ∩ capabilities ∩ profile (`workspaces`, and the `hidden` words that name screens: reports, financialReports, license, systemSettings, sale(s), orders, payment, collection, drawer, prices, customerPersonalData, dailyOperations; «التقارير» stands for its tools). Permissions stay authoritative: a profile never adds a screen, and direct navigation (search links, F7 checks inside the sale screen, receipts) is still decided by permissions, not by the profile. `workspaces: []` (owner, branch manager) = every permitted screen minus `hidden`.
- **[UI]** The first screen after sign-in is `profile.start` when the device and the permissions allow it, else the profile's first screen on the device. Profiles that work from one screen (sale, floor, kitchen, delivery board) get the compact sidenav rail by default (owner rule «the cashier never needs the sidenav»; cashier: «نقطة البيع»، «المرتجعات»، «الوردية والدرج» — no «الشيكات», F7 opens them inside the sale screen). The header shows the profile name next to the role when they differ.
- **[DEMO]** One demo user (role + persona) for each profile nobody could reach: ريم (host), شريف (captain), عمرو (runner), ندى (barista), مصطفى (bartender), الشيف وليد (expediter), هشام (area manager), دينا (internal auditor), عبد الرحمن (storekeeper), رانيا (purchasing), سعيد (driver), إسلام (dispatcher), مروة (call center); the support profile is the NerdPOS support user. Roles `role_host` … `role_callcenter` are prototype additions with job-sized permissions (`src/mock/seed-profiles.ts`). The driver's own device and orders filter stay in ux-11.
- **[UI] Time stamps in reading order:** `<DateTime v={iso} />` (`src/ui`) renders «04 نوفمبر 07:16 ص» right to left in Arabic and «04 Nov 07:16» in English (digits in `.num` pieces, the whole an isolate in the UI direction). Time stamps inside a left-to-right number element read «نوفمبر 07:16 ص 04»; `scripts/check-money.mjs` (part of the build) now also fails on `dateTime()` / `time()` / `dayLong()` inside `.num` / `dir="ltr"` and on `value={dateTime(…)}` props.
- Closes the ux-09 items left open in 15d (sidenav from device kind and permissions only; keys per device only).

## 15f. UX slice 10 — shift and drawer inside the sale screen

- **[UI]** Opening the shift (الرصيد الافتتاحي), cash in / cash out / safe drop, opening the drawer without a sale (reason), the X report and the blind count by denomination that closes the shift are popups over the sale screen (`src/screens/cashier/DrawerPopups.tsx`). Every amount and count is entered on the shared Numpad and can be typed on the keyboard. They are reached from «المزيد» → «الوردية والدرج», from the header's shift chip (from any screen it goes to the sale screen and opens the popup), from the no-shift call to action, and from the profile keys (defaults `Shift+F1` الوردية والدرج, `Shift+F2` إدخال نقدية, `Shift+F3` صرف نقدية, `Shift+F4` فتح الدرج بلا بيع, `Shift+F6` تقرير X, `Shift+F7` عدّ الدرج وإغلاق الوردية; shown in the «?» overlay, remappable with swap-on-conflict). The key maps now accept `Shift+F1…F10`, because the 15 plain keys were all taken. Opening and closing never change the route away from `counter`. A popup picked in the shift popup returns there; a key returns to the sale.
- **[UI]** The shift page (`shift`) is read only on every device: the shift history with each shift's count difference, and the Z report of a closed shift (`session:zreport`). The Stepper, the descriptions and the open / move / no-sale / X / close flows are removed from it.
- **[RULE] Blind count:** the count popup never reads the expected cash (no X report query) and the shift popup never shows it, so the expected amount is not in the DOM before the count is confirmed. After confirming, the server's variance is shown in words («عجز 30.00 ج.م» / «زيادة 5.00 ج.م» / «مطابق»). Session.Close and the SESSION_VARIANCE approval are unchanged (EG profile threshold 10.00 ج.م). The expected cash is shown after the close only when the profile does not hide `expectedCash` (the cashier profile hides it).
- **[OWNER DECISION, default used] Recount after confirming:** a confirmed count is locked on the device until the shift closes. When the approval is cancelled, «طلب الموافقة» asks again with the same count, because the approval popup has already shown the expected cash and the difference. The strictest default is no recount. Allowing a recount would need a policy and a manager action.
- **[OWNER DECISION, default used] BlindClosePolicy off:** the count popup stays blind even when the policy is off. Only the X report shows the expected cash, because the server returns it.
- **[OBSERVED, fixed in the UI]** `Session.Current` answers `SESSION_NOT_FOUND` after a close, and `useQuery` kept the last data. The sale screen and the header now treat that refusal as «no shift», so the call to action and the warning chip come back right after the close.
- **[PROPOSED] `Refund.Cancel` rule** (existing command; `src/mock/ux-contracts.ts` `UX10_RULE_EXTENSIONS`):
  - Only the requester of a pending refund may withdraw it, or a holder of `refund:reject` (the decider). Anyone else gets `REFUND_CANCEL_NOT_REQUESTER` 403, a new error code not yet in errors.json.
  - The reason is required: trimmed, at most 200 characters, otherwise `VALIDATION_FAILED`.
  - A case that was approved, paid, rejected or cancelled gets `REFUND_CASE_NOT_PENDING` 409.
  - A stale `expectedVersion` gets `CONCURRENCY_CONFLICT` 409.
  - The cancellation adds new facts (`cancelledBy`, `cancelledAt`, `cancelReason`), a check history entry `REFUND_CANCELLED` and an audit entry. The request and its audit stay as they were. `RefundCaseView` carries `cancelledByName`.
  - UI: «إلغاء الطلب» on a pending case in «المرتجعات» → «الطلبات» for its requester (or a refund:reject holder), a popup with a required reason. The reject button is now shown only to refund:reject holders.
- **[OWNER DECISION, default used] Who else may withdraw a refund request:** the default is the existing `refund:reject` permission. There is no new `refund:manage` permission.
- **[OPEN]** Shift handover (تسليم الوردية) stays pending as an owner decision (`Session.Handover` → `CAPABILITY_NOT_AVAILABLE`). The handover is still a counted close followed by a new open, both now from the sale screen.
- **[OBSERVED, fixed in 15g]** The seeded reason codes repeat labels across the demo pack and the EG profile: CASH_MOVE `FLOAT_TOP_UP` / `FLOAT_TOPUP`, NO_SALE `GIVE_CHANGE` / `CHANGE`. The tiles showed both (ux-11 keeps the duplicates inactive). The label «تعزيز الفكة» is shown as «تعزيز رصيد الدرج» through the data wording map.

## 15g. UX slice 11 — the riders system (الطيارون)

- **[UI] «الطيارون» is a MasterDetail page** (`src/screens/delivery/Drivers.tsx`): the list (filters «الكل» / «في الوردية» / «المتوقفون») beside the rider file; the selected rider and the tab live in the route params (`open`, `tab`, `filter`). The file has five tabs: «اليوم» (orders, cash held, what he will carry after collecting, the limit), «الورديات» (shift log with hours), «المشاوير» (delivered, failed attempts, average pick-up → delivered minutes, late, paid / unpaid per trip), «التسويات» (this rider's cash settlements only) and «الحساب» (owed, unpaid pay, deductions moved to pay, net; the owed ledger; the payouts). One action bar in the file footer: «بدء الوردية» / «إنهاء الوردية», «استلام النقدية» (the shared ux-05 popup), «تسوية العجز», «صرف المستحقات»; edit and «إيقاف» in the header. The 12 small card buttons, the description, the drawer banner and the all-riders settlement table are removed. Adding / editing a rider is a centered popup (Enter saves).
- **[PROPOSED] Contracts** (`src/mock/ux-contracts.ts` `UX11_PROPOSED_OPERATIONS`, `UX11_RULE_EXTENSIONS`):
  - `Driver.Get` (`GET /drivers/{driverId}`, `delivery:read`): the rider file (active or deactivated).
  - `DriverShift.Start` / `DriverShift.End` (`POST /drivers/{driverId}/shift/start|end`, new permission `delivery:shift`, CAS on the rider version) and `DriverShift.Find` (`GET /driver-shifts`). Ending keeps the existing rule (`DRIVER_HAS_ACTIVE_DELIVERIES`, `DRIVER_CASH_NOT_SETTLED`) and records the minutes; `Driver.Upsert {onShift}` now goes through the same start / end, so every shift is in the log. New refusals `DRIVER_SHIFT_ALREADY_OPEN` / `DRIVER_SHIFT_NOT_OPEN` (409, not in errors.json).
  - `Driver.SettleOwed` (`POST /drivers/{driverId}/owed/settlements`, `delivery:settlecash`, approval `DRIVER_OWED_SETTLE`): mode `COLLECT_CASH` (drawer `PAY_IN` in this terminal's open shift, reason code `DRIVER_OWED_COLLECT`) / `DEDUCT_PAYOUT` (netted by the next payout) / `WAIVE`; `owed` goes down by the amount; refusals `DRIVER_OWED_OVER_SETTLE` 409 (amount > owed), `DRIVER_PAYOUT_INSUFFICIENT` 409 (a deduction larger than the unpaid pay less what is already moved), `REASON_REQUIRED` (deduct and waive), `CONCURRENCY_CONFLICT` (stale `expectedVersion`). Every change is an append-only owed-ledger entry (`driverOwedEntries`: before / after / grant / reason / session); a cash-settlement shortage now writes a `SHORTAGE` entry too.
  - `Driver.Payout` (`POST /drivers/{driverId}/payouts`, new permission `delivery:payout`, approval `DRIVER_PAYOUT`) and `DriverPayout.Find`: pays the unpaid DELIVERED trips (or ended shifts for `FIXED_SHIFT`) up to `periodTo` (sent by the screen, ≤ now and after the last payout, so the approval context is stable), by `DriverPayPolicy`, less the pending `DEDUCT_PAYOUT` entries; the net leaves this drawer as `PAY_OUT` (reason code `DRIVER_PAYOUT`). The payout is immutable (period, rule and rate, trip / shift / deduction ids, gross, deductions, net, grant); a paid trip is never paid again (`DRIVER_NOTHING_TO_PAY`).
  - `Delivery.SuggestRider` (`GET /deliveries/{deliveryId}/rider-suggestions`, `delivery:assign`): riders on shift with room, ranked same zone → least load → free the longest; riders who would go over the cash limit come last.
  - `Delivery.Return` (`POST /deliveries/{deliveryId}/return`, `delivery:assign`): `FAILED → RETURNED` when the food is received back by staff (not by the rider).
  - Extensions: `Delivery.Assign` / `Dispatch` cash-limit rule (+ `approvalGrantId`), assignable from `RETURNED`; `Delivery.Cancel` also from `RETURNED`; `Driver.Upsert` `active:false` needs `reason` and no cash in hand (keeps the record, ends the open shift), `active:true` reactivates, `userId` links a sign-in account; `Driver.List ?status=INACTIVE` and `inactiveCount`.
- **[RULE] Rider isolation, server side:** a user linked to a rider record (`Driver.userId`) who does not hold `delivery:assign` IS that rider. `Delivery.Board` returns his deliveries only; `Delivery.Get` / `Dispatch` / `Complete` / `FailAttempt` on another rider's delivery answer `DELIVERY_NOT_FOUND`; `Driver.List` / `Get`, `DriverShift.*`, `DriverPayout.Find` are limited to himself (`DRIVER_NOT_FOUND` otherwise); he cannot name another rider on dispatch. A user with neither `delivery:assign` nor `delivery:create` and no link (the rider role unlinked) sees no rider at all (fail closed). Dispatchers, cashiers, managers and the call center are not limited.
- **[UI] Assignment suggestion:** the rider picker (card popover, the drop popup, the delivery details) shows «المقترح» on top with the reason (same zone / load / over the cash limit) and assigns it with one tap; the list below follows the server ranking. The popover closes before the command so an approval popup is never under it.
- **[DEMO] The rider's phone «موبايل الطيار»** (`t_rider`, code `DEMO-RIDER-1`, new terminal kind `MOBILE`, one name in `DEVICE_NAMES`, short `R1`): screen «طلباتي» (`rider`, `src/screens/delivery/RiderPhone.tsx`) — his shift start / end, cash on hand, his orders with the amount to collect and big «استلمت» (Dispatch) / «سلّمت» (Complete; card reference when the order is card on delivery) / «فشل التسليم» (reason tiles) buttons, and what he delivered today. The driver profile now works from `rider` (falls back to the delivery board elsewhere, still limited by the server). Seed: سعيد منصور (`drv_5`) linked to `demo-driver` (`u_driver`), off shift; `role_driver` gets `delivery:dispatch` and `delivery:shift`; the open shifts of the riders already on shift and a week of shift history; the owed-ledger entry behind أحمد فتحي's seeded 35.00 (`src/mock/seed-riders.ts`).
- **[STATE] RETURNED** (owner decision 4, default «yes»): after a failed attempt the dispatcher / cashier receives the food back («استلام المرتجع»); the board shows it in «جاهز للخروج» with «مرتجع للمطعم» (and a filter); it is dispatched again (assign / dispatch) or cancelled through the existing cancel / void flow (approval, waste). End-of-day readiness does not count it as «still out».
- **[OWNER DECISION, default used] 1. Rider pay:** new `DriverPayPolicy` {mode `PER_TRIP` | `FIXED_SHIFT` | `PERCENT_OF_FEE`, perTripAmount, shiftAmount, feePercent}; default `PER_TRIP` 15.0000 per DELIVERED trip (illustrative). Only DELIVERED trips earn (failed attempts do not).
- **[OWNER DECISION, default used] 2. Shortage:** collected in cash at settlement with a manager's approval; «خصم من المستحقات» and «إعفاء» also exist, each with approval and a required reason (`DRIVER_OWED_SETTLE`, rule ALWAYS — editable in the approvals policy).
- **[OWNER DECISION, default used] 3. Assignment over the cash limit:** `DeliveryPolicy.cashLimitMode` `APPROVAL` (default) / `BLOCK` / `WARN`. The check is what the rider would carry: cash on hand + cash still to collect on his deliveries + this delivery's cash, against `driverCashLimit`; over it → `DRIVER_CASH_LIMIT_OVERRIDE` (rule ALWAYS), `DRIVER_CASH_LIMIT_EXCEEDED` 409, or a timeline warning. Every over-limit assignment is in the delivery timeline and the audit.
- **[OWNER DECISION, default used] 4. «مرتجع للمطعم»:** yes (RETURNED above).
- **[OWNER DECISION, default used] Who pays out:** the drawer holder (`role_cashier` gets `delivery:payout`) with a manager's approval every time (`DRIVER_PAYOUT`, rule ALWAYS); managers hold `delivery:payout`, `delivery:shift` and the three new approval permissions; the dispatcher has `delivery:shift` but not `delivery:payout`.
- **[DATA, fixed] Duplicate reason codes** (open since 15f): the EG profile codes that repeat a demo code with the same label (CASH_MOVE `FLOAT_TOPUP` = `FLOAT_TOP_UP`, NO_SALE `CHANGE` = `GIVE_CHANGE`) are seeded **inactive** with `replacedBy` — not deleted — so the reason tiles show each reason once and history that used the old code (e.g. yesterday's no-sale `CHANGE`) stays readable by its label.
- **[NOT CHANGED] `delivery_fee_net`** stays «غير متاح» in the reports registry: rider pay is now known per payout, but only per trip under `PER_TRIP` (not under `FIXED_SHIFT`), and aggregator / partner fees are still not recorded, so a fee-net figure would be partial.
- **[OPEN]** Real GPS from the rider's phone (the map still moves riders by simulation), push notifications to the phone, and payroll export of payouts stay out of scope.

## 15h. UX slice 12 — reservations complete (الحجوزات)

- **[UI] «الحجوزات والعربون»** (`src/screens/Reservations.tsx`): a **day timeline** (rows = the branch's active tables plus «بلا ترابيزة», columns = hours of the chosen Cairo day, each reservation a bar as long as the seat, the current time as a line) and a **list** (filters: the chosen day / «القادمة» / «الملغاة وعدم الحضور»); the switch is remembered per browser; «اليوم» / «غدًا» / a date. A bar is dragged (pointer: mouse after 5 px, touch after a 300 ms press) to another time (15-minute steps) or another table row **only where legal**: during the drag the drop target is drawn green or red with the reason, and an illegal drop is refused on the screen with no request (same rule as the server: not in the past, an active table, no other booking of the table closer than seat + buffer). The same moves from the bar menu (⋯ / M / Space / right click: ±15 minutes, ±1 hour, any table — illegal ones disabled with the reason) and the keyboard (Shift/Alt + ←→ ±15 minutes, ↑↓ previous / next table; Enter opens). Centered popups only: the reservation (customer card with «ملف العميل», time / table / party, notes, deposit balances, the append-only history), new reservation (customer picked by phone / name or created in place with the shared `QuickCreate`; date + 15-minute time; party; a table grid that disables tables in conflict; the deposit on a drawer terminal), edit, cancel (the deposit outcome is shown before confirming; reason chips + text), refund (amount on the shared `Numpad`, «المتبقي كله», reason; the approval popup follows) and seat (a free table, guests). The page description and the deposits banner are removed.
- **[PROPOSED] Contracts** (`src/mock/ux-contracts.ts` `UX12_PROPOSED_OPERATIONS`, `UX12_RULE_EXTENSIONS`):
  - `Reservation.Update` (`POST /reservations/{reservationId}/update`, new permission `reservation:manage`): time (not in the past → `RESERVATION_TIME_PAST` 409), table (null clears), party size 1..200, notes ≤ 200, or `customerId` to link a legacy reservation; BOOKED only (`RESERVATION_NOT_BOOKED` 409); a time or table change is refused when another booking of the same table (or a seated one whose visit is open) is closer than `seatMinutes + bufferMinutes` (`RESERVATION_TABLE_CONFLICT` 409, details name the other booking). CAS on the reservation version; each change is an append-only history entry `{field, from, to}` and an audit line with old → new.
  - `Reservation.Cancel` (`POST /reservations/{reservationId}/cancel`, `reservation:manage`): required reason 3..200 (`REASON_REQUIRED`), CAS. **The deposit is never refunded by the cancel**: the policy decides (below) and the outcome is recorded on the reservation (`cancel {reason, late, mode, depositOutcome NONE | REFUNDABLE | FORFEITED}`) and, when forfeited, on the deposit (`forfeit {cause LATE_CANCEL | CANCEL_POLICY, amount}`); audited as sensitive. `Reservation.Find` returns `cancelPreview` (what cancelling now does) so the popup shows the server's answer before confirming.
  - `Deposit.Refund` (`POST /deposits/{depositId}/refunds`, new permission `deposit:refund`, approval `DEPOSIT_REFUND` rule ALWAYS): up to the **remainder** = amount − applied − refunded (default the whole remainder; more → `DEPOSIT_REFUND_OVER_REMAINING` 409), out of **this terminal's drawer in an open shift** (`SESSION_NOT_OPEN` otherwise; `PAY_OUT`, reason code `DEPOSIT_REFUND`), reason 3..200, grant bound to `{depositId, reservationId, amount, remaining}`; refused while the reservation is still booked (`DEPOSIT_RESERVATION_ACTIVE` 409 — cancel first) and after a forfeit (`DEPOSIT_NOT_REFUNDABLE` 409). The refund is an immutable record (number `DR-nnnn`, amount, remaining before, reason, session, terminal, grant, approver); the deposit becomes **REFUNDED** when nothing remains; CAS on the deposit version.
  - Extensions: `Reservation.Create` takes `customerId` (name and phone from the record; the free-text name + phone stay accepted for legacy callers), refuses the past and table conflicts, links the deposit both ways, audits; permission `reservation:manage` (was `table:assign`). `Reservation.Seat` is **the one seating path**: it opens the table visit (booked table or `tableId`, guests default the party size) and marks the reservation SEATED in the same transaction (visit `reservationId`), returns `{reservation, visit}`; `TableVisit.Open` with `reservationId` runs exactly the same path (a reservation that is not booked is now refused instead of ignored). `Reservation.MarkNoShow` keeps its rule (the held deposit is forfeited) and records it (`forfeit.cause NO_SHOW`, history, audit). `Deposit.Apply` applies up to the smaller of the deposit remainder and the check remainder (optional `amount`, `DEPOSIT_OVER_REMAINING` 409), one append-only application record per DEPOSIT capture; APPLIED when nothing remains, otherwise the remainder stays HELD and can be refunded. `Deposit.Create` takes `customerId` and `reservationId` (the screen books first, then takes the deposit). `Deposit.Find` returns balances, applications, refunds, the forfeit, `refundBlock` and the reservation's visit (the payment popup lists the seated table's deposit first). `Table.List` `reservation` is the upcoming one only (from `upcomingMinutes` before its time until its seat ends) with id, version, party, minutes to, deposit held. `Reservation.Find` filters `customerId` / `state` / `from` / `to` and carries the branch rules.
- **[POLICY] `ReservationPolicy`** (new, `policyRegistry.ts`, TENANT / BRANCH): `seatMinutes` **90**, `bufferMinutes` **15**, `cancelDepositMode` **`FORFEIT_IF_LATE`** (`REFUND_WITH_APPROVAL` | `FORFEIT_IF_LATE` | `ALWAYS_FORFEIT`), `lateCancelHours` **2**, `upcomingMinutes` **120** (the marker on the floor plan). Approval action **`DEPOSIT_REFUND`** (rule ALWAYS, approver permission `approve:deposit_refund`).
- **[UI] Seating from «خريطة الصالة»:** a free table with an upcoming reservation is «محجوزة» with the time and (large tables) the guest and party; an occupied table that has one soon carries a violet time badge. Its popup shows the reservation (guest, time, party, minutes to / late, notes, deposit held) with «إجلاس الحجز» (and «إجلاس + شيك جديد» for a waiter) through `Reservation.Seat`, and «فتح لضيف آخر» for a walk-in (plain `TableVisit.Open`). Host and waiter use the same popup; the reservations screen seats through the same command (choose a free table when the booking has none).
- **[UI] Customer link:** the reservation popup links a legacy free-text reservation to a customer (search or `QuickCreate`); legacy rows stay readable (name and phone as typed, marked «بلا ملف»). The customer profile has a read-only «الحجوزات» tab (`Reservation.Find?customerId`). The payment popup lists the seated table's deposit first («عربون حجز هذه الترابيزة») and shows each deposit's remainder.
- **[SEED]** Permissions: `reservation:manage` → manager, cashier (takes the deposit at the till), host, floor captain; `deposit:refund` → manager, cashier; `approve:deposit_refund` → manager (`src/mock/seed-reservations.ts`, `demoAdded`). Today's book: three reservations linked to customers and one legacy free-text reservation, plus one tomorrow; no seeded deposit (a deposit is cash in a drawer, taken live in a shift).
- **[OWNER DECISION, default used] 1. Deposit on cancellation:** `FORFEIT_IF_LATE` with `lateCancelHours` 2 — a cancellation within 2 hours of the time forfeits the deposit; an earlier one leaves it to be refunded **only with a manager's approval** (`DEPOSIT_REFUND` ALWAYS). This is the strictest operable combination named in the brief ("refund only with approval, and forfeit if cancelled within 2 hours"); `REFUND_WITH_APPROVAL` (refundable at any time, still with approval) and `ALWAYS_FORFEIT` are selectable. A cancel never pays money out by itself.
- **[OWNER DECISION, default used] 2. Seat duration and buffer:** 90 minutes + 15 minutes; two bookings of one table closer than 105 minutes conflict.
- **[OWNER DECISION, default used] 3. How a deposit is refunded:** in cash out of the drawer of an open shift, whatever method it was taken by (card / wallet deposits are not reversed to the card or wallet — no provider integration in the prototype).
- **[OWNER DECISION, default used] 4. Who manages reservations / refunds:** above (cashier takes and refunds at the till with a manager's approval; the waiter seats but does not take reservations; host and captain manage the book without money).
- **[STATE] REFUNDED** is the deposit's state (a reservation's own lifecycle stays BOOKED / SEATED / NO_SHOW / CANCELLED; a cancelled reservation shows its deposit outcome «العربون قابل للرد» / «صودر العربون» / «مردود»). CANCELLED and REFUNDED are both reached from the UI.
- **[JOURNEY] J-B1** (`src/demo/journey-reservations.ts`, in the walkthrough and `scripts/journeys-test.ts`): booking with a deposit linked to a customer, conflict / past refusals, update with CAS and history, the floor marker, seating (both doors give the same result), partial application to the check and refund of the remainder, early cancel + refund with approval (REFUNDED, PAY_OUT in the open shift), the no-shift / stale / over-remainder / missing-reason / still-booked refusals, a late cancel forfeited, a no-show, the audit and the customer's reservations.
- **[OPEN]** Online booking, SMS reminders and hardware stay out of scope. The no-show fee is still recorded with the booking (as before, it is not charged by any command). The timeline shows one calendar day (Cairo); a booking after midnight belongs to the next day's view.

## 16. Prototype limitations

- Single-browser simulation: "devices" share one localStorage database; no real concurrency, only simulated races.
- Offline mode is simulated per device in the client (queue + replay); there is no real service worker or local database.
- The e-receipt platform (ETA) is a simulator; documents are not signed.
- Not every one of the 1000 situations is executable; they are browsable and can be filed as feedback. N1–N12 and the journeys are executable.
