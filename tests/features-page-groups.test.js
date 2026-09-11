'use strict';

/*
 * The Features page is grouped, and grouping lost nothing.
 *
 * Twenty-three switches sat in one flat grid. They now sit in seven groups,
 * each a heading and a grid. Two things can go wrong with that and this file
 * pins both.
 *
 * ONE: a card goes missing in the move. A switch that is not in the DOM is a
 * feature nobody can turn on, and a save that no longer sends it. Every
 * switch id is listed here by hand, so a card dropped on the floor fails by
 * name rather than by a count being one short.
 *
 * TWO: a group header grows a control. The switches-only guard
 * (features-list-is-switches.test.js) and the AI card guard both find cards
 * by the exact class="module-card" marker, and the AI guard's regex walks
 * from one card to the next. A button or input in a header would land inside
 * that walk and read as a control on a card. So headers stay markup only.
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

function featuresPane() {
  const start = HTML.indexOf('id="v-pills-modules"');
  assert.ok(start > -1, 'the Features pane is gone');
  const next = HTML.indexOf('class="tab-pane fade"', start);
  return HTML.slice(start, next > start ? next : HTML.length);
}

const PANE = featuresPane();

const SWITCHES = [
  'quick_sale_enable', 'cash_register_enable', 'quotes_enable', 'invoices_enable',
  'custom_charges_enable', 'hardware_weight_machine_enable',
  'module_tax_enable', 'module_credit_enable', 'module_cashbook_enable',
  'module_marketing_enable', 'module_messaging_enable',
  'table_options', 'module_captain_enable',
  'module_online_ordering_enable', 'module_kiosk_enable',
  'module_delivery_partners_enable', 'module_webshop_enable',
  'staff_shifts_enable', 'till_lock_enable',
  'module_themes_enable', 'ai_enabled', 'module_recyclebin_enable', 'module_demo_data_enable',
];

const groups = () => PANE.split('<section class="module-group"').slice(1);

test('every switch is still on the page, by name', () => {
  for (const id of SWITCHES) {
    assert.ok(PANE.includes(`id="${id}"`), `${id} left the Features page in the regroup`);
  }
  const cards = (PANE.match(/class="module-card"/g) || []).length;
  assert.equal(cards, SWITCHES.length, `${cards} cards for ${SWITCHES.length} switches`);
});

test('every card sits inside a group, and no group is empty', () => {
  const before = PANE.indexOf('<section class="module-group"');
  assert.ok(before > -1, 'there are no groups');
  assert.ok(!PANE.slice(0, before).includes('class="module-card"'),
    'a card sits above the first group');
  const afterLast = PANE.lastIndexOf('</section>');
  assert.ok(!PANE.slice(afterLast).includes('class="module-card"'),
    'a card sits below the last group');
  for (const g of groups()) {
    assert.ok(g.includes('class="module-card"'), 'a group has no cards in it');
    assert.match(g, /data-group="[a-z]+"/, 'a group has no name');
    assert.match(g, /--fg-accent:/, 'a group has no accent, so its cards have no colour');
  }
  assert.equal(groups().length, 7);
});

test('a group header is a heading, a line and a count, and never a control', () => {
  for (const g of groups()) {
    const head = g.slice(g.indexOf('<header'), g.indexOf('</header>'));
    assert.match(head, /class="fg-head-title"><lang class="lang_fg_[a-z]+">/, 'a header has no title');
    assert.match(head, /class="fg-head-sub"><lang class="lang_fg_[a-z]+_sub">/, 'a header has no line');
    assert.ok(head.includes('data-fg-count'), 'a header has no count');
    assert.ok(!/<input|<button|<select|<textarea/.test(head),
      'a group header carries a control; the AI card guard would walk into it');
  }
});

test('the AI card is not first in its group', () => {
  /*
   * The AI guard isolates its card with a regex that stops only where one
   * card directly follows another. A card that opens a group has a section
   * boundary before it rather than a card, and the regex would walk back
   * through the previous group. Keeping something in front of it keeps the
   * guard honest.
   */
  const g = groups().find((x) => x.includes('id="ai_enabled"'));
  assert.ok(g, 'the AI card is in no group');
  const firstCard = g.indexOf('class="module-card"');
  const ai = g.indexOf('id="ai_enabled"');
  assert.ok(g.indexOf('class="module-card"', firstCard + 1) < ai,
    'ai_enabled opens its group; put another card before it');
});

test('the list chrome survived the new toolbar', () => {
  for (const id of ['modules_search', 'features_take_tour', 'modules_branch_wrap',
    'modules_branch_select', 'modules_remote_note', 'fg_on_count', 'fg_total_count',
    'fg_meter_bar', 'fg_empty']) {
    assert.ok(PANE.includes(`id="${id}"`), `#${id} is missing from the Features toolbar`);
  }
  for (const f of ['all', 'on', 'off']) {
    assert.ok(PANE.includes(`data-fg-filter="${f}"`), `no ${f} chip`);
  }
  assert.ok(PANE.includes('oninput="PosnicPro.settings.filterModuleCards(this.value);"'),
    'the search box no longer filters');
});

test('search and the chips are reconciled in one place', () => {
  /* Either alone would leave a heading standing over an empty grid. */
  const filter = JS.slice(JS.indexOf('PosnicPro.settings.filterModuleCards = function'));
  assert.ok(filter.slice(0, 600).includes('PosnicPro.settings.applyModuleVisibility();'),
    'search no longer re-evaluates group visibility');
  assert.match(JS, /on\('click', '#v-pills-modules \.fg-chip'/, 'the chips do nothing');
  assert.match(JS, /toggleClass\('group-empty'/, 'an emptied group keeps its heading');
  assert.match(JS, /\$\('#fg_on_count'\)\.text\(on\)/, 'the headline count is never written');
  assert.match(JS, /\[data-fg-count\]/, 'the per-group counts are never written');
});

test('the classes the JS sets are the classes the CSS hides', () => {
  assert.match(CSS, /\.module-card\.filter-miss \{ display: none; \}/);
  assert.match(CSS, /\.module-group\.group-empty \{ display: none; \}/);
  assert.match(CSS, /\.module-card\.search-miss \{ display: none; \}/);
  /* colour comes from the section, so a moved card recolours itself */
  assert.ok(CSS.includes('var(--fg-accent, var(--theme-primary-color, #506fe4))'),
    'cards no longer take their colour from their group');
});
