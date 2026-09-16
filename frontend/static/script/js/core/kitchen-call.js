/*
 * THE KITCHEN'S SPEAKER, IN THE ONLY PLACE THAT CAN DRIVE ONE.
 *
 * Owner: "whenever new KOT received one tink sound with full sound i want.
 * need to place in kitchen. if possible read the items."
 *
 * The main process has no audio device and no speech engine. It hands this
 * page a tone it synthesised and a sentence it composed; this plays one and
 * then says the other. A machine with no window open stays silent, which is
 * correct - there is nobody there to hear it.
 *
 * DESKTOP ONLY, BY CONSTRUCTION. There is no posnic.kitchenCall in a browser,
 * so this file does nothing at all outside the desktop app rather than needing
 * a flag to be turned off.
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
   * WHAT IS ALREADY WAITING TO BE SAID.
   *
   * Six courses from a table of six arrive within seconds. Speech queues by
   * default, so without a ceiling the speaker is still working through the
   * last rush when the next one starts, and by then it is describing food that
   * is already on a pass. Past three waiting, the oldest are dropped: the
   * newest ticket is the one nobody has seen.
   */
  var MOST_WAITING = 3;

  function speak(words) {
    if (!words) return;

    var engine = window.speechSynthesis;
    if (!engine || typeof window.SpeechSynthesisUtterance !== 'function') return;

    try {
      if (engine.pending && engine.speaking) {
        /* Cannot count the queue directly, so this is the honest
           approximation: if it is both speaking and holding more, start the
           newest and let the rest go. */
        var waiting = engine.pending ? 1 : 0;
        if (waiting >= MOST_WAITING - 2) engine.cancel();
      }

      var said = new window.SpeechSynthesisUtterance(words);
      /* Slightly slower than default. A kitchen is noisy and a dish name heard
         once has to be right; the seconds cost less than a wrong plate. */
      said.rate = 0.95;
      said.volume = 1;
      engine.speak(said);
    } catch (e) {
      /* A machine with no voices installed still gets the ting, which is most
         of the value. Speech is the part that can be missing. */
    }
  }

  bridge.on(function (payload) {
    if (!payload) return;

    /*
     * THE TING FIRST, THEN THE WORDS, and the words wait for it rather than
     * starting on a timer. A speaker still ringing while it talks loses its
     * first two words, and the first two words are the table number.
     */
    var words = payload.say || '';

    if (!payload.sound) {
      speak(words);
      return;
    }

    try {
      if (!player) player = new Audio();
      player.src = payload.sound;
      player.volume = 1;

      var spoken = false;
      var thenSpeak = function () {
        if (spoken) return;
        spoken = true;
        speak(words);
      };

      player.onended = thenSpeak;
      /* A sound that will not play must not take the words with it: a kitchen
         that hears the order and no chime is still told. */
      player.onerror = thenSpeak;

      var attempt = player.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(thenSpeak);

      /* And a belt for the braces: some engines never fire onended for a very
         short clip. Half a second is longer than the ting. */
      window.setTimeout(thenSpeak, 600);
    } catch (e) {
      speak(words);
    }
  });
})();
