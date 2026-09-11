'use strict';

/*
 * The venue and charge rows on the channels settings tab, rendered and read
 * back.
 *
 * WHY THIS IS A RENDERING TEST AND NOT A UNIT TEST.
 *
 * `venueRow()` writes markup and `collect()` reads it back by class name. The
 * two are a private contract between two functions two hundred lines apart,
 * and nothing else in the repository checks it: rename `.venue-markup` in one
 * of them and the settings screen still draws, still saves, and silently
 * stores every hotel with a zero markup. There is no error, no red, and the
 * first sign is an invoice that does not match.
 *
 * The dead-selector sweep does not cover this - it checks ids against markup,
 * and these are classes on markup that does not exist until a shop adds a row.
 *
 * So: build the rows the way the screen builds them, read them back the way
 * the save reads them, and assert the numbers survive the trip.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', 'frontend');

/** A page with jQuery, the settings module, and the two containers it fills. */
function screen() {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <div id="partner_venue_rows"></div>
       <div id="channel_charge_rows"></div>
       <select id="online_order_approval">
         <option value="auto"></option><option value="manual"></option>
       </select>
       <input id="online_ordering_default_store" value="">
       <div id="sales_channels_list"></div>
       <div id="sales_channel_partner_rows"></div>
     </body></html>`,
    { runScripts: 'outside-only' }
  );

  const { window } = dom;
  window.eval(fs.readFileSync(path.join(ROOT, 'static/script/js/jquery.min.js'), 'utf8'));

  /* Only what the channels block touches. The settings module is 8,000 lines
     of screens this test has no opinion about. */
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback || key },
    local: { get: () => '', set: () => {} },
    dayparts: { render: () => {}, collect: () => [] },
    get: () => {},
    put: () => {},
    alert: () => {},
    applyOrderQueueVisibility: () => {},
  };

  const src = fs.readFileSync(path.join(ROOT, 'static/script/js/modules/js/settings.js'), 'utf8');
  const block = extractChannels(src);
  window.eval('PosnicPro.salesChannels = ' + block + ';');

  return window;
}

/*
 * Across the realm boundary.
 *
 * Objects built inside jsdom have jsdom's Object.prototype, so deepStrictEqual
 * reports "same structure but not reference-equal" for two things that are in
 * every way the same. Round-tripping through JSON brings them home.
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * The salesChannels object, lifted out of the settings module.
 *
 * Cut by brace depth from its own assignment rather than by a line range: line
 * numbers move every time somebody edits a screen above it, and a test that
 * silently cuts the wrong block is worse than no test.
 */
function extractChannels(source) {
  /* Comments first. They are full of apostrophes - "the shop's own floor" -
     and a brace counter that reads one as the start of a string runs to the
     end of the file and finds nothing. */
  const src = stripComments(source);

  const start = src.indexOf('PosnicPro.salesChannels = {');
  assert.ok(start !== -1, 'PosnicPro.salesChannels is gone or was renamed');

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
  assert.fail('could not find the end of the salesChannels object');
}

/** Comments out, string literals left exactly as they are. */
function stripComments(src) {
  let out = '';
  let inString = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];

    if (inString) {
      out += c;
      if (c === '\\') {
        out += next === undefined ? '' : next;
        i += 1;
      } else if (c === inString) inString = null;
      continue;
    }

    if (c === "'" || c === '"') {
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
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 1;
      out += ' ';
      continue;
    }

    out += c;
  }
  return out;
}

const ROYAL = {
  code: 'rc',
  name: 'Royal Club Hotel',
  unit_label: 'Room',
  address: '12 Beach Road',
  delivery_note: 'Use the service lift',
  ask_floor: true,
  price_adjust_percent: 10,
  commission_percent: 8,
  enabled: true,
};

test('a venue drawn on the screen is the venue that gets saved', () => {
  const window = screen();
  window.PosnicPro.salesChannels.renderVenues([ROYAL]);
  const saved = window.PosnicPro.salesChannels.collect().partner_venues;

  assert.strictEqual(saved.length, 1, 'the row rendered but the save could not read it');
  /* Every field, because each one that fails to round-trip fails silently and
     each one is somebody's money or somebody's dinner. */
  assert.deepStrictEqual(plain(saved[0]), ROYAL);
});

test('the markup and the commission stay two different numbers', () => {
  /* The failure this guards: one field read into both, so a shop that marks up
     12 and pays 10 quietly starts paying 12. */
  const window = screen();
  window.PosnicPro.salesChannels.renderVenues([
    { ...ROYAL, price_adjust_percent: 12, commission_percent: 10 },
  ]);
  const saved = window.PosnicPro.salesChannels.collect().partner_venues[0];
  assert.strictEqual(saved.price_adjust_percent, 12);
  assert.strictEqual(saved.commission_percent, 10);
});

test('a code is normalised the way a printed QR carries it', () => {
  const window = screen();
  window.PosnicPro.salesChannels.renderVenues([{ ...ROYAL, code: 'Royal-Club' }]);
  /* Same normalisation the server does, or "RC " and "rc" become two venues
     and a hotel's month arrives as two half-totals. */
  assert.strictEqual(window.PosnicPro.salesChannels.collect().partner_venues[0].code, 'royalclub');
});

test('a half-filled row is dropped rather than saved as a nameless venue', () => {
  const window = screen();
  window.PosnicPro.salesChannels.renderVenues([ROYAL, { code: '', name: '' }]);
  assert.strictEqual(window.PosnicPro.salesChannels.collect().partner_venues.length, 1);
});

test('every fulfilment gets a fee row, and each row saves its own numbers', () => {
  const window = screen();
  window.PosnicPro.salesChannels.renderCharges({
    delivery: { fee: 40, free_above: 500, min_order: 150 },
  });

  const charges = window.PosnicPro.salesChannels.collect().channel_charges;
  assert.deepStrictEqual(Object.keys(charges).sort(), [
    'delivery',
    'dine_in',
    'pickup',
    'takeaway',
  ]);
  assert.deepStrictEqual(plain(charges.delivery), { fee: 40, free_above: 500, min_order: 150 });
  /* A fulfilment the shop charges nothing for is zeros, not absent: absent
     would read on the server as "not configured" and is a different thing. */
  assert.deepStrictEqual(plain(charges.dine_in), { fee: 0, free_above: 0, min_order: 0 });
});

test('the approval mode saves as one of exactly two words', () => {
  const window = screen();
  window.$('#online_order_approval').val('manual');
  assert.strictEqual(window.PosnicPro.salesChannels.collect().online_order_approval, 'manual');

  window.$('#online_order_approval').val('auto');
  assert.strictEqual(window.PosnicPro.salesChannels.collect().online_order_approval, 'auto');
});
