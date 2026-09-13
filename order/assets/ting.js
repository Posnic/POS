/*
 * The sound an order makes when it lands.
 *
 * Owner: "give ting sound to confirm."
 *
 * A customer who has just sent their dinner to a kitchen they cannot see gets
 * one short bell. It is the same moment the drawn scene rings its bell, so the
 * sound and the picture are one event rather than two.
 *
 * IT OBEYS THE SILENT SWITCH, and that is why this is built the way it is.
 *
 * The obvious way to make a tone in a browser is the Web Audio API, and the
 * first cut of this did. On an iPhone that is the wrong choice: Web Audio
 * plays THROUGH the ringer switch, so a customer who has deliberately
 * silenced their phone - in a restaurant, in a meeting, beside a sleeping
 * child - is made to chirp anyway. A sound nobody can refuse is not a
 * courtesy. An <audio> element is a media element, and iOS honours the switch
 * for those, so the bell is built as a small WAV and played through one.
 *
 * STILL NOT A FILE. The WAV is a few hundred bytes of arithmetic turned into
 * a data URI: nothing to fetch, nothing for the page's CSP to allow, no asset
 * to deploy, and no moment where the picture has arrived and the sound has
 * not. src/order-alert.js builds the till's alarm the same way, so the two
 * halves of this product make their noises by one technique.
 *
 * QUIET AND SHORT, ON PURPOSE. One strike at a fifth of full volume, gone in
 * under a second: enough to confirm, not enough to announce.
 *
 * IT MAY SIMPLY NOT PLAY, and that is fine. Browsers refuse audio until the
 * page has been interacted with - here the customer has just tapped or spoken
 * to place an order, so it is allowed - and a muted phone stays muted, which
 * is now the point. Nothing a customer is told depends on hearing this: the
 * screen says the same thing.
 */
(function () {
  "use strict";

  var RATE = 22050;

  /*
   * A struck bell, as samples.
   *
   * A bell is not a sine wave: it is a fundamental with a partial above it
   * that fades faster, which is what stops this sounding like a test tone.
   * The envelope decays exponentially, the way something struck behaves,
   * with a couple of milliseconds of ramp at the start so the speaker is not
   * asked to jump - that jump is heard as a click.
   */
  function strike(into, at, frequency, seconds, volume) {
    var samples = Math.floor(RATE * seconds);
    var attack = Math.floor(RATE * 0.004);
    for (var i = 0; i < samples; i += 1) {
      var life = i / samples;
      var envelope = Math.exp(-5 * life) * volume;
      if (i < attack) envelope *= i / attack;
      var value =
        Math.sin((2 * Math.PI * frequency * i) / RATE) * envelope +
        /* The partial sits a little over two octaves up and dies twice as
           fast, which reads as metal rather than as a beep. */
        Math.sin((2 * Math.PI * frequency * 2.76 * i) / RATE) * envelope * Math.exp(-5 * life) * 0.3;
      var slot = at + i;
      if (slot < into.length) into[slot] += value;
    }
  }

  /** A 44-byte RIFF header and the samples after it, as a data URI. */
  function wav(samples) {
    var bytes = samples.length * 2;
    var buffer = new ArrayBuffer(44 + bytes);
    var view = new DataView(buffer);
    var write = function (at, text) {
      for (var i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + bytes, true);
    write(8, "WAVE");
    write(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); /* PCM */
    view.setUint16(22, 1, true); /* mono */
    view.setUint32(24, RATE, true);
    view.setUint32(28, RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, "data");
    view.setUint32(40, bytes, true);
    for (var i = 0; i < samples.length; i += 1) {
      /* Clipped rather than wrapped: two strikes overlap, and a sum past the
         end of the range must come out loud, not inside out. */
      var value = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, Math.round(value * 32767), true);
    }
    var binary = "";
    var raw = new Uint8Array(buffer);
    for (i = 0; i < raw.length; i += 1) binary += String.fromCharCode(raw[i]);
    return "data:audio/wav;base64," + window.btoa(binary);
  }

  /* Built once. The arithmetic is cheap but not free, and the bell never
     changes; the same URI is handed to the element every time. */
  var made = null;
  function bell() {
    if (made) return made;
    try {
      var seconds = 1.05;
      var samples = new Float32Array(Math.floor(RATE * seconds));
      /* Two strikes, the second a fourth above: a service bell, not an alarm. */
      strike(samples, 0, 1046.5, 0.7, 0.2);
      strike(samples, Math.floor(RATE * 0.13), 1396.9, 0.9, 0.17);
      made = wav(samples);
    } catch (e) {
      made = "";
    }
    return made;
  }

  /* One element, reused. A new Audio() per order leaves the old ones alive
     until they are collected, and a busy evening would stack a hundred. */
  var player = null;

  /**
   * Ring it.
   *
   * @returns {boolean} whether anything was actually asked to sound
   */
  function play() {
    try {
      var source = bell();
      if (!source) return false;
      if (!player) player = new window.Audio();
      player.src = source;
      player.currentTime = 0;
      var attempt = player.play();
      /* A browser that refuses - no interaction yet, a policy, no device -
         rejects rather than throws, and that is not an error here. */
      if (attempt && typeof attempt.catch === "function") {
        attempt.catch(function () {
          /* The screen has already said the same thing. */
        });
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  window.Ting = { play: play };
})();
