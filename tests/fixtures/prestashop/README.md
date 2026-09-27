# PrestaShop Shipping Fixtures

Synthetic fixtures for issue #427.

These fixtures document how PrestaShop order carrier, tracking, shipping-state,
and cancellation information should be preserved during a future order import.

## Files

- `shipping-statuses.json` - synthetic shipped, cancelled, and unsupported-state examples.
- `EXPECTED_MAPPING.md` - source-to-Posnic mapping and manual-review boundary.

## Covered cases

1. Shipped order with carrier and tracking reference.
2. Cancelled order without a tracking reference.
3. Unsupported order state requiring manual review.

## Scope

This directory contains fixture data and documentation only.

It does not implement:

- a live PrestaShop connector
- PrestaShop authentication
- API calls
- webhook handling
- shipping-label purchasing

All identifiers and tracking references are synthetic.
