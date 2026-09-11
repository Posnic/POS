'use strict';

/**
 * Unit tests for src/utils/item-channels.js
 *
 * The direction of the model is the thing worth pinning. Storing which
 * channels an item IS on means a new channel sells nothing until somebody
 * edits every item; storing the exceptions means a new channel sells
 * everything and a shop records only what is different. Several of these tests
 * exist to stop that flipping back.
 */

const {
  availableOn,
  channelFilter,
  normalizeHours,
  normalizeOff,
  setChannel,
} = require('../../../src/utils/item-channels');

describe('an item is sold everywhere unless it says otherwise', () => {
  test('an item that has never been configured is on every channel', () => {
    /* The common case, and the one that must cost a shop nothing. */
    expect(availableOn({}, 'online').available).toBe(true);
    expect(availableOn({}, 'swiggy').available).toBe(true);
    expect(availableOn({ channel_off: [] }, 'kiosk').available).toBe(true);
  });

  test('a channel in the exception list is refused, and says why', () => {
    const item = { channel_off: ['online'] };
    expect(availableOn(item, 'online')).toMatchObject({
      available: false,
      reason: 'not_on_channel',
    });
    /* Off one channel is not off the others. */
    expect(availableOn(item, 'kiosk').available).toBe(true);
  });

  test('the query for "what does this channel sell" matches the unconfigured', () => {
    /* $ne rather than an $in on a list of channels: absent has to mean
       included, or a shop with two hundred items sells nothing until it has
       edited all of them. */
    expect(channelFilter('online')).toEqual({ channel_off: { $ne: 'online' } });
    expect(channelFilter('')).toEqual({});
  });
});

describe('per-channel hours', () => {
  const lunch = { channel_hours: { online: { from: '11:00', to: '15:00' } } };

  test('inside the window it sells, outside it does not', () => {
    expect(availableOn(lunch, 'online', 12 * 60).available).toBe(true);
    expect(availableOn(lunch, 'online', 16 * 60)).toMatchObject({
      available: false,
      reason: 'outside_channel_hours',
    });
  });

  test('the window is closed at the far end, so 15:00 is already over', () => {
    expect(availableOn(lunch, 'online', 15 * 60).available).toBe(false);
    expect(availableOn(lunch, 'online', 11 * 60).available).toBe(true);
  });

  /*
   * 22:00 to 02:00 is a late-night menu, not an empty one. Same rule the
   * shop's own opening hours use, so the two cannot read a window
   * differently - which they did once already, in a different feature.
   */
  test('a window that crosses midnight is a window, not a mistake', () => {
    const late = { channel_hours: { online: { from: '22:00', to: '02:00' } } };
    expect(availableOn(late, 'online', 23 * 60).available).toBe(true);
    expect(availableOn(late, 'online', 1 * 60).available).toBe(true);
    expect(availableOn(late, 'online', 12 * 60).available).toBe(false);
  });

  test('hours on one channel say nothing about another', () => {
    expect(availableOn(lunch, 'kiosk', 16 * 60).available).toBe(true);
  });

  /*
   * A caller that cannot say what time it is must not silently remove things
   * from a menu. Showing a dish an hour late is a conversation; a menu that
   * empties itself because a clock was missing is a support call nobody can
   * diagnose.
   */
  test('with no clock to check, the window is reported but not enforced', () => {
    const answer = availableOn(lunch, 'online');
    expect(answer.available).toBe(true);
    expect(answer.window).toEqual({ from: '11:00', to: '15:00' });
  });

  test('a half-written window is dropped rather than half-applied', () => {
    /* "from 11:00 to nothing" could mean all afternoon or nothing at all.
       Guessing is how an item vanishes on a Saturday with no explanation. */
    expect(normalizeHours({ online: { from: '11:00' } })).toEqual({});
    expect(normalizeHours({ online: { from: '25:00', to: '15:00' } })).toEqual({});
    expect(normalizeHours(null)).toEqual({});
  });
});

describe('normalizeOff', () => {
  test('it keeps channel ids as they are', () => {
    expect(normalizeOff(['online', 'kiosk'])).toEqual(['online', 'kiosk']);
  });

  /*
   * A PARTNER is a legal exclusion too, and it cannot be validated here.
   *
   * "Not on Swiggy" is the request shops actually make, and swiggy is a
   * partner on the marketplace channel rather than a channel of its own.
   * Excluding only at channel level would take an item off Zomato as well,
   * which nobody asked for. The list of a shop's partners lives in its
   * settings, so this file cannot tell swiggy from a typo - and does not try.
   *
   * An id nobody recognises simply never matches, so the item stays on sale.
   * A typo that keeps selling is a correction; a typo that silently stops
   * selling is a day of lost orders with no error to explain them.
   */
  test('a partner id is kept, normalised the way the partner list stores it', () => {
    expect(normalizeOff(['Swiggy', 'online'])).toEqual(['swiggy', 'online']);
    expect(normalizeOff(['swiggy '])).toEqual(['swiggy']);
  });

  test('the same channel twice is once', () => {
    expect(normalizeOff(['online', 'online'])).toEqual(['online']);
  });

  test('junk is an empty list, not a crash', () => {
    expect(normalizeOff(null)).toEqual([]);
    expect(normalizeOff('online')).toEqual([]);
  });
});

describe('setChannel', () => {
  test('turning a channel on removes the exception', () => {
    expect(setChannel(['online', 'kiosk'], 'online', true)).toEqual({
      value: ['kiosk'],
      changed: true,
    });
  });

  test('turning a channel off adds one', () => {
    expect(setChannel([], 'swiggy', false)).toEqual({ value: ['swiggy'], changed: true });
  });

  /*
   * THE ONE THAT KEEPS A BULK EDIT CHEAP.
   *
   * "Sell everything on Swiggy" over four hundred items should write the
   * handful that were off, not four hundred documents - and a sync that
   * replaces whole documents makes every needless write a chance to lose a
   * field somebody else just changed.
   */
  test('a change that changes nothing reports so', () => {
    expect(setChannel([], 'online', true).changed).toBe(false);
    expect(setChannel(['online'], 'online', false).changed).toBe(false);
  });

  test('a partner can be switched off without touching its channel', () => {
    /* Off Swiggy, still on Zomato, still on the marketplace channel for
       anything else that arrives through it. */
    const off = setChannel([], 'swiggy', false).value;
    expect(off).toEqual(['swiggy']);
    expect(availableOn({ channel_off: off }, 'zomato').available).toBe(true);
    expect(availableOn({ channel_off: off }, 'marketplace').available).toBe(true);
    expect(availableOn({ channel_off: off }, 'swiggy').available).toBe(false);
  });

  test('something that is no id at all is refused rather than stored', () => {
    expect(setChannel([], '', false)).toEqual({ value: [], changed: false });
    expect(setChannel([], '   ', false)).toEqual({ value: [], changed: false });
  });
});
