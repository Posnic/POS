# Squarespace Commerce CSV Fallback Fixture

## Scope

This directory contains synthetic CSV fixtures representing orders exported
from a Squarespace-like online store.

The fixtures are intended for local development, testing, documentation, and
future import work when direct commerce API integration is unavailable or
unsuitable.

They do not implement a Squarespace connector or CSV importer.

These column names and values are a Squarespace-like synthetic schema for
fixture and validation purposes, not a claim about the exact format of an
official Squarespace export.

## Files

* `orders.csv` - valid synthetic order records.
* `invalid-orders.csv` - synthetic records covering documented validation
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

* `SKU` - External product or variant identifier.
* `Customer Name` - Synthetic customer display name.
* `Customer Email` - Synthetic customer email address.

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

## Validation errors

`invalid-orders.csv` intentionally contains examples of:

1. Missing `Order ID`.
2. Invalid `Order Date`.
3. Zero `Quantity`.
4. Negative `Unit Price`.
5. Missing `Currency`.
6. Unknown `Order Status`.

These records document expected validation boundaries. They do not represent
real Squarespace validation responses.

## Privacy and synthetic data

All identifiers, names, email addresses, product information, prices, and order
IDs in these fixtures are fictional.

Customer email addresses use the reserved `.test` domain and are not intended
to represent real customers.

No live merchant export, customer record, credential, API token, or production
data is included.

## API integration versus CSV fallback

Direct API integration should be preferred when supported because it can provide
structured and current commerce data without requiring merchants to repeatedly
export and upload files.

The CSV fallback is intended for migration, one-time imports, testing, or other
situations where direct API access is unavailable or unsuitable.

The fixture does not claim that API access is unavailable for every Squarespace
merchant or account.

## Out of scope

This fixture does not implement:

* Squarespace authentication.
* Live Squarespace API calls.
* Storefront scraping.
* Automated order synchronization.
* Webhooks.
* A production CSV importer.
* Real merchant-data ingestion.
* Posnic Cloud-only functionality.

All data is synthetic and intended only for local development, testing, and
documentation.
