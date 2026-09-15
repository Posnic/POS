'use strict';

/*
 * The till and the server call the same piece of paper the same thing.
 *
 * WHY THIS HAD TO EXIST BEFORE ANYTHING ELSE
 *
 * The till computes a key for every ticket - sale, type, and a hash of the
 * contents - and uses it twice: to skip one it has already printed, and to
 * write the durable claim in print-ledger.js that stops a restart reprinting
 * the lot.
 *
 * The SERVER never knew that key. It handed out sales and was told "these are
 * printed", and the two sides described the same paper in different words. So
 * the question this whole area turns on had no answer:
 *
 *     Did the ticket the server expected to print actually print?
 *
 * A queue cannot hold a thing it cannot name, and a shadow comparison between
 * the old path and the new one is impossible without one name. So the key came
 * out of kot-manager.js into a module both sides can use.
 *
 * THE RISK IN DOING THAT
 *
 * A changed key renames every ticket in flight on ninety shops: the ledger
 * stops recognising what it already printed, and a restart reprints a service.
 * So the extraction is pinned as byte-identical to the expression it replaced,
 * not merely "looks right".
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const shell = require(path.join(ROOT, 'src', 'kot-job-key.js'));
const api = require(path.join(ROOT, 'api', 'src', 'utils', 'kot-job-key.js'));

/*
 * The expression that stood in kot-manager.js, copied verbatim. If the module
 * ever stops agreeing with this, tickets get renamed and the ledger forgets
 * what it printed.
 */
function theOldWay(saleId, job) {
  const jobType = (job.type || '').toLowerCase();
  const jobItems = Array.isArray(job.items) ? job.items : [];
  const ts = job.timestamp;
  const tsToken =
    ts instanceof Date
      ? ts.getTime().toString()
      : (ts && ts.$date && ts.$date.$numberLong) || String((ts && ts.$date) || ts || '');
  const raw = `${saleId}-${jobType}-${tsToken}-${JSON.stringify(jobItems)}`;
  const jobHash = crypto.createHash('md5').update(raw).digest('hex');
  return `${saleId}:${jobType}:${jobHash}`;
}

const STAMPS = [
  new Date(1757800000000),
  { $date: { $numberLong: '1757800000000' } },
  { $date: '1757800000000' },
  { $date: 1757800000000 },
  '1757800000000',
  1757800000000,
  null,
  undefined,
  '',
  { $date: '' },
  { $date: 0 },
  {},
];
const TYPES = ['KOT', 'kot', 'Cancelled', 'modified', ''];
const ITEMS = [[], [{ n: 'Idli' }], [{ n: 'Idli', q: 2 }, { n: 'Naan' }]];

/* ------------------------------------------- it did not rename anything */

test('EVERY TICKET KEEPS THE NAME IT HAD, across 180 combinations', () => {
  /*
   * The one that matters on merge day. A shop mid-service has tickets already
   * claimed in its ledger under the old key; if the new key differs, the till
   * no longer recognises them and reprints the service on its next restart.
   */
  let checked = 0;
  for (const timestamp of STAMPS) {
    for (const type of TYPES) {
      for (const items of ITEMS) {
        const job = { type, timestamp, items };
        checked += 1;
        assert.strictEqual(
          shell.kotJobKey('SB1D14-000051', job),
          theOldWay('SB1D14-000051', job),
          `renamed a ticket: ${JSON.stringify({ type, timestamp })}`
        );
      }
    }
  }
  assert.ok(checked >= 180, `only ${checked} combinations covered`);
});

/* --------------------------------------------- the two copies agree */

test('THE SHELL AND THE API COPIES ARE THE SAME FILE', () => {
  /*
   * The API ships outside the asar archive and cannot require the shell's
   * modules, so there are two copies on purpose - the same arrangement
   * order-source.js uses. Two copies that drift would name one ticket two
   * ways, which is exactly the duplicate this is meant to make detectable.
   */
  const a = fs.readFileSync(path.join(ROOT, 'src', 'kot-job-key.js'), 'utf8');
  const b = fs.readFileSync(path.join(ROOT, 'api', 'src', 'utils', 'kot-job-key.js'), 'utf8');
  assert.strictEqual(a.replace(/\r\n/g, '\n'), b.replace(/\r\n/g, '\n'), 'the copies have drifted');
});

test('and they answer identically, not merely look alike', () => {
  for (const timestamp of STAMPS) {
    for (const type of TYPES) {
      const job = { type, timestamp, items: [{ n: 'Idli' }] };
      assert.strictEqual(shell.kotJobKey('SB1', job), api.kotJobKey('SB1', job));
    }
  }
});

/* ------------------------------------------------- what the key means */

test('an amended order is a DIFFERENT ticket', () => {
  /*
   * Adding a dish to table 6 is new paper for the same sale. Keying on the
   * sale alone would silence every amendment after the first - the kitchen
   * would never hear about the second round.
   */
  const at = new Date(1757800000000);
  const first = shell.kotJobKey('SB1', { type: 'kot', timestamp: at, items: [{ n: 'Idli' }] });
  const second = shell.kotJobKey('SB1', {
    type: 'kot',
    timestamp: at,
    items: [{ n: 'Idli' }, { n: 'Naan' }],
  });
  assert.notStrictEqual(first, second);
});

test('the same ticket asked for twice has the same name', () => {
  /* Which is what makes a duplicate detectable rather than only preventable. */
  const job = { type: 'kot', timestamp: new Date(1757800000000), items: [{ n: 'Idli' }] };
  assert.strictEqual(shell.kotJobKey('SB1', job), shell.kotJobKey('SB1', { ...job }));
});

test('a cancellation is not the same ticket as the order', () => {
  const at = new Date(1757800000000);
  const items = [{ n: 'Idli' }];
  assert.notStrictEqual(
    shell.kotJobKey('SB1', { type: 'kot', timestamp: at, items }),
    shell.kotJobKey('SB1', { type: 'cancelled', timestamp: at, items })
  );
});

test('the type is matched case-insensitively, because the data is not consistent', () => {
  const job = { timestamp: new Date(1), items: [] };
  assert.strictEqual(
    shell.kotJobKey('SB1', { ...job, type: 'KOT' }),
    shell.kotJobKey('SB1', { ...job, type: 'kot' })
  );
});

test('every shape a timestamp arrives in reduces to one token', () => {
  /*
   * A sale comes as a Mongo document, as EJSON over the wire, or as a plain
   * object from a test. If those hashed differently, one ticket would have
   * several names depending on which door it came through.
   */
  const same = ['1757800000000', { $date: '1757800000000' }, { $date: { $numberLong: '1757800000000' } }];
  const keys = new Set(
    same.map((timestamp) => shell.kotJobKey('SB1', { type: 'kot', timestamp, items: [] }))
  );
  assert.strictEqual(keys.size, 1, 'one ticket got several names');
  /* A Date of the same instant too. */
  assert.strictEqual(
    shell.kotJobKey('SB1', { type: 'kot', timestamp: new Date(1757800000000), items: [] }),
    [...keys][0]
  );
});

test('a sale with no print jobs names nothing, rather than naming nothing badly', () => {
  assert.deepStrictEqual(shell.kotJobKeys({ _id: 'SB1' }), []);
  assert.deepStrictEqual(shell.kotJobKeys({}), []);
});

/* --------------------------------------------------- it is actually used */

test('THE TILL USES THE MODULE, not a copy of the expression', () => {
  /*
   * If the inline hash comes back, the server and the till drift apart again
   * and every guarantee built on a shared name quietly stops holding.
   */
  const kot = fs.readFileSync(path.join(ROOT, 'src', 'kot-manager.js'), 'utf8');
  assert.match(kot, /require\('\.\/kot-job-key'\)/, 'the till no longer uses the shared key');
  assert.match(kot, /kotJobKey\(saleId, job\)/);
  assert.match(kot, /kotFallbackKey\(sale, \{ cancelled: isCancel \}\)/,
    'the fallback path names tickets its own way again');
  /*
   * The ONLY md5 left in that file is the log row's id fallback when
   * randomUUID is missing. Naming a ticket inline is what must not come back,
   * and a bare search for the word would fail on an unrelated line - which is
   * how this assertion was wrong the first time.
   */
  const ticketHashes = (kot.match(/createHash\('md5'\)/g) || []).length;
  assert.strictEqual(ticketHashes, 1, 'a ticket key is being hashed inline again');
  assert.match(kot, /randomUUID[\s\S]{0,120}createHash\('md5'\)/,
    'the remaining md5 is no longer the log id fallback');
});

test('both copies are in the packaged build', () => {
  /* build.files is an allowlist: a file left out resolves in development and
     is simply absent on a shop's machine. The API half rides with server.js. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/kot-job-key.js'));
});
