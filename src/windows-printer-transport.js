'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const raw = require('./raw-print-service');
const script = fs.readFileSync(path.join(__dirname, 'windows-printer-health.ps1'), 'utf8');

function inspect(printer, binding = {}, recover = false, action) {
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
    child.stdin.end(JSON.stringify({ printer, expectedPort: binding.port, pnpId: binding.pnpId, recover, action }));
  });
}

function powerGuidance(settings) {
  const messages = [];
  for (const [key, name, change] of [
    ['sleep', 'Sleep', 'Power Options → Change plan settings → Put the computer to sleep: Never'],
    ['hibernate', 'Hibernate', 'Power Options → Advanced settings → Sleep → Hibernate after: Never'],
    ['usbSuspend', 'USB selective suspend', 'Power Options → Advanced settings → USB settings → USB selective suspend: Disabled'],
  ]) {
    for (const [source, label] of [['ac', 'Plugged in'], ['dc', 'On battery']]) {
      const value = settings[key]?.[source];
      if (value === null || value === undefined) messages.push(`${name} (${label}): could not verify. Check ${change}.`);
      else if (value !== 0) messages.push(key === 'usbSuspend'
        ? `${name} (${label}) is enabled. If this printer disconnects after idle, temporarily test ${change} (${label}); restore it if there is no improvement.`
        : `${name} (${label}) is enabled. For a dedicated printing counter, set ${change} (${label}).`);
    }
  }
  if (settings.externalKeepAlive) messages.push('A separate Posnic printer keep-alive helper is running. Stop that helper and remove its Startup shortcut before enabling app initialization or idle commands; two writers can interrupt a ticket.');
  if (settings.externalKeepAlive === null) messages.push('Could not verify external keep-alive helpers. Do not run the diagnostic helper alongside app initialization or idle commands.');
  return messages;
}
let powerCache, powerPending;
async function systemSettings() {
  if (powerCache && Date.now() - powerCache.checkedAt < 60000) return powerCache;
  if (!powerPending) powerPending = inspect('', {}, false, 'power').then(settings => {
    powerCache = { ...settings, guidance: powerGuidance(settings), checkedAt: Date.now() };
    return powerCache;
  }).finally(() => { powerPending = null; });
  return powerPending;
}

module.exports = {
  inspect, systemSettings, powerGuidance,
  recover: (printer, binding) => inspect(printer, binding, true),
  initialize: ({ printer, file, document }) => {
    fs.writeFileSync(file, Buffer.from([0x1b, 0x40]), { mode: 0o600 });
    return raw.send({ printer, file, doc: document });
  },
  // The existing resident winspool writer retains the exact receipt bytes.
  // Never fall back to a second submission after an uncertain first attempt.
  submit: ({ printer, file, document }) => raw.send({ printer, file, doc: document }),
};
