const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'codemeta.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('CodeMeta declares a current SoftwareSourceCode identity', () => {
  assert.equal(metadata['@context'], 'https://w3id.org/codemeta/3.0');
  assert.equal(metadata['@type'], 'SoftwareSourceCode');
  assert.equal(metadata['@id'], 'https://github.com/Posnic/POS');
  assert.equal(metadata.name, 'Posnic POS');
  assert.match(metadata.description, /point-of-sale software/i);
  assert.match(metadata.description, /AGPL-3\.0-only/i);
  assert.match(metadata.description, /separately licensed components/i);
  assert.equal(metadata.version, pkg.version);
  assert.equal(metadata.softwareVersion, pkg.version);
  assert.deepEqual(metadata.keywords, pkg.keywords);
});

test('CodeMeta keeps source, support and licence identity canonical', () => {
  assert.equal(metadata.url, pkg.homepage);
  assert.equal(metadata.codeRepository, 'https://github.com/Posnic/POS');
  assert.equal(metadata.issueTracker, pkg.bugs.url);
  assert.equal(metadata.license, 'https://spdx.org/licenses/AGPL-3.0-only.html');
  assert.equal(metadata.readme, 'https://github.com/Posnic/POS/blob/main/README.md');
  assert.equal(
    metadata.continuousIntegration,
    'https://github.com/Posnic/POS/actions',
  );
  assert.equal(metadata.author?.name, 'Posnic Innovations Private Limited');
  assert.equal(metadata.author?.url, 'https://posnic.com/about');
  assert.equal(metadata.publisher?.name, metadata.author?.name);
});

test('CodeMeta identifies point-of-sale scope without promoting development as released', () => {
  assert.equal(metadata.applicationSubCategory, 'Point of sale software');
  assert.deepEqual(metadata.operatingSystem, ['Windows', 'macOS', 'Linux']);
  assert.deepEqual(metadata.runtimePlatform, ['Electron', 'Node.js', 'MongoDB']);
  assert.equal(metadata.isSourceCodeOf?.['@type'], 'SoftwareApplication');
  assert.equal(metadata.isSourceCodeOf?.name, 'Posnic POS');
  assert.equal(metadata.isSourceCodeOf?.url, 'https://posnic.com/');
  assert.match(metadata.developmentStatus, /active development/i);
  assert.match(metadata.developmentStatus, /not a tagged release/i);
  assert.doesNotMatch(JSON.stringify(metadata), /aggregateRating|reviewRating|customer count/i);
});

test('public repository discovery surfaces both machine-readable metadata files', () => {
  assert.match(readme, /\[CodeMeta metadata\]\(codemeta\.json\)/);
  assert.match(readme, /\[Citation metadata\]\(CITATION\.cff\)/);
  assert.ok(metadata.citation.includes(
    'https://github.com/Posnic/POS/blob/main/CITATION.cff',
  ));
  assert.ok(metadata.relatedLink.includes(
    'https://github.com/Posnic/POS/blob/main/docs/ADOPTION_EVIDENCE.md',
  ));
});
