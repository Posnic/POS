const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildServiceWorker } = require('../frontend/gulpfile.js/sw');
const { publicDir } = require('../frontend/gulpfile.js/config');
test('a lazy report change invalidates the service worker even when boot bundles stay the same', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-price-cache-'));
  const previous = process.cwd();
  try {
    process.chdir(temp);
    fs.mkdirSync(path.join(publicDir, 'script', 'lazy'), { recursive: true });
    fs.mkdirSync(path.join(publicDir, 'style'), { recursive: true });
    fs.writeFileSync('sw-template.js', '__BUILD_HASH__ __PRECACHE__');
    fs.writeFileSync(path.join(publicDir, 'script', 'dashboard.js'), 'unchanged');
    const lazy = path.join(publicDir, 'script', 'lazy', 'reports.js');
    const build = () => new Promise((resolve, reject) => buildServiceWorker(e => e ? reject(e) : resolve(fs.readFileSync(path.join(publicDir, 'sw.js'), 'utf8'))));
    fs.writeFileSync(lazy, 'old pricing'); const before = await build();
    assert.equal(await build(), before);
    fs.writeFileSync(lazy, 'new pricing'); assert.notEqual(await build(), before);
  } finally {
    process.chdir(previous);
    if (path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir())) fs.rmSync(temp, { recursive: true, force: true });
  }
});
