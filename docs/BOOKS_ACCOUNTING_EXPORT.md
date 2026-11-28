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
