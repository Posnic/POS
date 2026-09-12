'use strict';

/*
 * TAPPING THE TAKEAWAY CARD HAS TO FIND THE TAKEAWAY ORDERS.
 *
 * Owner, from a handset: "one order show as take away, when tap, inside shows
 * no active orders."
 *
 * Two queries answer about the same orders and only one of them knew the field
 * is spelled two ways.
 *
 *   the floor    getTablesWithActiveOrders groups open KOTs and decides
 *                `dType === 'Take away' || dType === 'Takeaway'`
 *   the queue    the handset asks salePage for dine_type: 'Take away', and
 *                salePage copied the filter into the query verbatim
 *
 * So the card appeared - the query behind it takes both - and tapping it asked
 * for one exact string and got nothing back. The card was right and the queue
 * was real; the only thing wrong was which spellings each half accepted.
 *
 * Widened in the REPOSITORY rather than in the app, because the app asking the
 * narrow question is already installed on handsets, and this is the half that
 * can be fixed without reinstalling any of them.
 */

const path = require('path');
const repoPath = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'repositories',
  'sale.repository.js'
);

/** The query salePage builds, without needing a database to run it. */
async function queryFor(filters) {
  const salesRepository = require(repoPath);
  let seen = null;

  const Model = {
    find: (query) => {
      seen = query;
      return {
        sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }),
      };
    },
    countDocuments: async () => 0,
  };

  await salesRepository.salePage(filters, { limit: 10, page: 1 }, null, { SaleModel: Model });
  return seen;
}

describe('the takeaway queue answers whichever way it is spelled', () => {
  test('asking for "Take away" also finds "Takeaway"', async () => {
    const query = await queryFor({ sale_process: 'KOT', dine_type: 'Take away' });
    expect(query.dine_type).toEqual({ $in: ['Take away', 'Takeaway'] });
  });

  test('and asking for "Takeaway" also finds "Take away"', async () => {
    /* Neither spelling is the canonical one. Both are in the data. */
    const query = await queryFor({ sale_process: 'KOT', dine_type: 'Takeaway' });
    expect(query.dine_type).toEqual({ $in: ['Take away', 'Takeaway'] });
  });

  test('a dine-in filter is left exactly as it was asked for', async () => {
    /* The widening is for one value of one field. Anything else that started
       matching more than it used to would be a new bug, not a fix. */
    const query = await queryFor({ sale_process: 'KOT', dine_type: 'Dine-in' });
    expect(query.dine_type).toBe('Dine-in');
  });

  test('every other filter still goes through untouched', async () => {
    const query = await queryFor({ sale_process: 'KOT', table_number: 'T1' });
    expect(query.sale_process).toBe('KOT');
    expect(query.table_number).toBe('T1');
  });

  test('the floor and the queue agree on what counts as takeaway', () => {
    /*
     * THE THING THAT ACTUALLY BROKE. Two lists in two files, read by different
     * screens about the same orders. If one gains a spelling and the other
     * does not, the card comes back and the queue is empty again with nothing
     * on screen to say why.
     */
    const fs = require('fs');
    const floor = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'services', 'sale.service.js'),
      'utf8'
    );
    const repo = fs.readFileSync(repoPath, 'utf8');

    for (const said of ['Take away', 'Takeaway']) {
      expect(floor.includes(`'${said}'`)).toBe(true);
      expect(repo.includes(`'${said}'`)).toBe(true);
    }
  });
});
