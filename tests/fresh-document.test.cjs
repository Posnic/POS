'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const request = (url, options = {}) => new Promise((resolve, reject) => http.get(url, options, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name] }, text: async () => body })); }).on('error', reject));
const express = require('../api/node_modules/express');
const freshDocument = require('../api/src/middleware/fresh-document');

test('rollback delivers HTML despite newer cached date, while hashed assets still revalidate', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-document-'));
  fs.writeFileSync(path.join(dir, 'dashboard.html'), '<script src="dashboard.12345678.js"></script>');
  fs.writeFileSync(path.join(dir, 'dashboard.12345678.js'), '/* retained asset */');
  fs.utimesSync(path.join(dir, 'dashboard.html'), new Date('2020-01-01'), new Date('2020-01-01'));
  const app = express();
  app.use(freshDocument);
  app.use(express.static(dir));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const headers = { 'If-Modified-Since': 'Tue, 20 Oct 2026 00:00:00 GMT' };
    const response = await request(`${origin}/dashboard.html`, { headers });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /12345678/);
    const same = await request(`${origin}/dashboard.html`, { headers: { 'If-None-Match': response.headers.get('etag') } });
    assert.equal(same.status, 200);
    const asset = await request(`${origin}/dashboard.12345678.js`);
    assert.equal((await request(`${origin}/dashboard.12345678.js`, { headers: { 'If-None-Match': asset.headers.get('etag') } })).status, 304);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

