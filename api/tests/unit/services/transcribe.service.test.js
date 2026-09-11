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
