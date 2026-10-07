'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = path.join(__dirname, '..', 'scripts', 'prepare-api-runtime.js');
const source = fs.readFileSync(script, 'utf8');

for (const result of [
  { status: 1, stdout: '/api/node_modules/express\n', stderr: 'missing: @aws-sdk/client-textract' },
  { status: null, stdout: '', error: new Error('npm could not start') },
]) {
  test(`API packaging rejects incomplete dependency inspection (${result.status}) before using a cache`, () => {
    let archiveTouched = false;
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => { archiveTouched = true; throw new Error('unexpected cache access'); },
      readdirSync: () => { archiveTouched = true; throw new Error('unexpected archive filtering'); },
    };
    assert.throws(() => vm.runInNewContext(source, {
      __dirname: path.dirname(script),
      process,
      console,
      require(name) {
        if (name === 'fs') return fakeFs;
        if (name === 'child_process') return { spawnSync: () => result };
        if (name === '7zip-bin') return { path7za: '/unused/7za' };
        return require(name);
      },
    }), /API production dependencies are incomplete/);
    assert.equal(archiveTouched, false);
  });
}
