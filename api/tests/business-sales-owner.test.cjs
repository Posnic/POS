const test = typeof jest !== 'undefined' ? global.test : require('node:test').test;
const assert = require('node:assert/strict');
const owner = require('../src/helpers/business-sales-owner');
test('an unrelated fallback identity cannot supply the recorded staff name', () => {
  assert.deepEqual(owner({ user_id: 'a', created_by_id: 'b', created_by: 'Other staff' }), {
    id: 'a',
    name: 'Staff name unavailable',
  });
});
test('missing Captain name never falls through to the payment operator', () => {
  assert.deepEqual(
    owner({
      channel: 'tableside',
      client: { staff_id: 'rajan', staff_name: 'undefined' },
      user_name: 'Cashier',
    }),
    { id: 'rajan', name: 'Staff name unavailable' }
  );
});
test('legacy names and absent attribution remain distinguishable', () => {
  assert.deepEqual(owner({ created_by: ' Priya ' }), { id: 'name:Priya', name: 'Priya' });
  assert.deepEqual(owner({ created_by: '[object Object]', updated_by: 'Jack' }), {
    id: 'unassigned',
    name: 'Unassigned',
  });
  assert.notEqual(
    owner({ user_id: 'a', user_name: 'Jack' }).id,
    owner({ user_id: 'b', user_name: 'Jack' }).id
  );
});
