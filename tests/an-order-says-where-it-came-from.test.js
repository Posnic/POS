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

/*
 * The controller's own behaviour is tested by CALLING it, in
 * api/tests/unit/controllers/an-order-says-where-it-came-from.test.js: a real
 * handler, a real-shaped request, and an assertion about what reaches the
 * service - including that a body claiming its own address or another
 * waiter's name is overruled.
 *
 * What was here instead was a regular expression over the controller's source,
 * checking that `clientIp(req)` appeared in it and that one spread came before
 * another. That is not a test of behaviour: it passes if the block is
 * unreachable, it passes if an early return skips it, and it would pass
 * against a file that never ran. It has been replaced rather than kept
 * alongside, because two tests of one thing where one of them cannot fail
 * honestly is worse than one.
 */

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
