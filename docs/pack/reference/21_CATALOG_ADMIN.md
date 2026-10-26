# 21. Catalog administration (NP-D-L2-01, decision E-32, 2026-10-24)

**Status:** L2 specification, manifest 2.10.0. Evidence state: SPEC_ONLY. BUILD implements every writer as an AUTHORED slot (`tests/postgres/catalog-admin.test.ts`).

## Why this is first in L2

`main` has **no catalog writer**. Products, categories, units and modifiers exist only through the development seed. A restaurant cannot enter or change its own menu. Canonical V4 lists the writers, but only as STRUCTURED shapes: no errors, no guards, client-supplied ids (OPS-GAP-002). `Catalog.UpsertItem` also has no `taxPolicyId`, so a product created through it could never be priced.

## Operations

| Operation | What the manager does | Key rules | Errors |
|---|---|---|---|
| `Unit.Create` / `Unit.Configure` / `Unit.List` | define sale units (piece, kg) | code unique; precision 0..6; precision frozen once a product uses the unit | `UNIT_CODE_TAKEN`, `UNIT_PRECISION_IMMUTABLE`, `CATALOG_UNIT_NOT_FOUND` |
| `Category.Create` / `Category.Configure` | create, rename, hide a category | bilingual name required; hiding a category takes all its products off the menu | `CATALOG_CATEGORY_NOT_FOUND` |
| `Product.Create` | add a dish or drink | sku unique (archived included); category and unit must exist; tax from `ProductTaxDefaultPolicy` unless given; branch availability by `NewProductAvailabilityPolicy`; never a price | `CATALOG_SKU_TAKEN`, `TAX_POLICY_NOT_FOUND`, `PERMISSION_DENIED`, `CATALOG_CATEGORY_NOT_FOUND`, `CATALOG_UNIT_NOT_FOUND` |
| `Product.Configure` | edit or archive a product | unit and tax are not editable here; a new category applies to new quotes only | `CATALOG_SKU_TAKEN`, `CATALOG_PRODUCT_NOT_FOUND` |
| `Product.SetTaxPolicy` | change a product's tax | its own command under `tax:manage` (role decides who); audit keeps old and new | `TAX_POLICY_NOT_FOUND`, `CATALOG_PRODUCT_NOT_FOUND` |
| `Product.SetModifierGroups` | choose the modifier groups of a product | ordered list (display order), unique, at most 20 | `MODIFIER_DEFINITION_NOT_FOUND` |
| `Product.SetAvailability` | put on / take off this branch's menu | branch from login context; reason required per `AvailabilityReasonPolicy`; last-writer-wins under the row lock | `CATALOG_PRODUCT_NOT_FOUND` |
| `Product.Get` | open a product in the admin form | product + this branch's availability (null = not on the menu here); no price | `CATALOG_PRODUCT_NOT_FOUND` |
| `ModifierGroup.Create` / `ModifierGroup.Configure` | define Size, Doneness, Extras | min/max as the DB check; SINGLE means max 1; at most 20 | `MODIFIER_DEFINITION_NOT_FOUND` |
| `ModifierOption.Create` / `ModifierOption.Configure` | add Large +10.00, No onion | signed delta, scale 4; currency from the branch context, never the client | `MODIFIER_OPTION_NOT_FOUND`, `MODIFIER_DEFINITION_NOT_FOUND` |

Every writer has CAS where it edits (`CONCURRENCY_CONFLICT`), history, audit and tier-A idempotency. Nothing is deleted: archive is `active=false`.

## Business knobs (LEGO: policies, not code)

| Policy | Decides | Default | Scope |
|---|---|---|---|
| `NewProductAvailabilityPolicy` | a new product is on the creating branch's menu at once (CREATING_BRANCH), or only after explicit activation per branch | EXPLICIT_PER_BRANCH | tenant |
| `AvailabilityReasonPolicy` | reason REQUIRED or OPTIONAL for SOLD_OUT and BLOCKED | SOLD_OUT optional, BLOCKED required | tenant, branch |
| `ProductTaxDefaultPolicy` | default tax for new products; when set, choosing another tax needs `tax:manage` | unset (tax chosen per product) | tenant |

Who may change a tax mapping is a role choice (`tax:manage` on `Product.SetTaxPolicy`). Whether it also needs a manager approval becomes `ApprovalRequirementPolicy[PRODUCT_TAX_CHANGE]` (default NEVER) once the approval-action kind exists (CORE section 5).

**Fixed on purpose** (CORE section 4): sku unique including archived products, product unit fixed, unit precision frozen once used, no delete, captured lines never re-priced, currency from the branch context.

## Making a new product sellable (operator order)

1. `Product.Create`: category, unit, tax (or the default tax policy).
2. Price: `Catalog.SetPrice` (NP-D-L2-02, next slice).
3. `Product.SetModifierGroups`, if it has modifiers.
4. `Product.SetAvailability AVAILABLE` in each branch that sells it; automatic in the creating branch when `NewProductAvailabilityPolicy` is CREATING_BRANCH.

The accepted quote refuses the product until steps 2 and 4 are done (`PRICE_NOT_FOUND`, `CAPABILITY_NOT_AVAILABLE`). The admin screen shows these as a checklist; it does not hide them.

## What stays exactly as today

- Pricing, quoting and sellable-item reads.
- Captured order lines: a catalog edit never re-prices a check.
- The development seed.

These are listed as non-regression gates in every change request.

## Change requests to BUILD (record owner)

| Record | Change |
|---|---|
| `catalog.Product` | UNIQUE(sku) → `CATALOG_SKU_TAKEN`; indexes on categoryId, unitId, taxPolicyId; lock rank 85 |
| `catalog.Unit` | UNIQUE(code) → `UNIT_CODE_TAKEN`; lock rank 83 |
| `catalog.Category` · `ModifierDefinition` · `ModifierOption` · `ProductAvailability` | lock ranks 84 · 86 · 87 · 88; availability reads branch-scoped |

The migrations **fail closed** if duplicates already exist and list them; they never rename data.

## Not in this slice

- **Prices and price history:** NP-D-L2-02.
- **Tax policy writer:** NP-D-L2-03.
- **Variants:** no writer and no use in order lines.
- **Images, bulk import, product search by name:** not requested.
- **Demo roles:** the manager role does not yet hold `catalog:manage`, `catalog:upsertitem` or `product:setavailability`. They are added when the L2 demo data is cut.
