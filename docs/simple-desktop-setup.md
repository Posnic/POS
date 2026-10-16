# Desktop setup and local data choices

Manual Windows installs mark the next launch for setup review. Existing shops
can continue with their data, or start fresh while retaining hardware settings
by default. Ordinary launches and silent updates skip this review.

Cloud setup offers a primary branded browser sign-in, a collapsed pairing-code
section, and a separate collapsed custom-server section. The custom endpoint is
used only for that browser authorization attempt; it never changes the default
sign-in or pairing destination. Custom servers must implement the existing
desktop authorization and sync APIs. Community offline setup remains available.

The Windows uninstaller defaults to keeping business data, hardware settings,
and saved backups. Unchecking a choice requires confirmation. Recovery copies
remain even when saved backups are removed; the screen explicitly explains this.
Custom backup locations are not deleted by the uninstaller.

## Recovery and ownership

Fresh setup verifies ownership of the bundled database, stops sync, connectors,
the API, and the database, then saves and hashes the database and its credential
files before removing active data. A database that is still running, a foreign
database, or a failed copy stops replacement. Recovery copies are stored outside
the active database under Documents in the application's Recovery folder.
The uninstaller similarly refuses a running application or locked database and
verifies a full data-folder snapshot before removing business data.

Recovery copies contain unsynced business records and private credentials. They
are not ordinary export files. Recovery requires the original OS account and a
compatible database/application version; automatic restore or upload is not
implemented. Back up the recovery folder securely. Files outside the application
data folder, including custom attachment storage, require their own backup.

Hardware preferences, scales, cash drawers, kitchen settings, setup markers and
recovery copies are local to this computer. There are no cloud device profiles.
Fresh setup removes connector configuration and pending print state so they do
not reconnect to or replay work from the previous shop.

## Synchronization decision

No shared business fields or collection lanes are added. Existing business data
retains its current tenant and branch scope. While the manual reinstall review
is open, sync and connectors do not start. Continuing resumes normal sync after
a graceful restart. Starting fresh disconnects the old identity and retains its
unsynced work only in recovery; it does not upload that work into a new shop.
Deleting local data never emits cloud deletion requests. Web and other tills
therefore remain unchanged by these local choices.

The existing sync agent remains responsible for authenticated identity checks,
checkpoints, record conflict handling and explicit deletion events. Absence of
a cloud record is not newly interpreted as deletion. This implementation does
not repair legacy missing tombstones or decide to upload orphaned local records.
No Gateway or agent changes are required for these setup controls.

## Release verification

Regression coverage includes all eight uninstall keep combinations on Windows,
copy failure without deletion, preserved hardware, database shutdown ordering,
live-process refusal, existing-shop UI and custom/default authentication
isolation. The NSIS custom pages have also been compiled in a standalone harness.
Before a client release, build the branded installer and verify its substituted
data paths, fresh/offline setup, reinstall, uninstall, and cloud reconnection on
an isolated Windows profile. End-to-end live cloud/till delivery is not proven
by these local regression checks.
