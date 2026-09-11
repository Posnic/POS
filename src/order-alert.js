"use strict";
/*
 * The sound an online order makes.
 *
 * WHY THIS EXISTS AT ALL.
 *
 * Every other way this product learns about a sale has a person standing in
 * front of it: somebody rings it up, somebody hands over a card. An online
 * order is the one that arrives when the shop is not looking - the owner's
 * words were "looking at another page, or watching a movie" - and a badge on a
 * screen nobody is facing is not a notification, it is a record of something
 * that was missed.
 *
 * TWO SOUNDS, DELIBERATELY DIFFERENT.
 *
 *   received   accepted already, ticket printing. One short chime: this is
 *              information, not a task, and a shop doing forty covers an hour
 *              must not be alarmed forty times.
 *   waiting    held for approval. An alarm, repeated, because until somebody
 *              answers it the customer is waiting and the kitchen does not
 *              know they exist. It stops the moment the queue is empty.
 *
 * One sound for both would train staff to ignore the one that matters, which
 * is how alarms stop working.
 *
 * SYNTHESISED, NOT SHIPPED. The tones are generated as a WAV in memory rather
 * than bundled as audio files: two more binaries in the installer, licences to
 * track and a packaging filter to keep correct, for two beeps. Generating them
 * is a page of arithmetic that cannot rot.
 *
 * NOT A DIALOG. The owner's standing rule is that nothing blocks the screen: a
 * modal that steals focus mid-sale is worse than the missed order it was
 * meant to prevent. This makes a noise and updates a count; acting on it is
 * always the person's choice.
 */

const REPEAT_EVERY_MS = 20000;
const MAX_REPEATS = 15; // five minutes of asking, then it stops nagging

/**
 * A single tone as a WAV buffer, ready for an <audio> element.
 *
 * A plain sine with a short fade at each end. Without the fade the waveform
 * starts and stops at full amplitude and the speaker clicks, which on a cheap
 * till speaker sounds like a fault rather than a chime.
 */
function tone({ frequency = 880, ms = 180, volume = 0.35, rate = 22050 } = {}) {
  const samples = Math.floor((rate * ms) / 1000);
  const data = Buffer.alloc(samples * 2);
  const fade = Math.min(Math.floor(samples / 8), 400);

  for (let i = 0; i < samples; i += 1) {
    let amplitude = volume;
    if (i < fade) amplitude *= i / fade;
    if (i > samples - fade) amplitude *= (samples - i) / fade;
    const value =
      Math.sin((2 * Math.PI * frequency * i) / rate) * amplitude * 0x7fff;
    data.writeInt16LE(
      Math.max(-0x8000, Math.min(0x7fff, Math.round(value))),
      i * 2,
    );
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/** Several tones end to end, so an alarm can be more than one note. */
function sequence(parts) {
  return Buffer.concat(parts.map(tone));
}

/* A rising two-note chime. Pleasant, brief, forgettable - which is the point
   for something that happens forty times an hour. */
const RECEIVED = () =>
  sequence([
    { frequency: 784, ms: 110 },
    { frequency: 1047, ms: 160 },
  ]);

/* Three insistent notes. Deliberately less pleasant, and deliberately longer,
   because this one has to carry across a room. */
const WAITING = () =>
  sequence([
    { frequency: 988, ms: 150, volume: 0.5 },
    { frequency: 740, ms: 150, volume: 0.5 },
    { frequency: 988, ms: 260, volume: 0.5 },
  ]);

function dataUri(buffer) {
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}

/**
 * Watches for orders and asks a window to make the noise.
 *
 * The main process cannot play audio itself - there is no audio device binding
 * in Electron's main process - so it hands a data URI to a renderer, which is
 * the only part of the app that can. That also means a shop with no window
 * open makes no sound, which is correct: there is nobody there to hear it.
 */
class OrderAlert {
  constructor({ getWindow } = {}) {
    this._getWindow = typeof getWindow === "function" ? getWindow : () => null;
    this._pending = new Set();
    this._repeatTimer = null;
    this._repeats = 0;
    this._onAttention = (payload) => this.handle(payload);

    try {
      process.on("posnic:order-attention", this._onAttention);
    } catch (e) {
      /* Never fatal: a shop with no sound still takes orders. */
    }
  }

  handle(payload = {}) {
    const alert = payload.alert === "waiting" ? "waiting" : "received";

    if (alert === "waiting" && payload.saleId) {
      this._pending.add(String(payload.saleId));
      this._startRepeating();
    }

    this._play(alert, payload);
  }

  /** Somebody dealt with it, so stop asking. */
  resolve(saleId) {
    this._pending.delete(String(saleId || ""));
    if (!this._pending.size) this._stopRepeating();
  }

  clear() {
    this._pending.clear();
    this._stopRepeating();
  }

  get pendingCount() {
    return this._pending.size;
  }

  _startRepeating() {
    if (this._repeatTimer) return;
    this._repeats = 0;
    this._repeatTimer = setInterval(() => {
      this._repeats += 1;
      /*
       * It gives up after five minutes. An alarm that never stops is one
       * somebody mutes at the speaker, and then it is gone for every future
       * order too - the queue badge is still there, and that is the part that
       * must not be silenceable.
       */
      if (!this._pending.size || this._repeats >= MAX_REPEATS) {
        this._stopRepeating();
        return;
      }
      this._play("waiting", { repeat: true });
    }, REPEAT_EVERY_MS);

    /* Do not hold the app open just to nag. */
    if (typeof this._repeatTimer.unref === "function")
      this._repeatTimer.unref();
  }

  _stopRepeating() {
    if (!this._repeatTimer) return;
    clearInterval(this._repeatTimer);
    this._repeatTimer = null;
    this._repeats = 0;
  }

  _play(alert, payload) {
    try {
      const win = this._getWindow();
      if (!win || win.isDestroyed()) return false;
      win.webContents.send("posnic:order-alert", {
        alert,
        sound: dataUri(alert === "waiting" ? WAITING() : RECEIVED()),
        pending: this._pending.size,
        saleId: payload && payload.saleId ? String(payload.saleId) : "",
      });
      return true;
    } catch (e) {
      /* A missing window, a closing app: quiet, never a crash. */
      return false;
    }
  }

  dispose() {
    this._stopRepeating();
    try {
      process.off("posnic:order-attention", this._onAttention);
    } catch (e) {
      /* nothing to do */
    }
  }
}

module.exports = {
  OrderAlert,
  tone,
  sequence,
  dataUri,
  REPEAT_EVERY_MS,
  MAX_REPEATS,
};
