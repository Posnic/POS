# Books receipt capture — active implementation

## Runtime constraint and current boundary

`src/mongodb-manager.js` starts the offline database without `--replSet`. The existing invoice-payment path writes a customer money-in row, the sale's allocation row, sale payment values, customer balance and invoice payment note separately. Retrying the same amount currently has no persistent command identity. Requiring a replica-set transaction would exclude the existing offline installation and is not the implementation plan.

`api/src/services/books-receipt-journal.js` is an internal coordinator primitive, not an activated feature or a payment endpoint. It does not change a sale, customer ledger or invoice. Existing payment routes are unchanged. It accepts trusted, already authenticated installation/branch scope and an already checked original sale basis; a caller must not accept those claims directly from browser input.

One journal document owns a typed sale identity within a shop. Its stored authority and branch cannot be replaced by another caller. Each command has immutable input, original source revision and a confirmation hash. Prepared requests can be stopped; accepted receipts cannot. Acceptance and its next balance are one journalled single-document compare-and-swap write. Concurrent retries return the original receipt. A competing command cannot bypass an unfinished operation. Completion requires acknowledgement of the exact accepted receipt and projected paid/pending totals; it is not proof by itself that external projections happened.

The receipt ID includes installation authority, journal and command identity. The next request must continue the prior acknowledged source revision and balance. Old paid balances are retained as a baseline, not manufactured receipt events. Source edits, unknown outcomes, other authorities and broken sequences are held. The journal is local execution/recovery data in the POS sync classification. Gateway/agent allowlists do not transport it; blindly replicating this command document could replay money. There is no new shared data lane yet.

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
