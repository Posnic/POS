'use strict';

/*
 * One endpoint per settings group (S3).
 *
 * The property being bought here is negative: an endpoint that knows only
 * its own group CANNOT be asked for a field belonging to another. All three
 * bugs of 2026-08-20 came from one endpoint serving every screen and
 * demanding fields the caller never had. The tests below try to express
 * those bugs through the new endpoints and fail to.
 *
 * The other property is that secrets do not come back. An SMTP password
 * currently travels to any client that reads settings; GET here reports
 * only WHICH credentials are configured.
 */

const mockResolve = jest.fn();
const mockSave = jest.fn();
const mockCopy = jest.fn();

jest.mock('../../../src/repositories/settings.repository', () => {
  return class MockRepo {
    resolveGroup(...a) {
      return mockResolve(...a);
    }
    saveGroup(...a) {
      return mockSave(...a);
    }
    copyGroups(...a) {
      return mockCopy(...a);
    }
  };
});

const controller = require('../../../src/controllers/settings-groups.controller');

const mkRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const mkReq = (over = {}) => ({
  params: {},
  body: {},
  user: {
    usertype: 'super_admin',
    license: '64b000000000000000000002',
    branch_id: '64b000000000000000000001',
    access: { setting: { read: true, write: true } },
  },
  ...over,
});

describe('settings group endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockResolve.mockResolvedValue({ status: true, data: { group: 'features', values: {} } });
    mockSave.mockResolvedValue({ status: true, data: { written: [] } });
    mockCopy.mockResolvedValue({ status: true, data: { copied: { features: [] } } });
  });

  test('an unknown group is a 404, never a guess', async () => {
    const res = mkRes();
    await controller.read(mkReq({ params: { group: 'wibble' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  test('a signature-only save goes through - the payload that used to 400', async () => {
    const res = mkRes();
    await controller.write(
      mkReq({
        params: { group: 'documents' },
        body: { quote_default_signature: 'data:image/png;base64,AAA' },
      }),
      res
    );
    expect(mockSave).toHaveBeenCalledWith(
      'documents',
      { quote_default_signature: 'data:image/png;base64,AAA' },
      expect.anything(),
      expect.anything()
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  test('nothing but the sent keys reaches the repository', async () => {
    const res = mkRes();
    await controller.write(
      mkReq({ params: { group: 'features' }, body: { quotes_enable: 'true' } }),
      res
    );
    expect(mockSave.mock.calls[0][1]).toEqual({ quotes_enable: 'true' });
  });

  test('GET secrets reports which are configured, never the values', async () => {
    mockResolve.mockResolvedValue({
      status: true,
      data: {
        group: 'secrets',
        values: { email_smtp_host: 'smtp.example.com', email_smtp_password: 'hunter2' },
      },
    });
    const res = mkRes();
    await controller.read(mkReq({ params: { group: 'secrets' } }), res);

    const payload = res.json.mock.calls[0][0];
    const asText = JSON.stringify(payload);
    expect(asText).not.toContain('hunter2');
    expect(asText).not.toContain('smtp.example.com');
    expect(payload.data.configured.email_smtp_password).toBe(true);
    expect(payload.data.configured.email_smtp_from).toBe(false);
  });

  test('a cashier cannot read or write the shop credentials', async () => {
    const cashier = {
      usertype: 'cashier',
      license: 'L',
      branch_id: 'B',
      access: { setting: { read: true, write: true } },
    };
    const r1 = mkRes();
    await controller.read(mkReq({ params: { group: 'secrets' }, user: cashier }), r1);
    expect(r1.status).toHaveBeenCalledWith(403);

    const r2 = mkRes();
    await controller.write(
      mkReq({ params: { group: 'secrets' }, body: { email_smtp_password: 'x' }, user: cashier }),
      r2
    );
    expect(r2.status).toHaveBeenCalledWith(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('level is a control word, not a setting, so it never reaches the payload', async () => {
    const res = mkRes();
    await controller.write(
      mkReq({ params: { group: 'features' }, body: { quotes_enable: 'true', level: 'account' } }),
      res
    );
    expect(mockSave.mock.calls[0][1]).toEqual({ quotes_enable: 'true' });
    expect(mockSave.mock.calls[0][3]).toEqual({ level: 'account' });
  });

  test('a nonsense level is refused rather than silently treated as branch', async () => {
    const res = mkRes();
    await controller.write(
      mkReq({ params: { group: 'features' }, body: { level: 'everywhere' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test('a rejected key is reported back with its name', async () => {
    mockSave.mockResolvedValue({
      status: false,
      data: { rejected: ['print_type'] },
      message: 'These keys do not belong to features: print_type',
    });
    const res = mkRes();
    await controller.write(
      mkReq({ params: { group: 'features' }, body: { print_type: 'a4' } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].data.rejected).toEqual(['print_type']);
  });

  test('read is refused without the settings permission', async () => {
    const res = mkRes();
    await controller.read(
      mkReq({ params: { group: 'features' }, user: { access: { setting: { read: false } } } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

/*
 * S5 - inheritance.
 *
 * `null` means INHERIT: stop deciding this here and take whatever the level
 * above says. It is a different instruction from writing a value, and the
 * dangerous half is the legacy mirror - writing null through to the old
 * branches document would destroy the very value the branch is being told to
 * fall back ON, so "reset to inherited" would delete what it meant to inherit.
 */
describe('inheritance', () => {
  /* These blocks sit OUTSIDE the first describe, so they do not inherit its
     beforeEach - without this the mocks accumulate across tests and an
     assertion on mock.calls[0] reads a call some earlier test made. */
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockResolve.mockResolvedValue({ status: true, data: { group: 'features', values: {} } });
    mockSave.mockResolvedValue({ status: true, data: { written: [] } });
    mockCopy.mockResolvedValue({ status: true, data: { copied: { features: [] } } });
  });

  test('reading the account level does not start from a branch override', async () => {
    const accountRead = jest.fn().mockResolvedValue({
      status: true,
      data: {
        group: 'features',
        level: 'account',
        values: { quotes_enable: 'true' },
        set: ['quotes_enable'],
      },
    });
    // the mock repo exposes accountGroup the same way as the others
    const repoModule = require('../../../src/repositories/settings.repository');
    const proto = repoModule.prototype;
    const original = proto.accountGroup;
    proto.accountGroup = accountRead;

    const res = mkRes();
    await controller.read(
      mkReq({ params: { group: 'features' }, query: { level: 'account' } }),
      res
    );

    expect(accountRead).toHaveBeenCalled();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.level).toBe('account');
    proto.accountGroup = original;
  });

  test('the resolved read says what a reset would fall back to', async () => {
    mockResolve.mockResolvedValue({
      status: true,
      data: {
        group: 'features',
        values: { quotes_enable: 'false' },
        source: { quotes_enable: 'branch' },
        inherited: { quotes_enable: 'true' },
      },
    });
    const res = mkRes();
    await controller.read(mkReq({ params: { group: 'features' } }), res);
    const { data } = res.json.mock.calls[0][0];
    // the branch overrides to false, but the screen can now say what
    // "reset to inherited" would restore
    expect(data.source.quotes_enable).toBe('branch');
    expect(data.inherited.quotes_enable).toBe('true');
  });

  test('null reaches the repository intact - it is an instruction, not a blank', async () => {
    const res = mkRes();
    await controller.write(
      mkReq({ params: { group: 'features' }, body: { quotes_enable: null } }),
      res
    );
    expect(mockSave.mock.calls[0][1]).toEqual({ quotes_enable: null });
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  test('secrets never carry an inherited map out either', async () => {
    mockResolve.mockResolvedValue({
      status: true,
      data: {
        group: 'secrets',
        values: { email_smtp_password: 'hunter2' },
        source: { email_smtp_password: 'branch' },
        inherited: { email_smtp_password: 'account-level-secret' },
      },
    });
    const res = mkRes();
    await controller.read(mkReq({ params: { group: 'secrets' } }), res);
    const asText = JSON.stringify(res.json.mock.calls[0][0]);
    expect(asText).not.toContain('hunter2');
    expect(asText).not.toContain('account-level-secret');
  });
});

/*
 * S6 - copying settings between branches.
 *
 * The destination is the dangerous parameter: it is the branch being
 * overwritten. So access is checked on BOTH branches, and the copy is
 * owner-class only - deciding that one shop should now behave like another is
 * not a cashier's call.
 */
describe('copying settings between branches', () => {
  /* These blocks sit OUTSIDE the first describe, so they do not inherit its
     beforeEach - without this the mocks accumulate across tests and an
     assertion on mock.calls[0] reads a call some earlier test made. */
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockResolve.mockResolvedValue({ status: true, data: { group: 'features', values: {} } });
    mockSave.mockResolvedValue({ status: true, data: { written: [] } });
    mockCopy.mockResolvedValue({ status: true, data: { copied: { features: [] } } });
  });

  const A = '64b00000000000000000000a';
  const B = '64b00000000000000000000b';

  test('a copy names both branches and the groups', async () => {
    const res = mkRes();
    await controller.copy(
      mkReq({ body: { from: A, to: B, groups: ['features', 'preferences'] } }),
      res
    );
    expect(mockCopy).toHaveBeenCalledWith(['features', 'preferences'], A, B, expect.anything());
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  test('without a destination it refuses rather than guessing', async () => {
    const res = mkRes();
    await controller.copy(mkReq({ body: { from: A, groups: ['features'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  test('a cashier cannot make one shop behave like another', async () => {
    const res = mkRes();
    await controller.copy(
      mkReq({
        body: { from: A, to: B, groups: ['features'] },
        user: {
          usertype: 'cashier',
          license: 'L',
          branch_id: A,
          access: { setting: { read: true, write: true } },
        },
      }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  test('a branch the account cannot reach is refused - destination included', async () => {
    const restricted = {
      usertype: 'manager',
      license: 'L',
      branch_id: A,
      branch_access: [{ branch_id: A }],
      access: { setting: { read: true, write: true } },
    };
    const res = mkRes();
    await controller.copy(
      mkReq({ body: { from: A, to: B, groups: ['features'] }, user: restricted }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json.mock.calls[0][0].message).toMatch(/destination/i);
    expect(mockCopy).not.toHaveBeenCalled();
  });

  test('an unrestricted account (no branch_access list) may copy', async () => {
    const res = mkRes();
    await controller.copy(mkReq({ body: { from: A, to: B, groups: ['features'] } }), res);
    expect(mockCopy).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  test('a refusal from the repository is reported with its reason', async () => {
    mockCopy.mockResolvedValue({
      status: false,
      data: { refused: ['secrets'] },
      message: 'Credentials are never copied between branches',
    });
    const res = mkRes();
    await controller.copy(mkReq({ body: { from: A, to: B, groups: ['secrets'] } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].data.refused).toEqual(['secrets']);
  });
});
