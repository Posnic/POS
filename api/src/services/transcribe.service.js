'use strict';
/*
 * Turning a clip of a waiter's voice into text, using the shop's own account.
 *
 * WHY THIS IS ON THE SERVER AT ALL.
 *
 * A transcription key put into the handset is a key on every waiter's phone,
 * in a file anybody can read, on devices that get lost and sold. It cannot be
 * rotated without reinstalling every one of them, and a leaked key is billed
 * to the shop until somebody notices the invoice. So the key lives here, in
 * the shop's own settings, and the audio comes to the till instead.
 *
 * The handset never learns which provider was used or what it cost. It sends
 * a clip and gets words back.
 *
 * Adding a provider means adding one entry to PROVIDERS and one value to
 * CHOICES in voice-settings.js. Each is given the audio and the key and
 * returns text; nothing else about the shape of the request reaches the
 * caller, so no provider can leak its identity to a handset.
 *
 * Four now, and they are not ranked. A shop picks on what it already has an
 * account with, what its dining room sounds like, and what it costs:
 *
 *   deepgram  one call, the cheapest, and the fastest to answer
 *   openai    one call, takes browser audio as it arrives, no project setup
 *   assembly  upload, start, poll - the slowest, and the strongest on accents
 *   google    one call, but a project and a region to set up first
 */

const SettingsRepository = require('../repositories/settings.repository');
const voiceSettings = require('../utils/voice-settings');
const menuHints = require('./menu-hints');

/*
 * The module exports the CLASS, not a ready-made instance.
 *
 * Calling resolveGroup on the export gives undefined, which throws, which the
 * caller turns into "could not transcribe" - a feature that is dead in the one
 * way that looks exactly like a provider having a bad day. data-sharing.js was
 * shipped with that exact bug and twenty-one green tests. `_repo()` exists so
 * a test can assert the seam itself rather than mock past it.
 */
let repo = null;
const _repo = () => {
  if (!repo) repo = new SettingsRepository();
  return repo;
};

/* A spoken order is a sentence. Anything longer is a phone left in a pocket,
   and a provider billed by the minute should not be paid for that. */
const MAX_SECONDS = 20;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20000;
/* How often a job that has to be polled is asked whether it is done. Short
   enough that a fast answer is not sat on, long enough not to spend the
   waiter's wait on round trips. */
const POLL_MS = 700;

/**
 * One provider: given audio and a key, return what was said.
 *
 * Kept to this shape deliberately. A provider that needed the request or the
 * response to be special-cased upstream would leak its identity to the
 * handset, which is the thing this file exists to prevent.
 */
const PROVIDERS = {
  /* Whisper. Chosen as the first because it is one call, takes the audio as
     it arrives from a browser, and needs no project or region set up. */
  async openai({ audio, mimeType, language, key, hints }) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), 'order.webm');
    form.append('model', 'whisper-1');
    if (language) form.append('language', String(language).split('-')[0]);
    /* The shop's own dish names, which is the cheapest accuracy there is: a
       model told that "biryani" and "uthappam" are words that exist in this
       room stops reaching for the ordinary English that sounds like them. */
    if (hints) form.append('prompt', hints);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`provider answered ${response.status}`);
    const body = await response.json();
    return String(body.text || '').trim();
  },

  /* Google Speech-to-Text, v1 recognize. Takes base64 inline, which is what
     arrives, so no upload step. */
  async google({ audio, language, key, phrases }) {
    const response = await fetch(
      `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: 'WEBM_OPUS',
            sampleRateHertz: 48000,
            languageCode: language || 'en-IN',
            model: 'latest_short',
            /* The shop's own dish names. Free, and worth more than changing
               provider. The boost is deliberately mild: enough to prefer a
               real dish over the English word that sounds like it, not enough
               to hear a dish in a sentence that had none. */
            ...(phrases && phrases.length
              ? { speechContexts: [{ phrases: phrases.slice(0, 500), boost: 10 }] }
              : {}),
          },
          audio: { content: audio.toString('base64') },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }
    );
    if (!response.ok) throw new Error(`provider answered ${response.status}`);
    const body = await response.json();
    return String(
      (body.results || [])
        .map((r) => (r.alternatives && r.alternatives[0] && r.alternatives[0].transcript) || '')
        .join(' ')
    ).trim();
  },

  /*
   * Deepgram, nova-2. The cheapest of the four by a distance and the fastest:
   * one call, the audio goes in the body as it arrived, words come straight
   * back. No upload step and nothing to poll.
   */
  async deepgram({ audio, mimeType, language, key, phrases }) {
    const query = new URLSearchParams({
      model: 'nova-2',
      /* Numerals as digits and sentences with punctuation. A waiter says
         "two", and "2" is one less thing for the parser to work out. */
      smart_format: 'true',
      punctuate: 'true',
    });
    if (language) query.set('language', language);
    /*
     * The shop's own dish names, repeated as one parameter each - which is the
     * shape this API takes them in, unlike the other three.
     *
     * The boost suffix is deliberately mild for the same reason Google's is:
     * enough to prefer a real dish over the English word that sounds like it,
     * not enough to hear a dish in a sentence that had none.
     */
    for (const phrase of (phrases || []).slice(0, 100)) query.append('keywords', `${phrase}:2`);

    const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
      method: 'POST',
      /* `Token`, not `Bearer`. Getting this wrong is a 401 that reads exactly
         like a shop having typed its key in wrongly. */
      headers: { authorization: `Token ${key}`, 'content-type': mimeType || 'audio/webm' },
      body: audio,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`provider answered ${response.status}`);
    const body = await response.json();
    const channel = ((body.results || {}).channels || [])[0] || {};
    return String(((channel.alternatives || [])[0] || {}).transcript || '').trim();
  },

  /*
   * AssemblyAI. Three calls rather than one, because it has no synchronous
   * endpoint: the clip is uploaded, a job is started, and the job is polled
   * until it finishes. A spoken order is a few seconds of audio and comes back
   * in a few more, which is inside the budget a waiter will stand still for -
   * but it IS the slowest of the four, and that is the trade for its accent
   * handling.
   */
  async assembly({ audio, language, key, phrases }) {
    const auth = { authorization: key };

    const upload = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      body: audio,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upload.ok) throw new Error(`provider answered ${upload.status}`);
    const uploaded = await upload.json();

    const started = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        audio_url: uploaded.upload_url,
        language_code: assemblyLanguage(language),
        ...(phrases && phrases.length
          ? { word_boost: phrases.slice(0, 1000), boost_param: 'default' }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!started.ok) throw new Error(`provider answered ${started.status}`);
    const job = await started.json();
    if (!job.id) throw new Error('provider started no job');

    /* Polled until it is done or the budget runs out. The deadline is the
       same TIMEOUT_MS every other provider gets, counted across the whole
       thing rather than per call, so a slow queue cannot outlast a waiter. */
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, {
        headers: auth,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!poll.ok) throw new Error(`provider answered ${poll.status}`);
      const state = await poll.json();
      if (state.status === 'completed') return String(state.text || '').trim();
      if (state.status === 'error') throw new Error(state.error || 'provider failed the job');
    }
    throw new Error('provider did not finish in time');
  },
};

/*
 * What AssemblyAI calls a language.
 *
 * It takes `en`, `en_us`, `en_au`, `en_uk`, `hi`, `ta` and so on - underscores,
 * and NO `en_in`. The default this whole feature is tuned for is en-IN, so the
 * obvious translation of it is a value the API refuses, which would fail every
 * request for the commonest setting in the estate. Indian English falls back
 * to plain `en`, which is the global model and the right answer for it.
 */
function assemblyLanguage(tag) {
  const said = String(tag || '')
    .trim()
    .toLowerCase()
    .replace('-', '_');
  if (!said) return 'en';
  const KNOWN = ['en_us', 'en_au', 'en_uk'];
  if (KNOWN.includes(said)) return said;
  /* Any other English, Indian included, is the global English model. */
  if (said === 'en' || said.startsWith('en_')) return 'en';
  /* Everything else goes as its bare language: ta-IN is Tamil, not a Tamil
     that only exists in India as far as this provider is concerned. */
  return said.split('_')[0];
}

/**
 * What this branch has configured.
 *
 * Two groups, because the two halves are not the same kind of thing. Which
 * provider a shop uses is a preference and a screen may show it; the key is a
 * secret and the settings endpoint will only ever answer whether one exists.
 *
 * The key is returned here so it can be used, and it must go no further than
 * this module. Nothing that reaches a response may carry it.
 */
async function settingsFor(context) {
  const [preferences, secrets] = await Promise.all([
    _repo().resolveGroup('preferences', context),
    _repo().resolveGroup('secrets', context),
  ]);
  /* resolveGroup answers { status, data: { group, values, source, inherited } }.
     Reading data itself instead of data.values finds nothing and reports a
     shop that has configured everything as a shop that configured nothing. */
  const chosen = (preferences && preferences.status && preferences.data.values) || {};
  const keys = (secrets && secrets.status && secrets.data.values) || {};
  return {
    provider: String(chosen.voice_provider || '')
      .trim()
      .toLowerCase(),
    key: String(keys.voice_api_key || '').trim(),
  };
}

/**
 * Transcribe one clip.
 *
 * @param {{audio: string, language: string, mimeType: string}} request
 *   audio is base64, as a browser produces it
 * @param {{branchId: string, licenseId: string}} context
 * @returns {Promise<{status: boolean, message?: string, data?: {text: string}}>}
 */
async function transcribe(request, context) {
  const { provider, key } = await settingsFor(context);

  if (!provider || provider === 'off') {
    return { status: false, message: 'Voice ordering is not set up for this shop', data: null };
  }
  if (provider === 'server') {
    /*
     * A handset's word, not a shop's choice.
     *
     * `server` is what the HANDSET is told - where to send the audio - and it
     * is never what a shop saves. Seeing it here means something wrote the
     * handset's vocabulary into the shop's setting, and the shop would be
     * billed by a vendor nobody chose. See utils/voice-settings.js.
     */
    return {
      status: false,
      message: 'Voice ordering is not set up for this shop',
      data: null,
    };
  }
  if (provider === 'device') {
    /* Named rather than falling through to "unknown provider", which would
       send somebody looking for a typo in a setting that is spelled right.
       This shop uses the handset's own recogniser; nothing is billed and the
       audio never leaves the phone, so there is nothing here to do. */
    return {
      status: false,
      message: 'This shop transcribes on the handset, not on the server',
      data: null,
    };
  }
  const run = PROVIDERS[provider];
  if (!run) {
    return { status: false, message: `Unknown voice provider: ${provider}`, data: null };
  }
  if (!key) {
    /* Named plainly. A shop that picked a provider and never pasted the key
       otherwise sees "could not transcribe" and has nothing to act on. */
    return { status: false, message: 'No API key is saved for the voice provider', data: null };
  }

  const base64 = String(request.audio || '');
  if (!base64) return { status: false, message: 'No audio was sent', data: null };

  const audio = Buffer.from(base64, 'base64');
  if (!audio.length) return { status: false, message: 'The audio could not be read', data: null };
  if (audio.length > MAX_BYTES) {
    return { status: false, message: 'That recording is too long', data: null };
  }

  try {
    /*
     * What this shop sells, told to the recogniser before it guesses.
     *
     * Read here rather than inside a provider so every provider gets the same
     * list and none has to know where it came from. A menu that could not be
     * read is a slightly worse transcription, never a failed one.
     */
    const phrases = await menuHints.phrasesFor(context);

    const text = await run({
      audio,
      mimeType: request.mimeType || 'audio/webm',
      language: request.language,
      key,
      phrases,
      hints: menuHints.promptFrom(phrases),
    });
    return { status: true, data: { text } };
  } catch (error) {
    /* The provider's own message can carry the request, and sometimes the
       key, back to a handset. One sentence, and the detail stays in the log
       where the shop's own operator can see it. */
    console.error('[transcribe] provider failed:', error.message);
    return { status: false, message: 'The voice service did not answer', data: null };
  }
}

module.exports = {
  transcribe,
  settingsFor,
  _repo,
  PROVIDERS,
  assemblyLanguage,
  MAX_SECONDS,
  MAX_BYTES,
  POLL_MS,
};
