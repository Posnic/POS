# Release dependency review — 7 October 2026

The release lockfiles now resolve Electron 43.7.8 (previously 43.2.0) and
source-map-js 1.2.2 in both the root and frontend dependency trees. These address
the four reported Electron advisories and both source-map-js alerts. The
Electron major version remains 43.

Two upstream advisories have no published patched version in the GitHub
advisory data checked for this release:

- `http-cache-semantics` 4.2.0, GHSA-ch52-4w7c-c8xp: reachable in development
  tooling through electron-builder → app-builder-lib → @electron/get → got →
  cacheable-request. It is not a production dependency. Got's default has
  caching disabled; the downloader does not enable shared HTTP caching. This
  review found no shipped shared cache handling customer responses through it.
- `sprintf-js` 1.1.3, GHSA-hp3w-g68c-fv3c: an optional development dependency
  through global-agent → roarr. It is not a production dependency. The advisory
  requires an attacker-controlled format string with excessive precision.
  Build-tool logging is separate from customer input and application logging.

These alerts have not been dismissed and are not described as patched. Recheck
them when upstream fixes are available or before enabling these packages in a
production request path. Captain's Android dependency tree does not contain
Electron or either unpatched development dependency.

Local validation: 102 packaging, credential packaging, hardened print window,
PDF printing and Windows printer tests passed. The lockfile update changes only
the root Electron declaration and the three dependency records listed above.
Physical printer output was not tested by this check.
