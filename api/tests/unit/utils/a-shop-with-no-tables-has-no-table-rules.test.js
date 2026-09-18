'use strict';

/*
 * A SHOP WITH NO TABLES HAS NO TABLE RULES.
 *
 * Owner: "table restriction and restaurant oriented stuff only when
 * restaurant enabled. otherwise treat that as normal retail shop."
 *
 * Two things were doing it wrong, and both worked, which is why neither had
 * been noticed.
 *
 * ONE DEFAULT FOR EVERY SHOP. `[dine_in, takeaway]` went out whatever kind of
 * shop it was, so a hardware shop that had never opened the settings page was
 * telling customers it had tables. The customer's page filtered it out
 * afterwards - correctly - which meant the payload itself said something
 * untrue and only the page's manners hid it. A page that has to correct the
 * server's answer is a page that can forget to.
 *
 * THE TABLE LIMIT ASKED THE WRONG QUESTION. It asked whether a table NUMBER
 * had arrived, never whether the shop runs table service. A printed code can
 * carry a segment for all sorts of reasons, and the moment one did, a retail
 * counter refused a customer with "Table 5 already has an open order".
 */

const onlineOrdering = require('../../../src/utils/online-ordering');

describe('what a shop offers before anybody has said', () => {
  test('a retail shop is never given a table', () => {
    expect(onlineOrdering.normalizeFulfilment(undefined, 'retail')).toEqual(['pickup']);
  });

  test('a restaurant keeps the table it had', () => {
    expect(onlineOrdering.normalizeFulfilment(undefined, 'restaurant')).toEqual([
      'dine_in',
      'takeaway',
    ]);
  });

  test('an unstated kind reads as a restaurant, which is what every caller meant before', () => {
    expect(onlineOrdering.normalizeFulfilment(undefined)).toEqual(['dine_in', 'takeaway']);
  });

  test('neither default offers delivery', () => {
    /*
     * DELIBERATELY. A shop that has not said it delivers must not be offered
     * to a customer as delivering: that takes an order nobody can fulfil, and
     * the customer finds out when nothing arrives. Missing an option is a
     * smaller harm than promising one.
     */
    expect(onlineOrdering.normalizeFulfilment(undefined, 'retail')).not.toContain('delivery');
    expect(onlineOrdering.normalizeFulfilment(undefined, 'restaurant')).not.toContain('delivery');
  });
});

describe('and what a stored list is allowed to say', () => {
  test('a retail shop that somehow stored dine_in does not get one', () => {
    /* Whatever is in the document, a shop with no tables has no table. */
    expect(onlineOrdering.normalizeFulfilment(['dine_in', 'delivery'], 'retail')).toEqual([
      'delivery',
    ]);
  });

  test('a retail shop that stored only dine_in falls back rather than offering nothing', () => {
    expect(onlineOrdering.normalizeFulfilment(['dine_in'], 'retail')).toEqual(['pickup']);
  });

  test('a shop that says it delivers is believed', () => {
    /* The default is silence, not a ban. A shop that has chosen delivery gets
       delivery. */
    expect(onlineOrdering.normalizeFulfilment(['pickup', 'delivery'], 'retail')).toEqual([
      'pickup',
      'delivery',
    ]);
    expect(
      onlineOrdering.normalizeFulfilment(['dine_in', 'takeaway', 'delivery'], 'restaurant')
    ).toEqual(['dine_in', 'takeaway', 'delivery']);
  });

  test('the order is the product own, so buttons do not move between saves', () => {
    expect(onlineOrdering.normalizeFulfilment(['delivery', 'dine_in'], 'restaurant')).toEqual([
      'dine_in',
      'delivery',
    ]);
  });

  test('an unknown word is dropped rather than passed to the page', () => {
    expect(onlineOrdering.normalizeFulfilment(['pickup', 'teleport'], 'retail')).toEqual([
      'pickup',
    ]);
  });
});

describe('the table limit asks whether there are tables', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const REPO = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'sale.repository.js'),
    'utf8'
  );

  test('a shop that does not run table service is never refused for a table', () => {
    expect(REPO).toMatch(/const runsTableService = branchDoc\.table_options === true;/);
    expect(REPO).toMatch(/if \(runsTableService && openTableLimit > 0 && wantsTable\)/);
  });

  test('and the storefront tells the page which kind of shop it is', () => {
    const ITEMS = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'repositories', 'item.repository.js'),
      'utf8'
    );
    const passes = ITEMS.match(
      /kind: branchDoc\.table_options === true \? 'restaurant' : 'retail'/g
    );
    expect(passes).toHaveLength(2);
  });
});
