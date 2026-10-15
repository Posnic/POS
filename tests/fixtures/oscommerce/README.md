# osCommerce CSV Order Import Fixture

## Scope

This directory contains synthetic CSV fixtures representing orders exported
from an osCommerce-style online store.

The fixtures are intended for local development, testing, documentation, and
future import work when direct legacy database integration is unavailable or
unsuitable.

They do not implement an osCommerce connector or CSV importer.

These column names and values are an osCommerce-like synthetic schema for
fixture and validation purposes, not a claim about the exact format of an
official osCommerce export.

Parent issue: #34

Related: #90, #94

## Files

* `orders.csv` — valid synthetic order records representing paid orders.
* `invalid-orders.csv` — synthetic records covering documented validation
  failures.

## Required columns

The following columns are required for an order record:

| Column         | Description                       | Validation                                |
| -------------- | --------------------------------- | ----------------------------------------- |
| `Order ID`     | Unique external order identifier  | Required and non-empty                    |
| `Order Date`   | Date the order was created        | Required and must be a valid date         |
| `Product Name` | Purchased product name            | Required and non-empty                    |
| `Quantity`     | Number of units purchased         | Required and must be greater than zero    |
| `Unit Price`   | Price of one unit                 | Required and must be zero or greater      |
| `Currency`     | Currency code for monetary values | Required and non-empty                    |
| `Order Status` | Current order state               | Required and must use a documented status |

## Optional columns

The following columns provide additional information when available:

* `SKU` — External product or variant identifier.
* `Customer Name` — Synthetic customer display name.
* `Customer Email` — Synthetic customer email address.

Optional customer fields should not be required for fixtures that only need
order and product information.

## Supported order statuses

The synthetic fixture uses these example statuses:

* `pending`
* `paid`
* `fulfilled`
* `refunded`

A production importer should define its supported status mapping before
accepting additional source values.

## Duplicate external order ID

`orders.csv` includes two rows sharing the same `Order ID`
(`SYNTH-OSC-5001`). This represents a single multi-line-item order and
allows tests to verify that a duplicate external order ID does not create a
second POS sale when the same order is re-imported.

## Validation errors

`invalid-orders.csv` intentionally contains examples of:

1. Missing `SKU` (empty field).
2. Negative `Unit Price`.
3. Non-numeric `Unit Price` (`not_a_number`).

These records document expected validation boundaries. They do not represent
real osCommerce validation responses.

## Privacy and synthetic data

All identifiers, names, email addresses, product information, prices, and order
IDs in these fixtures are fictional.

Customer email addresses use the reserved `.test` domain and are not intended
to represent real customers.

No live merchant export, customer record, credential, API token, or production
data is included.

## API integration versus CSV fallback

osCommerce stores traditionally expose data through direct MySQL database
access. Direct database integration should be avoided when a CSV export or
REST-based approach is available because it couples the connector to internal
schema details that vary across osCommerce versions and community forks.

The CSV fallback is intended for migration, one-time imports, testing, or other
situations where direct database access is unavailable or unsuitable.

## Out of scope

This fixture does not implement:

* osCommerce authentication.
* Live osCommerce database connections.
* Direct MySQL queries.
* Storefront scraping.
* Automated order synchronization.
* Webhooks.
* A production CSV importer.
* Real merchant-data ingestion.
* Support for every custom osCommerce schema.
* Posnic Cloud-only functionality.

All data is synthetic and intended only for local development, testing, and
documentation.
