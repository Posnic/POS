# Business on a Community desktop

This mode serves prepared Business summaries from the shop's own desktop database. It does not require a Posnic Cloud account or sync agent. It is an explicit operator configuration, not a second sign-in choice shown every day.

## Supported topology

Use an updated POS desktop that owns the shop database and remains running, with the Business API reached through the operator's HTTPS origin. The mobile app uses Connect your own server and the same browser-consent, PIN, session-revocation and branch-ACL protocol as Cloud. Configure a trusted TLS reverse proxy/private access arrangement; do not expose MongoDB or an unprotected till port. The existing API recognizes forwarded HTTPS only in its production configuration and trusts one proxy hop, so the origin API must only be reachable through that trusted hop. Preserve the public Host and overwrite forwarding headers at the proxy.

Set `POSNIC_BUSINESS_LOCAL_REPORTING=1` in the desktop launch environment. `POSNIC_DESKTOP=1` is set by the Electron runtime itself; do not set it on a Cloud/shared API process to enable report preparation. Multi-tenant processes refuse this mode. Restart the desktop after changing the deployment setting.

Open Today in Business. The API records a bounded preparation request. The desktop worker checks requests on its existing 30-second tick, creates a stable local installation identity, claims unassigned branches and prepares one scoped date at a time. Once available, refresh Today to read the summary. The same work/time limits apply as Cloud desktop preparation; it is not a historical report service.

## Ownership, failure and changing modes

Community mode withdraws the Cloud-agent runtime marker. It never steals a branch already assigned to another publisher. Branch owners can use Reporting desktop to explicitly select a recently connected candidate; assignment epochs prevent an old publisher from overwriting it. Local and Cloud jobs carry separate mode markers so changing deployment mode does not resume the wrong jobs.

Publication reserves a pending snapshot in the assignment, replaces the prepared summary, and clears the pending record. An interrupted write stays unavailable until the desktop recovers it. Replay replaces totals rather than adding them. Requests, prepared records, identity and publisher state do not use generic sales synchronization.

A desktop that is off or a LAN-only origin cannot provide fresh data remotely. A separately hosted mirror that has no reporting desktop is not covered by this topology; it needs the gateway publication path or a separately qualified bridge. Source completeness remains unknown, so the app labels summaries partial/delayed even in Community mode.

Local real-Mongo validation covers request → desktop preparation → prepared read without a sync agent, including a failed summary write and process recreation. Native HTTPS/proxy qualification, production-size checkout performance and operator deployment remain release gates.
