'use strict';

/*
 * A dish can be put on a serving period.
 *
 * Settings said "set the times once here, then mark each dish on the item
 * page". The item page had the box - a select2 called Served at - and nothing
 * ever put an option in it. The field saved fine, read back fine, and could
 * never be set. The owner set up Breakfast, opened a dish, and found "All day"
 * over an empty list.
 *
 * This is the fifth time a built feature turned out to have no wire to it in
 * this codebase. The channel-exceptions box beside it loads its options from
 * the same settings group; the periods box now rides on that request, and this
 * pins that it does, on add and on edit, and that saving periods refreshes the
 * cached list rather than serving yesterday's.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const ITEMS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js');
const SETTINGS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const FORM = read('frontend', 'modules', 'items_write.html');

test('the box is on the form, and is a multi-select', () => {
  assert.match(FORM, /id="item_dayparts"[^>]*multiple="multiple"/,
    'Served at is not a multi-select on the item form');
});

test('the periods are read from the settings group that holds them', () => {
  /* One request: the channel loader hands the periods across. */
  assert.match(ITEMS, /PosnicPro\.itemDayparts\.take\(values\.menu_dayparts\)/,
    'the item form never reads menu_dayparts, so the box stays empty');
  const helper = ITEMS.slice(ITEMS.indexOf('PosnicPro.itemDayparts = {'));
  assert.ok(helper.length > 100, 'there is no itemDayparts helper');
  assert.match(helper, /take: function \(rows\)/);
  assert.match(helper, /\$sel\.html\(\(PosnicPro\.itemDayparts\._options \|\| \[\]\)\.map/,
    'the helper never writes options into the box');
});

test('setting a value waits for the options to exist', () => {
  /* select2 drops any id it has no option for; set before load and the next
     save writes the empty box back, putting a breakfast dish on all day. */
  const helper = ITEMS.slice(ITEMS.indexOf('PosnicPro.itemDayparts = {'));
  const set = helper.slice(helper.indexOf('    set: function (values) {'), helper.indexOf('    }\n};'));
  assert.match(set, /PosnicPro\.itemDayparts\.load\(function \(\) \{\s*\$\('#item_dayparts'\)\.val\(values \|\| \[\]\)\.trigger\('change'\);/,
    'set() writes the value before the options are loaded');
});

test('edit goes through set(), and never sets the raw box', () => {
  const direct = (ITEMS.match(/\$\('#item_dayparts'\)\.val\(data\.daypart_ids/g) || []).length;
  assert.equal(direct, 0, `${direct} edit path(s) still set the box directly, before its options exist`);
  const viaSet = (ITEMS.match(/PosnicPro\.itemDayparts\.set\(data\.daypart_ids \|\| \[\]\)/g) || []).length;
  assert.equal(viaSet, 2, `expected both edit paths to use itemDayparts.set, found ${viaSet}`);
});

test('a new dish gets the list too, with nothing pre-selected', () => {
  assert.match(ITEMS, /PosnicPro\.items\.itemAction = 'add';\s*\n\s*PosnicPro\.itemDayparts\.set\(\[\]\);/,
    'opening the form for a new dish does not fill the periods');
});

test('what is chosen is what is saved', () => {
  const sends = (ITEMS.match(/daypart_ids: \$\('#item_dayparts'\)\.val\(\) \|\| \[\]/g) || []).length;
  assert.ok(sends >= 2, `the save payload reads the box in ${sends} place(s); expected add and edit`);
});

test('saving periods refreshes the list the item form has cached', () => {
  const save = SETTINGS.slice(SETTINGS.indexOf('PosnicPro.servingPeriods = {'), SETTINGS.indexOf('PosnicPro.partnerPresets = {'));
  assert.match(save, /PosnicPro\.itemDayparts\._options = null/,
    'a period saved in Settings is not offered on the next dish until sign-out');
  assert.match(save, /PosnicPro\.itemChannels\._options = null/,
    'the channel list from the same request is left stale');
});
