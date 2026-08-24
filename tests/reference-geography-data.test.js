const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiPath = path.join(root, 'api', 'src', 'json', 'states.json');
const frontendPath = path.join(root, 'frontend', 'static', 'json', 'states.json');

function readCatalog(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')).states;
}

test('API and frontend state catalogs stay synchronized', () => {
  assert.deepStrictEqual(readCatalog(apiPath), readCatalog(frontendPath));
});

test('state names contain no common UTF-8 mojibake markers', () => {
  const mojibakeMarkers = /[\u00c2\u00c3\u00e2\u00f0\ufffd]/u;

  for (const state of readCatalog(apiPath)) {
    assert.doesNotMatch(state.name, mojibakeMarkers, `corrupted state name for id ${state.id}`);
  }
});

test('Ostfold keeps its correct display name', () => {
  const ostfold = readCatalog(apiPath).find((state) => state.id === '2712');

  assert.ok(ostfold, 'state id 2712 should exist');
  assert.equal(ostfold.name, '\u00d8stfold');
});
