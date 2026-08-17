/*
 * Generate public/sw.js from sw-template.js, stamping the cache name with a
 * digest of the built bundles. Must run AFTER buildJs/buildCss/buildHtml
 * (index.js sequences it): the hash has to describe what actually shipped,
 * or a deploy could reuse the previous build's cache and serve stale code —
 * the exact failure this worker exists to prevent.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publicDir } = require('./config');

function buildServiceWorker(cb) {
  try {
    const dir = process.cwd();
    const hash = crypto.createHash('sha256');
    const roots = [path.join(dir, publicDir, 'script'), path.join(dir, publicDir, 'style')];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const name of fs.readdirSync(root).sort()) {
        const full = path.join(root, name);
        if (fs.statSync(full).isFile()) {
          hash.update(name);
          hash.update(fs.readFileSync(full));
        }
      }
    }
    for (const name of fs.readdirSync(path.join(dir, publicDir)).sort()) {
      if (name.endsWith('.html')) {
        hash.update(name);
        hash.update(fs.readFileSync(path.join(dir, publicDir, name)));
      }
    }
    const buildHash = hash.digest('hex').slice(0, 16);
    const template = fs.readFileSync(path.join(dir, 'sw-template.js'), 'utf8');
    fs.writeFileSync(
      path.join(dir, publicDir, 'sw.js'),
      template.replace(/__BUILD_HASH__/g, buildHash)
    );
    console.log(`service worker written (build ${buildHash})`);
    cb();
  } catch (err) {
    cb(err);
  }
}

module.exports = { buildServiceWorker };
