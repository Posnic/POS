# Business approval alerts

Status: in progress; no alert route or delivery worker is enabled yet.

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

Real MongoDB tests cover separate settings, first-save races, revisions, opt-in
windows, invalid quiet hours, scope, self-approval, closed/expired requests and
discount limits. Remaining work: bounded durable event materialization, Inbox
version negotiation and ACL filtering, push delivery revalidation, settings and
navigation in the mobile app, localized copy and actual provider/device tests.
