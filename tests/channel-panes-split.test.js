'use strict';

/**
 * Each channel gets its own settings page, named the way a shopkeeper names it.
 *
 * WHAT THIS EXISTS FOR.
 *
 * The Features page was split into one card per channel - Online Ordering,
 * Kiosk Machine, Delivery Partners, Webshop - and shipped. The settings behind
 * those cards were not. All five cards pointed at the same old `#/settings/kiosk`
 * page, still headed "Sales Channels", and the code said so out loud:
 *
 *     All five point at the one channels page for now.
 *     The Features page is split; the settings pages behind it are not, yet.
 *
 * Which is honest, and completely invisible from the outside. The owner opened
 * the console, saw the same combined page he had asked us to take apart, and
 * had no way to tell a half-finished split from a deploy that had not landed.
 * A comment is not a signal; a failing test is.
 *
 * So this pins the finished shape: every channel has its own pane, its own
 * sidebar entry, its own module gate, and no two of them share a page. It also
 * pins the wipe guard that the split made necessary.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SETTINGS_JS = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js');
const SETTINGS_HTML = read('frontend', 'modules', 'settings_write.html');
const SIDEBAR = read('frontend', 'layouts', 'sidebar.html');
const CORE_JS = read('frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js');

/**
 * The channels that earn their own page, and the section each one owns.
 *
 * The Captain app was the one exception for a while - its card pointed at
 * Restaurant, on the grounds that it runs on the tables Restaurant manages.
 * Defensible, and it left the one thing a shop actually has to do with a
 * handset unreachable: the pairing screen the API serves at /pair, which
 * nothing in the console linked to. A channel with somewhere to send people
 * earns a page.
 */
const CHANNELS = [
  { module: 'module_online_ordering_enable', section: 'onlineordering' },
  { module: 'module_kiosk_enable', section: 'kioskmachine' },
  { module: 'module_captain_enable', section: 'captainapp' },
  { module: 'module_delivery_partners_enable', section: 'deliverypartners' },
  { module: 'module_webshop_enable', section: 'webshop' },
];

/** [module key, route key] for every feature card that names a home. */
function featureHomes() {
  const block = SETTINGS_JS.match(/PosnicPro\.settings\.FEATURE_HOME = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'FEATURE_HOME is no longer a literal this test can read');
  return [...block[1].matchAll(/(\w+):\s*\['([\w-]+)'/g)].map((m) => [m[1], m[2]]);
}

/** Every pane id the settings markup actually defines. */
function panes() {
  return new Set([...SETTINGS_HTML.matchAll(/id="v-pills-([a-z0-9-]+)"/g)].map((m) => m[1]));
}

test('every channel has a settings pane of its own', () => {
  const defined = panes();
  const missing = CHANNELS.filter((c) => !defined.has(c.section)).map((c) => c.section);
  assert.deepStrictEqual(
    missing,
    [],
    `these channels have a feature card but no settings pane: ${missing.join(', ')}`
  );
});

test('no two channels are sent to the same page', () => {
  /* The exact failure this replaces: all five cards pointed at 'kiosk', so
     opening any of them showed the same combined screen. */
  const homes = new Map(featureHomes());
  const seen = new Map();
  const shared = [];

  for (const { module } of CHANNELS) {
    const where = homes.get(module);
    assert.ok(where, `${module} has no Configure link, so its card leads nowhere`);
    if (seen.has(where)) shared.push(`${seen.get(where)} and ${module} both open #/settings/${where}`);
    seen.set(where, module);
  }

  assert.deepStrictEqual(shared, [], shared.join('\n  '));
});

test('each channel card opens the channel it names', () => {
  const homes = new Map(featureHomes());
  const wrong = CHANNELS.filter(({ module, section }) => homes.get(module) !== section).map(
    ({ module, section }) => `${module} -> ${homes.get(module)}, expected ${section}`
  );
  assert.deepStrictEqual(wrong, [], wrong.join('\n  '));
});

test('no feature card points at a section that does not exist', () => {
  /*
   * The generic form of the same bug, and the reason the old code pointed all
   * five at `kiosk` rather than at the pages it wanted: openSection falls back
   * to Core Settings for a key it does not know, so a card aimed at a missing
   * pane takes somebody somewhere wrong with nothing to say it went wrong.
   */
  const defined = panes();
  const dangling = featureHomes()
    .filter(([, where]) => !defined.has(where))
    .map(([module, where]) => `${module} -> #/settings/${where}`);

  assert.deepStrictEqual(
    dangling,
    [],
    `a feature's Configure link lands on Core Settings instead:\n  ${dangling.join('\n  ')}`
  );
});

test('each channel has its own entry in the Manage sidebar', () => {
  const missing = CHANNELS.filter((c) => !SIDEBAR.includes(`id="manage_sec_${c.section}"`)).map(
    (c) => c.section
  );
  assert.deepStrictEqual(missing, [], `no sidebar entry for: ${missing.join(', ')}`);
});

test('each channel entry follows its own feature switch', () => {
  /*
   * Not the derived roof. module_channels_enable is true when ANY channel is
   * on, so gating the four entries on it would show a shop the Webshop page
   * because it turned the kiosk on.
   */
  const wrong = [];
  for (const { module, section } of CHANNELS) {
    const sidebarGate = new RegExp(`#manage_li_${section}'\\)\\.toggle\\(on\\('${module}'\\)`);
    const pillGate = new RegExp(`#v-pills-${section}-tab'\\)\\.toggle\\(on\\('${module}'\\)`);
    if (!sidebarGate.test(CORE_JS)) wrong.push(`sidebar entry ${section} is not gated on ${module}`);
    if (!pillGate.test(SETTINGS_JS)) wrong.push(`pill ${section} is not gated on ${module}`);
  }
  assert.deepStrictEqual(wrong, [], wrong.join('\n  '));
});

test('the old combined page is gone, and its address still works', () => {
  assert.ok(
    !/id="v-pills-kiosk"/.test(SETTINGS_HTML),
    'the combined Sales Channels pane is still in the markup'
  );
  assert.ok(
    !/lang_module_channels">Sales Channels/.test(SIDEBAR),
    '"Sales Channels" is still the name of a sidebar entry; it is our reporting word, not a shopkeeper\'s'
  );
  /* Old bookmarks and the desktop app still say #/settings/kiosk. Landing them
     on Core Settings would read as the page being broken. */
  assert.match(
    SETTINGS_JS,
    /kiosk: 'onlineordering'/,
    '#/settings/kiosk no longer routes anywhere, so every old link lands on Core Settings'
  );
});

test('the split cannot wipe the channels a shop chose', () => {
  /*
   * THE TRAP THE SPLIT SET, and the third time this codebase has met it.
   *
   * The "ways this shop takes orders" checkboxes went, because the Features
   * cards are where channels are chosen now. collect() read those checkboxes
   * into `sales_channels_enabled`. Left alone, every save would have posted an
   * empty list and cleared the value that decides which channels an item can
   * be taken off - silently, the way menu_dayparts nearly was.
   *
   * The group endpoint writes only the keys it is given, so the fix is to send
   * none. This asserts the key stays unsent while its markup is absent.
   */
  const hasCheckboxes = /class="[^"]*sales-channel-box/.test(SETTINGS_HTML);
  const collects = /sales_channels_enabled:/.test(SETTINGS_JS);

  assert.strictEqual(
    hasCheckboxes,
    collects,
    hasCheckboxes
      ? 'the channel checkboxes are back but the save no longer sends them, so the screen cannot save'
      : 'collect() still sends sales_channels_enabled, but nothing draws those checkboxes - every save posts an empty list and wipes the stored value'
  );
});

test('a save from any channel screen still writes the whole group', () => {
  /*
   * The panes are hidden, not removed, and collect() reads the DOM by class -
   * so one save writes every channel's rows wherever they sit. That is what
   * keeps the split from losing data, and it only holds while every screen
   * goes through the one save.
   */
  const forms = ['online_orders_form', 'delivery_partners_form', 'webshop_partners_form'];
  const bound = SETTINGS_JS.match(/\$\(document\)\.on\(\s*'submit',\s*'([^']+)'/g) || [];
  const all = bound.join(' ');
  const unbound = forms.filter((f) => !all.includes(f));
  assert.deepStrictEqual(
    unbound,
    [],
    `these channel forms have no save handler: ${unbound.join(', ')}`
  );
});

test('venues and delivery charges did not get buried in one channel', () => {
  /*
   * A hotel is reachable from the QR code, the phone and every aggregator, and
   * a delivery charge belongs to HOW the food travels rather than to which app
   * the order came through. Both sit with the serving periods on Restaurant.
   */
  const restaurant = SETTINGS_HTML.slice(
    SETTINGS_HTML.indexOf('id="v-pills-tableorder"'),
    SETTINGS_HTML.indexOf('id="v-pills-onlineordering"')
  );
  assert.ok(restaurant.length > 0, 'the Restaurant pane no longer precedes the channel panes');
  assert.match(restaurant, /id="partner_venue_rows"/, 'venues are not on the Restaurant page');
  assert.match(restaurant, /id="channel_charge_rows"/, 'delivery charges are not on the Restaurant page');
});

test('the products screen exists once, and every channel can borrow it', () => {
  /* Four copies would mean four sets of the same ids, and a duplicate id is
     how a screen starts writing to the wrong form. */
  const copies = (SETTINGS_HTML.match(/id="channel_items_rows"/g) || []).length;
  assert.strictEqual(copies, 1, `the products screen is duplicated ${copies} times`);

  const hosts = (SETTINGS_HTML.match(/class="channel-products-host"/g) || []).length;
  assert.strictEqual(hosts, CHANNELS.length, `${hosts} panes can show the products screen, wanted ${CHANNELS.length}`);

  assert.match(SETTINGS_JS, /lendProducts/, 'nothing moves the products screen into the open pane');
});

test('the captain app page can actually reach the pairing screen', () => {
  /*
   * THE REASON THIS PAGE EXISTS.
   *
   * Setting up a handset means pointing a phone at this shop, and the screen
   * that does it is served by the API at /pair - deliberately a plain page
   * outside this bundle so it works on a till mid-setup with no internet.
   * Nothing in the console linked to it, so the feature shipped findable only
   * by being told about it.
   */
  assert.match(
    SETTINGS_HTML,
    /id="open_pairing_screen"/,
    'the Captain App page has no link to the pairing screen, which is the one thing it is for'
  );

  const app = read('api', 'app.js');
  assert.match(
    app,
    /app\.use\(\['\/pair', '\/api\/pair'\]/,
    'the API no longer serves /pair, so the console link goes nowhere'
  );

  /*
   * Built from API_URL, never a relative path. The packaged desktop build
   * serves this console from file://, where "/pair" resolves to the filesystem
   * root and the link silently does nothing - the same trap dashboard.js
   * documents for its runtime-info fetch.
   */
  const handler = SETTINGS_JS.match(/#open_pairing_screen'[\s\S]{0,400}?\n\}\);/);
  assert.ok(handler, 'nothing handles a click on the pairing link');
  assert.match(
    handler[0],
    /API_URL/,
    'the pairing link is built from a relative path, so it does nothing in the desktop build'
  );
});

test('no handler is bound to a tab that no longer exists', () => {
  /*
   * THE BUG THIS EXISTS FOR, FOUND BY THE OWNER AND NOT BY THIS SUITE.
   *
   * "What it sells" came up empty and its Show button found nothing. The
   * screen was fine; its loader was bound to '#channels-tab-line', the tab id
   * of the combined page the split deleted. A delegated handler on an id that
   * does not exist is not an error - jQuery simply never fires it - so the
   * feature read as broken with nothing anywhere to say why.
   *
   * dead-selectors.js cannot see this shape: it matches $('#id'), and a
   * delegated binding is $(document).on('click', '#id', fn). Tab ids are
   * always static markup, never built at runtime, so demanding they exist is
   * a rule with no false positives.
   */
  const bound = new Set();
  for (const m of SETTINGS_JS.matchAll(/\.on\(\s*'[^']+'\s*,\s*'([^']+)'/g)) {
    for (const part of m[1].split(',')) {
      const id = part.trim().match(/^#([\w-]+(?:-tab-line|-tab))$/);
      if (id) bound.add(id[1]);
    }
  }

  const dead = [...bound].filter((id) => !SETTINGS_HTML.includes(`id="${id}"`));
  assert.deepStrictEqual(
    dead,
    [],
    `these handlers wait on a tab that is not in the markup, so they never run: ${dead.join(', ')}`
  );
});

test('the item page offers the channels the shop switched on', () => {
  /*
   * It used to filter by `sales_channels_enabled` - the checkbox list on the
   * page the split deleted. With the markup gone the value is whatever was
   * last stored, usually nothing, and "nothing" meant "offer all eight",
   * including the channels this shop had turned off on the Features page.
   */
  const items = read('frontend', 'static', 'script', 'js', 'modules', 'js', 'items.js');

  assert.match(items, /liveChannels: function/, 'nothing works out which channels this shop runs');
  assert.doesNotMatch(
    items,
    /values\.sales_channels_enabled/,
    'the item channel picker still reads the setting whose screen was removed'
  );

  /* Every channel with a feature switch is gated on it; the three without one
     are always offered, because they need no setting up. */
  for (const key of [
    'module_kiosk_enable',
    'module_captain_enable',
    'module_online_ordering_enable',
    'module_delivery_partners_enable',
    'module_webshop_enable',
  ]) {
    assert.ok(items.includes(key), `the item picker ignores ${key}`);
  }
});

test('a shop can find its own two addresses', () => {
  /*
   * A shop that had just set a store id had no way to learn what to print on
   * the table: the addresses existed only in the shape of the URL. Both are
   * shown, because /order and /menu are two pages rather than two modes - and
   * stopping orders has to leave the menu standing.
   */
  assert.match(SETTINGS_HTML, /id="storefront_order_url"/, 'the ordering address is not shown');
  assert.match(SETTINGS_HTML, /id="storefront_menu_url"/, 'the menu address is not shown');

  const fn = SETTINGS_JS.match(/storefrontLinks = function[\s\S]*?\n\};/);
  assert.ok(fn, 'nothing fills the address boxes');
  assert.match(fn[0], /API_URL/, 'the addresses are built from a relative path, which dies in the desktop build');
  assert.match(fn[0], /\/order\/'/, 'the ordering address is not /order/<store id>');
  assert.match(fn[0], /\/menu\/'/, 'the menu address is not /menu/<store id>');
});

test('razorpay is enabled by having a key, not by failing to save one', () => {
  /*
   * The gate was inverted. A SUCCESSFUL save of the gateway key ran
   * prop('disabled', true) and a FAILED one ran prop('disabled', false), so
   * storing a working key locked the option and a rejected key unlocked it.
   * That is why it showed greyed out on a shop that had configured it.
   */
  const save = SETTINGS_JS.match(/url: 'setting\/paymentsKey'[\s\S]*?\n    \},/);
  assert.ok(save, 'the gateway key save is no longer a shape this test can read');

  const success = save[0].match(/if \(response\.type === 'success'\)\s*\{([\s\S]*?)\n            \} else \{([\s\S]*?)\n            \}/);
  assert.ok(success, 'the save no longer branches on success');

  assert.match(
    success[1],
    /disabled',\s*false/,
    'saving a gateway key still disables the payment method it unlocks'
  );
  assert.match(
    success[2],
    /disabled',\s*true/,
    'a failed key save still leaves Razorpay offered to customers'
  );
});

test('every settings link in the markup lands on a real page', () => {
  /*
   * The same rule as the FEATURE_HOME check, over the links written by hand.
   *
   * openSection falls back to Core Settings for a key it does not recognise,
   * so a link to a page that is not there does not break - it quietly takes
   * somebody somewhere else.
   *
   * What this catches and what it does not: a link to a page that does not
   * EXIST fails here. A link to a real page that no longer holds the thing it
   * promises does not, and cannot - the Captain App page pointed its voice
   * ordering link at Integrations one commit before voice moved to Features,
   * and Integrations is a real page, so only reading it caught that. Worth
   * having anyway: the cheap half of the problem is the half that ships.
   */
  const defined = panes();
  /* Old addresses that route on purpose - openSection redirects these. */
  const legacy = new Set(
    [...SETTINGS_JS.matchAll(/^\s*(\w+): '([\w-]+)',?\s*$/gm)]
      .filter(() => true)
      .map((m) => m[1])
      .filter((k) => SETTINGS_JS.includes(`LEGACY_SECTIONS`) && ['branches', 'outlet', 'kiosk'].includes(k))
  );

  const dangling = [];
  for (const m of SETTINGS_HTML.matchAll(/href="#\/settings\/([\w-]+)"/g)) {
    if (!defined.has(m[1]) && !legacy.has(m[1])) dangling.push(m[1]);
  }

  assert.deepStrictEqual(
    [...new Set(dangling)],
    [],
    `these links land on Core Settings instead of where they say: ${[...new Set(dangling)].join(', ')}`
  );
});
