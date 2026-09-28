'use strict';
const bridge = window.electronAPI.kitchenAudio;
let busy = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function play(task) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (
    task.target.id !== 'default' &&
    !devices.some((d) => d.kind === 'audiooutput' && d.deviceId === task.target.id)
  )
    throw Error('Speaker disconnected: ' + task.target.label);
  const src = task.step.audio || (await bridge.synthesize(task.step.text, task.step.voice || ''));
  if (await bridge.paused()) throw Error('PAUSED');
  const audio = new Audio(src);
  audio.volume = task.volume;
  if (typeof audio.setSinkId !== 'function')
    throw Error('Output selection is unavailable on this system.');
  await audio.setSinkId(task.target.id === 'default' ? '' : task.target.id);
  await new Promise((resolve, reject) => {
    let finished = false,
      timer,
      watch;
    const done = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(watch);
      audio.pause();
      audio.removeAttribute('src');
      error ? reject(error) : resolve();
    };
    audio.onended = () => done();
    audio.onerror = () => done(Error('Audio playback failed. Check speaker connection.'));
    timer = setTimeout(() => done(Error('Playback timed out; waiting to retry.')), 90000);
    let checking = false;
    watch = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        if (await bridge.paused()) return done(Error('PAUSED'));
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (
          task.target.id !== 'default' &&
          !devices.some((d) => d.kind === 'audiooutput' && d.deviceId === task.target.id)
        )
          done(Error('Speaker disconnected during playback.'));
      } catch (e) {
        done(e);
      } finally {
        checking = false;
      }
    }, 300);
    audio.play().catch(done);
  });
}
async function poll() {
  if (busy) return;
  busy = true;
  try {
    const task = await bridge.next();
    if (!task) return;
    try {
      await play(task);
      await bridge.ack({ jobId: task.jobId, targetId: task.target.id, index: task.index });
    } catch (e) {
      if (e.message !== 'PAUSED')
        await bridge.ack({
          jobId: task.jobId,
          targetId: task.target.id,
          index: task.index,
          error: e.message,
        });
    }
  } catch (e) {
    console.error('[kitchen-audio]', e.message);
  } finally {
    busy = false;
  }
}
setInterval(poll, 500);
