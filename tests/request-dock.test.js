'use strict';

/*
 * The requests a customer has made, where staff already are.
 *
 * Owner: "when i asked cancel, deskto didnt show anthing. any request or
 * something. is there any potion done for that see all request organized ?"
 * and then "i want handle change reqeust smarlty like facebook chat pop up.
 * user able see all request properly easily handle. if possile provide when
 * its orders like order 10mins before etc."
 *
 * Two things were wrong and only one of them was the missing panel.
 *
 * A cancellation INSIDE the window simply happens - there is no request and
 * nothing to decide - and the only thing ever told about it was the PRINTER,
 * over the desktop process bus. No badge, no chime, no row in any queue. The
 * order left the floor in silence, which is the worse of the two cases: the
 * ticket printed the moment the order landed, so somebody may be cooking it.
 *
 * And the requests that DID reach the shop lived on a page. A till is on the
 * sale screen with people in front of it; a cancellation that needs answering
 * in the next two minutes cannot live behind a navigation.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DOCK = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'request-dock.js'),
  'utf8'
);
const REPO = fs.readFileSync(
  path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'),
  'utf8'
);

/** The dock in a page, with the shop answering whatever the test says. */
function dockPage(orders, { onPost } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://shop.example/dashboard.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const posts = [];
  window.PosnicPro = {
    t: (key, fallback) => fallback,
    get: (opts, ok) => ok({ type: 'success', data: orders }),
    post: (opts, ok) => {
      posts.push({ url: opts.url, body: JSON.parse(opts.data) });
      if (onPost) onPost();
      ok({ type: 'success', message: 'done' });
    },
  };
  window.setInterval = () => 0;
  window.eval(DOCK);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  return { window, document: window.document, posts };
}

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

test('nothing waiting means no dock at all, not a dock saying zero', () => {
  /* A permanent chrome element that is usually empty is a thing people learn
     to stop seeing, and then it is there for nothing on the day it matters. */
  const { document, window } = dockPage([]);
  const dock = document.getElementById('request-dock');
  assert.ok(dock, 'the dock was never built');
  assert.strictEqual(dock.hidden, true, 'an empty dock is sitting on every screen');
  window.close();
});

test('the dock says how many are waiting, and opens onto them', () => {
  const { document, window } = dockPage([
    { sale_id: 'a1', sales_id: 'S-1', token_id: '101', created_date: minutesAgo(3), cancel_requested: true },
    { sale_id: 'a2', sales_id: 'S-2', token_id: '102', created_date: minutesAgo(1) },
  ]);
  const dock = document.getElementById('request-dock');
  assert.strictEqual(dock.hidden, false);
  assert.strictEqual(document.getElementById('request-dock-count').textContent, '2');
  /* Shut until asked, the way a chat window is. */
  assert.strictEqual(document.getElementById('request-dock-panel').hidden, true);

  document.getElementById('request-dock-tab').click();
  assert.strictEqual(document.getElementById('request-dock-panel').hidden, false);
  assert.strictEqual(document.querySelectorAll('.request-dock-card').length, 2);
  window.close();
});

/*
 * HOW LONG AGO, because that is the whole decision.
 *
 * "Cancel this?" is a different question at forty seconds and at eleven
 * minutes - one the kitchen has not started, the other it has plated - and a
 * bare timestamp makes a person do that arithmetic under pressure.
 */
test('each card says how long ago the order was placed', () => {
  const { document, window } = dockPage([
    { sale_id: 'a1', sales_id: 'S-1', created_date: minutesAgo(11), cancel_requested: true },
  ]);
  document.getElementById('request-dock-tab').click();
  assert.strictEqual(document.querySelector('.request-dock-when').textContent, '11 minutes ago');

  const say = window.PosnicRequestDock.howLongAgo;
  assert.strictEqual(say(minutesAgo(0)), 'just now');
  assert.strictEqual(say(minutesAgo(1)), '1 minute ago');
  assert.strictEqual(say(minutesAgo(59)), '59 minutes ago');
  assert.strictEqual(say(minutesAgo(60)), '1 hour ago');
  assert.strictEqual(say(minutesAgo(200)), '3 hours ago');
  assert.strictEqual(say(''), '', 'an order with no time claims one');
  window.close();
});

test('a change request is written out as dishes, not as a diff nobody can read', () => {
  /* Whoever reads this is standing at a till in a hurry: "2 to 3 Chicken
     Biryani" is a decision at a glance; a JSON patch is not. */
  const { document, window } = dockPage([
    {
      sale_id: 'a1',
      sales_id: 'S-9',
      created_date: minutesAgo(2),
      change_requested: {
        at: new Date().toISOString(),
        items: [
          { name: 'Chicken Biryani', was: 2, quantity: 3 },
          { name: 'Lime Soda', was: 0, quantity: 1 },
          { name: 'Gulab Jamun', was: 2, quantity: 0 },
        ],
      },
    },
  ]);
  document.getElementById('request-dock-tab').click();
  const lines = [...document.querySelectorAll('.request-dock-diff li')].map((li) => li.textContent);
  assert.deepStrictEqual(lines, ['Chicken Biryani: 2 → 3', '+ 1 × Lime Soda', 'Remove Gulab Jamun']);
  assert.strictEqual(document.querySelector('.request-dock-card').getAttribute('data-kind'), 'change');
  window.close();
});

/*
 * THE ONE THAT REACHED NOBODY.
 *
 * A customer cancelling inside the window does not ask for anything; the
 * order simply goes. It is cancelled, so there is no yes or no to give - but
 * a ticket printed and a kitchen may be working on it.
 */
test('an order the customer already cancelled is shown, with one button that says what it does', () => {
  const { document, window } = dockPage([
    {
      sale_id: 'a1',
      sales_id: 'S-4',
      token_id: '404',
      created_date: minutesAgo(1),
      customer_cancelled_at: minutesAgo(0),
      cancel_seen: false,
      sale_process: 'cancelled',
    },
  ]);
  document.getElementById('request-dock-tab').click();
  const card = document.querySelector('.request-dock-card');
  assert.strictEqual(card.getAttribute('data-kind'), 'gone', 'a cancelled order is offered as a decision');
  assert.strictEqual(card.querySelector('.request-dock-kind').textContent, 'Customer cancelled this');
  const buttons = [...card.querySelectorAll('[data-do]')].map((b) => b.textContent);
  assert.deepStrictEqual(buttons, ['Got it'], 'two buttons on something nobody can decide');
  /* And it is the loud colour, because a ticket may be on the pass. */
  assert.strictEqual(document.getElementById('request-dock').getAttribute('data-worst'), 'cancel');
  window.close();
});

test('accepting goes through the same door the queue page uses', () => {
  /* Accepting a cancellation means one thing in this shop and it is defined
     once, on the server. The dock is a second door onto it, never a second
     copy of it. */
  const { document, window, posts } = dockPage([
    { sale_id: 'a1', sales_id: 'S-1', created_date: minutesAgo(4), cancel_requested: true },
  ]);
  document.getElementById('request-dock-tab').click();
  document.querySelector('[data-do="accept"]').click();
  assert.strictEqual(posts.length, 1, 'the decision never reached the shop');
  assert.strictEqual(posts[0].url, 'sales/a1/approval', 'the dock invented its own endpoint');
  assert.strictEqual(posts[0].body.decision, 'accept');
  window.close();
});

/* ------------------------------------------------------- the server half */

test('a cancellation inside the window is stamped so the shop can be told', () => {
  /* Before this it told the PRINTER and nothing else: notifyKotReady goes
     over the desktop process bus and never reaches a screen. */
  const at = REPO.indexOf('async cancelCustomerOrder');
  assert.ok(at !== -1, 'the customer can no longer cancel their own order');
  const body = REPO.slice(at, at + 4000);
  assert.match(body, /customer_cancelled_at: new Date\(\)/, 'a cancellation leaves no mark for the shop');
  assert.match(body, /cancel_seen: false/, 'nothing says whether anybody has seen it');
});

test('the queue carries a cancelled order until somebody has seen it', () => {
  const at = REPO.indexOf('async pendingOnlineOrders');
  assert.ok(at !== -1, 'the queue is gone');
  const body = REPO.slice(at, at + 3000);
  assert.match(
    body,
    /cancel_seen: false, customer_cancelled_at: \{ \$exists: true \}/,
    'an order the customer called off never appears in the queue'
  );
  assert.match(body, /customer_cancelled_at: 1/, 'the row does not carry the cancellation');
  assert.match(body, /cancel_seen: 1/, 'the row cannot tell a seen one from an unseen one');
});

test('acknowledging a cancelled order is not dressed up as a decision', () => {
  /* It is already cancelled. Two buttons on it would be two ways to be
     confused; either means "I have seen this", and it leaves the queue. */
  const at = REPO.indexOf('async decideOnOrder');
  const body = REPO.slice(at, at + 2500);
  assert.match(body, /sale\.cancel_seen === false && sale\.customer_cancelled_at/, 'a seen cancellation is not recognised');
  assert.match(body, /cancel_seen: true/, 'seeing it does not clear it from the queue');
  assert.match(body, /cancel_seen_at: new Date\(\)/, 'nothing records when it was seen');
});

test('the shell loads the dock, beside the watcher it works with', () => {
  /* A file nothing loads is the quietest failure there is, and this bundle
     has been bitten by exactly that before. */
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'pages_css_js_map.json'), 'utf8'));
  const js = (map.dashboard && map.dashboard.js) || [];
  assert.ok(
    js.includes('static/script/js/core/request-dock.js'),
    'the dock is never loaded, so none of the above happens on a real till'
  );
});
