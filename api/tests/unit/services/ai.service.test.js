'use strict';

/*
 * The plumbing every AI feature goes through, and the rules it enforces so no
 * feature has to remember them.
 *
 * THE KEY NEVER LEAVES THE SERVER. Every path out of here is checked for it,
 * including the failure paths - which is where a provider's own error message
 * would otherwise carry the request, and sometimes the Authorization header,
 * back to a browser.
 *
 * OFF BY DEFAULT. A shop that configured nothing gets nothing, silently and
 * correctly, and pays nobody.
 *
 * CAPS ARE NOT ADVISORY. These are the shop's money. A loop that asks the same
 * question a thousand times is a mistake somebody makes once, and it should
 * cost them a rupee.
 *
 * THE WIRING IS REAL. settings.repository exports a CLASS; calling resolveGroup
 * on the export gives undefined, which throws, which the caller turns into
 * "could not do that" - dead for every shop and indistinguishable from a
 * provider having a bad day. data-sharing.js shipped with exactly that bug
 * behind twenty-one green tests, so the seam is asserted against the real
 * module and never mocked.
 */

const SettingsRepository = require('../../../src/repositories/settings.repository');
const service = require('../../../src/services/ai.service');
const { GROUPS, groupOf } = require('../../../src/services/settings-groups');

const context = { branchId: 'b', licenseId: 'l' };

/* What a branch has saved, answered the way the real repository answers it. */
const configured = (provider, key, extra = {}) =>
  jest.spyOn(service._repo(), 'resolveGroup').mockImplementation(async (group) => ({
    status: true,
    message: 'success',
    data: {
      group,
      values: group === 'preferences' ? { ai_provider: provider, ...extra } : { ai_api_key: key },
      source: {},
      inherited: {},
    },
  }));

const answered = (text) =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ text }] }),
  });

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('the settings repository is reached the way it is actually exported', () => {
  test('the module exports a constructor, not a ready-made instance', () => {
    expect(typeof SettingsRepository).toBe('function');
    expect(SettingsRepository.prototype.resolveGroup).toBeInstanceOf(Function);
  });

  test('the service holds an INSTANCE, so resolveGroup is callable', () => {
    expect(service._repo()).toBeInstanceOf(SettingsRepository);
    expect(typeof service._repo().resolveGroup).toBe('function');
  });
});

describe('the settings have a home, or the save path would refuse them', () => {
  test('the provider and model are preferences - a screen may show them', () => {
    expect(groupOf('ai_provider')).toBe('preferences');
    expect(groupOf('ai_model')).toBe('preferences');
  });

  test('the key is a secret, so the settings endpoint can only say it exists', () => {
    expect(groupOf('ai_api_key')).toBe('secrets');
    expect(GROUPS.secrets).toContain('ai_api_key');
  });
});

describe('off by default', () => {
  test('a shop that configured nothing is not switched on', async () => {
    configured('', '');
    await expect(service.available(context)).resolves.toBe(false);

    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/not set up/i);
  });

  test('a provider chosen but no key pasted is NOT switched on', async () => {
    /* The setting alone is not the feature. A screen that believes it is puts
       a button in front of somebody and fails when they press it. */
    configured('anthropic', '');
    await expect(service.available(context)).resolves.toBe(false);

    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.message).toMatch(/no api key/i);
  });

  test('a key with no provider is not switched on either', async () => {
    configured('', 'sk-live');
    await expect(service.available(context)).resolves.toBe(false);
  });

  test('switched off explicitly stays off', async () => {
    configured('off', 'sk-live');
    await expect(service.available(context)).resolves.toBe(false);
  });

  test('both set is switched on', async () => {
    configured('anthropic', 'sk-live');
    await expect(service.available(context)).resolves.toBe(true);
  });

  test('available NEVER throws, so a screen can always ask', async () => {
    jest.spyOn(service._repo(), 'resolveGroup').mockRejectedValue(new Error('no database'));
    await expect(service.available(context)).resolves.toBe(false);
  });

  test('a settings read that fails reads as unconfigured, not as a crash', async () => {
    jest.spyOn(service._repo(), 'resolveGroup').mockResolvedValue({
      status: false,
      data: null,
      message: 'Branch context is required',
    });
    await expect(service.settingsFor(context)).resolves.toEqual({
      provider: '',
      model: '',
      key: '',
    });
  });
});

describe('reading what a branch configured', () => {
  test('the provider and key come from data.values, not data', async () => {
    /* Reading data itself is the quiet version of the class-vs-instance bug:
       every shop reads as unconfigured however carefully it was set up. */
    configured('Anthropic', ' sk-live ', { ai_model: ' claude-opus-5 ' });
    const settings = await service.settingsFor(context);
    expect(settings.provider).toBe('anthropic'); // cased however it was typed
    expect(settings.key).toBe('sk-live'); // a pasted key carries whitespace
    expect(settings.model).toBe('claude-opus-5');
  });
});

describe('the caps, because a bug must not become an invoice', () => {
  test('nothing asked is refused before any provider is paid', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = jest.fn();
    for (const prompt of ['', '   ', null, undefined]) {
      const result = await service.ask({ prompt }, context);
      expect(result.status).toBe(false);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a very long question is cut, not sent whole', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = answered('ok');
    await service.ask({ prompt: 'x'.repeat(service.MAX_PROMPT_CHARS * 3) }, context);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const sent = body.messages[0].content.find((part) => part.type === 'text').text;
    expect(sent.length).toBe(service.MAX_PROMPT_CHARS);
  });

  test('more pictures than the cap allows are trimmed', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = answered('ok');
    const page = { data: 'AAAA', mimeType: 'image/jpeg' };
    await service.ask({ prompt: 'read these', images: Array(20).fill(page) }, context);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const images = body.messages[0].content.filter((part) => part.type === 'image');
    expect(images.length).toBe(service.MAX_IMAGES);
  });

  test('an oversized picture is refused, not uploaded', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = jest.fn();
    /* Measured DECODED, which is what a provider bills for. base64 is a third
       larger than the bytes it carries, so checking the string length would
       let a file through that is really over the cap. */
    const huge = 'A'.repeat(Math.ceil((service.MAX_IMAGE_BYTES + 1024) * (4 / 3)));

    const result = await service.ask(
      { prompt: 'read this', images: [{ data: huge, mimeType: 'image/jpeg' }] },
      context
    );
    expect(result.status).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a file that is not a picture is refused', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = jest.fn();
    const result = await service.ask(
      { prompt: 'read this', images: [{ data: 'AAAA', mimeType: 'application/pdf' }] },
      context
    );
    expect(result.status).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('asking with no pictures at all is still a normal question', async () => {
    configured('anthropic', 'sk-live');
    global.fetch = answered('ok');
    await expect(service.ask({ prompt: 'hello' }, context)).resolves.toEqual({
      status: true,
      data: { text: 'ok' },
    });
  });
});

describe('the key does not come back out', () => {
  const KEY = 'sk-super-secret-value';
  beforeEach(() => configured('anthropic', KEY));

  test('a provider that throws is reported in one sentence of our own words', async () => {
    /* The realistic leak: a provider echoes the auth header, or the whole
       request, into its error. Pass that through and the key is in a browser. */
    global.fetch = jest.fn().mockRejectedValue(new Error(`401 for x-api-key ${KEY}`));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.status).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test('a provider that answers with a status does not leak it either', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.status).toBe(false);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  test('an empty answer is a failure, not a silent success', async () => {
    global.fetch = answered('   ');
    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.status).toBe(false);
  });

  test('the happy path returns words and nothing else', async () => {
    global.fetch = answered('  the answer  ');
    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result).toEqual({ status: true, data: { text: 'the answer' } });
  });

  test('the key travels to the provider, and only there', async () => {
    global.fetch = answered('ok');
    await service.ask({ prompt: 'hello' }, context);

    const [url, init] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('api.anthropic.com');
    expect(init.headers['x-api-key']).toBe(KEY);
  });
});

describe('every provider keeps the same shape', () => {
  /* A provider that needed its request or its reply special-cased upstream
     would leak which one a shop uses to the caller, which is the thing this
     file exists to prevent. */
  test('each is a function of one options object', () => {
    const names = Object.keys(service.PROVIDERS);
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      expect(typeof service.PROVIDERS[name]).toBe('function');
      expect(service.PROVIDERS[name].length).toBeLessThanOrEqual(1);
      expect(name).toBe(name.toLowerCase());
    }
  });

  test('each sends the key its own way and answers with plain text', async () => {
    const replies = {
      anthropic: { content: [{ text: 'said' }] },
      openai: { choices: [{ message: { content: 'said' } }] },
      google: { candidates: [{ content: { parts: [{ text: 'said' }] } }] },
    };
    for (const name of Object.keys(service.PROVIDERS)) {
      configured(name, 'sk-live');
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => replies[name] });

      const result = await service.ask(
        { prompt: 'hello', images: [{ data: 'AAAA', mimeType: 'image/png' }] },
        context
      );
      expect(result).toEqual({ status: true, data: { text: 'said' } });
      jest.restoreAllMocks();
    }
  });

  test('an unknown provider is named, not shrugged at', async () => {
    configured('some-gateway', 'sk-live');
    const result = await service.ask({ prompt: 'hello' }, context);
    expect(result.status).toBe(false);
    expect(result.message).toMatch(/some-gateway/);
  });

  test('a shop may name its own model', async () => {
    /* Accounts differ in which models they are allowed. A shop on a tier the
       default is not on would otherwise be locked out with a 404 it cannot
       act on. */
    configured('anthropic', 'sk-live', { ai_model: 'claude-opus-5' });
    global.fetch = answered('ok');
    await service.ask({ prompt: 'hello' }, context);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('claude-opus-5');
  });
});

describe('reading JSON back out of an answer', () => {
  /* Models wrap JSON in prose and in code fences however firmly they are asked
     not to. A feature that crashes on that works in testing and fails on a
     Tuesday. */
  test('plain JSON', () => {
    expect(service.jsonFrom('[{"name":"Dosa"}]')).toEqual([{ name: 'Dosa' }]);
  });

  test('inside a code fence', () => {
    expect(service.jsonFrom('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(service.jsonFrom('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('wrapped in an apology', () => {
    expect(service.jsonFrom('Sure! Here you go:\n[{"a":1}]\nLet me know.')).toEqual([{ a: 1 }]);
  });

  test('nonsense answers null, and every caller must survive that', () => {
    for (const said of ['', '   ', null, undefined, 'I cannot do that', '{broken']) {
      expect(service.jsonFrom(said)).toBeNull();
    }
  });
});
