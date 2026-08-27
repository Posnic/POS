'use strict';

/*
 * The public demo's collar holds (DEMO_SHOP_PLAN §4).
 *
 * DEMO_MODE ships in every build, inert without the env flag. These pins
 * hold the load-bearing pieces: every outbound channel checks the flag,
 * the password/user doors carry the guard, runtime-info exposes the flag
 * the pages render from, and the demo face rides both bundles.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('every outbound channel checks the demo flag', () => {
  assert.match(read('api/src/utils/email.js'), /demo-mode.*isDemoMode/s);
  const sms = read('api/src/services/sms.service.js');
  assert.ok((sms.match(/isDemoMode\(\)/g) || []).length >= 4, 'an SMS sender lost its guard');
  assert.match(read('api/src/services/whatsapp.service.js'), /isDemoMode\(\)/);
});

test('the password and user doors carry the guard', () => {
  const settings = read('api/src/routes/settings.routes.js');
  assert.ok((settings.match(/demoGuard/g) || []).length >= 3, 'settings password doors unguarded');
  const users = read('api/src/routes/users.routes.js');
  assert.ok((users.match(/demoGuard/g) || []).length >= 6, 'user mutation doors unguarded');
});

test('runtime-info exposes the flag and the face rides both bundles', () => {
  assert.ok((read('api/app.js').match(/info\.demo = /g) || []).length >= 2);
  const map = JSON.parse(read('frontend/pages_css_js_map.json'));
  for (const page of ['dashboard', 'login']) {
    assert.ok(map[page].js.includes('static/script/js/core/demo-mode.js'), page + ' lost the demo face');
  }
});

test('the refusal says it is the demo, in words', () => {
  assert.match(read('api/src/config/demo-mode.js'), /resets on the hour/);
});

test('the desktop-app pitch is an inline card below the form, never a wall', () => {
  /* Owner's ruling: the old appNudge modal covered the whole viewport - on
     the demo it sat ON TOP of the Enter-as buttons (caught by the external
     smoke, not by review). Now it must be a card inserted after login_form,
     and nothing in its block may take over the screen. */
  const login = read('frontend/login.html');
  const start = login.indexOf('posnic_app_card');
  assert.ok(start !== -1, 'the inline app card vanished from login.html');
  const block = login.slice(login.lastIndexOf('<script>', start), login.indexOf('</script>', start));
  assert.match(block, /insertAdjacentElement\('afterend'/);
  assert.ok(!/position:fixed|inset:0/.test(block), 'the app pitch blocks the view again');
  assert.ok(!login.includes('appNudge'), 'the old blocking appNudge modal is back');
  /* owner: every WEB login carries it; the desktop shell alone skips it */
  assert.match(block, /Electron.*return/);
  assert.ok(!/posnic\.io.*\.test\(location\.hostname\)/.test(block), 'the card is hostname-gated again - it belongs on every web login');
});

test('the signup nudge fires once per browser and sells the no-commitment path', () => {
  const face = read('frontend/static/script/js/core/demo-mode.js');
  /* once EVER: the done-flag is written before the modal is built, so no
     code path can show it twice */
  assert.match(face, /posnic_demo_nudge_done/);
  assert.match(face, /no commitment/i);
  assert.match(face, /Community Edition/);
});
