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

  /*
   * THE VOICE A SHOP ASKED FOR, BY NAME.
   *
   * Owner: "different countries might need different voice and accent."
   *
   * A name rather than a language, because a shop in Chennai and a shop in
   * Dubai both want English and do not want the same person reading it. If the
   * named voice is not on this machine - a different till, a reinstall, a
   * voice pack nobody downloaded yet - this falls through to choosing the best
   * available rather than going quiet. Silence is the failure that matters.
   */
  function named(wanted) {
    if (!wanted) return null;

    var engine = window.speechSynthesis;
    var all = engine && typeof engine.getVoices === 'function' ? engine.getVoices() : [];
    for (var i = 0; i < all.length; i += 1) {
      if (String(all[i].name) === String(wanted)) return all[i];
    }
    return null;
  }

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
   * ONE BELL, RUNG TO ITS END.
   *
   * Resolves however it finishes, including badly. A bell that will not play
   * must never take the words with it: a kitchen told the order without a
   * chime is still told, and silence is the failure that matters.
   */
  function ring(src) {
    return new Promise(function (done) {
      if (!src) return done();

      var over = false;
      var finish = function () {
        if (over) return;
        over = true;
        done();
      };

      try {
        if (!player) player = new Audio();
        player.src = src;
        player.volume = 1;
        player.onended = finish;
        player.onerror = finish;

        var attempt = player.play();
        if (attempt && typeof attempt.catch === 'function') attempt.catch(finish);

        /* A belt for the braces: some engines never fire onended on a clip
           this short, and a sequence that waits forever is worse than one that
           runs on. Longer than the arrival bell, which is the longer of the
           two. */
        window.setTimeout(finish, 1800);
      } catch (e) {
        finish();
      }
    });
  }

  /*
   * ONE LINE, SPOKEN TO ITS END, which is where the pauses come from.
   *
   * A full stop inside one sentence is a shorter gap than a kitchen needs.
   * Separate utterances have a real one between them, and the point of that
   * gap is that somebody can hold one dish in their head before the next
   * arrives.
   */
  function say(text, wanted) {
    return new Promise(function (done) {
      var engine = window.speechSynthesis;
      if (!text || !engine || typeof window.SpeechSynthesisUtterance !== 'function') {
        return done();
      }

      var over = false;
      var finish = function () {
        if (over) return;
        over = true;
        done();
      };

      try {
        var said = new window.SpeechSynthesisUtterance(text);
        var picked = named(wanted) || voice();
        if (picked) {
          said.voice = picked;
          said.lang = picked.lang;
        }
        /*
           SAID, NOT ANNOUNCED.

           Owner: "more casual than machine voice."

           A flat voice at a measured pace is what a machine sounds like. The
           opening line has to carry across a kitchen and the dish names have
           to be right, so neither is rushed, but a little lift off the
           baseline pitch is the difference between somebody telling you an
           order and a station calling a flight.

           Kept close to normal on purpose. Past about 1.15 a synthesised voice
           stops sounding relaxed and starts sounding like a cartoon, which is
           worse than flat: a kitchen laughs at it twice and then ignores it. */
        said.rate = 1;
        said.pitch = 1.1;
        said.volume = 1;
        said.onend = finish;
        said.onerror = finish;

        engine.speak(said);

        /* A voice that never reports finishing must not strand the dishes
           behind it. Longer than any single line of a ticket. */
        window.setTimeout(finish, 9000);
      } catch (e) {
        /* A machine with no voices installed still gets the bells, which is
           most of the value. Speech is the part that can be missing. */
        finish();
      }
    });
  }

  /*
   * Which announcement is the current one.
   *
   * Six courses from a table of six arrive within seconds. Without this the
   * speaker would still be working through the last rush when the next one
   * starts, describing food that is already on a pass. The newest ticket is
   * the one nobody has seen.
   */
  var running = 0;

  bridge.on(function (payload) {
    if (!payload) return;

    var lines =
      payload.lines && payload.lines.length
        ? payload.lines
        : payload.say
          ? [payload.say]
          : [];

    /*
     * WHERE THE FOOD STARTS.
     *
     * Owner: "First bell is we got new order. I want one bell for each line
     * item before read it."
     *
     * Everything from `head` onwards is a dish and gets its own tap in front
     * of it. An older main process sends no `head`, and then nothing is a
     * dish and nothing gets a tap, which is exactly how it behaved before.
     */
    var head = typeof payload.head === 'number' ? payload.head : lines.length;

    var mine = (running += 1);

    try {
      var engine = window.speechSynthesis;
      if (engine && (engine.speaking || engine.pending)) engine.cancel();
    } catch (e) {
      /* An engine that will not be interrupted is still an engine. */
    }

    /*
     * THE BELL FIRST, AND THE WORDS WAIT FOR IT TO END rather than starting on
     * a timer. A speaker still ringing while it talks loses its first two
     * words, and the first two words are the table number.
     */
    var steps = [
      function () {
        return ring(payload.sound);
      },
    ];

    lines.forEach(function (line, i) {
      if (i >= head) {
        steps.push(function () {
          return ring(payload.itemSound);
        });
      }
      steps.push(function () {
        return say(line, payload.voice);
      });
    });

    steps.reduce(function (chain, step) {
      return chain.then(function () {
        /* A newer ticket started while this one was still talking. Stop here
           rather than finish describing food somebody has already plated. */
        if (mine !== running) return undefined;
        return step();
      });
    }, Promise.resolve());
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
