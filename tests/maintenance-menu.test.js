const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * The maintenance tools live in the shell, and have to keep living there.
 *
 * Every one of them is for the case where the app itself is misbehaving - a
 * stuck cache, a window dragged onto a screen that is no longer attached, a log
 * somebody needs to send. A page inside the app cannot be relied upon to open
 * at exactly the moment these are wanted, so if one of these ever migrates into
 * the SPA it stops being a maintenance tool and becomes another thing that
 * breaks when the app breaks.
 *
 * main.js is not requireable outside Electron, so this reads it - which is
 * enough to hold the arrangement and to catch a handler wired to nothing.
 */
const ROOT = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

function menuLabels() {
  const start = main.indexOf('const template = [');
  const end = main.indexOf('Menu.setApplicationMenu');
  return main.slice(start, end);
}

test('there is a Maintenance menu in the shell', () => {
  assert.match(menuLabels(), /label: 'Maintenance'/);
});

test('it carries the tools support actually asks for', () => {
  const menu = menuLabels();
  for (const label of [
    'Clear Cache',
    'Clear Cookies && Sign-in',
    'Open Log Folder',
    'Copy Diagnostics',
    'Save Support Bundle...',
    'Revert Last Update',
    'Reset Window Size && Position',
  ]) {
    assert.ok(menu.includes(label), 'Maintenance menu lost: ' + label);
  }
});

test('every maintenance handler exists', () => {
  // A menu entry wired to a function that was renamed throws on click, in
  // front of somebody already having a bad day.
  for (const fn of [
    'clearHistoryAndCache',
    'clearCookiesAndStorage',
    'openLogFolder',
    'collectDiagnostics',
    'resetWindowState',
    'openAboutWindow',
    'tailLog',
  ]) {
    assert.ok(main.includes('function ' + fn + '('), fn + ' is not defined');
  }
});

test('diagnostics carry what a support call opens with', () => {
  const start = main.indexOf('function collectDiagnostics');
  const body = main.slice(start, start + 2500);
  for (const field of ['version', 'platform', 'machineId', 'deviceId', 'timezone']) {
    assert.ok(body.includes(field), 'diagnostics no longer include ' + field);
  }
});

test('diagnostics do not reach for shop data', () => {
  // It gets handed to support, so it carries the machine's own details and
  // nothing a shop would be uncomfortable sending.
  const start = main.indexOf('function collectDiagnostics');
  const body = main.slice(start, start + 2500);
  for (const f of ['sales', 'customers', 'items', 'password', 'deviceToken']) {
    assert.ok(!body.includes(f), 'diagnostics must not include ' + f);
  }
});

test('About reports the brand the build shipped with', () => {
  // It used to say "Posnic" in every build, including white-labelled ones.
  /* The whole function, not a fixed slice of it. A 3000-character window meant
     anything added above the markup pushed the assertion off the end, and the
     test then passed by not looking. */
  const start = main.indexOf('function openAboutWindow');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  assert.ok(body.includes('d.app.name'), 'About must use the shipped brand name');
  assert.ok(!/<h1>Posnic<\/h1>/.test(body), 'About must not hardcode a brand');
});

test("and does not put the maker's name under someone else's brand", () => {
  /* A white-labelled build carries the reseller's name. "by Posnic Innovations"
     printed beneath it would undo the point of white-labelling, so that line is
     conditional on the shipped brand still being ours. */
  const start = main.indexOf('function openAboutWindow');
  const body = main.slice(start, main.indexOf('\n}\n', start));
  const maker = body.indexOf('Posnic Innovations');
  if (maker === -1) return;
  assert.match(
    body.slice(Math.max(0, maker - 140), maker),
    /d\.app\.name === 'Posnic'/,
    'the maker line must be shown only when the build is unbranded',
  );
});
