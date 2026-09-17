'use strict';

/*
 * THE SYNC AGENT FINDS ITS MODULES BY A ROUTE NOBODY CAN SEE.
 *
 * The agent declares bson, dotenv and mongodb, and ships with none of them.
 * Verified on a real installed app: `resources/sync-agent/` contains
 * package.json, src/ and sync-config.json, and no node_modules at all.
 *
 * It works anyway, and it is worth knowing exactly why, because the reason is
 * three files apart from each other and none of them mentions the others:
 *
 *   1. src/server.js bootstraps the in-process API and puts the API's own
 *      node_modules on process.env.NODE_PATH. It does that for the API.
 *   2. src/sync-agent-manager.js spawns the agent with `...process.env`.
 *   3. The agent therefore inherits that NODE_PATH and resolves the three
 *      packages from the API's copy, which already carries all of them.
 *
 * So the agent depends on the API having started first, on a variable set for
 * a different purpose, and on a spread operator. Remove any one and cloud sync
 * dies with MODULE_NOT_FOUND on a customer machine and nowhere else.
 *
 * This is NOT a complaint about the design. Shipping a second copy of mongodb
 * inside the installer to duplicate one the API already has would be real
 * weight for no gain. It is a complaint about the coupling being invisible,
 * which is the shape of every fault found in this app today: correct code,
 * silently relying on something nobody could see from where they were
 * standing.
 *
 * Pinned rather than changed. Cloud sync is load-bearing, and a test costs
 * nothing while rewiring a working spawn costs a shop's orders if it is wrong.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('THE API PUTS ITS node_modules ON NODE_PATH', () => {
  /*
   * Link one. If this stops happening, or stops happening before the agent is
   * spawned, the agent cannot resolve mongodb.
   */
  const server = read('src', 'server.js');

  assert.match(server, /process\.env\.NODE_PATH\s*=/, 'nothing sets NODE_PATH any more');
  assert.match(
    server,
    /apiNodeModules/,
    'NODE_PATH no longer carries the API node_modules the agent borrows'
  );
});

test('AND THE AGENT IS SPAWNED WITH THAT ENVIRONMENT', () => {
  /*
   * Link two. `...process.env` is doing load-bearing work here and reads like
   * boilerplate, which is exactly why it is easy to replace with a tidy
   * explicit list of the variables the agent "needs".
   */
  const manager = read('src', 'sync-agent-manager.js');

  const env = manager.slice(manager.indexOf('const env = {'));
  assert.match(
    env.slice(0, 200),
    /\.\.\.process\.env/,
    'the agent no longer inherits the environment, so it cannot inherit NODE_PATH either'
  );
});

test('the agent asks for exactly what the API already carries', () => {
  /*
   * Link three, and the reason the borrowing works at all. If the agent grows
   * a dependency the API does not have, nothing here will fail: it will fail
   * on a till, at night, as a sync that stopped.
   */
  const agentPkg = path.join(ROOT, '..', 'Gateway', 'apps', 'sync-agent', 'package.json');
  if (!fs.existsSync(agentPkg)) return; /* open-source build: no agent to check */

  const wanted = Object.keys(JSON.parse(fs.readFileSync(agentPkg, 'utf8')).dependencies || {});
  const api = JSON.parse(read('api', 'package.json')).dependencies || {};

  const orphans = wanted.filter((name) => !api[name]);

  assert.deepStrictEqual(
    orphans,
    [],
    `the sync agent needs ${orphans.join(', ')}, which the API does not carry. ` +
      'The agent ships without node_modules and borrows the API copy through ' +
      'NODE_PATH, so this would be MODULE_NOT_FOUND on a customer machine only.'
  );
});

test('AND THE PACKAGING STEP NO LONGER CALLS THE NORMAL CASE A WARNING', () => {
  /*
   * It used to print "WARNING: agent copied without node_modules - run npm
   * install in the Cloud agent first", on every correct build. Following that
   * advice would have made every installer larger to fix nothing.
   *
   * A warning that fires when everything is right is one people learn to
   * scroll past, and then the real one scrolls past too. Two of today's three
   * silent failures were things nobody was told about; this was the opposite,
   * and just as useless.
   */
  const step = read('scripts', 'prepare-sync-agent.js');

  assert.ok(
    !/WARNING: agent copied without node_modules/.test(step),
    'the packaging step still warns about the normal case'
  );
  assert.match(step, /NODE_PATH/, 'it no longer explains where the modules come from');
});
