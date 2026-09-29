'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect, parsePmset } = require('../src/printer-environment');
const noFiles = { readdir: async () => { throw new Error('Unavailable'); } };

test('Windows explains desktop Setting and AC/DC without changing settings', async () => {
  const result = await inspect({ platform: 'win32', windows: async () => ({ sleep: {ac:0,dc:600}, hibernate:{ac:0,dc:null}, usbSuspend:{ac:1,dc:0} }) });
  assert.ok(result.checks.some(c => c.label.includes('USB') && c.status === 'review'));
  assert.ok(result.checks.some(c => c.status === 'unknown'));
  assert.match(result.instructions.join(' '), /desktop may show only/);
  assert.match(result.instructions.join(' '), /Restore the original/);
});
test('macOS parses power-source sleep policy and detects paused or rejecting CUPS queues', async () => {
  const calls = [];
  const result = await inspect({ platform:'darwin', run:async (file,args) => {
    calls.push([file,args]);
    if(file==='pmset') return 'Battery Power:\n sleep 5\nAC Power:\n sleep 0\n displaysleep 10';
    return args[0]==='-p' ? 'printer Kitchen disabled since today\n Paper empty' : 'Kitchen not accepting requests';
  } });
  assert.equal(result.checks.filter(c=>c.status==='review').length,3);
  assert.ok(result.checks.some(c=>c.label.includes('AC Power') && c.detail==='Never.'));
  assert.deepEqual(calls.find(c=>c[0]==='pmset')[1],['-g','custom']);
  assert.match(result.instructions.join(' '), /no equivalent universal USB/);
  assert.deepEqual(parsePmset('displaysleep 5\nstandby 1'), []);
});
test('Linux reads printer interface power attributes without treating network printers as disconnected', async () => {
  const files={ readdir:async()=>['1-2:1.0','1-3:1.0','usb1'], readFile:async name => {
    if(name.endsWith('bInterfaceClass')) return name.includes('1-2') ? '07\n' : '03\n';
    if(name.endsWith('power/control')) return 'auto\n';
    return 'suspended\n';
  } };
  const result=await inspect({platform:'linux',files,run:async file=>file==='lpstat'?'printer Kitchen is idle':"'suspend'"});
  const usb=result.checks.find(c=>c.label==='USB printer device 1-2');
  assert.equal(usb.status,'review'); assert.match(usb.detail,/runtime_status=suspended/);
  assert.match(usb.detail,/Not mapped to a particular queue/);
  assert.equal(result.checks.some(c=>c.label.includes('1-3')),false);
});
test('missing tools and permission failures remain unknown, not healthy', async () => {
  for (const platform of ['linux','darwin','win32']) {
    const result=await inspect({platform,files:noFiles,run:async()=>{throw new Error('Denied');},windows:async()=>{throw new Error('Denied');}});
    assert.ok(result.checks.length); assert.ok(result.checks.every(c=>c.status==='unknown'));
    assert.ok(result.instructions.length); assert.ok(result.common.length);
  }
});
test('Linux on policy and idle CUPS status are observations, not promises of paper output', async () => {
  const result=await inspect({platform:'linux',files:{readdir:async()=>[]},run:async file=>file==='lpstat'?'printer Reception is idle':"'nothing'"});
  assert.ok(result.checks.some(c=>/No USB printer-class/.test(c.detail) && c.status==='unknown'));
  assert.ok(result.checks.some(c=>/GNOME/.test(c.label) && c.status==='info'));
});
test('readiness guidance renders on macOS and Linux even without Windows recovery', async () => {
  const { JSDOM }=require('jsdom'),fs=require('fs'),path=require('path');
  const html=fs.readFileSync(path.join(__dirname,'../src/hardware-manager.html'),'utf8');
  for(const platform of ['darwin','linux','win32']) {
    const dom=new JSDOM('<div id="printerEnvironmentStatus"></div><div id="printerEnvironmentChecks"></div><ol id="printerEnvironmentSteps"></ol><div id="wrMessage"></div>',{runScripts:'outside-only'});
    try {
      const w=dom.window;
      w.electronAPI={printer:{recoveryStatus:async()=>({supported:false,environment:{platform,checkedAt:Date.now(),awake:true,checks:[{label:'Queue',status:'review',detail:'<img src=x>'}],instructions:['Step one'],common:['Step two']}})}};
      w.eval(html.slice(html.indexOf('let wrBindings ='),html.indexOf('async function wrSave()')));
      await w.wrRefresh();
      assert.match(w.document.getElementById('printerEnvironmentStatus').textContent,/active for KOT/);
      assert.equal(w.document.querySelectorAll('li').length,2);
      assert.equal(w.document.querySelector('img'),null);
      assert.match(w.document.getElementById('printerEnvironmentChecks').textContent,/<img src=x>/);
    }finally{dom.window.close();}
  }
});

test('GNOME zero timeout is disabled and unreadable timeout is not asserted to be active', async () => {
  for (const [timeout, expected] of [['uint32 0','info'],['900','review'],['unexpected','unknown']]) {
    const result=await inspect({platform:'linux',files:noFiles,run:async (file,args)=>{
      if(file==='lpstat') return 'printer Reception is idle';
      return args[2].endsWith('-type') ? "'suspend'" : timeout;
    }});
    assert.ok(result.checks.filter(c=>c.label.startsWith('GNOME')).every(c=>c.status===expected));
  }
});
