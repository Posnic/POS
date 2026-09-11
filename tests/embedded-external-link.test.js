'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'embedded-external-link.html'),
  'utf8',
);
const MAIN = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');

function productionPopupHandler(shell) {
  const handlerAt = MAIN.indexOf('mainWindow.webContents.setWindowOpenHandler(');
  assert.ok(handlerAt > -1, 'the main window has no popup handler');
  const bodyOpen = MAIN.indexOf('{', MAIN.indexOf('=>', handlerAt));
  let depth = 0;
  let bodyClose = -1;
  for (let i = bodyOpen; i < MAIN.length; i++) {
    if (MAIN[i] === '{') depth++;
    if (MAIN[i] === '}' && --depth === 0) {
      bodyClose = i;
      break;
    }
  }
  assert.ok(bodyClose > bodyOpen, 'the popup handler body is not balanced');
  const callback = MAIN.slice(MAIN.indexOf('(({ url }) =>', handlerAt) + 1, bodyClose + 1);
  return new Function('shell', 'mainWindow', `return ${callback};`)(shell, {
    webContents: { downloadURL() {} },
  });
}

function fixtureLinks() {
  return [...FIXTURE.matchAll(/<a\s+href="([^"]+)"[^>]*target="_blank"/g)].map((match) => match[1]);
}

test('the embedded link fixture is synthetic and offline', () => {
  assert.deepStrictEqual(fixtureLinks(), [
    'https://example.com/help',
    'javascript:alert(1)',
    'file:///etc/passwd',
  ]);
  assert.doesNotMatch(FIXTURE, /<(script|iframe|img|link)\b/i);
  for (const href of fixtureLinks().filter((value) => /^https?:\/\//i.test(value))) {
    assert.match(href, /^https:\/\/example\.com\/help$/i);
  }
});

test('safe embedded links use the production external-browser path', () => {
  const opened = [];
  const handler = productionPopupHandler({
    openExternal: (url) => { opened.push(url); },
  });

  assert.deepStrictEqual(handler({ url: fixtureLinks()[0] }), { action: 'deny' });
  assert.deepStrictEqual(opened, ['https://example.com/help']);
});

test('unsafe embedded schemes are denied without reaching the external browser', () => {
  const opened = [];
  const handler = productionPopupHandler({
    openExternal: (url) => { opened.push(url); },
  });

  for (const url of fixtureLinks().slice(1)) {
    assert.deepStrictEqual(handler({ url }), { action: 'deny' }, url);
  }
  assert.deepStrictEqual(opened, []);
});
