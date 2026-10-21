# Shopify multi-currency order amount fixture

This directory contains synthetic Shopify order amount fixtures for issue #413.

## Scope

The fixture documents a proposed mapping for Shopify orders with
different shop and presentment currencies. It does not implement
a Shopify connector or process real orders or payments.

All order identifiers and monetary amounts are synthetic.

## Currency mapping

Shopify exposes monetary values using shop and presentment currencies.

- **Shop currency:** the store's currency.
- **Presentment currency:** the currency shown to the customer.
- **Posnic sale total:** use the shop-currency order total.
- **Posnic reports:** use the shop currency for monetary totals.
- **Presentment amounts:** preserve separately as reference metadata.

These are proposed import-contract expectations, not claims about
existing Posnic connector behavior.

The fixture does not calculate exchange rates or convert amounts
between currencies.

## Amount calculation

For the synthetic examples, totals follow:

`subtotal + tax - discount + shipping = total`

The test suite performs calculations in integer minor units
(cents for the EUR and USD examples) to avoid floating-point errors.

This formula describes the fixture's simplified examples. It is not
intended to cover every Shopify tax, refund, duty, or discount model.

## Scenarios

| Scenario               | Description                        | Expected behavior                          |
| ---------------------- | ---------------------------------- | ------------------------------------------ |
| `same_currency`        | EUR shop and EUR presentment       | Import shop total                          |
| `different_currencies` | EUR shop and USD presentment       | Use EUR for sale and reports; preserve USD |
| `rounding`             | Decimal amounts in both currencies | Validate totals in integer cents           |
| `currency_mismatch`    | Missing presentment total          | Require manual review                      |

## Manual review

An order requires manual review when required currency or amount
information is missing or inconsistent.

For the `currency_mismatch` example, the presentment total is absent.
The expected sale total is therefore `null` and `review` is `true`.

This is a conservative fixture policy; it does not imply that
Shopify or Posnic automatically rejects such orders.

## Limitations

- No real Shopify orders, credentials, API calls, or payments.
- No exchange-rate provider integration.
- No payment settlement reconciliation.
- No refund, duty, or chargeback handling.
- No production import or reporting implementation.
- Only EUR and USD examples, both using two decimal places.

## Run the tests

From the repository root:

```sh
node --test tests/shopify-multicurrency-order-fixture.test.js
```

The tests validate synthetic identifiers, currency scenarios,
amount arithmetic, reporting expectations, rounding, and
manual-review behavior.
