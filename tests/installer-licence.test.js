/*
 * The installer never showed a licence.
 *
 * `nsis.license` was undefined, so the wizard went straight from welcome to
 * install location. Posnic is AGPL-3.0 and it also links to a paid cloud
 * service, and a shop was never once shown either the licence or the fact that
 * this is a beta holding their sales with no warranty.
 *
 * The file leads with plain language and puts the AGPL text after it. Nobody
 * reads 34 KB of legalese in an installer, and the parts that actually matter
 * to a shopkeeper - keep your own backups, no warranty, your data stays here -
 * are the parts that would be lost at the bottom of it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

test('the installer shows a licence before installing', () => {
  assert.ok(
    pkg.build.nsis.license,
    'nsis.license is not set, so the wizard never shows terms at all',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, pkg.build.nsis.license)),
    `${pkg.build.nsis.license} does not exist, and electron-builder fails the build rather than skipping it`,
  );
});

test('and it is a wizard that has a page to show it on', () => {
  /* A oneClick installer has no pages: it starts copying files the moment it
     is run. Setting a licence on one silently does nothing. */
  assert.strictEqual(
    pkg.build.nsis.oneClick,
    false,
    'the installer is oneClick, which has no licence page to show',
  );
});

test('the licence says the things a shopkeeper needs to know', () => {
  const text = fs.readFileSync(path.join(ROOT, pkg.build.nsis.license), 'utf8');

  /* Each of these is something they cannot find out later at no cost. */
  assert.match(text, /BETA/i, 'it does not say this is a beta');
  assert.match(text, /backup/i, 'it does not tell them to keep their own backups');
  assert.match(text, /NO WARRANTY|without warranty/i, 'it does not disclaim warranty');
  assert.match(text, /AGPL-3\.0|Affero/i, 'it does not name the licence');
});

test('the plain words come before the legal ones', () => {
  /* The AGPL preamble is 4 KB before it reaches anything a shop cares about.
     Put first, it guarantees nobody reads the part that matters. */
  const text = fs.readFileSync(path.join(ROOT, pkg.build.nsis.license), 'utf8');
  const plain = text.search(/keep your own backups/i);
  const legal = text.search(/GNU AFFERO GENERAL PUBLIC LICENSE/);

  assert.ok(plain > -1 && legal > -1, 'one of the two sections is missing');
  assert.ok(plain < legal, 'the AGPL text comes before the plain-language summary');
});

test('the full licence really is included, not just referenced', () => {
  /* AGPL section 4 requires the licence to travel with the program. A summary
     that only links to it does not satisfy that, and the installer is the one
     place every user passes through. */
  const text = fs.readFileSync(path.join(ROOT, pkg.build.nsis.license), 'utf8');
  assert.match(text, /TERMS AND CONDITIONS/, 'the licence body is missing');
  assert.match(text, /Disclaimer of Warranty/i, 'section 15 is missing');
  assert.ok(text.length > 30000, `only ${text.length} bytes - the full text is not there`);
});
