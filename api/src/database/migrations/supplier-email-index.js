'use strict';

const options = {
  name: 'supplier_nonempty_email',
  unique: true,
  partialFilterExpression: { email: { $type: 'string', $gt: '' } },
};

async function migrateContactEmailIndex(db, name, indexOptions) {
  if (!(await db.listCollections({ name }, { nameOnly: true }).hasNext())) return;
  const collection = db.collection(name);
  const indexes = await collection.listIndexes().toArray();
  // Build first; never delete contacts or remove existing constraints to make
  // a new uniqueness rule fit historical data. A duplicate is a deferred
  // migration, not a reason to take the entire till offline.
  try {
    await collection.createIndex({ email: 1 }, indexOptions);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    console.warn(
      '[startup] ' +
        name +
        ': email uniqueness migration deferred; existing duplicate emails require review. Contacts and existing indexes are unchanged.'
    );
    return { status: 'deferred', reason: 'duplicate-email', collection: name };
  }
  for (const index of indexes) {
    if (
      index.name !== indexOptions.name &&
      index.unique === true &&
      Object.keys(index.key).length === 1 &&
      index.key.email === 1
    ) {
      await collection.dropIndex(index.name);
    }
  }
}

const migrateSupplierEmailIndex = (db) => migrateContactEmailIndex(db, 'suppliers', options);
const migrateCustomerEmailIndex = (db) =>
  migrateContactEmailIndex(db, 'customers', {
    ...options,
    name: 'customer_nonempty_email',
  });
module.exports = { migrateSupplierEmailIndex, migrateCustomerEmailIndex, options };
