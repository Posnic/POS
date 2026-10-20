# Bharat Traders fixes — 19 October 2026

Worktree: `kitchen-closed-orders`; branch: `fix/kitchen-closed-orders`.
Local work only. This report does not establish deployment, merge, installer availability,
live sync, historical-data repair or successful physical printing. Earlier kitchen and
sale-deletion changes remain in this dirty worktree and have not been discarded.

## Implemented locally

- Multi-unit counter selling: item creation/edit stores up to eight explicit conversions with
  optional prices. An empty price derives from the base price; the price is editable inline
  on the same unit row. Sales prompt for a unit only on configured products. Server-owned
  conversion snapshots preserve stock units through save/reopen/edit/delete/return. Example:
  10 ft at ₹32 = ₹320 and 3.048 m stock; returning 2 ft restores 0.6096 m and refunds ₹64.
  Legacy live-order normalization now retains the conversion. Cost totals and initial stock
  checks use base quantities. Mixed units for one product in a bill are rejected; alternate
  units on outlet/price-list/allocated-extension channels are explicitly unsupported.
- Central HSN/SAC search is implemented in `C:/Users/Kayal/web-api` and
  `C:/Users/Kayal/web-frontend`, public path `/hsn-code-search` on the existing www canonical
  host. Seven sourced starter entries cover the requested tank/pipe/biscuit searches plus
  services. A central control-DB collection, reviewed revision importer, copyable embed HTML,
  and POS iframe picker are implemented. Exact origin/window/request-ID checks protect item
  autofill. Tax rates are never automatically replaced. The catalogue is not yet published
  or a comprehensive/current legal master; see web-api `docs/HSN_SEARCH.md` for rollout.

- Parked sales: replace the delayed payment checkbox mutation with state set after loading;
  send literal API action values independent of UI language; honour auto-print on completion,
  including persisted `"true"` checkbox values. A Clear all parked sales button now asks for
  confirmation and removes all current-branch holds from parked/recent retrieval lists,
  including beyond the 20-row page. It requires sales write access and no hard-delete switch.
  It does not delete sale records, change stock, or void payments.
- Parked price edits: allow an authenticated price-override user to change an unpaid parked
  counter price while retaining the stored tax snapshot. Paid, venue, outlet and price-list
  restrictions remain. This is a reproduced failure, not proof of the exact older pipe-sale
  screenshot's cause.
- Receipt designer: optional separate Unit column, editable serial-number label, optional
  extra document heading with a blank default. Canonical print lines retain their unit.
- Cart actions: no-wrap selector now targets the actual new-sale table, with space for both
  48px controls. Tax label and amount use an internal flex row. Visual 1600×900 QA pending.
- Receipt quotes: optional Thirukkural or custom library; up to 200 custom entries with blank
  lines separating entries and multiline text within each entry. Original Tamil corpus has
  all 1,330 numbered couplets. Settings are in receipt designs, default off.
  The standard sale service saves selected text/source/version on new sales, ignores a client
  supplied quote and preserves existing bills' snapshot (including no quote). Receipt payload
  and renderer use the saved text, escaped as text, independent of later settings changes.
  Sequential selection follows the existing bill-number suffix and wraps; it is not a global
  gapless quote counter. Random selection is deterministic per bill number for retry stability.
  Sample preview shows the first verse/entry without consuming a sequence. The
  primary customer/staff order creation also allocates a saved quote; other direct insert
  paths have not been audited end to end.

## Verification

Latest additional checks: 192 sale/pricing/unit API tests; 509 model/controller/repository/
clear-parked tests; 162 kitchen-order/repository checks; 5 actual Mongo return integration
tests; 4 actual Mongo item create/update tests; 90 receipt/quote/parked/item UI tests;
18 sync-classification/sales-call/quantity tests; 2 unit-picker tests; 1 iframe-security
test; and 3 central HSN Mongo/HTTP tests pass. Counts overlap between targeted suites and
are not a unique grand total. Public website artifact build succeeds (14,918 HTML pages).

- 185 API tests pass: sale service and pricing authority, including server-selected quote
  and a fresh inclusive Quick Sale at the entered total without override permission.
- 85 Node tests pass: receipts, quote corpus/selection, parked actions, sales call paths and
  sync classification. The classification suite reports 19 pre-existing undecided collections.
- Syntax checks and `git diff --check` pass.
- Tamil physical printer output and rendering at the user's display scaling remain unverified.

## Source and synchronization review

Clear parked uses one immutable `settings` record per sale, with stable ID
`parked-clear:<sale ObjectId>`, kind `parked_sale_clearance`, authenticated branch/license,
actor and timestamps. No financial sale document is updated. The already-configured
settings global lane carries these markers; reads enforce sale ID and license. Branch IDs
remain on markers for device ACLs. Two devices clearing the same sale produce the same ID;
last-writer selection may change actor metadata but either record has the same clear effect.
No tombstone or new lane is needed: clearing is a marker insert, not a deletion. Offline
clears affect locally known holds; unseen remote holds need clearing after they arrive.
Older clients ignore this UI policy until their API is updated. Actual installed-agent
versions and live reconnect/multi-till delivery remain unverified. Ship updated API/frontend
together. Tests cover confirmation/cancel, failures/retry, >20 drafts, tenant/branch isolation,
repeated clear, keeping sales byte-for-byte unchanged, and filtering before page limits.
The targeted run passes 365 API tests plus 7 frontend/call-path tests.

Corpus: `api/src/data/thirukkural/NOTICE.txt` records source URL, checksum, modifications and
licence. Only original Tamil lines are retained, not modern commentary. Structural checks
are complete; a full scholarly collation is not. The Project Madurai reference contains
numbering/typographic inconsistencies and was not silently treated as an error-free master.

Settings use existing `branches.receipt_designs` (global lane within the tenant); saved
quote uses `sales.receipt_quote` (branch lane). Reviewed API classification and
`C:/Users/Kayal/Gateway/apps/sync-gateway/src/collections.js` plus
`apps/sync-agent/sync-config.json`: both collections already travel. No new collection,
counter or lease. Normal document create/update/delete/conflict rules apply. Offline bill
sequences can overlap across tills. Reconnect and conflicting edits still need live testing.
The corpus is shipped application data, not copied into tenant databases.

Unit configuration is branch-scoped `items.selling_units`; saved sale and return lines carry
`unit_conversion`. API, Gateway and agent already include items/sales/stocklogs branch lanes.
No new POS collection or conversion replay is needed: the originating writer changes stock
once, and sync transports stored records. New sales resolve locally available catalogue
configuration; edits/returns use their saved conversion even after catalogue changes.
Older clients cannot safely originate alternate-unit sales: API/frontend must roll out
together to all tills using the feature. Conflicting offline stock edits retain the existing
sync conflict policy; this work does not establish live concurrent stock reconciliation.
The central HSN collection intentionally never syncs to individual shops. Only the chosen
item code/description use the existing item lane. Internet is required for public search;
already saved item codes work offline. Live transport and installed-agent versions remain
unverified; matching manifests and local tests do not establish live delivery.

## Additional verification on 19 October

- `api/tests/bharat-sync.integration.cjs` passes against the real local Gateway router and
  sync-agent push/pull functions with two till databases and a cloud database. It verifies
  unit configuration, immutable sale conversion/Unicode quote snapshots, parked clear
  marker delivery, branch isolation and checkpoint reset/replay without duplicate effects.
  Financial sales and stock remain unchanged when clearing parked entries. This is local
  transport evidence, not verification of the agent installed in a customer's shop.
- `npm run prepare:frontend` completed successfully (service worker build
  `86ea97712b04bfed`). No installer was generated.
- Fixed designed thermal quote printing to select bundled Unicode fonts, including Tamil,
  instead of relying on the operating system's installed fonts. The change is scoped to
  the quote footer and preserves other receipt typography. Receipt designer, Unicode and
  fast receipt suites pass: 86 tests, zero failures. Physical printer output remains unverified.
- User confirmed the reported pipe is a Quick Item. The new
  `api/tests/quick-item-checkout.integration.cjs` creates the item through the real
  repository, reads it from MongoDB and executes the real sale service/save path:
  inclusive price 70, tax 5%, no counter override permission, saved total 70 and
  `quick_item` pricing source, with untracked inventory unchanged. It passes. This
  verifies the current implementation, not the older installed build that showed the error.
- Rebuilt the central website successfully and confirmed the resulting HSN page includes
  the compact header/footer and search assets, without an injected full navigation shell.
  Publication and production framing headers are still unverified.
- Read-only inspection of the running local installation found package version
  `1.9.2-kitchen-test.20261018`. Its pricing authority includes the Quick Item price
  handling and desktop missing-value fallback, but lacks `allowParkedPriceOverride`.
  This installation has not received all current changes. Do not attribute the original
  pipe error to a missing Quick Item fix solely on this version difference. No running
  installation files were changed and no new installer was generated.

## Still open — do not call these finished

### Follow-up verification and stale-unit fix, 19 October

- Fixed a further conversion defect: removing the last alternate selling unit could
  silently reinterpret an open cart's feet quantity as metres. New checkout now rejects
  an explicitly unconfigured unit and asks for refresh. Omitted/base units still work;
  saved bill conversion snapshots remain authoritative for edits and returns.
- Added a real MongoDB checkout regression proving rejection creates no financial sale
  and leaves the item document unchanged. This is validation only: no new persisted
  field or sync lane. The existing item configuration lane and saved sale snapshots
  remain unchanged. An offline till learns removal when its catalogue synchronizes;
  it cannot reject a remote change it has not received.
- Re-ran 197 API sale/pricing/unit/parked tests and 90 Node/database/transport tests:
  all passed, no skips. Two additional parked tests exercise the actual loaded-payment
  checkbox block and print-dispatch block (six parked tests pass). These are DOM/VM
  regressions, not a full installed application journey or physical print test.
- Re-ran website generation validation for all 1,330 pages and three HSN Mongo/HTTP
  checks; all pass. `git diff --check` passes (line-ending notices only).
- No production data changed; no merge, publication, installer or live-device update
  was performed. The limitations below remain open and are not resolved by these tests.

### Thirukkural QR addition, 19 October

Implemented optional 22 mm QR next to the saved verse (stacked on 58 mm paper),
linked to the numbered public page. Receipt designer preview and persistence are
tested. Static website build generates 1,330 bilingual pages, searchable index,
credited statue photograph, versioned JSON and sitemap. Project Madurai source
headers are preserved byte-for-byte in downloadable archives. Fixed source parser
defects explicitly; complete scholarly collation remains pending.

The settings save attempts a bounded, hash-verified public JSON download; offline
fallback retains bundled verse/QR data. No catalogue is copied into tenant databases.
New QR snapshots pass the real two-till transport regression. All 1,330 QR matrices
match their exact public verse URLs. Receipt suite: 73 pass; library/sync: 5 pass;
settings controller: 256 pass; static generation and built-source hash checks pass.
See `docs/THIRUKKURAL_RECEIPT_QR.md` for scope and rollout. Not published, merged,
installed or physically scan-tested. No EXE generated.

1. Verify the reported Quick Item checkout on the customer's updated application. The
   confirmed Quick Item path now has a passing real-database creation-to-payment test;
   the exact failing installed version/request is unavailable, so its root cause is not proven.
2. Full resume/autoprint live UI journey; confirmed clear-all is implemented locally as
   list removal, as requested, rather than destruction of financial records.
3. Multi-unit live desktop/cloud/reconnect QA. Local persistence, stock and return regressions
   pass; channel restrictions above are intentional first-release limits.
4. Publish and check central HSN search's actual edge framing headers, and establish ongoing
   editorial reviews. Code and local tests are complete for the starter scope. No production
   catalogue has been seeded; do not advertise automatic freshness.
5. Fullscreen keyboard/touch POS separation remains a separate large redesign.
6. Complete Tamil source review, additional sale-creation paths, physical print and live sync QA.
7. Review/merge/deploy only after remaining work and verification; no new EXE requested.

Tax audit remains paused while these user-requested POS issues are addressed.

### Release verification update, 19 October

The earlier "not merged/published" notes above describe their checkpoints, not the
current state. POS main received the feature batch at 65f6db1c. Tenant frontend/CDN
workflows completed, but the tenant API workflow failed its post-reload smoke test;
therefore this is not a fully verified production rollout. The smoke restock helper
was selecting a deleted product while billing selected a live product with no stock.
PR #1430 aligns both fixtures and preserves the sold unit on returns. It also fixes
release inventories, translations and rejects object-valued tenant identifiers in
parked clearing before any database access. Required review is still outstanding.

The central HSN API deployed successfully at web-api 30e1bdac. A public water-tank
query returned the starter catalogue result. Website publication is still pending:
PR #98 adds the palm-leaf reader and optional reduced-motion-aware stylus reveal,
and corrects publication/sitemap inventories. All 1,330 source hashes and generated
pages pass their focused checks; full website validation remains in progress.

No customer historical records were repaired. Physical print/QR scans, installed
desktop reconnection and the exact customer Quick Item checkout remain unverified.
No new installer was manually requested for this release.
