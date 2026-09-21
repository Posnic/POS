'use strict';

/*
 * A SHOP CAN REACH ITS HANDSETS.
 *
 * The register and its three endpoints landed first, and for a few hours the
 * shop had a way to stop a phone that nothing could reach. That is the shape
 * of the kitchen announcement, which shipped complete and switched off for its
 * whole life because the only way to turn it on was a developer console.
 *
 * So the screen is pinned here: a place to open, a list to read, and the two
 * buttons that do the thing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const PANE = read('frontend', 'modules', 'settings_write.html');
const SIDEBAR = read('frontend', 'layouts', 'sidebar.html');
const SCRIPT = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'handsets.js');
const SETTINGS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');

test('THERE IS A DOOR, and it is in the Manage menu', () => {
  assert.match(SIDEBAR, /id="manage_sec_devices"/, 'nothing in the menu opens it');
  assert.match(SIDEBAR, /href="#\/settings\/devices"/);
});

test('and the pane that address opens exists', () => {
  /*
   * The section switch falls back to Core Settings for a key it cannot find,
   * so a menu entry without a pane is a link that silently goes somewhere
   * else - which is worse than no link at all.
   */
  assert.match(PANE, /id="v-pills-devices"/);
  assert.match(PANE, /id="handsets_body"/, 'the table has no body to fill');
});

test('OPENING IT FETCHES THE LIST', () => {
  /* Every time: a phone that signed in a minute ago belongs on it. */
  assert.match(SETTINGS, /key === 'devices' && PosnicPro\.handsets/);
  assert.match(SETTINGS, /if \(key === 'handsets'\) key = 'devices'/, 'legacy device links must still resolve');
  assert.match(SETTINGS, /PosnicPro\.handsets\.load\(\)/);
});

test('the module is in the bundle the dashboard loads', () => {
  /* A file nothing loads is a screen that draws nothing, with no error. */
  const map = read('frontend', 'pages_css_js_map.json');
  assert.match(map, /modules\/js\/handsets\.js/);
});

test('THE TWO BUTTONS REACH THE TWO ENDPOINTS', () => {
  assert.match(SCRIPT, /handsets\/' \+ encodeURIComponent\(id\) \+ '\/revoke/);
  assert.match(SCRIPT, /handsets\/' \+ encodeURIComponent\(id\) \+ '\/allow/);
});

test('stopping one is asked about, and the question says what happens next', () => {
  /*
   * It takes a waiter's phone out of service mid-shift and the person doing it
   * is in a hurry. "Are you sure" answers nothing; what they need to know is
   * that it is not permanent.
   */
  const at = SCRIPT.indexOf('stop: function (id)');
  assert.ok(at > -1, 'nothing stops a phone');

  const body = SCRIPT.slice(at, at + 900);
  assert.match(body, /swal\(/, 'a phone is stopped with no confirmation');
  assert.match(body, /lang_stop_device_access_help/);
  assert.match(body, /authorized credentials/i, 'the question does not say how to undo it');
  assert.match(body, /reconnects.*Offline authorization.*expires/, 'offline revocation must not promise an immediate remote stop');
});

test('and letting one back is not', () => {
  /* Nothing is lost by allowing a phone, and the person doing it has already
     decided. A dialog there is a tax on the fix. */
  const at = SCRIPT.indexOf('allow: function (id)');
  assert.ok(at > -1);
  assert.doesNotMatch(SCRIPT.slice(at, at + 500), /swal\(/);
});

test('WHAT THE SERVER SAYS IS ESCAPED, what this file says is not', () => {
  /*
   * A device model, a user name and an id all come from a phone. They are
   * escaped. The fixed sentences are <lang> markup so the walker can translate
   * them in place, which is the house pattern and the only one the coverage
   * tool can see.
   */
  assert.match(SCRIPT, /esc\(row\.user_name \|\| ''\)/);
  assert.match(SCRIPT, /esc\(row\.model\)/);
  assert.match(SCRIPT, /<lang class="lang_no_handset_has_signed_in_yet">/);
});

test('every word on it can be translated', () => {
  /*
   * A string built by concatenation inside a <lang> element reaches
   * _english.json with the concatenation in it, which is a key no translator
   * can answer. This caught exactly that.
   */
  const english = JSON.parse(read('languages', '_english.json'));
  const keys = [
    'lang_devices',
    'lang_manage_paired_mobile_pos_and_captain_phone',
    'lang_handset_phone',
    'lang_handset_status',
    'lang_used_by',
    'lang_authorized',
    'lang_let_it_back',
    'lang_stop_this_phone',
    'lang_stop_device_access_help',
    'lang_no_handset_has_signed_in_yet',
  ];

  const missing = keys.filter((key) => !english[key]);
  assert.deepEqual(missing, [], 'keys the UI uses that English does not carry');

  const broken = keys.filter((key) => /' \+ '/.test(english[key]));
  assert.deepEqual(broken, [], 'keys whose English carries a JavaScript join');
});
