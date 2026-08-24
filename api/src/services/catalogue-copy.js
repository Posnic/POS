'use strict';

/*
 * Start a new shop with the products the last one sells (owner ask #85).
 *
 * "Inventory copy, or common inventory" - and for this schema those are not
 * two settings, they are one workable idea and one that would corrupt a till.
 *
 * WHY "COMMON INVENTORY" IS NOT A SWITCH
 *
 * Stock lives on the ITEM DOCUMENT (`quantity`, `available_quantity`), and each
 * branch owns its own item documents - item.repository seeds
 * `branch_access: [{ branch_id: <owning branch> }]` on create. So widening the
 * item read the way customers and suppliers were widened would not produce one
 * shared product list. It would show a cashier N copies of every product, one
 * per branch, each with a different count - and selling the wrong row would
 * decrement another shop's stock. A genuine common inventory needs per-branch
 * stock records, which is a schema change, not a setting.
 *
 * What a new branch actually wants is the CATALOGUE: the names, prices, tax,
 * barcodes and categories, with its own counts starting at zero. That is this.
 *
 * WHAT COMES ACROSS, AND WHY THE ORDER MATTERS
 *
 * Categories, units and taxes are per-branch too (branch.model seeds a
 * 'Quantity' unit and a default tax for every new shop). Copying items alone
 * would leave every one of them pointing at the SOURCE branch's category and
 * tax - records the new branch cannot see - so the item list would render with
 * blank categories and the wrong tax on the first sale. They are copied first
 * and the old id -> new id map is applied as the items are written.
 *
 * COUNTS ARE NOT COPIED. Stock is physical. A copied count is a number the
 * shop never counted, and it would let the till sell what is not on the shelf
 * from the first minute. Everything else is a description of a product and
 * travels unchanged.
 */

const { ObjectId } = require('mongodb');

/* Collections copied ahead of items, in this order, each one keyed by the
   field on `items` that points at it. */
const LOOKUPS = Object.freeze([
  { collection: 'categories', itemIdField: 'category_id', itemNameField: 'category_name' },
  { collection: 'unit', itemIdField: 'unit_id', itemNameField: 'unit_name' },
  { collection: 'grouptax', itemIdField: 'tax_id', itemNameField: 'tax_name' },
]);

/* Fields that describe THIS branch's stock, not the product. Zeroed on copy. */
const STOCK_FIELDS = Object.freeze([
  'quantity',
  'available_quantity',
  'opening_stock',
  'stock_value',
]);

/* Batched, because a shop with ten thousand products should not become one
   insert the driver has to hold in memory. */
const BATCH = 500;

const asId = (v) => {
  if (v instanceof ObjectId) return v;
  try {
    return new ObjectId(String(v));
  } catch (e) {
    return null;
  }
};

/*
 * Copy one lookup collection and return old id -> new id.
 *
 * The rows carry `branch_name` as a denormalised convenience, so it is restated
 * for the target rather than copied - a new shop showing the old shop's name
 * beside every category is the kind of detail that makes software feel wrong.
 */
async function copyLookup(db, name, { source, target, targetName, license, stamp }) {
  const collection = db.collection(name);
  const rows = await collection.find({ branch_id: source, license }).toArray();
  const map = new Map();
  if (!rows.length) return map;

  const docs = rows.map((row) => {
    const { _id, ...rest } = row;
    const fresh = new ObjectId();
    map.set(String(_id), fresh);
    return {
      ...rest,
      _id: fresh,
      branch_id: target,
      branch_name: targetName,
      license,
      ...stamp,
    };
  });

  for (let i = 0; i < docs.length; i += BATCH) {
    await collection.insertMany(docs.slice(i, i + BATCH), { ordered: false });
  }
  return map;
}

/**
 * Copy a branch's catalogue onto a newly created branch.
 *
 * Refuses rather than duplicates if the target already holds items: this runs
 * from branch creation, and a retried create must not leave a shop with two of
 * every product.
 *
 * @returns {Promise<{status: boolean, data?: object, message?: string}>}
 */
async function copyCatalogue(db, options = {}) {
  const source = asId(options.sourceBranchId);
  const target = asId(options.targetBranchId);
  const license = asId(options.licenseId);

  if (!db) return { status: false, message: 'No database handle' };
  if (!source || !target || !license) {
    return { status: false, message: 'Source branch, target branch and licence are all required' };
  }
  if (String(source) === String(target)) {
    return { status: false, message: 'A branch cannot copy its catalogue from itself' };
  }

  const items = db.collection('items');
  const stamp = {
    created_date: options.now || new Date(),
    updated_date: options.now || new Date(),
    created_by: options.userName || '',
    created_by_id: options.userId || null,
    updated_by: options.userName || '',
    updated_by_id: options.userId || null,
  };

  try {
    /* Never copy twice. A create that was retried, or an owner pressing the
       button again, must not produce two of every product. */
    const already = await items.findOne({
      $or: [{ 'branch_access.branch_id': target }, { branch_id: target }],
      license,
    });
    if (already) {
      return { status: false, message: 'That branch already has items - nothing was copied' };
    }

    const maps = {};
    for (const lookup of LOOKUPS) {
      maps[lookup.collection] = await copyLookup(db, lookup.collection, {
        source,
        target,
        targetName: options.targetBranchName || '',
        license,
        stamp,
      });
    }

    /*
     * STREAMED, not loaded.
     *
     * The writes were already batched at 500 for the obvious reason; reading
     * the whole catalogue with .toArray() and then building a second full array
     * of copies undid that on the way in - two copies of a shop's entire item
     * list resident at once, on a process shared with every other shop.
     *
     * A cursor holds one batch. The transform is the same work, done per row as
     * it arrives instead of per array afterwards.
     */
    const shape = (row) => {
      const { _id, ...rest } = row;
      const doc = {
        ...rest,
        _id: new ObjectId(),
        branch_id: target,
        branch_name: options.targetBranchName || '',
        /* branch_access is the canonical item-to-branch relation, and it names
           the NEW branch alone. Carrying the source's entry across would make
           this copy visible from the shop it was copied from - two rows for one
           product on that shop's list, which is the duplication this whole
           feature is meant to avoid. */
        branch_access: [{ branch_id: target, branch_name: options.targetBranchName || '' }],
        ...stamp,
      };
      for (const field of STOCK_FIELDS) {
        if (doc[field] !== undefined) doc[field] = 0;
      }
      for (const lookup of LOOKUPS) {
        const map = maps[lookup.collection];
        const current = doc[lookup.itemIdField];
        if (!current) continue;
        const mapped = map.get(String(current));
        /* No mapping means the source item pointed at something that is not
           there any more. Clearing it is the honest outcome: a dangling id
           renders as a blank the shop can fix, while keeping it points at a
           record this branch cannot read and never will. */
        doc[lookup.itemIdField] = mapped || null;
        if (!mapped && lookup.itemNameField) doc[lookup.itemNameField] = '';
      }
      return doc;
    };

    const cursor = items.find({
      $or: [{ 'branch_access.branch_id': source }, { branch_id: source }],
      license,
      is_deleted: { $ne: true },
    });

    let written = 0;
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await items.insertMany(batch, { ordered: false });
      written += batch.length;
      batch = [];
    };

    for await (const row of cursor) {
      batch.push(shape(row));
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    if (!written) {
      return {
        status: true,
        data: { items: 0, categories: maps.categories.size, message: 'That shop has no items yet' },
      };
    }

    return {
      status: true,
      data: {
        items: written,
        categories: maps.categories.size,
        units: maps.unit.size,
        taxes: maps.grouptax.size,
      },
    };
  } catch (error) {
    console.error('Error in copyCatalogue:', error);
    return { status: false, message: error.message };
  }
}

module.exports = { copyCatalogue, LOOKUPS, STOCK_FIELDS, BATCH };
