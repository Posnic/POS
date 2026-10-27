'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Find a browser for QR-linked WhatsApp when Puppeteer's download is absent. */
function chromeExecutable({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  puppeteer,
  existsSync = fs.existsSync,
} = {}) {
  const exists = (candidate) => !!candidate && existsSync(candidate);
  for (const name of ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']) {
    if (!env[name]) continue;
    if (!exists(env[name]))
      throw new Error(
        `${name} does not point to an installed browser: ${env[name]}`
      );
    return env[name];
  }

  // Keep Puppeteer's tested Chrome build when it has actually been installed.
  try {
    const cached = puppeteer?.executablePath();
    if (exists(cached)) return cached;
  } catch (_) {
    // A missing or unconfigured cache is expected in packaged installations.
  }

  const candidates = [];
  if (platform === 'win32') {
    const roots = [
      env.PROGRAMFILES || env.ProgramFiles,
      env['PROGRAMFILES(X86)'] || env['ProgramFiles(x86)'],
      env.ProgramW6432,
      env.LOCALAPPDATA || env.LocalAppData,
    ].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
      );
      candidates.push(
        path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      );
    }
  } else if (platform === 'darwin') {
    for (const root of [
      '/Applications',
      path.posix.join(home, 'Applications'),
    ]) {
      candidates.push(
        path.posix.join(
          root,
          'Google Chrome.app',
          'Contents',
          'MacOS',
          'Google Chrome'
        )
      );
      candidates.push(
        path.posix.join(
          root,
          'Microsoft Edge.app',
          'Contents',
          'MacOS',
          'Microsoft Edge'
        )
      );
    }
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge'
    );
  }

  const names =
    platform === 'win32'
      ? ['chrome.exe', 'msedge.exe']
      : [
          'google-chrome',
          'google-chrome-stable',
          'chromium',
          'chromium-browser',
          'microsoft-edge',
        ];
  for (const directory of String(env.PATH || '').split(
    platform === 'win32' ? ';' : ':'
  )) {
    if (!directory) continue;
    for (const name of names) {
      candidates.push(
        platform === 'win32'
          ? path.win32.join(directory, name)
          : path.posix.join(directory, name)
      );
    }
  }
  const found = candidates.find(exists);
  if (found) return found;
  throw new Error(
    'WhatsApp needs Chrome or Microsoft Edge installed on this machine. Install one, or set CHROME_PATH to its executable, then retry the connection.'
  );
}

module.exports = { chromeExecutable };
