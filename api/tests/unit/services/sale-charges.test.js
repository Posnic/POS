jest.mock('../../../src/models/base.model', () => ({ getDb: jest.fn() }));
const BaseModel = require('../../../src/models/base.model');
const { normalizeSaleCharges } = require('../../../src/services/sale-charges');
const context = {
  branchId: '64f8f2f4c2b9c0a1e4b12345',
  licenseId: '64f8f2f4c2b9c0a1e4b67890',
  branchSettings: { default_tax: '64f8f2f4c2b9c0a1e4b11111' },
};
let findOne;
beforeEach(() => {
  findOne = jest.fn().mockResolvedValue({ rate: 5, name: 'GST 5%' });
  BaseModel.getDb.mockResolvedValue({ collection: () => ({ findOne }) });
});
test('charge tax comes from this branch and license; stale untaxed values are scrubbed', async () => {
  const result = await normalizeSaleCharges(
    [
      { name: 'Service', amount: 20, taxed: true, tax_amount: 1, tax_name: 'Untrusted' },
      { name: 'Parcel', amount: 10, taxed: false, tax_amount: 999 },
    ],
    [],
    context
  );
  expect(result[0]).toMatchObject({ amount: 20, tax_amount: 1, tax_name: 'GST 5%' });
  expect(result[1]).toMatchObject({ tax_amount: 0, tax_name: '' });
  expect(String(findOne.mock.calls[0][0].branch_id)).toBe(context.branchId);
  expect(String(findOne.mock.calls[0][0].license)).toBe(context.licenseId);
});
test.each([-1, 0, Infinity, 'bad', '20abc'])('rejects invalid charge amount %s', async (amount) => {
  await expect(normalizeSaleCharges([{ name: 'Parcel', amount }], [], context)).rejects.toThrow();
});
test('rejects supplied tax disagreement rather than accepting a changed payment', async () => {
  await expect(
    normalizeSaleCharges([{ name: 'Service', amount: 20, taxed: true, tax_amount: 2 }], [], context)
  ).rejects.toThrow(/differs/);
});
test('existing unchanged tax snapshots survive a rate change and omitted charges survive edits', async () => {
  const saved = [
    {
      name: 'Service',
      amount: 20,
      taxed: true,
      tax_amount: 0.5,
      tax_name: 'Old tax',
      source: 'manual',
    },
  ];
  expect(await normalizeSaleCharges(saved, saved, context)).toEqual(saved);
  expect(await normalizeSaleCharges(undefined, saved, context)).toEqual(saved);
  expect(findOne).not.toHaveBeenCalled();
});
test('explicit removal clears charges; oversized lists and empty names are rejected', async () => {
  expect(await normalizeSaleCharges([], [], context)).toEqual([]);
  await expect(
    normalizeSaleCharges(Array(21).fill({ name: 'Parcel', amount: 1 }), [], context)
  ).rejects.toThrow();
  await expect(normalizeSaleCharges([{ name: ' ', amount: 1 }], [], context)).rejects.toThrow();
});
