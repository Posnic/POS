# WooCommerce Product Image Fixture

## Scope

This fixture provides synthetic WooCommerce product image metadata for future product synchronization work.

It covers primary and gallery images, missing references, duplicate images, and oversized image metadata.

It does not make live WooCommerce API calls, download images, or implement media synchronization.

## Official WooCommerce documentation

The fixture follows the product image structure described in the WooCommerce REST API documentation.

- WooCommerce REST API documentation:
  https://woocommerce.github.io/woocommerce-rest-api-docs/

- Products API:
  https://woocommerce.github.io/woocommerce-rest-api-docs/#products

WooCommerce products can contain multiple images, each with its own ID, source URL, and position.

The fixture uses these fields to describe the expected mapping without requiring access to a WooCommerce store.

## Synthetic products

The fixture contains four synthetic products:

| Product | Scenario |
|---|---|
| Sample T-Shirt | Primary image and gallery image |
| Missing Image Example | Image without a source URL |
| Duplicate Image Example | Repeated image ID and URL |
| Oversized Image Example | Image exceeding the fixture's example size threshold |

All product IDs, image IDs, URLs, and file sizes are synthetic.

Image URLs use `example.com` and are not intended to point to actual product media.

## Expected Posnic mapping

The following mapping is proposed for future WooCommerce connector work:

| WooCommerce data | Expected handling |
|---|---|
| First image (position 0) | Primary image reference |
| Additional images | Gallery image references |
| Image ID | Preserve as provider metadata |
| Image source URL | Preserve as an external reference |
| Missing source URL | Skip the image reference |
| Duplicate image ID or URL | Keep the first valid reference |
| Oversized image | Flag for review |

These expectations describe the fixture contract, not existing connector behavior.

The fixture does not introduce new Posnic database fields or assume that the current import pipeline supports image synchronization.

## Primary and gallery images

The first image, at position `0`, is treated as the primary product image.

Additional images are treated as gallery references.

Image ordering is preserved through the `position` field.

The fixture stores image metadata only. It does not download, transform, or store image files.

## Missing image references

An image without a source URL is skipped.

The product itself remains eligible for import, and other valid image references are unaffected.

Missing URLs are not replaced with generated or placeholder URLs.

## Duplicate image references

Duplicate image IDs or source URLs within the same product should not create additional image entries.

The first valid occurrence is retained, and subsequent duplicates are marked as `skip_duplicate`.

Deduplication is scoped to each product. Images shared across different products are not covered by this fixture.

## Oversized images

The fixture uses a 5 MB threshold (`5242880` bytes) as an example for testing oversized image handling.

References exceeding this threshold are marked as `review_oversized`.

This is a fixture-level assumption, not a documented WooCommerce limit or an established Posnic import restriction.

The `size_bytes` values are synthetic. No network requests are made to verify actual image sizes.

Production size limits and validation behavior would need to be defined separately before implementing media synchronization.

## Provider-specific behavior

The following areas remain outside the fixture's scope:

- WooCommerce authentication and API access
- Remote image availability and permissions
- Image format and actual file size validation
- Media downloads and uploads
- Thumbnail generation and compression
- CDN integration and caching
- Image updates and deletion handling
- Retry behavior for failed media requests

These operations require provider-specific implementation and are not tested here.

## Integration boundary

This fixture documents expected image reference handling for future connector development.

It does not implement a WooCommerce connector, perform live synchronization, or modify the existing Posnic import pipeline.

No real merchant data, copyrighted product images, credentials, or downloaded media files are included.

All test data is synthetic and intended for local development and testing.

## Running the tests

From the repository root:

```bash
node --test tests/woocommerce-product-image-fixture.test.js
```

The tests validate the fixture structure, image roles, missing references, duplicate images, oversized images, and documentation.
