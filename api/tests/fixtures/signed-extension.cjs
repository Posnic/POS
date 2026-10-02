'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { AssetUpdater } = require('../../../src/asset-updater');
const keys = crypto.generateKeyPairSync('ed25519');
const options = { publicKey: keys.publicKey, capabilities: ['namespace.commands.v1'] };
// Small ZIP fixture writer: deliberately permits malformed metadata for
// boundary tests. Production packaging must not use this helper.
function zip(entries) {
  const local = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      body = entry.body || Buffer.from('x');
    const method = entry.method ?? 8;
    const compressed = method === 8 ? zlib.deflateRawSync(body) : body;
    const header = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags || 0, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(zlib.crc32(body), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.declaredSize ?? body.length, 22);
    header.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x0314, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(entry.attributes ?? (0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    central.push(directory, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function signedEntries(extra = []) {
  const metadata = {
    id: 'posnic.example',
    version: '1.0.0',
    manifestVersion: 1,
    apiVersion: 1,
    entrypoint: 'worker.cjs',
    initialState: 'state.json',
    commands: { 'payment.confirmCash': ['write'] },
    requiredCapabilities: ['namespace.commands.v1'],
  };
  const entries = [
    { name: 'extension.json', body: Buffer.from(JSON.stringify(metadata)) },
    { name: 'state.json', body: Buffer.from('{}') },
    { name: 'worker.cjs', body: Buffer.from('module.exports = {};') },
    ...extra,
  ];
  const manifest = {
    kind: 'extension:posnic.example',
    version: '1.0.0',
    files: entries.map((entry) => ({ path: entry.name, sha256: AssetUpdater.hash(entry.body) })),
  };
  manifest.signature = crypto
    .sign(null, Buffer.from(AssetUpdater.signedPayload(manifest)), keys.privateKey)
    .toString('base64');
  return [...entries, { name: 'manifest.json', body: Buffer.from(JSON.stringify(manifest)) }];
}
module.exports = { zip, signedEntries, options };