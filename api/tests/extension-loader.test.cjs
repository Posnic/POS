'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AssetUpdater } = require('../../src/asset-updater');
const { loadVerifiedDirectory } = require('../src/services/extension-package-loader');
test('verified worker loads offline with no inherited database or payment secrets', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-extension-test-'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const prior = process.env.POSNIC_TEST_SECRET;
  process.env.POSNIC_TEST_SECRET = 'do-not-forward';
  try {
    const metadata = {
      id: 'posnic.example',
      version: '1.0.0',
      manifestVersion: 1,
      apiVersion: 1,
      requiredCapabilities: ['namespace.commands.v1'],
      entrypoint: 'worker.cjs',
      initialState: 'state.json',
      commands: { add: ['write'] },
    };
    const files = new Map([
      ['extension.json', Buffer.from(JSON.stringify(metadata))],
      ['state.json', Buffer.from('{}')],
      [
        'worker.cjs',
        Buffer.from(
          'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify({ok:true,result:{secretVisible:Boolean(process.env.POSNIC_TEST_SECRET),mongoVisible:Boolean(process.env.MONGODB_URI)}})))'
        ),
      ],
    ]);
    const manifest = {
      version: metadata.version,
      kind: `extension:${metadata.id}`,
      files: [...files].map(([path, bytes]) => ({ path, sha256: AssetUpdater.hash(bytes) })),
    };
    manifest.signature = crypto
      .sign(null, Buffer.from(AssetUpdater.signedPayload(manifest)), keys.privateKey)
      .toString('base64');
    for (const [name, bytes] of files) fs.writeFileSync(path.join(directory, name), bytes);
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    const verified = loadVerifiedDirectory(directory, keys.publicKey, ['namespace.commands.v1']);
    assert.deepEqual(await verified.descriptor.plan({}), {
      secretVisible: false,
      mongoVisible: false,
    });
    fs.writeFileSync(path.join(directory, 'extra.js'), 'unlisted executable');
    assert.throws(
      () => loadVerifiedDirectory(directory, keys.publicKey, ['namespace.commands.v1']),
      /extension_unlisted_file/
    );
    fs.unlinkSync(path.join(directory, 'extra.js'));
    fs.appendFileSync(path.join(directory, 'worker.cjs'), '// changed');
    assert.throws(
      () => loadVerifiedDirectory(directory, keys.publicKey, ['namespace.commands.v1']),
      /extension_hash_invalid/
    );
  } finally {
    if (prior === undefined) delete process.env.POSNIC_TEST_SECRET;
    else process.env.POSNIC_TEST_SECRET = prior;
    // This exact path was created above below the OS temporary directory.
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('unsafe cleanup');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
