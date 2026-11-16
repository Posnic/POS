# Run on the Windows computer with the signing token connected.
# This command builds locally. It does not tag, push, upload or publish.
[CmdletBinding()]
param(
    [string]$Thumbprint,
    [string]$ExpectedCommit
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$oldSigning = $env:POSNIC_SIGN_SHA1
$oldAgent = $env:SYNC_AGENT_DIR
function Run-Checked([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE. Build stopped." }
}
Push-Location $root
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Run this script on Windows with the USB token attached.' }
    Get-Command node,npm.cmd,git -ErrorAction Stop | Out-Null
    Run-Checked node -Arguments @('-e', 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<12))process.exit(1)')
    $branch = (& git branch --show-current).Trim()
    if ($LASTEXITCODE -ne 0 -or ($branch -ne 'main' -and !$ExpectedCommit)) { throw 'Use main, or pass the exact tested commit with -ExpectedCommit.' }
    $dirty = & git status --porcelain --untracked-files=normal
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit or move local changes first. This build requires a clean checkout.' }
    $commit = (& git rev-parse HEAD).Trim()
    if ($ExpectedCommit -and $commit -ne $ExpectedCommit) { throw 'Checkout does not match the tested release commit.' }
    $certs = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
        $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date)
    })
    if ($Thumbprint) {
        $Thumbprint = $Thumbprint -replace '\s',''
        $certs = @($certs | Where-Object { $_.Thumbprint -eq $Thumbprint })
    }
    if (!$certs.Count) { throw 'No valid code-signing certificate with a private key in CurrentUser\My. Install the token driver and register its certificate first (npm run sign:cert).' }
    if ($certs.Count -gt 1) {
        $certs | Select-Object Subject,Thumbprint,NotAfter | Format-List
        throw 'More than one signing certificate. Run again with -Thumbprint followed by the intended certificate thumbprint.'
    }
    $cert = $certs[0]
    $env:POSNIC_SIGN_SHA1 = $cert.Thumbprint
    Write-Host "Publisher: $($cert.Subject)" -ForegroundColor Cyan
    Write-Host 'Enter the token PIN only in the token software dialog. This script never reads or saves it.'
    Write-Host 'The driver may prompt more than once, or use an already unlocked session.'
    # Public installer: the signed cloud component is delivered after activation.
    # Never auto-discover a private sibling checkout or inherit SYNC_AGENT_DIR.
    $env:SYNC_AGENT_DIR = Join-Path $env:TEMP ('posnic-public-' + [guid]::NewGuid().ToString('N'))
    if (!(Test-Path 'mongodb\bin\mongod.exe')) {
        throw 'MongoDB build prerequisite missing. Run src\download-mongodb.bat once, then run this command again.'
    }
    Run-Checked npm.cmd -Arguments @('ci')
    Run-Checked npm.cmd -Arguments @('ci','--prefix','api')
    Run-Checked npm.cmd -Arguments @('ci','--prefix','frontend')
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $run = [guid]::NewGuid().ToString('N').Substring(0,8)
    $out = Join-Path $root "dist\signed-$version-$run"
    Run-Checked npm.cmd -Arguments @('run','prebuild')
    $agentFiles = @(Get-ChildItem 'builds/sync-agent' -Force -Recurse -File | Where-Object { $_.Name -ne '.placeholder' })
    if ($agentFiles.Count) { throw 'Public build contains unexpected sync component files. Build stopped.' }
    Run-Checked npx.cmd -Arguments @('electron-builder','--win','nsis','--x64','--publish','never',"--config.directories.output=$out")
    $exe = Join-Path $out "Posnic-$version-windows-x64-installer.exe"
    if (!(Test-Path -LiteralPath $exe)) { throw 'The expected installer was not generated.' }
    $appSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $out 'win-unpacked/Posnic.exe')
    if ($appSignature.Status -ne 'Valid' -or !$appSignature.TimeStamperCertificate -or
        $appSignature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
        throw 'Application signature, publisher or timestamp verification failed.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $exe
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate -or
        $signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
        throw 'Installer signature, publisher or timestamp verification failed. Do not distribute this build.'
    }
    # Validate updater hashes after signing; never sign the completed EXE again.
    Run-Checked node -Arguments @('scripts/signed-build-bundle.js',$out,$version,$commit,$cert.Subject)
    $bundle = Join-Path $out 'handoff'
    $zip = Join-Path $root "dist\Posnic-$version-signed-$run.zip"
    Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $zip
    Write-Host "`nVerified signed build: $zip" -ForegroundColor Green
    Write-Host 'Send this ZIP back, including its update metadata. Nothing has been published.'
} finally {
    $env:POSNIC_SIGN_SHA1 = $oldSigning
    $env:SYNC_AGENT_DIR = $oldAgent
    Pop-Location
}

