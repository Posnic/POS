'use strict';
/*
 * One shop must not be able to spend another shop's rate limit allowance.
 *
 * express-rate-limit keys on req.ip by default. With a process per shop that
 * silently meant "per address, per shop", because the process only ever saw one
 * shop. Sharing a process kept the same line of configuration and changed what
 * it meant: 1000 requests per address for every shop at once.
 *
 * It is not a theoretical failure. A load test across twenty shops returned
 * "Too many requests" from shops it had not reached yet - and the shop that got
 * the 429 has no way of knowing why, because the traffic that spent its
 * allowance belonged to somebody else.
 *
 * The opposite decision applies to sign-in, and that is also asserted here: a
 * password list tried against twenty shops from one address is one attacker,
 * and giving them twenty separate budgets would be the same mistake pointed the
 * other way.
 */

const {
  perShopKey,
  perClientKey,
  clientAddress,
  shopOf,
} = require('../../../src/middleware/rate-limit-key');
const ctx = require('../../../src/db/tenant-context');

const req = ({ ip, headers = {}, socket = {} } = {}) => ({ ip, headers, socket });

describe('what a rate limit counts against', () => {
  afterEach(() => ctx.enableMultiTenant(false));

  test('two shops at the same address get different keys', () => {
    ctx.enableMultiTenant(true);
    const a = ctx.runWithTenant({ tenantDb: 'posnic_t_alpha', db: {}, secrets: {} }, () =>
      perShopKey(req({ ip: '203.0.113.5' }))
    );
    const b = ctx.runWithTenant({ tenantDb: 'posnic_t_beta', db: {}, secrets: {} }, () =>
      perShopKey(req({ ip: '203.0.113.5' }))
    );
    expect(a).not.toEqual(b);
    /* Both still carry the address, so one shop's abuser is still counted. */
    expect(a).toContain('203.0.113.5');
    expect(b).toContain('203.0.113.5');
  });

  test('two customers of one shop also get different keys', () => {
    ctx.enableMultiTenant(true);
    const shop = { tenantDb: 'posnic_t_alpha', db: {}, secrets: {} };
    const one = ctx.runWithTenant(shop, () => perShopKey(req({ ip: '203.0.113.5' })));
    const two = ctx.runWithTenant(shop, () => perShopKey(req({ ip: '198.51.100.9' })));
    expect(one).not.toEqual(two);
  });

  test('a single-shop till keys on the address alone, as it always did', () => {
    /* The tills in shops run one process for one shop. Nothing about their
       behaviour should change, so the key is exactly what it was. */
    expect(perShopKey(req({ ip: '203.0.113.5' }))).toEqual('203.0.113.5');
  });

  test('sign-in is counted per address across every shop', () => {
    ctx.enableMultiTenant(true);
    const a = ctx.runWithTenant({ tenantDb: 'posnic_t_alpha', db: {}, secrets: {} }, () =>
      perClientKey(req({ ip: '203.0.113.5' }))
    );
    const b = ctx.runWithTenant({ tenantDb: 'posnic_t_beta', db: {}, secrets: {} }, () =>
      perClientKey(req({ ip: '203.0.113.5' }))
    );
    /* Deliberately the same. One attacker, one budget. */
    expect(a).toEqual(b);
  });
});

describe('finding the client behind the proxy', () => {
  test('a loopback req.ip falls back to the forwarded address', () => {
    /*
     * The failure this guards. nginx's tenant blocks sent X-Real-IP but not
     * X-Forwarded-For, which is the one Express reads, so req.ip was 127.0.0.1
     * for every request on the machine - every customer of every shop in a
     * single bucket. The header is fixed, and this keeps the app from
     * depending on that fix being present everywhere.
     */
    const r = req({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } });
    expect(clientAddress(r)).toEqual('203.0.113.5');
  });

  test('x-real-ip is used when that is all there is', () => {
    expect(clientAddress(req({ ip: '::1', headers: { 'x-real-ip': '203.0.113.5' } }))).toEqual(
      '203.0.113.5'
    );
  });

  test('a trusted req.ip is preferred over anything a client can send', () => {
    /* X-Forwarded-For is caller-supplied. Once Express has resolved req.ip
       through `trust proxy` it is the answer, and a header claiming otherwise
       must not be able to move somebody into a different bucket - which is how
       a limiter gets bypassed one forged header at a time. */
    const r = req({ ip: '203.0.113.5', headers: { 'x-forwarded-for': '1.2.3.4' } });
    expect(clientAddress(r)).toEqual('203.0.113.5');
  });

  test('a request with nothing identifiable still produces a key', () => {
    /* Never throws. A limiter that raises inside its own key generator turns
       into a 500 on every request it was meant to be quietly counting. */
    expect(typeof perShopKey(req())).toBe('string');
    expect(perShopKey(req()).length).toBeGreaterThan(0);
  });
});

describe('the shop is read from the request scope', () => {
  afterEach(() => ctx.enableMultiTenant(false));

  test('no shop outside multi-tenant mode', () => {
    expect(shopOf(req({ headers: { host: 'alpha.posnic.io' } }))).toEqual('');
  });

  test('the host names the shop when the scope is unavailable', () => {
    ctx.enableMultiTenant(true);
    /* Outside runWithTenant, currentTenant() throws by design. The key still
       has to separate shops, and the host it arrived on is the thing that
       chose the shop in the first place. */
    expect(shopOf(req({ headers: { host: 'alpha.posnic.io' } }))).toEqual('alpha.posnic.io');
  });
});
