# WhatsApp repair and simplification plan

Research date: 20 October 2026. Status: implementation proposal, not a completed repair.

Posnic should have one WhatsApp setup page and one sending path for receipts, reminders and other messages. Today, the API test and receipt button use different senders. Fixing screen labels alone will not make delivery reliable.

The shopkeeper should choose between **Connect through Meta** and **Link by scanning a QR code**, connect once, and send a test. Afterwards, staff should only need a customer number, a receipt preview and **Send receipt**. Advanced connection details belong behind support controls.

## What exists today

| Entry point | Current path | Consequence |
| --- | --- | --- |
| Settings messaging | `messaging.js` → `/messaging/settings` | Stores enabled state, web/cloud mode, device, informational host and manually entered Meta credentials. Restricted to super admins. |
| Messaging test | `/messaging/test` → `MessagingService.sendWhatsapp` | Selects Cloud API, in-process QR sender or connector queue. |
| WhatsApp Connection | `whatsapp.js` → `/whatsapp/initialize`, `/getQRCode`, `/getStatus` | Separate QR setup screen requiring a device ID. Initialization/status can use either QR engine. |
| Sales receipt | `sales.js:sendWhatsAppReceipt` → `/whatsapp/sendMessage` | Controller renders local message text, then directly calls the old in-process QR sender. It does not select the configured Cloud API or connector sender. |
| Campaigns, credit, cashback and scheduled summaries | Call `MessagingService.sendWhatsapp` | Use the provider-selection path, unlike the receipt button. Check each feature's consent and retry behavior separately. |
| Receipt preference | `branches.whatsapp_receipt` | Separate from `messaging_settings.whatsapp_enabled`. It is returned after saving a sale; it does not itself establish a working connection. |

The QR implementation has two engines: `api/src/services/whatsapp.service.js` runs Chromium inside the API, while `connectors/whatsapp` runs it in a separate process. These are deployment details, not two more options a shopkeeper should choose.

## Confirmed code findings

These findings describe the inspected code, not a diagnosis from the user's production logs. Relevant sender files were also compared with `origin/main`; no differences were found in the checked messaging service, QR service, connector and QR frontend paths.

| Priority | Finding and evidence | Required change |
| --- | --- | --- |
| P0 | Receipts bypass provider selection. `frontend/static/script/js/modules/js/sales.js` calls `/whatsapp/sendMessage`; `api/src/controllers/whatsapp.controller.js:sendMessage` calls `whatsappService.sendMessage` directly. | Route receipts and manual messages through the same provider-aware service as the test. Keep the old endpoint as a compatibility adapter. |
| P0 | Connector disconnect is incomplete. Controller initialization/QR/status recognize connector mode, but `logout` and `removeDevice` still call the in-process service. `ConnectorCore.handleInitRequests` only consumes `init_requested`. | Implement owner-directed disconnect, acknowledgement and credential removal. Do not report success until the correct worker confirms it. |
| P0 | Saved QR sessions can be deleted during ordinary recovery. `_safeCleanupClient` deletes the LocalAuth directory; both disconnected events and stale-client replacement invoke it. | Split memory/browser cleanup from explicit unlinking. Preserve authentication on recoverable failures and restarts. |
| P1 | Receipt preference type mismatch. `whatsapp.js:loadReceiptSetting` tests `whatsapp_receipt === 1`; `setting.model.js:getWhatsAppReceipt` returns a Boolean. | Normalize Boolean and legacy numeric/string values once. Verify save, reload and sale behavior. |
| P1 | Settings test can use old settings and overstate success. `messaging.js:test` sends after the save callback without checking its success. `MessagingService.test` labels a queued connector result “Test message sent”. | Stop on save failure. Preserve queued/accepted/delivered distinctions and provider reference. |
| P1 | Device identity is duplicated. QR setup writes `branches.whatsapp_device_id`; messaging settings store another device ID that takes precedence in `sendWhatsapp`. Remove-device clears only the branch field. | Establish one canonical connection record; migrate matching identities and surface conflicts instead of guessing. |
| P1 | Connector startup does not restore branches from their recorded connected state. The loop starts only `init_requested` clients; a pending message may start one with an empty device ID and immediately fail because it is not ready. | Restore configured owners at startup; wait for readiness without consuming message retry attempts. |
| P1 | Asynchronous connector initialization failures are logged in `index.js`, but do not update the mirrored connection state. | Feed startup/authentication errors into the state machine with a recovery action and heartbeat expiry. |
| P1 | Cloud templates have an oversimplified mapping. One branch-wide template name/language receives the entire message as one body variable. | Fetch approved template definitions and map named receipt fields to the correct ordered components. Handle rejection, paused templates and language availability. |
| P1 | Cloud sending returns a provider message ID, but no WhatsApp-specific incoming/status webhook receiver was found in the inspected route/service searches. | Implement verified callbacks, customer-service-window tracking and delivery updates. Posnic's generic outbound webhooks are not a substitute. |
| P1 | A typed host/IP does not route a send. `whatsapp_host` is stored and returned, but the inspected sender does not use it to contact another machine. | Remove the host field from normal setup. Show the actual selected sending computer and its health. |
| P1 | Messaging settings are explicitly classified as `undecided` in `api/src/sync/collections.json`; cloud and tills may have different settings. | Define shared nonsecret configuration and the authoritative sender before release. Do not copy sessions or executable outbox work to every till. |
| P1 | Ordinary outbox sends can be repeated after an uncertain outcome. A successful external send followed by a failed result report leaves a reclaimable row. | Add stable intent IDs and an uncertain-result state; do not claim exactly-once delivery. Scheduled summaries already have stricter review behavior that must be preserved. |
| P2 | Manual IDs, separate screens, switches and raw credential fields make setup difficult. API fallback version is hardcoded as `v20.0`. The old guide assumes sessions last until logout. | Guided setup, capability checks, centrally maintained API version and revised support documentation. Verify current version support rather than assuming this version caused the outage. |

Other risks to verify: overlapping QR initialization, polling cleanup on navigation, stale callbacks after switching branches, phone-number normalization across adapters, and permission consistency between old WhatsApp endpoints and messaging settings. These require targeted tests rather than treating every suspected risk as a confirmed failure.

## External platform facts

**Official API.** Meta provides Embedded Signup for onboarding business customers. It is a route to removing manual credential entry from the normal POS setup, but Posnic still needs the applicable Meta app access and backend onboarding work. It is not implemented merely by drawing a Connect button. [Meta Embedded Signup documentation](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup).

The Business Platform permits free-form replies during the 24-hour customer service window; outside it, approved templates are required. The policy also requires recipient opt-in and honoring opt-out requests. A number entered at checkout does not alone prove consent for future marketing. [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/).

Meta's published pricing is per delivered message and varies by destination and category, with specified free cases. Show the current pricing link during setup and avoid hardcoding a universal free-message promise or an India-only rate. [Official platform pricing](https://whatsappbusiness.com/products/platform-pricing/).

**Scan connection.** The current QR engine uses whatsapp-web.js, an unofficial library that automates WhatsApp Web. It is not Meta Cloud API. LocalAuth requires persistent storage; keeping its directory is necessary for restoration. Moving the worker into a sidecar does not turn it into an official integration. [Library introduction](https://wwebjs.dev/guide/) and [authentication guide](https://wwebjs.dev/guide/creating-your-bot/authentication).

**Same-number API and phone app.** Treat Meta Business App coexistence as a conditional onboarding capability to verify, not a universal promise and not equivalent to this QR worker. The current [Meta coexistence documentation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users) returned HTTP 429 during research; current account, region and partner eligibility remain a release prerequisite. Do not tell a merchant to delete or migrate their existing account until eligibility and consequences have been checked.

## Proposed simple screens

### One WhatsApp page

Place it under **Settings → Messaging → WhatsApp**, with a direct WhatsApp shortcut if needed. Redirect the old Connection tab here. Leave SMS separate.

Before connection, show two cards:

| Card | Shopkeeper copy | Primary action |
| --- | --- | --- |
| Connect through Meta | For business messaging and automatic receipts. Meta setup and message charges may apply. | Connect WhatsApp |
| Link by scanning a QR code | Link WhatsApp on your phone. The selected sending computer must stay on and connected. Uses an unofficial connection. | Show QR code |

Recommend the official route for dependable unattended production messaging. Keep the scan option available where its worker is supported. Both lead to the same receipt interface. Do not silently switch a merchant's existing method.

After connection, show only:

```text
WhatsApp
Connected · +91 …1234
Sending from: Shop computer        [scan connection only]

[Send test message]  [Connection settings]

Receipts
  Offer WhatsApp receipt after a sale     On / Off
  Message preview                        [Edit]

Recent messages
  Receipt S128 · …5678 · Waiting to send
  Receipt S127 · …4321 · Delivered
```

“Connected” requires verified connection health, not just a stored token or device ID. When the sender is offline, show **Waiting for Shop computer** and one **Reconnect** or **Check computer** action. Never show both Connected and a stale QR.

Put connection method, change number and disconnect under Connection settings. Device IDs, Graph versions, worker tokens and debug logs belong in an advanced support panel. Keep existing permission enforcement; a separate delegated setup permission needs deliberate design, not removal of authentication checks.

### Scan flow

1. Choose **Show QR code**. Create the internal connection ID automatically.
2. Check that the selected worker exists, has compatible browser dependencies, persistent storage and internet access. If unavailable, show the missing requirement before displaying a spinner.
3. Show **Open WhatsApp → Linked devices → Link a device → Scan this code**. Refresh from actual QR events; distinguish loading, expired and reconnecting.
4. After scan, show **Finishing connection**, then the verified phone identity. Authentication alone is not the ready state.
5. Offer **Send test message** to a number entered by the owner. Keep it an explicit action; setup must not message customers automatically.
6. On success, offer the receipt preference. Default a newly introduced automatic behavior off.

On desktop, use the supported local sender. In a cloud browser, explicitly choose an already paired shop sender, or use a deliberately provisioned hosted worker. Do not assume the browser can host the background session or that an entered IP makes routing work. Community edition can use the same supported local worker; packaging and signing must be delivered with the feature.

### Official API flow

1. **Connect WhatsApp** opens Meta's supported onboarding flow once Posnic's provider setup is ready.
2. Merchant authorizes the business and phone number; Posnic exchanges and stores credentials server-side. Cancel returns to a usable setup page.
3. Validate phone registration, access, webhook subscription and billing/readiness requirements. Translate errors into actions such as **Finish setup in Meta** or **Reconnect your account**.
4. Prepare a receipt message using an approved template and supported language. Show **Awaiting Meta approval** where necessary; a local saved message is not an approved Meta template.
5. Send an explicit test and show its actual state. Enable receipt use only when the intended send path has been verified.

Until Embedded Signup is implemented, offer **Connect an existing API account** in advanced setup with token and phone ID validation. Do not advertise one-click onboarding prematurely. Retain manual setup for technical operators; do not expose all API fields to every cashier.

## Sending a receipt

After a sale, display **Send receipt on WhatsApp**, the customer's country and number, the receipt preview and **Send receipt**. Staff should not choose an engine, device ID, Meta template ID or host.

Use a dedicated receipt design per language and purpose. For the API route, choose an eligible approved message automatically; for the scan route, render the equivalent local text. Keep promotional campaigns separate from receipt delivery and its consent.

Prefer a short receipt summary and secure receipt link for the initial release. PDF/document delivery is a separate adapter capability; the inspected senders currently send text. Receipt links must use scoped, revocable or expiring access and must not expose other sales by changing an ID.

The preview must use the saved sale's currency, totals and language. The legacy controller has hardcoded rupee/item formatting in its template replacement and should not be the source of a new international receipt renderer.

Clicking twice or retrying a network timeout must reuse the same send intent. An intentional second copy should be an explicit resend with a new intent and an audit record. Saving a sale must succeed independently of a messaging outage.

## Delivery and recovery

Use one message model with branch, tenant, sale/reference, purpose, recipient, language, provider, connection, intent ID, timestamps, provider reference and redacted failure details.

| State | Meaning | User action |
| --- | --- | --- |
| Waiting to send | Durable intent exists; worker or internet is unavailable | Wait, cancel, or check connection |
| Sending | Worker owns a time-limited claim | No duplicate Send button |
| Accepted | Provider acknowledged the request | Wait for delivery evidence |
| Delivered | Provider confirmed delivery | None |
| Read | Read event is available | None; absence does not mean unread |
| Not sent | Known failure before acceptance | Fix issue, then retry |
| Check delivery | External outcome is uncertain | Inspect before explicit resend |

Only display statuses supported by the adapter. Store and reconcile provider IDs and callbacks; do not label an enqueue or HTTP acceptance as customer delivery. Verify callback signatures and account mapping, handle duplicates/out-of-order updates, and avoid regressing a delivered state.

## Storage and synchronization decision

One sending authority owns each connection and each message intent. Cloud API connections can be owned by the configured cloud service or the deliberately selected local API; QR connections are owned by their assigned worker. Every caller routes to that owner. Network failure must not cause an unannounced fallback to another phone or sender.

Share nonsecret connection metadata, selected method, receipt preferences, template references and read-only delivery status across authorized tills. Keep access tokens, QR session files, worker credentials and lease/claim state at their authority. Do not sync executable outbox rows to multiple installations.

Replace the `messaging_settings` undecided classification with explicit safe shared configuration and secret storage. Define any new collection in POS, Gateway and agent manifests together. Retain local-only outbox execution; use an idempotent intent submission or read-only status projection for other tills. Reconnection must not replay a sale's message from both cloud and desktop.

Migration must reconcile the two device-ID fields, preserve the currently selected provider, retain existing consent and receipt settings, and avoid sending anything. Conflicting IDs need a visible choice of connection. Removing a connection revokes its credentials and updates shared status without deleting sale history.

## Scope extension: reminders, campaigns and greetings

The replacement must include all messaging purposes, not only receipts. Source review on 20 October 2026 found:

| Capability | Existing implementation | Remaining work |
| --- | --- | --- |
| Credit balance reminders | `credit.service.js` has individual sending, batch reminders, minimum due and reminder logging; routes expose both actions. | Verify production invocation of the batch runner; add dependable scheduling, current-balance recheck and unified delivery status. |
| Promotions and customer groups | `campaigns.js`, `campaign.service.js` and campaign models support messages, audience segments, previews, send, scheduling and per-recipient records. | Connect the simplified editor to these existing features; repair shared sending and template mapping. |
| Christmas/New Year greetings | Generic campaign text can already carry greetings, sent now or scheduled. | Add convenient greeting presets. Dedicated annual recurrence was not found in inspected source. |
| Offer codes | Campaign text can include an existing code; cashback service already creates and optionally sends cashback coupons. | Do not imply entering a code in a message creates a valid coupon. Add deliberate coupon selection/validation if required. |
| Birthday wishes | No dedicated birthday-message automation found in inspected source. | Add birthday data handling, eligibility, recurrence and scheduling before enabling. |
| Business summaries | Ask Posnic runner calls the shared WhatsApp sender for scheduled reports. | Preserve this feature and show its status in the combined history. |
| Unified delivery history | Separate campaign sends, reminder logs, cashback issue flags and outbox records exist. | Build a combined view; correct cases where `ok`/queued acceptance is labeled sent or delivered. |

Campaign `runDue` and credit `runReminders` have controller endpoints. Searches found no in-process automatic caller for those methods; a deployment-managed caller may exist and remains unverified. A code comment mentioning cron is not evidence that scheduling is running in production.

Use four sections: **Automatic messages**, **Campaigns**, **Message history**, **Connection**. Keep new automatic behaviors off by default, preserve existing preferences during migration, and distinguish sample mockup settings from actual shop configuration. The expanded interactive mockup demonstrates settings, campaign presets and audience selection, review before sending, scheduling, and offline queue states; it performs no live operations.

## Repair order and acceptance

1. Unify sender dispatch, Boolean settings, save/test handling and queue-aware responses. Verify the actual receipt action for both methods before redesigning onboarding.
2. Repair QR persistence, restart restoration, fresh status, disconnect and worker ownership. Ship dependencies and worker supervision with desktop packaging.
3. Add the single setup page, phone validation, simple receipt preview and actionable errors. Preserve old endpoint compatibility during migration.
4. Complete API template mapping, signed webhooks and guided onboarding. Validate supported Graph versions and coexistence eligibility before exposing them.
5. Release shared metadata/status and owner routing across cloud and tills; only then enable unattended sending or campaigns for the tested installation model.

| Test | Required result |
| --- | --- |
| Cloud mode, then receipt button | Uses Cloud API; no linked-device requirement |
| QR connector mode, then receipt button | Creates one intent for the correct owner |
| Boolean receipt preference | Survives save/reload and controls the intended sale action |
| Save fails before test | No message is sent using old settings |
| Scan, restart, temporary disconnection | Existing authentication is preserved; ready status becomes fresh |
| Disconnect on connector | Correct worker confirms unlink; cannot continue sending |
| Worker missing or browser launch fails | Clear recoverable setup failure, not endless QR loading |
| No recent customer conversation | API selects an approved eligible template or explains why it cannot send |
| Invalid/expired token, wrong template language | Specific repair action; no false Connected state |
| Enqueue, acceptance, delivered callback | Three distinct states; callback matched to the correct account/message |
| Double click, timeout, lost acknowledgement | No blind automatic duplicate; uncertain sends require review |
| Cloud/till/second till, offline/reconnect | Shared status without duplicate execution or credential leakage |
| Branch switch and unauthorized user | No stale QR, message or cross-branch access |
| Country, currency and language variations | Correct number normalization and saved receipt content |

## Verification record

Existing local tests: **162 API tests passed in five suites**, covering messaging/WhatsApp services, controllers and outbox; **7 connector-core tests passed**. Passing mocks do not establish production delivery. A small isolated connector probe confirmed that a mirrored `connected` state alone does not restore a worker client on startup. The Boolean comparison was also checked directly.

No WhatsApp messages were sent, accounts linked or credentials changed during this research. Live outage identification still needs the failing screen/action, deployment type, selected method, a redacted request error, worker health and a user-authorized test recipient. Do not collect access tokens or QR session files in a support report.

The existing [QR setup guide](../api/WHATSAPP_SETUP.md) is historical and incomplete: it references old directories, manual package installation, a device-ID workflow and overly strong persistence claims. Replace it during implementation with owner setup instructions for the two flows above, plus a separate technical deployment guide.

### Code references

- [Messaging frontend](../frontend/static/script/js/modules/js/messaging.js)
- [QR frontend](../frontend/static/script/js/modules/js/whatsapp.js)
- [Sales frontend](../frontend/static/script/js/modules/js/sales.js)
- [Messaging service](../api/src/services/messaging.service.js)
- [WhatsApp controller](../api/src/controllers/whatsapp.controller.js)
- [In-process QR service](../api/src/services/whatsapp.service.js)
- [Connector core](../connectors/whatsapp/src/core.js) and [bootstrap](../connectors/whatsapp/src/index.js)
- [Outbox](../api/src/services/whatsapp-outbox.js)
- [Receipt settings model](../api/src/models/setting.model.js)
- [Synchronization classification](../api/src/sync/collections.json)
