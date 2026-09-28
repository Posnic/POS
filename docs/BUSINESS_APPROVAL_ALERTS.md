# Business approval alerts

Status: in progress; preference and event-materialization primitives are tested,
but no alert route or scheduled approval worker is enabled yet.

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
authority, and expire with the request. Live read/push revalidation remains
required before this worker can be enabled.

Real MongoDB tests cover bounded paging, late inserts, replay after a crash,
recipient revocation, separate settings, first-save races, revisions, opt-in
windows, invalid quiet hours, scope, self-approval, closed/expired requests and
discount limits. Remaining work: Inbox version negotiation and ACL filtering,
push delivery revalidation, scheduled worker wiring, settings and
navigation in the mobile app, localized copy and actual provider/device tests.

Notification-path review also found and corrected the missing `pushPending`
marker on actual daily Inbox writes. A real scheduler-to-push-queue test now
verifies that a scheduled unavailable-summary notice produces one delivery,
including repeated worker runs. Daily notifications and provider acceptance
remain distinct from verified delivery to a physical device.
