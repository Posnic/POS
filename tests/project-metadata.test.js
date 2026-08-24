const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'codemeta.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('CodeMeta preserves the canonical Posnic product identity', () => {
  assert.equal(metadata['@context'], 'https://w3id.org/codemeta/3.0');
  assert.equal(metadata['@type'], 'SoftwareSourceCode');
  assert.equal(metadata['@id'], 'https://github.com/Posnic/POS');
  assert.equal(metadata.name, 'Posnic POS');
  assert.equal(metadata.codeRepository, 'https://github.com/Posnic/POS');
  assert.equal(metadata.issueTracker, packageJson.bugs.url);
  assert.equal(metadata.url, packageJson.homepage);
});

test('CodeMeta states a version, and it cannot drift from package.json', () => {
  // Machine-readable identity without a version is far less useful: indexers
  // and citation tools key on it, and "which release is this describing?" has
  // no answer without it. Asserting equality rather than a literal is the point
  // - a hardcoded version in a second file is a stale version waiting to happen,
  // and this file already cross-checks issueTracker, url and author the same way.
  assert.equal(metadata.version, packageJson.version);
  assert.match(metadata.version, /^\d+\.\d+\.\d+/);

  // CITATION.cff describes the same release, and codemeta.json points straight
  // at it. Two identity files disagreeing about the version is worse than one
  // omitting it: a reader has no way to tell which is stale. Read with a regex
  // rather than a YAML parser to keep this test dependency-free.
  const citation = fs.readFileSync(path.join(root, 'CITATION.cff'), 'utf8');
  const cffVersion = /^version:\s*(.+)$/m.exec(citation);
  assert.ok(cffVersion, 'CITATION.cff states no version');
  assert.equal(cffVersion[1].trim().replace(/^['"]|['"]$/g, ''), packageJson.version);

  const cffLicense = /^license:\s*(.+)$/m.exec(citation);
  assert.equal(cffLicense[1].trim(), packageJson.license);
});

test('CodeMeta preserves the source licence and package-component boundary', () => {
  assert.equal(packageJson.license, 'AGPL-3.0-only');
  assert.equal(metadata.license, 'https://spdx.org/licenses/AGPL-3.0-only.html');
  assert.equal(metadata.isAccessibleForFree, true);
  assert.match(metadata.description, /separately licensed components/i);
  assert.match(metadata.description, /MongoDB Community Server under SSPL-1\.0/i);
});

test('CodeMeta publishes the verified publisher and supported platforms', () => {
  assert.equal(metadata.author.name, packageJson.author);
  assert.equal(metadata.publisher.name, packageJson.author);
  assert.deepEqual(metadata.operatingSystem, ['Windows', 'macOS', 'Linux']);
  assert.equal(metadata.maintainer.url, 'https://github.com/sridharkalaibala');
});

test('CodeMeta uses only secure canonical links', () => {
  const links = [
    metadata['@id'],
    metadata.author.url,
    metadata.publisher.url,
    metadata.maintainer.url,
    metadata.codeRepository,
    metadata.issueTracker,
    metadata.continuousIntegration,
    metadata.license,
    metadata.url,
    metadata.downloadUrl,
    metadata.softwareHelp,
    metadata.citation,
    ...metadata.relatedLink,
  ];

  for (const link of links) assert.match(link, /^https:\/\//);
  assert.equal(JSON.stringify(metadata).includes('posnic.io'), false);
});
