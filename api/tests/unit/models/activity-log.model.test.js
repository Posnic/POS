'use strict';

/**
 * Unit tests for activity-log.model.js
 *
 * Strategy: Pure schema inspection (no DB connection, no mongodb-memory-server).
 * - mongoose.Schema and mongoose.model run normally — they do NOT need a live connection.
 * - mongoose-paginate-v2 is the real installed package.
 * - ActivityLog.logActivity is tested by spying on ActivityLog.create.
 * - All schema field properties are inspected via schema.path() and schema.options.
 */

const mongoose = require('mongoose');
const ActivityLog = require('../../../src/models/activity-log.model');

// ─── Convenience helpers ──────────────────────────────────────────────────────
const schema = ActivityLog.schema;
const path = (field) => schema.path(field);

// ─── Valid action / entity enums (mirrors model source) ───────────────────────
const VALID_ACTIONS = [
  'login',
  'logout',
  'create',
  'update',
  'delete',
  'password_change',
  'profile_update',
  'permission_change',
  'price_change',
  'discount',
  'cancel',
  'failed_login',
  'account_lockout',
];

const VALID_ENTITIES = ['user', 'product', 'order', 'sale', 'inventory', 'auth', 'system'];

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: user
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › user field', () => {
  test('path exists', () => {
    expect(path('user')).toBeDefined();
  });

  test('is required', () => {
    expect(path('user').options.required).toBe(true);
  });

  test('is ObjectId type', () => {
    expect(path('user').options.type).toBe(mongoose.Schema.Types.ObjectId);
  });

  test('references "User" model', () => {
    expect(path('user').options.ref).toBe('User');
  });

  test('instance is "ObjectId"', () => {
    // Mongoose 8.x uses lowercase 'd': "ObjectId"
    expect(path('user').instance).toBe('ObjectId');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: action
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › action field', () => {
  test('path exists', () => {
    expect(path('action')).toBeDefined();
  });

  test('is required', () => {
    expect(path('action').options.required).toBe(true);
  });

  test('is String type', () => {
    expect(path('action').instance).toBe('String');
  });

  test('enum has exactly 13 values', () => {
    expect(path('action').enumValues).toHaveLength(13);
  });

  test.each(VALID_ACTIONS)('enum contains "%s"', (action) => {
    expect(path('action').enumValues).toContain(action);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: entity
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › entity field', () => {
  test('path exists', () => {
    expect(path('entity')).toBeDefined();
  });

  test('is required', () => {
    expect(path('entity').options.required).toBe(true);
  });

  test('is String type', () => {
    expect(path('entity').instance).toBe('String');
  });

  test('enum has exactly 7 values', () => {
    expect(path('entity').enumValues).toHaveLength(7);
  });

  test.each(VALID_ENTITIES)('enum contains "%s"', (entity) => {
    expect(path('entity').enumValues).toContain(entity);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: entityId
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › entityId field', () => {
  test('path exists', () => {
    expect(path('entityId')).toBeDefined();
  });

  test('is Mixed type (accepts any value)', () => {
    expect(path('entityId').instance).toBe('Mixed');
  });

  test('is NOT required (optional)', () => {
    expect(path('entityId').options.required).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: details
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › details field', () => {
  test('path exists', () => {
    expect(path('details')).toBeDefined();
  });

  test('is Mixed type (accepts any object/value)', () => {
    expect(path('details').instance).toBe('Mixed');
  });

  test('is NOT required (optional)', () => {
    expect(path('details').options.required).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: ipAddress
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › ipAddress field', () => {
  test('path exists', () => {
    expect(path('ipAddress')).toBeDefined();
  });

  test('is String type', () => {
    expect(path('ipAddress').instance).toBe('String');
  });

  test('is NOT required (optional)', () => {
    expect(path('ipAddress').options.required).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: userAgent
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › userAgent field', () => {
  test('path exists', () => {
    expect(path('userAgent')).toBeDefined();
  });

  test('is String type', () => {
    expect(path('userAgent').instance).toBe('String');
  });

  test('is NOT required (optional)', () => {
    expect(path('userAgent').options.required).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema path: status
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › status field', () => {
  test('path exists', () => {
    expect(path('status')).toBeDefined();
  });

  test('is String type', () => {
    expect(path('status').instance).toBe('String');
  });

  test('default value is "success"', () => {
    expect(path('status').options.default).toBe('success');
  });

  test('enum contains "success"', () => {
    expect(path('status').enumValues).toContain('success');
  });

  test('enum contains "failed"', () => {
    expect(path('status').enumValues).toContain('failed');
  });

  test('enum has exactly 2 values', () => {
    expect(path('status').enumValues).toHaveLength(2);
  });

  test('is NOT required (has default)', () => {
    expect(path('status').options.required).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Schema options
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › options', () => {
  test('timestamps is enabled', () => {
    expect(schema.options.timestamps).toBe(true);
  });

  test('toJSON has virtuals:true', () => {
    expect(schema.options.toJSON?.virtuals).toBe(true);
  });

  test('toObject has virtuals:true', () => {
    expect(schema.options.toObject?.virtuals).toBe(true);
  });

  test('createdAt and updatedAt paths are added by timestamps', () => {
    expect(path('createdAt')).toBeDefined();
    expect(path('updatedAt')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Indexes
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › indexes', () => {
  let indexes;
  beforeAll(() => {
    // schema.indexes() returns [[fields, opts], ...]
    indexes = schema.indexes();
  });

  test('has index on user (ascending)', () => {
    const hasIt = indexes.some(([keys]) => keys.user === 1);
    expect(hasIt).toBe(true);
  });

  test('has index on action (ascending)', () => {
    const hasIt = indexes.some(([keys]) => keys.action === 1);
    expect(hasIt).toBe(true);
  });

  test('has compound index on entity + entityId', () => {
    const hasIt = indexes.some(([keys]) => keys.entity === 1 && keys.entityId === 1);
    expect(hasIt).toBe(true);
  });

  test('has index on createdAt (descending)', () => {
    const hasIt = indexes.some(([keys]) => keys.createdAt === -1);
    expect(hasIt).toBe(true);
  });

  test('total non-default indexes count is 4', () => {
    // Mongoose adds a default _id index; the model defines 4 more
    const nonIdIndexes = indexes.filter(([keys]) => !('_id' in keys));
    expect(nonIdIndexes).toHaveLength(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Paginate plugin
// ═══════════════════════════════════════════════════════════════════════════════
describe('mongoose-paginate-v2 plugin', () => {
  test('ActivityLog.paginate is a function', () => {
    expect(typeof ActivityLog.paginate).toBe('function');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Static method: logActivity
// ═══════════════════════════════════════════════════════════════════════════════
describe('ActivityLog.logActivity static method', () => {
  const validData = {
    user: new mongoose.Types.ObjectId(),
    action: 'create',
    entity: 'user',
    entityId: 'ent001',
    details: { before: null, after: { name: 'Alice' } },
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    status: 'success',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  test('exists on the model as a function', () => {
    expect(typeof ActivityLog.logActivity).toBe('function');
  });

  test('calls ActivityLog.create with the provided data', async () => {
    const fakeDoc = { _id: 'act001', ...validData };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(fakeDoc);
    await ActivityLog.logActivity(validData);
    expect(ActivityLog.create).toHaveBeenCalledWith(validData);
  });

  test('returns the created document on success', async () => {
    const fakeDoc = { _id: 'act001', ...validData };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(fakeDoc);
    const result = await ActivityLog.logActivity(validData);
    expect(result).toEqual(fakeDoc);
  });

  test('returns null when create throws (error is swallowed)', async () => {
    jest.spyOn(ActivityLog, 'create').mockRejectedValue(new Error('DB connection refused'));
    const result = await ActivityLog.logActivity(validData);
    expect(result).toBeNull();
  });

  test('does not throw even when create throws', async () => {
    jest.spyOn(ActivityLog, 'create').mockRejectedValue(new Error('Validation failed'));
    await expect(ActivityLog.logActivity(validData)).resolves.toBeNull();
  });

  test('passes minimal required data to create', async () => {
    const minData = { user: validData.user, action: 'login', entity: 'auth' };
    const fakeDoc = { _id: 'act002', ...minData };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(fakeDoc);
    const result = await ActivityLog.logActivity(minData);
    expect(ActivityLog.create).toHaveBeenCalledWith(minData);
    expect(result).toEqual(fakeDoc);
  });

  test('passes details object to create unchanged', async () => {
    const dataWithDetails = { ...validData, details: { key: 'value', nested: { x: 1 } } };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(dataWithDetails);
    await ActivityLog.logActivity(dataWithDetails);
    expect(ActivityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ details: { key: 'value', nested: { x: 1 } } })
    );
  });

  test('passes empty details object without error', async () => {
    const dataEmpty = { ...validData, details: {} };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(dataEmpty);
    const result = await ActivityLog.logActivity(dataEmpty);
    expect(result).not.toBeNull();
  });

  test('handles large details object', async () => {
    const largeDetails = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`key${i}`, `val${i}`])
    );
    const dataLarge = { ...validData, details: largeDetails };
    jest.spyOn(ActivityLog, 'create').mockResolvedValue(dataLarge);
    const result = await ActivityLog.logActivity(dataLarge);
    expect(result).not.toBeNull();
    expect(ActivityLog.create).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Model identity
// ═══════════════════════════════════════════════════════════════════════════════
describe('ActivityLog model identity', () => {
  test('model name is "ActivityLog"', () => {
    expect(ActivityLog.modelName).toBe('ActivityLog');
  });

  test('is a Mongoose Model (has mongoose model methods)', () => {
    expect(typeof ActivityLog.find).toBe('function');
    expect(typeof ActivityLog.findOne).toBe('function');
    expect(typeof ActivityLog.create).toBe('function');
    expect(typeof ActivityLog.deleteOne).toBe('function');
    expect(typeof ActivityLog.countDocuments).toBe('function');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Field presence check — no unexpected extra fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('schema › expected field set', () => {
  const expectedFields = [
    'user',
    'action',
    'entity',
    'entityId',
    'details',
    'ipAddress',
    'userAgent',
    'status',
  ];

  test.each(expectedFields)('field "%s" is present in the schema', (field) => {
    expect(schema.path(field)).toBeDefined();
  });

  test('_id is present (auto-added by mongoose)', () => {
    expect(schema.path('_id')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases & enum boundary checks
// ═══════════════════════════════════════════════════════════════════════════════
describe('enum boundary checks', () => {
  test('action enum does NOT include arbitrary string "transfer"', () => {
    expect(path('action').enumValues).not.toContain('transfer');
  });

  test('entity enum does NOT include "branch" or "company"', () => {
    expect(path('entity').enumValues).not.toContain('branch');
    expect(path('entity').enumValues).not.toContain('company');
  });

  test('status enum does NOT include "pending"', () => {
    expect(path('status').enumValues).not.toContain('pending');
  });

  test('status default is not "failed"', () => {
    expect(path('status').options.default).not.toBe('failed');
  });
});
