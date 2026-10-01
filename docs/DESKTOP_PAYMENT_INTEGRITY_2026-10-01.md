# Desktop payment discrepancy investigation

## Evidence and limits

A read-only investigation found saved bills with a tax-inclusive total of 262.50,
tax of 12.50, a single UPI tender of 250, and status Paid. The stored bill total
had not lost its tax. This proves inconsistent payment bookkeeping; it does not
prove the amount received by the bank or establish the exact reported 260 display.
Customer identifiers and production records are deliberately omitted here.

The service regression reproduced accepting 250, 260, 262 and 263 as full
payment for a 262.50 bill. The service derived Paid independently of the explicit
payment breakdown. Separately, the desktop reused an unpaid order's provisional
tender even when that tender did not cover the current bill.

## Changes

- Initialize the first payment on an unpaid order from the full payable,
  retaining its selected payment method. Preserve previously paid/partial tenders.
- Stop payment-only checkout if the computed total differs from the saved bill;
  show an actionable error instead of silently repricing it.
- Before sale/stock writes, validate a nonempty explicit payment breakdown against
  the server-calculated full due, including an add-to-bill tip, or against the
  explicitly recorded partial amount. Compare integer minor units. Reject invalid,
  negative or mismatched amounts rather than increasing a tender automatically.
- Include the changed API and desktop source in diagnostic build identity.

Legacy requests without an explicit tender breakdown and wallet-ledger flows
retain their existing semantics. This change is not a general ledger audit or a
claim that those paths have been redesigned. It does not repair historical data.

## Local verification

- Sale service: 99 tests, including the reproduced underpayment, split tender,
  exact payment, partial payment, malformed payment, tip and table-settlement cases.
- Desktop tender: 18 tests, including six new tests executing the payment-screen
  functions with a DOM and clicking between UPI and Cash.
- Payment-method deduplication: 4 tests.
- Tax engine and sale header: 14 tests.

Commands (from repository root):

```powershell
node --test tests/desktop-payment-integrity.test.js tests/the-tender-asks-for-what-the-bill-says.test.js tests/settling-a-table-is-not-an-overpayment.test.js tests/one-tile-per-payment-method.test.js
node api/node_modules/jest/bin/jest.js -c api/jest.ci.config.js --runInBand --runTestsByPath api/tests/unit/services/sale.service.test.js api/tests/unit/services/tax-engine.test.js api/tests/unit/services/sale-header.test.js --forceExit
```

## Deployment and reconciliation

These source changes are not yet deployed. Update the frontend and the API that
actually receives the desktop sale: packaged local API for local billing, cloud
API for online billing. A previously generated EXE does not contain these changes.

Before rollout, use an isolated test account to open a 250 item with 5% exclusive
tax, confirm 262.50 on bill and tender, switch UPI/Cash, and inspect the saved
payment breakdown. Repeat for a saved unpaid table, split payment, partial
payment and configured rounding. Verify a deliberately mismatched submission
is rejected without changing the saved sale or stock. A changed saved bill must
be reviewed explicitly; retrying the same mismatch should not collect money.

Reconcile affected historical bills against their actual bank/payment evidence
before any separately approved accounting correction. Do not replay payments,
automatically increase collected amounts, or overwrite existing paid records.
No production records were modified during this investigation.
