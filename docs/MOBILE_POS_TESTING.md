# Mobile POS integration — 0.2.0 test build

## Run the matching desktop and phone builds

Close the running desktop app, then open
`test-builds/mobile-pos-0.2.0/win-unpacked/Posnic.exe`. Keep the directory intact.
This is a Windows test build, not a published installer. It uses the normal
Posnic data directory. Install the matching Mobile POS 0.2.0 APK over the previously installed test version. It uses the same test signing certificate; do not uninstall a phone holding unsynced sales.

For a cloud account, open the updated desktop so its sync agent can report the current LAN address. On the phone choose **Sign in**, or **Create account · Free trial**, approve the matching device in the browser, and return to set a PIN. The phone prefers an authorized nearby till during onboarding and otherwise uses the cloud shop. This requires the account, gateway and shop APIs to be deployed together.

For a Community/local shop, use **Connect a local or Community shop** and follow the steps below.

1. Open **Settings → Features**, enable **Mobile POS**, and save. Captain has its own independent switch.
2. Open **Settings → Mobile POS** for the shop-address QR, five-minute single-use pairing code, offline policy, quick-sale settings and receipt till.
3. Open **Settings → Branch payments** to add UPI accounts and choose the branch default. These accounts are shared with Mobile POS.
4. Open **Settings → Devices** to see Mobile POS and Captain phones, filter by app, or revoke a device. Captain's settings page links to its filtered device list.

Turning off Mobile POS blocks new pairing/bootstrap/sync. Already recorded sales stay on the phone; re-enable the branch to reconcile them. A disconnected phone retains its issued authorization until that grant expires. No immediate remote wipe is implied.

Keep the desktop running and put the phone on the same LAN. In the mobile app
use Wi-Fi search, scan the desktop QR, or enter the displayed address. A LAN
firewall must permit the desktop's actual configured API port shown in its QR/address; it is not necessarily 5555.

## Test checklist

1. Connect and confirm the branch, staff and real catalogue.
2. Set a PIN; background and reopen the phone to check locking.
3. Complete a small cash sale. Confirm it appears once in desktop Sales with
   its payment and stock audit.
4. Disconnect the phone from the network, complete another sale, then reconnect.
   The receipt stays local while offline. Synchronization retries automatically
   while the app is open; Sync now is also available.
5. Add a branch UPI account and default in desktop settings, refresh the phone,
   select UPI, and verify its amount QR. These are explicitly staff-confirmed
   payments, not bank-verified payment-provider events.
6. Configure the receipt printer in desktop Hardware settings. In the phone
   choose More → Printer → Till and print a test or receipt. Offline receipt
   requests persist and are submitted after the sale syncs. Queue acceptance
   does not prove that paper printed; physical hardware must be checked.

## Server implementation

`features.mobilePosV1` advertises the compiled API capability. The separate
branch switch is `branches.module_mobile_pos_enable` in Settings → Features.
Settings → Mobile POS owns offline and checkout configuration. Settings → Devices
shares the handset registry with Captain. Settings → Branch payments owns UPI
accounts in `branches.payment_settings`. Legacy mobile settings remain readable
until migrated; saving Mobile POS settings cannot change the switch or payments. Older servers still require the backend update.
No remote cloud instance has been deployed by this change.

The API reuses handset credentials/revocation, POS line-tax calculation, the
Sale model, branch bill numbering, stock audit repository and the existing
claimed receipt queue. Catalogue grants pin tenant, branch, staff and device.
Cart lines retain their issuing snapshot when catalogue prices change.

Standalone MongoDB does not provide cross-document transactions. Therefore
ingestion uses a durable intent plus stable sale/customer/stock-audit/print
identities and atomic per-item stock-effect markers. It acknowledges only when
all effects finish. Concurrent retries and interrupted completion are tested.
The sale can be visible while effects are pending; Settings → Mobile POS lists
interrupted work and can resume it. Paid offline sales that oversell stock are
recorded and flagged, rather than charged again or silently discarded.

Do not delete `mobile_sales`, `mobile_grants`, or item `mobile_effects` records:
these preserve replay protection and offline evidence. Effect-marker retention
needs a bounded archival design before high-volume production rollout. Mobile
grants/journal/pair codes stay on their issuing server; this build does not
advertise shared-ledger LAN/cloud failover.

## Verification

- Twelve integration scenarios on an isolated real MongoDB, including actual
  password login, pairing, cash/UPI/quick sales, customer creation, stock and
  stock audits, simultaneous retries, interrupted completion, stale cart prices,
  permissions/revocation, cookie/CSRF desktop settings, and the mobile UI selling
  offline then synchronizing into desktop Sales.
- The browser scenarios use the compiled mobile preview against the actual
  server routes, not a mocked sale service.
- Phone/printer hardware and a deployed cloud instance are not covered by these
  automated tests. Card-reader/provider payments and complex item configurations
  remain outside this build's advertised capabilities.

Run from `api`: `node --test tests/mobile-pos.integration.test.cjs`.
For the two browser scenarios also set `MOBILE_PLAYWRIGHT_PATH` to an installed
Playwright package and `MOBILE_PREVIEW_DIR` to the compiled Mobile-App `dist`
directory. The integration test uses the bundled Windows mongod in this tree.
