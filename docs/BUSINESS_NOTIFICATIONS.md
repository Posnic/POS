# Business notifications

The first delivery channel is the private Business Inbox. Enabling a daily summary
does not grant phone push permission or register an APNs/FCM device. Phone push
requires separate device opt-in and provider configuration. Session-close
triggers, stock alerts and approval requests remain separate work.

## Delivery and scope

Each account configures each accessible branch at
`/api/business/v1/notifications/preferences/:branchId`. GET returns the current
revision; POST requires that revision with `enabled`, `time`, `quiet` and `locale`.
Conflicting edits return 409. Financial summaries require both `overview.read`
and `notifications.self.manage`; the server resolves current account status and
explicit branch membership again when delivering. Clients cannot nominate a
recipient or another account. Defaults are disabled, at 23:00 branch time.

The API, tenant shard and opted-in Community reporting desktop run the scheduler
without a phone connection. Shards deduplicate hostname aliases, skip suspended
tenants, and advance a bounded fair cursor. Indexed queries select small batches;
workers do not scan sales. Ten minutes before delivery, the scheduler requests
prepared data through the existing desktop reporting protocol, at most once per
five minutes per preference. Offline desktops produce an unavailable notice,
never an invented zero. Available totals retain their partial/delayed status.

Branch timezone governs daily and quiet-hour times. Quiet hours defer delivery;
spring-forward gaps shift with the timezone gap and repeated-hour schedules run
once for the logical day. Jobs more than 24 hours late are skipped to avoid a
catch-up flood. A timezone change schedules a new future occurrence.

Atomic leases prevent concurrent schedulers claiming one job. A unique
account/branch/day event key makes insertion safe if the process crashes before
advancing the schedule. Temporary failures retain the preference and retry.
Account or branch access removal disables delivery. Inbox reads always recheck
the current authenticated scope, even for entries created before removal.

GET `/api/business/v1/inbox` returns up to 50 entries with an opaque ObjectId
cursor. POST `/api/business/v1/inbox/:id/read` marks only the caller's scoped
entry. Entries expire after 90 days; reads enforce expiry without waiting for
MongoDB's TTL sweep. Preferences and Inbox collections are local to the
authorizing server and excluded from generic device synchronization.

## Validation

Run the Business access and notification integration suites against a disposable
MongoDB database, plus the notification time/worker Jest suites. They exercise
scope removal, conflicting settings, concurrent workers, crash checkpoint replay,
quiet hours, daylight-saving changes, missing prepared data, bounded shard
rotation, overlapping ticks and desktop preparation without an open app.

## Optional phone delivery

`/api/business/v1/notifications/device` exposes session-scoped status,
registration and opt-out. Configure `POSNIC_BUSINESS_PUSH_ENABLED=1`,
`POSNIC_BUSINESS_EXPO_PROJECT_ID` and secret `POSNIC_BUSINESS_EXPO_ACCESS_TOKEN`
only on a deployment that owns that project. Enable enhanced push security in
Expo. Do not distribute Posnic's project credential to Community operators; the
official Community app still needs a separate scoped relay.

The Inbox insertion also records pending phone work. A durable event/device
record survives worker interruption. Every send rechecks the device session,
password generation, account, branch, financial ACL and enabled schedule.
Quiet-hour rules apply to retries. Old alerts expire rather than creating a
catch-up flood. Provider registration tokens are private, excluded from sync and
never returned by the status endpoint. Opt-out removes the current session's
registration. Leases and unique event/device identities bound concurrency;
collapse/tag identifiers reduce duplicate visible alerts after an ambiguous send.

Provider tickets are checked later for receipts. `provider_accepted` means the
platform accepted the message, not that the phone displayed it or a person read
it. Invalid-device receipts remove only the matching registration generation.
No business amounts or credentials enter the payload. Local tests use a fake
provider; actual APNs/FCM delivery and device behavior remain unverified.

Recipient language is a device preference. A client requests
`GET /api/business/v1/notifications/device?language=1` to negotiate the optional
`supportedLanguages` and `locale` fields. Requests without this query retain the
original response shape for strict older clients. Older servers ignore the query
and return their original response; clients then omit `locale` from registration.
New registrations may include one of the 18 supported language codes. Invalid
codes are rejected, and omission on renewal preserves the same device's stored
preference. No account or branch identity can be supplied by this setting.

The worker reads the current device language immediately before each send,
including retries, while preserving all session, branch, ACL and schedule checks.
Each language has fixed generic lock-screen wording; business names, figures and
decisions remain inside the authenticated Inbox. Missing or unsupported stored
languages fall back to English. Translation review and signed-device delivery
qualification remain release requirements.

## Negotiated Android notification channels

Clients request `GET /notifications/device?language=1&channels=2`. Only that
negotiation adds `channelVersion: 2` to the status response; legacy responses keep
their shape. A supporting client creates its native channels before registering
with optional `channelVersion: 2`. Omission on a later registration explicitly
returns that device to the legacy shared channel, including app downgrade.

For negotiated Android devices the server derives the channel from the verified
Inbox event kind: `business-decisions` for approval requests, `business-summaries`
for daily/register summary or unavailable notices, and `business-stock` for stock
alerts. Older devices and iOS use the existing `business-updates` provider field.
The provider adapter rejects arbitrary channel IDs. Payloads remain generic with
only the Inbox event hint; category selection grants no decision or data access.

Channel creation inherits the legacy channel's current importance, including a
muted setting. Later language refreshes preserve each category's own importance.
Quiet hours, opt-in, live scope validation, normal priority and best-effort delivery
are unchanged. The OS controls actual delivery. Native mute migration and physical
provider delivery still require qualification; no production settings are enabled.

Local validation: 16 push integration cases, two focused stock-push cases and four
provider unit tests pass, including legacy renewal, both summary modes and generic
category routing. The companion mobile source has 99 passing tests, including
mute inheritance, category overrides and failed native-settings lookup recovery.
