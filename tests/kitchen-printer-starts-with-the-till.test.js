'use strict';

/*
 * The kitchen printer starts with the till, not when somebody opens a window.
 *
 * Owner, from a restaurant: "prints are very slow. as soon receive order it
 * needs to print."
 *
 * Constructing KOTManager is not the same as running it. The only caller of
 * startPolling lived inside the Hardware Manager window, and _onKotEvent
 * returns on its first line unless isPolling. So after every restart, update
 * or power cut a kitchen printed NOTHING - not by the event, and not by the
 * thirty second safety net, because neither was running - until a person
 * opened that window and landed on the KOT tab. To a kitchen that presents as
 * "very slow": the tickets arrive whenever somebody opens a settings screen.
 *
 * BillManager beside it has always started itself, and says so in its own
 * comment. These pin the asymmetry closed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const KOT = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');

test('the till starts kitchen polling itself, from the config already on disk', () => {
  const start = MAIN.indexOf('kotManager = new KOTManager(');
  assert.notStrictEqual(start, -1, 'the kitchen manager is no longer constructed in main');
  const after = MAIN.slice(start, start + 2400);
  assert.match(after, /await kotManager\.startPolling\(kotConfig\);/,
    'nothing in the till start-up starts the kitchen printer');
  assert.match(after, /await kotManager\.loadConfig\(\)/,
    'it does not read the config that is already saved');
});

test('a till that was never given a kitchen printer starts nothing', () => {
  /* Unchanged behaviour for every shop that does not use one, and the reason
     this cannot simply call startPolling unconditionally: the poll would ask
     the API about a branch it does not have, every thirty seconds, forever. */
  const start = MAIN.indexOf('kotManager = new KOTManager(');
  const after = MAIN.slice(start, start + 2400);
  assert.match(after, /if \(kotConfig && kotConfig\.branchId && printers\.length\)/,
    'it starts without checking there is a branch and a printer');
  assert.match(after, /printerNames\.filter\(\(n\) => n && String\(n\)\.trim\(\)\)/,
    'a config holding one empty printer name counts as configured');
});

test('a kitchen printer that will not start does not stop the till opening', () => {
  const start = MAIN.indexOf('kotManager = new KOTManager(');
  const after = MAIN.slice(start, start + 2400);
  assert.match(after, /catch \(error\) \{[\s\S]{0,220}KOT polling could not be started/,
    'a failure here would take the whole till down with it');
});

test('the event still refuses to act when polling is off, which is why this was needed', () => {
  /* If this guard ever goes, the test above stops describing anything real. */
  assert.match(KOT, /_onKotEvent\(payload = \{\}\) \{\s*if \(!this\.isPolling \|\| !this\.config\) return;/,
    'the event no longer depends on polling being started');
});

test('the bill manager, which always did this, still does', () => {
  assert.match(MAIN, /billManager\.start\(\);/, 'the bill poller no longer starts itself');
  assert.ok(
    MAIN.indexOf('kotManager = new KOTManager(') < MAIN.indexOf('billManager.start();'),
    'the two starters have been reordered; the comments beside them refer to each other'
  );
});
