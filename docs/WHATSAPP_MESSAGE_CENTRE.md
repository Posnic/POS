# WhatsApp message centre implementation

## Delivered in this branch

Settings → Messaging now groups connection, automatic-message controls, campaigns, message history and SMS. Existing marketing campaign forms and receipt controls are reused; their saved configuration is not reset. Official API and QR connection choices use labeled icon buttons. QR device identifiers and the unused host/IP field are hidden from normal setup. API credentials remain an administrator setup task; this release does not pretend that Meta Embedded Signup is implemented.

The campaign composer uses quiet underline navigation, a single audience selector, an optional message-starter disclosure and a separate customer preview. Review checks the recipient count before exposing send/schedule actions; edits invalidate the review and stale preview responses are ignored. No recipients means send and schedule stay disabled. This UI revision introduces no new persisted fields or synchronization paths.

Campaigns support category multi-select and customer multi-select with name/phone search, removable selections and retained selections between searches. Search returns at most 50 matches. Selected IDs are normalized and validated server-side. Empty customer/category selections never expand to all customers. Existing single-category campaigns remain readable. Offer, Christmas, New Year and custom-message buttons insert editable wording; inserting an offer code does not create a coupon. The live preview does not dispatch a message.

Receipt, reminder and cashback preferences use real switches and remain off unless explicitly saved otherwise. Credit and cashback configuration remains on the existing module pages. The cashback message switch cannot silently enable cashback issuance. Birthday and annual recurrence are explicitly shown as unavailable instead of offering nonfunctional switches.

Receipt/manual sending now uses MessagingService, matching the configured API or QR transport. A failed settings save stops the connection test. Boolean receipt preferences load correctly. Normal QR cleanup preserves saved authentication; explicit logout removes it. A campaign dry run no longer suppresses its subsequent real send.

New WhatsApp attempts are recorded in `messaging_events` with purpose, last four recipient digits, initial result and provider reference. Message body, full phone and credentials are not copied into this history. History is tenant/branch scoped and capped at the latest 100 attempts. Connector attempts reconcile their status with the existing outbox. “Accepted by sender” never claims confirmed customer delivery. Historical campaigns/reminders are retained in their existing records rather than fabricated as new attempts. A history-write failure never changes an accepted send into a retryable send failure.

## Authority and synchronization

Campaign schedules, recipient execution journals, sender credentials and message attempts belong to the API executing them. The POS sync classification now records these as local-only with explicit reasons instead of leaving them undecided. Existing `customers` and `branches` lanes carry their normal business records; this change does not add a second customer lane or change those payloads. Category lookup reads existing `customer_category` records and does not mutate or replicate them.

The Gateway and sync-agent manifests were inspected: there are no campaign/messaging execution lanes to extend. No shared lane is introduced, so no Gateway/agent manifest mutation is required. Replicating executable schedules or session credentials would be incorrect. Web and tills connected to the same API see that authority's settings and history. Independent offline local APIs do **not** gain shared sessions or synchronized campaign drafts from this change. History clearly identifies the connected server; cross-authority routing and read-only aggregation still need the coordinated implementation described in the research plan.

## Remaining release work

- Verify live API and QR sending with an authorized test number and deployed credentials. No real message was sent during development.
- Complete connector disconnect acknowledgement, restart restoration and uncertain-delivery recovery.
- Complete per-purpose approved Meta templates, verified incoming/status webhooks and Embedded Signup before advertising guided API onboarding or delivered/read statuses.
- Verify a deployed scheduler invokes campaign/credit runners. Existing scheduling endpoints alone do not prove unattended execution.
- Implement birthday/annual recurrence and shared cloud/local authority routing separately; do not enable dummy controls for these.
- Package and validate the intended desktop installer together with any worker and sync changes. This branch is not a deployment or installer release.

## Local verification

Targeted API tests cover campaign selection and dispatch, branch/tenant exclusions, dry-run followed by real send, history privacy/scoping, API/QR receipt dispatch and QR authentication preservation. Frontend DOM tests cover switches, category/customer selection, stale searches, saved-ID serialization and save failure handling. Desktop and 390px mobile renders use the real settings markup with fixture data and make no external messaging requests. The frontend asset build, API documentation generation, lint and attribution checks are run locally.

## Test-account verification — 20 October 2026

The isolated deployment serves only `sridharbalasubramani.posnic.io` on port 6562. The hourly migration job had moved its route back to the shared shard on port 6500, causing UI/API version mismatches. The existing operator route-pin mechanism now excludes this hostname from bulk migration. Both nginx route maps select 6562; nginx validation and the migration helper's pin check pass. Rollback must remove this hostname's pin and change only its two route entries back to 6500. Other shops were not redeployed.

The UI now distinguishes linked authentication from enabled sending, validates international numbers, disables duplicate test submissions, handles HTTP failures, and provides inline outcomes. The scan sender strips E.164 formatting before constructing a WhatsApp recipient ID and does not mark customer conversations read merely to send a message. No message is automatically retried after an uncertain result. Report email uses the same navigation and retains its original form.

Local verification: 218 API tests passed before the recipient regression was added; the updated sender suite passes 63 tests. The current UI/QR suite passes 13 tests. Desktop and 390px fixture checks cover overflow and test-control overlap. Live sends exposed the routing issue and sender failure; successful delivery is still pending final verification. Official API/SMS provider delivery and unattended scheduled campaigns require configured provider accounts and a deployed worker verification; local mocks are not evidence of real delivery.

Follow-up connection checks: the isolated client failed during cached-page initialization. Loading the current WhatsApp page with `webVersionCache: { type: 'none' }` restored QR generation. Concurrent initialization requests are coalesced, stale disconnect events cannot remove a replacement client, and failed initialization clears its pending state so the UI offers retry. The sender suite now passes 64 tests. Phone re-link on the pinned deployment is required before confirming live delivery; the previous shared-release session is not copied between servers.

Recipient follow-up: the reported “No LID for user” has an upstream issue in whatsapp-web.js (#3834). The sender now calls the documented getNumberId lookup and getContactLidAndPhone mapping, uses a matching returned LID when available, and refuses unresolved/unregistered recipients before send. There is no automatic resend. Provider stack traces are replaced with actionable UI errors. The client uses its actual browser user agent instead of the library's old default and identifies itself as Posnic. The sender regression suite passes 66 tests; this is not yet live-delivery evidence. The user reports two existing linked devices and a phone-side linking refusal; the exact phone error is still needed if the updated link attempt fails.


## Messaging organization — October 2026

Provider setup guidance appears beside the selected SMS provider, with steps and
an official help/site link for every named provider. MSG91 explains AuthKey,
sender and template mapping; Brevo distinguishes SMS API keys from SMTP keys.
WhatsApp API and email each have collapsible setup steps and official guides.
External links open separately without sending credentials or changing settings.
This is UI-only guidance: no new persisted fields, sync lanes or sending behavior.

Settings contains WhatsApp, SMS and Email service setup. Customer messages contains campaigns; Automatic messages contains receipt offers, credit reminders and cashback preferences. Reports owns scheduled business summaries. Message history remains separate from setup.

Email connection settings now have their own Save action, using the existing partial common-settings update. Previous report email preferences remain available in Reports to avoid silently removing existing choices.

Report delivery supports sales, profit and current low stock by email or WhatsApp. Daily sales/profit use the previous completed calendar day, weekly uses seven completed days and monthly uses the previous full month with delivery on the first. These are not register-close events. The send hour and IANA time zone are explicit. New schedules are off unless the owner explicitly enables them.

Messaging report routes are super-admin-only, scoped to authenticated shop and outlet. The existing durable report runner validates the owner's active account and outlet access at delivery time. Messaging schedules do not require the separate Ask Posnic feature switch. They share its lease, interrupted-delivery review and provider acknowledgement handling. They remain execution-local in ask_posnic_schedules; no cloud/local replication is introduced.

Validation: UI tests cover service grouping, monthly selection and default-off saves. Scheduler tests cover year rollover and a leap-year monthly range. Controller tests cover role, outlet/source isolation, default-off and invalid channel/time zone. Real email/WhatsApp report delivery must still be verified with a configured sender and an explicitly chosen recipient; no financial report was sent during layout testing.

## Delivery validation — 20 October 2026

The connection/provider blockers below describe the initial run. The follow-up
section records the current results and supersedes those initial states.

- Broad API run: 24 suites, 369 passing tests (settings, WhatsApp, campaigns, credit, cashback, scheduled reports, outbox, email transport/layout and templates).
- Additional receipt/SMS/API run: 5 suites, 270 passing tests. This overlaps the broad run's messaging-service suite; do not add these counts as unique tests.
- Browser logic and connector run: 21 passing tests, including failure/retry, QR refresh and queue verdicts.
- Added malformed Meta acknowledgement regressions. Empty or missing message IDs previously returned success; now they return an unconfirmed-send error. No automatic retry is introduced. Existing attempt history remains tenant/outlet scoped and execution-local; no sync fields or lanes change.
- Deployed the acknowledgement fix only to the isolated test account.
- Real email smoke test: provider accepted a synthetic receipt and synthetic daily summary for the user-authorized recipient. The summary exercised the report runner's delivery function; this was not a live scheduler-triggered business report. No real customer/financial data was included. Inbox arrival is not independently confirmed.
- Live SMS blocked: no provider selected or credentials configured.
- Live Meta WhatsApp blocked: no access token, phone-number ID or approved template configured. An email account identifier does not configure the API.
- Live scan WhatsApp blocked: phone not linked. No receipt, reminder, campaign or report was actually delivered through WhatsApp in this run.
- Previously saved daily WhatsApp schedule stays off. No customer campaign, reminder or recurring report was enabled by these tests.
- Cloud/local till round-trip and live physical till operation were not tested in this run.

## Delivery follow-up — 20 October 2026

- Scan WhatsApp: the user linked the fresh QR and explicitly confirmed receipt of
  the connection test. After an isolated API restart, Connect restored the saved
  session without a new phone scan. This proves the connection test and manual
  restart restoration, not every receipt, campaign or scheduled report.
- Removed `userAgent: false` and use whatsapp-web.js's default. Initialization
  allows 90 seconds, rejects stale client events, and recovers from string errors.
  The UI continues connection-status polling after linking and releases failed
  initialization controls. No blind resend is introduced.
- MSG91: configured the approved POSNIC receipt template with `name` and `url`
  variables. Generic messages require their own compatible approved template.
  The balance-reminder template visible in MSG91 was marked failed by DLT.
  The initial receipt test was accepted but the user did not receive it, and
  provider logs did not show it. The stored key was subsequently found empty.
  Delivery remains unverified pending restoration of the existing credential.
- Saving/testing WhatsApp now submits only WhatsApp fields; SMS submits only SMS
  fields. The API preserves omitted channel settings and stored secrets. This
  prevents stale settings in a separate tab from overwriting another service.
  Regression coverage includes both directions and preservation of credentials.
- Configured receipt SMS uses the branch sender and approved receipt variables.
  A provider rejection does not silently fall back to another sender. New SMS
  attempts record acceptance/failure and provider references in the existing
  execution-local `messaging_events` collection; credentials and full recipients
  are not copied to history. The synchronization authority above is unchanged.
- Email: Brevo accepted the synthetic receipt, summary and one diagnostic message,
  but the user received none. The signed-in Brevo dashboard confirms the correct
  Posnic account, an authorized server IP, and no suppression entry for the test
  recipient. Both dashboard and API show no delivery events for the tests.
  Do not label these emails delivered or report the email workflow as passed.
  Provider tracing is still required; no credentials or security settings changed.
- Latest focused verification: 15 messaging-service tests and 14 message-centre
  DOM tests passed; frontend assets built; selected API lint has zero errors
  (two console warnings). The channel-isolation fix is deployed only to the
  isolated test account. These counts overlap earlier runs.
- Official Meta API, scheduled live delivery and physical/offline till behavior
  remain unverified. Recurring reports and bulk campaigns remain off.

## Live workflow validation — 20 October 2026

This is not a delivery sign-off. Provider acceptance and handset/inbox delivery are separate checks.

- Local workflow regression run: 14 API suites / 225 tests passed, covering messaging, WhatsApp, campaigns, credit, cashback, report scheduling, email acknowledgement and receipt SMS routing. Message-centre UI: 15 tests passed. Receipt composer regression: 4 tests passed.
- WhatsApp connection test was previously confirmed received by the owner. A later single-recipient campaign was accepted but the owner reports it did not arrive. Do not mark campaign delivery passed.
- Sales History had an empty WhatsApp fallback and no message textarea in the shared receipt modal. The test deployment now opens the configured sender's composer, previews item lines and total, keeps the sale ID on free-text sends, prevents repeated clicks while pending, handles non-JSON network failures and retains one form handler across SMS/WhatsApp switches. One labelled sample receipt was accepted on 20 October at 10:55 UTC; delivery is unverified.
- MSG91 key restoration was confirmed without exposing the secret. One approved receipt-template test was accepted at 10:48 UTC. Owner reports no delivery. MSG91 All Logs, API Failed Logs and Failed Requests show no matching records. Do not retry automatically or call this delivered.
- Brevo accepted a synthetic daily report to the owner-approved info@posnic.com recipient at 10:47 UTC, reference `<202610201047.90409410696@smtp-relay.mailin.fr>`. API events and the signed-in transactional dashboard show no delivery event. Owner confirms info@posnic.com forwards to the signed-in Gmail inbox; scoped all-mail search (including spam/trash) found no test email. Delivery failed acceptance testing; cause remains unresolved.
- A copied one-run daily WhatsApp schedule failed before sending. Execution ownership proves the shared release worker claimed the test tenant's job, despite HTTP routing to the isolated build. The isolated build successfully generates the same report. The copied schedule is disabled; the original remains unchanged. Background-worker isolation must be corrected before scheduling can be signed off.
- Official WhatsApp API remains blocked by the Meta account restriction. No real API delivery pass is claimed.
- Reminder/reward and weekly/monthly boundary behavior is covered by automated tests, not live recipient delivery. No customer-wide campaigns or recurring test schedules were enabled.

Receipt changes reuse existing sales reads and sending endpoints; they add no persistent business fields or new synchronization collection. Receipts read the current installation's existing sales records. Credentials, linked-phone session and sending execution remain local to their configured sending server. Offline sending is not claimed; failures are shown and no automatic retry is introduced.

## WhatsApp API providers — 20 October 2026

Messaging > Settings > WhatsApp > WhatsApp API now offers Meta, Brevo, Twilio, MSG91, 360dialog, Gupshup and Infobip. Each selection shows only its own account fields, setup steps and official documentation. Scan with your phone remains separate. These are implemented adapters, not a claim to support every provider.

The common sending path handles receipts, reminders, campaigns and reports. Current template support is text with one body variable containing the composed message. Media, buttons and templates requiring multiple variables are not supported. MSG91 requires a template; other providers can send plain text only where their conversation rules permit. Provider approval, consent and template requirements still apply.

Credentials stay in existing installation-local messaging_settings; no sync collection or schema lane is added. Read responses mask secrets. A blank secret retains the saved value only for the same provider; switching providers clears other credentials. Fixed endpoints, disabled redirects and a restricted Infobip account hostname prevent forwarding secrets to arbitrary hosts. Failures are not automatically retried, and provider acceptance does not imply delivery.

Validation: 51 API tests across provider, service, history and outbox suites; 16 message-centre UI tests. Requests and failure handling use mocked provider contracts. No live delivery is claimed for the newly added providers without their configured accounts and approved templates.

Official references:
- Meta: https://developers.facebook.com/docs/whatsapp/cloud-api/
- Brevo: https://developers.brevo.com/docs/whatsapp-messages
- Twilio: https://www.twilio.com/docs/whatsapp/api
- MSG91: https://docs.msg91.com/whatsapp
- 360dialog: https://docs.360dialog.com/docs/messaging-api/api-reference/messages
- Gupshup: https://docs.gupshup.io/docs/template-messages
- Infobip: https://www.infobip.com/docs/whatsapp/whatsapp-over-api

Support escalation: owner authorized delivery investigations. MSG91 request emailed to support@msg91.com with the accepted SMS request reference. Brevo support form submitted and email verified; its confirmation states that the request was sent. Neither escalation establishes delivery success.

## Updated evidence — 20 October 2026, evening

The release verification section below records the latest delivery confirmations. The detailed HTML test report and screenshots are retained locally and are not part of this repository. Earlier owner screenshots showed the connection, campaign and text receipt messages; at that stage, WhatsApp had arrived but SMS had not, and PDF opening was still unconfirmed.

Linked-phone receipts now attach a freshly generated PDF; API/connector senders include the generated bill URL. Documents are generated from tenant sales with an explicit branch check. The email receipt path also attaches the PDF. New S3 objects are immutable random-key snapshots; no database collection or replicated business field is introduced. File contents are uploaded to the configured object store, while sending credentials/session and message execution remain installation-local. Live offline-till and cross-installation behavior remains unverified.

An upstream whatsapp-web.js media-message error was reproduced and repaired using the upstream `delete message.__x_id` fix. The patch script refuses to modify a shared dependency directory. The test server uses a private isolated copy; the shared production dependency was not patched. PDF send was accepted at 13:04:30 UTC.

Reports now have a scoped, super-admin-only `POST /messaging/reports/:id/test` action. It sends a clearly labelled manual test without enabling or advancing the schedule. Live daily, weekly, monthly, profit and low-stock tests were accepted, along with a clearly labelled synthetic credit reminder. The reminder fixture was removed and the original absence of credit settings restored. Scheduled test rows remain disabled. Actual timer execution is not signed off because the shared worker claimed the earlier isolated test.

MSG91 removed an earlier operator complaint block, but the subsequent approved-recipient test failed with CTA Error (request `366a7472486c63496f443562`). A support follow-up requests the precise rejected link/domain and approval correction. SMS delivery is failed, not passed. Brevo ticket #5627203 is assigned to a human team; email delivery remains unresolved. No repeated retries were used to hide these failures.

Latest verification: 17 API suites / 438 tests passed; 20 messaging and receipt UI tests passed; frontend assets built successfully. Tests cover receipt scoping/document transport, campaigns, credit, cashback, report periods/claims, history, outbox and provider contracts. Live reward delivery, physical tills and API-provider delivery are not established by those tests.

## Vonage SMS trial — 20 October 2026, 20:04 IST

Twilio phone verification returned a processing error. The owner completed a Vonage trial and explicitly supplied its API secret. A direct Messages API SMS to the owner-approved number ending 1161 was accepted at 19:59:56 IST and confirmed received. The dashboard's own demo button failed, so that attempt was not counted as success.

Posnic now offers `vonage_messages` alongside the unchanged legacy `vonage` adapter. It uses the Messages API JSON contract, Basic authentication, and requires HTTP 202 plus a message UUID. Legacy account selection remains intact. Setup help explains the choice; secrets use the existing masked, installation-local messaging settings. No new business collection, sync lane, schedule, or automatic customer send was introduced.

The isolated test account was switched to Vonage Messages API after preserving its prior MSG91 configuration in a mode-0600 backup on the test server. The Posnic Send test action was accepted at 20:04:30 IST and appears in Vonage's log as `db96691f-5784-4ed6-af2d-99258a3decff`. The owner separately confirmed this second SMS arrived, establishing end-to-end delivery from Posnic through Vonage to the handset. Receipt-link and reminder delivery still require their own workflow checks.

Targeted provider/settings/service tests: 3 suites, 30 tests passed; frontend assets built. Credentials were not added to repository files. MSG91 support separately confirmed that the rejected SMS URL needs DLT whitelisting. Email delivery remains under investigation.

## Recovery and workflow verification — 20 October 2026, 22:07 IST

This section supersedes the earlier timer failure. The actual scheduled worker sent daily report `6ad79884efb616a8d2561811` once, returned a WhatsApp message reference, and advanced its next run to 21 October at 08:00 IST. The temporary schedule was disabled afterward. This test began after a server restart and restored the saved phone link without another QR scan.

Three defects were repaired: headless Chromium inherited a short-lived Linux desktop D-Bus session and aborted when it disconnected; WhatsApp Web message-key serialization changed upstream; and timer-driven delivery lacked the request's shop context and BSON license type. The isolated dependency patch implements the message-key compatibility approach in https://github.com/wwebjs/whatsapp-web.js/pull/201901 alongside the existing media fix. It is idempotent and refuses to modify shared dependencies. Missing send references are uncertain outcomes, not successes.

The shared shard now excludes `sridharbalasubramani.posnic.io` through `SHARD_EXCLUDE_HOSTS`, excluding the whole tenant and its aliases from HTTP and background work. The shared file received only this guarded exclusion hook and helper, with a backup retained; other shared application code and dependencies were not deployed. The shared test-host route returns 404 while the isolated route returns 200. PM2 configuration was saved. Future shared releases must retain the exclusion hook and environment setting while this isolated deployment is active.

SMS workflow checks: receipt accepted at 21:23, credit reminder at 21:23, explicit single-customer campaign at 21:25, reward service at 21:26. Dry-run sent zero; campaign repeat was rejected; duplicate reward issuance returned duplicate; the synthetic coupon was voided. Temporary reminder customer and balance were removed and prior settings restored. These additional SMS messages have provider records but no individual handset confirmations. The earlier connection SMS is owner-confirmed.

The SMS receipt now uses the trusted tenant origin when PDF object storage is unavailable. Its printable bill page renders all three sample items, quantity three and total ₹420; missing item tax fields no longer stop rendering, and timezone dependencies are included. WhatsApp receipts still attach the generated PDF directly.

Fresh WhatsApp PDF and daily report requests returned references at 21:57. Message history shows the successful timed report at 22:07. Latest recovery checks: 113 tests across seven suites; separate messaging-service regression also passed. These counts overlap earlier suites. No new replicated business fields were introduced: sender credentials, sessions, and shard routing remain installation-local. Physical till offline/reconnect checks remain unverified.

Remaining external limitations: Brevo accepted email requests without observable delivery (ticket #5627203); MSG91 requires DLT URL whitelisting; Meta account restrictions block live official API testing. Alternative WhatsApp provider adapters have contract coverage, not universal live-provider certification. Automated birthday/annual greetings remain unimplemented; manual greeting campaigns are available.

## Release verification and limits

The owner confirmed delivery of daily, weekly, monthly, profit and low-stock summaries through the scanned phone connection, the corrected PDF bill with its ₹420 total, and the SMS bill link. PDF rendering now reads persisted sale totals and preserves legitimate zero values. Public receipt access requires a validated encrypted receipt identifier; plain sale identifiers and malformed links are rejected. Both legacy SMS transports use the trusted shop origin rather than the marketing website.

Email provider acceptance is not inbox delivery: the latest daily summary was accepted by Brevo but had neither a delivery event nor a matching inbox message. Live SMTP delivery has not been verified; loopback SMTP tests cover acceptance and rejection. SMS scheduled reports and report PDF links are not implemented. Reports currently send text summaries; SMS bills use a printable web receipt when PDF object storage is unavailable.

Merge scope is messaging only. Azure's missing-card-summary investigation is deferred and introduces no payment changes. Credentials, temporary test fixtures, browser screenshots, deployment archives and client-data audit files are excluded from the release commit. No physical offline-till verification is claimed.
