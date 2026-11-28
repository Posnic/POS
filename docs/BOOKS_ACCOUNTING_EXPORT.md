# Books accounting export (recovery implementation)

Status: selected-value serializer and read-only versioned HTTP routes implemented; real installed-POS integration and immutable payment capture remain pending. Existing POS write behavior is unchanged.

The `posnic.sale-source.v1` snapshot carries a typed source identity, explicit customer-reference identities and selected stored values. JSON field order is fixed by the allowlist; SHA-256 covers the exact source JSON. A string that resembles an ObjectId remains a string. Unknown top-level and nested fields are excluded. Invalid or unsupported selected values fail explicitly. The serializer does not fill missing currency, invent payment IDs, recalculate money or describe mutable records as immutable events.

Books verifies this envelope before it archives a source. A source revision proves selected values match that snapshot; it does not prove that a receipt was accepted or that the sale may be posted. Ordinary payment arrays lack durable event evidence and remain held for review. Immutable sale/return/payment capture and subsequent accounting-posting support remain separate unfinished requirements.

## Data and synchronization

This component reads the authorized installation's existing sale document. It writes no business collection, field, command journal, sync checkpoint or file. Existing sales replication is unchanged; no new Gateway/agent lane is introduced by the serializer. The origin till, another till and web installation can each expose only their locally available synchronized sale state. Different revisions after offline edits/reconnect must trigger Books review rather than replaying payments. End-to-end sync convergence and the future endpoint's tenant/branch isolation have not yet been verified. No deployment or live-client readiness is claimed.

## Verification

`node --test api/tests/accounting-source.test.cjs`: four checks for value preservation, deterministic revisions, typed source/customer IDs, private-field exclusion, tenant mismatch and unsupported shapes. The Books checkout's opt-in `pos-export-contract.test.js`, run with `BOOKS_TEST_POS_CHECKOUT` pointing at this checkout, verifies exact totals, customer identity, revision changes and review holds for missing currency/ordinary payment history. No customer data or installed POS was used.

## HTTP browse and scope

`GET /api/v1/accounting/sales` accepts only `limit` (1–25, default 25) and `cursor`. `GET /api/v1/accounting/sales/{kind}/{id}` distinguishes `objectId` from `string`. Both run behind the existing v1 protect/rate middleware and require sales read access plus a valid license/branch scope. Invalid branch selectors fail closed. Branch filtering follows existing v1 behavior, including legacy unassigned records. Query criteria and cursors never supply authorization. Every query reapplies the principal's scope; the cursor carries only a scope digest and typed position, not credentials.

The browse orders ObjectIds then string IDs, with binary identity ordering and a scope-bound cursor. It is a live browse, not an immutable collection snapshot or incremental change feed: concurrent inserts before the cursor require a fresh browse. Item refetch/revision checks detect changes to selected values. Unsupported ID types or unrepresentable evidence fail with 422 instead of silently producing usable accounting evidence. Responses are no-store and capped at 4 MiB. No mutation method is added. Public OpenAPI includes the routes and limitations.

Additional verification: Books' opt-in `pos-export-http.integration.js` runs these actual v1 routes with real MongoDB and actual token mint/resolve/revoke functions. Its test adapter supplies the disposable tenant database; it is not a full production protect/tenant-selection test. It covers mixed-ID pagination, same-looking IDs, scope-changing cursor refusal, inaccessible items, malformed branch scope, revoked/missing permissions, unsupported IDs, source mutation, long Unicode IDs, public spec and the existing sales read route. All pass. Books' cursor budget increases to 2048 characters to preserve the supported 256-character Unicode identity range. No user data was read. Existing full Jest v1 suite has not been run in this isolated checkout; local attribution checks pass.

## Full protect/tenant-context correction

A real HTTP test using `protect`, `attachDb` and request-scoped tenant context reproduced a 403 for a correctly minted scoped token: branch validation searched `users` with the token row's ID. Validation now rechecks the active `api_tokens` grant only when both the server-set scoped-token request marker and token principal marker are present. The branch must exist for the license and be in the stored token grant (an explicitly empty branch array keeps the existing all-branches token semantics). Normal user/API-key/JWT branch validation still queries `users`. No saved token, user field, sync lane or financial record is changed; the fix reads existing local credential grants and restores the intended scoped-token behavior across protected routes.

The same test exposed BSON license IDs reaching the export route. The route now scopes to canonical BSON/string representations of the authenticated license; exported license text stays compatible with Books. It never accepts a query-supplied license. Source identity remains typed, including string IDs that look like ObjectIds.

The real-protect integration passes with two disposable Mongo databases, branch overrides, legacy/BSON sale licenses, concurrent shop requests, cross-shop tokens and revocation. The test host chooses the two tenant contexts; production shard routing and installed POS still require acceptance. All 82 existing tests across seven v1/token/auth/tenant suites pass; three additional scoped-principal unit regressions pass; the four serializer checks and attribution check pass. API dependencies were installed from the existing lockfile with lifecycle scripts disabled. The generated `.connector-npm-cache` remains because automatic approval review rejected both cleanup attempts with `blocked by policy`; it is not source or a release artifact.

### Recovered connector compatibility — 28 November

The existing v1 list cursor now preserves string versus ObjectId identity with
`str:`/`oid:` prefixes inside its opaque base64url value. Date-first ordering is
unchanged; a string boundary includes later ObjectIds at the same timestamp.
Old untyped cursors remain accepted with their original string comparison
semantics. Restart an old traversal to obtain typed cursors; historical cursors
cannot distinguish a string key from an ObjectId with the same spelling.

Accounting exports exclude charge labels and payment references. Embedded
customer contacts become an explicit unsupported marker rather than leaking
contact details or preventing review of the remaining sale evidence.

Verification: 43 existing/relevant Jest unit tests, five exporter tests, and four
Books cross-repository contract/HTTP/auth integration tests passed, including the
full desktop/cloud connector contract with 27 scoped sales. Disposable databases
were removed by the owned runner. Installed POS and live sync remain unverified.
No persisted business fields or sync lanes changed; no release was built.

### Stored invoice payment balances

Export `partial_balance` and `payment_status` verbatim alongside `paid_amount`.
The ordinary invoice payment service writes `partial_balance`, not `paid_amount`;
omitting it hid saved evidence and could miss a revision change. Books compares
present balance aliases and refuses conflicting amounts. Neither a paid label nor
a reconciled cumulative balance is an immutable receipt. These are existing sale
fields on the existing sales lane; no write path or stored schema changed.

### Ordinary receipt capture recovery plan (not implemented)

The source audit found these distinct paths:

- `services/invoice-sync.js::recordPayment`: separate customer money-in insert,
  sale allocation insert/update, sale balance write, customer balance write,
  invoice note and mirror. There is no command identity or atomic admission
  spanning those effects in this checkout. A retry after a partial write can
  duplicate effects; current tests mock individual operations.
- `services/sale.service.js::processSalePayment`: appends a mutable payment and
  saves the sale. This is different from the invoice service and must not be
  mistaken for coverage of ordinary invoice receipts.
- `repositories/sale.repository.js`: customer settlement changes wallet allocation;
  existing credit consumption must not create another cash receipt.
- Captain allocations, payment corrections and return refund records have other
  identities and recovery paths. Their source snapshots remain review evidence,
  not permission to repost their financial effects.

Implementation order: define a versioned command with caller-retained identity,
original typed sale/invoice/customer identities, original revision and exact
amount/currency; reserve the affected sale and customer before accepting money;
store immutable accepted evidence on the executing installation; apply and verify
idempotent sale/ledger/invoice projections; expose authenticated recovery and stop
states; release admission only after all effects are verified. Existing invoice,
wallet, edit, delete, return and correction paths must honor the same admission
before enabling a new command route. Preserve existing printed invoice totals.

Sync review: `sales` is branch-scoped in `api/src/sync/collections.json`, while
`transaction` and `payment` are currently excluded as unknown to the cloud.
That exclusion is a gap, not approval for a new financial feature. Execution
journals must stay with the accepting installation; a separately scoped immutable
read view or authoritative retrieval is needed for Books/cloud/other tills. Check
Gateway and the actually installed agent before deciding the transport. Do not
replicate commands to replay money on another installation.

Acceptance must inject failure after each effect and test same-command retries,
changed payload refusal, concurrent invoice/wallet collection, customer edits,
original-source mutation, branch/tenant separation, disconnect/reconnect, and
origin/cloud/other-till visibility. Run existing POS workflows and installed
POS plus Books together. Do not enable posting from the current snapshot export.

### Receipt command journal foundation

`services/receipt-command-journal.js` implements internal request persistence in
`books_receipt_commands`. It is deliberately not mounted or called by payment
services. Exact versioned inputs bind request/review IDs, typed sale/invoice/
customer references, original revision, AED minor amount and method. Journal keys
bind installation, tenant and branch; a same-spelling string/ObjectId is distinct.
Prepared commands can atomically accept or stop. Accepted commands can retain one
verified completion result. Repeated identical requests return stored evidence;
changed commands/results and invalid state changes are refused. No expiry removes
accepted work, no TTL discards deduplication evidence, and no financial projection
is performed by this module.

The future coordinator must reserve all affected writers before calling accept,
and verify all projections before complete. This helper does not enforce those
cross-document preconditions itself and must not be exposed directly as an API.
Source adoption, journal backup/recovery, UI, transport and coordinator integration
are still required. The collection is classified local-only because execution
belongs to the accepting installation. Shared immutable receipt reads remain a
separate requirement. More precisely, the existing `transaction` and `payment`
collections are in the manifest's **undecided** section, not an accepted local-only
design; the classification test explicitly reports this existing gap.

Real-Mongo Books opt-in integration verifies concurrent same/changed prepares,
accept/stop races, stopped terminal replay, missing request refusal, immutable
completion recovery, typed tenant/branch/installation separation, corrupted request
refusal, and absence of sale/transaction writes. It re-creates the service over the
same database; this is not a process-kill or installed recovery test. Five sync
classification tests pass. Full money movement remains disabled/unimplemented.

### Authenticated receipt identity recovery

Restored internal `books-receipt-runtime`, `books-receipt-context` and connector
settings authorization boundaries against the retained Books tests. Authority is
a once-attached host capability held in a WeakMap, never app.locals, request data
or a database copy. Every lookup rechecks valid protected identity and restart
state, with sanitized provider errors. Context requires matching typed tenant
license, authorized branch and explicit human `sale` permission; integration
tokens may only read with `sales.read`. Connector settings require branch write
permission and reject integration tokens.

The command journal now requires a trusted actor at construction and preserves
its original name and typed ID. Another actor can read a scoped record through
this internal helper but cannot prepare/reuse, accept, stop or complete it. A
later display-name correction for the same ID preserves the original evidence.
The route layer must still authenticate and authorize every read. No host
capability producer, routes, settings writes or financial coordinator is mounted.

Seven retained identity tests and the expanded real-Mongo command-journal test
pass. Original tests were redirected through BOOKS_TEST_POS_CHECKOUT; their
assertions remain intact. No business write or sync transport changed. Existing
full `pos-receipt-journal.integration.js` still needs the missing original journal
and projection coordinator and is not claimed passing.

### Restored per-sale sequence journal

`books-receipt-journal.js` restores the original coordinator-facing journal API:
prepare, accept, stop, outcome and projected. One standalone-Mongo document owns
the sale's sequence. Compare-and-swap on its revision prevents competing requests
from admitting another receipt while work is prepared/accepted. A next collection
requires the prior verified projected revision and exact balances. Reviews retain
typed scope, original source balances, cashier and request; accepted receipts
retain their UTC acceptance time, deterministic ID and exact resulting balances.
History validation checks review hashes, amounts, receipt derivation, active
command and transition-derived revision. Prepared requests can stop; accepted
money cannot be stopped or silently replaced.

The dedicated Books sequence test retains the journal-only portion of the
original full recovery test and adds a committed-but-lost acceptance reply. It
runs actual standalone MongoDB, not replica-set transactions. Original full test
is untouched and still requires the missing sale/invoice/customer coordinator.
Nine receipt/identity tests and five sync classification tests pass. No financial
writes, API enablement or installed-device acceptance is implied.

Use this per-sale API for the restored original coordinator. The earlier isolated
`receipt-command-journal` primitive is not the per-sale admission authority and
must not be wired as a parallel payment path. Consolidate it after its remaining
negative cases are covered by the restored coordinator. Both collections remain
local-only execution state. The sequence has an explicit 500-command review limit;
scalable archival and backup remain requirements, not implemented behavior.

### Sale reservation and projection component

`books-receipt-sale` now prepares original AED invoice-sale evidence, reserves a
reviewed sale, accepts through the journal, and applies an accepted receipt once.
Whole-document atomic predicates prevent overwriting a concurrent change. Sorted
canonical BSON evidence (excluding only the reservation itself) detects changes
outside the accounting export and survives Mongo field-order changes. Acceptance
and application verify original evidence; retries verify the stored applied
revision/digest. The original cashier is required, and known correction/refund/
Captain edit holds block admission.

The sale update preserves its total and original paid_amount, updates cumulative
partial_balance/pending/status, and adds customer-linked wallet consumption once.
It retains the reservation after application. Stopped unaccepted requests release
without money changes, including reserve/stop races. Finalization is intentionally
not implemented until customer/invoice effects can be verified.

Two standalone-Mongo suites pass sequence/race/recovery and sale reservation/
application, including a committed-but-lost sale reply and unexported-field
changes. Five sync classification tests pass. This component is unmounted; normal
POS writers do not yet all honor its `unreserved` predicate. Never enable it before
that integration. The new `books_receipt_lock` is authority-local execution state
embedded in a normally synced sale. Gateway/agent field handling and cross-device
admission must be resolved before rollout; the existing sales lane alone is not
approval to propagate a lock or replay its effects. No transport was changed or
verified here. Customer admission, durable customer/invoice effects, source
originals beyond the current export, backup and installed acceptance remain open.

### Invoice receipt projection component

`books-receipt-invoice` projects an accepted, already-applied sale receipt into
its original typed invoice. Sale reservation now retains the original invoice
identity, and `verifyApplied` validates the complete applied sale before any
invoice write. An authorized recovery caller can replay deterministic projections;
the note retains the original cashier, accepted time, amount, method and reference.
Printed invoice totals/items/terms and quote linkage are preserved. Sale total is
recorded separately. Whole-document predicates append one note and effect marker;
retries verify financial state and exact note rather than appending again.
Nonfinancial terms edits remain possible; altered financial/payment evidence is
refused. Same-spelling BSON/string invoice keys never select the other document.
Unpaid invoices without an existing payments array are supported.

The standalone sale suite now includes committed-but-lost invoice replies,
concurrent recovery by another authorized context, partial/full payments, original
cashier retention, terms preservation, changed-note refusal, hidden branches and
typed alias isolation. Both standalone sequence/sale suites pass, as do 33 existing
POS invoice repository/service unit tests. Existing POS invoice functions were
not changed. This remains unmounted: invoice admission before money acceptance,
customer effects, final verification/release, normal competing writes and sync
transport treatment are still required. No claim of full receipt completion.

### Invoice admission before acceptance

Sale acceptance now requires a matching reservation on the original typed invoice
and unchanged invoice financial evidence. Invoice reserve uses whole-document
atomic predicates, checks original paid/pending balances and links, and rechecks
journal stop state after acquiring the lock. Sale stop releases the invoice first,
then its sale reservation. Repeated/concurrent cleanup tolerates an already
released lock; stopped requests never change invoice money. Invoice projection
requires its original reservation and detects financial changes before writing.

Standalone tests cover the new ordering, refusal after a changed printed total,
unchanged original balances on refusal, invoice reserve/stop races and exact
restoration of stopped records. Both sequence/projection suites and five manifest
classification checks pass. Normal invoice writers still need common guards;
these components remain disabled and do not constitute a complete receipt feature.

Manifest review found `invoices` was previously unclassified. It is now explicitly
recorded as unresolved, with required shared-document transport and authority-local
lock separation. This records a rollout blocker, not sync completion. Gateway and
actual agent changes, original-document immutability, cross-device reads and
conflict/reconnect validation are still required. Do not claim the feature done
because a classification test now reports the missing policy visibly.

### Customer ledger admission and projection

`books-receipt-customer` now reserves the original customer and scoped financial
ledger before sale acceptance. It checks the customer balance against money-in
minus allocations and validates the original sale allocation. Unknown/malformed,
conflicting or oversized ledgers are held for review (10,000 rows / 512 KiB saved
financial baseline). Reservations bind the journal review; financial snapshots
retain typed IDs, not display names. Nonfinancial customer data is preserved.

Accepted recovery uses a deterministic money-in ID, updates or creates one sale
allocation, and records the verified customer effect. Expected original/interim/
final ledger states detect changes and permit retry after any committed write.
Customer credit balance stays unchanged because this receipt's incoming money is
allocated to its sale once. A walk-in with no customer requires no ledger effect.
Stopped requests release customer then invoice then sale; accepted work stays
reserved. There is no financial finalization or normal route enablement yet.

Standalone tests inject lost responses after incoming money, allocation and
customer effect writes, then recover concurrently. Existing and absent allocation
rows, corrupted prior ledger/customer balance and customer reserve/stop races pass.
Two standalone suites and five sync classification checks pass. Source-only:
normal customer/wallet/POS writers must still honor admission, and private sync
transport must separate local lock/effect state from required shared evidence.
The manifest's invoice/transaction/payment gaps remain blockers, not accepted sync.

### Verified completion and release recovery

Sale finalization now reads/verifies the invoice and customer effects before
storing their hashes and original result in the projected journal command. The
verification paths refuse missing effects without writing them. Completion then
releases customer, invoice and sale reservations in that order, with the sale
last. Committed-but-lost replies at journal completion and each release resume
from durable state. A repeat of an older completed receipt returns its original
outcome without touching a newer reservation on that sale.

The standalone journey now covers partial receipt → all effects → interrupted
completion/release → recovery → second collection → fully paid. Original invoice
total and notes survive, customer net credit remains correct and old completion
cannot release the second command. Nine receipt/identity tests plus five manifest
classification checks pass. These are local source tests with direct internal
contexts, not full protected HTTP, installed software or cross-device evidence.

Common legacy POS writer guards, normal authenticated routes, original full test
compatibility, backup/restore and Gateway/agent transport remain required before
activation. No receipt command is mounted or default-enabled by this change.

### Existing invoice write admission

The normal invoice repository now checks absence of a receipt reservation in the
actual edit, payment-note, delete, cancel and sale-mirror write predicates.
Cancellation also requires the document still be a draft. Mirroring compares the
read document atomically and returns a conflict if a newer balance or reservation
arrived; it no longer reports success for a failed update. Sharing metadata paths
are unchanged. No new persisted fields or sync lanes were introduced by this guard.

Real standalone-Mongo tests exercise all five repository operations, including
locks inserted between read and write, concurrent issue versus cancellation,
stale balance mirroring and unreserved successful behavior. Both this suite and
the full internal receipt journey pass; 33 existing invoice repository/service
unit tests pass. Repository database selection is injected into a disposable real
database; full application auth/installed behavior remains unverified.

This protects invoice records only. The ordinary invoice-payment service can
still reach sale/customer writes before its mirror, and wallet/edit/delete paths
still need the common admission protocol. Do not enable the new receipt route or
claim competing-writer protection complete until those changes and tests pass.

### Ordinary invoice-payment admission

The existing invoice-sync `recordPayment` path now atomically reserves its original
sale before any money write, then admits the original scoped customer. It refuses
Books or another ordinary collection's reservation. Failed customer admission
releases the untouched sale. Sale/customer financial writes retain the admission
ID predicate and check matchedCount. Successful invoice note and balance mirror
are required before customer then sale admission releases. Interrupted writes
retain original amount/method/reference/cashier/balance evidence and prevent a
blind second collection. Books sale/customer admission checks this legacy marker.

Real-Mongo tests exercise competing ordinary calls, Books reservations on sale or
customer, normal partial/full collection, money-in lost reply, retained holds and
Books refusal. Three integration suites and 33 existing invoice unit tests pass.
No live POS data or installed executable changed. The new legacy lock fields are
execution state on otherwise shared documents: transport exclusion/authoritative
coordination remain rollout requirements. Wallet/other customer and sale writers
still need admission. Recovery UI and deterministic resolution of interrupted
legacy effects are unfinished; do not release this source as client-ready.

### Stable ordinary-payment evidence

Ordinary payment admission now allocates the incoming ledger ObjectId before
writing money and retains it in the sale/customer admission. The money-in row
carries that ID and the admission UUID. Invoice notes receive the same UUID and
the original accepted date/cashier. Repository note writes atomically refuse a
second note with that identity; an exact existing note is returned as the saved
result. Changed amount/method/reference/note/date/cashier or duplicate identities
are refused. Calls without a command ID retain their existing append behavior.
Command-bearing calls require an explicit valid original Date.

Real-Mongo tests cover eight concurrent identical note submissions, changed
requests, missing original date and committed-but-lost note replies. The ordinary
payment interruption test checks the money row against its saved admission ID.
Three integration suites and 33 existing invoice unit tests pass. This establishes
identities for recovery; allocation/wallet replay and the complete legacy recovery
orchestration/UI are still unfinished. Existing unidentified payment history is
not backfilled or promoted to an immutable receipt. Sync remains unresolved for
invoice/transaction evidence; these fields are not a deployment claim.

### Ordinary allocation and wallet effect identity

The ordinary invoice service now uses `invoice-payment-effects` for allocation
and sale balance/wallet writes. Each atomic write includes a command-bound effect
marker and exact-document predicate. Replay checks the recorded amount and current
result before returning; changed commands, balances or stale originals fail.
Wallet input is saved in admission, and requested sale values/actor/time must
match the original admission. Decimal precision is checked before effect writes;
no rounding is introduced by replay. Effects have an explicit 1,000-entry review
limit; scalable archival remains required.

Real-Mongo tests lose allocation and wallet replies after commit, replay each
six times concurrently, and verify a single effect and unchanged amounts. Changed
replay amounts are refused. Existing normal partial/full invoice tests pass
(33 unit tests), alongside internal receipt integration. Unit mocks now retain
admission state rather than pretending every read sees an untouched sale.

These are projection primitives, not a completed legacy retry route. Durable
allocation creation, full source/ledger verification, orchestration, completion
recovery and UI still require implementation before client release. New effect
fields also need the outstanding authoritative sync design.

### Stable ledger-row creation

Ordinary admission allocates both money-in and potential new allocation ObjectIds
before writes. New rows retain the command UUID. `insertOriginal` treats a duplicate
ID as recovery only when the entire canonical BSON document matches the original;
changed values/scopes fail. The allocation lookup now includes customer and branch,
in addition to sale/license. Existing allocation updates retain their prior IDs.

Real-Mongo tests interrupt after allocation creation commits, then concurrently
replay both original row inserts. Exactly two rows remain; changed amounts and
customer identities are refused. Ordinary/internal receipt integration suites and
33 invoice unit tests pass. This closes row-creation identity, not the full legacy
recovery route: source/ledger validation, orchestration, verified completion and
UI still need to be connected. No historical backfill or sync acceptance.

### Ordinary payment recovery orchestration

An internal recoverPayment entry point resumes the original admission using its
BSON source snapshot, original cashier, timestamp, amount and stable row IDs.
Completion is retained before customer/sale lock release; lost completion and
release replies return the original result. Older result recovery leaves newer
admissions intact. Changed immutable sale data, tenant/branch, unknown commands
and a different cashier for unfinished work are refused. Admission refuses
malformed/1000-entry completion histories and source documents over 512 KiB before
writes. No route or recovery UI has been mounted.

Validation: 36 invoice unit tests; three real-Mongo integration suites covering
invoice guards, ordinary recovery and Books receipt projections. Ordinary recovery
covers ten committed-write interruptions, concurrent saved-result replays and
scope/source refusals, with two ledger rows and one invoice note retained. All
passed. This does not establish complete ledger concurrency protection: unrelated
wallet/ledger writers, full ledger baseline verification, authenticated recovery
UI, sync exclusion/authority and installed paired acceptance remain outstanding.
No installer or deployment was produced.

### Competing ordinary sale writes

Ordinary invoice collection now refuses active restaurant payment, correction,
return and unexpired edit reservations before acquiring payment admission. The
shared sale guard refuses Books and legacy invoice admissions. Existing model
saves, wallet updates, settlement and enabled edit-lease acquisition now include
atomic absence predicates for both admissions. Settlement reports a generic
payment/change conflict rather than incorrectly identifying every conflict as a
restaurant payment.

Validation: 182 sale/invoice unit tests pass. Real Mongo tests cover both admission
kinds, stale model saves, wallet refusal, reservations arriving between settlement
read/write, stale edit acquisition and normal unreserved wallet/edit behavior.
The existing ten-stage recovery regression passes in the same run. No extra data
fields or transport lanes were introduced. The five sync classification checks
pass but still report 12 undecided collections (including invoices, transaction,
payment); this is not cross-device acceptance. Other direct writers and customer
ledger coordination still require audit before connector activation.

### Reverse reservation checks

Restaurant payment preparation, restructure admission, transfer eligibility,
paid-bill correction admission, restaurant deletion admission and return/refund
admission now require both Books and ordinary invoice payment locks to be absent.
Books receipt admission also rejects a restaurant payment plan. These checks keep
new competing operations from acquiring an already reserved sale; existing own
operation recovery is retained.

Validation: 357 tests across captain payments, restructure locks, transfers and
sale repository pass using the owned scratch runner and existing Mongo binary.
New real-Mongo tests inject each receipt lock immediately before restaurant plan
admission and verify no plan/payment is acquired. Restructure reservation refuses
both locks. Books receipt integration rejects restaurant/legacy/correction/return
reservations and still completes its ordinary projection/recovery checks. Scratch
3COHGC/bd63vT removed and independently absent. Attribution/diff checks pass.

No sync schema or installer changes. Sale reservation coverage is improved, not
complete cross-device/customer-ledger coordination. Public connector activation,
full writer audit, ledger baseline checks, UI and installed acceptance remain open.

### Retained ordinary customer ledger

Invoice admission now retains a bounded financial ledger baseline (10000 rows,
512 KiB) scoped to the original customer/license/branch. Recovery verifies that
baseline before effects, before customer balance projection and before saving
completion. Only this command's deterministic money row and original/new sale
allocation transitions are allowed. Missing prior allocations for already-paid
sales, duplicate allocations, unrelated additions/deletions and changed financial
values fail closed. Balance comes from the verified rows, replacing an unchecked
aggregate over whatever happens to exist at retry time.

Validation: 36 invoice unit tests pass (ledger boundary mocked there). Real-Mongo
integration exercises the actual verifier, ten lost-write replies, changed/added/
deleted prior rows, and two successive partial payments plus recovery of the older
result without changing the newer balance. Owned Ph36jp/StbWdp/KqTgG0 roots removed
and independently absent. Attribution/diff checks pass.

This is detection and retained evidence, not atomic coordination of every customer
writer: a writer ignoring admission can still race between verification and a
write. Customer-wide writer integration, authoritative sync and authenticated UX
remain required before activation. Locks created without this baseline cannot be
silently upgraded into a recoverable payment. No installer/public release.

### Protect receipt rows from manual customer deletion

Customer transaction deletion now refuses invoice_id, legacy_invoice_payment_id
and books_receipt_id references even when sale_id is empty. Previously the empty
sale ID made receipt money rows look like removable manual wallet entries. Manual
row deletion uses an exact original-document predicate; a changed row returns
409 without recalculating the balance.

Validation: 141 customer-controller unit tests pass. Paired real-Mongo tests call
the actual controller, refuse recorded invoice/Books receipts, inject a receipt
reference after lookup but before deletion, and verify ordinary manual deletion.
Existing original-payment recovery checks also pass. Owned QmddAO removed and
independently absent. Attribution/diff checks pass. This is a server integrity
fix; the ledger UI still needs to hide the delete action for protected receipt
rows. Customer-wide admission and sync coordination remain incomplete. No new
persisted fields, installer or deployment.

### Customer receipt action state

The ledger renderer now shows Recorded payment and a correction hint for invoice/
Books receipt references, instead of the manual-entry delete action. English and
Arabic labels are supplied. Sale-linked rows retain a non-action link indicator;
manual entries have an accessible button with existing customer delete permission
attributes. Identifiers are encoded into the handler attribute through DOM APIs.

A bilingual narrow-screen mockup was prepared and inspected in Books before this
change. Two DOM renderer tests pass with actual language dictionaries, receipt
markers, manual action dispatch, accessible labels and markup-like identifiers.
Tests used the existing C:/Users/Kayal/POS/node_modules read-only via NODE_PATH;
no packages were installed in that checkout. Syntax, attribution and diff checks
pass. This changes an existing action state, not a navigable destination; no
universal-search destination or sync field was added. Full installed ledger visual
acceptance and customer-wide admission remain pending.

### Request identity and read-only invoice status

Payment requests may supply a lowercase UUIDv4 commandId. Completion retains the
normalized original request and cashier identity; identical completed requests
return the original result, while changed values/cashiers fail. Newly recorded
cashiers use user ID, with legacy name matching retained only for old admissions.
The normal payment controller accepts exact completed replays even after the
invoice becomes paid; it still refuses new collections on a paid invoice.

GET /invoices/:id/payment-requests/:commandId uses existing authenticated invoice
read scope and returns absent, pending, saved or other_pending without running
recovery or releasing locks. Saved results report outstanding lock release.
This is an internal API, with no new navigation destination. No recovery POST or
client request persistence is connected yet.

Validation: 36 invoice unit tests and actual-controller real-Mongo integration
pass. Tests compare all four relevant collections before/after status at ten
interruption stages, verify replay/changed-input refusal, stable cashier IDs,
read permission/branch rejection, and exact replay of a fully paid invoice.
Owned CbMjxA/z8SV82 removed and independently absent. Attribution/diff checks pass.
The new request/cashier metadata is local command evidence; it must not be blindly
replicated. Existing sync authority gaps and installed acceptance remain open.

### Explicit continuation and local request retention

POST /invoices/:id/payment-requests/:commandId/recover requires invoice read/write
access, the original cashier, and only {confirmed:true}; replacement amounts or
other fields are refused. It loads the original request and continues its saved
effects. Saved results with outstanding release also expose whether this cashier
can finish release. Unknown or conflicting state remains held.

A browser request-store factory retains scoped request identity before submission,
requires Web Locks for same-origin tab coordination, and refuses corrupt/failed
storage. Only a matching saved result with no pending release can remove the
original; stale replies cannot remove a newer request. The factory is not yet
connected to invoice payment buttons or the page asset map.

Validation: 36 invoice unit tests, four request-store tests and actual-controller
Mongo tests pass (confirmation, permission/cashier, altered body and continuation).
The Books English/Arabic recovery mockup was checked at 390px and visually inspected
before implementation. Owned PTTrtq/9VkXP3 removed and independently absent.
Attribution/diff checks pass. Next: connect the reviewed screen and persistent
request store, then exercise the normal browser flow. Local request data is not
synced business data; existing server sync/customer coordination gaps remain.

### Connected invoice payment recovery UI

The invoice asset map loads the request store and recovery controller. Record now
persists the scoped original before POST; reopening an invoice restores unresolved
requests, freezes original fields and offers read-only checking. Absent requests
can be explicitly retried unchanged, pending requests explicitly continued, and
permission/unavailable states remain held. Saved confirmation removes local evidence
only after verified completion with no outstanding release. Replies for an account
or invoice the user has left are ignored. EN/AR labels accompany the flow.

Validation: 14 browser/store/existing invoice-print tests pass. Scenarios include
lost response/reload, original-value retry despite changed form fields, permission
holds, stale replies, storage failure, pending release and invalid amount refusal.
Electron Chromium executes the production store/controller with the actual payment
strip and fixture transport: Web Locks/local storage work, continuation requires a
click and saved confirmation clears the request. This is not a running full POS
server or installed paired acceptance. Owned wUGmIR removed and independently
absent. Existing POS dependencies were read-only via NODE_PATH for DOM tests.
Syntax/attribution/diff checks pass. No new navigation destination or synced fields.

Unresolved requests remain held if the server rejects their original values; a
server-confirmed stop/replacement protocol is still needed for that case. Customer
writer coordination, authoritative sync and installed paired acceptance remain open.

### Stop before replacement for issued invoices

An authenticated confirmed stop records the original request ID on the sale using
an exact-document compare. Admission checks those retained stop records and uses
the same document comparison: stop and payment admission cannot both win. Admitted
or completed requests cannot be stopped. Repeated stop/status returns the saved
outcome, including after a lost reply. History is bounded and never silently pruned.

The EN/AR recovery screen offers Stop only for an absent request on an issued
invoice. After checking a confirmed stopped outcome, Review a new payment clears
only that original local request and reopens the invoice; it never submits new
money. Late confirmations cannot clear newer requests. The mockup was extended
and checked before implementation.

Validation: 11 browser/store tests, 36 invoice unit tests and real-Mongo tests pass.
Mongo coverage includes both stop/admission race orders, lost stop reply, admitted
payment refusal, controller confirmation/permission checks and delayed payment
refusal. Owned M8NCzu/bec3Wv/gPCwkU cleaned and independently absent. Attribution/
diff checks pass. Local stop history must remain with its authoritative payment
installation; sync integration is still unresolved, so no deployment is claimed.

Limitation: a request rejected before invoice issuance has no sale to serialize
against. It remains held; invoice-level stop/admission coordination is still needed.
Customer-wide payment coordination and installed acceptance also remain open.
