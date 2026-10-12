# Price updates

Price Settings opens on **Edit prices**, followed by Set Margin, Custom Change and
History. The editor supports selling price, default cost and MRP. These are
independent values: editing cost does not calculate a new selling price, revalue
stock, or rewrite old purchases or sales.

## Daily editing

Search by item name or SKU, select a category, and choose 10, 25, 50 or 100 rows.
Columns are temporary for the current screen. Changed cells show their previous
value. Blank cells preserve the existing price. Drafts are stored in IndexedDB,
scoped to the origin, branch and user. Browser storage can be cleared or disabled;
the screen reports storage errors instead of claiming the draft was saved.

Review stages a server-side job; it does not change prices. Confirm applies valid
rows in batches of at most 100. Keep the screen open while processing. If the
connection or page closes, return through **Recent price sheets and resumable
updates** and resume. Processing is request-driven, not a background worker.

## Download and import

The download panel has its own visible search and category controls, a matching
count, price-field choices, and CSV/XLSX formats. It exports all matching pages,
up to 100,000 items. The sheet includes branch and stable item IDs, current values
and blank New columns. Screen-column visibility does not remove required IDs.

Only edit the New columns. Upload the sheet (maximum 10 MB) and review its results.
Blanks always preserve existing values. Explicit zeros are skipped unless the
user selects the zero-price option. No new products are created by this workflow.
Duplicate item IDs, invalid numbers, unavailable items and stale current prices
are identified before application. Invalid rows require explicit consent to skip.
Results can be filtered, paged and downloaded as a CSV report.

Upload/validation interruptions never apply prices. An incomplete upload is kept
as a draft job; upload the complete sheet again to a new job. Application retries
use persisted row results and atomic item receipts to avoid repeating writes.
Concurrent price changes are held as conflicts rather than overwritten. The
server rechecks prices at application time, including after review.

## Access and audit

Read/export uses the existing item-read permission. Staging, importing and
applying use item-write permission. There is no separate cost-specific permission
in this module; cost editing follows the existing item-write authority used by
Custom Change. Every request is scoped to the current tenant database, license
and branch. Job IDs do not grant access to another branch.

Each changed field records old/new values in price_history. A completed job adds
a bulk_price_updates summary. New job/row collections are internal workflow
records; they are not inventory movements. Existing item sync carries the actual
price changes. An update shown as completed confirms this server's write, not
that every offline till has received it.

## Local verification

Run `node --test tests/price-editor.test.js` from the root and
`node --test tests/price-sheet.integration.cjs` from api. The latter uses an
isolated MongoDB instance, including a 10,000-item application/audit test,
conflict handling, lost acknowledgement recovery and spreadsheet round trips.
