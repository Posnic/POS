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

There is no public publishing or purchase endpoint. Source-archive publication, invitations, actual Posnic account login, publication/admin tools, the customer library UI and deployment remain to implement. Runtime executability is still checked by the installer; publication verifies the signed archive without executing customer code. Do not expose database writes as an upload API. Paid order/event processing is M4, not part of these routes.

Four local tests in `api/tests/extension-private-library.integration.cjs` pass with a real temporary MongoDB and HTTP server: two-organisation isolation, source permission, expired/foreign tickets, revoked membership, withdrawn release, changed/corrupted storage, trusted identity, no-store responses and retained access after maintenance expiry. These tests do not represent a deployed marketplace.
