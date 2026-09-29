# Business stock alerts: desktop observation and journal

This is the source-state foundation for low-stock notifications. It is not wired
into the scheduled reporting worker or a delivery channel yet. Preview 3 does not
contain stock notifications. Enabling a producer before durable publication and
acknowledgement exist would fill its outbox, so the journal is currently invoked
only by integration tests.

`prepareDesktopStockObservation` uses the same desktop-only bounded scan as the
public stock summary. It retains up to 10,000 verified item facts, including healthy
items and low items beyond the public 100-row list. Unknown and excluded records
remain explicit coverage gaps. Duplicate logical IDs, including an invalid legacy
copy, reject the observation. Failed, cancelled and over-budget scans return no
observation. The ordinary public summary does not retain or transmit this full set.

`journalStockObservation` validates the whole observation before writes. Each item
has a private installation-local record in `business_stock_alert_local`, excluded
from generic sync. A first observed low item creates an episode. Further low
observations do not create another episode. Only an explicit verified quantity
above the configured threshold re-arms it; missing, excluded and unknown items do
nothing. Threshold or unit changes are not evidence that goods were received, so
no restocking or recovery notification is inferred. All events retain the actual
quantity, unit, threshold and observation interval with `sourceComplete: false`.

Classification and pending episode are written together using revision compare
and swap. Deterministic episode IDs make replay after a lost acknowledgement or a
process restart idempotent. Older observations cannot undo newer state; overlapping
observations and conflicting values at the same completion time are rejected.
Observations older than 24 hours cannot create new state. A batch visits at most
100 facts with a three-second elapsed budget and 500 ms database-operation budgets.
`complete` and `nextAfter` let the worker persist progress against the same
immutable observation. A cancelled or interrupted batch may have committed some
items; replay is required and safe. Twenty pending episodes per item impose
backpressure instead of silently discarding alerts. No outbox acknowledgement or
cleanup is implemented yet.

`createStockAlertWorker` now stages that immutable observation and a durable
per-branch cursor in the same local collection. Staging is idempotent under a
canonical content digest, and an unfinished observation cannot be replaced. Each
tick claims one 30-second lease and evaluates one bounded journal batch. Progress
and completion updates require the same observation, revision and lease. If writes
commit before a crash or stop, the next owner replays them before saving progress.
Completed observations release their retained facts. Expired observations retain
an explicit discard reason without deleting pending episodes. Invalid records
back off for five minutes so another branch can continue; corrupt data is never
silently treated as an empty observation. The worker has no activation timer yet.

Before activation, implement and qualify:

- Connect desktop preparation to the durable observation worker after the
  acknowledged transport and retention rules below are implemented.
- Assigned-publisher transport with epoch fencing, durable server acknowledgement,
  publisher handover deduplication, event retention and safe local acknowledgement.
- Grouped recipient Inbox events, independent stock opt-in and quiet hours, live
  stock ACL and branch checks at materialization, read and push delivery.
- Current-state revalidation to suppress obsolete low episodes, activation-time
  rules, rate limits and generic private push messages.
- Mobile settings on the stock notification page, all 18 language packs and native
  notification/device testing.

This observes stored inventory. Receiving concurrency, synchronization convergence
and reconstructed inventory truth remain separate unresolved qualification work.
