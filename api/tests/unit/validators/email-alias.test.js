const { validationResult } = require('express-validator');
const schemas = require('../../../src/validators/validationSchemas');
const customers = require('../../../src/helpers/customers.helper');
const suppliers = require('../../../src/helpers/suppliers.helper');
describe('email alias consistency', () => {
  test.each([
    'first.last+shop@gmail.com',
    'name+shop@outlook.com',
    'name-shop@yahoo.com',
    'name@example.technology',
  ])('preserves identity for %s', async (email) => {
    const req = {
      body: { name: 'Test user', email: ' ' + email + ' ', password: 'password123' },
      params: {},
      query: {},
    };
    for (const chain of schemas.createUser) await chain.run(req);
    expect(validationResult(req).array()).toEqual([]);
    expect(req.body.email).toBe(email);
    expect(customers.isValidEmail(email)).toBe(true);
    expect(suppliers.isValidEmail(email)).toBe(true);
  });
  test('optional contact email stays optional', () => {
    expect(customers.isValidEmail('')).toBe(true);
    expect(suppliers.isValidEmail('')).toBe(true);
  });
});
