# Record form completeness

New Unit uses the shared compact dialog. Supplier name/phone and user password/confirmation align in pairs. Missing user permissions are checked inside the user form and reveal the Access tab. Category shape previews use the selected swatch. Checkout settings have a readable maximum width.

New Branch exposes currency, currency display, timezone, date format, optional country-specific tax registration, printing address, website and postal code alongside the existing registers/sharing controls. The API derives currency metadata from reference data and validates regional values before creation. Branch tax validation is isolated from the India-only customer/supplier GST validators. The existing country profile registry remains the source of format rules.

State selection preserves saved values and ignores stale responses. No state is inferred from a city. The tested live shop has an empty saved state and needs its correct state saved on the branch.

## Data and synchronization

All regional values use existing fields on the existing tenant-scoped `branches` collection. Creation still uses BranchModel's existing identifiers, timestamps, user access update and seed/write path. The POS collection manifest, Gateway collection registry and agent config already include `branches` as a global-within-tenant batch lane. There are no new collections or credentials to replicate, no migration, and no change to conflict, deletion or attachment transport. Existing authorized tills receive these fields in the existing whole-document branch transfer. New web-created records become available to offline tills upon reconnection through that existing lane. No Gateway/agent rollout is required. Physical cross-till offline/reconnect delivery was not exercised in this web release; existing sync classification/protocol checks ran in the standard suite.

## Validation

- `npm run check`: all eight checks passed; 4,309 desktop tests passed, five skipped.
- Full API suite: 528 suites passed; 12,891 tests passed, 13 skipped.
- Focused form regressions: 12 passed.
- Branch model/regional focused suite: 173 passed.
- Frontend asset build passed.
- Offscreen browser previews covered light/dark themes, phone/select widgets and mobile overflow.
- Existing receipt/printer behavior is unchanged; standard desktop printer regression tests passed.
