# Business close-triggered summaries

Status: source validation, desktop preparation and Community/Cloud publication implemented locally. No close-trigger setting or
delivery is enabled by this branch yet. Fixed-time daily summaries continue to
use their existing contract.

## Verified source

`RegisterRepository.registercloseUpdate` atomically changes a scoped
`cashregister` document from `Opened` to `Closed` and writes
`register_closedate`. It requires branch/license membership and the session
owner/device, with the existing manager override. The same update stores the
closing operator and available cash variance. A repeated close cannot change a
closed document through that path. Opening a new session creates a new document;
`register_id` names the physical register while `_id` identifies the session.

`cashregister` is already branch-scoped sync data in POS and Gateway and is in the
agent's critical push order. Register-close facts therefore have a durable
source without a notification network call in checkout. A cloud copy can still
be delayed or incomplete. Audit logs are supplementary, not the delivery source:
the close controller deliberately tolerates failure to record an audit entry.

There is no separate restaurant-wide operating-session close record in the
audited API. Closing one register does not prove that the restaurant closed.
The first supported trigger must explicitly say **After a register session
closes**, identify that register, and avoid a restaurant-wide closure claim.
Automatic branch closure inferred from an empty open-register query would be
unsafe when another till has not synced.

## Contract and delivery plan

- Preserve the session document ID, physical register ID/name, opening and closing
  instants, branch scope and source revision identity. A reopened or changed
  source invalidates queued delivery. Unknown or malformed close facts are not
  inferred from inactivity, the wall clock or an empty sale list.
- Wait ten minutes after the confirmed source close before attempting a digest.
  This is a synchronization grace period, not proof of completeness. Respect the
  branch timezone and configured quiet hours; bound late delivery so historical
  imports do not flood the owner.
- Keep a separate versioned schedule preference and negotiate its response shape.
  Existing daily clients must not receive unknown fields or accidentally reset a
  newer schedule. Settings belong on the branch notification page.
- Prepare financial data on the assigned desktop and read only bounded prepared
  results on the server. Existing version-2 summaries are branch/calendar-day
  totals; they are not register-session totals, particularly across midnight.
  Do not relabel them as session revenue. Session totals require reconciled sale
  and return attribution before publication; otherwise show an explicit
  unavailable summary.
- Bind event identity to recipient, schedule revision, branch, session and close
  revision. Persist Inbox before advancing the source cursor. Re-read the source
  close, current ACL and current preference at delivery; repeat eligibility for
  every push retry. Never send cash variance or sales amounts on the lock screen.
- Keep fixed-time delivery and close delivery as explicit modes. A combined
  fixed-time fallback remains a later single-rule design, not two independent
  alerts that can duplicate the same digest.

Required verification includes the actual close writer and normal sync path,
multiple registers, overnight sessions, reopen/change, delayed import,
concurrent workers, quiet hours/DST, permission removal, missing prepared data,
repeated delivery and native notification behavior. None of these source
findings alone establishes production delivery readiness.

The local `business-register-close` service validates exact session/register and
tenant/branch scope, Date-valued source bounds, current closed state and local
close date. A deterministic fingerprint changes with revised source bounds. Its
primary-key reader projects eight metadata fields with a 250 ms query limit and
requires current overview/notification-management capabilities. It reads no sale
arrays or cash variance. Three unit tests and two real-Mongo tests pass, including
the actual register open/close repository, refused wrong-device close, duplicate
close, another session on the same register, lost access and changed/deleted
source. Worker scheduling and mobile settings remain next.

## Session financial preparation checkpoint

The desktop-only preparer now scans the branch under the existing 100,000-document,
30-second and cooperative-yield budgets. It waits through the ten-minute grace,
reads only projected financial fields, checks the source close again before
returning and produces explicitly incomplete-source session metrics. Explicit
versioned jobs can prepare and publish these results; automatic scheduling is
still pending. Cloud execution is rejected before source reads.

Invoices use their stored `cashregister_id`. The scan includes other sessions
because a refund may refer to an older invoice. Returns need their own verified
`returnArray.cashregister_id`; the refund writer now supplies it when the till sends a verified active session.
Missing attribution within the session period fails with
`return_register_unavailable`, not zero refunds. Invoices without register scope,
uncertain settlement timing or changes after close also fail rather than claim a
historical amount. The refund writer binds the supplied return scope to the
current authorized register session before storing it.

Four financial unit tests and three real-Mongo close/preparation tests pass.
The actual refund-writer tests below additionally verify persisted attribution.
Immutable financial history, scheduling and mobile delivery remain required.
Existing source completeness remains unproven.

## Verified refund-session attribution

The till refund payload now includes its current register-session selection. The
controller derives the device identity using the existing device resolver and
passes it outside the request payload. Before persisting a return, the repository
checks the supplied session by primary key against invoice tenant/branch, current
actor, device, open state and opening time. Only the verified ID is stored on both
the return fact and refund transaction, in the same sale update. A failed check
returns 409 and releases the refund lease without appending financial records.
An omitted session remains valid for older clients and register-disabled shops;
no session is invented for those refunds.

Four real-Mongo refund tests pass, including the actual writer feeding session
metrics for an older invoice, wrong device/owner/branch, closed session, no partial
refund records on rejection, and legacy compatibility. The related controller,
service and repository suites pass all 337 tests. Targeted formatting and lint
pass with existing legacy warnings. Immutable close history,
scheduling and mobile close delivery are still incomplete.

## Assigned desktop and Community publication

The desktop worker accepts explicit `register-session` jobs only with version 1,
a valid session ID, close fingerprint and calendar date. Unknown job kinds and
malformed contracts fail before source scans. The prepared result must match the
requested close, and staging is conditional on both the publisher assignment and
the unchanged close fingerprint. The runtime advertises `registerSummaryVersion: 1`;
its matching `registerSummaryExpiresAt` binds the capability to that heartbeat.
The companion Cloud agent and Gateway negotiate and carry the same contract.

Community mode can enqueue these requests and publish through the existing
reserved-sequence recovery path. Session keys use `branch:session:sessionId` in
`business_prepared_summaries`, separate from daily keys. Before completing a
reserved session write, publication rechecks the source close and branch settings
with bounded primary-key reads. A changed, missing or reopened close discards the
reservation and records `close_changed`. Source reads during later delivery must
still revalidate it; this is not proof of immutable financial history.

Five real-Mongo publication tests cover actual session preparation, malformed or
future contracts, source/job revision changes, interrupted publication, separate
sessions on one till, daily-key preservation and reopened-source recovery. The
nine existing summary/worker tests, three source/preparation tests and two actual
agent/Gateway item-sync tests also pass. No notification schedule or mobile close
screen is enabled by this change. Request scheduling,
strict read contracts, immutable financial-history assurance and delivery remain
required.

## Cloud publication verification

The companion Gateway validates the exact bounded session contract, close hash,
currency/timezone, grace period, timestamp and reconciled minor-unit totals. It
checks the synced close by primary key before publication and recovery; it does
not read sales. Discarded reserved sequences cannot later be acknowledged as
successful. The agent keeps session envelopes durable across lost responses and
binds staging/cleanup to the current requested close fingerprint. A downgraded
worker's stale capability or daily result cannot masquerade as session support.

Nineteen Gateway/agent real-Mongo tests and three cross-repository tests pass.
The latter include actual desktop session preparation through the agent and
Gateway, lost acknowledgement recovery, and rejecting a reopened Cloud close
without accessing Cloud sales. These transport checks do not establish source
completeness, immutable financial history or notification delivery readiness.
