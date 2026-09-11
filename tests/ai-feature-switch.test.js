'use strict';

/*
 * The AI switch, end to end, because a switch has four places to die.
 *
 * The owner opened the Features list looking for AI and it was not there. The
 * page had been built, the button had been built, and the one control a
 * shopkeeper actually looks for had not - so the feature was invisible and
 * unreachable, which is the same as absent.
 *
 * Putting the card back is not enough on its own. A feature switch in this
 * codebase has to exist in four places at once, and missing any one of them
 * produces a control that looks right and does nothing:
 *
 *   1. a card in the Features list, so somebody can find it
 *   2. the id in _moduleToggleIds, or the save never reads the checkbox
 *   3. the key in the server's TOGGLES allowlist, or the save is dropped
 *   4. the key in the FEATURES settings group, or nothing can read it back
 *
 * The third is the quiet one: the endpoint accepts the request, answers
 * success, and discards the key. That is a switch that flips in the browser,
 * says "Features saved", and means nothing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');
const settingsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
const settingModel = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'models', 'setting.model.js'), 'utf8');
const groups = require(path.join(ROOT, 'api', 'src', 'services', 'settings-groups'));
const sidebar = fs.readFileSync(path.join(ROOT, 'frontend', 'layouts', 'sidebar.html'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');

test('a shopkeeper can find AI in the Features list', () => {
  /* Where somebody scanning "what does this product do" will look. */
  assert.match(html, /id="ai_enabled"/, 'the AI switch is gone from the Features list');
  assert.match(html, /lang_module_ai/, 'the AI card has no title');
});

test('the switch is read when Features are saved', () => {
  /*
   * saveModulesTab builds its payload from _moduleToggleIds. A checkbox that
   * is not in that list is never looked at, so the switch moves and the save
   * carries nothing.
   */
  assert.match(settingsJs, /'ai_enabled'/,
    'ai_enabled is not in _moduleToggleIds, so the checkbox is never read');
});

test('the server does not discard the switch', () => {
  /*
   * The quiet failure. updateCommonSettings writes only keys in its TOGGLES
   * map; anything else is accepted, answered with success, and dropped. A
   * switch that reports "Features saved" and changes nothing is worse than
   * one that errors.
   */
  assert.match(settingModel, /ai_enabled:\s*offOnly/,
    'ai_enabled is not in the server TOGGLES allowlist, so saving it is a no-op');
});

test('a shop that never touched the switch is not switched off by our silence', () => {
  /*
   * offOnly, like every other module here: absent means on. onOnly would mean
   * a shop that has never opened the Features page has AI off and no way to
   * know why, and the code that reads it would have to guess which kind of
   * absent it was looking at.
   */
  const line = settingModel.match(/ai_enabled:\s*(\w+)/);
  assert.ok(line, 'the AI toggle is gone');
  assert.strictEqual(line[1], 'offOnly',
    'the AI switch now defaults off, which silently disables it for every existing shop');
});

test('the key can be read back from the group that owns it', () => {
  assert.strictEqual(groups.groupOf('ai_enabled'), 'features',
    'ai_enabled left the FEATURES group, so nothing can resolve it');
});

test('the switch carries nothing but a switch', () => {
  /*
   * AGENTS.md: a Features card is a switch and a description, never a
   * setting. The provider, the key and the spending limit belong on the AI
   * page, and this test is here because putting them in the card is exactly
   * the shortcut somebody takes when the page feels like too much work.
   */
  const card = html.match(/<div class="module-card">(?:(?!<\/div>\s*<div class="module-card">)[\s\S])*?id="ai_enabled"[\s\S]*?<\/p>/);
  assert.ok(card, 'the AI card could not be isolated');
  assert.ok(!/<select|<input(?![^>]*type="checkbox")|<button/.test(card[0]),
    'the AI Features card has grown a control; settings belong on the AI page');
});

test('the settings themselves live on their own page', () => {
  /* The other half of the same rule: the page must exist, or the switch has
     nowhere to send anybody. */
  assert.match(html, /id="v-pills-ai"/, 'the AI settings page is gone');
  assert.match(html, /id="ai_provider"/, 'the provider control is gone from the AI page');
  assert.match(html, /id="ai_api_key"/, 'the key field is gone from the AI page');
});

test('the switch is in the payload the save actually sends', () => {
  /*
   * The bug the owner hit. _moduleToggleIds is only used by the REMOTE-branch
   * path; saving your own branch goes through updateCommonSetting, which
   * builds its body key by key by hand. The captured request had no
   * ai_enabled in it at all, so the checkbox moved, the server never heard,
   * and a refresh showed the truth.
   */
  assert.match(settingsJs, /ai_enabled:\s*\$\('#ai_enabled'\)\.is\(':checked'\)/,
    'ai_enabled is not in the payload updateCommonSetting sends');
});

test('the switch is read back when the page loads', () => {
  /*
   * Without this the box renders off while the truth is on - and because the
   * save sends whatever the box says, the first Save writes that lie back as
   * fact. A missing load line does not just misreport, it corrupts.
   */
  assert.match(settingsJs, /\$\('#ai_enabled'\)\.prop\('checked', data\.ai_enabled !== false\)/,
    'nothing sets the AI checkbox from saved settings');
});

test('the sidebar has a way in, gated on the switch', () => {
  /* Every feature with a page has a row in Manage. Without one the page is
     reachable only by scrolling the settings rail and hoping. */
  assert.match(sidebar, /id="manage_li_ai"/, 'the AI row is gone from the sidebar');
  assert.match(sidebar, /href="#\/settings\/ai"/, 'the AI row points nowhere');
  assert.match(core, /\$\('#manage_li_ai'\)\.toggle\(on\('ai_enabled'\)\)/,
    'the AI sidebar row is not gated on the switch');
});

test('following that row loads the page rather than opening it empty', () => {
  /*
   * The pane's loader hangs off shown.bs.tab, and a deep link activates the
   * pane directly without firing it. An empty card reads as broken, not as
   * unconfigured.
   */
  assert.match(settingsJs, /if \(key === 'ai'\) \{ PosnicPro\.settings\.ai\.load\(\); \}/,
    'a deep link to the AI page opens it without loading it');
});
