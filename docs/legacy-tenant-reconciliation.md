# Legacy tenant reconciliation

`scripts/migrate-legacy-tenant.js` refreshes the old shared POS into one explicitly selected Core database. It is an administrative migration tool, not bidirectional replication. It never writes to the old database, provisions an owner account, changes a route, drops an index or invokes business operations.

## Run safely

Supply `SRC_MAIN` and `DEST_URI` through the operator's protected environment. `SOURCE_DB` defaults to `PosnicPro`. The manifest is an array of `{company,license,subdomain,tenantDb}`; database names must start with `posnic_t_`. A missing destination requires `--allow-new-database`. Do not put URIs in command-line arguments or a committed manifest.

```sh
node scripts/migrate-legacy-tenant.js --only=hmfuniform --manifest=/private/targets.json --report=/private/plan.json
node scripts/migrate-legacy-tenant.js --apply --only=hmfuniform --manifest=/private/targets.json --resolutions=/private/resolutions.json --apply-tombstones --backup-dir=/private/backups --report=/private/result.json
```

The default, and `--dry`, compare actual source and destination documents without any database writes. Incremental `--since` is intentionally rejected: legacy stock changes may not update the item timestamp. Write mode requires one tenant and a backup directory. An unclassified source collection blocks the run and appears in the inventory report. Missing source branches/users or a foreign license in the destination also block the run.

Before writing, the tool snapshots every existing destination collection and its indexes to gzip-compressed canonical Extended JSON files. It uses a private directory (0700) and private files (0600) on Linux. Backups contain business data and password hashes; restrict access and retention accordingly. A separate write-ahead journal contains exact pre/post images and is flushed/fsynced before each write. No backup or journal belongs in Git. Apply does not drop indexes or swallow duplicate-key failures.

## Preserve Core's schema

Updates merge source-known fields and retain destination-only fields, including nested objects. Branch-keyed arrays merge fields for retained branches without restoring removed branch membership. Stable BSON IDs, license and historical transaction amounts are copied unchanged. Blank optional email values are normalized to absence. A legacy blank never erases a nonblank contact address added in Core.

The legacy item editor may save `unit_id` as a hexadecimal string where Core retains an ObjectId. For existing Core ObjectId fields the importer converts valid hex references to ObjectId only when the unit is present in the source tenant's scoped catalogue. This preserves Core's representation, supports genuine unit changes and blocks unknown references instead of treating every type difference as safe. Other unreviewed type/shape changes remain conflicts.

A blank legacy unit ID also does not erase an existing valid Core reference when both item unit labels are unchanged and that exact Core ID resolves to the same label in the scoped source catalogue. The tool never guesses an ID by name among duplicate unit labels.

New source rows are inserted. Existing rows with later source timestamps can update; later destination timestamps, equal timestamps and missing timestamps become conflicts. A changed Core field shape also blocks automatic updates even when the source timestamp is newer. There is no blanket force/source-authoritative flag. A report includes only IDs, changed field names, counts and SHA-256 fingerprints, never document contents or credentials.

An operator can supply reviewed decisions keyed by `collection/id`:

```json
{
  "items/0123456789abcdef01234567": {
    "source": "exact-source-document-fingerprint-from-plan",
    "destination": "exact-core-document-fingerprint-from-plan",
    "keep": "source",
    "reason": "Later stock-ledger movement proves the legacy quantity"
  }
}
```

`keep: destination` explicitly retains Core's version. Both fingerprints must still match. A changed row invalidates the decision. Even a reviewed decision cannot cross license boundaries. Updates use a full-preimage compare-and-set filter: a concurrent change, including a newly added Core-only field, prevents the update. Source batches are re-read before writes, and a final full comparison detects source drift, missed rows, conflicts and incomplete writes. There are no blind retries after an uncertain write; rerun the comparison and build a fresh plan.

## Deletions and recovery

Destination-only rows are preserved. They are eligible for deletion only when the old system has a matching license-scoped `recycle_bin` entry with the same `_id`, the correct collection, a valid `document_backup_date`, and no later destination edit. The source row must still be absent. Actual removal additionally requires `--apply-tombstones`. The preimage and tombstone are journaled before a conditional delete. Absence alone never means delete.

To recover, inspect the private journal and restore only entries whose current document still matches the recorded postimage, under the same database/license. Do not restore an entire snapshot over transactions accepted afterward. The snapshot and journal are recovery evidence, not permission to overwrite newer data. Before customer cutover, agree a short stop on legacy writes, rerun the complete comparison, apply, verify and then change access/routing. Continuing writes in both independent systems cannot produce a stable final parity point.

## Sync and execution boundaries

Existing business collections keep their IDs and existing POS/Gateway/agent scope decisions. The importer writes snapshots directly; it does not re-execute sales, stock movements, payments, receipts or messages. No new shared application collection or persisted setting is introduced. Legacy `data_change_log`, provider/payment integration credentials, sessions and control-plane account state are excluded. Existing Core-only data in excluded collections remains intact. Legacy journal counts therefore are intentionally not mirrored. The operator's private filesystem backup/journal is local migration recovery data and must never be synced to tills.

`recycle_bin` has an existing branch sync lane and supplies deletion provenance. Copying rows through this tool does not invoke Gateway delete handlers; explicitly approved tombstones are handled with the guarded rule above. Do not reset agent checkpoints or manufacture ordinary change-journal entries from imported history. Legacy `customer_category`, `denomination`, `transaction` and `payment` still have pre-existing undecided cloud/till lanes: migration preserves their server data, but does not falsely certify their cross-till delivery. Their lane rollout is separate from this administrative copy. No Gateway/agent protocol is changed here.

After a server import, verify the intended installed agent's initial/resume behavior, cloud-to-till and till-to-cloud visibility, another authorized till, offline/reconnect, deletion propagation and referenced images/attachments before declaring a client converted. The tool's database verification alone is not evidence that a physical till received the changes. Owner activation/login, current API read behavior, regional/currency settings and images also need cutover checks.

## Local checks

`node --test tests/migrate-legacy-tenant.test.js` exercises a real disposable MongoDB plus pure policies: read-only default, explicit apply scope, tenant boundaries, schema preservation, blank email semantics, version-bound decisions, backup fidelity, write-ahead records, CAS concurrency, tombstones and idempotent reruns. These tests do not use production.
