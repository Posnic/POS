/*
 * THE KITCHEN'S SPEAKER, IN THE ONLY PLACE THAT CAN DRIVE ONE.
 *
 * Owner: "whenever new KOT received one tink sound with full sound i want.
 * need to place in kitchen. if possible read the items."
 *
 * The main process has no audio device and no speech engine. It hands this
 * page a tone it synthesised and the sentence it composed; this plays one and
 * then says the other. A machine with no window open stays silent, which is
 * correct - there is nobody there to hear it.
 *
 * DESKTOP ONLY, BY CONSTRUCTION. There is no posnic.kitchenCall in a browser,
 * so this file does nothing at all outside the desktop app rather than needing
 * a flag to turn it off.
 */
(function () {
  'use strict';

  var bridge = window.posnic && window.posnic.kitchenCall;
  if (!bridge || typeof bridge.on !== 'function') return;

  /*
   * ONE PLAYER, REUSED. A new Audio() per ticket leaves the old ones alive
   * until they are collected, and a busy service makes a lot of tickets. The
   * alert player beside this one learned the same lesson.
   */
  var player = null;

  /*
   * INDIAN ENGLISH, WHERE THE MACHINE HAS IT.
   *
   * Owner: "its indian english. not so fluent."
   *
   * An American voice reads biryani, paneer and kuzhambu like somebody who has
   * never ordered one. Windows ships en-IN voices - Heera and Ravi - and a
   * kitchen hearing its own dish names said the way the shop says them is the
   * difference between an announcement and a noise to be ignored.
   *
   * Chosen once and remembered, because getVoices() fills in asynchronously
   * and asking per ticket is how the first announcement of a service comes out
   * in the wrong accent.
   */
  /*
   * A WOMAN'S VOICE.
   *
   * Owner: "make female voice. more casual than machine voice. indian accent?"
   *
   * The Web Speech API does not say which voice is which. There is no gender
   * on a SpeechSynthesisVoice, so the only way to ask for one is by name, and
   * this list is the reason the whole selection is written out rather than
   * being a one-line language match.
   *
   * The language match on its own picked Ravi, the male half of the Windows
   * en-IN pair, purely because he is enumerated first - which is how a wanted
   * voice and an unwanted one can both be "correct" to a language check.
   *
   * A name not on this list is not a failure: it falls through to whatever
   * that language does offer, which is still better than English from another
   * country.
   */
  var A_WOMAN = /heera|neerja|priya|kavya|aditi|raveena|swara|libby|sonia|hazel|aria|jenny|michelle|susan|zira|female/i;

  var chosen = null;
  var looked = false;

  function voice() {
    if (looked) return chosen;

    var engine = window.speechSynthesis;
    var all = engine && typeof engine.getVoices === 'function' ? engine.getVoices() : [];
    if (!all || !all.length) return null; /* Not ready yet: ask again next time. */

    looked = true;

    var wanted = ['en-in', 'en-gb', 'en-au', 'en'];
    for (var i = 0; i < wanted.length; i += 1) {
      var tier = [];
      for (var j = 0; j < all.length; j += 1) {
        var lang = String(all[j].lang || '').toLowerCase().replace(/_/g, '-');
        if (lang.indexOf(wanted[i]) === 0) tier.push(all[j]);
      }
      if (!tier.length) continue;

      /* ACCENT FIRST, THEN THE VOICE. An Indian woman before a British one:
         the dish names are the whole point, and "kuzhambu" read in an English
         accent is a word a kitchen has to decode rather than hear. */
      for (var k = 0; k < tier.length; k += 1) {
        if (A_WOMAN.test(String(tier[k].name || ''))) {
          chosen = tier[k];
          return chosen;
        }
      }

      chosen = tier[0];
      return chosen;
    }

    chosen = all[0] || null;
    return chosen;
  }

  /*
   * Said ONE LINE AT A TIME, which is where the pauses come from.
   *
   * A full stop inside one sentence is a shorter gap than a kitchen needs. Two
   * utterances have a real one between them, and the point of that gap is that
   * somebody can hold one dish in their head before the next arrives.
   */
  function speak(lines) {
    if (!lines || !lines.length) return;

    var engine = window.speechSynthesis;
    if (!engine || typeof window.SpeechSynthesisUtterance !== 'function') return;

    try {
      /*
       * WHAT IS ALREADY WAITING IS DROPPED. Six courses from a table of six
       * arrive within seconds; without this the speaker is still working
       * through the last rush when the next one starts, describing food that
       * is already on a pass. The newest ticket is the one nobody has seen.
       */
      if (engine.speaking || engine.pending) engine.cancel();

      var picked = voice();

      for (var i = 0; i < lines.length; i += 1) {
        var said = new window.SpeechSynthesisUtterance(lines[i]);
        if (picked) {
          said.voice = picked;
          said.lang = picked.lang;
        }
        /*
           SAID, NOT ANNOUNCED.

           Owner: "more casual than machine voice."

           A flat voice at a measured pace is what a machine sounds like. The
           opening line is the one that has to carry across a kitchen, and the
           dish names are the ones that have to be right, so neither is rushed
           - but a little lift off the baseline pitch is the difference between
           somebody telling you an order and a station calling a flight.

           Kept close to normal on purpose. Past about 1.15 a synthesised voice
           stops sounding relaxed and starts sounding like a cartoon, which is
           worse than flat: a kitchen laughs at it twice and then ignores it. */
        said.rate = 1;
        said.pitch = 1.1;
        said.volume = 1;
        engine.speak(said);
      }
    } catch (e) {
      /* A machine with no voices installed still gets the ting, which is most
         of the value. Speech is the part that can be missing. */
    }
  }

  bridge.on(function (payload) {
    if (!payload) return;

    var lines =
      payload.lines && payload.lines.length
        ? payload.lines
        : payload.say
          ? [payload.say]
          : [];

    if (!payload.sound) {
      speak(lines);
      return;
    }

    /*
     * THE TING FIRST, AND THE WORDS WAIT FOR IT TO END rather than starting on
     * a timer. A speaker still ringing while it talks loses its first two
     * words, and the first two words are the table number.
     */
    try {
      if (!player) player = new Audio();
      player.src = payload.sound;
      player.volume = 1;

      var spoken = false;
      var thenSpeak = function () {
        if (spoken) return;
        spoken = true;
        speak(lines);
      };

      player.onended = thenSpeak;
      /* A sound that will not play must not take the words with it. A kitchen
         told the order without a chime is still told; silence is the failure
         that matters. */
      player.onerror = thenSpeak;

      var attempt = player.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(thenSpeak);

      /* And a belt for the braces: some engines never fire onended on a clip
         this short. Six hundred milliseconds is longer than the ting. */
      window.setTimeout(thenSpeak, 600);
    } catch (e) {
      speak(lines);
    }
  });

  /*
   * Voices arrive asynchronously on Windows. Asking once at load usually
   * returns an empty list, so this also waits for the engine to say they are
   * ready - and picks then, before the first ticket rather than during it.
   */
  try {
    if (window.speechSynthesis && 'onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = function () {
        looked = false;
        voice();
      };
    }
    voice();
  } catch (e) {
    /* Nothing to do: speak() asks again on the next ticket. */
  }
})();
