/*
 * Content-hash the built bundles and rewrite every page to reference the
 * hashed names (SEAMLESS_UPDATE_ROADMAP U3.1 / experience program S1).
 *
 * public/script/dashboard.js becomes public/script/dashboard.<hash8>.js and
 * every built HTML page points at the new name. The name now IS the version:
 * servers and CDNs can cache these files as immutable forever, and a deploy
 * is visible the moment the (never-cached) HTML goes out - the 24-hour
 * stale-CDN window this replaces cannot happen, because a changed bundle is a
 * different URL.
 *
 * Runs after buildJs/buildCss/buildHtml (index.js sequences it), before the
 * service-worker task, which precaches the hashed names it returns.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { publicDir } = require('./config');

function hashDir(root, sub) {
  const dir = path.join(root, sub);
  const renames = new Map(); // old rel URL -> new rel URL
  if (!fs.existsSync(dir)) return renames;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const ext = path.extname(name);
    if (!['.js', '.css'].includes(ext)) continue;
    // Already hashed (a rebuild over a dirty public/): strip the old hash so
    // the tree never accumulates dashboard.aaaa.bbbb.js chains.
    const base = path.basename(name, ext).replace(/\.[0-9a-f]{8}$/, '');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
    const hashedName = `${base}.${digest}${ext}`;
    if (hashedName !== name) fs.renameSync(full, path.join(dir, hashedName));
    renames.set(`${sub}/${base}${ext}`, `${sub}/${hashedName}`);
    // Remove stale hashed siblings from previous local builds.
    for (const sibling of fs.readdirSync(dir)) {
      if (sibling !== hashedName
          && sibling.startsWith(`${base}.`)
          && new RegExp(`^${base}\\.[0-9a-f]{8}\\${ext}$`).test(sibling)) {
        fs.rmSync(path.join(dir, sibling), { force: true });
      }
    }
  }
  return renames;
}

function fingerprintAssets(cb) {
  try {
    const root = path.join(process.cwd(), publicDir);
    const renames = new Map([
      ...hashDir(root, 'script'),
      ...hashDir(root, 'style'),
    ]);

    for (const page of fs.readdirSync(root)) {
      if (!page.endsWith('.html')) continue;
      const full = path.join(root, page);
      let html = fs.readFileSync(full, 'utf8');
      // A page fingerprinted by a previous pass (watch mode rebuilds one half
      // only) references hashed names this pass's map does not know. Fold any
      // hashed reference back to its canonical name first, so the rewrite is
      // idempotent no matter which tasks ran before it.
      html = html.replace(/\b(script|style)\/([A-Za-z0-9_-]+)\.[0-9a-f]{8}\.(js|css)\b/g, '$1/$2.$3');
      for (const [oldRel, newRel] of renames) {
        html = html.split(oldRel).join(newRel);
      }
      fs.writeFileSync(full, html);
    }

    module.exports.lastRenames = renames;
    console.log(`fingerprinted ${renames.size} bundles`);
    cb();
  } catch (err) {
    cb(err);
  }
}

module.exports = { fingerprintAssets, lastRenames: new Map() };
