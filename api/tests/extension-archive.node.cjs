'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stageExtensionArchive } = require('../src/services/extension-installation');
const { AssetUpdater } = require('../../src/asset-updater');
const { readExtensionArchive, MAX_ARCHIVE_BYTES } = require('../src/services/extension-archive');
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
test('a signed compressed ZIP verifies completely without extracting or executing it', async () => {
  const result = await readExtensionArchive(zip(signedEntries()), options);
  assert.equal(result.metadata.id, 'posnic.example');
  assert.equal(result.contents.get('worker.cjs').toString(), 'module.exports = {};');
  assert.equal(result.contents.size, 3);
  assert.match(result.packageDigest, /^[a-f0-9]{64}$/);
});
for (const name of [
  '../outside.cjs',
  'C:/outside.cjs',
  'dir\\bad.cjs',
  'CON.txt',
  'worker.CJS',
  'worker.cjs/nested',
]) {
  test(`reject unsafe or colliding archive name: ${name}`, async () => {
    await assert.rejects(readExtensionArchive(zip([...signedEntries(), { name }]), options));
  });
}
test('duplicates, symlinks, encrypted entries and unsupported compression are rejected', async () => {
  for (const extra of [
    { name: 'worker.cjs' },
    { name: 'link', attributes: (0o120777 << 16) >>> 0 },
    { name: 'device', attributes: (0o020666 << 16) >>> 0 },
    { name: 'secret', flags: 1 },
    { name: 'unsupported', method: 99 },
  ])
    await assert.rejects(readExtensionArchive(zip([...signedEntries(), extra]), options));
});
test('compressed expansion and input limits are enforced before staging', async () => {
  await assert.rejects(readExtensionArchive(Buffer.alloc(MAX_ARCHIVE_BYTES + 1), options), {
    code: 'extension_archive_size_invalid',
  });
  await assert.rejects(
    readExtensionArchive(
      zip([
        ...signedEntries(),
        {
          name: 'bomb',
          body: Buffer.alloc(21 * 1024 * 1024),
        },
      ]),
      options
    ),
    { code: 'extension_archive_expansion_limit' }
  );
  await assert.rejects(
    readExtensionArchive(
      zip([
        ...signedEntries(),
        {
          name: 'lying',
          body: Buffer.alloc(2 * 1024 * 1024),
          declaredSize: 1,
        },
      ]),
      options
    )
  );
});
test('truncated, unsigned, tampered and incompatible packages never pass the archive boundary', async () => {
  const good = signedEntries();
  await assert.rejects(readExtensionArchive(zip(good).subarray(0, -8), options));
  await assert.rejects(readExtensionArchive(zip(good), { ...options, capabilities: [] }), {
    code: 'extension_incompatible',
  });
  const bad = good.map((entry) =>
    entry.name === 'worker.cjs' ? { ...entry, body: Buffer.from('changed') } : entry
  );
  await assert.rejects(readExtensionArchive(zip(bad), options), { code: 'extension_hash_invalid' });
  await assert.rejects(
    readExtensionArchive(zip(good), {
      ...options,
      publicKey: crypto.generateKeyPairSync('ed25519').publicKey,
    })
  );
});

test('offline staging is immutable, repeatable and does not activate or replace an installed version', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-install-test-'));
  try {
    const root = path.join(directory, 'extensions');
    const bytes = zip(signedEntries());
    const first = await stageExtensionArchive(bytes, { ...options, root });
    assert.equal(first.existing, false);
    assert.equal(fs.existsSync(path.join(root, 'posnic.example', 'current')), false);
    assert.equal(
      fs.readFileSync(path.join(first.directory, 'worker.cjs'), 'utf8'),
      'module.exports = {};'
    );
    fs.writeFileSync(path.join(root, 'posnic.example', 'current'), 'previous-compatible-version');
    const second = await stageExtensionArchive(bytes, { ...options, root });
    assert.equal(second.existing, true);
    assert.equal(second.packageDigest, first.packageDigest);
    await assert.rejects(
      stageExtensionArchive(
        zip(signedEntries([{ name: 'extra.js', body: Buffer.from('another build') }])),
        { ...options, root }
      ),
      { code: 'extension_version_already_exists' }
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'posnic.example', 'current'), 'utf8'),
      'previous-compatible-version'
    );
    assert.deepEqual(fs.readdirSync(root), ['posnic.example']);
    assert.equal(fs.existsSync(path.join(first.directory, 'extra.js')), false);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
      'unsafe cleanup'
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid archive cannot create installation directories, and linked targets are refused', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-install-test-'));
  try {
    const root = path.join(directory, 'extensions');
    await assert.rejects(stageExtensionArchive(Buffer.from('not a zip'), { ...options, root }));
    assert.equal(fs.existsSync(root), false);
    const outside = path.join(directory, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(stageExtensionArchive(zip(signedEntries()), { ...options, root }), {
      code: 'extension_install_directory_invalid',
    });
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
      'unsafe cleanup'
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('activation queue persists only a verified package identity and rejects parameter tampering', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-queue-test-'));
  try {
    const root = path.join(directory, 'extensions');
    const installed = await stageExtensionArchive(zip(signedEntries()), { ...options, root });
    const queue = require('../src/services/extension-install-queue');
    const input = {
      root,
      publicKey: keys.publicKey,
      id: installed.id,
      version: installed.version,
      scope: { license: 'a'.repeat(24), branchId: 'b'.repeat(24) },
    };
    for (const patch of [
      { id: [installed.id] },
      { version: [installed.version] },
      { id: '../outside' },
    ]) {
      assert.throws(() => queue.queue({ ...input, ...patch }), /extension_install_queue_invalid/);
    }
    assert.equal(fs.existsSync(path.join(root, '.activation-request.json')), false);
    const result = queue.queue(input);
    assert.deepEqual(result, {
      id: installed.id,
      version: installed.version,
      license: input.scope.license,
      branchId: input.scope.branchId,
      packageDigest: installed.packageDigest,
    });
    assert.deepEqual(queue.read(root), result);
    assert.deepEqual(queue.queue(input), result);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
      'unsafe cleanup'
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
