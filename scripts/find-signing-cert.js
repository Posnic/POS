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

/*
 * WHY the store is empty, which is a different question from whether it is.
 *
 * "Insert the card and try again" is useless advice to somebody whose card is
 * already inserted and whose CardManager is showing them the certificate. That
 * happened here, and the cause was two layers down: CardManager reaches the
 * card through Certum's own CSP, but WINDOWS only publishes a smart card's
 * certificates once a MINIDRIVER claims that card model. With no match Windows
 * calls it "Unknown Smart Card", publishes nothing, and signtool sees an empty
 * store while the card sits there working perfectly in another application.
 *
 * So this says which of the three it actually is: no card, a card no driver
 * claims, or a card that is claimed but whose certificate is not registered.
 */
function diagnose() {
  const ps = [
    '$ErrorActionPreference = "SilentlyContinue";',
    '$dev = @(Get-PnpDevice -Class SmartCard | ForEach-Object { $_.FriendlyName });',
    '$md  = @(Get-ChildItem "HKLM:/SOFTWARE/Microsoft/Cryptography/Calais/SmartCards" |',
    '        Select-Object -ExpandProperty PSChildName);',
    '[PSCustomObject]@{ Devices = $dev; Minidrivers = $md } | ConvertTo-Json -Compress',
  ].join(' ');

  let info;
  try {
    info = JSON.parse(
      execFileSync('powershell', ['-NoProfile', '-Command', ps], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim()
    );
  } catch (err) {
    return;
  }

  const devices = [].concat(info.Devices || []);
  const drivers = [].concat(info.Minidrivers || []);

  if (!devices.length) {
    console.log('');
    console.log('  No smart card is present. Insert it and check the reader light.');
    return;
  }

  if (devices.some((d) => /unknown/i.test(String(d)))) {
    const certum = drivers.filter((d) => /certum/i.test(String(d))).join(', ');
    console.log('');
    console.log('  Windows sees the card but NO DRIVER CLAIMS IT ("Unknown Smart Card").');
    console.log('  Certum minidrivers registered: ' + (certum || 'none'));
    console.log('');
    console.log('  That is why the store is empty even though proCertum CardManager');
    console.log('  shows the certificate: CardManager reaches the card through the');
    console.log('  Certum CSP, while Windows only publishes card certificates once a');
    console.log('  minidriver recognises the card model.');
    console.log('');
    console.log('  Fix: update the Certum card drivers / proCertum CardManager to a');
    console.log('  build that supports this card model, then reinsert the card.');
    console.log('');
    console.log('  Or skip the wait: the Certum CSP can already reach the key, so the');
    console.log('  certificate can be imported and linked by hand. Download it from the');
    console.log('  Certum page, then: npm run sign:link -- <file>');
    return;
  }

  console.log('');
  console.log('  The card is recognised, but its certificate is not published to the');
  console.log('  Windows store. In proCertum CardManager, Common profile, use the menu');
  console.log('  beside "Certificates" to register it, then run this again.');
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
    console.log('No code signing certificate is visible to Windows.');
    diagnose();
    console.log('');
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
