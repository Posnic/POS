#!/usr/bin/env node
/*
 * Fail on a new production advisory; stay quiet about ones already judged.
 *
 * The current dependency graph has no production advisories. Anything npm
 * reports therefore fails the build unless a maintainer explicitly documents
 * why its vulnerable path cannot be reached. An exception costs a paragraph
 * explaining why and an expiry date, which is the right price for keeping the
 * gate useful.
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
const ACCEPTED = {};

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
