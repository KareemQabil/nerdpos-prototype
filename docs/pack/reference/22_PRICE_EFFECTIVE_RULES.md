# 22. Prices per branch and channel, with effective dates (W1, NP-D-L2-02, CORE B2)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w1-prices`, base `agent/claude/np-d-l2-worker-base` @ `87e03996`.

**Fragments:** written by `reference-tools/author_worker_w1.py` (12 new files, nothing edited).

## 1. Problem

| Fact | Source |
|---|---|
| `Catalog.SetPrice` binds `PriceRule.id = input.productId`, `version = 1`. A product could hold one price row only. | canonical `Catalog.SetPrice.write_plan` |
| Its input has no `branchId` or `channel`, although `pricing.PriceRule` requires both. | canonical input vs record |
| `amount.currency_source` is `context.currency`, which is not a blueprint context key. | canonical input |
| The accepted quote selects rows of (product, branch, channel) with `effectiveFrom <= now < effectiveTo\|null`. It needs **exactly one** row in the branch currency: 0 rows gives `PRICE_NOT_FOUND`, 2 rows gives `PRICING_POLICY_REJECTED`. | `modules/pricing/src/persistence/item-quote.ts`, `item-quote.ts` @ `6f5bfe2` |
| The table already has the index (product, branch, channel, effective_from) and `CHECK amount >= 0 AND effective_to > effective_from`. | migration `202610140010` |

So the writer must keep the windows of one (product, branch, channel) from ever overlapping. The quote is not changed (DOMAIN answer 2, 2026-10-25).

## 2. What is delivered

| Fragment | Purpose |
|---|---|
| `pricing/operation/Catalog.SetPrice` | AUTHORED slot, `replaces_existing`. Same route and permission (`PUT /catalog/products/{productId}/price`, `catalog:setprice`). Adds `branchId` and `channel`. |
| `pricing/operation/Product.PriceHistory` | AUTHORED slot, `replaces_existing`. Same route and permission (`GET …/price-history`, `product:read`). Branch and channel filters, bounded paging. |
| `pricing/change_request/pricing.PriceRule` | To BUILD: one row per window, a unique key, lock rank 89, branch access scope, the two legal updates, and an optional exclusion constraint. |
| `catalog/operation/catalog.LockProductForPricing` | Internal catalog-owned port. Locks the product `FOR NO KEY UPDATE` (rank 85) in the caller transaction, which serializes all price changes of one product. |
| `catalog/contract_type/ProductPricingReference` | `{id, active, version}` returned by the port. |
| `pricing/contract_type/PriceRuleView` | One window, with a derived `state` (SCHEDULED, CURRENT or ENDED). |
| `pricing/contract_type/CatalogSetPriceResult` | `REPLACE_UNACCEPTED`. Keeps the 3 canonical fields and adds `changeKind`, `rule` and `closedRule`. |
| `pricing/error/PRICE_SCHEDULE_CONFLICT` (409) | The window would overlap a later scheduled window, or would correct a started one. |
| `pricing/error/PRICE_ZERO_NOT_ALLOWED` (422) | Zero price under `ZeroPricePolicy = DENY`. |
| `pricing/error/PRICE_SCHEDULING_NOT_ALLOWED` (422) | Future start under `PriceSchedulingPolicy = IMMEDIATE_ONLY`. |
| `pricing/policy/ZeroPricePolicy` | Business choice: is a zero price allowed. |
| `pricing/policy/PriceSchedulingPolicy` | Business choice: may a manager schedule a future price. |

Reused errors: `CATALOG_PRODUCT_NOT_FOUND`, `ORGANIZATION_BRANCH_NOT_FOUND`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `CONCURRENCY_CONFLICT`.

## 3. The rule

**Notation.** A scope S is one (product, branch, channel). A window is the half-open interval `[effectiveFrom, effectiveTo)`; `effectiveTo = null` means open-ended. `now` is the server clock of the command. `F = effectiveFrom ?? now`. `T = effectiveTo` (optional).

**Invariants. These are engineering rules, not options:**

| # | Invariant |
|---|---|
| I1 | No backdating: `F >= now`. A past window could re-explain a line already captured. |
| I2 | The windows of S never overlap. |
| I3 | Once a window has started (`effectiveFrom <= now`), its amount never changes. Only its `effectiveTo` may be closed, to the start of a newer window. |
| I4 | No row is deleted. |
| I5 | The stored currency is the branch currency. `input.currency` must equal it (else `VALIDATION_FAILED`). |
| I6 | All price changes of one product are serialized by the product lock (85), then the rows of S are locked (89). The approval grant (99) comes last. |
| I7 | Bounds: amount from 0 to 999999999.9999 at scale 4, `F <= now + 366 days`, `T > F`. |

**Algorithm, over the locked rows of S:**

- **E** = the row whose `effectiveFrom == F`.
- **C** = the row that contains F (`from < F < to|∞`).
- **N** = the next row starting after F.

| Situation | Effect | changeKind |
|---|---|---|
| E exists and has not started (`E.from > now`); T absent or equal to `E.to` | `E.amount` is replaced, version+1, history. Nothing else changes. | CORRECTION |
| E exists and has started (only possible when F == now) | `PRICE_SCHEDULE_CONFLICT` | - |
| E exists, T differs from `E.to` | `PRICE_SCHEDULE_CONFLICT` | - |
| No E; `End = T ?? N.from ?? null`; N exists and End is null or `End > N.from` | `PRICE_SCHEDULE_CONFLICT` (names N) | - |
| No E; otherwise | C, if any, is closed at F (CAS). Insert `[F, End)`. | FIRST_PRICE if S had no earlier window, else CHANGE |

**Why I2 holds after every command:**
- The new window `[F, End)` starts at or after the closed end of C.
- It ends at or before N.
- Rows before C end at or before `C.from`.
- N and the rows after it are untouched.
- A correction changes no dates.

**Why I3 holds:** only a CORRECTION changes an amount, and only when `E.from > now`.

Since the windows never overlap, the quote at any instant t finds **zero or one** row of S.

## 4. Proof table: a quote at time t uses exactly one rule per (product, branch, channel)

Scope S = (P, branch B, DINE_IN). Times: `t0 < t1 < t2 < t3`. "now" is the command time.

| # | Before | Command | After | Quote at t → rule |
|---|---|---|---|---|
| 1 | nothing | 50 at now = t0 | R1 [t0, ∞) 50 | t < t0: none (`PRICE_NOT_FOUND`); t ≥ t0: R1 |
| 2 | R1 [t0, ∞) 50 | 55 at now = t1 | R1 [t0, t1) 50; R2 [t1, ∞) 55 | [t0, t1): R1; ≥ t1: R2 |
| 3 | R1 [t0, ∞) 50; now = t1 | 60 from t3 | R1 [t0, t3); R2 [t3, ∞) 60 | < t3: R1; ≥ t3: R2 |
| 4 | case 3 after; now = t2 < t3 | 55, no dates | R1 [t0, t2); R3 [t2, t3) 55; R2 [t3, ∞) 60 | [t0, t2): R1; [t2, t3): R3; ≥ t3: R2 |
| 5 | case 3 after; now = t2 | 55, T > t3 | unchanged | `PRICE_SCHEDULE_CONFLICT` (R2); quotes unchanged |
| 6 | case 3 after; now = t2 | 62 from t3 | R2 [t3, ∞) 62, v2 | ≥ t3: R2 (62); nothing started was changed |
| 7 | R1 [t0, ∞) 50; now = t1 | 70 from t2 to t3 | R1 [t0, t2); R4 [t2, t3) 70 | [t2, t3): R4; ≥ t3: none (an explicit end leaves a gap: `PRICE_NOT_FOUND`) |
| 8 | R1 [t0, ∞) 50 | 40 at t0 − 1 min | unchanged | `VALIDATION_FAILED` (I1) |
| 9 | two managers, same P, any branches | both at now | serialized by the lock (85); the second closes the first's window | exactly one at every t |
| 10 | R1 in branch B | 55 in branch A | R1 unchanged; A gets its own window | B: R1; A: the new window (scopes are independent) |
| 11 | R1 DINE_IN | 45 TAKEAWAY | R1 unchanged; new TAKEAWAY window | per channel, one row each |
| 12 | line captured at 50 under R1 | case 2 | line keeps 50.0000 (captured snapshot) | new quotes and lines: 55 |

Case 7 is the only way to get a gap, and it needs an explicit `effectiveTo`. A gap makes the product unsellable in that scope (`PRICE_NOT_FOUND`), which the admin screen must show before the command is sent. Temporary prices that should revert on their own belong to promotions (W7), not to price windows.

## 5. Business choices (LEGO rule)

| Policy | Values | Canonical default | EG profile value | Confidence | Question for the expert |
|---|---|---|---|---|---|
| ZeroPricePolicy (tenant, branch) | DENY, ALLOW | DENY (`IMPLEMENTATION_DEFAULT`: a zero is usually a typo) | ALLOW (`MARKET_CONVENTION`) | MEDIUM | Do you ring free items (bread, pickles, water, sauces) through the POS so they reach the kitchen ticket or the receipt? If not, keep DENY. |
| PriceSchedulingPolicy (tenant) | FUTURE_ALLOWED, IMMEDIATE_ONLY | FUTURE_ALLOWED (`IMPLEMENTATION_DEFAULT`) | FUTURE_ALLOWED (`MARKET_CONVENTION`) | HIGH (frequent menu repricing in Egypt, timed to the start of a business day) | Do you want managers to schedule price rises for the next business day, or only change prices immediately? |
| ApprovalRequirementPolicy[PRICE_CHANGE] | ALWAYS, NEVER, ABOVE_THRESHOLD on `changePercent`, WHEN_TRUE | NEVER (CORE §3) | NEVER (`MARKET_CONVENTION`; the permission `catalog:setprice` is the control) | MEDIUM | Should a price change above a percentage need a second manager? Which percentage? |

**Not options (engineering):**
- backdating forbidden;
- the 366-day horizon;
- paging bounds 50 / 200;
- the scheduling algorithm;
- lock order.

**Not CORE:** a price for all branches or all channels in one command. The admin screen sends one idempotent command per (branch, channel). A legacy single `sellingPrice` maps to DINE_IN and TAKEAWAY in each branch.

## 6. PRICE_CHANGE approval context (OPEN_DECISION `OD-CORE5-PRICE_CHANGE`)

`Catalog.SetPrice` keeps `approval_mode: NONE` until DOMAIN registers PRICE_CHANGE through the owner-operation path (CORE §5). The context the operation would expose:

| Field | Type | Value |
|---|---|---|
| productId | Ref<catalog.Product> | input |
| branchId | Ref<organization.Branch> | input |
| channel | OrderChannel | input |
| currency | CurrencyCode | branch currency |
| effectiveFrom | Timestamp | F |
| changeKind | FIRST_PRICE \| CHANGE \| CORRECTION | computed |
| oldAmount | Money \| null | C.amount (CHANGE), E.amount (CORRECTION), null (FIRST_PRICE) |
| newAmount | Money | input.amount |
| changePercent | Decimal(scale 4) \| null | `(new − old) / old × 100`, HALF_UP; null if old is null or 0 |

**Open points for the threshold scenario (CORE §3), to be ratified before issuance:**
- the basis is `changePercent` or the absolute difference;
- is a FIRST_PRICE ever governed;
- the old price is 0;
- binding the grant to `(scope, F, oldAmount, newAmount)`;
- grant lock 99 is taken last.

## 7. History

`Product.PriceHistory` returns the windows: SCHEDULED, CURRENT and ENDED. I3 makes this the complete history of the prices that were in force. Corrections of not-yet-started windows show as `version > 1`, and their before/after values are in the audit row (one per command).

**Branch scope:**
- a caller sees only branches it may access;
- a pinned context sees its branch only;
- an inaccessible `branchId` filter gives `PERMISSION_DENIED`.

## 8. Notes for BUILD

- The test gate is `tests/postgres/catalog-pricing-admin.test.ts` (to be written). The behaviour lists in both operations are the cases to cover, including replay and the two-writer race.
- `FOR NO KEY UPDATE` on the product keeps order-line FK inserts (`FOR KEY SHARE`) unblocked.
- The exclusion constraint is defence in depth (BUILD option, needs `btree_gist`). Correctness does not depend on it.
- The seed's one open window per scope already satisfies the new unique key.
