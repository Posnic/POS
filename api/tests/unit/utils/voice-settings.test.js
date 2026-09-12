'use strict';

/*
 * One setting, two readers, and the bug of them not speaking the same
 * language.
 *
 * `voice_provider` holds what the SHOPKEEPER chose, in words a shopkeeper
 * would use: nothing, the phone itself, or a company they have an account
 * with. The till reads that and knows which vendor to call. A HANDSET must not
 * know the vendor - it only needs to know where the audio goes.
 *
 * Before this, both read the same field with their own vocabulary. A shop that
 * chose `openai` had a handset that recognised neither `off` nor `server`,
 * fell through to its own recogniser, and never called the till. The shop had
 * configured a paid provider, was billed for nothing, got device recognition,
 * and nothing anywhere said so.
 */

const voice = require('../../../src/utils/voice-settings');

describe('what a shop is allowed to choose', () => {
  test('the values are the ones a shopkeeper would say', () => {
    /* Two more ears, both cheaper than the ones that were here first. Owner:
       "i saw your were mentioning assembly ai, deepgram some cheap and best
       stuff. but i dont see those options." */
    expect(voice.CHOICES).toEqual(['off', 'device', 'openai', 'google', 'deepgram', 'assembly']);
  });

  test('a saved choice survives, whatever case it was written in', () => {
    expect(voice.choice('OpenAI')).toBe('openai');
    expect(voice.choice('  google  ')).toBe('google');
  });

  test('nothing saved means the phone itself, not off', () => {
    /* The handset's own recogniser costs nothing and needs no account. A shop
       that never opens this screen should still get voice ordering that works;
       switching it OFF is the deliberate act. */
    for (const value of ['', '   ', null, undefined]) {
      expect(voice.choice(value)).toBe('device');
    }
  });

  test('a value nobody recognises is not honoured', () => {
    /* A typo must not put a shop on a vendor it never chose, and must not
       silently disable the feature either. */
    expect(voice.choice('opneai')).toBe('device');
    expect(voice.choice('server')).toBe('device');
  });
});

describe('what the HANDSET is told', () => {
  const handset = (provider) => voice.forHandset({ voice_provider: provider }).provider;

  test('a paid vendor reads as "send it to the till"', () => {
    /* THE BUG. `openai` reached the handset verbatim, which recognised
       neither `off` nor `server`, used its own recogniser, and never called
       the till at all. */
    expect(handset('openai')).toBe('server');
    expect(handset('google')).toBe('server');
  });

  test('the phone itself reads as the phone itself', () => {
    expect(handset('device')).toBe('device');
    expect(handset('')).toBe('device');
  });

  test('off is off', () => {
    expect(handset('off')).toBe('off');
  });

  test('every choice a shop can make maps to something a handset understands', () => {
    const understood = ['off', 'device', 'server'];
    for (const choice of voice.CHOICES) {
      expect(understood).toContain(handset(choice));
    }
  });

  test('THE VENDOR IS NOT IN WHAT A HANDSET IS TOLD', () => {
    /*
     * A handset told the vendor is a handset that will eventually be asked to
     * hold the key for it, and telling one phone tells every phone in the
     * building.
     */
    for (const vendor of voice.SERVER_SIDE) {
      const told = JSON.stringify(voice.forHandset({ voice_provider: vendor }));
      expect(told).not.toContain(vendor);
    }
  });

  test('and neither is anything resembling a key', () => {
    const told = voice.forHandset({
      voice_provider: 'openai',
      voice_api_key: 'sk-should-never-be-here',
      ai_api_key: 'sk-nor-this',
    });
    expect(JSON.stringify(told)).not.toMatch(/sk-/);
    expect(Object.keys(told).sort()).toEqual(['language', 'provider']);
  });
});

describe('which choices the till transcribes for', () => {
  test('the paid ones, and only those', () => {
    expect(voice.usesServer('openai')).toBe(true);
    expect(voice.usesServer('google')).toBe(true);
    expect(voice.usesServer('device')).toBe(false);
    expect(voice.usesServer('off')).toBe(false);
  });

  test('a list rather than "not device and not off"', () => {
    /* So a future value cannot be reclassified as billable by accident. */
    expect(voice.usesServer('device_offline')).toBe(false);
    expect(voice.usesServer('whatever_comes_next')).toBe(false);
  });
});

describe('the language a recogniser is told to expect', () => {
  /* One told the wrong locale mishears NUMBERS before anything else, and a
     number is half of every order. */
  test('a tag is kept as written', () => {
    expect(voice.language('ta-IN')).toBe('ta-IN');
    expect(voice.language('hi-IN')).toBe('hi-IN');
    expect(voice.language('en-US')).toBe('en-US');
    expect(voice.language('yue-Hant-HK')).toBe('yue-Hant-HK');
  });

  test('nothing saved means Indian English, which is the estate this serves', () => {
    for (const value of ['', '  ', null, undefined]) {
      expect(voice.language(value)).toBe('en-IN');
    }
  });

  test('anything not tag-shaped is refused, because it reaches a native API', () => {
    for (const value of ['; rm -rf /', '../../etc', '<script>', 'a'.repeat(200)]) {
      expect(voice.language(value)).toBe('en-IN');
    }
  });

  test('shaped rather than listed, so a phone is never refused a language it has', () => {
    /* The tags a recogniser accepts differ by platform and by version. A list
       here would refuse a language some handset supports perfectly well. */
    expect(voice.language('kn-IN')).toBe('kn-IN');
    expect(voice.language('bn')).toBe('bn');
  });
});
