# Guest bills from Captain

Captain can prepare equal shares or assign items to guests. Shared dishes use whole-number share weights (for example, 2:1). The cashier remains responsible for collecting and recording payment. These are unpaid guest bills, not separate tax invoices or receipts.

The floor calls GET /sales/guestBills/table with branchId and table_number to read all unpaid KOT rounds on the table. The response includes a revision, integer minor-unit totals, lines, and bill components. Tax follows the recorded item tax amounts; legacy lines without item tax use proportional allocation. Recorded bill-level discounts and adjustments are allocated proportionally. Totals are preserved exactly. Equal shares differ by at most one minor unit.

POST /sales/guestBills/print accepts branchId, table_number, revision, request_id, optional copies, and plan {mode, guests, allocations}. The server rereads the unpaid orders and rejects a stale revision before creating the print batch. It calculates every amount itself; amounts supplied by a phone are not accepted. Plan allocations map line IDs to a guest-weight array.

A batch is stored as a non-printable shadow bill job. Individual guest copies are normal bill jobs. Deterministic primary keys and ticket keys make the batch and each copy idempotent, including concurrent retries and a lost response. A failed or unconfirmed physical print retains the existing printer recovery behavior. The configured receipt printer receives these bills; no kitchen tickets are created and no payment, stock, or sale fields are changed.

GET /sales/guestBills/latest provides guest shares for the cashier's expanded table details. If the table changed since printing, the cashier sees a warning instead of outdated amounts. The existing cashier payment flow records the payment against the table's orders; guest bills do not create independently settleable sale records.

Captain retains an unfinished split locally. It can be reviewed offline, but printing requires the server to validate the current table. After an uncertain response, retry retains the original request and server. A different server is not used to guess whether the original printed.

Validation covers exact money allocation, taxes/discounts, stale revisions, separate branches and tables, paid orders, simultaneous retries, printer copies, and unchanged payment state. Database concurrency tests also remove the optional ticket-key index to verify the primary-key protection independently.
