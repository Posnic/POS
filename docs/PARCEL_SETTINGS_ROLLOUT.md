# Optional parcel details and packaging presets

Product `parcel_details` stores weightKg and packed-unit lengthCm/widthCm/heightCm.
Missing or cleared measurements are null. Older clients that omit the field do
not clear existing values. Saving measurements has no stock, price or courier effects.

Core Settings > Inventory > Packaging stores optional `parcel_cartons` through
the scoped channels endpoint. Defaults are empty. Up to 50 presets have stable
IDs, unique names, positive dimensions and nonnegative empty-box weight. Removing
a preset explicitly saves the updated list; no sample dimensions are invented.

## Synchronization

Product metadata uses the existing items lane. Cartons use `branch_channels`,
scoped by branch_id/license and updated_date, with the existing legacy branch
mirror. Roll out matching Gateway and sync-agent collection configurations before
claiming device delivery. Account defaults retain existing inheritance behavior;
an explicit empty branch list overrides defaults. No jobs, secrets or effects are
replicated. Offline devices see their local records and use the existing conflict
handling on reconnection. Clearing a product measurement writes null.

## Extension contract and acceptance

The generic connector context read API exposes authorized linked-product
measurements and carton presets. Consumers choose whether to use them; a hint
never saves packing or submits a delivery. Missing measurements remain unknown.

Validation includes measurement/carton bounds, settings persistence and timestamp
checks, cached-form compatibility, and sync-manifest agreement. Actual
cloud-to-till, till-to-cloud, second-till, reconnect, concurrent edits, removals
and branch isolation must be verified on the intended installer and devices.
Configuration checks alone do not establish those results.
