const { searchPattern } = require('../utils/safe-search');
// src/repositories/item.repository.js
const BaseModel = require('../models/base.model');
const Item = require('../models/item.model');
const Branch = require('../models/branch.model');
const {
  DEFAULTS,
  ITEM_STATUS,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
} = require('../constants/items.constants');
const { ObjectId } = require('mongodb');
const { formatDate } = require('../utils/helpers');
const StockLogsRepository = require('./stock-log.repository');

// Use the legacy BaseModel-based implementation for field metadata and helpers
const LegacyItemModel = Item.LegacyItemModel;

/*
 * The item fields worth keeping a history of, and how to read each one.
 *
 * This is the whole of the "what changed" story for an item, in one list, so
 * the change log stays one honest thing rather than a pile of special cases.
 * It is deliberately a curated set, not every field:
 *
 *   - available_quantity is left out. It moves on every single sale, and its
 *     real record already lives in stocklogs; putting it here would bury the
 *     handful of edits a person actually made under a wall of stock movement.
 *   - updated_date, images and behaviour flags are left out too - machine
 *     churn and toggles, not the business facts a shopkeeper asks "who changed
 *     this?" about.
 *
 * Prices are in this list, not a list of their own: a price change is a field
 * change like any other, and keeping them together is what lets one History
 * tab tell the whole story instead of two tabs telling half of it each.
 *
 * type decides how a value is compared and shown: 'money' and 'percent' are
 * numeric, 'text' is a trimmed string.
 */
const TRACKED_FIELDS = [
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'category_name', label: 'Category', type: 'text' },
  { field: 'supplier_name', label: 'Supplier', type: 'text' },
  { field: 'itemid', label: 'SKU', type: 'text' },
  { field: 'barcode_id', label: 'Barcode', type: 'text' },
  { field: 'unit', label: 'Unit', type: 'text' },
  { field: 'hsncode', label: 'HSN code', type: 'text' },
  { field: 'tax_name', label: 'Tax', type: 'text' },
  { field: 'tax', label: 'Tax rate', type: 'percent' },
  { field: 'discount_amount', label: 'Discount amount', type: 'money' },
  { field: 'discount_percentage', label: 'Discount', type: 'percent' },
  { field: 'mrp_price', label: 'MRP price', type: 'money' },
  { field: 'company_price', label: 'Company price', type: 'money' },
  { field: 'selling_price', label: 'Selling price', type: 'money' },
];

/**
 * Item Repository
 * Handles all database operations for items
 * Separates data access logic from business logic
 */
class ItemRepository extends BaseModel {
  constructor() {
    super('items');
  }

  /*
   * Every read through this repository excludes tombstoned items, in one
   * place. Deletes stopped being hard deletes the day sync arrived: a row
   * that vanishes locally cannot tell the other side it is gone, which is
   * how items deleted on the web kept living on every till and the other
   * way round. A delete now writes del_status and rides sync like any other
   * change, and this wrapper keeps the tombstones out of every list,
   * search, count and lookup without thirty hand-edited queries.
   *
   * Writes pass through untouched, and other collections this repository
   * borrows (branches, grouptax) are not filtered - only items carry this
   * lifecycle.
   */
  async getCollection(collectionName = null) {
    const coll = await super.getCollection(collectionName);
    const target = collectionName || this.collectionName;
    if (target !== this.collectionName) return coll;
    return ItemRepository.withoutTombstones(coll);
  }

  static withoutTombstones(coll) {
    const NOT_DELETED = { del_status: { $nin: [1, '1', true] } };
    const merge = (f) => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...NOT_DELETED };
      /* A filter already using $or at the top level (the branch filters do)
         must compose through $and, or the tombstone condition would be one
         more alternative instead of a requirement. */
      if (f.$or || f.$and) return { $and: [f, NOT_DELETED] };
      return { ...f, ...NOT_DELETED };
    };
    return new Proxy(coll, {
      get(t, prop) {
        if (prop === 'find' || prop === 'findOne' || prop === 'countDocuments') {
          return (filter, ...rest) => t[prop](merge(filter), ...rest);
        }
        if (prop === 'aggregate') {
          return (pipeline = [], ...rest) =>
            t.aggregate([{ $match: { ...NOT_DELETED } }, ...pipeline], ...rest);
        }
        const v = t[prop];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  /**
   * Find items with pagination and filters (equivalent to itemPage)
   *
   * @param {Object} params
   * @param {string|ObjectId} params.branchId - Branch context
   * @param {string|ObjectId} params.licenseId - License context
   * @param {Object} [params.filters] - Additional filters
   * @param {number} [params.page] - Page number (1-based)
   * @param {number} [params.limit] - Page size
   * @param {Object} [params.sort] - Sort object
   */
  async findPage({
    branchId,
    licenseId,
    filters = {},
    page = 1,
    limit = 5,
    sort = { _id: -1 },
  } = {}) {
    const collection = await this.getCollection(this.collectionName);

    const branchObjectId = this.toObjectId(branchId);
    const licenseObjectId = this.toObjectId(licenseId);

    const branch = await Branch.findOne({
      _id: branchObjectId,
      license: licenseObjectId,
    })
      .select('branch_name')
      .lean();
    if (!branch) {
      throw new Error('Active branch does not belong to the current license');
    }

    const effectiveLimit = parseInt(limit, 10) || 5;
    const effectivePage = parseInt(page, 10) || 1;
    const skip = (effectivePage - 1) * effectiveLimit;

    const clientFilters = this.assignFilterObjects({ ...filters }, LegacyItemModel.fields);
    // Client-supplied scope is never part of the business filter. Leaving a
    // stale branch_name/branch_id alongside the authoritative scope can turn
    // a valid live query into an empty result.
    for (const key of [
      'branch_id',
      'branchId',
      'branch_name',
      'branch_access',
      'branch_access.branch_id',
      'license',
      'license_id',
      'licenseId',
    ]) {
      delete clientFilters[key];
    }

    const filter = {
      // branch_access is the canonical item-to-branch relation. branch_id and
      // branch_name are denormalized legacy fields and can be absent or stale
      // in production data after a branch rename.
      ...clientFilters,
      'branch_access.branch_id': branchObjectId,
      license: licenseObjectId,
    };

    const [total, items] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter, {
          projection: BaseModel.getSelectFields(LegacyItemModel.fields),
        })
        .sort(sort)
        .skip(skip)
        .limit(effectiveLimit)
        .toArray(),
    ]);

    const list = items.map((doc) => BaseModel.simplifyFields(doc));

    return {
      items: list,
      total,
      page: effectivePage,
      limit: effectiveLimit,
      totalPages: Math.ceil(total / effectiveLimit) || 1,
    };
  }

  /**
   * Insert or update an item
   *
   * @param {Object} data - Raw item payload
   * @param {string} [id] - Optional existing item ID for update
   * @param {Object} context - Request context
   * @param {string|ObjectId} context.branchId
   * @param {string|ObjectId} context.licenseId
   * @param {string} [context.loggedUserName]
   * @param {string|ObjectId} [context.loggedUserId]
   */
  /*
   * A unique itemid for a branch. A non-empty SKU that clashes with nothing
   * else in the branch is kept as given; anything empty or colliding becomes
   * one past the highest numeric itemid the branch has. Not a global counter,
   * but per branch and enough to stop the form's default "1" from stacking up.
   */
  async resolveUniqueItemId(collection, branchId, provided, selfId) {
    const filter = { branch_id: branchId };
    if (provided) {
      const clash = { ...filter, itemid: provided };
      if (selfId && ObjectId.isValid(String(selfId)))
        clash._id = { $ne: new ObjectId(String(selfId)) };
      const exists = await collection.findOne(clash, { projection: { _id: 1 } });
      if (!exists) return provided; // genuinely unique - honour it
    }
    const rows = await collection.find(filter, { projection: { itemid: 1 } }).toArray();
    let max = 0;
    for (const r of rows) {
      const n = Number(r && r.itemid);
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return String(max + 1);
  }

  /*
   * Record price changes to the price_history collection, one row per price
   * field that actually changed. Powers the per-item Price history tab and the
   * price-changes report. Only the three item-level prices exist to track:
   * mrp_price, company_price, selling_price. Best effort by design - a logging
   * failure must never fail the save it is describing.
   */
  /*
   * Record which of an item's tracked fields actually changed.
   *
   * One choke point for the whole change log: a single edit, a re-import or the
   * bulk price tool all pass through here, so nothing that changes a price or a
   * name can forget to write its history. Only fields that really moved are
   * written - an edit that re-saves the same values leaves no rows - and it is
   * best-effort by design: the history must never be the reason a save fails.
   *
   * Rows still land in the price_history collection. The name is now a slight
   * misnomer - it holds every tracked change, not only prices - but it is an
   * already-syncing collection, and renaming it would strand the rows written
   * before this change and force a new build onto every till for nothing a
   * user would see. The label and value_type on each row are what the History
   * view reads.
   */
  async logItemChanges(itemRef, oldDoc = {}, newDoc = {}, context = {}, process = 'Edit') {
    const textVal = (v) => (v === undefined || v === null ? '' : String(v).trim());
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    const changes = [];
    for (const { field, label, type } of TRACKED_FIELDS) {
      if (newDoc[field] === undefined) continue; // not being set - not a change
      if (type === 'text') {
        const oldV = textVal(oldDoc[field]);
        const newV = textVal(newDoc[field]);
        if (oldV !== newV) changes.push({ field, label, type, old_value: oldV, new_value: newV });
      } else {
        const oldV = num(oldDoc[field]);
        const newV = num(newDoc[field]);
        if (oldV !== newV) changes.push({ field, label, type, old_value: oldV, new_value: newV });
      }
    }
    if (!changes.length) return 0;

    const db = await BaseModel.getDb();
    const now = new Date();
    const rows = changes.map((c) => ({
      item_id: itemRef._id,
      item_name: itemRef.name || oldDoc.name || newDoc.name || '',
      branch_id: itemRef.branch_id || oldDoc.branch_id || null,
      field: c.field,
      label: c.label,
      value_type: c.type, // 'money' | 'percent' | 'text'
      old_value: c.old_value,
      new_value: c.new_value,
      process, // 'Edit' | 'Bulk' | 'Import'
      changed_by: context.userName || context.loggedUserName || '',
      changed_by_id: context.userId || context.loggedUserId || null,
      date: now,
      created_date: now,
      updated_date: now,
      license: BaseModel.license || null,
    }));
    await db.collection('price_history').insertMany(rows);
    return rows.length;
  }

  /** Recent tracked changes for one item, newest first. */
  async getPriceHistory(itemId, { limit = 200 } = {}) {
    try {
      const db = await BaseModel.getDb();
      const filter = { item_id: this.toObjectId(itemId) };
      if (BaseModel.license) filter.license = BaseModel.license;
      const rows = await db
        .collection('price_history')
        .find(filter)
        .sort({ date: -1 })
        .limit(Math.min(1000, Number(limit) || 200))
        .toArray();
      return { status: true, data: rows };
    } catch (error) {
      return { status: false, data: [], message: error.message };
    }
  }

  /** Recent bulk price runs, newest first, paginated - the pricing tab's audit
   *  list of who raised or lowered what, when, and on how many items. */
  async getBulkPriceUpdates({ limit = 20, skip = 0 } = {}) {
    try {
      const db = await BaseModel.getDb();
      const filter = {};
      if (BaseModel.license) filter.license = BaseModel.license;
      const col = db.collection('bulk_price_updates');
      const lim = Math.min(100, Math.max(1, Number(limit) || 20));
      const sk = Math.max(0, Number(skip) || 0);
      const [rows, total] = await Promise.all([
        col.find(filter).sort({ date: -1 }).skip(sk).limit(lim).toArray(),
        col.countDocuments(filter),
      ]);
      return { status: true, data: rows, total };
    } catch (error) {
      return { status: false, data: [], total: 0, message: error.message };
    }
  }

  /*
   * Raise or lower prices across many items at once - all items, or one
   * category - by a percentage or a flat amount, on any one price field. Every
   * item that actually changes is written to price_history with process
   * 'Bulk', so the change is auditable exactly like a single edit. Prices are
   * clamped at zero and rounded to two decimals.
   */
  /*
   * The price rules a bulk change must not quietly break.
   *
   * After a proposed change sets `field` to `newV`, the selling price must not
   * end up ABOVE the MRP (an increase gone too far) nor BELOW the company/cost
   * price (a decrease that sells at a loss). Each is only judged when the
   * reference price is actually set - an item with no MRP or no cost recorded
   * is not a violation, just unconfigured. Returns the broken rule, or null.
   */
  _priceRuleViolation(item, field, newV) {
    let sell = Number(item.selling_price) || 0;
    let mrp = Number(item.mrp_price) || 0;
    let cost = Number(item.company_price) || 0;
    if (field === 'selling_price') sell = newV;
    else if (field === 'mrp_price') mrp = newV;
    else if (field === 'company_price') cost = newV;
    if (mrp > 0 && sell > mrp) return { rule: 'exceeds_mrp', selling: sell, limit: mrp };
    if (cost > 0 && sell < cost) return { rule: 'below_cost', selling: sell, limit: cost };
    return null;
  }

  // Validate + normalise a bulk-price request. Returns { error } or the parts.
  _bulkPriceParams({ field, op, value, direction }) {
    const allowedFields = ['mrp_price', 'company_price', 'selling_price'];
    if (!allowedFields.includes(field)) return { error: 'Unknown price field' };
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter a valid amount' };
    if (op !== 'percent' && op !== 'amount') return { error: 'Choose percent or amount' };
    const sign = direction === 'decrease' ? -1 : 1;
    const compute = (oldV) => {
      const delta = op === 'percent' ? (oldV * amount) / 100 : amount;
      return Math.max(0, Math.round((oldV + sign * delta) * 100) / 100);
    };
    return { amount, sign, compute };
  }

  _bulkPriceFilter({ scope, categoryId }, context) {
    const filter = {};
    if (BaseModel.license) filter.license = BaseModel.license;
    if (context.branchId) {
      const b = this.toObjectId(context.branchId);
      filter.$or = [{ 'branch_access.branch_id': b }, { branch_id: b }];
    }
    if (scope === 'category') {
      if (!categoryId) return { error: 'Choose a category' };
      filter.category_id = this.toObjectId(categoryId);
    }
    return { filter };
  }

  /*
   * Dry-run a bulk price change: compute what it would do WITHOUT writing, and
   * report how many items would change and which would break a price rule
   * (selling above MRP, or selling below cost). This is the "check feasible"
   * step - the shop sees the damage before it happens, including on a decrease
   * that would sell below cost, not just an increase past MRP.
   */
  async previewBulkUpdatePrices(
    { scope, categoryId, field, op, value, direction } = {},
    context = {}
  ) {
    const parts = this._bulkPriceParams({ field, op, value, direction });
    if (parts.error) return { status: false, message: parts.error };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };

    const collection = await this.getCollection(this.collectionName);
    const items = await collection
      .find(built.filter, {
        projection: { name: 1, mrp_price: 1, company_price: 1, selling_price: 1 },
      })
      .toArray();

    let willChange = 0;
    const exceedsMrp = [];
    const belowCost = [];
    for (const it of items) {
      const oldV = Number(it[field]) || 0;
      const newV = parts.compute(oldV);
      if (newV !== oldV) willChange += 1;
      const v = this._priceRuleViolation(it, field, newV);
      if (!v) continue;
      const row = { name: it.name || '', old_value: oldV, new_value: newV, limit: v.limit };
      if (v.rule === 'exceeds_mrp' && exceedsMrp.length < 100) exceedsMrp.push(row);
      if (v.rule === 'below_cost' && belowCost.length < 100) belowCost.push(row);
    }

    return {
      status: true,
      data: {
        total: items.length,
        willChange,
        exceedsMrpCount: exceedsMrp.length,
        belowCostCount: belowCost.length,
        exceedsMrp,
        belowCost,
      },
      message: 'Preview ready',
    };
  }

  async bulkUpdatePrices(
    { scope, categoryId, field, op, value, direction, skipViolations } = {},
    context = {}
  ) {
    const parts = this._bulkPriceParams({ field, op, value, direction });
    if (parts.error) return { status: false, message: parts.error };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };

    const collection = await this.getCollection(this.collectionName);
    const filter = built.filter;

    const items = await collection
      .find(filter, {
        projection: {
          [field]: 1,
          name: 1,
          branch_id: 1,
          mrp_price: 1,
          company_price: 1,
          selling_price: 1,
        },
      })
      .toArray();
    if (!items.length)
      return {
        status: true,
        data: { updated: 0, total: 0, skipped: 0 },
        message: 'No items matched',
      };

    const now = new Date();
    const db = await BaseModel.getDb();
    // One id for this whole run: stamped on every item row it writes and on the
    // batch record below, so the run and the items it touched link both ways.
    const batchId = new ObjectId();
    // Same label/value_type the single-edit path writes, so the History view
    // renders a bulk change identically to a hand edit.
    const fieldMeta = TRACKED_FIELDS.find((f) => f.field === field) || {
      label: field,
      type: 'money',
    };
    const priceRows = [];
    let updated = 0;
    let skipped = 0;
    for (const it of items) {
      const oldV = Number(it[field]) || 0;
      const newV = parts.compute(oldV);
      if (newV === oldV) continue;
      // When asked, leave alone any item this change would push over MRP or
      // under cost, and count it, rather than writing a price that breaks a rule.
      if (skipViolations && this._priceRuleViolation(it, field, newV)) {
        skipped += 1;
        continue;
      }
      await collection.updateOne(
        { _id: it._id },
        {
          $set: {
            [field]: newV,
            updated_date: now,
            updated_by: context.userName || '',
            updated_by_id: context.userId || null,
          },
        }
      );
      updated += 1;
      priceRows.push({
        item_id: it._id,
        item_name: it.name || '',
        branch_id: it.branch_id || null,
        field,
        label: fieldMeta.label,
        value_type: fieldMeta.type,
        old_value: oldV,
        new_value: newV,
        process: 'Bulk',
        batch_id: batchId, // links this item row to the bulk run below
        changed_by: context.userName || '',
        changed_by_id: context.userId || null,
        date: now,
        created_date: now,
        updated_date: now,
        license: BaseModel.license || null,
      });
    }
    if (priceRows.length) {
      await db
        .collection('price_history')
        .insertMany(priceRows)
        .catch(() => {});
    }
    // Batch-level audit: one row per bulk run, so "who changed what, when, to how
    // many items" reads as a single event rather than being reconstructed from
    // the item rows. Only written when something actually changed.
    if (updated > 0) {
      await db
        .collection('bulk_price_updates')
        .insertOne({
          _id: batchId,
          field,
          label: fieldMeta.label,
          scope: scope === 'category' ? 'category' : 'all',
          category_id: scope === 'category' ? this.toObjectId(categoryId) : null,
          op, // 'percent' | 'amount'
          direction, // 'increase' | 'decrease'
          value: Number(value) || 0,
          items_changed: updated,
          items_matched: items.length,
          items_skipped: skipped,
          changed_by: context.userName || '',
          changed_by_id: context.userId || null,
          date: now,
          created_date: now,
          license: BaseModel.license || null,
        })
        .catch(() => {});
    }
    return {
      status: true,
      data: { updated, total: items.length, skipped, batch_id: batchId },
      message:
        `Updated ${updated} of ${items.length} item(s)` +
        (skipped ? `, skipped ${skipped} that would break MRP or cost` : ''),
    };
  }

  /** Recent bulk stock runs, newest first, paginated - the audit list of who
   *  added or removed stock, when, and on how many items. Mirrors
   *  getBulkPriceUpdates but reads the bulk_stock_updates collection. */
  async getBulkStockUpdates({ limit = 20, skip = 0 } = {}) {
    try {
      const db = await BaseModel.getDb();
      const filter = {};
      if (BaseModel.license) filter.license = BaseModel.license;
      const col = db.collection('bulk_stock_updates');
      const lim = Math.min(100, Math.max(1, Number(limit) || 20));
      const sk = Math.max(0, Number(skip) || 0);
      const [rows, total] = await Promise.all([
        col.find(filter).sort({ date: -1 }).skip(sk).limit(lim).toArray(),
        col.countDocuments(filter),
      ]);
      return { status: true, data: rows, total };
    } catch (error) {
      return { status: false, data: [], total: 0, message: error.message };
    }
  }

  // Validate + normalise a bulk-stock request. Stock has a single field
  // (available_quantity), so unlike price there is nothing to choose. Returns
  // { error } or { amount, sign, compute }. Stock is clamped at zero and rounded
  // to two decimals - weight-priced items can carry fractional quantity.
  _bulkStockParams({ op, value, direction }) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter a valid quantity' };
    if (op !== 'percent' && op !== 'amount') return { error: 'Choose percent or amount' };
    const sign = direction === 'decrease' ? -1 : 1;
    const compute = (oldV) => {
      const delta = op === 'percent' ? (oldV * amount) / 100 : amount;
      return Math.max(0, Math.round((oldV + sign * delta) * 100) / 100);
    };
    return { amount, sign, compute };
  }

  /*
   * Dry-run a bulk stock change: compute what it would do WITHOUT writing, and
   * report how many items would change, with a small sample. The "check" step
   * so the shop sees the effect before committing.
   */
  async previewBulkUpdateStock({ scope, categoryId, op, value, direction } = {}, context = {}) {
    const parts = this._bulkStockParams({ op, value, direction });
    if (parts.error) return { status: false, message: parts.error };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };

    const collection = await this.getCollection(this.collectionName);
    const items = await collection
      .find(built.filter, {
        projection: { name: 1, available_quantity: 1 },
      })
      .toArray();

    let willChange = 0;
    const sample = [];
    for (const it of items) {
      const oldV = Number(it.available_quantity) || 0;
      const newV = parts.compute(oldV);
      if (newV === oldV) continue;
      willChange += 1;
      if (sample.length < 100)
        sample.push({ name: it.name || '', old_value: oldV, new_value: newV });
    }

    return {
      status: true,
      data: { total: items.length, willChange, sample },
      message: 'Preview ready',
    };
  }

  /*
   * Add to or remove from available stock across many items at once - all items,
   * or one category - by a flat quantity or a percentage. Every item that
   * actually changes AND is inventory-tracked is written to stocklogs with
   * process 'Bulk Stock', so the movement is auditable exactly like a single
   * hand edit. Stock is clamped at zero.
   */
  async bulkUpdateStock({ scope, categoryId, op, value, direction, note } = {}, context = {}) {
    const parts = this._bulkStockParams({ op, value, direction });
    if (parts.error) return { status: false, message: parts.error };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };
    // A free-text reason the shopkeeper can attach to the run ("new delivery",
    // "stock take correction"), carried onto every stock-log row and the batch
    // record so later readers see why the numbers moved. Capped so it cannot
    // bloat the audit.
    const cleanNote = String(note || '')
      .trim()
      .slice(0, 500);

    const collection = await this.getCollection(this.collectionName);
    const items = await collection
      .find(built.filter, {
        projection: {
          available_quantity: 1,
          name: 1,
          branch_id: 1,
          barcode_id: 1,
          track_inventory: 1,
        },
      })
      .toArray();
    if (!items.length)
      return {
        status: true,
        data: { updated: 0, total: 0, skipped: 0 },
        message: 'No items matched',
      };

    const now = new Date();
    const db = await BaseModel.getDb();
    // One id for the whole run: stamped on the batch record so the run reads as
    // a single event.
    const batchId = new ObjectId();

    // Stock logs record real opening/closing balances unless the branch turned
    // that off (then they read 'N/A'); the log row itself is still written.
    const branchObjectId = context.branchId ? this.toObjectId(context.branchId) : null;
    let stockLogStatus = true;
    if (branchObjectId) {
      const branchesCollection = await this.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({ _id: branchObjectId });
      stockLogStatus = branchDoc?.stock_management_log !== false;
    }
    const stockLogsRepository = new StockLogsRepository();

    let updated = 0;
    for (const it of items) {
      const oldV = Number(it.available_quantity) || 0;
      const newV = parts.compute(oldV);
      if (newV === oldV) continue;
      await collection.updateOne(
        { _id: it._id },
        {
          $set: {
            available_quantity: newV,
            updated_date: now,
            updated_by: context.userName || '',
            updated_by_id: context.userId || null,
          },
        }
      );
      updated += 1;

      // Audit each changed, inventory-tracked item to stocklogs, exactly as the
      // single-edit path does. Same count convention: old - new, negated when
      // stock went up.
      if (it.track_inventory === true) {
        const diff = oldV - newV;
        const count = diff < 0 ? String(Math.abs(diff)) : '-' + String(diff);
        await stockLogsRepository
          .createStockLog({
            stocklog: stockLogStatus,
            branch_id: branchObjectId || it.branch_id || null,
            view_item_id: it._id,
            item_barcode_id: it.barcode_id,
            item_name: it.name,
            item_quantity: String(newV),
            process: 'Bulk Stock',
            reference: it.barcode_id,
            note: cleanNote,
            date: now,
            action: 'Add',
            opening_balance: String(oldV),
            closing_balance: String(newV),
            count: count,
            changed_by_userid: context.userId,
            changed_by: context.userName,
          })
          .catch(() => {});
      }
    }

    // Batch-level audit: one row per bulk run, so "who added how much stock to
    // how many items, when" reads as a single event. Only when something changed.
    if (updated > 0) {
      await db
        .collection('bulk_stock_updates')
        .insertOne({
          _id: batchId,
          field: 'available_quantity',
          label: 'Stock',
          scope: scope === 'category' ? 'category' : 'all',
          category_id: scope === 'category' ? this.toObjectId(categoryId) : null,
          op, // 'percent' | 'amount'
          direction, // 'increase' | 'decrease'
          value: Number(value) || 0,
          note: cleanNote,
          items_changed: updated,
          items_matched: items.length,
          items_skipped: 0,
          changed_by: context.userName || '',
          changed_by_id: context.userId || null,
          date: now,
          created_date: now,
          license: BaseModel.license || null,
        })
        .catch(() => {});
    }

    return {
      status: true,
      data: { updated, total: items.length, skipped: 0, batch_id: batchId },
      message: `Updated stock for ${updated} of ${items.length} item(s)`,
    };
  }

  /*
   * Set the selling price from a target margin in one move - the "40% margin"
   * button. For each item the new selling price is worked out FROM its cost
   * (company price), not nudged from an unknown base:
   *   margin mode  selling = cost / (1 - margin/100)   (margin is % OF selling)
   *   markup mode  selling = cost * (1 + margin/100)   (margin is % ON cost)
   * An item with no cost is left alone - there is nothing to base a margin on.
   */
  _marginCompute(mode, marginPct) {
    const m = Number(marginPct);
    return (cost) => {
      const c = Number(cost) || 0;
      if (c <= 0) return null; // no cost -> no basis for a margin
      const val = mode === 'markup' ? c * (1 + m / 100) : c / (1 - m / 100);
      return Math.round(val * 100) / 100;
    };
  }

  _validMargin(marginPct, mode) {
    const m = Number(marginPct);
    if (!Number.isFinite(m) || m < 0) return 'Enter a valid margin percentage';
    if (mode === 'margin' && m >= 100) return 'A margin of 100% or more is not possible';
    return null;
  }

  // Dry-run a margin change: what it would do, how many have no cost to base it
  // on, and how many would price above MRP - all without writing.
  async previewSetMargin({ scope, categoryId, margin, mode = 'margin' } = {}, context = {}) {
    const err = this._validMargin(margin, mode);
    if (err) return { status: false, message: err };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };
    const collection = await this.getCollection(this.collectionName);
    const items = await collection
      .find(built.filter, {
        projection: { name: 1, mrp_price: 1, company_price: 1, selling_price: 1 },
      })
      .toArray();
    const compute = this._marginCompute(mode, margin);
    let willChange = 0;
    let noCost = 0;
    const exceedsMrp = [];
    for (const it of items) {
      const newV = compute(it.company_price);
      if (newV == null) {
        noCost += 1;
        continue;
      }
      if (newV === (Number(it.selling_price) || 0)) continue;
      willChange += 1;
      const v = this._priceRuleViolation(it, 'selling_price', newV);
      if (v && v.rule === 'exceeds_mrp') {
        exceedsMrp.push({ name: it.name || '', selling: newV, limit: v.limit });
      }
    }
    return {
      status: true,
      data: {
        total: items.length,
        willChange,
        noCost,
        exceedsMrpCount: exceedsMrp.length,
        exceedsMrp: exceedsMrp.slice(0, 50),
      },
      message: 'preview',
    };
  }

  // Apply a target margin across all items or one category. Same guards, history
  // logging and batch-audit record as a bulk +/-, so a margin run is auditable
  // exactly like a hand edit.
  async bulkSetMargin(
    { scope, categoryId, margin, mode = 'margin', skipViolations } = {},
    context = {}
  ) {
    const err = this._validMargin(margin, mode);
    if (err) return { status: false, message: err };
    const built = this._bulkPriceFilter({ scope, categoryId }, context);
    if (built.error) return { status: false, message: built.error };
    const collection = await this.getCollection(this.collectionName);
    const items = await collection
      .find(built.filter, {
        projection: { name: 1, branch_id: 1, mrp_price: 1, company_price: 1, selling_price: 1 },
      })
      .toArray();
    if (!items.length)
      return {
        status: true,
        data: { updated: 0, total: 0, skipped: 0 },
        message: 'No items matched',
      };

    const now = new Date();
    const db = await BaseModel.getDb();
    const batchId = new ObjectId();
    const compute = this._marginCompute(mode, margin);
    const fieldMeta = TRACKED_FIELDS.find((f) => f.field === 'selling_price') || {
      label: 'Selling price',
      type: 'money',
    };
    const priceRows = [];
    let updated = 0;
    let skipped = 0;
    let noCost = 0;
    for (const it of items) {
      const oldV = Number(it.selling_price) || 0;
      const newV = compute(it.company_price);
      if (newV == null) {
        noCost += 1;
        continue;
      }
      if (newV === oldV) continue;
      if (skipViolations && this._priceRuleViolation(it, 'selling_price', newV)) {
        skipped += 1;
        continue;
      }
      await collection.updateOne(
        { _id: it._id },
        {
          $set: {
            selling_price: newV,
            updated_date: now,
            updated_by: context.userName || '',
            updated_by_id: context.userId || null,
          },
        }
      );
      updated += 1;
      priceRows.push({
        item_id: it._id,
        item_name: it.name || '',
        branch_id: it.branch_id || null,
        field: 'selling_price',
        label: fieldMeta.label,
        value_type: fieldMeta.type,
        old_value: oldV,
        new_value: newV,
        process: 'Bulk',
        batch_id: batchId,
        changed_by: context.userName || '',
        changed_by_id: context.userId || null,
        date: now,
        created_date: now,
        updated_date: now,
        license: BaseModel.license || null,
      });
    }
    if (priceRows.length) {
      await db
        .collection('price_history')
        .insertMany(priceRows)
        .catch(() => {});
    }
    if (updated > 0) {
      await db
        .collection('bulk_price_updates')
        .insertOne({
          _id: batchId,
          field: 'selling_price',
          label: fieldMeta.label,
          scope: scope === 'category' ? 'category' : 'all',
          category_id: scope === 'category' ? this.toObjectId(categoryId) : null,
          op: mode === 'markup' ? 'markup' : 'margin',
          direction: 'margin',
          value: Number(margin) || 0,
          items_changed: updated,
          items_matched: items.length,
          items_skipped: skipped,
          changed_by: context.userName || '',
          changed_by_id: context.userId || null,
          date: now,
          created_date: now,
          license: BaseModel.license || null,
        })
        .catch(() => {});
    }
    return {
      status: true,
      data: { updated, total: items.length, skipped, noCost, batch_id: batchId },
      message:
        `Set ${mode === 'markup' ? 'markup' : 'margin'} ${margin}% on ${updated} of ${items.length} item(s)` +
        (skipped ? `, skipped ${skipped} that would exceed MRP` : '') +
        (noCost ? `, ${noCost} have no cost price` : ''),
    };
  }

  /*
   * Rollback for a half-created variant family (V1): these rows were never
   * visible to anyone, so this is a hard delete - no recycle_bin tombstone
   * (a tombstone would SYNC the non-event fleet-wide) - and their freshly
   * written 'Add Item' stock logs go with them.
   */
  async hardDeleteItems(ids, { licenseId } = {}) {
    const objectIds = (ids || [])
      .map((v) => (ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : null))
      .filter(Boolean);
    if (!objectIds.length) return { deleted: 0 };
    const filter = { _id: { $in: objectIds } };
    if (licenseId && ObjectId.isValid(String(licenseId))) {
      filter.license = new ObjectId(String(licenseId));
    }
    const collection = await this.getCollection(this.collectionName);
    const r = await collection.deleteMany(filter);
    try {
      const logs = await this.getCollection('stocklogs');
      await logs.deleteMany({ view_item_id: { $in: objectIds } });
    } catch (e) {
      /* debris, not data - never fail the rollback over it */
    }
    return { deleted: r.deletedCount || 0 };
  }

  /** Every member of one variant family, for the edit page's strip (V1). */
  async getFamily(groupId, context = {}) {
    if (!groupId || !ObjectId.isValid(String(groupId))) {
      return { status: false, data: null, message: 'Not a valid family id' };
    }
    const filter = { variant_group_id: new ObjectId(String(groupId)) };
    if (context.licenseId && ObjectId.isValid(String(context.licenseId))) {
      filter.license = new ObjectId(String(context.licenseId));
    }
    const collection = await this.getCollection(this.collectionName);
    const rows = await collection
      .find(filter, {
        projection: {
          name: 1,
          variant_value: 1,
          variant_axis: 1,
          variant_parent_name: 1,
          selling_price: 1,
          available_quantity: 1,
          track_inventory: 1,
          barcode_id: 1,
        },
      })
      .sort({ variant_value: 1 })
      .toArray();
    return {
      status: true,
      data: rows.map((r) => ({
        id: String(r._id),
        name: r.name || '',
        variant_value: r.variant_value || '',
        variant_axis: r.variant_axis || '',
        variant_parent_name: r.variant_parent_name || '',
        selling_price: r.selling_price || 0,
        available_quantity: r.available_quantity || 0,
        track_inventory: r.track_inventory === true,
        barcode_id: r.barcode_id || '',
      })),
      message: 'success',
    };
  }

  async upsertItem(data, id = '', context = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);

      const branchId = context.branchId;
      const licenseId = context.licenseId;

      if (!branchId || !licenseId) {
        return {
          status: false,
          message: 'Branch and license context required',
          data: null,
        };
      }

      const branchObjectId =
        branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      const branch = await Branch.findOne({
        _id: branchObjectId,
        license: licenseObjectId,
      })
        .select('branch_name')
        .lean();
      if (!branch) {
        return {
          status: false,
          message: 'Active branch does not belong to the current license',
          data: null,
        };
      }

      // Check for existing item with same details
      const existingFilter = {
        'branch_access.branch_id': branchObjectId,
        license: licenseObjectId,
        name: data.name,
        barcode_id: data.barcode_id,
        mrp_price: parseFloat(data.mrp_price),
        company_price: parseFloat(data.company_price),
        selling_price: parseFloat(data.selling_price),
      };

      const existing = await collection.findOne(existingFilter);
      if (existing && existing._id.toString() !== id) {
        return {
          status: 'exist',
          message: 'This item details already exist in our system',
          data: null,
        };
      }

      /*
       * Barcode uniqueness, per branch. Two items answering one scan corrupts
       * scan-to-sell - the till adds whichever the index returns first. The
       * check covers the primary barcode and the V3 alternates on BOTH sides
       * (this item's codes vs existing primaries and alternates). Blank
       * barcodes are exempt: most quick-entry items have none.
       */
      const candidateCodes = [
        ...(data.barcode_id ? [String(data.barcode_id).trim()] : []),
        ...(Array.isArray(data.barcodes) ? data.barcodes.map((b) => String(b).trim()) : []),
      ].filter(Boolean);
      if (candidateCodes.length > 0) {
        const barcodeFilter = {
          'branch_access.branch_id': branchObjectId,
          license: licenseObjectId,
          $or: [{ barcode_id: { $in: candidateCodes } }, { barcodes: { $in: candidateCodes } }],
        };
        const barcodeClash = await collection.findOne(barcodeFilter);
        if (barcodeClash && barcodeClash._id.toString() !== id) {
          return {
            status: 'exist',
            message: ERROR_MESSAGES.BARCODE_EXISTS,
            data: null,
          };
        }
      }

      // Get tax fields if tax_id provided
      let taxFields = [];
      if (data.tax_id && ObjectId.isValid(data.tax_id)) {
        const taxCollection = await this.getCollection('grouptax');
        const taxDoc = await taxCollection.findOne({
          _id: new ObjectId(data.tax_id),
          branch_id: branchObjectId,
          license: licenseObjectId,
        });
        if (taxDoc?.tax_fields) {
          taxFields = taxDoc.tax_fields;
        }
      }

      // Process multi images
      const multiImage = Array.isArray(data.image)
        ? data.image.map((item) => ({
            name: item.name,
            size: parseInt(item.size, 10) || 0,
            cover: item.cover,
          }))
        : [];

      const now = new Date();
      const branchName = (branch.branch_name || '').trim();

      const loggedUserName = context.loggedUserName || context.loggedUser || 'System';
      const loggedUserId = context.loggedUserId !== undefined ? context.loggedUserId : null;

      /* Give the item a unique itemid within its branch. The form defaults the
         SKU to "1", so left alone every new item collided with the first one -
         which is what kept raising the duplicate-id health warning. A SKU the
         user genuinely made unique is kept; an empty or colliding one becomes
         the next free number for that branch. */
      const resolvedItemId = await this.resolveUniqueItemId(
        collection,
        branchObjectId,
        (data.sku_id || '').trim(),
        id
      );

      const updateData = {
        branch_id: branchObjectId,
        branch_name: branchName,
        branch_access: [{ branch_id: branchObjectId, branch_name: branchName }],
        name: (data.name || '').trim(),
        date: now,
        itemid: resolvedItemId,
        barcode_id: (data.barcode_id || '').trim(),
        supplier_name: (data.supplier_name || '').trim(),
        supplier_id:
          data.supplier_id && ObjectId.isValid(data.supplier_id)
            ? new ObjectId(data.supplier_id)
            : '',
        category_name: (data.category_name || '').trim(),
        category_id:
          data.category_id && ObjectId.isValid(data.category_id)
            ? new ObjectId(data.category_id)
            : '',
        discount_amount: parseFloat(data.discount_amount) || 0,
        discount_percentage: parseInt(data.discount_percentage, 10) || 0,
        hsncode: (data.hsn_code || '').trim(),
        hsndescription: (data.hsn_description || '').trim(),
        tax_method: (data.tax_method || '').trim(),
        tax_name: data.tax_name || data.hsn_code || '',
        tax_id:
          data.tax_id && ObjectId.isValid(data.tax_id)
            ? new ObjectId(data.tax_id)
            : data.hsn_code || '',
        tax: parseFloat(data.tax) || 0,
        tax_type: data.tax_type || '',
        tax_fields: taxFields,
        mrp_price: parseFloat(data.mrp_price) || 0,
        company_price: parseFloat(data.company_price) || 0,
        selling_price: parseFloat(data.selling_price) || 0,
        available_quantity: parseFloat(data.available_quantity) || 0,
        image: (data.cover_image || '').trim(),
        multi_image: multiImage,
        sort_order: parseInt(data.position, 10) || 0,
        description: (data.description || '').trim(),
        track_inventory: Boolean(data.inventory),
        sales_channel: Boolean(data.sales_channel),
        ecommerce: Boolean(data.ecommerce),
        isAvailable: Boolean(data.ecommerce),
        negative_stock: Boolean(data.negative_stock),
        item_weight_machine_based: Boolean(data.item_weight_machine_based),
        items_mfg_date: data.items_mfg_date || null,
        items_expiry_date: data.items_expiry_date || null,
        updated_date: now,
        updated_by: loggedUserName || 'System',
        updated_by_id: loggedUserId || null,
        license: licenseObjectId,
        unit: data.unit || 'qty',
        unit_id: data.unit_id || '',
      };

      /*
       * Open price (IC1): the deliberate ask-at-the-till state. Presence-
       * gated - clients that predate the checkbox omit the key and never
       * clear a stored flag.
       */
      if (data.open_price !== undefined) {
        updateData.open_price = data.open_price === true || data.open_price === 'true';
      }

      /*
       * Variant family link (VARIANT_SYSTEM_RESEARCH V1): four presence-
       * gated fields that turn the "name generator" into a real family.
       * Absent = plain item, and absent NEVER clears an existing link -
       * every legacy edit path omits them, and an edit that silently
       * orphaned an item from its family would be the old bug reborn.
       */
      if (data.variant_group_id && ObjectId.isValid(String(data.variant_group_id))) {
        updateData.variant_group_id = new ObjectId(String(data.variant_group_id));
        updateData.variant_axis = String(data.variant_axis || '').trim();
        updateData.variant_value = String(data.variant_value || '').trim();
        updateData.variant_parent_name = String(data.variant_parent_name || '').trim();
      }

      /* Unit conversion (V3): how many base units one purchase unit holds
         (box of 24 -> 24). STOCK STAYS IN BASE UNITS - the factor only
         powers the receiving screen's entry assist; nothing in stock or
         reservation math reads it. Presence-gated. */
      if (data.purchase_unit !== undefined) {
        updateData.purchase_unit = String(data.purchase_unit || '').trim();
      }
      if (data.conversion_factor !== undefined) {
        const cf = Number(data.conversion_factor);
        updateData.conversion_factor = Number.isFinite(cf) && cf > 0 ? cf : 0;
      }

      /* Alternate barcodes (V3): manufacturer + internal codes beside the
         primary. Lookup checks both; labels keep printing the primary.
         Presence-gated: sent (even empty) sets, omitted changes nothing. */
      if (Array.isArray(data.barcodes)) {
        updateData.barcodes = [
          ...new Set(
            data.barcodes
              .map((v) => String(v || '').trim())
              .filter((v) => v && v !== updateData.barcode_id)
          ),
        ];
      }

      /* Modifier groups (V2): which option sets this item offers at sale
         time. Presence-gated like the variant link - a payload that sends
         the key (even empty) sets it; one that omits it changes nothing. */
      if (Array.isArray(data.modifier_group_ids)) {
        updateData.modifier_group_ids = data.modifier_group_ids
          .filter((v) => ObjectId.isValid(String(v)))
          .map((v) => new ObjectId(String(v)));
      }

      if (!id) {
        // Insert new item
        const insertData = {
          ...updateData,
          created_date: now,
          created_by: loggedUserName || 'System',
          created_by_id: loggedUserId || null,
          item_status: ITEM_STATUS.REGULAR,
        };

        const result = await collection.insertOne(insertData);
        const insertedId = result.insertedId;

        // Get branch to check stock_management setting (PHP line 256)
        const branchesCollection = await this.getCollection('branches');
        const branchDoc = await branchesCollection.findOne({
          _id: branchObjectId,
        });

        const stockLogStatus = branchDoc?.stock_management_log !== false;

        console.log('[ITEM CREATE DEBUG] Stock log context:', {
          stockLogStatus: stockLogStatus,
          track_inventory: insertData.track_inventory,
        });

        // Create stock log for ADD Item (mirrors PHP item_model.php: always
        // log when track_inventory is true; stock_management_log only controls
        // whether opening/closing balances are numeric vs 'N/A'. Do not gate
        // on branch stock_management here.
        if (insertData.track_inventory === true) {
          const stockLogsRepository = new StockLogsRepository();
          const count = 0;

          console.log(
            '[ITEM CREATE DEBUG] Creating stock log for new item:',
            insertedId.toString()
          );

          await stockLogsRepository.createStockLog({
            stocklog: stockLogStatus,
            branch_id: branchObjectId,
            view_item_id: insertedId,
            item_barcode_id: insertData.barcode_id,
            item_name: insertData.name,
            item_quantity: String(insertData.available_quantity),
            process: 'Add Item',
            reference: insertData.barcode_id,
            date: now,
            action: 'Add',
            opening_balance: String(insertData.available_quantity),
            closing_balance: String(insertData.available_quantity),
            count: String(count),
            changed_by_userid: loggedUserId,
            changed_by: loggedUserName,
          });

          console.log('[ITEM CREATE] Stock log created successfully');
        } else {
          console.log(
            '[ITEM CREATE DEBUG] Skipping stock log because track_inventory flag is not enabled as expected.'
          );
        }

        try {
          require('../sync/nudge').nudgeSyncAgent();
        } catch (e) {
          /* latency hint only */
        }
        return {
          status: true,
          data: { id: result.insertedId.toString(), ...updateData },
          message: SUCCESS_MESSAGES.ITEM_CREATED,
        };
      }

      // Update existing item
      const itemObjectId = new ObjectId(id);

      // Get existing item for stock log calculation (mirrors PHP line 260-268)
      const existingItem = await collection.findOne({
        _id: itemObjectId,
        license: licenseObjectId,
      });

      await collection.updateOne(
        { _id: itemObjectId, license: licenseObjectId },
        { $set: updateData }
      );

      // Record any tracked change against the item's history. Best effort.
      await this.logItemChanges(
        { _id: itemObjectId, name: updateData.name, branch_id: branchObjectId },
        existingItem || {},
        updateData,
        context,
        'Edit'
      ).catch(() => {});

      // Get branch to check stock_management setting (PHP line 268)
      const branchesCollection = await this.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({
        _id: branchObjectId,
      });

      const stockLogStatus = branchDoc?.stock_management_log !== false;

      console.log('[ITEM UPDATE DEBUG] Stock log context:', {
        stockLogStatus: stockLogStatus,
        track_inventory: existingItem?.track_inventory,
      });

      // Create stock log for EDIT Item (mirrors PHP item_model.php: always log
      // when track_inventory is true; do not gate on branch stock_management).
      if (existingItem && existingItem.track_inventory === true) {
        const stockLogsRepository = new StockLogsRepository();
        const openingBalance = existingItem.available_quantity || 0;
        const newBalance = updateData.available_quantity || 0;
        // PHP line 265-266: $available_quantity = $old - $new; count = ($available_quantity < 0) ? abs($available_quantity) : ('-') . $available_quantity
        const diff = openingBalance - newBalance;
        const count = diff < 0 ? String(Math.abs(diff)) : '-' + String(diff);

        console.log('[ITEM UPDATE DEBUG] Creating stock log for item:', id);

        await stockLogsRepository.createStockLog({
          stocklog: stockLogStatus,
          branch_id: branchObjectId,
          view_item_id: itemObjectId,
          item_barcode_id: updateData.barcode_id,
          item_name: updateData.name,
          item_quantity: String(updateData.available_quantity),
          process: 'Edit Item',
          reference: updateData.barcode_id,
          date: now,
          action: 'Add',
          opening_balance: String(openingBalance),
          closing_balance: String(newBalance),
          count: count,
          changed_by_userid: loggedUserId,
          changed_by: loggedUserName,
        });

        console.log('[ITEM UPDATE] Stock log created successfully');
      } else {
        console.log(
          '[ITEM UPDATE DEBUG] Skipping stock log because track_inventory flag is not enabled as expected.'
        );
      }

      // Update item name in stock logs if name changed (mirrors PHP line 275)
      if (existingItem && existingItem.name !== updateData.name) {
        const stockLogsRepository = new StockLogsRepository();
        await stockLogsRepository.updateItemNameInStockLogs(id, updateData.name);
      }

      try {
        require('../sync/nudge').nudgeSyncAgent();
      } catch (e) {
        /* latency hint only */
      }
      return {
        status: true,
        data: { id, ...updateData },
        message: SUCCESS_MESSAGES.ITEM_UPDATED,
      };
    } catch (error) {
      console.error('Error in ItemRepository.upsertItem:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Delete multiple items by IDs (delegates to legacy deleteItemCollectionData)
   *
   * @param {string[]} ids - Array of item IDs
   * @param {Object} context
   * @param {string|ObjectId} [context.licenseId]
   * @param {string|ObjectId} [context.branchId]
   * @param {string|ObjectId} [context.loggedUserId]
   * @param {string} [context.loggedUserName]
   */
  async deleteItems(ids, context = {}) {
    try {
      if (!Array.isArray(ids) || ids.length === 0) {
        return { status: false, data: null, message: 'No IDs provided' };
      }

      const collection = await this.getCollection(this.collectionName);

      const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

      const filter = { _id: { $in: objectIds } };

      const licenseId = context.licenseId || null;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      const branchId = context.branchId || null;
      const branchObjectId =
        branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;

      const loggedUserId = context.loggedUserId || null;
      const loggedUserName = context.loggedUserName || 'System';

      // Get branch to check stock_management setting (PHP line 852)
      const branchesCollection = await this.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({
        _id: branchObjectId,
      });

      const stockLogStatus = branchDoc?.stock_management_log !== false;

      console.log('[ITEM DELETE DEBUG] Stock log context:', {
        stockLogStatus: stockLogStatus,
      });

      // Backup items before deletion, mirroring legacy behaviour
      const items = await collection.find(filter).toArray();
      const stockLogsRepository = new StockLogsRepository();
      const now = new Date();

      for (const item of items) {
        await BaseModel.deletedDocumentBackup(this.collectionName, item);

        // Create stock log for DELETE Item (mirrors PHP item_model.php: always
        // log when track_inventory is true; do not gate on branch
        // stock_management).
        if (item.track_inventory === true) {
          console.log('[ITEM DELETE DEBUG] Creating stock log for item:', item._id.toString());

          await stockLogsRepository.createStockLog({
            stocklog: stockLogStatus,
            branch_id: branchObjectId,
            view_item_id: item._id,
            item_barcode_id: item.barcode_id || '',
            item_name: item.name || '',
            item_quantity: '0',
            process: 'Delete Item',
            reference: item.barcode_id || '',
            date: now,
            action: 'Subtract',
            opening_balance: String(item.available_quantity || 0),
            closing_balance: '0',
            count: '-' + String(item.available_quantity || 0),
            changed_by_userid: loggedUserId,
            changed_by: loggedUserName,
          });

          console.log('[ITEM DELETE] Stock log created successfully');
        } else {
          console.log(
            '[ITEM DELETE DEBUG] Skipping stock log because track_inventory flag is not enabled as expected.'
          );
        }
      }

      /* A tombstone, not a removal: the flag rides sync to every device,
         which a vanished row never can. updated_date is what makes the
         scanner carry it. */
      const deletedAt = new Date();
      const result = await collection.updateMany(filter, {
        $set: { del_status: 1, deleted_date: deletedAt, updated_date: deletedAt },
      });
      return { status: true, data: result.modifiedCount, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.deleteItems:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getItemsByCategory(categoryId) {
    const collection = await this.getCollection(this.collectionName);
    const categoryObjectId = this.toObjectId(categoryId);

    const items = await collection.find({ category_id: categoryObjectId }).toArray();

    return items.map((doc) => BaseModel.simplifyFields(doc));
  }

  /**
   * Items matching what somebody typed: part of a name, or a barcode.
   *
   * `context` is optional and additive, so the existing one-argument form keeps
   * working. Both of the things it adds matter once a real till uses this:
   *
   *   scope   without a branch and licence filter a cashier at one outlet is
   *           shown every outlet's stock. One shop here has 250 items across 8
   *           branches with 126 in the admin branch and none in six of the
   *           sale centres, so unscoped results are not a rounding error -
   *           they are mostly items that cashier cannot sell.
   *
   *   limit   an unbounded regex is a full catalogue in one response. A query
   *           of "a" against the largest shop here returns 4,732 items, built
   *           into an array and serialised, for a search box that shows ten.
   *
   * @param {string} query
   * @param {object} [context]
   * @param {string|ObjectId} [context.branchId]
   * @param {string|ObjectId} [context.licenseId]
   * @param {number} [context.limit]
   */
  async searchItems(query, context = {}) {
    const collection = await this.getCollection(this.collectionName);

    const clauses = [
      {
        $or: [
          { name: { $regex: searchPattern(query), $options: 'i' } },
          { barcode_id: query },
          { barcodes: query },
        ],
      },
    ];

    const { branchId, licenseId } = context;
    if (branchId) {
      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      clauses.push({
        $or: [{ 'branch_access.branch_id': branchObjectId }, { branch_id: branchObjectId }],
      });
    }
    if (licenseId) {
      clauses.push({ license: ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId });
    }

    const searchQuery = clauses.length === 1 ? clauses[0] : { $and: clauses };

    let cursor = collection.find(searchQuery);
    const limit = parseInt(context.limit, 10);
    if (Number.isFinite(limit) && limit > 0) cursor = cursor.limit(Math.min(limit, 100));

    const items = await cursor.toArray();
    return items.map((doc) => BaseModel.simplifyFields(doc));
  }
  async getItemTableRow(id, context = {}) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.ITEM_NOT_FOUND,
        };
      }

      const collection = await this.getCollection(this.collectionName);

      const filter = { _id: new ObjectId(id) };

      const licenseId = context.licenseId || null;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      const branchId = context.branchId || null;
      if (branchId && ObjectId.isValid(String(branchId))) {
        const branchObjectId = new ObjectId(String(branchId));
        filter.$or = [{ 'branch_access.branch_id': branchObjectId }, { branch_id: branchObjectId }];
      }

      const item = await collection.findOne(filter);
      if (!item) {
        return {
          status: false,
          data: null,
          message: ERROR_MESSAGES.ITEM_NOT_FOUND,
        };
      }

      // Ensure branch_access entries carry branch_name like legacy PHP
      if (Array.isArray(item.branch_access) && item.branch_access.length > 0) {
        try {
          const branchesNeedingName = [];
          const branchIdStrings = [];

          item.branch_access.forEach((entry) => {
            if (!entry || !entry.branch_id) return;
            const hasName =
              typeof entry.branch_name === 'string' && entry.branch_name.trim() !== '';
            if (hasName) return;

            let idString;
            if (entry.branch_id instanceof ObjectId) {
              idString = entry.branch_id.toHexString();
            } else {
              idString = String(entry.branch_id);
            }

            if (ObjectId.isValid(idString)) {
              branchesNeedingName.push(entry);
              branchIdStrings.push(idString);
            }
          });

          if (branchIdStrings.length > 0) {
            const branchCollection = await this.getCollection('branches');
            const cursor = await branchCollection
              .find({ _id: { $in: branchIdStrings.map((b) => new ObjectId(b)) } })
              .toArray();

            const nameMap = new Map();
            cursor.forEach((b) => {
              if (b && b._id) {
                nameMap.set(b._id.toString(), b.branch_name || '');
              }
            });

            branchesNeedingName.forEach((entry) => {
              let idString;
              if (entry.branch_id instanceof ObjectId) {
                idString = entry.branch_id.toHexString();
              } else {
                idString = String(entry.branch_id);
              }
              const name = nameMap.get(idString);
              if (name) {
                entry.branch_name = name;
              }
            });
          }
        } catch (e) {
          // Non-fatal: log and continue with whatever data we have
          console.error('Error enriching item.branch_access with branch_name:', e.message || e);
        }
      }

      // Default flags/fields expected by legacy frontend views
      item.negative_stock = item.negative_stock || false;

      // --- HSN / Tax normalisation for legacy parity ---
      const rawNumericHsn =
        item.hsncode !== undefined && item.hsncode !== null ? Number(item.hsncode) : 0;
      const numericHsn = Number.isFinite(rawNumericHsn) ? rawNumericHsn : 0;

      const resolvedTaxMethod = numericHsn > 0 ? 'hsn' : 'default';
      item.tax_method = resolvedTaxMethod;

      if (item.tax_method === 'hsn') {
        if (item.hsncode === undefined || item.hsncode === null) {
          item.hsncode = '';
        }
        if (item.hsndescription === undefined || item.hsndescription === null) {
          item.hsndescription = '';
        }
        if (!item.tax_name || String(item.tax_name).trim() === '') {
          item.tax_name = item.hsncode || '';
        }
      } else if (item.tax_method === 'default') {
        if (item.hsncode === undefined || item.hsncode === null || item.hsncode === '') {
          item.hsncode = 0;
        }
      }

      if (item.items_mfg_date === undefined || item.items_mfg_date === null) {
        item.items_mfg_date = '';
      }
      if (item.items_expiry_date === undefined || item.items_expiry_date === null) {
        item.items_expiry_date = '';
      }

      const simplified = BaseModel.simplifyFields(item);
      if (simplified && typeof simplified === 'object') {
        delete simplified.tax_fields;

        // Match legacy PHP: branch_access[*].branch_id should be an object with "$oid" key
        if (Array.isArray(simplified.branch_access)) {
          simplified.branch_access = simplified.branch_access.map((entry) => {
            if (!entry) return entry;

            const cloned = { ...entry };

            // Existing data may already be { $oid: ... } or a plain string/ObjectId string
            let rawId = null;
            if (cloned.branch_id && typeof cloned.branch_id === 'object' && cloned.branch_id.$oid) {
              rawId = cloned.branch_id.$oid;
            } else if (cloned.branch_id) {
              rawId = String(cloned.branch_id);
            }

            if (rawId) {
              cloned.branch_id = { $oid: String(rawId) };
            }

            return cloned;
          });
        }
      }

      return {
        status: true,
        data: simplified,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.getItemTableRow:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getLowStockItems(params = {}, context = {}) {
    try {
      const {
        branchId = null,
        notificationRange = null,
        page = 1,
        limit = 10,
        filters = {},
      } = params || {};

      const collection = await this.getCollection(this.collectionName);

      const parsedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 10;
      const parsedPage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
      const skip = (parsedPage - 1) * parsedLimit;

      const conditions = [];

      const parsedNotification =
        notificationRange !== undefined && notificationRange !== null
          ? parseInt(notificationRange, 10)
          : null;

      if (!Number.isNaN(parsedNotification)) {
        conditions.push({ available_quantity: { $lte: parsedNotification } });
      }

      conditions.push({ item_status: { $ne: 'instant' } });

      const resolvedBranch =
        branchId || filters.branch_id || filters.branchId || context.branchId || null;

      // Only filter by branch if branch context is available
      if (resolvedBranch && ObjectId.isValid(String(resolvedBranch))) {
        const branchObjectId = new ObjectId(String(resolvedBranch));
        conditions.push({
          $or: [{ 'branch_access.branch_id': branchObjectId }, { branch_id: branchObjectId }],
        });
      }

      const resolvedLicense = context.licenseId || filters.license_id || null;
      // Only filter by license if license context is available
      if (resolvedLicense && ObjectId.isValid(String(resolvedLicense))) {
        conditions.push({ license: new ObjectId(String(resolvedLicense)) });
      }

      const isString = (v) => typeof v === 'string' && v.trim().length > 0;
      const searchTerm =
        (isString(filters.search) && filters.search) ||
        (isString(filters.query) && filters.query) ||
        null;

      if (searchTerm) {
        const regex = new RegExp(String(searchTerm), 'i');
        conditions.push({
          $or: [{ name: regex }, { itemid: regex }, { barcode_id: regex }, { sku: regex }],
        });
      }

      if (filters && typeof filters === 'object') {
        const excludedKeys = new Set([
          'search',
          'query',
          'branch_id',
          'branchId',
          'license',
          'license_id',
        ]);

        Object.entries(filters).forEach(([key, value]) => {
          if (excludedKeys.has(key)) return;
          if (value === undefined || value === null) return;

          // Handle date fields with $gte/$lte operators
          if (key === 'updated_date' || key === 'created_date') {
            if (typeof value === 'object' && value !== null) {
              const dateCondition = {};
              if (value.$gte) {
                const gteDate = new Date(value.$gte.trim());
                if (!isNaN(gteDate.getTime())) {
                  dateCondition.$gte = gteDate;
                }
              }
              if (value.$lte) {
                const lteDate = new Date(value.$lte.trim());
                if (!isNaN(lteDate.getTime())) {
                  dateCondition.$lte = lteDate;
                }
              }
              if (Object.keys(dateCondition).length > 0) {
                conditions.push({ [key]: dateCondition });
              }
              return;
            }
          }

          conditions.push({ [key]: value });
        });
      }

      const match = conditions.length > 1 ? { $and: conditions } : conditions[0] || {};

      const [total, items] = await Promise.all([
        collection.countDocuments(match),
        collection
          .find(match)
          .sort({ available_quantity: 1, name: 1 })
          .skip(skip)
          .limit(parsedLimit)
          .toArray(),
      ]);

      const list = items.map((item) => {
        const simplified = BaseModel.simplifyFields(item);
        if (!simplified._id) {
          simplified._id = item._id?.toString?.() || simplified.id;
        }
        if (!simplified.image) {
          simplified.image = item.image || DEFAULTS.IMAGE;
        }
        return simplified;
      });

      return {
        status: true,
        data: {
          total,
          total_pages: parsedLimit ? Math.ceil(total / parsedLimit) : 0,
          current_page: parsedPage,
          per_page: parsedLimit,
          list,
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.getLowStockItems:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to fetch low stock items',
      };
    }
  }

  async getOnlineItemsAjaxList(params = {}, context = {}) {
    try {
      const { query = '', type = 'normal', limit = 5 } = params || {};

      const branchId = context.branchId;
      if (!branchId) {
        return { status: false, message: 'Branch context is required' };
      }

      const licenseId = context.licenseId || null;

      const collection = await this.getCollection(this.collectionName);
      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId || null;

      const regex =
        query && typeof query === 'string'
          ? new RegExp(query.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i')
          : null;

      let searchConditions = [];

      // PHP Line 1377-1387: Handle type='id' separately to fetch by ObjectId
      if (type === 'id' && query && ObjectId.isValid(query)) {
        searchConditions = [{ _id: new ObjectId(query) }];
      } else if (regex && type === 'barcode') {
        searchConditions = [{ barcode_id: regex }, { barcodes: regex }];
      } else if (regex) {
        searchConditions = [
          { name: regex },
          { itemid: regex },
          { barcode_id: regex },
          { barcodes: regex },
        ];
      }

      // Stock availability logic
      // Items are available if:
      // 1. track_inventory=false (always available), OR
      // 2. available_quantity > 0, OR
      // 3. negative_stock=true (can go below 0)
      const stockCondition = {
        $or: [
          { track_inventory: false },
          { available_quantity: { $gt: 0 } },
          { negative_stock: true },
        ],
      };

      const match = {
        $and: [
          searchConditions.length ? { $or: searchConditions } : null,
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: 'instant' } },
          stockCondition,
          // sales_channel filter removed: it was implemented as a misused
          // boolean, not the intended multi-channel (POS/kiosk/e-commerce)
          // selector, so it silently hid items from New Sale. To be
          // reintroduced as a proper channel model later.
          ...(licenseObjectId ? [{ license: licenseObjectId }] : []),
        ].filter(Boolean),
      };

      const data = await collection
        .aggregate([
          { $match: match },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              name: 1,
              selling_price: 1,
              mrp_price: 1,
              itemid: 1,
              available_quantity: 1,
              company_price: 1,
              discount_amount: 1,
              discount_percentage: 1,
              tax: 1,
              tax_type: 1,
              category_id: 1,
              category_name: 1,
              image: 1,
              supplier_id: 1,
              supplier_name: 1,
              track_inventory: 1,
              negative_stock: 1,
              barcode_id: 1,
              items_expiry_date: 1,
            },
          },
        ])
        .toArray();

      const suggestions = data.map((item) => ({
        item_id: item._id?.toString?.() || '',
        item_name: item.name || '',
        selling_price: item.selling_price || 0,
        mrp_price: item.mrp_price || 0,
        itemid: item.itemid || '',
        available_quantity: item.available_quantity || 0,
        company_price: item.company_price || 0,
        discount_amount: item.discount_amount || 0,
        discount_percentage: item.discount_percentage || 0,
        tax: item.tax || 0,
        tax_type: item.tax_type || '',
        category_id: item.category_id?.toString?.() || '',
        category_name: item.category_name || '',
        image: item.image || DEFAULTS.IMAGE,
        supplier_id: item.supplier_id?.toString?.() || '',
        supplier_name: item.supplier_name || '',
        track_inventory: item.track_inventory !== false,
        negative_stock: item.negative_stock === true,
        barcode_id: item.barcode_id || '',
        items_expiry_date: item.items_expiry_date != null ? String(item.items_expiry_date) : '',
      }));

      return {
        status: true,
        data: suggestions,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.getOnlineItemsAjaxList:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to load items',
      };
    }
  }

  async getOnlineSalesItems(params = {}, context = {}) {
    try {
      const { limit = 100 } = params || {};

      const branchId = context.branchId;
      if (!branchId) {
        return { status: false, message: 'Branch context is required' };
      }

      const licenseId = context.licenseId || null;

      const collection = await this.getCollection(this.collectionName);
      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId || null;

      const match = {
        $and: [
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: 'instant' } },
          { sales_channel: true },
          ...(licenseObjectId ? [{ license: licenseObjectId }] : []),
        ],
      };

      const items = await collection
        .find(match)
        .sort({ sort_order: 1, name: 1 })
        .limit(limit)
        .toArray();

      const list = items
        .filter((item) => {
          const negativeStock =
            typeof item.negative_stock === 'boolean' ? item.negative_stock : false;

          // PHP logic:
          // if track_inventory === false OR negative_stock === true
          // OR available_quantity > 0 then include in list
          const trackInventory = item.track_inventory !== true ? false : true;
          const availableQty = Number(item.available_quantity) || 0;

          return trackInventory === false || negativeStock === true || availableQty > 0;
        })
        .map((item) => ({
          id: item._id?.toString?.() || '',
          name: item.name || '',
          selling_price: item.selling_price || 0,
          itemid: item.itemid || '',
          available_quantity: String(item.available_quantity || 0),
          company_price: item.company_price || 0,
          discount_amount: item.discount_amount || 0,
          discount_percentage: item.discount_percentage || 0,
          tax: item.tax || 0,
          tax_type: item.tax_type || '',
          category_id: item.category_id?.toString?.() || '',
          category_name: item.category_name || '',
          image: item.image || DEFAULTS.IMAGE,
          supplier: item.supplier_name || '',
          // Match PHP: expose items_expiry_date for frontend expiry checks
          items_expiry_date: item.items_expiry_date != null ? String(item.items_expiry_date) : '',
          // Variant family link (V1): lets the sale grid collapse a family
          // into one tile with a picker. Empty strings for plain items.
          variant_group_id: item.variant_group_id ? String(item.variant_group_id) : '',
          variant_value: item.variant_value || '',
          variant_parent_name: item.variant_parent_name || '',
          track_inventory: item.track_inventory === true,
        }));

      return {
        status: true,
        data: list,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.getOnlineSalesItems:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to load items',
      };
    }
  }

  async createInstantItem(data = {}, context = {}) {
    try {
      const branchId = context.branchId;
      if (!branchId) {
        return { status: false, message: 'Branch context is required' };
      }

      const licenseId = context.licenseId || BaseModel.license;
      if (!licenseId) {
        return { status: false, message: 'License context is required' };
      }

      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      let branchDoc = null;
      try {
        branchDoc = await Branch.findById(branchObjectId).lean();
      } catch (error) {
        console.warn('Unable to load branch for instant item:', error.message);
      }

      const branchName =
        (branchDoc && branchDoc.branch_name) || context.branchName || 'Primary Branch';

      let supplierId = null;
      let supplierName = '';
      if (branchDoc && branchDoc.default_supplier) {
        const supplierCollection = await this.getCollection('suppliers');
        try {
          const supplierDoc = await supplierCollection.findOne({
            _id: new ObjectId(branchDoc.default_supplier),
            license: licenseObjectId,
          });
          if (supplierDoc) {
            supplierId = supplierDoc._id;
            supplierName = supplierDoc.name || '';
          }
        } catch (error) {
          console.warn('Unable to load default supplier for instant item:', error.message);
        }
      }

      const taxCollection = await this.getCollection('grouptax');
      let taxFields = [];
      if (data.items_tax_id && ObjectId.isValid(data.items_tax_id)) {
        const taxDoc = await taxCollection.findOne({
          _id: new ObjectId(data.items_tax_id),
          branch_id: branchObjectId,
          license: licenseObjectId,
        });
        if (taxDoc && taxDoc.tax_fields) {
          taxFields = taxDoc.tax_fields;
        }
      }

      const now = new Date();
      const sku = (data.items_sku || '').trim() || `INST-${Date.now()}`;
      const categoryId =
        data.items_category_id && ObjectId.isValid(data.items_category_id)
          ? new ObjectId(data.items_category_id)
          : null;

      const document = {
        license: licenseObjectId,
        branch_access: [
          {
            branch_id: branchObjectId,
            branch_name: branchName,
          },
        ],
        created_date: now,
        created_by: context.userName || 'System',
        created_by_id:
          (context.userId && ObjectId.isValid(context.userId)
            ? new ObjectId(context.userId)
            : context.userId) || null,
        updated_date: now,
        updated_by: context.userName || 'System',
        updated_by_id:
          (context.userId && ObjectId.isValid(context.userId)
            ? new ObjectId(context.userId)
            : context.userId) || null,
        name: (data.items_name || '').trim(),
        date: now,
        itemid: sku,
        barcode_id: sku,
        supplier_name: supplierName,
        ...(supplierId ? { supplier_id: supplierId } : {}),
        category_name: (data.items_category_name || '').trim(),
        ...(categoryId ? { category_id: categoryId } : {}),
        discount_amount: parseFloat(data.items_discount_amount) || 0,
        discount_percentage: parseFloat(data.items_discount_percentage) || 0,
        tax_name: (data.items_tax_name || '').trim(),
        ...(data.items_tax_id && ObjectId.isValid(data.items_tax_id)
          ? { tax_id: new ObjectId(data.items_tax_id) }
          : {}),
        tax: parseFloat(data.items_tax) || 0,
        tax_type: (data.items_tax_type || '').trim() || 'inclusive',
        tax_fields: taxFields,
        mrp_price: parseFloat(data.items_mrp_price) || 0,
        company_price: parseFloat(data.items_company_price) || 0,
        selling_price: parseFloat(data.items_selling_price) || 0,
        available_quantity: parseInt(data.items_quantity, 10) || 0,
        image: DEFAULTS.IMAGE,
        sort_order: 0,
        track_inventory: false,
        sales_channel: true,
        ecommerce: false,
        item_status: ITEM_STATUS.INSTANT,
      };

      const collection = await this.getCollection(this.collectionName);
      document.createdAt = now;
      document.updatedAt = now;
      const insertResult = await collection.insertOne(document);
      const inserted = { ...document, _id: insertResult.insertedId };
      const simplified = BaseModel.simplifyFields(inserted);

      return {
        status: true,
        data: simplified,
        message: SUCCESS_MESSAGES.ITEM_CREATED,
      };
    } catch (error) {
      console.error('Error in ItemRepository.createInstantItem:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to create instant item',
      };
    }
  }

  async deleteInstantItem(id, context = {}) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        return { status: false, message: 'Valid item id is required' };
      }

      const collection = await this.getCollection(this.collectionName);

      const filter = { _id: new ObjectId(id) };

      const branchId = context.branchId || null;
      if (branchId) {
        const branchObjectId = this.toObjectId(branchId);
        filter.$or = [{ branch_id: branchObjectId }, { 'branch_access.branch_id': branchObjectId }];
      }

      const licenseId = context.licenseId || null;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      const existing = await collection.findOne(filter);
      if (!existing) {
        return { status: false, message: ERROR_MESSAGES.ITEM_NOT_FOUND };
      }

      /* Tombstoned, not removed - see deleteItems above. */
      const now = new Date();
      const deleteResult = await collection.updateOne(filter, {
        $set: { del_status: 1, deleted_date: now, updated_date: now },
      });

      return {
        status: true,
        data: deleteResult.modifiedCount,
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.deleteInstantItem:', error);
      return {
        status: false,
        data: null,
        message: error.message || 'Failed to delete instant item',
      };
    }
  }

  async getReceivingItemsAjaxList(params = {}, context = {}) {
    try {
      const { type, query } = params || {};

      const branchId = context.branchId;
      const licenseId = context.licenseId;
      const limit = parseInt(context.limit, 10) || 10; // Default limit for autocomplete

      const collection = await this.getCollection(this.collectionName);

      if (!branchId) {
        console.error('getReceivingItemsAjaxList: branchId is not set');
        return { status: false, data: null, message: 'Branch ID not found' };
      }

      // Ensure branchId is converted to ObjectId for proper MongoDB comparison
      let branchObjectId;
      if (branchId instanceof ObjectId) {
        branchObjectId = branchId;
      } else if (typeof branchId === 'string' && ObjectId.isValid(branchId)) {
        branchObjectId = new ObjectId(branchId);
      } else if (branchId && branchId._bsontype === 'ObjectId') {
        branchObjectId = new ObjectId(branchId.toString());
      } else {
        branchObjectId = branchId;
      }

      let licenseObjectId;
      if (licenseId instanceof ObjectId) {
        licenseObjectId = licenseId;
      } else if (typeof licenseId === 'string' && ObjectId.isValid(licenseId)) {
        licenseObjectId = new ObjectId(licenseId);
      } else if (licenseId && licenseId._bsontype === 'ObjectId') {
        licenseObjectId = new ObjectId(licenseId.toString());
      } else {
        licenseObjectId = licenseId;
      }

      const regex = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

      const searchConditions =
        type === 'barcode'
          ? [{ barcode_id: regex }, { barcodes: regex }]
          : [{ name: regex }, { itemid: regex }, { barcode_id: regex }, { barcodes: regex }];

      // Build the filter matching PHP logic exactly
      const whereConditions = [
        { 'branch_access.branch_id': branchObjectId },
        { item_status: { $ne: ITEM_STATUS.INSTANT } },
      ];

      if (licenseObjectId) {
        whereConditions.push({ license: licenseObjectId });
      }

      const filter = {
        $and: [...(regex ? [{ $or: searchConditions }] : []), ...whereConditions],
      };

      const items = await collection.find(filter).limit(limit).toArray();

      const list = items.map((item) => ({
        item_id: item._id?.toString() || '',
        item_name: item.name || '',
        selling_price: item.selling_price || 0,
        item_code: item.itemid || '',
        item_unit: item.unit || 'qty',
        // Unit conversion (V3): the receiving screen's box->base assist.
        purchase_unit: item.purchase_unit || '',
        conversion_factor: Number(item.conversion_factor) || 0,
        company_price: item.company_price || 0,
        discount_amount: item.discount_amount || 0,
        discount_percentage: item.discount_percentage || 0,
        tax: item.tax || 0,
        tax_type: item.tax_type || '',
        category_id: item.category_id?.toString() || '',
        category_name: item.category_name || '',
        image: item.image || DEFAULTS.IMAGE,
        supplier_id: item.supplier_id?.toString() || '',
        supplier_name: item.supplier_name || '',
      }));

      return { status: true, data: list, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.getReceivingItemsAjaxList:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async accessKiosk(branchStoreId) {
    try {
      const branchCollection = await this.getCollection('branches');
      const branchDoc = await branchCollection.findOne({
        'kiosk.store_id': branchStoreId,
      });

      if (!branchDoc) {
        return { status: false, message: 'Branch not found', data: null };
      }

      const collection = await this.getCollection(this.collectionName);
      const filter = {
        $and: [
          { 'branch_access.branch_id': branchDoc._id },
          { item_status: { $ne: ITEM_STATUS.INSTANT } },
          { ecommerce: true },
          { isAvailable: true },
          { license: branchDoc.license },
        ],
      };

      const pipeline = [
        { $match: filter },
        {
          $group: {
            _id: { category_id: '$category_id', category_name: '$category_name' },
            items: {
              $push: {
                id: '$_id',
                name: '$name',
                price: '$selling_price',
                discount_percentage: '$discount_percentage',
                discount_amount: '$discount_amount',
                tax: '$tax',
                tax_type: '$tax_type',
                img: '$image',
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            category_id: '$_id.category_id',
            category_name: '$_id.category_name',
            items: {
              $map: {
                input: '$items',
                as: 'item',
                in: {
                  id: '$$item.id',
                  name: '$$item.name',
                  img: '$$item.img',
                  // Selling price after discount (rounded to 2 decimals)
                  price: {
                    $round: [
                      {
                        $cond: {
                          if: { $gt: ['$$item.discount_amount', 0] },
                          then: { $subtract: ['$$item.price', '$$item.discount_amount'] },
                          else: {
                            $cond: {
                              if: { $gt: ['$$item.discount_percentage', 0] },
                              then: {
                                $subtract: [
                                  '$$item.price',
                                  {
                                    $multiply: [
                                      '$$item.price',
                                      { $divide: ['$$item.discount_percentage', 100] },
                                    ],
                                  },
                                ],
                              },
                              else: '$$item.price',
                            },
                          },
                        },
                      },
                      2,
                    ],
                  },
                  // Discount amount
                  discount_price: {
                    $round: [
                      {
                        $cond: {
                          if: { $gt: ['$$item.discount_amount', 0] },
                          then: '$$item.discount_amount',
                          else: {
                            $multiply: [
                              '$$item.price',
                              { $divide: ['$$item.discount_percentage', 100] },
                            ],
                          },
                        },
                      },
                      2,
                    ],
                  },
                  // Tax price (calculated, not deducted)
                  tax_price: {
                    $round: [
                      {
                        $cond: {
                          if: { $eq: ['$$item.tax_type', 'inclusive'] },
                          then: {
                            $multiply: [
                              {
                                $subtract: [
                                  '$$item.price',
                                  {
                                    $cond: {
                                      if: { $gt: ['$$item.discount_amount', 0] },
                                      then: '$$item.discount_amount',
                                      else: {
                                        $multiply: [
                                          '$$item.price',
                                          { $divide: ['$$item.discount_percentage', 100] },
                                        ],
                                      },
                                    },
                                  },
                                ],
                              },
                              { $divide: ['$$item.tax', { $add: [100, '$$item.tax'] }] },
                            ],
                          },
                          else: {
                            $multiply: [
                              {
                                $subtract: [
                                  '$$item.price',
                                  {
                                    $cond: {
                                      if: { $gt: ['$$item.discount_amount', 0] },
                                      then: '$$item.discount_amount',
                                      else: {
                                        $multiply: [
                                          '$$item.price',
                                          { $divide: ['$$item.discount_percentage', 100] },
                                        ],
                                      },
                                    },
                                  },
                                ],
                              },
                              { $divide: ['$$item.tax', 100] },
                            ],
                          },
                        },
                      },
                      2,
                    ],
                  },
                  // Final price shown to customer
                  final_price: {
                    $round: [
                      {
                        $let: {
                          vars: {
                            base: {
                              $cond: {
                                if: { $gt: ['$$item.discount_amount', 0] },
                                then: { $subtract: ['$$item.price', '$$item.discount_amount'] },
                                else: {
                                  $cond: {
                                    if: { $gt: ['$$item.discount_percentage', 0] },
                                    then: {
                                      $subtract: [
                                        '$$item.price',
                                        {
                                          $multiply: [
                                            '$$item.price',
                                            { $divide: ['$$item.discount_percentage', 100] },
                                          ],
                                        },
                                      ],
                                    },
                                    else: '$$item.price',
                                  },
                                },
                              },
                            },
                          },
                          in: {
                            $cond: {
                              if: { $eq: ['$$item.tax_type', 'exclusive'] },
                              then: {
                                $add: [
                                  '$$base',
                                  { $multiply: ['$$base', { $divide: ['$$item.tax', 100] }] },
                                ],
                              },
                              else: '$$base',
                            },
                          },
                        },
                      },
                      2,
                    ],
                  },
                },
              },
            },
          },
        },
      ];

      const results = await collection.aggregate(pipeline).toArray();
      const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
      const normalizeQrItemPrice = (item) => {
        const sellingPrice = Number(item.price || 0);
        const tax = Number(item.tax || 0);
        const discountAmount = Number(item.discount_amount || 0);
        const discountPercentage = Number(item.discount_percentage || 0);
        const isInclusive = item.tax_type === 'inclusive';
        const basePrice = isInclusive && tax > 0 ? sellingPrice / (1 + tax / 100) : sellingPrice;
        const discountPrice =
          discountAmount > 0 ? discountAmount : basePrice * (discountPercentage / 100);
        const taxableBase = basePrice - discountPrice;
        const taxPrice = taxableBase * (tax / 100);
        const finalPrice = isInclusive ? taxableBase * (1 + tax / 100) : taxableBase + taxPrice;

        return {
          ...item,
          price: roundMoney(basePrice),
          discount_price: roundMoney(discountPrice),
          tax_price: roundMoney(taxPrice),
          final_price: roundMoney(finalPrice),
        };
      };
      results.forEach((category) => {
        category.items = Array.isArray(category.items)
          ? category.items.map(normalizeQrItemPrice)
          : [];
      });

      // Get kiosk settings
      let kioskImages = {};
      let kioskPayment = {};
      let kioskPrint = {};
      if (branchDoc.kiosk) {
        const kioskEntry = branchDoc.kiosk.find((k) => k.store_id === branchStoreId);
        if (kioskEntry) {
          kioskImages = {
            logo: kioskEntry.logo || '',
            banner: kioskEntry.banner || '',
            homebanner: kioskEntry.homebanner || '',
            advertisement: kioskEntry.advertisement || '',
          };
          kioskPayment = {
            cod: kioskEntry.payment_cod || '',
            razorpay: kioskEntry.payment_razorpay || '',
            number: kioskEntry.payment_number || '',
          };
          kioskPrint = { printer_name: kioskEntry.printer_name || '' };
        }
      }

      return {
        status: true,
        message: 'Get products details',
        data: {
          products: results,
          kiosk_images: kioskImages,
          kiosk_payment: kioskPayment,
          kiosk_print: kioskPrint,
        },
      };
    } catch (error) {
      console.error('Error in ItemRepository.accessKiosk:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async updateKioskStatus(id, status) {
    try {
      if (!id || !ObjectId.isValid(id)) {
        return { status: false, message: 'Valid item ID required', data: [] };
      }

      const collection = await this.getCollection(this.collectionName);

      const result = await collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { isAvailable: status, ecommerce: status } }
      );

      if (result.modifiedCount > 0) {
        return {
          status: true,
          message: 'Kiosk availability updated successfully',
          data: { item_id: id, status },
        };
      }

      return {
        status: false,
        message: 'No changes made or item not found',
        data: [],
      };
    } catch (error) {
      console.error('Error in ItemRepository.updateKioskStatus:', error);
      return { status: false, message: error.message, data: [] };
    }
  }

  async getItemsByCategoryId(categoryId, context = {}) {
    try {
      if (!categoryId) {
        return { status: false, data: null, message: 'Category ID required' };
      }

      const collection = await this.getCollection(this.collectionName);

      const branchId = context.branchId || null;
      const licenseId = context.licenseId || null;

      const branchObjectId =
        branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const categoryObjectId = this.toObjectId(categoryId);
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      const conditions = [
        { item_status: { $ne: ITEM_STATUS.INSTANT } },
        {
          $or: [{ available_quantity: { $gt: 0 } }, { negative_stock: true }],
        },
        // sales_channel filter removed for New Sale (see getOnlineItemsAjaxList).
        { category_id: categoryObjectId },
      ];

      if (branchObjectId) {
        conditions.unshift({ 'branch_access.branch_id': branchObjectId });
      }

      if (licenseObjectId) {
        conditions.push({ license: licenseObjectId });
      }

      const filter = { $and: conditions };

      const items = await collection.find(filter).toArray();
      const list = items
        .filter(
          (item) =>
            item.track_inventory === false ||
            item.negative_stock === true ||
            item.available_quantity > 0
        )
        .map((item) => ({
          item_id: item._id?.toString() || '',
          item_name: item.name || '',
          selling_price: item.selling_price || 0,
          itemid: item.itemid || '',
          available_quantity: String(item.available_quantity || 0),
          items_expiry_date: item.items_expiry_date ? String(item.items_expiry_date) : '',
          company_price: item.company_price || 0,
          discount_amount: item.discount_amount || 0,
          discount_percentage: item.discount_percentage || 0,
          category_id: item.category_id?.toString() || '',
          category_name: item.category_name || '',
          image: item.image || DEFAULTS.IMAGE,
          supplier: item.supplier_name || '',
          negative_stock: item.negative_stock || false,
        }));

      return { status: true, data: list, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.getItemsByCategoryId:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async itemSearchPage(params = {}, context = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);

      const branchId = context.branchId || null;
      const licenseId = context.licenseId || null;

      const branchObjectId =
        branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      const startingPrice = params.startingPrice;
      const endingPrice = params.endingPrice;
      const filterValue = params.filterValue;
      const options = params.options || {};

      const limit = parseInt(options.limit, 10) || 52;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const filter = {
        $and: [
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: 'instant' } },
          {
            selling_price: {
              $gte: parseInt(startingPrice, 10) || 0,
              $lte: parseInt(endingPrice, 10) || 999999,
            },
          },
          { license: licenseObjectId }, // Required like PHP (line 1901)
        ],
      };

      // Match PHP sort logic (item_model.php lines 1907-1912)
      let sort = { name: 1 };
      if (filterValue === 'new') {
        sort = { _id: -1 }; // Sort by ObjectId descending = newest first
      } else if (filterValue === 'low') {
        sort = { selling_price: 1 }; // TODO: Should use calculated price with tax/discount
      } else if (filterValue === 'high') {
        sort = { selling_price: -1 }; // TODO: Should use calculated price with tax/discount
      }

      const [total, items] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
      ]);

      const list = items.map((item) => ({
        _id: item._id?.toString() || '',
        item_name: item.name || '',
        discount_amount: item.discount_amount || 0,
        discount_percentage: item.discount_percentage || 0,
        selling_price: item.selling_price || 0,
        category_name: item.category_name || '',
        image: item.image || DEFAULTS.IMAGE,
        tax: item.tax || 0,
        tax_type: item.tax_type || '',
      }));

      return {
        status: true,
        total,
        current_page: page,
        total_pages: Math.ceil(total / limit),
        per_page: limit,
        list,
      };
    } catch (error) {
      console.error('Error in ItemRepository.itemSearchPage:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async accessQr(params = {}) {
    const projectType = params.projectType;
    const branch = params.branch;

    // Helper: find branch by kiosk.store_id first, then fallback to _id
    const findBranch = async () => {
      const branchCollection = await this.getCollection('branches');
      let doc = await branchCollection.findOne({ 'kiosk.store_id': branch });
      if (!doc && ObjectId.isValid(branch)) {
        doc = await branchCollection.findOne({ _id: new ObjectId(branch) });
      }
      if (!doc) {
        const total = await branchCollection.countDocuments({});
        const sample = await branchCollection
          .find({}, { projection: { _id: 1, branch_name: 1, 'kiosk.store_id': 1 } })
          .limit(5)
          .toArray();
      }
      return { branchCollection, doc };
    };

    if (projectType === 'stock') {
      try {
        const { doc: branchDoc } = await findBranch();

        if (!branchDoc) {
          return { status: false, message: 'Branch not found', data: null };
        }

        const collection = await this.getCollection(this.collectionName);
        const filter = {
          $and: [
            { 'branch_access.branch_id': branchDoc._id },
            { item_status: { $ne: ITEM_STATUS.INSTANT } },
            { license: branchDoc.license },
          ],
        };

        const pipeline = [
          { $match: filter },
          {
            $group: {
              _id: {
                category_id: '$category_id',
                category_name: '$category_name',
              },
              items: {
                $push: {
                  id: '$_id',
                  name: '$name',
                  price: '$selling_price',
                  discount_percentage: '$discount_percentage',
                  discount_amount: '$discount_amount',
                  tax: '$tax',
                  tax_type: '$tax_type',
                  img: '$image',
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              category_id: '$_id.category_id',
              category_name: '$_id.category_name',
              items: 1,
            },
          },
        ];

        const results = await collection.aggregate(pipeline).toArray();

        return {
          status: true,
          message: 'Get products details',
          data: { products: results },
        };
      } catch (error) {
        console.error('Error in ItemRepository.accessQr (stock):', error);
        return { status: false, message: error.message, data: null };
      }
    }
    // Non-stock project: lookup branch (with ObjectId fallback) then return items
    try {
      const { doc: branchDoc } = await findBranch();

      if (!branchDoc) {
        return { status: false, message: 'Branch not found', data: null };
      }

      const kioskEntry = Array.isArray(branchDoc.kiosk)
        ? branchDoc.kiosk.find((entry) => String(entry?.store_id || '') === String(branch))
        : branchDoc.kiosk && String(branchDoc.kiosk?.store_id || '') === String(branch)
          ? branchDoc.kiosk
          : null;
      const hasKiosk = !!kioskEntry;
      const collection = await this.getCollection(this.collectionName);

      const baseFilter = [
        { 'branch_access.branch_id': branchDoc._id },
        { item_status: { $ne: ITEM_STATUS.INSTANT } },
        { license: branchDoc.license },
      ];
      // Only require ecommerce/isAvailable when an actual kiosk is configured
      if (hasKiosk) {
        baseFilter.push({ ecommerce: true });
        baseFilter.push({ isAvailable: true });
      }

      const pipeline = [
        { $match: { $and: baseFilter } },
        {
          $group: {
            _id: { category_id: '$category_id', category_name: '$category_name' },
            items: {
              $push: {
                id: '$_id',
                name: '$name',
                img: '$image',
                available_quantity: '$available_quantity',
                negative_stock: '$negative_stock',
                description: '$description',
                price: '$selling_price',
                discount_percentage: '$discount_percentage',
                discount_amount: '$discount_amount',
                tax: '$tax',
                tax_type: '$tax_type',
                discount_price: {
                  $round: [
                    {
                      $cond: {
                        if: { $gt: ['$discount_amount', 0] },
                        then: '$discount_amount',
                        else: {
                          $multiply: [
                            '$selling_price',
                            { $divide: [{ $ifNull: ['$discount_percentage', 0] }, 100] },
                          ],
                        },
                      },
                    },
                    2,
                  ],
                },
                tax_price: {
                  $round: [
                    {
                      $cond: {
                        if: { $eq: ['$tax_type', 'inclusive'] },
                        then: 0,
                        else: {
                          $multiply: [
                            {
                              $subtract: [
                                '$selling_price',
                                {
                                  $cond: {
                                    if: { $gt: ['$discount_amount', 0] },
                                    then: '$discount_amount',
                                    else: {
                                      $multiply: [
                                        '$selling_price',
                                        {
                                          $divide: [{ $ifNull: ['$discount_percentage', 0] }, 100],
                                        },
                                      ],
                                    },
                                  },
                                },
                              ],
                            },
                            { $divide: [{ $ifNull: ['$tax', 0] }, 100] },
                          ],
                        },
                      },
                    },
                    2,
                  ],
                },
                final_price: {
                  $round: [
                    {
                      $let: {
                        vars: {
                          base: {
                            $cond: {
                              if: { $gt: ['$discount_amount', 0] },
                              then: { $subtract: ['$selling_price', '$discount_amount'] },
                              else: {
                                $cond: {
                                  if: { $gt: [{ $ifNull: ['$discount_percentage', 0] }, 0] },
                                  then: {
                                    $subtract: [
                                      '$selling_price',
                                      {
                                        $multiply: [
                                          '$selling_price',
                                          { $divide: ['$discount_percentage', 100] },
                                        ],
                                      },
                                    ],
                                  },
                                  else: '$selling_price',
                                },
                              },
                            },
                          },
                        },
                        in: {
                          $cond: {
                            if: { $eq: ['$tax_type', 'exclusive'] },
                            then: {
                              $add: [
                                '$$base',
                                {
                                  $multiply: [
                                    '$$base',
                                    { $divide: [{ $ifNull: ['$tax', 0] }, 100] },
                                  ],
                                },
                              ],
                            },
                            else: '$$base',
                          },
                        },
                      },
                    },
                    2,
                  ],
                },
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            category_id: '$_id.category_id',
            category_name: '$_id.category_name',
            items: 1,
          },
        },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      // Fetch configured tables for this branch/license
      let tableorders = [];
      try {
        const tableorderCollection = await this.getCollection('tableorder');
        const tableFilter = branchDoc.license
          ? { branch_id: branchDoc._id, license: branchDoc.license }
          : { branch_id: branchDoc._id };
        const tableList = await tableorderCollection
          .find(tableFilter)
          .sort({ tableorder_value: 1 })
          .toArray();
        tableorders = tableList.map((doc) => ({
          id: doc._id.toString(),
          tableorder_value: doc.tableorder_value,
          tableorder_fields: doc.tableorder_fields || [],
        }));
      } catch (e) {
        console.warn('[accessQr] Failed to fetch tableorders:', e.message);
      }

      return {
        status: true,
        message: 'Get products details',
        data: {
          products: results,
          kiosk_images: {
            logo: kioskEntry?.logo || '',
            banner: kioskEntry?.banner || '',
            homebanner: kioskEntry?.homebanner || '',
            advertisement: kioskEntry?.advertisement || '',
          },
          kiosk_payment: {
            cod: kioskEntry?.payment_cod || '',
            razorpay: kioskEntry?.payment_razorpay || '',
            number: kioskEntry?.payment_number || '',
          },
          kiosk_print: {
            printer_name: kioskEntry?.printer_name || '',
          },
          tableorders,
        },
      };
    } catch (error) {
      console.error('Error in ItemRepository.accessQr (non-stock):', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async accessMobileApp(branchId) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;

      const filter = {
        'branch_access.branch_id': branchObjectId,
        item_status: { $ne: ITEM_STATUS.INSTANT },
        sales_channel: true,
      };

      const items = await collection
        .find(filter)
        .sort({ sort_order: 1, name: 1 })
        .limit(100)
        .toArray();

      const list = items.map((item) => ({
        id: item._id?.toString() || '',
        name: item.name || '',
        selling_price: item.selling_price || 0,
        category_id: item.category_id?.toString() || '',
        category_name: item.category_name || '',
        image: item.image || DEFAULTS.IMAGE,
      }));

      return { status: true, message: 'Items retrieved', data: list };
    } catch (error) {
      console.error('Error in ItemRepository.accessMobileApp:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  async updateItemQuantity(id, value) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const objectId = ObjectId.isValid(id) ? new ObjectId(id) : id;

      await collection.updateOne(
        { _id: objectId },
        { $set: { available_quantity: parseFloat(value) } }
      );

      return { status: true, message: 'Quantity updated' };
    } catch (error) {
      console.error('Error in ItemRepository.updateItemQuantity:', error);
      throw error;
    }
  }

  async categoryProductDetails(data = {}, context = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const categoryId = data.category_id;
      const branchIds = Array.isArray(data.branchid) ? data.branchid : [data.branchid];

      const branchObjectIds = branchIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const categoryObjectId = ObjectId.isValid(categoryId) ? new ObjectId(categoryId) : categoryId;

      const options = context.options || {};
      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const filter = {
        'branch_access.branch_id': { $in: branchObjectIds },
        category_id: categoryObjectId,
      };

      const licenseId = context.licenseId || null;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      const [total, items, aggregation] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter).skip(skip).limit(limit).toArray(),
        collection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: {
                  category_id: '$category_id',
                  category_name: '$category_name',
                },
                selling_price: { $sum: '$selling_price' },
                item_count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
      ]);

      const totalData = aggregation[0] || {};
      return {
        status: true,
        data: {
          table: {
            data: {
              total,
              current_page: page,
              total_pages: Math.ceil(total / limit),
              per_page: limit,
              list: items.map((i) => {
                const simplified = BaseModel.simplifyFields(i);

                // Attach string_date for frontend Product history table.
                // Prefer updated_date, then created_date, then the generic
                // date field we set during item updates.
                const rawDate =
                  i.updated_date ||
                  i.created_date ||
                  i.date ||
                  simplified.updated_date ||
                  simplified.created_date ||
                  simplified.date ||
                  null;

                return {
                  ...simplified,
                  string_date: rawDate ? formatDate(rawDate) : '',
                };
              }),
            },
          },
          total: {
            total: Math.round((totalData.selling_price || 0) * 100) / 100,
            count: totalData.item_count || 0,
            name: totalData._id?.supplier_name || '',
          },
        },
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in ItemRepository.categoryProductDetails:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async supplierProductDetails(data = {}, context = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const supplierId = data.supplier_id;
      const branchIds = Array.isArray(data.branchid) ? data.branchid : [data.branchid];

      const branchObjectIds = branchIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      const supplierObjectId = ObjectId.isValid(supplierId) ? new ObjectId(supplierId) : supplierId;

      const options = context.options || {};
      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const filter = {
        'branch_access.branch_id': { $in: branchObjectIds },
        supplier_id: supplierObjectId,
      };

      const licenseId = context.licenseId || null;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      const [total, items, aggregation] = await Promise.all([
        collection.countDocuments(filter),
        collection.find(filter).skip(skip).limit(limit).toArray(),
        collection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: {
                  supplier_id: '$supplier_id',
                  supplier_name: '$supplier_name',
                },
                selling_price: { $sum: '$selling_price' },
                item_count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
      ]);

      const totalData = aggregation[0] || {};
      return {
        status: true,
        data: {
          table: {
            data: {
              total,
              current_page: page,
              total_pages: Math.ceil(total / limit),
              per_page: limit,
              list: items.map((i) => {
                const simplified = BaseModel.simplifyFields(i);

                // Attach string_date for Supplier Based Product -> Product history.
                // Prefer updated_date, then created_date, then the legacy date field.
                const rawDate =
                  i.updated_date ||
                  i.created_date ||
                  i.date ||
                  simplified.updated_date ||
                  simplified.created_date ||
                  simplified.date ||
                  null;

                return {
                  ...simplified,
                  string_date: rawDate ? formatDate(rawDate) : '',
                };
              }),
            },
          },
          total: {
            total: Math.round((totalData.selling_price || 0) * 100) / 100,
            count: totalData.item_count || 0,
            name: totalData._id?.supplier_name || '',
          },
        },
        message: 'get detail successfully',
      };
    } catch (error) {
      console.error('Error in ItemRepository.supplierProductDetails:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getCustomerSearchItems(query, context = {}) {
    try {
      const collection = await this.getCollection(this.collectionName);

      const branchId = context.branchId || null;
      const licenseId = context.licenseId || null;

      const rawLimit = context.limit;
      const limit =
        Number.isFinite(Number(rawLimit)) && Number(rawLimit) > 0 ? Number(rawLimit) : 5;

      const branchObjectId =
        branchId && ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId =
        licenseId && ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      const regex = query ? new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;

      const filter = {
        $and: [
          regex
            ? {
                $or: [{ name: regex }, { itemid: regex }, { barcode_id: regex }],
              }
            : {},
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: ITEM_STATUS.INSTANT } },
          ...(licenseObjectId ? [{ license: licenseObjectId }] : []),
        ].filter((f) => Object.keys(f).length > 0),
      };

      const items = await collection.find(filter).limit(5).toArray();

      const list = items.map((item) => ({
        item_id: item._id?.toString() || '',
        item_name: item.name || '',
        selling_price: item.selling_price || 0,
        itemid: item.itemid || '',
        available_quantity: String(item.available_quantity || 0),
        category_id: item.category_id?.toString() || '',
        category_name: item.category_name || '',
        image: item.image || DEFAULTS.IMAGE,
      }));

      return { status: true, data: list, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.getCustomerSearchItems:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async itemStockReportTable(data = {}, context = {}) {
    try {
      console.log('-----------------------------------------------------------------------------');

      // Apply session filtering if dates are provided
      if (data.starting_date || data.ending_date) {
        // Note: This is a stock report showing current inventory,
        // but applying session filter as requested
        const startDate = data.starting_date ? new Date(data.starting_date) : null;
        const endDate = data.ending_date ? new Date(data.ending_date) : null;

        // For stock reports, we could filter by items that were last updated/modified within the date range
        // but stock reports typically show current inventory regardless of date
      }

      const collection = await this.getCollection(this.collectionName);

      const branchIds = Array.isArray(data.branchid) ? data.branchid : [data.branchid];

      console.log('\ud83d\udd0d itemStockReportTable - Input branchIds:', branchIds);

      const branchObjectIds = branchIds
        .filter((id) => id && ObjectId.isValid(id))
        .map((id) => new ObjectId(id));

      console.log('\ud83d\udd0d itemStockReportTable - Converted ObjectIds:', branchObjectIds);

      const options = context.options || {};
      const limit = parseInt(options.limit, 10) || 5;
      const page = parseInt(options.page, 10) || 1;
      const skip = Math.max(0, (page - 1) * limit);

      const filter = {
        'branch_access.branch_id': { $in: branchObjectIds },
        track_inventory: true,
      };

      const licenseId = context.licenseId;
      if (licenseId) {
        filter.license = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;
      }

      // Apply session filter dates to the query
      if (data.starting_date || data.ending_date) {
        if (data.starting_date) {
          filter.createdAt = { $gte: new Date(data.starting_date) };
        }

        if (data.ending_date) {
          if (filter.createdAt) {
            filter.createdAt.$lte = new Date(data.ending_date);
          } else {
            filter.createdAt = { $lte: new Date(data.ending_date) };
          }
        }
      }

      console.log('\ud83d\udd0d itemStockReportTable - Filter:', JSON.stringify(filter, null, 2));

      const [total, items, allItemsForTotals] = await Promise.all([
        collection.countDocuments(filter),
        collection
          .find(filter, {
            projection: {
              name: 1,
              itemid: 1,
              available_quantity: 1,
              selling_price: 1,
              company_price: 1,
              category_name: 1,
            },
          })
          .sort({ available_quantity: 1 })
          .skip(skip)
          .limit(limit)
          .toArray(),
        // Fetch all items to calculate grand totals
        collection
          .find(filter, {
            projection: {
              available_quantity: 1,
              selling_price: 1,
              company_price: 1,
            },
          })
          .toArray(),
      ]);

      // Calculate grand totals from ALL items
      let sellingTotal = 0;
      let companyTotal = 0;

      allItemsForTotals.forEach((item) => {
        const availableQty = item.available_quantity || 0;
        const sellingPrice = item.selling_price || 0;
        const companyPrice = item.company_price || 0;

        sellingTotal += Math.round(sellingPrice * availableQty * 100) / 100;
        companyTotal += Math.round(companyPrice * availableQty * 100) / 100;
      });

      const list = items.map((item) => {
        const availableQty = item.available_quantity || 0;
        const sellingPrice = item.selling_price || 0;
        const companyPrice = item.company_price || 0;

        const itemSellingTotal = Math.round(sellingPrice * availableQty * 100) / 100;
        const itemCompanyTotal = Math.round(companyPrice * availableQty * 100) / 100;

        const simplified = BaseModel.simplifyFields(item);

        return {
          _id: simplified._id || simplified.id,
          name: simplified.name || item.name,
          itemid: simplified.itemid || item.itemid,
          category_name: simplified.category_name || item.category_name,
          selling_price: Math.round(sellingPrice * 100) / 100,
          available_quantity: availableQty,
          company_price: Math.round(companyPrice * 100) / 100,
          company_total: itemCompanyTotal,
          selling_total: itemSellingTotal,
          id: simplified.id || simplified._id,
        };
      });

      return {
        status: true,
        total,
        current_page: page,
        total_pages: Math.ceil(total / limit),
        per_page: limit,
        list,
        selling_total: sellingTotal,
        company_total: companyTotal,
      };
    } catch (error) {
      console.error('Error in ItemRepository.itemStockReportTable:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getQuantityCount(match = {}) {
    const collection = await this.getCollection(this.collectionName);

    const [count, listDocs] = await Promise.all([
      collection.countDocuments(match),
      collection
        .find(match, {
          projection: {
            name: 1,
            created_date: 1,
            available_quantity: 1,
          },
        })
        .sort({ available_quantity: 1, name: 1 })
        .limit(5)
        .toArray(),
    ]);

    return { count, listDocs };
  }

  async categoryItemsReportTable({ countPipeline = [], paginatedPipeline = [] } = {}) {
    // Check if pipeline contains date filtering (session filter applied)
    const hasDateFilter = paginatedPipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.updated_date &&
        (stage.$match.updated_date.$gte || stage.$match.updated_date.$lte)
    );

    if (hasDateFilter) {
      const dateMatchStage = paginatedPipeline.find(
        (stage) => stage.$match && stage.$match.updated_date
      );
    }

    const collection = await this.getCollection(this.collectionName);

    const countResult = await collection.aggregate(countPipeline).toArray();
    const total = countResult.length;

    const results = await collection.aggregate(paginatedPipeline).toArray();

    return { total, results };
  }

  async supplierItemsReportTable({ pipeline = [], countPipeline = [] } = {}) {
    // Check if pipeline contains date filtering (session filter applied)
    const hasDateFilter = pipeline.some(
      (stage) =>
        stage.$match &&
        stage.$match.updated_date &&
        (stage.$match.updated_date.$gte || stage.$match.updated_date.$lte)
    );

    if (hasDateFilter) {
      const dateMatchStage = pipeline.find((stage) => stage.$match && stage.$match.updated_date);
    }

    const collection = await this.getCollection(this.collectionName);

    const results = await collection.aggregate(pipeline).toArray();
    const countResults = await collection.aggregate(countPipeline).toArray();
    const total = countResults.length;

    return { total, results };
  }

  async itemReportTable({ filter = {}, skip = 0, limit = 5 } = {}) {
    const collection = await this.getCollection(this.collectionName);

    const items = await collection.find(filter).sort({ name: 1 }).skip(skip).limit(limit).toArray();

    const total = await collection.countDocuments(filter);

    return { items, total };
  }

  async importItems(data, context = {}) {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        return { status: false, data: null, message: 'No items to import' };
      }

      const collection = await this.getCollection(this.collectionName);

      const branchId = context.branchId || null;
      const licenseId = context.licenseId || null;

      if (!branchId || !licenseId) {
        return {
          status: false,
          data: null,
          message: 'Branch and license context required',
        };
      }

      const branchObjectId = ObjectId.isValid(branchId) ? new ObjectId(branchId) : branchId;
      const licenseObjectId = ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId;

      // Respect plan limits similar to PHP parent::checkPlan(self::$collectionName, 'import')
      const maxImport = await this.checkPlan(this.collectionName, 'import', context.user || null);
      const limitCount =
        typeof maxImport === 'number' && maxImport > 0
          ? Math.min(maxImport, data.length)
          : data.length;

      const limitedRows = data.slice(0, limitCount);

      // Step 1: Filter unique records from CSV data based on 'name' and 'itemid'
      const uniqueCSVRecords = new Map();
      for (const raw of limitedRows) {
        const item = { ...(raw || {}) };
        item.name = item.name || '';
        item.itemid = item.itemid || '';
        item.barcode_id = item.barcode_id || '';
        const key = `${item.name}-${item.itemid}`;
        if (!uniqueCSVRecords.has(key)) {
          uniqueCSVRecords.set(key, item);
        }
      }

      // Step 2: Validate CSV data (mirror PHP rules)
      const validationErrors = [];
      const requiredFields = [
        'name',
        'supplier_name',
        'category_name',
        'discount_amount',
        'discount_percentage',
        'tax',
        'tax_type',
        'mrp_price',
        'company_price',
        'selling_price',
        'available_quantity',
        'unit',
        'sort_order',
      ];
      const numericFields = [
        'discount_amount',
        'discount_percentage',
        'tax',
        'mrp_price',
        'company_price',
        'selling_price',
        'available_quantity',
        'sort_order',
      ];

      const toNumberFromCsv = (raw) => {
        if (raw === undefined || raw === null) {
          return 0;
        }
        if (typeof raw === 'number') {
          return Number.isFinite(raw) ? raw : 0;
        }
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (!trimmed) {
            return 0;
          }
          const match = trimmed.match(/[+-]?\d+(?:\.\d+)?/);
          if (!match) {
            return 0;
          }
          const num = Number(match[0]);
          return Number.isFinite(num) ? num : 0;
        }
        const num = Number(raw);
        return Number.isFinite(num) ? num : 0;
      };

      for (const item of uniqueCSVRecords.values()) {
        const errorFields = [];

        for (const field of requiredFields) {
          const value = item[field];
          const isEmpty = value === undefined || value === null || String(value).trim() === '';
          if (isEmpty && value !== '0' && value !== 0) {
            errorFields.push(field);
          }

          if (numericFields.includes(field)) {
            const num = toNumberFromCsv(value);
            item[field] = num;
          }
        }

        if (errorFields.length > 0) {
          validationErrors.push({
            ...item,
            status: errorFields.join(', '),
          });
        }
      }

      if (validationErrors.length > 0) {
        return {
          status: false,
          type: 'error',
          data: validationErrors,
          message:
            'CSV validation failed: Missing required fields. Please ensure all items have name, category_name, selling_price, and available_quantity.',
        };
      }

      // Step 3: Check for existing items in DB (name + itemid + branch + license)
      const alreadyData = [];
      const documentsToInsert = [];
      /* A matched row is UPDATED, not skipped, so a re-import that changed only
         prices actually changes them. The matched document is remembered so the
         update below can touch just the columns the CSV carries and leave the
         image and everything else the CSV omits exactly as it was - which is
         what the export/re-import round trip used to destroy. */
      const existingByRow = new Map();

      for (const item of uniqueCSVRecords.values()) {
        const name = item.name || '';
        const itemId = item.itemid || '';

        const existing = await collection.findOne({
          $and: [
            { name },
            { itemid: itemId },
            {
              $or: [{ 'branch_access.branch_id': branchObjectId }, { branch_id: branchObjectId }],
            },
            { license: licenseObjectId },
          ],
        });

        if (existing) {
          alreadyData.push({ name, itemid: itemId });
          existingByRow.set(item, existing);
        }
        // Matched and new rows alike go through the resolution loop below;
        // matched ones update in place, new ones insert.
        documentsToInsert.push(item);
      }

      if (!documentsToInsert.length) {
        return {
          status: false,
          data: null,
          message: 'No rows to import',
        };
      }

      const now = new Date();
      const branchName = context.branchName || '';
      const userName = context.userName || 'System';
      const userId = context.userId || null;

      const supplierCollection = await this.getCollection('suppliers');
      const categoryCollection = await this.getCollection('categories');
      const taxCollection = await this.getCollection('grouptax');
      const unitCollection = await this.getCollection('unit');

      const insertedIds = [];
      const updatedIds = [];

      for (const items of documentsToInsert) {
        const availableQuantity = items.available_quantity ? Number(items.available_quantity) : 0;
        const barcodeId = (items.barcode_id || '').trim();
        const taxValue = items.tax ? Number(items.tax) : 0;
        const taxType = items.tax_type || 'exclusive';
        const mrpPrice = items.mrp_price ? Number(items.mrp_price) : 0;
        const companyPrice = items.company_price ? Number(items.company_price) : 0;
        const sellingPrice = items.selling_price ? Number(items.selling_price) : 0;

        // Supplier collection
        let supplierDocument = null;
        if (items.supplier_name && String(items.supplier_name).trim() !== '') {
          supplierDocument = await supplierCollection.findOne({
            name: items.supplier_name,
            license: licenseObjectId,
            branch_id: branchObjectId,
          });

          if (!supplierDocument) {
            const insertSupplierData = {
              name: String(items.supplier_name).trim(),
              email: '',
              phone: '',
              address: '',
              country: '',
              state: '',
              city: '',
              gst: '',
              gst_type: '',
              gst_number: '',
              branch_id: branchObjectId,
              branch_name: branchName,
              created_date: now,
              created_by: userName,
              created_by_id: userId,
              updated_date: now,
              updated_by: userName,
              updated_by_id: userId,
              license: licenseObjectId,
            };
            const insertSupplierResult = await supplierCollection.insertOne(insertSupplierData);
            supplierDocument = await supplierCollection.findOne({
              _id: insertSupplierResult.insertedId,
              license: licenseObjectId,
              branch_id: branchObjectId,
            });
          }
        }

        const supplierName =
          (supplierDocument && supplierDocument.name) || (items.supplier_name || '').trim();
        const supplierId = supplierDocument ? supplierDocument._id : null;

        // Category collection
        let categoryDocument = null;
        if (items.category_name && String(items.category_name).trim() !== '') {
          categoryDocument = await categoryCollection.findOne({
            name: items.category_name,
            license: licenseObjectId,
            branch_id: branchObjectId,
          });

          if (!categoryDocument) {
            const insertCategoryData = {
              name: String(items.category_name).trim(),
              discount_amount:
                items.discount_amount !== undefined && items.discount_amount !== null
                  ? String(items.discount_amount).trim()
                  : '0',
              discount_percentage: 0,
              description: '',
              image: 'category.svg',
              branch_id: branchObjectId,
              branch_name: branchName,
              created_date: now,
              created_by: userName,
              created_by_id: userId,
              updated_date: now,
              updated_by: userName,
              updated_by_id: userId,
              license: licenseObjectId,
            };
            const insertCategoryResult = await categoryCollection.insertOne(insertCategoryData);
            categoryDocument = await categoryCollection.findOne({
              _id: insertCategoryResult.insertedId,
              license: licenseObjectId,
              branch_id: branchObjectId,
            });
          }
        }

        const categoryName =
          (categoryDocument && categoryDocument.name) || (items.category_name || '').trim();
        const categoryId = categoryDocument ? categoryDocument._id : null;

        // Tax collection
        let taxDocuments = null;

        // Detect whether this import row is HSN-based. For HSN items we do
        // not create/attach tax groups – they use HSN codes instead.
        const rawImportHsn =
          items.hsncode !== undefined && items.hsncode !== null
            ? items.hsncode
            : items.hsn_code !== undefined && items.hsn_code !== null
              ? items.hsn_code
              : '';

        const hasHsnForTax =
          rawImportHsn !== undefined &&
          rawImportHsn !== null &&
          String(rawImportHsn).trim() !== '' &&
          String(rawImportHsn).trim() !== '0';

        // Primary tax_name source from CSV. For backward compatibility with
        // legacy exports where merchants sometimes wrote the tax label into
        // the HSN description column while leaving tax_name empty, we also
        // treat a non-empty HSN description as the tax_name **only when**
        // there is no HSN code on the row (i.e. non-HSN items).
        let csvTaxName = '';
        if (
          items.tax_name !== undefined &&
          items.tax_name !== null &&
          String(items.tax_name).trim() !== ''
        ) {
          csvTaxName = String(items.tax_name).trim();
        } else if (!hasHsnForTax) {
          let hsnDescFallback = '';
          if (
            items.hsndescription !== undefined &&
            items.hsndescription !== null &&
            String(items.hsndescription).trim() !== ''
          ) {
            hsnDescFallback = String(items.hsndescription).trim();
          } else if (
            items.hsn_description !== undefined &&
            items.hsn_description !== null &&
            String(items.hsn_description).trim() !== ''
          ) {
            hsnDescFallback = String(items.hsn_description).trim();
          }

          csvTaxName = hsnDescFallback;
        }

        const importTaxName = csvTaxName;

        if (items.tax !== undefined && items.tax !== null && String(items.tax).trim() !== '') {
          // Normalised numeric rate from CSV
          const taxRate = Number(items.tax);

          if (!hasHsnForTax && importTaxName) {
            // Non-HSN item with explicit tax_name from CSV – treat as a
            // tax group name (e.g. "mugrt8").

            // 1) Try existing tax group with this name
            taxDocuments = await taxCollection.findOne({
              branch_id: branchObjectId,
              name: importTaxName,
              tax_group: 'yes',
              license: licenseObjectId,
            });

            if (!taxDocuments) {
              // 2) Ensure a base single-rate tax (tax_group = "no") exists
              //    for this rate. This mirrors how PHP keeps individual
              //    rates and wraps them inside a group.
              let baseTaxDoc = await taxCollection.findOne({
                branch_id: branchObjectId,
                rate: taxRate,
                tax_group: 'no',
                license: licenseObjectId,
              });

              if (!baseTaxDoc) {
                const baseTaxData = {
                  branch_id: branchObjectId,
                  branch_name: branchName,
                  name: `Tax${taxRate}%`,
                  rate: taxRate,
                  tax_fields: [],
                  tax_group: 'no',
                  created_date: now,
                  created_by: userName,
                  created_by_id: userId,
                  updated_date: now,
                  updated_by: userName,
                  updated_by_id: userId,
                  license: licenseObjectId,
                };
                const insertBaseResult = await taxCollection.insertOne(baseTaxData);
                const baseId = insertBaseResult.insertedId;
                const baseTaxField = {
                  tax_id: baseId,
                  tax_name: baseTaxData.name,
                  tax_value: taxRate,
                };
                await taxCollection.updateOne(
                  {
                    _id: baseId,
                    branch_id: branchObjectId,
                    license: licenseObjectId,
                  },
                  { $push: { tax_fields: baseTaxField } }
                );
                baseTaxDoc = await taxCollection.findOne({
                  _id: baseId,
                  license: licenseObjectId,
                });
              }

              // 3) Create the tax group document that wraps the base tax
              const groupTaxFields = [
                {
                  tax_id: baseTaxDoc._id,
                  tax_name: baseTaxDoc.name,
                  tax_value: taxRate,
                },
              ];

              const groupData = {
                branch_id: branchObjectId,
                branch_name: branchName,
                name: importTaxName,
                rate: taxRate,
                tax_fields: groupTaxFields,
                tax_group: 'yes',
                created_date: now,
                created_by: userName,
                created_by_id: userId,
                updated_date: now,
                updated_by: userName,
                updated_by_id: userId,
                license: licenseObjectId,
              };

              const insertGroupResult = await taxCollection.insertOne(groupData);
              taxDocuments = await taxCollection.findOne({
                _id: insertGroupResult.insertedId,
                license: licenseObjectId,
              });
            }
          } else {
            // HSN-based item or no explicit tax_name: use simple rate-only
            // tax record (legacy import behaviour).
            taxDocuments = await taxCollection.findOne({
              branch_id: branchObjectId,
              rate: taxRate,
              license: licenseObjectId,
            });

            if (!taxDocuments) {
              const taxData = {
                branch_id: branchObjectId,
                branch_name: branchName,
                name: `Tax${taxRate}%`,
                rate: taxRate,
                tax_fields: [],
                tax_group: 'no',
                created_date: now,
                created_by: userName,
                created_by_id: userId,
                updated_date: now,
                updated_by: userName,
                updated_by_id: userId,
                license: licenseObjectId,
              };
              const insertTaxResult = await taxCollection.insertOne(taxData);
              const lastInsertedId = insertTaxResult.insertedId;
              const taxArrayData = {
                tax_id: lastInsertedId,
                tax_name: `Tax${taxRate}%`,
                tax_value: taxRate,
              };
              await taxCollection.updateOne(
                {
                  _id: lastInsertedId,
                  branch_id: branchObjectId,
                  license: licenseObjectId,
                },
                { $push: { tax_fields: taxArrayData } }
              );
              taxDocuments = await taxCollection.findOne({
                _id: lastInsertedId,
                license: licenseObjectId,
              });
            }
          }
        }

        const taxFields = (taxDocuments && taxDocuments.tax_fields) || [];
        const taxId = taxDocuments ? taxDocuments._id : null;
        const taxName = taxDocuments ? taxDocuments.name : '';

        // --- Optional HSN / Tax Name from CSV ---
        // HSN code/description and tax_name may be provided as optional
        // columns in the import sheet. Only persist them when real values
        // exist; otherwise keep them effectively empty so exports don't show
        // placeholder values like "0".

        // Prefer CSV column names hsncode / hsndescription, but also accept
        // hsn_code / hsn_description for forward compatibility.
        let rawHsnCode = '';
        if (items.hsncode !== undefined && items.hsncode !== null) {
          rawHsnCode = items.hsncode;
        } else if (items.hsn_code !== undefined && items.hsn_code !== null) {
          rawHsnCode = items.hsn_code;
        }

        const hasHsn =
          rawHsnCode !== undefined &&
          rawHsnCode !== null &&
          String(rawHsnCode).trim() !== '' &&
          String(rawHsnCode).trim() !== '0';

        const resolvedHsnCode = hasHsn ? String(rawHsnCode).trim() : '';

        let resolvedHsnDescription = '';
        if (hasHsn) {
          if (
            items.hsndescription !== undefined &&
            items.hsndescription !== null &&
            String(items.hsndescription).trim() !== ''
          ) {
            resolvedHsnDescription = String(items.hsndescription).trim();
          } else if (
            items.hsn_description !== undefined &&
            items.hsn_description !== null &&
            String(items.hsn_description).trim() !== ''
          ) {
            resolvedHsnDescription = String(items.hsn_description).trim();
          }
        }

        // Tax method: HSN-based when a non-zero HSN code is present,
        // otherwise default/group tax.
        const resolvedTaxMethod = hasHsn ? 'hsn' : 'default';

        // Tax name precedence:
        //  1) Explicit tax_name column from CSV
        //  2) HSN code when provided
        //  3) Group tax name from the tax master (existing behaviour)
        let resolvedTaxName = '';
        if (csvTaxName) {
          resolvedTaxName = csvTaxName;
        } else if (hasHsn && resolvedHsnCode) {
          resolvedTaxName = resolvedHsnCode;
        } else {
          resolvedTaxName = taxName;
        }

        // Unit collection
        let unitDocument = null;
        if (items.unit && String(items.unit).trim() !== '') {
          unitDocument = await unitCollection.findOne({
            value: items.unit,
            license: licenseObjectId,
            branch_id: branchObjectId,
          });

          if (!unitDocument) {
            const insertUnitData = {
              name: String(items.unit).trim(),
              value: String(items.unit).trim(),
              branch_id: branchObjectId,
              branch_name: branchName,
              created_date: now,
              created_by: userName,
              created_by_id: userId,
              updated_date: now,
              updated_by: userName,
              updated_by_id: userId,
              license: licenseObjectId,
            };
            const insertUnitResult = await unitCollection.insertOne(insertUnitData);
            unitDocument = await unitCollection.findOne({
              _id: insertUnitResult.insertedId,
              license: licenseObjectId,
              branch_id: branchObjectId,
            });
          }
        }

        const unitId = unitDocument ? unitDocument._id : '';
        const unitName = unitDocument ? unitDocument.value : items.unit || 'qty';

        const insertData = {
          branch_id: branchObjectId,
          license: licenseObjectId,
          branch_name: branchName,
          date: now,
          created_date: now,
          created_by: userName,
          created_by_id: userId,
        };

        const updateData = {
          branch_access: [
            {
              branch_id: branchObjectId,
              branch_name: branchName,
            },
          ],
          name: String(items.name || '').trim(),
          itemid: String(items.itemid || '').trim(),
          barcode_id: barcodeId,
          supplier_name: supplierName,
          ...(supplierId ? { supplier_id: supplierId } : {}),
          category_name: categoryName,
          ...(categoryId ? { category_id: categoryId } : {}),
          discount_amount:
            items.discount_amount !== undefined && items.discount_amount !== null
              ? Number(items.discount_amount)
              : 0,
          discount_percentage:
            items.discount_percentage !== undefined && items.discount_percentage !== null
              ? Number(items.discount_percentage)
              : 0,
          hsncode: resolvedHsnCode,
          hsndescription: resolvedHsnDescription,
          tax_method: resolvedTaxMethod,
          tax_name: resolvedTaxName,
          tax_id: taxId,
          tax: taxValue,
          tax_type: taxType,
          tax_fields: taxFields,
          mrp_price: mrpPrice,
          company_price: companyPrice,
          selling_price: sellingPrice,
          available_quantity: availableQuantity,
          image: DEFAULTS.IMAGE,
          multi_image: [],
          item_status: ITEM_STATUS.REGULAR,
          sort_order:
            items.sort_order !== undefined && items.sort_order !== ''
              ? Number(items.sort_order)
              : 999999,
          description: '',
          track_inventory: true,
          sales_channel: true,
          ecommerce: false,
          negative_stock: false,
          updated_date: now,
          updated_by: userName,
          updated_by_id: userId,
          license: licenseObjectId,
          unit_id: unitId,
          unit: unitName,
        };

        const matched = existingByRow.get(items);
        if (matched) {
          /* Update only the columns the CSV carries. Deliberately excluded:
             image/multi_image (the export has no image column, so a CSV can
             never carry one - overwriting them is exactly the bug), the
             created_* provenance, and the behaviour flags (track_inventory,
             item_status, sales_channel, ecommerce, negative_stock,
             description) which the CSV does not include and must not be reset
             to their insert-time defaults. */
          const setFields = {
            name: updateData.name,
            itemid: updateData.itemid,
            barcode_id: updateData.barcode_id,
            supplier_name: updateData.supplier_name,
            ...(updateData.supplier_id ? { supplier_id: updateData.supplier_id } : {}),
            category_name: updateData.category_name,
            ...(updateData.category_id ? { category_id: updateData.category_id } : {}),
            discount_amount: updateData.discount_amount,
            discount_percentage: updateData.discount_percentage,
            hsncode: updateData.hsncode,
            hsndescription: updateData.hsndescription,
            tax_method: updateData.tax_method,
            tax_name: updateData.tax_name,
            tax_id: updateData.tax_id,
            tax: updateData.tax,
            tax_type: updateData.tax_type,
            tax_fields: updateData.tax_fields,
            mrp_price: updateData.mrp_price,
            company_price: updateData.company_price,
            selling_price: updateData.selling_price,
            available_quantity: updateData.available_quantity,
            sort_order: updateData.sort_order,
            unit_id: updateData.unit_id,
            unit: updateData.unit,
            updated_date: now,
            updated_by: userName,
            updated_by_id: userId,
          };
          await collection.updateOne({ _id: matched._id }, { $set: setFields });
          updatedIds.push(matched._id);
          // A re-import that changed any tracked field is history like any other.
          await this.logItemChanges(
            { _id: matched._id, name: setFields.name, branch_id: branchObjectId },
            matched,
            setFields,
            { userName, userId },
            'Import'
          ).catch(() => {});
        } else {
          const itemDocument = { ...insertData, ...updateData };
          const insertOneResult = await collection.insertOne(itemDocument);
          insertedIds.push(insertOneResult.insertedId);
        }
      }

      if (insertedIds.length > 0 || updatedIds.length > 0) {
        const touched = await collection
          .find({ _id: { $in: [...insertedIds, ...updatedIds] }, license: licenseObjectId })
          .toArray();
        const parts = [];
        if (insertedIds.length) parts.push(`${insertedIds.length} added`);
        if (updatedIds.length) parts.push(`${updatedIds.length} updated`);
        return {
          status: true,
          data: touched.map((i) => BaseModel.simplifyFields(i)),
          message: `Import complete: ${parts.join(', ')}`,
        };
      }

      return {
        status: false,
        data: null,
        message: 'No rows to import',
      };
    } catch (error) {
      console.error('Error in ItemRepository.importItems:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /**
   * Build the Mongo filter for an export.
   *
   * `selection` is either the legacy array of selected row ids, or an options
   * object. When `{ all: true }` is passed we export every item the caller can
   * see - the same branch + licence scope the item list itself uses - honouring
   * an optional category and search so "select all N" matches exactly what the
   * filtered list showed, not just the 100 rows on the current page.
   */
  _buildExportFilter(selection, context = {}) {
    const licenseId = context.licenseId || null;
    const licenseClause = licenseId
      ? { license: ObjectId.isValid(licenseId) ? new ObjectId(licenseId) : licenseId }
      : null;

    const opts = Array.isArray(selection) ? { ids: selection } : selection || {};

    if (!opts.all) {
      const ids = Array.isArray(opts.ids) ? opts.ids : [];
      if (ids.length === 0) return null;
      const objectIds = ids.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
      const filter = { _id: { $in: objectIds } };
      if (licenseClause) Object.assign(filter, licenseClause);
      return filter;
    }

    // "Select all N" mirrors the item list exactly: the client sends the same
    // `filters` object the list uses, we run it through the same sanitiser and
    // force the same branch + licence scope, so the export is precisely the set
    // of rows the filtered list was showing - no more, no less.
    const clientFilters = this.assignFilterObjects(
      { ...(opts.filters || {}) },
      LegacyItemModel.fields
    );
    for (const key of [
      'branch_id',
      'branchId',
      'branch_name',
      'branch_access',
      'branch_access.branch_id',
      'license',
      'license_id',
      'licenseId',
    ]) {
      delete clientFilters[key];
    }

    // A category picked in the export dialog, when the list itself was not
    // already filtered by one.
    if (opts.categoryId && ObjectId.isValid(opts.categoryId) && !clientFilters.category_id) {
      clientFilters.category_id = new ObjectId(opts.categoryId);
    }

    const filter = { ...clientFilters };

    const branchId = context.branchId || null;
    if (branchId && ObjectId.isValid(branchId)) {
      filter['branch_access.branch_id'] = new ObjectId(branchId);
    }
    if (licenseClause) filter.license = licenseClause.license;

    return filter;
  }

  _normalizeExportRow(i) {
    const doc = BaseModel.simplifyFields(i);

    // Normalise HSN-related fields for export so that rows without a
    // real HSN code don't show placeholder values like 0.
    const rawHsn = doc.hsncode;
    const hsnStr = rawHsn === undefined || rawHsn === null ? '' : String(rawHsn).trim();

    if (!hsnStr || hsnStr === '0') {
      // No real HSN value: keep both cells empty.
      doc.hsncode = '';
      doc.hsndescription = '';
    } else {
      // Real HSN present: export the trimmed code, and ensure
      // description is at least an empty string.
      doc.hsncode = hsnStr;
      if (doc.hsndescription === undefined || doc.hsndescription === null) {
        doc.hsndescription = '';
      } else {
        doc.hsndescription = String(doc.hsndescription).trim();
      }

      // For HSN-based tax rows, we do not want to export any tax_name.
      // The business rule is: when HSN code is present, the CSV should
      // only carry HSN Code and HSN Description, and the Tax Name
      // column must be empty.
      doc.tax_name = '';
    }

    // Ensure tax_name is only exported when it has a real value,
    // but only for NON-HSN rows. For HSN rows, doc.tax_name has
    // already been forced to "" above.
    if (!hsnStr || hsnStr === '0') {
      let taxNameStr =
        doc.tax_name === undefined || doc.tax_name === null ? '' : String(doc.tax_name).trim();

      if (!taxNameStr || taxNameStr === '0') {
        taxNameStr = '';
      }

      doc.tax_name = taxNameStr;
    }

    return doc;
  }

  async exportItems(selection, context = {}) {
    try {
      const filter = this._buildExportFilter(selection, context);
      if (!filter) {
        return { status: false, data: null, message: 'No IDs provided' };
      }

      const collection = await this.getCollection(this.collectionName);

      const items = await collection
        .find(filter, {
          projection: {
            _id: 0,
            name: 1,
            itemid: 1,
            barcode_id: 1,
            category_name: 1,
            supplier_name: 1,
            discount_amount: 1,
            discount_percentage: 1,
            hsncode: 1,
            hsndescription: 1,
            tax_name: 1,
            tax: 1,
            tax_type: 1,
            mrp_price: 1,
            company_price: 1,
            selling_price: 1,
            available_quantity: 1,
            unit: 1,
            sort_order: 1,
          },
        })
        .sort({ _id: -1 })
        .toArray();

      return {
        status: true,
        data: items.map((i) => this._normalizeExportRow(i)),
        message: 'Item Data Exported',
      };
    } catch (error) {
      console.error('Error in ItemRepository.exportItems:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getDataChanges(module, from) {
    // Mirror ItemModel.getDataChanges: delegate to BaseModel.getAllDataChanges
    // for the items collection using the legacy field metadata.
    return BaseModel.getAllDataChanges(
      Item.LegacyItemModel.collectionName,
      module,
      from,
      BaseModel.getSelectFields(LegacyItemModel.fields, true)
    );
  }

  /**
   * Get category items report
   * PHP: item_model.php -> categoryItemsReportPage()
   */
  async getCategoryItemsReport(params) {
    try {
      const { branchIds, startingDate, endingDate, categoryId, page = 1, limit = 5 } = params;

      const itemsCollection = await this.getCollection(this.collectionName);

      // Parse dates using BaseModel helper methods
      const fromDate = BaseModel.startingDate(startingDate, BaseModel.currentTimeZone);
      const toDate = BaseModel.endingDate(endingDate, BaseModel.currentTimeZone);

      // Convert branch IDs to ObjectIds
      const branchObjectIds = branchIds.map((id) => new ObjectId(id));

      // Build filters
      const filters = {
        $and: [
          { 'branch_access.branch_id': { $in: branchObjectIds } },
          { updated_date: { $gte: fromDate, $lte: toDate } },
        ],
      };

      // Only filter by license if it's available
      if (BaseModel.license) {
        filters.$and[1].license = BaseModel.license;
      }

      // Add category filter if provided
      if (categoryId && categoryId !== '') {
        filters.category_id = new ObjectId(categoryId);
      }

      // Calculate skip for pagination
      const skip = Math.max(0, (page - 1) * limit);

      // Aggregate items by category
      const salesList = await itemsCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: { category_id: '$category_id', category_name: '$category_name' },
              selling_price: { $sum: '$selling_price' },
              item_count: { $sum: 1 },
            },
          },
          { $sort: { selling_price: -1 } },
          { $skip: skip },
          { $limit: limit },
        ])
        .toArray();

      // Count total documents with same filters
      const salesCountList = await itemsCollection
        .aggregate([
          { $match: filters },
          {
            $group: {
              _id: { category_id: '$category_id', category_name: '$category_name' },
              selling_price: { $sum: '$selling_price' },
              item_count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const total = salesCountList.length;

      // Format sales data
      const salesValues = salesList.map((doc) => ({
        category_id: doc._id.category_id?.toString() || '',
        category_name: doc._id.category_name || '',
        selling_price: doc.selling_price || 0,
        item_count: doc.item_count || 0,
      }));

      return {
        status: true,
        data: {
          total,
          current_page: page,
          total_pages: Math.ceil(total / limit),
          per_page: limit,
          list: salesValues,
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in ItemRepository.getCategoryItemsReport:', error);
      return {
        status: false,
        data: null,
        message: error.message,
      };
    }
  }

  /**
   * Update available stock quantity for a single item
   * Delegates to legacy updateStock on ItemModel to keep business
   * behaviour identical while routing access through the repository.
   *
   * @param {string|ObjectId} itemId
   * @param {number} quantityChange - Positive or negative delta
   */
  /**
   * @param {string|ObjectId} itemId
   * @param {number} quantityChange
   * @param {object} [options]
   * @param {string} [options.reason] why the stock moved - see sync/outbox REASONS
   */
  async updateStock(itemId, quantityChange, options = {}) {
    const collection = await this.getCollection(this.collectionName);
    const objectId = this.toObjectId(itemId);

    const result = await collection.updateOne(
      { _id: objectId },
      { $inc: { available_quantity: quantityChange } }
    );

    /*
     * Mark the row for priority sync, after the write and never before.
     *
     * Every stock-changing path in the product - sale, return, cancellation,
     * receiving, adjustment - reaches this method or deductStockIfAvailable
     * below, which is what makes two hooks enough to cover all of them.
     *
     * Awaited but never able to throw: the outbox swallows its own errors, so a
     * shop can still trade if it is unwritable. The periodic scan remains the
     * mechanism of record; this only makes the change arrive sooner.
     */
    await require('../sync/outbox').enqueueInventory(objectId, options.reason);

    return result;
  }

  /**
   * Atomically deduct stock only when the requested quantity is available.
   * This prevents two billing counters from both passing a stale read check.
   */
  async deductStockIfAvailable(itemId, quantity) {
    const collection = await this.getCollection(this.collectionName);
    const objectId = this.toObjectId(itemId);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return null;

    const result = await collection.findOneAndUpdate(
      {
        _id: objectId,
        available_quantity: { $gte: qty },
        track_inventory: { $in: [true, 'true'] },
        negative_stock: { $ne: true },
      },
      { $inc: { available_quantity: -qty } },
      { returnDocument: 'after' }
    );

    const deducted = result?.value || result || null;
    /* Only when stock actually moved. The filter above can match nothing -
       insufficient stock, or an item that does not track it - and marking a row
       that did not change would push an unchanged document for no reason. */
    if (deducted) {
      await require('../sync/outbox').enqueueInventory(objectId, 'sale_inventory');
    }
    return deducted;
  }

  /**
   * Update the primary quantity field for a single item.
   *
   * This is used by Node-native Sale flows that rely on the
   * Mongoose Sale.items[] structure and the SALE_STATUS flag,
   * mirroring the direct Item.findByIdAndUpdate($inc: { quantity })
   * call that previously lived inside the Sale post-save hook.
   *
   * @param {string|ObjectId} itemId
   * @param {number} quantityChange - Positive or negative delta
   */
  async updateQuantity(itemId, quantityChange) {
    const collection = await this.getCollection(this.collectionName);
    const objectId = this.toObjectId(itemId);

    const delta = typeof quantityChange === 'number' ? quantityChange : Number(quantityChange) || 0;

    return collection.updateOne({ _id: objectId }, { $inc: { quantity: delta } });
  }

  /**
   * Find a single item by its ID using the legacy BaseModel helpers so
   * license scoping remains consistent with other legacy calls.
   *
   * @param {string|ObjectId} id
   */
  async findItemById(id) {
    return this.findOne({ _id: this.toObjectId(id) });
  }
}

module.exports = ItemRepository;
