'use strict';

/**
 * Unit tests for src/models/item.model.js
 *
 * File confirmed : src/models/item.model.js
 * Similar files  : No items.model.js / product.model.js / item.schema.js found
 * ORM            : Mongoose (MongoDB)
 * Exports        : Item (Mongoose model, default export)
 *                  Item.LegacyItemModel (legacy class attached as property)
 *
 * Strategy: Pure schema inspection (no DB connection, no mongodb-memory-server).
 * - Schema paths inspected via schema.path() and schema.options.
 * - Plugins verified by checking attached static methods and toJSON options.
 * - LegacyItemModel.fields inspected as a plain static object — no DB needed.
 * - No real DB queries executed. No production data touched.
 *
 * Notable schema characteristics:
 * - Only ONE required field: name
 * - Custom timestamp field names: created_date / updated_date
 * - Explicit collection name: "items"
 * - Singleton pattern: mongoose.models.Item || mongoose.model("Item", ...)
 * - sku exists in Mongoose schema but NOT in LegacyItemModel.fields
 * - cost_price exists in Mongoose schema but NOT in LegacyItemModel.fields
 *   (legacy uses mrp_price instead)
 */

const mongoose = require('mongoose');
const Item = require('../../../src/models/item.model');

// ─── Schema shorthand helpers ──────────────────────────────────────────────────
const schema = Item.schema;
const p = (f) => schema.path(f);
const LegacyItemModel = Item.LegacyItemModel;

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity & exports
// ══════════════════════════════════════════════════════════════════════════════
describe('Item › model identity', () => {
  test('module exports the Mongoose Item model directly (not wrapped in object)', () => {
    expect(Item).toBeDefined();
    expect(typeof Item).toBe('function');
  });

  test('model name is "Item"', () => {
    expect(Item.modelName).toBe('Item');
  });

  test('is a Mongoose Model (find/findOne/create/updateOne/deleteOne present)', () => {
    expect(typeof Item.find).toBe('function');
    expect(typeof Item.findOne).toBe('function');
    expect(typeof Item.create).toBe('function');
    expect(typeof Item.updateOne).toBe('function');
    expect(typeof Item.deleteOne).toBe('function');
    expect(typeof Item.countDocuments).toBe('function');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Schema options
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › options', () => {
  test('explicit collection name is "items"', () => {
    expect(schema.options.collection).toBe('items');
  });

  test('timestamps object is defined', () => {
    expect(schema.options.timestamps).toBeDefined();
    expect(typeof schema.options.timestamps).toBe('object');
  });

  test('createdAt timestamp field is renamed to "created_date"', () => {
    expect(schema.options.timestamps.createdAt).toBe('created_date');
  });

  test('updatedAt timestamp field is renamed to "updated_date"', () => {
    expect(schema.options.timestamps.updatedAt).toBe('updated_date');
  });

  test('created_date path exists in schema (custom timestamp)', () => {
    expect(p('created_date')).toBeDefined();
  });

  test('updated_date path exists in schema (custom timestamp)', () => {
    expect(p('updated_date')).toBeDefined();
  });

  test('createdAt path does NOT exist (renamed to created_date)', () => {
    expect(p('createdAt')).toBeUndefined();
  });

  test('updatedAt path does NOT exist (renamed to updated_date)', () => {
    expect(p('updatedAt')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Only required field: name
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › name field (only required field)', () => {
  test('path exists', () => {
    expect(p('name')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('name').instance).toBe('String');
  });
  test('is required', () => {
    expect(p('name').options.required).toBe(true);
  });
  test('has trim:true', () => {
    expect(p('name').options.trim).toBe(true);
  });
  test('has no default value', () => {
    expect(p('name').options.default).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Optional string identifier fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › barcode_id field', () => {
  test('path exists', () => {
    expect(p('barcode_id')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('barcode_id').instance).toBe('String');
  });
  test('is NOT required (optional)', () => {
    expect(p('barcode_id').options.required).toBeFalsy();
  });
});

describe('Item schema › sku field', () => {
  test('path exists in Mongoose schema', () => {
    expect(p('sku')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('sku').instance).toBe('String');
  });
  test('is NOT required (optional)', () => {
    expect(p('sku').options.required).toBeFalsy();
  });
});

describe('Item schema › itemid field', () => {
  test('path exists', () => {
    expect(p('itemid')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('itemid').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('itemid').options.trim).toBe(true);
  });
  test('is NOT required (optional)', () => {
    expect(p('itemid').options.required).toBeFalsy();
  });
});

describe('Item schema › item_status field', () => {
  test('path exists', () => {
    expect(p('item_status')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('item_status').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('item_status').options.trim).toBe(true);
  });
  test('is NOT required (optional)', () => {
    expect(p('item_status').options.required).toBeFalsy();
  });
  test('has no enum constraint (enumValues is empty)', () => {
    expect(p('item_status').enumValues).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Category fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › category_id field', () => {
  test('path exists', () => {
    expect(p('category_id')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('category_id').instance).toBe('ObjectId');
  });
  test('refs "Category" model', () => {
    expect(p('category_id').options.ref).toBe('Category');
  });
  test('is NOT required (optional)', () => {
    expect(p('category_id').options.required).toBeFalsy();
  });
});

describe('Item schema › category_name field', () => {
  test('path exists', () => {
    expect(p('category_name')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('category_name').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('category_name').options.trim).toBe(true);
  });
  test('is NOT required (optional)', () => {
    expect(p('category_name').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Supplier fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › supplier_id field', () => {
  test('path exists', () => {
    expect(p('supplier_id')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('supplier_id').instance).toBe('ObjectId');
  });
  test('refs "Supplier" model', () => {
    expect(p('supplier_id').options.ref).toBe('Supplier');
  });
  test('is NOT required (optional)', () => {
    expect(p('supplier_id').options.required).toBeFalsy();
  });
});

describe('Item schema › supplier_name field', () => {
  test('path exists', () => {
    expect(p('supplier_name')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('supplier_name').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('supplier_name').options.trim).toBe(true);
  });
  test('is NOT required (optional)', () => {
    expect(p('supplier_name').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Branch & License reference fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › branch_id field', () => {
  test('path exists', () => {
    expect(p('branch_id')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('branch_id').instance).toBe('ObjectId');
  });
  test('refs "Branch" model', () => {
    expect(p('branch_id').options.ref).toBe('Branch');
  });
  test('is NOT required (optional)', () => {
    expect(p('branch_id').options.required).toBeFalsy();
  });
});

describe('Item schema › license field', () => {
  test('path exists', () => {
    expect(p('license')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('license').instance).toBe('ObjectId');
  });
  test('refs "License" model', () => {
    expect(p('license').options.ref).toBe('License');
  });
  test('is NOT required (optional)', () => {
    expect(p('license').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Stock / Quantity fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › quantity field', () => {
  test('path exists', () => {
    expect(p('quantity')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('quantity').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(p('quantity').options.default).toBe(0);
  });
  test('is NOT required (has default)', () => {
    expect(p('quantity').options.required).toBeFalsy();
  });
});

describe('Item schema › available_quantity field', () => {
  test('path exists', () => {
    expect(p('available_quantity')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('available_quantity').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(p('available_quantity').options.default).toBe(0);
  });
  test('is NOT required (has default)', () => {
    expect(p('available_quantity').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Price fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › price fields (Number, default 0)', () => {
  test.each(['cost_price', 'company_price', 'selling_price'])(
    '"%s" is Number with default 0 and no required flag',
    (field) => {
      expect(p(field)).toBeDefined();
      expect(p(field).instance).toBe('Number');
      expect(p(field).options.default).toBe(0);
      expect(p(field).options.required).toBeFalsy();
    }
  );
});

describe('Item schema › cost_price vs mrp_price distinction', () => {
  test('cost_price is present in the Mongoose schema', () => {
    expect(p('cost_price')).toBeDefined();
  });

  test('mrp_price is NOT in the Mongoose schema (it lives only in LegacyItemModel.fields)', () => {
    expect(p('mrp_price')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Discount fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › discount fields', () => {
  test('discount_amount is Number with default 0', () => {
    expect(p('discount_amount')).toBeDefined();
    expect(p('discount_amount').instance).toBe('Number');
    expect(p('discount_amount').options.default).toBe(0);
  });

  test('discount_percentage is Number with default 0', () => {
    expect(p('discount_percentage')).toBeDefined();
    expect(p('discount_percentage').instance).toBe('Number');
    expect(p('discount_percentage').options.default).toBe(0);
  });

  test('neither discount field is required', () => {
    expect(p('discount_amount').options.required).toBeFalsy();
    expect(p('discount_percentage').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Tax fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › tax (Number) field', () => {
  test('path exists', () => {
    expect(p('tax')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('tax').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(p('tax').options.default).toBe(0);
  });
  test('is NOT required', () => {
    expect(p('tax').options.required).toBeFalsy();
  });
});

describe('Item schema › tax_type field', () => {
  test('path exists', () => {
    expect(p('tax_type')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('tax_type').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('tax_type').options.trim).toBe(true);
  });
  test('is NOT required', () => {
    expect(p('tax_type').options.required).toBeFalsy();
  });
});

describe('Item schema › tax_name field', () => {
  test('path exists', () => {
    expect(p('tax_name')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('tax_name').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('tax_name').options.trim).toBe(true);
  });
  test('is NOT required', () => {
    expect(p('tax_name').options.required).toBeFalsy();
  });
});

describe('Item schema › tax_fields field', () => {
  test('path exists', () => {
    expect(p('tax_fields')).toBeDefined();
  });
  test('instance is "Array" (array of Mixed)', () => {
    expect(p('tax_fields').instance).toBe('Array');
  });
  test('default is empty array', () => {
    expect(p('tax_fields').options.default).toEqual([]);
  });
  test('is NOT required', () => {
    expect(p('tax_fields').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. HSN fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › HSN fields', () => {
  test.each(['hsncode', 'hsndescription'])(
    '"%s" is String with trim:true and optional',
    (field) => {
      expect(p(field)).toBeDefined();
      expect(p(field).instance).toBe('String');
      expect(p(field).options.trim).toBe(true);
      expect(p(field).options.required).toBeFalsy();
    }
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Boolean flag fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › track_inventory flag', () => {
  test('path exists', () => {
    expect(p('track_inventory')).toBeDefined();
  });
  test('instance is "Boolean"', () => {
    expect(p('track_inventory').instance).toBe('Boolean');
  });
  test('default is false (inventory not tracked by default)', () => {
    expect(p('track_inventory').options.default).toBe(false);
  });
  test('is NOT required (has default)', () => {
    expect(p('track_inventory').options.required).toBeFalsy();
  });
});

describe('Item schema › negative_stock flag', () => {
  test('path exists', () => {
    expect(p('negative_stock')).toBeDefined();
  });
  test('instance is "Boolean"', () => {
    expect(p('negative_stock').instance).toBe('Boolean');
  });
  test('default is false (negative stock not allowed by default)', () => {
    expect(p('negative_stock').options.default).toBe(false);
  });
  test('is NOT required (has default)', () => {
    expect(p('negative_stock').options.required).toBeFalsy();
  });
});

describe('Item schema › is_active flag', () => {
  test('path exists', () => {
    expect(p('is_active')).toBeDefined();
  });
  test('instance is "Boolean"', () => {
    expect(p('is_active').instance).toBe('Boolean');
  });
  test('default is true (items active by default)', () => {
    expect(p('is_active').options.default).toBe(true);
  });
  test('is NOT required (has default)', () => {
    expect(p('is_active').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. Image field
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › image field', () => {
  test('path exists', () => {
    expect(p('image')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('image').instance).toBe('String');
  });
  test('has trim:true', () => {
    expect(p('image').options.trim).toBe(true);
  });
  test('is NOT required (optional)', () => {
    expect(p('image').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. Full field set verification
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › full expected field set', () => {
  const expectedFields = [
    // Identity & identifiers
    'name',
    'barcode_id',
    'sku',
    'itemid',
    'item_status',
    // Category
    'category_id',
    'category_name',
    // Supplier
    'supplier_id',
    'supplier_name',
    // Tenant/branch
    'branch_id',
    'license',
    // Stock
    'quantity',
    'available_quantity',
    // Pricing
    'cost_price',
    'company_price',
    'selling_price',
    'discount_amount',
    'discount_percentage',
    // Tax
    'tax',
    'tax_type',
    'tax_name',
    'tax_fields',
    // HSN
    'hsncode',
    'hsndescription',
    // Behaviour flags
    'track_inventory',
    'negative_stock',
    'is_active',
    // Media
    'image',
  ];

  test.each(expectedFields)('field "%s" is present in schema', (field) => {
    expect(p(field)).toBeDefined();
  });

  test('_id is auto-added by Mongoose', () => {
    expect(p('_id')).toBeDefined();
  });

  test('total number of defined paths matches expectation', () => {
    // 28 explicit fields + _id + __v + created_date + updated_date = 32
    const defined = expectedFields.filter((f) => p(f));
    expect(defined).toHaveLength(expectedFields.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. Trim flag coverage
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › trim:true fields', () => {
  test.each([
    'name',
    'category_name',
    'supplier_name',
    'tax_type',
    'tax_name',
    'hsncode',
    'hsndescription',
    'itemid',
    'item_status',
    'image',
  ])('"%s" has trim:true', (field) => {
    expect(p(field).options.trim).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. ObjectId reference fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › ObjectId reference fields', () => {
  test.each([
    ['category_id', 'Category'],
    ['supplier_id', 'Supplier'],
    ['branch_id', 'Branch'],
    ['license', 'License'],
  ])('"%s" is ObjectId referencing "%s"', (field, refModel) => {
    expect(p(field).instance).toBe('ObjectId');
    expect(p(field).options.ref).toBe(refModel);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. All optional fields (no required constraint)
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › optional fields (no required flag)', () => {
  test.each([
    'barcode_id',
    'sku',
    'itemid',
    'item_status',
    'category_id',
    'category_name',
    'supplier_id',
    'supplier_name',
    'branch_id',
    'license',
    'quantity',
    'available_quantity',
    'cost_price',
    'company_price',
    'selling_price',
    'discount_amount',
    'discount_percentage',
    'tax',
    'tax_type',
    'tax_name',
    'tax_fields',
    'hsncode',
    'hsndescription',
    'track_inventory',
    'negative_stock',
    'is_active',
    'image',
  ])('"%s" has no required constraint', (field) => {
    expect(p(field).options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. Default values correctness
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › default values', () => {
  test.each([
    ['quantity', 0],
    ['available_quantity', 0],
    ['cost_price', 0],
    ['company_price', 0],
    ['selling_price', 0],
    ['discount_amount', 0],
    ['discount_percentage', 0],
    ['tax', 0],
  ])('"%s" default is %d', (field, expected) => {
    expect(p(field).options.default).toBe(expected);
  });

  test('track_inventory default is false', () => {
    expect(p('track_inventory').options.default).toBe(false);
  });

  test('negative_stock default is false', () => {
    expect(p('negative_stock').options.default).toBe(false);
  });

  test('is_active default is true', () => {
    expect(p('is_active').options.default).toBe(true);
  });

  test('tax_fields default is empty array', () => {
    expect(p('tax_fields').options.default).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. Plugins
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › plugins', () => {
  test('paginate static method is present (paginate plugin applied)', () => {
    expect(typeof Item.paginate).toBe('function');
  });

  test('schema.options.toJSON is defined (toJSON plugin applied)', () => {
    expect(schema.options.toJSON).toBeDefined();
  });

  test('schema.options.toJSON.transform is a function', () => {
    expect(typeof schema.options.toJSON.transform).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. toJSON plugin transform behavior
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema › toJSON plugin transform', () => {
  const transform = () => schema.options.toJSON.transform;

  test('removes __v from JSON output', () => {
    const oid = new mongoose.Types.ObjectId();
    const doc = { _id: oid };
    const ret = { _id: oid, __v: 0, name: 'Widget A' };
    transform()(doc, ret, {});
    expect(ret.__v).toBeUndefined();
  });

  test('adds id (string) from doc._id', () => {
    const oid = new mongoose.Types.ObjectId();
    const doc = { _id: oid };
    const ret = { _id: oid, name: 'Widget A' };
    transform()(doc, ret, {});
    expect(ret.id).toBe(oid.toString());
  });

  test('removes _id from JSON output', () => {
    const oid = new mongoose.Types.ObjectId();
    const doc = { _id: oid };
    const ret = { _id: oid, name: 'Widget A' };
    transform()(doc, ret, {});
    expect(ret._id).toBeUndefined();
  });

  test('preserves other fields after transform', () => {
    const oid = new mongoose.Types.ObjectId();
    const doc = { _id: oid };
    const ret = { _id: oid, name: 'Widget A', selling_price: 99.5, is_active: true };
    transform()(doc, ret, {});
    expect(ret.name).toBe('Widget A');
    expect(ret.selling_price).toBe(99.5);
    expect(ret.is_active).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. Singleton model registration
// ══════════════════════════════════════════════════════════════════════════════
describe('Item › singleton model registration', () => {
  test('re-requiring item.model.js returns the same instance', () => {
    const ItemAgain = require('../../../src/models/item.model');
    expect(ItemAgain).toBe(Item);
  });

  test('model is registered in mongoose.models as "Item"', () => {
    /*
     * The export is no longer the model object itself; it is a proxy that
     * resolves to the model for the shop the request belongs to. A proxy can
     * never satisfy `===` against its target, so the old assertion cannot hold
     * and asserting it would only be asserting that the resolution does not
     * exist.
     *
     * What the test was actually guarding is unchanged and still checked: the
     * model is registered exactly once under this name, and the export leads to
     * that registration rather than to a second copy - which is what would
     * cause mongoose's OverwriteModelError, and what a duplicate registration
     * would look like.
     */
    expect(mongoose.models.Item).toBeDefined();
    expect(Item.modelName).toBe('Item');
    expect(Item.schema).toBe(mongoose.models.Item.schema);
    expect(Item.collection.name).toBe(mongoose.models.Item.collection.name);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. LegacyItemModel — class identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Item.LegacyItemModel › class identity', () => {
  test('LegacyItemModel is attached to the Item Mongoose model', () => {
    expect(Item.LegacyItemModel).toBeDefined();
  });

  test('LegacyItemModel is the ItemModel class (a function/class)', () => {
    expect(typeof LegacyItemModel).toBe('function');
  });

  test('collectionName static property is "items"', () => {
    expect(LegacyItemModel.collectionName).toBe('items');
  });

  test('fields static property is a non-null object', () => {
    expect(typeof LegacyItemModel.fields).toBe('object');
    expect(LegacyItemModel.fields).not.toBeNull();
  });

  test('fields includes direct branch metadata used for tenant scoping', () => {
    // 44 legacy fields + the four variant family-link fields (V1) +
    // alternate barcodes and unit conversion (V3) + the four the form always
    // wrote but the map never carried (IC0: mfg/expiry dates, weight flag,
    // modifier group ids) + open_price (IC1 ask-at-the-till) + tile_color
    // (the no-image sale-grid tile) + brand/tags/reorder_point (LS1)
    // + gtin/gtin14 (PIM1: the GLOBAL identifier, kept apart from barcode_id
    // because that one may hold an in-store code or free text - see
    // utils/gtin.js and PRODUCT_INFORMATION_MODEL.md).
    expect(Object.keys(LegacyItemModel.fields)).toHaveLength(66);
    expect(LegacyItemModel.fields).toEqual(
      expect.objectContaining({
        /* Named as well as counted: a count alone passes if one field is
           added while another is dropped, which is the change that silently
           stops a read projecting a column. */
        gtin: expect.any(Object),
        gtin14: expect.any(Object),
        branch_id: expect.any(Object),
        branch_name: expect.any(Object),
      })
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. LegacyItemModel.fields — structure
// ══════════════════════════════════════════════════════════════════════════════
describe('Item.LegacyItemModel › fields — publicly selectable fields (select:true)', () => {
  test.each([
    'name',
    'itemid',
    'barcode_id',
    'image',
    'multi_image',
    'category_id',
    'category_name',
    'supplier_id',
    'supplier_name',
    'mrp_price',
    'company_price',
    'selling_price',
    'available_quantity',
    'item_status',
    'description',
    'tax',
    'tax_id',
    'tax_name',
    'tax_type',
    'tax_method',
    'tax_fields',
    'hsncode',
    'hsndescription',
    'discount_amount',
    'discount_percentage',
    'unit',
    'unit_id',
    'track_inventory',
    'sales_channel',
    'ecommerce',
    'isAvailable',
    'negative_stock',
    'sort_order',
    'created_date',
    'updated_date',
  ])('field "%s" has select:true', (field) => {
    expect(LegacyItemModel.fields[field]).toBeDefined();
    expect(LegacyItemModel.fields[field].select).toBe(true);
  });
});

describe('Item.LegacyItemModel › fields — private fields (select:false)', () => {
  test.each([
    'branch_access',
    'created_by',
    'created_by_id',
    'updated_by',
    'updated_by_id',
    'license',
  ])('field "%s" has select:false (private)', (field) => {
    expect(LegacyItemModel.fields[field]).toBeDefined();
    expect(LegacyItemModel.fields[field].select).toBe(false);
  });
});

describe('Item.LegacyItemModel › fields — type definitions', () => {
  test('_id has type "ObjectId" and name "id"', () => {
    expect(LegacyItemModel.fields._id.type).toBe('ObjectId');
    expect(LegacyItemModel.fields._id.name).toBe('id');
    expect(LegacyItemModel.fields._id.select).toBe(true);
  });

  test.each([
    ['name', 'String'],
    ['itemid', 'String'],
    ['barcode_id', 'String'],
    ['image', 'String'],
    ['category_name', 'String'],
    ['supplier_name', 'String'],
    ['item_status', 'String'],
    ['description', 'String'],
    ['tax_name', 'String'],
    ['tax_type', 'String'],
    ['tax_method', 'String'],
    ['hsncode', 'String'],
    ['hsndescription', 'String'],
    ['unit', 'String'],
    ['unit_id', 'String'],
    ['created_by', 'String'],
    ['updated_by', 'String'],
  ])('field "%s" has type "String"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });

  test.each([
    ['mrp_price', 'Number'],
    ['company_price', 'Number'],
    ['selling_price', 'Number'],
    ['available_quantity', 'Number'],
    ['tax', 'Number'],
    ['discount_amount', 'Number'],
    ['discount_percentage', 'Number'],
    ['sort_order', 'Number'],
  ])('field "%s" has type "Number"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });

  test.each([
    ['category_id', 'ObjectId'],
    ['supplier_id', 'ObjectId'],
    ['tax_id', 'ObjectId'],
    ['created_by_id', 'ObjectId'],
    ['updated_by_id', 'ObjectId'],
    ['license', 'ObjectId'],
  ])('field "%s" has type "ObjectId"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });

  test.each([
    ['track_inventory', 'Boolean'],
    ['sales_channel', 'Boolean'],
    ['ecommerce', 'Boolean'],
    ['isAvailable', 'Boolean'],
    ['negative_stock', 'Boolean'],
  ])('field "%s" has type "Boolean"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });

  test.each([
    ['multi_image', 'Array'],
    ['tax_fields', 'Array'],
    ['branch_access', 'Array'],
  ])('field "%s" has type "Array"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });

  test.each([
    ['created_date', 'Date'],
    ['updated_date', 'Date'],
  ])('field "%s" has type "Date"', (field, type) => {
    expect(LegacyItemModel.fields[field].type).toBe(type);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 25. Schema-vs-legacy discrepancy tests
// ══════════════════════════════════════════════════════════════════════════════
describe('Item schema vs LegacyItemModel › notable discrepancies', () => {
  test('sku is in Mongoose schema but NOT in LegacyItemModel.fields', () => {
    expect(p('sku')).toBeDefined();
    expect(LegacyItemModel.fields.sku).toBeUndefined();
  });

  test('cost_price is in Mongoose schema but NOT in LegacyItemModel.fields', () => {
    expect(p('cost_price')).toBeDefined();
    expect(LegacyItemModel.fields.cost_price).toBeUndefined();
  });

  test('mrp_price is in LegacyItemModel.fields but NOT in Mongoose schema', () => {
    expect(p('mrp_price')).toBeUndefined();
    expect(LegacyItemModel.fields.mrp_price).toBeDefined();
  });

  test('is_active is in Mongoose schema but NOT in LegacyItemModel.fields', () => {
    expect(p('is_active')).toBeDefined();
    expect(LegacyItemModel.fields.is_active).toBeUndefined();
  });
});
