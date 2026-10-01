'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { expectedNames, validateManifest, verifyFiles, predicate, sha256 } = require('../scripts/verify-windows-release');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-release-verification-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const tag = 'v1.9.0', commit = 'a'.repeat(40);
  const names = expectedNames(tag.slice(1));
  const installer = names.find(name => name.endsWith('-installer.exe'));
  for (const name of names) fs.writeFileSync(path.join(directory, name), 'inert test fixture');
  for (const name of names.filter(name => name.endsWith('.exe'))) {
    fs.writeFileSync(path.join(directory, `${name}.cdx.json`), JSON.stringify({
      bomFormat: 'CycloneDX', metadata: { component: {
        version: tag.slice(1), hashes: [{ alg: 'SHA-256', content: sha256(fs.readFileSync(path.join(directory, name))) }],
        properties: [{ name: 'posnic:artifact:file-name', value: name }, { name: 'posnic:source:commit', value: commit }],
      } },
    }));
  }
  const bytes = fs.readFileSync(path.join(directory, installer));
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  fs.writeFileSync(path.join(directory, 'latest.yml'), `version: 1.9.0\nfiles:\n  - url: ${installer}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${installer}\nsha512: ${sha512}\n`);
  const manifest = { schemaVersion: 1, repository: 'Posnic/POS', tag, sourceCommit: commit, buildOrigin: 'local-certum-card',
    files: names.map(name => { const contents = fs.readFileSync(path.join(directory, name)); return { name, size: contents.length, sha256: sha256(contents) }; }) };
  const options = value => ({ tag, commit, digest: sha256(Buffer.from(JSON.stringify(value))) });
  return { directory, manifest, options, validate: value => validateManifest(Buffer.from(JSON.stringify(value)), options(value)) };
}

test('accepts matching artifacts and binds both packages, SBOMs and updater files', t => {
  const f = fixture(t);
  assert.equal(f.validate(f.manifest).sourceCommit, f.manifest.sourceCommit);
  assert.equal(verifyFiles(f.directory, f.manifest).trim().split('\n').length, 6);
});

for (const mutation of ['digest', 'source', 'traversal', 'duplicate', 'missing', 'size']) {
  test(`rejects invalid manifest: ${mutation}`, t => {
    const f = fixture(t), m = structuredClone(f.manifest);
    if (mutation === 'digest') {
      assert.throws(() => validateManifest(Buffer.from(JSON.stringify(m)), { ...f.options(m), digest: '0'.repeat(64) }));
      return;
    }
    if (mutation === 'source') m.sourceCommit = 'b'.repeat(40);
    if (mutation === 'traversal') m.files[0].name = '../payload.exe';
    if (mutation === 'duplicate') m.files[0].name = m.files[1].name;
    if (mutation === 'missing') m.files.pop();
    if (mutation === 'size') m.files[0].size = -1;
    assert.throws(() => f.validate(m));
  });
}

test('rejects a changed artifact even when its name remains unchanged', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.directory, f.manifest.files[0].name), 'tampered');
  assert.throws(() => verifyFiles(f.directory, f.manifest));
});

for (const mutation of ['source', 'hash', 'filename', 'updater']) {
  test(`rejects internally inconsistent metadata even if approved hashes match: ${mutation}`, t => {
    const f = fixture(t);
    const name = mutation === 'updater' ? 'latest.yml' : f.manifest.files.find(file => file.name.endsWith('.cdx.json')).name;
    const file = path.join(f.directory, name);
    if (mutation === 'updater') fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('version: 1.9.0', 'version: 1.8.4'));
    else {
      const data = JSON.parse(fs.readFileSync(file));
      if (mutation === 'hash') data.metadata.component.hashes[0].content = '0'.repeat(64);
      else data.metadata.component.properties.find(p => p.name === (mutation === 'source' ? 'posnic:source:commit' : 'posnic:artifact:file-name')).value = 'wrong';
      fs.writeFileSync(file, JSON.stringify(data));
    }
    const entry = f.manifest.files.find(entry => entry.name === name), bytes = fs.readFileSync(file);
    entry.sha256 = sha256(bytes); entry.size = bytes.length;
    assert.throws(() => verifyFiles(f.directory, f.manifest));
  });
}

test('provenance explicitly identifies verification rather than a hosted build', t => {
  const f = fixture(t);
  const result = predicate(f.manifest, f.options(f.manifest).digest, { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' });
  assert.match(result.buildDefinition.buildType, /local-windows-release-verification/);
  assert.match(result.buildDefinition.externalParameters.scope, /not a GitHub-hosted build/);
  assert.equal(result.buildDefinition.resolvedDependencies[0].digest.gitCommit, f.manifest.sourceCommit);
});

test('hosted verifier and user instructions use the supported custom predicate type', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/windows-release-verify.yml'), 'utf8');
  const guide = fs.readFileSync(path.join(__dirname, '../docs/VERIFY_RELEASE.md'), 'utf8');
  const type = 'https://posnic.com/attestations/windows-release-verification/v1';
  assert.ok(workflow.includes(`predicate-type: ${type}`));
  assert.ok(guide.includes(`--predicate-type ${type}`));
  assert.ok(!workflow.includes('predicate-type: https://slsa.dev/provenance/v1'));
});
