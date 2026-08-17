/**
 * Unit tests for crons.controller.js
 *
 * CronsController extends BaseController and is exported as a SINGLETON.
 * this.cronJobs is an in-memory Map — pre-seeded in tests and cleared in beforeEach.
 *
 * NOTE — Production bug found:
 *   executeCronAction("createFile") passes { json: () => {} } as res to cronCreateFile.
 *   cronCreateFile calls this.success(res, ...) → res.status(200) → TypeError (res.status undefined).
 *   The catch block then calls this.error(res, ...) → same TypeError → propagates out.
 *   All executeCronAction("createFile") calls in production will throw.
 */

// =============================================================================
// Mocks (hoisted before imports)
// =============================================================================

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn(),
    appendFile: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock(
  'node-cron',
  () => ({
    validate: jest.fn().mockReturnValue(true),
    schedule: jest.fn(),
  }),
  { virtual: true }
);

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

// =============================================================================
// Imports
// =============================================================================

const fsp = require('fs').promises;
const cron = require('node-cron');
const ctrl = require('../../../src/controllers/crons.controller');

// =============================================================================
// Test helpers
// =============================================================================

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const adminUser = { _id: 'u1', role: 'admin', license: 'lic1' };
const lowUser = { _id: 'u2', role: 'cashier' };
const noReadUser = { _id: 'u3', role: 'cashier', access: { setting: { read: false } } };

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  session: {},
  user: adminUser,
  ...overrides,
});

let mockTask;

const seedJob = (name, overrides = {}) => {
  ctrl.cronJobs.set(name, {
    schedule: '* * * * *',
    action: 'cleanupLogs',
    enabled: true,
    task: null,
    status: 'scheduled',
    ...overrides,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  ctrl.cronJobs.clear();
  mockTask = { start: jest.fn(), stop: jest.fn(), running: false };
  cron.schedule.mockReturnValue(mockTask);
  cron.validate.mockReturnValue(true);
  fsp.mkdir.mockResolvedValue(undefined);
  fsp.writeFile.mockResolvedValue(undefined);
  fsp.appendFile.mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

// =============================================================================
// ensureDirectoryExists
// =============================================================================

describe('CronsController — ensureDirectoryExists', () => {
  test('calls fs.mkdir with recursive:true', async () => {
    await ctrl.ensureDirectoryExists();
    expect(fsp.mkdir).toHaveBeenCalledWith(expect.stringContaining('cron_files'), {
      recursive: true,
    });
  });

  test('silently handles mkdir error without throwing', async () => {
    fsp.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(ctrl.ensureDirectoryExists()).resolves.toBeUndefined();
  });
});

// =============================================================================
// cronCreateFile
// =============================================================================

describe('CronsController — cronCreateFile', () => {
  test('writes content to test_cron_posnic.txt', async () => {
    const res = mockRes();
    await ctrl.cronCreateFile(mockReq(), res);
    expect(fsp.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('test_cron_posnic.txt'),
      expect.stringContaining('Cron Node.js Testing'),
      'utf8'
    );
  });

  test('returns 200 success with filePath, content, and message', async () => {
    const res = mockRes();
    await ctrl.cronCreateFile(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.data).toMatchObject({
      filePath: expect.stringContaining('test_cron_posnic.txt'),
      content: expect.stringContaining('Cron Node.js Testing'),
      message: 'File writing completed',
    });
  });

  test('content includes current ISO timestamp', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T11:00:00.000Z'));
    const res = mockRes();
    await ctrl.cronCreateFile(mockReq(), res);
    expect(fsp.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('2026-06-01T11:00:00.000Z'),
      'utf8'
    );
    jest.useRealTimers();
  });

  test('returns 500 when writeFile throws', async () => {
    fsp.writeFile.mockRejectedValueOnce(new Error('Disk full'));
    const res = mockRes();
    await ctrl.cronCreateFile(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('does NOT require any permission check', async () => {
    const res = mockRes();
    await ctrl.cronCreateFile(mockReq({ user: lowUser }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// =============================================================================
// getAllCronJobs
// =============================================================================

describe('CronsController — getAllCronJobs', () => {
  test('returns 403 when user lacks setting read permission', async () => {
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq({ user: noReadUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('returns empty array when no jobs are registered', async () => {
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  test('returns mapped list with name, schedule, running, status', async () => {
    seedJob('job1', { schedule: '0 * * * *', status: 'scheduled' });
    seedJob('job2', { schedule: '0 0 * * *', status: 'stopped' });
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq(), res);
    const { data } = res.json.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      name: 'job1',
      schedule: '0 * * * *',
      running: false,
      status: 'scheduled',
    });
    expect(data[1]).toMatchObject({
      name: 'job2',
      schedule: '0 0 * * *',
      running: false,
      status: 'stopped',
    });
  });

  test('reflects task.running=true when task is active', async () => {
    const runningTask = { running: true };
    seedJob('job1', { task: runningTask });
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq(), res);
    expect(res.json.mock.calls[0][0].data[0].running).toBe(true);
  });

  test('reflects running=false when task is null', async () => {
    seedJob('job1', { task: null });
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq(), res);
    expect(res.json.mock.calls[0][0].data[0].running).toBe(false);
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'entries').mockImplementation(() => {
      throw new Error('Map crash');
    });
    const res = mockRes();
    await ctrl.getAllCronJobs(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// createCronJob
// =============================================================================

describe('CronsController — createCronJob', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.createCronJob(mockReq({ user: lowUser }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 400 when name is missing', async () => {
    const res = mockRes();
    await ctrl.createCronJob(
      mockReq({ body: { schedule: '* * * * *', action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/required/i);
  });

  test('returns 400 when schedule is missing', async () => {
    const res = mockRes();
    await ctrl.createCronJob(mockReq({ body: { name: 'job1', action: 'cleanupLogs' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when action is missing', async () => {
    const res = mockRes();
    await ctrl.createCronJob(mockReq({ body: { name: 'job1', schedule: '* * * * *' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('returns 400 when cron expression is invalid', async () => {
    cron.validate.mockReturnValueOnce(false);
    const res = mockRes();
    await ctrl.createCronJob(
      mockReq({ body: { name: 'job1', schedule: 'bad-expr', action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/invalid cron/i);
  });

  test('returns 400 when job name already exists', async () => {
    seedJob('job1');
    const res = mockRes();
    await ctrl.createCronJob(
      mockReq({ body: { name: 'job1', schedule: '* * * * *', action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/already exists/i);
  });

  test('returns 201 on successful creation', async () => {
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    const res = mockRes();
    await ctrl.createCronJob(
      mockReq({ body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].type).toBe('success');
  });

  test('stores new job in cronJobs Map', async () => {
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.createCronJob(
      mockReq({ body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs' } }),
      mockRes()
    );
    expect(ctrl.cronJobs.has('newJob')).toBe(true);
    expect(ctrl.cronJobs.get('newJob')).toMatchObject({
      schedule: '* * * * *',
      action: 'cleanupLogs',
      enabled: true,
      status: 'scheduled',
    });
  });

  test('calls scheduleCronJob when enabled=true (default)', async () => {
    const spy = jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.createCronJob(
      mockReq({ body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs' } }),
      mockRes()
    );
    expect(spy).toHaveBeenCalledWith('newJob');
  });

  test('does NOT call scheduleCronJob when enabled=false', async () => {
    const spy = jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.createCronJob(
      mockReq({
        body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs', enabled: false },
      }),
      mockRes()
    );
    expect(spy).not.toHaveBeenCalled();
  });

  test('sets status="inactive" when enabled=false', async () => {
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.createCronJob(
      mockReq({
        body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs', enabled: false },
      }),
      mockRes()
    );
    expect(ctrl.cronJobs.get('newJob').status).toBe('inactive');
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('Map crash');
    });
    const res = mockRes();
    await ctrl.createCronJob(
      mockReq({ body: { name: 'newJob', schedule: '* * * * *', action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// updateCronJob
// =============================================================================

describe('CronsController — updateCronJob', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.updateCronJob(mockReq({ user: lowUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when job not found', async () => {
    const res = mockRes();
    await ctrl.updateCronJob(mockReq({ params: { name: 'nonexistent' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].message).toMatch(/not found/i);
  });

  test('stops existing task before updating when task exists', async () => {
    const existingTask = { stop: jest.fn(), start: jest.fn(), running: false };
    seedJob('job1', { task: existingTask });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { action: 'backupDatabase' } }),
      mockRes()
    );
    expect(existingTask.stop).toHaveBeenCalled();
  });

  test('does NOT throw when task is null (no running task)', async () => {
    seedJob('job1', { task: null });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    const res = mockRes();
    await ctrl.updateCronJob(mockReq({ params: { name: 'job1' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 for invalid new schedule expression', async () => {
    seedJob('job1');
    cron.validate.mockReturnValueOnce(false);
    const res = mockRes();
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { schedule: 'bad-schedule' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/invalid cron/i);
  });

  test('updates schedule when valid expression is provided', async () => {
    seedJob('job1');
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { schedule: '0 12 * * *' } }),
      mockRes()
    );
    expect(ctrl.cronJobs.get('job1').schedule).toBe('0 12 * * *');
  });

  test('keeps old schedule when schedule is not in body', async () => {
    seedJob('job1', { schedule: '* * * * *' });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { action: 'backupDatabase' } }),
      mockRes()
    );
    expect(ctrl.cronJobs.get('job1').schedule).toBe('* * * * *');
  });

  test('updates action and enabled fields', async () => {
    seedJob('job1', { enabled: true });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { action: 'backupDatabase', enabled: false } }),
      mockRes()
    );
    const job = ctrl.cronJobs.get('job1');
    expect(job.action).toBe('backupDatabase');
    expect(job.enabled).toBe(false);
  });

  test('sets status="inactive" when enabled becomes false', async () => {
    seedJob('job1', { enabled: true });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { enabled: false } }),
      mockRes()
    );
    expect(ctrl.cronJobs.get('job1').status).toBe('inactive');
  });

  test('sets status="scheduled" when enabled is true', async () => {
    seedJob('job1', { enabled: false });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { enabled: true } }),
      mockRes()
    );
    expect(ctrl.cronJobs.get('job1').status).toBe('scheduled');
  });

  test('calls scheduleCronJob when enabled is true', async () => {
    seedJob('job1', { enabled: false });
    const spy = jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { enabled: true } }),
      mockRes()
    );
    expect(spy).toHaveBeenCalledWith('job1');
  });

  test('does NOT call scheduleCronJob when enabled is false', async () => {
    seedJob('job1', { enabled: true });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    const scheduleSpy = jest.spyOn(ctrl, 'scheduleCronJob');
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { enabled: false } }),
      mockRes()
    );
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  test('returns 200 success with updated job data', async () => {
    seedJob('job1');
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    const res = mockRes();
    await ctrl.updateCronJob(
      mockReq({ params: { name: 'job1' }, body: { action: 'cleanupLogs' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toMatchObject({ name: 'job1' });
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.updateCronJob(mockReq({ params: { name: 'job1' }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// deleteCronJob
// =============================================================================

describe('CronsController — deleteCronJob', () => {
  test('returns 403 when user lacks delete permission', async () => {
    const res = mockRes();
    await ctrl.deleteCronJob(mockReq({ user: lowUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when job not found', async () => {
    const res = mockRes();
    await ctrl.deleteCronJob(mockReq({ params: { name: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('stops the running task before deletion', async () => {
    const task = { stop: jest.fn() };
    seedJob('job1', { task });
    await ctrl.deleteCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    expect(task.stop).toHaveBeenCalled();
  });

  test('does NOT throw when task is null', async () => {
    seedJob('job1', { task: null });
    const res = mockRes();
    await ctrl.deleteCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('removes job from cronJobs Map', async () => {
    seedJob('job1');
    await ctrl.deleteCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    expect(ctrl.cronJobs.has('job1')).toBe(false);
  });

  test('returns 200 success with null data', async () => {
    seedJob('job1');
    const res = mockRes();
    await ctrl.deleteCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toBeNull();
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.deleteCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// startCronJob
// =============================================================================

describe('CronsController — startCronJob', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.startCronJob(mockReq({ user: lowUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when job not found', async () => {
    const res = mockRes();
    await ctrl.startCronJob(mockReq({ params: { name: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('sets job.enabled=true and job.status="scheduled"', async () => {
    seedJob('job1', { enabled: false, status: 'stopped' });
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.startCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    const job = ctrl.cronJobs.get('job1');
    expect(job.enabled).toBe(true);
    expect(job.status).toBe('scheduled');
  });

  test('calls scheduleCronJob with job name', async () => {
    seedJob('job1');
    const spy = jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    await ctrl.startCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    expect(spy).toHaveBeenCalledWith('job1');
  });

  test('returns 200 with name and status="started"', async () => {
    seedJob('job1');
    jest.spyOn(ctrl, 'scheduleCronJob').mockImplementation(() => {});
    const res = mockRes();
    await ctrl.startCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ name: 'job1', status: 'started' });
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.startCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// stopCronJob
// =============================================================================

describe('CronsController — stopCronJob', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.stopCronJob(mockReq({ user: lowUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when job not found', async () => {
    const res = mockRes();
    await ctrl.stopCronJob(mockReq({ params: { name: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('calls task.stop() when task exists', async () => {
    const task = { stop: jest.fn() };
    seedJob('job1', { task });
    await ctrl.stopCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    expect(task.stop).toHaveBeenCalled();
  });

  test('does NOT throw when task is null', async () => {
    seedJob('job1', { task: null });
    const res = mockRes();
    await ctrl.stopCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('sets job.enabled=false, job.status="stopped", job.task=null', async () => {
    const task = { stop: jest.fn() };
    seedJob('job1', { task, enabled: true, status: 'scheduled' });
    await ctrl.stopCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    const job = ctrl.cronJobs.get('job1');
    expect(job.enabled).toBe(false);
    expect(job.status).toBe('stopped');
    expect(job.task).toBeNull();
  });

  test('returns 200 with name and status="stopped"', async () => {
    seedJob('job1');
    const res = mockRes();
    await ctrl.stopCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ name: 'job1', status: 'stopped' });
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.stopCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// executeCronJob
// =============================================================================

describe('CronsController — executeCronJob', () => {
  test('returns 403 when user lacks write permission', async () => {
    const res = mockRes();
    await ctrl.executeCronJob(mockReq({ user: lowUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('returns 404 when job not found', async () => {
    const res = mockRes();
    await ctrl.executeCronJob(mockReq({ params: { name: 'nonexistent' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('calls executeCronAction with job.action', async () => {
    seedJob('job1', { action: 'cleanupLogs' });
    const spy = jest.spyOn(ctrl, 'executeCronAction').mockResolvedValue('Logs cleaned');
    await ctrl.executeCronJob(mockReq({ params: { name: 'job1' } }), mockRes());
    expect(spy).toHaveBeenCalledWith('cleanupLogs');
  });

  test('returns 200 with name, executedAt, and result', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T11:00:00.000Z'));
    seedJob('job1', { action: 'cleanupLogs' });
    jest.spyOn(ctrl, 'executeCronAction').mockResolvedValue('Logs cleaned');
    const res = mockRes();
    await ctrl.executeCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.name).toBe('job1');
    expect(data.result).toBe('Logs cleaned');
    expect(data.executedAt).toEqual(new Date('2026-06-01T11:00:00.000Z'));
    jest.useRealTimers();
  });

  test('returns 500 when executeCronAction throws', async () => {
    seedJob('job1', { action: 'unknownAction' });
    jest
      .spyOn(ctrl, 'executeCronAction')
      .mockRejectedValue(new Error('Unknown action: unknownAction'));
    const res = mockRes();
    await ctrl.executeCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 on thrown error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.executeCronJob(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// getCronLogs
// =============================================================================

describe('CronsController — getCronLogs', () => {
  test('returns 403 when user lacks setting read permission', async () => {
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ user: noReadUser, params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('reads correct log file for given job name', async () => {
    fsp.readFile.mockResolvedValueOnce('line1\nline2');
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ params: { name: 'job1' } }), res);
    expect(fsp.readFile).toHaveBeenCalledWith(expect.stringContaining('job1_log.txt'), 'utf8');
  });

  test('returns 200 with log lines split by newline', async () => {
    fsp.readFile.mockResolvedValueOnce('line1\nline2\nline3');
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.logs).toEqual(['line1', 'line2', 'line3']);
  });

  test('returns empty array when log file does not exist (ENOENT)', async () => {
    const err = new Error('File not found');
    err.code = 'ENOENT';
    fsp.readFile.mockRejectedValueOnce(err);
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.logs).toEqual([]);
    expect(res.json.mock.calls[0][0].message).toMatch(/no logs available/i);
  });

  test('returns 500 when readFile throws a non-ENOENT error', async () => {
    const err = new Error('Permission denied');
    err.code = 'EACCES';
    fsp.readFile.mockRejectedValueOnce(err);
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('returns 500 on unexpected outer error', async () => {
    jest.spyOn(ctrl.cronJobs, 'has').mockImplementation(() => {
      throw new Error('crash');
    });
    const res = mockRes();
    await ctrl.getCronLogs(mockReq({ params: { name: 'job1' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// =============================================================================
// scheduleCronJob (internal)
// =============================================================================

describe('CronsController — scheduleCronJob', () => {
  test('does nothing when job name not found in Map', () => {
    ctrl.scheduleCronJob('nonexistent');
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  test('stops existing task before rescheduling', () => {
    const oldTask = { stop: jest.fn() };
    seedJob('job1', { task: oldTask });
    ctrl.scheduleCronJob('job1');
    expect(oldTask.stop).toHaveBeenCalled();
  });

  test('calls cron.schedule with job.schedule and a callback', () => {
    seedJob('job1', { schedule: '0 * * * *' });
    ctrl.scheduleCronJob('job1');
    expect(cron.schedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
  });

  test('starts the newly scheduled task', () => {
    seedJob('job1');
    ctrl.scheduleCronJob('job1');
    expect(mockTask.start).toHaveBeenCalled();
  });

  test('assigns returned task to job.task', () => {
    seedJob('job1');
    ctrl.scheduleCronJob('job1');
    expect(ctrl.cronJobs.get('job1').task).toBe(mockTask);
  });

  test('does NOT stop previous task when task is null', () => {
    seedJob('job1', { task: null });
    ctrl.scheduleCronJob('job1');
    // Should not throw and should still schedule
    expect(cron.schedule).toHaveBeenCalled();
  });

  test('scheduled callback executes action and logs success', async () => {
    seedJob('job1', { action: 'cleanupLogs' });
    jest.spyOn(ctrl, 'executeCronAction').mockResolvedValue('Logs cleaned');
    jest.spyOn(ctrl, 'logCronExecution').mockResolvedValue(undefined);
    ctrl.scheduleCronJob('job1');
    const callback = cron.schedule.mock.calls[0][1];
    await callback();
    expect(ctrl.executeCronAction).toHaveBeenCalledWith('cleanupLogs');
    expect(ctrl.logCronExecution).toHaveBeenCalledWith('job1', 'success', 'Logs cleaned');
  });

  test('scheduled callback logs error when executeCronAction throws', async () => {
    seedJob('job1', { action: 'unknownAction' });
    jest.spyOn(ctrl, 'executeCronAction').mockRejectedValue(new Error('Unknown action'));
    jest.spyOn(ctrl, 'logCronExecution').mockResolvedValue(undefined);
    ctrl.scheduleCronJob('job1');
    const callback = cron.schedule.mock.calls[0][1];
    await callback();
    expect(ctrl.logCronExecution).toHaveBeenCalledWith('job1', 'error', 'Unknown action');
  });
});

// =============================================================================
// executeCronAction (internal)
// =============================================================================

describe('CronsController — executeCronAction', () => {
  test('throws for unknown action', async () => {
    await expect(ctrl.executeCronAction('unknownAction')).rejects.toThrow(
      'Unknown action: unknownAction'
    );
  });

  test('executes cleanupLogs action and returns result', async () => {
    const result = await ctrl.executeCronAction('cleanupLogs');
    expect(result).toBe('Logs cleaned up');
  });

  test('executes backupDatabase action and returns result', async () => {
    const result = await ctrl.executeCronAction('backupDatabase');
    expect(result).toBe('Database backup completed');
  });

  test('executes sendReports action and returns result', async () => {
    const result = await ctrl.executeCronAction('sendReports');
    expect(result).toBe('Reports sent');
  });

  test('executes updateStats action and returns result', async () => {
    const result = await ctrl.executeCronAction('updateStats');
    expect(result).toBe('Statistics updated');
  });

  test('executes createFile action by calling cronCreateFile', async () => {
    const spy = jest.spyOn(ctrl, 'cronCreateFile').mockResolvedValue('done');
    await ctrl.executeCronAction('createFile');
    expect(spy).toHaveBeenCalled();
  });
});

// =============================================================================
// logCronExecution (internal)
// =============================================================================

describe('CronsController — logCronExecution', () => {
  test('appends formatted log entry to correct log file', async () => {
    await ctrl.logCronExecution('myJob', 'success', 'All done');
    expect(fsp.appendFile).toHaveBeenCalledWith(
      expect.stringContaining('myJob_log.txt'),
      expect.stringContaining('SUCCESS: All done'),
      'utf8'
    );
  });

  test('includes ISO timestamp in log entry', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T10:00:00.000Z'));
    await ctrl.logCronExecution('myJob', 'error', 'Failed');
    expect(fsp.appendFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('[2026-06-01T10:00:00.000Z]'),
      'utf8'
    );
    jest.useRealTimers();
  });

  test('uses uppercase status in log entry', async () => {
    await ctrl.logCronExecution('myJob', 'error', 'Something failed');
    const logEntry = fsp.appendFile.mock.calls[0][1];
    expect(logEntry).toContain('ERROR: Something failed');
  });

  test('appends newline at end of log entry', async () => {
    await ctrl.logCronExecution('myJob', 'success', 'Done');
    const logEntry = fsp.appendFile.mock.calls[0][1];
    expect(logEntry.endsWith('\n')).toBe(true);
  });

  test('silently handles appendFile error without throwing', async () => {
    fsp.appendFile.mockRejectedValueOnce(new Error('Disk full'));
    await expect(ctrl.logCronExecution('myJob', 'success', 'Done')).resolves.toBeUndefined();
  });
});
