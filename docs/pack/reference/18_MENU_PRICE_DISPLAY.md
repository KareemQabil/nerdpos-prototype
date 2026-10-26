# 18. Menu price display contract (NP-D-06, decision E-27, 2026-10-21)

**Status:** binding for EXPERIENCE (S15 order entry) and the L1 demo. Evidence state: SPEC_ONLY.

## Rule

**Every price the operator sees comes from a server response. The browser formats prices; it never computes one.**

## L1 mechanism (accepted operations only)

| Where | Source | Request | Display |
|---|---|---|---|
| Menu tile | `Pricing.QuoteItem` (accepted, `POST /pricing/items/{productId}/quote`, `catalog:read`) | `{branchId, channel: DINE_IN, productId, quantity: "1", modifierOptionIds: []}`, one per **visible** tile | the quote's unit price, formatted from the server Money string (scale 4) |
| Modifier dialog, option rows | `ModifierGroup.List` (NP-D-07) | n/a | each option's `priceDelta` as a signed server string (shown as "+5.00"), with no sum |
| Modifier dialog, "line price" | `Pricing.QuoteItem` with the selected `modifierOptionIds` and quantity | re-quote on each selection change (debounced) | the quote result; while it is pending, a loading state, never a local sum |
| Cart line after adding | `Order.AddLines` → `Order.Get` | n/a | the line's **captured** price from the order (source of truth for that check) |
| Cart total | `Order.Get item.cartPreview` | n/a | the preview when AVAILABLE; otherwise the legacy total area with the "not available yet" label (verdict 17 §3) |

## Error mapping on a tile (from the QuoteItem errors)

| Error | Tile |
|---|---|
| `PRODUCT_UNAVAILABLE` | legacy "unavailable" style; add disabled |
| `PRICE_NOT_FOUND`, `TAX_POLICY_NOT_FOUND`, `PRICING_POLICY_REJECTED` | "price not available"; add disabled; the product stays visible (E-24) |
| `MODIFIER_UNAVAILABLE`, `MODIFIER_SELECTION_INVALID` (dialog) | the option shown unavailable; confirm disabled |
| network / 5xx | "price not loaded" + retry; add disabled until a quote is acknowledged |

A tile's quote is **display only**: `Order.AddLines` captures the price itself at the moment of adding. If the price changed between the quote and the add, the cart shows the captured price. The UI does not warn by comparing the two numbers.

## Caching

- Quotes are cached in the L1 server-observation layer, per context pin (verdict 17 §3), keyed by `{productId, modifierOptionIds, quantity, channel}`.
- `staleTime` is **60 s**, with a refetch on window focus (IMPLEMENTATION_DEFAULT).
- Price changes are an admin action (L2). The demo prices are fixed (NP-D-11).

## Cost and the L2 batch

- **L1 cost:** the demo menu (NP-D-11, ≥12 products) needs one small read per visible tile. That is acceptable for L1.
- **L2:** a batch read is requested from BUILD (`requests/DOMAIN-to-BUILD-NP-D-06-MENU-QUOTE-BATCH.json`): the same semantics, per-item results, no new pricing truth.
- **When the batch is released:** the UI switches the source only. The display rules above stay unchanged.

## Not decided here

- price display rounding beyond Money scale 4: it formats to the currency's display scale; for Egypt that is decided with NP-D-L2-03;
- tax-inclusive display: the quote returns what the pricing policy computes; no UI conversion.
