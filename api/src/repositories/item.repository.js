const { searchPattern } = require('../utils/safe-search');
// src/repositories/item.repository.js
const BaseModel = require('../models/base.model');
const demoData = require('../services/demo-data');
const Item = require('../models/item.model');
const Branch = require('../models/branch.model');
const moment = require('moment-timezone');
const onlineOrdering = require('../utils/online-ordering');
const partnerVenues = require('../utils/partner-venues');
const itemChannels = require('../utils/item-channels');
const salesChannels = require('../utils/sales-channels');
const currencyLabel = require('../utils/currency-label');
const orderingAssistant = require('../services/ordering-assistant.service');

/*
 * The diet mark, or nothing.
 *
 * Only the four words the menu knows how to draw. Anything else is stored as
 * empty rather than passed through: an unknown value renders as no mark at
 * all, and a dish that LOOKS unmarked because of a typo is worse than one that
 * is honestly unmarked - somebody with an allergy reads both the same way.
 */
const DIET_MARKS = ['veg', 'non_veg', 'egg', 'vegan'];
const dishIcons = require('../utils/dish-icons');
const voiceSettings = require('../utils/voice-settings');

const onlineOrderingDiet = (value) => {
  const v = String(value || '')
    .trim()
    .toLowerCase();
  return DIET_MARKS.includes(v) ? v : '';
};
const {
  DEFAULTS,
  ITEM_STATUS,
  SUCCESS_MESSAGES,
  ERROR_MESSAGES,
} = require('../constants/items.constants');

/* One definition of "not deleted", shared by every item query. It used to
   live inside a single method, which is how the purchase picker ended up
   without it. */
const NOT_DELETED = Object.freeze({ del_status: { $nin: [1, '1', true] } });
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
   * The collection and the authoritative filter for one branch's item list.
   *
   * Shared by the flat list and the grouped one. Two copies of this would be
   * two places to forget that client-supplied scope must be stripped - and the
   * failure mode of forgetting is not an error, it is a query that quietly
   * returns the wrong shop's items or none at all.
   *
   * @param {Object} params
   * @param {string|ObjectId} params.branchId - Branch context
   * @param {string|ObjectId} params.licenseId - License context
   * @param {Object} [params.filters] - Client-supplied business filters
   * @returns {Promise<{collection: Object, filter: Object}>}
   */
  async listScope({ branchId, licenseId, filters = {} } = {}) {
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

    /*
     * Demo products are hidden when the shop has switched Demo Data off.
     *
     * Resolved here, in the ONE place the item list builds its filter, so it
     * cannot be applied to some reads and forgotten on others - a catalogue
     * that hides sample items on the manage screen and shows them on the sale
     * grid is worse than not hiding them at all.
     *
     * Nothing is written and nothing is deleted, so switching it back on
     * restores everything instantly. See services/demo-data.js for why a
     * demo item that has been sold must never simply be removed.
     */
    const demoClause = await demoData.filter({ licenseId, branchId });

    const filter = {
      // branch_access is the canonical item-to-branch relation. branch_id and
      // branch_name are denormalized legacy fields and can be absent or stale
      // in production data after a branch rename.
      ...clientFilters,
      ...demoClause,
      'branch_access.branch_id': branchObjectId,
      license: licenseObjectId,
    };

    return { collection, filter };
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
    const { collection, filter } = await this.listScope({ branchId, licenseId, filters });

    const effectiveLimit = parseInt(limit, 10) || 5;
    const effectivePage = parseInt(page, 10) || 1;
    const skip = (effectivePage - 1) * effectiveLimit;

    /*
     * Margin is COMPUTED (selling vs cost), so it cannot ride a find().sort()
     * - the special { $margin: 1|-1 } marker switches to an aggregation that
     * derives it per item. Items missing a selling price sort LAST in either
     * direction: an uncomputable margin is not a low one, and surfacing it
     * first would read as "these are your worst items" when nothing is known.
     */
    const marginDir = sort && sort.$margin;
    let itemsPromise;
    if (marginDir === 1 || marginDir === -1) {
      itemsPromise = collection
        .aggregate([
          { $match: filter },
          {
            $addFields: {
              _margin: {
                $cond: [
                  { $gt: [{ $ifNull: ['$selling_price', 0] }, 0] },
                  {
                    $divide: [
                      {
                        $subtract: ['$selling_price', { $ifNull: ['$company_price', 0] }],
                      },
                      '$selling_price',
                    ],
                  },
                  marginDir === 1 ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER,
                ],
              },
            },
          },
          { $sort: { _margin: marginDir, _id: -1 } },
          { $skip: skip },
          { $limit: effectiveLimit },
          { $project: BaseModel.getSelectFields(LegacyItemModel.fields) },
        ])
        .toArray();
    } else {
      itemsPromise = collection
        .find(filter, {
          projection: BaseModel.getSelectFields(LegacyItemModel.fields),
        })
        .sort(sort)
        .skip(skip)
        .limit(effectiveLimit)
        .toArray();
    }

    const [total, items] = await Promise.all([collection.countDocuments(filter), itemsPromise]);

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
  /*
   * Remove the demo data for good, and refuse to remove anything real.
   *
   * The switch hides; this destroys. So the whole value of it is in what it
   * declines to touch:
   *
   *   SOLD. A demo item exists to be rung up - that is how somebody finds out
   *   whether the till suits them - and a sale line stores item_id. Delete the
   *   item and the sale becomes a purchase of a product that does not exist.
   *   The sale is real even though the product was not, so nothing can put
   *   that right afterwards.
   *
   *   RECEIVED. Same argument for a purchase or a stock receipt.
   *
   *   EDITED. Changing the price on a sample and putting it on the shelf is
   *   how a small shop starts its real catalogue. By the time they press this
   *   button that row is THEIRS, whatever tag it still carries.
   *
   * What survives is reported by name, not counted. "Removed 128, kept 6"
   * invites the question this function already knows the answer to, and a
   * silent partial delete is worse than no delete at all.
   *
   * Soft, not hard: del_status is what the Recycle Bin reads, so this is still
   * undoable by the shop that asked for it. A hard delete here would make
   * "permanent" mean permanent in a way nobody asked for.
   */
  async purgeDemoData({ branchId, licenseId, user } = {}) {
    const items = await this.getCollection(this.collectionName);
    const branch = this.toObjectId(branchId);
    const license = this.toObjectId(licenseId);

    /*
     * The sample sales and quotes go FIRST, and the order is the point.
     *
     * A demo sale references demo items. Remove the items while those sales
     * still exist and every one of them is protected as "sold" - so the demo
     * data would refuse to remove itself, held in place by its own samples.
     *
     * These are hard deletes, unlike the items. A sample sale is not a record
     * of anything that happened, so keeping it in the Recycle Bin would only
     * put invented money somewhere a shop can restore it from by accident.
     */
    let salesRemoved = 0;
    let quotesRemoved = 0;
    let purchasesRemoved = 0;
    let peopleRemoved = 0;
    try {
      /*
       * Tagged, or shaped like a sample.
       *
       * Sales, purchases and quotes only started carrying demo_pack in
       * August 2026. A shop seeded before that has samples no tag can find,
       * and they were the ones still sitting in the Purchase History after
       * the switch promised to remove them. The seeder's own numbering -
       * R-DEMO-000001 beside the shop's own R-000001 - finds them, and no
       * real document is ever numbered that way.
       *
       * Both id shapes are matched as well: a branch that reached a seeder
       * as a string wrote strings, and an ObjectId-only filter would delete
       * nothing while reporting success.
       */
      const demoScopeFor = (collection) => ({
        ...demoData.seededClause(collection),
        branch_id: { $in: [branch, String(branch)] },
        license: { $in: [license, String(license)] },
      });
      const salesCol = await this.getCollection('sales');
      salesRemoved = (await salesCol.deleteMany(demoScopeFor('sales'))).deletedCount || 0;
      const quotesCol = await this.getCollection('quotes');
      quotesRemoved = (await quotesCol.deleteMany(demoScopeFor('quotes'))).deletedCount || 0;
      /* The sample purchases leave with the sample sales, or a Purchase
         History full of DEMO rows survives the switch that promised to
         remove them. */
      const receivingsCol = await this.getCollection('receivings');
      purchasesRemoved =
        (await receivingsCol.deleteMany(demoScopeFor('receivings'))).deletedCount || 0;
      /* The sample people go with them. A demo customer left behind after the
         samples are cleared is a stranger in the shop's own list, and nothing
         on the row says where they came from. */
      const customersCol = await this.getCollection('customers');
      peopleRemoved += (await customersCol.deleteMany(demoScopeFor('customers'))).deletedCount || 0;
      const suppliersCol = await this.getCollection('suppliers');
      peopleRemoved += (await suppliersCol.deleteMany(demoScopeFor('suppliers'))).deletedCount || 0;
    } catch (e) {
      /* Leaving the products behind is the safe half. Reported rather than
         thrown, because a shop asking to clear samples should not be told the
         whole thing failed when most of it worked. */
      console.error('purgeDemoData: sample sales/quotes:', e.message);
    }

    const scope = { demo_pack: { $exists: true }, 'branch_access.branch_id': branch, license };
    const candidates = await items
      .find(scope, { projection: { _id: 1, name: 1, demo_seeded_at: 1, updated_date: 1 } })
      .toArray();

    if (!candidates.length) {
      return {
        status: true,
        removed: 0,
        salesRemoved,
        quotesRemoved,
        purchasesRemoved,
        kept: [],
        message:
          salesRemoved || quotesRemoved || purchasesRemoved
            ? `Removed ${salesRemoved} sample sale(s), ${quotesRemoved} sample quote(s) and ${purchasesRemoved} sample purchase(s).`
            : 'There is no demo data to remove.',
      };
    }

    /* Both shapes, because item_id is stored as a string in some collections
       and an ObjectId in others. Matching only one silently finds nothing,
       which here means deleting something that was sold. */
    const ids = candidates.map((c) => c._id);
    const idPairs = ids.flatMap((id) => [id, String(id)]);

    const used = new Set();
    const noteUsed = (rows, pick) => {
      for (const r of rows) {
        for (const v of pick(r)) if (v) used.add(String(v));
      }
    };

    try {
      const sales = await this.getCollection('sales');
      noteUsed(
        await sales
          .find({ 'items.item_id': { $in: idPairs } }, { projection: { 'items.item_id': 1 } })
          .toArray(),
        (r) => (r.items || []).map((i) => i.item_id)
      );
    } catch (e) {
      /* Unreadable history is not permission to delete. Treat every candidate
         as used rather than guess - the cost is that nothing is removed and
         somebody asks why, which is recoverable. */
      console.error('purgeDemoData: could not read sales:', e.message);
      return {
        status: false,
        removed: 0,
        kept: [],
        message: 'Could not check the sales history, so nothing was removed.',
      };
    }

    try {
      const receivings = await this.getCollection('receivings');
      noteUsed(
        await receivings
          .find({ 'items.item_id': { $in: idPairs } }, { projection: { 'items.item_id': 1 } })
          .toArray(),
        (r) => (r.items || []).map((i) => i.item_id)
      );
    } catch (e) {
      console.error('purgeDemoData: could not read receivings:', e.message);
      return {
        status: false,
        removed: 0,
        kept: [],
        message: 'Could not check the purchase history, so nothing was removed.',
      };
    }

    const kept = [];
    const removable = [];
    for (const c of candidates) {
      if (used.has(String(c._id))) {
        kept.push({ name: c.name, why: 'sold or received' });
        continue;
      }
      const seeded = c.demo_seeded_at ? new Date(c.demo_seeded_at).getTime() : 0;
      const touched = c.updated_date ? new Date(c.updated_date).getTime() : 0;
      /* A second of slack: the seed writes created_date and updated_date in
         the same pass, and clock resolution should not make every row look
         edited. */
      if (seeded && touched && touched > seeded + 1000) {
        kept.push({ name: c.name, why: 'you have edited it' });
        continue;
      }
      removable.push(c._id);
    }

    let removed = 0;
    if (removable.length) {
      const now = new Date();
      const r = await items.updateMany(
        { _id: { $in: removable }, license },
        {
          $set: {
            del_status: 1,
            deleted_date: now,
            updated_date: now,
            deleted_by: (user && (user.name || user.username)) || 'System',
          },
        }
      );
      removed = r.modifiedCount || 0;
    }

    /*
     * Categories go only when nothing is left in them. A demo category still
     * holding a product the shop kept is now their category, and emptying the
     * shelf label out from under a product is its own small disaster.
     */
    let categoriesRemoved = 0;
    try {
      const cats = await this.getCollection('categories');
      const demoCats = await cats
        .find(
          { demo_pack: { $exists: true }, branch_id: branch, license },
          { projection: { _id: 1 } }
        )
        .toArray();
      for (const cat of demoCats) {
        const remaining = await items.countDocuments({
          category_id: cat._id,
          'branch_access.branch_id': branch,
          license,
          /* LIVE products only. The purge itself soft-deletes the samples
             into the Recycle Bin, so counting binned rows meant every demo
             category was held in place by the very products this purge had
             just removed - "switch off demo data" left the categories
             standing, every time, and nothing said why. */
          del_status: { $nin: [1, '1', true] },
        });
        if (remaining === 0) {
          await cats.deleteOne({ _id: cat._id, license });
          categoriesRemoved++;
        }
      }
    } catch (e) {
      /* The products are gone either way; a leftover empty category is untidy,
         not harmful, and must not turn a successful removal into a failure. */
      console.error('purgeDemoData: category cleanup:', e.message);
    }

    /*
     * Units, by the category rule: a demo unit still measuring anything
     * alive - a sample the shop sold or edited (kept above), an item of
     * their own that adopted it - is now the shop's unit and stays. Only a
     * unit measuring nothing leaves. Seed and purge are a pair: the seed
     * writes these rows (install.service demo units), so the switch that
     * promises "removed" must know how to remove them.
     */
    let unitsRemoved = 0;
    try {
      const unitsCol = await this.getCollection('unit');
      const demoUnits = await unitsCol
        .find(
          { demo_pack: { $exists: true }, branch_id: branch, license },
          { projection: { _id: 1 } }
        )
        .toArray();
      for (const u of demoUnits) {
        const remaining = await items.countDocuments({
          /* unit_id is an ObjectId on rows the seed wrote and a string on
             rows some editors write; matching one shape silently keeps or
             orphans the other. */
          unit_id: { $in: [u._id, String(u._id)] },
          'branch_access.branch_id': branch,
          license,
          del_status: { $nin: [1, '1', true] },
        });
        if (remaining === 0) {
          await unitsCol.deleteOne({ _id: u._id, license });
          unitsRemoved++;
        }
      }
    } catch (e) {
      console.error('purgeDemoData: unit cleanup:', e.message);
    }

    return {
      status: true,
      removed,
      categoriesRemoved,
      unitsRemoved,
      salesRemoved,
      purchasesRemoved,
      quotesRemoved,
      peopleRemoved,
      kept,
      message: kept.length
        ? `Removed ${removed} sample product${removed === 1 ? '' : 's'}. Kept ${kept.length}: ` +
          kept
            .slice(0, 6)
            .map((k) => `${k.name} (${k.why})`)
            .join(', ') +
          (kept.length > 6 ? ` and ${kept.length - 6} more` : '') +
          '.'
        : `Removed ${removed} sample product${removed === 1 ? '' : 's'}.`,
    };
  }

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
        ecommerce: Boolean(data.ecommerce),
        /* Absent means shown. A menu whose default is "hidden" starts empty
           and stays empty until somebody ticks every dish, which is not a
           default anybody wants from a feature whose job is to list things. */
        show_on_menu: data.show_on_menu !== false && data.show_on_menu !== 'false',
        diet: onlineOrderingDiet(data.diet),
        /* One emoji, or nothing. Cleaned rather than trusted: it arrives
           from a form and is rendered into a menu card, and a field that
           accepts letters quietly becomes a second name. Empty is normal -
           dish-icons reads the NAME and suggests one. */
        icon: dishIcons.clean(data.icon),
        /* Ids into the shop's own serving periods. Empty means all day, which
           is most of a menu. */
        daypart_ids: Array.isArray(data.daypart_ids)
          ? data.daypart_ids.map((v) => String(v || '').trim()).filter(Boolean)
          : [],
        /*
         * The channels this item is NOT sold on.
         *
         * Normalised here rather than trusted, because it arrives from a form
         * and reaches a Mongo query: an id nobody recognises is dropped, so a
         * typo can never quietly take an item off sale everywhere. Sync
         * replaces whole documents, so this has to be written on every save or
         * it is deleted by the next one. See utils/item-channels.js.
         */
        channel_off: itemChannels.normalizeOff(data.channel_off),
        channel_hours: itemChannels.normalizeHours(data.channel_hours),
        /* The kitchen's standing instruction for this dish, never the
           customer's note - that rides on the order line. */
        prep_note: String(data.prep_note || '')
          .trim()
          .slice(0, 200),
        prep_minutes: Math.max(0, Math.min(480, Number(data.prep_minutes) || 0)),
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
       * Tile colour (Loyverse study L2): how a no-image item looks on the
       * sale grid. Presence-gated; only a hex colour or empty (= letter
       * tile) ever writes - garbage never does.
       */
      if (data.tile_color !== undefined) {
        const tileColor = String(data.tile_color || '').trim();
        updateData.tile_color = /^#[0-9a-fA-F]{6}$/.test(tileColor) ? tileColor : '';
      }

      // Quick code (owner ask): digits only, up to 6, or empty clears.
      if (data.plu_code !== undefined) {
        const plu = String(data.plu_code || '').trim();
        updateData.plu_code = /^\d{1,6}$/.test(plu) ? plu : '';
      }

      // The tile's shape rides the same rules: a known shape or empty.
      if (data.tile_shape !== undefined) {
        const tileShape = String(data.tile_shape || '').trim();
        updateData.tile_shape = [
          'square',
          'rounded',
          'circle',
          'diamond',
          'triangle',
          'pentagon',
          'hexagon',
          'star',
          'octagon',
        ].includes(tileShape)
          ? tileShape
          : '';
      }

      /*
       * Lightspeed study LS1 trio, all presence-gated: brand (a name, for
       * filtering and the future community catalog), tags (free keywords),
       * reorder_point (this item's own low-stock threshold - overrides the
       * shop-wide notification range where set; empty clears it).
       */
      if (data.brand !== undefined) {
        updateData.brand = String(data.brand || '')
          .trim()
          .slice(0, 100);
      }
      if (data.tags !== undefined) {
        updateData.tags = (Array.isArray(data.tags) ? data.tags : [])
          .map((t) => String(t || '').trim())
          .filter(Boolean)
          .slice(0, 20);
      }
      if (data.reorder_point !== undefined) {
        const rp = Number(data.reorder_point);
        updateData.reorder_point = Number.isFinite(rp) && rp >= 0 ? rp : null;
      }

      /*
       * Services (Square study Q3): a second sellable kind. A service holds
       * no stock - track_inventory is forced off at write time so no code
       * path ever counts it - and prices fixed, per hour or per day (the
       * quantity column carries the hours/days, the engine sees an ordinary
       * line). Presence-gated; absent = product, forever untouched.
       */
      if (data.item_kind !== undefined) {
        const kind = data.item_kind === 'service' ? 'service' : 'product';
        updateData.item_kind = kind;
        if (kind === 'service') {
          updateData.track_inventory = false;
          const unit = String(data.service_unit || 'fixed');
          updateData.service_unit = ['fixed', 'hour', 'day'].includes(unit) ? unit : 'fixed';
        }
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
        /* LS1: an item's own reorder point overrides the shop-wide
           notification range where set; absent falls back as before. */
        conditions.push({
          $expr: {
            $lte: [
              { $convert: { input: '$available_quantity', to: 'double', onError: 0, onNull: 0 } },
              { $ifNull: ['$reorder_point', parsedNotification] },
            ],
          },
        });
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
        // An all-digits query is how quick codes are typed.
        if (/^\d{1,6}$/.test(String(query))) {
          searchConditions.push({ plu_code: String(query) });
        }
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

      /* Same two clauses as the sale grid, same reason: search is a doorway
         to selling, and a hidden or deleted sample reachable by typing its
         name is not hidden at all. */
      const demoClause = await demoData.filter({ licenseId, branchId });
      const match = {
        $and: [
          searchConditions.length ? { $or: searchConditions } : null,
          Object.keys(demoClause).length ? demoClause : null,
          { del_status: { $nin: [1, '1', true] } },
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: 'instant' } },
          stockCondition,
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
              item_kind: 1,
              tile_color: 1,
              tile_shape: 1,
              plu_code: 1,
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
        item_kind: item.item_kind || 'product',
        tile_color: item.tile_color || '',
        tile_shape: item.tile_shape || '',
        plu_code: item.plu_code || '',
      }));

      // Exact quick-code hits lead the list - Enter carts them instantly.
      if (/^\d{1,6}$/.test(String(query))) {
        suggestions.sort(
          (a, b) => (b.plu_code === String(query) ? 1 : 0) - (a.plu_code === String(query) ? 1 : 0)
        );
      }

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

      /*
       * The demo filter and the deleted filter, HERE TOO.
       *
       * listScope's comment promised the demo clause lived in "the ONE place
       * the item list builds its filter... so it cannot be applied to some
       * reads and forgotten on others - a catalogue that hides sample items
       * on the manage screen and shows them on the sale grid is worse than
       * not hiding them at all." This query is the sale grid, it never went
       * through listScope, and the exact failure that sentence names is the
       * owner's report, verbatim: "i see nothing in item list but sales page
       * is showing item... i hard refreshed page. not removed."
       *
       * del_status for the same reason: with Demo Data's off now a DELETION,
       * a sale grid that ignores the deleted flag re-shells every purged
       * sample the moment the purge lands.
       */
      const demoClause = await demoData.filter({ licenseId, branchId });
      const match = {
        $and: [
          ...(Object.keys(demoClause).length ? [demoClause] : []),
          { del_status: { $nin: [1, '1', true] } },
          { 'branch_access.branch_id': branchObjectId },
          { item_status: { $ne: 'instant' } },
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
          // Tile colour (Loyverse study L2): the no-image tile's look.
          tile_color: item.tile_color || '',
          tile_shape: item.tile_shape || '',
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
        // Instant lines sell any quantity - stock never blocks them.
        negative_stock: true,
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
        // Additive: the stock-adjustment search shows current stock.
        available_quantity: item.available_quantity || 0,
        // Additive: the redesigned typeahead rows show stock state.
        track_inventory: item.track_inventory !== false,
        item_kind: item.item_kind || 'product',
        tile_color: item.tile_color || '',
        tile_shape: item.tile_shape || '',
      }));

      return { status: true, data: list, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.getReceivingItemsAjaxList:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * Every item a supplier supplies, optionally only the ones running low
   * (Loyverse study L2: the receiving screen's "all items from supplier /
   * low-stock items from supplier" autofill). Same row shape as the
   * receiving autocomplete so the client's add-line path is reused as-is.
   * Low stock uses the caller's notification range - the same number the
   * low-stock dashboard runs on - and only counts tracked items.
   */
  async getItemsBySupplier(params = {}, context = {}) {
    try {
      const { supplierId, lowStockOnly, notificationRange } = params || {};
      const branchId = context.branchId;
      const licenseId = context.licenseId;

      if (!branchId) return { status: false, data: null, message: 'Branch ID not found' };
      if (!supplierId || !ObjectId.isValid(String(supplierId))) {
        return { status: false, data: null, message: 'A valid supplier is required' };
      }

      const collection = await this.getCollection(this.collectionName);
      const conditions = [
        { 'branch_access.branch_id': new ObjectId(String(branchId)) },
        { item_status: { $ne: ITEM_STATUS.INSTANT } },
        { supplier_id: new ObjectId(String(supplierId)) },
        /* A deleted product is not purchasable. Every other item query
           carries NOT_DELETED; this one did not, so the purchase picker
           happily offered items the catalogue had already removed - the
           owner found it as "item list not showing but purchase shows
           all items", which is the same fact seen from both ends. */
        NOT_DELETED,
      ];
      if (licenseId && ObjectId.isValid(String(licenseId))) {
        conditions.push({ license: new ObjectId(String(licenseId)) });
      }
      if (lowStockOnly) {
        const range = parseInt(notificationRange, 10);
        const fallback = Number.isFinite(range) ? range : 10;
        conditions.push({ track_inventory: true });
        // The item's own reorder point wins where set (LS1).
        conditions.push({
          $expr: {
            $lte: [
              { $convert: { input: '$available_quantity', to: 'double', onError: 0, onNull: 0 } },
              { $ifNull: ['$reorder_point', fallback] },
            ],
          },
        });
      }

      const items = await collection.find({ $and: conditions }).limit(500).toArray();

      const list = items.map((item) => ({
        item_id: item._id?.toString() || '',
        item_name: item.name || '',
        selling_price: item.selling_price || 0,
        item_code: item.itemid || '',
        item_unit: item.unit || 'qty',
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
        available_quantity: item.available_quantity || 0,
      }));

      /* Incoming (PO step 3): what is already on an open order, so a shop
         does not double-order it. Display-only, fail-safe to zero. */
      const { incomingByItem } = require('../services/incoming-stock');
      const incoming = await incomingByItem(
        { branchId, licenseId },
        list.map((row) => row.item_id)
      );
      for (const row of list) {
        row.incoming = incoming[row.item_id] || 0;
      }

      return { status: true, data: list, message: 'success' };
    } catch (error) {
      console.error('Error in ItemRepository.getItemsBySupplier:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * Reasoned per-item stock adjustment (Loyverse study L2). Three reasons,
   * two behaviours: an Inventory count SETS stock to what was counted; Loss
   * and Damage SUBTRACT what disappeared (clamped at zero). Every change is
   * a stock-log row with the reason as its process - an adjustment is a
   * movement with an audit trail, never a silent overwrite. Receiving stock
   * is deliberately not a reason here: that is the receiving screen's job.
   */
  async stockAdjustment(params = {}, context = {}) {
    const { reason, note, rows } = params;
    try {
      /*
       * LS1: reasons are configurable text now, each with an explicit
       * direction. The three originals keep their implied modes so older
       * clients stay correct; anything else must SAY its direction - a
       * custom reason with no mode is refused, never guessed.
       */
      const SEED_REASONS = {
        'Inventory count': 'set',
        Loss: 'subtract',
        Damage: 'subtract',
        'Stock found': 'add',
      };
      const cleanReason = String(reason || '')
        .trim()
        .slice(0, 60);
      const requestedMode = params && params.mode;
      const mode = ['set', 'subtract', 'add'].includes(requestedMode)
        ? requestedMode
        : SEED_REASONS[cleanReason];
      if (!cleanReason || !mode) {
        return {
          status: false,
          data: null,
          message: 'Pick a reason and its direction (count sets, loss/damage subtract, found adds)',
        };
      }
      if (!Array.isArray(rows) || rows.length === 0) {
        return { status: false, data: null, message: 'Add at least one item to adjust' };
      }
      if (rows.length > 200) {
        return { status: false, data: null, message: 'At most 200 items per adjustment' };
      }
      const branchId = context.branchId;
      if (!branchId) return { status: false, data: null, message: 'Branch ID not found' };
      const branchObjectId = new ObjectId(String(branchId));
      const licenseObjectId =
        context.licenseId && ObjectId.isValid(String(context.licenseId))
          ? new ObjectId(String(context.licenseId))
          : null;

      const collection = await this.getCollection(this.collectionName);
      const branchesCollection = await this.getCollection('branches');
      const branchDoc = await branchesCollection.findOne({ _id: branchObjectId });
      const stockLogStatus = branchDoc?.stock_management_log !== false;
      const stockLogsRepository = new StockLogsRepository();
      const cleanNote = String(note || '')
        .trim()
        .slice(0, 500);
      const now = new Date();

      let updated = 0;
      let skipped = 0;
      for (const row of rows) {
        const qty = Number(row && row.qty);
        if (!row || !ObjectId.isValid(String(row.item_id)) || !Number.isFinite(qty) || qty < 0) {
          skipped += 1;
          continue;
        }
        const filter = {
          _id: new ObjectId(String(row.item_id)),
          'branch_access.branch_id': branchObjectId,
        };
        if (licenseObjectId) filter.license = licenseObjectId;
        const item = await collection.findOne(filter, {
          projection: {
            available_quantity: 1,
            name: 1,
            barcode_id: 1,
            track_inventory: 1,
            branch_id: 1,
          },
        });
        if (!item) {
          skipped += 1;
          continue;
        }
        const oldV = Number(item.available_quantity) || 0;
        const newV = mode === 'set' ? qty : mode === 'add' ? oldV + qty : Math.max(0, oldV - qty);
        if (newV === oldV) {
          skipped += 1;
          continue;
        }
        await collection.updateOne(
          { _id: item._id },
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

        if (item.track_inventory === true) {
          // Same count convention as every other stock writer: old - new,
          // negated when stock went up.
          const diff = oldV - newV;
          const count = diff < 0 ? String(Math.abs(diff)) : '-' + String(diff);
          await stockLogsRepository
            .createStockLog({
              stocklog: stockLogStatus,
              branch_id: branchObjectId || item.branch_id || null,
              view_item_id: item._id,
              item_barcode_id: item.barcode_id,
              item_name: item.name,
              item_quantity: String(newV),
              process: cleanReason,
              reference: item.barcode_id,
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

      return {
        status: true,
        data: { updated, skipped },
        message:
          updated > 0 ? `Adjusted ${updated} item(s)` : 'Nothing changed - stock already matched',
      };
    } catch (error) {
      console.error('Error in ItemRepository.stockAdjustment:', error);
      return { status: false, data: null, message: error.message };
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

      /* Same two clauses as the sale grid, same reason: a category tab is
         just the shelf filtered, and it showed what the shelf hid. */
      const demoClause = await demoData.filter({ licenseId, branchId });
      const conditions = [
        ...(Object.keys(demoClause).length ? [demoClause] : []),
        { del_status: { $nin: [1, '1', true] } },
        { item_status: { $ne: ITEM_STATUS.INSTANT } },
        {
          $or: [{ available_quantity: { $gt: 0 } }, { negative_stock: true }],
        },
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

  /**
   * A shop's storefront: who it is, whether it is taking orders, and the menu.
   *
   * Addressed ONLY by the public store address. There used to be a fallback
   * to the branch's raw database id, which appears in every authenticated
   * response and is no secret - so a branch that had deliberately never
   * opened a channel could still be read by anyone who had seen its id. The
   * store address is the opt-in, and nothing else opens this door.
   *
   * A `projectType: 'stock'` variant used to answer from the same method
   * with a second, narrower shape. Nothing sent it. It is gone rather than
   * carried.
   */
  /**
   * Which branch a storefront URL with no store address means.
   *
   * Most shops have one branch, and making every one of them print a code -
   * in a URL and inside a QR code - to say which of their single branch they
   * mean is friction paid by the many for the sake of the few. So `/order`
   * resolves here, and only a shop with several branches has to be explicit.
   *
   * ORDER MATTERS. A setting the shop actually made beats anything inferred,
   * because inference is a convenience and being overruled by a guess is how
   * a chain ends up serving its second branch's menu at its main address.
   *
   * @returns {{storeId: string|null, reason: string}}
   */
  async defaultStoreId() {
    const branchCollection = await this.getCollection('branches');
    const configured = await branchCollection
      .find(
        { 'online_ordering.store_id': { $nin: [null, ''] } },
        { projection: { _id: 1, branch_name: 1, 'online_ordering.store_id': 1 } }
      )
      .toArray();

    if (!configured.length) return { storeId: null, reason: 'none_configured' };

    /* 1. What the shop chose. */
    try {
      const settings = await this.getCollection('settings');
      const doc = await settings.findOne({ online_ordering_default_store: { $nin: [null, ''] } });
      const chosen = doc && String(doc.online_ordering_default_store).trim();
      if (chosen && configured.some((b) => String(b.online_ordering?.store_id) === chosen)) {
        return { storeId: chosen, reason: 'configured' };
      }
    } catch (e) {
      /* No settings document yet is not an error - a new shop has none - so
         fall through to the single-branch case, which is what it will be. */
      console.warn('[storefront] could not read the default store setting:', e.message);
    }

    /* 2. Only one branch takes online orders, so there is nothing ambiguous
       to resolve. */
    if (configured.length === 1) {
      return { storeId: String(configured[0].online_ordering.store_id), reason: 'only_one' };
    }

    /* 3. Several, and nobody said which. Refusing beats picking: showing a
       customer the wrong branch's menu, prices and opening hours is worse
       than telling them the address is incomplete. */
    return { storeId: null, reason: 'ambiguous' };
  }
  /**
   * The shop's public menu: what the kitchen cooks, for reading.
   *
   * NOT THE ORDERING CATALOGUE, and the difference is the point.
   *
   * `storefront` above answers with what can be ordered right now: items ticked
   * for the online channel and currently available. A menu is a different
   * document. A restaurant lists what it cooks, including the dish that is off
   * tonight and the one priced at market rate, because a menu with holes in it
   * reads as a restaurant that has run out of food.
   *
   * So this filters on `show_on_menu`, which defaults to true, and a shop
   * excludes the handful of lines that are not dishes rather than opting each
   * dish in one at a time.
   *
   * Sorted by the shop's own `sort_order` and then by name, so a menu reads in
   * the order the shop arranged it rather than the order Mongo happened to
   * return.
   */
  /**
   * The shop's serving periods: breakfast, lunch, dinner.
   *
   * Stored with the other channel settings rather than per branch, because a
   * chain serves breakfast at breakfast time everywhere. An empty list is the
   * normal state - most shops serve everything all day - and costs one lookup.
   */
  async shopDayparts() {
    try {
      const settings = await this.getCollection('settings');
      const doc = await settings.findOne({ menu_dayparts: { $exists: true } });
      return onlineOrdering.normalizeDayparts((doc && doc.menu_dayparts) || []);
    } catch (e) {
      /* No settings document yet is not an error, and a shop with no periods
         serves everything all day - which is the safe answer either way. */
      console.warn('[menu] could not read serving periods:', e.message);
      return [];
    }
  }

  /**
   * The shop's partner venues: hotels, offices, anywhere not its own floor.
   *
   * Read from settings for the same reason the serving periods are: a chain
   * ties up with a hotel as a business, not as one branch. An empty list is
   * the normal state and costs one lookup.
   */
  async shopVenues() {
    try {
      const settings = await this.getCollection('settings');
      const doc = await settings.findOne({ partner_venues: { $exists: true } });
      return partnerVenues.normalizeVenues((doc && doc.partner_venues) || []);
    } catch (e) {
      /* No venues is the safe answer as well as the common one: house prices,
         nothing owed to anybody. */
      console.warn('[menu] could not read partner venues:', e.message);
      return [];
    }
  }

  /**
   * Which items a channel sells, and which it does not.
   *
   * The screen behind "show me everything on Swiggy" - a shop with four
   * hundred lines is not going to open four hundred item pages, so the work has
   * to be doable from the channel's own side, filtered the way a shop thinks
   * about its catalogue: by category, or by typing part of a name.
   */
  async channelItems(params = {}) {
    try {
      const channel = itemChannels.normalizeTarget(params.channel);
      if (!channel) {
        return { status: false, message: 'Enter must correct channel', data: null };
      }

      const collection = await this.getCollection(this.collectionName);
      const match = {
        $and: [
          { license: BaseModel.license },
          NOT_DELETED,
          { is_deleted: { $ne: true } },
          { item_status: { $ne: ITEM_STATUS.INSTANT } },
        ],
      };

      if (params.categoryId && ObjectId.isValid(String(params.categoryId))) {
        match.$and.push({ category_id: new ObjectId(String(params.categoryId)) });
      }
      if (params.search) {
        /* Through safe-search, because this string came off a form and a
           regex assembled from user input is a denial of service waiting for
           somebody to paste the wrong thing. */
        match.$and.push({ name: searchPattern(params.search) });
      }

      const rows = await collection
        .find(match, {
          projection: {
            _id: 1,
            name: 1,
            category_name: 1,
            selling_price: 1,
            channel_off: 1,
            channel_hours: 1,
          },
        })
        .sort({ name: 1 })
        .limit(500)
        .toArray();

      return {
        status: true,
        message: 'OK',
        data: {
          channel,
          items: rows.map((row) => {
            const state = itemChannels.availableOn(row, channel);
            return {
              id: String(row._id),
              name: row.name || '',
              category_name: row.category_name || '',
              price: Number(row.selling_price) || 0,
              /* Whether this channel sells it at all. The clock is not
                 consulted here: a shop configuring its catalogue wants to see
                 what it has decided, not what happens to be true at 4pm. */
              on: state.reason !== 'not_on_channel',
              hours: (row.channel_hours || {})[channel] || null,
            };
          }),
          total: rows.length,
        },
      };
    } catch (error) {
      console.error('Error in ItemRepository.channelItems:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * Turning a whole filtered set on or off for one channel.
   *
   * WRITES ONLY WHAT CHANGES. "Sell everything on Swiggy" over four hundred
   * items should touch the handful that were off, not four hundred documents:
   * sync replaces whole documents, so every needless write is a chance to lose
   * a field somebody else changed a second earlier.
   */
  async setChannelForItems(params = {}) {
    try {
      const channel = itemChannels.normalizeTarget(params.channel);
      if (!channel) {
        return { status: false, message: 'Enter must correct channel', data: null };
      }
      const on = params.on !== false && params.on !== 'false';

      const ids = (Array.isArray(params.itemIds) ? params.itemIds : [])
        .filter((id) => ObjectId.isValid(String(id)))
        .map((id) => new ObjectId(String(id)));

      if (!ids.length) {
        return { status: false, message: 'Select at least one item', data: null };
      }

      const collection = await this.getCollection(this.collectionName);
      const rows = await collection
        .find(
          { _id: { $in: ids }, license: BaseModel.license },
          { projection: { _id: 1, channel_off: 1 } }
        )
        .toArray();

      let changed = 0;
      for (const row of rows) {
        const next = itemChannels.setChannel(row.channel_off, channel, on);
        if (!next.changed) continue;
        await collection.updateOne(
          { _id: row._id, license: BaseModel.license },
          { $set: { channel_off: next.value, updated_date: new Date() } }
        );
        changed += 1;
      }

      return {
        status: true,
        message: on ? 'Items added to this channel' : 'Items removed from this channel',
        data: { channel, on, matched: rows.length, changed },
      };
    } catch (error) {
      console.error('Error in ItemRepository.setChannelForItems:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * The window one item keeps on one channel.
   *
   * Separate from the on/off above because it is a different decision made at
   * a different moment: a shop switches a line off an app in a second, and
   * sits down to think about lunch hours.
   */
  async setChannelHours(params = {}) {
    try {
      const channel = itemChannels.normalizeTarget(params.channel);
      const itemId = String(params.itemId || '');
      if (!channel || !ObjectId.isValid(itemId)) {
        return { status: false, message: 'Enter must correct item id', data: null };
      }

      const collection = await this.getCollection(this.collectionName);
      const row = await collection.findOne(
        { _id: new ObjectId(itemId), license: BaseModel.license },
        { projection: { channel_hours: 1 } }
      );
      if (!row) return { status: false, message: 'Item not found', data: null };

      const hours = itemChannels.normalizeHours(row.channel_hours);
      /* An empty window CLEARS: "all day" is said by leaving the boxes blank,
         and storing a half-written one would hide the item instead. */
      const wanted = itemChannels.normalizeHours({ [channel]: params.window || {} });

      if (wanted[channel]) hours[channel] = wanted[channel];
      else delete hours[channel];

      await collection.updateOne(
        { _id: new ObjectId(itemId), license: BaseModel.license },
        { $set: { channel_hours: hours, updated_date: new Date() } }
      );

      return { status: true, message: 'Saved', data: { channel, hours: hours[channel] || null } };
    } catch (error) {
      console.error('Error in ItemRepository.setChannelHours:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * What sells, and what sells beside it.
   *
   * ONE PASS FOR BOTH, and that is the whole reason they live in one method.
   * Popularity is how often a line appears in a sale; "often ordered with" is
   * how often two lines appear in the SAME sale. Asking those separately means
   * reading the same few thousand sales twice, and asking for one item's
   * neighbours at a time means one query per dish on the menu.
   *
   * A WINDOW, NOT ALL OF HISTORY. What a restaurant sold last spring is not
   * what it sells this week, and a menu that recommends on three years of data
   * recommends the thing that was popular before the chef changed. Thirty days
   * of sales, capped, so this stays a bounded read on a busy shop.
   *
   * NEW SHOPS ANSWER EMPTY, and every caller has to be fine with that: a menu
   * with no sales behind it shows no "popular" badge and no suggestions rather
   * than inventing either.
   */
  async salesSignals({ branchId, days = 30, maxSales = 4000 } = {}) {
    const empty = { popularity: new Map(), related: new Map() };
    try {
      const sales = await this.getCollection('sales');
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const filter = {
        date: { $gte: since },
        sale_process: { $in: ['Add', 'Edit', 'PartialReturn', 'KOT'] },
      };
      if (BaseModel.license) filter.license = BaseModel.license;
      if (branchId && ObjectId.isValid(String(branchId))) {
        filter.branch_id = new ObjectId(String(branchId));
      }

      const rows = await sales
        .find(filter, { projection: { 'items.item_id': 1 } })
        .sort({ date: -1 })
        .limit(maxSales)
        .toArray();

      const popularity = new Map();
      const pairs = new Map();

      for (const sale of rows) {
        /* Deduplicated per sale: two portions of the same dish on one bill is
           one sale that wanted it, and counting quantity would let a single
           table of twelve decide what the whole menu recommends. */
        const ids = [
          ...new Set((sale.items || []).map((line) => String(line.item_id || '')).filter(Boolean)),
        ];

        for (const id of ids) {
          popularity.set(id, (popularity.get(id) || 0) + 1);
        }

        /* Co-occurrence, both directions, counted once per pair per sale. A
           bill of twenty lines would be 190 pairs, which is where a big
           catering order distorts everything, so wide bills are skipped. */
        if (ids.length < 2 || ids.length > 12) continue;

        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            for (const [a, b] of [
              [ids[i], ids[j]],
              [ids[j], ids[i]],
            ]) {
              if (!pairs.has(a)) pairs.set(a, new Map());
              const withA = pairs.get(a);
              withA.set(b, (withA.get(b) || 0) + 1);
            }
          }
        }
      }

      /* Top three neighbours per dish. Three is what fits under a dish on a
         phone without the suggestion becoming the page. */
      const related = new Map();
      for (const [id, counts] of pairs) {
        related.set(
          id,
          [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([otherId, count]) => ({ id: otherId, count }))
        );
      }

      return { popularity, related };
    } catch (error) {
      /* A menu that cannot read its own sales still has to serve the menu.
         No badges and no suggestions is a complete answer. */
      console.warn('[menu] could not read sales signals:', error.message);
      return empty;
    }
  }

  async publicMenu(params = {}) {
    const storeId = params.storeId;
    try {
      const branchCollection = await this.getCollection('branches');
      const branchDoc = await branchCollection.findOne({
        'online_ordering.store_id': storeId,
      });

      if (!branchDoc) {
        return { status: false, message: 'No shop found at this address', data: null };
      }

      const config = onlineOrdering.storefront(branchDoc);
      const collection = await this.getCollection(this.collectionName);

      const match = {
        $and: this._customerMenuFilter(branchDoc, salesChannels.CHANNEL.ONLINE),
      };

      const rows = await collection
        .find(match, {
          projection: {
            _id: 1,
            name: 1,
            description: 1,
            image: 1,
            selling_price: 1,
            discount_amount: 1,
            discount_percentage: 1,
            category_id: 1,
            category_name: 1,
            sort_order: 1,
            diet: 1,
            icon: 1,
            multi_image: 1,
            isAvailable: 1,
            ecommerce: 1,
            daypart_ids: 1,
            prep_minutes: 1,
          },
        })
        .sort({ sort_order: 1, name: 1 })
        .toArray();

      /*
       * Which serving periods are running right now.
       *
       * Computed once for the whole menu rather than per dish, and in the
       * BRANCH's timezone, because "is it lunchtime" is a question about where
       * the kitchen is, not about where the customer is holding their phone.
       */
      const dayparts = await this.shopDayparts();

      /*
       * Which prices this reader sees.
       *
       * A menu printed for a hotel room has to show the price that room will
       * actually be charged. Showing the house price and adding the markup at
       * checkout is how a customer finds out about it at the worst possible
       * moment - and a guest who feels overcharged complains to the hotel,
       * which is the relationship this whole feature exists to protect.
       */
      const servicePoint = partnerVenues.resolveServicePoint(
        { table: params.table, venue: params.venue, unit: params.unit },
        await this.shopVenues()
      );

      /* What sells and what sells beside it, from the last month of this
         branch's own sales. A new shop gets empty maps and simply shows no
         badges and no suggestions. */
      const signals = await this.salesSignals({ branchId: branchDoc._id });

      const localNow = moment().tz(onlineOrdering.normalizeTimeZone(branchDoc.time_zone));
      const nowDay = localNow.day();
      const nowMinutes = localNow.hours() * 60 + localNow.minutes();

      /* Grouped here rather than on the page: the page should render what it
         is given, and the grouping is the same work whoever does it. */
      const byCategory = new Map();
      for (const row of rows) {
        const key = String(row.category_id || 'uncategorised');
        if (!byCategory.has(key)) {
          byCategory.set(key, {
            id: key,
            name: row.category_name || '',
            items: [],
          });
        }
        /*
         * A dish outside its serving period is SHOWN, and told on.
         *
         * Hiding it makes a restaurant look like it does not serve breakfast
         * at all. Someone reading the menu at four in the afternoon wants to
         * know that breakfast exists and runs seven to eleven, which is a
         * reason to come back rather than a dead end.
         */
        const timing = onlineOrdering.itemAvailability(row, dayparts, nowDay, nowMinutes);

        byCategory.get(key).items.push({
          id: String(row._id),
          name: row.name || '',
          description: row.description || '',
          image: row.image || '',
          /*
           * Every photo of this dish, cover first and no duplicate of it.
           *
           * Shops already upload several - the item form has taken a set for
           * years - and the menu showed exactly one, so the rest existed and
           * were never seen by a customer. The card still shows the cover
           * alone: a gallery belongs where somebody has stopped to look, not
           * in a list being scanned.
           */
          photos: onlineOrdering.photoList(row),
          price: partnerVenues.priceFor(Number(row.selling_price) || 0, servicePoint.venue),
          diet: String(row.diet || ''),
          /*
           * A picture for a dish nobody photographed.
           *
           * Resolved HERE rather than on the page, so the menu, the captain
           * app, the kiosk and a QR code all draw the same thing for the same
           * dish, and an old build that never heard of this gets it anyway.
           * Empty when there is a photograph, because drawing both is clutter,
           * and empty when the name suggests nothing - which is an honest
           * answer, not a gap.
           */
          icon: dishIcons.iconFor(row),
          /*
           * Shown on the menu but not orderable right now: it is not its time
           * of day. The page says so, with the periods it IS served in.
           *
           * `isAvailable` used to be read here too, and it is not what its
           * name says. It is the legacy per-item "show on kiosk" tick, written
           * as Boolean(ecommerce) on every save - so every dish saved through
           * the item form without that box ticked carried isAvailable: false,
           * and a real shop's whole menu came out greyed "Not available
           * today". Which channel sells a dish is the per-channel exception
           * list now (see _customerMenuFilter); whether it is on right now is
           * the serving period.
           */
          available: timing.available,
          /* The periods this dish belongs to, so the page can say "Breakfast
             only" rather than leaving a greyed-out dish unexplained. */
          served_in: timing.periods,
          /* Roughly how long the kitchen needs. Zero means the shop has not
             said, and the page shows nothing rather than guessing. */
          prep_minutes: Number(row.prep_minutes) || 0,
          /* How many of the last month's bills carried this. The page sorts
             on it and badges the top few; zero is "we do not know yet", never
             "nobody wants it". */
          ordered_count: signals.popularity.get(String(row._id)) || 0,
          /* The dishes most often on the same bill, best first. Ids only -
             the page already holds every dish and looking them up there beats
             sending three copies of each name down a phone connection. */
          goes_with: (signals.related.get(String(row._id)) || []).map((r) => r.id),
          /* Internal, stripped before the page sees it: only the category
             ranking above needs it. */
          _sort: Number(row.sort_order) || 0,
        });
      }

      /*
       * The order the sections appear in.
       *
       * This came out ALPHABETICAL at first, which put Breads before Starters:
       * stable, and wrong in a way any restaurant would notice immediately.
       * Categories carry no sort field of their own in this schema, so the
       * order has to come from somewhere real rather than from the order Mongo
       * happened to return the first item of each.
       *
       * The categories collection answers it. A shop creates Starters, then
       * Mains, then Breads, then Desserts - it builds its menu in the order it
       * thinks about the menu - and an ObjectId sorts by creation time, so
       * creation order IS the shop's own order. A `sort_order` on the category
       * wins where one exists, for a shop that has arranged them deliberately.
       *
       * A category that no longer exists sorts last rather than vanishing: a
       * heading with dishes under it belongs on the menu whatever the
       * categories collection thinks.
       */
      const categoryRank = new Map();
      try {
        const categoryCollection = await this.getCollection('categories');
        const known = await categoryCollection
          .find({}, { projection: { _id: 1, sort_order: 1 } })
          .sort({ sort_order: 1, _id: 1 })
          .toArray();
        known.forEach((c, i) => categoryRank.set(String(c._id), i));
      } catch (e) {
        /* No categories collection is not an error - the fallback below is
           still deterministic. */
        console.warn('[menu] could not read category order:', e.message);
      }

      const categories = [...byCategory.values()]
        .filter((c) => c.items.length)
        .map((c) => ({
          ...c,
          _rank: categoryRank.has(c.id) ? categoryRank.get(c.id) : Number.MAX_SAFE_INTEGER,
        }))
        .sort((a, b) => a._rank - b._rank || String(a.name).localeCompare(String(b.name)))
        .map(({ _rank, ...c }) => ({
          ...c,
          items: c.items.map(({ _sort, ...item }) => item),
        }));

      return {
        status: true,
        message: 'OK',
        data: {
          store: {
            store_id: config?.store_id || '',
            name: branchDoc.branch_name || branchDoc.name || '',
            logo: config?.logo || '',
            banner: config?.banner || '',
            /*
             * The shop's own currency, as a SYMBOL. Hardcoding a rupee sign
             * is how a menu in Nairobi prices its food in the wrong money;
             * handing the page the stored label is how the menu came to read
             * "India Rupee / INR or ₹ 80" beside every dish. The ISO code
             * rides beside it for anything that must be unambiguous.
             */
            currency: currencyLabel.currencySymbol(branchDoc.currency_text || branchDoc.currency),
            currency_code: currencyLabel.currencyCode(
              branchDoc.currency_text || branchDoc.currency
            ),
            /* "31 dishes" for a kitchen, "31 items" for a shop. */
            ...this._publicContact(branchDoc),
            kind: await this.shopKind(branchDoc),
          },
          /* The channel state travels with the menu so the page can say "opens
             at 6" without a second request, and so a shop that also takes
             orders can offer that link from here. */
          channel: onlineOrdering.channelState(config, {
            timeZone: branchDoc.time_zone,
          }),
          /* Who is reading, where they are sitting, and whether these prices
             are the house's. Null venue means the shop's own floor. */
          service_point: {
            label: servicePoint.label || '',
            venue: servicePoint.venue
              ? {
                  code: servicePoint.venue.code,
                  name: servicePoint.venue.name,
                  unit_label: servicePoint.venue.unit_label,
                  unit: servicePoint.unit || '',
                }
              : null,
          },
          categories,
          item_count: rows.length,
        },
      };
    } catch (error) {
      console.error('Error in ItemRepository.publicMenu:', error);
      return { status: false, message: error.message, data: null };
    }
  }

  /**
   * Which branch a storefront request means.
   *
   * THE STORE ADDRESS IS THE ONLY WAY IN FROM OUTSIDE, and that is the point.
   * A branch's raw database id appears in every authenticated response and is
   * no secret, so accepting one from an anonymous caller would let anybody who
   * had ever seen an id read a shop that deliberately never opened a channel.
   *
   * `branchId` is the staff door beside it. A route may pass it only after it
   * has established that the caller works for this shop - a signed-in user, or
   * the installation's own kiosk key. Such a caller is already entitled to
   * this branch's catalogue; they can read it off the till. Making their shop
   * publish a PUBLIC store address before the captain app could list a menu
   * would be a rule protecting nobody from anybody.
   *
   * The two are separate parameters rather than one that accepts either,
   * because then the guard is a property of the CALLER and cannot be lost by a
   * value turning out to look like the other kind.
   */
  /**
   * Every item a customer may see on a channel.
   *
   * THE ONE RULE behind the public menu and the ordering page, so the two can
   * never disagree about what the shop sells. Everything on the menu, less
   * what the shop has taken off THIS channel by hand.
   *
   * Absent means shown, twice over: a shop that has never opened the menu
   * screen still gets a complete menu, and one that has never touched the
   * channel screen has every item on every channel. Exceptions are stored,
   * not permissions, so nothing needs a migration to appear.
   *
   * @param {object} branchDoc
   * @param {string} channel  a CHANNEL value; the customer-facing ones
   * @returns {Array} clauses for a `$and`
   */
  _customerMenuFilter(branchDoc, channel) {
    return [
      { 'branch_access.branch_id': branchDoc._id },
      { item_status: { $ne: ITEM_STATUS.INSTANT } },
      { license: branchDoc.license },
      { del_status: { $nin: [1, '1', true] } },
      { is_deleted: { $ne: true } },
      { show_on_menu: { $ne: false } },
      itemChannels.channelFilter(channel),
    ];
  }

  /**
   * What a shop prints on its door and its receipts: where it is, how to
   * ring it, its website. Public by nature, and what the assistant answers
   * "where are you" from. Never the email, which is the owner's login on
   * many shops, and never anything from the credentials.
   */
  _publicContact(branchDoc) {
    const line = (value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const address = [
      line(branchDoc.store_address || branchDoc.address || branchDoc.printing_address),
      line(branchDoc.city),
      line(branchDoc.pincode),
    ]
      .filter(Boolean)
      .filter((part, i, all) => all.indexOf(part) === i)
      .join(', ');
    const phone = [line(branchDoc.store_telephone), line(branchDoc.store_alternativephone)]
      .filter(Boolean)
      .filter((part, i, all) => all.indexOf(part) === i)
      .join(' / ');
    return { address, phone, website: line(branchDoc.website) };
  }

  async _storefrontBranch({ storeId, branchId }) {
    const branches = await this.getCollection('branches');
    if (branchId) {
      const selector = ObjectId.isValid(String(branchId))
        ? { _id: new ObjectId(String(branchId)) }
        : { 'online_ordering.store_id': String(branchId) };
      return branches.findOne(selector);
    }
    return branches.findOne({ 'online_ordering.store_id': storeId });
  }

  /**
   * The voice settings a handset is allowed to see.
   *
   * Read through the settings repository so branch overrides and account-level
   * inheritance work the way they do everywhere else - a chain that sets this
   * once for every shop should not have to be set again per branch.
   *
   * A read that fails answers with the default rather than throwing. A menu
   * that will not load because a settings lookup failed is a far worse outcome
   * than a handset that falls back to its own recogniser.
   */
  async voiceForHandset(branchDoc) {
    try {
      const SettingsRepository = require('./settings.repository');
      const settings = new SettingsRepository();
      const read = await settings.resolveGroup('preferences', {
        branchId: branchDoc._id,
        licenseId: branchDoc.license,
      });
      return voiceSettings.forHandset((read && read.status && read.data.values) || {});
    } catch (e) {
      console.warn('[storefront] could not read the voice settings:', e.message);
      return voiceSettings.forHandset({});
    }
  }

  /**
   * A restaurant, or a shop.
   *
   * The Restaurant module on the Features page - stored as
   * `table_options: 'enable'` - is the one switch that says food is cooked
   * here and carried to a table. The customer pages change shape on it: a
   * restaurant orders DISHES to a TABLE and takes a note for the kitchen; a
   * shop sells ITEMS to be collected or delivered. Read through the settings
   * repository, like the handset's voice settings, so a chain that set it
   * once does not have to set it per branch. Absent reads as a shop, which
   * is what the console does with the same key.
   *
   * @returns {Promise<'restaurant'|'retail'>}
   */
  async shopKind(branchDoc) {
    try {
      const SettingsRepository = require('./settings.repository');
      const settings = new SettingsRepository();
      const read = await settings.resolveGroup('features', {
        branchId: branchDoc._id,
        licenseId: branchDoc.license,
      });
      const values = (read && read.status && read.data && read.data.values) || {};
      /*
       * Stored as the STRING 'true' by the Features page, as a boolean by
       * older saves, and as 'enable' only in the console's own cache. The
       * first cut of this read 'enable' and made every shop a shop.
       */
      const raw = values.table_options;
      const on =
        raw === true ||
        raw === 1 ||
        ['true', 'enable', 'enabled', '1', 'on', 'yes'].includes(
          String(raw == null ? '' : raw)
            .trim()
            .toLowerCase()
        );
      return on ? 'restaurant' : 'retail';
    } catch (e) {
      console.warn('[storefront] could not read the shop kind:', e.message);
      return 'retail';
    }
  }

  /**
   * The settings context behind a public store address.
   *
   * For the one storefront endpoint that spends the shop's own money (the
   * ordering assistant), which has to read the shop's AI settings and
   * charge its budget: the address names a branch, and the branch names
   * the context every other feature uses. Null for an address nobody owns.
   */
  async storefrontContext(params = {}) {
    const branchDoc = await this._storefrontBranch(params);
    if (!branchDoc) return null;
    return { branchId: branchDoc._id, licenseId: branchDoc.license };
  }

  async storefront(params = {}) {
    try {
      const branchDoc = await this._storefrontBranch(params);

      if (!branchDoc) {
        return { status: false, message: 'No shop found at this address', data: null };
      }

      const config = onlineOrdering.storefront(branchDoc);
      const kind = await this.shopKind(branchDoc);

      /*
       * The menu is the items the shop ticked for the online channel, and
       * nothing else.
       *
       * This narrowing used to apply only when the caller named the STORE
       * ADDRESS: the same branch reached by its database id answered with the
       * whole catalogue instead, back-of-house lines included. One public
       * endpoint must not hold two ideas of what is public, and there is only
       * one way in now anyway.
       */
      const collection = await this.getCollection(this.collectionName);
      const channel = params.channel || salesChannels.CHANNEL.ONLINE;

      /*
       * WHAT A CUSTOMER IS SHOWN, AND WHAT A WAITER IS SHOWN.
       *
       * A customer - on their phone, or at the shop's own machine - sees the
       * list the public menu shows: everything on the menu that this channel
       * has not been told to leave out. One rule for both reads, from one
       * place, so /menu and /order cannot disagree about what the shop sells.
       * They did: the menu listed the whole catalogue while the ordering page
       * beside it was empty, because this read also demanded the legacy
       * per-item "show on kiosk" tick (`ecommerce`, mirrored as
       * `isAvailable`) - which nothing on the channel screens sets, and which
       * a shop that has just been given its store address has never seen.
       *
       * A waiter is staff standing in the shop, selling the shop's own
       * catalogue - the same list as the till - narrowed only by what the shop
       * took off the tableside channel by hand. Applying the customer rule to
       * a handset once emptied every captain app in the building.
       */
      const staffChannel = channel === salesChannels.CHANNEL.TABLESIDE;
      const baseFilter = staffChannel
        ? [
            { 'branch_access.branch_id': branchDoc._id },
            { item_status: { $ne: ITEM_STATUS.INSTANT } },
            { license: branchDoc.license },
            itemChannels.channelFilter(channel),
          ]
        : this._customerMenuFilter(branchDoc, channel);

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
                icon: '$icon',
                available_quantity: '$available_quantity',
                negative_stock: '$negative_stock',
                description: '$description',
                /* The veg mark, and what the kitchen needs. The ordering page
                   could not filter by diet or show a preparation time because
                   neither ever reached it - the menu had them and the page
                   people actually order from did not. */
                diet: '$diet',
                prep_minutes: '$prep_minutes',
                /* Every photo, and the serving periods, so the ordering page
                   can show the gallery and grey a dish outside its hours the
                   way the menu does. Both are folded into `photos`,
                   `available` and `served_in` below and do not travel raw. */
                multi_image: '$multi_image',
                daypart_ids: '$daypart_ids',
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

      /*
       * A picture for a dish nobody photographed.
       *
       * Resolved here rather than in the pipeline: it reads the NAME when the
       * shop has chosen nothing, and a keyword table is not a thing to write
       * in aggregation syntax. Done for every caller of the storefront - the
       * ordering page, the shop's own terminal and the captain app - so all of
       * them draw the same picture for the same dish.
       */
      for (const group of results) {
        for (const item of group.items || []) {
          item.icon = dishIcons.iconFor({ image: item.img, icon: item.icon, name: item.name });
        }
      }

      /*
       * The photos, and whether the dish is on RIGHT NOW.
       *
       * Both computed exactly as the public menu computes them, so a customer
       * who read the menu and then opened the ordering page is told the same
       * thing twice rather than two different things. A dish outside its
       * serving period stays on the list and says so; the order endpoint
       * refuses it by name if it is posted anyway.
       */
      let dayparts = [];
      try {
        dayparts = await this.shopDayparts();
      } catch (e) {
        console.warn('[storefront] could not read serving periods:', e.message);
      }
      const localNow = moment().tz(onlineOrdering.normalizeTimeZone(branchDoc.time_zone));
      const nowDay = localNow.day();
      const nowMinutes = localNow.hours() * 60 + localNow.minutes();
      for (const group of results) {
        group.items = (group.items || []).map((item) => {
          const timing = onlineOrdering.itemAvailability(item, dayparts, nowDay, nowMinutes);
          const { multi_image, daypart_ids, ...rest } = item;
          return {
            ...rest,
            photos: onlineOrdering.photoList({ image: item.img, multi_image }),
            available: timing.available,
            served_in: timing.periods,
          };
        });
      }

      /*
       * The prices THIS service point pays.
       *
       * Done in JavaScript after the aggregation rather than inside it. The
       * pipeline derives four numbers from the selling price - the price, the
       * discount, the tax and the final - and threading a markup through all
       * four in aggregation syntax would be four chances to get it subtly
       * wrong, in a language nobody can step through.
       *
       * Only the SELLING PRICE is marked up. A fixed discount of 20 stays 20,
       * exactly as the order endpoint treats it, because the two must agree to
       * the paisa: a page that quotes one total and a server that charges
       * another is the single worst bug this feature can have.
       */
      const servicePoint = partnerVenues.resolveServicePoint(
        { table: params.table, venue: params.venue, unit: params.unit },
        await this.shopVenues()
      );

      if (servicePoint.venue) {
        const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
        for (const group of results) {
          group.items = (group.items || []).map((item) => {
            const price = partnerVenues.priceFor(item.price, servicePoint.venue);
            const fixed = Number(item.discount_amount) || 0;
            const discount = money(
              fixed > 0 ? fixed : price * ((Number(item.discount_percentage) || 0) / 100)
            );
            const taxable = price - discount;
            const rate = (Number(item.tax) || 0) / 100;
            const taxPrice = item.tax_type === 'inclusive' ? 0 : money(taxable * rate);
            return {
              ...item,
              price,
              discount_price: discount,
              tax_price: taxPrice,
              final_price: money(item.tax_type === 'exclusive' ? taxable + taxPrice : taxable),
            };
          });
        }
      }

      /*
       * How often each line sold, so the page can offer "most ordered".
       *
       * Same one-pass read the menu uses. A shop with no history gets zeros
       * and the sort simply keeps the shop's own order, which is the right
       * answer rather than a degraded one.
       */
      const ordering = await this.salesSignals({ branchId: branchDoc._id });
      for (const group of results) {
        group.items = (group.items || []).map((item) => ({
          ...item,
          ordered_count: ordering.popularity.get(String(item.id)) || 0,
          goes_with: (ordering.related.get(String(item.id)) || []).map((r) => r.id),
        }));
      }

      /* What a customer pays on top of the food, so the page can show a
         delivery fee and a free-delivery threshold before checkout rather
         than surprising somebody with it at the last step. */
      let charges = {};
      try {
        const settings = await this.getCollection('settings');
        const doc = await settings.findOne({ channel_charges: { $exists: true } });
        charges = salesChannels.normalizeCharges((doc && doc.channel_charges) || {});
      } catch (e) {
        console.warn('[storefront] could not read charges:', e.message);
        charges = salesChannels.normalizeCharges({});
      }

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
        console.warn('[storefront] Failed to fetch tableorders:', e.message);
      }

      return {
        status: true,
        message: 'OK',
        data: {
          /* Who the shop is, as the customer sees it. */
          store: {
            store_id: config?.store_id || '',
            name: branchDoc.branch_name || branchDoc.name || '',
            logo: config?.logo || '',
            banner: config?.banner || '',
            homebanner: config?.homebanner || '',
            advertisement: config?.advertisement || '',
            /* The symbol to print beside a price, and the ISO code. The
               ordering page hardcoded a rupee sign; the menu beside it read
               the shop's own. Both read the shop's own now. */
            currency: currencyLabel.currencySymbol(branchDoc.currency_text || branchDoc.currency),
            currency_code: currencyLabel.currencyCode(
              branchDoc.currency_text || branchDoc.currency
            ),
            /* A restaurant or a shop; the page's words and questions follow. */
            ...this._publicContact(branchDoc),
            kind,
          },
          /* What this kind of shop offers on top of the list: a note for the
             kitchen, on each line and on the order, where there is a
             kitchen to read it. */
          features: {
            notes: kind === 'restaurant',
            /* Whether the spark is drawn: the shop's own AI, switched on
               for the ordering page in particular. Decided here so a page
               never offers a button that would fail. */
            ...(await orderingAssistant.storefrontFeatures({
              branchId: branchDoc._id,
              licenseId: branchDoc.license,
            })),
          },
          /*
           * What the page is allowed to do, decided here rather than on the
           * phone. The customer's clock can be wrong or set deliberately, so
           * "are we open" is never computed in the browser. The page renders
           * what it is told; the order endpoint runs the same computation
           * again before it accepts anything.
           */
          channel: onlineOrdering.channelState(config, {
            timeZone: branchDoc.time_zone,
          }),
          products: results,
          tableorders,
          /*
           * WHETHER THIS SHOP RUNS TABLES AT ALL.
           *
           * An empty `tableorders` has two completely different meanings: a
           * restaurant that has not typed its tables in yet, and a shop that
           * does not do table service and never will. The handset could not
           * tell them apart, so a waiter signing in at a grocer got the same
           * blank screen as a waiter at a restaurant whose manager had not
           * finished setting up - and neither was told which.
           *
           * Sent as the branch's own switch rather than inferred from the
           * count, so the app can say the true thing: turn Restaurant on, or
           * add your tables.
           */
          table_service: branchDoc.table_options === true,
          /*
           * Whether this shop's handsets may listen, and in what language.
           *
           * WHERE THE AUDIO GOES, never which vendor transcribes it and never
           * the key. A handset told the vendor is a handset that will
           * eventually be asked to hold the key for it, and telling one phone
           * tells every phone in the building. See utils/voice-settings.js.
           */
          voice: await this.voiceForHandset(branchDoc),
          /*
           * Where this customer is sitting, and whether the prices above are
           * the house's. The page shows the destination at checkout and lets
           * it be corrected - a guest can photograph the code in room 123 and
           * send it to a friend in 456, and the food should follow the guest
           * rather than the link.
           */
          service_point: {
            label: servicePoint.label || '',
            venue: servicePoint.venue
              ? {
                  code: servicePoint.venue.code,
                  name: servicePoint.venue.name,
                  unit_label: servicePoint.venue.unit_label,
                  unit: servicePoint.unit || '',
                  ask_floor: servicePoint.venue.ask_floor === true,
                  address: servicePoint.venue.address || '',
                  delivery_note: servicePoint.venue.delivery_note || '',
                }
              : null,
          },
          charges,
          /*
           * Which ways a customer may pay. Public, because the page cannot
           * draw a checkout without knowing them, and safe to be public
           * because these are on/off flags - there is no key or secret among
           * them.
           *
           * Coerced to real booleans. They have been stored as the STRINGS
           * 'true' and 'false' at different times, and the string 'false' is
           * truthy, so a page testing the raw value would offer a payment
           * method the shop had switched off.
           */
          payment: (() => {
            const cod = config?.payment_cod === true || config?.payment_cod === 'true';
            const razorpay =
              config?.payment_razorpay === true || config?.payment_razorpay === 'true';
            return {
              cod,
              razorpay,
              number: config?.payment_number === true || config?.payment_number === 'true',
              /*
               * PAYING OFFLINE FINISHES AN ORDER.
               *
               * At the counter, on delivery, when collecting: that is how
               * most of these shops take money, and the page used to refuse
               * every shop with no gateway - "has not set up a way to pay
               * online yet" - which turned the ordering page into a menu.
               * Offline is on unless the shop takes online payment AND has
               * switched the offline box off, which is the one case where
               * "prepaid only" means something.
               */
              offline: razorpay ? cod : true,
            };
          })(),
          /* Device-only: which printer the shop's own terminal sends its
             ticket to. Meaningless to a customer's phone, so it leaves only
             through the door that costs this installation's kiosk key. */
          print: {
            printer_name: config?.printer_name || '',
          },
        },
      };
    } catch (error) {
      console.error('Error in ItemRepository.storefront:', error);
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

  /*
   * Targeted money-field patch from the sale screen's "update item too"
   * choice: only the fields the cashier actually changed, nothing else on
   * the item is touched.
   */
  /*
   * Every item this branch can sell, reduced to the four fields the GST
   * readiness scan compares. Scoped by branch_access + license like the
   * paged list above (branch_id/branch_name are stale legacy fields).
   * Projected rather than fetched whole: this walks the entire catalogue.
   */
  async listForGstReadiness({ branchId, licenseId } = {}) {
    const collection = await this.getCollection(this.collectionName);
    const filter = {
      'branch_access.branch_id': this.toObjectId(branchId),
      license: this.toObjectId(licenseId),
    };
    return collection
      .find(filter, {
        projection: { item_name: 1, name: 1, tax: 1, hsncode: 1, hsndescription: 1 },
      })
      .sort({ item_name: 1 })
      .toArray();
  }

  async quickPatch(id, fields) {
    try {
      const collection = await this.getCollection(this.collectionName);
      const objectId = ObjectId.isValid(id) ? new ObjectId(id) : id;
      const set = {};
      if (fields.selling_price !== undefined) {
        const v = parseFloat(fields.selling_price);
        if (Number.isFinite(v) && v >= 0) set.selling_price = Math.round(v * 100) / 100;
      }
      if (fields.tax !== undefined) {
        const v = parseFloat(fields.tax);
        if (Number.isFinite(v) && v >= 0 && v <= 100) set.tax = v;
      }
      if (fields.discount_percentage !== undefined) {
        const v = parseFloat(fields.discount_percentage);
        if (Number.isFinite(v) && v >= 0 && v <= 100) {
          set.discount_percentage = v;
          set.discount_amount = 0;
        }
      }
      if (fields.discount_amount !== undefined) {
        const v = parseFloat(fields.discount_amount);
        if (Number.isFinite(v) && v >= 0) {
          set.discount_amount = Math.round(v * 100) / 100;
          set.discount_percentage = 0;
        }
      }
      if (!Object.keys(set).length) {
        return { status: false, message: 'Nothing to update' };
      }
      set.updated_date = new Date();
      const result = await collection.updateOne({ _id: objectId }, { $set: set });
      if (!result.matchedCount) return { status: false, message: 'Item not found' };
      return { status: true, message: 'Item updated' };
    } catch (error) {
      console.error('Error in ItemRepository.quickPatch:', error);
      throw error;
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
        // not create/attach tax groups - they use HSN codes instead.
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
            // Non-HSN item with explicit tax_name from CSV - treat as a
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
             item_status, ecommerce, negative_stock,
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
  /*
   * Every item in the catalogue, grouped into families, without holding the
   * catalogue in memory.
   *
   * The export has to group variants together, and the obvious way to do that
   * is to read everything and bucket it. This repository has already paid for
   * that once: the catalogue copy called .toArray() and then built a second
   * full array of the same rows, so two copies of a shop's entire item list
   * were resident at once, on a process shared with every other shop.
   *
   * Sorting by variant_group_id means a family arrives contiguously, so the
   * grouping can be done as the cursor advances - one family resident at a
   * time. The caller gets each family as it completes and decides what to do
   * with it.
   *
   * The sort is the load-bearing part. Without it a family is scattered
   * through the stream and the "flush when the id changes" rule silently emits
   * the same family several times, each with some of its variants.
   */
  async streamCatalogue({ branchId, licenseId }, onGroup) {
    const collection = await this.getCollection(this.collectionName);

    const filter = {
      'branch_access.branch_id': this.toObjectId(branchId),
      license: this.toObjectId(licenseId),
    };

    const cursor = collection.find(filter).sort({ variant_group_id: 1, _id: 1 });

    let current = null;
    let pending = [];
    let count = 0;

    const flush = async () => {
      if (!pending.length) return;
      await onGroup(pending);
      count += pending.length;
      pending = [];
    };

    for await (const row of cursor) {
      const gid = row.variant_group_id ? String(row.variant_group_id) : '';
      /* Items with no family are each their own group, so an empty id must not
         collapse them all into one enormous "family". */
      if (!gid || gid !== current) {
        await flush();
        current = gid || null;
      }
      pending.push(row);
      if (!gid) await flush();
    }
    await flush();

    return count;
  }

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
