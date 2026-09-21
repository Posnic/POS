# Mobile POS account and device onboarding

Implemented in the Mobile POS 0.2.0 integration. Deployment status and installation artifacts must be checked separately; source availability does not mean a cloud shop has been updated.

## Customer journey

1. Open the phone app. Choose **Sign in** or **Create account · Free trial**.
2. The system browser handles the Posnic account password and trial provisioning. Signup resumes the pending authorization instead of opening the desktop shop.
3. Check the matching code, shop and device on the consent page. Approve the phone. Consent explicitly enables Mobile POS for the matched staff account's primary branch.
4. The account service resolves the shop and its owning gateway. It issues a short-lived, one-use authorization bound to the phone installation and its SHA-256 proof challenge. It does not issue a till sync credential.
5. On the shop Wi-Fi, the app tries recently reported tills and proves that an address holds the matching enrollment before pairing. The authenticated sync agent delivers the grant to an existing matching local staff identity, license and branch. Otherwise the app connects to the cloud shop.
6. Set a local unlock PIN. Catalogue and sales remain local and work within the configured offline authorization period.

Community shops use **Connect a local or Community shop**: search Wi-Fi, scan the shop QR, paste an address or use a pairing code. Cloud account creation is not required for this route.

## Ownership and navigation

**Settings → Devices** is the common management entry. Mobile POS and Captain retain their own setup pages and independent feature switches. Devices links to the till's Hardware Manager for printers, scanners and scales, and to printing till authorization. The Features page remains a list of switches.

An application has an identity, staff permissions, branch access and revocation. A USB or Bluetooth peripheral belongs to its host till and uses that platform's connection and driver setup. Grouping them in one place does not turn a printer into an OAuth client or grant it a staff account. Phone-as-scanner is a separate capability; this release does not claim to implement a new scanner application.

## Network discovery and sale authority

The till reports private IPv4 API endpoints through its authenticated sync connection every 15 seconds. Entries expire after five minutes and are scoped to that tenant and device. The actual configured application port is used. Public, loopback, link-local, credential-bearing and malformed URLs are rejected. SSIDs, Wi-Fi passwords and MAC addresses are not collected.

Local grants expire after three minutes; cloud pairing grants after one minute. An enrollment proof binds a nonce to the grant without transmitting its pairing secret to a stale DHCP address. Local HTTP still assumes a trusted shop network; this proof is not transport encryption and does not defeat an active on-path relay. Internet account and cloud API traffic require HTTPS.

The chosen API remains the sale authority for that pairing. Cloud and LAN journals are independent. **Never automatically upload a paid outbox to a different server merely because its shop and branch IDs match.** A phone paired to a local till keeps its outbox when away from that till. Completed sales travel through ordinary till synchronization. A future route failover requires a genuinely shared deduplication ledger, or explicit coordinated transfer of authority.

## Security and retry behavior

- Account approval uses the external browser, same-origin CSRF-protected consent, hashed request identifiers, a 15-minute deadline, rate limiting and a phone-held random proof secret.
- Polling proves possession of the original secret. Atomic claim prevents two exchanges issuing independent credentials. This is a purpose-built browser approval protocol inspired by device authorization; it is not advertised as a general OAuth server.
- Both approval and exchange recheck account and shop availability. The owning gateway rechecks tenant placement, active staff and sales/settings permissions.
- Each pairing endpoint rechecks staff status, branch access, feature status and password generation. A browser grant is bound to a particular phone and proof. The resulting handset token uses the existing revocation and staff authorization middleware.
- Sync delivery is at least once. Used pairing rows remain until TTL expiry so a repeated delivery cannot recreate a used code. Repeated delivery cannot re-enable a feature that was disabled after the initial delivery.
- Revocation takes effect on reconnect; previously issued offline authorization expires locally. A paid sale is retained for reconciliation, never erased to repair an authorization error.
- Device and peripheral lists are management surfaces, not payment verification. UPI QR payments still require explicit staff confirmation unless a configured provider confirms them.

## Release components

Ship together: POS API and desktop UI, Gateway sync gateway and agent, account web-api, website signup return handling, and Mobile App. The desktop must bundle the updated agent for automatic local discovery. An old server must not be treated as supporting Mobile POS solely because it answers a runtime probe.

Account API: `/api/mobile/requests`, `/authorize`, `/approve`, `/token`.
Gateway: authenticated `/v1/device/network`, control-only `/v1/control/mobile-grant`.
Shop API: `/api/mobile/v1/enrolment-proof`, `/pair`, `/bootstrap`, `/sales`, `/print-jobs`, existing settings and recovery endpoints.

## References and decisions

- [RFC 8252, OAuth for Native Apps](https://www.rfc-editor.org/rfc/rfc8252): use the external user agent and proof-bound authorization; do not collect the cloud account password in a native login form.
- [RFC 8628, Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628): explicit user approval, expiring transactions and bounded polling inform the browser rendezvous design.
- [Square Terminal POS integration](https://developer.squareup.com/docs/terminal-api/pos-integration): terminal/device identity and payment execution are explicit relationships.
- [Square barcode scanners](https://squareup.com/help/us/en/article/5143-bar-code-scanners-with-square-point-of-sale): scanner transports differ from application enrollment.
- Existing internal research: Intranet `docs/DEVICE_ENROLMENT_AND_TRUST.md`, `docs/CONTROL_PLANE_API_ARCHITECTURE.md`, `docs/MOBILE_EXPERIENCE_PLAN.md`.

Remaining extensions: branch picker during account consent, an integrated cross-host peripheral inventory, a phone-as-scanner capability, automatic recovery from a local till's changed IP, and encrypted local transport provisioning. The existing manual connection page remains available. These are not claims of this release.
