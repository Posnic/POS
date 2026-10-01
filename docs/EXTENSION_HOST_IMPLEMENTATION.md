# Extension host implementation checkpoint

This branch adds generic extension infrastructure on Posnic 1.9.0 develop, baseline `4e66f816347e62c6fbfc5958fd41ac9267372aa1`. It is not a released extension API. Keep the capability gate closed until the full browser, receipt and installation contract is verified.

## Durable execution

- Staff-authenticated routes derive company/branch/actor from the session. An installed signed package and per-shop enabled digest are mandatory.
- A persisted namespace plan serializes commands, retains only reference results, and resumes interruption. The worker receives scoped catalogue facts, never database/payment credentials.
- Stock movements use standalone-Mongo journals and atomic item fences, including compensation, partial sale allocations, returns and manager closure. Closure preserves stock and paid sales while removing unpaid payloads.
- Core-owned payment preparation quotes through the normal sale service and reserves or allocates selected quantities. Cash and staff-confirmed external-terminal Card entry create ordinary core sales without another stock decrement. Card entry does not call a payment provider or imply a Dojo approval.

## Payment recovery

An internal stock-sale commit gate atomically arbitrates rejection against insertion. A failed preview or definite pre-commit refusal can close without changing extension state. A rejected payment submission remains available for review/cancellation and a fresh quote. A stale writer cannot pass the closed gate. Unknown writes cannot be cancelled by assuming an absent sale means failure.

Authorization persists the first complete core sale document in BSON, retaining native ObjectIds and dates. Recovery uses the normal sale repository with that snapshot and the original unique sale identity. The first writer and recovery cannot create distinct sales. A later catalogue removal or currency-setting change does not reprice an already authorized sale. The snapshot represents the coordinator's plain, fully paid Cash/Card payload; no register, customer-credit/wallet or linked-invoice side effects are accepted by snapshot replay.

The payment gate is internal code, never a browser-provided callback or skip-stock flag. Normal sales without an internal stock grant remain on the existing path.

## Local verification

89 selected tests pass across extension namespace/routes/package loading, stock effects/fences/journals/allocations/lifecycle, real sales/payments, existing desktop payment integrity and business stock. Tests cover stale writers, cash-versus-cancellation races, price/tax review, failure after authorization, native BSON snapshot replay, delayed first writers racing recovery, fractional taxed amounts and manual Card entry. A separate private worker smoke test exercises the complete command boundary against real MongoDB and core sale services. No CI workflow was added.

Testing currently uses the installed dependencies from the separate active checkout through NODE_PATH and a cached MongoDB 8.2.6 test binary. A clean locked dependency installation remains a release requirement.

## Remaining release work

- Complete private-page end-to-end verification through real login, module permissions/settings and receipt dispatch. The generic page/message bridge now exists.
- Normal receipt template integration with truthful pending status, printer dispatch and cash-drawer behavior.
- Catalogue mutation/repair cases, stock notifications/sync and normal allocated-sale return verification. Payment ownership and authenticated manager cancellation now have regression coverage.
- Activation, versioned update/rollback and offline distribution packaging. Signed ZIP validation and immutable staging now exist, but no activation UI/coordinator is complete.
- Isolated authenticated staging and compatible Windows/offline verification. No public staging or customer hardware compatibility is claimed by these tests.

Provider-specific integration is separate from manual Card recording. Third-party terminal outcomes must be independently verified by their actual adapter.

## Dedicated page and payment ownership checkpoint

Signed metadata may contribute HTML, CSS and JavaScript assets. They are loaded only from verified package contents. The Extensions page lists enabled, digest-matching packages permitted to the current staff session and opens their presentation in an opaque-origin iframe. Its CSP blocks network connections and unsolicited scripts; its MessageChannel permits only bounded, named operations. Host-owned transport supplies authentication, CSRF, branch and idempotency headers. The frame receives no session token. A branch/page change invalidates its command bridge.

Product search is bounded, cursor-paginated and company/branch scoped. Literal search terms cannot become Mongo operators or regular-expression patterns. It uses core stock/pricing facts, reports unavailable-item counts and sends no internal pricing snapshot to the frame. Command preparation still revalidates facts independently. Historical unavailable products in namespace context remain a repair-case release item.

Payment ownership is checked by the private planner before persisting an effect. A manager can cancel another staff member's known unpaid preparation, while only its owner can confirm it. The namespace persists the original authenticated permission set for recovery. Cancellation persists its initiating actor/operation/sequence and reuses those identities after interruption; manager recovery cannot elevate the original operation's permissions.

Local verification: 25 affected host tests pass, including real MongoDB payment/namespace/routes, signed view loading and two Chromium tests for frame isolation and page transport. The private extension also has a separate production presentation test and real worker/core smoke check. The page adapter currently refuses receipt dispatch; normal receipt integration, full login/browser verification, activation and public staging remain incomplete. No capabilities were advertised prematurely.

## Signed ZIP staging

`extension-archive.js` accepts an already bounded buffer (24 MiB maximum), reads entries with the existing yauzl dependency, and bounds both declared and actual decompressed bytes. It rejects unsafe/Windows-colliding paths, duplicates, file-as-parent collisions, symlinks/device entries, encrypted/unsupported encodings, unsigned/unlisted content and incompatible packages. All hashes and the Ed25519 signature are checked before filesystem staging. HTTP upload limits still need to be applied by the eventual installer route before buffering.

`stageExtensionArchive` writes a verified package to a random staging directory, revalidates the executable contract without executing it, and atomically renames it into the immutable version directory. It checks ancestor directories for links. A repeat of the exact package returns the existing version; a different build cannot overwrite the same version. It does not change current/previous pointers, enable any shop or reset namespace data. Activation must separately coordinate pending commands, permissions and restart/rollback.

Twelve additional archive/staging tests pass, including actual Windows junction refusal and preserving an existing current-version pointer. The package loader now accepts declared camel-case command names, matching commands such as `payment.confirmCash`; the signed metadata still controls their permissions. The archive/loader/package group contains 24 passing tests. This is not evidence of a complete installer or a deployed package.
