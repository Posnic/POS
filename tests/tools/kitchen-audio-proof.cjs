'use strict';
// Runs the shipped player against a muted real device; no shop data or audible message.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-audio-proof-'));
app.setPath('userData', dir);
let task,
  complete = false;
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(root, 'src/preload.js'),
        contextIsolation: true,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false,
      },
    });
    win.webContents.session.setPermissionCheckHandler((_w, p) => p === 'speaker-selection');
    win.webContents.session.setPermissionRequestHandler((_w, p, cb) =>
      cb(p === 'speaker-selection'),
    );
    ipcMain.handle('kitchen-audio:next', () => task || null);
    ipcMain.handle('kitchen-audio:paused', () => false);
    ipcMain.handle('kitchen-audio:ack', (_e, result) => {
      if (result.error) throw Error(result.error);
      complete = true;
      task = null;
      console.log('PASS: real Electron media ended on selected output (muted).');
      app.quit();
    });
    await win.loadFile(path.join(root, 'src/kitchen-audio.html'));
    const outputs = await win.webContents.executeJavaScript(
      "navigator.mediaDevices.enumerateDevices().then(ds=>ds.filter(d=>d.kind==='audiooutput').map(d=>({id:d.deviceId,label:d.label})))",
    );
    const output = outputs.find((d) => d.id !== 'default' && d.id !== 'communications');
    if (!output) throw Error('No named audio output was exposed.');
    console.log(
      'Named audio outputs available:',
      outputs.filter((d) => !['default', 'communications'].includes(d.id)).length,
    );
    task = {
      jobId: 'proof',
      target: output,
      index: 0,
      volume: 0,
      step: { audio: require('../../src/order-alert').bellSound('arrival', 'rising') },
    };
    setTimeout(() => {
      if (!complete) {
        console.error('FAIL: player did not complete');
        app.exit(1);
      }
    }, 15000).unref();
  })
  .catch((e) => {
    console.error(e.message);
    app.exit(1);
  });
app.on('will-quit', () => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
