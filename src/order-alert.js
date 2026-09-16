"use strict";

const kitchenCall = require("./kitchen-call");
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

/*
 * How often the policy is CONSULTED - not how often a noise is made.
 *
 * The old constants were REPEAT_EVERY_MS = 20000 and MAX_REPEATS = 15: twenty
 * seconds, fifteen times, then silence with the order still unanswered. The
 * pacing now lives in waiting-order-policy.js, which backs off instead of
 * stopping, so this only has to be as fast as the shortest step.
 */
const TICK_MS = 10 * 1000;
const policy = require('./waiting-order-policy');

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

/*
 * THE TING A KITCHEN HEARS.
 *
 * One rising pair, short and bright, and louder than the counter's chime
 * because it has to cross a room with extraction fans running. Deliberately
 * not either of the other two: a cook must never have to work out whether that
 * was their ticket or the counter's online order.
 *
 * It ends before the speech starts. A speaker still ringing while it talks
 * loses the first two words, and the first two words are the table number.
 */
const TING = () =>
  sequence([
    { frequency: 1568, ms: 90, volume: 0.6 },
    { frequency: 2093, ms: 150, volume: 0.6 },
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
    /*
     * A MAP, not a set: escalation needs to know how long each order has been
     * waiting and when it was last mentioned. A set could only say "something
     * is pending", which is all the flat 20s x 15 ever needed.
     */
    this._pending = new Map();
    this._repeatTimer = null;
    this._policy = { onSilence: 'nothing', decideAfterMinutes: 0 };
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
      const id = String(payload.saleId);
      if (!this._pending.has(id)) {
        this._pending.set(id, {
          arrivedAt: Date.now(),
          lastAlertAt: Date.now(),
          acknowledged: false,
          source: payload.source || '',
        });
      }
      this._startRepeating();
    }

    this._play(alert, payload);
  }

  /** Somebody dealt with it, so stop asking. */
  resolve(saleId) {
    this._pending.delete(String(saleId || ""));
    if (!this._pending.size) this._stopRepeating();
  }

  /*
   * "I HAVE SEEN THIS" - which is not "I have accepted it".
   *
   * A shop mid-rush needs to stop the noise without deciding the order. The
   * order stays pending and the shop's declared default still fires on time,
   * or acknowledging would become a way to park an order for ever.
   */
  acknowledge(saleId, by = '') {
    const row = this._pending.get(String(saleId || ''));
    if (!row) return false;
    row.acknowledged = true;
    row.acknowledgedBy = String(by || '').slice(0, 60);
    row.acknowledgedAt = Date.now();
    return true;
  }

  /** What this shop asked to happen when nobody answers. */
  setPolicy(policy = {}) {
    this._policy = { ...this._policy, ...policy };
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
    /*
     * ONE SLOW TICK, and the policy decides what happens on it.
     *
     * This used to be a 20 second interval that stopped after fifteen turns -
     * five minutes of asking and then silence, with the order still unanswered
     * and the customer still waiting. Backing off is done by the policy now, so
     * the timer only has to be fast enough for the SHORTEST step.
     */
    this._repeatTimer = setInterval(() => this._tick(), TICK_MS);
    if (typeof this._repeatTimer.unref === "function") this._repeatTimer.unref();
  }

  /**
   * Ask the policy about every waiting order, and act on what it says.
   *
   * Nothing here decides anything: waiting-order-policy.js does, and it is pure
   * so the deciding can be tested without a clock.
   */
  _tick() {
    if (!this._pending.size) {
      this._stopRepeating();
      return;
    }

    const now = Date.now();
    for (const [saleId, row] of this._pending) {
      let verdict;
      try {
        verdict = policy.decide(
          {
            waitingMs: now - row.arrivedAt,
            lastAlertedMs: now - row.lastAlertAt,
            acknowledged: row.acknowledged,
            source: row.source,
          },
          this._policy
        );
      } catch (e) {
        /* A policy fault must not silence an alarm. Fall back to speaking. */
        verdict = { alert: !row.acknowledged, reach: 'till', decide: 'nothing' };
      }

      if (verdict.alert) {
        row.lastAlertAt = now;
        this._play("waiting", { repeat: true, saleId, reach: verdict.reach });
      }

      /*
       * AND IT DOES NOT DECIDE ANYTHING.
       *
       * This used to emit `posnic:order-decided` on the process bus and then
       * delete the order from the pending map. NOTHING LISTENED to that event.
       * So the alarm went quiet - which reads as "somebody dealt with it" -
       * with the order still sitting there unanswered and the customer still
       * waiting. That is the exact failure this whole area exists to prevent,
       * and it was built in.
       *
       * The rule now fires in the API, where the order lives and where a shop
       * with no till at all is also served: see
       * api/src/services/unanswered-orders.js. It announces the result, and
       * `resolve()` is what stops the noise - after something has actually
       * happened, never before.
       *
       * `verdict.decide` is deliberately read by nobody here. The policy is
       * one module answering two questions, and this half only ever asks the
       * first: what noise to make, and how far it should travel.
       */
    }
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

/**
 * Say a ticket out loud in the kitchen.
 *
 * The main process cannot speak any more than it can play a sound, so both the
 * tone and the words go to a window - the only part of the app with an audio
 * device and a speech engine.
 *
 * Quiet when there is nothing worth saying and quiet when no window is open,
 * which is correct: there is nobody there to hear it.
 */
function announceKitchenTicket(getWindow, ticket, wants) {
  /*
   * Two switches, honoured HERE rather than in the page.
   *
   * A machine set to chime only is sent no words at all: nothing to ignore,
   * nothing to go wrong in a speech engine, and nothing in the payload that
   * could be spoken by a later change nobody thought about.
   */
  const ting = !wants || wants.ting !== false;
  const speak = !wants || wants.speak !== false;
  if (!ting && !speak) return false;

  const said = speak ? kitchenCall.lines(ticket) : [];
  if (!said.length && !ting) return false;

  try {
    const win = typeof getWindow === "function" ? getWindow() : null;
    if (!win || win.isDestroyed()) return false;

    win.webContents.send("posnic:kitchen-call", {
      sound: ting ? dataUri(TING()) : "",
      /* One line at a time: the page speaks each as its own utterance, and a
         speech engine leaves a real gap between them. `say` is the same words
         joined, for anything that cannot queue. */
      lines: said,
      say: said.join(" "),
      table: ticket && ticket.table ? String(ticket.table) : "",
    });
    return true;
  } catch (e) {
    /* A closing window, a machine asleep: quiet, never a crash. A kitchen that
       missed one ticket is a worse evening; a till that fell over is a worse
       week. */
    return false;
  }
}

module.exports = {
  announceKitchenTicket,
  TING,
  OrderAlert,
  tone,
  sequence,
  dataUri,
  TICK_MS,
};
