# Product version

The root `package.json` is the only manually maintained product version.

Use `npm version <version> --no-git-tag-version` to change it. The npm version
lifecycle runs `scripts/sync-version.js`, which updates generated package,
citation, API-documentation and release metadata. Review and commit the generated
files together. If editing the root field directly, run `node scripts/sync-version.js`.
`node scripts/sync-version.js --check` rejects inconsistent generated metadata.

The frontend build substitutes the root version into login metadata. API deploys
and desktop packaging stamp `api/product-version.json` from the same root field;
standalone cloud APIs can read it without a parent checkout. Root version changes
trigger both API and frontend deployment workflows.

The desktop badge continues to report Electron's installed version, not the newest
GitHub release. An old installer must never claim to have received newer fixes.
API and frontend build identities can differ during a rolling update and remain
separate support details. API schema and sync protocol numbers are independent
compatibility contracts, not product release versions.

Historical release notes and evidence keep the version actually tested. Website
download metadata follows the published GitHub release, not unreleased develop
commits. Changing a version does not publish or upgrade an installed application.
