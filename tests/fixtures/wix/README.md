# Wix Product Option Fixture

## Scope

This fixture provides synthetic Wix Stores product options and variants for
future product synchronization work.

It does not make live Wix API calls and does not implement a Wix connector.

## Official Wix documentation

The fixture is based on the Wix Stores Catalog V3 product model.

- Wix Stores introduction:
  https://dev.wix.com/docs/api-reference/business-solutions/stores/introduction

- Product options and variants:
  https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/about-product-options-and-variants

- Products V3:
  https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/introduction

- Query Products:
  https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products

## Synthetic product

The fixture contains one synthetic product:

- Product: `Classic T-Shirt`
- Option 1: `Size`
  - `Small`
  - `Large`
- Option 2: `Color`
  - `Red`
  - `Blue`

The four option combinations are represented as separate synthetic variants.

## Expected Posnic mapping

The repository already uses the following item fields in its import fixtures:

- `SKU` -> `itemid`
- `Barcode` -> `barcode_id`

The existing variant-linking script also uses:

- `variant_group_id`
- `variant_axis`
- `variant_value`
- `variant_parent_name`

For this fixture, the expected future mapping is:

| Wix data | Expected Posnic mapping |
|---|---|
| Product name | `variant_parent_name` |
| Option combination | `variant_value` |
| Variant family | `variant_axis` |
| Variant SKU | `itemid` |
| Variant barcode | `barcode_id` |

For example:

`Small + Red` becomes the synthetic variant value `Small - Red`
under the parent product `Classic T-Shirt`.

This fixture documents an expected mapping for future connector work. It does
not claim that a Wix connector implementing this mapping already exists.

## Missing SKU and barcode behavior

A missing SKU must not result in an invented identifier.

- Missing SKU -> `itemid` remains unset and the variant is marked for review.
- Missing barcode -> `barcode_id` remains unset.
- Missing SKU and barcode -> both remain unset and the variant is marked for review.

The synthetic variant ID remains available for fixture-level identification.

## Unsupported areas

This fixture does not establish or implement:

- live Wix API calls;
- Wix authentication or installation;
- a production Wix connector;
- automatic product synchronization;
- SKU generation;
- barcode generation;
- Posnic Cloud-only functionality;
- platform certification.

All identifiers in this fixture are synthetic and intended only for local
development, testing, and documentation.

It contains no live credentials, merchant data, or customer data.
