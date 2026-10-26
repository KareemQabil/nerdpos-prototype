# 26. Discounts, comps and promotions: the pricing side (W7, CORE C5)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w7-discounts`, base `agent/claude/domain-line` @ `f7835a2d`.

**Fragments:** written by `reference-tools/author_worker_w7.py` (17 new files, all pricing).

## 1. Facts

| Fact | Source |
|---|---|
| `Order.ApplyDiscount` (orders, accepted) applies one ORDER_WIDE BEFORE_TAX FIXED_AMOUNT or PERCENTAGE discount under approval BY_POLICY `ORDER_DISCOUNT` (context `amount`, `discountPercent`, `kind`; default ABOVE_THRESHOLD `discountPercent` 10). | canonical |
| `DiscountApprovalPolicy` is SUPERSEDED by `ApprovalRequirementPolicy[ORDER_DISCOUNT]`. | canonical policies |
| `Order.Comp` is FULL_ORDER_COMP under `order:comp`, with no approval action (PD-N7-COMP-AUTHORITY). `ComplimentaryOrderPolicy` allows only `FULL_COMP_DISCOUNT_ZERO_TENDER`. | canonical |
| `Promotion.Upsert/Find/ValidateCode` are **PD_HELD** behind **PD-V4-11**. Options: A manual only; B coded promotions as discount instructions; C full engine. Default A, not ratified. No promotion record and no promotion permission exist. | canonical product_decisions |

## 2. Delivered (pricing only)

| Fragment | Purpose |
|---|---|
| `pricing/policy/DiscountStackingPolicy` | NO_STACKING (default, EG) \| PROMOTION_PLUS_MANUAL; `autoApply` (true refused at write until §5 exists) |
| `pricing/record/pricing.Promotion` | New record, rank 91, unique code (archived included) |
| `pricing/operation/Promotion.Create`, `Promotion.Configure` | Upsert split (server id, CAS, history). The kind and code are fixed after create. |
| `pricing/operation/Promotion.Find`, `Promotion.ValidateCode` | `replaces_existing`, same routes. The admin list, the AUTOMATIC offers valid now, and code check. Codes are hidden from cashiers. |
| `pricing/operation/pricing.ResolvePromotion` | Port: re-validates inside the order transaction and returns the instruction (with `promotionVersion`) to store |
| `pricing/operation/pricing.EvaluateDiscountStack` | Port: enforces DiscountStackingPolicy |
| views | `PromotionView`, `PromotionSchedule`, `PromotionDiscountInstruction`, `DiscountStackDecision` |
| errors | `PROMOTION_NOT_FOUND`, `PROMOTION_CODE_INVALID`, `PROMOTION_NOT_APPLICABLE`, `PROMOTION_CODE_TAKEN`, `DISCOUNT_STACKING_NOT_ALLOWED` |

**Gate:** every promotion operation returns `CAPABILITY_NOT_AVAILABLE` until the owner ratifies PD-V4-11 option B or C. **Nothing is live before that.**

## 3. Promotions as data (option B)

| Field | Meaning |
|---|---|
| kind | CODED (the guest gives a code) or AUTOMATIC (offered by `Promotion.Find`, applied by the cashier) |
| benefit | PERCENTAGE (0 < v ≤ 100) or FIXED_AMOUNT (Money > 0), always ORDER_WIDE BEFORE_TAX. The money is computed by the accepted discount path. |
| limits | channels, branchIds (empty = all), validFrom/validTo, minSubtotal (on the raw eligible base, server-side) |
| time-based | `schedule {daysOfWeek, startLocalTime, endLocalTime}` in the branch timezone. `end < start` crosses midnight. For example: happy hour Thu–Fri 17:00–19:00. |
| history | Configure creates a new version. An applied discount keeps the `promotionVersion` it captured. |

**Not CORE:**
- item-targeted promotions (buy X get Y, category);
- usage caps and per-guest limits (they need a usage ledger);
- loyalty redemption (PD-V4-11 C).

## 4. Exact changes for the orders owner (DOMAIN; outside my modules)

**`Order.ApplyDiscount`, next version:**
1. Input gains `source: MANUAL | PROMOTION` (default MANUAL) and, for PROMOTION, exactly one of `promotionCode` or `promotionId`.
2. After the order locks, call `pricing.EvaluateDiscountStack(active sources of the order's active discounts, incoming source)`. A refusal gives `DISCOUNT_STACKING_NOT_ALLOWED`.
3. For PROMOTION, call `pricing.ResolvePromotion(promotionId|code, channel, branchId, rawSubtotal = the eligible raw base before discounts)`. Then use its `{kind, value}` as the discount request.
4. **Approval:**
   - MANUAL keeps `ApprovalRequirementPolicy[ORDER_DISCOUNT]` unchanged.
   - PROMOTION raises no ORDER_DISCOUNT action. The promotion was authorized when it was created, under the management permission (IMPLEMENTATION_DEFAULT; expert question in §6).
5. Reason: MANUAL calls `settings.AssertReasonCode(DISCOUNT, …)` (W4). For PROMOTION, the reason is `PROMOTION:<code or id>`.
6. Store `{source, promotionId, promotionVersion, stackOrder}` on the discount fact (orders record change).
7. Errors + `DISCOUNT_STACKING_NOT_ALLOWED`, `PROMOTION_CODE_INVALID`, `PROMOTION_NOT_APPLICABLE`, `PROMOTION_NOT_FOUND`, `CAPABILITY_NOT_AVAILABLE` (PD gate).

**`Order.Comp`:**
- Unchanged shape (FULL_ORDER_COMP).
- Add `settings.AssertReasonCode(COMP, …)`.
- Comp approval is decided by the owner. Proposal: register a new approval action `ORDER_COMP` (DOMAIN, owner-operation path, CORE §5), context {orderId, payable}, default rule ALWAYS. Until then the control is `order:comp`.

**PROMOTION_PLUS_MANUAL** needs Orders to hold two active discounts and pricing to apply them in `stackOrder`. That is a separate capability. Until it exists, `Settings.UpdatePolicy` should refuse that mode with `VALIDATION_FAILED`; DOMAIN decides whether the value stays listed.

## 5. Approval threshold "percent OR amount" (CORE §5, describe only)

The needed contract, in the approval owner (not implemented):

| Item | Contract |
|---|---|
| Rule | `{mode: ANY_OF, rules: [atomic rule, …]}`. Each atomic rule is an existing ALWAYS, NEVER, ABOVE_THRESHOLD or WHEN_TRUE rule. At most 4, no nesting. |
| Evaluation | Raise the action if any atomic rule raises it. Exact Decimal comparison. Every operand is validated first; a missing context field fails closed. |
| Compatibility | Existing atomic rules are unchanged. ANY_OF is only an additive mode value of `ApprovalRequirementPolicy`. |
| EG use | `ORDER_DISCOUNT: ANY_OF[discountPercent > 10, amount > 100.00]` (in the W5 profile as pending) |
| Grant binding | The grant is bound to the full context (amount and percent), as today |

**Automatic apply** (`autoApply true`) needs Orders to apply a promotion during `Order.AddLines`/`Confirm` from a pricing evaluation port. That is an orders capability, so the value is refused until it exists.

## 6. Business choices

| Item | Canonical default | EG profile | Label | Confidence | Question |
|---|---|---|---|---|---|
| PD-V4-11 scope | A (not ratified) | **B**: coded and scheduled promotions as discount instructions | MARKET_CONVENTION | MEDIUM | Do you run promo codes or happy hours? Loyalty points? |
| DiscountStackingPolicy | NO_STACKING, no auto-apply | same | MARKET_CONVENTION | MEDIUM | Can a guest combine a promotion with a manager discount? |
| Promotion discount needs ORDER_DISCOUNT approval | no | no | IMPLEMENTATION_DEFAULT | MEDIUM | Should a cashier need a manager to apply a promo code? |
| ApprovalRequirement[ORDER_DISCOUNT] | `discountPercent > 10` | ANY_OF (10 %, 100 EGP) once available | MARKET_CONVENTION | MEDIUM | Thresholds per role? |
| ORDER_COMP approval action | none (order:comp) | ALWAYS once registered | MARKET_CONVENTION | MEDIUM | Who may give a meal for free? |
| Code guessing | platform throttle | same | IMPLEMENTATION_DEFAULT | n/a | n/a |

## 7. Requests (channel)

1. PD-V4-11: the owner's ratification (B recommended). Everything here is gated on it.
2. A new permission `promotion:manage` (BUILD). `catalog:setprice` is used until then.
3. The `Order.ApplyDiscount` and `Order.Comp` bumps (§4).
4. An `ORDER_COMP` approval action and `ANY_OF` (approval owner, CORE §5).
