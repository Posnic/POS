'use strict';

/*
 * KOT tickets print on an event now, not on a timer.
 *
 * The API is require()d into the desktop app's main process, so the code that
 * saves a kitchen sale and the code that prints it already share memory. They
 * used to talk over HTTP every five seconds, which is why that screen asked for
 * a Branch ID: a poller is an outsider and has to say whose tickets it wants.
 *
 * The trap this file exists for: the two halves CANNOT import the same module.
 * The API ships outside the ASAR archive (extraResources/server.js) while
 * kot-manager.js lives inside it, so a shared constant would quietly become two
 * constants. The event name is therefore a string literal in both files, and a
 * typo on either side fails silently - tickets simply never print, and nobody
 * finds out until service. So the names are compared here directly.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const { notifyKotReady, KOT_EVENT } = require('../api/src/helpers/kot-notify');

test('a saved kitchen sale announces itself, carrying its own branch', () => {
  const seen = [];
  const listener = (payload) => seen.push(payload);
  process.on(KOT_EVENT, listener);
  try {
    notifyKotReady({ branchId: '69227da6e7ad2d46290fef84', saleId: 'abc', reason: 'created' });
  } finally {
    process.removeListener(KOT_EVENT, listener);
  }

  assert.equal(seen.length, 1, 'the printer was never told');
  /* The branch travels with the event. This is what lets the screen stop
     asking a shopkeeper to type an ObjectId. */
  assert.equal(seen[0].branchId, '69227da6e7ad2d46290fef84');
  assert.equal(seen[0].reason, 'created');
  assert.ok(seen[0].at > 0, 'no timestamp');
});

test('announcing can never fail the sale that triggered it', () => {
  /*
   * The customer has already paid by this point. A printer problem must not
   * turn into a failed sale, so every path through the notifier swallows.
   */
  assert.doesNotThrow(() => notifyKotReady());
  assert.doesNotThrow(() => notifyKotReady(null));
  assert.doesNotThrow(() => notifyKotReady({ branchId: { nested: true }, saleId: 12345 }));

  const seen = [];
  const listener = (p) => seen.push(p);
  process.on(KOT_EVENT, listener);
  try {
    notifyKotReady({});
  } finally {
    process.removeListener(KOT_EVENT, listener);
  }
  assert.equal(seen[0].branchId, '', 'a missing branch should be empty, not undefined');
});

test('both halves agree on the event name, which nothing else enforces', () => {
  /* The whole point of this test file. */
  const manager = read('src/kot-manager.js');
  assert.ok(
    manager.includes(`process.on('${KOT_EVENT}'`),
    `kot-manager.js does not listen for "${KOT_EVENT}"; tickets would never print`
  );
});

test('the sale path emits on both the new order and the amended one', () => {
  /*
   * A table that adds a course needs a fresh ticket as much as a new table
   * does. Missing the update path is how half the orders reach the kitchen.
   */
  const repo = read('api/src/repositories/sale.repository.js');
  const calls = repo.match(/notifyKotReady\(/g) || [];
  assert.ok(calls.length >= 2,
    `expected the created and updated paths to notify, found ${calls.length}`);
  assert.match(repo, /reason: 'created'/);
  assert.match(repo, /reason: 'updated'/);
});

test('polling stays as a safety net, but stops being the primary path', () => {
  /*
   * Not deleted: polling is also what recovers a ticket written while the app
   * was starting, or one whose print failed. Losing an order is worse than
   * printing it late. It just no longer needs to run every five seconds.
   */
  const manager = read('src/kot-manager.js');
  assert.match(manager, /KOT_FALLBACK_POLL_MS\s*=\s*(\d+)/);
  const ms = Number(manager.match(/KOT_FALLBACK_POLL_MS\s*=\s*(\d+)/)[1]);
  assert.ok(ms >= 15000, `fallback poll is ${ms}ms; that is still hammering the API`);
  assert.ok(!/setTimeout\(\(\) => this\._poll\(\), 5000\)/.test(manager),
    'a five second poll is still scheduled somewhere');
});

test('the branch is looked up rather than demanded from the shopkeeper', () => {
  const ipc = read('src/hardware-ipc.js');
  assert.match(ipc, /readLocalBranches/, 'nothing reads the branch list');
  assert.match(ipc, /branchAutoSelected/, 'a single branch is not chosen automatically');

  const html = read('src/hardware-manager.html');
  assert.match(html, /kotBranchSelect/, 'the screen still has no branch dropdown');
  /* The old copy told the user to supply something the app already knew. */
  assert.ok(!/Branch ID is required/.test(html),
    'the screen still demands a Branch ID');
});
