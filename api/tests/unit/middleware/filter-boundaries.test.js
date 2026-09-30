'use strict';
const express = require('express');
const bodyGuard = require('../../../src/middleware/no-mongo-operators');
const { filterGuard } = require('../../../src/middleware/filter-guard');
const {
  parseFilterParam,
  findCodeOperator,
  MAX_FILTER_NODES,
} = require('../../../src/utils/mongo-guard');
const nest = (value, n, key = '$and') => {
  for (let i = 0; i < n; i++) value = { [key]: [value] };
  return value;
};
let server, base, reached;
beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(bodyGuard);
  app.use(filterGuard);
  app.all('/list', (req, res) => {
    reached++;
    res.json(parseFilterParam(req.query.filters || req.body?.filters));
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => {
  reached = 0;
});

test.each([0, 1, 4, 5, 9, 20])(
  'code operators cannot cross the HTTP guard at nesting %i',
  async (depth) => {
    for (const operator of ['$where', '$function', '$accumulator', '$expr']) {
      const raw = JSON.stringify(nest({ [operator]: 'true' }, depth));
      expect(parseFilterParam(raw).rejected).toBeTruthy();
      expect(parseFilterParam(raw).filters).toEqual({});
      for (const method of ['GET', 'POST']) {
        const response = await fetch(
          base + '/list' + (method === 'GET' ? '?filters=' + encodeURIComponent(raw) : ''),
          method === 'GET'
            ? {}
            : {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters: raw }),
              }
        );
        expect(response.status).toBe(400);
        await response.text();
      }
    }
    expect(reached).toBe(0);
  }
);

test('valid comparison filters retain their meaning', async () => {
  const filter = {
    $and: [
      { sale_process: { $ne: 'KOT' } },
      { created_date: { $gte: '2026-01-01', $lte: '2026-02-01' } },
    ],
  };
  const response = await fetch(
    base + '/list?filters=' + encodeURIComponent(JSON.stringify(filter))
  );
  expect(response.status).toBe(200);
  expect((await response.json()).filters).toEqual(filter);
  expect(reached).toBe(1);
});

test('over-depth bodies and exhausted scan budgets never reach routes', async () => {
  for (const body of [
    nest({ $where: 'true' }, 14, 'children'),
    { values: Array(bodyGuard.MOST_NODES + 1).fill(0) },
  ]) {
    const response = await fetch(base + '/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    await response.text();
  }
  expect(reached).toBe(0);
  expect(findCodeOperator({ values: Array(MAX_FILTER_NODES + 1).fill(0) })).toBe('NODE_LIMIT');
});

test('cyclic filters and unexpected body inspection errors fail closed', () => {
  const value = {};
  value.self = value;
  expect(findCodeOperator(value)).toBe('CYCLIC_FILTER');
  const body = {};
  Object.defineProperty(body, 'field', {
    enumerable: true,
    get() {
      throw new Error('private detail');
    },
  });
  const next = jest.fn(),
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  bodyGuard({ body }, res, next);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(next).not.toHaveBeenCalled();
});
