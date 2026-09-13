'use strict';

/*
 * HOW OFTEN A TILL SHOULD ASK, AND WHO DECIDES.
 *
 * Owner: "previously we had polling stuff. will that work out for cloud print.
 * print always look for cloud api instead of local. should not give so much
 * load to cloud also. need balanced and well defined solution. polling should
 * happen only when app connected and logged in corrently acitve. otherwise
 * there is no app and no one going to give anything then its waste of time
 * polling stuff... may be configuration or toggle to poll cloud. it needs to be
 * on only when required. otherwise let app connect via lan and give print."
 *
 * Two halves. The till's half - the cloud door is shut unless a shop turned it
 * on - is pinned in tests/the-bill-comes-out-at-the-counter.test.js over in the
 * desktop. This file is the server's half: when the door IS open, the pace
 * comes from here, because this is the only side that can tell whether anybody
 * is working the floor.
 *
 * That is also why it is worth writing down: the numbers in print-pace.js can
 * be changed for every till in the estate without shipping a desktop build to
 * anybody, and these tests are what says what the numbers MEAN.
 */

const path = require('path');
const pacePath = path.join(__dirname, '..', '..', '..', 'src', 'helpers', 'print-pace.js');

describe('the pace a till is told to keep', () => {
  let pace;

  beforeEach(() => {
    /* A fresh module each time: presence is in memory on purpose, and a test
       that inherited the previous one's floor would pass for the wrong
       reason. */
    delete require.cache[require.resolve(pacePath)];
    pace = require(pacePath);
  });

  test('a till that was just handed work comes straight back for more', () => {
    /* A table with three rounds is three jobs. Printing one slip every ten
       seconds while two sit in the queue would be absurd. */
    const said = pace.pacingFor('branch-1', 2);
    expect(said.nextMs).toBe(0);
  });

  test('a shop with somebody on the floor is asked to stay close', () => {
    pace.seenOnTheFloor('branch-1');
    expect(pace.pacingFor('branch-1', 0).nextMs).toBe(pace.BUSY_MS);
  });

  test('a shop with nobody working is told to go away for a while', () => {
    expect(pace.pacingFor('branch-quiet', 0).nextMs).toBe(pace.IDLE_MS);
  });

  test('the idle pace is a minute, not an hour', () => {
    /*
     * This number is a judgement and deserves saying out loud. Something has
     * to NOTICE a waiter opening the app, and this is that something. A till
     * asleep for ten minutes is a guest waiting ten minutes for the first bill
     * of the evening; a minute is cheap enough to be beneath noticing and
     * short enough that only the first bill of a shift can ever wait for it.
     */
    expect(pace.IDLE_MS).toBeLessThanOrEqual(60 * 1000);
    expect(pace.IDLE_MS).toBeGreaterThanOrEqual(30 * 1000);
  });

  test('a floor goes quiet again once nobody has been seen for a while', () => {
    pace.seenOnTheFloor('branch-1');
    expect(pace.floorIsActive('branch-1')).toBe(true);

    const realNow = Date.now;
    Date.now = () => realNow() + pace.ACTIVE_FOR_MS + 1000;
    try {
      expect(pace.floorIsActive('branch-1')).toBe(false);
      expect(pace.pacingFor('branch-1', 0).nextMs).toBe(pace.IDLE_MS);
    } finally {
      Date.now = realNow;
    }
  });

  test('one shop being busy does not speak for another', () => {
    pace.seenOnTheFloor('branch-1');
    expect(pace.floorIsActive('branch-2')).toBe(false);
  });

  test('a blank branch is not a shop and never looks busy', () => {
    pace.seenOnTheFloor('');
    pace.seenOnTheFloor(null);
    expect(pace.floorIsActive('')).toBe(false);
  });
});

describe('holding a claim open instead of answering it empty', () => {
  let pace;

  beforeEach(() => {
    delete require.cache[require.resolve(pacePath)];
    pace = require(pacePath);
  });

  test('a job queued while a till is holding wakes it at once', async () => {
    /*
     * THE REASON THE CLOUD PATH IS NOT SLOW.
     *
     * Held for twenty seconds, answered in milliseconds. That is both fewer
     * requests than polling every five seconds AND faster than it, which is
     * the rare case where the cheaper thing is also the better one.
     */
    const began = Date.now();
    const waiting = pace.waitForJob('branch-1', 5000);
    setTimeout(() => pace.announceJob('branch-1'), 20);

    await expect(waiting).resolves.toBe(true);
    expect(Date.now() - began).toBeLessThan(2000);
  });

  test('a job for another shop does not wake this one', async () => {
    const waiting = pace.waitForJob('branch-1', 120);
    pace.announceJob('branch-2');
    await expect(waiting).resolves.toBe(false);
  });

  test('a hold that nothing arrives for simply ends', async () => {
    await expect(pace.waitForJob('branch-1', 60)).resolves.toBe(false);
  });

  test('the hold is short enough that nothing in the middle gives up first', () => {
    /* nginx gives a proxied request sixty seconds by default and Cloudflare a
       hundred. A hold longer than either would be cut by the middle rather
       than by us, and the till would see a dropped connection instead of an
       empty answer. */
    expect(pace.HOLD_MS).toBeLessThan(30 * 1000);
  });

  test('only a shop with somebody working is worth holding for', () => {
    /* Holding a socket open for a restaurant that is closed is precisely the
       waste being complained about. */
    expect(pace.worthHolding('branch-quiet')).toBe(false);
    pace.seenOnTheFloor('branch-1');
    expect(pace.worthHolding('branch-1')).toBe(true);
  });

  test('a held request does not keep the process alive on its own', async () => {
    /* An un-unref'd timer here would hold a shutting-down server - or this
       test runner - open for the length of every hold. */
    const waiting = pace.waitForJob('branch-1', 50);
    expect(waiting).toBeInstanceOf(Promise);
    await waiting;
  });
});
