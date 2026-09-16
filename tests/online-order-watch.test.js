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
function till({ queue = [], ringing = [], fails = false } = {}) {
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
  /* The calls ride in their own key, the way the server sends them. */
  let calling = ringing;
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    get(_request, ok, no) {
      calls.asked += 1;
      if (fails) return no({});
      return ok({ type: 'success', data: answer, calls: calling });
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
    rings: (next) => {
      calling = next;
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
  /* Written Alert-then-Information, in that order, because the auto-tagger's
     DENY list is keyed on the pair as it is spelled: reversing the two would
     make the sweep offer to translate the icon again. */
  assert.match(src, /PosnicPro\.alert\(why !== 'new' \? 'Alert' : 'Information', line\)/);
  assert.ok(!/i18n\.t\('lang_alert'/.test(src), 'the toast icon was translated');
  assert.match(read('tests', 'tools', 'i18n-tag-js.js'), /'Alert\|Information'/);

  /* And the sentence beside it, which a person actually reads, IS translated. */
  assert.match(src, /t\('lang_cancel_requested', 'Customer asked to cancel'\)/);
  assert.match(src, /t\('lang_new_online_order', 'New online order'\)/);
});

test('a new order makes a noise, and a cancellation makes a louder one', () => {
  /*
   * Owner: "one order sound in desktop also. play. new order came."
   *
   * A shop on the web frontend had no sound at all: the tones are synthesised
   * by the desktop's MAIN process and handed to a window, and on the web
   * there is no main process to hand them over.
   */
  const played = [];
  const page = till({ queue: [] });
  /* A real oscillator, counted rather than heard. */
  page.window.AudioContext = function () {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.createOscillator = () => ({
      frequency: {},
      connect() {},
      start() {},
      stop() {},
      set type(v) {},
    });
    this.createGain = () => ({
      gain: {
        setValueAtTime(v) {
          if (v > 0.01) played.push(v);
        },
        exponentialRampToValueAtTime(v) {
          if (v > 0.01) played.push(v);
        },
      },
      connect() {},
    });
  };

  assert.strictEqual(page.window.PosnicOnlineOrderWatch.sound('received'), true, 'a new order was silent');
  const quiet = played.length;
  assert.ok(quiet > 0, 'nothing was sounded');

  played.length = 0;
  assert.strictEqual(page.window.PosnicOnlineOrderWatch.sound('waiting'), true);
  /* Three notes rather than two, and louder: this one has to carry. */
  assert.ok(played.length > quiet, 'a cancellation sounds the same as an ordinary order');
  assert.ok(Math.max(...played) > 0.35, 'the cancellation is no louder than a new order');
  page.window.close();
});

test('the desktop app keeps its own sound, and is not rung twice', () => {
  /*
   * Inside Electron the main process already plays these, and keeps playing
   * until the queue is dealt with - a better alarm than this one. Two sounds
   * at once is how a shop learns to mute the app.
   */
  const page = till({ queue: [] });
  page.window.electronAPI = { orderAlert: { on() {}, resolve() {}, clear() {} } };
  assert.strictEqual(page.window.PosnicOnlineOrderWatch.hasDesktopAlert(), true);
  assert.strictEqual(
    page.window.PosnicOnlineOrderWatch.sound('received'),
    false,
    'the web sound played on top of the desktop alarm'
  );
  page.window.close();
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

/* ------------------------------------------------- and a table calling */

/**
 * A recording oscillator, so a tone can be counted rather than heard.
 *
 * Installed AFTER the till is built, because the audio context is made once
 * on the first sound and then kept - a page that has already announced
 * something has already made the real one.
 */
function listenTo(page) {
  const notes = [];
  page.window.AudioContext = function () {
    this.currentTime = 0;
    this.state = 'running';
    this.destination = {};
    this.createOscillator = () => {
      notes.push(1);
      return { frequency: {}, connect() {}, start() {}, stop() {}, set type(v) {} };
    };
    this.createGain = () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    });
  };
  return notes;
}

test('a table calling is heard on a web till, which is where nothing heard it', () => {
  /*
   * Owner: "he is in table 7 and wants to call waiter or captain... desktop
   * app and captain mobile apps getting notification."
   *
   * The desktop rings, because the API raises the alarm on the process bus
   * inside the same Electron process. A shop running the browser console has
   * no such process, and this watcher read only `data` - so the one feature
   * whose entire value is that somebody NOTICES made no sound, raised no
   * toast, and did not open the panel that answers it. The call sat in a
   * corner of a screen nobody was facing, which is the waiter who never turns
   * round, rebuilt in software.
   */
  const floor = till({ queue: [], ringing: [{ call_id: 'c1', table_number: '7' }] });
  assert.deepStrictEqual(floor.calls.toasts, [['Alert', 'Table is calling - Table 7']]);
  floor.window.close();
});

test('a call with no table still says what it can', () => {
  const floor = till({ queue: [], ringing: [{ call_id: 'c1' }] });
  assert.deepStrictEqual(floor.calls.toasts, [['Alert', 'Table is calling']]);
  floor.window.close();
});

test('a call is said once, and the same table calling again is said again', () => {
  const floor = till({ queue: [], ringing: [] });
  floor.rings([{ call_id: 'c1', table_number: '7' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(floor.calls.toasts.length, 1);

  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(floor.calls.toasts.length, 1, 'the same call was announced twice');

  /* Somebody went, so it leaves the queue. */
  floor.rings([]);
  floor.window.PosnicOnlineOrderWatch.look();

  /* And table seven wants something else. A new call, and news again. */
  floor.rings([{ call_id: 'c2', table_number: '7' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(
    floor.calls.toasts.length,
    2,
    'a second call from the same table was swallowed'
  );
  floor.window.close();
});

test('the call opens the panel that answers it, rather than a toast that vanishes', () => {
  /*
   * Owner, about an earlier notification: "whats the use of that? how to
   * respond where to check the request is important." A message that cannot
   * be acted on trains people to dismiss messages.
   */
  const floor = till({ queue: [], ringing: [] });
  let opened = 0;
  floor.window.PosnicRequestDock = {
    show() {
      opened += 1;
    },
  };
  floor.rings([{ call_id: 'c1', table_number: '7' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(opened, 1, 'the call was announced with nowhere to go');
  floor.window.close();
});

test('a call is the louder pattern, because a person is sitting there waiting', () => {
  const floor = till({ queue: [], ringing: [] });
  const notes = listenTo(floor);

  floor.rings([{ call_id: 'c1', table_number: '7' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  const forACall = notes.length;
  assert.ok(forACall > 0, 'a call made no sound at all');

  notes.length = 0;
  floor.rings([]);
  floor.say([{ sale_id: 's1', token_id: '101' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  assert.ok(
    forACall > notes.length,
    'a call sounds exactly like an ordinary new order, so it carries no further'
  );
  floor.window.close();
});

test('a call is NOT counted on the Online orders menu, because it is not on that page', () => {
  /*
   * The badge hangs on that menu entry and is the way IN to it, and the queue
   * page draws `data` - it has never carried calls. A number there that
   * included them would send somebody to a screen the call is not on, which
   * is worse than no number: it spends the one moment they were willing to go
   * and look. The request dock is where a call is answered.
   */
  const floor = till({ queue: [], ringing: [{ call_id: 'c1', table_number: '7' }] });
  assert.strictEqual(
    floor.document.querySelector('.online-orders-badge'),
    null,
    'the badge sends somebody to a page the call is not on'
  );

  /* And a real order still counts, with the call still standing. */
  floor.say([{ sale_id: 's1', token_id: '101' }]);
  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(floor.document.querySelector('.online-orders-badge').textContent, '1');

  /* The queue page it leads to reads `data`, which is why the above is right. */
  const queue = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'online_orders.js');
  assert.match(queue, /var list = \(response && response\.data\) \|\| \[\];/);
  assert.ok(!/response\.calls/.test(queue), 'the queue page now shows calls, so the badge should count them');
  floor.window.close();
});

test('a shop whose server says nothing about calls is unaffected', () => {
  /* An older API answers with `data` alone. Nothing may throw on that. */
  const floor = till({ queue: [{ sale_id: 's1', token_id: '101' }] });
  floor.window.PosnicPro.get = (_r, ok) => ok({ type: 'success', data: [] });
  floor.window.PosnicOnlineOrderWatch.look();
  assert.strictEqual(floor.document.querySelector('.online-orders-badge'), null);
  floor.window.close();
});
