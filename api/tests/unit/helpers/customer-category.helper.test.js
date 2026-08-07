'use strict';

const helper = require('../../../src/helpers/customer-category.helper');

describe('customer-category.helper', () => {
  test('exports customer category helper functions', () => {
    const rows = helper.prepareCategoryImportData([{ name: '  Cat ' }], {
      branch_id: 'b1',
      branch_name: 'Main',
      created_by: 'u1',
      created_by_id: 'id1',
      license: 'lic1',
    });
    expect(rows[0].name).toBe('Cat');
    expect(helper.isValidCategoryName('Retail')).toBe(true);
  });
});
