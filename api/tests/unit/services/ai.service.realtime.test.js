'use strict';
/*
 * Opening a live voice line on the shop's account.
 *
 * The key is used twice and shown nowhere: once to mint a one-minute session
 * secret, once more never - the secret does the second call. Nothing in the
 * answer can be used to spend the shop's money again.
 */
const service = require('../../../src/services/ai.service');
const budget = require('../../../src/services/ai-budget');

const OFFER = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n';
const context = { branchId: 'b1', licenseId: 'lic' };

function shop({ provider = 'openai', key = 'sk-live-secret', cap = '' } = {}) {
  jest.spyOn(service._repo(), 'resolveGroup').mockImplementation(async (group) => ({
    status: true,
    data: {
      group,
      values:
        group === 'preferences'
          ? { ai_provider: provider, ai_model: '', ai_monthly_cap: cap }
          : group === 'secrets'
            ? { ai_api_key: key }
            : {},
      source: 'branch',
      inherited: false,
    },
  }));
}

function fetchAnswering(plan) {
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = plan.shift();
    if (!step) throw new Error('unexpected fetch ' + url);
    return {
      ok: step.status < 400,
      status: step.status,
      json: async () => step.json,
      text: async () => step.text,
    };
  });
  return calls;
}

describe('ai.service realtimeAnswer', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  test('mints a session on the current endpoint, exchanges the offer with the session secret, and never lets the key out', async () => {
    shop();
    const record = jest.spyOn(budget, 'record').mockResolvedValue();
    const calls = fetchAnswering([
      { status: 200, json: { value: 'ek_short_lived', expires_at: 1 } },
      { status: 200, text: 'v=0\r\nanswer' },
    ]);
    const out = await service.realtimeAnswer(
      {
        feature: 'voice_order_live',
        sdp: OFFER,
        instructions: 'Be brief.',
        tools: [{ type: 'function', name: 'show_order' }],
      },
      context
    );
    expect(out).toEqual({ status: true, data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } });
    expect(JSON.stringify(out)).not.toContain('sk-live-secret');
    expect(JSON.stringify(out)).not.toContain('ek_short_lived');

    expect(calls[0].url).toBe('https://api.openai.com/v1/realtime/client_secrets');
    expect(calls[0].init.headers.authorization).toBe('Bearer sk-live-secret');
    const minted = JSON.parse(calls[0].init.body);
    expect(minted.session.model).toBe('gpt-realtime');
    expect(minted.session.instructions).toBe('Be brief.');
    expect(minted.session.tools[0].name).toBe('show_order');

    expect(calls[1].url).toBe('https://api.openai.com/v1/realtime/calls?model=gpt-realtime');
    expect(calls[1].init.headers.authorization).toBe('Bearer ek_short_lived');
    expect(calls[1].init.headers['content-type']).toBe('application/sdp');
    expect(calls[1].init.body).toBe(OFFER);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ feature: 'voice_order_live', model: 'gpt-realtime' }),
      context
    );
  });

  test('the ears ride with the mint, on both endpoints, trimmed to what the provider takes', async () => {
    shop();
    jest.spyOn(budget, 'record').mockResolvedValue();
    let calls = fetchAnswering([
      { status: 200, json: { value: 'ek_1' } },
      { status: 200, text: 'v=0\r\nanswer' },
    ]);
    await service.realtimeAnswer(
      {
        sdp: OFFER,
        instructions: 'x',
        tools: [],
        transcription: { language: 'TA ', prompt: '  Tamil or  English. ' + 'y'.repeat(900) },
      },
      context
    );
    let ears = JSON.parse(calls[0].init.body).session.audio.input.transcription;
    expect(ears.model).toBe('gpt-4o-mini-transcribe');
    expect(ears.language).toBe('ta');
    expect(ears.prompt.startsWith('Tamil or English. ')).toBe(true);
    expect(ears.prompt.length).toBeLessThanOrEqual(800);

    calls = fetchAnswering([
      { status: 404, json: {} },
      { status: 200, json: { client_secret: { value: 'ek_beta' } } },
      { status: 200, text: 'v=0\r\nbeta' },
    ]);
    await service.realtimeAnswer(
      { sdp: OFFER, instructions: 'x', tools: [], transcription: { language: 'ta' } },
      context
    );
    ears = JSON.parse(calls[1].init.body).input_audio_transcription;
    expect(ears).toEqual({ model: 'whisper-1', language: 'ta' });

    /* Nothing asked: the model alone, no empty fields. */
    calls = fetchAnswering([
      { status: 200, json: { value: 'ek_2' } },
      { status: 200, text: 'v=0\r\nanswer' },
    ]);
    await service.realtimeAnswer(
      { sdp: OFFER, instructions: 'x', tools: [], transcription: { language: 'nope' } },
      context
    );
    expect(JSON.parse(calls[0].init.body).session.audio.input.transcription).toEqual({
      model: 'gpt-4o-mini-transcribe',
    });
  });

  test('falls back to the beta endpoints when the current one is not there yet', async () => {
    shop();
    jest.spyOn(budget, 'record').mockResolvedValue();
    const calls = fetchAnswering([
      { status: 404, json: { error: { message: 'unknown' } } },
      { status: 200, json: { client_secret: { value: 'ek_beta' } } },
      { status: 200, text: 'v=0\r\nbeta answer' },
    ]);
    const out = await service.realtimeAnswer({ sdp: OFFER, instructions: 'x', tools: [] }, context);
    expect(out).toEqual({
      status: true,
      data: { sdp: 'v=0\r\nbeta answer', model: 'gpt-4o-realtime-preview' },
    });
    expect(calls[1].url).toBe('https://api.openai.com/v1/realtime/sessions');
    expect(calls[1].init.headers['OpenAI-Beta']).toBe('realtime=v1');
    expect(calls[2].url).toBe('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview');
    expect(calls[2].init.headers.authorization).toBe('Bearer ek_beta');
  });

  test('refuses without a provider that can hold a line, without a key, and past the monthly limit', async () => {
    shop({ provider: 'anthropic' });
    expect(
      await service.realtimeAnswer({ sdp: OFFER, instructions: 'x', tools: [] }, context)
    ).toEqual({
      status: false,
      message: 'Live voice needs an OpenAI key',
      data: null,
    });
    jest.restoreAllMocks();
    shop({ key: '' });
    expect(
      await service.realtimeAnswer({ sdp: OFFER, instructions: 'x', tools: [] }, context)
    ).toMatchObject({ status: false, message: 'No API key is saved for the AI provider' });
    jest.restoreAllMocks();
    shop({ cap: '500' });
    jest.spyOn(budget, 'withinCap').mockResolvedValue({ ok: false, spent: 60000, cap: 50000 });
    const fetched = fetchAnswering([]);
    expect(
      await service.realtimeAnswer({ sdp: OFFER, instructions: 'x', tools: [] }, context)
    ).toMatchObject({
      status: false,
      message: 'This shop has reached its monthly AI spending limit',
    });
    expect(fetched).toHaveLength(0);
  });

  test('a provider that will not answer is one sentence, not a stack trace', async () => {
    shop();
    fetchAnswering([
      { status: 500, json: {} },
      { status: 500, json: {} },
    ]);
    expect(
      await service.realtimeAnswer({ sdp: OFFER, instructions: 'x', tools: [] }, context)
    ).toEqual({
      status: false,
      message: 'The live voice service did not answer',
      data: null,
    });
    expect(await service.realtimeCapable(context)).toBe(true);
    jest.restoreAllMocks();
    shop({ provider: 'google' });
    expect(await service.realtimeCapable(context)).toBe(false);
  });
});
