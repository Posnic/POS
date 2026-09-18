'use strict';

/*
 * WHICH VERSION IS THIS SHOP RUNNING?
 *
 * Owner, after a customer phoned in a printing fault: "i asked which
 * version using. now way to tell."
 *
 * There was no way to tell. The number lived in three places and none of
 * them was on a screen: app.getVersion() in the main process, package.json,
 * and Help > About - behind a menu bar that is hidden until somebody
 * presses Alt. A shop on the telephone cannot be talked through any of
 * that, so every support call opened with an unanswerable question.
 *
 * THREE NUMBERS, because they can disagree and the disagreement is the
 * interesting part. The asset channel can stage a newer frontend under an
 * older shell, and an installer has shipped an OLDER one - which looks
 * exactly like a fix that did not work. So the badge says which shell is
 * installed, which page bundle is actually executing, and which API build
 * answered, and copies all three as one line to paste into a message.
 *
 * Driven here against a made-up page rather than pinned by grepping for
 * strings: what matters is that a shop ends up with a readable number on
 * screen, and every one of these would pass on markup that renders empty.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NL = String.fromCharCode(10);

const BADGE = path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'version-badge.js');
const SRC = fs.readFileSync(BADGE, 'utf8');

/* ------------------------------------------------------------------ *
 * A fake page, small enough to read.
 *
 * Only what the module actually touches. jsdom is not in this repo and
 * this does not need it: the module reads three things and writes text
 * into two elements.
 * ------------------------------------------------------------------ */
function el(tag) {
  const node = {
    tagName: tag,
    attrs: {},
    style: {},
    textContent: '',
    children: {},
    listeners: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    querySelector(sel) { return this.children[sel] || null; },
  };
  return node;
}

function versionRow() {
  const row = el('li');
  row.style.display = 'none';
  row.children['.posnic-version-number'] = el('span');
  row.children['.posnic-version-build'] = el('small');
  row.children['.posnic-version-copied'] = el('span');
  return row;
}

/**
 * Run version-badge.js against a made-up page.
 *
 * @param {object} opts
 *   scripts     src values on the page
 *   appVersion  what the desktop bridge answers, or null for a browser
 *   serverVersion what base/health answers, or null
 *   row         include the dashboard dropdown row
 *   login       include the sign-in line
 */
function run(opts) {
  const nodes = {};
  if (opts.row !== false) nodes.posnic_version_line = versionRow();
  if (opts.login) nodes.posnic_version_login = el('small');

  const asked = [];
  const PosnicPro = {
    get(url, ok, fail) {
      asked.push(url);
      if (opts.serverVersion == null) { fail(); return; }
      ok({ type: 'success', data: { version: opts.serverVersion } });
    },
  };

  const document = {
    readyState: 'complete',
    getElementById: (id) => nodes[id] || null,
    getElementsByTagName: () => (opts.scripts || []).map((src) => {
      const s = el('script');
      s.attrs.src = src;
      return s;
    }),
    createElement: el,
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
  };

  const window = {};
  if (opts.appVersion != null) {
    window.electronAPI = {
      desktop: { capabilities: () => Promise.resolve({ desktop: true, version: opts.appVersion }) },
    };
  }

  const navigator = { clipboard: null };

  const fn = new Function('PosnicPro', 'document', 'window', 'navigator', 'setTimeout', SRC);
  fn(PosnicPro, document, window, navigator, () => {});

  return { PosnicPro, nodes, asked };
}

/* The module resolves through promises, so let the microtask queue drain. */
const settled = () => new Promise((r) => setImmediate(r));

const DASH = ['script/jquery.min.js', 'script/dashboard.2eca0dab.js'];

test('the desktop shows the installed version and the build it is running', async () => {
  const { nodes } = run({ scripts: DASH, appVersion: '1.6.1', serverVersion: '1.6.1' });
  await settled();

  const row = nodes.posnic_version_line;
  assert.strictEqual(row.children['.posnic-version-number'].textContent, 'Posnic 1.6.1',
    'the number a shop reads out is not there');
  assert.match(row.children['.posnic-version-build'].textContent, /2eca0dab/,
    'the page build is missing, so a stale frontend under a fresh shell is invisible');
  assert.strictEqual(row.style.display, '',
    'the row is still hidden, so nobody can read any of it');
});

test('a server on a different build is named, not hidden behind the app number', () => {
  /*
   * The case this exists for: the shell says 1.6.1 and the API answering it
   * is something else. Saying only the first would send support after the
   * wrong build.
   */
  const { nodes } = run({ scripts: DASH, appVersion: '1.6.1', serverVersion: '1.7.0' });
  return settled().then(() => {
    const sub = nodes.posnic_version_line.children['.posnic-version-build'].textContent;
    assert.match(sub, /server 1\.7\.0/, 'the server build is not shown when it disagrees');
  });
});

test('a browser with no desktop shell still answers the question', async () => {
  const { nodes } = run({
    scripts: ['script/dashboard.2eca0dab.js'], appVersion: null, serverVersion: '1.6.1',
  });
  await settled();
  assert.strictEqual(nodes.posnic_version_line.children['.posnic-version-number'].textContent,
    'Posnic 1.6.1', 'a cloud shop is told nothing');
});

test('the copied line carries every number, on one line', async () => {
  const { nodes } = run({ scripts: DASH, appVersion: '1.6.1', serverVersion: '1.7.0' });
  await settled();
  const full = nodes.posnic_version_line.getAttribute('title');
  assert.match(full, /Posnic 1\.6\.1/);
  assert.match(full, /desktop/);
  assert.match(full, /page 2eca0dab/);
  assert.match(full, /server 1\.7\.0/);
  assert.ok(full.indexOf(NL) === -1, 'it is not one line, so it pastes badly into a message');
});

test('the sign-in screen asks no server, because it has no session to ask with', async () => {
  const { nodes, asked } = run({
    scripts: ['script/login.91f31103.js'], appVersion: '1.6.1', serverVersion: '1.6.1',
    row: false, login: true,
  });
  await settled();

  assert.deepStrictEqual(asked, [], 'the sign-in page calls the API for a number it cannot be given');
  assert.match(nodes.posnic_version_login.textContent, /Posnic 1\.6\.1/,
    'a till nobody can sign in to still cannot say what it is');
  assert.match(nodes.posnic_version_login.textContent, /91f31103/,
    'the build of the page in front of them is not shown');
});

test('a browser at the sign-in screen falls back to the build hash', async () => {
  const { nodes } = run({
    scripts: ['script/login.91f31103.js'], appVersion: null, serverVersion: null,
    row: false, login: true,
  });
  await settled();
  assert.match(nodes.posnic_version_login.textContent, /91f31103/,
    'with no shell and no session there is nothing left to say, and it says nothing');
});

test('knowing nothing shows nothing, rather than a row reading "Posnic ?"', async () => {
  const { nodes } = run({ scripts: ['script/dashboard.js'], appVersion: null, serverVersion: null });
  await settled();
  assert.strictEqual(nodes.posnic_version_line.style.display, 'none',
    'an empty row invites a shop to read a shrug down the telephone');
});

/* --------------------------------------------- the numbers have sources --- */

test('the desktop shell hands its version to the page', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const at = main.indexOf("ipcMain.handle('desktop:capabilities'");
  assert.ok(at > 0, 'the capabilities bridge is gone');
  const body = main.slice(at, at + 900);
  assert.match(body, /version: app\.getVersion\(\)/,
    'the one bridge the page already calls does not carry the version');
});

test('the API tells a signed-in caller which build answered', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'api', 'src', 'routes', 'base.routes.js'), 'utf8');
  const at = routes.indexOf('if (req.user)');
  assert.ok(at > 0, 'the signed-in half of health is gone');
  assert.match(routes.slice(at, at + 900), /version: pkg\.version/,
    'health does not report the API version');

  /* And NOT to an anonymous one: the reasoning in that file about not
     handing out a shopping list applies to the build number too. */
  const before = routes.slice(routes.indexOf("router.get('/health'"), at);
  assert.ok(!/version:/.test(before),
    'the version is published to callers who have not signed in');
});

test('the About window can be opened without knowing about the Alt key', () => {
  /*
   * It already held the version, the platform and the cloud this till
   * syncs with. What it did not have was a route: Help > About lives on a
   * menu bar that is hidden until somebody presses Alt, which is not
   * something a shop can be talked through down a telephone.
   */
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  const at = main.indexOf("ipcMain.handle('desktop:open'");
  assert.ok(at > 0, 'the open bridge is gone');
  const body = main.slice(at, main.indexOf('});', at));
  assert.match(body, /case 'about': openAboutWindow\(\); break;/,
    'About cannot be opened from inside the app');

  const dash = fs.readFileSync(path.join(ROOT, 'frontend', 'dashboard.html'), 'utf8');
  assert.match(dash, /addItem\([^)]*'about'\)/,
    'nothing on screen opens it, so the target is unreachable');
});

test('the badge rides both bundles, or it is on neither page', () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'pages_css_js_map.json'), 'utf8'));
  for (const page of ['dashboard', 'login']) {
    assert.ok(map[page].js.includes('static/script/js/core/version-badge.js'),
      page + ' does not load version-badge.js, so its version line stays empty');
  }
});

test('both pages carry somewhere to put it', () => {
  const header = fs.readFileSync(path.join(ROOT, 'frontend', 'layouts', 'header.html'), 'utf8');
  const login = fs.readFileSync(path.join(ROOT, 'frontend', 'login.html'), 'utf8');
  assert.match(header, /id="posnic_version_line"/, 'the profile menu has no version row');
  assert.match(header, /posnic-version-number/, 'the row has nowhere to write the number');
  assert.match(header, /posnic-version-build/, 'the row has nowhere to write the build');
  assert.match(login, /id="posnic_version_login"/, 'the sign-in screen has no version line');
});
