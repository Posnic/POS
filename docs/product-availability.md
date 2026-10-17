# Product availability and duplicate-barcode review

## Behaviour

Inventory → Find stock → scan, or Review product availability. Exact scans include primary and alternate barcode matches, including hidden products. Compare product, image, SKU, barcode, tax-inclusive selling price, stock and supplier. Switch Available for sale on individual records, review the explicit changes, then confirm. There is no automatic winner, merge, deletion, stock adjustment or historical-sale rewrite.

Desktop: Items → Product availability uses the same authenticated API and review. Existing item read/write permissions apply; mobile also honours the existing mobile inventory setting. No manager-approval workflow was added.

`items.available_for_sale` is independent from deletion, item type, menu visibility, channel restrictions and legacy active flags. Missing means available; no backfill disables existing products. Other existing sales restrictions remain effective. Admin/inventory records remain available when hidden.

## Delivery and conflicts

`POST /mobile/v1/inventory/availability` accepts a stable request ID and explicit itemId, available, revision changes (maximum 100). Server scope is authenticated tenant+branch; mobile also binds shop/staff. Each item uses compare-and-set revision and an atomic audit entry containing request ID, actor, timestamp, previous and new values. Individual conflicts are returned; a lost response can retry the same ID without repeating a change.

Selections/review are not applied. Sending is shown as awaiting confirmation. Transport errors say not confirmed, rather than claiming success. Availability changes require connection; they are not silently queued offline. Confirmed hides invalidate the local sales index immediately. Restores become sellable after a fresh signed catalogue sync. Inventory caches retain confirmed results.

Desktop sales polls availability while its sales screen is visible (15 seconds and window focus), clears its item/shelf cache on revision change, and refreshes the shelf. Sales search/scan endpoints filter hidden records. A hidden product cannot be added through cached item details. Checkout validation rejects a hidden product in a new basket with an explanation; it does not remove or alter lines. Existing saved historical order/receipt pricing remains intact. Mobile checkout likewise preserves the basket and asks the user to remove or restore a newly hidden item.

Offline tills cannot learn a hide until reconnecting. Already-paid offline mobile sales remain valid against their signed historical catalogue grant and synchronize normally; rejecting these would lose legitimate payment/history. This is not an instantaneous fleet-wide recall.

## Sync design and rollout

Items are already tenant/branch-scoped in all three manifests: POS api/src/sync/collections.json; Gateway apps/sync-gateway/src/collections.js; sync-agent sync-config.json. The existing batch lane carries the complete item (availability and audit included), so no collection/lane was added. Product IDs and image references stay unchanged; existing file sync is unchanged.

Gateway and agent merge availability audit independently from whole-document last-write-wins stock/price updates. Event timestamps and IDs determine a consistent winner; audit events are retained, and an older incoming document with a previously unseen availability event advances the delivery checkpoint timestamp. Compare-and-set protects concurrent edits on one server. Independent offline servers reconcile deterministically after reconnect; their users cannot see remote edits before then.

Roll out the matching Gateway merger and signed sync-agent component, POS API/desktop (bundling that agent), then Mobile App. Old whole-document sync agents can still overwrite availability, so do not advertise the feature as deployed before the coordinated rollout. The local prepare-sync-agent check passed with the modified source and all 27 promised collections. Gateway PR #45 is merged and deployed; signed sync-agent 1.7.4 is published on the beta channel. Mobile beta 26 and the coordinated POS test installer are being prepared. Public installers acquire the private agent after activation through the signed component feed.

## Verification

Local automated checks: mobile TypeScript + 123 unit tests; 59 browser tests including duplicate review/hide/restore; POS mobile API/inventory suites (42 passed, 5 existing environment-dependent skips); 23 real-Mongo barcode tests including desktop scan/hide/restore; 9 desktop DOM/barcode chooser tests; gateway/agent real-Mongo reconnect test. Assertions cover different prices, alternate barcodes, unchanged stock, audit idempotency, stale revisions, item permissions, retained baskets and native SQLite hidden/restore lookup.

No client production records changed and no client messages sent. Physical-device, packaged-installer and deployed multi-till acceptance are pending. Mobile availability copy is included in all 18 supported languages. Desktop language packs include the new keys; automated translations remain subject to native-speaker review.
