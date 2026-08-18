/*
 * Module On/Off persistence drift guard.
 *
 * The Modules tab saves through setting.model updateCommonSettings - which
 * silently DROPPED every workforce/till/module toggle key, so "switch
 * everything off, refresh, everything is back on" shipped to the field:
 * nothing was written, and the default-ON read refilled the gaps.
 *
 * This pins the seam the bug lived in: every toggle key the frontend's
 * updateCommonSetting payload sends must appear in the api model function
 * that persists that payload. A key added client-side without its server
 * write fails here, in CI, instead of in a shop.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const API_MODEL = path.join(__dirname, '..', 'api', 'src', 'models', 'setting.model.js');

const TOGGLE_RE = /(module_[a-z_]+_enable|staff_[a-z]+_enable|cash_register_enable|till_lock_enable|till_lock_idle_minutes)/g;

function fnBody(source, name) {
  const start = source.indexOf(`async ${name}(`);
  assert.ok(start >= 0, `${name} not found in setting.model.js`);
  // Good enough for a guard: the function runs until the next `async ` at
  // the same nesting depth; scan braces.
  let depth = 0;
  // The body's opening brace is the one after the signature's ') {' - a
  // default parameter like (data = {}) plants an earlier, wrong '{'.
  let i = source.indexOf(') {', start) + 2;
  assert.ok(i > start, `${name} body not found`);
  const open = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) break;
  }
  return source.slice(open, i);
}

test('every toggle the client payload sends is persisted by updateCommonSettings', () => {
  const client = fs.readFileSync(FRONTEND, 'utf8');
  const model = fs.readFileSync(API_MODEL, 'utf8');

  // The client payload block: between the updateCommonSetting url line and
  // the request send. Collect every toggle key mentioned there.
  const payloadStart = client.indexOf("'setting/updateCommonSettings'");
  assert.ok(payloadStart >= 0, 'client updateCommonSetting payload not found');
  const payload = client.slice(payloadStart, client.indexOf('PosnicPro.put', payloadStart));
  const sent = [...new Set(payload.match(TOGGLE_RE) || [])];
  assert.ok(sent.length >= 10, `expected the payload to carry the toggle keys, found ${sent.length}`);

  const body = fnBody(model, 'updateCommonSettings');
  const missing = sent.filter((key) => !body.includes(key));
  assert.deepStrictEqual(
    missing,
    [],
    `updateCommonSettings drops toggle key(s) the client sends: ${missing.join(', ')} - ` +
      'saving would silently reset them to defaults on the next read'
  );
});
