# Messaging permissions

Messaging uses explicit, default-off grants for WhatsApp, SMS, email, bulk sending, history, provider settings, scheduled reports and automatic messages. General branch write access does not grant messaging access. The tenant owner retains full access. Assign grants through Roles; existing staff need explicit opt-in.

Bulk sends require both bulk and the selected channel. Receipt endpoints and legacy send endpoints enforce the channel grant server-side. Report tests require report management and the stored schedule channel. Workers recheck the report/campaign owner's current permissions and branch access before sending. Campaign access is restricted to the active branch. API failures are not delivery confirmations.

## Synchronization and authority

Effective permissions are stored in tenant-scoped `users.access.messaging`; role updates write `users.updated_date`. The existing global `users` lane carries the complete access snapshot through Gateway and the agent, without an additional collection or secret. No schema filtering strips these fields. Receiving installations authorize from the synchronized user snapshot, not a local role lookup.

Role templates remain installation-owned administrative templates. Manage a role and its assigned users on the installation that owns the role; saving an assignment whose role is unavailable is rejected instead of silently falling back to permissive defaults. Templates are not merged by name across tills. Removing an unassigned template does not change effective user permissions. Revocation updates the user snapshot; an offline till retains its last snapshot until synchronization reconnects. This is eventual synchronization, not immediate offline revocation. Avoid simultaneous permission administration on multiple installations because the existing users lane resolves conflicts by update time.

`campaigns.scheduled_by` is execution ownership metadata on the authoritative sending installation. Campaigns and report execution state remain local so replication cannot replay sends. Pre-existing campaigns without a recorded owner cannot run automatically until explicitly rescheduled. No provider credentials, execution leases or outbound jobs were added to replication.

## Verification boundaries

Unit and browser-DOM tests cover strict grants, legacy endpoints, channel separation, cross-branch campaign access, revoked schedule ownership and inaccessible UI sections. Existing user transport does not require a Gateway/agent format change. A physical offline till reconnect test is still required before advertising cross-device revocation as verified. This change does not add the proposed customer-detail workspace or customer-list bulk composer.
