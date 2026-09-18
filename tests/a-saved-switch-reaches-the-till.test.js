'use strict';

/*
 * A SWITCH THAT WAS SAVED REACHES THE OTHER MACHINES.
 *
 * Owner: "restuaruent module is enabled and saved. its not sync with server
 * why ?"
 *
 * Because the row was invisible to sync. The gateway sends a device only the
 * rows whose `updated_date` has moved past what that device last saw:
 *
 *     { $expr: { $gt: ['$updated_date', '$_syncMeta.at'] } }
 *
 * Every branch settings write in setting.model.js is a NATIVE driver
 * updateOne, so the Mongoose `timestamps: { updatedAt: 'updated_date' }` hook
 * never runs and nothing stamps the row. The branch record changes, the
 * screen says Saved, and the change sits there for ever.
 *
 * THIS WAS FOUND ONCE ALREADY. #838 fixed exactly this for two of the four
 * branch writes in this file. The other two - the main settings save, which
 * carries `table_options`, and the module-toggle save, which carries
 * `module_captain_enable`, `module_online_ordering_enable` and the rest -
 * were missed in the same sweep. So the owner turned the restaurant module on
 * and the server never heard about it.
 *
 * Which is why this test SWEEPS every branch write in the file rather than
 * naming the two that were broken. A fifth one written next month has the
 * same fault available to it, and the whole point is that nothing about a
 * missing stamp is visible: no error, no failed save, no log line.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'api', 'src', 'models', 'setting.model.js'), 'utf8');
const NL = String.fromCharCode(10);
const LINES = SRC.split(NL);

/** Every line that writes to the branches collection. */
function branchWrites() {
  const out = [];
  LINES.forEach((line, i) => {
    const writesBranches =
      line.includes('branchCollection.updateOne') ||
      line.includes('branchCollection.updateMany') ||
      (line.includes("collection('branches')") && /update(One|Many)/.test(line));
    if (writesBranches) out.push({ line: i + 1, text: line.trim() });
  });
  return out;
}

test('there are branch settings writes to check at all', () => {
  /* If this file is refactored into another shape, the sweep below would pass
     by finding nothing. Say so instead. */
  assert.ok(branchWrites().length >= 2,
    'no branch writes found in setting.model.js; this test is reading nothing');
});

test('EVERY branch settings write stamps updated_date', () => {
  /*
   * Looked for in the lines just above each write, which is where the update
   * object is assembled. Both spellings are accepted because the file uses
   * two variable names for it: `updateData` in the older pair, `updateFields`
   * in the newer.
   */
  const missing = [];
  for (const w of branchWrites()) {
    const above = LINES.slice(Math.max(0, w.line - 28), w.line - 1).join(NL);
    if (!/update(Data|Fields)\.updated_date\s*=\s*new Date\(\)/.test(above)) {
      missing.push(w.line + ': ' + w.text);
    }
  }
  assert.deepStrictEqual(missing, [],
    'these change a branch without moving its sync watermark, so no till will '
      + 'ever see it:' + NL + '  ' + missing.join(NL + '  '));
});

test('the restaurant switch and the module toggles are among what is saved', () => {
  /*
   * Named so the sweep cannot be satisfied by a file that has stopped saving
   * the settings this is about. `table_options` is the restaurant module the
   * owner turned on; the module map carries the rest of the Features list.
   */
  assert.match(SRC, /table_options/, 'the restaurant switch is no longer saved here');
  assert.match(SRC, /moduleToggleMap/, 'the module toggles are no longer saved here');
});

test('the reason is written where the next person will look', () => {
  /*
   * A missing stamp has no symptom on the machine that saves: no error, no
   * failed write, nothing in a log. The only way anybody finds it is by being
   * told, so the note has to survive next to the code.
   */
  assert.match(SRC, /THE WATERMARK, OR THE TILL NEVER HEARS ABOUT IT/);
  assert.match(SRC, /timestamps/, 'the reason the hook does not run is not explained');
});
