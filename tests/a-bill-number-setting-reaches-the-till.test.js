'use strict';

/*
 * A setting is five files, and any one of them missing is a control that
 * silently does nothing.
 *
 * Owner: "we need year pattern required in the sales bill number example
 * attached have 26 in the year", and "i accept recommandation and may
 * configurable if people from EU and international."
 *
 * The chain a branch setting has to complete, in order:
 *
 *   1. the control            frontend/modules/settings_write.html
 *   2. load it and send it    frontend/static/script/js/modules/js/settings.js
 *   3. write it               api/src/models/setting.model.js
 *   4. STORE AND RETURN IT    api/src/models/branch.model.js
 *   5. read it                api/src/repositories/sale.repository.js
 *
 * Four of those five fail loudly when they are missing. The fourth does not:
 * branch.model.js has a schema AND a projection, and a field in the schema but
 * not the projection is written perfectly, never read back, and reads to
 * everybody as "the setting did not save". That is the link this file exists
 * for; the others are here because a chain is only worth checking whole.
 *
 * Asserted against the sources rather than a running screen because the
 * failure is structural - a missing key in a map - and the map is the thing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Sources are CRLF on Windows; normalised so a pattern anchored on a newline
   matches here exactly as it does on a runner. */
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const MARKUP = read('frontend/modules/settings_write.html');
const SCREEN = read('frontend/static/script/js/modules/js/settings.js');
const WRITE = read('api/src/models/setting.model.js');
const BRANCH = read('api/src/models/branch.model.js');
const GROUPS = read('api/src/services/settings-groups.js');
const READER = read('api/src/repositories/sale.repository.js');
const CONTROLLER = read('api/src/controllers/settings.controller.js');

const FIELDS = ['bill_number_reset', 'bill_number_fy_start_month'];

/* ------------------------------------------------------------- 1. the control */

test('there is a control, on the settings page and not on the Features list', () => {
  /* Owner rule: the Features list is switches only, never a control in a
     module card. This belongs beside the sale prefix, which is what it
     changes the shape of. */
  assert.match(MARKUP, /id="bill_number_reset"/, 'no control for the bill number year');
  assert.match(MARKUP, /name="bill_number_reset"/, 'the control has no name to post under');
  assert.match(MARKUP, /id="bill_number_fy_start_month"/);

  const near = MARKUP.indexOf('id="bill_number_reset"') - MARKUP.indexOf('id="sales_prefix"');
  assert.ok(near > 0 && near < 4000, 'the year is not beside the prefix it changes');

  /* The three choices, and no fourth: anything the API does not know is
     stored as off, and a control offering one would be a lie. */
  for (const choice of ['value=""', 'value="financial"', 'value="calendar"']) {
    assert.ok(MARKUP.includes(choice), `the control cannot be set to ${choice}`);
  }
});

/* --------------------------------------------------- 2. loaded, and sent back */

test('THE SCREEN BOTH LOADS IT AND SENDS IT, because one without the other is a ghost', () => {
  /*
   * Loading without sending is a control that forgets on save. Sending
   * without loading is a control that shows the wrong thing every time the
   * page opens and then saves that wrong thing over the real one - the worse
   * of the two, because it destroys the setting rather than ignoring it.
   */
  for (const field of FIELDS) {
    assert.match(
      SCREEN,
      new RegExp(`\\$\\('#${field}'\\)\\.val\\(\\s*\\n?`),
      `${field} is never loaded into the screen`
    );
    assert.match(
      SCREEN,
      new RegExp(`${field}: \\$\\('#${field}'\\)\\.val\\(\\)`),
      `${field} is never sent when the settings are saved`
    );
  }
});

test('the months are filled in from the browser, not from seventeen packs', () => {
  /* Twelve month names in seventeen languages is a hundred and ninety-nine
     hand-typed strings duplicating something every browser already knows. */
  assert.match(SCREEN, /toLocaleString\([\s\S]{0,40}month: 'long'/);
  assert.ok(
    !/<option value="4"[^>]*>April<\/option>/.test(MARKUP),
    'the month names are hard-coded English again'
  );
});

/* ------------------------------------------------------------- 3. written */

test('the write path stores it, and refuses to invent a value', () => {
  assert.match(WRITE, /bill_number_reset:/, 'the setting is never written');
  /* Presence-gated: this endpoint also takes small partial payloads, and one
     that does not mention the year must not switch it off. */
  assert.match(WRITE, /data\.bill_number_reset !== undefined/);
  assert.match(WRITE, /\['financial', 'calendar'\]\.includes\(/,
    'an unrecognised value is not being flattened to off');
  /* And the partial-save map, or a full save drops it on the floor. */
  assert.match(WRITE, /bill_number_reset: 'bill_number_reset'/);
  assert.match(WRITE, /bill_number_fy_start_month: 'bill_number_fy_start_month'/);
});

test('and a typo is refused at the door rather than corrected in silence', () => {
  assert.match(CONTROLLER, /bill_number_reset must be off, financial or calendar/);
  assert.match(CONTROLLER, /bill_number_fy_start_month must be a month, 1 to 12/);
});

/* --------------------------------------- 4. THE LINK THAT FAILS SILENTLY */

test('IT IS IN THE PROJECTION AS WELL AS THE SCHEMA, which is the one that hides', () => {
  /*
   * branch.model.js declares the field twice: once as schema, once in the
   * list of what a read hands back. A field in the schema alone is written
   * perfectly and never read, so the screen reopens showing the default and
   * every person who touched it reports that the setting does not save.
   *
   * Nothing throws. Nothing logs. It is the quietest bug in this codebase and
   * this assertion is the whole reason this file exists.
   */
  for (const field of FIELDS) {
    const schema = new RegExp(`${field}: \\{ type: (String|Number)`);
    const projection = new RegExp(`${field}: \\{ type: '(String|Number)', select: true \\}`);
    assert.match(BRANCH, schema, `${field} is not in the branch schema`);
    assert.match(BRANCH, projection, `${field} is stored but never read back`);
  }
});

test('a new branch is created with the year off', () => {
  /*
   * Ninety shops are mid-year with a running series on their invoices.
   * Switching them over on an upgrade would change the shape of every number
   * overnight and restart the count in the middle of a year, which is the one
   * thing an auditor reads a series for.
   */
  assert.match(BRANCH, /bill_number_reset: '',/, 'a new branch starts with the year on');
  assert.match(BRANCH, /bill_number_fy_start_month: 4,/);
  assert.match(BRANCH, /bill_number_reset: \{ type: String, default: '' \}/);
});

test('it belongs to a settings group, or the grouped endpoints never carry it', () => {
  for (const field of FIELDS) {
    assert.ok(GROUPS.includes(`'${field}'`), `${field} is in no settings group`);
  }
});

/* --------------------------------------------------------------- 5. read */

test('AND SOMETHING ACTUALLY READS IT, which is the point of all of the above', () => {
  assert.match(READER, /branchDoc && branchDoc\.bill_number_reset/,
    'nothing reads the setting, so the control does nothing');
  assert.match(READER, /bill_number_fy_start_month/);
  /* Read where the bill number is made, not somewhere it can be forgotten. */
  const period = READER.indexOf('this._billPeriod(branchDoc)');
  const generate = READER.indexOf('async generateSalesIdForBranch');
  assert.ok(period > generate, 'the period is not worked out where the number is made');
});

test('THE TILL AND THE ORDERING PAGE COME THROUGH ONE DOOR', () => {
  /*
   * The bug this nearly shipped with.
   *
   * sale.service.js - the counter sale, which is most of the bills in the
   * estate - took a number from the counter and formatted it ITSELF, while
   * the customer's ordering page called generateSalesIdForBranch. Both draw
   * on the SAME counter. A shop that turned the financial year on would have
   * got the year on its online orders and not on its counter bills, and the
   * moment the year reset that counter to one, the till would have started
   * reissuing numbers it had already given out - caught only by the unique
   * index, as a failed sale in front of a customer.
   *
   * So the service asks for the whole number. If it ever goes back to taking
   * a count and building its own, this says so.
   */
  const SERVICE = read('api/src/services/sale.service.js');
  assert.ok(
    !/salesRepository\.buildDocNumber\(/.test(SERVICE),
    'the till is formatting its own bill number again'
  );
  assert.ok(
    !/salesRepository\.nextSalesNumberForBranch\(/.test(SERVICE),
    'the till is taking a bare count again'
  );
  const asks = (SERVICE.match(/salesRepository\.generateSalesIdForBranch\(/g) || []).length;
  assert.strictEqual(asks, 2, `the service asks for a bill number ${asks} times, expected 2`);
});

test('the clock it reads is the SHOP\'S, not the server\'s', () => {
  /*
   * A bill rung up at half past midnight on the first of April in Chennai
   * belongs to the new financial year. A cloud instance running in UTC would
   * still call it March and number it into a year that closed an hour ago.
   */
  /* The method's own body, not the line that calls it - which is earlier in
     the file and would slice the wrong function entirely. */
  const method = READER.slice(READER.indexOf('_billPeriod(branchDoc, when'));
  const body = method.slice(0, method.indexOf('\n  }\n'));
  assert.match(body, /normalizeTimeZone\(branchDoc && branchDoc\.time_zone\)/);
  assert.match(body, /moment\(when\)\.tz\(zone\)/);
});

/* ------------------------------------------------------- what it says */

test('every word the control uses can be said in every language', () => {
  /*
   * The coverage ratchet catches this in aggregate; this names the keys, so
   * a failure says which sentence is missing rather than that a pack slipped
   * a point.
   */
  const block = MARKUP.slice(
    MARKUP.indexOf('id="bill_number_reset"') - 2000,
    MARKUP.indexOf('id="bill_number_fy_start_month"') + 2000
  );
  const keys = [...block.matchAll(/class="(lang_[a-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 6, `only ${keys.length} translatable words on the control`);

  const english = JSON.parse(read('languages/_english.json'));
  const packs = fs
    .readdirSync(path.join(ROOT, 'languages'))
    .filter((name) => /^[a-z]{2}\.json$/.test(name));
  assert.ok(packs.length >= 17, `only ${packs.length} language packs found`);

  for (const key of keys) {
    assert.ok(english[key], `${key} has no English`);
    for (const pack of packs) {
      const words = JSON.parse(read('languages', pack));
      assert.ok(words[key], `${key} is missing from ${pack}`);
    }
  }
});
