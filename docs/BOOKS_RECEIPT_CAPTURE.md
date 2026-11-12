# Books receipt capture — active implementation

## Runtime constraint and current boundary

`src/mongodb-manager.js` starts the offline database without `--replSet`. The existing invoice-payment path writes a customer money-in row, the sale's allocation row, sale payment values, customer balance and invoice payment note separately. Retrying the same amount currently has no persistent command identity. Requiring a replica-set transaction would exclude the existing offline installation and is not the implementation plan.

`api/src/services/books-receipt-journal.js` is an internal coordinator primitive, not an activated feature or a payment endpoint. It does not change a sale, customer ledger or invoice. Existing payment routes are unchanged. It accepts trusted, already authenticated installation/branch scope and an already checked original sale basis; a caller must not accept those claims directly from browser input.

One journal document owns a typed sale identity within a shop. Its stored authority and branch cannot be replaced by another caller. Each command has immutable input, original source revision and a confirmation hash. Prepared requests can be stopped; accepted receipts cannot. Acceptance and its next balance are one journalled single-document compare-and-swap write. Concurrent retries return the original receipt. A competing command cannot bypass an unfinished operation. Completion requires acknowledgement of the exact accepted receipt and projected paid/pending totals; it is not proof by itself that external projections happened.

The receipt ID includes installation authority, journal and command identity. The next request must continue the prior acknowledged source revision and balance. Old paid balances are retained as a baseline, not manufactured receipt events. Source edits, unknown outcomes, other authorities and broken sequences are held. The journal is local execution/recovery data in the POS sync classification. Gateway/agent allowlists do not transport it; blindly replicating this command document could replay money. There is no new shared data lane yet.

## Sale reservation and first projection stage

`books-receipt-sale.js` now prepares from the actual scoped invoice sale and the existing saved-source projection. It requires exact saved currency/balances and invoice identity; it does not use the older clamped display snapshot. The reviewed revision is checked before an exact-document reservation and again before acceptance. A stopped unaccepted command may release its lock. Accepted receipts remain reserved while later effects are incomplete.

The first projection updates the same sale's partial balance, pending amount, payment status and, for the existing customer path, wallet allocation exactly once. It preserves the old `paid_amount` semantics; the future immutable Books receipt feed must distinguish this original scalar from current payment state. The applied effect retains receipt/command/review identity and checks the complete projected source on replay. Changed totals or payment values are held. This sale stage does not insert money-in transactions or update allocation transactions/customer balances. The separate invoice stage below now records the original receipt note.

Standalone tests exercise preparation, stale source before/after reservation, concurrent reservation and repeated projection, accepted-versus-stopped release, altered post-projection values, and stopping while reservation creation is in flight without leaving an orphan lock. The representative sale changes from paid 40/pending 65 to paid 65/pending 40 only once for a 25 receipt; its wallet allocation also changes once. The protected update predicate is tested directly. It is **not yet integrated into every legacy edit/delete/payment path**, and these internal operations are not reachable through normal payment routes. Full writer fencing, protected authority and opt-in remain activation gates.

The new `books_receipt_lock`, `books_receipt_owner` and `books_receipt_projection` markers live on sales. Unlike the local command collection, these fields would travel through the existing full sales synchronization lane. Gateway/agent must preserve ownership and reject incoming overwrites of active local operations before activation; merely adding these markers does not establish that protection. Other installations may show read-only ownership/recovery information but must never execute a copied command. No Gateway/agent code or live data was changed in this stage.

## Invoice receipt projection

`books-receipt-invoice.js` verifies the accepted reserved sale and appends one identified receipt note with its payment mirror in a journalled single-document write. Recovery after a committed-but-lost reply, including concurrent retries, returns the original note. The invoice printed total, items, terms and quote reference remain intact; the separate sale total preserves POS rounding behaviour. Changed receipt amounts or mirror values are held.

Preparation binds the authenticated actor ID/name and the original invoice's typed database identity. Fresh acceptance requires the original actor; later recovery preserves that actor even when performed by another authorized user. A string ID and an ObjectId with the same spelling cannot substitute for one another. Actual sale preparation captures this identity; the primitive journal still reads earlier untyped history, which cannot use the invoice stage without a new valid basis.

Standalone fixtures verify a lost committed reply, six concurrent recoveries, original cashier attribution, typed identity isolation, later nonfinancial edits and payment-history tamper refusal. These checks do not by themselves coordinate customer-ledger completion or release the sale reservation. Invoices are absent from the current generic sync manifest; invoice evidence delivery and ownership must be resolved alongside the sales/Gateway/agent rollout. No normal payment route calls these internal services.

## Customer ledger projection

`books-receipt-customer.js` adds an internal standalone-Mongo stage for an accepted, reserved receipt. It reserves the exact customer ledger, inserts one deterministic money-in row, updates the original sale allocation by exact-document replacement (or creates one for a previously unpaid sale), and recomputes the customer's wallet balance. Each write is journalled and recoverable without repeating an increment. The customer's original ledger fingerprint, allocation and balance remain in its reservation. Unrelated changed rows, duplicate/wrong-branch allocations, altered effects, invalid balances and another receipt's ownership are held.

Real standalone fixtures lose the committed response at each of the money-in, allocation and customer-balance writes. Concurrent recovery leaves one receipt and one allocation; a new full payment on a previously unpaid sale creates exactly two rows. Money-in and its sale allocation offset one another, preserving the pre-existing wallet balance. The original partial-payment case retains its prior rows and changes the sale allocation from 40 to 65 with 40 remaining due. These are isolated fixtures, not live customer edits.

The individual customer stage deliberately retains its reservation. The internal coordinator below now preflights customer/invoice evidence, verifies all effects, acknowledges completion and recovers lock release. Every competing customer/transaction/sale writer and incoming synchronization must honor these reservations before activation. Customers already travel through generic sync; command locks and projection authority must not be replayed by another installation. The bounded 10,000-row internal ledger check currently holds larger ledgers for review; scalable ledger review remains necessary. No normal route calls this service yet.

## Integrated internal coordinator

`books-receipt-coordinator.js` now drives prepare, explicit acceptance, result recovery and stop across the three projections. Before durable acceptance it reserves the source sale, checks and reserves the issued invoice/payment mirror and customer ledger, and rechecks each reservation. Missing invoice/customer evidence leaves the request prepared with no receipt or money-in entry. Explicit stop releases any reservations that were acquired. Sale reservation is released last, preventing the coordinator from starting a new command while earlier cleanup is unfinished.

Accepted recovery verifies sale, customer money/allocation/balance and original invoice note before acknowledging the exact source revision. Lost acknowledgement and customer/invoice release responses recover from the original command. Repeated cleanup tolerates another recovery already removing the same lock. Historical result recovery returns the first original after a later payment; it does not reapply an older balance. Standalone fixtures cover a 25 payment followed by 80, simultaneous acceptance/recovery, no duplicate rows/notes, missing invoice/customer before acceptance and concurrent stopped cleanup. One combined run exposed a release race; it was fixed and the integrated run passed. All runs use isolated data.

This coordinator is still internal. Its checks cannot serialize unfenced legacy writers or incoming sync; those paths, installation identity/opt-in, authenticated routes, normal bilingual recovery UI, immutable Books receipt evidence and installed paired acceptance remain mandatory before activation. The journal primitive's projection acknowledgement is not a public completion API.

## Existing writer protection — invoice boundary

The existing invoice repository now uses atomic no-reservation/no-receipt predicates for financial updates, payment-note append, draft edit/delete and cancellation. Sale mirroring additionally compares the exact document read, checks `matchedCount`, and refuses to overwrite a coordinated receipt. Sharing metadata is held during a reservation but remains available after completed receipt effects. Cancellation also requires the invoice still be a draft at write time. The legacy `invoice-sync.recordPayment` now also acquires an exact-document sale reservation before any payment side effect, described below.

Real standalone-Mongo tests execute the actual repository/service source with only the connection provider substituted. They insert a reservation between mirror read and write, attempt note/share writes during recovery, check completed receipt protection, preserve ordinary note/share behaviour, issue an invoice between cancellation read and write, and confirm an already reserved legacy payment writes no ledger entries. All pass. The expanded regression covers 86 tests including the existing invoice repository suite. Lint has zero errors; twelve existing console warnings remain in the legacy invoice files.

Remaining audited write surfaces before activation:

| Surface | Current evidence / remaining protection |
| --- | --- |
| `invoice.repository.js` | Atomic invoice-document predicates verified; does not protect preceding sale/customer side effects. |
| `invoice-sync.recordPayment` | Exact-sale admission competes atomically with Books reservation. Invoice payments on different sales also reserve the shared customer; other legacy writers still need shared admission. |
| `sale.repository.js`: `deleteSales`, `returnSalesOrder`, `salesPaymentCloseModel` | Delete/return/wallet settlement identified; must reserve before any stock, money or customer effects, not merely filter the final sale update. |
| `customer.repository.js`: update, delete/bulk delete, `updateTotalsAfterSale` | Customer mutations identified; checkout/customer-ledger operations need coordinated admission before side effects. |
| `setting.model.js` restore writes | Generic replacement can overwrite ownership; restore policy must protect incomplete financial operations. |
| `BaseModel.getCollection/getDb/getDB` | Raw collection handles reach many writers. A check at one controller is not complete fencing. |
| Gateway and bundled sync agent (`src/sync-agent-manager.js`) | Separate incoming-write authority; sale/customer ownership and local command non-replay must be enforced on both ends. |

## Legacy invoice-payment admission

The normal legacy invoice-payment service now journals `legacy_invoice_payment_lock` on the exact sale it read before inserting money or changing balances. Its predicate excludes Books ownership/reservation and another legacy payment. Books reservation likewise refuses this marker. The two paths compete on the same document, closing the previously open interval between a read-only check and the first money write. Ordinary amount validation still occurs before reservation.

Successful completion requires the sale update, invoice note and mirror to succeed, then atomically stores a last-result summary and releases the lock. Exceptions or unknown outcomes retain the reservation and original amount, actor, method/reference and before/after balances. A retry or Books reservation is held, never admitted through an expired lease. This summary is **not** an immutable Books receipt feed and does not make legacy partial writes automatically recoverable. A normal-entry recovery/review flow for interrupted legacy operations remains required before releasing these changes; never clear an unknown reservation to retry collection.

Actual service/repository source against standalone Mongo passes normal walk-in and customer partial payments, unchanged net customer wallet, a Books reservation injected just before legacy admission (no legacy money changes), and interrupted invoice-note recovery holding the changed sale against duplicate collection. Existing 86 regressions still pass. The test repository connection provider is substituted; this is not installed POS acceptance. All scratch roots were independently absent.

This lock is on the synced sales document, so the incoming Gateway/agent policy must preserve authority and prevent copied commands from running. Other customer operations, returns, deletion, checkout, direct transaction writers and restore remain unfenced. Native shop context and invoice-payment customer admission are now covered below; authenticated normal-entry binding and installed acceptance remain open.

## Native shop scope and shared customer admission

The journal accepts an actual server-owned ObjectId shop identity, or its canonical string with `licenseKind: objectId`. It stores the explicit type in review scope and separates journal identity from a plain string shop of the same spelling. Reads and every sale/invoice/customer/transaction predicate use the typed value. Existing string-scope histories retain their original identity. Conflicting or invalid type declarations are rejected. Authentication adapters must construct this context from the resolved shop, never trust request-supplied type/authority values.

The legacy invoice-payment path additionally acquires a journalled exact-document customer reservation before ledger writes. Both paths check each other's customer reservation. If another payment owns the customer, the legacy path releases its untouched sale reservation and writes no money. Success releases customer before sale; an interrupted operation retains both. This closes cross-sale contention specifically between Books and legacy invoice-payment. It does not cover customer-page wallet transactions, checkout, returns or incoming sync yet.

Real-Mongo tests now continue a native-ID legacy customer payment through the coordinator to full settlement, preserving native ledger shop/branch IDs and refusing the same-spelling string shop on recovery. Another test injects a Books customer reservation just before a legacy claim on a different sale: no legacy money is written and its sale reservation is released. Conversely, an interrupted legacy payment blocks both another legacy sale payment and a new Books receipt before acceptance. These checks use actual service/repository source with substituted connection plumbing, not installed software.

## Required coordinator and normal-entry work

1. Add an explicit opt-in in the Books connector's own Integrations page. Unset/off keeps the existing POS workflow. Bind the active receiver to protected installation identity, not a browser-supplied authority or a copied database setting. Define how a customer finds the receiver from another authorized installation.
2. Prepare against the authenticated invoice and its actual sale, branch, currency and source revision. Use strict saved balances; do not turn clamped/inferred legacy totals into proved receipts. Draft issuing and its existing recovery must finish before payment acceptance.
3. Reserve the sale against conflicting payment/edit/delete/correction paths before acceptance; revalidate the original after reservation. The reservation and source ownership rules must also survive incoming synchronization. A crash before acceptance permits explicit stop; after acceptance it permits only recovery of the same receipt.
4. Project accepted money into the sale, money-in transaction, allocation transaction, customer balance and invoice note idempotently. Every effect needs the same durable receipt identity and evidence of completion. No retry may repeat an increment. A changed source must remain held rather than be overwritten. Wallet application is a separate link to previously received funds.
5. Expose authenticated read-only result recovery before paid-status shortcuts, and preserve request identity across screen closure/reload. The prepared/review/accepted/projected states must stay distinct. Recover all effects before offering another payment. Never convert a transport failure into permission to collect again.
6. Publish a separate immutable financial-evidence view for Books. Verify tenant/branch restrictions, origin identity, deletion policy, source fingerprints and repeated/moved sale identities. Resolve POS/Gateway/agent synchronization and rollout together; other tills must not replay commands. Cross-database clones remain a specific ownership gate.
7. Verify normal browser and installed EXE receipt, lost response, interrupted projection, concurrent commands, partial/full payments, correction/refund/wallet links, offline restart and reconnect. Preserve ordinary POS checkout, invoice, customer-credit and payment reports with the connector off and on. The implementation remains incomplete until those journeys and the Books accounting handoff pass.

## Evidence

The command journal was exercised against real standalone MongoDB (`hello.setName` absent), using only single-document operations and explicit journalled writes. It covers same-command concurrency, conflicting requests, accepted-response recovery, stop/accept races, authority/branch/shop isolation, source revision continuity, projection acknowledgement and history tamper refusal. Sales and transaction collections remain empty in this primitive test. This is not proof of a collected or projected real payment.

The English/Arabic 390px design in Books `design/review/pos-receipt-capture.html` covers fresh consent, saved/unknown outcomes, server-confirmed absence before unchanged retry and a payment owned by another installation. It is a sample mockup, not a live payment screen. Public application publication remains held.

The expanded POS regression passes 66 tests across v1, tax, sale headers/charges and existing invoice synchronization. Changed-file ESLint passes. Every owned test directory was independently confirmed absent; these results do not activate the coordinator.
