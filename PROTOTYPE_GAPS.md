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

## 14. Prototype limitations

- Single-browser simulation: "devices" share one localStorage database; no real concurrency, only simulated races.
- Offline mode is simulated per device in the client (queue + replay); there is no real service worker or local database.
- The e-receipt platform (ETA) is a simulator; documents are not signed.
- Not every one of the 1000 situations is executable; they are browsable and can be filed as feedback. N1–N12 and the journeys are executable.
