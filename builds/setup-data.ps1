param(
  [string]$DataRoot, [string]$BackupsRoot, [string]$RecoveryRoot,
  [string]$HardwareManifest, [string]$AppExecutable,
  [ValidateSet('0','1')][string]$KeepBusiness = '1',
  [ValidateSet('0','1')][string]$KeepHardware = '1',
  [ValidateSet('0','1')][string]$KeepBackups = '1',
  [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'

function Assert-DirectChild([string]$Parent, [string]$Child) {
  $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
  $resolvedChild = [IO.Path]::GetFullPath($Child).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($resolvedChild) -ne $resolvedParent) { throw 'Unexpected data folder. No data was removed.' }
  if (Test-Path -LiteralPath $resolvedChild) {
    if ((Get-Item -LiteralPath $resolvedChild -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked data folders cannot be removed here.' }
  }
  return $resolvedChild
}
function Get-RecoveryHash([string]$File) {
  $stream = [IO.File]::OpenRead($File)
  $digest = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($digest.ComputeHash($stream)) }
  finally { $stream.Dispose(); $digest.Dispose() }
}
function Copy-VerifiedTree([string]$Source, [string]$Destination) {
  [IO.Directory]::CreateDirectory($Destination) | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $Source -Force) {
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Recovery cannot follow linked folders.' }
    # These database lock handles are held exclusively by this helper.
    if ($entry.Name -in @('mongod.lock', 'WiredTiger.lock')) { continue }
    $target = Join-Path $Destination $entry.Name
    if ($entry.PSIsContainer) { Copy-VerifiedTree $entry.FullName $target }
    else {
      [IO.File]::Copy($entry.FullName, $target, $false)
      if ((Get-RecoveryHash $entry.FullName) -ne (Get-RecoveryHash $target)) {
        throw 'Recovery verification failed. Existing data was not removed.'
      }
    }
  }
}
function Remove-CheckedTree([string]$Root) {
  # Check every descendant before Remove-Item can traverse it.
  if (!(Test-Path -LiteralPath $Root)) { return }
  $linked = Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
  if ($linked) { throw 'Linked folders cannot be deleted here.' }
  Remove-Item -LiteralPath $Root -Recurse -Force
}
if ($LibraryOnly) { return }
$locks = @()
try {
  $documents = [Environment]::GetFolderPath('MyDocuments')
  $DataRoot = Assert-DirectChild $env:APPDATA $DataRoot
  $BackupsRoot = Assert-DirectChild $documents $BackupsRoot
  $RecoveryRoot = Assert-DirectChild $documents $RecoveryRoot
  foreach ($running in Get-Process) {
    try { $runningPath = $running.Path } catch { continue }
    if ($AppExecutable -and $runningPath -and $runningPath -eq $AppExecutable) {
      throw 'The application is still running. Close it before removing data.'
    }
  }
  if ($RecoveryRoot -eq $BackupsRoot -or $DataRoot -eq $BackupsRoot) { throw 'Recovery must be separate from deleted folders.' }
  $hardwareFiles = Get-Content -LiteralPath $HardwareManifest -Raw | ConvertFrom-Json
  foreach ($name in $hardwareFiles) {
    if ([IO.Path]::GetFileName($name) -ne $name) { throw 'Invalid hardware manifest.' }
  }
  if ($KeepBusiness -eq '0' -and (Test-Path -LiteralPath $DataRoot)) {
    foreach ($name in @('mongodb\data\mongod.lock', 'mongodb\data\WiredTiger.lock')) {
      $lockFile = Join-Path $DataRoot $name
      if (Test-Path -LiteralPath $lockFile) { $locks += [IO.File]::Open($lockFile, 'Open', 'ReadWrite', 'None') }
    }
    $copyRoot = Join-Path $RecoveryRoot ('recovery-' + [Guid]::NewGuid().ToString('N'))
    Copy-VerifiedTree $DataRoot $copyRoot
    [IO.File]::WriteAllText((Join-Path $copyRoot 'recovery-info.txt'), 'Verified local recovery copy. Not restored or uploaded automatically. Restore only with the original Windows account and compatible application version.')
    foreach ($lock in $locks) { $lock.Dispose() }; $locks = @()
    # Leave selected hardware files in place; remove all other entries only
    # after the entire recovery copy has passed hash verification.
    foreach ($entry in Get-ChildItem -LiteralPath $DataRoot -Force) {
      if ($KeepHardware -eq '1' -and $entry.Name -in $hardwareFiles) { continue }
      if ($KeepBackups -eq '1' -and $entry.Name -eq 'backups') { continue }
      if ($entry.PSIsContainer) { Remove-CheckedTree $entry.FullName }
      else { Remove-Item -LiteralPath $entry.FullName -Force }
    }
  } elseif ($KeepHardware -eq '0') {
    foreach ($name in $hardwareFiles) {
      $target = Join-Path $DataRoot $name
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
    }
  }
  if ($KeepBackups -eq '0') {
    Remove-CheckedTree $BackupsRoot
    Remove-CheckedTree (Join-Path $DataRoot 'backups')
  }
  Write-Output 'Selected local data choices applied. Cloud data unchanged.'
  exit 0
} catch {
  Write-Output ('Could not finish safely. Close the application and retry. ' + $_.Exception.Message)
  exit 1
} finally { foreach ($lock in $locks) { $lock.Dispose() } }
