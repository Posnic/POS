/*
 * Every file a packaged window asks for must actually be in the package.
 *
 * Written after shipping an installer in which the four settings windows each
 * carried <script src="window-theme.js"> and the file was not in build.files.
 * Nothing failed loudly: electron-builder does not read the HTML, the window
 * still opened, and the missing script only meant the shop's theme was silently
 * not applied - the exact bug the script existed to fix, reintroduced by the
 * packaging rather than by the code. Both the source and the tests were green.
 *
 * So this reads what the windows reference and checks it against what the build
 * is told to include. It is the one place that sees both.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const FILES = pkg.build.files;

/* An entry may be a plain name or a glob; "**\/*" and "!x" both appear. */
function packaged(asset) {
  return FILES.some((entry) => {
    if (typeof entry !== 'string' || entry.startsWith('!')) return false;
    if (entry === asset) return true;
    if (!entry.includes('*')) return false;
    const rx = new RegExp('^' + entry
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/?/g, '(?:.*/)?')
      .replace(/\*/g, '[^/]*') + '$');
    return rx.test(asset);
  });
}

/* Local references only: a CDN URL or a data: URI is not ours to package. */
function localRefs(html) {
  const out = [];
  const rx = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const ref = m[1].trim();
    if (!ref || /^(https?:|data:|#|mailto:|\/\/)/i.test(ref)) continue;
    if (!/\.(js|css)$/i.test(ref)) continue;
    out.push(ref.replace(/^\.\//, '').split(/[?#]/)[0]);
  }
  return out;
}

/* The Electron windows: top-level HTML the main process loads directly. */
const WINDOWS = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html'))
  .filter((f) => packaged(f));

test('every window that ships is listed in build.files', () => {
  assert.ok(WINDOWS.length >= 4, `expected the settings windows, found ${WINDOWS.length}`);
});

for (const win of WINDOWS) {
  test(`${win}: its scripts and stylesheets are packaged`, () => {
    const html = fs.readFileSync(path.join(ROOT, win), 'utf8');
    for (const ref of localRefs(html)) {
      /* Anything under a directory the build ships wholesale is already covered;
         this is about the loose files beside main.js. */
      if (ref.includes('/')) continue;

      assert.ok(fs.existsSync(path.join(ROOT, ref)),
        `${win} references ${ref}, which does not exist`);
      assert.ok(packaged(ref),
        `${win} references ${ref}, which is missing from package.json build.files - ` +
        `the window will open without it and fail quietly`);
    }
  });
}

test('the theming a window asks for is the theming it gets', () => {
  /* Named explicitly rather than inferred: this pair is the reason the test
     exists, and a rename that drops one of them should fail here. */
  for (const asset of ['window-theme.js', 'window-theme.css']) {
    assert.ok(packaged(asset), `${asset} must be in build.files`);
  }
});
