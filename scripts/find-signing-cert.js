'use strict';

/*
 * Which code signing certificate should the build use?
 *
 * The Certum certificate lives on a cryptographic card. It only becomes visible
 * to Windows - and therefore to signtool - once the card is inserted and
 * proCertum CardManager has registered it into the certificate store. Until
 * then the store holds nothing useful, and a build configured to sign fails
 * with an error that says very little.
 *
 * So this answers the two questions worth answering before a release: is the
 * certificate there at all, and what do I set POSNIC_SIGN_SHA1 to.
 *
 * It deliberately shows expiry. A code signing certificate that expires mid-week
 * is a release that silently starts shipping "Unknown publisher" - and because
 * signing is opt-in here, nothing else would complain.
 */

const { execFileSync } = require('child_process');

const PS = [
  '$ErrorActionPreference = "SilentlyContinue";',
  '$c = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My |',
  '  Where-Object { $_.EnhancedKeyUsageList.FriendlyName -contains "Code Signing" };',
  '$c | ForEach-Object {',
  '  [PSCustomObject]@{',
  '    Subject    = $_.Subject;',
  '    Issuer     = $_.Issuer;',
  '    NotAfter   = $_.NotAfter.ToString("yyyy-MM-dd");',
  '    DaysLeft   = [int]($_.NotAfter - (Get-Date)).TotalDays;',
  '    Thumbprint = $_.Thumbprint;',
  '  }',
  '} | ConvertTo-Json -Compress',
].join(' ');

function read() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', PS], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  /* ConvertTo-Json emits a bare object for one result and an array for several.
     Treating the single case as an array of its own keys is the classic bug
     here - it "finds" five certificates called S, u, b, j, e. */
  return Array.isArray(parsed) ? parsed : [parsed];
}

function main() {
  let certs;
  try {
    certs = read();
  } catch (err) {
    console.error('Could not read the certificate store:', err.message);
    process.exit(2);
  }

  if (!certs.length) {
    console.log('No code signing certificate is visible to Windows.\n');
    console.log('  1. Insert the Certum card and check the reader light.');
    console.log('  2. Open proCertum CardManager and let it register the certificate.');
    console.log('  3. Run this again.\n');
    console.log('Until then the build produces an UNSIGNED installer, which is');
    console.log('what it already does today - nothing is broken by waiting.');
    process.exit(1);
  }

  for (const c of certs) {
    const stale = c.DaysLeft < 0;
    const soon = !stale && c.DaysLeft < 30;
    console.log('');
    console.log(`  Subject    ${c.Subject}`);
    console.log(`  Issuer     ${c.Issuer}`);
    console.log(
      `  Expires    ${c.NotAfter}  (${c.DaysLeft} days)` +
        (stale ? '   *** EXPIRED ***' : soon ? '   *** EXPIRES SOON ***' : '')
    );
    console.log(`  Thumbprint ${c.Thumbprint}`);
  }

  const usable = certs.filter((c) => c.DaysLeft >= 0);
  if (!usable.length) {
    console.log('\nEvery certificate above has expired. Signing with one produces a');
    console.log('signature Windows will not accept.');
    process.exit(1);
  }

  console.log('\nTo sign the next build, in this shell:\n');
  console.log(`  set POSNIC_SIGN_SHA1=${usable[0].Thumbprint}`);
  console.log('  npm run build\n');
  console.log('Or PowerShell:\n');
  console.log(`  $env:POSNIC_SIGN_SHA1 = "${usable[0].Thumbprint}"`);
  console.log('  npm run build\n');
}

main();
