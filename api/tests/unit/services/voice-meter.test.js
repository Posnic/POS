'use strict';
/*
 * The meter on a live voice line.
 *
 * The audio never passes our server, so the minutes are counted from the
 * page's "still talking" ticks, clocked here. These pin what makes that
 * honest: the server measures the gap itself, a late tick cannot stretch a
 * call, the seconds land on the same meter as every other feature without
 * counting as calls, and the monthly limit ends a call in progress rather
 * than only refusing the next one.
 */
const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const budget = require('../../../src/services/ai-budget');
const ai = require('../../../src/services/ai.service');
const meter = require('../../../src/services/voice-meter');

const context = { branchId: 'b1', licenseId: 'lic' };
const T0 = new Date('2026-09-12T10:00:00Z');

function fakeDb() {
  const sessions = new Map();
  const usage = [];
  const db = {
    collection(name) {
      if (name === meter.sessionCollection) {
        return {
          async insertOne(row) {
            const _id = new ObjectId();
            sessions.set(String(_id), { _id, ...row });
            return { insertedId: _id };
          },
          async findOne(filter) {
            const row = sessions.get(String(filter._id));
            if (!row) return null;
            if (filter.ended !== undefined && row.ended !== filter.ended) return null;
            if (filter.branch_id !== undefined && row.branch_id !== filter.branch_id) return null;
            return { ...row };
          },
          async updateOne(filter, update) {
            const row = sessions.get(String(filter._id));
            if (!row) return { matchedCount: 0 };
            for (const [k, v] of Object.entries(update.$inc || {})) row[k] = (row[k] || 0) + v;
            Object.assign(row, update.$set || {});
            return { matchedCount: 1 };
          },
          deleteMany: async () => ({ deletedCount: 0 }),
        };
      }
      if (name === 'branches') {
        return { findOne: async () => ({ currency_text: 'India Rupee / INR or ₹' }) };
      }
      if (name === budget.COLLECTION) {
        return {
          async updateOne(filter, update) {
            usage.push({ filter, update });
          },
          find: () => ({ toArray: async () => [] }),
        };
      }
      throw new Error('unexpected collection ' + name);
    },
  };
  return { db, sessions, usage };
}

describe('voice-meter', () => {
  const originalGetDb = BaseModel.getDb;
  let rig;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    rig = fakeDb();
    BaseModel.getDb = jest.fn().mockResolvedValue(rig.db);
    budget._currencyCache.clear();
    jest.spyOn(ai, 'settingsFor').mockResolvedValue({ cap: null, model: '', provider: 'openai' });
  });
  afterEach(() => {
    BaseModel.getDb = originalGetDb;
    budget._currencyCache.clear();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const at = (seconds) => jest.setSystemTime(new Date(T0.getTime() + seconds * 1000));

  test('the line opens with a clock at zero, and the page is handed an id it must send back', async () => {
    const id = await meter.open({ model: 'gpt-realtime', feature: 'voice_order_live' }, context);
    expect(ObjectId.isValid(id)).toBe(true);
    const row = rig.sessions.get(id);
    expect(row).toMatchObject({
      branch_id: 'b1',
      model: 'gpt-realtime',
      feature: 'voice_order_live',
      seconds: 0,
      ended: false,
    });
    expect(row.started_at).toEqual(T0);
  });

  test('a tick is clocked on the server: thirty seconds later adds thirty, as seconds and not as a call', async () => {
    const id = await meter.open({ model: 'gpt-realtime', feature: 'voice_order_live' }, context);
    at(30);
    const out = await meter.tick(id, {}, context);
    expect(out).toEqual({ status: true, data: { seconds: 30, ended: false, next: 30 } });
    expect(rig.sessions.get(id).seconds).toBe(30);
    expect(rig.usage).toHaveLength(1);
    const { filter, update } = rig.usage[0];
    expect(filter.feature).toBe('voice_order_live');
    expect(update.$inc).toMatchObject({ calls: 0, seconds: 30, tokens_in: 300, tokens_out: 240 });
    expect(update.$inc.cost_minor).toBeGreaterThan(0);
    expect(update.$set.last_model).toBe('gpt-realtime');

    /* The next tick counts from the last, not from the start. */
    at(60);
    expect((await meter.tick(id, {}, context)).data.seconds).toBe(60);
    expect(rig.usage[1].update.$inc.seconds).toBe(30);
  });

  test('a late tick cannot stretch a call past a tick and a half', async () => {
    /* A page that stops ticking for ten minutes has lost its network or its
       customer; the provider stops billing a dead line long before that. */
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    at(600);
    const out = await meter.tick(id, {}, context);
    expect(out.data.seconds).toBe(meter.TICK_MAX_SECONDS);
    expect(rig.usage[0].update.$inc.seconds).toBe(meter.TICK_MAX_SECONDS);
  });

  test('a tick with no time passed writes nothing to the meter', async () => {
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    const out = await meter.tick(id, {}, context);
    expect(out).toMatchObject({ status: true, data: { seconds: 0 } });
    expect(rig.usage).toHaveLength(0);
  });

  test('the monthly limit ends a call in progress, and the ended line takes no more ticks', async () => {
    ai.settingsFor.mockResolvedValue({ cap: 500, model: '', provider: 'openai' });
    const room = jest
      .spyOn(budget, 'withinCap')
      .mockResolvedValue({ ok: false, spent: 50100, cap: 50000 });
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    at(30);
    const out = await meter.tick(id, {}, context);
    expect(out).toEqual({ status: false, message: 'cap', data: { seconds: 30 } });
    expect(room).toHaveBeenCalledWith(context, 500);
    /* The seconds that ran up to the limit are still on the meter. */
    expect(rig.usage[0].update.$inc.seconds).toBe(30);
    expect(rig.sessions.get(id)).toMatchObject({ ended: true, ended_by: 'cap' });
    at(60);
    expect(await meter.tick(id, {}, context)).toEqual({
      status: false,
      message: 'no_session',
      data: null,
    });
  });

  test('within the limit the line goes on, and with no limit nobody is asked', async () => {
    ai.settingsFor.mockResolvedValue({ cap: 500, model: '', provider: 'openai' });
    const room = jest
      .spyOn(budget, 'withinCap')
      .mockResolvedValue({ ok: true, spent: 100, cap: 50000 });
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    at(30);
    expect((await meter.tick(id, {}, context)).status).toBe(true);
    expect(room).toHaveBeenCalledTimes(1);
    ai.settingsFor.mockResolvedValue({ cap: null, model: '', provider: 'openai' });
    at(60);
    expect((await meter.tick(id, {}, context)).status).toBe(true);
    expect(room).toHaveBeenCalledTimes(1);
  });

  test('hanging up reports the last stretch and closes the session; "1" on the address counts as hanging up', async () => {
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    at(20);
    const out = await meter.tick(id, { end: '1' }, context);
    expect(out).toEqual({ status: true, data: { seconds: 20, ended: true, next: 0 } });
    expect(rig.sessions.get(id).ended).toBe(true);
    expect(rig.usage[0].update.$inc.seconds).toBe(20);
    at(40);
    expect(await meter.tick(id, { end: true }, context)).toMatchObject({
      status: false,
      message: 'no_session',
    });
  });

  test("a stranger's id, another shop's line, or nonsense opens nothing", async () => {
    const id = await meter.open({ model: 'gpt-realtime' }, context);
    expect(await meter.tick('nonsense', {}, context)).toEqual({
      status: false,
      message: 'no_session',
      data: null,
    });
    expect(await meter.tick(String(new ObjectId()), {}, context)).toMatchObject({
      message: 'no_session',
    });
    expect(await meter.tick(id, {}, { branchId: 'somebody-else' })).toMatchObject({
      message: 'no_session',
    });
    expect(await meter.tick({ $ne: null }, {}, context)).toMatchObject({ message: 'no_session' });
    expect(rig.usage).toHaveLength(0);
  });
});
