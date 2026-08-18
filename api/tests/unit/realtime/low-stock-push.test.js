'use strict';

/**
 * Low-stock push producer: speaks only when low-stock count GROWS, throttles
 * per shop, respects item-read ACL for recipients, and never notifies when
 * no branch has a notification range configured.
 */

const lowStock = require('../../../src/realtime/low-stock-push');

jest.mock('../../../src/realtime/push', () => ({
  sendToUser: jest.fn().mockResolvedValue({ sent: 1 }),
}));
const push = require('../../../src/realtime/push');

function fakeDb({ range = 5, items = 0, subs = [], users = {}, state = null } = {}) {
  const stateRows = state ? [{ _id: 'low_stock', ...state }] : [];
  return {
    databaseName: 'shop_' + Math.random().toString(36).slice(2),
    _state: stateRows,
    collection(name) {
      const db = this;
      if (name === 'branches') {
        return {
          find: () => ({
            toArray: async () => (range === null ? [] : [{ notification_range: String(range) }]),
          }),
        };
      }
      if (name === 'items') {
        return { countDocuments: async () => items };
      }
      if (name === 'push_state') {
        return {
          findOne: async () => db._state[0] || null,
          updateOne: async (q, u) => {
            if (!db._state[0]) db._state[0] = { _id: 'low_stock' };
            Object.assign(db._state[0], u.$set);
          },
        };
      }
      if (name === 'push_subscriptions') {
        return { find: () => ({ toArray: async () => subs.map((id) => ({ user_id: id })) }) };
      }
      if (name === 'users') {
        return {
          findOne: async (q) => {
            const u = users[String(q._id)];
            return u === undefined ? null : u;
          },
        };
      }
      throw new Error('unexpected collection ' + name);
    },
  };
}

beforeEach(() => {
  lowStock.resetThrottle();
  push.sendToUser.mockClear();
});

test('count grew -> notifies exactly the item-readers', async () => {
  const db = fakeDb({
    items: 3,
    subs: ['u1', 'u2'],
    users: {
      u1: { access: { item: { read: true } } },
      u2: { access: { item: { read: false } } },
    },
    state: { count: 1 },
  });
  const r = await lowStock.maybeNotify(db, { force: true });
  expect(r.notified).toBe(1);
  expect(push.sendToUser).toHaveBeenCalledTimes(1);
  expect(push.sendToUser.mock.calls[0][1]).toBe('u1');
  expect(push.sendToUser.mock.calls[0][2].url).toContain('lowstockitems');
  expect(db._state[0].count).toBe(3);
});

test('flat or falling count stays silent and re-arms', async () => {
  const db = fakeDb({
    items: 2,
    subs: ['u1'],
    users: { u1: { access: { item: { read: true } } } },
    state: { count: 4 },
  });
  const r = await lowStock.maybeNotify(db, { force: true });
  expect(r.notified).toBe(0);
  expect(push.sendToUser).not.toHaveBeenCalled();
  expect(db._state[0].count).toBe(2); // remembered, so the NEXT rise speaks
});

test('no branch range configured -> feature is silent', async () => {
  const db = fakeDb({
    range: null,
    items: 99,
    subs: ['u1'],
    users: { u1: { access: { item: { read: true } } } },
  });
  const r = await lowStock.maybeNotify(db, { force: true });
  expect(r).toEqual({ checked: true, notified: 0 });
  expect(push.sendToUser).not.toHaveBeenCalled();
});

test('throttled per shop: second call inside the window does nothing', async () => {
  const db = fakeDb({ items: 5, subs: [], state: { count: 1 } });
  const t0 = Date.now();
  expect((await lowStock.maybeNotify(db, { now: t0 })).checked).toBe(true);
  expect((await lowStock.maybeNotify(db, { now: t0 + 1000 })).checked).toBe(false);
  expect((await lowStock.maybeNotify(db, { now: t0 + lowStock.CHECK_EVERY_MS + 1 })).checked).toBe(
    true
  );
});

test('a dead subscription never silences the rest', async () => {
  push.sendToUser.mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce({ sent: 1 });
  const db = fakeDb({
    items: 9,
    subs: ['u1', 'u2'],
    users: {
      u1: { access: { item: { read: true } } },
      u2: { access: { item: { read: true } } },
    },
    state: { count: 0 },
  });
  const r = await lowStock.maybeNotify(db, { force: true });
  expect(r.notified).toBe(1);
  expect(push.sendToUser).toHaveBeenCalledTimes(2);
});
