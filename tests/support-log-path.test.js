/*
 * The log path in the docs must be the log path in the code.
 *
 * "Send me your log file" is the first thing support says, and four documents
 * sent people to a directory that has never existed. main.js writes to
 * path.join(app.getPath('userData'), 'app.log'); SUPPORT.md, CONTRIBUTING.md,
 * docs/DEVELOPMENT.md and docs/USER_GUIDE.md all described a logs/ subfolder,
 * a capitalised app folder, and - on macOS - ~/Library/Logs, which is
 * electron-log's default rather than the location this application uses.
 *
 * Nobody would notice until a shop could not sell and could not find the file
 * that says why.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const DOCS = ['.github/SUPPORT.md', '.github/CONTRIBUTING.md', 'docs/DEVELOPMENT.md', 'docs/USER_GUIDE.md'];

/*
 * Electron's userData is %APPDATA%\<name> on Windows,
 * ~/Library/Application Support/<name> on macOS and ~/.config/<name> on Linux,
 * where <name> is package.json's "name" - lowercase, not the product name.
 */
const APP_NAME = require(path.join(ROOT, 'package.json')).name;

test('main.js still writes the log directly under userData', () => {
  const main = read('src/main.js');
  assert.match(
    main,
    /const LOG_FILE = path\.join\(app\.getPath\('userData'\), 'app\.log'\)/,
    'the log location moved; the documents below need to move with it',
  );
});

test('no document invents a logs/ subdirectory', () => {
  const wrong = [];
  for (const doc of DOCS) {
    read(doc)
      .split('\n')
      .forEach((line, i) => {
        if (/[\\/]logs[\\/]app\.log/.test(line)) wrong.push(`${doc}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepStrictEqual(
    wrong,
    [],
    'these send users to a logs/ folder the application never creates:\n  ' + wrong.join('\n  '),
  );
});

test('no document sends macOS users to ~/Library/Logs', () => {
  const wrong = [];
  for (const doc of DOCS) {
    read(doc)
      .split('\n')
      .forEach((line, i) => {
        if (/~\/Library\/Logs/.test(line)) wrong.push(`${doc}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepStrictEqual(
    wrong,
    [],
    "~/Library/Logs is electron-log's default, not where this application " +
      'writes. userData on macOS is ~/Library/Application Support/<name>:\n  ' +
      wrong.join('\n  '),
  );
});

test('every document names the same three paths, and they match the app name', () => {
  const expected = [
    `%APPDATA%\\${APP_NAME}\\app.log`,
    `~/Library/Application Support/${APP_NAME}/app.log`,
    `~/.config/${APP_NAME}/app.log`,
  ];

  for (const doc of DOCS) {
    const text = read(doc);
    for (const wanted of expected) {
      assert.ok(
        text.includes(wanted),
        `${doc} does not mention ${wanted}. The application folder is ` +
          `package.json's "name" (${APP_NAME}), which is what Electron uses ` +
          'for userData - not the product name.',
      );
    }
  }
});
