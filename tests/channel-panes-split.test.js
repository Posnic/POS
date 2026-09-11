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
