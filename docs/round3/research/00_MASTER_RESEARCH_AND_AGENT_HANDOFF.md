# nerdPOS — Reports Engine Deep Research & Agent Handoff
**Version:** 2026-11-01 · **Audience:** nerdBRANDIA product owner, restaurant experts, engineers and successor AI agents  
**Scope:** reporting/analytics/semantic metrics and eventual conversational insights for Egyptian restaurant POS  
**State:** external research + IMPLEMENTATION PROPOSALS, **NOT** a repo audit or evidence that code is working.

## Start here: what to do with this pack
This is a **completed research synthesis and structured implementation input**, not merely a research prompt. Deliver it **alongside** the existing nerdPOS meeting/feedback handoff: https://docs.google.com/document/d/1Id7wMfJZeWLeoyrUECYY3lMydgmEwQkGIOyyP2Ae7xw/edit?usp=drivesdk. Do not silently replace the decisions already in that handoff. The `REPORTS_PRELIMINARY_RESEARCH.md` and `REPORTS_RESEARCH_PROMPT.md` used to build this are copied under `inputs/` in the ZIP.

**Critical distinction:** The uploaded research brief describes 8 prototype reports, 14 dimensions, ~28 metrics, 7 reconciliations and `Report.Run/List/Export/Schedule` as SPECIFIED. These are **user-provided assertions from preliminary notes**, not freshly inspected current code or an accepted 2026-11-01 repo baseline. Historical files `27_OPERATOR_REPORTS.md`, `25_SERVICE_CHARGE.md`, and `19_EGYPT_E_RECEIPT_REQUIREMENTS.md` were REFERENCED by the user brief but **were not supplied for direct review here**; successor must inspect the actual files before adopting contract claims. The pack CSV metrics are design candidates with an `authority` field, not certified source of truth.

## 1. Executive brief — ten grounded decisions
1. **The differentiator is assurance, not "ask my sales" alone.** Toast IQ, Square Managerbot, Lightspeed AI already provide conversation-driven analytics; some provide actions or saved AI-generated charts. See [SRC01]–[SRC07].
2. **Competitive gap = explainable money.** Every report amount must link to check/line/discount/refund/tender evidence, with a faithful reconciliation. Oracle and NCR already have granular audit reports; therefore "drill down exists" is not novel on its own. Differentiation is making drill-down *universal and reconciled* for Egyptian operations. [SRC13]–[SRC17].
3. **Foodics BI is much more mature than the original short preliminary summary implies.** It documents menu engineering, inventory, KDS, retention, sales forecasting, drill-down and scheduled PDF/XLSX/CSV. NerdPOS cannot credibly market "first restaurant BI". [SRC10]–[SRC12].
4. **Define metric semantics once.** Database schema ≠ business definitions. MetricFlow demonstrates metric/dimension modeling and grain-specific SQL construction. Each metric needs authoritative lineage and version. [SRC28]–[SRC29].
5. **Stop LLMs from improvising joins or business logic.** A 2026 paired study (+17–23 percentage points improvement) still only reports about 68% after semantic context, on 100 retail questions; not a 95–100% reliability guarantee. Only certified queries/fixtures can establish acceptable correctness. [SRC31].
6. **Financial concepts stay separate:** merchandise net sales, service charges, VAT, cash/card/wallet tenders, refunds, outstanding receivables, gift/employee meals and drawer movements. Oracle's daily operations explicitly presents distinct metrics. [SRC14].
7. **Business date, asOf, and immutable closed-day reporting are product contracts.** The uploaded brief: Egypt timezone, operational day cutoff 04:00, refunds on payout business date, open-day metrics provisional. Preserve, verify against actual accepted contract. Never silently rewrite completed EOD.
8. **Report UX must serve operators, not accountants only.** One independent small Reddit conversation complains of poor restaurant POS report navigation and inability to find dish profitability; treat it as qualitative inspiration rather than quantified market proof. [SRC37].
9. **Egypt localization isn't applying 14% everywhere.** ETA says restaurant VAT treatment depends on establishment type and registration/conditions. ETA also documents specific eReceipt submission/return requirements, which must be implemented from the current authoritative official specification and tax-advisor review. [SRC32]–[SRC36].
10. **Ship certified reports before chatbot or autonomous actions.** The meeting itself explicitly prioritized 10–15 report templates and separated the AI assistant as optional later. QA-driven delivery is the critical path, not a flashy chat UI.

### Scope-specific ranking, not a universal release promise
**MUST for pilot (proposed):** daily sales/EOD bridge; tender/shift close; check and split trace; void/refund and approval audit; cashier/drawer discrepancy; sales by channel; top items; food waste; ETA status if integration is actually required; multi-branch reports when relevant; data freshness/sync exceptions.  
**SHOULD next:** menu profitability where versioned recipes exist; supplier cost trends; partial receipt variance; delivery net after platform commissions; KDS performance; report templates and saved views.  
**LATER:** RFM/cohorts, forecasting, labor costs without payroll data, personalized AI forecasting, WhatsApp briefing and write-enabled agents.  
**Negative gate:** If a source domain is absent, return `NOT_AVAILABLE(reason)`; never zero.

## 2. Corrections to preliminary research — explicit provenance
| Earlier provisional claim | Verified current evidence | Implication |
|---|---|---|
| "Toast IQ is only a Q&A assistant" | Toast reports limited operational actions incl. stock/menu actions; current product claims Toast IQ included with Toast POS [SRC01][SRC02][SRC03]. | Do not market bounded actions as unique. Require rigorous approval/audit to differentiate. |
| "Square AI is still just open beta Q&A" | Square announced **Managerbot open beta** in April 2026, successor to Square AI, with proactive operations features [SRC04]. | Compare with current Square product, not 2025 state. |
| "Lightspeed AI can't preserve actionable outputs" | Oct 22 2026: AI-generated custom charts / saved charts as live reports [SRC07]. | Build saved chart UX only if it improves reconciled metrics. |
| "Foodics BI has executive-only basic reports" | Their help center covers inventory, KDS, retention, menu engineering, daily comparisons, forecasts and report scheduling [SRC10][SRC11][SRC12]. | Use real MENA benchmark and don't understate capabilities. |
| "Semantic layers yield 95–100% accuracy" | Independent 2026 benchmark: +17–23 pp but absolute ~67.7–68.7% on selected 100 retail prompts [SRC31]. | Need a certified question golden set and refusals; no uncontrolled generative numeric claims. |
| "Egypt VAT = 14% for every restaurant" | ETA describes legal registration/type scope and exceptions [SRC35][SRC36]. | Configurable tax groups with legal certification, never hard-code universal validity. |
| "All reports currently work in backend" | The uploaded brief explicitly says several operations are `SPECIFIED` not built. Current source not inspected. | First agent task: verify repo and mocks versus runtime. |

## 3. Competitive evidence: what is genuinely offered
The accompanying `01_COMPETITOR_MATRIX.csv` distinguishes **documented**, **not verified**, **tier-dependent** and **vendor self-report**. `NOT VERIFIED` never means a competitor lacks the feature. Snapshot of major findings:

- **Toast IQ** ([SRC01]–[SRC03]): vendor Q1 2026 usage 47% of using locations asked sales/revenue, 34% menu/inventory, 29% operations/reporting. Q2 vendor observations prioritize discount and void controls. It can perform a limited set of actions; vendor statistics don't measure answer accuracy independently.
- **Square** ([SRC04][SRC05]): successor Managerbot in open beta Apr 2026. AI-generated report charts and dashboard context are not proof that every query numerically reconciles. No Egyptian Arabic localization was verified.
- **Lightspeed** ([SRC06]–[SRC09]): AI conversational, custom saved self-updating charts by Oct 22; Advanced Reporting offers custom templates/exports; neighborhood benchmarks require suitable plan and user eligibility. Tier/region vary.
- **Foodics BI** ([SRC10]–[SRC12]): menu engineering categories (Stars, Horses, Puzzles, Turtles), drill-down, KDS, inventory, customer retention, forecasts, schedules PDF/XLSX/CSV; documented reporting depth strong. A public Arabic Egyptian conversational agent and its exact capabilities were **not verified**, which is not evidence of absence.
- **Oracle Simphony** ([SRC13]–[SRC15]): extensive domain reports incl. waste, menu affinity, operating metrics, employee exceptions, KDS; separates net sales, tax, service and collections. Significantly more than a dashboard.
- **NCR Aloha** ([SRC16][SRC17]): includes employee, device, void audit, tax, discounts, refunds, sales. Gross and net definitions vary across products; avoid copying labels without operational definitions.
- **SpotOn** ([SRC20]): vendor claims 70+ prebuilt reports. **TouchBistro** ([SRC18]): vendor claims 50+ real-time reports. **Loyverse** ([SRC21][SRC22]): free sales analytics for 31 days, paid history/add-ons, a real low-cost baseline. **Rewaa** ([SRC23][SRC24]): Arabic sales/inventory/financial and item-movement traceability.
- **R365** ([SRC25]–[SRC27]): sophisticated food+labor prime cost, recipe costing, actual/budget and exposed data grains; e.g. labor-category report repeats net sales for each labor category — naive summation double-counts it. This is a concrete caution for our semantic join/grain planning.
- **Unverified during this pass:** exact product-specific 2026 capabilities/pricing for Odoo, Revel, Marn, BIM POS, Tenzo, Avero, Supy, Crunchtime, MarginEdge, 7shifts. They remain benchmark candidates; the table avoids invented feature scores.

### What operators independently say (qualitative only)
- One Oct 2025 r/restaurantowners conversation asks for clearer dish profitability and complains about reports written for accountants rather than operators [SRC37]. Sample tiny, anonymous, not market sizing.
- Individual Toast users have alleged shift tip/report discrepancies and delayed sync in 2026 [SRC38][SRC39]; individual Square operators have alleged sync/payment friction [SRC40]. These are **unverified anecdotes** not established vendor defects. They motivate release tests (offline replay, payout ledger, asOf).
- Reddit and helpdesk threads are not a substitute for audited QA or a representative market study. Never present counts of such anecdotes as prevalence.

## 4. Semantic foundation — don't start with AI or a list of charts
Recommended dependency DAG:
`Current immutable business events / ledger` → `facts at explicit grain` → `certified metrics + dimension graph` → `reconciliation engine` → `report manifests/templates` → `analysis primitives` → `explanations/lineage` → `read-only semantic assistant` → `reviewed actions`.

**L0 Facts / events.** Authoritative events: check/visit, order+lines+modifiers, tender and refund, signed tax/service/discount, drawer open/count/payout/withdrawal, KDS state, delivery, inventory, PO/GRN/vendor invoice, approval/audit and ETA submissions. Every event records `(event_id, tenant_id, branch_id, source_id, business_date, occurred_at, recorded_at, source_command_id, actor_id, asOf/processing_version)` where applicable. `event_id` / payment intent idempotency prevents double count; recording date cannot be overwritten by changing laptop time.

**L1 Certified semantic registry.** Each metric requires identifier, bilingual label, formula, grain, event source, sign, unit, compatible dimensions, additivity, `asOf`, security classification, owner, version, SQL/query plan and golden checks. Explicit fact-dimension graph must reject cross-fact fanouts. Row/field access is enforced server-side (not prompt alone). Note Power BI [SRC30] warns RLS depends on role and elevated workspace permissions, so do not copy RLS permission semantics blindly.

**L2 Report manifests.** Report = authorized composition of registered metrics/dimensions/filter schemas, sorting, default period, drill-down, visual and exports. A report never defines new finance logic in a React component.

**L3 Analysis tools.** `compare_periods`, `trend`, `delta_decompose` (price × quantity × mix), `menu_matrix`, `anomaly`, `contribution_margin`, `cohort`, `forecast`. Prefer deterministic baseline comparisons before causal language. Mark seasonal forecasts uncertain and require source history.

**L4 Explain + evidence.** Answer has metric IDs and versions, precise filter set, time zone/business date, `asOf`, provisional flag, breakdown, reconciliation delta, confidence/availability and links to immutable checks/events. 'Why' means a *bounded mathematical decomposition*, not a fictional operational cause. Narratives should say `unexplained` when residual remains.

**L5 Actions.** Only a draft (`PriceChange.Draft`, `Reorder.Draft`, `Campaign.Draft`, etc.), explicit human review and existing server approvals, with audit and idempotency. **AI cannot issue direct database writes, bypass void rules or post fiscal deletions**. This stage can remain disabled entirely for pilot.

### Grain / additivity rules the agent must prove
1. `stock_on_hand` and `inventory_value` are **semi-additive**: aggregate locations at same instant; never sum closing stock over seven days.
2. Percent and averages are ratios of combined numerators and denominators; averaging site percentages is wrong unless weighted appropriately.
3. Staff/labor category rows may repeat branch sales; joining `sales` fact to `labor` fact on date can multiply sales. See R365 API [SRC27].
4. `Order`, `TableVisit`, `Check`, `Payment` and `Refund` IDs are not interchangeable. Splitting one order into 3 checks doesn't mean 3 orders or 3 guests.
5. `Gross sales`, `Net sales`, `Collections` and `Total charged` may differ legitimately. Label reports with exact definitions and joinable reconciliation bridge.
6. `asOf` controls late-arriving sync and updates: closed EOD isn't silently revised by a delayed event. Depending on confirmed accounting policy, append correction and show both effective business date and recorded/settled date.
7. Customer counts must be pseudonymized/consented and `NOT_AVAILABLE` when customer identity doesn't exist; staff labor cost must not be guessed from sales.
8. External provider settlement differs from payment success and from sales revenue; track payout reconciliation and delay.

### Suggested JSON response envelope (new PROPOSAL; not claimed existing)
```json
{
  "report_id":"R-001",
  "metric_version":"to-be-verified",
  "status":"PROVISIONAL",
  "business_date":"2026-10-31",
  "timezone":"Africa/Cairo",
  "as_of":"2026-11-01T00:00:00Z",
  "filters":{"branch_ids":["authorized_branch"]},
  "metrics":[{"id":"net_item_sales","unit":"EGP","value_minor":null,"availability":"NOT_AVAILABLE","reason":"no verified fact run"}],
  "reconciliation":{"status":"NOT_RUN","delta_minor":null},
  "lineage":{"source_event_ids":[],"drilldown_url":null},
  "notes":["This is a shape example, not live revenue data."]
}
```

## 5. Financial ground truth: worked fixtures
The following are **synthetic test fixtures**, NOT Trippio or NerdPOS real money records. `10000` means 100.00 EGP in piasters.

**Split allocation:** total 10,000 minor units, 3 guests, base = floor(10,000 / 3) = 3,333, residual = 1. Captured prototype policy `LARGEST_REMAINDER` + `LAST_SHARE` yields **33.33 + 33.33 + 33.34 = 100.00 EGP** (subject to actual accepted implementation proof). It should never leave 0.01 orphan, modify VAT document just to absorb piaster, or recompute paid shares.

**Sales-vs-cash bridge:** a check can be recognized as payable yet remain unpaid; receipts from prior business-date invoices can be collected today; refunds paid today can relate to prior-day sales. Therefore `sales(t)` ≠ `tenders(t)` is not automatically an error. Show explainable bridging events by `business_date`, `payout_date`, `origin_check_id`, `event_id`.

**Drawer:** opening 100 + accepted cash 50 − completed refund payout 20 − authorized cash-out 10 = expected 120; physically counted 120 => variance 0. Card tenders don't increase physical cash. A payout is not also an ordinary sale discount.

**Menu matrix:** recipe cost must be effective **at time of sale**, not the latest product cost that was edited a month later; if recipe absent, show popularity/sales and `cost unavailable`, never margin zero.

## 6. Egypt: compliance and cultural fit (verification gates)
- The user brief captures `Africa/Cairo`, business-day cutoff `04:00`, and Egypt-first EGP, with `RoundingPolicy HALF_UP/2` and `SplitAllocationPolicy LARGEST_REMAINDER/LAST_SHARE` in the meeting/prototype feedback snapshot. This is **captured product policy**, not a statutory Egyptian time-cutoff standard; it must be verified against the current accepted configuration.
- Egyptian Tax Authority eReceipt FAQ [SRC33] currently describes common submission limits including **24-hour allowed duration** (special rules and late reason required), receipt batches up to 500/1.5MB, max 300 items and maximum 540-day return receipt window. Exact legal/technical applicability and regulatory versions must be validated for tenant and ETA environment; do not transform a forum '24–48h' remark into compliance rules.
- ETA API [SRC34] includes submission, search, recent receipts, return receipts and submission result/notifications. Report **SANDBOX vs PRODUCTION** explicitly and don't mark preview QR as accepted by authority.
- ETA restaurant VAT notice [SRC35] explains standard 14% rules and conditional coverage depending on tourist/ordinary restaurant class and registration. A demo `12%` service charge and tax treatment in the prototype are **configuration**, not automatically a legal requirement. Obtain Egyptian accountant/tax attorney approval before live filing.
- Egypt personal-data law 151/2020 and subsequent regulations must be reviewed with local counsel before cross-branch profiling, WhatsApp messages, customer RFM and transferring personal data to LLMs or overseas processors; this research pack **does not certify compliance**. Minimize PII, avoid prompt logging of identifiable guest details, provide role-based restrictions and audit data export.
- Egyptian language and operational words: 'شيك'≠'أوردر'; 'مبيعات'≠'المقبوضات'; 'مسحوبات'≠'مصروفات'; 'فويد قبل الدفع'≠'مرتجع بعد قفل اليوم'. Train assistant eval on these distinctions.
- Inflation/price-change reporting should separate units, realized price, mix and input-cost inflation; don't make causal claims from trend alone. Ramadan/Eid and late-night visits follow business-date/timezone with explicit period labeling.

## 7. User-facing prototype design: progressive analytics
**Layer 1 (operator/manager, under 30sec):** top KPI strip showing `net sales`, `tender`, `open checks`, `cash variance`, `refund amount`, `exceptions` plus a visible PROVISIONAL pill if shift/day open. All numbers link to detail. Keep dense tables separate from cards, proper RTL text and EGP formatting.

**Layer 2 (task context):** contextual report pages for owner, accountant, chef, floor manager and branch manager; rank reports by day-to-day decisions. Missing-data states must carry exact reason and recovery; don't show 0. Use selected `business_date` and `asOf` in every heading/export.

**Layer 3 (report builder):** certified metric picker; dimension combinations checked by compatible facts and join graph; report template/saved views; server-enforced report permissions; CSV/Excel/PDF export only if that format is implemented and tested.

**Layer 4 (assistant):** read-only, Egyptian dialect query UX backed by the exact report engine; first show structured result with chips `definition`, `filters`, `asOf`, `source checks`, `unavailable`; if ambiguous, ask one decisive question. Optional natural-language narrative only after fixed function calling and a question gold set. Bounded offline: use cached stamped snapshots marked `STALE` if permitted, never imply live state.

**Layer 5 (action drafts):** out of first pilot. Suggestions like reordering ingredients or changing channel prices require explicit preview and approvals; never silently post them from AI.

## 8. Native operator reports to prioritize during review
Suggested shortlist for expert meeting: **Daily Sales/EOD; Split & Check Reconciliation; Cash Drawer X/Z; Payment Method/Settlement; Discount/Comp/Void audit; Refund by business date and original check; Top/Bottom Items; Sales by Hour/Daypart; Channel+Aggregator Economics; Staff Meal; Stock On Hand/Waste; Purchasing PO/GRN; VAT/eReceipt Status; KDS Prep Time; Branch Comparison.** Final list must be approved by manager+accountant and reflects actual available modules. Don't fabricate 15 delivered screens from it.

## 9. Independent expert review checklist
For **each report**, record: exact label in Egyptian Arabic, owner/reader role, decision, business definition and example, event grain, money sign/exclusion, legal/tax applicability, dimension joins, business date behavior, EOD prior-day return behavior, sample negative data, reconciliation equation, prior/next period comparability, role/branch RLS, last data event and `asOf`, provisional/closed flag, source check deep link, export parity, minimal UI readability and whether it is truly possible from available facts.

**Restaurant operations expert** validates real use cases (dine-in visit vs split checks, stations, staff meals, rush-hour, comp reason, waste/resale), chooses the first 10–15 reports, and signs off expected field names.

**Egyptian accountant** validates net/gross tax/service, refund/payout date, drawer/multi-tender, VAT scope and corrections after closed EOD. Must sign off synthetic journal outcomes to the piaster.

**Auditor** validates void before cash after preliminary receipt, manager approval, self-approval denial, immutable audit, receipt-to-tax traceability, cross-branch security, reconciliation failures and no anti-audit mechanisms.

**Engineer + QA** validate exact source event links, freshness, no duplicate replay, consistent snapshot, deterministic query layer, numeric overflow/precision, aggregation and guardrails; record executed test IDs and logs.

## 10. Open decisions (no silent defaults)
| ID | Question | Options | Research recommendation | Owner evidence |
|---|---|---|---|---|
| OD01 | First chatbot role | owner only / manager / accountant | Pilot read-only owner+accountant with strict branch grants; not chef payroll | Product owner + auditor |
| OD02 | Conversational UX | deterministic semantic Q&A / LLM+tools | Deterministic first; LLM only after offline gold eval and privacy controls | Product owner + engineering |
| OD03 | Metric naming and sign | vendor conventions differ | Current accepted contract wins; accountant certifies all sign rules | Accountant |
| OD04 | Gross sales definition | before or after returns/voids by event-time | Have separate published labels, never ambiguous 'gross' | Accountant |
| OD05 | Refund timing | original date / payout date | Preserve captured canonical *payout business date* for reporting, verify posted ledger | Accountant + dev |
| OD06 | Customer cohorts | enabled / opt-in / disabled | Disabled until identity/consent/privacy proved | Privacy owner |
| OD07 | Food cost | weighted avg / FIFO / other | Respect existing inventory valuation and recipe version | Stock/accountant |
| OD08 | Payroll/labor | integrated / no module | `NOT_AVAILABLE` until real payroll/time tracking source | Owner |
| OD09 | ETA production status | sandbox / production | Current captured = SANDBOX; no fiscal claims for pilot without provider verification | Legal/compliance |
| OD10 | Benchmarking | opt in / none | Later; aggregation floor, consent, anonymity reviewed | Product/legal |
| OD11 | Report period week start | Saturday / Sunday / configured | Business calendar config, ask if natural-language period ambiguous | Ops |
| OD12 | Proactive WhatsApp | enabled / later | Later; opt-in recipients, sensitive content and export controls | Product/privacy |
| OD13 | Reconcile refund incl. service/tax | per component rules | Use original taxable basis and authorized return event, accountant approves | Accountant |
| OD14 | Metric definitions versioning | evolving without history / versioned | Versioned; saves past asOf and definitions | Engineering |
| OD15 | Report cost/pricing | base / add-on | Don't choose without acquisition economics and operator feedback | Commercial |

## 11. Actionable agent workflow
**Phase A.** Verify actual current repo/branch/commit/dirty state and user-selected prototype. Read `docs/pack/reference/27_OPERATOR_REPORTS.md`, `25_SERVICE_CHARGE.md`, `19_EGYPT_E_RECEIPT_REQUIREMENTS.md` if present. Document missing sources and distinguish uploaded preliminary assumptions from verified code. Compare the attached latest meeting feedback handoff and captured Policy Snapshot. DO NOT rewrite accepted decisions.

**Phase B.** Create a read-only gap matrix for all rows of `02_REPORT_CATALOG.csv`, `03_METRIC_DICTIONARY.csv`, `04_DIMENSION_REGISTRY.csv`. Status = `VERIFIED_RUNNING`, `SPECIFIED_NOT_IMPLEMENTED`, `MOCK_ONLY`, `REQUESTED`, `NOT_APPLICABLE`, `UNVERIFIED`. Do not infer a route exists from catalog row.

**Phase C.** Implement only currently absent high-priority certified pieces, respecting architecture and code ownership. Follow `07_AGENT_EXECUTION_BOARD.csv`, preserve accepted Factory/Canonical V4 if relevant to actual repo, and avoid direct generated-file edits. Verify SQL aggregates against a transaction fixture and 7 reconciliation checks or the actual accepted list.

**Phase D.** UI and question experience only after report parity. Evaluate `05_QUESTION_BANK_AR_EN.csv` against a read-only seeded DB. Distinguish natural language classifier success from numeric correctness; score answer and provenance separately. Produce coverage by family and explicit NOT_AVAILABLE/refusal tests.

**Phase E.** Deliver real screenshots, runnable test outputs, source snippets and reviewed signoffs. Any report with unknown data provenance stays unfinished; pilot gate is evidence not a percentage.

### Copyable successor-agent instruction
> Take the existing nerdPOS prototype and its current accepted source contracts as the code baseline. Read this entire research pack plus the October 31 meeting handoff, the original attached files and internal reporting specs. Treat external market assertions as competitive research, and CSV metric/report entries as proposals only. Verify current implementation and statuses before edits; freeze existing accepted policies. Produce a repo-pinned 1:1 mapping from 198 questions, report catalog and metric registry to actual facts, operations, queries, permissions, event lineage and tests; prioritize 10–15 operator-certified reports and money reconciliation. Make changes only on authorized paths/branches. Never invent metrics, SQL joins, user data, source locations, test runs, availability, fiscal compliance or production status. A missing capability returns NOT_AVAILABLE, not 0. Show exact checks and EOD receipts behind all financial numbers. No live financial write/AI action without conventional authorization. Return the verified code diff, tests/evidence and unresolved gaps, not another architecture essay.

## 12. Limitations of this research
This is an externally sourced market and architecture review conducted **2026-11-01** using current primary-source documentation, limited Reddit anecdotes and a 2026 research paper. No vendor demo licenses or internal competitor accounts were used. Not all requested smaller/regional vendors exposed independently verifiable public detailed features, especially pricing; cells are marked unknown rather than guessed. Source vendor claims (counts, impact) are not independent validation. No current NerdPOS source repo was inspected, no SQL executed, no law firm opinion given, and none of the acceptance tests in `06_RECON_AND_ACCEPTANCE_TESTS.csv` have been run. Competitive conditions may change after this research date.

## 13. Structured appendices
The full catalog, certified-metric *candidates*, dimensions, Egyptian Arabic question bank, tests, competitor matrix and source URLs are included below for a one-file read **and** as CSV files for automatic parsing in the ZIP. CSV is the machine-readable counterpart. `08_SOURCES.csv` is the source provenance ledger.

## APPENDIX A — Competitor evidence matrix

| product | segment | verified_scope | conversational_ai | actions | lineage | public_price | arabic_egypt | source_ids | limitations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Toast / Toast IQ | Restaurant POS | Sales/labor/menu/guest, voids, inventory, daily briefings | Yes, Toast IQ | Yes: stock/menu and other bounded actions reported | yes, vendor-described platform connected | included according to current Toast IQ product page | not verified for Arabic Egypt | SRC01,SRC02,SRC03 | Vendor self-report; do not claim independent accuracy or local availability |
| Square / Managerbot | POS + seller analytics | Sales, employee, customers, local trends, real-time tables/charts | Yes, Square AI → Managerbot open beta | Yes/beta proactive tasks; scope varies | not verified per-response | beta/pricing varies; not verified | not verified Arabic Egypt | SRC04,SRC05 | Square AI is not the full current status after Managerbot |
| Lightspeed Restaurant | Hospitality POS | Advanced reporting, staff, benchmark market, AI charts | Yes, Lightspeed AI | Saved AI charts live; autonomous actions roadmap | not verified | Advanced Insights tier/region; quote for AI | not verified Arabic | SRC06,SRC07,SRC08,SRC09 | 2026-10-22 launched saved reports; L/K product variants |
| Foodics BI / Foodics AI | MENA F&B | Inventory, KDS, retention, product mix, menu engineering, scheduling, forecasting | No verified Arabic conversational assistant in reviewed sources | not verified | Yes: documented drilldown | quote/availability unknown | regional Arabic core product; BI chat not proven | SRC10,SRC11,SRC12 | Deep BI established; absence of chat mention is not proof none exists |
| Oracle MICROS Simphony | Enterprise F&B | Extensive daily operations, audits, performance, menu, employee, kitchen, finances | No source-backed conversational report assistant found in scoped docs | not verified | Yes, many report drilldowns | enterprise quote | localized versions by deployment | SRC13,SRC14,SRC15 | Permission by component/report; strong benchmark |
| NCR Voyix Aloha | Restaurant POS | Void audit, refunds, payments, item mix, device/employee, labor | not verified | not verified | Yes: multi-report detail | enterprise quote | not verified | SRC16,SRC17 | Gross vs net definitions differ among vendors |
| TouchBistro | Restaurant POS | >50 real-time reports claimed, menu/staff/CRM, emailed daily | not verified | not verified | not verified at transaction line level | quote | not verified | SRC18 | Vendor number; not independently audited |
| Clover | Merchant POS | Hourly/item/location, refunds, discounts, EOD, exports | not verified | not verified | not verified | quote | not verified | SRC19 | Documented business tracking feature set |
| SpotOn | Restaurant POS | >70 reports claimed, daily recap, hourly, labor, item mix, automated subscriptions | not verified | not verified | not verified | quote | not verified | SRC20 | Vendor help center count |
| Loyverse | Small merchant POS | Sales items categories, shifts, low stock, customer history | not verified | not verified | receipt records available; lineage not verified | Free base, 31-day sales, paid long history and add-ons | not verified | SRC21,SRC22 | Pricing is site-country dependent |
| Rewaa | Saudi retail/F&B platform | Sales, stock, finance statements, tax reports, product movements | not verified | not verified | Some movement ref traceability; not universal | quote | Arabic yes | SRC23,SRC24 | Relevant MENA Arabic reporting reference |
| Restaurant365 | Restaurant accounting/ops | Prime cost, labor, GL, recipe, food cost, P&L, data extracts | Advisor AI mentioned in docs, full capabilities not assessed | not verified | Detailed grains with repetition warnings | quote | not verified | SRC25,SRC26,SRC27 | Powerful accounting stack, not direct checkout POS |
| Odoo POS | ERP/POS | Sales and accounting modules; precise restaurant BI scope not independently validated here | not verified | not verified | not verified | community/enterprise editions vary | not verified | NONE | Coverage gap, no categorical claims |
| Revel | Restaurant POS | Reporting claims not verified in primary docs this pass | not verified | not verified | not verified | quote | not verified | NONE | Open evidence gap |
| Marn | Saudi POS | Specific reporting evidence not verified in primary docs this pass | not verified | not verified | not verified | quote | Arabic-market positioning only | NONE | Open evidence gap |
| BIM POS | Egypt/MENA POS | Detailed current report catalog not verified in primary docs this pass | not verified | not verified | not verified | quote | Arabic-market positioning to verify | NONE | Open evidence gap |
| 7shifts | Labor/scheduling analytics | Labor, staffing/sales forecasts (market context) | not verified | not verified | not verified | subscription tiers vary | not verified | SRC37 | Adjacent competitor; ask operator prior to new feature development |
| Avero / Tenzo / Crunchtime / MarginEdge / Supy | Specialist analytics | Specialist labor/food cost/inventory; row-level feature claims not independently verified here | not verified | not verified | not verified | quote | not verified | NONE | Group retained as candidate vendor deep dive, not scored |


## APPENDIX B — Full report catalog

| report_id | family | title_ar | decision_supported | audience | cadence | metrics | dimensions | visual | drilldown | priority_proposed | prototype_status | source_ids |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-001 | Sales & finance | ملخص المبيعات اليومية | Explain daily recognized sales vs payments | owner;accountant | daily and on-demand | gross_item_sales;discount_amount;net_item_sales;tax_amount;service_charge;tender_collected | business_date;branch;channel | KPI+waterfall | business date>orders>check>line | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-002 | Sales & finance | المبيعات حسب الساعة | Staff peak operation | manager;owner | daily and on-demand | net_item_sales;order_count | hour;branch;channel | line+heatmap | hour>checks | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-003 | Sales & finance | المبيعات حسب قناة البيع | Compare dine-in versus delivery | owner;manager | daily and on-demand | net_item_sales;order_count | channel;branch;business_date | stacked bar | channel>orders | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-004 | Sales & finance | مقارنة الفترات | Same business week comparisons | owner | daily and on-demand | net_item_sales;order_count;avg_check | business_date;branch | two-series line | date>checks | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-005 | Sales & finance | إجمالي الضريبة والخدمة | No blending VAT and service with sales | accountant | daily and on-demand | tax_amount;service_charge;net_item_sales | tax_group;channel;business_date | table+waterfall | tax group>legal receipt | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-006 | Sales & finance | مبيعات معلقة غير محصلة | Avoid equating sales and tenders | manager;accountant | daily and on-demand | recognized_sales_total;tender_collected | branch;check;business_date | aging table | open check>payment attempts | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-007 | Sales & finance | اتجاه المبيعات المعدّل بالسعر | Separate volume growth from price hikes | owner | weekly and on-demand | net_item_sales;sold_quantity | product;business_week;branch | decomposition | category>product>sale lines | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-008 | Sales & finance | المبيعات حسب فترة التشغيل | Match staffing to demand | manager | weekly and on-demand | net_item_sales;order_count | daypart;branch;channel | heatmap | daypart>check | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-009 | Menu & product | أعلى وأقل الأصناف | Understand demand | manager;owner | daily and on-demand | sold_quantity;net_item_sales | product;category;business_date | ranked bar | product>line | MUST | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-010 | Menu & product | مصفوفة هندسة المنيو | Stars puzzles horses turtles | owner;chef | weekly and on-demand | menu_contribution;menu_popularity | product;category;branch | scatter | item>recipe and sales | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-011 | Menu & product | تحليل الأحجام والإضافات | Modifier profitability | chef;manager | weekly and on-demand | sold_quantity;net_item_sales | size;modifier;product | bar+table | modifier combo>ticket | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-012 | Menu & product | مبيعات الكومبو | Avoid double count bundle children | manager | weekly and on-demand | sold_quantity;net_item_sales | product;channel;business_date | matrix | parent bundle>children | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-013 | Menu & product | هامش مساهمة الصنف | Price/recipe choices | chef;owner | weekly and on-demand | menu_contribution;menu_contribution_pct | product;branch;category | matrix | product>recipe>valuation | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-014 | Menu & product | أصناف توقف بيعها | Stock-out lost demand proxy | manager;chef | weekly and on-demand | sold_quantity;net_item_sales | product;business_date;branch | event timeline | stock event>sales | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-015 | Menu & product | العلاقات بين الأصناف | Upsell candidates | marketing;owner | weekly and on-demand | sold_quantity;order_count | product;business_week;branch | affinity grid | pair>eligible checks | LATER | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-016 | Menu & product | هدر وتحضير أصناف | Reduce waste | chef;accountant | weekly and on-demand | stock_waste_qty;food_theoretical_cost | product;branch;business_date | table | waste>recipe consumption | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-017 | Tables & service | زيارات الترابيزات | Understand seating | manager | daily and on-demand | table_turns;guest_count | table;branch;business_date | map+timeline | visit>checks | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-018 | Tables & service | متوسط الشيك والضيف | Revenue per guest/check | owner;manager | daily and on-demand | avg_check;avg_guest_spend | branch;channel;daypart | KPI+trend | visit>checks>lines | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-019 | Tables & service | مدة القعدة | Turn times | floor_manager | weekly and on-demand | avg_dining_minutes;table_turns | table;daypart;branch | distribution | table>visit | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-020 | Tables & service | الشيكات المفتوحة والمتأخرة | Find stuck checks | floor_manager;accountant | daily and on-demand | check_count;recognized_sales_total | check;branch;business_date | aging grid | check>events | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-021 | Tables & service | أثر تقسيم الشيك | No orphan cents/lines | accountant;manager | daily and on-demand | check_count;recognized_sales_total;tender_collected | table_visit;check;branch | audit table | visit>parent check>child allocations | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-022 | Tables & service | حركة وتنظيف الترابيزات | Seat turnover bottlenecks | floor_manager | weekly and on-demand | table_turns;avg_dining_minutes | table;branch;daypart | timeline | visit>dirty/clean state | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-023 | Channels & delivery | مبيعات الدليفري حسب المصدر | App versus internal | owner | daily and on-demand | net_item_sales;order_count | channel;branch;business_date | bar | channel>orders | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-024 | Channels & delivery | صافي أثر عمولة التطبيقات | Find true platform profitability | owner;accountant | weekly and on-demand | aggregator_commission;net_item_sales | channel;branch;business_week | waterfall | settlement>order>fee | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-025 | Channels & delivery | مناطق ورسوم التوصيل | Fair fees & operations | delivery_manager | weekly and on-demand | delivery_fee_net;delivery_avg_minutes | zone;branch;channel | map+table | zone>delivery ids | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-026 | Channels & delivery | أداء الطيارين | Training and routing | delivery_manager | weekly and on-demand | delivery_avg_minutes;order_count | driver;zone;business_date | table | driver>trips | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-027 | Channels & delivery | محاولات التوصيل الفاشلة | Reduce failed orders | delivery_manager | weekly and on-demand | order_count;delivery_avg_minutes | zone;driver;business_date | event table | delivery>attempt | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-028 | Channels & delivery | عمولات ورسوم القناة | Correct channel P&L | accountant | weekly and on-demand | aggregator_commission;delivery_fee_net | channel;business_date;branch | waterfall | platform invoice>order | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-029 | Payments & cash | مطابقة وسائل الدفع | Money collected not revenue | accountant;cashier | daily and on-demand | tender_collected;tender_refunded;net_tender_movement | payment_method;branch;business_date | payment matrix | tender>transaction>check | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-030 | Payments & cash | إقفال وردية X وZ | Reconcile till | cashier;manager | daily and on-demand | cash_expected;cash_counted;cash_variance | drawer;staff;business_date | closing sheet | session>cash events | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-031 | Payments & cash | فتح الدرج بدون بيع | Fraud prevention | manager;auditor | daily and on-demand | approval_count | drawer;staff;business_date | audit table | drawer event>reason | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-032 | Payments & cash | متابعة الدفعات المعلقة | Catch payment gaps | accountant | daily and on-demand | tender_collected;payment_count | payment_method;branch;device | status table | intent>callback | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-033 | Payments & cash | مقارنة قبض اليوم بالمبيعات | Explain not equal | accountant | daily and on-demand | net_item_sales;tender_collected;tender_refunded | business_date;branch | waterfall | receivable>check>payment | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-034 | Payments & cash | فروق الكاش حسب الكاشير | Coach and control | manager;accountant | daily and on-demand | cash_variance;cash_expected | staff;drawer;branch | table+trend | cashier>sessions | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-035 | Controls & exception | فواتير محذوفة قبل الدفع | Never silently erase | auditor;manager | daily and on-demand | void_line_count;approval_count | staff;void_reason;business_date | event table | void>preliminary ticket>approval | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-036 | Controls & exception | مرتجعات بعد الدفع | Reconcile refund payout | accountant | daily and on-demand | refund_count;tender_refunded;return_sales_adjustment | business_date;staff;branch | ledger table | refund>original check>actor | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-037 | Controls & exception | مرتجعات بعد قفل اليوم | Keep old day immutable | accountant;auditor | daily and on-demand | refund_count;tender_refunded | business_date;branch;approval_actor | audit grid | return>prior sale>new day | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-038 | Controls & exception | خصومات وضيافات | Cost leak | manager;auditor | daily and on-demand | discount_amount;comps_value | staff;business_date;void_reason | heatmap+table | discount>grant>check | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-039 | Controls & exception | تقرير موافقات المدير | Actor/approver separation | auditor | daily and on-demand | approval_count;refund_count | approval_actor;business_date;branch | log | grant>original action | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-040 | Controls & exception | أنماط الإلغاء المشبوهة | Investigate not accuse | auditor | weekly and on-demand | void_line_count;refund_count | staff;hour;branch | control chart | flag>event set | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-041 | Controls & exception | وجبات الموظفين | Internal consumption | manager;accountant | daily and on-demand | comps_value;food_theoretical_cost | staff;business_date;product | table | meal>grant>stock | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-042 | Labor & people | إنتاجية الويتر | Service coaching | manager | daily and on-demand | net_item_sales;avg_check | staff;business_date;channel | table | waiter>checks | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-043 | Labor & people | أداء الكاشير | Close integrity | manager | daily and on-demand | tender_collected;cash_variance;refund_count | staff;drawer;business_date | scorecard | cashier>sessions | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-044 | Labor & people | تكلفة وساعات العمالة | Cost planning | owner | weekly and on-demand | labor_cost;labor_hours | role;business_date;branch | time series | labor>timecards | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-045 | Labor & people | المبيعات لكل ساعة عمل | Staff planning | owner | weekly and on-demand | net_item_sales;labor_hours | role;daypart;branch | line | labor>sales | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-046 | Labor & people | النوبات والتصحيحات | Detect manipulation | auditor | weekly and on-demand | approval_count;labor_hours | staff;role;business_date | audit log | edit>approver | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-047 | Customers & loyalty | عملاء جدد ومتكررين | Retention planning | marketing | weekly and on-demand | new_customers;repeat_rate | customer_cohort;channel;branch | trend | cohort>customers | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-048 | Customers & loyalty | تحليل أفواج العملاء | Retention | marketing | weekly and on-demand | repeat_rate;avg_check | customer_cohort;business_week | cohort heatmap | cohort>eligible orders | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-049 | Customers & loyalty | قيمة العميل | Value tier | owner | weekly and on-demand | net_item_sales;order_count | customer_cohort;channel | distribution | customer>orders | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-050 | Customers & loyalty | الأرصدة والنقاط | Avoid duplicate points | marketing;accountant | weekly and on-demand | payment_count;net_item_sales | customer_cohort;business_date | audit grid | points>issued/redeemed | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-051 | Kitchen & preparation | وقت التذكرة لكل محطة | Manage bottleneck | chef | weekly and on-demand | kds_avg_ticket_minutes;kds_late_count | branch;daypart;device | boxplot | station>tickets | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-052 | Kitchen & preparation | التذاكر المتأخرة | Peak response | chef | daily and on-demand | kds_late_count | branch;daypart;product | live board | ticket>events | MUST | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-053 | Kitchen & preparation | إعادة التحضير | Food loss | chef | weekly and on-demand | stock_waste_qty;food_theoretical_cost | branch;product;void_reason | table | ticket>reason | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-054 | Kitchen & preparation | تأخر الأوردر قبل بداية التنفيذ | Chef start optional | chef;manager | weekly and on-demand | kds_avg_ticket_minutes | branch;daypart;device | timeline | received>start>ready | SHOULD | NEEDS_REPO_PROOF | SRC13,SRC14,SRC16 |
| R-055 | Inventory & food cost | الرصيد الحالي | Order supply | chef;stock_manager | daily and on-demand | stock_on_hand;inventory_value | inventory_item;location;branch | table | item>movements | MUST | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-056 | Inventory & food cost | الجرد النظري مقابل الفعلي | Control shrink | stock_manager;accountant | weekly and on-demand | stock_variance_qty;stock_waste_qty | inventory_item;location;branch | variance table | count>movements | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-057 | Inventory & food cost | تكلفة الوصفات | Menu profit | chef;owner | weekly and on-demand | food_theoretical_cost;menu_contribution_pct | product;branch;business_date | matrix | recipe>ingredient>invoice | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-058 | Inventory & food cost | سجل الهالك | Reduce loss | stock_manager;auditor | daily and on-demand | stock_waste_qty;food_theoretical_cost | inventory_item;void_reason;branch | audit table | waste>approval | MUST | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-059 | Inventory & food cost | سعر المواد عبر الزمن | Beat inflation | buyer | weekly and on-demand | supplier_price_change | supplier;inventory_item;business_week | trend | receipt>invoice | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-060 | Inventory & food cost | صحة بيانات الوصفات | Avoid fake profit | chef | weekly and on-demand | menu_contribution_pct | product;category;branch | quality checklist | product>recipe | SHOULD | NEEDS_REPO_PROOF | SRC10,SRC11,SRC13 |
| R-061 | Purchasing & suppliers | أوامر الشراء | Purchasing control | buyer | daily and on-demand | po_ordered_value | supplier;branch;business_date | status table | PO>approved lines | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-062 | Purchasing & suppliers | المستلم مقابل المطلوب | Prevent over-count | buyer;accountant | daily and on-demand | goods_received_value;po_ordered_value | supplier;inventory_item;branch | variance table | PO>GRN>invoice | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-063 | Purchasing & suppliers | أداء المورد | Vendor selection | buyer | weekly and on-demand | supplier_price_change;goods_received_value | supplier;inventory_item;business_week | scorecard | supplier>receipts | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-064 | Purchasing & suppliers | مقارنة عبوات المورد | Choose actual unit economics | buyer | weekly and on-demand | supplier_price_change | supplier;inventory_item | unit-cost matrix | pack>base_uom | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-065 | Promotions & marketing | أداء الخصومات | Reduce ineffective offers | marketing | weekly and on-demand | discount_amount;net_item_sales | branch;channel;business_date | table+trend | promotion>discount events | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-066 | Promotions & marketing | العائد الإضافي للعروض | Evaluate ROI | marketing;owner | weekly and on-demand | net_item_sales;order_count | business_week;branch;channel | comparative chart | campaign>control groups | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-067 | Promotions & marketing | العروض حسب الساعة | Campaign scheduling | marketing | weekly and on-demand | net_item_sales;sold_quantity | hour;product;channel | heatmap | hour>orders | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-068 | Reservations | الإشغال والغياب | Seating efficiency | floor_manager | weekly and on-demand | table_turns | table;business_date;daypart | table | booking>visit | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-069 | Reservations | العربون المحصل | Liability accuracy | accountant | weekly and on-demand | tender_collected | business_date;branch | aging table | deposit>event | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-070 | Fiscal & compliance | حالة الإيصالات الإلكترونية | Resolve compliance exceptions | accountant | daily and on-demand | eta_receipt_count;eta_failed_count | fiscal_status;branch;business_date | status table | receipt>response | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-071 | Fiscal & compliance | تسوية ضريبة القيمة المضافة | Correct taxable bases | accountant | daily and on-demand | tax_amount;recognized_sales_total | tax_group;branch;business_date | reconciliation table | tax group>receipt | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-072 | Fiscal & compliance | إيصالات مرتجعات | Legitimate after-sale returns | accountant | weekly and on-demand | eta_receipt_count;eta_failed_count | fiscal_status;business_date;branch | status grid | return>original fiscal receipt | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-073 | Fiscal & compliance | الإيصالات المتأخرة | Prevent overdue submissions | accountant | daily and on-demand | eta_failed_count | branch;business_date;fiscal_status | exception list | submission>reason | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-074 | Accounting & reconciliation | ملف المحاسب اليومي | Trace every EGP | accountant | daily and on-demand | net_item_sales;tender_collected;cash_variance;tax_amount | business_date;branch | export pack | EOD>ledger>source checks | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-075 | Accounting & reconciliation | دفتر حركة الكاش | Audit withdrawals | accountant | daily and on-demand | cash_expected;cash_counted;cash_variance | drawer;staff;business_date | ledger table | drawer>cash event | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-076 | Accounting & reconciliation | مطابقة المحفظة والبنك | Payout reconciliation | accountant | weekly and on-demand | tender_collected;tender_refunded | payment_method;branch;business_date | matching table | processor>payment | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-077 | Accounting & reconciliation | مراجعة الفروقات | Avoid silent 0.01 loss | auditor | daily and on-demand | reconciliation_errors;data_freshness_minutes | branch;business_date;device | exception queue | rule>events | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-078 | Multi-branch | مقارنة الفروع | Store performance | owner | daily and on-demand | net_item_sales;avg_check;order_count | branch;business_date;channel | ranked table | branch>checks | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-079 | Multi-branch | فروق الخصم والهالك بين الفروع | Audit anomalies | owner;auditor | weekly and on-demand | discount_amount;stock_waste_qty;void_line_count | branch;business_week | scatter | branch>exceptions | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-080 | Multi-branch | مبيعات الفروع على نفس الساعة | Peak planning | owner | weekly and on-demand | net_item_sales;order_count | branch;hour;business_date | heatmap | store>hour>tickets | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-081 | Forecast & planning | توقع مبيعات الأسبوع | Prep and staff | owner | weekly and on-demand | net_item_sales;order_count | business_date;branch;channel | forecast band | forecast>training period | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-082 | Forecast & planning | اقتراح إعادة الطلب | Avoid stockout | buyer;chef | weekly and on-demand | stock_on_hand;food_theoretical_cost | inventory_item;location;branch | suggested list | ingredient>stock+forecast | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-083 | Forecast & planning | توقع رمضان والأعياد | Egyptian peak planning | owner | weekly and on-demand | net_item_sales;order_count | business_week;daypart;branch | scenario | event>historical period | LATER | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-084 | System health & quality | صحة مزامنة الأجهزة | No lost/offline orders | admin | daily and on-demand | data_freshness_minutes;reconciliation_errors | device;branch;sync_status | alert table | device>outbox>command | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-085 | System health & quality | الفروقات الحسابية | Trust model | accountant;admin | daily and on-demand | reconciliation_errors | branch;business_date | checks grid | rule>transactions | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-086 | System health & quality | التقارير غير المكتملة | Not available != zero | admin | daily and on-demand | data_freshness_minutes | branch;business_date | availability table | metric>missing source | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-087 | System health & quality | أخطاء الطباعة | No duplicate physical tickets | admin | weekly and on-demand | reconciliation_errors | device;branch;business_date | job timeline | ticket>spool>device | SHOULD | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |
| R-088 | System health & quality | تكرار الأحداث | Idempotency assurance | admin;auditor | daily and on-demand | reconciliation_errors | device;sync_status;branch | anomaly table | intent>replays | MUST | NEEDS_REPO_PROOF | SRC16,SRC25,SRC26 |


## APPENDIX C — Metric dictionary

| metric_id | name_ar | name_en | definition | grain | formula | unit | additivity | fact_sources | compatible_dimensions | pitfall | authority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gross_item_sales | المبيعات قبل الخصومات | Gross item sales | Subtotal of eligible recognized item sales before discounts and add-on taxes | sale_line | SUM(recognized_sale_line.list_price_minor * recognized_qty) using signed sale events | EGP | ADD | sale_line | branch,channel,business_date,product | Pre-void excluded; historical semantic rule must be confirmed | PROPOSED |
| discount_amount | الخصومات | Discount amount | Approved realized discounts only | discount_allocation | SUM(positive recognized discount allocations) | EGP | ADD | discount_event | branch,business_date,discount_reason,staff | Do not count canceled or preview discounts | CANONICAL_INTENT |
| return_sales_adjustment | تسويات مبيعات المرتجعات | Return adjustment to sales | Current business-date negative sale adjustment from authorized returns | return_line | SUM(refundable ex-tax component current payout business date) | EGP | ADD | refund_line | branch,business_date,product | Never rewrite historical closed day; accrual interpretation needs accountant sign-off | CANONICAL_INTENT |
| net_item_sales | صافي مبيعات الأصناف | Net item sales ex-tax | Item sales after discount and return adjustments, excluding service charge and VAT | business_date_branch | gross_item_sales-discount_amount-return_sales_adjustment | EGP | ADD | sale_line,discount_event,refund_line | branch,channel,business_date | Derived; avoid mixing VAT-inclusive row prices | PROPOSED |
| tax_amount | قيمة الضريبة | Tax amount | VAT recorded on valid taxable sale events and legal return corrections | tax_line | SUM(signed tax components of legal sale/return events) | EGP | ADD | tax_line | branch,business_date,tax_group | No blanket 14% unless tax legal qualification holds | CANONICAL_INTENT |
| service_charge | رسوم الخدمة | Service charge | Configurable service charge, separately from item net sales | charge_event | SUM(signed recognized service charge amount) | EGP | ADD | charge_event | branch,channel,business_date | Taxability depends on policy/legal setup | CANONICAL_INTENT |
| other_fees | رسوم أخرى | Other authorized fees | Delivery/other customer charges excluding tax and service | fee_event | SUM(signed authorized fees) | EGP | ADD | fee_event | branch,channel,business_date,fee_type | Not necessarily restaurant revenue when pass-through | PROPOSED |
| recognized_sales_total | إجمالي قيمة الفواتير | Recognized billed amount | Recognized item sale + charges + tax - authorized adjustments | check | net_item_sales + service_charge + tax_amount + other_fees | EGP | ADD | sale_line,charge_event,tax_line,fee_event | branch,channel,business_date | Not necessarily equal cash tender total | PROPOSED |
| tender_collected | إجمالي المتحصلات | Tender collected | Settled/captured positive payments on collection business date | payment_event | SUM(captured tender amount_minor) | EGP | ADD | payment_event | branch,payment_method,business_date,terminal | Do not relabel as sales | CANONICAL_INTENT |
| tender_refunded | مبالغ منصرفة مرتجعات | Tender refunded | Settled refunds paid back to customer | refund_payment | SUM(completed payout amount_minor) | EGP | ADD | refund_payment | branch,payment_method,business_date | Not identical to item return adjustments if pending | CANONICAL_INTENT |
| net_tender_movement | صافي حركة التحصيل | Net tender movement | Customer cash/card/wallet collected less payouts | business_date_branch_tender | tender_collected-tender_refunded | EGP | ADD | payment_event,refund_payment | branch,payment_method,business_date | Does not equal sale revenue due open A/R and timing | PROPOSED |
| cash_expected | الكاش المتوقع | Expected cash drawer | Expected physical cash using drawer open balance and cash-only movements | drawer_session | opening_cash + cash_captured - cash_refunds + cash_in - cash_out | EGP | ADD_ACROSS_SESSIONS_ONLY | drawer_event,payment_event | branch,drawer,cashier,session | Not additive across simultaneous time snapshots | CANONICAL_INTENT |
| cash_counted | الكاش المعدود | Counted cash | Physical cash counted at session close | drawer_session | SUM(last accepted count per closed session) | EGP | ADD_ACROSS_SESSIONS_ONLY | drawer_count | branch,drawer,cashier,session | Cannot sum daily snapshots of same till | CANONICAL_INTENT |
| cash_variance | فرق الدرج | Drawer variance | Counted cash minus expected cash | drawer_session | cash_counted-cash_expected | EGP | ADD_ACROSS_SESSIONS_ONLY | drawer_count,drawer_event | branch,cashier,session | Need authorized corrections, blind close visibility | CANONICAL_INTENT |
| payment_count | عدد الدفعات | Payment count | Count of unique accepted payment intents | payment_intent | COUNT(DISTINCT successful_payment_intent_id) | count | ADD_ACROSS_NONOVERLAP | payment_event | branch,payment_method,business_date | Retry callback must never add a new payment | PROPOSED |
| order_count | عدد الأوردرات | Orders count | Unique completed original orders | order | COUNT(DISTINCT finalized_order_id) | count | ADD_ACROSS_NONOVERLAP | order | branch,channel,business_date | Split checks must not multiply orders | PROPOSED |
| check_count | عدد الشيكات | Checks count | Completed distinct checks subject to split rules | check | COUNT(DISTINCT eligible_closed_check_id) | count | ADD_ACROSS_NONOVERLAP | check | branch,channel,business_date | Define split child check inclusion separately | PROPOSED |
| avg_check | متوسط الشيك | Average check | Net item sales per eligible check | business_date_branch | net_item_sales / NULLIF(check_count,0) | EGP/check | WEIGHTED_RATIO | sale_line,check | branch,channel,business_date | Never SUM averaging per-branch averages | PROPOSED |
| guest_count | عدد الضيوف | Guest count | Total distinct customers/seat count as recorded at visit | visit | SUM(recorded_guest_count per nonduplicated visit) | count | ADD_ACROSS_NONOVERLAP | table_visit | branch,business_date,daypart | NULL if guest data unavailable; do not treat as 0 | CANONICAL_INTENT |
| avg_guest_spend | متوسط صرف الضيف | Average spend per guest | Net item sales per recorded guest | business_date_branch | net_item_sales/NULLIF(guest_count,0) | EGP/guest | WEIGHTED_RATIO | sale_line,table_visit | branch,business_date,daypart | Only if guest counts trustworthy | PROPOSED |
| table_turns | دوران الترابيزات | Table turns | Visits completed at table by business date | table_visit | COUNT(DISTINCT completed_visit_id) | count | ADD_ACROSS_NONOVERLAP | table_visit | branch,table,business_date | Visit not check; not divide by seats | PROPOSED |
| avg_dining_minutes | متوسط مدة الترابيزة | Average dining duration | Visit close minus open time | table_visit | SUM(completed_visit_minutes)/NULLIF(completed_visits,0) | minutes | WEIGHTED_RATIO | table_visit | branch,table,daypart | Unclosed visits excluded or separately disclosed | PROPOSED |
| sold_quantity | كمية الأصناف المباعة | Sold quantity | Net recognized qty per menu item | sale_line | SUM(recognized_quantity - returned_quantity) | unit | ADD | sale_line,refund_line | branch,product,size,channel | Unit/combos/haf-half allocations need lineage | PROPOSED |
| menu_contribution | مساهمة الصنف | Menu contribution | Net sales less direct recipe variable cost | menu_item | SUM(item_net_sales_minor - theoretical_recipe_cost_minor) | EGP | ADD | sale_line,recipe_cost_snapshot | branch,product,business_date | Cost requires versioned recipe and purchase price | PROPOSED |
| menu_contribution_pct | نسبة مساهمة الصنف | Contribution margin % | Contribution margin divided by item net sales | group | menu_contribution / NULLIF(item_net_sales,0) | % | WEIGHTED_RATIO | sale_line,recipe_cost_snapshot | branch,product,category | Not available without recipe & cost basis | PROPOSED |
| menu_popularity | شعبية الصنف | Menu popularity | Share of sold units within eligible menu set | product_period | sold_quantity / NULLIF(total_comparable_sold_qty,0) | % | WEIGHTED_RATIO | sale_line | branch,category,daypart | Do not compare drinks units to portions blindly | PROPOSED |
| food_theoretical_cost | التكلفة النظرية للطعام | Theoretical food cost | Cost from sold/wasted recipes at event-time versions | recipe_usage | SUM(ingredient_qty * effective_unit_cost) | EGP | ADD | recipe_snapshot,stock_valuation | branch,product,business_date | Cost method must be approved: weighted average/FIFO | PROPOSED |
| stock_waste_qty | كمية الهالك | Waste quantity | Stock units moved into documented waste category | inventory_event | SUM(waste_quantity in base_uom) | unit | ADD_BY_SAME_UOM | inventory_event | branch,ingredient,reason,business_date | Cannot SUM kg with liters | PROPOSED |
| stock_variance_qty | فرق الجرد | Stock variance quantity | Counted minus expected stock at count event | stock_count | SUM(counted-expected in base UOM) | unit | ADD_BY_SAME_UOM | inventory_count | branch,ingredient,business_date | Count variance is not a daily stock flow | PROPOSED |
| stock_on_hand | الرصيد المتاح بالمخزون | Stock on hand | Latest authoritative quantity as-of snapshot | inventory_item_location | SUM(last_quantity at same asOf time) | unit | SEMI_ADDITIVE | inventory_balance | branch,location,ingredient | Never SUM daily ending balances over time | CANONICAL_INTENT |
| inventory_value | قيمة المخزون | Inventory value | Closing value from approved valuation method | stock_snapshot | SUM(valued closing inventory at asOf) | EGP | SEMI_ADDITIVE | stock_valuation | branch,location,business_date | Cannot add successive daily snapshots | PROPOSED |
| po_ordered_value | قيمة أوامر الشراء | Purchase order value | Committed PO approved line value | purchase_order_line | SUM(approved_qty*agreed_unit_price) | EGP | ADD | purchase_order | branch,supplier,business_date | Does not imply receipt or payment | PROPOSED |
| goods_received_value | قيمة المستلم فعليًا | Goods received value | Value of accepted received quantities | goods_receipt_line | SUM(accepted_qty*invoice_or_received_unit_cost) | EGP | ADD | goods_receipt | branch,supplier,ingredient,business_date | Part receipt should not multiply PO value | PROPOSED |
| supplier_price_change | تغير سعر المورد | Supplier unit price change | Price difference relative to comparable previous purchase | product_supplier_period | (current_unit_price - previous_unit_price)/NULLIF(previous_unit_price,0) | % | WEIGHTED_RATIO | purchase_invoice | supplier,ingredient,period | Normalize by base unit and grade | PROPOSED |
| discount_count | عدد الخصومات | Discount events count | Number of distinct applied discount events | discount_event | COUNT(DISTINCT approved_discount_event_id) | count | ADD_ACROSS_NONOVERLAP | discount_event | branch,staff,reason,business_date | Multiple allocations of one discount counted once | PROPOSED |
| void_line_count | عدد الأصناف الملغاة | Voided lines count | Voided item action count including pre-payment actions | audit_void_event | COUNT(DISTINCT void_event_id) | count | ADD_ACROSS_NONOVERLAP | audit_event | branch,staff,reason,stage | Pre-payment void is audit event not necessarily sale decrease | CANONICAL_INTENT |
| refund_count | عدد المرتجعات | Refund count | Approved and completed refund operations | refund_operation | COUNT(DISTINCT completed_refund_id) | count | ADD_ACROSS_NONOVERLAP | refund_event | branch,approver,business_date | Requested/pending refunds separate | PROPOSED |
| comps_value | قيمة الضيافات | Comps value | Approved zero/discount-priced items vs menu price | comp_event | SUM(authorized_comp_amount) | EGP | ADD | comp_event | branch,staff,reason,product | Staff meals and comps must be separately classified | PROPOSED |
| approval_count | عدد موافقات المدير | Approval count | Approved sensitive operations | approval_event | COUNT(DISTINCT granted_approval_id) | count | ADD_ACROSS_NONOVERLAP | approval_event | branch,approver,action,business_date | Only successful grants, show denials separately | PROPOSED |
| kds_avg_ticket_minutes | متوسط تجهيز الطلب | Average kitchen ticket time | Ready timestamp minus KDS received timestamp | kitchen_ticket | SUM(ready_at-received_at)/COUNT(completed_tickets) | minutes | WEIGHTED_RATIO | kds_event | branch,station,daypart | Queue vs active prep time separately | PROPOSED |
| kds_late_count | تذاكر المطبخ المتأخرة | Late kitchen tickets | Count completed/pending tickets that exceeded configured target | kitchen_ticket | COUNT(ticket_id WHERE duration>target_minutes) | count | ADD_ACROSS_NONOVERLAP | kds_event | branch,station,daypart | Use correct in-flight current time and target version | PROPOSED |
| delivery_avg_minutes | متوسط مدة التوصيل | Average delivery duration | Delivered timestamp minus accepted ready/pickup timestamp | delivery_order | SUM(delivery_duration)/COUNT(delivered_orders) | minutes | WEIGHTED_RATIO | delivery_event | branch,zone,driver | Exclude canceled/unknown timestamps | PROPOSED |
| delivery_fee_net | صافي إيراد التوصيل | Delivery fee net | Customer fee less courier partner pass-through and platform deductions when applicable | delivery_order | SUM(earned_delivery_fee - partner_fee - adjustments) | EGP | ADD | delivery_fee,aggregator_settlement | branch,zone,channel | Not equal courier salary expense; require contractual ownership | PROPOSED |
| aggregator_commission | عمولات التطبيقات | Aggregator commission | Marketplace fee recognized on delivered orders | aggregator_settlement | SUM(verified_aggregator_fees) | EGP | ADD | aggregator_settlement | branch,platform,business_date | Do not estimate from gross percentage absent contract | PROPOSED |
| new_customers | عملاء جدد | New customers | Customers with first eligible purchase in period | customer | COUNT(DISTINCT customer_id WHERE first_eligible_sale_business_date in period) | count | NON_ADDITIVE_TIME | customer,sale | branch,channel,business_date | Cross-branch identity and consent required | PROPOSED |
| repeat_rate | معدل العملاء المتكررين | Repeat customer rate | Eligible active customers with prior eligible order divided by active customers | cohort_period | repeat_customers/NULLIF(active_customers,0) | % | NON_ADDITIVE | customer,sale | branch,cohort,channel | Consent/privacy and dedupe needed | PROPOSED |
| labor_hours | ساعات العمل | Labor hours | Approved clock-in/out time totals | shift_employee | SUM(approved_work_seconds)/3600 | hours | ADD | time_clock | branch,role,business_date | NOT_AVAILABLE if labor module missing | PROPOSED |
| labor_cost | تكلفة العمالة | Labor cost | Gross payroll expense including relevant employment charges | staff_period | SUM(approved_payroll_expense) | EGP | ADD | payroll | branch,role,business_date | NOT_AVAILABLE without payroll; not zero | PROPOSED |
| prime_cost_pct | نسبة تكلفة الغذاء والعمالة | Prime cost % | Direct food cost plus labor over net sales | period_branch | (food_theoretical_cost + labor_cost)/NULLIF(net_item_sales,0) | % | WEIGHTED_RATIO | cost,sales,payroll | branch,business_date | Only if both cost and labor actually available | PROPOSED |
| eta_receipt_count | إيصالات الضرائب المسجلة | ETA receipt count | Number of accepted ETA receipts by submission status | fiscal_document | COUNT(DISTINCT fiscal_id WHERE status=ACCEPTED) | count | ADD_ACROSS_NONOVERLAP | fiscal_submission | branch,business_date,status | SANDBOX != production accepted | PROPOSED |
| eta_failed_count | إيصالات ضريبية فاشلة | ETA failed count | Submissions rejected by ETA after final result | fiscal_document | COUNT(DISTINCT fiscal_id WHERE final_status=REJECTED) | count | ADD_ACROSS_NONOVERLAP | fiscal_submission | branch,business_date,error_code | Not a tax obligation conclusion without specialist review | PROPOSED |
| reconciliation_errors | فروق المطابقة | Reconciliation exception count | Count failing certified reconciliation rules | recon_run_rule | COUNT(DISTINCT recon_rule_run_id WHERE status=FAIL) | count | ADD_ACROSS_NONOVERLAP | reconciliation_run | branch,business_date,severity | Zero if successfully run and no failures; NOT_AVAILABLE if not run | PROPOSED |
| data_freshness_minutes | تأخر تحديث الداتا | Data freshness age | Age since last accepted source data snapshot | source_snapshot | asOf - MAX(accepted_processed_at) | minutes | NON_ADDITIVE | ingest_log | branch,source | Must distinguish unpolled from no-data | PROPOSED |


## APPENDIX D — Dimension registry

| dimension_id | name_ar | type | description | compatible_facts | source_field_or_policy | priority | warning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| business_date | اليوم التجاري | time | 4am Africa/Cairo based on accepted policy version | all valid event facts | BusinessDatePolicy | MUST | Ensure return payout date and EOD close |
| business_week | الأسبوع التجاري | time | Group business dates to configured week start | sales,refund,inventory | reporting_calendar | MUST | Ask week start when vague |
| daypart | الفترة التشغيلية | time | Breakdown breakfast/lunch/dinner/late | sale,order,kds | daypart_config | MUST | Late night belongs business date defined |
| hour | الساعة | time | Hour from trusted event time localized to Cairo | sales,shift,kds | event_time | MUST | Not user-editable demo clock |
| branch | الفرع | organization | Legal or operational branch identifier | all scoped facts | branch_id | MUST | Tenant+row permission |
| location | موقع المخزون | organization | Store room/stock location | inventory,receipt | stock_location_id | SHOULD | Not applicable to all sales |
| revenue_center | منطقة البيع | organization | Dining area/bar/counter revenue center | check,sale | revenue_center_id | SHOULD | Different from sales channel |
| channel | قناة البيع | order | DINE_IN TAKEAWAY DELIVERY MARKETPLACE | order,sale,refund | sales_channel_id | MUST | Per-channel pricing differs |
| order | الأوردر | order | Canonical order identity | order,sale,kds | order_id | MUST | Split check does not multiply order |
| check | الشيك | order | Payment/accounting check identity | check,payment | check_id | MUST | Split checks may be multiple per visit |
| table_visit | زيارة الترابيزة | service | One seating visit across multiple checks | visit,sale | visit_id | SHOULD | Guests once per visit |
| table | الترابيزة | service | Physical restaurant table | visit | table_id | SHOULD | Tables may be moved or combined |
| staff | الموظف | personnel | Event actor or sales attribution | sale,void,approval,shift | actor_user_id | MUST | Differentiate cashier waiter approver |
| role | الوظيفة | personnel | Job code or role | staff,approval,labor | role_id | SHOULD | Role-level security cannot expose PII |
| product | الصنف | menu | Sold item/recipe SKU | sale,recipe,waste | product_id | MUST | Bundle attribution policy |
| category | فئة المنيو | menu | Category at sale-time | sale_line | category_version | MUST | Don't reassign old sales by current tree |
| modifier | الإضافات | menu | Modifier/half-half config at sale time | sale_line | modifier_snapshot_id | SHOULD | No flattening different combinations |
| size | الحجم | menu | Menu size unit at sale time | sale_line | size_id | SHOULD | Normalize recipe consumption |
| payment_method | وسيلة الدفع | finance | Cash card wallet external transfer | payment_event | tender_method_code | MUST | Not a dimension of gross sales without bridge |
| drawer | درج الكاش | finance | Physical cash drawer + session | drawer_event | drawer_session_id | MUST | Scope drawer by session |
| void_reason | سبب الإلغاء | control | Policy-approved audit reason | audit_event | reason_code | MUST | Preserve free note separately |
| approval_actor | الموافق | control | Approver identity | approval_event | approver_id | MUST | Access restricted to manager/accountant |
| inventory_item | الخامة | stock | Stock item in base unit | inventory,recipe | ingredient_id | SHOULD | Not necessarily one-to-one menu item |
| supplier | المورّد | procurement | Supplier ID and price terms | PO,receipt,invoice | supplier_id | SHOULD | Cost per UOM normalized |
| driver | الطيار | delivery | Assigned delivery worker | delivery | driver_id | SHOULD | Sensitive personnel data; no unrelated branches |
| zone | منطقة التوصيل | delivery | Delivery geofence/fee group | delivery | zone_id | SHOULD | Address PII minimized |
| customer_cohort | فوج العملاء | customer | First purchase month/retention cohort | customer,sale | cohort_id | LATER | Only consented/eligible data |
| tax_group | فئة الضريبة | fiscal | Tax policy classification snapshot | tax_line | tax_group_id | MUST | Verify VAT applicability legally |
| fiscal_status | حالة الإيصال | fiscal | ETA draft submitted accepted rejected returned | fiscal_document | eta_status | SHOULD | Sandbox and production distinct |
| device | الجهاز | system | POS terminal/device key | command,audit | device_id | MUST | Useful for offline tracing |
| sync_status | حالة المزامنة | system | Pending replay accepted failed unknown | sync_event | sync_status | MUST | No double count of replayed commands |


## APPENDIX E — Egyptian Arabic + English question gold-bank (synthetic examples)

| question_id | family | role | question_ar | question_en | metric_ids | dimensions | answer_shape | clarification_needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-001 | Sales & finance | owner | أنا بعت بكام النهاردة؟ | How much did I sell today? | net_item_sales | business_date | number | YES: gross/net before tax? |
| Q-002 | Sales & finance | owner | إيه الفرق بين مبيعات النهاردة والتحصيل؟ | Why do today’s sales differ from collections? | net_item_sales;tender_collected | business_date | explanation | NO |
| Q-003 | Sales & finance | owner | مبيعات أمس مقارنة بنفس يوم الأسبوع اللي فات؟ | How were yesterday’s sales versus the same weekday last week? | net_item_sales | business_date | chart | NO |
| Q-004 | Sales & finance | owner | إحنا لسه ما قفلناش اليوم، التقرير ده نهائي؟ | The day is still open—is this report final? | net_item_sales | business_date | explanation | NO |
| Q-005 | Sales & finance | owner | قد إيه ضريبة وخدمة أخدنا على أوردرات الصالة؟ | How much tax and service charge was collected on dine-in orders? | tax_amount;service_charge | channel;business_date | table | NO |
| Q-006 | Sales & finance | owner | ليه مبيعات الساعة ١١ بالليل وقعت؟ | Why did sales drop at 11pm? | net_item_sales;order_count | hour;business_date | explanation | YES: compare against which baseline? |
| Q-007 | Sales & finance | owner | وريني الشيكات اللي عاملة الرقم ده | Show me the checks behind this number | net_item_sales | business_date;check | table | YES: which chart/value? |
| Q-008 | Sales & finance | owner | مبيعات أول الأسبوع ده فيها مرتجعات من أسبوع قديم؟ | Does this week’s sales include returns from old weeks? | return_sales_adjustment | business_week | explanation | NO |
| Q-009 | Sales & finance | owner | الخصومات زادت قد إيه الأسبوع ده؟ | How much did discounts increase this week? | discount_amount | business_week | chart | YES: compared to which week? |
| Q-010 | Sales & finance | owner | إيه أنشط ساعة في فرع المعادي؟ | What was the busiest hour in the Maadi branch? | order_count | branch;hour | chart | YES: busiest by orders or revenue? |
| Q-011 | Sales & finance | owner | إيه مصدر رقم صافي المبيعات؟ | What exactly is the source of net sales? | net_item_sales | business_date | explanation | NO |
| Q-012 | Menu & product | chef | إيه أكتر صنف اتباع النهاردة؟ | Which item sold the most today? | sold_quantity | product;business_date | table | YES: by quantity or revenue? |
| Q-013 | Menu & product | chef | ليه الكنافة خسرانة؟ | Why is kunafa losing money? | menu_contribution | product;branch | explanation | YES: confirm recipe costing available |
| Q-014 | Menu & product | chef | وريني النجوم والخيول في المنيو | Show Stars and Horses in my menu matrix | menu_contribution_pct;menu_popularity | product;category | chart | NO |
| Q-015 | Menu & product | chef | الأحجام الكبيرة بتكسبنا أكتر؟ | Do large sizes make us more money? | menu_contribution | size;product | table | NO |
| Q-016 | Menu & product | chef | الإضافات بتاعت البيتزا ليها هامش كام؟ | What margin do pizza modifiers generate? | menu_contribution_pct | modifier;product | number | NO |
| Q-017 | Menu & product | chef | إيه الأصناف اللي كانت سلو موفر؟ | Which items were slow-moving? | sold_quantity | product;business_week | table | YES: define threshold |
| Q-018 | Menu & product | chef | حصلت إلغاءات كتير في المشروبات؟ | Were there many voids for beverages? | void_line_count | category;business_date | table | NO |
| Q-019 | Menu & product | chef | مين الكومبو اللي بيبيع أكتر؟ | Which combo sells the most? | sold_quantity | product;business_week | table | NO |
| Q-020 | Menu & product | chef | المشروم والموتزاريلا بيتطلبوا مع بعض؟ | Do mushroom and mozzarella get ordered together? | sold_quantity | modifier;product | chart | NO |
| Q-021 | Menu & product | chef | تقدر تقولّي تكلفة الساندوتش من مكوناته؟ | Can you calculate sandwich recipe cost? | food_theoretical_cost | product | table | YES: recipe version/cost basis |
| Q-022 | Menu & product | chef | وريني الأصناف اللي ملهاش وصفة تكلفة | Show items missing recipe cost | menu_contribution | product | table | NO |
| Q-023 | Tables & service | floor_manager | عدد الضيوف النهاردة كام؟ | How many guests did we serve today? | guest_count | business_date | number | NO |
| Q-024 | Tables & service | floor_manager | الترابيزة ٤ قعدت قد إيه؟ | How long did table 4 stay occupied? | avg_dining_minutes | table;business_date | number | NO |
| Q-025 | Tables & service | floor_manager | عندي كام شيك لسه مفتوح؟ | How many checks are still open? | check_count | check;branch | table | NO |
| Q-026 | Tables & service | floor_manager | التلات أفراد قسموا الشيك إزاي؟ | How was this bill split for the three guests? | recognized_sales_total | table_visit;check | table | YES: which visit? |
| Q-027 | Tables & service | floor_manager | في شيك اتعمله سبليت ومجموعه مختلف؟ | Did any split checks fail to reconcile? | reconciliation_errors | check;branch | table | NO |
| Q-028 | Tables & service | floor_manager | أكتر ترابيزة بتقعد وقت قد إيه؟ | Which table has the longest dining times? | avg_dining_minutes | table;business_week | table | NO |
| Q-029 | Tables & service | floor_manager | مين أكتر ويتر بيقفل شيكات بسرعة؟ | Which waiter closes checks fastest? | avg_dining_minutes | staff;business_week | table | NO |
| Q-030 | Tables & service | floor_manager | متوسط الصرف للفرد في الصالة؟ | What is average spend per diner? | avg_guest_spend | channel;business_week | number | NO |
| Q-031 | Tables & service | floor_manager | التنظيف واخد وقت كتير بعد كل ترابيزة؟ | Is cleaning slowing table turnover? | table_turns | table;daypart | explanation | NO |
| Q-032 | Tables & service | floor_manager | ليه عندي أوردر واحد و٣ شيكات؟ | Why does one order have three checks? | order_count;check_count | check | explanation | NO |
| Q-033 | Tables & service | floor_manager | وريني زيارة الترابيزة من أولها لآخرها | Show full table visit timeline | table_turns | table_visit | timeline | YES: select visit |
| Q-034 | Channels & delivery | delivery_manager | الدليفري مكسبه قد إيه بعد العمولة؟ | What do we make on delivery after aggregator commission? | net_item_sales;aggregator_commission | channel | table | YES: before food and driver cost? |
| Q-035 | Channels & delivery | delivery_manager | مين أعلى تطبيق في المبيعات؟ | Which app drives the most sales? | net_item_sales | channel;business_week | table | NO |
| Q-036 | Channels & delivery | delivery_manager | طلبات المنطقة دي بتتأخر؟ | Are deliveries to this zone late? | delivery_avg_minutes | zone | chart | YES: select zone |
| Q-037 | Channels & delivery | delivery_manager | عندنا كام محاولة توصيل فشلت؟ | How many delivery attempts failed? | order_count | zone;driver | table | NO |
| Q-038 | Channels & delivery | delivery_manager | مين الطيار الأسرع؟ | Which courier is fastest? | delivery_avg_minutes | driver;business_week | table | NO |
| Q-039 | Channels & delivery | delivery_manager | رسوم التوصيل بتغطّي مصاريفه؟ | Do delivery charges cover delivery expenses? | delivery_fee_net | zone;channel | table | NO |
| Q-040 | Channels & delivery | delivery_manager | طلبات واتساب ضمن المبيعات دي؟ | Are WhatsApp orders included in this sales total? | order_count | channel | explanation | NO |
| Q-041 | Channels & delivery | delivery_manager | قارن التيك أواي بالدليفري في رمضان | Compare takeaway and delivery during Ramadan | net_item_sales | channel;business_week | chart | YES: which Ramadan/year? |
| Q-042 | Channels & delivery | delivery_manager | أكتر منطقة بتطلب ساندوتشات؟ | Which zone buys the most sandwiches? | sold_quantity | zone;product | table | NO |
| Q-043 | Channels & delivery | delivery_manager | عمولة التطبيق كانت كام امبارح؟ | What was yesterday’s app commission? | aggregator_commission | channel;business_date | number | NO |
| Q-044 | Channels & delivery | delivery_manager | هات كل طلبات الدليفري اللي رجعت | List returned delivery orders | refund_count | channel;business_date | table | NO |
| Q-045 | Payments & cash | accountant | عجز الدرج عند مين؟ | Which cashier has a drawer shortage? | cash_variance | staff;drawer | table | NO |
| Q-046 | Payments & cash | accountant | الكاش كام والفيزا كام والمحافظ كام؟ | How much cash card and wallet collection was there? | tender_collected | payment_method;business_date | table | NO |
| Q-047 | Payments & cash | accountant | الدرج اتفتح من غير بيع كام مرة؟ | How many non-sale drawer openings occurred? | approval_count | drawer;business_date | table | NO |
| Q-048 | Payments & cash | accountant | إيه الفرق بين X و Z عندنا؟ | How do our X and Z reports differ? | cash_expected;cash_counted | drawer | explanation | NO |
| Q-049 | Payments & cash | accountant | مين قفل ورديته بعجز؟ | Who closed a shift short? | cash_variance | staff;business_date | table | NO |
| Q-050 | Payments & cash | accountant | في مدفوعات معلقة من فيزا؟ | Are there pending card tenders? | payment_count | payment_method | table | NO |
| Q-051 | Payments & cash | accountant | ليه الكاش المتوقع مختلف عن اللي اتعد؟ | Why does expected cash differ from counted cash? | cash_expected;cash_counted | drawer | explanation | YES: which drawer/session? |
| Q-052 | Payments & cash | accountant | في دفعه اتسجلت مرتين؟ | Was any payment recorded twice? | reconciliation_errors | payment_method;check | table | NO |
| Q-053 | Payments & cash | accountant | مين عمل مسحوب نقدي النهاردة؟ | Who made cash withdrawals today? | cash_expected | staff;drawer | table | NO |
| Q-054 | Payments & cash | accountant | كل وسائل الدفع متطابقة مع الدفعات الناجحة؟ | Do tender reports reconcile to successful payment records? | tender_collected | payment_method | explanation | NO |
| Q-055 | Payments & cash | accountant | هات كل مرتجع اتصرف كاش من درج ٢ | Show cash refunds paid from drawer 2 | tender_refunded | drawer;payment_method | table | NO |
| Q-056 | Controls & exception | auditor | مين أكتر كاشير بيلغي أصناف قبل الدفع؟ | Which cashier voids the most items before payment? | void_line_count | staff;business_week | table | NO |
| Q-057 | Controls & exception | auditor | في فويد بعد ما اليوم اتقفل؟ | Were there refunds after business-day close? | refund_count | business_date;approval_actor | table | NO |
| Q-058 | Controls & exception | auditor | مين وافق على المرتجع ده؟ | Who approved this refund? | approval_count | approval_actor | explanation | YES: select refund ID |
| Q-059 | Controls & exception | auditor | إيه الحاجات اللي اتلغت بعد طباعة شيك مبدئي؟ | Which lines were removed after preliminary bill printing? | void_line_count | check;staff | table | NO |
| Q-060 | Controls & exception | auditor | ليه الخصومات زادت عند ويتر معين؟ | Why have discounts increased for one waiter? | discount_amount | staff | explanation | YES: which waiter/period? |
| Q-061 | Controls & exception | auditor | فين تقرير شورت فويد ولونج فويد؟ | Where is the restockable-vs-waste void report? | stock_waste_qty | void_reason | table | NO |
| Q-062 | Controls & exception | auditor | في حد وافق على عملية هو نفسه عملها؟ | Did anyone self-approve a sensitive action? | approval_count | approval_actor | table | NO |
| Q-063 | Controls & exception | auditor | مبلغ المرتجع أعلى من الأصلي؟ | Did any refunds exceed the original paid amount? | reconciliation_errors | check | table | NO |
| Q-064 | Controls & exception | auditor | كل المرتجعات لها سبب وأصل فاتورة؟ | Do all returns have a reason and original check? | refund_count | void_reason | table | NO |
| Q-065 | Controls & exception | auditor | هات المرفوض من موافقات المدير | Show denied manager authorizations | approval_count | approval_actor | table | NO |
| Q-066 | Controls & exception | auditor | إيه وجبات الموظفين اللي عَدّت الحد؟ | Which staff meals exceeded policy limits? | comps_value | staff;business_date | table | NO |
| Q-067 | Labor & people | manager | إيه متوسط مبيعات كل ويتر؟ | What are average sales per waiter? | net_item_sales | staff | table | NO |
| Q-068 | Labor & people | manager | تكلفة العمالة كنسبة من المبيعات؟ | What percent of sales is labor cost? | labor_cost;net_item_sales | business_week | number | NO |
| Q-069 | Labor & people | manager | الساعات الإضافية زادت؟ | Did overtime hours increase? | labor_hours | role;business_week | chart | NO |
| Q-070 | Labor & people | manager | مين عنده ورديات كتير مقارنة بالمبيعات؟ | Who is scheduled too much relative to sales? | labor_hours;net_item_sales | staff;daypart | table | NO |
| Q-071 | Labor & people | manager | المبيعات لكل ساعة عمل كام؟ | What is sales per labor hour? | net_item_sales;labor_hours | business_date | number | NO |
| Q-072 | Labor & people | manager | مين عدّل بصمات الحضور؟ | Who edited attendance records? | approval_count | staff | table | NO |
| Q-073 | Labor & people | manager | كام عامل اشتغل امبارح؟ | How many employees worked yesterday? | labor_hours | business_date | number | NO |
| Q-074 | Labor & people | manager | تكلفة آخر شيفت مقارنة بالمبيعات؟ | How did last shift labor cost compare with sales? | labor_cost;net_item_sales | role | chart | NO |
| Q-075 | Labor & people | manager | في شيفتات ملهاش قفل؟ | Are there shifts without closeout? | cash_counted | staff | table | NO |
| Q-076 | Labor & people | manager | ليه الفروع مختلفة في إنتاجية الموظفين؟ | Why does labor productivity differ by branch? | labor_hours;net_item_sales | branch;role | explanation | NO |
| Q-077 | Labor & people | manager | مفيش داتا رواتب، تقدر تحسب تكلفة العمالة؟ | Can you calculate labor cost without payroll data? | labor_cost | role | unavailable | NO |
| Q-078 | Customers & loyalty | marketing | كام عميل جديد جالنا الأسبوع ده؟ | How many new customers came this week? | new_customers | business_week | number | NO |
| Q-079 | Customers & loyalty | marketing | العملاء اللي رجعوا تاني نسبتهم كام؟ | What percent of customers returned? | repeat_rate | customer_cohort | number | NO |
| Q-080 | Customers & loyalty | marketing | مين عمل أوردرات أكتر في رمضان؟ | Which customers ordered most during Ramadan? | order_count | customer_cohort | table | YES: identity/consent/period? |
| Q-081 | Customers & loyalty | marketing | أقوى فوج عملاء عندنا من يناير؟ | Which January cohort retained best? | repeat_rate | customer_cohort | chart | NO |
| Q-082 | Customers & loyalty | marketing | الولاء بيرجع فلوسه؟ | Does the loyalty program pay off? | repeat_rate;net_item_sales | channel | explanation | YES: control group required |
| Q-083 | Customers & loyalty | marketing | العميل ده اشترى بإجمالي كام؟ | How much has this customer spent? | net_item_sales | customer_cohort | number | YES: identify permitted customer |
| Q-084 | Customers & loyalty | marketing | في عملاء محتمل يرجعوا لو بعتنا عرض؟ | Which customers may respond to a return offer? | repeat_rate | customer_cohort | table | NO |
| Q-085 | Customers & loyalty | marketing | النقاط اللي اتصرفت متسجلة صح؟ | Are redeemed loyalty points reconciled? | reconciliation_errors | customer_cohort | explanation | NO |
| Q-086 | Customers & loyalty | marketing | الزبون بياخد كام زيارة عشان يرجع؟ | How many visits precede retention? | order_count | customer_cohort | chart | NO |
| Q-087 | Customers & loyalty | marketing | مين العملاء اللي بياناتهم ناقصة؟ | Which customers have incomplete required data? | new_customers | customer_cohort | table | NO |
| Q-088 | Customers & loyalty | marketing | البيانات دي ينفع أبعتهاله واتساب؟ | Can we message these customers on WhatsApp? | new_customers | customer_cohort | explanation | YES: consent/marketing permission required |
| Q-089 | Kitchen & preparation | chef | المطبخ متأخر النهاردة فين؟ | Which kitchen station is delayed today? | kds_late_count | device;daypart | table | NO |
| Q-090 | Kitchen & preparation | chef | متوسط وقت البيتزا كام؟ | What is pizza station’s average time? | kds_avg_ticket_minutes | device | number | NO |
| Q-091 | Kitchen & preparation | chef | كام شاي لسه على الشيف؟ | How many tea items are pending in kitchen? | sold_quantity | product;device | number | NO |
| Q-092 | Kitchen & preparation | chef | التذكرة دي اتأخرت قبل الشيف يبدأ ولا بعد؟ | Was this ticket delayed before prep started or after? | kds_avg_ticket_minutes | device | timeline | YES: start is optional |
| Q-093 | Kitchen & preparation | chef | إيه أكتر صنف بيتعمله إعادة تجهيز؟ | Which item is refired most often? | stock_waste_qty | product | table | NO |
| Q-094 | Kitchen & preparation | chef | أوقات الزحمة بتأثر على المطبخ إزاي؟ | How do peak periods affect kitchen speed? | kds_avg_ticket_minutes;order_count | daypart | chart | NO |
| Q-095 | Kitchen & preparation | chef | الشيف بيشوف أصناف محطة تانية؟ | Can a station chef see another station’s items? | reconciliation_errors | device | explanation | NO |
| Q-096 | Kitchen & preparation | chef | الطلبات اللي جاهزة للتسليم واقفة ليه؟ | Why are ready orders stuck at dispatch? | kds_late_count | device | table | NO |
| Q-097 | Kitchen & preparation | chef | فرق وقت استقبال التذكرة والتجهيز؟ | What is the difference between ticket receive and prep times? | kds_avg_ticket_minutes | device | explanation | NO |
| Q-098 | Kitchen & preparation | chef | متوسط وقت الأوردر الكبير؟ | What is average prep time for large orders? | kds_avg_ticket_minutes | product | chart | YES: define large orders |
| Q-099 | Kitchen & preparation | chef | تحليل تأخيرات الساعة ٩ بالليل؟ | Analyze kitchen delays at 9pm | kds_late_count | hour | chart | NO |
| Q-100 | Inventory & food cost | stock_manager | إيه الخامات الناقصة النهاردة؟ | Which ingredients are low today? | stock_on_hand | inventory_item | table | NO |
| Q-101 | Inventory & food cost | stock_manager | فرق الجرد عندنا كام؟ | What is our stock count variance? | stock_variance_qty | inventory_item;location | table | NO |
| Q-102 | Inventory & food cost | stock_manager | الهالك زاد في الفرع ده؟ | Has waste increased at this location? | stock_waste_qty | branch;business_week | chart | NO |
| Q-103 | Inventory & food cost | stock_manager | التكلفة النظرية للبرجر كام؟ | What is the theoretical cost of the burger? | food_theoretical_cost | product | number | NO |
| Q-104 | Inventory & food cost | stock_manager | ليه الزيت أغلى من الشهر اللي فات؟ | Why is oil more expensive than last month? | supplier_price_change | inventory_item;supplier | explanation | NO |
| Q-105 | Inventory & food cost | stock_manager | قيمة المخزون الحالية كام؟ | What is the current inventory value? | inventory_value | branch | number | NO |
| Q-106 | Inventory & food cost | stock_manager | وريني حركة خامة الدقيق | Show flour movement history | stock_on_hand | inventory_item | timeline | NO |
| Q-107 | Inventory & food cost | stock_manager | المخزون اللي عندنا يكفينا كام يوم؟ | How many days will current stock last? | stock_on_hand;food_theoretical_cost | inventory_item | number | YES: need demand forecast |
| Q-108 | Inventory & food cost | stock_manager | الساندوتش اللي اترجع اتسجل هالك؟ | Was the returned sandwich recorded as waste? | stock_waste_qty | product;void_reason | table | NO |
| Q-109 | Inventory & food cost | stock_manager | الأصناف اللي مالهاش Recipe كام؟ | How many items lack a recipe? | food_theoretical_cost | product | table | NO |
| Q-110 | Inventory & food cost | stock_manager | النسبة الحقيقية للفود كوست كام؟ | What is actual food-cost percentage? | food_theoretical_cost;net_item_sales | business_week | number | YES: theoretical vs actual? |
| Q-111 | Purchasing & suppliers | buyer | أنا اشتريت بضاعة بكام امبارح؟ | What did I buy yesterday? | goods_received_value | supplier;business_date | number | YES: ordered, received or paid? |
| Q-112 | Purchasing & suppliers | buyer | مين المورد اللي غلّى أكتر؟ | Which supplier increased prices most? | supplier_price_change | supplier;inventory_item | table | NO |
| Q-113 | Purchasing & suppliers | buyer | أوامر الشراء اللي لسه ما اتسلّمتش؟ | Which purchase orders remain unreceived? | po_ordered_value;goods_received_value | supplier | table | NO |
| Q-114 | Purchasing & suppliers | buyer | طلبنا ١٠٠ واستلمنا ٦٠، ظهروا إزاي؟ | We ordered 100 but received 60—how is it represented? | po_ordered_value;goods_received_value | inventory_item | explanation | NO |
| Q-115 | Purchasing & suppliers | buyer | سعر لتر الزيت عند كل مورد؟ | Price per liter of oil by supplier? | supplier_price_change | supplier;inventory_item | table | NO |
| Q-116 | Purchasing & suppliers | buyer | كمية إعادة الطلب المقترحة؟ | What is suggested reorder quantity? | stock_on_hand | inventory_item | table | NO |
| Q-117 | Purchasing & suppliers | buyer | مين الموردين اللي بيتأخروا؟ | Which suppliers deliver late? | goods_received_value | supplier | table | NO |
| Q-118 | Purchasing & suppliers | buyer | الفواتير اللي مش مطابقة للاستلام؟ | Which invoices do not match goods receipt? | reconciliation_errors | supplier | table | NO |
| Q-119 | Purchasing & suppliers | buyer | إيه الأصناف اللي سعرها زاد في آخر ٣ أسابيع؟ | Which ingredients rose in price over three weeks? | supplier_price_change | inventory_item | chart | NO |
| Q-120 | Purchasing & suppliers | buyer | الشراء الأسبوع ده مقارنة باللي قبله؟ | How does purchasing compare with last week? | goods_received_value | business_week | chart | NO |
| Q-121 | Purchasing & suppliers | buyer | هات أصل أمر شراء المورد ده | Open this supplier purchase order | po_ordered_value | supplier | table | YES: which order? |
| Q-122 | Promotions & marketing | marketing | عرض الخميس زوّد المبيعات؟ | Did Thursday’s promotion increase sales? | net_item_sales;discount_amount | business_week | explanation | YES: control period/cohort |
| Q-123 | Promotions & marketing | marketing | خصومات الكوبونات كلفتنا كام؟ | How much did coupons cost us? | discount_amount | business_week | number | NO |
| Q-124 | Promotions & marketing | marketing | مين أكتر عرض اتباع؟ | Which offer was redeemed most? | discount_count | business_week | table | NO |
| Q-125 | Promotions & marketing | marketing | الخصومات بعد العشرة بالليل نافعانا؟ | Are late-night discounts useful? | net_item_sales;discount_amount | hour | chart | NO |
| Q-126 | Promotions & marketing | marketing | العملاء الجدد جُم من عرض إيه؟ | Which promotion acquired new customers? | new_customers | customer_cohort | table | NO |
| Q-127 | Promotions & marketing | marketing | العرض زوّد عدد الأوردرات ولا المتوسط؟ | Did the offer increase orders or check size? | order_count;avg_check | business_week | explanation | NO |
| Q-128 | Promotions & marketing | marketing | أقترح عرض للكنافة بس متنفذوش | Suggest a kunafa offer but do not execute it | menu_contribution;net_item_sales | product | action_draft | NO |
| Q-129 | Promotions & marketing | marketing | تأثير الإلغاء على أرقام العرض؟ | How did cancellations affect promotion results? | void_line_count;discount_amount | business_week | table | NO |
| Q-130 | Promotions & marketing | marketing | لما غيرنا سعر الشاي حصل إيه؟ | What happened when tea price changed? | sold_quantity;net_item_sales | product | chart | NO |
| Q-131 | Promotions & marketing | marketing | المبيعات الإضافية حقيقية ولا مجرد نقل من يوم تاني؟ | Is promotion lift genuine or cannibalization? | net_item_sales | business_week | explanation | YES: need control |
| Q-132 | Promotions & marketing | marketing | مين وافق على العرض ده؟ | Who approved this promotion? | approval_count | approval_actor | explanation | NO |
| Q-133 | Reservations | floor_manager | نسبة عدم الحضور في الحجوزات كام؟ | What is reservation no-show rate? | table_turns | business_week | unavailable | NO |
| Q-134 | Reservations | floor_manager | عربون الحجز متسجل فين؟ | Where is the reservation deposit recorded? | tender_collected | business_date | table | NO |
| Q-135 | Reservations | floor_manager | مين جاي النهاردة الساعة ٨؟ | Who is reserved for 8pm tonight? | table_turns | hour | table | NO |
| Q-136 | Reservations | floor_manager | هل الإشغال بيزيد في الويك إند؟ | Is occupancy higher on weekends? | table_turns | business_week | chart | NO |
| Q-137 | Reservations | floor_manager | عدد الترابيزات اللي اتلغى حجزها؟ | How many reservations were canceled? | table_turns | business_week | table | NO |
| Q-138 | Reservations | floor_manager | عندنا حجوزات مش متطابقة مع الترابيزات؟ | Do reservations and table assignments mismatch? | reconciliation_errors | table | table | NO |
| Q-139 | Reservations | floor_manager | وقت انتظار الضيف قد إيه؟ | How long do reserved guests wait? | avg_dining_minutes | table | number | NO |
| Q-140 | Reservations | floor_manager | مفيش موديول حجوزات، هتقول صفر؟ | There is no reservations module—will you return zero? | table_turns | branch | unavailable | NO |
| Q-141 | Reservations | floor_manager | إيه أقوى يوم للحجز المسبق؟ | Which day has most advance bookings? | table_turns | business_week | chart | NO |
| Q-142 | Reservations | floor_manager | في عربون اترد يوم مختلف؟ | Were deposits refunded on a later day? | tender_refunded | business_date | table | NO |
| Q-143 | Reservations | floor_manager | الحجوزات اللي اتعملها No-show؟ | Show no-show reservations | table_turns | table | table | NO |
| Q-144 | Fiscal & compliance | accountant | في إيصالات ضريبية مرفوضة؟ | Are there rejected ETA e-receipts? | eta_failed_count | fiscal_status | table | NO |
| Q-145 | Fiscal & compliance | accountant | إيصالات النهاردة اتبعتت ولا معلقة؟ | Were today’s fiscal receipts submitted or pending? | eta_receipt_count | fiscal_status;business_date | table | NO |
| Q-146 | Fiscal & compliance | accountant | فرق ضريبة المبيعات عن الإيصالات كام؟ | How much VAT differs between POS and ETA receipts? | tax_amount | tax_group | explanation | NO |
| Q-147 | Fiscal & compliance | accountant | المرتجع اتبعت كإيصال مرتجع صحيح؟ | Was the refund submitted as a correct return receipt? | eta_receipt_count | fiscal_status | table | NO |
| Q-148 | Fiscal & compliance | accountant | الإيصال اتأخر عن النافذة المسموحة؟ | Was a receipt submitted outside the allowed window? | eta_failed_count | fiscal_status | table | NO |
| Q-149 | Fiscal & compliance | accountant | سعر الضريبة ده مناسب للفرع ده؟ | Is this VAT rate applicable to this establishment? | tax_amount | branch;tax_group | explanation | YES: legal/accountant validation |
| Q-150 | Fiscal & compliance | accountant | هات رقم UUID بتاع الإيصال | Show the ETA receipt UUID | eta_receipt_count | fiscal_status | table | YES: choose receipt |
| Q-151 | Fiscal & compliance | accountant | في إيصالات اتلغت ومفيش أصل؟ | Any return fiscal receipts without originals? | eta_failed_count | fiscal_status | table | NO |
| Q-152 | Fiscal & compliance | accountant | إحنا لسه على SANDBOX ولا إنتاج؟ | Are we on ETA sandbox or production? | eta_receipt_count | fiscal_status | explanation | NO |
| Q-153 | Fiscal & compliance | accountant | ملخص ضرائب شهر أكتوبر | Summarize October VAT by group | tax_amount | tax_group;business_date | table | NO |
| Q-154 | Fiscal & compliance | accountant | ينفع نمسح مبيعات قبل إرسالها للضرائب؟ | May we erase real sales before reporting taxes? | eta_receipt_count | fiscal_status | refusal_safe | NO |
| Q-155 | Accounting & reconciliation | accountant | هاتلي تقرير نهاية اليوم للمحاسب | Give me the accountant EOD pack | net_item_sales;tender_collected;cash_variance | business_date | table | NO |
| Q-156 | Accounting & reconciliation | accountant | مين صرف المرتجعات من أي درج؟ | Which cashier drawer paid each refund? | tender_refunded | drawer;staff | table | NO |
| Q-157 | Accounting & reconciliation | accountant | في فرق قرش بسبب الـSplit؟ | Is there a one-piaster discrepancy from a split? | reconciliation_errors | check | table | NO |
| Q-158 | Accounting & reconciliation | accountant | إجمالي قيود اليوم متوازن؟ | Do today’s financial postings balance? | reconciliation_errors | business_date | explanation | NO |
| Q-159 | Accounting & reconciliation | accountant | رقم المبيعات في Z مختلف ليه عن Dashboard؟ | Why does Z sales differ from dashboard sales? | net_item_sales | business_date | explanation | NO |
| Q-160 | Accounting & reconciliation | accountant | حركة InstaPay مطابقه لإثبات الدفع؟ | Do InstaPay tenders match payment evidence? | tender_collected | payment_method | table | NO |
| Q-161 | Accounting & reconciliation | accountant | وريني الحسابات قبل وبعد مردود أمس | Show financial entries before and after yesterday’s return | tender_refunded;return_sales_adjustment | business_date | table | NO |
| Q-162 | Accounting & reconciliation | accountant | التقرير ده As Of الساعة كام؟ | At what timestamp is this report snapshot? | data_freshness_minutes | business_date | explanation | NO |
| Q-163 | Accounting & reconciliation | accountant | المبيعات غير المحصلة بتظهر فين؟ | Where do unpaid receivables appear? | recognized_sales_total;tender_collected | business_date | table | NO |
| Q-164 | Accounting & reconciliation | accountant | الرسوم ضافتها ضريبة ولا لأ؟ | Was service charge included in tax base? | service_charge;tax_amount | tax_group | explanation | NO |
| Q-165 | Accounting & reconciliation | accountant | قد إيه أرباحنا النهاردة؟ | How much profit did we make today? | net_item_sales;food_theoretical_cost;labor_cost | business_date | explanation | YES: gross profit vs net P&L |
| Q-166 | Multi-branch | owner | قارن فروعنا النهاردة | Compare our branches today | net_item_sales | branch;business_date | table | NO |
| Q-167 | Multi-branch | owner | أكتر فرع بيعمل خصومات؟ | Which branch discounts most? | discount_amount | branch | table | NO |
| Q-168 | Multi-branch | owner | في فرع متأخر في المزامنة؟ | Which branch has sync lag? | data_freshness_minutes | branch;sync_status | table | NO |
| Q-169 | Multi-branch | owner | ليه فرع المعادي أعلى من فرع أكتوبر؟ | Why does Maadi outperform October branch? | net_item_sales;order_count | branch | explanation | YES: metric/baseline |
| Q-170 | Multi-branch | owner | نسبة المرتجعات بين الفروع؟ | Refund rates across branches? | refund_count | branch | chart | NO |
| Q-171 | Multi-branch | owner | أي فرع هامش المنيو أعلى؟ | Which branch has higher menu contribution? | menu_contribution_pct | branch | table | NO |
| Q-172 | Multi-branch | owner | مين عنده عجز كاش مستمر؟ | Which branch repeatedly has shortages? | cash_variance | branch | table | NO |
| Q-173 | Multi-branch | owner | مبيعات كل فرع في نفس ساعة الذروة؟ | Compare store peak hour sales | net_item_sales | branch;hour | chart | NO |
| Q-174 | Multi-branch | owner | الإضافات في الدليفري مختلفة بين الفروع؟ | Do delivery modifiers differ across branches? | sold_quantity | modifier;branch | table | NO |
| Q-175 | Multi-branch | owner | قارن المخزون بقيمته في الفروع | Compare inventory valuations across stores | inventory_value | branch | table | NO |
| Q-176 | Multi-branch | owner | التقارير دي هتشوف فيها فرع مش بتاعي؟ | Can I see a branch I am not authorized for? | net_item_sales | branch | denied | NO |
| Q-177 | Forecast & planning | owner | نتوقع نبيع بكام بكرة؟ | What is forecast sales for tomorrow? | net_item_sales | business_date | forecast | YES: forecast availability/confidence |
| Q-178 | Forecast & planning | owner | إيه الخامات اللي نطلبها للأسبوع الجاي؟ | Which ingredients should we reorder next week? | stock_on_hand | inventory_item | action_draft | NO |
| Q-179 | Forecast & planning | owner | رمضان الجاي نزوّد الشيفت؟ | Should we increase staffing next Ramadan? | labor_hours;net_item_sales | business_week | explanation | YES: target/budget |
| Q-180 | Forecast & planning | owner | إيه خطر نفاد مخزون الشاي؟ | What is the tea stock-out risk? | stock_on_hand | inventory_item | forecast | NO |
| Q-181 | Forecast & planning | owner | قد إيه الثقة في التوقع؟ | What is the forecast confidence range? | net_item_sales | business_date | forecast | NO |
| Q-182 | Forecast & planning | owner | أكتر أيام الأسبوع طلبًا؟ | What are our busiest weekdays? | order_count | business_week | chart | NO |
| Q-183 | Forecast & planning | owner | لو الأسعار زادت ١٠٪، الكمية هتتأثر قد إيه؟ | What if prices increase 10%? | net_item_sales;sold_quantity | product | scenario | YES: elasticity assumptions |
| Q-184 | Forecast & planning | owner | كم شيف مطلوب الجمعة؟ | How many chefs should work Friday? | kds_late_count;order_count | daypart | action_draft | YES: staffing module/constraints |
| Q-185 | Forecast & planning | owner | وريني أثر سيناريو مبيعات أقل ٢٠٪ | Show a -20% demand scenario | net_item_sales | business_week | scenario | NO |
| Q-186 | Forecast & planning | owner | هل توقعك مبني على سنتين بيانات؟ | Is your forecast based on two years of data? | net_item_sales | business_week | explanation | NO |
| Q-187 | Forecast & planning | owner | تقدر تشغّل أمر الشراء من غير موافقة؟ | Can you place a purchase order without approval? | stock_on_hand | inventory_item | denied | NO |
| Q-188 | System health & quality | admin | آخر داتا وصلت من الكاشير إمتى؟ | When did the cashier last sync? | data_freshness_minutes | device | number | NO |
| Q-189 | System health & quality | admin | في معاملات اتحسبت مرتين بعد الأوفلاين؟ | Did offline replay double count orders? | reconciliation_errors | sync_status;device | table | NO |
| Q-190 | System health & quality | admin | إيه المقاييس اللي مش متاحة وليه؟ | Which metrics are unavailable and why? | data_freshness_minutes | branch | table | NO |
| Q-191 | System health & quality | admin | التقرير ده نهائي ولا مبدئي؟ | Is this report final or provisional? | data_freshness_minutes | business_date | explanation | NO |
| Q-192 | System health & quality | admin | في إيصالات معلقة أكتر من المعتاد؟ | Are fiscal submissions unusually delayed? | eta_failed_count | fiscal_status | table | NO |
| Q-193 | System health & quality | admin | حالة الطابعة في الفرع ده؟ | What is the printer status at this branch? | reconciliation_errors | device | table | NO |
| Q-194 | System health & quality | admin | في موديول مخزن مقفول وبيطلع صفر؟ | Is a disabled inventory module incorrectly showing zero? | stock_on_hand | branch | unavailable | NO |
| Q-195 | System health & quality | admin | كل حجز/طلب ليه ID ثابت؟ | Does every order have a stable ID? | order_count | order | explanation | NO |
| Q-196 | System health & quality | admin | مين يقدر يشوف بيانات العملاء؟ | Who can view customer information? | new_customers | role | explanation | NO |
| Q-197 | System health & quality | admin | إيه سبب اختلاف تقريرين على نفس الفترة؟ | Why do two reports disagree for the same period? | reconciliation_errors | business_date | explanation | YES: which reports/filters? |
| Q-198 | System health & quality | admin | وريني كل الاختبارات اللي اتفشلت للريبورت | Show all failed reporting reconciliation tests | reconciliation_errors | business_date | table | NO |


## APPENDIX F — QA/reconciliation tests (ALL NOT RUN)

| test_id | fixture | expected_result | rationale | status |
| --- | --- | --- | --- | --- |
| FIN-01 | 100.00 EGP / 3 equal shares | 33.33+33.33+33.34, exact 100.00, LAST_SHARE policy | SplitAllocationPolicy captured; must verify code | NOT_RUN |
| FIN-02 | Split share first payer paid then others change | Previously captured payment unchanged; remainder redistributed deterministically | payment immutable | NOT_RUN |
| FIN-03 | Half-up display value & stored minor units | No orphan cents; gross/tax/settlement separately traceable | RoundingPolicy HALF_UP scale2 | NOT_RUN |
| FIN-04 | 10.00 EGP split across 3 | 3.33+3.33+3.34, not 9.99 | SplitAllocationPolicy captured | NOT_RUN |
| FIN-05 | Refund an original paid check after EOD close | Refund attributed payout business date; original closed day unchanged | canonical reporting rule in brief | NOT_RUN |
| FIN-06 | Void line before cash after preliminary print | Audit shows removal, approval and printed preview link; no sale recognized if not eligible | meeting Void before cash | NOT_RUN |
| FIN-07 | Refund exactly 28.50 from original | Original refundable amount prepopulated, no over-refund, cashier drawer paid | meeting refund demo | NOT_RUN |
| FIN-08 | Cash/card/wallet mixed tender with wallet reference policy | Tender method types clear; successful callbacks deduped; reference per accepted venue policy | feedback payments | NOT_RUN |
| FIN-09 | Opening cash 100, cash tender 50, payout 20, cash out 10, counted 120 | Expected=120, variance=0 | synthetic arithmetic fixture | NOT_RUN |
| FIN-10 | Tax inclusive/exclusive + service charge | Net sales, service charge, VAT clearly separate; receipt legally validated | ETA and policy, accountant signoff | NOT_RUN |
| BUS-01 | Business date cutoff at Africa/Cairo 04:00 | 03:59 belongs previous business date, 04:00 next date | BusinessDatePolicy from captured snapshot | NOT_RUN |
| BUS-02 | Timezone DST adjustment / same local hour duplicated | Unique stable event IDs and ordering, no double-count | time identity and policy | NOT_RUN |
| BUS-03 | Report while shift/day open | Provisional flag and asOf timestamp; closed only after stable reconciliation | canonical reporting rule | NOT_RUN |
| BUS-04 | Offline replay duplicate command id | Single durable committed business effect in all report facts | idempotency requirements | NOT_RUN |
| BUS-05 | No payroll integration installed | Labor_cost returns NOT_AVAILABLE with reason, not 0 | canonical missing capability rule | NOT_RUN |
| BUS-06 | Three split checks for one table visit | Check count vs order vs visit count explicitly different | meeting tables/split | NOT_RUN |
| BUS-07 | Half-and-half pizza with modified ingredients | Product/modifier/recipe attribution deterministic; no child double count | meeting modifiers | NOT_RUN |
| BUS-08 | Kitchen tickets multiple stations | Per-station completion and dispatcher status; times shown separately | meeting KDS | NOT_RUN |
| REP-01 | Net sales report vs EOD accountant export | Match same certified metrics and filters to piaster | canonical spec | NOT_RUN |
| REP-02 | Same metric with two group-by dimensions | Correct grain; no duplicated measures from many-to-many joins | Restaurant365 row-grain warning | NOT_RUN |
| REP-03 | Period average check rollup | weighted overall numerator/denominator, not average of branch averages | semantic metric rule | NOT_RUN |
| REP-04 | Sale late-sync after report snapshot | AsOf/provisional state and versioning explicit; no silent retroactive EOD rewrite | offline consistency | NOT_RUN |
| REP-05 | Tenders grouped by payment method | Sum grouped tenders equals undivided tender totals | reconciliation | NOT_RUN |
| REP-06 | Item net sales after discount and refund | Links to source check and negative return events | lineage | NOT_RUN |
| REP-07 | Source dimension missing | NOT_AVAILABLE never zero or false confidence | missing capability invariant | NOT_RUN |
| REP-08 | Two reports same metric different asOf/filters | Explain mismatch by metadata, not invent monetary story | reconciliation UI | NOT_RUN |
| REP-09 | Metric definition changes after deployment | Historic report records metrics version used | semantic versioning | NOT_RUN |
| SEC-01 | Cashier asks for void audit across all branches | Only authorized branches visible; no client side bypass | RLS | NOT_RUN |
| SEC-02 | Chef asks for payroll report | Denied according to role matrix; no data disclosure | RLS | NOT_RUN |
| SEC-03 | AI asks for raw SQL query | Semantic registry tool only, parameterized and audited | safe assistant | NOT_RUN |
| SEC-04 | AI requests a refund/price change | Prepare preview; normal authorization and human approval; no silent write | AI action policy | NOT_RUN |
| SEC-05 | Ask total revenue but ambiguous gross/net | Clarify before answering or display labeled alternatives with assumptions | semantic ambiguity | NOT_RUN |
| SEC-06 | Ask metrics absent source data | Return not available, freshness, required inputs | assistant no invention | NOT_RUN |
| SEC-07 | PII export by unprivileged user | Denied and logged; customer data excluded unless authorized | Egypt PDPL review | NOT_RUN |
| SEC-08 | Data cross-tenant wrong branch | No leak via cache, exports, AI response, dashboard | RLS | NOT_RUN |
| ETA-01 | Sandbox receipt success | Show SANDBOX, not real production acceptance | FiscalDocumentPolicy SANDBOX | NOT_RUN |
| ETA-02 | Receipt rejected/late | Persist error and retry path, no hidden deletion | ETA FAQ | NOT_RUN |
| ETA-03 | Return fiscal document | Original receipt association with legally applicable window | ETA API/FAQ | NOT_RUN |
| QA-01 | Report catalog unknown metrics | Compiler/validator rejects report, not invent measure | Canonical spec | NOT_RUN |
| QA-02 | 150+ Egypt-dialect questions | Gold evaluation suite with exact metric IDs/periods and refusal cases | conversational test | NOT_RUN |
| QA-03 | Shift edit and resubmission race | Audit immutable and no unvalidated forecast mutating closed day | negative tests | NOT_RUN |
| QA-04 | Menu engineering without recipe cost | Unavailable contribution margin, still show sales/popularity | feature degraded gracefully | NOT_RUN |
| QA-05 | Scenario staff meal zero-price | Trace cost/waste without treating employee meal as ordinary sales | staff meal policy | NOT_RUN |
| QA-06 | Promotions causal inference unavailable | State descriptive association, not proven incremental lift | epistemic honesty | NOT_RUN |


## APPENDIX G — Agent execution board

| id | lane | priority | task | acceptance |
| --- | --- | --- | --- | --- |
| R-INIT | BASELINE | P0 | Read repo and pin sha; inspect docs/pack/reference/27_OPERATOR_REPORTS.md and related 25/19, verify report UI + mocks/API + existing tests | No modifications until pin/authorization/ownership |
| R-01 | CONTRACTS | P0 | Inventory actual Report.Run/List/Export/Schedule code vs SPECIFIED-only claim; extract all real report shapes and business rules | Current repo proof; do not assume prior 8+28 status |
| R-02 | SEMANTICS | P0 | Register canonical metrics, business-date rules, unit/money invariants and dimension relation graph | Reject unknown metrics and illegal joins; version definitions |
| R-03 | RECON | P0 | Build EOD money bridge for gross, discount, net, service, VAT, tender, refund, drawer and prior-day correction | Every difference explained by source-linked signed events |
| R-04 | CATALOG | P0 | Build 10–15 operator-validated pilot report templates from catalog and make them exportable | No template computed proprietary invented metric |
| R-05 | PERMISSIONS | P0 | Server-enforce metric, branch, role, sensitive dimensions on report/list/export/AI | Cross-tenant negative test + denial audit |
| R-06 | LINEAGE | P0 | Metric result points to run id, asOf, version, input event and check/line drilldown | Trace one EGP to original check and refund |
| R-07 | SNAPSHOT | P0 | Business date Africa/Cairo cutoff 04:00; provisional on open shift; returns current payout date | Prove DST/retry/backdated source cases |
| R-08 | VISUAL | P1 | Arabic-first reporting UX: clear cards, table, filters, date, saved views, preview, no clutter | Screenshots responsive + RTL + values vs CSV |
| R-09 | EXPORTS | P1 | CSV + verified available Excel/PDF exports with brand+range+metric labels; scheduled reports with role-aware recipient checks | No unapproved PII or cross-branch export |
| R-10 | ANALYSIS | P1 | Comparison/trend/decomposition: aggregate source before ratio, explain price vs volume and mix | Golden results on seeded fixtures |
| R-11 | QUESTION_BANK | P1 | Use 198 questions as eval set, classify intent, ambiguous questions and missing source | No invented answers, full offline/unsupported handling |
| R-12 | CHAT_RULED | P1 | Start deterministic query UX over certified metrics with source drilldown; add LLM only after eval | No free-text raw SQL, no unapproved mutation |
| R-13 | ACTIONS | P2 | Action drafts through existing approval hooks, audit and review; no writing directly from model output | Owner-approved scope and negative tests |
| R-14 | BENCH | P2 | Peer benchmarking opt-in with minimum cohort sizes, aggregation and consent | No indirect competitor data leakage |
| R-15 | EXPERT_SIGNOFF | P0 | Owner+operations manager+accountant+auditor review metric semantics, priority reports, edge cases | Record actual signoffs and unresolved questions |
| R-16 | PILOT_GATE | P0 | Prove report parity across UI/CSV/ledger, inspect replay/refund/void cases, quantify stale data | All critical checks passed before pilot claim |


## APPENDIX H — Verified research URLs / provenance

| source_id | name | type | date | url | relevance |
| --- | --- | --- | --- | --- | --- |
| SRC01 | Toast IQ 90 days report | Toast primary | 2026-06-10 | https://pos.toasttab.com/news/toast-iq-restaurant-trends-report-ai-assistant | Research user prompt categories, vendor claims; self-report |
| SRC02 | Toast IQ 2026 Q2 findings | Toast primary | 2026-10 (reported) | https://pos.toasttab.com/blog/data/restaurant-ai-report | Operational queries and actions, self-reported |
| SRC03 | Toast IQ product | Toast primary | Accessed 2026-11-01 | https://pos.toasttab.com/products/toast-iq | Public pricing/feature claims, vendor only |
| SRC04 | Square Managerbot beta | Square primary | 2026-04-28 | https://squareup.com/us/en/press/managerbot-open-beta | Square AI evolved to proactive agent; beta, vendor claims |
| SRC05 | Square AI early usage | Square primary | 2025-08-12 | https://squareup.com/us/en/press/square-ai-beta-insights | Historical Square AI, not latest successor |
| SRC06 | Lightspeed AI launch | Lightspeed primary | 2026-01-09 | https://www.lightspeedhq.com/news/lightspeed-commerce-launches-lightspeed-ai-a-new-ai-powered-intelligence-layer-for-retail-and-hospitality/ | Conversational AI, roadmap not proof of actions |
| SRC07 | Lightspeed Oct 2026 saved charts | Lightspeed primary | 2026-10-22 | https://www.lightspeedhq.com/news/lightspeed-advances-its-connected-commerce-platform-to-help-merchants-run-smarter-and-capture-more-demand/ | AI-saved live charts as of October 2026 |
| SRC08 | Lightspeed Advanced Reporting | Lightspeed support | Accessed 2026-11-01 | https://resto-support.lightspeedhq.com/hc/en-us/articles/226404808-Advanced-Reporting | Custom drag/drop templates, PDF/Excel/CSV; L-Series different from K-Series |
| SRC09 | Lightspeed benchmarks | Lightspeed support | Accessed 2026-11-01 | https://k-series-support.lightspeedhq.com/hc/en-us/articles/28846463754523-Understanding-Benchmarks-and-Trends | Similar nearby peer benchmark, package varies by region |
| SRC10 | Foodics BI help catalog | Foodics support | Accessed 2026-11-01 | https://help.foodics.com/hc/en-us/categories/22106949880988-Foodics-BI | Deep inventory, KDS, retention, finance, comparison, scheduling |
| SRC11 | Foodics menu engineering | Foodics support | Accessed 2026-11-01 | https://help.foodics.com/hc/en-us/articles/22205249199644-Menu-Engineering-Deep-Dive-in-Foodics-AI | Stars/Horses/Puzzles/Turtles, business-day filters |
| SRC12 | Foodics report scheduling | Foodics support | Accessed 2026-11-01 | https://help.foodics.com/hc/en-us/articles/22199908400028-How-to-schedule-reports-in-Foodics-AI | PDF/XLSX/CSV schedules, triggers and recipient cautions |
| SRC13 | Oracle reporting catalog | Oracle primary | Accessed 2026-11-01 | https://docs.oracle.com/en/industries/food-beverage/reporting-and-analytics/rarrg/toc.htm | Broad restaurant operations, waste, affinity, KDS, employee exceptions |
| SRC14 | Oracle daily operations | Oracle primary | Accessed 2026-11-01 | https://docs.oracle.com/en/industries/food-beverage/reporting-and-analytics/rarrg/c_daily_operations_tsr_add.htm | Separate net sales, service, tax, collections, guests and checks |
| SRC15 | Oracle void item report | Oracle primary | Accessed 2026-11-01 | https://docs.oracle.com/en/industries/food-beverage/reporting-and-analytics/rarrg/c_voided_menu_items.htm | Voids by employee and reason |
| SRC16 | NCR Aloha reports | NCR Voyix primary | Accessed 2026-11-01 | https://docs.ncrvoyix.com/restaurant/aloha-cloud/results/reports/about_back_office_reports | Device activity, void audit, refund, item modifiers, staff and report exports |
| SRC17 | NCR Aloha net sales definitions | NCR Voyix primary | Accessed 2026-11-01 | https://docs.ncrvoyix.com/restaurant/aloha-smart-manager/reporting/sales/sales_summary_report | Shows vendor-specific gross/net definitions; do not assume universal metric semantics |
| SRC18 | TouchBistro reports | TouchBistro primary | Accessed 2026-11-01 | https://www.touchbistro.com/features/reporting-analytics/ | Vendor claims >50 reports; automatic daily email |
| SRC19 | Clover reports | Clover primary | Accessed 2026-11-01 | https://www.clover.com/pos-systems/business-tracking-reporting | Real-time multi-location sales, tax, EOD, exports |
| SRC20 | SpotOn report index | SpotOn support | Accessed 2026-11-01 | https://spotonteam.atlassian.net/wiki/spaces/SK/pages/4616290379/Reporting%2BSpotOn%2BRestaurant | Vendor claims >70 prebuilt reports, automation |
| SRC21 | Loyverse pricing | Loyverse primary | Accessed 2026-11-01 | https://loyverse.com/pricing | Free 31-day sales reporting, paid add-ons; verify prices by country/date |
| SRC22 | Loyverse reports | Loyverse support | Accessed 2026-11-01 | https://help.loyverse.com/help/reports | Reports, shifts, customer history, exports |
| SRC23 | Rewaa reporting | Rewaa primary | Accessed 2026-11-01 | https://rewaa.com/solutions/reports/ | Arabic region retail/restaurants sales inventory finance tax |
| SRC24 | Rewaa stock movements | Rewaa support | 2026-08-06 | https://help.rewaa.com/8671629-%D9%83%D9%8A%D9%81-%D8%AA%D8%AA%D8%A7%D8%A8%D8%B9-%D8%AD%D8%B1%D9%83%D8%A9-%D9%85%D9%86%D8%AA%D8%AC%D8%A7%D8%AA%D9%83-%D8%B9%D9%84%D9%89-%D8%A7%D9%84%D9%85%D9%86%D8%B5%D8%A9 | Product movement traceability; manual stock edits excluded from that report |
| SRC25 | R365 Sales and Prime Cost | Restaurant365 support | 2026-09-15 updated | https://docs.restaurant365.com/docs/sales-and-prime-cost | Prime cost, budgets, periods |
| SRC26 | R365 reporting API catalog | Restaurant365 support | 2026-10-27 | https://docs.restaurant365.com/apidocs/reports | Data grains and repeat-sales aggregation pitfall |
| SRC27 | R365 labor report grain | Restaurant365 support | 2026-10-27 | https://docs.restaurant365.com/apidocs/sales-and-prime-cost-labor-report | Net sales repeats by labor category; nonadditive hazard |
| SRC28 | dbt MetricFlow overview | dbt Labs docs | Accessed 2026-11-01 | https://docs.getdbt.com/docs/build/about-metricflow?version=2 | Versioned metric definitions; platform dependency caveats |
| SRC29 | dbt MetricFlow source | dbt Labs GitHub | Accessed 2026-11-01 | https://github.com/dbt-labs/metricflow | Compiles semantically defined metrics to SQL; joins and grain handling |
| SRC30 | Power BI RLS | Microsoft Learn | Updated 2026 | https://learn.microsoft.com/power-bi/service-admin-rls | RLS viewer/admin caveat; policies enforced server side |
| SRC31 | semantic layer study | ArXiv independent study | 2026-04-28 | https://arxiv.org/abs/2604.25149 | 3 models, 100 retail questions: +17 to +23pp; final accuracy 67.7%-68.7%, not 100%; limited benchmark |
| SRC32 | ETA e-receipt integration | Egyptian Tax Authority | Accessed 2026-11-01 | https://portal.eta.gov.eg/ar/content/e-receipt-services | Official portal, registration and technical links |
| SRC33 | ETA receipt submission FAQ | Egyptian Tax Authority | Accessed 2026-11-01 | https://sdk.invoicing.eta.gov.eg/receiptissuancefaq/ | Default 24h submission, batches, returns ≤540d per current FAQ; validate applicability |
| SRC34 | ETA eReceipt APIs | Egyptian Tax Authority | Accessed 2026-11-01 | https://sdk.invoicing.eta.gov.eg/ereceiptapi/ | Submission/search, response statuses, return receipt, exports |
| SRC35 | ETA restaurant VAT scope | Egyptian Tax Authority | 2025-05-18 | https://www.eta.gov.eg/ar/news/twdh-khdw-almtam-walkafyhat-almhddt-bqrarat-wzyr-almalyt-ldrybt-alqymt-almdaft | 14% applicability conditional on classification/registration; not blanket default |
| SRC36 | Egypt VAT law updates | Egyptian Tax Authority | Accessed 2026-11-01 | https://www.eta.gov.eg/ar/content/qwanyn-aldrybt-ly-alqymt-almdaft | 2025/2026 amendments; professional legal validation needed |
| SRC37 | Operator asks for item profit | Reddit self-reported | 2025-10-07 | https://www.reddit.com/r/restaurantowners/comments/1o0cfbe | Small anecdotal thread: reports hard to navigate; do not generalize prevalence |
| SRC38 | Toast reporting anecdote | Reddit self-reported | 2026-04-07 | https://www.reddit.com/r/ToastPOS/comments/1sejq7i/toast_reporting_errors_i_am_done/ | Anecdotal delayed sync and restated shift figures; not verified independent audit |
| SRC39 | Toast tip-shift anecdote | Reddit self-reported | 2026-07-19 | https://www.reddit.com/r/ToastPOS/comments/1v0cr66/beware_critical_shift_review_and_reporting/ | Anecdotal reconciliation issue; not generalizable |
| SRC40 | Square restaurant multi-site anecdote | Reddit self-reported | 2026-07-07 | https://www.reddit.com/r/SquarePOS_Users/comments/1uq46bt/restaurant_owners_considering_square_pos_heres_my/ | Anecdotal multiple locations + sync/payment friction |
| SRC41 | Square versus Toast community | Reddit self-reported | 2026-06-19 | https://www.reddit.com/r/restaurantowners/comments/1uagqvw/what_pos_systems_are_you_using_these_days/ | Reports, restaurant splits and perceived pricing, subjective |
