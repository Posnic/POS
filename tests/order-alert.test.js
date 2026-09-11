'use strict';

/*
 * The noise an online order makes.
 *
 * This is the one part of the product where nobody is standing in front of the
 * till when the event happens. Every other sale has a person ringing it up; an
 * online order arrives while the shop is looking at another page, or not
 * looking at all. So the sound is the feature, and these tests are about the
 * ways it could quietly stop working.
 */

const test = require('node:test');
const assert = require('node:assert');

const { OrderAlert, tone, sequence, dataUri, MAX_REPEATS } = require('../src/order-alert');

/** A window that records what it was asked to play. */
function fakeWindow() {
  const played = [];
  return {
    played,
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => played.push({ channel, ...payload }) },
  };
}

test('the tone is a real WAV a browser will accept', () => {
  const wav = tone({ frequency: 880, ms: 100 });
  assert.strictEqual(wav.slice(0, 4).toString(), 'RIFF');
  assert.strictEqual(wav.slice(8, 12).toString(), 'WAVE');
  /* The declared data length must match what follows the 44-byte header, or
     the browser plays silence and nobody finds out until an order is missed. */
  assert.strictEqual(wav.readUInt32LE(40), wav.length - 44);
});

test('the tone fades in and out, so the speaker does not click', () => {
  /*
   * Without the fade the waveform starts and ends at full amplitude and a
   * cheap till speaker pops, which sounds like a fault rather than a chime.
   *
   * Measured as PEAK amplitude over a window, not a single sample: a sine
   * begins at sin(0) = 0 whether it fades or not, so reading one sample
   * proves nothing and would pass on a tone with no fade at all.
   */
  const wav = tone({ frequency: 880, ms: 200, volume: 0.5 });
  const samples = (wav.length - 44) / 2;
  const peak = (from, to) => {
    let max = 0;
    for (let i = from; i < to; i += 1) max = Math.max(max, Math.abs(wav.readInt16LE(44 + i * 2)));
    return max;
  };

  const window = Math.floor(samples * 0.03);
  const opening = peak(0, window);
  const middle = peak(Math.floor(samples / 2) - window, Math.floor(samples / 2) + window);
  const closing = peak(samples - window, samples);

  assert.ok(opening < middle * 0.9, 'the tone no longer fades in');
  assert.ok(closing < middle * 0.9, 'the tone no longer fades out');
});

test('a sequence is several tones end to end', () => {
  const one = tone({ ms: 100 });
  const two = sequence([{ ms: 100 }, { ms: 100 }]);
  assert.ok(two.length > one.length, 'the sequence is not longer than a single tone');
});

test('it is a data URI, so nothing has to ship an audio file', () => {
  assert.match(dataUri(tone({ ms: 20 })), /^data:audio\/wav;base64,[A-Za-z0-9+/=]+$/);
});

test('the two alerts are different sounds', () => {
  /*
   * One sound for both would train staff to ignore the one that matters, which
   * is how alarms stop working. "Received" is information; "waiting" is a task
   * with a customer attached to it.
   */
  const win = fakeWindow();
  const alert = new OrderAlert({ getWindow: () => win });
  alert.handle({ alert: 'received', saleId: 'a' });
  alert.handle({ alert: 'waiting', saleId: 'b' });
  alert.dispose();

  assert.strictEqual(win.played.length, 2);
  assert.notStrictEqual(win.played[0].sound, win.played[1].sound);
  assert.strictEqual(win.played[0].alert, 'received');
  assert.strictEqual(win.played[1].alert, 'waiting');
});

test('only a held order joins the queue', () => {
  /* An auto-approved order is already printing. Counting it as pending would
     make the badge a lie and the alarm permanent. */
  const win = fakeWindow();
  const alert = new OrderAlert({ getWindow: () => win });
  alert.handle({ alert: 'received', saleId: 'a' });
  assert.strictEqual(alert.pendingCount, 0);
  alert.handle({ alert: 'waiting', saleId: 'b' });
  assert.strictEqual(alert.pendingCount, 1);
  alert.dispose();
});

test('the same order twice is one queue entry', () => {
  /* A retry, or a reconnect that replays an event, must not make the shop
     think two customers are waiting. */
  const alert = new OrderAlert({ getWindow: () => fakeWindow() });
  alert.handle({ alert: 'waiting', saleId: 'same' });
  alert.handle({ alert: 'waiting', saleId: 'same' });
  assert.strictEqual(alert.pendingCount, 1);
  alert.dispose();
});

test('answering the last one stops the nagging', () => {
  const alert = new OrderAlert({ getWindow: () => fakeWindow() });
  alert.handle({ alert: 'waiting', saleId: 'a' });
  alert.handle({ alert: 'waiting', saleId: 'b' });
  alert.resolve('a');
  assert.strictEqual(alert.pendingCount, 1);
  alert.resolve('b');
  assert.strictEqual(alert.pendingCount, 0);
  alert.dispose();
});

test('an unrecognised alert is the quieter sound', () => {
  /*
   * A newer API talking to an older desktop build must not accidentally set
   * off alarms for something it has never heard of.
   */
  const win = fakeWindow();
  const alert = new OrderAlert({ getWindow: () => win });
  alert.handle({ alert: 'something-new', saleId: 'x' });
  assert.strictEqual(win.played[0].alert, 'received');
  assert.strictEqual(alert.pendingCount, 0);
  alert.dispose();
});

test('no window, no crash', () => {
  /* A shop with nothing open makes no sound, which is correct - there is
     nobody there to hear it - and must never be an exception on the path of
     an order a customer has already placed. */
  const alert = new OrderAlert({ getWindow: () => null });
  assert.doesNotThrow(() => alert.handle({ alert: 'waiting', saleId: 'a' }));

  const destroyed = new OrderAlert({ getWindow: () => ({ isDestroyed: () => true }) });
  assert.doesNotThrow(() => destroyed.handle({ alert: 'waiting', saleId: 'a' }));

  alert.dispose();
  destroyed.dispose();
});

test('the alarm gives up rather than becoming background noise', () => {
  /*
   * An alarm that never stops is one somebody mutes at the speaker, and then
   * it is gone for every future order too. It stops after five minutes; the
   * queue badge stays, and that is the part that must not be silenceable.
   */
  assert.ok(MAX_REPEATS > 0 && MAX_REPEATS <= 30, 'the repeat limit stopped being a limit');
});

test('it listens on the process bus the API emits on', () => {
  /*
   * The API ships outside the ASAR archive while this lives inside it, so the
   * two halves cannot require the same module instance - a shared emitter file
   * would silently become two emitters and the event would go nowhere. Both
   * halves have `process`, which is why that is the bus.
   */
  const win = fakeWindow();
  const alert = new OrderAlert({ getWindow: () => win });
  process.emit('posnic:order-attention', { alert: 'waiting', saleId: 'via-bus' });
  assert.strictEqual(win.played.length, 1, 'the event did not arrive over the process bus');
  assert.strictEqual(alert.pendingCount, 1);
  alert.dispose();

  /* And it lets go when disposed, or every reload leaves another listener
     behind and one order plays five sounds. */
  process.emit('posnic:order-attention', { alert: 'waiting', saleId: 'after-dispose' });
  assert.strictEqual(win.played.length, 1, 'the listener outlived dispose()');
});
