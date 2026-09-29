# Business decision device transport

This transport remains behind `POSNIC_BUSINESS_DECISIONS=1`. Authenticated
checkout routes, cashier UI and receipt recovery are implemented. Operator
resolution of a missing receipt, broader bill combinations and native release
qualification remain incomplete. Keep the production flag disabled.

## Mobile read authority

Approval list and detail reads recheck the Business session, account, tenant and
returned branch scope after loading records and resolving requester names. A
revocation or branch removal observed during that work rejects the response.
The returned decision controls use the final discount policy and expiry time,
so a newly lowered approval limit does not leave an enabled action in the view.
This complements the separate checks performed when actually deciding or applying
an approval. Real Mongo race cases cover both list and detail reads; deployed
revocation testing remains part of qualification.

Approval writes also run their live authority check after the ledger lookup and
before the revision-checked transition. A required confirmation session is checked
again rather than trusting a token verified earlier in the request. Regression
cases revoke either session, remove branch access or lower the discount limit
during the lookup and verify that the request stays pending with revision zero.
These checks reduce asynchronous authorization windows; they do not claim a
cross-collection transaction with concurrent account administration. Execution
still independently rechecks the approver before allowing a new till claim.

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
- `GET /api/sales/business-decisions/capabilities`: current branch, cashier and
  transport support. Disabled installations return a disabled capability without
  enabling remote approval.
- `GET /api/sales/business-decisions/operation/:operationId`: recover a request
  reference after a lost create response. A null result is not proof of failure.
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

The cashier dialog requires an explicit request and a separate explicit save.
It stores only the operation and request references in session storage, scoped
to API URL, branch and cashier. Closing or reopening the dialog never sends a
second request. A failed save clears the displayed approval until a fresh read;
a matching local receipt offers recovery with the original operation ID.
Unresolved execution does not offer a second save. Request creation with an
unknown outcome remains pending until the reference can be recovered.

The first contract supports paid new counter sales with at most 100 items,
two-decimal currencies and a bill-level manual discount. Other combinations
continue through the on-site manager flow. The dialog has English and 17
translated language packs; this does not qualify the mobile app's localization.
Run `node --test tests/business-approval-ui.test.js` for its interaction and
translation checks. Browser fixture checks cover narrow screens, Arabic RTL and
200% text; full POS and physical-device acceptance remain required.

Run the real MongoDB API suites `business-device-decisions.integration.cjs`,
`business-decision-outbox.integration.cjs`, `business-sale-preview.integration.cjs`
and `business-access.integration.cjs`. The preview suite exercises the actual
checkout controller and Mongoose sale writer, an authenticated owner decision,
changed-bill rejection, duplicate checkout and recovery after user disablement.
The companion Gateway contract suite is `tests/business-decisions.integration.cjs`
with `POSNIC_BUSINESS_TEST_API_ROOT` pointing to this checkout's `api` directory.
It exercises real Gateway HTTP handling and the tenant service through a
controlled HTTPS adapter; it is not physical-device or deployed-network evidence.

## Operator procedure

See [Unresolved Business approval](BUSINESS_APPROVAL_OPERATIONS.md) for cashier
actions, receipt-based investigation and the required pilot rehearsal. The
procedure is documented but not deployment-qualified. Durable support tracking
and resolution of a consumed execution without a verified receipt remain open.

## Restart discovery of checkout attempts

With `recoveryVersion: 1` advertised by checkout capabilities, the cashier dialog
provides **Earlier checkout attempts**. `GET /api/sales/business-decisions/recoveries`
returns at most 20 durable claim references and an opaque next cursor. It uses the
current server-owned installation identity and live cashier/branch authority,
rechecked after the indexed read. It exposes only request IDs and claim timestamps,
not execution proof, tokens, bill bodies or device identifiers. A claim timestamp
is the start of an attempt, not a sale-completion time.

Cloud and Community claims have no TTL, so discovery survives a browser/process
restart and expiration of temporary create/read commands. Confirmed local claims
are excluded. Other claims remain candidates for review; inclusion is not proof
that execution started, succeeded or failed. A fresh scoped read establishes the
current record and any matching local receipt. Review-only navigation cannot
submit, cancel, overwrite the current bill or replace its session reference.

When capabilities also advertise `requestRecovery: true`, the client opts into
`?requests=1`. After claim pages, the opaque cursor enters request pages. Community
lists unexpired pending/approved requests; Cloud lists retained create commands
within their existing seven-day lifetime. These use the same installation,
branch and cashier scope. Requests already represented by scoped claims are
excluded. Request pages include the original operation ID and may have a null
request ID when Cloud acknowledgement has not arrived. Opening that row polls
the original operation; an unknown response never resends creation or checkout.
An empty filtered page may still have a next cursor. Legacy callers retain the
claim-only response. No new financial write or storage collection is introduced.

This does not provide cross-cashier escalation or resolve a consumed claim with no
verified receipt. The operational gates in BUSINESS_APPROVAL_OPERATIONS.md remain.
Four new labels have draft translations in all 18 cashier language packs.

Validation: eleven real Mongo checkout/outbox cases and twelve cashier UI cases pass.
Coverage includes installation/branch/cashier isolation, 20+3 pagination across
service recreation, live revocation, controller routing, malformed list rejection,
foreign-record rejection and zero checkout writes from review. English/Arabic
browser fixtures at 320px with enlarged text show no horizontal overflow and
reachable pagination. These fixtures do not replace a deployed till rehearsal.
