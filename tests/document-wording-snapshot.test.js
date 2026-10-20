'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, resolve } = require('../api/src/services/document-wording-snapshot');
const license = 'aaaaaaaaaaaaaaaaaaaaaaaa', branch = 'bbbbbbbbbbbbbbbbbbbbbbbb';
test('historical document wording survives profile republish, unassignment and catalog changes', async () => {
  const state = { schemaVersion: 1, revision: 1, profiles: [{
    id: 'p', revisions: [{ id: 'r', name: 'English', locale: 'en', overrides: { 'posnic.lang_item': 'Article' } }],
  }], assignments: { [branch]: { en: { profileId: 'p', revisionId: 'r' } } } };
  const collection = { findOne: async (query) => {
    assert.equal(String(query.license), license);
    return structuredClone(state);
  } };
  const document = { wording_snapshot: await capture(collection, license, branch) };
  state.profiles[0].revisions[0].overrides['posnic.lang_item'] = 'Changed';
  state.assignments = {};
  assert.equal(resolve(document, branch, license, 'en').values.lang_item, 'Article');
  assert.equal(resolve(document, branch, 'cccccccccccccccccccccccc', 'en'), null);
  assert.equal(resolve(document, 'cccccccccccccccccccccccc', license, 'en'), null);
  assert.equal(resolve({}, branch, license, 'en'), undefined);
});
test('no assignment and unavailable wording freeze standard labels without blocking a sale', async () => {
  const empty = await capture({ findOne: async () => null }, license, branch);
  const failed = await capture({ findOne: async () => { throw new Error('offline'); } }, license, branch);
  assert.equal(empty.locales.en.values.lang_item, 'Item');
  assert.deepEqual(failed, empty);
  assert.equal(await capture({}, null, branch), null);
});
test('extension document labels remain readable after the extension is removed or updated', async () => {
  const { createRegistry } = require('../api/src/services/wording-profiles');
  const labels = createRegistry({}, [{
    extensionId: 'rooms', labelSchemaVersion: 1,
    labels: [{ id: 'ext.rooms.charge', defaults: { en: 'Room charge' } }],
  }]);
  const saved = await capture({ findOne: async () => null }, license, branch, labels);
  labels.clear();
  assert.equal(resolve({ wording_snapshot: saved }, branch, license, 'en').values['ext.rooms.charge'], 'Room charge');
});
