'use strict';
jest.mock('axios');
const axios = require('axios');
const p = require('../../../src/services/whatsapp-providers');
const phone = '+919008427482',
  message = 'Receipt TEST & total';
const configs = {
  meta: { access_token: 'secret', phone_number_id: '1234' },
  brevo: { api_key: 'secret', sender_number: phone },
  twilio: { account_sid: 'AC' + 'a'.repeat(32), auth_token: 'secret', sender_number: phone },
  msg91: {
    api_key: 'secret',
    sender_number: phone,
    template_name: 'receipt',
    namespace: 'namespace',
  },
  '360dialog': { api_key: 'secret' },
  gupshup: { api_key: 'secret', sender_number: phone, app_name: 'test' },
  infobip: { api_key: 'secret', sender_number: phone, account_host: 'test.api.infobip.com' },
};
const responses = {
  meta: { messages: [{ id: 'id' }] },
  brevo: { messageId: 'id' },
  twilio: { sid: 'id', status: 'queued' },
  msg91: { type: 'success', request_id: 'id' },
  '360dialog': { messages: [{ id: 'id' }] },
  gupshup: { status: 'submitted', messageId: 'id' },
  infobip: { messageId: 'id', status: { groupId: 1 } },
};
beforeEach(() => axios.mockReset());
test.each(Object.keys(configs))(
  '%s sends server-side and requires explicit acknowledgement',
  async (id) => {
    const c = { provider: id, ...configs[id] };
    axios.mockResolvedValue({ status: 200, data: responses[id] });
    expect(await p.send(c, phone, message)).toMatchObject({ ok: true, messageId: 'id' });
    const req = axios.mock.calls[0][0];
    expect(req.url).toMatch(/^https:\/\//);
    expect(req.maxRedirects).toBe(0);
    expect(req.timeout).toBe(30000);
    axios.mockResolvedValue({ status: 200, data: {} });
    expect((await p.send(c, phone, message)).ok).toBe(false);
    axios.mockResolvedValue({ status: 401, data: responses[id] });
    expect((await p.send(c, phone, message)).ok).toBe(false);
  }
);
test.each(Object.keys(configs))(
  '%s secrets never leave settings and never cross providers',
  (id) => {
    const c = { provider: id, ...configs[id], unexpected: 'secret' };
    const safe = p.publicConfig(c);
    for (const k of p.secrets) expect(safe.config[k]).toBeUndefined();
    expect(safe.config.unexpected).toBeUndefined();
    const keep = p.merge({}, c);
    for (const f of p.get(id).fields.filter((f) => f.secret)) expect(keep[f.key]).toBe(c[f.key]);
    const changed = p.merge(
      { provider: id },
      {
        provider: 'other',
        api_key: 'wrong-account',
        access_token: 'wrong-account',
        auth_token: 'wrong-account',
      }
    );
    for (const k of p.secrets) expect(changed[k]).not.toBe('wrong-account');
  }
);
test('Brevo template sends named params, text sends no template', () => {
  const c = { provider: 'brevo', ...configs.brevo };
  expect(p.build(c, phone, message).data).toEqual({
    senderNumber: '919008427482',
    contactNumbers: ['919008427482'],
    text: message,
  });
  expect(
    p.build({ ...c, template_id: '1234', message_variable: 'MESSAGE' }, phone, message).data
  ).toMatchObject({ templateId: 1234, params: { MESSAGE: message } });
  expect(() => p.build({ ...c, template_id: '1234' }, phone, message)).toThrow(/variable/);
});
test('Twilio form encodes the exact message and uses approved content variables', () => {
  const c = { provider: 'twilio', ...configs.twilio };
  const text = new URLSearchParams(p.build(c, phone, message).data);
  expect(text.get('Body')).toBe(message);
  expect(text.get('To')).toBe('whatsapp:+919008427482');
  const template = new URLSearchParams(
    p.build({ ...c, template_id: 'HX' + 'b'.repeat(32) }, phone, message).data
  );
  expect(JSON.parse(template.get('ContentVariables'))).toEqual({ 1: message });
  expect(template.has('Body')).toBe(false);
});
test('MSG91 maps approved template body and Gupshup encodes template params', () => {
  expect(
    p.build({ provider: 'msg91', ...configs.msg91 }, phone, message).data.payload.template
      .to_and_components
  ).toEqual([{ to: ['919008427482'], components: { body_1: { type: 'text', value: message } } }]);
  const form = new URLSearchParams(
    p.build({ provider: 'gupshup', ...configs.gupshup, template_id: 'id' }, phone, message).data
  );
  expect(JSON.parse(form.get('template'))).toEqual({ id: 'id', params: [message] });
});
test('Infobip restricts destinations and rejects failed acknowledgements', () => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    'test.api.infobip.com.evil.com',
    'test.api.infobip.com/path',
  ])
    expect(() =>
      p.build({ provider: 'infobip', ...configs.infobip, account_host: host }, phone, message)
    ).toThrow(/hostname/);
  expect(
    p.acknowledgement('infobip', { status: 200, data: { messageId: 'id', status: { groupId: 5 } } })
  ).toBeNull();
});
test('invalid settings and network errors do not leak secrets or retry', async () => {
  expect(() => p.merge({ provider: 'unknown' }, {})).toThrow(/supported/);
  expect((await p.send({ provider: 'brevo' }, phone, message)).ok).toBe(false);
  expect(axios).not.toHaveBeenCalled();
  axios.mockRejectedValue(new Error('secret-token-and-phone'));
  const r = await p.send({ provider: 'brevo', ...configs.brevo }, phone, message);
  expect(r.error).not.toContain('secret');
  expect(axios).toHaveBeenCalledTimes(1);
});
