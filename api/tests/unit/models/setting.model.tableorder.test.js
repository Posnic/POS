'use strict';

/*
 * Deleting a table leaves a tombstone, so the deletion travels.
 *
 * tableorder syncs now. Sync propagates a deletion only through the
 * recycle_bin tombstone every other synced collection writes; a bare
 * deleteOne is invisible to it, and the other side still holds the row and
 * pushes it straight back. A table removed on the cloud would reappear from
 * the till on the next cycle, every cycle, forever. This pins the tombstone,
 * and pins that it is written BEFORE the row goes, from the row itself.
 */

const BaseModel = require('../../../src/models/base.model');
const SettingModel = require('../../../src/models/setting.model');

afterEach(() => jest.restoreAllMocks());

const BRANCH = '6aa36eb8752ced10d4b96529';
const LICENSE = '646576656c6f7073616e6462';
const TABLE = '6aa36eb8752ced10d4b96530';

function modelOver(collection) {
  const model = new SettingModel();
  model.setContext({ branchId: BRANCH, licenseId: LICENSE });
  jest.spyOn(model, 'getCollection').mockResolvedValue(collection);
  return model;
}

test('the tombstone is written from the row, before the row is deleted', async () => {
  const order = [];
  const row = { _id: TABLE, tableorder_value: '6A', branch_id: BRANCH, license: LICENSE };
  const collection = {
    findOne: jest.fn(async () => {
      order.push('find');
      return row;
    }),
    deleteOne: jest.fn(async () => {
      order.push('delete');
      return { deletedCount: 1 };
    }),
  };
  const tombstone = jest.spyOn(BaseModel, 'deletedDocumentBackup').mockImplementation(async () => {
    order.push('tombstone');
  });

  const result = await modelOver(collection).deleteTableOrderFiledModel(TABLE);

  expect(result.status).toBe(true);
  expect(tombstone).toHaveBeenCalledTimes(1);
  expect(tombstone).toHaveBeenCalledWith('tableorder', row);
  expect(order).toEqual(['find', 'tombstone', 'delete']);
  /* the delete and the lookup use the same scoping, so the tombstone can
     never be for a row the delete would not have touched */
  expect(collection.deleteOne.mock.calls[0][0]).toEqual(collection.findOne.mock.calls[0][0]);
  expect(String(collection.deleteOne.mock.calls[0][0].branch_id)).toBe(BRANCH);
});

test('a table that is not there gets no tombstone, and the answer says so', async () => {
  const collection = {
    findOne: jest.fn(async () => null),
    deleteOne: jest.fn(async () => ({ deletedCount: 0 })),
  };
  const tombstone = jest.spyOn(BaseModel, 'deletedDocumentBackup').mockResolvedValue(undefined);

  const result = await modelOver(collection).deleteTableOrderFiledModel(TABLE);

  expect(tombstone).not.toHaveBeenCalled();
  expect(result.status).toBe(false);
  expect(result.message).toMatch(/not found/);
});

test('a malformed table ID never reaches a Mongo query', async () => {
  const collection = {
    findOne: jest.fn(),
    deleteOne: jest.fn(),
  };

  const result = await modelOver(collection).deleteTableOrderFiledModel({ $ne: null });

  expect(result.status).toBe(false);
  expect(result.message).toMatch(/valid table order ID/i);
  expect(collection.findOne).not.toHaveBeenCalled();
  expect(collection.deleteOne).not.toHaveBeenCalled();
});

test('editing an occupied table cannot rename it or reduce seats below the party size', async () => {
  const collection = {
    createIndex: jest.fn(),
    findOne: jest.fn(async () => ({
      _id: TABLE,
      tableorder_value: 'T1',
      capacity: 6,
      max_capacity: 6,
    })),
    updateOne: jest.fn(),
  };
  const model = modelOver(collection);
  model.getCollection.mockImplementation(async (name) =>
    name === 'sales' ? { find: () => ({ toArray: async () => [{ person_count: 5 }] }) } : collection
  );
  const rename = await model.editTableOrderFiledModel({ id: TABLE, tableorder_value: 'T2' });
  expect(rename.status).toBe(false);
  expect(rename.message).toContain('renaming');
  const resize = await model.editTableOrderFiledModel({
    id: TABLE,
    tableorder_value: 'T1',
    capacity: 2,
    max_capacity: 2,
  });
  expect(resize.status).toBe(false);
  expect(resize.message).toContain('enough seats');
  expect(collection.updateOne).not.toHaveBeenCalled();
});

test.each(['tableorder_id', 'id', '_id'])(
  'editing rejects a query operator in %s before querying',
  async (field) => {
    const collection = { findOne: jest.fn(), updateOne: jest.fn(), createIndex: jest.fn() };
    const result = await modelOver(collection).editTableOrderFiledModel({
      [field]: { $ne: null },
      tableorder_value: 'T2',
    });
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/valid table order ID/i);
    expect(collection.findOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
  }
);
