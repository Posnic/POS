'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const verses = require('../data/thirukkural/verses.json');
const qr = require('../data/thirukkural/qr.json');
const URL = 'https://www.posnic.com/assets/thirukural/thirukural.v1.json';
const HASH = '6dab3e8267124f0e078bf3ecaadf30a3f8b18c6aab52d485e9f649a953f91522';
const cacheDir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'Posnic', 'public-content');
let loaded;
function validate(bytes) {
  if (
    bytes.length > 8 * 1024 * 1024 ||
    crypto.createHash('sha256').update(bytes).digest('hex') !== HASH
  )
    throw new Error('Thirukkural download did not match the reviewed edition.');
  const data = JSON.parse(bytes.toString('utf8'));
  if (
    data.schemaVersion !== 1 ||
    data.entries.length !== 1330 ||
    data.entries.some(
      (v, i) =>
        v.number !== i + 1 ||
        JSON.stringify(v.lines) !== JSON.stringify(verses[i].lines) ||
        v.qr !== qr[i]
    )
  )
    throw new Error('Invalid Thirukkural library.');
  return data.entries;
}
function entries() {
  if (!loaded) {
    try {
      loaded = validate(fs.readFileSync(path.join(cacheDir, 'thirukural.v1.json')));
    } catch (_) {
      loaded = verses.map((v, i) => ({ ...v, qr: qr[i] }));
    }
  }
  return loaded;
}
async function install({ fetcher = global.fetch, directory = cacheDir } = {}) {
  const target = path.join(directory, 'thirukural.v1.json');
  try {
    const data = validate(fs.readFileSync(target));
    loaded = data;
    return { source: 'downloaded', cached: true };
  } catch (_) {
    /* fetch verified edition */
  }
  let temporary;
  try {
    const response = await fetcher(URL, { redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('Library download unavailable.');
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) throw new Error('Library exceeds download limit.');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks),
      data = validate(bytes);
    fs.mkdirSync(directory, { recursive: true });
    temporary = target + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
    loaded = data;
    return { source: 'downloaded', cached: false };
  } catch (_) {
    if (temporary)
      try {
        fs.unlinkSync(temporary);
      } catch (_) {
        /* no temporary file */
      }
    return {
      source: 'bundled',
      warning:
        'Website library unavailable or unverified. Using the bundled Thirukkural edition offline.',
    };
  }
}
module.exports = { entries, install, validate, URL, HASH };
