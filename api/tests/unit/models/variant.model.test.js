'use strict';

/**
 * Unit tests for src/models/variant.model.js
 *
 * File confirmed : src/models/variant.model.js (98 lines)
 * Related files  :
 *   - src/controllers/variants.controller.js    — active consumer
 *   - src/controllers/variants-v2.controller.js — v2 controller (uses same model via repository)
 *   - src/services/variants.service.js          — active consumer
 *   - src/repositories/variants.repository.js   — active consumer
 *   - src/routes/variants.routes.js             — active consumer
 *   - src/middleware/variants.validation.js     — active consumer
 *   - src/constants/variants.constants.js       — constants file
 *   - variants.model.js    — does NOT exist
 *   - variant-v2.model.js  — does NOT exist (v2 controller uses same model)
 *   - variants-v2.model.js — does NOT exist
 *   - variant.schema.js    — does NOT exist
 *   - variant.model.ts     — does NOT exist
 *
 * ORM       : Mongoose
 * Framework : Jest (pre-configured)
 * Strategy  : Pure schema inspection via schema.path() + doc.validateSync() +
 *             pre-save hook extraction. No DB connection. No mongodb-memory-server.
 *             Follows the same pattern as other model tests in this project.
 *
 * Model classification:
 *   variant.model.js = Mongoose schema model (NOT a query/data-access helper)
 *   No separate legacy model exists for variants — this IS the active model.
 *
 * Schema structure:
 *   variantFieldSchema (subdocument, _id:false):
 *     name: String, required, trim
 *
 *   variantSchema (main):
 *     branch_id    : ObjectId, ref "Branch", optional
 *     branch_name  : String, trim, optional
 *     name         : String, required, trim
 *     fields       : Array of variantFieldSchema, default []
 *     description  : String, trim, optional
 *     created_date : Date, default Date.now
 *     updated_date : Date, default Date.now
 *     created_by_id: ObjectId, ref "User", optional
 *     created_by   : String, trim, optional
 *     updated_by_id: ObjectId, ref "User", optional
 *     updated_by   : String, trim, optional
 *     license      : ObjectId, ref "License", optional
 *     timestamps   : FALSE (uses custom created_date/updated_date, NOT Mongoose auto timestamps)
 *     toJSON       : { virtuals: true }
 *     toObject     : { virtuals: true }
 *
 * Pre-save hook (1):
 *   Sets updated_date = new Date(), initializes created_date if not already set
 *
 * Compound index: { name: 1, branch_id: 1 } — faster lookups (NOT unique)
 *
 * Key differences from other models:
 *   - NO toJSON/paginate plugins (supplier.model.js has them)
 *   - NO timestamps:true (token.model.js has it) — uses manual created_date/updated_date
 *   - NO static methods, NO instance methods
 *   - NO enum constraints on any field
 *   - Has a subdocument array (fields) for variant option values e.g. [Small, Medium, Large]
 *
 * NOT present in this model (by design — PHP legacy shape):
 *   - SKU/barcode fields (stored on item, not variant)
 *   - Price/cost fields
 *   - Stock/inventory fields
 *   - Status/isActive field
 *   - Soft delete field
 *   - Item/product reference (variants are standalone, linked by item's variant references)
 *   - Category reference
 *   - Tax fields
 */

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const VariantModel = require('../../../src/models/variant.model');

// ─── Schema shortcuts ─────────────────────────────────────────────────────────

const schema = VariantModel.schema;
const p = (field) => schema.path(field);
const fieldSchema = schema.path('fields').schema;
const pf = (field) => fieldSchema.path(field);

// ─── Helper ───────────────────────────────────────────────────────────────────

function validData(overrides = {}) {
  return {
    name: 'Size',
    ...overrides,
  };
}

// ─── Pre-save hook extractor ──────────────────────────────────────────────────

function getPreSaveHook() {
  const pres = schema.s.hooks._pres.get('save') || [];
  return pres
    .map((h) => h.fn)
    .filter(Boolean)
    .find((fn) => fn.toString().includes('updated_date'));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — model identity', () => {
  test('VariantModel.modelName is "Variant"', () => {
    expect(VariantModel.modelName).toBe('Variant');
  });

  test('VariantModel.schema is a Mongoose Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('VariantModel is a constructor function', () => {
    expect(typeof VariantModel).toBe('function');
  });

  test('new VariantModel() creates a Mongoose Document', () => {
    expect(new VariantModel(validData())).toBeInstanceOf(mongoose.Document);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. variantFieldSchema — subdocument (fields array items)
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — variantFieldSchema (fields subdocument)', () => {
  test('fields path is an Array', () => {
    expect(p('fields').instance).toBe('Array');
  });

  test('fields subdocument schema is a Mongoose Schema', () => {
    expect(fieldSchema).toBeInstanceOf(mongoose.Schema);
  });

  test('fields[].name has instance type "String"', () => {
    expect(pf('name').instance).toBe('String');
  });

  test('fields[].name is required', () => {
    expect(pf('name').isRequired).toBe(true);
  });

  test('fields[].name has trim:true', () => {
    expect(pf('name').options.trim).toBe(true);
  });

  test('fields subdocument has _id:false (no _id on each value)', () => {
    expect(fieldSchema.options._id).toBe(false);
  });

  test('document instance stores fields array correctly', () => {
    const doc = new VariantModel(
      validData({
        fields: [{ name: 'Small' }, { name: 'Medium' }, { name: 'Large' }],
      })
    );
    expect(doc.fields).toHaveLength(3);
    expect(doc.fields[0].name).toBe('Small');
    expect(doc.fields[2].name).toBe('Large');
  });

  test('fields defaults to empty array when omitted', () => {
    expect(new VariantModel(validData()).fields).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. name field
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — name field', () => {
  test('name has instance type "String"', () => {
    expect(p('name').instance).toBe('String');
  });

  test('name is required', () => {
    expect(p('name').isRequired).toBe(true);
  });

  test('name has trim:true', () => {
    expect(p('name').options.trim).toBe(true);
  });

  test('document instance stores name correctly', () => {
    expect(new VariantModel(validData({ name: 'Color' })).name).toBe('Color');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. description field
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — description field', () => {
  test('description has instance type "String"', () => {
    expect(p('description').instance).toBe('String');
  });

  test('description is optional (not required)', () => {
    expect(p('description').isRequired).toBeFalsy();
  });

  test('description has trim:true', () => {
    expect(p('description').options.trim).toBe(true);
  });

  test('variant can be created without description', () => {
    const doc = new VariantModel(validData());
    expect(doc.description).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. branch_id and branch_name fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — branch_id and branch_name fields', () => {
  test('branch_id has instance type "ObjectId"', () => {
    expect(p('branch_id').instance).toBe('ObjectId');
  });

  test('branch_id has ref "Branch"', () => {
    expect(p('branch_id').options.ref).toBe('Branch');
  });

  test('branch_id is optional', () => {
    expect(p('branch_id').isRequired).toBeFalsy();
  });

  test('branch_name has instance type "String" with trim', () => {
    expect(p('branch_name').instance).toBe('String');
    expect(p('branch_name').options.trim).toBe(true);
  });

  test('branch_name is optional', () => {
    expect(p('branch_name').isRequired).toBeFalsy();
  });

  test('document instance stores branch_id correctly', () => {
    const branchId = new mongoose.Types.ObjectId();
    const doc = new VariantModel(validData({ branch_id: branchId, branch_name: 'Main Branch' }));
    expect(doc.branch_id.toString()).toBe(branchId.toString());
    expect(doc.branch_name).toBe('Main Branch');
  });

  test('variant can be created without branch_id (global variant)', () => {
    const doc = new VariantModel(validData());
    expect(doc.branch_id).toBeUndefined();
    expect(doc.branch_name).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. created_date and updated_date fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — created_date and updated_date fields', () => {
  test('created_date has instance type "Date"', () => {
    expect(p('created_date').instance).toBe('Date');
  });

  test('created_date has a default (Date.now)', () => {
    expect(p('created_date').defaultValue).toBeDefined();
  });

  test('updated_date has instance type "Date"', () => {
    expect(p('updated_date').instance).toBe('Date');
  });

  test('updated_date has a default (Date.now)', () => {
    expect(p('updated_date').defaultValue).toBeDefined();
  });

  test('document instance populates created_date and updated_date by default', () => {
    const before = Date.now();
    const doc = new VariantModel(validData());
    expect(doc.created_date).toBeInstanceOf(Date);
    expect(doc.updated_date).toBeInstanceOf(Date);
    expect(doc.created_date.getTime()).toBeGreaterThanOrEqual(before - 10);
  });

  test('schema has timestamps:false (no auto createdAt/updatedAt fields)', () => {
    expect(schema.options.timestamps).toBe(false);
    expect(p('createdAt')).toBeUndefined();
    expect(p('updatedAt')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Audit fields — created_by, created_by_id, updated_by, updated_by_id
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — audit fields', () => {
  test('created_by_id is ObjectId with ref "User", optional', () => {
    expect(p('created_by_id').instance).toBe('ObjectId');
    expect(p('created_by_id').options.ref).toBe('User');
    expect(p('created_by_id').isRequired).toBeFalsy();
  });

  test('created_by is String with trim, optional', () => {
    expect(p('created_by').instance).toBe('String');
    expect(p('created_by').options.trim).toBe(true);
    expect(p('created_by').isRequired).toBeFalsy();
  });

  test('updated_by_id is ObjectId with ref "User", optional', () => {
    expect(p('updated_by_id').instance).toBe('ObjectId');
    expect(p('updated_by_id').options.ref).toBe('User');
    expect(p('updated_by_id').isRequired).toBeFalsy();
  });

  test('updated_by is String with trim, optional', () => {
    expect(p('updated_by').instance).toBe('String');
    expect(p('updated_by').options.trim).toBe(true);
    expect(p('updated_by').isRequired).toBeFalsy();
  });

  test('document instance stores audit fields correctly', () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = new VariantModel(
      validData({
        created_by_id: userId,
        created_by: 'admin',
        updated_by_id: userId,
        updated_by: 'admin',
      })
    );
    expect(doc.created_by_id.toString()).toBe(userId.toString());
    expect(doc.created_by).toBe('admin');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. license field
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — license field', () => {
  test('license has instance type "ObjectId"', () => {
    expect(p('license').instance).toBe('ObjectId');
  });

  test('license has ref "License"', () => {
    expect(p('license').options.ref).toBe('License');
  });

  test('license is optional', () => {
    expect(p('license').isRequired).toBeFalsy();
  });

  test('document instance stores license ObjectId correctly', () => {
    const licenseId = new mongoose.Types.ObjectId();
    const doc = new VariantModel(validData({ license: licenseId }));
    expect(doc.license.toString()).toBe(licenseId.toString());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. toJSON / toObject virtuals option
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — toJSON / toObject options', () => {
  test('schema.options.toJSON.virtuals is true', () => {
    expect(schema.options.toJSON.virtuals).toBe(true);
  });

  test('schema.options.toObject.virtuals is true', () => {
    expect(schema.options.toObject.virtuals).toBe(true);
  });

  test('schema does NOT have the toJSON plugin transform (no _id→id conversion)', () => {
    expect(schema.options.toJSON.transform).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Pre-save hook — updated_date and created_date management
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — pre-save hook', () => {
  let preSaveHook;
  let mockNext;

  beforeEach(() => {
    preSaveHook = getPreSaveHook();
    mockNext = jest.fn();
  });

  test('pre-save hook exists in the schema', () => {
    expect(preSaveHook).toBeDefined();
    expect(typeof preSaveHook).toBe('function');
  });

  test('sets updated_date to current time on every save', () => {
    const before = Date.now();
    const mockDoc = { updated_date: null, created_date: new Date('2020-01-01') };
    preSaveHook.call(mockDoc);
    expect(mockDoc.updated_date).toBeInstanceOf(Date);
    expect(mockDoc.updated_date.getTime()).toBeGreaterThanOrEqual(before - 10);
  });

  test('initializes created_date when it is not already set', () => {
    const mockDoc = { updated_date: null, created_date: null };
    preSaveHook.call(mockDoc, mockNext);
    expect(mockDoc.created_date).toBe(mockDoc.updated_date);
  });

  test('does NOT override created_date if it is already set', () => {
    const originalCreatedDate = new Date('2022-06-01');
    const mockDoc = { updated_date: null, created_date: originalCreatedDate };
    preSaveHook.call(mockDoc, mockNext);
    expect(mockDoc.created_date).toBe(originalCreatedDate);
  });

  /* Mongoose 9 dropped next() from middleware; a hook that returns has done
     its job. What is worth asserting is the field it sets. */
  test('returns without throwing, having set updated_date', () => {
    const doc = { updated_date: null, created_date: new Date() };
    expect(() => preSaveHook.call(doc)).not.toThrow();
    expect(doc.updated_date).toBeInstanceOf(Date);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. validateSync — required field checks
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — validateSync required field checks', () => {
  test('validateSync returns undefined when name is provided (valid)', () => {
    expect(new VariantModel(validData()).validateSync()).toBeUndefined();
  });

  test('validateSync reports error when name is missing', () => {
    const doc = new VariantModel(validData({ name: undefined }));
    const err = doc.validateSync();
    expect(err?.errors).toHaveProperty('name');
  });

  test('validateSync reports error when a fields item has no name', () => {
    const doc = new VariantModel(validData({ fields: [{}] }));
    const err = doc.validateSync();
    expect(err?.errors).toBeDefined();
  });

  test('validateSync passes when fields items all have names', () => {
    const doc = new VariantModel(
      validData({
        fields: [{ name: 'Small' }, { name: 'Large' }],
      })
    );
    expect(doc.validateSync()).toBeUndefined();
  });

  test('all other top-level fields are optional — minimal document is valid', () => {
    const doc = new VariantModel({ name: 'Material' });
    expect(doc.validateSync()).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Schema indexes
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — schema indexes', () => {
  test('schema has a compound index on { name:1, branch_id:1 }', () => {
    const indexes = schema.indexes();
    const compoundIdx = indexes.find(([fields]) => fields.name === 1 && fields.branch_id === 1);
    expect(compoundIdx).toBeDefined();
  });

  test('compound index on name+branch_id is NOT unique', () => {
    const indexes = schema.indexes();
    const compoundIdx = indexes.find(([fields]) => fields.name === 1 && fields.branch_id === 1);
    expect(compoundIdx?.[1]?.unique).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. No plugins, static methods, or instance methods
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — no plugins, statics, or instance methods', () => {
  test('schema has no custom static methods', () => {
    expect(Object.keys(schema.statics)).toHaveLength(0);
  });

  test('schema has no custom instance methods', () => {
    const mongooseInternals = ['initializeTimestamps'];
    const custom = Object.keys(schema.methods).filter((m) => !mongooseInternals.includes(m));
    expect(custom).toHaveLength(0);
  });

  test('VariantModel does not have paginate static method (no paginate plugin)', () => {
    expect(VariantModel.paginate).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. Document instance — defaults and field storage
// ══════════════════════════════════════════════════════════════════════════════
describe('Variant — document instance defaults and storage', () => {
  let doc;
  beforeEach(() => {
    doc = new VariantModel(validData());
  });

  test('new VariantModel gets an _id automatically', () => {
    expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('fields defaults to empty array', () => {
    expect(doc.fields).toEqual([]);
  });

  test('created_date is set by default', () => {
    expect(doc.created_date).toBeInstanceOf(Date);
  });

  test('updated_date is set by default', () => {
    expect(doc.updated_date).toBeInstanceOf(Date);
  });

  test('stores a complete variant with fields correctly', () => {
    const full = new VariantModel(
      validData({
        name: 'Flavour',
        description: 'Available flavour options',
        fields: [{ name: 'Chocolate' }, { name: 'Vanilla' }, { name: 'Strawberry' }],
      })
    );
    expect(full.name).toBe('Flavour');
    expect(full.description).toBe('Available flavour options');
    expect(full.fields).toHaveLength(3);
    expect(full.fields.map((f) => f.name)).toEqual(['Chocolate', 'Vanilla', 'Strawberry']);
  });
});
