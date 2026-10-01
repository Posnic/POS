'use strict';
// Own the test process until it exits. Do not attach its streams to a PTY
// that PowerShell may close early for a Windows GUI executable.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-receipt-proof-'));
const output = path.resolve(process.argv[2] || path.join(temporaryDirectory, 'result.json'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.writeFileSync(output, JSON.stringify({ running: true }));
const child = spawn(require('electron'), [path.join(__dirname, 'receipt-document-proof.cjs'), output], {
  cwd: path.join(__dirname, '../..'), env, windowsHide: true, stdio: 'ignore',
});
let timedOut = false;
const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
child.on('error', error => {
  clearTimeout(timeout);
  console.error('Could not launch receipt proof:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  clearTimeout(timeout);
  try {
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (timedOut || code !== 0 || result.error || result.passed !== 4) {
      throw new Error(result.error || 'Receipt proof incomplete: exit=' + code + ', signal=' + signal + ', timeout=' + timedOut);
    }
    console.log('Receipt proof: all four scenarios passed. Results: ' + output);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
