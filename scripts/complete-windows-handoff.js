'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const zlib = require('node:zlib');
const {expectedNames, validateManifest, verifyFiles, sha256} = require('./verify-windows-release');

async function completeHandoff(directory, version, commit) {
  const info = JSON.parse(fs.readFileSync(path.join(directory, 'BUILD-INFO.json')));
  assert.equal(info.version, version, 'Build version differs');
  assert.equal(info.commit, commit, 'Build source differs');
  const tag = `v${version}`;
  const manifest = {
    schemaVersion: 1, repository: 'Posnic/POS', tag, sourceCommit: commit,
    buildOrigin: 'local-certum-card',
    files: expectedNames(version).map(name => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return {name, sha256:sha256(bytes), size:bytes.length};
    }),
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const digest = sha256(bytes);
  validateManifest(bytes, {tag, commit, digest});
  verifyFiles(directory, manifest);
  const {buildBlockMap} = require('app-builder-lib/out/targets/blockmap/blockmap');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-blockmap-check-'));
  try {
    const installer = path.join(directory, `Posnic-${version}-windows-x64-installer.exe`);
    const regenerated = path.join(scratch, 'installer.blockmap');
    await buildBlockMap(installer, 'gzip', regenerated);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(fs.readFileSync(installer + '.blockmap'))),
      JSON.parse(zlib.gunzipSync(fs.readFileSync(regenerated))), 'Installer blockmap differs from final signed bytes');
  } finally {fs.rmSync(scratch, {recursive:true, force:true});}
  fs.writeFileSync(path.join(directory, 'WINDOWS-RELEASE.json'), bytes);
  const files = [...expectedNames(version), 'BUILD-INFO.json', 'WINDOWS-RELEASE.json'].sort();
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), files.map(name =>
    `${sha256(fs.readFileSync(path.join(directory, name)))}  ${name}`
  ).join('\n') + '\n');
  return digest;
}
if (require.main === module) {
  completeHandoff(...process.argv.slice(2)).then(digest => console.log('Verified complete Windows manifest SHA-256: ' + digest))
    .catch(error => {console.error(error);process.exitCode = 1;});
}
module.exports = {completeHandoff};
