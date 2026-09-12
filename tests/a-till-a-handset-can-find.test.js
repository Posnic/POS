/*
 * A till a handset can actually find.
 *
 * The desktop app stopped assuming port 5555 for good reasons, and
 * src/local-ports.js states them: 5555 collides with whatever else on the
 * machine had the same idea, and two brands of this app on one machine needed
 * two ports. So the port is derived from the brand name now - "posnic" lands
 * on 42590 - and written to .ports.json.
 *
 * THE HANDSET WAS NEVER TOLD. It sweeps the LAN for 5555 and nothing else, so
 * it probes 254 addresses per subnet on a port the till abandoned and finds
 * nothing, on every network, for every shop.
 *
 * Measured on a real install: the till answers /api/runtime-info with 200 on
 * its derived port and refuses the connection on 5555 - which is precisely
 * what a sweep sees, 254 times over.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'api', 'server.js'), 'utf8');

test('the till also answers on the port a handset sweeps for', () => {
  assert.match(server, /DISCOVERY_PORT/, 'nothing listens for discovery');
  assert.match(
    server,
    /app\.listen\(DISCOVERY_PORT, HOST\)/,
    'discovery does not share the same Express app'
  );
});

test('it defaults to 5555, which is what every shipped handset looks for', () => {
  /* Fixing this in the app instead would leave every handset already in the
     field unable to pair until somebody updated it. */
  assert.match(server, /POSNIC_DISCOVERY_PORT\) \|\| 5555/, 'the default is no longer 5555');
});

test('a busy port is not a failure', () => {
  /*
   * EADDRINUSE is the ordinary case on a machine already running something
   * there - the exact collision that moved the API off 5555 to begin with.
   * The till is already serving on its real port, so this must log and carry
   * on rather than take the server down with it.
   */
  const block = server.slice(server.indexOf('const DISCOVERY_PORT'));
  assert.match(block, /discovery\.on\('error'/, 'a busy discovery port is unhandled');
  assert.ok(
    !/throw|process\.exit/.test(block.slice(0, block.indexOf('});', block.indexOf("'error'")))),
    'a busy discovery port takes the server down'
  );
});

test('it never binds the same port twice', () => {
  /* A cloud instance already on 5555 would otherwise race itself. */
  assert.match(
    server,
    /if \(String\(PORT\) !== String\(DISCOVERY_PORT\)\)/,
    'the same port could be bound twice'
  );
});

test('it binds the same interface the API does', () => {
  /* HOST is 0.0.0.0 by default. Binding discovery to loopback would answer
     this machine and no phone on the Wi-Fi, which is the whole point. */
  const block = server.slice(server.indexOf('const DISCOVERY_PORT'));
  assert.match(block, /DISCOVERY_PORT, HOST/, 'discovery does not bind the API host');
});

/* --------------------------------------------------- the port it moved to */

test('the derived port is what the running till actually uses', () => {
  /*
   * Pinned because this is the number the whole diagnosis rested on: a real
   * install's .ports.json said 42590, and the derivation below is where that
   * comes from. If the algorithm changes, the reasoning above needs revisiting
   * rather than silently drifting.
   */
  const ports = fs.readFileSync(path.join(root, 'src', 'local-ports.js'), 'utf8');
  assert.match(ports, /const API_BASE = 42000/, 'the API range moved');
  assert.match(ports, /const SPAN = 900/, 'the span moved');

  const derive = (name, base) =>
    base + (crypto.createHash('sha256').update(String(name)).digest().readUInt16BE(0) % 900);
  assert.equal(derive('posnic', 42000), 42590, 'a stock install no longer lands on 42590');
});

test('the reason the app left 5555 is still written down', () => {
  /* Because this change puts something back on it, and the next person needs
     to know that was deliberate and narrow rather than a reversal. */
  const ports = fs.readFileSync(path.join(root, 'src', 'local-ports.js'), 'utf8');
  assert.match(ports, /Neither range is ours to assume/, 'the rationale is gone');
});
