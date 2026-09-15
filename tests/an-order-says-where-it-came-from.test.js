/*
 * AN ORDER SAYS WHERE IT CAME FROM.
 *
 * Owner: "every order should have some details. example what mobile, user
 * agent, ip address, mobile type or user account whatever infromation app can
 * know do it."
 *
 * When an order goes wrong - a duplicate, a wrong table, a price nobody
 * recognises - the question is which phone and whose hands. The customer
 * storefront has recorded this since it was built. The door every handset uses
 * recorded nothing at all, which is the one that matters most: a shop has four
 * identical phones and six waiters.
 *
 * Two halves, and the split is the point. The PHONE says what only it knows -
 * its model, its build, which door it used. The TILL says what a phone must
 * not be trusted to claim: the address the request came from, and who was
 * signed in.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...bits) => fs.readFileSync(path.join(ROOT, ...bits), 'utf8');

const CONTROLLER = read('api', 'src', 'controllers', 'sales.controller.js');
const REPO = read('api', 'src', 'repositories', 'sale.repository.js');

/** Lift one method body out of the repository class by brace matching. */
function liftMethod(source, name) {
  const from = source.indexOf(`${name}(client) {`);
  assert.notStrictEqual(from, -1, `${name} is gone`);
  let depth = 0;
  for (let i = source.indexOf('{', from); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  throw new Error(`${name} never closes`);
}

// eslint-disable-next-line no-new-func
const clientFacts = new Function(
  `const o = { ${liftMethod(REPO, '_clientFacts')} }; return (c) => o._clientFacts(c);`
)();

/* --------------------------------------------------- what the till keeps */

test('what a handset knows about itself is kept', () => {
  const facts = clientFacts({
    app: 'captain',
    app_version: '1.2.21 (abc1234)',
    device_id: 'fixed-uuid-1111',
    device_model: 'SM-G991B',
    platform: 'app/android',
    network: 'lan',
  });

  assert.strictEqual(facts.app, 'captain');
  assert.strictEqual(facts.app_version, '1.2.21 (abc1234)');
  assert.strictEqual(facts.device_model, 'SM-G991B');
  assert.strictEqual(facts.network, 'lan');
  assert.ok(facts.at instanceof Date, 'no record of when');
});

test('and who was holding it', () => {
  const facts = clientFacts({ staff_id: '65b0', staff_name: 'Ravi' });
  assert.strictEqual(facts.staff_name, 'Ravi');
  assert.strictEqual(facts.staff_id, '65b0');
});

test('a field nobody named is dropped, not stored', () => {
  /*
   * The whitelist is the point: a sale must not become storage of its own
   * because a caller invented a key. Adding a field is a decision.
   */
  const facts = clientFacts({
    ip: '10.0.0.4',
    note_to_self: 'x'.repeat(5000),
    tracking_pixel: 'https://example.invalid/beacon',
  });

  assert.strictEqual(facts.ip, '10.0.0.4');
  assert.ok(!('note_to_self' in facts));
  assert.ok(!('tracking_pixel' in facts));
});

test('everything is cut to a length, so one order cannot be a megabyte', () => {
  const facts = clientFacts({ user_agent: 'A'.repeat(4000), device_model: 'B'.repeat(4000) });
  assert.strictEqual(facts.user_agent.length, 300);
  assert.strictEqual(facts.device_model.length, 80);
});

test('an order from a phone that says nothing records nothing, not an empty shell', () => {
  assert.strictEqual(clientFacts({}), null);
  assert.strictEqual(clientFacts(null), null);
  assert.strictEqual(clientFacts('not an object'), null);
});

/* ------------------------------------------- what the phone may not claim */

test("the handset's own door reads the address and the waiter from the request", () => {
  /*
   * A phone describes its own hardware. It does not get to name its own
   * address, and it certainly does not get to name who was holding it - a
   * body that could set staff_name could put somebody else's name on an
   * order it placed.
   */
  const where = CONTROLLER.indexOf('async qrOrder(');
  const body = CONTROLLER.slice(where, where + 3000);

  assert.match(body, /ip: clientIp\(req\)/, 'the address is not read from the request');
  assert.match(body, /user_agent: req\.get\('User-Agent'\)/, 'the user agent is not read');
  assert.match(body, /staff_name: String\(req\.user\.name/, 'the waiter is not read from the session');

  /* The spread order decides it: the body first, ours after, so ours wins. */
  const spread = body.indexOf('...(req.body && typeof req.body.client');
  assert.ok(spread > -1 && spread < body.indexOf('ip: clientIp(req)'),
    "a body's own ip would overrule the request's");
});

test('the customer never sees any of it', () => {
  /*
   * customerOrderView is built field by field from a different list. A guest
   * asking where their order has got to is not told which waiter took it, on
   * what phone, from what address.
   */
  const from = REPO.indexOf('customerOrderView(order) {');
  const view = REPO.slice(from, from + 4000);
  for (const secret of ['client', 'device_id', 'staff_name', 'ip']) {
    assert.ok(!view.includes(`${secret}:`), `the customer view carries ${secret}`);
  }
});
