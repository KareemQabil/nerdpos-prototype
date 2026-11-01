# Round 3 — Traceability (13 notes · 45 tasks · acceptance)

Baseline: repo `KareemQabil/nerdpos-prototype`, branch `main`. Frontend-only prototype: an in-browser mock server
(`src/mock/`) built from the contracts — no real backend, printer, fiscal platform or LAN. Design rationale:
[`DESIGN.md`](./DESIGN.md) (five principles).

Status vocabulary (from the handoff): `FIXED_AND_TESTED` · `VERIFIED_EXISTING` · `PARTIAL` · `DEFERRED` ·
`NOT_TESTED_HARDWARE`. "Tested" means a scripted test or a Playwright run in the mock — never a real device.

Test assets: `scripts/journeys-test.ts` (all journeys incl. new **J-P1** "مين عمل ومين سمح", N1–N12),
`scripts/reports-engine-test.ts` (56 checks), `scripts/reports-eval.ts` (198 questions), `scripts/r3c-api-test.ts`
(43 checks). Final run on this commit: journeys `FAILURES: 0`, engine `PASSES 56 / FAILURES 0`, r3c `FAILURES 0`,
`tsc` clean, production build OK, 132 screens × 7 devices opened with 0 console errors.

## A. The 13 prototype notes

| Note | Screen | Root principle | Resolution | Proof |
|---|---|---|---|---|
| F3-01 staff-meal return before kitchen / after kitchen / after close | D3 | 1 Authority | Staff meals are real zero-price orders; cancel/return through stages S0/S1/S3, each with its own approval rule; listed in Counter and Refunds | J-P1-6; Playwright |
| F3-02 "ready for hand-off" only on a chosen screen | F1 | 3 Venue config | KDS screens subscribe to stations; ready column, expo, hand-off and call-out board only on the dispatch screen; server refuses hand-off elsewhere (`KDS_DISPATCH_ONLY`); "شاشات المطبخ" admin; seeded K1 dispatch + K2 grill | Playwright |
| F3-03 staff meal needs manager authorisation | C2 | 1 Authority | Employee picked from users; `STAFF_MEAL` approval (PIN / card / fingerprint / remote); no self-approval; daily allowance by sale value or cost | J-P1-5; Playwright |
| F3-04 cashier voids, manager authorises on the same screen | C2 | 1 Authority | Supervisor override in the kernel: actor without permission → `APPROVAL_REQUIRED` → approver holding it grants in place (PIN, manager card, fingerprint — card/fingerprint simulated) | J-P1-1/2/3; Playwright |
| F3-05 online vs wallet vs card duplication | D1 | 3 Venue config | Tenders = cash / card / wallet (provider picked once) / prepaid (only app or payment-link orders) / points; counter «أونلاين» removed; payment link moved to the delivery flow | Playwright + headless |
| F3-06 reference field optional per venue | D1 | 3 Venue config | `TenderReferencePolicy` off/optional/required per method (default optional), enforced server-side; duplicate references refused | Playwright + headless |
| F2-01 "approve & pay" by manager PIN | D3 | 1 Authority | Refund paid on the cashier's device from her drawer with the manager's grant; paying from the manager PC refused (`REFUND_NEEDS_CASHIER_DRAWER`) | J-P1-3 |
| F2-02 void before cash needs permission + trace | C2 | 1 Authority | **Owner decision:** every removal of an unpaid line needs a manager (PIN or notification); every add/remove traced (who, approver, stage, reason, qty, value) | J-R1-9, J-P1-1/2/8 |
| F2-03 demo clock must not be changeable | DEMO | 2 Trusted time | **Owner decision:** clock shown, accounting time never editable. All time-change controls removed; read-only server clock; time never goes backwards; menu "preview at time" instead of moving time; scenarios age records | Playwright + headless |
| F2-04 simplify inventory/menu/receiving/product + detailed search with follow-up | B1 | 4 Journeys | Ctrl+K record search with live status and "تابع"; item 360 lifecycle page; guided new product; purchasing as four linked documents | Playwright |
| F2-05 exceptions in bulk price change | B2 | 3 Venue config | Row checkboxes + saved exception list, result = preview (applied vs excluded), pinned prices respected; sales channels as records («طلبات») | API test + Playwright |
| F2-06 chef not forced to press Start | F1 | 3 Venue config | Start hidden/optional/required per KDS screen; timer always from arrival; `startedAt` separate | Playwright |
| F2-07 delivery customer panel crowded | DL1 | 4 Journeys | Compact one-line customer header with expand | Playwright 1600 / 1024 |

## B. The 45 work items

| Task | Status | Where / note |
|---|---|---|
| P0-001 Repo baseline | VERIFIED_EXISTING | Pinned repo, commits on `main`, mocks vs real documented in README |
| P0-002 Decisions inventory | FIXED_AND_TESTED | `DESIGN.md`; policy snapshot values kept |
| P0-003 Tables lifecycle | VERIFIED_EXISTING | Open table without check, guests, visit timer (round 2) |
| P0-004 Seat allocation | VERIFIED_EXISTING | Optional seat per line, shown on kitchen ticket |
| P0-005 Check/item lifecycle | VERIFIED_EXISTING | J-R1 |
| P0-006 Check split + limit | FIXED_AND_TESTED | `SplitLimitPolicy` (checks ≤ guests) — J-P1-9 |
| P0-007 Monetary split exactness | VERIFIED_EXISTING | 100/3 → 33.33+33.33+33.34 in engine test |
| P0-008 Multi-tender | FIXED_AND_TESTED | Tender taxonomy + reference policy |
| P0-009 Order number & offline mapping | PARTIAL | Immutable transaction id + optional short number (daily / every N); offline numbering only in the browser simulation, not a branch LAN |
| P0-010 Offline queue & recovery | VERIFIED_EXISTING (simulated) | Per-device queue + replay + conflicts (round 2); not multi-machine |
| P0-011 KDS routing | FIXED_AND_TESTED | Station subscriptions + dispatch screen |
| P0-012 KDS timer + aggregate | FIXED_AND_TESTED | Timer from arrival; fixed all-day panel split by options |
| P0-013 Print queue accuracy | NOT_TESTED_HARDWARE | Same transaction + short number on receipt and kitchen ticket; queue states; no physical printer |
| P0-014 Void before cash | FIXED_AND_TESTED | Stages S0/S1 with approval and trace |
| P0-015 Refund after cash, pre-close | FIXED_AND_TESTED | Auto-filled value, partial, manager grant on cashier device, drawer recorded |
| P0-016 Refund after EOD | FIXED_AND_TESTED | `RETURN_AFTER_CLOSE` third permission; closed day unchanged; booked today; linked |
| P0-017 Merchandise disposition | FIXED_AND_TESTED | Not prepared / back to stock / waste held + accountant void review |
| P0-018 Staff meals | FIXED_AND_TESTED | Employee, approval, allowance, zero tender, stock |
| P0-019 Staff meal cancellation | FIXED_AND_TESTED | Before / after kitchen / after close |
| P0-020 Clock authority | FIXED_AND_TESTED | No editable time; monotonic; 04:00 Cairo business date |
| P0-021 Audit and approvals | FIXED_AND_TESTED | Actor vs approver, credential, TTL, replay, self-approval, remote rejection |
| P0-022 Reconciliation | FIXED_AND_TESTED | End-of-day money bridge + drawer bridge + 9 certified checks |
| P0-023 Fiscal safety | VERIFIED_EXISTING | No delete/hide of sales; SANDBOX; the assistant refuses "erase sales" |
| P0-024 End-to-end pilot | PARTIAL | Full journeys pass in the mock; real devices/printers/LAN not tested |
| P1-025 Delivery UI | FIXED_AND_TESTED | Compact customer header |
| P1-026 Delivery operations | VERIFIED_EXISTING | Internal drivers, zones, fees (round 2) |
| P1-027 Channel price rules | FIXED_AND_TESTED | Sales channels + Delivery +20% with tea exception |
| P1-028 Scanner flow | FIXED_AND_TESTED (keyboard-wedge simulation) | Fast keystrokes + Enter add the item without focusing a field; Enter in the search box picks an exact code; unknown code → message. No USB device tested |
| P1-029 Inventory product flow | FIXED_AND_TESTED | Guided new product → menu → POS |
| P1-030 Replenishment & purchasing | FIXED_AND_TESTED | Target − on hand; 100 → 80 → 60 → 60 |
| P1-031 Package/vendor comparison | FIXED_AND_TESTED | Pack cards + best pack / supplier |
| P1-032 Reporting baseline | FIXED_AND_TESTED | Registry (85 metrics, 34 dimensions) + 19 certified reports; awaiting operator sign-off (expert review inside) |
| P1-033 Report templates | FIXED_AND_TESTED | A4 + receipt templates with logo; CSV/Excel with metadata |
| P1-034 Printer template languages | FIXED_AND_TESTED (screen) | Second language on receipt/kitchen/menu when the item has a second name |
| P1-035 Management policy UI | FIXED_AND_TESTED | KDS screens, Start, tender reference, channels, permissions, approval credentials |
| P1-036 Inventory/menu usability | FIXED_AND_TESTED | Search + item 360 |
| P1-037 Reports source-of-truth checks | FIXED_AND_TESTED | Rounding report, approvals, staff meals, voids by stage, after-close returns |
| P1-038 Approval UX | FIXED_AND_TESTED | PIN / card / fingerprint / remote; pending / approved / denied |
| P1-039 Payment UX | FIXED_AND_TESTED | Tender taxonomy |
| P1-040 Table cleaning & visit closure | VERIFIED_EXISTING | `TableTurnPolicy` (round 2) |
| P1-041 Role/user overrides | FIXED_AND_TESTED | Per-user grants/revocations with expiry; vendor-only licensing |
| P2-042 QR table assistance | DEFERRED | Ideation in the meeting |
| P2-043 AI reporting interface | PARTIAL (owner decision) | Rule-based text assistant over certified layers: 198/198 questions understood; no LLM, no voice |
| P2-044 External ordering integrations | DEFERRED | Not needed for the pilot; simulated online inbox exists |
| P2-045 Enhancement ideas | PARTIAL | Low-stock/expiry alerts on Home and search; notifications channels not built |

## C. Acceptance matrix (A01–A22)

| ID | Status | Evidence |
|---|---|---|
| A01 table → check → kitchen once | VERIFIED_EXISTING | J-R1 |
| A02 two stations + dispatch, modifiers distinct | FIXED_AND_TESTED | r3B Playwright |
| A03 Start off/on | FIXED_AND_TESTED | r3B Playwright |
| A04 100.00 / 3 | FIXED_AND_TESTED | engine test |
| A05 fourth check | FIXED_AND_TESTED | J-P1-9 |
| A06 pre-bill then removal | FIXED_AND_TESTED | J-P1-1 |
| A07 refund 28.50 full/partial | FIXED_AND_TESTED | J-P1-3 |
| A08 next-day return | FIXED_AND_TESTED | J-P1-4 |
| A09 staff meal | FIXED_AND_TESTED | J-P1-5/6 |
| A10 mixed tender, references | FIXED_AND_TESTED | r3B |
| A11 no orphan piaster | FIXED_AND_TESTED | engine test + rounding report |
| A12 OS clock back | FIXED_AND_TESTED (browser) | monotonic clock; real product must use server time |
| A13 two devices offline | VERIFIED_EXISTING (simulated) | round 2 sync |
| A14 print spool retry | NOT_TESTED_HARDWARE | queue states only |
| A15 Delivery +20% with tea exception | FIXED_AND_TESTED | r3c test |
| A16 target 100 / on hand 20 / 60 received | FIXED_AND_TESTED | r3D |
| A17 reports cross-check | FIXED_AND_TESTED | engine test parity |
| A18 permissions abuse | FIXED_AND_TESTED | J-P1-1/2/3/8 + r3c test |
| A19 abuse/negative cases | FIXED_AND_TESTED | duplicate references, replay, stale edit, refund above paid, after-close |
| A20 real devices | NOT_TESTED_HARDWARE | — |
| A21 13 notes traced | FIXED_AND_TESTED | this file |
| A22 visual regression | FIXED_AND_TESTED | 132-screen sweep, dark, 1600px |
