'use strict';

/*
 * The desktop-app poster, and every place it must keep its mouth shut.
 *
 * The owner asked for it: "in order promote the desktop app inbetween web
 * session show pop", and then picked all three designs, "radomly show that".
 *
 * An advertisement inside software somebody is working in is the easiest thing
 * in this codebase to get wrong, and every way of getting it wrong is invisible
 * from the file itself. So this drives the real module in a real DOM and
 * asserts what a shopkeeper would actually see, rather than checking how the
 * source is spelled. Reading the file would have passed happily while the
 * poster covered a customer being billed.
 *
 * The rules being defended, each of them costly to break:
 *
 *   not in the desktop app     advertising the thing they are already running
 *   not on the public demo     the owner's standing no-blocking-notifications
 *                              rule for demo.posnic.io
 *   not on self-hosted         mode 'local' means the browser is a LAN client
 *                              of the shop's own server. The desktop app is a
 *                              separate till with its own database, so that
 *                              advice creates exactly the two-shops-in-one-
 *                              database mess we spent this week fixing.
 *   never over a live sale     defer, do not cancel
 *   once per browser, ever     including across navigations
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'static', 'script', 'js', 'core', 'desktop-nudge.js'),
  'utf8'
);

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const ELECTRON = CHROME + ' Posnic/1.4.0 Electron/43.2.0';

/** An empty cart draws a placeholder row, which must not read as a live sale. */
const EMPTY_CART = '<table id="sales_new_items_table"><tbody>'
  + '<tr id="sales_new_tablerow_content_area"><td>Sale Order Empty</td></tr></tbody></table>';
const CART_WITH_A_LINE = '<table id="sales_new_items_table"><tbody>'
  + '<tr><td>Milk 1L</td></tr></tbody></table>';

/**
 * Run the module against a page and a runtime, with time under our control.
 *
 * @param {object} opts
 * @param {object} opts.runtime  the /runtime-info payload the server returns
 * @param {string} opts.ua       user agent
 * @param {string} opts.body     page markup
 * @param {object} opts.stored   localStorage contents before the run
 * @param {number} opts.random   fixed Math.random value
 * @param {boolean} opts.blockStorage  make localStorage throw, as a private
 *                                     window and a data-blocking browser do
 */
function run(opts) {
  const o = Object.assign({ ua: CHROME, body: EMPTY_CART, stored: {}, random: 0 }, opts);
  const dom = new JSDOM('<!doctype html><html><body>' + o.body + '</body></html>',
    { runScripts: 'outside-only' });
  const win = dom.window;

  /*
   * jsdom 30 no longer takes a userAgent option for navigator: it reports its
   * own string and silently ignores the one you pass. Left uncorrected, the
   * Electron case here tested nothing at all and passed for the wrong reason.
   */
  Object.defineProperty(win.navigator, 'userAgent', { configurable: true, value: o.ua });

  const store = Object.assign({}, o.stored);
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    value: {
      getItem(k) {
        if (o.blockStorage) throw new Error('site data blocked');
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem(k, v) {
        if (o.blockStorage) throw new Error('site data blocked');
        store[k] = String(v);
      },
    },
  });

  /* Timers we can run on demand, so a four minute wait costs nothing. */
  const timers = [];
  win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };

  let asked = null;
  win.XMLHttpRequest = function () {
    this.open = (method, url) => { asked = url; };
    this.send = () => {
      this.responseText = JSON.stringify(o.runtime || {});
      if (this.onload) this.onload();
    };
  };

  const events = [];
  win.gtag = (name, action, params) => { events.push({ name, action, params }); };
  win.Math.random = () => o.random;

  win.eval(SRC);

  const api = {
    win,
    store,
    events,
    get asked() { return asked; },
    /** Fire every timer queued so far; returns how many ran. */
    tick() {
      const due = timers.splice(0, timers.length);
      due.forEach((t) => t.fn());
      return due.length;
    },
    get pending() { return timers.length; },
    get veil() { return win.document.getElementById('posnic_desktop_nudge'); },
    get text() {
      const v = this.veil;
      return v ? v.textContent.replace(/\s+/g, ' ').trim() : '';
    },
    click(id) { win.document.getElementById(id).onclick({ target: null }); },
  };
  /* One page load's worth of time. */
  api.tick();
  return api;
}

const CLOUD = { mode: 'cloud', edition: 'cloud' };

test('a shop using Posnic in a browser is offered the desktop app', () => {
  const r = run({ runtime: CLOUD });
  assert.ok(r.veil, 'no poster was shown to a cloud shop in a browser');
  assert.match(r.text, /Download free/);
});

test('the desktop app never advertises itself', () => {
  const r = run({ runtime: CLOUD, ua: ELECTRON });
  assert.equal(r.veil, null, 'the poster appeared inside the desktop app');
  assert.equal(r.asked, null, 'runtime-info was fetched before the cheap check ruled it out');
});

test('the public demo stays free of blocking notifications', () => {
  /* The owner's standing rule for demo.posnic.io. A visitor evaluating the
     product must never be stopped by a veil. */
  const r = run({ runtime: { mode: 'cloud', demo: true } });
  assert.equal(r.veil, null, 'a demo visitor met a modal');
});

test('a self-hosted LAN browser is not told to install a separate till', () => {
  /*
   * The expensive one. On mode 'local' the browser is a client of the shop's
   * own server; the desktop app is a whole standalone till with its own
   * database. Following that advice is how one shop's rows end up in another
   * shop's database, which is the bug this week was spent fixing.
   */
  const r = run({ runtime: { mode: 'local', edition: 'community' } });
  assert.equal(r.veil, null, 'a self-hosted LAN client was told to install the desktop app');
});

test('a sale in progress defers the poster instead of covering it', () => {
  const r = run({ runtime: CLOUD, body: CART_WITH_A_LINE });
  assert.equal(r.veil, null, 'the poster opened over a customer being billed');
  assert.ok(r.pending > 0, 'the poster was dropped rather than deferred, so it never shows at all');
});

test('the deferred poster arrives once the cart is clear', () => {
  const r = run({ runtime: CLOUD, body: CART_WITH_A_LINE });
  r.win.document.querySelector('#sales_new_items_table tbody').innerHTML =
    '<tr id="sales_new_tablerow_content_area"><td>Sale Order Empty</td></tr>';
  r.tick();
  assert.ok(r.veil, 'the sale finished and the poster never came back');
});

test('an open dialog also counts as busy', () => {
  const r = run({ runtime: CLOUD, body: EMPTY_CART + '<div class="modal show"></div>' });
  assert.equal(r.veil, null, 'the poster stacked on top of another dialog');
});

test('it is shown once per browser, ever', () => {
  const first = run({ runtime: CLOUD });
  assert.ok(first.veil);
  const second = run({ runtime: CLOUD, stored: first.store });
  assert.equal(second.veil, null, 'a second browser session was shown the poster again');
});

test('navigating away mid-poster does not earn a second one', () => {
  /* Marked done at render rather than at close, so closing the tab with the
     poster open still counts as having been asked. */
  const r = run({ runtime: CLOUD });
  assert.equal(r.store.posnic_desktop_nudge_done, '1',
    'the showing is only recorded when the poster is dismissed');
});

test('somebody who dismissed the login card is not asked again in a veil', () => {
  const r = run({ runtime: CLOUD, stored: { posnic_web_ok: '1' } });
  assert.equal(r.veil, null, 'the same offer was made twice to someone who already said no');
});

test('all three posters are reachable and each one sells something different', () => {
  const seen = {};
  [0, 0.5, 0.99].forEach((random) => {
    const r = run({ runtime: CLOUD, random });
    assert.ok(r.veil, 'random=' + random + ' produced no poster');
    seen[r.store.posnic_desktop_nudge_variant] = r.text;
  });
  assert.deepEqual(Object.keys(seen).sort(), ['counter', 'offline', 'reasons'],
    'the random pick cannot reach all three designs');

  assert.match(seen.counter, /printer, barcode scanner, cash drawer/i);
  assert.match(seen.offline, /internet went at two/i);
  assert.match(seen.reasons, /Hardware.*No internet.*Faster/i);
});

test('which poster somebody saw is recorded, or the experiment answers nothing', () => {
  const r = run({ runtime: CLOUD, random: 0 });
  assert.ok(r.store.posnic_desktop_nudge_variant, 'the variant was not stored');
  const shown = r.events.filter((e) => e.action === 'desktop_nudge_shown');
  assert.equal(shown.length, 1, 'the showing was not reported');
  assert.equal(shown[0].params.variant, r.store.posnic_desktop_nudge_variant);
});

test('closing works where storage throws', () => {
  /*
   * A private window and a browser set to block site data do not return null,
   * they RAISE, on read and on write alike. The sibling card had exactly this
   * bug: setItem threw before the element was removed, so clicking the x did
   * nothing whatsoever and the card stayed on screen. Closing is what the
   * click asked for; remembering is the part allowed to fail.
   */
  const r = run({ runtime: CLOUD, blockStorage: true });
  assert.ok(r.veil, 'a browser blocking site data got no poster at all');
  r.click('posnic_dn_x');
  assert.equal(r.veil, null, 'the close button refused to close');
});

test('every way out of the poster closes it', () => {
  ['posnic_dn_x', 'posnic_dn_later', 'posnic_dn_get'].forEach((id) => {
    const r = run({ runtime: CLOUD });
    r.click(id);
    assert.equal(r.veil, null, id + ' left the poster on screen');
  });
});

test('the download opens away from the till, not over it', () => {
  const r = run({ runtime: CLOUD });
  const link = r.win.document.getElementById('posnic_dn_get');
  assert.equal(link.getAttribute('target'), '_blank',
    'the download navigates the till away from the shop');
  assert.match(link.getAttribute('rel') || '', /noopener/);
});

test('escape closes it, because a modal that traps people is worse than none', () => {
  const r = run({ runtime: CLOUD });
  const ev = new r.win.KeyboardEvent('keydown', { key: 'Escape' });
  r.win.document.dispatchEvent(ev);
  assert.equal(r.veil, null, 'escape did not close the poster');
});

test('the poster carries no em dash', () => {
  /* The owner's rule: "never use -- this. very annoying it shows is ai text."
     It applies to what customers read, which is what this file is. */
  const r = run({ runtime: CLOUD, random: 0.5 });
  assert.ok(!/[—–]/.test(SRC), 'an em or en dash is in the shipped copy');
  assert.ok(!/[—–]/.test(r.text));
});

test('the module is actually shipped to a browser', () => {
  /*
   * A core script absent from the manifest is loaded by nobody, and from
   * inside the file that is invisible. weight-machine-integration.js sat
   * unmapped for months looking like a working feature.
   */
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'pages_css_js_map.json'), 'utf8'));
  const js = (manifest.dashboard || {}).js || [];
  assert.ok(js.includes('static/script/js/core/desktop-nudge.js'),
    'the dashboard does not load desktop-nudge.js, so it runs nowhere');
  assert.ok(!((manifest.login || {}).js || []).includes('static/script/js/core/desktop-nudge.js'),
    'the login page already carries the desktop card and must not also get the veil');
});
