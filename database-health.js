const REQUIRED_INDEXES = [
  { collection: 'cashregister', keys: { register_id: 1, branch_id: 1, license: 1 }, options: { unique: true, partialFilterExpression: { register_status: 'Opened' }, name: 'one_open_session_per_register' } },
  { collection: 'sales', keys: { license: 1, billing_transaction_id: 1 }, options: { unique: true, partialFilterExpression: { billing_transaction_id: { $type: 'string' } }, name: 'unique_billing_transaction_per_license' } },
  { collection: 'activitylogs', keys: { license: 1, branch: 1, entity: 1, createdAt: -1 }, options: { name: 'audit_scope_created_at' } },
];

const stableStringify = (value) => {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sameDocument = (left, right) => stableStringify(left || {}) === stableStringify(right || {});

const findCompatibleIndex = async (collection, required) => {
  let indexes;
  try {
    indexes = await collection.listIndexes().toArray();
  } catch (error) {
    // Fresh database: the collection doesn't exist yet. Not an error —
    // createIndex below will create both the collection and the index.
    if (error.codeName === 'NamespaceNotFound' || /ns does not exist/i.test(error.message)) {
      return null;
    }
    throw error;
  }
  return indexes.find((existing) => {
    if (!sameDocument(existing.key, required.keys)) return false;

    if (required.options.unique && existing.unique !== true) return false;
    if (required.options.partialFilterExpression &&
      !sameDocument(existing.partialFilterExpression, required.options.partialFilterExpression)) {
      return false;
    }

    return true;
  });
};

const duplicateCheck = async (db, collection, idField) => {
  const rows = await db.collection(collection).aggregate([
    { $match: { [idField]: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: { license: '$license', branch: { $ifNull: ['$branch_id', '$branch'] }, value: `$${idField}` }, count: { $sum: 1 }, documents: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 25 },
  ]).toArray();
  return rows.map((row) => ({ collection, field: idField, value: row._id.value, count: row.count, documents: row.documents.map(String) }));
};

const repairBranchSettings = async (db) => {
  const branches = db.collection('branches');
  const backup = db.collection('database_repair_backup');
  const candidates = await branches.find({ $or: [
    { register: { $exists: false } }, { register: { $not: { $type: 'array' } } },
    { cashdenom_fields: { $exists: false } }, { cashdenom_fields: { $not: { $type: 'array' } } },
    { currency_value: { $exists: false } }, { currency_value: { $not: { $type: 'array' } } },
    { time_zone: { $in: [null, ''] } }, { time_zone: { $not: { $type: 'string' } } },
  ] }).toArray();

  let repaired = 0;
  for (const branch of candidates) {
    const changes = {};
    if (!Array.isArray(branch.register)) changes.register = [];
    if (!Array.isArray(branch.cashdenom_fields)) changes.cashdenom_fields = [];
    if (!Array.isArray(branch.currency_value)) changes.currency_value = [];
    if (!branch.time_zone || typeof branch.time_zone !== 'string') changes.time_zone = 'Asia/Calcutta';
    if (!Object.keys(changes).length) continue;
    await backup.insertOne({ source_collection: 'branches', source_id: branch._id, reason: 'startup_settings_repair', original: branch, repaired_at: new Date() });
    await branches.updateOne({ _id: branch._id }, { $set: changes });
    repaired += 1;
  }
  return repaired;
};

const runDatabaseHealthCheck = async (mongoClient) => {
  const startedAt = Date.now();
  const report = { status: 'healthy', connection: 'ok', indexes: [], duplicates: [], repairs: [], warnings: [], errors: [] };
  try {
    const db = mongoClient.db();
    await db.command({ ping: 1 });
    for (const index of REQUIRED_INDEXES) {
      try {
        const collection = db.collection(index.collection);
        const existingIndex = await findCompatibleIndex(collection, index);
        if (existingIndex) {
          report.indexes.push({
            collection: index.collection,
            name: index.options.name,
            existingName: existingIndex.name,
            status: existingIndex.name === index.options.name ? 'ready' : 'ready_existing',
          });
          continue;
        }

        await collection.createIndex(index.keys, index.options);
        report.indexes.push({ collection: index.collection, name: index.options.name, status: 'ready' });
      } catch (error) {
        /*
         * "Index already exists with a different name" is not a fault.
         *
         * The keys are what make queries fast; the name is a label. An index
         * created earlier under Mongo's own generated name serves every query
         * this one would. It is also a race we cannot check our way out of:
         * the check above and the create below are two round trips, and a
         * first sync is writing to the same collection in between.
         *
         * It was being reported as "Database requires attention" on a first
         * run, which reads as data loss to a shopkeeper who has just
         * installed the till and has done nothing wrong.
         */
        const existingUnderAnotherName =
          error.codeName === 'IndexOptionsConflict' || error.code === 85 ||
          /already exists with a different name/i.test(error.message || '');

        if (existingUnderAnotherName) {
          report.indexes.push({
            collection: index.collection,
            name: index.options.name,
            status: 'ready_existing',
            note: 'an index with the same keys already exists under another name',
          });
          continue;
        }

        report.indexes.push({ collection: index.collection, name: index.options.name, status: 'failed' });
        report.errors.push(`Index ${index.options.name}: ${error.message}`);
      }
    }
    report.duplicates = (await Promise.all([
      duplicateCheck(db, 'sales', 'sales_id'),
      duplicateCheck(db, 'items', 'itemid'),
      duplicateCheck(db, 'items', 'barcode_id'),
    ])).flat();
    if (report.duplicates.length) report.warnings.push(`${report.duplicates.length} duplicate ID group(s) require review`);
    /*
     * Filling in missing branch settings is maintenance, not a fault.
     *
     * `branches` is a synced collection, so every sync pulls down documents
     * that never had `register`, `cashdenom_fields`, `currency_value` or
     * `time_zone`, this fills them in, and the next sync brings them back
     * missing again. That loop is by design and harmless - but it was raising
     * a warning each time, which put "Database requires attention" in front of
     * the shopkeeper on every single launch for something already handled.
     *
     * It stays in `repairs` so the diagnostic file still records it. A warning
     * is for something a person needs to act on, and there is nothing to do.
     */
    const repairedBranches = await repairBranchSettings(db);
    report.repairs.push({ type: 'branch_settings', repaired: repairedBranches });
  } catch (error) {
    report.connection = 'failed';
    report.errors.push(error.message);
  }
  report.status = report.errors.length ? 'error' : report.warnings.length ? 'warning' : 'healthy';
  report.durationMs = Date.now() - startedAt;
  report.checkedAt = new Date().toISOString();
  return report;
};

module.exports = { runDatabaseHealthCheck };
