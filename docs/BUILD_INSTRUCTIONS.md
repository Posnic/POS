# Posnic Build Instructions

For publication, start with [Release handoff](RELEASE_HANDOFF.md). A signed
build ZIP is an input to release verification, not a completed release.

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
if (!(Test-Path .\mongodb\bin\mongod.exe)) { throw 'MongoDB download/setup did not complete. Stop before building.' }
powershell -NoProfile -File .\scripts\build-signed-windows.ps1 -ExpectedCommit <tested-commit>
```

Replace both `<tested-commit>` values with the same full commit hash. The
MongoDB download is a one-time prerequisite. The build helper installs locked
root, API and frontend dependencies, prepares fresh resources, builds both
the Windows installer and standalone portable EXE, and verifies their and the application signatures
and timestamps. If multiple certificates exist, add `-Thumbprint` with the
intended public certificate thumbprint. No password or token PIN belongs in
this command.

Send back `dist/Posnic-<version>-signed-<run>.zip`. It contains both signed EXEs,
blockmap, updater YAML, build commit and checksums. Do not sign the finished
EXE again: that would invalidate its updater hashes. This command does not
push, tag, upload or publish anything.

Run each command on its own line and stop on failure. A returned PowerShell
prompt or a download progress bar does not prove MongoDB was installed. The
batch file's manual fallback mentions `setup-bundled-mongodb.bat`, which is not
present in this checkout: do not send someone looking for that missing script.
If automatic download fails, obtain the Windows x64 **ZIP** for the version
pinned by `src/download-mongodb.bat` from MongoDB's official download source,
extract it into a temporary directory, and copy its `bin` contents into the
repository's `mongodb/bin`. Confirm `mongod.exe --version` matches the pinned
version and run `npm run check:mongodb` after dependencies are installed.
Installing an MSI service alone does not supply the build's bundled files.

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
