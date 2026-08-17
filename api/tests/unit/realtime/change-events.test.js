'use strict';

/**
 * Unit tests for src/realtime/change-events.js (S2).
 *
 * The middleware is the product's write-seam detector: a successful
 * mutating request to a data entity - and nothing else - becomes a change
 * signal for the shop's tills. What must never happen: reads publishing,
 * failures publishing, non-data routes publishing, or one shop's write
 * signalling another shop's tills (the tenant key comes from req.db).
 */

const { EventEmitter } = require('events');
const { changeEvents, entityFromPath, ENTITIES } = require('../../../src/realtime/change-events');
const bus = require('../../../src/realtime/event-bus');

const fakeReq = (method, path, dbName = 'shop_one') => ({
  method,
  path,
  db: dbName ? { databaseName: dbName } : null,
});

const fakeRes = (statusCode) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
};

const run = (req, res) => new Promise((resolve) => changeEvents(req, res, resolve));

const listen = (dbName) => {
  const sink = { lines: [], write(l) { this.lines.push(l); } };
  bus.subscribe(dbName, sink);
  return sink;
};

afterEach(() => bus.resetForTests());

describe('changeEvents', () => {
  test('a successful POST to a data entity publishes to that shop', async () => {
    const sink = listen('shop_one');
    const res = fakeRes(200);
    await run(fakeReq('POST', '/api/sales'), res);
    res.emit('finish');
    expect(sink.lines.length).toBe(1);
    expect(sink.lines[0]).toContain('"entity":"sales"');
  });

  test('the root-mounted path publishes the same entity', async () => {
    const sink = listen('shop_one');
    const res = fakeRes(201);
    await run(fakeReq('PUT', '/items/abc123'), res);
    res.emit('finish');
    expect(sink.lines.length).toBe(1);
    expect(sink.lines[0]).toContain('"entity":"items"');
  });

  test('reads never publish', async () => {
    const sink = listen('shop_one');
    const res = fakeRes(200);
    await run(fakeReq('GET', '/api/sales'), res);
    res.emit('finish');
    expect(sink.lines.length).toBe(0);
  });

  test('failures never publish', async () => {
    const sink = listen('shop_one');
    const res = fakeRes(403);
    await run(fakeReq('POST', '/api/sales'), res);
    res.emit('finish');
    expect(sink.lines.length).toBe(0);
  });

  test('non-data routes never publish', async () => {
    const sink = listen('shop_one');
    for (const path of ['/api/auth/login', '/api/setting/updateCommonSettings', '/api/uploads/x']) {
      const res = fakeRes(200);
      await run(fakeReq('POST', path), res);
      res.emit('finish');
    }
    expect(sink.lines.length).toBe(0);
  });

  test('the signal goes to the writing shop, not the others', async () => {
    const other = listen('shop_two');
    const res = fakeRes(200);
    await run(fakeReq('POST', '/api/sales', 'shop_one'), res);
    res.emit('finish');
    expect(other.lines.length).toBe(0);
  });

  test('a request with no tenant publishes nothing rather than crashing', async () => {
    const res = fakeRes(200);
    await run(fakeReq('POST', '/api/sales', null), res);
    expect(() => res.emit('finish')).not.toThrow();
  });

  test('entityFromPath handles both mounts and noise', () => {
    expect(entityFromPath('/api/sales/return')).toBe('sales');
    expect(entityFromPath('/registers/registerAdd')).toBe('registers');
    expect(entityFromPath('/')).toBe(null);
    expect(entityFromPath('')).toBe(null);
  });

  test('the whitelist covers the entities tills watch', () => {
    for (const e of ['sales', 'items', 'registers', 'receivings', 'shifts']) {
      expect(ENTITIES.has(e)).toBe(true);
    }
    expect(ENTITIES.has('auth')).toBe(false);
    expect(ENTITIES.has('setting')).toBe(false);
  });
});
