# Isolated connector transport

Development capability: `connector.requests.v1`. This is not a deployed connector
or a completed migration. Provider routes remain until the replacement passes
cutover acceptance.

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

The transport does not grant the connector access back into POSNIC. Read APIs,
service identity provisioning, connector-owned storage, migration, writer
fencing, offline presentation, and cloud/till acceptance must be completed before
the provider-specific routes are removed or the independent package is activated.

Local checks: `node --test tests/extension-connector.test.cjs` covers operation
permissions, scope/package bindings, disabled/duplicate grants, destination
restrictions, HMAC envelopes, response bounds and no automatic retries.
