'use strict';
const { ObjectId } = require('mongodb');
const mobile = require('./mobile-pos');
const inventory = require('./mobile-inventory');
const barcodes = require('../utils/item-barcodes');
const { withBranchScope } = require('./branch-scope');
const text = (value, max = 160) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value))
    mobile.fail('Invalid product details.', 400);
  return value.trim();
};
async function access(req) {
  const c = await mobile.context(req);
  if (!mobile.allowed(req.user, 'item', 'read') || !mobile.allowed(req.user, 'item', 'write'))
    mobile.fail('Item management permission is required.', 403);
  return c;
}
const referenceScope = (c) => ({ ...withBranchScope({ license: c.license }, c.branchId), is_deleted: { $ne: true }, del_status: { $nin: [1, '1', true] } });
async function options(req) {
  const c = await access(req);
  const q = text(req.query?.q, 100);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = referenceScope(c);
  if (q) filter.$or = ['name', 'category_name', 'supplier_name', 'unit_name'].map(key => ({ [key]: { $regex: escaped, $options: 'i' } }));
  const rows = async (collection) => req.db.collection(collection).find(filter).sort({ _id: 1 }).limit(1001).toArray();
  const [categories, suppliers, taxes, units] = await Promise.all([
    rows('categories'), mobile.allowed(req.user, 'supplier', 'read') ? rows('suppliers') : [], rows('grouptax'), rows('unit'),
  ]);
  const map = (list) => list.slice(0, 1000).map(r => ({ id: String(r._id), name: String(r.name || r.category_name || r.supplier_name || r.unit_name || '') }));
  return {
    shopId: c.shopId, branchId: String(c.branchId), staffId: String(c.userId),
    categories: map(categories), suppliers: map(suppliers), units: map(units),
    taxes: taxes.slice(0, 1000).map(r => ({ id: String(r._id), name: String(r.name || 'Tax'), rate: Number(r.rate ?? r.tax_value ?? 0) })),
    trackStock: c.branch.item_stock_default === 'track_quantities',
    truncated: [categories, suppliers, taxes, units].some(rows => rows.length > 1000),
  };
}
async function lookup(req) {
  const c = await access(req);
  const barcode = text(req.query?.barcode, 128);
  if (!barcode) mobile.fail('Scan or enter a barcode.', 400);
  const rows = await req.db.collection('items').find({
    ...referenceScope(c), $or: [{ barcode_id: barcode }, { barcodes: barcode }],
  }).sort({ _id: 1 }).limit(201).toArray();
  return { shopId: c.shopId, branchId: String(c.branchId), staffId: String(c.userId),
    rows: rows.slice(0, 200).map(inventory.item), truncated: rows.length > 200 };
}
async function create(req, deps = {}) {
  const c = await access(req), b = req.body || {};
  if (b.scope?.shopId !== c.shopId || b.scope?.branchId !== String(c.branchId) || b.scope?.staffId !== String(c.userId))
    mobile.fail('Product belongs to another shop or user.', 409);
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(b.id || '')) mobile.fail('Invalid request identity.', 400);
  const p = b.product || {};
  const product = {
    name: text(p.name), barcode: text(p.barcode, 128), sku: text(p.sku, 80),
    brand: text(p.brand, 100), unit: text(p.unit, 30) || 'piece', categoryId: text(p.categoryId, 24),
    supplierId: text(p.supplierId, 24), taxId: text(p.taxId, 24),
    price: p.price, cost: p.cost ?? 0, mrp: p.mrp ?? 0, opening: p.opening ?? null,
    tracked: p.tracked, weighed: p.weighed, taxInclusive: p.taxInclusive,
    available: p.available, image: p.image || '',
  };
  if (!product.name || ['price', 'cost', 'mrp'].some(k => !Number.isSafeInteger(product[k]) || product[k] < 0 || product[k] > 99999999999) ||
      ['tracked', 'weighed', 'taxInclusive', 'available'].some(k => typeof product[k] !== 'boolean') ||
      (product.opening !== null && (!product.tracked || !Number.isSafeInteger(product.opening) || product.opening < 0 || product.opening > 999999999999 || (!product.weighed && product.opening % 1000))))
    mobile.fail('Review the product price, unit and opening stock.', 400);
  if (typeof product.image !== 'string' || product.image.length > 1400000) mobile.fail('Use a product photo under 1 MB.', 400);
  const fingerprint = mobile.hash(mobile.canonical(product));
  const itemId = new ObjectId(mobile.hash([c.shopId, c.branchId, c.userId, b.id].join(':')).slice(0, 24));
  const collection = req.db.collection('items');
  return barcodes.withWriteLock({ licenseId: c.license }, async () => {
    let saved = await collection.findOne({ _id: itemId, license: c.license, branch_id: c.branchId });
    if (saved && saved.mobile_creation?.fingerprint !== fingerprint) mobile.fail('This save was already used for different product details.', 409);
    if (!saved) {
      const clash = await barcodes.findConflict(collection, [product.barcode].filter(Boolean), { branchId: c.branchId, licenseId: c.license });
      if (clash) mobile.fail(clash.message, 409);
      const reference = async (kind, id) => {
        if (!id) return null;
        if (!/^[a-f0-9]{24}$/i.test(id)) mobile.fail('Invalid product reference.', 400);
        const row = await req.db.collection(kind).findOne({ ...referenceScope(c), _id: new ObjectId(id) });
        if (!row) mobile.fail('Refresh the product choices; a selected record is no longer available.', 409);
        return row;
      };
      if (product.supplierId && !mobile.allowed(req.user, 'supplier', 'read')) mobile.fail('Supplier access is required.', 403);
      const [category, supplier, tax] = await Promise.all([reference('categories', product.categoryId), reference('suppliers', product.supplierId), reference('grouptax', product.taxId)]);
      const rate = Number(tax?.rate ?? tax?.tax_value ?? 0);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) mobile.fail('Unsupported tax rate.', 400);
      let image = '';
      if (product.image) {
        const { bytes, type } = require('./paper-order').image(product.image);
        const store = require('../utils/image-store');
        const key = store.keyFor({ tenantId: req.tenant?._id || req.tenant?.id || req.tenantId || null, kind: 'items', buffer: bytes, mimeType: type });
        await store.saveLocal(key, bytes);
        image = store.urlFor(key);
      }
      const at = new Date();
      const actor = String(req.user.username || req.user.name || c.userId);
      const row = {
        _id: itemId, license: c.license, branch_id: c.branchId,
        branch_access: [{ branch_id: c.branchId, branch_name: c.branch.branch_name || '' }],
        name: product.name, itemid: product.sku || 'M-' + String(itemId).slice(-12), sku: product.sku,
        barcode_id: product.barcode, barcodes: [], brand: product.brand, unit: product.unit,
        category_id: category?._id || '', category_name: category?.name || category?.category_name || '',
        supplier_id: supplier?._id || '', supplier_name: supplier?.name || supplier?.supplier_name || '',
        tax_id: tax?._id || '', tax_name: tax?.name || '', tax: rate, tax_fields: tax?.tax_fields || [], tax_type: product.taxInclusive ? 'inclusive' : 'exclusive',
        selling_price: product.price / 100, company_price: product.cost / 100, mrp_price: product.mrp / 100,
        track_inventory: product.tracked, available_quantity: (product.opening ?? 0) / 1000,
        item_weight_machine_based: product.weighed, available_for_sale: product.available,
        isAvailable: true, item_status: 'regular', image, discount_amount: 0, discount_percentage: 0,
        created_date: at, updated_date: at, createdAt: at, updatedAt: at,
        created_by: actor, updated_by: actor, created_by_id: c.userId, updated_by_id: c.userId,
        mobile_creation: { id: b.id, fingerprint, actor: c.userId, at, opening: product.opening },
      };
      try { await collection.insertOne(row); } catch (e) { if (e.code !== 11000) throw e; }
      saved = await collection.findOne({ _id: itemId, license: c.license, branch_id: c.branchId });
      if (saved?.mobile_creation?.fingerprint !== fingerprint) mobile.fail('Product save identity conflict.', 409);
    }
    if (deps.afterInsert) await deps.afterInsert();
    // The initial balance is part of the item insert, never an increment on retry.
    // Recover its audit record even if the first response was lost after insertion.
    if (saved.mobile_creation.opening !== null) {
      const logId = new ObjectId(mobile.hash('opening:' + itemId).slice(0, 24));
      await req.db.collection('stocklogs').updateOne({ _id: logId }, { $setOnInsert: {
        license: c.license, branch_id: c.branchId, view_item_id: itemId, item_name: saved.name,
        item_barcode_id: saved.barcode_id, process: 'Mobile opening stock', reference: b.id,
        action: 'Add', stocklog: true, opening_balance: 0, closing_balance: saved.mobile_creation.opening / 1000,
        count: String(saved.mobile_creation.opening / 1000), date: saved.created_date,
        created_date: saved.created_date, updated_date: saved.created_date,
        changed_by: saved.created_by, changed_by_userid: c.userId,
      } }, { upsert: true });
      require('../sync/outbox').enqueue({ collection: 'stocklogs', documentId: logId, reason: 'inventory' });
    }
    require('../sync/outbox').enqueue({ collection: 'items', documentId: itemId, reason: 'inventory' });
    require('../sync/nudge').nudgeSyncAgent();
    return { shopId: c.shopId, branchId: String(c.branchId), staffId: String(c.userId), item: inventory.item(saved), confirmedAt: new Date().toISOString() };
  });
}
module.exports = { options, lookup, create };
