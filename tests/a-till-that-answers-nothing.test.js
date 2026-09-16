/*
 * A TILL THAT ANSWERS NOTHING.
 *
 * The worst failure this server has, and it reached a shop.
 *
 * A build arrived with `server.js` asking for `./handset-slots` and the file
 * not beside it. The require sat INSIDE the per-request path, and the request
 * path is an override of `server.emit`, so the throw did not become a 500 - it
 * escaped as an uncaught exception and the request was never answered at all.
 * The handset held an open socket until it timed out. Nothing appeared on the
 * till. The shop was told the captain app keeps disconnecting.
 *
 * The log said this, once per request, and nobody was reading it:
 *
 *   [MobileTracker] External request: 192.168.1.2 -> GET /api
 *   [FATAL] Uncaught Exception: Cannot find module './handset-slots'
 *
 * And localhost stayed instant throughout, because the slots are only
 * consulted for non-loopback callers. So every test anybody ran on the machine
 * itself passed.
 *
 * TWO THINGS ARE PINNED HERE.
 *
 *   The module is required ONCE, at the top of the file. A require in the
 *   request path is evaluated per request, which is what turns a missing file
 *   into an invisible hang instead of one line at startup.
 *
 *   The decision NEVER throws and ALWAYS answers. If the thing that decides is
 *   gone, broken, or returns nonsense, the handset is admitted. The cap exists
 *   so a shop is not silently serving a stranger's phone; it is not a security
 *   boundary, the API's authentication is. A till that stops answering its
 *   handsets mid-service is the larger harm, and every outage handset-slots.js
 *   documents came from refusing a handset that should have been served.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'src', 'server.js');
const source = fs.readFileSync(SERVER, 'utf8');

/* Comments are stripped before anything is asserted about the body. An
   assertion that matches its own explaining comment has been written in this
   repo five times now. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

/** The body of a top-level function, by matching its braces. */
function lift(name) {
  const at = code.indexOf(`function ${name}(`);
  assert.notStrictEqual(at, -1, `${name} is gone from server.js`);
  let depth = 0;
  let started = false;
  for (let i = at; i < code.length; i += 1) {
    if (code[i] === '{') {
      depth += 1;
      started = true;
    } else if (code[i] === '}') {
      depth -= 1;
      if (started && depth === 0) {
        const body = code.slice(at, i + 1);
        // eslint-disable-next-line no-new-func
        return new Function(`${body}; return ${name};`)();
      }
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

const admitHandset = lift('admitHandset');

const ASK = Object.freeze({
  devices: {},
  blocked: [],
  ip: '192.168.1.9',
  method: 'GET',
  url: '/api',
  maxDevices: 6,
});

/* ------------------------------------------------- it still does its job */

test('a working slots module decides, and its refusal is passed through', () => {
  const slots = {
    admit: () => ({ allow: false, code: 'DEVICE_BLOCKED', message: 'blocked' }),
  };
  const verdict = admitHandset(slots, ASK, () => {});
  assert.strictEqual(verdict.allow, false, 'a real refusal was overruled');
  assert.strictEqual(verdict.code, 'DEVICE_BLOCKED', 'the reason was lost');
});

test('and what it is asked is what the caller passed', () => {
  let saw = null;
  admitHandset({ admit: (ask) => ((saw = ask), { allow: true }) }, ASK, () => {});
  assert.deepStrictEqual(saw, ASK, 'the question changed on the way in');
});

/* -------------------------------------------- AND IT ALWAYS ANSWERS */

test('THE MODULE BEING GONE ADMITS THE HANDSET, it does not throw', () => {
  /* The shop failure, exactly: server.js present, handset-slots.js absent. */
  let told = false;
  const verdict = admitHandset(null, ASK, () => {
    told = true;
  });
  assert.strictEqual(verdict.allow, true, 'a missing file stopped a handset being served');
  assert.strictEqual(verdict.register, true, 'the device was not recorded either');
  assert.ok(told, 'nothing said the cap had stopped being applied');
});

test('a slots module that throws admits the handset', () => {
  const slots = {
    admit: () => {
      throw new Error('boom');
    },
  };
  let seen = null;
  const verdict = admitHandset(slots, ASK, (err) => {
    seen = err;
  });
  assert.strictEqual(verdict.allow, true, 'a throw stopped a handset being served');
  assert.strictEqual(seen && seen.message, 'boom', 'the cause was swallowed');
});

test('a slots module that answers nonsense admits the handset', () => {
  for (const answer of [undefined, null, {}, { allow: 'yes' }, 'nope', 42]) {
    const verdict = admitHandset({ admit: () => answer }, ASK, () => {});
    assert.strictEqual(
      verdict.allow,
      true,
      `an answer of ${JSON.stringify(answer)} was treated as a decision`
    );
  }
});

test('and something that is not a module at all admits the handset', () => {
  for (const notAModule of [undefined, {}, { admit: null }, { admit: 'x' }, 7]) {
    const verdict = admitHandset(notAModule, ASK, () => {});
    assert.strictEqual(verdict.allow, true, 'a broken module stopped a handset being served');
  }
});

test('it does not need somebody to tell', () => {
  /* The caller passes a reporter today. It must not become the reason a till
     falls over tomorrow. */
  assert.strictEqual(admitHandset(null, ASK).allow, true);
  assert.strictEqual(admitHandset({ admit: () => ({ allow: true }) }, ASK).allow, true);
});

/* ------------------------------------------ and where the require lives */

test('THE MODULE IS REQUIRED AT THE TOP OF THE FILE, NOT PER REQUEST', () => {
  /*
   * The whole difference between one line in the log at startup and a hang
   * nobody can see. A require inside the emit override runs on every LAN
   * request and throws on every LAN request.
   */
  const required = code.indexOf("require('./handset-slots')");
  assert.notStrictEqual(required, -1, 'the server no longer consults the slots at all');

  const emitOverride = code.indexOf('server.emit = function');
  assert.notStrictEqual(emitOverride, -1, 'the request path has moved; check this test still means what it says');

  assert.ok(
    required < emitOverride,
    'handset-slots is required inside the request path again, so a missing file will hang every LAN request instead of failing once at startup'
  );
});

test('and the require is guarded, so a missing file cannot stop the server booting', () => {
  const required = code.indexOf("require('./handset-slots')");
  const before = code.slice(Math.max(0, required - 400), required);
  assert.match(before, /try\s*\{/, 'the require is unguarded, so a missing file now kills startup instead');
});

test('the request path asks admitHandset, never .admit directly', () => {
  /*
   * Narrowed to the request path on purpose. admitHandset itself calls
   * `slots.admit`, inside the try that makes it safe - banning the call
   * outright would ban the fix. What must never come back is that call in a
   * position where a throw escapes into the emit override.
   */
  const emitOverride = code.indexOf('server.emit = function');
  assert.notStrictEqual(emitOverride, -1, 'the request path has moved; check this test still means what it says');
  const requestPath = code.slice(emitOverride);

  assert.doesNotMatch(
    requestPath,
    /\.admit\(/,
    'something calls .admit directly inside the request path again, which is the call whose throw is never answered'
  );
  assert.match(requestPath, /admitHandset\(/, 'the request path no longer goes through the guarded call');
});

/* --------------------------------------------------- and it gets packaged */

test('and the file is still shipped, because none of the above helps if it is not', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = (pkg.build && pkg.build.files) || [];
  assert.ok(
    files.some((f) => String(f).includes('src/handset-slots.js')),
    'src/handset-slots.js is not in build.files, so the next installer ships without it'
  );
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'handset-slots.js')), 'the module itself is gone');
});
