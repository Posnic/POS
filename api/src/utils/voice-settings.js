'use strict';
/*
 * What a shop chose about voice ordering, and the much smaller thing a handset
 * is allowed to know about it.
 *
 * ONE SETTING, TWO READERS, AND THEY DO NOT SPEAK THE SAME LANGUAGE. That is
 * the bug this file exists to end.
 *
 * `voice_provider` holds what the SHOPKEEPER chose, in the words a shopkeeper
 * would use: nothing, the phone itself, or the name of a company they have an
 * account with. Four values, one dropdown:
 *
 *     off       no microphone button anywhere
 *     device    the handset's own recogniser: free, offline, no key
 *     openai    the shop's own account
 *     google    the shop's own account
 *     deepgram  the shop's own account
 *     assembly  the shop's own account
 *
 * The till reads that and knows which vendor to call. The HANDSET must not:
 * telling a phone that this shop uses OpenAI tells every phone in the building,
 * and a handset that knows the vendor is a handset that will eventually be
 * asked to hold the key for it. All a handset needs is WHERE THE AUDIO GOES.
 *
 *     off       draw no microphone
 *     device    listen here, send nothing
 *     server    record, and post the clip to the till
 *
 * Before this, both readers read the same field with their own vocabulary. A
 * shop that chose `openai` had a handset that recognised neither `off` nor
 * `server`, fell through to its own recogniser, and never called the till at
 * all. The shop had configured a paid provider, was billed for nothing, and
 * got device recognition - and nothing anywhere said so.
 */

/* What a shop may choose. Anything else is not a setting, it is a typo. */
const CHOICES = Object.freeze(['off', 'device', 'openai', 'google', 'deepgram', 'assembly']);

/* The ones the till transcribes for. Kept as a list rather than "not device
   and not off", so adding a vendor is one entry and cannot accidentally
   reclassify a future value like `device_offline`. */
const SERVER_SIDE = Object.freeze(['openai', 'google', 'deepgram', 'assembly']);

/*
 * The default a shop gets before it has chosen anything.
 *
 * `device` and not `off`, because the handset's own recogniser costs nothing,
 * needs no key, no account and no internet. A shop that never opens the
 * settings screen still gets voice ordering that works; switching it OFF is
 * the deliberate act, not switching it on.
 */
const DEFAULT_CHOICE = 'device';

/*
 * Indian English by default, because that is the estate this serves and a
 * recogniser told the wrong locale mishears NUMBERS before it mishears
 * anything else - and a number is half of every order.
 */
const DEFAULT_LANGUAGE = 'en-IN';

/** A saved value, or the default. Never a guess at what somebody meant. */
function choice(value) {
  const said = String(value == null ? '' : value)
    .trim()
    .toLowerCase();
  if (!said) return DEFAULT_CHOICE;
  return CHOICES.includes(said) ? said : DEFAULT_CHOICE;
}

/**
 * A language tag, or the default.
 *
 * Shaped rather than listed: the tags a recogniser accepts differ by platform
 * and by version, and a list here would refuse a language some phone supports
 * perfectly well. Anything that is not tag-shaped is refused, because it
 * reaches a native API.
 */
function language(value) {
  const said = String(value == null ? '' : value).trim();
  if (!said) return DEFAULT_LANGUAGE;
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(said) ? said : DEFAULT_LANGUAGE;
}

/** Does the till do the transcribing for this shop? */
const usesServer = (value) => SERVER_SIDE.includes(choice(value));

/**
 * What a handset is told.
 *
 * THE VENDOR IS NOT IN HERE, and no future field may put it there. Neither is
 * the key, which does not leave the settings repository at all.
 *
 * @param {object} values a resolved `preferences` group
 * @returns {{provider: 'off'|'device'|'server', language: string}}
 */
function forHandset(values = {}) {
  const chosen = choice(values.voice_provider);
  return {
    provider: chosen === 'off' ? 'off' : usesServer(chosen) ? 'server' : 'device',
    language: language(values.voice_language),
  };
}

module.exports = {
  CHOICES,
  SERVER_SIDE,
  DEFAULT_CHOICE,
  DEFAULT_LANGUAGE,
  choice,
  language,
  usesServer,
  forHandset,
};
