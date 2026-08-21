'use strict';

/*
 * Authenticode signing for the Windows build, against a Certum card.
 *
 * WHY A CUSTOM HOOK RATHER THAN JUST `certificateSubjectName`
 *
 * electron-builder can invoke signtool by itself, and for a certificate held in
 * a .pfx that is the right answer. A cryptographic card is different in three
 * ways, and each of them costs a build if it is not handled here:
 *
 *   1. THE CARD IS NOT ALWAYS THERE. Releases build on GitHub-hosted
 *      windows-latest runners, which have no reader and never will. With a
 *      certificate named in package.json the build FAILS there; with signing
 *      driven by an environment variable it simply produces the unsigned
 *      installer it produces today. Turning signing on must not turn CI off.
 *
 *   2. TIMESTAMPING IS A NETWORK CALL, and public TSAs flake. An unretried
 *      failure throws away a ten-minute build for a hiccup that clears in two
 *      seconds. It is retried here.
 *
 *   3. THE CARD ASKS FOR A PIN, once per file, and electron-builder signs
 *      several. Nothing can suppress that from this side, but naming the file
 *      being signed at least tells you which prompt you are answering.
 *
 * TIMESTAMPING IS NOT OPTIONAL. A signature without one stops validating the
 * day the certificate expires - so every installer already in a shop's hands
 * would start warning. With one, it stays valid after expiry, which is the
 * whole point of signing a thing people keep.
 *
 * TURNING IT ON
 *
 *   POSNIC_SIGN_SHA1=<thumbprint>     preferred - unambiguous
 *   POSNIC_SIGN_SUBJECT=<CN>          alternative, if two certs share a subject
 *                                     this picks the wrong one silently
 *
 * Neither set: signing is skipped, loudly enough to notice, and the build
 * succeeds. That is the CI case and the "I forgot the card" case, which look
 * identical from here and want the same answer.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/* Certum's timestamping authority. RFC-3161, SHA-256. */
const TIMESTAMP_URL = process.env.POSNIC_SIGN_TSA || 'http://time.certum.pl';
const TIMESTAMP_ATTEMPTS = 3;

let warnedNotConfigured = false;

/*
 * The newest signtool.exe on this machine.
 *
 * Hardcoding a Windows Kit version is a build that breaks on the next SDK
 * update, on a machine nobody is looking at. x64 first, then the older
 * un-suffixed layout that Kits before 10.0.15063 used.
 */
function findSignTool() {
  if (process.env.POSNIC_SIGNTOOL) return process.env.POSNIC_SIGNTOOL;

  /* Forward slashes on purpose: Node accepts them on Windows, and they keep
     this line free of the backslash escaping that makes Windows paths in JS
     source a reliable source of silent typos. */
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
  /* Version directories sort correctly as strings only by accident; compare
     the numeric parts so 10.0.9 does not beat 10.0.26100. */
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

function selector() {
  const sha1 = (process.env.POSNIC_SIGN_SHA1 || '').replace(/\s/g, '');
  if (sha1) return ['/sha1', sha1];
  const subject = process.env.POSNIC_SIGN_SUBJECT || '';
  if (subject) return ['/n', subject];
  return null;
}

/*
 * Output is CAPTURED, not inherited, because the retry decision depends on
 * reading it. The card's PIN prompt is a dialog drawn by its own driver, not
 * console input, so nothing here swallows an interactive question.
 */
function signOnce(signtool, args) {
  try {
    const out = execFileSync(signtool, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (out && out.trim()) console.log(out.trim());
    return { ok: true, output: out || '' };
  } catch (err) {
    const output = String((err.stdout || '') + (err.stderr || ''));
    if (output.trim()) console.log(output.trim());
    return { ok: false, output };
  }
}

/*
 * Is this worth trying again?
 *
 * ONLY a timestamping failure. Everything else fails identically every time -
 * and on a card that is not a harmless ten seconds wasted: signtool asks for
 * the PIN on every attempt, and repeated attempts are how a card gets LOCKED.
 * A retry loop that cannot tell those apart is worse than no retry at all.
 *
 * Matched on signtool's own wording rather than its exit code, which is the
 * same whatever went wrong.
 */
function isTimestampFailure(output) {
  return /timestamp/i.test(output) && !/No certificates were found/i.test(output);
}

exports.default = async function sign(configuration) {
  const file = configuration.path;
  const how = selector();

  if (!how) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      console.log(
        '\n  [sign] POSNIC_SIGN_SHA1 / POSNIC_SIGN_SUBJECT not set - building UNSIGNED.\n' +
          '         Windows will show "Unknown publisher" on this installer.\n' +
          '         Run `npm run sign:cert` with the card inserted to get the thumbprint.\n'
      );
    }
    return true;
  }

  const signtool = findSignTool();
  if (!signtool) {
    throw new Error(
      'Signing was requested but signtool.exe was not found. Install the Windows SDK, ' +
        'or point POSNIC_SIGNTOOL at it.'
    );
  }

  /*
   * isNest is electron-builder asking for a SECOND signature on a file that
   * already has one (dual signing). It must append with /as; without it the
   * second call replaces the first and the file ends up with one signature
   * where two were intended.
   */
  const base = ['sign', '/fd', 'sha256', ...how, '/v'];
  if (configuration.isNest) base.push('/as');

  const args = [...base, '/tr', TIMESTAMP_URL, '/td', 'sha256', file];
  let last = null;

  for (let attempt = 1; attempt <= TIMESTAMP_ATTEMPTS; attempt += 1) {
    console.log(`  [sign] ${path.basename(file)}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
    last = signOnce(signtool, args);
    if (last.ok) return true;

    if (!isTimestampFailure(last.output)) {
      /* Stop immediately. Asking the card again cannot change this answer, and
         repeated PIN prompts are how a card ends up locked. */
      break;
    }
    if (attempt === TIMESTAMP_ATTEMPTS) break;
    console.log(`  [sign] timestamping failed, retrying in ${attempt}s ...`);
    await new Promise((resolve) => { setTimeout(resolve, attempt * 1000); });
  }

  const output = (last && last.output) || '';
  let hint = 'Check the card is inserted and proCertum CardManager has registered the certificate.';
  if (isTimestampFailure(output)) {
    hint = `The timestamp server (${TIMESTAMP_URL}) did not answer after ${TIMESTAMP_ATTEMPTS} tries. `
      + 'Rebuilding usually clears it - do NOT ship an untimestamped build instead.';
  } else if (/No certificates were found/i.test(output)) {
    hint = 'No certificate matched. Run `npm run sign:cert` to see what is in the store.';
  }
  throw new Error('Signing failed for ' + file + '. ' + hint);
};
