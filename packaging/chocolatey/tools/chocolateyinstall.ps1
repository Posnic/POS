$ErrorActionPreference = 'Stop'

$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'exe'
  url64bit       = 'https://github.com/Posnic/POS/releases/download/v1.6.1/Posnic-1.6.1-windows-x64-installer.exe'
  checksum64     = '4505c90fc0e31a1d2e03237189cdec2613255d34946323e8390c5f0648c1d463'
  checksumType64 = 'sha256'
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
