/*
 * Generate public/sw.js from sw-template.js, stamping the cache name with a
 * digest of the built bundles and the precache list with the fingerprinted
 * file names. Must run AFTER buildJs/buildCss/buildHtml AND fingerprintAssets
 * (index.js sequences it): the hash has to describe what actually shipped and
 * the precache has to name the hashed files, or a deploy could serve stale
 * code - the exact failure this worker exists to prevent.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publicDir } = require('./config');
const fingerprint = require('./fingerprint');

function buildServiceWorker(cb) {
  try {
    const dir = process.cwd();
    const hash = crypto.createHash('sha256');
    const roots = [path.join(dir, publicDir, 'script'), path.join(dir, publicDir, 'style')];
    function hashFiles(root, relative = '') {
      for (const name of fs.readdirSync(root).sort()) {
        const full = path.join(root, name);
        const entry = path.posix.join(relative, name);
        if (fs.statSync(full).isDirectory()) hashFiles(full, entry);
        else if (fs.statSync(full).isFile()) {
          hash.update(entry);
          hash.update(fs.readFileSync(full));
        }
      }
    }
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      // Lazy reports contain Price Settings. A lazy-only change is a release too.
      hashFiles(root, path.basename(root));
    }
    for (const name of fs.readdirSync(path.join(dir, publicDir)).sort()) {
      if (name.endsWith('.html')) {
        hash.update(name);
        hash.update(fs.readFileSync(path.join(dir, publicDir, name)));
      }
    }
    const buildHash = hash.digest('hex').slice(0, 16);

    /* Warm the heavy pages' bundles by their fingerprinted names, and the
       offline fallback - which must be cached BEFORE the network dies. */
    const renames = fingerprint.lastRenames || new Map();
    const precache = [];
    for (const canonical of ['script/dashboard.js', 'style/dashboard.css',
                             'script/login.js', 'style/login.css',
                             'static/offline.html']) {
      precache.push(renames.get(canonical) || canonical);
    }

    const template = fs.readFileSync(path.join(dir, 'sw-template.js'), 'utf8');
    fs.writeFileSync(
      path.join(dir, publicDir, 'sw.js'),
      template
        .replace(/__BUILD_HASH__/g, buildHash)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
    );
    console.log(`service worker written (build ${buildHash}, precache ${precache.length})`);
    cb();
  } catch (err) {
    cb(err);
  }
}

module.exports = { buildServiceWorker };
