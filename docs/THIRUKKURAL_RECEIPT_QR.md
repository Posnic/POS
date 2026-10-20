# Thirukkural receipt QR and static library

Receipt designer → Receipt quotes → Thirukkural → Small QR. The checkbox defaults
off and is meaningful for Thirukkural only. New sales snapshot the selected verse,
number, QR PNG and `https://www.posnic.com/tools/thirukural/<number>` URL.
QR display size is a branch receipt-design setting: 18, 22 (default), or 26 mm.
The verse number and QR caption are omitted from printed output. No sale, customer or tenant identifier is in that URL. Reprints use the snapshot.
58 mm paper stacks the QR below the verse to preserve readability; wider formats
place it beside the verse. Thermal scan reliability still needs a physical check.

Saving Thirukkural settings attempts to download the static reviewed 5 MB JSON from
Posnic. A fixed HTTPS URL, no redirects, 12-second timeout, 8 MB limit, pinned SHA256,
1,330-item validation and exact bundled verse/QR comparison protect installation.
An atomic file replacement stores the verified edition in the operating-system
user's Posnic/public-content directory. Failed downloads preserve prior files and
return a bundled-offline warning. New offline tills can use the bundled verses and
QR images without waiting for the website. Downloaded commentary is not put in each
shop database. Public website content is authoritative and versioned; installing an
unreviewed edition is deliberately rejected. Updates need a reviewed application release.

Sync: `branches.receipt_designs.quoteFooter.showQr` and `quoteFooter.qrSizeMm` uses the existing branch settings
lane; `sales.receipt_quote` uses the existing sales branch lane. The immutable quote
and embedded PNG travel together, so other tills do not need network access to reprint.
No payments, counters or print jobs are replayed. The public file cache is local-only,
reconstructible and independent of shop tenancy. Existing Gateway/agent manifests
already cover branches and sales. Roll out updated API/frontend to all authoring tills.

Local checks cover every QR pixel matrix against its numbered target; opt-out;
snapshot stability; malformed download/cache preservation; valid download and offline
cache reuse; all receipt formats; actual local Gateway/agent transport between tills.
Live installed-agent delivery, publication, physical scanning and scholarly text
collation remain separate checks. No installer was generated for this change.

## Receipt layout follow-up, 2026-10-19

Quote and document/footer controls now use two bounded columns, stacking on small
screens. Custom quote input is shown only for the custom library; QR controls are
shown only for Thirukkural. Saved QR display size applies to receipt presentation,
including reprints; the verse and QR payload remain immutable sale snapshots.

Validation: 80 focused tests passed (one optional downloaded-corpus test skipped),
frontend asset build passed, and real local Mongo/Gateway/agent transport verified
cloud-to-till QR size, till-to-cloud-to-other-till update and duplicate-free retry.
The test fixture now uses string licenses, matching the parked-clear API contract.
No new collection or transport configuration is required. Live installed tills
and physical thermal scanning remain unverified.

Public GET/HEAD checks on the canonical Kural 1 page return HTTP 200 with and
without www. The submitted screenshot QR could not be decoded reliably; the user
was asked for the exact scanned URL. The reported Access denied cause is not yet
established. Do not call that incident fixed merely because these URLs work now.
