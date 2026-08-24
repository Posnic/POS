# Verify a Posnic release

Use this procedure before installing a Posnic package or citing its contents in
a review. Work with one exact GitHub release and keep these three files together:

1. the package you intend to install;
2. `<package-filename>.cdx.json`; and
3. `SHA256SUMS.txt`.

Download them only from the matching release under
<https://github.com/Posnic/POS/releases>. A file from another tag can have a
valid checksum and still be the wrong version.

Older releases may predate the SBOM and provenance workflow. Missing files or
attestations do not prove tampering, but they also cannot be counted as checks
that passed. Record the release as unverified for that control and use a newer
release when those controls are required.

## 1. Match the package to the published checksum

Set the exact file name first. This example uses the Windows installer; replace
it with the package you downloaded.

### Windows PowerShell

```powershell
$artifact = "Posnic-1.4.0-windows-x64-installer.exe"
$line = Select-String -LiteralPath .\SHA256SUMS.txt -Pattern "  $([regex]::Escape($artifact))$"
if ($line.Count -ne 1) { throw "Expected one checksum line for $artifact" }
$expected = $line.Line.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath ".\$artifact").Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "Checksum mismatch for $artifact" }
"Checksum matches: $actual"
```

### macOS or Linux

```bash
artifact='Posnic-1.4.0-macos-arm64.dmg'
expected=$(awk -v file="$artifact" '$2 == file { print $1 }' SHA256SUMS.txt)
test -n "$expected" || { echo "No checksum for $artifact" >&2; exit 1; }
actual=$(shasum -a 256 "$artifact" | awk '{ print $1 }')
test "$actual" = "$expected" || { echo "Checksum mismatch for $artifact" >&2; exit 1; }
printf 'Checksum matches: %s\n' "$actual"
```

Stop if the values differ. Do not run the package and do not repair the checksum
file yourself.

## 2. Confirm the SBOM describes those exact bytes

A release made with the current workflow publishes one CycloneDX document
beside every installable package.
Its file name is the complete artifact name followed by `.cdx.json`.

### Windows PowerShell

```powershell
$sbom = Get-Content -LiteralPath ".\$artifact.cdx.json" -Raw | ConvertFrom-Json
$recorded = ($sbom.metadata.component.hashes | Where-Object alg -eq 'SHA-256').content
if ($recorded -ne $actual) { throw "SBOM does not describe $artifact" }
$recordedName = ($sbom.metadata.component.properties | Where-Object name -eq 'posnic:artifact:file-name').value
if ($recordedName -ne $artifact) { throw "SBOM names $recordedName, not $artifact" }
"SBOM matches $recordedName"
```

### macOS or Linux

This command uses `jq` to read the JSON document.

```bash
sbom="$artifact.cdx.json"
recorded=$(jq -r '.metadata.component.hashes[] | select(.alg == "SHA-256") | .content' "$sbom")
test "$recorded" = "$actual" || { echo "SBOM does not describe $artifact" >&2; exit 1; }
recorded_name=$(jq -r '.metadata.component.properties[] | select(.name == "posnic:artifact:file-name") | .value' "$sbom")
test "$recorded_name" = "$artifact" || { echo "SBOM names $recorded_name" >&2; exit 1; }
printf 'SBOM matches %s\n' "$recorded_name"
```

The document lists the locked production API packages and explicit components
for the Posnic source, Electron runtime and bundled MongoDB Community Server.
It records separate component licences. The complete package is a mixed-licence
aggregate; do not assign Posnic's AGPL licence to every bundled component.

## 3. Verify release provenance

Install the [GitHub CLI](https://cli.github.com/) and verify both the package and
its SBOM against the public repository:

```bash
gh attestation verify "$artifact" -R Posnic/POS
gh attestation verify "$artifact.cdx.json" -R Posnic/POS
```

The command must identify `Posnic/POS` and the expected release source. Stop if
no valid attestation is found or if the repository, ref or workflow is not the
one you intended to trust.

## 4. Read the package licence material

Installed packages expose a `resources/licenses` directory without requiring
`app.asar` to be unpacked. It contains:

- `POSNIC-AGPL-3.0.txt` for Posnic's own source;
- `MONGODB-SSPL-1.0.txt` for the bundled MongoDB Community Server; and
- `THIRD-PARTY-NOTICES.md` for known package components and boundaries.

The SBOM is an inventory, not legal advice. Review the source and terms for the
exact component and intended use or redistribution.

## What each check proves

| Check | What it establishes | What it does not establish |
|---|---|---|
| SHA-256 against `SHA256SUMS.txt` | Your package bytes match the public release list | That the publisher account or release itself was not compromised |
| Artifact hash inside the CycloneDX file | The selected SBOM names and hashes the exact package | That the inventory is complete, vulnerability-free or legally sufficient |
| GitHub artifact attestation | The subject is tied to the stated repository, workflow, ref and commit | Code signing, safety, correctness, independent review or reproducible builds |
| Platform code signature | The operating system can identify the signer when a valid signature is present | That the software has no defects or is suitable for a business |

Checksums, SBOMs, provenance and code signing answer different questions. A pass
in one column cannot substitute for a missing check in another.

## Report a problem

For a mismatched checksum, missing SBOM, wrong component version or incorrect
licence record, open a public issue without attaching shop data. Report a
security vulnerability privately to **security@posnic.com** as described in
[SECURITY.md](../SECURITY.md).
