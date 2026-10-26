# Screens and journeys

The badge per area comes from `contracts/operations.json` (`backend_state`) or from `03_DIRECTION.md`.

## A. Device and people

| Screen | Content | Main operations |
|---|---|---|
| A1 Login and PIN | user picks name, enters PIN; terminal identity shown; lockout after failed tries | `Auth.*`, `Access.Me`, `Session.Current` |
| A2 Users and roles (admin) | create user, assign roles and branches, reset credential (approval by policy) | `User.Create`, `User.ManageAccess`, `Role.*`, `Credential.Reset` |

## B. Menu and prices (back office)

| Screen | Content | Main operations |
|---|---|---|
| B1 Menu admin | categories, units, products (sku auto if empty, name uniqueness policy, image, colour), modifier groups and options, branch availability (sold out, blocked with reason) | `Category.*`, `Unit.*`, `Product.*`, `ModifierGroup.*`, `ModifierOption.*`, `Product.SetAvailability` |
| B2 Prices | per product × branch × channel, with effective windows (now or scheduled), history list, approval when PRICE_CHANGE requires it | `Catalog.SetPrice`, `Product.PriceHistory` |
| B3 Taxes | tax policies (rate, inclusive/exclusive, rounding), archive only when unused, approval on rate change | `TaxPolicy.Create/Configure/SetActive/List` |
| B4 Settings and reason codes | the real settings screen (the Policy Panel is the demo version of it), reason codes per kind (void, discount, cash move, refund…) | `Settings.*`, `ReasonCode.*` |
| B5 Menu import | upload a sheet (parsed in the browser) → dry-run report with issues per row → apply all-or-nothing | `Catalog.Import` |
| B6 Promotions | coded and scheduled promotions (happy hour), no stacking by default | `Promotion.*` |

## C. Floor and order taking (waiter tablet and cashier)

| Screen | Content | Main operations |
|---|---|---|
| C1 Floor plan | areas and tables; free, occupied, inactive; guest count; time seated; server; joined tables (direction) | `Table.List`, `TableVisit.Open/Transfer/Close/List` |
| C2 Order entry | menu tiles (image, colour, price from the server quote only), modifiers with min/max, notes, quantity (weight with decimals), the check with lines by round; sizes, combos, half-and-half, seats (direction, badge `مقترح`) | `Order.Create`, `Order.AddLines`, `Order.UpdateLine`, `Order.RemoveLine`, `Pricing.QuoteItem`, `Catalog.Search`, `ModifierGroup.List` |
| C3 Send to kitchen | "send round" button; fired lines lock (edit and remove disabled, only void with approval or move); round status per station (sent, pending, failed, re-send) | `Order.Fire`, `Kitchen.OrderFulfillment`, `Kitchen.Resend` |
| C4 Check actions | void line (approval), comp (approval), discount (approval above threshold), move lines to another check of the visit, cancel unfired check (reason) | `Order.VoidLine`, `Order.Comp`, `Order.ApplyDiscount`, `Order.MoveLines`, `Order.Cancel` |
| C5 Manager approval popup | appears on APPROVAL_REQUIRED, shows exactly what is approved (action and context), manager enters PIN, the original action retries automatically; self-approval refused | `Approval.Grant` |

## D. Collecting (cashier)

| Screen | Content | Main operations |
|---|---|---|
| D1 Pay | bill (pre-bill print), confirm, pay cash (tendered and change), card recorded with terminal reference, split tender, partial payment, remaining shown; complete when paid; split check, tips, wallets (direction) | `Order.Confirm`, `Payment.Capture`, `Payment.GetSettlement`, `Order.Complete` |
| D2 Find and reopen checks | search by number, table, time; reopen view after a lost response or a restart (the same command never runs twice) | `Order.Find`, `Order.Get` |
| D3 Refunds | refund request, manager approval, payout; return receipt (direction for the fiscal part) | `Refund.*` |

## E. Shift and drawer

| Screen | Content | Main operations |
|---|---|---|
| E1 Open shift | opening float | `Session.Open` |
| E2 Cash moves | cash in / out with reason and approval by policy; no-sale drawer open | `Cash.Move`, `Drawer.OpenNoSale` |
| E3 X and Z | X report anytime; close with blind count, variance, approval above threshold, Z report; unpaid floor checks listed as outstanding, never blocking | `Session.XReport`, `Session.Close` |

## F. Kitchen

| Screen | Content | Main operations |
|---|---|---|
| F1 Kitchen display | tickets per station by round, bump item/ticket, cancelled lines shown struck through, late-ticket timer | `Kitchen.Board`, `Kitchen.AdvanceTicket` |
| F2 Stations and routing (admin) | stations; routing rules (product, category, channel, priority, catch-all) | `KitchenStation.*`, `RoutingRule.*` |

## G. Receipts, printing, e-receipt

| Screen | Content | Main operations |
|---|---|---|
| G1 Receipt preview | Arabic receipt with service line between subtotal and VAT, QR of the e-receipt, COPY watermark on reprint | `Receipt.Get`, `Print.Reprint` |
| G2 Print queue | failed jobs badge, retry, reprint | `PrintJob.*` |
| G3 E-receipt queue (manager) | documents pending data (missing item code, …), built, submitted, accepted, rejected; alerts before the 24 h deadline; reissue | `Compliance.Find`, `Compliance.ReissueDocument` |
| G4 Fiscal setup (installation) | branch fiscal profile, devices per terminal, item code mapping | `FiscalProfile.Configure`, `FiscalDevice.*`, `FiscalItemMapping.SetMany` |

## H. Reports

| Screen | Content |
|---|---|
| H1 Daily operator reports | sales, tax, tenders, service (separate from sales), discounts, comps, voids, refunds, by business date, branch, cashier |

## Journeys that must run end to end in the demo

1. **Setup from zero** (`journeys/SETUP_JOURNEY_J-A1.md`): branch, users, import menu, taxes, prices, tables, stations, fiscal setup, first sale.
2. **Dine-in day** (`journeys/OPERATOR_WALKTHROUGH_J-R1_R4.md`):
   - seat a party;
   - waiter orders from the tablet without a drawer;
   - send round 1;
   - add round 2;
   - void a fired line with approval;
   - bill;
   - cashier collects cash and card;
   - the table frees itself;
   - the kitchen screen follows;
   - the shift closes with X/Z.
3. **Counter and takeaway:** order, pay first (fire at confirm), receipt.
4. **Failures:**
   - lost response on payment, then retry (no double charge);
   - two devices edit one check (one conflict);
   - printer down;
   - kitchen screen down, then re-send;
   - e-receipt platform down for a day (queue and alerts).
