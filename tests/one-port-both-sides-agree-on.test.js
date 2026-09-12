/*
 * One port, and both sides already agree on it.
 *
 * The Captain app sweeps the Wi-Fi for 5555. When the API moved to a port
 * derived from the brand name, nothing told the app - so it probed 254
 * addresses per subnet on a port the till had abandoned and found nothing, on
 * every network, for every shop. Measured on a real install: the till answered
 * /api/runtime-info with 200 on its derived port and refused the connection on
 * 5555, which is exactly what a sweep sees.
 *
 * The first attempt at this added a SECOND listener on 5555 and justified it
 * as a bridge for handsets already in the field. There are none - the app is
 * unpublished and in testing - so the bridge was solving a problem that did
 * not exist. With no installed base, both sides can simply agree on one port.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ports = fs.readFileSync(path.join(root, 'src', 'local-ports.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');

test('a new install asks for 5555 before deriving anything', () => {
  assert.match(ports, /const DISCOVERY_PORT = 5555/, 'the port the handset looks for is not named');
  assert.match(
    ports,
    /await portIsFree\(DISCOVERY_PORT\)\)\s*\?\s*DISCOVERY_PORT/,
    'a new install does not try 5555 first'
  );
});

test('a machine that cannot have 5555 still starts', () => {
  /*
   * The reasons for deriving a port have not gone away: 5555 collides with
   * whatever else had the same idea, and two brands on one machine need two
   * ports. They are the fallback now rather than the default.
   */
  assert.match(ports, /: await firstFreeFrom\(wantApi, \[mongoPort\]\)/, 'there is no fallback range');
  assert.match(ports, /const API_BASE = 42000/, 'the fallback range is gone');
});

test('an install already on a derived port moves back when it can', () => {
  /*
   * Reusing the saved answer is normally the whole point - the sync agent and
   * the saved credentials hold a URI. But a till on a derived port cannot be
   * found by a handset at all, which is worse than a re-login, and nothing
   * that reads this port is written down: the window, the connector runtime
   * and the hardware bridge all compute it fresh each launch.
   */
  assert.match(
    ports,
    /saved\.apiPort !== DISCOVERY_PORT && \(await portIsFree\(DISCOVERY_PORT\)\)/,
    'an existing install never migrates'
  );
  assert.match(ports, /movedToDiscovery: true/, 'the move is not reported to the caller');
});

test('the move is recorded, so it happens once', () => {
  assert.match(ports, /fs\.writeFileSync\(file, JSON\.stringify\(moved/, 'the new port is not saved');
});

test('a busy 5555 leaves an existing install exactly where it was', () => {
  /* The migration is an improvement, never a requirement. If the port is
     taken, the till keeps the port it has been working on. */
  const block = ports.slice(ports.indexOf('if (saved && saved.mongoPort'));
  assert.match(block, /return \{ \.\.\.saved, reused: true \};/, 'a busy port strands the install');
});

test('Mongo is left where it is', () => {
  /*
   * Nothing outside this machine looks for it, and its data directory is bound
   * to the port it was created with. Moving it would be risk for no gain.
   */
  const block = ports.slice(
    ports.indexOf('if (saved && saved.mongoPort'),
    ports.indexOf('const wantMongo')
  );
  assert.ok(!/mongoPort:\s*DISCOVERY_PORT/.test(block), 'the database port is being moved too');
});

test('there is no second listener any more', () => {
  /*
   * It existed to keep handsets in the field working. There are none, so it
   * was one more socket earning nothing.
   */
  assert.ok(!/DISCOVERY_PORT/.test(server), 'api/server.js still opens a discovery listener');
  assert.equal(
    (server.match(/app\.listen\(/g) || []).length,
    1,
    'the API binds more than one port'
  );
});

test('nothing hard-codes the port on the desktop side', () => {
  /*
   * Why the migration is safe at all: the window, the connector runtime and
   * the hardware bridge each compute the port fresh from one source, so
   * changing it needs no other edit. The only casualty is the session cookie,
   * which is scoped to http://localhost:<port> - and a stale login is already
   * detected and cleared.
   */
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(main, /function apiPort\(\)/, 'the port is no longer read from one place');
  assert.match(main, /clearStaleLogin/, 'a login orphaned by the move would not be cleared');
});
