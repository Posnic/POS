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
 * Adding a provider means adding one entry to PROVIDERS. Each is given the
 * audio and the key and returns text; nothing else about the shape of the
 * request reaches the caller.
 */

const SettingsRepository = require('../repositories/settings.repository');

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
  async openai({ audio, mimeType, language, key }) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), 'order.webm');
    form.append('model', 'whisper-1');
    if (language) form.append('language', String(language).split('-')[0]);

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
  async google({ audio, language, key }) {
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
};

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
    const text = await run({
      audio,
      mimeType: request.mimeType || 'audio/webm',
      language: request.language,
      key,
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

module.exports = { transcribe, settingsFor, _repo, PROVIDERS, MAX_SECONDS, MAX_BYTES };
