# Desktop restaurant sale deletion

Desktop KOT uses the same payment journal as Captain. The old delete path called
the ordinary edit guard, rejecting a settled desktop bill, then hid the 409
reason behind a generic 404. Payment projection also incorrectly labelled every
collection "Collected in Captain".

The separate deletion guard permits a fully projected, single-sale paid journal
through the existing super-admin hard-delete and retained-Recycle-Bin workflow.
One paid restaurant sale is processed per request. It holds both the sale and
payment journal during cleanup, retains the journal as deleted, and rejects old
payment retries, including reconciliation passed a stale journal snapshot.
Successful deletion uses the existing stock restoration, register cleanup and
Recycle Bin tombstone. No payment-provider refund is initiated by hard deletion.

Missing local journals, shared bills, returns, corrections and unfinished
payments remain conflicts. The response explains the reason. A failure before
cleanup releases the locks; a failure after cleanup begins stays locked for
operator reconciliation, because blindly retrying stock restoration is unsafe.
This is not automatic crash recovery or a repair of previously deleted records.
Backups exclude temporary edit locks. Restoring a backup does not reactivate the
deleted payment journal or permit old collection requests to run again.

## Synchronization and rollout

Sales and recycle_bin already use branch-scoped lanes in the API, gateway and
agent configuration. The new states and lock token belong to the existing
local-only captain_payment_plans journal on the payment-collecting installation.
Do not replicate or recreate that execution journal on another installation.
Deletion must run where that journal exists; other installations receive the
normal sale tombstone. Existing sale IDs and allocation/payment IDs are retained.
The generic Payment recorded label is carried by the existing sales projection.
No new collection, gateway configuration or agent execution path is introduced.

An interrupted deletion can leave cleanup incomplete and requires review of its
backup/tombstone, stock and register state before releasing locks. Live cross-till
delivery, actual installed-agent behavior and desktop installer rollout are not
verified by the local tests. The separately authorized Azure cleanup is recorded below.

Regression coverage uses MongoDB fixtures for desktop collection, deletion of
non-menu and tracked items, stock restored once on repeated delete, retained
backup/payment journal, register removal, stale payment replay, concurrent
deletion, failed backup, failure locks and foreign/missing/shared journals.

## Azure owner-requested cleanup, 18 October 2026

The owner explicitly requested hard deletion of SB1D43-27-000549 (105),
SB1D44-27-000558 (242), and SB1D44-27-000559 (315). The three cloud sales
were matched by tenant, branch, license, ObjectId, bill number and amount.
All were paid with zero pending balance; none had returns/corrections,
tracked inventory, cloud wallet transactions or register references.
Their payment journals were absent in the cloud and originated on two tills.

An operator-only repair retained a verified EJSON backup under
`/home/ubuntu/backups/azure-three-sales-20261018/sales.ejson`, wrote full
branch-scoped recycle_bin deletion markers with fresh timestamps, and
hard-deleted the three cloud sales with version/time guards. Verification:
zero target sales, three deletion markers. Existing delete propagation was
already enabled; no tenant sync settings were changed. No payment refund was
issued. Delivery to the two physical originating tills has not been verified.

The normal application continues to require the collecting installation's
journal for deleting a paid bill. This exceptional owner-authorized cleanup
does not add a general bypass for missing journals. The permanent guard and
error feedback fixes are now included with the kitchen/menu source changes;
no installer was built for this cleanup.
