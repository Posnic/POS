# Captain cloud address discovery

Paired desktop tills refresh `/v1/device/identity` on startup, after enrollment and every five minutes. The authenticated gateway resolves the public API URL from its own tenant registry. Desktop verifies the tenant and local branch IDs before caching `captain_cloud_url` on those branches.

Captain discovery, signed-in connections and session routes use `captain_fallback_url` (the explicit manager setting) first, then the verified cached URL. The Captain settings input shows the discovered address as its placeholder when no override is saved. Discovery remains local and does not wait for a cloud call. Offline/old gateways preserve the cache; an explicit null from a verified gateway withdraws it. Captain still requires its existing route proof before sending credentials or orders.

No customer order or payment data is changed. Locally configured tills without cloud enrollment make no new external requests. The sync gateway address is never substituted for the shop API address.

Verification: gateway shop identity tests; desktop refresh/identity tests; Captain real-database integration covering public discovery, signed-in connections, grants and manual override precedence. A production read of the enrolled shop identity and a metadata-only local refresh verified the deployed gateway-to-desktop path.
