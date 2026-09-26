'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/static/script/js/core/kitchen-call.js'), 'utf8');

async function settle() {
  for (let i = 0; i < 80; i++) await Promise.resolve();
}

// Drive real renderer code with manually completed audio and speech. Starting
// either while the other is active fails immediately, including item bells.
function speaker() {
  let receive, speech = null, sound = null, timerId = 0, cancellations = 0;
  const timers = new Map();
  const events = [];
  const engine = {
    speaking: false, pending: false, paused: false,
    getVoices: () => [],
    cancel() { cancellations++; },
    speak(line) {
      assert.equal(speech, null, 'speech overlapped speech');
      assert.equal(sound, null, 'speech overlapped a bell');
      speech = line;
      engine.speaking = true;
      events.push(['say', line.text]);
    },
  };
  class Audio {
    play() {
      assert.equal(sound, null, 'bells overlapped');
      assert.equal(speech, null, 'a bell interrupted speech');
      sound = this;
      events.push(['bell', this.src]);
      return Promise.resolve();
    }
    pause() { if (sound === this) sound = null; }
  }
  const window = {
    electronAPI: { kitchenCall: { on(handler) { receive = handler; } } },
    speechSynthesis: engine,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, { window, Audio });
  return {
    send: payload => receive(payload), events, engine, timers,
    get speech() { return speech; },
    get sound() { return sound; },
    get cancellations() { return cancellations; },
    async end(error = false) {
      if (sound) {
        const clip = sound;
        sound = null;
        (error ? clip.onerror : clip.onended)();
      } else if (speech) {
        const line = speech;
        speech = null;
        engine.speaking = false;
        (error ? line.onerror : line.onend)();
      } else assert.fail('nothing is playing');
      await settle();
    },
    async loseSpeechEnd() { speech = null; engine.speaking = false; },
    async tick(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id);
        timer.fn();
      }
      await settle();
    },
    async drain() {
      await settle();
      let count = 0;
      while (sound || speech) {
        assert.ok(++count < 500, 'queue never drained');
        await this.end();
      }
    },
  };
}

function ticket(name, count = 1) {
  return {
    sound: name + '-arrival', itemSound: name + '-item', head: 1,
    lines: [name, ...Array.from({ length: count }, (_, i) => name + ' item ' + (i + 1))],
  };
}

function expected(payload) {
  return [['bell', payload.sound], ...payload.lines.flatMap((line, i) =>
    [...(i >= payload.head ? [['bell', payload.itemSound]] : []), ['say', line]])];
}

test('all ten items finish before newer orders and cancellations, in arrival order', async () => {
  const player = speaker();
  const first = ticket('Table1 new order', 10);
  const second = ticket('Table2 new order', 2);
  const cancelled = ticket('Table1 items cancelled', 3);
  const third = ticket('Table3 new order');
  player.send(first);
  await settle();
  await player.end(); // arrival bell
  await player.end(); // table heading
  await player.end(); // first item bell
  assert.equal(player.speech.text, first.lines[1]);
  player.send(second);
  player.send(cancelled);
  player.send(third);
  await settle();
  assert.equal(player.speech.text, first.lines[1], 'new arrivals replaced the current item');
  assert.equal(player.cancellations, 0);
  await player.drain();
  assert.deepEqual(player.events, [first, second, cancelled, third].flatMap(expected));
  assert.equal(player.timers.size, 0);
});

test('a burst arriving during the bell loses no tickets or item bells', async () => {
  const player = speaker();
  const tickets = Array.from({ length: 20 }, (_, i) => ticket('Order ' + i));
  player.send(tickets[0]);
  await settle();
  tickets.slice(1).forEach(player.send);
  await player.drain();
  assert.deepEqual(player.events, tickets.flatMap(expected));
  assert.equal(player.cancellations, 0);
});

test('long speech is not released by the nine-second watchdog', async () => {
  const player = speaker();
  player.send({ lines: ['A long item description', 'Next item'] });
  player.send({ say: 'Cancellation after the order' });
  await settle();
  for (const delay of [9000, 1000, 1000, 1000]) await player.tick(delay);
  assert.deepEqual(player.events, [['say', 'A long item description']]);
  await player.drain();
  assert.deepEqual(player.events.map(event => event[1]), ['A long item description', 'Next item', 'Cancellation after the order']);
});

test('missing completion recovers only when idle and late callbacks cannot advance another item', async () => {
  const player = speaker();
  player.send({ lines: ['First', 'Second', 'Third'] });
  await settle();
  const lateEnd = player.speech.onend;
  player.engine.pending = true;
  await player.loseSpeechEnd();
  await player.tick(9000);
  assert.equal(player.events.length, 1);
  player.engine.pending = false;
  await player.tick(1000);
  assert.equal(player.speech.text, 'Second');
  lateEnd();
  await settle();
  assert.equal(player.speech.text, 'Second');
  await player.drain();
  assert.deepEqual(player.events.map(event => event[1]), ['First', 'Second', 'Third']);
});

test('bell timeout stops playback before speech and audio errors do not block following tickets', async () => {
  const player = speaker();
  player.send(ticket('First'));
  player.send(ticket('Second'));
  await settle();
  await player.tick(1800);
  assert.equal(player.sound, null);
  assert.equal(player.speech.text, 'First');
  await player.end(true); // speech error
  await player.end(true); // item bell error
  await player.drain();
  assert.deepEqual(player.events, [ticket('First'), ticket('Second')].flatMap(expected));
});

test('queued payloads are snapshots and chime-only tickets keep their position', async () => {
  const player = speaker();
  player.send({ say: 'Reading' });
  await settle();
  player.send({ sound: 'Chime only' });
  const next = ticket('Next');
  player.send(next);
  next.lines[1] = 'Mutated'; next.sound = 'Wrong bell';
  await player.drain();
  assert.deepEqual(player.events, [['say', 'Reading'], ['bell', 'Chime only'], ...expected(ticket('Next'))]);
});
