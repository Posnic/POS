# Import Mapping Fixtures

These CSV files are small, fully fictional fixtures for testing the local
Community Edition import/export app.

## Files

- `products-varied.csv` - Product data with intentionally varied column names.
- `customers-varied.csv` - Customer data with intentionally varied column names.
- `invalid-customers.csv` - Invalid customer data used to verify validation errors.
- `EXPECTED_MAPPINGS.md` - Expected source-to-application column mappings.

## How to use

1. Start the POS application locally.
2. Open the Community Edition import/export app.
3. Select the appropriate CSV fixture.
4. Use the column mapping step to map the source columns to the application fields.
5. Compare the resulting mappings with `EXPECTED_MAPPINGS.md`.
6. Use `invalid-customers.csv` to verify that a missing required column is reported
   clearly.

All data in these fixtures is synthetic and intended only for local development,
testing, and documentation. It does not contain real merchant or customer data.

These fixtures do not change database import behavior.
