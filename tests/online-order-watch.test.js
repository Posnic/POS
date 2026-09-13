'use strict';
/*
 * The online order queue, watched.
 *
 * Owner: "dektop notification nothing received for cancel request."
 *
 * Two holes behind that, and the tests below are one for each.
 *
 * NOTHING POLLED. The queue was drawn only when somebody opened the Online
 * orders page, so a cancellation asked for while the till was on the sale
 * screen sat there unseen.
 *
 * THE SOUND IS DESKTOP-ONLY BY CONSTRUCTION. src/order-alert.js listens on the
 * process event bus, which reaches the renderer only because the API runs in
 * the same Electron process. On the web frontend the API is on a server and
 * process.emit there reaches nothing here, so there was no notification of any
 * kind. The watcher is the part that works in both.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const WATCH = ['frontend', 'static', 'script', 'js', 'core', 'online-order-watch.js'];

/**
 * The shell, with a sidebar and a PosnicPro that answers with one queue.
 *
 * The real file is evaluated - not a copy of its logic - so a change to it
 * that stops the badge appearing fails here.
 */
function till({ queue = [], fails = false } = {}) {
  const dom = new JSDOM(
    '<body><ul><li id="online_orders_menu"><a href="#/onlineorders" id="view_onlineorders_page">Online orders</a></li></ul></body>',
    /* pretendToBeVisual, because without it jsdom reports visibilityState
       'prerender' and document.hidden true - and the watcher deliberately
       does not poll a page nobody is looking at, so nothing would run. */
    { url: 'https://shop.example/', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  const calls = { asked: 0, toasts: [] };
  let answer = queue;
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    get(_request, ok, no) {
      calls.asked += 1;
      if (fails) return no({});
      return ok({ type: 'success', data: answer });
    },
    alert(heading, text) {
      calls.toasts.push([heading, text]);
    },
  };
  window.eval(read(...WATCH));
  /* The file defers its first look to DOMContentLoaded when the document is
     still parsing, which is where jsdom is at this point. */
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return {
    window,
    document: window.document,
    calls,
    say: (next) => {
      answer = next;
    },
  };
}

test('the queue is counted on the menu, from wherever the person is standing', () => {
  const till1 = till({ queue: [{ sale_id: 's1', token_id: '101' }, { sale_id: 's2', token_id: '102' }] });
  const badge = till1.document.querySelector('#view_onlineorders_page .online-orders-badge');
  assert.ok(badge, 'nothing says how many orders are waiting');
  assert.strictEqual(badge.textContent, '2');
  assert.strictEqual(till1.calls.asked, 1, 'the queue was not asked for at all');

  /* An empty queue takes the badge away rather than showing a zero. */
  till1.say([]);
  till1.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(till1.document.querySelector('.online-orders-badge'), null);
  till1.window.close();
});

test('a cancellation the customer asked for is said, once, and said differently', () => {
  /*
   * The whole point: this arrives with nobody in front of the till. It is
   * also NOT the same event as a new order - collapsing them into one
   * sentence is how staff learn to ignore the one that matters.
   */
  const asked = till({
    queue: [{ sale_id: 's1', sales_id: 'S-Q43L-000018', token_id: '101', cancel_requested: true }],
  });
  /* The BILL NUMBER leads, the way the queue card does, with the token beside
     it: staff scan for the bill number, the customer is holding the token. */
  assert.deepStrictEqual(asked.calls.toasts, [
    ['Alert', 'Customer asked to cancel - S-Q43L-000018 · Token 101'],
  ]);

  /* Polled again, the same order says nothing a second time. */
  asked.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(asked.calls.toasts.length, 1, 'the same order was announced twice');

  /* A new one waiting for approval is the quieter sound. */
  asked.say([
    { sale_id: 's1', sales_id: 'S-Q43L-000018', token_id: '101', cancel_requested: true },
    { sale_id: 's2', sales_id: 'S-Q43L-000019', token_id: '102' },
  ]);
  asked.window.PosnicOnlineOrderWatch.look();
  assert.deepStrictEqual(asked.calls.toasts[1], [
    'Information',
    'New online order - S-Q43L-000019 · Token 102',
  ]);

  /* An order with no bill number yet still says what it can. */
  asked.say([{ sale_id: 's3', token_id: '103' }]);
  asked.window.PosnicOnlineOrderWatch.look();
  assert.deepStrictEqual(asked.calls.toasts[2], ['Information', 'New online order - Token 103']);
  asked.window.close();
});

test('an order that starts waiting for a DIFFERENT reason is said again', () => {
  const till2 = till({ queue: [{ sale_id: 's1', token_id: '101' }] });
  assert.strictEqual(till2.calls.toasts.length, 1);
  /* The same order, now with a cancellation asked about it. That is news. */
  till2.say([{ sale_id: 's1', token_id: '101', cancel_requested: true }]);
  till2.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(till2.calls.toasts.length, 2);
  assert.strictEqual(till2.calls.toasts[1][0], 'Alert');
  till2.window.close();
});

test('a till that cannot reach the server does not claim the queue is clear', () => {
  const till3 = till({ queue: [{ sale_id: 's1', token_id: '101' }] });
  assert.strictEqual(till3.document.querySelector('.online-orders-badge').textContent, '1');

  /* The next poll fails. A shop that cannot be reached is not a shop with
     nothing waiting, so the count stays rather than going to zero. */
  till3.window.PosnicPro.get = (_r, _ok, no) => no({});
  till3.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(
    till3.document.querySelector('.online-orders-badge').textContent,
    '1',
    'an unreachable server emptied the queue on screen'
  );
  till3.window.close();
});

test('the toast heading stays English, because it is the icon', () => {
  /*
   * PosnicPro.alert reads the heading to choose the icon:
   *   icon = heading === 'Information' || heading === 'Alert' ? 'info' : heading
   *   icon = icon.toLowerCase()
   * so a translated heading becomes a CSS class in that language. The
   * auto-tagger wrapped these once; DENY in tests/tools/i18n-tag-js.js keeps
   * it from happening again, and this keeps the file honest meanwhile.
   */
  const src = read(...WATCH);
  assert.match(src, /PosnicPro\.alert\(why === 'cancel' \? 'Alert' : 'Information', line\)/);
  assert.ok(!/i18n\.t\('lang_alert'/.test(src), 'the toast icon was translated');
  assert.match(read('tests', 'tools', 'i18n-tag-js.js'), /'Alert\|Information'/);

  /* And the sentence beside it, which a person actually reads, IS translated. */
  assert.match(src, /t\('lang_cancel_requested', 'Customer asked to cancel'\)/);
  assert.match(src, /t\('lang_new_online_order', 'New online order'\)/);
});

test('the watcher is loaded by the shell, and the queue on screen refreshes itself', () => {
  const map = JSON.parse(read('frontend', 'pages_css_js_map.json'));
  const shell = JSON.stringify(map);
  assert.ok(
    shell.includes('static/script/js/core/online-order-watch.js'),
    'the watcher is never loaded, so none of the above runs on a real till'
  );

  /* And while somebody IS on the queue, the rows keep up rather than sitting
     there until Refresh is pressed. */
  const queue = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'online_orders.js');
  assert.match(queue, /watch: function \(\)/);
  assert.match(queue, /self\.watch\(\);/, 'load() never starts the refresh');
  assert.match(queue, /clearInterval\(self\._watching\)/, 'the refresh never stops when the page is left');
});
