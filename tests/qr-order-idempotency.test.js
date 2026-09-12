/*
 * The same order, sent twice, is one order.
 *
 * A waiter taps send, the Wi-Fi drops before the reply arrives, and the app
 * cannot tell "never reached the kitchen" from "reached it and the answer was
 * lost". Those need opposite responses and look identical from the handset.
 *
 * Both apps have sent an idempotencyKey for as long as they have existed and
 * nothing read it: the field was destructured nowhere and stored nowhere, so
 * every retry wrote another ticket and the kitchen cooked it twice. A key that
 * is sent and ignored is worse than no key, because it reads like protection.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'src', 'repositories', 'sale.repository.js'), 'utf8');

/* The qrOrder path alone: this file holds many order writers and a whole-file
   match would pass on the wrong one. */
function qrOrderSource() {
  /* Named createOnlineOrder since the venue work; it is still the handler
     behind POST /sales/qrOrder. */
  const start = SOURCE.indexOf('async createOnlineOrder(');
  assert.ok(start > -1, 'the online-order writer is gone or renamed again');
  const end = SOURCE.indexOf('\n  async ', start + 10);
  return SOURCE.slice(start, end > -1 ? end : undefined);
}

test('the key the apps already send is read', () => {
  assert.match(qrOrderSource(), /idempotencyKey,/,
    'the field is sent by both apps; destructuring it is what makes it real');
});

test('a repeat returns the order that already exists', () => {
  const source = qrOrderSource();
  assert.match(source, /idempotency_key: String\(idempotencyKey\)/);
  assert.match(source, /if \(already\)/,
    'without returning the existing sale, a resend writes a second ticket');
  assert.match(source, /duplicate: true/,
    'the caller should be able to tell a resend from a fresh order');
});

test('the lookup is scoped to the shop', () => {
  const source = qrOrderSource();
  const lookup = source.slice(source.indexOf('if (idempotencyKey)'), source.indexOf('if (!branchDoc)'));
  assert.match(lookup, /BaseModel\.license/,
    'an unscoped key lookup could match another shop’s order');
});

test('the key is stored, or the lookup can never match', () => {
  const source = qrOrderSource();
  /* The document that is inserted, which is built by name now: the insert
     retries on a bill number another till has just taken, so it needs a
     document it can hand back in. */
  const at = source.indexOf('const saleDocument = {');
  assert.ok(at > -1, 'the order document moved; this test no longer reads the insert');
  const insert = source.slice(at);
  assert.match(insert, /idempotency_key: String\(idempotencyKey\)/,
    'checking for a key that is never written is a check that always passes');
  assert.match(insert, /insertSaleWithFreshNumber\(/,
    'the document must reach an insert, and the retrying one carries the key through');
});

test('an order sent without a key still works', () => {
  /* Orders taken before this shipped have no key, and a handset that does not
     send one must not be refused. */
  const source = qrOrderSource();
  assert.match(source, /\.\.\.\(idempotencyKey \? \{ idempotency_key/,
    'the field is written conditionally, so a keyless order is unaffected');
  assert.match(source, /if \(idempotencyKey\) \{/,
    'the lookup is skipped without a key rather than matching everything');
});
