'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readExtensionFile } = require('../src/extension-file');

test('extension reads reject oversized files, directories and links', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-read-'));
  try {
    const file = path.join(directory, 'data');
    fs.writeFileSync(file, 'signed');
    assert.equal(readExtensionFile(file, 6).toString(), 'signed');
    assert.throws(() => readExtensionFile(file, 5));
    assert.throws(() => readExtensionFile(directory, 100));
    const link = path.join(directory, 'linked');
    fs.symlinkSync(directory, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => readExtensionFile(link, 100));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('growth after descriptor inspection cannot escape the read limit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-read-'));
  const file = path.join(directory, 'data');
  fs.writeFileSync(file, 'signed');
  const original = fs.fstatSync;
  try {
    fs.fstatSync = function (fd) {
      const result = original(fd);
      fs.appendFileSync(file, 'changed');
      return result;
    };
    assert.throws(() => readExtensionFile(file, 6), /extension_file_invalid/);
  } finally {
    fs.fstatSync = original;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
