# Private extension library boundary

Implemented as registry-side services and a dependency-injected Express router. Not mounted in the Community till API or deployed as an account service. It must use a dedicated registry database and verified Posnic account authentication; a local till administrator/session is not authority to download another customer's private software.

## Read/download contract

- `GET /organizations/:organizationId/releases` returns only approved public/private releases accessible through active membership and an exact release entitlement. No storage paths, other organisations, credentials or entitlement internals are returned.
- `POST /organizations/:organizationId/download-tickets` accepts `releaseId` and `kind` (`package` or `source`). Source access is a separate granted right. Returns an opaque ticket valid for five minutes. Store only its SHA-256 digest.
- `POST /downloads` accepts the ticket in a JSON body, with account authentication. It rechecks the user, membership, entitlement, package approval and immutable artifact digest/size, reads from private storage and verifies bytes before delivery. It sends `private, no-store` and a safe ZIP filename. Tickets are not public bearer URLs and should never be logged.

Initialize the registry indexes before serving requests with `initializeLibrary(db)`. Unique organisation/user and organisation/extension indexes prevent ambiguous grants; a TTL index cleans expired tickets. Expiry is also checked synchronously, so TTL cleanup delay cannot extend access.

The account middleware must set `req.libraryActor.id` from verified account identity, never request body or a local POS JWT. `createLibraryRouter` refuses to initialize without authentication and a private blob reader. `readBlob(sha256)` receives only a validated content digest. Deployment must provide private storage, request-rate limits, body/time limits, safe request logging, backup and access monitoring.

## Perpetual rights

An entitlement names exact release IDs already granted. Maintenance expiry does not remove access to purchased releases and does not disable local installation. New-release grants are a separate policy. Download revocation concerns account access; it does not erase installed software or amend the customer's existing licence. Offline signed ZIP installation remains independent of registry availability.

## Trust and remaining work

`extension-library-storage.js` provides private local artifact storage: SHA-256 addressing, bounded reads, no path input, atomic publication of fully flushed bytes, concurrent upload convergence, corruption rejection and restart persistence. Configure an absolute service-owned directory outside the web root; filesystem permissions must prevent other users from changing its files or ancestors. Expose only its `read` function to the authenticated download router. Its `put` function is for trusted publication code and does not itself validate a publisher signature or grant access. Interrupted temporary files are not downloadable. Six filesystem tests exercise concurrency, corruption, traversal, caller-buffer mutation, incomplete writes, linked roots and oversized files. This adapter is not yet deployed.

`publishPrivateRelease` is an internal runtime-package publication gate. It requires a server-authenticated publisher role, a configured trusted signing key and capability list, verifies the bounded signed ZIP before storage, and publishes an immutable private release with a fixed audience. Concurrent identical retries converge; a different package, changed audience or withdrawn release cannot be overwritten by retry. Publication does not grant download rights. A failed database write may leave an unreferenced content object; it is not downloadable through the library. Three real MongoDB/filesystem tests cover publication-to-authorized-download, concurrent retries, denied actors/keys/archives and immutable/withdrawn releases.

There is no public publishing or purchase endpoint. Invitations, actual Posnic account login, publication/admin tools, the customer library UI and deployment remain to implement. Runtime executability is still checked by the installer; publication verifies the signed archive without executing customer code. Do not expose database writes as an upload API. Paid order/event processing is M4, not part of these routes.

## Signed source handover

Publication accepts an optional `source` ZIP alongside the runtime `package`. Include it in the first immutable release publication; it cannot be appended or replaced by retrying an existing release. The source archive uses the same bounded ZIP reader (24 MiB compressed, 20 MiB expanded, 250 payload files), path/collision/link/encoding checks and configured publisher trust key. Its signed `manifest.json` has kind `extension-source:<extension-id>`, the runtime version, every payload file hash and the standard signed-manifest signature. It includes `README.md`, `LICENSE` and a signed `source.json` containing `manifestVersion: 1`, `id`, `version`, `runtimePackageDigest` (SHA-256 of the exact runtime manifest bytes) and `sourceCommit` (40-character Git commit).

The separate source kind cannot be installed as runtime code. Source and runtime identities, versions and manifest digest must agree before either object is stored. Source permissions remain separate from runtime grants and are rechecked when downloading. Signature and hash checks establish identity/integrity, not source completeness: release review must still check build instructions, the complete promised source, licence terms and absence of secrets/customer data. No customer artefact has been published through this service yet.

Verification after this change: 27 targeted archive, publication, private-library and storage tests passed, with no skips. They include signed-source download, revoked source access, mismatched runtime binding, tampering, and rejection of a source archive by the runtime installer boundary.

Four local tests in `api/tests/extension-private-library.integration.cjs` pass with a real temporary MongoDB and HTTP server: two-organisation isolation, source permission, expired/foreign tickets, revoked membership, withdrawn release, changed/corrupted storage, trusted identity, no-store responses and retained access after maintenance expiry. These tests do not represent a deployed marketplace.

## Invitation service (local, not exposed)
The registry-only extension-library-invitations service issues 48-hour hashed tokens for a named email, requires an active organisation owner, and accepts only server-verified account email identity. Acceptance uses a MongoDB replica-set transaction for token consumption and membership creation. Concurrent retries converge; another account cannot reuse a consumed invitation. Revoked membership is never recreated, existing roles are preserved, and owner authority is write-fenced against concurrent revocation. Invitations grant member access to the organisation's existing library permissions, not a new purchase or source entitlement. No email is sent and no HTTP invitation route is mounted.

Initialize invitation indexes before use. Do not use this with a standalone MongoDB registry or accept identity/email-verification claims from request JSON or local till sessions. Actual account authentication, invitation delivery/revocation UI and registry deployment are still required. Four new real replica-set tests plus four existing private-library tests pass (8 total).

### Invitation HTTP adapter
The unmounted createInvitationRouter adapter requires the registry database, Mongo client and verified account middleware. POST /organizations/:organizationId/invitations issues an owner-authorized invitation; POST /organizations/:organizationId/invitations/:invitationId/revoke revokes it; POST /invitations/accept consumes it using the authenticated verified email. Request-body identity, role and organisation overrides are ignored. Responses are no-store; JSON bodies are limited to 8 KiB and errors never echo tokens or parser stacks. The issuing owner receives the token for a future trusted delivery interface. Production must add rate limits and, if using cookie sessions, CSRF protection before mounting. No route has been mounted or invitation delivered. Nine invitation/library tests now pass, including a real HTTP test against a temporary replica set.

### Registry sessions
The local extension-registry-sessions service stores only SHA-256 digests of random 256-bit bearer tokens, with one-hour expiry checked synchronously and TTL cleanup. Authentication checks current active account status and authVersion on every request and reads current verified-email state. Increment authVersion to revoke all sessions; revokeSession signs out one token. The middleware ignores local till JWTs, cookies and body identity and clears preexisting libraryActor. It fails closed on database errors and returns no-store responses.

issueSession is INTERNAL ONLY: call it only after a trusted account login has verified identity and mapped it to a registry_accounts record. Do not expose an account-ID-taking session endpoint. No password login, identity-provider callback, account provisioning, UI or deployment is implemented by this module. Serve over TLS, keep bearer tokens out of URLs and persistent browser storage, and configure rate limits before deployment. Twelve session/invitation/library tests pass; no real account session was issued.
