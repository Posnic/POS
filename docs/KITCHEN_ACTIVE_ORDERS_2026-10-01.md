# Kitchen active-order correction — 2026-10-01

## Cause

The kitchen eligibility rules deliberately retained kitchen_required orders after payment. The screen ticket projector also ignored bill_requested_at and bill_printed_at when kitchen_required was true. Staff therefore had to mark every dish served, even after billing or settlement.

## Change

- Takeaway orders remain after billing and payment until their items are marked served. Cancellation continues to apply. Both legacy dine-type spellings and the fulfilment field are recognized.
- Paid dine-in orders leave the wall display and touch board without writing served quantities.
- For dine-in, bill request/print timestamps close earlier rounds, including tracked kitchen orders.
- For dine-in, positive Captain payment allocations close earlier rounds using the recorded collection time.
- New rounds added after billing remain visible on an unpaid order.
- Hardware Manager > Kitchen Screen > Refresh active orders requests a fresh read. Delayed older requests cannot restore stale orders. Network failures preserve the last display and report failure.
- No printer job is replayed and no sales/payment/service records are altered by refresh.

## Verification

Real MongoDB regression tests cover paid, bill-requested, bill-printed and Captain-payment orders, plus unchanged service quantities. Desktop tests cover refresh during an existing poll, duplicate refresh requests, connection failures, stop during refresh, and button progress/results. Existing screen layout, service-round and touch-board tests also pass.

## Verification on a till

Close the installed app before opening the test portable. Open Hardware Manager > Kitchen Screen and use Refresh active orders. With no active rounds, the display should be empty. Place a test order, request its bill without marking served, and verify removal. Test payment/settlement separately and a new item added after a bill request. Do not replay actual orders.

The updated API is required: the portable includes it for local service. If Captain uses an online shop API, that server needs the same API change. Production deployment has not been performed by this task.
