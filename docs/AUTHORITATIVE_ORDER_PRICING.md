# Authoritative order pricing

Status: implementation for review; coordinated POS API, desktop, Captain and Gateway release required.

## Problem and invariant

Azure receipt SB1D28-27-000130 exposed a price-contract failure. Captain's existing-order search took `final_price` (45 plus 5% = 47.25), submitted it as `price`, and the amendment API treated it as an exclusive base. Original order creation used catalogue prices; amendments trusted the request. Receipt rendering accurately reproduced an incorrectly priced stored order.

**A client chooses products, quantities and permitted options. It does not establish a fixed product's price, tax rate or tax treatment.** A stated price is an assertion which must match the issuing API's rules. A different price requires a configured rule or an explicitly variable product. An arbitrary channel label is not a pricing rule.

## Pattern: domain pricing authority with adapters

`api/src/services/pricing-authority.js` is the shared admission policy used by cloud and the API bundled into desktop. The pure resolver accepts scoped catalogue/configuration documents and produces a versioned pricing snapshot. `calculate` calls the existing `tax-engine` for line arithmetic. Adapters translate legacy request field names; they must not decide whether an override is permitted.

| Adapter | Responsibility |
| --- | --- |
| Catalogue/menu response | Produce `price` and `final_price` through `menuQuote`; label their basis |
| Online/Captain order creation | Resolve item, validate submitted price, price server-owned modifiers, calculate line |
| Existing-order amendment | Load existing line from storage, validate input against that line, preserve its accepted snapshot; resolve new lines from current rules |
| Desktop checkout | Resolve catalogue/outlet/customer rules, validate submitted price and tax, retain existing permission checks for discounts and payment |
| Kiosk | Apply the same fixed/variable policy before using the shared tax engine |
| Receipt/payment | Consume accepted line values; never turn a displayed total back into a base price |
| Sync | Transport committed records and configuration; never recalculate or silently rewrite historical sales |

No request-owned `pricing`, `open_price`, tax setting, venue markup or price-list document is authoritative. Existing snapshots are read from the persisted sale, not copied from the request.

## Price and tax contract

`selling_price` is in the catalogue's tax basis: before tax for exclusive products, including tax for inclusive products. Menu `price` has this basis. Menu `final_price` is for display and includes the applicable discount and tax. It must never be submitted as the selling price.

Canonical order calculations keep before-tax `unit_price`/`item_base_price`, the line's subtotal, tax, discount and final total separate. The snapshot retains the original selling-price basis so an inclusive amount is never divided by tax twice. The legacy desktop `sale_inline_item_price` remains the selling-basis amount. Adapters must use the correct representation for their request, rather than guessing from a field's numerical value.

For an exclusive Paratha at 45 and quantity 2: subtotal 90, tax 4.50, total 94.50. A submitted 47.25 is rejected. For inclusive water at 30 and quantity 2: total 60, tax 2.86, subtotal 57.14. An existing inclusive line's displayed net unit amount is validated against its saved line; recalculation uses its stored inclusive selling-price snapshot.

Round at the shop's currency precision. Sum stored line subtotals, not rounded net unit prices multiplied again: those can differ for inclusive prices and larger quantities. Split tax components must sum to the calculated tax. Submitted GST amounts cannot replace the tax engine's result.

## Rule selection

1. A persisted version-1 snapshot retains the agreed price and tax for an existing line. Catalogue edits do not reprice a dish already ordered. A submitted override is refused. Changing priced modifiers requires a separate line.
2. Catalogue flags determine variable prices: `open_price`, a daily price which has expired according to the shop's trading day, or an instant/quick item. Existing zero-priced catalogue products retain their established market-price meaning; they require a positive entered price, never a free default. Quick items may use their just-created persisted price when no separate price is supplied.
3. A fixed new product uses the catalogue price. A configured billing outlet takes precedence over a customer-category price list. Item overrides take precedence over that rule's percentage. Server-validated modifier deltas are added. A configured partner venue applies its markup using the existing venue rule.
4. A fixed submitted price must match the resulting selling price at the currency's precision. A higher price is as invalid as a lower price. A channel with no alternative rule uses the catalogue price; it cannot justify a different submitted price.

Variable inputs must be finite, positive and no greater than the existing 1,000,000 limit. Booleans, empty strings, negative amounts and non-numeric values are refused. Product flags come from the catalogue; a client cannot turn a fixed item into an open-price item.

The snapshot records version, item, source, channel, rule identity/revision, catalogue price/revision, modifier delta, venue adjustment, selling price, tax basis/rate and currency policy. It explains which rule admitted a price. It is not a customer-editable quote.

## Failure and persistence

Price mismatches return `item_price_mismatch` with item, expected price and submitted price. Invalid configuration and missing venue/outlet rules fail closed. The amendment endpoint returns a validation response, not a misleading “order not found” or transport error. The client keeps its draft and shows the server message; it must not automatically resubmit using another number.

All lines are validated before a sale/stock write. A bad second line rejects the complete amendment, including a valid first line. Concurrency/payment guards still apply at save time. The successful response contains the calculated total, not the request's `total_amount`. A retry of an already committed desktop request returns that result before checking today's catalogue.

Legacy orders without pricing snapshots are not automatically certified. A known fixed line must agree with the catalogue before receiving a snapshot. An inflated legacy line fails and requires review. A removed legacy catalogue item can be reduced at its saved amounts but cannot acquire new quantities without a verifiable price. No migration in this change alters completed bills.

## Offline and configuration delivery

The same resolver runs inside cloud and desktop; it does not require internet for a local sale. Local catalogue/configuration is authoritative for that device's admission. Offline cannot promise knowledge of a cloud edit made while disconnected. A stale client quote that differs from the local API's current rules is rejected.

`items`, `branches` and `settings` already sync. The accompanying Gateway change adds branch-scoped `price_lists`, `billing_outlets` and `modifier_groups` to the batch lane. Outlet writes now stamp `updated_date`, which the sync watermark reads. Price-list/modifier deletions write the existing deletion tombstone before deleting. Venue settings already travel in `settings`.

Missing named venue/outlet rules on desktop cause an error instead of falling back to house prices. Synced sales preserve the issuing API's snapshot. Sync is not a validation bypass for a client request, and it is not a mechanism for silently repairing old receipts.

## Release and verification

Release the Gateway/configuration support, verify master-data delivery, then deploy the shared API in cloud and desktop and the Captain correction. Old Captain versions sending a tax-inclusive amount as the base will be refused; update them before restaurant service resumes. Updating only the cloud API does not fix a desktop still running an old bundled API.

Regression coverage includes the actual 45/47.25 failure, inclusive water, larger inclusive quantities, fixed-price over/under submissions, arbitrary channel labels, configured outlet/list/venue prices, variable and quick items, forged flags, immutable accepted prices, tax and modifier changes, partial-save prevention, unavailable local rules and idempotent retries. Retain the existing sale, payment, currency, tax-engine and concurrency suites.

Before production rollout, exercise a new order and a later addition on a packaged desktop with Captain, print both exclusive and inclusive lines, and verify the persisted amounts and receipt totals. Audit affected historical orders separately. Any correction must follow the order's current payment state and the existing correction/audit workflow; changing catalogue prices is not a repair of a saved sale.
