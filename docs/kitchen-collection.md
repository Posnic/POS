# Kitchen and Captain beta: ready for device testing

Updated 2026-09-28. Install the matching Windows POS build and Android Captain APK.
These are local testing builds; nothing was published or installed over the shop automatically.
The Windows build is unsigned and the APK is a debug build.

## Setup: one phone and one touchscreen

1. Keep POS running on the shop network. Install the matching Captain APK on the phone.
2. On a manager's signed-in POS browser, select the branch and open `/kitchen/`.
3. Open **Device setup → Manager: authorize or disconnect screens**. Name the screen,
   then create a pairing code. Codes expire after five minutes and work once.
4. On the kitchen tablet/browser open the same server's `/kitchen/` URL (use the
   till's LAN IP address, not `localhost`). Open Device setup and enter the code.
5. The tablet has kitchen-only access: read orders and update preparation/readiness.
   It cannot authorize other devices, edit shop settings, take payment or use the
   Captain APIs with that device token. Do not leave a manager's POS login on a shared tablet.
6. Use Fullscreen and Keep screen awake. Install the kitchen shortcut where supported.
7. In Captain, sign in with the staff account which will place the order. Open Collect,
   choose sound/vibration/both/silent, Enable / test alerts, then **Start shift alerts**.
8. At the end of service use **Stop shift alerts**, either on Collect or the Android notification.

Managers can list and disconnect kitchen screens in the same Device setup panel.
Device authorization is branch-scoped, checked on every request, and ends when its
manager is disabled, loses branch/settings access, changes authentication version,
revokes the screen or the authorization expires. Active devices renew their 90-day
expiry daily. The server stores hashes of pairing codes and device tokens, not their secrets.
A disconnected screen immediately loses mutation access; its last visible orders may
remain on screen as stale information until it reconnects or is refreshed.

## Staff flow

- Chef starts preparing a ticket, marks a quantity of an individual dish Ready,
  or uses Ready all. Right swipe and large buttons both work. Vertical scrolling,
  cancelled gestures and repeated taps do not submit extra operations.
- The originating Captain sees the ready items. Older/unassigned tickets are shared.
  Another authorized Captain can use All Captains to help collect.
- Captain chooses a quantity, Collects it, then marks it Served after delivery.
  Another Captain cannot claim the same line while it has unserved collected units.
- Kitchen and desktop wall update. A partially served line retains its remaining quantity.
- Ready, collected and served totals, actor, revision and action identity persist in
  MongoDB. Conflicting actions refresh rather than overwriting another device's work.
- Undo cannot remove readiness below quantities already collected.

New KOTs retain their kitchen work after payment/bill printing until served or cancelled.
Ordinary immediate counter Add/Edit sales never enter the kitchen. Old paid receipts
are not resurrected on upgrade; an existing unpaid KOT is enrolled when used or settled
through the updated paths. Order changes keep separate round identities and arrival times.
Kitchen notes are shown; marketing descriptions are not substituted for kitchen instructions.

Delay colours default to green, orange after five minutes, red after ten. Managers can
set branch-wide orange/red minutes and enable/disable a gentle overdue border pulse in
Device setup. Reduced-motion preferences disable animation. Item text does not flash.

## Android shift alerts

The explicit shift starts a native connected-device foreground service with a visible
notification. It checks the POS every five seconds while the WebView is suspended or
screen locked, reconnects after temporary network failures, and stops after at most
12 hours, on logout, permission/authentication failure, or an explicit Stop.
A bounded CPU wake lock is held during the shift; stop it when service ends to save battery.
Credentials are held in memory only, not copied to preferences or logs. Requests have
connection/read deadlines, response-size limits and do not forward credentials through redirects.

Foreground and background delivery share a synchronized, persisted event ledger. Repeated
polls/page changes do not replay the same ready version. New ready quantities create new
versions. Notification taps open Collect. Outstanding collection records remain on POS
regardless of whether a notification was heard. An Android notification is not proof that
someone heard it; Collect is the explicit staff acknowledgement.

Use Android Settings → Apps → Captain → Notifications to allow alerts. Check channel
sound, notification volume and Do Not Disturb. If the manufacturer delays background
work, set Captain battery use to Unrestricted for the shift. Keep shop Wi-Fi connected.
Android force stop, switching off/restarting the phone, losing POS/network access or
staff-token expiry cannot be bypassed: reopen/sign in and Start shift alerts again.
The service deliberately does not auto-start at boot or after force stop.

This shift service is Android-specific. Browser users must keep the page open and enable
sound with a tap. iOS-native background delivery is not part of this Android/touchscreen beta.

Android references: [foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types)
and [user stopping a service](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping).

## Tablet startup and fullscreen

The kitchen page includes a standalone manifest and a public-shell-only service worker.
API responses, login data and order data are never cached by this worker. Lost connections
leave actions disabled. Screen wake lock and installation depend on browser support and
usually HTTPS; plain LAN HTTP can use a browser shortcut or managed kiosk browser instead.

A web page cannot change Android boot settings or lock other applications. For unattended
startup, configure the device's managed kiosk launcher with the `/kitchen/` URL, automatic
launch after reboot, fullscreen and its screen-awake setting. Set an administrator exit PIN.
Keep the tablet powered. Windows can use the existing POS kitchen window or a kiosk browser;
macOS and Linux can use the same authenticated page and their OS/browser kiosk settings.
No OS security or global power policy is silently changed by POS.

## Local verification

- API checks cover quantities, concurrency, restart recovery, tenant isolation, paid KOTs,
  cancellation, counter exclusions, manager-only settings, one-use device pairing and revocation.
- Browser checks cover swipe cancellation, individual Ready/Undo, stale responses, duplicate
  gestures, screen wake-lock release and served wall refresh.
- The two-window Electron proof runs actual kitchen and Captain UI against a fresh isolated
  MongoDB: Ready 1 of 2 → Collect → Serve → 1 remains. It substitutes test authentication.
- All 181 Captain tests pass, including the previously failing connection-refusal diagnostics.
  Refused servers are reported with address/status, without being adopted as trusted servers.
- Native Java event checks cover owner targeting, shared work, collected quantities and identical
  foreground/background event IDs. Android APK compilation and Windows packaging are checked locally.
- No new CI workflows/jobs were added. Physical sound, vibration, Bluetooth, tablet touch/gloves,
  overnight idle/reconnect and OS battery behaviour remain the user's device acceptance tests.

The coordination proof is `tests/tools/kitchen-coordination-proof.cjs`; pass the Captain
source directory and optionally its API dependency directory. The launcher detects the
primary checkout's test dependencies and exits cleanly if they are unavailable.
