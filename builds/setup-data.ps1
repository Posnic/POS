param(
  [string]$DataRoot, [string]$BackupsRoot, [string]$RecoveryRoot,
  [string]$HardwareManifest, [string]$AppExecutable,
  [ValidateSet('0','1')][string]$KeepBusiness = '1',
  [ValidateSet('0','1')][string]$KeepHardware = '1',
  [ValidateSet('0','1')][string]$KeepBackups = '1',
  [switch]$LibraryOnly
)
$ErrorActionPreference = 'Stop'

# Stream the current filename without flooding the UI for every small file.
$script:progressClock = [Diagnostics.Stopwatch]::StartNew()
function Write-RemovalProgress([string]$Message, [switch]$Force) {
  if ($Force -or $script:progressClock.ElapsedMilliseconds -ge 100) {
    Write-Output $Message
    $script:progressClock.Restart()
  }
}

function Get-ExtendedPath([string]$File) {
  if ($File.StartsWith('\\?\')) { return $File }
  $full = [IO.Path]::GetFullPath($File)
  if ($full.StartsWith('\\')) { return '\\?\UNC\' + $full.Substring(2) }
  return '\\?\' + $full
}

function Assert-DirectChild([string]$Parent, [string]$Child) {
  $resolvedParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\')
  $resolvedChild = [IO.Path]::GetFullPath($Child).TrimEnd('\')
  if ([IO.Path]::GetDirectoryName($resolvedChild) -ne $resolvedParent) { throw 'Unexpected data folder. No data was removed.' }
  if (Test-Path -LiteralPath $resolvedChild) {
    if ((Get-Item -LiteralPath $resolvedChild -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked data folders cannot be removed here.' }
  }
  return $resolvedChild
}
# Keep the per-file loop in compiled code: PowerShell recursion and pipeline
# calls are disproportionately expensive for node_modules' many tiny files.
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Diagnostics;
public static class PosnicRemoval {
  private static readonly Stopwatch progress = Stopwatch.StartNew();
  private static void Report(string action, string path) {
    if (progress.ElapsedMilliseconds < 100) return;
    Console.WriteLine(action + path);
    progress.Restart();
  }
  public static void Validate(FileSystemInfo entry) {
    if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
      throw new IOException("Linked folders cannot be deleted here.");
    var directory = entry as DirectoryInfo;
    if (directory != null)
      foreach (var child in directory.EnumerateFileSystemInfos()) Validate(child);
  }
  public static void Remove(DirectoryInfo directory) {
    foreach (var entry in directory.EnumerateFileSystemInfos()) {
      // Check again during removal; never follow a link introduced later.
      if ((entry.Attributes & FileAttributes.ReparsePoint) != 0)
        throw new IOException("Linked folders cannot be deleted here.");
      var childDirectory = entry as DirectoryInfo;
      if (childDirectory != null) Remove(childDirectory);
      else {
        Report("Deleting: ", entry.FullName);
        if ((entry.Attributes & FileAttributes.ReadOnly) != 0)
          entry.Attributes &= ~FileAttributes.ReadOnly;
        entry.Delete();
      }
    }
    Report("Removing folder: ", directory.FullName);
    directory.Delete();
  }
}
"@
function Assert-UnlinkedTree([IO.FileSystemInfo]$Entry) {
  [PosnicRemoval]::Validate($Entry)
}
function Remove-UnlinkedTree([IO.DirectoryInfo]$Directory) {
  [PosnicRemoval]::Remove($Directory)
}
function Remove-CheckedTree([string]$Root, [switch]$AlreadyChecked) {
  # Windows PowerShell's provider cannot reliably remove paths over MAX_PATH.
  # Validate the entire tree, then use extended paths for the actual removal.
  $extended = Get-ExtendedPath $Root
  if (![IO.Directory]::Exists($extended)) { return }
  Write-RemovalProgress ('Removing folder: ' + $Root) -Force
  $directory = New-Object IO.DirectoryInfo $extended
  if (!$AlreadyChecked) { Assert-UnlinkedTree $directory }
  Remove-UnlinkedTree $directory
}
if ($LibraryOnly) { return }
$locks = @()
try {
  if ([Environment]::Is64BitOperatingSystem -and ![Environment]::Is64BitProcess) {
    throw 'Use the native 64-bit PowerShell host so running applications can be checked safely.'
  }
  Write-RemovalProgress 'Checking that the application is closed...' -Force
  $documents = [Environment]::GetFolderPath('MyDocuments')
  $DataRoot = Assert-DirectChild $env:APPDATA $DataRoot
  $BackupsRoot = Assert-DirectChild $documents $BackupsRoot
  foreach ($running in Get-Process) {
    try { $runningPath = $running.Path } catch { continue }
    if ($AppExecutable -and $runningPath -and $runningPath -eq $AppExecutable) {
      throw 'The application is still running. Close it before removing data.'
    }
  }
  if ($DataRoot -eq $BackupsRoot) { throw 'Data and backup folders must be separate.' }
  $hardwareFiles = Get-Content -LiteralPath $HardwareManifest -Raw | ConvertFrom-Json
  foreach ($name in $hardwareFiles) {
    if ([IO.Path]::GetFileName($name) -ne $name) { throw 'Invalid hardware manifest.' }
  }
  if ($KeepBusiness -eq '0' -and (Test-Path -LiteralPath $DataRoot)) {
    foreach ($name in @('mongodb\data\mongod.lock', 'mongodb\data\WiredTiger.lock')) {
      $lockFile = Join-Path $DataRoot $name
      if (Test-Path -LiteralPath $lockFile) { $locks += [IO.File]::Open($lockFile, 'Open', 'ReadWrite', 'None') }
    }
    Write-RemovalProgress 'Preparing selected local data for removal...' -Force
    # Validate paths before applying the user's explicit deletion choices.
    Assert-UnlinkedTree (New-Object IO.DirectoryInfo (Get-ExtendedPath $DataRoot))
    foreach ($lock in $locks) { $lock.Dispose() }; $locks = @()
    # No automatic recovery copy: saved backups are controlled independently.
    foreach ($entry in Get-ChildItem -LiteralPath $DataRoot -Force) {
      if ($KeepHardware -eq '1' -and $entry.Name -in $hardwareFiles) { continue }
      if ($KeepBackups -eq '1' -and $entry.Name -eq 'backups') { continue }
      if ($entry.PSIsContainer) { Remove-CheckedTree $entry.FullName -AlreadyChecked }
      else { Write-RemovalProgress ('Deleting: ' + $entry.Name); Remove-Item -LiteralPath $entry.FullName -Force }
    }
  } elseif ($KeepHardware -eq '0') {
    foreach ($name in $hardwareFiles) {
      $target = Join-Path $DataRoot $name
      if (Test-Path -LiteralPath $target) { Write-RemovalProgress ('Deleting hardware settings: ' + $name) -Force; Remove-Item -LiteralPath $target -Force }
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
