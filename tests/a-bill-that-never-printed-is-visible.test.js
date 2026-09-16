'use strict';

/*
 * A bill nobody can account for now has somewhere to be answered.
 *
 * WHAT WAS THERE
 *
 * The print queue parks a job in `needs_attention` when the till that claimed
 * it went quiet, or when it failed every attempt. Its own comment says what
 * that status is for: "where a person decides". Two functions were written for
 * that person - `jobsNeedingAttention` and `resolveAttention` - and both were
 * reachable from NOWHERE AT ALL. No route, no controller, no screen.
 *
 * So the queue asked "did this bill print?" and there was no door to answer
 * through. A guest waited at a table for paper that never came, and the only
 * clue anywhere was a status field nobody could read.
 *
 * This is the eighth time this codebase has had a capability that was written,
 * tested, merged and called by nobody, so the tests here are as much about the
 * WIRING as about the behaviour: the chain from the button to the database is
 * checked link by link, because every one of those links has been the missing
 * one at some point.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const ROUTES = read('api/src/routes/sales.routes.js');
const CONTROLLER = read('api/src/controllers/sales.controller.js');
const QUEUE = read('api/src/repositories/print-job.repository.js');
const TILL = read('src/bill-manager.js');
const IPC = read('src/hardware-ipc.js');
const PRELOAD = read('src/preload.js');
const SCREEN = read('src/hardware-manager.html');

/* --------------------------------------------- the chain, link by link */

test('THE QUEUE STILL PARKS A JOB FOR A PERSON, which is what all of this is for', () => {
  /* If this stops happening the rest is decoration, so it is checked first. */
  assert.match(QUEUE, /const NEEDS_ATTENTION = 'needs_attention';/);
  assert.match(QUEUE, /status: NEEDS_ATTENTION,\n\s*last_error:/,
    'a till that goes quiet no longer parks its job');
  assert.match(QUEUE, /status: ok \? 'done' : exhausted \? NEEDS_ATTENTION : 'queued'/,
    'a job that failed every attempt no longer waits for anybody');
});

test('THERE IS A ROUTE TO IT, which there was not', () => {
  assert.match(ROUTES, /router\.post\(\s*\n?\s*'\/printJobsNeedingAttention'/);
  assert.match(ROUTES, /router\.post\(\s*\n?\s*'\/resolvePrintJob'/);
  /* Behind the same door the till already uses for the queue: an allowed till
     may take jobs, say what happened, and answer the ones left over. */
  const block = ROUTES.slice(ROUTES.indexOf("'/claimPrintJobs'"));
  const upTo = block.slice(0, block.indexOf('markKitchenPrinted'));
  /* EVERY route in that block, not a fixed number of guards. A count breaks
     the day a fifth printing route is added and says nothing about whether the
     new one is guarded - which is the only thing worth asserting. */
  const routes = (upTo.match(/router\.post\(/g) || []).length;
  const guards = (upTo.match(/ensurePrintDevice/g) || []).length;
  assert.ok(routes >= 4, `only ${routes} printing routes found`);
  assert.strictEqual(guards, routes, 'a printing route is not behind the till guard');
});

test('and a controller behind the route', () => {
  assert.match(CONTROLLER, /async printJobsNeedingAttention\(req, res\)/);
  assert.match(CONTROLLER, /async resolvePrintJob\(req, res\)/);
  assert.match(CONTROLLER, /require\('\.\.\/repositories\/print-job\.repository'\)/);
  assert.match(CONTROLLER, /jobsNeedingAttention\(\{/);
  assert.match(CONTROLLER, /resolveAttention\(req\.body\.id/);
});

test('A LIST IS A LIST, and never carries a whole bill', () => {
  /*
   * The payload of a print job is the bill itself. Handing that to a screen
   * that only needs a label would put a customer's order through an IPC
   * channel to be shown as a heading.
   */
  const method = CONTROLLER.slice(CONTROLLER.indexOf('async printJobsNeedingAttention'));
  const whole = method.slice(0, method.indexOf('\n  }\n'));
  /* COMMENTS STRIPPED FIRST. The comment above the mapping says the word
     "payload" while explaining that it is left out, and a bare search for it
     matched that and failed - the assertion-that-matches-its-own-explanation
     trap, met here for the fourth time in this codebase. */
  const body = whole.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/payload/.test(body), 'the list is carrying the bill itself');
  for (const field of ['id', 'label', 'at', 'attempts', 'why']) {
    assert.ok(body.includes(field + ':'), `the list does not say ${field}`);
  }
});

test('the till reads it on the pass it was already making', () => {
  /* A second poll for this would be a second poll on a shop's network to
     answer a question the first one could have. */
  assert.match(TILL, /async _readWaiting\(base, key\)/);
  assert.match(TILL, /await this\._readWaiting\(base, key\);/);
  assert.match(TILL, /printJobsNeedingAttention/);
  /* And it reports it, or the screen has nothing to draw. */
  assert.match(TILL, /waiting: this\.waiting,/);
});

test('AND READING IT NEVER COSTS THE TILL A PRINT', () => {
  /*
   * A till that cannot read this list still has bills to print, and printing
   * them matters more than counting what went wrong earlier. An older shop
   * server has no such endpoint at all.
   */
  const method = TILL.slice(TILL.indexOf('async _readWaiting'));
  const body = method.slice(0, method.indexOf('\n  }\n'));
  assert.match(body, /try \{/);
  assert.match(body, /catch \(e\) \{/);
  assert.match(body, /if \(!response\.ok\) return;/);
});

test('there is an IPC channel, and a preload door onto it', () => {
  assert.match(IPC, /ipcMain\.handle\('bill:answer-waiting'/);
  assert.match(IPC, /billManager\.answerWaiting\(id, printed === true\)/);
  assert.match(PRELOAD, /answerWaiting: \(id, printed\) => ipcRenderer\.invoke\('bill:answer-waiting', id, printed\)/);
});

test('AND A SCREEN THAT ACTUALLY CALLS IT', () => {
  /*
   * The link that has been missing every previous time. A button that exists
   * and calls nothing is the same bug wearing a different hat.
   */
  assert.match(SCREEN, /id="bpWaiting"/);
  assert.match(SCREEN, /id="bpWaitingRows"/);
  assert.match(SCREEN, /bpDrawWaiting\(Array\.isArray\(s\.waiting\) \? s\.waiting : \[\]\)/,
    'the status is read but the list is never drawn');
  assert.match(SCREEN, /window\.electronAPI\.bill\.answerWaiting\(id, printed\)/,
    'the buttons do not reach the till');
});

/* ------------------------------------------------- what the two answers mean */

test('THE TWO ANSWERS ARE THE ONLY TWO THERE CAN BE', () => {
  /*
   * "It printed" closes it. "Print it again" puts it back on the queue. There
   * is deliberately no third option and no automatic guess: only somebody
   * standing at the printer knows what came out of it, and guessing on their
   * behalf is how a table gets two bills or none.
   */
  assert.match(SCREEN, /\['It printed', true\], \['Print it again', false\]/);
  assert.match(QUEUE, /status: printed \? 'done' : 'queued',/);
});

test('and answering twice cannot undo the first answer', () => {
  assert.match(QUEUE, /if \(job\.status !== NEEDS_ATTENTION\) \{/);
  assert.match(QUEUE, /message: 'Already answered'/);
  /* The screen disables the pair while it asks, so a slow network does not
     become two questions about one job. */
  assert.match(SCREEN, /b\.disabled = true;/);
});

test('a failure leaves the buttons usable and says what happened', () => {
  /* A row that goes dead on a failed tap is a bill that can never be
     answered, which is worse than the state this replaces. */
  const fn = SCREEN.slice(SCREEN.indexOf('async function bpAnswerWaiting'));
  const body = fn.slice(0, fn.indexOf('\n        }\n'));
  assert.match(body, /b\.disabled = false;/);
  assert.match(body, /Could not answer that: /);
});

/* ------------------------------------------------------- it is still packaged */

test('every file in the chain ships', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const file of ['src/bill-manager.js', 'src/hardware-ipc.js', 'src/preload.js']) {
    assert.ok(pkg.build.files.includes(file), `${file} is not in the packaged build`);
  }
});
