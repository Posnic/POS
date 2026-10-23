const { defaults, enabled, seed, read } = require('../../../src/services/payment-methods');
const { ObjectId } = require('mongodb');
test.each(['India', 'IN', 'United Arab Emirates', 'Singapore', 'Cambodia'])(
  'UPI is seeded for %s',
  (country) => {
    expect(defaults({ country })).toEqual(['Cash', 'Card', 'Upi']);
  }
);
test.each(['Hong Kong', 'HK', 'United Kingdom', 'GB', 'United States', '', 'unknown'])(
  'UPI is not seeded for %s',
  (country) => {
    expect(defaults({ country })).toEqual(['Cash', 'Card']);
  }
);
test('explicit disabled methods and an intentionally empty configured list stay disabled', () => {
  const rows = [
    { payment_field: 'Cash', enabled: false },
    { payment_field: 'Card' },
    { payment_field: 'UPI', enabled: false },
  ];
  expect(enabled(rows, { payment_methods_initialized: true })).toEqual(['Card']);
  expect(enabled([], { payment_methods_initialized: true })).toEqual([]);
});
test('default seed is scoped, enabled and insert-only so a retry preserves preferences', async () => {
  const collection = { updateOne: jest.fn().mockResolvedValue({}) };
  const branch = { _id: new ObjectId(), license: new ObjectId(), country: 'India' };
  await seed(collection, branch);
  expect(collection.updateOne).toHaveBeenCalledTimes(3);
  for (const [filter, update, options] of collection.updateOne.mock.calls) {
    expect(filter).toMatchObject({ branch_id: branch._id, license: branch.license });
    expect(update.$setOnInsert.enabled).toBe(true);
    expect(update.$set).toBeUndefined();
    expect(options.upsert).toBe(true);
  }
});
test('sync readers use the branch and license rather than another shops methods', async () => {
  const branch = {
    _id: new ObjectId(),
    license: new ObjectId(),
    payment_methods_initialized: true,
  };
  const find = jest.fn(() => ({
    toArray: async () => [
      { payment_field: 'Cash', enabled: false },
      { payment_field: 'Card', enabled: true },
    ],
  }));
  expect(await read({ collection: () => ({ find }) }, branch)).toEqual(['Card']);
  expect(find).toHaveBeenCalledWith({ branch_id: branch._id, license: branch.license });
});

// Older branches without seeded rows must use the same country defaults as new ones.
test.each(['Hong Kong', 'HK', 'United Kingdom', 'GB', '', 'unknown'])(
  'an uninitialized %s branch does not acquire UPI through the legacy fallback',
  (country) => {
    expect(enabled([], { country })).toEqual(['Cash', 'Card']);
  }
);
test('India fallback retains UPI and explicit choices are preserved', () => {
  expect(enabled([], { country: 'India' })).toEqual(['Cash', 'Card', 'Upi']);
  expect(enabled([{ payment_field: 'Card' }], { country: 'Hong Kong' })).toEqual(['Card', 'Cash']);
});

test('desktop loads enabled custom methods while phone methods retain their supported contract', async () => {
  const branch = {
    _id: new ObjectId(),
    license: new ObjectId(),
    country: 'India',
    payment_methods_initialized: true,
  };
  const rows = [
    { payment_field: 'CreditCard' },
    { payment_value: 'Hotel account' },
    { payment_field: 'Voucher', enabled: false },
    { payment_field: '__proto__' },
  ];
  const find = jest.fn(() => ({ toArray: async () => rows }));
  const db = { collection: () => ({ find }) };
  expect(await read(db, branch, true)).toEqual(['CreditCard', 'Hotel account']);
  expect(await read(db, branch)).toEqual(['Card']);
  expect(find).toHaveBeenCalledWith({ branch_id: branch._id, license: branch.license });
  expect(enabled([], branch, true)).toEqual([]);
});
