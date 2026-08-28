'use strict';

/*
 * The API stamp, rendered.
 *
 * Every list endpoint dates its rows through api/src/utils/helpers.formatDate,
 * which writes "MM/DD/YYYY hh:mm am/pm". The dashboard renders those through
 * PosnicPro.convertDate, whose format list had no entry for that shape - so
 * non-strict moment guessed, matched DD/MM/YYYY, and chewed across the
 * separator:
 *
 *     "08/09/2026 09:05 am"  ->  20/09/2008   (wrong day AND wrong year)
 *     "08/28/2026 08:59 am"  ->  28/08/2026 12:00 AM   (time thrown away)
 *
 * The owner found it on the login history - "all are 12am only?" - but it hit
 * every screen showing a string_date, sales history included. These pin the
 * two halves of the contract so they cannot drift apart again: the server
 * keeps writing that shape, and the client keeps parsing it exactly rather
 * than guessing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const core = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
const helpers = fs.readFileSync(path.join(ROOT, 'api', 'src', 'utils', 'helpers.js'), 'utf8');

test('the server still writes the stamp the client parses', () => {
  assert.match(
    helpers,
    /\$\{month\}\/\$\{day\}\/\$\{year\} \$\{hoursStr\}:\$\{minutes\} \$\{ampm\}/,
    'formatDate changed shape - convertDate parses MM/DD/YYYY hh:mm am/pm exactly',
  );
});

test('convertDate matches that stamp exactly, before any guessing', () => {
  const exactAt = core.indexOf('var stamp = (typeof date === \'string\')');
  const guessAt = core.indexOf('moment.ISO_8601');
  assert.ok(exactAt > 0, 'the exact-stamp branch is gone - times will render as midnight again');
  assert.ok(exactAt < guessAt, 'the guess list runs first, which is what mangled the dates');
});

/*
 * The regex itself, exercised. Lifted from the source rather than retyped, so
 * a change to the pattern is tested rather than shadowed by a copy.
 */
test('the stamp pattern reads month, day, year and the 12-hour clock', () => {
  const m = core.match(/date\.match\((\/\^\(\\d.*?\/i)\)/);
  assert.ok(m, 'the stamp pattern could not be found in convertDate');
  const re = new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), 'i');

  const parts = '08/09/2026 09:05 am'.match(re);
  assert.ok(parts, 'the API stamp no longer matches - it would fall through to the guesser');
  assert.strictEqual(parts[1], '08', 'month is not the first field (MM/DD, as the server writes)');
  assert.strictEqual(parts[2], '09', 'day is not the second field');
  assert.strictEqual(parts[3], '2026', 'the year is not read whole - this is how 2026 became 2008');
  assert.strictEqual(parts[4], '09', 'the hour is dropped, which is how every row read 12:00 AM');
  assert.strictEqual(parts[5], '05', 'the minute is dropped');
  assert.match(parts[7], /a/i, 'am/pm is dropped, so afternoon sign-ins would read as morning');

  assert.ok(re.test('12/01/2026 06:30 pm'), 'a pm stamp no longer matches');
  /* A bare date must NOT match: user-typed dd/mm/yyyy inputs go through the
     same function, and claiming them here would swap month and day. */
  assert.ok(!re.test('08/09/2026'), 'a bare date matches, which would swap day and month on inputs');
});

test('the rail keeps padding for everything that is not the row table', () => {
  /* The card-body padding is zeroed so the row table reaches the rail edge;
     that zero also flattened the roles note, the stock-log and purchase
     quick-filter strips and the pager, putting text on the border whenever a
     row was selected. Owner reported it three times, once per module - the
     fix is one rule, so the fourth module never becomes the fourth report. */
  const css = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'style', 'css', 'custom.css'), 'utf8');
  assert.match(
    css,
    /\.master-detail > \.md-rail > \.card-body > \*:not\(\.md-rail-rows\)/,
    'the general rail-padding rule is gone - split mode puts text back on the border',
  );
});
