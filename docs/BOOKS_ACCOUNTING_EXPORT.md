# Books accounting export (recovery implementation)

Status: selected-value serializer and read-only versioned HTTP routes implemented; real installed-POS integration and immutable payment capture remain pending. Existing POS write behavior is unchanged.

The `posnic.sale-source.v1` snapshot carries a typed source identity, explicit customer-reference identities and selected stored values. JSON field order is fixed by the allowlist; SHA-256 covers the exact source JSON. A string that resembles an ObjectId remains a string. Unknown top-level and nested fields are excluded. Invalid or unsupported selected values fail explicitly. The serializer does not fill missing currency, invent payment IDs, recalculate money or describe mutable records as immutable events.

Books verifies this envelope before it archives a source. A source revision proves selected values match that snapshot; it does not prove that a receipt was accepted or that the sale may be posted. Ordinary payment arrays lack durable event evidence and remain held for review. Immutable sale/return/payment capture and subsequent accounting-posting support remain separate unfinished requirements.

## Data and synchronization

This component reads the authorized installation's existing sale document. It writes no business collection, field, command journal, sync checkpoint or file. Existing sales replication is unchanged; no new Gateway/agent lane is introduced by the serializer. The origin till, another till and web installation can each expose only their locally available synchronized sale state. Different revisions after offline edits/reconnect must trigger Books review rather than replaying payments. End-to-end sync convergence and the future endpoint's tenant/branch isolation have not yet been verified. No deployment or live-client readiness is claimed.

## Verification

`node --test api/tests/accounting-source.test.cjs`: four checks for value preservation, deterministic revisions, typed source/customer IDs, private-field exclusion, tenant mismatch and unsupported shapes. The Books checkout's opt-in `pos-export-contract.test.js`, run with `BOOKS_TEST_POS_CHECKOUT` pointing at this checkout, verifies exact totals, customer identity, revision changes and review holds for missing currency/ordinary payment history. No customer data or installed POS was used.

## HTTP browse and scope

`GET /api/v1/accounting/sales` accepts only `limit` (1–25, default 25) and `cursor`. `GET /api/v1/accounting/sales/{kind}/{id}` distinguishes `objectId` from `string`. Both run behind the existing v1 protect/rate middleware and require sales read access plus a valid license/branch scope. Invalid branch selectors fail closed. Branch filtering follows existing v1 behavior, including legacy unassigned records. Query criteria and cursors never supply authorization. Every query reapplies the principal's scope; the cursor carries only a scope digest and typed position, not credentials.

The browse orders ObjectIds then string IDs, with binary identity ordering and a scope-bound cursor. It is a live browse, not an immutable collection snapshot or incremental change feed: concurrent inserts before the cursor require a fresh browse. Item refetch/revision checks detect changes to selected values. Unsupported ID types or unrepresentable evidence fail with 422 instead of silently producing usable accounting evidence. Responses are no-store and capped at 4 MiB. No mutation method is added. Public OpenAPI includes the routes and limitations.

Additional verification: Books' opt-in `pos-export-http.integration.js` runs these actual v1 routes with real MongoDB and actual token mint/resolve/revoke functions. Its test adapter supplies the disposable tenant database; it is not a full production protect/tenant-selection test. It covers mixed-ID pagination, same-looking IDs, scope-changing cursor refusal, inaccessible items, malformed branch scope, revoked/missing permissions, unsupported IDs, source mutation, long Unicode IDs, public spec and the existing sales read route. All pass. Books' cursor budget increases to 2048 characters to preserve the supported 256-character Unicode identity range. No user data was read. Existing full Jest v1 suite has not been run in this isolated checkout; local attribution checks pass.

## Full protect/tenant-context correction

A real HTTP test using `protect`, `attachDb` and request-scoped tenant context reproduced a 403 for a correctly minted scoped token: branch validation searched `users` with the token row's ID. Validation now rechecks the active `api_tokens` grant only when both the server-set scoped-token request marker and token principal marker are present. The branch must exist for the license and be in the stored token grant (an explicitly empty branch array keeps the existing all-branches token semantics). Normal user/API-key/JWT branch validation still queries `users`. No saved token, user field, sync lane or financial record is changed; the fix reads existing local credential grants and restores the intended scoped-token behavior across protected routes.

The same test exposed BSON license IDs reaching the export route. The route now scopes to canonical BSON/string representations of the authenticated license; exported license text stays compatible with Books. It never accepts a query-supplied license. Source identity remains typed, including string IDs that look like ObjectIds.

The real-protect integration passes with two disposable Mongo databases, branch overrides, legacy/BSON sale licenses, concurrent shop requests, cross-shop tokens and revocation. The test host chooses the two tenant contexts; production shard routing and installed POS still require acceptance. All 82 existing tests across seven v1/token/auth/tenant suites pass; three additional scoped-principal unit regressions pass; the four serializer checks and attribution check pass. API dependencies were installed from the existing lockfile with lifecycle scripts disabled. The generated `.connector-npm-cache` remains because automatic approval review rejected both cleanup attempts with `blocked by policy`; it is not source or a release artifact.
