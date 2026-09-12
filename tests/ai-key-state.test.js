'use strict';

/*
 * A saved AI key and no AI key must not look the same.
 *
 * The key is never sent back to a browser, so the page cannot show it. Before
 * this, it showed nothing at all: the same empty box on every visit, with a
 * placeholder as the only tell. Owner: "if AI already have value then show
 * some indication... just showing same form everytime how user will know?"
 *
 * Now a saved key is a badge, a Replace and a Remove, and the empty box only
 * appears when somebody asks to replace it. Remove has to say a word, because
 * an empty value means "leave the saved credential alone" (see
 * settings-groups.js CLEAR_SECRET) - which is right for every other save on
 * this page and would make removal impossible without it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8');
const groups = require(path.join(ROOT, 'api', 'src', 'services', 'settings-groups'));

const pane = HTML.slice(HTML.indexOf('id="v-pills-ai"'), HTML.indexOf('class="tab-pane fade"', HTML.indexOf('id="v-pills-ai"')));
const ai = JS.slice(JS.indexOf('PosnicPro.settings.ai = {'));

test('a saved key is shown as a state, not as an empty box', () => {
  for (const id of ['ai_key_status', 'ai_key_replace', 'ai_key_remove', 'ai_key_cancel']) {
    assert.ok(pane.includes(`id="${id}"`), `#${id} is missing from the AI page`);
  }
  /* the status sits with the key, inside its row, above the box */
  const row = pane.slice(pane.indexOf('id="ai_key_row"'), pane.indexOf('id="ai_howto_toggle_row"'));
  assert.ok(row.indexOf('id="ai_key_status"') < row.indexOf('id="ai_api_key"'),
    'the saved-key state is not above the key box');
});

test('the box hides while a key is saved, unless somebody asked to replace it', () => {
  assert.match(ai, /\$\('#ai_key_status'\)\.toggle\(on && saved && !replacing\)/);
  assert.match(ai, /\$\('#ai_api_key'\)\.toggle\(on && \(!saved \|\| replacing\)\)/);
  assert.match(ai, /\$\('#ai_key_cancel'\)\.toggle\(on && saved && replacing\)/);
  /* a visit starts from the saved state, never from a half-finished replace */
  assert.match(ai, /_howtoOpen = false;\n\s*PosnicPro\.settings\.ai\._replacing = false;/);
});

test('remove says the word the API listens for, and only that word', () => {
  /* The frontend constant and the service constant are the same string, so a
     change on one side fails here rather than silently doing nothing. */
  const m = ai.match(/CLEAR_SECRET: '([^']+)'/);
  assert.ok(m, 'the frontend has no clear sentinel');
  assert.strictEqual(m[1], groups.CLEAR_SECRET, 'frontend and API disagree on the clear sentinel');
  assert.match(ai, /url: 'settings\/group\/secrets',\s*data: JSON\.stringify\(\{ ai_api_key: PosnicPro\.settings\.ai\.CLEAR_SECRET \}\)/);
  /* and it is never sent by the ordinary save path */
  const save = ai.slice(ai.indexOf('    save: function () {'));
  assert.ok(!save.includes('CLEAR_SECRET'), 'the ordinary save can clear the key');
});

test('remove asks first, and clears what the item screen remembered', () => {
  const remove = ai.slice(ai.indexOf('removeKey: function () {'), ai.indexOf('    save: function () {'));
  assert.match(remove, /swal\(\{/, 'the key can be removed without a question');
  assert.match(remove, /showCancelButton: true/);
  assert.match(remove, /PosnicPro\.items\._aiAvailable = null/, 'the item screen would keep showing the AI button after the key is gone');
  assert.match(remove, /_keySaved = false/);
});

test('the three actions are wired', () => {
  assert.match(JS, /on\('click', '#ai_key_replace'/);
  assert.match(JS, /on\('click', '#ai_key_cancel'/);
  assert.match(JS, /on\('click', '#ai_key_remove'/);
  assert.match(JS, /PosnicPro\.settings\.ai\.removeKey\(\)/);
});

test('the state is painted from theme tokens', () => {
  assert.match(CSS, /#v-pills-ai \.ai-key-status \{/);
  assert.match(CSS, /var\(--theme-success-color/);
});
