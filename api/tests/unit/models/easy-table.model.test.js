'use strict';

/**
 * Unit tests for src/models/easy-table.model.js
 *
 * File confirmed: src/models/easy-table.model.js  (only easy-table model — no duplicates)
 * Type: Mongoose Schema Model — uses mongoose directly (NOT BaseModel / native driver)
 *
 * Strategy: Pure schema inspection tests
 *   - No real DB connection, no mongodb-memory-server.
 *   - The Mongoose model is loaded, and its schema paths / options / indexes
 *     are inspected directly — exactly the same pattern used for category.model.test.js.
 *   - No mock required: Mongoose registers the schema synchronously without connecting.
 *
 * Schema summary:
 *   tableNumber  String  required unique trim
 *   capacity     Number  required min:1
 *   status       String  enum default:'available'
 *   location     String  trim (optional)
 *   description  String  trim (optional)
 *   + timestamps (createdAt / updatedAt)
 *   + toJSON / toObject virtuals:true
 */

const mongoose = require('mongoose');
const EasyTable = require('../../../src/models/easy-table.model');

const schema = EasyTable.schema;
const paths = schema.paths;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Module exports
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — module exports', () => {
  test('exports a Mongoose Model (constructor)', () => {
    expect(typeof EasyTable).toBe('function');
  });

  test('model name is "EasyTable"', () => {
    expect(EasyTable.modelName).toBe('EasyTable');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. tableNumber field
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema field: tableNumber', () => {
  const field = () => paths.tableNumber;

  test('field exists in schema', () => {
    expect(field()).toBeDefined();
  });

  test('type is String (instance = "String")', () => {
    expect(field().instance).toBe('String');
  });

  test('is required', () => {
    expect(field().isRequired).toBe(true);
  });

  test('has trim:true', () => {
    expect(field().options.trim).toBe(true);
  });

  test('has unique:true on the field definition', () => {
    expect(field().options.unique).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. capacity field
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema field: capacity', () => {
  const field = () => paths.capacity;

  test('field exists in schema', () => {
    expect(field()).toBeDefined();
  });

  test('type is Number (instance = "Number")', () => {
    expect(field().instance).toBe('Number');
  });

  test('is required', () => {
    expect(field().isRequired).toBe(true);
  });

  test('has min:1', () => {
    expect(field().options.min).toBe(1);
  });

  test('has no default value', () => {
    expect(field().defaultValue).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. status field
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema field: status', () => {
  const field = () => paths.status;

  test('field exists in schema', () => {
    expect(field()).toBeDefined();
  });

  test('type is String', () => {
    expect(field().instance).toBe('String');
  });

  test('is NOT required (optional)', () => {
    expect(field().isRequired).toBeFalsy();
  });

  test('default is "available"', () => {
    expect(field().defaultValue).toBe('available');
  });

  test('enum contains all four expected values', () => {
    const enumVals = field().enumValues;
    expect(enumVals).toEqual(
      expect.arrayContaining(['available', 'occupied', 'reserved', 'out_of_service'])
    );
    expect(enumVals).toHaveLength(4);
  });

  test('enum contains "available"', () => {
    expect(field().enumValues).toContain('available');
  });

  test('enum contains "occupied"', () => {
    expect(field().enumValues).toContain('occupied');
  });

  test('enum contains "reserved"', () => {
    expect(field().enumValues).toContain('reserved');
  });

  test('enum contains "out_of_service"', () => {
    expect(field().enumValues).toContain('out_of_service');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. location field
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema field: location', () => {
  const field = () => paths.location;

  test('field exists in schema', () => {
    expect(field()).toBeDefined();
  });

  test('type is String', () => {
    expect(field().instance).toBe('String');
  });

  test('is NOT required (optional)', () => {
    expect(field().isRequired).toBeFalsy();
  });

  test('has trim:true', () => {
    expect(field().options.trim).toBe(true);
  });

  test('has no enum constraint', () => {
    expect(field().enumValues).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. description field
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema field: description', () => {
  const field = () => paths.description;

  test('field exists in schema', () => {
    expect(field()).toBeDefined();
  });

  test('type is String', () => {
    expect(field().instance).toBe('String');
  });

  test('is NOT required (optional)', () => {
    expect(field().isRequired).toBeFalsy();
  });

  test('has trim:true', () => {
    expect(field().options.trim).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Schema options
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — schema options', () => {
  test('timestamps option is enabled (truthy)', () => {
    expect(schema.options.timestamps).toBeTruthy();
  });

  test('createdAt path is present due to timestamps', () => {
    expect(paths.createdAt).toBeDefined();
  });

  test('updatedAt path is present due to timestamps', () => {
    expect(paths.updatedAt).toBeDefined();
  });

  test('toJSON has virtuals:true', () => {
    expect(schema.options.toJSON?.virtuals).toBe(true);
  });

  test('toObject has virtuals:true', () => {
    expect(schema.options.toObject?.virtuals).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Indexes
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — indexes', () => {
  const indexes = schema.indexes();

  test('schema has at least one index defined', () => {
    expect(indexes.length).toBeGreaterThan(0);
  });

  test('has unique index on tableNumber:1', () => {
    const tableNumberIdx = indexes.find(
      ([fields, opts]) => fields.tableNumber === 1 && opts.unique === true
    );
    expect(tableNumberIdx).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. No extra methods or hooks
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — methods and hooks', () => {
  test('no custom instance methods defined', () => {
    const MONGOOSE_INTERNALS = ['initializeTimestamps'];
    const custom = Object.keys(schema.methods).filter((m) => !MONGOOSE_INTERNALS.includes(m));
    expect(custom).toHaveLength(0);
  });

  test('no custom static methods defined', () => {
    expect(Object.keys(schema.statics)).toHaveLength(0);
  });

  test('no custom pre-save hooks defined', () => {
    /* Mongoose registers its own pre-save hooks on every schema, so the only
       way to ask "did we add one?" is to name theirs and subtract. That makes
       this list a Mongoose version detail: 9 added saveSubdocsPreDeleteOne and
       this test failed on the upgrade, reporting a custom hook that is not
       ours. If a Mongoose bump breaks it again, check the new name is really
       theirs before adding it here. */
    const MONGOOSE_PRE_INTERNALS = [
      'validateBeforeSave',
      'saveSubdocsPreSave',
      'saveSubdocsPreDeleteOne',
      'timestampsPreSave',
      'shardingPluginPreSave',
      'trackTransactionPreSave',
    ];
    const pres = schema.s?.hooks?._pres?.get('save') ?? [];
    const custom = pres.filter((h) => {
      const fn = h.fn || h;
      return typeof fn === 'function' && !MONGOOSE_PRE_INTERNALS.includes(fn.name);
    });
    expect(custom).toHaveLength(0);
  });

  test('no custom post-save hooks defined', () => {
    const MONGOOSE_POST_INTERNALS = [
      'saveSubdocsPostDeleteOne',
      'saveSubdocsPostSave',
      'shardingPluginPostSave',
    ];
    const posts = schema.s?.hooks?._posts?.get('save') ?? [];
    const custom = posts.filter((h) => {
      const fn = h.fn || h;
      return typeof fn === 'function' && !MONGOOSE_POST_INTERNALS.includes(fn.name);
    });
    expect(custom).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Document instantiation & default values
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — document instantiation', () => {
  test('new instance is created without throwing', () => {
    expect(() => new EasyTable({ tableNumber: 'T1', capacity: 4 })).not.toThrow();
  });

  test('status defaults to "available" on a new instance', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4 });
    expect(doc.status).toBe('available');
  });

  test('location is undefined when not provided', () => {
    const doc = new EasyTable({ tableNumber: 'T2', capacity: 2 });
    expect(doc.location).toBeUndefined();
  });

  test('description is undefined when not provided', () => {
    const doc = new EasyTable({ tableNumber: 'T3', capacity: 6 });
    expect(doc.description).toBeUndefined();
  });

  test('_id is auto-assigned as an ObjectId', () => {
    const doc = new EasyTable({ tableNumber: 'T4', capacity: 8 });
    expect(doc._id).toBeDefined();
    expect(mongoose.Types.ObjectId.isValid(doc._id)).toBe(true);
  });

  test('provided status overrides default', () => {
    const doc = new EasyTable({ tableNumber: 'T5', capacity: 2, status: 'occupied' });
    expect(doc.status).toBe('occupied');
  });

  test('provided location is stored correctly', () => {
    const doc = new EasyTable({ tableNumber: 'T6', capacity: 4, location: 'Rooftop' });
    expect(doc.location).toBe('Rooftop');
  });

  test('provided description is stored correctly', () => {
    const doc = new EasyTable({ tableNumber: 'T7', capacity: 4, description: 'Window seat' });
    expect(doc.description).toBe('Window seat');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Mongoose validation (synchronous path)
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — Mongoose validation', () => {
  test('validateSync returns error when tableNumber is missing', () => {
    const doc = new EasyTable({ capacity: 4 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.tableNumber).toBeDefined();
  });

  test('validateSync returns error when capacity is missing', () => {
    const doc = new EasyTable({ tableNumber: 'T1' });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.capacity).toBeDefined();
  });

  test('validateSync returns no error for valid minimal document', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4 });
    const err = doc.validateSync();
    expect(err).toBeUndefined();
  });

  test('validateSync returns error when capacity is below min (0)', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 0 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.capacity).toBeDefined();
  });

  test('validateSync returns error when capacity is negative', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: -5 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.capacity).toBeDefined();
  });

  test('validateSync returns error for invalid status enum value', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, status: 'invalid_status' });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors.status).toBeDefined();
  });

  test('validateSync passes for all valid status enum values', () => {
    for (const s of ['available', 'occupied', 'reserved', 'out_of_service']) {
      const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, status: s });
      expect(doc.validateSync()).toBeUndefined();
    }
  });

  test('validateSync returns error when both tableNumber and capacity are missing', () => {
    const doc = new EasyTable({});
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(Object.keys(err.errors)).toEqual(expect.arrayContaining(['tableNumber', 'capacity']));
  });

  test('validateSync passes with all fields provided', () => {
    const doc = new EasyTable({
      tableNumber: 'T10',
      capacity: 8,
      status: 'reserved',
      location: 'Garden',
      description: 'Outdoor table with view',
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Edge cases — field values
// ═══════════════════════════════════════════════════════════════════════════════
describe('EasyTable — edge cases', () => {
  test('capacity of 1 (boundary min) is valid', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 1 });
    expect(doc.validateSync()).toBeUndefined();
  });

  test('large capacity value is valid', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 9999 });
    expect(doc.validateSync()).toBeUndefined();
  });

  test('decimal capacity (1.5) passes min:1 but is stored as-is', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 1.5 });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.capacity).toBe(1.5);
  });

  test('tableNumber with special characters is stored without change', () => {
    const doc = new EasyTable({ tableNumber: 'T-01 (VIP)', capacity: 4 });
    expect(doc.tableNumber).toBe('T-01 (VIP)');
  });

  test('location with only whitespace is trimmed to empty string', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, location: '   ' });
    expect(doc.location).toBe('');
  });

  test('description with only whitespace is trimmed to empty string', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, description: '   ' });
    expect(doc.description).toBe('');
  });

  test('null location is stored as null', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, location: null });
    expect(doc.location).toBeNull();
  });

  test('null description is stored as null', () => {
    const doc = new EasyTable({ tableNumber: 'T1', capacity: 4, description: null });
    expect(doc.description).toBeNull();
  });
});
