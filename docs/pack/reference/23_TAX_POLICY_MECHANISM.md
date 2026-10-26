# 23. Tax policy mechanism (W2, NP-D-L2-03, CORE B3)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w2-taxes`, base `87e03996`.

**Fragments:** written by `reference-tools/author_worker_w2.py` (10 new files).

**No legal rate is written as fact anywhere in this slice.** Rates are owner data.

## 1. Problem

| Fact | Source |
|---|---|
| `TaxPolicy.Upsert` is STRUCTURED: the client supplies the id; approval is BY_POLICY `SENSITIVE_POLICY_CHANGE`; there are no errors and no write plan. | canonical |
| `TaxPolicy.List` is a signature only (`List<TaxPolicyView>`, and the type does not exist). | canonical |
| `taxes.TaxPolicy` is accepted: {calculationMode, jurisdiction, rate, roundingMode, roundingScale, version}. It has no name, no active flag and no lock rank. | canonical, migration `202610140010` |
| The accepted tax port reads the current row with its version. The quote snapshot carries that version, so captured lines keep their tax. | `modules/taxes/src/persistence/policy-reference.ts` @ `6f5bfe2` |
| `rate` is a percent (the seed writes `"15"`), `Percentage` 0..100 at scale 6. | `fixtures/catalog-seed.ts`, canonical types |
| `SENSITIVE_POLICY_CHANGE`: context {policyId, oldValueHash, newValueHash}, default rule ALWAYS, **issuance_enabled false** ("close typed action context in its owning module"). | canonical approval_actions |

## 2. What is delivered

| Fragment | Purpose |
|---|---|
| `taxes/operation/TaxPolicy.Create` | `POST /tax-policies`, `tax:manage`. Server id. No approval (see §3). |
| `taxes/operation/TaxPolicy.Configure` | `PUT /tax-policies/{id}/configuration`, `tax:manage`. CAS, history, approval BY_POLICY `SENSITIVE_POLICY_CHANGE` with the typed context. |
| `taxes/operation/TaxPolicy.SetActive` | `PUT /tax-policies/{id}/active`. Archive or restore. An in-use policy cannot be archived. |
| `taxes/operation/TaxPolicy.List` | `replaces_existing`, same route and permission. Paged; archived policies hidden by default. |
| `taxes/change_request/taxes.TaxPolicy` | To BUILD: name, active, fiscalTaxType/fiscalSubtype, explicit lock rank 95, CHECKs. |
| `taxes/contract_type/TaxPolicyView` | The view the canonical names. |
| `taxes/error/TAX_POLICY_IN_USE`, `TAX_POLICY_ARCHIVED` | New, 409. |
| `catalog/operation/catalog.TaxPolicyUsage` + `catalog/contract_type/TaxPolicyUsage` | Internal catalog port: counts the products that use a policy (archived products included). |

## 3. Rules

| Rule | Why |
|---|---|
| Create needs no approval. | A new policy changes no price until a product maps to it. The mapping is governed: `tax:manage` now, PRODUCT_TAX_CHANGE once registered (CORE §5). Provisioning creates the VAT this way, so the pilot is not blocked by the disabled issuance. |
| Configure of a tax-relevant value needs `ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE]`. | Canonical action. The context is typed here (the issuance gate asks for it). |
| `oldValueHash` / `newValueHash` = sha256 hex of the RFC 8785 JCS of {calculationMode, jurisdiction, rate (scale 6), roundingMode, roundingScale, fiscalTaxType, fiscalSubtype}. | Deterministic. A name-only change raises no action. |
| `policyId` in the approval context = `"taxes.TaxPolicy:" + id`. | The action's target is `settings.PolicyValue`. The prefix keeps a tax-policy grant from ever matching a settings grant. |
| A rate change applies to quotes after commit. Captured lines keep their tax snapshot and policy version. | CORE invariant: a captured line keeps its price, tax and modifiers. |
| A policy is never deleted. Archive is `active=false`. Archiving fails with `TAX_POLICY_IN_USE` if any product (archived included) or `ProductTaxDefaultPolicy` uses it. | FK RESTRICT. Receipts and history point at it. |
| Lock order: catalog 83..88 < pricing.PriceRule 89 < taxes.TaxPolicy 95 < approvals 99. | Approvals last. |
| Bounds: rate 0..100 at scale 6; roundingScale 0..4; decimal strings only. | The accepted port rejects other scales. Floats are forbidden. |

**Race between archive and product mapping:**
- Configure and SetActive hold the policy row `FOR UPDATE`.
- Product writers take it `FOR SHARE` through `taxes.AssertTaxPolicy`.
- So either the product mapping lands first (then the archive is refused), or the archive lands first (then the mapping must be refused).

The second half needs **`taxes.AssertTaxPolicy@2`**, which refuses `active=false` with `TAX_POLICY_ARCHIVED`. That fragment is DOMAIN's, so it is requested (§7).

## 4. Approval issuance (OPEN_DECISION `OD-SENSITIVE_POLICY_CHANGE-ISSUANCE`)

The canonical issuance of `SENSITIVE_POLICY_CHANGE` is disabled until the typed context is closed in the owning module. This slice closes the **taxes side** of the context: the policyId prefix and the hash definition. Until DOMAIN/BUILD enable issuance:
- under the canonical default rule ALWAYS, `TaxPolicy.Configure` of a rate gives `APPROVAL_REQUIRED`;
- only that operation is affected. Create, SetActive, List and every quote work.

The EG profile does not need Configure to start: it creates the VAT policy.

## 5. Seams (data shape only; **OPEN_DECISION** with the accountant)

| Seam | Today | Shape that fits later without breaking `taxes.Calculate` | Question for the accountant |
|---|---|---|---|
| Several taxes on one line (for example a table tax plus VAT), parallel or compound | One policy = one component | `TaxPolicy.components: List<{code, rate, base: LINE_NET \| LINE_NET_PLUS_PRECEDING, fiscalTaxType, fiscalSubtype}>`. A single-component policy equals today's row. `taxes.Calculate` already returns `List<TaxComponent>`, and captured snapshots stay per component. | Does any menu item carry a second tax (table tax, other levies)? Is it computed on the net or on net plus VAT? |
| Tax-inclusive prices | `calculationMode` INCLUSIVE \| EXCLUSIVE per policy (the accepted quote supports INCLUSIVE) | none needed: a second policy with INCLUSIVE | Should takeaway menu prices be shown tax-inclusive? |
| Exempt vs zero-rated | `rate "0"` + `fiscalSubtype` | the subtype distinguishes them on the e-receipt | Are any items exempt (not just zero-rated) for this restaurant? |
| e-receipt tax type mapping | `fiscalTaxType` / `fiscalSubtype` optional Codes, no values supplied | owner/accountant data per policy (F1, OD-EG-1..7) | Which tax type and subtype codes apply to restaurant VAT and to the service charge? |
| A legal rate change at a future date | Configure applies at commit | a future `effectiveFrom` on the policy version (like price windows, docs/22) | Do you need to pre-schedule a legal rate change, or is changing it on the day enough? |

## 6. Business choices

| Item | Canonical default | EG profile value | Label | Confidence | Question for the expert / accountant |
|---|---|---|---|---|---|
| VAT policy data (rate, mode, rounding) | none (data) | 14 %, EXCLUSIVE, HALF_UP, scale 2 | MARKET_CONVENTION | HIGH for 14 % | Are any menu items exempt or at another rate? Tax-inclusive takeaway prices? |
| ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE] | ALWAYS | ALWAYS | IMPLEMENTATION_DEFAULT | HIGH | Should the owner alone approve tax changes? |
| Create needs no approval | n/a (engineering, §3) | n/a | IMPLEMENTATION_DEFAULT | n/a | n/a |
| RoundingPolicy | HALF_UP, 2 | HALF_UP, 2 | MARKET_CONVENTION | MEDIUM | HALF_UP vs HALF_EVEN for e-receipt line totals |

The EG profile row is data for W5 (`market/EG.profile.json`), applied at provisioning through `TaxPolicy.Create`. It is **not** a canonical default.

## 7. Requests to DOMAIN (in the channel)

1. **Supersede `TaxPolicy.Upsert`** by `TaxPolicy.Create`, `TaxPolicy.Configure` and `TaxPolicy.SetActive`. If you prefer Configure at `PUT /tax-policies/{taxPolicyId}` after the supersession, only the path changes (one line in the script); today it would collide with Upsert (BP015).
2. **`taxes.AssertTaxPolicy@2`:** refuse `active=false` with `TAX_POLICY_ARCHIVED`, and return `active` in `TaxPolicyReference`. Without it an archive can race a product mapping.
3. **SENSITIVE_POLICY_CHANGE issuance:** this slice gives the taxes context. Enabling issuance stays with DOMAIN/BUILD.
