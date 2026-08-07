const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Every electronAPI method the renderer calls must exist on the preload bridge.
 *
 * A mismatch is invisible to both files: preload.js is valid, the caller is
 * valid, and nothing fails until a cashier presses the button and the renderer
 * throws "is not a function" into a console nobody is reading.
 *
 * That is not hypothetical. The live weight display called
 * hardware.getLastWeight, which was never on the bridge - the method is
 * broadcastWeight. It threw on every till, every time, so the display was
 * never seeded with the last reading. On a scale that only transmits when the
 * load changes, that left the weight blank from the moment the shop opened
 * until someone put something on the platter, and the shop reported the scale
 * as not working.
 */
const ROOT = path.join(__dirname, '..');

function bridgeMethods() {
  const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
  const defined = new Set();
  for (const m of preload.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:/gm)) defined.add(m[1]);
  return defined;
}

function rendererFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // Minified vendor bundles are not ours and would only add noise.
      else if (entry.name.endsWith('.js') && !/\.min\.js$/.test(entry.name)) out.push(full);
    }
  })(path.join(ROOT, 'frontend/static/script/js'));
  return out;
}

test('every electronAPI call resolves to a method on the bridge', () => {
  const defined = bridgeMethods();
  const missing = [];

  for (const file of rendererFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const m of source.matchAll(/electronAPI\.(\w+)\.(\w+)\s*\(/g)) {
      if (!defined.has(m[2])) {
        missing.push('electronAPI.' + m[1] + '.' + m[2] + ' (' + path.relative(ROOT, file) + ')');
      }
    }
  }

  assert.deepStrictEqual(missing, [],
    'these calls would throw at the till:\n  ' + missing.join('\n  '));
});

test('the bridge exposes what the scale display needs', () => {
  // Named directly, so removing one from preload.js fails here rather than
  // silently disabling the weight display.
  const defined = bridgeMethods();
  for (const method of ['onUsbData', 'broadcastWeight', 'connectPort', 'disconnectPort']) {
    assert.ok(defined.has(method), 'preload.js no longer exposes ' + method);
  }
});

test('the bridge exposes what the till lock needs', () => {
  /*
   * lock-screen.js reaches these through a local api() helper rather than
   * writing electronAPI.lock.x(...), so the scan above cannot see them. Named
   * here instead: dropping one from preload.js would not break a build, it
   * would quietly stop the till locking.
   */
  const defined = bridgeMethods();
  for (const method of ['users', 'isEnrolled', 'enroll', 'unlock', 'forget', 'onLockRequest']) {
    assert.ok(defined.has(method), 'preload.js no longer exposes lock.' + method);
  }
});
