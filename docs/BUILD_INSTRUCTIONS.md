# Posnic Build Instructions

## Signed Windows build on another computer

Install Git, Node.js 22.12 or newer, the Microsoft Visual C++ x64 runtime,
the Windows SDK signing tools, and your certificate-token driver. Attach and
unlock the signing token. Enter its PIN only in its own dialog.

Clone the public POS repository. Use the exact tested commit supplied in the
release handoff; do not assume a newer main commit has been tested.

```powershell
git clone https://github.com/Posnic/POS.git
cd POS
git checkout <tested-commit>
.\src\download-mongodb.bat
powershell -NoProfile -File .\scripts\build-signed-windows.ps1 -ExpectedCommit <tested-commit>
```

Replace both `<tested-commit>` values with the same full commit hash. The
MongoDB download is a one-time prerequisite. The build helper installs locked
root, API and frontend dependencies, prepares fresh resources, builds only
the Windows installer, and verifies the application and installer signatures
and timestamps. If multiple certificates exist, add `-Thumbprint` with the
intended public certificate thumbprint. No password or token PIN belongs in
this command.

Send back `dist/Posnic-<version>-signed-<run>.zip`. It contains the signed EXE,
blockmap, updater YAML, build commit and checksums. Do not sign the finished
EXE again: that would invalidate its updater hashes. This command does not
push, tag, upload or publish anything.

A private Gateway checkout is neither needed nor bundled. Cloud activation
uses separately authenticated, signed component delivery. Existing cloud
components must also be rolled out before password-refresh fixes are called
available to customers.

## Unsigned local development build

```powershell
npm ci
npm ci --prefix api
npm ci --prefix frontend
.\src\download-mongodb.bat
$env:SYNC_AGENT_DIR = Join-Path $env:TEMP ([guid]::NewGuid().ToString())
npm run build -- --publish never
```

Do not distribute an unsigned development build as a signed customer release.
macOS builds require macOS. The existing release workflow reads `MAC_CERT_P12`,
`MAC_CERT_PASSWORD`, `ASC_API_KEY_P8`, `ASC_API_KEY_ID` and `ASC_API_ISSUER` from
GitHub secrets and verifies signing and notarization before publication. Secret
presence does not prove certificate validity or a successful build.
