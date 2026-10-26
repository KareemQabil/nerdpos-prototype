# Direction: what the product will have, beyond today's backend

Show these in the prototype with the badge `مقترح`. They are the direction the experts will judge.

Mock them with the behaviour described here. If you need an endpoint, name it in the style of `contracts/operations.json` and list it in `PROTOTYPE_GAPS.md`.

## 1. Planned capabilities

| # | Capability | Behaviour to show |
|---|---|---|
| D1 | **Order line as a tree** | **Sizes** (S/M/L change the price and the price of toppings). **Combo** with slots and swaps ("fries → rings +5"). **Half-and-half** pizza (price = the higher half, or average, by policy). **Nested choice** one level deep (sauce for the side). The kitchen ticket shows the tree. |
| D2 | **Seats** | Assign lines to seats; split by seat. |
| D3 | **Split and merge checks** | Split by item, by seat, equally into N, or share one item between guests (fraction). Merge two checks of a visit. Discounts, service and cents are re-allocated by one deterministic rule (largest remainder; residual to the last share). |
| D4 | **Taxes and charges as components** | A product carries ordered components: VAT 14 %, table tax (on tobacco and nuts) stacked before or after VAT, exempt or zero-rated. Charges: service, minimum charge per person or table, packaging fee (takeaway only), entry or cover fee, delivery fee. Each component has a base, an order, a taxable flag and a fiscal code. Every component can be switched on, off or exempted per product, channel and branch. |
| D5 | **Joined tables** | One party across several tables = one visit; join and release tables. |
| D6 | **Tips** | Cash or card tip, its own money fact (never sales), distribution between staff, shown in the shift report. |
| D7 | **Wallets** | InstaPay and Vodafone Cash as tenders with a reference. |
| D8 | **Channel change** | Takeaway becomes dine-in (attach a visit) and the reverse, keeping the lines and the fired facts. |
| D9 | **Staff meal** | Not a sale, no receipt, own report line. |
| D10 | **Deposits** | For bookings, pre-orders and cakes. A deposit is a liability, not sales, until applied. |
| D11 | **Allergens** | Per product and option, shown on the tile and printed bold on the kitchen ticket. |
| D12 | **Kitchen modification** | A change after firing (doneness, extra) shows on the same ticket as "تعديل" linked to the original line. |
| D13 | **Accountant export** | Daily figures per branch and business date. |
| D14 | **Reservations** | With deposit and no-show fee. |

## 2. Policy Panel (the heart of the demo)

A slide-out panel, available on every screen in demo mode. It lists every policy from `rules/policies.json`, grouped by area, and the approval rules from `rules/approval_actions.json`.

For each policy, it shows:
- the current value;
- the allowed values;
- the Egyptian default (`rules/EG.profile.json`);
- the scope (tenant, branch, channel).

**Changing a value applies immediately to new actions,** and the screens react. Examples:
- FireTimingPolicy AT_CONFIRM hides the "send round" button;
- ServiceChargePolicy changes the bill;
- ApprovalRequirement for ORDER_DISCOUNT above 10 % triggers the manager popup.

**Changes never rewrite existing checks.** The panel says "applies to new actions only".

**Include the policies of the planned capabilities too:**
- half-and-half pricing rule;
- split allocation rule;
- tip distribution;
- stacked tax order;
- minimum charge;
- cash rounding: OFF in Egypt.

Mark these as `مقترح`.

## 3. Feedback mode

A toggle "وضع الملاحظات". In this mode, clicking any element opens a comment box with:
- the screen;
- the element;
- the comment text;
- a type: wrong / missing / unclear / extra;
- the expert's name and role (free text).

Comments are stored locally and listed in a side panel. They export as `feedback.json`:

```json
[{
  "screen": "C2",
  "element": "...",
  "type": "missing",
  "text": "...",
  "expert": "...",
  "role": "...",
  "policy_snapshot": {"...": "..."},
  "at": "ISO time"
}]
```

`policy_snapshot` records the panel values at the time of the comment, so we know which configuration the expert was looking at.
