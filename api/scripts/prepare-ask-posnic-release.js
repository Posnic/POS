'use strict';

// Assemble the reviewed AI change set in a clean checkout. Never changes the
// source checkout, commits, restarts services, copies .env, or deploys anything.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const source = path.resolve(__dirname, '../..');
const git = (cwd, args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const shared = new Set([
  '.gitignore', 'api/.env.example',
  'api/package-lock.json', 'api/server.js', 'api/shard.js',
  'api/src/middleware/api-key.js', 'api/src/middleware/upload.js',
  'api/src/routes/index.js', 'api/src/sync/collections.json', 'api/src/services/ai-budget.js',
  'api/src/services/ai.service.js', 'api/src/services/campaign.service.js',
  'api/src/repositories/purchase-order.repository.js', 'api/src/repositories/quote.repository.js',
  'api/tests/unit/services/ai-budget.test.js', 'api/tests/unit/services/ai.service.test.js',
  'frontend/layouts/sidebar.html', 'frontend/pages_html_map.json', 'frontend/pages_css_js_map.json',
  // The locked archiver version requires ZipArchive when producing all.zip.
  'frontend/zip-build.js',
]);
const dedicated = (file) => /^(?:api|frontend|tests|docs)\//.test(file) && /(?:ask[-_]posnic|managed-ai|bedrock-provider|knowledge-document|inventory[-_]counts?|inventoryCounts)/i.test(path.basename(file));
function selectedPatch(file, marker) {
  const diff = git(source, ['diff', '--no-ext-diff', '--', file]) + '\n';
  const start = diff.indexOf('@@ ');
  if (start < 0) return '';
  const hunks = diff.slice(start).split(/(?=^@@ )/m).filter((hunk) => marker.test(hunk));
  if (hunks.length !== 1) throw new Error(`Expected exactly one reviewed AI hunk: ${file}`);
  return diff.slice(0, start) + hunks.join('');
}
function main() {
  const offered = process.argv.indexOf('--target');
  if (offered < 0 || !process.argv[offered + 1]) throw new Error('--target CLEAN_CHECKOUT is required. Default is preview; use --apply to assemble.');
  const target = fs.realpathSync(path.resolve(process.argv[offered + 1]));
  const original = fs.realpathSync(source);
  if (target === original || target.startsWith(original + path.sep) || original.startsWith(target + path.sep)) throw new Error('Target must be a separate checkout, outside the source tree.');
  if (git(target, ['rev-parse', '--show-toplevel']).replace(/\\/g, '/').toLowerCase() !== target.replace(/\\/g, '/').toLowerCase()) throw new Error('Target must be the checkout root.');
  const base = git(source, ['rev-parse', 'HEAD']);
  if (git(target, ['rev-parse', 'HEAD']) !== base) throw new Error('Target and source must share the reviewed base commit.');
  if (git(target, ['status', '--porcelain', '--untracked-files=all'])) throw new Error('Target is not clean; existing work was not overwritten.');
  const changed = [...new Set((git(source, ['diff', '--name-only']) + '\n' + git(source, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean))];
  const files = changed.filter((file) => shared.has(file) || dedicated(file)).sort();
  const partial = [
    { file: 'frontend/static/script/js/modules/js/sales.js', patch: selectedPatch('frontend/static/script/js/modules/js/sales.js', /l\.qty > 0/) },
    { file: 'frontend/static/script/js/modules/js/settings.js', patch: selectedPatch('frontend/static/script/js/modules/js/settings.js', /ask_posnic_grounding_check/) },
  ];
  const packageBase = JSON.parse(git(source, ['show', 'HEAD:api/package.json']));
  const packageCurrent = JSON.parse(fs.readFileSync(path.join(source, 'api/package.json'), 'utf8'));
  for (const dependency of ['@aws-sdk/client-bedrock-runtime', '@aws-sdk/client-s3vectors', '@aws-sdk/credential-provider-ini', 'pdf-parse']) packageBase.dependencies[dependency] = packageCurrent.dependencies[dependency];
  for (const script of ['test:ask-posnic:smoke', 'test:ask-posnic:live']) packageBase.scripts[script] = packageCurrent.scripts[script];
  const generated = [{ file: 'api/package.json', content: JSON.stringify(packageBase, null, 2) + '\n' }];
  const patch = partial.map((row) => row.patch).join('\n');
  git(target, ['apply', '--check', '-'], patch);
  const manifest = { kind: 'ask-posnic-isolated-source-candidate', base, source: original, target, applied: process.argv.includes('--apply'), files: files.map((file) => ({ file, sha256: sha(fs.readFileSync(path.join(source, file))) })), partial: partial.map((row) => ({ file: row.file, patch_sha256: sha(row.patch) })), generated: generated.map((row) => ({ file: row.file, sha256: sha(row.content) })), excluded: changed.filter((file) => !file.startsWith('output/') && !files.includes(file) && !partial.some((row) => row.file === file) && !generated.some((row) => row.file === file)) };
  if (manifest.applied) {
    for (const file of files) {
      const destination = path.join(target, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(path.join(source, file), destination);
    }
    git(target, ['apply', '-'], patch);
    for (const row of generated) fs.writeFileSync(path.join(target, row.file), row.content);
    for (const row of manifest.partial) row.result_sha256 = sha(fs.readFileSync(path.join(target, row.file)));
  }
  const output = path.join(source, 'output/ask-posnic-release-preparation.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ applied: manifest.applied, base, target, complete_files: files.length, partial_files: partial.length, excluded: manifest.excluded.length, manifest: output }));
}
main();
