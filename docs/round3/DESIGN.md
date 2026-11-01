# Round 3 — From feedback to root causes (design brief)

Sources: meeting of 2026-10-31 (transcripts T1/T2), 13 prototype notes (F2-01..07, F3-01..06), the 45-task handoff
(P0-001..P2-045, acceptance A01..A22) and the reports research pack (`NerdPOS_Reports_Research_Pack`, copied under
`docs/round3/research/`). Owner decisions taken on 2026-11-01 are marked **[OWNER]**.

The goal is not to patch 13 notes one by one. Each note is a symptom of a missing principle. Fix the principle once,
in the mock server and the shared UI, and every screen that touches it inherits the fix.

---

## Principle 1 — Who did it vs who allowed it (authority and accountability)

**Symptoms:** F3-03 (staff meal needs manager authorisation), F3-04 (cashier voids, manager authorises on the same
screen by code/card/fingerprint), F2-01 (refund "approve & pay" should be the manager's PIN on the cashier screen),
F2-02 (removing items before payment needs permission + a trace of every line added/removed), F3-01 (staff meals
must be cancellable/returnable before kitchen, after kitchen and after close, each with its own permission), meeting
E10/E11 (three void tiers, actor + authoriser logged, payout from the cashier's own drawer), short/long void
(resellable vs spoiled; the branch manager keeps spoiled items for the accountant to verify).

**Root cause:** the prototype models permission as "the logged-in user has it or not". A restaurant works on
*delegated authority*: the person at the terminal performs the action, a supervisor authorises it in place, and the
record keeps both. Reversals are not one action ("void") — their risk and authority depend on the **stage** of the
money: not yet visible → visible to the guest (pre-bill printed / sent to kitchen) → paid in an open day → paid in a
closed day.

**Design:**
1. **Supervisor override in the kernel.** When the actor lacks the permission of an operation (or the operation's
   approval rule fires), the server answers `APPROVAL_REQUIRED` with the action; an approver who *holds* the
   permission grants it on the same device (PIN, manager card, or fingerprint — card/fingerprint simulated) or
   remotely (approval request → notification on the manager's device). The command then runs as the actor, with the
   grant id recorded. One-use, TTL, bound to action/target/context/terminal, self-approval denied. This removes the
   need to "log in as the manager".
2. **Reversal stages** (one policy, used by sale lines, whole checks and staff meals):
   | Stage | Meaning | Default authority |
   |---|---|---|
   | S0 `UNSENT` | line entered, not on a pre-bill, not sent | **manager approval** **[OWNER: every removal before payment needs a manager — PIN or notification]** |
   | S1 `VISIBLE` | pre-bill printed or sent to kitchen, unpaid | manager approval (void before cash) + disposition |
   | S2 `PAID_OPEN_DAY` | paid, business day still open | manager approval; cashier pays out from **their own drawer** (void after cash / same-day refund) |
   | S3 `PAID_CLOSED_DAY` | business day closed | third-level authority (owner / accountant permission); closed day never rewritten — the return posts in today's date and links to the original |
   Every removal at every stage is written to the check timeline and the audit (who, who approved, terminal, stage,
   reason, quantity, value) — removal is never silent.
3. **Disposition of a voided item** (short vs long void): `NOT_PREPARED` (nothing made), `RETURN_TO_STOCK`
   (resellable, e.g. a sealed can), `WASTE_HELD` (spoiled/unsafe — physically kept for review). `WASTE_HELD` items
   enter an **accountant void review queue**: the accountant marks each one "seen/verified" or "missing" (a missing
   item is a red flag on the approver). This is the control loop the experts described.
4. **Staff meals are real orders with zero price** — identified employee (from users), manager authorisation,
   daily allowance per employee measured by **sale value or cost** (policy), stock consumed like a sale, cancellable
   through the same stages, and reported separately (never as sales, never as discounts).

## Principle 2 — Trusted time

**Symptoms:** F2-03, meeting E09 ("ألغيها ألغيها أحسن").
**[OWNER]:** the clock is shown normally; what is dangerous is *changing the accounting time*.
**Root cause:** the demo let anyone move the server/business clock. In the product, transaction time and business
date come from the server and nobody (not even the owner) edits them; terminal OS time is irrelevant.
**Design:** remove every UI control that moves the clock (demo bar included). Show server time read-only with a
"مش قابل للتعديل" hint. Anything that needs "another time" becomes a **read-only preview** (e.g. "the menu the
cashier will see at 20:00") or uses seeded historical data — never a change of ledger time. Scripted scenarios stop
moving the clock (age records instead).

## Principle 3 — The venue configures operations (the "Lego" principle)

**Symptoms:** F3-02 (ready column only on the dispatch screen; each station sees its own work), F2-06 (Start is
optional; timer starts on arrival), meeting E06 (all-day counts fixed in view), F3-05/F3-06 (online vs wallet vs card
duplication; reference optional per venue), F2-05 + E13 (bulk price change with item exceptions; managers create sale
channels like "طلبات"), E03 (no more checks than guests), E08 (short display number vs immutable transaction id),
E16 (logo, receipt/A4 templates, second language on receipt/kitchen/menu), P1-041 (per-role and per-user
permission overrides; manager is not a super-user), meeting (licensed modules are controlled by the vendor, not by
the owner or their IT).
**Root cause:** these were hard-coded behaviours. They are venue policies.
**Design:**
- **KDS screens subscribe to stations.** Each kitchen screen (terminal) has: stations it shows, whether it is a
  dispatch/expo screen (only dispatch screens show "جاهز للتسليم"), whether "ابدأ" is shown (policy:
  hidden/optional/required — the timer always starts at arrival; "start" records a separate timestamp). The all-day
  summary is a fixed panel, never scrolled away.
- **Tender taxonomy** answers "how did the money arrive?": `CASH`, `CARD` (card terminal), `WALLET` (InstaPay,
  Vodafone Cash… — provider chosen once, not duplicated elsewhere), `PREPAID` (already paid before arrival: delivery
  app or payment link — only on orders that came that way), `POINTS`. Reference capture per method is a policy:
  off / optional / required. No separate "أونلاين" button at the counter.
- **Sales channels are records, not an enum.** A sales channel (صالة، تيك أواي، دليفري، طلبات، …) has an order type
  (dine-in / takeaway / delivery — drives kitchen, service charge, delivery) and its own price list. Authorised users
  create channels. Bulk price change: choose channels + scope, preview, **exclude items** (row checkboxes / exception
  list), apply; exceptions are kept and visible.
- **Split limit = guests.** Splitting a visit cannot create more checks than its guest count (policy).
- **Order numbers:** transaction id is immutable and always on the receipt; a short display number is optional
  (reset at business-day close or every N) for the guest/kitchen call-out.
- **Receipt & report templates:** venue logo, header/footer, receipt (80mm) and A4 layouts, second-language lines on
  receipt / kitchen ticket / menu (only if the item has a second name — no machine translation).
- **Permissions:** role defaults + per-user grants/revocations, all audited. **Capabilities/licensing are
  vendor-only** (hidden from the owner, reachable only by the support/vendor role).

## Principle 4 — Journeys follow the thing, not the module

**Symptoms:** F2-04 (inventory, menu, receiving, adding a product and setting stock are scattered; needs detailed
search with follow-up), F2-07 (delivery customer panel crowds the screen), meeting E14 (reorder = target − on hand,
editable), procurement four stages (store request → purchase order → receipt → supplier invoice; quantities can be
100 → 80 → 60; or a direct supplier invoice), pack sizes (750ml / 1L / 5L each its own card, with a "best value"
suggestion from consumption).
**Root cause:** screens mirror the data model (products here, stock items there, recipes elsewhere). Users think in
*things* (this dish, this ingredient, this supplier) and their *lifecycle*.
**Design:** a global search (people, dishes, ingredients, suppliers, purchase orders, checks, customers) with result
chips and "follow" (pin a thing and see its live status); an **item 360** page showing the whole lifecycle (requested →
ordered → received → in stock → sold/wasted, prices, where used); a guided "new product" flow that covers menu,
prices per channel, tax, recipe or stock tracking, levels and first receipt in one place; purchasing as the four
linked documents with variances visible; compact, collapsible customer header on delivery.

## Principle 5 — Reports are a layered engine where every number can be proven

**Symptoms:** meeting E15 + P1-032/033/037 ("tables/layers so the AI can collect data later", "the accountant must
know where every piaster went", "templates like the receipt with logo, date range", "top 10–15 reports"), the
research pack (semantic layer, certified metrics, reconciliation, lineage, NOT_AVAILABLE ≠ 0, asOf/provisional,
expert sign-off, deterministic assistant first).
**[OWNER]:** a rule-based assistant now; what matters is to show the intent very clearly and deeply.
**Design (layers):**
- **L0 facts** — the mock already holds the events (orders/lines/discounts/tenders/refunds/cash entries/kitchen/
  delivery/inventory/approvals/audit/fiscal).
- **L1 semantic registry** — metrics (id, ar/en label, plain definition, formula, grain, unit, additivity,
  compatible dimensions, authority, version, pitfalls) and dimensions; illegal combinations refused; unavailable
  source → `NOT_AVAILABLE(reason)`, never 0.
- **L2 report manifests** — certified reports composed only of registered metrics/dimensions (pilot set of 15 from
  research §8: daily sales/EOD bridge, split & check trace, drawer X/Z, tenders & settlement, discounts/comps/voids
  by stage, refunds by business date and original check, top/bottom items, sales by hour/daypart, channels &
  aggregator economics, staff meals, stock on hand & waste, purchasing PO/GRN, VAT & e-receipt status, kitchen times,
  branch comparison) plus a rounding report and the void review queue.
- **L3 analysis** — compare periods, trend, "why did it change" decomposition (volume × price × mix, with an
  explicit unexplained residual), menu matrix.
- **L4 evidence** — every number opens the checks/lines/events behind it; every report shows business date,
  timezone, asOf, provisional flag, metric definitions and version, and its reconciliation checks.
- **L5 actions** — drafts only through existing approvals (later).
- **Assistant** — deterministic Egyptian-Arabic Q&A over L1–L4 using the 198-question bank as intents: answers with a
  structured result + chips (definition, filters, asOf, source checks, not-available), asks one question when
  ambiguous, refuses to invent.
- **Templates & exports** — branded receipt/A4 report templates, CSV/Excel, schedule; numbers equal the ledger.
- **Expert review inside the prototype** — per report: the checklist (definition, example, edge cases: refunds across
  days, split checks, comps, staff meals, delivery fees, tax-inclusive prices, voids after kitchen), sign-off by role
  (operations / accountant / auditor) with comments, exported with feedback.

## Non-negotiables (from the handoff)
- Never delete or hide genuine sales; no "filter receipts before tax submission" feature (E20 is NON_COMPLIANT).
- Closed days are immutable; corrections are new, linked events.
- Money in Decimal minor units; Largest-Remainder/Last-Share split stays as captured.
- Plain language for demo users; technical detail only behind «تفاصيل تقنية».
- Keep `FAILURES: 0` on the journeys test; update journeys that relied on old behaviour (e.g. clock moves, free line
  removal) rather than deleting them.
