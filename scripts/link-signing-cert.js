'use strict';

/*
 * Put the code signing certificate into the Windows store and LINK it to the
 * private key on the card - without waiting for a card driver.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Windows publishes a smart card's certificates by itself only once a
 * MINIDRIVER claims that card model. This card is a cryptoCertum 3.7 and the
 * installed drivers stop at 3.6, so Windows calls it "Unknown Smart Card" and
 * publishes nothing. signtool then sees an empty store while proCertum
 * CardManager displays the certificate perfectly - because CardManager reaches
 * the card through Certum's CSP, which is a different road into the same card.
 *
 * That CSP works. `certutil -csp "cryptoCertum3 CSP" -key -user` enumerates the
 * card's key containers, which means the private key is reachable today. The
 * only missing piece is the PUBLIC certificate, which Windows would normally
 * have copied off the card itself.
 *
 * So: import the public certificate by hand, then have certutil repair the
 * association between it and the key the CSP can already see. After that the
 * certificate behaves like any other - signtool finds it, and nothing else in
 * the build has to know any of this happened.
 *
 * The public certificate is not a secret. Download it from the Certum
 * certificate page (Download DER, or PEM) and pass the file to this script.
 *
 *   node scripts/link-signing-cert.js ~/Downloads/certificate.cer
 *
 * A driver update remains the tidier long-term fix; this is what makes signing
 * possible before one exists.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function run(cmd, args) {
  try {
    return {
      ok: true,
      out: execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true }),
    };
  } catch (err) {
    return { ok: false, out: String((err.stdout || '') + (err.stderr || '')) };
  }
}

function thumbprintOf(file) {
  /* certutil prints the SHA1 hash of the certificate; that is the thumbprint
     the store indexes it by and the one signtool takes for /sha1. */
  const res = run('certutil', ['-dump', file]);
  const m = (res.out || '').match(/Cert Hash\(sha1\):\s*([0-9a-f ]{40,})/i);
  if (!m) return null;
  return m[1].replace(/\s/g, '').toUpperCase();
}

function subjectOf(file) {
  const res = run('certutil', ['-dump', file]);
  const m = (res.out || '').match(/Subject:\s*\r?\n?\s*(.+)/);
  return m ? m[1].trim() : '';
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('Pass the certificate file downloaded from Certum:\n');
    console.log('  node scripts/link-signing-cert.js <path to .cer or .pem>\n');
    console.log('Get it from the certificate page in Certum cert manager -');
    console.log('the "Download DER" or "Download PEM" button. It is the PUBLIC');
    console.log('certificate; the private key never leaves the card.');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`No such file: ${file}`);
    process.exit(1);
  }

  const thumb = thumbprintOf(file);
  if (!thumb) {
    console.error('That file does not look like a certificate certutil can read.');
    process.exit(1);
  }
  console.log(`  certificate  ${subjectOf(file) || path.basename(file)}`);
  console.log(`  thumbprint   ${thumb}`);

  console.log('\n  [1/3] importing the public certificate ...');
  const add = run('certutil', ['-user', '-addstore', 'My', file]);
  /* Already present is a success, not a failure - this script has to be safe to
     run twice, because the interesting step is the one after it. */
  if (!add.ok && !/already exists/i.test(add.out)) {
    console.error(add.out.trim());
    process.exit(1);
  }
  console.log('        done');

  console.log('\n  [2/3] linking it to the key on the card ...');
  console.log('        (the card may ask for your PIN)');
  const repair = run('certutil', ['-user', '-repairstore', 'My', thumb]);
  if (!repair.ok) {
    console.error('\n' + repair.out.trim());
    console.error('\n  Could not associate the private key.');
    console.error('  Check the card is inserted, then try again. If it keeps failing,');
    console.error('  the certificate on the card may belong to a different key pair');
    console.error('  than the one this file describes.');
    process.exit(1);
  }
  console.log('        done');

  console.log('\n  [3/3] verifying ...');
  const check = run('powershell', [
    '-NoProfile',
    '-Command',
    `(Get-Item Cert:/CurrentUser/My/${thumb}).HasPrivateKey`,
  ]);
  const linked = /true/i.test(check.out || '');
  console.log(`        private key linked: ${linked ? 'yes' : 'NO'}`);

  if (!linked) {
    console.error('\n  The certificate is in the store but has no usable private key.');
    console.error('  signtool would refuse it. Do not ship a build believing it signed.');
    process.exit(1);
  }

  console.log('\n  Ready. To sign the next build:\n');
  console.log(`    set POSNIC_SIGN_SHA1=${thumb}`);
  console.log('    npm run build');
  console.log('    npm run sign:verify\n');
}

main();
