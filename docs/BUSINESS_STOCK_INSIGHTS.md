# Business low-stock reporting

Status: source audit and strict stock-fact validation only. There is no mobile
low-stock endpoint, prepared snapshot, schedule or alert enabled yet.

## Source findings

- The catalogue stores `items.available_quantity`, `unit`, `track_inventory` and
  `item_status`. Item settings write `reorder_point`; branch settings store
  `notification_range`. The per-item threshold overrides the branch threshold.
- Existing desktop reads differ: `getLowStockItems` converts invalid quantities
  to zero; dashboard `getLowStockSummary` uses a default threshold of ten and
  returns zero on error. The supplier low-stock picker additionally requires
  tracking and excludes soft-deleted products. These response shapes cannot be
  reused as verified Business stock reports.
- The older web-push producer takes the widest threshold across all branches,
  counts catalogue rows and uses POS web subscriptions. It is not a source for
  branch-scoped Business notifications or the separate Business session.
- Stock is a mutable stored quantity. `branch_access` can list multiple branches
  while the row still has only one quantity. Catalogue visibility alone does not
  establish a separate stock balance for each branch. The Business fact reader
  rejects ambiguous multi-branch quantities instead of assigning them to every
  accessible branch.

## Strict fact contract

`business-stock-facts.stockFact` validates tenant/branch identity, explicit
tracking, supported status, item name and unit. Deleted, inactive, draft, instant
and explicitly untracked items are excluded. Unknown tracking or malformed scope
is unavailable, not a zero-stock fact. Quantity and threshold use exact integer
thousandths in the item's own unit; negative on-hand stock is preserved. Zero is
a valid reorder threshold. A missing threshold is unconfigured, with no invented
default. Low means on-hand quantity is at or below the selected threshold.

Four unit tests cover decimal precision and overflow, per-item precedence, zero
and negative quantities, unknown settings, exclusion and ambiguous branch scope.
This establishes parsing rules, not inventory truth or source completeness.

## Remaining implementation and verification

Trace actual sale, receiving, adjustment, return and variant stock writes through
sync before defining completeness. Prepare bounded desktop snapshots with explicit
unavailable/excluded coverage and publisher fencing; do not calculate stock scans
on Cloud. Add a negotiated `stock.read` endpoint and accessible mobile list with
units, threshold origin and freshness. Notification settings belong on the stock
notification page and need threshold-crossing/recovery identity, quiet hours,
recipient ACL rechecks and durable generic push retries. Test offline/reconnect,
restock, deletion, variants, ambiguous shared catalogue rows and concurrent workers
before enabling alerts. Never show an incomplete scan as an all-clear count.
