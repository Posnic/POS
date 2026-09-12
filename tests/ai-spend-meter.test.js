'use strict';

/*
 * The AI meter: what the month has cost, in the shop's own currency, with
 * live voice counted by the minute and the limit shown as a bar.
 *
 * Owner, on the release review that found live voice was not metered: "fix
 * it. better to meter and show the customer. otherwise he might be over
 * charged approximate bill value also based on current currency is better."
 *
 * The server side has its own tests (api/tests/unit/services/voice-meter,
 * ai-budget). This pins the two ends the shopkeeper meets: the settings
 * screen that shows the meter, and the ordering page that keeps it wound.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const HTML = read('frontend', 'modules', 'settings_write.html');
const JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const CSS = read('frontend', 'static', 'style', 'css', 'custom.css');
const VOICE = read('order', 'assets', 'assistant', 'voice.js');
const METER = read('api', 'src', 'services', 'voice-meter.js');
const BUDGET = read('api', 'src', 'services', 'ai-budget.js');
const SPEND = read('api', 'src', 'controllers', 'items.controller.js');
const DECISIONS = JSON.parse(read('api', 'src', 'sync', 'collections.json'));

const pane = HTML.slice(HTML.indexOf('id="v-pills-ai"'), HTML.indexOf('id="v-pills-recyclebin"'));
/*
 * The AI object's loadSpend, and only it.
 *
 * The end is searched from the start of the block, not from the top of the
 * file: the Captain App's voice card has a removeKey of its own that sits
 * hundreds of lines earlier, and an end before the start gives an empty
 * slice - which matches no regex and fails every assertion below while
 * explaining none of them.
 */
const loadSpendAt = JS.indexOf('    loadSpend: function () {');
const loadSpendEnd = JS.indexOf('    removeKey: function () {', loadSpendAt);
assert.ok(loadSpendAt > -1, 'settings.js no longer has an AI loadSpend');
assert.ok(loadSpendEnd > loadSpendAt, 'the AI loadSpend has no end after it');
const loadSpend = JS.slice(loadSpendAt, loadSpendEnd);

test('the screen has a meter: a table, a total, a bar against the limit, and the note that it is approximate', () => {
  for (const id of ['ai_spend_row', 'ai_spend_table', 'ai_spend_total', 'ai_spend_meter', 'ai_spend_meter_bar', 'ai_spend_meter_text']) {
    assert.ok(pane.includes(`id="${id}"`), `#${id} is missing from the AI page`);
  }
  assert.ok(pane.includes('lang_ai_spent_approx'), 'the meter does not say it is approximate');
  assert.match(pane, /lang_ai_spent_note">[^<]*provider's dashboard is the final word/, 'the note no longer points to the bill that counts');
  assert.match(pane, /lang_ai_spent_note">[^<]*by the minute of open line/, 'the note does not say how live voice is counted');
});

test('the meter is drawn from the answer: the shop currency, a label per feature, minutes for voice, the limit as a bar', () => {
  assert.match(loadSpend, /PosnicPro\.settings\.ai\.currencySymbol\(data\)/, 'the figures are not in the currency the server named');
  assert.match(JS, /currencySymbol: function \(data\) \{[\s\S]*?data\.currency\.symbol[\s\S]*?PosnicPro\.local\.get\('currencySign'\)/, 'the currency does not come from the server first and the till second');
  assert.match(loadSpend, /<table class="ai-spend">/, 'the meter is not a table');
  assert.match(loadSpend, /PosnicPro\.settings\.ai\.featureLabel\(row\.feature\)/, 'feature keys are shown raw');
  for (const feature of ['item_description', 'ordering_assistant', 'voice_order_live', 'voice_order']) {
    assert.match(JS, new RegExp(`${feature}: PosnicPro\\.i18n\\.t\\('lang_ai_feature_${feature}'`), `${feature} has no name a shopkeeper reads`);
  }
  assert.match(loadSpend, /row\.seconds > 0 \? \(row\.seconds \/ 60\)\.toFixed\(1\) : ''/, 'seconds of voice are not shown as minutes');
  assert.match(loadSpend, /\$\('#ai_spend_total'\)\.text\(sym \+ ' ' \+ \(data\.total \|\| '0\.00'\)\)/);
  assert.match(loadSpend, /Math\.min\(100, Math\.round\(\(total \/ cap\) \* 100\)\)/, 'the bar is not the share of the limit');
  assert.match(loadSpend, /toggleClass\('is-near', pct >= 80\)/, 'the bar does not warn as the limit nears');
  assert.match(loadSpend, /lang_ai_spend_no_cap/, 'a shop with no limit is told nothing');
});

test('the folded line and the live switch say the money: spent so far, and the price of a minute', () => {
  assert.ok(pane.includes('id="ai_configured_spent"'), 'the folded line does not say what was spent');
  assert.ok(pane.indexOf('id="ai_configured_spent_wrap"') > pane.indexOf('id="ai_configured_cap"'), 'spent is not beside the limit on the folded line');
  assert.match(loadSpend, /\$\('#ai_configured_spent'\)\.text\('\\u2248 ' \+ sym \+ ' ' \+ \(data\.total \|\| '0\.00'\)\)/);
  assert.ok(pane.includes('id="ai_live_voice_rate"'), 'the live switch does not say its price');
  assert.ok(pane.indexOf('id="ai_live_voice_rate"') < pane.indexOf('lang_ai_live_voice_hint">'), 'the price comes after the long hint, where nobody reads it');
  assert.match(loadSpend, /data\.voice\.per_minute/, 'the price of a minute is not taken from the server');
  assert.match(loadSpend, /lang_ai_live_voice_rate', 'About \{amount\} for each minute of conversation, counted against the monthly limit while the call is on\.'/);
});

test('the meter is painted from theme variables, like the key badge above it', () => {
  const block = CSS.slice(CSS.indexOf('THE AI METER.'));
  assert.ok(block.length > 100, 'no meter styles');
  for (const rule of ['table.ai-spend', '.ai-spend-total', '.ai-spend-meter-bar', '.ai-spend-meter-bar.is-near']) {
    assert.ok(block.includes(rule), `${rule} is not styled`);
  }
  const bare = block.match(/(?<![-\w(,\s])color:\s*#[0-9a-f]{3,6}/gi) || [];
  assert.deepStrictEqual(bare, [], 'a colour spelled out by hand where a theme could want a say');
});

test('the spend endpoint answers with the currency, the limit, the price of a minute, and the calls and seconds per feature', () => {
  const fn = SPEND.slice(SPEND.indexOf('  async aiSpend(req, res) {'), SPEND.indexOf('module.exports = new ItemsController();'));
  assert.match(fn, /budget\.currencyOf\(context\)/, 'the currency is not read');
  assert.match(fn, /currency: \{ code: currency\.code, symbol: currency\.symbol \}/);
  assert.match(fn, /cap: settings\.cap \? Number\(settings\.cap\)\.toFixed\(2\) : null/);
  assert.match(fn, /per_minute: \(budget\.voiceMinuteMinor\(settings\.model, currency\.rate\) \/ 100\)\.toFixed\(2\)/);
  assert.match(fn, /approximate: true/);
  assert.match(fn, /calls: Number\(detail\.calls\) \|\| 0/);
  assert.match(fn, /seconds: Number\(detail\.seconds\) \|\| 0/);
});

test('the server clocks the line itself, prices it against the limit, and never counts a tick as a call', () => {
  assert.match(METER, /const delta = Math\.max\(0, Math\.min\(TICK_MAX_SECONDS, Math\.round\(since\)\)\);/, 'a page could stretch a call by ticking late');
  assert.match(METER, /\.\.\.budget\.voiceTokens\(delta\),\s*seconds: delta,\s*calls: 0/, 'a stretch of line is metered as a call of its own');
  assert.match(METER, /budget\.withinCap\(context, cap\)/, 'the limit is not checked while the line is open');
  assert.match(METER, /message: 'cap'/, 'past the limit the line is not told to close');
  assert.match(BUDGET, /'gpt-realtime': \{ in: 32, out: 64 \}/, 'the live model is not priced');
  assert.match(BUDGET, /const AUDIO_TOKENS_PER_SECOND = \{ in: 10, out: 8 \};/, 'a second of line has no price');
  assert.match(BUDGET, /USD_RATES\[parsed\.code\]/, 'the shop currency is not read from the branch');
});

test('the page keeps the meter wound, hangs up when told, and does not run on when the server is unreachable', () => {
  assert.match(VOICE, /startMeter\(branch, body\.data\);/, 'the clock does not start when the line opens');
  assert.match(VOICE, /live\.meter = setInterval\(function \(\) \{\s*tick\(false\);\s*\}, every\);/);
  assert.match(VOICE, /function stopLine\(\) \{\s*stopMeter\(true\);/, 'closing the line does not send the last report');
  assert.match(VOICE, /window\.addEventListener\("pagehide", function \(\) \{\s*stopMeter\(true\);/, 'a page that leaves does not report its last half minute');
  assert.match(VOICE, /navigator\.sendBeacon\(url \+ "\?end=1"\)/, 'the hang-up report cannot outlive the page');
  assert.match(VOICE, /response\.status === 403[\s\S]*?reached its limit for the month[\s\S]*?stop\(\);/, 'past the limit the customer is not told and the line not closed');
  assert.match(VOICE, /if \(live\.misses >= 3\) stop\(\);/, 'an unreachable meter leaves the line running unmetered');
  const dict = read('order', 'assets', 'i18n.js');
  assert.ok(dict.includes('"This shop\'s assistant has reached its limit for the month. You can still order the usual way."'), 'the customer\'s word has no Tamil');
});

test('the two collections behind the meter are classified, and stay local for a stated reason', () => {
  for (const name of ['ai_usage', 'ai_voice_sessions']) {
    assert.ok(typeof DECISIONS.local_only[name] === 'string' && DECISIONS.local_only[name].length >= 20, `${name} has no decision`);
  }
});
