# NerdPOS CORE: the sellable restaurant (binding compass, DOMAIN, 2026-10-25)

**Status:** binding for every lane (DOMAIN, BUILD, EXPERIENCE, WORKER). This is the destination every task serves. A task that does not move a row of §2 is not CORE work. Evidence state of this document: SPEC_ONLY; statuses are as of `main` `30e78612` (2026-10-25, after the owner's merge list) plus the DOMAIN/BUILD branches listed in `docs/20_L1_OPERATION_STATUS.md`. Revised with BUILD's source review (Codex, 2026-10-24T2240Z).

**Delivery model (owner, 2026-10-25):** not SaaS and not multi-tenant. Each client gets one dedicated deployment and database, installed, configured, tested and trained by our team. Policies, menu data, routing and device or fiscal adapters are set at installation; a missing capability is built, never faked with a switch.

**CORE is a delivery scope, not a module tier.** It is the set that ships in the first sale (fragment `delivery_scope` `CORE_PILOT_SELLABLE`). Every module stays independently composable, as the implementation rules require. Nothing here makes a module mandatory, and nothing outside CORE is second-class code.

## 1. The product we sell

One restaurant business in **Egypt**, with 1 to 3 branches. It sells **dine-in and takeaway** from day one, on its own menu and prices. It takes **cash and card** (card recorded with a reference, no provider integration). It issues the **Egyptian e-receipt (ETA)**. It runs **shifts with a counted drawer**, has a **kitchen display**, and puts **manager control** over every money-changing exception. It reports **sales, tenders, voids and staff** at the end of the day.

The legacy UI design is kept as it was (LEGACY_UI_PARITY). Saudi Arabia and other markets come later: as new policy values and fiscal adapters where those suffice. A market that needs new behaviour gets a compatible owner operation or adapter, never a hidden branch in existing code.

**Not CORE:**
- delivery aggregators, loyalty, customer credit (ON_ACCOUNT);
- inventory, recipes, purchasing;
- offline mode, multi-currency.

These are L3 extension seams (NP-D-L3-01/02) and must not leak into CORE.

## 2. Capability map

**Gate:**
- **L1** = browser beta on the real API and PostgreSQL.
- **L2** = sellable pilot.

**Status:**

| Status | Meaning |
|---|---|
| ACCEPTED | on main (accepted before the blueprint, or merged slice) |
| SUBSET | an accepted, supported subset exists on main; the missing parts are listed |
| CANDIDATE | tested on a BUILD branch |
| SPEC | DOMAIN fragments exist, BUILD not started |
| TODO | DOMAIN spec not written yet |

| # | Capability | Operations | Gate | Status | Business knobs (§3) |
|---|---|---|---|---|---|
| A1 | Login, roles, PIN, terminal context | Auth.*, Access.Me, Session.Current | L1 | ACCEPTED | LoginLockout, AuthSession, Credential |
| A2 | Users and roles admin | User.Create/ManageAccess, Role.Create/Update/List | L2 | SUBSET (accepted; missing: admin screens, USER_ACCESS_CHANGE approval) | ApprovalRequirement[USER_ACCESS_CHANGE] |
| B1 | Menu admin: units, categories, products, modifiers, branch availability | Unit.*, Category.*, Product.*, ModifierGroup.*, ModifierOption.* | L2 | SPEC (domain-line, manifest 3.1.0) | NewProductAvailability, AvailabilityReason, ProductTaxDefault |
| B2 | Prices per branch and channel, effective dates, history | Catalog.SetPrice, Product.PriceHistory | L2 | SPEC (W1, E-35: non-overlapping windows, no backdating; domain-line 3.1.0) | PriceScheduling, ZeroPrice, ApprovalRequirement[PRICE_CHANGE] (needs §5) |
| B3 | Tax policies (rates, inclusive/exclusive, rounding) | TaxPolicy.Create/Configure/SetActive/List (Upsert superseded) | L2 | SPEC (W2, E-35: archive only when unused; domain-line 3.1.0) | Rounding, PricingOrder, ApprovalRequirement[SENSITIVE_POLICY_CHANGE] |
| B4 | Settings and reason codes | Settings.UpdatePolicy/Effective, Policy.History, ReasonCode.* | L2 | SPEC (W4, domain-line 3.5.0) | every §3 policy is set here |
| B5 | Menu import at installation (dry run, all-or-nothing) | Catalog.Import, pricing.ImportFirstPrices | L2 | SPEC (E-39) | — |
| C1 | Floor: tables, visits, transfer | Table.*, TableVisit.* | L1 | ACCEPTED (Table #18, Visit #21) · SPEC (SetActive, Transfer) | FloorIntake, CheckComposition |
| C2 | Order entry, modifiers, server prices | Order.Create/AddLines/UpdateLine/RemoveLine/Get, Category.List, Catalog.Search, ModifierGroup.List, Pricing.QuoteItem | L1 | ACCEPTED + CR (floor, R-04) · ACCEPTED (Category.List #17) · CANDIDATE (ModifierGroup.List #23) · SPEC (Catalog.Search) | OrderNumber, PricingOrder, OrderConfirmationPricing |
| C3 | Kitchen: fire rounds, routing, KDS | Order.Fire, kitchen.fire-round, KitchenStation.*, RoutingRule.*, Kitchen.Board/AdvanceTicket | L1 | ACCEPTED (stations #20) · CANDIDATE (rules #22) · SPEC (Fire, worker, KDS) | FireTiming, routing rules (data) |
| C3b | Kitchen status on the check and safe re-send | Kitchen.OrderFulfillment, Kitchen.Resend | L1 | SPEC (E-38) | — |
| C4 | Exceptions: cancel, void line, void check, move/split | Order.Cancel/VoidLine/Void/MoveLines, Approval.Grant | L1 | ACCEPTED (void approval issuance #10) · SPEC (Cancel floor, VoidLine/Void consumption, MoveLines) | ApprovalRequirement[LINE_VOID, ORDER_VOID], SelfApproval, ApprovalTtl, LineVoidDisposition |
| C5 | Discounts and comps | Order.ApplyDiscount, Order.Comp | L2 | SUBSET (accepted DRAFT_UNFIRED discount; missing: approval-required discounts, comp authority PD-N7, combinations) | DiscountApproval, ComplimentaryOrder, ApprovalRequirement[ORDER_DISCOUNT] |
| C6 | Service charge | pricing (quote) | L2 | SUBSET (accepted service calculations; missing: activation policy values, ETA mapping) | ServiceCharge (+ ETA T9/T17 mapping, OD-EG) |
| D1 | Confirm, pay, split tender, complete | Order.Confirm/Complete, Payment.Capture/GetSettlement | L1 | ACCEPTED + CR | TenderMethod, SplitTender, CollectionScope, OrderCompletion |
| D2 | Refunds | Refund.* | L1 | ACCEPTED | RefundMethod, ApprovalRequirement[REFUND_APPROVE] |
| D3 | Tender correction | Payment.CorrectTender | L2 | TODO | ApprovalRequirement[TENDER_CORRECTION] |
| E1 | Shift and drawer: open, X, close, Z, variance | Session.* | L1 | ACCEPTED + CR (close) | BlindClose, VarianceApproval, SessionDuration, BusinessDate |
| E2 | Cash moves, no-sale | Cash.Move, Drawer.OpenNoSale | L2 | SUBSET (Cash.Move accepted; missing: no-sale, CASH_MOVE approval wiring) | ApprovalRequirement[CASH_MOVE, DRAWER_NO_SALE] |
| F1 | Receipt and Egyptian e-receipt (ETA) | compliance adapter EG_ETA: FiscalProfile, FiscalDevice, FiscalItemMapping, order-completed, SubmitDocument, ReissueDocument | L2 | SPEC (E-40, domain-line 3.7.0; OD-EG-1..7 accountant defaults in docs/19 §7) | FiscalDocumentPolicy (OFF/SANDBOX/PRODUCTION) |
| F2 | Printing (receipt, kitchen chit) | Print.* | L2 | TODO (NP-D-L2-10) | print routing (data); a print failure never blocks a sale |
| F3 | Card batch reconciliation | — | L2 | TODO (NP-D-L2-11) | variance approval by policy |
| G1 | Operator reports | Report.Run | L2 | TODO (NP-D-L2-13) | report scopes by role |
| G2 | Ops and security: deploy, backup, monitoring | — | L2 | TODO (NP-D-L2-14, NP-B-L2-07/08) | RPO/RTO as configuration |
| H1 | Find and reopen checks; recover after a lost response or an app restart | Order.Find/Get, adapter exact-intent and UNKNOWN outcome (docs/13) | L1 | ACCEPTED reads · SPEC operator journey (legacy orders modal, S0) | — |
| H2 | Refund commercial intent: returned item, credit, tax effect | Refund.* (money payout only today) | L2 | DECISION GATE: a cash payout proves money, not a physical return or a fiscal credit note | ETA credit note with F1 |

## 3. The LEGO rule: every business choice is a policy

**Rule.** A choice that one restaurant would make differently from another is never a hidden `if` in code and never a silent fallback. It is explicit in one of three forms:
- a **typed scoped policy**;
- **owner-controlled data** (routing rules, prices, reason codes);
- a **separately implemented capability**, when the variation needs new behaviour that no policy value can create.

An unsupported variation is rejected clearly. Engineering constraints are not cashier options and get no switch: paging and storage bounds, CAS, lock order, deterministic tie-breaks. No speculative switch is added for every imaginable future variation. A policy has:
- an `IMPLEMENTATION_DEFAULT`;
- declared scopes (tenant, branch, channel, terminal);
- resolution inside the command transaction;
- history;
- fail-closed handling of an invalid row.

Whether something needs a manager's approval is never coded either. It is an **approval action** governed by `ApprovalRequirementPolicy` (ALWAYS, NEVER, ABOVE_THRESHOLD or WHEN_TRUE on a declared context field). Policies change only through `Settings.UpdatePolicy`, itself governed by `ApprovalRequirement[SENSITIVE_POLICY_CHANGE]`.

### Policy registry (CORE)

| Policy | Decides | Default | Owner | State |
|---|---|---|---|---|
| FloorIntakePolicy | waiter creates checks without a drawer, per channel | SESSION_REQUIRED (demo: DINE_IN floor) | orders | DOMAIN @2 |
| FireTimingPolicy | explicit rounds vs fire on confirm, per channel | canonical | orders | DOMAIN @2 |
| CheckCompositionPolicy | several checks per visit | canonical | orders | DOMAIN @2 |
| CollectionScopePolicy | which drawer collects a floor check | canonical | payments | DOMAIN @2 |
| OrderNumberPolicy | number format | width 4, no prefix | orders | canonical |
| PricingOrderPolicy | discount before or after tax | none (must be set) | pricing | canonical |
| OrderConfirmationPricingPolicy | captured pricing profile per channel | none (must be set) | pricing | canonical |
| RoundingPolicy | rounding mode and scale | HALF_UP, 2 | taxes | canonical |
| ServiceChargePolicy | service charge per channel, taxable | none | pricing | canonical |
| DiscountApprovalPolicy / ComplimentaryOrderPolicy | discount threshold, comp shape | 10 %, full comp | pricing / orders | canonical (L2) |
| TenderMethodPolicy | enabled tenders and labels | CASH, CARD | payments | canonical |
| SplitTenderPolicy | several tenders per check | true | payments | canonical |
| RefundMethodPolicy | refund to another tender | DENY | refunds | canonical |
| OrderCompletionPolicy | completion rule | none | orders | canonical |
| LineVoidDispositionPolicy | waste vs not prepared | by kitchen start | orders | canonical |
| BlindClosePolicy / VarianceApprovalPolicy / SessionDurationPolicy | drawer count rules | blind, 0.00, 24 h | sessions | canonical |
| BusinessDatePolicy | business-day cutoff | branch calendar | platform | canonical |
| ApprovalRequirementPolicy | which actions need a manager, and when | per action default rule | approvals | canonical |
| SelfApprovalPolicy / ApprovalTtlPolicy | self-approval, grant lifetime | DENY (PD-V4-02), 120 s | approvals | canonical |
| LoginLockoutPolicy / AuthSessionPolicy / CredentialPolicy | login security | 5 tries / 15 min, 12 h, 10-char / 6-digit PIN | access | canonical |
| **NewProductAvailabilityPolicy** | a new product is on the menu of the creating branch at once, or only after explicit activation per branch | EXPLICIT_PER_BRANCH | catalog | **add with B1** |
| **AvailabilityReasonPolicy** | reason required for SOLD_OUT / BLOCKED | SOLD_OUT optional, BLOCKED required | catalog | **add with B1** |
| **ProductTaxDefaultPolicy** | default tax policy for new products; choosing another one needs `tax:manage` | none (then the tax is chosen per product) | catalog | **add with B1** |
| **FiscalDocumentPolicy** | e-receipt mode per branch: OFF, SANDBOX or PRODUCTION; which channels | OFF | compliance | **add with F1** |
| **SkuGenerationPolicy** | sku typed by the manager, or generated (prefix + sequence) when left empty | MANUAL (Egypt profile: AUTO_IF_EMPTY, section 8) | catalog | **add with B1** (section 7) |
| **ProductNameUniquenessPolicy** | duplicate product names: ALLOW, WARN or BLOCK (per locale) | BLOCK (legacy allowDuplicateNames=false) | catalog | **add with B1** |
| **VisitAutoClosePolicy** | free the table when its last check completes, or only when the waiter closes it | ON_LAST_CHECK_COMPLETED (legacy autoReleaseAfterPayment=true) | tables | **SPEC (E-37, domain-line 3.3.0)** |
| **KitchenTimingPolicy** | target preparation minutes and late-ticket alert, per station | 15 min (legacy defaultPrepTime) | kitchen | **add with C3 (L2)** |
| **CashRoundingPolicy** | round the cash amount due to an increment (0.05, 0.25, 0.50); the difference is a reported rounding component; card is never rounded | OFF | payments | **add with D1** |
| **DiscountStackingPolicy** | several discounts on one check; automatic promotions | NO_STACKING, no auto-apply | pricing | **add with C5** |

### Approval actions (CORE)

The canonical actions are LINE_VOID, ORDER_VOID, ORDER_DISCOUNT, REFUND_APPROVE, SESSION_VARIANCE, CASH_MOVE, DRAWER_NO_SALE, TENDER_CORRECTION, SENSITIVE_POLICY_CHANGE, USER_ACCESS_CHANGE, CREDENTIAL_RESET and PRICE_OVERRIDE.

CORE adds two, both with default rule **NEVER** so the owner opts in:

| Action | Governs | Context fields |
|---|---|---|
| **PRICE_CHANGE** | Catalog.SetPrice | productId, branchId, channel, effectiveFrom, basisRuleId/Version, oldAmount, newAmount, changePercent (magnitude), firstPrice, decrease |
| **PRODUCT_TAX_CHANGE** | Product.SetTaxPolicy | productId, productVersion, oldTaxPolicyId, newTaxPolicyId |

Ratified by E-36 (domain-line 3.2.0): the basis is the replaced window and its version; a first price or a zero old price gives a null percent, which fails closed under a threshold; the currency is always the branch currency. SENSITIVE_POLICY_CHANGE issuance is open for the taxes scope; the settings scope opens with W4.

**Current scope restrictions** (recorded as scope, not as proven whole-product decisions):
- one OPEN visit per table;
- the visit's server is the opener;
- Visit.Close refuses while a check is open (E-37); automatic close follows VisitAutoClosePolicy (tables.order-ended consumer);
- no implicit default station (the catch-all is an explicit rule);
- Payment.Capture is CASH-only and bound to the origin session until its reviewed change request ships;
- void issuance needs an independent manager and a restricted line commercial basis (E-25);
- reason text is opaque, at most 200 characters, until managed reason codes (B4).

Kitchen routing keeps the reviewed consumer rule: all match fields in conjunction, numeric priority then id, and an active destination station.

**Adapter rule (E-40):** country-specific fiscal and device data lives in the adapter module that needs it (compliance, printing), never in catalog, orders, pricing or organization records.

## 4. Fixed invariants (never policies)

| Invariant | Why it cannot be a choice |
|---|---|
| Money is decimal(19,4), quantity decimal(19,6); no float | totals, tax and the ETA document must reproduce to the piaster |
| Committed history is immutable; financial records are never deleted (archive = `active=false`) | audit, Z reports and fiscal documents point at them |
| Historical snapshots and an issued receipt are immutable; any change a line allows is made by a documented command under its contract, keeping the previous history. Catalog, price and tax edits apply to new quotes only | wording agreed with BUILD (2026-10-25); a check must not change silently after the guest saw it |
| Business date is resolved by the server per command | shifts and reports must agree across devices |
| Authorization precedes every read and write; branch and terminal scope are enforced | data of another branch is never revealed |
| Idempotency, CAS, history, audit and outbox live in the command transaction | retries never double-charge or double-fire |
| Approval grants are bound to the exact context, expire, and are consumed once | an approval cannot be reused for another amount |
| SKU is unique for the business, archived products included; a product's unit is fixed; a unit's precision freezes once used (current guarded identity; a later explicit conversion or versioned variant would be its own reviewed capability) | receipts, ETA item codes and reports must stay unambiguous over time |
| One currency per business; modifier and price currency come from the branch context | no silent conversion |
| Hardware or fiscal-transmission failure never undoes committed business truth | the failure is queued, retried and alerted. **Whether issuing may continue during a fiscal outage** is a jurisdiction- and provider-specific decision (F1), not assumed here |

## 5. Registering new approval actions

**No compiler or runtime blocker exists:**
- canonical approval-action metadata, context contract and decimal paths already generate approval contracts (`tools/compiler/emit.mjs`);
- R-08 materialised its actions owner-side with compiler 0.6.17 unchanged.

**First path:** a reviewed owner operation with a typed context, plus a protected `Approval.Grant` change request, registered through the existing authored materialiser (as R-08 did).

**Later, optional:** an `approval_action` fragment kind, a separate additive authoring improvement.

**`ANY_OF` rules** (e.g. discount percent OR amount) belong in the approval owner's evaluator and typed policy contract, and only once the real scenario is ratified. They must keep three properties:
- existing atomic rules unchanged;
- exact Decimal comparison;
- every operand validated before evaluation.

Two legacy display fields do not prove OR semantics.

## 6. Order of work to the sellable pilot

1. **L1, BUILD critical path:** R-04 → R-05 → R-06 → R-07 → R-09 → R-10 → R-11/12, then NP-R-16 runs J-R1..J-R4. In parallel, EXPERIENCE restarts on the legacy UI once tables and menu land.
2. **L2 DOMAIN, in this order:**
   1. B1 menu admin;
   2. §5 approval actions PRICE_CHANGE / PRODUCT_TAX_CHANGE (owner-operation path);
   3. B2 prices;
   4. B3 taxes;
   5. B4 settings and reason codes;
   6. F1 receipt and ETA (with the accountant's answers to OD-EG);
   7. F2 printing;
   8. G1 reports;
   9. C5/C6 discounts and service charge;
   10. E2 cash moves;
   11. A2 users;
   12. F3 reconciliation;
   13. G2 ops.

   Each slice ships with its policies in the registry above, never with a hardcoded choice.
3. **L2 BUILD** implements the slices in the same order after L1.
4. **Pilot day (OPS-PILOT):** one real Egyptian restaurant on the demo-free configuration.

## 7. Consolidation: legacy settings, legacy forms and Codex's audit (2026-10-25)

**Sources:**
- the legacy settings forms (`frontend/src/widgets/settings/*`, `settings.types.ts`);
- the module defaults (`backend/src/modules/settings/settings.service.ts`);
- the product editor (`widgets/catalog/ui/product-editor-form.tsx`), all at the pinned legacy object `6c87725`;
- Codex's executable-truth audit (`12_SETTINGS_ENFORCEMENT_MAP`, `22_FAKE_OPTIONALITY`);
- Codex's independent analysis (`MULTI_MODEL_ANALYSIS/CODEX`, 70 findings, 29 needing external validation).

**Principle:** the legacy forms tell us what an operator expects to configure; the new backend decides how.

Codex measured the legacy enforcement of 208 setting keys:

| Legacy enforcement | Keys |
|---|---|
| server-enforced | 20 |
| stored but never enforced | 102 |
| enforced only in the browser | 30 |
| display-only | 18 |
| unknown | 38 |

The legacy manager-threshold form (discount, refund, variance, void after kitchen start) was **display-only**. In the new backend every knob below is resolved **on the server, inside the command transaction**. A knob that is not enforced on the server does not exist.

### 7.1 Legacy settings → new backend

| Legacy setting (form) | Legacy enforcement | New backend | Capability |
|---|---|---|---|
| store name AR/EN, legal name AR/EN, tax number, address AR/EN, phone, logo | mostly stored-not-enforced | organization Business/Branch fields, used by the receipt and the ETA issuer block | F1 (data) |
| receipt footer AR/EN | display-only | receipt template data per branch | F1/F2 (data) |
| currency, decimal places | client-only | one business currency (invariant); display scale per currency | invariant |
| timezone, business-date cutoff | client-only | branch calendar + BusinessDatePolicy | E1 |
| service charge rate | client-only | ServiceChargePolicy per channel | C6 |
| default tax | unknown | ProductTaxDefaultPolicy | B1 |
| tax %, tax base after discount, rounding HALF_UP/BANKERS | partly server | TaxPolicy rate + PricingOrderPolicy + RoundingPolicy (HALF_UP, HALF_EVEN, DOWN) | B3 |
| manager threshold: discount % and amount | display-only | ApprovalRequirement[ORDER_DISCOUNT]; **both thresholds need an ANY_OF rule** (7.4 #1) | C5 |
| manager threshold: refund amount | display-only | ApprovalRequirement[REFUND_APPROVE] ABOVE_THRESHOLD on `amount` | D2 |
| manager threshold: cash variance | display-only | ApprovalRequirement[SESSION_VARIANCE] ABOVE_THRESHOLD on `absVariance` | E1 |
| manager for void after kitchen start | display-only | ApprovalRequirement[LINE_VOID] **ALWAYS** for a fired line (reviewed Grant@3 / E-25: Orders cannot observe kitchen start). A WHEN_TRUE kitchenStarted rule needs a kitchen fact port first | C4 |
| active payment methods, default method | client-only | TenderMethodPolicy (enabled, labels, order) | D1 |
| split payments | client-only | SplitTenderPolicy | D1 |
| partial payment | client-only | partial captures allowed; completion needs settlement (OrderCompletionPolicy) | D1 |
| cash drawer required to open shift; opening balance | client/display | terminal drawer flag + Session.Open float; FloorIntakePolicy for drawerless terminals | E1 |
| enable rounding, rounding precision 0.05 | configured intent; execution unproven (only interfaces and defaults exist) | **CashRoundingPolicy** (7.4 #2) | D1 |
| enable tips | stored | **owner decision** (7.4 #3) | D1 |
| sessions: auto-close time, variance threshold, blind count | partly server | SessionDurationPolicy, VarianceApprovalPolicy, BlindClosePolicy | E1 |
| discounts: max without approval, auto-apply promotions, stacking | partly server | ApprovalRequirement[ORDER_DISCOUNT], **DiscountStackingPolicy** | C5 |
| kitchen: auto route, default station | server | routing rules + catch-all rule (data, E-14) | C3 |
| kitchen: ticket print on confirm | unknown | FireTimingPolicy + print routing | C3/F2 |
| kitchen: prep time, bump timeout | server/unknown | **KitchenTimingPolicy** | C3 |
| kitchen: notification sound | stored | device preference (not a business choice) | EXPERIENCE |
| tables: auto release after payment | stored | **VisitAutoClosePolicy** | C1 |
| tables: waiter assignment | stored | TableVisit.AssignServer (NP-D-L2-05) | C1 |
| tables: reservation duration | stored | reservations: not CORE | L3 |
| products: SKU prefix, auto SKU | stored | **SkuGenerationPolicy** | B1 |
| products: allow duplicate names | stored | **ProductNameUniquenessPolicy** | B1 |
| compliance: ETA enabled, ZATCA enabled, auto submit | server | **FiscalDocumentPolicy** (EG_ETA now; KSA later as a value) | F1 |
| audit: retention days, log all, mask sensitive fields | stored | retention = ops configuration (G2); logging and masking are invariants | G2 / invariant |
| terminal printer IP, drawer IP | unknown | terminal device configuration | F2 (data) |
| inventory, loyalty, delivery, customers settings | various | not CORE (L3 seams) | L3 |

### 7.2 Legacy product editor → new catalog

| Legacy field | New backend |
|---|---|
| nameAr, nameEn | `name` LocalizedText (B1) |
| sku | `sku`, unique (B1); generation by SkuGenerationPolicy |
| category, quick category create | `categoryId`; Category.Create (B1) |
| unitOfMeasure | `unitId` (B1) |
| sellingPrice | Catalog.SetPrice per branch and channel, with effective dates (B2): a price is not a product field |
| taxable, taxCategory | `taxPolicyId` + ProductTaxDefaultPolicy; Product.SetTaxPolicy (B1) |
| modifierGroups, hasModifiers | Product.SetModifierGroups (B1) |
| isActive | `active` (archive) (B1) |
| kitchenStation, requiresKitchenPrep | routing rules by product/category/channel; **a NO_TICKET target for items without preparation** (7.4 #4) |
| preparationTime | KitchenTimingPolicy per station; a per-product override only if the owner asks |
| imageUrl, colorCode, descriptionAr/En | **menu display attributes** needed for legacy UI parity (7.4 #5) |
| barcode | Variant.barcode (BARCODE_TAKEN exists): not CORE for restaurants |
| costPrice, trackInventory, allowNegativeStock, replenishmentMethod | inventory and costing: L3 seam |
| incomeAccountId, expenseAccountId | accounting export: L3 |
| customFields | not adopted (no free JSON truth) |

### 7.3 Codex's open questions → where CORE answers them

| Codex finding | Question | CORE answer |
|---|---|---|
| 002 | discount before tax and rounding: universal or configurable? | configurable: PricingOrderPolicy, RoundingPolicy |
| 007, 041 | is fail-open audit acceptable? | no: audit is in the command transaction (invariant) |
| 012 | who owns refund thresholds; by branch, role, amount? | ApprovalRequirement[REFUND_APPROVE] by amount; scopes tenant/branch; approver by permission |
| 016, 051 | timezone, business day, branch scope of reports | BusinessDatePolicy + branch calendar; reports scoped by branch and business date (G1) |
| 028 | is fallback routing acceptable? | only as an explicit catch-all rule (data), never an implicit fallback |
| 050 | ETA numbering and chain | F1 with the accountant (OD-EG); chain per POS as in docs/19 |
| 053, 054 | tender measures; Z vs daily | gross captured, refunded and net collected named separately (docs/15); the daily report reconciles to Z (G1) |
| 001 | variants and unit conversion needed? | not for the CORE restaurant; Variant stays a seam |
| 018..027, 033..036 | inventory, purchasing, recipes, loyalty, credit | not CORE (L3) |
| 037, 040, 060 | production auth and credential policy | G2 security with CredentialPolicy and AuthSessionPolicy |

### 7.4 New CORE items from the consolidation (DOMAIN owns the spec)

| # | Item | Resolution | Slice |
|---|---|---|---|
| 1 | Discount approval may need **% or amount** | `ANY_OF` in the approval owner, only after the scenario is ratified (section 5) | C5 |
| 2 | **Cash rounding** is absent from canonical | CashRoundingPolicy, CASH only. The adjustment is a named Payments/settlement reconciliation component. It never rewrites the invoice (Pricing rounding stays commercial rounding) and never pretends cash was received. **Decide before schema:** the basis (whole invoice or final cash remainder), mixed and partial tenders, direction on refunds, and fiscal representation | D1 (L2) |
| 3 | **Tips** (legacy enableTips) vs docs/15 "no tips exist" | TipPolicy with a clean seam: a tip is a separate component outside sales, paid out per shift. **Its tax treatment is jurisdiction-dependent** and needs specialist evidence. Egypt profile value OFF (section 8) | D1 |
| 4 | Products that need **no kitchen ticket** (bottled drinks) would hit the catch-all station | a reviewed **typed destination** on RoutingRule (station or NO_TICKET): storage, API and consumer extension, never a magic station id or a silent miss. Explicit NO_TICKET is distinct from an unmatched or inactive configuration. It keeps the source line and the rule/version suppression evidence. Behaviour must be defined for all-suppressed and mixed rounds, replay, and the remaining fulfilment obligation. It never implies prepared, handed over, stock-consumed or commercially complete. No extra producer event (the delivery worker commits effect + receipt) | C3 (before the pilot) |
| 5 | **Product image** is passed to the legacy POS tile (`product-grid.tsx` → `ProductCard.imageUrl`, optional) | catalog display attribute **imageUrl** (optional) via a change request to catalog.Product. colorCode and description are optional editor intent, not required by the tile. Availability or preparation indicators need real owner facts, never display fields | B1 addition |
| 6 | Receipt identity (store and legal names, tax number, address, footer) | organization data used by F1/F2; verify the Business/Branch fields against the ETA issuer block | F1 |
| 7 | Every legacy display-only threshold | becomes a server-resolved approval rule. EXPERIENCE shows the value from `Settings.Effective`, never a local copy | B4 |


## 8. Market profile: Egypt (owner directive 2026-10-25)

**Rule:** an open business decision never blocks work and never becomes code. It works like this:

- DOMAIN sets the **Egyptian-market best practice** as the value of the policy in the **EG market profile**, labelled `MARKET_CONVENTION`.
- The profile is data, applied when a restaurant is provisioned (through `Settings.UpdatePolicy`).
- Each value carries the question for the owner's domain expert.
- When the expert answers, only the data changes; the backend does not.

**Two layers:**
- the **canonical default**: the safest value, used when nothing is configured;
- the **profile value**: the practical value a new Egyptian restaurant starts with.

Every value can be changed later under `SENSITIVE_POLICY_CHANGE`.

The confidence column is DOMAIN's own estimate of market practice. It is not a legal opinion. Every MEDIUM or LOW row, and every tax or fiscal row, must be confirmed by the expert or the accountant before the pilot.

| Policy | EG profile value | Canonical default | Confidence | Question for the expert / accountant |
|---|---|---|---|---|
| TaxPolicy (VAT) | 14 %, EXCLUSIVE, HALF_UP 2 | (data) | HIGH for 14 % | Are any menu items exempt or at another rate? Should prices show tax-inclusive on takeaway? |
| ServiceChargePolicy | DINE_IN 12 %, taxable; TAKEAWAY none | none | MEDIUM | Is 12 % on dine-in the norm for this restaurant class? Is VAT computed on the service charge? Which ETA tax type (T9 or T17, OD-EG)? |
| TipPolicy | OFF (tips stay outside the POS; the seam exists) | OFF | MEDIUM | Do waiters receive card tips through the POS? If yes: pooled or per waiter, paid out per shift? |
| CashRoundingPolicy | CASH to nearest 0.25 EGP, HALF_UP; card never rounded | OFF | LOW | Common increment in practice (0.25 or 0.50)? How is a rounding difference shown on the ETA receipt? |
| TenderMethodPolicy | CASH, CARD, DIGITAL_WALLET (wallet and InstaPay recorded with a reference, like card) | CASH, CARD | MEDIUM | Which wallets and transfers must appear separately in the Z report? |
| PricingOrderPolicy | DISCOUNT_BEFORE_TAX | none | MEDIUM | Confirm discounts reduce the VAT base. |
| RoundingPolicy | HALF_UP, 2 | HALF_UP, 2 | MEDIUM | HALF_UP vs HALF_EVEN for ETA line totals. |
| BusinessDatePolicy | branch cutoff 04:00 | branch calendar | HIGH (late-closing restaurants) | Does the restaurant close after midnight? |
| ApprovalRequirement[ORDER_DISCOUNT] | ANY_OF (percent > 10, amount > 100 EGP) | percent > 10 | MEDIUM | Thresholds per role? |
| ApprovalRequirement[LINE_VOID] | ALWAYS for a fired line (E-25) | ALWAYS | HIGH | Approval also before the kitchen starts? (needs a kitchen fact port) |
| ApprovalRequirement[ORDER_VOID], [REFUND_APPROVE] | ALWAYS | ALWAYS | HIGH | Refund approval only above an amount? |
| ApprovalRequirement[SESSION_VARIANCE] | ABOVE_THRESHOLD 10.00 EGP | 0.00 | MEDIUM | Tolerated drawer difference? |
| BlindClosePolicy | true | true | HIGH | — |
| VisitAutoClosePolicy | ON_LAST_CHECK_COMPLETED | MANUAL | MEDIUM | Do guests often order again after paying? |
| NewProductAvailabilityPolicy | CREATING_BRANCH | EXPLICIT_PER_BRANCH | HIGH (single-branch pilot) | — |
| SkuGenerationPolicy | AUTO_IF_EMPTY, prefix by category | MANUAL | HIGH | — |
| ProductNameUniquenessPolicy | BLOCK per locale | BLOCK | HIGH | — |
| AvailabilityReasonPolicy | SOLD_OUT optional, BLOCKED required | same | HIGH | — |
| KitchenTimingPolicy | 15 min target, alert at 20 | 15 | MEDIUM | Per station (grill vs bar)? |
| FiscalDocumentPolicy | EG_ETA, SANDBOX until certified, then PRODUCTION; all channels | OFF | HIGH (ETA B2C rollout) | Registration status of the pilot restaurant (OD-EG-1..7); may receipts be issued during an outage and submitted later within the window? |
| Receipt | bilingual AR/EN; EGP; 2 display decimals | (data) | HIGH | — |

**Deliverable:** with B4, the profile becomes the data file `spec/blueprint/v1/market/EG.profile.json`, checked like the demo data:
- every key is a registered policy;
- every value is allowed;
- every row carries its confidence and question.

Provisioning applies it through `Settings.UpdatePolicy`. KSA later is another profile file, not code.
