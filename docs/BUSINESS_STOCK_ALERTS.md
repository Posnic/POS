# Business stock alerts: desktop observation and journal

This is the source-state foundation for low-stock notifications. It is not wired
into the scheduled reporting worker or a delivery channel yet. Android preview 4 includes stock-alert preference controls, but does not
activate stock-alert delivery. Enabling a producer before durable publication and
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
backpressure instead of silently discarding alerts. Local acknowledgement and
resumable cleanup are implemented by the handoff below.

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

`createStockAlertHandoff` selects at most 50 pending item episodes through a
partial index and persists the exact scoped batch before invoking its injected
transport. Retries, including after process recreation, send the same batch ID and
content. The transport has a 20-second deadline. A strict receipt must match the
batch ID and canonical digest and explicitly confirm acceptance; a receipt means
durable server acceptance, not delivery to a person. The receipt is saved before
local cleanup. Cleanup removes only the accepted episodes, advances journal
revisions for concurrent-writer safety, and persists its position within a
three-second budget. Restart after partial cleanup uses the saved receipt without
resending. Lease-fenced completion cannot clear a successor's batch. Failed sends
back off for a minute. Old episodes are retained until accepted; the receiver must
record expiry/suppression decisions rather than asking the sender to invent a
successful delivery.

The handoff is tested both with a durable test receiver and against the actual
Gateway receiver implementation. The cross-repository test prepares a real desktop
observation, journals it, accepts it through Gateway, loses the acknowledgement,
and retries without duplicating the server batch. This runs in-process against
Mongo; it is not a deployed HTTPS or production sync-agent qualification.

Gateway now exposes `POST /v1/business/reporting/stock-alerts` behind
`POSNIC_BUSINESS_STOCK_ALERTS=1`, disabled by default. The existing device auth and
fresh directory checks enforce revocation, tenant suspension and server instance.
The receiver additionally validates branch scope, assigned desktop, assignment ID
and epoch. It reserves a batch in the publisher record, writes its private queue
record, then acknowledges. Reservation recovery and canonical digests preserve
idempotency across lost database/network acknowledgements. Expired events retain
explicit expiry markers. This endpoint creates no Inbox event or push. Queued
batches retain publisher identity; a notification consumer must reject obsolete
publisher generations. Cross-publisher episode deduplication remains unfinished.

The sender's `send` adapter must use the assigned-publisher authenticated transport.
Neither the receipt shape nor content digest is authentication. Deployment qualification and producer activation are still outstanding. Queue
retention and consumer rate limits must be settled before activation.

`createStockAlertAgentTransport` now connects the local handoff to the sync-agent
mailbox without copying credentials. Before queueing a new batch, it requires a
live Cloud stock reporting job and freezes its assignment/epoch. It returns only a
validated durable receipt; a queued request remains unacknowledged. The agent
checks the current desktop stock-alert heartbeat, uploads the frozen envelope
through its existing authenticated connection, and saves the receipt for desktop
cleanup. Cleanup clears the completed batch's transport fields so a subsequent
batch can bind to the then-current reporting job. Capability withdrawal during
assignment lookup prevents upload. No production heartbeat advertises this new
capability yet; activation awaits the remaining delivery controls.

`createCommunityStockAlertTransport` supplies the corresponding local-server
path. It resolves the private Community installation identity, requires a live
Community stock reporting job, freezes its assignment/epoch, and accepts only an
already staged matching handoff. It cannot switch a Cloud handoff into Community
mode. `receiveCommunityStockAlerts` is an internal desktop/Community-only adapter,
not an HTTP route accepting caller-supplied installation identities. It uses the
same publisher reservation, private queue, canonical receipt and expiry semantics
as Gateway. Lost database acknowledgements retain local episodes until retry
confirms one durable batch. Reassignment cannot relabel that pending batch. Both
Community reporting and the stock-alert feature flag must be enabled; neither
transport activates the producer or sends an Inbox notification itself.

## Recipient preferences

`GET` and `POST /api/business/v1/notifications/stock/:branchId` now manage a
separate per-account stock-alert opt-in. Both require a dedicated Business session,
HTTPS, current branch membership, `stock.read` and `notifications.self.manage`.
Financial access is not required. The rollout flag must be enabled. Discovery advertises only the preference
contract when `stockAlertPreferences=1` is explicitly requested; it does not claim
that recipient delivery is complete. Responses are private and no-store.

New preferences default to disabled, a 60-minute minimum notification interval,
and quiet hours disabled (22:00-07:00 values ready for opt-in). Supported minimum
intervals are 15, 30, 60 and 180 minutes. Quiet hours use the branch's authoritative
timezone. Writes accept exactly `enabled`, `minimumIntervalMinutes`, `quiet` and
`expectedRevision`. Revision compare-and-swap rejects stale or concurrent saves.
Edits preserve the activation marker; re-enabling generates a new marker and start
time. Every change invalidates old worker leases, and disabling removes scheduled
scan eligibility. Preferences are excluded from generic sync. Corrupt stored
settings fail unavailable rather than resetting revision or opt-in silently.

The notification worker must still consume these preferences, enforce cadence and
quiet hours at delivery, and handle initial currently-low inventory without replaying
an old activation's notifications. No recipient Inbox event or push is generated by
saving preferences alone. Android preview 4 includes the dedicated mobile controls,
branch-aware navigation, conflict handling and eighteen draft language packs.

## Current observation transfer for notification revalidation

The episode queue alone cannot prove that a previously low item remains low.
The private snapshot contract now divides a complete verified desktop observation
into at most 100 pages of 100 facts. Each page retains the same summary and full
observation digest. Final assembly validates every page, canonical digest,
coverage, global item order and the public low-list agreement. Healthy facts and
low items beyond the public 100-row list are included. This transfers bounded
prepared facts; it does not scan cloud inventory or reconstruct sales balances.

`receiveCommunityStockSnapshot` is an internal Community receiver behind the
existing local-reporting and stock-alert flags. Its identity must come from the
private installation adapter, never a caller-controlled HTTP body. It reserves
one candidate on the assigned publisher, stores immutable private pages and
publishes a reference only after validating the complete set. Assignment/epoch
fencing prevents a former publisher from committing. Retries survive a lost page
or final-publication acknowledgement. Conflicting pages cannot overwrite stored
content. A newer candidate makes the previous snapshot unavailable while transfer
is incomplete. Expired candidates can be replaced; completed observations cannot
be regressed or replaced by different content at the same timestamp.

`readCommunityStockSnapshotFact` reads one indexed page and checks the current
publisher again afterward. A fact is eligible for revalidation for less than five
minutes after desktop preparation; quiet-hour delivery must obtain a fresh
observation. Partial transfers, handovers, expired or corrupt pages are unavailable.
An item absent from the verified set is unknown, never healthy or restocked. The
response retains the observation interval and `sourceComplete: false`. This
private worker lookup is not a user endpoint; the recipient caller must enforce
live ACL, branch membership and opt-in separately. It is not yet used to send alerts.

Transfer pages have a one-hour TTL, are indexed by immutable transfer key and are
excluded from generic device sync. Incomplete receipt processing counts at most
101 indexed pages without reading all retained facts; full bounded assembly occurs
only when all expected pages are present. Freshness is enforced independently of
TTL cleanup. The shared observation validator remains used by the desktop journal.

Validation: ten new Mongo integration cases plus the existing 42 stock
journal/publication cases pass. Tests cover actual desktop preparation, over-100
low items, healthy/unknown replacement, partial and expired snapshots, retries,
publisher changes before and during publication/read, corrupt data, tenant scope,
empty observations and the 10,000-fact/100-page protocol boundary. The maximum-size
case verifies the wire contract, not deployment throughput or physical-device behavior.

The snapshot sender, Gateway/agent transport, recipient baseline/deduplication,
Inbox/push revalidation and production activation remain unfinished. No timer,
public API route or deployment is enabled by this checkpoint.

Before activation, implement and qualify:

- Connect desktop preparation to the durable observation worker after the
  acknowledged transport and retention rules below are implemented.
- Assigned-publisher transport with epoch fencing, durable server acknowledgement,
  publisher handover deduplication, event retention and real transport integration.
- Grouped recipient Inbox events, enforcement of stock opt-in and quiet hours, live
  stock ACL and branch checks at materialization, read and push delivery.
- Current-state revalidation to suppress obsolete low episodes, activation-time
  rules, rate limits and generic private push messages.
- Qualified review of the mobile stock settings and eighteen language packs, plus
  native notification/device testing.

This observes stored inventory. Receiving concurrency, synchronization convergence
and reconstructed inventory truth remain separate unresolved qualification work.

Cloud receiver checkpoint: Gateway now accepts the same snapshot page contract
through its authenticated reporting route, with fresh directory revocation,
suspension, provisioning and instance checks. The cross-repository test prepares
an actual desktop observation and verifies identical Community/Gateway receipts
and committed state, including healthy facts and low items beyond 100. All eleven
snapshot tests pass; the 42 prior stock pipeline tests passed at the preceding
checkpoint. Gateway's five new receiver/route cases and 33 existing reporting
cases also pass. This remains in-process evidence; snapshot mailbox/sync-agent
transport, Cloud recipient lookup and notification delivery are not connected.

## Durable snapshot sender

`createStockSnapshotSender` now stages the immutable observation with the current
live stock reporting job's publisher mode, assignment and epoch. It keeps one
observation per branch in the existing sync-excluded local stock-alert collection.
A live unfinished observation cannot be replaced; an expired one records an
explicit discard. A completed observation releases its facts and retains the final
receipt and identity. Corrupt local content cannot be silently reused or replaced.

Each tick claims a 30-second lease and sends at most ten pages within a 20-second
operation budget. Every page receipt must match its schema, snapshot ID, index and
canonical digest; the final page requires confirmed complete assembly. The saved
cursor advances only while the same lease and snapshot remain current. A crash or
lost response retries the identical page against the original assignment. Stop or
lease loss cannot advance the cursor on a late response. Transport errors retain
the observation and back off ten seconds. Stale snapshots are explicitly discarded,
not described as delivered.

`createCommunityStockSnapshotTransport` resolves the private installation identity
and calls the internal Community receiver without Cloud credentials. Community
mode and local reporting must be enabled. The sender is dependency-injected and
has no timer: its Cloud mailbox adapter and production scheduling are not connected.
No production heartbeat or rollout flag is enabled.

Seventeen snapshot integration cases pass, including six sender cases covering
lost acknowledgements, a 1,003-fact transfer across a ten-page tick boundary,
invalid final receipts, frozen assignment, expiry, absent live jobs, stop/lease
loss and corrupted staged facts. Existing cross-repository receipt equivalence
remains covered. Lint and formatting pass. Recipient notification delivery remains
unfinished.

Cloud snapshot mailbox checkpoint: the desktop now queues its staged observation
for the credential-owning sync agent and consumes exact durable page receipts.
Agent upload progress is independent of desktop receipt consumption, with strict
snapshot identity, assignment binding and lease-fenced updates. Completion and
successor staging clear obsolete transport state. The agent uses the existing
reporting tick and a current, explicitly advertised snapshot capability; production
heartbeats do not advertise it yet.

Twenty-two snapshot integration tests pass, including the actual desktop mailbox,
agent and Gateway under lost acknowledgement, capability withdrawal, malformed
receipt, lease replacement and publisher replacement. The ordinary reporting tick
continues work discovery after the snapshot lane. Gateway's 38 reporting/receiver
tests also pass. Cloud recipient snapshot lookup, baseline/deduplication, live ACL,
quiet hours and notification delivery remain unfinished. No production activation
or packaged/HTTPS deployment qualification is implied by these in-process tests.

## Live recipient selection and shared snapshot reads

Cloud and Community notification workers now share `readStockSnapshotPage` and
`readStockSnapshotFact`. These private readers validate the prepared summary,
publisher identity, page index/ranges and digest, load at most one retained fact
page, and recheck the publisher/snapshot afterward. They do not scan inventory.
Corrupt indexes, a newer pending transfer, stale facts or a changed publisher are
unavailable. Pagination requires the original snapshot ID after page zero so a
worker cannot combine different observations. The Community compatibility wrapper
retains its desktop/local-reporting boundary.

`readRecipientStockPage` reloads the actual user and current Business context,
then validates the branch-scoped stock preference. It requires stock access and
notification self-management, explicit branch membership, an active account and
opt-in. Financial access is not required. Minimum intervals and quiet hours use
the current branch timezone and defer before loading stock pages. A malformed or
future notification timestamp is unavailable rather than silently bypassing cadence.
The activation marker and preference revision bind the cursor. A new activation
requires an observation that started after opt-in; old observations are not replayed.
After the page read, user access and preferences are checked again and changed
scope/settings discard the candidate. Source completeness remains explicitly false.

This is read-only candidate selection, not an Inbox write or push authority. The
materializer and delivery consumer must repeat live checks at their respective
boundaries, persist deduplication/activation state and enforce notification cadence
atomically. Those components remain unfinished; no timer or delivery is enabled.

Validation: 28 snapshot tests plus six stock-preference tests pass. New cases
cover server-side reads without desktop mode, stock-only permissions, user/branch/
tenant revocation, activation-bound paging, observation replacement, pre-opt-in
suppression, cadence/quiet-hour deferral, changes during reads and corrupted state.
Lint, formatting, 24 README/sync-classification checks and attribution pass.

## Recipient episode deduplication

`journalRecipientStockPage` stores one classification record per tenant, account,
branch and item in private `business_stock_recipient_state`, excluded from generic
sync. Its pending candidate identity binds that scope, the current opt-in activation
and a recipient episode counter, independently of the reporting desktop. The
initial verified-low baseline creates candidates beyond the public 100-row list.
Repeated low observations, replay and publisher handover cannot create another
episode. Only an explicit verified healthy observation re-arms the item; unknown,
excluded or missing facts do nothing. Healthy observations suppress an undelivered
candidate with an explicit reason. A new activation supersedes the old identity.

Observation uses the live recipient ACL/opt-in gate while allowing classification
updates during quiet hours and minimum-interval deferral. This avoids missing a
healthy transition merely because notification delivery is currently deferred.
The ordinary delivery gate still enforces both controls. Journal candidates are
not Inbox entries or push authority, and no delivery control is bypassed.

Writes use per-item revision compare-and-swap and at most eight contention retries.
Each call visits at most 100 facts within a three-second budget; a snapshot-bound
page/item cursor resumes partial progress. Lost write acknowledgement replays the
same candidate identity. Newer preference revisions/activations cannot be replaced
by older work. Preferences are checked before each item, and any concurrent edit
can leave only an old tagged candidate that must fail the materializer's later
live checks. Corrupt persisted state fails rather than silently resetting deduplication.
Acknowledged candidates remain absent while the same item stays low.

Validation: 34 snapshot tests plus six preference tests pass, with six new cases
for full baseline/paging, concurrent replay, quiet-hour healthy/unknown transitions,
publisher handover, lost writes, new activation, corruption and acknowledged-state
replay. Lint, formatting, attribution and sync classification pass.

The durable scan scheduler, grouped Inbox materializer, delivery-time stock/ACL
revalidation, acknowledgement/audit retention and cleanup remain unfinished. No TTL
is applied to active recipient classification: expiring it blindly could repeat
an already acknowledged low episode. Activation-aware cleanup and stale pending
candidate expiry must be implemented before rollout. This checkpoint starts no
producer, recipient timer or notification delivery.

## Durable recipient scan scheduling

`createStockRecipientWorker` now claims a recipient preference with a 30-second
lease and saves its snapshot/page/item continuation after journal writes. Each
tick handles at most ten pages under a three-second elapsed budget, passed down
to the journal. Partial progress resumes promptly; a completed scan records its
snapshot and schedules another observation check after one minute. Restart after
journal writes but before cursor persistence replays the same identities safely.

Preference revision, activation, enabled state and lease identity fence progress.
Stop, lease replacement or a settings edit cannot save a late cursor. A superseded
or unavailable snapshot clears the obsolete continuation and retries after fifteen
seconds. Access denial backs off five minutes without silently changing the user's
opt-in; errors retain diagnostic state and back off one minute. Normal delivery
quiet-hour and cadence checks remain separate from observation scheduling.

The worker exposes a tick/stop interface but is not attached to a production timer
until the complete notification pipeline is qualified. It creates no Inbox entries
or pushes. Four new scheduling integration cases cover restart, crash replay,
lease/settings/stop races and snapshot replacement. All 38 snapshot plus six
preference tests pass, along with lint and formatting. Grouped materialization,
delivery-time revalidation, retention and runtime/deployment activation remain open.

## Grouped private Inbox materialization

`materializeStockAlert` now requires a completed recipient scan of the current
fresh snapshot. It rechecks live scope, opt-in, quiet hours and cadence, reserves
an immutable group on the preference, and claims the current verified-low pending
identities. A monotonic group sequence prevents older claims from replacing a
newer group. Work is bounded to the 10,000-fact source limit and indexed private
recipient state; it never scans stock transactions or sales.

One `stock_low` Inbox record contains all new candidate counts, the total verified
low count, explicit partial coverage/observation time and up to twenty item details.
It is not one notification per twenty items. The candidate rows and content are
validated before insertion. Exact event keys and content digests make lost insert
acknowledgements replayable. The event remains `materializationPending` until fresh
recipient/snapshot checks and a preference revision/activation/lease-fenced commit.
Cadence starts at commit time, not the earlier reservation time.

Committed recovery acknowledges only rows still carrying that group's identity,
so an intervening healthy/low transition keeps its newer episode. Candidate cleanup
increments row revisions to make racing journal writers retry. Cancellation records
its intent before releasing claims and deleting an uncommitted private event; a
changed snapshot cannot be combined into the original group. Settings edits clear
the delivery lease, preventing a late commit under the old revision. Inbox records
use the existing thirty-day TTL; active classification retention remains separate.

These entries are deliberately not exposed by the current Inbox query and have
`pushPending: false`. Stock-specific mobile/API negotiation, authenticated history
visibility, delivery-time current-stock validation and private push payloads remain
unfinished. No scheduler or feature flag is activated. Six new integration cases
cover a 103-item single group, lost insert acknowledgement, interrupted committed
cleanup, a later episode, snapshot cancellation, settings changes and access
revocation during insertion. All 44 snapshot plus six preference tests pass, with
lint, formatting, attribution and sync-classification checks.

## Authenticated stock Inbox history

Clients explicitly request `GET /api/business/v1/discovery?stockAlerts=1` and
require `stockAlerts: "inbox-stock-v1"` before adding `stockAlerts=1` to Inbox
requests. The capability is advertised only while the stock-alert feature flag
is enabled. Older clients keep their existing response kinds. Stock negotiation
limits the raw Inbox page to ten entries; clients must follow `next` even when
live visibility checks leave a page empty.

`stock_low` entries require stock access independently of financial access.
Daily/register entries still require financial access; approval entries require
approval access. Every stock list/read acknowledgement checks the current user,
branch membership, stock ACL, opt-in and activation. Uncommitted, expired,
out-of-scope or corrupt payloads are hidden. Unknown notification kinds cannot
be marked read. The authenticated route retains HTTPS and no-store behavior.

The public entry has the ordinary ID, branch, created time, business date and
read status, `summary: null`, and `stock` with schema version 1, snapshot ID,
observation interval, `sourceComplete: false`, coverage, total/new low counts,
at most twenty ordered verified-low item facts and an explicit truncation flag.
Internal activation, digest, lease and materialization fields are not returned.
Counts, coverage, timestamps, item facts and the canonical digest are validated
before exposure. The business date uses the entry creation time in the current
branch timezone.

These are historical observations. They remain readable during quiet hours,
minimum-interval deferral and after a subsequent stock change, with their original
observation timestamps. This read path never claims the items are still low or
authorizes a push. Disabling and re-enabling invalidates the former activation's
history. Delivery-time stock revalidation, mobile negotiation/rendering, push,
retention cleanup and production scheduling remain open. Stock entries still
have `pushPending: false`; this change activates no timer or deployment.

Validation: 150 integration tests passed across authentication/HTTP, daily and
approval notifications, source stock, publication, journal, preferences and full
snapshot delivery. Five stock-contract unit tests, ESLint, Prettier and attribution
checks passed. The broad parallel run encountered a MongoDB startup fassert;
the complete integration set passed with file concurrency set to one. Generated
API documentation was refreshed. No CI runs or deployments were triggered.

## Current-stock push eligibility

`stockPushScope` now checks the persisted, committed Inbox event under live stock
ACL, branch membership and opt-in activation. Read entries and events at least one
hour old are suppressed. Quiet hours are checked both before and after validation.
The event's own `lastNotifiedAt` does not defer it behind its own cadence interval;
that interval was already enforced when the Inbox event was committed.

Each call examines one current snapshot page (at most 100 facts), using the
recipient journal to identify members of the original group. It checks both
committed cleanup-in-progress membership and acknowledged membership, and excludes
a later pending low episode. This is not limited to the twenty visible item details.
If no qualifying member exists on a page, an event/activation/preference-revision/
snapshot-bound cursor continues to the next page. A current verified-low member
provides eligibility evidence. Healthy or missing/unknown facts never do.

Publisher identity, snapshot freshness and scope are rechecked after membership
lookup. The event must still be unread and committed, and the candidate's revision
must still match. Changed settings, group membership or publishers cannot authorize
a stale result. A scope/activation/item index bounds membership lookup; no stock
transaction or sale scan is performed. The generic push payload must not include
these private item facts or stock quantities.

Validation: all 57 snapshot and six preference integration tests pass. Eight new
cases cover stock-only scope/own cadence, a qualifying 103rd item beyond the sample,
healthy/unknown suppression, bound cursors and stale source, read/expired/revoked
entries, later low episodes, concurrent publisher/ACL/settings/membership changes,
and crossing a quiet-hour boundary. ESLint, formatting and attribution pass.

This is a validator, not an active push consumer. Durable continuation/retry wiring,
provider handoff revalidation, retention cleanup and production scheduling remain
unfinished. `pushPending` remains false on stock events, and no provider or runtime
feature flag is activated. Validation evidence must never be reused as permanent
permission to send after a delay.

## Durable stock push consumer

The existing push worker now supports explicitly queued `stock_low` events.
Fanout requires the committed historical Inbox scope under stock ACL, independently
of financial access. Per-device deliveries keep their existing immutable event/
device identity and live dedicated session binding. No stock values are copied
into provider messages: the transport still receives only device token, event ID
and device language.

Delivery validation processes at most ten current-stock pages per pass, yielding
after three seconds between pages. Each continuation is persisted under the live
lease before another page starts, so a lost checkpoint acknowledgement can resume
on retry. Pending pages do not consume provider retry attempts. Changed or stale
snapshots clear the obsolete cursor and wait fifteen seconds; quiet hours defer
to their boundary. Disabled, read, expired, revoked or no-longer-low groups stop.
The original one-hour delivery age limit still bounds retries.

Device registration/session and current stock are checked again before provider
handoff. Lease identity and expiry fence all delivery/receipt progress writes;
a send requires over eleven seconds remaining on the thirty-second lease to
cover the transport's ten-second timeout. A replaced lease cannot send or overwrite
its successor. Provider acceptance and provider receipt remain separate states.
Network ambiguity after provider acceptance still follows the existing retry and
collapse-ID behavior; this is not an exactly-once display guarantee.

This consumer is tested with synthetic transport and explicitly enqueued events.
Stock materialization still leaves `pushPending: false`; runtime stock scheduling,
retention cleanup, real provider/relay qualification and production feature
activation remain unfinished. No production credential, timer, flag or deployment
was changed. The published Android preview is unchanged.

Validation: 84 integration tests pass (64 snapshot/stock pipeline, fourteen push
and six preference cases), along with ESLint, Prettier and attribution. Seven new
worker cases cover generic payload/receipt state, durable paging, superseded source,
lease/device revocation, lost cursor acknowledgement, opt-out before provider retry,
and a publisher change after the final device lookup. Existing daily, approval and
register-close push regressions pass with the stronger live-lease write checks.

## Combined recipient scheduling

`createStockNotificationWorker` composes one bounded recipient scan and one due
Inbox materialization per tick. It starts no timer and does not call the push
provider. Scanning and materialization retain independent persisted progress and
leases, so a failed scan does not starve recovery of an already committed group.
Materialization stores its next eligible time and last state on the preference.
Quiet/cadence deferrals retain their retry time; unavailable/changed work retries
in fifteen seconds, denied work in five minutes, and completed/empty work in one
minute. Errors back off one minute. A replacement worker resumes from stored state.

Settings edits invalidate scheduling leases and old deferrals. Disabled recipients
remain selectable only for finishing an already committed group's cleanup; this
does not create a new notification. Revision, activation and lease identity fence
schedule updates. Shutdown aborts the scanner and signals materialization before
Inbox insertion and before commit. An interrupted uncommitted group remains
recoverable, and committed cleanup may finish its already-authorized bounded writes.
A failed final lease release cannot leave the process permanently marked running.

Validation: 71 snapshot/pipeline and six preference integration tests pass, with
seven new coordinator cases for recreation/cadence, scan errors, stop during
insertion, successor leases, cleanup after opt-out, settings edits and database
release failure. ESLint, formatting and attribution pass. Production timer wiring,
retention cleanup and real provider/relay validation remain unfinished. Stock
entries still leave materialization with `pushPending: false`; no feature flag,
production runtime or published Android artifact was changed.

## Obsolete activation cleanup

`drainStockRecipientCleanup` now claims one preference and removes up to one
hundred recipient-state records from older opt-in activations per pass, yielding
after a three-second budget between records. It retains every record of the current
activation regardless of age, including already acknowledged low episodes. Those
records cannot receive an unconditional TTL without causing repeat alerts while
stock remains low. The combined callable worker runs one cleanup pass between
scanning and materialization; cleanup errors have separate backoff and do not
starve notification work.

Every delete is scoped to license, account and branch and matched to the observed
record's activation and revision. A concurrent scan that replaces the record with
current state defeats the delete. Preference revision/activation and a live cleanup
lease are checked before each delete; lease replacement stops the old worker and
preserves its successor's schedule. Partial work resumes promptly by selecting
remaining obsolete rows. Completion schedules another sweep after a day, errors
back off one minute, and preference edits invalidate old leases and deferrals.
Cancellation and a lost delete acknowledgement safely resume from retained rows.
Malformed obsolete activation metadata can be removed without resetting active
classification.

This cleanup does not remove current-activation records merely because access is
revoked or a preference is disabled. Account/tenant erasure, orphaned preferences,
stale pending-candidate expiry and current disabled-activation retention still need
explicit policies and qualification. Existing snapshot, Inbox and push delivery
TTL boundaries remain separate. Production scheduling and push activation remain
inactive; this change starts no timer or deployment.

Validation: 77 snapshot/pipeline plus six preference integration tests pass, as
do ESLint, formatting and attribution. Six new cleanup cases exercise preservation
across age, bounded obsolete removal, tenant isolation, concurrent replacement,
lease replacement, cancellation/lost acknowledgements and malformed old metadata.
The Inbox pagination fixture now explicitly orders its IDs instead of assuming
same-second client and server ObjectIds share chronological order.

## Notification runtime integration

The existing fifteen-second notification loop now visits the combined stock
worker before push delivery when `POSNIC_BUSINESS_STOCK_ALERTS=1`. It caches one
worker per active tenant database, deduplicates host aliases, and stops cached
workers when a tenant disappears, is suspended, the flag is disabled or the
notification runtime shuts down. Stock errors do not suppress other channels.
This integration adds no timer, workflow or deployment configuration.

A committed Inbox transition now sets `materializationPending: false` and
`pushPending: true` together. The transition is conditional on still being pending;
recovery after interrupted journal cleanup cannot requeue a push already consumed
by the delivery worker. This supersedes earlier checkpoints describing stock
entries as always push-ineligible. Actual provider delivery still requires the
existing push configuration and current recipient/device/stock checks.

Validation: 99 integration tests pass (79 snapshot/pipeline, six preferences,
fourteen push), plus six notification-runtime unit tests. The runtime integration
test starts from a published snapshot and registered dedicated device session,
then scans, commits and sends a generic event through the real push consumer using
a synthetic provider. A separate interrupted-cleanup case verifies one delivery
and no requeue after recovery. Lint, formatting and attribution checks pass.
These tests do not qualify a real provider, deploy servers, advertise producer
capabilities, enable feature flags or change the published Android APK.
