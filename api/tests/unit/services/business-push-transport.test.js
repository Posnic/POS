const { createExpoTransport } = require('../../../src/services/business-push-transport');
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const id = '22222222-2222-4222-8222-222222222222';

test('all 18 recipient languages use fixed private wording and unknown stored locales safely fall back', async () => {
  const messages = require('../../../src/services/business-push-messages.json');
  expect(Object.keys(messages)).toHaveLength(18);
  const payloads = [];
  const transport = createExpoTransport({
    accessToken: 'test',
    fetcher: async (url, options) => {
      payloads.push(JSON.parse(options.body));
      return json({ data: { status: 'ok', id } });
    },
  });
  for (const [locale, body] of Object.entries(messages)) {
    await transport.send('ExpoPushToken[abcdefghij]', 'a'.repeat(24), locale);
    const payload = payloads.at(-1);
    expect(payload.body).toBe(body);
    expect(body).not.toMatch(/[{}]|https?:|\d/);
    expect(payload.title).toBe('Posnic Business');
    expect(payload.data).toEqual({ kind: 'business-inbox', eventId: 'a'.repeat(24) });
    if (locale !== 'en') expect(body).not.toBe(messages.en);
  }
  for (const locale of ['constructor', '__proto__', 'unsupported', null]) {
    await transport.send('ExpoPushToken[abcdefghij]', 'a'.repeat(24), locale);
    expect(payloads.at(-1).body).toBe(messages.en);
  }
});
test('provider payload contains only a generic message and stable collapse identity', async () => {
  const fetcher = jest.fn(async (url, options) => {
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(options.redirect).toBe('error');
    expect(options.credentials).toBe('omit');
    expect(options.headers.Authorization).toBe('Bearer test-secret');
    const payload = JSON.parse(options.body);
    expect(payload.data).toEqual({ kind: 'business-inbox', eventId: 'a'.repeat(24) });
    expect(payload.collapseId).toBe(payload.tag);
    expect(payload.ttl).toBe(3600);
    expect(payload.body).toBe('An update is ready in your Business Inbox.');
    return json({ data: { status: 'ok', id } });
  });
  expect(
    await createExpoTransport({ accessToken: 'test-secret', fetcher }).send(
      'ExpoPushToken[abcdefghij]',
      'a'.repeat(24)
    )
  ).toBe(id);
});
test('provider throttling retries, invalid registrations stop, and receipts are not device delivery claims', async () => {
  await expect(
    createExpoTransport({
      accessToken: 'test',
      fetcher: async () => new Response('', { status: 429 }),
    }).send('ExpoPushToken[abcdefghij]', 'a'.repeat(24))
  ).rejects.toMatchObject({ retryable: true });
  await expect(
    createExpoTransport({
      accessToken: 'test',
      fetcher: async () =>
        json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
    }).send('ExpoPushToken[abcdefghij]', 'a'.repeat(24))
  ).rejects.toMatchObject({ code: 'push_device_removed', retryable: false });
  const transport = createExpoTransport({
    accessToken: 'test',
    fetcher: async () => json({ data: { [id]: { status: 'ok' } } }),
  });
  expect(await transport.receipt(id)).toBe('provider_accepted');
});

test('provider permits only known native channel IDs and keeps the payload generic', async () => {
  for (const channel of [
    'business-updates',
    'business-decisions',
    'business-summaries',
    'business-stock',
  ]) {
    const transport = createExpoTransport({
      accessToken: 'test',
      fetcher: async (_url, options) => {
        const payload = JSON.parse(options.body);
        expect(payload.channelId).toBe(channel);
        expect(payload.data).toEqual({ kind: 'business-inbox', eventId: 'a'.repeat(24) });
        expect(payload.priority).toBe('normal');
        return json({ data: { status: 'ok', id } });
      },
    });
    await transport.send('ExpoPushToken[abcdefghij]', 'a'.repeat(24), 'en', channel);
  }
  const fetcher = jest.fn();
  await expect(
    createExpoTransport({ accessToken: 'test', fetcher }).send(
      'ExpoPushToken[abcdefghij]',
      'a'.repeat(24),
      'en',
      'arbitrary-channel'
    )
  ).rejects.toMatchObject({ code: 'push_invalid_request' });
  expect(fetcher).not.toHaveBeenCalled();
});
