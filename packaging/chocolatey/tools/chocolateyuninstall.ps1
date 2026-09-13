$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  softwareName   = 'Posnic*'
  fileType       = 'exe'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

[array]$keys = Get-UninstallRegistryKey -SoftwareName $packageArgs.softwareName

if ($keys.Count -eq 1) {
  $packageArgs.file = $keys[0].UninstallString
  Uninstall-ChocolateyPackage @packageArgs
} elseif ($keys.Count -gt 1) {
  throw "Found $($keys.Count) Posnic uninstall entries; refusing to choose one automatically."
}
