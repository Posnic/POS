const test = require('node:test');
const assert = require('node:assert');
const { decide, lastTouched, parseArgs } = require('../scripts/migrate-legacy-tenant');

/*
 * The rule that decides whether a legacy record overwrites a live one.
 *
 * This is the whole risk of re-running a migration: the shops have been
 * trading since the first one, so a record that has been edited in the new
 * cluster must not be replaced by the older copy it came from. Getting this
 * wrong takes a shop's work away silently, which is why it is a pure function
 * with tests rather than a condition buried in a loop.
 */
const older = new Date('2026-01-10T10:00:00Z');
const newer = new Date('2026-06-01T10:00:00Z');

test('a record the destination has never seen is written', () => {
  const verdict = decide({ _id: 1, updated_date: older }, null);
  assert.strictEqual(verdict.write, true);
  assert.strictEqual(verdict.reason, 'new');
});

test('a record edited in the new cluster is left alone', () => {
  // The legacy copy is simply out of date. Writing it would undo whatever the
  // shop did after go-live.
  const verdict = decide({ _id: 1, updated_date: older }, { _id: 1, updated_date: newer });
  assert.strictEqual(verdict.write, false);
  assert.strictEqual(verdict.reason, 'newer-in-destination');
});

test('a record still newer in the legacy system is refreshed', () => {
  const verdict = decide({ _id: 1, updated_date: newer }, { _id: 1, updated_date: older });
  assert.strictEqual(verdict.write, true);
});

test('equal timestamps refresh, because nothing is lost by doing so', () => {
  const verdict = decide({ _id: 1, updated_date: older }, { _id: 1, updated_date: older });
  assert.strictEqual(verdict.write, true);
});

test('a dated destination beats an undated source', () => {
  // The new system has written this record and the old one never did.
  const verdict = decide({ _id: 1 }, { _id: 1, updated_date: newer });
  assert.strictEqual(verdict.write, false);
});

test('reference data with no dates on either side is topped up', () => {
  // Units and payment types carry no timestamps and genuinely want filling in.
  const verdict = decide({ _id: 1, unit_name: 'Kilogram' }, { _id: 1, unit_name: 'Kilogram' });
  assert.strictEqual(verdict.write, true);
});

test('the newest of several date fields decides', () => {
  // Legacy rows use updated_date, update_date or only created_date depending
  // on how old they are.
  assert.deepStrictEqual(
    lastTouched({ created_date: older, updated_date: newer }), newer);
  assert.deepStrictEqual(
    lastTouched({ created_date: newer, update_date: older }), newer);
  assert.strictEqual(lastTouched({}), null);
  assert.strictEqual(lastTouched(null), null);
});

test('a date stored as a string still counts', () => {
  // Some legacy rows carry ISO strings rather than BSON dates.
  const verdict = decide(
    { _id: 1, updated_date: '2026-01-10T10:00:00Z' },
    { _id: 1, updated_date: '2026-06-01T10:00:00Z' });
  assert.strictEqual(verdict.write, false, 'string dates must compare like real ones');
});

test('an unparseable date is ignored rather than throwing', () => {
  assert.strictEqual(lastTouched({ updated_date: 'not a date' }), null);
  assert.doesNotThrow(() => decide({ _id: 1, updated_date: 'rubbish' }, { _id: 1 }));
});

test('dry run is the default only when asked for, and --only narrows to one shop', () => {
  assert.strictEqual(parseArgs([]).dry, false);
  assert.strictEqual(parseArgs(['--dry']).dry, true);
  assert.strictEqual(parseArgs(['--only=kiranastore']).only, 'kiranastore');
  assert.strictEqual(parseArgs([]).only, null);
});
