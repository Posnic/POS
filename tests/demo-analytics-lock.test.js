'use strict';

/*
 * The public demo's Google Analytics id is not the visitor's to change.
 *
 * The demo's logins are printed on its own login page, so anyone can sign in
 * as admin, and settings are deliberately left explorable - poking at them is
 * the product tour. The measurement id is the exception: it points at the
 * owner's own Google property, and a visitor repointing it would send the
 * demo's traffic to a stranger, silently, until somebody noticed.
 *
 * PUT /settings-groups/:group carries no demoGuard (correctly - blocking every
 * settings write would gut the tour), so the refusal has to live at the key.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const repo = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'repositories', 'settings.repository.js'), 'utf8');

test('analytics keys are refused while DEMO_MODE is on', () => {
  assert.match(repo, /DEMO_LOCKED/, 'nothing marks the analytics keys as demo-locked');
  for (const key of ['analytics_enable', 'analytics_ga_id']) {
    assert.ok(repo.includes(`'${key}'`), `${key} is not in the locked set`);
  }
  assert.match(repo, /isDemoMode\(\)/, 'the lock does not consult DEMO_MODE');
});

test('the refusal happens before the value is accepted', () => {
  const lockAt = repo.indexOf('DEMO_LOCKED.has(key)');
  const acceptAt = repo.indexOf('accepted[key] = coerceFeatureToggle');
  assert.ok(lockAt > 0, 'the locked-key check is gone');
  assert.ok(lockAt < acceptAt, 'the key is accepted before the demo check runs');
});

test('a normal installation is unaffected', () => {
  /* The guard must read DEMO_MODE at call time, not gate on anything a real
     shop would trip: every till and tenant runs this same file. */
  assert.match(repo, /demoLocked && DEMO_LOCKED\.has\(key\)/,
    'the lock is not conditional on demo mode, so real shops would be blocked too');
});
