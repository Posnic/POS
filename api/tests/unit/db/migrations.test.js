'use strict';

/**
 * Unit tests for src/db/migrations.js — the forward-only, ledgered migration
 * runner (SEAMLESS_UPDATE_ROADMAP U1.3). A fake Db is injected; no real
 * MongoDB is exercised.
 */

const { runMigrations, COLLECTION } = require('../../../src/db/migrations');

function fakeDb(appliedIds = []) {
  const ledgerWrites = [];
  const ledger = {
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(appliedIds.map((id) => ({ _id: id }))),
    }),
    updateOne: jest.fn().mockImplementation((filter) => {
      ledgerWrites.push(filter._id);
      return Promise.resolve({ upsertedCount: 1 });
    }),
  };
  return {
    db: { collection: jest.fn((name) => (name === COLLECTION ? ledger : null)) },
    ledger,
    ledgerWrites,
  };
}

test('runs unapplied migrations in order and records each in the ledger', async () => {
  const ran = [];
  const { db, ledgerWrites } = fakeDb([]);
  const r = await runMigrations(db, [
    { id: '001-a', up: async () => ran.push('a') },
    { id: '002-b', up: async () => ran.push('b') },
  ]);
  expect(ran).toEqual(['a', 'b']);
  expect(r.applied).toEqual(['001-a', '002-b']);
  expect(ledgerWrites).toEqual(['001-a', '002-b']);
});

test('skips migrations the ledger already records', async () => {
  const ran = [];
  const { db } = fakeDb(['001-a']);
  const r = await runMigrations(db, [
    { id: '001-a', up: async () => ran.push('a') },
    { id: '002-b', up: async () => ran.push('b') },
  ]);
  expect(ran).toEqual(['b']);
  expect(r.applied).toEqual(['002-b']);
});

test('a failing migration throws before later ones run and is NOT recorded', async () => {
  const ran = [];
  const { db, ledgerWrites } = fakeDb([]);
  await expect(
    runMigrations(db, [
      { id: '001-boom', up: async () => { throw new Error('boom'); } },
      { id: '002-b', up: async () => ran.push('b') },
    ])
  ).rejects.toThrow('boom');
  expect(ran).toEqual([]);
  expect(ledgerWrites).toEqual([]); // recorded AFTER success only
});

test('refuses malformed entries loudly', async () => {
  const { db } = fakeDb([]);
  await expect(runMigrations(db, [{ id: '001-x' }])).rejects.toThrow(/Malformed/);
  await expect(runMigrations(null, [])).rejects.toThrow(/database handle/);
});

test('an empty registry is a healthy no-op', async () => {
  const { db } = fakeDb([]);
  const r = await runMigrations(db, []);
  expect(r.applied).toEqual([]);
});
