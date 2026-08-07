'use strict';

/**
 * Unit tests for src/models/whatsapp-template.model.js
 *
 * File confirmed : src/models/whatsapp-template.model.js (45 lines)
 * Related files  :
 *   - src/controllers/whatsapp.controller.js — active consumer
 *   - src/services/whatsapp.service.js       — active consumer
 *   - src/routes/whatsapp.routes.js          — active consumer
 *   - whatsapp.model.js              — does NOT exist
 *   - whatsapp-template.schema.js    — does NOT exist
 *   - message-template.model.js      — does NOT exist
 *   - notification-template.model.js — does NOT exist
 *   - whatsappTemplate.model.js      — does NOT exist
 *   - whatsapp-template.model.ts     — does NOT exist
 *
 * ORM       : Mongoose
 * Framework : Jest (pre-configured)
 * Strategy  : Pure schema inspection via schema.path() + doc.validateSync()
 *             + pre-save hook extraction by keyword.
 *             No DB connection. No mongodb-memory-server.
 *             No external mocks needed — model has no external imports.
 *
 * Model classification: Pure Mongoose schema model (NOT a query/data-access helper)
 * Single active model — no similarly named files exist.
 *
 * Schema fields:
 *   branch_id     : ObjectId, required, ref 'branches'
 *   name          : String, required, maxlength 100
 *   message       : String, required, maxlength 1000
 *   template_type : String, enum [general/sales_receipt/payment_reminder/welcome], default 'general'
 *   is_active     : Boolean, default true
 *   created_at    : Date, default Date.now
 *   updated_at    : Date, default Date.now
 *   timestamps    : not configured (schema.options.timestamps is undefined)
 *
 * Pre-save hook (1): Sets updated_at = new Date(), calls next()
 *
 * NOT present (by design):
 *   - WhatsApp provider token / API key (stored in service/config, not schema)
 *   - Placeholders / variables / parameter arrays
 *   - Header / footer / buttons
 *   - Language code
 *   - Provider template ID / name
 *   - Soft delete field
 *   - toJSON / paginate plugins
 *   - Static methods / instance methods
 *   - Mongoose auto timestamps
 *
 * TEMPLATE_TYPE enum: general, sales_receipt, payment_reminder, welcome
 */

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const WhatsAppTemplateModel = require('../../../src/models/whatsapp-template.model');

// ─── Schema shortcuts ─────────────────────────────────────────────────────────

const schema = WhatsAppTemplateModel.schema;
const p = (field) => schema.path(field);

// ─── Constants ────────────────────────────────────────────────────────────────

const TEMPLATE_TYPE_ENUM = ['general', 'sales_receipt', 'payment_reminder', 'welcome'];

// ─── Helper ───────────────────────────────────────────────────────────────────

function validData(overrides = {}) {
  return {
    branch_id: new mongoose.Types.ObjectId(),
    branch_name: 'Main Branch',
    license: new mongoose.Types.ObjectId(),
    name: 'Sales Receipt Template',
    message: 'Hello {{name}}, your receipt is ready.',
    ...overrides,
  };
}

// ─── Pre-save hook extractor ──────────────────────────────────────────────────

function getPreSaveHook() {
  const pres = schema.s.hooks._pres.get('save') || [];
  return pres
    .map((h) => h.fn)
    .filter(Boolean)
    .find((fn) => fn.toString().includes('updated_at'));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — model identity', () => {
  test('modelName is "WhatsAppTemplate"', () => {
    expect(WhatsAppTemplateModel.modelName).toBe('WhatsAppTemplate');
  });

  test('schema is a Mongoose Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('WhatsAppTemplateModel is a constructor function', () => {
    expect(typeof WhatsAppTemplateModel).toBe('function');
  });

  test('new WhatsAppTemplateModel() creates a Mongoose Document', () => {
    expect(new WhatsAppTemplateModel(validData())).toBeInstanceOf(mongoose.Document);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. branch_id field
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — branch_id field', () => {
  test('branch_id has instance type "ObjectId"', () => {
    expect(p('branch_id').instance).toBe('ObjectId');
  });

  test('branch_id is required', () => {
    expect(p('branch_id').isRequired).toBe(true);
  });

  test('branch_id has ref "branches"', () => {
    expect(p('branch_id').options.ref).toBe('branches');
  });

  test('document instance stores branch_id correctly', () => {
    const branchId = new mongoose.Types.ObjectId();
    const doc = new WhatsAppTemplateModel(validData({ branch_id: branchId }));
    expect(doc.branch_id.toString()).toBe(branchId.toString());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. name field
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — name field', () => {
  test('name has instance type "String"', () => {
    expect(p('name').instance).toBe('String');
  });

  test('name is required', () => {
    expect(p('name').isRequired).toBe(true);
  });

  test('name has maxlength of 100', () => {
    expect(p('name').options.maxlength).toBe(100);
  });

  test('document instance stores name correctly', () => {
    const doc = new WhatsAppTemplateModel(validData({ name: 'Welcome Template' }));
    expect(doc.name).toBe('Welcome Template');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. message field
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — message field', () => {
  test('message has instance type "String"', () => {
    expect(p('message').instance).toBe('String');
  });

  test('message is required', () => {
    expect(p('message').isRequired).toBe(true);
  });

  test('message has maxlength of 1000', () => {
    expect(p('message').options.maxlength).toBe(1000);
  });

  test('document instance stores message body correctly', () => {
    const body = 'Hello {{name}}, your payment of {{amount}} is due.';
    const doc = new WhatsAppTemplateModel(validData({ message: body }));
    expect(doc.message).toBe(body);
  });

  test('message can contain emojis and newlines', () => {
    const body = 'Hi! 🎉\nYour order is ready.\nThank you!';
    const doc = new WhatsAppTemplateModel(validData({ message: body }));
    expect(doc.message).toBe(body);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. template_type field
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — template_type field', () => {
  test('template_type has instance type "String"', () => {
    expect(p('template_type').instance).toBe('String');
  });

  test('template_type enum contains exactly the 4 expected values', () => {
    expect(p('template_type').enumValues).toEqual(TEMPLATE_TYPE_ENUM);
  });

  test('template_type default is "general"', () => {
    expect(p('template_type').defaultValue).toBe('general');
  });

  test('template_type is optional (not required)', () => {
    expect(p('template_type').isRequired).toBeFalsy();
  });

  test('document instance applies "general" as default template_type', () => {
    const doc = new WhatsAppTemplateModel(validData({ template_type: undefined }));
    expect(doc.template_type).toBe('general');
  });

  test('document instance stores "sales_receipt" template_type correctly', () => {
    const doc = new WhatsAppTemplateModel(validData({ template_type: 'sales_receipt' }));
    expect(doc.template_type).toBe('sales_receipt');
  });

  test('document instance stores "payment_reminder" template_type correctly', () => {
    expect(
      new WhatsAppTemplateModel(validData({ template_type: 'payment_reminder' })).template_type
    ).toBe('payment_reminder');
  });

  test('document instance stores "welcome" template_type correctly', () => {
    expect(new WhatsAppTemplateModel(validData({ template_type: 'welcome' })).template_type).toBe(
      'welcome'
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. is_active field
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — is_active field', () => {
  test('is_active has instance type "Boolean"', () => {
    expect(p('is_active').instance).toBe('Boolean');
  });

  test('is_active default is true', () => {
    expect(p('is_active').defaultValue).toBe(true);
  });

  test('is_active is optional (not required)', () => {
    expect(p('is_active').isRequired).toBeFalsy();
  });

  test('document instance applies true as default is_active', () => {
    expect(new WhatsAppTemplateModel(validData()).is_active).toBe(true);
  });

  test('document instance stores is_active:false correctly', () => {
    expect(new WhatsAppTemplateModel(validData({ is_active: false })).is_active).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. created_at and updated_at fields
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — created_at and updated_at fields', () => {
  test('created_at has instance type "Date"', () => {
    expect(p('created_at').instance).toBe('Date');
  });

  test('created_at has a default (Date.now)', () => {
    expect(p('created_at').defaultValue).toBeDefined();
  });

  test('updated_at has instance type "Date"', () => {
    expect(p('updated_at').instance).toBe('Date');
  });

  test('updated_at has a default (Date.now)', () => {
    expect(p('updated_at').defaultValue).toBeDefined();
  });

  test('document instance populates created_at and updated_at by default', () => {
    const before = Date.now();
    const doc = new WhatsAppTemplateModel(validData());
    expect(doc.created_at).toBeInstanceOf(Date);
    expect(doc.updated_at).toBeInstanceOf(Date);
    expect(doc.created_at.getTime()).toBeGreaterThanOrEqual(before - 10);
  });

  test('schema does not use Mongoose auto timestamps (no createdAt/updatedAt paths)', () => {
    expect(schema.options.timestamps).toBeFalsy();
    expect(p('createdAt')).toBeUndefined();
    expect(p('updatedAt')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. Pre-save hook — updated_at maintenance
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — pre-save hook', () => {
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

  test('sets updated_at to a new Date on every save', () => {
    const before = Date.now();
    const mockDoc = { updated_at: null };
    preSaveHook.call(mockDoc, mockNext);
    expect(mockDoc.updated_at).toBeInstanceOf(Date);
    expect(mockDoc.updated_at.getTime()).toBeGreaterThanOrEqual(before - 10);
  });

  /* Mongoose 9 dropped next() from middleware; a hook that returns has done
     its job. What is worth asserting is the field it sets. */
  test('returns without throwing, having set updated_at', () => {
    const doc = { updated_at: null };
    expect(() => preSaveHook.call(doc)).not.toThrow();
    expect(doc.updated_at).toBeInstanceOf(Date);
  });

  test('always overwrites updated_at (even if already set)', () => {
    const oldDate = new Date('2020-01-01');
    const mockDoc = { updated_at: oldDate };
    preSaveHook.call(mockDoc, mockNext);
    expect(mockDoc.updated_at.getTime()).toBeGreaterThan(oldDate.getTime());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. validateSync — required field checks
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — validateSync required field checks', () => {
  test('no errors when all required fields are present', () => {
    expect(new WhatsAppTemplateModel(validData()).validateSync()).toBeUndefined();
  });

  test('reports error when branch_id is missing', () => {
    const doc = new WhatsAppTemplateModel(validData({ branch_id: undefined }));
    expect(doc.validateSync()?.errors).toHaveProperty('branch_id');
  });

  test('reports error when name is missing', () => {
    const doc = new WhatsAppTemplateModel(validData({ name: undefined }));
    expect(doc.validateSync()?.errors).toHaveProperty('name');
  });

  test('reports error when message is missing', () => {
    const doc = new WhatsAppTemplateModel(validData({ message: undefined }));
    expect(doc.validateSync()?.errors).toHaveProperty('message');
  });

  test('reports enum error when template_type is invalid', () => {
    const doc = new WhatsAppTemplateModel(validData({ template_type: 'otp' }));
    expect(doc.validateSync()?.errors?.template_type?.kind).toBe('enum');
  });

  test('reports maxlength error when name exceeds 100 characters', () => {
    const doc = new WhatsAppTemplateModel(validData({ name: 'A'.repeat(101) }));
    const err = doc.validateSync();
    expect(err?.errors?.name).toBeDefined();
  });

  test('reports maxlength error when message exceeds 1000 characters', () => {
    const doc = new WhatsAppTemplateModel(validData({ message: 'M'.repeat(1001) }));
    const err = doc.validateSync();
    expect(err?.errors?.message).toBeDefined();
  });

  test('name at exactly 100 characters passes validation', () => {
    const doc = new WhatsAppTemplateModel(validData({ name: 'A'.repeat(100) }));
    expect(doc.validateSync()?.errors?.name).toBeUndefined();
  });

  test('message at exactly 1000 characters passes validation', () => {
    const doc = new WhatsAppTemplateModel(validData({ message: 'M'.repeat(1000) }));
    expect(doc.validateSync()?.errors?.message).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Schema indexes
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — schema indexes', () => {
  test('schema indexes templates by active tenant context', () => {
    const indexes = schema.indexes();
    expect(indexes).toContainEqual([
      { license: 1, branch_id: 1, branch_name: 1, created_at: -1 },
      expect.any(Object),
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. No plugins, static methods, or instance methods
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — no plugins, statics, or instance methods', () => {
  test('schema has no custom static methods', () => {
    expect(Object.keys(schema.statics)).toHaveLength(0);
  });

  test('schema has no custom instance methods', () => {
    const mongooseInternals = ['initializeTimestamps'];
    const custom = Object.keys(schema.methods).filter((m) => !mongooseInternals.includes(m));
    expect(custom).toHaveLength(0);
  });

  test('WhatsAppTemplateModel does not have paginate static (no paginate plugin)', () => {
    expect(WhatsAppTemplateModel.paginate).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Document instance — defaults and complete storage
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — document instance defaults and storage', () => {
  let doc;
  beforeEach(() => {
    doc = new WhatsAppTemplateModel(validData());
  });

  test('new document gets an _id automatically', () => {
    expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('template_type defaults to "general"', () => {
    expect(doc.template_type).toBe('general');
  });

  test('is_active defaults to true', () => {
    expect(doc.is_active).toBe(true);
  });

  test('created_at is set by default', () => {
    expect(doc.created_at).toBeInstanceOf(Date);
  });

  test('updated_at is set by default', () => {
    expect(doc.updated_at).toBeInstanceOf(Date);
  });

  test('stores all fields of a complete template correctly', () => {
    const branchId = new mongoose.Types.ObjectId();
    const full = new WhatsAppTemplateModel({
      branch_id: branchId,
      name: 'Payment Reminder',
      message: 'Hi {{customer_name}}, payment of ₹{{amount}} is due on {{due_date}}.',
      template_type: 'payment_reminder',
      is_active: true,
    });
    expect(full.branch_id.toString()).toBe(branchId.toString());
    expect(full.name).toBe('Payment Reminder');
    expect(full.message).toContain('{{amount}}');
    expect(full.template_type).toBe('payment_reminder');
    expect(full.is_active).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Security — no sensitive credential fields in schema
// ══════════════════════════════════════════════════════════════════════════════
describe('WhatsAppTemplate — security checks', () => {
  const sensitiveFields = [
    'api_key',
    'token',
    'webhook_secret',
    'access_token',
    'provider_token',
    'secret',
    'credentials',
  ];

  sensitiveFields.forEach((field) => {
    test(`schema does NOT contain a "${field}" field`, () => {
      expect(p(field)).toBeUndefined();
    });
  });

  test('schema has no toJSON transform that could hide or expose fields', () => {
    expect(schema.options.toJSON?.transform).toBeUndefined();
  });
});
