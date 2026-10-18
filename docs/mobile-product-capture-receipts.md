# Mobile product creation and shared receipts

Product creation uses existing item read/write permissions and Mobile POS access.
The authenticated API supplies branch categories, suppliers, taxes and units.
Barcode lookup includes hidden primary/alternate matches; creation refuses an
existing barcode. No external product database is assumed.

Opening stock is optional and written in the initial canonical item insert.
A request ID binds the full payload and staff/shop/branch scope. Replays return
the same product without resetting later stock movements. A deterministic
stocklogs entry is recovered after an interrupted save. Photo files use the
existing content-addressed image store. Mobile obtains a fresh signed catalogue
before the new item can enter a sale. Offline creation remains a local draft.

Receipt bootstrap data contains normalized receipt designs, printable branch
fields and local embedded logos only. Malformed legacy designs do not prevent
sign-in. Missing external assets are reported. Mobile/till print jobs carry the
normal desktop receipt document and are explicitly marked settled, including the
actual payment method. Direct Android printing renders the cached 58/80 mm layout
into PDF/raster ESC/POS; transport submission is not paper confirmation.

Sync and rollout
----------------
- items and stocklogs already use branch-scoped POS/Gateway/agent lanes.
- branches already carry receipt_designs through the shared configuration lane.
- Product photos and branch logos use the file lane, separately from documents.
  The matching Gateway/agent patch rotates bounded pages rather than permanently
  ignoring products after the first 2,000 or files after the first 200.
- Product request metadata belongs to the canonical item; repeating the same
  opening write never increments stock. No payment/print commands are replicated.
- Phone drafts are local and scoped to server/shop/branch/staff. Users explicitly
  review and submit them. Wi-Fi/Internet changes remain manual.
- Deploy the API and Gateway, publish the matching agent update, then release
  Mobile beta.30. Local community servers need the updated POS API too.

Local checks
------------
Mobile: 131 unit tests, 69 browser tests, TypeScript and formatting checks.
API: product concurrency, crash recovery, alternate/hidden duplicates, scope,
permissions, decimal/zero opening, references, receipt-profile validation and an
HTTP create -> fresh catalogue -> sell -> retry -> print-job integration test.
Existing mobile inventory tests pass (20). All 28 mobile-pos integration cases
also pass with MOBILE_FULL_APP, the actual web build and Playwright enabled,
including real login, optional PIN, offline cash sale/reconnect and cloud authorization.
Eight focused product/receipt integration cases pass separately.
Gateway: real temporary MongoDB and local HTTP/file transfers exercise large
catalogues, alternate images, cloud/till/other-till transfer and tenant refusal.
Physical Bluetooth/USB printers and iPhone system printing require device tests.
No customer data was used or changed by these tests.
