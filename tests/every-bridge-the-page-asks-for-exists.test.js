'use strict';

/*
 * A PAGE CANNOT ASK FOR A BRIDGE NOBODY EXPOSED.
 *
 * The kitchen announcement was complete, tested, shipped, and unreachable for
 * its whole life. Both of its consumers opened with:
 *
 *     var bridge = window.posnic && window.posnic.kitchenCall;
 *
 * and there has never been a `window.posnic`. The preload exposes three
 * worlds - electronAPI, electron, posnicKitchenScreen - and kitchenCall sits
 * on the first, beside orderAlert, which every other consumer in the app reads
 * correctly.
 *
 * So the renderer returned on its first line on every till that ever ran it,
 * and the Hardware Manager tab, which hides itself when the bridge is missing
 * so that a browser is never shown a dead switch, hid itself on every machine.
 * The owner opened that window and found nothing there.
 *
 * Nothing caught it: the main process was right, the preload was right, the
 * page was right, the tests were right, and the two halves disagreed about one
 * word. Three true things pointed at that word - the app is called Posnic, the
 * ipc channels are `posnic:kitchen-call`, and the preload's own comments
 * documented the api as `posnic.kitchenCall`.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const PRELOAD = read('src', 'preload.js');

/*
 * Comments and strings out first, or braces inside them are counted as
 * structure. The first version of this file read a `{` out of a comment and
 * concluded kitchenCall was not on electronAPI - the same class of mistake it
 * exists to catch.
 */
function code(source) {
  let out = '';
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '*') {
      const to = source.indexOf('*/', i + 2);
      i = to === -1 ? source.length : to + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      const to = source.indexOf('\n', i);
      i = to === -1 ? source.length : to;
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += quote + quote;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** The block `exposeInMainWorld('name', { ... })`, by matching its braces. */
function exposedWorlds(source) {
  const worlds = {};
  const bare = code(source);

  /* The names went out with the strings, so they are read from the original
     in the order the openers appear. */
  const names = [...source.matchAll(/exposeInMainWorld\(\s*'([^']+)'/g)].map((m) => m[1]);
  const opener = /exposeInMainWorld\(\s*''\s*,\s*\{/g;

  let found;
  let nth = 0;
  while ((found = opener.exec(bare)) !== null) {
    const name = names[nth];
    nth += 1;

    let depth = 1;
    let i = opener.lastIndex;
    const from = i;

    while (i < bare.length && depth > 0) {
      const c = bare[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      i += 1;
    }
    if (name) worlds[name] = bare.slice(from, i - 1);
  }
  return worlds;
}

/** The keys one level down, which is what a page reaches for. */
function topLevelKeys(block) {
  const keys = [];
  let depth = 0;

  for (const line of block.split('\n')) {
    const key = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    if (depth === 0 && key) keys.push(key[1]);

    for (const c of line) {
      if (c === '{' || c === '(' || c === '[') depth += 1;
      if (c === '}' || c === ')' || c === ']') depth -= 1;
    }
  }
  return keys;
}

const WORLDS = exposedWorlds(PRELOAD);

/* Which global carries each api: { kitchenCall: 'electronAPI', ... } */
const owner = {};
for (const [world, block] of Object.entries(WORLDS)) {
  for (const key of topLevelKeys(block)) {
    if (!owner[key]) owner[key] = world;
  }
}

test('THE PRELOAD IS READABLE AT ALL, or nothing below means anything', () => {
  assert.ok(Object.keys(WORLDS).length >= 2, 'no exposed worlds found: ' + Object.keys(WORLDS));
  assert.ok(WORLDS.electronAPI, 'electronAPI is gone, which would be news');
  assert.ok(Object.keys(owner).length > 10, 'no apis were found inside them');
});

test('kitchenCall is on electronAPI, which is what the pages must read', () => {
  assert.strictEqual(owner.kitchenCall, 'electronAPI');
  assert.strictEqual(owner.orderAlert, 'electronAPI');
});

/* --------------------------------------------------- what the pages ask for */

const CONSUMERS = [
  ['frontend', 'static', 'script', 'js', 'core', 'kitchen-call.js'],
  ['frontend', 'static', 'script', 'js', 'core', 'order-alert.js'],
  ['frontend', 'static', 'script', 'js', 'core', 'online-order-watch.js'],
  ['frontend', 'static', 'script', 'js', 'modules', 'js', 'online_orders.js'],
  ['src', 'hardware-manager.html'],
];

test('EVERY PAGE READS THE BRIDGE OFF A GLOBAL THAT IS ACTUALLY EXPOSED', () => {
  const wrong = new Set();

  for (const where of CONSUMERS) {
    const source = code(read(...where));

    for (const use of source.matchAll(/window\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
      const [, global, key] = use;
      /* Only names the preload actually publishes are this test's business.
         A page reading window.document or window.PosnicPro is not. */
      if (!owner[key]) continue;
      if (global !== owner[key]) {
        wrong.add(`${where.join('/')}: window.${global}.${key} - ${key} is on ${owner[key]}`);
      }
    }
  }

  assert.deepEqual(
    [...wrong],
    [],
    'a page asks for a bridge off the wrong global, which fails silently:\n  ' +
      [...wrong].join('\n  ')
  );
});

test('the preload does not document an api under a name it does not expose', () => {
  /* Where the wrong name came from. A comment is what somebody copies. */
  assert.doesNotMatch(
    PRELOAD,
    /posnic\.kitchenCall\./,
    'the comments still say posnic.kitchenCall'
  );
});
