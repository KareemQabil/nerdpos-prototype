# 35. Scenario stress test: does the backend carry many kinds of restaurant? (DOMAIN, 2026-10-26)

**Asked by the owner:** "plan for a million things with the same idea, look at scenarios and stories, and check whether our backend allows it, without flattery."

**Evidence base:**
- canonical `33e3096c` on main `30e78612`;
- the DOMAIN line `a8946509`;
- field answers (docs/34);
- public vendor documentation and forum reports on POS failures (sources at the end).

Statuses are literal. A canonical design is not a built capability.

## 0. Verdict

**The foundation is genuinely strong.** It is the hard part to get right, and it is right:
- decimal money;
- command identity with replay (no double charge on retry);
- CAS and a global lock order;
- append-only history and audit;
- an outbox that keeps every side effect (kitchen, printing, fiscal) outside the sale;
- scoped policies that fail closed;
- approvals bound to the exact intent;
- movement-based stock;
- a pricing snapshot that already stores `components` and `charges` as lists;
- a compiler that generates the contracts;
- a validator that enforces module ownership.

Not one scenario below needs that foundation replaced.

**What is narrow is the restaurant vocabulary on top of it.** Three core shapes are flatter than the market:
1. **The order line:**
   - a product with a flat list of modifiers;
   - no components (combo, half-and-half);
   - no nested choices;
   - no seat;
   - no share of one item between guests.
2. **The tax:** one tax policy per product, so no stacked table tax plus VAT.
3. **The visit:** one table per visit, so no joined tables.

**One architecture question is open:** selling without the internet when a client has several branches.

So you are not deluded. **The strength is in the foundation, not yet in breadth.** Widening the three shapes is cheap now. It gets expensive once Fire, Confirm, the fiscal mapping and the UI are built on the flat line. That is the main finding.

**Legend:**

| Code | Meaning |
|---|---|
| **A** | on main (accepted) |
| **S** | specified on the DOMAIN line |
| **P** | a policy value of an existing capability |
| **C** | a new capability that fits the foundation cleanly (new operations or records, no core reshaping) |
| **X** | **reshapes a core record** (line, tax, visit) |
| **ARCH** | architecture decision |

## 1. Scenarios

### 1.1 Every restaurant

| # | Scenario | Status |
|---|---|---|
| 1 | Network glitch during payment, cashier presses again | A (tier-A replay, one capture) |
| 2 | Two cashiers edit the same check at once | A (CAS: CONCURRENCY_CONFLICT, nothing lost) |
| 3 | Price change while a check is open | S (captured line keeps its price; E-35) |
| 4 | Menu item sold out mid-service | S (ProductAvailability per branch, reason policy) |
| 5 | Manager approval for void, discount, refund, drawer | A/S (bound grants; E-25, E-36) |
| 6 | Cashier tries to approve their own void | A (SelfApprovalPolicy DENY) |
| 7 | Day closes after midnight | A (server business date, branch cutoff) |
| 8 | Drawer short at close | A (variance by approval rule, per cashier) |
| 9 | Printer out of paper | S (print job FAILED, retry, sale unaffected; E-41) |
| 10 | Kitchen screen down | S (round status and re-send; E-38) |
| 11 | E-receipt platform down a whole day | S (BUILT queue, 12/20 h alerts; E-40) |
| 12 | Receipt reprinted to cheat (same receipt for a second guest) | S (COPY mark, RECEIPT_REPRINT policy) |
| 13 | Cash paid, card paid, both on one check | A (SplitTenderPolicy) |
| 14 | Card charged, but the response never reached the POS | S (recorded card needs the terminal reference; the provider integration contract must reconcile UNKNOWN; F3) |
| 15 | Refund part of a check | A (money) · S direction (fiscal return, H2/FA-6) |
| 16 | Wrong item rung, already paid | A refund, S return receipt |
| 17 | Staff meal | C (FA-5) |
| 18 | Tip on card | C (PD-V4-17; a tip is its own money fact, never sales) |
| 19 | Tip pooled and distributed | C (on top of 18) |
| 20 | Payment by wallet (InstaPay, Vodafone Cash) | P/C (TenderMethodPolicy label; e-receipt code mapping) |
| 21 | Bank fee on card | out of scope (accounting) |
| 22 | Accountant needs daily figures | C (FA-7 export) |
| 23 | Owner checks today's sales from home | C (operator reports W8 + remote access, ARCH hosting) |
| 24 | Shift hand-over with open checks | S (floor checks never block a drawer) · open note (cashier-created dine-in) |
| 25 | Power cut, the till restarts mid-order | A (DRAFT persisted, command replay) |

### 1.2 Café and shisha

| # | Scenario | Status |
|---|---|---|
| 26 | Shisha with table tax and VAT stacked | **X** (multi-component tax, FA-1) |
| 27 | Same drink in S/M/L | **X/C** (Variant record exists; AddLines rejects variantId: CAPABILITY_NOT_AVAILABLE) |
| 28 | Coal refill every 20 min added to the check | A (AddLines on an open check) |
| 29 | Minimum charge per person | C (charge component with a floor rule) |
| 30 | Customer sits 5 hours, several rounds | A/S (one visit, rounds) |
| 31 | Happy hour 5–7 pm | S (W7 promotions, after pilot) |
| 32 | Regular customer has a running tab paid weekly | C (credit module DEFERRED) |
| 33 | Football match night with entry fee | C (charge or ticket product) |

### 1.3 Casual dining and family restaurant

| # | Scenario | Status |
|---|---|---|
| 34 | Family of 14 across three tables | **X** (visit with joined tables, FA-2) |
| 35 | Move the family to a bigger table | S (Transfer@2) |
| 36 | Each person pays their own items | S (MoveLines between checks of the visit) |
| 37 | Two people share one pizza and split its cost | **X** (fractional share of a line; Square's known gap) |
| 38 | Split the bill equally into N | C (PD-V4-09: settlement reallocation) |
| 39 | Merge two checks | C (PD-V4-09) |
| 40 | Starters now, mains later (coursing) | S (explicit fire rounds; E-42) |
| 41 | Guest changes doneness after firing | C (FA-4 kitchen modification) |
| 42 | Item comped because it came late | S (Order.Comp, ORDER_COMP) |
| 43 | Birthday cake brought from outside, cutting fee | P/C (open-price item or charge) |
| 44 | Waiter shift change: tables move to another waiter | C (TableVisit.AssignServer, E-41 #7) |
| 45 | Service 12 % on dine-in only | S (ServiceChargePolicy W6b) |
| 46 | Service goes to staff, not revenue | S (separate measure) |
| 47 | Guest disputes the bill at the end | A (history, audit, captured snapshot explain it) |

### 1.4 Quick service and fast food

| # | Scenario | Status |
|---|---|---|
| 48 | Combo meal: burger + fries + drink, swap fries for rings (+5) | **X** (line components) |
| 49 | "No onions, extra cheese" | A/S (modifier options with price delta) |
| 50 | Modifier inside a modifier (choose sauce for the side) | **X** (nested choices) |
| 51 | Order number on screen for pickup | A (OrderNumberPolicy) |
| 52 | Pay first, then cook (QSR) | P (FireTimingPolicy AT_CONFIRM) |
| 53 | Self-order kiosk | C (channel + kiosk terminal; same operations) |
| 54 | Peak: 300 orders an hour | ARCH/BUILD load test (no design blocker) |

### 1.5 Pizza

| # | Scenario | Status |
|---|---|---|
| 55 | Half pepperoni, half margherita, priced by the higher half | **X** (line components + pricing rule) |
| 56 | Size changes the price of every topping | **X** (variant-dependent modifier price) |
| 57 | Buy one get one | S/C (W7 promotions; line-level BOGO needs line targeting) |

### 1.6 Grill, seafood, sweets: by weight

| # | Scenario | Status |
|---|---|---|
| 58 | Kofta by the kilo, 0.750 kg | A (quantity decimal(19,6), unit precision) |
| 59 | Fish chosen from the display, weighed, cooked a chosen way | A weight + S modifiers |
| 60 | Scale connected to the POS | C (device adapter contract) |
| 61 | Price per kilo changes daily | S (price windows, E-35) |

### 1.7 Bakery, pastry, juice

| # | Scenario | Status |
|---|---|---|
| 62 | Cake ordered 3 days ahead with a deposit | C (FA-8: deposits, credit module) |
| 63 | Daily production, unsold items wasted | S design (production, waste modules: 0 built) |
| 64 | Same product sold by piece and by box | **X/C** (variants or units per product) |

### 1.8 Delivery and cloud kitchen

| # | Scenario | Status |
|---|---|---|
| 65 | Talabat / Mrsool order arrives in the POS | C (delivery module designed, 0 built; aggregator adapter contract) |
| 66 | Aggregator price differs from the menu | S (price per channel) |
| 67 | Own drivers, cash collected by the driver | C (delivery + driver settlement, PD-V4-13) |
| 68 | One kitchen, three brands | C (brand dimension: catalog and receipt identity) |
| 69 | Takeaway becomes dine-in | C (FA-3 ChangeChannel) |

### 1.9 Fine dining and hotel

| # | Scenario | Status |
|---|---|---|
| 70 | Order by seat, serve by seat | **X** (seat on the line) |
| 71 | Charge to room | C (external folio adapter) |
| 72 | Wine by the glass and by the bottle | **X/C** (variants) |
| 73 | Pre-bill printed, guest asks for changes | S (PRE_BILL print, PRN-GAP) |
| 74 | Reservation with deposit | C (reservations: not in canonical) |

### 1.10 Food court, kiosk, street food (koshary, foul)

| # | Scenario | Status |
|---|---|---|
| 75 | Very fast cash-only, no tables | A (counter flow) |
| 76 | Token system | A (order number) |
| 77 | Tiny menu, no modifiers | A |

### 1.11 Chains and franchises

| # | Scenario | Status |
|---|---|---|
| 78 | One menu, branch-specific prices | S (price per branch) |
| 79 | Branch closes for renovation | S (Branch.active, availability) |
| 80 | Central kitchen supplies branches | S design (transfers, production: 0 built) |
| 81 | Head office sees all branches live | ARCH (§2.4) |
| 82 | Franchisee owns the data of their branch | ARCH (deployment per franchisee) |
| 83 | 3 branches, internet down at one | **ARCH** (§2.4) |

### 1.12 Legal and fiscal (Egypt now, other markets later)

| # | Scenario | Status |
|---|---|---|
| 84 | E-receipt per completed check | S (E-40) |
| 85 | Business buyer asks for a tax invoice | C (e-invoice document type beside the e-receipt) |
| 86 | Item exempt from VAT | S (tax policy 0 with fiscal subtype; one component) |
| 87 | Saudi Arabia later (ZATCA) | C (new compliance adapter; E-40 rule) |
| 88 | VAT rate changes by law next month | S (TaxPolicy.Configure + approval; future-dated rates: open seam W2) |
| 89 | Retention and erasure of personal data | S doc (W12, counsel) |
| 90 | Audit by the tax authority: prove every receipt | S (per-device chain, immutable payload, history) |

## 2. The structural findings, honestly

### 2.1 The order line is the most important widening

**Today:** a line is `productSnapshot + modifierSnapshot (flat) + quantity + priceCapture`.

**What the market needs is a tree:**
- a parent line with **components**: combo slots, pizza halves, set-menu courses;
- each component with its own choices, nested one level;
- an optional **seat**;
- an optional **share** (one item split between guests).

**Why it matters now:** kitchen tickets, the fiscal mapping (an ETA line per sold item) and the UI are about to be built on the flat line. Widening the line later means migrating all of them.

**The foundation supports it:** a pricing snapshot already stores lists. Only the line record, the pricing calculator inputs, the kitchen snapshot and the fiscal mapper change. It is a **design decision to make before R05 and F1 are built**, not after.

**Variants** (S/M/L) already exist as a record, but adding them to an order is refused today. They belong in the same widening.

### 2.2 Tax and charges as components

Today the model has one tax policy per product, plus a separate service policy. The market has:
- stacked taxes (table tax plus VAT);
- exempt items;
- service;
- minimum charge;
- entry fees.

**One "charge component" model covers all of them:**
- type, base, order, rate or amount;
- taxable or not;
- fiscal code per adapter.

`PricingSnapshot.components/charges` already persist lists, so this is additive.

### 2.3 Visit with joined tables

A visit becomes "one guest party at one or more tables". Splitting and merging checks (PD-V4-09) needs settlement reallocation semantics. Both are additive on top of E-31/E-37.

### 2.4 Selling without internet, several branches (ARCH)

**Facts:**
- the field says an outage must not stop sales;
- POS vendors keep selling offline and queue the cloud parts;
- the canonical already designs an `offline` module (`OfflineCommand`, `Sync.*`);
- it is PD_HELD (PD-V4-05).

**One branch:** an on-premises server keeps every till working on the LAN. This needs no offline mode.

**Several branches:** a central server breaks the field rule.

**Options:**
- **(a) One deployment per branch, with a consolidation service for head-office reports.** Simple, matches "dedicated deployment", no sync conflicts.
- **(b) A central deployment, with branch-local continuity through the offline module.** More capable, but much more engineering: conflict rules and business date offline.

**Recommendation:** (a) for the first multi-branch clients; (b) only when a chain requires a live shared state across branches.

## 3. What this means for the plan

1. Nothing in the foundation needs to change. The accepted work stays.
2. Before R05 (Fire/Confirm) and F1 (fiscal) are built, DOMAIN specifies the **line tree** (§2.1) and the **charge components** (§2.2) as the next DOMAIN slices. BUILD reviews the data shape before implementing on it.
3. Joined tables, split/merge, tips, wallets, ChangeChannel, staff meal, export and deposits are additive capabilities. They are queued by sellable impact.
4. §2.4 is the one architecture decision for the owner and BUILD before the first multi-branch sale.

## Sources (public)

- Silverware, offline behaviour during service: https://www.silverwarepos.com/silverware-knowledge-base/what-happens-when-a-restaurant-pos-system-goes-offline-during-service
- Toast, offline mode: https://support.toasttab.com/en/article/Offline-Mode-Using-Toast-During-a-ISP-Outage
- Vista, merged tables move items to separate checks: https://help.vista.co/hc/en-nz/articles/12735709384345
- Square community, sharing one item between guests is not supported: https://community.squareup.com/t5/Archived-Discussions-Read-Only/Essential-Suggestions-Split-Items-QR-Codes-on-Receipts-Hiding/td-p/318634
- Stripe, hospitality POS (coursing, split by seat, item or evenly): https://stripe.com/resources/more/hospitality-pos-systems
- Expert Market, common restaurant POS problems: https://expertmarket.com/pos/common-pos-problems-in-restaurants
