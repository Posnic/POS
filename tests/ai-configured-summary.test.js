'use strict';

/*
 * Once a key is saved, the AI setup folds to one line.
 *
 * With a key on file, the provider, the key, the how-to and the limit are
 * answered questions. The page kept asking them on every visit, with the
 * key row alone knowing it was done. Owner: "when key save whole section of
 * form needs to be shrink. if user want remove or edit. not only near to the
 * field."
 *
 * So the setup becomes one line, what answers and the limit, with Edit and
 * Remove. Edit unfolds the form as it was. Remove is the same removal as the
 * key row's, asked first. Save stays, because the customer assistant switch
 * below shares it. This pins the fold, what it hides, what it leaves, and
 * that a visit never starts mid-edit.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');

const pane = HTML.slice(HTML.indexOf('id="v-pills-ai"'), HTML.indexOf('class="tab-pane fade"', HTML.indexOf('id="v-pills-ai"')));
const ai = JS.slice(JS.indexOf('PosnicPro.settings.ai = {'));
const sync = ai.slice(ai.indexOf('    syncRows: function () {'), ai.indexOf('    load: function () {'));

test('the set-up line exists, above the form, with Edit and Remove', () => {
  for (const id of ['ai_configured', 'ai_configured_provider', 'ai_configured_cap', 'ai_edit', 'ai_remove_all', 'ai_provider_row']) {
    assert.ok(pane.includes(`id="${id}"`), `#${id} is missing from the AI page`);
  }
  assert.ok(pane.indexOf('id="ai_configured"') < pane.indexOf('id="ai_provider_row"'),
    'the set-up line is not above the form it replaces');
});

test('with a key saved and nobody editing, the form folds and the line shows', () => {
  assert.match(sync, /var configured = on && saved && PosnicPro\.settings\.ai\._editing !== true;/);
  assert.match(sync, /\$\('#ai_configured'\)\.toggle\(configured\);/);
  assert.match(sync, /\$\('#ai_provider_row,#ai_key_row,#ai_howto_toggle_row,#ai_key_help,#ai_cap_row'\)\.hide\(\);/,
    'the fold does not hide the whole setup');
  /* decided last, so it wins over every toggle above it */
  assert.ok(sync.indexOf("$('#ai_configured').toggle(configured);") > sync.indexOf("$('#ai_spend_row').toggle("),
    'the fold is decided before the toggles it has to override');
});

test('Save stays visible when folded, because the assistant switch shares it', () => {
  const fold = sync.slice(sync.indexOf('var configured ='));
  assert.ok(!/#ai_save/.test(fold), 'the fold hides Save, and the assistant switch below cannot be saved');
  assert.ok(!/#ai_assistant_row/.test(fold), 'the fold hides the customer assistant switch, which is a separate decision');
});

test('the line says what answers and the limit, from the form itself', () => {
  assert.match(sync, /\$\('#ai_configured_provider'\)\.text\(\s*\$\('#ai_provider option:selected'\)\.text\(\)/,
    'the provider on the line is not the one selected');
  assert.match(sync, /\$\('#ai_configured_cap'\)\.text\(cap \|\| PosnicPro\.i18n\.t\('lang_ai_no_limit'/,
    'an empty limit is not said in words');
});

test('Edit unfolds, Remove asks and removes, and a visit never starts mid-edit', () => {
  assert.match(JS, /on\('click', '#ai_edit', function \(\) \{\s*PosnicPro\.settings\.ai\._editing = true;\s*PosnicPro\.settings\.ai\.syncRows\(\);/);
  assert.match(JS, /on\('click', '#ai_remove_all', function \(\) \{[\s\S]*?PosnicPro\.settings\.ai\.removeKey\(\);/,
    'the line has its own removal instead of the one that asks first');
  assert.match(ai, /_replacing = false;\n\s*PosnicPro\.settings\.ai\._editing = false;/,
    'a visit can start with the form unfolded from a previous edit');
});
