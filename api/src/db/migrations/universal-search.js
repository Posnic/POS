'use strict';
const { providers, phoneCollation } = require('../../services/search-providers');
module.exports = async function ensureSearchIndexes(db, selected = providers.filter((p) => p.route !== 'users')) {
  await db.collection('pos_search_history').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  for (const provider of selected) {
    const collection = db.collection(provider.collection || provider.route);
    const indexes = await collection.indexes().catch((error) => {
      if (error.code === 26) return [];
      throw error;
    });
    if (provider.names && !indexes.some((index) => index.textIndexVersion)) {
      // Match the existing supplier model's index when installing a fresh database.
      if (provider.route === 'suppliers')
        await collection.createIndex({ name: 'text', phone: 'text' });
      else
        await collection.createIndex(
          provider.route === 'users'
            ? { license: 1, firstname: 'text', lastname: 'text', username: 'text' }
            : { license: 1, name: 'text' },
          {
            default_language: 'none',
            name: 'pos_search_name_words',
            language_override: 'pos_search_language',
          }
        );
    }
    for (const field of new Set([...provider.keys, ...(provider.names || [])])) {
      // Putting the field before branch also serves account-shared contact lookups.
      const keys = { license: 1, [field]: 1 };
      if (provider.route === 'users') keys['branch_access.branch_id'] = 1;
      else if (!provider.contact && provider.route !== 'items') keys.branch_id = 1;
      keys._id = 1;
      const phone = provider.contact && provider.keys.includes(field);
      if (
        indexes.some(
          (index) =>
            !index.hidden &&
            !index.partialFilterExpression &&
            (phone
              ? index.collation?.alternate === 'shifted' && index.collation?.strength === 2
              : !index.collation) &&
            JSON.stringify(index.key) === JSON.stringify(keys)
        )
      )
        continue;
      await collection.createIndex(keys, {
        name: 'pos_search_' + field,
        ...(phone && { collation: phoneCollation }),
      });
    }
  }
};
