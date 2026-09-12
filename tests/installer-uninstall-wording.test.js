'use strict';

/*
 * The uninstaller does not announce an installation.
 *
 * electron-builder compiles builds/installer.nsh twice: once for the
 * installer and once for the uninstaller, with BUILD_UNINSTALLER defined on
 * the second pass. The welcome and finish page texts were defined once, so
 * the last thing a person saw after removing Posnic was "Posnic is
 * installed". Owner: "i saw message like pos installed on the end while
 * uninstalled."
 *
 * Both passes now get their own words, and this keeps them apart.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NSH = fs.readFileSync(path.join(ROOT, 'builds', 'installer.nsh'), 'utf8');

const branches = () => {
  const start = NSH.indexOf('!ifdef BUILD_UNINSTALLER');
  const mid = NSH.indexOf('!else', start);
  const end = NSH.indexOf('!endif', mid);
  assert.ok(start > -1 && mid > start && end > mid, 'the page texts are not split between installer and uninstaller');
  return { uninstall: NSH.slice(start, mid), install: NSH.slice(mid, end) };
};

test('the uninstaller has its own welcome and finish, and neither says installed', () => {
  const { uninstall } = branches();
  assert.match(uninstall, /MUI_WELCOMEPAGE_TITLE "Remove Posnic"/);
  assert.match(uninstall, /MUI_FINISHPAGE_TITLE "Posnic is removed"/);
  assert.ok(!/installed/i.test(uninstall), 'the uninstaller still says "installed"');
  assert.ok(!/MUI_FINISHPAGE_RUN/.test(uninstall), 'the uninstaller offers to start what it just removed');
});

test('the installer keeps its words', () => {
  const { install } = branches();
  assert.match(install, /MUI_WELCOMEPAGE_TITLE "Welcome to Posnic"/);
  assert.match(install, /MUI_FINISHPAGE_TITLE "Posnic is installed"/);
  assert.match(install, /MUI_FINISHPAGE_RUN_TEXT "Start Posnic now"/);
});

test('the uninstaller tells the truth about the data folder', () => {
  /* deleteAppDataOnUninstall is off in package.json, so the data stays. The
     words must say so, and must not offer a choice the uninstaller does not
     give. */
  const build = require(path.join(ROOT, 'package.json')).build;
  assert.strictEqual(build.nsis.deleteAppDataOnUninstall, false);
  const { uninstall } = branches();
  assert.match(uninstall, /not deleted|was kept/);
  assert.ok(!/unless you choose|if you choose/i.test(uninstall), 'the uninstaller promises a choice it does not offer');
});

test('every page define appears exactly once per pass', () => {
  for (const name of ['MUI_WELCOMEPAGE_TITLE', 'MUI_WELCOMEPAGE_TEXT', 'MUI_FINISHPAGE_TITLE', 'MUI_FINISHPAGE_TEXT']) {
    const n = (NSH.match(new RegExp(`!define ${name} `, 'g')) || []).length;
    assert.strictEqual(n, 2, `${name} is defined ${n} times; makensis refuses a redefinition and ignores a missing one`);
  }
});

test('the second pass really is told it is the uninstaller', () => {
  /* Belt and braces: the guard only works if the tool defines the symbol. */
  const template = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'common.nsh');
  if (!fs.existsSync(template)) return; /* dependencies not installed here */
  assert.match(fs.readFileSync(template, 'utf8'), /BUILD_UNINSTALLER/);
});
