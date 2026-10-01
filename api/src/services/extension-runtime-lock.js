'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A kernel-owned local listener is released automatically after a crash. It
// avoids stale PID files and never needs internet access. Windows uses a named
// pipe so reserved TCP port ranges cannot prevent an otherwise valid install.
// This endpoint accepts no protocol, credentials or application data.
async function acquireRuntimeLock(root) {
  if (!path.isAbsolute(root)) throw new Error('extension_install_root_invalid');
  fs.mkdirSync(root, { recursive: true });
  let canonical = fs.realpathSync(root);
  if (process.platform === 'win32') canonical = canonical.toLowerCase();
  const digest = crypto.createHash('sha256').update(canonical).digest();
  const port = 49152 + (digest.readUInt32BE(0) % 16383);
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', (error) =>
      reject(
        Object.assign(new Error('extension_runtime_in_use'), {
          code: 'extension_runtime_in_use',
          cause: error,
        })
      )
    );
    server.listen(
      process.platform === 'win32'
        ? { path: `\\\\.\\pipe\\posnic-extension-lock-${digest.toString('hex')}`, exclusive: true }
        : { host: '127.0.0.1', port, exclusive: true },
      resolve
    );
  });
  server.unref();
  let closed = false;
  return {
    release: async () => {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
module.exports = { acquireRuntimeLock };
