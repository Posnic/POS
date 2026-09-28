# Business item insights implementation

Status: in progress. A bounded item-ranking endpoint is implemented in the local
review branch; the mobile ranking screen is pending. The existing prepared
overview and daily history response contracts remain unchanged.

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
fully discounted returns and ambiguous historical state. A separate real MongoDB
fixture now exercises the actual Gateway router and sync agent over HTTP,
including incremental partial/full returns and suppression of unchanged echoes.
Original decimal facts survive both cloud storage and another till's download.
Run `api/tests/business-item-sync.integration.cjs` with
`POSNIC_BUSINESS_TEST_GATEWAY_ROOT` pointing to the Gateway checkout; the fixture
injects device identity and does not qualify deployed authentication or HTTPS.

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

- Integrate the bounded endpoint into the mobile ranking/detail views and label
  allocated revenue rather than implying item profit.
- Add mobile ranking/detail views, accessible gestures and qualified translated
  explanations, followed by actual sale/return and native-device validation.

## Item contribution boundary

`business-item-metrics.js` first applies canonical v2 sale eligibility and scope
validation. It validates snapshot identity, invoice date/total, canonical decimal
facts and bounded lines before allocating revenue. Unreturned invoices can use
their current original lines; historical returned invoices require a snapshot.
Each dated refund uses its own return lines and recorded refund total. Daily
allocated money must reconcile exactly to canonical invoice/refund totals.

Quantity counters use integer thousandths and retain separate units. Every
returned item/unit must exist in the original invoice and cumulative returned
quantity cannot exceed the original. Invalid or incomplete history throws an
explicit error; publishers must not treat it as zero sales. A contribution is
bounded to 1,000 original lines and 10,000 total return lines, with the existing
1,000-line bound on each return. These are desktop calculations, not request-time
Cloud or phone scans. Unit tests and actual return-writer integration tests now
verify this boundary. Prepared storage and API authorization are now implemented
and tested; mobile ranking remains outstanding.

The desktop preparer accepts an explicit `includeItems: true` option. Updated
workers advertise item-summary version 1; the sync agent enables the option only
when the Gateway work response also advertises version 1. Older combinations
continue preparing the existing overview. Community jobs enable the option
locally. It adds item facts
to the existing bounded source scan and considers only invoices contributing to
the requested business day. The accumulator validates all relevant invoices,
keeps at most 10,000 items and 16 quantity units per item, and emits the top 20
after aggregation. Ranking uses allocated sales after returns with item ID as
the tie-break; refund-only days can contain negative figures. The result is for
one branch/day and must not be combined with other truncated branch rankings
to claim a global top list.

Missing or invalid item history suppresses the whole ranking, records an
incomplete state and unavailable invoice count, and leaves validated overview
totals available. `available` describes validated item facts from the scanned
source, not complete device synchronization: the parent `sourceComplete` remains
false. Real MongoDB tests cover scoping, old unrelated invoices, legacy payload
compatibility and ranking suppression. Gateway validation bounds item counts,
names, units and quantities, checks ordering/uniqueness and reconciliation, and
retains existing ownership, sequence and retry fencing. Integration tests cover
negotiation combinations, invalid rankings, incomplete-state replacement and
Community crash recovery. A cross-repository real MongoDB test runs the actual
desktop worker, sync-agent publisher and Gateway service, then reads through the
Business API service. It covers a truncated 25-item ranking with a refund and
replacement by an incomplete result after a legacy invoice arrives. This
reporting fixture uses an in-process transport; the separate snapshot test uses
actual HTTP sync. Neither is deployed HTTPS/device qualification.

## Bounded read contract

`GET /api/business/v1/items?branchId=<id>&businessDate=YYYY-MM-DD` requires the
dedicated Business session and current `overview.read` and `items.read` access.
It accepts exactly one authorized branch. It shares overview date bounds,
publisher assignment/sequence fencing, timestamps and partial/delayed freshness,
and reads only prepared summaries and reporting metadata. Ordinary overview
queries exclude stored item rows from their projection and response.

The response contains overview metadata/totals plus `itemInsights` using the
bounded schema described above. The reader validates that schema again at the
storage boundary. Missing or invalid prepared item data returns 503; incomplete
history is a 200 response with `state: incomplete` and an empty ranking. A valid
empty day has `state: available` and `totalItems: 0`. The UI must distinguish
these cases and retain the parent freshness/completeness warning.

`GET /api/business/v1/discovery?items=1` advertises
`itemReporting: bounded-items-v1`; unqualified discovery retains its existing
response for older strict clients. HTTP tests cover live ACL removal, wrong and
multiple branches, publisher pending state, malformed rows, incomplete state and
no-store responses. Mobile integration and release qualification remain open.
