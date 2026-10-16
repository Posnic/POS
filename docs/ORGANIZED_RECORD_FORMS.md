# Organized record forms

The record editor keeps existing input IDs, names, validation, permission controls and save handlers. Customer, supplier, category, user and new-branch editors use a centered 820px dialog on desktop and a full-width sheet on phones. Header and actions remain visible while scrolling. User access and branch setup have separate sections; all sections are revealed before validation so required inputs cannot be skipped. Category shapes are labelled buttons with actual shapes and pressed state.

Sales preferences are grouped into Checkout, Product search, Receipts & sharing and Controls. The existing Core Settings save operation still owns their values. Hardware configuration remains in the app; independent recovery windows remain available through Electron. The floating Desktop menu is removed. Mobile devices retain `settings/devices`; desktop hardware uses `settings/hardware`, eliminating duplicate pane and navigation IDs.

New customers, suppliers and branches start with the current shop's country, state and city. Edits keep the record's saved location. A manually changed country clears the state selection until the user chooses one; an older state-list response cannot overwrite a newer request. A missing shop state is left blank instead of guessing the first state. Branch creation and the legacy branch editor now persist the existing `branches.city` field; requests that omit city preserve the saved value.

## Data and synchronization

- No new collections, permission grants, print modes or payment writes are introduced.
- `customers`, `suppliers` and `categories` retain their existing branch-scoped lanes in POS `api/src/sync/collections.json`, Gateway `apps/sync-gateway/src/collections.js` and agent `apps/sync-agent/sync-config.json`.
- `branches.city` already belongs to the whole branch document. The three manifests already include `branches` as global within the licensed installation, with Gateway access filtering. No new transport or migration is needed. This change supplies the field during creation and legacy editing, without changing its replication.
- Existing IDs, timestamps, conflict resolution, tombstones and uploaded-file paths are unchanged. New form grouping does not change serialization or upload handlers. User access and credentials retain their existing authority and are not newly replicated.
- `city_setting` is a local cache of the active shop response, refreshed alongside country and state; the branch document remains authoritative. Draft forms stay local until the existing Save action is used.
- Expected delivery is unchanged: a saved business record reaches cloud and authorized tills through its existing lane, including queued changes after reconnect. Live multi-device create/update/delete and reconnect delivery were not exercised in this change; matching manifests are not proof of delivery.

## Release

Ship the API city persistence change and frontend assets together. Electron menu organization needs the next desktop installer; the web form layout does not. Preserve independent recovery windows. Do not publish the desktop latest channel before the requested private installer test.

Local verification includes actual-template DOM regression tests for control ownership and values, tab validation, state-selection races, existing phone/permission/settings tests, API branch creation, translation coverage, frontend build, and isolated Electron-rendered layout previews. These previews do not save live shop records.
