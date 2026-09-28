# Posnic Business authorization

The Business companion has a separate browser-authorized session namespace. It does not enroll a till, mint a normal POS JWT, or grant sales/sync authority.

Routes mount at `/api/business/v1` and `/business/v1` for the existing proxy path conventions. Public links use `/api/business/v1`. The installation must expose a valid HTTPS origin with its trusted reverse proxy configured and the backend port isolated from untrusted direct traffic. The routes require `req.secure`, use the request's tenant-scoped `req.db`, and never take a license/database from the mobile request.

## Protocol

1. `GET /discovery` advertises `posnic-business`, API version 1, the origin as issuer, `business-pkce-v1`, audience `posnic-business`, and reporting availability. This version reports `unavailable`: prepared reporting has not shipped.
2. `POST /requests` accepts a 43-character S256 `codeChallenge` and a device name up to 80 characters. It creates a ten-minute request, storing its hash, and returns the request, consent URL and five-second polling interval.
3. `GET /authorize?request=...` opens a browser-only consent page with a matching code. Password entry happens on this page, never in the Business app. A browser session nonce, same-origin check and existing ambient-credential CSRF protection bind approval to the page. No reusable desktop login is created.
4. `POST /approve` verifies active user credentials using the existing current/legacy password matcher and current permissions. Denial needs the same browser binding but no password. Approval is atomic and one-use.
5. `POST /token` exchanges the request plus verifier. Pending requests return 202; approved requests yield one opaque `pb1_...` token, absolute expiry and context. Concurrent exchanges have one winner. Auth version, activation, branch membership and read permission are checked again before issuance.
6. `GET /context` rechecks the account on every request. Explicit branch membership applies even to an administrator. Branches from another license are excluded. Removed branches and permissions are reflected immediately; password/auth-version changes and account deactivation revoke access.

Sessions store only token hashes. `POST /session/rotate` atomically replaces a token without extending its thirty-day absolute lifetime. `DELETE /session` revokes the caller; `GET /sessions` and `DELETE /sessions/:id` list/revoke only that user's sessions in the same license. A Business token is rejected by existing POS authentication.

## Capability mapping

Only `admin` and `super_admin` in the canonical usertype (or legacy role when usertype is absent) receive owner read capabilities. A manager label grants nothing by itself. Other users need both dashboard read and dashboard financials for overview/tenders, plus item read for item sales. Stock requires item read. Notification preference management is personal. Remote financial approval is not granted by this mapping; it requires its own policy and service.

Context validates configured currency and timezone instead of silently guessing them. More than 100 branch memberships require configuration/support before authorization. TTL indexes remove expired authorization/session records; expiry is also checked on every operation, independently of TTL cleanup.

## Validation and remaining integration

`node --test tests/business-access.integration.cjs` runs against a disposable MongoDB instance and real HTTP routes. It covers proof binding, concurrent exchange/rotation, hashed token storage, POS isolation, current ACL/branch changes, cross-license access, expiry, revocation and browser consent protection. CI runs this suite alongside existing Mobile POS and Captain integration checks.

Cloud account-directory authorization still needs to issue a Business-specific grant through its control plane. This tenant-side endpoint supports the Community browser flow and forms the tenant-side boundary for that future Cloud integration. This change is not a deployment or a claim that live reports are ready.
