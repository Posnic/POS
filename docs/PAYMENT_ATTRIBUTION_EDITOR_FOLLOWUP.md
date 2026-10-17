# Payment attribution and record-editor follow-up

Captain orders retain the creator in `origin.actor_name`. Payment reports previously read only `user_name`, producing literal `undefined`. Sale and return transaction endpoints now prefer saved user_name, legacy created_by, then the original Captain actor name. Frontend rows and exports share this fallback, reject placeholder strings and escape names. No later editor or viewer is substituted. Unknown names show an em dash. Existing bills need no backfill.

Edit User offers an explicit Change Password option. Ordinary edits preserve credentials. Explicit resets validate the password and confirmation, persist the bcrypt hash, and stamp passwordChangedAt to invalidate older sessions. Existing user-write authorization and tenant filters remain. No real account was reset during testing.

Shared record dialogs fit their contents despite legacy inline height styles. Supplier and Units browser checks at 1200px and 390px measured 17px below the buttons without horizontal overflow.

## Earlier reports

Existing regression tests cover branch Save, active-tab preservation, phone binding, saved-state selection, stale country responses, optional country-specific branch tax registration, new branch regional fields, user permission errors, Accountant-role saving, paired passwords and category shape colors. The preceding change restored the desktop menu and table text alignment. Device counts are already unlimited by default.

State defaults use the saved branch, not IP geolocation. Missing state cannot safely be inferred from city. Legacy Core Settings reminder preferences do not implement a sending scheduler; this change does not send messages. Partner venue commission is under Restaurant > Hotels and other venues, with results under Reports > Money > Commission owed. The separate tax calculation foundation remains internal, not a new report screen.

## Sync and rollout

Report attribution is read-only. Branch-scoped sales already carry origin. No migration or new collection is needed. Users already have a global-within-tenant batch lane in POS api/src/sync/collections.json, Gateway apps/sync-gateway/src/collections.js and apps/sync-agent/sync-config.json. Reset uses existing password/passwordChangedAt fields and advances updated_date. The agent transfers whole documents using updated_date/_id checkpoints and last-write-wins. No plaintext password, session or reset command is newly replicated; hashes follow the existing user lane.

Offline tills retain their last synchronized account until reconnect. They need the updated user document before the password/session cutoff applies locally. There are no new deletion or file behaviors. Physical cross-till credential delivery remains unverified. The installed white-label 1.9.2 still contains old branch validation code and uses its own branded stable feed. Source checks do not mean that installation is updated.

## Validation

- Read-only inspection confirmed the original actor on the three reported Captain bills.
- 283 API regressions passed for user model, tenant isolation and Captain transfer; follow-up sale/return attribution checks passed.
- 27 payment/display/export regressions passed.
- Form regressions, frontend production build and offscreen Chromium layout checks passed.

Full local checks: lint, formatting, API docs, packaging and attribution passed when run directly. The final desktop run passed 4,339 tests, with four skipped; its customer-branding guard found a branded name in this note. The name was removed and all six branding tests passed. An earlier stale server-message catalog was corrected and all 51 i18n tests passed on rerun.
