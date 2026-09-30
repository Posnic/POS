'use strict';
const path = require('node:path');
const settings = require('./kitchen-announce');
const { KitchenAudioQueue } = require('./kitchen-audio-queue');
let queue, windowRef, lastError = '';
function enabled() {
  return !!queue && settings.settings().outputs.length > 0;
}
function enqueue(steps, kind = 'order') {
  if (!enabled()) throw Error('Choose kitchen audio outputs first.');
  try { return queue.enqueue({ steps, kind }); }
  catch (error) {
    lastError = 'An announcement could not be queued: ' + error.message;
    console.error('[kitchen-audio]', lastError);
    throw error;
  }
}
function install({ app, BrowserWindow, ipcMain }) {
  let startupError;
  try {
    queue = new KitchenAudioQueue(
      path.join(app.getPath('userData'), 'kitchen-audio-queue.json'),
      () => settings.settings(),
    );
  } catch (e) {
    startupError = e.message;
    console.error('[kitchen-audio]', e.message);
    queue = new Proxy(
      {},
      {
        get: () => () => {
          throw Error(startupError);
        },
      },
    );
  }
  const create = () => {
    windowRef = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    windowRef.webContents.on('render-process-gone', () => {
      if (windowRef) windowRef.destroy();
    });
    windowRef.on('closed', () => {
      windowRef = null;
    });
    windowRef
      .loadFile(path.join(__dirname, 'kitchen-audio.html'))
      .catch((e) => console.error('[kitchen-audio]', e.message));
  };
  const worker = (event) => {
    if (!windowRef || event.sender !== windowRef.webContents) throw Error('Audio worker only.');
  };
  ipcMain.handle('kitchen-audio:next', (e) => {
    worker(e);
    return queue.next();
  });
  ipcMain.handle('kitchen-audio:ack', (e, value) => {
    worker(e);
    return queue.ack(value);
  });
  ipcMain.handle('kitchen-audio:paused', (e) => {
    worker(e);
    return queue.paused();
  });
  ipcMain.handle('kitchen-audio:synthesize', (e, text, voice) => {
    worker(e);
    return require('./kitchen-audio-tts').synthesize(text, voice);
  });
  ipcMain.handle('kitchen-audio:status', () =>
    startupError ? { error: startupError, jobs: [] } : {...queue.status(), error:lastError},
  );
  ipcMain.handle('kitchen-audio:voices', () => require('./kitchen-audio-tts').voices());
  ipcMain.handle('kitchen-audio:preview', (_e, kind, which) =>
    queue.enqueue({
      steps:
        kind === 'voice'
          ? [{ text: 'Table 5, new order. One Chicken Biryani.', voice: String(which || '') }]
          : [{ audio: require('./order-alert').bellSound(kind, which) }],
      kind: 'test',
    }),
  );
  ipcMain.handle('kitchen-audio:start', (e) => queue.start('desktop:' + e.sender.id));
  ipcMain.handle('kitchen-audio:cancel', (e, id) => queue.cancel('desktop:' + e.sender.id, id));
  ipcMain.handle('kitchen-audio:voice', (e, id, data) =>
    queue.voice('desktop:' + e.sender.id, id, data),
  );
  ipcMain.handle('kitchen-audio:test', (_e, id) =>
    queue.enqueue({
      steps: [{ audio: require('./order-alert').bellSound('arrival', 'rising') }],
      kind: 'test',
      outputIds: [id],
    }),
  );
  process.on('posnic:kitchen-audio', async (request, done) => {
    try {
      const config = settings.settings();
      if (!config.talkEnabled) throw Error('Kitchen talk is disabled on the POS.');
      let branch = config.branchId;
      if (!branch) {
        const branches = await require('./hardware-ipc').readLocalBranches();
        if (branches.length === 1) branch = branches[0].id;
      }
      if (!branch || String(branch) !== String(request.branchId))
        throw Error('This kitchen speaker is not configured for your branch.');
      const owner = 'captain:' + request.owner;
      if (request.action === 'status') return done(null, queue.status(owner));
      if (request.action === 'start') return done(null, queue.start(owner));
      if (request.action === 'cancel') {
        queue.cancel(owner, request.id);
        return done(null, { cancelled: true });
      }
      if (request.action === 'validateVoice')
        return done(null, queue.validateVoice(owner, request.id, request.data));
      if (request.action === 'voice')
        return done(null, queue.voice(owner, request.id, request.data));
      throw Error('Unknown kitchen audio action.');
    } catch (e) {
      done(e);
    }
  });
  if (!startupError) create();
  const timer = setInterval(() => {
    if (!startupError && !windowRef && !app.isQuitting) create();
  }, 10000);
  timer.unref();
  app.on('before-quit', () => {
    clearInterval(timer);
    if (windowRef) windowRef.destroy();
  });
}
module.exports = { install, enabled, enqueue };
