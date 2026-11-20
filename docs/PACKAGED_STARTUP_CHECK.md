# Native package verification

Every normal release contains nine packages: Windows x64 installer and portable EXE, macOS x64 and arm64 DMG and ZIP, Linux x64 AppImage, DEB and Snap.

Source checks alone do not prove packaging. Keep all three layers:

1. `check-packaged-modules.js` checks relative imports and rejects desktop JS/extraResources collisions.
2. The afterPack hook opens the actual ASAR and verifies declared desktop JS on every platform.
3. `check-distribution-packages.cjs` installs/extracts and launches every native package format on disposable GitHub-hosted runners. It requires the first-run wizard to render and remain alive, rejects startup exceptions/exits/timeouts, and checks the runtime archive, API dependency ZIP and MongoDB. Windows installer installation and DEB/Snap installation run only on disposable runners. Snap runs through its installed launcher under confinement. macOS runs separately on native Intel and Apple Silicon.

PR packages are unsigned test builds and are never uploaded as downloads. Actual release packages are retested: Linux before upload, both macOS architectures after downloading the signed release artifacts, and signed Windows installer/portable through windows-release-verify.yml. Existing signature/notarization and updater-hash checks remain mandatory.

Each successful native run writes PACKAGE-CHECK-platform-arch.json with exact artifact hashes, source commit and workflow run ID. Windows verification uploads this report to the draft only after both signed packages boot. release:ship and APT/Snap/site workflows reject absent/failed/stale evidence, changed artifact bytes, or evidence from a PR workflow. Run Windows verification against the draft before attempting publication. Rerun verification after any artifact changes. Never manually bypass the gates with gh release edit.

Coverage is fresh installation/startup, not every feature, upgrade schema, authenticated shop login, physical printing or cloud sync. Those need their own acceptance checks. No test can guarantee the absence of all defects. Do not claim a platform passed until its native CI job succeeds. Reports cannot prevent a repository administrator from manually bypassing the documented publication process.
