# Business decision device transport

This transport remains behind `POSNIC_BUSINESS_DECISIONS=1`. Authenticated
checkout routes and receipt recovery are implemented. Cashier UI, operator
resolution of a missing receipt, broader bill combinations and native release
qualification remain incomplete. Keep the production flag disabled.

## Trust boundary

The enrolled till sends its existing device credential to the Gateway. The Gateway
rechecks the current token, revocation, tenant, instance and device branch scope
for every decision operation, independently of the normal sync authentication
cache. It never forwards the device credential to the tenant API.

The Gateway writes a five-second grant to the tenant's `business_device_grants`
collection. The grant binds the tenant database, action, SHA-256 of the exact JSON
body and current device scope. The token is stored only as a hash. The tenant API
atomically consumes it at `/api/business/v1/device-decisions/:action` over HTTPS.
Phone access tokens cannot call this boundary. Unused grants are removed after
the request and have a TTL index as a fallback.

The trusted till asserts the authenticated cashier identity; the tenant API
rechecks active status, auth generation, explicit branch membership and sales
permission. It also rechecks the approving owner's session and discount policy
before a new execution claim. Neither `x-device-id` nor a request-body device ID
establishes installation authority.

## Local execution boundary

The sync agent transports bounded commands in `business_decision_local`; it never
writes a sale. Both local commands and tenant grants are excluded from general
collection sync. Discovery requires a live desktop marker; the agent advertises
its configured installation identity with a short expiry.

`business-decision-outbox.js` gives a decision one immutable execution ID per
installation. Concurrent calls and process restarts retrieve the same command.
A changed revision or cashier cannot replace the existing command.

The server returns execution proof only for the first successful claim. Repeated
claims return `reconcile` or `complete` with no proof. The agent accepts a start
only within five seconds of its server timestamp and stores a shorter local
consumption deadline. The desktop atomically consumes that proof once, binding
the source, operation, revision, execution and exact response. A consumed permit
is never released or automatically retried as a financial write.

Checkout calls this guard immediately before saving the sale, using its
actual final pricing hash, and saves the receipt with the sale. A lost response,
expired permit or interrupted process must enter receipt reconciliation. The
acknowledgement API requires a matching durable sale receipt; a client claim that
the sale succeeded is insufficient.

## Checkout and recovery

The ordinary POS session protects these routes. Current cashier auth generation,
explicit branch membership and sales permission are checked again by the service:

- `POST /api/sales/business-decisions`: `{ sale, reason }`, priced by the same
  read-only checkout preview. Limited to 30 requests per cashier per minute.
- `GET /api/sales/business-decisions/:requestId`: current scoped state.
- `POST /api/sales/business-decisions/:requestId/cancel`: cancel a pending or
  approved request. Read/cancel share a 120-per-minute cashier limit.
- `POST /api/sales`: the existing Add endpoint accepts `business_decision_id` and
  must pass the verified pre-commit gate. Supplying an ID never bypasses approval.
  The gate rechecks the cashier and actual final pricing, then atomically consumes
  the permit. Hold and other operation types reject this approval contract.

The desktop shell's `POSNIC_SYNC_PAIRED=1` selects Cloud transport. Explicit
Community mode needs `POSNIC_BUSINESS_LOCAL_DECISIONS=1` and stores a server-owned
installation identity. A paired till never falls back to the local ledger.
Both paths require `POSNIC_DESKTOP=1`; a Cloud tenant cannot run checkout through
these routes. Register locking retains its existing identity; the immutable
decision receipt carries the separately verified installation identity.

The existing desktop reporting timer also runs a receipt-only recovery pass.
Each pass examines at most four due execution commands with indexed, bounded
sale lookups. It never calls a sale writer or requests another execution permit.
It acknowledges a matching saved receipt, tolerates delayed ordinary sales sync,
and marks the local journal confirmed only after the server says applied.
Cloud acknowledgement remains a durable command across offline periods and
temporary device revocation. A missing receipt stays unresolved; it is not proof
that the sale failed, and there is deliberately no automatic second sale.

## Local validation

Run the real MongoDB API suites `business-device-decisions.integration.cjs`,
`business-decision-outbox.integration.cjs`, `business-sale-preview.integration.cjs`
and `business-access.integration.cjs`. The preview suite exercises the actual
checkout controller and Mongoose sale writer, an authenticated owner decision,
changed-bill rejection, duplicate checkout and recovery after user disablement.
The companion Gateway contract suite is `tests/business-decisions.integration.cjs`
with `POSNIC_BUSINESS_TEST_API_ROOT` pointing to this checkout's `api` directory.
It exercises real Gateway HTTP handling and the tenant service through a
controlled HTTPS adapter; it is not physical-device or deployed-network evidence.
