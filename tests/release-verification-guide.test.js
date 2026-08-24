const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const GUIDE = fs.readFileSync(path.join(ROOT, 'docs', 'VERIFY_RELEASE.md'), 'utf8');
const RUNBOOK = fs.readFileSync(path.join(ROOT, 'docs', 'RELEASE_RUNBOOK.md'), 'utf8');
const RELEASE_WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const BETA_WORKFLOW = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'beta.yml'), 'utf8');

function publisherJob(workflow) {
  const start = workflow.indexOf('\n  publish:');
  assert.notStrictEqual(start, -1, 'workflow has no publish job');
  return workflow.slice(start);
}

test('the install path links to the public verification procedure', () => {
  assert.match(README, /\[release verification guide\]\(docs\/VERIFY_RELEASE\.md\)/i);
  assert.match(README, /For releases that provide an\s+artifact-bound SBOM and provenance/);
  assert.match(README, /\[Release verification\]\(docs\/VERIFY_RELEASE\.md\)/);
});

test('Windows and Unix users can verify the package checksum', () => {
  assert.match(GUIDE, /Get-FileHash -Algorithm SHA256/);
  assert.match(GUIDE, /shasum -a 256/);
  assert.match(GUIDE, /Checksum mismatch/);
});

test('the guide binds the SBOM to both artifact hash and filename', () => {
  assert.match(GUIDE, /metadata\.component\.hashes/);
  assert.match(GUIDE, /posnic:artifact:file-name/);
  assert.match(GUIDE, /SBOM does not describe/);
});

test('provenance is verified for the artifact and SBOM separately', () => {
  assert.match(GUIDE, /gh attestation verify "\$artifact" -R Posnic\/POS/);
  assert.match(GUIDE, /gh attestation verify "\$artifact\.cdx\.json" -R Posnic\/POS/);
});

test('release publishers attest the exact checksum subjects before upload', () => {
  for (const workflow of [RELEASE_WORKFLOW, BETA_WORKFLOW]) {
    const publisher = publisherJob(workflow);
    assert.match(publisher, /id-token:\s*write/);
    assert.match(publisher, /attestations:\s*write/);
    assert.match(publisher, /artifact-metadata:\s*write/);
    assert.match(publisher, /uses:\s*actions\/attest@[0-9a-f]{40}\s+# v4\.2\.2/);
    assert.match(publisher, /subject-checksums:\s*release\/SHA256SUMS\.txt/);

    const checksum = publisher.indexOf('sha256sum');
    const attestation = publisher.indexOf('uses: actions/attest@');
    const publication = publisher.indexOf('uses: softprops/action-gh-release@');
    assert.ok(checksum < attestation, 'attestation runs before the checksum subjects exist');
    assert.ok(attestation < publication, 'release assets are published before provenance exists');
  }
});

test('beta publication keeps builder diagnostics out of release assets', () => {
  const publisher = publisherJob(BETA_WORKFLOW);
  assert.match(BETA_WORKFLOW, /builder-debug\.yml is build diagnostics, not updater input/);
  assert.match(BETA_WORKFLOW, /shopt -s nullglob/);
  assert.match(BETA_WORKFLOW, /latest_manifests=\(dist\/latest\*\.yml\)/);
  assert.match(BETA_WORKFLOW, /if \(\( \$\{#latest_manifests\[@\]\} == 0 \)\)/);
  assert.match(BETA_WORKFLOW, /dist\/latest\*\.yml/);
  assert.doesNotMatch(BETA_WORKFLOW, /dist\/\*\.yml/);
  assert.match(publisher, /-name 'latest\*\.yml'/);
  assert.doesNotMatch(publisher, /-name '\*\.yml'/);
});

test('the guide does not promote inventory or provenance into a security claim', () => {
  assert.match(GUIDE, /Older releases may predate the SBOM and provenance workflow/);
  assert.match(GUIDE, /cannot be counted as checks\s+that passed/);
  assert.match(GUIDE, /inventory, not legal advice/i);
  assert.match(GUIDE, /does not establish/);
  assert.match(GUIDE, /vulnerability-free/);
  assert.match(GUIDE, /independent review or reproducible builds/);
});

test('the release checklist blocks publication on missing trust artifacts', () => {
  assert.match(RUNBOOK, /Every `\.exe`, `\.dmg`, `\.zip`, `\.AppImage` and `\.deb` has a matching/);
  assert.match(RUNBOOK, /both files must appear in\s+`SHA256SUMS\.txt`/);
  assert.match(RUNBOOK, /gh attestation verify <artifact> -R Posnic\/POS/);
  assert.match(RUNBOOK, /missing provenance record means stop/);
});
