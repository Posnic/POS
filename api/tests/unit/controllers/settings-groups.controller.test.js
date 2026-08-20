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

jest.mock('../../../src/repositories/settings.repository', () => {
  return class MockRepo {
    resolveGroup(...a) {
      return mockResolve(...a);
    }
    saveGroup(...a) {
      return mockSave(...a);
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
