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
  // Build the replacement first. If existing nonblank emails conflict, retain
  // the old constraint and all records rather than silently weakening it.
  await collection.createIndex({ email: 1 }, indexOptions);
  for (const index of indexes) {
    if (index.name !== indexOptions.name && index.unique === true &&
        Object.keys(index.key).length === 1 && index.key.email === 1) {
      await collection.dropIndex(index.name);
    }
  }
}

const migrateSupplierEmailIndex = db => migrateContactEmailIndex(db, 'suppliers', options);
const migrateCustomerEmailIndex = db => migrateContactEmailIndex(db, 'customers', {
  ...options, name: 'customer_nonempty_email',
});
module.exports = { migrateSupplierEmailIndex, migrateCustomerEmailIndex, options };
