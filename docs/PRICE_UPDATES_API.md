# Price updates

The price editor and API use the same staged jobs. Every operation checks the
token/user's explicit branch membership and the tenant license. An owner does not
implicitly gain access to all branches.

Use `POST /api/items/priceSheet` with the existing scoped Bearer token and ordinary
tenant/branch request context. Grant `item.read` for review/export and `item.write`
for staging/applying. `branch.write` is also required to change short branch codes.

## Prepare and review

`{"action":"branches"}` lists the accessible IDs, names, short codes and timezones.
`branches` accepts those IDs, unambiguous codes, or `"all"` (all accessible branches).

Generate one 24-character hexadecimal `jobId` per logical update and retain it
when retrying. Do not create a new job ID after an uncertain response.

```json
{
  "action": "prepare",
  "jobId": "0123456789abcdef01234567",
  "branches": "all",
  "items": [{"sku": "21", "prices": {"selling_price": 75}}]
}
```

This stages and validates only. It never applies prices. Matching is exact:
duplicate SKUs are invalid and missing items are skipped with a reason. To resolve
duplicates, supply `ids: {"<branch-id>": "<item-id>"}` instead of SKU. Use
`branchPrices: {"<branch-id>": {"selling_price": 80}}` for individual branch prices.
Supported fields: `selling_price`, `company_price` (cost), `mrp_price`. Blank/null
New values preserve existing prices. Explicit zero values require `allowZero:true`.
Stock, item identity, past sales and purchase costs are not rewritten.

Up to 500 requested items may be prepared per call. Larger clients use `create`,
`append` (500 rows per call, stable `start` offsets), then `finish` with the expected
row total. A row contains `id`, `branchId`, `name` and
`changes:{selling_price:{old:70,value:75}}`. Maximum 100,000 staged rows per job.

`{"action":"status","jobId":"...","page":1,"filter":"changes"}` returns
counts and 50 review rows. Unchanged rows are hidden by default. Reusing a request
ID with a different price request is rejected. Interrupted staging is resumable
using the same ID, offsets and content.

## Apply or schedule

```json
{
  "action": "configure",
  "jobId": "0123456789abcdef01234567",
  "when": "tomorrow",
  "note": "Diwali offer",
  "holdUntil": "2026-10-24",
  "skipInvalid": false
}
```

`when` is `now`, `tomorrow`, or `custom`. Custom requires `localTime` in
`YYYY-MM-DDTHH:mm` format, interpreted in each target branch's configured timezone.
Tomorrow means the next local midnight. The optional selling-price hold ends at
the end of `holdUntil` in each branch timezone; expiry does not revert the price.
Held rows remain for attention unless explicitly included in `holdOverrides`
(item IDs from the review). Replacement is recorded in price history.

For `now`, call `{"action":"process","jobId":"...","skipInvalid":false}`
until status is no longer `running`. Each call processes at most 100 rows. Leases,
conditional old-price checks and item receipts prevent duplicate writes on retry.
For a scheduled job, a server worker processes due batches without an open browser.
Price conflicts are never silently overwritten.

`cancel` cancels a reviewed/future update before execution. `configure` edits a
future update. Once execution has begun, create a new update rather than rewriting
the old job. `list` supports `page`, `pageSize` (10/25/50), and `status`:
`scheduled`, `attention`, `complete`, `cancelled`, `review`, `running`.
The note appears in the list; the uploaded filename remains in audit metadata.
When editing or cancelling, send `revision` from the latest reviewed `job`.
New jobs use revision 0. Stale revisions are rejected; reload and review first.

## Installation ownership and sync

Jobs execute only on the server that owns them. Cloud schedules run even while
tills are closed; applied item prices use the existing item sync path. Locally
created due schedules recover before the local API accepts sales and are also
checked every minute. Jobs themselves are not replicated by generic sync.

An offline till cannot apply a cloud schedule it has not received. This change
does not add a cross-installation schedule-delivery protocol or prove that a till
has received a price update. Do not promise offline cloud-schedule activation or
completion at every till based only on the cloud job or a heartbeat.
