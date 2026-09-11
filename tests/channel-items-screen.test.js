'use strict';

/**
 * The bulk "what each channel sells" screen, driven rather than read.
 *
 * WHY THIS AND NOT ANOTHER UNIT TEST.
 *
 * The domain logic has eighteen tests and none of them can see the failures
 * this screen is actually prone to: a click handler bound to a selector that
 * does not match, a checkbox class the collector does not read, a payload that
 * posts the wrong field name, a button that silently does nothing. Every one of
 * those passes `node --check`, passes eslint, and is invisible until a person
 * clicks it.
 *
 * Earlier in this feature's life a rendering pass found three bugs that every
 * static check in the repository had waved through. So this one builds the
 * markup, loads the real module, clicks the real buttons, and asserts on what
 * would have gone over the wire.
 *
 * It replaces most of "somebody needs to walk the screen" - not all of it. It
 * cannot see a control that is invisible, mispositioned, or unreadable.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'frontend');
const SETTINGS = path.join(ROOT, 'static/script/js/modules/js/settings.js');

/** Comments out, string literals untouched, so a brace counter can be trusted. */
function stripComments(src) {
  let out = '';
  let inString = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next === undefined ? '' : next;
        i += 1;
      } else if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      out += ' ';
      continue;
    }
    out += c;
  }
  return out;
}

/** One assignment lifted whole, by brace depth from its own `= {`. */
function objectLiteral(src, name) {
  const start = src.indexOf(`${name} = {`);
  assert.ok(start !== -1, `${name} is gone or was renamed`);
  const from = src.indexOf('{', start);
  let depth = 0;
  let inString = null;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') inString = c;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  assert.fail(`could not find the end of ${name}`);
}

/**
 * The screen, with the real module on it and the network captured.
 *
 * The delegated handlers are taken from the real source too - `$(document).on`
 * lines - because a handler bound to the wrong selector is precisely the bug
 * this file exists to catch, and re-declaring them here would test the test.
 */
function screen({ items = [] } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <select id="channel_items_channel"><option value="online">Online</option></select>
       <select id="channel_items_category"><option value="">All</option></select>
       <input id="channel_items_search" value="">
       <button id="channel_items_find"></button>
       <div id="channel_items_wrap" style="display:none;">
         <input type="checkbox" id="channel_items_all">
         <button id="channel_items_off"></button>
         <button id="channel_items_on"></button>
         <table><tbody id="channel_items_rows"></tbody></table>
         <p id="channel_items_count"></p>
       </div>
     </body></html>`,
    { runScripts: 'outside-only' }
  );

  const { window } = dom;
  window.eval(fs.readFileSync(path.join(ROOT, 'static/script/js/jquery.min.js'), 'utf8'));

  const calls = { get: [], post: [], alerts: [] };
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback || key },
    alert: (kind, text) => calls.alerts.push({ kind, text }),
    get: (params, ok) => {
      calls.get.push(params);
      ok({ type: 'success', data: { channel: 'online', items, total: items.length } });
    },
    post: (params, ok) => {
      calls.post.push(params);
      ok({ type: 'success', message: 'Done', data: { changed: 2, matched: 2 } });
    },
  };

  const src = stripComments(fs.readFileSync(SETTINGS, 'utf8'));
  window.eval('PosnicPro.channelItems = ' + objectLiteral(src, 'PosnicPro.channelItems') + ';');

  /* The real delegated handlers, lifted from the real file. */
  const handlers = [...src.matchAll(/\$\(document\)\.on\((['"][^'"]+['"]),\s*(['"][^'"]+['"])[\s\S]*?\}\);/g)]
    .map((m) => m[0])
    .filter((block) => block.includes('channel_items') || block.includes('channelItems'));
  assert.ok(handlers.length >= 4, `expected the screen's handlers, found ${handlers.length}`);
  window.eval(handlers.join('\n'));

  return { window, calls, $: window.$ };
}

const ITEMS = [
  { id: 'a1', name: 'Paneer Tikka', category_name: 'Starters', price: 280, on: true, hours: null },
  { id: 'b2', name: 'Butter Naan', category_name: 'Breads', price: 60, on: false, hours: null },
  {
    id: 'c3',
    name: 'Masala Dosa',
    category_name: 'Breakfast',
    price: 90,
    on: true,
    hours: { from: '07:00', to: '11:00' },
  },
];

test('pressing the filter button asks the server, with the filters on it', () => {
  const { window, calls, $ } = screen({ items: ITEMS });
  $('#channel_items_category').val('');
  $('#channel_items_search').val('dosa');
  $('#channel_items_find').click();

  assert.strictEqual(calls.get.length, 1, 'the Show button is not wired to anything');
  assert.strictEqual(calls.get[0].url, 'items/channel');
  assert.strictEqual(calls.get[0].data.channel, 'online');
  assert.strictEqual(calls.get[0].data.search, 'dosa');
  assert.ok(window.document.querySelectorAll('#channel_items_rows tr').length === 3);
});

test('each row says what the shop decided, not what the clock says', () => {
  /* Somebody configuring a catalogue is not asking whether it is lunchtime. */
  const { window, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();

  const text = window.document.getElementById('channel_items_rows').textContent;
  assert.match(text, /Paneer Tikka/);
  assert.match(text, /Sold here/);
  assert.match(text, /Not sold here/);
  /* And a window is shown beside the name, so a limited line reads as limited
     rather than as plainly on sale. */
  assert.match(text, /07:00 - 11:00/);
});

test('select all ticks every row, and only the ticked ones are sent', () => {
  const { calls, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();

  $('#channel_items_all').prop('checked', true).trigger('change');
  assert.strictEqual($('.channel-item-pick:checked').length, 3, 'select all is not wired');

  $('#channel_items_all').prop('checked', false).trigger('change');
  $('.channel-item-pick').eq(1).prop('checked', true);
  $('#channel_items_off').click();

  assert.strictEqual(calls.post.length, 1, 'the button posts nothing');
  const body = JSON.parse(calls.post[0].data);
  assert.deepStrictEqual(body.item_ids, ['b2'], 'the wrong items were sent');
  assert.strictEqual(body.on, false);
  assert.strictEqual(body.channel, 'online');
});

test('"sell here" and "do not sell here" differ by exactly one flag', () => {
  /* The two buttons share a code path; a copy-paste that left both sending
     the same value would be invisible on screen and wrong half the time. */
  const { calls, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();
  $('.channel-item-pick').eq(0).prop('checked', true);
  $('#channel_items_on').click();

  /*
   * Selected again on purpose. A successful change RELOADS the list, which
   * clears the ticks - and that is right: the rows now show different states,
   * and leaving them ticked invites a second bulk action nobody meant. The
   * first version of this test assumed the selection survived, and the screen
   * was the one telling the truth.
   */
  $('.channel-item-pick').eq(0).prop('checked', true);
  $('#channel_items_off').click();

  assert.strictEqual(calls.post.length, 2);
  assert.strictEqual(JSON.parse(calls.post[0].data).on, true);
  assert.strictEqual(JSON.parse(calls.post[1].data).on, false);
});

test('a successful change reloads the list and clears the ticks', () => {
  /* Named on its own because it is a deliberate behaviour, not a side effect,
     and the next person to read the apply() path should find it asserted. */
  const { calls, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();
  $('.channel-item-pick').eq(0).prop('checked', true);
  $('#channel_items_on').click();

  assert.strictEqual(calls.get.length, 2, 'the list was not refreshed after the change');
  assert.strictEqual($('.channel-item-pick:checked').length, 0, 'stale ticks survived');
});

/*
 * THE ONE THAT STOPS A SILENT NO-OP.
 *
 * Pressing a bulk button with nothing selected must say so. Posting an empty
 * list would answer "0 changed" and look like the screen had done its job.
 */
test('pressing a bulk button with nothing selected says so and posts nothing', () => {
  const { calls, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();
  $('#channel_items_off').click();

  assert.strictEqual(calls.post.length, 0);
  assert.strictEqual(calls.alerts.at(-1).kind, 'error');
});

test('the result reports what moved, not what was selected', () => {
  /* "40 selected, 3 changed" is the honest answer when most were already where
     the shop wanted them, and the number a person checks against. */
  const { calls, $ } = screen({ items: ITEMS });
  $('#channel_items_find').click();
  $('.channel-item-pick').eq(0).prop('checked', true);
  $('#channel_items_on').click();

  const success = calls.alerts.filter((a) => a.kind === 'success').at(-1);
  assert.match(success.text, /\(2\)/, 'the changed count is not shown to the user');
});

test('an empty result hides the list rather than leaving the last one on screen', () => {
  /* A filter that matches nothing, still showing the previous ten rows, is how
     somebody bulk-edits the wrong items. */
  const { window, $, calls } = screen({ items: [] });
  $('#channel_items_find').click();

  assert.strictEqual(window.document.getElementById('channel_items_wrap').style.display, 'none');
  assert.strictEqual(calls.alerts.at(-1).kind, 'info');
});
