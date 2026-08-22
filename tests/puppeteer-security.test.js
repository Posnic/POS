'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const apiPackage = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8')
);
const apiLock = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'api', 'package-lock.json'), 'utf8')
);

test('WhatsApp uses the reviewed Puppeteer 25 compatibility override', () => {
  const override = apiPackage.overrides?.['whatsapp-web.js']?.puppeteer;

  assert.equal(override, '25.4.0');
  assert.equal(apiLock.packages['node_modules/puppeteer']?.version, override);
  assert.equal(
    apiLock.packages['node_modules/@puppeteer/browsers']?.version,
    '3.0.6'
  );
});

test('the vulnerable extract-zip package cannot return unnoticed', () => {
  assert.equal(apiLock.packages['node_modules/extract-zip'], undefined);
});
