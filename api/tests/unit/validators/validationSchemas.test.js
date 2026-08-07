'use strict';

const { validationResult } = require('express-validator');
const schemas = require('../../../src/validators/validationSchemas');

const runChains = async (chains, req) => {
  for (const chain of chains) {
    await chain.run(req);
  }
  return validationResult(req);
};

describe('validation schemas', () => {
  test('idParam rejects invalid ids', async () => {
    const req = { params: { id: 'bad-id' }, body: {}, query: {} };

    const result = await runChains([schemas.idParam], req);

    expect(result.isEmpty()).toBe(false);
    expect(result.array()[0].msg).toBe('Invalid ID format');
  });

  test('pagination accepts valid query values', async () => {
    const req = { params: {}, body: {}, query: { page: '2', limit: '25' } };

    const result = await runChains(schemas.pagination, req);

    expect(result.isEmpty()).toBe(true);
    expect(req.query.page).toBe(2);
    expect(req.query.limit).toBe(25);
  });

  test('createUser reports required fields', async () => {
    const req = { params: {}, body: { name: '', email: 'bad', password: '123' }, query: {} };

    const result = await runChains(schemas.createUser, req);
    const messages = result.array().map((error) => error.msg);

    expect(messages).toEqual(
      expect.arrayContaining([
        'Name is required',
        'Invalid email format',
        'Password must be at least 6 characters long',
      ])
    );
  });

  test('createBranch validates core fields', async () => {
    const req = { params: {}, body: { name: 'A', address: '' }, query: {} };

    const result = await runChains(schemas.createBranch, req);
    const messages = result.array().map((error) => error.msg);

    expect(messages).toEqual(
      expect.arrayContaining([
        'Branch name must be between 2 and 100 characters',
        'Address is required',
      ])
    );
  });

  test('updateCategory validates id and allows optional fields', async () => {
    const req = { params: { id: '507f1f77bcf86cd799439011' }, body: {}, query: {} };

    const result = await runChains(schemas.updateCategory, req);

    expect(result.isEmpty()).toBe(true);
  });
});
