const { update, payee } = require('../../../src/utils/branch-upi');
test('branch UPI updates preserve absent fields and allow clearing', () => {
  expect(update({ store_name: 'Shop' })).toEqual({});
  expect(update({ branch_upi_id: '', branch_upi_name: 'old' })).toEqual({
    branch_upi_id: '',
    branch_upi_name: '',
  });
  expect(payee(update({ branch_upi_id: ' shop@invalid ', branch_upi_name: ' Shop ' }))).toEqual({
    id: 'shop@invalid',
    name: 'Shop',
  });
});
test('invalid or partial payee cannot be saved', () => {
  for (const data of [
    { branch_upi_id: 'shop@invalid' },
    { branch_upi_id: 'upi://pay?pa=shop@invalid', branch_upi_name: 'Shop' },
    { branch_upi_id: 'shop@invalid', branch_upi_name: '<script>' },
    { branch_upi_id: 'shop@invalid', branch_upi_name: '' },
  ])
    expect(() => update(data)).toThrow();
});
