'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {shouldChime} = require('../frontend/static/script/js/core/sales-live');
test('arrival chime respects branch, opt-in, source device and replay identity', () => {
  const seen = new Set();
  const config = {enabled: true, branchId: 'branch-a', deviceId: 'this-till'};
  const event = {newSale: true, branchId: 'branch-a', sourceDeviceId: 'phone', eventId: 'one'};
  assert.equal(shouldChime(event, {...config, enabled: false}, seen), false);
  assert.equal(shouldChime({...event, branchId: 'branch-b'}, config, seen), false);
  assert.equal(shouldChime({...event, sourceDeviceId: 'this-till'}, config, seen), false);
  assert.equal(shouldChime({...event, newSale: false}, config, seen), false);
  assert.equal(shouldChime(event, config, seen), true);
  assert.equal(shouldChime(event, config, seen), false);
});
