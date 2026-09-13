'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'dev', 'serve-order.js'), 'utf8');

test('the development certificate has a private unique temp directory', () => {
  assert.match(
    server,
    /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\), 'posnic-dev-cert-'\)\)/,
    'certificate files must not use a predictable shared temporary path'
  );
  assert.doesNotMatch(
    server,
    /path\.join\(os\.tmpdir\(\), 'posnic-dev-cert'\);/,
    'the old predictable certificate directory must not return'
  );
});
