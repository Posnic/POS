'use strict';

/**
 * A shard that reads its shop list from a file instead of the control database.
 *
 * The demo estate needs this and production must not notice it.
 *
 * Reading the control registry means holding the control credential and
 * TENANT_SECRET_KEY - the key that unseals every shop's secrets across the
 * whole fleet. The demo box is a public machine whose logins are printed on its
 * own login page, and it serves fifty shops that contain nothing but sample
 * data. Putting the fleet master key there would be a poor trade.
 *
 * These are source pins rather than a running shard, because starting one
 * needs a mongod and a registry; what has to hold is that the new path is
 * OPTIONAL, that it keeps the isolation rules the control path has, and that
 * the control path is untouched when the variable is unset.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../../shard.js');
const source = fs.readFileSync(SRC, 'utf8');
/* Prose that names a guard reads like the guard. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('the file-backed registry', () => {
  it('does nothing at all unless it is asked for', () => {
    /* Every production shard has this unset and must take exactly the path it
       took before this existed. */
    expect(code).toMatch(/const REGISTRY_FILE = String\(process\.env\.SHARD_REGISTRY_FILE \|\| ''\)\.trim\(\);/);
    expect(code).toMatch(/if \(REGISTRY_FILE\) return loadRegistryFromFile\(\);/);
  });

  it('refuses to serve a shop with no key, exactly like the control path', () => {
    /*
     * currentSecret is fatal in multi-tenant mode by design: falling through to
     * the environment would sign one shop's token with another's key. A file
     * entry with no JWT_SECRET has to be dropped at load, not discovered on the
     * first request.
     */
    expect(code).toMatch(/if \(!secrets \|\| !secrets\.JWT_SECRET\) \{/);
    expect(code).toMatch(/no JWT_SECRET in the registry file; not served/);
  });

  it('gives every shop its own scope and its own database', () => {
    const block = code.slice(code.indexOf('function loadRegistryFromFile'),
                             code.indexOf('async function loadRegistry()'));
    expect(block).toMatch(/mongoose\.connection\.useDb\(r\.tenantDb, \{ useCache: true \}\)/);
    expect(block).toMatch(/secrets,/);
    /* Suspension is honoured the same way, so a demo can be taken down without
       editing nginx. */
    expect(block).toMatch(/suspended: !!r\.suspended/);
  });

  it('skips a malformed row rather than serving it half-configured', () => {
    const block = code.slice(code.indexOf('function loadRegistryFromFile'),
                             code.indexOf('async function loadRegistry()'));
    expect(block).toMatch(/if \(!r \|\| !r\.host \|\| !r\.tenantDb\) continue;/);
  });

  it('does not open a control-database connection it will never read', () => {
    expect(code).toMatch(/if \(!REGISTRY_FILE\) \{\s*\n\s*controlClient = new MongoClient/);
    expect(code).toMatch(/if \(!REGISTRY_FILE && !CONTROL_DB\) throw new Error/);
  });
});

describe('scoping a shard to one machine', () => {
  it('is optional, and unset means every shop as before', () => {
    /*
     * Necessary the moment a second machine runs a shard: without it both would
     * try to open every shop in the fleet, and each would fail on the databases
     * that live on the other one.
     */
    expect(code).toMatch(/const SHARD_INSTANCE = String\(process\.env\.SHARD_INSTANCE \|\| ''\)\.trim\(\);/);
    expect(code).toMatch(/if \(SHARD_INSTANCE\) query\.instance = SHARD_INSTANCE;/);
  });

  it('still starts from the query the control path always used', () => {
    const block = code.slice(code.indexOf('async function loadRegistry()'));
    expect(block).toMatch(/provisioned: true, subdomain: \{ \$exists: true, \$nin: \[null, ''\] \}/);
  });
});

describe('the source itself', () => {
  it('contains no invisible control characters', () => {
    /* Two raw control bytes were written into source by a generator earlier the
       same day - a NUL and a BACKSPACE - and both were invisible in every
       terminal view while one of them silently disabled a filter. */
    const raw = fs.readFileSync(SRC, 'latin1');
    const bad = [];
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad.push({ at: i, code: c });
    }
    expect(bad).toEqual([]);
  });
});
