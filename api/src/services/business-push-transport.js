'use strict';
const ticket = /^[a-f\d-]{36}$/i;
const tokenPattern = /^(?:ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;
function failure(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}
function createExpoTransport({ accessToken, fetcher = fetch } = {}) {
  async function post(path, body) {
    if (!accessToken) throw failure('push_unconfigured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher('https://exp.host/--/api/v2/push/' + path, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer ' + accessToken,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok)
        throw failure(
          'push_provider_unavailable',
          response.status === 429 || response.status >= 500
        );
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw failure('push_invalid_response', true);
      const reader = response.body?.getReader();
      if (!reader) throw failure('push_invalid_response', true);
      let size = 0,
        text = '';
      const decoder = new TextDecoder();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw failure('push_invalid_response', true);
          }
          text += decoder.decode(part.value, { stream: true });
        }
      } finally {
        reader.releaseLock();
      }
      let value;
      try {
        value = JSON.parse(text + decoder.decode());
      } catch {
        throw failure('push_invalid_response', true);
      }
      if (!value || typeof value !== 'object' || value.errors)
        throw failure('push_provider_rejected');
      return value.data;
    } catch (error) {
      if (typeof error.code === 'string' && error.code.startsWith('push_')) throw error;
      throw failure('push_provider_unavailable', true);
    } finally {
      clearTimeout(timer);
    }
  }
  function checked(value) {
    if (value?.status === 'ok') return value;
    if (value?.status === 'error') {
      const code = value.details?.error;
      if (code === 'DeviceNotRegistered') throw failure('push_device_removed');
      if (code === 'MessageRateExceeded') throw failure('push_rate_limited', true);
      throw failure('push_provider_rejected');
    }
    throw failure('push_invalid_response', true);
  }
  return {
    async send(token, eventId) {
      if (!tokenPattern.test(token) || !/^[a-f\d]{24}$/.test(eventId))
        throw failure('push_invalid_request');
      // Never put business figures, account identifiers, URLs, or decisions on a lock screen.
      const data = checked(
        await post('send', {
          to: token,
          title: 'Posnic Business',
          body: 'An update is ready in your Business Inbox.',
          data: { kind: 'business-inbox', eventId },
          channelId: 'business-updates',
          priority: 'normal',
          ttl: 3600,
          collapseId: eventId,
          tag: eventId,
          threadId: 'business-inbox',
        })
      );
      if (!ticket.test(data.id)) throw failure('push_invalid_response', true);
      return data.id;
    },
    async receipt(id) {
      if (!ticket.test(id)) throw failure('push_invalid_request');
      const rows = await post('getReceipts', { ids: [id] });
      if (!rows || typeof rows !== 'object' || Array.isArray(rows))
        throw failure('push_invalid_response', true);
      if (!rows[id]) return null;
      checked(rows[id]);
      return 'provider_accepted';
    },
  };
}
module.exports = { createExpoTransport, tokenPattern };
