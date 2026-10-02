// Run real Electron rendering without submitting anything to a printer.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const output = path.resolve(process.argv[2] || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-cold-print-')), 'result.json'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
fs.writeFileSync(output, JSON.stringify({ running: true }));
const child = spawn(require('electron'), [path.join(__dirname, 'receipt-cold-paint-proof.cjs'), output], {
  cwd: path.join(__dirname, '../..'), env, windowsHide: true, stdio: 'ignore'
});
const timer = setTimeout(() => child.kill(), 60000);
child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => {
  clearTimeout(timer);
  try {
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (code !== 0 || result.passed !== 6) throw new Error(result.error || 'Receipt rendering proof did not complete');
    console.log('Six receipt renders passed: all strips, including the final strip, are in order. Results: ' + output);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
