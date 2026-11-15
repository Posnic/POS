'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { inspectWindows, createSpooler } = require('../src/windows-spooler');

test('Windows queue errors retain a useful cause and bounded timeout', async () => {
  await assert.rejects(inspectWindows('Receipt', (exe, args, options, done) => {
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 15000);
    done(new Error('command failed'), '', 'Access denied\r\nprivate diagnostic');
  }), { message: 'Could not inspect the Windows printer queue: Access denied' });
  await assert.rejects(inspectWindows('Receipt', (exe, args, options, done) => {
    done(Object.assign(new Error('timeout'), { killed: true }), '', '');
  }), /timed out/);
});

test('failed mandatory queue inspection never submits a duplicate', async () => {
  let submitted = 0;
  const service = createSpooler({ platform: 'win32', inspect: async () => { throw new Error('queue unavailable'); } });
  const outcome = await service.submit({ printerName: 'Receipt', documentName: 'sale', submit: async () => submitted++ });
  assert.equal(submitted, 0);
  assert.equal(outcome.success, false);
  assert.equal(outcome.submitted, false);
});

test('real Windows PowerShell uses CIM fallback when PrintManagement is unavailable', { skip: process.platform !== 'win32' }, async () => {
  // Execute the actual production script with deterministic Windows provider fixtures.
  const fixture = `
function Get-PrintJob { throw 'PrintManagement unavailable' }
function Get-PrinterPort { throw 'PrintManagement unavailable' }
function Get-CimInstance {
 param([string]$ClassName, [string]$ErrorAction)
 if ($ClassName -eq 'Win32_Printer') {
  [pscustomobject]@{Name='Receipt, front';PortName='USB001';PNPDeviceID='';WorkOffline=$false;PrinterStatus=3;ExtendedPrinterStatus=3}
 } elseif ($ClassName -eq 'Win32_PrintJob') {
  [pscustomobject]@{Name='Receipt, front, 12';JobId=12;Document='sale-123';JobStatus='';Status='OK'}
  [pscustomobject]@{Name='Other, 13';JobId=13;Document='sale-123';JobStatus='';Status='OK'}
 }
}
`;
  const snapshot = await inspectWindows('Receipt, front', (exe, args, options, done) => {
    const script = Buffer.from(args[3], 'base64').toString('utf16le');
    execFile(exe, [...args.slice(0, 3), Buffer.from(fixture + script, 'utf16le').toString('base64')], options, done);
  });
  assert.equal(snapshot.present, true);
  assert.equal(snapshot.portPresent, true);
  assert.deepEqual(snapshot.jobs.map(j => j.id), [12]);
  assert.equal(snapshot.jobs[0].document, 'sale-123');
});
