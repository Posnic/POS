'use strict';
const { ObjectId } = require('mongodb');
const { snapshot } = require('../../../src/services/printable-menu');
const branchId = new ObjectId(),
  licenseId = new ObjectId();
function fixture() {
  const branch = { branch_name: 'Coastal Kitchen', currency: 'INR' };
  const branchQuery = jest.fn().mockResolvedValue(branch);
  const itemQuery = jest.fn().mockReturnValue({
    sort: () => ({
      toArray: async () => [
        {
          _id: new ObjectId(),
          name: 'Vanilla Milkshake',
          selling_price: 180,
          category_id: 'drinks',
          category_name: 'Drinks',
          diet: 'veg',
        },
        {
          _id: new ObjectId(),
          name: 'Chocolate Milkshake',
          selling_price: 180,
          category_id: 'drinks',
          category_name: 'Drinks',
          diet: 'veg',
        },
        {
          _id: new ObjectId(),
          name: 'Fish',
          selling_price: 300,
          category_name: 'Main course',
          diet: 'non_veg',
        },
      ],
    }),
  });
  return {
    branchQuery,
    itemQuery,
    db: {
      collection: (name) => (name === 'branches' ? { findOne: branchQuery } : { find: itemQuery }),
    },
  };
}
test('prints a branch without requiring a public store or ordering to be enabled', async () => {
  const f = fixture();
  const data = await snapshot(f.db, { branchId, licenseId });
  expect(data.name).toBe('Coastal Kitchen');
  expect(data.currency).toBe('INR');
  expect(data.categories).toHaveLength(2);
  expect(data.categories[0].items.map((x) => [x.name, x.price])).toEqual([
    ['Vanilla Milkshake', 180],
    ['Chocolate Milkshake', 180],
  ]);
  const [filter, options] = f.itemQuery.mock.calls[0];
  expect(filter.license).toEqual(licenseId);
  expect(filter.$or).toEqual([{ branch_id: branchId }, { 'branch_access.branch_id': branchId }]);
  expect(filter.del_status.$nin).toEqual([1, '1', true]);
  expect(filter.is_deleted).toEqual({ $ne: true });
  expect(filter.show_on_menu).toEqual({ $ne: false });
  expect(filter.item_status).toEqual({ $ne: 'instant' });
  expect(filter).not.toHaveProperty('ecommerce');
  expect(options.projection).not.toHaveProperty('company_price');
});
test('missing context and a branch outside this license cannot read any items', async () => {
  const f = fixture();
  await expect(snapshot(f.db, {})).rejects.toThrow('Select a branch');
  expect(f.branchQuery).not.toHaveBeenCalled();
  f.branchQuery.mockResolvedValue(null);
  await expect(snapshot(f.db, { branchId, licenseId })).rejects.toThrow('Branch not found');
  expect(f.branchQuery.mock.calls[0][0]).toEqual({ _id: branchId, license: licenseId });
  expect(f.itemQuery).not.toHaveBeenCalled();
});
