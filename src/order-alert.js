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

  return Buffer.concat([wavHeader(data.length, rate), data]);
}

/** The 44 bytes an <audio> element needs in front of raw PCM. */
function wavHeader(bytes, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
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
  header.writeUInt32LE(bytes, 40);
  return header;
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
 * A NOTE THAT SOUNDS STRUCK, RATHER THAN A BEEP.
 *
 * Owner, on the tone this replaces: "beep sound is not good. i want like new
 * order came. make it good. not beep."
 *
 * He was right, and the reason is in `tone()` above: a plain sine contains
 * nothing but its fundamental, and a bare fundamental is the definition of a
 * beep. Two things make a struck object sound struck, and that tone has
 * neither of them.
 *
 * PARTIALS. A real bar or bell rings at several frequencies at once, well
 * above the note you think you are hearing, and those are what the ear reads
 * as wood or as metal. Each is [multiple of the fundamental, how loud, how
 * fast it dies].
 *
 * AN ENVELOPE THAT DECAYS. A struck thing is loudest the instant it is hit and
 * fades from there. The old tone held full volume throughout and faded at both
 * ends, which is a tone being switched on and off: an appliance, not an
 * instrument.
 *
 * The 3ms attack is not decoration. A waveform that starts at full height
 * clicks, and on a cheap till speaker a click sounds like a fault.
 */
function struck({ notes = [], rate = 22050, volume = 0.85 } = {}) {
  const span = notes.reduce((m, n) => Math.max(m, n.atMs + n.ms), 0);
  const count = Math.ceil((rate * span) / 1000);
  const mixed = new Float64Array(count);

  for (const note of notes) {
    const from = Math.floor((note.atMs / 1000) * rate);
    const len = Math.floor((note.ms / 1000) * rate);
    for (let i = 0; i < len; i += 1) {
      const t = i / rate;
      let value = 0;
      for (const [multiple, amp, decay] of note.partials) {
        value +=
          amp * Math.sin(2 * Math.PI * note.frequency * multiple * t) * Math.exp(-decay * t);
      }
      const at = from + i;
      if (at < count) mixed[at] += value * Math.min(1, t / 0.003);
    }
  }

  /* Normalised rather than trusted. Partials add up and overlapping notes add
     up further; past 1.0 the waveform clips, and clipping is the one thing
     that genuinely does sound cheap. */
  let peak = 0;
  for (const s of mixed) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? volume / peak : 1;

  const data = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i += 1) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixed[i] * gain)) * 0x7fff), i * 2);
  }

  return Buffer.concat([wavHeader(data.length, rate), data]);
}

/* A wooden bar. Its partials sit far above the note and die almost at once,
   which is what separates wood from metal by ear. */
const MARIMBA = [
  [1, 1.0, 6],
  [4, 0.26, 20],
  [10, 0.08, 34],
];

/* A real bell rings at frequencies that are not whole multiples of its note.
   That inharmonicity IS the character: make these 2, 3, 4 and it stops being
   a bell and becomes an organ. */
const BELL_METAL = [
  [1, 1.0, 2.2],
  [2.76, 0.5, 3.2],
  [5.4, 0.22, 5],
  [8.93, 0.1, 7],
];

/*
 * THE BELL WHEN AN ORDER ARRIVES, and the two others a shop can pick instead.
 *
 * Owner: "how about user picks the bell sound as choice how you gave me."
 *
 * Which is right, and not only as a preference. A kitchen with a fryer roaring
 * needs something different from a quiet dining room, and neither of them is a
 * decision that should be made once in this file for every shop. These are the
 * three that were played to him on a real speaker; the shop picks.
 *
 * Heard once per ticket, so it can afford to be the largest sound the app
 * makes. Deliberately unlike the counter's chime and the waiting alarm: a cook
 * must never have to work out whether that was their ticket or the counter's.
 *
 * It ends before the speech starts. A speaker still ringing while it talks
 * loses the first two words, and the first two words are the table number.
 */
const ARRIVAL_BELLS = {
  /* A rise reads as "something arrived" in a way a falling or level figure
     does not. The owner's own pick, and so the default. */
  rising: () =>
    struck({
      notes: [
        { frequency: 523, atMs: 0, ms: 700, partials: MARIMBA },
        { frequency: 659, atMs: 110, ms: 700, partials: MARIMBA },
        { frequency: 784, atMs: 220, ms: 900, partials: MARIMBA },
      ],
    }),
  /* Two notes, warmer and shorter. For a room where three is too much. */
  marimba: () =>
    struck({
      notes: [
        { frequency: 784, atMs: 0, ms: 900, partials: MARIMBA },
        { frequency: 1047, atMs: 150, ms: 1000, partials: MARIMBA },
      ],
    }),
  /* One strike with a long shimmer: a counter bell. Carries furthest, which
     is what a loud kitchen needs. */
  bell: () =>
    struck({
      notes: [{ frequency: 880, atMs: 0, ms: 1800, partials: BELL_METAL }],
    }),
};

/*
 * THE BELL BEFORE EACH DISH.
 *
 * Owner: "I want one bell for each line item before read it."
 *
 * None of these can be the arrival bell. That one is heard once and has to
 * announce something; this is heard three or six times in a row and only has
 * to say "here comes the next one". The arrival bell repeated six times is a
 * fire drill, so all three are shorter, lower and quieter than any arrival
 * bell, and all are in the same wooden family: a kitchen should hear the two
 * as one voice with a loud opening and a quiet punctuation, not as two
 * unrelated noises competing.
 */
const ITEM_BELLS = {
  /* The owner's pick, and the default. A fifth below the arrival bell. */
  soft: () =>
    struck({
      notes: [{ frequency: 523, atMs: 0, ms: 550, partials: MARIMBA }],
      volume: 0.5,
    }),
  /* Driest and quickest out of the way, which matters most on a long ticket. */
  tick: () =>
    struck({
      notes: [
        {
          frequency: 1047,
          atMs: 0,
          ms: 300,
          partials: [
            [1, 1.0, 22],
            [3, 0.3, 40],
          ],
        },
      ],
      volume: 0.45,
    }),
  /* The arrival bell in miniature, for a kitchen that wants a clearer cue. */
  tap: () =>
    struck({
      notes: [
        { frequency: 523, atMs: 0, ms: 400, partials: MARIMBA },
        { frequency: 659, atMs: 90, ms: 500, partials: MARIMBA },
      ],
      volume: 0.5,
    }),
};

const ARRIVAL_DEFAULT = 'rising';
const ITEM_DEFAULT = 'soft';

/** The arrival bell a shop chose, or the one it gets if it never chose. */
const TING = (which) => (ARRIVAL_BELLS[which] || ARRIVAL_BELLS[ARRIVAL_DEFAULT])();

/** The tap before a dish, likewise. */
const ITEM_BELL = (which) => (ITEM_BELLS[which] || ITEM_BELLS[ITEM_DEFAULT])();

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
  constructor({ getWindow, onAccepted } = {}) {
    this._getWindow = typeof getWindow === "function" ? getWindow : () => null;
    this._onAccepted = typeof onAccepted === "function" ? onAccepted : () => {};
    this._spoken = new Set();
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
    const spokenKey = payload.eventKey ? `${payload.saleId}:${payload.eventKey}` : String(payload.saleId);
    if (alert === 'received' && payload.saleId && payload.ticket && !this._spoken.has(spokenKey)) {
      try {
        if (this._onAccepted(payload)) {
          this._spoken.add(spokenKey);
          if (this._spoken.size > 1000) this._spoken.delete(this._spoken.values().next().value);
        }
      } catch (e) { /* A speaker failure must not interrupt order handling. */ }
    }
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

  const parts = speak ? kitchenCall.script(ticket) : { head: [], items: [] };
  const said = parts.head.concat(parts.items);
  if (!said.length && !ting) return false;

  try {
    const win = typeof getWindow === "function" ? getWindow() : null;
    if (!win || win.isDestroyed()) return false;

    win.webContents.send("posnic:kitchen-call", {
      sound: ting ? dataUri(TING(wants && wants.arrivalBell)) : "",
      /*
       * A SECOND, SMALLER BELL, AND WHERE IT GOES.
       *
       * Owner: "First bell is we got new order. I want one bell for each line
       * item before read it."
       *
       * `head` is how many of these lines come before the food - the opening
       * and the plate count. Everything after it is a dish and gets a tap in
       * front of it. Sent as a number rather than left to the page to work out
       * by counting sentences, because the page would be guessing and the
       * guess would break the first time the wording changed.
       */
      itemSound: ting ? dataUri(ITEM_BELL(wants && wants.itemBell)) : "",
      head: parts.head.length,
      /*
       * WHOSE VOICE, by name.
       *
       * Owner: "different countries might need different voice and accent."
       *
       * An empty name means "the best one on this machine", which is what a
       * shop that never chose gets, and also what a shop gets on a machine
       * that does not have the voice it picked. It falls back rather than
       * going silent, and that is the whole reason this travels as a name.
       */
      voice: (wants && wants.voice) || "",
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

/**
 * THE WINDOW THAT CAN ACTUALLY MAKE THE NOISE.
 *
 * The announcement was sent to `getAllWindows().find(w => !w.isDestroyed())` -
 * the FIRST window, whatever it happens to be. On the machine where this
 * feature runs that is a gamble: a kitchen machine may have the kitchen
 * display open, and a support, log or hardware window can be in front of the
 * dashboard at any moment.
 *
 * Only the dashboard carries the player. `src/kitchen-screen.html` has one
 * inline script and no `kitchenCall` in it at all, so a ticket announced into
 * that window is announced into nothing - silently, with no error, which is
 * the exact failure this feature kept having.
 *
 * So the window is chosen by what it is showing rather than by where it sits
 * in a list. The alarm beside this already had it right: main.js hands
 * OrderAlert `() => mainWindow`.
 *
 * Falls back to any open window rather than to none. Before anybody signs in
 * the only window is the sign-in screen, which has no player either - but a
 * shop with nobody signed in has nobody in the kitchen either, and silence
 * then is correct rather than a fault.
 */
function speakingWindow(BrowserWindow) {
  const open = (BrowserWindow.getAllWindows() || []).filter((w) => w && !w.isDestroyed());

  const dashboard = open.find((w) => {
    try {
      return /dashboard\.html/i.test(w.webContents.getURL());
    } catch (e) {
      /* A window still loading has no URL yet. It is not the one we want. */
      return false;
    }
  });

  return dashboard || open[0] || null;
}

/*
 * What a settings page can offer, and how to hear one.
 *
 * The names are the stored value, so this list and the setting cannot drift
 * apart: a bell that is not here cannot be chosen, and one that is chosen is
 * always here.
 */
const bellChoices = () => ({
  arrival: Object.keys(ARRIVAL_BELLS),
  item: Object.keys(ITEM_BELLS),
});

/** One bell as something an <audio> element can play, for a Play button. */
const bellSound = (kind, which) =>
  dataUri(kind === "item" ? ITEM_BELL(which) : TING(which));

module.exports = {
  announceKitchenTicket,
  speakingWindow,
  TING,
  ITEM_BELL,
  bellChoices,
  bellSound,
  struck,
  OrderAlert,
  tone,
  sequence,
  dataUri,
  TICK_MS,
};
