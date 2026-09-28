# Business approval alerts

Status: in progress; preferences, event materialization and read/push eligibility
are tested. Settings routes, scheduled approval-worker wiring and mobile UI are
not enabled yet.

Approval alerts have a separate per-account/branch opt-in and quiet-hours setting.
Daily-summary preferences remain independent. Settings require current approval
and notification-management capabilities plus branch membership. Revision checks
prevent concurrent updates from silently replacing another device's changes.
Enabling or re-enabling starts a fresh eligibility window; changing quiet hours
while enabled preserves it.

The recipient predicate requires a currently pending, unexpired decision in the
same business and an authorized branch. The requester cannot receive their own
approval alert. The recipient's current remote-discount permission and limit must
cover the request. Callers must obtain a fresh active-user Business context before
using this predicate, both when creating an Inbox event and before sending push.
Alerts confer no decision authority; decisions retain server revalidation and
recent-authentication requirements.

The materializer leases at most five preferences and reads at most 25 pending
decisions per preference, with query and elapsed-time bounds. It reads only the
five-minute decision lifetime and the recipient's opt-in window. Events use a
unique account/request identity and are inserted before advancing a compound
cursor. Once a page sequence ends, the cursor resets to find late ledger writes.
Inbox events contain a request identifier, not financial details or approval
authority, and expire with the request.

`/inbox?approvals=1` opts into approval entries; older Inbox clients receive only
daily events. Reads batch-load at most 50 request/preference rows and recheck
current user scope, limits, opt-in and pending state before exposing an entry.
Mark-read also requires current approval eligibility. Pagination retains the
underlying cursor even when stale entries are filtered, so clients can continue.

Push queue materialization and every send/retry independently recheck current
session, approval permission, branch membership, discount limit, requester,
request state/expiry and separate opt-in. The queue expires with the approval
request. Quiet hours never postpone a request beyond its actionable lifetime;
such delivery is stopped. Provider payloads remain generic and include only an
opaque Inbox identifier, with no financial figures or decision action.

Real MongoDB tests cover bounded paging, late inserts, replay after a crash,
recipient revocation, separate settings, first-save races, revisions, opt-in
windows, invalid quiet hours, scope, self-approval, closed/expired requests and
discount limits. Additional tests cover negotiated Inbox visibility, mark-read,
closed requests, permission/limit changes before retries, independent opt-in and
quiet-hour expiry. Remaining work: scheduled worker wiring, settings and
navigation in the mobile app, localized copy and actual provider/device tests.

Notification-path review also found and corrected the missing `pushPending`
marker on actual daily Inbox writes. A real scheduler-to-push-queue test now
verifies that a scheduled unavailable-summary notice produces one delivery,
including repeated worker runs. Daily notifications and provider acceptance
remain distinct from verified delivery to a physical device.
