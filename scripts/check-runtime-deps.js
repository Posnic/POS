'use strict';
/*
 * Nothing the API needs at runtime may live in a development dependency.
 *
 * prepare-api-runtime.js leaves development packages out of the shipped
 * archive, which is a large saving and a sharp edge: a require that resolves
 * happily on a developer machine and to nothing on a customer's produces
 * "Cannot find module" after the installer has already gone out. This asserts
 * the two stay in agreement.
 *
 *   npm run check:runtime-deps
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const API_DIR = path.join(__dirname, '..', 'api');
const MODULES = path.join(API_DIR, 'node_modules');

/*
 * Packages that are allowed to be absent because the code copes.
 *
 * swagger-ui-express serves the browsable API reference in development. It is
 * required inside a try/catch behind a NODE_ENV check, so a production install
 * without it simply does not offer the page.
 */
const OPTIONAL = new Set(['swagger-ui-express']);

function productionPackages() {
  const listed = spawnSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
    cwd: API_DIR, encoding: 'utf8', shell: process.platform === 'win32',
  });
  const keep = new Set();
  const marker = `${path.sep}node_modules${path.sep}`;
  for (const line of (listed.stdout || '').split(/\r?\n/)) {
    const at = line.lastIndexOf(marker);
    if (at === -1) continue;
    const parts = line.slice(at + marker.length).split(path.sep);
    keep.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  return keep;
}

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'tests' && e.name !== 'coverage') walk(p);
      } else if (e.name.endsWith('.js')) out.push(p);
    }
  };
  walk(path.join(API_DIR, 'src'));
  for (const f of ['app.js', 'server.js']) {
    const p = path.join(API_DIR, f);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

function main() {
  if (!fs.existsSync(MODULES)) {
    console.log('  api dependencies are not installed; nothing to check');
    return;
  }
  const keep = productionPackages();
  if (!keep.size) {
    console.log('  could not resolve the production tree; skipping');
    return;
  }

  const problems = new Map();
  for (const file of sourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/require\(\s*["']([^."'][^"']*)["']\s*\)/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      const top = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
      if (OPTIONAL.has(top)) continue;
      // Only packages that exist locally are interesting; a bare builtin such
      // as `path` has no directory here and needs no shipping.
      if (!fs.existsSync(path.join(MODULES, top))) continue;
      if (keep.has(top)) continue;
      if (!problems.has(top)) problems.set(top, []);
      problems.get(top).push(path.relative(API_DIR, file));
    }
  }

  if (!problems.size) {
    console.log(`  every runtime require is a production dependency (${keep.size} packages ship)`);
    return;
  }

  console.error('  these are required at runtime but would not be shipped:');
  for (const [pkg, files] of problems) {
    console.error(`    ${pkg}  required by ${files.slice(0, 3).join(', ')}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`);
  }
  console.error('\n  Move it to dependencies, or guard the require and add it to OPTIONAL here.');
  process.exit(1);
}

main();
