/**
 * Unit tests for install.controller.js
 *
 * Architecture:
 *  - InstallController extends BaseController (singleton export)
 *  - 2 methods: add (POST /install/add) and cleanup (POST /install/cleanup)
 *  - Both methods: validate → call service → sendResponse / sendError
 *  - No direct DB access — all logic delegated to InstallService
 *  - Routes protected by verifyInstallationCredentials middleware (not tested here)
 *
 * Mocked:
 *  - InstallService (processInstallation, cleanupByLicense)
 *  - express-validator (validationResult)
 *  - base.service (transitive, required by base.controller)
 *
 * Response format (PHP-compatible via BaseController):
 *  - Success: { type: 'success', status: true, message, data }
 *  - Error:   { type: 'error',   status: false, message, data }
 */

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../../src/services/install.service', () =>
  jest.fn().mockImplementation(() => ({
    processInstallation: jest.fn(),
    cleanupByLicense: jest.fn(),
  }))
);

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

jest.mock('express-validator', () => ({
  validationResult: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const { validationResult } = require('express-validator');
const { HTTP_STATUS, ERROR_MESSAGES } = require('../../../src/constants/install.constants');

let ctrl;
let svc;

// ─── Test helpers ─────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  ...overrides,
});

// Minimal valid installation payload
const validInstallBody = {
  register_license: 'aabbccddeeff001122334455',
  register_username: 'admin',
  register_useremail: 'admin@example.com',
  register_userpassword: 'Secret123!',
  register_companyname: 'Test Co.',
  register_country: 'India',
  register_countryid: 'IN',
  register_state: 'Maharashtra',
  register_demo: false,
  businessType: 'supermarket',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  ctrl = require('../../../src/controllers/install.controller');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  // Replace controller's service instance with fresh mock fns
  svc = {
    processInstallation: jest.fn(),
    cleanupByLicense: jest.fn(),
  };
  ctrl.service = svc;

  // Default: no validation errors
  validationResult.mockReturnValue({ isEmpty: () => true, array: () => [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// =============================================================================
// add
// =============================================================================

describe('InstallController.add', () => {
  // ── Success ──────────────────────────────────────────────────────────────

  test('returns 200 with success response when installation succeeds', async () => {
    svc.processInstallation.mockResolvedValue({
      status: true,
      data: '',
      message: 'Posnic Account Created Successfully',
    });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        status: true,
        message: 'Posnic Account Created Successfully',
      })
    );
  });

  test('calls service.processInstallation with the full req.body', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(svc.processInstallation).toHaveBeenCalledTimes(1);
    expect(svc.processInstallation).toHaveBeenCalledWith(validInstallBody);
  });

  test('returns 200 with service data payload', async () => {
    const returnedData = { licenseId: 'aabbccddeeff001122334455' };
    svc.processInstallation.mockResolvedValue({
      status: true,
      data: returnedData,
      message: 'ok',
    });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: returnedData }));
  });

  // ── Validation errors ────────────────────────────────────────────────────

  test('returns 400 when express-validator reports errors', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [
        { param: 'register_username', msg: 'Username is required' },
        { param: 'register_useremail', msg: 'Valid email is required' },
      ],
    });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(svc.processInstallation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: ERROR_MESSAGES.VALIDATION_ERROR,
      })
    );
  });

  test('includes errors array and readable string in validation error response', async () => {
    const errArray = [{ param: 'register_username', msg: 'Username is required' }];
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => errArray,
    });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.add(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.errors).toEqual(errArray);
    expect(payload.data.readable).toContain('register_username: Username is required');
  });

  test('joins multiple validation error messages with ", " separator', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [
        { param: 'register_username', msg: 'Required' },
        { param: 'register_useremail', msg: 'Invalid' },
      ],
    });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.add(req, res);

    const { readable } = res.json.mock.calls[0][0].data;
    expect(readable).toBe('register_username: Required, register_useremail: Invalid');
  });

  // ── Service failure ──────────────────────────────────────────────────────

  test('returns 400 when service returns status false', async () => {
    svc.processInstallation.mockResolvedValue({
      status: false,
      data: null,
      message: 'Duplicate email already exists',
    });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Duplicate email already exists',
      })
    );
  });

  test('passes service error data to response when status is false', async () => {
    const errData = { field: 'email' };
    svc.processInstallation.mockResolvedValue({
      status: false,
      data: errData,
      message: 'Conflict',
    });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: errData }));
  });

  // ── Exception / 500 ──────────────────────────────────────────────────────

  test('returns 500 when service throws unexpected error', async () => {
    svc.processInstallation.mockRejectedValue(new Error('DB connection refused'));
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Internal server error',
      })
    );
  });

  test('does NOT expose service error details in 500 response', async () => {
    svc.processInstallation.mockRejectedValue(new Error('Secret DB credentials leaked'));
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain('Secret DB credentials leaked');
    expect(payload).toContain('Internal server error');
  });

  // ── Security ─────────────────────────────────────────────────────────────

  test('does NOT return db_password in success response', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({
      body: { ...validInstallBody, db_username: 'mongoAdmin', db_password: 'SuperSecret123' },
    });
    const res = mockRes();

    await ctrl.add(req, res);

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain('SuperSecret123');
  });

  test('does NOT return register_userpassword in success response', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain('Secret123!');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test('returns 400 from service with duplicate license message', async () => {
    svc.processInstallation.mockResolvedValue({
      status: false,
      data: '',
      message: "Duplicate license 'abc123' already exists in users.",
    });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Duplicate') })
    );
  });

  test('handles empty req.body without crashing (relies on validator middleware)', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(svc.processInstallation).toHaveBeenCalledWith({});
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('demo data install — passes body with register_demo=true to service', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: { ...validInstallBody, register_demo: true } });
    const res = mockRes();

    await ctrl.add(req, res);

    const [calledBody] = svc.processInstallation.mock.calls[0];
    expect(calledBody.register_demo).toBe(true);
  });

  test('install with businessType passed through to service', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: { ...validInstallBody, businessType: 'cafe' } });
    const res = mockRes();

    await ctrl.add(req, res);

    const [calledBody] = svc.processInstallation.mock.calls[0];
    expect(calledBody.businessType).toBe('cafe');
  });

  test('response type is "success" on success (PHP-compatible format)', async () => {
    svc.processInstallation.mockResolvedValue({ status: true, data: '', message: 'ok' });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('response type is "error" on service failure (PHP-compatible format)', async () => {
    svc.processInstallation.mockResolvedValue({ status: false, data: null, message: 'fail' });
    const req = mockReq({ body: validInstallBody });
    const res = mockRes();

    await ctrl.add(req, res);

    expect(res.json.mock.calls[0][0].type).toBe('error');
  });
});

// =============================================================================
// cleanup
// =============================================================================

describe('InstallController.cleanup', () => {
  const VALID_LICENSE = 'aabbccddeeff001122334455';

  // ── Success ──────────────────────────────────────────────────────────────

  test('returns 200 with cleanup result when license_id is valid', async () => {
    svc.cleanupByLicense.mockResolvedValue({
      status: true,
      data: { license: VALID_LICENSE, totalDeleted: 150, details: {} },
      message: `Successfully deleted records across all collections for license ${VALID_LICENSE}`,
    });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.OK);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        status: true,
      })
    );
  });

  test('calls service.cleanupByLicense with license_id from req.body', async () => {
    svc.cleanupByLicense.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(svc.cleanupByLicense).toHaveBeenCalledTimes(1);
    expect(svc.cleanupByLicense).toHaveBeenCalledWith(VALID_LICENSE);
  });

  test('includes cleanup details in success response', async () => {
    const cleanupData = { license: VALID_LICENSE, totalDeleted: 200, details: { users: 1 } };
    svc.cleanupByLicense.mockResolvedValue({
      status: true,
      data: cleanupData,
      message: 'Cleaned up',
    });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: cleanupData }));
  });

  // ── Validation errors ────────────────────────────────────────────────────

  test('returns 400 when validation reports missing license_id', async () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ param: 'license_id', msg: 'License ID is required' }],
    });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(svc.cleanupByLicense).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: ERROR_MESSAGES.VALIDATION_ERROR,
      })
    );
  });

  test('includes errors array and readable string in validation error response', async () => {
    const errArray = [{ param: 'license_id', msg: 'License ID is required' }];
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => errArray,
    });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.errors).toEqual(errArray);
    expect(payload.data.readable).toContain('license_id: License ID is required');
  });

  // ── Service failure ──────────────────────────────────────────────────────

  test('returns 400 when service returns status false', async () => {
    svc.cleanupByLicense.mockResolvedValue({
      status: false,
      data: '',
      message: 'An error occurred during cleanup',
    });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.BAD_REQUEST);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'An error occurred during cleanup',
      })
    );
  });

  test('passes service error data to response when status is false', async () => {
    const errData = { partial: true };
    svc.cleanupByLicense.mockResolvedValue({
      status: false,
      data: errData,
      message: 'Partial failure',
    });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: errData }));
  });

  // ── Exception / 500 ──────────────────────────────────────────────────────

  test('returns 500 when service throws unexpected error', async () => {
    svc.cleanupByLicense.mockRejectedValue(new Error('DB connection failed'));
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.status).toHaveBeenCalledWith(HTTP_STATUS.INTERNAL_ERROR);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Internal server error',
      })
    );
  });

  test('does NOT expose error details in 500 response (security)', async () => {
    svc.cleanupByLicense.mockRejectedValue(new Error('Sensitive connection string leaked'));
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    const payload = JSON.stringify(res.json.mock.calls[0][0]);
    expect(payload).not.toContain('Sensitive connection string leaked');
    expect(payload).toContain('Internal server error');
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test('passes undefined license_id to service when body is empty (bypassed validation)', async () => {
    svc.cleanupByLicense.mockResolvedValue({ status: true, data: {}, message: 'ok' });
    const req = mockReq({ body: {} });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(svc.cleanupByLicense).toHaveBeenCalledWith(undefined);
  });

  test('response type is "success" on success (PHP-compatible format)', async () => {
    svc.cleanupByLicense.mockResolvedValue({ status: true, data: {}, message: 'Cleaned' });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('response type is "error" on service failure (PHP-compatible format)', async () => {
    svc.cleanupByLicense.mockResolvedValue({ status: false, data: null, message: 'fail' });
    const req = mockReq({ body: { license_id: VALID_LICENSE } });
    const res = mockRes();

    await ctrl.cleanup(req, res);

    expect(res.json.mock.calls[0][0].type).toBe('error');
  });
});
