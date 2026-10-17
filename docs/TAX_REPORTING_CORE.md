# Tax reporting core: first implementation increment

17 October 2026. Implements the first calculation boundary from
[Tax & Compliance roadmap](TAX_COMPLIANCE_ROADMAP.md). This is an internal,
tested module, not yet a customer report, endpoint, accountant pack or filing
export. The legacy reports remain in place until replacement reconciliation
passes. No customer records were changed to develop or test this increment.

## Implemented

`api/src/services/tax-reporting/ledger.js` accepts canonical document snapshots
and a server-authorised tenant, registration, branch and currency scope. It
rejects mismatched scope, duplicate document/line identities, unresolved status,
missing amounts and adjustments without original-document references.

- Exact decimal strings preserve up to 12 fractional places. No floating-point
  summation, missing-to-zero conversion or rounding at every row.
- Inclusive local calendar dates become UTC start / exclusive next-day end.
  The registration's timezone controls boundaries, including daylight saving.
- Document dates determine the period; modification dates are not consulted.
- Gross values count once per document; line net/tax are summed independently.
- Credits reverse magnitudes once; debits add them. Source adapters must resolve
  cancellation/deletion/return relationships before passing posted documents.
- Signed round-off is separate from line tax. Differences remain visible.
- Cash Book expenses without recorded tax retain gross amounts and null net/tax.
- Purchase tax is recorded tax. Reviewed eligible credit remains null.
- Source failure, absent source or missing watermark marks coverage incomplete.
  Affected totals are null. `observedTotals` separately describes only the rows
  that arrived, and must never be presented as complete-period totals.
- Unknown supply nature remains an exception; HSN and units are never fetched
  from today's product master. Quantities remain decimal strings.

`readyForReview` means only that this boundary found no exceptions. It does not
mean accountant-reviewed, filed, statutory-export-ready or independently verified
against an official statement. `filingReady` is always false in this increment.

## Source adapter inventory and unresolved evidence

| Source           | Current implementation                                                                                     | Required next step                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales            | `sale.model.js`, `sale.service.js`, `sale.repository.js`; stored `date`, invoice totals and item snapshots | Map actual legacy/current line formats; document treatment of holds, voids, deletion and discounts; preserve component tax                     |
| Purchases        | `receiving.model.js`, receiving controller/model write paths                                               | Support both legacy PHP fields and current schema without treating one layout's missing values as zero                                         |
| Sales credits    | Nested return structures on sales                                                                          | Stable event identity, return date and original-invoice link; verify partial/repeated returns                                                  |
| Purchase credits | `receiving-return.model.js` mutates/removes original purchase lines and writes return evidence             | Reconstruct only from verifiable evidence; flag unrecoverable originals; never reverse both the residual purchase and its original full amount |
| Expenses         | `expense.model.js`: date, amount, type, category, recipient, description; attachments added separately     | Preserve legacy tax as not recorded; distinguish movements and purchase settlements; do not infer classification from category text            |
| Registration     | Branch settings contain tax/regional data                                                                  | Effective-dated registration-to-branch membership and authorised scope resolver still required                                                 |

Canonical input IDs, revision, status, dates and scope are mandatory. Monetary
fields and quantities are decimal strings, not formatted amounts. Credits carry
positive source magnitudes; the document type supplies their sign. Round-off
may be signed. Distinct invoices with equal amounts must keep distinct IDs.
Do not split one document into repeated header rows before invoking this core.

Source completeness and watermark assertions must be produced by trusted
adapters after reading the full bounded source, not accepted from a browser.
Adapters must query within authorised tenant/branch scope as well as use the
defensive scope check in this core. The core does not establish user permissions.

## Synchronisation decision

This increment is pure computation: no collections, persisted fields, write or
delete paths, jobs, or external messages. Consequently it requires no new sync
lane or migration. Existing `sales`, `receivings` and `expenses` are branch-scoped
in POS `api/src/sync/collections.json`, Gateway
`apps/sync-gateway/src/collections.js`, and the agent
`apps/sync-agent/sync-config.json`; `branches` is global in the POS/Gateway maps.
These definitions were inspected, not treated as proof of live delivery.

Cloud, originating till and other authorised tills can calculate the same
result only from the same source snapshots and cutoff. Offline or late sources
must remain incomplete until reconciled. The future run/export persistence needs
its own scope, file storage, sync and recovery design before it is shipped.
No physical till sync or reconnection test has been performed for this core.

## Remaining before the first usable accountant pack

1. Implement and test actual source adapters, component tax summaries,
   cancellations/returns and source cutoffs; reproduce defects against database
   fixtures, not just canonical inputs.
2. Add registration settings and server-side permissions for view/export/review.
3. Persist immutable report runs and resumable export jobs with sync decisions.
4. Build the approved Overview, Sales, Purchases, Adjustments, Expenses,
   Exceptions and Exports screens; Excel/PDF pack with manifest and safe cells.
5. Reconcile source, report and export totals, including 100,000-line fixtures,
   failure/retry, branch isolation, offline/late sync and accountant review.

Official statement import and country-specific statutory mappings remain later
roadmap increments. This core introduces no statutory tax rule or current rate.
