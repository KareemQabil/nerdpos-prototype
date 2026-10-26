# 25. Service charge (W6, NP-D-L2-12, CORE C6)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w6-service-charge`, base `agent/claude/domain-line` @ `f7835a2d`.

**Outputs:**
- No fragment. The task allows a refined `ServiceChargePolicy` fragment only with DOMAIN's agreement.
- `reference-tools/author_worker_w6.py` writes `requests/WORKER-to-DOMAIN-W6-SERVICE-CHARGE.json`, which carries the proposed fragment verbatim.
- Simulated in a scratch tree, that fragment validates: 143 fragments, 0 ERROR, online 0 WARNING, selftest 45/0 (RUN_LOG).

## 1. What the accepted runtime already does (`6f5bfe2`)

| Fact | Source |
|---|---|
| Shape `{byChannel: partial map OrderChannel → rate 0..100 (scale 6), taxable}`. An absent channel captures `NO_SERVICE_CHARGE` with `rateOrigin CHANNEL_ABSENT`. | `modules/pricing/src/service-policy.ts` |
| **Activation:** ServiceChargePolicy is read only when `OrderConfirmationPricingPolicy` is `{mode: CAPTURED_BASE_SERVICE_POLICY, channels: [...]}` and lists the order channel. Otherwise there is no service. | `modules/pricing/src/persistence/service-policy.ts` |
| **Freeze:** the policy (rate, taxable, id, version, scope) is captured once per order at its first ACTIVE participation. No recapture or backfill. | canonical note PD-N7-SERVICE-CHARGE-POLICY-FREEZE |
| **Amount:** `service = round(raw pre-discount ACTIVE items × rate / 100)` with the captured commercial rounding. | `modules/pricing/src/service-discount.ts` (RU013) |
| **Discount:** an ORDER_WIDE BEFORE_TAX discount reduces items and service proportionally. The original service is not recalculated. | canonical OrderConfirmationPricingPolicy note (PD-N7-SERVICE-CHARGE-DISCOUNT-ELIGIBILITY) |
| **Supported today:** taxable, homogeneous EXCLUSIVE carts only. `taxable: false` with a positive rate, mixed tax, or inclusive gives `CAPABILITY_NOT_AVAILABLE`. | `modules/pricing/src/service-policy-cart.ts` |
| Service is a commercial component, never an order line. | `service-discount.ts` |

## 2. Activation for a restaurant (data only, no code)

| Setting | Value (EG profile) |
|---|---|
| `OrderConfirmationPricingPolicy` | `{mode: CAPTURED_BASE_SERVICE_POLICY, channels: [DINE_IN, TAKEAWAY]}` |
| `ServiceChargePolicy` | `{byChannel: {DINE_IN: "12"}, taxable: true}`. TAKEAWAY has no rate, so it captures NO_SERVICE_CHARGE. |

`OrderConfirmationPricingPolicy` was missing from the W5 profile. It is now added there as a follow-up commit on `agent/opus/w5-eg-profile`: without it the 12 % would never apply.

## 3. Proposed refinement (request item 1)

The proposal keeps the canonical shape and default. It adds:
- `scope_dimensions` tenant and branch;
- `persisted_shape` CHANNEL_MAP;
- `status OPEN_DECISION`;
- the activation rule in the note;
- a **write guard**: `Settings.UpdatePolicy` refuses `taxable: false` with a positive rate (`VALIDATION_FAILED`) until a non-taxable service capability exists. This keeps a setting from being accepted and then failing at the first order.

## 4. How it appears

| Where | Display |
|---|---|
| Menu tile, `Pricing.QuoteItem` | Item price only, never service (docs/18). |
| Cart preview (`Order.Get item.cartPreview`) | Items subtotal; `Service 12 %` with its amount; VAT (on items + service when taxable); total. All from the server. |
| Receipt (F1/F2) | Its own component line `Service 12 % / خدمة 12 %` between the item subtotal and VAT. Never an order line, never inside an item price. |
| e-receipt | Mapping is **OPEN_DECISION** (OD-EG): which tax type or fee code, and whether it is taxable. |
| Takeaway | No service line (NO_SERVICE_CHARGE). |

## 5. Business choices and open questions

| Item | Canonical default | EG profile | Label | Confidence | Question |
|---|---|---|---|---|---|
| Rate per channel | none | DINE_IN 12 %, TAKEAWAY none | MARKET_CONVENTION | MEDIUM | Is 12 % on dine-in the norm for this restaurant class? Any service on takeaway or delivery? |
| Taxable | true | true | OPEN_DECISION (accountant) | MEDIUM | Is VAT computed on the service charge? |
| e-receipt code | none | none | OPEN_DECISION (accountant, OD-EG) | n/a | Which e-receipt tax type or fee code carries the service charge? |
| Legal nature | none | none | OPEN_DECISION (accountant / lawyer) | n/a | Is the service charge restaurant revenue or a staff entitlement distributed to employees? This decides whether reports show it inside sales or as a liability. |
| Base | pre-discount items (accepted RU013); a discount then reduces items and service proportionally | same | IMPLEMENTATION_DEFAULT (accepted) | n/a | Do you compute the service before or after a discount? A different base is a separate capability (BUILD). |

**Until the legal nature is answered, reports (W8) show service charge as its own measure and never inside net sales.**

## 6. Not CORE

- party-size or time-based service;
- non-taxable positive service (a capability, BUILD);
- service on inclusive-tax menus;
- service refunds as a separate fee refund (unavailable in the accepted runtime).
