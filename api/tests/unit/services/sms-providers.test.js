'use strict';

const {
  PROVIDERS,
  listProviders,
  getProvider,
  secretKeys,
} = require('../../../src/services/sms-providers');

describe('sms-providers registry', () => {
  test('every provider builds a well-formed request', () => {
    for (const p of Object.values(PROVIDERS)) {
      const cfg = {};
      p.fields.forEach((f) => (cfg[f.key] = 'x'));
      const spec = p.build(cfg, '+15551234567', 'hello');
      expect(typeof spec.method).toBe('string');
      expect(typeof spec.url).toBe('string');
      expect(spec.url.length).toBeGreaterThan(0);
      expect(['json', 'form', 'raw', 'none']).toContain(spec.bodyType);
      expect(typeof spec.success).toBe('function');
    }
  });

  test('listProviders exposes metadata but no build fn', () => {
    const list = listProviders();
    expect(list.length).toBeGreaterThanOrEqual(20);
    expect(list.every((p) => p.id && p.name && p.scope)).toBe(true);
    expect(list.find((p) => p.id === 'twilio').build).toBeUndefined();
  });

  test('secretKeys returns only the secret fields', () => {
    expect(secretKeys('twilio')).toEqual(['auth_token']);
    expect(secretKeys('vonage')).toEqual(['api_secret']);
  });
});

describe('representative provider builders', () => {
  test('Twilio: Basic auth + form body', () => {
    const spec = getProvider('twilio').build(
      { account_sid: 'AC1', auth_token: 'tok', sender: '+1999' },
      '+15551234567',
      'hi'
    );
    expect(spec.method).toBe('POST');
    expect(spec.url).toContain('/Accounts/AC1/Messages.json');
    expect(spec.headers.Authorization).toBe('Basic ' + Buffer.from('AC1:tok').toString('base64'));
    expect(spec.bodyType).toBe('form');
    expect(spec.body).toEqual({ To: '+15551234567', From: '+1999', Body: 'hi' });
    expect(spec.success({ sid: 'SM1' }, 201)).toBe(true);
    expect(spec.success({}, 400)).toBe(false);
  });

  test('Vonage: credentials in the form body, status "0" is success', () => {
    const spec = getProvider('vonage').build(
      { api_key: 'k', api_secret: 's', sender: 'Shop' },
      '+447700900000',
      'hi'
    );
    expect(spec.body.api_key).toBe('k');
    expect(spec.body.to).toBe('447700900000'); // no leading +
    expect(spec.success({ messages: [{ status: '0' }] })).toBe(true);
    expect(spec.success({ messages: [{ status: '2' }] })).toBe(false);
  });

  test('MSG91: v5 flow with template + authkey header', () => {
    const spec = getProvider('msg91').build(
      { authkey: 'ak', sender: 'MSGIND', template_id: 'T1' },
      '919812345678',
      'hi'
    );
    expect(spec.url).toContain('control.msg91.com/api/v5/flow');
    expect(spec.headers.authkey).toBe('ak');
    expect(spec.body.template_id).toBe('T1');
    expect(spec.body.recipients[0].mobiles).toBe('919812345678');
  });

  test('Custom: fills {to}{from}{message} into a JSON body template', () => {
    const spec = getProvider('custom').build(
      {
        url: 'https://gw.example/send',
        method: 'POST',
        body_type: 'json',
        body_template: '{"dest":"{to}","from":"{from}","txt":"{message}"}',
        sender: 'Shop',
      },
      '+15551234567',
      'hello'
    );
    expect(spec.url).toBe('https://gw.example/send');
    expect(spec.body).toEqual({ dest: '15551234567', from: 'Shop', txt: 'hello' });
  });
});
