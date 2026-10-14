# Bounded Business insights

`GET /api/business/v1/insights` uses the existing Business authentication and fresh
authorization context. Require `overview.read` and an authorized `branchId`.
Accept either `from=YYYY-MM-DD&to=YYYY-MM-DD` or `period=all`. Future dates and
invalid ranges are rejected. Dates are interpreted in the branch timezone.

Discovery advertises `insightReporting: bounded-insights-v1` only when called with
`insights=1`, preserving compatibility with older strict discovery clients.

The endpoint reads synced sales directly using the existing `business_sales_day`
and `business_returns_day` indexes. Run the existing Business index migration as
part of deployment. No new collection, background publisher or write is involved.
It reads invoice dates and return dates, deduplicates invoices, excludes invalid
sales states, and uses existing canonical sales and item contribution functions.

The endpoint allows at most 10,000 scanned records across both queries, a 2.5s
read budget, a 3s calculation deadline and a 240KB response. Exceeding a bound
returns unavailable rather than partial financial totals. All-time therefore
works only while the complete source fits those bounds. A future materialized
aggregate can extend this without permitting unbounded cloud reporting work.

Amounts are integer minor units. Sales, dated returns and hourly billed sales
reconcile. Item rankings require `items.read`; staff requires `reporting.manage`;
payments require `tenders.read`. Unauthorized sections are null. Staff means the
invoice author, not necessarily the salesperson. Payments use invoice-date basis,
not collection-date cash flow, and must reconcile paid plus pending to billed
sales. Malformed tender data suppresses the entire payments section.

Item and quantity rankings derive from full source contributions before ranking.
Quantity ranks are grouped by unit. Incomplete item source suppresses rankings.
The response includes at most 50 bill contributions for browsing, not export.

Deploy this API before shipping the matching Business client. An older server
without the discovery capability leaves that client on its existing reports.
Cloud results include only received sync data; `checkedAt` is query verification
time and does not imply that every offline POS device has uploaded every sale.
