'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Manager = require('../src/sync-agent-manager');
const store = require('../src/credentials-store');

test('sync uses decrypted current credentials and preserves the isolated database port', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-credentials-'));
  const file = path.join(root, store.CREDENTIALS_FILE);
  store.write([file], {username:'test_admin',password:'test-only-secret',uri:'mongodb://127.0.0.1:47591/PosnicPro?authSource=admin'},root,null);
  const raw = JSON.parse(fs.readFileSync(file));
  assert.equal(raw.enc, 1);
  assert.ok(!raw.uri.includes('test-only-secret'));
  const manager = new Manager({app:{getPath:()=>root},credentialReader:(f,b)=>store.read([f],b,null)});
  const url = new URL(manager._localUri({localUri:'mongodb://stale:old@localhost:27017'}));
  assert.equal(url.username,'test_admin');
  assert.equal(url.password,'test-only-secret');
  assert.equal(url.port,'47591');
  assert.equal(url.searchParams.get('authSource'),'admin');
});

test('failed credential decryption cannot silently fall back to a stale URI', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-credentials-'));
  fs.writeFileSync(path.join(root,store.CREDENTIALS_FILE),'{}');
  const manager = new Manager({app:{getPath:()=>root},credentialReader:()=>{throw Error('decryption failed');}});
  assert.throws(()=>manager._localUri({localUri:'mongodb://stale'}),/decryption failed/);
});
