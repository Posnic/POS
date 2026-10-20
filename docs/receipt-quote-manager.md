# Receipt quote manager

Receipt designer > Receipt quotes owns these settings. Choose Off, Thirukkural,
or My quotes. Manage my quotes opens a transactional popup with numbered,
multiline rows; add, remove and reorder entries, then Apply quotes. Cancel or
Escape discards the popup draft. Save designs persists the complete design.
Up to 200 custom quotes, each up to 600 characters, are supported.

Both libraries support Random, In bill-number order, and Use a specific number.
Random is deterministic for a bill identifier and may repeat. Bill-number order
uses the trailing bill number modulo the library length; gaps and independent
offline-till number sequences remain possible. Specific number keeps the selected
entry on every new bill until changed; it does not reset the bill counter.
Deleting/reordering custom entries changes their displayed numbers. A selection
past the shortened custom list is clamped when applying the manager draft.

## Storage and synchronization

`branches.receipt_designs.quoteFooter` holds source, order, quotes, optional
selectedNumber, showQr and qrSizeMm. Existing quotes arrays need no migration.
The authenticated settings endpoint normalizes the design, updates only the
context branch and license, and advances updated_date. The settings return path
and branch schema preserve the complete design. The sale writer selects a quote
and persists receipt_quote; retries/reprints retain that snapshot, including a
legacy null snapshot. Editing or removing a library entry never deletes bills.

No new collection or lane is introduced. POS api/src/sync/collections.json,
Gateway apps/sync-gateway/src/collections.js and agent
apps/sync-agent/sync-config.json already carry branches (tenant-global, batch)
and sales (branch, realtime). The quote array and selectedNumber travel inside
the existing branch document with its stable identifier and watermark; removals
replace the array rather than introducing individually synchronized quote IDs.
There is no external image reference for custom quotes. Kurals and QR images
are available from the bundled library offline.

An offline till keeps its last synchronized settings and its own bill-number
sequence until reconnection. Concurrent changes follow the existing branch
record conflict policy; this feature does not merge independently edited quote
lists. Avoid editing the same branch's quote list on disconnected tills.

## Rollout and verification

Deploy the API before the frontend because older API normalization rejects the
new explicit fixed mode. Desktop uses the same API/helper/editor sources, but
needs an updated application distribution to obtain these changes. No installer
was built for this change. Existing sequential/random policies remain compatible.

Local tests cover draft cancellation, multiline editing, reorder/remove, range
validation, undo, save/reload, settings write watermark, fixed Kural/QR preview,
and saved-sale snapshot stability. Desktop/mobile Chrome popup rendering and
frontend asset build were checked. Existing Gateway/agent manifests were reviewed;
no transport changes are needed. Actual cloud-to-till, till-to-cloud and second-till
reconnect/conflict delivery and installed agent versions have not been verified
on live devices. These local tests do not establish deployed multi-device delivery.

CI follow-up: the legacy Captain retry path can read a claim snapshot before
another copy of the same request commits its order. The occupancy refusal now
re-reads that request's claim, requiring the same actor and payload before
returning it. No stored fields, scopes or transport lanes change. A deterministic
interleaving regression fails on the old implementation and passes on this fix;
the existing competing-request test still requires a single winner.

### Integration with current develop, 20 October 2026

The develop integration retains the released room-service charge and its tax
breakdown on bills and receipts. Room cards keep their room icon, blue double-line
heading and separate venue. Room entry retains autofocus, optional guest buttons,
the single-venue text display and explicit Next. As subsequently requested by the
owner, a configured enabled room charge starts checked and staff can remove it;
this supersedes the earlier unchecked-default description. Missing guest counts
are omitted from order headings instead of displaying zero guests.

Receipt column sizing and fixed quote selection remain in this change. Translation
keys are merged by identity so wording-profile labels and receipt/parcel labels
coexist. The bundled QR encoder emits its fixed Kanji range literally; output is
compared with the locked upstream encoder for multilingual and escaped inputs.
This integration adds no fields, collections or synchronization lanes and does not
implement the separately documented tax-report source adapters.
