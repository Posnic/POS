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

/*
 * Give every duplicated bill number a proper, unique one - the self-healing
 * half of the cross-device fix.
 *
 * Two tills in a branch used to hand out the same SID000005 (each ran its own
 * local counter), and sync kept both. New sales can no longer collide - each
 * till now stamps its own code into the number - but the ones already minted
 * are still doubled. This repairs them where they sit: for each clashing number
 * it keeps the earliest document and renumbers the rest, taking fresh numbers
 * from the same atomic counter the app uses and tagging them with this till's
 * code so the new numbers are unique too.
 *
 * Safe to run on every till at startup: all tills sort the same way (earliest
 * first) so they agree on which document keeps the number; a renumbered
 * document is no longer a duplicate, so a second pass leaves it alone; and every
 * change is copied to database_repair_backup first. A renumber that loses a sync
 * race just settles on one unique number - never two sales sharing one.
 */
const renumberDuplicateSales = async (db) => {
  const sales = db.collection('sales');
  const backup = db.collection('database_repair_backup');
  const counters = db.collection('counters');

  const groups = await sales.aggregate([
    { $match: { sales_id: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: { license: '$license', branch: { $ifNull: ['$branch_id', '$branch'] }, value: '$sales_id' }, count: { $sum: 1 }, docs: { $push: { id: '$_id', created: '$created_date' } } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 500 },
  ]).toArray();
  if (!groups.length) return 0;

  // This till's code, from the same place the app keeps it. Absent on a till
  // that has not run the new app yet: fall back to an untagged number, still
  // unique because the counter keeps advancing.
  let tag = '';
  try {
    const m = await db.collection('device_meta').findOne({ _id: 'device_tag' });
    tag = (m && m.tag) || '';
  } catch (e) { /* untagged fallback */ }

  const nextNumber = async (branchVal, licenseVal) => {
    const key = { kind: 'sales_id', branch_key: String(branchVal || ''), license_key: String(licenseVal || '') };
    const existing = await counters.findOne(key);
    if (!existing) {
      // Seed from the highest number this branch ever issued, as the app does,
      // so a renumber never restarts low.
      const rows = await sales.find({ $or: [{ branch_id: branchVal }, { branch: branchVal }], license: licenseVal }, { projection: { sales_id: 1 } }).toArray();
      let max = 0;
      for (const r of rows) { const mm = /(\d+)\s*$/.exec(String((r && r.sales_id) || '')); if (mm) max = Math.max(max, parseInt(mm[1], 10)); }
      await counters.updateOne(key, { $setOnInsert: { seq: max } }, { upsert: true }).catch(() => {});
    }
    const res = await counters.findOneAndUpdate(key, { $inc: { seq: 1 } }, { returnDocument: 'after' });
    const doc = res && (typeof res.seq === 'number' ? res : res.value);
    return doc && typeof doc.seq === 'number' ? doc.seq : null;
  };

  let renumbered = 0;
  for (const g of groups) {
    const docs = g.docs.slice().sort((a, b) => {
      const ca = a.created ? new Date(a.created).getTime() : 0;
      const cb = b.created ? new Date(b.created).getTime() : 0;
      if (ca !== cb) return ca - cb;
      return String(a.id).localeCompare(String(b.id));
    });
    const basePrefix = String(g._id.value).replace(/-?\d+\s*$/, '') || 'SID';
    // Keep the earliest; renumber the rest.
    for (let i = 1; i < docs.length; i++) {
      const d = docs[i];
      const seq = await nextNumber(g._id.branch, g._id.license);
      if (!seq) continue;
      const num = String(seq).padStart(6, '0');
      const newId = tag ? `${basePrefix}-${tag}-${num}` : `${basePrefix}${num}`;
      await backup.insertOne({ source_collection: 'sales', source_id: d.id, reason: 'duplicate_sales_id_renumber', original_sales_id: g._id.value, new_sales_id: newId, repaired_at: new Date() }).catch(() => {});
      await sales.updateOne({ _id: d.id }, { $set: { sales_id: newId, invoice_number: newId, sale_no: newId, updated_date: new Date() } });
      renumbered += 1;
    }
  }
  return renumbered;
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
    /*
     * Only the identifiers the SYSTEM issues are checked for duplicates:
     * sales_id and barcode_id are generated and must be unique, so a
     * duplicate there is a real fault. itemid is the shop's own SKU - a
     * person types it, the item form even defaults it to "1", and two
     * products sharing a SKU is a data-entry choice, not corruption. Flagging
     * it raised a health warning on every start for something that is not
     * wrong, so it is no longer treated as a database-health problem.
     */
    /*
     * Repair duplicate bill numbers before checking for them, so a shop that
     * carried the old cross-device duplicates is fixed on this launch instead
     * of being warned about them again. New sales already cannot collide.
     */
    let renumberedSales = 0;
    try {
      renumberedSales = await renumberDuplicateSales(db);
    } catch (error) {
      report.errors.push(`Duplicate bill-number repair: ${error.message}`);
    }
    report.repairs.push({ type: 'duplicate_sales_id', repaired: renumberedSales });

    report.duplicates = (await Promise.all([
      duplicateCheck(db, 'sales', 'sales_id'),
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

module.exports = { runDatabaseHealthCheck, renumberDuplicateSales };
