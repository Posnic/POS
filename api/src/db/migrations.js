// src/db/migrations.js
//
// Forward-only, versioned schema migrations (SEAMLESS_UPDATE_ROADMAP U1.3).
// This is what makes a SILENT update safe once it touches data: the code that
// arrives assumes a shape, and this runner guarantees the shape exists before
// the API serves a request - on a community install and on every cloud tenant
// database alike.
//
// Rules (enforced by shape, not convention):
//   - A migration is { id, description, up(db) }. No down(): rolling back a
//     release restores the pre-update BACKUP (desktop) or the previous ring
//     artifact (cloud); un-running data changes in place is how data dies.
//   - ids are ordered, applied at most once, and recorded in the
//     `schema_migrations` collection of the SAME database they ran against -
//     so per-tenant databases each carry their own honest ledger.
//   - up(db) must be idempotent anyway (guard your writes): the record is
//     written after the migration, so a crash between the two re-runs it.
//
// Registry lives in ./migrations/index.js. Bump API_SCHEMA_VERSION
// (constants/runtime.constants.js) in the same commit as a new migration.

const COLLECTION = 'schema_migrations';

/**
 * Run every not-yet-applied migration against `db` (a native Db handle),
 * in registry order. Returns { applied: [ids] }. Throws on the first
 * failure - a half-migrated database must not serve traffic.
 */
async function runMigrations(db, migrations) {
  if (!db) throw new Error('runMigrations needs a database handle');
  const list = Array.isArray(migrations) ? migrations : [];
  const ledger = db.collection(COLLECTION);
  const done = new Set(
    (await ledger.find({}, { projection: { _id: 1 } }).toArray()).map((r) => String(r._id))
  );

  const applied = [];
  for (const m of list) {
    if (!m || !m.id || typeof m.up !== 'function') {
      throw new Error(`Malformed migration entry: ${JSON.stringify(m && m.id)}`);
    }
    if (done.has(String(m.id))) continue;
    await m.up(db);
    await ledger.updateOne(
      { _id: String(m.id) },
      { $setOnInsert: { description: m.description || '', applied_at: new Date() } },
      { upsert: true }
    );
    applied.push(String(m.id));
  }
  return { applied };
}

module.exports = { runMigrations, COLLECTION };
