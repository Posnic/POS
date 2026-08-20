/*
 * Posnic's bundled mongod binds to 127.0.0.1. On Linux, `localhost` can
 * resolve to ::1 first; the database then starts successfully while the API
 * reports ECONNREFUSED. These checks keep every desktop-owned connection on
 * the same loopback interface and migrate credentials created by older builds.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const credentialsStore = require('../credentials-store');

const DESKTOP_DATABASE_FILES = [
  'main.js',
  'backup-manager.js',
  'credentials-store.js',
  'setup-mongodb.js',
  path.join('api', 'src', 'services', 'install.service.js'),
];

test('desktop-owned MongoDB URIs use the interface mongod binds to', () => {
  const manager = fs.readFileSync(path.join(ROOT, 'mongodb-manager.js'), 'utf8');
  assert.match(manager, /'--bind_ip',\s*'127\.0\.0\.1'/);

  for (const file of DESKTOP_DATABASE_FILES) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      source,
      /mongodb:\/\/localhost/,
      `${file} can resolve the bundled database as ::1 while mongod listens on 127.0.0.1`,
    );
  }
});

test('credentials from older builds migrate from localhost to IPv4 loopback', () => {
  const uri = credentialsStore.buildUri(
    { username: 'shop', password: 'p@ss' },
    'mongodb://localhost:47590/PosnicPro?authSource=admin',
  );

  assert.strictEqual(
    uri,
    'mongodb://shop:p%40ss@127.0.0.1:47590/PosnicPro?authSource=admin',
  );
});

test('credential migration preserves explicitly configured remote hosts', () => {
  const uri = credentialsStore.buildUri(
    { username: 'shop', password: 'secret' },
    'mongodb://db.example.com:27017/PosnicPro?tls=true',
  );

  assert.strictEqual(
    uri,
    'mongodb://shop:secret@db.example.com:27017/PosnicPro?tls=true',
  );
});

test('database failure help does not give Windows-only or false install advice', () => {
  const source = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const start = source.indexOf('<h1>Posnic could not start its local database</h1>');
  const end = source.indexOf('`)}`);', start);

  assert.ok(start >= 0 && end > start, 'database failure help was not found');
  const help = source.slice(start, end);
  assert.match(help, /includes its own database/i);
  assert.doesNotMatch(help, /\.bat|net start MongoDB|download from:|install with/i);
});
