'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const METAINFO_RELATIVE = 'builds/linux/com.posnic.app.metainfo.xml';
const METAINFO_PATH = path.join(ROOT, METAINFO_RELATIVE);
const METAINFO_DESTINATION = '/usr/share/metainfo/com.posnic.app.metainfo.xml';
const APPIMAGE_APPDATA_FILENAME = 'com.posnic.app.appdata.xml';
const pkg = require('../package.json');

function parseMetainfo() {
  const xml = fs.readFileSync(METAINFO_PATH, 'utf8');
  const document = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  assert.equal(document.querySelector('parsererror'), null, 'metainfo is not valid XML');
  return document;
}

test('Linux software identity is consistent across the app, launcher and AppStream', () => {
  const document = parseMetainfo();
  const text = (selector) => document.querySelector(selector)?.textContent.trim();

  assert.equal(document.documentElement.getAttribute('type'), 'desktop-application');
  assert.equal(text('component > id'), pkg.build.appId);
  assert.equal(pkg.desktopName, `${pkg.build.appId}.desktop`);
  assert.equal(pkg.build.linux.syncDesktopName, true);
  assert.equal(text('launchable[type="desktop-id"]'), pkg.desktopName);
  assert.equal(text('provides > binary'), pkg.name);
  assert.equal(text('project_license'), pkg.license);
  assert.equal(text('metadata_license'), 'CC0-1.0');
});

test('AppStream copy is useful, factual and backed by a real product screenshot', () => {
  const document = parseMetainfo();
  const summary = document.querySelector('summary').textContent.trim();
  const description = document.querySelector('description').textContent.replace(/\s+/g, ' ').trim();
  const screenshot = document.querySelector('screenshot[type="default"] image[type="source"]');
  const urls = [...document.querySelectorAll('url')].map((node) => node.textContent.trim());
  const keywords = [...document.querySelectorAll('keywords > keyword')].map((node) =>
    node.textContent.trim(),
  );
  const releases = [...document.querySelectorAll('releases > release')];

  assert.ok(summary.length <= 100 && !summary.endsWith('.'));
  assert.match(description, /open-source point-of-sale software/i);
  assert.match(description, /without an internet connection/i);
  assert.equal(screenshot.getAttribute('width'), '1920');
  assert.equal(screenshot.getAttribute('height'), '1032');
  assert.match(screenshot.textContent.trim(), /^https:\/\/raw\.githubusercontent\.com\/Posnic\/POS\/[0-9a-f]{40}\//);
  assert.ok(urls.length >= 4 && urls.every((url) => url.startsWith('https://')));
  assert.ok(urls.includes('https://posnic.io/'));
  assert.ok(keywords.includes('billing software'));
  assert.ok(keywords.includes('offline POS'));
  assert.ok(keywords.includes('online/offline POS'));
  assert.ok(keywords.includes('open source POS'));
  assert.equal(releases[0].getAttribute('version'), pkg.version);
});

test('AppImage and Debian packages use the metadata filename each catalog expects', async (t) => {
  const fpmMapping = `${METAINFO_RELATIVE}=${METAINFO_DESTINATION}`;
  assert.ok(pkg.build.deb.fpm.includes(fpmMapping), 'Debian package has no global metainfo mapping');

  const appOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-appstream-'));
  t.after(() => fs.rmSync(appOutDir, { recursive: true, force: true }));

  const hook = require('../scripts/after-pack.js');
  await hook.default({
    electronPlatformName: 'linux',
    appOutDir,
    targets: [{ name: 'AppImage' }, { name: 'deb' }],
  });

  const embedded = path.join(appOutDir, 'usr', 'share', 'metainfo', APPIMAGE_APPDATA_FILENAME);
  assert.deepEqual(fs.readFileSync(embedded), fs.readFileSync(METAINFO_PATH));
  assert.equal(
    fs.existsSync(path.join(appOutDir, 'usr', 'share', 'metainfo', path.basename(METAINFO_PATH))),
    false,
    'AppImage should not carry duplicate component metadata under two names',
  );
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(embedded).mode & 0o777, 0o644);
  }
});
