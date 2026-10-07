'use strict';

const numberIndexes = ['receiving_id', 'receiving_number'].map((field) => ({
  key: { license: 1, branch_id: 1, [field]: 1 },
  options: {
    name: `receiving_branch_${field}`,
    unique: true,
    partialFilterExpression: { [field]: { $type: 'string', $gt: '' } },
  },
}));

async function migrateReceivingNumberIndexes(db) {
  const collection = db.collection('receivings');
  // Establish both replacement constraints before dropping any legacy index.
  // A genuine duplicate within one branch must fail, never erase a purchase.
  for (const index of numberIndexes) await collection.createIndex(index.key, index.options);
  for (const index of await collection.listIndexes().toArray()) {
    const fields = Object.keys(index.key);
    if (
      index.unique &&
      fields.length === 1 &&
      ['receiving_id', 'receiving_number'].includes(fields[0])
    ) {
      await collection.dropIndex(index.name);
    }
  }
}

module.exports = { migrateReceivingNumberIndexes, numberIndexes };
