# Sold-out catalogue visibility

An imported catalogue with tracked items and zero opening stock previously
appeared empty in New Sale. The tile API, name search and category lookup
filtered those records before rendering. Catalogue existence must remain
visible separately from permission to sell a quantity.

The sale grid and name search now include zero/negative balances. Categories
remain visible when their last item sells out. Deleted records, tenant/branch
boundaries and tile expiry filtering remain enforced. Tiles show the stock
status, and selecting an unavailable tracked product displays an error.
Existing allowed-negative, untracked, service and return behavior is retained.
Server sale quantity validation remains authoritative. No stock is invented,
no tracking setting is changed and no migration balance is written.

## Verification

- `node --test tests/sold-out-catalogue.test.js tests/sales-tile-pages.test.js tests/shared-barcode-selection.test.js tests/item-zero-stock.test.js`: 24 tests passed.
- `tests/sales-tile-database.test.js`, against an isolated local MongoDB: four tests passed, including pagination, zero-stock search, category visibility and branch/license exclusion.
- Targeted API lint: no errors; existing repository warnings remain.
- Live cloud verification: the affected billing API changed from an empty result to 48 products and a next-page cursor. Browser verification confirms product cards appear.

## Synchronization and rollout

This is a read/display change. No persisted field, stock movement, timestamp,
checkpoint, delete operation or synchronization lane changes. Existing `items`
and `categories` lanes are branch-scoped in the POS, Gateway and sync-agent
manifests. There is no new action to replay after reconnecting.

Cloud readers require the updated API and frontend. Desktop readers require
the same code in their bundled API/frontend; cloud deployment alone does not
update an installed desktop build. Live offline/reconnect and other-till
verification have not been performed. Existing quantity synchronization and
server sale validation are unchanged.

The cloud hotfix backs up the three changed production files before applying
only the relevant patch. The affected account routes to a shared shard, so
the shard must reload to pick up API changes; its stopped legacy per-tenant
process is not the serving process. Do not change routing or create a second
active authority to apply this fix.
