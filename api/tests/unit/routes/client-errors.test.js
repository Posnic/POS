'use strict';

/*
 * The crash reporter must be useful, bounded, and harmless.
 *
 * It is deliberately unauthenticated - the errors worth hearing about happen
 * before auth works - so every test here is about the surface staying small:
 * nothing stored, a per-IP budget, truncation, and an answer that never adds
 * a second failure to the moment that already has one.
 */
const router = require('../../../src/routes/client-errors.routes');

/*
 * No supertest in this repo, and none needed: the router's one handler is
 * reached directly with hand-built req/res doubles. What matters here is the
 * handler's own behaviour - budget, truncation, 204 - not express plumbing.
 */
const handler = router.stack.find((l) => l.route && l.route.path === '/').route.stack[0].handle;

function call(body, ip) {
  let status = null;
  let ended = false;
  const req = { body, ip: ip || '1.2.3.4', headers: { host: 'shop.posnic.io' } };
  const res = {
    status(c) {
      status = c;
      return this;
    },
    end() {
      ended = true;
    },
  };
  handler(req, res);
  return { status, ended };
}

describe('client error reports', () => {
  let logged;
  let spy;
  beforeEach(() => {
    logged = [];
    spy = jest.spyOn(console, 'error').mockImplementation((...a) => logged.push(a.join(' ')));
  });
  afterEach(() => spy.mockRestore());

  test('a report lands in the log and answers 204', () => {
    const r = call({
      message: 'boom',
      at: 'dashboard.js:1',
      stack: 'x' + String.fromCharCode(10) + 'y',
    });
    expect(r.status).toBe(204);
    expect(r.ended).toBe(true);
    expect(logged.join(' ')).toMatch(/\[client-error\].*boom/);
  });

  test('fields are truncated - a hostile payload cannot flood a log line', () => {
    call({ message: 'a'.repeat(10000), stack: 'b'.repeat(50000) }, '2.2.2.2');
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line.length).toBeLessThan(1500);
  });

  test('the per-IP budget drops the flood but never the response', () => {
    for (let i = 0; i < 20; i++) {
      const r = call({ message: 'flood' + i }, '3.3.3.3');
      expect(r.status).toBe(204);
    }
    const mine = logged.filter((l) => /flood\d+/.test(l));
    expect(mine.length).toBeLessThanOrEqual(6);
    expect(mine.length).toBeGreaterThan(0);
  });

  test('garbage bodies do not throw', () => {
    expect(call(undefined, '4.4.4.4').status).toBe(204);
    expect(call('a string', '4.4.4.5').status).toBe(204);
    expect(call(null, '4.4.4.6').status).toBe(204);
  });
});
