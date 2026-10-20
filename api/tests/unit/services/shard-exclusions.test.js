const { isExcluded } = require('../../../src/utils/shard-exclusions');
test('default leaves every tenant eligible', () => {
  expect(isExcluded({ subdomain: 'shop' }, '')).toBe(false);
});
test('isolated tenant is excluded by its public host without excluding neighbours', () => {
  const setting = ' SRIDHARBALASUBRAMANI.POSNIC.IO ';
  expect(isExcluded({ subdomain: 'sridharbalasubramani', webDomain: 'posnic.io' }, setting)).toBe(true);
  expect(isExcluded({ subdomain: 'another', webDomain: 'posnic.io' }, setting)).toBe(false);
});
test('exclusion of a custom alias excludes the tenant rather than just one route', () => {
  expect(isExcluded({ subdomain: 'shop', hosts: ['orders.example.com'] }, 'orders.example.com')).toBe(true);
});
