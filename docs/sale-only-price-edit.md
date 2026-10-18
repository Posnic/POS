# Sale-only cart price edits

Desktop counter checkout now supplies the authenticated cashier's existing
`price_override` permission to pricing admission. A signed, unexpired manager
approval for the same cashier can also authorize the change. The cart editor
passes that approval separately from discount approval. Payload permission flags
are not trusted. Outlet, price-list and other channel rules remain enforced.
Persisted historical pricing snapshots remain immutable through this path.

The override is saved in the existing sale line and pricing snapshot; the item
catalogue price is not updated. This fixes new counter sales and new lines, not
historical bill repricing. Existing sale audit handling is unchanged.

Synchronization uses the existing branch-scoped `sales` collection in the API
and Gateway, and the bundled sync agent's realtime sales lane. No new collection
or transport fields are introduced. Other authorized tills and the web receive
the saved sale price through that lane; future sales still use the catalogue
price. Approval tokens are request credentials, not shared business settings.
No Gateway or agent change is needed. Live offline/reconnection propagation has
not been exercised for this patch.

Validation: 365 API controller, sale-service and pricing tests; two frontend
regression tests. Cases cover sale-only 100-to-70 pricing without catalogue
mutation, denied staff, forged/expired/wrong-cashier/wrong-action approvals and
channel-specific price enforcement. ESLint reports no errors (existing warnings
remain). Physical checkout on the client's updated installation is still pending.
