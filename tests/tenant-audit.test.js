const test = require('node:test');
const assert = require('node:assert');
const { auditBranch, branchExpectations, EXPECTED_COLLECTIONS } =
  require('../scripts/tenant-audit');

/*
 * The gap calculation, tested without a database.
 *
 * That separation is the point: the only place to try this for real is a
 * shop's live data, which is exactly where you do not want to be finding out
 * whether the logic is right.
 */
const EXPECTATIONS = branchExpectations();

function fullBranch() {
  const branch = { _id: '1', branch_name: 'Main' };
  for (const rule of EXPECTATIONS) {
    branch[rule.field] = rule.severity === 'breaks' ? 'something' : 'set';
  }
  return branch;
}

test('a correctly provisioned branch reports nothing', () => {
  assert.deepStrictEqual(auditBranch(fullBranch(), EXPECTATIONS), []);
});

test('a missing receipt body is reported as breaking', () => {
  // No read-time default exists for this one, so absent means a sale prints
  // an empty slip.
  const branch = fullBranch();
  delete branch.thermal_body_print;

  const gaps = auditBranch(branch, EXPECTATIONS);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].field, 'thermal_body_print');
  assert.strictEqual(gaps[0].severity, 'breaks');
});

test('settings with a read-time default are reported as cosmetic', () => {
  // branch.model.js fills these in when it reads, so absent changes nothing.
  // They are counted so the report is honest, not so they get written.
  const branch = fullBranch();
  delete branch.till_lock_enable;
  delete branch.hardware_weight_machine_enable;

  const gaps = auditBranch(branch, EXPECTATIONS);
  assert.strictEqual(gaps.length, 2);
  assert.ok(gaps.every((g) => g.severity === 'cosmetic'));
});

test('empty counts as missing, not as configured', () => {
  // A branch seeded before the template existed has an empty string here, not
  // an absent key - and an empty receipt body prints exactly as badly.
  for (const empty of ['', null, undefined]) {
    const branch = fullBranch();
    branch.thermal_body_print = empty;
    const gaps = auditBranch(branch, EXPECTATIONS);
    assert.ok(gaps.some((g) => g.field === 'thermal_body_print'),
      JSON.stringify(empty) + ' should count as missing');
  }
});

test('an empty array counts as missing', () => {
  const branch = fullBranch();
  branch.currency_value = [];
  assert.ok(auditBranch(branch, EXPECTATIONS).some((g) => g.field === 'currency_value'));
});

test('a value the shop set is never reported', () => {
  // The whole risk of a backfill is overwriting a deliberate choice, so
  // anything present is left entirely alone - including a falsy choice.
  const branch = fullBranch();
  branch.till_lock_enable = false;
  branch.till_lock_idle_minutes = 0;

  const gaps = auditBranch(branch, EXPECTATIONS);
  assert.ok(!gaps.some((g) => g.field === 'till_lock_enable'),
    'false is a decision, not an absence');
  assert.ok(!gaps.some((g) => g.field === 'till_lock_idle_minutes'),
    '0 is a decision, not an absence');
});

test('a branch that does not exist at all is entirely missing', () => {
  const gaps = auditBranch(null, EXPECTATIONS);
  assert.strictEqual(gaps.length, EXPECTATIONS.length);
});

test('the receipt body can actually be sourced', () => {
  // A repair that cannot produce the value it is repairing is worse than no
  // repair, because the report promises a fix that never lands.
  const rule = EXPECTATIONS.find((e) => e.field === 'thermal_body_print');
  const value = rule.value();
  assert.ok(typeof value === 'string' && value.length > 1000,
    'print_standard_html.txt did not load');
  assert.ok(value.includes('print_store_name'), 'that is not the receipt template');
});

test('the expected collections are the ones a shop actually uses', () => {
  for (const name of ['branches', 'users', 'items', 'sales']) {
    assert.ok(EXPECTED_COLLECTIONS.includes(name), name + ' should be expected');
  }
});

test('branches are grouped by the company that owns them', () => {
  // Shops share one database and are separated by a license id, so a report
  // that does not group by it mixes customers together.
  const { groupByLicense } = require('../scripts/tenant-audit');
  const companies = groupByLicense([
    { _id: 'a', license: 'lic1', branch_name: 'Main' },
    { _id: 'b', license: 'lic1', branch_name: 'Second' },
    { _id: 'c', license: 'lic2', branch_name: 'Other shop' },
  ]);

  assert.strictEqual(companies.size, 2);
  assert.strictEqual(companies.get('lic1').length, 2);
  assert.strictEqual(companies.get('lic2').length, 1);
});

test('a branch with no license is not silently merged into another company', () => {
  const { groupByLicense } = require('../scripts/tenant-audit');
  const companies = groupByLicense([
    { _id: 'a', license: 'lic1' },
    { _id: 'b' },
  ]);

  assert.strictEqual(companies.size, 2);
  assert.ok(companies.has('no-license'), 'an unowned branch needs to be visible, not absorbed');
});
