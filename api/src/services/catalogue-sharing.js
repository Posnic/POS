'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const scope = require('./price-scope');
const origin = require('../utils/item-creation-origin');
const { allowed } = require('../utils/mobile-pos-access');
const holds = require('../utils/selling-price-hold');
const fields = ['name','description','itemid','barcode_id','barcodes','plu_code','gtin','gtin14','selling_price','mrp_price','company_price','unit','category_name','item_weight_machine_based','track_inventory','image','multi_image','brand','tags','nutrition','food_tags','menu_marks','open_price','tile_color','tile_shape','tax','tax_type','tax_fields'];
const oid = value => new ObjectId(String(value));
function fingerprint(row) {
  return crypto.createHash('sha256').update(JSON.stringify(fields.map(key => [key,
    key === 'tax_fields' ? (Array.isArray(row[key]) ? row[key] : []).map(t => [t.tax_name, Number(t.tax_value)]) : row[key] ?? null
  ]))).digest('hex');
}
function signature(branch, actor) {
  const key = process.env.JWT_SECRET || require('../config/config').jwt.secret;
  if (!key) throw new Error('A persistent server signing key is required for automatic branch sharing.');
  return crypto.createHmac('sha256', key).update(['catalogue-policy-v1', String(branch.license), String(branch._id), String(actor)].join(':')).digest('hex');
}
async function context(req) {
  if (process.env.POSNIC_DESKTOP === '1') throw new Error('Apply branch-wide catalogue updates in the cloud admin account, then let the tills sync. A local till may not have every branch’s catalogue.');
  if (!allowed(req.user, 'item', 'write')) throw new Error('Item write permission is required.');
  const t = req.tenantContext || {};
  return scope.context(req.user, t.branchId, t.licenseId);
}
async function policy(req) {
  const c = await context(req), db = await BaseModel.getDb();
  const filter = { _id: oid(c.branchId), license: oid(c.licenseId) };
  if (req.method === 'PUT') {
    if (!allowed(req.user, 'branch', 'write')) throw new Error('Branch settings permission is required to change automatic sharing.');
    if (typeof req.body.enabled !== 'boolean') throw new Error('Choose whether to share automatically.');
    await db.collection('branches').updateOne(filter, { $set: { catalogue_apply_all_branches: req.body.enabled, catalogue_policy: req.body.enabled ? { actor: c.userId, signature: signature({ _id: c.branchId, license: c.licenseId }, c.userId) } : null, updated_date: new Date() } });
  }
  const b = await db.collection('branches').findOne(filter);
  return { enabled: b.catalogue_apply_all_branches === true, branches: c.branches, currentBranch: c.branchId, canConfigure: allowed(req.user, 'branch', 'write'), error: b.catalogue_sharing_error || null };
}
async function distribute(req, ids, requested = 'all') {
  const c = await context(req), db = await BaseModel.getDb(), items = db.collection('items');
  const targets = scope.selected(c, requested).filter(id => id !== c.branchId);
  if (!Array.isArray(ids) || !ids.length || ids.length > 2000) throw new Error('Select 1 to 2,000 products.');
  const result = { updated: 0, created: 0, conflicts: [] };
  for (const value of ids) {
    const source = await items.findOne({ _id: oid(value), license: oid(c.licenseId), branch_id: oid(c.branchId), is_deleted: { $ne: true }, del_status: { $nin: [1,'1',true] } });
    if (!source) throw new Error('A product is unavailable in the selected branch.');
    const root = String(source.catalogue_source_id || source._id);
    const outcomes = [];
    await items.updateOne({ _id: source._id, license: oid(c.licenseId) }, { $set: { catalogue_distribution: { at: new Date(), actor: c.userId, outcomes: targets.map(branch_id => ({ branch_id, status: 'pending' })) } } });
    for (const branchId of targets) {
      try {
        const wall = { license: oid(c.licenseId), branch_id: oid(branchId), is_deleted: { $ne: true }, del_status: { $nin: [1,'1',true] } };
        let matches = await items.find({ ...wall, catalogue_source_id: root }).limit(2).toArray();
        if (!matches.length && source.itemid) matches = await items.find({ ...wall, itemid: source.itemid }).limit(2).toArray();
        if (matches.length > 1 || (matches.length && !matches[0].catalogue_source_id && matches[0].name !== source.name)) throw new Error('Product code conflict; review the product identity.');
        const target = matches[0];
        if (holds.active(target, source.selling_price)) throw new Error(holds.message);
        const codes = require('../utils/item-barcodes');
        const collision = await codes.findConflict(items, codes.codes(source), { branchId: oid(branchId), licenseId: oid(c.licenseId), selfId: target?._id });
        if (collision) throw new Error(collision.message);
        const set = { catalogue_source_id: root, updated_date: new Date(), updated_by: c.userName, updated_by_id: oid(c.userId) };
        for (const field of fields) if (source[field] !== undefined) set[field] = source[field];
        // Branch-local references cannot be copied across branches. Resolve by
        // name and refuse ambiguity rather than pointing into another shop.
        for (const [collection, idField, nameField, nameKeys] of [
          ['categories','category_id','category_name',['name','category_name']],
          ['units','unit_id','unit',['name','unit_name']]
        ]) {
          if (!source[idField]) { set[idField] = null; continue; }
          const name = source[nameField];
          const refs = await db.collection(collection).find({ license: oid(c.licenseId), $or: [{ branch_id: oid(branchId) }, { 'branch_access.branch_id': oid(branchId) }], $and: [{ $or: nameKeys.map(key => ({ [key]: name })) }], is_deleted: { $ne: true }, del_status: { $nin: [1,'1',true] } }).limit(2).toArray();
          if (!refs.length) {
            const original = await db.collection(collection).findOne({ _id: oid(source[idField]), license: oid(c.licenseId) });
            if (!original) throw new Error('Source ' + collection + ' “' + name + '” is missing.');
            const referenceId = new ObjectId(crypto.createHash('sha256').update(collection + ':' + c.licenseId + ':' + String(original._id) + ':' + branchId).digest('hex').slice(0,24));
            const document = { _id: referenceId, branch_id: oid(branchId), branch_access: [{ branch_id: oid(branchId) }], license: oid(c.licenseId), del_status: 0, created_date: new Date(), updated_date: new Date(), created_by_id: oid(c.userId), created_by: c.userName };
            for (const key of ['name','unit_name','category_name','description','decimal_places','short_name','unit_code']) if (original[key] !== undefined) document[key] = original[key];
            await db.collection(collection).updateOne({ _id: referenceId, license: oid(c.licenseId) }, { $setOnInsert: document }, { upsert: true });
            refs.push(document);
          }
          if (refs.length !== 1) throw new Error('Resolve duplicate ' + collection + ' “' + name + '” in the destination branch first.');
          set[idField] = refs[0]._id;
          set[nameField] = name;
        }
        // Tax groups contain branch-local references. Refuse to transfer a
        // configured group until it has been explicitly mapped.
        if (source.tax_class_id || source.tax_group_id) throw new Error('Tax group mapping needs review before sharing this product.');
        if (source.tax_id && ObjectId.isValid(String(source.tax_id))) {
          const group = await db.collection('grouptax').findOne({ _id: oid(source.tax_id), license: oid(c.licenseId), branch_id: source.branch_id });
          if (!group) throw new Error('Source tax configuration is missing.');
          const mapped = await db.collection('grouptax').find({ license: oid(c.licenseId), branch_id: oid(branchId), name: group.name, rate: group.rate, del_status: { $nin: [1,'1',true] } }).limit(2).toArray();
          if (mapped.length !== 1) throw new Error('Create or resolve tax “' + group.name + '” in the destination branch first.');
          set.tax_id = mapped[0]._id;
          set.tax_name = source.tax_name || group.name;
          set.tax_fields = mapped[0].tax_fields || [];
        } else if (source.tax_fields?.length) throw new Error('Source tax configuration needs review.');
        else { set.tax_id = null; set.tax_name = source.tax_name || ''; set.tax_fields = []; }
        const identity = target?._id || new ObjectId(crypto.createHash('sha256').update(c.licenseId + ':' + root + ':' + branchId).digest('hex').slice(0,24));
        const branch = c.branches.find(b => b.id === branchId);
        set.catalogue_shared_fingerprint = fingerprint(source);
        const write = await items.updateOne({ _id: identity, license: oid(c.licenseId), ...(target ? { updated_date: target.updated_date ?? null } : {}), ...holds.writable(source.selling_price) }, {
          $set: set,
          $setOnInsert: { license: oid(c.licenseId), branch_id: oid(branchId), branch_name: branch.name, branch_access: [{ branch_id: oid(branchId), branch_name: branch.name }], available_quantity: 0, created_date: new Date(), created_by: c.userName, created_by_id: oid(c.userId), creation_origin: origin.record('branch_distribution', { branchId }), del_status: 0, is_deleted: false }
        }, { upsert: !target });
        if (!write.matchedCount && !write.upsertedCount) throw new Error('Product changed during sharing. Retry after review.');
        const history = fields.filter(field => source[field] !== undefined && JSON.stringify(target?.[field]) !== JSON.stringify(source[field])).map(field => ({
          item_id: identity, item_name: source.name, branch_id: oid(branchId), license: oid(c.licenseId),
          field, label: field, value_type: typeof source[field] === 'number' ? 'money' : 'text',
          old_value: target?.[field] ?? '', new_value: source[field], process: 'Branch distribution',
          changed_by: c.userName, changed_by_id: oid(c.userId), date: new Date(), created_date: new Date(), updated_date: new Date()
        }));
        if (history.length) await db.collection('price_history').insertMany(history);
        result[write.upsertedCount ? 'created' : 'updated']++;
        outcomes.push({ branch_id: branchId, status: 'applied' });
      } catch (error) {
        const conflict = { item: source.name, itemId: String(source._id), branchId, message: error.message };
        result.conflicts.push(conflict);
        outcomes.push({ branch_id: branchId, status: 'conflict', message: error.message });
      }
    }
    await items.updateOne({ _id: source._id, license: oid(c.licenseId) }, { $set: { catalogue_source_id: root, catalogue_shared_fingerprint: fingerprint(source), catalogue_distribution: { at: new Date(), actor: c.userId, outcomes }, updated_date: new Date() } });
  }
  require('../sync/nudge').nudgeSyncAgent();
  return result;
}
async function automatic(ids) {
  const req = origin.currentRequest();
  if (!req || !req.tenantContext || !allowed(req.user, 'item', 'write')) return;
  const db = await BaseModel.getDb(), t = req.tenantContext;
  const branch = await db.collection('branches').findOne({ _id: oid(t.branchId), license: oid(t.licenseId) });
  if (branch?.catalogue_apply_all_branches !== true) return;
  if (process.env.POSNIC_DESKTOP === '1') {
    req.catalogueSharingQueued = true;
    return { queuedAfterSync: true };
  }
  if (!branch.catalogue_policy || branch.catalogue_policy.signature !== signature(branch, branch.catalogue_policy.actor)) {
    req.catalogueSharingConflicts = (req.catalogueSharingConflicts || 0) + ids.length;
    return;
  }
  // The signed policy owner, not a cashier's narrower branch list, owns the
  // fan-out. The worker also covers scheduled/API writes and synced changes.
  req.catalogueSharingQueued = true;
  return { queued: true };
}
// Run only on the authoritative server. A signed cloud policy authorizes
// propagation of later synced edits; local item rows never grant branch access.
async function drain(db) {
  if (process.env.POSNIC_DESKTOP === '1') return;
  const branches = await db.collection('branches').find({ catalogue_apply_all_branches: true }).toArray();
  for (const branch of branches) {
    try {
      const policy = branch.catalogue_policy;
      if (!policy || policy.signature !== signature(branch, policy.actor)) throw new Error('Automatic sharing policy must be confirmed again in cloud admin.');
      const user = await db.collection('users').findOne({ _id: oid(policy.actor), license: branch.license });
      if (!user || user.disabled || user.activate === false || user.is_deleted || user.isActive === false || !allowed(user, 'branch', 'write') || !allowed(user, 'item', 'write')) throw new Error('Automatic sharing owner no longer has permission.');
      const req = { db, user, tenantContext: { branchId: String(branch._id), licenseId: String(branch.license) } };
      const cursor = db.collection('items').find({ branch_id: branch._id, license: branch.license, is_deleted: { $ne: true }, del_status: { $nin: [1,'1',true] } });
      let count = 0;
      for await (const row of cursor) {
        if (row.catalogue_shared_fingerprint === fingerprint(row)) continue;
        await distribute(req, [row._id]);
        if (++count >= 200) break;
      }
      await db.collection('branches').updateOne({ _id: branch._id, license: branch.license }, { $set: { catalogue_sharing_error: null } });
    } catch (e) {
      await db.collection('branches').updateOne({ _id: branch._id, license: branch.license }, { $set: { catalogue_sharing_error: e.message } });
    }
  }
}
function start({ tenants }) {
  if (process.env.POSNIC_DESKTOP === '1') return () => {};
  let busy = false, stopped = false;
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const seen = new Set();
      for (const tenant of tenants()) {
        if (stopped || !tenant.db || tenant.suspended || seen.has(tenant.db.databaseName)) continue;
        seen.add(tenant.db.databaseName);
        await require('../db/tenant-context').runWithTenant(tenant, () => drain(tenant.db));
      }
    } catch (e) { console.error('[catalogue sharing]', e.message); }
    finally { busy = false; }
  }
  const timer = setInterval(tick, 30000); timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
module.exports = { policy, distribute, automatic, context, fields, fingerprint, drain, start };
