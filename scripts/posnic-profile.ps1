# Run POSNIC against a separate data profile, so one machine can hold more than
# one shop's data (support, demos, testing a client's account before handover).
#
#   .\posnic-profile.ps1 goa
#   .\posnic-profile.ps1 hmf
#   .\posnic-profile.ps1 -List
#
# Each profile gets its own MongoDB data directory, cloud activation and
# settings under %LOCALAPPDATA%\PosnicProfiles\<name>. The default profile
# (plain Posnic.exe) is untouched.
#
# Only one profile can run at a time: the bundled MongoDB always binds
# 127.0.0.1:27018, and a second app would silently attach to the first
# profile's data. This script refuses to start when that port is taken.

param(
  [Parameter(Position = 0)][string]$Profile,
  [switch]$List
)

$ErrorActionPreference = 'Stop'

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Posnic\Posnic.exe'
$root = Join-Path $env:LOCALAPPDATA 'PosnicProfiles'

if ($List) {
  Write-Host "Default profile: $env:APPDATA\Posnic"
  if (Test-Path $root) {
    Get-ChildItem $root -Directory | ForEach-Object {
      $data = Join-Path $_.FullName 'mongodb\data'
      $size = if (Test-Path $data) {
        '{0:N0} MB' -f ((Get-ChildItem $data -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
      } else { 'empty' }
      Write-Host ("  {0,-16} {1,10}  {2}" -f $_.Name, $size, $_.FullName)
    }
  } else {
    Write-Host '  (no extra profiles yet)'
  }
  return
}

if (-not $Profile) { throw 'Give a profile name, for example: .\posnic-profile.ps1 goa' }
if ($Profile -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Profile name may only contain letters, numbers, dash and underscore.' }
if (-not (Test-Path $exe)) { throw "Posnic is not installed at $exe" }

# The port check is the whole safety story. Without it, launching a second
# profile while the first is open would reuse the running mongod and mix two
# companies' data together.
$busy = Get-NetTCPConnection -LocalPort 27018 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  $owner = Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue
  throw ("MongoDB is already listening on 127.0.0.1:27018 (process {0}, pid {1}).`n" -f $owner.ProcessName, $busy[0].OwningProcess) +
        "Close the running POSNIC window completely, wait a few seconds, then run this again."
}

$dir = Join-Path $root $Profile
New-Item -ItemType Directory -Force -Path $dir | Out-Null

Write-Host "Starting POSNIC on profile '$Profile'"
Write-Host "  data: $dir"
Start-Process -FilePath $exe -ArgumentList "--user-data-dir=`"$dir`""
