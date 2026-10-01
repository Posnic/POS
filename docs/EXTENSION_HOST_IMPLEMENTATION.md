# Extension host implementation checkpoint

This branch adds generic extension infrastructure on Posnic 1.9.0 develop, updated baseline `773200b2c6084199186014bbc55ae04bd57ab0e9`. It is not a released extension API. Keep the capability gate closed until the full browser, receipt and installation contract is verified.

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

After rebasing onto develop `773200b`, 46 affected core-sale, extension-payment and existing desktop-payment checks pass. The upstream submitted-payload idempotency fix is preserved for normal sales alongside the extension's host-assigned submission identity. The latest host implementation commit after rebase is `a635e57`; earlier checkpoint hashes refer to the pre-rebase local history.

89 selected tests pass across extension namespace/routes/package loading, stock effects/fences/journals/allocations/lifecycle, real sales/payments, existing desktop payment integrity and business stock. Tests cover stale writers, cash-versus-cancellation races, price/tax review, failure after authorization, native BSON snapshot replay, delayed first writers racing recovery, fractional taxed amounts and manual Card entry. A separate private worker smoke test exercises the complete command boundary against real MongoDB and core sale services. No CI workflow was added.

Testing currently uses the installed dependencies from the separate active checkout through NODE_PATH and a cached MongoDB 8.2.6 test binary. A clean locked dependency installation remains a release requirement.

## Remaining release work

- Complete private-page end-to-end verification through real login, module permissions/settings and receipt dispatch. The generic page/message bridge now exists.
- Complete signed-runtime/browser verification of receipt dispatch and cash-drawer behavior. Normal template integration and pending receipt projection now exist.
- Catalogue mutation/repair cases, stock notifications/sync and normal allocated-sale return verification. Payment ownership and authenticated manager cancellation now have regression coverage.
- Graphical installation, publisher trust-key distribution and packaged application update/rollback verification. The offline activation coordinator and local CLI now exist.
- Isolated authenticated staging and compatible Windows/offline verification. No public staging or customer hardware compatibility is claimed by these tests.

Provider-specific integration is separate from manual Card recording. Third-party terminal outcomes must be independently verified by their actual adapter.

## Dedicated page and payment ownership checkpoint

Signed metadata may contribute HTML, CSS and JavaScript assets. They are loaded only from verified package contents. The Extensions page lists enabled, digest-matching packages permitted to the current staff session and opens their presentation in an opaque-origin iframe. Its CSP blocks network connections and unsolicited scripts; its MessageChannel permits only bounded, named operations. Host-owned transport supplies authentication, CSRF, branch and idempotency headers. The frame receives no session token. A branch/page change invalidates its command bridge.

Product search is bounded, cursor-paginated and company/branch scoped. Literal search terms cannot become Mongo operators or regular-expression patterns. It uses core stock/pricing facts, reports unavailable-item counts and sends no internal pricing snapshot to the frame. Command preparation still revalidates facts independently. Historical unavailable products in namespace context remain a repair-case release item.

Payment ownership is checked by the private planner before persisting an effect. A manager can cancel another staff member's known unpaid preparation, while only its owner can confirm it. The namespace persists the original authenticated permission set for recovery. Cancellation persists its initiating actor/operation/sequence and reuses those identities after interruption; manager recovery cannot elevate the original operation's permissions.

Local verification: 25 affected host tests pass, including real MongoDB payment/namespace/routes, signed view loading and two Chromium tests for frame isolation and page transport. The private extension also has a separate production presentation test and real worker/core smoke check. The page adapter currently refuses receipt dispatch; normal receipt integration, full login/browser verification, activation and public staging remain incomplete. No capabilities were advertised prematurely.

## Receipt integration checkpoint

The signed descriptor can expose a read-only receipt projection through its isolated worker. The receipt endpoint reads current namespace state, refuses unresolved commands, verifies the shop/extension stock movement and printable unpaid quantities, and rechecks the namespace revision before returning a pending document. A prepared but unpaid allocation remains printable. No receipt, sale, payment or stock mutation is stored by this read. Deleted/cleared movements cannot print again. Paid projections must resolve to an existing paid core sale belonging to the same shop and extension.

Pending goods use the existing receipt document builder and normal receipt designer, with the shop's configured layout, product descriptions, quantities, original retail value and local date/time. The designer always includes Payment pending for this document type, even if the selected layout omits totals; it does not label it as a tax invoice or claim cash/card was received. Paid receipts load the existing normal sales document. Parent-owned dispatch preserves the cashier's current workspace and propagates printer failure. Reprinting does not open the drawer or alter stock. Actual drawer-on-cash-sale behavior remains a separate handover item.

Verification: 46 receipt designer/endpoint checks pass, including normal renderer regressions, omitted totals blocks, configured printer dispatch, failure propagation, scope and quantity checks, and deletion refusal. The browser page-transport check covers pending/paid dispatch. The private-worker/core smoke now reads a pending receipt before/after payment preparation, refuses it after deletion and still resolves the paid sale. Nineteen private tests remain passing. Signed-runtime browser acceptance and physical printer checks are still required before releasing.

## Offline activation checkpoint

The API and local activation coordinator acquire the same kernel-owned loopback listener keyed by canonical extension-root path. A running API or port collision refuses activation; a process exit releases the lock without stale PID-file cleanup. This is local exclusion, not online licensing or a network protocol. A stopped API's MongoDB must remain available during maintenance. Multi-host/shared-database activation is not supported by this local coordinator.

`activateStagedVersion` re-verifies the staged package, branch scopes and namespace state versions and rejects pending commands. It journals current/previous pointer and digest-enablement changes without rewriting business data. An interrupted activation must resume with the same target and scope. Startup refuses an extension with an unfinished journal; rollback uses the same compatibility and pending-operation checks. The local `api/scripts/extensions.cjs` command exposes stage/activate/rollback with explicit trusted-key/root/database configuration.

The private repository's real-package/Mongo integration tests verify install/update/rollback, runtime exclusion, pending-command refusal, interrupted pointer change, startup refusal and replay, preserving data and revisions. Customer installer UI, default trust-key/root configuration, packaged runtime wiring and physical hardware acceptance remain unfinished.

## Installed workflow and Windows resource checkpoint

The private package's installed-browser acceptance now passes using the default host capabilities, real JWT staff authentication/branch validation, normal extension and sales routes, MongoDB, signed worker, isolated frame and configured receipt rendering. It verifies partial cash sale, one stock deduction, deletion/report clearing and pending/paid receipts. The parent HTTP wrapper and physical printer are fixture adapters; this is not full desktop login/bootstrap or hardware acceptance. Sale/payment/receipt capabilities are now advertised.

Desktop uses `src/server.js`, not `api/server.js`. Both startup paths now load installed extensions before listening. Desktop defaults to `<userData>/extensions` and the shipped dedicated publisher public key. Its `extraResources` include `src/extension-package.js`, `src/extension-worker.js` and `src/asset-updater.js` at the paths the external API requires. A private integration test materializes these declared resource paths and successfully executes the signed package through them. The publisher private key is outside the repository and must never ship to customers.

Fresh lockfile installations (`npm ci --ignore-scripts` in root and API) passed. With those dependencies, 113 selected host checks and the private installed-browser/package/activation tests pass. Native install scripts, a complete Windows build/run, the installation UI, settings/permissions and physical printer/drawer checks remain release tasks.

## Selected catalogue context

Signed metadata can declare `contextProjection`; its pure worker supplies a bounded `{productIds}` projection before planning. The namespace passes it only for declared resources, and the core catalogue service rejects extra keys, excessive IDs and out-of-shop/missing products. Prices, quantities and scope never come from this projection. Legacy descriptors retain the original catalogue read. The new `catalog.command-selection.v1` capability is required by the private extension.

The installed browser regression verifies that an unavailable product refuses its own adjustment without locking the namespace, while unrelated baskets and cancellation remain available. The private planner discards obsolete working product snapshots. Core-backed paid-history paging is still required separately.

## Cash drawer completion

The namespace derives hardware actions only from successful trusted cash-payment effects. Worker-supplied action fields are discarded. The parent checks the local auto-open setting, selected drawer printer and connector pin, then requests a scoped durable claim before invoking the existing desktop drawer adapter. The claim requires write permission and an existing paid Cash sale for that shop and extension; unique insertion allows only one automatic attempt across concurrent retries/restarts. Receipt rendering, pending slips and Card confirmation do not request an automatic pulse.

A physical device cannot provide an atomic commit with the database. The claim is written before IPC: an interrupted or failed pulse is not automatically retried. The paid sale remains completed and the UI asks staff to check/use the normal manual drawer control. Serial drawer configuration requires separate handling; this customer's printer-connected drawer uses the existing printer adapter. Actual Star hardware remains unverified.

## Paid history and report capability

`sales.paged-history.v1` exposes completed extension payments through authenticated, enabled-package, branch-scoped routes. A compound index supports stable `(paidAt, _id)` cursor pagination, 50 results per page. Daily grouping uses an indexed coarse UTC window followed by the exact local calendar day; totals retain their recorded currencies. These are gross completed-payment totals, not net-return reports. Normal core sales reports handle subsequent refunds.

The private working aggregate no longer retains an ever-growing paid history. Core payment/sale records remain permanent; receipt ownership checks resolve older paid sales even after their private summary expires. Tests cover paging ties, isolation, malformed input, UK DST and mixed currencies. Hardware claims remain independent of the private cache, so this change cannot reopen a drawer on a replay.

## Signed ZIP staging

`extension-archive.js` accepts an already bounded buffer (24 MiB maximum), reads entries with the existing yauzl dependency, and bounds both declared and actual decompressed bytes. It rejects unsafe/Windows-colliding paths, duplicates, file-as-parent collisions, symlinks/device entries, encrypted/unsupported encodings, unsigned/unlisted content and incompatible packages. All hashes and the Ed25519 signature are checked before filesystem staging. HTTP upload limits still need to be applied by the eventual installer route before buffering.

`stageExtensionArchive` writes a verified package to a random staging directory, revalidates the executable contract without executing it, and atomically renames it into the immutable version directory. It checks ancestor directories for links. A repeat of the exact package returns the existing version; a different build cannot overwrite the same version. It does not change current/previous pointers, enable any shop or reset namespace data. Activation must separately coordinate pending commands, permissions and restart/rollback.

Twelve additional archive/staging tests pass, including actual Windows junction refusal and preserving an existing current-version pointer. The package loader now accepts declared camel-case command names, matching commands such as `payment.confirmCash`; the signed metadata still controls their permissions. The archive/loader/package group contains 24 passing tests. This is not evidence of a complete installer or a deployed package.
