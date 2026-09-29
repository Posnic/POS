# Business low-stock reporting

Status: source audit, strict stock facts and a desktop preparation primitive.
The desktop worker and Community publication support the versioned stock job.
Cloud agent/Gateway stock transport is implemented in the paired review batch.
There is no public stock endpoint, mobile stock UI or alert enabled yet.

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

## Bounded desktop observation

`prepareDesktopStockSummary` refuses non-desktop and multi-tenant runtimes before
I/O. It reads the branch threshold from storage, then scans only that tenant's
branch-visible items with a narrow projection, 100-row batches, a 10,000-document
limit, a 15-second elapsed budget, 1.5-second cursor budget and cooperative yields.
Cancellation and budget exhaustion produce no snapshot. A changed/missing branch
setting at the final recheck also discards the observation.

The observation includes scan/excluded/verified/unavailable counts and fixed
reason codes, plus up to 100 low-stock rows in stable item-ID order, an exact
low count among verified rows, and explicit list truncation. A zero low count
with unavailable rows is not an all-clear result. Even an empty or fully parsed
scan always has `sourceComplete: false`: mutable item reads are not a consistent
point-in-time stock ledger, and sync convergence has not been established.
`observedFrom` and `preparedAt` describe the collection interval, not the last
stock-change time. No database writes or Cloud scan are introduced.

Five additional database tests cover mixed coverage, foreign scope, truncation,
10,001-row refusal, Cloud/cancellation/time-budget refusal, empty observations,
stored branch thresholds and settings changes during preparation.

## Contract and Community publication

`validateStockSummary` validates exact fields, scope, canonical observation times,
the 15-second interval, safe quantities, fixed reason codes and reconciled coverage.
The known low count cannot exceed verified rows. A truncated list must contain
exactly 100 rows; otherwise it must contain every known low row. IDs are unique
and ordered, units are required, and every listed quantity must satisfy its stated
threshold. Five unit tests exercise valid partial/empty observations and corrupt
scope, totals, quantities, versions, timestamps, duplicates and truncation.

Stock jobs require `summaryKind: stock`, `stockSummaryVersion: 1` and the key
`branchId:stock`. Date/session fields are forbidden, and stock-specific fields
cannot leak into the existing daily/register job kinds. The desktop worker uses
item scope indexes and invokes the stock preparer without creating a sales cursor.
It validates before staging and retains assignment/lease/version conditions.

Community enqueue/publish uses the existing assigned owner, reserved sequence and
publisher epoch. It validates staged and recovered stock payloads against that
owner's branch and tenant. Invalid observations are discarded with an explicit
error. Seven database tests cover actual preparation/publication, invalid staged
payloads, cross-tenant tampering, ownership replacement, future/aliased jobs and
interrupted reserved publication, including separation from daily snapshots.
The nine existing register-publication tests still pass.

Preparation additionally handles mixed legacy string/ObjectId ordering while
retaining only the first 100 canonical IDs. A duplicate logical ID rejects the
whole observation rather than inflating a count. Fourteen stock-source/preparation
database tests now pass. Public stock reads remain unavailable to mobile clients.

## Cloud publication

The desktop heartbeat advertises stock version 1 with an expiry tied to that
heartbeat. The paired Gateway branch negotiates this with the agent, stages a
separate stock job and validates the same bounded contract before reservation
and again during recovery. Unknown or stale capabilities do not receive stock
work. Uploads preserve explicit coverage and false source completeness; retries
retain the identical reserved envelope. Gateway rejects corrupt scope, counts,
quantities, future timestamps and observations older than 24 hours.

The eight stock-publication tests include an actual desktop -> agent -> Gateway
round trip with Cloud item/sales access forbidden. Tests use each application's
own MongoDB driver against the same test server so BSON-version differences do
not get confused with wire-contract failures. Gateway additionally passes 23
reporting tests covering legacy daily/session behavior, stock capability
withdrawal, malformed publications and interrupted/rejected recovery.

## Remaining implementation and verification

Trace actual sale, receiving, adjustment, return and variant stock writes through
sync before defining completeness. Keep preparation on the desktop and qualify publication against actual sync
and concurrent stock changes; do not calculate stock scans on Cloud. Add a negotiated `stock.read` endpoint and accessible mobile list with
units, threshold origin and freshness. Notification settings belong on the stock
notification page and need threshold-crossing/recovery identity, quiet hours,
recipient ACL rechecks and durable generic push retries. Test offline/reconnect,
restock, deletion, variants, ambiguous shared catalogue rows and concurrent workers
before enabling alerts. Never show an incomplete scan as an all-clear count.
