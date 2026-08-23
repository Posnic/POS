'use strict';

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const API_ROOT = path.join(ROOT, 'api');
const ARTIFACT_PATTERN = /\.(?:exe|dmg|zip|appimage|deb)$/i;
const DNS_NAMESPACE = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function uuidV5(name, namespace = DNS_NAMESPACE) {
  const bytes = crypto.createHash('sha1').update(namespace).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function artifactIdentity(fileName) {
  const lower = fileName.toLowerCase();
  let platform = 'unknown';
  let format = path.extname(fileName).slice(1).toLowerCase();

  if (lower.endsWith('.exe') || lower.includes('windows')) platform = 'windows';
  if (lower.endsWith('.dmg') || lower.includes('macos')) platform = 'macos';
  if (lower.endsWith('.appimage') || lower.endsWith('.deb') || lower.includes('linux')) platform = 'linux';

  if (lower.includes('installer')) format = 'installer';
  else if (lower.includes('portable')) format = 'portable';
  else if (lower.endsWith('.dmg')) format = 'disk-image';
  else if (lower.endsWith('.appimage')) format = 'appimage';
  else if (lower.endsWith('.deb')) format = 'debian-package';
  else if (lower.endsWith('.zip')) format = 'archive';

  let architecture = 'unknown';
  if (/arm64|aarch64/.test(lower)) architecture = 'arm64';
  else if (/x64|x86_64|amd64/.test(lower)) architecture = 'x86_64';

  return { platform, architecture, format };
}

function discoverArtifacts(distDir) {
  return fs.readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ARTIFACT_PATTERN.test(entry.name))
    .map((entry) => path.join(distDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function readMongoVersion() {
  const batch = fs.readFileSync(path.join(ROOT, 'download-mongodb.bat'), 'utf8');
  const match = batch.match(/^set MONGODB_VERSION=([0-9.]+)$/m);
  if (!match) throw new Error('download-mongodb.bat does not pin MONGODB_VERSION');
  return match[1];
}

function readElectronVersion(rootPackage) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const installed = lock.packages && lock.packages['node_modules/electron'];
  if (installed && installed.version) return installed.version;
  const declared = rootPackage.devDependencies && rootPackage.devDependencies.electron;
  if (!declared) throw new Error('Electron is not declared in package.json');
  return declared.replace(/^[^0-9]*/, '');
}

function npmCommand() {
  if (process.env.npm_execpath) return { command: process.execPath, prefix: [process.env.npm_execpath] };
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] };
}

function generateApiBom() {
  const npm = npmCommand();
  const stdout = execFileSync(
    npm.command,
    [
      ...npm.prefix,
      'sbom',
      '--package-lock-only',
      '--omit=dev',
      '--sbom-format=cyclonedx',
      '--sbom-type=application',
    ],
    { cwd: API_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function sourceCommit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
}

function license(id) {
  return [{ license: { id } }];
}

function uniqueByRef(components) {
  const seen = new Map();
  for (const component of components) {
    if (!component || !component['bom-ref']) continue;
    if (!seen.has(component['bom-ref'])) seen.set(component['bom-ref'], component);
  }
  return [...seen.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
}

function mergeDependencies(dependencies, rootRef, rootDependsOn, componentRefs) {
  const merged = new Map();
  for (const dependency of dependencies || []) {
    if (!dependency || !dependency.ref) continue;
    merged.set(dependency.ref, {
      ref: dependency.ref,
      dependsOn: [...new Set(dependency.dependsOn || [])].sort(),
    });
  }

  merged.set(rootRef, { ref: rootRef, dependsOn: [...new Set(rootDependsOn)].sort() });
  for (const ref of componentRefs) {
    if (!merged.has(ref)) merged.set(ref, { ref, dependsOn: [] });
  }
  return [...merged.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function buildSbom({ artifactPath, apiBom, rootPackage, commit, mongoVersion, electronVersion }) {
  const fileName = path.basename(artifactPath);
  const artifactHash = sha256File(artifactPath);
  const identity = artifactIdentity(fileName);
  const artifactRef = `urn:uuid:${uuidV5(`posnic-artifact:${artifactHash}`)}`;
  const sourceRef = `pkg:github/Posnic/POS@v${rootPackage.version}`;
  const mongoRef = `pkg:generic/mongodb-community-server@${mongoVersion}`;
  const electronRef = `pkg:npm/electron@${electronVersion}`;
  const apiRoot = apiBom.metadata && apiBom.metadata.component;

  if (!apiRoot || !apiRoot['bom-ref']) {
    throw new Error('npm SBOM does not contain metadata.component with a bom-ref');
  }

  const sourceComponent = {
    type: 'application',
    group: 'Posnic',
    name: 'Posnic POS source',
    version: rootPackage.version,
    'bom-ref': sourceRef,
    purl: sourceRef,
    licenses: license('AGPL-3.0-only'),
    externalReferences: [
      { type: 'website', url: 'https://posnic.com/' },
      { type: 'vcs', url: `https://github.com/Posnic/POS/tree/${commit}` },
    ],
  };
  const mongoComponent = {
    type: 'application',
    group: 'MongoDB, Inc.',
    name: 'MongoDB Community Server',
    version: mongoVersion,
    'bom-ref': mongoRef,
    purl: mongoRef,
    licenses: license('SSPL-1.0'),
    externalReferences: [
      { type: 'license', url: 'https://www.mongodb.com/legal/licensing/server-side-public-license' },
      { type: 'vcs', url: `https://github.com/mongodb/mongo/tree/r${mongoVersion}` },
    ],
  };
  const electronComponent = {
    type: 'framework',
    group: 'OpenJS Foundation and Electron contributors',
    name: 'Electron',
    version: electronVersion,
    'bom-ref': electronRef,
    purl: electronRef,
    licenses: license('MIT'),
    externalReferences: [{ type: 'vcs', url: `https://github.com/electron/electron/tree/v${electronVersion}` }],
  };

  const components = uniqueByRef([
    ...(apiBom.components || []),
    apiRoot,
    sourceComponent,
    mongoComponent,
    electronComponent,
  ]);
  const directDependencies = [sourceRef, apiRoot['bom-ref'], mongoRef, electronRef];

  return {
    $schema: apiBom.$schema || 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: apiBom.specVersion || '1.5',
    serialNumber: artifactRef,
    version: 1,
    metadata: {
      tools: apiBom.metadata.tools,
      component: {
        type: 'application',
        group: 'Posnic Innovations Private Limited',
        name: 'Posnic distribution artifact',
        version: rootPackage.version,
        'bom-ref': artifactRef,
        hashes: [{ alg: 'SHA-256', content: artifactHash }],
        externalReferences: [
          { type: 'website', url: 'https://posnic.com/' },
          { type: 'vcs', url: `https://github.com/Posnic/POS/tree/${commit}` },
        ],
        properties: [
          { name: 'posnic:artifact:architecture', value: identity.architecture },
          { name: 'posnic:artifact:file-name', value: fileName },
          { name: 'posnic:artifact:format', value: identity.format },
          { name: 'posnic:artifact:platform', value: identity.platform },
          { name: 'posnic:licensing:scope', value: 'Mixed-license aggregate; each component license applies separately.' },
          { name: 'posnic:source:commit', value: commit },
        ],
      },
    },
    components,
    dependencies: mergeDependencies(
      apiBom.dependencies,
      artifactRef,
      directDependencies,
      components.map((component) => component['bom-ref']),
    ),
  };
}

function writeSboms({ distDir, apiBom = generateApiBom(), commit = sourceCommit() }) {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mongoVersion = readMongoVersion();
  const electronVersion = readElectronVersion(rootPackage);
  const artifacts = discoverArtifacts(distDir);
  if (artifacts.length === 0) throw new Error(`No release artifacts found in ${distDir}`);

  const outputs = [];
  for (const artifactPath of artifacts) {
    const bom = buildSbom({
      artifactPath,
      apiBom,
      rootPackage,
      commit,
      mongoVersion,
      electronVersion,
    });
    const outputPath = `${artifactPath}.cdx.json`;
    fs.writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`, 'utf8');
    outputs.push(outputPath);
    console.log(`[sbom] ${path.basename(outputPath)}`);
  }
  return outputs;
}

function argumentValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

function main() {
  const distDir = path.resolve(argumentValue(process.argv.slice(2), '--dist', path.join(ROOT, 'dist')));
  writeSboms({ distDir });
}

if (require.main === module) main();

module.exports = {
  artifactIdentity,
  buildSbom,
  discoverArtifacts,
  mergeDependencies,
  readElectronVersion,
  readMongoVersion,
  uuidV5,
  writeSboms,
};
