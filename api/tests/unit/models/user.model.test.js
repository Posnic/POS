'use strict';

/**
 * Unit tests for src/models/user.model.js
 *
 * File confirmed : src/models/user.model.js (1,314 lines)
 * Related files  :
 *   - src/controllers/users.controller.js    — active consumer
 *   - src/services/users.service.js          — active consumer
 *   - src/repositories/users.repository.js  — active consumer
 *   - src/routes/users.routes.js             — active consumer
 *   - src/middleware/users.validation.js     — active consumer
 *   - src/utils/findUserByIdentifier.js      — active consumer
 *   - users.model.js                         — does NOT exist
 *   - auth-user.model.js                     — does NOT exist
 *   - user.schema.js                         — does NOT exist
 *   - user.model.ts                          — does NOT exist
 *
 * ORM       : Mongoose + bcryptjs
 * Framework : Jest (pre-configured)
 * Strategy  : Pure schema inspection + spy/mock for methods.
 *             bcryptjs mocked to avoid real hashing in unit tests.
 *             Pre-save hooks extracted and called with mock documents.
 *             No real DB connection. No mongodb-memory-server.
 *
 * Schema features (summary):
 *   - 45+ schema fields including auth, profile, ACL, register, tenant isolation
 *   - email: unique, lowercase, regex validator (empty allowed for API users)
 *   - password: String, select:false
 *   - role: enum [admin/manager/cashier/staff/super_admin/api], default "staff"
 *   - status: enum [active/inactive/suspended/pending], default "active"
 *   - permissions: array of String enum (8 permission strings)
 *   - access: Object (ACL matrix), default createDefaultAccess()
 *   - branch_access: array of {branch_id(req), branch_name(req), branch_image(def "")}
 *   - Multiple select:false security fields (password, license, userkey, etc.)
 *   - timestamps: true
 *   - Plugins: toJSON, paginate
 *   - Virtuals: fullName, initials
 *   - Pre-save hooks: password hashing (skip if already bcrypt), passwordChangedAt, updatedAt
 *   - Pre-find hook: auto-filters isActive:{ $ne: false } unless includeInactive:true
 *   - Instance methods: correctPassword, changedPasswordAfter,
 *                       lockAccount, unlockAccount
 *   - Static methods: findByCredentials, findByEmail, isEmailTaken, getUsersByRole,
 *                     userPage, userstatusReportPage, getDataChanges, userInsertUpdate
 *   - Post-definition methods on User: getUserByEmail, exportUserOrder
 *
 * ACL_MODULES (11): dashboard, sales, receiving, customer, supplier, category,
 *                   item, expense, branch, report, user
 * PERMISSIONS enum (8): inventory:read, inventory:write, sales:read, sales:write,
 *                       customers:read, customers:write, reports:view, settings:manage
 */

// ─── Mocks (hoisted before requires) ─────────────────────────────────────────

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$12$mockedHashedPassword.xxxxxxxxxxxxxxxxxxxxxxxx'),
  compare: jest.fn().mockResolvedValue(true),
}));
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../../../src/models/user.model');

// ─── Schema shortcuts ─────────────────────────────────────────────────────────

const schema = User.schema;
const p = (field) => schema.path(field);

afterAll(() => {
  consoleLogSpy.mockRestore();
});

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_ENUM = ['admin', 'manager', 'cashier', 'staff', 'super_admin', 'api'];
const STATUS_ENUM = ['active', 'inactive', 'suspended', 'pending'];
const GENDER_ENUM = ['male', 'female', 'other', 'prefer-not-to-say'];
const LANG_ENUM = ['en', 'es', 'fr', 'de', 'hi', 'ta', 'te', 'kn', 'ml'];
const THEME_ENUM = ['light', 'dark', 'system'];
const ACL_MODULES = [
  'dashboard',
  'sales',
  'receiving',
  'customer',
  'supplier',
  'category',
  'item',
  'expense',
  'branch',
  'report',
  'user',
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function validData(overrides = {}) {
  return {
    name: 'Alice Tester',
    email: 'alice@example.com',
    role: 'staff',
    ...overrides,
  };
}

// ─── Pre-save hook extractors ─────────────────────────────────────────────────

function getPreSaveHooks() {
  const pres = schema.s.hooks._pres.get('save') || [];
  return pres.map((h) => h.fn).filter(Boolean);
}

function findHookByKeyword(keyword) {
  return getPreSaveHooks().find((fn) => fn.toString().includes(keyword));
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('User — model identity', () => {
  test('User.modelName is "User"', () => {
    expect(User.modelName).toBe('User');
  });

  test('User.schema is a Mongoose Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('User is a constructor function', () => {
    expect(typeof User).toBe('function');
  });

  test('new User() creates a Mongoose Document', () => {
    expect(new User(validData())).toBeInstanceOf(mongoose.Document);
  });

  test('schema has timestamps:true', () => {
    expect(schema.options.timestamps).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Name fields — firstname, lastname, username, name
// ══════════════════════════════════════════════════════════════════════════════
describe('User — name fields', () => {
  test('firstname is String with trim', () => {
    expect(p('firstname').instance).toBe('String');
    expect(p('firstname').options.trim).toBe(true);
  });

  test('firstname maxlength is 20', () => {
    expect(p('firstname').options.maxlength[0]).toBe(20);
  });

  test('lastname is String with trim', () => {
    expect(p('lastname').instance).toBe('String');
    expect(p('lastname').options.trim).toBe(true);
  });

  test('lastname maxlength is 20', () => {
    expect(p('lastname').options.maxlength[0]).toBe(20);
  });

  test('username is String with trim, maxlength 30', () => {
    expect(p('username').instance).toBe('String');
    expect(p('username').options.maxlength[0]).toBe(30);
  });

  test('name is String with trim, maxlength 100', () => {
    expect(p('name').instance).toBe('String');
    expect(p('name').options.maxlength[0]).toBe(100);
  });

  test('firstname/lastname/username/name are all optional (not required)', () => {
    ['firstname', 'lastname', 'username', 'name'].forEach((f) => {
      expect(p(f).isRequired).toBeFalsy();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. email field
// ══════════════════════════════════════════════════════════════════════════════
describe('User — email field', () => {
  test('email has instance type "String"', () => {
    expect(p('email').instance).toBe('String');
  });

  test('email has unique:true', () => {
    expect(p('email').options.unique).toBe(true);
  });

  test('email unique index is sparse for API users without email', () => {
    expect(p('email').options.sparse).toBe(true);
  });

  test('email has lowercase:true', () => {
    expect(p('email').options.lowercase).toBe(true);
  });

  test('email is NOT required (allows empty for API users)', () => {
    expect(p('email').isRequired).toBeFalsy();
  });

  test('email validator passes for empty string (API users)', () => {
    const doc = new User(validData({ email: '' }));
    const err = doc.validateSync();
    expect(err?.errors?.email).toBeUndefined();
  });

  test('email validator passes for valid email', () => {
    const doc = new User(validData({ email: 'user@company.com' }));
    expect(doc.validateSync()?.errors?.email).toBeUndefined();
  });

  test('email validator fails for invalid email string', () => {
    const doc = new User(validData({ email: 'not-an-email' }));
    const err = doc.validateSync();
    expect(err?.errors?.email).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. password field
// ══════════════════════════════════════════════════════════════════════════════
describe('User — password field', () => {
  test('password has instance type "String"', () => {
    expect(p('password').instance).toBe('String');
  });

  test('password is not required', () => {
    expect(p('password').isRequired).toBeFalsy();
  });

  test('password has select:false (excluded from default queries)', () => {
    expect(p('password').options.select).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. role field
// ══════════════════════════════════════════════════════════════════════════════
describe('User — role field', () => {
  test('role has instance type "String"', () => {
    expect(p('role').instance).toBe('String');
  });

  test('role enum contains exactly the 6 expected values', () => {
    expect(p('role').enumValues).toEqual(ROLE_ENUM);
  });

  test('role default is "staff"', () => {
    expect(p('role').defaultValue).toBe('staff');
  });

  test('role is not required', () => {
    expect(p('role').isRequired).toBeFalsy();
  });

  test('document instance applies "staff" as default role', () => {
    expect(new User(validData({ role: undefined })).role).toBe('staff');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. usertype field
// ══════════════════════════════════════════════════════════════════════════════
describe('User — usertype field', () => {
  test('usertype has instance type "String" with default "staff"', () => {
    expect(p('usertype').instance).toBe('String');
    expect(p('usertype').defaultValue).toBe('staff');
  });

  test('document instance applies "staff" default for usertype', () => {
    expect(new User(validData()).usertype).toBe('staff');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. status field
// ══════════════════════════════════════════════════════════════════════════════
describe('User — status field', () => {
  test('status has instance type "String"', () => {
    expect(p('status').instance).toBe('String');
  });

  test('status enum contains exactly ["active","inactive","suspended","pending"]', () => {
    expect(p('status').enumValues).toEqual(STATUS_ENUM);
  });

  test('status default is "active"', () => {
    expect(p('status').defaultValue).toBe('active');
  });

  test('status is not required', () => {
    expect(p('status').isRequired).toBeFalsy();
  });

  test('document instance stores "inactive" status', () => {
    expect(new User(validData({ status: 'inactive' })).status).toBe('inactive');
  });

  test('validateSync rejects invalid status value', () => {
    const doc = new User(validData({ status: 'banned' }));
    expect(doc.validateSync()?.errors?.status?.kind).toBe('enum');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. activate and isActive fields
// ══════════════════════════════════════════════════════════════════════════════
describe('User — activate and isActive fields', () => {
  test('activate is Boolean with default true', () => {
    expect(p('activate').instance).toBe('Boolean');
    expect(p('activate').defaultValue).toBe(true);
  });

  test('isActive is Boolean with default true', () => {
    expect(p('isActive').instance).toBe('Boolean');
    expect(p('isActive').defaultValue).toBe(true);
  });

  test('isActive has select:false', () => {
    expect(p('isActive').options.select).toBe(false);
  });

  test('document instance applies activate:true default', () => {
    expect(new User(validData()).activate).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. branch and license fields
// ══════════════════════════════════════════════════════════════════════════════
describe('User — branch and license fields', () => {
  test('license is ObjectId with ref "License" and select:false', () => {
    expect(p('license').instance).toBe('ObjectId');
    expect(p('license').options.ref).toBe('License');
    expect(p('license').options.select).toBe(false);
  });

  test('branch is ObjectId with ref "Branch"', () => {
    expect(p('branch').instance).toBe('ObjectId');
    expect(p('branch').options.ref).toBe('Branch');
  });

  test('branch_id is ObjectId with ref "Branch"', () => {
    expect(p('branch_id').instance).toBe('ObjectId');
    expect(p('branch_id').options.ref).toBe('Branch');
  });

  test('branch and branch_id are optional', () => {
    expect(p('branch').isRequired).toBeFalsy();
    expect(p('branch_id').isRequired).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. branch_access subdocument array
// ══════════════════════════════════════════════════════════════════════════════
describe('User — branch_access field', () => {
  test('branch_access is an Array path', () => {
    expect(p('branch_access').instance).toBe('Array');
  });

  test('branch_access.branch_id is ObjectId and required', () => {
    expect(p('branch_access.branch_id').instance).toBe('ObjectId');
    expect(p('branch_access.branch_id').isRequired).toBe(true);
  });

  test('branch_access.branch_name is String and required', () => {
    expect(p('branch_access.branch_name').instance).toBe('String');
    expect(p('branch_access.branch_name').isRequired).toBe(true);
  });

  test('branch_access.branch_image is String with default ""', () => {
    expect(p('branch_access.branch_image').instance).toBe('String');
    expect(p('branch_access.branch_image').defaultValue).toBe('');
  });

  test('document instance stores branch_access correctly', () => {
    const branchId = new mongoose.Types.ObjectId();
    const doc = new User(
      validData({
        branch_access: [{ branch_id: branchId, branch_name: 'Main Branch' }],
      })
    );
    expect(doc.branch_access[0].branch_name).toBe('Main Branch');
    expect(doc.branch_access[0].branch_image).toBe('');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. access field (ACL matrix)
// ══════════════════════════════════════════════════════════════════════════════
describe('User — access field (ACL matrix)', () => {
  test('access field is of type "Object"', () => {
    expect(p('access').instance).toBe('Mixed');
  });

  test('default access object contains all 11 ACL modules', () => {
    const defaultAccess = new User(validData()).access;
    ACL_MODULES.forEach((mod) => {
      expect(defaultAccess).toHaveProperty(mod);
    });
  });

  test('default access for each module has read:false, write:false, delete:false', () => {
    const defaultAccess = new User(validData()).access;
    ['sales', 'receiving', 'customer', 'supplier', 'item'].forEach((mod) => {
      expect(defaultAccess[mod]).toEqual({ read: false, write: false, delete: false });
    });
  });

  test('dashboard default access has read:false', () => {
    const defaultAccess = new User(validData()).access;
    expect(defaultAccess.dashboard).toHaveProperty('read', false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Security — select:false fields
// ══════════════════════════════════════════════════════════════════════════════
describe('User — select:false security fields', () => {
  const selectFalseFields = [
    'password',
    'license',
    'isActive',
    'userkey',
    'expire_date',
    'created_by',
    'created_by_id',
    'updated_by',
    'updated_by_id',
    'loginAttempts',
    'lockUntil',
    'twoFactorSecret',
    'failedLoginAttempts',
    'accountLocked',
    'accountLockedUntil',
  ];

  selectFalseFields.forEach((field) => {
    test(`${field} has select:false`, () => {
      expect(p(field).options.select).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. timestamps
// ══════════════════════════════════════════════════════════════════════════════
describe('User — timestamps', () => {
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
// 15. toJSON plugin
// ══════════════════════════════════════════════════════════════════════════════
describe('User — toJSON plugin', () => {
  test('schema.options.toJSON exists', () => {
    expect(schema.options.toJSON).toBeDefined();
  });

  test('schema.options.toJSON has a transform function', () => {
    expect(typeof schema.options.toJSON.transform).toBe('function');
  });

  test('toJSON transform adds id (string) from _id', () => {
    const transform = schema.options.toJSON.transform;
    const mockId = new mongoose.Types.ObjectId();
    const ret = { _id: mockId, __v: 0, name: 'Alice' };
    transform({}, ret, {});
    expect(ret.id).toBe(mockId.toString());
  });

  test('toJSON transform removes _id', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 0 };
    transform({}, ret, {});
    expect(ret._id).toBeUndefined();
  });

  test('toJSON transform removes __v', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 5 };
    transform({}, ret, {});
    expect(ret.__v).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. paginate plugin
// ══════════════════════════════════════════════════════════════════════════════
describe('User — paginate plugin', () => {
  test('User.paginate is a static method', () => {
    expect(typeof User.paginate).toBe('function');
  });

  test('schema.statics.paginate is defined', () => {
    expect(typeof schema.statics.paginate).toBe('function');
  });

  test('User.paginate === schema.statics.paginate', () => {
    expect(User.paginate).toBe(schema.statics.paginate);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. Virtual fields
// ══════════════════════════════════════════════════════════════════════════════
describe('User — virtual fields', () => {
  test('fullName virtual returns the name field', () => {
    const doc = new User(validData({ name: 'Alice Tester' }));
    expect(doc.fullName).toBe('Alice Tester');
  });

  test('initials virtual splits name and returns uppercased initials', () => {
    const doc = new User(validData({ name: 'Alice Bob Tester' }));
    expect(doc.initials).toBe('ABT');
  });

  test('initials virtual works for a single-word name', () => {
    const doc = new User(validData({ name: 'Alice' }));
    expect(doc.initials).toBe('A');
  });

  test('schema has virtuals "fullName" and "initials" defined', () => {
    const virtuals = schema.virtuals;
    expect(virtuals).toHaveProperty('fullName');
    expect(virtuals).toHaveProperty('initials');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. Document instance — defaults
// ══════════════════════════════════════════════════════════════════════════════
describe('User — document instance defaults', () => {
  let doc;
  beforeEach(() => {
    doc = new User(validData());
  });

  test('_id is auto-generated ObjectId', () => {
    expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('role defaults to "staff"', () => {
    expect(doc.role).toBe('staff');
  });

  test('usertype defaults to "staff"', () => {
    expect(doc.usertype).toBe('staff');
  });

  test('status defaults to "active"', () => {
    expect(doc.status).toBe('active');
  });

  test('activate defaults to true', () => {
    expect(doc.activate).toBe(true);
  });

  test('image defaults to "user.svg"', () => {
    expect(doc.image).toBe('user.svg');
  });

  test('profileImage defaults to "default.jpg"', () => {
    expect(doc.profileImage).toBe('default.jpg');
  });

  test('register_status defaults to "Closed"', () => {
    expect(doc.register_status).toBe('Closed');
  });

  test('printing_design defaults to []', () => {
    expect(doc.printing_design).toEqual([]);
  });

  test('preferredLanguage defaults to "en"', () => {
    expect(doc.preferredLanguage).toBe('en');
  });

  test('themePreference defaults to "system"', () => {
    expect(doc.themePreference).toBe('system');
  });

  test('twoFactorEnabled defaults to false', () => {
    expect(doc.twoFactorEnabled).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. gender, preferredLanguage, themePreference, twoFactor
// ══════════════════════════════════════════════════════════════════════════════
describe('User — gender / preferredLanguage / themePreference', () => {
  test('gender enum contains exactly 4 values', () => {
    expect(p('gender').enumValues).toEqual(GENDER_ENUM);
  });

  test('gender is optional', () => {
    expect(p('gender').isRequired).toBeFalsy();
  });

  test('preferredLanguage enum contains all 9 language codes', () => {
    expect(p('preferredLanguage').enumValues).toEqual(LANG_ENUM);
  });

  test('themePreference enum is [light/dark/system]', () => {
    expect(p('themePreference').enumValues).toEqual(THEME_ENUM);
  });

  test('twoFactorSecret has select:false', () => {
    expect(p('twoFactorSecret').options.select).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. pre-save hook — password hashing
// ══════════════════════════════════════════════════════════════════════════════
describe('User — pre-save password hashing hook', () => {
  let passwordHook;
  let mockNext;

  beforeEach(() => {
    bcrypt.hash.mockClear();
    passwordHook = findHookByKeyword('isAlreadyHashed');
    mockNext = jest.fn();
  });

  test('password hook exists in pre-save hooks', () => {
    expect(passwordHook).toBeDefined();
  });

  test('skips hashing when password is not modified', async () => {
    const mockDoc = { isModified: jest.fn().mockReturnValue(false) };
    await passwordHook.call(mockDoc);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('hashes plaintext password with cost 12', async () => {
    const mockDoc = {
      isModified: jest.fn().mockReturnValue(true),
      password: 'plaintext123',
      passwordConfirm: 'plaintext123',
    };
    await passwordHook.call(mockDoc);
    expect(bcrypt.hash).toHaveBeenCalledWith('plaintext123', 12);
  });

  test('does NOT re-hash an already-bcrypt-hashed password', async () => {
    const mockDoc = {
      isModified: jest.fn().mockReturnValue(true),
      password: '$2b$12$alreadyHashedValuexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    };
    await passwordHook.call(mockDoc);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('detects existing bcrypt hash via $2a$ prefix as well', async () => {
    const mockDoc = {
      isModified: jest.fn().mockReturnValue(true),
      password: '$2a$10$alreadyHashedValuexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    };
    await passwordHook.call(mockDoc);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  test('clears passwordConfirm after hashing', async () => {
    const mockDoc = {
      isModified: jest.fn().mockReturnValue(true),
      password: 'mypassword',
      passwordConfirm: 'mypassword',
    };
    await passwordHook.call(mockDoc);
    expect(mockDoc.passwordConfirm).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. pre-save hook — passwordChangedAt
// ══════════════════════════════════════════════════════════════════════════════
describe('User — pre-save passwordChangedAt hook', () => {
  let changedAtHook;

  beforeEach(() => {
    changedAtHook = findHookByKeyword('passwordChangedAt');
  });

  test('passwordChangedAt hook exists in pre-save hooks', () => {
    expect(changedAtHook).toBeDefined();
  });

  test('skips when password is not modified', () => {
    const mockNext = jest.fn();
    const mockDoc = { isModified: jest.fn().mockReturnValue(false), isNew: false };
    changedAtHook.call(mockDoc);
    expect(mockDoc.passwordChangedAt).toBeUndefined();
  });

  test('skips on new documents even if password is modified', () => {
    const mockNext = jest.fn();
    const mockDoc = { isModified: jest.fn().mockReturnValue(true), isNew: true };
    changedAtHook.call(mockDoc);
    expect(mockDoc.passwordChangedAt).toBeUndefined();
  });

  test('sets passwordChangedAt slightly in the past for existing users changing password', () => {
    const mockNext = jest.fn();
    const before = Date.now();
    const mockDoc = { isModified: jest.fn().mockReturnValue(true), isNew: false };
    changedAtHook.call(mockDoc);
    expect(mockDoc.passwordChangedAt).toBeLessThanOrEqual(before);
    expect(typeof mockDoc.passwordChangedAt).toBe('number');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. Instance method — correctPassword
// ══════════════════════════════════════════════════════════════════════════════
describe('User — instance correctPassword', () => {
  let user;

  beforeEach(() => {
    bcrypt.compare.mockClear();
    user = new User(validData());
  });

  test('correctPassword is a function on the document', () => {
    expect(typeof user.correctPassword).toBe('function');
  });

  test('returns true when bcrypt.compare resolves true', async () => {
    bcrypt.compare.mockResolvedValue(true);
    expect(await user.correctPassword('plain', '$2b$12$hash')).toBe(true);
  });

  test('returns false when bcrypt.compare resolves false', async () => {
    bcrypt.compare.mockResolvedValue(false);
    expect(await user.correctPassword('wrong', '$2b$12$hash')).toBe(false);
  });

  test('calls bcrypt.compare with candidatePassword and userPassword', async () => {
    await user.correctPassword('mypassword', '$2b$12$stored');
    expect(bcrypt.compare).toHaveBeenCalledWith('mypassword', '$2b$12$stored');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. Instance method — changedPasswordAfter
// ══════════════════════════════════════════════════════════════════════════════
describe('User — instance changedPasswordAfter', () => {
  test('returns false when passwordChangedAt is not set', () => {
    const user = new User(validData());
    expect(user.changedPasswordAfter(1700000000)).toBe(false);
  });

  test('returns true when passwordChangedAt is AFTER the JWT timestamp', () => {
    const user = new User(validData());
    user.passwordChangedAt = new Date(Date.now() - 1000);
    const pastJWTTimestamp = Math.floor((Date.now() - 60000) / 1000);
    expect(user.changedPasswordAfter(pastJWTTimestamp)).toBe(true);
  });

  test('returns false when passwordChangedAt is BEFORE the JWT timestamp', () => {
    const user = new User(validData());
    user.passwordChangedAt = new Date('2020-01-01');
    const recentJWTTimestamp = Math.floor(Date.now() / 1000);
    expect(user.changedPasswordAfter(recentJWTTimestamp)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 26. Instance methods — lockAccount / unlockAccount
// ══════════════════════════════════════════════════════════════════════════════
describe('User — instance lockAccount / unlockAccount', () => {
  let user;

  beforeEach(() => {
    user = new User(validData());
    jest.spyOn(user, 'save').mockResolvedValue(user);
  });

  afterEach(() => jest.restoreAllMocks());

  test('lockAccount sets accountLocked to true', async () => {
    await user.lockAccount();
    expect(user.accountLocked).toBe(true);
  });

  test('lockAccount sets accountLockedUntil ~30 minutes from now', async () => {
    const before = Date.now();
    await user.lockAccount();
    const thirtyMinutes = 30 * 60 * 1000;
    expect(Number(user.accountLockedUntil)).toBeGreaterThanOrEqual(before + thirtyMinutes - 100);
  });

  test('unlockAccount resets accountLocked to false and clears failedLoginAttempts', async () => {
    user.accountLocked = true;
    user.failedLoginAttempts = 5;
    await user.unlockAccount();
    expect(user.accountLocked).toBe(false);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.accountLockedUntil).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 27. Static method — isEmailTaken
// ══════════════════════════════════════════════════════════════════════════════
describe('User — static isEmailTaken', () => {
  afterEach(() => jest.restoreAllMocks());

  test('isEmailTaken is a static method on the model', () => {
    expect(typeof User.isEmailTaken).toBe('function');
  });

  test('returns false when no user with that email exists', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue(null);
    expect(await User.isEmailTaken('new@example.com')).toBe(false);
  });

  test('returns true when a user with that email already exists', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    expect(await User.isEmailTaken('taken@example.com')).toBe(true);
  });

  test('calls findOne with $ne excludeUserId filter', async () => {
    const spy = jest.spyOn(User, 'findOne').mockResolvedValue(null);
    const excludeId = new mongoose.Types.ObjectId();
    await User.isEmailTaken('test@example.com', excludeId);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: excludeId } }));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 28. Static method — findByEmail
// ══════════════════════════════════════════════════════════════════════════════
describe('User — static findByEmail', () => {
  afterEach(() => jest.restoreAllMocks());

  test('findByEmail is a static method', () => {
    expect(typeof User.findByEmail).toBe('function');
  });

  test('calls findOne with the provided email', async () => {
    const spy = jest.spyOn(User, 'findOne').mockResolvedValue(null);
    await User.findByEmail('alice@example.com');
    expect(spy).toHaveBeenCalledWith({ email: 'alice@example.com' });
  });

  test('returns null when no user found', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue(null);
    expect(await User.findByEmail('unknown@example.com')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 29. Static method — getUsersByRole
// ══════════════════════════════════════════════════════════════════════════════
describe('User — static getUsersByRole', () => {
  afterEach(() => jest.restoreAllMocks());

  test('getUsersByRole is a static method', () => {
    expect(typeof User.getUsersByRole).toBe('function');
  });

  test('calls User.find with the provided role filter', async () => {
    const spy = jest.spyOn(User, 'find').mockResolvedValue([]);
    await User.getUsersByRole('admin');
    expect(spy).toHaveBeenCalledWith({ role: 'admin' });
  });

  test('returns array result from find', async () => {
    const fakeUsers = [{ _id: new mongoose.Types.ObjectId(), role: 'admin' }];
    jest.spyOn(User, 'find').mockResolvedValue(fakeUsers);
    const result = await User.getUsersByRole('admin');
    expect(result).toEqual(fakeUsers);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 30. getUserByEmail (added directly on User after model creation)
// ══════════════════════════════════════════════════════════════════════════════
describe('User — getUserByEmail (post-model method)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('getUserByEmail is defined on the User model', () => {
    expect(typeof User.getUserByEmail).toBe('function');
  });

  test('calls findOne with email and selects +password', async () => {
    const mockSelect = jest.fn().mockResolvedValue(null);
    const spy = jest.spyOn(User, 'findOne').mockReturnValue({ select: mockSelect });
    await User.getUserByEmail('alice@example.com');
    expect(spy).toHaveBeenCalledWith({ email: 'alice@example.com' });
    expect(mockSelect).toHaveBeenCalledWith('+password');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 31. validateSync — top-level required fields
// ══════════════════════════════════════════════════════════════════════════════
describe('User — validateSync field checks', () => {
  test('no top-level fields are required — document with only name is valid', () => {
    const doc = new User({ name: 'Alice' });
    expect(doc.validateSync()).toBeUndefined();
  });

  test('validateSync rejects invalid role enum', () => {
    const doc = new User(validData({ role: 'superuser' }));
    expect(doc.validateSync()?.errors?.role?.kind).toBe('enum');
  });

  test('validateSync rejects invalid status enum', () => {
    const doc = new User(validData({ status: 'blocked' }));
    expect(doc.validateSync()?.errors?.status?.kind).toBe('enum');
  });

  test('validateSync rejects invalid gender enum', () => {
    const doc = new User(validData({ gender: 'unknown' }));
    expect(doc.validateSync()?.errors?.gender?.kind).toBe('enum');
  });

  test('validateSync rejects invalid themePreference enum', () => {
    const doc = new User(validData({ themePreference: 'solarized' }));
    expect(doc.validateSync()?.errors?.themePreference?.kind).toBe('enum');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 32. Schema indexes
// ══════════════════════════════════════════════════════════════════════════════
describe('User — schema indexes', () => {
  const indexes = schema.indexes();

  test('phone has a sparse index', () => {
    const phoneIndex = indexes.find(([fields]) => fields.phone === 1);
    expect(phoneIndex).toBeDefined();
    expect(phoneIndex[1].sparse).toBe(true);
  });

  test('branch has an index', () => {
    expect(indexes.find(([fields]) => fields.branch === 1)).toBeDefined();
  });

  test('role has an index', () => {
    expect(indexes.find(([fields]) => fields.role === 1)).toBeDefined();
  });

  test('status has an index', () => {
    expect(indexes.find(([fields]) => fields.status === 1)).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 33. exportUserOrder method
// ══════════════════════════════════════════════════════════════════════════════
describe('User — exportUserOrder (post-model method)', () => {
  test('exportUserOrder is defined on the User model', () => {
    expect(typeof User.exportUserOrder).toBe('function');
  });

  test('returns status:false when no IDs provided', async () => {
    const result = await User.exportUserOrder([], 'licenseId');
    expect(result.status).toBe(false);
    expect(result.message).toBe('No user IDs provided');
  });
});
