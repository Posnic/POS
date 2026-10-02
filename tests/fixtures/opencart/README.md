# OpenCart Option Price Adjustment Fixture

Synthetic fixture data for OpenCart product options that modify the
charged product price.

## Scope

This fixture covers:

- Base product prices.
- Positive option price adjustments.
- Negative option price adjustments.
- Multiple quantities.
- Expected line-item totals.
- Synthetic discount and tax examples.
- Unsupported option combinations.

The data is synthetic and does not contain real merchant, customer, or order
information.

## Price adjustment model

For these fixtures:

charged unit price = base price + option price adjustment

line subtotal = charged unit price × quantity

Example:

- Base price: $50
- Option adjustment: +$5
- Quantity: 2
- Charged unit price: $55
- Line subtotal: $110

A negative adjustment works the same way:

- Base price: $50
- Option adjustment: -$3
- Quantity: 2
- Charged unit price: $47
- Line subtotal: $94

## POS line-item mapping

The fixture documents the expected mapping into the POS sale-line model:

| Fixture value | POS field |
|---|---|
| Quantity | `item_quantity` |
| Charged unit price | `unit_price` / `item_base_price` / `item_price` |
| Discount amount | `discount_amount` |
| Tax amount | `tax_amount` / `item_tax` |
| Expected line total | `total` / `total_amount` / `line_total` |

The POS bill-generation code treats the displayed line amount as the charged
unit price multiplied by quantity and displays tax separately.

## Tax and discount example

The final order fixture demonstrates:

- Charged unit price: $55
- Quantity: 2
- Line subtotal: $110
- Discount: $10
- Taxable amount: $100
- Synthetic tax rate: 10%
- Tax: $10
- Expected line total: $110

This is a fixture expectation for connector testing, not a claim that every
OpenCart installation applies tax and discounts using identical configuration
or calculation settings.

## Unsupported combinations

`unsupported-option-combinations.json` contains option selections that are
not defined by the synthetic product.

These should be rejected rather than silently assigned an unknown price
adjustment.

## OpenCart documentation

OpenCart documents product options and price adjustments in its admin
documentation. Option values can specify additional or reduced prices.

- [OpenCart Options](https://docs.opencart.com/admin-interface/overview/options)
- [OpenCart Product Form](https://docs.opencart.com/admin-interface/overview/products/product-form-tabs)
- [OpenCart Orders](https://docs.opencart.com/admin-interface/sales/orders)

The fixture intentionally does not implement:

- OpenCart API authentication.
- A live OpenCart API client.
- Live merchant data.
- Storefront scraping.
- Order synchronization.
- Webhooks.
- Credential handling.

The fixture is intended to support connector mapping and deterministic tests.
