'use strict';

/*
 * THE KITCHEN TELLS THE FLOOR FIRST.
 *
 * "No more fish" reaches a waiter before it reaches anybody with a keyboard.
 * Until now that waiter had to find whoever runs the till, and in the minutes
 * that took, three more tables ordered it, three more tickets printed, and
 * three tables were told no after they had already chosen.
 *
 * NOT BY TOUCHING STOCK, which is the whole design. "Sold out" on the menu has
 * always meant available_quantity <= 0 - counted inventory, the figures the
 * shop buys against. A waiter zeroing that to warn the floor would be writing
 * a lie into purchasing to solve a problem that lasts one evening.
 *
 * So it is its own flag with its own lifetime: set during service, gone by the
 * next trading day, which begins at seven in the morning like the fish prices.
 * A dish taken off during Friday service comes back Saturday morning, not at
 * one a.m. in the middle of the last push.
 */

const mongoose = require('mongoose');

const ItemRepository = require('../../../src/repositories/item.repository');
const BaseModel = require('../../../src/models/base.model');
const tradingDay = require('../../../src/utils/trading-day');

const ITEM = new mongoose.Types.ObjectId();
const BRANCH = new mongoose.Types.ObjectId();
const OTHER_BRANCH = new mongoose.Types.ObjectId();

describe('a waiter saying a dish has run out', () => {
  let repo;
  let col;
  let stored;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    stored = {
      _id: ITEM,
      name: 'Meen Kuzhambu',
      available_quantity: 12,
      branch_id: BRANCH,
    };

    col = {
      findOne: jest.fn().mockResolvedValue(stored),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    repo = new ItemRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
  });

  afterEach(() => jest.restoreAllMocks());

  test('IT IS ITS OWN FLAG, and the stock figures are not touched', async () => {
    /*
     * The heart of it. A kitchen out of fish at eight o'clock has not changed
     * what the shop bought, and a waiter must not be able to rewrite that.
     */
    const out = await repo.markSoldOut({ itemId: String(ITEM), branchId: String(BRANCH) });

    expect(out.status).toBe(true);

    const [, update] = col.updateOne.mock.calls[0];
    expect(update.$set.sold_out_on).toBeInstanceOf(Date);
    expect(JSON.stringify(update)).not.toContain('available_quantity');
  });

  test('putting it back removes the flag rather than setting a second one', async () => {
    /* A kitchen that finds another crate says so, and the dish returns. A
       second flag meaning "not off" would be two truths to keep in step. */
    const out = await repo.markSoldOut({
      itemId: String(ITEM),
      off: false,
      branchId: String(BRANCH),
    });

    expect(out.status).toBe(true);
    const [, update] = col.updateOne.mock.calls[0];
    expect(update.$unset).toEqual({ sold_out_on: '' });
  });

  test('only a dish this shop actually sells', async () => {
    /* A handset holds one shop's menu and has no business marking another
       shop's fish off, even by accident. */
    await repo.markSoldOut({ itemId: String(ITEM), branchId: String(OTHER_BRANCH) });

    const [selector] = col.findOne.mock.calls[0];
    const branches = JSON.stringify(selector.$or);
    expect(branches).toContain(String(OTHER_BRANCH));
    expect(branches).not.toContain(String(BRANCH));
  });

  test('a dish that is not on the menu is refused, and nothing is written', async () => {
    col.findOne.mockResolvedValue(null);

    const out = await repo.markSoldOut({ itemId: String(ITEM), branchId: String(BRANCH) });

    expect(out.status).toBe(false);
    expect(col.updateOne).not.toHaveBeenCalled();
  });

  test('nonsense for an id is refused before anything is read', async () => {
    const out = await repo.markSoldOut({ itemId: 'the fish one', branchId: String(BRANCH) });

    expect(out.status).toBe(false);
    expect(col.findOne).not.toHaveBeenCalled();
  });
});

describe('when it comes back by itself', () => {
  /*
   * The lifetime is the point. A flag somebody has to remember to clear is a
   * menu that is wrong every morning until they do.
   */
  const branch = { timezone: 'Asia/Kolkata' };

  test('a dish taken off during service is still off later that night', () => {
    const duringService = new Date();
    duringService.setHours(20, 30, 0, 0);

    const stillNight = new Date(duringService);
    stillNight.setHours(23, 45, 0, 0);

    jest.useFakeTimers().setSystemTime(stillNight);
    expect(tradingDay.isToday(duringService, branch)).toBe(true);
    jest.useRealTimers();
  });

  test('and still off at one in the morning, which is the point of seven', () => {
    /* Midnight would put it back mid-service, while the kitchen still has
       none. That is the bug the seven o'clock rule exists to prevent. */
    const friday = new Date('2026-09-18T20:30:00+05:30');
    const afterMidnight = new Date('2026-09-19T01:00:00+05:30');

    jest.useFakeTimers().setSystemTime(afterMidnight);
    expect(tradingDay.isToday(friday, branch)).toBe(true);
    jest.useRealTimers();
  });

  test('but back on the menu the next morning, with nobody doing anything', () => {
    const friday = new Date('2026-09-18T20:30:00+05:30');
    const saturdayMorning = new Date('2026-09-19T09:00:00+05:30');

    jest.useFakeTimers().setSystemTime(saturdayMorning);
    expect(tradingDay.isToday(friday, branch)).toBe(false);
    jest.useRealTimers();
  });

  test('never marked off reads as on the menu', () => {
    expect(tradingDay.isToday(null, branch)).toBe(false);
    expect(tradingDay.isToday(undefined, branch)).toBe(false);
    expect(tradingDay.isToday('whenever', branch)).toBe(false);
  });
});
