#!/usr/bin/env node
/*
 * Every local module the app requires must actually be in the package.
 *
 * build.files is an explicit allowlist. Adding a module and forgetting to list
 * it produces a build that works perfectly from source and dies on a customer's
 * machine with "Cannot find module", which is exactly what shipped: local-ports
 * was required by main.js and never packaged, so the app could not start at all.
 *
 * Reading the requires out of the source rather than keeping a second list here
 * is the point. A checklist that has to be updated by hand fails the same way
 * the thing it is checking did.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const included = (pkg.build.files || []).filter((f) => typeof f === 'string' && !f.startsWith('!'));
const includedSet = new Set(included);

// Entry points that run from the asar. Anything they pull in with a relative
// require has to travel with them.
const ENTRIES = (pkg.build.files || [])
  .filter((f) => typeof f === 'string' && f.endsWith('.js') && !f.startsWith('!'))
  .filter((f) => fs.existsSync(path.join(ROOT, f)));

const missing = [];
const seen = new Set();

function scan(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const src = fs.readFileSync(abs, 'utf8');

  // require('./thing') and require('./dir/thing') - relative, so it is ours.
  for (const m of src.matchAll(/require\(\s*['"](\.\/[A-Za-z0-9_./-]+)['"]\s*\)/g)) {
    let target = m[1].replace(/^\.\//, '');
    if (!/\.[a-z]+$/.test(target)) target += '.js';
    // extraResources cover files loaded by absolute path at runtime, not these.
    if (!includedSet.has(target) && !includedSet.has(target.replace(/\.js$/, ''))) {
      missing.push({ from: rel, needs: target, exists: fs.existsSync(path.join(ROOT, target)) });
    } else {
      scan(target);
    }
  }
}

ENTRIES.forEach(scan);

if (missing.length) {
  console.error('\n[package] modules required at runtime but not in build.files:\n');
  for (const m of missing) {
    console.error(`  ${m.from} requires ./${m.needs}` + (m.exists ? '' : '   (and the file does not exist)'));
  }
  console.error('\nAdd them to "build" -> "files" in package.json, or the app will start');
  console.error('from source and fail on a customer machine with "Cannot find module".\n');
  process.exit(1);
}

console.log(`[package] all local requires are packaged (${seen.size} modules checked)`);
