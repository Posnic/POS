# Thirukkural receipt QR and static library

Receipt designer → Receipt quotes → Thirukkural → Small QR. The checkbox defaults
off and is meaningful for Thirukkural only. New sales snapshot the selected verse,
number, 22 mm QR PNG and `https://www.posnic.com/tools/thirukural/<number>` URL.
No sale, customer or tenant identifier is in that URL. Reprints use the snapshot.
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

Sync: `branches.receipt_designs.quoteFooter.showQr` uses the existing branch settings
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
