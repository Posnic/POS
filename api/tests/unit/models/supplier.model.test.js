'use strict';

/**
 * Unit tests for src/models/supplier.model.js
 *
 * File confirmed : src/models/supplier.model.js (104 lines)
 * Related files  :
 *   - src/models/supplier-legacy.model.js — EXISTS (native MongoDB driver, active production model)
 *   - src/models/plugins.js               — toJSON + paginate plugins used by this model
 *   - suppliers.model.js                  — does NOT exist
 *   - supplier.schema.js                  — does NOT exist
 *   - supplier.model.ts                   — does NOT exist
 *
 * Model classification:
 *   supplier.model.js     = Mongoose model (NOT connected to live routes — a newer rewrite)
 *   supplier-legacy.model.js = Native MongoDB driver model (ACTIVE production supplier model)
 *
 * ORM       : Mongoose (NOT native driver)
 * Framework : Jest (pre-configured)
 * Strategy  : Pure schema inspection via schema.path() + spy mocks for methods
 *             No real DB connection needed. No mongodb-memory-server required.
 *             Follows sale.model.test.js pattern.
 *
 * Schema fields (11 top-level):
 *   name       : String, required, trim, index
 *   email      : String, required, unique, trim, lowercase, isEmail validator
 *   phone      : String, required, trim
 *   address    : nested { street, city, state, country, postalCode } — all String, optional
 *   gst_number : String, required, trim, uppercase
 *   gst_type   : String, enum [regular/composition/unregistered], default "regular"
 *   balance    : Number, default 0
 *   status     : String, enum [active/inactive], default "active"
 *   createdBy  : ObjectId, ref "User", required
 *   updatedBy  : ObjectId, ref "User", optional
 *   timestamps : { createdAt, updatedAt } — via { timestamps: true }
 *
 * Plugins:
 *   toJSON   — transforms _id → id (string), removes __v
 *   paginate — adds Supplier.paginate(filter, options) static method
 *
 * Static methods:
 *   isEmailTaken(email, excludeSupplierId) — returns boolean
 *
 * Instance methods:
 *   canBeDeleted() — returns boolean (checks purchases collection)
 *
 * Differences from supplier-legacy.model.js:
 *   + balance field (not in legacy)
 *   + status field (not in legacy)
 *   + email uniqueness enforced at schema level (legacy: no unique constraint)
 *   + gst_type enum (legacy: free-form string)
 *   - No branch_id / branch_name / license fields (tenant isolation missing)
 *   - No plan-limit logic, changeLog, backup, paginated queries
 *   - Not connected to any live route/controller
 */

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const Supplier = require('../../../src/models/supplier.model');

// ─── Schema shortcuts ─────────────────────────────────────────────────────────

const schema = Supplier.schema;
const p = (field) => schema.path(field);

// ─── Constants ────────────────────────────────────────────────────────────────

const GST_TYPE_ENUM = ['regular', 'composition', 'unregistered'];
const STATUS_ENUM = ['active', 'inactive'];

// ─── Helper: minimal valid supplier data ─────────────────────────────────────

function validData(overrides = {}) {
  return {
    name: 'Acme Supplies Ltd',
    email: 'acme@example.com',
    phone: '9876543210',
    gst_number: 'GSTIN123456',
    createdBy: new mongoose.Types.ObjectId(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — model identity', () => {
  test('Supplier is a Mongoose model (has modelName)', () => {
    expect(Supplier.modelName).toBe('Supplier');
  });

  test('Supplier.schema is a Mongoose Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('Supplier is a constructor function', () => {
    expect(typeof Supplier).toBe('function');
  });

  test('new Supplier() creates a Mongoose Document instance', () => {
    const doc = new Supplier(validData());
    expect(doc).toBeInstanceOf(mongoose.Document);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. name field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — name field', () => {
  test('name has instance type "String"', () => {
    expect(p('name').instance).toBe('String');
  });

  test('name is required', () => {
    expect(p('name').isRequired).toBe(true);
  });

  test('name has trim:true', () => {
    expect(p('name').options.trim).toBe(true);
  });

  test('name document instance stores the name correctly', () => {
    const doc = new Supplier(validData({ name: 'Global Traders' }));
    expect(doc.name).toBe('Global Traders');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. email field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — email field', () => {
  test('email has instance type "String"', () => {
    expect(p('email').instance).toBe('String');
  });

  test('email is optional', () => {
    expect(p('email').isRequired).toBeFalsy();
  });

  test('email has unique:true', () => {
    expect(p('email').options.unique).toBe(true);
  });

  test('email unique index is sparse so missing values do not collide', () => {
    expect(p('email').options.sparse).toBe(true);
  });

  test('email has lowercase:true', () => {
    expect(p('email').options.lowercase).toBe(true);
  });

  test('email has at least one custom validator (isEmail)', () => {
    expect(p('email').validators.length).toBeGreaterThan(0);
  });

  test('email validator rejects invalid email — validateSync reports email error', () => {
    const doc = new Supplier(validData({ email: 'not-an-email' }));
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors).toHaveProperty('email');
  });

  test('email validation passes for a well-formed email — validateSync has no email error', () => {
    const doc = new Supplier(validData({ email: 'valid@example.com' }));
    const err = doc.validateSync();
    expect(err?.errors?.email).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. phone field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — phone field', () => {
  test('phone has instance type "String"', () => {
    expect(p('phone').instance).toBe('String');
  });

  test('phone is required', () => {
    expect(p('phone').isRequired).toBe(true);
  });

  test('phone has trim:true', () => {
    expect(p('phone').options.trim).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. address sub-document
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — address sub-document', () => {
  test('address.street has instance type "String"', () => {
    expect(p('address.street').instance).toBe('String');
  });

  test('address.city has instance type "String"', () => {
    expect(p('address.city').instance).toBe('String');
  });

  test('address.state has instance type "String"', () => {
    expect(p('address.state').instance).toBe('String');
  });

  test('address.country has instance type "String"', () => {
    expect(p('address.country').instance).toBe('String');
  });

  test('address.postalCode has instance type "String"', () => {
    expect(p('address.postalCode').instance).toBe('String');
  });

  test('all address sub-fields are optional (not required)', () => {
    [
      'address.street',
      'address.city',
      'address.state',
      'address.country',
      'address.postalCode',
    ].forEach((f) => {
      expect(p(f).isRequired).toBeFalsy();
    });
  });

  test('address stores sub-fields correctly on document instance', () => {
    const doc = new Supplier(
      validData({
        address: {
          street: '123 Main St',
          city: 'Mumbai',
          state: 'MH',
          country: 'India',
          postalCode: '400001',
        },
      })
    );
    expect(doc.address.street).toBe('123 Main St');
    expect(doc.address.city).toBe('Mumbai');
    expect(doc.address.postalCode).toBe('400001');
  });

  test('supplier can be created without address (all sub-fields optional)', () => {
    const doc = new Supplier(validData());
    expect(doc.address).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. gst_number field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — gst_number field', () => {
  test('gst_number has instance type "String"', () => {
    expect(p('gst_number').instance).toBe('String');
  });

  test('gst_number is required', () => {
    expect(p('gst_number').isRequired).toBe(true);
  });

  test('gst_number has trim:true', () => {
    expect(p('gst_number').options.trim).toBe(true);
  });

  test('gst_number has uppercase:true', () => {
    expect(p('gst_number').options.uppercase).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. gst_type field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — gst_type field', () => {
  test('gst_type has instance type "String"', () => {
    expect(p('gst_type').instance).toBe('String');
  });

  test('gst_type enum contains exactly ["regular", "composition", "unregistered"]', () => {
    expect(p('gst_type').enumValues).toEqual(GST_TYPE_ENUM);
  });

  test('gst_type default is "regular"', () => {
    expect(p('gst_type').defaultValue).toBe('regular');
  });

  test('gst_type is not required', () => {
    expect(p('gst_type').isRequired).toBeFalsy();
  });

  test('document instance applies "regular" default when gst_type is omitted', () => {
    const doc = new Supplier(validData());
    expect(doc.gst_type).toBe('regular');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. balance field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — balance field', () => {
  test('balance has instance type "Number"', () => {
    expect(p('balance').instance).toBe('Number');
  });

  test('balance default is 0', () => {
    expect(p('balance').defaultValue).toBe(0);
  });

  test('balance is not required', () => {
    expect(p('balance').isRequired).toBeFalsy();
  });

  test('document instance applies 0 balance default', () => {
    const doc = new Supplier(validData());
    expect(doc.balance).toBe(0);
  });

  test('balance stores positive decimal value correctly', () => {
    const doc = new Supplier(validData({ balance: 12500.75 }));
    expect(doc.balance).toBe(12500.75);
  });

  test('balance stores zero correctly', () => {
    const doc = new Supplier(validData({ balance: 0 }));
    expect(doc.balance).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. status field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — status field', () => {
  test('status has instance type "String"', () => {
    expect(p('status').instance).toBe('String');
  });

  test('status enum contains exactly ["active", "inactive"]', () => {
    expect(p('status').enumValues).toEqual(STATUS_ENUM);
  });

  test('status default is "active"', () => {
    expect(p('status').defaultValue).toBe('active');
  });

  test('status is not required', () => {
    expect(p('status').isRequired).toBeFalsy();
  });

  test('document instance applies "active" default when status is omitted', () => {
    const doc = new Supplier(validData());
    expect(doc.status).toBe('active');
  });

  test('document instance stores "inactive" status correctly', () => {
    const doc = new Supplier(validData({ status: 'inactive' }));
    expect(doc.status).toBe('inactive');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. createdBy field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — createdBy field', () => {
  test('createdBy has instance type "ObjectId"', () => {
    expect(p('createdBy').instance).toBe('ObjectId');
  });

  test('createdBy has ref "User"', () => {
    expect(p('createdBy').options.ref).toBe('User');
  });

  test('createdBy is required', () => {
    expect(p('createdBy').isRequired).toBe(true);
  });

  test('document instance stores createdBy ObjectId correctly', () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = new Supplier(validData({ createdBy: userId }));
    expect(doc.createdBy.toString()).toBe(userId.toString());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. updatedBy field
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — updatedBy field', () => {
  test('updatedBy has instance type "ObjectId"', () => {
    expect(p('updatedBy').instance).toBe('ObjectId');
  });

  test('updatedBy has ref "User"', () => {
    expect(p('updatedBy').options.ref).toBe('User');
  });

  test('updatedBy is not required', () => {
    expect(p('updatedBy').isRequired).toBeFalsy();
  });

  test('supplier can be created without updatedBy', () => {
    const doc = new Supplier(validData());
    expect(doc.updatedBy).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. timestamps
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — timestamps', () => {
  test('schema.options.timestamps is true', () => {
    expect(schema.options.timestamps).toBe(true);
  });

  test('createdAt path is a Date type', () => {
    expect(p('createdAt').instance).toBe('Date');
  });

  test('updatedAt path is a Date type', () => {
    expect(p('updatedAt').instance).toBe('Date');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. toJSON plugin
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — toJSON plugin', () => {
  test('schema.options.toJSON is defined', () => {
    expect(schema.options.toJSON).toBeDefined();
  });

  test('schema.options.toJSON has a transform function', () => {
    expect(typeof schema.options.toJSON.transform).toBe('function');
  });

  test('toJSON transform adds id (string) from _id', () => {
    const transform = schema.options.toJSON.transform;
    const mockId = new mongoose.Types.ObjectId();
    const ret = { _id: mockId, __v: 0, name: 'Acme' };
    transform({}, ret, {});
    expect(ret.id).toBe(mockId.toString());
  });

  test('toJSON transform removes _id', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 0, name: 'Acme' };
    transform({}, ret, {});
    expect(ret._id).toBeUndefined();
  });

  test('toJSON transform removes __v', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 3, name: 'Acme' };
    transform({}, ret, {});
    expect(ret.__v).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. paginate plugin
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — paginate plugin', () => {
  test('Supplier.paginate is a static method (function)', () => {
    expect(typeof Supplier.paginate).toBe('function');
  });

  test('Supplier.schema.statics.paginate is defined', () => {
    expect(typeof schema.statics.paginate).toBe('function');
  });

  test('paginate static method is the same as schema.statics.paginate', () => {
    expect(Supplier.paginate).toBe(schema.statics.paginate);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. static isEmailTaken
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — static isEmailTaken', () => {
  afterEach(() => jest.restoreAllMocks());

  test('isEmailTaken is a static method on the model', () => {
    expect(typeof Supplier.isEmailTaken).toBe('function');
  });

  test('returns false when no supplier with that email exists', async () => {
    jest.spyOn(Supplier, 'findOne').mockResolvedValue(null);
    expect(await Supplier.isEmailTaken('new@example.com')).toBe(false);
  });

  test('returns true when a supplier with that email already exists', async () => {
    jest
      .spyOn(Supplier, 'findOne')
      .mockResolvedValue({ _id: new mongoose.Types.ObjectId(), email: 'taken@example.com' });
    expect(await Supplier.isEmailTaken('taken@example.com')).toBe(true);
  });

  test('returns false when the only matching supplier is the one being excluded', async () => {
    jest.spyOn(Supplier, 'findOne').mockResolvedValue(null);
    const excludeId = new mongoose.Types.ObjectId();
    expect(await Supplier.isEmailTaken('own@example.com', excludeId)).toBe(false);
  });

  test('calls findOne with the correct email filter', async () => {
    const spy = jest.spyOn(Supplier, 'findOne').mockResolvedValue(null);
    await Supplier.isEmailTaken('supplier@example.com');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ email: 'supplier@example.com' }));
  });

  test('calls findOne with $ne excludeSupplierId filter', async () => {
    const spy = jest.spyOn(Supplier, 'findOne').mockResolvedValue(null);
    const excludeId = new mongoose.Types.ObjectId();
    await Supplier.isEmailTaken('supplier@example.com', excludeId);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: excludeId } }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. instance canBeDeleted
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — instance canBeDeleted', () => {
  let supplier;

  beforeEach(() => {
    supplier = new Supplier(validData());
  });

  afterEach(() => jest.restoreAllMocks());

  test('canBeDeleted is an instance method on the document', () => {
    expect(typeof supplier.canBeDeleted).toBe('function');
  });

  test('canBeDeleted is defined on schema.methods', () => {
    expect(typeof schema.methods.canBeDeleted).toBe('function');
  });

  test('returns true when supplier has no associated purchases', async () => {
    const mockPurchase = { countDocuments: jest.fn().mockResolvedValue(0) };
    jest.spyOn(mongoose, 'model').mockReturnValue(mockPurchase);
    expect(await supplier.canBeDeleted()).toBe(true);
  });

  test('returns false when supplier has associated purchases', async () => {
    const mockPurchase = { countDocuments: jest.fn().mockResolvedValue(3) };
    jest.spyOn(mongoose, 'model').mockReturnValue(mockPurchase);
    expect(await supplier.canBeDeleted()).toBe(false);
  });

  test('calls Purchase.countDocuments with { supplier: this._id }', async () => {
    const countFn = jest.fn().mockResolvedValue(0);
    jest.spyOn(mongoose, 'model').mockReturnValue({ countDocuments: countFn });
    await supplier.canBeDeleted();
    expect(countFn).toHaveBeenCalledWith({ supplier: supplier._id });
  });

  test('calls mongoose.model with "Purchase" to get the Purchase model', async () => {
    const modelSpy = jest
      .spyOn(mongoose, 'model')
      .mockReturnValue({ countDocuments: jest.fn().mockResolvedValue(0) });
    await supplier.canBeDeleted();
    expect(modelSpy).toHaveBeenCalledWith('Purchase');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. schema indexes
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — schema indexes', () => {
  test('email field has unique:true option', () => {
    expect(p('email').options.unique).toBe(true);
  });

  test('schema has a text index on name and phone (defined via schema.index)', () => {
    const indexes = schema.indexes();
    const textIndex = indexes.find(([fields]) => fields.name === 'text' || fields.phone === 'text');
    expect(textIndex).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. Document instance — defaults and field storage
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier — document instance defaults and field storage', () => {
  let doc;
  beforeEach(() => {
    doc = new Supplier(validData());
  });

  test('a new document gets an _id automatically', () => {
    expect(doc._id).toBeDefined();
    expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('gst_type defaults to "regular" when not provided', () => {
    expect(doc.gst_type).toBe('regular');
  });

  test('status defaults to "active" when not provided', () => {
    expect(doc.status).toBe('active');
  });

  test('balance defaults to 0 when not provided', () => {
    expect(doc.balance).toBe(0);
  });

  test('stores provided name correctly', () => {
    expect(doc.name).toBe('Acme Supplies Ltd');
  });

  test('stores provided gst_number correctly', () => {
    expect(doc.gst_number).toBe('GSTIN123456');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. Contrast with supplier-legacy.model.js
// ══════════════════════════════════════════════════════════════════════════════
describe('Supplier vs supplier-legacy.model.js — architectural comparison', () => {
  test('supplier.model.js is a Mongoose model (has .schema) — legacy uses BaseModel (native driver)', () => {
    expect(Supplier.schema).toBeInstanceOf(mongoose.Schema);
  });

  test('supplier.model.js has a balance field — absent in supplier-legacy.model.js', () => {
    expect(p('balance')).toBeDefined();
    expect(p('balance').instance).toBe('Number');
  });

  test('supplier.model.js has a status field with enum — absent in supplier-legacy.model.js', () => {
    expect(p('status')).toBeDefined();
    expect(p('status').enumValues).toEqual(['active', 'inactive']);
  });

  test('supplier.model.js has NO branch_id / license (no tenant isolation) — legacy has both', () => {
    expect(p('branch_id')).toBeUndefined();
    expect(p('license')).toBeUndefined();
  });

  test('gst_type is enum-constrained in supplier.model.js — free-form String in legacy', () => {
    expect(p('gst_type').enumValues).toEqual(['regular', 'composition', 'unregistered']);
  });
});
