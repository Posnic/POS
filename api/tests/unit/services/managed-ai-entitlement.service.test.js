'use strict';
jest.mock('../../../src/models/base.model', () => ({
  getDb: async () => ({ databaseName: 'tenant-test' }),
}));
const entitlement = require('../../../src/services/managed-ai-entitlement.service');
const original = { ...process.env };
const value = () => ({
  active: true,
  period_id: 'a'.repeat(64),
  allowance_minor: 100,
  currency: 'USD',
  valid_until: new Date(Date.now() + 86400000).toISOString(),
});
beforeEach(() => {
  process.env.ASK_POSNIC_BILLING_URL = 'https://billing.example.test/api/managed-ai/entitlement';
  process.env.ASK_POSNIC_BILLING_TOKEN = 'server-token';
});
afterAll(() => {
  process.env = original;
});

test('requests the current database allowance without caller-supplied shop identity', async () => {
  const fetcher = jest.fn(async () => new Response(JSON.stringify(value())));
  const result = await entitlement.get({ fetcher, force: true });
  expect(result).toMatchObject({ active: true, allowance_minor: 100, currency: 'USD' });
  const request = fetcher.mock.calls[0][1];
  expect(JSON.parse(request.body)).toEqual({ tenantDb: 'tenant-test' });
  expect(request.redirect).toBe('error');
});

test('cannot accept expired, malformed, oversized or wrong-currency grants', () => {
  for (const change of [
    { valid_until: '2000-01-01' },
    { period_id: 'malformed' },
    { allowance_minor: Infinity },
    { allowance_minor: -1 },
    { currency: 'INR' },
  ]) {
    expect(() => entitlement.validate({ ...value(), ...change })).toThrow('could not be verified');
  }
});

test('billing outage cannot reuse a formerly positive cached allowance', async () => {
  await entitlement.get({
    force: true,
    fetcher: async () => new Response(JSON.stringify(value())),
  });
  await expect(
    entitlement.get({ force: true, fetcher: async () => new Response('{}', { status: 503 }) })
  ).rejects.toThrow('temporarily unavailable');
  const fetcher = jest.fn(async () => new Response(JSON.stringify({ active: false })));
  expect((await entitlement.get({ fetcher })).active).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('rejects a chunked response that exceeds the limit without a content-length header', async () => {
  await expect(
    entitlement.get({
      force: true,
      fetcher: async () => new Response(' '.repeat(17000) + JSON.stringify(value())),
    })
  ).rejects.toThrow('Invalid managed AI allowance response');
});
