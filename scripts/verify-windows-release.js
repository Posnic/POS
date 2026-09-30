'use strict';

// Verifies externally built, card-signed packages. This is verification
// provenance, not a claim that a GitHub runner compiled the Windows binaries.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const REPO = 'Posnic/POS';
const MANIFEST = 'WINDOWS-RELEASE.json';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function expectedNames(version) {
  const installer = `Posnic-${version}-windows-x64-installer.exe`;
  const portable = `Posnic-${version}-windows-x64-portable.exe`;
  return [installer, portable, `${installer}.cdx.json`, `${portable}.cdx.json`,
    `${installer}.blockmap`, 'latest.yml'].sort();
}

function validateManifest(bytes, { tag, commit, digest }) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(sha256(bytes), digest, 'Manifest digest differs from approved input');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.repository, REPO);
  assert.equal(manifest.tag, tag);
  assert.equal(manifest.sourceCommit, commit);
  assert.equal(manifest.buildOrigin, 'local-certum-card');
  assert.ok(Array.isArray(manifest.files));
  assert.deepEqual(manifest.files.map(file => file.name).sort(), expectedNames(tag.slice(1)),
    'Manifest must contain exactly the Windows release files; paths and duplicates are forbidden');
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0 && file.size < 2 ** 31);
  }
  return manifest;
}

function verifyFiles(directory, manifest) {
  const checksums = [];
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, file.name));
    assert.equal(bytes.length, file.size, `Size mismatch: ${file.name}`);
    assert.equal(sha256(bytes), file.sha256, `Digest mismatch: ${file.name}`);
    checksums.push(`${file.sha256}  ${file.name}`);
    if (!file.name.endsWith('.exe')) continue;
    const sbom = JSON.parse(fs.readFileSync(path.join(directory, `${file.name}.cdx.json`)));
    assert.equal(sbom.bomFormat, 'CycloneDX');
    const component = sbom.metadata.component;
    const property = name => component.properties.find(p => p.name === name)?.value;
    assert.equal(component.hashes.find(h => h.alg === 'SHA-256')?.content, file.sha256);
    assert.equal(property('posnic:artifact:file-name'), file.name);
    assert.equal(property('posnic:source:commit'), manifest.sourceCommit);
    assert.equal(component.version, manifest.tag.slice(1));
  }
  const yaml = fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8');
  const installer = `Posnic-${manifest.tag.slice(1)}-windows-x64-installer.exe`;
  const bytes = fs.readFileSync(path.join(directory, installer));
  assert.equal(/^version: (.+)$/m.exec(yaml)?.[1].trim(), manifest.tag.slice(1));
  assert.equal(/^path: (.+)$/m.exec(yaml)?.[1].trim(), installer);
  assert.equal(/^  - url: (.+)$/m.exec(yaml)?.[1].trim(), installer);
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  assert.equal(/^sha512: (.+)$/m.exec(yaml)?.[1].trim(), sha512);
  assert.equal(/^    sha512: (.+)$/m.exec(yaml)?.[1].trim(), sha512);
  assert.equal(Number(/^    size: (\d+)$/m.exec(yaml)?.[1]), bytes.length);
  return checksums.sort().join('\n') + '\n';
}

function predicate(manifest, digest, env) {
  return {
    buildDefinition: {
      buildType: 'https://posnic.com/build-types/local-windows-release-verification/v1',
      externalParameters: { repository: REPO, tag: manifest.tag, sourceCommit: manifest.sourceCommit,
        manifestSha256: digest, buildOrigin: manifest.buildOrigin,
        scope: 'Verification of externally built and signed files; not a GitHub-hosted build or reproducible-build claim' },
      internalParameters: {},
      resolvedDependencies: [{ uri: `git+https://github.com/${REPO}@refs/tags/${manifest.tag}`,
        digest: { gitCommit: manifest.sourceCommit } }],
    },
    runDetails: {
      builder: { id: `https://github.com/${REPO}/.github/workflows/windows-release-verify.yml@refs/heads/main` },
      metadata: { invocationId: `https://github.com/${REPO}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}` },
    },
  };
}

function main() {
  const { RELEASE_TAG: tag, RELEASE_COMMIT: commit, MANIFEST_SHA256: digest } = process.env;
  assert.match(tag || '', /^v\d+\.\d+\.\d+$/);
  assert.match(commit || '', /^[a-f0-9]{40}$/);
  assert.match(digest || '', /^[a-f0-9]{64}$/);
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', windowsHide: true });
  const release = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'isDraft,tagName']));
  assert.equal(release.isDraft, true, 'Only unpublished drafts can be verified');
  assert.equal(release.tagName, tag);
  const source = JSON.parse(gh(['api', `repos/${REPO}/commits/${tag}`]));
  assert.equal(source.sha, commit, 'Tag does not resolve to the expected source');
  const directory = path.resolve('windows-release');
  fs.mkdirSync(directory, { recursive: true });
  const download = name => gh(['release', 'download', tag, '--repo', REPO, '--pattern', name, '--dir', directory]);
  download(MANIFEST);
  const manifest = validateManifest(fs.readFileSync(path.join(directory, MANIFEST)), { tag, commit, digest });
  for (const file of manifest.files) download(file.name);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), verifyFiles(directory, manifest));
  fs.writeFileSync(path.join(directory, 'verification-predicate.json'), JSON.stringify(predicate(manifest, digest, process.env), null, 2));
  console.log('Windows hashes, source declaration, SBOMs and updater metadata verified. Signature verification runs next.');
}

if (require.main === module) main();
module.exports = { expectedNames, validateManifest, verifyFiles, predicate, sha256 };
