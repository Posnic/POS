// src/db/migrations/index.js
//
// The migration registry, in the order they run. See ../migrations.js for the
// contract (forward-only, idempotent up(db), ledger in schema_migrations).
//
// Naming: NNN-kebab-summary, zero-padded so lexical order = run order.
// Add new entries at the END; never edit or remove a shipped one - a database
// that already applied it will simply skip it, and one that has not will run
// exactly what every other database ran.
//
// When you add a migration, bump API_SCHEMA_VERSION in
// constants/runtime.constants.js in the same commit.

module.exports = [
  // { id: '001-example', description: 'what and why', up: async (db) => { ... } },
];
