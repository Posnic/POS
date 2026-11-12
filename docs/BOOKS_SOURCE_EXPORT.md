# Books saved-source export

`GET /api/v1/accounting/sales` is an additive read-only contract for an explicitly connected Books client. It requires the existing sales read permission and uses the existing licence and branch filter, rate limiter and typed cursor. Legacy sales endpoints and all checkout/write paths remain unchanged.

The `posnic.sale-source-page.v1` response contains `data` and the existing `meta.count`/`meta.next_cursor`. Each row has a typed `sourceId`, exact `sourceJson` (`posnic.sale-source.v1`) and SHA-256 `revision` of that UTF-8 string. Selected saved totals/state/currency values are whitelisted; contact information is omitted. The hash detects changed bytes; it is not a digital signature. Missing currency stays missing. This is a current snapshot, not a complete financial event feed. Payments, returns, deleted history, intermediate changes and accounting reconciliation require further implementation before posting.

Synchronization: reads the existing branch-scoped `sales` lane; no new collections, fields, writes or Gateway/agent changes. Offline tills may not yet be represented on another server. No stronger synchronization guarantee is introduced. Roll out the API before expecting Books source-value review; older POS versions continue their existing functionality.

Local validation uses Books `tests/pos-sales-contract.integration.js` against the actual POS router and token resolver with isolated real MongoDB databases. It verifies existing sales pagination, string/ObjectId identities, tenant/branch isolation, scopes, revocation, changed revisions and no Books journals. The POS sender outage/retry integration also passes for both Books editions. Books native UI testing uses fixture source responses; installed POS checkout/payment flows and full POS regression are not established by these checks. Application publication remains held.

The focused isolated POS tooling check passes all 18 existing v1 contract tests and three source export tests (typed identities, canonical revision stability, unchanged saved values and missing-currency behavior). ESLint passes the changed API files. Full checkout/payment and installed-build acceptance remain separate pending gates.

The additive scalar projection also includes saved tax/return-tax, discount/return-discount, partial/pending payment values and source invoice identity. Books uses these for read-only reconciliation warnings. No original sale or payment is changed, and no missing currency is inferred. The snapshot still does not supply complete item-level tax and financial-event evidence for posting.

Selected item identity/quantity/amount/tax fields and version-1 pricing currency are now exported via nested inclusion projection. Item notes, pricing rule details and currency symbols are not exported. Books cross-checks saved currencies and compares line-tax sums; it preserves the existing POS line/header rounding semantics. Existing sales storage and calculation remain unchanged.
