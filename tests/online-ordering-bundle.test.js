'use strict';

/*
 * The shop's online ordering page, as the shop's own process serves it.
 *
 * Everything here is load-bearing and invisible until a customer hits it:
 *
 * 1. The bundle is mounted BEFORE the API router. That router is mounted at
 *    '/', so it sees every path; mount the bundle after it and `/order` stops
 *    being a page and starts being a 404 from the API.
 *
 * 2. Nothing in the bundle names a host. It is served by the shop's own
 *    process, so every call is relative to the page's own origin. A hardcoded
 *    backend is how one server came to answer for every shop in the estate.
 *
 * 3. Every page that talks to the API also loads the channel state. Miss one
 *    and that page shows a working cart for a shop that is closed.
 *
 * 4. The rules that hide the cart point at controls that exist. A stylesheet
 *    full of selectors matching nothing is the quietest possible failure:
 *    everything looks right, and the checkout button is still there.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'order');
const APP_JS = path.join(ROOT, 'api', 'app.js');

const readBundle = (f) => fs.readFileSync(path.join(BUNDLE, f), 'utf8');
const htmlPages = () => fs.readdirSync(BUNDLE).filter((f) => f.endsWith('.html'));

test('the bundle is present with the pages a customer walks through', () => {
  for (const page of ['index.html', 'home.html', 'products.html', 'cart.html', 'payment.html']) {
    assert.ok(fs.existsSync(path.join(BUNDLE, page)), `order/${page} is missing`);
  }
  assert.ok(fs.existsSync(path.join(BUNDLE, 'config.js')));
  assert.ok(fs.existsSync(path.join(BUNDLE, 'assets', 'channel-state.js')));
  assert.ok(fs.existsSync(path.join(BUNDLE, 'assets', 'channel-state.css')));
});

test('/order and /menu are mounted before the root API router', () => {
  const src = fs.readFileSync(APP_JS, 'utf8');

  const orderAt = src.indexOf("app.use('/order'");
  const menuAt = src.indexOf("app.use('/menu'");
  const rootApiAt = src.indexOf("app.use('/', apiRouter)");

  assert.ok(orderAt !== -1, "app.js does not mount '/order'");
  assert.ok(menuAt !== -1, "app.js does not mount '/menu'");
  assert.ok(rootApiAt !== -1, 'the root API router mount moved; this test needs updating');

  assert.ok(
    orderAt < rootApiAt,
    "'/order' is mounted after the root API router, so it will 404 instead of serving the page"
  );
  assert.ok(
    menuAt < rootApiAt,
    "'/menu' is mounted after the root API router, so it will 404 instead of serving the page"
  );
});

test('the bundle ships with the packaged desktop app', () => {
  /* A till serving the shop's own wifi gets online ordering for free, but only
     if the directory is actually packaged. electron-builder copies nothing it
     was not told about. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const entry = (pkg.build.extraResources || []).find((e) => e && e.from === 'order');
  assert.ok(entry, 'package.json build.extraResources has no entry for the order bundle');
  assert.strictEqual(entry.to, 'order');
});

test('the API base is the page origin, with no hardcoded host anywhere', () => {
  const config = readBundle('config.js');
  assert.match(config, /window\.location/, 'config.js no longer reads the page location');
  assert.match(config, /\.origin\b/, 'config.js no longer derives the API base from the origin');

  for (const host of ['api.posnic.io', 'qr.posnic.io']) {
    assert.ok(!config.includes(host), `${host} is back in config.js as a hardcoded fallback`);
  }
});

test('no script in the bundle calls a host of its own', () => {
  /*
   * Every request must be relative to CONFIG.API_BASE_URL, which is the page's
   * own origin. An absolute URL to any host would leave one shop's page talking
   * to another shop's server, which is the failure this estate has already had
   * once and must not repeat.
   *
   * Scripts only. The printed receipt carries "Powered by Posnic" with the
   * company address on it, which is text on a page, not a place anything is
   * fetched from - a sweep that cannot tell those apart teaches people to
   * ignore it.
   */
  const offenders = [];
  for (const file of ['indexedDB.js', 'config.js']) {
    const src = readBundle(file);
    for (const m of src.matchAll(/https?:\/\/[a-z0-9.-]*posnic\.[a-z]+/gi)) {
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  /* And no page may point a script, stylesheet or image at one either. */
  for (const page of htmlPages()) {
    const src = readBundle(page);
    for (const m of src.matchAll(/(?:src|href)\s*=\s*"(https?:\/\/[^"]*posnic\.[^"]*)"/gi)) {
      offenders.push(`${page}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.join('\n'));
});

test('the customer page uses the online-ordering resource', () => {
  /*
   * One resource, addressed by the shop's public store address, replacing three
   * endpoints named after how the customer happened to arrive
   * (`/items/accessQr`, `/items/accesskiosk`, `/sales/qrOrder`).
   */
  const src = readBundle('indexedDB.js');
  assert.ok(
    src.includes('/online-ordering/${encodeURIComponent(branchId)}`'),
    'the storefront is no longer fetched from the online-ordering resource'
  );
  assert.ok(
    src.includes('/online-ordering/${encodeURIComponent(branchId)}/orders`'),
    'orders are no longer posted to the online-ordering resource'
  );
  for (const gone of ['/items/accessQr', '/sales/qrOrder', '/items/accesskiosk']) {
    assert.ok(!src.includes(gone), `${gone} is back; that endpoint no longer exists`);
  }
});

test('every page that reaches the API also loads the channel state', () => {
  /* config.js is what gives a page an API to call. A page that can call the
     API can show a cart, so it must also know whether the shop is open. */
  const missing = [];
  for (const page of htmlPages()) {
    const src = readBundle(page);
    if (!src.includes('src="config.js"')) continue;
    if (!src.includes('assets/channel-state.js')) missing.push(page);
  }
  assert.deepStrictEqual(missing, [], `pages load the API but not the channel state: ${missing}`);
});

test('every control the browse-only rules hide actually exists', () => {
  /*
   * A dead selector hides nothing and says nothing. This walks the rules that
   * hide ordering controls and requires each one to name a class or id that
   * appears somewhere in the bundle - in the static markup, or in the template
   * strings that inject product cards.
   */
  const css = readBundle('assets/channel-state.css');
  const haystack = [
    ...htmlPages().map(readBundle),
    readBundle('indexedDB.js'),
    fs.readFileSync(path.join(BUNDLE, 'assets', 'products', 'script.js'), 'utf8'),
  ].join('\n');

  const selectors = [...css.matchAll(/html\.posnic-browse-only\s+([.#][A-Za-z0-9_-]+)/g)].map(
    (m) => m[1]
  );

  assert.ok(selectors.length >= 5, 'the browse-only stylesheet stopped hiding things');

  const dead = selectors.filter((sel) => {
    const name = sel.slice(1);
    const needle = sel.startsWith('.') ? 'class="' : 'id="';
    /* Loose on purpose: class attributes hold several names, and the product
       card template builds them by concatenation. */
    return !(haystack.includes(name) && haystack.includes(needle));
  });

  assert.deepStrictEqual(dead, [], `browse-only rules match no markup: ${dead.join(', ')}`);
});

test('every local asset a page asks for is in the bundle', () => {
  /*
   * The bundle is served under a subpath (/order/, /menu/) rather than at a
   * host root, so every reference in it has to be relative. An absolute
   * "/assets/..." resolves to the shop's own app - not this bundle - which is a
   * broken page that looks fine in a diff.
   */
  const problems = [];

  for (const page of htmlPages()) {
    const src = readBundle(page);
    const refs = [...src.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

    for (const ref of refs) {
      if (/^(https?:|data:|blob:|mailto:|#|javascript:)/i.test(ref)) continue;

      if (ref.startsWith('/')) {
        problems.push(`${page}: "${ref}" is absolute and will miss the bundle under /order/`);
        continue;
      }

      /* Cache-busting query strings are part of the reference, not the path. */
      const file = ref.split('?')[0].split('#')[0];
      if (!file) continue;
      if (!fs.existsSync(path.join(BUNDLE, file))) {
        problems.push(`${page}: "${file}" does not exist in the bundle`);
      }
    }
  }

  assert.deepStrictEqual(problems, [], problems.join('\n'));
});

test('the order-only pages hand the customer back to the menu', () => {
  const js = readBundle('assets/channel-state.js');
  for (const page of ['cart.html', 'payment.html', 'home.html']) {
    assert.ok(js.includes(`'${page}'`) || js.includes(`"${page}"`), `${page} is not order-only`);
  }
  assert.ok(
    js.includes("location.replace('products.html')") ||
      js.includes('location.replace("products.html")'),
    'a blocked page no longer sends the customer back to the menu'
  );
});

test('the page fails open, because the server is the control', () => {
  /*
   * With no verdict the page behaves as though ordering is on. Being wrong that
   * way costs one refused checkout with a clear message. Being wrong the other
   * way turns every shop into a menu whenever anything hiccups, and nobody
   * hears about the orders that were never placed.
   */
  const js = readBundle('assets/channel-state.js');
  assert.match(
    js,
    /accepting\s*!==\s*false/,
    'the channel state no longer treats an absent verdict as open'
  );
});

test('the self-service machines keep the endpoints they already call', () => {
  /*
   * The machines in shops are a live channel taking real money, and they are
   * deployed: they cannot be updated from here.
   *
   * They place orders through POST /sales/kioskOrder and read their menu
   * through POST /items/accesskiosk. Deleting the second left them able to
   * sell but unable to load a menu, which is the sort of break that shows up
   * as a shop ringing support rather than as a failing test. Both stay, both
   * behind the kiosk key.
   */
  const items = fs.readFileSync(path.join(ROOT, 'api', 'src', 'routes', 'items.routes.js'), 'utf8');
  const sales = fs.readFileSync(path.join(ROOT, 'api', 'src', 'routes', 'sales.routes.js'), 'utf8');

  assert.match(
    items,
    /router\.post\('\/accesskiosk',\s*ensureKioskKey/,
    'the machines lost their menu endpoint, or it lost its kiosk-key guard'
  );
  assert.match(
    sales,
    /router\.post\('\/kioskOrder',\s*ensureKioskKey/,
    'the machines lost their order endpoint, or it lost its kiosk-key guard'
  );
});

test('the self-service report counts both channels, history included', () => {
  /*
   * A machine sale is a `kiosk` order and a customer's own phone an `online`
   * one. The report covers both, which is why naming it after either alone is
   * wrong. Narrow this list and a whole channel silently stops being reported:
   * no error, the totals just get smaller.
   *
   * All three queries go through channelFilter rather than testing
   * `sale_method` themselves, because that is what also reaches the years of
   * sales written before `channel` existed.
   */
  const repo = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );
  const matches =
    repo.match(/salesChannels\.channelFilter\(salesChannels\.SELF_SERVICE_CHANNELS\)/g) || [];
  assert.strictEqual(
    matches.length,
    3,
    `the self-service reports no longer count both channels (${matches.length} of 3 queries)`
  );

  /* And the set is the two of them, not one. */
  const { SELF_SERVICE_CHANNELS, CHANNEL } = require('../api/src/utils/sales-channels');
  assert.deepStrictEqual(SELF_SERVICE_CHANNELS, [CHANNEL.KIOSK, CHANNEL.ONLINE]);
});

test('every order path records which channel it came from', () => {
  /*
   * A sale with no channel is invisible to every channel report, and there is
   * nothing to see: it looks like a sale that simply did not happen. The kiosk
   * path used to store whatever `sale_method` the machine sent and nothing
   * else, so a machine that forgot the field wrote a sale nobody could count.
   */
  const paths = {
    'api/src/models/sale.model.js': 'the kiosk machine',
    'api/src/repositories/sale.repository.js': 'the online storefront',
    'api/src/services/sale.service.js': 'the till and the captain app',
  };
  for (const [file, what] of Object.entries(paths)) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /salesChannels\.describeSale\(/,
      `${what} no longer records a channel (${file})`
    );
  }
});

test('the channels settings group exists and owns its two keys', () => {
  const { GROUPS, groupOf } = require('../api/src/services/settings-groups');
  assert.ok(GROUPS.channels, 'the channels settings group is gone');
  assert.strictEqual(groupOf('sales_channels_enabled'), 'channels');
  assert.strictEqual(groupOf('sales_channel_partners'), 'channels');
});
