'use strict';
const filters = require('../../../src/utils/expense-filters');
const { ObjectId } = require('mongodb');
describe('Cash Book filter boundary', () => {
  test.each([
    { $where: 'sleep(1000)' },
    { $or: [{}] },
    { license: { $ne: null } },
    { category: { $ne: null } },
    { category: { $regex: '(a+)+$', $options: 'i' } },
    { branch_id: { $ne: null } },
    { date: { $gte: { $ne: null } } },
    { date: { $where: 'true' } },
    { 'supporting_documents.data': { $exists: true } },
  ])('rejects injected query %j', (value) => {
    expect(() => filters(value)).toThrow('Invalid Cash Book filter');
  });
  test('keeps date, branch, literal and escaped multi-word search filters', () => {
    const id = new ObjectId();
    const result = filters({
      branch_id: id,
      date: { $gte: '2026-01-01' },
      type: 'Expense',
      category: { $regex: '(?=.*Office)(?=.*A\\+B)', $options: 'i' },
    });
    expect(result.branch_id).toEqual(id);
    expect(result.date.$gte).toEqual(new Date('2026-01-01'));
    expect(result.type).toBe('Expense');
    const re = new RegExp(result.category.$regex, result.category.$options);
    expect(re.test('A+B Office supplies')).toBe(true);
    expect(re.test('AAAB Office supplies')).toBe(false);
  });
});
