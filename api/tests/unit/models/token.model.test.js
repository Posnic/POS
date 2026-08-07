'use strict';

/**
 * Unit tests for src/models/token.model.js
 *
 * File confirmed : src/models/token.model.js (49 lines)
 * Related files  :
 *   - src/config/tokens.js   — tokenTypes + tokenExpiration constants imported by this model
 *   - src/services/token.service.js — service layer that creates/validates tokens
 *   - src/utils/token.js     — JWT sign/verify utilities
 *   - tokens.model.js        — does NOT exist
 *   - auth-token.model.js    — does NOT exist
 *   - refresh-token.model.js — does NOT exist
 *   - token.schema.js        — does NOT exist
 *   - token.model.ts         — does NOT exist
 *
 * ORM        : Mongoose
 * Framework  : Jest (pre-configured)
 * Strategy   : Pure schema inspection via schema.path() + doc.validateSync()
 *              No real DB connection. No mongodb-memory-server needed.
 *              Follows sale.model.test.js / supplier.model.test.js pattern.
 *
 * Schema fields (5):
 *   token       : String,  required, index:true  — raw JWT string
 *   user        : ObjectId, ref "User", required
 *   type        : String,  enum [refresh/resetPassword/verifyEmail], required
 *   expires     : Date,    required
 *   blacklisted : Boolean, default false
 *   createdAt   : Date (via timestamps:true)
 *   updatedAt   : Date (via timestamps:true)
 *
 * Plugins: toJSON (removes _id/__v, adds id string)
 * No static methods. No instance methods. No pre/post hooks.
 *
 * CRITICAL SECURITY BOUNDARY:
 *   tokenTypes.ACCESS ("access") is intentionally NOT in the schema enum.
 *   Access tokens are stateless JWTs — they are NEVER stored in MongoDB.
 *   Only refresh, resetPassword, and verifyEmail tokens are persisted.
 *
 * tokenTypes (from src/config/tokens.js):
 *   ACCESS        : "access"        — NOT in schema enum (stateless)
 *   REFRESH       : "refresh"       — in schema enum ✓
 *   RESET_PASSWORD: "resetPassword" — in schema enum ✓
 *   VERIFY_EMAIL  : "verifyEmail"   — in schema enum ✓
 */

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const Token = require('../../../src/models/token.model');
const { tokenTypes } = require('../../../src/config/tokens');

// ─── Schema shortcut ─────────────────────────────────────────────────────────

const schema = Token.schema;
const p = (field) => schema.path(field);

// ─── Constants ────────────────────────────────────────────────────────────────

const STORED_TOKEN_TYPES = [tokenTypes.REFRESH, tokenTypes.RESET_PASSWORD, tokenTypes.VERIFY_EMAIL];

// ─── Helper ───────────────────────────────────────────────────────────────────

function futureDate(offsetMs = 60 * 60 * 1000) {
  return new Date(Date.now() + offsetMs);
}

function validData(overrides = {}) {
  return {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.payload',
    user: new mongoose.Types.ObjectId(),
    type: tokenTypes.REFRESH,
    expires: futureDate(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — model identity', () => {
  test('Token.modelName is "Token"', () => {
    expect(Token.modelName).toBe('Token');
  });

  test('Token.schema is a Mongoose Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('Token is a constructor function', () => {
    expect(typeof Token).toBe('function');
  });

  test('new Token() produces a Mongoose Document', () => {
    expect(new Token(validData())).toBeInstanceOf(mongoose.Document);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. token field (the JWT string)
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — token field', () => {
  test('token has instance type "String"', () => {
    expect(p('token').instance).toBe('String');
  });

  test('token is required', () => {
    expect(p('token').isRequired).toBe(true);
  });

  test('token has index:true', () => {
    expect(p('token').options.index).toBe(true);
  });

  test('document instance stores the JWT string correctly', () => {
    const jwt = 'header.payload.signature';
    const doc = new Token(validData({ token: jwt }));
    expect(doc.token).toBe(jwt);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. user field
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — user field', () => {
  test('user has instance type "ObjectId"', () => {
    expect(p('user').instance).toBe('ObjectId');
  });

  test('user has ref "User"', () => {
    expect(p('user').options.ref).toBe('User');
  });

  test('user is required', () => {
    expect(p('user').isRequired).toBe(true);
  });

  test('document instance stores user ObjectId correctly', () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = new Token(validData({ user: userId }));
    expect(doc.user.toString()).toBe(userId.toString());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. type field
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — type field', () => {
  test('type has instance type "String"', () => {
    expect(p('type').instance).toBe('String');
  });

  test('type is required', () => {
    expect(p('type').isRequired).toBe(true);
  });

  test('type enum has exactly 3 values', () => {
    expect(p('type').enumValues).toHaveLength(3);
  });

  test('type enum contains "refresh"', () => {
    expect(p('type').enumValues).toContain(tokenTypes.REFRESH);
  });

  test('type enum contains "resetPassword"', () => {
    expect(p('type').enumValues).toContain(tokenTypes.RESET_PASSWORD);
  });

  test('type enum contains "verifyEmail"', () => {
    expect(p('type').enumValues).toContain(tokenTypes.VERIFY_EMAIL);
  });

  test('type enum does NOT contain "access" (access tokens are stateless/not persisted)', () => {
    expect(p('type').enumValues).not.toContain(tokenTypes.ACCESS);
  });

  test('STORED_TOKEN_TYPES matches schema enum exactly', () => {
    expect(p('type').enumValues).toEqual(STORED_TOKEN_TYPES);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. expires field
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — expires field', () => {
  test('expires has instance type "Date"', () => {
    expect(p('expires').instance).toBe('Date');
  });

  test('expires is required', () => {
    expect(p('expires').isRequired).toBe(true);
  });

  test('document instance stores a future Date correctly', () => {
    const future = futureDate(7 * 24 * 60 * 60 * 1000); // 7 days
    const doc = new Token(validData({ expires: future }));
    expect(doc.expires).toEqual(future);
  });

  test('document instance stores a past Date without schema-level rejection', () => {
    const past = new Date('2020-01-01');
    const doc = new Token(validData({ expires: past }));
    expect(doc.expires).toEqual(past);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. blacklisted field
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — blacklisted field', () => {
  test('blacklisted has instance type "Boolean"', () => {
    expect(p('blacklisted').instance).toBe('Boolean');
  });

  test('blacklisted default is false', () => {
    expect(p('blacklisted').defaultValue).toBe(false);
  });

  test('blacklisted is not required', () => {
    expect(p('blacklisted').isRequired).toBeFalsy();
  });

  test('document instance applies false as default when blacklisted is omitted', () => {
    const doc = new Token(validData());
    expect(doc.blacklisted).toBe(false);
  });

  test('document instance stores blacklisted:true correctly', () => {
    const doc = new Token(validData({ blacklisted: true }));
    expect(doc.blacklisted).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. timestamps
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — timestamps', () => {
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
// 8. toJSON plugin
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — toJSON plugin', () => {
  test('schema.options.toJSON is defined', () => {
    expect(schema.options.toJSON).toBeDefined();
  });

  test('schema.options.toJSON has a transform function', () => {
    expect(typeof schema.options.toJSON.transform).toBe('function');
  });

  test('toJSON transform adds id (string) from _id', () => {
    const transform = schema.options.toJSON.transform;
    const mockId = new mongoose.Types.ObjectId();
    const ret = { _id: mockId, __v: 0, token: 'jwt.string' };
    transform({}, ret, {});
    expect(ret.id).toBe(mockId.toString());
  });

  test('toJSON transform removes _id', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 0, token: 'jwt.string' };
    transform({}, ret, {});
    expect(ret._id).toBeUndefined();
  });

  test('toJSON transform removes __v', () => {
    const transform = schema.options.toJSON.transform;
    const ret = { _id: new mongoose.Types.ObjectId(), __v: 3, token: 'jwt.string' };
    transform({}, ret, {});
    expect(ret.__v).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. tokenTypes config integration
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — tokenTypes config integration', () => {
  test('tokenTypes.REFRESH === "refresh"', () => {
    expect(tokenTypes.REFRESH).toBe('refresh');
  });

  test('tokenTypes.RESET_PASSWORD === "resetPassword"', () => {
    expect(tokenTypes.RESET_PASSWORD).toBe('resetPassword');
  });

  test('tokenTypes.VERIFY_EMAIL === "verifyEmail"', () => {
    expect(tokenTypes.VERIFY_EMAIL).toBe('verifyEmail');
  });

  test('tokenTypes.ACCESS === "access" (defined but NOT persisted)', () => {
    expect(tokenTypes.ACCESS).toBe('access');
  });

  test('schema enum values equal [REFRESH, RESET_PASSWORD, VERIFY_EMAIL]', () => {
    expect(p('type').enumValues).toEqual([
      tokenTypes.REFRESH,
      tokenTypes.RESET_PASSWORD,
      tokenTypes.VERIFY_EMAIL,
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Document instance — defaults and storage
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — document instance defaults and storage', () => {
  test('new Token gets an _id automatically', () => {
    const doc = new Token(validData());
    expect(doc._id).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  test('blacklisted defaults to false', () => {
    expect(new Token(validData()).blacklisted).toBe(false);
  });

  test('stores REFRESH type correctly', () => {
    const doc = new Token(validData({ type: tokenTypes.REFRESH }));
    expect(doc.type).toBe('refresh');
  });

  test('stores RESET_PASSWORD type correctly', () => {
    const doc = new Token(validData({ type: tokenTypes.RESET_PASSWORD }));
    expect(doc.type).toBe('resetPassword');
  });

  test('stores VERIFY_EMAIL type correctly', () => {
    const doc = new Token(validData({ type: tokenTypes.VERIFY_EMAIL }));
    expect(doc.type).toBe('verifyEmail');
  });

  test('stores token string (JWT) without modification', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.sig';
    const doc = new Token(validData({ token: jwt }));
    expect(doc.token).toBe(jwt);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. validateSync — required field checks
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — validateSync required field checks', () => {
  test('validateSync reports error when token is missing', () => {
    const doc = new Token(validData({ token: undefined }));
    const err = doc.validateSync();
    expect(err?.errors).toHaveProperty('token');
  });

  test('validateSync reports error when user is missing', () => {
    const doc = new Token(validData({ user: undefined }));
    const err = doc.validateSync();
    expect(err?.errors).toHaveProperty('user');
  });

  test('validateSync reports error when type is missing', () => {
    const doc = new Token(validData({ type: undefined }));
    const err = doc.validateSync();
    expect(err?.errors).toHaveProperty('type');
  });

  test('validateSync reports error when expires is missing', () => {
    const doc = new Token(validData({ expires: undefined }));
    const err = doc.validateSync();
    expect(err?.errors).toHaveProperty('expires');
  });

  test('validateSync returns null/undefined when all required fields are provided', () => {
    const doc = new Token(validData());
    expect(doc.validateSync()).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Security — ACCESS token is not storable
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — security: ACCESS token type is not persisted', () => {
  test('type:"access" fails validateSync (access tokens must not be stored)', () => {
    const doc = new Token(validData({ type: tokenTypes.ACCESS }));
    const err = doc.validateSync();
    expect(err).toBeDefined();
    expect(err.errors).toHaveProperty('type');
  });

  test('type:"access" error message references enum constraint', () => {
    const doc = new Token(validData({ type: 'access' }));
    const err = doc.validateSync();
    expect(err?.errors?.type?.kind).toBe('enum');
  });

  test('arbitrary type string fails validateSync', () => {
    const doc = new Token(validData({ type: 'session' }));
    const err = doc.validateSync();
    expect(err?.errors?.type?.kind).toBe('enum');
  });

  test('schema defines exactly 3 storable token types (not 4)', () => {
    expect(p('type').enumValues).toHaveLength(3);
    expect(p('type').enumValues).not.toContain('access');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Schema has no static or instance methods
// ══════════════════════════════════════════════════════════════════════════════
describe('Token — no static or instance methods', () => {
  test('Token has no custom static methods beyond Mongoose built-ins', () => {
    const customStatics = Object.keys(schema.statics);
    expect(customStatics).toHaveLength(0);
  });

  test('Token has no custom instance methods (Mongoose-internal initializeTimestamps excluded)', () => {
    const mongooseInternals = ['initializeTimestamps'];
    const customMethods = Object.keys(schema.methods).filter((m) => !mongooseInternals.includes(m));
    expect(customMethods).toHaveLength(0);
  });
});
