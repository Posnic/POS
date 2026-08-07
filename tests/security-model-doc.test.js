/*
 * The security model is a promise, so it has to stay true.
 *
 * SECURITY.md now states plainly what Posnic protects and what it cannot: the
 * database is bound to loopback, credentials are per install, and anyone with
 * administrator rights or code running as the till's own user can reach the
 * data regardless. That last part is uncomfortable to write down and worth
 * writing down anyway - a business assessing this software deserves to know it
 * rather than discover it.
 *
 * These tests check the claims that are checkable. A promise nothing verifies
 * is a promise that drifts.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the database really is bound to loopback, as the policy claims', () => {
  /* SECURITY.md tells shops nothing on the LAN can reach MongoDB. If the bind
     address ever widens, that sentence becomes false and a shop would have no
     way to know. */
  const manager = read('mongodb-manager.js');
  assert.match(
    manager,
    /--bind_ip[\s'",]+127\.0\.0\.1|bind_ip.*127\.0\.0\.1/,
    'mongodb-manager.js no longer binds MongoDB to 127.0.0.1, but SECURITY.md ' +
      'still promises the database is unreachable from the network',
  );
  assert.ok(
    !/--bind_ip[\s'",]+0\.0\.0\.0/.test(manager),
    'MongoDB is bound to all interfaces',
  );
});

test('credentials are still generated per install, not shipped', () => {
  /* "No shared secret between shops" only holds while these are random at
     first run rather than constants in the source. */
  const main = read('main.js');
  assert.match(
    main,
    /crypto\.randomBytes\(\d+\)\.toString\('hex'\)/,
    'getLocalSecrets no longer generates random per-install secrets',
  );
});

test('the policy states the limits rather than implying protection', () => {
  const policy = read('SECURITY.md');

  /* The two things that defeat everything, named explicitly. */
  assert.match(
    policy,
    /administrator rights/i,
    'SECURITY.md no longer says administrator rights defeat these protections',
  );
  assert.match(
    policy,
    /malware running as the user|as the same Windows user|as the user the till runs as/i,
    'SECURITY.md no longer says code running as the till user can read the data',
  );

  /* And it must point somewhere actionable rather than leaving it there. */
  assert.match(
    policy,
    /USER_GUIDE\.md#keeping-your-till-secure/,
    'SECURITY.md no longer points shops at what they can actually do',
  );
});

test('the user guide gives the four steps, and warns about the recovery key', () => {
  const guide = read('docs/USER_GUIDE.md');

  assert.match(guide, /## Keeping your till secure/, 'the section has gone');

  for (const [claim, pattern] of [
    ['run as a standard, non-administrator account', /standard account, not an administrator/i],
    ['give the administrator account a password', /administrator account a real password/i],
    ['turn on device encryption', /device encryption/i],
    ['do not use the till for anything else', /not use the till for anything else/i],
  ]) {
    assert.match(guide, pattern, `the guide no longer tells shops to ${claim}`);
  }

  /* The one that can cost a shop its records if skipped. Device encryption
     without a saved recovery key turns a firmware update into data loss. */
  assert.match(
    guide,
    /Save the recovery key/i,
    'the guide recommends device encryption without warning about the recovery ' +
      'key. A firmware update can then lock a shop out of its own data ' +
      'permanently - that warning is the difference between a safety feature ' +
      'and a liability.',
  );
});

test('the guide is listed in its own contents', () => {
  const guide = read('docs/USER_GUIDE.md');
  assert.match(
    guide,
    /\[Keeping your till secure\]\(#keeping-your-till-secure\)/,
    'the section exists but nothing links to it',
  );
});
