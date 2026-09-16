'use strict';

/*
 * The till and the server agree about what to do with an unanswered order.
 *
 * TWO COPIES, ON PURPOSE. The API ships outside the asar archive and cannot
 * require the desktop shell's modules, so `src/waiting-order-policy.js` and
 * `api/src/utils/waiting-order-policy.js` are the same module twice - the same
 * arrangement as kot-job-key.js and order-source.js.
 *
 * They answer DIFFERENT QUESTIONS from the same verdict, which is why this
 * matters more than it usually would:
 *
 *   the till    reads `alert` and `reach` - what noise to make, and how far
 *               it should travel
 *   the server  reads `decide` - and is the only half that can actually move
 *               a customer's order
 *
 * If the copies drifted, a shop's alarm and a shop's rule would be working to
 * two different clocks: the noise could stop while the order sat there, or the
 * order could be cancelled while the till was still calmly asking about it.
 * Behaviour is compared rather than bytes, because prettier formats the API
 * half and not the shell half, so byte identity is impossible to hold and is
 * not the thing that matters anyway.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const shell = require(path.join(ROOT, 'src', 'waiting-order-policy.js'));
const api = require(path.join(ROOT, 'api', 'src', 'utils', 'waiting-order-policy.js'));

const M = 60 * 1000;

const WAITS = [0, 1, 30, 119, 120, 121, 299, 300, 301, 899, 900, 901, 3600, 86400];
const SINCE = [0, 1000, 20 * 1000, 60 * 1000, 15 * M, Infinity];
const SHOPS = [
  {},
  { onSilence: 'nothing' },
  { onSilence: 'accept' },
  { onSilence: 'accept', decideAfterMinutes: 10 },
  { onSilence: 'cancel', decideAfterMinutes: 5 },
  { onSilence: 'cancel', decideAfterMinutes: 0 },
  { onSilence: 'explode', decideAfterMinutes: 1 },
  { onSilence: 'accept', decideAfterMinutes: 10, partnerWindowMinutes: 8 },
];
const SOURCES = ['', 'online', 'marketplace', 'MARKETPLACE'];

test('THE TWO COPIES ANSWER IDENTICALLY, across every shape an order takes', () => {
  let checked = 0;
  for (const seconds of WAITS) {
    for (const lastAlertedMs of SINCE) {
      for (const source of SOURCES) {
        for (const acknowledged of [true, false]) {
          for (const shop of SHOPS) {
            const order = { waitingMs: seconds * 1000, lastAlertedMs, source, acknowledged };
            assert.deepStrictEqual(
              shell.decide(order, shop),
              api.decide(order, shop),
              `the copies disagree: ${JSON.stringify({ seconds, lastAlertedMs, source, acknowledged, shop })}`
            );
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked >= 1000, `only ${checked} combinations compared`);
});

test('and about what a customer may always do, which no shop can switch off', () => {
  for (const seconds of WAITS) {
    assert.deepStrictEqual(
      shell.customerOptions({ waitingMs: seconds * 1000 }),
      api.customerOptions({ waitingMs: seconds * 1000 })
    );
  }
  assert.strictEqual(shell.customerOptions({ waitingMs: 40 * M }).canRetry, true);
});

test('nonsense reaches the same conclusion on both sides', () => {
  for (const order of [{}, { waitingMs: -5 }, { waitingMs: 'soon' }, { waitingMs: null }, null]) {
    const shop = { onSilence: 'cancel', decideAfterMinutes: 10 };
    assert.deepStrictEqual(
      shell.decide(order || undefined, shop),
      api.decide(order || undefined, shop)
    );
    assert.strictEqual(shell.decide(order || undefined, shop).decide, 'nothing');
  }
});

test('THE STEPS AND THE CHOICES ARE THE SAME LIST', () => {
  /* The backoff is what the till paces itself by and the choices are what the
     server validates a setting against. A copy with an extra step would pace
     differently; one with an extra choice would accept a setting the other
     half treats as nothing. */
  assert.deepStrictEqual(shell.STEPS, api.STEPS);
  assert.deepStrictEqual(shell.ON_SILENCE, api.ON_SILENCE);
  assert.deepStrictEqual([...api.ON_SILENCE], ['nothing', 'accept', 'cancel']);
});

/* --------------------------------------------- the till no longer decides */

test('THE TILL DOES NOT DECIDE ANYTHING, and no longer pretends to', () => {
  /*
   * It used to emit `posnic:order-decided` on the process bus and then delete
   * the order from its pending map. NOTHING LISTENED to that event, so the
   * alarm went quiet - which reads as "somebody dealt with it" - with the
   * order still sitting there and the customer still waiting. That is the
   * exact failure this whole area exists to prevent.
   */
  const fs = require('node:fs');
  const till = fs.readFileSync(path.join(ROOT, 'src', 'order-alert.js'), 'utf8');

  assert.ok(
    !/process\.emit\(\s*['"]posnic:order-decided['"]/.test(till),
    'the till is announcing a decision to nobody again'
  );
  /* And it must not silence itself on a verdict, only on a resolution. */
  assert.ok(
    !/verdict\.decide/.test(till.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the till is acting on the decide half of the verdict again'
  );
  /* The noise half is still read, or the backoff would be decoration. */
  assert.match(till, /verdict\.alert/);
  assert.match(till, /verdict\.reach/);
});

test('and the shop-side rule is actually started, not merely written', () => {
  /*
   * The family of bug this whole change is fixing: a module that decides
   * perfectly and is called by nobody. A wiring test is the only thing that
   * can say otherwise.
   */
  const fs = require('node:fs');
  const server = fs.readFileSync(path.join(ROOT, 'api', 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/src\/services\/unanswered-orders'\)\.start\(\)/);

  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /process\.on\('posnic:order-resolved'/,
    'nothing stops the alarm when the shop rule answers an order');
  assert.match(main, /orderAlert\.resolve\(payload\.saleId\)/);
});
