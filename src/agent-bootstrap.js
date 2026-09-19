'use strict';

// Public installers acquire the private sync component only after activation.
// The device token authorizes the download; the embedded signing key, rather
// than the server response, authorizes the code that may run on this till.
const unzipper = require('unzipper');
const { AssetUpdater } = require('./asset-updater');
const { cloudServerUrl } = require('./cloud-activation');

const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

async function readVerifiedContents(bytes, manifest, open = unzipper.Open.buffer) {
  const directory = await open(bytes);
  const expected = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  const contents = new Map();
  let totalBytes = 0;
  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;
    if (!expected.has(entry.path) || contents.has(entry.path)) {
      throw new Error('The cloud sync archive contains an unexpected or repeated file.');
    }
    if (entry.uncompressedSize > MAX_BUNDLE_BYTES) throw new Error('The cloud sync file is too large.');
    const parts = [];
    let fileBytes = 0;
    for await (const part of entry.stream()) {
      fileBytes += part.length;
      totalBytes += part.length;
      if (fileBytes > MAX_BUNDLE_BYTES || totalBytes > 2 * MAX_BUNDLE_BYTES) {
        throw new Error('The cloud sync archive is too large.');
      }
      parts.push(part);
    }
    const content = Buffer.concat(parts);
    if (AssetUpdater.hash(content) !== expected.get(entry.path)) {
      throw new Error('The cloud sync download failed verification. Please retry.');
    }
    contents.set(entry.path, content);
  }
  if (contents.size !== expected.size) throw new Error('The cloud sync archive is incomplete. Please retry.');
  return contents;
}

async function installAgent({ config, engine, fetch: request = globalThis.fetch,
  open = unzipper.Open.buffer }) {
  if (!engine || !engine.publicKey) throw new Error('Cloud setup verification is unavailable. Reinstall the latest Posnic app.');
  const url = cloudServerUrl(config.gatewayUrl);
  const headers = { authorization: `Bearer ${config.deviceToken}` };
  const options = (timeout) => ({ headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
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
  // No unverified archive or extracted file is written to disk. Only files
  // named by the signed manifest, with matching hashes, reach the stager.
  const contents = await readVerifiedContents(Buffer.concat(chunks), manifest, open);
  const staged = engine.stage(manifest, contents);
  if (!staged.ok) throw new Error('The cloud sync download failed verification. Please retry.');
  const active = engine.activate(manifest.version);
  if (!active.ok) throw new Error('The cloud sync component could not be installed. Please retry.');
  return manifest.version;
}

module.exports = { installAgent, readVerifiedContents };
