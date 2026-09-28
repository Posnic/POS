# Business item insights implementation

Status: in progress. No item-ranking endpoint or mobile ranking is enabled by
this change. The existing prepared overview and daily history remain unchanged.

## Source constraint

`sale.service.js` records item totals after line discounts and tax in both `total`
and the legacy `total_amount`. Header discounts, coupons, loyalty and rounding
then change the recorded invoice `sales_total`.

`sale.repository.js` replaces `items` with the remaining item list after a
return; a full return empties it. The original `sales_total` stays on the invoice,
and each return stores its own `returnArray.returnValue` and recorded
`itemsTotalAmount`. Consequently, scanning the current `items` array cannot
produce historical invoiced item sales. Adding returned quantities blindly is
also insufficient proof of original prices and line discounts. This must be
resolved through an original-item snapshot and explicit legacy-data handling
before ranking is published. Analytics must not make a valid refund fail.

The return writer now stores `business_item_origin` in the same locked update
that appends the first return. The snapshot keeps invoice identity/date/total
and bounded original item IDs, names, units, decimal quantities and gross line
amounts. Core/legacy aliases must agree. Later returns cannot replace it.
Pre-existing returned records without a snapshot remain unproven; remaining
items are not promoted to originals. Invalid, oversized or contradictory source
facts skip optional analytics metadata without stopping the refund. The helper
also checks the resulting BSON size including the pending return writes.

Actual MongoDB return-writer tests cover partial/full returns, a second return,
fully discounted returns and ambiguous historical state. The sync agent and
Gateway currently transfer complete sales documents, so no field allowlist
change is indicated by source inspection; an actual snapshot sync round-trip
and downstream validation remain required before publishing ranking data.

## Exact allocation primitive

`business-item-allocation.js` allocates an already recorded, nonnegative invoice
or refund total in minor units. It does not price a bill. The caller supplies
validated original item weights after line discounts and tax; refund weights
come from that specific return's immutable item lines.

The function groups repeated item IDs before allocating, computes proportions
with integer arithmetic, and distributes remaining minor units by largest
remainder with item ID as the tie-break. Input order and splitting a repeated
item across lines therefore do not alter its allocation. Free lines receive no
share, and an all-zero weight is permitted only for a zero recorded total.
Currency precision is handled before this boundary; allocation never assumes
two decimal places. The input is bounded to 1,000 lines.

Tests cover reordered and split items, discounts and upward rounding, zero and
three-decimal minor units, maximum safe totals, invalid values, and exhaustive
small allocations that conserve the recorded total and stay within one minor
unit of each exact proportional share.

## Remaining delivery

- Qualify original-item snapshot synchronization and downstream validation,
  with explicit handling of pre-existing returns without proof.
- Reconcile item allocations to the canonical invoice and dated refund totals.
- Prepare bounded per-item summaries on the assigned desktop, with publisher
  fencing, completeness metadata and no item scan during mobile/server reads.
- Enforce item-sales ACL and branch scope, preserve unit distinctions for
  quantities, and label allocated revenue rather than implying item profit.
- Add mobile ranking/detail views, accessible gestures and qualified translated
  explanations, followed by actual sale/return and native-device validation.
