const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pkg = require('../package.json');
const {
  artifactIdentity,
  buildSbom,
  discoverArtifacts,
  readElectronVersion,
  readMongoVersion,
} = require('../scripts/generate-release-sboms');

const ROOT = path.join(__dirname, '..');
const RELEASE_WORKFLOW = fs
  .readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8')
  .replace(/\r\n/g, '\n');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const API_REF = 'pkg:npm/posnic-api@2.0.0';
const EXPRESS_REF = 'pkg:npm/express@5.2.1';
const API_BOM = {
  $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: 'urn:uuid:11111111-1111-4111-8111-111111111111',
  version: 1,
  metadata: {
    timestamp: '2026-08-23T00:00:00.000Z',
    tools: { components: [{ type: 'application', name: 'npm', version: '11.17.0' }] },
    component: {
      type: 'application',
      name: 'posnic-api',
      version: '2.0.0',
      'bom-ref': API_REF,
      purl: API_REF,
      licenses: [{ license: { id: 'AGPL-3.0-only' } }],
    },
  },
  components: [
    {
      type: 'library',
      name: 'express',
      version: '5.2.1',
      'bom-ref': EXPRESS_REF,
      purl: EXPRESS_REF,
      licenses: [{ license: { id: 'MIT' } }],
    },
  ],
  dependencies: [
    { ref: API_REF, dependsOn: [EXPRESS_REF] },
    { ref: EXPRESS_REF, dependsOn: [] },
  ],
};

function withTempDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-sbom-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('artifact identity is explicit for every release format', () => {
  assert.deepStrictEqual(
    artifactIdentity('Posnic-1.4.0-windows-x64-installer.exe'),
    { platform: 'windows', architecture: 'x86_64', format: 'installer' },
  );
  assert.deepStrictEqual(
    artifactIdentity('Posnic-1.4.0-macos-arm64.dmg'),
    { platform: 'macos', architecture: 'arm64', format: 'disk-image' },
  );
  assert.deepStrictEqual(
    artifactIdentity('Posnic-1.4.0-linux-x64.AppImage'),
    { platform: 'linux', architecture: 'x86_64', format: 'appimage' },
  );
  assert.deepStrictEqual(
    artifactIdentity('posnic_1.4.0_amd64.deb'),
    { platform: 'linux', architecture: 'x86_64', format: 'debian-package' },
  );
});

test('artifact discovery ignores updater metadata and generated SBOMs', () => withTempDir((directory) => {
  for (const name of [
    'Posnic-1.4.0-windows-x64-installer.exe',
    'Posnic-1.4.0-macos-arm64.dmg',
    'Posnic-1.4.0-linux-x64.AppImage',
    'latest.yml',
    'installer.exe.blockmap',
    'installer.exe.cdx.json',
  ]) fs.writeFileSync(path.join(directory, name), name);

  assert.deepStrictEqual(
    discoverArtifacts(directory).map((file) => path.basename(file)),
    [
      'Posnic-1.4.0-linux-x64.AppImage',
      'Posnic-1.4.0-macos-arm64.dmg',
      'Posnic-1.4.0-windows-x64-installer.exe',
    ],
  );
}));

test('the SBOM is deterministic and bound to the exact artifact', () => withTempDir((directory) => {
  const artifactPath = path.join(directory, 'Posnic-1.4.0-windows-x64-installer.exe');
  fs.writeFileSync(artifactPath, 'representative release artifact\n');
  const options = {
    artifactPath,
    apiBom: API_BOM,
    rootPackage: pkg,
    commit: COMMIT,
    mongoVersion: readMongoVersion(),
    electronVersion: readElectronVersion(pkg),
  };
  const first = buildSbom(options);
  const second = buildSbom(options);

  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assert.match(first.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.strictEqual(first.metadata.timestamp, undefined);
  assert.strictEqual(first.metadata.component.hashes[0].alg, 'SHA-256');
  assert.strictEqual(first.metadata.component.hashes[0].content.length, 64);
  assert.strictEqual(
    first.metadata.component.properties.find((property) => property.name === 'posnic:source:commit').value,
    COMMIT,
  );
  assert.match(
    first.metadata.component.properties.find((property) => property.name === 'posnic:licensing:scope').value,
    /Mixed-license aggregate/,
  );

  const components = new Map(first.components.map((component) => [component['bom-ref'], component]));
  assert.ok(components.has(API_REF), 'the packaged API root component was dropped');
  assert.ok(components.has(EXPRESS_REF), 'the API dependency graph was dropped');
  assert.strictEqual(
    components.get('pkg:generic/mongodb-community-server@7.0.14').licenses[0].license.id,
    'SSPL-1.0',
  );
  assert.strictEqual(
    components.get(`pkg:github/Posnic/POS@v${pkg.version}`).licenses[0].license.id,
    'AGPL-3.0-only',
  );

  const rootDependency = first.dependencies.find((dependency) => dependency.ref === first.serialNumber);
  assert.ok(rootDependency.dependsOn.includes(API_REF));
  assert.ok(rootDependency.dependsOn.includes('pkg:generic/mongodb-community-server@7.0.14'));
}));

test('the bundled component versions come from release inputs, not guesses', () => {
  assert.strictEqual(readMongoVersion(), '7.0.14');
  assert.match(readElectronVersion(pkg), /^43\./);
});

test('license material is readable outside app.asar on every platform', () => {
  const expected = new Map([
    ['LICENSE', 'licenses/POSNIC-AGPL-3.0.txt'],
    ['THIRD-PARTY-NOTICES.md', 'licenses/THIRD-PARTY-NOTICES.md'],
    ['licenses/MONGODB-SSPL-1.0.txt', 'licenses/MONGODB-SSPL-1.0.txt'],
  ]);
  const resources = new Map(pkg.build.extraResources.map((resource) => [resource.from, resource.to]));

  for (const [source, destination] of expected) {
    assert.strictEqual(resources.get(source), destination, `${source} is not package-visible at ${destination}`);
    assert.ok(fs.existsSync(path.join(ROOT, source)), `${source} does not exist`);
  }

  const mongoLicense = fs.readFileSync(path.join(ROOT, 'licenses/MONGODB-SSPL-1.0.txt'), 'utf8');
  assert.match(mongoLicense, /Server Side Public License/);
  assert.match(mongoLicense, /VERSION 1, OCTOBER 16, 2018/);
  assert.ok(mongoLicense.length > 30000, 'the exact MongoDB licence text is incomplete');
});

test('the release creates and preserves one SBOM beside each artifact', () => {
  const generatedAt = RELEASE_WORKFLOW.indexOf('Generate artifact SBOMs');
  const uploadedAt = RELEASE_WORKFLOW.indexOf('Upload installers');
  assert.ok(generatedAt > -1, 'the release never runs the SBOM generator');
  assert.ok(generatedAt < uploadedAt, 'the release uploads artifacts before it creates their SBOMs');

  const upload = RELEASE_WORKFLOW.slice(uploadedAt, RELEASE_WORKFLOW.indexOf('retention-days', uploadedAt));
  assert.match(upload, /dist\/\*\.cdx\.json/, 'matrix artifacts drop the generated SBOMs');

  const collectAt = RELEASE_WORKFLOW.indexOf('Collect and checksum');
  const collect = RELEASE_WORKFLOW.slice(collectAt, RELEASE_WORKFLOW.indexOf('Publishing:', collectAt));
  assert.match(collect, /-name '\*\.cdx\.json'/, 'the publish job drops SBOMs before release');
  assert.match(collect, /sha256sum/, 'release SBOMs are not bound into SHA256SUMS.txt');
  assert.doesNotMatch(
    collect,
    /grep -vE[^\n]*cdx/,
    'release SBOMs are excluded from SHA256SUMS.txt instead of being integrity protected',
  );
});
