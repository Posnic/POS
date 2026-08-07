/*
 * credentials-store.js is required from both sides of the asar boundary, and a
 * file cannot live on both. This is not obvious from reading the source, and
 * getting it wrong fails in two different invisible ways.
 *
 * setup-mongodb.js and the API's install.service.js are extraResources - they
 * run from resources/, outside the archive - and require the store by a
 * relative path. main.js is inside the asar and requires it too. Listing it in
 * build.files as well as extraResources does not put it in both places:
 * electron-builder drops a file from the archive when extraResources already
 * copies it, so main.js is left requiring something that is not there. Listing
 * it in build.files alone breaks the other two, and that failure is silent -
 * install.service.js catches it and writes the password in plain text, which is
 * exactly what this whole change exists to stop.
 *
 * So it ships once, in resources/, and main.js reaches it by absolute path.
 *
 * check-packaged-modules.js does not catch either mistake: it walks requires
 * from the asar entry point, and cannot follow a path built at run time.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

/* Modules that are required from both sides of the asar boundary. */
const NEEDED_BOTH_SIDES = ['credentials-store.js', 'local-crypto.js'];

test('the credential modules ship in resources/, beside the code that requires them', () => {
  const extra = pkg.build.extraResources
    .filter((r) => typeof r.from === 'string')
    .map((r) => r.from);

  for (const file of NEEDED_BOTH_SIDES) {
    assert.ok(
      extra.includes(file),
      `${file} is not in extraResources. setup-mongodb.js and the API's ` +
        'install.service.js run from resources/, outside the asar, and require ' +
        'it relatively - without this they silently fall back to writing the ' +
        'database password in plain text.',
    );
  }
});

test('and are kept out of the asar, because they cannot be in both', () => {
  for (const file of NEEDED_BOTH_SIDES) {
    assert.ok(
      !pkg.build.files.includes(file),
      `${file} is in build.files as well as extraResources. electron-builder ` +
        'resolves that by leaving it out of the asar entirely, so main.js ' +
        'fails with "Cannot find module" in a packaged build while working ' +
        'perfectly from a checkout.',
    );
  }
});

test('so main.js resolves the store by an absolute path, not a sibling require', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  assert.doesNotMatch(
    src,
    /require\(['"]\.\/credentials-store['"]\)/,
    'main.js requires the store as a sibling. It is inside the asar and the ' +
      'store is not - this only works from a checkout.',
  );
  assert.match(
    src,
    /process\.resourcesPath,\s*'credentials-store'/,
    'main.js must resolve the store from process.resourcesPath when packaged',
  );
});

test('setup-mongodb.js resolves the store from where it is packaged', () => {
  /* Packaged, both are at resources/. The relative require has to be a sibling
     lookup, not a walk up into the app directory. */
  const src = fs.readFileSync(path.join(ROOT, 'setup-mongodb.js'), 'utf8');
  assert.match(
    src,
    /require\(['"]\.\/credentials-store['"]\)/,
    'setup-mongodb.js must require the store as a sibling - it is packaged ' +
      'next to it under resources/',
  );
});

test("the API's writer resolves it from resources/, not from inside the asar", () => {
  /* install.service.js is packaged at resources/api/src/services/, so three
     levels up is resources/ - where extraResources puts the store. */
  const file = path.join(ROOT, 'api', 'src', 'services', 'install.service.js');
  const src = fs.readFileSync(file, 'utf8');

  const match = src.match(/require\(path\.join\(__dirname,((?:\s*,?\s*'\.\.')+)\s*,\s*'credentials-store'\)\)/);
  assert.ok(match, 'install.service.js no longer requires credentials-store by a relative path');

  const ups = (match[1].match(/'\.\.'/g) || []).length;
  assert.strictEqual(
    ups,
    3,
    `install.service.js walks up ${ups} levels to find credentials-store. ` +
      'Packaged it sits at resources/api/src/services/, so it must be 3 to ' +
      'land on resources/.',
  );
});

test('the password is never written into .env', () => {
  /*
   * It used to be. _saveDBCredentialsToEnv wrote the whole connection string,
   * password included, into a plain .env sitting next to the encrypted
   * credentials file - so encrypting the other copy achieved nothing. A secret
   * written twice is only as protected as its weakest copy.
   *
   * The username and a credential-free URI still go in, so anything reading
   * .env learns the host, port and database.
   */
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'services', 'install.service.js'),
    'utf8',
  );

  /* Look at the statements that build the .env text, wherever they sit. Every
     variable they interpolate must be one that carries no password. */
  const lines = src.split('\n');
  const envAppends = lines
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /envContent\s*\+=/.test(line) && /MONGODB_URI=/.test(line));

  assert.ok(envAppends.length > 0, 'nothing writes MONGODB_URI to .env any more');

  /* Which variables are interpolated, and are any of them built from the
     password? */
  const passwordBearing = new Set();
  for (const line of lines) {
    const decl = line.match(/const\s+(\w+)\s*=\s*`mongodb:\/\/.*dbPassword/);
    if (decl) passwordBearing.add(decl[1]);
  }

  for (const [lineNo, line] of envAppends) {
    for (const name of line.match(/\$\{(\w+)\}/g)?.map((m) => m.slice(2, -1)) || []) {
      assert.ok(
        !passwordBearing.has(name),
        `install.service.js:${lineNo} writes \${${name}} into .env, and that ` +
          'variable is built from dbPassword. The password must not be written ' +
          'in plain text beside the encrypted credentials file - a secret ' +
          'written twice is only as protected as its weakest copy.',
      );
    }
    assert.ok(
      !/dbPassword/.test(line),
      `install.service.js:${lineNo} interpolates dbPassword into .env directly`,
    );
  }

  assert.match(
    src,
    /password is NOT stored here/i,
    'the .env should say where the password actually lives',
  );
});

test('a failure to load the store is loud, not silent', () => {
  /* The fallback writes plain text. That is the right call - a till that
     cannot save its password cannot start tomorrow - but only if it says so,
     because otherwise a packaging mistake looks like success. */
  const src = fs.readFileSync(
    path.join(ROOT, 'api', 'src', 'services', 'install.service.js'),
    'utf8',
  );
  const fallback = src.slice(src.indexOf('Could not save encrypted credentials'));
  assert.match(
    fallback.slice(0, 400),
    /Falling back to plain text/,
    'the plain-text fallback must announce itself',
  );
});
