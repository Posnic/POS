/*
 * Nothing the application runs may come from someone else's server.
 *
 * dashboard.html is the main window - it has a preload, and behind that
 * preload is every IPC channel, including backup restore and update install.
 * It was loading print.js from cdnjs.cloudflare.com on every launch, with no
 * integrity hash, and the API's own Content-Security-Policy listed cdnjs under
 * script-src so nothing objected.
 *
 * Two separate problems, and the smaller one is the one a shop would notice:
 *
 *   - Barcode printing needed the internet, in a product whose first claim is
 *     that nothing does. Offline, the script simply was not there.
 *   - A bad response from a third party would have executed as the
 *     application, with the whole IPC surface reachable.
 *
 * print.js is now vendored under its MIT licence. These tests exist so it
 * cannot come back - a remote <script> is the kind of thing that gets added
 * for one quick fix and never removed.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

/* The pages the application actually opens. Plugin demo pages bundled inside
   vendor folders are not loaded by anything and are not the concern here. */
const SHIPPED_PAGES = [
  ['frontend', 'public', 'dashboard.html'],
  ['frontend', 'public', 'ta_dashboard.html'],
];

test('no shipped page loads a script or stylesheet from another host', () => {
  for (const parts of SHIPPED_PAGES) {
    const file = path.join(ROOT, ...parts);
    if (!fs.existsSync(file)) continue;

    const html = read(...parts);
    const remote = [
      ...html.matchAll(/<script[^>]*\ssrc=["'](https?:\/\/[^"']+)["']/gi),
      ...html.matchAll(/<link[^>]*\shref=["'](https?:\/\/[^"']+)["'][^>]*rel=["']stylesheet/gi),
      ...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*\shref=["'](https?:\/\/[^"']+)["']/gi),
    ].map((m) => m[1]);

    assert.deepStrictEqual(
      remote,
      [],
      `${parts.join('/')} loads executable content from ${remote.join(', ')}. ` +
        'This window has a preload and the whole IPC surface behind it, and the ' +
        'shop may be offline. Vendor it instead.',
    );
  }
});

test('the CSP does not permit scripts from anywhere but this machine', () => {
  const app = read('api', 'app.js');

  /* Only the script-src array. img-src legitimately allows an S3 bucket for
     uploaded pictures, and an image is not executable - a slice that runs past
     the closing bracket fails on that and teaches nothing. */
  const start = app.indexOf("script-src'");
  assert.ok(start > -1, 'the CSP no longer declares script-src');
  const scriptSrc = app.slice(start, app.indexOf('],', start));

  const remote = [...scriptSrc.matchAll(/https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+/gi)]
    .map((m) => m[0]);

  assert.deepStrictEqual(
    remote,
    [],
    `script-src allows ${remote.join(', ')}. A page cannot load remote code the ` +
      'CSP refuses, so this is the backstop for the test above - and its absence ' +
      'was why nothing objected the first time.',
  );
});

test('print.js is vendored, with the licence that lets us vendor it', () => {
  const dir = path.join(ROOT, 'frontend', 'static', 'script', 'vendor', 'print-js');

  for (const f of ['print.min.js', 'print.min.css', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `print-js is missing ${f}`);
  }

  const licence = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
  assert.match(licence, /MIT License/i, 'the bundled licence is not the MIT one');

  /* Redistributing an MIT library means carrying its notice. Keeping the file
     beside it is how that obligation is met. */
  assert.match(licence, /Permission is hereby granted/i, 'the licence text is truncated');
});

test('the frontend build copies print.js into generated public assets', () => {
  const generated = path.join(ROOT, 'frontend', 'public', 'script', 'vendor', 'print-js');
  if (!fs.existsSync(path.join(ROOT, 'frontend', 'public', 'dashboard.html'))) return;

  for (const f of ['print.min.js', 'print.min.css', 'LICENSE']) {
    assert.ok(fs.existsSync(path.join(generated, f)), `generated public assets are missing ${f}`);
  }
});

test('and the pages point at the vendored copy', () => {
  for (const parts of SHIPPED_PAGES) {
    const file = path.join(ROOT, ...parts);
    if (!fs.existsSync(file)) continue;

    const html = read(...parts);
    if (!/printJS|print-js/i.test(html)) continue;

    assert.match(
      html,
      /script\/vendor\/print-js\/print\.min\.js/,
      `${parts.join('/')} references print-js but not the vendored copy`,
    );
  }
});
