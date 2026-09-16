'use strict';

/*
 * A week of watching, and somewhere to read the answer.
 *
 * The kitchen still prints through the old path. Beside it, the print queue
 * records what IT believes should print and prints nothing - the first step of
 * the rollout rule for this whole area:
 *
 *   "Shadow. Run the new path alongside the old, comparing and printing
 *    nothing."
 *
 * `disagreements()` could answer the comparison from the day it was written
 * and NOTHING EVER CALLED IT. The shadow ran, recorded faithfully, and its
 * answer went into a collection with no door on it - so the cutover it exists
 * to justify could never be justified, and the largest remaining piece of work
 * in this area was blocked on a function nobody could reach.
 *
 * That is the ninth capability in this codebase written, tested, merged and
 * called by nobody, so this file checks the chain link by link the way
 * a-bill-that-never-printed-is-visible.test.js does.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const SHADOW = read('api/src/repositories/kot-shadow.repository.js');
const CONTROLLER = read('api/src/controllers/sales.controller.js');
const ROUTES = read('api/src/routes/sales.routes.js');
const TILL = read('src/bill-manager.js');
const IPC = read('src/hardware-ipc.js');
const PRELOAD = read('src/preload.js');
const SCREEN = read('src/hardware-manager.html');

/* ------------------------------------------------------- it still prints nothing */

test('THE SHADOW STILL CANNOT REACH A PRINTER, which is the whole premise', () => {
  /*
   * Checked first and every time. Everything else here is about reading a
   * measurement; if the measurement ever starts printing, ninety kitchens get
   * a second copy of every ticket.
   */
  assert.match(SHADOW, /status: 'shadow',/);
  assert.match(SHADOW, /payload: \{\},/, 'a shadow row is carrying something printable');
  const queue = read('api/src/repositories/print-job.repository.js');
  assert.match(queue, /status: 'queued',/);
  assert.ok(!/status: \{ \$in: \[[^\]]*shadow/.test(queue), 'the claim can now match a shadow row');
});

/* ---------------------------------------------------- the answer has a door */

test('THERE IS A SUMMARY, and a route onto it', () => {
  assert.match(SHADOW, /async function summary\(/);
  assert.match(SHADOW, /module\.exports = \{[^}]*summary/);
  assert.match(ROUTES, /'\/kitchenQueueShadow'/);
  assert.match(CONTROLLER, /async kitchenQueueShadow\(req, res\)/);
  assert.match(CONTROLLER, /shadow\.summary\(\{/);
});

test('it is read-only, and behind the same guard as the rest of printing', () => {
  const at = ROUTES.indexOf("'/kitchenQueueShadow'");
  const around = ROUTES.slice(at - 200, at + 200);
  assert.match(around, /ensurePrintDevice/, 'the shadow reading is not behind the till guard');

  const method = CONTROLLER.slice(CONTROLLER.indexOf('async kitchenQueueShadow'));
  const body = method.slice(0, method.indexOf('\n  }\n'));
  for (const write of ['updateOne', 'updateMany', 'deleteMany', 'insertOne', 'queuePrintJob']) {
    assert.ok(!body.includes(write), `the summary is writing (${write})`);
  }
});

test('A WINDOW A PERSON ASKED FOR IS BOUNDED, because a number is not a query', () => {
  /* Otherwise days=99999 walks a shop's whole history to draw one percentage. */
  const method = CONTROLLER.slice(CONTROLLER.indexOf('async kitchenQueueShadow'));
  const body = method.slice(0, method.indexOf('\n  }\n'));
  assert.match(body, /Math\.max\(1, Math\.min\(30, Number\(req\.body\.days\) \|\| 7\)\)/);
});

/* ------------------------------------------------- and the chain to a screen */

test('the till can ask, the IPC carries it, and the page has a door onto it', () => {
  assert.match(TILL, /async shadowSummary\(days\)/);
  assert.match(TILL, /kitchenQueueShadow/);
  assert.match(IPC, /ipcMain\.handle\('kot:shadow-summary'/);
  assert.match(IPC, /billManager\.shadowSummary\(days\)/);
  assert.match(PRELOAD, /shadowSummary: \(days\) => ipcRenderer\.invoke\('kot:shadow-summary', days\)/);
});

test('AND THE SCREEN ACTUALLY CALLS IT', () => {
  /* The link that has been missing every previous time this shape appeared. */
  assert.match(SCREEN, /id="kotShadowCard"/);
  assert.match(SCREEN, /id="kotShadowBody"/);
  assert.match(SCREEN, /window\.electronAPI\.bill\.shadowSummary\(7\)/);
  assert.match(SCREEN, /kotDrawShadow\(\);/, 'the panel is never drawn');
});

test('a shop with nothing to say is told nothing, not a made-up number', () => {
  /*
   * A percentage of zero tickets is 0%, which reads as "it is all going
   * wrong" to the one person whose job it is to decide whether to cut the
   * kitchen over.
   */
  const fn = SCREEN.slice(SCREEN.indexOf('async function kotDrawShadow'));
  const body = fn.slice(0, fn.indexOf('\n        }\n'));
  assert.match(body, /if \(!said \|\| !Number\(said\.expected\)\) \{/);
  assert.match(body, /card\.style\.display = 'none';/);
});

test('and a server too old to answer leaves the card hidden rather than erroring', () => {
  const fn = TILL.slice(TILL.indexOf('async shadowSummary'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /if \(!response\.ok\) return null;/);
  assert.match(body, /catch \(e\) \{/);
});

/* -------------------------------------------- the direction nobody could see */

test('A TICKET PRINTED THAT NOTHING ASKED FOR IS COUNTED, and it was not', () => {
  /*
   * The shadow's own notes name two disagreements:
   *
   *   queued, never reported   a ticket the server expected and the till never
   *                            said it printed
   *   reported, never queued   the till printed something the server did not
   *                            expect - the shape a duplicate has
   *
   * Only the first was ever visible. Keys the till reported that matched no
   * row simply did not match and were dropped, so the shadow could see the
   * cheap half and not the expensive one: a missing ticket is loud and costs a
   * reminder, a duplicate is silent and costs food.
   */
  assert.match(SHADOW, /let unexpected = 0;/);
  assert.match(SHADOW, /unexpected = list\.filter\(\(key\) => !seen\.has\(key\)\)\.length;/);
  assert.match(SHADOW, /data: \{ closed, by: 'key', unexpected \}/);
});

test('and counting it can never fail a report', () => {
  /* It runs inside the path that feeds every kitchen. A measurement that
     breaks a service is worse than no measurement. */
  const fn = SHADOW.slice(SHADOW.indexOf('let unexpected = 0;'));
  const body = fn.slice(0, fn.indexOf('return { status: true, data: { closed'));
  assert.match(body, /try \{/);
  assert.match(body, /catch \(e\) \{[\s\S]*unexpected = 0;/);
});

/* ------------------------------------------------------- what it must not do */

test('the summary counts rather than reading documents back', () => {
  /*
   * It is drawn on a screen a shopkeeper opens, so it has to be cheap. Three
   * countDocuments over an indexed status and one document for the oldest,
   * never a list of a week of tickets.
   */
  const fn = SHADOW.slice(SHADOW.indexOf('async function summary('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.strictEqual((body.match(/countDocuments\(/g) || []).length, 3);
  assert.match(body, /\.limit\(1\)/, 'the oldest row is not bounded to one');
});

test('a summary without a branch counts nothing, rather than every shop', () => {
  const fn = SHADOW.slice(SHADOW.indexOf('async function summary('));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /if \(!branchId\) return \{ status: true, data: empty \};/);
});
