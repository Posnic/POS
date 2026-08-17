/**
 * Unit tests for CampaignController
 *
 * Methods covered:
 *   list, get, create, update, remove, preview, send, schedule, runDue
 *
 * Mocked dependencies:
 *   CampaignService, BaseModel
 *
 * Write-gated methods (create, update, remove, schedule, runDue, and a real
 * send) go through _canWrite(req) === (req.user?.access?.branch?.write !== false).
 * A dry-run send is exempt from the write gate; a real send is not.
 */

jest.mock('../../../src/services/campaign.service', () =>
  jest.fn().mockImplementation(() => ({
    list: jest.fn(),
    get: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    preview: jest.fn(),
    send: jest.fn(),
    schedule: jest.fn(),
    runDue: jest.fn(),
  }))
);

jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
    async getCollection() {
      return { findOne: jest.fn().mockResolvedValue(null) };
    }
    async checkPlan() {
      return 0;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

const controller = require('../../../src/controllers/campaign.controller');

// ─── Constants ─────────────────────────────────────────────────────────────────

const VALID_ID = '507f1f77bcf86cd799439011';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const writeUser = () => ({
  _id: VALID_ID,
  name: 'admin',
  email: 'admin@shop.test',
  branch_id: VALID_ID,
  branch_name: 'Main Branch',
  access: { branch: { write: true } },
});

const noWriteUser = () => ({
  ...writeUser(),
  access: { branch: { write: false } },
});

const mockReq = (overrides = {}) => ({
  user: writeUser(),
  params: {},
  body: {},
  tenantContext: { branchId: VALID_ID, branchName: 'Main Branch', currency: 'INR' },
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ─── Setup ──────────────────────────────────────────────────────────────────────

let svc;

beforeEach(() => {
  jest.clearAllMocks();

  svc = {
    list: jest.fn(),
    get: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    preview: jest.fn(),
    send: jest.fn(),
    schedule: jest.fn(),
    runDue: jest.fn(),
  };
  controller.service = svc;
});

// ─── list ─────────────────────────────────────────────────────────────────────

describe('list', () => {
  test('returns 200 with the campaign list when service succeeds', async () => {
    svc.list.mockResolvedValue({
      status: true,
      data: [{ _id: VALID_ID, name: 'Diwali blast' }],
      message: 'Campaigns',
    });
    const res = mockRes();
    await controller.list(mockReq(), res);

    expect(svc.list).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Campaigns',
        data: expect.arrayContaining([expect.objectContaining({ name: 'Diwali blast' })]),
      })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.list.mockRejectedValue(new Error('db down'));
    const res = mockRes();
    await controller.list(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'db down' })
    );
  });
});

// ─── get ─────────────────────────────────────────────────────────────────────

describe('get', () => {
  test('returns 200 with the campaign when found', async () => {
    svc.get.mockResolvedValue({ status: true, data: { _id: VALID_ID, name: 'Reminder' } });
    const res = mockRes();
    await controller.get(mockReq({ params: { id: VALID_ID } }), res);

    expect(svc.get).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign' })
    );
  });

  test('returns 404 when service reports the campaign is missing', async () => {
    svc.get.mockResolvedValue({ status: false, message: 'Campaign not found' });
    const res = mockRes();
    await controller.get(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Campaign not found' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.get.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.get(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── create ─────────────────────────────────────────────────────────────────────

describe('create', () => {
  test('returns 200 with the saved campaign when service succeeds', async () => {
    svc.save.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'New' },
      message: 'Campaign saved',
    });
    const res = mockRes();
    await controller.create(
      mockReq({ body: { name: 'New', channel: 'sms', message: 'hi {name}' } }),
      res
    );

    expect(svc.save).toHaveBeenCalledWith(
      '',
      expect.objectContaining({ name: 'New' }),
      expect.any(Object)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign saved' })
    );
  });

  test('returns 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.create(mockReq({ user: noWriteUser(), body: { name: 'New' } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.save).not.toHaveBeenCalled();
  });

  test('returns 400 when the service rejects the payload', async () => {
    svc.save.mockResolvedValue({ status: false, message: 'A campaign name is required' });
    const res = mockRes();
    await controller.create(mockReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'A campaign name is required' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.save.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.create(mockReq({ body: { name: 'New' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── update ─────────────────────────────────────────────────────────────────────

describe('update', () => {
  test('returns 200 with the updated campaign when service succeeds', async () => {
    svc.save.mockResolvedValue({
      status: true,
      data: { _id: VALID_ID, name: 'Edited' },
      message: 'Campaign saved',
    });
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: { name: 'Edited' } }), res);

    expect(svc.save).toHaveBeenCalledWith(
      VALID_ID,
      expect.objectContaining({ name: 'Edited' }),
      expect.any(Object)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign saved' })
    );
  });

  test('returns 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.update(
      mockReq({ user: noWriteUser(), params: { id: VALID_ID }, body: { name: 'Edited' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.save).not.toHaveBeenCalled();
  });

  test('returns 400 when the service rejects the payload', async () => {
    svc.save.mockResolvedValue({ status: false, message: 'Choose a valid channel' });
    const res = mockRes();
    await controller.update(
      mockReq({ params: { id: VALID_ID }, body: { channel: 'carrier-pigeon' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Choose a valid channel' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.save.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.update(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── remove ─────────────────────────────────────────────────────────────────────

describe('remove', () => {
  test('returns 200 when the campaign is deleted', async () => {
    svc.remove.mockResolvedValue({
      status: true,
      data: { deleted: 1 },
      message: 'Campaign deleted',
    });
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(svc.remove).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign deleted' })
    );
  });

  test('returns 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.remove(mockReq({ user: noWriteUser(), params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.remove).not.toHaveBeenCalled();
  });

  test('returns 404 when the campaign does not exist', async () => {
    svc.remove.mockResolvedValue({ status: false, message: 'Campaign not found' });
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Campaign not found' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.remove.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.remove(mockReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── preview ─────────────────────────────────────────────────────────────────────

describe('preview', () => {
  test('returns 200 with the audience reach (no write gate)', async () => {
    svc.preview.mockResolvedValue({
      status: true,
      data: { total: 10, reachable: 7, sample: [] },
      message: 'Audience preview',
    });
    const res = mockRes();
    await controller.preview(
      mockReq({ user: noWriteUser(), body: { segment: { type: 'all' }, channel: 'sms' } }),
      res
    );

    expect(svc.preview).toHaveBeenCalledWith({ type: 'all' }, 'sms');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Audience preview' })
    );
  });

  test('defaults the segment to {} when the body is empty', async () => {
    svc.preview.mockResolvedValue({ status: true, data: {}, message: 'Audience preview' });
    const res = mockRes();
    await controller.preview(mockReq({ body: {} }), res);

    expect(svc.preview).toHaveBeenCalledWith({}, undefined);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 when service throws', async () => {
    svc.preview.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.preview(mockReq({ body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── send ─────────────────────────────────────────────────────────────────────

describe('send', () => {
  test('dry run succeeds without write access', async () => {
    svc.send.mockResolvedValue({
      status: true,
      data: { dryRun: true, audience_size: 5 },
      message: 'Dry run complete',
    });
    const res = mockRes();
    await controller.send(
      mockReq({ user: noWriteUser(), params: { id: VALID_ID }, body: { dryRun: true } }),
      res
    );

    expect(svc.send).toHaveBeenCalledWith(VALID_ID, expect.objectContaining({ dryRun: true }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Dry run complete' })
    );
  });

  test('real send is rejected with 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.send(
      mockReq({ user: noWriteUser(), params: { id: VALID_ID }, body: { dryRun: false } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Unauthorized' })
    );
    expect(svc.send).not.toHaveBeenCalled();
  });

  test('real send succeeds with write access', async () => {
    svc.send.mockResolvedValue({
      status: true,
      data: { dryRun: false, sent: 5 },
      message: 'Campaign sent',
    });
    const res = mockRes();
    await controller.send(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(svc.send).toHaveBeenCalledWith(VALID_ID, expect.objectContaining({ dryRun: false }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign sent' })
    );
  });

  test('returns 400 when the service refuses the send', async () => {
    svc.send.mockResolvedValue({ status: false, message: 'This campaign has already been sent' });
    const res = mockRes();
    await controller.send(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'This campaign has already been sent' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.send.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.send(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── schedule ─────────────────────────────────────────────────────────────────────

describe('schedule', () => {
  test('returns 200 when the campaign is scheduled', async () => {
    const at = new Date().toISOString();
    svc.schedule.mockResolvedValue({
      status: true,
      data: { schedule_at: at },
      message: 'Campaign scheduled',
    });
    const res = mockRes();
    await controller.schedule(
      mockReq({ params: { id: VALID_ID }, body: { schedule_at: at } }),
      res
    );

    expect(svc.schedule).toHaveBeenCalledWith(VALID_ID, at, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Campaign scheduled' })
    );
  });

  test('returns 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.schedule(
      mockReq({ user: noWriteUser(), params: { id: VALID_ID }, body: { schedule_at: 'x' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.schedule).not.toHaveBeenCalled();
  });

  test('returns 400 when the schedule time is invalid', async () => {
    svc.schedule.mockResolvedValue({ status: false, message: 'Invalid schedule time' });
    const res = mockRes();
    await controller.schedule(
      mockReq({ params: { id: VALID_ID }, body: { schedule_at: 'not-a-date' } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Invalid schedule time' })
    );
  });

  test('returns 500 when service throws', async () => {
    svc.schedule.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.schedule(mockReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── runDue ─────────────────────────────────────────────────────────────────────

describe('runDue', () => {
  test('returns 200 with the run summary when service succeeds', async () => {
    svc.runDue.mockResolvedValue({
      status: true,
      data: { ran: 2, results: [] },
      message: 'Scheduled run complete',
    });
    const res = mockRes();
    await controller.runDue(mockReq(), res);

    expect(svc.runDue).toHaveBeenCalledWith(expect.objectContaining({ ctx: expect.any(Object) }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'Scheduled run complete' })
    );
  });

  test('returns 403 when the user lacks write access', async () => {
    const res = mockRes();
    await controller.runDue(mockReq({ user: noWriteUser() }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(svc.runDue).not.toHaveBeenCalled();
  });

  test('returns 500 when service throws', async () => {
    svc.runDue.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await controller.runDue(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
