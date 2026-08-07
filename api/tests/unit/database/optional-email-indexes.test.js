const {
  migrateOptionalEmailIndexes,
  OPTIONAL_EMAIL_COLLECTIONS,
} = require('../../../src/database/migrations/optional-email-indexes');

const makeDb = (index = { name: 'email_1', key: { email: 1 }, unique: true }) => {
  const collections = new Map();
  for (const name of OPTIONAL_EMAIL_COLLECTIONS) {
    collections.set(name, {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      listIndexes: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue(index ? [index] : []),
      }),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue('email_1'),
    });
  }
  return {
    collections,
    db: {
      listCollections: jest.fn().mockReturnValue({ hasNext: jest.fn().mockResolvedValue(true) }),
      collection: jest.fn((name) => collections.get(name)),
    },
  };
};

describe('migrateOptionalEmailIndexes', () => {
  test('unsets blank emails and replaces non-sparse unique indexes', async () => {
    const { db, collections } = makeDb();
    await migrateOptionalEmailIndexes(db);

    for (const collection of collections.values()) {
      expect(collection.updateMany).toHaveBeenCalledWith(
        { email: { $type: 'string', $regex: /^\s*$/ } },
        { $unset: { email: '' } }
      );
      expect(collection.dropIndex).toHaveBeenCalledWith('email_1');
      expect(collection.createIndex).toHaveBeenCalledWith(
        { email: 1 },
        { name: 'email_1', unique: true, sparse: true }
      );
    }
  });

  test('keeps an existing sparse unique email index', async () => {
    const { db, collections } = makeDb({
      name: 'email_1',
      key: { email: 1 },
      unique: true,
      sparse: true,
    });
    await migrateOptionalEmailIndexes(db);
    for (const collection of collections.values()) {
      expect(collection.dropIndex).not.toHaveBeenCalled();
      expect(collection.createIndex).not.toHaveBeenCalled();
    }
  });

  test('skips collections that do not exist', async () => {
    const { db } = makeDb();
    db.listCollections.mockReturnValue({ hasNext: jest.fn().mockResolvedValue(false) });
    await migrateOptionalEmailIndexes(db);
    expect(db.collection).not.toHaveBeenCalled();
  });
});
