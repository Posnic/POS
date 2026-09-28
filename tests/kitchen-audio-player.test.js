'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  vm = require('node:vm'),
  fs = require('node:fs'),
  path = require('node:path');
function player({ present = true, paused = false, fail = false } = {}) {
  const calls = [],
    timers = [];
  let audio;
  const task = {
    jobId: 'one',
    target: { id: 'speaker', label: 'Kitchen' },
    index: 0,
    step: { audio: 'data:audio/wav;base64,AA==' },
    volume: 1,
  };
  class Audio {
    constructor() {
      audio = this;
    }
    async setSinkId(id) {
      calls.push(['sink', id]);
    }
    async play() {
      calls.push(['play']);
      if (fail) throw Error('device unavailable');
    }
    pause() {}
    removeAttribute() {}
  }
  const bridge = {
    next: async () => task,
    paused: async () => paused,
    ack: async (value) => calls.push(['ack', value]),
  };
  const context = {
    window: { electronAPI: { kitchenAudio: bridge } },
    navigator: {
      mediaDevices: {
        enumerateDevices: async () =>
          present ? [{ kind: 'audiooutput', deviceId: 'speaker' }] : [],
      },
    },
    Audio,
    setInterval: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval() {},
    setTimeout() {},
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/kitchen-audio-player.js'), 'utf8'),
    context,
  );
  return {
    calls,
    timers,
    get audio() {
      return audio;
    },
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test('accepting play() is not completion; only ended acknowledges the selected output', async () => {
  const p = player();
  const pending = p.timers[0]();
  await tick();
  assert.deepEqual(p.calls, [['sink', 'speaker'], ['play']]);
  p.audio.onended();
  await pending;
  assert.equal(p.calls[2][0], 'ack');
  assert.equal(p.calls[2][1].error, undefined);
});
test('missing device fails without playing on the default speaker', async () => {
  const p = player({ present: false });
  await p.timers[0]();
  assert.equal(p.calls.length, 1);
  assert.match(p.calls[0][1].error, /disconnected/);
});
test('recording pauses without acknowledging or losing the current step', async () => {
  const p = player({ paused: true });
  await p.timers[0]();
  assert.equal(p.calls.length, 0);
});
test('playback rejection leaves a retriable error', async () => {
  const p = player({ fail: true });
  await p.timers[0]();
  assert.match(p.calls.at(-1)[1].error, /unavailable/);
});

test('overlapping poll ticks cannot start a second audio while the first is playing',async()=>{
  const p=player();const first=p.timers[0]();await tick();
  await Promise.all([p.timers[0](),p.timers[0](),p.timers[0]()]);
  assert.equal(p.calls.filter(c=>c[0]==='play').length,1);
  p.audio.onended();await first;
  assert.equal(p.calls.filter(c=>c[0]==='ack').length,1);
});
