/*
 * A MODULE THAT MOVED OUT OF THE ASAR STILL NEEDS ITS NEIGHBOURS.
 *
 * This is the actual cause of the till that answered nothing, and it is a
 * packaging fact rather than a code one.
 *
 * `src/server.js` is not in `build.files`. It is in `extraResources`, copied to
 * the resources root and FLATTENED:
 *
 *     { "from": "src/server.js", "to": "server.js" }
 *
 * So at runtime it is `resources/server.js`, and `require('./handset-slots')`
 * inside it resolves to `resources/handset-slots.js` - not to
 * `resources/app.asar/src/handset-slots.js`, which is a different directory
 * that a relative require cannot reach.
 *
 * `src/handset-slots.js` WAS listed, in `build.files`, so it went into the
 * asar. Beside main.js, which does not use it. Never beside server.js, which
 * does. Every LAN request threw MODULE_NOT_FOUND and was never answered.
 *
 * AND A TEST ALREADY CLAIMED TO PREVENT THIS. It asserted
 *
 *     pkg.build.files.includes('src/handset-slots.js')
 *
 * which was true, and meant nothing, because server.js does not live in
 * build.files. An assertion can be green for the entire life of the bug it
 * names. That is why this one DERIVES the requirement - it reads what
 * server.js actually requires - instead of restating a filename somebody
 * believed was the right one.
 *
 * The rule: anything flattened to the resources root must find every relative
 * require of its own at that same level.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const extra = ((pkg.build && pkg.build.extraResources) || []).filter(
  (e) => e && typeof e === 'object' && typeof e.from === 'string' && typeof e.to === 'string'
);

/** The files copied out of src/ and landed at the resources root. */
const flattened = extra.filter(
  (e) => e.from.startsWith('src/') && e.from.endsWith('.js') && !e.to.includes('/')
);

/** Everything that ends up at the resources root, by the name it lands under. */
const landed = new Set(extra.filter((e) => !e.to.includes('/')).map((e) => e.to.replace(/\.js$/, '')));

/** The relative requires in a file, without its comments. */
function relativeRequires(file) {
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  const found = new Set();
  const pattern = /require\(\s*['"]\.\/([A-Za-z0-9._-]+)['"]\s*\)/g;
  let m;
  while ((m = pattern.exec(source)) !== null) found.add(m[1].replace(/\.js$/, ''));
  return [...found];
}

test('there are flattened resources to check at all', () => {
  /* An assertion over an empty list passes for ever, which is exactly the
     failure this file exists because of. */
  assert.ok(flattened.length >= 5, `expected the flattened src/ resources, found ${flattened.length}`);
  assert.ok(
    flattened.some((e) => e.from === 'src/server.js'),
    'server.js is no longer flattened to the resources root; this whole file assumes it is'
  );
});

test('EVERYTHING A FLATTENED FILE REQUIRES IS FLATTENED BESIDE IT', () => {
  const missing = [];
  for (const entry of flattened) {
    const file = path.join(ROOT, entry.from);
    if (!fs.existsSync(file)) {
      missing.push(`${entry.from} is in extraResources and not on disk`);
      continue;
    }
    for (const needed of relativeRequires(file)) {
      if (!landed.has(needed)) {
        missing.push(
          `${entry.to} requires ./${needed}, which is not copied to the resources root - ` +
            'at runtime that is MODULE_NOT_FOUND, and inside the server it is a request that is never answered'
        );
      }
    }
  }
  assert.deepStrictEqual(missing, [], missing.join('\n'));
});

test('and the module the till actually needed is one of them', () => {
  /* Named as well as derived, because this one cost a shop a service. */
  assert.ok(
    extra.some((e) => e.from === 'src/handset-slots.js' && e.to === 'handset-slots.js'),
    'src/handset-slots.js is not shipped beside server.js again'
  );
  assert.ok(fs.existsSync(path.join(ROOT, 'src', 'handset-slots.js')), 'the module itself is gone');
});

test('a flattened file does not quietly reach up out of its directory', () => {
  /* `require('../something')` works from src/ and cannot work from the
     resources root, where there is no src/ above it. */
  for (const entry of flattened) {
    const file = path.join(ROOT, entry.from);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const climbs = [...source.matchAll(/require\(\s*['"](\.\.\/[A-Za-z0-9._/-]+)['"]\s*\)/g)].map(
      (m) => m[1]
    );
    assert.deepStrictEqual(
      climbs,
      [],
      `${entry.to} requires ${climbs.join(', ')}, which resolves differently once it is flattened to the resources root`
    );
  }
});
