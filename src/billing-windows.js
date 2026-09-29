'use strict';
const path = require('path');
// Register with the guarded IPC object. Reopening an outlet restores its window,
// preserving the renderer/cart instead of loading another copy of the page.
function register({ ipcMain, BrowserWindow }) {
  const windows = new Map();
  ipcMain.handle('billing:open-outlet', async (event, input) => {
    if (!input || !/^[a-f\d]{24}$/.test(input.branchId) || !/^[a-f\d]{24}$/.test(input.outletId)) throw new Error('Invalid billing window.');
    const url = new URL(event.senderFrame.url);
    if (!['http:', 'https:'].includes(url.protocol) || !/(?:^|\/)\w*dashboard\.html$/.test(url.pathname)) throw new Error('Open outlets from the billing dashboard.');
    const key = url.origin + ':' + input.branchId + ':' + input.outletId;
    const current = windows.get(key);
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore();
      current.show(); current.focus(); return { opened: true };
    }
    if (windows.size >= 24) throw new Error('Close an unused billing window first.');
    const title = String(input.name || 'Billing').replace(/[\r\n]/g, ' ').slice(0, 100) + ' — Posnic';
    const win = new BrowserWindow({ title, width: 1280, height: 850, autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    windows.set(key, win);
    win.on('closed', () => { if (windows.get(key) === win) windows.delete(key); });
    win.on('page-title-updated', event => { event.preventDefault(); win.setTitle(title); });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      const destination = new URL(target);
      if (destination.origin === url.origin && /pdf/i.test(destination.pathname)) win.webContents.downloadURL(target);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== url.origin) event.preventDefault();
    });
    url.search = ''; url.searchParams.set('billing_window', input.outletId); url.searchParams.set('billing_branch', input.branchId); url.hash = '/sales/new';
    try { await win.loadURL(url.href); win.show(); win.focus(); }
    catch (error) { if (!win.isDestroyed()) win.destroy(); throw error; }
    return { opened: true };
  });
}
module.exports = { register };
