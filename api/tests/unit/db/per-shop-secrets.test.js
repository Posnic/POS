/*
 * Per-shop secrets must not be read straight from the environment.
 *
 * The sibling of single-entry-point.test.js, and for a worse failure. That one
 * guards the database: read it from the wrong place and you return another
 * shop's data, which is at least visible to whoever reads it. This guards the
 * signing and encryption keys, and reading those from the wrong place means the
 * authentication boundary between two customers has stopped existing - a token
 * minted for one shop verifies in another, a record encrypted for one is
 * decrypted with another's key - with nothing about it visible from inside
 * either shop.
 *
 * It works today only because each shop owns a process, so process.env is
 * unambiguous. The moment one process serves several shops it becomes whichever
 * shop started it. This test is what stops that regressing between now and then.
 *
 * The rule: request-path code calls currentSecret(). Startup and configuration
 * may read the environment, because at startup there is no request to belong to.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

/* Per shop: minted per installation, different for every customer. Not
   JWT_EXPIRES_IN or NODE_ENV, which are the same everywhere and carry nothing. */
const PER_SHOP = [
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_IV',
  'KIOSK_API_KEY',
  'SESSION_SECRET',
];

/*
 * Where reading the environment is still correct.
 *
 * config/ is read once at startup to build the process's defaults, and
 * tenant-context.js is the accessor itself - it has to reach the environment,
 * that is its standalone path.
 */
const ALLOWED = [path.join('src', 'config'), path.join('src', 'db', 'tenant-context.js')];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function offendingLines(file) {
  const rel = path.relative(path.join(SRC, '..'), file);
  if (ALLOWED.some((a) => rel.startsWith(a))) return [];

  const out = [];
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const name of PER_SHOP) {
      if (!line.includes(`process.env.${name}`)) continue;
      /* Permitted as the explicit standalone fallback handed to the accessor -
         currentSecret('X', process.env.X) - because that argument is only ever
         reached when there is no tenant scope and the mode is off. */
      if (line.includes('currentSecret(')) continue;
      out.push({ line: i + 1, name, text: line.trim() });
    }
  });
  return out;
}

test('per-shop secrets go through currentSecret(), not process.env', () => {
  const found = [];
  for (const file of walk(SRC)) {
    for (const hit of offendingLines(file)) {
      found.push(`${path.relative(SRC, file)}:${hit.line}  ${hit.name}\n      ${hit.text}`);
    }
  }

  assert.deepStrictEqual(
    found,
    [],
    'These read a per-shop secret from the environment:\n\n  ' +
      found.join('\n  ') +
      '\n\nIn a process serving one shop that is correct. In one serving several ' +
      'it is whichever shop started the process, so a token minted for one ' +
      'customer would be accepted for another. Use currentSecret(name) from ' +
      'src/db/tenant-context.js; pass process.env.NAME as the second argument ' +
      'only if standalone genuinely needs that fallback.'
  );
});

test('the accessor refuses to guess in multi-tenant mode', () => {
  /* The property the rest of this rests on. Loaded fresh so enabling the mode
     cannot leak into another test file. */
  delete require.cache[require.resolve('../../../src/db/tenant-context')];
  const ctx = require('../../../src/db/tenant-context');

  process.env.JWT_SECRET = 'the-process-wide-one';

  // Standalone: the environment is right, and is used.
  assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'the-process-wide-one');

  ctx.enableMultiTenant(true);
  try {
    // No shop in context: refuses rather than returning the process's value.
    assert.throws(() => ctx.currentSecret('JWT_SECRET'), /no JWT_SECRET for the shop in context/);

    // A shop in context: its own value, never the environment's.
    ctx.runWithTenant({ db: {}, secrets: { JWT_SECRET: 'shop-a' } }, () => {
      assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'shop-a');
    });

    // A shop missing that secret still refuses, rather than falling back -
    // the fallback is exactly the cross-tenant leak.
    ctx.runWithTenant({ db: {}, secrets: {} }, () => {
      assert.throws(() => ctx.currentSecret('JWT_SECRET'), /no JWT_SECRET for the shop in context/);
    });

    // Two shops in the same process never see each other's.
    ctx.runWithTenant({ db: {}, secrets: { JWT_SECRET: 'shop-a' } }, () => {
      ctx.runWithTenant({ db: {}, secrets: { JWT_SECRET: 'shop-b' } }, () => {
        assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'shop-b');
      });
      assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'shop-a');
    });
  } finally {
    ctx.enableMultiTenant(false);
    delete process.env.JWT_SECRET;
  }
});
