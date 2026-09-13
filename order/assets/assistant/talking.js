/*
 * The assistant, looking like it is talking.
 *
 * Owner: "when ai click occupie full screen and have talking ai or some
 * animation whill talk. little not too much annoy."
 *
 * IT FOLLOWS THE VOICE, which is the whole idea. A CSS keyframe loop pulses
 * at a fixed rate whatever is being said, and the eye catches that
 * immediately: it is a thing pretending to talk. This reads the loudness of
 * the audio actually arriving from the provider and hands it to the page as a
 * number between nothing and one, so the orb swells on a vowel and settles in
 * the gap between words. The same motion, driven by the real thing.
 *
 * LITTLE, NOT ANNOYING. The number is smoothed hard - it rises quickly and
 * falls slowly, the way a level meter does - so there is no flicker, and the
 * page turns it into a few pixels of scale rather than a bounce. Somebody
 * ordering lunch should notice it once and then forget it.
 *
 * IT LISTENS, IT DOES NOT PLAY. The audio element is what plays the stream;
 * this taps the same stream into an analyser and connects that to nothing, so
 * there is no second copy of the voice and no echo. If the browser refuses an
 * AudioContext, or there is no stream, the page keeps its own CSS animation
 * and nobody notices.
 */
(function () {
  "use strict";

  var box = null;
  var source = null;
  var analyser = null;
  var frame = 0;
  var level = 0;
  var target = null;

  function context() {
    if (box) return box;
    try {
      var Maker = window.AudioContext || window.webkitAudioContext;
      box = Maker ? new Maker() : null;
    } catch (e) {
      box = null;
    }
    return box;
  }

  /*
   * How loud it is right now, from nothing to one.
   *
   * Root mean square over the waveform rather than a peak: a peak jumps on
   * every consonant and makes the orb twitch, while the average energy of the
   * window is what a person hears as "talking".
   */
  function loudness() {
    if (!analyser) return 0;
    var samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    var sum = 0;
    for (var i = 0; i < samples.length; i++) {
      var away = (samples[i] - 128) / 128;
      sum += away * away;
    }
    var rms = Math.sqrt(sum / samples.length);
    /* Speech sits well below full scale, so a third of the range is loud.
       Clamped, because a shout should not throw the orb off the screen. */
    return Math.max(0, Math.min(1, rms * 3));
  }

  function tick() {
    if (!analyser || !target) return;
    var now = loudness();
    /* Up quickly, down slowly. A meter that falls as fast as it rises reads
       as flicker; this one reads as a voice. */
    level = now > level ? level + (now - level) * 0.5 : level + (now - level) * 0.12;
    try {
      target.style.setProperty("--voice-level", level.toFixed(3));
    } catch (e) {
      /* nothing to draw on */
    }
    frame = window.requestAnimationFrame(tick);
  }

  /**
   * Follow this stream on this element.
   *
   * @param {MediaStream} stream the audio coming back from the provider
   * @param {Element} element the orb to hand the level to
   * @returns {boolean} whether anything is actually being followed
   */
  function follow(stream, element) {
    stop();
    if (!stream || !element) return false;
    var ctx = context();
    if (!ctx) return false;
    try {
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      /* Small window: this is a level meter, not a spectrogram, and a big
         one only makes it slower to react. */
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      /* Deliberately NOT connected to the destination: the audio element is
         already playing this, and a second path is an echo. */
      target = element;
      target.setAttribute("data-follows", "yes");
      frame = window.requestAnimationFrame(tick);
      return true;
    } catch (e) {
      stop();
      return false;
    }
  }

  /** Let go, and leave the orb still. */
  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    try {
      if (source) source.disconnect();
    } catch (e) {
      /* already gone */
    }
    source = null;
    analyser = null;
    level = 0;
    if (target) {
      try {
        target.style.removeProperty("--voice-level");
        target.removeAttribute("data-follows");
      } catch (e) {
        /* the element went with the page */
      }
    }
    target = null;
  }

  window.VoiceTalking = { follow: follow, stop: stop, loudness: loudness };
})();
