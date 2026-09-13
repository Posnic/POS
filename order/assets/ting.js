/*
 * The sound an order makes when it lands.
 *
 * Owner: "give ting sound to confirm."
 *
 * A customer who has just sent their dinner to a kitchen they cannot see gets
 * one short bell. It is the same moment the drawn scene rings its bell, so the
 * sound and the picture are one event rather than two.
 *
 * SYNTHESISED, NOT A FILE. A .mp3 would be an asset to deploy, a request to
 * make, and a thing the page's own CSP has to allow; this is nine lines of
 * arithmetic and weighs nothing. It also means there is no moment where the
 * picture has arrived and the sound has not.
 *
 * QUIET AND SHORT, ON PURPOSE. Somebody may be sitting in a restaurant, or on
 * a bus, or beside a sleeping child. One strike at a fifth of full volume,
 * gone in under a second: enough to confirm, not enough to announce.
 *
 * IT MAY SIMPLY NOT PLAY, and that is fine. Browsers refuse audio until the
 * page has been interacted with - here the customer has just tapped or spoken
 * to place an order, so it is allowed - and a phone on silent stays silent.
 * Nothing a customer is told depends on hearing this: the screen says the same
 * thing.
 */
(function () {
  "use strict";

  /* One context, made on first use and kept. A new AudioContext per ting
     leaks a hardware handle each time, and browsers cap how many a page may
     have - the twentieth order of the evening would fall silent. */
  var box = null;

  function context() {
    if (box) return box;
    try {
      var Maker = window.AudioContext || window.webkitAudioContext;
      if (!Maker) return null;
      box = new Maker();
    } catch (e) {
      box = null;
    }
    return box;
  }

  /*
   * One struck note.
   *
   * A bell is not a sine wave: it is a fundamental with a partial above it
   * that fades faster, which is what stops this sounding like a test tone.
   * Fast attack, exponential decay, the way something struck actually
   * behaves.
   */
  function strike(ctx, at, frequency, seconds, volume) {
    ["sine", "triangle"].forEach(function (shape, i) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      /* The partial sits a little over two octaves up and dies twice as
         fast, which reads as metal rather than as a beep. */
      osc.type = shape;
      osc.frequency.value = i === 0 ? frequency : frequency * 2.76;
      var peak = i === 0 ? volume : volume * 0.3;
      var fade = i === 0 ? seconds : seconds * 0.5;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + fade + 0.02);
    });
  }

  /**
   * Ring it.
   *
   * @param {{volume?: number}} [options]
   * @returns {boolean} whether anything was actually asked to sound
   */
  function play(options) {
    var ctx = context();
    if (!ctx) return false;
    try {
      /* A context made before the first tap starts suspended; the tap that
         placed the order is what allows this, so ask it to resume. */
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      var volume = options && typeof options.volume === "number" ? options.volume : 0.2;
      var now = ctx.currentTime;
      /* Two strikes, the second a fourth above: a service bell, not an alarm. */
      strike(ctx, now, 1046.5, 0.7, volume);
      strike(ctx, now + 0.13, 1396.9, 0.9, volume * 0.85);
      return true;
    } catch (e) {
      /* No audio device, a hardened browser, a policy that refuses: the
         screen has already said the same thing. */
      return false;
    }
  }

  window.Ting = { play: play };
})();
