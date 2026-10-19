const { ObjectId } = require('mongodb');
const sift = require('sift').default;
const { clearAll } = require('../../../src/services/parked-sales');
const branchId = '64f8f2f4c2b9c0a1e4b12345';
const scope = { branchId, licenseId: 'tenant-a', userId: 'cashier' };

test('clears more than one page, isolates branch/tenant, preserves money and retries safely', async () => {
  const draft = () => ({
    branch_id: new ObjectId(branchId),
    license: 'tenant-a',
    sale_process: 'Hold',
    items: [{ item_quantity: 2 }],
    sales_total: 200,
  });
  const rows = Array.from({ length: 25 }, draft);
  const excluded = [
    { ...draft(), sale_process: 'Add' },
    { ...draft(), sale_process: 'KOT' },
    { ...draft(), license: 'tenant-b' },
    { ...draft(), branch_id: new ObjectId() },
  ];
  rows.push(...excluded);
  rows.forEach((r) => {
    r._id = new ObjectId();
  });
  const financialSnapshot = JSON.stringify(rows);
  const markers = new Map();
  const db = {
    collection: (name) =>
      name === 'sales'
        ? {
            find: (filter) => ({
              project: () => ({
                toArray: async () => rows.filter(sift(filter)).map((r) => ({ _id: r._id })),
              }),
            }),
          }
        : {
            bulkWrite: async (ops) => {
              let upsertedCount = 0;
              ops.forEach(({ updateOne: op }) => {
                if (!markers.has(op.filter._id)) {
                  markers.set(op.filter._id, op.update.$setOnInsert);
                  upsertedCount++;
                }
              });
              return { upsertedCount };
            },
          },
  };
  expect(await clearAll(db, scope)).toEqual({ cleared: 25 });
  expect(await clearAll(db, scope)).toEqual({ cleared: 0 });
  expect(JSON.stringify(rows)).toBe(financialSnapshot);
  const marker = [...markers.values()][0];
  expect(marker).toMatchObject({
    kind: 'parked_sale_clearance',
    cleared_by: 'cashier',
    license: 'tenant-a',
  });
  expect(marker.updated_date).toBeInstanceOf(Date);
  // Markers on another installation hide the same stable sale ID; paid rows stay visible.
  const filter = require('../../../src/services/parked-sales').visibilityStages()[1].$match;
  expect(sift(filter)({ sale_process: 'Hold', _parkedClearance: [marker] })).toBe(false);
  expect(sift(filter)({ sale_process: 'Add', _parkedClearance: [marker] })).toBe(true);
  expect(sift(filter)({ sale_process: 'Hold', _parkedClearance: [] })).toBe(true);
});

test.each([{ branchId: '' }, { licenseId: '' }, { userId: '' }])(
  'missing scope fails closed: %j',
  async (missing) => {
    const collection = jest.fn();
    await expect(clearAll({ collection }, { ...scope, ...missing })).rejects.toThrow(
      /signed-in branch/
    );
    expect(collection).not.toHaveBeenCalled();
  }
);
