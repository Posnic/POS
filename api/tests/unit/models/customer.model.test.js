'use strict';

/**
 * Unit tests for src/models/customer.model.js
 *
 * File confirmed: src/models/customer.model.js  (only customer model — no duplicates)
 * ORM: Native MongoDB driver via BaseModel (class inheritance — NOT Mongoose)
 *
 * Strategy: Pure model unit tests + mocked BaseModel
 *  - BaseModel is mocked to prevent any real DB connection.
 *  - All meaningful behaviour lives in instance methods:
 *      validate()       — field validation logic
 *      getDefaultData() — default value structure
 *      sanitize()       — string trim / number parsing
 *  - this.fields (instance property set in constructor) is inspected directly
 *    for schema definitions, required flags, enums, and defaults.
 *  - No getCollection() calls are made by any of the tested methods.
 */

// ─── Mock (hoisted) ───────────────────────────────────────────────────────────

jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static mongoClient = {};
    static database = {};
    static currentBranch = null;
    static license = null;
    static loggedUser = null;
    static loggedUserName = null;

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    }
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const CustomerModel = require('../../../src/models/customer.model');
const MockBaseModel = require('../../../src/models/base.model');

// ─── Shared instance ──────────────────────────────────────────────────────────

let cm;

beforeEach(() => {
  jest.restoreAllMocks();
  cm = new CustomerModel();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Class structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — class structure', () => {
  test('module exports a class (function)', () => {
    expect(typeof CustomerModel).toBe('function');
  });

  test('instance is a subclass of MockBaseModel', () => {
    expect(cm).toBeInstanceOf(MockBaseModel);
  });

  test('constructor sets collectionName to "customers"', () => {
    expect(cm.collectionName).toBe('customers');
  });

  test('this.fields is an object defined on the instance', () => {
    expect(cm.fields).toBeDefined();
    expect(typeof cm.fields).toBe('object');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. this.fields — required fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: required fields', () => {
  test('name has required:true', () => {
    expect(cm.fields.name.required).toBe(true);
  });

  test('phone has required:true', () => {
    expect(cm.fields.phone.required).toBe(true);
  });

  test('license has required:true', () => {
    expect(cm.fields.license.required).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. this.fields — unique constraints
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: unique constraints', () => {
  test('email has unique:true', () => {
    expect(cm.fields.email.unique).toBe(true);
  });

  test('phone has unique:true', () => {
    expect(cm.fields.phone.unique).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. this.fields — select flags
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: select flags', () => {
  test('name, phone, email have select:true', () => {
    expect(cm.fields.name.select).toBe(true);
    expect(cm.fields.phone.select).toBe(true);
    expect(cm.fields.email.select).toBe(true);
  });

  test('branch_id and branch_name have select:true', () => {
    expect(cm.fields.branch_id.select).toBe(true);
    expect(cm.fields.branch_name.select).toBe(true);
  });

  test('is_deleted has select:true', () => {
    expect(cm.fields.is_deleted.select).toBe(true);
  });

  test('license has select:true', () => {
    expect(cm.fields.license.select).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. this.fields — field types
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: field types', () => {
  test('_id, branch_id, category_id, referrer_id, license, created_by_id, updated_by_id are ObjectId', () => {
    for (const f of [
      '_id',
      'branch_id',
      'category_id',
      'referrer_id',
      'license',
      'created_by_id',
      'updated_by_id',
    ]) {
      expect(cm.fields[f].type).toBe('ObjectId');
    }
  });

  test('name, branch_name, email, phone, address, city, state, country are String', () => {
    for (const f of [
      'name',
      'branch_name',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'country',
    ]) {
      expect(cm.fields[f].type).toBe('String');
    }
  });

  test('created_date, updated_date, deleted_date are Date', () => {
    for (const f of ['created_date', 'updated_date', 'deleted_date']) {
      expect(cm.fields[f].type).toBe('Date');
    }
  });

  test('is_deleted is Boolean', () => {
    expect(cm.fields.is_deleted.type).toBe('Boolean');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. this.fields — default values
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: default values', () => {
  test('country defaults to "India"', () => {
    expect(cm.fields.country.default).toBe('India');
  });

  test('gst defaults to "disable"', () => {
    expect(cm.fields.gst.default).toBe('disable');
  });

  test('gst_type defaults to "consumer"', () => {
    expect(cm.fields.gst_type.default).toBe('consumer');
  });

  test('status defaults to "active"', () => {
    expect(cm.fields.status.default).toBe('active');
  });

  test('is_deleted defaults to false', () => {
    expect(cm.fields.is_deleted.default).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. this.fields — enum values
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: enum values', () => {
  test('gst enum is ["enable", "disable"]', () => {
    expect(cm.fields.gst.enum).toEqual(['enable', 'disable']);
  });

  test('gst_type enum contains consumer, regular, composite, unregistered', () => {
    expect(cm.fields.gst_type.enum).toEqual(
      expect.arrayContaining(['consumer', 'regular', 'composite', 'unregistered'])
    );
  });

  test('status enum is ["active", "inactive", "blocked"]', () => {
    expect(cm.fields.status.enum).toEqual(['active', 'inactive', 'blocked']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. this.fields — nested loyalty definition
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: loyalty nested field', () => {
  test('loyalty.points has type Number and default 0 and min 0', () => {
    expect(cm.fields.loyalty.points.type).toBe(Number);
    expect(cm.fields.loyalty.points.default).toBe(0);
    expect(cm.fields.loyalty.points.min).toBe(0);
  });

  test('loyalty.tier enum contains bronze, silver, gold, platinum', () => {
    expect(cm.fields.loyalty.tier.enum).toEqual(
      expect.arrayContaining(['bronze', 'silver', 'gold', 'platinum'])
    );
    expect(cm.fields.loyalty.tier.default).toBe('bronze');
  });

  test('loyalty._id is false (suppress sub-document _id)', () => {
    expect(cm.fields.loyalty._id).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. this.fields — nested preferences definition
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: preferences nested field', () => {
  test('emailNotifications defaults to true', () => {
    expect(cm.fields.preferences.emailNotifications.default).toBe(true);
  });

  test('smsNotifications and whatsappNotifications default to true', () => {
    expect(cm.fields.preferences.smsNotifications.default).toBe(true);
    expect(cm.fields.preferences.whatsappNotifications.default).toBe(true);
  });

  test('preferredCommunication enum contains email, sms, whatsapp, any', () => {
    expect(cm.fields.preferences.preferredCommunication.enum).toEqual(
      expect.arrayContaining(['email', 'sms', 'whatsapp', 'any'])
    );
    expect(cm.fields.preferences.preferredCommunication.default).toBe('any');
  });

  test('preferences._id is false', () => {
    expect(cm.fields.preferences._id).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. this.fields — credit / stats fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: credit and stats fields', () => {
  test('creditLimit has type Number, default 0, min 0', () => {
    expect(cm.fields.creditLimit.type).toBe(Number);
    expect(cm.fields.creditLimit.default).toBe(0);
    expect(cm.fields.creditLimit.min).toBe(0);
  });

  test('currentBalance has type Number and default 0', () => {
    expect(cm.fields.currentBalance.type).toBe(Number);
    expect(cm.fields.currentBalance.default).toBe(0);
  });

  test('totalPurchases and totalSpent have default 0 and min 0', () => {
    expect(cm.fields.totalPurchases.default).toBe(0);
    expect(cm.fields.totalPurchases.min).toBe(0);
    expect(cm.fields.totalSpent.default).toBe(0);
    expect(cm.fields.totalSpent.min).toBe(0);
  });

  test('paymentTerms enum contains immediate, net15, net30, net60, net90, custom', () => {
    expect(cm.fields.paymentTerms.enum).toEqual(
      expect.arrayContaining(['immediate', 'net15', 'net30', 'net60', 'net90', 'custom'])
    );
    expect(cm.fields.paymentTerms.default).toBe('immediate');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. this.fields — email match regex
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: email regex pattern', () => {
  const emailRegex = () => cm.fields.email.match[0];

  test('email match[0] is a RegExp', () => {
    expect(emailRegex()).toBeInstanceOf(RegExp);
  });

  test('email regex accepts valid addresses', () => {
    const re = emailRegex();
    expect(re.test('user@example.com')).toBe(true);
    expect(re.test('first.last@domain.org')).toBe(true);
  });

  test('email regex rejects invalid addresses', () => {
    const re = emailRegex();
    expect(re.test('not-an-email')).toBe(false);
    expect(re.test('missing@domain')).toBe(false);
    expect(re.test('')).toBe(false);
  });

  test('email match[1] is the error message string', () => {
    expect(typeof cm.fields.email.match[1]).toBe('string');
    expect(cm.fields.email.match[1]).toMatch(/valid email/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. this.fields — gst_number match regex
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — this.fields: gst_number regex pattern', () => {
  const gstRegex = () => cm.fields.gst_number.match[0];

  test('gst_number match[0] is a RegExp', () => {
    expect(gstRegex()).toBeInstanceOf(RegExp);
  });

  test('gst_number regex accepts a valid GST number', () => {
    expect(gstRegex().test('29ABCDE1234F1Z5')).toBe(true);
  });

  test('gst_number regex rejects invalid GST numbers', () => {
    expect(gstRegex().test('INVALIDGST')).toBe(false);
    expect(gstRegex().test('12345')).toBe(false);
    expect(gstRegex().test('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. validate() — success cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — validate(): success cases', () => {
  test('returns valid:true for minimal required fields (name + phone)', () => {
    const r = cm.validate({ name: 'Alice', phone: '9876543210' });
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test('returns valid:true when optional email is absent', () => {
    const r = cm.validate({ name: 'Bob', phone: '9876543210' });
    expect(r.valid).toBe(true);
  });

  test('returns valid:true when email is a valid format', () => {
    const r = cm.validate({ name: 'Carol', phone: '9876543210', email: 'carol@example.com' });
    expect(r.valid).toBe(true);
  });

  test('returns valid:true with 10-digit phone', () => {
    const r = cm.validate({ name: 'Dave', phone: '1234567890' });
    expect(r.valid).toBe(true);
  });

  test('returns object with keys valid and errors', () => {
    const r = cm.validate({ name: 'Eve', phone: '9876543210' });
    expect(r).toHaveProperty('valid');
    expect(r).toHaveProperty('errors');
    expect(Array.isArray(r.errors)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. validate() — required field errors
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — validate(): required field errors', () => {
  test('returns error for missing name', () => {
    const r = cm.validate({ phone: '9876543210' });
    expect(r.valid).toBe(false);
    const nameErr = r.errors.find((e) => e.field === 'name');
    expect(nameErr).toBeDefined();
    expect(nameErr.message).toMatch(/name/i);
  });

  test('returns error for empty string name', () => {
    const r = cm.validate({ name: '', phone: '9876543210' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'name')).toBe(true);
  });

  test('returns error for missing phone', () => {
    const r = cm.validate({ name: 'Alice' });
    expect(r.valid).toBe(false);
    const phoneErr = r.errors.find((e) => e.field === 'phone');
    expect(phoneErr).toBeDefined();
    expect(phoneErr.message).toMatch(/phone/i);
  });

  test('returns errors for both missing name AND phone', () => {
    const r = cm.validate({});
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.errors.some((e) => e.field === 'name')).toBe(true);
    expect(r.errors.some((e) => e.field === 'phone')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. validate() — email validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — validate(): email validation', () => {
  test('returns error for invalid email format', () => {
    const r = cm.validate({ name: 'Alice', phone: '9876543210', email: 'not-an-email' });
    expect(r.valid).toBe(false);
    const emailErr = r.errors.find((e) => e.field === 'email');
    expect(emailErr).toBeDefined();
    expect(emailErr.message).toMatch(/invalid email/i);
  });

  test('returns error when email has no domain extension', () => {
    const r = cm.validate({ name: 'Alice', phone: '9876543210', email: 'alice@nodomain' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'email')).toBe(true);
  });

  test('does NOT return email error when email field is absent', () => {
    const r = cm.validate({ name: 'Alice', phone: '9876543210' });
    expect(r.errors.some((e) => e.field === 'email')).toBe(false);
  });

  test('accepts email with dots and hyphens in local part', () => {
    const r = cm.validate({ name: 'Alice', phone: '9876543210', email: 'a.b-c@test.co' });
    expect(r.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. validate() — phone length validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — validate(): phone length validation', () => {
  test('returns error when phone has fewer than 10 digits', () => {
    const r = cm.validate({ name: 'Alice', phone: '98765' });
    expect(r.valid).toBe(false);
    const phoneErr = r.errors.find((e) => e.field === 'phone');
    expect(phoneErr).toBeDefined();
    expect(phoneErr.message).toMatch(/10 digits/i);
  });

  test('returns error for 9-character phone', () => {
    const r = cm.validate({ name: 'Alice', phone: '123456789' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'phone')).toBe(true);
  });

  test('accepts exactly 10-character phone', () => {
    const r = cm.validate({ name: 'Alice', phone: '1234567890' });
    expect(r.valid).toBe(true);
  });

  test('accepts phone longer than 10 characters', () => {
    const r = cm.validate({ name: 'Alice', phone: '+91-9876543210' });
    expect(r.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. validate() — GST number validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — validate(): GST number validation', () => {
  test('returns error when gst is "enabled" and gst_number is invalid', () => {
    const r = cm.validate({
      name: 'Alice',
      phone: '9876543210',
      gst: 'enabled',
      gst_number: 'BADGST',
    });
    expect(r.valid).toBe(false);
    const gstErr = r.errors.find((e) => e.field === 'gst_number');
    expect(gstErr).toBeDefined();
    expect(gstErr.message).toMatch(/GST/i);
  });

  test('returns no GST error when gst is "enabled" and gst_number is valid', () => {
    const r = cm.validate({
      name: 'Alice',
      phone: '9876543210',
      gst: 'enabled',
      gst_number: '29ABCDE1234F1Z5',
    });
    expect(r.errors.some((e) => e.field === 'gst_number')).toBe(false);
  });

  test('skips GST number check when gst is "disable"', () => {
    const r = cm.validate({
      name: 'Alice',
      phone: '9876543210',
      gst: 'disable',
      gst_number: 'BADGST',
    });
    expect(r.errors.some((e) => e.field === 'gst_number')).toBe(false);
  });

  test('skips GST check when gst_number is absent even if gst is "enabled"', () => {
    const r = cm.validate({
      name: 'Alice',
      phone: '9876543210',
      gst: 'enabled',
    });
    expect(r.errors.some((e) => e.field === 'gst_number')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. getDefaultData() — structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — getDefaultData(): structure', () => {
  let d;
  beforeEach(() => {
    d = cm.getDefaultData();
  });

  test('returns an object', () => {
    expect(typeof d).toBe('object');
    expect(d).not.toBeNull();
  });

  test('name defaults to empty string', () => {
    expect(d.name).toBe('');
  });

  test('email and phone default to empty string', () => {
    expect(d.email).toBe('');
    expect(d.phone).toBe('');
  });

  test('country defaults to "India"', () => {
    expect(d.country).toBe('India');
  });

  test('address, city, state, pincode default to empty string', () => {
    expect(d.address).toBe('');
    expect(d.city).toBe('');
    expect(d.state).toBe('');
    expect(d.pincode).toBe('');
  });

  test('gst defaults to "disable" and gst_type to "consumer"', () => {
    expect(d.gst).toBe('disable');
    expect(d.gst_type).toBe('consumer');
  });

  test('status defaults to "active"', () => {
    expect(d.status).toBe('active');
  });

  test('is_deleted defaults to false', () => {
    expect(d.is_deleted).toBe(false);
  });

  test('tags defaults to empty array', () => {
    expect(Array.isArray(d.tags)).toBe(true);
    expect(d.tags).toHaveLength(0);
  });

  test('totalPurchases, totalSpent, creditLimit, currentBalance default to 0', () => {
    expect(d.totalPurchases).toBe(0);
    expect(d.totalSpent).toBe(0);
    expect(d.creditLimit).toBe(0);
    expect(d.currentBalance).toBe(0);
  });

  test('paymentTerms defaults to "immediate"', () => {
    expect(d.paymentTerms).toBe('immediate');
  });

  test('category_id and referrer_id default to null', () => {
    expect(d.category_id).toBeNull();
    expect(d.referrer_id).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19. getDefaultData() — loyalty sub-object
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — getDefaultData(): loyalty sub-object', () => {
  let loyalty;
  beforeEach(() => {
    loyalty = cm.getDefaultData().loyalty;
  });

  test('loyalty.points is 0', () => {
    expect(loyalty.points).toBe(0);
  });
  test('loyalty.pointsEarned is 0', () => {
    expect(loyalty.pointsEarned).toBe(0);
  });
  test('loyalty.pointsRedeemed is 0', () => {
    expect(loyalty.pointsRedeemed).toBe(0);
  });
  test('loyalty.tier is "bronze"', () => {
    expect(loyalty.tier).toBe('bronze');
  });
  test('loyalty.lastUpdated is a Date', () => {
    expect(loyalty.lastUpdated).toBeInstanceOf(Date);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 20. getDefaultData() — preferences sub-object
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — getDefaultData(): preferences sub-object', () => {
  let prefs;
  beforeEach(() => {
    prefs = cm.getDefaultData().preferences;
  });

  test('emailNotifications is true', () => {
    expect(prefs.emailNotifications).toBe(true);
  });
  test('smsNotifications is true', () => {
    expect(prefs.smsNotifications).toBe(true);
  });
  test('whatsappNotifications is true', () => {
    expect(prefs.whatsappNotifications).toBe(true);
  });
  test('preferredCommunication is "any"', () => {
    expect(prefs.preferredCommunication).toBe('any');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 21. getDefaultData() — independence (no shared references)
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — getDefaultData(): object independence', () => {
  test('each call returns a fresh object (not the same reference)', () => {
    const a = cm.getDefaultData();
    const b = cm.getDefaultData();
    expect(a).not.toBe(b);
  });

  test('mutating loyalty on one result does not affect next call', () => {
    const a = cm.getDefaultData();
    a.loyalty.points = 999;
    const b = cm.getDefaultData();
    expect(b.loyalty.points).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 22. sanitize() — string trimming
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — sanitize(): string trimming', () => {
  test('trims whitespace from name', () => {
    const r = cm.sanitize({ name: '  Alice  ' });
    expect(r.name).toBe('Alice');
  });

  test('trims and lowercases email', () => {
    const r = cm.sanitize({ email: '  Alice@EXAMPLE.com  ' });
    expect(r.email).toBe('alice@example.com');
  });

  test('trims phone', () => {
    const r = cm.sanitize({ phone: '  9876543210  ' });
    expect(r.phone).toBe('9876543210');
  });

  test('trims address', () => {
    const r = cm.sanitize({ address: '  123 Main St  ' });
    expect(r.address).toBe('123 Main St');
  });

  test('trims city', () => {
    const r = cm.sanitize({ city: '  Mumbai  ' });
    expect(r.city).toBe('Mumbai');
  });

  test('trims state', () => {
    const r = cm.sanitize({ state: '  Maharashtra  ' });
    expect(r.state).toBe('Maharashtra');
  });

  test('trims all string fields in a single call', () => {
    const r = cm.sanitize({
      name: ' A ',
      email: ' A@B.com ',
      phone: ' 1234567890 ',
      address: ' Addr ',
      city: ' C ',
      state: ' S ',
    });
    expect(r.name).toBe('A');
    expect(r.email).toBe('a@b.com');
    expect(r.phone).toBe('1234567890');
    expect(r.address).toBe('Addr');
    expect(r.city).toBe('C');
    expect(r.state).toBe('S');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 23. sanitize() — numeric parsing
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — sanitize(): numeric parsing', () => {
  test('parses creditLimit string to float', () => {
    const r = cm.sanitize({ creditLimit: '1500.75' });
    expect(r.creditLimit).toBe(1500.75);
  });

  test('parses currentBalance string to float', () => {
    const r = cm.sanitize({ currentBalance: '250.50' });
    expect(r.currentBalance).toBe(250.5);
  });

  test('converts invalid creditLimit string to 0', () => {
    const r = cm.sanitize({ creditLimit: 'abc' });
    expect(r.creditLimit).toBe(0);
  });

  test('converts invalid currentBalance string to 0', () => {
    const r = cm.sanitize({ currentBalance: 'xyz' });
    expect(r.currentBalance).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 24. sanitize() — loyalty numeric parsing
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — sanitize(): loyalty numeric parsing', () => {
  test('converts loyalty.points string to int', () => {
    const r = cm.sanitize({ loyalty: { points: '150' } });
    expect(r.loyalty.points).toBe(150);
  });

  test('converts loyalty.pointsEarned string to int', () => {
    const r = cm.sanitize({ loyalty: { pointsEarned: '75' } });
    expect(r.loyalty.pointsEarned).toBe(75);
  });

  test('converts loyalty.pointsRedeemed string to int', () => {
    const r = cm.sanitize({ loyalty: { pointsRedeemed: '30' } });
    expect(r.loyalty.pointsRedeemed).toBe(30);
  });

  test('converts invalid loyalty.points string to 0', () => {
    const r = cm.sanitize({ loyalty: { points: 'bad' } });
    expect(r.loyalty.points).toBe(0);
  });

  test('truncates decimal loyalty.points to integer', () => {
    const r = cm.sanitize({ loyalty: { points: '49.9' } });
    expect(r.loyalty.points).toBe(49);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 25. sanitize() — immutability and edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe('CustomerModel — sanitize(): immutability and edge cases', () => {
  test('does not mutate the original object', () => {
    const original = { name: '  Alice  ' };
    cm.sanitize(original);
    expect(original.name).toBe('  Alice  ');
  });

  test('returns a new object (not the same reference)', () => {
    const original = { name: 'Alice' };
    const result = cm.sanitize(original);
    expect(result).not.toBe(original);
  });

  test('leaves fields unchanged when no sanitization applies', () => {
    const r = cm.sanitize({ notes: 'A note', tags: ['vip'] });
    expect(r.notes).toBe('A note');
    expect(r.tags).toEqual(['vip']);
  });

  test('does not crash when loyalty is absent', () => {
    expect(() => cm.sanitize({ name: 'Alice' })).not.toThrow();
  });

  test('does not crash when called with empty object', () => {
    expect(() => cm.sanitize({})).not.toThrow();
  });

  test('handles zero creditLimit without converting to 0 (falsy skip)', () => {
    const r = cm.sanitize({ creditLimit: 0 });
    expect(r.creditLimit).toBe(0);
  });
});
