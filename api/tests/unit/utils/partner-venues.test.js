'use strict';

/**
 * Unit tests for src/utils/partner-venues.js
 *
 * The money ones matter most. A markup that quietly becomes a commission, or a
 * table billed to a hotel, is an argument with a partner business rather than
 * a bug report.
 */

const {
  commissionFor,
  confirmDestination,
  normalizeVenue,
  normalizeVenues,
  priceFor,
  resolveServicePoint,
  venueByCode,
} = require('../../../src/utils/partner-venues');

const ROYAL = {
  code: 'RC',
  name: 'Royal Club Hotel',
  price_adjust_percent: 10,
  commission_percent: 10,
};

describe('normalizeVenue', () => {
  test('needs a code and a name', () => {
    expect(normalizeVenue({ name: 'No code' })).toBeNull();
    expect(normalizeVenue({ code: 'RC' })).toBeNull();
  });

  test('the code is normalised the way a URL will carry it', () => {
    expect(normalizeVenue({ code: ' Royal-Club ', name: 'X' }).code).toBe('royalclub');
  });

  test('clamps a percentage to something a shop could mean', () => {
    expect(normalizeVenue({ ...ROYAL, price_adjust_percent: 900 }).price_adjust_percent).toBe(100);
    expect(normalizeVenue({ ...ROYAL, price_adjust_percent: 'abc' }).price_adjust_percent).toBe(0);
  });

  test('a negative markup is allowed, a negative commission is not', () => {
    /* A venue bringing real volume may earn a discount for its guests. Owing
       a venue less than nothing is not a deal, it is a typo. */
    expect(normalizeVenue({ ...ROYAL, price_adjust_percent: -5 }).price_adjust_percent).toBe(-5);
    expect(normalizeVenue({ ...ROYAL, commission_percent: -5 }).commission_percent).toBe(0);
  });
});

describe('venueByCode', () => {
  test('an exact code finds its venue', () => {
    expect(venueByCode('RC', [ROYAL]).name).toBe('Royal Club Hotel');
    expect(venueByCode('rc', [ROYAL]).name).toBe('Royal Club Hotel');
  });

  /*
   * THE BUG THE URL SHAPE REMOVED.
   *
   * The first design read the venue out of a PREFIX on the code, so `RCroom1`
   * meant Royal Club because it started with RC - and a table named `RC1`
   * would silently have been billed to the hotel. Naming the venue in the path
   * means an exact match, so a lookalike is simply not that venue.
   */
  test('a lookalike code is not a match', () => {
    expect(venueByCode('RC1', [ROYAL])).toBeNull();
    expect(venueByCode('RCX', [ROYAL])).toBeNull();
  });

  test('a disabled venue stops answering', () => {
    expect(venueByCode('RC', [{ ...ROYAL, enabled: false }])).toBeNull();
  });
});

describe('resolveServicePoint', () => {
  test('a hotel room reads as the hotel and the room', () => {
    const point = resolveServicePoint({ venue: 'RC', unit: '123' }, [ROYAL]);
    expect(point.venue.code).toBe('rc');
    /* The ticket is read by a person, not a parser. */
    expect(point.label).toBe('Royal Club Hotel - 123');
  });

  test('the shop own table is just itself, with no venue', () => {
    const point = resolveServicePoint({ table: '5' }, [ROYAL]);
    expect(point.venue).toBeNull();
    expect(point.label).toBe('5');
  });

  /*
   * A code printed before the settings changed must not become a phantom
   * markup. House price and no commission is the safe direction: a customer
   * charged the normal price is a bad QR code, a customer charged a markup
   * nobody agreed is a complaint.
   */
  test('an unknown venue falls back to the shop own floor', () => {
    const point = resolveServicePoint({ venue: 'GONE', unit: '9' }, [ROYAL]);
    expect(point.venue).toBeNull();
    expect(priceFor(280, point.venue)).toBe(280);
    expect(commissionFor(280, point.venue)).toBe(0);
  });

  test('a venue with no room named is still the venue', () => {
    expect(resolveServicePoint({ venue: 'RC' }, [ROYAL]).label).toBe('Royal Club Hotel');
  });
});

describe('priceFor', () => {
  test('the house price where there is no venue', () => {
    expect(priceFor(280, null)).toBe(280);
  });

  test('marked up for a venue that takes a cut', () => {
    expect(priceFor(280, ROYAL)).toBe(308);
  });

  /* A menu reading 308.00 beside a house price of 280 invites an argument at
     the table. Whole currency, always. */
  test('rounds to whole money rather than showing a fraction', () => {
    expect(priceFor(99, ROYAL)).toBe(109);
    expect(Number.isInteger(priceFor(333, ROYAL))).toBe(true);
  });

  test('a venue with no markup charges the house price', () => {
    expect(priceFor(280, { ...ROYAL, price_adjust_percent: 0 })).toBe(280);
  });
});

describe('commissionFor', () => {
  test('taken on what the customer actually paid', () => {
    /* On the marked-up total, not the house price: that is the number printed
       on the bill and the only one both sides can check. */
    expect(commissionFor(308, ROYAL)).toBe(30.8);
  });

  test('nothing owed on the shop own tables', () => {
    expect(commissionFor(280, null)).toBe(0);
  });

  /*
   * Markup and commission are separate numbers on purpose: a restaurant may
   * mark up 12 and pay 10, keeping two points. Folding them into one field
   * would decide that negotiation for them.
   */
  test('a shop can mark up more than it pays away', () => {
    const keeps2 = { ...ROYAL, price_adjust_percent: 12, commission_percent: 10 };
    const charged = priceFor(100, keeps2);
    expect(charged).toBe(112);
    expect(commissionFor(charged, keeps2)).toBe(11.2);
  });

  test('and can pay a venue out of its own margin, with no markup at all', () => {
    const absorbs = { ...ROYAL, price_adjust_percent: 0, commission_percent: 8 };
    expect(priceFor(100, absorbs)).toBe(100);
    expect(commissionFor(100, absorbs)).toBe(8);
  });
});

describe('normalizeVenues', () => {
  test('drops duplicates and unusable rows', () => {
    expect(normalizeVenues([ROYAL, ROYAL])).toHaveLength(1);
    expect(normalizeVenues([{ name: 'half filled' }])).toEqual([]);
    expect(normalizeVenues(null)).toEqual([]);
  });
});

describe('confirmDestination', () => {
  const HOTEL = {
    code: 'RC',
    name: 'Royal Club Hotel',
    unit_label: 'Room',
    ask_floor: true,
    address: '12 Beach Road',
    delivery_note: 'Use the service lift',
    price_adjust_percent: 10,
    commission_percent: 10,
  };
  const point = () => resolveServicePoint({ venue: 'RC', unit: '123' }, [HOTEL]);

  test('the shop own floor has no destination to record', () => {
    /* A table needs no address. Inventing one would put a blank hotel on
       every dine-in ticket. */
    expect(confirmDestination(resolveServicePoint({ table: '5' }, [HOTEL]))).toBeNull();
  });

  test('the URL is the default, and reads as a sentence', () => {
    expect(confirmDestination(point()).label).toBe('Royal Club Hotel, Room 123');
  });

  /*
   * THE ONE THIS FUNCTION EXISTS FOR.
   *
   * A guest photographs the code in room 123 and sends it to a friend in 456.
   * Record only what the link said and the food goes to the wrong room, with
   * nothing anywhere showing that the link and the guest disagreed.
   */
  test('what the customer says beats what the link said', () => {
    const d = confirmDestination(point(), { unit: '456', floor: '4' });
    expect(d.unit).toBe('456');
    expect(d.label).toBe('Royal Club Hotel, Room 456, floor 4');
  });

  test('an empty correction is not a correction', () => {
    /* Somebody clearing a field by accident must not blank the only address
       the kitchen has. */
    expect(confirmDestination(point(), { unit: '   ' }).unit).toBe('123');
  });

  test('it records whether the guest actually confirmed', () => {
    /* Worth knowing when a delivery goes wrong: did they check the room
       number, or did the link simply go unchallenged? */
    expect(confirmDestination(point(), { unit: '123' }).confirmed).toBe(true);
    expect(confirmDestination(point()).confirmed).toBe(false);
  });

  test('a floor is only asked for where the building needs one', () => {
    /* A field most guests leave blank trains people to skip the ones that
       matter. */
    const noFloor = { ...HOTEL, ask_floor: false };
    const p = resolveServicePoint({ venue: 'RC', unit: '9' }, [noFloor]);
    expect(confirmDestination(p, { floor: '3' }).floor).toBe('');
    expect(confirmDestination(p, { floor: '3' }).label).toBe('Royal Club Hotel, Room 9');
  });

  test('the unit is named the way the building names it', () => {
    const office = { ...HOTEL, unit_label: 'Desk', ask_floor: false };
    const p = resolveServicePoint({ venue: 'RC', unit: '7B' }, [office]);
    expect(confirmDestination(p).label).toBe('Royal Club Hotel, Desk 7B');
  });

  test('the standing note is copied onto the order, not looked up later', () => {
    /* A note that changes next month must not rewrite what last month's
       driver was told. */
    expect(confirmDestination(point()).delivery_note).toBe('Use the service lift');
    expect(confirmDestination(point()).address).toBe('12 Beach Road');
  });
});
