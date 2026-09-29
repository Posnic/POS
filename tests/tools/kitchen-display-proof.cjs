const {app, BrowserWindow, ipcMain, screen} = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.argv[2] || path.resolve(__dirname, '../..');
const timeout = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
 const prefs = require(path.join(root,'src/device-preferences'));
 const target = screen.getAllDisplays().find(d => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
 prefs.all = () => ({kitchenScreens:{[target.id]:{enabled:true}}});
 const screens = require(path.join(root,'src/kitchen-screen'));
 // Briefly open a test board; no shop data, printer or server is accessed.
 // Use the native inactive show path for the fullscreen bounds test.
 require(path.join(root,'src/ipc-guard')).guard(ipcMain).handle('kitchen-screen:ready', (_,id) => {
  screens.push(id);return {ok:true};
 });
 try {
  assert.equal(screens.open(target.id),true);
  const win = screens._windows.get(String(target.id));
  const errors=[];
  win.webContents.on('preload-error',(_,p,e)=>errors.push(e.message));
  await new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  screens.setFeedStatus('',target.id);
  screens.setTickets([{table:'TEST 6',placedAt:new Date().toISOString(),items:[{name:'Test soup',qty:2}]}],target.id);
  await new Promise(resolve=>setTimeout(resolve,500));
  const result = await win.webContents.executeJavaScript(`({cards:document.querySelectorAll('.ticket').length,text:document.getElementById('board').textContent,status:document.getElementById('connection').textContent,width:innerWidth,height:innerHeight})`);
  assert.equal(result.cards,1);
  assert.match(result.text,/Test soup/);
  assert.equal(result.status,'');
  assert.deepEqual(errors,[]);
  assert.equal(win.isAlwaysOnTop(),true);
  assert.deepEqual(win.getBounds(),target.bounds);
  console.log(JSON.stringify({ok:true,fillsMonitor:true,bounds:win.getBounds(),renderer:result}));
 } finally {screens.closeAll();clearTimeout(timeout);app.quit();}
}).catch(e=>{console.error(e.stack);app.exit(1);});

