'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const raw = require('./raw-print-service');
const script = fs.readFileSync(path.join(__dirname, 'windows-printer-health.ps1'), 'utf8');

function inspect(printer, binding = {}, recover = false) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 12000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        try {
          const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
          if (result.error) throw new Error(result.error);
          if (error) throw error;
          resolve(result);
        } catch (failure) { reject(failure); }
      });
    child.stdin.on('error', () => {}); // execFile reports helper failures.
    child.stdin.end(JSON.stringify({ printer, expectedPort: binding.port, pnpId: binding.pnpId, recover }));
  });
}

module.exports = {
  inspect,
  recover: (printer, binding) => inspect(printer, binding, true),
  initialize: ({ printer, file, document }) => {
    fs.writeFileSync(file, Buffer.from([0x1b, 0x40]), { mode: 0o600 });
    return raw.send({ printer, file, doc: document });
  },
  // The existing resident winspool writer retains the exact receipt bytes.
  // Never fall back to a second submission after an uncertain first attempt.
  submit: ({ printer, file, document }) => raw.send({ printer, file, doc: document }),
};
