# 19. Egypt e-receipt (B2C) requirements for NerdPOS (NP-D-L2-09, first pass, 2026-10-21)

**Status:** requirements research, **SPEC_ONLY**. Owner decision NP-OD-03 = Egypt first. This is **L2**: L1 stays country-neutral with DEMO values and makes no fiscal claim.

**Sources and their weight:**
- **Primary:** the official ETA SDK portal `sdk.invoicing.eta.gov.eg`.
- **Secondary (news, advisors):** mandate phases only, marked as such.
- **Nothing here is legal advice.** The owner confirms with the restaurant's accountant before implementation.

## 1. What the law and the platform require (sourced)

| # | Requirement | Source |
|---|---|---|
| R1 | B2C sales of taxpayers listed in an ETA mandate decision must be issued as **e-receipts** and submitted to the ETA central platform. The POS or ERP must integrate. Phases are announced per decision; the latest reported extension (Resolution 281/2025) applies from 2025-09-15 to listed taxpayers. **Whether the pilot restaurant is listed must be checked on the ETA site.** | secondary: KPMG, Comarch, Orbitax; Arabic press |
| R2 | Submission is `POST /api/v1/receiptsubmissions` with `receipts[]` and submission-level `signatures[]` (Issuer signature CAdES-BES Base64, required; ServiceProvider optional). Success is **202** (asynchronous validation). The response carries `acceptedDocuments[]` (`uuid`, `longId`, `receiptNumber`) and `rejectedDocuments[]` (with `error`). All receipts in one submission come from **one POS**. Only taxpayers with the **B2C tag** may submit, and the **POS must be activated** first. | ETA SDK, Submit Receipt Documents |
| R3 | The POS authenticates (Authenticate POS, access token). The ETA notifies the ERP of validation/cancellation and of **POS credential expiry, POS date expiry and POS deactivation**. | ETA SDK eReceipt API index |
| R4 | **Receipt identity is a per-POS hash chain:** `uuid` = SHA-256 (64 hex) of the serialized, normalized receipt with its own uuid empty and **including the previous receipt's uuid from the same POS** (`previousUUID`; empty only for the POS's first receipt). A correction is resent with a new uuid, the original `previousUUID`, and `referenceOldUUID` = the invalid uuid. | ETA SDK, Receipt Issuance FAQ; Receipt v1.2 |
| R5 | **Timing:** submit within **24 hours** of issuance; the issuance time is never in the future; late receipts need a Late Submission Request (yearly quota). Amendment windows: 96 h with a reference, 72 h without. `DuplicateSubmission` (422) applies to identical payloads within 10 minutes (`Retry-After`). | ETA SDK, FAQ; Submit |
| R6 | **Printed receipt:** a QR code "should" be printed: `{portal}/receipts/search/{uuid}/share/{issuedUtc}#Total:{total},IssuerRIN:{rin}`. | ETA SDK, FAQ |
| R7 | **Receipt v1.2 content:**<br>• header: `dateTimeIssued` (UTC), `receiptNumber` (unique per branch in a submission), `uuid`, `previousUUID`, `currency` (EGP, else `exchangeRate`);<br>• seller: `rin`, `companyTradeName`, `branchCode`, `branchAddress`, **`deviceSerialNumber`**, **`activityCode`**;<br>• buyer: `type` B/P/F, with `id`+`name` mandatory for B and for P when `totalAmount ≥ 150,000 EGP`;<br>• per line: `internalCode`, `description`, **`itemType` (GS1/EGS) + `itemCode`**, `unitType`, `quantity` > 0, `unitPrice`, `totalSale`, `netSale`, `total`, `taxableItems[]` (`taxType`, `subType`, `amount`, `rate`);<br>• totals: `totalSales`, `netAmount`, `totalAmount`, `taxTotals[]`, **`paymentMethod`**. | ETA SDK, Receipt v1.2 |
| R8 | **Returns:** a return receipt references the original receipt's uuid (`referenceUUID`, same family of type), up to **540 days** after the sale. | ETA SDK, FAQ |
| R9 | The **receipt types allowed depend on the taxpayer's activity code**. | ETA SDK, FAQ |
| R10 | The standard **VAT rate is 14%** (Law 67/2016, from 2017-07-01, reported unchanged by Law 157/2025). The rate for restaurant services must be confirmed by the accountant; no rate is hard-coded. | secondary: Andersen, EY |

## 2. What this means for NerdPOS (domain implications; nothing is implemented yet)

| # | Implication | Owner module / lane |
|---|---|---|
| I1 | A **fiscal device** per terminal (ETA POS identity: serial, activation state, credential expiry) with its own **append-only receipt chain** (`previousUUID` ordering). The chain must be strictly sequential per device: issuance takes a device-chain lock, and the next uuid depends on the last. | new `compliance` records (L2 DOMAIN fragments), BUILD |
| I2 | **When a receipt is issued:** at `Order.Complete` (the full payment settles the check), from the **confirmed pricing snapshot** only. No receipt for DRAFT, CONFIRMED-unpaid or voided checks. Return receipts come from completed **refunds** (docs/14 X5/X6), referencing the original receipt. | orders → compliance via an event; refunds → compliance |
| I3 | **Submission is asynchronous and never blocks the sale** (`CLAUDE.md`: committed truth never depends on device or provider success). An outbox worker submits within the 24 h window, batches per device, handles 202/rejections/`Retry-After`, and alerts well before 24 h. Rejections are visible to a manager; corrections use `referenceOldUUID`. | compliance worker, BUILD |
| I4 | **Every sellable product needs** `itemType` + `itemCode` (GS1 or EGS registered codes) and an ETA `unitType`. That is a catalog L2 requirement (WORKER NP-D-L2-01: add to the catalog admin contract). | catalog |
| I5 | **Branch** needs `branchCode`, address and `activityCode`; **business** needs `rin` and the trade name. | organization (L2) |
| I6 | **Tax lines** map NerdPOS tax policies to ETA `taxType`/`subType` codes (from the ETA Codes page; to be extracted in pass 2). | taxes (WORKER NP-D-L2-03 consumes this) |
| I7 | **Payment method codes** map NerdPOS tenders (CASH, recorded CARD) to the ETA `paymentMethod` codes (pass 2). | payments → compliance |
| I8 | **Buyer:** default type P without id. Collect id + name when the total is ≥ 150,000 EGP, or for a business buyer (B). | orders (checkout UI) |
| I9 | **Printed receipt** (NP-D-L2-10, printers) prints the QR (R6). Printing failure never blocks the sale or the submission. | printing (L2) |
| I10 | **Money precision:** ETA uses decimals up to 5 places (pages are inconsistent, 2 vs 5 for tax amounts). NerdPOS Money(19,4) is converted without changing the frozen amounts. The exact precision is to be confirmed in pass 2 against the ETA Main Calculations page. | compliance mapping |

## 3. Owner decisions needed (L2, none blocks L1)

| # | Decision | Why |
|---|---|---|
| OD-EG-1 | Is the pilot restaurant **listed in an ETA e-receipt mandate** (B2C tag)? What is its activity code? | Decides whether e-receipt is a legal launch blocker |
| OD-EG-2 | **Signing certificate custody** (eSeal USB token vs HSM), and **who holds the ETA client credentials** | Secrets: never in the repository or packs; deployment ops (NP-B-L2-07) |
| OD-EG-3 | **Item codes:** use GS1 or register EGS codes for the menu, and who registers them | Every line needs `itemType` + `itemCode` |
| OD-EG-4 | **Service charge practice** (NP-OD-01) and whether it appears as a separate line | Affects receipt lines and totals |
| OD-EG-5 | Whether recorded **CARD** is used in the pilot (NP-OD-02) and its ETA payment-method code | Payment mapping |
| OD-EG-7 | How the NerdPOS invoice rounding adjustment appears on an ETA receipt (section 6.4) | ETA arithmetic must reconcile |
| OD-EG-6 | Mixed-tender check (cash + card) on a receipt with a single `paymentMethod` (section 5.2) | ETA/accountant guidance needed |

## 4. Next (pass 2, DOMAIN)

- Extract the ETA **Codes** pages (tax types/subtypes, payment methods, unit types), the **Main Calculations** validation rules, and the **serialization** page into a machine-readable mapping table.
- Draft the L2 `compliance` fragments: fiscal device, receipt chain record, issuance and return operations, submission worker contract.

## 5. ETA code mapping (pass 2, 2026-10-21)

**Sources:**
- ETA SDK [Tax Types](https://sdk.invoicing.eta.gov.eg/codes/tax-types/);
- ETA SDK [Payment Methods](https://sdk.invoicing.eta.gov.eg/codes/payment-methods/).

The mapping candidates are DOMAIN proposals. **Every row marked ACCOUNTANT must be confirmed** before L2 implementation.

### 5.1 Tax types relevant to a restaurant

| NerdPOS concept | ETA `taxType` / `subType` | Basis | Status |
|---|---|---|---|
| VAT on food and beverage sales | `T1` Value added tax / `V009` General item sales | rate on the line | ACCOUNTANT (expected standard VAT; confirm the rate for restaurant services) |
| VAT-exempt or non-taxable item | `T1` / `V003` Exempted, or `V004` Non-taxable | none | ACCOUNTANT, per item |
| Service charge, taxable | `T9` Service charges / `SC01` (rate) or `SC02` (amount) | rate or amount | ACCOUNTANT + NP-OD-01 |
| Service charge, non-taxable | `T17` Service charges / `SC03` (rate) or `SC04` (amount) | rate or amount | ACCOUNTANT + NP-OD-01 (T9 vs T17 decides whether VAT applies on top) |
| Table tax | `T2`/`T3` (`Tbl01`/`Tbl02`) | rate or amount | not expected for a restaurant; ACCOUNTANT |
| Entertainment tax | `T7`/`T15` (`Ent01..Ent04`) | rate or amount | only if the venue is classified for it; ACCOUNTANT |
| Withholding (`T4`) | n/a on B2C receipts | n/a | not used |

**ETA rules:**
- Subtypes are valid only with their own parent type.
- Types without subtypes must not carry subtype data.

### 5.2 Payment methods

| NerdPOS tender | ETA `paymentMethod` | Status |
|---|---|---|
| CASH | `C` Cash | candidate |
| Recorded CARD (reference, no provider) | `V` Visa (used for card) | ACCOUNTANT + NP-OD-02 |
| Voucher / gift card / points / promotion | `VO` / `GC` / `P` / `PR` | not in L1/L2 scope |
| Other | `O` Others | fallback only with ACCOUNTANT approval |

**Open:**
- The ETA page says it lists 12 methods, but only 9 were extracted (`C, V, CC, VC, VO, PR, GC, P, O`). Re-verify the full list.
- A Receipt v1.2 carries **one** `paymentMethod`, but a NerdPOS check can be paid by several tenders (split, cash + card). **OD-EG-6:** which code to send for a mixed-tender check, or whether one receipt per tender is required. This is ACCOUNTANT/ETA guidance; DOMAIN does not guess.

### 5.3 Still to extract (pass 3)

- ETA unit types (menu items: expected "each"-type unit).
- The Main Calculations validation rules (rounding/precision).
- The serialization/normalization rules for the uuid hash.
- The receipt types allowed per activity code.

## 6. Pass 3: restaurant receipt type, hashing and precision (2026-10-21)

### 6.1 The receipt type for a restaurant: **Coffee & Restaurant Receipt v1.2**

Source: [Coffee & Restaurant Receipt v1.2](https://sdk.invoicing.eta.gov.eg/documents/coffee-restaurant-receipt-v1-2/).

- `documentType.receiptType = "SC"`, `typeVersion = "1.2"`.
- v1.0 is retired.
- It has the same structure as Receipt v1.2 (R7), but **`header.orderdeliveryMode` is mandatory**.
- No table, waiter, guest-count, tip or service-charge field exists on the receipt. A service charge can only appear as a tax line (`T9`/`T17`, section 5.1). Tips are not supported in NerdPOS anyway.
- The allowed types depend on the activity code (R9). **OD-EG-1** must confirm that `SC` is allowed for the pilot's activity code.

### 6.2 `orderdeliveryMode` mapping

Source: [Order Delivery Modes](https://sdk.invoicing.eta.gov.eg/codes/delivery-mode/). Codes: `FC` From the company place, `TO` Transport by others, `TC` Transported by the company.

| NerdPOS `OrderChannel` | ETA code | Status |
|---|---|---|
| DINE_IN | `FC` | candidate |
| TAKEAWAY | `FC` (picked up at the venue) | candidate, ACCOUNTANT |
| DELIVERY by the restaurant | `TC` | L3 (delivery not in scope) |
| DELIVERY by a third party | `TO` | L3 |

**Note:** the Get Receipt example shows `AIR`, which is not on the code list. We use the list.

### 6.3 uuid hashing: serialization rules

Source: [Document serialization approach](https://sdk.invoicing.eta.gov.eg/document-serialization-approach/).

- Serialize from the document's root object.
- Every **property name** is converted to UPPERCASE (culture-invariant) and wrapped in double quotes.
- Every simple **value** is in double quotes **exactly as sent** (`0.0` stays `0.0`).
- Objects are serialized recursively without quotes.
- Arrays: the array name prefixes the whole array **and** each element (`"TAXABLEITEMS""TAXABLEITEMS"<item1>"TAXABLEITEMS"<item2>`).
- Whitespace is ignored. The result is hashed with SHA-256 (receipt uuid: with its own `uuid` empty and `previousUUID` included; FAQ).

**Consequence for NerdPOS:**
- The exact JSON sent must be the exact text hashed. Decimal strings are formatted **once**, by the compliance mapper, and stored with the receipt.
- The stored receipt payload is **immutable**: it is the evidence behind its uuid.
- A **golden-vector test** against the ETA's published serialized samples is required before any submission (BUILD).

### 6.4 Precision and calculations

Source: [Main Calculations](https://sdk.invoicing.eta.gov.eg/main-calculations/).

- Money and quantity fields: up to **5 decimals**.
- Tax rates: up to **2 decimals**.
- Line rules: `totalSale = quantity × unitPrice`; `netSale = totalSale − discounts`.
- Receipt totals: the sum of line values; `totalAmount = Σ line total − extra receipt discount (+ adjustment, which is reserved at 0)`.
- The ETA mentions a calculation tolerance (December 2022 release) whose value is not stated in the extracted text. To confirm.

**NerdPOS rules:**
- The receipt is mapped **from the frozen pricing snapshot** at Money(19,4) and written with ≤5 decimals, never recomputed differently.
- Rounding residuals (`rounding` component, sales calculator) must reconcile to the ETA arithmetic. How a NerdPOS rounding adjustment is represented (`valueDifference`? a line?) is **OD-EG-7**, needing ETA/accountant guidance.

### 6.5 Updated owner and accountant questions

- OD-EG-1: also confirm the `SC` receipt type for the activity code.
- **OD-EG-7 (new):** representing the NerdPOS invoice rounding adjustment on an ETA receipt.

## 7. Adapter design (E-40, 2026-10-25)

**Rule:** the e-receipt is a **compliance adapter** (`EG_ETA`) on the canonical compliance module. Country fiscal data never enters catalog, orders, pricing or organization records. A later market adds its own adapter and mappings.

| Piece | Fragment | Purpose |
|---|---|---|
| Branch registration | `compliance.FiscalProfile` + `FiscalProfile.Configure` | RIN, trade name, ETA branch code, activity code, address, receipt type SC |
| POS identity and chain | `compliance.FiscalDevice` + `FiscalDevice.Register` / `SetState` | one device per terminal; holds the chain head (lastSequence, lastDocumentHash); `credentialRef` names the secret, never stores it |
| Item codes | `compliance.FiscalItemMapping` + `FiscalItemMapping.SetMany` | product → GS1/EGS code and unit type (I4, OD-EG-3) |
| Switch | `FiscalDocumentPolicy` OFF / SANDBOX / PRODUCTION per branch | installation moves a branch to PRODUCTION only with active devices and a profile |
| Document | `compliance.FiscalDocument` CR | PENDING_DATA → BUILT (chained per device) → SUBMITTED → ACCEPTED / REJECTED → SUPERSEDED; payload immutable once BUILT |
| Issuance | `compliance.order-completed` CR | from the frozen snapshot at completion; missing data gives PENDING_DATA with named issues, never a blocked sale |
| Submission | `compliance.SubmitDocument` CR | per device, 202 / status query / Retry-After, secret store and local signing port, alerts at 12 h and 20 h |
| Manager queue | `Compliance.Find` + `Compliance.ReissueDocument` | build a pending document after data is fixed; correct a rejected one (referenceOldUUID, same previousUUID) |

**Defaults pending the accountant** (none blocks building):
- **paymentMethod** of a mixed-tender check: the largest captured tender, CASH on a tie (OD-EG-6).
- **Non-zero rounding component:** PENDING_DATA `ROUNDING_UNMAPPED` (OD-EG-7).
- **Service charge:** stays off the receipt until T9 or T17 is answered (OD-EG-4).
- **Return receipts:** wait for the refund commercial-intent gate (H2).
