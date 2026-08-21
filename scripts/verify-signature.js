'use strict';

/*
 * Did the installer actually get signed, and will it still verify next year?
 *
 * Signing is opt-in here - the build succeeds unsigned when the card is not
 * present, which is what keeps CI working. The cost of that choice is that a
 * forgotten environment variable produces a perfectly normal-looking release
 * that shows "Unknown publisher" on every customer's machine. Nothing else in
 * the pipeline would say a word.
 *
 * So this is the check to run before uploading a build anywhere.
 *
 * It checks the TIMESTAMP as well as the signature, because those two fail at
 * very different times. An unsigned file is obvious the moment somebody runs
 * it. A signed file with no timestamp looks perfect right up to the day the
 * certificate expires, and then every copy ever shipped starts warning at once -
 * including the ones already installed in shops.
 *
 *   npm run sign:verify                 # everything in dist/
 *   npm run sign:verify -- path/to.exe  # one file
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function findSignTool() {
  if (process.env.POSNIC_SIGNTOOL) return process.env.POSNIC_SIGNTOOL;
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const found = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      for (const arch of ['x64', '']) {
        const candidate = path.join(root, entry, arch, 'signtool.exe');
        if (fs.existsSync(candidate)) found.push({ version: entry, candidate });
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => {
    const pa = a.version.split('.').map(Number);
    const pb = b.version.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pb[i] || 0) - (pa[i] || 0);
      if (d) return d;
    }
    return 0;
  });
  return found[0].candidate;
}

function targets() {
  const given = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (given.length) return given;
  const dist = path.join(process.cwd(), 'dist');
  if (!fs.existsSync(dist)) return [];
  return fs
    .readdirSync(dist)
    .filter((f) => /\.exe$/i.test(f))
    .map((f) => path.join(dist, f));
}

function main() {
  const signtool = findSignTool();
  if (!signtool) {
    console.error('signtool.exe not found - install the Windows SDK.');
    process.exit(2);
  }

  const files = targets();
  if (!files.length) {
    console.log('Nothing to verify. Build first, or pass a file path.');
    process.exit(1);
  }

  let bad = 0;
  for (const file of files) {
    let output = '';
    let ok = true;
    try {
      /* /pa uses the Authenticode policy - the one Windows itself applies when
         somebody double-clicks. Verifying under the default driver policy
         passes for files Windows would still warn about. */
      output = execFileSync(signtool, ['verify', '/pa', '/v', file], {
        encoding: 'utf8',
        windowsHide: true,
      });
    } catch (err) {
      ok = false;
      output = (err.stdout || '') + (err.stderr || '');
    }

    const timestamped = /timestamp/i.test(output);
    console.log(`\n  ${path.basename(file)}`);
    console.log(`    signature   ${ok ? 'valid' : 'MISSING or INVALID'}`);
    console.log(
      `    timestamp   ${timestamped ? 'present' : 'ABSENT - dies with the certificate'}`
    );

    if (!ok || !timestamped) {
      bad += 1;
      if (!ok) {
        console.log(
          '\n    Not signed. POSNIC_SIGN_SHA1 was probably unset for this build -\n' +
            '    run `npm run sign:cert` with the card in, then rebuild.'
        );
      }
    }
  }

  if (bad) {
    console.log(`\n${bad} of ${files.length} file(s) are not safe to ship.\n`);
    process.exit(1);
  }
  console.log(`\nAll ${files.length} file(s) signed and timestamped.\n`);
}

main();
