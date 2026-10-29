# Bharat units, locations and desktop regression evidence

## Implemented

- Alternate selling units have stable cart line identities. A sale can contain metres, feet and full lengths of the same product; stock uses the saved base-unit conversion. Explicit full-length prices are independent of the metre price. Full-length units can require integer quantities. Returns restore the original converted quantity and proportional recorded cost; retrying a return does not restore stock twice.
- Editing an alternate-unit sale price cannot overwrite the item's base-unit price. Configure persistent alternate prices in the item editor. Existing customer/outlet price-list combinations with alternate units remain explicitly unsupported by the API.
- Stock locations are optional branch-item labels, up to twelve rack/shelf/box paths. They can be edited under Stock & pricing, read in item details and sales suggestions, and searched from inventory/sales. Empty locations preserve existing behavior. This is a finder, not separate quantities per rack.
- Mobile receives the locations in its authenticated catalogue, shows them with items and searches cached labels offline. Clearing labels removes them from search after refresh.
- Hidden session-timeout markup no longer suppresses shortcuts. Legacy desktop key events now resolve function keys.

## Access and sync

Item edits use existing item write permission; inventory lookup uses item read permission; selling lookup uses the existing authorized sales catalogue. No new public endpoint or permission bypass was added. Locations belong to the item branch. The existing items lane in POS, Gateway and bundled agent carries both selling_units and stock_locations, including empty arrays. No new collection or lane is needed. Mongo integration exercises till A to cloud to till B, foreign-branch exclusion, cloud clearing back to both tills, and no stock movement replay. Offline mobile uses the existing catalogue JSON cache; new catalogue versions replace its values. Rollout: API and desktop, then mobile application update/catalogue refresh. Existing Gateway protocol is sufficient.

## Verified locally

- API unit suites: 427 passing (sale service, selling units, item repository, WhatsApp service).
- Combined integration/regression run: 45 passing (returns, Gateway/till sync, mobile inventory, location validation, unit picker, shortcuts).
- Item editor browser test: loading/editing/saving locations passes. Layout checked at 1366px and 390px without horizontal overflow.
- Mobile independent branch: type checking and full test suite pass; offline SQLite rack lookup and clearing covered.
- Translation coverage: all used UI and server keys translated.
- Disposable desktop beta: Ctrl+1, Ctrl+2, F4 parking and clearing one parked demo sale verified after applying source-equivalent fixes to the extracted test build.
- WhatsApp runtime: current resolver found installed Chrome and WhatsApp Web generated a QR code. No phone linked and no message sent by that startup test.

## Remaining release verification

The above is implementation/local evidence, not a production release claim. A fresh desktop package must be checked, then a phone must be linked to verify WhatsApp message receipt. Mobile still needs a device build and physical-device confirmation. The broad item-create visual test has an existing theme-color assertion mismatch (#506fe4 versus #0963e8); the focused location layout and edit/save tests pass. No live customer sale was created or deleted.
