/*
 * The credential file, which the till needs to reach its own database.
 *
 * Nine files used to read this path directly. Encrypting the password in nine
 * places would have meant nine chances to get the migration wrong, so it
 * happens in credentials-store.js and these tests cover the cases that would
 * otherwise only show up on a shop counter:
 *
 *   - an install made before encryption still reads
 *   - the password is not in the file afterwards, and neither is the uri that
 *     used to carry it
 *   - the derived port survives, because it differs per install
 *   - an unreadable key reports itself rather than silently making a new one
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../src/credentials-store');
const lc = require('../src/local-crypto');

const PASSWORD = 'JstHH8Az3bJaqE*^9YUM';
const USERNAME = 'posnic_admin';

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-creds-'));
  return { dir, file: path.join(dir, store.CREDENTIALS_FILE) };
}

/* No keystore: the branch a plain node script and most Linux desktops take. */
const NO_KEYSTORE = null;

test('a round trip returns what went in', () => {
  const { dir, file } = scratch();
  store.write([file], { username: USERNAME, password: PASSWORD }, dir, NO_KEYSTORE);

  const got = store.read([file], dir, NO_KEYSTORE);
  assert.strictEqual(got.username, USERNAME);
  assert.strictEqual(got.password, PASSWORD);
  assert.strictEqual(got.wasPlaintext, false);
});

test('the password is not in the file, and neither is a uri carrying it', () => {
  const { dir, file } = scratch();
  store.write(
    [file],
    {
      username: USERNAME,
      password: PASSWORD,
      uri: `mongodb://${USERNAME}:${PASSWORD}@localhost:47590/PosnicPro?authSource=admin`,
    },
    dir,
    NO_KEYSTORE
  );

  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes(PASSWORD), 'the password is still readable in the file');
  assert.ok(!onDisk.includes('JstHH'), 'a fragment of the password survived');
  /* The username is deliberately readable - it is not a secret and it makes the
     file diagnosable by someone entitled to look. */
  assert.ok(onDisk.includes(USERNAME));
});

test('the rebuilt uri keeps the derived port and database', () => {
  /* Ports are derived per install, so assuming 47017 would connect a branded
     till to the wrong server - or to nothing. */
  const { dir, file } = scratch();
  store.write(
    [file],
    {
      username: USERNAME,
      password: PASSWORD,
      uri: `mongodb://${USERNAME}:${PASSWORD}@localhost:47590/PosnicPro?authSource=admin`,
    },
    dir,
    NO_KEYSTORE
  );

  const got = store.read([file], dir, NO_KEYSTORE);
  const url = new URL(got.uri);
  assert.strictEqual(url.port, '47590');
  assert.strictEqual(url.pathname, '/PosnicPro');
  assert.strictEqual(url.searchParams.get('authSource'), 'admin');
  assert.strictEqual(decodeURIComponent(url.password), PASSWORD);
});

test('a password with URL-significant characters survives the round trip', () => {
  /* The generator emits ! @ # $ % ^ & *, and an unescaped @ or / would split
     the connection string in the wrong place. */
  const { dir, file } = scratch();
  const awkward = 'a@b:c/d?e#f&g=h%i';
  store.write([file], { username: USERNAME, password: awkward }, dir, NO_KEYSTORE);

  const got = store.read([file], dir, NO_KEYSTORE);
  assert.strictEqual(got.password, awkward);
  assert.strictEqual(decodeURIComponent(new URL(got.uri).password), awkward);
});

test('an install made before encryption still reads, and says so', () => {
  /* Every existing shop has this file. If it stopped being readable, the till
     could not reach its own database after an update. */
  const { dir, file } = scratch();
  fs.writeFileSync(
    file,
    JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
      uri: `mongodb://${USERNAME}:${PASSWORD}@localhost:47590/PosnicPro?authSource=admin`,
      created: '2026-01-01T00:00:00.000Z',
    })
  );

  const got = store.read([file], dir, NO_KEYSTORE);
  assert.strictEqual(got.password, PASSWORD);
  assert.strictEqual(got.wasPlaintext, true, 'the caller needs to know to rewrite it');
  assert.strictEqual(got.created, '2026-01-01T00:00:00.000Z', 'other fields must survive');
});

test('rewriting a plaintext install encrypts it without changing what it means', () => {
  const { dir, file } = scratch();
  const original = {
    username: USERNAME,
    password: PASSWORD,
    uri: `mongodb://${USERNAME}:${PASSWORD}@localhost:47590/PosnicPro?authSource=admin`,
  };
  fs.writeFileSync(file, JSON.stringify(original));

  const before = store.read([file], dir, NO_KEYSTORE);
  store.write([file], before, dir, NO_KEYSTORE);
  const after = store.read([file], dir, NO_KEYSTORE);

  assert.strictEqual(after.username, before.username);
  assert.strictEqual(after.password, before.password);
  assert.strictEqual(new URL(after.uri).port, '47590');
  assert.strictEqual(after.wasPlaintext, false);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(PASSWORD));
});

test('the first existing candidate wins, and missing ones are skipped', () => {
  const { dir } = scratch();
  const missing = path.join(dir, 'nowhere', store.CREDENTIALS_FILE);
  const real = path.join(dir, store.CREDENTIALS_FILE);
  store.write([real], { username: USERNAME, password: PASSWORD }, dir, NO_KEYSTORE);

  const got = store.read([missing, real], dir, NO_KEYSTORE);
  assert.strictEqual(got.password, PASSWORD);
  assert.strictEqual(got.path, real);
});

test('nothing anywhere returns null rather than throwing', () => {
  const { dir } = scratch();
  assert.strictEqual(store.read([path.join(dir, 'absent.json')], dir, NO_KEYSTORE), null);
});

test('a corrupt file is skipped in favour of the next candidate', () => {
  const { dir } = scratch();
  const broken = path.join(dir, 'broken.json');
  const good = path.join(dir, store.CREDENTIALS_FILE);
  fs.writeFileSync(broken, '{ this is not json');
  store.write([good], { username: USERNAME, password: PASSWORD }, dir, NO_KEYSTORE);

  const got = store.read([broken, good], dir, NO_KEYSTORE);
  assert.strictEqual(got.password, PASSWORD);
});

test('the key is created once and reused', () => {
  const { dir } = scratch();
  const first = store.getOrCreateKey(dir, NO_KEYSTORE);
  const second = store.getOrCreateKey(dir, NO_KEYSTORE);
  assert.strictEqual(first, second, 'a new key each time would orphan the credential');
  assert.ok(store.hasKey(dir));
});

test('a lost key reports itself rather than quietly making a new one', () => {
  /* This is the rotation signal. Silently generating a fresh key would leave
     the stored credential undecryptable with no explanation, and the caller
     would have no way to know it should recreate the database user. */
  const { dir, file } = scratch();
  store.write([file], { username: USERNAME, password: PASSWORD }, dir, NO_KEYSTORE);

  fs.writeFileSync(path.join(dir, store.KEY_FILE), '{ not json');
  assert.throws(
    () => store.read([file], dir, NO_KEYSTORE),
    (e) => e.code === 'DECRYPTION_FAILED',
  );
});

test('a credential encrypted under a different key fails cleanly', () => {
  /* The file copied from another machine, or restored from someone else's
     backup. It must not decrypt, and it must not look like corruption. */
  const a = scratch();
  const b = scratch();
  store.write([a.file], { username: USERNAME, password: PASSWORD }, a.dir, NO_KEYSTORE);

  fs.copyFileSync(a.file, b.file);
  store.getOrCreateKey(b.dir, NO_KEYSTORE); // b has its own, different key

  assert.throws(
    () => store.read([b.file], b.dir, NO_KEYSTORE),
    (e) => e.code === 'DECRYPTION_FAILED',
  );
});

test('the key file is not world readable', () => {
  const { dir } = scratch();
  store.getOrCreateKey(dir, NO_KEYSTORE);
  const mode = fs.statSync(path.join(dir, store.KEY_FILE)).mode & 0o777;
  /* Windows ignores POSIX modes, so this only asserts what it can: that we ask
     for owner-only rather than leaving the default. */
  assert.ok((mode & 0o077) === 0 || process.platform === 'win32');
});

test('an unwritable target does not lose the writable ones', () => {
  /* Packaged installs have read-only directories among their candidates. */
  const { dir, file } = scratch();
  const impossible = path.join(' invalid', store.CREDENTIALS_FILE);
  const written = store.write([impossible, file], { username: USERNAME, password: PASSWORD }, dir, NO_KEYSTORE);

  assert.deepStrictEqual(written, [file]);
  assert.strictEqual(store.read([file], dir, NO_KEYSTORE).password, PASSWORD);
});
