# Research brief — NerdPOS Reports Engine (for an AI research agent)

> Paste everything below the line into a research-capable AI agent (deep research / web browsing on).
> Attach, if the agent accepts files: `docs/pack/reference/27_OPERATOR_REPORTS.md`, `docs/pack/reference/25_SERVICE_CHARGE.md`,
> `docs/pack/reference/19_EGYPT_E_RECEIPT_REQUIREMENTS.md`, `docs/reports/REPORTS_PRELIMINARY_RESEARCH.md`.

---

## Your role

You are a senior product researcher for restaurant POS analytics. You combine three kinds of expertise: restaurant
operations and finance (F&B controlling, food cost, cash control), BI / semantic-layer design (metrics, dimensions,
grains, governance), and conversational analytics (LLM assistants that answer questions over business data).

## The product and why this research matters

NerdPOS is a cloud restaurant POS built first for **Egypt** (Arabic-first, Egyptian wording, EGP, Africa/Cairo
business day that starts at 04:00, 14% VAT, service charge often 12%, the Egyptian Tax Authority e-receipt system,
cash-heavy payments plus cards, InstaPay and wallets, delivery apps, multi-branch chains). Modules: dine-in floor and
kitchen, takeaway/counter, delivery with drivers, customers and loyalty, inventory with recipes and purchasing, menu
with sizes/combos/half-and-half and dayparts, promotions, shifts and drawers, refunds, approvals and audit, offline mode.

We want the **reports engine to be a real competitive advantage**: the most complete, trustworthy and useful reporting
in the market, organised in layers, so that later a **mini chatbot** can answer any reporting question in Egyptian
Arabic or English, explain the answer, show where every number comes from, and propose actions.

Existing design rules we keep (from our canonical reporting spec):
- Report templates cannot invent metrics; every report is built from **registered metrics over registered dimensions**.
- Every value has **lineage and drill-down** (you can always go from a number to the transactions behind it).
- A capability that does not exist returns **"not available", never 0** (e.g. guest count without tables).
- Facts are filtered by **business date**, not calendar date; refunds count on their payout date and never restate a
  closed day; tenders (money collected) are never called sales; service charge is its own measure, not net sales.
- Reports read a consistent snapshot (`asOf`) and mark results **provisional** while a day or shift is still open.
- Today the catalog has 8 reports (daily sales, tenders, products, staff, exceptions, shift, peak hours, branch
  comparison), 14 dimensions and ~28 metrics, plus 7 reconciliation checks.

## Research questions

Answer each with evidence. Separate **what you found** (with a source) from **what you infer or recommend**.

### A. The market: what restaurant POS reporting looks like today
1. For each of these products, what reports, dashboards and analytics exist, how they are organised, what they cost
   (tier/add-on) and what users praise or complain about: Toast (incl. Toast IQ), Square for Restaurants (incl. Square
   AI), Lightspeed Restaurant (Advanced Insights, Lightspeed AI, Benchmarks), Oracle Simphony + Reporting & Analytics,
   NCR Aloha / Voyix, Revel, TouchBistro, Clover, SpotOn, Owner.com or similar, Odoo POS, Loyverse, and regional
   players: Foodics (incl. Foodics BI), Rewaa, Marn, BIM POS, Ziina/Geidea-linked POS, and any Egyptian-founded POS
   (search Egyptian startup databases, Wamda, Arabic sources).
2. Which of them have a conversational assistant? What can it answer, what can't it, how accurate is it (look for
   independent reviews, community forums, Reddit, app-store reviews), does it show sources/lineage, can it take actions?
3. Back-office analytics specialists that sit on top of POS (e.g. Restaurant365, MarginEdge, Crunchtime, Avero,
   Tenzo, Nory, 7shifts reports, Supy, Apicbase) — which reports do operators pay extra for, and why?
4. Benchmarking products (peer comparison) and what data/privacy model they use.

### B. The complete catalog of restaurant reports
5. Build the most complete catalog you can of reports a restaurant operator, owner, accountant, chef, auditor and
   chain HQ need. Cover at least these families, and add any you find: sales & revenue; checks & service speed;
   menu engineering & product mix; channels (dine-in, takeaway, delivery, aggregators, online); payments & cash control;
   shifts, drawers & Z; discounts, comps, voids, refunds & exceptions (loss prevention / fraud signals); staff
   performance & labour (if labour data exists); customers, loyalty & retention (cohorts, RFM, lifetime value);
   delivery operations (times, drivers, zones, failed attempts); kitchen performance (ticket times by station, refires);
   inventory & food cost (theoretical vs actual, variance, waste, yield, price changes from suppliers); purchasing &
   suppliers; promotions & campaign ROI; reservations & table turns; tax & e-receipt compliance (Egypt ETA); accounting
   exports & reconciliations; multi-branch / franchise comparison; forecasting & planning (demand, prep, purchasing);
   system health & data quality.
6. For each report give: purpose (decision it supports), audience/role, frequency, period type, metrics, dimensions,
   filters, standard visual, drill-down path, benchmarks/targets used, alert thresholds, Egyptian specifics, and
   whether competitors offer it (which ones).

### C. The semantic layer (what the chatbot will stand on)
7. Propose a **metric dictionary**: name (ar/en), definition in plain words, exact formula, grain, additivity (can it be
   summed across days/branches?), unit, which facts it reads, known pitfalls (e.g. average check vs average order value,
   gross vs net, sales vs tenders, refunds timing), and authority (canonical / market convention / our proposal).
8. Propose a **dimension registry** and hierarchies (time: business date → week → month; hour/daypart; branch →
   area → chain; menu: product → size → category → menu; channel; staff; customer segments; drivers/zones; stations;
   suppliers; tax groups), with which metrics may be sliced by which dimensions.
9. Best practices from semantic layers / metric stores (dbt Semantic Layer / MetricFlow, Cube, LookML, AtScale,
   Malloy, Power BI semantic models) that matter for a POS: versioned definitions, certified metrics, row-level
   security by branch/role, time-intelligence, currency/inflation adjustment.

### D. The layers of a reports engine
10. Validate or improve this layer model and give examples of products that implement each layer well:
    L0 facts/events → L1 semantic layer (metrics & dimensions) → L2 report catalog (standard reports) → L3 analysis
    primitives (compare, trend, decomposition/"why did it change", anomaly detection, forecasting, cohort, menu
    engineering matrix, basket/affinity, contribution margin) → L4 insights & narrative (auto-written explanations with
    lineage) → L5 actions (suggested actions that go through normal permissions and approvals) — with the
    conversational layer able to use every layer.
11. Which analysis primitives give the most value per effort for Egyptian restaurants?

### E. The mini chatbot
12. What questions do operators actually ask? Build a **question bank of 150+ real-style questions** in Egyptian
    Arabic (with English) across roles, each mapped to metrics, dimensions, period and the expected answer shape
    (number, table, chart, explanation, action). Include ambiguous ones ("المبيعات عاملة إيه؟", "ليه الأسبوع ده وحش؟")
    and how the assistant should clarify.
13. Architecture patterns that make such assistants accurate and safe: query over a semantic layer instead of raw
    SQL, tool/function calling, retrieval of metric definitions, clarification policy, showing assumptions, citations to
    transactions, refusing to invent numbers, permission-aware answers, cost/latency, offline behaviour, evaluation sets.
    Cite evidence on accuracy (independent where possible).
14. What would make our assistant **clearly better than Toast IQ / Square AI / Lightspeed AI / Foodics BI** for an
    Egyptian operator? Think: dialect, reconciliation-aware answers, explaining differences between reports,
    proactive daily briefing on WhatsApp, approvals and actions, expert-validated definitions, "show me the checks behind
    this number".

### F. Egypt specifics and regulation
15. ETA e-receipt/e-invoice reporting obligations, VAT and service-charge reporting, record keeping, what accountants
    in Egypt need from a POS (formats, exports to local accounting software), and data protection (Egypt Personal Data
    Protection Law 151/2020) implications for customer analytics and an AI assistant.
16. Market behaviours that change reports: high inflation and frequent price changes, cash dominance and cash
    shortages, delivery-app commissions, Ramadan/Eid seasonality, late-night peaks, multi-currency suppliers.

## Method

- Prefer primary sources (vendor docs, help centres, release notes, regulator sites) and independent user feedback.
  Note the date of every source; prefer 2025–2026. Say when something could not be verified.
- Don't stop at marketing pages: find report lists in help centres and documentation.
- Arabic sources are welcome; translate key points.
- No invented features, numbers or quotes. Mark low-confidence items.

## Deliverables (structured, in this order)

1. **Executive summary** (1 page): the market, the gaps, and the top 10 recommendations for a differentiated engine.
2. **Competitor matrix**: products × capabilities (report families, customisation, scheduling, exports, benchmarking,
   AI assistant, lineage, actions, Arabic support, price), each cell sourced.
3. **Report catalog** (table, one row per report) with the fields in question 6, grouped by family and tagged
   MUST / SHOULD / LATER for an Egyptian launch.
4. **Metric dictionary** and **dimension registry** (tables, as in questions 7–8).
5. **Layer model** with examples and the recommended analysis primitives.
6. **Chatbot design notes** + the **question bank** (CSV-friendly table: id, role, question_ar, question_en, intent,
   metrics, dimensions, period, answer_shape, clarification_needed).
7. **Egypt compliance & market notes**.
8. **Expert review checklist**: what a restaurant expert, an accountant and an auditor should verify in each report
   (definitions, numbers reconcile, edge cases like refunds across days, split checks, comps, delivery fees, tax-inclusive
   prices, voids after kitchen).
9. **Open questions** we must decide, with options and your recommendation.
10. **Sources** list with dates.
