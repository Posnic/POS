param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
try {
  if ($env:POSNIC_USER_DATA) { $Destination = Join-Path $env:POSNIC_USER_DATA 'uploads' }
  function Copy-Images([string]$From, [string]$To) {
    if (!(Test-Path -LiteralPath $From)) { return }
    if ((Get-Item -LiteralPath $From).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked upload directories cannot be migrated.' }
    [IO.Directory]::CreateDirectory($To) | Out-Null
    foreach ($entry in Get-ChildItem -LiteralPath $From -Force) {
      if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked uploads cannot be migrated.' }
      $target = Join-Path $To $entry.Name
      if ($entry.PSIsContainer) { Copy-Images $entry.FullName $target }
      elseif (!(Test-Path -LiteralPath $target)) { [IO.File]::Copy($entry.FullName, $target, $false) }
    }
  }
  Copy-Images $Source $Destination
  exit 0
} catch { Write-Output $_.Exception.Message; exit 1 }
