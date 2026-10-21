const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WordingProfiles, createRegistry, validateDraft, resolveBundle } = require('../api/src/services/wording-profiles');
const tenant = 'aaaaaaaaaaaaaaaaaaaaaaaa', branch = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const labels = () => createRegistry({ lang_takeaway: 'Takeaway', lang_product: 'Product', lang_count: '{count} items' });
function memory() {
  let stored = null;
  const clone = v => v && require('../api/node_modules/bson').EJSON.parse(require('../api/node_modules/bson').EJSON.stringify(v));
  return {
    async findOne(q) { return stored && String(stored._id) === String(q._id) && String(stored.license) === String(q.license) ? clone(stored) : null; },
    async insertOne(v) { if (stored) throw Object.assign(new Error('duplicate'), { code: 11000 }); stored = clone(v); },
    async replaceOne(q, v) { if (stored?.revision !== q.revision) return { matchedCount: 0 }; stored = clone(v); return { matchedCount: 1 }; }
  };
}
test('draft remains inactive; publish atomically assigns branches and locale; unassignment restores default', async () => {
  const svc = new WordingProfiles(memory(), tenant, labels());
  let state = await svc.save({ name: 'Shop English', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Parcel' }, expectedRevision: 0 }, 'owner');
  assert.deepEqual({ ...resolveBundle(state, branch, 'en', labels()).values }, {});
  state = await svc.publish({ id: state.profiles[0].id, expectedRevision: 1, branches: [branch] }, 'owner', [branch]);
  assert.equal(resolveBundle(state, branch, 'en', labels()).values.lang_takeaway, 'Parcel');
  assert.equal(resolveBundle(state, branch, 'en', labels()).profileName, 'Shop English');
  assert.deepEqual({ ...resolveBundle(state, branch, 'ta', labels()).values }, {});
  assert.deepEqual({ ...resolveBundle(state, 'cccccccccccccccccccccccc', 'en', labels()).values }, {});
  const firstRevision = state.profiles[0].revisions[0];
  state = await svc.save({ id: state.profiles[0].id, name: 'Shop English', locale: 'en', overrides: {}, expectedRevision: 2 }, 'owner');
  assert.equal(resolveBundle(state, branch, 'en', labels()).values.lang_takeaway, 'Parcel');
  state = await svc.publish({ id: state.profiles[0].id, expectedRevision: 3, branches: [branch] }, 'owner', [branch]);
  assert.deepEqual({ ...resolveBundle(state, branch, 'en', labels()).values }, {});
  assert.equal(state.profiles[0].revisions[0].id, firstRevision.id);
});
test('mobile source bridge includes unique labels but skips ambiguous wording', () => {
  const registry = createRegistry({ lang_one: 'Product', lang_two: 'Product', lang_room: 'Room number' }, []);
  const state = { schemaVersion: 1, revision: 1, assignments: { [branch]: { en: { profileId: 'p', revisionId: 'r' } } },
    profiles: [{ id: 'p', revisions: [{ id: 'r', name: 'Published', locale: 'en', overrides: {
      'posnic.lang_one': 'Item', 'posnic.lang_room': 'Suite number'
    } }] }] };
  const bundle = resolveBundle(state, branch, 'en', registry);
  assert.equal(bundle.sourceValues['Room number'], 'Suite number');
  assert.equal(bundle.sourceValues.Product, undefined);
  state.profiles[0].revisions[0].overrides['posnic.lang_two'] = 'Item';
  assert.equal(resolveBundle(state, branch, 'en', registry).sourceValues.Product, 'Item');
});
test('concurrent edit is rejected without losing published or draft changes', async () => {
  const svc = new WordingProfiles(memory(), tenant, labels());
  const input = { name: 'English', locale: 'en', overrides: {}, expectedRevision: 0 };
  const outcomes = await Promise.allSettled([svc.save(input, 'a'), svc.save(input, 'b')]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.status, 409);
});
test('upgrade adds defaults without overwriting overrides; extension uninstall/reinstall retains values', () => {
  const ext = { extensionId: 'rooms', labelSchemaVersion: 1, labels: [{ id: 'ext.rooms.charge', defaults: { en: 'Room charge' } }] };
  const withExt = createRegistry({ lang_takeaway: 'Take away', lang_new: 'New default' }, [ext]);
  const state = { schemaVersion: 1, revision: 3, assignments: { [branch]: { en: { profileId: 'p', revisionId: 'r' } } }, profiles: [{ id: 'p', revisions: [{ id: 'r', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Parcel', 'ext.rooms.charge': 'Service charge' } }] }] };
  assert.equal(resolveBundle(state, branch, 'en', withExt).values.lang_takeaway, 'Parcel');
  assert.equal(resolveBundle(state, branch, 'en', withExt).values.lang_new, undefined);
  assert.equal(resolveBundle(state, branch, 'en', labels()).values['ext.rooms.charge'], undefined);
  assert.equal(resolveBundle(state, branch, 'en', withExt).values['ext.rooms.charge'], 'Service charge');
});
test('rejects markup and placeholder loss; duplicate or foreign extension namespaces rejected', () => {
  const draft = { name: 'English', locale: 'en', overrides: { 'posnic.lang_count': 'Items' } };
  assert.throws(() => validateDraft(draft, labels(), ['en']), /placeholders/);
  draft.overrides = { 'posnic.lang_product': '<img src=x>' };
  assert.throws(() => validateDraft(draft, labels(), ['en']), /plain text/);
  assert.throws(() => createRegistry({}, [{ extensionId: 'rooms', labelSchemaVersion: 1, labels: [{ id: 'ext.other.test', defaults: { en: 'Test' } }] }]), /extension/);
});
test('publish denies unauthorized branch and preserves revision', async () => {
  const svc = new WordingProfiles(memory(), tenant, labels());
  const state = await svc.save({ name: 'English', locale: 'en', overrides: {}, expectedRevision: 0 }, 'owner');
  await assert.rejects(svc.publish({ id: state.profiles[0].id, branches: [branch], expectedRevision: 1 }, 'owner', []), /authorized/);
  assert.equal((await svc.read()).revision, 1);
});

test('unassigning every branch restores defaults without deleting profile history', async () => {
  const svc = new WordingProfiles(memory(), tenant, labels());
  let state = await svc.save({ name: 'English', locale: 'en', overrides: { 'posnic.lang_takeaway': 'Parcel' }, expectedRevision: 0 }, 'owner');
  const id = state.profiles[0].id;
  state = await svc.publish({ id, branches: [branch], expectedRevision: 1 }, 'owner', [branch]);
  state = await svc.publish({ id, branches: [], expectedRevision: 2 }, 'owner', [branch]);
  assert.equal(resolveBundle(state, branch, 'en', labels()).values.lang_takeaway, undefined);
  assert.equal(state.profiles[0].revisions.length, 2);
});

test('unsupported future schema is rejected instead of replacing a valid cached bundle', () => {
  assert.throws(() => resolveBundle({ schemaVersion: 2 }, branch, 'en', labels()), /newer Posnic/);
});

test('deletion removes assignments atomically, preserves revisions and rejects stale clients', async () => {
  const store = memory(), svc = new WordingProfiles(store, tenant, labels());
  let state = await svc.save({name:'Shop',locale:'en',overrides:{'posnic.lang_takeaway':'Parcel'},expectedRevision:0}, 'owner');
  const id = state.profiles[0].id;
  state = await svc.publish({id,branches:[branch],expectedRevision:1}, 'owner', [branch]);
  const history = JSON.stringify(state.profiles[0].revisions);
  await assert.rejects(svc.remove({id,expectedRevision:2}, 'owner', []), /every assigned branch/);
  assert.equal((await svc.read()).revision, 2);
  state = await svc.remove({id,expectedRevision:2}, 'owner', [branch]);
  assert.ok(state.profiles[0].deletedAt);
  assert.equal(JSON.stringify(state.profiles[0].revisions), history);
  assert.deepEqual({...resolveBundle(state,branch,'en',labels()).values}, {});
  await assert.rejects(svc.save({id,name:'Old client',locale:'en',overrides:{},expectedRevision:2}, 'owner'), /Reload/);
  await assert.rejects(svc.save({id,name:'Old client',locale:'en',overrides:{},expectedRevision:3}, 'owner'), /deleted/);
  await assert.rejects(svc.publish({id,branches:[branch],expectedRevision:3}, 'owner',[branch]), /active profile/);
  const other = new WordingProfiles(store,'cccccccccccccccccccccccc',labels());
  assert.equal((await other.read()).profiles.length, 0);
});

