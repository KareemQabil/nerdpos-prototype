# 27. Operator reports (W8, NP-D-L2-13, CORE G1)

**Status:** WORKER proposal (author `opus`), for DOMAIN review. Evidence state: SPEC_ONLY. Branch `agent/opus/w8-operator-reports`, base `agent/claude/domain-line` @ `8bd7f99c`.

**Outputs of `reference-tools/author_worker_w8.py`:**
- 10 reporting fragments;
- the typed report catalog `reporting/operator-reports.json`, checked by `reporting/check_operator_reports.py` (8 rules, `--selftest` 11 cases).

## 1. What canonical already gives

| Fact | Source |
|---|---|
| `Report.Run` (`GET /reports/{reportId}`, `report:run`, gap API-B10) selects registered metrics over registered dimensions. | canonical |
| Invariants: templates cannot define metrics (REP-001); an absent capability is `CAPABILITY_NOT_AVAILABLE`, never 0 (REP-002); every value has lineage and drill-down (REP-003). | canonical reporting module |
| 15 metrics (gross_sales, discounts, net_sales, tax, gross_tender, refunded_tender, net_tender, average_order_value, expected_cash, …) plus 13 v4 additions (order_voids, line_voids, comps, discounts_by_reason, no_sale_opens, cash_variance_by_cashier, cash_movements_by_kind, refunds_by_method, tender_corrections, reprints, approval_usage, …). | `reporting.metrics`, `v4_added_metrics` |
| Reconciliations: sales_vs_historical_settlement, tender_vs_cash_session (patched), session_snapshot_vs_ledger, approval_consumption, open_session_duration, … | `reporting.reconciliations` |
| Refunds count on their payout date and never restate the original Z. | canonical net_sales |
| **No dimension registry exists**: `DimensionId` is a bare string. | canonical types |

## 2. Delivered

| Item | Purpose |
|---|---|
| `reporting/operation/Report.Run` | AUTHORED, `replaces_existing`. Named report, business-date period, branch scope, provisional flag, sections and reconciliation checks. |
| `reporting/operation/Report.List` | `GET /reports`: the reports the caller may run |
| `reporting/policy/ReportAccessPolicy` | Per report, the extra permission needed (the "report scopes by role" knob) |
| `reporting/contract_type/*` | `ReportRunResult`, `ReportSection`, `ReconciliationCheck`, `ReportPeriod`, `ReportTemplateView` |
| `reporting/error/REPORT_NOT_FOUND` | Unknown, or not allowed (no existence leak) |
| `reporting/change_request/Report.Run` | To BUILD: register the 14 dimensions, the 8 requested metrics, 2 reconciliations and the catalog |
| `reporting/operator-reports.json` | 8 reports, 14 dimensions, 20 canonical + 8 requested metrics, with the allowed dimensions per metric |

## 3. The reports

| Report | Access (EG) | Period | Sections |
|---|---|---|---|
| daily_sales | report:run | one business date | summary: order_count, gross_sales, discounts, comps, service_charge, tax, net_sales, average_order_value, guest_count; by channel; **outstanding checks** (as of now) |
| tenders | report:run | one business date | per method: **gross captured** (gross_tender), **refunded** (refunded_tender), **net collected** (net_tender); tender corrections |
| products | report:run | range | top 50 products by item_net_sales (quantity and net); by category |
| staff | session:zreport | range | servers (orders, net, AOV, discounts, comps, voids); cashiers (captured, refunded, no-sale opens, variance) |
| exceptions | session:zreport | range | voids and cancels, discounts and comps by reason, refunds by method, drawer and cash moves, reprints by user, approvals used, open drafts aging |
| shift | session:xreport | one business date | drawers of the day (expected cash, variance); tenders per drawer. The **Z stays the shift authority** (`Session.ZReport`). |
| peak_hours | report:run | range | orders, net and guests by hour and by weekday (branch local) |
| branch_comparison | session:zreport | range | orders, net, AOV, net collected, comps and voids per branch |

## 4. Rules

| Rule | Detail |
|---|---|
| Business day per branch | Every fact carries its server-resolved business date. Reports filter on it, never on a calendar day. A range is at most 93 days. |
| Branch scope | `branchIds` must be accessible. A pinned context sees its branch only. The default is the accessible branches. |
| Read model | One REPEATABLE READ snapshot, with `asOf`. Reporting writes nothing. Z snapshots are frozen and read as such. |
| Provisional | `provisional` is true when a session of the period is OPEN, or the last business date has not ended in branch time. |
| Measures | Tenders are never called "sales". Service charge is its own measure, never inside net sales (docs/25). Tips do not exist. |
| Refunds | They count on the payout business date. An earlier day is never restated (`RESTATED` is `CAPABILITY_NOT_AVAILABLE` in CORE). |
| Outstanding checks | Unpaid confirmed checks never block a Z (unified plan 2.1). They are listed in daily_sales as `outstanding_checks`. |
| Category | The category captured on the line snapshot. If the snapshot has none, the current category is used, labelled `CURRENT`. |
| Absent capability | The metric is `CAPABILITY_NOT_AVAILABLE`, never 0 (for example guest_count without tables). |

## 5. Reconciliation proof table

Notation: D = a business date, B = a branch, S = a drawer session of B, m = a tender method.

| # | Check | Equation | When it holds exactly | Legitimate, explained difference | Status otherwise |
|---|---|---|---|---|---|
| 1 | daily_tender_vs_z (new) | tenders(D, B, m) = Σ_S [captures and refunds of S with businessDate D, method m] | every session of B opens and closes inside D | a session that spans the cutoff contributes to two dates. The check lists the session ids; its Z is still one number for the whole session. | BROKEN |
| 2 | tender_vs_cash_session (canonical, patched) | cash captures − cash refunds + net cash corrections of S = Σ CashEntry of kinds TENDER_IN, REFUND_OUT, TENDER_CORRECTION_IN/OUT of S | always | none | BROKEN |
| 3 | session_snapshot_vs_ledger (canonical) | Z.expectedCash = Σ CashEntry up to the snapshot cursor | always | none | BROKEN |
| 4 | sales_vs_historical_settlement (canonical) | Σ payable of orders completed in D = Σ settlementAtCompletion of those orders | always | none | BROKEN |
| 5 | item_net_vs_order_net (new) | Σ item_net_sales (D) = Σ order net before refunds (D) − service_charge (D) | always (frozen calculation) | none | BROKEN |
| 6 | approval_consumption (canonical) | sensitive audit rows with a grant = grants consumed by those commands | always | none | BROKEN |
| 7 | open_session_duration (canonical) | OPEN sessions older than SessionDurationPolicy.maxHours = 0 | normal operation | none: the check shows which drawers to close | UNEXPLAINED |

**Why daily sales and daily tenders need not be equal** (they are different measures, so there is no check that they match):

| Reason | Effect on D |
|---|---|
| A check confirmed in D and paid on D+1 | sales on its completion date, tender on its capture date |
| Outstanding checks | in sales only once completed; listed separately |
| Refunds | in net_sales and refunded_tender on the payout date |
| Partial payments of an incomplete check | tender in D, sales later |

**The owner's daily control.** The daily report reconciles to Z through checks 1 to 3. Sales reconcile to settlement through check 4.

## 6. Requested from BUILD (change request on Report.Run)

| Item | Content |
|---|---|
| Dimensions (14) | businessDate, branch, channel, product, category, server, cashier, actor, session, tenderMethod, reasonCode, hourOfDay, dayOfWeek, approver, each with type, fact grains and source |
| Metrics (8) | order_count, item_quantity, item_net_sales, service_charge, order_cancels, outstanding_checks, guest_count, open_drafts_aging (formula, authority, time and period in the catalog) |
| Reconciliations (2) | daily_tender_vs_z, item_net_vs_order_net |
| Catalog | `operator-reports.json` compiled as product data for Report.Run and Report.List |

## 7. Business choices and questions

| Item | Canonical default | EG profile | Label | Confidence | Question |
|---|---|---|---|---|---|
| ReportAccessPolicy | catalog values | staff, exceptions and branch comparison for managers (`session:zreport`); shift for shift leads (`session:xreport`) | MARKET_CONVENTION | MEDIUM | Who may see staff performance and voids by person? Should cashiers see daily sales? |
| Manager proxy permission | `session:zreport` stands for "manager" | same | OPEN_DECISION | n/a | Do you want a dedicated report-role permission (a BUILD request)? |
| Top products limit | 50 | 50 | IMPLEMENTATION_DEFAULT | n/a | n/a |
| Range bound | 93 days | 93 days | engineering, no switch | n/a | n/a |
| Closed business day | none (PD-V4-14, BusinessDay.Close held) | none | OPEN_DECISION | n/a | Do you need to "close the day" so the daily report becomes frozen like a Z? |
