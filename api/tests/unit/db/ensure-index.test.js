'use strict';

/*
 * "Each shop will have a different db - who will add the index? when?"
 *
 * The honest answer was: nobody, for most shops. A shop's data lives in its
 * own database and one process serves many, so a static boolean latch -
 *
 *     if (this.constructor._ensured) return;
 *
 * - gave the index to whichever shop happened to ask first after a restart,
 * and to nobody else. It looked like it worked because it did, once.
 *
 * That was true of the quote list index and, worse, of the UNIQUE index that
 * stops two sales taking the same bill number: for every shop but the first,
 * the guarantee simply was not applied.
 *
 * Keying the latch by database name is the fix. These tests exist because the
 * failure is invisible in any single-database test - one database is exactly
 * the case where a per-process latch behaves correctly.
 */

const { ensureIndexOnce, databaseNameOf, _reset } = require('../../../src/db/ensure-index');

const mkCollection = (dbName, { fail = false } = {}) => ({
  dbName,
  createIndex: jest.fn(
    fail ? () => Promise.reject(new Error('build failed')) : () => Promise.resolve('ok')
  ),
});

describe('ensureIndexOnce', () => {
  beforeEach(() => _reset());

  test('it creates the index the first time', async () => {
    const col = mkCollection('shop_a');
    const ok = await ensureIndexOnce(col, { a: 1 }, { name: 'ix' });
    expect(ok).toBe(true);
    expect(col.createIndex).toHaveBeenCalledWith({ a: 1 }, { name: 'ix' });
  });

  test('it does not create it twice for the same database', async () => {
    const col = mkCollection('shop_a');
    await ensureIndexOnce(col, { a: 1 }, { name: 'ix' });
    await ensureIndexOnce(col, { a: 1 }, { name: 'ix' });
    await ensureIndexOnce(col, { a: 1 }, { name: 'ix' });
    expect(col.createIndex).toHaveBeenCalledTimes(1);
  });

  test('EVERY database gets its own index - this is the whole bug', async () => {
    const a = mkCollection('shop_a');
    const b = mkCollection('shop_b');
    const c = mkCollection('shop_c');

    await ensureIndexOnce(a, { a: 1 }, { name: 'ix' });
    await ensureIndexOnce(b, { a: 1 }, { name: 'ix' });
    await ensureIndexOnce(c, { a: 1 }, { name: 'ix' });

    expect(a.createIndex).toHaveBeenCalledTimes(1);
    expect(b.createIndex).toHaveBeenCalledTimes(1);
    expect(c.createIndex).toHaveBeenCalledTimes(1);
  });

  test('two different indexes on one database are both created', async () => {
    const col = mkCollection('shop_a');
    await ensureIndexOnce(col, { a: 1 }, { name: 'one' });
    await ensureIndexOnce(col, { b: 1 }, { name: 'two' });
    expect(col.createIndex).toHaveBeenCalledTimes(2);
  });

  test('a failed build is not latched, so it retries next request', async () => {
    /* A shop mid-build, a permission quirk, or legacy duplicates blocking a
       unique index. Latching a failure would mean the index never appears for
       that shop until someone restarts the process. */
    const col = mkCollection('shop_a', { fail: true });
    expect(await ensureIndexOnce(col, { a: 1 }, { name: 'ix' })).toBe(false);
    expect(await ensureIndexOnce(col, { a: 1 }, { name: 'ix' })).toBe(false);
    expect(col.createIndex).toHaveBeenCalledTimes(2);
  });

  test('a failed build never throws at the caller', async () => {
    /* The request that happened to trigger the build must not fail because of
       it - a blank quotes page is a worse outcome than a slow query. */
    const col = mkCollection('shop_a', { fail: true });
    await expect(ensureIndexOnce(col, { a: 1 }, { name: 'ix' })).resolves.toBe(false);
  });

  test('junk in gives false rather than an exception', async () => {
    expect(await ensureIndexOnce(null, { a: 1 })).toBe(false);
    expect(await ensureIndexOnce(mkCollection('x'), null)).toBe(false);
  });
});

describe('databaseNameOf', () => {
  test('it reads the name however the driver exposes it', () => {
    expect(databaseNameOf({ dbName: 'a' })).toBe('a');
    expect(databaseNameOf({ s: { db: { databaseName: 'b' } } })).toBe('b');
    expect(databaseNameOf({ conn: { name: 'c' } })).toBe('c');
  });

  test('an unknown shape falls back rather than throwing', () => {
    /* Falling back to one shared key is the safe direction: at worst an index
       is not re-attempted this process. Throwing would fail a real request. */
    expect(databaseNameOf({})).toBe('default');
    expect(databaseNameOf(null)).toBe('default');
  });
});
