'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BaseModel = require('../../../src/models/base.model');
const repository = require('../../../src/repositories/sale.repository');
const { WordingProfiles } = require('../../../src/services/wording-profiles');
let memory, db, spy, license, branch;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  db = mongoose.connection.db;
  spy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
}, 60000);
afterAll(async () => {
  spy.mockRestore();
  BaseModel.license = null;
  BaseModel.currentBranch = null;
  await mongoose.disconnect();
  await memory.stop();
});
test('HDMI wording is published-only and constrained by active tenant and branch', async () => {
  license = new mongoose.Types.ObjectId();
  branch = new mongoose.Types.ObjectId();
  BaseModel.license = license;
  BaseModel.currentBranch = branch;
  await db.collection('branches').insertOne({ _id: branch, license });
  const profiles = new WordingProfiles(db.collection('settings'), license);
  const overrides = Object.fromEntries(
    [...profiles.labels.values()]
      .filter((label) => label.english === 'Item')
      .map((label) => [label.id, 'Article'])
  );
  const state = await profiles.save(
    {
      name: 'Shop wording',
      locale: 'en',
      overrides,
      expectedRevision: 0,
    },
    'owner'
  );
  expect((await repository.kitchenScreenWording(String(branch))).bundles.en).toEqual({});
  await profiles.publish(
    { id: state.profiles[0].id, expectedRevision: 1, branches: [String(branch)] },
    'owner',
    [String(branch)]
  );
  const result = await repository.kitchenScreenWording(String(branch));
  expect(result.branchId).toBe(String(branch));
  expect(result.bundles.en.Item).toBe('Article');
  await expect(
    repository.kitchenScreenWording(String(new mongoose.Types.ObjectId()))
  ).rejects.toMatchObject({ status: 403 });
  BaseModel.license = new mongoose.Types.ObjectId();
  await expect(repository.kitchenScreenWording(String(branch))).rejects.toMatchObject({
    status: 403,
  });
  await expect(repository.kitchenScreenWording('bad')).rejects.toMatchObject({ status: 400 });
});
