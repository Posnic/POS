#!/usr/bin/env node
/*
 * Refuse to publish installers that are not safe to auto-update.
 *
 * verifyUpdateCodeSignature is false, and it has to be while builds are
 * unsigned - turning it on without a signature to check makes every update
 * fail rather than hardening anything. The danger is not the flag. The danger
 * is that the certificate arrives, signing gets configured, a release goes out,
 * and nobody remembers this one line in package.json. The update channel would
 * then be live, public, and unverified, and nothing would say so.
 *
 * So the flag stops being something to remember. A release that would publish
 * installers to the public fails here unless either:
 *
 *   - update signature verification is on, or
 *   - the release is explicitly marked as an unsigned pre-release, which is a
 *     deliberate act with a name attached rather than an oversight.
 *
 * Run in the release workflow before anything is built.
 */

const pkg = require('../package.json');

const build = pkg.build || {};
const win = build.win || {};
const publish = build.publish || {};

/* An explicit, deliberate escape hatch for a pre-release that is knowingly
   unsigned. Set in the workflow, never in the repository, so it cannot become
   the permanent state by being committed once. */
const allowUnsigned = process.env.POSNIC_ALLOW_UNSIGNED_RELEASE === 'yes-i-know';

const problems = [];
const notes = [];

const verifies = win.verifyUpdateCodeSignature === true;
const isPublic = publish.private === false;

notes.push(`verifyUpdateCodeSignature: ${win.verifyUpdateCodeSignature}`);
notes.push(`publish.private:           ${publish.private}`);
notes.push(`version:                   ${pkg.version}`);

/* The version electron-updater compares has to be three plain integers. A
   prefix parses as NaN, every release classifies as a core update, and
   automatic updates silently stop for everyone. */
const parts = String(pkg.version || '').split('.').map((n) => parseInt(n, 10));
if (parts.length < 3 || parts.some(Number.isNaN)) {
  problems.push(
    `version "${pkg.version}" is not three plain integers. update-service.js ` +
      'parses it with parseInt and treats anything unreadable as a core update, ' +
      'so automatic updates would stop with no error anywhere.'
  );
}

if (isPublic && !verifies) {
  if (allowUnsigned) {
    notes.push('');
    notes.push('Publishing with POSNIC_ALLOW_UNSIGNED_RELEASE set.');
    /*
     * Said precisely, because the old wording stopped being true and a release
     * note that overstates a problem is trusted no more than one that hides it.
     *
     * Windows IS signed and timestamped now - it is built from a desk against a
     * Certum card, and release-windows.js refuses to publish anything that is
     * not. What is still off is verifyUpdateCodeSignature: the updater does not
     * CHECK that signature before applying an update. macOS and Linux remain
     * unsigned outright.
     *
     * The order for turning verification on is in RELEASE_RUNBOOK.md, and it is
     * not just flipping the flag: a Valid signature confirmed on a machine that
     * did not build it, then the flag, then an update proven to apply end to
     * end. Enabling it out of order makes every update fail silently on every
     * till already in the field.
     */
    notes.push('Windows installers ARE signed; what is off is update signature');
    notes.push('verification (verifyUpdateCodeSignature). macOS and Linux are unsigned.');
    notes.push('See docs/RELEASE_RUNBOOK.md before turning verification on.');
  } else {
    problems.push(
      'This release would publish public installers with update signature ' +
        'verification off.\n' +
        '  Either set build.win.verifyUpdateCodeSignature to true - which needs a ' +
        'code signing\n' +
        '  certificate configured, and a signed artifact verified on a clean ' +
        'machine first -\n' +
        '  or set POSNIC_ALLOW_UNSIGNED_RELEASE=yes-i-know in the workflow to say ' +
        'this is a\n' +
        '  deliberate unsigned pre-release.\n' +
        '  See docs/RELEASE_RUNBOOK.md.'
    );
  }
}

if (verifies && !isPublic) {
  problems.push(
    'verifyUpdateCodeSignature is on but publish.private is true. The updater ' +
      'would authenticate to a private repository, and the token flow that made ' +
      'that work has been removed.'
  );
}

for (const n of notes) console.log(n ? `  ${n}` : '');
console.log('');

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}

console.log(
  verifies
    ? 'Release gate passed: updates are signature-verified.'
    : 'Release gate passed.'
);
