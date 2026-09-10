'use strict';

/**
 * Unit tests for src/utils/sales-channels.js
 *
 * A vocabulary, so these are cheap and exhaustive. The ones that matter most
 * are the legacy readers: years of sales carry only `sale_method`, and a
 * report that cannot see them shows a shop its history as an empty page.
 */

const {
  CHANNEL,
  FULFILMENT,
  SELF_SERVICE_CHANNELS,
  channelFilter,
  channelOf,
  commissionOn,
  describeSale,
  normalizeChannel,
  normalizeFulfilment,
  normalizePartner,
  requiresPartner,
  saleMethodFor,
} = require('../../../src/utils/sales-channels');

describe('normalizeChannel', () => {
  test('accepts the known channels, however they are typed', () => {
    expect(normalizeChannel('pos')).toBe(CHANNEL.POS);
    expect(normalizeChannel('  POS ')).toBe(CHANNEL.POS);
    expect(normalizeChannel('marketplace')).toBe(CHANNEL.MARKETPLACE);
  });

  test('refuses an invented one rather than storing it', () => {
    /* A typo that stores silently is a sale that leaves every report. */
    expect(normalizeChannel('poss')).toBeNull();
    expect(normalizeChannel('')).toBeNull();
    expect(normalizeChannel(undefined)).toBeNull();
  });
});

describe('normalizeFulfilment', () => {
  test('takes the spellings a form or an integration might send', () => {
    expect(normalizeFulfilment('dine_in')).toBe(FULFILMENT.DINE_IN);
    expect(normalizeFulfilment('Dine In')).toBe(FULFILMENT.DINE_IN);
    expect(normalizeFulfilment('dine-in')).toBe(FULFILMENT.DINE_IN);
  });

  test('refuses anything else', () => {
    expect(normalizeFulfilment('eat here')).toBeNull();
    expect(normalizeFulfilment(null)).toBeNull();
  });
});

describe('normalizePartner', () => {
  /* Without this, one aggregator becomes three rows in a report and none of
     them is the real total. */
  test('one partner, however it is spelled', () => {
    expect(normalizePartner('Swiggy')).toBe('swiggy');
    expect(normalizePartner(' SWIGGY ')).toBe('swiggy');
    expect(normalizePartner('swiggy')).toBe('swiggy');
  });

  test('makes a usable id out of a name with punctuation', () => {
    expect(normalizePartner('Uber Eats')).toBe('uber_eats');
    expect(normalizePartner('magicpin!')).toBe('magicpin');
  });

  test('nothing usable is null, not an empty string', () => {
    expect(normalizePartner('   ')).toBeNull();
    expect(normalizePartner('!!!')).toBeNull();
  });
});

describe('requiresPartner', () => {
  test('the outside channels need naming, the shops own do not', () => {
    expect(requiresPartner(CHANNEL.MARKETPLACE)).toBe(true);
    expect(requiresPartner(CHANNEL.ECOMMERCE)).toBe(true);
    expect(requiresPartner(CHANNEL.POS)).toBe(false);
    expect(requiresPartner(CHANNEL.KIOSK)).toBe(false);
    expect(requiresPartner('nonsense')).toBe(false);
  });
});

describe('channelOf', () => {
  test('reads the new field when a sale has one', () => {
    expect(channelOf({ channel: 'kiosk' })).toBe(CHANNEL.KIOSK);
  });

  /*
   * THE ONE THAT PROTECTS THE HISTORY.
   *
   * Every sale written before this existed carries only sale_method. A report
   * reading `channel` alone would show a shop years of trading as nothing at
   * all, with no error anywhere.
   */
  test('falls back to the four values sale_method has actually held', () => {
    expect(channelOf({ sale_method: 'Live-Order' })).toBe(CHANNEL.POS);
    expect(channelOf({ sale_method: 'Kiosk' })).toBe(CHANNEL.KIOSK);
    expect(channelOf({ sale_method: 'Table-Order' })).toBe(CHANNEL.TABLESIDE);
    expect(channelOf({ sale_method: 'Self-Order' })).toBe(CHANNEL.ONLINE);
  });

  test('the new field wins when a sale carries both', () => {
    expect(channelOf({ channel: 'marketplace', sale_method: 'Live-Order' })).toBe(
      CHANNEL.MARKETPLACE
    );
  });

  test('a sale with neither is not guessed at', () => {
    expect(channelOf({})).toBeNull();
    expect(channelOf(null)).toBeNull();
    expect(channelOf({ sale_method: 'something else' })).toBeNull();
  });
});

describe('channelFilter', () => {
  test('matches the new field and the legacy one', () => {
    const f = channelFilter([CHANNEL.KIOSK, CHANNEL.ONLINE]);
    expect(f.$or).toHaveLength(2);
    expect(f.$or[0]).toEqual({ channel: { $in: ['kiosk', 'online'] } });
    expect(f.$or[1].sale_method).toEqual({ $in: ['Kiosk', 'Self-Order'] });
  });

  /* A sale that HAS a channel must not also be counted by its legacy value,
     or a self-service report doubles. */
  test('the legacy arm only covers sales with no channel of their own', () => {
    const f = channelFilter(CHANNEL.KIOSK);
    expect(f.$or[1].channel).toEqual({ $in: [null, ''] });
  });

  test('a channel with no legacy value needs no legacy arm', () => {
    const f = channelFilter(CHANNEL.MARKETPLACE);
    expect(f.$or).toHaveLength(1);
  });

  test('nothing asked for filters nothing, rather than everything', () => {
    expect(channelFilter([])).toEqual({});
    expect(channelFilter(['nonsense'])).toEqual({});
  });

  test('self-service means the machine AND the customers own phone', () => {
    expect(SELF_SERVICE_CHANNELS).toEqual([CHANNEL.KIOSK, CHANNEL.ONLINE]);
  });
});

describe('describeSale', () => {
  test('records all three, and keeps sale_method in step', () => {
    expect(describeSale({ channel: 'online', fulfilment: 'delivery' })).toEqual({
      channel: 'online',
      channel_partner: null,
      fulfilment: 'delivery',
      sale_method: 'Self-Order',
    });
  });

  test('keeps a partner only where one means something', () => {
    expect(describeSale({ channel: 'marketplace', partner: 'Swiggy' }).channel_partner).toBe(
      'swiggy'
    );
    /* A till sale has no partner, and storing one would be a lie that a
       commission report would later act on. */
    expect(describeSale({ channel: 'pos', partner: 'Swiggy' }).channel_partner).toBeNull();
  });

  test('understands a caller that still speaks the old language', () => {
    const d = describeSale({ sale_method: 'Table-Order' });
    expect(d.channel).toBe(CHANNEL.TABLESIDE);
    expect(d.sale_method).toBe('Table-Order');
  });

  test('preserves an unrecognised legacy value rather than blanking it', () => {
    const d = describeSale({ sale_method: 'Something-Old' });
    expect(d.channel).toBeNull();
    expect(d.sale_method).toBe('Something-Old');
  });

  test('a fulfilment it does not know is dropped, not stored', () => {
    expect(describeSale({ channel: 'pos', fulfilment: 'teleport' }).fulfilment).toBeNull();
  });
});

describe('saleMethodFor', () => {
  test('every channel has a legacy name to write', () => {
    for (const channel of Object.values(CHANNEL)) {
      expect(typeof saleMethodFor(channel)).toBe('string');
    }
  });

  test('round-trips the four that already existed', () => {
    for (const [method, channel] of Object.entries({
      'Live-Order': CHANNEL.POS,
      Kiosk: CHANNEL.KIOSK,
      'Table-Order': CHANNEL.TABLESIDE,
      'Self-Order': CHANNEL.ONLINE,
    })) {
      expect(saleMethodFor(channel)).toBe(method);
    }
  });
});

describe('commissionOn', () => {
  /*
   * The reason marketplace is a channel and not a label. A 500 order at 25%
   * is 375 to the shop, and a report that cannot say so overstates earnings
   * by more the more the shop grows on aggregators.
   */
  test('takes the aggregators cut off the top', () => {
    expect(commissionOn(500, 25)).toEqual({ commission: 125, net: 375 });
  });

  test('rounds to money, not to floating point', () => {
    expect(commissionOn(333.33, 18)).toEqual({ commission: 60, net: 273.33 });
  });

  test('no rate means the shop keeps all of it', () => {
    expect(commissionOn(500, 0)).toEqual({ commission: 0, net: 500 });
    expect(commissionOn(500, null)).toEqual({ commission: 0, net: 500 });
  });

  test('nonsense in does not produce NaN out', () => {
    expect(commissionOn('abc', 'xyz')).toEqual({ commission: 0, net: 0 });
  });
});
