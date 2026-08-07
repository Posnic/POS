/*
 * The API must serve on the port the app derived, not on 5555.
 *
 * Posnic picks its ports from the application name so two brands can be
 * installed on one machine without colliding, and so a stock install does not
 * fight whatever else is already on a common port. resolveLocalPorts does that
 * correctly, writes the answer to .ports.json and prints it at startup.
 *
 * main.js then threw it away. `const API_PORT = process.env.PORT || 5555` runs
 * when the module is first required - before app.whenReady, so PORT is unset
 * and the constant freezes at 5555 - and startServer() assigned that constant
 * back over process.env.PORT before handing control to server.js. Stock Posnic
 * advertised 42590 in .ports.json, in the log and through the get-api-port IPC
 * channel, and served 5555. Two branded installs would have collided on the one
 * port derived ports exist to avoid.
 *
 * These read main.js as text rather than loading it, because requiring main.js
 * starts an Electron application.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAIN = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

test('the API port is never captured in a module-scope constant', () => {
  /* The specific shape that broke: a top-level const reading process.env.PORT.
     Anything evaluated at require time captures the fallback, because main.js
     is required long before it resolves its ports. */
  const moduleScopeCapture = MAIN.split('\n').find((line) =>
    /^\s*(const|let|var)\s+\w*(PORT|Port)\w*\s*=\s*(Number\()?process\.env\.PORT/.test(line),
  );

  assert.strictEqual(
    moduleScopeCapture,
    undefined,
    'main.js captures process.env.PORT at module scope again:\n  ' +
      moduleScopeCapture +
      '\nRead it inside a function - see docs/DEVELOPMENT.md on environment variables.',
  );
});

test('the port is read through a function, and that function exists', () => {
  assert.match(
    MAIN,
    /function apiPort\(\)\s*\{[\s\S]*?process\.env\.PORT/,
    'apiPort() has gone, or no longer reads process.env.PORT',
  );

  /* Every consumer must go through it. A bare 5555 in a URL means somebody
     hardcoded the fallback again. */
  const hardcoded = MAIN.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /localhost:5555|127\.0\.0\.1:5555/.test(line))
    .filter(([, line]) => !line.trim().startsWith('*') && !line.trim().startsWith('//'));

  assert.deepStrictEqual(
    hardcoded.map(([n, l]) => `${n}: ${l.trim()}`),
    [],
    'a URL in main.js hardcodes 5555 instead of calling apiPort()',
  );
});

test('startServer does not overwrite the resolved port', () => {
  /* This is the line that actually did the damage. resolveLocalPorts sets
     process.env.PORT correctly; startServer used to set it straight back. */
  const start = MAIN.indexOf('function startServer()');
  assert.ok(start > 0, 'startServer has gone or been renamed');
  const body = MAIN.slice(start, MAIN.indexOf('\n}', start));

  assert.ok(
    !/process\.env\.PORT\s*=/.test(body),
    'startServer assigns process.env.PORT again. By the time it runs, ' +
      'resolveLocalPorts has already put the derived port there; assigning ' +
      'over it is what made the app serve 5555 while advertising 42590.',
  );
});

test('resolveLocalPorts is what sets the port, exactly once', () => {
  const assignments = MAIN.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*process\.env\.PORT\s*=/.test(line));

  assert.strictEqual(
    assignments.length,
    1,
    'process.env.PORT is assigned in more than one place in main.js:\n  ' +
      assignments.map(([n, l]) => `${n}: ${l.trim()}`).join('\n  ') +
      '\nOne owner, set once, after resolveLocalPorts.',
  );

  const [, line] = assignments[0];
  assert.match(
    line,
    /ports\.apiPort/,
    'the single assignment to process.env.PORT does not come from resolveLocalPorts',
  );
});

test('the derived port really is not 5555, so this matters', () => {
  /* If the derivation happened to return 5555 the bug would have been
     invisible. It does not: it is a hash of the application name. */
  const { derive, API_BASE, MONGO_BASE } = require('../local-ports');
  const stockApi = derive('posnic', API_BASE);

  assert.notStrictEqual(
    stockApi,
    5555,
    'stock Posnic now derives 5555, which would hide this class of bug',
  );
  assert.notStrictEqual(
    stockApi,
    derive('posnic', MONGO_BASE),
    'the API and MongoDB derive the same port',
  );

  /* Two brands must not collide - the whole reason this mechanism exists. */
  assert.notStrictEqual(
    derive('gshcl', API_BASE),
    stockApi,
    'two different brands derive the same API port',
  );
});
