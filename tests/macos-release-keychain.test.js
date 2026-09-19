'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8'));
const step = workflow.jobs.build.steps.find((item) => item.name === 'Correct the legacy macOS keychain password');
const script = step.run.replace(/^node <<'NODE'\r?\n/, '').replace(/\r?\nNODE\s*$/, '');
const original = fs.readFileSync(require.resolve('app-builder-lib/out/codeSign/macCodeSign.js'), 'utf8');

function patch(source) {
  let result = source;
  const fakeRequire = (name) => {
    assert.equal(name, 'node:fs');
    return { readFileSync: () => source, writeFileSync: (_file, value) => { result = value; } };
  };
  fakeRequire.resolve = () => 'macCodeSign.js';
  vm.runInNewContext(script, { require: fakeRequire, console: { log() {} } });
  return result;
}

test('certificate import and keychain unlock receive their own passwords', async () => {
  const source = patch(original);
  const start = source.indexOf('async function importCerts(');
  const end = source.indexOf('\nasync function sign(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const importCerts = vm.runInNewContext(`(${source.slice(start, end)})`, {
    builder_util_1: { exec: async (_tool, args) => { calls.push(Array.from(args)); } },
  });
  await importCerts('temporary.keychain', ['one.p12', 'two.p12'], ['certificate-one', 'certificate-two'], 'keychain-password');
  const imports = calls.filter((args) => args[0] === 'import');
  const partitions = calls.filter((args) => args[0] === 'set-key-partition-list');
  assert.deepEqual(imports.map((args) => args[args.indexOf('-P') + 1]), ['certificate-one', 'certificate-two']);
  assert.deepEqual(partitions.map((args) => args[args.indexOf('-k') + 1]), ['keychain-password', 'keychain-password']);
  assert.ok(source.includes('return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);'));
});

test('the workaround is idempotent and fails before writing unfamiliar source', () => {
  const corrected = patch(original);
  assert.equal(patch(corrected), corrected);
  assert.throws(() => patch(original.replace('async function importCerts(', 'async function renamedImport(')), /implementation changed/);
  assert.equal(step.if, "matrix.name == 'macOS' && env.HAVE_MAC_CERT == 'true'");
});
