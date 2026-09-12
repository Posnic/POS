'use strict';

/*
 * Every collection the app writes has a sync decision written down.
 *
 * The restaurant's tables lived in a collection that was in no list: not
 * synced, not marked local, not mentioned. A shop typed thirteen in the
 * cloud, its till showed two, and nothing said a word. This is the fifth
 * time this codebase has shipped something that silently did not run; it is
 * the first time it was a whole collection.
 *
 * api/src/sync/collections.json is the decision, per collection: synced,
 * local_only with a reason, or undecided. This test reads the collection
 * names out of the api source and fails on any that has no entry, so a new
 * collection forces a decision the day it is written. The build separately
 * checks that the bundled sync agent agrees with the "synced" set.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const API = path.join(ROOT, 'api', 'src');
const FILE = path.join(API, 'sync', 'collections.json');
const decisions = JSON.parse(fs.readFileSync(FILE, 'utf8'));

/** Every collection name the api source names, the ways it names them. */
function namedCollections() {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'sync') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      for (const m of src.matchAll(/Collection\s*=\s*['"]([a-z_]+)['"]/g)) names.add(m[1]);
      for (const m of src.matchAll(/\.collection\(\s*['"]([a-z_]+)['"]\s*\)/g)) names.add(m[1]);
      for (const m of src.matchAll(/\bcollection:\s*['"]([a-z_]+)['"]/g)) names.add(m[1]);
    }
  };
  for (const dir of ['models', 'repositories', 'services', 'controllers']) {
    if (fs.existsSync(path.join(API, dir))) walk(path.join(API, dir));
  }
  return [...names].sort();
}

const classified = new Set([
  ...Object.keys(decisions.synced || {}),
  ...Object.keys(decisions.local_only || {}),
  ...Object.keys(decisions.undecided || {}).filter((k) => !k.startsWith('_')),
]);

test('every collection the api writes has a decision', () => {
  const found = namedCollections();
  assert.ok(found.length > 20, `only ${found.length} collections found; has the api layout moved?`);
  const missing = found.filter((c) => !classified.has(c));
  assert.deepStrictEqual(missing, [],
    'these collections exist in the code and in no list - decide, in api/src/sync/collections.json, whether each syncs or stays local and why:\n  ' + missing.join('\n  '));
});

test('a collection is in exactly one list', () => {
  const lists = ['synced', 'local_only', 'undecided'];
  const seen = new Map();
  for (const list of lists) {
    for (const name of Object.keys(decisions[list] || {})) {
      if (name.startsWith('_')) continue;
      assert.ok(!seen.has(name), `${name} is both ${seen.get(name)} and ${list}`);
      seen.set(name, list);
    }
  }
});

test('a synced collection names its scope; a local one gives its reason', () => {
  for (const [name, scope] of Object.entries(decisions.synced)) {
    assert.ok(['branch', 'global'].includes(scope), `${name}: scope "${scope}" is neither branch nor global`);
  }
  for (const [name, why] of Object.entries(decisions.local_only)) {
    assert.ok(typeof why === 'string' && why.length >= 20, `${name}: a local-only collection needs a real reason`);
  }
});

test('the restaurant tables sync, and the tombstone collection with them', () => {
  assert.strictEqual(decisions.synced.tableorder, 'branch');
  assert.strictEqual(decisions.synced.recycle_bin, 'branch', 'deletes travel through recycle_bin; without it every delete is undone by the other side');
});

test('what is still undecided is visible, not buried', () => {
  /* Not a failure: a decision is the owner's. But the count is printed so it
     cannot quietly stay where it is. */
  const pending = Object.keys(decisions.undecided || {}).filter((k) => !k.startsWith('_'));
  console.log(`  ${pending.length} collection(s) still undecided: ${pending.join(', ')}`);
  assert.ok(Array.isArray(pending));
});
