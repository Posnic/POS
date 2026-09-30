'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { powerGuidance } = require('../src/windows-printer-transport');
const script = fs.readFileSync(path.join(__dirname, '../src/windows-printer-health.ps1'), 'utf8').replace(/\r\n/g, '\n');
const windows = process.platform === 'win32';
function ps(code, input) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], {
    input: JSON.stringify(input), encoding:'utf8', windowsHide:true, timeout:15000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
}
const resolver = script.slice(script.indexOf('function Resolve-UsbIdentity'), script.indexOf('# Read-only power audit'));
function resolve(input) {
  return ps(resolver + '\n$c = [Console]::In.ReadToEnd() | ConvertFrom-Json; Resolve-UsbIdentity $c.port $c.savedId $c.records $c.presentIds | ConvertTo-Json -Compress', input);
}
const a='USBPRINT\\POS80\\A', b='USBPRINT\\POS80\\B', old='USBPRINT\\UnknownPrinter\\OLD';
const records=[{id:a,port:'USB003'},{id:old,port:'USB003'},{id:b,port:'USB004'}];
for (const [name, input, expected] of [
  ['ignores phantom history and selects only present match',{port:'USB003',records,presentIds:[a,b]}, {discovery:'resolved',present:true,pnpId:a}],
  ['absent is distinct from ambiguity',{port:'USB003',records,presentIds:[b]}, {discovery:'absent',present:false}],
  ['two present matches never guess',{port:'USB003',records,presentIds:[a,old,b]}, {discovery:'ambiguous',present:null}],
  ['explicit binding can disambiguate active matches',{port:'USB003',savedId:a,records,presentIds:[a,old,b]}, {discovery:'resolved',present:true,pnpId:a}],
  ['stale binding never silently adopts another device',{port:'USB003',savedId:old,records,presentIds:[a,b]}, {discovery:'stale-binding',present:null,pnpId:old}],
  ['saved device on another port is rejected',{port:'USB004',savedId:a,records,presentIds:[a,b]}, {discovery:'port-mismatch',present:null}],
  ['unknown port for present saved device is unresolved',{port:'USB003',savedId:a,records:[],presentIds:[a]}, {discovery:'unknown',present:null}],
  ['unmapped present devices are unknown, not proof of disconnection',{port:'USB003',records:[],presentIds:[a]}, {discovery:'unknown',present:null}],
  ['case insensitive IDs retain proper queue mapping',{port:'usb004',records,presentIds:[b.toLowerCase()]}, {discovery:'resolved',present:true,pnpId:b}],
]) {
  test(name, {skip:!windows}, () => {
    const got=resolve(input); for(const [key,value] of Object.entries(expected))assert.equal(got[key],value,key);
  });
}
test('PnP enumeration failure returns unknown presence with error, not disconnected', {skip:!windows}, () => {
  const mocks = `function Get-CimInstance { [pscustomobject]@{Name='Kitchen';PortName='USB003';WorkOffline=$false;PrinterStatus=3;ExtendedPrinterStatus=2;DetectedErrorState=0} }
function Get-PnpDevice { throw 'Enumeration denied' }
function Get-PrintJob { @() }
`;
  const got=ps(mocks+script,{printer:'Kitchen',recover:false});
  assert.equal(got.discovery,'error'); assert.equal(got.present,null);
  assert.match(got.discoveryError,/Enumeration denied/); assert.deepEqual(got.jobs,[]);
});
test('power guidance covers AC/DC and preserves unknowns without claiming settings changed', () => {
  assert.deepEqual(powerGuidance({sleep:{ac:0,dc:0},hibernate:{ac:0,dc:0},usbSuspend:{ac:0,dc:0},externalKeepAlive:false}),[]);
  const bad=powerGuidance({sleep:{ac:60,dc:0},hibernate:{ac:0,dc:120},usbSuspend:{ac:1,dc:null},externalKeepAlive:true}).join('\n');
  assert.match(bad,/Sleep \(Plugged in\).*Never/);
  assert.match(bad,/Hibernate \(On battery\).*Never/);
  assert.match(bad,/USB selective suspend \(Plugged in\).*temporarily test.*Disabled/);
  assert.match(bad,/On battery\): could not verify/);
  assert.match(bad,/separate Posnic printer keep-alive/);
});
test('power parser accepts localized labels and reports command failure as unknown', {skip:!windows}, () => {
  const fn=script.slice(script.indexOf('function Read-PowerSetting'),script.indexOf('try {\n    $request'));
  const got=ps(`function powercfg.exe { $global:LASTEXITCODE=0; 'Minimum: 0x00000000'; 'Maximum: 0xffffffff'; 'Netzbetrieb: 0x00000000'; 'Batterie: 0x00000001' };
`+fn+"\nRead-PowerSetting 'a' 'b' | ConvertTo-Json -Compress",{});
  assert.deepEqual(got,{ac:0,dc:1});
  const failed=ps(`function powercfg.exe { $global:LASTEXITCODE=1; 'unsupported' };
`+fn+"\nRead-PowerSetting 'a' 'b' | ConvertTo-Json -Compress",{});
  assert.deepEqual(failed,{ac:null,dc:null});
});

test('Hardware Manager renders power guidance and discovery states as text', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '../src/hardware-manager.html'), 'utf8');
  const dom = new JSDOM(html, {runScripts:'outside-only'});
  try {
    const w = dom.window;
    w.electronAPI = {printer:{recoveryStatus:async()=>({supported:true, systemSettings:{guidance:['Sleep: Never <test>']}, health:[{printer:'Kitchen',port:'USB003',discovery:'ambiguous',workOffline:false,printerStatus:3}], jobs:[]})}};
    w.eval(html.slice(html.indexOf('let wrBindings ='),html.indexOf('async function wrSave()')));
    await w.wrRefresh();
    assert.equal(w.document.getElementById('wrPower').textContent,'Sleep: Never <test>');
    assert.equal(w.document.querySelector('test'),null);
    assert.match(w.document.getElementById('wrHealth').textContent,/ambiguous/);
    assert.equal(w.document.getElementById('windowsRecovery').style.display,'block');
  } finally {dom.window.close();}
});
