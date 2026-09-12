'use strict';

/*
 * Voice transcription, and the two things that must stay true about it.
 *
 * ONE. THE KEY NEVER LEAVES THE SERVER. That is the reason this endpoint
 * exists at all rather than the handset calling a provider itself, so every
 * path out of here is checked for it - including the failure paths, which are
 * where a provider's own error message would otherwise carry the request (and
 * sometimes the key) back to a phone.
 *
 * TWO. THE WIRING IS REAL. settings.repository exports a CLASS. Calling
 * resolveGroup on the export gives undefined, which throws, which the caller
 * turns into "could not transcribe" - indistinguishable from a provider having
 * a bad day, and dead for every shop. data-sharing.js shipped with exactly
 * that bug behind twenty-one green tests, so the seam is asserted against the
 * real module and never mocked.
 */

const SettingsRepository = require('../../../src/repositories/settings.repository');
const service = require('../../../src/services/transcribe.service');
const { GROUPS, groupOf } = require('../../../src/services/settings-groups');

const groupValues = (group, values) => ({
  status: true,
  message: 'success',
  data: { group, values, source: {}, inherited: {} },
});

/* What a branch has saved, answered the way the real repository answers it. */
const configured = (provider, key) =>
  jest
    .spyOn(service._repo(), 'resolveGroup')
    .mockImplementation(async (group) =>
      groupValues(
        group,
        group === 'preferences' ? { voice_provider: provider } : { voice_api_key: key }
      )
    );

describe('the settings repository is reached the way it is actually exported', () => {
  test('the module exports a constructor, not a ready-made instance', () => {
    expect(typeof SettingsRepository).toBe('function');
    expect(SettingsRepository.prototype.resolveGroup).toBeInstanceOf(Function);
  });

  test('the service holds an INSTANCE, so resolveGroup is callable', () => {
    const repo = service._repo();
    expect(repo).toBeInstanceOf(SettingsRepository);
    expect(typeof repo.resolveGroup).toBe('function');
  });
});

describe('the settings it reads have a home, or the save path would refuse them', () => {
  test('the provider is a preference - a screen may show which one is chosen', () => {
    expect(groupOf('voice_provider')).toBe('preferences');
  });

  test('the key is a secret, so the settings endpoint can only say it exists', () => {
    expect(groupOf('voice_api_key')).toBe('secrets');
    expect(GROUPS.secrets).toContain('voice_api_key');
  });
});

describe('reading what a branch has configured', () => {
  const context = { branchId: 'b', licenseId: 'l' };
  afterEach(() => jest.restoreAllMocks());

  /*
   * resolveGroup answers { status, data: { group, values, ... } }. Reading
   * data itself instead of data.values is the quiet version of the same death
   * as the class-vs-instance bug: every shop reads as unconfigured, however
   * carefully it was set up.
   */
  test('the provider and key come from data.values, not data', async () => {
    configured('OpenAI', ' sk-live ');

    const settings = await service.settingsFor(context);
    expect(settings.provider).toBe('openai'); // cased however it was typed
    expect(settings.key).toBe('sk-live'); // a pasted key carries whitespace
  });

  test('a shop that configured nothing reads as nothing, not as a crash', async () => {
    jest.spyOn(service._repo(), 'resolveGroup').mockResolvedValue({
      status: false,
      data: null,
      message: 'Branch context is required',
    });
    await expect(service.settingsFor(context)).resolves.toEqual({ provider: '', key: '' });
  });
});

describe('what it refuses, and what it says while refusing', () => {
  const context = { branchId: 'b', licenseId: 'l' };
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('nothing configured: says so, instead of failing obscurely', async () => {
    configured('', '');
    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/not set up/i);
  });

  test('switched off: refused', async () => {
    configured('off', 'sk-live');
    expect((await service.transcribe({ audio: 'AAAA' }, context)).status).toBe(false);
  });

  test('the handset does its own listening: named, not "unknown provider"', async () => {
    configured('device', '');
    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/handset/i);
    expect(result.message).not.toMatch(/unknown/i);
  });

  test('a provider chosen but no key pasted says THAT, not "could not transcribe"', async () => {
    configured('openai', '');
    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/no api key/i);
  });

  test('an empty recording is refused before any provider is paid for it', async () => {
    configured('openai', 'sk-live');
    global.fetch = jest.fn();
    const result = await service.transcribe({ audio: '' }, context);
    expect(result.status).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a recording past the cap is refused, not uploaded', async () => {
    configured('openai', 'sk-live');
    global.fetch = jest.fn();
    const big = Buffer.alloc(service.MAX_BYTES + 1).toString('base64');

    const result = await service.transcribe({ audio: big }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/too long/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('the key does not come back out', () => {
  const context = { branchId: 'b', licenseId: 'l' };
  const KEY = 'sk-super-secret-value';

  beforeEach(() => configured('openai', KEY));
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test('a provider that throws is reported in one sentence of our own words', async () => {
    /* The realistic leak: a provider echoes the Authorization header, or the
       whole request, into its error. Pass that through and the key is on a
       waiter's phone. */
    global.fetch = jest.fn().mockRejectedValue(new Error(`401 for Bearer ${KEY}`));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result.status).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test('a provider that answers with a status does not leak it either', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result.status).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test('the happy path returns words and nothing else', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '  two chicken biryani and three coffee  ' }),
    });

    const result = await service.transcribe({ audio: 'AAAA' }, context);
    expect(result).toEqual({
      status: true,
      data: { text: 'two chicken biryani and three coffee' },
    });
  });

  test('the key travels to the provider, and only there', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) });

    await service.transcribe({ audio: 'AAAA' }, context);
    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('api.openai.com');
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
  });
});

describe('the shop menu reaches the recogniser', () => {
  /*
   * The cheapest accuracy in the whole feature, and free from every provider.
   * A model told that "biryani" and "uthappam" are words that exist in this
   * room stops reaching for the ordinary English that sounds like them.
   */
  const menuHints = require('../../../src/services/menu-hints');
  const context = { branchId: 'b', licenseId: 'l' };

  beforeEach(() => {
    jest
      .spyOn(menuHints, 'phrasesFor')
      .mockResolvedValue(['Chicken Biryani', 'Masala Dosa', 'Rasmalai']);
  });

  test('Whisper is given them as a prompt', async () => {
    configured('openai', 'sk-live');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) });

    await service.transcribe({ audio: 'AAAA' }, context);
    const form = global.fetch.mock.calls[0][1].body;
    expect(form.get('prompt')).toContain('Chicken Biryani');
    expect(form.get('prompt')).toContain('Rasmalai');
  });

  test('Google is given them as phrase hints, mildly boosted', async () => {
    /* Enough to prefer a real dish over the English word that sounds like it,
       not enough to hear a dish in a sentence that had none. */
    configured('google', 'sk-live');
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [], results: [] }),
    });

    await service.transcribe({ audio: 'AAAA' }, context).catch(() => {});
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.config.speechContexts[0].phrases).toContain('Masala Dosa');
    expect(body.config.speechContexts[0].boost).toBeGreaterThan(0);
  });

  test('a shop with no readable menu is transcribed anyway', async () => {
    /* An improvement, not a dependency. */
    menuHints.phrasesFor.mockResolvedValue([]);
    configured('openai', 'sk-live');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'ok' }) });

    await expect(service.transcribe({ audio: 'AAAA' }, context)).resolves.toEqual({
      status: true,
      data: { text: 'ok' },
    });
    expect(global.fetch.mock.calls[0][1].body.get('prompt')).toBeNull();
  });

  test('nothing but NAMES is sent', async () => {
    /* This list rides with every clip, so the rule has to be one somebody can
       hold in their head: if it is not a name on the shop's menu, it does not
       go. */
    configured('google', 'sk-live');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });

    await service.transcribe({ audio: 'AAAA' }, context).catch(() => {});
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.config.speechContexts[0].phrases).toEqual([
      'Chicken Biryani',
      'Masala Dosa',
      'Rasmalai',
    ]);
  });
});

describe('every provider keeps the same shape', () => {
  /* A provider that needed its request or its reply special-cased upstream
     would leak which one a shop uses to the handset, which is the thing this
     file exists to prevent. */
  test('each is a function of one options object', () => {
    const names = Object.keys(service.PROVIDERS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof service.PROVIDERS[name]).toBe('function');
      expect(service.PROVIDERS[name].length).toBeLessThanOrEqual(1);
      expect(name).toBe(name.toLowerCase());
    }
  });
});

/*
 * THE TWO CHEAP EARS.
 *
 * Owner: "i saw your were mentioning assembly ai, deepgram some cheap and best
 * stuff. but i dont see those options. not included for any reason ?"
 *
 * No reason. OpenAI and Google went first because they are the accounts a shop
 * is likeliest to already hold, and the seam was built so a third and fourth
 * cost one entry each. These are them.
 */
describe('Deepgram', () => {
  const context = { branchId: 'b', licenseId: 'l' };
  const menuHints = require('../../../src/services/menu-hints');

  const answers = (transcript) =>
    jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: { channels: [{ alternatives: [{ transcript }] }] } }),
    });

  beforeEach(() => {
    jest.spyOn(menuHints, 'phrasesFor').mockResolvedValue(['Chicken Biryani', 'Masala Dosa']);
  });

  test('the words come back from where this provider puts them', async () => {
    configured('deepgram', 'dg-live');
    global.fetch = answers('two chicken biryani');

    await expect(service.transcribe({ audio: 'AAAA' }, context)).resolves.toEqual({
      status: true,
      data: { text: 'two chicken biryani' },
    });
  });

  test('the key goes as a Token, which is what this API wants', async () => {
    /* `Bearer` here is a 401 that reads exactly like a shop having typed its
       key in wrongly, and the shop would go looking in the wrong place. */
    configured('deepgram', 'dg-live');
    global.fetch = answers('ok');

    await service.transcribe({ audio: 'AAAA' }, context);
    expect(global.fetch.mock.calls[0][1].headers.authorization).toBe('Token dg-live');
  });

  test('the audio goes in the body, in one call', async () => {
    configured('deepgram', 'dg-live');
    global.fetch = answers('ok');

    await service.transcribe({ audio: 'AAAA', mimeType: 'audio/webm' }, context);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(Buffer.isBuffer(options.body)).toBe(true);
    expect(options.headers['content-type']).toBe('audio/webm');
  });

  test('the shop menu rides along as keywords, mildly boosted', async () => {
    configured('deepgram', 'dg-live');
    global.fetch = answers('ok');

    await service.transcribe({ audio: 'AAAA' }, context);
    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.searchParams.getAll('keywords')).toContain('Chicken Biryani:2');
    expect(url.searchParams.get('model')).toBe('nova-2');
  });

  test('the shop language is passed through, not translated', async () => {
    /* Unlike AssemblyAI below, this one takes en-IN as it stands. */
    configured('deepgram', 'dg-live');
    global.fetch = answers('ok');

    await service.transcribe({ audio: 'AAAA', language: 'en-IN' }, context);
    expect(new URL(global.fetch.mock.calls[0][0]).searchParams.get('language')).toBe('en-IN');
  });

  test('a refusal reaches the handset as one sentence, without the key', async () => {
    configured('deepgram', 'dg-live');
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const answer = await service.transcribe({ audio: 'AAAA' }, context);
    expect(answer.status).toBe(false);
    expect(JSON.stringify(answer)).not.toContain('dg-live');
  });
});

describe('AssemblyAI', () => {
  const context = { branchId: 'b', licenseId: 'l' };
  const menuHints = require('../../../src/services/menu-hints');

  /** Upload, start, then however many polls the test wants. */
  const conversation = (...polls) => {
    const calls = [
      { ok: true, json: async () => ({ upload_url: 'https://cdn/clip' }) },
      { ok: true, json: async () => ({ id: 'job-1' }) },
      ...polls.map((state) => ({ ok: true, json: async () => state })),
    ];
    let at = 0;
    return jest.fn().mockImplementation(async () => calls[Math.min(at++, calls.length - 1)]);
  };

  beforeEach(() => {
    jest.spyOn(menuHints, 'phrasesFor').mockResolvedValue(['Chicken Biryani']);
  });

  test('the clip is uploaded, a job is started, and the job is waited for', async () => {
    configured('assembly', 'aai-live');
    global.fetch = conversation(
      { status: 'processing' },
      { status: 'completed', text: 'three coffee' }
    );

    await expect(service.transcribe({ audio: 'AAAA' }, context)).resolves.toEqual({
      status: true,
      data: { text: 'three coffee' },
    });
    const urls = global.fetch.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toContain('/v2/upload');
    expect(urls[1]).toContain('/v2/transcript');
    expect(urls[2]).toContain('/v2/transcript/job-1');
  });

  test('the key is the authorization header as it stands, with no scheme', async () => {
    configured('assembly', 'aai-live');
    global.fetch = conversation({ status: 'completed', text: 'ok' });

    await service.transcribe({ audio: 'AAAA' }, context);
    expect(global.fetch.mock.calls[0][1].headers.authorization).toBe('aai-live');
  });

  test('the shop menu rides along as boosted words', async () => {
    configured('assembly', 'aai-live');
    global.fetch = conversation({ status: 'completed', text: 'ok' });

    await service.transcribe({ audio: 'AAAA' }, context);
    const started = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(started.word_boost).toContain('Chicken Biryani');
    expect(started.audio_url).toBe('https://cdn/clip');
  });

  test('a job that fails is a failure, not an empty order', async () => {
    /* Resolving with '' would put an empty transcript in front of a waiter
       and look like a microphone that heard nothing. */
    configured('assembly', 'aai-live');
    global.fetch = conversation({ status: 'error', error: 'bad audio' });

    const answer = await service.transcribe({ audio: 'AAAA' }, context);
    expect(answer.status).toBe(false);
  });

  test('en-IN becomes plain en, because there is no en_in to ask for', () => {
    /*
     * THE TRAP THIS EXISTS FOR. en-IN is the default the whole feature is
     * tuned for, and the obvious translation of it - en_in - is a value this
     * API refuses. Left alone it would fail every single request for the
     * commonest setting in the estate.
     */
    expect(service.assemblyLanguage('en-IN')).toBe('en');
    expect(service.assemblyLanguage('en-US')).toBe('en_us');
    expect(service.assemblyLanguage('ta-IN')).toBe('ta');
    expect(service.assemblyLanguage('')).toBe('en');
  });
});

describe('a shop can actually choose them', () => {
  const voice = require('../../../src/utils/voice-settings');

  test('both are settings rather than typos', () => {
    expect(voice.CHOICES).toContain('deepgram');
    expect(voice.CHOICES).toContain('assembly');
    expect(voice.choice('deepgram')).toBe('deepgram');
  });

  test('both are transcribed by the till, so the key stays on it', () => {
    /*
     * The half that is easy to forget. A provider in CHOICES but not in
     * SERVER_SIDE is one a shop can pick and a handset then treats as its own
     * recogniser - the shop pays for an account it never calls, and nothing
     * anywhere says so. That exact bug is what voice-settings.js was written
     * to end.
     */
    expect(voice.usesServer('deepgram')).toBe(true);
    expect(voice.usesServer('assembly')).toBe(true);
    expect(voice.forHandset({ voice_provider: 'deepgram' }).provider).toBe('server');
    expect(voice.forHandset({ voice_provider: 'assembly' }).provider).toBe('server');
  });

  test('and the handset is still never told which company it is', () => {
    const told = voice.forHandset({ voice_provider: 'assembly', voice_language: 'en-IN' });
    expect(JSON.stringify(told)).not.toContain('assembly');
    expect(Object.keys(told).sort()).toEqual(['language', 'provider']);
  });

  test('every choice a shop can make has somewhere to be carried out', () => {
    /* A dropdown that offers a provider the service cannot run is a shop
       silently getting nothing, which is worse than an option missing. */
    for (const chosen of voice.SERVER_SIDE) {
      expect(typeof service.PROVIDERS[chosen]).toBe('function');
    }
  });
});
