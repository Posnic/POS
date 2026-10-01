'use strict';
jest.mock('../../../src/models/base.model', () => ({ getDb: jest.fn() }));
const BaseModel = require('../../../src/models/base.model');
const metrics = require('../../../src/services/ask-posnic-metrics.service');

beforeEach(() => jest.clearAllMocks());

test('response observer counts only the outcome and elapsed time, without retaining the body', async () => {
  const updateOne = jest.fn().mockResolvedValue({});
  BaseModel.getDb.mockResolvedValue({
    collection: () => ({ createIndex: jest.fn().mockResolvedValue('index'), updateOne }),
  });
  for (const [statusCode, body, key] of [
    [200, { type: 'success', data: { verified: false, answer: 'private' } }, 'unanswered'],
    [200, { type: 'success', data: { verified: true } }, 'answered'],
    [403, { type: 'error' }, 'rejected'],
    [500, { type: 'error' }, 'failed'],
  ]) {
    const res = { statusCode, json: jest.fn() },
      next = jest.fn();
    metrics.observe(
      { user: { license: 'shop', id: 'private-user' }, body: { question: 'private-question' } },
      res,
      next
    );
    res.json(body);
    await new Promise((resolve) => setImmediate(resolve));
    expect(next).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls.at(-1)[1].$inc).toMatchObject({ requests: 1, [key]: 1 });
  }
  expect(JSON.stringify(updateOne.mock.calls)).not.toMatch(/private|question|answer"/);
});

test('provider failure keeps its original error and successful calls preserve their result', async () => {
  const updateOne = jest.fn().mockResolvedValue({});
  BaseModel.getDb.mockResolvedValue({
    collection: () => ({ createIndex: jest.fn().mockResolvedValue('index'), updateOne }),
  });
  const error = new Error('sensitive provider response');
  await expect(
    metrics.providerCall('ask_posnic_help', { licenseId: 'shop' }, async () => {
      throw error;
    })
  ).rejects.toBe(error);
  const answer = { text: 'private answer' };
  await expect(
    metrics.providerCall('ask_posnic_help', { licenseId: 'shop' }, async () => answer)
  ).resolves.toBe(answer);
  await new Promise((resolve) => setImmediate(resolve));
  expect(updateOne.mock.calls.map((call) => call[1].$inc)).toEqual([
    expect.objectContaining({ calls: 1, failed: 1 }),
    expect.objectContaining({ calls: 1, succeeded: 1 }),
  ]);
  expect(JSON.stringify(updateOne.mock.calls)).not.toMatch(/sensitive|private/);
  await metrics.providerCall('voice', {}, async () => answer);
  expect(updateOne).toHaveBeenCalledTimes(2);
});

test('telemetry failure cannot fail an answer and invalid inputs never enter counters', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  BaseModel.getDb.mockRejectedValue(new Error('db unavailable'));
  await expect(
    metrics.record({ licenseId: 'shop' }, 'request', { requests: 1 })
  ).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith('[ask-posnic] operational counters unavailable');
  warn.mockRestore();
  const db = { collection: jest.fn() };
  await metrics.write(db, {}, 'request', { requests: 1 });
  await metrics.write(db, { licenseId: 'shop' }, 'request', {
    requests: Infinity,
    prompt: 'private',
    failed: -1,
  });
  await metrics.write(db, { licenseId: 'shop' }, 'cost', { calls: 1 }, { currency: 'bad' });
  expect(db.collection).not.toHaveBeenCalled();
});
