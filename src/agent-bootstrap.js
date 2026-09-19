'use strict';

// Public installers acquire the private sync component only after activation.
// The device token authorizes the download; the embedded signing key, rather
// than the server response, authorizes the code that may run on this till.
const fs = require('fs');
const path = require('path');
const { loadTree, extractZip } = require('./asset-channel');

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

async function installAgent({ config, engine, sevenZip, fetch: request = globalThis.fetch,
  extract = (zip, dest) => extractZip(sevenZip, zip, dest) }) {
  if (!engine || !engine.publicKey) throw new Error('Cloud setup verification is unavailable. Reinstall the latest Posnic app.');
  const base = new URL(config.gatewayUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new Error('Cloud setup requires a secure server address.');
  }
  const headers = { authorization: `Bearer ${config.deviceToken}` };
  const options = (timeout) => ({ headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  const url = base.href.replace(/\/+$/, '');
  const response = await request(`${url}/v1/agent-release`, options(30_000));
  if (!response.ok || response.status === 204) {
    throw new Error('The cloud sync component is unavailable. Please retry or contact support.');
  }
  const info = await response.json();
  const manifest = info && info.manifest;
  if (!manifest || !/^\d+\.\d+\.\d+$/.test(info.version) || manifest.version !== info.version || manifest.kind !== 'agent'
      || !engine.verifyManifest(manifest).ok
      || !manifest.files.some((file) => file.path === 'src/index.js')) {
    throw new Error('The cloud sync component could not be verified. Please contact support.');
  }

  const bundle = await request(`${url}/v1/agent-release/bundle`, options(120_000));
  if (!bundle.ok) throw new Error('The cloud sync download failed. Please retry.');
  if (Number(bundle.headers.get('content-length')) > MAX_BUNDLE_BYTES) throw new Error('The cloud sync download is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of bundle.body) {
    size += chunk.length;
    if (size > MAX_BUNDLE_BYTES) throw new Error('The cloud sync download is too large.');
    chunks.push(Buffer.from(chunk));
  }
  fs.mkdirSync(engine.root, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(engine.root, 'bootstrap-'));
  try {
    const zip = path.join(temporary, 'bundle.zip');
    const tree = path.join(temporary, 'tree');
    fs.writeFileSync(zip, Buffer.concat(chunks));
    fs.mkdirSync(tree);
    await extract(zip, tree);
    const staged = engine.stage(manifest, loadTree(tree, tree));
    if (!staged.ok) throw new Error('The cloud sync download failed verification. Please retry.');
    const active = engine.activate(manifest.version);
    if (!active.ok) throw new Error('The cloud sync component could not be installed. Please retry.');
    return manifest.version;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { installAgent };
