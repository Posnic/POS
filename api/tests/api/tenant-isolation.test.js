'use strict';
/*
 * One process, several shops, and the guarantee that holds it together.
 *
 * Serving more than one shop from a process means resolving the database per
 * request instead of at import. The saving is real - twenty shops each with
 * their own pool held 1,052 sockets open, where one shared pool holds a few -
 * but the failure mode is the worst one this system has: a request served from
 * the wrong database, which is a shop reading another shop's sales, customers
 * and prices.
 *
 * That failure would be quiet. Nothing throws; the query succeeds and returns
 * someone else's rows. So it is asserted here, against a real database, rather
 * than argued from how useDb is supposed to behave.
 *
 * These run only when CI_MONGODB_URI is set. On a release tag the workflow
 * proves the connection first, so they cannot be skipped into a green tick.
 */

const mongoose = require('mongoose');
const { withDatabase, ciDatabaseName } = require('./ci-database');
const {
  tenantConnection,
  assertUsableName,
  isServableName,
} = require('../../src/db/tenant-connections');

const URI = process.env.CI_MONGODB_URI;
const describeIfDb = URI ? describe : describe.skip;

if (!URI) {
  console.warn(
    '\n  [tenant-isolation] skipped: set CI_MONGODB_URI to run these against a real database.\n'
  );
}

describeIfDb('one pool, many shops', () => {
  const base = ciDatabaseName('ci_tenant');
  const shopA = `${base}_a`;
  const shopB = `${base}_b`;
  let connA;
  let connB;

  beforeAll(async () => {
    await mongoose.connect(withDatabase(URI, base), { maxPoolSize: 5 });
    connA = tenantConnection(shopA);
    connB = tenantConnection(shopB);
  }, 60000);

  afterAll(async () => {
    if (connA) await connA.dropDatabase();
    if (connB) await connB.dropDatabase();
    if (mongoose.connection.readyState) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }, 60000);

  test('a shop reads its own writes', async () => {
    await connA.collection('items').insertOne({ sku: 'A-1', name: 'Shop A only' });
    const found = await connA.collection('items').findOne({ sku: 'A-1' });
    expect(found).toBeTruthy();
    expect(found.name).toBe('Shop A only');
  });

  test('a shop cannot read another shop', async () => {
    /* The whole point. If this ever fails, stop serving shops from one
       process until it passes again. */
    const leaked = await connB.collection('items').findOne({ sku: 'A-1' });
    expect(leaked).toBeNull();
    expect(await connB.collection('items').countDocuments()).toBe(0);
  });

  test('a write to one shop does not reach the other', async () => {
    await connB.collection('items').insertOne({ sku: 'B-1', name: 'Shop B only' });
    expect(await connA.collection('items').countDocuments({ sku: 'B-1' })).toBe(0);
    expect(await connB.collection('items').countDocuments({ sku: 'A-1' })).toBe(0);
  });

  test('the shops are on different databases, not different collections', async () => {
    expect(connA.db.databaseName).toBe(shopA);
    expect(connB.db.databaseName).toBe(shopB);
    expect(connA.db.databaseName).not.toBe(connB.db.databaseName);
  });

  test('they share one connection pool, which is the reason for all this', async () => {
    /* If these ever stop sharing a client, the socket count goes back to one
       pool per shop and the change has bought nothing. */
    expect(connA.getClient()).toBe(mongoose.connection.getClient());
    expect(connB.getClient()).toBe(connA.getClient());
  });

  test('opening many shops opens no further sockets', async () => {
    const admin = mongoose.connection.db.admin();
    const before = (await admin.serverStatus()).connections.current;
    const many = Array.from({ length: 25 }, (_, i) => tenantConnection(`${base}_bulk_${i}`));
    const after = (await admin.serverStatus()).connections.current;
    expect(many).toHaveLength(25);
    /* A pool per shop would add at least one socket each. Allow a little slack
       for unrelated activity on a shared CI cluster, but not 25. */
    expect(after - before).toBeLessThan(10);
  });

  test('the same shop asked for twice is the same connection', async () => {
    expect(tenantConnection(shopA)).toBe(connA);
  });
});

describe('which database names may be served', () => {
  test('server databases are refused - they are not shops', () => {
    for (const name of ['admin', 'local', 'config', 'ADMIN', 'Local']) {
      expect(() => assertUsableName(name)).toThrow(/server database/);
      expect(isServableName(name)).toBe(false);
    }
  });

  test('anything the control plane would not have generated is refused', () => {
    for (const name of [
      '',
      'has space',
      'has/slash',
      'has.dot',
      '../etc/passwd',
      'a'.repeat(64),
      null,
      undefined,
      'drop$db',
    ]) {
      expect(isServableName(name)).toBe(false);
    }
  });

  test('a real tenant database name is accepted', () => {
    for (const name of ['posnic_t_kiranastore', 'posnic_t_bala', 'ci_tenant_1_ab12cd']) {
      expect(assertUsableName(name)).toBe(name);
      expect(isServableName(name)).toBe(true);
    }
  });

  test('a name is refused, never sanitised into a different one', () => {
    /* Trimming or stripping would turn a bad name into a valid name for some
       other database, which is a worse outcome than refusing. */
    expect(() => assertUsableName(' posnic_t_a ')).toThrow();
    expect(() => assertUsableName('posnic_t_a\n')).toThrow();
  });
});
