# Correct a collected payment

Enable **Core Settings → Sale → Allow correction of collected payment methods**
for the branch. The setting defaults off and is not copied to another branch.
Users need Sales write permission.

Open a paid bill in Sales History and choose **Correct payment**. Choose one of
the shop's enabled payment methods, or **Mixed** and enter the actual amounts.
A single method receives the full collected amount automatically. Choose a
reason template (or write another reason), review, and save.

This corrects the recorded tender allocation; it does not charge, refund, or
contact a payment provider. It never changes items, tax, bill total, collected
total, customer balance, or the original collection time. Reprints, sale details
and payment reports use the corrected allocation. The bill retains the old and
new allocation, reason, staff identity, and correction time.

Only fully paid, non-refunded sales with a known payment breakdown are eligible.
A closed register cannot be rewritten. Bills with multiple register collections
need reconciliation, rather than assigning the full bill to every collection.

The correction and audit use a single sale-document write, with a durable pending
journal for the register projection. This works with standalone desktop MongoDB.
While projection is pending, the register cannot close and sale edits/refunds
cannot race that correction. Reopen **Correct payment** after an interruption to
recover the same operation. An interrupted worker lease expires after one minute;
retries retain the request ID and cannot append the correction twice. Turning the
setting off prevents new corrections; an already accepted operation can recover.

Local verification:

```
node --test tests/payment-correction-ui.test.js tests/sale-payment-breakdown.test.js tests/desktop-payment-integrity.test.js
cd api
node --test tests/payment-correction.integration.cjs
```
