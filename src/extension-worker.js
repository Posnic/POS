'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const MAX_BYTES = 2 * 1024 * 1024;
let active = 0;
function callWorker(directory, entrypoint, method, payload, { timeout = 10000 } = {}) {
  if (!require('./extension-package').safePath(entrypoint)) return Promise.reject(new Error('extension_worker_path_invalid'));
  const input = JSON.stringify({ method, payload });
  if (Buffer.byteLength(input) > MAX_BYTES || active >= 4) return Promise.reject(new Error('extension_worker_busy'));
  const entry = path.resolve(directory, entrypoint);
  if (!entry.startsWith(path.resolve(directory) + path.sep)) return Promise.reject(new Error('extension_worker_path_invalid'));
  return new Promise((resolve, reject) => {
    active++;
    const env = { ELECTRON_RUN_AS_NODE: '1' };
    for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
    const child = spawn(process.execPath, ['--max-old-space-size=64', entry], {
      cwd: directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = [], length = 0, settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); active--;
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); done(new Error('extension_worker_timeout')); }, timeout);
    child.on('error', error => done(error));
    child.stdin.on('error', () => {});
    child.stdout.on('data', bytes => {
      length += bytes.length;
      if (length > MAX_BYTES) { child.kill(); done(new Error('extension_worker_output_too_large')); }
      else output.push(bytes);
    });
    child.stderr.resume();
    child.on('close', code => {
      if (settled) return;
      try {
        const answer = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (answer.ok !== true) {
          const error = new Error(answer.error?.message || 'Extension planning failed.');
          error.code = answer.error?.code || 'extension_worker_failed'; error.status = 422;
          return done(error);
        }
        if (code !== 0) return done(new Error('extension_worker_failed'));
        done(null, answer.result);
      } catch { done(new Error('extension_worker_invalid_reply')); }
    });
    child.stdin.end(input);
  });
}
module.exports = { callWorker };
