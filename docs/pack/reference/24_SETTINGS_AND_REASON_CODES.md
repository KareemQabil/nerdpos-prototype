# 24. Settings and managed reason codes (W4, NP-D-L2-04, CORE B4)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w4-settings-reason-codes-r2`, base `agent/claude/domain-line` @ `8bd7f99c` (E-36). It supersedes the first cut `agent/opus/w4-settings-reason-codes` on the worker base.

**Fragments:** written by `reference-tools/author_worker_w4.py` (26 new files).

## 1. Facts at the pinned runtime (`6f5bfe2`)

| Fact | Source |
|---|---|
| Resolution runs inside the caller transaction: precedence TERMINAL > BRANCH > TENANT, then the latest `effectiveFrom <= now`, then the highest `policy_version`. The selected value is parsed by the policy schema, and a parse failure **throws** (fail closed). | `packages/platform/src/policies.ts` |
| The store reads every row of the three scopes. | `packages/db/src/policies.ts` |
| `settings__policy_value` has no unique key. The app role may UPDATE. | migration `202610110004_policy_runtime` |
| `settings.PolicyValue` and `settings.ReasonCode` are **not accepted** records (patchable). | canonical |
| A reason today is an opaque non-blank string of at most 200 characters, with an optional note of up to 2000. | `modules/orders/src/cancel-order.ts` |
| `REASON_CODE_INVALID` and `REASON_REQUIRED` are already registered (reused). | canonical error_registry |
| `ReasonCode.List` uses permission `AUTHENTICATED`, which is not a permission id. | canonical (BP030) |

## 2. Delivered

| Fragment | Purpose |
|---|---|
| `settings/operation/Settings.UpdatePolicy` | `replaces_existing`, same route and permission. Typed values, scope rules, effective-dated **append-only** rows, `INHERIT` to clear an override, CAS, approval BY_POLICY `SENSITIVE_POLICY_CHANGE` with the typed context. |
| `settings/operation/Settings.Effective` | `replaces_existing`. The value a command would resolve, its source scope, and `valid`. Supports `asOf` for scheduled values. |
| `settings/operation/Policy.History` | `replaces_existing`. Paged rows: SCHEDULED, IN_FORCE, SUPERSEDED. |
| `settings/operation/settings.ValidatePolicyChangeIntent` + `contract_type/PolicyChangeIntent` | Issuance validation of SENSITIVE_POLICY_CHANGE in the settings scope (E-36 pattern): it derives the intent from settings state and checks the supplied context. |
| `settings/change_request/Settings.UpdatePolicy` | To BUILD: open settings-scope issuance (`settings.PolicyValue:*`) through that port. |
| `settings/operation/settings.ApplyMarketProfile` | Internal provisioning port (no HTTP). Applies a market profile once, to an empty tenant. Used by W5. |
| `settings/operation/ReasonCode.Create`, `ReasonCode.Configure`, `ReasonCode.List` | Managed reason codes (Upsert split; List `replaces_existing`). |
| `settings/operation/settings.AssertReasonCode` | Internal port for every exception command: validates the reason and returns the snapshot to store. |
| `settings/policy/ReasonCodePolicy` | Per reason kind: FREE_TEXT (canonical default, today's behaviour) or MANAGED. |
| `settings/record_patch/settings.PolicyValue` + `change_request/settings.PolicyValue` | `state SET\|INHERIT`, `changeNote`, a unique version per scope. Resolver semantics to BUILD. |
| `settings/record_patch/settings.ReasonCode` + `change_request/settings.ReasonCode` | label LocalizedText, sortOrder, rank 92. ReasonKind + `VARIANCE`. |
| views | `PolicyValueView`, `EffectivePolicyView` (REPLACE_UNACCEPTED), `ReasonCodeView`, `ReasonCodeReference`, `MarketProfileValue`, `SettingsProfileApplication` |
| errors | `SETTINGS_POLICY_UNKNOWN` (404), `SETTINGS_POLICY_SCOPE_NOT_ALLOWED` (422), `SETTINGS_PROFILE_ALREADY_APPLIED` (409), `REASON_CODE_TAKEN` (409) |

## 3. Rules

| Rule | Detail |
|---|---|
| Typed values | The registry is canonical policies plus accepted policy fragments. Unknown policy: `SETTINGS_POLICY_UNKNOWN`. Values are validated strictly: enum ∈ allowed; object with declared keys only; SCALAR, STATE_MAP and CHANNEL_MAP as declared; map keys from their enum; decimals as strings; no floats; at most 16 KiB. Otherwise `VALIDATION_FAILED` with issues. |
| Scope | Only the policy's `scope_dimensions` (§4 for canonical policies), else `SETTINGS_POLICY_SCOPE_NOT_ALLOWED`. BRANCH and TERMINAL scopes must be accessible; no existence leak. |
| Precedence | TERMINAL > BRANCH > TENANT > canonical default. Within a scope: latest `effectiveFrom <= t`, then highest `policyVersion`. |
| Clearing an override | `state INHERIT` at BRANCH or TERMINAL. The scope passes to the next one. Not allowed at TENANT. |
| History | Every change is a new immutable row (`policyVersion + 1`). Rows are never updated or deleted, so the rows are the history. The audit row names the actor and the old/new values. |
| Effective dating | `F = effectiveFrom ?? now`. No backdating. At most 366 days ahead. |
| Concurrency | Optional `expectedVersion` (CAS on the scope's latest `policyVersion`). `UNIQUE(policyId, scope, scopeId, policyVersion)` gives `CONCURRENCY_CONFLICT` on a race. |
| **Invalid row** | Write-time validation makes an invalid row impossible except after a registry change. Then the reading command **fails closed**, exactly as the accepted resolver does today: it raises its owner's policy error and never falls back to a less specific value or the default. `Settings.Effective` shows `valid: false`. |
| Approval (E-36 pattern) | Context: `policyId = "settings.PolicyValue:<policyId>:<scopeType>:<scopeId>"`; `oldValueHash` = JCS sha256 of the current row's {state, value} (or of null); `newValueHash` = JCS sha256 of {state, value, effectiveFrom}, with `effectiveFrom` = the input value, **null when immediate**, so an approval at t0 executed at t1 is the same intent. The rule **in force before** the command decides, so lowering `ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE]` needs approval under the old rule. No grant gives `APPROVAL_REQUIRED` with its details. On consumption the context is recomputed under the transaction. Errors: `APPROVAL_GRANT_INVALID` (other context, or the value moved), `_EXPIRED`, `_ALREADY_CONSUMED`, `APPROVER_NOT_AUTHORIZED`. Grant lock 99 last; consumed once. **Issuance:** `settings.ValidatePolicyChangeIntent`. |
| Snapshots | Snapshot-sensitive policies already captured by a fact keep their captured version. |

**Note on the catalog policies' `persisted_shape` (DOMAIN's text, copied in W1 to W3):**
- The text says an invalid row at read "is ignored for resolution (next scope or default)".
- The accepted resolver throws instead.
- Falling back to the default would apply a value the owner never chose. This slice therefore specifies fail closed.
- Please confirm one wording (channel question).

## 4. Allowed scopes for canonical policies (until each owner declares `scope_dimensions`)

| Scopes | Policies |
|---|---|
| TENANT | PricingOrderPolicy, RoundingPolicy, SelfApprovalPolicy, ApprovalTtlPolicy, LoginLockoutPolicy, AuthSessionPolicy, CredentialPolicy, LineVoidDispositionPolicy, OrderCompletionPolicy |
| TENANT, BRANCH | BusinessDatePolicy, SessionDurationPolicy, ComplimentaryOrderPolicy, DiscountApprovalPolicy, VarianceApprovalPolicy, SplitTenderPolicy, ApprovalRequirementPolicy, OrderNumberPolicy, ServiceChargePolicy, RefundMethodPolicy, OrderConfirmationPricingPolicy; L3: ReturnAccountingPolicy, NegativeStockPolicy, OverReceiptPolicy, InventoryEffectTimingPolicy |
| TENANT, BRANCH, TERMINAL | BlindClosePolicy, TenderMethodPolicy |

All rows are `IMPLEMENTATION_DEFAULT`. Policy fragments that declare `scope_dimensions` (for example FloorIntakePolicy@2, the catalog policies, ZeroPricePolicy) use their own.

## 5. Managed reason codes

| Rule | Detail |
|---|---|
| Kinds | The canonical `ReasonKind`, plus `VARIANCE` (requested). The CORE kinds are ORDER_CANCEL, ORDER_VOID, LINE_VOID, DISCOUNT, COMP, REFUND, CASH_MOVE, NO_SALE, TENDER_CORRECTION and VARIANCE. |
| Row | `{kind, code [A-Z0-9_]{1..32}, label LocalizedText (≤ 80 each), requiresNote, active, sortOrder}`. Unique per kind; at most 100 per kind. |
| Mode | `ReasonCodePolicy[kind]`. FREE_TEXT is the canonical default and today's rule. MANAGED requires an active code of that kind, and the note when `requiresNote`. |
| Safety | A kind cannot become MANAGED without an active code. The last active code of a MANAGED kind cannot be deactivated. |
| History | Kind and code are fixed after create. A consumer stores the `ReasonCodeReference` snapshot (code, id, version, label, note) in its own fact, so relabelling never rewrites a past fact. |

**Consumer changes, for DOMAIN** (outside my modules):
- `Order.Cancel`, `Order.VoidLine`, `Order.Void`, `Order.ApplyDiscount`, `Order.Comp`, `Refund.Request`, `Cash.Move`, `Drawer.OpenNoSale`, `Session.Close` (variance) and `Payment.CorrectTender` each:
  - call `settings.AssertReasonCode(kind, reasonCode, reason)` inside their transaction, before their writes;
  - store the returned reference;
  - add `REASON_CODE_INVALID` and `REASON_REQUIRED` to their errors.
- With FREE_TEXT nothing changes for them.

## 6. Business choices

| Item | Canonical default | EG profile value | Label | Confidence | Question for the expert |
|---|---|---|---|---|---|
| ReasonCodePolicy | FREE_TEXT for every kind | MANAGED for every CORE kind | MARKET_CONVENTION | HIGH | Which reasons do your staff actually use? Keep the list short. |
| ApprovalRequirementPolicy[SENSITIVE_POLICY_CHANGE] | ALWAYS | ALWAYS | IMPLEMENTATION_DEFAULT | HIGH | Who approves a settings change: the owner only, or any manager? |
| Profile application without approval | once, to an empty tenant (engineering) | n/a | IMPLEMENTATION_DEFAULT | n/a | n/a |

**EG seed reason codes** (`MARKET_CONVENTION`, HIGH; data for W5/W10; `*` = requiresNote):

| Kind | Codes (en / ar) |
|---|---|
| ORDER_CANCEL | CUSTOMER_LEFT Customer left / العميل غادر; ORDER_MISTAKE Order entered by mistake / طلب بالخطأ; DUPLICATE Duplicate order / طلب مكرر |
| LINE_VOID | WRONG_ITEM Wrong item / صنف خاطئ; CHANGED_MIND Customer changed mind / العميل غيّر رأيه; QUALITY* Quality issue / مشكلة في الجودة; KITCHEN_DELAY Kitchen delay / تأخير المطبخ |
| ORDER_VOID | CASHIER_ERROR* Cashier error / خطأ كاشير; TEST_ORDER Test order / طلب تجريبي |
| DISCOUNT | REGULAR_GUEST Regular guest / عميل دائم; COMPLAINT* Complaint / شكوى; MANAGER* Manager discretion / تقدير المدير |
| COMP | STAFF_MEAL Staff meal / وجبة موظف; COMPLAINT* Complaint / شكوى; OWNER_GUEST Owner's guest / ضيف المالك |
| REFUND | QUALITY* Quality issue / مشكلة في الجودة; WRONG_CHARGE Wrong charge / خطأ في التحصيل |
| CASH_MOVE | SUPPLIER* Supplier payment / دفع لمورد; PETTY* Petty cash / مصروفات نثرية; SAFE_DROP Safe drop / إيداع الخزنة; FLOAT_TOPUP Float top-up / تعزيز الفكة |
| NO_SALE | CHANGE Give change / فكّ عملة; OTHER* Other / أخرى |
| VARIANCE | COUNT_ERROR Counting error / خطأ في العدّ; UNRECORDED* Unrecorded payout / صرف غير مسجل; UNKNOWN* Unknown / غير معروف |
| TENDER_CORRECTION | WRONG_TENDER Wrong payment method / وسيلة دفع خاطئة |

## 7. Open points (channel; none blocks this slice)

1. **SENSITIVE_POLICY_CHANGE issuance in the settings scope.**
   - E-36 opened issuance for `taxes.TaxPolicy:*`.
   - This slice gives the settings port and the BUILD change request for `settings.PolicyValue:*`. Until that change lands, a settings-scope grant cannot be issued, and `Settings.UpdatePolicy` under ALWAYS returns `APPROVAL_REQUIRED`.
   - Provisioning is not affected: it uses `settings.ApplyMarketProfile`.
2. A narrower **`reasoncode:read`** permission (BUILD request). `settings:read` is used until then.
3. **ReasonKind `VARIANCE`** (canonical enum, change_request to BUILD).
4. One wording for invalid policy rows (§3 note).
