'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function setup(t) {
  const html = read('src/hardware-manager.html');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  const controls = [...d.querySelectorAll('input,select,button[id],textarea')].filter(e => e.id);
  w.eval(read('src/kitchen-screen-fit.js'));
  w.eval(read('src/hardware-workspace.js'));
  return { w, d, controls, html };
}
test('all existing controls survive page reorganization as the same DOM nodes', t => {
  const { d, controls } = setup(t);
  for (const control of controls) assert.equal(d.getElementById(control.id), control, control.id);
  const ids = [...d.querySelectorAll('[id]')].map(e => e.id);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  assert.equal(d.querySelectorAll('.tabs .tab').length, 8);
  assert.equal(d.querySelector('#printer-panel-4 #rcptLogsTable').id, 'rcptLogsTable');
  assert.ok(d.getElementById('wrHealth').closest('details'));
  assert.ok(d.getElementById('enableSimulation').closest('details'));
});
test('section navigation exposes one page, supports keyboard navigation and retains edits', t => {
  const { w, d } = setup(t);
  const nav = d.querySelector('#mobileTab .hw-subnav');
  nav.children[1].click();
  assert.equal(d.getElementById(nav.children[0].getAttribute('aria-controls')).hidden, true);
  assert.equal(d.getElementById(nav.children[1].getAttribute('aria-controls')).hidden, false);
  nav.children[1].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(d.activeElement, nav.children[2]);
  assert.equal(nav.children[2].getAttribute('aria-selected'), 'true');
  assert.equal(d.querySelector('#mobileTab input, #mobileTab select').id, 'maxDevicesSelect');
});
test('multiple display drafts retain every setting and use isolated previews without configuring hardware', t => {
  const { w, d, html } = setup(t);
  let configured = 0; w.posnicKitchenScreen = { configure: () => configured++ };
  w.eval('var screenState={displays:[],branches:[]};' + html.slice(html.indexOf('        function esc(t)'), html.indexOf('        function numOr')));
  const displays = [1,2].map(id=>({id,label:'Kitchen '+id,widthPx:1080,heightPx:1920,primary:id===1,config:{viewingDistanceM:2.5,diagonalInches:43,fontSizePx:32,portraitColumns:2},fit:{}}));
  w.screenState.displays = displays; w.drawScreens();
  const prefixes=['use','portrait','font-px','visible-dishes','branch','table-only','dist','diag','arc','safe','w','h','order-sort','glow','cancel-seconds','cancel-pulse','t','i','n','a','amber','red','pulse','pulse-on','dwell'];
  for (const display of displays) for (const key of prefixes) assert.ok(d.getElementById(key+'-'+display.id),key);
  const ids=[...d.querySelectorAll('[id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
  const frame=d.querySelector('#screenList iframe');assert.equal(frame.getAttribute('sandbox'),'allow-scripts');
  let message; frame.contentWindow.postMessage=data=>{message=data;};
  const font=d.getElementById('font-px-1');font.value='48';font.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(message.type,'posnic-hardware-preview');assert.equal(message.config.fontSizePx,48);
  assert.equal(configured,0);assert.equal(d.getElementById('use-1').getAttribute('onchange'),null);
  assert.match(d.querySelector('.hw-screen-card').textContent,/cover the sale screen/);
});
test('shop settings buttons use only fixed intents, and the assets ship in the installer', async t => {
  const { w, d }=setup(t);const intents=[];
  w.electronAPI={desktop:{open:async target=>{intents.push(target);return true;}}};
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Open receipt designer').click();
  [...d.querySelectorAll('button')].find(b=>b.textContent==='Pair or approve a phone').click();
  await Promise.resolve();assert.deepEqual(intents,['shop:print','shop:captainapp']);
  const files=JSON.parse(read('package.json')).build.files;
  for(const file of ['src/hardware-workspace.js','src/hardware-workspace.css','src/kitchen-screen-fit.js'])assert.ok(files.includes(file),file);
});
test('screen Save persists the draft; test service does not open if saving fails', async t => {
  const {w,d,html}=setup(t);let saved,opened=0;
  w.eval('var screenState={displays:[],branches:[]};' + html.slice(html.indexOf('        function esc(t)'),html.indexOf('        /* ------------------------------------------------ kitchen sound */')));
  w.screensAvailable=()=>true;w.alert=()=>{};
  const display={id:5,label:'Kitchen',widthPx:1920,heightPx:1080,config:{fontSizePx:32},fit:{}};
  w.screenState.displays=[display];w.drawScreens();
  w.posnicKitchenScreen={configure:async(_id,patch)=>{saved=patch;return {displays:[{...display,config:patch}]};},preview:async()=>opened++};
  d.getElementById('font-px-5').value='48';
  assert.equal(await w.saveScreen('5'),true);assert.equal(saved.fontSizePx,48);assert.equal(opened,0);
  assert.match(d.getElementById('screenSaveStatus').textContent,/saved/);
  w.posnicKitchenScreen.configure=async()=>{throw Error('Disconnected');};
  await w.previewScreen('5');assert.equal(opened,0);assert.match(d.getElementById('screenSaveStatus').textContent,/Could not save/);
});


test('recommended layout resets confusing overrides only in the draft and preserves the branch', t => {
  const {w,d,html}=setup(t);
  w.eval('var screenState={displays:[],branches:[]};'+html.slice(html.indexOf('        function esc(t)'),html.indexOf('        function numOr')));
  w.screenState.displays=[{id:9,widthPx:1920,heightPx:1080,config:{fontSizePx:96,portraitColumns:2,visibleDishesPerBox:3,tableOnly:true,branchId:'shop'},fit:{}}];
  w.drawScreens();
  const card=d.querySelector('.hw-screen-card');
  assert.ok(d.getElementById('visible-dishes-9').closest('details'));
  let message;card.querySelector('iframe').contentWindow.postMessage=data=>message=data;
  [...card.querySelectorAll('button')].find(b=>b.textContent==='Use recommended layout').click();
  assert.equal(message.config.fontSizePx,0);assert.equal(message.config.visibleDishesPerBox,0);
  assert.equal(message.config.portraitColumns,0);assert.equal(message.config.tableOnly,false);
  assert.equal(message.config.branchId,'shop');assert.equal(message.config.orderSort,'oldest');
  assert.match(card.textContent,/Unsaved changes/);
});
