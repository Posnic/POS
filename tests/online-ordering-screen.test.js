'use strict';

/**
 * The Online Ordering storefront tab, driven rather than read.
 *
 * WHY THIS EXISTS.
 *
 * Every bug the owner found walking these screens passed `node --check`,
 * passed eslint, and passed a suite of tests that read the source as text. A
 * handler bound to a tab id that was deleted. A gate that disabled the thing it
 * should have enabled. A button that announced success having saved nothing.
 * Reading source cannot see any of those; clicking can.
 *
 * So this builds the markup, loads the real module out of the real file, clicks
 * the real buttons and asserts on what a shopkeeper would actually see. It
 * replaces most of "somebody needs to walk the screen" - not all of it. It
 * cannot see a control that is invisible, mispositioned or unreadable.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'frontend');
const read_ = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const SETTINGS = path.join(ROOT, 'static/script/js/modules/js/settings.js');
const SETTINGS_JS = fs.readFileSync(SETTINGS, 'utf8');

/** Comments out, strings untouched, so a brace counter can be trusted. */
function stripComments(src) {
  let out = '';
  let inString = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') {
        out += next;
        i += 1;
      } else if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
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
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** The `{ ... }` that follows a marker, balanced. */
function literalAfter(src, marker) {
  const start = src.indexOf(marker);
  assert.notStrictEqual(start, -1, `${marker} is gone or was renamed`);
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
  return assert.fail(`could not find the end of ${marker}`);
}

/** A `X = function (...) { ... };` assignment, whole. */
function assignedFunction(src, name) {
  const start = src.indexOf(`${name} = function`);
  assert.notStrictEqual(start, -1, `${name} is gone or was renamed`);
  const from = src.indexOf('{', start);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1) + ';';
    }
  }
  return assert.fail(`could not find the end of ${name}`);
}

const MARKUP = `<!doctype html><html><body>
  <span id="storefront_url_prefix"></span>
  <input type="text" id="kioskstore_id" value="">
  <div id="storefront_links_row" style="display:none;">
    <input type="text" id="storefront_order_url" readonly>
    <input type="text" id="storefront_menu_url" readonly>
    <button class="copy-storefront-link" data-target="storefront_order_url"></button>
    <a class="storefront-open" data-target="storefront_menu_url" href="#"></a>
  </div>

  <div class="kiosk-ordering-only">
    <span id="kiosk_pause_status" class="badge badge-pill"></span>
    <span id="kiosk_pause_unsaved" style="display:none;"></span>
    <div id="kiosk_pause_actions">
      <button class="kiosk-pause-btn" data-minutes="30"></button>
      <button class="kiosk-pause-btn" data-minutes="60"></button>
      <button class="kiosk-pause-btn" data-minutes="0" id="btn_stop"></button>
    </div>
    <div id="kiosk_resume_actions" style="display:none;">
      <button id="kiosk_pause_resume"></button>
    </div>
    <input type="hidden" id="kiosk_paused_until" name="kiosk_paused_until">
    <input type="checkbox" id="kiosk_hours_enable">
    <div id="kiosk_hours_grid"></div>
    <small id="kiosk_hours_help"></small>
  </div>
</body></html>`;

function screen({ apiUrl = 'https://tea.posnic.io' } = {}) {
  const dom = new JSDOM(MARKUP, { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(ROOT, 'static/script/js/jquery.min.js'), 'utf8'));

  const calls = { alerts: [], opened: [] };
  window.API_URL = apiUrl;
  window.open = (url) => calls.opened.push(url);
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback || key },
    alert: (kind, text) => calls.alerts.push({ kind, text }),
    settings: {},
  };

  const src = stripComments(fs.readFileSync(SETTINGS, 'utf8'));

  /*
   * stripComments does not understand regex literals, and a regex ending in an
   * escaped slash finishes with two of them - which it reads as the start of a
   * line comment and eats the rest of the line. That produced five tests
   * failing with "Invalid regular expression: missing /", which says nothing
   * about the cause. Check the lifted text parses, and say what happened.
   */
  const lift = (label, code) => {
    try {
      new window.Function(code);
    } catch (e) {
      assert.fail(
        `${label} did not survive being lifted out of settings.js: ${e.message}. ` +
          'Most likely a regex literal the comment stripper mangled - one ending in ' +
          'an escaped slash looks like the start of a comment to it.'
      );
    }
    window.eval(code);
  };

  lift('onlineOrdering', 'PosnicPro.settings.onlineOrdering = ' + literalAfter(src, 'onlineOrdering: {') + ';');
  lift('storefrontLinks', assignedFunction(src, 'PosnicPro.settings.storefrontLinks'));

  /* The real delegated handlers, lifted from the real file - a handler bound to
     the wrong selector is exactly what this is here to catch. */
  const handlers = [...src.matchAll(/\$\(document\)\.on\(\s*(['"][^'"]+['"]),\s*(['"][^'"]+['"])[\s\S]*?\n\}\);/g)]
    .map((m) => m[0])
    .filter((b) => /kiosk-pause-btn|kiosk_pause_resume|kioskstore_id|storefront/.test(b));
  assert.ok(handlers.length >= 3, `expected the screen's handlers, found ${handlers.length}`);
  window.eval(handlers.join('\n'));

  return { window, calls, $: window.$, oo: window.PosnicPro.settings.onlineOrdering };
}

/* --------------------------------------------------------------- addresses */

test('no store id, no addresses to print', () => {
  /* An address with a blank where the code goes is worse than none: somebody
     copies it onto a table tent. */
  const { window, $ } = screen();
  window.PosnicPro.settings.storefrontLinks();
  assert.strictEqual($('#storefront_links_row').css('display'), 'none');
});

test('a store id gives a shop both of its addresses', () => {
  const { window, $ } = screen();
  $('#kioskstore_id').val('AZ100');
  window.PosnicPro.settings.storefrontLinks();

  assert.notStrictEqual($('#storefront_links_row').css('display'), 'none');
  assert.strictEqual($('#storefront_order_url').val(), 'https://tea.posnic.io/order/AZ100');
  assert.strictEqual($('#storefront_menu_url').val(), 'https://tea.posnic.io/menu/AZ100');
});

test('the addresses follow the box as it is typed', () => {
  /* Otherwise they are right only after a reload nobody thinks to do. */
  const { $ } = screen();
  $('#kioskstore_id').val('QR7').trigger('input');
  assert.strictEqual($('#storefront_order_url').val(), 'https://tea.posnic.io/order/QR7');

  $('#kioskstore_id').val('Q').trigger('input');
  assert.strictEqual($('#storefront_links_row').css('display'), 'none', 'a half-typed code still offers an address');
});

test('a trailing slash on the server address does not double up', () => {
  const { window, $ } = screen({ apiUrl: 'https://tea.posnic.io/' });
  $('#kioskstore_id').val('AZ100');
  window.PosnicPro.settings.storefrontLinks();
  assert.strictEqual($('#storefront_order_url').val(), 'https://tea.posnic.io/order/AZ100');
});

test('opening an address opens the one that was asked for', () => {
  const { window, calls, $ } = screen();
  $('#kioskstore_id').val('AZ100');
  window.PosnicPro.settings.storefrontLinks();
  $('.storefront-open').click();

  assert.deepStrictEqual(calls.opened.slice(0, 1), ['https://tea.posnic.io/menu/AZ100']);
});

/* ------------------------------------------------------------ taking orders */

test('a shop that is accepting is offered only the ways to stop', () => {
  const { $, oo } = screen();
  oo.renderPause('');

  assert.match($('#kiosk_pause_status').text(), /Accepting/);
  assert.ok($('#kiosk_pause_status').hasClass('badge-success'));
  assert.notStrictEqual($('#kiosk_pause_actions').css('display'), 'none');
  assert.strictEqual($('#kiosk_resume_actions').css('display'), 'none', 'Resume is offered to a shop that never stopped');
});

test('a paused shop is offered only the way back', () => {
  const { $, oo } = screen();
  const until = new Date(Date.now() + 30 * 60000).toISOString();
  oo.renderPause(until);

  assert.match($('#kiosk_pause_status').text(), /Paused until/);
  assert.ok($('#kiosk_pause_status').hasClass('badge-danger'));
  assert.strictEqual($('#kiosk_pause_actions').css('display'), 'none');
  assert.notStrictEqual($('#kiosk_resume_actions').css('display'), 'none');
});

test('a pause that has already run out is not a pause', () => {
  /* Stored times outlive their meaning - yesterday's "rest of today" must read
     as accepting, or a shop comes in to a screen saying it is closed. */
  const { $, oo } = screen();
  oo.renderPause(new Date(Date.now() - 60000).toISOString());
  assert.match($('#kiosk_pause_status').text(), /Accepting/);
});

test('stopping orders says it is not saved yet, and stores the time to save', () => {
  /*
   * THE ONE THAT MATTERED. The old button showed a SUCCESS toast having stored
   * nothing, so a kitchen under water could read it as done and walk away with
   * orders still arriving.
   */
  const { $ } = screen();
  $('#btn_stop').click();

  const until = $('#kiosk_paused_until').val();
  assert.ok(until, 'stopping orders did not record a time for the save to send');
  assert.ok(new Date(until).getTime() > Date.now(), 'the pause is already in the past');

  assert.notStrictEqual($('#kiosk_pause_unsaved').css('display'), 'none', 'nothing says the pause is unsaved');
  assert.strictEqual($('#kiosk_pause_actions').css('display'), 'none');
  assert.notStrictEqual($('#kiosk_resume_actions').css('display'), 'none');
});

test('a 30 minute pause ends in about 30 minutes, not at midnight', () => {
  const { $ } = screen();
  $('.kiosk-pause-btn[data-minutes="30"]').click();
  const minutes = (new Date($('#kiosk_paused_until').val()).getTime() - Date.now()) / 60000;
  assert.ok(minutes > 28 && minutes < 31, `paused for ${Math.round(minutes)} minutes`);
});

test('resuming clears the pause and says that is unsaved too', () => {
  const { $ } = screen();
  $('#btn_stop').click();
  $('#kiosk_pause_resume').click();

  assert.strictEqual($('#kiosk_paused_until').val(), '', 'resuming left a pause time behind to be saved');
  assert.match($('#kiosk_pause_status').text(), /Accepting/);
  assert.notStrictEqual($('#kiosk_pause_unsaved').css('display'), 'none');
});

test('the hours help hides with the grid it explains', () => {
  const { $, oo } = screen();

  oo.syncMode();
  assert.strictEqual($('#kiosk_hours_grid').css('display'), 'none');
  assert.strictEqual($('#kiosk_hours_help').css('display'), 'none', 'a grid nobody can see is still being explained');

  $('#kiosk_hours_enable').prop('checked', true);
  oo.syncMode();
  assert.notStrictEqual($('#kiosk_hours_grid').css('display'), 'none');
  assert.notStrictEqual($('#kiosk_hours_help').css('display'), 'none');
});

test('there is no menu-only mode; the ordering controls are always shown', () => {
  /*
   * The "can customers order from this page" dropdown is gone. /order takes
   * orders and /menu shows the menu, both live whenever online ordering is
   * on; stopping orders is the button. So there is nothing that hides these.
   */
  const { $, oo } = screen();
  oo.syncMode();
  assert.notStrictEqual($('.kiosk-ordering-only').css('display'), 'none');
});

test('a store id arriving from the server draws the addresses too', () => {
  /*
   * The load path sets the box with `$("#kioskstore_id").val(store_id)`, and
   * .val() fires no event - so the 'input change' handler that keeps the
   * addresses current while somebody types does not run for it.
   *
   * Clicking through the sidebar happens to work, because the click handler
   * fires after the settings have loaded. Opening #/settings/onlineordering
   * directly does not: the pane is shown before the data arrives, the box is
   * empty at that moment, and nothing runs again afterwards. A shop with a
   * store id saved months ago would see no addresses at all.
   *
   * Static, because the load path needs the whole settings page. What it
   * checks is precise: the call sits with the assignment it depends on.
   */
  const src = fs.readFileSync(SETTINGS, 'utf8');
  const at = src.indexOf('$("#kioskstore_id").val(store_id);');
  assert.notStrictEqual(at, -1, 'the store id is no longer loaded the way this test expects');

  const after = src.slice(at, at + 600);
  assert.match(
    after,
    /storefrontLinks\(\)/,
    'the store id loads without drawing the addresses, so a direct link to Online Ordering shows none'
  );
});

/* ------------------------------------------------- saving before loading */

/** The channels module on a page whose rows have not been filled. */
function channelsModule({ loads = true, values = {} } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="sales_channel_partner_rows"></div>
       <div id="webshop_partner_rows"></div>
       <div id="partner_venue_rows"></div>
       <div id="channel_charge_rows"></div>
       <input id="online_ordering_default_store" value="">
       <select id="online_order_approval"><option value="auto" selected>auto</option></select>
       <input type="hidden" id="kiosk_paused_until">
     </body></html>`,
    { runScripts: 'outside-only' }
  );
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(ROOT, 'static/script/js/jquery.min.js'), 'utf8'));

  const sent = [];
  window.PosnicPro = {
    i18n: { t: (k, f) => f || k },
    alert: () => {},
    local: { set: () => {}, get: () => '' },
    applyOrderQueueVisibility: () => {},
    get: (params, ok, fail) => (loads ? ok({ data: { values } }) : fail()),
    put: (params) => sent.push(JSON.parse(params.data)),
  };

  const src = stripComments(fs.readFileSync(SETTINGS, 'utf8'));
  window.eval('PosnicPro.salesChannels = ' + literalAfter(src, 'PosnicPro.salesChannels = {') + ';');
  return { window, sent, sc: window.PosnicPro.salesChannels };
}

test('a save before anything loaded does not claim the shop has no partners', () => {
  /*
   * THE SHAPE THIS CODEBASE HAS PAID FOR TWICE.
   *
   * Every key in collect() is read out of the DOM. If the settings request is
   * still in flight, or failed, the containers are empty - and a Save would
   * post "no partners, no venues, no charges" and erase all three. Exactly how
   * menu_dayparts nearly went, and how sales_channels_enabled would have gone.
   */
  const { sc } = channelsModule({ loads: false });
  sc.load();

  const payload = sc.payload();
  assert.ok(!('sales_channel_partners' in payload), 'an unloaded screen claims the shop has no partners');
  assert.ok(!('partner_venues' in payload), 'an unloaded screen claims the shop has no venues');
  assert.ok(!('channel_charges' in payload), 'an unloaded screen claims the shop has no delivery charges');

  /* What the screen genuinely does own still goes. */
  assert.ok('online_order_approval' in payload);
});

test('once the rows are on screen the save speaks for them again', () => {
  const { sc, window } = channelsModule({
    loads: true,
    values: {
      sales_channel_partners: [{ id: 'swiggy', label: 'Swiggy', channel: 'marketplace', commission_percent: 22 }],
    },
  });
  sc.load();

  const payload = sc.payload();
  assert.ok('sales_channel_partners' in payload, 'a loaded screen no longer saves its partners');
  assert.strictEqual(payload.sales_channel_partners.length, 1);
  assert.strictEqual(payload.sales_channel_partners[0].label, 'Swiggy');
  assert.strictEqual(payload.sales_channel_partners[0].commission_percent, 22);

  /* And the aggregator was drawn on the apps screen, not the webshop one. */
  assert.strictEqual(window.$('#sales_channel_partner_rows .channel-partner-row').length, 1);
  assert.strictEqual(window.$('#webshop_partner_rows .channel-partner-row').length, 0);
});

test('a webshop partner is drawn on the webshop screen', () => {
  const { sc, window } = channelsModule({
    loads: true,
    values: {
      sales_channel_partners: [
        { id: 'swiggy', label: 'Swiggy', channel: 'marketplace' },
        { id: 'my_shop', label: 'My shop', channel: 'ecommerce' },
      ],
    },
  });
  sc.load();

  assert.strictEqual(window.$('#sales_channel_partner_rows .channel-partner-row').length, 1);
  assert.strictEqual(window.$('#webshop_partner_rows .channel-partner-row').length, 1);

  /* One list underneath, so a save from either screen still writes both. */
  assert.strictEqual(sc.payload().sales_channel_partners.length, 2);
});

test('the box spells out the address it is filling in', () => {
  /*
   * "Store id" on an empty field asks for a value whose purpose, source and
   * shape are all unstated. The owner's words, looking at it: "what fucking
   * store id you looking for?" Showing this shop's real address beside the box
   * turns the question into "finish this link", which anybody can answer.
   */
  const { window, $ } = screen({ apiUrl: 'https://tea.posnic.io' });
  window.PosnicPro.settings.storefrontLinks();
  assert.strictEqual($('#storefront_url_prefix').text(), 'tea.posnic.io/order/');
});

test('the prefix is this shop, not a placeholder domain', () => {
  const { window, $ } = screen({ apiUrl: 'https://kirana.example.com/' });
  window.PosnicPro.settings.storefrontLinks();
  assert.strictEqual($('#storefront_url_prefix').text(), 'kirana.example.com/order/');
});

test('every save says "order", so a shop saved as menu-only heals', () => {
  /* The server keeps a known word rather than whatever a missing element
     answers, and the old menu-only value is replaced the first time the shop
     presses Save. */
  const { oo } = screen();
  assert.strictEqual(oo.collect().mode, 'order');
});

test('the storefront tab reads the field the server actually stores', () => {
  /*
   * THE BUG: "it forgot what i saved last time."
   *
   * The branch's channel was renamed from `kiosk` - an Array of one - to
   * `online_ordering`, an object, because one reader treated it as an array
   * and another as an object and that refused every order ever placed. The
   * WRITE moved. This read did not.
   *
   * `data.kiosk` was undefined, so the tab saw {} and every storefront value
   * came back empty however many times the shop had saved it. The store id
   * box was blank, which also hid the two addresses that depend on it.
   *
   * Worse than forgetting: collect() reads those same empty boxes, so opening
   * the tab and pressing Save wrote the blanks back over the stored mode,
   * pause and opening hours.
   *
   * Nothing failed anywhere. An absent field reads as {}, and {} reads as
   * "not set".
   */
  const at = SETTINGS_JS.indexOf('var kioskData');
  assert.notStrictEqual(at, -1, 'the storefront read is no longer a shape this test can find');
  const read = SETTINGS_JS.slice(at, at + 400);

  assert.match(
    read,
    /data\.online_ordering/,
    'the storefront tab still reads `kiosk`, the field that was renamed away'
  );

  /* The model is the other end of the contract: if the field is renamed
     again, this fails rather than the screen silently emptying. */
  const model = read_('api', 'src', 'models', 'branch.model.js');
  assert.match(
    model,
    /online_ordering: \{ type: Schema\.Types\.Mixed/,
    'the branch no longer stores online_ordering under that name'
  );
});
