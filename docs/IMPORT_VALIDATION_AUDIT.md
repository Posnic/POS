# CSV import validation audit — 29 September 2026

Reviewed the active item, customer, supplier, item-category, customer-category
and expense import handlers and the shared desktop/web CSV upload code.

## Changes

- Customers and suppliers may omit email. Startup repairs legacy unique email
  indexes to enforce uniqueness only on non-empty strings. The replacement is
  created before old indexes are removed. Existing conflicting real email
  addresses require data repair; the migration does not delete records.
- Contacts validate the file before saving, normalize email/whitespace, preserve
  leading-zero phone numbers, reject conflicting duplicate rows and check real
  email conflicts. Customer imports no longer discard validation errors.
- Item numeric fields accept complete decimal values and correctly grouped
  thousands (including Indian grouping). Invalid text no longer becomes zero
  or a numeric prefix. Tax mode and percentage ranges are validated. Conflicting
  duplicate item identities are rejected. Barcode preflight remains in place.
- Item, supplier and expense plan limits reject oversized imports rather than
  silently importing a subset.
- Category discounts and expense amounts reject malformed/non-finite values.
  Blank category names and conflicting category rows are reported. Customer
  category names such as `constructor` no longer disappear through object-key
  collisions.
- Shared CSV parsing supports quoted multiline values, escaped quotes, BOM and
  CRLF. Malformed quoting, column counts and duplicate headers are rejected.
  Alias collisions cannot silently overwrite a field. Literal quotes are
  preserved. Uploaded values are escaped in the result table, and contact row
  errors use the same persistent error table as item imports.

## Verification

- 598 focused API Jest tests passed across seven suites.
- 26 Node tests passed, including isolated real MongoDB tests for optional-email
  index repair, barcode collisions, numeric preflight and image-preserving item
  re-imports. Tests use the bundled MongoDB 7.0.14 binary, not the shop database.
- 14 frontend/template tests passed, including all shipped CSV templates and
  multiline/quoted input. JavaScript syntax check passed.

## Limits and release status

### International number and CSV formats

The follow-up adds decimal commas and semicolon/tab-separated CSV, including
Excel's `sep=;` directive. The shared numeric parser accepts `1234,56`,
`1.234,56`, `1 234,56`, non-breaking grouping spaces, Swiss apostrophes and
`1,234.56`. This applies to imported item numbers, contact balances, category
discounts and expenses. Phone numbers, SKUs and barcodes remain text.

Ambiguous strings `1,234` and `1.234` now fail validation: neither is silently
interpreted as a thousand or a decimal. Use `1234` for the integer or
`1.2340` / `1,2340` for the decimal. The import dialog explains this. Values
containing commas in a comma-separated file must be quoted; semicolon-separated
files can contain decimal commas directly. Unsupported numeric text is rejected.

Follow-up verification: 595 API tests across six affected suites and 34 Node
tests passed. The real MongoDB test exercises the frontend semicolon parser
through item import and verifies saved prices, tax and fractional stock.

Preflight validation is not a database transaction. A database outage or a
concurrent database constraint violation during saving can leave partial writes.
Item and contact failure messages include saved counts when available; review
the records before retrying. Existing records are not globally rewritten.

These changes are in source only. The earlier receipt-test 1.8.0 installer does
not contain this import audit or the optional-email index repairs. No CI workflow
was added and no customer database was modified during verification.
