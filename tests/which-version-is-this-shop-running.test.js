'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const jquery = require('jquery');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'frontend/static/script/js/core/version-badge.js'), 'utf8');
const ABOUT = fs.readFileSync(path.join(ROOT, 'frontend/layouts/about.html'), 'utf8');
const BOOTSTRAP = fs.readFileSync(path.join(ROOT, 'frontend/static/script/js/bootstrap.min.js'), 'utf8');
const DASH = ['script/jquery.min.js', 'script/dashboard.2eca0dab.js'];
const settled = () => new Promise((resolve) => setImmediate(resolve));

async function run(t, opts = {}) {
  const markup = opts.login ? '<small id="posnic_version_login"></small>' : ABOUT;
  const dom = new JSDOM(markup.replace('modal fade', 'modal') +
    (opts.scripts || DASH).map(src => '<script src="' + src + '"></script>').join(''),
    { url: 'https://shop.example/dashboard.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const $ = jquery(window);
  window.jQuery = window.$ = $;
  window.eval(BOOTSTRAP);
  const asked = [];
  const copied = [];
  window.PosnicPro = {
    i18n: { t: (key, fallback) => fallback },
    get(url, ok, fail) {
      asked.push(url);
      if (opts.serverVersion === null) { fail(); return; }
      ok({ data: { version: opts.serverVersion || '1.6.1' } });
    },
  };
  if (opts.appVersion) {
    window.electronAPI = {
      desktop: { capabilities: () => Promise.resolve({ version: opts.appVersion }) },
    };
  }
  Object.defineProperty(window.navigator, 'clipboard', { value: {
    writeText: (value) => {
      if (opts.clipboardDenied) return Promise.reject(new Error('Clipboard blocked'));
      copied.push(value);
      return Promise.resolve();
    },
  } });
  const fallbackCopies = [];
  window.document.execCommand = (command) => {
    assert.equal(command, 'copy');
    fallbackCopies.push(window.document.querySelector('textarea').value);
    return opts.fallbackWorks === true;
  };
  window.eval(SRC);
  await settled();
  const node = (id) => window.document.getElementById(id);
  const open = async () => {
    window.document.querySelector('.posnic-about-link').click();
    await settled();
  };
  return { window, $, node, open, asked, copied, fallbackCopies };
}

test('desktop details distinguish the installed app, page and server versions', async (t) => {
  const { node, open } = await run(t, { appVersion: '1.6.1', serverVersion: '1.7.0' });
  assert.equal(node('posnic_version_line').textContent, 'Posnic 1.6.1');
  assert.equal(node('posnic_version_line').hidden, false);
  await open();
  assert.equal(node('posnic_about_dialog').getAttribute('aria-modal'), 'true');
  assert.equal(node('posnic_about_mode').textContent, 'Desktop');
  assert.equal(node('posnic_about_app').textContent, '1.6.1');
  assert.equal(node('posnic_about_app').hidden, false);
  assert.equal(node('posnic_about_server').textContent, '1.7.0');
  assert.equal(node('posnic_about_page').textContent, '2eca0dab');
});

test('browser details omit the desktop version without losing the server or page', async (t) => {
  const { node, open } = await run(t);
  await open();
  assert.equal(node('posnic_about_mode').textContent, 'Browser');
  assert.equal(node('posnic_about_app').hidden, true);
  assert.equal(node('posnic_about_app_label').hidden, true);
  assert.equal(node('posnic_about_server').textContent, '1.6.1');
  assert.equal(node('posnic_about_page').textContent, '2eca0dab');
});

test('viewing details never copies; only Copy details does, with written confirmation', async (t) => {
  const { node, open, copied, $ } = await run(t, { appVersion: '1.6.1', serverVersion: '1.7.0' });
  node('posnic_version_line').click();
  await open();
  assert.deepEqual(copied, []);
  assert.equal(node('posnic_about_copy_status').textContent, '');
  node('posnic_about_copy').click();
  await settled();
  assert.deepEqual(copied, ['Posnic 1.6.1 | desktop | page 2eca0dab | server 1.7.0']);
  assert.equal(node('posnic_about_copy_status').textContent, 'Details copied to clipboard.');
  assert.equal(node('posnic_about_copy_status').getAttribute('role'), 'status');
  $('#posnic_about_dialog').modal('hide');
  await open();
  assert.equal(node('posnic_about_copy_status').textContent, '');
  node('posnic_about_copy').click();
  await settled();
  assert.equal(copied.length, 2, 'reopening must not accumulate click handlers');
});

test('a denied clipboard falls back inside the dialog and restores button focus', async (t) => {
  const { node, open, fallbackCopies, window } = await run(t, { clipboardDenied: true, fallbackWorks: true });
  await open();
  node('posnic_about_copy').focus();
  node('posnic_about_copy').click();
  await settled();
  assert.equal(fallbackCopies.length, 1);
  assert.match(node('posnic_about_copy_status').textContent, /Details copied/);
  assert.equal(window.document.activeElement, node('posnic_about_copy'));
  assert.equal(window.document.querySelector('textarea'), null);
});

test('clipboard failure explains how to copy manually and never claims success', async (t) => {
  const { node, open } = await run(t, { clipboardDenied: true });
  await open();
  node('posnic_about_copy').click();
  await settled();
  assert.equal(node('posnic_about_copy_status').textContent,
    'Could not copy. Select the details above to copy them manually.');
});

test('an unavailable server still leaves the known page build available', async (t) => {
  const { node, open } = await run(t, { serverVersion: null });
  await open();
  assert.equal(node('posnic_about_server').textContent, 'Unavailable');
  assert.equal(node('posnic_about_copy').disabled, false);
});

test('unavailable versions do not show a misleading footer version or enable copying', async (t) => {
  const { node, open } = await run(t, { scripts: ['script/dashboard.js'], serverVersion: null });
  assert.equal(node('posnic_version_line').hidden, true);
  await open();
  assert.equal(node('posnic_about_server').textContent, 'Unavailable');
  assert.equal(node('posnic_about_page').textContent, 'Unavailable');
  assert.equal(node('posnic_about_copy').disabled, true);
});

test('the sign-in screen shows its known versions without asking the protected API', async (t) => {
  const { node, asked } = await run(t, { login: true, scripts: ['script/login.91f31103.js'], appVersion: '1.6.1' });
  assert.deepEqual(asked, []);
  assert.equal(node('posnic_version_login').textContent, 'Posnic 1.6.1 · 91f31103');
});

test('browser sign-in can identify the page without a desktop shell or session', async (t) => {
  const { node, asked } = await run(t, { login: true, scripts: ['script/login.91f31103.js'] });
  assert.deepEqual(asked, []);
  assert.equal(node('posnic_version_login').textContent, 'Posnic · 91f31103');
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

test('version details are reachable from the footer, outside the account menu', () => {
  const header = fs.readFileSync(path.join(ROOT, 'frontend/layouts/header.html'), 'utf8');
  const dash = fs.readFileSync(path.join(ROOT, 'frontend/dashboard.html'), 'utf8');
  const login = fs.readFileSync(path.join(ROOT, 'frontend/login.html'), 'utf8');
  assert.doesNotMatch(header, /posnic_version_line|posnic-version-copied/);
  assert.match(dash, /layouts\/about\.html/);
  assert.match(ABOUT, /data-target="#posnic_about_dialog"/);
  assert.match(login, /id="posnic_version_login"/);
});

// The production HTML assembler only includes files registered in this map.
test('the About dialog ships inside the built dashboard', (t) => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/pages_html_map.json'), 'utf8'));
  assert.ok(map.files.includes('layouts/about.html'));
  const built = path.join(ROOT, 'frontend/public/dashboard.html');
  if (!fs.existsSync(built)) { t.skip('Run the frontend build to verify its output'); return; }
  const html = fs.readFileSync(built, 'utf8');
  assert.match(html, /id="posnic_about_dialog"/);
  assert.match(html, /id="posnic_about_copy"/);
  assert.doesNotMatch(html, /posnic-version-copied/);
});
