'use strict';

const { execFile } = require('child_process');
const crypto = require('crypto');

async function defaultPrinterName(run = execFile) {
  const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
@(Get-CimInstance Win32_Printer | Where-Object { $_.Default } | Select-Object -ExpandProperty Name) | ConvertTo-Json -Compress`;
  return new Promise((resolve, reject) => run('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 5000, maxBuffer: 128 * 1024, encoding: 'utf8' },
    (error, stdout) => {
      if (error) return reject(new Error('Could not read the Windows default printer'));
      try {
        const text = stdout.replace(/^\uFEFF/, '').trim();
        const value = text ? JSON.parse(text) : [];
        const names = Array.isArray(value) ? value : [value];
        resolve(names.length === 1 && typeof names[0] === 'string' ? names[0] : null);
      } catch (_) { reject(new Error('Invalid Windows default printer response')); }
    }));
}

function result(printerName, values = {}) {
  return { printerName, jobId: null, state: 'failed', submitted: false,
    error: '', retryable: true, success: false, ...values };
}

function inspectWindows(printerName, run = execFile) {
  // Pass names as data, never interpolate them into PowerShell expressions.
  const name = Buffer.from(JSON.stringify(String(printerName)), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}')) | ConvertFrom-Json
$p = @(Get-CimInstance Win32_Printer | Where-Object { $_.Name -ceq $name })
if ($p.Count -ne 1) { @{present=$false;jobs=@()} | ConvertTo-Json -Compress; exit }
$p = $p[0]
$portPresent = $true
$devicePresent = $true
if ($p.PortName -match '^USB[0-9]+$') {
  # PrintManagement is not available on every supported Windows installation.
  # A failed optional port probe is not evidence that the printer is unplugged.
  try { $portPresent = @((Get-PrinterPort -ErrorAction Stop) | Where-Object { $_.Name -ceq $p.PortName }).Count -gt 0 } catch { $portPresent = $true }
  if ($p.PNPDeviceID) {
    try { $devicePresent = @((Get-CimInstance Win32_PnPEntity -ErrorAction Stop) | Where-Object { $_.PNPDeviceID -eq $p.PNPDeviceID -and $_.ConfigManagerErrorCode -eq 0 }).Count -gt 0 } catch { $devicePresent = $true }
  }
}
try {
  $jobs = @(Get-PrintJob -PrinterName $name -ErrorAction Stop | ForEach-Object {
    @{id=[int]$_.ID;document=[string]$_.DocumentName;status=[string]$_.JobStatus}
  })
} catch {
  # Win32_PrintJob works without the PrintManagement PowerShell module.
  # Name is '<printer>, <job id>'; split at the last comma (names can contain commas).
  $jobs = @(Get-CimInstance Win32_PrintJob -ErrorAction Stop | Where-Object {
    $separator = $_.Name.LastIndexOf(',')
    $separator -ge 0 -and $_.Name.Substring(0, $separator) -ceq $name
  } | ForEach-Object {
    @{id=[int]$_.JobId;document=[string]$_.Document;status=([string]$_.JobStatus + ' ' + [string]$_.Status)}
  })
}
@{present=$true;workOffline=[bool]$p.WorkOffline;offline=($p.PrinterStatus -eq 7 -or $p.ExtendedPrinterStatus -eq 7);portPresent=$portPresent;devicePresent=$devicePresent;jobs=$jobs} | ConvertTo-Json -Depth 4 -Compress
`;
  return new Promise((resolve, reject) => run('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    (error, stdout, stderr) => {
      if (error) {
        const reason = error.killed ? 'Windows queue inspection timed out' :
          error.code === 'ENOENT' ? 'Windows PowerShell was not found' :
          String(stderr || error.message || 'Windows queue service unavailable').trim().split(/\r?\n/)[0].slice(0, 240);
        return reject(new Error('Could not inspect the Windows printer queue: ' + reason));
      }
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); }
      catch (_) { reject(new Error('Invalid Windows printer queue response')); }
    }));
}

function createSpooler({ inspect = inspectWindows, platform = process.platform,
  timeoutMs = 5000, now = Date.now, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const active = new Map();
  function existing(snapshot, printerName, documentName) {
    const job = (snapshot.jobs || []).find(j => j.document === documentName && Number(j.id) > 0);
    if (!job) return null;
    const blocked = /error|offline|blocked|intervention/i.test(job.status || '');
    return result(printerName, { jobId: Number(job.id), state: blocked ? 'blocked' : 'spooled',
      submitted: true, success: !blocked, retryable: false,
      error: blocked ? 'An existing spooler job needs attention; do not submit another copy' : '' });
  }
  async function find(printerName, documentName) {
    if (platform !== 'win32') return null;
    return existing(await inspect(printerName), printerName, documentName);
  }
  async function perform({ printerName, documentName, submit }) {
    if (!printerName) return result('', { error: 'Select an exact printer name' });
    if (platform !== 'win32') return submit(documentName);
    let started = false;
    try {
      const snapshot = await inspect(printerName);
      const found = existing(snapshot, printerName, documentName);
      if (found) return found;
      if (!snapshot.present) return result(printerName, { error: 'Printer not found: ' + printerName });
      if (snapshot.workOffline || snapshot.offline || snapshot.portPresent === false || snapshot.devicePresent === false) {
        return result(printerName, { state: 'offline', error: 'Printer offline/disconnected' });
      }
      started = true;
      const submission = await submit(documentName);
      // StartDocPrinter's positive return is direct evidence of a spooler job.
      if (Number(submission?.jobId) > 0) return result(printerName, { ...submission,
        jobId: Number(submission.jobId), submitted: true, retryable: false,
        state: submission.success ? 'spooled' : 'blocked' });
      const deadline = now() + timeoutMs;
      do {
        const observed = existing(await inspect(printerName), printerName, documentName);
        if (observed) return submission?.success ? observed : result(printerName, {
          ...observed, success: false, state: 'blocked',
          error: submission?.error || submission?.reason || 'Submission failed after creating a spooler job',
        });
        await delay(100);
      } while (now() < deadline);
      // Absence from a snapshot is not proof that a fast job never existed.
      // Fail closed: leave pending for reconciliation, never send another copy.
      return result(printerName, { state: 'unknown', submitted: !!submission?.success,
        error: submission?.error || submission?.reason || 'No matching Windows spooler job was observed', retryable: false });
    } catch (error) {
      return result(printerName, { state: started ? 'unknown' : 'failed', error: error.message,
        retryable: !started });
    }
  }
  function submit(options) {
    const key = JSON.stringify([options.printerName, options.documentName]);
    if (active.has(key)) return active.get(key);
    const pending = perform(options).finally(() => active.delete(key));
    active.set(key, pending);
    return pending;
  }
  return { submit, find };
}

const service = createSpooler();
module.exports = { ...service, createSpooler, result, defaultPrinterName, inspectWindows,
  documentName: (key, index) => 'Posnic-KOT-' + crypto.createHash('sha256').update(`${key}:${index}`).digest('hex').slice(0, 32) };
