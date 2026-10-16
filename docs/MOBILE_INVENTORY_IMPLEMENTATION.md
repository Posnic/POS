# Mobile inventory pilot implementation

The mobile client and POS server must both include this change. Beta 20 does not include inventory. This document records implemented scope; it does not mark the complete inventory roadmap finished.

Mobile inventory is enabled by default for new branches and branches without a saved choice. An explicit saved disable remains off. Administrators manage **Enable mobile inventory** and approval actions under **Core Settings → Inventory → Mobile inventory**, then refresh the phone's connection/catalogue. Existing approval choices and role permissions are preserved.

## Implemented

- Inventory shortcut on Sell; inventory-only staff land in Inventory without receiving sales permission.
- Server item lookup including inactive stock, category and supplier records, barcode/QR search, quantity/unit/supplier details and shared stock-log history.
- Paged catalogue reads and explicit offline download. Completed downloads replace the active cache atomically; interrupted downloads retain the previous cache.
- Persistent partial-count, direct-receiving, damage and loss drafts. Counted zero differs from an item never added to a count. Quantities use thousandths, with whole-unit validation.
- Server prepare/review/confirm/status/cancel endpoints. A durable request identity and atomic per-item effect prevent duplicate stock changes after a lost reply or restart. Conflicted operations report applied and unapplied lines separately.
- Current server ACL and branch/tenant checks, including approval policy rechecking at confirmation. An unchanged count uses an atomic expected-quantity/date/revision check; a changed item requires another observation. Pending sales on this phone block count confirmation.
- Direct confirmation by default. Administrators can require approval for selected actions under Core Settings → Inventory → Mobile inventory. Owners/admins approve in Inventory → Stock Counts or in the phone's operation history.
- Stock changes update the existing item balance and stocklogs; the normal POS sync transports these records. Operation journals remain on the issuing server and are never replayed against a different server.
- Mobile labels and messages in all 18 app languages (beta translations; native-speaker review remains necessary).

## Boundaries still requiring work

This is a pilot candidate, not the full roadmap. Purchase-order-linked receipts, carton conversion, product/photo creation, low-stock/expiry action lists, scheduled/full-branch counts, manager recount assignments and large-catalogue performance measurements are not implemented in this increment. Desktop additions currently use English fallback labels. Real Android/iPhone and hardware validation have not been performed.

Offline stock observations remain drafts. They do not modify a separate phone stock balance. Confirmation must reach the original server. The current stock system does not provide a global barrier proving that every other offline till has uploaded its sales; do not conduct final physical reconciliation while another till has outstanding offline activity. Cross-server concurrent stock reconciliation remains a core-sync limitation, not an app failover feature.

Operations accept at most 200 lines and reject excess explicitly; larger work must be split. Never clear app data with unsubmitted observations or ambiguous requests. Before reopening a frozen draft, the app cancels its original request identity on the server. A cancellation tombstone prevents a delayed submission from later applying that abandoned draft. If some lines applied, preserve that operation and recount only unresolved items.

## Verification

Local tests use a disposable MongoDB database, never production shop stock:

- API: `node --test api/tests/mobile-inventory.integration.cjs api/tests/mobile-pos.integration.cjs` (set `MONGOMS_SYSTEM_BINARY` when using an existing test mongod).
- Core sync classification: `node --test tests/sync-classification.test.js`.
- Mobile: `npm run check`, web export and Playwright tests including receiving/review/confirm and saved zero counts across restart.

Device acceptance still needs: offline count/restart, reconnect, interrupted confirmation, actual cashier/admin roles, branch isolation, fractional quantities, camera permission recovery and the installed desktop's sync behavior.

## Settings rollout and synchronization

The policy remains `branches.inventory_policy`, scoped to the selected licensed branch. Saving it updates `updated_date`; POS and Gateway classify branches as global tenant data, and the sync agent carries branches on its existing batch lane. No new collection or transport is introduced. Saved true/false and approval choices travel with the branch; unset is interpreted consistently by bootstrap, inventory access, policy reads and the branch model after this update. Operation journals remain local to their issuing server.

Deploy the POS API and frontend together, then update connected tills to the same implementation. Refresh the mobile snapshot after changing policy. The menu is a server/web change and does not require a new APK. Mixed-version servers may interpret an unset policy differently until upgraded; saving an explicit choice avoids that ambiguity. Live cloud-to-till and other-till delivery is not verified by the local API tests.
