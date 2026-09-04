#!/usr/bin/env node
/*
 * Fail on a new production advisory; stay quiet about ones already judged.
 *
 * `npm audit` on this project reports two moderate advisories that cannot be
 * reached from any code path here. Left alone, the output is permanently
 * non-zero - and a check that is always red is a check nobody reads, which is
 * how the advisory that does matter gets missed. Ignoring the command entirely
 * has the same effect, more honestly.
 *
 * So each accepted advisory is written down with the reasoning that made it
 * acceptable, and anything not on that list fails the build. The list is short
 * on purpose: an exception costs a paragraph explaining why, which is the right
 * price. If an entry ever stops being true - a dependency starts calling the
 * vulnerable path - it should be deleted rather than amended.
 *
 * Development-only advisories are not covered. They belong to build tooling
 * that never reaches a shop, and mixing them in here would bury the ones that
 * do. Run `npm audit` without --omit=dev to see those.
 */

const { execFileSync } = require('child_process');
const path = require('path');

/*
 * Accepted advisories, by GitHub advisory id.
 *
 * `reason` has to say why it cannot be reached, not that it seems unlikely.
 * `expires` is the date by which it should be looked at again whether or not
 * anything changed - an exception with no expiry becomes permanent by neglect.
 */
const ACCEPTED = {
  'GHSA-w5hq-g745-h8pq': {
    package: 'uuid',
    via: 'exceljs',
    reason:
      'The advisory is a missing bounds check in uuid v3/v5/v6 when a `buf` ' +
      'argument is supplied. exceljs 4.4.0 requires only { v4 } and calls ' +
      'uuidv4() with no arguments, in cf-rule-ext-xform.js, to generate a ' +
      'conditional-formatting id. The vulnerable functions are never called ' +
      'and no buffer is ever passed. The offered fix downgrades exceljs to ' +
      '3.4.0, a breaking change to Excel export, to close a path that does ' +
      'not exist here.',
    expires: '2027-02-01',
  },
  'GHSA-5p4m-2wfm-xmqj': {
    package: 'js-yaml',
    via: 'electron-updater',
    reason:
      'Quadratic CPU consumption while resolving a `!!omap` tag - a denial of ' +
      'service that needs the attacker to choose the YAML being parsed. ' +
      'Nothing in Posnic parses YAML from a shop, a customer, or any input at ' +
      'all: we import js-yaml nowhere ourselves. The only production reach is ' +
      'electron-updater reading latest.yml, which our own release workflow ' +
      'generates and GitHub serves over HTTPS - so feeding it a malicious ' +
      'document means already controlling our releases, at which point the ' +
      'YAML parser is not the problem. electron-builder is the other ' +
      'dependant and is a devDependency, so it is not in a shipped build. ' +
      'The fix landed in js-yaml 5 and was deliberately not backported to 4; ' +
      'electron-updater and electron-builder both require ^4, so taking it ' +
      'means overriding a major version underneath the code that parses the ' +
      'update manifest. Breaking that breaks auto-update for every till, to ' +
      'close a path that needs untrusted YAML we never have.',
    /* Short, because the right resolution is electron-updater moving to
       js-yaml 5 rather than us carrying this indefinitely. Re-check then. */
    expires: '2026-11-01',
  },
  'GHSA-jmr9-qjv8-65gv': {
    package: 'extract-zip',
    via: '@puppeteer/browsers',
    reason:
      'Symlink path traversal while extracting a crafted zip. extract-zip is ' +
      'reached only through whatsapp-web.js -> puppeteer -> @puppeteer/browsers, ' +
      'which uses it to unpack the Chromium build puppeteer downloads from ' +
      "Google's servers over HTTPS. The archive is never attacker-supplied: to " +
      "trigger the traversal you must control that download - Google's CDN and " +
      'the TLS to it - at which point a symlink in a zip is not the exposure. ' +
      'The offered fix is a major bump of whatsapp-web.js, a breaking change to ' +
      'WhatsApp receipts, to close a path that needs a zip we only ever fetch ' +
      'from Google.',
    expires: '2027-02-01',
  },
};

const workspaces = [
  { name: 'desktop', dir: path.join(__dirname, '..') },
  { name: 'api', dir: path.join(__dirname, '..', 'api') },
];

function audit(dir) {
  try {
    /* npm is a batch file on Windows and Node will not spawn one directly, so
       it needs a shell there and nowhere else. Node warns that shell arguments
       are concatenated rather than escaped; every argument here is a literal in
       this file and none comes from input, so there is nothing to escape. CI
       runs on Linux, where the shell - and the warning - are not used. */
    const out = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 64,
      shell: process.platform === 'win32',
    });
    return JSON.parse(out);
  } catch (e) {
    /* npm exits non-zero when it finds anything, and still prints the report -
       which is the normal case here, not an error. */
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout);
      } catch {
        /* fall through to the throw below */
      }
    }
    throw new Error(`npm audit could not be run in ${dir}: ${e.message}`);
  }
}

let unexplained = 0;
let accepted = 0;
const today = new Date().toISOString().slice(0, 10);

for (const ws of workspaces) {
  const report = audit(ws.dir);
  const advisories = Object.values(report.vulnerabilities || {});

  for (const vuln of advisories) {
    for (const via of vuln.via || []) {
      if (typeof via !== 'object' || !via.url) continue;

      const id = via.url.split('/').pop();
      const known = ACCEPTED[id];

      if (!known) {
        unexplained += 1;
        console.error(`::error::${ws.name}: unreviewed ${vuln.severity} advisory in ${vuln.name}`);
        console.error(`  ${via.title}`);
        console.error(`  ${via.url}`);
        console.error(
          '  Fix it, or add it to ACCEPTED in scripts/check-advisories.js with ' +
            'the reason it cannot be reached from this code.'
        );
        continue;
      }

      accepted += 1;
      if (known.expires && known.expires <= today) {
        unexplained += 1;
        console.error(
          `::error::${ws.name}: the accepted advisory ${id} (${known.package}) was due for ` +
            `review on ${known.expires}. Re-check whether it still cannot be reached, then ` +
            'either fix it or move the date.'
        );
      } else {
        console.log(`  accepted: ${id} in ${vuln.name} via ${known.via} (review by ${known.expires})`);
      }
    }
  }
}

console.log('');
if (unexplained) {
  console.error(`${unexplained} production advisory finding(s) need a decision.`);
  process.exit(1);
}

console.log(
  accepted
    ? `No unreviewed production advisories. ${accepted} accepted and documented.`
    : 'No production advisories at all.'
);
