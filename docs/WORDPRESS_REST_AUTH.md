# WordPress REST authentication fixture

This is an offline, synthetic contract fixture for reviewing a possible
WordPress REST and WooCommerce data boundary. It is not a WordPress plugin,
connector, or live API client. The test makes no network requests and does not
claim that Posnic supports WordPress or WooCommerce.

## Contract

The fixture models the checks that must complete before protected WooCommerce
data could be read:

1. WordPress REST authentication must be valid.
2. The request nonce must be present and valid.
3. The authenticated principal must have the required capability.

Authentication, nonce, and capability failures return without invoking the
protected-data reader. The test counts that reader's calls so a future change
cannot silently turn a rejected request into a data access.

The cases cover valid authentication, invalid authentication, invalid and
missing nonce, and missing or insufficient capability. Status codes in the
fixture are synthetic contract expectations, not a claim about a particular
Posnic endpoint.

## Synthetic data boundary

Allowed to leave the WordPress side in a reviewed export:

- Synthetic identifiers and example status values used by this fixture.
- The minimum shop-selected WooCommerce fields needed for the reviewed
  workflow, after removing unnecessary personal and payment information.
- Aggregated or redacted test results that cannot identify a shop or person.

Must remain local to WordPress and must never be placed in fixtures, logs,
documentation, commits, or requests from this test:

- Passwords, application passwords, cookies, bearer tokens, REST credentials,
  and real nonces.
- Customer names, contact details, addresses, payment data, order exports,
  production logs, and database dumps.
- Any real WordPress, WooCommerce, Posnic, or shop credentials.

The values in `tests/fixtures/wordpress-rest-auth.json` are deliberately
symbolic strings such as `synthetic-valid-nonce`; they are not credentials.

## Official references

- [WordPress REST API authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [WordPress REST API handbook](https://developer.wordpress.org/rest-api/)
- [WooCommerce REST API documentation](https://woocommerce.github.io/woocommerce-rest-api-docs/)

These references describe the provider concepts represented by the fixture.
They do not turn this offline test into a provider integration or authorize any
live request.
