'use strict';

/**
 * Unit tests for src/realtime/event-bus.js (S2).
 *
 * The properties that matter: tenant isolation (one shop's events never
 * reach another's tills), the subscriber cap refusing excess instead of
 * degrading the process, cleanup on unsubscribe, and a dead connection
 * never breaking fan-out to the healthy ones.
 */

const bus = require('../../../src/realtime/event-bus');

const fakeRes = () => ({
  lines: [],
  write(l) {
    this.lines.push(l);
  },
});

afterEach(() => bus.resetForTests());

describe('event-bus', () => {
  test('publishes to every subscriber of the tenant', () => {
    const a = fakeRes();
    const b = fakeRes();
    bus.subscribe('shop_one', a);
    bus.subscribe('shop_one', b);
    const delivered = bus.publish('shop_one', { type: 'change', entity: 'sales' });
    expect(delivered).toBe(2);
    expect(a.lines[0]).toContain('"entity":"sales"');
    expect(b.lines[0]).toBe(a.lines[0]);
  });

  test("one shop's events never reach another's tills", () => {
    const mine = fakeRes();
    const theirs = fakeRes();
    bus.subscribe('shop_one', mine);
    bus.subscribe('shop_two', theirs);
    bus.publish('shop_one', { type: 'change', entity: 'items' });
    expect(mine.lines.length).toBe(1);
    expect(theirs.lines.length).toBe(0);
  });

  test('unsubscribe stops delivery and empties the tenant', () => {
    const res = fakeRes();
    const sub = bus.subscribe('shop_one', res);
    sub.unsubscribe();
    expect(bus.publish('shop_one', { type: 'change', entity: 'sales' })).toBe(0);
    expect(bus.subscriberCount('shop_one')).toBe(0);
  });

  test('the cap refuses the excess connection, not the process', () => {
    for (let i = 0; i < bus.MAX_SUBSCRIBERS_PER_TENANT; i++) {
      expect(bus.subscribe('shop_one', fakeRes()).ok).toBe(true);
    }
    const refused = bus.subscribe('shop_one', fakeRes());
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('full');
  });

  test('a subscriber whose write throws does not break fan-out to the rest', () => {
    const dead = {
      write() {
        throw new Error('EPIPE');
      },
    };
    const alive = fakeRes();
    bus.subscribe('shop_one', dead);
    bus.subscribe('shop_one', alive);
    const delivered = bus.publish('shop_one', { type: 'change', entity: 'sales' });
    expect(delivered).toBe(1);
    expect(alive.lines.length).toBe(1);
  });

  test('no tenant in scope refuses the subscription', () => {
    expect(bus.subscribe('', fakeRes()).ok).toBe(false);
  });
});
