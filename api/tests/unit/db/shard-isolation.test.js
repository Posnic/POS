/*
 * Two shops in one process must not be able to see each other.
 *
 * This is the property the whole shard rests on, and the one whose failure is
 * silent: nothing throws, the query succeeds, and it returns the wrong
 * customer's sales. It is worth proving rather than reasoning about.
 *
 * Four things are checked, and each corresponds to a way it has gone wrong in
 * systems like this before:
 *
 *   - the database follows the request, not the process;
 *   - the secrets follow the request, so a token minted for one shop does not
 *     verify for another;
 *   - concurrent requests do not bleed into each other across awaits, which is
 *     the failure a plain module-level variable would have;
 *   - code that escapes the request scope fails loudly instead of silently
 *     picking whichever shop the process last touched.
 */
const test = require('node:test');
const assert = require('node:assert');

/* Required once. The mode is a module-level flag and every test turns it off
   again in a finally, which is both simpler and more honest than juggling the
   module cache - and the cache trick does not behave the same under jest, which
   is how two of these tests came to be handed undefined. */
const ctx = require('../../../src/db/tenant-context');

const shopA = {
  tenantDb: 'posnic_t_alpha',
  db: { name: 'posnic_t_alpha' },
  secrets: { JWT_SECRET: 'alpha-secret', ENCRYPTION_KEY: 'alpha-key' },
};
const shopB = {
  tenantDb: 'posnic_t_beta',
  db: { name: 'posnic_t_beta' },
  secrets: { JWT_SECRET: 'beta-secret', ENCRYPTION_KEY: 'beta-key' },
};

test('the database follows the request', () => {
  ctx.enableMultiTenant(true);
  try {
    ctx.runWithTenant(shopA, () => {
      assert.strictEqual(ctx.currentDb().name, 'posnic_t_alpha');
    });
    ctx.runWithTenant(shopB, () => {
      assert.strictEqual(ctx.currentDb().name, 'posnic_t_beta');
    });
  } finally {
    ctx.enableMultiTenant(false);
  }
});

test('the secrets follow the request', () => {
  process.env.JWT_SECRET = 'the-process-wide-one';
  ctx.enableMultiTenant(true);
  try {
    ctx.runWithTenant(shopA, () => {
      assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'alpha-secret');
    });
    ctx.runWithTenant(shopB, () => {
      assert.strictEqual(ctx.currentSecret('JWT_SECRET'), 'beta-secret');
    });
    /* Never the process's own value, which is the one that would let a token
       minted for one customer verify for another. */
    ctx.runWithTenant(shopA, () => {
      assert.notStrictEqual(ctx.currentSecret('JWT_SECRET'), 'the-process-wide-one');
    });
  } finally {
    ctx.enableMultiTenant(false);
    delete process.env.JWT_SECRET;
  }
});

test('concurrent requests do not bleed across awaits', async () => {
  ctx.enableMultiTenant(true);
  try {
    /*
     * The real shape of the risk. Two requests interleave at every await; a
     * module-level "current tenant" would be whatever the last one set, so A
     * would finish reading B's database. AsyncLocalStorage is what makes this
     * hold, and this asserts it rather than trusting it.
     */
    const work = (shop, delays) =>
      ctx.runWithTenant(shop, async () => {
        const seen = [];
        for (const ms of delays) {
          await new Promise((r) => setTimeout(r, ms));
          seen.push(ctx.currentDb().name);
          seen.push(ctx.currentSecret('JWT_SECRET'));
        }
        return seen;
      });

    const [a, b] = await Promise.all([
      work(shopA, [5, 1, 8, 1]),
      work(shopB, [1, 7, 1, 4]),
    ]);

    assert.ok(a.every((v) => v === 'posnic_t_alpha' || v === 'alpha-secret'),
      'a request saw another shop: ' + a.join(', '));
    assert.ok(b.every((v) => v === 'posnic_t_beta' || v === 'beta-secret'),
      'a request saw another shop: ' + b.join(', '));
  } finally {
    ctx.enableMultiTenant(false);
  }
});

test('escaping the request scope fails loudly', () => {
  ctx.enableMultiTenant(true);
  try {
    /* No fallback. Returning "whichever shop the process last touched" is the
       leak this mode exists to prevent, so it throws with a message that says
       what to do about it. */
    assert.throws(() => ctx.currentDb(), /no shop in context/);
    assert.throws(() => ctx.currentSecret('JWT_SECRET'), /no JWT_SECRET for the shop in context/);
  } finally {
    ctx.enableMultiTenant(false);
  }
});

test('a shop missing a secret is refused, not given the environment', () => {
  process.env.JWT_SECRET = 'the-process-wide-one';
  ctx.enableMultiTenant(true);
  try {
    /* Half-provisioned shops exist. Handing one the process's key would sign
       its tokens with something another shop could verify. */
    ctx.runWithTenant({ tenantDb: 'x', db: {}, secrets: {} }, () => {
      assert.throws(() => ctx.currentSecret('JWT_SECRET'), /no JWT_SECRET/);
    });
  } finally {
    ctx.enableMultiTenant(false);
    delete process.env.JWT_SECRET;
  }
});
