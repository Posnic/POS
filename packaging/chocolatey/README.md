# Chocolatey package

This directory contains the source for Posnic's Chocolatey Community Repository
package. It installs the official versioned Windows x64 release artifact rather
than embedding the application binary in the package.

Before publishing a release:

1. Update the version and release URLs in `posnic.nuspec` and
   `tools/chocolateyinstall.ps1`.
2. Replace `checksum64` with the SHA-256 published for the matching official
   installer.
3. Run `choco pack packaging/chocolatey/posnic.nuspec`.
4. Test install, first launch, upgrade, uninstall, and reinstall in a disposable
   Windows virtual machine. Confirm uninstall preserves shop data.
5. Submit the resulting package only from the Posnic-maintained Chocolatey
   account and retain access to moderation notices.

The package page must use `https://www.posnic.com/` as the project website and
`https://github.com/Posnic/POS` as the source repository.
