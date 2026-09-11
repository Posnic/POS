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
    src.includes('/online-ordering/${encodeURIComponent(branchId)}${servicePoint}`'),
    'the storefront is no longer fetched from the online-ordering resource'
  );

  /* The read has to be made FOR a service point, or a hotel room is quoted
     house prices and only told the marked-up total at checkout. */
  assert.match(src, /KioskServicePoint\.query\(\)/, 'the storefront read lost its service point');
  assert.match(
    src,
    /KioskServicePoint\.orderFields\(\)/,
    'the order no longer says which venue and room it came from'
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
    /* The <base> is the one absolute href that belongs here: it is what makes
       every other reference on the page relative to the mount rather than to
       whatever URL the customer arrived on. Its own value is checked below. */
    const src = readBundle(page).replace(/<base\b[^>]*>/gi, '');
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

test('a page served three segments deep still finds its own assets', () => {
  /*
   * THE PRECONDITION FOR EVERY PRINTED CODE THAT IS NOT JUST THE SHOP.
   *
   *   /order/AZ100                 the shop
   *   /order/AZ100/table/5         its own table five
   *   /order/AZ100/venue/RC/123    Royal Club Hotel, room 123
   *
   * All three are answered with the same index.html. Relative paths resolve
   * against the URL in the address bar, so on the third shape `assets/x.js`
   * would be fetched from /order/AZ100/venue/assets/x.js - a 404 for every
   * script and stylesheet at once. The page still renders its empty shell, so
   * this fails as a blank screen rather than an error anybody reports.
   *
   * The <base> is what stops it. Without one, widening the route guard in
   * app.js silently breaks the routes it was widened to serve.
   */
  for (const page of htmlPages()) {
    const src = readBundle(page);
    const base = src.match(/<base\b[^>]*href\s*=\s*"([^"]*)"/i);
    assert.ok(base, `order/${page} has no <base>, so a venue or table URL will load nothing`);
    assert.strictEqual(base[1], '/order/', `order/${page} points its base somewhere else`);

    /* Before anything that fetches. A <base> after the first stylesheet applies
       to everything except that stylesheet, which is a bug that hides. */
    const firstRef = src.search(/<(?:link|script|img)\b[^>]*(?:src|href)=/i);
    assert.ok(
      firstRef === -1 || src.search(/<base\b/i) < firstRef,
      `order/${page} declares its base after the first asset it loads`
    );
  }

  const menuHtml = fs.readFileSync(path.join(ROOT, 'menu', 'index.html'), 'utf8');
  const menuBase = menuHtml.match(/<base\b[^>]*href\s*=\s*"([^"]*)"/i);
  assert.ok(menuBase, 'menu/index.html has no <base>');
  assert.strictEqual(menuBase[1], '/menu/');
});

test('both bundles answer a table and a venue address, and nothing wider', () => {
  /*
   * The guards in app.js are deliberately not catch-alls. A missing script
   * under these paths has to stay a 404: answer it with index.html and the
   * browser reports a syntax error in a file that is fine, and whoever debugs
   * it spends the evening in the wrong place.
   */
  const src = fs.readFileSync(APP_JS, 'utf8');
  const guards = [...src.matchAll(/const (?:STORE|MENU)_ADDRESS =\s*(\/\^[^\n;]+);/g)];
  assert.strictEqual(guards.length, 2, 'the order and menu route guards moved or merged');

  for (const [, literal] of guards) {
    // eslint-disable-next-line no-eval
    const re = eval(literal);

    for (const good of [
      '/AZ100',
      '/az1',
      '/AZ100/table/5',
      '/AZ100/venue/RC/123',
      '/AZ100/venue/RC',
    ]) {
      assert.ok(re.test(good), `${literal} no longer serves ${good}`);
    }
    for (const bad of [
      '/notafile.js',
      '/toolongtobeastore',
      '/assets/kiosk-core.js',
      '/AZ100/assets/app.js',
      '/AZ100/venue/RC/123/extra',
      '/AZ100/table',
      '/a/b',
    ]) {
      assert.ok(!re.test(bad), `${literal} swallows ${bad}, which should stay a 404`);
    }
  }

  /* `/assets` on its own is six alphanumerics and DOES match, deliberately:
     express.static is mounted first and answers for anything that exists, so
     only paths with no file behind them ever reach these guards. */
  assert.ok(
    src.indexOf("app.use('/order', orderStatic)") < src.indexOf('const STORE_ADDRESS'),
    'the static mount must come first, or real assets get the page instead'
  );
  assert.ok(
    src.indexOf("app.use('/menu', express.static(MENU_BUNDLE") < src.indexOf('const MENU_ADDRESS'),
    'the menu static mount must come first, or real assets get the page instead'
  );
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

test('the page finds its store address in the path, the query, or the default', () => {
  const src = readBundle('assets/index/script.js');
  assert.match(src, /window\.location\.pathname/, 'the path form is no longer read');
  assert.match(src, /get\("branch"\)/, 'the older query form stopped being honoured');
  assert.match(src, /\/online-ordering`/, 'the default-branch lookup is gone');

  /*
   * The dead end this replaced: a spinner that turned forever, driven by an
   * input and a button that had been removed from index.html releases ago.
   *
   * Comments stripped first. The code explains what it replaced and names
   * those elements while doing so, and a test that cannot tell code from prose
   * would read the explanation as a relapse.
   */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const dead of ['branch-id', 'submit-btn']) {
    assert.ok(!code.includes(dead), `${dead} is back, and index.html has no such element`);
  }
});

test('a plain /order resolves to one branch, and refuses to guess between several', () => {
  const controller = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'controllers', 'online-ordering.controller.js'),
    'utf8'
  );
  assert.match(controller, /defaultStorefront/, 'the default storefront handler is gone');
  /* The two failures need different words in front of a customer: a shop that
     never set this up is not a chain that has several branches and named
     none. */
  assert.match(controller, /ambiguous/, 'the several-branches case is no longer told apart');

  const routes = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'routes', 'online-ordering.routes.js'),
    'utf8'
  );
  const rootAt = routes.indexOf("router.get('/'");
  const byIdAt = routes.indexOf("router.get('/:storeId'");
  assert.ok(rootAt !== -1 && byIdAt !== -1, 'the storefront routes moved');
  assert.ok(
    rootAt < byIdAt,
    "'/' must be declared before '/:storeId', or the default lookup 404s as a shop named ''"
  );
});

test('the menu is its own bundle, not the ordering page with the cart hidden', () => {
  /*
   * `/menu` used to be `/order` with a class on <html>. That drags 1,500 lines
   * of IndexedDB, a cart and two payment integrations along to render a list of
   * dishes, and it reads as a shop that has taken its ordering away rather than
   * as a menu.
   */
  const MENU = path.join(ROOT, 'menu');
  for (const f of ['index.html', 'menu.js', 'config.js']) {
    assert.ok(fs.existsSync(path.join(MENU, f)), `menu/${f} is missing`);
  }

  const js = fs.readFileSync(path.join(MENU, 'menu.js'), 'utf8');
  const html = fs.readFileSync(path.join(MENU, 'index.html'), 'utf8');

  /*
   * Read-only means read-only. Nothing here may start an order.
   *
   * Comments stripped first. The file opens by explaining that it has no cart,
   * and a check that cannot tell code from prose reads its own documentation as
   * the violation - which has happened three times in this suite now, so it is
   * worth fixing properly rather than rewording the comment.
   */
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of ['addToCart', 'checkout', 'cart', 'razorpay', 'phonepe']) {
    assert.ok(
      !code.toLowerCase().includes(forbidden.toLowerCase()),
      `menu.js has ${forbidden} in its code; the menu must not be able to order`
    );
  }
  assert.ok(!code.includes('indexedDB'), 'the menu should not carry a database');

  /* And it must not quietly become the order bundle again. */
  const app = fs.readFileSync(APP_JS, 'utf8');
  assert.ok(
    !app.includes("app.use('/menu', orderStatic)"),
    '/menu is being served the ordering bundle again'
  );
  assert.match(app, /app\.use\('\/menu', express\.static\(MENU_BUNDLE/);

  /* The things that make it a good menu rather than a list. */
  assert.match(html, /type="search"/, 'the menu lost its search box');
  assert.match(js, /IntersectionObserver/, 'the category chips no longer follow the reader');
  assert.match(js, /diet-/, 'the veg mark is gone');
  assert.match(html, /prefers-color-scheme/, 'dark mode is gone');
  assert.match(html, /aria-live/, 'the search result count is no longer announced');
});

test('the menu bundle ships with the packaged desktop app', () => {
  /* The community edition is the whole reason this lives in POS rather than a
     repo of its own. A self-hoster gets it at localhost/menu or not at all. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const entry = (pkg.build.extraResources || []).find((e) => e && e.from === 'menu');
  assert.ok(entry, 'package.json build.extraResources has no entry for the menu bundle');
  assert.strictEqual(entry.to, 'menu');
});

test('a shop cannot take a store address this resource already uses', () => {
  /*
   * A store address is 3-6 alphanumerics sitting directly under
   * /online-ordering/, which is where this resource's own sub-paths live. A
   * shop that chose `menu` would answer its own menu route. The clash is
   * invisible until that one shop cannot be reached.
   */
  const { storeIdIsAvailable, RESERVED_STORE_IDS } = require('../api/src/utils/online-ordering');
  assert.ok(RESERVED_STORE_IDS.includes('menu'), 'menu is no longer reserved');
  assert.strictEqual(storeIdIsAvailable('menu'), false);
  assert.strictEqual(storeIdIsAvailable('MENU'), false, 'the check must not be case sensitive');
  assert.strictEqual(storeIdIsAvailable('AZ100'), true);

  const routes = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'routes', 'online-ordering.routes.js'),
    'utf8'
  );
  assert.ok(
    routes.indexOf("router.get('/menu'") < routes.indexOf("router.get('/:storeId'"),
    "'/menu' must be declared before '/:storeId' or a store address swallows it"
  );

  const model = fs.readFileSync(path.join(ROOT, 'api', 'src', 'models', 'setting.model.js'), 'utf8');
  assert.match(
    model,
    /storeIdIsAvailable/,
    'the save path no longer refuses a reserved store address'
  );
});

test('the menu lists what the kitchen cooks, not what is orderable', () => {
  /*
   * The two are different documents. A restaurant lists the dish that is off
   * tonight; a menu with holes in it reads as a kitchen that has run out.
   */
  const repo = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'item.repository.js'),
    'utf8'
  );
  const at = repo.indexOf('async publicMenu');
  const end = repo.indexOf('async storefront');
  assert.ok(at !== -1 && end > at, 'publicMenu has gone or moved after storefront');
  const body = repo.slice(at, end);

  assert.match(body, /show_on_menu: \{ \$ne: false \}/, 'the menu no longer filters on show_on_menu');
  assert.ok(
    !body.includes('ecommerce: true'),
    'the menu is filtering on orderability, which hides dishes that are merely off today'
  );
});

/* ---------------------------------------------------- the menu comes first */

test('a scanned code lands on the menu, not on a question', () => {
  /*
   * Owner: "take away or here no need to ask first itself. first show menu
   * and let him choose in some step." Every route into the bundle used to go
   * through home.html - Dine In or Take Away before a single dish was seen.
   */
  const index = fs.readFileSync(path.join(__dirname, '..', 'order', 'assets', 'index', 'script.js'), 'utf8');
  const db = fs.readFileSync(path.join(__dirname, '..', 'order', 'indexedDB.js'), 'utf8');
  for (const [name, src] of [['index/script.js', index], ['indexedDB.js', db]]) {
    assert.ok(
      !/location\.href\s*=\s*["']home\.html["']/.test(src),
      `${name} still sends a customer to the Dine In / Take Away screen first`
    );
  }
  assert.match(index, /location\.href\s*=\s*["']products\.html["']/, 'index does not go to the menu');
  assert.match(db, /location\.href\s*=\s*["']products\.html["']/, 'the branch fetch does not go to the menu');
});

test('how you are eating is asked at payment, and paying waits for the answer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'order', 'payment.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'order', 'assets', 'payment', 'script.js'), 'utf8');

  assert.match(html, /data-order-type="DINE IN"/, 'no Dine in choice on the payment page');
  assert.match(html, /data-order-type="PARCEL"/, 'no Take away choice on the payment page');

  /* The same key home.html wrote and checkout() reads, so nothing downstream
     had to learn a new name. */
  assert.match(js, /localStorage\.setItem\("orderType"/, 'the choice is not stored where checkout reads it');

  /* Both ways of paying are gated. An order with no type is a ticket the
     kitchen has to guess about. */
  const razorpay = js.slice(js.indexOf('async function submitRazorPayMobile()'));
  const cash = js.slice(js.indexOf('async function performPaymentSubmission()'));
  assert.match(razorpay.slice(0, 120), /ensureOrderType\(\)/, 'Razorpay can pay without an answer');
  assert.match(cash.slice(0, 120), /ensureOrderType\(\)/, 'cash can pay without an answer');

  /* Pre-answered from the code that was scanned: a table means dining in. */
  assert.match(js, /KioskServicePoint\.read/, 'a customer at a table is still asked whether they are eating in');
});

test('an empty product store fetches the menu instead of spinning for ever', () => {
  /*
   * THE SPINNER. loadProducts() logged "No products found in IndexedDB!" and
   * returned, and the only thing that hides the page loader is the cart render
   * at the end of that function. Every first-time visitor saw a wheel.
   */
  const db = fs.readFileSync(path.join(__dirname, '..', 'order', 'indexedDB.js'), 'utf8');
  const fn = db.slice(db.indexOf('async function loadProducts()'));
  const empty = fn.slice(fn.indexOf('storedProducts.length === 0'), fn.indexOf('products = Object.create(null)'));

  assert.match(empty, /fetchAndStoreBranch\(/, 'an empty store still gives up instead of fetching');
  assert.match(empty, /page-loader/, 'the spinner is not taken down when there is nothing to fetch with');
  assert.match(empty, /showAppErrorScreen/, 'a visitor with no branch is left with nothing on screen');
  /* Once. A fetch that finds nothing must not call back into a fetch. */
  assert.match(empty, /_fetching/, 'nothing stops the fetch from recursing');
});
