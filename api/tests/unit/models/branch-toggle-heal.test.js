'use strict';

/*
 * The self-healing branch read.
 *
 * The group endpoint once stored the first-run welcome's checkbox map
 * VERBATIM, so shops that saved the welcome carry features keys as the
 * strings 'true'/'false'. Every `!== false` gate in the frontend reads
 * "false" as ENABLED - the owner saved all-off and watched every feature
 * light up. getOneStore is the whole legacy frontend's settings read, so it
 * is where poisoned shops heal: the response carries the booleans the shop
 * meant, and the same repair is written back so the doc tells the truth to
 * every later reader too.
 */

const { BranchModel } = require('../../../src/models/branch.model');

const POISONED = {
  _id: 'b1',
  branch_name: 'me me business',
  module_credit_enable: 'false',
  module_marketing_enable: 'false',
  cash_register_enable: 'false',
  module_tax_enable: 'true',
  first_run_decided: 'true',
  quotes_enable: false, // already a real boolean - must be left alone
  sales_prefix: 'S', // not a features key - never touched
};

function makeModel(doc) {
  const model = Object.create(BranchModel.prototype);
  model.fields = {};
  model.user = {};
  model.model = {
    findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(doc ? { ...doc } : null) })),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  };
  return model;
}

const VALID_ID = '64b000000000000000000001';

describe('getBranchDetails heals string booleans', () => {
  test('the response carries booleans, and the repair is written back', async () => {
    const model = makeModel(POISONED);
    const r = await model.getBranchDetails(VALID_ID);
    expect(r.status).toBe(true);
    expect(r.data.module_credit_enable).toBe(false);
    expect(r.data.module_marketing_enable).toBe(false);
    expect(r.data.cash_register_enable).toBe(false);
    expect(r.data.module_tax_enable).toBe(true);
    expect(r.data.first_run_decided).toBe(true);
    expect(r.data.sales_prefix).toBe('S');

    const [, update] = model.model.updateOne.mock.calls[0];
    expect(update.$set).toEqual({
      module_credit_enable: false,
      module_marketing_enable: false,
      cash_register_enable: false,
      module_tax_enable: true,
      first_run_decided: true,
    });
    // keys that were already honest are not rewritten
    expect('quotes_enable' in update.$set).toBe(false);
  });

  test('a clean document triggers no repair write at all', async () => {
    const model = makeModel({
      _id: 'b2',
      branch_name: 'clean',
      module_credit_enable: false,
      module_tax_enable: true,
    });
    const r = await model.getBranchDetails(VALID_ID);
    expect(r.status).toBe(true);
    expect(model.model.updateOne).not.toHaveBeenCalled();
  });

  test('a failed repair write must not fail the read', async () => {
    const model = makeModel(POISONED);
    model.model.updateOne = jest.fn().mockRejectedValue(new Error('read-only replica'));
    const r = await model.getBranchDetails(VALID_ID);
    expect(r.status).toBe(true);
    // still answered fixed, even though the write-back could not land
    expect(r.data.module_credit_enable).toBe(false);
  });
});
