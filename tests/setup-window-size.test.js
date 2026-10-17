'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
const start=source.indexOf('async function redirectToWizard()');
const setupSizing=source.slice(start,source.indexOf("    await mainWindow.loadFile('src/install-wizard.html');",start))+'}}';
test('setup window fits current display work area including scaling and taskbar',async()=>{
 for(const area of [{x:0,y:0,width:1920,height:1040},{x:1920,y:0,width:1366,height:728},{x:-1093,y:0,width:1093,height:600}]) {
  let bounds,min;
  const ctx={electron:{screen:{getDisplayMatching:()=>({workArea:area})}},mainWindow:{isMaximized:()=>false,getBounds:()=>({x:area.x,y:area.y,width:1200,height:800}),setMinimumSize:(...v)=>min=v,setBounds:v=>bounds=v}};
  vm.createContext(ctx);vm.runInContext(setupSizing,ctx);await ctx.redirectToWizard();
  assert.ok(bounds.x>=area.x&&bounds.y>=area.y);
  assert.ok(bounds.x+bounds.width<=area.x+area.width&&bounds.y+bounds.height<=area.y+area.height);
  assert.ok(min[0]<=bounds.width&&min[1]<=bounds.height);
  assert.equal(bounds.height,Math.min(960,area.height-24));
 }
});
test('setup preserves an already maximized window',async()=>{
 const ctx={mainWindow:{isMaximized:()=>true}};vm.createContext(ctx);vm.runInContext(setupSizing,ctx);await ctx.redirectToWizard();
});
