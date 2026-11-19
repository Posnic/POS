# Release handoff: start here

Use this checklist for each release, including one resumed in another chat or
on another computer. Read `AGENTS.md`, [BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md),
[RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md), and [VERIFY_RELEASE.md](VERIFY_RELEASE.md).
The current workflow and scripts are authoritative if targets change.

## 1. Freeze the source and record the scope

- Record version, full 40-character source commit, tag, stable/prerelease intent,
  approved changes, and links to merged PRs. Fetch main and inspect the diff;
  do not call a historical hash the latest main without checking.
- Use a clean checkout. Reconcile main/develop through normal reviewed PRs if
  requested. Do not bypass branch protection or push unrelated changes.
- Update package version and lockfile consistently before freezing the commit.
  Confirm the tag resolves to that commit; never move a published tag.
- Record relevant local checks, security findings, CI results and runtime tests.
  A green CodeQL job does not mean zero findings. Record unresolved blockers.
- Review API/Gateway/sync-agent compatibility and rollout order separately.
  A desktop release does not deploy the cloud or private components.
- Inspect `.github/workflows/release.yml`, `windows-release-verify.yml`,
  `publish-apt.yml`, `publish-snap.yml`, `notify-site-of-release.yml`, package
  targets, and signing/verification scripts before dispatching anything.

Keep per-release evidence in `docs/releases/<version>-verification.md` (create
the directory if needed). Include no credentials, recovery tokens or customer
data. Record artifact names, SHA-256, workflow URLs and test limitations there.

## 2. Build Windows on the signing computer

Give the operator the exact tested commit and the commands in
[BUILD_INSTRUCTIONS.md](BUILD_INSTRUCTIONS.md). The USB token stays on that
computer; never request its PIN or private key. The script builds locally and
does not publish. A RustDesk session or shared drive is not a substitute for
running the signing script where the token and driver are available.

Stop if `mongodb/bin/mongod.exe` is missing. Follow the documented ZIP fallback
if the downloader fails; do not treat its return to the prompt as success.

Receive the complete `Posnic-<version>-signed-<run>.zip`, not just one EXE.
Inspect it in a fresh directory. Verify `BUILD-INFO.json` version/commit,
checksums, and both EXEs' Authenticode publisher, validity and timestamp.
Recheck the contained updater YAML against the final signed installer bytes.
Never sign the completed files again or rename the installer to portable.

The handoff ZIP currently contains installer, portable EXE, installer blockmap,
updater YAML, BUILD-INFO and checksums. It does **not** contain the finished
release SBOMs or `WINDOWS-RELEASE.json`; the release operator must prepare those.
It is not sufficient to upload the ZIP and call the release complete.

## 3. Assemble the unpublished release

The tag-driven `release.yml` builds macOS and Linux. Watch the actual run to
completion and inspect each job, including notarization. Existing Apple secrets
do not prove Apple agreements, credentials or certificates are valid. Retry an
existing tag through the workflow's `tag` input only after resolving its cause;
record which source was checked because dispatch CI can run from main.

Required package matrix (confirm against current package.json):

| Platform | Required packages | Verification |
| --- | --- | --- |
| Windows x64 | Installer EXE **and portable EXE** | Authenticode publisher + timestamp; install and portable smoke tests |
| macOS x64 | DMG and ZIP | Signing, notarization and target-OS launch evidence |
| macOS arm64 | DMG and ZIP | Signing, notarization and target-OS launch evidence |
| Linux x64 | AppImage, Debian and Snap | Package inspection and target-OS smoke evidence |

Also require channel-appropriate update YAML, generated blockmaps,
`release-manifest.json` when emitted by the workflow, checksums, and provenance.
The current SBOM generator covers EXE, DMG, ZIP, AppImage and DEB; record Snap's
different coverage explicitly rather than claiming an SBOM was generated for it.

For Windows, from the exact source checkout with its locked dependencies
installed, generate artifact-bound SBOMs using:

```powershell
node scripts/generate-release-sboms.js --dist <fresh-windows-artifact-directory>
```

Prepare `WINDOWS-RELEASE.json` using the schema enforced by
`scripts/verify-windows-release.js`: schemaVersion 1, repository `Posnic/POS`,
exact tag/sourceCommit, buildOrigin `local-certum-card`, and `files` containing
exactly the six names returned by `expectedNames(version)` with each file's
lowercase SHA-256 and byte size. Validate with its exported `validateManifest`
and `verifyFiles` functions before uploading. The verifier currently requires
a plain `vX.Y.Z` tag and `latest.yml`; do not assume beta-tag support.

Upload only reviewed public artifacts into the **draft**. Do not blindly use
`--clobber`, legacy upload helpers or `release:ship --yes`: inspect their current
behavior first, especially reuse of stale dist files and automatic publication.
Preserve valid signed packages while repairing metadata. Merge Windows checksum
entries into the cross-platform SHA256SUMS.txt without losing other platforms.

Dispatch the existing verification job with the locally calculated manifest
digest (replace all placeholders):

```powershell
gh workflow run windows-release-verify.yml --repo Posnic/POS --ref main -f tag=<tag> -f source_commit=<full-commit> -f manifest_sha256=<manifest-sha256>
```

Watch its completion and verify attestations using the Windows custom predicate
in [VERIFY_RELEASE.md](VERIFY_RELEASE.md). This proves verification of locally
built files, not a GitHub-hosted or reproducible Windows build.

## 4. Test actual packages before publication

- Inspect unpacked resources and nested archives for private source, secrets,
  customer data and stale bundled files. Do not bundle private Gateway code.
- Fresh install: Community setup, login, item creation, sale, stock movement,
  backup and restore using disposable data. Optional billing outlets stay off
  unless explicitly enabled; check enabled behavior separately.
- Upgrade an existing test installation in place with the app fully closed:
  record profile path, shop identity, item/sale IDs and settings before/after.
  Unexpected setup or a different database is a blocker, not a cue to create
  another shop. Test portable separately and record its actual profile behavior.
- Cloud-connected test: connection approval, login, cloud reset followed by
  desktop login, offline login and reconnect, latest credential conflict rules,
  and business-data sync in required directions. Use test accounts only.
- Password recovery choices appear after Forgot Password. Unlinked Community
  credentials are not recovered by a cloud reset. Verify expired/used links and
  failed requests, not only successful email delivery.
- Print a sale through normal Print, including Save as PDF via the print dialog,
  and inspect the output. Test ESC/POS where hardware is available. Submission
  success does not prove paper output; record physical output as unverified if
  nobody can inspect it.
- Record target OS, version/commit, package hash, result, screenshots and failures.
  Never substitute unit tests or archive inspection for a launch test.

## 5. Publish and verify every delivery channel

Keep the release draft until the full matrix and gates pass. Record an explicit
owner-approved exception for any partial release; do not infer it from urgency.
Confirm prerelease intent: `POSNIC_PRERELEASE=no` selects stable in the current
workflow; installed stable clients normally ignore prereleases.

After authorized publication, verify public asset downloads and hashes, update
manifests, README downloads, repository version metadata, release notes, and the
live website download page and What's New content. Update static links/sizes
and fallback markup even if JavaScript discovers the latest release dynamically.

Check downstream APT, Snap Store and website workflow logs and their live output.
These workflows can finish green while **skipping** publication for missing
credentials. Dispatch success is not deployment success. Do not announce a
channel as available until verified; report each skipped/blocked destination.
Verify a normal installed client's update discovery and apply/restart path.

Support guidance: back up, fully close Posnic, install the correct signed update
over the existing installation without uninstalling, then verify the same shop
and recent records. Never tell a customer to delete their local shop or promise
that an update fixes an unrelated printer driver or unlinked offline password.
Read sent history before notifying affected customers; do not duplicate updates.

## Copyable prompt for the next agent

> Prepare/review the Posnic release from the approved main commit. Read AGENTS.md
> and docs/RELEASE_HANDOFF.md first, then the referenced workflows and scripts.
> Confirm the exact version, commit, tag, channel and existing release state.
> Use the signed Windows handoff supplied by the owner; verify installer AND
> portable, source declaration, signatures, timestamps, hashes and updater
> metadata. Complete macOS x64/arm64 and Linux AppImage/DEB/Snap through the
> existing workflows. Keep the release draft until all required gates pass.
> Test actual packages and upgrade/profile preservation; distinguish untested
> platforms and physical printing from passing checks. Prepare SBOMs and Windows
> verification provenance. Inspect public contents. Do not move tags, replace
> validated binaries silently, expose private components or bypass protections.
> Verify README, website downloads/What's New, APT, Snap and updater delivery.
> Save results in docs/releases/<version>-verification.md and report built,
> signed, tested, published or blocked for each platform/channel. Do not claim
> the whole release complete from one uploaded EXE. Ask only for a concrete
> missing authorization or external blocker after preparing reviewable work.
