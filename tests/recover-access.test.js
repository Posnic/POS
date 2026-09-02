'use strict';

/*
 * The way back in when nothing else works.
 *
 * A self-hosted shop, or a till on a network with no way out, cannot use the
 * console, cannot receive our reset email and cannot phone support at 6am. Its
 * only remedy was a database edit by somebody who knew that this application
 * hashes bcrypt over BASE64 of the password rather than over the password.
 *
 * That detail is the whole risk. Get it wrong and sign-in appears to work,
 * because the login falls back to comparing a plain hash - while manager
 * approvals, which only ever compare the base64 form, silently stop accepting
 * the password. The shop discovers it weeks later as "approvals are broken",
 * with nothing connecting the two events.
 *
 * So the format is asserted here, along with the two things that make this
 * defensible rather than a back door: it can only open the database this
 * installation already uses, and every use is written to the shop's own log.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'recover-access.js');
const src = fs.readFileSync(SCRIPT, 'utf8');

test('the password is hashed base64-first, the way login checks it', () => {
  assert.match(src, /Buffer\.from\(passwordArg\)\.toString\('base64'\)/,
    'the password is not base64 encoded before hashing - approvals will reject it');
  assert.match(src, /bcrypt\.hashSync\(encoded, 12\)/,
    'the hash is not taken over the encoded form');

  /* And never over the raw password, which is the mistake being guarded
     against: it would sign in fine and break approvals. */
  assert.ok(!/hashSync\(passwordArg/.test(src),
    'the raw password is hashed somewhere - that is the failure this exists to prevent');
});

test('it proves the new password before saying it worked', () => {
  /*
   * A recovery tool that reports success without checking is worse than none:
   * the person walks away and the shop is still locked out.
   */
  assert.match(src, /bcrypt\.compareSync\(encoded, after\.password\)/,
    'the result is never verified against what was stored');
  assert.match(src, /did not verify/,
    'a failed verification is not reported to the person running it');
});

test('every use is written to the shop own audit log', () => {
  assert.match(src, /collection\('audit_log'\)\.insertOne/, 'no audit entry is written');
  assert.match(src, /source: 'local_recovery'/, 'the entry does not say how it happened');
  assert.match(src, /os\.userInfo\(\)\.username/,
    'the entry does not record which operating-system account did it');

  /* The password must not be in the log. An audit trail is read by more people
     than the thing it audits. */
  const entry = /collection\('audit_log'\)\.insertOne\(\{[\s\S]*?\}\)/.exec(src);
  assert.ok(entry, 'the audit call was not found');
  assert.ok(!/passwordArg|hash|encoded/.test(entry[0]),
    'the audit entry carries the password or its hash');
});

test('it can only open the database this installation already uses', () => {
  /*
   * No --uri flag, no environment override. A recovery tool that can be
   * pointed elsewhere is one that can quietly repair the wrong shop, and it
   * would also turn a local utility into a remote one.
   */
  assert.match(src, /path\.join\(ROOT, 'api', '\.env'\)/,
    'the connection string does not come from this installation');
  assert.match(src, /const uri = env\.MONGODB_URI;/,
    'the connection string does not come from the installation env file');

  /* Only two positional arguments are read, and neither is a database. A
     loose "does argv appear near uri" check passed by accident here - argv is
     read three lines above where the env is opened - so this names the flags
     instead. */
  assert.match(src, /const \[emailArg, passwordArg\] = process\.argv\.slice\(2\);/,
    'the argument list is not the expected two positional values');
  for (const flag of ['--uri', '--db', '--database', '--host']) {
    assert.ok(!src.includes(flag), `${flag} can point this at another database`);
  }
});

test('a short password is refused', () => {
  assert.match(src, /passwordArg\.length < 8/,
    'any password is accepted, including one somebody will write on the till');
});

test('listing users shows when each password last changed', () => {
  /*
   * The field that answers "it worked yesterday". Establishing it during a
   * real lockout took an ssh session and a bcrypt comparison run by hand.
   */
  assert.match(src, /password never changed/,
    'the listing does not distinguish a password that has never been changed');
});

test('it is reachable as a documented command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.recover, 'node scripts/recover-access.js',
    'npm run recover does not exist, so this is a secret technique again');

  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'SELF_HOSTING.md'), 'utf8');
  assert.match(doc, /recover-access|npm run recover/,
    'the self-hosting guide does not mention how to get back in');
});
