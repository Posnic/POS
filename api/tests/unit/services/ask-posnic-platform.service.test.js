'use strict';

jest.mock('../../../src/models/base.model', () => function MockBaseModel() {});
jest.mock('../../../src/services/ask-posnic-metrics.service', () => ({
  record: jest.fn().mockResolvedValue(),
}));
const platform = require('../../../src/services/ask-posnic-platform.service');

describe('follow-up history scope and retention', () => {
  const BaseModel = require('../../../src/models/base.model');
  const req = { user: { _id: 'user', license: 'shop', branch_id: 'outlet' } };
  const id = '012345678901234567890123';
  afterEach(() => {
    delete BaseModel.prototype.getCollection;
  });

  test('reads only this user, shop and outlet and ignores expired answers', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({ store_conversations: true, retention_days: 7 })
      .mockResolvedValueOnce({
        messages: [
          { role: 'assistant', at: new Date(), payload: { intent: 'sales' } },
          { role: 'assistant', at: new Date(0), payload: { intent: 'profit' } },
        ],
      });
    BaseModel.prototype.getCollection = jest.fn().mockResolvedValue({ findOne });
    expect(await platform.previousAnswer(req, id)).toEqual({ intent: 'sales' });
    expect(findOne.mock.calls[1][0]).toEqual({
      _id: expect.any(Object),
      license: 'shop',
      branch_id: 'outlet',
      user_id: 'user',
    });
  });

  test('does not read stored messages when conversation storage is disabled', async () => {
    const findOne = jest.fn().mockResolvedValue({ store_conversations: false });
    BaseModel.prototype.getCollection = jest.fn().mockResolvedValue({ findOne });
    expect(await platform.previousAnswer(req, id)).toBeNull();
    expect(findOne).toHaveBeenCalledTimes(1);
  });
});

describe('Ask Posnic capability policy', () => {
  const req = { user: { _id: 'user', license: 'shop', branch_id: 'outlet' } };

  test('source review keeps shop isolation while normal citations exclude unpublished sources', async () => {
    const BaseModel = require('../../../src/models/base.model');
    const findOne = jest.fn().mockResolvedValue(null);
    BaseModel.prototype.getCollection = jest.fn().mockResolvedValue({ findOne });
    try {
      const id = '012345678901234567890123';
      await platform.getDocument(req, id);
      expect(findOne.mock.calls[0][0]).toMatchObject({
        license: 'shop',
        status: 'published',
        visibility: 'customer',
      });
      await platform.getDocument(req, id, { review: true });
      expect(findOne.mock.calls[1][0]).toEqual({ _id: expect.any(Object), license: 'shop' });
      await platform.getDocument(req, id, { review: 'true' });
      expect(findOne.mock.calls[2][0]).toMatchObject({
        status: 'published',
        visibility: 'customer',
      });
    } finally {
      delete BaseModel.prototype.getCollection;
    }
  });

  test('action signing keeps standalone fallbacks and isolates tenant secrets', async () => {
    const crypto = require('node:crypto');
    const ctx = require('../../../src/db/tenant-context');
    const BaseModel = require('../../../src/models/base.model');
    const names = ['ASK_POSNIC_ACTION_SECRET', 'SESSION_SECRET'];
    const previous = names.map((name) => process.env[name]);
    const previousMode = ctx.isMultiTenant();
    const insertOne = jest.fn().mockResolvedValue({ insertedId: 'draft' });
    BaseModel.prototype.getCollection = jest.fn().mockResolvedValue({ insertOne });
    const verify = async (secret) => {
      const draft = await platform.createDraft(req, 'stock_count', {});
      const [body, signature] = draft.token.split('.');
      expect(signature).toBe(crypto.createHmac('sha256', secret).update(body).digest('base64url'));
    };
    try {
      ctx.enableMultiTenant(false);
      process.env.SESSION_SECRET = 'synthetic-standalone-session';
      for (const value of [undefined, '', 'synthetic-standalone-action']) {
        if (value === undefined) delete process.env.ASK_POSNIC_ACTION_SECRET;
        else process.env.ASK_POSNIC_ACTION_SECRET = value;
        await verify(value || process.env.SESSION_SECRET);
      }
      ctx.enableMultiTenant(true);
      await Promise.all(
        ['synthetic-shop-a', 'synthetic-shop-b'].map((secret) =>
          ctx.runWithTenant({ db: {}, secrets: { SESSION_SECRET: secret } }, async () => {
            await new Promise((resolve) => setImmediate(resolve));
            await verify(secret);
          })
        )
      );
      insertOne.mockClear();
      await expect(platform.createDraft(req, 'stock_count', {})).rejects.toThrow(
        /no SESSION_SECRET for the shop in context/
      );
      await ctx.runWithTenant({ db: {}, secrets: {} }, async () => {
        await expect(platform.createDraft(req, 'stock_count', {})).rejects.toThrow(
          /no SESSION_SECRET for the shop in context/
        );
      });
      expect(insertOne).not.toHaveBeenCalled();
    } finally {
      ctx.enableMultiTenant(previousMode);
      names.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      });
      delete BaseModel.prototype.getCollection;
    }
  });

  test('scoping never propagates the API credential or password into identifier inputs', () => {
    expect(
      platform.scope({
        user: { ...req.user, apikey: 'synthetic-key', password: 'synthetic-password' },
      })
    ).toEqual({ license: 'shop', branch_id: 'outlet', user_id: 'user' });
  });

  test('even signed malformed claims cannot supply Mongo operators or bypass expiry validation', async () => {
    const crypto = require('node:crypto');
    const oldSecret = process.env.ASK_POSNIC_ACTION_SECRET;
    process.env.ASK_POSNIC_ACTION_SECRET = 'synthetic-action-validation-secret';
    const BaseModel = require('../../../src/models/base.model');
    const getCollection = jest.fn();
    BaseModel.prototype.getCollection = getCollection;
    const execute = jest.fn();
    const claims = {
      ...platform.scope(req),
      nonce: 'a'.repeat(32),
      type: 'stock_count',
      expires: Date.now() + 60000,
    };
    const signed = (value) => {
      const body = Buffer.from(JSON.stringify(value)).toString('base64url');
      return (
        body +
        '.' +
        crypto
          .createHmac('sha256', process.env.ASK_POSNIC_ACTION_SECRET)
          .update(body)
          .digest('base64url')
      );
    };
    try {
      for (const value of [
        null,
        [],
        { ...claims, nonce: { $ne: null } },
        { ...claims, nonce: ['a'.repeat(32)] },
        { ...claims, type: { $ne: null } },
        { ...claims, expires: null },
        { ...claims, expires: 'never' },
      ]) {
        await expect(platform.confirmDraft(req, signed(value), execute)).rejects.toThrow(
          /Invalid action confirmation/
        );
      }
      for (const token of [
        { $ne: null },
        signed(claims) + '.extra',
        'a'.repeat(2 * 1024 * 1024 + 1),
      ]) {
        await expect(platform.confirmDraft(req, token, execute)).rejects.toThrow(
          /Invalid action confirmation/
        );
      }
      expect(getCollection).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      const findOneAndUpdate = jest.fn().mockResolvedValue(null);
      getCollection.mockResolvedValue({ findOneAndUpdate });
      await expect(platform.confirmDraft(req, signed(claims), execute)).rejects.toThrow(
        /already used/
      );
      expect(findOneAndUpdate.mock.calls[0][0]).toMatchObject({
        nonce: { $eq: claims.nonce },
        type: { $eq: 'stock_count' },
        expires_at: { $gt: expect.any(Date) },
        license: 'shop',
        branch_id: 'outlet',
        user_id: 'user',
        status: 'pending',
      });
    } finally {
      if (oldSecret === undefined) delete process.env.ASK_POSNIC_ACTION_SECRET;
      else process.env.ASK_POSNIC_ACTION_SECRET = oldSecret;
      delete BaseModel.prototype.getCollection;
    }
  });

  test('confirmed-action telemetry counts only the first audit projection, including recovery replays', async () => {
    const BaseModel = require('../../../src/models/base.model');
    const metrics = require('../../../src/services/ask-posnic-metrics.service');
    const updateOne = jest
      .fn()
      .mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValue({ upsertedCount: 0 });
    const draft = {
      _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      type: 'stock_count',
      status: 'completed',
      output: { private: 'business output' },
    };
    BaseModel.prototype.getCollection = jest.fn(async (name) =>
      name === 'ask_posnic_audit'
        ? { updateOne }
        : {
            findOne: async () =>
              name === 'ask_posnic_action_drafts' ? draft : { _id: 'saved-count' },
          }
    );
    const actor = {
      user: {
        ...req.user,
        license: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        branch_id: 'cccccccccccccccccccccccc',
      },
    };
    await platform.actionOutcome(actor, draft._id);
    await platform.actionOutcome(actor, draft._id);
    expect(metrics.record).toHaveBeenCalledTimes(1);
    expect(metrics.record).toHaveBeenCalledWith({ licenseId: actor.user.license }, 'quality', {
      actions_confirmed: 1,
    });
    delete BaseModel.prototype.getCollection;
  });

  test('rejects oversized authored knowledge instead of truncating restrictions', async () => {
    await expect(
      platform.saveDocument(req, { title: 'Policy', content: 'x'.repeat(200001) })
    ).rejects.toThrow(/200,000/);
    await expect(
      platform.saveDocument(req, { title: 'x'.repeat(201), content: 'Policy' })
    ).rejects.toThrow(/title exceeds 200/);
  });

  test('validates every bundle source before opening a collection for writes', async () => {
    const valid = {
      title: 'Policy',
      content: 'Complete instructions',
      status: 'published',
      visibility: 'customer',
    };
    await expect(
      platform.importBundle(req, {
        schema: 'posnic.ask-knowledge.v1',
        documents: [valid, { ...valid, content: 'x'.repeat(200001) }],
      })
    ).rejects.toThrow(/200,000/);
    await expect(
      platform.importBundle(req, { schema: 'posnic.ask-knowledge.v1', documents: [valid, null] })
    ).rejects.toThrow(/invalid source/);
  });

  test('defaults to enabled when no role list is configured', () => {
    expect(
      platform.capabilityAllowed({ insights_enabled: true, roles: {} }, 'insights', {
        role: 'cashier',
      })
    ).toBe(true);
  });

  test('honours capability switches and role allowlists', () => {
    expect(
      platform.capabilityAllowed({ actions_enabled: false, roles: {} }, 'actions', {
        role: 'admin',
      })
    ).toBe(false);
    expect(
      platform.capabilityAllowed(
        { actions_enabled: true, roles: { actions: ['admin', 'manager'] } },
        'actions',
        { role: 'cashier' }
      )
    ).toBe(false);
    expect(
      platform.capabilityAllowed(
        { actions_enabled: true, roles: { actions: ['admin', 'manager'] } },
        'actions',
        { role: 'manager' }
      )
    ).toBe(true);
  });

  test('normalizes role policy and discards unknown roles', () => {
    expect(
      platform.normalizeRoles({
        help: ['Manager', 'manager', 'unknown'],
        insights: ['owner', 'cashier'],
        unrelated: ['admin'],
      })
    ).toEqual({ help: ['manager'], insights: ['owner', 'cashier'] });
  });

  test('normalizes FAQ questions for exact matching', () => {
    expect(platform.normalizeQuestion('How do I return a sale?')).toBe('how do i return a sale');
    expect(platform.normalizeQuestion('  HOW-do I return a sale!! ')).toBe(
      'how do i return a sale'
    );
  });

  test('an invalid-only role list cannot silently become allow-all', () => {
    expect(() => platform.normalizeRoles({ actions: ['invented'] })).toThrow('valid role');
  });
});
