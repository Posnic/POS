const SettingModel = require('../../../src/models/setting.model');

function setup(saved = 'missing') {
  const model = Object.create(SettingModel.prototype);
  Object.assign(model, {
    branchId: 'branch-a',
    licenseId: 'shop-a',
    normalizeId: (value) => value,
  });
  const general = { _id: 'general', name: 'General Supplier' };
  const suppliers = {
    findOne: jest.fn(async (query) => (query.name || query._id === 'general' ? general : null)),
    insertOne: jest.fn(),
  };
  const branches = {
    findOne: jest.fn(async () => (saved ? { default_supplier: saved } : null)),
    updateOne: jest.fn(async () => ({ matchedCount: 1 })),
  };
  model.getCollection = jest.fn(async (name) => (name === 'suppliers' ? suppliers : branches));
  return { model, suppliers, branches };
}

test('stale saved supplier resolves to existing branch default and stamps the real branches collection', async () => {
  const { model, suppliers, branches } = setup();
  const result = await model.getDefaultSupplier('missing');
  expect(result.status).toBe(true);
  expect(result.data.supplier_id).toBe('general');
  expect(suppliers.insertOne).not.toHaveBeenCalled();
  expect(branches.updateOne).toHaveBeenCalledWith(
    { _id: 'branch-a', license: 'shop-a' },
    { $set: { default_supplier: 'general', updated_date: expect.any(Date) } }
  );
  expect(model.getCollection).not.toHaveBeenCalledWith('branch');
});

test.each(['another-default', null])(
  'unrelated or foreign supplier request cannot repair a branch (%s)',
  async (saved) => {
    const { model, suppliers, branches } = setup(saved);
    expect((await model.getDefaultSupplier('missing')).status).toBe(false);
    expect(branches.findOne).toHaveBeenCalledWith({ _id: 'branch-a', license: 'shop-a' });
    expect(branches.updateOne).not.toHaveBeenCalled();
    expect(suppliers.insertOne).not.toHaveBeenCalled();
  }
);
