'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('../api/node_modules/express');
const request = require('../api/node_modules/supertest');

test('kitchen entry redirects once and serves the page and assets', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../api/app.js'), 'utf8');
  const start = source.indexOf('app.get(/^\\/kitchen$/');
  assert.ok(start >= 0);
  const end = source.indexOf("app.use(['/api/mobile/v1'", start);
  const app = express();
  new Function('app', 'path', '__dirname', source.slice(start, end))(app, path, path.join(__dirname, '../api'));
  await request(app).get('/kitchen').expect(302).expect('Location', '/kitchen/');
  await request(app).get('/kitchen/').expect(200).expect('Content-Type', /html/);
  await request(app).get('/kitchen/index.html').expect(200);
  await request(app).get('/kitchen/board.js').expect(200).expect('Cache-Control', 'no-store');
});
