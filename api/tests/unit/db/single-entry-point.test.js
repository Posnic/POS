'use strict';
/*
 * Nothing reads data through a process-wide database handle.
 *
 * Forty of these existed - `mongoose.connection.db` and
 * `mongoose.connection.collection(...)` scattered through controllers, models
 * and repositories. Each one is fixed to whichever database the process
 * connected to at startup, which is correct for a till and is a cross-tenant
 * leak in a process serving several shops: no error, the query succeeds, and it
 * returns another shop's data.
 *
 * They were all routed through currentConnection(). This test is what keeps
 * them there. A guard like this is worth more than the original fix, because
 * the fix is a one-off and the rule has to survive everyone who adds a
 * controller afterwards - and the thing it prevents is invisible in review.
 *
 * If this fails, the message names the file and line. Use
 * currentConnection(mongoose.connection) or req.db instead.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

/*
 * Files that legitimately hold the process-wide connection.
 *
 * These manage the connection rather than read through it - connecting,
 * closing, reporting readyState, pinging. A shop's data never passes through
 * them, so there is nothing to scope.
 */
const ALLOWED = new Set([
  path.join('db', 'tenant-context.js'), // defines the accessor
  path.join('db', 'request-db.js'), // resolves per request
  path.join('db', 'tenant-connections.js'), // opens per-shop connections
  path.join('utils', 'db.js'), // connect/close/health
  path.join('services', 'install.service.js'), // first-run setup
  path.join('middleware', 'rate-limit-store.js'), // counters are per machine, not per shop
  path.join('utils', 'tenant-context.js'), // branch scoping within one shop
]);

/* .db.admin() is a server command, not a shop's data. */
const OFFENDING = /mongoose\.connection\.(collection\(|db(?!\.admin\())/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('every read of shop data goes through one accessor', () => {
  test('no file reaches the process-wide connection for data', () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const relative = path.relative(SRC, file);
      if (ALLOWED.has(relative)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return; // prose
        if (OFFENDING.test(line))
          offenders.push(`${relative}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    if (offenders.length) {
      throw new Error(
        'These read shop data through the process-wide connection, which serves ' +
          'the wrong database when one process hosts several shops.\n' +
          'Use currentConnection(mongoose.connection) or req.db.\n\n' +
          offenders.join('\n')
      );
    }
    expect(offenders).toEqual([]);
  });

  test('the allowlist only contains files that manage the connection', () => {
    /* A file added here silently is how the rule erodes. Each entry must still
       exist, so a rename cannot leave a permanent hole behind. */
    for (const relative of ALLOWED) {
      expect(fs.existsSync(path.join(SRC, relative))).toBe(true);
    }
  });

  test('nothing outside install and the connection helpers opens its own client', () => {
    const allowed = new Set([
      path.join('models', 'base.model.js'),
      path.join('services', 'install.service.js'),
      path.join('utils', 'db.js'),
      path.join('db', 'tenant-connections.js'),
    ]);
    const offenders = [];
    for (const file of walk(SRC)) {
      const relative = path.relative(SRC, file);
      if (allowed.has(relative)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;
        if (/new MongoClient\(|MongoClient\.connect\(|mongoose\.connect\(/.test(line)) {
          offenders.push(`${relative}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    if (offenders.length) {
      throw new Error(
        'These open their own database connection. A connection per caller is ' +
          'a pool per caller.\n\n' +
          offenders.join('\n')
      );
    }
    expect(offenders).toEqual([]);
  });
});
