'use strict';
const axios = require('axios');
jest.mock('axios', () => ({ post: jest.fn() }));
const {
  resolve,
  settingsUpdate,
  publicConfig,
  read,
  save,
} = require('../../../src/services/shop-email');
const smtp = {
  email_provider: 'custom',
  email_method: 'smtp',
  email_encryption: 'starttls',
  email_smtp_host: 'smtp.example.com',
  email_smtp_port: '587',
  email_smtp_username: 'shop@example.com',
  email_smtp_password: 'secret',
  email_smtp_from: 'shop@example.com',
};
const mail = {
  from: 'Shop <shop@example.com>',
  to: 'Customer <customer@example.com>',
  subject: 'Receipt',
  text: 'Total 420',
  html: '<b>Total 420</b>',
  attachments: [
    { filename: 'bill.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' },
  ],
};
beforeEach(() => jest.clearAllMocks());
test('explicit SMTP enforces TLS and bounded waits', () => {
  const t = resolve(smtp).transporter;
  expect(t.options).toMatchObject({
    port: 587,
    secure: false,
    requireTLS: true,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2' },
  });
  t.close();
  expect(() => resolve({ ...smtp, email_smtp_port: '465' })).toThrow(/SSL/);
  expect(() => resolve({ ...smtp, email_smtp_password: '' })).toThrow(/password/);
  const tls = resolve({ ...smtp, email_smtp_port: '465', email_encryption: 'tls' }).transporter;
  expect(tls.options.secure).toBe(true);
  tls.close();
});
test('platform and unset preserve legacy fallback; unsupported API cannot fall through', () => {
  expect(resolve({})).toBeNull();
  expect(resolve({ ...smtp, email_method: 'platform' })).toBeNull();
  expect(() => resolve({ ...smtp, email_method: 'api', email_api_key: 'secret' })).toThrow(
    /does not support/
  );
});
test('credentials are write-only and blank preserves same-provider secrets', () => {
  const c = {
    ...smtp,
    email_api_key: 'key',
    email_oauth_client_secret: 'client-secret',
    email_oauth_refresh_token: 'token',
  };
  const pub = publicConfig(c);
  expect(JSON.stringify(pub)).not.toContain('client-secret');
  expect(pub.email_smtp_password).toBeUndefined();
  expect(pub.secrets_configured.email_api_key).toBe(true);
  expect(
    settingsUpdate({ email_provider: 'custom', email_api_key: '' }, smtp).email_api_key
  ).toBeUndefined();
  expect(settingsUpdate({ email_provider: 'brevo', email_api_key: '' }, smtp).email_api_key).toBe(
    ''
  );
  expect(
    settingsUpdate({ email_provider: 'custom' }, { email_smtp_host: 'old.example.com' })
      .email_smtp_password
  ).toBeUndefined();
});
test.each(['brevo', 'sendgrid', 'postmark', 'resend'])(
  '%s API sends PDF bytes and requires an acknowledgement',
  async (provider) => {
    const body = { messageId: 'brevo-id', MessageID: 'postmark-id', id: 'resend-id' };
    axios.post.mockResolvedValue({
      data: body,
      headers: { 'x-message-id': 'sendgrid-id' },
      status: 202,
    });
    const sender = resolve({
      ...smtp,
      email_method: 'api',
      email_provider: provider,
      email_api_key: 'key',
    }).transporter;
    const result = await sender.sendMail(mail);
    expect(result.accepted).toEqual(['customer@example.com']);
    expect(result.messageId).toBeTruthy();
    const [url, payload, options] = axios.post.mock.calls[0];
    expect(url.startsWith('https://')).toBe(true);
    expect(options).toMatchObject({ timeout: 30000, maxRedirects: 0 });
    expect(JSON.stringify(payload)).toContain(Buffer.from('%PDF-test').toString('base64'));
    expect(JSON.stringify(payload)).toContain('bill.pdf');
    expect(JSON.stringify(payload)).not.toContain('"key"');
    axios.post.mockResolvedValue({ data: {}, headers: {}, status: 200 });
    await expect(sender.sendMail(mail)).rejects.toThrow(/did not confirm/);
  }
);
test('API failure never leaks keys, redirects or retries', async () => {
  axios.post.mockRejectedValue({
    message: 'secret-token',
    config: { headers: { Authorization: 'secret-token' } },
    response: { status: 403 },
  });
  const sender = resolve({
    ...smtp,
    email_method: 'api',
    email_provider: 'brevo',
    email_api_key: 'secret-token',
  }).transporter;
  await expect(sender.sendMail(mail)).rejects.toThrow('HTTP 403');
  expect(axios.post).toHaveBeenCalledTimes(1);
  await expect(sender.sendMail({ ...mail, attachments: [{ path: 'C:/secret' }] })).rejects.toThrow(
    /file data/
  );
});
test('Microsoft requires OAuth and does not fall back to passwords', () => {
  expect(() => resolve({ ...smtp, email_provider: 'outlook' })).toThrow(/OAuth/);
});
test('email settings use existing local-only messaging authority and retain other channels', async () => {
  const BaseModel = require('../../../src/models/base.model');
  const { ObjectId } = require('mongodb');
  const branch = { _id: new ObjectId(), ...smtp };
  const updateOne = jest.fn().mockResolvedValue({});
  const findOne = jest.fn().mockResolvedValue({ email_config: smtp });
  const db = { collection: jest.fn().mockReturnValue({ findOne, updateOne }) };
  const dbSpy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  const licenseSpy = jest.spyOn(BaseModel, 'license', 'get').mockReturnValue('tenant');
  try {
    expect(await read(branch)).toEqual(smtp);
    await save(branch, { ...smtp, email_smtp_password: '' });
    expect(db.collection).toHaveBeenCalledWith('messaging_settings');
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter.license).toBe('tenant');
    expect(String(filter.branch_id)).toBe(String(branch._id));
    expect(update.$set.email_config.email_smtp_password).toBe('secret');
    expect(update.$set.sms_config).toBeUndefined();
  } finally {
    dbSpy.mockRestore();
    licenseSpy.mockRestore();
  }
});

test('Microsoft refreshes OAuth through a fixed endpoint and sends with the returned token', async () => {
  const nodemailer = require('nodemailer');
  const sendMail = jest
    .fn()
    .mockResolvedValue({ messageId: 'smtp-id', accepted: ['customer@example.com'] });
  const spy = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });
  axios.post.mockResolvedValue({ data: { access_token: 'fresh-access-token' } });
  try {
    const transport = resolve({
      ...smtp,
      email_provider: 'outlook',
      email_oauth_client_id: 'client',
      email_oauth_client_secret: 'client-secret',
      email_oauth_refresh_token: 'refresh',
    }).transporter;
    await transport.sendMail(mail);
    expect(axios.post.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    );
    expect(spy.mock.calls[0][0].auth).toEqual({
      type: 'OAuth2',
      user: smtp.email_smtp_username,
      accessToken: 'fresh-access-token',
    });
    expect(sendMail).toHaveBeenCalledWith(mail);
  } finally {
    spy.mockRestore();
  }
});
test('test-email and email-settings reject staff and malformed recipients without accessing providers', async () => {
  const controller = require('../../../src/controllers/messaging.controller');
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await controller.emailSettings({ user: { usertype: 'cashier' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  res.status.mockClear();
  await controller.testEmail({ user: { usertype: 'cashier' }, body: { to: 'x@example.com' } }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  res.status.mockClear();
  await controller.testEmail(
    { user: { usertype: 'super_admin' }, body: { to: 'one@example.com,two@example.com' } },
    res
  );
  expect(res.status).toHaveBeenCalledWith(400);
  expect(axios.post).not.toHaveBeenCalled();
});
