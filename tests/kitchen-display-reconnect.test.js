'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const vm=require('vm');const path=require('path');
function harness(){
 let stored={kitchenScreens:{}}, panels=[], tick, resume, writes=0;
 const events={};const primary={id:1,label:'Till',internal:true,size:{width:1920,height:1080},bounds:{x:0,y:0,width:1920,height:1080},scaleFactor:1};panels=[primary];
 class Window{constructor(){this.handlers={};this.webContents={send(){}};}setBounds(){}showInactive(){}setMenuBarVisibility(){}loadFile(){}once(n,f){this.handlers[n]=f;}on(n,f){this.handlers[n]=f;}isDestroyed(){return !!this.destroyed;}destroy(){this.destroyed=true;this.handlers.closed?.();}}
 const electron={screen:{getAllDisplays:()=>panels,getPrimaryDisplay:()=>primary,on:(n,f)=>events[n]=f},powerMonitor:{on:(n,f)=>resume=f},BrowserWindow:Window};
 const prefs={all:()=>JSON.parse(JSON.stringify(stored)),prefsPath:()=>'/preferences.json',saveJson:(_,v)=>{stored=v;writes++;}};
 const context={module:{exports:{}},require:n=>n==='electron'?electron:n==='./device-preferences'?prefs:n==='./kitchen-screen-fit'?require('../src/kitchen-screen-fit'):require(n),__dirname:path.resolve('src'),console,setInterval:f=>{tick=f;return {unref(){}}},setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync('src/kitchen-screen.js','utf8'),context);const app=context.module.exports;
 const wall=(id=2,label='Kitchen TV')=>({id,label,internal:false,size:{width:1920,height:1080},bounds:{x:1920,y:0,width:1920,height:1080},scaleFactor:1});
 return {app,wall,primary,setPanels:p=>panels=p,store:()=>stored,tick:()=>tick(),resume:()=>resume(),event:n=>events[n](),writes:()=>writes};
}
test('saved screen stays enabled while powered off; late power-on and missed events restore it',()=>{
 const h=harness();h.setPanels([h.primary,h.wall()]);h.app.configure(2,{enabled:true,branchId:'shop'});h.setPanels([h.primary]);h.event('display-removed');
 assert.equal(h.app._windows.size,0);const saved=h.app.displays().find(d=>d.id==='2');assert.equal(saved.connected,false);assert.equal(saved.config.enabled,true);
 h.setPanels([h.primary,h.wall()]);h.tick();assert.equal(h.app._windows.size,1);assert.equal(h.app.configFor(2).branchId,'shop');
 h.app.closeAll();h.tick();assert.equal(h.app._windows.size,0);h.app.start();assert.equal(h.app._windows.size,1);h.app.closeAll();
});
test('changed Windows ID reconnects only a unique matching external screen and preserves config',()=>{
 const h=harness();h.setPanels([h.primary,h.wall()]);h.app.configure(2,{enabled:true,fontSizePx:48});h.setPanels([h.primary,h.wall(9)]);h.tick();
 assert.equal(h.app._windows.has('9'),true);assert.equal(h.app.configFor(9).fontSizePx,48);assert.equal(h.store().kitchenScreens['2'],undefined);h.app.closeAll();
});
test('ambiguous screens are not assigned automatically and explicit disable survives reconnection',()=>{
 const h=harness();h.setPanels([h.primary,h.wall()]);h.app.configure(2,{enabled:true});h.setPanels([h.primary,h.wall(8),h.wall(9)]);h.tick();assert.equal(h.app._windows.size,0);assert.equal(h.app.configFor(2).enabled,true);
 h.app.configure(2,{enabled:false});h.setPanels([h.primary,h.wall()]);h.resume();assert.equal(h.app._windows.size,0);h.app.closeAll();
});
