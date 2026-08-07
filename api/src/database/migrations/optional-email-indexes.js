const OPTIONAL_EMAIL_COLLECTIONS = ['suppliers', 'customers', 'users'];

/**
 * Align optional email storage with MongoDB uniqueness semantics.
 * A normal unique index treats "" (and, depending on index shape, missing
 * values) as a real duplicate value. Blank optional emails must therefore be
 * absent and the unique index must be sparse.
 */
async function migrateOptionalEmailIndexes(db) {
  for (const collectionName of OPTIONAL_EMAIL_COLLECTIONS) {
    const exists = await db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext();
    if (!exists) continue;

    const collection = db.collection(collectionName);
    await collection.updateMany(
      { email: { $type: 'string', $regex: /^\s*$/ } },
      { $unset: { email: '' } }
    );

    const indexes = await collection.listIndexes().toArray();
    const emailIndex = indexes.find(
      (index) => index.key && Object.keys(index.key).length === 1 && index.key.email === 1
    );
    if (emailIndex?.unique === true && emailIndex?.sparse === true) continue;

    if (emailIndex) await collection.dropIndex(emailIndex.name);
    try {
      await collection.createIndex({ email: 1 }, { name: 'email_1', unique: true, sparse: true });
    } catch (err) {
      // Existing data can legitimately hold the same email twice (imports and
      // long-lived databases predate this rule). Uniqueness is a nicety here,
      // not a correctness requirement, so log it and keep serving rather than
      // refusing to start. New duplicates are still caught in the app layer.
      if (err?.code === 11000 || /duplicate key/i.test(err?.message || '')) {
        const dupe = err?.keyValue?.email ?? 'unknown';
        console.warn(
          `[startup] ${collectionName}: keeping email index non-unique, existing duplicate (${dupe})`
        );
        await collection.createIndex({ email: 1 }, { name: 'email_1' }).catch(() => {});
        continue;
      }
      throw err;
    }
  }
}

module.exports = { migrateOptionalEmailIndexes, OPTIONAL_EMAIL_COLLECTIONS };
