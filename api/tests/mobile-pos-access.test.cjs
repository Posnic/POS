'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { allowed } = require('../src/utils/mobile-pos-access');

test('mobile ACL denies absent, malformed and explicitly denied staff grants', () => {
  for (const user of [
    null,
    {},
    { usertype: 'manager' },
    { usertype: 'store_manager' },
    { access: { sales: { write: 'true' }, pos: { quick_sale: false } } },
  ]) {
    assert.equal(allowed(user, 'sales'), false);
    assert.equal(allowed(user, 'pos', 'quick_sale'), false);
  }
});
test('mobile uses effective user overrides even for managers and requires till approval', () => {
  const user = {
    usertype: 'manager',
    access: {
      sales: { write: true },
      customer: { write: false },
      branch: { write: true },
      pos: { quick_sale: true, void_line: false, reprint_receipt: true },
      pos_manager_approval: ['quick_sale'],
    },
  };
  assert.equal(allowed(user, 'sales'), true);
  assert.equal(allowed(user, 'customer'), false);
  assert.equal(allowed(user, 'settings'), true);
  assert.equal(allowed(user, 'pos', 'void_line'), false);
  assert.equal(allowed(user, 'pos', 'quick_sale'), false);
  assert.equal(allowed(user, 'pos', 'reprint_receipt'), true);
});
test('tenant owner accounts retain the same top-level authority as desktop', () => {
  for (const usertype of ['owner', 'admin', 'super_admin']) {
    assert.equal(allowed({ usertype }, 'sales'), true);
    assert.equal(allowed({ usertype }, 'pos', 'reprint_receipt'), true);
  }
});
