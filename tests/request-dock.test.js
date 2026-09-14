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
/*
 * The body of one method, ending where the method ends.
 *
 * These assertions used to slice a fixed number of characters from the start
 * of the function - 2500, 3000, 4000, 4500 - which works until somebody adds
 * a paragraph of comment and the line being asserted on slides past the cut.
 * That happened: a fix to decideOnOrder's projection carried an explanation
 * with it and this file failed on code that was more correct than before.
 * The test should care where the method ENDS, not how long it is.
 */
function methodBody(source, name) {
  const at = source.indexOf(name);
  assert.ok(at !== -1, name + ' is gone from the repository');
  /* The next method declared at the same indentation, or the end of the
     file. No regex here: two attempts at one lost a backslash on the way
     through a patch script and became a newline inside a literal. */
  const after = source.slice(at + name.length);
  const marks = [String.fromCharCode(10) + '  async ', String.fromCharCode(10) + '  get ', String.fromCharCode(10) + '  static '];
  let cut = -1;
  for (const mark of marks) {
    const found = after.indexOf(mark);
    if (found !== -1 && (cut === -1 || found < cut)) cut = found;
  }
  return cut === -1 ? source.slice(at) : source.slice(at, at + name.length + cut);
}


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
  /* On a CANCELLATION the primary button means the customer's wish, which is
     the order off - not a state transition. This assertion used to read
     'accept' and was wrong in the same way the code was. */
  assert.strictEqual(posts[0].body.decision, 'cancel');
  window.close();
});

/* ------------------------------------------------------- the server half */

test('a cancellation inside the window is stamped so the shop can be told', () => {
  /* Before this it told the PRINTER and nothing else: notifyKotReady goes
     over the desktop process bus and never reaches a screen. */
  const NAME = 'async cancelCustomerOrder';
  assert.ok(REPO.indexOf(NAME) !== -1, 'the customer can no longer cancel their own order');
  const body = methodBody(REPO, NAME);
  assert.match(body, /customer_cancelled_at: new Date\(\)/, 'a cancellation leaves no mark for the shop');
  assert.match(body, /cancel_seen: false/, 'nothing says whether anybody has seen it');
});

test('the queue carries a cancelled order until somebody has seen it', () => {
  const NAME = 'async pendingOnlineOrders';
  assert.ok(REPO.indexOf(NAME) !== -1, 'the queue is gone');
  const body = methodBody(REPO, NAME);
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
  const NAME = 'async decideOnOrder';
  const body = methodBody(REPO, NAME);
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

/*
 * WHAT "YES" MEANS TO THE SERVER, WHICH DEPENDS ON THE KIND.
 *
 * Owner, on a real till: "i see some error. why? when click accept it
 * happend." The error was "unknown state", and it was this: the dock sent
 * "accept" for everything, and for a NEW order the approval state machine
 * wants the state it moves TO - "accepted". It got a word that is not a
 * state, could not name one, and said so.
 *
 * The three kinds genuinely mean three different things, and the queue page
 * has always known it. These pin the mapping on this side.
 */
test('a new order is accepted into a state, not with a verb the machine cannot read', () => {
  const { document, window, posts } = dockPage([
    { sale_id: 'n1', sales_id: 'S-GG69-000017', token_id: 'S570', created_date: minutesAgo(2), fulfilment: 'dine_in' },
  ]);
  document.getElementById('request-dock-tab').click();
  assert.strictEqual(document.querySelector('.request-dock-card').getAttribute('data-kind'), 'new');

  document.querySelector('[data-do="accept"]').click();
  assert.strictEqual(posts[0].body.decision, 'accepted', 'the state machine is handed a word that is not a state');
  window.close();
});

test('a new order is refused into a state too', () => {
  const { document, window, posts } = dockPage([
    { sale_id: 'n1', sales_id: 'S-1', created_date: minutesAgo(2) },
  ]);
  document.getElementById('request-dock-tab').click();
  document.querySelector('[data-do="reject"]').click();
  assert.strictEqual(posts[0].body.decision, 'rejected');
  window.close();
});

test('a cancel request is answered with the customer wish, or with keeping it', () => {
  /* On a cancellation the primary button means the customer's wish, which is
     the order OFF - not a state transition. */
  const order = { sale_id: 'c1', sales_id: 'S-2', created_date: minutesAgo(6), cancel_requested: true };
  const yes = dockPage([order]);
  yes.document.getElementById('request-dock-tab').click();
  yes.document.querySelector('[data-do="accept"]').click();
  assert.strictEqual(yes.posts[0].body.decision, 'cancel');
  yes.window.close();

  const no = dockPage([order]);
  no.document.getElementById('request-dock-tab').click();
  no.document.querySelector('[data-do="reject"]').click();
  assert.strictEqual(no.posts[0].body.decision, 'keep', 'refusing a cancellation must leave the order exactly as it was');
  no.window.close();
});

test('a change request is made so, or kept as it was', () => {
  const order = {
    sale_id: 'h1', sales_id: 'S-3', created_date: minutesAgo(3),
    change_requested: { at: new Date().toISOString(), items: [{ name: 'Veg Biryani', was: 7, quantity: 8 }] },
  };
  const yes = dockPage([order]);
  yes.document.getElementById('request-dock-tab').click();
  yes.document.querySelector('[data-do="accept"]').click();
  assert.strictEqual(yes.posts[0].body.decision, 'accept');
  yes.window.close();

  const no = dockPage([order]);
  no.document.getElementById('request-dock-tab').click();
  no.document.querySelector('[data-do="reject"]').click();
  assert.strictEqual(no.posts[0].body.decision, 'keep');
  no.window.close();
});

test('a shop that says no is quoted, not swallowed', () => {
  /* The first cut ignored the answer and simply re-read the queue, so a
     refusal looked exactly like a success that had not arrived yet - which is
     how "unknown state" went unexplained until it was seen on a real till. */
  const said = [];
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://shop.example/dashboard.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.PosnicPro = {
    t: (k, f) => f,
    get: (o, ok) => ok({ type: 'success', data: [{ sale_id: 'n1', sales_id: 'S-1', created_date: minutesAgo(1) }] }),
    post: (o, ok) => ok({ type: 'error', message: 'unknown state' }),
    alert: (kind, text) => said.push(kind + ': ' + text),
  };
  window.setInterval = () => 0;
  window.eval(DOCK);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.document.getElementById('request-dock-tab').click();
  window.document.querySelector('[data-do="accept"]').click();
  assert.deepStrictEqual(said, ['Alert: unknown state'], 'the shop refused and nobody was told');
  window.close();
});

/*
 * A SHOP WITH ORDERS WAITING HAS SOMEWHERE TO PUT THEM.
 *
 * Owner, looking at a queue full of orders: "menu also not got selected." It
 * was not selected because it was not THERE: the sidebar entry is gated on a
 * local setting written in exactly one place - the Settings page - so a till
 * that has never been there has no value at all, and the entry stays hidden
 * while orders pile up behind it.
 */
test('the sidebar entry appears once there is something in the queue', () => {
  const watch = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'online-order-watch.js'),
    'utf8'
  );
  assert.match(watch, /function makeSureTheQueueIsReachable/, 'nothing reveals the queue entry');
  assert.match(watch, /getElementById\('online_orders_menu'\)/, 'it does not touch the sidebar entry');
  assert.match(watch, /if \(!count\) return;/, 'an empty queue would hide or show it on a whim');
  const at = watch.indexOf('function badge(');
  const body = watch.slice(at, watch.indexOf('\n  }', at));
  assert.match(body, /makeSureTheQueueIsReachable\(count\)/, 'the count is known here and not used');
});

test('an order with no phone number carries none, not the text "+91null"', () => {
  /* Seen on a real approval card: "S-GG69-000017 · Token S570 · +91null".
     Staff read it as a number and cannot ring it. */
  const db = fs.readFileSync(path.join(ROOT, 'order', 'indexedDB.js'), 'utf8');
  assert.match(db, /customerMobile: savedNumber \? '\+91' \+ savedNumber : ''/, 'a missing number is still concatenated into one');
  assert.ok(!/customerMobile: '\+91' \+ savedNumber,/.test(db), 'the old concatenation is still there');
});

/*
 * A DECISION SOMEBODY JUST MADE IS NOT A THING TO TELL THEM ABOUT.
 *
 * Teaching cancelCustomerOrder to stamp an order as "the shop has not been
 * told" was right for a customer cancelling inside the window, and wrong for
 * every other way through it. Accepting a customer's cancellation REQUEST
 * runs through the same function - so the order came straight back into the
 * queue asking to be acknowledged, a second decision on something a person
 * had decided a moment earlier.
 *
 * Found by asking who else calls it, after the new paths passed end to end
 * against the real sandbox. The probe could not see it: it needs the shop's
 * side of the door.
 */
test('a cancellation the shop itself decided is not put back in the queue', () => {
  const NAME = 'async cancelCustomerOrder';
  assert.ok(REPO.indexOf(NAME) !== -1, 'the customer can no longer cancel their own order');
  const body = methodBody(REPO, NAME);
  assert.match(body, /async cancelCustomerOrder\(orderDoc, how = \{\}\)/, 'it cannot be told who decided');
  assert.match(
    body,
    /how\.alreadyKnown \? \{\} : \{ customer_cancelled_at: new Date\(\), cancel_seen: false \}/,
    'it stamps every cancellation, including the ones the shop just made'
  );

  /*
   * And every caller says which it is. Both live inside decideOnOrder, which
   * is long enough that slicing a fixed window past it misses them - so the
   * whole file is searched, and the count is what is asserted: exactly the
   * two shop-side callers, no more and no fewer.
   */
  const told = REPO.match(/alreadyKnown: true/g) || [];
  assert.strictEqual(told.length, 2, 'the shop-side callers are not both saying who decided');
  assert.match(REPO, /cancelCustomerOrder\(sale, \{ alreadyKnown: true \}\)/, 'accepting a cancellation re-queues it');

  /* A change stripped to nothing carries whoever asked for it. */
  assert.match(REPO, /async changeCustomerOrderItems\(orderDoc, wanted, how = \{\}\)/, 'the change path cannot pass it on');
  assert.match(REPO, /cancelCustomerOrder\(orderDoc, how\)/, 'a stripped order forgets who asked');
});

test('a customer cancelling their own order is still announced', () => {
  /* The whole point of the stamp. The service calls it with no flag, which
     means "nobody here knows yet" - and must keep meaning that. */
  const svc = fs.readFileSync(path.join(ROOT, 'api', 'src', 'services', 'customer-order.service.js'), 'utf8');
  assert.match(
    svc,
    /salesRepository\.cancelCustomerOrder\(order\)(?!, \{)/,
    'the customer path now claims the shop already knows, which silences it again'
  );
});

/* ------------------------------------------------------- closing it */

test('the dock can be closed without answering anything', async () => {
  /*
   * Owner: "some way i want close this request right side if i dont want.
   * close button. dont show this close."
   *
   * Without this the only two controls on the panel both decide a customer's
   * order, so "I am busy, go away" had to be spelled as a refusal - which
   * refuses somebody's dinner.
   */
  const { document, window } = dockPage([
    { sale_id: 'a1', sales_id: 'S-1', token_id: 'T1', items: [], total: 100 },
  ]);
  window.PosnicRequestDock.show();

  const close = document.getElementById('request-dock-close');
  assert.ok(close, 'there is no way out of the panel but a decision');

  close.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.strictEqual(window.PosnicRequestDock.isOpen(), false, 'close did not close it');
});

test('and it stays closed when the same requests come round again', async () => {
  /*
   * "dont show this close" - closing has to mean something, or the next poll
   * springs it open and the button is a joke. What is remembered is WHICH
   * requests were waved away, not simply that it was shut.
   */
  const orders = [{ sale_id: 'a1', sales_id: 'S-1', token_id: 'T1', items: [], total: 100 }];
  const { document, window } = dockPage(orders);
  window.PosnicRequestDock.show();
  document
    .getElementById('request-dock-close')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  /* The toast calls show() on every arrival. The same order must not reopen it. */
  window.PosnicRequestDock.show();
  assert.strictEqual(window.PosnicRequestDock.isOpen(), false, 'a dismissed request reopened the dock');
});

test('but a genuinely new order still gets through', async () => {
  /*
   * The other half, and the one that matters more: a shop that waves the
   * panel away and then receives a real order must still be told. Remembering
   * "closed" rather than "closed THESE" would have silenced the feature.
   */
  const orders = [{ sale_id: 'a1', sales_id: 'S-1', token_id: 'T1', items: [], total: 100 }];
  const { document, window } = dockPage(orders);
  window.PosnicRequestDock.show();
  document
    .getElementById('request-dock-close')
    .dispatchEvent(new window.Event('click', { bubbles: true }));

  window.PosnicRequestDock.saw([
    ...orders,
    { sale_id: 'a2', sales_id: 'S-2', token_id: 'T2', items: [], total: 200 },
  ]);
  window.PosnicRequestDock.show();
  assert.strictEqual(window.PosnicRequestDock.isOpen(), true, 'a new order was swallowed');
});
