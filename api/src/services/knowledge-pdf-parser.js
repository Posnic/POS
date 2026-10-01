'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Limits are per API process. No unbounded queue retains uploaded buffers.
// The V8 heap limit is not an OS-level limit on native allocations.
function createParser({ launch = spawn, timeoutMs = 30000, concurrency = 2 } = {}) {
  let running = 0;
  return async function parsePdf(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) throw new Error('Choose a PDF smaller than 10 MB.');
    if (running >= concurrency) throw new Error('PDF extraction is busy. Try again after the current uploads finish.');
    running++;
    return new Promise((resolve, reject) => {
      let child, timer, settled = false, failure, size = 0;
      const chunks = [];
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running--;
        if (error) reject(error); else resolve(result);
      };
      const stop = (message) => {
        if (!failure) failure = new Error(message);
        child.kill('SIGKILL');
      };
      try {
        // Provider credentials and application configuration are not inherited.
        const env = {};
        for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'PATH']) if (process.env[key]) env[key] = process.env[key];
        if (process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1') env.ELECTRON_RUN_AS_NODE = '1';
        child = launch(process.execPath, ['--max-old-space-size=128', '--max-semi-space-size=8', path.join(__dirname, 'knowledge-pdf-worker.js')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        timer = setTimeout(() => stop('PDF extraction timed out. Split the document into smaller files.'), timeoutMs);
        child.on('error', () => finish(new Error('PDF extraction could not start.')));
        child.stdin.on('error', () => stop('PDF extraction failed. Check the document and try again.'));
        child.stdout.on('data', chunk => {
          size += chunk.length;
          if (size > MAX_OUTPUT_BYTES) stop('PDF extraction exceeded the output limit. Split the document into smaller files.');
          else chunks.push(chunk);
        });
        child.on('close', code => {
          if (failure) return finish(failure);
          if (code !== 0) return finish(new Error('PDF extraction failed. Check the document and try again.'));
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (result.error === 'too_large') return finish(new Error('Split this document into smaller sources (maximum 200,000 characters).'));
            if (typeof result.text !== 'string' || result.text.length > 200000 || !Number.isSafeInteger(result.pages) || result.pages < 0) throw new Error();
            finish(null, result);
          } catch (_error) { finish(new Error('PDF extraction returned invalid content.')); }
        });
        child.stdin.end(buffer);
      } catch (_error) {
        if (child) stop('PDF extraction failed.');
        else finish(new Error('PDF extraction could not start.'));
      }
    });
  };
}

module.exports = { parsePdf: createParser(), createParser, MAX_FILE_BYTES };
