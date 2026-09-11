'use strict';

/*
 * The Restaurant settings page is arranged, not stacked.
 *
 * It used to be six cards in a column - tables, serving periods, venues,
 * delivery charges, modifiers, table list - so finding the one you came for
 * meant scrolling past five you did not, and the page grew every time the
 * kitchen gained a setting. Two of the cards also printed their own heading
 * twice, once in the card header and again in the body.
 *
 * Grouping them into tabs is the easy half. The half worth pinning is that
 * nothing left the DOM doing it.
 *
 * MOVING MARKUP BETWEEN PANES IS SAFE; MOVING IT OUT OF THE DOM IS NOT. Panes
 * are hidden rather than removed, and the channel settings collect() reads its
 * rows by id wherever they sit - so a hidden tab still saves correctly. But a
 * key whose markup is gone posts an empty value and wipes what the shop had.
 * That has happened three times in this codebase: menu_dayparts,
 * sales_channels_enabled, and the tab ids the last pane split deleted.
 *
 * So every container the save path reads is asserted present, by id.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(
  path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');
const JS = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');

/* The pane the tabs live in, so nothing below can match markup elsewhere. */
function restaurantPane() {
  const start = HTML.indexOf('id="v-pills-tableorder"');
  assert.ok(start > 0, 'the Restaurant settings pane is gone');
  let depth = 0;
  let i = HTML.lastIndexOf('<div', start);
  for (let j = i; j < HTML.length; j += 4) {
    const open = HTML.startsWith('<div', j);
    const close = HTML.startsWith('</div>', j);
    if (!open && !close) { j -= 3; continue; }
    depth += open ? 1 : -1;
    if (depth === 0) return HTML.slice(i, j + 6);
    j += open ? 0 : 2;
  }
  return HTML.slice(i);
}

const PANE = restaurantPane();

const TABS = ['restauranttables', 'restaurantmenu', 'restaurantdelivery'];

test('the page is three tabs, and each one points at a pane that exists', () => {
  for (const id of TABS) {
    assert.ok(PANE.includes(`id="${id}-tab-line"`), `no tab for ${id}`);
    assert.ok(PANE.includes(`href="#${id}-line"`), `the ${id} tab links nowhere`);
    assert.ok(PANE.includes(`id="${id}-line"`), `no pane behind the ${id} tab`);
  }
});

test('exactly one tab opens selected', () => {
  const active = (PANE.match(/nav-link active" id="restaurant/g) || []).length;
  assert.equal(active, 1, 'a tabbed page must open on exactly one tab');
  assert.ok(PANE.includes('tab-pane fade show active" id="restauranttables-line"'),
    'the page should open on Tables, which is what the page is for');
});

/*
 * The important one. Each id below is read by a save path: if the markup is
 * not in the document, the next Save writes an empty value over real data.
 */
test('every container the save path reads is still in the document', () => {
  for (const id of [
    'menu_daypart_rows',       // serving periods
    'partner_venue_rows',      // hotels and other venues
    'channel_charge_rows',     // delivery and other charges
    'modifier_groups_body',    // modifier groups
    'view_tableorder_per_page' // the table list
  ]) {
    assert.ok(PANE.includes(`id="${id}"`), `${id} left the Restaurant pane`);
  }
});

test('the loaders still fire on entry to the pane, not on a sub-tab', () => {
  /*
   * Both loads bind to the OUTER tab. That is what makes hidden sub-tabs safe:
   * the markup behind them is already populated by the time anyone clicks. If
   * a load is ever moved onto a sub-tab, a Save from a tab nobody opened would
   * write empty rows.
   */
  assert.match(JS, /on\('click', '#v-pills-tableorder-tab, #manage_sec_tableorder'/,
    'servingPeriods.load no longer binds to the Restaurant pane');
  assert.match(JS, /#v-pills-tableorder-tab, #manage_sec_tableorder'/,
    'salesChannels.load no longer binds to the Restaurant pane');
  for (const id of TABS) {
    assert.ok(!JS.includes(`'#${id}-tab-line'`),
      `a loader was bound to #${id}-tab-line; it belongs on the pane, not the sub-tab`);
  }
});

test('no card says its own name twice', () => {
  /*
   * The card header carries the heading. Venues and charges repeated it in the
   * body, so the page read "Hotels and other venues / Hotels and other venues"
   * with the help text under it.
   */
  for (const key of ['lang_partner_venues', 'lang_delivery_and_fees']) {
    const times = (PANE.match(new RegExp(`class="${key}"`, 'g')) || []).length;
    assert.equal(times, 1, `${key} is rendered ${times} times in one card`);
  }
});

test('no link sends you to the tab you are already on', () => {
  /*
   * The page opened with a "Manage tables" link whose click handler was
   * $('#v-pills-tableorder-tab').click() - the pane it was sitting in. It read
   * as a way somewhere and was a way nowhere.
   */
  assert.ok(!PANE.includes("$('#v-pills-tableorder-tab').click()"),
    'a link on the Restaurant pane re-opens the Restaurant pane');
});
