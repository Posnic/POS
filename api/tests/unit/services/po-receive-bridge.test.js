'use strict';

/*
 * The PO receive bridge, held to the field names receivings actually use.
 * The bug this pins against: reading line.item/line.quantity where lines
 * store item_id/item_quantity - every count was zero, no PO ever left
 * "ordered", and the fire-safe catch kept it invisible until the owner
 * received a full order and watched nothing move.
 */

const { ObjectId } = require('mongodb');

jest.mock('../../../src/models/base.model', () => {
  const collections = {};
  class FakeBaseModel {
    constructor() {}
    async getCollection(name) {
      return collections[name];
    }
  }
  FakeBaseModel.__collections = collections;
  return FakeBaseModel;
});

const BaseModel = require('../../../src/models/base.model');
const { syncPoFromReceivings } = require('../../../src/services/po-receive-bridge');

describe('syncPoFromReceivings', () => {
  test('a fully received order closes, counted through item_id/item_quantity', async () => {
    const branchId = new ObjectId();
    const licenseId = new ObjectId();
    const poId = new ObjectId();
    const itemA = new ObjectId();
    const itemB = new ObjectId();

    const po = {
      _id: poId,
      branch_id: branchId,
      license: licenseId,
      status: 'ordered',
      items: [
        { item_id: itemA, item_name: 'Bottle', qty_ordered: 4 },
        { item_id: itemB, item_name: 'Cups', qty_ordered: 5 },
      ],
    };
    let updated = null;
    BaseModel.__collections.purchase_orders = {
      findOne: async () => po,
      updateOne: async (filter, update) => {
        updated = update;
        return { modifiedCount: 1 };
      },
    };
    BaseModel.__collections.receivings = {
      find: () => ({
        toArray: async () => [
          {
            items: [
              /* the shapes receivingInsertUpdate actually writes */
              { item_id: String(itemA), item_quantity: 4 },
              { item_id: String(itemB), item_quantity: 5 },
            ],
          },
        ],
      }),
    };

    const r = await syncPoFromReceivings(String(poId), {
      branchId: String(branchId),
      licenseId: String(licenseId),
    });
    expect(r.status).toBe(true);
    expect(updated).toBeTruthy();
    const set = updated.$set;
    expect(set.status).toBe('closed');
    expect(set.items.map((i) => i.qty_received)).toEqual([4, 5]);
  });

  test('a partial delivery moves to partial, never negative, never reopened', async () => {
    const branchId = new ObjectId();
    const poId = new ObjectId();
    const itemA = new ObjectId();
    const po = {
      _id: poId,
      branch_id: branchId,
      status: 'ordered',
      items: [{ item_id: itemA, qty_ordered: 10 }],
    };
    let updated = null;
    BaseModel.__collections.purchase_orders = {
      findOne: async () => po,
      updateOne: async (f, u) => {
        updated = u;
        return { modifiedCount: 1 };
      },
    };
    BaseModel.__collections.receivings = {
      find: () => ({
        toArray: async () => [{ items: [{ item_id: String(itemA), item_quantity: 3 }] }],
      }),
    };
    const r = await syncPoFromReceivings(String(poId), { branchId: String(branchId) });
    expect(r.status).toBe(true);
    expect(updated.$set.status).toBe('partial');
    expect(updated.$set.items[0].qty_received).toBe(3);
  });
});
