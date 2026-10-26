# NerdPOS clickable prototype: brief for the building agent

## What you are building

A **frontend-only, fully mocked, clickable prototype** of NerdPOS, a restaurant POS platform for Egypt. The owner will show it to restaurant and tax experts. They will change it freely, and **its final version becomes the product direction.**

So the prototype must express the real direction completely and faithfully:
- every screen;
- every journey;
- every business rule;
- every error;
- every setting.

It must not be a pretty demo that invents its own behaviour.

**There is no real backend.** You simulate the endpoints in the browser.

## Non-negotiable rules

1. **Use the real contracts.**
   - Every simulated endpoint, method, path, input field, error code and approval comes from `contracts/operations.json` and `contracts/errors.json`.
   - `contracts/openapi.main.json` is the accepted OpenAPI of what is already built.
   - Do not invent endpoints. If a screen needs something that does not exist there, take it from `03_DIRECTION.md`. If it is not there either, mark it in the UI as `مقترح` and list it in `PROTOTYPE_GAPS.md`.
2. **Enforce the business rules of `02_MOCK_RULES.md` inside the mock.** The prototype must refuse what the system refuses, with the same error codes and Arabic messages. Examples:
   - a fired line cannot be removed;
   - a retry never charges twice;
   - a table cannot close with an open check;
   - an approval is required when the policy says so.
3. **Settings are visible.** Build the **Policy Panel** (`03_DIRECTION.md` §2). Every business variation is a policy that the expert can flip live, and the screens react. This is the core idea of the product: one platform, many restaurants, no hard-coded choices.
4. **Design system.**
   - Use the design system the owner places in `design-system/` (tokens, components, fonts).
   - If it is missing when you start, build with neutral tokens in one theme file, so swapping is a one-file change.
   - Keep the legacy NerdPOS look the owner provides. Do not redesign it.
5. **Arabic first, RTL**, with Egyptian wording on screens.
   - Every screen also works in English through one i18n file.
   - Money is EGP with 2 decimals on screen; amounts are computed with 4 decimals internally using a decimal library, **never floating point**.
6. **Every screen shows its backend state:** a small badge `مبني` / `متصمم` / `مقترح`, from `backend_state` in `operations.json` or from `03_DIRECTION.md`. Experts must see what exists and what is direction.
7. **Feedback mode** (`03_DIRECTION.md` §3) is part of the deliverable.
   - Experts click any element and leave a comment.
   - Comments export as one JSON file.

## Technical choices (keep them simple)

- **Stack:** React + TypeScript + Vite.
- **Mocks:** an in-browser request layer that intercepts `fetch`, e.g. Mock Service Worker. Mock state is kept in memory and persisted in `localStorage`, with a "reset demo" button.
- **Seed:** `data/demo-provisioning-1.2.json` (branches, terminals, users and roles, menu, prices, taxes, tables, stations, policies).
- **Clock:** the mock has its own clock. A demo control can move time to test business-day cutoff, scheduled prices and happy hour. Business date = server rule (branch timezone Africa/Cairo, cutoff 04:00).
- **Multiple terminals in one browser:** the mock supports several simulated devices, e.g. waiter tablet T2, cashier T1, kitchen screen K1, so experts can see one action on one device appear on another.
- **No real network, no real payments, no real ETA calls.** External systems (card terminal, ETA, printers, aggregators) are simulated with controls for success, failure and timeout.

## Deliverables

1. **A runnable app:** `npm install && npm run dev`, plus a README.
2. **`PROTOTYPE_GAPS.md`:** everything you needed and could not find in the contracts or the direction.
3. **A walkthrough script:** a demo mode that replays `journeys/OPERATOR_WALKTHROUGH_J-R1_R4.md` and `journeys/SETUP_JOURNEY_J-A1.md` step by step.
4. **Failure scenarios:** the mock reproduces the negative controls in `journeys/NEGATIVE_CONTROLS_N1_N12.md`.

## Files in this pack

| Path | Use |
|---|---|
| `01_SCREENS.md` | screen list and journeys |
| `02_MOCK_RULES.md` | rules the mock must enforce |
| `03_DIRECTION.md` | planned capabilities, Policy Panel, feedback mode |
| `contracts/operations.json` | 261 endpoints: method, path, inputs, errors, approval, backend state |
| `contracts/errors.json` | 256 error codes with HTTP status and meaning |
| `contracts/openapi.main.json` | accepted OpenAPI (built today) |
| `rules/policies.json` | policies: allowed values and defaults |
| `rules/approval_actions.json` | manager-approval actions and their context |
| `rules/EG.profile.json` | Egyptian default values (VAT 14 %, service 12 % dine-in, cutoff 04:00, …) |
| `data/demo-provisioning-1.2.json` | demo seed |
| `journeys/*` | operator walkthrough, setup journey, negative controls, 1000 situation titles for extra demo scripts |
| `reference/*` | the product specification documents (CORE first) |
| `design-system/` | the owner puts the design system here |
