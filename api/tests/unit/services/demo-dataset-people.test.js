'use strict';

/*
 * A shop is stocked with people from where it trades.
 *
 * Owner, looking at the localized demos: "everything should be very local.
 * including customer, supplier, sales, purchase and etc. thats very important."
 *
 * He was looking at a British-currency shop selling to Anand Kumar of Chennai,
 * buying from Balaji Distributors of Madurai. Those names are a hardcoded list
 * in demo-seed.js, and it was every country's demo - and every country's real
 * signup - because nothing ever read the customers.json and suppliers.json
 * that every currency dataset already ships, placed in its own city.
 *
 * So this is not only a demo fix. A shop in Tokyo that ticked "sample data"
 * got customers from Tamil Nadu with phone numbers beginning 98400.
 */

const fs = require('fs');
const path = require('path');
const { peopleFrom, toPack } = require('../../../src/services/demo-dataset');

const SRC = path.join(__dirname, '../../../src/services/demo-dataset.js');

describe('reading the dataset own people', () => {
  it('keeps the name, phone and city and nothing else', () => {
    /*
     * Balances, credit terms and tax registration on a demo customer are
     * claims about a business that does not exist. A demo must not make one.
     */
    const out = peopleFrom({
      customers: [{ name: 'Tokyo Cash Customer', phone: '03-1234', city: 'Tokyo', balance: 4200, taxNumber: 'JP99' }],
    }, 'customers');
    expect(out).toEqual([{ name: 'Tokyo Cash Customer', phone: '03-1234', city: 'Tokyo' }]);
  });

  it('takes the city out of an address when there is no city field', () => {
    const out = peopleFrom({ customers: [{ name: 'A', address: { city: 'Dubai' } }] }, 'customers');
    expect(out[0].city).toBe('Dubai');
  });

  it('drops the dataset walk-in, because the installer makes its own', () => {
    /*
     * Two walk-in customers is a list nobody can tell apart, and every sale
     * that defaults to one would be split arbitrarily between them.
     *
     * This assertion failed silently for a while: the regex had a literal
     * BACKSPACE byte where its word boundary should have been, invisible in
     * every terminal view of the file, so it matched nothing and the duplicate
     * came through. Hence the control-character test below.
     */
    const out = peopleFrom({
      customers: [{ name: 'Walk-in Customer' }, { name: 'Walkin Customer' }, { name: 'London Cash Customer' }],
    }, 'customers');
    expect(out.map((p) => p.name)).toEqual(['London Cash Customer']);
  });

  it('a nameless row is skipped rather than seeded blank', () => {
    const out = peopleFrom({ customers: [{ phone: '1' }, { name: '   ' }, { name: 'Real' }] }, 'customers');
    expect(out.map((p) => p.name)).toEqual(['Real']);
  });

  it('anything that is not a list of people is simply no people', () => {
    for (const bad of [null, undefined, {}, { customers: 'x' }, { customers: null }]) {
      expect(peopleFrom(bad, 'customers')).toEqual([]);
    }
  });
});

describe('the pack the installer receives', () => {
  const dataset = {
    datasetId: 'GBP-retail-v1',
    currency: 'GBP',
    categories: [{ name: 'Drinks' }],
    products: [{ name: 'Tea', categoryName: 'Drinks', pricing: { price: 2 } }],
  };

  it('carries the dataset people when it has them', () => {
    const pack = toPack(dataset, null, {
      customers: { customers: [{ name: 'London Cash Customer', city: 'London' }] },
      suppliers: { suppliers: [{ name: 'England Direct Imports', city: 'London' }] },
    });
    expect(pack.customers.map((p) => p.name)).toEqual(['London Cash Customer']);
    expect(pack.suppliers.map((p) => p.name)).toEqual(['England Direct Imports']);
  });

  it('carries NULL, not an empty list, when it has none', () => {
    /*
     * The seeder has to tell "this dataset has no people" from "this dataset
     * has none I could use". An empty list would leave the shop with no
     * customers at all, which is worse than foreign ones.
     */
    const pack = toPack(dataset, null, null);
    expect(pack.customers).toBeNull();
    expect(pack.suppliers).toBeNull();
  });

  it('still works for a caller that passes no people at all', () => {
    /* The old two-argument signature, which is what every existing test and
       the fallback path use. */
    const pack = toPack(dataset, null);
    expect(pack.products).toHaveLength(1);
    expect(pack.customers).toBeNull();
  });
});

describe('the source itself', () => {
  it('contains no invisible control characters', () => {
    /*
     * Twice in one day a generator wrote a raw control byte into source - a
     * NUL into a hash separator and a BACKSPACE into this file's walk-in
     * regex. Both were invisible in every terminal view, and the second one
     * silently disabled a filter while the code above it read as correct.
     *
     * Tab, newline and carriage return are the only ones a source file has any
     * business containing.
     */
    const raw = fs.readFileSync(SRC, 'latin1');
    const bad = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) {
        bad.push({ at: i, code: c, near: raw.slice(Math.max(0, i - 30), i + 10) });
      }
    }
    expect(bad).toEqual([]);
  });
});
