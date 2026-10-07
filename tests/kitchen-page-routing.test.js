'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('../api/node_modules/express');

test('kitchen entry redirects once and serves the page and assets', async (t) => {
  const source = fs.readFileSync(path.join(__dirname, '../api/app.js'), 'utf8');
  const start = source.indexOf('app.get(/^\\/kitchen$/');
  assert.ok(start >= 0);
  const end = source.indexOf("app.use(['/api/mobile/v1'", start);
  const app = express();
  new Function('app', 'path', '__dirname', 'fs', source.slice(start, end))(app, path, path.join(__dirname, '../api'), fs);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const get = url => fetch('http://127.0.0.1:' + server.address().port + url, { redirect: 'manual' });
  const redirect = await get('/kitchen');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/kitchen/');
  const page = await get('/kitchen/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /html/);
  assert.equal((await get('/kitchen/index.html')).status, 200);
  const asset = await get('/kitchen/board.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('cache-control'), 'no-store');
  assert.equal((await get('/kitchen/i18n.js')).status, 200);
  assert.equal((await get('/kitchen/i18n.js?v=20261007')).status, 200);
  const locales = fs.readdirSync(path.join(__dirname, '../api/src/kitchen-board/locales'));
  for (const file of locales) {
    const response = await get('/kitchen/locales/' + file);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-type'), /json/, file);
    assert.ok(await response.json(), file);
  }
  assert.equal((await get('/kitchen/locales/unknown.json')).status, 404);
});
