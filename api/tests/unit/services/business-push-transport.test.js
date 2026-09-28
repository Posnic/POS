const { createExpoTransport } = require('../../../src/services/business-push-transport');
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const id = '22222222-2222-4222-8222-222222222222';
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
