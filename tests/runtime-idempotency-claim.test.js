const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { buildRuntimeInfo } = require(path.join(ROOT, 'api', 'src', 'utils', 'runtime-info.js'));

test('the server says it dedupes orders, so a handset can resend safely', () => {
  /* A phone that loses the network mid-order cannot tell "never reached the
     kitchen" from "reached it and the reply was lost". Without this flag it
     must hold the order and ask a person; with it, resending is free. */
  assert.equal(buildRuntimeInfo({}).features.idempotentOrders, true);
});

test('the claim matches what the order writer actually does', () => {
  /* Advertising a behaviour the code does not have is how a handset is told
     it may resend into a server that writes a second ticket. */
  const repo = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'repositories', 'sale.repository.js'), 'utf8');
  assert.match(repo, /idempotency_key: String\(idempotencyKey\)/,
    'the flag says orders dedupe, but nothing stores the key');
  assert.match(repo, /if \(already\)/,
    'the flag says orders dedupe, but nothing returns the existing order');
});
