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
Explicit legacy tracking strings `"true"` and `"false"` have the same meaning as
their boolean equivalents. BSON-double quantities may contain arithmetic noise:
accept at most four floating-point ULPs, capped at 0.0000001 stock units, around an
exact thousandth. Strings remain exact; genuine finer precision is unavailable,
including at large magnitudes where a purely relative tolerance would be unsafe.

## Actual writer verification

Eight MongoDB integration tests invoke real repositories/model methods and read
the resulting stock facts. They cover reorder crossings and restocking, competing
conditional deductions, legacy tracking, double arithmetic, scope changes, and
independent variant-family rows. The controller's `receivingInsertUpdate`,
`receivePartial`, `voidReceiving` and `returnReceivingOrder` methods are exercised:
full arrivals, edit differences, repeat edits, reductions, partial arrivals,
void/repeat void and supplier returns preserve the expected quantities.

These tests use the configured local MongoDB 7.0.14 binary. They establish these
stored-quantity transitions, not inventory truth, source completeness, concurrent
receiving safety or transport convergence.

The route audit matters: current receiving controllers call the model methods,
not `ReceivingService`. That unused service passes a closing balance to the
repository's delta-based `updateStock`, and must not be activated unchanged.
Likewise `ItemRepository.updateQuantity` has no callers in `api/src`; the separate
Mongoose receiving post-save hook increments `quantity`, whereas the controller's
model statics write `available_quantity`. A future route using that hook needs an
explicit stock-contract migration; these two fields must not be merged by guess.
Variant families use separate item rows with `variant_group_id`, `variant_axis`
and `variant_value`; the dimension-definition model is not their stock ledger.

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
