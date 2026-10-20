# Isolated connector transport

Capabilities: `connector.requests.v1` and `connector.context.v1`. These generic
host contracts allow a separately supervised connector to serve a signed UI.
Provider SDKs, polling, documents and business workflow handlers belong in the
connector repository, not in POSNIC routes or its shared API process.

A signed package declares `connectorOperations`, mapping operation names to
`read`, `write`, or `manage` permissions. Every operation also requires `read`.
The frame calls `connector` with `{operation, payload}`. The generic host route
is `POST /extensions/v1/:extensionId/connector`.

The existing staff authentication, branch authorization, package digest approval
and lifecycle checks run before transport. No extension code is loaded by this
transport. The host sends a signed JSON envelope to a separately supervised
process. It does not send browser cookies, POS login tokens, Mongo credentials,
filesystem paths or database handles.

An operator provisions `POSNIC_EXTENSION_CONNECTORS_FILE`, an absolute path to
a private JSON array. Each entry contains `enabled`, `extensionId`, `license`,
`branchId`, `packageDigest`, `endpoint`, and `secretFile`. There must be exactly
one matching enabled entry. The endpoint must be
`http://127.0.0.1:<port>/v1/requests`; redirects, other hosts, credentials, query
parameters and other paths are rejected. `secretFile` contains 32–256 random
bytes. Neither configuration nor secret belongs in a package or source control.

Requests contain protocol version 1, a fresh request ID, issuance time, package
identity, trusted scope, staff identity and permissions, operation and payload.
`x-posnic-signature` is HMAC-SHA256 over the exact request body. The connector
must verify signature, expiry, scope, package and durable replay protection
before dispatch. Responses correlate the request ID and wrap the result.

The host bounds requests to 768 KiB, responses to 4 MiB, and the complete HTTP
exchange to 15 seconds. It never retries. Provider command journals remain
responsible for uncertain writes and readback; a transport timeout does not
establish whether a provider accepted a command.

## State and synchronization

Transport is stateless. Operator connection grants and secrets are host-local
execution configuration, not till business data, and must not be replicated.
Each request rechecks the configured binding. Removing a grant blocks subsequent
requests; it cannot cancel an already dispatched external action.

The transport itself does not grant access back into POSNIC. An operator may
provision a dedicated API user with only `extensions.read`, and bind its ID as
`connectorReaderId` on one installation approval. That identity can only call
`GET /extensions/v1/:extensionId/connector-context`. The endpoint supports bounded
`state`, `products`, `parcels` and staff `authorization` reads. Other extension
routes reject API keys. Every read checks installation digest, branch, lifecycle,
reader activation and permission. The authorization resource rereads the actual
staff identity so a connector cannot rely on stale browser permissions.

Connectors must use their own database credentials, restricted to their own
storage, and an OS service account without access to POSNIC source or secrets.
Installing a ZIP does not provision arbitrary server code or database access.
Connector deployment remains an operator action; an uploaded signed UI can only
request operations that its manifest declares and its operator grant permits.

Cloud data has one authoritative connector. Tills require an authenticated cloud
connection for connector operations. A local host with no connector grant fails
closed; it must not start its own importer or replay partner writes. This contract
does not itself implement offline caching or prove cross-till rollout.

Upgrade requirements: preserve the versioned capabilities, separately installed
package root, operator grants and connector service. Incompatible packages are
rejected rather than silently run against a different API. Test ordinary core
upgrades with the same installed extension and data; source separation alone is
not sufficient acceptance evidence.

Local checks: `node --test tests/extension-connector.test.cjs` covers operation
permissions, scope/package bindings, disabled/duplicate grants, destination
restrictions, HMAC envelopes, response bounds and no automatic retries.
